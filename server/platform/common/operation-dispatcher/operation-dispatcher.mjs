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
import {
  RISK_CONTROL_BOUNDARY_IDS,
  RISK_CONTROL_ENVIRONMENT_IDS,
  RISK_CONTROL_POINTS,
  appendRiskControlGateRecord,
  createRiskControlOperationEnvelope,
  digestRiskControlValue
} from "../security/risk-control/index.mjs";

const operationLocks = new Map();
const dispatcherAuthorizationEngine = createAuthorizationEngine();
const RISK_CONTROL_BY_ID = new Map(RISK_CONTROL_POINTS.map((control) => [control.controlId, control]));

const DISPATCHER_RISK_CONTROL_IDS = Object.freeze({
  admit: "client.registration.admit",
  externalBind: "client.agent-identity.bind",
  consoleBind: "client.operator-identity.bind",
  externalAuthorize: "client.mcp-grant.authorize",
  operationAuthorize: "client.operation-permission.authorize",
  platformAuthorize: "platform.capability-kernel.authorize",
  approve: "client.high-risk-confirmation.approve",
  execute: "platform.operation-ledger.execute",
  auditRecover: "platform.audit.audit"
});

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

function firstText(...values) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) {
      return text;
    }
  }
  return "";
}

function compactStrings(values = [], limit = 50) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || "").trim())
    .filter(Boolean))]
    .slice(0, limit);
}

function arrayOf(value) {
  if (Array.isArray(value)) {
    return value;
  }
  return value === undefined || value === null || value === "" ? [] : [value];
}

function cleanRiskControlValue(value, depth = 0) {
  if (value === undefined || typeof value === "function" || typeof value === "symbol") {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value === "string") {
    return value.length > 500 ? `${value.slice(0, 500)}...` : value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : String(value);
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (depth > 6) {
    return "[truncated-depth]";
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, 50)
      .map((item) => cleanRiskControlValue(item, depth + 1))
      .filter((item) => item !== undefined);
  }
  if (Buffer.isBuffer(value)) {
    return {
      type: "buffer",
      byteLength: value.length
    };
  }
  const output = {};
  for (const [key, nested] of Object.entries(value).slice(0, 50)) {
    const cleaned = cleanRiskControlValue(nested, depth + 1);
    if (cleaned !== undefined) {
      output[key] = cleaned;
    }
  }
  return output;
}

function riskControlInputHash({ operation, transport, method, input }) {
  return digestRiskControlValue("v0.0.1:strategy:risk-control-operation-input-1", cleanRiskControlValue({
    operationId: operation?.id || "",
    transport,
    method,
    input: input || {}
  }));
}

function riskControlSubject({ actor = null, authSession = null } = {}) {
  const user = authSession?.user || actor?.user || actor || {};
  const subjectType =
    actor?.type ||
    user.type ||
    (user.roleId === "tool-grant" ? "tool-grant" : user.userId ? "console-user" : "anonymous");
  const subject = {
    type: subjectType,
    userId: firstText(user.userId, actor?.userId),
    subjectId: firstText(user.subjectId, actor?.subjectId, user.userId, actor?.userId),
    roleId: firstText(user.roleId, actor?.roleId),
    tenantId: firstText(user.tenantId, actor?.tenantId),
    orgId: firstText(user.orgId, actor?.orgId),
    grantId: firstText(user.grantId, actor?.grantId, user.roleId === "tool-grant" ? user.userId : ""),
    scopes: compactStrings([...arrayOf(user.scopes), ...arrayOf(actor?.scopes)]),
    capabilities: compactStrings([...arrayOf(user.capabilities), ...arrayOf(actor?.capabilities)]),
    toolsets: compactStrings([...arrayOf(user.toolsets), ...arrayOf(actor?.toolsets)])
  };
  return cleanRiskControlValue(subject);
}

