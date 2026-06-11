import { sendJson } from "../console/http/http-utils.mjs";
import { evaluateOperationSafety } from "./operation-decorators.mjs";
import { SERVER_API_OPERATIONS } from "./operation-registry.mjs";
import { createAuthorizationEngine } from "../security/authorization/authorization-engine.mjs";
import {
  getRuntimeLogger,
  summarizeError,
  summarizeForLog
} from "../observability/runtime-logger.mjs";
import {
  childTraceContext,
  getTraceContext,
  runWithTraceContext,
  setTraceContextOnRequest,
  traceContextFromRequest,
  traceDetails
} from "../observability/trace-context.mjs";

const operationLocks = new Map();
const dispatcherAuthorizationEngine = createAuthorizationEngine();

const LOCAL_FORWARD_PREFIXES = [
  "/api/jobs",
  "/api/oauth/",
  "/api/rpc",
  "/api/tool-management",
  "/api/upload-sessions"
];

function splitPath(value) {
  return String(value || "")
    .split("/")
    .filter(Boolean);
}

function matchPath(pattern, pathname) {
  const patternParts = splitPath(pattern);
  const pathParts = splitPath(pathname);
  if (patternParts.length !== pathParts.length) {
    return null;
  }

  const params = {};
  for (let index = 0; index < patternParts.length; index += 1) {
    const patternPart = patternParts[index];
    const pathPart = pathParts[index];
    if (patternPart.startsWith(":")) {
      params[patternPart.slice(1)] = decodeURIComponent(pathPart);
      continue;
    }
    if (patternPart !== pathPart) {
      return null;
    }
  }
  return params;
}

function coerceValue(value, type) {
  if (type === "number") {
    return Number(value || 0);
  }
  if (type === "boolean") {
    return value === true || value === "1" || value === "true" || value === "yes";
  }
  return value;
}

function applyQueryParams(operation, url, params) {
  for (const queryParam of operation.http.query || []) {
    const rawValue = url.searchParams.get(queryParam.name);
    if (rawValue === null || rawValue === "") {
      continue;
    }
    params[queryParam.name] = rawValue;
  }
}

