import { ref } from "vue";
import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createConsoleFeatureAccessController } from "../../../server-web/composables/console-feature-access-controller";
import { createConsoleGoldenRulesController } from "../../../server-web/composables/console-golden-rules-controller";

const rulesClientMock = vi.hoisted(() => ({
  getGoldenRules: vi.fn(),
  publishGoldenRules: vi.fn(),
  saveGoldenRules: vi.fn(),
}));

vi.mock("../../../server-web/lib/knowledge-rules-client", () => ({
  getGoldenRules: rulesClientMock.getGoldenRules,
  publishGoldenRules: rulesClientMock.publishGoldenRules,
  saveGoldenRules: rulesClientMock.saveGoldenRules,
}));

describe("console feature access controller extra coverage", () => {
  it("hides all feature-gated UI when unauthenticated or features are missing", () => {
    const consoleState = ref<any>(null);
    const authenticated = ref(false);
    const controller = createConsoleFeatureAccessController({
      consoleState,
      debugTabs: [
        { id: "knowledgeRecall", label: "Recall" },
        { id: "agentRetrieval", label: "Agent Retrieval" },
        { id: "knowledgeDistillation", label: "Distillation" },
        { id: "runtimeModules", label: "Runtime" },
      ] as any,
      isAuthenticated: () => authenticated.value,
      knowledgeTabs: [
        { id: "library", label: "Library" },
        { id: "management", label: "Management" },
      ] as any,
    });

    expect(controller.activeConsoleFeatureIds.value).toEqual([]);
    expect(controller.hasFeature("knowledge-core")).toBe(false);
    expect(controller.hasAnyFeature(["knowledge-core", "agent-gateway"])).toBe(false);
    expect(controller.visibleKnowledgeTabs.value).toEqual([]);
    expect(controller.visibleDebugTabs.value.map((tab) => tab.id)).toEqual(["runtimeModules"]);
    expect(controller.isAdminViewEnabled("agentConfig" as any)).toBe(false);

    authenticated.value = true;
    consoleState.value = { features: { activeFeatureIds: ["knowledge-core"] } };
    expect(controller.hasFeature("knowledge-core")).toBe(true);
    expect(controller.visibleKnowledgeTabs.value.map((tab) => tab.id)).toEqual(["library", "management"]);
    expect(controller.visibleDebugTabs.value.map((tab) => tab.id)).toEqual([
      "knowledgeRecall",
      "runtimeModules",
    ]);
  });

  it("maps admin view gates across feature combinations", () => {
    const consoleState = ref<any>({
      features: {
        activeFeatureIds: [
          "agent-gateway",
          "agent-management",
          "maintenance-agent-runbooks",
          "analysis-runtime",
        ],
      },
    });
    const controller = createConsoleFeatureAccessController({
      consoleState,
      debugTabs: [] as any,
      isAuthenticated: () => true,
      knowledgeTabs: [] as any,
    });

    expect(controller.hasAnyFeature(["missing", "agent-management"])).toBe(true);
    expect(controller.isAdminViewEnabled("tools" as any)).toBe(true);
    expect(controller.isAdminViewEnabled("toolList" as any)).toBe(true);
    expect(controller.isAdminViewEnabled("toolStats" as any)).toBe(true);
    expect(controller.isAdminViewEnabled("agentPermissions" as any)).toBe(true);
    expect(controller.isAdminViewEnabled("agentConfig" as any)).toBe(true);
    expect(controller.isAdminViewEnabled("agentAssignment" as any)).toBe(true);
    expect(controller.isAdminViewEnabled("contextManagement" as any)).toBe(true);
    expect(controller.isAdminViewEnabled("maintenanceAgent" as any)).toBe(true);
    expect(controller.isAdminViewEnabled("modules" as any)).toBe(true);
    expect(controller.isAdminViewEnabled("clients" as any)).toBe(true);

    consoleState.value = { features: { activeFeatureIds: [] } };
    expect(controller.isAdminViewEnabled("tools" as any)).toBe(false);
    expect(controller.isAdminViewEnabled("maintenanceAgent" as any)).toBe(false);
    expect(controller.isAdminViewEnabled("clients" as any)).toBe(true);
  });
});

