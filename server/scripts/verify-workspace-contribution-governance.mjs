import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  CONTRIBUTION_STATES,
  CONTRIBUTION_TYPES,
  WORKSPACE_CONTRIBUTION_PROTOCOL_VERSION,
  computeRankScoreV0,
  createContributionRegistry
} from "../platform/specialized/agent/workspace-contribution/index.mjs";
import { executeConsoleDomainOperation } from "../platform/specialized/console/console-domain-operation-executor.mjs";

function assertCatalogs() {
  for (const state of ["submitted", "scanned", "reviewed", "preview", "published", "adopted", "deprecated", "revoked"]) {
    assert.ok(CONTRIBUTION_STATES.includes(state), `missing state ${state}`);
  }
  for (const type of ["knowledge", "skill", "tool", "script", "file", "sourceCode", "codeChange", "goldenRule", "expertOpinion"]) {
    assert.ok(CONTRIBUTION_TYPES.includes(type), `missing contribution type ${type}`);
  }
}

function publishSkillContribution(registry) {
  const submitted = registry.submitContribution({
    workspaceId: "workspace-main",
    contributorId: "agent-a",
    contributorKind: "agent",
    contributionType: "skill",
    title: "Renewal Review Skill",
    skillManifestRef: "workspace/skills/renewal-review/skill.json",
    requestedVisibility: "public",
    requestedActions: ["discover", "download", "install", "execute"],
    license: "MIT",
    risk: "low"
  }).contribution;
  assert.equal(submitted.protocolVersion, WORKSPACE_CONTRIBUTION_PROTOCOL_VERSION);
  assert.equal(submitted.status, "submitted");

  assert.equal(submitted.assetRecords[0].lifecycleState, "submitted");

  registry.scanContribution(submitted.contributionId, { actorId: "scanner", reason: "license_and_risk_scan" });
  const reviewed = registry.reviewContribution(submitted.contributionId, {
    actorId: "reviewer",
    reviewerId: "reviewer",
    decision: "approved",
    reason: "approved_for_public_workspace"
  });
  assert.ok(reviewed.review.reviewId);
  assert.equal(reviewed.contribution.status, "reviewed");
  const preview = registry.previewContribution(submitted.contributionId, {
    actorId: "reviewer",
    reason: "publish_preview"
  });
  assert.equal(preview.contribution.status, "preview");
  assert.equal(preview.preview.assetRecord.lifecycleState, "preview");
  const published = registry.publishContribution(submitted.contributionId, { actorId: "reviewer" }).contribution;
  assert.equal(published.status, "published");
  assert.ok(published.currentAssetRef.assetPath.endsWith("asset.json"));
  return published;
}

function assertPermissionGrantAndLoan(registry, contributionId) {
  const permission = registry.requestPermission(contributionId, {
    requesterId: "agent-b",
    targetWorkspaceId: "workspace-secondary",
    actions: ["download", "install", "execute"],
    purpose: "reuse renewal skill"
  });
  assert.ok(permission.permissionRequest.permissionRequestId);
  assert.equal(permission.permissionRequest.status, "requested");

  const grant = registry.grantPermission(contributionId, {
    granteeId: "agent-b",
    targetWorkspaceId: "workspace-secondary",
    actions: ["download", "install", "execute"],
    canRetain: true,
    canShare: false
  });
  assert.ok(grant.contributionGrant.contributionGrantId);
  assert.ok(grant.loanRecord.loanRecordId);
  assert.equal(grant.loanRecord.canRetain, true);
  assert.equal(grant.loanRecord.canShare, false);
  assert.ok(grant.audit.auditId);
}

function assertUsageAndRanking(registry, contributionId) {
  const adopted = registry.adoptContribution(contributionId, {
    actorId: "agent-b",
    targetWorkspaceId: "workspace-secondary",
    reason: "reuse approved skill"
  });
  assert.equal(adopted.adoption.targetWorkspaceId, "workspace-secondary");
  assert.equal(adopted.assetRecord.workspaceId, "workspace-secondary");
  assert.equal(adopted.assetRecord.relation, "adoption");

  registry.recordUsage(contributionId, {
    actorId: "agent-b",
    workspaceId: "workspace-secondary",
    action: "skill.used",
    successful: true
  });
  registry.recordUsage(contributionId, {
    actorId: "agent-c",
    workspaceId: "workspace-third",
    action: "skill.used",
    successful: true
  });
  const contribution = registry.getContribution(contributionId);
  assert.equal(contribution.metrics.usageCount, 2);
  assert.equal(contribution.metrics.skillExecutionCount, 2);
  assert.equal(contribution.metrics.uniqueWorkspaceAdoptions, 2);
  assert.equal(contribution.metrics.rankScore, computeRankScoreV0(contribution.metrics));
  assert.equal(contribution.metrics.rankScore, 4);

  const leaderboard = registry.getLeaderboard();
  assert.equal(leaderboard[0].contributionId, contributionId);
  assert.equal(leaderboard[0].acceptedCount >= 1, true, "acceptedCount must remain a report dimension");
  assert.equal(leaderboard[0].rankScore, 4);

  const assets = registry.listWorkspaceAssets({ workspaceId: "workspace-secondary" });
  assert.equal(assets.count, 1);
  assert.equal(assets.items[0].relation, "adoption");
}

