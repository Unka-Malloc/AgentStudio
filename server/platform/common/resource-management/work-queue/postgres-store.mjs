import pg from "pg";

import { assertQueueDefinitionCanEnqueue, normalizeStructuredQueueScope } from "./definitions.mjs";
import { queueIdentityGenerator } from "./identity.mjs";
import { computeDeterministicBackoff, DEFAULT_QUEUE_POLICY } from "./policies.mjs";
import {
  assertLegalWorkQueueTransition,
  isTerminalWorkQueueState,
  WORK_QUEUE_STATES
} from "./state-machine.mjs";
import { systemQueueTimeSource } from "./time-source.mjs";

const { Pool } = pg;
const POSTGRES_MIGRATION_REVISION = 1;
const TERMINAL_STATES = Object.freeze([WORK_QUEUE_STATES.ACKED, WORK_QUEUE_STATES.TERMINATED]);

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

function parseJson(value, fallback) {
  if (value === null || value === undefined) {
    return fallback;
  }
  if (typeof value === "object") {
    return value;
  }
  try {
    const parsed = JSON.parse(String(value || ""));
    return parsed === undefined || parsed === null ? fallback : parsed;
  } catch {
    return fallback;
  }
}

function stableJson(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
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
  if (!row) return null;
  const leaseId = toText(row.lease_id);
  return {
    workItemId: row.work_item_id,
    queueDefinitionId: row.queue_definition_id,
    queueDefinitionVersion: Number(row.queue_definition_version || 0),
    scopeKey: row.scope_key,
    scope: parseJson(row.scope_json, {}),
    dedupeKey: row.dedupe_key || "",
    state: row.state,
    ownerRef: parseJson(row.owner_ref_json, {}),
    payloadRef: parseJson(row.payload_ref_json, {}),
    payloadKind: row.payload_kind || "",
    priority: Number(row.priority || 0),
    availableAtMs: Number(row.available_at_ms || 0),
    attempt: Number(row.attempt || 0),
    maxAttempts: Number(row.max_attempts || 0),
    lease: leaseId
      ? {
          leaseId,
          leaseSeq: Number(row.lease_seq || 0),
          workerId: row.leased_by_worker_id,
          expiresAtMs: Number(row.lease_expires_at_ms || 0)
        }
      : null,
    concurrencyKey: row.concurrency_key || "",
    routeVersion: row.route_version || "",
    policyVersion: row.policy_version || "",
    fallbackTaskId: row.fallback_task_id || "",
    lastError: parseJson(row.last_error_json, {}),
    createdAtMs: Number(row.created_at_ms || 0),
    updatedAtMs: Number(row.updated_at_ms || 0),
    lastTransitionSeq: Number(row.last_transition_seq || 0)
  };
}

function journalRowToTransition(row) {
  return {
    seq: Number(row.seq || 0),
    journalEntryId: row.journal_entry_id,
    workItemId: row.work_item_id,
    queueDefinitionId: row.queue_definition_id,
    queueDefinitionVersion: Number(row.queue_definition_version || 0),
    transition: row.transition,
    fromState: row.from_state || null,
    toState: row.to_state,
    leaseId: row.lease_id || "",
    leaseSeq: Number(row.lease_seq || 0),
    operationId: row.operation_id || "",
    actor: parseJson(row.actor_json, {}),
    reason: row.reason || "",
    policyVersion: row.policy_version || "",
    decision: parseJson(row.decision_json, {}),
    createdAtMs: Number(row.created_at_ms || 0),
    adoptedTimeMs: Number(row.adopted_time_ms || 0)
  };
}

