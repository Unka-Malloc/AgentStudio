// @vitest-environment jsdom
import { defineComponent, nextTick } from "vue";
import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  addKnowledgeWordBag,
  deleteKnowledgeWordBag,
  exportKnowledgeWordClouds,
  getKnowledgeWordBagTerms,
  getKnowledgeWordClouds,
  importKnowledgeWordClouds,
  rebuildSourceVocabulary,
  saveKnowledgeWordClouds,
  updateKnowledgeWordBag,
} from "../../../server-web/lib/knowledge-word-cloud-client";
import { useConsoleShellPreferences } from "../../../server-web/composables/console-shell-preferences";

const bridgeHttpMock = vi.hoisted(() => ({
  deleteJson: vi.fn(),
  getJson: vi.fn(),
  postJson: vi.fn(),
}));

const preferenceEffectsMock = vi.hoisted(() => ({
  applyAppearancePresetDocument: vi.fn(),
  applyConsoleLanguageDocument: vi.fn(),
  persistAppearancePreset: vi.fn(),
  persistConsoleLanguage: vi.fn(),
  readStoredAppearancePreset: vi.fn(),
  readStoredConsoleLanguage: vi.fn(),
}));

const consoleDomLocalizerMock = vi.hoisted(() => ({
  disconnect: vi.fn(),
  getLocale: null as null | (() => string),
  refresh: vi.fn(),
}));

const appearancePresetConfigsMock = vi.hoisted(() => [
  {
    schemaVersion: "v0.0.1:schema:definition-1",
    id: "default-system",
    label: { en: "System Default", "zh-CN": "跟随系统" },
    mode: "system",
    lightPresetId: "geek-light-blue",
    darkPresetId: "sunset-ember",
  },
  {
    schemaVersion: "v0.0.1:schema:definition-1",
    id: "geek-light-blue",
    label: { en: "Geek Light Blue", "zh-CN": "极客浅蓝" },
    mode: "light",
    tokens: {
      "bg-base": "#f5f9ff",
      brand: "#2563eb",
      "brand-strong": "#1d4ed8",
    },
  },
  {
    schemaVersion: "v0.0.1:schema:definition-1",
    id: "catppuccin-latte",
    label: { en: "Catppuccin Latte", "zh-CN": "卡布奇诺拿铁" },
    mode: "light",
    tokens: {},
  },
  {
    schemaVersion: "v0.0.1:schema:definition-1",
    id: "github-light",
    label: { en: "GitHub Light", "zh-CN": "代码托管浅色" },
    mode: "light",
    tokens: {},
  },
  {
    schemaVersion: "v0.0.1:schema:definition-1",
    id: "one-light",
    label: { en: "One Light", "zh-CN": "原子浅色" },
    mode: "light",
    tokens: {},
  },
  {
    schemaVersion: "v0.0.1:schema:definition-1",
    id: "sunset-ember",
    label: { en: "Sunset Ember", "zh-CN": "落日余烬" },
    mode: "dark",
    tokens: {
      "bg-base": "#18181b",
      brand: "#f97316",
      "brand-strong": "#fb923c",
    },
  },
  {
    schemaVersion: "v0.0.1:schema:definition-1",
    id: "tokyo-night",
    label: { en: "Tokyo Night", "zh-CN": "东京之夜" },
    mode: "dark",
    tokens: {},
  },
  {
    schemaVersion: "v0.0.1:schema:definition-1",
    id: "cappuccino-dark",
    label: { en: "Catppuccin Mocha", "zh-CN": "卡布奇诺" },
    mode: "dark",
    tokens: {},
  },
  {
    schemaVersion: "v0.0.1:schema:definition-1",
    id: "gruvbox-dark",
    label: { en: "Gruvbox Dark", "zh-CN": "复古唱片" },
    mode: "dark",
    tokens: {},
  },
  {
    schemaVersion: "v0.0.1:schema:definition-1",
    id: "dracula",
    label: { en: "Dracula", "zh-CN": "盛夜古堡" },
    mode: "dark",
    tokens: {},
  },
  {
    schemaVersion: "v0.0.1:schema:definition-1",
    id: "nord",
    label: { en: "Nord", "zh-CN": "诺德风格" },
    mode: "dark",
    tokens: {},
  },
  {
    schemaVersion: "v0.0.1:schema:definition-1",
    id: "monokai",
    label: { en: "Monokai", "zh-CN": "绿野仙踪" },
    mode: "dark",
    tokens: {},
  },
  {
    schemaVersion: "v0.0.1:schema:definition-1",
    id: "cyberpunk",
    label: { en: "Cyberpunk", "zh-CN": "赛博朋克" },
    mode: "dark",
    tokens: {},
  },
]);