function applyCoercion(operation, params) {
  for (const [key, type] of Object.entries(operation.http.coerce || {})) {
    if (params[key] !== undefined) {
      params[key] = coerceValue(params[key], type);
    }
  }
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

function inputFromRequest({ operation, requestBody, url, params = {}, applyHttpQuery = true }) {
  const input = {
    ...parseJsonObject(requestBody),
    ...(params && typeof params === "object" ? params : {})
  };
  if (applyHttpQuery) {
    for (const queryParam of operation.http?.query || operation.rpc?.query || []) {
      const rawValue = url?.searchParams?.get(queryParam.name);
      if (rawValue !== null && rawValue !== undefined && rawValue !== "") {
        input[queryParam.name] = rawValue;
      }
    }
  }
  return input;
}

function validateInputSchema(operation, input = {}) {
  const schema = operation.inputSchema || {};
  if ((schema.type || "object") !== "object") {
    return { ok: true };
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {
      ok: false,
      status: 400,
      error: `Operation ${operation.id} requires object input.`
    };
  }
  for (const key of schema.required || []) {
    if (input[key] === undefined || input[key] === null || input[key] === "") {
      return {
        ok: false,
        status: 400,
        error: `Operation ${operation.id} missing required input: ${key}.`
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
        status: 400,
        error: `Operation ${operation.id} input ${key} must be ${type}.`
      };
    }
  }
  return { ok: true };
}

function actorFromAuthSession(authSession) {
  return authSession?.user
    ? { type: "console-user", user: authSession.user }
    : { type: "anonymous" };
}

function actorFromInput({ actor = null, authSession = null } = {}) {
  if (actor) {
    return actor;
  }
  return actorFromAuthSession(authSession);
}

function requestIdFromRequest(request) {
  return request?.__pactTraceContext?.requestId || request?.__pactRequestId || "";
}

function operationEventName(transport, suffix) {
  return `operation.${transport || "internal"}.${suffix}`;
}

function sendOperationDenied(response, status, payload) {
  if (response?.headersSent || response?.ended) {
    return;
  }
  sendJson(response, status, payload);
}

function logOperation(logger, level, event, details = {}) {
  if (!logger || typeof logger[level] !== "function") {
    return;
  }
  logger[level](event, details);
}

function notifyNarrowTransition(request, event, toStatus) {
  if (typeof request?.onNarrowTransition === "function") {
    request.onNarrowTransition(event, toStatus);
  }
}

function notifySideEffectStart(request) {
  if (typeof request?.onSideEffectStart === "function") {
    request.onSideEffectStart();
  }
}

function auditOperation({
  operationAuditStore,
  operation,
  transport,
  authSession = null,
  actor = null,
  input = {},
  status,
  startedAt,
  output = undefined,
  error = ""
}) {
  if (!operationAuditStore || operation.audit?.enabled === false) {
    return null;
  }
  const trace = traceDetails(getTraceContext());
  return operationAuditStore.append({
    operationId: operation.id,
    transport,
    traceId: trace.traceId,
    requestId: trace.requestId,
    actor: actorFromInput({ actor, authSession }),
    risk: operation.safety?.risk || "",
    readOnly: operation.readOnly === true,
    status,
    durationMs: startedAt ? Date.now() - startedAt : 0,
    input: operation.audit?.recordInput === false ? {} : input,
    output: operation.audit?.recordOutput === true ? output : undefined,
    error
  });
}

async function withOperationConcurrency(operation, run, concurrencyScope = "default") {
  if (operation.concurrencySafe) {
    return run();
  }
  const key = `${concurrencyScope}:${operation.concurrencyGroup || operation.id}`;
  const previous = operationLocks.get(key) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => {
    release = resolve;
  });
  const chained = previous.catch(() => null).then(() => current);
  operationLocks.set(key, chained);
  try {
    await previous.catch(() => null);
    return await run();
  } finally {
    release();
    if (operationLocks.get(key) === chained) {
      operationLocks.delete(key);
    }
  }
}

export function findHttpOperation({
  operations = SERVER_API_OPERATIONS,
  method,
  pathname
}) {
  const normalizedMethod = String(method || "GET").toUpperCase();
  for (const operation of operations) {
    if (operation.http.method !== normalizedMethod) {
      continue;
    }
    const pathParams = matchPath(operation.http.path, pathname);
    if (pathParams) {
      return { operation, pathParams };
    }
  }
  return null;
}

export function findRpcOperation({
  operations = SERVER_API_OPERATIONS,
  method
}) {
  const normalizedMethod = String(method || "").trim();
  return operations.find((operation) => operation.rpc?.method === normalizedMethod) || null;
}

export function shouldProxyRegisteredApiRequest({
  pathname,
  discoveryState,
  operations = SERVER_API_OPERATIONS
}) {
  if (!discoveryState || discoveryState.mode !== "forward") {
    return false;
  }

  if (!pathname.startsWith("/api/")) {
    return false;
  }

  if (LOCAL_FORWARD_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return false;
  }

  const operation = operations.find((item) => matchPath(item.http.path, pathname));
  if (operation?.http.localInForwardMode) {
    return false;
  }

  const targetBaseUrl = String(
    discoveryState.forwardBaseUrl || discoveryState.activeServiceUrl || ""
  ).trim().replace(/\/+$/, "");
  return Boolean(targetBaseUrl && targetBaseUrl !== discoveryState.advertisedBaseUrl);
}