function riskControlResource({ operation, transport, method, url, statusCode = 0 }) {
  return cleanRiskControlValue({
    operationId: operation?.id || "",
    feature: operation?.feature || "",
    transport,
    method,
    path: url?.pathname || "",
    statusCode: Number(statusCode || 0) || 0,
    risk: operation?.safety?.risk || "",
    readOnly: operation?.readOnly === true,
    requiredScopes: compactStrings(operation?.requiredScopes || [])
  });
}

function riskControlEnvironment({ control, transport }) {
  return {
    boundaryId: control?.owner?.boundaryId || RISK_CONTROL_BOUNDARY_IDS.PLATFORM_SELF,
    environmentId: control?.owner?.environmentId || RISK_CONTROL_ENVIRONMENT_IDS.PLATFORM_RUNTIME,
    transport
  };
}

function riskControlById(controlId) {
  const control = RISK_CONTROL_BY_ID.get(controlId);
  if (!control) {
    throw new Error(`Risk Control point is not registered: ${controlId}`);
  }
  return control;
}

function createDispatcherRiskControlEnvelope({
  request,
  operation,
  traceContext,
  transport,
  method,
  input
}) {
  const envelope = createRiskControlOperationEnvelope({
    operationId: operation.id,
    traceId: traceContext.traceId,
    inputHash: riskControlInputHash({ operation, transport, method, input })
  });
  if (request && typeof request === "object") {
    request.__pactRiskControl = envelope;
  }
  return envelope;
}

function appendDispatcherRiskGate({
  envelope,
  request,
  operation,
  actor = null,
  authSession = null,
  traceContext,
  transport,
  method,
  url,
  controlId,
  decision = "allow",
  reasonCode = "",
  statusCode = 0,
  details = {}
}) {
  const targetEnvelope = envelope || request?.__pactRiskControl;
  if (!targetEnvelope) {
    throw new Error(`Risk Control envelope missing for operation ${operation?.id || ""}.`);
  }
  const control = riskControlById(controlId);
  const evidence = cleanRiskControlValue({
    type: "operation-dispatcher",
    traceId: traceContext?.traceId || "",
    requestId: traceContext?.requestId || requestIdFromRequest(request),
    statusCode: Number(statusCode || 0) || 0,
    details
  });
  return appendRiskControlGateRecord(targetEnvelope, {
    control,
    decision,
    reasonCode,
    subject: riskControlSubject({ actor, authSession }),
    intent: `${transport || "internal"}:${method || ""}:${operation?.id || ""}`,
    resource: riskControlResource({ operation, transport, method, url, statusCode }),
    environment: riskControlEnvironment({ control, transport }),
    evidence: [evidence]
  });
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
  if (!authSession?.user) {
    return { type: "anonymous" };
  }
  const user = authSession.user;
  return {
    type: user.type || (user.roleId === "tool-grant" ? "tool-grant" : "console-user"),
    user
  };
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
  error = "",
  riskControlEnvelope = null
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
    error,
    riskControl: riskControlEnvelope
  });
}

function externalAuthVerifierConfig(operation = {}) {
  const verifier = operation.externalAuthVerifier;
  if (typeof verifier === "string") {
    return { method: verifier };
  }
  if (verifier && typeof verifier === "object" && !Array.isArray(verifier)) {
    return verifier;
  }
  return {};
}

