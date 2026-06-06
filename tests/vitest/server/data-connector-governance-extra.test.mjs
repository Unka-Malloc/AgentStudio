import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DATA_CONNECTOR_GOVERNANCE_PROTOCOL_VERSION,
  LOCAL_MIRROR_PROTOCOL_VERSION,
  createDataConnectorGovernance,
  normalizeDataConnectorManifest,
  validateDataConnectorManifest,
} from "../../../server/platform/specialized/knowledge/connectors/data-connector-governance/index.mjs";

async function withTempGovernance(testCase) {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-data-connector-governance-vitest-"));
  const governance = createDataConnectorGovernance({ userDataPath });
  try {
    await testCase({ userDataPath, governance });
  } finally {
    await fs.rm(userDataPath, { recursive: true, force: true });
  }
}

function buildManifest(overrides = {}) {
  return {
    providerId: "acme-drive",
    sourceType: "cloud-file-source",
    displayName: "Acme Drive",
    version: "3.1.4",
    capabilities: ["sync", "localQuery"],
    auth: {
      type: "oauth2",
      refreshRequired: true,
      scopes: ["files.read", "files.write", "files.read"]
    },
    sync: {
      mode: "incrementalCursor",
      cursorField: "nextPageToken",
      conflictPolicy: "newerCapturedAtWins",
      hashCollisionPolicy: "quarantine",
      rateLimit: {
        maxItemsPerSync: 2,
        maxBytesPerSync: 1024
      }
    },
    localQuery: {
      enabled: true,
      remoteCallsAllowed: true
    },
    mirror: {
      mode: "localMirror",
      cleanupRequired: true,
      dedupeKeys: ["providerId", "sourceType", "externalId", "contentHash"]
    },
    uninstall: {
      removeMirrorDefault: true,
      retainIngestedKnowledge: true
    },
    security: {
      secretRefs: ["secret://acme/oauth"],
      dataClasses: ["business"]
    },
    metadata: {
      region: "us-east-1"
    },
    ...overrides
  };
}

describe("data connector governance manifest helpers", () => {
  it("normalizes input manifest fields", () => {
    const normalized = normalizeDataConnectorManifest(buildManifest({
      providerId: "Acme_Drive_Service",
      sourceType: "Cloud_File_Source",
      capabilities: ["sync", "sync", "localQuery"],
      localQuery: {
        enabled: false,
        remoteCallsAllowed: true
      }
    }));

    expect(normalized).toMatchObject({
      protocolVersion: "pact.data-connector.v1",
      providerId: "acme-drive-service",
      sourceType: "cloud-file-source",
      displayName: "Acme Drive",
      version: "3.1.4",
      capabilities: ["sync", "localQuery"],
      auth: {
        type: "oauth2",
        refreshRequired: true,
        tokenStorage: "secret-store",
        scopes: ["files.read", "files.write"]
      },
      sync: {
        mode: "incrementalCursor",
        cursorField: "nextPageToken",
        conflictPolicy: "newerCapturedAtWins",
        hashCollisionPolicy: "quarantine",
        rateLimit: {
          maxItemsPerSync: 2,
          maxBytesPerSync: 1024
        }
      },
      localQuery: {
        enabled: false,
        remoteCallsAllowed: false,
        dedupeWithServerEvidence: true,
        maxLocalHits: 50
      },
      mirror: {
        mode: "localMirror",
        cleanupRequired: true,
        dedupeKeys: ["providerId", "sourceType", "externalId", "contentHash"],
        retainIngestedKnowledgeOnUninstall: true
      },
      uninstall: {
        removeMirrorDefault: true,
        retainIngestedKnowledge: true
      },
      security: {
        secretRefs: ["secret://acme/oauth"],
        dataClasses: ["business"]
      }
    });
    expect(normalized.metadata).toEqual({ region: "us-east-1" });
  });

  it("validates manifests and forces local-query remote calls false", () => {
    const valid = validateDataConnectorManifest(buildManifest());
    expect(valid.ok).toBe(true);
    expect(valid.protocolVersion).toBe(DATA_CONNECTOR_GOVERNANCE_PROTOCOL_VERSION);
    expect(valid.contract.localQueryRemoteCallsAllowed).toBe(false);
    expect(valid.contract.mirrorProtocolVersion).toBe(LOCAL_MIRROR_PROTOCOL_VERSION);
    expect(valid.warnings).toHaveLength(0);

    const withInvalidProvider = validateDataConnectorManifest(buildManifest({
      providerId: "1Invalid"
    }));
    expect(withInvalidProvider.ok).toBe(false);
    expect(withInvalidProvider.errors).toEqual([expect.stringContaining("providerId must be")]);

    const oauthMissingRefresh = validateDataConnectorManifest(buildManifest({
      auth: { type: "oauth2", refreshRequired: false }
    }));
    expect(oauthMissingRefresh.ok).toBe(false);
    expect(oauthMissingRefresh.errors).toEqual([expect.stringContaining("oauth2 connectors must declare refreshRequired=true")]);
    expect(oauthMissingRefresh.errors).toEqual([expect.stringContaining("must")]);
  });

  it("reports invalid dedupe key and rejects unsupported auth", () => {
    const badDedupe = validateDataConnectorManifest(buildManifest({
      mirror: { dedupeKeys: ["providerId", "sourceType"] }
    }));
    expect(badDedupe.ok).toBe(false);
    expect(badDedupe.errors).toEqual(expect.arrayContaining([
      expect.stringContaining("mirror.dedupeKeys must include externalId and contentHash")
    ]));

    const badAuth = validateDataConnectorManifest(buildManifest({
      auth: { type: "unsupported" }
    }));
    expect(badAuth.ok).toBe(false);
    expect(badAuth.errors).toEqual([expect.stringContaining("auth.type is not supported")]);
  });
});