describe("console golden rules controller extra coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createHarness() {
    const error = ref("previous error");
    const setBusy = vi.fn();
    const clearAllBusy = vi.fn();
    const controller = createConsoleGoldenRulesController({
      clearAllBusy,
      error,
      setBusy,
    });
    return {
      clearAllBusy,
      controller,
      error,
      setBusy,
    };
  }

  it("loads packages, filters invalid package rows, and formats title/items/enabled state", async () => {
    rulesClientMock.getGoldenRules.mockResolvedValue({
      packages: [
        {
          packageId: "risk",
          version: 3,
          rules: [
            { id: "r1", enabled: false },
            { id: "r2" },
          ],
        },
        null,
        "bad",
      ],
    });
    const { controller } = createHarness();

    await controller.loadGoldenRules();

    expect(controller.goldenRulePackages.value).toHaveLength(1);
    expect(controller.goldenRulePackageTitle(controller.goldenRulePackages.value[0])).toBe("risk v3");
    expect(controller.goldenRulePackageTitle({})).toBe("golden-rules v0");
    expect(controller.goldenRuleItems(controller.goldenRulePackages.value[0])).toEqual([
      { index: 0, rule: { id: "r1", enabled: false } },
      { index: 1, rule: { id: "r2" } },
    ]);
    expect(controller.goldenRuleItems({ rules: [null, { id: "ok" }] })).toEqual([
      { index: 0, rule: {} },
      { index: 1, rule: { id: "ok" } },
    ]);
    expect(controller.expertRuleEnabled({ enabled: false })).toBe(false);
    expect(controller.expertRuleEnabled({})).toBe(true);
    expect(controller.expertRuleEnabled(null)).toBe(true);
  });

  it("saves, publishes, reloads, and clears busy state when toggling a valid rule", async () => {
    rulesClientMock.saveGoldenRules.mockResolvedValue({ package: { version: 8 } });
    rulesClientMock.publishGoldenRules.mockResolvedValue({});
    rulesClientMock.getGoldenRules.mockResolvedValue({ packages: [] });
    const harness = createHarness();

    await harness.controller.toggleGoldenRuleEnabled({
      packageId: "risk",
      version: 7,
      status: "published",
      rules: [
        { id: "r1", enabled: true },
        { id: "r2", enabled: false },
      ],
    }, 1, true);

    expect(harness.setBusy).toHaveBeenCalledWith("golden-rule:risk:1");
    expect(rulesClientMock.saveGoldenRules).toHaveBeenCalledWith({
      packageId: "risk",
      version: undefined,
      status: "draft",
      rules: [
        { id: "r1", enabled: true },
        { id: "r2", enabled: true },
      ],
    });
    expect(rulesClientMock.publishGoldenRules).toHaveBeenCalledWith("risk", { version: 8 });
    expect(rulesClientMock.getGoldenRules).toHaveBeenCalledTimes(1);
    expect(harness.error.value).toBe("");
    expect(harness.clearAllBusy).toHaveBeenCalledTimes(1);
  });

  it("skips missing package id and reports save failures", async () => {
    const skipHarness = createHarness();

    await skipHarness.controller.toggleGoldenRuleEnabled({ rules: [] }, 0, false);
    expect(skipHarness.setBusy).not.toHaveBeenCalled();
    expect(rulesClientMock.saveGoldenRules).not.toHaveBeenCalled();

    rulesClientMock.saveGoldenRules.mockRejectedValue(new Error("save failed"));
    const failHarness = createHarness();

    await failHarness.controller.toggleGoldenRuleEnabled({
      packageId: "risk",
      rules: [{ id: "r1" }],
    }, 0, false);

    expect(failHarness.error.value).toBe("save failed");
    expect(failHarness.clearAllBusy).toHaveBeenCalledTimes(1);
    expect(rulesClientMock.publishGoldenRules).not.toHaveBeenCalled();
  });
});
