import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { ServerConfig } from "../config/ServerConfig.mjs";

export const OPERATION_LEDGER_PROTOCOL_VERSION = "v0.0.1:operation:ledger-1";

const SENSITIVE_KEY_PATTERN =
  /token|secret|password|passwd|authorization|cookie|api[-_]?key|client[-_]?secret|csrf/i;
const MAX_JSON_BYTES = 16 * 1024;

function nowIso() {
  return new Date().toISOString();
}

function asObject(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === "") return [];
  return [value];
}

function stableJson(value) {
  if (value === undefined || value === null) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Buffer.isBuffer(value)) {
    return JSON.stringify({
      type: "buffer",
      byteLength: value.length,
      sha256: crypto.createHash("sha256").update(value).digest("hex")
    });
  }
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
    .join(",")}}`;
}

function hashValue(value) {
  return crypto.createHash("sha256").update(stableJson(value)).digest("hex");
}

function truncateJson(value) {
  const text = JSON.stringify(value ?? {});
  if (Buffer.byteLength(text, "utf8") <= MAX_JSON_BYTES) {
    return value;
  }
  return {
    redacted: true,
    reason: "payload_too_large",
    byteLength: Buffer.byteLength(text, "utf8"),
    sha256: crypto.createHash("sha256").update(text).digest("hex")
  };
}

function redactValue(value, depth = 0) {
  if (depth > 8) return "<redacted-depth>";
  if (value === null || value === undefined) return value;
  if (Buffer.isBuffer(value)) {
    return {
      redacted: true,
      reason: "buffer",
      byteLength: value.length,
      sha256: crypto.createHash("sha256").update(value).digest("hex")
    };
  }
  if (typeof value === "string") {
    if (value.length > 4096) {
      return {
        redacted: true,
        reason: "large_string",
        byteLength: Buffer.byteLength(value, "utf8"),
        sha256: crypto.createHash("sha256").update(value).digest("hex")
      };
    }
    return value;
  }
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return truncateJson(value.map((item) => redactValue(item, depth + 1)));
  const output = {};
  for (const [key, nested] of Object.entries(value)) {
    output[key] = SENSITIVE_KEY_PATTERN.test(key) ? "<redacted>" : redactValue(nested, depth + 1);
  }
  return truncateJson(output);
}

function stringifyJson(value) {
  return JSON.stringify(value ?? {});
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(String(value || ""));
  } catch {
    return fallback;
  }
}

function ledgerId() {
  return `operation_ledger_${crypto.randomUUID().replace(/-/g, "")}`;
}

function dbPathFor(userDataPath = "") {
  const root = userDataPath || ServerConfig.getDataDir();
  return path.join(root, "operation-ledger", "operation-ledger.sqlite");
}

function ensureSchema(db) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;

    CREATE TABLE IF NOT EXISTS operation_ledger_entries (
      ledger_id TEXT PRIMARY KEY,
      protocol_version TEXT NOT NULL DEFAULT '${OPERATION_LEDGER_PROTOCOL_VERSION}',
      operation_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL DEFAULT '',
      semantic TEXT NOT NULL DEFAULT '',
      asset_ref TEXT NOT NULL DEFAULT '',
      target_kind TEXT NOT NULL DEFAULT '',
      target_ref_json TEXT NOT NULL DEFAULT '{}',
      subject_json TEXT NOT NULL DEFAULT '{}',
      risk TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'started',
      idempotency_key TEXT NOT NULL DEFAULT '',
      input_hash TEXT NOT NULL DEFAULT '',
      redacted_input_json TEXT NOT NULL DEFAULT '{}',
      policy_decision_json TEXT NOT NULL DEFAULT '{}',
      warning_json TEXT NOT NULL DEFAULT '[]',
      receipt_refs_json TEXT NOT NULL DEFAULT '[]',
      audit_id TEXT NOT NULL DEFAULT '',
      error_json TEXT NOT NULL DEFAULT '{}',
      started_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_operation_ledger_workspace ON operation_ledger_entries(workspace_id, updated_at);
    CREATE INDEX IF NOT EXISTS idx_operation_ledger_operation ON operation_ledger_entries(operation_id, updated_at);
    CREATE INDEX IF NOT EXISTS idx_operation_ledger_status ON operation_ledger_entries(status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_operation_ledger_idempotency ON operation_ledger_entries(workspace_id, operation_id, idempotency_key, input_hash);
  `);
}

function hydrate(row, extra = {}) {
  if (!row) return null;
  return {
    protocolVersion: row.protocol_version || OPERATION_LEDGER_PROTOCOL_VERSION,
    ledgerEventId: row.ledger_id,
    ledgerId: row.ledger_id,
    operationId: row.operation_id,
    workspaceId: row.workspace_id || "",
    semantic: row.semantic || "",
    assetRef: row.asset_ref || "",
    targetKind: row.target_kind || "",
    targetRef: parseJson(row.target_ref_json, {}),
    subject: parseJson(row.subject_json, {}),
    risk: row.risk || "",
    status: row.status || "",
    idempotencyKey: row.idempotency_key || "",
    inputHash: row.input_hash || "",
    redactedInput: parseJson(row.redacted_input_json, {}),
    policyDecision: parseJson(row.policy_decision_json, {}),
    warnings: parseJson(row.warning_json, []),
    receiptRefs: parseJson(row.receipt_refs_json, []),
    auditId: row.audit_id || "",
    error: parseJson(row.error_json, {}),
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    ...extra
  };
}

