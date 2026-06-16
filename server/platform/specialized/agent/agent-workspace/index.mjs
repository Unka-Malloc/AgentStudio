import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import Database from "better-sqlite3";
import { getRuntimeLogger } from "../../../common/observability/runtime-logger.mjs";
import {
  assertExistingLocalDirectoryWithinControlledRootsSync
} from "../../../common/security/local-path-boundary.mjs";

export const AGENT_WORKSPACE_PROTOCOL_VERSION = "v0.0.1:workspace:agent-workspace-1";
export const AGENT_WORKSPACE_CONTEXT_BUNDLE_VERSION = "v0.0.1:workspace:context-bundle-1";
export const AGENT_SESSION_THREAD_VERSION = "v0.0.1:agent:session-thread-1";
const CONTEXT_BUNDLE_COMPRESSED_MAX_BYTES = Math.max(
  1024,
  Number(process.env.PACT_AGENT_WORKSPACE_CONTEXT_BUNDLE_COMPRESSED_MAX_BYTES || 2 * 1024 * 1024)
);
const CONTEXT_BUNDLE_UNCOMPRESSED_MAX_BYTES = Math.max(
  CONTEXT_BUNDLE_COMPRESSED_MAX_BYTES,
  Number(process.env.PACT_AGENT_WORKSPACE_CONTEXT_BUNDLE_UNCOMPRESSED_MAX_BYTES || 16 * 1024 * 1024)
);

const ACCEPTED_SUBMISSION_TYPES = new Set([
  "evidenceCard",
  "evidenceRef",
  "claim",
  "artifact",
  "issue",
  "decisionProposal",
  "taskState",
  "contextSummary",
  "canonicalChange",
  "entityMerge",
  "relationChange",
  "taxonomyChange"
]);

const REVIEW_ONLY_TYPES = new Set([
  "canonicalChange",
  "entityMerge",
  "relationChange",
  "taxonomyChange"
]);

