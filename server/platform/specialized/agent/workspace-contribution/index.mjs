import { createHash, randomUUID } from "node:crypto";
import fsSync from "node:fs";
import path from "node:path";
import { ServerConfig } from "../../../common/config/ServerConfig.mjs";

export const WORKSPACE_CONTRIBUTION_PROTOCOL_VERSION = "v0.0.1:workspace:contribution-1";

export const CONTRIBUTION_STATES = Object.freeze([
  "submitted",
  "scanned",
  "reviewed",
  "preview",
  "published",
  "rejected",
  "needs_changes",
  "adopted",
  "deprecated",
  "revoked"
]);

export const CONTRIBUTION_TYPES = Object.freeze([
  "knowledge",
  "skill",
  "tool",
  "script",
  "file",
  "sourceCode",
  "codeChange",
  "goldenRule",
  "expertOpinion"
]);

const ALLOWED_TRANSITIONS = Object.freeze({
  submitted: ["scanned", "rejected", "needs_changes"],
  scanned: ["reviewed", "rejected", "needs_changes"],
  reviewed: ["preview", "published", "rejected", "needs_changes"],
  preview: ["published", "rejected", "needs_changes"],
  published: ["adopted", "deprecated", "revoked"],
  adopted: ["adopted", "deprecated", "revoked"],
  needs_changes: ["submitted", "rejected"],
  rejected: [],
  deprecated: ["revoked"],
  revoked: []
});

const REGISTRY_FILE = path.join("workspace-contribution", "registry.json");
const ASSET_BUCKET_BY_TYPE = Object.freeze({
  knowledge: "knowledge",
  skill: "skills",
  tool: "tools",
  script: "scripts",
  file: "files",
  sourceCode: "files",
  codeChange: "files",
  goldenRule: "rules",
  expertOpinion: "expert-opinions"
});

const FIXED_WORKSPACE_ASSET_BUCKETS = Object.freeze([
  "skills",
  "tools",
  "scripts",
  "files",
  "knowledge",
  "rules",
  "expert-opinions"
]);

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

function hash(value, length = 20) {
  return createHash("sha256").update(String(value || "")).digest("hex").slice(0, length);
}

function stableId(prefix, input) {
  return `${prefix}::${hash(JSON.stringify(input))}`;
}

function nowIso() {
  return new Date().toISOString();
}

function stableJson(value) {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function dataRoot(userDataPath = "") {
  return userDataPath || ServerConfig.getDataDir();
}

function registryPath(userDataPath = "") {
  return path.join(dataRoot(userDataPath), REGISTRY_FILE);
}

function safePathSegment(value) {
  return String(value || "asset")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120) || "asset";
}

function assetBucketForType(contributionType) {
  return ASSET_BUCKET_BY_TYPE[normalizeContributionType(contributionType)] || "files";
}

function workspaceAssetRelativePath({ workspaceId, contributionType, contributionId, relation = "canonical" } = {}) {
  const bucket = assetBucketForType(contributionType);
  return path.join(
    "workspace-contribution",
    "workspaces",
    safePathSegment(workspaceId || "default"),
    bucket,
    safePathSegment(`${relation}-${contributionId || randomUUID()}`),
    "asset.json"
  );
}

function ensureWorkspaceAssetBuckets(userDataPath = "", workspaceId = "default") {
  if (!userDataPath) {
    return [];
  }
  const root = path.join(dataRoot(userDataPath), "workspace-contribution", "workspaces", safePathSegment(workspaceId));
  const paths = [];
  for (const bucket of FIXED_WORKSPACE_ASSET_BUCKETS) {
    const bucketPath = path.join(root, bucket);
    fsSync.mkdirSync(bucketPath, { recursive: true });
    paths.push(path.relative(dataRoot(userDataPath), bucketPath));
  }
  return paths;
}

