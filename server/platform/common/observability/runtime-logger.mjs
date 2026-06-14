import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { getTraceContext, traceDetails } from "./trace-context.mjs";
import { ServerConfig } from "../config/ServerConfig.mjs";

const DEFAULT_RETENTION_DAYS = 14;
const DEFAULT_MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;
const DEFAULT_MAX_FILE_BYTES = 256 * 1024 * 1024;
const MAX_STRING_PREVIEW = 180;
const MAX_ARRAY_ITEMS = 12;
const MAX_OBJECT_KEYS = 60;
const MAX_DEPTH = 5;
const SENSITIVE_KEY_PATTERN =
  /(authorization|cookie|csrf|token|password|passwd|secret|api[-_]?key|client[-_]?secret|access[-_]?token|refresh[-_]?token|id[-_]?token|private[-_]?key|session)/i;

let defaultLogger = null;

const LEVEL_RANK = Object.freeze({
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
});

function nowIso() {
  return new Date().toISOString();
}

function datePart(value = new Date()) {
  return value.toISOString().slice(0, 10);
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value ?? "")).digest("hex");
}

function shortHash(value) {
  return sha256(value).slice(0, 16);
}

function normalizeRetentionDays(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_RETENTION_DAYS;
  }
  return Math.max(1, Math.min(3660, Math.trunc(parsed)));
}

function normalizeByteLimit(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.max(1024 * 1024, Math.trunc(parsed));
}

function normalizeLogLevel(value, fallback = "debug") {
  const level = String(value || fallback).trim().toLowerCase();
  return LEVEL_RANK[level] ? level : fallback;
}

function resolveLogDirectory({ runtimeOptions = {}, userDataPath = "" } = {}) {
  const explicit = String(
    runtimeOptions.logDir ||
      process.env.PACT_LOG_DIR ||
      ""
  ).trim();
  if (explicit) {
    return path.resolve(explicit);
  }
  const dataRoot = String(userDataPath || "").trim();
  if (dataRoot) {
    return path.join(path.resolve(dataRoot), "logs", "runtime");
  }
  return path.join(path.resolve(ServerConfig.getDataDir()), "logs", "runtime");
}

function sanitizeString(value, maxPreview = MAX_STRING_PREVIEW) {
  const text = String(value ?? "").replace(/[\r\n\t]/g, " ");
  if (text.length <= maxPreview) {
    return text;
  }
  return `${text.slice(0, maxPreview)}...`;
}

function looksLikeAbsolutePath(value) {
  const text = String(value || "");
  return path.isAbsolute(text) || /^[A-Za-z]:[\\/]/.test(text);
}

function shouldRedactAbsolutePath(value, key = "") {
  if (!looksLikeAbsolutePath(value)) {
    return false;
  }
  return /(path|dir|file|root|cwd|folder|workspace|data[-_]?dir|log[-_]?dir)/i.test(key);
}

function summarizeString(value, key = "", options = {}) {
  const text = String(value ?? "");
  if (SENSITIVE_KEY_PATTERN.test(key)) {
    return {
      redacted: true,
      reason: "sensitive-key",
      length: text.length,
      sha256: shortHash(text)
    };
  }
  if (shouldRedactAbsolutePath(text, key)) {
    return {
      type: "path",
      basename: path.basename(text),
      sha256: shortHash(text)
    };
  }
  const maxPreview = Number(options.maxStringPreview || MAX_STRING_PREVIEW);
  return {
    type: "string",
    length: text.length,
    sha256: shortHash(text),
    preview: sanitizeString(text, maxPreview)
  };
}

export function summarizeForLog(value, options = {}, depth = 0, key = "") {
  const maxDepth = Number(options.maxDepth || MAX_DEPTH);
  if (value === null || value === undefined) {
    return value ?? null;
  }
  if (typeof value === "string") {
    return summarizeString(value, key, options);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "bigint") {
    return String(value);
  }
  if (Buffer.isBuffer(value)) {
    return {
      type: "buffer",
      byteLength: value.length,
      sha256: shortHash(value.toString("base64"))
    };
  }
  if (value instanceof Error) {
    return summarizeError(value);
  }
  if (depth >= maxDepth) {
    return {
      type: Array.isArray(value) ? "array" : "object",
      truncated: true
    };
  }
  if (Array.isArray(value)) {
    const maxItems = Number(options.maxArrayItems || MAX_ARRAY_ITEMS);
    return {
      type: "array",
      length: value.length,
      items: value.slice(0, maxItems).map((item, index) =>
        summarizeForLog(item, options, depth + 1, `${key}[${index}]`)
      ),
      truncated: value.length > maxItems
    };
  }
  if (typeof value === "object") {
    const entries = Object.entries(value);
    const maxKeys = Number(options.maxObjectKeys || MAX_OBJECT_KEYS);
    const output = {};
    for (const [entryKey, entryValue] of entries.slice(0, maxKeys)) {
      if (SENSITIVE_KEY_PATTERN.test(entryKey)) {
        output[entryKey] = {
          redacted: true,
          reason: "sensitive-key",
          sha256: shortHash(
            typeof entryValue === "string" ? entryValue : JSON.stringify(entryValue ?? null)
          )
        };
        continue;
      }
      output[entryKey] = summarizeForLog(entryValue, options, depth + 1, entryKey);
    }
    if (entries.length > maxKeys) {
      output.__truncatedKeys = entries.length - maxKeys;
    }
    return output;
  }
  return {
    type: typeof value,
    value: sanitizeString(String(value))
  };
}

