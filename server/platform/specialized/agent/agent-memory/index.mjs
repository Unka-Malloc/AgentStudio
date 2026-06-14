import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  appendJsonLineSerialized
} from "../../../common/platform-core/state-coordinator.mjs";

export const AGENT_MEMORY_PROTOCOL_VERSION = "v0.0.1:agent:memory-1";

const SENSITIVE_KEY_PATTERN =
  /token|secret|password|passwd|authorization|cookie|api[-_]?key|client[-_]?secret|csrf/i;
const SENSITIVE_TEXT_PATTERN =
  /(Bearer\s+[A-Za-z0-9._~+/=-]+|sk-[A-Za-z0-9._-]+|xox[baprs]-[A-Za-z0-9-]+|(?:(?:api[-_]?key|token|secret|password)\s*[:=]\s*)[^\s"',;]+)/gi;
const ABSOLUTE_PATH_PATTERN =
  /(?:[A-Za-z]:\\[^\s"'<>]+|\/(?:Users|home|var|tmp|private|Volumes|opt|etc)\/[^\s"'<>]+)/g;

function nowIso() {
  return new Date().toISOString();
}

function stableJson(value) {
  if (value === null || value === undefined) {
    return "null";
  }
  if (typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
    .join(",")}}`;
}

function hashValue(value, length = 32) {
  return crypto.createHash("sha256").update(stableJson(value)).digest("hex").slice(0, length);
}

function redactText(value) {
  return String(value ?? "")
    .replace(SENSITIVE_TEXT_PATTERN, (match) => {
      const prefix = match.match(/^\s*(api[-_]?key|token|secret|password)\s*[:=]/i)?.[0] || "";
      return prefix ? `${prefix}<redacted>` : "<redacted-secret>";
    })
    .replace(ABSOLUTE_PATH_PATTERN, "<redacted-path>");
}

export function redactAgentMemoryValue(value, depth = 0) {
  if (depth > 8) {
    return "<redacted-depth>";
  }
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === "string") {
    return redactText(value);
  }
  if (typeof value !== "object") {
    return value;
  }
  if (Buffer.isBuffer(value)) {
    return {
      redacted: true,
      reason: "buffer",
      byteLength: value.length,
      sha256: crypto.createHash("sha256").update(value).digest("hex")
    };
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactAgentMemoryValue(item, depth + 1));
  }
  const output = {};
  for (const [key, nested] of Object.entries(value)) {
    output[key] = SENSITIVE_KEY_PATTERN.test(key)
      ? "<redacted>"
      : redactAgentMemoryValue(nested, depth + 1);
  }
  return output;
}

async function readJsonlTail(filePath, limit = 50) {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(-Math.max(1, Math.min(Number(limit || 50), 1000)))
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

function recordTimestamp(record = {}) {
  const time = Date.parse(record.createdAt || record.updatedAt || "");
  return Number.isFinite(time) ? time : 0;
}

function normalizeSessionRecord(entry = {}) {
  return {
    protocolVersion: AGENT_MEMORY_PROTOCOL_VERSION,
    memoryId: entry.memoryId || `agent_memory_${crypto.randomUUID()}`,
    sessionId: String(entry.sessionId || ""),
    profileId: String(entry.profileId || ""),
    boundaryId: String(entry.boundaryId || ""),
    sourceHash: String(entry.sourceHash || ""),
    summaryChecksum: entry.summaryChecksum || hashValue(entry.summary || ""),
    summary: redactText(entry.summary || ""),
    structured: redactAgentMemoryValue(entry.structured || {}),
    sourceRange: redactAgentMemoryValue(entry.sourceRange || {}),
    createdAt: entry.createdAt || nowIso(),
    status: entry.status || "active",
    sourceProtocolVersion: entry.protocolVersion || entry.sourceProtocolVersion || ""
  };
}

export function createAgentMemory({
  userDataPath,
  rootPath = "",
  sessionMemoryPath = ""
} = {}) {
  if (!userDataPath && !rootPath && !sessionMemoryPath) {
    throw new Error("agent_memory_user_data_path_required");
  }
  const resolvedRootPath = rootPath || path.join(userDataPath, "agent-memory");
  const resolvedSessionMemoryPath = sessionMemoryPath || path.join(resolvedRootPath, "session-memory.jsonl");

  async function readSessionRecords(limit = 50) {
    const safeLimit = Math.max(1, Math.min(Number(limit || 50), 1000));
    const records = [];
    const pathRecords = await readJsonlTail(resolvedSessionMemoryPath, safeLimit);
    for (const record of pathRecords) {
      records.push({
        ...record,
        storagePath: resolvedSessionMemoryPath
      });
    }
    return records
      .sort((left, right) => recordTimestamp(right) - recordTimestamp(left))
      .slice(0, safeLimit);
  }

  async function latestSessionMemory({ sessionId = "", profileId = "", sourceHash = "" } = {}) {
    const records = await readSessionRecords(500);
    for (const record of records) {
      const baseMatches =
        (!sessionId || record.sessionId === sessionId) &&
        (!profileId || !record.profileId || record.profileId === profileId);
      if (!baseMatches) {
        continue;
      }
      if (record.status === "cleared") {
        return null;
      }
      if (sourceHash && record.sourceHash !== sourceHash) {
        continue;
      }
      return record;
    }
    return null;
  }

  async function appendSessionMemory(entry = {}) {
    const record = normalizeSessionRecord(entry);
    await appendJsonLineSerialized(resolvedSessionMemoryPath, record);
    return record;
  }

  async function listSessionMemory(input = {}) {
    const records = await readSessionRecords(input.limit || 50);
    return {
      protocolVersion: AGENT_MEMORY_PROTOCOL_VERSION,
      rootPath: resolvedRootPath,
      path: resolvedSessionMemoryPath,
      records: records.filter((record) =>
        (!input.sessionId || record.sessionId === input.sessionId) &&
        (!input.profileId || record.profileId === input.profileId)
      )
    };
  }

  async function clearSessionMemory(input = {}) {
    const record = normalizeSessionRecord({
      memoryId: `agent_memory_clear_${crypto.randomUUID()}`,
      sessionId: input.sessionId || "",
      profileId: input.profileId || "",
      status: "cleared",
      createdAt: nowIso(),
      summary: "",
      structured: {
        reason: input.reason || "manual_clear"
      }
    });
    await appendJsonLineSerialized(resolvedSessionMemoryPath, record);
    return {
      protocolVersion: AGENT_MEMORY_PROTOCOL_VERSION,
      ok: true,
      record
    };
  }

  return Object.freeze({
    protocolVersion: AGENT_MEMORY_PROTOCOL_VERSION,
    rootPath: resolvedRootPath,
    sessionMemoryPath: resolvedSessionMemoryPath,
    latestSessionMemory,
    appendSessionMemory,
    listSessionMemory,
    clearSessionMemory
  });
}

export default createAgentMemory;
