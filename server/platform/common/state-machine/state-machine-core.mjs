import { ERROR_CODES, StateMachineError } from './state-machine-errors.mjs';
import { evaluateGuardSet } from './guards/guard-evaluator.mjs';

export { ERROR_CODES, StateMachineError } from './state-machine-errors.mjs';

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
 * Assert-style wrapper that throws on invalid definition.
 */
export function assertStateMachineDefinition(definition) {
  const result = validateStateMachineDefinition(definition);
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

/**
 * Recursive redaction helper to prevent sensitive data from entering transition metadata.
 * Supports nested objects, arrays, and string pattern detection for paths, tokens, etc.
 */
const SENSITIVE_KEYS_LOWER = new Set([
  'token', 'secret', 'password', 'cookie', 'authorization', 'apikey',
  'refreshtoken', 'accesstoken', 'privatepath', 'absolutepath',
  'bearer', 'keyhash', 'opaqueKey', 'capabilitysethash', 'lookupkey',
  'capabilitylist', 'credential', 'signature', 'signingkey'
]);

const SENSITIVE_VALUE_PATTERNS_LOWER = new Set([
  'authorization', 'bearer', 'basic', 'api-key', 'x-api-key',
  'access_token', 'refresh_token', 'apikey', 'token', 'secret'
]);

const REDACT_VALUE_KEY = { redacted: true, reason: "sensitive_key" };
const REDACT_VALUE_PATH = { redacted: true, reason: "absolute_path" };

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
    lower.includes('?token=') || lower.includes('&access_token=') ||
    lower.includes('?access_token=') || lower.includes('authorization:') ||
    lower.includes('x-api-key:');
}

function isSensitiveValue(value) {
  if (typeof value !== 'string') return false;
  const lower = value.toLowerCase().trim();
  for (const pattern of SENSITIVE_VALUE_PATTERNS_LOWER) {
    if (lower === pattern || lower.startsWith(pattern + ' ') || lower.startsWith(pattern + ':')) return true;
  }
  return false;
}