async function invokeRegisteredOperation({
  operation,
  controllers,
  request,
  response,
  requestBody = Buffer.alloc(0),
  url,
  params = {},
  applyHttpQuery = true,
  authSession = null
}) {
  const controller = controllers[operation.target.controller];
  const handler = controller?.[operation.target.method];
  if (!handler) {
    throw new Error(`接口目标不存在：${operation.target.controller}.${operation.target.method}`);
  }

  const callParams = {
    operation,
    request,
    response,
    requestBody,
    url,
    authSession,
    params,
    ...params
  };
  if (applyHttpQuery) {
    applyQueryParams(operation, url, callParams);
  }
  applyCoercion(operation, callParams);
  await handler(callParams);
}

export async function dispatchOperation({
  operation,
  controllers,
  request,
  response,
  requestBody = Buffer.alloc(0),
  url = new URL("/", "http://127.0.0.1"),
  params = {},
  input = null,
  transport = "internal",
  method = operation?.http?.method || "POST",
  applyHttpQuery = true,
  authorizeOperation = null,
  operationAuditStore = null,
  concurrencyScope = "default",
  logger = getRuntimeLogger(),
  authSession: providedAuthSession = null,
  actor: providedActor = null,
  skipAuthorization = false
} = {}) {
  if (!operation) {
    throw new Error("dispatchOperation requires an operation.");
  }
  const parentTrace = traceContextFromRequest(request) || getTraceContext();
  const actor = actorFromInput({ actor: providedActor, authSession: providedAuthSession });
  const traceContext = childTraceContext({
    parent: parentTrace,
    transport,
    operationId: operation.id,
    actor
  });
  setTraceContextOnRequest(request, traceContext);

  return runWithTraceContext(traceContext, async () => {
    const operationInput = input || inputFromRequest({
      operation,
      requestBody,
      url,
      params,
      applyHttpQuery
    });
    const startedAt = Date.now();
    notifyNarrowTransition(request, "operation.normalize", "normalized");

    logOperation(logger, "debug", operationEventName(transport, "matched"), {
      requestId: requestIdFromRequest(request),
      operationId: operation.id,
      method,
      route: url?.pathname || "",
      transport,
      risk: operation.safety?.risk || "",
      readOnly: operation.readOnly === true,
      requestBodyBytes: requestBody?.length || 0,
      logRedaction: operation.log?.redaction || "default",
      input: operation.log?.recordInput === false
        ? { redacted: true, reason: "operation-log-policy" }
        : summarizeForLog(operationInput, { maxDepth: 4, maxArrayItems: 8, maxObjectKeys: 50 })
    });

    const schema = validateInputSchema(operation, operationInput);
    if (!schema.ok) {
      auditOperation({
        operationAuditStore,
        operation,
        transport,
        actor,
        input: operationInput,
        status: "denied",
        error: schema.error
      });
      logOperation(logger, "warn", operationEventName(transport, "denied"), {
        requestId: requestIdFromRequest(request),
        operationId: operation.id,
        reason: "schema",
        error: schema.error,
        status: schema.status || 400
      });
      sendOperationDenied(response, schema.status || 400, {
        error: schema.error,
        operationId: operation.id,
        traceId: traceContext.traceId
      });
      notifyNarrowTransition(request, "operation.policy_deny", "policy_denied");
      return {
        ok: false,
        handled: true,
        statusCode: schema.status || 400,
        operation,
        input: operationInput,
        traceContext
      };
    }

    let authSession = providedAuthSession;
    const authEnabled = true;
    const shouldRunConsoleAuthorization =
      !skipAuthorization && operation.externalAuth !== true && typeof authorizeOperation === "function";

    // M-1: for externalAuth operations, require at least one credential header
    // at the framework level, so that completely unauthenticated callers are
    // rejected even if an individual handler forgets to validate its token.
    if (!skipAuthorization && operation.externalAuth === true) {
      const hasCredential = Boolean(
        request?.headers?.["authorization"] ||
        request?.headers?.["x-pact-tool-token"]
      );
      if (!hasCredential) {
        const errorCode = operation.externalAuthMissingCode || "missing_external_auth";
        sendOperationDenied(response, 401, {
          schemaVersion: 1,
          error: {
            code: errorCode,
            message: "External authentication requires Authorization or x-pact-tool-token."
          },
          traceId: traceContext.traceId
        });
        notifyNarrowTransition(request, "operation.policy_deny", "policy_denied");
        return { ok: false, handled: true, statusCode: 401, operation, input: operationInput, traceContext };
      }
    }

    if (shouldRunConsoleAuthorization) {
      const authorization = await authorizeOperation({
        request,
        operation,
        method,
        url
      });
      if (!authorization.ok) {
        auditOperation({
          operationAuditStore,
          operation,
          transport,
          authSession: authorization.session || null,
          actor,
          input: operationInput,
          status: "denied",
          error: authorization.error || "authorization denied"
        });
        logOperation(logger, "warn", operationEventName(transport, "denied"), {
          requestId: requestIdFromRequest(request),
          operationId: operation.id,
          reason: "authorization",
          error: authorization.error || "authorization denied",
          status: authorization.status || 403
        });
        // L-4: omit operationId from auth-denied responses to reduce information
        // disclosure to unauthenticated callers probing available endpoints
        sendOperationDenied(response, authorization.status || 403, {
          error: authorization.error || "权限不足。",
          bootstrap: authorization.bootstrap,
          traceId: traceContext.traceId
        });
        notifyNarrowTransition(request, "operation.policy_deny", "policy_denied");
        return {
          ok: false,
          handled: true,
          statusCode: authorization.status || 403,
          operation,
          input: operationInput,
          traceContext
        };
      }
      authSession = authorization.session || null;
    } else if (skipAuthorization) {
      const authorizationDecision = dispatcherAuthorizationEngine.evaluate({
        operation,
        request,
        actor: providedActor,
        authSession,
        input: operationInput,
        context: {
          transport,
          skipAuthorization: true
        },
        traceId: traceContext.traceId,
        enforceConfirmation: false
      });
      if (!authorizationDecision.allowed) {
        const missingScopes = authorizationDecision.missingScopes || [];
        const error = missingScopes.length > 0
          ? `Operation ${operation.id} requires scopes: ${missingScopes.join(", ")}.`
          : `Operation ${operation.id} authorization denied: ${authorizationDecision.reasonCode}.`;
        auditOperation({
          operationAuditStore,
          operation,
          transport,
          authSession,
          actor,
          input: operationInput,
          status: "denied",
          error
        });
        logOperation(logger, "warn", operationEventName(transport, "denied"), {
          requestId: requestIdFromRequest(request),
          operationId: operation.id,
          reason: authorizationDecision.reasonCode || "authorization",
          missingScopes,
          status: 403
        });
        sendOperationDenied(response, 403, {
          error,
          operationId: operation.id,
          traceId: traceContext.traceId,
          missingScopes,
          authorizationDecisionId: authorizationDecision.decisionId
        });
        notifyNarrowTransition(request, "operation.policy_deny", "policy_denied");
        return {
          ok: false,
          handled: true,
          statusCode: 403,
          operation,
          input: operationInput,
          traceContext
        };
      }
    }

    const safety = evaluateOperationSafety({
      operation,
      requestBody,
      url,
      params,
      request,
      authSession,
      authEnabled
    });
    if (!safety.ok) {
      auditOperation({
        operationAuditStore,
        operation,
        transport,
        authSession,
        actor,
        input: operationInput,
        status: "denied",
        error: safety.error || "operation safety denied"
      });
      logOperation(logger, "warn", operationEventName(transport, "denied"), {
        requestId: requestIdFromRequest(request),
        operationId: operation.id,
        reason: "safety",
        error: safety.error || "operation safety denied",
        status: safety.status || 403,
        safety: summarizeForLog(safety.safety || {})
      });
      sendOperationDenied(response, safety.status || 403, {
        error: safety.error || "操作被安全策略拒绝。",
        operationId: operation.id,
        traceId: traceContext.traceId,
        safety: {
          risk: safety.safety?.risk,
          approvalScope: safety.safety?.approvalScope,
          requiresConfirmation: safety.safety?.requiresConfirmation
        }
      });
      notifyNarrowTransition(request, "operation.policy_deny", "policy_denied");
      return {
        ok: false,
        handled: true,
        statusCode: safety.status || 403,
        operation,
        input: operationInput,
        traceContext
      };
    }

    notifyNarrowTransition(request, "operation.policy_allow", "policy_checked");
    notifyNarrowTransition(request, "operation.ledger_start", "ledger_started");

    try {
      logOperation(logger, "debug", operationEventName(transport, "started"), {
        requestId: requestIdFromRequest(request),
        operationId: operation.id,
        concurrencySafe: operation.concurrencySafe === true,
        concurrencyGroup: operation.concurrencyGroup || operation.id
      });
      await withOperationConcurrency(
        operation,
        () => {
          notifyNarrowTransition(request, "operation.execute_start", "executing");
          notifySideEffectStart(request);
          return invokeRegisteredOperation({
            operation,
            controllers,
            request,
            response,
            requestBody,
            url,
            params,
            applyHttpQuery,
            authSession
          });
        },
        concurrencyScope
      );
      const statusCode = response?.statusCode || 200;
      auditOperation({
        operationAuditStore,
        operation,
        transport,
        authSession,
        actor,
        input: operationInput,
        status: statusCode >= 400 ? "failed" : "ok",
        startedAt
      });
      logOperation(logger, statusCode >= 400 ? "warn" : "debug", operationEventName(transport, "completed"), {
        requestId: requestIdFromRequest(request),
        operationId: operation.id,
        statusCode,
        status: statusCode >= 400 ? "failed" : "ok",
        durationMs: Date.now() - startedAt
      });
      if (statusCode >= 400) {
        notifyNarrowTransition(request, "operation.fail", "failed");
      } else {
        notifyNarrowTransition(request, "operation.audit_record", "audit_recorded");
        notifyNarrowTransition(request, "operation.complete", "completed");
      }
      return {
        ok: statusCode < 400,
        handled: true,
        statusCode,
        operation,
        input: operationInput,
        authSession,
        traceContext
      };
    } catch (error) {
      auditOperation({
        operationAuditStore,
        operation,
        transport,
        authSession,
        actor,
        input: operationInput,
        status: "failed",
        startedAt,
        error: error instanceof Error ? error.message : "operation failed"
      });
      logOperation(logger, "error", operationEventName(transport, "failed"), {
        requestId: requestIdFromRequest(request),
        operationId: operation.id,
        durationMs: Date.now() - startedAt,
        error: summarizeError(error)
      });
      notifyNarrowTransition(request, "operation.fail", "failed");
      throw error;
    }
  });
}

