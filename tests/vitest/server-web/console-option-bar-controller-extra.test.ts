import { computed, ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import { createConsoleOptionBarController } from "../../../server-web/composables/console-option-bar-controller";

function createController() {
  const addableModelProviders = ref([
    { id: "openai", label: "OpenAI" },
    { id: "local", label: "Local" },
  ]);
  const authState = ref({
    roles: [
      { label: "Admin", roleId: "admin" },
      { label: "Reader", roleId: "reader" },
    ],
  });
  const consoleState = ref({
    runtime: {
      analysisModules: [
        { id: "mail", label: "Mail Analysis" },
      ],
    },
  });
  const moduleModelAssignmentOptions = vi.fn((moduleId: string) => [
    {
      enabled: true,
      label: `${moduleId} Primary`,
      provider: "openai",
      ref: `${moduleId}:primary`,
    },
    {
      enabled: false,
      label: `${moduleId} Backup`,
      provider: "local",
      ref: `${moduleId}:backup`,
    },
  ]);
  const providerLabel = vi.fn((provider: string) => ({
    local: "Local Runtime",
    openai: "OpenAI Provider",
  }[provider] || provider));

  const controller = createConsoleOptionBarController({
    addableModelProviders: computed(() => addableModelProviders.value),
    agentExploreContextWindowOptions: [
      { description: "short context", label: "Short", value: "short" },
      { description: "long context", label: "Long", value: "long" },
    ],
    agentExploreThinkingModeOptions: [
      { label: "Fast", value: "fast" },
      { label: "Deep", value: "deep" },
    ],
    authState,
    consoleState,
    moduleModelAssignmentOptions,
    providerLabel,
  });

  return {
    addableModelProviders,
    authState,
    consoleState,
    controller,
    moduleModelAssignmentOptions,
    providerLabel,
  };
}

describe("console option bar controller extra coverage", () => {
  it("exposes static option groups", () => {
    const { controller } = createController();

    expect(controller.enabledBooleanOptionBarOptions).toEqual([
      { value: true, label: "开启" },
      { value: false, label: "关闭" },
    ]);
    expect(controller.enabledStringOptionBarOptions).toEqual([
      { value: "true", label: "开启" },
      { value: "false", label: "关闭" },
    ]);
    expect(controller.vocabularyStatusOptionBarOptions.map((option) => option.value)).toEqual([
      "draft",
      "active",
      "retired",
    ]);
    expect(controller.plannerModeOptionBarOptions.map((option) => option.value)).toEqual([
      "gateway_fallback",
      "fixed_runbook",
      "gateway",
    ]);
    expect(controller.autoApproveRiskOptionBarOptions.map((option) => option.value)).toEqual([
      "safe_write",
      "read_only",
    ]);
    expect(controller.discoveryModeOptionBarOptions).toEqual([
      { value: "active", label: "激活 (active)" },
      { value: "forward", label: "转发 (forward)" },
    ]);
    expect(controller.moduleAccessModeOptionBarOptions).toEqual([
      { value: "all", label: "默认公开给所有功能" },
      { value: "selected", label: "仅公开给选定功能" },
    ]);
  });

  it("maps computed context, thinking, runtime module, provider, and role options", () => {
    const { addableModelProviders, authState, consoleState, controller } = createController();

    expect(controller.contextWindowOptionBarOptions.value).toEqual([
      { value: "short", label: "Short - short context" },
      { value: "long", label: "Long - long context" },
    ]);
    expect(controller.thinkingModeOptionBarOptions.value).toEqual([
      { value: "fast", label: "Fast" },
      { value: "deep", label: "Deep" },
    ]);
    expect(controller.analysisModuleOptionBarOptions.value).toEqual([
      { value: "mail", label: "Mail Analysis / mail" },
    ]);
    expect(controller.addableModelProviderOptionBarOptions.value).toEqual([
      { value: "openai", label: "OpenAI" },
      { value: "local", label: "Local" },
    ]);
    expect(controller.authRoleOptionBarOptions.value).toEqual([
      { value: "admin", label: "Admin" },
      { value: "reader", label: "Reader" },
    ]);

    consoleState.value = null as never;
    addableModelProviders.value = [];
    authState.value = null as never;

    expect(controller.analysisModuleOptionBarOptions.value).toEqual([]);
    expect(controller.addableModelProviderOptionBarOptions.value).toEqual([]);
    expect(controller.authRoleOptionBarOptions.value).toEqual([]);
  });

  it("maps module model assignments with provider labels and enabled flags", () => {
    const { controller, moduleModelAssignmentOptions, providerLabel } = createController();

    expect(controller.moduleModelAssignmentSelectOptions("knowledge")).toEqual([
      {
        disabledReason: "未配置",
        enabled: true,
        label: "knowledge Primary / OpenAI Provider",
        value: "knowledge:primary",
      },
      {
        disabledReason: "未配置",
        enabled: false,
        label: "knowledge Backup / Local Runtime",
        value: "knowledge:backup",
      },
    ]);
    expect(moduleModelAssignmentOptions).toHaveBeenCalledWith("knowledge");
    expect(providerLabel).toHaveBeenCalledWith("openai");
    expect(providerLabel).toHaveBeenCalledWith("local");
  });
});
