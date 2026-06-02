import type { Ref } from "vue";
import { saveSettings as saveSettingsRequest } from "../lib/agent-settings-client";
import {
  reloadRuntimeMounts,
  saveRuntimeMounts,
} from "../lib/runtime-mounts-client";
import type {
  AgentModelConfig,
  AgentSettings,
  ModelProbeResponse,
} from "../lib/types";
import type { RefreshStateOptions } from "../types/app";
import { confirmConsoleAction } from "./console-browser-effects";
import { moduleNameLabels } from "./console-defaults";

type ModelLibraryProbeFailure = {
  entry: AgentModelConfig;
  result: ModelProbeResponse;
};

type ConsoleSettingsPersistenceControllerOptions = {
  agentPermissionGroups: () => AgentSettings["agentPermissionGroups"];
  clearAllBusy: () => void;
  ensureCodexOAuthReady: (startLogin?: boolean) => Promise<boolean>;
  error: Ref<string>;
  hasOpenAiModelUsage: () => boolean;
  modelEntryStatusKey: (entry: AgentModelConfig) => string;
  mountDraft: Ref<Record<string, string>>;
  mountDraftDirty: Ref<boolean>;
  probeModelLibraryBeforeSave: () => Promise<ModelLibraryProbeFailure[]>;
  refreshState: (options?: RefreshStateOptions) => Promise<unknown>;
  replaceSettingsDraftFromServer: (settings: AgentSettings, options?: { markClean?: boolean }) => void;
  setBusy: (key: string) => void;
  settingsDraft: Ref<AgentSettings>;
  settingsDraftDirty: Ref<boolean>;
  settingsPayloadForSave: () => AgentSettings;
};

export function createConsoleSettingsPersistenceController(
  options: ConsoleSettingsPersistenceControllerOptions,
) {
  async function saveModuleSettings() {
    options.setBusy("modules");
    options.error.value = "";

    try {
      if (
        options.hasOpenAiModelUsage() &&
        !(await options.ensureCodexOAuthReady(true))
      ) {
        options.error.value = "ChatGPT OAuth 还没有验证完成，验证完成后再保存模型设置。";
        options.clearAllBusy();
        return;
      }
      await saveSettingsRequest(options.settingsPayloadForSave());
      options.settingsDraftDirty.value = false;
      await saveRuntimeMounts({
        mountModules: options.mountDraft.value,
      });
      options.mountDraftDirty.value = false;
      await options.refreshState({ forceSettings: true, forceDrafts: false });
    } catch (nextError) {
      options.error.value =
        nextError instanceof Error ? nextError.message : "保存设置失败。";
      options.clearAllBusy();
    }
  }

  async function saveMountModules(busy = "mounts") {
    options.setBusy(busy);
    options.error.value = "";

    try {
      await saveRuntimeMounts({
        mountModules: options.mountDraft.value,
      });
      options.mountDraftDirty.value = false;
      await options.refreshState({ forceDrafts: false });
    } catch (nextError) {
      options.error.value =
        nextError instanceof Error ? nextError.message : "保存挂载模块失败。";
    } finally {
      options.clearAllBusy();
    }
  }

  async function reloadModules() {
    options.setBusy("module-reload");
    options.error.value = "";

    try {
      await reloadRuntimeMounts(options.settingsDraft.value);
      await options.refreshState({ forceDrafts: false });
    } catch (nextError) {
      options.error.value =
        nextError instanceof Error ? nextError.message : "重载智能能力失败。";
      options.clearAllBusy();
    }
  }

  async function enableMountModule(name: string) {
    if (!String(options.mountDraft.value[name] || "").trim()) {
      options.error.value = `请先填写 ${moduleNameLabels[name] || name} 的模块路径。`;
      return;
    }

    await saveMountModules(`mount:${name}`);
  }

  async function disableMountModule(name: string) {
    options.mountDraft.value = {
      ...options.mountDraft.value,
      [name]: "",
    };
    await saveMountModules(`mount:${name}`);
  }

  async function saveSettings() {
    options.setBusy("settings");
    options.error.value = "";

    try {
      await saveSettingsRequest(options.settingsPayloadForSave());
      options.settingsDraftDirty.value = false;
      await options.refreshState({ forceSettings: true, forceDrafts: false });
    } catch (nextError) {
      options.error.value =
        nextError instanceof Error ? nextError.message : "保存基础设置失败。";
      options.clearAllBusy();
    }
  }

  async function saveModelLibrarySettings() {
    options.setBusy("model-library-save");
    options.error.value = "";

    try {
      const failures = await options.probeModelLibraryBeforeSave();
      if (failures.length) {
        const details = failures
          .slice(0, 6)
          .map(({ entry, result }) => `- ${entry.label || options.modelEntryStatusKey(entry)}：${result.message || "探测失败"}`)
          .join("\n");
        const suffix = failures.length > 6 ? `\n- 另有 ${failures.length - 6} 个智能体未通过探测。` : "";
        const confirmed = confirmConsoleAction(
          `保存前探测发现 ${failures.length} 个智能体不可用：\n${details}${suffix}\n\n是否仍然保存这些配置？`,
        );
        if (!confirmed) {
          return;
        }
      }
      await saveSettingsRequest(options.settingsPayloadForSave());
      options.settingsDraftDirty.value = false;
      await options.refreshState({ forceSettings: true, forceDrafts: false });
    } catch (nextError) {
      options.error.value =
        nextError instanceof Error ? nextError.message : "保存模型库配置失败。";
    } finally {
      options.clearAllBusy();
    }
  }

  async function saveAgentPermissionSettings() {
    options.setBusy("agent-permissions-save");
    options.error.value = "";
    try {
      options.settingsDraft.value.agentPermissionGroups = options.agentPermissionGroups();
      const saved = await saveSettingsRequest(options.settingsPayloadForSave());
      options.replaceSettingsDraftFromServer(saved);
    } catch (nextError) {
      options.error.value =
        nextError instanceof Error ? nextError.message : "保存权限组失败。";
    } finally {
      options.clearAllBusy();
    }
  }

  return {
    disableMountModule,
    enableMountModule,
    reloadModules,
    saveAgentPermissionSettings,
    saveModelLibrarySettings,
    saveModuleSettings,
    saveMountModules,
    saveSettings,
  };
}