export function createOperationLedger({ userDataPath = "" } = {}) {
  const filePath = dbPathFor(userDataPath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const db = new Database(filePath);
  ensureSchema(db);

  const insertEntryStmt = db.prepare(`
    INSERT INTO operation_ledger_entries (
      ledger_id, operation_id, workspace_id, semantic, asset_ref, target_kind,
      target_ref_json, subject_json, risk, status, idempotency_key, input_hash,
      redacted_input_json, policy_decision_json, warning_json, receipt_refs_json,
      audit_id, error_json, started_at, updated_at
    )
    VALUES (
      @ledgerId, @operationId, @workspaceId, @semantic, @assetRef, @targetKind,
      @targetRefJson, @subjectJson, @risk, @status, @idempotencyKey, @inputHash,
      @redactedInputJson, @policyDecisionJson, @warningJson, @receiptRefsJson,
      @auditId, @errorJson, @startedAt, @updatedAt
    )
  `);
  const selectEntryStmt = db.prepare("SELECT * FROM operation_ledger_entries WHERE ledger_id = ?");
  const selectIdempotentStmt = db.prepare(`
    SELECT * FROM operation_ledger_entries
    WHERE workspace_id = ? AND operation_id = ? AND idempotency_key = ? AND input_hash = ?
    ORDER BY started_at ASC
    LIMIT 1
  `);
  const updateEntryStmt = db.prepare(`
    UPDATE operation_ledger_entries
    SET status = @status,
        asset_ref = COALESCE(NULLIF(@assetRef, ''), asset_ref),
        receipt_refs_json = @receiptRefsJson,
        warning_json = @warningJson,
        audit_id = COALESCE(NULLIF(@auditId, ''), audit_id),
        error_json = @errorJson,
        updated_at = @updatedAt
    WHERE ledger_id = @ledgerId
  `);
  const listEntriesStmt = db.prepare(`
    SELECT * FROM operation_ledger_entries
    WHERE (@workspaceId = '' OR workspace_id = @workspaceId)
      AND (@operationId = '' OR operation_id = @operationId)
      AND (@status = '' OR status = @status)
    ORDER BY updated_at DESC
    LIMIT @limit
  `);

  function getEntry(ledgerEventId = "") {
    return hydrate(selectEntryStmt.get(String(ledgerEventId || "")));
  }

  function startEntry(input = {}) {
    const operationId = String(input.operationId || "").trim();
    if (!operationId) {
      throw new Error("operationId is required for operation ledger.");
    }
    const workspaceId = String(input.workspaceId || "").trim();
    const redactedInput = redactValue(input.input || {});
    const inputHash = input.inputHash || hashValue(redactedInput);
    const idempotencyKey = String(input.idempotencyKey || "").trim();
    if (idempotencyKey) {
      const existing = selectIdempotentStmt.get(workspaceId, operationId, idempotencyKey, inputHash);
      if (existing) {
        return hydrate(existing, { replayed: true });
      }
    }
    const timestamp = nowIso();
    const row = {
      ledgerId: ledgerId(),
      operationId,
      workspaceId,
      semantic: String(input.semantic || ""),
      assetRef: String(input.assetRef || ""),
      targetKind: String(input.targetKind || ""),
      targetRefJson: stringifyJson(redactValue(asObject(input.targetRef))),
      subjectJson: stringifyJson(redactValue(asObject(input.subject))),
      risk: String(input.risk || ""),
      status: String(input.status || "started"),
      idempotencyKey,
      inputHash,
      redactedInputJson: stringifyJson(redactedInput),
      policyDecisionJson: stringifyJson(redactValue(asObject(input.policyDecision))),
      warningJson: stringifyJson(asArray(input.warnings)),
      receiptRefsJson: stringifyJson(asArray(input.receiptRefs)),
      auditId: String(input.auditId || ""),
      errorJson: stringifyJson({}),
      startedAt: timestamp,
      updatedAt: timestamp
    };
    insertEntryStmt.run(row);
    return getEntry(row.ledgerId);
  }

  function updateEntry(ledgerEventId, patch = {}) {
    const current = getEntry(ledgerEventId);
    if (!current) return null;
    const nextWarnings = [
      ...asArray(current.warnings),
      ...asArray(patch.warnings)
    ];
    const nextReceiptRefs = [
      ...asArray(current.receiptRefs),
      ...asArray(patch.receiptRefs)
    ].filter(Boolean);
    updateEntryStmt.run({
      ledgerId: current.ledgerId,
      status: String(patch.status || current.status || "unknown"),
      assetRef: String(patch.assetRef || ""),
      receiptRefsJson: stringifyJson([...new Set(nextReceiptRefs)]),
      warningJson: stringifyJson(nextWarnings),
      auditId: String(patch.auditId || ""),
      errorJson: stringifyJson(redactValue(asObject(patch.error))),
      updatedAt: nowIso()
    });
    return getEntry(current.ledgerId);
  }

  function completeEntry(ledgerEventId, patch = {}) {
    return updateEntry(ledgerEventId, {
      ...patch,
      status: patch.status || "succeeded",
      error: {}
    });
  }

  function failEntry(ledgerEventId, patch = {}) {
    return updateEntry(ledgerEventId, {
      ...patch,
      status: patch.status || "failed",
      error: patch.error || {}
    });
  }

  function listEntries(input = {}) {
    const limit = Math.max(1, Math.min(Number(input.limit || 100), 500));
    const items = listEntriesStmt.all({
      workspaceId: String(input.workspaceId || ""),
      operationId: String(input.operationId || ""),
      status: String(input.status || ""),
      limit
    }).map((row) => hydrate(row));
    return {
      protocolVersion: OPERATION_LEDGER_PROTOCOL_VERSION,
      items,
      count: items.length
    };
  }

  return {
    protocolVersion: OPERATION_LEDGER_PROTOCOL_VERSION,
    filePath,
    startEntry,
    completeEntry,
    failEntry,
    getEntry,
    listEntries
  };
}
