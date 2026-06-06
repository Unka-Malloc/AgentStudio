import { computed, ref, type Ref } from "vue";
import { jsonPreview } from "./console-format-utils";
import {
  getKnowledgeConfigSchema,
  getKnowledgeConsole,
  getKnowledgeMaintenance,
  saveKnowledgeMaintenance as saveKnowledgeMaintenanceRequest,
} from "../lib/knowledge-maintenance-client";
import { getKnowledgeSources } from "../lib/knowledge-sources-client";
import type {
  KnowledgeConfigSchema,
  KnowledgeConsoleState,
  KnowledgeSourceState,
  MaintenanceSettings,
  ServerConsoleState,
} from "../lib/types";
import type {
  DebugTab,
  KnowledgeManagementPanel,
  KnowledgeTab,
  OptionBarOption,
  OptionBarValue,
} from "../types/app";

type ConsoleKnowledgeMaintenanceControllerOptions = {
  clearAllBusy: () => void;
  consoleState: Ref<ServerConsoleState | null>;
  debugTab: Ref<DebugTab>;
  error: Ref<string>;
  hasScope: (scope: string) => boolean;
  knowledgeManagementPanel: Ref<KnowledgeManagementPanel>;
  refreshKnowledgeConflicts: (options?: { silent?: boolean; suppressError?: boolean }) => Promise<unknown>;
  refreshKnowledgeRecallBackendSpaces: () => Promise<unknown>;
  setBusy: (key: string) => void;
};

function readNestedValue(source: Record<string, unknown>, dottedName: string) {
  return dottedName.split(".").reduce<unknown>((current, key) => {
    if (!current || typeof current !== "object") {
      return undefined;
    }
    return (current as Record<string, unknown>)[key];
  }, source);
}

function writeNestedValue(source: Record<string, unknown>, dottedName: string, value: unknown) {
  const parts = dottedName.split(".");
  const next = { ...source };
  let cursor: Record<string, unknown> = next;
  parts.forEach((part, index) => {
    if (index === parts.length - 1) {
      cursor[part] = value;
      return;
    }
    const existing = cursor[part];
    const child =
      existing && typeof existing === "object" && !Array.isArray(existing)
        ? { ...(existing as Record<string, unknown>) }
        : {};
    cursor[part] = child;
    cursor = child;
  });
  return next;
}