function redactMetadata(metadata, depth = 0) {
  if (depth > 10) return { redacted: true, reason: "max_depth_exceeded" };
  if (metadata === null || metadata === undefined) return metadata;
  if (typeof metadata !== 'object') {
    if (typeof metadata === 'string') {
      if (isAbsPath(metadata)) return REDACT_VALUE_PATH;
      if (containsToken(metadata)) return REDACT_VALUE_KEY;
      if (isSensitiveValue(metadata)) return REDACT_VALUE_KEY;
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
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_KEYS_LOWER.has(lowerKey)) {
      result[key] = REDACT_VALUE_KEY;
      continue;
    }
    const value = metadata[key];
    if (typeof value === 'string') {
      if (isAbsPath(value)) {
        result[key] = REDACT_VALUE_PATH;
      } else if (containsToken(value)) {
        result[key] = REDACT_VALUE_KEY;
      } else if (isSensitiveValue(value)) {
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
 * Execute guards for a cell. Returns { ok, guardResults, failedGuards, blockedBy }.
 */
function executeCellGuards(cell, definition, input, guardEvaluator) {
  const guardIds = [...(cell.guards || []), ...(cell.requiredGuards || [])];
  if (guardIds.length === 0) {
    return { ok: true, guardResults: [], failedGuards: [], blockedBy: undefined };
  }

  const context = input.guardContext || {};
  let guardResults;
  if (guardEvaluator) {
    guardResults = guardEvaluator(guardIds, context);
  } else {
    guardResults = evaluateGuardSet(guardIds, context);
  }

  const failed = guardResults.filter(r => !r.ok);

  return {
    ok: failed.length === 0,
    guardResults,
    failedGuards: failed.map(r => r.guardId),
    blockedBy: failed.length > 0 ? "guard" : undefined
  };
}

/**
 * Map guard results to a safe guard summary safe for transition records.
 */
function guardSummary(guardResults) {
  if (!guardResults || guardResults.length === 0) return undefined;
  return guardResults.map(r => ({
    guardId: r.guardId,
    ok: r.ok,
    reason: r.reason
  }));
}

function classifyFailedGuards(failedGuardIds, guardResults) {
  const result = { unknown: [], missingContext: [], blocked: [] };
  for (const g of guardResults || []) {
    if (g.ok) continue;
    if (g.reason === 'unknown_guard') result.unknown.push(g.guardId);
    else if (g.reason === 'missing_context') result.missingContext.push(g.guardId);
    else result.blocked.push(g.guardId);
  }
  return result;
}

/**
 * Execute a state transition on the definition.
 *
 * @param {object} definition - state machine definition
 * @param {object} input - transition input
 * @param {string} input.entityId
 * @param {string} input.currentStatus
 * @param {string} input.eventType
 * @param {string} [input.actor]
 * @param {string} [input.reason]
 * @param {object} [input.metadata]
 * @param {string} [input.operationId]
 * @param {string} [input.traceId]
 * @param {string} [input.auditId]
 * @param {string} [input.checkpointNodeId]
 * @param {string} [input.policyDecisionId]
 * @param {string} [input.approvalId]
 * @param {string} [input.now]
 * @param {object} [input.guardContext] - context passed to guard evaluators
 * @param {Function} [input.guardEvaluator] - custom guard evaluator (guardIds, context) => results[]
 * @param {object} [options] - additional options (future use)
 * @returns {object} transition result
 */
export function transitionState(definition, input, options = {}) {
  const validationResult = validateStateMachineDefinition(definition);
  if (!validationResult.ok) {
    return {
      ok: false,
      errorCode: ERROR_CODES.STATE_MACHINE_INVALID_DEFINITION,
      message: 'Invalid state machine definition.',
      details: validationResult.errors
    };
  }

  const { entityId, currentStatus, eventType, actor, reason, metadata, operationId, traceId, auditId, checkpointNodeId, policyDecisionId, approvalId, now, guardEvaluator } = input;

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

  let matchingCells = definition.totalMatrix.filter(cell => cell.from === currentStatus && cell.event === eventType);

  if (matchingCells.length === 0) {
    return {
      ok: false,
      errorCode: ERROR_CODES.STATE_MACHINE_TRANSITION_NOT_ALLOWED,
      message: `Transition not defined for ${currentStatus} -> ${eventType}`,
      allowedEvents: listAllowedEvents(definition, currentStatus)
    };
  }

  // Multi-cell disambiguation via guard evaluation
  if (matchingCells.length > 1) {
    const eligibleCells = matchingCells.filter(cell => cell.result !== 'illegal_transition');

    if (eligibleCells.length === 0) {
      return {
        ok: false,
        errorCode: ERROR_CODES.STATE_MACHINE_TRANSITION_NOT_ALLOWED,
        message: `All transitions for ${currentStatus} -> ${eventType} are illegal.`,
        allowedEvents: listAllowedEvents(definition, currentStatus)
      };
    }

    const guardedCells = eligibleCells.filter(cell =>
      (cell.guards && cell.guards.length > 0) || (cell.requiredGuards && cell.requiredGuards.length > 0)
    );
    const unguardedCells = eligibleCells.filter(cell =>
      (!cell.guards || cell.guards.length === 0) && (!cell.requiredGuards || cell.requiredGuards.length === 0)
    );

    if (unguardedCells.length > 1) {
      return {
        ok: false,
        errorCode: ERROR_CODES.STATE_MACHINE_AMBIGUOUS_TRANSITION,
        message: `Ambiguous transition: ${unguardedCells.length} unguarded cells match ${currentStatus} -> ${eventType}.`
      };
    }

    if (unguardedCells.length === 1 && guardedCells.length === 0) {
      matchingCells = unguardedCells;
    } else {
      let passedCells = [];
      const allGuardResults = [];

      for (const cell of eligibleCells) {
        const guardResult = executeCellGuards(cell, definition, input, guardEvaluator);
        allGuardResults.push({ cellId: `${cell.from}-${cell.event}-${cell.to || 'self'}`, guards: cell.guards, requiredGuards: cell.requiredGuards, result: guardResult });
        if (guardResult.ok) {
          passedCells.push(cell);
        }
      }

      if (passedCells.length === 0) {
        const allFailedGuards = [];
        for (const gr of allGuardResults) {
          allFailedGuards.push(...(gr.result.failedGuards || []));
        }
        const classification = classifyFailedGuards(allFailedGuards, allGuardResults.flatMap(g => g.result.guardResults || []));
        if (classification.unknown.length > 0) {
          return {
            ok: false,
            errorCode: ERROR_CODES.STATE_MACHINE_GUARD_UNKNOWN,
            message: `Unknown guard(s): ${classification.unknown.join(', ')}.`,
            blockedBy: "guard",
            failedGuards: classification.unknown,
            allowedEvents: listAllowedEvents(definition, currentStatus),
            guardResults: guardSummary(allGuardResults.flatMap(g => g.result.guardResults || []))
          };
        }
        if (classification.missingContext.length > 0) {
          return {
            ok: false,
            errorCode: ERROR_CODES.STATE_MACHINE_GUARD_CONTEXT_MISSING,
            message: `Missing guard context for: ${classification.missingContext.join(', ')}.`,
            blockedBy: "guard",
            failedGuards: classification.missingContext,
            allowedEvents: listAllowedEvents(definition, currentStatus),
            guardResults: guardSummary(allGuardResults.flatMap(g => g.result.guardResults || []))
          };
        }
        return {
          ok: false,
          errorCode: ERROR_CODES.STATE_MACHINE_GUARD_BLOCKED,
          message: `All matching cells for ${currentStatus} -> ${eventType} blocked by guards: ${allFailedGuards.join(', ')}.`,
          blockedBy: "guard",
          failedGuards: allFailedGuards,
          allowedEvents: listAllowedEvents(definition, currentStatus),
          guardResults: guardSummary(allGuardResults.flatMap(g => g.result.guardResults || []))
        };
      }

      if (passedCells.length > 1) {
        return {
          ok: false,
          errorCode: ERROR_CODES.STATE_MACHINE_AMBIGUOUS_TRANSITION,
          message: `Ambiguous transition: ${passedCells.length} guarded cells pass for ${currentStatus} -> ${eventType}.`,
          ambiguousCells: passedCells.map(c => `${c.from}-${c.event}-${c.to || 'self'}`)
        };
      }

      matchingCells = passedCells;
    }
  }

  const cell = matchingCells[0];

  if (cell.result === 'illegal_transition') {
    return {
      ok: false,
      errorCode: cell.errorCode || ERROR_CODES.STATE_MACHINE_TRANSITION_NOT_ALLOWED,
      message: `Transition illegal: ${currentStatus} -> ${eventType}`,
      allowedEvents: listAllowedEvents(definition, currentStatus)
    };
  }

  // Evaluate guards for single-cell transitions too
  if ((cell.guards && cell.guards.length > 0) || (cell.requiredGuards && cell.requiredGuards.length > 0)) {
    const guardResult = executeCellGuards(cell, definition, input, guardEvaluator);
    if (!guardResult.ok) {
      const classification = classifyFailedGuards(guardResult.failedGuards, guardResult.guardResults);
      if (classification.unknown.length > 0) {
        return {
          ok: false,
          errorCode: ERROR_CODES.STATE_MACHINE_GUARD_UNKNOWN,
          message: `Unknown guard(s): ${classification.unknown.join(', ')}.`,
          blockedBy: "guard",
          failedGuards: classification.unknown,
          allowedEvents: listAllowedEvents(definition, currentStatus),
          guardResults: guardSummary(guardResult.guardResults)
        };
      }
      if (classification.missingContext.length > 0) {
        return {
          ok: false,
          errorCode: ERROR_CODES.STATE_MACHINE_GUARD_CONTEXT_MISSING,
          message: `Missing guard context for: ${classification.missingContext.join(', ')}.`,
          blockedBy: "guard",
          failedGuards: classification.missingContext,
          allowedEvents: listAllowedEvents(definition, currentStatus),
          guardResults: guardSummary(guardResult.guardResults)
        };
      }
      return {
        ok: false,
        errorCode: ERROR_CODES.STATE_MACHINE_GUARD_BLOCKED,
        message: `Transition from ${currentStatus} -> ${eventType} blocked by guard(s): ${guardResult.failedGuards.join(', ')}.`,
        blockedBy: "guard",
        failedGuards: guardResult.failedGuards,
        allowedEvents: listAllowedEvents(definition, currentStatus),
        guardResults: guardSummary(guardResult.guardResults)
      };
    }
    // Cache guard results for the transition record
    cell._guardResults = guardResult.guardResults;
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
           guardResults: guardSummary(cell._guardResults)
        },
        requiredEffects: { policy: false, approval: false, externalReceipt: false, async: false, ledger: false, checkpoint: false, audit: false }
     };
  }

  const requiresPolicy = cell.result === 'requires_policy';
  const requiresApproval = cell.result === 'requires_approval';
  const requiresExternalReceipt = cell.result === 'requires_external_receipt';
  const deferredAsync = cell.result === 'deferred_async_transition';

  const toStatus = cell.to || currentStatus;

  // For requires_policy, if no allow evidence, return blocked instead of success
  if (requiresPolicy) {
    const guardContext = input.guardContext || {};
    const pd = guardContext.policyDecision;
    const decision = pd?.decision || pd?.status;
    if (!(pd?.allowed === true || decision === 'allow')) {
      return {
        ok: false,
        errorCode: ERROR_CODES.STATE_MACHINE_GUARD_BLOCKED,
        message: `Transition requires policy approval but no allow evidence found.`,
        blockedBy: "policy",
        allowedEvents: listAllowedEvents(definition, currentStatus)
      };
    }
  }

  // For requires_approval, if no approved evidence, return blocked
  if (requiresApproval) {
    const guardContext = input.guardContext || {};
    const ar = guardContext.approvalRecord;
    if (!ar || ar.status !== 'approved') {
      return {
        ok: false,
        errorCode: ERROR_CODES.STATE_MACHINE_GUARD_BLOCKED,
        message: `Transition requires approval but no approved evidence found.`,
        blockedBy: "approval",
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
    guardResults: guardSummary(cell._guardResults)
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
