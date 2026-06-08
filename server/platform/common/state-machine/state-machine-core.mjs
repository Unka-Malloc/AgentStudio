import { ERROR_CODES, StateMachineError } from './state-machine-errors.mjs';
import { selectTransitionCell } from './transition-selector.mjs';
import { guardExists, listAllGuardIds, isStaticOnlyGuard } from './guards/guard-registry.mjs';
import { checkDefinitionSchema } from './state-machine-definition-schema.mjs';
import crypto from 'node:crypto';

export { ERROR_CODES, StateMachineError } from './state-machine-errors.mjs';
export { selectTransitionCell } from './transition-selector.mjs';

/**
 * Validates the definition format. Returns structured result.
 */
export function validateStateMachineDefinition(definition) {
  const errors = [];
  if (!definition) return { ok: false, errors: [{ errorCode: 'STATE_MACHINE_INVALID_DEFINITION', message: 'Definition is null.' }] };
  if (!definition.machineId) errors.push({ errorCode: 'STATE_MACHINE_INVALID_DEFINITION', message: 'machineId is required' });
  if (!definition.initialState) errors.push({ errorCode: 'STATE_MACHINE_INVALID_DEFINITION', message: 'initialState is required' });
  if (!Array.isArray(definition.states)) errors.push({ errorCode: 'STATE_MACHINE_INVALID_DEFINITION', message: 'states array is required' });
  if (!Array.isArray(definition.events)) errors.push({ errorCode: 'STATE_MACHINE_INVALID_DEFINITION', message: 'events array is required' });
  if (!Array.isArray(definition.totalMatrix)) errors.push({ errorCode: 'STATE_MACHINE_INVALID_DEFINITION', message: 'totalMatrix array is required' });
  if (errors.length > 0) return { ok: false, errors };

  const stateIds = definition.states.map(s => s.id);
  const uniqueIds = new Set(stateIds);
  if (uniqueIds.size !== stateIds.length) {
    errors.push({ errorCode: 'STATE_MACHINE_INVALID_DEFINITION', message: 'Duplicate state IDs found' });
  }
  if (!uniqueIds.has(definition.initialState)) {
    errors.push({ errorCode: 'STATE_MACHINE_INVALID_DEFINITION', message: `initialState '${definition.initialState}' is not in states list` });
  }
  for (const s of definition.states) {
    if (s.terminal && !uniqueIds.has(s.id)) {
      errors.push({ errorCode: 'STATE_MACHINE_INVALID_DEFINITION', message: `terminal state '${s.id}' is not in states list` });
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Runtime-grade executable validation. Ensures the definition is safe to
 * execute with transitionState(), covering schema, cross-references, and
 * guard registration. Stricter than validateStateMachineDefinition().
 */
export function validateExecutableStateMachineDefinition(definition) {
  const errors = [];

  // Delegate to schema checker
  try {
    checkDefinitionSchema(definition);
  } catch (e) {
    errors.push({ errorCode: 'STATE_MACHINE_INVALID_DEFINITION', message: `Schema check failed: ${e.message}` });
  }

  // Run basic structural validation
  const basic = validateStateMachineDefinition(definition);
  if (!basic.ok) {
    errors.push(...basic.errors);
  }
  if (errors.length > 0) return { ok: false, errors };

  const stateIds = new Set(definition.states.map(s => s.id));
  const eventIds = new Set(definition.events.map(e => e.id));
  const registeredGuards = new Set(listAllGuardIds());

  // Check event ID uniqueness
  if (definition.events.length !== eventIds.size) {
    errors.push({ errorCode: 'STATE_MACHINE_INVALID_DEFINITION', message: 'Duplicate event IDs found' });
  }

  for (const cell of definition.totalMatrix) {
    // from reference validity
    if (!stateIds.has(cell.from)) {
      errors.push({ errorCode: 'STATE_MACHINE_INVALID_DEFINITION', message: `Matrix cell references unknown state '${cell.from}' (from field)` });
    }
    // event reference validity
    if (!eventIds.has(cell.event)) {
      errors.push({ errorCode: 'STATE_MACHINE_INVALID_DEFINITION', message: `Matrix cell references unknown event '${cell.event}'` });
    }
    // to reference validity
    if (cell.to !== undefined && cell.to !== "" && !stateIds.has(cell.to)) {
      errors.push({ errorCode: 'STATE_MACHINE_INVALID_DEFINITION', message: `Matrix cell references unknown state '${cell.to}' (to field)` });
    }
    // guards must be non-empty strings
    for (const g of (cell.guards || [])) {
      if (typeof g !== 'string' || !g.trim()) {
        errors.push({ errorCode: 'STATE_MACHINE_INVALID_DEFINITION', message: `Matrix cell guards contain empty or non-string item` });
      } else if (!registeredGuards.has(g)) {
        errors.push({ errorCode: 'STATE_MACHINE_INVALID_DEFINITION', message: `Guard '${g}' is not registered in guard registry` });
      }
    }
    // requiredGuards must be non-empty strings
    for (const g of (cell.requiredGuards || [])) {
      if (typeof g !== 'string' || !g.trim()) {
        errors.push({ errorCode: 'STATE_MACHINE_INVALID_DEFINITION', message: `Matrix cell requiredGuards contain empty or non-string item` });
      } else if (!registeredGuards.has(g)) {
        errors.push({ errorCode: 'STATE_MACHINE_INVALID_DEFINITION', message: `requiredGuard '${g}' is not registered in guard registry` });
      }
    }
  }

  // Check for duplicate unguarded cells
  const cellGroups = new Map();
  for (const cell of definition.totalMatrix) {
    const key = `${cell.from}::${cell.event}`;
    if (!cellGroups.has(key)) cellGroups.set(key, []);
    cellGroups.get(key).push(cell);
  }
  for (const [key, cells] of cellGroups) {
    const nonIllegal = cells.filter(c => c.result !== "illegal_transition");
    if (nonIllegal.length > 1) {
      const unguarded = nonIllegal.filter(c =>
        (!c.guards || c.guards.length === 0) && (!c.requiredGuards || c.requiredGuards.length === 0)
      );
      if (unguarded.length > 1) {
        errors.push({ errorCode: 'STATE_MACHINE_INVALID_DEFINITION', message: `Duplicate unguarded cells for ${key}` });
      }
      if (unguarded.length === 1 && nonIllegal.length > 1) {
        errors.push({ errorCode: 'STATE_MACHINE_INVALID_DEFINITION', message: `Mixed guarded/unguarded cells for ${key}` });
      }
    }
  }

  // staticOnly guards must not appear in runtime guard fields
  for (const cell of definition.totalMatrix) {
    for (const guardId of (cell.guards || [])) {
      if (isStaticOnlyGuard(guardId)) {
        errors.push({ errorCode: 'STATE_MACHINE_INVALID_DEFINITION', message: `staticOnly guard '${guardId}' in cell.guards for ${cell.from}->${cell.event} is not allowed. staticOnly guards cannot gate runtime transitions.` });
      }
    }
    for (const guardId of (cell.requiredGuards || [])) {
      if (isStaticOnlyGuard(guardId)) {
        errors.push({ errorCode: 'STATE_MACHINE_INVALID_DEFINITION', message: `staticOnly guard '${guardId}' in cell.requiredGuards for ${cell.from}->${cell.event} is not allowed. staticOnly guards cannot gate runtime transitions.` });
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Assert-style wrapper that throws on invalid definition.
 */
export function assertStateMachineDefinition(definition) {
  const result = validateExecutableStateMachineDefinition(definition);
  if (!result.ok) {
    throw new StateMachineError(
      ERROR_CODES.STATE_MACHINE_INVALID_DEFINITION,
      result.errors.map(e => e.message).join('; '),
      { errors: result.errors }
    );
  }
}

export function isTerminalStatus(definition, statusId) {
  const state = definition.states.find(s => s.id === statusId);
  return state ? !!state.terminal : false;
}

export function listAllowedEvents(definition, currentStatus) {
  return definition.totalMatrix
    .filter(cell => cell.from === currentStatus && cell.result !== 'illegal_transition')
    .map(cell => cell.event);
}

// ── Recursive metadata redaction ──────────────────────────────────────────

function normalizeKey(key) {
  return String(key).toLowerCase().replace(/[^a-z0-9]/g, "");
}

const SAFE_KEYS_NORMALIZED = new Set([
  "reasoncode", "operationid", "traceid", "scopeid", "status",
  "machineid", "entityid", "eventtype", "fromstatus", "tostatus",
  "guardid", "ok", "reason", "branch", "commit", "runid",
  "verificationmode", "mode", "labels", "type", "id", "name",
  "count", "total", "version", "schemaversion"
]);

const REDACT_KEY_PATTERNS = [
  "token", "secret", "password", "cookie", "authorization",
  "apikey", "accesskey", "refreshtoken", "accesstoken",
  "privatepath", "absolutepath", "opaque", "capability",
  "keyhash", "lookupkey", "credential", "signature", "signingkey",
  "clientsecret", "credentialbundle"
];

const REDACT_VALUE_KEY = { redacted: true, reason: "sensitive_key" };
const REDACT_VALUE_PATH = { redacted: true, reason: "absolute_path" };

function isSensitiveKeyNormalized(key) {
  if (SAFE_KEYS_NORMALIZED.has(key)) return false;
  for (const pattern of REDACT_KEY_PATTERNS) {
    if (key.includes(pattern)) return true;
  }
  return false;
}

function isAbsPath(value) {
  return typeof value === 'string' && (
    value.startsWith('/Users/') || value.startsWith('/home/') ||
    value.startsWith('/root/') || value.startsWith('/tmp/') ||
    value.startsWith('/var/') || value.startsWith('/etc/') ||
    value.startsWith('/opt/') || value.startsWith('/usr/') ||
    /^[a-zA-Z]:\\/.test(value)
  );
}

function containsToken(value) {
  if (typeof value !== 'string') return false;
  const lower = value.toLowerCase();
  return lower.startsWith('bearer ') || lower.startsWith('basic ') ||
    lower.includes('?token=') || lower.includes('&token=') ||
    lower.includes('&access_token=') || lower.includes('?access_token=') ||
    lower.includes('&refresh_token=') || lower.includes('?refresh_token=') ||
    lower.includes('?api_key=') || lower.includes('&api_key=') ||
    lower.includes('authorization:') || lower.includes('x-api-key:') ||
    lower.includes('client_secret=') || lower.includes('&client_secret=') ||
    lower.includes('authorization = bearer') || lower.includes('authorization=bearer');
}

function isSensitiveStringValue(value) {
  if (typeof value !== 'string') return false;
  const lower = value.toLowerCase().trim();
  if (lower.startsWith('bearer ') || lower.startsWith('basic ')) return true;
  if (lower.startsWith('sk-') || lower.startsWith('ock_')) return true;
  return false;
}

function redactMetadata(metadata, depth = 0) {
  if (depth > 10) return { redacted: true, reason: "max_depth_exceeded" };
  if (metadata === null || metadata === undefined) return metadata;
  if (typeof metadata !== 'object') {
    if (typeof metadata === 'string') {
      if (isAbsPath(metadata)) return REDACT_VALUE_PATH;
      if (containsToken(metadata)) return REDACT_VALUE_KEY;
      if (isSensitiveStringValue(metadata)) return REDACT_VALUE_KEY;
    }
    return metadata;
  }

  if (Array.isArray(metadata)) {
    return metadata.map(item => {
      const redacted = redactMetadata(item, depth + 1);
      return redacted !== item ? redacted : item;
    });
  }

  const result = {};
  for (const key of Object.keys(metadata)) {
    const normalized = normalizeKey(key);
    const value = metadata[key];

    if (isSensitiveKeyNormalized(normalized)) {
      // Only blanket-redact if the value is a primitive; recurse into objects
      if (typeof value === 'object' && value !== null) {
        result[key] = redactMetadata(value, depth + 1);
      } else {
        result[key] = REDACT_VALUE_KEY;
      }
      continue;
    }

    if (typeof value === 'string') {
      if (isAbsPath(value)) {
        result[key] = REDACT_VALUE_PATH;
      } else if (containsToken(value)) {
        result[key] = REDACT_VALUE_KEY;
      } else if (isSensitiveStringValue(value)) {
        result[key] = REDACT_VALUE_KEY;
      } else if (isSensitiveKeyNormalized(normalizeKey(value))) {
        // Detect sensitive-key-like string values (e.g., "Authorization", "api_key")
        result[key] = REDACT_VALUE_KEY;
      } else {
        result[key] = value;
      }
    } else if (typeof value === 'object') {
      result[key] = redactMetadata(value, depth + 1);
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Map guard results to a safe guard summary for transition records.
 */
function guardSummary(guardResults) {
  if (!guardResults || guardResults.length === 0) return undefined;
  return guardResults.map(r => ({
    guardId: r.guardId,
    ok: r.ok,
    reason: r.reason
  }));
}

// ── Main transition function ──────────────────────────────────────────────

/**
 * Execute a state transition on the definition.
 *
 * @param {object} definition - state machine definition
 * @param {object} input - transition input
 * @param {object} [options] - { skipExecutableValidation?: boolean, guardEvaluator?: function, validatedDefinitionHash?: string }
 * @returns {object} transition result
 */
export function transitionState(definition, input, options = {}) {
  const skipValidation = options.skipExecutableValidation ||
    (options.validatedDefinitionHash && options.validatedDefinitionHash === computeDefinitionHash(definition));

  if (!skipValidation) {
    const execResult = validateExecutableStateMachineDefinition(definition);
    if (!execResult.ok) {
      return {
        ok: false,
        errorCode: ERROR_CODES.STATE_MACHINE_INVALID_DEFINITION,
        message: 'Definition is not executable.',
        details: execResult.errors
      };
    }
  }

  const { entityId, currentStatus, eventType, actor, reason, metadata, operationId, traceId, auditId, checkpointNodeId, policyDecisionId, approvalId, now } = input;

  // Reject external guard evaluator injection via input envelope
  if (input.guardEvaluator !== undefined) {
    return {
      ok: false,
      errorCode: ERROR_CODES.STATE_MACHINE_GUARD_INJECTION_REJECTED,
      message: 'Guard evaluator injection via input is not allowed. Use internal options path only.'
    };
  }

  const stateExists = definition.states.some(s => s.id === currentStatus);
  if (!stateExists) {
    return {
      ok: false,
      errorCode: ERROR_CODES.STATE_MACHINE_UNKNOWN_STATUS,
      message: `Unknown status: ${currentStatus}`
    };
  }

  const eventExists = definition.events.some(e => e.id === eventType);
  if (!eventExists) {
    return {
      ok: false,
      errorCode: ERROR_CODES.STATE_MACHINE_UNKNOWN_EVENT,
      message: `Unknown event: ${eventType}`
    };
  }

  // Use the shared cell selection helper (no definition mutation)
  const selection = selectTransitionCell(definition, input, { guardEvaluator: options.guardEvaluator });
  if (!selection.ok) {
    return selection;
  }

  const cell = selection.cell;
  const selectedGuardResults = selection.guardResults || [];

  if (cell.result === 'illegal_transition') {
    return {
      ok: false,
      errorCode: cell.errorCode || ERROR_CODES.STATE_MACHINE_TRANSITION_NOT_ALLOWED,
      message: `Transition illegal: ${currentStatus} -> ${eventType}`,
      allowedEvents: listAllowedEvents(definition, currentStatus)
    };
  }

  if (cell.result === 'ignored_idempotent_event') {
    return {
      ok: true,
      machineId: definition.machineId,
      entityId,
      entityType: definition.entityType,
      fromStatus: currentStatus,
      toStatus: currentStatus,
      eventType,
      idempotent: true,
      transitionRecord: {
        entityId, entityType: definition.entityType, fromStatus: currentStatus, toStatus: currentStatus, eventType, operationId, timestamp: now, actor, reason, metadata: redactMetadata(metadata),
        guardResults: guardSummary(selectedGuardResults)
      },
      requiredEffects: { policy: false, approval: false, externalReceipt: false, async: false, ledger: false, checkpoint: false, audit: false }
    };
  }

  const requiresPolicy = cell.result === 'requires_policy';
  const requiresApproval = cell.result === 'requires_approval';
  const requiresExternalReceipt = cell.result === 'requires_external_receipt';
  const deferredAsync = cell.result === 'deferred_async_transition';

  const toStatus = cell.to || currentStatus;

  const guardContext = input.guardContext || {};

  // requires_policy: verify allow evidence
  if (requiresPolicy) {
    const pd = guardContext.policyDecision;
    const decision = pd?.decision || pd?.status;
    if (!(pd?.allowed === true || decision === 'allow')) {
      return {
        ok: false,
        errorCode: ERROR_CODES.STATE_MACHINE_GUARD_BLOCKED,
        message: 'Transition requires policy approval but no allow evidence found.',
        blockedBy: "policy",
        allowedEvents: listAllowedEvents(definition, currentStatus)
      };
    }
  }

  // requires_approval: verify approved evidence
  if (requiresApproval) {
    const ar = guardContext.approvalRecord;
    if (!ar || ar.status !== 'approved') {
      return {
        ok: false,
        errorCode: ERROR_CODES.STATE_MACHINE_GUARD_BLOCKED,
        message: 'Transition requires approval but no approved evidence found.',
        blockedBy: "approval",
        allowedEvents: listAllowedEvents(definition, currentStatus)
      };
    }
  }

  // requires_external_receipt: verify receipt evidence at runtime
  if (requiresExternalReceipt) {
    const er = guardContext.externalReceipt;
    if (!er || er.status !== 'recorded') {
      return {
        ok: false,
        errorCode: ERROR_CODES.STATE_MACHINE_GUARD_BLOCKED,
        message: 'Transition requires external receipt but no recorded evidence found.',
        blockedBy: "externalReceipt",
        allowedEvents: listAllowedEvents(definition, currentStatus)
      };
    }
  }

  // deferred_async_transition: verify async infrastructure exists
  if (deferredAsync) {
    const hasResumePointer = input.resumePointer || input.operationId;
    if (!hasResumePointer) {
      return {
        ok: false,
        errorCode: ERROR_CODES.STATE_MACHINE_GUARD_BLOCKED,
        message: 'Deferred async transition requires resumePointer or operationId.',
        blockedBy: "async",
        allowedEvents: listAllowedEvents(definition, currentStatus)
      };
    }
  }

  const transitionRecord = {
    entityId,
    entityType: definition.entityType,
    fromStatus: currentStatus,
    toStatus,
    eventType,
    operationId,
    timestamp: now,
    actor,
    reason,
    metadata: redactMetadata(metadata),
    traceId,
    auditId,
    checkpointNodeId,
    policyDecisionId,
    approvalId,
    guardResults: guardSummary(selectedGuardResults)
  };

  return {
    ok: true,
    machineId: definition.machineId,
    entityId,
    entityType: definition.entityType,
    fromStatus: currentStatus,
    toStatus,
    eventType,
    transitionRecord,
    requiredEffects: {
      policy: requiresPolicy,
      approval: requiresApproval,
      externalReceipt: requiresExternalReceipt,
      async: deferredAsync,
      ledger: true,
      checkpoint: !!cell.sideEffects?.includes('checkpoint'),
      audit: !!cell.sideEffects?.includes('audit')
    },
    ...(deferredAsync ? {
      asyncTransition: {
        required: true,
        resumePointer: input.resumePointer || null,
        operationId: input.operationId || null,
        traceId: input.traceId || null
      }
    } : {})
  };
}

export function assertTransitionAllowed(definition, input) {
  const result = transitionState(definition, input);
  if (!result.ok) {
    throw new StateMachineError(result.errorCode, result.message, {
      machineId: definition.machineId,
      entityId: input.entityId,
      currentStatus: input.currentStatus,
      eventType: input.eventType,
      allowedEvents: result.allowedEvents,
      guardResults: result.guardResults,
      blockedBy: result.blockedBy,
      failedGuards: result.failedGuards
    });
  }
  return result;
}

/**
 * Pre-validate and cache a state machine definition for repeated use.
 * Validation is performed once; subsequent transitionState() calls can use
 * the returned definitionHash to skip re-validation.
 *
 * @param {object} definition - state machine definition
 * @returns {{ definition, definitionHash, validationResult }}
 */
export function compileStateMachineDefinition(definition) {
  const validationResult = validateExecutableStateMachineDefinition(definition);
  const definitionHash = computeDefinitionHash(definition);
  return { definition, definitionHash, validationResult, compiled: validationResult.ok };
}

function computeDefinitionHash(definition) {
  const stable = canonicalJson(definition);
  return `sha256:${crypto.createHash("sha256").update(stable).digest("hex")}`;
}

/**
 * Recursive canonical JSON serializer.
 * - primitives pass through
 * - arrays preserve order and recurse
 * - objects sort keys and recurse
 * - undefined values are omitted
 * - functions / symbols / circular refs cause an error
 */
function canonicalJson(value, seen = new WeakSet()) {
  if (value === null || typeof value === "undefined") return "null";
  if (typeof value === "function") {
    throw new Error("canonicalJson: functions are not supported in hash computation");
  }
  if (typeof value === "symbol") {
    throw new Error("canonicalJson: symbols are not supported in hash computation");
  }
  if (typeof value !== "object") {
    return JSON.stringify(value);
  }

  // Detect circular references
  if (seen.has(value)) {
    throw new Error("canonicalJson: circular reference detected");
  }

  if (Array.isArray(value)) {
    seen.add(value);
    const items = value.map(item => canonicalJson(item, seen));
    seen.delete(value);
    return `[${items.join(",")}]`;
  }

  seen.add(value);
  const keys = Object.keys(value).sort();
  const pairs = [];
  for (const key of keys) {
    const v = value[key];
    if (v === undefined) continue;
    const encodedKey = JSON.stringify(key);
    const encodedValue = canonicalJson(v, seen);
    pairs.push(`${encodedKey}:${encodedValue}`);
  }
  seen.delete(value);
  return `{${pairs.join(",")}}`;
}
