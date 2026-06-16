import { decorateKnowledgeCapabilityOperation } from "./knowledge-capability-layers.mjs";

const MAINTENANCE_AGENT_RISKS = [
  "read_only",
  "safe_write",
  "repair_write",
  "destructive"
];

function normalizeRisk(value, fallback = "read_only") {
  const risk = String(value || "").trim();
  return MAINTENANCE_AGENT_RISKS.includes(risk) ? risk : fallback;
}

function riskRank(value) {
  const index = MAINTENANCE_AGENT_RISKS.indexOf(normalizeRisk(value));
  return index >= 0 ? index : 0;
}

function maxRisk(...risks) {
  return risks
    .map((risk) => normalizeRisk(risk))
    .sort((left, right) => riskRank(right) - riskRank(left))[0] || "read_only";
}

export const OPERATION_ASPECTS = Object.freeze({
  AUTHORIZATION: "authorization",
  SAFETY: "safety",
  AUDIT: "audit",
  DISPATCH: "dispatch"
});

const DEFAULT_REPAIR_APPROVAL_SCOPE = "maintenance:approve";

const REPAIR_KNOWLEDGE_MAINTENANCE_TASKS = new Set([
  "delete_orphan_objects",
  "garbage_cleanup",
  "cleanup_garbage",
  "gc",
  "compact_storage",
  "reembed_by_model_version",
  "reindex",
  "rebuild_index"
]);

const DRY_RUN_SAFE_KNOWLEDGE_MAINTENANCE_TASKS = new Set([
  "garbage_cleanup",
  "cleanup_garbage",
  "gc",
  "compact_storage"
]);

const READ_ONLY_POST_OPERATION_IDS = new Set([
  "auth.roles.get",
  "knowledge.search",
  "knowledge.render_markdown",
  "knowledge.evidence_gate.evaluate",
  "knowledge.agent_skill.plan",
  "knowledge.agent_skill.run",
  "knowledge.retrieval_playbook.plan",
  "knowledge.retrieval_playbook.run",
  "knowledge.model_decision",
  "context.compaction.preview",
  "client_runtime.resolve",
  "settings.model_probe"
]);

const PUBLIC_OPERATION_IDS = new Set([
  "system.health",
  "system.bootstrap",
  "auth.session",
  "auth.login",
  "oauth.codex_return",
  "discovery.check_in"
]);

const EXTERNAL_AUTH_OPERATION_IDS = new Set([
  "agent_sync.publish",
  "tool_management.execute",
  "tool_management.batch",
  "tool_management.dry_run"
]);

const EXTERNAL_AUTH_MISSING_CODE_DECORATORS = new Map([
  ["tool_management.execute", "missing_token"],
  ["tool_management.batch", "missing_token"],
  ["tool_management.dry_run", "missing_token"]
]);

const REQUIRED_SCOPE_DECORATORS = new Map([
  ["events.subscribe", ["console:read"]],
  ["agent_sync.subscribe", ["console:read"]],
  ["discovery.clients", ["console:read"]],
  ["agents.list", ["console:read"]],
  ["oauth.codex_status", ["console:read"]],
  ["oauth.codex_login", ["runtime:admin"]]
]);

function resolveKnowledgeMaintenanceRunRisk(context = {}) {
  const input = getSafetyInput(context);
  const taskType = String(input.taskType || input.task || "")
    .trim()
    .replace(/-/g, "_");
  if (
    DRY_RUN_SAFE_KNOWLEDGE_MAINTENANCE_TASKS.has(taskType) &&
    (input.dryRun === true || input.dry_run === true)
  ) {
    return "safe_write";
  }
  return REPAIR_KNOWLEDGE_MAINTENANCE_TASKS.has(taskType) ? "repair_write" : "safe_write";
}

