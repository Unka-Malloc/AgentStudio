import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../../../server/platform/specialized/capabilities/package-lifecycle/index.mjs", () => ({
  createCapabilityPackageRegistry: vi.fn(() => ({
    describe: vi.fn(async () => ({ packages: [] })),
    plan: vi.fn(async (input) => ({ ok: true, plan: input })),
    submit: vi.fn(async (input, context) => ({ ok: true, packageId: "pkg-1", input, context })),
    rollback: vi.fn(async (input) => ({ ok: true, action: "rollback", input })),
    lifecycle: vi.fn(async (packageId, input) => {
      if (packageId === "conflict") {
        throw new Error("conflict");
      }
      return { ok: true, packageId, input };
    })
  }))
}));

vi.mock("../../../server/platform/specialized/capabilities/code-management/codespace/index.mjs", () => ({
  createCodespaceRegistry: vi.fn(() => ({
    providerManifest: vi.fn(async () => ({ providers: [{ id: "gerrit" }] })),
    repositoryStatus: vi.fn(async () => ({ ok: false, status: 418, reason: "teapot" })),
    listTree: vi.fn(async () => ({ ok: true, items: [] })),
    readFile: vi.fn(async () => ({ ok: true, text: "hello" })),
    readDiff: vi.fn(async () => ({ ok: true, diff: "" })),
    prepareChange: vi.fn(async (input) => ({ changeId: "change-1", input })),
    uploadCodespaceChange: vi.fn(async () => ({ ok: true, reviewUrl: "https://review.invalid/1" })),
    reviewComment: vi.fn(async () => ({ ok: true, commentId: "c-1" })),
    reviewRequestChanges: vi.fn(async () => ({ ok: true, vote: -1 })),
    reviewApprove: vi.fn(async () => ({ ok: true, vote: 1 })),
    syncStatus: vi.fn(async (input) => ({ ok: true, input })),
    evaluateTarget: vi.fn(async () => ({ ok: true, target: "main" })),
    uploadChange: vi.fn(async () => ({ ok: false, status: 409, error: "conflict" })),
    linkChange: vi.fn(async () => ({ ok: true, linkId: "link-1" }))
  }))
}));

vi.mock("../../../server/platform/specialized/capabilities/code-review/gerrit/index.mjs", () => ({
  GERRIT_ACTIONS: {
    read: ["query"],
    write: ["comment"],
    maintain: ["abandon"]
  },
  executeGerritCommonOperation: vi.fn(async ({ mode }) => {
    if (mode === "maintain") {
      throw new Error("maintain failed");
    }
    return { ok: true, mode, result: { value: 1 } };
  }),
  uploadGerritGitChange: vi.fn(async (input) => ({
    ok: input.fail !== true,
    status: input.fail === true ? 422 : 200,
    uploaded: input.fail !== true
  }))
}));

vi.mock("../../../server/platform/specialized/capabilities/code-repository/repo-operations/index.mjs", () => ({
  executeRepoOperation: vi.fn(async ({ operationId }) => {
    if (operationId === "repo.throw") {
      throw new Error("repo failed");
    }
    return { ok: operationId !== "repo.denied", status: operationId === "repo.denied" ? 403 : 200, operationId };
  })
}));

vi.mock("../../../server/platform/specialized/knowledge/transformation/knowledge-transformation-provider.mjs", () => ({
  createKnowledgeTransformationProvider: vi.fn(() => ({
    convertRawCorpus: vi.fn(async () => ({
      ok: true,
      converted: true,
      knowledgeAccessDecision: {
        decisionId: "decision-1",
        knowledgeAccessReceipt: { subjectId: "u-1" },
        loanRecord: { subjectId: "u-1" },
        deniedRequestAudit: { reason: "test" },
        filteredReason: "test_reason"
      }
    })),
    exportDossier: vi.fn(async () => ({ ok: true, dossierId: "dossier-1" })),
    exportDistillation: vi.fn(async () => ({ ok: true }))
  }))
}));

