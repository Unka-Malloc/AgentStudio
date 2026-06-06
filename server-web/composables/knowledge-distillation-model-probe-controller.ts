import { computed, onBeforeUnmount, ref, watch, type Ref } from "vue";
import {
  optionSelectable,
  optionValue,
  probeDistillationModelStatus,
  type AgentModelOption,
  type DistillationModelProbeStatus,
} from "../lib/knowledge-distillation-workbench";
import { createConsoleTimeoutController } from "./console-timer-controller";

type KnowledgeDistillationModelProbeControllerOptions = {
  createOptions: Ref<{ modelAlias: string }>;
  formatCompactDate: (value: string) => string;
  modelOptions: () => AgentModelOption[] | undefined;
};

export function createKnowledgeDistillationModelProbeController(
  options: KnowledgeDistillationModelProbeControllerOptions,
) {
  const modelProbeState = ref<"unknown" | "checking" | "online" | "offline" | "unconfigured">("unknown");
  const modelProbeMessage = ref("");
  const modelProbeCheckedAt = ref("");
  const modelProbeDelay = createConsoleTimeoutController();
  let modelProbeSequence = 0;

  const modelProbeLabel = computed(() => {
    if (modelProbeState.value === "checking") return "检测中";
    if (modelProbeState.value === "online") return "模型在线";
    if (modelProbeState.value === "offline") return "模型离线";
    if (modelProbeState.value === "unconfigured") return "模型未配置";
    return "未检测";
  });
  const modelProbeTone = computed(() => {
    if (modelProbeState.value === "online") return "success";
    if (modelProbeState.value === "offline" || modelProbeState.value === "unconfigured") return "danger";
    if (modelProbeState.value === "checking") return "info";
    return "neutral";
  });
  const modelProbeTooltip = computed(() =>
    [
      modelProbeMessage.value,
      modelProbeCheckedAt.value ? `检测时间：${options.formatCompactDate(modelProbeCheckedAt.value)}` : "",
    ].filter(Boolean).join(" · ") || "模型状态尚未检测",
  );
  const distillationModelOptions = computed(() => options.modelOptions() || []);
  const distillationModelOptionValues = computed(() =>
    new Set(distillationModelOptions.value.map((option) => String(option.agentUid ?? option.value ?? "").trim()).filter(Boolean)),
  );
  const selectedModelOption = computed(() => {
    const selected = String(options.createOptions.value.modelAlias || "").trim();
    return distillationModelOptions.value.find((option) => optionValue(option) === selected) || null;
  });
  const selectedModelReady = computed(() =>
    Boolean(selectedModelOption.value && optionSelectable(selectedModelOption.value)),
  );

  function firstSelectableModelAlias() {
    return optionValue(distillationModelOptions.value.find(optionSelectable) || distillationModelOptions.value[0] || {});
  }

  function normalizeDistillationModelAlias() {
    const current = String(options.createOptions.value.modelAlias || "").trim();
    if (current && distillationModelOptionValues.value.has(current)) {
      return;
    }
    const fallback = firstSelectableModelAlias();
    if (fallback && fallback !== current) {
      options.createOptions.value.modelAlias = fallback;
    } else if (!fallback && current) {
      options.createOptions.value.modelAlias = "";
    }
  }

  function applyModelProbeStatus(result: DistillationModelProbeStatus) {
    modelProbeCheckedAt.value = result.checkedAt;
    modelProbeMessage.value = result.message;
    modelProbeState.value = result.state;
  }

  async function refreshModelProbeStatus() {
    const sequence = ++modelProbeSequence;
    modelProbeState.value = "checking";
    modelProbeMessage.value = "";
    try {
      const alias = String(options.createOptions.value.modelAlias || "").trim();
      const result = await probeDistillationModelStatus(alias);
      if (sequence === modelProbeSequence) {
        applyModelProbeStatus(result);
      }
    } catch (nextError) {
      if (sequence === modelProbeSequence) {
        modelProbeState.value = "offline";
        modelProbeCheckedAt.value = new Date().toISOString();
        modelProbeMessage.value = nextError instanceof Error ? nextError.message : "模型状态检测失败。";
      }
    }
  }

  function scheduleModelProbeStatus() {
    modelProbeDelay.schedule(() => {
      refreshModelProbeStatus().catch(() => undefined);
    }, 700);
  }

  watch(() => options.createOptions.value.modelAlias, () => {
    scheduleModelProbeStatus();
  });

  watch(distillationModelOptions, () => {
    normalizeDistillationModelAlias();
  }, { immediate: true });

  onBeforeUnmount(() => {
    modelProbeDelay.stop();
  });

  return {
    distillationModelOptions,
    modelProbeLabel,
    modelProbeTone,
    modelProbeTooltip,
    refreshModelProbeStatus,
    selectedModelReady,
  };
}
