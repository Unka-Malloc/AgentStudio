import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CONTRIBUTION_STATES,
  CONTRIBUTION_TYPES,
  computeRankScoreV0,
  createContributionRegistry,
  WORKSPACE_CONTRIBUTION_PROTOCOL_VERSION
} from "../../../server/platform/specialized/agent/workspace-contribution/index.mjs";

async function withTempUserData(testCase) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pact-workspace-contribution-"));
  try {
    await testCase(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

describe("workspace contribution defaults and normalization", () => {
  it("applies default workspace settings and normalizes loose inputs", () => {
    const registry = createContributionRegistry({ workspaceId: "workspace-alpha" });
    const submitted = registry.submitContribution({
      contributorId: "agent-a",
      contributionType: "unknown-type",
      title: "  Knowledge Seed  ",
      payloadRefs: "payload-1",
      externalCollaboratorIds: "external-1",
      requestedVisibility: "not-a-real-visibility",
      requestedActions: "download"
    });

    expect(registry.protocolVersion).toBe(WORKSPACE_CONTRIBUTION_PROTOCOL_VERSION);
    expect(CONTRIBUTION_STATES).toEqual(expect.arrayContaining([
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
    ]));
    expect(CONTRIBUTION_TYPES).toEqual(expect.arrayContaining([
      "knowledge",
      "skill",
      "tool",
      "script",
      "file",
      "sourceCode",
      "codeChange",
      "goldenRule",
      "expertOpinion"
    ]));

    expect(submitted.contribution).toMatchObject({
      protocolVersion: WORKSPACE_CONTRIBUTION_PROTOCOL_VERSION,
      workspaceId: "workspace-alpha",
      contributionType: "knowledge",
      title: "Knowledge Seed",
      contributorId: "agent-a",
      requestedVisibility: "workspace",
      payloadRefs: ["payload-1"],
      externalCollaboratorIds: ["external-1"],
      requestedActions: ["download"],
      sourceWorkspaceIds: ["workspace-alpha"],
      targetWorkspaceIds: ["workspace-alpha"],
      status: "submitted"
    });
    expect(submitted.contribution.statusHistory).toEqual([
      expect.objectContaining({
        state: "submitted",
        actorId: "agent-a",
        reason: "initial_submission"
      })
    ]);
    expect(submitted.assetRecord).toMatchObject({
      contributionType: "knowledge",
      bucket: "knowledge",
      relation: "canonical",
      lifecycleState: "submitted",
      workspaceId: "workspace-alpha",
      payloadRefs: ["payload-1"]
    });

    const stats = registry.getStats();
    expect(stats).toMatchObject({
      protocolVersion: WORKSPACE_CONTRIBUTION_PROTOCOL_VERSION,
      workspaceId: "workspace-alpha",
      contributionCount: 1,
      acceptedCount: 0,
      usageCount: 0,
      uniqueWorkspaceAdoptions: 0,
      skillExecutionCount: 0,
      permissionRequestCount: 0,
      permissionGrantCount: 0,
      rollbackCount: 0,
      contributionTypeBreakdown: { knowledge: 1 },
      contributorBreakdown: { "agent-a": 1 }
    });

    const report = registry.getContributionReport({ timeRange: "all" });
    expect(report).toMatchObject({
      protocolVersion: WORKSPACE_CONTRIBUTION_PROTOCOL_VERSION,
      workspaceId: "workspace-alpha",
      timeRange: "all",
      acceptedCount: 0,
      usageCount: 0,
      uniqueWorkspaceAdoptions: 0,
      skillExecutionCount: 0,
      permissionRequestCount: 0,
      permissionGrantCount: 0,
      rollbackCount: 0,
      assetTypeBreakdown: { knowledge: 1 },
      contributorBreakdown: { "agent-a": 1 },
      permissionFlowBreakdown: { requested: 0, granted: 0 },
      assetContributionReportV0: 0
    });
    expect(report.topReusableAssets).toHaveLength(1);
    expect(report.highDemandRestrictedAssets).toEqual([]);
    expect(report.rollbackHotspots).toEqual([]);
    expect(report.underMaintainedAssets).toEqual([]);

    const assets = registry.listWorkspaceAssets({ workspaceId: "workspace-alpha" });
    expect(assets).toMatchObject({
      protocolVersion: WORKSPACE_CONTRIBUTION_PROTOCOL_VERSION,
      workspaceId: "workspace-alpha",
      count: 1
    });
    expect(assets.fixedBuckets).toEqual([
      "skills",
      "tools",
      "scripts",
      "files",
      "knowledge",
      "rules",
      "expert-opinions"
    ]);
    expect(assets.items[0]).toMatchObject({
      workspaceId: "workspace-alpha",
      contributionType: "knowledge",
      bucket: "knowledge",
      relation: "canonical",
      lifecycleState: "submitted"
    });
    expect(registry.listAuditEvents()).toHaveLength(1);
    expect(computeRankScoreV0(stats)).toBe(0);
  });
});

describe("workspace contribution lifecycle and summaries", () => {
  it("tracks state changes, assets, metrics, and persisted reloads", async () => {
    await withTempUserData(async (root) => {
      const registry = createContributionRegistry({
        workspaceId: "workspace-main",
        userDataPath: root
      });

      const submitted = registry.submitContribution({
        contributorId: "agent-a",
        contributorKind: "agent",
        contributionType: "skill",
        title: "Renewal Review Skill",
        skillManifestRef: "workspace/skills/renewal-review/skill.json",
        requestedVisibility: "restricted",
        requestedActions: ["discover", "download", "install", "execute"],
        license: "MIT",
        risk: "low"
      }).contribution;

      const submittedAssetPath = path.join(root, submitted.currentAssetRef.assetPath);
      const submittedManifest = JSON.parse(await fs.readFile(submittedAssetPath, "utf8"));
      expect(submittedManifest).toMatchObject({
        contributionId: submitted.contributionId,
        workspaceId: "workspace-main",
        contributionType: "skill",
        bucket: "skills",
        relation: "canonical",
        lifecycleState: "submitted"
      });
      expect(submittedManifest.fixedWorkspaceAssetBuckets).toEqual([
        "workspace-contribution/workspaces/workspace-main/skills",
        "workspace-contribution/workspaces/workspace-main/tools",
        "workspace-contribution/workspaces/workspace-main/scripts",
        "workspace-contribution/workspaces/workspace-main/files",
        "workspace-contribution/workspaces/workspace-main/knowledge",
        "workspace-contribution/workspaces/workspace-main/rules",
        "workspace-contribution/workspaces/workspace-main/expert-opinions"
      ]);

      const scanned = registry.scanContribution(submitted.contributionId, {
        actorId: "scanner",
        reason: "license_and_risk_scan"
      });
      expect(scanned.contribution.status).toBe("scanned");

      const reviewed = registry.reviewContribution(submitted.contributionId, {
        actorId: "reviewer",
        reviewerId: "reviewer",
        decision: "approved",
        reason: "approved_for_public_workspace"
      });
      expect(reviewed.contribution.status).toBe("reviewed");
      expect(reviewed.review).toMatchObject({
        contributionId: submitted.contributionId,
        reviewerId: "reviewer",
        decision: "approved"
      });

      const preview = registry.previewContribution(submitted.contributionId, {
        actorId: "reviewer",
        reason: "publish_preview"
      });
      expect(preview.contribution.status).toBe("preview");
      expect(preview.preview.assetRecord).toMatchObject({
        workspaceId: "workspace-main",
        relation: "canonical",
        lifecycleState: "preview"
      });

      const published = registry.publishContribution(submitted.contributionId, {
        actorId: "reviewer"
      }).contribution;
      expect(published.status).toBe("published");

      const adopted = registry.adoptContribution(submitted.contributionId, {
        actorId: "agent-b",
        adopterId: "agent-b",
        targetWorkspaceId: "workspace-secondary",
        reason: "reuse approved skill"
      });
      expect(adopted.adoption).toMatchObject({
        contributionId: submitted.contributionId,
        sourceWorkspaceId: "workspace-main",
        targetWorkspaceId: "workspace-secondary",
        adopterId: "agent-b",
        status: "adopted"
      });
      expect(adopted.assetRecord).toMatchObject({
        workspaceId: "workspace-secondary",
        sourceWorkspaceId: "workspace-main",
        relation: "adoption",
        lifecycleState: "adopted"
      });

      const reAdopted = registry.adoptContribution(submitted.contributionId, {
        actorId: "agent-c",
        adopterId: "agent-c",
        targetWorkspaceId: "workspace-secondary",
        reason: "keep adoption current"
      });
      expect(reAdopted.contribution.status).toBe("adopted");

      const permissionRequest = registry.requestPermission(submitted.contributionId, {
        requesterId: "agent-b",
        targetWorkspaceId: "workspace-secondary",
        actions: ["download", "install"],
        purpose: "reuse renewal skill"
      });
      expect(permissionRequest.permissionRequest).toMatchObject({
        contributionId: submitted.contributionId,
        requesterId: "agent-b",
        targetWorkspaceId: "workspace-secondary",
        actions: ["download", "install"],
        status: "requested"
      });

      const permissionGrant = registry.grantPermission(submitted.contributionId, {
        granteeId: "agent-b",
        targetWorkspaceId: "workspace-secondary",
        canRetain: true,
        canShare: false
      });
      expect(permissionGrant.contributionGrant.actions).toEqual([
        "discover",
        "download",
        "install",
        "execute"
      ]);
      expect(permissionGrant.loanRecord).toMatchObject({
        contributionId: submitted.contributionId,
        targetWorkspaceId: "workspace-secondary",
        granteeId: "agent-b",
        canRetain: true,
        canShare: false
      });

      const firstUsage = registry.recordUsage(submitted.contributionId, {
        actorId: "agent-b",
        workspaceId: "workspace-secondary",
        action: "skill.used",
        successful: true
      });
      expect(firstUsage.usageEvent.successful).toBe(true);

      const secondUsage = registry.recordUsage(submitted.contributionId, {
        actorId: "agent-c",
        workspaceId: "workspace-tertiary",
        action: "skill.used",
        successful: false
      });
      expect(secondUsage.usageEvent.successful).toBe(false);

      const rollback = registry.recordRollback(submitted.contributionId, {
        reason: "bad output"
      });
      expect(rollback.metrics.rollbackCount).toBe(1);

      const contribution = registry.getContribution(submitted.contributionId);
      expect(contribution.status).toBe("adopted");
      expect(contribution.statusHistory.map((item) => item.state)).toEqual([
        "submitted",
        "scanned",
        "reviewed",
        "preview",
        "published",
        "adopted",
        "adopted"
      ]);
      expect(contribution.metrics).toMatchObject({
        acceptedCount: 3,
        usageCount: 2,
        successfulUseCount: 1,
        uniqueWorkspaceAdoptions: 2,
        skillExecutionCount: 2,
        permissionRequestCount: 1,
        permissionGrantCount: 1,
        rollbackCount: 1,
        successRate: 0.5,
        rankScore: computeRankScoreV0(contribution.metrics)
      });

      const stats = registry.getStats();
      expect(stats).toMatchObject({
        contributionCount: 1,
        acceptedCount: 3,
        usageCount: 2,
        uniqueWorkspaceAdoptions: 2,
        skillExecutionCount: 2,
        permissionRequestCount: 1,
        permissionGrantCount: 1,
        rollbackCount: 1,
        contributionTypeBreakdown: { skill: 1 },
        contributorBreakdown: { "agent-a": 1 }
      });

      const report = registry.getContributionReport({ timeRange: "7d" });
      expect(report).toMatchObject({
        timeRange: "7d",
        acceptedCount: 3,
        usageCount: 2,
        uniqueWorkspaceAdoptions: 2,
        skillExecutionCount: 2,
        permissionRequestCount: 1,
        permissionGrantCount: 1,
        rollbackCount: 1,
        assetTypeBreakdown: { skill: 1 },
        contributorBreakdown: { "agent-a": 1 },
        permissionFlowBreakdown: {
          requested: 1,
          granted: 1
        },
        assetContributionReportV0: 7
      });
      expect(report.topReusableAssets).toHaveLength(1);
      expect(report.highDemandRestrictedAssets).toHaveLength(1);
      expect(report.rollbackHotspots).toHaveLength(1);
      expect(report.underMaintainedAssets).toEqual([]);

      const mainAssets = registry.listWorkspaceAssets({ workspaceId: "workspace-main" });
      expect(mainAssets.count).toBe(1);
      expect(mainAssets.items[0]).toMatchObject({
        workspaceId: "workspace-main",
        contributionType: "skill",
        bucket: "skills",
        relation: "canonical"
      });

      const secondaryAssets = registry.listWorkspaceAssets({ workspaceId: "workspace-secondary" });
      expect(secondaryAssets.count).toBe(1);
      expect(secondaryAssets.items[0]).toMatchObject({
        workspaceId: "workspace-secondary",
        sourceWorkspaceId: "workspace-main",
        contributionType: "skill",
        bucket: "skills",
        relation: "adoption"
      });

      const reloaded = createContributionRegistry({
        workspaceId: "workspace-main",
        userDataPath: root
      }).getContribution(submitted.contributionId);
      expect(reloaded).toMatchObject({
        contributionId: submitted.contributionId,
        workspaceId: "workspace-main",
        status: "adopted"
      });
      expect(reloaded.assetRecords).toEqual(expect.arrayContaining([
        expect.objectContaining({
          workspaceId: "workspace-main",
          relation: "canonical"
        }),
        expect.objectContaining({
          workspaceId: "workspace-secondary",
          relation: "adoption"
        })
      ]));

      const registryFile = JSON.parse(await fs.readFile(path.join(root, "workspace-contribution", "registry.json"), "utf8"));
      expect(registryFile.protocolVersion).toBe(WORKSPACE_CONTRIBUTION_PROTOCOL_VERSION);
      expect(Object.keys(registryFile.contributions)).toContain(submitted.contributionId);
      expect(registryFile.auditEvents.length).toBeGreaterThan(0);
    });
  });
});

describe("workspace contribution error paths and terminal states", () => {
  it("rejects missing contributions and invalid transitions from needs_changes and revoked states", () => {
    const registry = createContributionRegistry({ workspaceId: "workspace-errors" });

    expect(() => registry.getContribution("missing-contribution")).toThrow(
      /Contribution not found: missing-contribution/
    );

    const needsChanges = registry.submitContribution({
      contributorId: "agent-x",
      contributionType: "file",
      fileRefs: "workspace/files/raw.md"
    }).contribution;

    const requestedChanges = registry.requestChanges(needsChanges.contributionId, {
      actorId: "reviewer",
      reason: "needs a smaller patch"
    });
    expect(requestedChanges.contribution.status).toBe("needs_changes");

    expect(() => registry.publishContribution(needsChanges.contributionId, {
      actorId: "reviewer"
    })).toThrow(/Invalid contribution state transition: needs_changes -> published/);

    const rejected = registry.rejectContribution(needsChanges.contributionId, {
      actorId: "reviewer",
      reason: "not suitable"
    });
    expect(rejected.contribution.status).toBe("rejected");

    expect(() => registry.scanContribution(needsChanges.contributionId, {
      actorId: "scanner"
    })).toThrow(/Invalid contribution state transition: rejected -> scanned/);

    const revokable = registry.submitContribution({
      contributorId: "agent-y",
      contributionType: "tool",
      toolSchemaRef: "workspace/tools/tool.schema.json",
      title: "Revoked tool"
    }).contribution;
    registry.scanContribution(revokable.contributionId, { actorId: "scanner" });
    registry.reviewContribution(revokable.contributionId, {
      actorId: "reviewer",
      reviewerId: "reviewer",
      decision: "approved"
    });
    registry.publishContribution(revokable.contributionId, { actorId: "reviewer" });

    const revoked = registry.revokeContribution(revokable.contributionId, {
      actorId: "compliance",
      reason: "policy change"
    });
    expect(revoked.contribution.status).toBe("revoked");
    expect(revoked.contribution.statusHistory.at(-1)).toMatchObject({
      state: "revoked",
      actorId: "compliance",
      reason: "policy change"
    });

    expect(() => registry.publishContribution(revokable.contributionId, {
      actorId: "reviewer"
    })).toThrow(/Invalid contribution state transition: revoked -> published/);
    expect(() => registry.adoptContribution(revokable.contributionId, {
      actorId: "agent-z",
      targetWorkspaceId: "workspace-z"
    })).toThrow(/Transition not allowed: revoked -> \[contribution.adopt\]/);
  });

  it("enforces state machine rules for adopt and revoke transitions through the transition engine", () => {
    const registry = createContributionRegistry({ workspaceId: "workspace-sm-integration" });
    
    // Submit a contribution
    const submitted = registry.submitContribution({
      contributorId: "agent-sm",
      contributionType: "knowledge",
      title: "SM Test Knowledge"
    }).contribution;

    expect(submitted.status).toBe("submitted");

    // Attempting to adopt directly from 'submitted' should fail fast via state machine
    expect(() => {
      registry.adoptContribution(submitted.contributionId, {
        actorId: "agent-sm"
      });
    }).toThrow(/Transition not allowed: submitted -> \[contribution.adopt\]/);

    // Verify structural error properties (code, details)
    try {
      registry.adoptContribution(submitted.contributionId, {
        actorId: "agent-sm"
      });
    } catch (err) {
      expect(err.code).toBe("CONTRIBUTION_NOT_PUBLISHED");
      expect(err.details).toBeDefined();
      expect(err.details.ok).toBe(false);
      expect(err.details.errorCode).toBe("CONTRIBUTION_NOT_PUBLISHED");
      expect(err.details.entityId).toBe(submitted.contributionId);
    }

    // Attempting to revoke directly from 'submitted' should fail fast via state machine
    try {
      registry.revokeContribution(submitted.contributionId, {
        actorId: "agent-sm"
      });
    } catch (err) {
      expect(err.code).toBe("CONTRIBUTION_NOT_PUBLISHED");
      expect(err.details).toBeDefined();
      expect(err.details.ok).toBe(false);
      expect(err.details.errorCode).toBe("CONTRIBUTION_NOT_PUBLISHED");
      expect(err.details.entityId).toBe(submitted.contributionId);
    }
  });
});