const SAFETY_DECORATORS = new Map([
  ["agent_sync.config.set", { risk: "repair_write" }],
  ["maintenance_agent.config.set", { risk: "repair_write" }],
  ["maintenance_agent.runs.approve", { risk: "repair_write", requiresConfirmation: false }],
  ["auth.roles.get", { risk: "read_only" }],
  ["auth.users.update", { risk: "repair_write" }],
  ["auth.oidc.set", { risk: "repair_write" }],
  ["auth.audit.retention.set", { risk: "repair_write" }],
  ["auth.audit.prune", { risk: "repair_write" }],
  ["tool_management.metrics_prune", { risk: "repair_write" }],
  ["auth.sessions.rotate", { risk: "safe_write" }],
  ["discovery.clients.migration", { risk: "repair_write" }],
  ["discovery.set_config", { risk: "repair_write" }],
  ["runtime.set_mounts", { risk: "repair_write", approvalScope: "runtime:admin" }],
  ["runtime.reload_mounts", { risk: "repair_write", approvalScope: "runtime:admin" }],
  ["storage.reconcile", { risk: "repair_write" }],
  ["settings.set", { risk: "repair_write" }],
  ["agent_gateway.config.set", { risk: "repair_write" }],
  ["email_rules.set", { risk: "repair_write" }],
  ["expert_vocabulary.set", { risk: "repair_write" }],
  ["context.session_memory.clear", { risk: "repair_write" }],
  ["knowledge_taxonomy.set", { risk: "repair_write" }],
  ["knowledge.maintenance.set", { risk: "repair_write" }],
  ["knowledge.reindex", { risk: "repair_write" }],
  [
    "knowledge.maintenance.run",
    {
      risk: "safe_write",
      resolveRisk: resolveKnowledgeMaintenanceRunRisk
    }
  ],
  ["jobs.delete", { risk: "repair_write" }]
]);

const CONCURRENCY_GROUP_DECORATORS = new Map([
  ["settings.set", "settings"],
  ["agent_gateway.config.set", "settings"],
  ["runtime.set_mounts", "runtime.mounts"],
  ["runtime.reload_mounts", "runtime.mounts"],
  ["discovery.set_config", "discovery.config"],
  ["agent_sync.config.set", "agent_sync.config"],
  ["maintenance_agent.config.set", "maintenance_agent.config"],
  ["email_rules.set", "rules.email"],
  ["expert_vocabulary.set", "rules.expert_vocabulary"],
  ["knowledge_taxonomy.set", "rules.knowledge_taxonomy"],
  ["knowledge.maintenance.set", "knowledge.maintenance"],
  ["knowledge.maintenance.run", "knowledge.maintenance"],
  ["knowledge.reindex", "knowledge.maintenance"],
  ["context.compaction.run", "context.compaction"],
  ["context.session_memory.clear", "agent.memory"]
]);

function uniqueStrings(values = []) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

export function withAspect(aspect, options = {}) {
  return (operation) => ({
    ...operation,
    aspects: uniqueStrings([...(operation.aspects || []), aspect]),
    aspectOptions: {
      ...(operation.aspectOptions || {}),
      [aspect]: {
        ...(operation.aspectOptions?.[aspect] || {}),
        ...options
      }
    }
  });
}

export function withRequiredScopes(scopes = []) {
  return (operation) => ({
    ...operation,
    requiredScopes: uniqueStrings([...(operation.requiredScopes || []), ...scopes])
  });
}

export function withScopes(scopes = []) {
  return withRequiredScopes(scopes);
}

export function withTransport(transport = {}) {
  return (operation) => ({
    ...operation,
    http: transport.http || operation.http,
    rpc: transport.rpc === undefined ? operation.rpc : transport.rpc,
    cli: transport.cli === undefined ? operation.cli : transport.cli,
    binary: transport.binary === undefined ? operation.binary : Boolean(transport.binary)
  });
}

export function withTarget(target = {}) {
  return (operation) => ({
    ...operation,
    target: {
      ...(operation.target || {}),
      ...target
    }
  });
}

export function withSafety(safety = {}) {
  return (operation) => ({
    ...operation,
    safety: normalizeOperationSafety({
      ...(operation.safety || {}),
      ...safety
    }, operation)
  });
}

export function withRisk(risk, options = {}) {
  return withSafety({ ...options, risk });
}

export function withInputSchema(inputSchema = {}) {
  return (operation) => ({
    ...operation,
    inputSchema: normalizeInputSchema(inputSchema)
  });
}

export function withAudit(audit = {}) {
  return (operation) => ({
    ...operation,
    audit: normalizeAuditPolicy({ ...(operation.audit || {}), ...audit }, operation)
  });
}

export function withConcurrency(concurrency = {}) {
  return (operation) => {
    const concurrencySafe =
      typeof concurrency === "boolean"
        ? concurrency
        : concurrency.concurrencySafe === undefined
          ? operation.concurrencySafe
          : concurrency.concurrencySafe;
    return {
      ...operation,
      concurrencySafe: Boolean(concurrencySafe),
      concurrencyGroup:
        typeof concurrency === "object" && concurrency.group
          ? String(concurrency.group)
          : operation.concurrencyGroup || ""
    };
  };
}