async function ensureSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS work_queue_schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at_ms BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS queue_definitions (
      queue_definition_id TEXT NOT NULL,
      queue_definition_version INTEGER NOT NULL,
      label TEXT NOT NULL UNIQUE,
      lifecycle_state TEXT NOT NULL,
      owner_capability TEXT NOT NULL,
      allow_deprecated_enqueue BOOLEAN NOT NULL DEFAULT FALSE,
      metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      policy_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      routes_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      label_history_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      registered_at_ms BIGINT NOT NULL,
      updated_at_ms BIGINT NOT NULL,
      PRIMARY KEY (queue_definition_id, queue_definition_version)
    );

    CREATE TABLE IF NOT EXISTS work_items (
      work_item_id TEXT PRIMARY KEY,
      queue_definition_id TEXT NOT NULL,
      queue_definition_version INTEGER NOT NULL,
      scope_key TEXT NOT NULL,
      scope_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      dedupe_key TEXT NOT NULL DEFAULT '',
      state TEXT NOT NULL,
      owner_ref_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      payload_ref_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      payload_kind TEXT NOT NULL DEFAULT '',
      priority INTEGER NOT NULL DEFAULT 0,
      available_at_ms BIGINT NOT NULL,
      attempt INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL,
      lease_id TEXT NOT NULL DEFAULT '',
      lease_seq INTEGER NOT NULL DEFAULT 0,
      leased_by_worker_id TEXT NOT NULL DEFAULT '',
      lease_expires_at_ms BIGINT NOT NULL DEFAULT 0,
      concurrency_key TEXT NOT NULL DEFAULT '',
      route_version TEXT NOT NULL DEFAULT '',
      policy_version TEXT NOT NULL DEFAULT '',
      fallback_task_id TEXT NOT NULL DEFAULT '',
      last_error_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      last_transition_seq BIGINT NOT NULL DEFAULT 0,
      created_at_ms BIGINT NOT NULL,
      updated_at_ms BIGINT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_work_queue_pg_dedupe_nonterminal
      ON work_items(queue_definition_id, scope_key, dedupe_key)
      WHERE dedupe_key <> '' AND state NOT IN ('${WORK_QUEUE_STATES.ACKED}', '${WORK_QUEUE_STATES.TERMINATED}');

    CREATE INDEX IF NOT EXISTS idx_work_queue_pg_claim
      ON work_items(queue_definition_id, scope_key, state, available_at_ms, priority, created_at_ms);

    CREATE INDEX IF NOT EXISTS idx_work_queue_pg_lease_expiry
      ON work_items(state, lease_expires_at_ms);

    CREATE INDEX IF NOT EXISTS idx_work_queue_pg_concurrency
      ON work_items(queue_definition_id, scope_key, concurrency_key, state);

    CREATE TABLE IF NOT EXISTS work_queue_transition_journal (
      seq BIGSERIAL PRIMARY KEY,
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
      actor_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      reason TEXT NOT NULL DEFAULT '',
      policy_version TEXT NOT NULL DEFAULT '',
      decision_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at_ms BIGINT NOT NULL,
      adopted_time_ms BIGINT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_work_queue_pg_journal_item
      ON work_queue_transition_journal(work_item_id, seq);

    CREATE INDEX IF NOT EXISTS idx_work_queue_pg_journal_queue
      ON work_queue_transition_journal(queue_definition_id, queue_definition_version, seq);

    CREATE TABLE IF NOT EXISTS work_queue_background_writes (
      background_write_id TEXT PRIMARY KEY,
      aspect_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      state_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      status TEXT NOT NULL DEFAULT 'committed',
      attempt INTEGER NOT NULL DEFAULT 0,
      next_retry_at_ms BIGINT NOT NULL DEFAULT 0,
      last_error_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at_ms BIGINT NOT NULL,
      updated_at_ms BIGINT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_work_queue_pg_background_writes_type_entity
      ON work_queue_background_writes(aspect_type, entity_id);

    CREATE TABLE IF NOT EXISTS work_queue_fallback_tasks (
      fallback_task_id TEXT PRIMARY KEY,
      work_item_id TEXT NOT NULL,
      state TEXT NOT NULL,
      attempt INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 0,
      reason TEXT NOT NULL DEFAULT '',
      decision_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at_ms BIGINT NOT NULL,
      updated_at_ms BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS work_queue_internal_health (
      health_key TEXT PRIMARY KEY,
      state_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at_ms BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS work_queue_controls (
      queue_definition_id TEXT NOT NULL,
      scope_key TEXT NOT NULL DEFAULT '',
      mode TEXT NOT NULL DEFAULT 'active',
      reason TEXT NOT NULL DEFAULT '',
      actor_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at_ms BIGINT NOT NULL,
      PRIMARY KEY (queue_definition_id, scope_key)
    );

    INSERT INTO work_queue_schema_migrations(version, applied_at_ms)
    VALUES (${POSTGRES_MIGRATION_REVISION}, ${Date.now()})
    ON CONFLICT(version) DO NOTHING;
  `);
}

function sqlValues(row, columns) {
  return columns.map((column) => row[column]);
}

function insertPlaceholders(columns, offset = 0) {
  return columns.map((_, index) => `$${index + offset + 1}`).join(", ");
}

async function queryOne(client, sql, params = []) {
  const result = await client.query(sql, params);
  return result.rows[0] || null;
}

async function withTransaction(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => null);
    throw error;
  } finally {
    client.release();
  }
}

export async function createPostgresWorkQueueStore({
  connectionString = process.env.PACT_WORK_QUEUE_POSTGRES_URL || process.env.DATABASE_URL || "",
  pool = null,
  poolOptions = {},
  timeSource = systemQueueTimeSource,
  identityGenerator = queueIdentityGenerator,
  policy = DEFAULT_QUEUE_POLICY
} = {}) {
  const resolvedPolicy = getPolicy(policy);
  const database = pool || new Pool({
    connectionString: connectionString || undefined,
    max: Number(poolOptions.max || process.env.PACT_WORK_QUEUE_POSTGRES_POOL_MAX || 10),
    idleTimeoutMillis: Number(poolOptions.idleTimeoutMillis || 30_000),
    connectionTimeoutMillis: Number(poolOptions.connectionTimeoutMillis || 10_000),
    ...poolOptions
  });
  const ownsPool = !pool;
  await ensureSchema(database);

  async function appendTransitionInternal(client, {
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
    const inserted = await queryOne(client, `
      INSERT INTO work_queue_transition_journal (
        journal_entry_id, work_item_id, queue_definition_id, queue_definition_version,
        transition, from_state, to_state, lease_id, lease_seq, operation_id,
        actor_json, reason, policy_version, decision_json, created_at_ms, adopted_time_ms
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14::jsonb,$15,$16)
      RETURNING seq
    `, [
      identityGenerator.journalEntryId(),
      row.work_item_id,
      row.queue_definition_id,
      row.queue_definition_version,
      transition,
      fromState ?? null,
      toState,
      leaseId ?? row.lease_id ?? "",
      leaseSeq ?? row.lease_seq ?? 0,
      toText(operationId),
      JSON.stringify(actor || {}),
      toText(reason),
      toText(policyVersion || row.policy_version),
      JSON.stringify(decision || {}),
      nowMs,
      nowMs
    ]);
    const seq = Number(inserted.seq || 0);
    await client.query(`
      UPDATE work_items
      SET last_transition_seq = $1,
          updated_at_ms = $2
      WHERE work_item_id = $3
    `, [seq, nowMs, row.work_item_id]);
    return seq;
  }

  async function applyProjectionPatch(client, row, patch = {}) {
    const updated = {
      ...row,
      ...patch,
      work_item_id: row.work_item_id,
      queue_definition_id: row.queue_definition_id,
      queue_definition_version: row.queue_definition_version
    };
    const result = await queryOne(client, `
      UPDATE work_items
      SET state = $2,
          available_at_ms = $3,
          attempt = $4,
          max_attempts = $5,
          lease_id = $6,
          lease_seq = $7,
          leased_by_worker_id = $8,
          lease_expires_at_ms = $9,
          fallback_task_id = $10,
          last_error_json = $11::jsonb,
          updated_at_ms = $12
      WHERE work_item_id = $1
      RETURNING *
    `, [
      updated.work_item_id,
      updated.state,
      updated.available_at_ms,
      updated.attempt,
      updated.max_attempts,
      updated.lease_id || "",
      updated.lease_seq || 0,
      updated.leased_by_worker_id || "",
      updated.lease_expires_at_ms || 0,
      updated.fallback_task_id || "",
      JSON.stringify(parseJson(updated.last_error_json, {})),
      updated.updated_at_ms
    ]);
    return result;
  }

  async function transitionProjection(client, {
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
    const nextRow = await applyProjectionPatch(client, row, {
      ...patch,
      state: toState,
      updated_at_ms: nowMs
    });
    const seq = await appendTransitionInternal(client, {
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
    return queryOne(client, "SELECT * FROM work_items WHERE work_item_id = $1", [row.work_item_id]);
  }

  async function recordBackgroundWriteInternal(client, aspectType, input = {}) {
    const nowMs = nowFrom(timeSource, input.nowMs);
    const entityId = toText(input.entityId || input.workItemId || input.snapshotId || input.healthKey || aspectType);
    const backgroundWriteId = toText(input.backgroundWriteId || `${aspectType}:${entityId}`);
    await client.query(`
      INSERT INTO work_queue_background_writes (
        background_write_id, aspect_type, entity_id, state_json, status,
        attempt, next_retry_at_ms, last_error_json, created_at_ms, updated_at_ms
      ) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8::jsonb,$9,$10)
      ON CONFLICT(background_write_id) DO UPDATE SET
        aspect_type = EXCLUDED.aspect_type,
        entity_id = EXCLUDED.entity_id,
        state_json = EXCLUDED.state_json,
        status = EXCLUDED.status,
        attempt = EXCLUDED.attempt,
        next_retry_at_ms = EXCLUDED.next_retry_at_ms,
        last_error_json = EXCLUDED.last_error_json,
        updated_at_ms = EXCLUDED.updated_at_ms
    `, [
      backgroundWriteId,
      aspectType,
      entityId,
      JSON.stringify(input.state || input.value || input || {}),
      toText(input.status || "committed"),
      asInt(input.attempt, 0),
      asInt(input.nextRetryAtMs, 0),
      JSON.stringify(input.lastError || {}),
      nowMs,
      nowMs
    ]);
    return { backgroundWriteId, aspectType, entityId, committedAtMs: nowMs };
  }

  async function materializeDelayedLocked(client, { nowMs, queueDefinitionId = "", scopeKey = "", limit = 1000 } = {}) {
    const result = await client.query(`
      SELECT *
      FROM work_items
      WHERE state = $1
        AND available_at_ms <= $2
        AND ($3 = '' OR queue_definition_id = $3)
        AND ($4 = '' OR scope_key = $4)
      ORDER BY available_at_ms ASC, created_at_ms ASC
      LIMIT $5
      FOR UPDATE SKIP LOCKED
    `, [WORK_QUEUE_STATES.DELAYED, nowMs, toText(queueDefinitionId), toText(scopeKey), Math.max(1, asInt(limit, 1000))]);
    const changed = [];
    for (const row of result.rows) {
      const updated = await transitionProjection(client, {
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

  async function recoverExpiredLeasesLocked(client, { nowMs, queueDefinitionId = "", scopeKey = "", limit = 1000 } = {}) {
    const result = await client.query(`
      SELECT *
      FROM work_items
      WHERE state = $1
        AND lease_expires_at_ms > 0
        AND lease_expires_at_ms <= $2
        AND ($3 = '' OR queue_definition_id = $3)
        AND ($4 = '' OR scope_key = $4)
      ORDER BY lease_expires_at_ms ASC, created_at_ms ASC
      LIMIT $5
      FOR UPDATE SKIP LOCKED
    `, [WORK_QUEUE_STATES.LEASED, nowMs, toText(queueDefinitionId), toText(scopeKey), Math.max(1, asInt(limit, 1000))]);
    const recovered = [];
    for (const row of result.rows) {
      const exhausted = Number(row.attempt || 0) >= Number(row.max_attempts || 0);
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
      const updated = await transitionProjection(client, {
        row,
        transition: "lease_expired",
        toState,
        patch: {
          available_at_ms: nowMs + delayMs,
          lease_id: "",
          leased_by_worker_id: "",
          lease_expires_at_ms: 0,
          last_error_json: {
            type: "lease_expired",
            leaseId: row.lease_id,
            workerId: row.leased_by_worker_id,
            expiredAtMs: nowMs
          }
        },
        nowMs,
        reason: exhausted ? "lease_expired_max_attempts_exhausted" : "lease_expired_retry"
      });
      recovered.push(rowToWorkItem(updated));
    }
    return recovered;
  }

  async function requireLeasedRow(client, workItemId, leaseId, nowMs = timeSource.nowMs(), { allowExpired = false } = {}) {
    const row = await queryOne(client, "SELECT * FROM work_items WHERE work_item_id = $1 FOR UPDATE", [toText(workItemId)]);
    if (!row) throw new Error(`Work item not found: ${workItemId}`);
    if (row.state !== WORK_QUEUE_STATES.LEASED) throw new Error(`Work item ${workItemId} is not leased.`);
    if (!leaseId || row.lease_id !== leaseId) throw new Error(`Lease fence rejected for work item ${workItemId}.`);
    if (!allowExpired && Number(row.lease_expires_at_ms || 0) > 0 && Number(row.lease_expires_at_ms || 0) <= nowMs) {
      throw new Error(`Lease expired for work item ${workItemId}.`);
    }
    return row;
  }

  const store = {
    database,
    kind: "postgres",
    async enqueue(input = {}) {
      return withTransaction(database, async (client) => {
        const nowMs = nowFrom(timeSource, input.nowMs);
        const { queueDefinitionId, queueDefinitionVersion, queueDefinition } = resolveQueueDefinition(input, { assertEnqueue: true });
        const scope = normalizeScope(input.scope || {});
        const scopeKey = input.scopeKey ? toText(input.scopeKey) : scopeKeyFromScope(scope);
        const dedupeKey = toText(input.dedupeKey);
        if (dedupeKey) {
          const existing = await queryOne(client, `
            SELECT *
            FROM work_items
            WHERE queue_definition_id = $1
              AND scope_key = $2
              AND dedupe_key = $3
              AND dedupe_key <> ''
              AND state <> ALL($4::text[])
            ORDER BY created_at_ms ASC
            LIMIT 1
          `, [queueDefinitionId, scopeKey, dedupeKey, TERMINAL_STATES]);
          if (existing) {
            return { accepted: false, deduped: true, workItem: rowToWorkItem(existing) };
          }
        }

        const delayMs = Math.max(0, asInt(input.delayMs, 0));
        const availableAtMs = asInt(input.availableAtMs, delayMs > 0 ? nowMs + delayMs : nowMs);
        const state = availableAtMs > nowMs ? WORK_QUEUE_STATES.DELAYED : WORK_QUEUE_STATES.PENDING;
        const payloadRef = normalizePayloadRef(input.payloadRef || input.payload || input.payloadReference);
        const ownerRef = normalizeOwnerRef(input.ownerRef);
        const policyForItem = getPolicy(input.policy || queueDefinition.policy || resolvedPolicy);
        const row = {
          work_item_id: toText(input.workItemId || identityGenerator.workItemId()),
          queue_definition_id: queueDefinitionId,
          queue_definition_version: queueDefinitionVersion,
          scope_key: scopeKey,
          scope_json: scope,
          dedupe_key: dedupeKey,
          state,
          owner_ref_json: ownerRef,
          payload_ref_json: payloadRef,
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
          last_error_json: {},
          last_transition_seq: 0,
          created_at_ms: nowMs,
          updated_at_ms: nowMs
        };
        const columns = [
          "work_item_id", "queue_definition_id", "queue_definition_version", "scope_key", "scope_json",
          "dedupe_key", "state", "owner_ref_json", "payload_ref_json", "payload_kind", "priority",
          "available_at_ms", "attempt", "max_attempts", "lease_id", "lease_seq", "leased_by_worker_id",
          "lease_expires_at_ms", "concurrency_key", "route_version", "policy_version", "fallback_task_id",
          "last_error_json", "last_transition_seq", "created_at_ms", "updated_at_ms"
        ];
        try {
          await client.query(`
            INSERT INTO work_items (${columns.join(", ")})
            VALUES (${insertPlaceholders(columns).replace("$5", "$5::jsonb").replace("$8", "$8::jsonb").replace("$9", "$9::jsonb").replace("$23", "$23::jsonb")})
          `, sqlValues({
            ...row,
            scope_json: JSON.stringify(row.scope_json),
            owner_ref_json: JSON.stringify(row.owner_ref_json),
            payload_ref_json: JSON.stringify(row.payload_ref_json),
            last_error_json: JSON.stringify(row.last_error_json)
          }, columns));
        } catch (error) {
          if (dedupeKey && error?.code === "23505") {
            const existing = await queryOne(client, `
              SELECT *
              FROM work_items
              WHERE queue_definition_id = $1 AND scope_key = $2 AND dedupe_key = $3 AND state <> ALL($4::text[])
              ORDER BY created_at_ms ASC
              LIMIT 1
            `, [queueDefinitionId, scopeKey, dedupeKey, TERMINAL_STATES]);
            if (existing) {
              return { accepted: false, deduped: true, workItem: rowToWorkItem(existing) };
            }
          }
          throw error;
        }
        const seq = await appendTransitionInternal(client, {
          row,
          transition: "enqueue",
          fromState: null,
          toState: state,
          nowMs,
          operationId: input.operationId,
          actor: input.actor,
          reason: input.reason || "enqueue",
          policyVersion: row.policy_version,
          decision: { projectionRow: row }
        });
        const inserted = await queryOne(client, "SELECT * FROM work_items WHERE work_item_id = $1", [row.work_item_id]);
        return { accepted: true, deduped: false, transitionSeq: seq, workItem: rowToWorkItem(inserted) };
      });
    },
    async claim(input = {}) {
      return withTransaction(database, async (client) => {
        const nowMs = nowFrom(timeSource, input.nowMs);
        const { queueDefinitionId, queueDefinitionVersion } = resolveQueueDefinition(input, { allowAllVersions: true });
        const scope = normalizeScope(input.scope || {});
        const scopeKey = input.scopeKey ? toText(input.scopeKey) : scopeKeyFromScope(scope);
        const workerId = toText(input.workerId || input.consumerId || identityGenerator.workerId());
        const batchSize = Math.max(1, Math.min(asInt(input.batchSize ?? input.batch ?? input.maxMessages, 1), 500));
        const leaseTimeoutMs = Math.max(1, asInt(input.leaseTimeoutMs, resolvedPolicy.leaseTimeoutMs));
        const recovered = await recoverExpiredLeasesLocked(client, {
          nowMs,
          queueDefinitionId,
          scopeKey,
          limit: Math.max(100, batchSize * 8)
        });
        const control = await queryOne(client, `
          SELECT *
          FROM work_queue_controls
          WHERE queue_definition_id = $1 AND scope_key = $2
        `, [queueDefinitionId, scopeKey]);
        if (control && ["paused", "draining"].includes(control.mode)) {
          return {
            workerId,
            claimed: [],
            recovered,
            matured: [],
            control: {
              mode: control.mode,
              reason: control.reason || "",
              updatedAtMs: Number(control.updated_at_ms || 0)
            }
          };
        }
        const matured = await materializeDelayedLocked(client, {
          nowMs,
          queueDefinitionId,
          scopeKey,
          limit: Math.max(100, batchSize * 8)
        });
        const result = await client.query(`
          SELECT *
          FROM work_items candidate
          WHERE candidate.queue_definition_id = $1
            AND candidate.scope_key = $2
            AND candidate.state = $3
            AND candidate.available_at_ms <= $4
            AND ($5::integer = 0 OR candidate.queue_definition_version = $5)
            AND NOT EXISTS (
              SELECT 1
              FROM work_items active
              WHERE active.queue_definition_id = candidate.queue_definition_id
                AND active.scope_key = candidate.scope_key
                AND active.concurrency_key = candidate.concurrency_key
                AND active.concurrency_key <> ''
                AND active.state = $6
                AND active.work_item_id <> candidate.work_item_id
            )
          ORDER BY candidate.priority DESC, candidate.available_at_ms ASC, candidate.created_at_ms ASC
          LIMIT $7
          FOR UPDATE OF candidate SKIP LOCKED
        `, [
          queueDefinitionId,
          scopeKey,
          WORK_QUEUE_STATES.PENDING,
          nowMs,
          asInt(queueDefinitionVersion, 0),
          WORK_QUEUE_STATES.LEASED,
          Math.max(batchSize * 8, batchSize)
        ]);
        const claimed = [];
        for (const row of result.rows) {
          if (claimed.length >= batchSize) break;
          if (Number(row.attempt || 0) >= Number(row.max_attempts || 0)) {
            await transitionProjection(client, {
              row,
              transition: "dead_letter",
              toState: WORK_QUEUE_STATES.DEAD_LETTER,
              patch: {
                available_at_ms: nowMs,
                lease_id: "",
                leased_by_worker_id: "",
                lease_expires_at_ms: 0,
                last_error_json: {
                  type: "max_attempts_exhausted_before_claim",
                  attempt: row.attempt,
                  maxAttempts: row.max_attempts
                }
              },
              nowMs,
              reason: "max_attempts_exhausted_before_claim"
            });
            continue;
          }
          const leaseId = identityGenerator.leaseId();
          const leaseSeq = Number(row.lease_seq || 0) + 1;
          const attempt = Number(row.attempt || 0) + 1;
          const updated = await transitionProjection(client, {
            row,
            transition: "claim",
            toState: WORK_QUEUE_STATES.LEASED,
            patch: {
              attempt,
              lease_id: leaseId,
              lease_seq: leaseSeq,
              leased_by_worker_id: workerId,
              lease_expires_at_ms: nowMs + leaseTimeoutMs,
              last_error_json: {}
            },
            nowMs,
            operationId: input.operationId,
            actor: input.actor || { workerId },
            reason: input.reason || "claim"
          });
          claimed.push({
            workItem: rowToWorkItem(updated),
            lease: { leaseId, leaseSeq, workerId, expiresAtMs: nowMs + leaseTimeoutMs }
          });
        }
        return { workerId, claimed, recovered, matured };
      });
    },
    async ack(input = {}) {
      return withTransaction(database, async (client) => {
        const nowMs = nowFrom(timeSource, input.nowMs);
        const row = await requireLeasedRow(client, input.workItemId, input.leaseId, nowMs);
        const updated = await transitionProjection(client, {
          row,
          transition: "ack",
          toState: WORK_QUEUE_STATES.ACKED,
          patch: {
            available_at_ms: nowMs,
            lease_id: "",
            leased_by_worker_id: "",
            lease_expires_at_ms: 0,
            last_error_json: {}
          },
          nowMs,
          operationId: input.operationId,
          actor: input.actor,
          reason: input.reason || "ack"
        });
        return { acked: true, workItem: rowToWorkItem(updated) };
      });
    },
    async nack(input = {}) {
      return withTransaction(database, async (client) => {
        const nowMs = nowFrom(timeSource, input.nowMs);
        const row = await requireLeasedRow(client, input.workItemId, input.leaseId, nowMs);
        const exhausted = Number(row.attempt || 0) >= Number(row.max_attempts || 0) || input.deadLetter === true;
        const delayMs = exhausted
          ? 0
          : input.delayMs === undefined
            ? computeDeterministicBackoff({ attempt: row.attempt, ...resolvedPolicy.retryBackoff })
            : Math.max(0, asInt(input.delayMs, 0));
        const toState = exhausted
          ? WORK_QUEUE_STATES.DEAD_LETTER
          : delayMs > 0
            ? WORK_QUEUE_STATES.DELAYED
            : WORK_QUEUE_STATES.PENDING;
        const updated = await transitionProjection(client, {
          row,
          transition: "nack",
          toState,
          patch: {
            available_at_ms: nowMs + delayMs,
            lease_id: "",
            leased_by_worker_id: "",
            lease_expires_at_ms: 0,
            last_error_json: input.error || input.lastError || {}
          },
          nowMs,
          operationId: input.operationId,
          actor: input.actor,
          reason: input.reason || (exhausted ? "nack_dead_letter" : "nack_retry")
        });
        return { nacked: true, retryable: !exhausted, delayMs, workItem: rowToWorkItem(updated) };
      });
    },
    async progress(input = {}) {
      return withTransaction(database, async (client) => {
        const nowMs = nowFrom(timeSource, input.nowMs);
        const row = await requireLeasedRow(client, input.workItemId, input.leaseId, nowMs);
        const extendMs = Math.max(1, asInt(input.extendMs ?? input.leaseTimeoutMs, resolvedPolicy.leaseTimeoutMs));
        const updated = await transitionProjection(client, {
          row,
          transition: "progress",
          toState: WORK_QUEUE_STATES.LEASED,
          patch: { lease_expires_at_ms: nowMs + extendMs },
          nowMs,
          operationId: input.operationId,
          actor: input.actor,
          reason: input.reason || "progress"
        });
        return { progressed: true, lease: rowToWorkItem(updated).lease, workItem: rowToWorkItem(updated) };
      });
    },
    async term(input = {}) {
      return withTransaction(database, async (client) => {
        const nowMs = nowFrom(timeSource, input.nowMs);
        const row = await requireLeasedRow(client, input.workItemId, input.leaseId, nowMs);
        const updated = await transitionProjection(client, {
          row,
          transition: "term",
          toState: WORK_QUEUE_STATES.TERMINATED,
          patch: {
            available_at_ms: nowMs,
            lease_id: "",
            leased_by_worker_id: "",
            lease_expires_at_ms: 0,
            last_error_json: input.reasonDetails || {}
          },
          nowMs,
          operationId: input.operationId,
          actor: input.actor,
          reason: input.reason || "term"
        });
        return { terminated: true, workItem: rowToWorkItem(updated) };
      });
    },
    async fallbackFailed(input = {}) {
      return withTransaction(database, async (client) => {
        const nowMs = nowFrom(timeSource, input.nowMs);
        const row = await requireLeasedRow(client, input.workItemId, input.leaseId, nowMs, { allowExpired: true });
        const fallbackTaskId = toText(input.fallbackTaskId || identityGenerator.fallbackTaskId());
        await client.query(`
          INSERT INTO work_queue_fallback_tasks (
            fallback_task_id, work_item_id, state, attempt, max_attempts,
            reason, decision_json, created_at_ms, updated_at_ms
          ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)
          ON CONFLICT(fallback_task_id) DO UPDATE SET
            state = EXCLUDED.state,
            attempt = EXCLUDED.attempt,
            max_attempts = EXCLUDED.max_attempts,
            reason = EXCLUDED.reason,
            decision_json = EXCLUDED.decision_json,
            updated_at_ms = EXCLUDED.updated_at_ms
        `, [
          fallbackTaskId,
          row.work_item_id,
          WORK_QUEUE_STATES.FALLBACK_REVIEW,
          asInt(input.attempt, 0),
          asInt(input.maxAttempts, resolvedPolicy.fallbackRetry.maxAttempts),
          toText(input.reason || "fallback_failed"),
          JSON.stringify(input.decision || input.error || {}),
          nowMs,
          nowMs
        ]);
        const updated = await transitionProjection(client, {
          row,
          transition: "fallback_failed",
          toState: WORK_QUEUE_STATES.FALLBACK_REVIEW,
          patch: {
            available_at_ms: nowMs,
            lease_id: "",
            leased_by_worker_id: "",
            lease_expires_at_ms: 0,
            fallback_task_id: fallbackTaskId,
            last_error_json: input.error || {}
          },
          nowMs,
          operationId: input.operationId,
          actor: input.actor,
          reason: input.reason || "fallback_failed"
        });
        return { fallbackFailed: true, fallbackTaskId, workItem: rowToWorkItem(updated) };
      });
    },
    async deadLetter(input = {}) {
      return withTransaction(database, async (client) => {
        const nowMs = nowFrom(timeSource, input.nowMs);
        let row = await queryOne(client, "SELECT * FROM work_items WHERE work_item_id = $1 FOR UPDATE", [toText(input.workItemId)]);
        if (!row) throw new Error(`Work item not found: ${input.workItemId}`);
        if (isTerminalWorkQueueState(row.state)) throw new Error(`Cannot dead-letter terminal work item ${input.workItemId}.`);
        if (row.state === WORK_QUEUE_STATES.LEASED && input.internal !== true) {
          row = await requireLeasedRow(client, input.workItemId, input.leaseId, nowMs);
        }
        const updated = await transitionProjection(client, {
          row,
          transition: "dead_letter",
          toState: WORK_QUEUE_STATES.DEAD_LETTER,
          patch: {
            available_at_ms: nowMs,
            lease_id: "",
            leased_by_worker_id: "",
            lease_expires_at_ms: 0,
            last_error_json: input.error || input.lastError || {}
          },
          nowMs,
          operationId: input.operationId,
          actor: input.actor,
          reason: input.reason || "dead_letter"
        });
        return { deadLettered: true, workItem: rowToWorkItem(updated) };
      });
    },
    async recover(input = {}) {
      return withTransaction(database, async (client) => {
        const nowMs = nowFrom(timeSource, input.nowMs);
        const row = await queryOne(client, "SELECT * FROM work_items WHERE work_item_id = $1 FOR UPDATE", [toText(input.workItemId)]);
        if (!row) throw new Error(`Work item not found: ${input.workItemId}`);
        const delayMs = Math.max(0, asInt(input.delayMs, 0));
        const targetState = toText(input.targetState) || (delayMs > 0 ? WORK_QUEUE_STATES.DELAYED : WORK_QUEUE_STATES.PENDING);
        const updated = await transitionProjection(client, {
          row,
          transition: "recover",
          toState: targetState,
          patch: {
            attempt: input.resetAttempts === true ? 0 : row.attempt,
            available_at_ms: targetState === WORK_QUEUE_STATES.DELAYED ? nowMs + delayMs : nowMs,
            lease_id: "",
            leased_by_worker_id: "",
            lease_expires_at_ms: 0,
            last_error_json: input.lastError || {}
          },
          nowMs,
          operationId: input.operationId,
          actor: input.actor,
          reason: input.reason || "recover"
        });
        return { recovered: true, workItem: rowToWorkItem(updated) };
      });
    },
    async inspect(input = {}) {
      if (input.workItemId) {
        const row = await queryOne(database, "SELECT * FROM work_items WHERE work_item_id = $1", [toText(input.workItemId)]);
        if (!row) return { workItem: null, journal: [] };
        const journal = input.includeJournal
          ? (await database.query("SELECT * FROM work_queue_transition_journal WHERE work_item_id = $1 ORDER BY seq ASC", [row.work_item_id])).rows.map(journalRowToTransition)
          : [];
        return { workItem: rowToWorkItem(row), journal };
      }
      const queueDefinitionId = toText(input.queueDefinitionId || input.queueDefinition?.queueDefinitionId);
      const scopeKey = input.scopeKey || (input.scope ? scopeKeyFromScope(input.scope) : "");
      const states = asArray(input.states, []).map(toText).filter(Boolean);
      const limit = Math.max(1, Math.min(asInt(input.limit, 100), 1000));
      const where = [];
      const params = [];
      if (queueDefinitionId) {
        params.push(queueDefinitionId);
        where.push(`queue_definition_id = $${params.length}`);
      }
      if (scopeKey) {
        params.push(scopeKey);
        where.push(`scope_key = $${params.length}`);
      }
      if (states.length) {
        params.push(states);
        where.push(`state = ANY($${params.length}::text[])`);
      }
      params.push(limit);
      const items = (await database.query(`
        SELECT *
        FROM work_items
        ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
        ORDER BY priority DESC, available_at_ms ASC, created_at_ms ASC
        LIMIT $${params.length}
      `, params)).rows.map(rowToWorkItem);
      const countParams = [];
      const countWhere = [];
      if (queueDefinitionId) {
        countParams.push(queueDefinitionId);
        countWhere.push(`queue_definition_id = $${countParams.length}`);
      }
      const stateCounts = (await database.query(`
        SELECT state, COUNT(*)::integer AS count
        FROM work_items
        ${countWhere.length ? `WHERE ${countWhere.join(" AND ")}` : ""}
        GROUP BY state
        ORDER BY state ASC
      `, countParams)).rows.map((row) => ({ state: row.state, count: Number(row.count || 0) }));
      return { items, stateCounts };
    },
    async appendTransition(input = {}) {
      return withTransaction(database, async (client) => {
        const nowMs = nowFrom(timeSource, input.nowMs);
        const row = await queryOne(client, "SELECT * FROM work_items WHERE work_item_id = $1 FOR UPDATE", [toText(input.workItemId)]);
        if (!row) throw new Error(`Work item not found: ${input.workItemId}`);
        const seq = await appendTransitionInternal(client, {
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
    },
    async rebuildProjection(input = {}) {
      return withTransaction(database, async (client) => {
        const journalRows = (await client.query("SELECT * FROM work_queue_transition_journal ORDER BY seq ASC")).rows;
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
            errors.push({ seq: event.seq, workItemId: event.workItemId, error: error.message });
            continue;
          }
          if (event.transition === "enqueue") {
            const projectionRow = event.decision.projectionRow;
            if (!projectionRow) {
              errors.push({ seq: event.seq, workItemId: event.workItemId, error: "enqueue event has no projectionRow" });
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
            errors.push({ seq: event.seq, workItemId: event.workItemId, error: "transition has no prior projection" });
            continue;
          }
          replayed.set(event.workItemId, {
            ...current,
            ...asObject(event.decision.projectionPatch),
            state: event.toState,
            last_transition_seq: event.seq
          });
        }
        const actualRows = (await client.query("SELECT * FROM work_items ORDER BY work_item_id ASC")).rows;
        const drift = [];
        for (const actual of actualRows) {
          const expected = replayed.get(actual.work_item_id);
          if (!expected) {
            drift.push({ workItemId: actual.work_item_id, reason: "missing_from_replay" });
            continue;
          }
          for (const column of ["state", "attempt", "lease_id", "lease_seq", "leased_by_worker_id", "lease_expires_at_ms", "available_at_ms"]) {
            if (String(actual[column]) !== String(expected[column] ?? "")) {
              drift.push({ workItemId: actual.work_item_id, column, actual: actual[column], expected: expected[column] });
            }
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
    },
    async registerQueueDefinition(definition = {}) {
      const nowMs = nowFrom(timeSource, definition.nowMs);
      const queueDefinitionId = toText(definition.queueDefinitionId || definition.id);
      if (!queueDefinitionId) throw new Error("queueDefinitionId is required.");
      const label = toText(definition.label);
      if (!label) throw new Error("Queue definition label is required.");
      const queueDefinitionVersion = asPositiveInt(definition.queueDefinitionVersion ?? definition.version, 1);
      await database.query(`
        INSERT INTO queue_definitions (
          queue_definition_id, queue_definition_version, label, lifecycle_state,
          owner_capability, allow_deprecated_enqueue, metadata_json, policy_json,
          routes_json, label_history_json, registered_at_ms, updated_at_ms
        ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,$11,$12)
        ON CONFLICT(queue_definition_id, queue_definition_version) DO UPDATE SET
          label = EXCLUDED.label,
          lifecycle_state = EXCLUDED.lifecycle_state,
          owner_capability = EXCLUDED.owner_capability,
          allow_deprecated_enqueue = EXCLUDED.allow_deprecated_enqueue,
          metadata_json = EXCLUDED.metadata_json,
          policy_json = EXCLUDED.policy_json,
          routes_json = EXCLUDED.routes_json,
          label_history_json = EXCLUDED.label_history_json,
          updated_at_ms = EXCLUDED.updated_at_ms
      `, [
        queueDefinitionId,
        queueDefinitionVersion,
        label,
        toText(definition.lifecycleState || "active"),
        toText(definition.ownerCapability || "system"),
        definition.allowDeprecatedEnqueue === true,
        JSON.stringify(definition.metadata || {}),
        JSON.stringify(definition.policy || {}),
        JSON.stringify(definition.routes || []),
        JSON.stringify(definition.labelHistory || []),
        nowMs,
        nowMs
      ]);
      return { registered: true, queueDefinitionId, queueDefinitionVersion };
    },
    async setQueueControl(input = {}) {
      const nowMs = nowFrom(timeSource, input.nowMs);
      const queueDefinitionId = toText(input.queueDefinitionId || input.queueDefinition?.queueDefinitionId);
      if (!queueDefinitionId) throw new Error("queueDefinitionId is required.");
      const scopeKey = input.scopeKey || (input.scope ? scopeKeyFromScope(input.scope) : "");
      const mode = toText(input.mode || "active");
      if (!["active", "paused", "draining"].includes(mode)) throw new Error(`Unknown queue control mode: ${mode}`);
      await database.query(`
        INSERT INTO work_queue_controls (queue_definition_id, scope_key, mode, reason, actor_json, updated_at_ms)
        VALUES ($1,$2,$3,$4,$5::jsonb,$6)
        ON CONFLICT(queue_definition_id, scope_key) DO UPDATE SET
          mode = EXCLUDED.mode,
          reason = EXCLUDED.reason,
          actor_json = EXCLUDED.actor_json,
          updated_at_ms = EXCLUDED.updated_at_ms
      `, [queueDefinitionId, scopeKey, mode, toText(input.reason), JSON.stringify(input.actor || {}), nowMs]);
      return { queueDefinitionId, scopeKey, mode, reason: toText(input.reason), updatedAtMs: nowMs };
    },
    pause(input = {}) {
      return store.setQueueControl({ ...input, mode: "paused" });
    },
    resume(input = {}) {
      return store.setQueueControl({ ...input, mode: "active" });
    },
    drain(input = {}) {
      return store.setQueueControl({ ...input, mode: "draining" });
    },
    async getQueueControl(input = {}) {
      const queueDefinitionId = toText(input.queueDefinitionId || input.queueDefinition?.queueDefinitionId);
      if (!queueDefinitionId) throw new Error("queueDefinitionId is required.");
      const scopeKey = input.scopeKey || (input.scope ? scopeKeyFromScope(input.scope) : "");
      const row = await queryOne(database, `
        SELECT *
        FROM work_queue_controls
        WHERE queue_definition_id = $1 AND scope_key = $2
      `, [queueDefinitionId, scopeKey]);
      if (!row) {
        return { queueDefinitionId, scopeKey, mode: "active", reason: "", updatedAtMs: 0 };
      }
      return {
        queueDefinitionId: row.queue_definition_id,
        scopeKey: row.scope_key,
        mode: row.mode,
        reason: row.reason || "",
        actor: parseJson(row.actor_json, {}),
        updatedAtMs: Number(row.updated_at_ms || 0)
      };
    },
    async recordBackgroundWrite(aspectType, input = {}) {
      return withTransaction(database, (client) => recordBackgroundWriteInternal(client, aspectType, input));
    },
    async writeFallbackCoordinatorState(input = {}) {
      return withTransaction(database, async (client) => {
        const nowMs = nowFrom(timeSource, input.nowMs);
        const fallbackTaskId = toText(input.fallbackTaskId || input.entityId || identityGenerator.fallbackTaskId());
        if (input.workItemId) {
          await client.query(`
            INSERT INTO work_queue_fallback_tasks (
              fallback_task_id, work_item_id, state, attempt, max_attempts,
              reason, decision_json, created_at_ms, updated_at_ms
            ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)
            ON CONFLICT(fallback_task_id) DO UPDATE SET
              state = EXCLUDED.state,
              attempt = EXCLUDED.attempt,
              max_attempts = EXCLUDED.max_attempts,
              reason = EXCLUDED.reason,
              decision_json = EXCLUDED.decision_json,
              updated_at_ms = EXCLUDED.updated_at_ms
          `, [
            fallbackTaskId,
            toText(input.workItemId),
            toText(input.state?.state || input.status || "pending"),
            asInt(input.attempt, 0),
            asInt(input.maxAttempts, resolvedPolicy.fallbackRetry.maxAttempts),
            toText(input.reason),
            JSON.stringify(input.state || input.decision || {}),
            nowMs,
            nowMs
          ]);
        }
        return recordBackgroundWriteInternal(client, "fallback_coordinator", { ...input, entityId: fallbackTaskId, nowMs });
      });
    },
    writeSnapshotState(input = {}) {
      return store.recordBackgroundWrite("snapshot", input);
    },
    writeCompactionState(input = {}) {
      return store.recordBackgroundWrite("compaction", input);
    },
    async writeInternalHealthState(input = {}) {
      return withTransaction(database, async (client) => {
        const nowMs = nowFrom(timeSource, input.nowMs);
        const healthKey = toText(input.healthKey || input.entityId || "default");
        await client.query(`
          INSERT INTO work_queue_internal_health (health_key, state_json, updated_at_ms)
          VALUES ($1,$2::jsonb,$3)
          ON CONFLICT(health_key) DO UPDATE SET
            state_json = EXCLUDED.state_json,
            updated_at_ms = EXCLUDED.updated_at_ms
        `, [healthKey, JSON.stringify(input.state || input.value || input || {}), nowMs]);
        return recordBackgroundWriteInternal(client, "internal_health", { ...input, entityId: healthKey, nowMs });
      });
    },
    async close() {
      if (ownsPool) {
        await database.end();
      }
    }
  };

  return Object.freeze(store);
}