export function createConsoleKnowledgeMaintenanceController(
  options: ConsoleKnowledgeMaintenanceControllerOptions,
) {
  const knowledgeConsole = ref<KnowledgeConsoleState | null>(null);
  const knowledgeSchema = ref<KnowledgeConfigSchema | null>(null);
  const knowledgeSourceState = ref<KnowledgeSourceState | null>(null);
  const knowledgeMaintenanceDraft = ref<MaintenanceSettings>({});
  const maintenanceJson = ref("{}");

  const knowledgeManagementPanelOptionBarOptions = computed<OptionBarOption[]>(() => [
    { value: "knowledge", label: "知识" },
    { value: "rules", label: "规则" },
  ]);

  function selectKnowledgeManagementPanel(panel: OptionBarValue) {
    if (panel === "knowledge" || panel === "rules") {
      options.knowledgeManagementPanel.value = panel;
    }
  }

  const knowledgeStatus = computed(() => {
    const health = knowledgeConsole.value?.health || options.consoleState.value?.knowledgeConsole?.health;
    return String(health?.status || (health?.ok === false ? "degraded" : "ok"));
  });

  const knowledgeModules = computed(() => {
    const health = knowledgeConsole.value?.health || options.consoleState.value?.knowledgeConsole?.health;
    const capabilities =
      knowledgeConsole.value?.capabilities || options.consoleState.value?.knowledgeConsole?.capabilities;
    return {
      ...((capabilities?.modules || {}) as Record<string, Record<string, unknown>>),
      ...((capabilities?.protocolModules || {}) as Record<string, Record<string, unknown>>),
      ...((health?.modules || {}) as Record<string, Record<string, unknown>>),
      ...((health?.protocolModules || {}) as Record<string, Record<string, unknown>>),
    };
  });

  function knowledgeTabDisplayLabel(tab: { id: KnowledgeTab; label: string }) {
    return tab.label;
  }

  function knowledgeConfigGroupDescription(groupId: string) {
    switch (groupId) {
      case "retrieval":
        return "";
      case "learning":
        return "已接入反馈学习闭环，控制检索 profile 的候选生成、评估、灰度和自动发布边界。";
      case "maintenance":
        return "";
      case "embeddingModel":
        return "";
      default:
        return "服务端暴露的知识库配置组。";
    }
  }

  const knowledgeRecentJobs = computed(() => knowledgeConsole.value?.recentJobs || []);

  function maintenanceFieldValue(fieldName: string, fallback: unknown) {
    const value = readNestedValue(knowledgeMaintenanceDraft.value, fieldName);
    return value === undefined ? fallback : value;
  }

  function setMaintenanceFieldValue(fieldName: string, value: unknown) {
    knowledgeMaintenanceDraft.value = writeNestedValue(
      knowledgeMaintenanceDraft.value,
      fieldName,
      value,
    );
    maintenanceJson.value = jsonPreview(knowledgeMaintenanceDraft.value);
  }

  function setMaintenanceFieldFromEvent(
    fieldName: string,
    event: Event,
    valueType: "number" | "boolean" | "string",
  ) {
    const value = (event.target as HTMLInputElement | HTMLSelectElement).value;
    if (valueType === "number") {
      setMaintenanceFieldValue(fieldName, Number(value));
      return;
    }
    if (valueType === "boolean") {
      setMaintenanceFieldValue(fieldName, value === "true");
      return;
    }
    setMaintenanceFieldValue(fieldName, value);
  }

  async function refreshKnowledgeConsole(optionsOverride: { skipReviewItems?: boolean } = {}) {
    if (!options.hasScope("knowledge:read")) {
      return;
    }
    try {
      const [state, schema, maintenance, sources] = await Promise.all([
        getKnowledgeConsole(),
        getKnowledgeConfigSchema(),
        getKnowledgeMaintenance().catch(() => ({} as MaintenanceSettings)),
        getKnowledgeSources().catch(() => null),
      ]);
      knowledgeConsole.value = state;
      knowledgeSchema.value = schema;
      knowledgeSourceState.value = sources || state.sources || null;
      if (options.debugTab.value === "knowledgeRecall") {
        void options.refreshKnowledgeRecallBackendSpaces();
      }
      if (!optionsOverride.skipReviewItems) {
        await options.refreshKnowledgeConflicts({ silent: true, suppressError: true });
      }
      knowledgeMaintenanceDraft.value = maintenance || {};
      maintenanceJson.value = jsonPreview(knowledgeMaintenanceDraft.value);
    } catch (nextError) {
      options.error.value =
        nextError instanceof Error ? nextError.message : "加载知识库管控数据失败。";
    }
  }

  async function saveKnowledgeMaintenance() {
    options.setBusy("knowledge:maintenance");
    options.error.value = "";
    try {
      const parsed = JSON.parse(maintenanceJson.value || "{}") as MaintenanceSettings;
      knowledgeMaintenanceDraft.value = parsed;
      const result = await saveKnowledgeMaintenanceRequest(parsed);
      knowledgeMaintenanceDraft.value = result;
      maintenanceJson.value = jsonPreview(result);
      await refreshKnowledgeConsole();
    } catch (nextError) {
      options.error.value =
        nextError instanceof Error ? nextError.message : "保存知识库维护参数失败。";
    } finally {
      options.clearAllBusy();
    }
  }

  return {
    knowledgeConfigGroupDescription,
    knowledgeConsole,
    knowledgeMaintenanceDraft,
    knowledgeManagementPanelOptionBarOptions,
    knowledgeModules,
    knowledgeRecentJobs,
    knowledgeSchema,
    knowledgeSourceState,
    knowledgeStatus,
    knowledgeTabDisplayLabel,
    maintenanceFieldValue,
    maintenanceJson,
    readNestedValue,
    refreshKnowledgeConsole,
    saveKnowledgeMaintenance,
    selectKnowledgeManagementPanel,
    setMaintenanceFieldFromEvent,
    setMaintenanceFieldValue,
    writeNestedValue,
  };
}