export function defineOperation(definition, ...decorators) {
  return decorators.reduce((operation, decorator) => decorator(operation), { ...definition });
}

function inferOperationRisk(operation) {
  if (operation.readOnly === true) {
    return "read_only";
  }
  if (READ_ONLY_POST_OPERATION_IDS.has(operation.id)) {
    return "read_only";
  }

  const method = String(operation.http?.method || "GET").toUpperCase();
  if (["GET", "HEAD", "OPTIONS"].includes(method)) {
    return "read_only";
  }

  return "safe_write";
}

function normalizeOperationSafety(safety = {}, operation = {}) {
  const inferredRisk = inferOperationRisk(operation);
  const risk = normalizeRisk(safety.risk, inferredRisk);
  const isRepairOrHigher = riskRank(risk) >= riskRank("repair_write");
  const hasExplicitConfirmationMarker =
    Object.prototype.hasOwnProperty.call(safety, "requiresConfirmationExplicit");
  const requiresConfirmationExplicit = hasExplicitConfirmationMarker
    ? safety.requiresConfirmationExplicit === true
    : (
      Object.prototype.hasOwnProperty.call(safety, "requiresConfirmation") &&
      typeof safety.requiresConfirmation === "boolean"
    );
  return {
    risk,
    readOnly: safety.readOnly === undefined ? risk === "read_only" : safety.readOnly === true,
    destructive: safety.destructive === undefined ? risk === "destructive" : safety.destructive === true,
    approvalScope: safety.approvalScope || DEFAULT_REPAIR_APPROVAL_SCOPE,
    requiresConfirmation:
      requiresConfirmationExplicit
        ? safety.requiresConfirmation
        : isRepairOrHigher,
    requiresConfirmationExplicit,
    blocked: safety.blocked === true || risk === "destructive",
    reason: String(safety.reason || ""),
    resolveRisk: typeof safety.resolveRisk === "function" ? safety.resolveRisk : null
  };
}

function normalizeInputSchema(inputSchema = {}) {
  if (!inputSchema || typeof inputSchema !== "object" || Array.isArray(inputSchema)) {
    return {
      type: "object",
      additionalProperties: true
    };
  }
  return {
    type: "object",
    additionalProperties: true,
    ...inputSchema
  };
}

function normalizeAuditPolicy(audit = {}, operation = {}) {
  const method = String(operation.http?.method || "GET").toUpperCase();
  const safety = normalizeOperationSafety(operation.safety || audit.safety || {}, operation);
  const readOnly = safety.readOnly;
  return {
    enabled: audit.enabled === undefined ? true : audit.enabled !== false,
    recordInput: audit.recordInput === undefined ? !readOnly : audit.recordInput !== false,
    recordOutput: audit.recordOutput === true,
    redaction: audit.redaction || "default",
    write: audit.write === undefined ? !["GET", "HEAD", "OPTIONS"].includes(method) : audit.write === true
  };
}

function normalizeLogPolicy(log = {}, operation = {}) {
  const safety = normalizeOperationSafety(operation.safety || {}, operation);
  return {
    enabled: log.enabled === undefined ? true : log.enabled !== false,
    redaction: log.redaction || operation.audit?.redaction || "default",
    recordInput: log.recordInput === undefined ? safety.readOnly !== true : log.recordInput === true,
    recordOutput: log.recordOutput === true
  };
}

function normalizeOperationContract(operation) {
  const safety = normalizeOperationSafety(operation.safety || {}, operation);
  const publicAccess = operation.public === true || PUBLIC_OPERATION_IDS.has(operation.id);
  const externalAuth =
    operation.externalAuth === true ||
    EXTERNAL_AUTH_OPERATION_IDS.has(operation.id);
  return {
    ...operation,
    public: publicAccess,
    externalAuth,
    externalAuthMissingCode:
      operation.externalAuthMissingCode ||
      EXTERNAL_AUTH_MISSING_CODE_DECORATORS.get(operation.id) ||
      "missing_external_auth",
    requiredScopes: Array.isArray(operation.requiredScopes) ? uniqueStrings(operation.requiredScopes) : [],
    safety,
    readOnly: safety.readOnly,
    destructive: safety.destructive,
    concurrencySafe:
      typeof operation.concurrencySafe === "boolean"
        ? operation.concurrencySafe
        : safety.readOnly,
    inputSchema: normalizeInputSchema(operation.inputSchema),
    audit: normalizeAuditPolicy(operation.audit || {}, { ...operation, safety }),
    log: normalizeLogPolicy(operation.log || {}, { ...operation, safety })
  };
}

