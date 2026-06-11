import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 30_000 });

const runtimeDependenciesMock = vi.hoisted(() => ({
  listRuntimeDependencies: vi.fn(async () => ({ dependencies: [{ id: "runtime-a" }] })),
  downloadRuntimeDependency: vi.fn(),
  updateRuntimeDependencyConfiguration: vi.fn()
}));

const workspaceContributionMock = vi.hoisted(() => ({
  createContributionRegistry: vi.fn(() => ({
    submitContribution: vi.fn((payload) => ({
      contributionId: payload.contributionId || "contribution-1",
      ...payload
    })),
    listContributions: vi.fn(() => [
      {
        contributionId: "contribution-1",
        workspaceId: "ws-1",
        contributionType: "knowledge",
        title: "knowledge item",
        skillManifestRef: "skill-1"
      },
      {
        contributionId: "skill-1",
        workspaceId: "ws-1",
        contributionType: "skill",
        title: "skill-1",
        skillManifestRef: "skill-1"
      }
    ]),
    listWorkspaceAssets: vi.fn(() => [{ id: "asset-1" }]),
    getLeaderboard: vi.fn(() => [{ workspaceId: "ws-1", points: 7 }]),
    getStats: vi.fn(() => ({ total: 1, approved: 1 })),
    getContributionReport: vi.fn(() => ({ report: true })),
    requestPermission: vi.fn((_id, payload) => ({ permissionId: "perm-1", ...payload })),
    grantPermission: vi.fn((_id, payload) => ({ grant: { grantId: "grant-1" }, loanRecord: { id: "loan-1", ...payload } })),
    scanContribution: vi.fn(() => ({ scanned: true })),
    reviewContribution: vi.fn(() => ({ reviewed: true })),
    previewContribution: vi.fn(() => ({ previewed: true })),
    publishContribution: vi.fn(() => ({ published: true })),
    adoptContribution: vi.fn(() => ({ adopted: true })),
    rejectContribution: vi.fn(() => ({ rejected: true })),
    requestChanges: vi.fn(() => ({ changed: true })),
    revokeContribution: vi.fn(() => ({ revoked: true })),
    recordUsage: vi.fn(() => ({ recorded: true }))
  }))
}));

const knowledgeAccessMock = vi.hoisted(() => ({
  evaluateKnowledgeAccess: vi.fn(() => ({
    decisionId: "dec-1",
    knowledgeAccessReceipt: {
      subject: { subjectId: "user-1" }
    },
    loanRecord: {
      subject: { subjectId: "user-1" }
    },
    deniedRequestAudit: null,
    filteredReason: "allow"
  }))
}));

const knowledgeBackendPortMock = vi.hoisted(() => ({
  createKnowledgeBackendPort: vi.fn(() => ({
    connect: vi.fn(async () => ({ ok: true, connected: true })),
    listSpaces: vi.fn(async () => ({ ok: true, spaces: [{ id: "space-1" }] })),
    requestExport: vi.fn(async () => ({
      httpStatus: 202,
      accessDecision: {
        knowledgeAccessReceipt: { subject: { subjectId: "user-1" } },
        loanRecord: { subject: { subjectId: "user-1" } }
      }
    })),
    requestPermission: vi.fn(async () => ({ ok: true, granted: true })),
    search: vi.fn(async () => ({ ok: true, items: [{ id: "kb-1" }] })),
    getEvidence: vi.fn(async () => ({
      httpStatus: 200,
      evidenceId: "kb-1",
      accessDecision: {
        knowledgeAccessReceipt: { subject: { subjectId: "user-1" } },
        loanRecord: { subject: { subjectId: "user-1" } }
      }
    }))
  })),
  isKnowledgeBackendEvidenceId: vi.fn((value) => String(value || "").startsWith("kb:"))
}));

const sourceFileSearchMock = vi.hoisted(() => ({
  searchSourceFiles: vi.fn(async () => ({ items: [{ id: "source-hit" }], count: 1 })),
  isSourceEvidenceId: vi.fn((value) => String(value || "").startsWith("source:")),
  getSourceFileEvidence: vi.fn(async () => ({ evidenceId: "source:1", content: "file" }))
}));

const knowledgeTransformationMock = vi.hoisted(() => ({
  createKnowledgeTransformationProvider: vi.fn(() => ({
    convertRawCorpus: vi.fn(async () => ({ ok: true, converted: true })),
    exportDossier: vi.fn(async () => ({ ok: true, dossier: true }))
  }))
}));

const externalDistillationMock = vi.hoisted(() => ({
  resolveExternalKnowledgeDistillationConfig: vi.fn(({ input = {}, settings = {} }) => ({
    baseUrl: input.baseUrl || settings.externalKnowledgeDistillationBaseUrl || "https://distill.example"
  })),
  createExternalKnowledgeDistillationClient: vi.fn((config) => ({
    baseUrl: config.baseUrl,
    health: vi.fn(async () => ({ ok: true, healthy: true })),
    capabilities: vi.fn(async () => ({ ok: true, capabilities: ["runs"] })),
    runtimeHealth: vi.fn(async () => ({ ok: true, healthy: true })),
    listRuns: vi.fn(async () => ({ ok: true, items: [] })),
    createRun: vi.fn(async () => ({ ok: true, runId: "run-1" })),
    getRun: vi.fn(async () => ({ ok: true, runId: "run-1" })),
    cancelRun: vi.fn(async () => ({ ok: true, canceled: true })),
    queryEvidence: vi.fn(async () => ({ ok: true, evidence: [] })),
    queryProjectEvidence: vi.fn(async () => ({ ok: true, evidence: [] })),
    exportArtifact: vi.fn(async () => ({
      contentType: "text/plain",
      fileName: "artifact.txt",
      buffer: Buffer.from("artifact"),
      pactExternalServiceCall: {
        durationMs: 7,
        transferBytes: 9,
        bytesPerSecond: 11
      }
    }))
  }))
}));

const codespaceMock = vi.hoisted(() => ({
  createCodespaceRegistry: vi.fn(() => ({
    providerManifest: vi.fn(async () => ({ ok: true, providers: ["gerrit"] })),
    repositoryStatus: vi.fn(async () => ({ ok: true, repos: [{ name: "repo-1" }] })),
    listTree: vi.fn(async () => ({ ok: true, items: [{ path: "src" }] })),
    readFile: vi.fn(async () => ({ ok: true, content: "file" })),
    readDiff: vi.fn(async () => ({ ok: true, diff: "diff" })),
    prepareChange: vi.fn(async () => ({ ok: true, prepared: true })),
    uploadCodespaceChange: vi.fn(async () => ({ ok: true, uploaded: true })),
    reviewComment: vi.fn(async () => ({ ok: true, commented: true })),
    reviewRequestChanges: vi.fn(async () => ({ ok: true, requestedChanges: true })),
    reviewApprove: vi.fn(async () => ({ ok: true, approved: true })),
    syncStatus: vi.fn(async () => ({ ok: true, synced: true })),
    evaluateTarget: vi.fn(async () => ({ ok: true, target: "main" })),
    uploadChange: vi.fn(async () => ({ ok: true, uploaded: true })),
    linkChange: vi.fn(async () => ({ ok: true, linked: true }))
  }))
}));

const workspaceGovernanceMock = vi.hoisted(() => ({
  createWorkspaceGovernanceRegistry: vi.fn(() => ({
    describe: vi.fn(async () => ({ ok: true, governance: "describe" })),
    upsertPolicy: vi.fn(async (policy) => ({ ok: true, policy })),
    evaluate: vi.fn(async (input) => ({ ok: true, input })),
    createShareGrant: vi.fn(async (input) => ({ ok: true, input }))
  }))
}));

const capabilityPackageMock = vi.hoisted(() => ({
  createCapabilityPackageRegistry: vi.fn(() => ({
    describe: vi.fn(async () => ({ ok: true, packages: [{ id: "pkg-1" }] })),
    plan: vi.fn(async (input) => ({ ok: true, input })),
    submit: vi.fn(async (input, meta) => ({ ok: true, input, meta })),
    rollback: vi.fn(async (input) => ({ ok: true, input })),
    lifecycle: vi.fn(async (packageId, input) => ({ ok: true, packageId, input }))
  }))
}));

const gerritMock = vi.hoisted(() => ({
  GERRIT_ACTIONS: {
    read: ["read"],
    write: ["write"],
    maintain: ["maintain"]
  },
  executeGerritCommonOperation: vi.fn(async ({ mode, input }) => ({
    ok: true,
    result: { mode, input }
  })),
  uploadGerritGitChange: vi.fn(async (input) => ({
    ok: true,
    changeId: "gerrit-change-1",
    branch: input.branch || "main"
  }))
}));

const assetLineageMock = vi.hoisted(() => ({
  createAssetLineageRegistry: vi.fn(() => ({
    describe: vi.fn(async () => ({ ok: true, lineage: true })),
    record: vi.fn(async () => { throw new Error("asset lineage record failed"); }),
    trace: vi.fn(async () => { throw new Error("asset lineage trace failed"); }),
    planReparse: vi.fn(async () => { throw new Error("asset lineage reparse failed"); })
  }))
}));

const repoOperationsMock = vi.hoisted(() => ({
  executeRepoOperation: vi.fn(async ({ operationId }) => {
    if (operationId === "repo.no_status") {
      return { ok: false, error: "missing status" };
    }
    if (operationId === "repo.denied") {
      return { ok: false, status: 403, error: "denied" };
    }
    if (operationId === "repo.throw") {
      throw new Error("repo exploded");
    }
    return { ok: true, operationId };
  })
}));

const performanceCapacityMock = vi.hoisted(() => ({
  listCapacityBenchmarkTargets: vi.fn(() => [{ targetId: "cpu" }]),
  runPerformanceCapacityBenchmark: vi.fn()
}));

const dataConnectorMock = vi.hoisted(() => ({
  createDataConnectorGovernance: vi.fn(() => ({
    describe: vi.fn(() => ({ ok: true, source: "data-connectors" })),
    plan: vi.fn((manifest) => ({ ok: true, manifest })),
    runConformance: vi.fn((manifest) => {
      if (manifest?.fail) {
        throw Object.assign(new Error("bad conformance"), { details: ["invalid"] });
      }
      return { ok: true, manifest };
    })
  }))
}));

vi.mock("../../../server/platform/specialized/capabilities/runtime-dependencies/index.mjs", () => runtimeDependenciesMock);
vi.mock("../../../server/platform/specialized/agent/workspace-contribution/index.mjs", () => workspaceContributionMock);
vi.mock("../../../server/platform/specialized/knowledge/agent-library/access-policy.mjs", () => knowledgeAccessMock);
vi.mock("../../../server/platform/specialized/knowledge/storage/knowledge-backend-port/index.mjs", () => knowledgeBackendPortMock);
vi.mock("../../../server/platform/specialized/knowledge/retrieval/source-file-search-service.mjs", () => sourceFileSearchMock);
vi.mock("../../../server/platform/specialized/knowledge/transformation/knowledge-transformation-provider.mjs", () => knowledgeTransformationMock);
vi.mock("../../../server/platform/specialized/knowledge/invocation/external-distillation-service/index.mjs", () => externalDistillationMock);
vi.mock("../../../server/platform/specialized/capabilities/code-management/codespace/index.mjs", () => codespaceMock);
vi.mock("../../../server/platform/specialized/agent/workspace-governance/index.mjs", () => workspaceGovernanceMock);
vi.mock("../../../server/platform/specialized/capabilities/package-lifecycle/index.mjs", () => capabilityPackageMock);
vi.mock("../../../server/platform/specialized/capabilities/code-review/gerrit/index.mjs", () => gerritMock);
vi.mock("../../../server/platform/specialized/capabilities/code-repository/repo-operations/index.mjs", () => repoOperationsMock);
vi.mock("../../../server/platform/specialized/knowledge/assets/asset-lineage/index.mjs", () => assetLineageMock);
vi.mock("../../../server/platform/specialized/knowledge/performance/capacity-benchmark/index.mjs", () => performanceCapacityMock);
vi.mock("../../../server/platform/specialized/knowledge/connectors/data-connector-governance/index.mjs", () => dataConnectorMock);

let executeConsoleDomainOperation;

beforeAll(async () => {
  ({ executeConsoleDomainOperation } = await import(
    "../../../server/platform/specialized/console/console-domain-operation-executor.mjs"
  ));
});

beforeEach(() => {
  vi.clearAllMocks();
  runtimeDependenciesMock.downloadRuntimeDependency.mockResolvedValue({ ok: true, dependencyId: "runtime-a" });
  runtimeDependenciesMock.updateRuntimeDependencyConfiguration.mockResolvedValue({ ok: true, saved: true });
  performanceCapacityMock.runPerformanceCapacityBenchmark.mockResolvedValue({ ok: true, profileId: "smoke" });
  repoOperationsMock.executeRepoOperation.mockImplementation(async ({ operationId }) => {
    if (operationId === "repo.no_status") {
      return { ok: false, error: "missing status" };
    }
    if (operationId === "repo.denied") {
      return { ok: false, status: 403, error: "denied" };
    }
    if (operationId === "repo.throw") {
      throw new Error("repo exploded");
    }
    return { ok: true, operationId };
  });
});

async function withTempDir(testCase) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pact-console-domain-fifth-"));
  try {
    return await testCase(root);
  } finally {
    await fs.rm(root, { force: true, recursive: true });
  }
}

async function runOperation(operationId, { input = {}, context = {} } = {}) {
  return executeConsoleDomainOperation({ operationId, input, context });
}

