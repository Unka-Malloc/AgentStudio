import { STATE_MACHINE_GUARDS } from "./guard-registry.mjs";

export function evaluateGuard(guardId, context = {}) {
  const guardDef = STATE_MACHINE_GUARDS[guardId];
  if (!guardDef) {
    return {
      ok: false,
      guardId,
      reason: "unknown_guard",
      message: `Guard '${guardId}' is not registered.`
    };
  }

  for (const required of guardDef.contextRequired) {
    if (context[required] === undefined) {
      return {
        ok: false,
        guardId,
        reason: "missing_context",
        message: `Guard '${guardId}' requires context field '${required}'.`
      };
    }
  }

  return {
    ok: true,
    guardId,
    reason: "static_check_only",
    message: `Guard '${guardId}' is declared; runtime enforcement is delegated to the business layer.`
  };
}

export function evaluateGuardSet(guardIds, context = {}) {
  const results = [];
  for (const guardId of guardIds) {
    results.push(evaluateGuard(guardId, context));
  }
  return results;
}

export function evaluateTransitionGuards(definition, fromStatus, eventType, context = {}) {
  const cells = definition.totalMatrix.filter(
    (cell) => cell.from === fromStatus && cell.event === eventType
  );
  if (cells.length === 0) {
    return { ok: false, reason: "no_matching_cell" };
  }

  const cell = cells[0];
  const guardIds = cell.guards || [];
  if (guardIds.length === 0) {
    return { ok: true, guardResults: [] };
  }

  const guardResults = evaluateGuardSet(guardIds, context);
  const failed = guardResults.filter((r) => !r.ok);

  return {
    ok: failed.length === 0,
    guardResults,
    failedGuards: failed.map((r) => r.guardId),
    blockedBy: failed.length > 0 ? "guard" : undefined
  };
}
