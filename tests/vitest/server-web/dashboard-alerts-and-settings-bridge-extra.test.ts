import { computed, ref } from "vue";
import { describe, expect, it, vi } from "vitest";

import {
  createConsoleDashboardConfigurationAlertController,
  type DashboardAgentOption,
} from "../../../server-web/composables/console-dashboard-configuration-alert-controller";
import { createConsoleSettingsBridgeController } from "../../../server-web/composables/console-settings-bridge-controller";

function option(value: string, overrides: Partial<DashboardAgentOption> = {}): DashboardAgentOption {
  return {
    value,
    enabled: true,
    label: value,
    ref: value,
    ...overrides,
  };
}

function createAlertController(overrides: Record<string, any> = {}) {
  const modelEntries = ref(overrides.visibleModelEntries ?? [{ alias: "ready-agent" }]);
  const settingsDraft = ref(overrides.settingsDraft ?? {
    agentExploreDefaults: {},
    moduleAgentProfiles: {},
  });
  const moduleRefs = new Map(Object.entries(overrides.moduleRefs ?? {}));
  const moduleNeedsIntelligence = overrides.moduleNeedsIntelligence || vi.fn((moduleId: string) => moduleId === "graphInsight");
  return createConsoleDashboardConfigurationAlertController({
    agentExploreAgentOptions: computed(() => overrides.agentExploreAgentOptions ?? [option("retrieval")]),
    agentExploreForm: ref(overrides.agentExploreForm ?? { modelAlias: "retrieval" }),
    agentModelAssignmentOptions: computed(() => overrides.agentModelAssignmentOptions ?? [option("knowledge-ref")]),
    agentSelectorOptions: computed(() => overrides.agentSelectorOptions ?? [option("review")]),
    infoFeedForm: ref(overrides.infoFeedForm ?? { modelAlias: "summary" }),
    infoFeedModelOptions: computed(() => overrides.infoFeedModelOptions ?? [option("summary")]),
    moduleModelRef: (moduleId: string) => String(moduleRefs.get(moduleId) || ""),
    moduleNeedsIntelligence,
    ruleAuthoringForm: ref(overrides.ruleAuthoringForm ?? { modelAlias: "rules" }),
    ruleAuthoringModelOptions: computed(() => overrides.ruleAuthoringModelOptions ?? [option("rules")]),
    settingsDraft,
    visibleModelEntries: computed(() => modelEntries.value as any),
  });
}

describe("createConsoleDashboardConfigurationAlertController", () => {
  it("reports an all-clear summary when configured agents are available", () => {
    const controller = createAlertController({
      settingsDraft: {
        agentExploreDefaults: {
          infoFeedSummaryModelAlias: "summary",
          agentRetrievalModelAlias: "retrieval",
          ruleAuthoringModelAlias: "rules",
          reviewFusionModelAlias: "review",
        },
      },
      moduleRefs: { graphInsight: "knowledge-ref" },
    });

    expect(controller.agentConfigurationAlerts.value).toEqual([]);
    expect(controller.agentConfigurationAlertSummary.value)
      .toBe("所有需要智能体的功能都已显式绑定可用智能体。");
  });

  it("collects empty library, missing selections, disabled agents, and module assignment alerts", () => {
    const controller = createAlertController({
      visibleModelEntries: [],
      infoFeedForm: { modelAlias: "" },
      agentExploreForm: { modelAlias: "missing-agent" },
      agentExploreAgentOptions: [option("missing-agent", {
        enabled: false,
        disabledReason: "token missing",
      })],
      ruleAuthoringForm: { modelAlias: "rules" },
      ruleAuthoringModelOptions: [option("rules", { enabled: false })],
      settingsDraft: {
        agentExploreDefaults: {
          reviewFusionModelAlias: "review",
        },
      },
      agentSelectorOptions: [option("review", { enabled: false })],
      moduleRefs: { knowledge: "" },
    });

    const alerts = controller.agentConfigurationAlerts.value;
    expect(alerts.map((alert) => alert.alertId)).toEqual(expect.arrayContaining([
      "model-library-empty",
      "info-feed-summary-agent",
      "agent-explore-agent",
      "rule-authoring-agent",
      "knowledge-review-fusion-agent",
      "module:graphInsight",
    ]));
    expect(alerts.find((alert) => alert.alertId === "agent-explore-agent")?.detail)
      .toContain("token missing");
    expect(controller.agentConfigurationAlertSummary.value).toMatch(/\d+ 项不可用/);
    expect(controller.agentConfigurationAlertSummary.value).toMatch(/\d+ 项未配置/);
  });

  it("flags unavailable module bindings and skips modules that do not need intelligence", () => {
    const moduleNeedsIntelligence = vi.fn((moduleId: string) => moduleId === "graphInsight");
    const controller = createAlertController({
      settingsDraft: {
        agentExploreDefaults: {
          infoFeedSummaryModelAlias: "summary",
          agentRetrievalModelAlias: "retrieval",
          ruleAuthoringModelAlias: "rules",
          reviewFusionModelAlias: "review",
        },
      },
      moduleNeedsIntelligence,
      moduleRefs: { graphInsight: "disabled-ref" },
      agentModelAssignmentOptions: [option("disabled-agent", { ref: "disabled-ref", enabled: false })],
    });

    expect(controller.agentConfigurationAlerts.value).toEqual([
      expect.objectContaining({
        alertId: "module:graphInsight",
        tone: "danger",
        status: "智能体不可用",
      }),
    ]);
    expect(moduleNeedsIntelligence).toHaveBeenCalled();
  });
});