async function verifyExternalAuth({
  operation,
  controllers,
  request,
  input,
  requestBody,
  url,
  params,
  method,
  transport
}) {
  const verifierConfig = externalAuthVerifierConfig(operation);
  const controllerName = verifierConfig.controller || operation.target?.controller || "";
  const methodName = verifierConfig.method || "";
  const verifier = controllers?.[controllerName]?.[methodName];
  if (typeof verifier !== "function") {
    return {
      ok: false,
      status: 503,
      reasonCode: "external_auth_verifier_missing",
      error: "External authentication verifier is not registered."
    };
  }

  try {
    const verification = await verifier({
      operation,
      request,
      input,
      requestBody,
      url,
      params,
      method,
      transport,
      externalAuth: verifierConfig
    });
    if (verification === true) {
      return { ok: true };
    }
    if (verification?.ok === true) {
      return verification;
    }
    return {
      ok: false,
      status: Number(verification?.status || verification?.statusCode || 401) || 401,
      reasonCode: verification?.reasonCode || verification?.code || "external_auth_denied",
      error: verification?.error || verification?.message || "External authentication denied.",
      missingScopes: verification?.missingScopes || [],
      missingCapabilities: verification?.missingCapabilities || []
    };
  } catch (error) {
    logOperation(getRuntimeLogger(), "error", "operation.external_auth.verifier_failed", {
      operationId: operation.id,
      verifier: `${controllerName}.${methodName}`,
      error: summarizeError(error)
    });
    return {
      ok: false,
      status: 503,
      reasonCode: "external_auth_verifier_failed",
      error: "External authentication verifier failed."
    };
  }
}