function readJsonSync(filePath, fallback) {
  try {
    return JSON.parse(fsSync.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

function writeJsonSyncAtomic(filePath, value) {
  fsSync.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`);
  fsSync.writeFileSync(tmpPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fsSync.renameSync(tmpPath, filePath);
}

function emptyPersistedState() {
  return {
    schemaVersion: "v0.0.1:schema:definition-1",
    protocolVersion: WORKSPACE_CONTRIBUTION_PROTOCOL_VERSION,
    updatedAt: nowIso(),
    contributions: {},
    auditEvents: []
  };
}

function normalizePersistedState(value = {}) {
  const fallback = emptyPersistedState();
  return {
    ...fallback,
    ...shallowObject(value),
    contributions: shallowObject(value.contributions),
    auditEvents: asArray(value.auditEvents)
  };
}

function publicAssetRecord(record = {}) {
  return {
    assetId: text(record.assetId),
    contributionId: text(record.contributionId),
    workspaceId: text(record.workspaceId),
    sourceWorkspaceId: text(record.sourceWorkspaceId),
    contributionType: normalizeContributionType(record.contributionType),
    bucket: text(record.bucket),
    relation: text(record.relation || "canonical"),
    lifecycleState: text(record.lifecycleState || "submitted"),
    assetPath: text(record.assetPath),
    manifestHash: text(record.manifestHash),
    payloadRefs: asArray(record.payloadRefs).map(text).filter(Boolean),
    createdAt: text(record.createdAt),
    updatedAt: text(record.updatedAt)
  };
}

function normalizeContributionType(value) {
  const normalized = text(value || "knowledge");
  return CONTRIBUTION_TYPES.includes(normalized) ? normalized : "knowledge";
}

function normalizeVisibility(value) {
  const normalized = text(value || "workspace");
  return ["private", "workspace", "public", "restricted"].includes(normalized) ? normalized : "workspace";
}

function normalizeContribution(input = {}, defaults = {}) {
  const workspaceId = text(input.workspaceId || defaults.workspaceId || "default");
  const contributionId = text(input.contributionId || stableId("contribution", {
    workspaceId,
    contributorId: input.contributorId,
    contributionType: input.contributionType,
    payloadRefs: input.payloadRefs,
    title: input.title
  }));
  const contributionType = normalizeContributionType(input.contributionType);
  return {
    protocolVersion: WORKSPACE_CONTRIBUTION_PROTOCOL_VERSION,
    contributionId,
    workspaceId,
    organizationId: text(input.organizationId || defaults.organizationId || ""),
    projectId: text(input.projectId || defaults.projectId || ""),
    dataClass: text(input.dataClass || defaults.dataClass || "internal"),
    retention: shallowObject(input.retention || defaults.retention),
    legalHold: shallowObject(input.legalHold || defaults.legalHold),
    externalCollaboratorIds: asArray(input.externalCollaboratorIds || input.externalCollaborators).map(text).filter(Boolean),
    copyPolicy: text(input.copyPolicy || "sameProject"),
    contributorId: text(input.contributorId || "anonymous"),
    contributorKind: text(input.contributorKind || "agent"),
    sourceWorkspaceIds: asArray(input.sourceWorkspaceIds || workspaceId).map(text).filter(Boolean),
    targetWorkspaceIds: asArray(input.targetWorkspaceIds || workspaceId).map(text).filter(Boolean),
    contributionType,
    title: text(input.title || `${contributionType} contribution`),
    payloadRefs: asArray(input.payloadRefs).map(text).filter(Boolean),
    skillManifestRef: text(input.skillManifestRef || ""),
    toolSchemaRef: text(input.toolSchemaRef || ""),
    scriptRefs: asArray(input.scriptRefs).map(text).filter(Boolean),
    fileRefs: asArray(input.fileRefs).map(text).filter(Boolean),
    sourceCodeRefs: asArray(input.sourceCodeRefs).map(text).filter(Boolean),
    codeChangeRefs: asArray(input.codeChangeRefs).map(text).filter(Boolean),
    knowledgeRefs: asArray(input.knowledgeRefs).map(text).filter(Boolean),
    goldenRuleRefs: asArray(input.goldenRuleRefs).map(text).filter(Boolean),
    expertOpinionRefs: asArray(input.expertOpinionRefs).map(text).filter(Boolean),
    license: text(input.license || "UNREVIEWED"),
    risk: text(input.risk || "medium"),
    requestedVisibility: normalizeVisibility(input.requestedVisibility),
    requestedActions: asArray(input.requestedActions || ["discover", "read"]).map(text).filter(Boolean),
    reviewPolicy: shallowObject(input.reviewPolicy),
    status: "submitted",
    statusHistory: [{
      state: "submitted",
      at: nowIso(),
      actorId: text(input.contributorId || "anonymous"),
      reason: text(input.reason || "initial_submission")
    }],
    metrics: {
      acceptedCount: 0,
      usageCount: 0,
      successfulUseCount: 0,
      uniqueWorkspaceAdoptions: 0,
      skillExecutionCount: 0,
      permissionRequestCount: 0,
      permissionGrantCount: 0,
      rollbackCount: 0,
      maintenanceFreshness: 1,
      successRate: 0,
      rankScore: 0
    },
    grants: [],
    permissionRequests: [],
    usageEvents: [],
    reviews: [],
    adoptions: [],
    assetRecords: [],
    currentAssetRef: null,
    auditIds: [stableId("audit", { contributionId, event: "contribution.submitted" })],
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
}

function rankScoreV0(metrics = {}) {
  const usageCount = Number(metrics.usageCount || 0);
  const successRate = usageCount > 0 ? Number(metrics.successfulUseCount || 0) / usageCount : 0;
  return usageCount * successRate + Number(metrics.uniqueWorkspaceAdoptions || 0) - Number(metrics.rollbackCount || 0);
}

function refreshMetrics(contribution) {
  contribution.grants = asArray(contribution.grants);
  contribution.permissionRequests = asArray(contribution.permissionRequests);
  contribution.usageEvents = asArray(contribution.usageEvents);
  contribution.reviews = asArray(contribution.reviews);
  contribution.adoptions = asArray(contribution.adoptions);
  contribution.assetRecords = asArray(contribution.assetRecords).map(publicAssetRecord);
  const adoptionWorkspaces = new Set([
    ...contribution.usageEvents.map((event) => event.workspaceId).filter(Boolean),
    ...contribution.adoptions.map((event) => event.targetWorkspaceId).filter(Boolean),
    ...contribution.grants.map((event) => event.targetWorkspaceId).filter(Boolean)
  ]);
  contribution.metrics.usageCount = contribution.usageEvents.length;
  contribution.metrics.successfulUseCount = contribution.usageEvents.filter((event) => event.successful !== false).length;
  contribution.metrics.uniqueWorkspaceAdoptions = adoptionWorkspaces.size;
  contribution.metrics.skillExecutionCount = contribution.usageEvents.filter((event) => event.action === "skill.used").length;
  contribution.metrics.permissionRequestCount = contribution.permissionRequests.length;
  contribution.metrics.permissionGrantCount = contribution.grants.length;
  contribution.metrics.successRate =
    contribution.metrics.usageCount > 0
      ? contribution.metrics.successfulUseCount / contribution.metrics.usageCount
      : 0;
  contribution.metrics.rankScore = rankScoreV0(contribution.metrics);
  return contribution;
}

function assertTransition(fromState, toState) {
  const allowed = ALLOWED_TRANSITIONS[fromState] || [];
  if (!allowed.includes(toState)) {
    throw new Error(`Invalid contribution state transition: ${fromState} -> ${toState}`);
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function createContributionRegistry({ workspaceId = "default", userDataPath = "" } = {}) {
  const persistenceEnabled = Boolean(userDataPath);
  const filePath = persistenceEnabled ? registryPath(userDataPath) : "";
  const loadedState = persistenceEnabled
    ? normalizePersistedState(readJsonSync(filePath, emptyPersistedState()))
    : emptyPersistedState();
  const contributions = new Map(
    Object.values(loadedState.contributions || {})
      .filter((item) => item?.contributionId)
      .map((item) => [item.contributionId, refreshMetrics(item)])
  );
  const auditEvents = asArray(loadedState.auditEvents);

  function persistRegistry() {
    if (!persistenceEnabled) {
      return;
    }
    const next = {
      schemaVersion: "v0.0.1:schema:definition-1",
      protocolVersion: WORKSPACE_CONTRIBUTION_PROTOCOL_VERSION,
      updatedAt: nowIso(),
      contributions: Object.fromEntries([...contributions.entries()].map(([id, contribution]) => [id, contribution])),
      auditEvents
    };
    writeJsonSyncAtomic(filePath, next);
  }

  function materializeAsset(contribution, {
    lifecycleState = contribution.status || "submitted",
    targetWorkspaceId = contribution.workspaceId,
    relation = "canonical",
    actorId = "",
    reason = ""
  } = {}) {
    const workspaceAssetPaths = ensureWorkspaceAssetBuckets(userDataPath, targetWorkspaceId);
    const assetPath = workspaceAssetRelativePath({
      workspaceId: targetWorkspaceId,
      contributionType: contribution.contributionType,
      contributionId: contribution.contributionId,
      relation
    });
    const timestamp = nowIso();
    const manifest = {
      schemaVersion: "v0.0.1:schema:definition-1",
      protocolVersion: WORKSPACE_CONTRIBUTION_PROTOCOL_VERSION,
      assetKind: "workspace_contribution_asset",
      contributionId: contribution.contributionId,
      workspaceId: targetWorkspaceId,
      sourceWorkspaceId: contribution.workspaceId,
      contributionType: contribution.contributionType,
      bucket: assetBucketForType(contribution.contributionType),
      relation,
      lifecycleState,
      contributorId: contribution.contributorId,
      title: contribution.title,
      payloadRefs: contribution.payloadRefs,
      skillManifestRef: contribution.skillManifestRef,
      toolSchemaRef: contribution.toolSchemaRef,
      scriptRefs: contribution.scriptRefs,
      fileRefs: contribution.fileRefs,
      sourceCodeRefs: contribution.sourceCodeRefs,
      codeChangeRefs: contribution.codeChangeRefs,
      knowledgeRefs: contribution.knowledgeRefs,
      goldenRuleRefs: contribution.goldenRuleRefs,
      expertOpinionRefs: contribution.expertOpinionRefs,
      license: contribution.license,
      risk: contribution.risk,
      requestedVisibility: contribution.requestedVisibility,
      requestedActions: contribution.requestedActions,
      actorId: text(actorId),
      reason: text(reason),
      createdAt: timestamp
    };
    const manifestHash = hash(stableJson(manifest), 32);
    const record = publicAssetRecord({
      assetId: stableId("workspace_asset", {
        contributionId: contribution.contributionId,
        workspaceId: targetWorkspaceId,
        relation
      }),
      contributionId: contribution.contributionId,
      workspaceId: targetWorkspaceId,
      sourceWorkspaceId: contribution.workspaceId,
      contributionType: contribution.contributionType,
      bucket: assetBucketForType(contribution.contributionType),
      relation,
      lifecycleState,
      assetPath,
      manifestHash,
      payloadRefs: contribution.payloadRefs,
      createdAt: timestamp,
      updatedAt: timestamp
    });
    if (persistenceEnabled) {
      writeJsonSyncAtomic(path.join(dataRoot(userDataPath), assetPath), {
        ...manifest,
        assetId: record.assetId,
        assetPath,
        manifestHash,
        fixedWorkspaceAssetBuckets: workspaceAssetPaths
      });
    }
    const existingIndex = asArray(contribution.assetRecords).findIndex((item) =>
      item.workspaceId === record.workspaceId && item.relation === record.relation
    );
    if (existingIndex >= 0) {
      contribution.assetRecords[existingIndex] = {
        ...contribution.assetRecords[existingIndex],
        ...record,
        createdAt: contribution.assetRecords[existingIndex].createdAt || record.createdAt,
        updatedAt: timestamp
      };
    } else {
      contribution.assetRecords.push(record);
    }
    contribution.currentAssetRef = record;
    contribution.updatedAt = timestamp;
    return record;
  }

  function appendAudit(eventType, payload = {}) {
    const audit = {
      auditId: stableId("audit", { eventType, payload, nonce: randomUUID() }),
      eventType,
      workspaceId: text(payload.workspaceId || workspaceId),
      payload,
      createdAt: nowIso()
    };
    auditEvents.push(audit);
    return audit;
  }

  function getContribution(contributionId) {
    const contribution = contributions.get(text(contributionId));
    if (!contribution) {
      throw new Error(`Contribution not found: ${contributionId}`);
    }
    return contribution;
  }

  function transition(contributionId, nextState, input = {}) {
    const contribution = getContribution(contributionId);
    assertTransition(contribution.status, nextState);
    const audit = appendAudit(`contribution.${nextState}`, {
      workspaceId: contribution.workspaceId,
      contributionId: contribution.contributionId,
      actorId: input.actorId || "",
      reason: input.reason || ""
    });
    contribution.status = nextState;
    contribution.updatedAt = nowIso();
    contribution.statusHistory.push({
      state: nextState,
      at: contribution.updatedAt,
      actorId: text(input.actorId || ""),
      reason: text(input.reason || "")
    });
    contribution.auditIds.push(audit.auditId);
    if (["published", "adopted"].includes(nextState)) {
      contribution.metrics.acceptedCount += 1;
    }
    materializeAsset(contribution, {
      lifecycleState: nextState,
      targetWorkspaceId: contribution.workspaceId,
      relation: "canonical",
      actorId: input.actorId || "",
      reason: input.reason || ""
    });
    persistRegistry();
    return {
      contribution: clone(refreshMetrics(contribution)),
      audit
    };
  }

  return {
    protocolVersion: WORKSPACE_CONTRIBUTION_PROTOCOL_VERSION,
    submitContribution(input = {}) {
      const contribution = normalizeContribution(input, { workspaceId });
      materializeAsset(contribution, {
        lifecycleState: "submitted",
        targetWorkspaceId: contribution.workspaceId,
        relation: "canonical",
        actorId: contribution.contributorId,
        reason: "initial_submission"
      });
      contributions.set(contribution.contributionId, contribution);
      const audit = appendAudit("contribution.submitted", {
        workspaceId: contribution.workspaceId,
        contributionId: contribution.contributionId,
        contributorId: contribution.contributorId,
        contributionType: contribution.contributionType,
        assetId: contribution.currentAssetRef?.assetId || ""
      });
      contribution.auditIds.push(audit.auditId);
      persistRegistry();
      return {
        contribution: clone(refreshMetrics(contribution)),
        assetRecord: clone(contribution.currentAssetRef)
      };
    },
    scanContribution(contributionId, input = {}) {
      return transition(contributionId, "scanned", input);
    },
    reviewContribution(contributionId, input = {}) {
      const contribution = getContribution(contributionId);
      const review = {
        reviewId: stableId("contribution_review", {
          contributionId,
          reviewerId: input.reviewerId || input.actorId,
          decision: input.decision || "approved",
          nonce: randomUUID()
        }),
        contributionId,
        reviewerId: text(input.reviewerId || input.actorId || ""),
        decision: text(input.decision || "approved"),
        reasons: asArray(input.reasons || input.reason).map(text).filter(Boolean),
        qualityGate: shallowObject(input.qualityGate),
        licenseGate: shallowObject(input.licenseGate),
        riskGate: shallowObject(input.riskGate),
        createdAt: nowIso()
      };
      contribution.reviews.push(review);
      const transitioned = transition(contributionId, "reviewed", {
        ...input,
        reason: input.reason || review.decision
      });
      return {
        ...transitioned,
        review: clone(review)
      };
    },
    previewContribution(contributionId, input = {}) {
      const resultPayload = transition(contributionId, "preview", input);
      return {
        ...resultPayload,
        preview: {
          previewId: stableId("contribution_preview", {
            contributionId,
            assetId: resultPayload.contribution?.currentAssetRef?.assetId || ""
          }),
          contributionId,
          assetRecord: resultPayload.contribution?.currentAssetRef || null,
          createdAt: nowIso()
        }
      };
    },
    publishContribution(contributionId, input = {}) {
      return transition(contributionId, "published", input);
    },
    adoptContribution(contributionId, input = {}) {
      const contribution = getContribution(contributionId);
      const targetWorkspaceId = text(input.targetWorkspaceId || input.workspaceId || contribution.workspaceId);
      const adoption = {
        adoptionId: stableId("contribution_adoption", {
          contributionId,
          targetWorkspaceId,
          adopterId: input.adopterId || input.actorId,
          nonce: randomUUID()
        }),
        contributionId,
        sourceWorkspaceId: contribution.workspaceId,
        targetWorkspaceId,
        adopterId: text(input.adopterId || input.actorId || ""),
        status: "adopted",
        createdAt: nowIso()
      };
      contribution.adoptions.push(adoption);
      const assetRecord = materializeAsset(contribution, {
        lifecycleState: "adopted",
        targetWorkspaceId,
        relation: "adoption",
        actorId: adoption.adopterId,
        reason: input.reason || "cross_workspace_adoption"
      });
      const transitioned = transition(contributionId, "adopted", input);
      refreshMetrics(contribution);
      persistRegistry();
      return {
        ...transitioned,
        adoption: clone(adoption),
        assetRecord: clone(assetRecord)
      };
    },
    rejectContribution(contributionId, input = {}) {
      return transition(contributionId, "rejected", input);
    },
    requestChanges(contributionId, input = {}) {
      return transition(contributionId, "needs_changes", input);
    },
    revokeContribution(contributionId, input = {}) {
      return transition(contributionId, "revoked", input);
    },
    requestPermission(contributionId, input = {}) {
      const contribution = getContribution(contributionId);
      const permissionRequest = {
        permissionRequestId: stableId("contribution_permission_request", {
          contributionId,
          requesterId: input.requesterId,
          targetWorkspaceId: input.targetWorkspaceId,
          actions: input.actions
        }),
        contributionId,
        requesterId: text(input.requesterId || ""),
        targetWorkspaceId: text(input.targetWorkspaceId || contribution.workspaceId),
        actions: asArray(input.actions || ["read"]).map(text).filter(Boolean),
        purpose: text(input.purpose || ""),
        status: "requested",
        createdAt: nowIso()
      };
      const audit = appendAudit("contribution.permission.requested", permissionRequest);
      contribution.permissionRequests.push(permissionRequest);
      contribution.auditIds.push(audit.auditId);
      refreshMetrics(contribution);
      persistRegistry();
      return {
        permissionRequest: clone(permissionRequest),
        audit
      };
    },
    grantPermission(contributionId, input = {}) {
      const contribution = getContribution(contributionId);
      const grant = {
        contributionGrantId: stableId("contribution_grant", {
          contributionId,
          granteeId: input.granteeId,
          targetWorkspaceId: input.targetWorkspaceId,
          actions: input.actions
        }),
        contributionId,
        granteeId: text(input.granteeId || ""),
        targetWorkspaceId: text(input.targetWorkspaceId || contribution.workspaceId),
        actions: asArray(input.actions || contribution.requestedActions).map(text).filter(Boolean),
        expiresAt: text(input.expiresAt || ""),
        revocationPolicy: text(input.revocationPolicy || "revoke-on-policy-change"),
        createdAt: nowIso()
      };
      const loanRecord = {
        loanRecordId: stableId("contribution_loan_record", grant),
        contributionGrantId: grant.contributionGrantId,
        contributionId,
        workspaceId: contribution.workspaceId,
        targetWorkspaceId: grant.targetWorkspaceId,
        granteeId: grant.granteeId,
        actions: grant.actions,
        canShare: input.canShare === true,
        canRetain: input.canRetain === true,
        revocationPolicy: grant.revocationPolicy,
        expiresAt: grant.expiresAt,
        createdAt: nowIso()
      };
      const audit = appendAudit("contribution.permission.granted", {
        ...grant,
        loanRecordId: loanRecord.loanRecordId
      });
      contribution.grants.push(grant);
      contribution.auditIds.push(audit.auditId);
      refreshMetrics(contribution);
      persistRegistry();
      return {
        contributionGrant: clone(grant),
        loanRecord,
        audit
      };
    },
    recordUsage(contributionId, input = {}) {
      const contribution = getContribution(contributionId);
      const event = {
        usageEventId: stableId("contribution_usage", {
          contributionId,
          actorId: input.actorId,
          workspaceId: input.workspaceId,
          action: input.action,
          nonce: randomUUID()
        }),
        contributionId,
        actorId: text(input.actorId || ""),
        workspaceId: text(input.workspaceId || contribution.workspaceId),
        action: text(input.action || "asset.used"),
        successful: input.successful !== false,
        createdAt: nowIso()
      };
      const audit = appendAudit("contribution.used", event);
      contribution.usageEvents.push(event);
      contribution.auditIds.push(audit.auditId);
      refreshMetrics(contribution);
      appendAudit("contribution.rank.updated", {
        workspaceId: contribution.workspaceId,
        contributionId,
        rankScore: contribution.metrics.rankScore
      });
      persistRegistry();
      return {
        usageEvent: clone(event),
        metrics: clone(contribution.metrics),
        audit
      };
    },
    recordRollback(contributionId, input = {}) {
      const contribution = getContribution(contributionId);
      contribution.metrics.rollbackCount += 1;
      const audit = appendAudit("contribution.rollback.recorded", {
        workspaceId: contribution.workspaceId,
        contributionId,
        reason: input.reason || ""
      });
      contribution.auditIds.push(audit.auditId);
      refreshMetrics(contribution);
      persistRegistry();
      return {
        metrics: clone(contribution.metrics),
        audit
      };
    },
    getContribution(contributionId) {
      return clone(getContribution(contributionId));
    },
    listContributions() {
      return [...contributions.values()].map((contribution) => clone(refreshMetrics(contribution)));
    },
    getLeaderboard() {
      return [...contributions.values()]
        .map((contribution) => clone(refreshMetrics(contribution)))
        .sort((left, right) => Number(right.metrics.rankScore || 0) - Number(left.metrics.rankScore || 0))
        .map((contribution, index) => ({
          rank: index + 1,
          contributionId: contribution.contributionId,
          title: contribution.title,
          contributionType: contribution.contributionType,
          contributorId: contribution.contributorId,
          rankScore: contribution.metrics.rankScore,
          usageCount: contribution.metrics.usageCount,
          successRate: contribution.metrics.successRate,
          uniqueWorkspaceAdoptions: contribution.metrics.uniqueWorkspaceAdoptions,
          rollbackCount: contribution.metrics.rollbackCount,
          acceptedCount: contribution.metrics.acceptedCount
        }));
    },
    getStats() {
      const items = [...contributions.values()].map((contribution) => refreshMetrics(contribution));
      const byType = {};
      const byContributor = {};
      for (const contribution of items) {
        byType[contribution.contributionType] = (byType[contribution.contributionType] || 0) + 1;
        byContributor[contribution.contributorId] = (byContributor[contribution.contributorId] || 0) + 1;
      }
      return {
        protocolVersion: WORKSPACE_CONTRIBUTION_PROTOCOL_VERSION,
        workspaceId,
        contributionCount: items.length,
        acceptedCount: items.reduce((sum, item) => sum + Number(item.metrics.acceptedCount || 0), 0),
        usageCount: items.reduce((sum, item) => sum + Number(item.metrics.usageCount || 0), 0),
        uniqueWorkspaceAdoptions: new Set(items.flatMap((item) => item.usageEvents.map((event) => event.workspaceId))).size,
        skillExecutionCount: items.reduce((sum, item) => sum + Number(item.metrics.skillExecutionCount || 0), 0),
        permissionRequestCount: items.reduce((sum, item) => sum + Number(item.metrics.permissionRequestCount || 0), 0),
        permissionGrantCount: items.reduce((sum, item) => sum + Number(item.metrics.permissionGrantCount || 0), 0),
        rollbackCount: items.reduce((sum, item) => sum + Number(item.metrics.rollbackCount || 0), 0),
        contributionTypeBreakdown: byType,
        contributorBreakdown: byContributor
      };
    },
    getContributionReport(input = {}) {
      const stats = this.getStats();
      const leaderboard = this.getLeaderboard();
      return {
        protocolVersion: WORKSPACE_CONTRIBUTION_PROTOCOL_VERSION,
        reportId: stableId("asset_contribution_report", {
          workspaceId,
          timeRange: input.timeRange || "all"
        }),
        workspaceId,
        timeRange: input.timeRange || "all",
        acceptedCount: stats.acceptedCount,
        usageCount: stats.usageCount,
        uniqueWorkspaceAdoptions: stats.uniqueWorkspaceAdoptions,
        skillExecutionCount: stats.skillExecutionCount,
        permissionRequestCount: stats.permissionRequestCount,
        permissionGrantCount: stats.permissionGrantCount,
        rollbackCount: stats.rollbackCount,
        assetTypeBreakdown: stats.contributionTypeBreakdown,
        contributorBreakdown: stats.contributorBreakdown,
        workspaceAdoptionBreakdown: {},
        permissionFlowBreakdown: {
          requested: stats.permissionRequestCount,
          granted: stats.permissionGrantCount
        },
        usageActionBreakdown: {},
        riskBreakdown: {},
        maintenanceBreakdown: {},
        topReusableAssets: leaderboard.slice(0, 10),
        underMaintainedAssets: this.listContributions().filter((item) => Number(item.metrics.maintenanceFreshness || 0) < 0.5),
        highDemandRestrictedAssets: this.listContributions().filter((item) => item.requestedVisibility === "restricted" && item.metrics.permissionRequestCount > 0),
        rollbackHotspots: this.listContributions().filter((item) => item.metrics.rollbackCount > 0),
        assetContributionReportV0:
          stats.acceptedCount +
          stats.usageCount +
          stats.uniqueWorkspaceAdoptions +
          stats.permissionGrantCount -
          stats.rollbackCount
      };
    },
    listAuditEvents() {
      return clone(auditEvents);
    },
    listWorkspaceAssets(input = {}) {
      const targetWorkspaceId = text(input.workspaceId || input.targetWorkspaceId || workspaceId);
      const items = [...contributions.values()]
        .flatMap((contribution) => asArray(contribution.assetRecords))
        .map(publicAssetRecord)
        .filter((record) => !targetWorkspaceId || record.workspaceId === targetWorkspaceId);
      return {
        protocolVersion: WORKSPACE_CONTRIBUTION_PROTOCOL_VERSION,
        workspaceId: targetWorkspaceId,
        fixedBuckets: FIXED_WORKSPACE_ASSET_BUCKETS,
        items,
        count: items.length
      };
    }
  };
}

export function computeRankScoreV0(metrics = {}) {
  return rankScoreV0(metrics);
}
