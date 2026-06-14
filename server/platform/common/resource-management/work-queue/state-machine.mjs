export const WORK_QUEUE_STATES = Object.freeze({
  PENDING: "pending",
  DELAYED: "delayed",
  LEASED: "leased",
  DEAD_LETTER: "dead_letter",
  FALLBACK_REVIEW: "fallback_review",
  ACKED: "acked",
  TERMINATED: "terminated"
});

export const WORK_QUEUE_TERMINAL_STATES = Object.freeze([
  WORK_QUEUE_STATES.ACKED,
  WORK_QUEUE_STATES.TERMINATED
]);

export const WORK_QUEUE_SAFE_INTERVENTION_STATES = Object.freeze([
  WORK_QUEUE_STATES.PENDING,
  WORK_QUEUE_STATES.DELAYED,
  WORK_QUEUE_STATES.DEAD_LETTER,
  WORK_QUEUE_STATES.FALLBACK_REVIEW,
  WORK_QUEUE_STATES.ACKED,
  WORK_QUEUE_STATES.TERMINATED
]);

export const WORK_QUEUE_TRANSITIONS = Object.freeze({
  enqueue: Object.freeze({
    from: Object.freeze([null]),
    to: Object.freeze([WORK_QUEUE_STATES.PENDING, WORK_QUEUE_STATES.DELAYED])
  }),
  claim: Object.freeze({
    from: Object.freeze([WORK_QUEUE_STATES.PENDING]),
    to: Object.freeze([WORK_QUEUE_STATES.LEASED])
  }),
  progress: Object.freeze({
    from: Object.freeze([WORK_QUEUE_STATES.LEASED]),
    to: Object.freeze([WORK_QUEUE_STATES.LEASED]),
    leaseBound: true
  }),
  ack: Object.freeze({
    from: Object.freeze([WORK_QUEUE_STATES.LEASED]),
    to: Object.freeze([WORK_QUEUE_STATES.ACKED]),
    leaseBound: true
  }),
  nack: Object.freeze({
    from: Object.freeze([WORK_QUEUE_STATES.LEASED]),
    to: Object.freeze([
      WORK_QUEUE_STATES.PENDING,
      WORK_QUEUE_STATES.DELAYED,
      WORK_QUEUE_STATES.DEAD_LETTER
    ]),
    leaseBound: true
  }),
  dead_letter: Object.freeze({
    from: Object.freeze([
      WORK_QUEUE_STATES.PENDING,
      WORK_QUEUE_STATES.DELAYED,
      WORK_QUEUE_STATES.LEASED,
      WORK_QUEUE_STATES.FALLBACK_REVIEW
    ]),
    to: Object.freeze([WORK_QUEUE_STATES.DEAD_LETTER])
  }),
  recover: Object.freeze({
    from: Object.freeze([
      WORK_QUEUE_STATES.DEAD_LETTER,
      WORK_QUEUE_STATES.FALLBACK_REVIEW
    ]),
    to: Object.freeze([
      WORK_QUEUE_STATES.PENDING,
      WORK_QUEUE_STATES.DELAYED,
      WORK_QUEUE_STATES.TERMINATED
    ])
  }),
  lease_expired: Object.freeze({
    from: Object.freeze([WORK_QUEUE_STATES.LEASED]),
    to: Object.freeze([
      WORK_QUEUE_STATES.PENDING,
      WORK_QUEUE_STATES.DELAYED,
      WORK_QUEUE_STATES.DEAD_LETTER
    ]),
    fallback: true
  }),
  delay_matured: Object.freeze({
    from: Object.freeze([WORK_QUEUE_STATES.DELAYED]),
    to: Object.freeze([WORK_QUEUE_STATES.PENDING]),
    fallback: true
  }),
  term: Object.freeze({
    from: Object.freeze([WORK_QUEUE_STATES.LEASED]),
    to: Object.freeze([WORK_QUEUE_STATES.TERMINATED]),
    leaseBound: true
  }),
  fallback_failed: Object.freeze({
    from: Object.freeze([WORK_QUEUE_STATES.LEASED]),
    to: Object.freeze([WORK_QUEUE_STATES.FALLBACK_REVIEW]),
    fallback: true
  }),
  fallback_review_retry: Object.freeze({
    from: Object.freeze([WORK_QUEUE_STATES.FALLBACK_REVIEW]),
    to: Object.freeze([
      WORK_QUEUE_STATES.PENDING,
      WORK_QUEUE_STATES.DELAYED,
      WORK_QUEUE_STATES.DEAD_LETTER,
      WORK_QUEUE_STATES.TERMINATED
    ])
  })
});

export const WORK_QUEUE_STATE_MACHINE_PROOF_VERSION = "v0.0.1:workflow:work-queue-state-machine-proof-1";

export function isWorkQueueState(value) {
  return Object.values(WORK_QUEUE_STATES).includes(value);
}

export function isTerminalWorkQueueState(value) {
  return WORK_QUEUE_TERMINAL_STATES.includes(value);
}

export function isSafeInterventionState(value) {
  return WORK_QUEUE_SAFE_INTERVENTION_STATES.includes(value);
}

export function getWorkQueueTransition(transition) {
  return WORK_QUEUE_TRANSITIONS[String(transition || "")] || null;
}