vi.mock("../../../server-web/lib/bridge-http", () => ({
  deleteJson: bridgeHttpMock.deleteJson,
  getJson: bridgeHttpMock.getJson,
  postJson: bridgeHttpMock.postJson,
}));

vi.mock("../../../server-web/composables/console-shell-preference-effects", () => ({
  applyAppearancePresetDocument: preferenceEffectsMock.applyAppearancePresetDocument,
  applyConsoleLanguageDocument: preferenceEffectsMock.applyConsoleLanguageDocument,
  normalizeAppearancePresetId: (value: unknown) =>
    appearancePresetConfigsMock.some((config) => config.id === value)
      ? value
      : "default-system",
  persistAppearancePreset: preferenceEffectsMock.persistAppearancePreset,
  persistConsoleLanguage: preferenceEffectsMock.persistConsoleLanguage,
  readAvailableAppearancePresetConfigs: vi.fn(() => appearancePresetConfigsMock),
  refreshAvailableAppearancePresetConfigs: vi.fn(async () => appearancePresetConfigsMock),
  readStoredAppearancePreset: preferenceEffectsMock.readStoredAppearancePreset,
  readStoredConsoleLanguage: preferenceEffectsMock.readStoredConsoleLanguage,
  setServerAppearancePresetConfigs: vi.fn((configs: unknown[]) =>
    configs.length > 0 ? configs : appearancePresetConfigsMock,
  ),
  subscribeAppearancePresetCatalogChanges: vi.fn(() => vi.fn()),
}));

vi.mock("../../../server-web/i18n/console-dom-localizer", () => ({
  installConsoleDomLocalizer: vi.fn((getLocale: () => string) => {
    consoleDomLocalizerMock.getLocale = getLocale;
    return consoleDomLocalizerMock;
  }),
}));

function mountPreferences() {
  let exposed: ReturnType<typeof useConsoleShellPreferences> | null = null;
  const wrapper = mount(defineComponent({
    setup() {
      exposed = useConsoleShellPreferences();
      return () => null;
    },
  }));
  return {
    controller: exposed!,
    wrapper,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  consoleDomLocalizerMock.getLocale = null;
  bridgeHttpMock.deleteJson.mockResolvedValue({ ok: true });
  bridgeHttpMock.getJson.mockResolvedValue({ ok: true });
  bridgeHttpMock.postJson.mockResolvedValue({ ok: true });
  preferenceEffectsMock.readStoredAppearancePreset.mockReturnValue(null);
  preferenceEffectsMock.readStoredConsoleLanguage.mockReturnValue(null);
});

afterEach(() => {
  document.documentElement.lang = "";
});

