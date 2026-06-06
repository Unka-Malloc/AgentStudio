import { validateStateMachineDefinition } from "./state-machine-core.mjs";
import { checkDefinitionSchema } from "./state-machine-definition-schema.mjs";
import { guardExists, listAllGuardIds } from "./guards/guard-registry.mjs";

/**
 * Pure function to verify a state machine definition against complete C3 level specifications.
 * Does not read or write from files or network.
 * 
 * @param {Object} def The state machine definition object to verify
 * @param {Object} options Configuration options
 * @param {string} options.relativePath Path or identifier to display in error messages
 * @param {boolean} options.throwOnError If true, throws an Error on first check failure
 * @returns {Object} Verification report structure
 */
export function verifyMachineDefinition(def, options = {}) {
  const relativePath = options.relativePath || "unknown";
  const throwOnError = options.throwOnError !== false;

  const checks = [];

  const addCheck = (id, checkFn) => {
    try {
      checkFn();
      checks.push({ id, status: "passed" });
      return true;
    } catch (err) {
      checks.push({ id, status: "failed", error: err.message });
      if (throwOnError) {
        throw new Error(`[${relativePath}] Check '${id}' failed: ${err.message}`);
      }
      return false;
    }
  };

  // 1. Schema check
  const schemaOk = addCheck("C1-schema-validation", () => {
    checkDefinitionSchema(def);
  });
  if (!schemaOk && throwOnError) return; // Stop if schema fails and throwing

  // 2. Core validation
  const coreOk = addCheck("C2-core-validation", () => {
    const result = validateStateMachineDefinition(def);
    if (!result.ok) {
      throw new Error(`Core validation failed: ${result.errors.map(e => e.message).join('; ')}`);
    }
  });
  if (!coreOk && throwOnError) return;

  const { machineId, version, initialState, states, events, totalMatrix, invariants, proofObligations } = def;
  const stateIds = states.map(s => s.id);
  const eventIds = events.map(e => e.id);

  // 3. Matrix Totality check
  addCheck("C2-matrix-totality", () => {
    const matrixKeys = new Set(totalMatrix.map(cell => `${cell.from}::${cell.event}`));
    const missingCells = [];

    for (const s of stateIds) {
      for (const e of eventIds) {
        const key = `${s}::${e}`;
        if (!matrixKeys.has(key)) {
          missingCells.push(key);
        }
      }
    }

    if (missingCells.length > 0) {
      throw new Error(`Matrix Totality check failed. Missing ${missingCells.length} cells: ${missingCells.join(", ")}`);
    }
  });

  // 4. Reachability check (BFS)
  addCheck("C3-reachability", () => {
    const reachable = new Set([initialState]);
    const queue = [initialState];
    
    while (queue.length > 0) {
      const current = queue.shift();
      const allowedCells = totalMatrix.filter(cell => 
        cell.from === current && 
        ["legal_transition", "requires_policy", "requires_approval", "deferred_async_transition"].includes(cell.result)
      );
      
      for (const cell of allowedCells) {
        const to = cell.to || current;
        if (!reachable.has(to)) {
          reachable.add(to);
          queue.push(to);
        }
      }
    }

    const unreachableStates = states.filter(s => !s.externalEntryState && !reachable.has(s.id)).map(s => s.id);
    if (unreachableStates.length > 0) {
      throw new Error(`Reachability check failed. Unreachable states: ${unreachableStates.join(", ")}`);
    }
  });

  // 5. Non-terminal outgoing transition check
  addCheck("C3-non-terminal-transitions", () => {
    const terminalStates = new Set(states.filter(s => s.terminal).map(s => s.id));
    for (const s of states) {
      if (terminalStates.has(s.id)) continue;
      if (s.passiveState === true || s.waitingStateWithTimeout === true) continue;

      const hasOutgoing = totalMatrix.some(cell => 
        cell.from === s.id && 
        cell.to && 
        cell.to !== s.id &&
        cell.result !== "illegal_transition" && 
        cell.result !== "ignored_idempotent_event"
      );

      if (!hasOutgoing) {
        throw new Error(`Non-terminal state '${s.id}' must have at least one outgoing legal/deferred transition, or be marked passiveState.`);
      }
    }
  });

  // 6. Terminal check (outgoing transitions rules)
  addCheck("C3-terminal-statuses", () => {
    const terminalStates = states.filter(s => s.terminal).map(s => s.id);
    for (const t of terminalStates) {
      const outgoingCells = totalMatrix.filter(cell => cell.from === t);
      for (const cell of outgoingCells) {
        const isIdempotent = events.find(e => e.id === cell.event)?.idempotent;
        const isAllowedTerminal = def.allowedTerminalEvents?.includes(cell.event);
        const isReopen = cell.allowedReopenTransition === true;
        
        if (
          cell.result !== "illegal_transition" && 
          cell.result !== "ignored_idempotent_event" && 
          !isIdempotent && 
          !isAllowedTerminal && 
          !isReopen
        ) {
          throw new Error(`Terminal state '${t}' has invalid outgoing transition on '${cell.event}'`);
        }
      }
    }
  });

  // 7. Illegal transition errorCode check
  addCheck("C2-illegal-transition-error-codes", () => {
    for (const cell of totalMatrix) {
      if (cell.result === "illegal_transition" && !cell.errorCode) {
        throw new Error(`Illegal transition from '${cell.from}' on '${cell.event}' is missing 'errorCode'`);
      }
    }
  });

  // 8. High-risk transition check
  addCheck("C3-high-risk-guards", () => {
    for (const cell of totalMatrix) {
      const eventDef = events.find(e => e.id === cell.event);
      if (eventDef?.riskLevel === "high" && cell.result !== "illegal_transition" && cell.result !== "ignored_idempotent_event") {
        const hasGuard = 
          cell.result === "requires_policy" || 
          cell.result === "requires_approval" || 
          (cell.guards && cell.guards.length > 0) ||
          (cell.requiredGuards && cell.requiredGuards.length > 0);
        if (!hasGuard) {
          throw new Error(`High-risk event '${cell.event}' in transition from '${cell.from}' must define a guard (guards/requiredGuards) or policy/approval result`);
        }
      }
    }
  });

  // 8b. Guard registry validation
  addCheck("C3-guard-registry", () => {
    const allGuardIds = new Set(listAllGuardIds());
    for (const cell of totalMatrix) {
      for (const guardId of (cell.guards || [])) {
        if (!allGuardIds.has(guardId)) {
          throw new Error(`Guard '${guardId}' in transition from '${cell.from}' on '${cell.event}' is not registered. Known guards: ${listAllGuardIds().join(', ')}`);
        }
      }
    }
  });

  // 8c. Guard proof obligation coverage for high-risk events
  addCheck("C3-guard-proof-obligation", () => {
    const guardObligations = (def.proofObligations || []).filter(po => po.startsWith("PO-READY-"));
    if (guardObligations.length === 0) return;
    for (const guardId of (def.guardRegistryRefs || [])) {
      const hasMapping = (def.proofMappings || []).some(
        m => m.method === "guard_validation_by_risk" && m.params.guardId === guardId
      );
      if (!hasMapping) {
        throw new Error(`Guard '${guardId}' referenced in guardRegistryRefs has no proof obligation mapping in 'proofMappings'.`);
      }
    }
  });

  // 9. Invariants check
  addCheck("C3-invariants-identification", () => {
    const machinePrefix = machineId.split(".")[0].toUpperCase();
    for (const inv of invariants) {
      if (!inv.startsWith("SM-GOV-") && !inv.startsWith(`SM-${machinePrefix}-`)) {
        throw new Error(`Invariant '${inv}' does not conform to naming specification 'SM-GOV-xxx' or 'SM-${machinePrefix}-xxx'`);
      }
    }
  });

  // 10. Proof obligations and mappings check
  addCheck("C3-proof-obligations-mapping", () => {
    const mappings = def.proofMappings || [];
    for (const po of proofObligations) {
      const hasMapping = mappings.some(m => m.obligationId === po);
      if (!hasMapping) {
        throw new Error(`Proof obligation '${po}' is missing mapping details in 'proofMappings'`);
      }
    }
  });

  // 11. Secret-like scan and absolute path scan
  addCheck("C3-secret-hygiene-scan", () => {
    const forbiddenPatterns = [
      /api_key/i,
      /secret/i,
      /token/i,
      /cookie/i,
      /Authorization/i,
      /Bearer/i,
      /AKIA/i,
      /-----BEGIN/i
    ];
    
    const absolutePathPatterns = [
      /\/Users\//i,
      /\/home\//i,
      /[a-zA-Z]:\\/i
    ];

    function scanSensitive(obj, path = "root") {
      if (typeof obj === "string") {
        if (obj.startsWith("<redacted-") || obj.startsWith("redacted-") || obj === "UNREVIEWED" || obj === "sensitive_key") {
          return;
        }
        for (const pattern of forbiddenPatterns) {
          if (pattern.test(obj)) {
            if (path.includes("description") || path.includes("label")) {
              continue;
            }
            throw new Error(`Sensitive pattern matched: value '${obj}' at '${path}' contains secret-like content.`);
          }
        }
        for (const pattern of absolutePathPatterns) {
          if (pattern.test(obj)) {
            throw new Error(`Absolute path matched: value '${obj}' at '${path}' contains absolute local paths.`);
          }
        }
      } else if (obj && typeof obj === "object") {
        for (const key of Object.keys(obj)) {
          scanSensitive(obj[key], `${path}.${key}`);
        }
      }
    }
    scanSensitive(def);
  });

  const ok = checks.every(c => c.status === "passed");

  return {
    machineId: def.machineId,
    version: def.version,
    ok,
    completenessLevel: "C3",
    stateCount: states?.length || 0,
    eventCount: events?.length || 0,
    matrixCellCount: totalMatrix?.length || 0,
    checks
  };
}
