import { ERROR_CODES, StateMachineError } from './state-machine-errors.mjs';

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
 * Basic redaction helper to prevent sensitive data from entering transition metadata.
 */
function redactMetadata(metadata) {
  if (!metadata) return undefined;
  const redacted = { ...metadata };
  const sensitiveKeys = [
    'token', 'secret', 'password', 'cookie', 'authorization', 'apikey', 'refreshtoken', 'accesstoken', 'privatepath', 'absolutepath'
  ];

  for (const key of Object.keys(redacted)) {
    const lowerKey = key.toLowerCase();
    if (sensitiveKeys.some(sk => lowerKey.includes(sk))) {
      redacted[key] = { redacted: true, reason: "sensitive_key" };
    } else if (typeof redacted[key] === 'string') {
        if (redacted[key].startsWith('/Users/') || redacted[key].startsWith('/home/') || /^[a-zA-Z]:\\/.test(redacted[key])) {
             redacted[key] = { redacted: true, reason: "absolute_path" };
        }
    }
  }
  return redacted;
}

export function transitionState(definition, input) {
  const validationResult = validateStateMachineDefinition(definition);
  if (!validationResult.ok) {
    return {
      ok: false,
      errorCode: ERROR_CODES.STATE_MACHINE_INVALID_DEFINITION,
      message: 'Invalid state machine definition.',
      details: validationResult.errors
    };
  }

  const { entityId, currentStatus, eventType, actor, reason, metadata, operationId, traceId, auditId, checkpointNodeId, policyDecisionId, approvalId, now } = input;

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

  const matchingCells = definition.totalMatrix.filter(cell => cell.from === currentStatus && cell.event === eventType);
  
  if (matchingCells.length === 0) {
    // In a fully complete matrix, this shouldn't happen, but fallback.
    return {
      ok: false,
      errorCode: ERROR_CODES.STATE_MACHINE_TRANSITION_NOT_ALLOWED,
      message: `Transition not defined for ${currentStatus} -> ${eventType}`,
      allowedEvents: listAllowedEvents(definition, currentStatus)
    };
  }

  if (matchingCells.length > 1) {
    // We would need to evaluate guards here. For now, throw ambiguous.
    return {
      ok: false,
      errorCode: ERROR_CODES.STATE_MACHINE_AMBIGUOUS_TRANSITION,
      message: `Ambiguous transition. Multiple cells match without guard evaluation logic implemented yet.`
    };
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

  if (cell.result === 'ignored_idempotent_event') {
     // Return success but indicate no state change
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
           entityId, entityType: definition.entityType, fromStatus: currentStatus, toStatus: currentStatus, eventType, operationId, timestamp: now, actor, reason, metadata: redactMetadata(metadata)
        },
        requiredEffects: { policy: false, approval: false, ledger: false, checkpoint: false, audit: false }
     };
  }

  const requiresPolicy = cell.result === 'requires_policy';
  const requiresApproval = cell.result === 'requires_approval';

  const toStatus = cell.to || currentStatus;

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
    approvalId
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
      ledger: true, // typical state change requires ledger write
      checkpoint: !!cell.sideEffects?.includes('checkpoint'),
      audit: !!cell.sideEffects?.includes('audit')
    }
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
      allowedEvents: result.allowedEvents
    });
  }
  return result;
}