describe("createConsoleSettingsBridgeController", () => {
  it("throws before controllers are bound and resets remote draft state after exceptions", async () => {
    const controller = createConsoleSettingsBridgeController();

    expect(() => controller.normalizeModelLibraryAgents({} as any)).toThrow(/draft controller/);
    expect(() => controller.settingsPayloadForSave()).toThrow(/draft controller/);
    await expect(controller.saveSettings()).rejects.toThrow(/persistence controller/);

    expect(controller.applyingRemoteConsoleDrafts).toBe(false);
    expect(() => controller.applyRemoteConsoleDraftUpdate(() => {
      expect(controller.isApplyingRemoteConsoleDrafts()).toBe(true);
      throw new Error("boom");
    })).toThrow("boom");
    expect(controller.applyingRemoteConsoleDrafts).toBe(false);
  });

  it("delegates draft and persistence actions after binding", async () => {
    const draftActions = {
      moduleAgentProfilesPayload: vi.fn(() => ({ knowledge: { modelAlias: "agent" } })),
      normalizeHttpAdapterSettings: vi.fn((settings: any) => ({ ...settings, http: true })),
      normalizeModelLibraryAgents: vi.fn(() => [{ alias: "agent" }]),
      normalizedSettingsFromServer: vi.fn((settings: any) => ({ ...settings, normalized: true })),
      remoteDraftEquals: vi.fn(() => true),
      replaceSettingsDraftFromServer: vi.fn(),
      settingsDraftEquals: vi.fn(() => false),
      settingsPayloadForSave: vi.fn(() => ({ payload: true })),
    };
    const persistenceActions = {
      disableMountModule: vi.fn(async (name: string) => ({ disabled: name })),
      enableMountModule: vi.fn(async (name: string) => ({ enabled: name })),
      reloadModules: vi.fn(async () => ({ reloaded: true })),
      saveAgentPermissionSettings: vi.fn(async () => ({ saved: "permissions" })),
      saveModelLibrarySettings: vi.fn(async () => ({ saved: "models" })),
      saveModuleSettings: vi.fn(async () => ({ saved: "modules" })),
      saveMountModules: vi.fn(async (busy = "mounts") => ({ saved: busy })),
      saveSettings: vi.fn(async () => ({ saved: "settings" })),
    };
    const controller = createConsoleSettingsBridgeController();

    expect(controller.bindSettingsDraftActions(draftActions as any)).toBe(draftActions);
    expect(controller.bindSettingsPersistenceActions(persistenceActions)).toBe(persistenceActions);

    expect(controller.normalizeModelLibraryAgents({} as any)).toEqual([{ alias: "agent" }]);
    expect(controller.moduleAgentProfilesPayload()).toEqual({ knowledge: { modelAlias: "agent" } });
    expect(controller.normalizeHttpAdapterSettings({ value: 1 } as any)).toEqual({ value: 1, http: true });
    expect(controller.settingsPayloadForSave()).toEqual({ payload: true });
    expect(controller.normalizedSettingsFromServer({ value: 2 } as any)).toEqual({ value: 2, normalized: true });
    expect(controller.remoteDraftEquals({}, {})).toBe(true);
    expect(controller.settingsDraftEquals({} as any, {} as any)).toBe(false);
    controller.replaceSettingsDraftFromServer({ fromServer: true } as any, { markClean: true });
    expect(draftActions.replaceSettingsDraftFromServer).toHaveBeenCalledWith(
      { fromServer: true },
      { markClean: true },
    );

    await expect(controller.saveModuleSettings()).resolves.toEqual({ saved: "modules" });
    await expect(controller.saveMountModules()).resolves.toEqual({ saved: "mounts" });
    await expect(controller.saveMountModules("custom")).resolves.toEqual({ saved: "custom" });
    await expect(controller.reloadModules()).resolves.toEqual({ reloaded: true });
    await expect(controller.enableMountModule("ocr")).resolves.toEqual({ enabled: "ocr" });
    await expect(controller.disableMountModule("ocr")).resolves.toEqual({ disabled: "ocr" });
    await expect(controller.saveSettings()).resolves.toEqual({ saved: "settings" });
    await expect(controller.saveModelLibrarySettings()).resolves.toEqual({ saved: "models" });
    await expect(controller.saveAgentPermissionSettings()).resolves.toEqual({ saved: "permissions" });
  });
});