function externalAuthDeniedPayload(operation, verification, traceId) {
  const status = Number(verification?.status || verification?.statusCode || 401) || 401;
  const reasonCode =
    verification?.reasonCode ||
    verification?.code ||
    (status === 401 ? operation.externalAuthMissingCode : "external_auth_denied");
  const error = verification?.error || verification?.message || "External authentication denied.";
  const payload = {
    schemaVersion: "v0.0.1:schema:definition-1",
    error: {
      code: reasonCode,
      message: error
    },
    traceId
  };
  if (Array.isArray(verification?.missingScopes) && verification.missingScopes.length > 0) {
    payload.error.missingScopes = verification.missingScopes;
  }
  if (Array.isArray(verification?.missingCapabilities) && verification.missingCapabilities.length > 0) {
    payload.error.missingCapabilities = verification.missingCapabilities;
  }
  return payload;
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

export function findProxyRegisteredApiRequest({
  method,
  pathname,
  discoveryState,
  operations = SERVER_API_OPERATIONS
}) {
  if (!discoveryState || discoveryState.mode !== "forward") {
    return null;
  }

  if (!pathname.startsWith("/api/")) {
    return null;
  }

  if (LOCAL_FORWARD_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return null;
  }

  const normalizedMethod = String(method || "").trim().toUpperCase();
  if (!normalizedMethod) {
    return null;
  }

  const operation = operations.find((item) =>
    item.http.method === normalizedMethod && matchPath(item.http.path, pathname)
  );
  if (!operation || operation.http.localInForwardMode || operation.externalAuth === true) {
    return null;
  }

  const targetBaseUrl = String(
    discoveryState.forwardBaseUrl || discoveryState.activeServiceUrl || ""
  ).trim().replace(/\/+$/, "");
  if (!targetBaseUrl || targetBaseUrl === discoveryState.advertisedBaseUrl) {
    return null;
  }
  return {
    operation,
    targetBaseUrl
  };
}

export function shouldProxyRegisteredApiRequest(input = {}) {
  return Boolean(findProxyRegisteredApiRequest(input));
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
  verifyProcessIdentity = null,
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
  let actor = actorFromInput({ actor: providedActor, authSession: providedAuthSession });
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
	    let authSession = providedAuthSession;
	    const riskControlEnvelope = createDispatcherRiskControlEnvelope({
	      request,
	      operation,
	      traceContext,
	      transport,
	      method,
	      input: operationInput
	    });
	    const appendRiskGate = (gate = {}) => appendDispatcherRiskGate({
	      envelope: riskControlEnvelope,
	      request,
	      operation,
	      actor: gate.actor === undefined ? actor : gate.actor,
	      authSession: gate.authSession === undefined ? authSession : gate.authSession,
	      traceContext,
	      transport,
	      method,
	      url,
	      ...gate
	    });
	    const writeAuditOperation = (entry = {}) => {
	      appendRiskGate({
	        controlId: DISPATCHER_RISK_CONTROL_IDS.auditRecover,
	        decision: "allow",
	        reasonCode: entry.status === "denied"
	          ? "audit_denied_request"
	          : entry.status === "failed"
	            ? "audit_failed_operation"
	            : "audit_operation_recorded",
	        statusCode: entry.statusCode || 0,
	        details: {
	          auditStatus: entry.status || "",
	          hasError: Boolean(entry.error)
	        }
	      });
	      return auditOperation({
	        ...entry,
	        riskControlEnvelope
	      });
	    };
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
	      appendRiskGate({
	        controlId: DISPATCHER_RISK_CONTROL_IDS.admit,
	        decision: "deny",
	        reasonCode: "schema_invalid",
	        statusCode: schema.status || 400,
	        details: {
	          error: schema.error
	        }
	      });
	      writeAuditOperation({
	        operationAuditStore,
	        operation,
	        transport,
	        actor,
	        input: operationInput,
	        status: "denied",
	        statusCode: schema.status || 400,
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
	        traceContext,
	        riskControl: riskControlEnvelope
	      };
	    }

    appendRiskGate({
      controlId: DISPATCHER_RISK_CONTROL_IDS.admit,
      decision: "allow",
	      reasonCode: "schema_valid",
	      details: {
	        schema: "valid"
	      }
    });
	    const authEnabled = true;
    let processIdentityVerification = null;
    const processIdentityRequired = operation.processIdentity?.required === true;
    if (!skipAuthorization && processIdentityRequired) {
      processIdentityVerification = typeof verifyProcessIdentity === "function"
        ? await verifyProcessIdentity({
            operation,
            request,
            requestBody,
            url,
            method,
            transport,
            input: operationInput
          })
        : {
            ok: false,
            status: 503,
            reasonCode: "process_identity_verifier_missing",
            error: "Process identity verifier is not registered for this transport."
          };
      if (!processIdentityVerification.ok) {
        const status = Number(processIdentityVerification.status || processIdentityVerification.statusCode || 401) || 401;
        const error = processIdentityVerification.error || "process identity verification denied";
        appendRiskGate({
          controlId: DISPATCHER_RISK_CONTROL_IDS.externalBind,
          decision: "deny",
          reasonCode: processIdentityVerification.reasonCode || "process_identity_denied",
          statusCode: status,
          details: {
            requiredCapabilities: processIdentityVerification.requiredCapabilities || []
          }
        });
        writeAuditOperation({
          operationAuditStore,
          operation,
          transport,
          authSession,
          actor,
          input: operationInput,
          status: "denied",
          statusCode: status,
          error
        });
        logOperation(logger, "warn", operationEventName(transport, "denied"), {
          requestId: requestIdFromRequest(request),
          operationId: operation.id,
          reason: processIdentityVerification.reasonCode || "process_identity",
          status
        });
        sendOperationDenied(response, status, {
          error,
          traceId: traceContext.traceId
        });
        notifyNarrowTransition(request, "operation.policy_deny", "policy_denied");
        return { ok: false, handled: true, statusCode: status, operation, input: operationInput, traceContext, riskControl: riskControlEnvelope };
      }
      if (request && typeof request === "object") {
        request.__pactProcessIdentity = processIdentityVerification;
      }
      if (processIdentityVerification.authSession) {
        authSession = processIdentityVerification.authSession;
      }
      if (processIdentityVerification.actor) {
        actor = processIdentityVerification.actor;
      }
      appendRiskGate({
        controlId: DISPATCHER_RISK_CONTROL_IDS.externalBind,
        decision: "allow",
        reasonCode: processIdentityVerification.reasonCode || "process_identity_verified",
        actor,
        authSession,
        details: {
          packageId: processIdentityVerification.client?.packageId || "",
          processKeyId: processIdentityVerification.client?.processKeyId || ""
        }
      });
      appendRiskGate({
        controlId: DISPATCHER_RISK_CONTROL_IDS.platformAuthorize,
        decision: "allow",
        reasonCode: "process_identity_capability_authorized",
        actor,
        authSession,
        details: {
          requiredCapabilities: processIdentityVerification.requiredCapabilities || []
        }
      });
    }
    const processIdentityAuthorizes =
      processIdentityRequired &&
      processIdentityVerification?.ok === true &&
      operation.processIdentity?.authorizes === true;
    const shouldRunConsoleAuthorization =
      !processIdentityAuthorizes &&
      !skipAuthorization &&
      operation.externalAuth !== true &&
      typeof authorizeOperation === "function";

    if (!skipAuthorization && operation.externalAuth === true) {
      const verification = await verifyExternalAuth({
        operation,
        controllers,
        request,
        input: operationInput,
        requestBody,
        url,
        params,
        method,
        transport
	      });
	      if (!verification.ok) {
	        const status = Number(verification.status || verification.statusCode || 401) || 401;
	        const error = verification.error || verification.message || "external authentication denied";
	        appendRiskGate({
	          controlId: (verification.missingScopes || []).length > 0 || (verification.missingCapabilities || []).length > 0
	            ? DISPATCHER_RISK_CONTROL_IDS.externalAuthorize
	            : DISPATCHER_RISK_CONTROL_IDS.externalBind,
	          decision: "deny",
	          reasonCode: verification.reasonCode || verification.code || "external_auth_denied",
	          statusCode: status,
	          details: {
	            missingScopes: verification.missingScopes || [],
	            missingCapabilities: verification.missingCapabilities || []
	          }
	        });
	        writeAuditOperation({
	          operationAuditStore,
	          operation,
	          transport,
	          authSession,
	          actor,
	          input: operationInput,
	          status: "denied",
	          statusCode: status,
	          error
	        });
        logOperation(logger, "warn", operationEventName(transport, "denied"), {
          requestId: requestIdFromRequest(request),
          operationId: operation.id,
          reason: verification.reasonCode || verification.code || "external_auth",
          status
	        });
	        sendOperationDenied(response, status, externalAuthDeniedPayload(operation, verification, traceContext.traceId));
	        notifyNarrowTransition(request, "operation.policy_deny", "policy_denied");
	        return { ok: false, handled: true, statusCode: status, operation, input: operationInput, traceContext, riskControl: riskControlEnvelope };
	      }
	      if (request && typeof request === "object") {
	        request.__pactExternalAuth = verification;
	      }
	      if (verification.authSession) {
	        authSession = verification.authSession;
	      }
	      if (verification.actor) {
	        actor = verification.actor;
	      }
	      appendRiskGate({
	        controlId: DISPATCHER_RISK_CONTROL_IDS.externalBind,
	        decision: "allow",
	        reasonCode: "external_auth_bound",
	        actor,
	        authSession,
	        details: {
	          verifier: externalAuthVerifierConfig(operation).method || "",
	          grantId: firstText(verification.grantId, verification.grant?.id, authSession?.user?.grantId, authSession?.user?.userId)
	        }
	      });
	      appendRiskGate({
	        controlId: DISPATCHER_RISK_CONTROL_IDS.externalAuthorize,
	        decision: "allow",
	        reasonCode: "external_auth_authorized",
	        actor,
	        authSession,
	        details: {
	          authorizationDecisionId: verification.authorizationDecision?.decisionId || "",
	          scopes: authSession?.user?.scopes || []
	        }
	      });
	    }

    if (shouldRunConsoleAuthorization) {
      const authorization = await authorizeOperation({
        request,
        operation,
        method,
        url
	      });
	      if (!authorization.ok) {
	        const authorizationSession = authorization.session || null;
	        if (authorizationSession) {
	          appendRiskGate({
	            controlId: DISPATCHER_RISK_CONTROL_IDS.consoleBind,
	            decision: "allow",
	            reasonCode: "console_session_bound",
	            authSession: authorizationSession,
	            details: {
	              publicAccess: operation.public === true
	            }
	          });
	        }
	        appendRiskGate({
	          controlId: authorizationSession
	            ? DISPATCHER_RISK_CONTROL_IDS.operationAuthorize
	            : DISPATCHER_RISK_CONTROL_IDS.consoleBind,
	          decision: "deny",
	          reasonCode: authorization.authorizationDecision?.reasonCode || "authorization_denied",
	          statusCode: authorization.status || 403,
	          authSession: authorizationSession,
	          details: {
	            authorizationDecisionId: authorization.authorizationDecision?.decisionId || "",
	            missingScopes: authorization.authorizationDecision?.missingScopes || [],
	            missingCapabilities: authorization.authorizationDecision?.missingCapabilities || []
	          }
	        });
	        writeAuditOperation({
	          operationAuditStore,
	          operation,
	          transport,
	          authSession: authorizationSession,
	          actor,
	          input: operationInput,
	          status: "denied",
	          statusCode: authorization.status || 403,
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
	          traceContext,
	          riskControl: riskControlEnvelope
	        };
	      }
	      authSession = authorization.session || null;
	      actor = actorFromInput({ actor: providedActor, authSession });
	      appendRiskGate({
	        controlId: DISPATCHER_RISK_CONTROL_IDS.consoleBind,
	        decision: "allow",
	        reasonCode: authSession ? "console_session_bound" : "public_access_bound",
	        actor,
	        authSession,
	        details: {
	          publicAccess: operation.public === true,
	          setupMode: authorization.setupMode === true
	        }
	      });
	      appendRiskGate({
	        controlId: DISPATCHER_RISK_CONTROL_IDS.operationAuthorize,
	        decision: "allow",
	        reasonCode: authorization.authorizationDecision?.reasonCode || (operation.public === true ? "allowed_public" : "operation_authorized"),
	        actor,
	        authSession,
	        details: {
	          authorizationDecisionId: authorization.authorizationDecision?.decisionId || "",
	          requiredScopes: operation.requiredScopes || []
	        }
	      });
	    } else if (processIdentityAuthorizes) {
      appendRiskGate({
        controlId: DISPATCHER_RISK_CONTROL_IDS.operationAuthorize,
        decision: "allow",
        reasonCode: "process_identity_authorized",
        actor,
        authSession,
        details: {
          requiredCapabilities: processIdentityVerification?.requiredCapabilities || []
        }
      });
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
	        appendRiskGate({
	          controlId: DISPATCHER_RISK_CONTROL_IDS.platformAuthorize,
	          decision: "deny",
	          reasonCode: authorizationDecision.reasonCode || "authorization_denied",
	          statusCode: 403,
	          details: {
	            authorizationDecisionId: authorizationDecision.decisionId,
	            missingScopes,
	            missingCapabilities: authorizationDecision.missingCapabilities || []
	          }
	        });
	        writeAuditOperation({
	          operationAuditStore,
	          operation,
	          transport,
	          authSession,
	          actor,
	          input: operationInput,
	          status: "denied",
	          statusCode: 403,
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
	          traceContext,
	          riskControl: riskControlEnvelope
	        };
	      }
	      appendRiskGate({
	        controlId: DISPATCHER_RISK_CONTROL_IDS.platformAuthorize,
	        decision: "allow",
	        reasonCode: authorizationDecision.reasonCode || "preauthorized_dispatch_allowed",
	        details: {
	          authorizationDecisionId: authorizationDecision.decisionId,
	          skipAuthorization: true
	        }
	      });
	    } else if (operation.externalAuth !== true && operation.public !== true && ["http", "rpc"].includes(transport)) {
	      const error = "Operation authorizer is not registered for this transport.";
	      appendRiskGate({
	        controlId: DISPATCHER_RISK_CONTROL_IDS.operationAuthorize,
	        decision: "deny",
	        reasonCode: "operation_authorizer_missing",
	        statusCode: 503,
	        details: {
	          transport
	        }
	      });
	      writeAuditOperation({
	        operationAuditStore,
	        operation,
	        transport,
	        authSession,
	        actor,
	        input: operationInput,
	        status: "denied",
	        statusCode: 503,
	        error
	      });
	      logOperation(logger, "error", operationEventName(transport, "denied"), {
	        requestId: requestIdFromRequest(request),
	        operationId: operation.id,
	        reason: "operation_authorizer_missing",
	        status: 503
	      });
	      sendOperationDenied(response, 503, {
	        error: "操作授权器未注册。",
	        traceId: traceContext.traceId
	      });
	      notifyNarrowTransition(request, "operation.policy_deny", "policy_denied");
	      return {
	        ok: false,
	        handled: true,
	        statusCode: 503,
	        operation,
	        input: operationInput,
	        traceContext,
	        riskControl: riskControlEnvelope
	      };
	    } else if (operation.externalAuth !== true) {
	      appendRiskGate({
	        controlId: operation.public === true
	          ? DISPATCHER_RISK_CONTROL_IDS.operationAuthorize
	          : DISPATCHER_RISK_CONTROL_IDS.platformAuthorize,
	        decision: "allow",
	        reasonCode: operation.public === true ? "allowed_public_without_authorizer" : "internal_dispatch_authorized",
	        details: {
	          transport,
	          publicAccess: operation.public === true
	        }
	      });
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
	      appendRiskGate({
	        controlId: DISPATCHER_RISK_CONTROL_IDS.approve,
	        decision: "deny",
	        reasonCode: safety.safety?.blocked || safety.safety?.risk === "destructive"
	          ? "risk_blocked"
	          : "approval_denied",
	        statusCode: safety.status || 403,
	        details: {
	          risk: safety.safety?.risk || "",
	          approvalScope: safety.safety?.approvalScope || "",
	          requiresConfirmation: safety.safety?.requiresConfirmation === true
	        }
	      });
	      writeAuditOperation({
	        operationAuditStore,
	        operation,
	        transport,
	        authSession,
	        actor,
	        input: operationInput,
	        status: "denied",
	        statusCode: safety.status || 403,
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
	        traceContext,
	        riskControl: riskControlEnvelope
	      };
	    }

	    appendRiskGate({
	      controlId: DISPATCHER_RISK_CONTROL_IDS.approve,
	      decision: "allow",
	      reasonCode: safety.safety?.requiresConfirmation ? "approval_confirmed" : "approval_not_required",
	      details: {
	        risk: safety.safety?.risk || "",
	        approvalScope: safety.safety?.approvalScope || "",
	        requiresConfirmation: safety.safety?.requiresConfirmation === true
	      }
	    });

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
	          appendRiskGate({
	            controlId: DISPATCHER_RISK_CONTROL_IDS.execute,
	            decision: "allow",
	            reasonCode: "execute_started",
	            details: {
	              concurrencySafe: operation.concurrencySafe === true,
	              concurrencyGroup: operation.concurrencyGroup || operation.id
	            }
	          });
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
	      writeAuditOperation({
	        operationAuditStore,
	        operation,
	        transport,
	        authSession,
	        actor,
	        input: operationInput,
	        status: statusCode >= 400 ? "failed" : "ok",
	        statusCode,
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
	        traceContext,
	        riskControl: riskControlEnvelope
	      };
	    } catch (error) {
	      writeAuditOperation({
	        operationAuditStore,
	        operation,
	        transport,
        authSession,
        actor,
	        input: operationInput,
	        status: "failed",
	        statusCode: response?.statusCode || 500,
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
  verifyProcessIdentity = null,
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
    verifyProcessIdentity,
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
  verifyProcessIdentity = null,
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
    sendJson(response, 404, rpcError(id, 404, "RPC 方法不存在。"));
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
      verifyProcessIdentity,
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
      rpcError(id, 500, "RPC 调用失败。")
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
