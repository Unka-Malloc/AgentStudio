import { describe, expect, it, vi } from "vitest";

const checkpointMocks = vi.hoisted(() => ({
  checkpointTreeId: vi.fn(() => "tree-id"),
  checkpointTreeSummary: vi.fn(() => ({ treeId: "tree-id" })),
  deleteCheckpointTree: vi.fn((input) => ({ op: "delete", input })),
  diffCheckpointTree: vi.fn((input) => ({ op: "diff", input })),
  finishCheckpointTree: vi.fn((input) => ({ op: "finish", input })),
  listCheckpointTrees: vi.fn((input) => ({ op: "list", input })),
  loadCheckpointTree: vi.fn((input) => ({ op: "load", input })),
  previewCheckpointRestore: vi.fn((input) => ({ op: "preview", input })),
  queryCheckpointScope: vi.fn((input) => ({ op: "query", input })),
  restoreCheckpointTree: vi.fn((input) => ({ op: "restore", input })),
  startCheckpointTree: vi.fn((input) => ({ op: "start", input })),
  upsertCheckpointNode: vi.fn((input) => ({ op: "upsert", input })),
}));

const textMocks = vi.hoisted(() => ({
  clamp: vi.fn((value, min, max) => Math.max(min, Math.min(max, value))),
  clampLimit: vi.fn((value) => Number(value || 0)),
  escapeRegExp: vi.fn((value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  normalizeWhitespace: vi.fn((value) => String(value).trim().replace(/\s+/g, " ")),
  truncateText: vi.fn((value, length) => String(value).slice(0, length)),
  uniqueNormalizedStrings: vi.fn((values) => Array.from(new Set(values.map(String)))),
}));

const merkleMock = vi.hoisted(() => vi.fn(({ userDataPath }) => ({ userDataPath, kind: "merkle" })));

const devopsMocks = vi.hoisted(() => ({
  acknowledgeMonitorAlert: vi.fn((userDataPath, alertId, input) => ({ userDataPath, alertId, input })),
  getMonitorAlertState: vi.fn((userDataPath, input) => ({ userDataPath, input, alerts: [] })),
  runMonitorAlertCycle: vi.fn((userDataPath, input) => ({ userDataPath, input, cycled: true })),
  saveMonitorAlertConfig: vi.fn((userDataPath, config) => ({ userDataPath, config, saved: true })),
  getBackgroundProcessStatus: vi.fn((userDataPath) => ({ userDataPath, processes: [] })),
  recoverBackgroundSupervisor: vi.fn((input) => ({ input, recovered: true })),
  composeUnifiedSystemStatus: vi.fn((input) => ({ input, status: "ok" })),
  normalizeUnifiedRegistration: vi.fn((input) => ({ normalized: input })),
}));

const productMocks = vi.hoisted(() => ({
  callAgentGateway: vi.fn((...args) => ({ args, gateway: true })),
  publicAgentGatewayConfig: vi.fn((...args) => ({ args, public: true })),
  createCommonServerRuntime: vi.fn((input) => ({ input, metadataStore: { id: "metadata" } })),
  createKnowledgeMetadataStoreDomainServices: vi.fn(() => ({ metadata: true })),
  createKnowledgeBuiltinMountProviders: vi.fn((input) => ({ mounts: input.userDataPath })),
}));

vi.mock("../../../server/platform/common/data-structure/checkpoint-tree-store.mjs", () => checkpointMocks);
vi.mock("../../../server/platform/common/data-structure/text-normalization.mjs", () => textMocks);
vi.mock("../../../server/platform/common/data-structure/merkle-state-substrate.mjs", () => ({
  createMerkleStateSubstrate: merkleMock,
}));
vi.mock("../../../server/platform/common/devops/monitor-alert-core/monitor-alerts.mjs", () => ({
  acknowledgeMonitorAlert: devopsMocks.acknowledgeMonitorAlert,
  getMonitorAlertState: devopsMocks.getMonitorAlertState,
  runMonitorAlertCycle: devopsMocks.runMonitorAlertCycle,
  saveMonitorAlertConfig: devopsMocks.saveMonitorAlertConfig,
}));
vi.mock("../../../server/platform/common/devops/process-status/background-process-status.mjs", () => ({
  getBackgroundProcessStatus: devopsMocks.getBackgroundProcessStatus,
}));
vi.mock("../../../server/platform/common/devops/supervisor-recovery/supervisor-recovery.mjs", () => ({
  recoverBackgroundSupervisor: devopsMocks.recoverBackgroundSupervisor,
}));
vi.mock("../../../server/platform/common/devops/unified-registration-core/unified-registration.mjs", () => ({
  composeUnifiedSystemStatus: devopsMocks.composeUnifiedSystemStatus,
  normalizeUnifiedRegistration: devopsMocks.normalizeUnifiedRegistration,
}));
vi.mock("../../../server/platform/specialized/agent/agent-gateway/index.mjs", () => ({
  callAgentGateway: productMocks.callAgentGateway,
  publicAgentGatewayConfig: productMocks.publicAgentGatewayConfig,
}));
vi.mock("../../../server/platform/common/module-manager/server-runtime.mjs", () => ({
  createServerRuntime: productMocks.createCommonServerRuntime,
}));
vi.mock("../../../server/platform/specialized/knowledge/storage/metadata-store-domain-services.mjs", () => ({
  createKnowledgeMetadataStoreDomainServices: productMocks.createKnowledgeMetadataStoreDomainServices,
}));
vi.mock("../../../server/platform/specialized/knowledge/storage/builtin-mount-providers.mjs", () => ({
  createKnowledgeBuiltinMountProviders: productMocks.createKnowledgeBuiltinMountProviders,
}));

import {
  createDataStructureProvider,
  DATA_STRUCTURE_PROTOCOL_VERSION,
} from "../../../server/platform/common/data-structure/data-structure-provider.mjs";
import {
  createDevopsProvider,
  DEVOPS_PROTOCOL_VERSION,
} from "../../../server/platform/common/devops/devops-provider.mjs";
import {
  callAgentGateway,
  createServerRuntime,
  loadKnowledgeAnalysisRuntime,
  loadKnowledgeDocumentParsingRuntime,
  loadKnowledgeEmailRulesRuntime,
  loadKnowledgeFileProcessorRuntime,
  loadKnowledgeNormalizedDocumentsRuntime,
  loadKnowledgePipelineRuntime,
  loadKnowledgePreprocessResultRuntime,
  loadKnowledgeSourceServiceRuntime,
  publicAgentGatewayConfig,
} from "../../../server/platform/interactive/product-api.mjs";

describe("platform provider small gaps final extra coverage", () => {
  it("wraps data-structure checkpoint operations with the configured user data path", () => {
    const provider = createDataStructureProvider({ userDataPath: "/tmp/pact-data" });

    expect(provider.protocolVersion).toBe(DATA_STRUCTURE_PROTOCOL_VERSION);
    expect(provider.checkpointTree.startCheckpointTree({ workspaceId: "ws-1" })).toMatchObject({
      op: "start",
      input: { userDataPath: "/tmp/pact-data", workspaceId: "ws-1" },
    });
    expect(provider.checkpointTree.upsertCheckpointNode({ nodeId: "node-1" }).input.userDataPath).toBe("/tmp/pact-data");
    expect(provider.checkpointTree.finishCheckpointTree({ treeId: "tree-1" }).input.userDataPath).toBe("/tmp/pact-data");
    expect(provider.checkpointTree.listCheckpointTrees().input.userDataPath).toBe("/tmp/pact-data");
    expect(provider.checkpointTree.loadCheckpointTree({ treeId: "tree-1" }).input.userDataPath).toBe("/tmp/pact-data");
    expect(provider.checkpointTree.diffCheckpointTree({ left: "a" }).input.userDataPath).toBe("/tmp/pact-data");
    expect(provider.checkpointTree.queryCheckpointScope({ path: "README.md" }).input.userDataPath).toBe("/tmp/pact-data");
    expect(provider.checkpointTree.previewCheckpointRestore({ nodeId: "node-1" }).input.userDataPath).toBe("/tmp/pact-data");
    expect(provider.checkpointTree.restoreCheckpointTree({ nodeId: "node-1" }).input.userDataPath).toBe("/tmp/pact-data");
    expect(provider.checkpointTree.deleteCheckpointTree({ treeId: "tree-1" }).input.userDataPath).toBe("/tmp/pact-data");
    expect(provider.checkpointTree.checkpointTreeId()).toBe("tree-id");
    expect(provider.checkpointTree.checkpointTreeSummary()).toEqual({ treeId: "tree-id" });

    expect(provider.textNormalization.normalizeWhitespace(" a   b ")).toBe("a b");
    expect(provider.merkleState).toEqual({ userDataPath: "/tmp/pact-data", kind: "merkle" });
    expect(provider.listCapabilities().capabilities.map((item) => item.id)).toEqual([
      "checkpoint-tree",
      "merkle-state-substrate",
      "text-normalization",
    ]);
  });

  it("wraps devops operations with default and overridden user data paths", async () => {
    const provider = createDevopsProvider({ userDataPath: "/tmp/pact-devops" });

    expect(provider.protocolVersion).toBe(DEVOPS_PROTOCOL_VERSION);
    expect(provider.getBackgroundProcessStatus()).toMatchObject({ userDataPath: "/tmp/pact-devops" });
    expect(provider.getMonitorAlertState({ severity: "high" })).toMatchObject({
      userDataPath: "/tmp/pact-devops",
      input: { severity: "high" },
    });
    expect(provider.saveMonitorAlertConfig({ enabled: true })).toMatchObject({
      userDataPath: "/tmp/pact-devops",
      config: { enabled: true },
    });
    expect(provider.runMonitorAlertCycle({ userDataPath: "/override" })).toMatchObject({
      userDataPath: "/override",
      input: { userDataPath: "/override" },
    });
    expect(provider.acknowledgeMonitorAlert({ id: "alert-1" })).toMatchObject({
      userDataPath: "/tmp/pact-devops",
      alertId: "alert-1",
    });
    await expect(provider.recoverBackgroundSupervisor({
      backgroundStatus: { processes: ["known"] },
    })).resolves.toMatchObject({
      recovered: true,
      input: {
        userDataPath: "/tmp/pact-devops",
        backgroundStatus: { processes: ["known"] },
      },
    });

    const api = provider.createMonitorAlertApi({ queueMonitor: { id: "queue" } });
    expect(api.getState()).toMatchObject({ userDataPath: "/tmp/pact-devops" });
    expect(api.saveConfig({ enabled: false })).toMatchObject({ config: { enabled: false } });
    expect(api.acknowledge("alert-2")).toMatchObject({ alertId: "alert-2" });
    expect(provider.normalizeUnifiedRegistration({ id: "svc" })).toEqual({ normalized: { id: "svc" } });
    expect(provider.composeUnifiedSystemStatus({ ok: true })).toEqual({ input: { ok: true }, status: "ok" });
    expect(provider.listCapabilities().capabilities.map((item) => item.id)).toContain("monitor-alerts");
  });

  it("delegates product-api dynamic wrappers and runtime feature defaults", async () => {
    await expect(callAgentGateway("prompt", { stream: false })).resolves.toEqual({
      args: ["prompt", { stream: false }],
      gateway: true,
    });
    await expect(publicAgentGatewayConfig({ user: "owner" })).resolves.toEqual({
      args: [{ user: "owner" }],
      public: true,
    });

    await loadKnowledgeFileProcessorRuntime();
    await loadKnowledgeNormalizedDocumentsRuntime();
    await loadKnowledgePipelineRuntime();
    await loadKnowledgeDocumentParsingRuntime();
    await loadKnowledgePreprocessResultRuntime();
    await loadKnowledgeAnalysisRuntime();
    await loadKnowledgeEmailRulesRuntime();
    await loadKnowledgeSourceServiceRuntime();

    await createServerRuntime({
      userDataPath: "/tmp/runtime",
      runtimeOptions: { featureRuntime: { activeFeatureIds: ["knowledge-core"] } },
    });
    expect(productMocks.createKnowledgeMetadataStoreDomainServices).toHaveBeenCalled();
    expect(productMocks.createKnowledgeBuiltinMountProviders).toHaveBeenCalledWith({
      userDataPath: "/tmp/runtime",
    });
    expect(productMocks.createCommonServerRuntime).toHaveBeenLastCalledWith(expect.objectContaining({
      userDataPath: "/tmp/runtime",
      metadataStoreDomainServices: { metadata: true },
      builtinMountProviders: { mounts: "/tmp/runtime" },
    }));

    await createServerRuntime({
      userDataPath: "/tmp/no-knowledge",
      runtimeOptions: { featureRuntime: { activeFeatureIds: ["agent-gateway"] } },
    });
    expect(productMocks.createCommonServerRuntime).toHaveBeenLastCalledWith(expect.objectContaining({
      metadataStoreDomainServices: {},
      builtinMountProviders: {},
    }));
  });
});