vi.mock("../../../server/platform/specialized/knowledge/assets/asset-lineage/index.mjs", () => ({
  createAssetLineageRegistry: vi.fn(() => ({
    describe: vi.fn(async () => ({ protocolVersion: "pact.asset-lineage.v1" })),
    record: vi.fn(async (record) => {
      if (record?.fail) throw new Error("record failed");
      return { ok: true, recordId: "lineage-1" };
    }),
    trace: vi.fn(async (input) => ({ ok: true, input })),
    planReparse: vi.fn(async (input) => ({ ok: true, input }))
  }))
}));

vi.mock("../../../server/platform/specialized/knowledge/connectors/data-connector-governance/index.mjs", () => ({
  createDataConnectorGovernance: vi.fn(() => ({
    describe: vi.fn(async () => ({ ok: true, connectors: [] })),
    plan: vi.fn(async (manifest) => ({ ok: true, manifest })),
    runConformance: vi.fn(async (manifest) => {
      if (manifest?.fail) {
        throw Object.assign(new Error("conformance failed"), { details: ["bad manifest"] });
      }
      return { ok: true, manifest };
    })
  }))
}));

vi.mock("../../../server/platform/specialized/knowledge/performance/capacity-benchmark/index.mjs", () => ({
  listCapacityBenchmarkTargets: vi.fn(() => [{ targetId: "retrieval" }]),
  runPerformanceCapacityBenchmark: vi.fn(async (input) => {
    if (input.failureInjection?.throw) {
      throw new Error("benchmark failed");
    }
    return { ok: true, input };
  })
}));

let executeConsoleDomainOperation;

beforeAll(async () => {
  ({ executeConsoleDomainOperation } = await import(
    "../../../server/platform/specialized/console/console-domain-operation-executor.mjs"
  ));
});

async function withTempDir(testCase) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pact-console-more-"));
  try {
    return await testCase(root);
  } finally {
    await fs.rm(root, { force: true, recursive: true });
  }
}

async function runOperation(operationId, { input = {}, context = {} } = {}) {
  return executeConsoleDomainOperation({ operationId, input, context });
}