export function getAllowedTargetStates({ transition, fromState }) {
  const definition = getWorkQueueTransition(transition);
  if (!definition || !definition.from.includes(fromState ?? null)) {
    return [];
  }
  return [...definition.to];
}

export function isLegalWorkQueueTransition({ transition, fromState = null, toState }) {
  const allowed = getAllowedTargetStates({ transition, fromState });
  return allowed.includes(toState);
}

export function assertLegalWorkQueueTransition({ transition, fromState = null, toState }) {
  if (isLegalWorkQueueTransition({ transition, fromState, toState })) {
    return true;
  }
  const fromLabel = fromState === null || fromState === undefined ? "none" : String(fromState);
  throw new Error(`Illegal work queue transition: ${transition} ${fromLabel} -> ${toState}`);
}

export function describeWorkQueueStateMachine() {
  return {
    states: Object.values(WORK_QUEUE_STATES),
    terminalStates: [...WORK_QUEUE_TERMINAL_STATES],
    safeInterventionStates: [...WORK_QUEUE_SAFE_INTERVENTION_STATES],
    transitions: Object.fromEntries(
      Object.entries(WORK_QUEUE_TRANSITIONS).map(([name, definition]) => [
        name,
        {
          from: [...definition.from],
          to: [...definition.to],
          leaseBound: definition.leaseBound === true,
          fallback: definition.fallback === true
        }
      ])
    )
  };
}

export function buildWorkQueueTransitionMatrix() {
  const states = Object.values(WORK_QUEUE_STATES);
  const events = Object.keys(WORK_QUEUE_TRANSITIONS);
  return states.flatMap((fromState) =>
    events.map((transition) => {
      const allowedTargets = getAllowedTargetStates({ transition, fromState });
      return Object.freeze({
        fromState,
        transition,
        legal: allowedTargets.length > 0,
        toStates: Object.freeze(allowedTargets)
      });
    })
  );
}

export function verifyWorkQueueStateMachineProof() {
  const errors = [];
  const states = Object.values(WORK_QUEUE_STATES);
  const events = Object.keys(WORK_QUEUE_TRANSITIONS);
  const matrix = buildWorkQueueTransitionMatrix();
  const matrixKeys = new Set(matrix.map((cell) => `${cell.fromState}:${cell.transition}`));

  for (const state of states) {
    for (const event of events) {
      if (!matrixKeys.has(`${state}:${event}`)) {
        errors.push(`Missing state machine matrix cell: ${state} x ${event}`);
      }
    }
  }

  for (const terminalState of WORK_QUEUE_TERMINAL_STATES) {
    const legalTerminalExits = matrix.filter((cell) => cell.fromState === terminalState && cell.legal);
    if (legalTerminalExits.length > 0) {
      errors.push(`Terminal state has legal exits: ${terminalState}`);
    }
  }

  for (const state of states) {
    if (isTerminalWorkQueueState(state)) {
      continue;
    }
    const legalOutgoing = matrix.filter((cell) => cell.fromState === state && cell.legal);
    if (legalOutgoing.length === 0) {
      errors.push(`Non-terminal state has no legal outgoing transitions: ${state}`);
    }
  }

  for (const cell of matrix) {
    if (!cell.legal && cell.toStates.length !== 0) {
      errors.push(`Illegal matrix cell exposes target states: ${cell.fromState} x ${cell.transition}`);
    }
    for (const toState of cell.toStates) {
      try {
        assertLegalWorkQueueTransition({
          transition: cell.transition,
          fromState: cell.fromState,
          toState
        });
      } catch (error) {
        errors.push(error.message);
      }
    }
  }

  return {
    ok: errors.length === 0,
    version: WORK_QUEUE_STATE_MACHINE_PROOF_VERSION,
    matrixCells: matrix.length,
    states: states.length,
    events: events.length,
    errors,
    matrix
  };
}

export function verifyWorkQueueStateMachine() {
  const errors = [];
  const states = new Set(Object.values(WORK_QUEUE_STATES));

  for (const terminalState of WORK_QUEUE_TERMINAL_STATES) {
    if (!states.has(terminalState)) {
      errors.push(`Unknown terminal state: ${terminalState}`);
    }
  }

  for (const safeState of WORK_QUEUE_SAFE_INTERVENTION_STATES) {
    if (!states.has(safeState)) {
      errors.push(`Unknown safe intervention state: ${safeState}`);
    }
  }

  for (const [name, definition] of Object.entries(WORK_QUEUE_TRANSITIONS)) {
    if (!Array.isArray(definition.from) || definition.from.length === 0) {
      errors.push(`Transition ${name} has no from states.`);
    }
    if (!Array.isArray(definition.to) || definition.to.length === 0) {
      errors.push(`Transition ${name} has no target states.`);
    }
    for (const fromState of definition.from) {
      if (fromState !== null && !states.has(fromState)) {
        errors.push(`Transition ${name} has unknown from state ${fromState}.`);
      }
      if (isTerminalWorkQueueState(fromState)) {
        errors.push(`Transition ${name} leaves terminal state ${fromState}.`);
      }
    }
    for (const toState of definition.to) {
      if (!states.has(toState)) {
        errors.push(`Transition ${name} has unknown target state ${toState}.`);
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    machine: describeWorkQueueStateMachine(),
    proof: verifyWorkQueueStateMachineProof()
  };
}
