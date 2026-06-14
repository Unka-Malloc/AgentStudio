import { createHash, randomUUID } from "node:crypto";

export const KNOWLEDGE_ACCESS_PROTOCOL_VERSION = "v0.0.1:knowledge:access-1";
export const AGENT_LIBRARY_PROTOCOL_VERSION = "v0.0.1:agent:library-1";

export const ACCESS_MODES = Object.freeze([
  "deny",
  "discoverOnly",
  "metadataOnly",
  "controlledView",
  "citeOnly",
  "copyToContext",
  "exportAllowed",
  "checkoutAllowed"
]);

export const REQUESTED_EGRESS = Object.freeze([
  "searchResult",
  "evidenceRead",
  "contextBundle",
  "artifactWrite",
  "exportFile",
  "distillationInput",
  "distillationOutput",
  "memoryWrite",
  "toolCall",
  "evaluationSample"
]);

const EGRESS_ACCESS_MODE = Object.freeze({
  searchResult: ["discoverOnly", "metadataOnly", "controlledView", "citeOnly", "copyToContext", "exportAllowed", "checkoutAllowed"],
  evidenceRead: ["controlledView", "citeOnly", "copyToContext", "exportAllowed", "checkoutAllowed"],
  contextBundle: ["copyToContext", "exportAllowed", "checkoutAllowed"],
  artifactWrite: ["copyToContext", "exportAllowed", "checkoutAllowed"],
  exportFile: ["exportAllowed", "checkoutAllowed"],
  distillationInput: ["copyToContext", "exportAllowed", "checkoutAllowed"],
  distillationOutput: ["exportAllowed", "checkoutAllowed"],
  memoryWrite: ["checkoutAllowed"],
  toolCall: ["copyToContext", "exportAllowed", "checkoutAllowed"],
  evaluationSample: ["copyToContext", "exportAllowed", "checkoutAllowed"]
});

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === "") return [];
  return [value];
}

function text(value) {
  return String(value ?? "").trim();
}

function shallowObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function stableHash(value, length = 20) {
  return createHash("sha256").update(String(value || "")).digest("hex").slice(0, length);
}

function stableId(prefix, input) {
  return `${prefix}::${stableHash(JSON.stringify(input))}`;
}

function normalizeSet(value) {
  return new Set(asArray(value).map(text).filter(Boolean));
}

function intersects(allowed, requested) {
  if (!allowed.size) return true;
  return requested.some((item) => allowed.has(text(item)));
}

function accessRank(mode) {
  const index = ACCESS_MODES.indexOf(mode);
  return index >= 0 ? index : 0;
}

function weakerMode(left, right) {
  return accessRank(left) <= accessRank(right) ? left : right;
}

function normalizeAccessMode(mode = "") {
  return ACCESS_MODES.includes(mode) ? mode : "deny";
}

function normalizeRequestedEgress(value = "") {
  const normalized = text(value || "searchResult");
  return REQUESTED_EGRESS.includes(normalized) ? normalized : "searchResult";
}

function subjectCandidates(request = {}) {
  return [
    request.subject?.subjectId,
    request.subject?.id,
    request.subject,
    request.operatorId,
    request.libraryCardId
  ].map(text).filter(Boolean);
}

function agentProfileCandidates(request = {}) {
  return [
    request.agentProfile?.profileId,
    request.agentProfile?.id,
    request.agentProfile
  ].map(text).filter(Boolean);
}

function targetRefsFromRequest(request = {}) {
  return asArray(request.targetRefs).map((target) => {
    if (typeof target === "string") {
      return {
        ref: target,
        refType: "unknown"
      };
    }
    const object = shallowObject(target);
    return {
      ref: text(object.ref || object.id || object.assetId || object.evidenceId || object.documentId),
      refType: text(object.refType || object.type || "unknown"),
      sourceRange: shallowObject(object.sourceRange),
      metadata: shallowObject(object.metadata)
    };
  }).filter((target) => target.ref);
}