describe("console-domain executor additional dispatch coverage", () => {
  it("covers system interface fallback/core provider, path browse, and unregistered operations", async () => {
    await withTempDir(async (userDataPath) => {
      await fs.writeFile(path.join(userDataPath, "alpha.txt"), "hello", "utf8");

      await expect(runOperation("system.interfaces", {
        context: {
          coreProvider: {
            buildSystemInterfaces: vi.fn(() => ({ source: "core-provider" }))
          },
          getControllers: vi.fn(() => ["controller"]),
          getFeatureEntries: vi.fn(() => ["feature"])
        }
      })).resolves.toMatchObject({ status: 200, payload: { source: "core-provider" } });
      await expect(runOperation("system.interfaces", {
        context: {
          getInterfaceCatalog: vi.fn(() => [{ id: "http" }]),
          getFeatureEntries: vi.fn(() => [{ id: "feature-a" }])
        }
      })).resolves.toMatchObject({
        status: 200,
        payload: {
          transport: { http: "direct" },
          interfaces: [{ id: "http" }],
          features: [{ id: "feature-a" }]
        }
      });
      await expect(runOperation("runtime.path_browse", {
        input: { path: userDataPath, mode: "file", extensions: ".txt", includeHidden: false },
        context: { userDataPath }
      })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("missing.operation", {})).resolves.toMatchObject({
        status: 501,
        payload: {
          ok: false,
          error: { code: "console_domain_operation_not_registered" }
        }
      });
    });
  });

  it("covers capability package and workspace governance dispatch branches", async () => {
    await withTempDir(async (userDataPath) => {
      const context = {
        userDataPath,
        authSession: { user: { username: "alice" } }
      };
      const calls = [
        ["capability_packages.list", {}, 200],
        ["capability_packages.plan", { name: "pkg" }, 200],
        ["capability_packages.submit", { name: "pkg" }, 200],
        ["capability_packages.lifecycle", { packageId: "pkg-1", action: "publish" }, 200],
        ["capability_packages.lifecycle", { action: "rollback", kind: "skill", name: "pkg" }, 200],
        ["capability_packages.lifecycle", { packageId: "conflict", action: "publish" }, 409],
        ["workspace_governance.describe", {}, 200],
        ["workspace_governance.policy.set", { workspaceId: "ws-1", copyPolicy: "approval" }, 200],
        ["workspace_governance.evaluate", { workspaceId: "ws-1", action: "read" }, 200],
        ["workspace_governance.share_grant", { workspaceId: "ws-1", subjectId: "u-1", actions: ["read"] }, 200],
        ["workspace_governance.policy.set", { workspaceId: "" }, 200]
      ];
      for (const [operationId, input, status] of calls) {
        await expect(runOperation(operationId, { input, context })).resolves.toMatchObject({ status });
      }
    });
  });

  it("covers codespace, Gerrit, and repository domain dispatch branches", async () => {
    await withTempDir(async (userDataPath) => {
      const context = {
        userDataPath,
        authSession: { user: { username: "alice" } }
      };
      const calls = [
        ["codespace.providers.manifest", {}, 200],
        ["codespace.repository.status", {}, 418],
        ["codespace.tree.list", {}, 200],
        ["codespace.file.read", {}, 200],
        ["codespace.diff.read", {}, 200],
        ["codespace.change.prepare", {}, 200],
        ["codespace.change.upload", {}, 200],
        ["codespace.review.comment", {}, 200],
        ["codespace.review.requestChanges", {}, 200],
        ["codespace.review.approve", {}, 200],
        ["codespace.review.status.sync", {}, 200],
        ["workspace.code.target.evaluate", {}, 200],
        ["workspace.code.change.prepare", {}, 200],
        ["workspace.code.change.upload", {}, 409],
        ["workspace.code.change.link", {}, 200],
        ["workspace.code.change.status.sync", {}, 200],
        ["gerrit.read", {}, 200],
        ["gerrit.write", {}, 200],
        ["gerrit.maintain", {}, 400],
        ["gerrit.git_upload", {}, 200],
        ["gerrit.git_upload", { fail: true }, 422],
        ["repo.status", {}, 200],
        ["repo.denied", {}, 403],
        ["repo.throw", {}, 400]
      ];
      for (const [operationId, input, status] of calls) {
        await expect(runOperation(operationId, { input, context })).resolves.toMatchObject({ status });
      }
    });
  });

  it("covers transformation, lineage, data connector, performance, and OAuth return dispatch", async () => {
    await withTempDir(async (userDataPath) => {
      const securityPermissions = {
        appendReceipt: vi.fn(),
        appendLoanRecord: vi.fn(),
        appendDeniedRequest: vi.fn()
      };
      const context = {
        userDataPath,
        runtime: { mounts: { knowledgeBase: {} } },
        metadataStore: {},
        authSession: { user: { userId: "u-1", username: "alice" } },
        securityPermissions
      };
      const calls = [
        ["raw-corpus.format.convert", {}, 200],
        ["knowledge.dossier.export", {}, 200],
        ["knowledge.distillation.export", {}, 410],
        ["asset_lineage.describe", {}, 200],
        ["asset_lineage.record", { record: { sourceId: "s-1" } }, 200],
        ["asset_lineage.record", { record: { fail: true } }, 400],
        ["asset_lineage.trace", { sourceId: "s-1" }, 200],
        ["asset_lineage.reparse_plan", { sourceId: "s-1" }, 200],
        ["data_connectors.governance.describe", {}, 200],
        ["data_connectors.governance.plan", { manifest: { connectorId: "c-1" } }, 200],
        ["data_connectors.governance.conformance", { manifest: { connectorId: "c-1" } }, 200],
        ["data_connectors.governance.conformance", { manifest: { fail: true } }, 400],
        ["performance.capacity.targets", {}, 200],
        ["performance.capacity.benchmark", { profileId: "smoke" }, 200],
        ["performance.capacity.benchmark", { failureInjection: { throw: true } }, 400],
        ["oauth.codex_return", {}, 200]
      ];
      for (const [operationId, input, status] of calls) {
        await expect(runOperation(operationId, { input, context })).resolves.toMatchObject({ status });
      }
      expect(securityPermissions.appendReceipt).toHaveBeenCalled();
      expect(securityPermissions.appendLoanRecord).toHaveBeenCalled();
      expect(securityPermissions.appendDeniedRequest).toHaveBeenCalled();
    });
  });
});