export function summarizeError(error) {
  const message = error instanceof Error ? error.message : String(error || "");
  const stack = error instanceof Error ? String(error.stack || "") : "";
  return {
    name: error?.name || "Error",
    message: sanitizeString(message, 500),
    code: error?.code || "",
    stack: stack
      ? sanitizeString(stack.replace(process.cwd(), "<workspace>"), 2000)
      : ""
  };
}

function actorSummary(actor = {}) {
  const user = actor?.user || actor;
  return {
    type: actor?.type || (user?.userId ? "console-user" : "system"),
    userId: user?.userId ? shortHash(user.userId) : "",
    username: user?.username ? sanitizeString(user.username, 80) : "",
    roleId: user?.roleId || ""
  };
}

function normalizeEventRecord({ component, level, event, details }) {
  const activeTrace = getTraceContext();
  const mergedDetails = {
    ...(activeTrace ? traceDetails(activeTrace) : {}),
    ...(details || {})
  };
  return {
    schemaVersion: "v0.0.1:schema:definition-1",
    ts: nowIso(),
    level,
    component,
    event: sanitizeString(event, 160),
    pid: process.pid,
    traceId: mergedDetails.traceId || "",
    requestId: mergedDetails.requestId || "",
    spanId: mergedDetails.spanId || "",
    parentSpanId: mergedDetails.parentSpanId || "",
    details: summarizeForLog(mergedDetails)
  };
}