export function createDerivedKnowledgeView(input = {}) {
  const upstreamKnowledgeRef = text(input.upstreamKnowledgeRef || input.upstreamRef || stableId("upstream", input));
  const derivedViewRef = text(input.derivedViewRef || stableId("derived_view", {
    upstreamKnowledgeRef,
    workspaceId: input.workspaceId,
    view: input.view || input.title
  }));
  const derivedKnowledgeSpace = text(input.derivedKnowledgeSpace || input.workspaceId || "default");
  return {
    upstreamKnowledgeRef,
    upstreamPolicyRef: text(input.upstreamPolicyRef || ""),
    derivedViewRef,
    derivedKnowledgeSpace,
    authorizationOverlay: shallowObject(input.authorizationOverlay),
    dataClass: text(input.dataClass || "internal"),
    sensitivity: text(input.sensitivity || "normal"),
    workspaceScope: asArray(input.workspaceScope || input.workspaceId).map(text).filter(Boolean),
    sourceScope: asArray(input.sourceScope).map(text).filter(Boolean),
    owner: text(input.owner || ""),
    retention: text(input.retention || ""),
    allowedSubjects: asArray(input.allowedSubjects).map(text).filter(Boolean),
    allowedAgentProfiles: asArray(input.allowedAgentProfiles).map(text).filter(Boolean),
    allowedActions: asArray(input.allowedActions || ["discover", "read"]).map(text).filter(Boolean),
    checkoutPolicy: {
      allowRetain: input.checkoutPolicy?.allowRetain === true,
      allowShare: input.checkoutPolicy?.allowShare === true,
      expiresInSeconds: Number(input.checkoutPolicy?.expiresInSeconds || 0),
      revocationPolicy: text(input.checkoutPolicy?.revocationPolicy || "revoke-on-policy-change")
    },
    refs: asArray(input.refs).map((ref) => (typeof ref === "string" ? { ref } : shallowObject(ref))).filter((ref) => text(ref.ref || ref.id))
  };
}

export function createAuthorizationOverlay(input = {}) {
  return {
    overlayId: text(input.overlayId || stableId("authorization_overlay", input)),
    derivedViewRef: text(input.derivedViewRef || ""),
    defaultAccessMode: normalizeAccessMode(input.defaultAccessMode || "deny"),
    defaultActions: asArray(input.defaultActions).map(text).filter(Boolean),
    defaultEgress: asArray(input.defaultEgress).map(text).filter((item) => REQUESTED_EGRESS.includes(item)),
    rules: asArray(input.rules).map((rule, index) => ({
      ruleId: text(rule.ruleId || `rule-${index + 1}`),
      effect: text(rule.effect || "allow") === "deny" ? "deny" : "allow",
      subjects: asArray(rule.subjects).map(text).filter(Boolean),
      workspaces: asArray(rule.workspaces).map(text).filter(Boolean),
      agentProfiles: asArray(rule.agentProfiles).map(text).filter(Boolean),
      actions: asArray(rule.actions).map(text).filter(Boolean),
      egress: asArray(rule.egress).map(text).filter((item) => REQUESTED_EGRESS.includes(item)),
      targetRefs: asArray(rule.targetRefs).map(text).filter(Boolean),
      accessMode: normalizeAccessMode(rule.accessMode || input.defaultAccessMode || "controlledView"),
      reason: text(rule.reason || "")
    }))
  };
}

