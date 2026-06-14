import {
  getRuntimeLogger,
  sendJson,
  summarizeError,
  summarizeForLog
} from "../../../../interactive/product-api.mjs";
import { TOOL_MANAGEMENT_API_PREFIX } from "./catalog.mjs";

const AGENT_RELAY_API_PREFIX = "/api/agent-relay/v1";

function parseJsonBody(requestBody) {
  if (!requestBody || requestBody.length === 0) {
    return {};
  }
  return JSON.parse(requestBody.toString("utf8"));
}

function pathAfterPrefix(pathname) {
  return String(pathname || "").slice(TOOL_MANAGEMENT_API_PREFIX.length) || "/";
}

function pathAfterAgentRelayPrefix(pathname) {
  return String(pathname || "").slice(AGENT_RELAY_API_PREFIX.length) || "/";
}

function queryPayload(url = null) {
  if (!url) {
    return {};
  }
  return Object.fromEntries(url.searchParams.entries());
}

const EXTERNAL_CONTEXT_PROOF_KEYS = new Set([
  "approval",
  "pendingOperationApproved",
  "approvedPendingOperation",
  "authorizedGrant",
  "authorization",
  "authorizationDecision",
  "policy",
  "policyDecision",
  "policyDecisionId",
  "grant",
  "grantId",
  "transport",
  "requirePendingOperation",
  "pendingApprovalRequired",
  "approvalExpiresAt",
  "expiresAt",
  "relayChildOperation",
  "grantBindingVerified",
  "requestBindingMismatches",
  "relayMcpGrantId",
  "relaySessionId",
  "relayTurnId",
  "virtualAgentId",
  "targetId",
  "parentOperationId",
  "sourceIp",
  "userAgent",
  "toolExecutionId"
]);

const SAFE_EXTERNAL_CONTEXT_KEYS = new Set([
  "source",
  "correlationId",
  "requestId",
  "idempotencyKey",
  "agentId",
  "agentProfileId",
  "profileId",
  "userId",
  "boundUserId",
  "subjectId",
  "clientId",
  "clientName",
  "namespace",
  "bindingNamespace",
  "batch",
  "call"
]);

const AGENT_RELAY_EXTERNAL_SECRET_INPUT_KEYS = new Set([
  "sourceMcpConfig",
  "sourceMcpToken",
  "upstreamToken",
  "relayMcpToken",
  "relayMcpAccessToken"
]);