describe("createDataConnectorGovernance lifecycle", () => {
  it("describes empty state with temporary storage", () => withTempGovernance(async ({ governance }) => {
    const state = await governance.describe();
    expect(state).toMatchObject({
      ok: true,
      protocolVersion: DATA_CONNECTOR_GOVERNANCE_PROTOCOL_VERSION,
      summary: {
        connectorCount: 0,
        activeConnectorCount: 0,
        mirrorProviderCount: 0,
        syncRunCount: 0,
        auditEventCount: 0
      },
      connectors: [],
      recentSyncRuns: [],
      recentAuditEvents: [],
    });
    expect(state.updatedAt).toBeTruthy();
  }));

  it("plans manifest by returning validation result", async () => withTempGovernance(async ({ governance }) => {
    const planned = await governance.plan(buildManifest());
    expect(planned.ok).toBe(true);
    expect(planned.manifest.providerId).toBe("acme-drive");
    expect(planned.contract.syncMode).toBe("incrementalCursor");
  }));

  it("registers connectors and rejects invalid manifests", async () => withTempGovernance(async ({ governance }) => {
    const manifest = buildManifest({ providerId: "alpha-drive" });
    const result = await governance.register(manifest, { actor: "unit" });
    expect(result.ok).toBe(true);
    expect(result.connector.status).toBe("registered");
    expect(result.connector.providerId).toBe("alpha-drive");

    await expect(governance.register(buildManifest({ providerId: "alpha-drive", auth: { type: "oauth2", refreshRequired: false } })))
      .rejects.toMatchObject({
        message: "data connector manifest is invalid.",
        details: [expect.stringContaining("oauth2 connectors must declare refreshRequired=true")]
      });
  }));

  it("applies sync batches and tracks conflicts, unchanged items, and rate limits", async () => withTempGovernance(async ({ governance }) => {
    const manifest = buildManifest({ providerId: "beta-drive" });
    await governance.register(manifest, { actor: "unit" });

    const first = await governance.applySyncBatch({
      providerId: "beta-drive",
      syncBatchId: "batch-1",
      previousCursor: "",
      nextCursor: "cursor-1",
      items: [
        { externalId: "doc-1", title: "Doc 1", text: "alpha", contentHash: "h1", capturedAt: "2026-05-21T00:00:00.000Z" },
        { externalId: "doc-2", title: "Doc 2", text: "beta", contentHash: "h2", capturedAt: "2026-05-21T00:00:01.000Z" }
      ]
    });
    expect(first.ok).toBe(true);
    expect(first.run).toMatchObject({
      status: "completed",
      insertedCount: 2,
      skippedUnchangedCount: 0,
      conflictCount: 0,
      runId: expect.stringMatching(/^dcs_/)
    });

    const second = await governance.applySyncBatch({
      providerId: "beta-drive",
      syncBatchId: "batch-2",
      previousCursor: "cursor-1",
      nextCursor: "cursor-2",
      items: [
        { externalId: "doc-1", title: "Doc 1", text: "alpha", contentHash: "h1", capturedAt: "2026-05-21T00:00:00.000Z" },
        { externalId: "doc-2", title: "Doc 2", text: "beta updated", contentHash: "h2-new", capturedAt: "2026-05-21T00:01:00.000Z" }
      ]
    });
    expect(second.ok).toBe(true);
    expect(second.run.insertedCount).toBe(0);
    expect(second.run.conflictCount).toBe(1);
    expect(second.run.updatedCount).toBe(1);
    expect(second.run.skippedUnchangedCount).toBe(1);

    const tooMany = await governance.applySyncBatch({
      providerId: "beta-drive",
      syncBatchId: "batch-3",
      items: [
        { externalId: "r1", text: "rate 1", contentHash: "hr1" },
        { externalId: "r2", text: "rate 2", contentHash: "hr2" },
        { externalId: "r3", text: "rate 3", contentHash: "hr3" }
      ]
    });
    expect(tooMany.ok).toBe(false);
    expect(tooMany.run).toMatchObject({
      status: "rate_limited",
      itemCount: 3,
      maxItemsPerSync: 2
    });
    const state = await governance.describe();
    expect(state.summary.syncRunCount).toBe(3);
  }));

  it("cleans mirror in dry-run and committed modes", async () => withTempGovernance(async ({ governance }) => {
    await governance.register(buildManifest({ providerId: "gamma-drive" }), { actor: "unit" });
    await governance.applySyncBatch({
      providerId: "gamma-drive",
      syncBatchId: "batch-1",
      nextCursor: "cursor-1",
      items: [
        { externalId: "keep-me", contentHash: "k1", text: "keep" },
        { externalId: "remove-me", contentHash: "r1", text: "remove" }
      ]
    });

    const preview = await governance.cleanupMirror({
      providerId: "gamma-drive",
      retainExternalIds: ["keep-me"],
      dryRun: true
    });
    expect(preview.ok).toBe(true);
    expect(preview.dryRun).toBe(true);
    expect(preview.removedCount).toBe(1);
    expect(preview.plannedExternalIds).toEqual(["remove-me"]);

    const applied = await governance.cleanupMirror({
      providerId: "gamma-drive",
      retainExternalIds: ["keep-me"],
      dryRun: false
    });
    expect(applied.ok).toBe(true);
    expect(applied.dryRun).toBe(false);
    expect(applied.removedCount).toBe(1);
    expect(applied.mirror.recordCount).toBe(1);
    expect(applied.mirror.lastCursor).toBeTruthy();
  }));

  it("enforces local query policy as no-remote and can stay strict", async () => withTempGovernance(async ({ governance }) => {
    await governance.register(buildManifest({ providerId: "policy-drive" }), { actor: "unit" });

    const remoteWanted = await governance.enforceLocalQueryPolicy({ providerId: "policy-drive", requestedRemoteCallsAllowed: true });
    expect(remoteWanted).toMatchObject({
      ok: false,
      remoteCallsAllowed: false,
      requestedRemoteCallsAllowed: true,
      policy: "local-query-must-not-call-remote",
      providerId: "policy-drive"
    });

    const remoteAllowed = await governance.enforceLocalQueryPolicy({ providerId: "policy-drive", requestedRemoteCallsAllowed: false });
    expect(remoteAllowed.ok).toBe(true);
    expect(remoteAllowed.requestedRemoteCallsAllowed).toBe(false);
  }));

  it("uninstalls connectors and optionally removes mirror state", async () => withTempGovernance(async ({ governance }) => {
    await governance.register(buildManifest({ providerId: "uninstall-drive" }), { actor: "unit" });
    await governance.applySyncBatch({
      providerId: "uninstall-drive",
      syncBatchId: "batch-1",
      items: [
        { externalId: "doc-1", contentHash: "h1", text: "before uninstall" }
      ]
    });

    const uninstallWithoutMirror = await governance.uninstall({ providerId: "uninstall-drive", removeMirror: false, actor: "unit" });
    expect(uninstallWithoutMirror.ok).toBe(true);
    expect(uninstallWithoutMirror.connector.status).toBe("uninstalled");
    expect(uninstallWithoutMirror.removedMirror).toBe(false);

    const before = await governance.describe();
    expect(before.connectors[0].status).toBe("uninstalled");
    expect(before.summary.activeConnectorCount).toBe(0);

    const uninstallNoop = await governance.uninstall({
      providerId: "uninstall-drive",
      removeMirror: true,
      actor: "unit"
    });
    expect(uninstallNoop.connector.status).toBe("uninstalled");
    expect(uninstallNoop.removedMirror).toBe(true);
    await expect(governance.applySyncBatch({
      providerId: "uninstall-drive",
      syncBatchId: "blocked"
    })).rejects.toThrow(/unknown or inactive data connector/);
  }));

  it("runs conformance with full pass/fail branches", async () => withTempGovernance(async ({ governance }) => {
    const manifest = buildManifest({
      providerId: "conformance-drive",
      version: "0.0.0"
    });
    const passResult = await governance.runConformance(manifest);
    expect(passResult.ok).toBe(true);
    expect(passResult.status).toBe("pass");
    expect(passResult.protocolVersion).toBe(DATA_CONNECTOR_GOVERNANCE_PROTOCOL_VERSION);
    expect(passResult.connector.providerId).toBe("conformance-drive");
    expect(passResult.checks.map((check) => check.id)).toEqual([
      "manifest-validation",
      "oauth-refresh-policy",
      "incremental-cursor",
      "conflict-resolution",
      "hash-collision-detection",
      "rate-limit",
      "local-query-no-remote",
      "mirror-cleanup",
      "uninstall-policy"
    ]);
    expect(passResult.checks.every((check) => check.status === "pass")).toBe(true);

    const invalid = await governance.runConformance(buildManifest({
      providerId: "bad-drive",
      auth: { type: "oauth2", refreshRequired: false }
    }));
    expect(invalid.ok).toBe(false);
    expect(invalid.status).toBe("failed");
    expect(invalid.checks).toEqual([{ id: "manifest-validation", status: "fail", errors: expect.arrayContaining([expect.stringContaining("refreshRequired")]) }]);
  }));
});
