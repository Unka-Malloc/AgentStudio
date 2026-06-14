import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

import { runMigrations } from "../../storage/sqlite-migrations.mjs";
import { assertQueueDefinitionCanEnqueue, normalizeStructuredQueueScope } from "./definitions.mjs";
import { queueIdentityGenerator } from "./identity.mjs";
import { computeDeterministicBackoff, DEFAULT_QUEUE_POLICY } from "./policies.mjs";
import {
  assertLegalWorkQueueTransition,
  isTerminalWorkQueueState,
  WORK_QUEUE_STATES
} from "./state-machine.mjs";
import { systemQueueTimeSource } from "./time-source.mjs";

const SQLITE_MIGRATION_REVISION = 1;
const TERMINAL_STATE_SQL = `'${WORK_QUEUE_STATES.ACKED}', '${WORK_QUEUE_STATES.TERMINATED}'`;

function toText(value) {
  return String(value ?? "").trim();
}

function asObject(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
}

function asArray(value, fallback = []) {
  return Array.isArray(value) ? value : fallback;
}

function asInt(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function asPositiveInt(value, fallback = 1) {
  return Math.max(1, asInt(value, fallback));
}

function jsonString(value, fallback = null) {
  return JSON.stringify(value ?? fallback);
}

function parseJson(value, fallback) {
  try {
    const parsed = JSON.parse(value || "");
    return parsed === undefined || parsed === null ? fallback : parsed;
  } catch {
    return fallback;
  }
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

function normalizeScope(scope = {}) {
  return normalizeStructuredQueueScope(scope);
}

function scopeKeyFromScope(scope = {}) {
  return stableJson(normalizeScope(scope));
}

function nowFrom(timeSource, override) {
  return asInt(override, asInt(timeSource.nowMs(), Date.now()));
}

function getPolicy(inputPolicy = {}) {
  return {
    ...DEFAULT_QUEUE_POLICY,
    ...asObject(inputPolicy),
    retryBackoff: {
      ...DEFAULT_QUEUE_POLICY.retryBackoff,
      ...asObject(inputPolicy.retryBackoff)
    },
    fallbackRetry: {
      ...DEFAULT_QUEUE_POLICY.fallbackRetry,
      ...asObject(inputPolicy.fallbackRetry)
    },
    backgroundWriteRetry: {
      ...DEFAULT_QUEUE_POLICY.backgroundWriteRetry,
      ...asObject(inputPolicy.backgroundWriteRetry)
    },
    memoryGuard: {
      ...DEFAULT_QUEUE_POLICY.memoryGuard,
      ...asObject(inputPolicy.memoryGuard)
    }
  };
}

function resolveQueueDefinition(input = {}, { assertEnqueue = false, allowAllVersions = false } = {}) {
  const definition = asObject(input.queueDefinition || input.definition, {});
  const queueDefinitionId = toText(
    input.queueDefinitionId ||
      definition.queueDefinitionId ||
      input.queueId ||
      definition.queueId
  );
  if (!queueDefinitionId) {
    throw new Error("queueDefinitionId is required.");
  }
  const rawVersion = input.queueDefinitionVersion ??
    input.version ??
    definition.queueDefinitionVersion ??
    definition.version;
  const queueDefinitionVersion = rawVersion === undefined && allowAllVersions
    ? 0
    : asPositiveInt(rawVersion, 1);
  if (assertEnqueue && Object.keys(definition).length) {
    assertQueueDefinitionCanEnqueue(definition);
  }
  return {
    queueDefinitionId,
    queueDefinitionVersion,
    queueDefinition: definition
  };
}

function normalizePayloadRef(value) {
  const payloadRef = asObject(value, null);
  if (!payloadRef || Object.keys(payloadRef).length === 0) {
    throw new Error("payloadRef is required and must be a structured reference.");
  }
  return payloadRef;
}

function normalizeOwnerRef(value) {
  return asObject(value, {});
}

function rowToWorkItem(row) {
  if (!row) {
    return null;
  }
  const leaseId = toText(row.lease_id);
  return {
    workItemId: row.work_item_id,
    queueDefinitionId: row.queue_definition_id,
    queueDefinitionVersion: row.queue_definition_version,
    scopeKey: row.scope_key,
    scope: parseJson(row.scope_json, {}),
    dedupeKey: row.dedupe_key || "",
    state: row.state,
    ownerRef: parseJson(row.owner_ref_json, {}),
    payloadRef: parseJson(row.payload_ref_json, {}),
    payloadKind: row.payload_kind || "",
    priority: row.priority,
    availableAtMs: row.available_at_ms,
    attempt: row.attempt,
    maxAttempts: row.max_attempts,
    lease: leaseId
      ? {
          leaseId,
          leaseSeq: row.lease_seq,
          workerId: row.leased_by_worker_id,
          expiresAtMs: row.lease_expires_at_ms
        }
      : null,
    concurrencyKey: row.concurrency_key || "",
    routeVersion: row.route_version || "",
    policyVersion: row.policy_version || "",
    fallbackTaskId: row.fallback_task_id || "",
    lastError: parseJson(row.last_error_json, {}),
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms,
    lastTransitionSeq: row.last_transition_seq
  };
}

function journalRowToTransition(row) {
  return {
    seq: row.seq,
    journalEntryId: row.journal_entry_id,
    workItemId: row.work_item_id,
    queueDefinitionId: row.queue_definition_id,
    queueDefinitionVersion: row.queue_definition_version,
    transition: row.transition,
    fromState: row.from_state || null,
    toState: row.to_state,
    leaseId: row.lease_id || "",
    leaseSeq: row.lease_seq,
    operationId: row.operation_id || "",
    actor: parseJson(row.actor_json, {}),
    reason: row.reason || "",
    policyVersion: row.policy_version || "",
    decision: parseJson(row.decision_json, {}),
    createdAtMs: row.created_at_ms,
    adoptedTimeMs: row.adopted_time_ms
  };
}

function ensureSchema(db) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
  `);

  runMigrations(db, [
    {
      version: SQLITE_MIGRATION_REVISION,
      up: (migrationDb) => migrationDb.exec(`
        CREATE TABLE IF NOT EXISTS queue_definitions (
          queue_definition_id TEXT NOT NULL,
          queue_definition_version INTEGER NOT NULL,
          label TEXT NOT NULL,
          lifecycle_state TEXT NOT NULL,
          owner_capability TEXT NOT NULL,
          allow_deprecated_enqueue INTEGER NOT NULL DEFAULT 0,
          metadata_json TEXT NOT NULL DEFAULT '{}',
          policy_json TEXT NOT NULL DEFAULT '{}',
          routes_json TEXT NOT NULL DEFAULT '[]',
          label_history_json TEXT NOT NULL DEFAULT '[]',
          registered_at_ms INTEGER NOT NULL,
          updated_at_ms INTEGER NOT NULL,
          PRIMARY KEY (queue_definition_id, queue_definition_version),
          UNIQUE (label)
        );

        CREATE TABLE IF NOT EXISTS work_items (
          work_item_id TEXT PRIMARY KEY,
          queue_definition_id TEXT NOT NULL,
          queue_definition_version INTEGER NOT NULL,
          scope_key TEXT NOT NULL,
          scope_json TEXT NOT NULL,
          dedupe_key TEXT NOT NULL DEFAULT '',
          state TEXT NOT NULL,
          owner_ref_json TEXT NOT NULL DEFAULT '{}',
          payload_ref_json TEXT NOT NULL DEFAULT '{}',
          payload_kind TEXT NOT NULL DEFAULT '',
          priority INTEGER NOT NULL DEFAULT 0,
          available_at_ms INTEGER NOT NULL,
          attempt INTEGER NOT NULL DEFAULT 0,
          max_attempts INTEGER NOT NULL,
          lease_id TEXT NOT NULL DEFAULT '',
          lease_seq INTEGER NOT NULL DEFAULT 0,
          leased_by_worker_id TEXT NOT NULL DEFAULT '',
          lease_expires_at_ms INTEGER NOT NULL DEFAULT 0,
          concurrency_key TEXT NOT NULL DEFAULT '',
          route_version TEXT NOT NULL DEFAULT '',
          policy_version TEXT NOT NULL DEFAULT '',
          fallback_task_id TEXT NOT NULL DEFAULT '',
          last_error_json TEXT NOT NULL DEFAULT '{}',
          last_transition_seq INTEGER NOT NULL DEFAULT 0,
          created_at_ms INTEGER NOT NULL,
          updated_at_ms INTEGER NOT NULL
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_work_queue_dedupe_nonterminal
          ON work_items(queue_definition_id, scope_key, dedupe_key)
          WHERE dedupe_key <> '' AND state NOT IN (${TERMINAL_STATE_SQL});

        CREATE INDEX IF NOT EXISTS idx_work_queue_claim
          ON work_items(queue_definition_id, scope_key, state, available_at_ms, priority, created_at_ms);

        CREATE INDEX IF NOT EXISTS idx_work_queue_lease_expiry
          ON work_items(state, lease_expires_at_ms);

        CREATE INDEX IF NOT EXISTS idx_work_queue_concurrency
          ON work_items(queue_definition_id, scope_key, concurrency_key, state);

        CREATE TABLE IF NOT EXISTS work_queue_transition_journal (
          seq INTEGER PRIMARY KEY AUTOINCREMENT,
          journal_entry_id TEXT NOT NULL UNIQUE,
          work_item_id TEXT NOT NULL,
          queue_definition_id TEXT NOT NULL,
          queue_definition_version INTEGER NOT NULL,
          transition TEXT NOT NULL,
          from_state TEXT,
          to_state TEXT NOT NULL,
          lease_id TEXT NOT NULL DEFAULT '',
          lease_seq INTEGER NOT NULL DEFAULT 0,
          operation_id TEXT NOT NULL DEFAULT '',
          actor_json TEXT NOT NULL DEFAULT '{}',
          reason TEXT NOT NULL DEFAULT '',
          policy_version TEXT NOT NULL DEFAULT '',
          decision_json TEXT NOT NULL DEFAULT '{}',
          created_at_ms INTEGER NOT NULL,
          adopted_time_ms INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_work_queue_journal_item
          ON work_queue_transition_journal(work_item_id, seq);

        CREATE INDEX IF NOT EXISTS idx_work_queue_journal_queue
          ON work_queue_transition_journal(queue_definition_id, queue_definition_version, seq);

        CREATE TABLE IF NOT EXISTS work_queue_background_writes (
          background_write_id TEXT PRIMARY KEY,
          aspect_type TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          state_json TEXT NOT NULL DEFAULT '{}',
          status TEXT NOT NULL DEFAULT 'committed',
          attempt INTEGER NOT NULL DEFAULT 0,
          next_retry_at_ms INTEGER NOT NULL DEFAULT 0,
          last_error_json TEXT NOT NULL DEFAULT '{}',
          created_at_ms INTEGER NOT NULL,
          updated_at_ms INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_work_queue_background_writes_type_entity
          ON work_queue_background_writes(aspect_type, entity_id);

        CREATE TABLE IF NOT EXISTS work_queue_fallback_tasks (
          fallback_task_id TEXT PRIMARY KEY,
          work_item_id TEXT NOT NULL,
          state TEXT NOT NULL,
          attempt INTEGER NOT NULL DEFAULT 0,
          max_attempts INTEGER NOT NULL DEFAULT 0,
          reason TEXT NOT NULL DEFAULT '',
          decision_json TEXT NOT NULL DEFAULT '{}',
          created_at_ms INTEGER NOT NULL,
          updated_at_ms INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS work_queue_internal_health (
          health_key TEXT PRIMARY KEY,
          state_json TEXT NOT NULL DEFAULT '{}',
          updated_at_ms INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS work_queue_controls (
          queue_definition_id TEXT NOT NULL,
          scope_key TEXT NOT NULL DEFAULT '',
          mode TEXT NOT NULL DEFAULT 'active',
          reason TEXT NOT NULL DEFAULT '',
          actor_json TEXT NOT NULL DEFAULT '{}',
          updated_at_ms INTEGER NOT NULL,
          PRIMARY KEY (queue_definition_id, scope_key)
        );
      `)
    }
  ]);
}

export function getWorkQueueDatabaseDirectory(userDataPath) {
  return path.join(String(userDataPath || ""), "work-queue");
}

export function getWorkQueueDatabasePath(userDataPath) {
  return path.join(getWorkQueueDatabaseDirectory(userDataPath), "work-queue.sqlite");
}

export function createSqliteWorkQueueStore({
  userDataPath = "",
  databasePath = "",
  db = null,
  timeSource = systemQueueTimeSource,
  identityGenerator = queueIdentityGenerator,
  policy = DEFAULT_QUEUE_POLICY
} = {}) {
  const resolvedPolicy = getPolicy(policy);
  const resolvedDatabasePath = db ? "" : path.resolve(databasePath || getWorkQueueDatabasePath(userDataPath));
  if (!db && !resolvedDatabasePath) {
    throw new Error("Work queue SQLite store requires userDataPath or databasePath.");
  }
  if (!db) {
    fs.mkdirSync(path.dirname(resolvedDatabasePath), { recursive: true });
  }
  const database = db || new Database(resolvedDatabasePath);
  const ownsDatabase = !db;
  ensureSchema(database);

  const statements = {
    insertDefinition: database.prepare(`
      INSERT OR REPLACE INTO queue_definitions (
        queue_definition_id,
        queue_definition_version,
        label,
        lifecycle_state,
        owner_capability,
        allow_deprecated_enqueue,
        metadata_json,
        policy_json,
        routes_json,
        label_history_json,
        registered_at_ms,
        updated_at_ms
      ) VALUES (
        @queue_definition_id,
        @queue_definition_version,
        @label,
        @lifecycle_state,
        @owner_capability,
        @allow_deprecated_enqueue,
        @metadata_json,
        @policy_json,
        @routes_json,
        @label_history_json,
        @registered_at_ms,
        @updated_at_ms
      )
    `),
    insertWorkItem: database.prepare(`
      INSERT INTO work_items (
        work_item_id,
        queue_definition_id,
        queue_definition_version,
        scope_key,
        scope_json,
        dedupe_key,
        state,
        owner_ref_json,
        payload_ref_json,
        payload_kind,
        priority,
        available_at_ms,
        attempt,
        max_attempts,
        lease_id,
        lease_seq,
        leased_by_worker_id,
        lease_expires_at_ms,
        concurrency_key,
        route_version,
        policy_version,
        fallback_task_id,
        last_error_json,
        last_transition_seq,
        created_at_ms,
        updated_at_ms
      ) VALUES (
        @work_item_id,
        @queue_definition_id,
        @queue_definition_version,
        @scope_key,
        @scope_json,
        @dedupe_key,
        @state,
        @owner_ref_json,
        @payload_ref_json,
        @payload_kind,
        @priority,
        @available_at_ms,
        @attempt,
        @max_attempts,
        @lease_id,
        @lease_seq,
        @leased_by_worker_id,
        @lease_expires_at_ms,
        @concurrency_key,
        @route_version,
        @policy_version,
        @fallback_task_id,
        @last_error_json,
        @last_transition_seq,
        @created_at_ms,
        @updated_at_ms
      )
    `),
    insertJournal: database.prepare(`
      INSERT INTO work_queue_transition_journal (
        journal_entry_id,
        work_item_id,
        queue_definition_id,
        queue_definition_version,
        transition,
        from_state,
        to_state,
        lease_id,
        lease_seq,
        operation_id,
        actor_json,
        reason,
        policy_version,
        decision_json,
        created_at_ms,
        adopted_time_ms
      ) VALUES (
        @journal_entry_id,
        @work_item_id,
        @queue_definition_id,
        @queue_definition_version,
        @transition,
        @from_state,
        @to_state,
        @lease_id,
        @lease_seq,
        @operation_id,
        @actor_json,
        @reason,
        @policy_version,
        @decision_json,
        @created_at_ms,
        @adopted_time_ms
      )
    `),
    updateLastTransitionSeq: database.prepare(`
      UPDATE work_items
      SET last_transition_seq = @seq,
          updated_at_ms = @updated_at_ms
      WHERE work_item_id = @work_item_id
    `),
    getWorkItem: database.prepare("SELECT * FROM work_items WHERE work_item_id = ?"),
    getNonTerminalDedupe: database.prepare(`
      SELECT *
      FROM work_items
      WHERE queue_definition_id = ?
        AND scope_key = ?
        AND dedupe_key = ?
        AND dedupe_key <> ''
        AND state NOT IN (${TERMINAL_STATE_SQL})
      ORDER BY created_at_ms ASC
      LIMIT 1
    `),
    materializeDelayed: database.prepare(`
      SELECT *
      FROM work_items
      WHERE state = @state
        AND available_at_ms <= @now_ms
        AND (@queue_definition_id = '' OR queue_definition_id = @queue_definition_id)
        AND (@scope_key = '' OR scope_key = @scope_key)
      ORDER BY available_at_ms ASC, created_at_ms ASC
      LIMIT @limit
    `),
    expiredLeases: database.prepare(`
      SELECT *
      FROM work_items
      WHERE state = @state
        AND lease_expires_at_ms > 0
        AND lease_expires_at_ms <= @now_ms
        AND (@queue_definition_id = '' OR queue_definition_id = @queue_definition_id)
        AND (@scope_key = '' OR scope_key = @scope_key)
      ORDER BY lease_expires_at_ms ASC, created_at_ms ASC
      LIMIT @limit
    `),
    updateStateProjection: database.prepare(`
      UPDATE work_items
      SET state = @state,
          available_at_ms = @available_at_ms,
          attempt = @attempt,
          max_attempts = @max_attempts,
          lease_id = @lease_id,
          lease_seq = @lease_seq,
          leased_by_worker_id = @leased_by_worker_id,
          lease_expires_at_ms = @lease_expires_at_ms,
          fallback_task_id = @fallback_task_id,
          last_error_json = @last_error_json,
          updated_at_ms = @updated_at_ms
      WHERE work_item_id = @work_item_id
    `),
    claimCandidatesBase: database.prepare(`
      SELECT *
      FROM work_items candidate
      WHERE candidate.queue_definition_id = @queue_definition_id
        AND candidate.scope_key = @scope_key
        AND candidate.state = @state
        AND candidate.available_at_ms <= @now_ms
        AND (@queue_definition_version = 0 OR candidate.queue_definition_version = @queue_definition_version)
        AND NOT EXISTS (
          SELECT 1
          FROM work_items active
          WHERE active.queue_definition_id = candidate.queue_definition_id
            AND active.scope_key = candidate.scope_key
            AND active.concurrency_key = candidate.concurrency_key
            AND active.concurrency_key <> ''
            AND active.state = '${WORK_QUEUE_STATES.LEASED}'
            AND active.work_item_id <> candidate.work_item_id
        )
      ORDER BY candidate.priority DESC, candidate.available_at_ms ASC, candidate.created_at_ms ASC
      LIMIT @limit
    `),
    insertBackgroundWrite: database.prepare(`
      INSERT OR REPLACE INTO work_queue_background_writes (
        background_write_id,
        aspect_type,
        entity_id,
        state_json,
        status,
        attempt,
        next_retry_at_ms,
        last_error_json,
        created_at_ms,
        updated_at_ms
      ) VALUES (
        @background_write_id,
        @aspect_type,
        @entity_id,
        @state_json,
        @status,
        @attempt,
        @next_retry_at_ms,
        @last_error_json,
        @created_at_ms,
        @updated_at_ms
      )
    `),
    upsertHealth: database.prepare(`
      INSERT INTO work_queue_internal_health (health_key, state_json, updated_at_ms)
      VALUES (@health_key, @state_json, @updated_at_ms)
      ON CONFLICT(health_key) DO UPDATE SET
        state_json = excluded.state_json,
        updated_at_ms = excluded.updated_at_ms
    `),
    insertFallbackTask: database.prepare(`
      INSERT OR REPLACE INTO work_queue_fallback_tasks (
        fallback_task_id,
        work_item_id,
        state,
        attempt,
        max_attempts,
        reason,
        decision_json,
        created_at_ms,
        updated_at_ms
      ) VALUES (
        @fallback_task_id,
        @work_item_id,
        @state,
        @attempt,
        @max_attempts,
        @reason,
        @decision_json,
        @created_at_ms,
        @updated_at_ms
      )
    `),
    upsertQueueControl: database.prepare(`
      INSERT INTO work_queue_controls (
        queue_definition_id,
        scope_key,
        mode,
        reason,
        actor_json,
        updated_at_ms
      ) VALUES (
        @queue_definition_id,
        @scope_key,
        @mode,
        @reason,
        @actor_json,
        @updated_at_ms
      )
      ON CONFLICT(queue_definition_id, scope_key) DO UPDATE SET
        mode = excluded.mode,
        reason = excluded.reason,
        actor_json = excluded.actor_json,
        updated_at_ms = excluded.updated_at_ms
    `),
    getQueueControl: database.prepare(`
      SELECT *
      FROM work_queue_controls
      WHERE queue_definition_id = @queue_definition_id
        AND scope_key = @scope_key
    `)
  };

  function appendTransitionInternal({
    row,
    transition,
    fromState,
    toState,
    leaseId,
    leaseSeq,
    nowMs,
    operationId = "",
    actor = {},
    reason = "",
    policyVersion = "",
    decision = {}
  }) {
    assertLegalWorkQueueTransition({ transition, fromState: fromState ?? null, toState });
    const result = statements.insertJournal.run({
      journal_entry_id: identityGenerator.journalEntryId(),
      work_item_id: row.work_item_id,
      queue_definition_id: row.queue_definition_id,
      queue_definition_version: row.queue_definition_version,
      transition,
      from_state: fromState ?? null,
      to_state: toState,
      lease_id: leaseId ?? row.lease_id ?? "",
      lease_seq: leaseSeq ?? row.lease_seq ?? 0,
      operation_id: toText(operationId),
      actor_json: jsonString(actor, {}),
      reason: toText(reason),
      policy_version: toText(policyVersion || row.policy_version),
      decision_json: jsonString(decision, {}),
      created_at_ms: nowMs,
      adopted_time_ms: nowMs
    });
    const seq = Number(result.lastInsertRowid);
    statements.updateLastTransitionSeq.run({
      seq,
      work_item_id: row.work_item_id,
      updated_at_ms: nowMs
    });
    return seq;
  }

  function applyProjectionPatch(row, patch = {}) {
    const updated = {
      ...row,
      ...patch,
      work_item_id: row.work_item_id,
      queue_definition_id: row.queue_definition_id,
      queue_definition_version: row.queue_definition_version
    };
    statements.updateStateProjection.run({
      work_item_id: updated.work_item_id,
      state: updated.state,
      available_at_ms: updated.available_at_ms,
      attempt: updated.attempt,
      max_attempts: updated.max_attempts,
      lease_id: updated.lease_id || "",
      lease_seq: updated.lease_seq || 0,
      leased_by_worker_id: updated.leased_by_worker_id || "",
      lease_expires_at_ms: updated.lease_expires_at_ms || 0,
      fallback_task_id: updated.fallback_task_id || "",
      last_error_json: updated.last_error_json || "{}",
      updated_at_ms: updated.updated_at_ms
    });
    return statements.getWorkItem.get(updated.work_item_id);
  }

  function transitionProjection({
    row,
    transition,
    toState,
    patch = {},
    nowMs,
    operationId,
    actor,
    reason,
    policyVersion
  }) {
    const fromState = row.state;
    const journalLeaseId = transition === "claim"
      ? patch.lease_id
      : row.lease_id || patch.lease_id || "";
    const journalLeaseSeq = transition === "claim"
      ? patch.lease_seq
      : row.lease_seq || patch.lease_seq || 0;
    const nextRow = applyProjectionPatch(row, {
      ...patch,
      state: toState,
      updated_at_ms: nowMs
    });
    const seq = appendTransitionInternal({
      row: nextRow,
      transition,
      fromState,
      toState,
      leaseId: journalLeaseId,
      leaseSeq: journalLeaseSeq,
      nowMs,
      operationId,
      actor,
      reason,
      policyVersion,
      decision: {
        projectionPatch: {
          ...patch,
          state: toState,
          updated_at_ms: nowMs
        }
      }
    });
    statements.updateLastTransitionSeq.run({
      seq,
      work_item_id: row.work_item_id,
      updated_at_ms: nowMs
    });
    return statements.getWorkItem.get(row.work_item_id);
  }

  function recordBackgroundWrite(aspectType, input = {}) {
    const nowMs = nowFrom(timeSource, input.nowMs);
    const entityId = toText(input.entityId || input.workItemId || input.snapshotId || input.healthKey || aspectType);
    const backgroundWriteId = toText(input.backgroundWriteId || `${aspectType}:${entityId}`);
    statements.insertBackgroundWrite.run({
      background_write_id: backgroundWriteId,
      aspect_type: aspectType,
      entity_id: entityId,
      state_json: jsonString(input.state || input.value || input, {}),
      status: toText(input.status || "committed"),
      attempt: asInt(input.attempt, 0),
      next_retry_at_ms: asInt(input.nextRetryAtMs, 0),
      last_error_json: jsonString(input.lastError || {}, {}),
      created_at_ms: nowMs,
      updated_at_ms: nowMs
    });
    return { backgroundWriteId, aspectType, entityId, committedAtMs: nowMs };
  }

  function materializeDelayedLocked({ nowMs, queueDefinitionId = "", scopeKey = "", limit = 1000 } = {}) {
    const rows = statements.materializeDelayed.all({
      state: WORK_QUEUE_STATES.DELAYED,
      now_ms: nowMs,
      queue_definition_id: toText(queueDefinitionId),
      scope_key: toText(scopeKey),
      limit: Math.max(1, asInt(limit, 1000))
    });
    const changed = [];
    for (const row of rows) {
      const updated = transitionProjection({
        row,
        transition: "delay_matured",
        toState: WORK_QUEUE_STATES.PENDING,
        patch: {
          available_at_ms: nowMs,
          lease_id: "",
          leased_by_worker_id: "",
          lease_expires_at_ms: 0
        },
        nowMs,
        reason: "delay_matured"
      });
      changed.push(rowToWorkItem(updated));
    }
    return changed;
  }

  function recoverExpiredLeasesLocked({ nowMs, queueDefinitionId = "", scopeKey = "", limit = 1000 } = {}) {
    const rows = statements.expiredLeases.all({
      state: WORK_QUEUE_STATES.LEASED,
      now_ms: nowMs,
      queue_definition_id: toText(queueDefinitionId),
      scope_key: toText(scopeKey),
      limit: Math.max(1, asInt(limit, 1000))
    });
    const recovered = [];
    for (const row of rows) {
      const exhausted = row.attempt >= row.max_attempts;
      const delayMs = exhausted
        ? 0
        : computeDeterministicBackoff({
            attempt: row.attempt,
            ...resolvedPolicy.retryBackoff
          });
      const toState = exhausted
        ? WORK_QUEUE_STATES.DEAD_LETTER
        : delayMs > 0
          ? WORK_QUEUE_STATES.DELAYED
          : WORK_QUEUE_STATES.PENDING;
      const updated = transitionProjection({
        row,
        transition: "lease_expired",
        toState,
        patch: {
          available_at_ms: nowMs + delayMs,
          lease_id: "",
          leased_by_worker_id: "",
          lease_expires_at_ms: 0,
          last_error_json: jsonString({
            type: "lease_expired",
            leaseId: row.lease_id,
            workerId: row.leased_by_worker_id,
            expiredAtMs: nowMs
          }, {})
        },
        nowMs,
        reason: exhausted ? "lease_expired_max_attempts_exhausted" : "lease_expired_retry"
      });
      recovered.push(rowToWorkItem(updated));
    }
    return recovered;
  }

  const enqueueTx = database.transaction((input = {}) => {
    const nowMs = nowFrom(timeSource, input.nowMs);
    const { queueDefinitionId, queueDefinitionVersion, queueDefinition } = resolveQueueDefinition(input, {
      assertEnqueue: true
    });
    const scope = normalizeScope(input.scope || {});
    const scopeKey = input.scopeKey ? toText(input.scopeKey) : scopeKeyFromScope(scope);
    const dedupeKey = toText(input.dedupeKey);
    if (dedupeKey) {
      const existing = statements.getNonTerminalDedupe.get(queueDefinitionId, scopeKey, dedupeKey);
      if (existing) {
        return {
          accepted: false,
          deduped: true,
          workItem: rowToWorkItem(existing)
        };
      }
    }

    const delayMs = Math.max(0, asInt(input.delayMs, 0));
    const availableAtMs = asInt(input.availableAtMs, delayMs > 0 ? nowMs + delayMs : nowMs);
    const state = availableAtMs > nowMs ? WORK_QUEUE_STATES.DELAYED : WORK_QUEUE_STATES.PENDING;
    const payloadRef = normalizePayloadRef(input.payloadRef || input.payload || input.payloadReference);
    const ownerRef = normalizeOwnerRef(input.ownerRef);
    const policyForItem = getPolicy(input.policy || queueDefinition.policy || resolvedPolicy);
    const workItemId = toText(input.workItemId || identityGenerator.workItemId());
    const row = {
      work_item_id: workItemId,
      queue_definition_id: queueDefinitionId,
      queue_definition_version: queueDefinitionVersion,
      scope_key: scopeKey,
      scope_json: jsonString(scope, {}),
      dedupe_key: dedupeKey,
      state,
      owner_ref_json: jsonString(ownerRef, {}),
      payload_ref_json: jsonString(payloadRef, {}),
      payload_kind: toText(input.payloadKind || payloadRef.kind || payloadRef.type),
      priority: asInt(input.priority, 0),
      available_at_ms: availableAtMs,
      attempt: 0,
      max_attempts: asPositiveInt(input.maxAttempts ?? policyForItem.maxAttempts, resolvedPolicy.maxAttempts),
      lease_id: "",
      lease_seq: 0,
      leased_by_worker_id: "",
      lease_expires_at_ms: 0,
      concurrency_key: toText(input.concurrencyKey),
      route_version: toText(input.routeVersion || input.route?.version),
      policy_version: toText(input.policyVersion || policyForItem.policyVersion || resolvedPolicy.policyVersion),
      fallback_task_id: "",
      last_error_json: jsonString({}, {}),
      last_transition_seq: 0,
      created_at_ms: nowMs,
      updated_at_ms: nowMs
    };

    try {
      statements.insertWorkItem.run(row);
    } catch (error) {
      if (dedupeKey && /UNIQUE constraint failed/i.test(String(error.message))) {
        const existing = statements.getNonTerminalDedupe.get(queueDefinitionId, scopeKey, dedupeKey);
        if (existing) {
          return {
            accepted: false,
            deduped: true,
            workItem: rowToWorkItem(existing)
          };
        }
      }
      throw error;
    }

    const seq = appendTransitionInternal({
      row,
      transition: "enqueue",
      fromState: null,
      toState: state,
      nowMs,
      operationId: input.operationId,
      actor: input.actor,
      reason: input.reason || "enqueue",
      policyVersion: row.policy_version,
      decision: {
        projectionRow: row
      }
    });
    const inserted = statements.getWorkItem.get(workItemId);
    return {
      accepted: true,
      deduped: false,
      transitionSeq: seq,
      workItem: rowToWorkItem(inserted)
    };
  });

  const claimTx = database.transaction((input = {}) => {
    const nowMs = nowFrom(timeSource, input.nowMs);
    const { queueDefinitionId, queueDefinitionVersion } = resolveQueueDefinition(input, {
      allowAllVersions: true
    });
    const scope = normalizeScope(input.scope || {});
    const scopeKey = input.scopeKey ? toText(input.scopeKey) : scopeKeyFromScope(scope);
    const workerId = toText(input.workerId || input.consumerId || identityGenerator.workerId());
    const batchSize = Math.max(1, Math.min(asInt(input.batchSize ?? input.batch ?? input.maxMessages, 1), 500));
    const leaseTimeoutMs = Math.max(1, asInt(input.leaseTimeoutMs, resolvedPolicy.leaseTimeoutMs));

    const recovered = recoverExpiredLeasesLocked({
      nowMs,
      queueDefinitionId,
      scopeKey,
      limit: Math.max(100, batchSize * 8)
    });
    const control = statements.getQueueControl.get({
      queue_definition_id: queueDefinitionId,
      scope_key: scopeKey
    });
    if (control && ["paused", "draining"].includes(control.mode)) {
      return {
        workerId,
        claimed: [],
        recovered,
        matured: [],
        control: {
          mode: control.mode,
          reason: control.reason || "",
          updatedAtMs: control.updated_at_ms
        }
      };
    }
    const matured = materializeDelayedLocked({
      nowMs,
      queueDefinitionId,
      scopeKey,
      limit: Math.max(100, batchSize * 8)
    });

    const candidates = statements.claimCandidatesBase.all({
      queue_definition_id: queueDefinitionId,
      queue_definition_version: asInt(queueDefinitionVersion, 0),
      scope_key: scopeKey,
      state: WORK_QUEUE_STATES.PENDING,
      now_ms: nowMs,
      limit: Math.max(batchSize * 8, batchSize)
    });

    const claimed = [];
    for (const row of candidates) {
      if (claimed.length >= batchSize) {
        break;
      }
      if (row.attempt >= row.max_attempts) {
        transitionProjection({
          row,
          transition: "dead_letter",
          toState: WORK_QUEUE_STATES.DEAD_LETTER,
          patch: {
            available_at_ms: nowMs,
            lease_id: "",
            leased_by_worker_id: "",
            lease_expires_at_ms: 0,
            last_error_json: jsonString({
              type: "max_attempts_exhausted_before_claim",
              attempt: row.attempt,
              maxAttempts: row.max_attempts
            }, {})
          },
          nowMs,
          reason: "max_attempts_exhausted_before_claim"
        });
        continue;
      }
      const leaseId = identityGenerator.leaseId();
      const leaseSeq = row.lease_seq + 1;
      const attempt = row.attempt + 1;
      const updated = transitionProjection({
        row,
        transition: "claim",
        toState: WORK_QUEUE_STATES.LEASED,
        patch: {
          attempt,
          lease_id: leaseId,
          lease_seq: leaseSeq,
          leased_by_worker_id: workerId,
          lease_expires_at_ms: nowMs + leaseTimeoutMs,
          last_error_json: jsonString({}, {})
        },
        nowMs,
        operationId: input.operationId,
        actor: input.actor || { workerId },
        reason: input.reason || "claim"
      });
      claimed.push({
        workItem: rowToWorkItem(updated),
        lease: {
          leaseId,
          leaseSeq,
          workerId,
          expiresAtMs: nowMs + leaseTimeoutMs
        }
      });
    }

    return {
      workerId,
      claimed,
      recovered,
      matured
    };
  });

  function requireLeasedRow(workItemId, leaseId, nowMs = timeSource.nowMs(), { allowExpired = false } = {}) {
    const row = statements.getWorkItem.get(toText(workItemId));
    if (!row) {
      throw new Error(`Work item not found: ${workItemId}`);
    }
    if (row.state !== WORK_QUEUE_STATES.LEASED) {
      throw new Error(`Work item ${workItemId} is not leased.`);
    }
    if (!leaseId || row.lease_id !== leaseId) {
      throw new Error(`Lease fence rejected for work item ${workItemId}.`);
    }
    if (!allowExpired && row.lease_expires_at_ms > 0 && row.lease_expires_at_ms <= nowMs) {
      throw new Error(`Lease expired for work item ${workItemId}.`);
    }
    return row;
  }

  const ackTx = database.transaction((input = {}) => {
    const nowMs = nowFrom(timeSource, input.nowMs);
    const row = requireLeasedRow(input.workItemId, input.leaseId, nowMs);
    const updated = transitionProjection({
      row,
      transition: "ack",
      toState: WORK_QUEUE_STATES.ACKED,
      patch: {
        available_at_ms: nowMs,
        lease_id: "",
        leased_by_worker_id: "",
        lease_expires_at_ms: 0,
        last_error_json: jsonString({}, {})
      },
      nowMs,
      operationId: input.operationId,
      actor: input.actor,
      reason: input.reason || "ack"
    });
    return { acked: true, workItem: rowToWorkItem(updated) };
  });

  const nackTx = database.transaction((input = {}) => {
    const nowMs = nowFrom(timeSource, input.nowMs);
    const row = requireLeasedRow(input.workItemId, input.leaseId, nowMs);
    const exhausted = row.attempt >= row.max_attempts || input.deadLetter === true;
    const delayMs = exhausted
      ? 0
      : input.delayMs === undefined
        ? computeDeterministicBackoff({
            attempt: row.attempt,
            ...resolvedPolicy.retryBackoff
          })
        : Math.max(0, asInt(input.delayMs, 0));
    const toState = exhausted
      ? WORK_QUEUE_STATES.DEAD_LETTER
      : delayMs > 0
        ? WORK_QUEUE_STATES.DELAYED
        : WORK_QUEUE_STATES.PENDING;
    const updated = transitionProjection({
      row,
      transition: "nack",
      toState,
      patch: {
        available_at_ms: nowMs + delayMs,
        lease_id: "",
        leased_by_worker_id: "",
        lease_expires_at_ms: 0,
        last_error_json: jsonString(input.error || input.lastError || {}, {})
      },
      nowMs,
      operationId: input.operationId,
      actor: input.actor,
      reason: input.reason || (exhausted ? "nack_dead_letter" : "nack_retry")
    });
    return {
      nacked: true,
      retryable: !exhausted,
      delayMs,
      workItem: rowToWorkItem(updated)
    };
  });

  const progressTx = database.transaction((input = {}) => {
    const nowMs = nowFrom(timeSource, input.nowMs);
    const row = requireLeasedRow(input.workItemId, input.leaseId, nowMs);
    const extendMs = Math.max(1, asInt(input.extendMs ?? input.leaseTimeoutMs, resolvedPolicy.leaseTimeoutMs));
    const updated = transitionProjection({
      row,
      transition: "progress",
      toState: WORK_QUEUE_STATES.LEASED,
      patch: {
        lease_expires_at_ms: nowMs + extendMs
      },
      nowMs,
      operationId: input.operationId,
      actor: input.actor,
      reason: input.reason || "progress"
    });
    return {
      progressed: true,
      lease: rowToWorkItem(updated).lease,
      workItem: rowToWorkItem(updated)
    };
  });

  const termTx = database.transaction((input = {}) => {
    const nowMs = nowFrom(timeSource, input.nowMs);
    const row = requireLeasedRow(input.workItemId, input.leaseId, nowMs);
    const updated = transitionProjection({
      row,
      transition: "term",
      toState: WORK_QUEUE_STATES.TERMINATED,
      patch: {
        available_at_ms: nowMs,
        lease_id: "",
        leased_by_worker_id: "",
        lease_expires_at_ms: 0,
        last_error_json: jsonString(input.reasonDetails || {}, {})
      },
      nowMs,
      operationId: input.operationId,
      actor: input.actor,
      reason: input.reason || "term"
    });
    return { terminated: true, workItem: rowToWorkItem(updated) };
  });

  const fallbackFailedTx = database.transaction((input = {}) => {
    const nowMs = nowFrom(timeSource, input.nowMs);
    const row = requireLeasedRow(input.workItemId, input.leaseId, nowMs, { allowExpired: true });
    const fallbackTaskId = toText(input.fallbackTaskId || identityGenerator.fallbackTaskId());
    statements.insertFallbackTask.run({
      fallback_task_id: fallbackTaskId,
      work_item_id: row.work_item_id,
      state: WORK_QUEUE_STATES.FALLBACK_REVIEW,
      attempt: asInt(input.attempt, 0),
      max_attempts: asInt(input.maxAttempts, resolvedPolicy.fallbackRetry.maxAttempts),
      reason: toText(input.reason || "fallback_failed"),
      decision_json: jsonString(input.decision || input.error || {}, {}),
      created_at_ms: nowMs,
      updated_at_ms: nowMs
    });
    const updated = transitionProjection({
      row,
      transition: "fallback_failed",
      toState: WORK_QUEUE_STATES.FALLBACK_REVIEW,
      patch: {
        available_at_ms: nowMs,
        lease_id: "",
        leased_by_worker_id: "",
        lease_expires_at_ms: 0,
        fallback_task_id: fallbackTaskId,
        last_error_json: jsonString(input.error || {}, {})
      },
      nowMs,
      operationId: input.operationId,
      actor: input.actor,
      reason: input.reason || "fallback_failed"
    });
    return {
      fallbackFailed: true,
      fallbackTaskId,
      workItem: rowToWorkItem(updated)
    };
  });

  const deadLetterTx = database.transaction((input = {}) => {
    const nowMs = nowFrom(timeSource, input.nowMs);
    let row = statements.getWorkItem.get(toText(input.workItemId));
    if (!row) {
      throw new Error(`Work item not found: ${input.workItemId}`);
    }
    if (isTerminalWorkQueueState(row.state)) {
      throw new Error(`Cannot dead-letter terminal work item ${input.workItemId}.`);
    }
    if (row.state === WORK_QUEUE_STATES.LEASED && input.internal !== true) {
      row = requireLeasedRow(input.workItemId, input.leaseId, nowMs);
    }
    const updated = transitionProjection({
      row,
      transition: "dead_letter",
      toState: WORK_QUEUE_STATES.DEAD_LETTER,
      patch: {
        available_at_ms: nowMs,
        lease_id: "",
        leased_by_worker_id: "",
        lease_expires_at_ms: 0,
        last_error_json: jsonString(input.error || input.lastError || {}, {})
      },
      nowMs,
      operationId: input.operationId,
      actor: input.actor,
      reason: input.reason || "dead_letter"
    });
    return { deadLettered: true, workItem: rowToWorkItem(updated) };
  });

  const recoverTx = database.transaction((input = {}) => {
    const nowMs = nowFrom(timeSource, input.nowMs);
    const row = statements.getWorkItem.get(toText(input.workItemId));
    if (!row) {
      throw new Error(`Work item not found: ${input.workItemId}`);
    }
    const delayMs = Math.max(0, asInt(input.delayMs, 0));
    const targetState = toText(input.targetState) ||
      (delayMs > 0 ? WORK_QUEUE_STATES.DELAYED : WORK_QUEUE_STATES.PENDING);
    const nextAttempt = input.resetAttempts === true ? 0 : row.attempt;
    const updated = transitionProjection({
      row,
      transition: "recover",
      toState: targetState,
      patch: {
        attempt: nextAttempt,
        available_at_ms: targetState === WORK_QUEUE_STATES.DELAYED ? nowMs + delayMs : nowMs,
        lease_id: "",
        leased_by_worker_id: "",
        lease_expires_at_ms: 0,
        last_error_json: jsonString(input.lastError || {}, {})
      },
      nowMs,
      operationId: input.operationId,
      actor: input.actor,
      reason: input.reason || "recover"
    });
    return { recovered: true, workItem: rowToWorkItem(updated) };
  });

  function inspect(input = {}) {
    if (input.workItemId) {
      const row = statements.getWorkItem.get(toText(input.workItemId));
      if (!row) {
        return { workItem: null, journal: [] };
      }
      const journal = input.includeJournal
        ? database.prepare(`
            SELECT *
            FROM work_queue_transition_journal
            WHERE work_item_id = ?
            ORDER BY seq ASC
          `).all(row.work_item_id).map(journalRowToTransition)
        : [];
      return { workItem: rowToWorkItem(row), journal };
    }

    const queueDefinitionId = toText(input.queueDefinitionId || input.queueDefinition?.queueDefinitionId);
    const scopeKey = input.scopeKey || (input.scope ? scopeKeyFromScope(input.scope) : "");
    const states = asArray(input.states, []).map(toText).filter(Boolean);
    const limit = Math.max(1, Math.min(asInt(input.limit, 100), 1000));
    const where = [];
    const params = {};
    if (queueDefinitionId) {
      where.push("queue_definition_id = @queue_definition_id");
      params.queue_definition_id = queueDefinitionId;
    }
    if (scopeKey) {
      where.push("scope_key = @scope_key");
      params.scope_key = scopeKey;
    }
    if (states.length) {
      where.push(`state IN (${states.map((_, index) => `@state_${index}`).join(", ")})`);
      states.forEach((state, index) => {
        params[`state_${index}`] = state;
      });
    }
    params.limit = limit;
    const sql = `
      SELECT *
      FROM work_items
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY priority DESC, available_at_ms ASC, created_at_ms ASC
      LIMIT @limit
    `;
    const items = database.prepare(sql).all(params).map(rowToWorkItem);
    const stateCounts = database.prepare(`
      SELECT state, COUNT(*) AS count
      FROM work_items
      ${queueDefinitionId ? "WHERE queue_definition_id = @queue_definition_id" : ""}
      GROUP BY state
      ORDER BY state ASC
    `).all(queueDefinitionId ? { queue_definition_id: queueDefinitionId } : {})
      .map((row) => ({ state: row.state, count: row.count }));
    return { items, stateCounts };
  }

  const appendTransitionTx = database.transaction((input = {}) => {
    const nowMs = nowFrom(timeSource, input.nowMs);
    const row = statements.getWorkItem.get(toText(input.workItemId));
    if (!row) {
      throw new Error(`Work item not found: ${input.workItemId}`);
    }
    const seq = appendTransitionInternal({
      row,
      transition: input.transition,
      fromState: input.fromState ?? row.state,
      toState: input.toState,
      nowMs,
      operationId: input.operationId,
      actor: input.actor,
      reason: input.reason,
      policyVersion: input.policyVersion,
      decision: input.decision || {}
    });
    return { appended: true, seq };
  });

  const rebuildProjectionTx = database.transaction((input = {}) => {
    const journalRows = database.prepare(`
      SELECT *
      FROM work_queue_transition_journal
      ORDER BY seq ASC
    `).all();
    const replayed = new Map();
    const errors = [];
    for (const journalRow of journalRows) {
      const event = journalRowToTransition(journalRow);
      const current = replayed.get(event.workItemId) || null;
      try {
        assertLegalWorkQueueTransition({
          transition: event.transition,
          fromState: current ? current.state : null,
          toState: event.toState
        });
      } catch (error) {
        errors.push({
          seq: event.seq,
          workItemId: event.workItemId,
          error: error.message
        });
        continue;
      }
      if (event.transition === "enqueue") {
        const projectionRow = event.decision.projectionRow;
        if (!projectionRow) {
          errors.push({
            seq: event.seq,
            workItemId: event.workItemId,
            error: "enqueue event has no projectionRow"
          });
          continue;
        }
        replayed.set(event.workItemId, {
          ...projectionRow,
          state: event.toState,
          last_transition_seq: event.seq
        });
        continue;
      }
      if (!current) {
        errors.push({
          seq: event.seq,
          workItemId: event.workItemId,
          error: "transition has no prior projection"
        });
        continue;
      }
      replayed.set(event.workItemId, {
        ...current,
        ...asObject(event.decision.projectionPatch),
        state: event.toState,
        last_transition_seq: event.seq
      });
    }

    const actualRows = database.prepare("SELECT * FROM work_items ORDER BY work_item_id ASC").all();
    const drift = [];
    for (const actual of actualRows) {
      const expected = replayed.get(actual.work_item_id);
      if (!expected) {
        drift.push({ workItemId: actual.work_item_id, reason: "missing_from_replay" });
        continue;
      }
      for (const column of [
        "state",
        "attempt",
        "lease_id",
        "lease_seq",
        "leased_by_worker_id",
        "lease_expires_at_ms",
        "available_at_ms"
      ]) {
        if (String(actual[column]) !== String(expected[column] ?? "")) {
          drift.push({
            workItemId: actual.work_item_id,
            column,
            actual: actual[column],
            expected: expected[column]
          });
        }
      }
    }

    if (input.dryRun === false && errors.length === 0) {
      database.prepare("DELETE FROM work_items").run();
      for (const row of replayed.values()) {
        statements.insertWorkItem.run({
          ...row,
          last_transition_seq: row.last_transition_seq || 0
        });
      }
    }

    return {
      ok: errors.length === 0 && drift.length === 0,
      replayed: replayed.size,
      journalEntries: journalRows.length,
      errors,
      drift
    };
  });

  const registerQueueDefinitionTx = database.transaction((definition = {}) => {
    const nowMs = nowFrom(timeSource, definition.nowMs);
    const queueDefinitionId = toText(definition.queueDefinitionId || definition.id);
    if (!queueDefinitionId) {
      throw new Error("queueDefinitionId is required.");
    }
    const label = toText(definition.label);
    if (!label) {
      throw new Error("Queue definition label is required.");
    }
    const queueDefinitionVersion = asPositiveInt(
      definition.queueDefinitionVersion ?? definition.version,
      1
    );
    statements.insertDefinition.run({
      queue_definition_id: queueDefinitionId,
      queue_definition_version: queueDefinitionVersion,
      label,
      lifecycle_state: toText(definition.lifecycleState || "active"),
      owner_capability: toText(definition.ownerCapability || "system"),
      allow_deprecated_enqueue: definition.allowDeprecatedEnqueue === true ? 1 : 0,
      metadata_json: jsonString(definition.metadata || {}, {}),
      policy_json: jsonString(definition.policy || {}, {}),
      routes_json: jsonString(definition.routes || [], []),
      label_history_json: jsonString(definition.labelHistory || [], []),
      registered_at_ms: nowMs,
      updated_at_ms: nowMs
    });
    return { registered: true, queueDefinitionId, queueDefinitionVersion };
  });

  const setQueueControlTx = database.transaction((input = {}) => {
    const nowMs = nowFrom(timeSource, input.nowMs);
    const queueDefinitionId = toText(input.queueDefinitionId || input.queueDefinition?.queueDefinitionId);
    if (!queueDefinitionId) {
      throw new Error("queueDefinitionId is required.");
    }
    const scopeKey = input.scopeKey || (input.scope ? scopeKeyFromScope(input.scope) : "");
    const mode = toText(input.mode || "active");
    if (!["active", "paused", "draining"].includes(mode)) {
      throw new Error(`Unknown queue control mode: ${mode}`);
    }
    statements.upsertQueueControl.run({
      queue_definition_id: queueDefinitionId,
      scope_key: scopeKey,
      mode,
      reason: toText(input.reason),
      actor_json: jsonString(input.actor || {}, {}),
      updated_at_ms: nowMs
    });
    return {
      queueDefinitionId,
      scopeKey,
      mode,
      reason: toText(input.reason),
      updatedAtMs: nowMs
    };
  });

  function getQueueControl(input = {}) {
    const queueDefinitionId = toText(input.queueDefinitionId || input.queueDefinition?.queueDefinitionId);
    if (!queueDefinitionId) {
      throw new Error("queueDefinitionId is required.");
    }
    const scopeKey = input.scopeKey || (input.scope ? scopeKeyFromScope(input.scope) : "");
    const row = statements.getQueueControl.get({
      queue_definition_id: queueDefinitionId,
      scope_key: scopeKey
    });
    if (!row) {
      return {
        queueDefinitionId,
        scopeKey,
        mode: "active",
        reason: "",
        updatedAtMs: 0
      };
    }
    return {
      queueDefinitionId: row.queue_definition_id,
      scopeKey: row.scope_key,
      mode: row.mode,
      reason: row.reason || "",
      actor: parseJson(row.actor_json, {}),
      updatedAtMs: row.updated_at_ms
    };
  }

  function writeInternalHealthState(input = {}) {
    const nowMs = nowFrom(timeSource, input.nowMs);
    const healthKey = toText(input.healthKey || input.entityId || "default");
    statements.upsertHealth.run({
      health_key: healthKey,
      state_json: jsonString(input.state || input.value || input, {}),
      updated_at_ms: nowMs
    });
    return recordBackgroundWrite("internal_health", {
      ...input,
      entityId: healthKey,
      nowMs
    });
  }

  const store = {
    database,
    databasePath: resolvedDatabasePath,
    enqueue: enqueueTx,
    claim: claimTx,
    ack: ackTx,
    nack: nackTx,
    progress: progressTx,
    term: termTx,
    fallbackFailed: fallbackFailedTx,
    deadLetter: deadLetterTx,
    recover: recoverTx,
    inspect,
    appendTransition: appendTransitionTx,
    rebuildProjection: rebuildProjectionTx,
    registerQueueDefinition: registerQueueDefinitionTx,
    setQueueControl: setQueueControlTx,
    pause(input = {}) {
      return setQueueControlTx({
        ...input,
        mode: "paused"
      });
    },
    resume(input = {}) {
      return setQueueControlTx({
        ...input,
        mode: "active"
      });
    },
    drain(input = {}) {
      return setQueueControlTx({
        ...input,
        mode: "draining"
      });
    },
    getQueueControl,
    recordBackgroundWrite,
    writeFallbackCoordinatorState(input = {}) {
      const nowMs = nowFrom(timeSource, input.nowMs);
      const fallbackTaskId = toText(input.fallbackTaskId || input.entityId || identityGenerator.fallbackTaskId());
      if (input.workItemId) {
        statements.insertFallbackTask.run({
          fallback_task_id: fallbackTaskId,
          work_item_id: toText(input.workItemId),
          state: toText(input.state?.state || input.status || "pending"),
          attempt: asInt(input.attempt, 0),
          max_attempts: asInt(input.maxAttempts, resolvedPolicy.fallbackRetry.maxAttempts),
          reason: toText(input.reason),
          decision_json: jsonString(input.state || input.decision || {}, {}),
          created_at_ms: nowMs,
          updated_at_ms: nowMs
        });
      }
      return recordBackgroundWrite("fallback_coordinator", {
        ...input,
        entityId: fallbackTaskId,
        nowMs
      });
    },
    writeSnapshotState(input = {}) {
      return recordBackgroundWrite("snapshot", input);
    },
    writeCompactionState(input = {}) {
      return recordBackgroundWrite("compaction", input);
    },
    writeInternalHealthState,
    close() {
      if (ownsDatabase) {
        database.close();
      }
    }
  };

  return Object.freeze(store);
}