function matchingRules({ request, overlay, targetRefs, requestedAction, requestedEgress }) {
  const subjects = subjectCandidates(request);
  const profiles = agentProfileCandidates(request);
  const workspaceId = text(request.workspaceId);
  const targetRefSet = new Set(targetRefs.map((target) => target.ref));
  return asArray(overlay.rules).filter((rule) => {
    const ruleSubjects = normalizeSet(rule.subjects);
    const ruleWorkspaces = normalizeSet(rule.workspaces);
    const ruleProfiles = normalizeSet(rule.agentProfiles);
    const ruleActions = normalizeSet(rule.actions);
    const ruleEgress = normalizeSet(rule.egress);
    const ruleTargets = normalizeSet(rule.targetRefs);
    return (
      intersects(ruleSubjects, subjects) &&
      (!ruleWorkspaces.size || ruleWorkspaces.has(workspaceId)) &&
      intersects(ruleProfiles, profiles) &&
      (!ruleActions.size || ruleActions.has(requestedAction)) &&
      (!ruleEgress.size || ruleEgress.has(requestedEgress)) &&
      (!ruleTargets.size || [...targetRefSet].some((target) => ruleTargets.has(target)))
    );
  });
}

function policyAllowsRequest({ request, view, requestedAction }) {
  const subjects = subjectCandidates(request);
  const profiles = agentProfileCandidates(request);
  const workspaceId = text(request.workspaceId);
  const allowedSubjects = normalizeSet(view.allowedSubjects);
  const allowedProfiles = normalizeSet(view.allowedAgentProfiles);
  const allowedActions = normalizeSet(view.allowedActions);
  const workspaceScope = normalizeSet(view.workspaceScope);
  const reasons = [];
  if (allowedSubjects.size && !subjects.some((subject) => allowedSubjects.has(subject))) {
    reasons.push("subject_not_allowed");
  }
  if (allowedProfiles.size && !profiles.some((profile) => allowedProfiles.has(profile))) {
    reasons.push("agent_profile_not_allowed");
  }
  if (workspaceScope.size && !workspaceScope.has(workspaceId)) {
    reasons.push("workspace_not_allowed");
  }
  if (allowedActions.size && !allowedActions.has(requestedAction)) {
    reasons.push("action_not_allowed");
  }
  return {
    ok: reasons.length === 0,
    reasons
  };
}

function accessModeAllowsEgress(accessMode, requestedEgress) {
  return asArray(EGRESS_ACCESS_MODE[requestedEgress]).includes(accessMode);
}

function loanRequired(requestedEgress, accessMode) {
  return [
    "contextBundle",
    "artifactWrite",
    "exportFile",
    "distillationInput",
    "distillationOutput",
    "memoryWrite",
    "toolCall",
    "evaluationSample"
  ].includes(requestedEgress) || ["copyToContext", "exportAllowed", "checkoutAllowed"].includes(accessMode);
}

function receiptFor({ request, view, allowedRefs, requestedAction, requestedEgress, accessMode, auditId }) {
  return {
    receiptId: stableId("knowledge_access_receipt", {
      libraryCardId: request.libraryCardId,
      subject: request.subject,
      workspaceId: request.workspaceId,
      taskId: request.taskId,
      requestedAction,
      requestedEgress,
      allowedRefs
    }),
    libraryCardId: text(request.libraryCardId),
    subject: request.subject,
    operatorId: text(request.operatorId),
    agentProfile: request.agentProfile,
    workspaceId: text(request.workspaceId),
    taskId: text(request.taskId),
    accessMode,
    requestedAction,
    requestedEgress,
    derivedViewRef: view.derivedViewRef,
    upstreamKnowledgeRef: view.upstreamKnowledgeRef,
    refs: allowedRefs,
    auditId,
    createdAt: new Date().toISOString()
  };
}

function loanFor({ request, view, receipt, requestedEgress, accessMode, auditId }) {
  const expiresInSeconds = Number(view.checkoutPolicy?.expiresInSeconds || 0);
  const issuedAt = new Date();
  return {
    loanRecordId: stableId("loan_record", {
      receiptId: receipt.receiptId,
      requestedEgress,
      accessMode
    }),
    receiptId: receipt.receiptId,
    libraryCardId: receipt.libraryCardId,
    subject: request.subject,
    agentProfile: request.agentProfile,
    workspaceId: receipt.workspaceId,
    taskId: receipt.taskId,
    accessMode,
    requestedEgress,
    canRetain: accessMode === "checkoutAllowed" && view.checkoutPolicy?.allowRetain === true,
    canShare: accessMode === "checkoutAllowed" && view.checkoutPolicy?.allowShare === true,
    refs: receipt.refs,
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresInSeconds > 0 ? new Date(issuedAt.getTime() + expiresInSeconds * 1000).toISOString() : "",
    revocationPolicy: view.checkoutPolicy?.revocationPolicy || "revoke-on-policy-change",
    auditId
  };
}