describe("knowledge-word-cloud-client", () => {
  it("builds query strings and skips blank corpus paths", async () => {
    await getKnowledgeWordClouds({
      wordBagSetId: "set 1",
      wordBagId: "bag/1",
      limit: 25,
      minFrequency: 2,
      query: "risk term",
      corpusPaths: [
        { type: "source", path: " alpha " } as any,
        { type: "source", path: "" } as any,
        { type: "workspace", path: "beta/path" } as any,
      ],
    });
    await getKnowledgeWordClouds();

    expect(bridgeHttpMock.getJson).toHaveBeenCalledWith(
      "/api/knowledge/word-clouds?wordBagSetId=set+1&wordBagId=bag%2F1&limit=25&minFrequency=2&query=risk+term&corpusPath=source%3Aalpha&corpusPath=workspace%3Abeta%2Fpath",
    );
    expect(bridgeHttpMock.getJson).toHaveBeenCalledWith("/api/knowledge/word-clouds");
  });

  it("sends mutations to the correct endpoints with safety confirmation", async () => {
    await saveKnowledgeWordClouds({ wordBagSet: { id: "set-1" } as any });
    await exportKnowledgeWordClouds({ wordBagSetId: "set-1" });
    await importKnowledgeWordClouds({ importPayload: { ok: true }, mode: "copy" });
    await addKnowledgeWordBag({
      wordBagSetId: "set-1",
      parentWordBagId: "parent-1",
      wordBag: { id: "bag-1" } as any,
    });
    await updateKnowledgeWordBag("bag A/1", {
      wordBagSetId: "set-1",
      patch: { label: "Updated" } as any,
    });
    await deleteKnowledgeWordBag("bag A/1", { wordBagSetId: "set 1" });
    await getKnowledgeWordBagTerms({
      wordBagSetId: "set-1",
      wordBagIds: ["bag-1"],
      includeChildren: true,
    });
    await rebuildSourceVocabulary();
    await rebuildSourceVocabulary({ confirm: false, dryRun: true });

    expect(bridgeHttpMock.postJson).toHaveBeenCalledWith(
      "/api/knowledge/word-clouds",
      { wordBagSet: { id: "set-1" } },
      { safetyConfirm: true },
    );
    expect(bridgeHttpMock.postJson).toHaveBeenCalledWith(
      "/api/knowledge/word-clouds/export",
      { wordBagSetId: "set-1" },
    );
    expect(bridgeHttpMock.postJson).toHaveBeenCalledWith(
      "/api/knowledge/word-clouds/import",
      { importPayload: { ok: true }, mode: "copy" },
      { safetyConfirm: true },
    );
    expect(bridgeHttpMock.postJson).toHaveBeenCalledWith(
      "/api/knowledge/word-clouds/word-bags",
      {
        wordBagSetId: "set-1",
        parentWordBagId: "parent-1",
        wordBag: { id: "bag-1" },
      },
      { safetyConfirm: true },
    );
    expect(bridgeHttpMock.postJson).toHaveBeenCalledWith(
      "/api/knowledge/word-clouds/word-bags/bag%20A%2F1",
      { wordBagSetId: "set-1", patch: { label: "Updated" } },
      { safetyConfirm: true },
    );
    expect(bridgeHttpMock.deleteJson).toHaveBeenCalledWith(
      "/api/knowledge/word-clouds/word-bags/bag%20A%2F1?wordBagSetId=set+1",
      { safetyConfirm: true },
    );
    expect(bridgeHttpMock.postJson).toHaveBeenCalledWith(
      "/api/knowledge/word-clouds/word-bags/terms",
      { wordBagSetId: "set-1", wordBagIds: ["bag-1"], includeChildren: true },
    );
    expect(bridgeHttpMock.postJson).toHaveBeenCalledWith(
      "/api/storage/source-vocabulary/rebuild",
      { confirm: true },
      { safetyConfirm: true },
    );
    expect(bridgeHttpMock.postJson).toHaveBeenCalledWith(
      "/api/storage/source-vocabulary/rebuild",
      { confirm: false, dryRun: true },
      { safetyConfirm: true },
    );
  });
});

