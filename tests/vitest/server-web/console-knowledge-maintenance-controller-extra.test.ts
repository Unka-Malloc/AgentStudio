// @vitest-environment jsdom
import { ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { jsonPreview } from "../../../server-web/composables/console-format-utils";
import { createConsoleKnowledgeMaintenanceController } from "../../../server-web/composables/console-knowledge-maintenance-controller";
import type {
  KnowledgeConfigSchema,
  KnowledgeConsoleState,
  KnowledgeSourceState,
  MaintenanceSettings,
  ServerConsoleState,
} from "../../../server-web/lib/types";
import type {
  DebugTab,
  KnowledgeManagementPanel,
} from "../../../server-web/types/app";

const maintenanceClientMock = vi.hoisted(() => ({
  getKnowledgeConfigSchema: vi.fn(),
  getKnowledgeConsole: vi.fn(),
  getKnowledgeMaintenance: vi.fn(),
  saveKnowledgeMaintenance: vi.fn(),
}));

const knowledgeSourcesClientMock = vi.hoisted(() => ({
  getKnowledgeSources: vi.fn(),
}));

vi.mock("../../../server-web/lib/knowledge-maintenance-client", () => ({
  getKnowledgeConfigSchema: maintenanceClientMock.getKnowledgeConfigSchema,
  getKnowledgeConsole: maintenanceClientMock.getKnowledgeConsole,
  getKnowledgeMaintenance: maintenanceClientMock.getKnowledgeMaintenance,
  saveKnowledgeMaintenance: maintenanceClientMock.saveKnowledgeMaintenance,
}));

vi.mock("../../../server-web/lib/knowledge-sources-client", () => ({
  getKnowledgeSources: knowledgeSourcesClientMock.getKnowledgeSources,
}));

function makeConsoleState(overrides: Partial<ServerConsoleState> = {}) {
  return {
    server: { runtimeId: "runtime-1" },
    runtime: { pid: "1234" },
    settings: { path: "/settings", value: {} },
    discovery: { path: "/discovery", value: { items: [] }, bootstrap: { enabled: true } },
    emailRules: { path: "/email-rules", rules: {} },
    expertVocabulary: { path: "/vocabulary", vocabulary: {} },
    knowledgeTaxonomy: { schemaVersion: "v0.0.1:schema:definition-1", topics: [] },
    storage: { summary: {} },
    jobs: {
      summary: {
        totalCount: 0,
        queuedCount: 0,
        runningCount: 0,
        completedCount: 0,
        failedCount: 0,
      },
      items: [],
    },
    clients: {},
    knowledgeConsole: null,
    ...overrides,
  } as ServerConsoleState;
}

function makeKnowledgeConsole(overrides: Partial<KnowledgeConsoleState> = {}) {
  return {
    available: true,
    health: null,
    capabilities: null,
    maintenance: null,
    recentJobs: [],
    ...overrides,
  } as KnowledgeConsoleState;
}

function makeSourcesState(overrides: Partial<KnowledgeSourceState> = {}) {
  return {
    schemaVersion: "v0.0.1:schema:definition-1",
    updatedAt: "2026-06-04T00:00:00.000Z",
    summary: {
      totalCount: 0,
      enabledCount: 0,
      watchingCount: 0,
      syncingCount: 0,
      errorCount: 0,
    },
    sources: [],
    ...overrides,
  } as KnowledgeSourceState;
}

function makeSchema(): KnowledgeConfigSchema {
  return {
    schemaVersion: "v0.0.1:schema:definition-1",
    groups: [
      {
        id: "retrieval",
        label: "检索",
        fields: [
          { name: "retrieval.topK", type: "number", label: "Top K" },
          { name: "retrieval.enabled", type: "boolean", label: "启用" },
        ],
      },
    ],
    maintenanceTasks: [
      { id: "refresh", label: "刷新", danger: "low", requiresConfirm: false },
      { id: "reindex", label: "重建索引", danger: "high", requiresConfirm: true },
    ],
  };
}

function createFixture(overrides: {
  consoleState?: ServerConsoleState;
  debugTab?: DebugTab;
  hasScope?: (scope: string) => boolean;
  knowledgeManagementPanel?: KnowledgeManagementPanel;
  refreshKnowledgeConflicts?: (options?: { silent?: boolean; suppressError?: boolean }) => Promise<unknown>;
  refreshKnowledgeRecallBackendSpaces?: () => Promise<unknown>;
} = {}) {
  const error = ref("seed error");
  const busyKeys: string[] = [];
  const clearAllBusy = vi.fn(() => {
    busyKeys.length = 0;
  });
  const setBusy = vi.fn((key: string) => {
    busyKeys.push(key);
  });
  const consoleState = ref(
    overrides.consoleState || makeConsoleState(),
  );
  const debugTab = ref<DebugTab>(overrides.debugTab || "agentRetrieval");
  const knowledgeManagementPanel = ref<KnowledgeManagementPanel>(
    overrides.knowledgeManagementPanel || "expert",
  );
  const refreshKnowledgeConflicts = overrides.refreshKnowledgeConflicts || vi.fn().mockResolvedValue(undefined);
  const refreshKnowledgeRecallBackendSpaces =
    overrides.refreshKnowledgeRecallBackendSpaces || vi.fn().mockResolvedValue(undefined);

  const controller = createConsoleKnowledgeMaintenanceController({
    clearAllBusy,
    consoleState,
    debugTab,
    error,
    hasScope: overrides.hasScope || ((scope: string) => scope === "knowledge:read"),
    knowledgeManagementPanel,
    refreshKnowledgeConflicts,
    refreshKnowledgeRecallBackendSpaces,
    setBusy,
  });

  return {
    busyKeys,
    clearAllBusy,
    controller,
    debugTab,
    error,
    knowledgeManagementPanel,
    consoleState,
    refreshKnowledgeConflicts,
    refreshKnowledgeRecallBackendSpaces,
    setBusy,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  maintenanceClientMock.getKnowledgeConfigSchema.mockReset();
  maintenanceClientMock.getKnowledgeConsole.mockReset();
  maintenanceClientMock.getKnowledgeMaintenance.mockReset();
  maintenanceClientMock.saveKnowledgeMaintenance.mockReset();
  knowledgeSourcesClientMock.getKnowledgeSources.mockReset();
});

describe("console knowledge maintenance controller", () => {
  it("derives state, descriptions, field helpers, and panel selection", () => {
    const { controller, consoleState, knowledgeManagementPanel } = createFixture({
      consoleState: makeConsoleState({
        knowledgeConsole: makeKnowledgeConsole({
          health: {
            ok: false,
            status: "",
            modules: { healthOnly: { source: "health" } },
            protocolModules: { shared: { source: "health-protocol" } },
          },
          capabilities: {
            modules: {
              shared: { source: "capability" },
              capabilityOnly: { source: "capability" },
            },
            protocolModules: {
              capabilityProtocol: { source: "capability-protocol" },
            },
          },
          recentJobs: [{ id: "job-1" } as never],
        }),
      }),
    });

    expect(controller.knowledgeManagementPanelOptionBarOptions.value).toEqual([
      { value: "knowledge", label: "知识" },
      { value: "rules", label: "规则" },
    ]);
    expect(controller.knowledgeStatus.value).toBe("degraded");
    expect(controller.knowledgeModules.value).toMatchObject({
      healthOnly: { source: "health" },
      shared: { source: "health-protocol" },
      capabilityOnly: { source: "capability" },
      capabilityProtocol: { source: "capability-protocol" },
    });
    controller.knowledgeConsole.value = makeKnowledgeConsole({
      recentJobs: [{ id: "job-1" } as never],
    });
    expect(controller.knowledgeRecentJobs.value).toHaveLength(1);

    controller.knowledgeConsole.value = makeKnowledgeConsole({
      health: { ok: true, status: "healthy" },
      capabilities: {
        modules: { runtimeOnly: { source: "runtime" } },
        protocolModules: { runtimeProtocol: { source: "runtime-protocol" } },
      },
    });
    expect(controller.knowledgeStatus.value).toBe("healthy");
    expect(controller.knowledgeModules.value).toMatchObject({
      runtimeOnly: { source: "runtime" },
      runtimeProtocol: { source: "runtime-protocol" },
    });

    controller.knowledgeConsole.value = null;
    consoleState.value = makeConsoleState({
      knowledgeConsole: makeKnowledgeConsole({
        health: { ok: true, status: "" },
        capabilities: null,
      }),
    });
    expect(controller.knowledgeStatus.value).toBe("ok");

    expect(controller.knowledgeConfigGroupDescription("retrieval")).toBe("");
    expect(controller.knowledgeConfigGroupDescription("learning")).toContain("反馈学习闭环");
    expect(controller.knowledgeConfigGroupDescription("maintenance")).toBe("");
    expect(controller.knowledgeConfigGroupDescription("embeddingModel")).toBe("");
    expect(controller.knowledgeConfigGroupDescription("unknown")).toBe("服务端暴露的知识库配置组。");
    expect(controller.knowledgeTabDisplayLabel({ id: "maintenance", label: "维护" } as never)).toBe("维护");

    expect(controller.maintenanceFieldValue("retrieval.topK", 12)).toBe(12);
    controller.setMaintenanceFieldValue("retrieval.topK", 24);
    controller.setMaintenanceFieldFromEvent("retrieval.enabled", {
      target: { value: "true" },
    } as Event, "boolean");
    controller.setMaintenanceFieldFromEvent("retrieval.label", {
      target: { value: "检索配置" },
    } as Event, "string");
    controller.setMaintenanceFieldFromEvent("retrieval.weight", {
      target: { value: "3" },
    } as Event, "number");

    expect(controller.maintenanceFieldValue("retrieval.topK", 0)).toBe(24);
    expect(controller.maintenanceFieldValue("retrieval.enabled", false)).toBe(true);
    expect(controller.maintenanceFieldValue("retrieval.label", "")).toBe("检索配置");
    expect(controller.maintenanceFieldValue("retrieval.weight", 0)).toBe(3);
    expect(controller.maintenanceJson.value).toBe(jsonPreview(controller.knowledgeMaintenanceDraft.value));

    controller.selectKnowledgeManagementPanel("knowledge");
    expect(knowledgeManagementPanel.value).toBe("knowledge");
    controller.selectKnowledgeManagementPanel("expert");
    expect(knowledgeManagementPanel.value).toBe("knowledge");

    expect(controller.readNestedValue({ a: { b: 1 } }, "a.b")).toBe(1);
    expect(controller.readNestedValue({ a: [1, 2] }, "a.b")).toBeUndefined();
    expect(controller.writeNestedValue({ a: { b: 1 } }, "a.c", 2)).toEqual({ a: { b: 1, c: 2 } });
    expect(controller.writeNestedValue({ a: [1, 2] }, "a.c", 2)).toEqual({ a: { c: 2 } });
  });

  it("refreshes knowledge console, falls back to optional data, and triggers follow-up refreshes", async () => {
    const state = makeKnowledgeConsole({
      health: { ok: true, status: "healthy" },
      capabilities: {
        modules: { capabilityOnly: { source: "capability" } },
        protocolModules: { capabilityProtocol: { source: "capability-protocol" } },
      },
      recentJobs: [{ id: "job-refresh" } as never],
      sources: makeSourcesState({ sources: [{ sourceId: "source-a" } as never] }),
    });

    maintenanceClientMock.getKnowledgeConsole.mockResolvedValueOnce(state);
    maintenanceClientMock.getKnowledgeConfigSchema.mockResolvedValueOnce(makeSchema());
    maintenanceClientMock.getKnowledgeMaintenance.mockRejectedValueOnce(new Error("maintenance missing"));
    knowledgeSourcesClientMock.getKnowledgeSources.mockResolvedValueOnce(null);

    const { controller, refreshKnowledgeConflicts, refreshKnowledgeRecallBackendSpaces, debugTab } = createFixture({
      debugTab: "knowledgeRecall",
    });

    await controller.refreshKnowledgeConsole();

    expect(maintenanceClientMock.getKnowledgeConsole).toHaveBeenCalledTimes(1);
    expect(maintenanceClientMock.getKnowledgeConfigSchema).toHaveBeenCalledTimes(1);
    expect(maintenanceClientMock.getKnowledgeMaintenance).toHaveBeenCalledTimes(1);
    expect(knowledgeSourcesClientMock.getKnowledgeSources).toHaveBeenCalledTimes(1);
    expect(controller.knowledgeConsole.value).toEqual(state);
    expect(controller.knowledgeSchema.value).toEqual(makeSchema());
    expect(controller.knowledgeSourceState.value).toEqual(state.sources);
    expect(controller.knowledgeMaintenanceDraft.value).toEqual({});
    expect(controller.maintenanceJson.value).toBe("{}");
    expect(refreshKnowledgeRecallBackendSpaces).toHaveBeenCalledTimes(1);
    expect(refreshKnowledgeConflicts).toHaveBeenCalledWith({ silent: true, suppressError: true });

    debugTab.value = "agentRetrieval";
    maintenanceClientMock.getKnowledgeMaintenance.mockResolvedValueOnce({ maintenance: true });
    maintenanceClientMock.getKnowledgeConsole.mockResolvedValueOnce({
      ...state,
      sources: undefined,
    });
    knowledgeSourcesClientMock.getKnowledgeSources.mockResolvedValueOnce({
      schemaVersion: 2,
      updatedAt: "2026-06-04T01:00:00.000Z",
      summary: {
        totalCount: 1,
        enabledCount: 1,
        watchingCount: 1,
        syncingCount: 0,
        errorCount: 0,
      },
      sources: [{ sourceId: "source-b" } as never],
    });

    await controller.refreshKnowledgeConsole({ skipReviewItems: true });

    expect(refreshKnowledgeConflicts).toHaveBeenCalledTimes(1);
    expect(controller.knowledgeSourceState.value).toMatchObject({ schemaVersion: 2 });
  });

  it("surfaces refresh failures and does nothing without read scope", async () => {
    const denied = createFixture({
      hasScope: () => false,
    });

    await denied.controller.refreshKnowledgeConsole();

    expect(maintenanceClientMock.getKnowledgeConsole).not.toHaveBeenCalled();
    expect(maintenanceClientMock.getKnowledgeConfigSchema).not.toHaveBeenCalled();
    expect(denied.controller.knowledgeConsole.value).toBeNull();

    maintenanceClientMock.getKnowledgeConsole.mockRejectedValueOnce("load failed");
    maintenanceClientMock.getKnowledgeConfigSchema.mockResolvedValueOnce(makeSchema());
    maintenanceClientMock.getKnowledgeMaintenance.mockResolvedValueOnce({});
    knowledgeSourcesClientMock.getKnowledgeSources.mockResolvedValueOnce(null);

    const allowed = createFixture();
    await allowed.controller.refreshKnowledgeConsole();

    expect(allowed.error.value).toBe("加载知识库管控数据失败。");
    expect(allowed.controller.knowledgeConsole.value).toBeNull();
    expect(allowed.refreshKnowledgeConflicts).not.toHaveBeenCalled();
  });

  it("saves maintenance settings, refreshes afterward, and clears busy state on success or failure", async () => {
    const { controller, busyKeys, clearAllBusy, error, setBusy } = createFixture();
    controller.maintenanceJson.value = JSON.stringify({
      retrieval: { topK: 32, enabled: true },
      maintenance: { dryRun: false },
    });

    maintenanceClientMock.saveKnowledgeMaintenance.mockResolvedValueOnce({
      retrieval: { topK: 32, enabled: true },
      maintenance: { dryRun: false },
    });
    maintenanceClientMock.getKnowledgeConsole.mockResolvedValueOnce(makeKnowledgeConsole());
    maintenanceClientMock.getKnowledgeConfigSchema.mockResolvedValueOnce(makeSchema());
    maintenanceClientMock.getKnowledgeMaintenance.mockResolvedValueOnce({ saved: true });
    knowledgeSourcesClientMock.getKnowledgeSources.mockResolvedValueOnce(null);

    await controller.saveKnowledgeMaintenance();

    expect(setBusy).toHaveBeenCalledWith("knowledge:maintenance");
    expect(maintenanceClientMock.saveKnowledgeMaintenance).toHaveBeenCalledWith({
      retrieval: { topK: 32, enabled: true },
      maintenance: { dryRun: false },
    });
    expect(maintenanceClientMock.getKnowledgeConsole).toHaveBeenCalledTimes(1);
    expect(clearAllBusy).toHaveBeenCalledTimes(1);
    expect(busyKeys).toEqual([]);
    expect(error.value).toBe("");
    expect(controller.knowledgeMaintenanceDraft.value).toEqual({ saved: true });

    error.value = "seed error";
    controller.maintenanceJson.value = "{";
    await controller.saveKnowledgeMaintenance();
    expect(error.value).toMatch(/Unexpected end of JSON input|JSON/);
    expect(clearAllBusy).toHaveBeenCalledTimes(2);
    expect(maintenanceClientMock.saveKnowledgeMaintenance).toHaveBeenCalledTimes(1);

    error.value = "";
    controller.maintenanceJson.value = JSON.stringify({ taskType: "reindex" });
    maintenanceClientMock.saveKnowledgeMaintenance.mockRejectedValueOnce("save failed");

    await controller.saveKnowledgeMaintenance();

    expect(error.value).toBe("保存知识库维护参数失败。");
    expect(clearAllBusy).toHaveBeenCalledTimes(3);
  });
});