export function evaluateKnowledgeAccess(request = {}, input = {}) {
  const view = createDerivedKnowledgeView(input.view || input.asset || input);
  const overlay = createAuthorizationOverlay({
    derivedViewRef: view.derivedViewRef,
    ...shallowObject(view.authorizationOverlay),
    ...shallowObject(input.authorizationOverlay)
  });
  const requestedAction = text(request.requestedAction || "read");
  const requestedAccessMode = normalizeAccessMode(request.requestedAccessMode || overlay.defaultAccessMode || "controlledView");
  const requestedEgress = normalizeRequestedEgress(request.requestedEgress);
  const targetRefs = targetRefsFromRequest(request);
  const policy = policyAllowsRequest({ request, view, requestedAction });
  const rules = matchingRules({ request, overlay, targetRefs, requestedAction, requestedEgress });
  const denyRule = rules.find((rule) => rule.effect === "deny");
  const allowRules = rules.filter((rule) => rule.effect === "allow");
  const allowedByOverlay = allowRules.length > 0 || (overlay.defaultAccessMode !== "deny" && !denyRule);
  let accessMode = allowRules.reduce(
    (current, rule) => accessRank(rule.accessMode) > accessRank(current) ? rule.accessMode : current,
    overlay.defaultAccessMode || requestedAccessMode
  );
  accessMode = weakerMode(accessMode, requestedAccessMode);

  const reasons = [...policy.reasons];
  if (denyRule) reasons.push(denyRule.reason || "authorization_overlay_deny");
  if (!allowedByOverlay) reasons.push("authorization_overlay_no_allow");
  if (!accessModeAllowsEgress(accessMode, requestedEgress)) reasons.push("egress_not_allowed");
  const denied = reasons.length > 0 || accessMode === "deny";
  const allowedRefs = denied ? [] : (targetRefs.length ? targetRefs : view.refs.map((ref) => ({
    ref: text(ref.ref || ref.id),
    refType: text(ref.refType || ref.type || "knowledge")
  })).filter((ref) => ref.ref));
  const withheldRefs = denied ? (targetRefs.length ? targetRefs : view.refs) : [];
  const auditId = stableId(denied ? "denied_request_audit" : "knowledge_access_audit", {
    request,
    derivedViewRef: view.derivedViewRef,
    denied,
    reasons
  });

  const result = {
    protocolVersion: KNOWLEDGE_ACCESS_PROTOCOL_VERSION,
    agentLibraryProtocolVersion: AGENT_LIBRARY_PROTOCOL_VERSION,
    decisionId: stableId("knowledge_access_decision", { request, view: view.derivedViewRef }),
    allowed: !denied,
    accessMode: denied ? "deny" : accessMode,
    knowledgeAccessReceipt: null,
    loanRecord: null,
    derivedViewRef: view.derivedViewRef,
    upstreamKnowledgeRef: view.upstreamKnowledgeRef,
    upstreamAccessDenied: denied,
    allowedRefs,
    withheldRefs,
    withheldCounts: {
      refs: withheldRefs.length
    },
    filteredReason: denied ? reasons.join(",") : "",
    redactionPolicy: shallowObject(input.redactionPolicy || { policyId: "default-redaction" }),
    checkoutPolicy: view.checkoutPolicy,
    canCite: !denied && accessRank(accessMode) >= accessRank("citeOnly"),
    canCopyToContext: !denied && accessRank(accessMode) >= accessRank("copyToContext"),
    canExport: !denied && accessRank(accessMode) >= accessRank("exportAllowed"),
    canWriteMemory: !denied && accessMode === "checkoutAllowed",
    canRetain: !denied && accessMode === "checkoutAllowed" && view.checkoutPolicy?.allowRetain === true,
    canShare: !denied && accessMode === "checkoutAllowed" && view.checkoutPolicy?.allowShare === true,
    expiresAt: "",
    revocationPolicy: view.checkoutPolicy?.revocationPolicy || "revoke-on-policy-change",
    auditId,
    deniedRequestAudit: denied
      ? {
          auditId,
          request,
          derivedViewRef: view.derivedViewRef,
          upstreamKnowledgeRef: view.upstreamKnowledgeRef,
          upstreamAccessDenied: true,
          withheldCounts: { refs: withheldRefs.length },
          filteredReason: reasons.join(","),
          createdAt: new Date().toISOString()
        }
      : null
  };

  if (!denied) {
    result.knowledgeAccessReceipt = receiptFor({
      request,
      view,
      allowedRefs,
      requestedAction,
      requestedEgress,
      accessMode,
      auditId
    });
    if (loanRequired(requestedEgress, accessMode)) {
      result.loanRecord = loanFor({
        request,
        view,
        receipt: result.knowledgeAccessReceipt,
        requestedEgress,
        accessMode,
        auditId
      });
      result.expiresAt = result.loanRecord.expiresAt;
    }
  }

  return result;
}