function validateOperation(operation, seen) {
  if (!operation.id) {
    throw new Error("Operation registration failed: missing id.");
  }
  if (!operation.target?.controller || !operation.target?.method) {
    throw new Error(`Operation registration failed: ${operation.id} missing target.`);
  }
  if (!operation.http?.method || !operation.http?.path) {
    throw new Error(`Operation registration failed: ${operation.id} missing HTTP binding.`);
  }
  if (seen.ids.has(operation.id)) {
    throw new Error(`Operation registration failed: duplicate id ${operation.id}.`);
  }
  seen.ids.add(operation.id);

  const httpKey = `${String(operation.http.method).toUpperCase()} ${operation.http.path}`;
  if (seen.http.has(httpKey)) {
    throw new Error(`Operation registration failed: duplicate HTTP binding ${httpKey}.`);
  }
  seen.http.add(httpKey);

  if (operation.rpc?.method) {
    if (seen.rpc.has(operation.rpc.method)) {
      throw new Error(`Operation registration failed: duplicate RPC method ${operation.rpc.method}.`);
    }
    seen.rpc.add(operation.rpc.method);
  }

  for (const key of ["readOnly", "destructive", "concurrencySafe"]) {
    if (typeof operation[key] !== "boolean") {
      throw new Error(`Operation registration failed: ${operation.id} missing boolean ${key}.`);
    }
  }
  if (!operation.safety?.risk) {
    throw new Error(`Operation registration failed: ${operation.id} missing safety.risk.`);
  }
  if (!Array.isArray(operation.requiredScopes)) {
    throw new Error(`Operation registration failed: ${operation.id} missing requiredScopes.`);
  }
  if (operation.requiredScopes.length === 0 && operation.public !== true && operation.externalAuth !== true) {
    throw new Error(
      `Operation registration failed: ${operation.id} has no requiredScopes and is not explicitly public/externalAuth.`
    );
  }
  if (operation.externalAuth === true) {
    const verifier = operation.externalAuthVerifier;
    const verifierMethod = typeof verifier === "string" ? verifier : verifier?.method;
    if (!verifierMethod || typeof verifierMethod !== "string") {
      throw new Error(`Operation registration failed: ${operation.id} externalAuth missing externalAuthVerifier.method.`);
    }
  }
  if (operation.public === true && operation.externalAuth === true) {
    throw new Error(`Operation registration failed: ${operation.id} cannot be both public and externalAuth.`);
  }
  if (!operation.audit || typeof operation.audit !== "object") {
    throw new Error(`Operation registration failed: ${operation.id} missing audit policy.`);
  }
  if (!operation.inputSchema || typeof operation.inputSchema !== "object") {
    throw new Error(`Operation registration failed: ${operation.id} missing inputSchema.`);
  }
  if (!operation.log || typeof operation.log !== "object" || !operation.log.redaction) {
    throw new Error(`Operation registration failed: ${operation.id} missing log redaction policy.`);
  }
  if (operation.destructive && !operation.safety.blocked) {
    throw new Error(`Operation registration failed: ${operation.id} is destructive but not blocked.`);
  }
  if (!operation.readOnly && operation.audit.enabled === false) {
    throw new Error(`Operation registration failed: ${operation.id} is write-capable but audit is disabled.`);
  }
  if (riskRank(operation.safety.risk) >= riskRank("repair_write") && !operation.safety.approvalScope) {
    throw new Error(`Operation registration failed: ${operation.id} repair operation missing approvalScope.`);
  }
}

function decorateOperation(operation) {
  const scopeDecorator = REQUIRED_SCOPE_DECORATORS.has(operation.id)
    ? withRequiredScopes(REQUIRED_SCOPE_DECORATORS.get(operation.id))
    : (value) => value;
  const safetyDecorator = withSafety(SAFETY_DECORATORS.get(operation.id) || {});
  const concurrencyDecorator = CONCURRENCY_GROUP_DECORATORS.has(operation.id)
    ? withConcurrency({
        concurrencySafe: false,
        group: CONCURRENCY_GROUP_DECORATORS.get(operation.id)
      })
    : (value) => value;

  return defineOperation(
    operation,
    scopeDecorator,
    safetyDecorator,
    concurrencyDecorator,
    normalizeOperationContract,
    decorateKnowledgeCapabilityOperation,
    withAspect(OPERATION_ASPECTS.DISPATCH),
    withAspect(OPERATION_ASPECTS.AUTHORIZATION),
    withAspect(OPERATION_ASPECTS.SAFETY),
    withAspect(OPERATION_ASPECTS.AUDIT)
  );
}

