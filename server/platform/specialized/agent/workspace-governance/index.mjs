import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { ServerConfig } from "../../../common/config/ServerConfig.mjs";

export const WORKSPACE_GOVERNANCE_PROTOCOL_VERSION = "v0.0.1:workspace:governance-1";

const REGISTRY_FILE = path.join("workspace-governance", "registry.json");
const DATA_CLASS_RANK = Object.freeze({
  public: 0,
  internal: 1,
  confidential: 2,
  restricted: 3,
  secret: 4
});
const VALID_COPY_POLICIES = new Set(["deny", "sameProject", "withApproval", "allow"]);
const DESTRUCTIVE_ACTIONS = new Set(["delete", "purge", "expire", "retention.dispose"]);
const EGRESS_ACTIONS = new Set(["download", "export", "checkout", "copy", "share"]);

function nowIso() {
  return new Date().toISOString();
}

function asObject(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === "") return [];
  return [value];
}

function text(value) {
  return String(value ?? "").trim();
}

function uniqueStrings(value = []) {
  return [...new Set(asArray(value).map(text).filter(Boolean))];
}

function stableJson(value) {
  if (value === undefined || value === null) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

function stableId(prefix, value) {
  return `${prefix}_${crypto.createHash("sha256").update(stableJson(value)).digest("hex").slice(0, 18)}`;
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function registryPath(userDataPath = "") {
  return path.join(userDataPath || ServerConfig.getDataDir(), REGISTRY_FILE);
}

function emptyRegistry() {
  return {
    schemaVersion: "v0.0.1:schema:definition-1",
    protocolVersion: WORKSPACE_GOVERNANCE_PROTOCOL_VERSION,
    updatedAt: nowIso(),
    policies: {},
    shareGrants: {},
    auditEvents: []
  };
}

function normalizeDataClass(value) {
  const normalized = text(value || "internal");
  return Object.prototype.hasOwnProperty.call(DATA_CLASS_RANK, normalized) ? normalized : "internal";
}

function normalizeRetentionPolicy(value = {}) {
  const retention = asObject(value);
  return {
    policyId: text(retention.policyId || "default"),
    ttlDays: Math.max(0, Number(retention.ttlDays || 0)),
    retainUntil: text(retention.retainUntil || ""),
    disposalAction: text(retention.disposalAction || "review"),
    archiveBeforeDispose: retention.archiveBeforeDispose !== false
  };
}

function normalizeLegalHold(value = {}) {
  const legalHold = asObject(value);
  return {
    enabled: legalHold.enabled === true,
    holdIds: uniqueStrings(legalHold.holdIds || legalHold.holdId),
    reason: text(legalHold.reason || ""),
    retainUntilReleased: legalHold.retainUntilReleased !== false
  };
}

export function normalizeWorkspaceGovernancePolicy(input = {}) {
  const source = asObject(input);
  const workspaceId = text(source.workspaceId || "default");
  const copyPolicy = text(source.copyPolicy || source.sharePolicy?.copyPolicy || "sameProject");
  const normalized = {
    schemaVersion: "v0.0.1:schema:definition-1",
    protocolVersion: WORKSPACE_GOVERNANCE_PROTOCOL_VERSION,
    workspaceId,
    organizationId: text(source.organizationId || source.orgId || "default-org"),
    projectId: text(source.projectId || "default-project"),
    departmentId: text(source.departmentId || ""),
    dataClass: normalizeDataClass(source.dataClass),
    sensitivity: text(source.sensitivity || ""),
    ownerSubjectIds: uniqueStrings(source.ownerSubjectIds || source.owners),
    allowedSubjectIds: uniqueStrings(source.allowedSubjectIds || source.subjectIds),
    externalCollaboratorIds: uniqueStrings(source.externalCollaboratorIds || source.externalCollaborators),
    allowedActions: uniqueStrings(source.allowedActions || ["discover", "read", "cite", "copyToContext"]),
    copyPolicy: VALID_COPY_POLICIES.has(copyPolicy) ? copyPolicy : "sameProject",
    exportAllowed: source.exportAllowed === true,
    checkoutAllowed: source.checkoutAllowed === true,
    retention: normalizeRetentionPolicy(source.retention),
    legalHold: normalizeLegalHold(source.legalHold),
    createdAt: text(source.createdAt || nowIso()),
    updatedAt: text(source.updatedAt || nowIso()),
    metadata: asObject(source.metadata)
  };
  return normalized;
}

function dataClassRank(value) {
  return DATA_CLASS_RANK[normalizeDataClass(value)] ?? DATA_CLASS_RANK.internal;
}

function subjectRecord(input = {}) {
  const subject = asObject(input.subject || input);
  return {
    subjectId: text(subject.subjectId || subject.userId || subject.agentId || input.subjectId || ""),
    organizationId: text(subject.organizationId || input.organizationId || ""),
    projectIds: uniqueStrings(subject.projectIds || subject.projectId || input.projectIds || input.projectId),
    clearance: normalizeDataClass(subject.clearance || subject.dataClassClearance || "internal"),
    external: subject.external === true || input.external === true,
    roles: uniqueStrings(subject.roles || input.roles)
  };
}

function retentionExpired(policy = {}, now = new Date()) {
  const retainUntil = text(policy.retention?.retainUntil || "");
  if (retainUntil) {
    const date = new Date(retainUntil);
    return Number.isFinite(date.getTime()) && date.getTime() < now.getTime();
  }
  return false;
}

function evaluatePolicy(policy = {}, request = {}) {
  const action = text(request.action || "read");
  const subject = subjectRecord(request);
  const targetWorkspaceId = text(request.targetWorkspaceId || request.destinationWorkspaceId || "");
  const targetProjectId = text(request.targetProjectId || request.destinationProjectId || "");
  const approvals = uniqueStrings(request.approvals || request.approvalIds);
  const now = request.now ? new Date(request.now) : new Date();
  const reasons = [];
  const obligations = [];

  const subjectIsOwner = policy.ownerSubjectIds.includes(subject.subjectId);
  const subjectIsAllowed = policy.allowedSubjectIds.includes(subject.subjectId);
  const subjectIsExternalListed = policy.externalCollaboratorIds.includes(subject.subjectId);
  if (policy.organizationId && subject.organizationId && policy.organizationId !== subject.organizationId && !subjectIsExternalListed) {
    reasons.push("organization_mismatch");
  }
  if (subject.external && !subjectIsExternalListed) {
    reasons.push("external_collaborator_not_listed");
  }
  if (!subjectIsOwner && !subjectIsAllowed && !subjectIsExternalListed) {
    reasons.push("subject_not_allowed");
  }
  if (dataClassRank(subject.clearance) < dataClassRank(policy.dataClass)) {
    reasons.push("insufficient_data_class_clearance");
  }
  if (!policy.allowedActions.includes(action) && !subjectIsOwner) {
    reasons.push("action_not_allowed");
  }
  if (EGRESS_ACTIONS.has(action) && action === "export" && !policy.exportAllowed && !subjectIsOwner) {
    reasons.push("export_not_allowed");
  }
  if (EGRESS_ACTIONS.has(action) && action === "checkout" && !policy.checkoutAllowed && !subjectIsOwner) {
    reasons.push("checkout_not_allowed");
  }
  if (DESTRUCTIVE_ACTIONS.has(action) && policy.legalHold.enabled) {
    reasons.push("legal_hold_blocks_destructive_action");
  }
  if (retentionExpired(policy, now)) {
    obligations.push({
      type: "retention_expired",
      disposalAction: policy.retention.disposalAction,
      blockedByLegalHold: policy.legalHold.enabled
    });
    if (action !== "retention.dispose" && !policy.legalHold.enabled) {
      obligations.push({ type: "retention_review_required" });
    }
  }
  if (["copy", "share"].includes(action) && targetWorkspaceId && targetWorkspaceId !== policy.workspaceId) {
    if (policy.copyPolicy === "deny") {
      reasons.push("cross_workspace_copy_denied");
    } else if (policy.copyPolicy === "sameProject" && targetProjectId && targetProjectId !== policy.projectId) {
      reasons.push("target_project_mismatch");
    } else if (policy.copyPolicy === "withApproval" && approvals.length === 0) {
      reasons.push("copy_requires_approval");
    }
  }

  return {
    protocolVersion: WORKSPACE_GOVERNANCE_PROTOCOL_VERSION,
    workspaceId: policy.workspaceId,
    organizationId: policy.organizationId,
    projectId: policy.projectId,
    dataClass: policy.dataClass,
    action,
    subject,
    allowed: reasons.length === 0,
    reasons,
    obligations,
    evaluatedAt: nowIso()
  };
}

function publicRegistry(registry = emptyRegistry()) {
  return {
    schemaVersion: registry.schemaVersion,
    protocolVersion: registry.protocolVersion,
    updatedAt: registry.updatedAt,
    policies: Object.values(registry.policies || {}),
    shareGrants: Object.values(registry.shareGrants || {}),
    auditEvents: registry.auditEvents || []
  };
}

export function createWorkspaceGovernanceRegistry({ userDataPath = "" } = {}) {
  const filePath = registryPath(userDataPath);

  async function readRegistry() {
    const loaded = await readJson(filePath, emptyRegistry());
    return {
      ...emptyRegistry(),
      ...loaded,
      policies: asObject(loaded.policies),
      shareGrants: asObject(loaded.shareGrants),
      auditEvents: asArray(loaded.auditEvents)
    };
  }

  async function writeRegistry(registry) {
    const next = {
      ...registry,
      protocolVersion: WORKSPACE_GOVERNANCE_PROTOCOL_VERSION,
      updatedAt: nowIso()
    };
    await writeJson(filePath, next);
    return next;
  }

  function audit(registry, eventType, payload = {}) {
    const event = {
      auditId: stableId("workspace_governance_audit", { eventType, payload, nonce: crypto.randomUUID() }),
      eventType,
      workspaceId: text(payload.workspaceId || ""),
      payload,
      createdAt: nowIso()
    };
    registry.auditEvents.push(event);
    return event;
  }

  return {
    protocolVersion: WORKSPACE_GOVERNANCE_PROTOCOL_VERSION,
    async describe() {
      return publicRegistry(await readRegistry());
    },
    async upsertPolicy(input = {}) {
      const registry = await readRegistry();
      const policy = normalizeWorkspaceGovernancePolicy(input.policy || input);
      registry.policies[policy.workspaceId] = {
        ...(registry.policies[policy.workspaceId] || {}),
        ...policy,
        updatedAt: nowIso()
      };
      const event = audit(registry, "workspace_governance.policy.upserted", {
        workspaceId: policy.workspaceId,
        organizationId: policy.organizationId,
        projectId: policy.projectId,
        dataClass: policy.dataClass
      });
      await writeRegistry(registry);
      return {
        protocolVersion: WORKSPACE_GOVERNANCE_PROTOCOL_VERSION,
        policy: registry.policies[policy.workspaceId],
        audit: event
      };
    },
    async evaluate(input = {}) {
      const registry = await readRegistry();
      const workspaceId = text(input.workspaceId || input.policy?.workspaceId || "default");
      const policy = registry.policies[workspaceId] || normalizeWorkspaceGovernancePolicy({ workspaceId });
      const evaluation = evaluatePolicy(policy, input);
      audit(registry, "workspace_governance.evaluated", {
        workspaceId,
        action: evaluation.action,
        subjectId: evaluation.subject.subjectId,
        allowed: evaluation.allowed,
        reasons: evaluation.reasons
      });
      await writeRegistry(registry);
      return evaluation;
    },
    async createShareGrant(input = {}) {
      const registry = await readRegistry();
      const workspaceId = text(input.workspaceId || "");
      const policy = registry.policies[workspaceId] || normalizeWorkspaceGovernancePolicy({ workspaceId });
      const evaluation = evaluatePolicy(policy, {
        ...input,
        action: input.action || "share"
      });
      if (!evaluation.allowed) {
        return {
          protocolVersion: WORKSPACE_GOVERNANCE_PROTOCOL_VERSION,
          granted: false,
          evaluation
        };
      }
      const grant = {
        shareGrantId: stableId("workspace_share_grant", {
          workspaceId,
          granteeId: input.granteeId,
          targetWorkspaceId: input.targetWorkspaceId,
          actions: input.actions
        }),
        workspaceId,
        organizationId: policy.organizationId,
        projectId: policy.projectId,
        granteeId: text(input.granteeId || evaluation.subject.subjectId),
        targetWorkspaceId: text(input.targetWorkspaceId || workspaceId),
        actions: uniqueStrings(input.actions || [evaluation.action]),
        dataClass: policy.dataClass,
        retention: policy.retention,
        legalHold: policy.legalHold,
        expiresAt: text(input.expiresAt || ""),
        createdAt: nowIso()
      };
      registry.shareGrants[grant.shareGrantId] = grant;
      const event = audit(registry, "workspace_governance.share_granted", grant);
      await writeRegistry(registry);
      return {
        protocolVersion: WORKSPACE_GOVERNANCE_PROTOCOL_VERSION,
        granted: true,
        shareGrant: grant,
        evaluation,
        audit: event
      };
    }
  };
}
