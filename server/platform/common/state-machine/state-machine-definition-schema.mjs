export function checkDefinitionSchema(def) {
  if (!def || typeof def !== "object" || Array.isArray(def)) {
    throw new Error("definition must be a JSON object");
  }

  const requiredStringFields = ["machineId", "entityType", "version", "description", "initialState"];
  for (const field of requiredStringFields) {
    if (typeof def[field] !== "string" || !def[field].trim()) {
      throw new Error(`definition field '${field}' must be a non-empty string`);
    }
  }

  // states validation
  if (!Array.isArray(def.states)) {
    throw new Error("definition field 'states' must be an array");
  }
  for (const state of def.states) {
    if (typeof state !== "object" || Array.isArray(state) || !state) {
      throw new Error("state item must be a JSON object");
    }
    if (typeof state.id !== "string" || !state.id.trim()) {
      throw new Error("state item 'id' must be a non-empty string");
    }
    if (state.terminal !== undefined && typeof state.terminal !== "boolean") {
      throw new Error(`state '${state.id}' field 'terminal' must be a boolean`);
    }
    if (state.externalEntryState !== undefined && typeof state.externalEntryState !== "boolean") {
      throw new Error(`state '${state.id}' field 'externalEntryState' must be a boolean`);
    }
    if (state.waitingStateWithTimeout !== undefined && typeof state.waitingStateWithTimeout !== "boolean") {
      throw new Error(`state '${state.id}' field 'waitingStateWithTimeout' must be a boolean`);
    }
    if (state.passiveState !== undefined && typeof state.passiveState !== "boolean") {
      throw new Error(`state '${state.id}' field 'passiveState' must be a boolean`);
    }
  }

  // events validation
  if (!Array.isArray(def.events)) {
    throw new Error("definition field 'events' must be an array");
  }
  for (const event of def.events) {
    if (typeof event !== "object" || Array.isArray(event) || !event) {
      throw new Error("event item must be a JSON object");
    }
    if (typeof event.id !== "string" || !event.id.trim()) {
      throw new Error("event item 'id' must be a non-empty string");
    }
    if (event.idempotent !== undefined && typeof event.idempotent !== "boolean") {
      throw new Error(`event '${event.id}' field 'idempotent' must be a boolean`);
    }
    if (event.riskLevel !== undefined && !["low", "medium", "high"].includes(event.riskLevel)) {
      throw new Error(`event '${event.id}' field 'riskLevel' must be 'low', 'medium', or 'high'`);
    }
  }

  // totalMatrix validation
  if (!Array.isArray(def.totalMatrix)) {
    throw new Error("definition field 'totalMatrix' must be an array");
  }
  const validResults = [
    "legal_transition",
    "illegal_transition",
    "ignored_idempotent_event",
    "requires_policy",
    "requires_approval",
    "requires_external_receipt",
    "deferred_async_transition"
  ];
  for (const cell of def.totalMatrix) {
    if (typeof cell !== "object" || Array.isArray(cell) || !cell) {
      throw new Error("matrix cell must be a JSON object");
    }
    if (typeof cell.from !== "string" || !cell.from.trim()) {
      throw new Error("matrix cell 'from' must be a non-empty string");
    }
    if (typeof cell.event !== "string" || !cell.event.trim()) {
      throw new Error("matrix cell 'event' must be a non-empty string");
    }
    if (!validResults.includes(cell.result)) {
      throw new Error(`matrix cell from '${cell.from}' on '${cell.event}' has invalid result: '${cell.result}'`);
    }
    if (cell.to !== undefined && typeof cell.to !== "string") {
      throw new Error("matrix cell 'to' must be a string");
    }
    if (cell.errorCode !== undefined && typeof cell.errorCode !== "string") {
      throw new Error("matrix cell 'errorCode' must be a string");
    }
    if (cell.allowedReopenTransition !== undefined && typeof cell.allowedReopenTransition !== "boolean") {
      throw new Error("matrix cell 'allowedReopenTransition' must be a boolean");
    }
    if (cell.guards !== undefined) {
      if (!Array.isArray(cell.guards)) {
        throw new Error("matrix cell 'guards' must be an array of strings");
      }
      for (const g of cell.guards) {
        if (typeof g !== "string" || !g.trim()) {
          throw new Error("guards list items must be non-empty strings");
        }
      }
    }
    if (cell.requiredGuards !== undefined) {
      if (!Array.isArray(cell.requiredGuards)) {
        throw new Error("matrix cell 'requiredGuards' must be an array of strings");
      }
      for (const rg of cell.requiredGuards) {
        if (typeof rg !== "string") {
          throw new Error("requiredGuards list items must be strings");
        }
      }
    }
    if (cell.sideEffects !== undefined && !Array.isArray(cell.sideEffects)) {
      throw new Error("matrix cell 'sideEffects' must be an array of strings");
    }
    if (cell.proofObligations !== undefined && !Array.isArray(cell.proofObligations)) {
      throw new Error("matrix cell 'proofObligations' must be an array of strings");
    }
  }

  // invariants validation
  if (!Array.isArray(def.invariants)) {
    throw new Error("definition field 'invariants' must be an array");
  }
  for (const inv of def.invariants) {
    if (typeof inv !== "string" || !inv.trim()) {
      throw new Error("invariant list items must be non-empty strings");
    }
  }

  // proofObligations validation
  if (!Array.isArray(def.proofObligations)) {
    throw new Error("definition field 'proofObligations' must be an array");
  }
  for (const po of def.proofObligations) {
    if (typeof po !== "string" || !po.trim()) {
      throw new Error("proofObligations list items must be non-empty strings");
    }
  }

  // proofMappings validation if present
  if (def.proofMappings !== undefined) {
    if (!Array.isArray(def.proofMappings)) {
      throw new Error("definition field 'proofMappings' must be an array");
    }
    for (const mapping of def.proofMappings) {
      if (typeof mapping !== "object" || Array.isArray(mapping) || !mapping) {
        throw new Error("proofMapping item must be a JSON object");
      }
      if (typeof mapping.obligationId !== "string" || !mapping.obligationId.trim()) {
        throw new Error("proofMapping 'obligationId' must be a non-empty string");
      }
      if (typeof mapping.method !== "string" || !mapping.method.trim()) {
        throw new Error("proofMapping 'method' must be a non-empty string");
      }
      if (mapping.params !== undefined && (typeof mapping.params !== "object" || mapping.params === null)) {
        throw new Error("proofMapping 'params' must be an object");
      }
    }
  }

  return true;
}