export function decorateServerApiOperations(operations = []) {
  const seen = {
    ids: new Set(),
    http: new Set(),
    rpc: new Set()
  };
  return operations.map((operation) => {
    const decorated = decorateOperation(operation);
    validateOperation(decorated, seen);
    return decorated;
  });
}

function parseJsonObject(value) {
  if (!value) {
    return {};
  }
  if (Buffer.isBuffer(value)) {
    if (value.length === 0) {
      return {};
    }
    return parseJsonObject(value.toString("utf8"));
  }
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) {
      return {};
    }
    try {
      const parsed = JSON.parse(text);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function getSafetyInput(context = {}) {
  return {
    ...parseJsonObject(context.requestBody),
    ...(context.params && typeof context.params === "object" ? context.params : {})
  };
}

function isTruthyFlag(value) {
  return value === true ||
    value === 1 ||
    String(value || "").trim().toLowerCase() === "true" ||
    String(value || "").trim() === "1" ||
    String(value || "").trim().toLowerCase() === "yes";
}

function hasSafetyConfirmation(context = {}) {
  const input = getSafetyInput(context);
  const safetyHeader = String(
    context.request?.headers?.["x-pact-safety-confirm"] ||
    context.request?.headers?.["x-pact-confirm"] ||
    ""
  ).trim();
  // L-3: removed URL query-param confirm path — it appears in access logs and
  // browser history.  Body and header are the only accepted confirmation signals.
  return isTruthyFlag(input.confirm) ||
    isTruthyFlag(input.safetyConfirm) ||
    isTruthyFlag(input.safety?.confirm) ||
    isTruthyFlag(safetyHeader);
}

function hasScope(session, scope) {
  if (!scope) {
    return true;
  }
  return Array.isArray(session?.user?.scopes) && session.user.scopes.includes(scope);
}

export function resolveOperationSafety(operation, context = {}) {
  const base = normalizeOperationSafety(operation.safety || {}, operation);
  const dynamicRisk = base.resolveRisk ? base.resolveRisk(context) : base.risk;
  const risk = maxRisk(base.risk, dynamicRisk);
  return normalizeOperationSafety({
    ...base,
    risk,
    requiresConfirmation:
      base.requiresConfirmationExplicit
        ? base.requiresConfirmation
        : undefined
  }, operation);
}

export function evaluateOperationSafety({
  operation,
  requestBody = Buffer.alloc(0),
  url = null,
  params = {},
  request = null,
  authSession = null,
  authEnabled = false
}) {
  const safety = resolveOperationSafety(operation, { requestBody, url, params });

  if (safety.blocked || safety.risk === "destructive") {
    return {
      ok: false,
      status: 403,
      error: `Operation ${operation.id} is registered as destructive and is blocked by policy.`,
      safety
    };
  }

  if (riskRank(safety.risk) < riskRank("repair_write")) {
    return { ok: true, safety };
  }

  if (!authEnabled) {
    return {
      ok: true,
      safety: {
        ...safety,
        enforcement: "auth_disabled"
      }
    };
  }

  if (!authSession) {
    return {
      ok: false,
      status: 401,
      error: `Operation ${operation.id} requires an authenticated approval session for ${safety.risk}.`,
      safety
    };
  }

  if (!hasScope(authSession, safety.approvalScope)) {
    return {
      ok: false,
      status: 403,
      error: `Operation ${operation.id} requires scope ${safety.approvalScope} for ${safety.risk}.`,
      safety
    };
  }

  if (safety.requiresConfirmation && !hasSafetyConfirmation({ requestBody, url, params, request })) {
    return {
      ok: false,
      status: 428,
      error: `Operation ${operation.id} requires confirm=true for ${safety.risk}.`,
      safety
    };
  }

  return { ok: true, safety };
}

export function serializableOperationSafety(operation) {
  const safety = normalizeOperationSafety(operation.safety || {}, operation);
  return {
    risk: safety.risk,
    readOnly: operation.readOnly === true || safety.readOnly === true,
    destructive: operation.destructive === true || safety.destructive === true,
    concurrencySafe: operation.concurrencySafe === true,
    approvalScope: safety.approvalScope,
    requiresConfirmation: safety.requiresConfirmation,
    blocked: safety.blocked,
    reason: safety.reason,
    dynamicRisk: typeof operation.safety?.resolveRisk === "function",
    knownRisks: MAINTENANCE_AGENT_RISKS
  };
}