export function enforceKnowledgeAccess(request = {}, policy = {}) {
  const decision = evaluateKnowledgeAccess(request, policy);
  if (!decision.allowed) {
    const error = new Error(`AgentLibrary access denied: ${decision.filteredReason || "denied"}`);
    error.code = "AGENT_LIBRARY_ACCESS_DENIED";
    error.decision = decision;
    throw error;
  }
  return decision;
}

export function applyKnowledgeAccessToEvidencePack(evidencePack = {}, decision = {}) {
  if (!decision.allowed) {
    return {
      ...evidencePack,
      evidenceRefs: [],
      citations: [],
      assetRefs: [],
      permissionScope: "denied",
      accessMode: "deny",
      checkoutPolicy: decision.checkoutPolicy || {},
      withheldCounts: decision.withheldCounts || {},
      filteredReason: decision.filteredReason || "denied",
      backendTrace: {
        ...shallowObject(evidencePack.backendTrace),
        agentLibraryDecisionId: decision.decisionId,
        auditId: decision.auditId
      }
    };
  }
  const allowed = new Set(asArray(decision.allowedRefs).map((ref) => text(ref.ref || ref.id || ref)));
  return {
    ...evidencePack,
    evidenceRefs: asArray(evidencePack.evidenceRefs).filter((ref) => !allowed.size || allowed.has(text(ref.ref || ref.id || ref))),
    citations: asArray(evidencePack.citations),
    assetRefs: asArray(evidencePack.assetRefs).filter((ref) => !allowed.size || allowed.has(text(ref.ref || ref.id || ref))),
    permissionScope: "agent-library",
    accessMode: decision.accessMode,
    checkoutPolicy: decision.checkoutPolicy,
    knowledgeAccessReceipt: decision.knowledgeAccessReceipt,
    loanRecord: decision.loanRecord,
    withheldCounts: decision.withheldCounts,
    filteredReason: decision.filteredReason,
    backendTrace: {
      ...shallowObject(evidencePack.backendTrace),
      agentLibraryDecisionId: decision.decisionId,
      auditId: decision.auditId
    }
  };
}

export function createLibraryCard(input = {}) {
  return {
    libraryCardId: text(input.libraryCardId || `library-card-${randomUUID()}`),
    subject: input.subject || {},
    workspaceId: text(input.workspaceId || ""),
    agentProfile: input.agentProfile || {},
    issuedAt: new Date().toISOString(),
    expiresAt: text(input.expiresAt || ""),
    scopes: asArray(input.scopes).map(text).filter(Boolean)
  };
}
