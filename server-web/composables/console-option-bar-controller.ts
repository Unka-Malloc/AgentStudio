import { computed, type ComputedRef, type Ref } from "vue";
import type { ConsoleAuthSummary } from "../lib/auth-types";
import type { ServerConsoleState } from "../lib/types";
import type { OptionBarOption, OptionBarValue } from "../types/app";

type LabeledValueOption = {
  value: OptionBarValue;
  label: string;
};

type DescribedValueOption = LabeledValueOption & {
  description: string;
};

type ModelProviderOption = {
  id: OptionBarValue;
  label: string;
};

type ModuleModelAssignmentOption = {
  ref: string;
  label: string;
  provider: string;
  enabled: boolean;
};

type ConsoleOptionBarControllerOptions = {
  addableModelProviders: ComputedRef<readonly ModelProviderOption[]>;
  agentExploreContextWindowOptions: readonly DescribedValueOption[];
  agentExploreThinkingModeOptions: readonly LabeledValueOption[];
  authState: Ref<ConsoleAuthSummary | null>;
  consoleState: Ref<ServerConsoleState | null>;
  moduleModelAssignmentOptions: (moduleId: string) => ModuleModelAssignmentOption[];
  providerLabel: (provider: string) => string;
};

export type ModuleModelAssignmentSelectOption = OptionBarOption & {
  enabled: boolean;
  disabledReason: string;
};

export function createConsoleOptionBarController(
  options: ConsoleOptionBarControllerOptions,
) {
  const enabledBooleanOptionBarOptions: OptionBarOption[] = [
    { value: true, label: "开启" },
    { value: false, label: "关闭" },
  ];
  const enabledStringOptionBarOptions: OptionBarOption[] = [
    { value: "true", label: "开启" },
    { value: "false", label: "关闭" },
  ];
  const vocabularyStatusOptionBarOptions: OptionBarOption[] = [
    { value: "draft", label: "草稿" },
    { value: "active", label: "启用" },
    { value: "retired", label: "停用" },
  ];
  const plannerModeOptionBarOptions: OptionBarOption[] = [
    { value: "gateway_fallback", label: "gateway_fallback" },
    { value: "fixed_runbook", label: "fixed_runbook" },
    { value: "gateway", label: "gateway" },
  ];
  const autoApproveRiskOptionBarOptions: OptionBarOption[] = [
    { value: "safe_write", label: "safe_write" },
    { value: "read_only", label: "read_only" },
  ];
  const discoveryModeOptionBarOptions: OptionBarOption[] = [
    { value: "active", label: "激活 (active)" },
    { value: "forward", label: "转发 (forward)" },
  ];
  const contextWindowOptionBarOptions = computed<OptionBarOption[]>(() =>
    options.agentExploreContextWindowOptions.map((option) => ({
      value: option.value,
      label: `${option.label} - ${option.description}`,
    })),
  );
  const thinkingModeOptionBarOptions = computed<OptionBarOption[]>(() =>
    options.agentExploreThinkingModeOptions.map((option) => ({
      value: option.value,
      label: option.label,
    })),
  );
  const moduleAccessModeOptionBarOptions: OptionBarOption[] = [
    { value: "all", label: "默认公开给所有功能" },
    { value: "selected", label: "仅公开给选定功能" },
  ];
  const analysisModuleOptionBarOptions = computed<OptionBarOption[]>(() =>
    (options.consoleState.value?.runtime?.analysisModules || []).map((item) => ({
      value: item.id,
      label: `${item.label} / ${item.id}`,
    })),
  );
  const addableModelProviderOptionBarOptions = computed<OptionBarOption[]>(() =>
    options.addableModelProviders.value.map((provider) => ({
      value: provider.id,
      label: provider.label,
    })),
  );
  const authRoleOptionBarOptions = computed<OptionBarOption[]>(() =>
    (options.authState.value?.roles || []).map((role) => ({
      value: role.roleId,
      label: role.label,
    })),
  );

  function moduleModelAssignmentSelectOptions(
    moduleId: string,
  ): ModuleModelAssignmentSelectOption[] {
    return options.moduleModelAssignmentOptions(moduleId).map((model) => ({
      value: model.ref,
      label: `${model.label} / ${options.providerLabel(model.provider)}`,
      enabled: model.enabled,
      disabledReason: "未配置",
    }));
  }

  return {
    addableModelProviderOptionBarOptions,
    analysisModuleOptionBarOptions,
    authRoleOptionBarOptions,
    autoApproveRiskOptionBarOptions,
    contextWindowOptionBarOptions,
    discoveryModeOptionBarOptions,
    enabledBooleanOptionBarOptions,
    enabledStringOptionBarOptions,
    moduleAccessModeOptionBarOptions,
    moduleModelAssignmentSelectOptions,
    plannerModeOptionBarOptions,
    thinkingModeOptionBarOptions,
    vocabularyStatusOptionBarOptions,
  };
}