export function createRuntimeLogger({
  userDataPath = "",
  runtimeOptions = {},
  component = "server",
  retentionDays = process.env.PACT_LOG_RETENTION_DAYS,
  maxTotalBytes = runtimeOptions.logMaxTotalBytes || process.env.PACT_LOG_MAX_TOTAL_BYTES,
  maxFileBytes = runtimeOptions.logMaxFileBytes || process.env.PACT_LOG_MAX_FILE_BYTES,
  level = runtimeOptions.logLevel || process.env.PACT_LOG_LEVEL
} = {}) {
  const logDir = resolveLogDirectory({ runtimeOptions, userDataPath });
  const safeRetentionDays = normalizeRetentionDays(retentionDays);
  const safeMaxTotalBytes = normalizeByteLimit(maxTotalBytes, DEFAULT_MAX_TOTAL_BYTES);
  const safeMaxFileBytes = normalizeByteLimit(maxFileBytes, DEFAULT_MAX_FILE_BYTES);
  const defaultLevel = runtimeOptions.profile === "production" ? "info" : "debug";
  let currentLevel = normalizeLogLevel(level, defaultLevel);
  const traceDebugFilters = new Set();
  const operationDebugFilters = new Set();
  const topicDebugFilters = new Set();
  const jobDebugFilters = new Set();
  let appendQueue = Promise.resolve();
  let lastCleanupAt = 0;
  let closed = false;

  function logPathFor(date = new Date(), index = 0) {
    const suffix = index > 0 ? `.${index}` : "";
    return path.join(logDir, `pact-${component}-${datePart(date)}${suffix}.jsonl`);
  }

  async function currentLogPath() {
    await fs.mkdir(logDir, { recursive: true });
    let index = 0;
    while (index < 10_000) {
      const candidate = logPathFor(new Date(), index);
      const stat = await fs.stat(candidate).catch(() => null);
      if (!stat || stat.size < safeMaxFileBytes) {
        return candidate;
      }
      index += 1;
    }
    return logPathFor(new Date(), index);
  }

  async function cleanupOldLogs({ force = false } = {}) {
    const now = Date.now();
    if (!force && now - lastCleanupAt < 60 * 60 * 1000) {
      return;
    }
    lastCleanupAt = now;
    const cutoff = now - safeRetentionDays * 24 * 60 * 60 * 1000;
    await fs.mkdir(logDir, { recursive: true });
    const entries = await fs.readdir(logDir, { withFileTypes: true }).catch(() => []);
    const logFiles = [];
    for (const entry of entries) {
      if (!entry.isFile() || !/^pact-.+\.jsonl$/.test(entry.name)) {
        continue;
      }
      const filePath = path.join(logDir, entry.name);
      const stat = await fs.stat(filePath).catch(() => null);
      if (!stat) {
        continue;
      }
      if (stat.mtimeMs < cutoff) {
        await fs.rm(filePath, { force: true }).catch(() => null);
        continue;
      }
      logFiles.push({ filePath, size: stat.size, mtimeMs: stat.mtimeMs });
    }
    let totalBytes = logFiles.reduce((sum, item) => sum + item.size, 0);
    for (const file of logFiles.sort((left, right) => left.mtimeMs - right.mtimeMs)) {
      if (totalBytes <= safeMaxTotalBytes) {
        break;
      }
      await fs.rm(file.filePath, { force: true }).catch(() => null);
      totalBytes -= file.size;
    }
  }

  function shouldLog(levelName, details = {}) {
    const normalized = normalizeLogLevel(levelName, "info");
    if (LEVEL_RANK[normalized] >= LEVEL_RANK[currentLevel]) {
      return true;
    }
    const trace = getTraceContext();
    const traceId = String(details.traceId || trace?.traceId || "");
    const operationId = String(details.operationId || trace?.operationId || "");
    const topic = String(details.topic || "");
    const jobId = String(details.jobId || "");
    return (
      (traceId && traceDebugFilters.has(traceId)) ||
      (operationId && operationDebugFilters.has(operationId)) ||
      (topic && topicDebugFilters.has(topic)) ||
      (jobId && jobDebugFilters.has(jobId))
    );
  }

  async function append(record) {
    if (closed) {
      return;
    }
    appendQueue = appendQueue.catch(() => null).then(async () => {
      await cleanupOldLogs();
      await fs.mkdir(logDir, { recursive: true });
      await fs.appendFile(await currentLogPath(), `${JSON.stringify(record)}\n`, "utf8");
    });
    await appendQueue;
  }

  function log(level, event, details = {}) {
    if (!shouldLog(level, details)) {
      return null;
    }
    const record = normalizeEventRecord({ component, level, event, details });
    void append(record);
    return record;
  }

  return {
    component,
    logDir,
    retentionDays: safeRetentionDays,
    maxTotalBytes: safeMaxTotalBytes,
    maxFileBytes: safeMaxFileBytes,
    actorSummary,
    get level() {
      return currentLevel;
    },
    setLevel(nextLevel) {
      currentLevel = normalizeLogLevel(nextLevel, currentLevel);
      return currentLevel;
    },
    enableDebugFilter(kind, value) {
      const text = String(value || "").trim();
      if (!text) {
        return;
      }
      if (kind === "operationId") {
        operationDebugFilters.add(text);
      } else if (kind === "topic") {
        topicDebugFilters.add(text);
      } else if (kind === "jobId") {
        jobDebugFilters.add(text);
      } else {
        traceDebugFilters.add(text);
      }
    },
    child(childDetails = {}) {
      return {
        component,
        logDir,
        retentionDays: safeRetentionDays,
        debug: (event, details = {}) => log("debug", event, { ...childDetails, ...details }),
        info: (event, details = {}) => log("info", event, { ...childDetails, ...details }),
        warn: (event, details = {}) => log("warn", event, { ...childDetails, ...details }),
        error: (event, details = {}) => log("error", event, { ...childDetails, ...details })
      };
    },
    debug: (event, details = {}) => log("debug", event, details),
    info: (event, details = {}) => log("info", event, details),
    warn: (event, details = {}) => log("warn", event, details),
    error: (event, details = {}) => log("error", event, details),
    async cleanup({ force = false } = {}) {
      await cleanupOldLogs({ force });
    },
    async flush() {
      await appendQueue.catch(() => null);
    },
    async close() {
      closed = true;
      await appendQueue.catch(() => null);
    }
  };
}

export function setRuntimeLogger(logger) {
  defaultLogger = logger || null;
}

export function getRuntimeLogger() {
  return defaultLogger;
}

export function logRuntimeEvent(level, event, details = {}) {
  const logger = getRuntimeLogger();
  if (!logger || typeof logger[level] !== "function") {
    return null;
  }
  return logger[level](event, details);
}
