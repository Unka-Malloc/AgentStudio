import { beforeEach, describe, expect, it, vi } from "vitest";

const loadSettingsMock = vi.hoisted(() => vi.fn());
const getSettingsPathMock = vi.hoisted(() => vi.fn((userDataPath = "") => `${userDataPath}/settings.json`));
const buildClientConnectionListMock = vi.hoisted(() => vi.fn((registrations, additionalRows) => ({
  registrations,
  additionalRows,
  rows: [...(registrations.items || []), ...additionalRows]
})));

vi.mock("../../../server/platform/common/platform-core/settings.mjs", () => ({
  getSettingsPath: getSettingsPathMock,
  loadSettings: loadSettingsMock
}));

vi.mock("../../../server/platform/common/console/http/client-connection-list.mjs", () => ({
  buildClientConnectionList: buildClientConnectionListMock
}));

let projections;

beforeEach(async () => {
  vi.clearAllMocks();
  projections = await import("../../../server/platform/specialized/console/console-state-projections.mjs");
});

describe("console state projections", () => {
  it("builds agent settings projection with registry data and selector availability states", async () => {
    loadSettingsMock
      .mockResolvedValueOnce({
        deepSeekApiKeyConfigured: true,
        localModelEndpoint: "http://localhost:11434",
        modelLibraryAgents: []
      })
      .mockResolvedValueOnce({
        deepSeekApiKey: "secret"
      });
    const registryState = {
      rootPath: "/configs",
      modelListPath: "/configs/models.json",
      agentListPath: "/configs/agents.json",
      modelManifest: { count: 2 },
      agentManifest: { count: 5 }
    };
    const registry = {
      refresh: vi.fn(async () => registryState),
      getModelLibraryEntries: vi.fn(() => [{ uid: "model-entry" }]),
      getModelLibraryAgents: vi.fn((options = {}) => {
        if (options.redactSecrets) {
          return [
            {
              uid: "deepseek-agent",
              label: "DeepSeek Agent",
              provider: "deepseek",
              model: "deepseek-chat",
              permissionGroupId: "pg-1",
              moduleAccess: { mode: "selected", moduleIds: ["module-a", "", "module-b"] }
            },
            {
              uid: "custom-agent",
              alias: "Custom",
              provider: "custom-http",
              model: "unit-model",
              url: "https://agent.example.test",
              tokenConfigured: true
            },
            {
              uid: "local-agent",
              agentName: "Local Agent",
              provider: "local-model",
              engine: "llama3"
            },
            {
              uid: "unsupported-agent",
              alias: "Unsupported",
              provider: "other"
            },
            {
              uid: "deepseek-agent",
              alias: "Duplicate",
              provider: "deepseek",
              model: "duplicate"
            }
          ];
        }
        return [{ uid: "deepseek-agent" }, { uid: "" }, { uid: "custom-agent" }];
      })
    };

    const result = await projections.buildAgentSettingsConsoleProjection({
      userDataPath: "/unit",
      getAgentConfigRegistry: () => registry
    });

    expect(loadSettingsMock).toHaveBeenNthCalledWith(1, "/unit", { redactSecrets: true });
    expect(loadSettingsMock).toHaveBeenNthCalledWith(2, "/unit");
    expect(registry.refresh).toHaveBeenCalledWith({ settingsFallback: { deepSeekApiKey: "secret" } });
    expect(result.settings).toMatchObject({
      path: "/unit/settings.json",
      value: {
        modelLibraryEntries: [{ uid: "model-entry" }],
        modelLibraryAgentIds: ["deepseek-agent", "custom-agent"]
      }
    });
    expect(result.agentConfigs).toEqual(registryState);
    expect(result.agentSelector.options).toEqual([
      expect.objectContaining({
        agentUid: "deepseek-agent",
        label: "DeepSeek Agent · deepseek-chat",
        provider: "deepseek",
        model: "deepseek-chat",
        permissionGroupId: "pg-1",
        moduleIds: ["module-a", "module-b"],
        capabilities: ["agent.invoke", "knowledge.agent.answer"],
        status: "available",
        selectable: true,
        reason: ""
      }),
      expect.objectContaining({
        agentUid: "custom-agent",
        label: "Custom · unit-model",
        moduleIds: ["*"],
        status: "available",
        selectable: true
      }),
      expect.objectContaining({
        agentUid: "local-agent",
        status: "available",
        selectable: true
      }),
      expect.objectContaining({
        agentUid: "unsupported-agent",
        status: "unsupported",
        selectable: false,
        capabilities: []
      })
    ]);
  });

  it("returns an empty agent settings projection when the registry is absent or invalid", async () => {
    loadSettingsMock.mockResolvedValue({});

    const result = await projections.buildAgentSettingsConsoleProjection({
      userDataPath: "/empty",
      getAgentConfigRegistry: () => ({})
    });

    expect(result).toEqual({
      settings: {
        path: "/empty/settings.json",
        value: {}
      },
      agentSelector: expect.objectContaining({
        schemaVersion: "v0.0.1:schema:definition-1",
        source: "agent-configs",
        options: []
      }),
      agentConfigs: {
        rootPath: "",
        modelListPath: "",
        agentListPath: "",
        modelManifest: {},
        agentManifest: {}
      }
    });
  });

  it("builds runtime settings, jobs summary, and service summaries with fallbacks", async () => {
    loadSettingsMock.mockResolvedValue({ featureFlags: { console: true } });

    await expect(projections.buildRuntimeInfoSettings({ userDataPath: "/runtime" })).resolves.toEqual({
      featureFlags: { console: true }
    });
    expect(loadSettingsMock).toHaveBeenCalledWith("/runtime", { redactSecrets: true });

    await expect(projections.buildConsoleJobsSummary()).resolves.toEqual({ summary: {}, items: [] });
    const listJobs = vi.fn(async ({ limit }) => ({ summary: { total: limit }, items: [{ id: "job-1" }] }));
    await expect(projections.buildConsoleJobsSummary({
      jobWorkflowProvider: { listJobs },
      limit: 7
    })).resolves.toEqual({ summary: { total: 7 }, items: [{ id: "job-1" }] });

    await expect(projections.buildMaintenanceAgentConsoleSummary()).resolves.toBeNull();
    const getConsoleSummary = vi.fn(async () => ({ ok: true }));
    await expect(projections.buildMaintenanceAgentConsoleSummary({
      maintenanceAgent: { getConsoleSummary }
    })).resolves.toEqual({ ok: true });

    await expect(projections.buildClientRuntimeConsoleSummary()).resolves.toBeNull();
    const getStatus = vi.fn(async () => ({ clients: 2 }));
    await expect(projections.buildClientRuntimeConsoleSummary({
      clientRuntimeAllocator: { getStatus }
    })).resolves.toEqual({ clients: 2 });
  });

  it("combines client registrations with optional tool management connection rows", async () => {
    const listClientRegistrations = vi.fn(() => ({ summary: { total: 1 }, items: [{ clientUid: "desktop-a" }] }));
    const buildToolRows = vi.fn(async (provider, options) => [
      { clientUid: `${provider.name}:${options.offlineAfterSeconds}` }
    ]);

    const result = await projections.buildConsoleClientConnections({
      storageProvider: { listClientRegistrations },
      offlineAfterSeconds: 90,
      toolSkillManagementProvider: { name: "tools" },
      buildToolManagementClientConnectionRows: buildToolRows
    });

    expect(listClientRegistrations).toHaveBeenCalledWith({ offlineAfterSeconds: 90 });
    expect(buildToolRows).toHaveBeenCalledWith({ name: "tools" }, { offlineAfterSeconds: 90 });
    expect(buildClientConnectionListMock).toHaveBeenCalledWith(
      { summary: { total: 1 }, items: [{ clientUid: "desktop-a" }] },
      [{ clientUid: "tools:90" }]
    );
    expect(result.rows).toEqual([
      { clientUid: "desktop-a" },
      { clientUid: "tools:90" }
    ]);

    await projections.buildConsoleClientConnections();
    expect(buildClientConnectionListMock).toHaveBeenLastCalledWith({ summary: {}, items: [] }, []);
  });
});
