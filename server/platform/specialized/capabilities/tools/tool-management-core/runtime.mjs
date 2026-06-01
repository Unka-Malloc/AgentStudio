import crypto from "node:crypto";
import {
  dispatchOperation,
  getRuntimeLogger,
  summarizeError,
  summarizeForLog,
  traceContextFromRequest
} from "../../../../interactive/product-api.mjs";

function nowIso() {
  return new Date().toISOString();
}

function randomId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(5).toString("hex")}`;
}

function parseJsonObject(value) {
  if (!value) {
    return {};
  }
  if (Buffer.isBuffer(value)) {
    return value.length ? parseJsonObject(value.toString("utf8")) : {};
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

function uniqueStrings(values = []) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function createCapturedResponse() {
  return {
    statusCode: 200,
    headers: {},
    chunks: [],
    writeHead(statusCode, headers = {}) {
      this.statusCode = statusCode;
      this.headers = {
        ...this.headers,
        ...headers
      };
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
    getHeader(name) {
      const lowerName = String(name || "").toLowerCase();
      const entry = Object.entries(this.headers).find(
        ([headerName]) => headerName.toLowerCase() === lowerName
      );
      return entry?.[1];
    },
    write(chunk) {
      if (chunk !== undefined && chunk !== null) {
        this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      }
    },
    end(chunk) {
      this.write(chunk);
      this.ended = true;
    }
  };
}

function capturedBuffer(captured) {
  return Buffer.concat(captured.chunks || []);
}

function parseCapturedJson(captured) {
  const text = capturedBuffer(captured).toString("utf8").trim();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

function sourceIpFromRequest(request) {
  return String(
    request?.headers?.["x-forwarded-for"] ||
      request?.socket?.remoteAddress ||
      request?.connection?.remoteAddress ||
      ""
  ).split(",")[0].trim();
}

function buildDirectOperationRequest({ operation, input = {} }) {
  const explicitBody =
    input.body !== undefined &&
    input.body &&
    typeof input.body === "object" &&
    !Array.isArray(input.body);
  const body = explicitBody ? input.body : input;
  const params = {
    ...(input.params && typeof input.params === "object" && !Array.isArray(input.params) ? input.params : {})
  };
  const pathParamNames = [...String(operation.http?.path || "").matchAll(/:([A-Za-z0-9_]+)/g)].map((match) => match[1]);
  for (const name of pathParamNames) {
    if (params[name] === undefined && input[name] !== undefined) {
      params[name] = input[name];
      continue;
    }
    const paramDefinition = [
      ...(operation.http?.params || []),
      ...(operation.rpc?.params || [])
    ].find((item) => item.name === name);
    const aliasValue = (paramDefinition?.aliases || []).map((alias) => input[alias]).find(
      (item) => item !== undefined && item !== null && item !== ""
    );
    if (params[name] === undefined && aliasValue !== undefined) {
      params[name] = aliasValue;
    }
  }
  let path = operation.http?.path || "/";
  for (const name of pathParamNames) {
    path = path.replace(`:${name}`, encodeURIComponent(String(params[name] || "")));
  }
  const url = new URL(path, "http://127.0.0.1");
  const query = input.query && typeof input.query === "object" && !Array.isArray(input.query)
    ? input.query
    : input;
  for (const queryParam of operation.http?.query || []) {
    const aliases = [queryParam.name, ...(queryParam.aliases || [])];
    const value = aliases.map((alias) => query[alias]).find(
      (item) => item !== undefined && item !== null && item !== ""
    );
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(queryParam.name, String(value));
    }
  }
  const method = String(operation.http?.method || "POST").toUpperCase();
  const requestBody = method === "GET" || method === "HEAD"
    ? Buffer.alloc(0)
    : Buffer.from(JSON.stringify(body && typeof body === "object" ? body : {}), "utf8");
  return { url, requestBody, params };
}

function resultSummaryFromPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return {};
  }
  const result = payload.result !== undefined ? payload.result : payload;
  if (Array.isArray(result)) {
    return { type: "array", length: result.length };
  }
  if (result && typeof result === "object") {
    return { type: "object", keys: Object.keys(result).slice(0, 40) };
  }
  return { value: result };
}

function jsonByteLength(value) {
  try {
    return Buffer.byteLength(JSON.stringify(value ?? null), "utf8");
  } catch {
    return 0;
  }
}

function validateInputSchema(operation, input = {}) {
  const schema = operation.inputSchema || {};
  if ((schema.type || "object") !== "object") {
    return { ok: true };
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {
      ok: false,
      error: `Tool operation ${operation.id} requires object input.`
    };
  }
  for (const key of schema.required || []) {
    if (input[key] === undefined || input[key] === null || input[key] === "") {
      return {
        ok: false,
        error: `Tool operation ${operation.id} missing required input: ${key}.`
      };
    }
  }
  const properties = schema.properties || {};
  for (const [key, property] of Object.entries(properties)) {
    if (input[key] === undefined || input[key] === null || !property?.type) {
      continue;
    }
    const type = property.type;
    const ok =
      type === "array"
        ? Array.isArray(input[key])
        : type === "number" || type === "integer"
          ? typeof input[key] === "number" && Number.isFinite(input[key])
          : type === "boolean"
            ? typeof input[key] === "boolean"
            : type === "object"
              ? typeof input[key] === "object" && !Array.isArray(input[key])
              : typeof input[key] === "string";
    if (!ok) {
      return {
        ok: false,
        error: `Tool operation ${operation.id} input ${key} must be ${type}.`
      };
    }
  }
  return { ok: true };
}

function timeoutError(timeoutMs) {
  const error = new Error(`Tool execution timed out after ${timeoutMs}ms.`);
  error.code = "tool_timeout";
  return error;
}

async function withTimeout(promise, timeoutMs) {
  const normalizedTimeout = Math.max(1, Number(timeoutMs || 30_000));
  let timer = null;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(timeoutError(normalizedTimeout)), normalizedTimeout);
      })
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export function createToolExecutionRuntime({
  registry,
  store,
  policyEngine,
  securityPermissions = null,
  operations = [],
  controllers,
  operationAuditStore = null,
  operationConcurrencyScope = "tool-management",
  protocolEventBus = null,
  logger = getRuntimeLogger()
}) {
  const operationsById = new Map(operations.map((operation) => [operation.id, operation]));
  const toolLocks = new Map();

  function appendAuthorizationDecision(decision = {}) {
    if (!securityPermissions || typeof securityPermissions.appendDecision !== "function") {
      return;
    }
    securityPermissions.appendDecision({
      protocolVersion: "pact.authorization.v1",
      allowed: false,
      effect: "deny",
      evaluatedLayers: ["tool_token_authorization"],
      createdAt: nowIso(),
      ...decision
    });
  }

  function logTool(level, event, details = {}) {
    if (!logger || typeof logger[level] !== "function") {
      return;
    }
    logger[level](event, details);
  }

  async function withToolConcurrency(tool, run) {
    if (tool.concurrencySafe) {
      logTool("debug", "tool_management.concurrency.bypassed", {
        toolId: tool.id,
        reason: "concurrency_safe"
      });
      return run();
    }
    const key = tool.id;
    const previous = toolLocks.get(key) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => {
      release = resolve;
    });
    const chained = previous.catch(() => null).then(() => current);
    toolLocks.set(key, chained);
    try {
      logTool("debug", "tool_management.concurrency.waiting", {
        toolId: tool.id,
        queueDepth: toolLocks.size
      });
      await previous.catch(() => null);
      logTool("debug", "tool_management.concurrency.acquired", {
        toolId: tool.id
      });
      return await run();
    } finally {
      release();
      if (toolLocks.get(key) === chained) {
        toolLocks.delete(key);
      }
      logTool("debug", "tool_management.concurrency.released", {
        toolId: tool.id,
        remainingLocks: toolLocks.size
      });
    }
  }

  async function publishEvent(topic, payload, options = {}) {
    if (!protocolEventBus || typeof protocolEventBus.publish !== "function") {
      return;
    }
    await protocolEventBus.publish(topic, payload, options).catch(() => {});
  }

  async function executeTool({
    toolId,
    input = {},
    request,
    context = {},
    dryRun = false,
    directOperation = null,
    directUrl = null,
  directRequestBody = null,
  directParams = null,
  authorizedGrant = null,
  approvedPendingOperation = null
  } = {}) {
    const requestTrace = traceContextFromRequest(request);
    const traceId = context.traceId || requestTrace?.traceId || randomId("trace");
    const toolExecutionId = randomId("tool_exec");
    const startedAtMs = Date.now();
    const startedAt = nowIso();
    const inputBytes = jsonByteLength(input);
    const tool = registry.getTool(toolId);
    const operation = directOperation || operationsById.get(tool?.operationId || "");
    const profile = context.profileId
      ? registry.listProfiles().find((item) => item.id === context.profileId)
      : null;

    if (!tool || !operation) {
      logTool("warn", "tool_management.execute.denied", {
        traceId,
        toolExecutionId,
        toolId: toolId || "",
        reason: tool ? "operation_missing" : "unknown_tool",
        input: summarizeForLog(input)
      });
      const status = tool ? 500 : 404;
      const reasonCode = tool ? "operation_missing" : "unknown_tool";
      store.appendExecution({
        toolExecutionId,
        traceId,
        toolId: toolId || "",
        status: "denied",
        errorCode: reasonCode,
        decision: "deny",
        input,
        startedAt,
        finishedAt: nowIso()
      });
      store.appendMetric({ traceId, toolId, status: "denied", reasonCode, inputBytes });
      appendAuthorizationDecision({
        decisionId: randomId("authz_decision"),
        traceId,
        toolExecutionId,
        toolId: toolId || "",
        operationId: tool?.operationId || "",
        reasonCode,
        redactedReason: tool ? "Tool operation is not available." : "Tool is not registered.",
        subject: {
          type: "anonymous",
          subjectId: "",
          scopes: []
        },
        resource: {
          toolId: toolId || "",
          operationId: tool?.operationId || "",
          risk: tool?.risk || ""
        }
      });
      return {
        ok: false,
        status,
        payload: {
          schemaVersion: 1,
          traceId,
          error: {
            code: reasonCode,
            message: tool ? "Tool operation is not available." : "Tool is not registered.",
            details: { toolId }
          }
        }
      };
    }

    logTool("info", "tool_management.execute.started", {
      traceId,
      toolExecutionId,
      toolId: tool.id,
      operationId: tool.operationId,
      risk: tool.risk,
      dryRun,
      input: summarizeForLog(input),
      context: summarizeForLog(context)
    });
    await publishEvent("tools.execution", { toolExecutionId, traceId, toolId: tool.id, status: "started" }, { type: "tools.execution.started" });

    const authorization = authorizedGrant
      ? {
          ok: true,
          grant: authorizedGrant,
          sourceIp: approvedPendingOperation?.sourceIp || sourceIpFromRequest(request)
        }
      : await store.authorizeRequest({
          request,
          requiredScopes: tool.requiredScopes,
          tool,
          context
        });
    if (!authorization.ok) {
      const durationMs = Date.now() - startedAtMs;
      logTool("warn", "tool_management.execute.denied", {
        traceId,
        toolExecutionId,
        toolId: tool.id,
        operationId: tool.operationId,
        risk: tool.risk,
        reason: authorization.reasonCode || "authorization_denied",
        durationMs
      });
      const decision = {
        effect: "deny",
        reasonCode: authorization.reasonCode || "authorization_denied",
        decisionId: randomId("policy")
      };
      store.appendPolicyDecision({
        ...decision,
        toolExecutionId,
        traceId,
        toolId: tool.id,
        grantId: authorization.grant?.id || "",
        missingScopes: authorization.missingScopes || []
      });
      appendAuthorizationDecision({
        ...decision,
        traceId,
        toolExecutionId,
        toolId: tool.id,
        operationId: tool.operationId,
        grantId: authorization.grant?.id || "",
        subject: authorization.grant
          ? {
              type: "tool-grant",
              subjectId: authorization.grant.id,
              username: authorization.grant.label || authorization.grant.id,
              scopes: authorization.grant.scopes || [],
              capabilities: authorization.grant.capabilities || []
            }
          : {
              type: "anonymous",
              subjectId: "",
              scopes: [],
              capabilities: []
            },
        resource: {
          toolId: tool.id,
          operationId: tool.operationId,
          risk: tool.risk
        },
        missingScopes: authorization.missingScopes || [],
        missingCapabilities: authorization.missingCapabilities || [],
        redactedReason: authorization.error || "Tool token authorization denied."
      });
      store.appendExecution({
        toolExecutionId,
        traceId,
        toolId: tool.id,
        toolVersion: tool.version,
        toolsetIds: tool.toolsets,
        subjectType: "grant",
        subjectId: authorization.grant?.id || "",
        grantId: authorization.grant?.id || "",
        agentId: context.agentId || "",
        profileId: context.profileId || "",
        operationId: tool.operationId,
        risk: tool.risk,
        decision: "deny",
        input,
        status: "denied",
        errorCode: decision.reasonCode,
        durationMs,
        policyDecisionId: decision.decisionId,
        sourceIp: sourceIpFromRequest(request),
        userAgent: request?.headers?.["user-agent"] || "",
        startedAt,
        finishedAt: nowIso()
      });
      store.appendMetric({
        traceId,
        toolId: tool.id,
        grantId: authorization.grant?.id || "",
        profileId: context.profileId || "",
        status: "denied",
        risk: tool.risk,
        durationMs,
        inputBytes,
        reasonCode: decision.reasonCode
      });
      await publishEvent("tools.execution", { toolExecutionId, traceId, toolId: tool.id, status: "denied" }, { type: "tools.execution.denied" });
      return {
        ok: false,
        status: authorization.status || 403,
        payload: {
          schemaVersion: 1,
          traceId,
          error: {
            code: decision.reasonCode,
            message: authorization.error || "Tool call denied.",
            details: {
              missingScopes: authorization.missingScopes || [],
              missingCapabilities: authorization.missingCapabilities || []
            }
          }
        }
      };
    }

    const policy = policyEngine.evaluate({
      tool,
      grant: authorization.grant,
      profile,
      input,
      request,
      context,
      dryRun,
      traceId,
      toolExecutionId
    });

    const approvalAlreadyGranted = approvedPendingOperation ||
      context.approval?.approved === true ||
      context.pendingOperationApproved === true;
    const pendingApprovalRequested = String(context.transport || "").toLowerCase() === "mcp" ||
      context.requirePendingOperation === true ||
      context.pendingApprovalRequired === true;
    if (
      !dryRun &&
      policy.effect !== "dry_run_only" &&
      ["allow", "require_confirmation"].includes(policy.effect) &&
      tool.requiresApproval === true &&
      pendingApprovalRequested &&
      !approvalAlreadyGranted
    ) {
      const durationMs = Date.now() - startedAtMs;
      const pendingOperation = store.createPendingOperation({
        traceId,
        toolExecutionId,
        toolId: tool.id,
        toolVersion: tool.version,
        toolsetIds: tool.toolsets,
        operationId: tool.operationId,
        risk: tool.risk,
        approvalScope: tool.approvalScope || operation.safety?.approvalScope || "",
        grantId: authorization.grant.id,
        agentId: context.agentId || context.agentProfileId || "",
        profileId: context.profileId || context.agentProfileId || "",
        idempotencyKey: context.idempotencyKey || "",
        reasonCode: "tool_approval_required",
        riskReason: `Tool ${tool.id} requires approval before execution.`,
        originalInput: input,
        context,
        sourceIp: authorization.sourceIp || sourceIpFromRequest(request),
        userAgent: request?.headers?.["user-agent"] || "",
        expiresAt: context.expiresAt || context.approvalExpiresAt || ""
      });
      store.appendExecution({
        toolExecutionId,
        traceId,
        toolId: tool.id,
        toolVersion: tool.version,
        toolsetIds: tool.toolsets,
        subjectType: "grant",
        subjectId: authorization.grant.id,
        grantId: authorization.grant.id,
        agentId: context.agentId || "",
        profileId: context.profileId || "",
        operationId: tool.operationId,
        risk: tool.risk,
        decision: policy.effect,
        input,
        resultSummary: {
          type: "pending_operation",
          pendingOperationId: pendingOperation.pendingOperationId,
          status: pendingOperation.status
        },
        status: "pending_approval",
        errorCode: "tool_approval_required",
        durationMs,
        policyDecisionId: policy.decisionId,
        approvalId: pendingOperation.pendingOperationId,
        sourceIp: authorization.sourceIp || sourceIpFromRequest(request),
        userAgent: request?.headers?.["user-agent"] || "",
        startedAt,
        finishedAt: nowIso()
      });
      store.appendMetric({
        traceId,
        toolId: tool.id,
        grantId: authorization.grant.id,
        profileId: context.profileId || "",
        status: "pending_approval",
        risk: tool.risk,
        durationMs,
        inputBytes,
        resultBytes: jsonByteLength(pendingOperation),
        reasonCode: "tool_approval_required"
      });
      await publishEvent("tools.pending_operation", {
        pendingOperationId: pendingOperation.pendingOperationId,
        traceId,
        toolExecutionId,
        toolId: tool.id,
        operationId: tool.operationId,
        risk: tool.risk,
        status: "pending"
      }, { type: "tools.pending_operation.created" });
      return {
        ok: true,
        status: 202,
        payload: {
          schemaVersion: 1,
          toolExecutionId,
          traceId,
          toolId: tool.id,
          status: "pending_approval",
          pendingOperation,
          policy: {
            decisionId: policy.decisionId
          }
        }
      };
    }

    if (!["allow", "dry_run_only"].includes(policy.effect)) {
      const durationMs = Date.now() - startedAtMs;
      logTool("warn", "tool_management.execute.denied", {
        traceId,
        toolExecutionId,
        toolId: tool.id,
        operationId: tool.operationId,
        risk: tool.risk,
        reason: policy.reasonCode,
        decisionId: policy.decisionId,
        durationMs
      });
      store.appendExecution({
        toolExecutionId,
        traceId,
        toolId: tool.id,
        toolVersion: tool.version,
        toolsetIds: tool.toolsets,
        subjectType: "grant",
        subjectId: authorization.grant.id,
        grantId: authorization.grant.id,
        agentId: context.agentId || "",
        profileId: context.profileId || "",
        operationId: tool.operationId,
        risk: tool.risk,
        decision: policy.effect,
        input,
        status: "denied",
        errorCode: policy.reasonCode,
        durationMs,
        policyDecisionId: policy.decisionId,
        sourceIp: authorization.sourceIp || sourceIpFromRequest(request),
        userAgent: request?.headers?.["user-agent"] || "",
        startedAt,
        finishedAt: nowIso()
      });
      store.appendMetric({
        traceId,
        toolId: tool.id,
        grantId: authorization.grant.id,
        profileId: context.profileId || "",
        status: "denied",
        risk: tool.risk,
        durationMs,
        inputBytes,
        reasonCode: policy.reasonCode
      });
      await publishEvent("tools.execution", { toolExecutionId, traceId, toolId: tool.id, status: "denied" }, { type: "tools.execution.denied" });
      return {
        ok: false,
        status: policy.effect === "require_confirmation" ? 409 : 403,
        payload: {
          schemaVersion: 1,
          traceId,
          error: {
            code: policy.reasonCode,
            message: policy.redactedReason,
            details: {
              decisionId: policy.decisionId,
              missingScopes: policy.missingScopes,
              missingCapabilities: policy.missingCapabilities,
              missingToolsets: policy.missingToolsets
            }
          }
        }
      };
    }

    if (dryRun || policy.effect === "dry_run_only") {
      const durationMs = Date.now() - startedAtMs;
      const result = {
        wouldExecute: true,
        tool: {
          id: tool.id,
          operationId: tool.operationId,
          risk: tool.risk,
          requiredScopes: tool.requiredScopes,
          toolsets: tool.toolsets
        },
        policy
      };
      store.appendExecution({
        toolExecutionId,
        traceId,
        toolId: tool.id,
        toolVersion: tool.version,
        toolsetIds: tool.toolsets,
        subjectType: "grant",
        subjectId: authorization.grant.id,
        grantId: authorization.grant.id,
        agentId: context.agentId || "",
        profileId: context.profileId || "",
        operationId: tool.operationId,
        risk: tool.risk,
        decision: policy.effect,
        input,
        result,
        status: "ok",
        durationMs,
        policyDecisionId: policy.decisionId,
        sourceIp: authorization.sourceIp || sourceIpFromRequest(request),
        userAgent: request?.headers?.["user-agent"] || "",
        startedAt,
        finishedAt: nowIso()
      });
      store.appendMetric({ traceId, toolId: tool.id, grantId: authorization.grant.id, profileId: context.profileId || "", status: "ok", risk: tool.risk, durationMs, inputBytes, resultBytes: jsonByteLength(result) });
      logTool("info", "tool_management.execute.dry_run_completed", {
        traceId,
        toolExecutionId,
        toolId: tool.id,
        operationId: tool.operationId,
        risk: tool.risk,
        decisionId: policy.decisionId,
        durationMs
      });
      return {
        ok: true,
        status: 200,
        payload: {
          schemaVersion: 1,
          toolExecutionId,
          traceId,
          toolId: tool.id,
          status: "ok",
          result,
          grant: authorization.grant,
          policy: {
            decisionId: policy.decisionId
          }
        }
      };
    }

      const captured = createCapturedResponse();
      const directRequest = directOperation
        ? { url: directUrl, requestBody: directRequestBody, params: directParams || {} }
        : buildDirectOperationRequest({ operation, input });
      const operationInput = {
        ...parseJsonObject(directRequest.requestBody),
        ...(directRequest.params || {})
      };
      const schemaValidation = validateInputSchema(operation, operationInput);
      if (!schemaValidation.ok) {
      const durationMs = Date.now() - startedAtMs;
      logTool("warn", "tool_management.execute.denied", {
        traceId,
        toolExecutionId,
        toolId: tool.id,
        operationId: tool.operationId,
        risk: tool.risk,
        reason: "invalid_input",
        error: schemaValidation.error,
        durationMs
      });
      store.appendExecution({
        toolExecutionId,
        traceId,
        toolId: tool.id,
        toolVersion: tool.version,
        toolsetIds: tool.toolsets,
        subjectType: "grant",
        subjectId: authorization.grant.id,
        grantId: authorization.grant.id,
        agentId: context.agentId || "",
        profileId: context.profileId || "",
        operationId: tool.operationId,
        risk: tool.risk,
        decision: policy.effect,
        input,
        status: "denied",
        errorCode: "invalid_input",
        durationMs,
        policyDecisionId: policy.decisionId,
        sourceIp: authorization.sourceIp || sourceIpFromRequest(request),
        userAgent: request?.headers?.["user-agent"] || "",
        startedAt,
        finishedAt: nowIso()
      });
      store.appendMetric({
        traceId,
        toolId: tool.id,
        grantId: authorization.grant.id,
        profileId: context.profileId || "",
        status: "denied",
        risk: tool.risk,
        durationMs,
        inputBytes,
        reasonCode: "invalid_input"
      });
      await publishEvent("tools.execution", { toolExecutionId, traceId, toolId: tool.id, status: "denied" }, { type: "tools.execution.denied" });
      return {
        ok: false,
        status: 400,
        payload: {
          schemaVersion: 1,
          traceId,
          error: {
            code: "invalid_input",
            message: schemaValidation.error,
            details: {
              toolExecutionId,
              decisionId: policy.decisionId
            }
          }
        }
      };
    }

    const previousAuthorization = request.__pactToolRuntimeAuthorization;
    request.__pactToolRuntimeAuthorization = {
      ok: true,
      grant: authorization.grant,
      toolExecutionId,
      traceId,
      requiredScopes: tool.requiredScopes
    };
    try {
      const approvalScopes = tool.requiresApproval
        ? [operation.safety?.approvalScope || tool.approvalScope || ""]
        : [];
      const toolActor = {
        type: "tool-grant",
        userId: authorization.grant.id,
        username: authorization.grant.label || authorization.grant.id,
        roleId: "tool-grant",
        scopes: uniqueStrings([
          ...(authorization.grant.scopes || []),
          ...(tool.requiredScopes || []),
          ...(operation.requiredScopes || []),
          ...approvalScopes
        ])
      };
      await withToolConcurrency(tool, () =>
        withTimeout(
          dispatchOperation({
            operation,
            controllers,
            request,
            response: captured,
            requestBody: directRequest.requestBody,
            url: directRequest.url,
            params: directRequest.params,
            input: operationInput,
            transport: "tool-management",
            method: operation.http?.method || "POST",
            authorizeOperation: null,
            operationAuditStore,
            concurrencyScope: operationConcurrencyScope,
            logger,
            authSession: { user: toolActor },
            actor: toolActor,
            skipAuthorization: true
          }),
          tool.timeoutMs
        )
      );
      const buffer = capturedBuffer(captured);
      const statusCode = captured.statusCode || 200;
      const payload = parseCapturedJson(captured);
      const durationMs = Date.now() - startedAtMs;
      if (buffer.length > Number(tool.maxResultBytes || 0)) {
        logTool("error", "tool_management.execute.failed", {
          traceId,
          toolExecutionId,
          toolId: tool.id,
          operationId: tool.operationId,
          risk: tool.risk,
          reason: "result_too_large",
          resultBytes: buffer.length,
          maxResultBytes: tool.maxResultBytes,
          durationMs
        });
        store.appendExecution({
          toolExecutionId,
          traceId,
          toolId: tool.id,
          toolVersion: tool.version,
          toolsetIds: tool.toolsets,
          subjectType: "grant",
          subjectId: authorization.grant.id,
          grantId: authorization.grant.id,
          agentId: context.agentId || "",
          profileId: context.profileId || "",
          operationId: tool.operationId,
          risk: tool.risk,
          decision: policy.effect,
          input,
          resultSummary: { type: "oversize", byteLength: buffer.length, maxResultBytes: tool.maxResultBytes },
          status: "failed",
          errorCode: "result_too_large",
          durationMs,
          policyDecisionId: policy.decisionId,
          sourceIp: authorization.sourceIp || sourceIpFromRequest(request),
          userAgent: request?.headers?.["user-agent"] || "",
          startedAt,
          finishedAt: nowIso()
        });
        store.appendMetric({
          traceId,
          toolId: tool.id,
          grantId: authorization.grant.id,
          profileId: context.profileId || "",
          status: "failed",
          risk: tool.risk,
          durationMs,
          inputBytes,
          resultBytes: buffer.length,
          reasonCode: "result_too_large"
        });
        await publishEvent("tools.execution", { toolExecutionId, traceId, toolId: tool.id, status: "failed" }, { type: "tools.execution.failed" });
        return {
          ok: false,
          status: 413,
          payload: {
            schemaVersion: 1,
            traceId,
            error: {
              code: "result_too_large",
              message: "Tool result exceeds the configured result size limit.",
              details: {
                toolExecutionId,
                byteLength: buffer.length,
                maxResultBytes: tool.maxResultBytes
              }
            }
          }
        };
      }
      const status = statusCode >= 400 ? "failed" : "ok";
      logTool(status === "ok" ? "info" : "error", status === "ok" ? "tool_management.execute.completed" : "tool_management.execute.failed", {
        traceId,
        toolExecutionId,
        toolId: tool.id,
        operationId: tool.operationId,
        risk: tool.risk,
        status,
        statusCode,
        resultBytes: buffer.length,
        durationMs
      });
      store.appendExecution({
        toolExecutionId,
        traceId,
        toolId: tool.id,
        toolVersion: tool.version,
        toolsetIds: tool.toolsets,
        subjectType: "grant",
        subjectId: authorization.grant.id,
        grantId: authorization.grant.id,
        agentId: context.agentId || "",
        profileId: context.profileId || "",
        operationId: tool.operationId,
        risk: tool.risk,
        decision: policy.effect,
        input,
        result: payload,
        resultSummary: tool.transport?.binary ? { type: "binary", byteLength: buffer.length } : resultSummaryFromPayload(payload),
        status,
        errorCode: status === "ok" ? "" : "tool_handler_failed",
        durationMs,
        policyDecisionId: policy.decisionId,
        sourceIp: authorization.sourceIp || sourceIpFromRequest(request),
        userAgent: request?.headers?.["user-agent"] || "",
        startedAt,
        finishedAt: nowIso()
      });
      store.appendMetric({
        traceId,
        toolId: tool.id,
        grantId: authorization.grant.id,
        profileId: context.profileId || "",
        status,
        risk: tool.risk,
        durationMs,
        inputBytes,
        resultBytes: buffer.length,
        reasonCode: status === "ok" ? "" : "tool_handler_failed"
      });
      await publishEvent("tools.execution", { toolExecutionId, traceId, toolId: tool.id, status }, { type: status === "ok" ? "tools.execution.completed" : "tools.execution.failed" });
      return {
        ok: status === "ok",
        status: statusCode,
        captured,
        payload: {
          schemaVersion: 1,
          toolExecutionId,
          traceId,
          toolId: tool.id,
          status,
          result: payload?.result !== undefined ? payload.result : payload,
          grant: authorization.grant,
          policy: {
            decisionId: policy.decisionId
          }
        }
      };
    } catch (error) {
      const durationMs = Date.now() - startedAtMs;
      const message = error instanceof Error ? error.message : "Tool execution failed.";
      const errorCode = error?.code === "tool_timeout" ? "tool_timeout" : "tool_execution_failed";
      logTool("error", "tool_management.execute.failed", {
        traceId,
        toolExecutionId,
        toolId: tool.id,
        operationId: tool.operationId,
        risk: tool.risk,
        reason: errorCode,
        durationMs,
        error: summarizeError(error)
      });
      store.appendExecution({
        toolExecutionId,
        traceId,
        toolId: tool.id,
        toolVersion: tool.version,
        toolsetIds: tool.toolsets,
        subjectType: "grant",
        subjectId: authorization.grant.id,
        grantId: authorization.grant.id,
        agentId: context.agentId || "",
        profileId: context.profileId || "",
        operationId: tool.operationId,
        risk: tool.risk,
        decision: policy.effect,
        input,
        status: "failed",
        errorCode,
        durationMs,
        policyDecisionId: policy.decisionId,
        sourceIp: authorization.sourceIp || sourceIpFromRequest(request),
        userAgent: request?.headers?.["user-agent"] || "",
        startedAt,
        finishedAt: nowIso()
      });
      store.appendMetric({
        traceId,
        toolId: tool.id,
        grantId: authorization.grant.id,
        profileId: context.profileId || "",
        status: "failed",
        risk: tool.risk,
        durationMs,
        inputBytes,
        reasonCode: errorCode
      });
      await publishEvent("tools.execution", { toolExecutionId, traceId, toolId: tool.id, status: "failed" }, { type: "tools.execution.failed" });
      return {
        ok: false,
        status: 500,
        payload: {
          schemaVersion: 1,
          traceId,
          error: {
            code: errorCode,
            message,
            details: {
              toolExecutionId,
              decisionId: policy.decisionId
            }
          }
        }
      };
    } finally {
      request.__pactToolRuntimeAuthorization = previousAuthorization;
    }
  }

  async function resumePendingOperation({
    pendingOperationId,
    resolution = "approved",
    request,
    context = {},
    resolvedBy = "",
    reason = ""
  } = {}) {
    const pending = store.getPendingOperation?.(pendingOperationId, { includeOriginalInput: true });
    if (!pending) {
      return {
        ok: false,
        status: 404,
        payload: {
          schemaVersion: 1,
          error: {
            code: "pending_operation_not_found",
            message: "Pending operation was not found."
          }
        }
      };
    }
    if (pending.status !== "pending") {
      return {
        ok: false,
        status: 409,
        payload: {
          schemaVersion: 1,
          pendingOperation: pending,
          error: {
            code: "pending_operation_not_pending",
            message: "Pending operation is not awaiting approval."
          }
        }
      };
    }
    if (resolution === "rejected") {
      const rejected = store.resolvePendingOperation({
        pendingOperationId: pending.pendingOperationId,
        resolution: "rejected",
        resolvedBy,
        reason,
        errorCode: "pending_operation_rejected",
        resultSummary: { type: "approval_decision", resolution: "rejected" }
      });
      store.appendMetric({
        traceId: pending.traceId,
        toolId: pending.toolId,
        grantId: pending.grantId,
        profileId: pending.profileId,
        status: "rejected",
        risk: pending.risk,
        reasonCode: "pending_operation_rejected"
      });
      await publishEvent("tools.pending_operation", {
        pendingOperationId: pending.pendingOperationId,
        traceId: pending.traceId,
        toolId: pending.toolId,
        status: "rejected"
      }, { type: "tools.pending_operation.rejected" });
      return {
        ok: true,
        status: 200,
        payload: {
          schemaVersion: 1,
          status: "rejected",
          pendingOperation: rejected
        }
      };
    }
    if (resolution !== "approved") {
      return {
        ok: false,
        status: 400,
        payload: {
          schemaVersion: 1,
          error: {
            code: "invalid_pending_operation_resolution",
            message: "Pending operation resolution must be approved or rejected."
          }
        }
      };
    }
    const approved = store.resolvePendingOperation({
      pendingOperationId: pending.pendingOperationId,
      resolution: "approved",
      resolvedBy,
      reason,
      resultSummary: { type: "approval_decision", resolution: "approved" }
    });
    const grant = store.getRawGrant?.(pending.grantId);
    if (!grant || grant.enabled === false || grant.revokedAt) {
      const failed = store.resolvePendingOperation({
        pendingOperationId: pending.pendingOperationId,
        resolution: "failed",
        resolvedBy,
        reason,
        errorCode: "pending_operation_grant_unavailable",
        resultSummary: { type: "approval_resume_failed", reason: "grant_unavailable" }
      });
      return {
        ok: false,
        status: 409,
        payload: {
          schemaVersion: 1,
          status: "failed",
          pendingOperation: failed,
          error: {
            code: "pending_operation_grant_unavailable",
            message: "Original tool grant is no longer available."
          }
        }
      };
    }
    await publishEvent("tools.pending_operation", {
      pendingOperationId: pending.pendingOperationId,
      traceId: pending.traceId,
      toolId: pending.toolId,
      status: "approved"
    }, { type: "tools.pending_operation.approved" });
    const result = await executeTool({
      toolId: pending.toolId,
      input: pending.originalInput || {},
      request,
      context: {
        ...pending.context,
        ...context,
        traceId: pending.traceId,
        approval: {
          approved: true,
          pendingOperationId: pending.pendingOperationId,
          resolvedBy,
          resolvedAt: approved?.resolvedAt || nowIso()
        },
        pendingOperationApproved: true
      },
      authorizedGrant: grant,
      approvedPendingOperation: approved || pending
    });
    const finalStatus = result.ok ? "completed" : "failed";
    const completed = store.resolvePendingOperation({
      pendingOperationId: pending.pendingOperationId,
      resolution: finalStatus,
      resolvedBy,
      reason,
      errorCode: result.ok ? "" : result.payload?.error?.code || "pending_operation_resume_failed",
      resumedToolExecutionId: result.payload?.toolExecutionId || "",
      resultSummary: resultSummaryFromPayload(result.payload || {})
    });
    await publishEvent("tools.pending_operation", {
      pendingOperationId: pending.pendingOperationId,
      traceId: pending.traceId,
      toolId: pending.toolId,
      status: finalStatus,
      resumedToolExecutionId: result.payload?.toolExecutionId || ""
    }, { type: result.ok ? "tools.pending_operation.completed" : "tools.pending_operation.failed" });
    return {
      ...result,
      payload: {
        ...(result.payload || {}),
        pendingOperation: completed
      }
    };
  }

  return {
    executeTool,
    resumePendingOperation
  };
}