export async function dispatchRegisteredHttpOperation({
  operations = SERVER_API_OPERATIONS,
  controllers,
  method,
  url,
  request,
  response,
  requestBody,
  authorizeOperation = null,
  operationAuditStore = null,
  concurrencyScope = "default",
  logger = getRuntimeLogger()
}) {
  const match = findHttpOperation({
    operations,
    method,
    pathname: url.pathname
  });
  if (!match) {
    return false;
  }

  await dispatchOperation({
    operation: match.operation,
    controllers,
    request,
    response,
    requestBody,
    url,
    params: match.pathParams,
    transport: "http",
    method,
    authorizeOperation,
    operationAuditStore,
    concurrencyScope,
    logger
  });
  return true;
}

export async function dispatchInternalOperation({
  operations = SERVER_API_OPERATIONS,
  controllers,
  operationId,
  input = {},
  request = null,
  authSession = null,
  actor = { type: "system" },
  operationAuditStore = null,
  concurrencyScope = "default",
  logger = getRuntimeLogger()
} = {}) {
  const operation = operations.find((item) => item.id === operationId);
  if (!operation) {
    throw new Error(`Internal operation not registered: ${operationId}`);
  }

  const captured = createCapturedResponse();
  const url = new URL(operation.http?.path || operation.rpc?.syntheticPath || `/internal/${operation.id}`, "http://127.0.0.1");
  await dispatchOperation({
    operation,
    controllers,
    request,
    response: captured,
    requestBody: Buffer.from(JSON.stringify(input || {}), "utf8"),
    url,
    input,
    transport: "internal",
    method: operation.http?.method || "POST",
    applyHttpQuery: false,
    authorizeOperation: null,
    operationAuditStore,
    concurrencyScope,
    logger,
    authSession,
    actor
  });

  return {
    operation,
    statusCode: captured.statusCode || 200,
    headers: captured.headers || {},
    payload: parseCapturedResult({ operation, captured })
  };
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

function getHeader(headers, name) {
  const lowerName = String(name || "").toLowerCase();
  const entry = Object.entries(headers || {}).find(
    ([headerName]) => headerName.toLowerCase() === lowerName
  );
  return entry?.[1] || "";
}

function toRequestBody(operation, params) {
  if (params.bodyBase64 !== undefined) {
    return Buffer.from(String(params.bodyBase64 || ""), "base64");
  }
  if (params.bodyText !== undefined) {
    return Buffer.from(String(params.bodyText || ""), "utf8");
  }
  const body =
    params.body !== undefined
      ? params.body
      : params.payload !== undefined
        ? params.payload
        : operation.rpc?.body === "params"
          ? params
          : undefined;
  if (body === undefined) {
    return Buffer.alloc(0);
  }
  if (Buffer.isBuffer(body)) {
    return body;
  }
  if (typeof body === "string") {
    return Buffer.from(body, "utf8");
  }
  return Buffer.from(JSON.stringify(body || {}), "utf8");
}

function findParamValue(params, aliases) {
  return aliases.map((alias) => params[alias]).find(
    (item) => item !== undefined && item !== null && item !== ""
  );
}

function buildRpcUrl(operation, params) {
  let pathname = operation.rpc?.syntheticPath || `/api/rpc/${operation.id}`;
  pathname = pathname.replace(/:([A-Za-z0-9_]+)/g, (_, name) => {
    const param = (operation.rpc?.params || []).find((item) => item.name === name);
    const value = findParamValue(params, [name, ...(param?.aliases || [])]);
    if (value === undefined || value === null || value === "") {
      return `:${name}`;
    }
    return encodeURIComponent(String(value));
  });
  const url = new URL(pathname, "http://127.0.0.1");
  for (const queryParam of operation.rpc?.query || []) {
    const aliases = [queryParam.name, ...(queryParam.aliases || [])];
    const value = findParamValue(params, aliases);
    if (value === undefined || value === null || value === "") {
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        url.searchParams.append(queryParam.name, String(item));
      }
      continue;
    }
    url.searchParams.set(queryParam.name, String(value));
  }
  return url;
}

