import { SERVER_API_OPERATIONS } from "../../../../common/operation-dispatcher/operation-registry.mjs";
import {
  normalizeAcpSourceAuthenticationContext,
  sourceAuthContextForOperation
} from "./acp-source-auth-context.mjs";

function nowIso() {
  return new Date().toISOString();
}

function asText(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function asObject(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function uniqueStrings(...values) {
  const output = [];
  for (const value of values) {
    const items = Array.isArray(value) ? value : asText(value).split(/[,\s]+/);
    for (const item of items) {
      const text = asText(item);
      if (text && !output.includes(text)) {
        output.push(text);
      }
    }
  }
  return output;
}

function operationMap(operations = []) {
  return new Map(
    asArray(operations)
      .filter((operation) => operation && typeof operation === "object")
      .map((operation) => [asText(operation.id), operation])
      .filter(([id]) => Boolean(id))
  );
}

function fallbackOperation(operationId = "") {
  const id = asText(operationId);
  const readOnly = id.endsWith(".list") || id.endsWith(".get");
  return {
    id,
    feature: "tool_management",
    requiredScopes: readOnly ? ["agent_relay:view"] : ["agent_relay:operate"],
    readOnly,
    safety: {
      risk: readOnly ? "read_only" : "safe_write",
      requiresConfirmation: false
    },
    aspects: ["agent-relay", "source-acp"]
  };
}

function defaultSubject(input = {}, context = {}) {
  const authenticated = normalizeAcpSourceAuthenticationContext({
    ...asObject(context),
    sourceAuthContext: input.sourceAuthContext || context.sourceAuthContext,
    sourceIdentity: input.sourceIdentity || context.sourceIdentity,
    authSession: input.authSession || context.authSession,
    grant: input.grant || context.grant,
    profile: input.profile || context.profile,
    authorizationSubject: input.authorizationSubject || context.authorizationSubject
  });
  if (authenticated.sourceIdentityTrusted === true && (authenticated.sourceSubjectId || authenticated.sourceId)) {
    const compatibilityScopes = authenticated.authContextTrusted === true
      ? []
      : uniqueStrings(input.sourceScopes || context.sourceScopes);
    const compatibilityCapabilities = authenticated.authContextTrusted === true
      ? []
      : uniqueStrings(input.sourceCapabilities || context.sourceCapabilities);
    return {
      type: "source-agent",
      subjectId: authenticated.sourceSubjectId || authenticated.sourceId,
      username: authenticated.sourceSubjectId || authenticated.sourceId,
      scopes: uniqueStrings(authenticated.sourceScopes, compatibilityScopes),
      capabilities: uniqueStrings(authenticated.sourceCapabilities, compatibilityCapabilities),
      agentProfileId: authenticated.agentProfileId || "",
      metadata: sourceAuthContextForOperation(authenticated)
    };
  }
  const raw = asObject(input.authorizationSubject || input.sourceSubject || context.authorizationSubject || context.sourceSubject);
  if (Object.keys(raw).length > 0) {
    return raw;
  }
  const sourceSubjectId = asText(authenticated.sourceSubjectId || input.sourceSubjectId || input.source_subject_id || context.sourceSubjectId);
  const sourceId = asText(authenticated.sourceId || input.sourceId || input.source_id || context.sourceId);
  if (!sourceSubjectId && !sourceId) {
    return null;
  }
  return {
    type: "source-agent",
    subjectId: sourceSubjectId || sourceId,
    username: sourceSubjectId || sourceId,
    scopes: uniqueStrings(authenticated.sourceScopes, input.sourceScopes || context.sourceScopes),
    capabilities: uniqueStrings(authenticated.sourceCapabilities, input.sourceCapabilities || context.sourceCapabilities),
    agentProfileId: authenticated.agentProfileId || ""
  };
}

function normalizeDecision(decision = {}, operationId = "") {
  const input = asObject(decision);
  const effect = asText(input.effect, input.allowed === true ? "allow" : "deny");
  return {
    ...input,
    protocolVersion: asText(input.protocolVersion, "pact.authorization.v1"),
    decisionId: asText(input.decisionId, `source_guard_${Date.now().toString(36)}`),
    operationId: asText(input.operationId, operationId),
    effect,
    allowed: input.allowed === true || effect === "allow" || effect === "dry_run_only",
    reasonCode: asText(input.reasonCode, effect === "allow" ? "allowed" : "source_operation_denied"),
    redactedReason: asText(
      input.redactedReason,
      effect === "allow" ? "Source ACP operation allowed." : "Source ACP operation denied."
    ),
    missingScopes: uniqueStrings(input.missingScopes),
    missingToolsets: uniqueStrings(input.missingToolsets),
    missingCapabilities: uniqueStrings(input.missingCapabilities),
    evaluatedLayers: uniqueStrings(input.evaluatedLayers),
    createdAt: asText(input.createdAt, nowIso())
  };
}

export class AcpSourceOperationGuard {
  constructor({
    securityPermissions = null,
    operations = SERVER_API_OPERATIONS,
    subject = null,
    actor = null,
    authSession = null,
    grant = null,
    profile = null,
    request = null,
    context = {},
    grantRequired = false,
    enforceConfirmation = false,
    appendDecision = true
  } = {}) {
    this.securityPermissions = securityPermissions;
    this.operationsById = operationMap(operations);
    this.subject = subject;
    this.actor = actor;
    this.authSession = authSession;
    this.grant = grant;
    this.profile = profile;
    this.request = request;
    this.context = asObject(context);
    this.grantRequired = grantRequired === true;
    this.enforceConfirmation = enforceConfirmation === true;
    this.appendDecision = appendDecision !== false;
  }

  operationFor(operationId = "") {
    const id = asText(operationId);
    return this.operationsById.get(id) || fallbackOperation(id);
  }

  async preflight({ operationId = "", input = {}, context = {} } = {}) {
    if (
      !this.securityPermissions ||
      (typeof this.securityPermissions.evaluatePolicy !== "function" &&
        typeof this.securityPermissions.authorizeOperation !== "function")
    ) {
      return { ok: true, decision: null, operation: this.operationFor(operationId) };
    }
    const operation = this.operationFor(operationId);
    const rawContext = asObject(context);
    const authSession = this.authSession || rawContext.authSession || this.context.authSession || null;
    const grant = this.grant || rawContext.grant || this.context.grant || null;
    const profile = this.profile || rawContext.profile || this.context.profile || null;
    const authenticated = normalizeAcpSourceAuthenticationContext({
      ...this.context,
      ...rawContext,
      sourceAuthContext: input.sourceAuthContext || rawContext.sourceAuthContext || this.context.sourceAuthContext,
      sourceIdentity: input.sourceIdentity || rawContext.sourceIdentity || this.context.sourceIdentity,
      authSession,
      grant,
      profile,
      authorizationSubject: this.subject || input.authorizationSubject || rawContext.authorizationSubject || this.context.authorizationSubject
    });
    const sourceAuthContext = sourceAuthContextForOperation(authenticated);
    const mergedContext = {
      ...this.context,
      ...rawContext,
      transport: asText(rawContext.transport || this.context.transport, "acp-source"),
      sourceId: asText(authenticated.sourceId || input.sourceId || input.source_id || rawContext.sourceId || this.context.sourceId),
      sourceSessionId: asText(authenticated.sourceSessionId || input.sourceSessionId || input.source_session_id || rawContext.sourceSessionId || this.context.sourceSessionId),
      sourceSubjectId: asText(authenticated.sourceSubjectId || input.sourceSubjectId || input.source_subject_id || rawContext.sourceSubjectId || this.context.sourceSubjectId),
      workspaceId: asText(authenticated.workspaceId || input.workspaceId || input.workspace_id || rawContext.workspaceId || this.context.workspaceId),
      virtualAgentId: asText(authenticated.virtualAgentId || input.virtualAgentId || input.virtual_agent_id || rawContext.virtualAgentId || this.context.virtualAgentId),
      agentProfileId: asText(authenticated.agentProfileId || input.agentProfileId || rawContext.agentProfileId || this.context.agentProfileId),
      sourceScopes: authenticated.authContextTrusted === true
        ? uniqueStrings(authenticated.sourceScopes)
        : uniqueStrings(authenticated.sourceScopes, input.sourceScopes || rawContext.sourceScopes || this.context.sourceScopes),
      sourceCapabilities: authenticated.authContextTrusted === true
        ? uniqueStrings(authenticated.sourceCapabilities)
        : uniqueStrings(authenticated.sourceCapabilities, input.sourceCapabilities || rawContext.sourceCapabilities || this.context.sourceCapabilities),
      ...(Object.keys(sourceAuthContext).length > 0
        ? {
            sourceAuthContext,
            authenticatedSourceIdentity: sourceAuthContext
          }
        : {})
    };
    const authorization = typeof this.securityPermissions.authorizeOperation === "function"
      ? await this.securityPermissions.authorizeOperation({
          request: this.request || context.request || null,
          method: "ACP",
          url: { pathname: operation.rpc?.syntheticPath || operation.http?.path || operation.id },
          operation,
          input,
          context: mergedContext
        })
      : null;
    if (authorization && authorization.ok === false) {
      const decision = normalizeDecision(authorization.authorizationDecision || {
        effect: "deny",
        allowed: false,
        operationId: operation.id,
        reasonCode: authorization.reasonCode || "source_operation_denied",
        redactedReason: authorization.error || "Source ACP operation denied.",
        missingScopes: authorization.missingScopes || [],
        missingToolsets: authorization.missingToolsets || [],
        missingCapabilities: authorization.missingCapabilities || [],
        evaluatedLayers: ["source_acp_authorize_operation"]
      }, operation.id);
      if (this.appendDecision && typeof this.securityPermissions.appendDecision === "function") {
        this.securityPermissions.appendDecision(decision);
      }
      return {
        ok: false,
        decision,
        operation,
        error: {
          code: decision.reasonCode || "source_operation_denied",
          message: decision.redactedReason || "Source ACP operation denied.",
          status: authorization.status || (decision.reasonCode === "confirmation_required" ? 409 : 403),
          details: {
            operationId: operation.id,
            decisionId: decision.decisionId,
            missingScopes: decision.missingScopes,
            missingToolsets: decision.missingToolsets,
            missingCapabilities: decision.missingCapabilities,
            evaluatedLayers: decision.evaluatedLayers
          }
        }
      };
    }
    if (authorization && authorization.authorizationDecision && typeof this.securityPermissions.evaluatePolicy !== "function") {
      const decision = normalizeDecision(authorization.authorizationDecision, operation.id);
      if (this.appendDecision && typeof this.securityPermissions.appendDecision === "function") {
        this.securityPermissions.appendDecision(decision);
      }
      return { ok: true, decision, operation };
    }

    const rawDecision = await this.securityPermissions.evaluatePolicy({
      operation,
      subject: this.subject || defaultSubject(input, mergedContext),
      actor: this.actor,
      authSession,
      grant,
      profile,
      input,
      request: this.request || context.request || null,
      context: mergedContext,
      grantRequired: this.grantRequired,
      enforceConfirmation: this.enforceConfirmation
    });
    const decision = normalizeDecision(rawDecision, operation.id);
    if (this.appendDecision && typeof this.securityPermissions.appendDecision === "function") {
      this.securityPermissions.appendDecision(decision);
    }
    if (!decision.allowed) {
      return {
        ok: false,
        decision,
        operation,
        error: {
          code: decision.reasonCode || "source_operation_denied",
          message: decision.redactedReason || "Source ACP operation denied.",
          status: decision.reasonCode === "confirmation_required" ? 409 : 403,
          details: {
            operationId: operation.id,
            decisionId: decision.decisionId,
            missingScopes: decision.missingScopes,
            missingToolsets: decision.missingToolsets,
            missingCapabilities: decision.missingCapabilities,
            evaluatedLayers: decision.evaluatedLayers
          }
        }
      };
    }
    return { ok: true, decision, operation };
  }
}

export function createAcpSourceOperationGuard(options = {}) {
  return new AcpSourceOperationGuard(options);
}