describe("useConsoleShellPreferences", () => {
  it("initializes from stored values and exposes localized language options", async () => {
    preferenceEffectsMock.readStoredAppearancePreset.mockReturnValue("sunset-ember");
    preferenceEffectsMock.readStoredConsoleLanguage.mockReturnValue("en");

    const { controller, wrapper } = mountPreferences();
    await nextTick();

    expect(controller.appearancePresetId.value).toBe("sunset-ember");
    expect(controller.appearanceCycleScheme.value).toBe("dark");
    expect(controller.languageMode.value).toBe("en");
    expect(controller.languageOptionBarOptions.value).toEqual([
      { value: "en", label: "English" },
      { value: "zh-CN", label: "Simplified Chinese" },
    ]);
    expect(controller.appearanceCycleSchemeOptions.value).toEqual([
      { value: "dark", label: "Dark", icon: "moon" },
      { value: "light", label: "Light", icon: "sun" },
    ]);
    expect(preferenceEffectsMock.applyAppearancePresetDocument).toHaveBeenCalledWith(
      "sunset-ember",
      expect.any(Array),
    );
    expect(preferenceEffectsMock.persistAppearancePreset).toHaveBeenCalledWith("sunset-ember");
    expect(preferenceEffectsMock.applyConsoleLanguageDocument).toHaveBeenCalledWith("en");
    expect(preferenceEffectsMock.persistConsoleLanguage).toHaveBeenCalledWith("en");

    wrapper.unmount();
    expect(consoleDomLocalizerMock.disconnect).toHaveBeenCalled();
  });

  it("cycles appearance preset, normalizes language input, toggles locale, and refreshes localization", async () => {
    const { controller } = mountPreferences();
    await nextTick();

    controller.cycleAppearancePreset();
    expect(controller.appearancePresetId.value).toBe("geek-light-blue");
    controller.cycleAppearancePreset();
    expect(controller.appearancePresetId.value).toBe("catppuccin-latte");
    expect(controller.appearanceCycleScheme.value).toBe("light");
    expect(controller.appearancePresetOptionsForCycleScheme.value.map((option) => option.value)).toEqual([
      "geek-light-blue",
      "catppuccin-latte",
      "github-light",
      "one-light",
    ]);
    expect(controller.appearancePresetOptionsForCycleScheme.value[0].swatches).toEqual([
      "#f5f9ff",
      "#2563eb",
      "#1d4ed8",
    ]);

    controller.toggleAppearanceCycleScheme();
    expect(controller.appearancePresetId.value).toBe("sunset-ember");
    expect(controller.appearanceCycleScheme.value).toBe("dark");
    expect(controller.appearancePresetOptionsForCycleScheme.value.map((option) => option.value)).toEqual([
      "sunset-ember",
      "tokyo-night",
      "cappuccino-dark",
      "gruvbox-dark",
      "dracula",
      "nord",
      "monokai",
      "cyberpunk",
    ]);
    controller.cycleAppearancePreset();
    expect(controller.appearancePresetId.value).toBe("tokyo-night");
    controller.setAppearancePreset("cappuccino-dark");
    expect(controller.appearancePresetId.value).toBe("cappuccino-dark");
    expect(controller.appearanceCycleScheme.value).toBe("dark");
    expect(preferenceEffectsMock.applyAppearancePresetDocument).toHaveBeenLastCalledWith(
      "cappuccino-dark",
      expect.any(Array),
    );
    expect(preferenceEffectsMock.persistAppearancePreset).toHaveBeenLastCalledWith("cappuccino-dark");
    controller.setAppearanceCycleScheme("light");
    expect(controller.appearancePresetId.value).toBe("catppuccin-latte");
    expect(controller.appearancePresetSelectionId.value).toBe("catppuccin-latte");

    controller.setLanguage("en");
    await nextTick();
    expect(controller.languageMode.value).toBe("en");
    expect(controller.tt("配置")).toBe("Settings");

    controller.setLanguage(true);
    await nextTick();
    expect(controller.languageMode.value).toBe("zh-CN");

    controller.toggleLanguage();
    await nextTick();
    expect(controller.languageMode.value).toBe("en");
    expect(consoleDomLocalizerMock.refresh).toHaveBeenCalled();
  });

  it("uses the effective document locale for fallback localization", async () => {
    document.documentElement.lang = "en";

    const { controller, wrapper } = mountPreferences();
    await nextTick();

    expect(controller.languageMode.value).toBe("zh-CN");
    expect(consoleDomLocalizerMock.getLocale?.()).toBe("en");
    expect(controller.tt("需求")).toBe("Requirement");

    wrapper.unmount();
  });

  it("imports appearance preset files through the server catalog", async () => {
    const { controller } = mountPreferences();
    await nextTick();

    await controller.importAppearancePresetFileToServer(
      new File([JSON.stringify({ id: "agent-preview" })], "agent-preview.json", {
        type: "application/json",
      }),
    );

    expect(bridgeHttpMock.postJson).toHaveBeenCalledWith(
      "/api/appearance-presets/import",
      { text: JSON.stringify({ id: "agent-preview" }) },
      { safetyConfirm: true },
    );
    expect(controller.appearancePresetImporting.value).toBe(false);
    expect(controller.appearancePresetCatalogMessage.value).toContain("preset files loaded");
  });
});