function buildRpcTargetParams(operation, params) {
  const targetParams = {};
  for (const param of operation.rpc?.params || []) {
    const aliases = [param.name, ...(param.aliases || [])];
    const value = findParamValue(params, aliases);
    if ((value === undefined || value === null || value === "") && param.required) {
      throw new Error(`RPC 参数缺少 ${param.name}`);
    }
    if (value !== undefined && value !== null && value !== "") {
      targetParams[param.name] = coerceValue(value, param.type || "string");
    }
  }
  return targetParams;
}

function parseCapturedResult({ operation, captured }) {
  const buffer = Buffer.concat(captured.chunks);
  const contentType = String(getHeader(captured.headers, "content-type") || "");
  if (/json/i.test(contentType)) {
    return buffer.length > 0 ? JSON.parse(buffer.toString("utf8")) : {};
  }
  if (/^text\//i.test(contentType) || /html/i.test(contentType)) {
    return {
      contentType,
      text: buffer.toString("utf8")
    };
  }
  return {
    contentType: contentType || (operation.binary ? "application/octet-stream" : ""),
    byteLength: buffer.length,
    base64: buffer.toString("base64")
  };
}

function rpcError(id, statusCode, message, data = {}) {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code: statusCode,
      message,
      data
    }
  };
}

export async function dispatchRpcOperation({
  operations = SERVER_API_OPERATIONS,
  controllers,
  request,
  response,
  requestBody,
  authorizeOperation = null,
  operationAuditStore = null,
  concurrencyScope = "default",
  logger = getRuntimeLogger()
}) {
  let payload;
  try {
    payload = requestBody.length > 0 ? JSON.parse(requestBody.toString("utf8")) : {};
  } catch (error) {
    logOperation(logger, "warn", "operation.rpc.denied", {
      requestId: requestIdFromRequest(request),
      reason: "invalid-json",
      error: summarizeError(error)
    });
    // L-6: do not reflect error.message — it may contain position/context info
    sendJson(response, 400, rpcError(null, 400, "RPC 请求体必须是有效的 JSON。"));
    return;
  }

  const id = payload.id ?? null;
  const operation = findRpcOperation({ operations, method: payload.method });
  if (!operation) {
    logOperation(logger, "warn", "operation.rpc.denied", {
      requestId: requestIdFromRequest(request),
      reason: "unknown-method",
      method: payload.method || ""
    });
    sendJson(response, 404, rpcError(id, 404, `RPC 方法不存在：${payload.method || ""}`));
    return;
  }

  const params = payload.params && typeof payload.params === "object" ? payload.params : {};
  const captured = createCapturedResponse();
  let dispatchResult = null;
  try {
    const rpcUrl = buildRpcUrl(operation, params);
    const targetParams = buildRpcTargetParams(operation, params);
    const targetRequestBody = toRequestBody(operation, params);
    const input = inputFromRequest({
      operation,
      requestBody: targetRequestBody,
      url: rpcUrl,
      params,
      applyHttpQuery: false
    });
    dispatchResult = await dispatchOperation({
      operation,
      controllers,
      request,
      response: captured,
      requestBody: targetRequestBody,
      url: rpcUrl,
      params: targetParams,
      input,
      transport: "rpc",
      method: "POST",
      applyHttpQuery: false,
      authorizeOperation,
      operationAuditStore,
      concurrencyScope,
      logger
    });
  } catch (error) {
    logOperation(logger, "error", "operation.rpc.failed", {
      requestId: requestIdFromRequest(request),
      rpcId: id,
      operationId: operation?.id || "",
      error: summarizeError(error)
    });
    sendJson(
      response,
      200,
      rpcError(id, 500, error instanceof Error ? error.message : "RPC 调用失败")
    );
    return;
  }

  const statusCode = captured.statusCode || 200;
  const result = parseCapturedResult({ operation, captured });
  logOperation(logger, statusCode >= 400 ? "warn" : "debug", "operation.rpc.completed", {
    requestId: requestIdFromRequest(request),
    rpcId: id,
    operationId: operation.id,
    statusCode,
    status: statusCode >= 400 ? "failed" : "ok",
    traceId: dispatchResult?.traceContext?.traceId || "",
    output: summarizeForLog(result, { maxDepth: 3, maxArrayItems: 5, maxObjectKeys: 30 })
  });
  if (statusCode >= 400) {
    sendJson(
      response,
      200,
      rpcError(id, statusCode, result?.error || `RPC 调用失败：${operation.rpc.method}`, result)
    );
    return;
  }

  sendJson(response, 200, {
    jsonrpc: "2.0",
    id,
    result
  });
}