function nowIso() {
  return new Date().toISOString();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function uniqueStrings(values = []) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function parseJson(value, fallback = {}) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function stringifyJson(value, fallback = {}) {
  return JSON.stringify(value === undefined ? fallback : value);
}

function stableHash(...parts) {
  return crypto
    .createHash("sha256")
    .update(parts.map((part) => String(part ?? "")).join("\n"))
    .digest("hex");
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

function stableId(prefix, ...parts) {
  return `${prefix}_${stableHash(prefix, ...parts).slice(0, 24)}`;
}

function normalizeWorkspaceRelativePath(value, options = {}) {
  const raw = String(value || "").replace(/\\/g, "/").trim();
  if (!raw || raw === ".") {
    if (options.allowEmpty) {
      return "";
    }
    throw new Error("路径不能为空。");
  }
  if (raw.includes("\0") || raw.startsWith("/") || /^[A-Za-z]:\//.test(raw)) {
    throw new Error("路径必须是工作空间相对路径。");
  }
  const normalized = path.posix.normalize(raw);
  if (!normalized || normalized === ".") {
    if (options.allowEmpty) {
      return "";
    }
    throw new Error("路径不能为空。");
  }
  if (normalized === ".." || normalized.startsWith("../")) {
    throw new Error("路径不能跳出工作空间。");
  }
  return normalized.replace(/^\/+/, "");
}

function joinWorkspaceRelativePath(...parts) {
  return normalizeWorkspaceRelativePath(
    parts.map((part) => String(part || "").replace(/\\/g, "/").trim()).filter(Boolean).join("/"),
    { allowEmpty: false }
  );
}

function sha256Buffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function normalizeSha256(value = "") {
  return String(value || "").replace(/^sha256:/, "").trim();
}

function splitPatchTextLines(text) {
  const normalized = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const finalNewline = normalized.endsWith("\n");
  const body = finalNewline ? normalized.slice(0, -1) : normalized;
  return {
    lines: body ? body.split("\n") : [],
    finalNewline
  };
}

function parseUnifiedPatch(patchText = "") {
  const hunks = [];
  let current = null;
  for (const line of String(patchText || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")) {
    const header = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (header) {
      current = {
        oldStart: Number(header[1]),
        lines: []
      };
      hunks.push(current);
      continue;
    }
    if (!current) {
      continue;
    }
    if (line.startsWith("\\ No newline")) {
      continue;
    }
    if (/^[ +\-]/.test(line)) {
      current.lines.push(line);
    }
  }
  if (hunks.length === 0) {
    throw new Error("patch 必须包含至少一个 unified diff hunk。");
  }
  return hunks;
}

function assertPatchLineMatches(actual, expected, lineNumber) {
  if (actual !== expected) {
    throw new Error(`patch hunk 与当前文件不匹配：第 ${lineNumber} 行。`);
  }
}

function applyUnifiedPatchText(sourceText, patchText) {
  const source = splitPatchTextLines(sourceText);
  const output = [];
  let cursor = 0;
  for (const hunk of parseUnifiedPatch(patchText)) {
    const start = Math.max(0, hunk.oldStart - 1);
    if (start < cursor) {
      throw new Error("patch hunk 顺序重叠或倒退。");
    }
    output.push(...source.lines.slice(cursor, start));
    let oldCursor = start;
    for (const entry of hunk.lines) {
      const prefix = entry[0];
      const line = entry.slice(1);
      if (prefix === " ") {
        assertPatchLineMatches(source.lines[oldCursor], line, oldCursor + 1);
        output.push(line);
        oldCursor += 1;
      } else if (prefix === "-") {
        assertPatchLineMatches(source.lines[oldCursor], line, oldCursor + 1);
        oldCursor += 1;
      } else if (prefix === "+") {
        output.push(line);
      }
    }
    cursor = oldCursor;
  }
  output.push(...source.lines.slice(cursor));
  return `${output.join("\n")}${source.finalNewline ? "\n" : ""}`;
}

function applyReplacementHunks(sourceText, hunks = []) {
  let nextText = String(sourceText || "");
  let appliedCount = 0;
  for (const hunk of hunks) {
    const oldText = String(hunk.oldText ?? hunk.search ?? hunk.before ?? "");
    const newText = String(hunk.newText ?? hunk.replace ?? hunk.after ?? "");
    if (!oldText) {
      throw new Error("replacement hunk 必须提供 oldText/search。");
    }
    if (!nextText.includes(oldText)) {
      throw new Error("replacement hunk 与当前文件不匹配。");
    }
    if (hunk.replaceAll === true) {
      const before = nextText;
      nextText = nextText.split(oldText).join(newText);
      appliedCount += before === nextText ? 0 : 1;
    } else {
      nextText = nextText.replace(oldText, newText);
      appliedCount += 1;
    }
  }
  if (appliedCount === 0) {
    throw new Error("没有可应用的 replacement hunk。");
  }
  return nextText;
}

function optionalLimit(value, max = 500) {
  if (value === undefined || value === null || value === false) {
    return null;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }
  return Math.max(1, Math.min(Math.floor(numeric), max));
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function boundedInteger(value, fallback, min = 0, max = 1000) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.floor(numeric)));
}

function truncateText(value, maxChars = 800) {
  const text = normalizeText(value);
  const limit = boundedInteger(maxChars, 800, 0, 10000);
  if (limit <= 0 || text.length <= limit) {
    return text;
  }
  return `${text.slice(0, Math.max(0, limit - 15))}...<truncated>`;
}

function normalizeEvidenceRefs(value, payload = {}) {
  const refs = [
    ...asArray(value),
    ...asArray(payload.evidenceRefs),
    payload.evidenceId,
    payload.sourceEvidenceId
  ]
    .map((item) => {
      if (!item) {
        return "";
      }
      if (typeof item === "string") {
        return item.trim();
      }
      return String(item.evidenceId || item.id || item.ref || "").trim();
    })
    .filter(Boolean);
  return [...new Set(refs)];
}

function submissionSummary(type, payload) {
  return normalizeText(
    payload.claim ||
      payload.summary ||
      payload.title ||
      payload.content ||
      payload.question ||
      payload.status ||
      type
  ).slice(0, 500);
}

function compactWorkspaceLayer(workspace = {}) {
  return {
    workspaceId: workspace.workspaceId,
    ownerUserId: workspace.ownerUserId || "",
    title: workspace.title,
    objective: truncateText(workspace.objective, 500),
    status: workspace.status,
    parentWorkspaceId: workspace.parentWorkspaceId || null,
    profile: workspace.profile || {},
    ownedSourceIds: asArray(workspace.ownedSourceIds),
    accessibleWorkspaceIds: asArray(workspace.accessibleWorkspaceIds),
    currentGeneration: Number(workspace.currentGeneration || 0),
    updatedAt: workspace.updatedAt || ""
  };
}

function compactRun(run = {}) {
  return {
    runId: run.runId,
    runType: run.runType,
    status: run.status,
    degraded: Boolean(run.degraded),
    artifactIds: asArray(run.artifactIds),
    error: truncateText(run.error, 500),
    startedAt: run.startedAt || "",
    completedAt: run.completedAt || "",
    updatedAt: run.updatedAt || ""
  };
}

function compactSubmission(submission = {}) {
  const payload = asObject(submission.payload);
  return {
    submissionId: submission.submissionId,
    runId: submission.runId,
    agentId: submission.agentId,
    type: submission.type,
    status: submission.status,
    confidence: Number(submission.confidence || 0),
    summary: submissionSummary(submission.type, payload),
    evidenceRefs: asArray(submission.evidenceRefs),
    gateReasons: asArray(submission.gate?.reasons),
    updatedAt: submission.updatedAt || ""
  };
}

function compactArtifact(artifact = {}, options = {}) {
  return {
    artifactId: artifact.artifactId,
    runId: artifact.runId,
    level: artifact.level,
    title: artifact.title,
    status: artifact.status,
    revision: Number(artifact.revision || 0),
    contentPreview: truncateText(artifact.content, options.contentPreviewChars),
    citations: asArray(artifact.citations),
    coverageKeys: Object.keys(asObject(artifact.coverageReport)),
    updatedAt: artifact.updatedAt || ""
  };
}

function compactIssue(issue = {}) {
  return {
    issueId: issue.issueId,
    runId: issue.runId,
    type: issue.type,
    status: issue.status,
    severity: issue.severity,
    title: issue.title,
    evidenceRefs: asArray(issue.evidenceRefs),
    updatedAt: issue.updatedAt || ""
  };
}

function compactDecision(decision = {}) {
  return {
    decisionId: decision.decisionId,
    runId: decision.runId,
    status: decision.status,
    title: decision.title,
    payloadKeys: Object.keys(asObject(decision.payload)),
    updatedAt: decision.updatedAt || ""
  };
}

function compactPrivateState(privateState = {}) {
  return {
    id: privateState.id,
    runId: privateState.runId,
    agentId: privateState.agentId,
    summary: truncateText(privateState.summary, 800),
    stateKeys: Object.keys(asObject(privateState.state)),
    updatedAt: privateState.updatedAt || ""
  };
}

function compactSessionEvent(event = {}) {
  return {
    eventId: event.eventId,
    sequence: Number(event.sequence || 0),
    type: event.type,
    title: event.title,
    summary: truncateText(event.summary, 600),
    createdBy: event.createdBy || "",
    createdAt: event.createdAt || ""
  };
}

function buildWorkspaceHandoffMarkdown(bundle = {}) {
  const context = bundle.context || {};
  const summary = bundle.summary || {};
  const recent = bundle.recent || {};
  const lines = [
    "# Workspace Context Bundle",
    `workspaceId: ${bundle.workspace?.workspaceId || ""}`,
    `generation: ${context.currentGeneration || 0}`,
    `contextFingerprint: ${context.contextFingerprint || ""}`,
    `contextProfileId: ${context.contextProfileId || ""}`,
    `modelAlias: ${context.modelAlias || ""}`,
    `toolGrantId: ${context.toolGrantId || ""}`,
    `knowledgeSourceCount: ${asArray(context.knowledgeSourceIds).length}`,
    `chain: ${asArray(context.chainGenerations).map((item) => `${item.workspaceId}@${item.generation}`).join(" -> ")}`,
    "",
    "## Summary",
    `runs: ${summary.runCount || 0}`,
    `submissions: ${summary.submissionCount || 0}`,
    `acceptedSubmissions: ${summary.acceptedSubmissionCount || 0}`,
    `openIssues: ${summary.openIssueCount || 0}`,
    `artifacts: ${summary.artifactCount || 0}`,
    "",
    "## Recent Runs",
    ...asArray(recent.runs).map((run) => `- ${run.runId} ${run.runType} ${run.status}`),
    "",
    "## Recent Artifacts",
    ...asArray(recent.artifacts).map((artifact) => `- ${artifact.artifactId} ${artifact.status} ${artifact.title}`),
    "",
    "## Open Issues",
    ...asArray(recent.issues)
      .filter((issue) => issue.status !== "resolved")
      .map((issue) => `- ${issue.issueId} ${issue.severity} ${issue.title}`)
  ];
  return lines.join("\n");
}

function decodeWorkspaceContextBundle(input = {}) {
  const payload = asObject(input.contextBundle || input.context_bundle || input);
  if (payload.bundle?.bundleVersion === AGENT_WORKSPACE_CONTEXT_BUNDLE_VERSION) {
    return payload.bundle;
  }
  if (payload.bundleVersion === AGENT_WORKSPACE_CONTEXT_BUNDLE_VERSION && payload.context) {
    return payload;
  }
  const compressed = asObject(
    payload.compressed ||
      payload.compressedBundle ||
      payload.bundleCompressed ||
      payload.contextBundleCompressed
  );
  const encoded = String(compressed.payload || payload.payload || "").trim();
  const encoding = String(compressed.encoding || payload.encoding || "").trim().toLowerCase();
  if (!encoded) {
    throw new Error("缺少工作空间上下文压缩包。");
  }
  if (!["gzip+base64", "base64+gzip"].includes(encoding)) {
    throw new Error("工作空间上下文压缩包编码不受支持。");
  }
  const compressedBuffer = Buffer.from(encoded, "base64");
  if (compressedBuffer.length > CONTEXT_BUNDLE_COMPRESSED_MAX_BYTES) {
    throw new Error("工作空间上下文压缩包超过大小上限。");
  }
  let decoded;
  try {
    decoded = gunzipSync(compressedBuffer, {
      maxOutputLength: CONTEXT_BUNDLE_UNCOMPRESSED_MAX_BYTES + 1
    });
  } catch (error) {
    if (error?.code === "ERR_BUFFER_TOO_LARGE") {
      throw new Error("工作空间上下文压缩包超过大小上限。");
    }
    throw error;
  }
  if (decoded.length > CONTEXT_BUNDLE_UNCOMPRESSED_MAX_BYTES) {
    throw new Error("工作空间上下文压缩包超过大小上限。");
  }
  const jsonText = decoded.toString("utf8");
  return JSON.parse(jsonText);
}

function hydrateWorkspace(row) {
  if (!row) {
    return null;
  }
  return {
    workspaceId: row.workspace_id,
    title: row.title,
    objective: row.objective,
    status: row.status,
    ownerUserId: row.owner_user_id || "",
    metadata: parseJson(row.metadata_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    // Inheritance & profile fields (populated after schema evolution)
    parentWorkspaceId: row.parent_workspace_id || null,
    profile: parseJson(row.profile_json, {}),
    ownedSourceIds: parseJson(row.owned_source_ids_json, []),
    accessibleWorkspaceIds: parseJson(row.accessible_workspace_ids_json, []),
    currentGeneration: Number(row.current_generation || 1),
    fsPath: row.fs_path || "",
  };
}

function hydrateRun(row, options = {}) {
  if (!row) {
    return null;
  }
  const includeDetails = options.includeDetails !== false;
  return {
    runId: row.run_id,
    workspaceId: row.workspace_id,
    runType: row.run_type,
    status: row.status,
    input: parseJson(row.input_json, {}),
    steps: includeDetails ? parseJson(row.steps_json, []) : [],
    coverage: includeDetails ? parseJson(row.coverage_json, {}) : {},
    artifactIds: parseJson(row.artifact_ids_json, []),
    error: row.error,
    degraded: Boolean(row.degraded),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    completedAt: row.completed_at
  };
}

function hydrateSubmission(row) {
  if (!row) {
    return null;
  }
  return {
    submissionId: row.submission_id,
    workspaceId: row.workspace_id,
    runId: row.run_id,
    agentId: row.agent_id,
    type: row.type,
    status: row.status,
    confidence: Number(row.confidence || 0),
    payload: parseJson(row.payload_json, {}),
    evidenceRefs: parseJson(row.evidence_refs_json, []),
    gate: parseJson(row.gate_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function hydratePrivateState(row) {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    runId: row.run_id,
    agentId: row.agent_id,
    summary: row.summary,
    state: parseJson(row.state_json, {}),
    updatedAt: row.updated_at
  };
}

function hydrateArtifact(row) {
  if (!row) {
    return null;
  }
  return {
    artifactId: row.artifact_id,
    workspaceId: row.workspace_id,
    runId: row.run_id,
    level: row.level,
    title: row.title,
    content: row.content,
    citations: parseJson(row.citations_json, []),
    coverageReport: parseJson(row.coverage_json, {}),
    revision: Number(row.revision || 1),
    status: row.status,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function hydrateIssue(row) {
  if (!row) {
    return null;
  }
  return {
    issueId: row.issue_id,
    workspaceId: row.workspace_id,
    runId: row.run_id,
    type: row.type,
    status: row.status,
    severity: row.severity,
    title: row.title,
    payload: parseJson(row.payload_json, {}),
    evidenceRefs: parseJson(row.evidence_refs_json, []),
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function hydrateDecision(row) {
  if (!row) {
    return null;
  }
  return {
    decisionId: row.decision_id,
    workspaceId: row.workspace_id,
    runId: row.run_id,
    status: row.status,
    title: row.title,
    payload: parseJson(row.payload_json, {}),
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function hydrateLock(row) {
  if (!row) {
    return null;
  }
  return {
    lockId: row.lock_id,
    workspaceId: row.workspace_id,
    targetType: row.target_type,
    targetId: row.target_id,
    ownerAgentId: row.owner_agent_id,
    expiresAt: row.expires_at,
    createdAt: row.created_at
  };
}

function hydrateSession(row) {
  if (!row) {
    return null;
  }
  return {
    sessionId: row.session_id,
    workspaceId: row.workspace_id,
    title: row.title,
    objective: row.objective || "",
    status: row.status || "active",
    parentSessionId: row.parent_session_id || "",
    forkedFromEventId: row.forked_from_event_id || "",
    branchIndex: Number(row.branch_index || 0),
    lineage: parseJson(row.lineage_json, []),
    context: parseJson(row.context_json, {}),
    metadata: parseJson(row.metadata_json, {}),
    createdBy: row.created_by || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastEventId: row.last_event_id || "",
    eventCount: Number(row.event_count || 0),
    appendOnly: row.append_only !== 0
  };
}

function hydrateSessionEvent(row) {
  if (!row) {
    return null;
  }
  return {
    eventId: row.event_id,
    sessionId: row.session_id,
    workspaceId: row.workspace_id,
    parentEventId: row.parent_event_id || "",
    type: row.event_type,
    title: row.title || "",
    summary: row.summary || "",
    payload: parseJson(row.payload_json, {}),
    createdBy: row.created_by || "",
    createdAt: row.created_at,
    sequence: Number(row.sequence || 0)
  };
}

function fileMetadataFromStat({ workspaceId, relativePath, absolutePath, stat, includeHash = false }) {
  const isFile = stat.isFile();
  const metadata = {
    workspaceId,
    relativePath,
    name: path.posix.basename(relativePath) || "",
    type: stat.isDirectory() ? "directory" : isFile ? "file" : "other",
    sizeBytes: stat.isDirectory() ? 0 : Number(stat.size || 0),
    createdAt: stat.birthtime?.toISOString?.() || "",
    updatedAt: stat.mtime?.toISOString?.() || "",
    contentSha256: ""
  };
  if (includeHash && isFile) {
    metadata.contentSha256 = crypto.createHash("sha256").update(fs.readFileSync(absolutePath)).digest("hex");
  }
  return metadata;
}

function gateSubmission({ existingDuplicate = null, submission, writePolicy = {} }) {
  const reasons = [];
  const type = String(submission.type || "").trim();
  const payload = asObject(submission.payload);
  const evidenceRefs = normalizeEvidenceRefs(submission.evidenceRefs, payload);
  const confidence = Math.max(0, Math.min(1, Number(submission.confidence || payload.confidence || 0)));
  const allowedTypes = new Set(asArray(writePolicy.allowedTypes).filter(Boolean));

  if (!ACCEPTED_SUBMISSION_TYPES.has(type)) {
    reasons.push("unsupported_type");
  }
  if (allowedTypes.size && !allowedTypes.has(type)) {
    reasons.push("role_not_allowed");
  }
  if (existingDuplicate) {
    reasons.push("duplicate_submission");
  }
  if ((type === "claim" || type === "evidenceCard") && evidenceRefs.length === 0) {
    reasons.push("missing_evidence");
  }
  if ((type === "claim" || type === "evidenceCard") && confidence < 0.45) {
    reasons.push("low_confidence");
  }
  if (REVIEW_ONLY_TYPES.has(type)) {
    reasons.push("canonical_change_requires_review");
  }

  let status = "proposed";
  if (type === "evidenceRef" && evidenceRefs.length > 0) {
    status = "accepted";
  }
  if (type === "artifact" || type === "taskState" || type === "contextSummary") {
    status = "accepted";
  }
  if (type === "issue" || type === "decisionProposal") {
    status = "proposed";
  }
  if (reasons.includes("duplicate_submission") || reasons.includes("unsupported_type") || reasons.includes("role_not_allowed")) {
    status = "rejected";
  } else if (
    reasons.includes("missing_evidence") ||
    reasons.includes("low_confidence") ||
    reasons.includes("canonical_change_requires_review")
  ) {
    status = "needs_review";
  }

  return {
    status,
    confidence,
    evidenceRefs,
    acceptedByGate: status === "accepted",
    reasons,
    duplicateOf: existingDuplicate?.submission_id || "",
    reviewedRequired: status === "needs_review" || REVIEW_ONLY_TYPES.has(type)
  };
}

export function createAgentWorkspace({ userDataPath, merkleState = null, checkpointTreeApi = null }) {
  const rootPath = path.join(userDataPath, "agent-workspaces");
  fs.mkdirSync(rootPath, { recursive: true });
  const localDirectoryMountConfigPath = path.join(rootPath, "local-directory-mounts.json");
  const db = new Database(path.join(rootPath, "agent-workspace.sqlite"));
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS aw_workspaces (
      workspace_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      objective TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS aw_runs (
      run_id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      run_type TEXT NOT NULL,
      status TEXT NOT NULL,
      input_json TEXT NOT NULL DEFAULT '{}',
      steps_json TEXT NOT NULL DEFAULT '[]',
      coverage_json TEXT NOT NULL DEFAULT '{}',
      artifact_ids_json TEXT NOT NULL DEFAULT '[]',
      error TEXT NOT NULL DEFAULT '',
      degraded INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      started_at TEXT NOT NULL DEFAULT '',
      completed_at TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_aw_runs_workspace ON aw_runs(workspace_id, updated_at DESC);
    CREATE TABLE IF NOT EXISTS aw_private_state (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      state_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL,
      UNIQUE(workspace_id, run_id, agent_id)
    );
    CREATE TABLE IF NOT EXISTS aw_submissions (
      submission_id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0,
      duplicate_key TEXT NOT NULL DEFAULT '',
      payload_json TEXT NOT NULL DEFAULT '{}',
      evidence_refs_json TEXT NOT NULL DEFAULT '[]',
      gate_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_aw_submissions_workspace ON aw_submissions(workspace_id, status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_aw_submissions_duplicate ON aw_submissions(workspace_id, type, duplicate_key);
    CREATE TABLE IF NOT EXISTS aw_artifacts (
      artifact_id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      level TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      citations_json TEXT NOT NULL DEFAULT '[]',
      coverage_json TEXT NOT NULL DEFAULT '{}',
      revision INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'draft',
      created_by TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_aw_artifacts_run ON aw_artifacts(run_id, level, updated_at DESC);
    CREATE TABLE IF NOT EXISTS aw_issues (
      issue_id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'medium',
      title TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      evidence_refs_json TEXT NOT NULL DEFAULT '[]',
      created_by TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_aw_issues_workspace ON aw_issues(workspace_id, status, updated_at DESC);
    CREATE TABLE IF NOT EXISTS aw_decisions (
      decision_id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      status TEXT NOT NULL,
      title TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_by TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS aw_locks (
      lock_id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      owner_agent_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_aw_locks_target ON aw_locks(workspace_id, target_type, target_id);
    CREATE INDEX IF NOT EXISTS idx_aw_locks_expiry ON aw_locks(expires_at);
    CREATE TABLE IF NOT EXISTS aw_sessions (
      session_id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      title TEXT NOT NULL,
      objective TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      parent_session_id TEXT NOT NULL DEFAULT '',
      forked_from_event_id TEXT NOT NULL DEFAULT '',
      branch_index INTEGER NOT NULL DEFAULT 0,
      lineage_json TEXT NOT NULL DEFAULT '[]',
      context_json TEXT NOT NULL DEFAULT '{}',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_by TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_event_id TEXT NOT NULL DEFAULT '',
      event_count INTEGER NOT NULL DEFAULT 0,
      append_only INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_aw_sessions_workspace ON aw_sessions(workspace_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_aw_sessions_parent ON aw_sessions(parent_session_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_aw_sessions_status ON aw_sessions(status, updated_at DESC);
    CREATE TABLE IF NOT EXISTS aw_session_events (
      event_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      parent_event_id TEXT NOT NULL DEFAULT '',
      event_type TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      summary TEXT NOT NULL DEFAULT '',
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_by TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      sequence INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_aw_session_events_sequence ON aw_session_events(session_id, sequence);
    CREATE INDEX IF NOT EXISTS idx_aw_session_events_workspace ON aw_session_events(workspace_id, created_at DESC);
  `);

  // ── Schema evolution: add inheritance + profile + sharing columns ──────────
  // These run once on startup and are idempotent.
  [
    ["parent_workspace_id",          "TEXT"],
    ["profile_json",                 "TEXT NOT NULL DEFAULT '{}'"],
    ["owned_source_ids_json",        "TEXT NOT NULL DEFAULT '[]'"],
    ["accessible_workspace_ids_json","TEXT NOT NULL DEFAULT '[]'"],
    ["current_generation",           "INTEGER NOT NULL DEFAULT 1"],
    ["owner_user_id",                "TEXT NOT NULL DEFAULT ''"],
    ["fs_path",                      "TEXT NOT NULL DEFAULT ''"],
  ].forEach(([col, def]) => {
    const exists = db.prepare(`PRAGMA table_info(aw_workspaces)`).all().some((c) => c.name === col);
    if (!exists) db.exec(`ALTER TABLE aw_workspaces ADD COLUMN ${col} ${def}`);
  });
  // Create index on parent_workspace_id AFTER the column is guaranteed to exist
  db.exec("CREATE INDEX IF NOT EXISTS idx_aw_workspaces_parent ON aw_workspaces(parent_workspace_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_aw_workspaces_owner ON aw_workspaces(owner_user_id, updated_at DESC)");

  const insertWorkspaceStmt = db.prepare(`
    INSERT OR REPLACE INTO aw_workspaces (
      workspace_id, title, objective, status, owner_user_id, metadata_json, created_at, updated_at, fs_path
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const updateWorkspaceOwnerStmt = db.prepare(`
    UPDATE aw_workspaces
    SET owner_user_id = ?, metadata_json = ?, updated_at = ?
    WHERE workspace_id = ?
  `);
  const selectWorkspaceStmt = db.prepare("SELECT * FROM aw_workspaces WHERE workspace_id = ?");
  const listWorkspacesStmt = db.prepare("SELECT * FROM aw_workspaces ORDER BY updated_at DESC LIMIT ?");
  const listWorkspacesByStatusStmt = db.prepare("SELECT * FROM aw_workspaces WHERE status = ? ORDER BY updated_at DESC LIMIT ?");
  const insertRunStmt = db.prepare(`
    INSERT OR REPLACE INTO aw_runs (
      run_id, workspace_id, run_type, status, input_json, steps_json, coverage_json,
      artifact_ids_json, error, degraded, created_at, updated_at, started_at, completed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const selectRunStmt = db.prepare("SELECT * FROM aw_runs WHERE run_id = ?");
  const updateWorkspaceTimeStmt = db.prepare("UPDATE aw_workspaces SET updated_at = ? WHERE workspace_id = ?");
  const selectSubmissionStmt = db.prepare("SELECT * FROM aw_submissions WHERE submission_id = ?");
  const updateSubmissionStatusStmt = db.prepare("UPDATE aw_submissions SET status = ?, gate_json = ?, updated_at = ? WHERE submission_id = ?");
  const selectIssueStmt = db.prepare("SELECT * FROM aw_issues WHERE issue_id = ?");
  const updateIssueStatusStmt = db.prepare("UPDATE aw_issues SET status = ?, payload_json = ?, updated_at = ? WHERE issue_id = ?");
  const selectLockStmt = db.prepare("SELECT * FROM aw_locks WHERE lock_id = ?");
  const selectTargetLockStmt = db.prepare("SELECT * FROM aw_locks WHERE workspace_id = ? AND target_type = ? AND target_id = ?");
  const insertLockStmt = db.prepare(`
    INSERT INTO aw_locks (
      lock_id, workspace_id, target_type, target_id, owner_agent_id, expires_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(workspace_id, target_type, target_id) DO UPDATE SET
      lock_id = excluded.lock_id,
      owner_agent_id = excluded.owner_agent_id,
      expires_at = excluded.expires_at,
      created_at = excluded.created_at
  `);
  const deleteLockStmt = db.prepare("DELETE FROM aw_locks WHERE lock_id = ?");
  const deleteExpiredLocksStmt = db.prepare("DELETE FROM aw_locks WHERE expires_at <= ?");
  const selectDuplicateStmt = db.prepare(`
    SELECT * FROM aw_submissions
    WHERE workspace_id = ? AND type = ? AND duplicate_key = ? AND status != 'rejected'
    LIMIT 1
  `);
  const insertSubmissionStmt = db.prepare(`
    INSERT OR REPLACE INTO aw_submissions (
      submission_id, workspace_id, run_id, agent_id, type, status, confidence, duplicate_key,
      payload_json, evidence_refs_json, gate_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertPrivateStmt = db.prepare(`
    INSERT INTO aw_private_state (
      id, workspace_id, run_id, agent_id, summary, state_json, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(workspace_id, run_id, agent_id) DO UPDATE SET
      summary = excluded.summary,
      state_json = excluded.state_json,
      updated_at = excluded.updated_at
  `);
  const insertArtifactStmt = db.prepare(`
    INSERT OR REPLACE INTO aw_artifacts (
      artifact_id, workspace_id, run_id, level, title, content, citations_json,
      coverage_json, revision, status, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertIssueStmt = db.prepare(`
    INSERT OR REPLACE INTO aw_issues (
      issue_id, workspace_id, run_id, type, status, severity, title,
      payload_json, evidence_refs_json, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertDecisionStmt = db.prepare(`
    INSERT OR REPLACE INTO aw_decisions (
      decision_id, workspace_id, run_id, status, title, payload_json, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertSessionStmt = db.prepare(`
    INSERT OR REPLACE INTO aw_sessions (
      session_id, workspace_id, title, objective, status, parent_session_id, forked_from_event_id,
      branch_index, lineage_json, context_json, metadata_json, created_by, created_at, updated_at,
      last_event_id, event_count, append_only
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const selectSessionStmt = db.prepare("SELECT * FROM aw_sessions WHERE session_id = ?");
  const listSessionsStmt = db.prepare("SELECT * FROM aw_sessions ORDER BY updated_at DESC LIMIT ?");
  const listSessionsByStatusStmt = db.prepare("SELECT * FROM aw_sessions WHERE status = ? ORDER BY updated_at DESC LIMIT ?");
  const listSessionsByWorkspaceStmt = db.prepare("SELECT * FROM aw_sessions WHERE workspace_id = ? ORDER BY updated_at DESC LIMIT ?");
  const listSessionsByWorkspaceStatusStmt = db.prepare(
    "SELECT * FROM aw_sessions WHERE workspace_id = ? AND status = ? ORDER BY updated_at DESC LIMIT ?"
  );
  const selectWorkspaceRootSessionStmt = db.prepare(
    "SELECT * FROM aw_sessions WHERE workspace_id = ? AND parent_session_id = '' ORDER BY created_at ASC LIMIT 1"
  );
  const countChildSessionsStmt = db.prepare(
    "SELECT COUNT(*) AS count FROM aw_sessions WHERE parent_session_id = ?"
  );
  const insertSessionEventStmt = db.prepare(`
    INSERT INTO aw_session_events (
      event_id, session_id, workspace_id, parent_event_id, event_type, title, summary,
      payload_json, created_by, created_at, sequence
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const selectSessionEventStmt = db.prepare("SELECT * FROM aw_session_events WHERE event_id = ?");
  const selectSessionEventsStmt = db.prepare(
    "SELECT * FROM aw_session_events WHERE session_id = ? ORDER BY sequence ASC LIMIT ?"
  );
  const selectSessionEventsUntilStmt = db.prepare(
    "SELECT * FROM aw_session_events WHERE session_id = ? AND sequence <= ? ORDER BY sequence ASC"
  );
  const selectLastSessionEventStmt = db.prepare(
    "SELECT * FROM aw_session_events WHERE session_id = ? ORDER BY sequence DESC LIMIT 1"
  );
  const selectMaxSessionSequenceStmt = db.prepare(
    "SELECT COALESCE(MAX(sequence), 0) AS sequence FROM aw_session_events WHERE session_id = ?"
  );
  const updateSessionStatsStmt = db.prepare(
    "UPDATE aw_sessions SET last_event_id = ?, event_count = ?, updated_at = ? WHERE session_id = ?"
  );
  const updateSessionStatusStmt = db.prepare(
    "UPDATE aw_sessions SET status = ?, updated_at = ? WHERE session_id = ?"
  );

  function workspaceSummary(workspaceId) {
    const runCount = db.prepare("SELECT COUNT(*) AS count FROM aw_runs WHERE workspace_id = ?").get(workspaceId)?.count || 0;
    const submissionRows = db.prepare("SELECT status, COUNT(*) AS count FROM aw_submissions WHERE workspace_id = ? GROUP BY status").all(workspaceId);
    const artifactCount = db.prepare("SELECT COUNT(*) AS count FROM aw_artifacts WHERE workspace_id = ?").get(workspaceId)?.count || 0;
    const openIssueCount = db.prepare("SELECT COUNT(*) AS count FROM aw_issues WHERE workspace_id = ? AND status != 'resolved'").get(workspaceId)?.count || 0;
    const activeLockCount = db.prepare("SELECT COUNT(*) AS count FROM aw_locks WHERE workspace_id = ? AND expires_at > ?").get(workspaceId, nowIso())?.count || 0;
    const sessionCount = db.prepare("SELECT COUNT(*) AS count FROM aw_sessions WHERE workspace_id = ?").get(workspaceId)?.count || 0;
    const submissionCounts = Object.fromEntries(submissionRows.map((row) => [row.status, Number(row.count || 0)]));
    return {
      runCount: Number(runCount),
      submissionCount: Object.values(submissionCounts).reduce((sum, count) => sum + count, 0),
      acceptedSubmissionCount: submissionCounts.accepted || 0,
      reviewSubmissionCount: submissionCounts.needs_review || 0,
      artifactCount: Number(artifactCount),
      openIssueCount: Number(openIssueCount),
      activeLockCount: Number(activeLockCount),
      sessionCount: Number(sessionCount)
    };
  }

  function workspaceAccess(input = {}) {
    const metadata = asObject(input.metadata);
    const actorIds = uniqueStrings([
      input.actorUserId,
      input.userId,
      input.subjectId,
      input.username,
      metadata.actorUserId,
      metadata.userId,
      metadata.subjectId,
      metadata.username
    ]);
    const allowedWorkspaceIds = new Set(uniqueStrings([
      ...asArray(input.allowedWorkspaceIds)
    ]));
    return {
      actorUserId: actorIds[0] || "",
      actorIds,
      allowedWorkspaceIds,
      canAccessAll: input.canAccessAll === true,
      sharingMode: String(input.sharingMode || (input.canAccessAll === true ? "admin" : "owner-bound")).trim()
    };
  }

  function canAccessWorkspace(workspace, input = {}) {
    if (!workspace) {
      return false;
    }
    const access = workspaceAccess(input);
    if (access.canAccessAll) {
      return true;
    }
    const workspaceId = String(workspace.workspaceId || "").trim();
    if (workspaceId && access.allowedWorkspaceIds.has(workspaceId)) {
      return true;
    }
    const metadata = asObject(workspace.metadata);
    const ownerUserId = String(workspace.ownerUserId || metadata.ownerUserId || "").trim();
    const allowedUserIds = uniqueStrings([
      ownerUserId,
      metadata.defaultAdminUserId,
      ...asArray(metadata.adminUserIds),
      ...asArray(metadata.administrators),
      ...asArray(metadata.allowedUserIds),
      ...asArray(metadata.allowedUsers),
      ...asArray(metadata.sharedUserIds),
      ...asArray(metadata.members)
    ]);
    if (allowedUserIds.length === 0) {
      return false;
    }
    return access.actorIds.some((actorId) => allowedUserIds.includes(actorId));
  }

  function canAccessWorkspaceId(workspaceId, input = {}) {
    const workspace = hydrateWorkspace(selectWorkspaceStmt.get(String(workspaceId || "")));
    return canAccessWorkspace(workspace, input);
  }

  function workspaceFsRoot(workspace) {
    const fsPath = workspace?.fsPath || path.join(rootPath, "folders", String(workspace?.workspaceId || ""));
    const resolved = path.resolve(fsPath);
    fs.mkdirSync(resolved, { recursive: true });
    return resolved;
  }

  function resolveWorkspacePath(workspace, relativePath = "", options = {}) {
    const root = workspaceFsRoot(workspace);
    const normalized = normalizeWorkspaceRelativePath(relativePath, { allowEmpty: options.allowEmpty === true });
    const target = normalized ? path.resolve(root, ...normalized.split("/")) : root;
    if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
      throw new Error("路径不能跳出工作空间。");
    }
    return {
      root,
      relativePath: normalized,
      absolutePath: target
    };
  }

  function workspaceForStorage(input = {}) {
    const workspaceId = String(input.workspaceId || input.workspace_id || input.id || "").trim();
    const workspace = hydrateWorkspace(selectWorkspaceRawStmt.get(workspaceId));
    if (!workspace) {
      return { ok: false, status: 404, error: "工作空间不存在或不可访问。" };
    }
    if (!canAccessWorkspace(workspace, input)) {
      return { ok: false, status: 403, error: "工作空间不可访问。" };
    }
    return { ok: true, workspace };
  }

  function createAccessReceipt({ workspaceId = "", operationId = "", path: receiptPath = "", action = "read" } = {}) {
    const createdAt = nowIso();
    const eventHash = stableHash("access-receipt", workspaceId, operationId, receiptPath, action, createdAt);
    return {
      protocolVersion: "v0.0.1:sharedspace:sharedspace-access-receipt-1",
      receiptId: stableId("access_receipt", workspaceId, operationId, receiptPath, action, createdAt),
      operationId,
      workspaceId,
      path: receiptPath,
      action,
      state: "cached",
      eventHash,
      createdAt
    };
  }

  function defaultLocalDirectoryMountConfig() {
    return {
      schemaVersion: "v0.0.1:schema:definition-1",
      configPath: localDirectoryMountConfigPath,
      mounts: []
    };
  }

  function readLocalDirectoryMountConfig() {
    if (!fs.existsSync(localDirectoryMountConfigPath)) {
      return defaultLocalDirectoryMountConfig();
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(localDirectoryMountConfigPath, "utf8"));
      return {
        schemaVersion: "v0.0.1:schema:definition-1",
        configPath: localDirectoryMountConfigPath,
        ...asObject(parsed),
        mounts: asArray(parsed.mounts)
      };
    } catch {
      return defaultLocalDirectoryMountConfig();
    }
  }

  function writeLocalDirectoryMountConfig(config = {}) {
    const next = {
      schemaVersion: "v0.0.1:schema:definition-1",
      configPath: localDirectoryMountConfigPath,
      mounts: asArray(config.mounts)
    };
    fs.mkdirSync(path.dirname(localDirectoryMountConfigPath), { recursive: true });
    const tmpPath = `${localDirectoryMountConfigPath}.tmp`;
    fs.writeFileSync(tmpPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    fs.renameSync(tmpPath, localDirectoryMountConfigPath);
    return next;
  }

  function validateLocalDirectoryRoot(sourcePath) {
    if (!String(sourcePath || "").trim()) {
      throw new Error("sourcePath 不能为空。");
    }
    return assertExistingLocalDirectoryWithinControlledRootsSync(sourcePath, {
      userDataPath,
      label: "本机目录"
    });
  }

  function publicLocalDirectoryMount(mount = {}, { includeSourcePath = false } = {}) {
    const output = {
      mountRef: String(mount.mountRef || ""),
      workspaceId: String(mount.workspaceId || ""),
      sourceRootName: String(mount.sourceRootName || ""),
      sourceRootHash: String(mount.sourceRootHash || ""),
      targetPath: String(mount.targetPath || ""),
      status: String(mount.status || "active"),
      symlinkPolicy: "reject",
      stateSemantics: {
        source: "localDir",
        sourceState: "staged",
        canonicalState: "archived_after_cas_state_commit"
      },
      createdAt: String(mount.createdAt || ""),
      updatedAt: String(mount.updatedAt || "")
    };
    if (includeSourcePath) {
      output.sourcePath = String(mount.sourcePath || "");
      output.configPath = localDirectoryMountConfigPath;
    }
    return output;
  }

  function resolveLocalDirectorySource(input = {}, workspace, { allowDirectSourcePath = false } = {}) {
    const mountRef = String(
      input.mountRef ||
        input.mountId ||
        input.localDirMountRef ||
        input.localDirectoryMountRef ||
        ""
    ).trim();
    if (mountRef) {
      const config = readLocalDirectoryMountConfig();
      const mount = asArray(config.mounts).find((item) =>
        String(item.mountRef || "") === mountRef &&
        String(item.workspaceId || "") === String(workspace.workspaceId || "")
      );
      if (!mount) {
        throw new Error("本机目录 mount 不存在或不属于当前工作空间。");
      }
      if (String(mount.status || "active") !== "active") {
        throw new Error("本机目录 mount 未启用。");
      }
      const root = validateLocalDirectoryRoot(mount.sourcePath);
      return {
        sourcePath: root.realPath,
        mount
      };
    }
    const sourcePath = String(input.sourcePath || input.localPath || input.dirPath || "").trim();
    if (!allowDirectSourcePath) {
      throw new Error("本机目录访问需要使用已登记的 mountRef。");
    }
    const root = validateLocalDirectoryRoot(sourcePath);
    return {
      sourcePath: root.realPath,
      mount: null
    };
  }

  function connectLocalDirectory(input = {}) {
    const access = workspaceForStorage(input);
    if (!access.ok) {
      return access;
    }
    let targetPath;
    try {
      targetPath = normalizeWorkspaceRelativePath(input.targetPath || input.path || "", { allowEmpty: true });
    } catch (error) {
      return { ok: false, status: 400, error: error.message };
    }
    let root;
    try {
      root = validateLocalDirectoryRoot(input.sourcePath || input.localPath || input.dirPath);
    } catch (error) {
      return { ok: false, status: 400, error: error.message };
    }
    const validationPlan = localDirectorySyncPlan({
      ...input,
      workspaceId: access.workspace.workspaceId,
      sourcePath: root.realPath,
      targetPath,
      maxFiles: input.maxFiles || 2000
    }, { allowDirectSourcePath: true });
    if (!validationPlan.ok) {
      return validationPlan;
    }
    const timestamp = nowIso();
    const mountRef = String(input.mountRef || "").trim() ||
      stableId("local_dir_mount", access.workspace.workspaceId, root.realPath, targetPath);
    const mount = {
      mountRef,
      workspaceId: access.workspace.workspaceId,
      sourcePath: root.realPath,
      sourceRootName: path.basename(root.realPath),
      sourceRootHash: stableHash(root.realPath),
      targetPath,
      status: input.enabled === false ? "disabled" : "active",
      symlinkPolicy: "reject",
      createdAt: timestamp,
      updatedAt: timestamp,
      connectedBy: String(input.createdBy || input.actorUserId || input.agentId || "")
    };
    const config = readLocalDirectoryMountConfig();
    const existingIndex = config.mounts.findIndex((item) => String(item.mountRef || "") === mountRef);
    if (existingIndex >= 0) {
      mount.createdAt = config.mounts[existingIndex].createdAt || timestamp;
      config.mounts[existingIndex] = mount;
    } else {
      config.mounts.push(mount);
    }
    writeLocalDirectoryMountConfig(config);
    updateWorkspaceTimeStmt.run(timestamp, access.workspace.workspaceId);
    return {
      protocolVersion: AGENT_WORKSPACE_PROTOCOL_VERSION,
      ok: true,
      workspaceId: access.workspace.workspaceId,
      configPath: localDirectoryMountConfigPath,
      mount: publicLocalDirectoryMount(mount, { includeSourcePath: true }),
      syncPreview: {
        dryRun: true,
        summary: validationPlan.summary,
        sourceFileCount: validationPlan.sourceFileCount,
        targetFileCount: validationPlan.targetFileCount
      }
    };
  }

  function listLocalDirectoryMounts(input = {}) {
    const access = workspaceForStorage(input);
    if (!access.ok) {
      return access;
    }
    const config = readLocalDirectoryMountConfig();
    const mounts = config.mounts
      .filter((item) => String(item.workspaceId || "") === access.workspace.workspaceId)
      .map((item) => publicLocalDirectoryMount(item, { includeSourcePath: true }));
    return {
      protocolVersion: AGENT_WORKSPACE_PROTOCOL_VERSION,
      ok: true,
      workspaceId: access.workspace.workspaceId,
      configPath: localDirectoryMountConfigPath,
      mounts,
      count: mounts.length
    };
  }

  function listLocalDirectoryItems(input = {}) {
    const access = workspaceForStorage(input);
    if (!access.ok) {
      return access;
    }
    let source;
    try {
      source = resolveLocalDirectorySource(input, access.workspace);
    } catch (error) {
      return { ok: false, status: 400, error: error.message };
    }
    let basePath;
    try {
      basePath = normalizeWorkspaceRelativePath(input.path || input.relativePath || "", { allowEmpty: true });
    } catch (error) {
      return { ok: false, status: 400, error: error.message };
    }
    const root = source.sourcePath;
    const target = basePath ? path.resolve(root, ...basePath.split("/")) : root;
    if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
      return { ok: false, status: 400, error: "路径不能跳出本机目录 mount。" };
    }
    if (!fs.existsSync(target)) {
      return {
        protocolVersion: AGENT_WORKSPACE_PROTOCOL_VERSION,
        ok: true,
        workspaceId: access.workspace.workspaceId,
        mode: "localDir",
        mount: source.mount ? publicLocalDirectoryMount(source.mount) : null,
        basePath,
        exists: false,
        paths: [],
        items: [],
        count: 0,
        accessReceipt: createAccessReceipt({
          workspaceId: access.workspace.workspaceId,
          operationId: input.operationId || "sharedspace.item.list",
          path: basePath || "/",
          action: "localDir.list"
        })
      };
    }
    const rootStat = fs.lstatSync(target);
    if (rootStat.isSymbolicLink()) {
      return { ok: false, status: 400, error: "不允许列出符号链接对象。" };
    }
    const includeDirectories = input.includeDirectories !== false;
    const includeFiles = input.includeFiles !== false;
    const includeHash = input.includeHash === true;
    const recursive = input.recursive === true;
    const limit = boundedInteger(input.limit, 200, 1, 2000);
    const items = [];
    const toItem = (absolutePath, relativePath, stat) => ({
      name: path.basename(absolutePath),
      sourceRelativePath: relativePath,
      type: stat.isDirectory() ? "directory" : stat.isFile() ? "file" : "special",
      state: "staged",
      archived: false,
      sizeBytes: Number(stat.size || 0),
      mtimeMs: Number(stat.mtimeMs || 0),
      contentSha256: includeHash && stat.isFile() ? sha256Buffer(fs.readFileSync(absolutePath)) : undefined
    });
    const visit = (absoluteDir, relativeDir) => {
      if (items.length >= limit) {
        return;
      }
      const entries = fs.readdirSync(absoluteDir, { withFileTypes: true })
        .sort((left, right) => left.name.localeCompare(right.name));
      for (const entry of entries) {
        if (items.length >= limit) {
          return;
        }
        if (entry.name.startsWith(".")) {
          throw new Error(`不允许列出以 . 开头的路径：${relativeDir ? `${relativeDir}/` : ""}${entry.name}`);
        }
        const childAbsolutePath = path.join(absoluteDir, entry.name);
        const childRelativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
        const stat = fs.lstatSync(childAbsolutePath);
        if (stat.isSymbolicLink()) {
          throw new Error(`不允许列出符号链接：${childRelativePath}`);
        }
        if ((stat.isDirectory() && includeDirectories) || (stat.isFile() && includeFiles) || (!stat.isDirectory() && !stat.isFile())) {
          items.push(toItem(childAbsolutePath, childRelativePath, stat));
        }
        if (stat.isDirectory() && recursive) {
          visit(childAbsolutePath, childRelativePath);
        }
      }
    };
    try {
      if (rootStat.isDirectory()) {
        visit(target, basePath);
      } else if (includeFiles) {
        items.push(toItem(target, basePath, rootStat));
      }
    } catch (error) {
      return { ok: false, status: 400, error: error.message };
    }
    return {
      protocolVersion: AGENT_WORKSPACE_PROTOCOL_VERSION,
      ok: true,
      workspaceId: access.workspace.workspaceId,
      mode: "localDir",
      mount: source.mount ? publicLocalDirectoryMount(source.mount) : null,
      basePath,
      exists: true,
      paths: items.map((item) => item.sourceRelativePath),
      items,
      count: items.length,
      accessReceipt: createAccessReceipt({
        workspaceId: access.workspace.workspaceId,
        operationId: input.operationId || "sharedspace.item.list",
        path: basePath || "/",
        action: "localDir.list"
      })
    };
  }

  function decodeWorkspaceFileContent(input = {}) {
    if (Object.hasOwn(input, "contentBase64")) {
      const raw = String(input.contentBase64 || "").trim();
      if (!raw) {
        return Buffer.alloc(0);
      }
      return Buffer.from(raw, "base64");
    }
    if (Object.hasOwn(input, "content")) {
      return Buffer.from(String(input.content || ""), String(input.encoding || "utf8"));
    }
    throw new Error("content 或 contentBase64 至少提供一个。");
  }

  function workspaceStateScope(workspace) {
    return `workspace:${workspace.workspaceId}`;
  }

  function workspaceCheckpointTreeId(workspace) {
    return checkpointTreeApi?.checkpointTreeId
      ? checkpointTreeApi.checkpointTreeId("workspace-files", workspace.workspaceId)
      : "";
  }

  function compactStateCommit(commit = null) {
    return commit
      ? {
          commitId: commit.commitId,
          eventHash: commit.eventHash,
          beforeRoot: commit.beforeRoot,
          afterRoot: commit.afterRoot,
          contentRefs: asArray(commit.contentRefs),
          indexRoots: asObject(commit.indexRoots)
        }
      : null;
  }

  function filePayloadMetadata(file = {}) {
    return {
      type: file.type || "file",
      sizeBytes: Number(file.sizeBytes || 0),
      contentSha256: file.contentSha256 || "",
      updatedAt: file.updatedAt || file.mtime || ""
    };
  }

  async function archiveWorkspacePath(workspace, relativePath, metadata = {}) {
    if (!merkleState) {
      return null;
    }
    const resolved = resolveWorkspacePath(workspace, relativePath, { allowEmpty: false });
    if (!fs.existsSync(resolved.absolutePath)) {
      return null;
    }
    const stat = fs.statSync(resolved.absolutePath);
    if (stat.isFile()) {
      const content = fs.readFileSync(resolved.absolutePath);
      const block = await merkleState.cas.putBlock(content, {
        codec: "raw",
        metadata: {
          workspaceId: workspace.workspaceId,
          relativePath: resolved.relativePath,
          ...asObject(metadata)
        }
      });
      const manifest = await merkleState.merkleDag.buildManifest("workspace-file", [
        {
          path: resolved.relativePath,
          cid: block.cid,
          byteLength: block.byteLength,
          metadata: {
            contentSha256: block.payloadHash
          }
        }
      ], {
        workspaceId: workspace.workspaceId,
        relativePath: resolved.relativePath,
        type: "file",
        ...asObject(metadata)
      });
      return {
        rootCid: manifest.rootCid,
        contentRefs: [manifest.rootCid, block.cid],
        metadata: {
          type: "file",
          sizeBytes: block.byteLength,
          contentSha256: block.payloadHash
        }
      };
    }
    if (!stat.isDirectory()) {
      return null;
    }
    const entries = [];
    const refs = [];
    const visit = async (absoluteDir, relativeDir) => {
      const children = fs.readdirSync(absoluteDir, { withFileTypes: true })
        .filter((entry) => !entry.name.startsWith("."))
        .sort((left, right) => left.name.localeCompare(right.name));
      for (const child of children) {
        const childRelativePath = relativeDir ? `${relativeDir}/${child.name}` : child.name;
        const childAbsolutePath = path.join(absoluteDir, child.name);
        if (child.isDirectory()) {
          await visit(childAbsolutePath, childRelativePath);
          continue;
        }
        if (!child.isFile()) {
          continue;
        }
        const content = fs.readFileSync(childAbsolutePath);
        const block = await merkleState.cas.putBlock(content, {
          codec: "raw",
          metadata: {
            workspaceId: workspace.workspaceId,
            relativePath: childRelativePath,
            ...asObject(metadata)
          }
        });
        refs.push(block.cid);
        entries.push({
          path: childRelativePath,
          cid: block.cid,
          byteLength: block.byteLength,
          metadata: {
            contentSha256: block.payloadHash
          }
        });
      }
    };
    await visit(resolved.absolutePath, resolved.relativePath);
    const manifest = await merkleState.merkleDag.buildManifest("workspace-directory", entries, {
      workspaceId: workspace.workspaceId,
      relativePath: resolved.relativePath,
      type: "directory",
      ...asObject(metadata)
    });
    return {
      rootCid: manifest.rootCid,
      contentRefs: [manifest.rootCid, ...refs],
      metadata: {
        type: "directory",
        fileCount: entries.length
      }
    };
  }

  async function recordWorkspaceUploadIngest({
    workspace,
    relativePath,
    contentBuffer,
    operationId
  } = {}) {
    if (!merkleState || typeof merkleState.lsmIngest?.beginUploadSession !== "function") {
      return null;
    }
    const content = Buffer.isBuffer(contentBuffer) ? contentBuffer : Buffer.from(contentBuffer || "");
    const block = await merkleState.cas.putBlock(content, {
      codec: "raw",
      metadata: {
        workspaceId: workspace.workspaceId,
        relativePath,
        operationId,
        ingest: true
      }
    });
    const session = await merkleState.lsmIngest.beginUploadSession({
      scope: workspaceStateScope(workspace),
      workspaceId: workspace.workspaceId,
      files: [{
        relativePath,
        byteLength: content.length,
        sha256: normalizeSha256(block.payloadHash)
      }]
    });
    const chunkRecord = await merkleState.lsmIngest.appendChunkRecord(session.uploadSessionId, {
      fileId: relativePath,
      relativePath,
      chunkIndex: 0,
      offset: 0,
      byteLength: content.length,
      chunkCid: block.cid,
      chunkHash: block.payloadHash
    });
    const segment = await merkleState.lsmIngest.flushMemTable(session.uploadSessionId);
    const manifest = await merkleState.lsmIngest.materializeManifest(session.uploadSessionId);
    return {
      protocolVersion: merkleState.protocolVersion,
      status: "archived",
      uploadSessionId: session.uploadSessionId,
      segmentId: segment.segmentId,
      segmentRootCid: segment.rootCid,
      manifestRootCid: manifest.rootCid,
      chunkCid: block.cid,
      chunkHash: block.payloadHash,
      recordCount: segment.recordCount,
      nextOffset: Number(chunkRecord.offset || 0) + Number(chunkRecord.byteLength || 0),
      contentRefs: uniqueStrings([manifest.rootCid, segment.rootCid, block.cid])
    };
  }

  async function workspaceDownloadCacheReceipt(workspace, relativePath) {
    if (!merkleState || typeof merkleState.stateCommit?.begin !== "function") {
      return null;
    }
    const state = await merkleState.stateCommit.begin({
      scope: workspaceStateScope(workspace)
    });
    const indexRootCid = String(state.currentRoot || "");
    if (!indexRootCid) {
      return {
        protocolVersion: merkleState.protocolVersion,
        cacheFamily: "merkle-radix-compatible",
        implementation: "sorted-chunk-index-v1",
        cacheKey: `${workspaceStateScope(workspace)}:${relativePath}`,
        hit: false,
        indexRootCid: "",
        valueRoot: "",
        proofHash: ""
      };
    }
    const entry = await merkleState.merkleIndex.get(indexRootCid, relativePath);
    const proof = await merkleState.merkleIndex.prove(indexRootCid, relativePath);
    return {
      protocolVersion: merkleState.protocolVersion,
      cacheFamily: "merkle-radix-compatible",
      implementation: "sorted-chunk-index-v1",
      cacheKey: `${workspaceStateScope(workspace)}:${relativePath}`,
      hit: Boolean(entry),
      indexRootCid,
      valueRoot: entry?.valueRef || "",
      proofHash: proof.proofHash
    };
  }

  async function workspaceListCacheReceipt(workspace, prefix = "") {
    if (!merkleState || typeof merkleState.stateCommit?.begin !== "function") {
      return null;
    }
    const state = await merkleState.stateCommit.begin({
      scope: workspaceStateScope(workspace)
    });
    const indexRootCid = String(state.currentRoot || "");
    if (!indexRootCid) {
      return {
        protocolVersion: merkleState.protocolVersion,
        cacheFamily: "merkle-radix-compatible",
        implementation: "sorted-chunk-index-v1",
        cacheKey: `${workspaceStateScope(workspace)}:${prefix || "/"}`,
        hit: false,
        indexRootCid: "",
        prefix,
        entryCount: 0,
        valueRoots: [],
        proofHash: ""
      };
    }
    const entries = await merkleState.merkleIndex.prefix(indexRootCid, prefix);
    const proof = await merkleState.merkleIndex.prove(indexRootCid, prefix || entries[0]?.key || "");
    return {
      protocolVersion: merkleState.protocolVersion,
      cacheFamily: "merkle-radix-compatible",
      implementation: "sorted-chunk-index-v1",
      cacheKey: `${workspaceStateScope(workspace)}:${prefix || "/"}`,
      hit: entries.length > 0,
      indexRootCid,
      prefix,
      entryCount: entries.length,
      valueRoots: uniqueStrings(entries.map((entry) => entry.valueRef)).slice(0, 100),
      proofHash: proof.proofHash
    };
  }

  async function commitWorkspaceFileState({
    workspace,
    operationId,
    mutations = [],
    contentRefs = [],
    payload = {}
  } = {}) {
    if (!merkleState || typeof merkleState.stateCommit?.commit !== "function") {
      return null;
    }
    return compactStateCommit(await merkleState.stateCommit.commit({
      scope: workspaceStateScope(workspace),
      operationId,
      mutations,
      contentRefs: uniqueStrings(contentRefs),
      payload: {
        workspaceId: workspace.workspaceId,
        ...asObject(payload)
      }
    }));
  }

  async function buildWorkspaceFileSnapshot(workspace, { basePath = "", deleteExtraneous = true } = {}) {
    if (!merkleState) {
      return null;
    }
    const listed = await listWorkspaceFiles({
      workspaceId: workspace.workspaceId,
      path: basePath,
      folderPath: basePath,
      recursive: true,
      includeDirectories: false,
      includeFiles: true,
      includeHash: true,
      limit: 5000,
      actorUserId: workspace.ownerUserId || "",
      adminUserIds: [workspace.ownerUserId].filter(Boolean)
    });
    if (!listed.ok) {
      return null;
    }
    const files = [];
    for (const file of listed.files) {
      const resolved = resolveWorkspacePath(workspace, file.relativePath);
      const content = fs.readFileSync(resolved.absolutePath);
      const block = await merkleState.cas.putBlock(content, {
        codec: "raw",
        metadata: {
          workspaceId: workspace.workspaceId,
          relativePath: file.relativePath,
          snapshot: true
        }
      });
      files.push({
        path: file.relativePath,
        exists: true,
        contentCid: block.cid,
        contentSha256: normalizeSha256(block.payloadHash),
        byteLength: block.byteLength,
        encoding: "base64"
      });
    }
    return {
      workspaceId: workspace.workspaceId,
      basePath: normalizeWorkspaceRelativePath(basePath, { allowEmpty: true }),
      deleteExtraneous,
      files
    };
  }

  async function recordWorkspaceFileCheckpoint({
    workspace,
    operationId,
    stateCommit,
    action,
    path: relativePath
  } = {}) {
    if (!checkpointTreeApi || !stateCommit?.commitId) {
      return null;
    }
    const treeId = workspaceCheckpointTreeId(workspace);
    if (!treeId) {
      return null;
    }
    const snapshot = await buildWorkspaceFileSnapshot(workspace, {
      basePath: "",
      deleteExtraneous: true
    });
    if (!snapshot) {
      return null;
    }
    const existingTree = typeof checkpointTreeApi.loadCheckpointTree === "function"
      ? await checkpointTreeApi.loadCheckpointTree({ treeId })
      : null;
    if (!existingTree && typeof checkpointTreeApi.startCheckpointTree === "function") {
      await checkpointTreeApi.startCheckpointTree({
        treeId,
        kind: "workspace_files",
        ownerId: workspace.workspaceId,
        rootNodeId: "root",
        rootLabel: `Workspace files: ${workspace.title || workspace.workspaceId}`,
        resumePolicy: {
          mode: "append-only-workspace-file-restore",
          idempotencyKey: "treeId+nodeId"
        }
      });
    }
    if (typeof checkpointTreeApi.upsertCheckpointNode !== "function") {
      return null;
    }
    const nodeId = `commit:${stateCommit.commitId}`;
    await checkpointTreeApi.upsertCheckpointNode({
      treeId,
      nodeId,
      parentId: "root",
      label: `${action || operationId}: ${relativePath || workspace.workspaceId}`,
      status: "completed",
      cursor: {
        commitId: stateCommit.commitId,
        afterRoot: stateCommit.afterRoot
      },
      totals: {
        files: snapshot.files.length,
        contentRefs: stateCommit.contentRefs.length
      },
      metadata: {
        workspaceId: workspace.workspaceId,
        operationId,
        action,
        path: relativePath || "",
        stateCommit,
        workspaceFileSnapshot: snapshot
      },
      eventType: "workspace.file.checkpointed"
    });
    return {
      treeId,
      nodeId,
      snapshotFileCount: snapshot.files.length
    };
  }

  async function createWorkspaceFolder(input = {}) {
    const access = workspaceForStorage(input);
    if (!access.ok) {
      return access;
    }
    let resolved;
    try {
      const folderPath = normalizeWorkspaceRelativePath(
        input.folderPath || input.folder || input.directory || input.path || input.relativePath || "",
        { allowEmpty: false }
      );
      resolved = resolveWorkspacePath(access.workspace, folderPath);
    } catch (error) {
      return { ok: false, status: 400, error: error.message };
    }
    if (fs.existsSync(resolved.absolutePath) && !fs.statSync(resolved.absolutePath).isDirectory()) {
      return { ok: false, status: 409, error: "目标路径已存在且不是文件夹。" };
    }
    fs.mkdirSync(resolved.absolutePath, { recursive: true });
    updateWorkspaceTimeStmt.run(nowIso(), access.workspace.workspaceId);
    const archived = await archiveWorkspacePath(access.workspace, resolved.relativePath, {
      operationId: input.operationId || "agent_workspaces.folder.create"
    });
    const stateCommit = await commitWorkspaceFileState({
      workspace: access.workspace,
      operationId: input.operationId || "agent_workspaces.folder.create",
      mutations: archived
        ? [{
            action: "put",
            key: resolved.relativePath,
            valueRef: archived.rootCid,
            metadata: archived.metadata
          }]
        : [],
      contentRefs: archived?.contentRefs || [],
      payload: {
        action: "folder.create",
        path: resolved.relativePath
      }
    });
    const checkpoint = await recordWorkspaceFileCheckpoint({
      workspace: access.workspace,
      operationId: input.operationId || "agent_workspaces.folder.create",
      stateCommit,
      action: "folder.create",
      path: resolved.relativePath
    });
    return {
      protocolVersion: AGENT_WORKSPACE_PROTOCOL_VERSION,
      ok: true,
      workspaceId: access.workspace.workspaceId,
      stateCommit,
      checkpoint,
      folder: fileMetadataFromStat({
        workspaceId: access.workspace.workspaceId,
        relativePath: resolved.relativePath,
        absolutePath: resolved.absolutePath,
        stat: fs.statSync(resolved.absolutePath)
      })
    };
  }

  async function listWorkspaceFiles(input = {}) {
    const access = workspaceForStorage(input);
    if (!access.ok) {
      return access;
    }
    let base;
    try {
      base = resolveWorkspacePath(
        access.workspace,
        input.folderPath || input.folder || input.directory || input.path || input.relativePath || "",
        { allowEmpty: true }
      );
    } catch (error) {
      return { ok: false, status: 400, error: error.message };
    }
    if (!fs.existsSync(base.absolutePath)) {
      return {
        protocolVersion: AGENT_WORKSPACE_PROTOCOL_VERSION,
        ok: true,
        workspaceId: access.workspace.workspaceId,
        basePath: base.relativePath,
        exists: false,
        cacheReceipt: await workspaceListCacheReceipt(access.workspace, base.relativePath),
        accessReceipt: createAccessReceipt({
          workspaceId: access.workspace.workspaceId,
          operationId: input.operationId || "agent_workspaces.files.list",
          path: base.relativePath || "/",
          action: "workspace.list"
        }),
        paths: [],
        files: []
      };
    }
    const includeDirectories = input.includeDirectories !== false;
    const includeFiles = input.includeFiles !== false;
    const includeHash = input.includeHash === true;
    const recursive = input.recursive !== false;
    const limit = boundedInteger(input.limit, 500, 1, 5000);
    const files = [];
    const visit = (absoluteDir, relativeDir) => {
      if (files.length >= limit) {
        return;
      }
      const entries = fs.readdirSync(absoluteDir, { withFileTypes: true })
        .filter((entry) => !entry.name.startsWith("."))
        .sort((left, right) => left.name.localeCompare(right.name));
      for (const entry of entries) {
        if (files.length >= limit) {
          return;
        }
        const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
        const absolutePath = path.join(absoluteDir, entry.name);
        const stat = fs.statSync(absolutePath);
        if ((entry.isDirectory() && includeDirectories) || (entry.isFile() && includeFiles) || (!entry.isDirectory() && !entry.isFile())) {
          files.push(fileMetadataFromStat({
            workspaceId: access.workspace.workspaceId,
            relativePath,
            absolutePath,
            stat,
            includeHash
          }));
        }
        if (entry.isDirectory() && recursive) {
          visit(absolutePath, relativePath);
        }
      }
    };
    const baseStat = fs.statSync(base.absolutePath);
    if (baseStat.isDirectory()) {
      visit(base.absolutePath, base.relativePath);
    } else if (includeFiles) {
      files.push(fileMetadataFromStat({
        workspaceId: access.workspace.workspaceId,
        relativePath: base.relativePath,
        absolutePath: base.absolutePath,
        stat: baseStat,
        includeHash
      }));
    }
    return {
      protocolVersion: AGENT_WORKSPACE_PROTOCOL_VERSION,
      ok: true,
      workspaceId: access.workspace.workspaceId,
      basePath: base.relativePath,
      exists: true,
      cacheReceipt: await workspaceListCacheReceipt(access.workspace, base.relativePath),
      accessReceipt: createAccessReceipt({
        workspaceId: access.workspace.workspaceId,
        operationId: input.operationId || "agent_workspaces.files.list",
        path: base.relativePath || "/",
        action: "workspace.list"
      }),
      paths: files.map((file) => file.relativePath),
      files,
      count: files.length
    };
  }

  async function workspaceFileMetadata(input = {}) {
    const access = workspaceForStorage(input);
    if (!access.ok) {
      return access;
    }
    let resolved;
    try {
      resolved = resolveWorkspacePath(
        access.workspace,
        input.path || input.relativePath || input.filePath || input.file || "",
        { allowEmpty: false }
      );
    } catch (error) {
      return { ok: false, status: 400, error: error.message };
    }
    if (!fs.existsSync(resolved.absolutePath)) {
      return {
        protocolVersion: AGENT_WORKSPACE_PROTOCOL_VERSION,
        ok: true,
        workspaceId: access.workspace.workspaceId,
        exists: false,
        cacheReceipt: await workspaceDownloadCacheReceipt(access.workspace, resolved.relativePath),
        file: {
          workspaceId: access.workspace.workspaceId,
          relativePath: resolved.relativePath
        }
      };
    }
    return {
      protocolVersion: AGENT_WORKSPACE_PROTOCOL_VERSION,
      ok: true,
      workspaceId: access.workspace.workspaceId,
      exists: true,
      cacheReceipt: await workspaceDownloadCacheReceipt(access.workspace, resolved.relativePath),
      file: fileMetadataFromStat({
        workspaceId: access.workspace.workspaceId,
        relativePath: resolved.relativePath,
        absolutePath: resolved.absolutePath,
        stat: fs.statSync(resolved.absolutePath),
        includeHash: input.includeHash !== false
      })
    };
  }

  function sessionWorkspaceSummary(workspaceId) {
    const workspace = hydrateWorkspace(selectWorkspaceRawStmt.get(String(workspaceId || "")));
    return workspace
      ? {
          workspaceId: workspace.workspaceId,
          title: workspace.title,
          currentGeneration: workspace.currentGeneration
        }
      : null;
  }

  function sessionListItem(session, options = {}) {
    const lastEvent = options.includeLastEvent === false || !session.lastEventId
      ? null
      : hydrateSessionEvent(selectSessionEventStmt.get(session.lastEventId));
    return {
      ...session,
      workspace: sessionWorkspaceSummary(session.workspaceId),
      lastEvent: lastEvent ? compactSessionEvent(lastEvent) : null
    };
  }

  function appendSessionEvent(input = {}) {
    const sessionId = String(input.sessionId || input.session_id || "").trim();
    const current = hydrateSession(selectSessionStmt.get(sessionId));
    if (!current) {
      return null;
    }
    if (!canAccessWorkspaceId(current.workspaceId, input)) {
      return null;
    }
    const timestamp = input.createdAt || nowIso();
    const sequence = Number(selectMaxSessionSequenceStmt.get(sessionId)?.sequence || 0) + 1;
    const type = normalizeText(input.type || input.eventType || input.event_type || "session_event") || "session_event";
    const title = normalizeText(input.title || type).slice(0, 300);
    const summary = truncateText(input.summary || input.description || title, 2000);
    const parentEventId = String(input.parentEventId || input.parent_event_id || current.lastEventId || "").trim();
    const payload = {
      ...asObject(input.payload),
      appendOnly: true
    };
    const eventId =
      String(input.eventId || input.event_id || "").trim() ||
      stableId("session_event", sessionId, type, title, summary, sequence, timestamp);
    insertSessionEventStmt.run(
      eventId,
      sessionId,
      current.workspaceId,
      parentEventId,
      type,
      title,
      summary,
      stringifyJson(payload),
      String(input.createdBy || input.actorUserId || input.agentId || "").trim(),
      timestamp,
      sequence
    );
    updateSessionStatsStmt.run(eventId, sequence, timestamp, sessionId);
    updateWorkspaceTimeStmt.run(timestamp, current.workspaceId);
    return {
      protocolVersion: AGENT_WORKSPACE_PROTOCOL_VERSION,
      sessionProtocolVersion: AGENT_SESSION_THREAD_VERSION,
      session: hydrateSession(selectSessionStmt.get(sessionId)),
      event: hydrateSessionEvent(selectSessionEventStmt.get(eventId))
    };
  }

  function insertSessionRecord(input = {}) {
    const timestamp = input.createdAt || nowIso();
    const workspaceId = String(input.workspaceId || input.workspace_id || "").trim();
    const sessionId =
      String(input.sessionId || input.session_id || "").trim() ||
      stableId("session", workspaceId, input.title || "", input.parentSessionId || "", timestamp);
    insertSessionStmt.run(
      sessionId,
      workspaceId,
      normalizeText(input.title || "工作会话") || "工作会话",
      normalizeText(input.objective || "").slice(0, 2000),
      String(input.status || "active").trim() || "active",
      String(input.parentSessionId || input.parent_session_id || "").trim(),
      String(input.forkedFromEventId || input.forked_from_event_id || "").trim(),
      Number(input.branchIndex || input.branch_index || 0),
      stringifyJson(asArray(input.lineage), []),
      stringifyJson(asObject(input.context), {}),
      stringifyJson(asObject(input.metadata), {}),
      String(input.createdBy || input.actorUserId || input.agentId || "").trim(),
      timestamp,
      input.updatedAt || timestamp,
      String(input.lastEventId || "").trim(),
      Number(input.eventCount || 0),
      1
    );
    return hydrateSession(selectSessionStmt.get(sessionId));
  }

  function createSession(input = {}) {
    const workspaceId = String(input.workspaceId || input.workspace_id || "").trim();
    const workspace = hydrateWorkspace(selectWorkspaceRawStmt.get(workspaceId));
    if (!workspace) {
      return { ok: false, error: "工作空间不存在" };
    }
    if (!canAccessWorkspace(workspace, input)) {
      return { ok: false, error: "工作空间不可访问" };
    }
    const session = insertSessionRecord({
      ...input,
      workspaceId,
      context: {
        workspaceId,
        ...asObject(input.context)
      },
      metadata: {
        ...asObject(input.metadata),
        appendOnly: true
      }
    });
    let event = null;
    if (input.initialEvent !== false) {
      const result = appendSessionEvent({
        ...input,
        sessionId: session.sessionId,
        type: input.initialEventType || "session_created",
        title: "会话创建",
        summary: input.objective || session.objective || session.title,
        payload: {
          workspaceId,
          parentSessionId: session.parentSessionId,
          forkedFromEventId: session.forkedFromEventId
        }
      });
      event = result?.event || null;
    }
    return {
      ok: true,
      protocolVersion: AGENT_WORKSPACE_PROTOCOL_VERSION,
      sessionProtocolVersion: AGENT_SESSION_THREAD_VERSION,
      session: hydrateSession(selectSessionStmt.get(session.sessionId)),
      event
    };
  }

  function ensureRootSessionForWorkspace(workspace) {
    if (!workspace?.workspaceId) {
      return null;
    }
    const existing = hydrateSession(selectWorkspaceRootSessionStmt.get(workspace.workspaceId));
    if (existing) {
      return existing;
    }
    const timestamp = workspace.createdAt || nowIso();
    const result = createSession({
      sessionId: stableId("session", workspace.workspaceId, "root"),
      workspaceId: workspace.workspaceId,
      title: `${workspace.title || workspace.workspaceId} / 主会话`,
      objective: workspace.objective || "",
      actorUserId: workspace.ownerUserId || "",
      userId: workspace.ownerUserId || "",
      createdBy: workspace.ownerUserId || "",
      createdAt: timestamp,
      metadata: {
        rootSession: true,
        generatedFromWorkspace: true
      }
    });
    return result.session || null;
  }

  function ensureRootSessionsForVisibleWorkspaces(input = {}) {
    if (input.ensureRoots === false || input.seedRoots === false) {
      return;
    }
    const workspaceRows = db.prepare("SELECT * FROM aw_workspaces ORDER BY updated_at DESC LIMIT 500").all();
    for (const workspace of workspaceRows.map(hydrateWorkspace)) {
      if (canAccessWorkspace(workspace, input)) {
        ensureRootSessionForWorkspace(workspace);
      }
    }
  }

  function listSessions(input = {}) {
    ensureRootSessionsForVisibleWorkspaces(input);
    const limit = Math.max(1, Math.min(Number(input.limit || 100), 500));
    const status = String(input.status || "").trim();
    const workspaceId = String(input.workspaceId || input.workspace_id || "").trim();
    let rows;
    if (workspaceId && status) {
      rows = listSessionsByWorkspaceStatusStmt.all(workspaceId, status, limit);
    } else if (workspaceId) {
      rows = listSessionsByWorkspaceStmt.all(workspaceId, limit);
    } else if (status) {
      rows = listSessionsByStatusStmt.all(status, limit);
    } else {
      rows = listSessionsStmt.all(limit);
    }
    const sessions = rows
      .map(hydrateSession)
      .filter((session) => canAccessWorkspaceId(session.workspaceId, input))
      .map((session) => sessionListItem(session, { includeLastEvent: input.includeLastEvent !== false }));
    return {
      protocolVersion: AGENT_WORKSPACE_PROTOCOL_VERSION,
      sessionProtocolVersion: AGENT_SESSION_THREAD_VERSION,
      sharingMode: "team-shared",
      appendOnly: true,
      sessions,
      count: sessions.length
    };
  }

  function getSession(input = {}) {
    const sessionId = typeof input === "string" ? input : String(input.sessionId || input.session_id || "").trim();
    const options = typeof input === "string" ? {} : input;
    const session = hydrateSession(selectSessionStmt.get(sessionId));
    if (!session || !canAccessWorkspaceId(session.workspaceId, options)) {
      return null;
    }
    const limit = Math.max(1, Math.min(Number(options.eventLimit || options.limit || 200), 1000));
    const includeEvents = options.includeEvents !== false;
    const workspace = hydrateWorkspace(selectWorkspaceRawStmt.get(session.workspaceId));
    return {
      protocolVersion: AGENT_WORKSPACE_PROTOCOL_VERSION,
      sessionProtocolVersion: AGENT_SESSION_THREAD_VERSION,
      appendOnly: true,
      session: sessionListItem(session),
      workspace: workspace ? compactWorkspaceLayer(workspace) : null,
      events: includeEvents
        ? selectSessionEventsStmt.all(session.sessionId, limit).map(hydrateSessionEvent)
        : []
    };
  }

  function cloneSessionEvents({ sourceSessionId, targetSessionId, cutoffSequence }) {
    const sourceRows = selectSessionEventsUntilStmt.all(sourceSessionId, cutoffSequence);
    const idMap = new Map();
    for (const row of sourceRows) {
      idMap.set(row.event_id, stableId("session_event", targetSessionId, row.event_id, row.sequence));
    }
    for (const row of sourceRows) {
      const payload = parseJson(row.payload_json, {});
      insertSessionEventStmt.run(
        idMap.get(row.event_id),
        targetSessionId,
        row.workspace_id,
        idMap.get(row.parent_event_id) || "",
        row.event_type,
        row.title,
        row.summary,
        stringifyJson({
          ...payload,
          clonedFromEventId: row.event_id,
          clonedFromSessionId: sourceSessionId
        }),
        row.created_by,
        row.created_at,
        row.sequence
      );
    }
    return {
      rows: sourceRows.length,
      lastEventId: sourceRows.length ? idMap.get(sourceRows[sourceRows.length - 1].event_id) : ""
    };
  }

  const forkSessionTx = db.transaction((input = {}) => {
    const sourceId = String(input.sessionId || input.sourceSessionId || input.session_id || "").trim();
    const source = hydrateSession(selectSessionStmt.get(sourceId));
    if (!source) {
      return { ok: false, error: "会话不存在" };
    }
    if (!canAccessWorkspaceId(source.workspaceId, input)) {
      return { ok: false, error: "工作空间不可访问" };
    }
    const forkSourceEventId = String(input.fromEventId || input.forkedFromEventId || source.lastEventId || "").trim();
    const sourceEvent = forkSourceEventId
      ? hydrateSessionEvent(selectSessionEventStmt.get(forkSourceEventId))
      : hydrateSessionEvent(selectLastSessionEventStmt.get(source.sessionId));
    if (forkSourceEventId && (!sourceEvent || sourceEvent.sessionId !== source.sessionId)) {
      return { ok: false, error: "分叉事件不属于该会话" };
    }
    const cutoffSequence = sourceEvent?.sequence || Number(selectMaxSessionSequenceStmt.get(source.sessionId)?.sequence || 0);
    const branchIndex = Number(countChildSessionsStmt.get(source.sessionId)?.count || 0) + 1;
    const timestamp = nowIso();
    const nextSession = insertSessionRecord({
      sessionId: input.newSessionId || input.targetSessionId || stableId("session", source.sessionId, cutoffSequence, branchIndex, timestamp),
      workspaceId: source.workspaceId,
      title: input.title || `${source.title} / 分叉 ${branchIndex}`,
      objective: input.objective || source.objective,
      status: "active",
      parentSessionId: source.sessionId,
      forkedFromEventId: sourceEvent?.eventId || "",
      branchIndex,
      lineage: [...asArray(source.lineage), source.sessionId],
      context: {
        ...asObject(source.context),
        ...asObject(input.context)
      },
      metadata: {
        ...asObject(source.metadata),
        ...asObject(input.metadata),
        appendOnly: true,
        forkedFromSessionId: source.sessionId,
        forkedFromEventId: sourceEvent?.eventId || "",
        forkedAt: timestamp
      },
      createdBy: input.createdBy || input.actorUserId || "",
      createdAt: timestamp,
      updatedAt: timestamp,
      eventCount: 0,
      lastEventId: ""
    });
    const clone = cloneSessionEvents({
      sourceSessionId: source.sessionId,
      targetSessionId: nextSession.sessionId,
      cutoffSequence
    });
    updateSessionStatsStmt.run(clone.lastEventId, clone.rows, timestamp, nextSession.sessionId);
    const forkEvent = appendSessionEvent({
      ...input,
      sessionId: nextSession.sessionId,
      type: "session_forked",
      title: "会话分叉",
      summary: `从 ${source.title || source.sessionId} 分叉`,
      parentEventId: clone.lastEventId,
      payload: {
        sourceSessionId: source.sessionId,
        sourceEventId: sourceEvent?.eventId || "",
        copiedEventCount: clone.rows,
        branchIndex
      }
    })?.event;
    return {
      ok: true,
      protocolVersion: AGENT_WORKSPACE_PROTOCOL_VERSION,
      sessionProtocolVersion: AGENT_SESSION_THREAD_VERSION,
      appendOnly: true,
      sourceSession: source,
      session: hydrateSession(selectSessionStmt.get(nextSession.sessionId)),
      event: forkEvent,
      fork: {
        parentSessionId: source.sessionId,
        forkedFromEventId: sourceEvent?.eventId || "",
        copiedEventCount: clone.rows,
        branchIndex
      }
    };
  });

  function forkSession(input = {}) {
    return forkSessionTx(input);
  }

  function sessionEventCompareKey(event = {}) {
    const payload = asObject(event.payload);
    const clonedFromEventId = String(payload.clonedFromEventId || "").trim();
    if (clonedFromEventId) {
      return `event:${clonedFromEventId}`;
    }
    if (event.eventId) {
      return `event:${event.eventId}`;
    }
    return stableId(
      "session_event_key",
      event.type,
      event.title,
      event.summary,
      stableJson(payload)
    );
  }

  function sessionEventConflictTarget(event = {}) {
    const payload = asObject(event.payload);
    return String(
      payload.targetId ||
        payload.artifactId ||
        payload.assetId ||
        payload.documentId ||
        payload.submissionId ||
        payload.decisionId ||
        payload.path ||
        ""
    ).trim();
  }

  function sessionEventPublicDiff(event = {}) {
    return {
      eventId: event.eventId,
      sequence: event.sequence,
      type: event.type,
      title: event.title,
      summary: truncateText(event.summary, 600),
      targetId: sessionEventConflictTarget(event),
      createdBy: event.createdBy || "",
      createdAt: event.createdAt || ""
    };
  }

  function compareSessions(input = {}) {
    const leftSessionId = String(input.leftSessionId || input.sessionId || input.sourceSessionId || "").trim();
    const rightSessionId = String(input.rightSessionId || input.targetSessionId || input.compareWithSessionId || "").trim();
    const left = hydrateSession(selectSessionStmt.get(leftSessionId));
    const right = hydrateSession(selectSessionStmt.get(rightSessionId));
    if (!left || !right) {
      return { ok: false, error: "会话不存在" };
    }
    if (!canAccessWorkspaceId(left.workspaceId, input) || !canAccessWorkspaceId(right.workspaceId, input)) {
      return { ok: false, error: "工作空间不可访问" };
    }
    const leftEvents = selectSessionEventsStmt.all(left.sessionId, 5000).map(hydrateSessionEvent);
    const rightEvents = selectSessionEventsStmt.all(right.sessionId, 5000).map(hydrateSessionEvent);
    const leftByKey = new Map(leftEvents.map((event) => [sessionEventCompareKey(event), event]));
    const rightByKey = new Map(rightEvents.map((event) => [sessionEventCompareKey(event), event]));
    const commonKeys = [...leftByKey.keys()].filter((key) => rightByKey.has(key));
    const leftOnly = leftEvents.filter((event) => !rightByKey.has(sessionEventCompareKey(event)));
    const rightOnly = rightEvents.filter((event) => !leftByKey.has(sessionEventCompareKey(event)));
    const rightOnlyByTarget = new Map();
    for (const event of rightOnly) {
      const target = sessionEventConflictTarget(event);
      if (target) {
        rightOnlyByTarget.set(target, event);
      }
    }
    const conflicts = [];
    for (const event of leftOnly) {
      const target = sessionEventConflictTarget(event);
      if (!target || !rightOnlyByTarget.has(target)) {
        continue;
      }
      const other = rightOnlyByTarget.get(target);
      if (stableJson(event.payload) !== stableJson(other.payload) || event.summary !== other.summary || event.type !== other.type) {
        conflicts.push({
          targetId: target,
          left: sessionEventPublicDiff(event),
          right: sessionEventPublicDiff(other),
          resolution: "merge_proposal_required"
        });
      }
    }
    const maxLen = Math.max(leftEvents.length, rightEvents.length);
    let divergence = null;
    for (let index = 0; index < maxLen; index += 1) {
      const leftKey = leftEvents[index] ? sessionEventCompareKey(leftEvents[index]) : "";
      const rightKey = rightEvents[index] ? sessionEventCompareKey(rightEvents[index]) : "";
      if (leftKey !== rightKey) {
        divergence = {
          leftSequence: leftEvents[index]?.sequence || 0,
          rightSequence: rightEvents[index]?.sequence || 0,
          leftEventId: leftEvents[index]?.eventId || "",
          rightEventId: rightEvents[index]?.eventId || ""
        };
        break;
      }
    }
    return {
      ok: true,
      protocolVersion: AGENT_WORKSPACE_PROTOCOL_VERSION,
      sessionProtocolVersion: AGENT_SESSION_THREAD_VERSION,
      comparisonId: stableId("session_compare", left.sessionId, left.lastEventId, right.sessionId, right.lastEventId),
      appendOnly: true,
      leftSession: sessionListItem(left),
      rightSession: sessionListItem(right),
      summary: {
        commonEventCount: commonKeys.length,
        leftOnlyCount: leftOnly.length,
        rightOnlyCount: rightOnly.length,
        conflictCount: conflicts.length,
        divergence
      },
      leftOnly: leftOnly.map(sessionEventPublicDiff),
      rightOnly: rightOnly.map(sessionEventPublicDiff),
      conflicts
    };
  }

  function createSessionMergeProposal(input = {}) {
    const targetSessionId = String(input.targetSessionId || input.sessionId || input.leftSessionId || "").trim();
    const sourceSessionId = String(input.sourceSessionId || input.rightSessionId || input.mergeFromSessionId || "").trim();
    const comparison = compareSessions({
      ...input,
      leftSessionId: targetSessionId,
      rightSessionId: sourceSessionId
    });
    if (!comparison.ok) {
      return comparison;
    }
    const proposalId = stableId(
      "session_merge_proposal",
      targetSessionId,
      sourceSessionId,
      comparison.comparisonId,
      stableJson(input.resolutionHints || {})
    );
    const eventResult = appendSessionEvent({
      ...input,
      sessionId: targetSessionId,
      type: "session_merge_proposal",
      title: input.title || "会话合并提案",
      summary: input.summary || `提议将 ${sourceSessionId} 合并到 ${targetSessionId}`,
      payload: {
        proposalId,
        targetSessionId,
        sourceSessionId,
        comparisonId: comparison.comparisonId,
        conflictCount: comparison.summary.conflictCount,
        leftOnlyCount: comparison.summary.leftOnlyCount,
        rightOnlyCount: comparison.summary.rightOnlyCount,
        conflicts: comparison.conflicts,
        resolutionHints: asObject(input.resolutionHints),
        autoMergeApplied: false,
        requiresDecision: true
      }
    });
    return {
      ok: true,
      protocolVersion: AGENT_WORKSPACE_PROTOCOL_VERSION,
      sessionProtocolVersion: AGENT_SESSION_THREAD_VERSION,
      appendOnly: true,
      proposal: {
        proposalId,
        targetSessionId,
        sourceSessionId,
        status: "proposed",
        autoMergeApplied: false,
        requiresDecision: true,
        conflictCount: comparison.summary.conflictCount
      },
      comparison,
      event: eventResult?.event || null,
      session: eventResult?.session || null
    };
  }

  function archiveSession(input = {}) {
    const sessionId = String(input.sessionId || input.session_id || "").trim();
    const session = hydrateSession(selectSessionStmt.get(sessionId));
    if (!session) {
      return { ok: false, error: "会话不存在" };
    }
    if (!canAccessWorkspaceId(session.workspaceId, input)) {
      return { ok: false, error: "工作空间不可访问" };
    }
    const eventResult = appendSessionEvent({
      ...input,
      sessionId,
      type: "session_archived",
      title: input.title || "会话归档",
      summary: input.summary || input.reason || "会话已归档。",
      payload: {
        reason: String(input.reason || "").trim(),
        archivedPreviousStatus: session.status,
        appendOnly: true
      }
    });
    const timestamp = nowIso();
    updateSessionStatusStmt.run("archived", timestamp, sessionId);
    updateWorkspaceTimeStmt.run(timestamp, session.workspaceId);
    return {
      ok: true,
      protocolVersion: AGENT_WORKSPACE_PROTOCOL_VERSION,
      sessionProtocolVersion: AGENT_SESSION_THREAD_VERSION,
      appendOnly: true,
      session: hydrateSession(selectSessionStmt.get(sessionId)),
      event: eventResult?.event || null
    };
  }

  function listWorkspaces(input = {}) {
    const limit = Math.max(1, Math.min(Number(input.limit || 50), 500));
    const status = String(input.status || "").trim();
    const includeSummary = input.includeSummary !== false;
    const rows = status
      ? listWorkspacesByStatusStmt.all(status, limit)
      : listWorkspacesStmt.all(limit);
    const access = workspaceAccess(input);
    const workspaces = rows.map(hydrateWorkspace).filter((workspace) => canAccessWorkspace(workspace, input));
    return {
      protocolVersion: AGENT_WORKSPACE_PROTOCOL_VERSION,
      sharingMode: access.sharingMode,
      workspaces: workspaces.map((workspace) => ({
        ...workspace,
        summary: includeSummary ? workspaceSummary(workspace.workspaceId) : undefined
      })),
      count: workspaces.length
    };
  }

  function createWorkspace(input = {}) {
    const timestamp = nowIso();
    const workspaceId =
      String(input.workspaceId || "").trim() ||
      stableId("workspace", input.title || "", input.objective || "", timestamp);
    const fsPath = path.join(rootPath, "folders", workspaceId);
    fs.mkdirSync(fsPath, { recursive: true });
    const ownerUserId = String(
      input.ownerUserId || input.owner_user_id || input.userId || input.actorUserId || input.subjectId || input.username || ""
    ).trim();
    const defaultAdminUserId = String(input.defaultAdminUserId || input.adminUserId || ownerUserId || "").trim();
    const inputMetadata = asObject(input.metadata);
    const workspace = {
      workspaceId,
      title: normalizeText(input.title || "Knowledge Agent Workspace") || "Knowledge Agent Workspace",
      objective: normalizeText(input.objective || input.query || ""),
      status: String(input.status || "active"),
      ownerUserId,
      metadata: {
        ...inputMetadata,
        defaultAdminUserId,
        adminUserIds: uniqueStrings([
          ...asArray(inputMetadata.adminUserIds),
          ...asArray(inputMetadata.administrators),
          defaultAdminUserId
        ])
      },
      createdAt: input.createdAt || timestamp,
      updatedAt: timestamp,
      fsPath
    };
    insertWorkspaceStmt.run(
      workspace.workspaceId,
      workspace.title,
      workspace.objective,
      workspace.status,
      workspace.ownerUserId,
      stringifyJson(workspace.metadata),
      workspace.createdAt,
      workspace.updatedAt,
      workspace.fsPath
    );
    // Re-read from DB to capture new columns (profile, ownedSourceIds, etc.)
    const persisted = hydrateWorkspace(selectWorkspaceStmt.get(workspace.workspaceId)) || workspace;
    ensureRootSessionForWorkspace(persisted);
    return {
      protocolVersion: AGENT_WORKSPACE_PROTOCOL_VERSION,
      workspace: persisted
    };
  }

  function migrateOwnerlessWorkspaces(owner = {}) {
    const ownerUserId = String(owner.userId || owner.subjectId || owner.username || "").trim();
    if (!ownerUserId) {
      return {
        protocolVersion: AGENT_WORKSPACE_PROTOCOL_VERSION,
        ok: false,
        migratedCount: 0,
        error: "owner_user_id_required"
      };
    }
    const ownerUsername = String(owner.username || ownerUserId).trim();
    const rows = db.prepare("SELECT * FROM aw_workspaces WHERE owner_user_id = '' OR owner_user_id IS NULL").all();
    const timestamp = nowIso();
    let migratedCount = 0;
    db.transaction(() => {
      for (const row of rows) {
        const metadata = asObject(parseJson(row.metadata_json, {}));
        const adminUserIds = uniqueStrings([
          ...asArray(metadata.adminUserIds),
          ...asArray(metadata.administrators),
          metadata.defaultAdminUserId,
          ownerUserId,
          ownerUsername
        ]);
        updateWorkspaceOwnerStmt.run(
          ownerUserId,
          stringifyJson({
            ...metadata,
            ownerUserId,
            ownerUsername,
            defaultAdminUserId: metadata.defaultAdminUserId || ownerUserId,
            adminUserIds
          }),
          timestamp,
          row.workspace_id
        );
        migratedCount += 1;
      }
    })();
    return {
      protocolVersion: AGENT_WORKSPACE_PROTOCOL_VERSION,
      ok: true,
      migratedCount,
      ownerUserId
    };
  }

  function createRun(input = {}) {
    const timestamp = nowIso();
    const runId = String(input.runId || "").trim() || stableId("run", input.workspaceId || "", input.runType || "", timestamp);
    const run = {
      runId,
      workspaceId: String(input.workspaceId || ""),
      runType: String(input.runType || "multi_agent"),
      status: String(input.status || "queued"),
      input: asObject(input.input),
      steps: asArray(input.steps),
      coverage: asObject(input.coverage),
      artifactIds: asArray(input.artifactIds),
      error: String(input.error || ""),
      degraded: input.degraded === true,
      createdAt: input.createdAt || timestamp,
      updatedAt: timestamp,
      startedAt: input.startedAt || "",
      completedAt: input.completedAt || ""
    };
    insertRunStmt.run(
      run.runId,
      run.workspaceId,
      run.runType,
      run.status,
      stringifyJson(run.input),
      stringifyJson(run.steps, []),
      stringifyJson(run.coverage),
      stringifyJson(run.artifactIds, []),
      run.error,
      run.degraded ? 1 : 0,
      run.createdAt,
      run.updatedAt,
      run.startedAt,
      run.completedAt
    );
    updateWorkspaceTimeStmt.run(timestamp, run.workspaceId);
    return {
      protocolVersion: AGENT_WORKSPACE_PROTOCOL_VERSION,
      run
    };
  }

  function updateRun(runId, patch = {}) {
    const current = hydrateRun(selectRunStmt.get(String(runId || "")));
    if (!current) {
      return null;
    }
    const timestamp = nowIso();
    const next = {
      ...current,
      ...patch,
      input: patch.input === undefined ? current.input : patch.input,
      steps: patch.steps === undefined ? current.steps : patch.steps,
      coverage: patch.coverage === undefined ? current.coverage : patch.coverage,
      artifactIds: patch.artifactIds === undefined ? current.artifactIds : patch.artifactIds,
      degraded: patch.degraded === undefined ? current.degraded : patch.degraded === true,
      updatedAt: timestamp
    };
    insertRunStmt.run(
      next.runId,
      next.workspaceId,
      next.runType,
      next.status,
      stringifyJson(next.input),
      stringifyJson(next.steps, []),
      stringifyJson(next.coverage),
      stringifyJson(next.artifactIds, []),
      next.error || "",
      next.degraded ? 1 : 0,
      next.createdAt,
      next.updatedAt,
      next.startedAt || "",
      next.completedAt || ""
    );
    updateWorkspaceTimeStmt.run(timestamp, next.workspaceId);
    return {
      protocolVersion: AGENT_WORKSPACE_PROTOCOL_VERSION,
      run: next
    };
  }

  function getRun(runId) {
    return hydrateRun(selectRunStmt.get(String(runId || "")));
  }

  function savePrivateState(input = {}) {
    const timestamp = nowIso();
    const id = stableId(
      "private",
      input.workspaceId || "",
      input.runId || "",
      input.agentId || ""
    );
    insertPrivateStmt.run(
      id,
      String(input.workspaceId || ""),
      String(input.runId || ""),
      String(input.agentId || ""),
      normalizeText(input.summary || "").slice(0, 4000),
      stringifyJson(asObject(input.state)),
      timestamp
    );
    updateWorkspaceTimeStmt.run(timestamp, String(input.workspaceId || ""));
    return hydratePrivateState(db.prepare("SELECT * FROM aw_private_state WHERE id = ?").get(id));
  }

  function submit(input = {}) {
    const payload = asObject(input.payload);
    const type = String(input.type || payload.type || "").trim();
    const evidenceRefs = normalizeEvidenceRefs(input.evidenceRefs, payload);
    const duplicateKey = stableHash(
      type,
      submissionSummary(type, payload).toLowerCase(),
      evidenceRefs.join("|")
    );
    const existingDuplicate = selectDuplicateStmt.get(
      String(input.workspaceId || ""),
      type,
      duplicateKey
    );
    const gate = gateSubmission({
      existingDuplicate,
      submission: {
        type,
        payload,
        evidenceRefs,
        confidence: input.confidence ?? payload.confidence
      },
      writePolicy: asObject(input.writePolicy)
    });
    const timestamp = nowIso();
    const submissionId =
      String(input.submissionId || "").trim() ||
      stableId("submission", input.workspaceId || "", input.runId || "", input.agentId || "", type, duplicateKey, timestamp);
    insertSubmissionStmt.run(
      submissionId,
      String(input.workspaceId || ""),
      String(input.runId || ""),
      String(input.agentId || ""),
      type,
      gate.status,
      gate.confidence,
      duplicateKey,
      stringifyJson(payload),
      stringifyJson(gate.evidenceRefs, []),
      stringifyJson(gate),
      timestamp,
      timestamp
    );
    updateWorkspaceTimeStmt.run(timestamp, String(input.workspaceId || ""));
    return {
      protocolVersion: AGENT_WORKSPACE_PROTOCOL_VERSION,
      submission: hydrateSubmission(db.prepare("SELECT * FROM aw_submissions WHERE submission_id = ?").get(submissionId))
    };
  }

  function resolveSubmission(input = {}) {
    const submissionId = String(input.submissionId || "").trim();
    const current = hydrateSubmission(selectSubmissionStmt.get(submissionId));
    if (!current) {
      return null;
    }
    if (input.workspaceId && current.workspaceId !== String(input.workspaceId)) {
      return null;
    }
    if (!canAccessWorkspaceId(current.workspaceId, input)) {
      return null;
    }
    const allowed = new Set(["accepted", "rejected", "needs_review", "proposed"]);
    const rawStatus = String(input.status || input.action || "").trim();
    const rawResolution = String(input.resolution || "").trim();
    const normalizedDecision = (rawStatus || rawResolution).toLowerCase();
    const status = allowed.has(rawStatus)
      ? rawStatus
      : ["accept", "accepted", "approve", "approved"].includes(normalizedDecision)
        ? "accepted"
        : ["reject", "rejected", "deny", "denied"].includes(normalizedDecision)
          ? "rejected"
          : "needs_review";
    const timestamp = nowIso();
    const gate = {
      ...(current.gate || {}),
      reviewedRequired: status === "needs_review",
      resolvedBy: String(input.reviewerId || input.agentId || input.clientId || ""),
      resolvedAt: timestamp,
      resolutionNote: normalizeText(input.note || input.reason || "").slice(0, 1000),
      previousStatus: current.status
    };
    updateSubmissionStatusStmt.run(status, stringifyJson(gate), timestamp, submissionId);
    updateWorkspaceTimeStmt.run(timestamp, current.workspaceId);
    return {
      protocolVersion: AGENT_WORKSPACE_PROTOCOL_VERSION,
      submission: hydrateSubmission(selectSubmissionStmt.get(submissionId))
    };
  }

  function createArtifact(input = {}) {
    const timestamp = nowIso();
    const runId = String(input.runId || "");
    const artifactId =
      String(input.artifactId || "").trim() ||
      stableId("artifact", input.workspaceId || "", runId, input.level || "", input.title || "", timestamp);
    const current = db.prepare("SELECT * FROM aw_artifacts WHERE artifact_id = ?").get(artifactId);
    const revision = current ? Number(current.revision || 1) + 1 : Number(input.revision || 1);
    insertArtifactStmt.run(
      artifactId,
      String(input.workspaceId || ""),
      runId,
      String(input.level || "Artifact"),
      normalizeText(input.title || "Untitled Artifact") || "Untitled Artifact",
      String(input.content || ""),
      stringifyJson(asArray(input.citations), []),
      stringifyJson(asObject(input.coverageReport || input.coverage), {}),
      revision,
      String(input.status || "draft"),
      String(input.createdBy || input.agentId || ""),
      input.createdAt || timestamp,
      timestamp
    );
    const run = getRun(runId);
    if (run) {
      updateRun(runId, {
        artifactIds: [...new Set([...run.artifactIds, artifactId])]
      });
    }
    return {
      protocolVersion: AGENT_WORKSPACE_PROTOCOL_VERSION,
      artifact: hydrateArtifact(db.prepare("SELECT * FROM aw_artifacts WHERE artifact_id = ?").get(artifactId))
    };
  }

  async function uploadWorkspaceFile(input = {}) {
    const access = workspaceForStorage(input);
    if (!access.ok) {
      return access;
    }
    const fileName = String(input.fileName || input.filename || input.name || "").trim();
    const explicitPath = String(input.path || input.relativePath || input.filePath || input.targetPath || "").trim();
    if (!fileName && !explicitPath) {
      return { ok: false, status: 400, error: "fileName 不能为空。" };
    }
    const resolvedName = explicitPath ? path.posix.basename(explicitPath) : fileName;
    if (resolvedName.startsWith(".")) {
      return { ok: false, status: 400, error: "不允许上传以 . 开头的文件。" };
    }
    let contentBuffer;
    try {
      contentBuffer = decodeWorkspaceFileContent(input);
    } catch (error) {
      return { ok: false, status: 400, error: error.message };
    }
    let resolved;
    try {
      const relativePath = explicitPath
        ? normalizeWorkspaceRelativePath(explicitPath, { allowEmpty: false })
        : joinWorkspaceRelativePath(input.folderPath || input.folder || input.directory || "files", fileName);
      resolved = resolveWorkspacePath(access.workspace, relativePath);
    } catch (error) {
      return { ok: false, status: 400, error: error.message };
    }
    if (fs.existsSync(resolved.absolutePath) && fs.statSync(resolved.absolutePath).isDirectory()) {
      return { ok: false, status: 409, error: "目标路径是文件夹，不能上传为文件。" };
    }
    const overwritten = fs.existsSync(resolved.absolutePath);
    if (overwritten && input.overwrite === false) {
      return { ok: false, status: 409, error: "文件已存在。" };
    }
    fs.mkdirSync(path.dirname(resolved.absolutePath), { recursive: true });
    fs.writeFileSync(resolved.absolutePath, contentBuffer);
    updateWorkspaceTimeStmt.run(nowIso(), access.workspace.workspaceId);
    const artifact = createArtifact({
      workspaceId: access.workspace.workspaceId,
      level: String(input.level || "artifact"),
      title: fileName || path.posix.basename(resolved.relativePath),
      content: contentBuffer.toString(String(input.encoding || "utf8")),
      status: String(input.status || "draft"),
      createdBy: input.createdBy || input.actorUserId || input.agentId || "",
      artifactId: input.artifactId,
      runId: input.runId || "",
      citations: input.citations,
      revision: input.revision,
      createdAt: input.createdAt,
      coverageReport: {
        ...(asObject(input.coverageReport || input.coverage)),
        workspaceFilePath: resolved.relativePath
      }
    }).artifact;
    const file = fileMetadataFromStat({
      workspaceId: access.workspace.workspaceId,
      relativePath: resolved.relativePath,
      absolutePath: resolved.absolutePath,
      stat: fs.statSync(resolved.absolutePath),
      includeHash: true
    });
    const ingestReceipt = await recordWorkspaceUploadIngest({
      workspace: access.workspace,
      relativePath: resolved.relativePath,
      contentBuffer,
      operationId: input.operationId || "workspace.file.upload"
    });
    const archived = await archiveWorkspacePath(access.workspace, resolved.relativePath, {
      operationId: input.operationId || "workspace.file.upload"
    });
    const stateCommit = await commitWorkspaceFileState({
      workspace: access.workspace,
      operationId: input.operationId || "workspace.file.upload",
      mutations: archived
        ? [{
            action: "put",
            key: resolved.relativePath,
            valueRef: archived.rootCid,
            metadata: filePayloadMetadata(file)
          }]
        : [],
      contentRefs: [
        ...(archived?.contentRefs || []),
        ...(ingestReceipt?.contentRefs || [])
      ],
      payload: {
        action: "file.upload",
        path: resolved.relativePath,
        overwritten,
        sizeBytes: contentBuffer.length,
        contentSha256: file.contentSha256 || "",
        ingestReceipt: ingestReceipt
          ? {
              uploadSessionId: ingestReceipt.uploadSessionId,
              segmentId: ingestReceipt.segmentId,
              manifestRootCid: ingestReceipt.manifestRootCid,
              status: ingestReceipt.status
            }
          : null
      }
    });
    const checkpoint = await recordWorkspaceFileCheckpoint({
      workspace: access.workspace,
      operationId: input.operationId || "workspace.file.upload",
      stateCommit,
      action: "file.upload",
      path: resolved.relativePath
    });
    try {
      getRuntimeLogger().info("agent_workspace.file.upload.completed", {
        workspaceId: access.workspace.workspaceId,
        relativePath: resolved.relativePath,
        absolutePath: resolved.absolutePath,
        absolutePathSha256: stableHash(resolved.absolutePath),
        sizeBytes: contentBuffer.length,
        contentSha256: crypto.createHash("sha256").update(contentBuffer).digest("hex"),
        overwritten,
        artifactId: artifact?.artifactId || "",
        runId: String(input.runId || ""),
        createdBy: String(input.createdBy || input.actorUserId || input.agentId || "")
      });
    } catch {
      // Logging must not turn a completed upload into a failed tool call.
    }
    return {
      protocolVersion: AGENT_WORKSPACE_PROTOCOL_VERSION,
      ok: true,
      workspaceId: access.workspace.workspaceId,
      overwritten,
      stateCommit,
      ingestReceipt,
      checkpoint,
      file,
      artifact
    };
  }

  async function downloadWorkspaceFile(input = {}) {
    const statResult = await workspaceFileMetadata(input);
    if (!statResult.ok || !statResult.exists) {
      return statResult.exists === false
        ? { ...statResult, ok: false, status: 404, error: "文件不存在。" }
        : statResult;
    }
    if (statResult.file.type !== "file") {
      return { ok: false, status: 400, error: "目标路径不是文件。" };
    }
    const access = workspaceForStorage(input);
    if (!access.ok) {
      return access;
    }
    const resolved = resolveWorkspacePath(access.workspace, statResult.file.relativePath);
    const content = fs.readFileSync(resolved.absolutePath);
    const cacheReceipt = await workspaceDownloadCacheReceipt(access.workspace, statResult.file.relativePath);
    return {
      protocolVersion: AGENT_WORKSPACE_PROTOCOL_VERSION,
      ok: true,
      workspaceId: access.workspace.workspaceId,
      file: statResult.file,
      cacheReceipt,
      accessReceipt: createAccessReceipt({
        workspaceId: access.workspace.workspaceId,
        operationId: input.operationId || "workspace.file.read",
        path: statResult.file.relativePath,
        action: "workspace.read"
      }),
      encoding: "base64",
      contentBase64: content.toString("base64"),
      content: input.includeText === false ? undefined : content.toString(String(input.textEncoding || input.encoding || "utf8"))
    };
  }

  async function writeWorkspaceFile(input = {}) {
    const access = workspaceForStorage(input);
    if (!access.ok) {
      return access;
    }
    const explicitPath = String(input.path || input.relativePath || "").trim();
    if (!explicitPath) {
      return { ok: false, status: 400, error: "path 不能为空。" };
    }
    if (path.posix.basename(explicitPath).startsWith(".")) {
      return { ok: false, status: 400, error: "不允许操作以 . 开头的文件。" };
    }
    let contentBuffer;
    try {
      contentBuffer = decodeWorkspaceFileContent(input);
    } catch (error) {
      return { ok: false, status: 400, error: error.message };
    }
    let resolved;
    try {
      resolved = resolveWorkspacePath(access.workspace, normalizeWorkspaceRelativePath(explicitPath, { allowEmpty: false }));
    } catch (error) {
      return { ok: false, status: 400, error: error.message };
    }
    if (!fs.existsSync(resolved.absolutePath)) {
      return { ok: false, status: 404, error: "文件不存在。" };
    }
    if (fs.statSync(resolved.absolutePath).isDirectory()) {
      return { ok: false, status: 400, error: "目标路径是文件夹，不能写入。" };
    }
    fs.writeFileSync(resolved.absolutePath, contentBuffer);
    updateWorkspaceTimeStmt.run(nowIso(), access.workspace.workspaceId);
    const file = fileMetadataFromStat({
      workspaceId: access.workspace.workspaceId,
      relativePath: resolved.relativePath,
      absolutePath: resolved.absolutePath,
      stat: fs.statSync(resolved.absolutePath),
      includeHash: true
    });
    const archived = await archiveWorkspacePath(access.workspace, resolved.relativePath, {
      operationId: input.operationId || "workspace.file.write"
    });
    const stateCommit = await commitWorkspaceFileState({
      workspace: access.workspace,
      operationId: input.operationId || "workspace.file.write",
      mutations: archived
        ? [{
            action: "put",
            key: resolved.relativePath,
            valueRef: archived.rootCid,
            metadata: filePayloadMetadata(file)
          }]
        : [],
      contentRefs: archived?.contentRefs || [],
      payload: {
        action: "file.write",
        path: resolved.relativePath,
        sizeBytes: contentBuffer.length,
        contentSha256: file.contentSha256 || ""
      }
    });
    const checkpoint = await recordWorkspaceFileCheckpoint({
      workspace: access.workspace,
      operationId: input.operationId || "workspace.file.write",
      stateCommit,
      action: "file.write",
      path: resolved.relativePath
    });
    return {
      protocolVersion: AGENT_WORKSPACE_PROTOCOL_VERSION,
      ok: true,
      workspaceId: access.workspace.workspaceId,
      overwritten: true,
      stateCommit,
      checkpoint,
      file
    };
  }

  async function patchWorkspaceFile(input = {}) {
    const access = workspaceForStorage(input);
    if (!access.ok) {
      return access;
    }
    const explicitPath = String(input.path || input.relativePath || input.filePath || input["file-path"] || "").trim();
    if (!explicitPath) {
      return { ok: false, status: 400, error: "path 不能为空。" };
    }
    if (path.posix.basename(explicitPath).startsWith(".")) {
      return { ok: false, status: 400, error: "不允许操作以 . 开头的文件。" };
    }
    let resolved;
    try {
      resolved = resolveWorkspacePath(access.workspace, normalizeWorkspaceRelativePath(explicitPath, { allowEmpty: false }));
    } catch (error) {
      return { ok: false, status: 400, error: error.message };
    }
    if (!fs.existsSync(resolved.absolutePath)) {
      return { ok: false, status: 404, error: "文件不存在。" };
    }
    if (fs.statSync(resolved.absolutePath).isDirectory()) {
      return { ok: false, status: 400, error: "目标路径是文件夹，不能打补丁。" };
    }
    const encoding = String(input.encoding || input.textEncoding || "utf8");
    const beforeBuffer = fs.readFileSync(resolved.absolutePath);
    const beforeSha256 = sha256Buffer(beforeBuffer);
    const expectedSha256 = String(input.expectedSha256 || input.baseSha256 || "").trim();
    if (expectedSha256 && expectedSha256 !== beforeSha256) {
      return {
        ok: false,
        status: 409,
        error: "文件内容与 expectedSha256 不匹配。",
        expectedSha256,
        currentSha256: beforeSha256
      };
    }
    let nextText;
    try {
      const beforeText = beforeBuffer.toString(encoding);
      if (Array.isArray(input.hunks) && input.hunks.length > 0) {
        nextText = applyReplacementHunks(beforeText, input.hunks);
      } else if (Object.hasOwn(input, "patch")) {
        nextText = applyUnifiedPatchText(beforeText, input.patch);
      } else {
        return { ok: false, status: 400, error: "patch 或 hunks 至少提供一个。" };
      }
    } catch (error) {
      return { ok: false, status: 409, error: error instanceof Error ? error.message : "patch 应用失败。" };
    }
    const nextBuffer = Buffer.from(nextText, encoding);
    const afterSha256 = sha256Buffer(nextBuffer);
    if (afterSha256 === beforeSha256) {
      return { ok: false, status: 409, error: "patch 未改变文件内容。", currentSha256: beforeSha256 };
    }
    fs.writeFileSync(resolved.absolutePath, nextBuffer);
    updateWorkspaceTimeStmt.run(nowIso(), access.workspace.workspaceId);
    const file = fileMetadataFromStat({
      workspaceId: access.workspace.workspaceId,
      relativePath: resolved.relativePath,
      absolutePath: resolved.absolutePath,
      stat: fs.statSync(resolved.absolutePath),
      includeHash: true
    });
    const archived = await archiveWorkspacePath(access.workspace, resolved.relativePath, {
      operationId: input.operationId || "workspace.file.patch"
    });
    const stateCommit = await commitWorkspaceFileState({
      workspace: access.workspace,
      operationId: input.operationId || "workspace.file.patch",
      mutations: archived
        ? [{
            action: "put",
            key: resolved.relativePath,
            valueRef: archived.rootCid,
            metadata: filePayloadMetadata(file)
          }]
        : [],
      contentRefs: archived?.contentRefs || [],
      payload: {
        action: "file.patch",
        path: resolved.relativePath,
        beforeSha256,
        afterSha256
      }
    });
    const checkpoint = await recordWorkspaceFileCheckpoint({
      workspace: access.workspace,
      operationId: input.operationId || "workspace.file.patch",
      stateCommit,
      action: "file.patch",
      path: resolved.relativePath
    });
    return {
      protocolVersion: AGENT_WORKSPACE_PROTOCOL_VERSION,
      ok: true,
      workspaceId: access.workspace.workspaceId,
      patched: true,
      beforeSha256,
      afterSha256,
      stateCommit,
      checkpoint,
      file
    };
  }

  async function deleteWorkspaceFile(input = {}) {
    const access = workspaceForStorage(input);
    if (!access.ok) {
      return access;
    }
    const explicitPath = String(input.path || input.relativePath || "").trim();
    if (!explicitPath) {
      return { ok: false, status: 400, error: "path 不能为空。" };
    }
    if (path.posix.basename(explicitPath).startsWith(".")) {
      return { ok: false, status: 400, error: "不允许操作以 . 开头的文件。" };
    }
    let resolved;
    try {
      resolved = resolveWorkspacePath(access.workspace, normalizeWorkspaceRelativePath(explicitPath, { allowEmpty: false }));
    } catch (error) {
      return { ok: false, status: 400, error: error.message };
    }
    if (!fs.existsSync(resolved.absolutePath)) {
      return { ok: false, status: 404, error: "文件不存在。" };
    }
    const stat = fs.statSync(resolved.absolutePath);
    const deletedPaths = [];
    if (stat.isDirectory()) {
      const collect = (absoluteDir, relativeDir) => {
        const entries = fs.readdirSync(absoluteDir, { withFileTypes: true })
          .filter((entry) => !entry.name.startsWith("."))
          .sort((left, right) => left.name.localeCompare(right.name));
        for (const entry of entries) {
          const childRelativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
          const childAbsolutePath = path.join(absoluteDir, entry.name);
          if (entry.isDirectory()) {
            collect(childAbsolutePath, childRelativePath);
          }
          deletedPaths.push(childRelativePath);
        }
      };
      collect(resolved.absolutePath, resolved.relativePath);
    }
    deletedPaths.push(resolved.relativePath);
    const meta = fileMetadataFromStat({
      workspaceId: access.workspace.workspaceId,
      relativePath: resolved.relativePath,
      absolutePath: resolved.absolutePath,
      stat
    });
    if (stat.isDirectory()) {
      if (!input.recursive) {
        fs.rmdirSync(resolved.absolutePath);
      } else {
        fs.rmSync(resolved.absolutePath, { recursive: true, force: true });
      }
    } else {
      fs.unlinkSync(resolved.absolutePath);
    }
    updateWorkspaceTimeStmt.run(nowIso(), access.workspace.workspaceId);
    const stateCommit = await commitWorkspaceFileState({
      workspace: access.workspace,
      operationId: input.operationId || "agent_workspaces.file.delete",
      mutations: deletedPaths.map((relativePath) => ({
        action: "delete",
        key: relativePath
      })),
      payload: {
        action: "file.delete",
        path: resolved.relativePath,
        recursive: input.recursive === true,
        deletedPathCount: deletedPaths.length
      }
    });
    const checkpoint = await recordWorkspaceFileCheckpoint({
      workspace: access.workspace,
      operationId: input.operationId || "agent_workspaces.file.delete",
      stateCommit,
      action: "file.delete",
      path: resolved.relativePath
    });
    return {
      protocolVersion: AGENT_WORKSPACE_PROTOCOL_VERSION,
      ok: true,
      workspaceId: access.workspace.workspaceId,
      deleted: true,
      stateCommit,
      checkpoint,
      file: meta
    };
  }

  async function moveWorkspaceFile(input = {}) {
    const access = workspaceForStorage(input);
    if (!access.ok) {
      return access;
    }
    const sourcePath = String(input.sourcePath || input.from || "").trim();
    const targetPath = String(input.targetPath || input.to || input.path || "").trim();
    if (!sourcePath) {
      return { ok: false, status: 400, error: "sourcePath (from) 不能为空。" };
    }
    if (!targetPath) {
      return { ok: false, status: 400, error: "targetPath (to) 不能为空。" };
    }
    if (path.posix.basename(sourcePath).startsWith(".") || path.posix.basename(targetPath).startsWith(".")) {
      return { ok: false, status: 400, error: "不允许操作以 . 开头的文件。" };
    }
    let resolvedSource, resolvedTarget;
    try {
      resolvedSource = resolveWorkspacePath(access.workspace, normalizeWorkspaceRelativePath(sourcePath, { allowEmpty: false }));
      resolvedTarget = resolveWorkspacePath(access.workspace, normalizeWorkspaceRelativePath(targetPath, { allowEmpty: false }));
    } catch (error) {
      return { ok: false, status: 400, error: error.message };
    }
    if (!fs.existsSync(resolvedSource.absolutePath)) {
      return { ok: false, status: 404, error: "源文件不存在。" };
    }
    if (fs.existsSync(resolvedTarget.absolutePath)) {
      if (!input.overwrite) {
        return { ok: false, status: 409, error: "目标路径已存在。设置 overwrite: true 以覆盖。" };
      }
      fs.rmSync(resolvedTarget.absolutePath, { recursive: true, force: true });
    }
    fs.mkdirSync(path.dirname(resolvedTarget.absolutePath), { recursive: true });
    fs.renameSync(resolvedSource.absolutePath, resolvedTarget.absolutePath);
    updateWorkspaceTimeStmt.run(nowIso(), access.workspace.workspaceId);
    const newStat = fs.statSync(resolvedTarget.absolutePath);
    const file = fileMetadataFromStat({
      workspaceId: access.workspace.workspaceId,
      relativePath: resolvedTarget.relativePath,
      absolutePath: resolvedTarget.absolutePath,
      stat: newStat,
      includeHash: newStat.isFile()
    });
    const archived = await archiveWorkspacePath(access.workspace, resolvedTarget.relativePath, {
      operationId: input.operationId || "agent_workspaces.file.move"
    });
    const stateCommit = await commitWorkspaceFileState({
      workspace: access.workspace,
      operationId: input.operationId || "agent_workspaces.file.move",
      mutations: [
        {
          action: "delete",
          key: resolvedSource.relativePath
        },
        ...(archived
          ? [{
              action: "put",
              key: resolvedTarget.relativePath,
              valueRef: archived.rootCid,
              metadata: filePayloadMetadata(file)
            }]
          : [])
      ],
      contentRefs: archived?.contentRefs || [],
      payload: {
        action: "file.move",
        sourcePath: resolvedSource.relativePath,
        targetPath: resolvedTarget.relativePath,
        overwrite: input.overwrite === true
      }
    });
    const checkpoint = await recordWorkspaceFileCheckpoint({
      workspace: access.workspace,
      operationId: input.operationId || "agent_workspaces.file.move",
      stateCommit,
      action: "file.move",
      path: resolvedTarget.relativePath
    });
    return {
      protocolVersion: AGENT_WORKSPACE_PROTOCOL_VERSION,
      ok: true,
      workspaceId: access.workspace.workspaceId,
      moved: true,
      sourcePath: resolvedSource.relativePath,
      targetPath: resolvedTarget.relativePath,
      stateCommit,
      checkpoint,
      file
    };
  }

  function scanDirectoryForWorkspaceSync(root, {
    rootRelativePath = "",
    maxFiles = 2000
  } = {}) {
    const resolvedRoot = path.resolve(root);
    if (!fs.existsSync(resolvedRoot)) {
      throw new Error("本机目录不存在。");
    }
    const rootStat = fs.lstatSync(resolvedRoot);
    if (rootStat.isSymbolicLink()) {
      throw new Error("不允许同步符号链接目录。");
    }
    if (!rootStat.isDirectory()) {
      throw new Error("sourcePath 必须是本机目录。");
    }
    const files = [];
    const visit = (absoluteDir, relativeDir) => {
      const entries = fs.readdirSync(absoluteDir, { withFileTypes: true })
        .sort((left, right) => left.name.localeCompare(right.name));
      for (const entry of entries) {
        if (entry.name.startsWith(".")) {
          throw new Error(`不允许同步以 . 开头的路径：${relativeDir ? `${relativeDir}/` : ""}${entry.name}`);
        }
        const childAbsolutePath = path.join(absoluteDir, entry.name);
        const childRelativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
        const stat = fs.lstatSync(childAbsolutePath);
        if (stat.isSymbolicLink()) {
          throw new Error(`不允许同步符号链接：${childRelativePath}`);
        }
        if (stat.isDirectory()) {
          visit(childAbsolutePath, childRelativePath);
          continue;
        }
        if (!stat.isFile()) {
          throw new Error(`不支持同步非普通文件：${childRelativePath}`);
        }
        if (files.length >= maxFiles) {
          throw new Error(`同步文件数量超过限制：${maxFiles}`);
        }
        const content = fs.readFileSync(childAbsolutePath);
        files.push({
          sourceRelativePath: normalizeWorkspaceRelativePath(childRelativePath, { allowEmpty: false }),
          relativePath: rootRelativePath
            ? joinWorkspaceRelativePath(rootRelativePath, childRelativePath)
            : normalizeWorkspaceRelativePath(childRelativePath, { allowEmpty: false }),
          absolutePath: childAbsolutePath,
          sizeBytes: Number(stat.size || 0),
          contentSha256: sha256Buffer(content)
        });
      }
    };
    visit(resolvedRoot, "");
    return files;
  }

  function scanWorkspaceFilesForSync(workspace, basePath = "", maxFiles = 2000) {
    const base = resolveWorkspacePath(workspace, basePath, { allowEmpty: true });
    if (!fs.existsSync(base.absolutePath)) {
      return [];
    }
    const stat = fs.lstatSync(base.absolutePath);
    if (stat.isSymbolicLink()) {
      throw new Error("工作空间同步目标不能是符号链接。");
    }
    if (!stat.isDirectory()) {
      throw new Error("工作空间同步目标必须是目录。");
    }
    const files = [];
    const visit = (absoluteDir, relativeDir) => {
      const entries = fs.readdirSync(absoluteDir, { withFileTypes: true })
        .sort((left, right) => left.name.localeCompare(right.name));
      for (const entry of entries) {
        const childAbsolutePath = path.join(absoluteDir, entry.name);
        const childRelativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
        const stat = fs.lstatSync(childAbsolutePath);
        if (stat.isSymbolicLink()) {
          throw new Error(`工作空间内存在不允许同步的符号链接：${childRelativePath}`);
        }
        if (stat.isDirectory()) {
          visit(childAbsolutePath, childRelativePath);
          continue;
        }
        if (!stat.isFile()) {
          continue;
        }
        if (files.length >= maxFiles) {
          throw new Error(`工作空间同步文件数量超过限制：${maxFiles}`);
        }
        const normalizedPath = normalizeWorkspaceRelativePath(childRelativePath, { allowEmpty: false });
        files.push({
          relativePath: basePath ? joinWorkspaceRelativePath(basePath, normalizedPath) : normalizedPath,
          sizeBytes: Number(stat.size || 0),
          contentSha256: sha256Buffer(fs.readFileSync(childAbsolutePath))
        });
      }
    };
    visit(base.absolutePath, "");
    return files;
  }

  function localDirectorySyncPlan(input = {}, options = {}) {
    const access = workspaceForStorage(input);
    if (!access.ok) {
      return access;
    }
    let source;
    try {
      source = resolveLocalDirectorySource(input, access.workspace, options);
    } catch (error) {
      return { ok: false, status: 400, error: error.message };
    }
    const sourcePath = source.sourcePath;
    let targetPath;
    try {
      targetPath = normalizeWorkspaceRelativePath(input.targetPath || input.path || "", { allowEmpty: true });
    } catch (error) {
      return { ok: false, status: 400, error: error.message };
    }
    const maxFiles = Math.max(1, Math.min(Number(input.maxFiles || input.limit || 2000), 10000));
    const deleteExtraneous = input.deleteExtraneous === true || input.prune === true;
    let sourceFiles, targetFiles;
    try {
      sourceFiles = scanDirectoryForWorkspaceSync(sourcePath, { rootRelativePath: targetPath, maxFiles });
      targetFiles = scanWorkspaceFilesForSync(access.workspace, targetPath, maxFiles);
    } catch (error) {
      return { ok: false, status: 400, error: error.message };
    }
    const targetByPath = new Map(targetFiles.map((file) => [file.relativePath, file]));
    const sourceByPath = new Map(sourceFiles.map((file) => [file.relativePath, file]));
    const actions = [];
    for (const source of sourceFiles) {
      const current = targetByPath.get(source.relativePath);
      const action = !current
        ? "create"
        : current.contentSha256 === source.contentSha256
          ? "noop"
          : "write";
      actions.push({
        action,
        sourceRelativePath: source.sourceRelativePath,
        targetPath: source.relativePath,
        sizeBytes: source.sizeBytes,
        contentSha256: source.contentSha256
      });
    }
    if (deleteExtraneous) {
      for (const current of targetFiles) {
        if (!sourceByPath.has(current.relativePath)) {
          actions.push({
            action: "delete",
            targetPath: current.relativePath,
            sizeBytes: current.sizeBytes,
            contentSha256: current.contentSha256
          });
        }
      }
    }
    const changedActions = actions.filter((action) => action.action !== "noop");
    return {
      protocolVersion: AGENT_WORKSPACE_PROTOCOL_VERSION,
      ok: true,
      dryRun: true,
      workspaceId: access.workspace.workspaceId,
      targetPath,
      mountRef: source.mount?.mountRef || "",
      sourceRootName: path.basename(path.resolve(sourcePath)),
      sourceRootHash: stableHash(path.resolve(sourcePath)),
      deleteExtraneous,
      sourceFileCount: sourceFiles.length,
      targetFileCount: targetFiles.length,
      actions,
      summary: {
        create: actions.filter((action) => action.action === "create").length,
        write: actions.filter((action) => action.action === "write").length,
        delete: actions.filter((action) => action.action === "delete").length,
        noop: actions.filter((action) => action.action === "noop").length,
        changed: changedActions.length
      }
    };
  }

  async function applyLocalDirectorySync(input = {}) {
    const access = workspaceForStorage(input);
    if (!access.ok) {
      return access;
    }
    const plan = localDirectorySyncPlan(input);
    if (!plan.ok) {
      return plan;
    }
    if (input.dryRun === true) {
      return plan;
    }
    let source;
    try {
      source = resolveLocalDirectorySource(input, access.workspace);
    } catch (error) {
      return { ok: false, status: 400, error: error.message };
    }
    const sourcePath = source.sourcePath;
    const sourceFiles = scanDirectoryForWorkspaceSync(sourcePath, {
      rootRelativePath: plan.targetPath,
      maxFiles: Math.max(1, Math.min(Number(input.maxFiles || input.limit || 2000), 10000))
    });
    const sourceByTarget = new Map(sourceFiles.map((file) => [file.relativePath, file]));
    const mutations = [];
    const contentRefs = [];
    const appliedActions = [];
    for (const action of plan.actions) {
      if (action.action === "noop") {
        continue;
      }
      const target = resolveWorkspacePath(access.workspace, action.targetPath, { allowEmpty: false });
      if (action.action === "delete") {
        if (fs.existsSync(target.absolutePath)) {
          fs.rmSync(target.absolutePath, { force: true });
        }
        mutations.push({ action: "delete", key: target.relativePath });
        appliedActions.push(action);
        continue;
      }
      const source = sourceByTarget.get(action.targetPath);
      if (!source) {
        return { ok: false, status: 409, error: `同步源文件消失：${action.sourceRelativePath || action.targetPath}` };
      }
      const content = fs.readFileSync(source.absolutePath);
      fs.mkdirSync(path.dirname(target.absolutePath), { recursive: true });
      fs.writeFileSync(target.absolutePath, content);
      const archived = await archiveWorkspacePath(access.workspace, target.relativePath, {
        operationId: input.operationId || "sharedspace.sync.apply"
      });
      const stat = fs.statSync(target.absolutePath);
      const file = fileMetadataFromStat({
        workspaceId: access.workspace.workspaceId,
        relativePath: target.relativePath,
        absolutePath: target.absolutePath,
        stat,
        includeHash: true
      });
      if (archived) {
        mutations.push({
          action: "put",
          key: target.relativePath,
          valueRef: archived.rootCid,
          metadata: filePayloadMetadata(file)
        });
        contentRefs.push(...(archived.contentRefs || []));
      }
      appliedActions.push(action);
    }
    updateWorkspaceTimeStmt.run(nowIso(), access.workspace.workspaceId);
    const stateCommit = await commitWorkspaceFileState({
      workspace: access.workspace,
      operationId: input.operationId || "sharedspace.sync.apply",
      mutations,
      contentRefs,
      payload: {
        action: "sync.apply",
        targetPath: plan.targetPath,
        sourceRootName: plan.sourceRootName,
        sourceRootHash: plan.sourceRootHash,
        deleteExtraneous: plan.deleteExtraneous,
        summary: plan.summary
      }
    });
    const checkpoint = await recordWorkspaceFileCheckpoint({
      workspace: access.workspace,
      operationId: input.operationId || "sharedspace.sync.apply",
      stateCommit,
      action: "sync.apply",
      path: plan.targetPath || "/"
    });
    return {
      ...plan,
      dryRun: false,
      stateCommit,
      checkpoint,
      appliedActions,
      summary: {
        ...plan.summary,
        applied: appliedActions.length
      }
    };
  }

  async function decodeWorkspaceSnapshotContent(entry = {}) {
    if (entry.contentCid || entry.cid) {
      if (!merkleState) {
        throw new Error("文件快照引用 CAS contentCid，但 Merkle State 基座不可用。");
      }
      const block = await merkleState.cas.getBlock(String(entry.contentCid || entry.cid));
      if (!block) {
        throw new Error(`文件快照内容块不存在：${entry.contentCid || entry.cid}`);
      }
      return block.bytes;
    }
    return decodeWorkspaceFileContent(entry);
  }

  async function normalizeWorkspaceFileSnapshot(input = {}) {
    const snapshot = asObject(input.snapshot || input.workspaceFileSnapshot || input.fileSnapshot || input);
    const basePath = normalizeWorkspaceRelativePath(snapshot.basePath || snapshot.rootPath || input.basePath || "", { allowEmpty: true });
    const rawFiles = asArray(snapshot.files || snapshot.entries || input.files);
    return {
      basePath,
      deleteExtraneous: snapshot.deleteExtraneous === true || input.deleteExtraneous === true,
      files: await Promise.all(rawFiles.map(async (entry) => {
        const rawRelativePath = normalizeWorkspaceRelativePath(
          entry.path || entry.relativePath || entry.filePath || entry.name || "",
          { allowEmpty: false }
        );
        const relativePath = basePath && rawRelativePath !== basePath && !rawRelativePath.startsWith(`${basePath}/`)
          ? joinWorkspaceRelativePath(basePath, rawRelativePath)
          : rawRelativePath;
        if (path.posix.basename(relativePath).startsWith(".")) {
          throw new Error("不允许恢复以 . 开头的文件。");
        }
        const exists = entry.exists !== false && entry.deleted !== true && entry.tombstone !== true;
        const content = exists ? await decodeWorkspaceSnapshotContent(entry) : Buffer.alloc(0);
        const contentSha256 = exists ? sha256Buffer(content) : "";
        const expectedSha256 = normalizeSha256(entry.contentSha256 || entry.sha256 || entry.expectedSha256 || "");
        if (expectedSha256 && expectedSha256 !== contentSha256) {
          throw new Error(`文件快照 hash 不匹配：${relativePath}`);
        }
        return {
          relativePath,
          exists,
          content,
          contentSha256,
          encoding: String(entry.encoding || "base64")
        };
      }))
    };
  }

  async function restoreWorkspaceFiles(input = {}) {
    const access = workspaceForStorage(input);
    if (!access.ok) {
      return access;
    }
    let snapshot;
    try {
      snapshot = await normalizeWorkspaceFileSnapshot(input);
    } catch (error) {
      return { ok: false, status: 400, error: error.message };
    }
    const dryRun = input.dryRun === true || input.preview === true;
    const requestedBy = String(input.createdBy || input.actorUserId || input.agentId || "").trim();
    const desiredByPath = new Map(snapshot.files.map((entry) => [entry.relativePath, entry]));
    const existing = await listWorkspaceFiles({
      ...input,
      workspaceId: access.workspace.workspaceId,
      path: snapshot.basePath,
      folderPath: snapshot.basePath,
      recursive: true,
      includeDirectories: false,
      includeFiles: true,
      includeHash: true,
      limit: input.limit || 5000,
    });
    if (!existing.ok) {
      return existing;
    }
    const existingByPath = new Map(existing.files.map((file) => [file.relativePath, file]));
    const actions = [];
    for (const entry of snapshot.files) {
      const current = existingByPath.get(entry.relativePath);
      if (!entry.exists) {
        actions.push({
          action: current ? "delete" : "noop",
          path: entry.relativePath,
          currentSha256: current?.contentSha256 || ""
        });
        continue;
      }
      const action = !current
        ? "create"
        : current.contentSha256 === entry.contentSha256
          ? "noop"
          : "write";
      actions.push({
        action,
        path: entry.relativePath,
        expectedSha256: entry.contentSha256,
        currentSha256: current?.contentSha256 || ""
      });
    }
    if (snapshot.deleteExtraneous) {
      for (const current of existing.files) {
        if (!desiredByPath.has(current.relativePath)) {
          actions.push({
            action: "delete",
            path: current.relativePath,
            currentSha256: current.contentSha256 || "",
            extraneous: true
          });
        }
      }
    }
    const applied = [];
    if (!dryRun) {
      for (const action of actions) {
        if (action.action === "noop") {
          continue;
        }
        const entry = desiredByPath.get(action.path);
        let resolved;
        try {
          resolved = resolveWorkspacePath(access.workspace, action.path);
        } catch (error) {
          return { ok: false, status: 400, error: error.message };
        }
        if (action.action === "delete") {
          if (fs.existsSync(resolved.absolutePath)) {
            fs.rmSync(resolved.absolutePath, { recursive: true, force: true });
          }
          applied.push(action);
          continue;
        }
        fs.mkdirSync(path.dirname(resolved.absolutePath), { recursive: true });
        fs.writeFileSync(resolved.absolutePath, entry.content);
        applied.push(action);
      }
      if (applied.length > 0) {
        updateWorkspaceTimeStmt.run(nowIso(), access.workspace.workspaceId);
      }
      try {
        getRuntimeLogger().info("agent_workspace.files.restore.completed", {
          workspaceId: access.workspace.workspaceId,
          fileCount: snapshot.files.length,
          appliedCount: applied.length,
          dryRun,
          requestedBy
        });
      } catch {
        // Logging must not turn a completed restore into a failed operation.
      }
    }
    const commitMutations = [];
    const commitRefs = [];
    if (!dryRun && applied.length > 0) {
      for (const action of applied) {
        if (action.action === "delete") {
          commitMutations.push({
            action: "delete",
            key: action.path
          });
          continue;
        }
        const archived = await archiveWorkspacePath(access.workspace, action.path, {
          operationId: input.operationId || "workspace.checkpoint.restore"
        });
        if (archived) {
          commitMutations.push({
            action: "put",
            key: action.path,
            valueRef: archived.rootCid,
            metadata: archived.metadata
          });
          commitRefs.push(...archived.contentRefs);
        }
      }
    }
    const stateCommit = !dryRun && applied.length > 0
      ? await commitWorkspaceFileState({
          workspace: access.workspace,
          operationId: input.operationId || "workspace.checkpoint.restore",
          mutations: commitMutations,
          contentRefs: commitRefs,
          payload: {
            action: "files.restore",
            basePath: snapshot.basePath,
            appliedCount: applied.length,
            reason: input.reason || ""
          }
        })
      : null;
    const checkpoint = !dryRun && stateCommit
      ? await recordWorkspaceFileCheckpoint({
          workspace: access.workspace,
          operationId: input.operationId || "workspace.checkpoint.restore",
          stateCommit,
          action: "files.restore",
          path: snapshot.basePath
        })
      : null;
    return {
      protocolVersion: AGENT_WORKSPACE_PROTOCOL_VERSION,
      ok: true,
      workspaceId: access.workspace.workspaceId,
      dryRun,
      stateCommit,
      checkpoint,
      basePath: snapshot.basePath,
      deleteExtraneous: snapshot.deleteExtraneous,
      fileCount: snapshot.files.length,
      actions,
      appliedActions: dryRun ? [] : applied,
      summary: {
        create: actions.filter((action) => action.action === "create").length,
        write: actions.filter((action) => action.action === "write").length,
        delete: actions.filter((action) => action.action === "delete").length,
        noop: actions.filter((action) => action.action === "noop").length,
        applied: dryRun ? 0 : applied.length
      }
    };
  }

  function updateArtifactsStatus(runId, status) {
    const timestamp = nowIso();
    db.prepare("UPDATE aw_artifacts SET status = ?, updated_at = ? WHERE run_id = ?").run(
      String(status || "draft"),
      timestamp,
      String(runId || "")
    );
    return listRunArtifacts(runId);
  }

  function createIssue(input = {}) {
    const timestamp = nowIso();
    const issueId =
      String(input.issueId || "").trim() ||
      stableId("issue", input.workspaceId || "", input.runId || "", input.title || "", timestamp);
    insertIssueStmt.run(
      issueId,
      String(input.workspaceId || ""),
      String(input.runId || ""),
      String(input.type || "issue"),
      String(input.status || "open"),
      String(input.severity || "medium"),
      normalizeText(input.title || "Workspace issue") || "Workspace issue",
      stringifyJson(asObject(input.payload)),
      stringifyJson(normalizeEvidenceRefs(input.evidenceRefs, asObject(input.payload)), []),
      String(input.createdBy || input.agentId || ""),
      input.createdAt || timestamp,
      timestamp
    );
    updateWorkspaceTimeStmt.run(timestamp, String(input.workspaceId || ""));
    return {
      protocolVersion: AGENT_WORKSPACE_PROTOCOL_VERSION,
      issue: hydrateIssue(db.prepare("SELECT * FROM aw_issues WHERE issue_id = ?").get(issueId))
    };
  }

  function updateIssue(input = {}) {
    const issueId = String(input.issueId || "").trim();
    const current = hydrateIssue(selectIssueStmt.get(issueId));
    if (!current) {
      return null;
    }
    if (input.workspaceId && current.workspaceId !== String(input.workspaceId)) {
      return null;
    }
    if (!canAccessWorkspaceId(current.workspaceId, input)) {
      return null;
    }
    const rawStatus = String(input.status || input.action || "resolved").trim() || "resolved";
    const status = rawStatus === "resolve"
      ? "resolved"
      : rawStatus === "reject"
        ? "rejected"
        : rawStatus === "reopen"
          ? "open"
          : rawStatus;
    const timestamp = nowIso();
    const payload = {
      ...(current.payload || {}),
      resolution: {
        action: status,
        note: normalizeText(input.note || input.reason || "").slice(0, 1000),
        resolvedBy: String(input.reviewerId || input.agentId || input.clientId || ""),
        resolvedAt: timestamp
      }
    };
    updateIssueStatusStmt.run(status, stringifyJson(payload), timestamp, issueId);
    updateWorkspaceTimeStmt.run(timestamp, current.workspaceId);
    return {
      protocolVersion: AGENT_WORKSPACE_PROTOCOL_VERSION,
      issue: hydrateIssue(selectIssueStmt.get(issueId))
    };
  }

  function createDecision(input = {}) {
    const timestamp = nowIso();
    const decisionId =
      String(input.decisionId || "").trim() ||
      stableId("decision", input.workspaceId || "", input.runId || "", input.title || "", timestamp);
    insertDecisionStmt.run(
      decisionId,
      String(input.workspaceId || ""),
      String(input.runId || ""),
      String(input.status || "proposed"),
      normalizeText(input.title || "Decision proposal") || "Decision proposal",
      stringifyJson(asObject(input.payload)),
      String(input.createdBy || input.agentId || ""),
      input.createdAt || timestamp,
      timestamp
    );
    updateWorkspaceTimeStmt.run(timestamp, String(input.workspaceId || ""));
    return {
      protocolVersion: AGENT_WORKSPACE_PROTOCOL_VERSION,
      decision: hydrateDecision(db.prepare("SELECT * FROM aw_decisions WHERE decision_id = ?").get(decisionId))
    };
  }

  function listRunArtifacts(runId) {
    return db.prepare("SELECT * FROM aw_artifacts WHERE run_id = ? ORDER BY updated_at DESC").all(String(runId || "")).map(hydrateArtifact);
  }

  function cleanupExpiredLocks() {
    deleteExpiredLocksStmt.run(nowIso());
  }

  function acquireLock(input = {}) {
    cleanupExpiredLocks();
    const workspaceId = String(input.workspaceId || "");
    const targetType = String(input.targetType || input.type || "").trim();
    const targetId = String(input.targetId || input.id || "").trim();
    const ownerAgentId = String(input.ownerAgentId || input.agentId || "").trim();
    if (workspaceId && !canAccessWorkspaceId(workspaceId, input)) {
      return {
        protocolVersion: AGENT_WORKSPACE_PROTOCOL_VERSION,
        ok: false,
        error: "workspace_forbidden"
      };
    }
    if (!workspaceId || !targetType || !targetId || !ownerAgentId) {
      return {
        protocolVersion: AGENT_WORKSPACE_PROTOCOL_VERSION,
        ok: false,
        error: "missing_lock_fields"
      };
    }
    const existing = hydrateLock(selectTargetLockStmt.get(workspaceId, targetType, targetId));
    if (existing && existing.ownerAgentId !== ownerAgentId && existing.expiresAt > nowIso()) {
      return {
        protocolVersion: AGENT_WORKSPACE_PROTOCOL_VERSION,
        ok: false,
        error: "lock_held",
        lock: existing
      };
    }
    const timestamp = nowIso();
    // M-6: cap lock TTL at 30 minutes to prevent agent lock starvation
    const ttlMs = Math.max(1000, Math.min(Number(input.ttlMs || 5 * 60 * 1000), 30 * 60 * 1000));
    const expiresAt = new Date(Date.now() + ttlMs).toISOString();
    const lockId =
      String(input.lockId || "").trim() ||
      existing?.lockId ||
      stableId("lock", workspaceId, targetType, targetId, ownerAgentId);
    insertLockStmt.run(lockId, workspaceId, targetType, targetId, ownerAgentId, expiresAt, timestamp);
    updateWorkspaceTimeStmt.run(timestamp, workspaceId);
    return {
      protocolVersion: AGENT_WORKSPACE_PROTOCOL_VERSION,
      ok: true,
      lock: hydrateLock(selectLockStmt.get(lockId))
    };
  }

  function releaseLock(input = {}) {
    cleanupExpiredLocks();
    const workspaceId = String(input.workspaceId || "");
    const lockId = String(input.lockId || "").trim();
    const targetType = String(input.targetType || input.type || "").trim();
    const targetId = String(input.targetId || input.id || "").trim();
    const ownerAgentId = String(input.ownerAgentId || input.agentId || "").trim();
    const current = lockId
      ? hydrateLock(selectLockStmt.get(lockId))
      : hydrateLock(selectTargetLockStmt.get(workspaceId, targetType, targetId));
    if (!current) {
      return {
        protocolVersion: AGENT_WORKSPACE_PROTOCOL_VERSION,
        ok: true,
        released: false
      };
    }
    if (!canAccessWorkspaceId(current.workspaceId, input)) {
      return {
        protocolVersion: AGENT_WORKSPACE_PROTOCOL_VERSION,
        ok: false,
        released: false,
        error: "workspace_forbidden"
      };
    }
    // M-7: remove force bypass from public API — ownerAgentId is always enforced here.
    // Privileged force-release is only available via adminReleaseLock().
    if (ownerAgentId && current.ownerAgentId !== ownerAgentId) {
      return {
        protocolVersion: AGENT_WORKSPACE_PROTOCOL_VERSION,
        ok: false,
        released: false,
        error: "lock_owner_mismatch",
        lock: current
      };
    }
    deleteLockStmt.run(current.lockId);
    updateWorkspaceTimeStmt.run(nowIso(), current.workspaceId);
    return {
      protocolVersion: AGENT_WORKSPACE_PROTOCOL_VERSION,
      ok: true,
      released: true,
      lock: current
    };
  }

  function listLocks(input = {}) {
    if (!input.includeExpired) {
      cleanupExpiredLocks();
    }
    const workspaceId = String(input.workspaceId || "");
    if (!canAccessWorkspaceId(workspaceId, input)) {
      return [];
    }
    const limit = Math.max(1, Math.min(Number(input.limit || 100), 500));
    const rows = input.includeExpired
      ? db.prepare("SELECT * FROM aw_locks WHERE workspace_id = ? ORDER BY expires_at ASC LIMIT ?").all(workspaceId, limit)
      : db.prepare("SELECT * FROM aw_locks WHERE workspace_id = ? AND expires_at > ? ORDER BY expires_at ASC LIMIT ?").all(workspaceId, nowIso(), limit);
    return rows.map(hydrateLock);
  }

  function getWorkspace(input = {}) {
    const options = typeof input === "string" ? { workspaceId: input } : input;
    const workspaceId = options.workspaceId;
    const workspace = hydrateWorkspace(selectWorkspaceStmt.get(String(workspaceId || "")));
    if (!workspace) {
      return null;
    }
    if (!canAccessWorkspace(workspace, options)) {
      return null;
    }
    const queryRows = (baseSql, params, limitValue) => {
      const limit = optionalLimit(limitValue);
      return limit
        ? db.prepare(`${baseSql} LIMIT ?`).all(...params, limit)
        : db.prepare(baseSql).all(...params);
    };
    const includeRuns = options.includeRuns !== false;
    const includeRunDetails = options.includeRunDetails !== false;
    const runSql = includeRunDetails
      ? "SELECT * FROM aw_runs WHERE workspace_id = ? ORDER BY updated_at DESC"
      : `
        SELECT
          run_id, workspace_id, run_type, status, input_json,
          '[]' AS steps_json, '{}' AS coverage_json, artifact_ids_json,
          error, degraded, created_at, updated_at, started_at, completed_at
        FROM aw_runs
        WHERE workspace_id = ?
        ORDER BY updated_at DESC
      `;
    const runs = includeRuns
      ? queryRows(runSql, [workspace.workspaceId], options.runLimit)
          .map((row) => hydrateRun(row, { includeDetails: includeRunDetails }))
      : [];
    const submissions = options.includeSubmissions === false
      ? []
      : queryRows(
          "SELECT * FROM aw_submissions WHERE workspace_id = ? ORDER BY updated_at DESC",
          [workspace.workspaceId],
          options.submissionLimit
        ).map(hydrateSubmission);
    const artifacts = options.includeArtifacts === false
      ? []
      : queryRows(
          "SELECT * FROM aw_artifacts WHERE workspace_id = ? ORDER BY updated_at DESC",
          [workspace.workspaceId],
          options.artifactLimit
        ).map(hydrateArtifact);
    const issues = options.includeIssues === false
      ? []
      : queryRows(
          "SELECT * FROM aw_issues WHERE workspace_id = ? ORDER BY updated_at DESC",
          [workspace.workspaceId],
          options.issueLimit
        ).map(hydrateIssue);
    const decisions = options.includeDecisions === false
      ? []
      : queryRows(
          "SELECT * FROM aw_decisions WHERE workspace_id = ? ORDER BY updated_at DESC",
          [workspace.workspaceId],
          options.decisionLimit
        ).map(hydrateDecision);
    const locks = options.includeLocks === false ? [] : listLocks({
      workspaceId: workspace.workspaceId,
      includeExpired: Boolean(options.includeExpiredLocks),
      limit: 100,
      actorUserId: options.actorUserId,
      canAccessAll: options.canAccessAll
    });
    const privateStates = options.includePrivate
      ? queryRows(
          "SELECT * FROM aw_private_state WHERE workspace_id = ? ORDER BY updated_at DESC",
          [workspace.workspaceId],
          options.privateStateLimit
        ).map(hydratePrivateState)
      : [];
    return {
      protocolVersion: AGENT_WORKSPACE_PROTOCOL_VERSION,
      workspace,
      runs,
      submissions,
      artifacts,
      issues,
      decisions,
      locks,
      privateStates,
      summary: workspaceSummary(workspace.workspaceId)
    };
  }

  function close() {
    db.close();
  }

  /**
   * M-7: Force-release a lock regardless of owner, for use by privileged
   * administrative handlers only.  Never expose input.force from request body.
   */
  function adminReleaseLock(input = {}) {
    cleanupExpiredLocks();
    const workspaceId = String(input.workspaceId || "");
    const lockId = String(input.lockId || "").trim();
    const targetType = String(input.targetType || input.type || "").trim();
    const targetId = String(input.targetId || input.id || "").trim();
    const current = lockId
      ? hydrateLock(selectLockStmt.get(lockId))
      : hydrateLock(selectTargetLockStmt.get(workspaceId, targetType, targetId));
    if (!current) {
      return { protocolVersion: AGENT_WORKSPACE_PROTOCOL_VERSION, ok: true, released: false };
    }
    deleteLockStmt.run(current.lockId);
    updateWorkspaceTimeStmt.run(nowIso(), current.workspaceId);
    return { protocolVersion: AGENT_WORKSPACE_PROTOCOL_VERSION, ok: true, released: true, lock: current };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Workspace inheritance, profile & knowledge-scope system
  // ═══════════════════════════════════════════════════════════════════════════

  const selectWorkspaceRawStmt = db.prepare("SELECT * FROM aw_workspaces WHERE workspace_id = ?");

  /**
   * Walk the parent chain upward and return an ordered array [root, ..., target].
   * Throws if a cycle is detected.
   */
  function resolveWorkspaceChain(workspaceId, _seen = new Set()) {
    if (_seen.has(workspaceId)) {
      throw new Error(`工作空间继承链存在循环: ${Array.from(_seen).join(" → ")} → ${workspaceId}`);
    }
    _seen.add(workspaceId);
    const row = selectWorkspaceRawStmt.get(workspaceId);
    if (!row) return [];
    const ws = hydrateWorkspace(row);
    const ancestors = ws.parentWorkspaceId
      ? resolveWorkspaceChain(ws.parentWorkspaceId, _seen)
      : [];
    return [...ancestors, ws];
  }

  /**
   * Walk the chain root→target, merge profiles: child overrides parent scalars.
   * knowledgeScope arrays are merged using + / - notation.
   */
  function resolveWorkspaceProfile(workspaceId) {
    const chain = resolveWorkspaceChain(workspaceId);
    let merged = {
      contextProfileId: "",
      toolGrantId: "",
      modelAlias: "",
      knowledgeScope: { includeSourceIds: [], excludeSourceIds: [] }
    };
    for (const ws of chain) {
      const p = ws.profile || {};
      if (p.contextProfileId) merged.contextProfileId = p.contextProfileId;
      if (p.toolGrantId) merged.toolGrantId = p.toolGrantId;
      if (p.modelAlias) merged.modelAlias = p.modelAlias;
      const scope = p.knowledgeScope || {};
      if (Array.isArray(scope.includeSourceIds)) {
        merged.knowledgeScope.includeSourceIds = [
          ...merged.knowledgeScope.includeSourceIds,
          ...scope.includeSourceIds
        ];
      }
      if (Array.isArray(scope.excludeSourceIds)) {
        merged.knowledgeScope.excludeSourceIds = [
          ...merged.knowledgeScope.excludeSourceIds,
          ...scope.excludeSourceIds
        ];
      }
    }
    return merged;
  }

  /**
   * Resolve the final set of knowledge source IDs visible in this workspace,
   * including inherited sources and accessible (shared) workspaces.
   *
   * Algorithm:
   *   1. Walk root→target, accumulate owned sources at each level
   *   2. Apply include/exclude from each profile layer
   *   3. Add sources from directly accessible workspaces
   *
   * @returns {string[]} distinct source IDs
   */
  function resolveWorkspaceSourceIds(workspaceId, _visited = new Set()) {
    if (_visited.has(workspaceId)) return [];  // break cycles in shared graph
    _visited.add(workspaceId);

    const chain = resolveWorkspaceChain(workspaceId);
    const sourceSet = new Set();
    const excludeSet = new Set();

    for (const ws of chain) {
      // Add each level's owned sources
      for (const id of ws.ownedSourceIds) sourceSet.add(id);
      // Apply explicit include/exclude in the profile at this level
      const scope = (ws.profile || {}).knowledgeScope || {};
      for (const id of (scope.includeSourceIds || [])) sourceSet.add(id);
      for (const id of (scope.excludeSourceIds || [])) excludeSet.add(id);
    }

    // Remove explicitly excluded
    for (const id of excludeSet) sourceSet.delete(id);

    // Add sources from accessible (shared) workspaces
    const target = chain[chain.length - 1];
    if (target) {
      for (const sharedId of target.accessibleWorkspaceIds) {
        for (const id of resolveWorkspaceSourceIds(sharedId, _visited)) {
          sourceSet.add(id);
        }
      }
    }

    return Array.from(sourceSet);
  }

  /**
   * Return the fully-resolved runtime context for an agent operating in this workspace.
   * This is the single call an agent needs to set up its knowledge scope, context,
   * tool grant, and model routing.
   */
  function getWorkspaceContext(workspaceId, options = {}) {
    const targetRow = selectWorkspaceRawStmt.get(String(workspaceId || ""));
    if (!canAccessWorkspace(hydrateWorkspace(targetRow), options)) {
      return null;
    }
    const chain = resolveWorkspaceChain(workspaceId);
    if (chain.length === 0) return null;
    const profile = resolveWorkspaceProfile(workspaceId);
    const sourceIds = resolveWorkspaceSourceIds(workspaceId);
    const target = chain[chain.length - 1];
    return {
      protocolVersion: AGENT_WORKSPACE_PROTOCOL_VERSION,
      workspaceId,
      sharingMode: "team-shared",
      currentGeneration: target.currentGeneration,
      chainGenerations: chain.map((ws) => ({
        workspaceId: ws.workspaceId,
        generation: ws.currentGeneration
      })),
      contextFingerprint: stableHash(
        "workspace-context",
        chain.map((ws) => `${ws.workspaceId}:${ws.currentGeneration}`).join("|"),
        stringifyJson(profile),
        sourceIds.join("|")
      ),
      inheritanceChain: chain.map((ws) => ({
        workspaceId: ws.workspaceId,
        title: ws.title,
      })),
      knowledgeSourceIds: sourceIds,         // pass to knowledge-core search
      contextProfileId: profile.contextProfileId,
      toolGrantId: profile.toolGrantId,
      modelAlias: profile.modelAlias,
    };
  }

  function getSessionContext(sessionId, options = {}) {
    const session = hydrateSession(selectSessionStmt.get(String(sessionId || "")));
    if (!session || !canAccessWorkspaceId(session.workspaceId, options)) {
      return null;
    }
    const workspaceContext = getWorkspaceContext(session.workspaceId, options);
    if (!workspaceContext) {
      return null;
    }
    const sessionContext = asObject(session.context);
    const explicitSourceIds = asArray(sessionContext.knowledgeSourceIds || sessionContext.sourceIds);
    const contextProfileId = String(sessionContext.contextProfileId || workspaceContext.contextProfileId || "");
    const modelAlias = String(sessionContext.modelAlias || sessionContext.alias || workspaceContext.modelAlias || "");
    const toolGrantId = String(sessionContext.toolGrantId || sessionContext.grantId || workspaceContext.toolGrantId || "");
    const knowledgeSourceIds = explicitSourceIds.length ? explicitSourceIds : workspaceContext.knowledgeSourceIds;
    return {
      ...workspaceContext,
      workspaceContext,
      sessionProtocolVersion: AGENT_SESSION_THREAD_VERSION,
      agentSessionId: session.sessionId,
      sessionId: session.sessionId,
      sessionTitle: session.title,
      sessionStatus: session.status,
      parentSessionId: session.parentSessionId,
      forkedFromEventId: session.forkedFromEventId,
      sessionEventCount: session.eventCount,
      sessionLastEventId: session.lastEventId,
      sessionLineage: session.lineage,
      sessionAppendOnly: true,
      sessionContext,
      knowledgeSourceIds,
      contextProfileId,
      toolGrantId,
      modelAlias,
      contextFingerprint: stableHash(
        "agent-session-context",
        workspaceContext.contextFingerprint,
        session.sessionId,
        session.lastEventId,
        session.eventCount,
        stableJson(sessionContext),
        knowledgeSourceIds.join("|"),
        contextProfileId,
        toolGrantId,
        modelAlias
      )
    };
  }

  function exportWorkspaceContextBundle(workspaceId, options = {}) {
    const context = getWorkspaceContext(workspaceId, options);
    if (!context) {
      return null;
    }
    const includePrivate = options.includePrivate === true;
    const includeBundle = options.includeBundle !== false;
    const compress = options.compress !== false;
    const maxItems = boundedInteger(options.maxItems, 12, 1, 100);
    const contentPreviewChars = boundedInteger(options.contentPreviewChars, 600, 0, 4000);
    const snapshot = getWorkspace({
      workspaceId,
      actorUserId: options.actorUserId,
      canAccessAll: options.canAccessAll,
      includePrivate,
      includeRunDetails: false,
      runLimit: maxItems,
      submissionLimit: maxItems,
      artifactLimit: maxItems,
      issueLimit: maxItems,
      decisionLimit: maxItems,
      privateStateLimit: includePrivate ? maxItems : 0
    });
    if (!snapshot) {
      return null;
    }
    const chain = resolveWorkspaceChain(workspaceId);
    const bundle = {
      protocolVersion: AGENT_WORKSPACE_PROTOCOL_VERSION,
      bundleVersion: AGENT_WORKSPACE_CONTEXT_BUNDLE_VERSION,
      generatedAt: nowIso(),
      workspace: compactWorkspaceLayer(snapshot.workspace),
      summary: snapshot.summary || {},
      context,
      resolvedProfile: resolveWorkspaceProfile(workspaceId),
      inheritanceChain: chain.map(compactWorkspaceLayer),
      options: {
        includePrivate,
        maxItems,
        contentPreviewChars
      },
      recent: {
        runs: asArray(snapshot.runs).slice(0, maxItems).map(compactRun),
        submissions: asArray(snapshot.submissions).slice(0, maxItems).map(compactSubmission),
        artifacts: asArray(snapshot.artifacts)
          .slice(0, maxItems)
          .map((artifact) => compactArtifact(artifact, { contentPreviewChars })),
        issues: asArray(snapshot.issues).slice(0, maxItems).map(compactIssue),
        decisions: asArray(snapshot.decisions).slice(0, maxItems).map(compactDecision),
        privateStates: includePrivate
          ? asArray(snapshot.privateStates).slice(0, maxItems).map(compactPrivateState)
          : []
      }
    };
    bundle.handoffMarkdown = buildWorkspaceHandoffMarkdown(bundle);

    const jsonText = stableJson(bundle);
    const uncompressedBytes = Buffer.byteLength(jsonText, "utf8");
    const compressedBuffer = compress ? gzipSync(Buffer.from(jsonText, "utf8")) : null;
    const compressedBytes = compressedBuffer?.length || 0;
    return {
      protocolVersion: AGENT_WORKSPACE_PROTOCOL_VERSION,
      bundleVersion: AGENT_WORKSPACE_CONTEXT_BUNDLE_VERSION,
      workspaceId,
      generatedAt: bundle.generatedAt,
      currentGeneration: context.currentGeneration,
      contextFingerprint: context.contextFingerprint,
      bundleHash: stableHash("workspace-context-bundle", jsonText),
      restoreEvidence: {
        chainGenerations: context.chainGenerations,
        knowledgeSourceCount: asArray(context.knowledgeSourceIds).length,
        runCount: asArray(bundle.recent.runs).length,
        submissionCount: asArray(bundle.recent.submissions).length,
        artifactCount: asArray(bundle.recent.artifacts).length,
        issueCount: asArray(bundle.recent.issues).length,
        privateStateCount: asArray(bundle.recent.privateStates).length
      },
      compression: {
        algorithm: compress ? "gzip" : "none",
        uncompressedBytes,
        compressedBytes,
        ratio: compress && uncompressedBytes > 0
          ? Number((compressedBytes / uncompressedBytes).toFixed(4))
          : 1
      },
      compressed: compressedBuffer
        ? {
            encoding: "gzip+base64",
            payload: compressedBuffer.toString("base64")
          }
        : null,
      bundle: includeBundle ? bundle : undefined
    };
  }

  function restoreWorkspaceContextBundle(workspaceId, input = {}, options = {}) {
    const targetWorkspaceId = String(workspaceId || input.workspaceId || input.targetWorkspaceId || "").trim();
    const targetRow = selectWorkspaceRawStmt.get(targetWorkspaceId);
    if (!targetRow) {
      return { ok: false, error: "工作空间不存在" };
    }
    const targetWorkspace = hydrateWorkspace(targetRow);
    if (!canAccessWorkspace(targetWorkspace, options)) {
      return { ok: false, error: "工作空间不可访问" };
    }

    let bundle;
    try {
      bundle = decodeWorkspaceContextBundle(input);
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "工作空间上下文压缩包解析失败。"
      };
    }
    if (bundle?.bundleVersion !== AGENT_WORKSPACE_CONTEXT_BUNDLE_VERSION) {
      return { ok: false, error: "工作空间上下文压缩包版本不匹配。" };
    }

    const bundleHash = stableHash("workspace-context-bundle", stableJson(bundle));
    const expectedHash = String(
      input.bundleHash ||
        input.expectedBundleHash ||
        input.contextBundle?.bundleHash ||
        input.context_bundle?.bundleHash ||
        ""
    ).trim();
    if (expectedHash && expectedHash !== bundleHash) {
      return { ok: false, error: "工作空间上下文压缩包 hash 校验失败。" };
    }

    const context = asObject(bundle.context);
    const resolvedProfile = asObject(bundle.resolvedProfile);
    const profileKnowledgeScope = asObject(resolvedProfile.knowledgeScope);
    const requestedRestoredSourceIds = uniqueStrings(asArray(context.knowledgeSourceIds).length
      ? asArray(context.knowledgeSourceIds)
      : asArray(profileKnowledgeScope.includeSourceIds));
    const currentlyAccessibleSourceIds = new Set(resolveWorkspaceSourceIds(targetWorkspaceId));
    const targetOwnerUserId = String(targetWorkspace?.ownerUserId || targetWorkspace?.metadata?.ownerUserId || "").trim();
    const access = workspaceAccess(options);
    const legacyInternalRestore = !targetOwnerUserId && access.actorIds.length === 0 && access.allowedWorkspaceIds.size === 0;
    const canImportRequestedSourceIds = options.canAccessAll === true || legacyInternalRestore;
    const restoredSourceIds = canImportRequestedSourceIds
      ? requestedRestoredSourceIds
      : requestedRestoredSourceIds.filter((sourceId) => currentlyAccessibleSourceIds.has(sourceId));
    const skippedSourceIds = requestedRestoredSourceIds.filter((sourceId) => !restoredSourceIds.includes(sourceId));
    const profilePatch = {
      ...resolvedProfile,
      contextProfileId: context.contextProfileId || resolvedProfile.contextProfileId || "",
      toolGrantId: context.toolGrantId || resolvedProfile.toolGrantId || "",
      modelAlias: context.modelAlias || resolvedProfile.modelAlias || "",
      knowledgeScope: {
        ...profileKnowledgeScope,
        includeSourceIds: restoredSourceIds,
        excludeSourceIds: asArray(profileKnowledgeScope.excludeSourceIds)
      }
    };
    const swapResult = hotSwapProfile(targetWorkspaceId, profilePatch, options);
    if (!swapResult.ok) {
      return swapResult;
    }

    const sourceWorkspace = asObject(bundle.workspace);
    const timestamp = nowIso();
    const runId = stableId("context_restore_run", targetWorkspaceId, bundleHash);
    const artifactId = stableId("context_restore_artifact", targetWorkspaceId, bundleHash);
    createRun({
      runId,
      workspaceId: targetWorkspaceId,
      runType: "context_bundle_restore",
      status: "completed",
      input: {
        sourceWorkspaceId: sourceWorkspace.workspaceId || context.workspaceId || "",
        sourceContextFingerprint: context.contextFingerprint || "",
        bundleHash,
        skippedKnowledgeSourceIds: skippedSourceIds
      },
      steps: [
        {
          id: "decode",
          status: "completed",
          at: timestamp
        },
        {
          id: "apply_profile",
          status: "completed",
          at: timestamp
        }
      ],
      coverage: {
        restoredProfile: Boolean(profilePatch.contextProfileId || profilePatch.modelAlias || profilePatch.toolGrantId),
        restoredKnowledgeSourceCount: restoredSourceIds.length,
        skippedKnowledgeSourceCount: skippedSourceIds.length,
        restoredArtifactCount: asArray(bundle.recent?.artifacts).length,
        restoredRunCount: asArray(bundle.recent?.runs).length
      },
      artifactIds: [artifactId],
      startedAt: timestamp,
      completedAt: timestamp
    });
    const handoffMarkdown = normalizeText(bundle.handoffMarkdown)
      ? bundle.handoffMarkdown
      : buildWorkspaceHandoffMarkdown(bundle);
    createArtifact({
      artifactId,
      workspaceId: targetWorkspaceId,
      runId,
      level: "ContextBundleHandoff",
      title: `Restored context bundle: ${sourceWorkspace.title || sourceWorkspace.workspaceId || "workspace"}`,
      content: handoffMarkdown,
      citations: [],
      coverageReport: {
        bundleHash,
        sourceWorkspaceId: sourceWorkspace.workspaceId || context.workspaceId || "",
        sourceContextFingerprint: context.contextFingerprint || "",
        restoredKnowledgeSourceCount: restoredSourceIds.length,
        skippedKnowledgeSourceCount: skippedSourceIds.length
      },
      status: "accepted",
      createdBy: String(options.actorUserId || "context-bundle-restore")
    });

    return {
      protocolVersion: AGENT_WORKSPACE_PROTOCOL_VERSION,
      bundleVersion: AGENT_WORKSPACE_CONTEXT_BUNDLE_VERSION,
      ok: true,
      workspace: hydrateWorkspace(selectWorkspaceRawStmt.get(targetWorkspaceId)),
      restoredContext: getWorkspaceContext(targetWorkspaceId, options),
      source: {
        workspaceId: sourceWorkspace.workspaceId || context.workspaceId || "",
        contextFingerprint: context.contextFingerprint || "",
        generatedAt: bundle.generatedAt || ""
      },
      bundleHash,
      runId,
      artifactId,
      applied: {
        contextProfileId: profilePatch.contextProfileId,
        toolGrantId: profilePatch.toolGrantId,
        modelAlias: profilePatch.modelAlias,
        knowledgeSourceCount: restoredSourceIds.length,
        skippedKnowledgeSourceCount: skippedSourceIds.length
      }
    };
  }

  // ── Inheritance management ─────────────────────────────────────────────────

  /**
   * Set or clear a workspace's parent (inheritance). Validates no cycles.
   * @param {string} childId
   * @param {string|null} parentId  null = remove inheritance
   */
  function setWorkspaceParent(childId, parentId, options = {}) {
    if (!selectWorkspaceRawStmt.get(childId)) {
      return { ok: false, error: "子工作空间不存在" };
    }
    if (!canAccessWorkspaceId(childId, options)) {
      return { ok: false, error: "工作空间不可访问" };
    }
    if (parentId) {
      if (!selectWorkspaceRawStmt.get(parentId)) {
        return { ok: false, error: "父工作空间不存在" };
      }
      if (!canAccessWorkspaceId(parentId, options)) {
        return { ok: false, error: "父工作空间不可访问" };
      }
      // Cycle detection: parentId must not be in childId's existing subtree
      try {
        resolveWorkspaceChain(parentId);  // will throw if parentId already descends from childId
      } catch {
        return { ok: false, error: "设置会导致继承链循环" };
      }
      // Also check: childId must not be an ancestor of parentId
      const chainOfParent = resolveWorkspaceChain(parentId);
      if (chainOfParent.some((ws) => ws.workspaceId === childId)) {
        return { ok: false, error: "设置会导致继承链循环" };
      }
    }
    const ts = nowIso();
    db.prepare(
      "UPDATE aw_workspaces SET parent_workspace_id = ?, current_generation = current_generation + 1, updated_at = ? WHERE workspace_id = ?"
    ).run(parentId || null, ts, childId);
    return { ok: true, workspace: hydrateWorkspace(selectWorkspaceRawStmt.get(childId)) };
  }

  // ── Profile / hot-swap ────────────────────────────────────────────────────

  /**
   * Update a workspace's profile layer and increment currentGeneration.
   * In-flight agents that already have a context snapshot will finish with the
   * old configuration.  New calls to getWorkspaceContext() will see the new profile.
   *
   * @param {string} workspaceId
   * @param {object} profilePatch  Partial profile; only declared fields are overwritten.
   * @returns {{ ok: boolean, workspace, newGeneration }}
   */
  function hotSwapProfile(workspaceId, profilePatch, options = {}) {
    const row = selectWorkspaceRawStmt.get(workspaceId);
    if (!row) return { ok: false, error: "工作空间不存在" };
    if (!canAccessWorkspace(hydrateWorkspace(row), options)) {
      return { ok: false, error: "工作空间不可访问" };
    }
    const existing = hydrateWorkspace(row);
    const existingProfile = existing.profile || {};

    // Deep-merge the profile patch
    const newProfile = {
      ...existingProfile,
      ...profilePatch,
      knowledgeScope: {
        ...(existingProfile.knowledgeScope || {}),
        ...(profilePatch.knowledgeScope || {}),
      }
    };

    const ts = nowIso();
    db.prepare(
      "UPDATE aw_workspaces SET profile_json = ?, current_generation = current_generation + 1, updated_at = ? WHERE workspace_id = ?"
    ).run(stringifyJson(newProfile), ts, workspaceId);

    const updated = hydrateWorkspace(selectWorkspaceRawStmt.get(workspaceId));
    return { ok: true, workspace: updated, newGeneration: updated.currentGeneration };
  }

  /**
   * Add or update owned source IDs for a workspace (the workspace "owns" this knowledge).
   */
  function setOwnedSourceIds(workspaceId, sourceIds, options = {}) {
    const row = selectWorkspaceRawStmt.get(workspaceId);
    if (!row) return { ok: false, error: "工作空间不存在" };
    if (!canAccessWorkspace(hydrateWorkspace(row), options)) {
      return { ok: false, error: "工作空间不可访问" };
    }
    const unique = [...new Set(asArray(sourceIds).filter(Boolean))];
    const ts = nowIso();
    db.prepare(
      "UPDATE aw_workspaces SET owned_source_ids_json = ?, current_generation = current_generation + 1, updated_at = ? WHERE workspace_id = ?"
    ).run(stringifyJson(unique), ts, workspaceId);
    return { ok: true, workspace: hydrateWorkspace(selectWorkspaceRawStmt.get(workspaceId)) };
  }

  // ── Workspace sharing ─────────────────────────────────────────────────────

  /**
   * Grant workspace `targetId` access to workspace `sourceId`'s resolved knowledge.
   * After this call, resolveWorkspaceSourceIds(targetId) will include
   * all sources from sourceId.
   *
   * @param {string} sourceId  The workspace granting access ("I share MY knowledge")
   * @param {string} targetId  The workspace receiving access ("they get access to MY knowledge")
   */
  function shareWorkspace(sourceId, targetId, options = {}) {
    if (!selectWorkspaceRawStmt.get(sourceId)) return { ok: false, error: "来源工作空间不存在" };
    const targetRow = selectWorkspaceRawStmt.get(targetId);
    if (!targetRow) return { ok: false, error: "目标工作空间不存在" };
    if (!canAccessWorkspaceId(sourceId, options) || !canAccessWorkspace(hydrateWorkspace(targetRow), options)) {
      return { ok: false, error: "工作空间不可访问" };
    }
    if (sourceId === targetId) return { ok: false, error: "不能共享给自身" };
    const target = hydrateWorkspace(targetRow);
    const existing = new Set(target.accessibleWorkspaceIds);
    if (existing.has(sourceId)) return { ok: true, workspace: target, alreadyShared: true };
    existing.add(sourceId);
    const ts = nowIso();
    db.prepare(
      "UPDATE aw_workspaces SET accessible_workspace_ids_json = ?, current_generation = current_generation + 1, updated_at = ? WHERE workspace_id = ?"
    ).run(JSON.stringify([...existing]), ts, targetId);
    return { ok: true, workspace: hydrateWorkspace(selectWorkspaceRawStmt.get(targetId)) };
  }

  /**
   * Revoke workspace `targetId`'s access to `sourceId`'s knowledge.
   */
  function unshareWorkspace(sourceId, targetId, options = {}) {
    const targetRow = selectWorkspaceRawStmt.get(targetId);
    if (!targetRow) return { ok: false, error: "目标工作空间不存在" };
    if (!canAccessWorkspaceId(sourceId, options) || !canAccessWorkspace(hydrateWorkspace(targetRow), options)) {
      return { ok: false, error: "工作空间不可访问" };
    }
    const target = hydrateWorkspace(targetRow);
    const updated = target.accessibleWorkspaceIds.filter((id) => id !== sourceId);
    if (updated.length === target.accessibleWorkspaceIds.length) {
      return { ok: true, workspace: target, wasShared: false };
    }
    const ts = nowIso();
    db.prepare(
      "UPDATE aw_workspaces SET accessible_workspace_ids_json = ?, current_generation = current_generation + 1, updated_at = ? WHERE workspace_id = ?"
    ).run(JSON.stringify(updated), ts, targetId);
    return { ok: true, workspace: hydrateWorkspace(selectWorkspaceRawStmt.get(targetId)), wasShared: true };
  }

  function deleteWorkspace(workspaceId, options = {}) {
    const ws = getWorkspace({ workspaceId, ...options });
    if (!ws) return { ok: false, error: "工作空间不存在或无权限" };
    const fsPath = ws.workspace.fsPath;

    db.transaction(() => {
      db.prepare("DELETE FROM aw_session_events WHERE workspace_id = ?").run(workspaceId);
      db.prepare("DELETE FROM aw_sessions WHERE workspace_id = ?").run(workspaceId);
      db.prepare("DELETE FROM aw_locks WHERE workspace_id = ?").run(workspaceId);
      db.prepare("DELETE FROM aw_decisions WHERE workspace_id = ?").run(workspaceId);
      db.prepare("DELETE FROM aw_issues WHERE workspace_id = ?").run(workspaceId);
      db.prepare("DELETE FROM aw_artifacts WHERE workspace_id = ?").run(workspaceId);
      db.prepare("DELETE FROM aw_submissions WHERE workspace_id = ?").run(workspaceId);
      db.prepare("DELETE FROM aw_private_state WHERE workspace_id = ?").run(workspaceId);
      db.prepare("DELETE FROM aw_runs WHERE workspace_id = ?").run(workspaceId);
      db.prepare("DELETE FROM aw_workspaces WHERE workspace_id = ?").run(workspaceId);
    })();

    if (options.deleteFolder && fsPath) {
      try {
        if (fs.existsSync(fsPath)) {
          fs.rmSync(fsPath, { recursive: true, force: true });
        }
      } catch (e) {
        console.error(`[AgentWorkspace] Failed to delete folder ${fsPath}:`, e);
      }
    }
    
    return { ok: true, deleted: true };
  }

  return {
    protocolVersion: AGENT_WORKSPACE_PROTOCOL_VERSION,
    rootPath,
    createWorkspace,
    migrateOwnerlessWorkspaces,
    deleteWorkspace,
    listWorkspaces,
    getWorkspace,
    createSession,
    listSessions,
    getSession,
    getSessionContext,
    appendSessionEvent,
    forkSession,
    compareSessions,
    createSessionMergeProposal,
    archiveSession,
    createRun,
    updateRun,
    getRun,
    savePrivateState,
    submit,
    resolveSubmission,
    createArtifact,
    createWorkspaceFolder,
    listWorkspaceFiles,
    workspaceFileMetadata,
    uploadWorkspaceFile,
    writeWorkspaceFile,
    patchWorkspaceFile,
    downloadWorkspaceFile,
    deleteWorkspaceFile,
    moveWorkspaceFile,
    connectLocalDirectory,
    listLocalDirectoryMounts,
    listLocalDirectoryItems,
    localDirectorySyncPlan,
    applyLocalDirectorySync,
    restoreWorkspaceFiles,
    updateArtifactsStatus,
    createIssue,
    updateIssue,
    createDecision,
    listRunArtifacts,
    acquireLock,
    releaseLock,
    adminReleaseLock,
    listLocks,
    // ── New: inheritance, profile, sharing ──
    resolveWorkspaceChain,
    resolveWorkspaceProfile,
    resolveWorkspaceSourceIds,
    getWorkspaceContext,
    exportWorkspaceContextBundle,
    restoreWorkspaceContextBundle,
    setWorkspaceParent,
    hotSwapProfile,
    setOwnedSourceIds,
    shareWorkspace,
    unshareWorkspace,
    close
  };
}

export default createAgentWorkspace;