function plainObject(value = null) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function sanitizeExternalContextScalar(value) {
  if (typeof value === "string") {
    const text = value.trim();
    return text.length > 256 ? text.slice(0, 256) : text;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return undefined;
}

function sanitizeExternalToolContext(value = {}, serverContext = {}) {
  const sanitized = {};
  for (const [key, entry] of Object.entries(plainObject(value))) {
    if (EXTERNAL_CONTEXT_PROOF_KEYS.has(key) || key.startsWith("__pact") || !SAFE_EXTERNAL_CONTEXT_KEYS.has(key)) {
      continue;
    }
    const scalar = sanitizeExternalContextScalar(entry);
    if (scalar !== undefined) {
      sanitized[key] = scalar;
    }
  }
  return {
    ...sanitized,
    ...serverContext
  };
}

function sanitizeAgentRelayHttpInput(value = {}) {
  const sanitized = {};
  for (const [key, entry] of Object.entries(plainObject(value))) {
    if (AGENT_RELAY_EXTERNAL_SECRET_INPUT_KEYS.has(key)) {
      continue;
    }
    sanitized[key] = entry;
  }
  return sanitized;
}

function routeAcpAgentRelayRequest({ method, suffix, url, requestBody }) {
  const normalizedMethod = String(method || "GET").toUpperCase();
  const body = normalizedMethod === "GET" || normalizedMethod === "HEAD" ? {} : parseJsonBody(requestBody);
  const input = sanitizeAgentRelayHttpInput({
    ...queryPayload(url),
    ...body
  });
  if (normalizedMethod === "GET" && suffix === "/templates") {
    return { operationId: "acp_agent_relay.templates.list", input };
  }
  const templateMatch = suffix.match(/^\/templates\/([^/]+)$/);
  if (normalizedMethod === "GET" && templateMatch) {
    return {
      operationId: "acp_agent_relay.templates.list",
      input: { ...input, templateId: decodeURIComponent(templateMatch[1]) }
    };
  }
  if (normalizedMethod === "GET" && suffix === "/virtual-agents") {
    return { operationId: "acp_agent_relay.virtual_agents.list", input };
  }
  if (normalizedMethod === "POST" && suffix === "/virtual-agents") {
    return { operationId: "acp_agent_relay.virtual_agents.upsert", input };
  }
  const virtualAgentUpsertMatch = suffix.match(/^\/virtual-agents\/([^/]+)$/);
  if ((normalizedMethod === "PUT" || normalizedMethod === "POST") && virtualAgentUpsertMatch) {
    return {
      operationId: "acp_agent_relay.virtual_agents.upsert",
      input: { ...input, virtualAgentId: decodeURIComponent(virtualAgentUpsertMatch[1]) }
    };
  }
  if (normalizedMethod === "GET" && suffix === "/targets") {
    return { operationId: "acp_agent_relay.targets.list", input };
  }
  if (normalizedMethod === "POST" && suffix === "/targets") {
    return { operationId: "acp_agent_relay.targets.upsert", input };
  }
  const targetUpsertMatch = suffix.match(/^\/targets\/([^/]+)$/);
  if ((normalizedMethod === "PUT" || normalizedMethod === "POST") && targetUpsertMatch) {
    return {
      operationId: "acp_agent_relay.targets.upsert",
      input: { ...input, targetId: decodeURIComponent(targetUpsertMatch[1]) }
    };
  }
  if (normalizedMethod === "POST" && suffix === "/downstream-clients/refresh") {
    return { operationId: "acp_agent_relay.downstream_clients.refresh", input };
  }
  const initializeMatch = suffix.match(/^\/virtual-agents\/([^/]+)\/initialize$/);
  if (normalizedMethod === "POST" && initializeMatch) {
    return {
      operationId: "acp_agent_relay.virtual_agent.initialize",
      input: { ...input, virtualAgentId: decodeURIComponent(initializeMatch[1]) }
    };
  }
  if (normalizedMethod === "POST" && suffix === "/sessions") {
    return { operationId: "acp_agent_relay.session.create", input };
  }
  if (normalizedMethod === "GET" && suffix === "/sessions") {
    return { operationId: "acp_agent_relay.sessions.list", input };
  }
  const sessionGetMatch = suffix.match(/^\/sessions\/([^/]+)$/);
  if (normalizedMethod === "GET" && sessionGetMatch) {
    return {
      operationId: "acp_agent_relay.sessions.get",
      input: { ...input, sessionId: decodeURIComponent(sessionGetMatch[1]) }
    };
  }
  const sessionTurnsMatch = suffix.match(/^\/sessions\/([^/]+)\/turns$/);
  if (normalizedMethod === "GET" && sessionTurnsMatch) {
    return {
      operationId: "acp_agent_relay.turns.list",
      input: { ...input, sessionId: decodeURIComponent(sessionTurnsMatch[1]) }
    };
  }
  const turnObserveMatch = suffix.match(/^\/sessions\/([^/]+)\/turns\/([^/]+)\/observe$/);
  if (normalizedMethod === "POST" && turnObserveMatch) {
    return {
      operationId: "acp_agent_relay.turn.observe",
      input: {
        ...input,
        sessionId: decodeURIComponent(turnObserveMatch[1]),
        relayTurnId: decodeURIComponent(turnObserveMatch[2])
      }
    };
  }
  if (normalizedMethod === "POST" && suffix === "/fs/read-text-file") {
    return { operationId: "acp_agent_relay.fs.read_text_file", input };
  }
  if (normalizedMethod === "POST" && suffix === "/fs/write-text-file") {
    return { operationId: "acp_agent_relay.fs.write_text_file", input };
  }
  const sessionActionMatch = suffix.match(/^\/sessions\/([^/]+)\/(resume|wake|prompt|cancel|close)$/);
  if (normalizedMethod === "POST" && sessionActionMatch) {
    const actionOperationId = {
      resume: "acp_agent_relay.session.resume",
      wake: "acp_agent_relay.session.wake",
      prompt: "acp_agent_relay.prompt.send",
      cancel: "acp_agent_relay.session.cancel",
      close: "acp_agent_relay.session.close"
    }[sessionActionMatch[2]];
    return {
      operationId: actionOperationId,
      input: { ...input, sessionId: decodeURIComponent(sessionActionMatch[1]) }
    };
  }
  const permissionMatch = suffix.match(/^\/sessions\/([^/]+)\/permission\/resolve$/);
  if (normalizedMethod === "POST" && permissionMatch) {
    return {
      operationId: "acp_agent_relay.permission.resolve",
      input: { ...input, sessionId: decodeURIComponent(permissionMatch[1]) }
    };
  }
  return null;
}

async function authorizeConsole({
  securityPermissions = null,
  request,
  method,
  url,
  requiredScopes = ["runtime:admin"]
}) {
  if (!securityPermissions || typeof securityPermissions.authorizeOperation !== "function") {
    return { ok: true, session: null };
  }
  return securityPermissions.authorizeOperation({
    request,
    method,
    url,
    operation: {
      id: "tool_management.http",
      requiredScopes,
      skipCsrf: false
    }
  });
}

function sendAuthorizationDenied(response, authorization) {
  sendJson(response, authorization.status || 403, {
    schemaVersion: "v0.0.1:schema:definition-1",
    error: {
      code: authorization.status === 401 ? "console_unauthenticated" : "console_forbidden",
      message: authorization.error || "Permission denied.",
      details: {
        bootstrap: authorization.bootstrap
      }
    }
  });
}

export function createToolManagementHttpRouter({
  platform,
  securityPermissions = null,
  logger = getRuntimeLogger()
}) {
  function logRouter(level, event, details = {}) {
    if (!logger || typeof logger[level] !== "function") {
      return;
    }
    logger[level](event, details);
  }

  function hasSafetyConfirm(request) {
    const value = String(
      request?.headers?.["x-pact-safety-confirm"] ||
        request?.headers?.["x-pact-confirm"] ||
        ""
    ).toLowerCase();
    return ["1", "true", "yes"].includes(value);
  }

  function requireSafetyConfirm(request, response) {
    if (hasSafetyConfirm(request)) {
      return true;
    }
    logRouter("warn", "tool_management.http.confirmation_required", {
      requestId: request?.__pactRequestId || ""
    });
    sendJson(response, 403, {
      schemaVersion: "v0.0.1:schema:definition-1",
      error: {
        code: "confirmation_required",
        message: "Tool management grant changes require x-pact-safety-confirm: true."
      }
    });
    return false;
  }

  async function requireConsole(request, response, method, url, scopes = ["runtime:admin"]) {
    const authorization = await authorizeConsole({
      securityPermissions,
      request,
      method,
      url,
      requiredScopes: scopes
    });
    if (!authorization.ok) {
      logRouter("warn", "tool_management.http.denied", {
        requestId: request?.__pactRequestId || "",
        method,
        route: url.pathname,
        scopes,
        status: authorization.status || 403,
        error: authorization.error || ""
      });
      sendAuthorizationDenied(response, authorization);
      return null;
    }
    logRouter("debug", "tool_management.http.authorized", {
      requestId: request?.__pactRequestId || "",
      method,
      route: url.pathname,
      scopes,
      userId: authorization.session?.user?.userId || "",
      roleId: authorization.session?.user?.roleId || ""
    });
    return authorization;
  }

  async function handleToolManagementHttpRequest({ request, response, requestBody, url, method }) {
    const isToolManagementRequest = url.pathname.startsWith(TOOL_MANAGEMENT_API_PREFIX);
    const isAgentRelayRequest = url.pathname.startsWith(AGENT_RELAY_API_PREFIX);
    if (!isToolManagementRequest && !isAgentRelayRequest) {
      return false;
    }
    const suffix = isAgentRelayRequest ? pathAfterAgentRelayPrefix(url.pathname) : pathAfterPrefix(url.pathname);
    const normalizedMethod = String(method || "GET").toUpperCase();
    const startedAt = Date.now();
    logRouter("info", "tool_management.http.requested", {
      requestId: request?.__pactRequestId || "",
      method: normalizedMethod,
      route: url.pathname,
      suffix,
      query: Object.fromEntries(url.searchParams.entries()),
      bodyBytes: requestBody?.length || 0
    });

    async function complete(status, payload = {}) {
      logRouter(status >= 400 ? "warn" : "info", "tool_management.http.completed", {
        requestId: request?.__pactRequestId || "",
        method: normalizedMethod,
        route: url.pathname,
        suffix,
        status,
        durationMs: Date.now() - startedAt,
        payload: summarizeForLog(payload, { maxDepth: 3, maxArrayItems: 4, maxObjectKeys: 20 })
      });
      sendJson(response, status, payload);
      return true;
    }

    async function completeText(status, text, contentType = "text/plain; charset=utf-8") {
      logRouter(status >= 400 ? "warn" : "info", "tool_management.http.completed", {
        requestId: request?.__pactRequestId || "",
        method: normalizedMethod,
        route: url.pathname,
        suffix,
        status,
        durationMs: Date.now() - startedAt,
        responseBytes: Buffer.byteLength(String(text || ""), "utf8")
      });
      response.writeHead(status, { "content-type": contentType });
      response.end(String(text || ""));
      return true;
    }

    try {
    if (isAgentRelayRequest) {
      const routed = routeAcpAgentRelayRequest({
        method: normalizedMethod,
        suffix,
        url,
        requestBody
      });
      if (!routed) {
        return complete(404, {
          schemaVersion: "v0.0.1:schema:definition-1",
          error: {
            code: "agent_relay_route_not_found",
            message: "ACP agent relay route not found.",
            details: { path: suffix }
          }
        });
      }
      const tool = platform.registry.getToolByOperationId?.(routed.operationId);
      if (!tool) {
        return complete(404, {
          schemaVersion: "v0.0.1:schema:definition-1",
          error: {
            code: "agent_relay_tool_not_exposed",
            message: "ACP agent relay operation is not exposed as an agent tool."
          }
        });
      }
      const result = await platform.runtime.executeTool({
        toolId: tool.id,
        input: routed.input,
        request,
        context: {
          transport: "agent-relay-http",
          operationId: routed.operationId,
          route: url.pathname
        }
      });
      return complete(result.status || 500, result.payload);
    }

    if (normalizedMethod === "GET" && suffix === "/catalog") {
      if (!(await requireConsole(request, response, normalizedMethod, url, ["console:read"]))) {
        return true;
      }
      return complete(200, platform.catalog());
    }

    if (normalizedMethod === "GET" && suffix.startsWith("/catalog/")) {
      if (!(await requireConsole(request, response, normalizedMethod, url, ["console:read"]))) {
        return true;
      }
      const toolId = decodeURIComponent(suffix.slice("/catalog/".length));
      const tool = platform.registry.getTool(toolId);
      if (!tool) {
        return complete(404, {
          schemaVersion: "v0.0.1:schema:definition-1",
          error: { code: "unknown_tool", message: "Tool is not registered.", details: { toolId } }
        });
      }
      return complete(200, { schemaVersion: "v0.0.1:schema:definition-1", tool });
    }

    if (normalizedMethod === "GET" && suffix === "/toolsets") {
      if (!(await requireConsole(request, response, normalizedMethod, url, ["console:read"]))) {
        return true;
      }
      return complete(200, { schemaVersion: "v0.0.1:schema:definition-1", toolsets: platform.registry.listToolsets() });
    }

    if (normalizedMethod === "POST" && suffix === "/toolsets/resolve") {
      if (!(await requireConsole(request, response, normalizedMethod, url, ["console:read"]))) {
        return true;
      }
      const payload = parseJsonBody(requestBody);
      return complete(200, {
        schemaVersion: "v0.0.1:schema:definition-1",
        result: platform.registry.resolveToolset(payload)
      });
    }

    if (normalizedMethod === "GET" && suffix === "/profiles") {
      if (!(await requireConsole(request, response, normalizedMethod, url, ["console:read"]))) {
        return true;
      }
      return complete(200, { schemaVersion: "v0.0.1:schema:definition-1", profiles: platform.registry.listProfiles() });
    }

    if (normalizedMethod === "POST" && (suffix === "/policy/evaluate" || suffix === "/policy/preview")) {
      if (!(await requireConsole(request, response, normalizedMethod, url, ["console:read"]))) {
        return true;
      }
      const payload = parseJsonBody(requestBody);
      return complete(200, {
        schemaVersion: "v0.0.1:schema:definition-1",
        decision: platform.policyEngine.preview(payload)
      });
    }

    if (normalizedMethod === "POST" && (suffix === "/execute" || suffix === "/dry-run")) {
      const payload = parseJsonBody(requestBody);
      const result = await platform.runtime.executeTool({
        toolId: payload.toolId,
        input: payload.input || {},
        request,
        context: sanitizeExternalToolContext(payload.context, { transport: "tool-http" }),
        dryRun: suffix === "/dry-run" || payload.dryRun === true
      });
      return complete(result.status || 500, result.payload);
    }

    if (normalizedMethod === "POST" && suffix === "/batch") {
      const payload = parseJsonBody(requestBody);
      const calls = Array.isArray(payload.calls) ? payload.calls : [];
      const results = [];
      for (const call of calls) {
        results.push(
          (await platform.runtime.executeTool({
            toolId: call.toolId,
            input: call.input || {},
            request,
            context: sanitizeExternalToolContext({
              ...plainObject(payload.context),
              ...plainObject(call.context)
            }, { transport: "tool-http-batch" }),
            dryRun: payload.dryRun === true || call.dryRun === true
          })).payload
        );
      }
      return complete(200, { schemaVersion: "v0.0.1:schema:definition-1", results });
    }

    if (normalizedMethod === "GET" && suffix === "/grants") {
      if (!(await requireConsole(request, response, normalizedMethod, url))) {
        return true;
      }
      return complete(200, { schemaVersion: "v0.0.1:schema:definition-1", grants: platform.store.listGrants() });
    }

    if (normalizedMethod === "POST" && suffix === "/grants") {
      if (!(await requireConsole(request, response, normalizedMethod, url))) {
        return true;
      }
      if (!requireSafetyConfirm(request, response)) {
        return true;
      }
      const result = await platform.store.createGrant(parseJsonBody(requestBody));
      return complete(201, {
        schemaVersion: "v0.0.1:schema:definition-1",
        grant: result.grant,
        token: result.token
      });
    }

    const grantRotateMatch = suffix.match(/^\/grants\/([^/]+)\/rotate$/);
    if (normalizedMethod === "POST" && grantRotateMatch) {
      if (!(await requireConsole(request, response, normalizedMethod, url))) {
        return true;
      }
      if (!requireSafetyConfirm(request, response)) {
        return true;
      }
      const result = await platform.store.rotateGrantToken(decodeURIComponent(grantRotateMatch[1]));
      if (!result) {
        return complete(404, { schemaVersion: "v0.0.1:schema:definition-1", error: { code: "grant_not_found", message: "Grant not found." } });
      }
      return complete(200, { schemaVersion: "v0.0.1:schema:definition-1", grant: result.grant, token: result.token });
    }

    const grantRevokeMatch = suffix.match(/^\/grants\/([^/]+)\/revoke$/);
    if (normalizedMethod === "POST" && grantRevokeMatch) {
      if (!(await requireConsole(request, response, normalizedMethod, url))) {
        return true;
      }
      if (!requireSafetyConfirm(request, response)) {
        return true;
      }
      const payload = parseJsonBody(requestBody);
      const grant = await platform.store.revokeGrant(decodeURIComponent(grantRevokeMatch[1]), payload.reason || "");
      if (!grant) {
        return complete(404, { schemaVersion: "v0.0.1:schema:definition-1", error: { code: "grant_not_found", message: "Grant not found." } });
      }
      return complete(200, { schemaVersion: "v0.0.1:schema:definition-1", grant });
    }

    const grantUpdateMatch = suffix.match(/^\/grants\/([^/]+)$/);
    if (normalizedMethod === "POST" && grantUpdateMatch) {
      if (!(await requireConsole(request, response, normalizedMethod, url))) {
        return true;
      }
      if (!requireSafetyConfirm(request, response)) {
        return true;
      }
      const grant = platform.store.updateGrant(decodeURIComponent(grantUpdateMatch[1]), parseJsonBody(requestBody));
      if (!grant) {
        return complete(404, { schemaVersion: "v0.0.1:schema:definition-1", error: { code: "grant_not_found", message: "Grant not found." } });
      }
      await platform.store.flushChangeNotifications?.();
      return complete(200, { schemaVersion: "v0.0.1:schema:definition-1", grant });
    }

    if (normalizedMethod === "GET" && suffix === "/audit") {
      if (!(await requireConsole(request, response, normalizedMethod, url, ["console:read"]))) {
        return true;
      }
      return complete(200, {
        schemaVersion: "v0.0.1:schema:definition-1",
        items: platform.store.listAudit({
          limit: Number(url.searchParams.get("limit") || 100),
          toolId: url.searchParams.get("toolId") || "",
          grantId: url.searchParams.get("grantId") || "",
          status: url.searchParams.get("status") || ""
        })
      });
    }

    if (normalizedMethod === "GET" && suffix.startsWith("/audit/")) {
      if (!(await requireConsole(request, response, normalizedMethod, url, ["console:read"]))) {
        return true;
      }
      const toolExecutionId = decodeURIComponent(suffix.slice("/audit/".length));
      const audit = platform.store.getAudit(toolExecutionId);
      if (!audit) {
        return complete(404, { schemaVersion: "v0.0.1:schema:definition-1", error: { code: "audit_not_found", message: "Audit record not found." } });
      }
      return complete(200, { schemaVersion: "v0.0.1:schema:definition-1", audit });
    }

    if (normalizedMethod === "GET" && suffix === "/metrics/summary") {
      if (!(await requireConsole(request, response, normalizedMethod, url, ["console:read"]))) {
        return true;
      }
      return complete(200, {
        schemaVersion: "v0.0.1:schema:definition-1",
        metrics: platform.store.metricsSummary({
          limit: Number(url.searchParams.get("limit") || 2000),
          since: url.searchParams.get("since") || "",
          until: url.searchParams.get("until") || "",
          toolId: url.searchParams.get("toolId") || url.searchParams.get("tool-id") || "",
          grantId: url.searchParams.get("grantId") || url.searchParams.get("grant-id") || "",
          profileId: url.searchParams.get("profileId") || url.searchParams.get("profile-id") || "",
          route: url.searchParams.get("route") || "",
          transport: url.searchParams.get("transport") || "",
          status: url.searchParams.get("status") || "",
          statusCode: url.searchParams.get("statusCode") || url.searchParams.get("status-code") || "",
          completionStatus: url.searchParams.get("completionStatus") || url.searchParams.get("completion-status") || "",
          bucketSeconds: Number(url.searchParams.get("bucketSeconds") || url.searchParams.get("bucket-seconds") || 0)
        })
      });
    }

    if (normalizedMethod === "GET" && suffix === "/metrics/export") {
      if (!(await requireConsole(request, response, normalizedMethod, url, ["console:read"]))) {
        return true;
      }
      return complete(200, {
        schemaVersion: "v0.0.1:schema:definition-1",
        export: platform.store.metricsExport({
          limit: Number(url.searchParams.get("limit") || 2000),
          since: url.searchParams.get("since") || "",
          until: url.searchParams.get("until") || "",
          kind: url.searchParams.get("kind") || "",
          toolId: url.searchParams.get("toolId") || url.searchParams.get("tool-id") || "",
          grantId: url.searchParams.get("grantId") || url.searchParams.get("grant-id") || "",
          profileId: url.searchParams.get("profileId") || url.searchParams.get("profile-id") || "",
          route: url.searchParams.get("route") || "",
          transport: url.searchParams.get("transport") || "",
          status: url.searchParams.get("status") || "",
          statusCode: url.searchParams.get("statusCode") || url.searchParams.get("status-code") || "",
          completionStatus: url.searchParams.get("completionStatus") || url.searchParams.get("completion-status") || ""
        })
      });
    }

    if (normalizedMethod === "GET" && suffix === "/metrics/health") {
      if (!(await requireConsole(request, response, normalizedMethod, url, ["console:read"]))) {
        return true;
      }
      return complete(200, {
        schemaVersion: "v0.0.1:schema:definition-1",
        health: platform.store.metricsHealth({
          windowSeconds: Number(url.searchParams.get("windowSeconds") || url.searchParams.get("window-seconds") || 300),
          maxRequestErrorRate: url.searchParams.get("maxRequestErrorRate") ||
            url.searchParams.get("max-request-error-rate") || "",
          maxToolFailureRate: url.searchParams.get("maxToolFailureRate") ||
            url.searchParams.get("max-tool-failure-rate") || "",
          maxDeniedRate: url.searchParams.get("maxDeniedRate") || url.searchParams.get("max-denied-rate") || "",
          maxRequestP95Ms: url.searchParams.get("maxRequestP95Ms") ||
            url.searchParams.get("max-request-p95-ms") || "",
          maxToolP95Ms: url.searchParams.get("maxToolP95Ms") || url.searchParams.get("max-tool-p95-ms") || "",
          minRequests: Number(url.searchParams.get("minRequests") || url.searchParams.get("min-requests") || 0)
        })
      });
    }

    if (normalizedMethod === "GET" && suffix === "/metrics/prometheus") {
      if (!(await requireConsole(request, response, normalizedMethod, url, ["console:read"]))) {
        return true;
      }
      return completeText(200, platform.store.metricsPrometheus({
        windowSeconds: Number(url.searchParams.get("windowSeconds") || url.searchParams.get("window-seconds") || 300),
        maxRequestErrorRate: url.searchParams.get("maxRequestErrorRate") ||
          url.searchParams.get("max-request-error-rate") || "",
        maxToolFailureRate: url.searchParams.get("maxToolFailureRate") ||
          url.searchParams.get("max-tool-failure-rate") || "",
        maxDeniedRate: url.searchParams.get("maxDeniedRate") || url.searchParams.get("max-denied-rate") || "",
        maxRequestP95Ms: url.searchParams.get("maxRequestP95Ms") ||
          url.searchParams.get("max-request-p95-ms") || "",
        maxToolP95Ms: url.searchParams.get("maxToolP95Ms") || url.searchParams.get("max-tool-p95-ms") || "",
        minRequests: Number(url.searchParams.get("minRequests") || url.searchParams.get("min-requests") || 0)
      }), "text/plain; version=0.0.4; charset=utf-8");
    }

    if (normalizedMethod === "GET" && suffix === "/metrics/storage") {
      if (!(await requireConsole(request, response, normalizedMethod, url, ["console:read"]))) {
        return true;
      }
      return complete(200, {
        schemaVersion: "v0.0.1:schema:definition-1",
        storage: platform.store.metricsStorageSummary()
      });
    }

    if (normalizedMethod === "POST" && suffix === "/metrics/prune") {
      if (!(await requireConsole(request, response, normalizedMethod, url))) {
        return true;
      }
      if (!requireSafetyConfirm(request, response)) {
        return true;
      }
      const payload = parseJsonBody(requestBody);
      return complete(200, {
        schemaVersion: "v0.0.1:schema:definition-1",
        prune: platform.store.pruneMetrics({
          olderThan: payload.olderThan || payload.older_than || "",
          retentionDays: payload.retentionDays ?? payload.retention_days ?? 0,
          maxRows: payload.maxRows ?? payload.max_rows ?? 0,
          maxToolMetricRows: payload.maxToolMetricRows ?? payload.max_tool_metric_rows ?? 0,
          maxHttpRequestMetricRows: payload.maxHttpRequestMetricRows ?? payload.max_http_request_metric_rows ?? 0,
          dryRun: payload.dryRun === true || payload.dry_run === true
        })
      });
    }

    if (normalizedMethod === "GET" && suffix === "/events") {
      if (!(await requireConsole(request, response, normalizedMethod, url, ["console:read"]))) {
        return true;
      }
      return complete(200, {
        schemaVersion: "v0.0.1:schema:definition-1",
        events: platform.store.listAudit({ limit: Number(url.searchParams.get("limit") || 100) })
      });
    }

    if (normalizedMethod === "GET" && suffix === "/pending-operations") {
      if (!(await requireConsole(request, response, normalizedMethod, url, ["console:read"]))) {
        return true;
      }
      return complete(200, {
        schemaVersion: "v0.0.1:schema:definition-1",
        pendingOperations: platform.store.listPendingOperations({
          status: url.searchParams.get("status") || "pending",
          limit: Number(url.searchParams.get("limit") || 100)
        })
      });
    }

    const pendingResolveMatch = suffix.match(/^\/pending-operations\/([^/]+)\/resolve$/);
    if (normalizedMethod === "POST" && pendingResolveMatch) {
      if (!(await requireConsole(request, response, normalizedMethod, url))) {
        return true;
      }
      if (!requireSafetyConfirm(request, response)) {
        return true;
      }
      if (!platform.runtime?.resumePendingOperation) {
        return complete(503, {
          schemaVersion: "v0.0.1:schema:definition-1",
          error: {
            code: "pending_operation_runtime_unavailable",
            message: "Pending operation runtime is unavailable."
          }
        });
      }
      const payload = parseJsonBody(requestBody);
      const result = await platform.runtime.resumePendingOperation({
        pendingOperationId: decodeURIComponent(pendingResolveMatch[1]),
        resolution: payload.resolution || payload.decision || "",
        request,
        context: sanitizeExternalToolContext(payload.context, { transport: "tool-http-approval" }),
        resolvedBy: payload.resolvedBy || payload.reviewer || "console",
        reason: payload.reason || ""
      });
      return complete(result.status || 500, result.payload);
    }

    return complete(404, {
      schemaVersion: "v0.0.1:schema:definition-1",
      error: {
        code: "tool_management_route_not_found",
        message: "Tool management route not found.",
        details: { path: suffix }
      }
    });
    } catch (error) {
      logRouter("error", "tool_management.http.failed", {
        requestId: request?.__pactRequestId || "",
        method: normalizedMethod,
        route: url.pathname,
        suffix,
        durationMs: Date.now() - startedAt,
        error: summarizeError(error)
      });
      throw error;
    }
  }

  return {
    handleToolManagementHttpRequest
  };
}