describe("console-domain operation edge coverage", () => {
  it("normalizes knowledge search inputs, response profiles, and workspace context", async () => {
    await withTempDir(async () => {
      const knowledgeCore = {
        search: vi.fn(async (input) => ({
          ok: true,
          items: [{ evidenceId: "e-1" }],
          searchInput: input
        }))
      };
      const workspaceContext = { workspaceId: "ws-1", contextProfileId: "ctx-1", modelAlias: "model-a" };
      const agentWorkspace = {
        getWorkspaceContext: vi.fn(() => workspaceContext)
      };

      const first = await runOperation("knowledge.search", {
        input: {
          query: "needle",
          limit: "7",
          batchId: "batch-1",
          responseProfile: "tool",
          learningEnabled: "true",
          hierarchyReasoning: "yes",
          modelEnabled: "1",
          explain: "on",
          machineReadable: "false",
          filters: { modality: "image", custom: "yes" },
          workspaceId: "ws-1",
          sourceIds: ["source-1"]
        },
        context: {
          runtime: { mounts: { knowledgeBase: knowledgeCore } },
          agentWorkspace,
          authSession: { user: { userId: "u-1", username: "alice", roleId: "tool-grant" } }
        }
      });

      expect(first).toMatchObject({
        status: 200,
        payload: {
          items: [{ evidenceId: "e-1" }],
          workspaceContext
        }
      });
      expect(knowledgeCore.search).toHaveBeenCalledWith(expect.objectContaining({
        query: "needle",
        limit: 7,
        batchId: "batch-1",
        responseProfile: "agent",
        requestSurface: "agent",
        machineReadable: false,
        agentMessage: false,
        learningEnabled: true,
        hierarchyReasoning: true,
        modelEnabled: true,
        explain: true,
        scopeSourceIds: ["source-1"]
      }));

      await expect(runOperation("knowledge.search", {
        input: { query: "api-call", responseProfile: "http" },
        context: {
          runtime: { mounts: { knowledgeBase: knowledgeCore } },
          agentWorkspace,
          authSession: { user: { userId: "u-2", username: "bob" } }
        }
      })).resolves.toMatchObject({ status: 200 });

      await expect(runOperation("knowledge.search", {
        input: { query: "console-call", responseProfile: "console" },
        context: {
          runtime: { mounts: { knowledgeBase: knowledgeCore } },
          agentWorkspace,
          authSession: { user: { userId: "u-3", username: "carol" } }
        }
      })).resolves.toMatchObject({ status: 200 });

      await expect(runOperation("knowledge.search", {
        input: { query: "tool-grant-default" },
        context: {
          runtime: { mounts: { knowledgeBase: knowledgeCore } },
          agentWorkspace,
          authSession: { user: { userId: "u-4", username: "dana", roleId: "tool-grant" } }
        }
      })).resolves.toMatchObject({ status: 200 });
    });
  });

  it("covers path browser root discovery, truncation, and error fallback", async () => {
    await withTempDir(async (root) => {
      const homeDir = await fs.mkdtemp(path.join(root, "home-"));
      await fs.mkdir(path.join(homeDir, "OneDrive - Work"));
      const homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(homeDir);
      try {
        const browseDir = path.join(root, "browse");
        await fs.mkdir(browseDir);
        for (let i = 0; i < 605; i += 1) {
          await fs.writeFile(path.join(browseDir, `file-${String(i).padStart(3, "0")}.txt`), String(i));
        }
        const singleFile = path.join(browseDir, "single.txt");
        await fs.writeFile(singleFile, "single");

        const fileResult = await runOperation("runtime.path_browse", {
          input: { path: singleFile, mode: "file", includeHidden: false },
          context: { userDataPath: root }
        });
        expect(fileResult.status).toBe(200);
        expect(fileResult.payload.currentPath).toBe(browseDir);
        expect(fileResult.payload.roots.some((item) => String(item.label || "").startsWith("OneDrive"))).toBe(true);

        const truncatedResult = await runOperation("runtime.path_browse", {
          input: { path: browseDir, mode: "file", includeHidden: false },
          context: { userDataPath: root }
        });
        expect(truncatedResult.status).toBe(200);
        expect(truncatedResult.payload.truncated).toBe(true);
        expect(truncatedResult.payload.entries.length).toBe(600);

        const missingPathResult = await runOperation("runtime.path_browse", {
          input: { path: path.join(root, "missing", "nested", "file.txt"), mode: "file" },
          context: { userDataPath: root }
        });
        expect(missingPathResult.status).toBe(200);
        expect(missingPathResult.payload.error).toBeTruthy();
      } finally {
        homedirSpy.mockRestore();
      }
    });
  });

  it("covers devops and monitoring optional-provider branches", async () => {
    await expect(runOperation("system.monitor_alerts.get", { context: {} }))
      .resolves.toMatchObject({ status: 503, payload: { error: "运维 provider 不可用。" } });
    await expect(runOperation("system.background_processes", { context: {} }))
      .resolves.toMatchObject({ status: 503, payload: { error: "运维 provider 不可用。" } });

    const partialDevops = {};
    await expect(runOperation("system.monitor_alerts.get", { context: { devopsProvider: partialDevops } }))
      .resolves.toMatchObject({ status: 503, payload: { error: "监控报警状态接口不可用。" } });
    await expect(runOperation("system.monitor_alerts.set", { context: { devopsProvider: partialDevops } }))
      .resolves.toMatchObject({ status: 503, payload: { error: "监控报警配置接口不可用。" } });
    await expect(runOperation("system.monitor_alerts.ack", { context: { devopsProvider: partialDevops } }))
      .resolves.toMatchObject({ status: 503, payload: { error: "监控报警确认接口不可用。" } });
    await expect(runOperation("system.background_supervisor.recover", { context: { devopsProvider: partialDevops } }))
      .resolves.toMatchObject({ status: 503, payload: { error: "后台 Worker 管理进程恢复接口不可用。" } });

    const fullDevops = {
      getBackgroundProcessStatus: vi.fn(async () => ({ ok: true, processes: [] })),
      getMonitorAlertState: vi.fn(async () => ({ ok: true, alerts: [] })),
      saveMonitorAlertConfig: vi.fn(async (config) => ({ ok: true, config })),
      acknowledgeMonitorAlert: vi.fn(async (input) => ({ ok: true, acknowledged: input.alertId })),
      recoverBackgroundSupervisor: vi.fn(async () => ({ ok: true, recovered: true }))
    };
    await expect(runOperation("system.background_processes", { context: { devopsProvider: fullDevops } }))
      .resolves.toMatchObject({ status: 200, payload: { ok: true, processes: [] } });
  });

  it("covers discovery storage branches and empty checkpoint restore previews", async () => {
    await withTempDir(async (userDataPath) => {
      await expect(runOperation("discovery.check_in", { context: { userDataPath } }))
        .resolves.toMatchObject({ status: 503, payload: { error: "存储 provider 不可用。" } });
      await expect(runOperation("discovery.clients", { context: { userDataPath, storageProvider: {} } }))
        .resolves.toMatchObject({ status: 503, payload: { error: "客户端登记存储不可用。" } });

      const storageProvider = {
        recordClientCheckIn: vi.fn(() => ({ clientId: "client-1", label: "client-a" })),
        listClientRegistrations: vi.fn(() => [{ clientId: "client-1" }]),
        findClientRegistration: vi.fn(({ clientId }) => (clientId === "missing" ? null : { clientId, label: "client-a" }))
      };
      const protocolEventBus = { publish: vi.fn(async () => ({ id: "evt-1" })) };

      await expect(runOperation("discovery.check_in", {
        input: { hostname: "host-a", clientLabel: "client-a" },
        context: {
          userDataPath,
          storageProvider,
          protocolEventBus,
          discoveryState: { serverId: "server-1", offlineAfterSeconds: 30 },
          consoleDomainServices: { listAvailableAnalysisModules: vi.fn(() => []) }
        }
      })).resolves.toMatchObject({ status: 200 });

      await expect(runOperation("discovery.clients", {
        context: {
          userDataPath,
          storageProvider,
          discoveryState: { offlineAfterSeconds: 30 }
        }
      })).resolves.toMatchObject({ status: 200, payload: { items: expect.any(Array), summary: expect.any(Object) } });

      await expect(runOperation("discovery.clients.migration", {
        context: {
          userDataPath,
          storageProvider,
          discoveryState: { activeServiceUrl: "https://active.example", serverId: "server-1" },
          protocolEventBus
        }
      })).resolves.toMatchObject({ status: 400, payload: { error: "缺少客户端 ID。" } });

      await expect(runOperation("discovery.clients.migration", {
        input: { clientId: "missing" },
        context: {
          userDataPath,
          storageProvider,
          discoveryState: { activeServiceUrl: "https://active.example", serverId: "server-1" },
          protocolEventBus
        }
      })).resolves.toMatchObject({ status: 404, payload: { error: "未找到目标客户端。" } });

      await expect(runOperation("discovery.get_config", {
        context: {
          userDataPath,
          discoveryState: { serverId: "server-1", activeServiceUrl: "https://active.example" }
        }
      })).resolves.toMatchObject({ status: 200 });

      const previewResult = await runOperation("workspace.checkpoint.restore.preview", {
        input: { treeId: "tree-1" },
        context: {
          userDataPath,
          checkpointTreeApi: {
            previewCheckpointRestore: vi.fn(async () => ({
              target: {
                metadata: {
                  workspaceFileSnapshot: {
                    workspaceId: "ws-1",
                    files: []
                  }
                }
              },
              actions: []
            }))
          }
        }
      });
      expect(previewResult).toMatchObject({ status: 200, payload: { ok: true } });
      expect(previewResult.payload.workspaceFileRestore).toBeUndefined();
    });
  });

  it("covers knowledge preprocessing rule dispatch branches", async () => {
    await withTempDir(async (userDataPath) => {
      const protocolEventBus = { publish: vi.fn(async () => ({ id: "evt-1" })) };
      const context = {
        userDataPath,
        protocolEventBus,
        loadEmailRules: vi.fn(async () => ({ rules: ["alpha"] })),
        saveEmailRules: vi.fn(async (_path, rules) => rules),
        getEmailRulesPath: vi.fn((root) => path.join(root, "email-rules.json")),
        loadExpertVocabulary: vi.fn(async () => ({ terms: ["alpha"] })),
        getExpertVocabularyPath: vi.fn((root) => path.join(root, "expert-vocabulary.json")),
        saveExpertVocabulary: vi.fn(async (_path, vocabulary) => vocabulary),
        listExpertVocabularyVersions: vi.fn(async () => [{ version: 1 }]),
        getKnowledgeGuidanceSummary: vi.fn(async () => ({ summary: "guidance" })),
        loadKnowledgeTaxonomy: vi.fn(async () => ({ nodes: [] })),
        getKnowledgeTaxonomyPath: vi.fn((root) => path.join(root, "knowledge-taxonomy.json")),
        saveKnowledgeTaxonomy: vi.fn(async (_path, taxonomy) => taxonomy),
        listKnowledgeTaxonomyVersions: vi.fn(async () => [{ version: 2 }])
      };
      const summaryContext = {
        ...context,
        getExpertVocabularySummary: vi.fn(async () => ({ summary: "guidance" }))
      };

      await expect(runOperation("email_rules.get", { context }))
        .resolves.toMatchObject({ status: 200, payload: { rules: { rules: ["alpha"] } } });
      await expect(runOperation("email_rules.set", {
        input: { rules: ["beta"] },
        context
      })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("expert_vocabulary.summary", { context: { userDataPath } }))
        .resolves.toMatchObject({ status: 503, payload: { error: "专家词汇库摘要模块不可用。" } });
      await expect(runOperation("expert_vocabulary.summary", { context: summaryContext }))
        .resolves.toMatchObject({ status: 200, payload: { summary: "guidance" } });
      await expect(runOperation("expert_vocabulary.get", { context }))
        .resolves.toMatchObject({ status: 200 });
      await expect(runOperation("expert_vocabulary.set", {
        input: { terms: ["gamma"] },
        context
      })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("expert_vocabulary.versions", { context }))
        .resolves.toMatchObject({ status: 200, payload: [{ version: 1 }] });
      await expect(runOperation("knowledge.guidance.summary", { context: { userDataPath } }))
        .resolves.toMatchObject({ status: 503, payload: { error: "知识治理摘要模块不可用。" } });
      await expect(runOperation("knowledge.guidance.summary", { context }))
        .resolves.toMatchObject({ status: 200, payload: { summary: "guidance" } });
      await expect(runOperation("knowledge_taxonomy.get", { context }))
        .resolves.toMatchObject({ status: 200 });
      await expect(runOperation("knowledge_taxonomy.set", {
        input: { taxonomy: { nodes: [{ id: "n-1" }] } },
        context
      })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("knowledge_taxonomy.versions", { context }))
        .resolves.toMatchObject({ status: 200, payload: [{ version: 2 }] });

      expect(protocolEventBus.publish).toHaveBeenCalled();
    });
  });

  it("covers knowledge document parsing, corpus, and storage branch edges", async () => {
    await withTempDir(async (userDataPath) => {
      const documentParsingRuntime = {
        parseDocuments: vi.fn(async () => ({ ok: true, parsed: true }))
      };
      const context = {
        userDataPath,
        runtime: { mounts: { knowledgeBase: {} } },
        createDocumentParsingRuntime: vi.fn(async () => documentParsingRuntime),
        loadSettings: vi.fn(async () => ({ token: "settings" })),
        resolveUploadSessionFiles: vi.fn(async () => [{ path: "sample.txt" }]),
        toPublicDocumentParsingResult: vi.fn(async (result) => ({ public: true, result })),
        deleteUploadSession: vi.fn(async () => {}),
        storageProvider: {
          rebuildSourceVocabulary: vi.fn(() => ({ ok: true, rebuilt: true })),
          getStorageSummary: vi.fn(() => ({ summary: { total: 1 } })),
          getSignificantSourceTerms: vi.fn(() => ({ terms: ["alpha"] })),
          search: vi.fn(() => ({ items: [{ id: "s-1" }] }))
        },
        loadEmailRules: vi.fn(async () => ({ rules: [] })),
        enhanceAffairTaxonomy: vi.fn(async ({ documents }) => ({ ok: true, documents })),
        consoleDomainServices: {
          buildKnowledgeConsoleSummary: vi.fn(async () => ({ title: "console" }))
        },
        knowledgeSourceService: null,
        loadEmailRulesPath: vi.fn()
      };

      await expect(runOperation("knowledge.document_parse", {
        input: { uploadedFiles: [{ path: "sample.txt" }] },
        context
      })).resolves.toMatchObject({ status: 200, payload: { public: true } });

      await expect(runOperation("knowledge.document_parse", {
        context: {
          userDataPath,
          createDocumentParsingRuntime: vi.fn(async () => null)
        }
      })).resolves.toMatchObject({ status: 503, payload: { error: "文档解析运行时不可用。" } });

      await expect(runOperation("storage.source_vocabulary.rebuild", { context }))
        .resolves.toMatchObject({ status: 200, payload: { ok: true, rebuilt: true } });
      await expect(runOperation("knowledge.corpus.significant_terms", { context }))
        .resolves.toMatchObject({ status: 200, payload: { terms: ["alpha"] } });
      await expect(runOperation("knowledge.affair_taxonomy", { context: { userDataPath, storageProvider: context.storageProvider } }))
        .resolves.toMatchObject({ status: 503, payload: { error: "事务分类增强模块不可用。" } });
      await expect(runOperation("knowledge.affair_taxonomy", { context }))
        .resolves.toMatchObject({ status: 200, payload: { ok: true } });
      await expect(runOperation("search.query", {
        input: { query: "term", limit: "3", entityTypes: ["foo", "bar"], formalOnly: "true" },
        context
      })).resolves.toMatchObject({ status: 200, payload: { items: [{ id: "s-1" }] } });
      await expect(runOperation("knowledge.console", { context }))
        .resolves.toMatchObject({ status: 200, payload: { title: "console" } });
      await expect(runOperation("knowledge.console", {
        context: {
          ...context,
          consoleDomainServices: {}
        }
      })).resolves.toMatchObject({ status: 503, payload: { error: "知识库控制台摘要 provider 未配置。" } });
    });
  });

  it("covers route fallback and error-status mappings", async () => {
    await expect(runOperation("strategy.unknown", { context: {} }))
      .resolves.toMatchObject({ status: 501 });
    await expect(runOperation("runtime.unknown", { context: {} }))
      .resolves.toMatchObject({ status: 501 });
    await expect(runOperation("discovery.unknown", { context: {} }))
      .resolves.toMatchObject({ status: 501 });
    await expect(runOperation("data_connectors.governance.unknown", { context: {} }))
      .resolves.toMatchObject({ status: 501 });

    await expect(runOperation("repo.no_status", { context: {} }))
      .resolves.toMatchObject({ status: 400, payload: { ok: false, error: "missing status" } });

    await expect(runOperation("data_connectors.governance.conformance", {
      input: { manifest: { fail: true } },
      context: { userDataPath: "/tmp/pact-console-domain-fifth" }
    })).resolves.toMatchObject({ status: 400, payload: { error: "bad conformance" } });

    runtimeDependenciesMock.downloadRuntimeDependency.mockResolvedValueOnce({ ok: false, status: 418, error: "broken download" });
    await expect(runOperation("runtime.dependencies.download", {
      input: { targetId: "runtime-a" },
      context: { userDataPath: "/tmp/pact-console-domain-fifth" }
    })).resolves.toMatchObject({ status: 400, payload: { ok: false, status: 418, error: "broken download" } });

    runtimeDependenciesMock.downloadRuntimeDependency.mockImplementationOnce(() => {
      throw new Error("download exploded");
    });
    await expect(runOperation("runtime.dependencies.download", {
      input: { targetId: "runtime-a" },
      context: { userDataPath: "/tmp/pact-console-domain-fifth" }
    })).resolves.toMatchObject({ status: 400, payload: { error: "download exploded" } });

    runtimeDependenciesMock.updateRuntimeDependencyConfiguration.mockImplementationOnce(() => {
      throw new Error("configure exploded");
    });
    await expect(runOperation("runtime.dependencies.configure", {
      input: { targetId: "runtime-a" },
      context: { userDataPath: "/tmp/pact-console-domain-fifth" }
    })).resolves.toMatchObject({ status: 400, payload: { error: "configure exploded" } });

    performanceCapacityMock.runPerformanceCapacityBenchmark.mockImplementationOnce(() => {
      throw new Error("capacity exploded");
    });
    await expect(runOperation("performance.capacity.benchmark", {
      input: { profileId: "smoke" },
      context: { userDataPath: "/tmp/pact-console-domain-fifth" }
    })).resolves.toMatchObject({ status: 400, payload: { error: "capacity exploded" } });
  });

  it("covers knowledge management, access, backend, and contribution branches", async () => {
    await withTempDir(async (userDataPath) => {
      const protocolEventBus = { publish: vi.fn(async () => ({ id: "evt-1", offset: 1 })) };
      const knowledgeCore = {
        capabilities: vi.fn(async () => ({ core: true })),
        health: vi.fn(async () => ({ ok: true, healthy: true })),
        exportDocx: vi.fn(async () => ({ contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", fileName: "export.docx", buffer: Buffer.from("docx") })),
        exportMarkdown: vi.fn(async () => ({ contentType: "text/markdown", fileName: "export.md", buffer: Buffer.from("md") })),
        exportHtml: vi.fn(async () => ({ contentType: "text/html", fileName: "export.html", buffer: Buffer.from("html") })),
        getMaintenance: vi.fn(async () => ({ retrieval: { recencyHalfLifeDays: 21 } })),
        setMaintenance: vi.fn(async (payload) => ({ ok: true, retrieval: { recencyHalfLifeDays: 21 }, payload })),
        reindex: vi.fn(async () => ({ ok: true, reindexed: true })),
        runMaintenance: vi.fn(async () => ({ ok: true, maintenance: true })),
        syncMirror: vi.fn(async () => ({ ok: true, mirrored: true })),
        search: vi.fn(async (payload) => ({ ok: true, items: [{ evidenceId: "e-1" }], searchInput: payload })),
        prepareHierarchyReasoning: vi.fn(async () => ({ ok: true, hierarchy: true })),
        renderMarkdown: vi.fn(async () => ({ ok: true, rendered: true })),
        getDocumentStructure: vi.fn(() => ({ ok: true, nodes: [{ id: "doc-1" }] })),
        getItem: vi.fn(async () => ({ ok: true, itemId: "item-1" })),
        getEvidence: vi.fn(async () => ({ ok: true, evidenceId: "e-1" })),
        getAssetContent: vi.fn(async () => ({ contentType: "text/plain", fileName: "asset.txt", buffer: Buffer.from("asset") })),
        listReviewItems: vi.fn(async () => ({ items: [{ reviewId: "r-core", updatedAt: "2026-01-02T00:00:00.000Z" }] })),
        resolveReviewItem: vi.fn(async () => ({ reviewId: "r-core", resolved: true })),
        recordFeedback: vi.fn(async () => ({ ok: true, feedback: true })),
        listSuggestions: vi.fn(async () => ({ items: [{ suggestionId: "s-1" }] })),
        resolveSuggestion: vi.fn(async () => ({ suggestionId: "s-1", resolved: true })),
        runLearningJob: vi.fn(async () => ({ ok: true, job: true })),
        learningHealth: vi.fn(async () => ({ ok: true, learning: true }))
      };
      const metadataStore = {
        syncKnowledge: vi.fn(() => ({ ok: true, synced: true })),
        submitKnowledgeChanges: vi.fn(() => ({ ok: true, changes: 1 })),
        listKnowledgeReviewItems: vi.fn(() => ({ items: [{ reviewId: "r-meta", updatedAt: "2026-01-03T00:00:00.000Z" }] })),
        resolveKnowledgeReviewItem: vi.fn(() => ({ reviewId: "r-meta", resolved: true })),
        searchKnowledge: vi.fn(() => ({ items: [{ id: "meta-hit" }], count: 1 })),
        getKnowledgeItem: vi.fn(() => ({ id: "meta-item" }))
      };
      const securityPermissions = {
        appendReceipt: vi.fn(),
        appendLoanRecord: vi.fn(),
        appendDeniedRequest: vi.fn(),
        listReceipts: vi.fn(() => [{ receiptId: "receipt-1" }]),
        listLoanRecords: vi.fn(() => [{ loanId: "loan-1" }]),
        listDeniedRequests: vi.fn(() => [{ deniedId: "denied-1" }])
      };
      const storageProvider = {
        rebuildSourceVocabulary: vi.fn(() => ({ ok: true, rebuilt: true })),
        getStorageSummary: vi.fn(() => ({ summary: { total: 1 } })),
        getSignificantSourceTerms: vi.fn(() => ({ terms: ["alpha"] })),
        search: vi.fn(() => ({ items: [{ id: "store-hit" }], count: 1 }))
      };
      const knowledgeSourceService = {
        listSources: vi.fn(async () => [{ id: "source-1" }]),
        createSource: vi.fn(async (input) => ({ ok: true, created: input.name || "source" })),
        updateSource: vi.fn(async (sourceId) => (sourceId ? { ok: true, sourceId } : null)),
        deleteSource: vi.fn(async (sourceId) => (sourceId ? { ok: true, sourceId } : null)),
        refreshSource: vi.fn(async (sourceId) => ({ ok: true, sourceId })),
        refreshAll: vi.fn(async () => ({ ok: true, refreshed: true }))
      };
      const context = {
        userDataPath,
        runtime: { mounts: { knowledgeBase: knowledgeCore } },
        metadataStore,
        securityPermissions,
        storageProvider,
        knowledgeSourceService,
        consoleDomainServices: {
          buildKnowledgeConsoleSummary: vi.fn(async () => ({ title: "console summary" }))
        },
        loadEmailRules: vi.fn(async () => ({ rules: ["alpha"] })),
        saveEmailRules: vi.fn(async (_root, rules) => rules),
        getEmailRulesPath: vi.fn((root) => path.join(root, "email-rules.json")),
        loadExpertVocabulary: vi.fn(async () => ({ terms: ["alpha"] })),
        getExpertVocabularyPath: vi.fn((root) => path.join(root, "expert-vocabulary.json")),
        saveExpertVocabulary: vi.fn(async (_root, vocabulary) => vocabulary),
        listExpertVocabularyVersions: vi.fn(async () => [{ version: 1 }]),
        getKnowledgeGuidanceSummary: vi.fn(async () => ({ summary: "guidance" })),
        loadKnowledgeTaxonomy: vi.fn(async () => ({ nodes: [] })),
        getKnowledgeTaxonomyPath: vi.fn((root) => path.join(root, "knowledge-taxonomy.json")),
        saveKnowledgeTaxonomy: vi.fn(async (_root, taxonomy) => taxonomy),
        listKnowledgeTaxonomyVersions: vi.fn(async () => [{ version: 2 }]),
        createDocumentParsingRuntime: vi.fn(async () => ({
          parseDocuments: vi.fn(async () => ({ ok: true, parsed: true }))
        })),
        loadSettings: vi.fn(async () => ({ token: "settings" })),
        resolveUploadSessionFiles: vi.fn(async () => [{ path: "sample.txt" }]),
        toPublicDocumentParsingResult: vi.fn(async (result) => ({ public: true, result })),
        deleteUploadSession: vi.fn(async () => {}),
        enhanceAffairTaxonomy: vi.fn(async ({ documents }) => ({ ok: true, documents })),
        protocolEventBus,
        agentWorkspace: {
          getWorkspaceContext: vi.fn(() => ({ workspaceId: "ws-1", contextProfileId: "ctx-1", modelAlias: "model-a" }))
        }
      };
      const searchContext = {
        ...context,
        clientRuntimeAllocator: {
          apply: vi.fn(async (payload) => ({ input: { ...payload, workspaceId: "ws-1", sourceIds: ["source-a"] }, allocation: { clientId: "client-1" } }))
        }
      };
      const backendContext = {
        ...context,
        authSession: { user: { userId: "user-1", username: "alice" } }
      };

      await expect(runOperation("workspace.contribution.submit", {
        input: { workspaceId: "ws-1", title: "Contribution" },
        context: backendContext
      })).resolves.toMatchObject({ status: 201 });
      await expect(runOperation("knowledge.contribution.submit", {
        input: { workspaceId: "ws-1", title: "Knowledge Contribution" },
        context: backendContext
      })).resolves.toMatchObject({ status: 201 });
      await expect(runOperation("workspace.contribution.list", { input: { workspaceId: "ws-1" }, context: backendContext }))
        .resolves.toMatchObject({ status: 200, payload: { count: 2 } });
      await expect(runOperation("workspace.contribution.assets.list", { context: backendContext }))
        .resolves.toMatchObject({ status: 200 });
      await expect(runOperation("workspace.contribution.leaderboard", { input: { workspaceId: "ws-1" }, context: backendContext }))
        .resolves.toMatchObject({ status: 200, payload: { count: 1 } });
      await expect(runOperation("workspace.contribution.stats", { context: backendContext }))
        .resolves.toMatchObject({ status: 200, payload: { total: 1 } });
      await expect(runOperation("workspace.contribution.report", { context: backendContext }))
        .resolves.toMatchObject({ status: 200 });
      await expect(runOperation("workspace.contribution.permission.request", { input: { contributionId: "contribution-1" }, context: backendContext }))
        .resolves.toMatchObject({ status: 201 });
      await expect(runOperation("workspace.contribution.permission.grant", { input: { contributionId: "contribution-1" }, context: backendContext }))
        .resolves.toMatchObject({ status: 200 });
      await expect(runOperation("workspace.contribution.scan", { input: { contributionId: "contribution-1" }, context: backendContext }))
        .resolves.toMatchObject({ status: 200 });
      await expect(runOperation("workspace.contribution.review", { input: { contributionId: "contribution-1" }, context: backendContext }))
        .resolves.toMatchObject({ status: 200 });
      await expect(runOperation("workspace.contribution.preview", { input: { contributionId: "contribution-1" }, context: backendContext }))
        .resolves.toMatchObject({ status: 200 });
      await expect(runOperation("workspace.contribution.publish", { input: { contributionId: "contribution-1" }, context: backendContext }))
        .resolves.toMatchObject({ status: 200 });
      await expect(runOperation("workspace.contribution.adopt", { input: { contributionId: "contribution-1" }, context: backendContext }))
        .resolves.toMatchObject({ status: 200 });
      await expect(runOperation("workspace.contribution.reject", { input: { contributionId: "contribution-1" }, context: backendContext }))
        .resolves.toMatchObject({ status: 200 });
      await expect(runOperation("workspace.contribution.request_changes", { input: { contributionId: "contribution-1" }, context: backendContext }))
        .resolves.toMatchObject({ status: 200 });
      await expect(runOperation("workspace.contribution.revoke", { input: { contributionId: "contribution-1" }, context: backendContext }))
        .resolves.toMatchObject({ status: 200 });
      await expect(runOperation("workspace.skill.upload", { input: { workspaceId: "ws-1", title: "Skill" }, context: backendContext }))
        .resolves.toMatchObject({ status: 201 });
      await expect(runOperation("workspace.skill.list", { input: { workspaceId: "ws-1" }, context: backendContext }))
        .resolves.toMatchObject({ status: 200 });
      await expect(runOperation("workspace.skill.download", { input: { skillId: "skill-1" }, context: backendContext }))
        .resolves.toMatchObject({ status: 200 });
      await expect(runOperation("workspace.skill.usage.report", { input: { contributionId: "contribution-1" }, context: backendContext }))
        .resolves.toMatchObject({ status: 200 });

      await expect(runOperation("knowledge.access.evaluate", {
        input: { request: { operationId: "read" } },
        context: backendContext
      })).resolves.toMatchObject({ status: 200, payload: { decision: expect.any(Object) } });
      await expect(runOperation("knowledge.access.receipt.list", { context: backendContext }))
        .resolves.toMatchObject({ status: 200, payload: { count: 1 } });
      await expect(runOperation("knowledge.access.loan_record.list", { context: backendContext }))
        .resolves.toMatchObject({ status: 200, payload: { count: 1 } });
      await expect(runOperation("knowledge.access.denied_request.list", { context: backendContext }))
        .resolves.toMatchObject({ status: 200, payload: { count: 1 } });

      await expect(runOperation("knowledge.config_schema", { context: backendContext }))
        .resolves.toMatchObject({ status: 200 });
      await expect(runOperation("knowledge.capabilities", { context: backendContext }))
        .resolves.toMatchObject({ status: 200, payload: { core: true } });
      await expect(runOperation("knowledge.export_docx", { input: { documentId: "doc-1", includeMachineReadable: "true" }, context: backendContext }))
        .resolves.toMatchObject({ status: 200, payload: { __binaryResponse: true } });
      await expect(runOperation("knowledge.export_markdown", { input: { documentId: "doc-1" }, context: backendContext }))
        .resolves.toMatchObject({ status: 200, payload: { __binaryResponse: true } });
      await expect(runOperation("knowledge.export_html", { input: { documentId: "doc-1" }, context: backendContext }))
        .resolves.toMatchObject({ status: 200, payload: { __binaryResponse: true } });
      await expect(runOperation("knowledge.health", { context: backendContext }))
        .resolves.toMatchObject({ status: 200 });
      await expect(runOperation("knowledge.maintenance.get", { context: backendContext }))
        .resolves.toMatchObject({ status: 200 });
      await expect(runOperation("knowledge.maintenance.set", { input: { retrieval: { recencyHalfLifeDays: 21 } }, context: backendContext }))
        .resolves.toMatchObject({ status: 200 });
      await expect(runOperation("knowledge.reindex", { input: { confirm: true }, context: backendContext }))
        .resolves.toMatchObject({ status: 200 });
      await expect(runOperation("knowledge.maintenance.run", { input: { taskType: "reindex", confirm: true }, context: backendContext }))
        .resolves.toMatchObject({ status: 200 });
      await expect(runOperation("knowledge.sync", { input: { scope: "mirror" }, context: backendContext }))
        .resolves.toMatchObject({ status: 200 });
      await expect(runOperation("knowledge.changes", { input: { changes: [{ id: "c-1" }] }, context: backendContext }))
        .resolves.toMatchObject({ status: 200 });
      await expect(runOperation("knowledge.review_items", { input: { status: "all", limit: 2 }, context: backendContext }))
        .resolves.toMatchObject({ status: 200, payload: { count: 2 } });
      await expect(runOperation("knowledge.review_resolve", { input: { reviewId: "r-meta", resolution: "accept" }, context: backendContext }))
        .resolves.toMatchObject({ status: 200 });
      await expect(runOperation("knowledge.feedback", { input: { itemId: "item-1" }, context: backendContext }))
        .resolves.toMatchObject({ status: 200 });
      await expect(runOperation("knowledge.suggestions", { input: { status: "pending" }, context: backendContext }))
        .resolves.toMatchObject({ status: 200 });
      await expect(runOperation("knowledge.suggestion_resolve", { input: { suggestionId: "s-1", resolution: "accept" }, context: backendContext }))
        .resolves.toMatchObject({ status: 200 });
      await expect(runOperation("knowledge.learning.jobs", { input: { job: "train" }, context: backendContext }))
        .resolves.toMatchObject({ status: 200 });
      await expect(runOperation("knowledge.learning.health", { context: backendContext }))
        .resolves.toMatchObject({ status: 200 });

      await expect(runOperation("knowledge.search", {
        input: {
          query: "needle",
          limit: 3,
          workspaceId: "ws-1",
          hierarchyReasoning: true,
          responseProfile: "tool",
          sourceIds: ["source-a"],
          format: "markdown"
        },
        context: searchContext
      })).resolves.toMatchObject({ status: 200, payload: { rendered: { ok: true, rendered: true } } });
      await expect(runOperation("knowledge.search", {
        input: { query: "source search", rawSourceSearch: true },
        context: searchContext
      })).resolves.toMatchObject({ status: 200, payload: { items: [{ id: "source-hit" }] } });
      await expect(runOperation("knowledge.search", {
        input: { query: "backend search", knowledgeBackend: true, workspaceId: "ws-1" },
        context: {
          ...searchContext,
          authSession: { user: { userId: "user-1", username: "alice" } }
        }
      })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("knowledge.search", {
        input: { query: "fallback search", knowledgeBase: false },
        context: {
          ...searchContext,
          runtime: { mounts: { knowledgeBase: null } }
        }
      })).resolves.toMatchObject({ status: 200, payload: { modalityPolicy: { mode: "multimodal" } } });
      await expect(runOperation("knowledge.document_structure", { input: { documentId: "doc-1" }, context: backendContext }))
        .resolves.toMatchObject({ status: 200 });
      await expect(runOperation("knowledge.item", { input: { itemId: "item-1" }, context: backendContext }))
        .resolves.toMatchObject({ status: 200 });
      await expect(runOperation("knowledge.evidence", { input: { evidenceId: "kb:1" }, context: backendContext }))
        .resolves.toMatchObject({ status: 200 });
      await expect(runOperation("knowledge.evidence", { input: { evidenceId: "source:1" }, context: backendContext }))
        .resolves.toMatchObject({ status: 200 });
      await expect(runOperation("knowledge.asset", { input: { assetId: "asset-1" }, context: backendContext }))
        .resolves.toMatchObject({ status: 200, payload: { __binaryResponse: true } });
      await expect(runOperation("knowledge.render_markdown", { input: { evidenceId: "e-1" }, context: backendContext }))
        .resolves.toMatchObject({ status: 200 });

      await expect(runOperation("knowledge.document_parse", {
        input: { uploadSessionId: "upload-1", dryRun: true, cleanupUploadSession: true },
        context: backendContext
      })).resolves.toMatchObject({ status: 200, payload: { public: true } });
      await expect(runOperation("storage.source_vocabulary.rebuild", { context: backendContext }))
        .resolves.toMatchObject({ status: 200 });
      await expect(runOperation("knowledge.corpus.significant_terms", { context: backendContext }))
        .resolves.toMatchObject({ status: 200 });
      await expect(runOperation("knowledge.affair_taxonomy", { context: backendContext }))
        .resolves.toMatchObject({ status: 200 });
      await expect(runOperation("search.query", {
        input: { query: "term", limit: "3", entityTypes: ["foo", "bar"], formalOnly: "true" },
        context: backendContext
      })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("knowledge.console", { context: backendContext }))
        .resolves.toMatchObject({ status: 200, payload: { title: "console summary" } });
      await expect(runOperation("knowledge.sources.list", { context: backendContext }))
        .resolves.toMatchObject({ status: 200 });
      await expect(runOperation("knowledge.sources.create", { input: { name: "source-a" }, context: backendContext }))
        .resolves.toMatchObject({ status: 200 });
      await expect(runOperation("knowledge.sources.update", { input: { sourceId: "source-1" }, context: backendContext }))
        .resolves.toMatchObject({ status: 200 });
      await expect(runOperation("knowledge.sources.delete", { input: { sourceId: "source-1" }, context: backendContext }))
        .resolves.toMatchObject({ status: 200 });
      await expect(runOperation("knowledge.sources.refresh", { input: { sourceId: "source-1" }, context: backendContext }))
        .resolves.toMatchObject({ status: 200 });
      await expect(runOperation("knowledge.sources.refresh_all", { context: backendContext }))
        .resolves.toMatchObject({ status: 200 });

      expect(protocolEventBus.publish).toHaveBeenCalled();
      expect(knowledgeCore.search).toHaveBeenCalled();
    });
  });

  it("covers workspace, context runtime, client runtime, checkpoint, and discovery branches", async () => {
    await withTempDir(async (userDataPath) => {
      const protocolEventBus = { publish: vi.fn(async () => ({ id: "evt-2" })) };
      const agentWorkspace = {
        protocolVersion: "pact.workspace.v1",
        listWorkspaces: vi.fn(() => [{ workspaceId: "ws-1" }]),
        getWorkspace: vi.fn(() => ({ workspaceId: "ws-1", title: "Workspace 1" })),
        createWorkspace: vi.fn(() => ({ workspace: { workspaceId: "ws-2", title: "Workspace 2" } })),
        setWorkspaceParent: vi.fn((workspaceId, parentWorkspaceId) => ({ ok: true, workspace: { workspaceId, parentWorkspaceId } })),
        deleteWorkspace: vi.fn(() => ({ ok: true })),
        listSessions: vi.fn(() => [{ sessionId: "session-1" }]),
        getSession: vi.fn(() => ({ sessionId: "session-1" })),
        getSessionContext: vi.fn((sessionId) => ({
          sessionId,
          workspaceId: "ws-1",
          contextProfileId: "ctx-1",
          modelAlias: "model-a",
          toolGrantId: "grant-1",
          knowledgeSourceIds: ["source-a"]
        })),
        appendSessionEvent: vi.fn(() => ({ sessionId: "session-1", appended: true })),
        forkSession: vi.fn(() => ({ ok: true, forked: true })),
        compareSessions: vi.fn(() => ({ ok: true, compared: true })),
        createSessionMergeProposal: vi.fn(() => ({ ok: true, merged: true })),
        archiveSession: vi.fn(() => ({ ok: true, archived: true })),
        resolveSubmission: vi.fn(() => ({ submission: { submissionId: "sub-1", status: "accepted", payload: { title: "Proposal" }, runId: "run-1" } })),
        updateIssue: vi.fn(() => ({ issueId: "issue-1", resolved: true })),
        listLocks: vi.fn(() => [{ lockId: "lock-1" }]),
        acquireLock: vi.fn(() => ({ ok: true, lockId: "lock-1" })),
        releaseLock: vi.fn(() => ({ ok: true, lockId: "lock-1" })),
        submit: vi.fn(() => ({ submission: { submissionId: "proposal-1", status: "pending", payload: { title: "Proposal" } } })),
        createDecision: vi.fn(() => ({ decision: { decisionId: "decision-1" } })),
        listWorkspaceFiles: vi.fn(() => ({ ok: true, files: [{ path: "README.md" }] })),
        workspaceFileMetadata: vi.fn(() => ({ ok: true, path: "README.md" })),
        downloadWorkspaceFile: vi.fn(() => ({ ok: true, buffer: Buffer.from("file"), contentType: "text/plain" })),
        uploadWorkspaceFile: vi.fn(() => ({ ok: true, uploaded: true })),
        writeWorkspaceFile: vi.fn(() => ({ ok: true, written: true })),
        patchWorkspaceFile: vi.fn(() => ({ ok: true, patched: true })),
        deleteWorkspaceFile: vi.fn(() => ({ ok: true, deleted: true })),
        restoreWorkspaceFiles: vi.fn(async () => ({ ok: true, workspaceId: "ws-1", restored: true })),
        connectLocalDirectory: vi.fn(() => ({ ok: true, connected: true })),
        listLocalDirectoryMounts: vi.fn(() => ({ ok: true, mounts: [] })),
        listLocalDirectoryItems: vi.fn(() => ({ ok: true, items: [{ path: "src" }] })),
        exportWorkspaceContextBundle: vi.fn(() => ({ ok: true, bundle: true })),
        restoreWorkspaceContextBundle: vi.fn(() => ({ ok: true, restored: true })),
        resolveWorkspaceChain: vi.fn(() => [{ workspaceId: "ws-1" }]),
        resolveWorkspaceSourceIds: vi.fn(() => ["source-a"]),
        resolveWorkspaceProfile: vi.fn(() => ({ profileId: "profile-1" })),
        getWorkspaceContext: vi.fn(() => ({ workspaceId: "ws-1", contextProfileId: "ctx-1", modelAlias: "model-a" })),
        hotSwapProfile: vi.fn(() => ({ ok: true, hotSwapped: true })),
        setOwnedSourceIds: vi.fn(() => ({ ok: true, sources: ["source-a"] })),
        shareWorkspace: vi.fn(() => ({ ok: true, shared: true })),
        unshareWorkspace: vi.fn(() => ({ ok: true, unshared: true }))
      };
      const contextRuntime = {
        listProfiles: vi.fn(async () => [{ id: "profile-1" }]),
        saveProfiles: vi.fn(async (input) => ({ ok: true, input })),
        preview: vi.fn(async (input) => ({ ok: true, input })),
        previewCompaction: vi.fn(async () => ({ ok: true, previewed: true })),
        runCompaction: vi.fn(async () => ({ ok: true, compacted: true })),
        listCompactionRecords: vi.fn(async () => [{ id: "record-1" }]),
        listSessionMemory: vi.fn(async () => [{ id: "memory-1" }]),
        clearSessionMemory: vi.fn(async () => ({ ok: true, cleared: true })),
        listBuildRecords: vi.fn(async () => [{ id: "build-1" }]),
        runEvaluation: vi.fn(async () => ({ ok: true, evaluated: true }))
      };
      const clientRuntimeAllocator = {
        listProfiles: vi.fn(async () => ({ ok: true, profiles: [] })),
        saveProfiles: vi.fn(async (input) => ({ ok: true, saved: input })),
        resolve: vi.fn(async (input) => ({ ok: true, resolved: input })),
        getStatus: vi.fn(async () => ({ ok: true, status: "ready" })),
        apply: vi.fn(async (payload) => ({ input: { ...payload, workspaceId: "ws-1" }, allocation: { profileId: "profile-1" } }))
      };
      const clientRuntimeBootstrap = {
        buildPlan: vi.fn((input) => ({ ok: true, input })),
        buildPull: vi.fn((input) => ({ ok: true, input }))
      };
      const devopsProvider = {
        getBackgroundProcessStatus: vi.fn(async () => ({ ok: true, processes: [] })),
        getMonitorAlertState: vi.fn(async () => ({ ok: true, alerts: [] })),
        saveMonitorAlertConfig: vi.fn(async (config) => ({ ok: true, config })),
        acknowledgeMonitorAlert: vi.fn(async (input) => ({ ok: true, acknowledged: input.alertId })),
        recoverBackgroundSupervisor: vi.fn(async () => ({ ok: true, recovered: true }))
      };
      const checkpointTreeApi = {
        listCheckpointTrees: vi.fn(async () => [{ treeId: "tree-1", workspaceId: "ws-1" }]),
        checkpointTreeSummary: vi.fn((tree) => ({ summaryId: tree.treeId || "tree-1" })),
        loadCheckpointTree: vi.fn(async ({ treeId }) => (treeId ? { treeId, marker: true } : null)),
        diffCheckpointTree: vi.fn(async () => ({ ok: true, diff: true })),
        queryCheckpointScope: vi.fn(async () => ({ ok: true, scope: true })),
        previewCheckpointRestore: vi.fn(async () => ({
          target: {
            metadata: {
              workspaceFileSnapshot: {
                workspaceId: "ws-1",
                files: [{ path: "README.md" }]
              }
            }
          },
          actions: [{ action: "restore_marker" }]
        })),
        restoreCheckpointTree: vi.fn(async () => ({ ok: true, actions: [{ action: "restore_marker" }] }))
      };
      const moduleManagement = {
        getMountsSnapshot: vi.fn(async () => ({ ok: true, mounts: [] })),
        setMounts: vi.fn(async () => ({ ok: true, mounts: [] })),
        reloadMounts: vi.fn(async () => ({ ok: true, reloaded: true })),
        listModuleTemplates: vi.fn(() => [{ id: "template-1" }]),
        planModuleScaffold: vi.fn(async (input) => ({ ok: true, input })),
        scaffoldModule: vi.fn(async (input) => ({ ok: true, input })),
        validateCapabilityPackageScaffoldManifest: vi.fn((input) => ({ ok: true, input })),
        runModuleContractTest: vi.fn(async () => ({ ok: true, contract: true }))
      };
      const discoveryStorage = {
        recordClientCheckIn: vi.fn(() => ({ clientId: "client-1", label: "client-a" })),
        listClientRegistrations: vi.fn(() => [{ clientId: "client-1" }]),
        findClientRegistration: vi.fn(({ clientId }) => (clientId === "missing" ? null : { clientId, label: "client-a" }))
      };
      const context = {
        userDataPath,
        distPath: path.join(userDataPath, "dist"),
        agentWorkspace,
        contextRuntime,
        clientRuntimeAllocator,
        clientRuntimeBootstrap,
        devopsProvider,
        checkpointTreeApi,
        moduleManagement,
        consoleDomainServices: {
          listAvailableAnalysisModules: vi.fn(() => []),
          buildKnowledgeConsoleSummary: vi.fn(async () => ({ title: "console summary" }))
        },
        discoveryState: { serverId: "server-1", mode: "active", activeServiceUrl: "https://active.example", offlineAfterSeconds: 30, configVersion: "v1" },
        storageProvider: discoveryStorage,
        protocolEventBus,
        authSession: { user: { userId: "u-1", username: "alice", roleId: "admin" } },
        request: { headers: { host: "localhost", origin: "http://localhost", "user-agent": "vitest" }, socket: { remoteAddress: "127.0.0.1" } }
      };

      await expect(runOperation("workspace.info", { context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("workspace.info", { input: { workspaceId: "ws-1" }, context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("agent_workspaces.create", { input: { title: "Workspace 2", objective: "Build", parentWorkspaceId: "parent-1" }, context }))
        .resolves.toMatchObject({ status: 201 });
      await expect(runOperation("agent_workspaces.get", { input: { workspaceId: "ws-1" }, context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("agent_workspaces.delete", { input: { workspaceId: "ws-1", deleteFolder: true }, context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("agent_sessions.list", { input: { workspaceId: "ws-1" }, context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("agent_sessions.get", { input: { sessionId: "session-1" }, context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("agent_sessions.context.get", { input: { sessionId: "session-1" }, context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("agent_sessions.events.append", { input: { sessionId: "session-1", eventType: "note" }, context })).resolves.toMatchObject({ status: 201 });
      await expect(runOperation("agent_sessions.fork", { input: { sessionId: "session-1" }, context })).resolves.toMatchObject({ status: 201 });
      await expect(runOperation("agent_sessions.compare", { input: { sessionId: "session-1" }, context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("agent_sessions.merge_proposal", { input: { sessionId: "session-1" }, context })).resolves.toMatchObject({ status: 201 });
      await expect(runOperation("agent_sessions.archive", { input: { sessionId: "session-1" }, context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("agent_workspaces.submissions.resolve", { input: { submissionId: "sub-1" }, context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("agent_workspaces.issues.resolve", { input: { issueId: "issue-1" }, context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("agent_workspaces.locks.list", { input: { workspaceId: "ws-1" }, context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("agent_workspaces.locks.write", { input: { workspaceId: "ws-1", action: "acquire" }, context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("workspace.proposal.create", { input: { workspaceId: "ws-1", title: "Proposal" }, context })).resolves.toMatchObject({ status: 201 });
      await expect(runOperation("workspace.proposal.apply", { input: { workspaceId: "ws-1", proposalId: "sub-1" }, context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("agent_workspaces.context.get", { input: { workspaceId: "ws-1" }, context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("agent_workspaces.context_bundle.export", { input: { workspaceId: "ws-1", compressedOnly: true }, context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("agent_workspaces.context_bundle.restore", { input: { workspaceId: "ws-1" }, context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("agent_workspaces.chain.get", { input: { workspaceId: "ws-1" }, context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("agent_workspaces.parent.set", { input: { workspaceId: "ws-1", parentWorkspaceId: "parent-1" }, context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("agent_workspaces.profile.hotswap", { input: { workspaceId: "ws-1" }, context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("agent_workspaces.sources.set", { input: { workspaceId: "ws-1", sourceIds: ["source-a"] }, context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("agent_workspaces.share", { input: { workspaceId: "ws-1", targetWorkspaceId: "ws-2" }, context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("agent_workspaces.unshare", { input: { workspaceId: "ws-1", targetWorkspaceId: "ws-2" }, context })).resolves.toMatchObject({ status: 200 });

      await expect(runOperation("context.profiles.get", { context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("context.profiles.set", { input: { profiles: [] }, context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("context.preview", { input: { workspaceId: "ws-1" }, context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("context.compaction.preview", { context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("context.compaction.run", { context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("context.compaction.records", { input: { limit: 2 }, context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("context.session_memory.get", { input: { limit: 2, sessionId: "session-1" }, context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("context.session_memory.clear", { context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("context.build_records", { context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("context.evaluation.runs.create", { context })).resolves.toMatchObject({ status: 201 });

      await expect(runOperation("client_runtime.profiles.get", { context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("client_runtime.profiles.set", { input: { profiles: [] }, context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("client_runtime.resolve", { input: { clientId: "client-1" }, context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("client_runtime.bootstrap.plan", { input: { workspaceId: "ws-1" }, context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("client_runtime.bootstrap.pull", { input: { workspaceId: "ws-1" }, context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("client_runtime.status", { context })).resolves.toMatchObject({ status: 200 });

      await expect(runOperation("system.monitor_alerts.get", { context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("system.monitor_alerts.set", { input: { enabled: true }, context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("system.monitor_alerts.ack", { input: { alertId: "alert-1" }, context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("system.background_supervisor.recover", { context })).resolves.toMatchObject({ status: 200 });

      await expect(runOperation("system.background_processes", { context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("system.checkpoint_trees.list", { input: { ownerId: "ws-1" }, context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("system.checkpoint_trees.get", { input: { treeId: "tree-1" }, context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("workspace.checkpoint.tree.list", { context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("workspace.checkpoint.node.get", { input: { treeId: "tree-1" }, context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("workspace.checkpoint.diff", { input: { treeId: "tree-1", fromTreeId: "a", toTreeId: "b" }, context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("workspace.checkpoint.scope.query", { input: { treeId: "tree-1", nodeId: "node-1" }, context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("workspace.checkpoint.restore.preview", { input: { treeId: "tree-1", nodeId: "node-1" }, context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("workspace.checkpoint.restore", { input: { treeId: "tree-1", nodeId: "node-1" }, context })).resolves.toMatchObject({ status: 200 });

      await expect(runOperation("discovery.check_in", { input: { hostname: "host-a", clientLabel: "client-a" }, context }))
        .resolves.toMatchObject({ status: 200 });
      await expect(runOperation("discovery.clients", { context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("discovery.clients.migration", { input: { clientId: "client-1" }, context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("discovery.get_config", { context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("discovery.set_config", { input: { mode: "forward", refreshIntervalSeconds: 30 }, context })).resolves.toMatchObject({ status: 200 });

      await expect(runOperation("runtime.mounts", { context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("runtime.set_mounts", { input: { value: { mounts: [] } }, context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("runtime.reload_mounts", { context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("system.interfaces", { context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("runtime.info", { context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("system.console_state", { context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("system.health", { context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("v001.baseline.status", { context })).resolves.toMatchObject({ status: 200 });

      await expect(runOperation("runtime.path_browse", { input: { path: userDataPath, mode: "directory" }, context }))
        .resolves.toMatchObject({ status: 200, payload: { currentPath: expect.any(String) } });
    });
  });

  it("covers settings, model routing, gateway, and agent registry branches", async () => {
    await withTempDir(async (userDataPath) => {
      const protocolEventBus = { publish: vi.fn(async () => ({ id: "evt-3" })) };
      const modelLibraryState = [
        {
          uid: "agent-1",
          provider: "deepseek",
          model: "deepseek-chat",
          label: "deepseek chat",
          agentName: "deepseek chat",
          baseUrl: "https://api.example",
          apiKey: "old-key"
        }
      ];
      const registry = {
        refresh: vi.fn(async () => ({ ok: true })),
        replaceFromModelLibraryAgents: vi.fn(async (models) => {
          modelLibraryState.splice(0, modelLibraryState.length, ...models);
        }),
        getModelLibraryEntries: vi.fn(() => [...new Set(modelLibraryState.map((item) => item.provider))]),
        getModelLibraryAgents: vi.fn(() => modelLibraryState.map((item) => ({ ...item })))
      };
      const agentRuntimeProvider = {
        getAgentConfigRegistry: vi.fn(() => registry),
        publicAgentGatewayConfig: vi.fn(async (settings) => ({ ok: true, gateway: settings.customHttpAdapter || null })),
        publicAgentGatewayRegistry: vi.fn(async () => ({ ok: true, agents: modelLibraryState.map((item) => ({ alias: item.uid })) })),
        callAgentGateway: vi.fn(async (input) => ({ ok: true, gateway: true, input })),
        inspectAgentModelRouting: vi.fn(async () => ({ ok: true, routing: true })),
        probeModelConnection: vi.fn(async ({ provider, modelAlias }) => ({
          ok: true,
          configured: true,
          provider,
          model: modelAlias,
          statusCode: 200,
          latencyMs: 12,
          checkedAt: new Date().toISOString(),
          message: "ok"
        }))
      };
      const context = {
        userDataPath,
        agentRuntimeProvider,
        moduleManagement: {
          refreshMounts: vi.fn(async () => ({ ok: true }))
        },
        protocolEventBus,
        authSession: { user: { userId: "u-1", username: "alice" } },
        appendConsoleOperationLog: vi.fn()
      };

      await expect(runOperation("settings.get", { context }))
        .resolves.toMatchObject({ status: 200, payload: expect.any(Object) });
      await expect(runOperation("settings.set", {
        input: {
          modelLibraryAgents: [
            { uid: "agent-1", provider: "deepseek", model: "deepseek-chat", label: "deepseek chat" },
            { uid: "agent-2", provider: "custom-http", model: "custom-model", label: "custom http", token: "token-1" }
          ],
          modelLibraryEntries: ["deepseek", "custom-http"],
          customHttpAdapter: { alias: "agent-2", url: "https://gateway.example" }
        },
        context
      })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("settings.model_probe", {
        input: {
          provider: "deepseek",
          modelAlias: "agent-1",
          settings: { modelLibraryAgents: modelLibraryState }
        },
        context
      })).resolves.toMatchObject({ status: 200, payload: { ok: true, provider: "deepseek" } });
      await expect(runOperation("agent_gateway.config.get", { context }))
        .resolves.toMatchObject({ status: 200 });
      await expect(runOperation("agent_gateway.config.set", {
        input: { value: { alias: "agent-2", url: "https://gateway.example" } },
        context
      })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("agent_gateway.call", {
        input: { workspaceId: "ws-1", prompt: "hello" },
        context: {
          ...context,
          agentWorkspace: {
            getWorkspaceContext: vi.fn(() => ({ workspaceId: "ws-1", contextProfileId: "ctx-1" }))
          }
        }
      })).resolves.toMatchObject({ status: 200, payload: { gateway: true } });
      await expect(runOperation("agents.list", { context }))
        .resolves.toMatchObject({ status: 200 });
      await expect(runOperation("model_routing.health", { input: { limit: 1 }, context }))
        .resolves.toMatchObject({ status: 200 });
      await expect(runOperation("agents.create", {
        input: { provider: "deepseek", model: "deepseek-chat", label: "new agent" },
        context
      })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("agents.update", {
        input: { agentId: "agent-1", label: "updated agent" },
        context
      })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("agents.delete", {
        input: { agentId: "agent-3" },
        context
      })).resolves.toMatchObject({ status: 404 });

      expect(protocolEventBus.publish).toHaveBeenCalled();
      expect(agentRuntimeProvider.getAgentConfigRegistry).toHaveBeenCalled();
    });
  });

  it("covers model library audit normalization and probe provider branches", async () => {
    await withTempDir(async (userDataPath) => {
      const protocolEventBus = { publish: vi.fn(async () => ({ id: "evt-3b" })) };
      const modelLibraryState = [
        {
          uid: "agent-1",
          provider: "deepseek",
          model: "deepseek-chat",
          label: "deepseek chat",
          agentName: "deepseek chat",
          baseUrl: "https://api.example",
          apiKey: "old-key",
          token: "old-token"
        },
        {
          uid: "agent-2",
          provider: "custom-http",
          model: "custom-model",
          label: "custom http",
          agentName: "custom http",
          url: "https://legacy.example",
          token: "legacy-token"
        }
      ];
      const registry = {
        refresh: vi.fn(async () => ({ ok: true })),
        replaceFromModelLibraryAgents: vi.fn(async (models) => {
          modelLibraryState.splice(0, modelLibraryState.length, ...models);
        }),
        getModelLibraryEntries: vi.fn(() => [...new Set(modelLibraryState.map((item) => item.provider))]),
        getModelLibraryAgents: vi.fn(() => modelLibraryState.map((item) => ({ ...item })))
      };
      const agentRuntimeProvider = {
        getAgentConfigRegistry: vi.fn(() => registry),
        publicAgentGatewayConfig: vi.fn(async (settings) => ({ ok: true, gateway: settings.customHttpAdapter || null })),
        publicAgentGatewayRegistry: vi.fn(async () => ({ ok: true, agents: modelLibraryState.map((item) => ({ alias: item.uid })) })),
        callAgentGateway: vi.fn(async (input) => ({ ok: true, gateway: true, input })),
        inspectAgentModelRouting: vi.fn(async () => ({ ok: true, routing: true })),
        probeModelConnection: vi.fn(async ({ provider, modelAlias }) => ({
          ok: true,
          configured: true,
          provider,
          model: modelAlias,
          statusCode: 200,
          latencyMs: 12,
          checkedAt: new Date().toISOString(),
          message: "ok"
        }))
      };
      const context = {
        userDataPath,
        agentRuntimeProvider,
        moduleManagement: { refreshMounts: vi.fn(async () => ({ ok: true })) },
        protocolEventBus,
        authSession: { user: { userId: "u-1", username: "alice" } },
        appendConsoleOperationLog: vi.fn()
      };

      await expect(runOperation("settings.set", {
        input: {
          modelLibraryAgents: [
            {},
            {
              uid: "agent-1",
              provider: "deepseek",
              model: "deepseek-chat",
              label: "deepseek chat",
              parametersText: "{\"mode\":\"fast\"}",
              plugins: "alpha, beta",
              timeoutMs: "15"
            },
            {
              uid: "agent-3",
              provider: "custom-http",
              model: "custom-model",
              label: "custom http",
              token: "token-3",
              baseUrl: "https://custom.example",
              parametersText: "{\"retries\":2}",
              pluginList: "gamma, delta",
              timeoutMs: "0"
            }
          ],
          modelLibraryEntries: ["deepseek", "custom-http"],
          customHttpAdapter: { alias: "custom-model", url: "https://gateway.example", token: "" }
        },
        context
      })).resolves.toMatchObject({ status: 200 });

      await expect(runOperation("settings.model_probe", {
        input: {
          provider: "deepseek",
          modelAlias: "agent-1",
          settings: {
            modelLibraryAgents: modelLibraryState,
            deepSeekModel: "deepseek-chat"
          }
        },
        context
      })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("settings.model_probe", {
        input: {
          provider: "custom-http",
          modelAlias: "agent-3",
          settings: {
            modelLibraryAgents: modelLibraryState,
            customHttpAdapter: { alias: "custom-model", token: "preserve-me" },
            customModelAlias: "custom-model"
          }
        },
        context
      })).resolves.toMatchObject({ status: 200 });
      for (const [provider, modelAlias, settings] of [
        ["google-gemini", "", { googleModel: "gemini-1", modelLibraryAgents: [{ provider: "google-gemini", model: "gemini-1", uid: "gg-1" }] }],
        ["openai-chatgpt", "", { openAiModel: "gpt-4o", modelLibraryAgents: [{ provider: "openai-chatgpt", model: "gpt-4o", uid: "oa-1" }] }],
        ["openrouter", "", { openRouterModel: "router-model", modelLibraryAgents: [{ provider: "openrouter", model: "router-model", uid: "or-1" }] }],
        ["copilot", "", { copilotModel: "copilot-model", modelLibraryAgents: [{ provider: "copilot", model: "copilot-model", uid: "cp-1" }] }],
        ["local-model", "", { localModelName: "local-model", modelLibraryAgents: [{ provider: "local-model", model: "local-model", uid: "lm-1" }] }]
      ]) {
        await expect(runOperation("settings.model_probe", {
          input: {
            provider,
            modelAlias,
            settings
          },
          context
        })).resolves.toMatchObject({ status: 200 });
      }

      await expect(runOperation("agents.create", {
        input: {
          provider: "custom-http",
          model: "custom-model",
          label: "custom created",
          apiKey: "api-secret",
          token: "token-secret",
          parametersText: "{\"enabled\":true}",
          plugins: "epsilon, zeta",
          timeoutMs: "45"
        },
        context
      })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("agents.update", {
        input: {
          agentId: "agent-1",
          label: "updated deepseek",
          model: "deepseek-chat",
          apiKey: "updated-key",
          token: "updated-token",
          parametersText: "{\"retries\":3}",
          plugins: "theta, iota",
          timeoutMs: "abc"
        },
        context
      })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("agents.delete", {
        input: { agentId: "agent-2" },
        context
      })).resolves.toMatchObject({ status: 404 });

      const brokenProviderContext = {
        ...context,
        userDataPath,
        agentRuntimeProvider: {
          getAgentConfigRegistry: vi.fn(() => registry)
        }
      };
      await expect(runOperation("agents.create", {
        input: { provider: "deepseek", model: "deepseek-chat", label: "broken" },
        context: brokenProviderContext
      })).resolves.toMatchObject({ status: 500, payload: { error: "Agent gateway runtime provider is not configured." } });
      await expect(runOperation("agents.update", {
        input: { agentId: "agent-1", label: "broken update" },
        context: brokenProviderContext
      })).resolves.toMatchObject({ status: 500, payload: { error: "Agent gateway runtime provider is not configured." } });
      await expect(runOperation("agents.delete", {
        input: { agentId: "agent-1" },
        context: brokenProviderContext
      })).resolves.toMatchObject({ status: 500, payload: { error: "Agent gateway runtime provider is not configured." } });

      expect(protocolEventBus.publish).toHaveBeenCalled();
    });
  });

  it("covers auth, audit, authorization, tool management, and strategy branches", async () => {
    await withTempDir(async (userDataPath) => {
      const auditStoreState = {
        retention: { retentionDays: 30, maxExportItems: 50 }
      };
      const operationAuditStore = {
        list: vi.fn(() => [{ auditId: "audit-1", operationId: "op-1", status: "ok", createdAt: "2026-01-01T00:00:00.000Z" }]),
        exportRedacted: vi.fn(() => ({ manifest: { count: 1 }, items: [{ id: "audit-1" }], jsonl: "[]" })),
        getRetentionPolicy: vi.fn(() => auditStoreState.retention),
        setRetentionPolicy: vi.fn((policy) => {
          auditStoreState.retention = { ...auditStoreState.retention, ...policy };
          return auditStoreState.retention;
        }),
        pruneExpired: vi.fn(() => ({ pruned: 1 })),
        getTrace: vi.fn(() => ({ traceId: "trace-1", spans: [] }))
      };
      const securityPermissions = {
        getConsoleSummary: vi.fn(() => ({ ok: true, mode: "summary" })),
        login: vi.fn(async (input) => {
          if (input.username === "bad") {
            throw new Error("bad login");
          }
          return {
            session: { user: { userId: "u-1", username: "alice", roleId: "admin" }, sessionId: "session-1" },
            cookies: "cookie=1",
            csrfToken: "csrf-1"
          };
        }),
        logout: vi.fn(() => ({ cookies: "cookie=logout" })),
        roleList: vi.fn(() => [{ roleId: "admin" }]),
        listUsers: vi.fn(() => [{ userId: "u-1" }]),
        updateUser: vi.fn(async (userId) => ({ userId, roleId: "admin", enabled: true })),
        getOidcConfig: vi.fn(() => ({ enabled: true, issuer: "https://issuer.example" })),
        setOidcConfig: vi.fn((input) => ({ enabled: true, issuer: input.issuer || "https://issuer.example", clientId: "client-1" })),
        audit: vi.fn(),
        listAudit: vi.fn(() => [{ auditId: "audit-1" }]),
        listSessions: vi.fn(() => [{ sessionId: "session-1" }]),
        rotateSession: vi.fn(() => ({ ok: true, session: { sessionId: "session-2", user: { userId: "u-1" } }, cookies: "cookie=rotated", csrfToken: "csrf-2", rotatedAt: "2026-01-01T00:00:00.000Z" })),
        revokeSession: vi.fn(() => ({ ok: true, sessionId: "session-1" })),
        listDecisions: vi.fn(() => [{ decisionId: "d-1" }]),
        resolveSubject: vi.fn(({ subject }) => ({ subject, resolved: true })),
        evaluatePolicy: vi.fn((input) => ({ ok: true, input })),
        getGovernanceSummary: vi.fn(() => ({ ok: true, policy: "summary" })),
        listGovernanceRoles: vi.fn(() => [{ roleId: "admin" }]),
        upsertGovernanceRole: vi.fn((input) => ({ roleId: input.roleId || "admin" })),
        listGovernanceTeams: vi.fn(() => [{ teamId: "team-1" }]),
        upsertGovernanceTeam: vi.fn((input) => ({ teamId: input.teamId || "team-1" })),
        listGovernanceUserPolicies: vi.fn(() => [{ userId: "u-1" }]),
        upsertGovernanceUserPolicy: vi.fn((input) => ({ userId: input.userId || "u-1" })),
        listGovernanceAgentGroups: vi.fn(() => [{ groupId: "group-1" }]),
        upsertGovernanceAgentGroup: vi.fn((input) => ({ groupId: input.groupId || "group-1" })),
        listGovernanceAgentBindings: vi.fn(() => [{ agentId: "agent-1" }]),
        upsertGovernanceAgentBinding: vi.fn((input) => ({ agentId: input.agentId || "agent-1" })),
        listGovernanceApprovals: vi.fn(() => [{ approvalId: "approval-1" }]),
        upsertGovernanceApproval: vi.fn((input) => ({ approvalId: input.approvalId || "approval-1" })),
        revokeGovernanceApproval: vi.fn((input) => ({ approvalId: input.approvalId || input.id || "approval-1" })),
        listReceipts: vi.fn(() => [{ receiptId: "receipt-1" }]),
        listLoanRecords: vi.fn(() => [{ loanId: "loan-1" }]),
        listDeniedRequests: vi.fn(() => [{ deniedId: "denied-1" }]),
        setWorkspaceAssetPolicy: vi.fn((input) => ({ policyId: "policy-1", ...input })),
        checkWorkspaceAssetPermission: vi.fn((input) => ({ allowed: true, ...input })),
        appendReceipt: vi.fn(),
        appendLoanRecord: vi.fn(),
        appendDeniedRequest: vi.fn()
      };
      const toolSkillManagementProvider = {
        createAuthorizationGrant: vi.fn(async () => ({ grant: { grantId: "grant-1" }, token: "grant-token" })),
        revokeAuthorizationGrant: vi.fn(async () => ({ grantId: "grant-1" })),
        createMcpAuthorizationRequest: vi.fn(() => ({ requestId: "req-1" })),
        listMcpAuthorizationRequests: vi.fn(() => [{ requestId: "req-1" }]),
        resolveMcpAuthorizationRequest: vi.fn(async () => ({ success: true, grantId: "grant-1" })),
        handleToolManagementHttpRequest: vi.fn(async () => false),
        authorizeRequest: vi.fn(async () => ({ ok: true, grant: { grantId: "grant-1" } }))
      };
      const strategyManagementProvider = {
        describe: vi.fn(() => ({ ok: true, strategy: true })),
        evaluateWorkflowPolicy: vi.fn((input) => ({ ok: true, input })),
        evaluateAgentPolicy: vi.fn((input) => ({ ok: true, input })),
        evaluateToolPolicy: vi.fn((input) => ({ ok: true, input }))
      };
      const context = {
        userDataPath,
        request: {
          headers: { host: "localhost", origin: "http://localhost", "user-agent": "vitest" },
          socket: { remoteAddress: "127.0.0.1" },
          __pactToolRuntimeAuthorization: { ok: true }
        },
        response: {},
        operationAuditStore,
        securityPermissions,
        toolSkillManagementProvider,
        strategyManagementProvider,
        authSession: { user: { userId: "u-1", username: "alice", roleId: "admin" } },
        protocolEventBus: { publish: vi.fn(async () => ({ id: "evt-4" })) },
        url: "http://localhost/api/tool-management/http",
        method: "POST"
      };

      await expect(runOperation("auth.session", { context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("auth.login", { input: { username: "alice", password: "secret" }, context }))
        .resolves.toMatchObject({ status: 200, payload: { ok: true } });
      await expect(runOperation("auth.login", { input: { username: "bad", password: "secret" }, context }))
        .resolves.toMatchObject({ status: 401 });
      await expect(runOperation("auth.logout", { context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("auth.users", { context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("auth.users.update", { input: { userId: "u-1" }, context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("auth.users.update", { input: { userId: "u-1", password: "x" }, context })).resolves.toMatchObject({ status: 405 });
      await expect(runOperation("auth.roles.get", { input: { roleId: "admin" }, context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("auth.oidc.get", { context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("auth.oidc.set", { input: { issuer: "https://issuer.example" }, context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("auth.audit", { context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("auth.audit.export", { context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("auth.audit.retention.get", { context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("auth.audit.retention.set", { input: { retentionDays: 60 }, context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("auth.audit.prune", { context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("auth.sessions", { context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("auth.sessions.rotate", { context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("auth.sessions.revoke", { input: { sessionId: "session-1" }, context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("observability.trace.get", { input: { traceId: "trace-1" }, context })).resolves.toMatchObject({ status: 200 });

      await expect(runOperation("workspace.audit.query", { context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("workspace.operation.history", { context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("workspace.operation.revert.scope", { input: { limit: 1 }, context })).resolves.toMatchObject({ status: 200 });

      await expect(runOperation("authorization.subject.resolve", { input: { subject: { subjectId: "u-1" } }, context }))
        .resolves.toMatchObject({ status: 200 });
      await expect(runOperation("authorization.policy.evaluate", { input: { operationId: "op-1", requiredScopes: ["read"] }, context }))
        .resolves.toMatchObject({ status: 200 });
      await expect(runOperation("authorization.governance.summary", { context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("authorization.roles.list", { context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("authorization.roles.upsert", { input: { roleId: "role-1" }, context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("authorization.teams.list", { context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("authorization.teams.upsert", { input: { teamId: "team-1" }, context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("authorization.users.policies.list", { context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("authorization.users.policy.upsert", { input: { userId: "u-1" }, context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("authorization.agent_groups.list", { context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("authorization.agent_groups.upsert", { input: { groupId: "group-1" }, context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("authorization.agents.bindings.list", { context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("authorization.agents.binding.upsert", { input: { agentId: "agent-1" }, context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("authorization.approvals.list", { context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("authorization.approvals.upsert", { input: { approvalId: "approval-1" }, context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("authorization.approvals.revoke", { input: { approvalId: "approval-1" }, context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("authorization.receipts.list", { context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("authorization.loan_records.list", { context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("authorization.denied_requests.list", { context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("workspace.asset.policy.set", { input: { workspaceId: "ws-1" }, context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("workspace.asset.permission.check", { input: { workspaceId: "ws-1" }, context })).resolves.toMatchObject({ status: 200 });

      await expect(runOperation("authorization.grants.create", { context })).resolves.toMatchObject({ status: 201 });
      await expect(runOperation("authorization.grants.revoke", { context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("tool_management.mcp.request_authorization", { context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("tool_management.mcp.list_requests", { context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("tool_management.mcp.resolve_request", { context })).resolves.toMatchObject({ status: 200 });

      await expect(runOperation("tool_management.http.passthrough", { context: { ...context, toolSkillManagementProvider: { ...toolSkillManagementProvider, handleToolManagementHttpRequest: vi.fn(async () => false) } } }))
        .resolves.toMatchObject({ status: 404 });
      await expect(runOperation("tool_management.http.passthrough", { context: { ...context, toolSkillManagementProvider: { ...toolSkillManagementProvider, handleToolManagementHttpRequest: vi.fn(async () => true) } } }))
        .resolves.toMatchObject({ status: 200, payload: { __responseHandled: true } });
      await expect(runOperation("strategy.describe", { context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("strategy.workflow_policy.evaluate", { input: { workflowId: "wf-1" }, context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("strategy.agent_policy.evaluate", { input: { agentId: "agent-1" }, context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("strategy.tool_policy.preview", { input: { tool: "tool-1" }, context })).resolves.toMatchObject({ status: 200 });

      expect(securityPermissions.audit).toHaveBeenCalled();
      expect(toolSkillManagementProvider.authorizeRequest).not.toHaveBeenCalled();
    });
  });

  it("covers production readiness, oauth, and asset lineage branches", async () => {
    await withTempDir(async (userDataPath) => {
      const context = { userDataPath };
      await expect(runOperation("production.health", { context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("architecture.live_map", { context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("executive_report.preview", { input: { headline: "Report" }, context }))
        .resolves.toMatchObject({ status: 200 });
      await expect(runOperation("executive_report.list", { context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("executive_report.generate", { input: { headline: "Report" }, context }))
        .resolves.toMatchObject({ status: 200 });
      await expect(runOperation("sample_business_pack.list", { context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("sample_business_pack.get", { input: { packId: "enterprise-knowledge-pilot" }, context }))
        .resolves.toMatchObject({ status: 200 });
      await expect(runOperation("sample_business_pack.materialize", {
        input: { packId: "enterprise-knowledge-pilot", targetPath: path.join(userDataPath, "pack") },
        context
      })).resolves.toMatchObject({ status: 200 });

      await expect(runOperation("oauth.codex_status", { context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("oauth.codex_login", { context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("oauth.codex_return", { context })).resolves.toMatchObject({ status: 200, payload: { __htmlResponse: true } });

      await expect(runOperation("asset_lineage.describe", { context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("asset_lineage.record", { input: { record: { id: "asset-1" } }, context })).resolves.toMatchObject({ status: 400 });
      await expect(runOperation("asset_lineage.trace", { input: { id: "asset-1" }, context })).resolves.toMatchObject({ status: 400 });
      await expect(runOperation("asset_lineage.reparse_plan", { input: { id: "asset-1" }, context })).resolves.toMatchObject({ status: 400 });
    });
  });

  it("covers optional provider fallbacks and remaining status mappings", async () => {
    await withTempDir(async (userDataPath) => {
      const noProviders = { userDataPath };
      const authProviderOnly = {
        userDataPath,
        securityPermissions: {
          getConsoleSummary: vi.fn(() => ({ ok: true })),
          login: vi.fn(async () => ({ session: { user: { userId: "u-1", username: "alice" } }, cookies: "cookie=1", csrfToken: "csrf-1" })),
          logout: vi.fn(() => ({ cookies: "cookie=logout" })),
          roleList: vi.fn(() => []),
          listUsers: vi.fn(() => []),
          updateUser: vi.fn(async (userId) => ({ userId })),
          getOidcConfig: vi.fn(() => ({})),
          setOidcConfig: vi.fn((input) => input),
          audit: vi.fn(),
          listAudit: vi.fn(() => []),
          listSessions: vi.fn(() => []),
          rotateSession: vi.fn(() => ({ ok: true, session: { sessionId: "session-1" }, cookies: "cookie=rotated", csrfToken: "csrf-2", rotatedAt: "2026-01-01T00:00:00.000Z" })),
          revokeSession: vi.fn(() => ({ ok: true })),
          listDecisions: vi.fn(() => [])
        }
      };
      await expect(runOperation("auth.session", { context: noProviders }))
        .resolves.toMatchObject({ status: 503, payload: { error: "控制台认证模块不可用。" } });
      await expect(runOperation("auth.audit.export", { context: authProviderOnly }))
        .resolves.toMatchObject({ status: 503, payload: { error: "系统审计导出接口不可用。" } });
      await expect(runOperation("auth.audit.retention.get", { context: authProviderOnly }))
        .resolves.toMatchObject({ status: 503, payload: { error: "系统审计保留策略接口不可用。" } });
      await expect(runOperation("auth.audit.retention.set", { input: { retentionDays: 60 }, context: authProviderOnly }))
        .resolves.toMatchObject({ status: 503, payload: { error: "系统审计保留策略接口不可用。" } });
      await expect(runOperation("auth.audit.prune", { context: authProviderOnly }))
        .resolves.toMatchObject({ status: 503, payload: { error: "系统审计清理接口不可用。" } });
      await expect(runOperation("knowledge.access.receipt.list", { context: noProviders }))
        .resolves.toMatchObject({ status: 503, payload: { error: "授权记录存储不可用。" } });
      await expect(runOperation("system.monitor_alerts.get", { context: noProviders }))
        .resolves.toMatchObject({ status: 503, payload: { error: "运维 provider 不可用。" } });
      await expect(runOperation("system.background_processes", { context: noProviders }))
        .resolves.toMatchObject({ status: 503, payload: { error: "运维 provider 不可用。" } });
      await expect(runOperation("storage.summary", { context: noProviders }))
        .resolves.toMatchObject({ status: 503, payload: { error: "存储 provider 不可用。" } });
      await expect(runOperation("knowledge.corpus.significant_terms", { context: noProviders }))
        .resolves.toMatchObject({ status: 503, payload: { error: "存储 provider 不可用。" } });
      await expect(runOperation("context.profiles.get", { context: noProviders }))
        .resolves.toMatchObject({ status: 503, payload: { error: "上下文运行时不可用。" } });
      await expect(runOperation("context.preview", { input: { workspaceId: "ws-1" }, context: {
        userDataPath,
        contextRuntime: {
          preview: vi.fn(async () => ({ ok: true }))
        }
      } })).resolves.toMatchObject({ status: 503, payload: { error: "工作空间上下文不可用。" } });
      await expect(runOperation("context.preview", { input: { workspaceId: "ws-1" }, context: {
        userDataPath,
        contextRuntime: {
          preview: vi.fn(async () => ({ ok: true }))
        },
        agentWorkspace: {}
      } })).resolves.toMatchObject({ status: 503, payload: { error: "工作空间上下文不可用。" } });
      await expect(runOperation("workspace.audit.query", { context: noProviders }))
        .resolves.toMatchObject({ status: 200, payload: { items: [] } });
      await expect(runOperation("tool_management.http.passthrough", { context: noProviders }))
        .resolves.toMatchObject({ status: 503, payload: { error: "Tool/Skill management provider is unavailable." } });
    });
  });

  it("covers operation route fallback, gerrit upload, and remaining service branches", async () => {
    await withTempDir(async (userDataPath) => {
      const context = {
        userDataPath,
        request: {
          __pactToolRuntimeAuthorization: { ok: true }
        },
        response: {},
        protocolEventBus: { publish: vi.fn(async () => ({ id: "evt-6" })) }
      };

      await expect(runOperation("workspace.code.change.upload", {
        input: { branch: "feature/test" },
        context
      })).resolves.toMatchObject({
        status: 200,
        payload: {
          ok: true,
          uploaded: true
        }
      });

      await expect(runOperation("gerrit.git_upload", {
        input: { branch: "feature/test" },
        context
      })).resolves.toMatchObject({
        status: 200,
        payload: {
          ok: true,
          changeId: "gerrit-change-1",
          branch: "feature/test"
        }
      });

      await expect(runOperation("asset_lineage.describe", { context }))
        .resolves.toMatchObject({ status: 200, payload: { ok: true, lineage: true } });
      await expect(runOperation("asset_lineage.unknown", { context }))
        .resolves.toMatchObject({ status: 501 });

      await expect(runOperation("data_connectors.governance.describe", { context: { userDataPath } }))
        .resolves.toMatchObject({ status: 200, payload: { ok: true, source: "data-connectors" } });
      await expect(runOperation("data_connectors.governance.plan", {
        input: { manifest: { name: "connector-1" } },
        context: { userDataPath }
      })).resolves.toMatchObject({ status: 200, payload: { ok: true, manifest: { name: "connector-1" } } });
      await expect(runOperation("data_connectors.governance.conformance", {
        input: { manifest: { name: "connector-1" } },
        context: { userDataPath }
      })).resolves.toMatchObject({ status: 200, payload: { ok: true, manifest: { name: "connector-1" } } });

      await expect(runOperation("performance.capacity.targets", { context: { userDataPath } }))
        .resolves.toMatchObject({ status: 200, payload: [{ targetId: "cpu" }] });
      await expect(runOperation("performance.capacity.benchmark", {
        input: { profileId: "smoke" },
        context: { userDataPath }
      })).resolves.toMatchObject({ status: 200, payload: { ok: true, profileId: "smoke" } });

      await expect(runOperation("runtime.dependencies.list", { context: { userDataPath } }))
        .resolves.toMatchObject({ status: 200, payload: { dependencies: [{ id: "runtime-a" }] } });
      await expect(runOperation("runtime.dependencies.configure", {
        input: { targetId: "runtime-a" },
        context: { userDataPath }
      })).resolves.toMatchObject({ status: 200, payload: { ok: true, saved: true } });
    });
  });

  it("covers knowledge orchestration, evaluation, evolution, summarization, and external distillation branches", async () => {
    await withTempDir(async (userDataPath) => {
      const protocolEventBus = { publish: vi.fn(async () => ({ id: "evt-5" })) };
      const knowledgeRuleAuthoringRuntime = {
        chat: vi.fn(async () => ({ ok: true, chat: true })),
        getRun: vi.fn(async () => ({ ok: true, runId: "rule-run-1" }))
      };
      const goldenRuleRuntime = {
        listRulePackages: vi.fn(async () => ({ ok: true, items: [{ id: "rule-1" }] })),
        getRulePackage: vi.fn(async () => ({ ok: true, id: "rule-1" })),
        saveRulePackage: vi.fn(async (input) => ({ ok: true, input })),
        publishRulePackage: vi.fn(async (input) => ({ ok: true, input })),
        rollbackRulePackage: vi.fn(async (input) => ({ ok: true, input })),
        listGoldCases: vi.fn(async () => ({ ok: true, items: [{ id: "case-1" }] })),
        saveGoldCase: vi.fn(async (input) => ({ ok: true, input })),
        exportTrainingSet: vi.fn(async () => ({ ok: true, exported: true })),
        saveGoldCaseFromSkillResolution: vi.fn(async () => ({ ok: true }))
      };
      const knowledgeSkillRuntime = {
        listSkills: vi.fn(async () => ({ ok: true, items: [{ skillId: "skill-1" }] })),
        getSkill: vi.fn(() => ({ skillId: "skill-1" })),
        generateSkill: vi.fn(async () => ({ ok: true, generated: true })),
        proposeSkill: vi.fn(async () => ({ ok: true, proposed: true })),
        resolveSkill: vi.fn(() => ({ ok: true, action: "publish", skill: { skillId: "skill-1" } })),
        loadFramework: vi.fn(async () => ({ protocolVersion: "pact.knowledge-skill.v1" })),
        saveFramework: vi.fn(async () => ({ ok: true, saved: true })),
        runSkillEvaluation: vi.fn(async () => ({ ok: true, run: true })),
        createSkillDeployment: vi.fn(async () => ({ ok: true, deploymentId: "dep-1" })),
        rollbackSkillDeployment: vi.fn(async () => ({ ok: true, deploymentId: "dep-1" }))
      };
      const knowledgeAgentSkill = {
        describe: vi.fn(() => ({ ok: true, agentSkill: true })),
        plan: vi.fn(() => ({ ok: true, planned: true })),
        run: vi.fn(async () => ({ ok: true, ran: true }))
      };
      const evidenceSufficiencyGate = {
        evaluate: vi.fn(() => ({ ok: true, passed: true }))
      };
      const agentEvaluationRuntime = {
        runEvaluation: vi.fn(async () => ({ ok: true, runId: "eval-1" })),
        listRuns: vi.fn(async () => ({ ok: true, items: [{ runId: "eval-1" }] })),
        getRun: vi.fn(async () => ({ ok: true, runId: "eval-1" }))
      };
      const modelDecisionRuntime = {
        describe: vi.fn(() => ({ ok: true, roles: [] })),
        decide: vi.fn(async () => ({ ok: true, decision: "allow" }))
      };
      const strategyManagementProvider = {
        createModelDecisionRuntimePort: vi.fn(() => modelDecisionRuntime)
      };
      const knowledgeEvolutionRuntime = {
        describe: vi.fn(() => ({ ok: true, evolution: true })),
        runEvolution: vi.fn(async () => ({ ok: true, runId: "evo-1" })),
        listRuns: vi.fn(async () => ({ ok: true, items: [{ runId: "evo-1" }] })),
        getRun: vi.fn(async () => ({ ok: true, runId: "evo-1" })),
        auditHierarchy: vi.fn(async () => ({ ok: true, audited: true })),
        listDeployments: vi.fn(() => ({ ok: true, items: [{ deploymentId: "dep-1" }] })),
        promote: vi.fn(async () => ({ ok: true, promoted: true })),
        rollback: vi.fn(async () => ({ ok: true, rolledBack: true }))
      };
      const summarizationRuntime = {
        startRun: vi.fn(async () => ({ run: { status: "completed" } })),
        getRun: vi.fn(() => ({ ok: true, runId: "sum-1" })),
        approveRun: vi.fn(async () => ({ ok: true, approved: true }))
      };
      const agentExplorationRuntime = {
        run: vi.fn(async () => ({ ok: true, runId: "explore-1" })),
        getRun: vi.fn(() => ({ ok: true, runId: "explore-1" }))
      };
      const metadataStore = {
        getKnowledgeGraph: vi.fn(() => ({ nodes: [] }))
      };
      const context = {
        userDataPath,
        protocolEventBus,
        knowledgeRuleAuthoringRuntime,
        goldenRuleRuntime,
        knowledgeSkillRuntime,
        knowledgeAgentSkill,
        evidenceSufficiencyGate,
        agentEvaluationRuntime,
        modelDecisionRuntime,
        strategyManagementProvider,
        knowledgeEvolutionRuntime,
        summarizationRuntime,
        agentExplorationRuntime,
        metadataStore,
        runtime: { mounts: { knowledgeBase: { search: vi.fn(async () => ({ ok: true })) } } },
        authSession: { user: { userId: "u-1", username: "alice", roleId: "admin" } }
      };

      await expect(runOperation("knowledge.rule_authoring.chat", { input: { prompt: "hi" }, context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("knowledge.rule_authoring.runs.get", { input: { runId: "rule-run-1" }, context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("knowledge.golden_rules.list", { context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("knowledge.golden_rules.save", { input: { title: "rule" }, context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("knowledge.golden_rules.publish", { input: { packageId: "rule-1" }, context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("knowledge.golden_rules.rollback", { input: { packageId: "rule-1" }, context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("knowledge.gold_cases.list", { context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("knowledge.gold_cases.save", { input: { title: "case" }, context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("knowledge.training_sets.export", { context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("knowledge.skills.list", { context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("knowledge.skills.get", { input: { skillId: "skill-1" }, context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("knowledge.skills.generate", { input: { prompt: "build" }, context })).resolves.toMatchObject({ status: 201 });
      await expect(runOperation("knowledge.skills.propose", { input: { prompt: "build" }, context })).resolves.toMatchObject({ status: 201 });
      await expect(runOperation("knowledge.skills.resolve", { input: { skillId: "skill-1" }, context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("knowledge.skills.framework", { context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("knowledge.skills.framework_save", { input: { title: "framework" }, context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("knowledge.skills.evaluation.runs.create", { input: { title: "eval" }, context })).resolves.toMatchObject({ status: 201 });
      await expect(runOperation("knowledge.skills.deployments.create", { input: { title: "deploy" }, context })).resolves.toMatchObject({ status: 201 });
      await expect(runOperation("knowledge.skills.deployments.rollback", { input: { deploymentId: "dep-1" }, context })).resolves.toMatchObject({ status: 200 });

      await expect(runOperation("knowledge.evidence_gate.evaluate", { context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("knowledge.agent_skill.describe", { context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("knowledge.agent_skill.plan", { context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("knowledge.agent_skill.run", { context })).resolves.toMatchObject({ status: 200 });

      await expect(runOperation("knowledge.evaluation.runs.create", { input: { title: "eval" }, context })).resolves.toMatchObject({ status: 201 });
      await expect(runOperation("knowledge.evaluation.runs.list", { context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("knowledge.evaluation.runs.get", { input: { runId: "eval-1" }, context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("knowledge.model_roles", { context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("knowledge.model_decision", { input: { prompt: "decide" }, context })).resolves.toMatchObject({ status: 200 });

      await expect(runOperation("knowledge.evolution.describe", { context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("knowledge.evolution.runs.create", { input: { title: "evo" }, context })).resolves.toMatchObject({ status: 201 });
      await expect(runOperation("knowledge.evolution.runs.list", { context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("knowledge.evolution.runs.get", { input: { runId: "evo-1" }, context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("knowledge.hierarchy.audit", { context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("knowledge.evolution.deployments.list", { context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("knowledge.evolution.deployments.promote", { input: { deploymentId: "dep-1" }, context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("knowledge.evolution.deployments.rollback", { input: { deploymentId: "dep-1" }, context })).resolves.toMatchObject({ status: 200 });

      await expect(runOperation("knowledge.summarization.runs.create", { input: { title: "summary" }, context })).resolves.toMatchObject({ status: 201 });
      await expect(runOperation("knowledge.summarization.runs.get", { input: { runId: "sum-1" }, context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("knowledge.summarization.runs.approve", { input: { runId: "sum-1" }, context })).resolves.toMatchObject({ status: 200 });

      await expect(runOperation("knowledge.agent_explore.runs.create", { input: { title: "explore" }, context })).resolves.toMatchObject({ status: 201 });
      await expect(runOperation("knowledge.agent_explore.runs.get", { input: { runId: "explore-1" }, context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("knowledge.backend.connect", { context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("knowledge.space.list", { context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("knowledge.export.request", { context })).resolves.toMatchObject({ status: 202 });
      await expect(runOperation("knowledge.permission.request", { context })).resolves.toMatchObject({ status: 201 });
      await expect(runOperation("knowledge.graph", { input: { seed: "root" }, context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("raw-corpus.format.convert", { input: { text: "sample" }, context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("knowledge.dossier.export", { input: { title: "dossier" }, context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("knowledge.distillation.export", { context })).resolves.toMatchObject({ status: 501 });

      await expect(runOperation("external.knowledge.distillation.service.health", { context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("external.knowledge.distillation.service.capabilities", { context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("external.knowledge.distillation.service.runtime_health", { context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("external.knowledge.distillation.runs.list", { context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("external.knowledge.distillation.runs.create", { context })).resolves.toMatchObject({ status: 201 });
      await expect(runOperation("external.knowledge.distillation.runs.get", { context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("external.knowledge.distillation.runs.cancel", { context })).resolves.toMatchObject({ status: 202 });
      await expect(runOperation("external.knowledge.distillation.evidence.query", { context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("external.knowledge.distillation.projects.evidence.query", { context })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("external.knowledge.distillation.artifacts.export", { context })).resolves.toMatchObject({ status: 200 });

      expect(protocolEventBus.publish).toHaveBeenCalled();
    });
  });

  it("covers settings model probe secret preservation and agent payload normalization edges", async () => {
    await withTempDir(async (userDataPath) => {
      const protocolEventBus = { publish: vi.fn(async () => ({ id: "evt-7" })) };
      const modelLibraryState = [
        {
          provider: "deepseek",
          model: "deepseek-chat",
          label: "deepseek current",
          apiKey: "current-deep-key",
          token: "current-deep-token"
        },
        {
          provider: "deepseek",
          model: "deepseek-chat",
          label: "deepseek duplicate"
        },
        {
          provider: "custom-http",
          model: "custom-model",
          label: "custom current",
          token: "current-custom-token"
        }
      ];
      const registry = {
        refresh: vi.fn(async () => ({ ok: true })),
        replaceFromModelLibraryAgents: vi.fn(async (models) => {
          modelLibraryState.splice(0, modelLibraryState.length, ...models);
        }),
        getModelLibraryEntries: vi.fn(() => [...new Set(modelLibraryState.map((item) => item.provider))]),
        getModelLibraryAgents: vi.fn(() => modelLibraryState.map((item) => ({ ...item })))
      };
      const agentRuntimeProvider = {
        getAgentConfigRegistry: vi.fn(() => registry),
        publicAgentGatewayConfig: vi.fn(async (settings) => ({ ok: true, gateway: settings.customHttpAdapter || null })),
        publicAgentGatewayRegistry: vi.fn(async () => ({ ok: true, agents: modelLibraryState.map((item) => ({ alias: item.uid || item.model })) })),
        callAgentGateway: vi.fn(async (input) => ({ ok: true, gateway: true, input })),
        inspectAgentModelRouting: vi.fn(async () => ({ ok: true, routing: true })),
        probeModelConnection: vi.fn(async ({ provider, modelAlias }) => ({
          ok: true,
          configured: true,
          provider,
          model: modelAlias,
          statusCode: 200,
          latencyMs: 12,
          checkedAt: new Date().toISOString(),
          message: "ok"
        }))
      };
      const context = {
        userDataPath,
        agentRuntimeProvider,
        moduleManagement: {
          refreshMounts: vi.fn(async () => ({ ok: true }))
        },
        protocolEventBus,
        authSession: { user: { userId: "u-1", username: "alice" } },
        appendConsoleOperationLog: vi.fn()
      };

      await expect(runOperation("settings.set", {
        input: {
          googleApiKey: "google-current",
          openRouterApiKey: "router-current",
          deepSeekApiKey: "deep-current",
          customModelApiKey: "custom-current",
          customHttpAdapter: { alias: "custom-model", token: "adapter-current" },
          modelLibraryAgents: [
            {},
            {
              provider: "deepseek",
              model: "deepseek-chat",
              label: "deepseek current",
              parametersText: "{\"mode\":\"fast\"}",
              plugins: ["alpha", ""]
            },
            {
              provider: "custom-http",
              model: "custom-model",
              label: "custom current",
              parametersText: null,
              plugins: 42
            }
          ]
        },
        context
      })).resolves.toMatchObject({ status: 200 });

      await expect(runOperation("settings.model_probe", {
        input: {
          provider: "deepseek",
          settings: {
            deepSeekModel: "deepseek-chat",
            modelLibraryAgents: [
              { provider: "custom-http", model: "other-model", uid: "x" },
              { provider: "deepseek", model: "deepseek-chat", uid: "y" }
            ],
            customHttpAdapter: { alias: "custom-model" }
          }
        },
        context
      })).resolves.toMatchObject({ status: 200, payload: { ok: true, provider: "deepseek" } });

      await expect(runOperation("settings.model_probe", {
        input: {
          provider: "custom-http",
          modelAlias: "custom-model",
          settings: {
            modelLibraryAgents: [
              { provider: "deepseek", model: "deepseek-chat", uid: "deep-1" },
              { provider: "custom-http", model: "custom-model", uid: "custom-2" }
            ],
            customHttpAdapter: { alias: "custom-model" }
          }
        },
        context
      })).resolves.toMatchObject({ status: 200 });

      await expect(runOperation("agents.create", {
        input: {
          provider: "custom-http",
          model: "custom-model",
          label: "created",
          parametersText: "{bad json",
          plugins: 42,
          timeoutMs: "45"
        },
        context
      })).resolves.toMatchObject({ status: 200 });

      await expect(runOperation("agents.create", {
        input: {
          provider: "deepseek",
          model: "deepseek-chat",
          label: "created-2",
          parametersText: null,
          pluginList: ["theta", "", "iota"]
        },
        context
      })).resolves.toMatchObject({ status: 200 });

      await expect(runOperation("agents.update", {
        input: { agentId: "", label: "updated", model: "deepseek-chat" },
        context
      })).resolves.toMatchObject({ status: 404, payload: { error: "智能体模型配置不存在。" } });

      expect(protocolEventBus.publish).toHaveBeenCalled();
    });
  });

  it("covers auth, authorization, and agent sync optional branches", async () => {
    await withTempDir(async (userDataPath) => {
      const protocolEventBus = {
        subscribe: vi.fn(async () => ({ cursor: 2, nextCursor: 3, events: [{ topic: "agent.sync" }] })),
        publish: vi.fn(async () => ({ id: "evt-8" }))
      };
      const response = { once: vi.fn() };
      const authContext = {
        userDataPath,
        request: {
          headers: { host: "localhost", origin: "http://localhost", "user-agent": "vitest" },
          socket: { remoteAddress: "127.0.0.1" }
        },
        response,
        protocolEventBus,
        authSession: { user: { userId: "u-1", username: "alice", roleId: "admin" } },
        securityPermissions: {
          getSummary: vi.fn(() => ({ ok: true, mode: "summary" })),
          listAudit: vi.fn(() => [{ auditId: "audit-1" }]),
          audit: vi.fn()
        }
      };

      await expect(runOperation("auth.session", { context: authContext }))
        .resolves.toMatchObject({ status: 200, payload: { ok: true, mode: "summary" } });
      await expect(runOperation("auth.audit", { context: authContext }))
        .resolves.toMatchObject({ status: 200, payload: { items: [{ auditId: "audit-1" }] } });
      await expect(runOperation("auth.audit.export", { context: authContext }))
        .resolves.toMatchObject({ status: 503, payload: { error: "系统审计导出接口不可用。" } });

      const missingAuthzContext = {
        userDataPath,
        protocolEventBus,
        authSession: { user: { userId: "u-1", username: "alice", roleId: "admin" } },
        securityPermissions: {}
      };
      await expect(runOperation("authorization.subject.resolve", { input: { subject: { subjectId: "u-1" } }, context: missingAuthzContext }))
        .resolves.toMatchObject({ status: 503, payload: { error: "授权主体解析接口不可用。" } });
      await expect(runOperation("authorization.policy.evaluate", { input: { operationId: "op-1" }, context: missingAuthzContext }))
        .resolves.toMatchObject({ status: 503, payload: { error: "授权策略裁决接口不可用。" } });
      await expect(runOperation("authorization.governance.summary", { context: missingAuthzContext }))
        .resolves.toMatchObject({ status: 503, payload: { error: "统一权限治理存储不可用。" } });
      await expect(runOperation("authorization.roles.upsert", { input: { roleId: "role-1" }, context: missingAuthzContext }))
        .resolves.toMatchObject({ status: 503, payload: { error: "权限角色存储不可用。" } });
      await expect(runOperation("authorization.teams.upsert", { input: { teamId: "team-1" }, context: missingAuthzContext }))
        .resolves.toMatchObject({ status: 503, payload: { error: "权限团队存储不可用。" } });
      await expect(runOperation("authorization.users.policy.upsert", { input: { userId: "u-1" }, context: missingAuthzContext }))
        .resolves.toMatchObject({ status: 503, payload: { error: "用户授权策略存储不可用。" } });
      await expect(runOperation("authorization.agent_groups.upsert", { input: { groupId: "group-1" }, context: missingAuthzContext }))
        .resolves.toMatchObject({ status: 503, payload: { error: "智能体分组存储不可用。" } });
      await expect(runOperation("authorization.agents.binding.upsert", { input: { agentId: "agent-1" }, context: missingAuthzContext }))
        .resolves.toMatchObject({ status: 503, payload: { error: "智能体绑定存储不可用。" } });
      await expect(runOperation("authorization.approvals.upsert", { input: { approvalId: "approval-1" }, context: missingAuthzContext }))
        .resolves.toMatchObject({ status: 503, payload: { error: "审批授权存储不可用。" } });
      await expect(runOperation("authorization.approvals.revoke", { input: { approvalId: "approval-1" }, context: missingAuthzContext }))
        .resolves.toMatchObject({ status: 503, payload: { error: "审批授权存储不可用。" } });
      await expect(runOperation("authorization.receipts.list", { context: missingAuthzContext }))
        .resolves.toMatchObject({ status: 503, payload: { error: "授权回执存储不可用。" } });
      await expect(runOperation("authorization.loan_records.list", { context: missingAuthzContext }))
        .resolves.toMatchObject({ status: 503, payload: { error: "授权借用记录存储不可用。" } });
      await expect(runOperation("authorization.denied_requests.list", { context: missingAuthzContext }))
        .resolves.toMatchObject({ status: 503, payload: { error: "授权拒绝请求存储不可用。" } });
      await expect(runOperation("workspace.asset.policy.set", { input: { workspaceId: "ws-1" }, context: missingAuthzContext }))
        .resolves.toMatchObject({ status: 503, payload: { error: "工作空间资产策略 provider 不可用。" } });
      await expect(runOperation("workspace.asset.permission.check", { input: { workspaceId: "ws-1" }, context: missingAuthzContext }))
        .resolves.toMatchObject({ status: 503, payload: { error: "授权策略裁决接口不可用。" } });

      const governanceContext = {
        userDataPath,
        protocolEventBus,
        authSession: { user: { userId: "u-1", username: "alice", roleId: "admin" } },
        securityPermissions: {
          upsertGovernanceRole: vi.fn()
            .mockImplementationOnce(() => ({ teamIds: ["alpha", "beta"] }))
            .mockImplementationOnce(() => ({ teamIds: "gamma,delta" }))
        }
      };
      await expect(runOperation("authorization.roles.upsert", {
        input: { teamIds: ["alpha", "beta"] },
        context: governanceContext
      })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("authorization.roles.upsert", {
        input: { teamIds: "gamma,delta" },
        context: governanceContext
      })).resolves.toMatchObject({ status: 200 });

      await expect(runOperation("events.subscribe", {
        input: {
          cursor: ["", "2"],
          timeoutMs: ["", "10"],
          limit: ["", "3"],
          topic: ["", "agent.sync"],
          includeSnapshot: "true"
        },
        context: authContext
      })).resolves.toMatchObject({ status: 200 });
      await expect(runOperation("agent_sync.subscribe", {
        input: {
          cursor: ["", "2"],
          timeoutMs: ["", "10"],
          limit: ["", "3"],
          topic: ["", "agent.sync"],
          includeSnapshot: "true"
        },
        context: authContext
      })).resolves.toMatchObject({ status: 200 });

      await expect(runOperation("auth.unknown", { context: authContext }))
        .resolves.toMatchObject({ status: 501 });
      await expect(runOperation("settings.unknown", {
        context: {
          userDataPath,
          agentRuntimeProvider: {
            getAgentConfigRegistry: vi.fn(() => ({
              refresh: vi.fn(async () => ({ ok: true })),
              replaceFromModelLibraryAgents: vi.fn(),
              getModelLibraryEntries: vi.fn(() => []),
              getModelLibraryAgents: vi.fn(() => [])
            })),
            publicAgentGatewayRegistry: vi.fn(async () => ({ ok: true, agents: [] }))
          }
        }
      })).resolves.toMatchObject({ status: 501 });

      expect(protocolEventBus.subscribe).toHaveBeenCalled();
      expect(response.once).toHaveBeenCalled();
    });
  });

  it("covers workspace, context, knowledge, and not-found error branches", async () => {
    await withTempDir(async (userDataPath) => {
      const baseWorkspace = {
        getWorkspace: vi.fn(() => null),
        listWorkspaces: vi.fn(() => []),
        createWorkspace: vi.fn(() => ({ workspace: { workspaceId: "ws-new" } })),
        setWorkspaceParent: vi.fn(() => ({ ok: false, error: "bad parent" })),
        deleteWorkspace: vi.fn(() => ({ ok: false, error: "missing" })),
        listSessions: vi.fn(() => []),
        getSession: vi.fn(() => null),
        getSessionContext: vi.fn(() => null),
        getWorkspaceContext: vi.fn(() => null),
        appendSessionEvent: vi.fn(() => null),
        forkSession: vi.fn(() => ({ ok: false, error: "会话不存在" })),
        compareSessions: vi.fn(() => ({ ok: false, error: "会话不存在" })),
        createSessionMergeProposal: vi.fn(() => ({ ok: false, error: "会话不存在" })),
        archiveSession: vi.fn(() => ({ ok: false, error: "会话不存在" })),
        resolveSubmission: vi.fn(() => null),
        updateIssue: vi.fn(() => null),
        listLocks: vi.fn(() => []),
        acquireLock: vi.fn(() => ({ ok: false, error: "lock_held" })),
        releaseLock: vi.fn(() => ({ ok: false, error: "lock_held" })),
        submit: vi.fn(() => ({ submission: { submissionId: "sub-1", status: "pending", payload: { title: "Proposal" } } })),
        createDecision: vi.fn(() => ({ decision: { decisionId: "decision-1" } })),
        exportWorkspaceContextBundle: vi.fn(() => null),
        restoreWorkspaceContextBundle: vi.fn(() => ({ ok: false })),
        resolveWorkspaceChain: vi.fn(() => []),
        resolveWorkspaceSourceIds: vi.fn(() => []),
        resolveWorkspaceProfile: vi.fn(() => ({ profileId: "profile-1" })),
        hotSwapProfile: vi.fn(() => ({ ok: false })),
        setOwnedSourceIds: vi.fn(() => ({ ok: false })),
        shareWorkspace: vi.fn(() => ({ ok: false })),
        unshareWorkspace: vi.fn(() => ({ ok: false })),
        connectLocalDirectory: vi.fn(() => ({ ok: true })),
        listLocalDirectoryItems: vi.fn(() => ({ ok: true, items: [] })),
        listWorkspaceFiles: vi.fn(() => ({ ok: true, files: [] })),
        workspaceFileMetadata: vi.fn(() => ({ ok: false })),
        downloadWorkspaceFile: vi.fn(() => ({ ok: false })),
        uploadWorkspaceFile: vi.fn(() => ({ ok: false })),
        writeWorkspaceFile: vi.fn(() => ({ ok: false })),
        patchWorkspaceFile: vi.fn(() => ({ ok: false })),
        deleteWorkspaceFile: vi.fn(() => ({ ok: false }))
      };
      const workspaceContext = {
        userDataPath,
        agentWorkspace: baseWorkspace
      };
      const contextRuntime = {};
      const knowledgeGoldenRuntime = {
        listRulePackages: vi.fn(async () => ({ ok: true, items: [] })),
        getRulePackage: vi.fn(async () => null),
        saveRulePackage: vi.fn(async () => ({ ok: true })),
        publishRulePackage: vi.fn(async () => null),
        rollbackRulePackage: vi.fn(async () => null),
        listGoldCases: vi.fn(async () => ({ ok: true, items: [] })),
        saveGoldCase: vi.fn(async () => ({ ok: true })),
        exportTrainingSet: vi.fn(async () => ({ ok: true }))
      };
      const knowledgeCore = {
        getDocumentStructure: vi.fn(() => null),
        getItem: vi.fn(async () => null),
        getEvidence: vi.fn(async () => null),
        getAssetContent: vi.fn(async () => null),
        renderMarkdown: vi.fn(async () => null)
      };
      const knowledgeContext = {
        userDataPath,
        runtime: { mounts: { knowledgeBase: knowledgeCore } },
        metadataStore: {
          getKnowledgeItem: vi.fn(() => null)
        }
      };

      await expect(runOperation("workspace.info", { context: { userDataPath, agentWorkspace: {} } }))
        .resolves.toMatchObject({ status: 503, payload: { error: "智能体工作空间不可用。" } });
      await expect(runOperation("agent_workspaces.get", { input: { workspaceId: "ws-1" }, context: workspaceContext }))
        .resolves.toMatchObject({ status: 404, payload: { error: "智能体工作空间不存在。" } });
      await expect(runOperation("agent_workspaces.create", { input: [], context: workspaceContext }))
        .resolves.toMatchObject({ status: 400, payload: { error: "请求体必须是 JSON 对象。" } });
      await expect(runOperation("agent_workspaces.create", { input: {}, context: workspaceContext }))
        .resolves.toMatchObject({ status: 400, payload: { error: "title 不能为空" } });
      await expect(runOperation("agent_workspaces.create", {
        input: { title: "Workspace", parentWorkspaceId: "parent-1" },
        context: workspaceContext
      })).resolves.toMatchObject({ status: 400, payload: { error: "bad parent" } });
      await expect(runOperation("agent_workspaces.delete", { input: { workspaceId: "ws-1" }, context: workspaceContext }))
        .resolves.toMatchObject({ status: 404 });
      await expect(runOperation("agent_sessions.get", { input: { sessionId: "session-1" }, context: workspaceContext }))
        .resolves.toMatchObject({ status: 404, payload: { error: "会话线程不存在。" } });
      await expect(runOperation("agent_sessions.context.get", { input: { sessionId: "session-1" }, context: workspaceContext }))
        .resolves.toMatchObject({ status: 404, payload: { error: "会话线程不存在。" } });
      await expect(runOperation("agent_sessions.events.append", { input: { sessionId: "session-1" }, context: workspaceContext }))
        .resolves.toMatchObject({ status: 404, payload: { error: "会话线程不存在。" } });
      await expect(runOperation("agent_sessions.fork", { input: { sessionId: "session-1" }, context: workspaceContext }))
        .resolves.toMatchObject({ status: 404, payload: { error: "会话不存在" } });
      await expect(runOperation("agent_sessions.compare", { input: { sessionId: "session-1" }, context: workspaceContext }))
        .resolves.toMatchObject({ status: 404, payload: { error: "会话不存在" } });
      await expect(runOperation("agent_sessions.merge_proposal", { input: { sessionId: "session-1" }, context: workspaceContext }))
        .resolves.toMatchObject({ status: 404, payload: { error: "会话不存在" } });
      await expect(runOperation("agent_sessions.archive", { input: { sessionId: "session-1" }, context: workspaceContext }))
        .resolves.toMatchObject({ status: 404, payload: { error: "会话不存在" } });
      await expect(runOperation("agent_workspaces.submissions.resolve", { input: { submissionId: "sub-1" }, context: workspaceContext }))
        .resolves.toMatchObject({ status: 404, payload: { error: "共享提交不存在。" } });
      await expect(runOperation("agent_workspaces.issues.resolve", { input: { issueId: "issue-1" }, context: workspaceContext }))
        .resolves.toMatchObject({ status: 404, payload: { error: "共享空间 issue 不存在。" } });
      await expect(runOperation("agent_workspaces.locks.list", { input: { workspaceId: "ws-1" }, context: { userDataPath, agentWorkspace: {} } }))
        .resolves.toMatchObject({ status: 503, payload: { error: "智能体工作空间不可用。" } });
      await expect(runOperation("agent_workspaces.locks.write", { input: { workspaceId: "ws-1", action: "acquire" }, context: workspaceContext }))
        .resolves.toMatchObject({ status: 409, payload: { error: "lock_held" } });
      await expect(runOperation("workspace.proposal.create", { input: [], context: workspaceContext }))
        .resolves.toMatchObject({ status: 400, payload: { error: "请求体必须是 JSON 对象。" } });
      await expect(runOperation("workspace.proposal.create", { input: {}, context: workspaceContext }))
        .resolves.toMatchObject({ status: 400, payload: { error: "title 不能为空。" } });
      await expect(runOperation("workspace.proposal.create", {
        input: { title: "Proposal" },
        context: workspaceContext
      })).resolves.toMatchObject({ status: 201, payload: { created: true } });
      await expect(runOperation("workspace.proposal.apply", { input: {}, context: workspaceContext }))
        .resolves.toMatchObject({ status: 400, payload: { error: "proposalId 不能为空。" } });
      await expect(runOperation("workspace.proposal.apply", { input: { workspaceId: "ws-1" }, context: workspaceContext }))
        .resolves.toMatchObject({ status: 400, payload: { error: "proposalId 不能为空。" } });
      await expect(runOperation("workspace.proposal.apply", { input: { proposalId: "missing" }, context: workspaceContext }))
        .resolves.toMatchObject({ status: 404, payload: { error: "workspace 提案不存在。" } });
      await expect(runOperation("agent_workspaces.context.get", { input: { workspaceId: "ws-1" }, context: workspaceContext }))
        .resolves.toMatchObject({ status: 404, payload: { error: "工作空间不存在。" } });
      await expect(runOperation("agent_workspaces.context_bundle.export", { input: { workspaceId: "ws-1" }, context: workspaceContext }))
        .resolves.toMatchObject({ status: 404, payload: { error: "工作空间不存在。" } });
      await expect(runOperation("agent_workspaces.chain.get", { input: { workspaceId: "ws-1" }, context: workspaceContext }))
        .resolves.toMatchObject({ status: 404, payload: { error: "工作空间不存在。" } });
      await expect(runOperation("agent_workspaces.parent.set", { input: { workspaceId: "ws-1", parentWorkspaceId: "parent-1" }, context: workspaceContext }))
        .resolves.toMatchObject({ status: 400, payload: { ok: false, error: "bad parent" } });
      await expect(runOperation("agent_workspaces.profile.hotswap", { input: { workspaceId: "ws-1" }, context: workspaceContext }))
        .resolves.toMatchObject({ status: 400, payload: { ok: false } });
      await expect(runOperation("agent_workspaces.sources.set", { input: { workspaceId: "ws-1", sourceIds: ["source-a"] }, context: workspaceContext }))
        .resolves.toMatchObject({ status: 400, payload: { ok: false } });
      await expect(runOperation("agent_workspaces.share", { input: { workspaceId: "ws-1" }, context: workspaceContext }))
        .resolves.toMatchObject({ status: 400, payload: { error: "缺少 targetWorkspaceId" } });

      await expect(runOperation("context.profiles.get", { context: { userDataPath, contextRuntime: {} } }))
        .resolves.toMatchObject({ status: 503, payload: { error: "上下文运行时不可用。" } });
      await expect(runOperation("context.preview", { input: { workspaceId: "ws-1" }, context: { userDataPath, contextRuntime: {} } }))
        .resolves.toMatchObject({ status: 503, payload: { error: "上下文预览运行时不可用。" } });
      await expect(runOperation("context.compaction.preview", { context: { userDataPath, contextRuntime } }))
        .resolves.toMatchObject({ status: 503, payload: { error: "上下文压缩预览运行时不可用。" } });
      await expect(runOperation("context.compaction.run", { context: { userDataPath, contextRuntime } }))
        .resolves.toMatchObject({ status: 503, payload: { error: "上下文压缩运行时不可用。" } });
      await expect(runOperation("context.compaction.records", { context: { userDataPath, contextRuntime } }))
        .resolves.toMatchObject({ status: 503, payload: { error: "上下文压缩记录不可用。" } });
      await expect(runOperation("context.session_memory.get", { context: { userDataPath, contextRuntime } }))
        .resolves.toMatchObject({ status: 503, payload: { error: "上下文会话记忆不可用。" } });
      await expect(runOperation("context.session_memory.clear", { context: { userDataPath, contextRuntime } }))
        .resolves.toMatchObject({ status: 503, payload: { error: "上下文会话记忆不可用。" } });
      await expect(runOperation("context.build_records", { context: { userDataPath, contextRuntime } }))
        .resolves.toMatchObject({ status: 503, payload: { error: "上下文编译记录不可用。" } });
      await expect(runOperation("context.evaluation.runs.create", { context: { userDataPath, contextRuntime } }))
        .resolves.toMatchObject({ status: 503, payload: { error: "上下文 replay 评估不可用。" } });

      await expect(runOperation("knowledge.rule_authoring.chat", { context: { userDataPath } }))
        .resolves.toMatchObject({ status: 503, payload: { error: "规则生成智能体运行时不可用。" } });
      await expect(runOperation("knowledge.rule_authoring.runs.get", {
        input: { runId: "rule-run-1" },
        context: { userDataPath, knowledgeRuleAuthoringRuntime: { getRun: vi.fn(() => null) } }
      })).resolves.toMatchObject({ status: 404, payload: { error: "规则生成运行不存在。" } });
      await expect(runOperation("knowledge.gold_cases.list", { context: { userDataPath } }))
        .resolves.toMatchObject({ status: 503, payload: { error: "黄金样本运行时不可用。" } });
      await expect(runOperation("knowledge.training_sets.export", { context: { userDataPath } }))
        .resolves.toMatchObject({ status: 503, payload: { error: "训练集导出运行时不可用。" } });
      await expect(runOperation("knowledge.golden_rules.publish", {
        input: { packageId: "rule-1" },
        context: { userDataPath, goldenRuleRuntime: { publishRulePackage: vi.fn(async () => null) } }
      })).resolves.toMatchObject({ status: 404, payload: { error: "黄金规则包不存在。" } });
      await expect(runOperation("knowledge.golden_rules.rollback", {
        input: { packageId: "rule-1" },
        context: { userDataPath, goldenRuleRuntime: { rollbackRulePackage: vi.fn(async () => null) } }
      })).resolves.toMatchObject({ status: 404, payload: { error: "黄金规则包不存在。" } });
      await expect(runOperation("knowledge.skills.deployments.rollback", {
        input: { deploymentId: "dep-1" },
        context: { userDataPath, knowledgeSkillRuntime: { rollbackSkillDeployment: vi.fn(async () => null) } }
      })).resolves.toMatchObject({ status: 404, payload: { error: "SkillSet 部署不存在。" } });
      await expect(runOperation("knowledge.evidence_gate.evaluate", { context: { userDataPath, knowledgeAgentSkill: {}, evidenceSufficiencyGate: null } }))
        .resolves.toMatchObject({ status: 503, payload: { error: "证据充分性门禁不可用。" } });
      await expect(runOperation("knowledge.evaluation.runs.get", {
        input: { runId: "eval-1" },
        context: { userDataPath, agentEvaluationRuntime: { getRun: vi.fn(async () => null) } }
      })).resolves.toMatchObject({ status: 404, payload: { error: "智能体评估任务不存在。" } });
      await expect(runOperation("knowledge.evolution.runs.get", {
        input: { runId: "evo-1" },
        context: { userDataPath, knowledgeEvolutionRuntime: { getRun: vi.fn(async () => null) } }
      })).resolves.toMatchObject({ status: 404, payload: { error: "知识进化任务不存在。" } });
      await expect(runOperation("knowledge.summarization.runs.get", {
        input: { runId: "sum-1" },
        context: { userDataPath, summarizationRuntime: { getRun: vi.fn(() => null) } }
      })).resolves.toMatchObject({ status: 404, payload: { error: "总结任务不存在。" } });
      await expect(runOperation("knowledge.agent_explore.runs.get", {
        input: { runId: "explore-1" },
        context: { userDataPath, agentExplorationRuntime: { getRun: vi.fn(() => null) } }
      })).resolves.toMatchObject({ status: 404, payload: { error: "智能探索任务不存在。" } });
      await expect(runOperation("knowledge.document_structure", { input: { documentId: "doc-1" }, context: knowledgeContext }))
        .resolves.toMatchObject({ status: 404, payload: { error: "知识文档不存在。" } });
      await expect(runOperation("knowledge.item", { input: { itemId: "item-1" }, context: knowledgeContext }))
        .resolves.toMatchObject({ status: 404, payload: { error: "知识对象不存在。" } });
      await expect(runOperation("knowledge.evidence", { input: { evidenceId: "missing-evidence" }, context: knowledgeContext }))
        .resolves.toMatchObject({ status: 404, payload: { error: "知识证据不存在。" } });
      await expect(runOperation("knowledge.asset", { input: { assetId: "asset-1" }, context: knowledgeContext }))
        .resolves.toMatchObject({ status: 404, payload: { error: "知识库资产不存在。" } });
      await expect(runOperation("knowledge.render_markdown", { input: { evidenceId: "e-1" }, context: knowledgeContext }))
        .resolves.toMatchObject({ status: 404, payload: { error: "知识证据不存在，无法渲染 Markdown。" } });
    });
  });
});
