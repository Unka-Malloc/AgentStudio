// @vitest-environment jsdom
import { defineComponent, nextTick } from "vue";
import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  addKnowledgeWordBag,
  deleteKnowledgeWordBag,
  exportKnowledgeWordClouds,
  getKnowledgeWordBagTerms,
  getKnowledgeWordClouds,
  importKnowledgeWordClouds,
  proposeKnowledgeWordClouds,
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
  applyConsoleLanguageDocument: vi.fn(),
  applyConsoleThemeDocument: vi.fn(),
  persistConsoleLanguage: vi.fn(),
  persistConsoleTheme: vi.fn(),
  readStoredConsoleLanguage: vi.fn(),
  readStoredConsoleTheme: vi.fn(),
}));

const consoleDomLocalizerMock = vi.hoisted(() => ({
  disconnect: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("../../../server-web/lib/bridge-http", () => ({
  deleteJson: bridgeHttpMock.deleteJson,
  getJson: bridgeHttpMock.getJson,
  postJson: bridgeHttpMock.postJson,
}));

vi.mock("../../../server-web/composables/console-shell-preference-effects", () => ({
  applyConsoleLanguageDocument: preferenceEffectsMock.applyConsoleLanguageDocument,
  applyConsoleThemeDocument: preferenceEffectsMock.applyConsoleThemeDocument,
  persistConsoleLanguage: preferenceEffectsMock.persistConsoleLanguage,
  persistConsoleTheme: preferenceEffectsMock.persistConsoleTheme,
  readStoredConsoleLanguage: preferenceEffectsMock.readStoredConsoleLanguage,
  readStoredConsoleTheme: preferenceEffectsMock.readStoredConsoleTheme,
}));

vi.mock("../../../server-web/i18n/console-dom-localizer", () => ({
  installConsoleDomLocalizer: vi.fn(() => consoleDomLocalizerMock),
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
  bridgeHttpMock.deleteJson.mockResolvedValue({ ok: true });
  bridgeHttpMock.getJson.mockResolvedValue({ ok: true });
  bridgeHttpMock.postJson.mockResolvedValue({ ok: true });
  preferenceEffectsMock.readStoredConsoleTheme.mockReturnValue(null);
  preferenceEffectsMock.readStoredConsoleLanguage.mockReturnValue(null);
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
    await proposeKnowledgeWordClouds({ query: "risk" });
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
      "/api/knowledge/word-clouds/propose",
      { query: "risk" },
      { safetyConfirm: true },
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
    preferenceEffectsMock.readStoredConsoleTheme.mockReturnValue("dark");
    preferenceEffectsMock.readStoredConsoleLanguage.mockReturnValue("en");

    const { controller, wrapper } = mountPreferences();
    await nextTick();

    expect(controller.themeMode.value).toBe("dark");
    expect(controller.languageMode.value).toBe("en");
    expect(controller.languageOptionBarOptions.value).toEqual([
      { value: "en", label: "English" },
      { value: "zh-CN", label: "Simplified Chinese" },
    ]);
    expect(preferenceEffectsMock.applyConsoleThemeDocument).toHaveBeenCalledWith("dark");
    expect(preferenceEffectsMock.persistConsoleTheme).toHaveBeenCalledWith("dark");
    expect(preferenceEffectsMock.applyConsoleLanguageDocument).toHaveBeenCalledWith("en");
    expect(preferenceEffectsMock.persistConsoleLanguage).toHaveBeenCalledWith("en");

    wrapper.unmount();
    expect(consoleDomLocalizerMock.disconnect).toHaveBeenCalled();
  });

  it("cycles theme, normalizes language input, toggles locale, and refreshes localization", async () => {
    const { controller } = mountPreferences();
    await nextTick();

    controller.cycleTheme();
    expect(controller.themeMode.value).toBe("dark");
    controller.cycleTheme();
    expect(controller.themeMode.value).toBe("light");
    controller.applyTheme("system");
    expect(controller.themeMode.value).toBe("system");
    expect(preferenceEffectsMock.applyConsoleThemeDocument).toHaveBeenLastCalledWith("system");
    expect(preferenceEffectsMock.persistConsoleTheme).toHaveBeenLastCalledWith("system");

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
});
