import { beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { createConsoleSettingsPersistenceController } from "../../../server-web/composables/console-settings-persistence-controller";

const agentSettingsClientMock = vi.hoisted(() => ({
  saveSettings: vi.fn(),
}));

const runtimeMountsClientMock = vi.hoisted(() => ({
  reloadRuntimeMounts: vi.fn(),
  saveRuntimeMounts: vi.fn(),
}));

const browserEffectsMock = vi.hoisted(() => ({
  confirmConsoleAction: vi.fn(),
}));

vi.mock("../../../server-web/lib/agent-settings-client", () => ({
  saveSettings: agentSettingsClientMock.saveSettings,
}));

vi.mock("../../../server-web/lib/runtime-mounts-client", () => ({
  reloadRuntimeMounts: runtimeMountsClientMock.reloadRuntimeMounts,
  saveRuntimeMounts: runtimeMountsClientMock.saveRuntimeMounts,
}));

vi.mock("../../../server-web/composables/console-browser-effects", () => ({
  confirmConsoleAction: browserEffectsMock.confirmConsoleAction,
}));

function createFixture(overrides: Record<string, any> = {}) {
  const error = ref("");
  const settingsDraft = ref<any>({
    agentPermissionGroups: [{ id: "old" }],
    models: [],
  });
  const settingsDraftDirty = ref(true);
  const mountDraft = ref<Record<string, string>>({
    documentParser: "/opt/parser.mjs",
  });
  const mountDraftDirty = ref(true);
  const savedPayload = { models: [{ id: "model-1" }] } as any;
  const options = {
    agentPermissionGroups: vi.fn(() => [{ id: "group-1" }]),
    clearAllBusy: vi.fn(),
    ensureCodexOAuthReady: vi.fn().mockResolvedValue(true),
    error,
    hasOpenAiModelUsage: vi.fn(() => false),
    modelEntryStatusKey: vi.fn((entry: any) => entry.id || "entry-key"),
    mountDraft,
    mountDraftDirty,
    probeModelLibraryBeforeSave: vi.fn().mockResolvedValue([]),
    refreshState: vi.fn().mockResolvedValue(undefined),
    replaceSettingsDraftFromServer: vi.fn(),
    setBusy: vi.fn(),
    settingsDraft,
    settingsDraftDirty,
    settingsPayloadForSave: vi.fn(() => savedPayload),
    ...overrides,
  };
  const controller = createConsoleSettingsPersistenceController(options);
  return {
    controller,
    error,
    mountDraft,
    mountDraftDirty,
    options,
    savedPayload,
    settingsDraft,
    settingsDraftDirty,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  agentSettingsClientMock.saveSettings.mockResolvedValue({ saved: true });
  runtimeMountsClientMock.reloadRuntimeMounts.mockResolvedValue({ ok: true });
  runtimeMountsClientMock.saveRuntimeMounts.mockResolvedValue({ ok: true });
  browserEffectsMock.confirmConsoleAction.mockReturnValue(true);
});

describe("console settings persistence controller", () => {
  it("saves module settings after OAuth readiness and persists runtime mounts", async () => {
    const { controller, mountDraft, mountDraftDirty, options, savedPayload, settingsDraftDirty } = createFixture({
      hasOpenAiModelUsage: vi.fn(() => true),
    });

    await controller.saveModuleSettings();

    expect(options.setBusy).toHaveBeenCalledWith("modules");
    expect(options.ensureCodexOAuthReady).toHaveBeenCalledWith(true);
    expect(agentSettingsClientMock.saveSettings).toHaveBeenCalledWith(savedPayload);
    expect(settingsDraftDirty.value).toBe(false);
    expect(runtimeMountsClientMock.saveRuntimeMounts).toHaveBeenCalledWith({
      mountModules: mountDraft.value,
    });
    expect(mountDraftDirty.value).toBe(false);
    expect(options.refreshState).toHaveBeenCalledWith({
      forceSettings: true,
      forceDrafts: false,
    });
    expect(options.clearAllBusy).not.toHaveBeenCalled();
  });

  it("blocks module save when OAuth is not ready and clears busy", async () => {
    const { controller, error, options } = createFixture({
      ensureCodexOAuthReady: vi.fn().mockResolvedValue(false),
      hasOpenAiModelUsage: vi.fn(() => true),
    });

    await controller.saveModuleSettings();

    expect(agentSettingsClientMock.saveSettings).not.toHaveBeenCalled();
    expect(runtimeMountsClientMock.saveRuntimeMounts).not.toHaveBeenCalled();
    expect(error.value).toBe("ChatGPT OAuth 还没有验证完成，验证完成后再保存模型设置。");
    expect(options.clearAllBusy).toHaveBeenCalledTimes(1);
  });

  it("saves, enables, disables and reloads mount modules with error handling", async () => {
    const { controller, error, mountDraft, mountDraftDirty, options, settingsDraft } = createFixture();

    await controller.saveMountModules("custom-busy");

    expect(options.setBusy).toHaveBeenCalledWith("custom-busy");
    expect(runtimeMountsClientMock.saveRuntimeMounts).toHaveBeenCalledWith({
      mountModules: mountDraft.value,
    });
    expect(mountDraftDirty.value).toBe(false);
    expect(options.refreshState).toHaveBeenCalledWith({ forceDrafts: false });
    expect(options.clearAllBusy).toHaveBeenCalledTimes(1);

    mountDraft.value.custom = "";
    await controller.enableMountModule("custom");
    expect(error.value).toBe("请先填写 custom 的模块路径。");

    error.value = "";
    mountDraft.value.custom = "/tmp/custom.mjs";
    await controller.enableMountModule("custom");
    expect(options.setBusy).toHaveBeenCalledWith("mount:custom");

    await controller.disableMountModule("custom");
    expect(mountDraft.value.custom).toBe("");
    expect(runtimeMountsClientMock.saveRuntimeMounts).toHaveBeenCalledTimes(3);

    await controller.reloadModules();
    expect(runtimeMountsClientMock.reloadRuntimeMounts).toHaveBeenCalledWith(settingsDraft.value);
    expect(options.refreshState).toHaveBeenCalledWith({ forceDrafts: false });

    runtimeMountsClientMock.reloadRuntimeMounts.mockRejectedValueOnce(new Error("reload failed"));
    await controller.reloadModules();
    expect(error.value).toBe("reload failed");
    expect(options.clearAllBusy).toHaveBeenCalled();
  });

  it("surfaces save errors with fallback messages", async () => {
    const { controller, error, options } = createFixture();

    agentSettingsClientMock.saveSettings.mockRejectedValueOnce("bad settings");
    await controller.saveSettings();

    expect(options.setBusy).toHaveBeenCalledWith("settings");
    expect(error.value).toBe("保存基础设置失败。");
    expect(options.clearAllBusy).toHaveBeenCalledTimes(1);

    agentSettingsClientMock.saveSettings.mockResolvedValueOnce({ ok: true });
    await controller.saveSettings();
    expect(options.refreshState).toHaveBeenCalledWith({
      forceSettings: true,
      forceDrafts: false,
    });
  });

  it("confirms model library probe failures before saving", async () => {
    const failures = Array.from({ length: 7 }, (_, index) => ({
      entry: { id: `agent-${index + 1}`, label: index === 0 ? "主模型" : "" },
      result: { ok: false, message: `探测失败 ${index + 1}` },
    }));
    const { controller, options, settingsDraftDirty } = createFixture({
      probeModelLibraryBeforeSave: vi.fn().mockResolvedValue(failures),
    });

    browserEffectsMock.confirmConsoleAction.mockReturnValueOnce(false);
    await controller.saveModelLibrarySettings();

    expect(browserEffectsMock.confirmConsoleAction).toHaveBeenCalledWith(expect.stringContaining("另有 1 个智能体未通过探测"));
    expect(agentSettingsClientMock.saveSettings).not.toHaveBeenCalled();
    expect(options.clearAllBusy).toHaveBeenCalledTimes(1);

    browserEffectsMock.confirmConsoleAction.mockReturnValueOnce(true);
    await controller.saveModelLibrarySettings();

    expect(agentSettingsClientMock.saveSettings).toHaveBeenCalledTimes(1);
    expect(settingsDraftDirty.value).toBe(false);
    expect(options.refreshState).toHaveBeenCalledWith({
      forceSettings: true,
      forceDrafts: false,
    });
  });

  it("saves agent permission groups and replaces the draft from the server", async () => {
    const saved = { agentPermissionGroups: [{ id: "saved" }] };
    agentSettingsClientMock.saveSettings.mockResolvedValueOnce(saved);
    const { controller, options, settingsDraft } = createFixture();

    await controller.saveAgentPermissionSettings();

    expect(options.setBusy).toHaveBeenCalledWith("agent-permissions-save");
    expect(settingsDraft.value.agentPermissionGroups).toEqual([{ id: "group-1" }]);
    expect(agentSettingsClientMock.saveSettings).toHaveBeenCalled();
    expect(options.replaceSettingsDraftFromServer).toHaveBeenCalledWith(saved);
    expect(options.clearAllBusy).toHaveBeenCalledTimes(1);

    agentSettingsClientMock.saveSettings.mockRejectedValueOnce(new Error("permission save failed"));
    await controller.saveAgentPermissionSettings();
    expect(options.error.value).toBe("permission save failed");
  });
});