function assertReport(registry) {
  const stats = registry.getStats();
  assert.equal(stats.protocolVersion, WORKSPACE_CONTRIBUTION_PROTOCOL_VERSION);
  assert.equal(stats.contributionCount, 1);
  assert.equal(stats.permissionRequestCount, 1);
  assert.equal(stats.permissionGrantCount, 1);
  assert.equal(stats.skillExecutionCount, 2);

  const report = registry.getContributionReport({ timeRange: "all" });
  assert.ok(report.reportId);
  assert.equal(report.assetContributionReportV0, 7);
  assert.equal(report.topReusableAssets.length, 1);
  assert.ok(Object.hasOwn(report.permissionFlowBreakdown, "requested"));
  assert.ok(Array.isArray(report.highDemandRestrictedAssets));
}

function assertInvalidTransitionRejected() {
  const registry = createContributionRegistry({ workspaceId: "workspace-invalid" });
  const contribution = registry.submitContribution({
    contributorId: "agent-x",
    contributionType: "file",
    fileRefs: ["workspace/files/raw.md"]
  }).contribution;
  assert.throws(
    () => registry.publishContribution(contribution.contributionId, { actorId: "reviewer" }),
    /Invalid contribution state transition/
  );
}

async function assertToolGrantCallerClaimsLocked(userDataPath) {
  const lockedContext = {
    userDataPath,
    transport: "mcp",
    authSession: {
      user: {
        type: "tool-grant",
        roleId: "tool-grant",
        userId: "grant-locked",
        subjectId: "grant-locked",
        username: "locked grant",
        scopes: ["knowledge:write"]
      }
    },
    subject: {
      type: "tool-grant",
      subjectId: "grant-locked",
      label: "locked grant",
      scopes: ["knowledge:write"]
    }
  };
  const submitted = await executeConsoleDomainOperation({
    operationId: "workspace.contribution.submit",
    input: {
      registryWorkspaceId: "locked-claims",
      workspaceId: "workspace-main",
      contributorId: "attacker-contributor",
      contributorKind: "console-user",
      contributionType: "skill",
      title: "Locked Caller Claims Skill",
      skillManifestRef: "workspace/skills/locked/skill.json"
    },
    context: lockedContext
  });
  assert.equal(submitted.status, 201);
  assert.equal(submitted.payload.contribution.contributorId, "grant-locked");
  assert.equal(submitted.payload.contribution.contributorKind, "tool-grant");
  assert.equal(submitted.payload.contribution.statusHistory[0].actorId, "grant-locked");

  const scanned = await executeConsoleDomainOperation({
    operationId: "workspace.contribution.scan",
    input: {
      registryWorkspaceId: "locked-claims",
      contributionId: submitted.payload.contribution.contributionId,
      actorId: "attacker-actor",
      reason: "locked_claims_regression"
    },
    context: lockedContext
  });
  assert.equal(scanned.status, 200);
  assert.equal(scanned.payload.contribution.statusHistory.at(-1).actorId, "grant-locked");
  assert.equal(scanned.payload.audit.payload.actorId, "grant-locked");
}

const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-workspace-contribution-"));

try {
  assertCatalogs();
  const registry = createContributionRegistry({ workspaceId: "workspace-main", userDataPath });
  const published = publishSkillContribution(registry);
  assertPermissionGrantAndLoan(registry, published.contributionId);
  assertUsageAndRanking(registry, published.contributionId);
  assertReport(registry);

  const reloadedRegistry = createContributionRegistry({ workspaceId: "workspace-main", userDataPath });
  const reloaded = reloadedRegistry.getContribution(published.contributionId);
  assert.equal(reloaded.status, "adopted");
  assert.ok(reloaded.assetRecords.some((record) => record.workspaceId === "workspace-main" && record.lifecycleState === "adopted"));
  assert.ok(reloaded.assetRecords.some((record) => record.workspaceId === "workspace-secondary" && record.relation === "adoption"));
  const canonicalAssetPath = path.join(userDataPath, reloaded.currentAssetRef.assetPath);
  const canonicalAsset = JSON.parse(await fs.readFile(canonicalAssetPath, "utf8"));
  assert.equal(canonicalAsset.contributionId, published.contributionId);
  assert.ok(canonicalAsset.fixedWorkspaceAssetBuckets.includes(path.join("workspace-contribution", "workspaces", "workspace-main", "skills")));

  assertInvalidTransitionRejected();
  await assertToolGrantCallerClaimsLocked(userDataPath);

  console.log("workspace contribution governance verification passed");
} finally {
  await fs.rm(userDataPath, { recursive: true, force: true });
}
