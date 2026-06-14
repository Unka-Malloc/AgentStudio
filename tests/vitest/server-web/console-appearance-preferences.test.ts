// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

import {
  applyAppearancePresetDocument,
  refreshAvailableAppearancePresetConfigs,
  readStoredAppearancePreset,
  readAvailableAppearancePresetConfigs,
  setServerAppearancePresetConfigs,
} from "../../../server-web/composables/console-shell-preference-effects";
import type { AppearancePresetConfig } from "../../../server-web/lib/appearance-preset-config";

describe("console appearance preferences", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-appearance-preset");
    document.documentElement.classList.remove("theme-dark", "theme-light");
  });

  it("migrates legacy pact-theme values into appearance presets", () => {
    window.localStorage.setItem("pact-theme", "system");
    expect(readStoredAppearancePreset()).toBe("default-system");
    expect(window.localStorage.getItem("pact-appearance-preset")).toBe("default-system");

    window.localStorage.clear();
    window.localStorage.setItem("pact-theme", "light");
    expect(readStoredAppearancePreset()).toBe("geek-light-blue");
    expect(window.localStorage.getItem("pact-appearance-preset")).toBe("geek-light-blue");

    window.localStorage.clear();
    window.localStorage.setItem("pact-theme", "dark");
    expect(readStoredAppearancePreset()).toBe("sunset-ember");
    expect(window.localStorage.getItem("pact-appearance-preset")).toBe("sunset-ember");
  });

  it("migrates stored legacy appearance preset ids into the current built-ins", () => {
    window.localStorage.setItem("pact-appearance-preset", "catppuccin-mocha");

    expect(readStoredAppearancePreset()).toBe("cappuccino-dark");
    expect(window.localStorage.getItem("pact-appearance-preset")).toBe("cappuccino-dark");
  });

  it("applies the active preset through the document dataset", () => {
    document.documentElement.classList.add("theme-dark", "theme-light");

    applyAppearancePresetDocument("sunset-ember");

    expect(document.documentElement.dataset.appearancePreset).toBe("sunset-ember");
    expect(document.documentElement.dataset.appearanceColorScheme).toBe("dark");
    expect(document.documentElement.style.getPropertyValue("--brand")).toBe("#f97316");
    expect(document.documentElement.classList.contains("theme-dark")).toBe(false);
    expect(document.documentElement.classList.contains("theme-light")).toBe(false);
  });

  it("refreshes the Vue/Vite preset file catalog", async () => {
    const configs = await refreshAvailableAppearancePresetConfigs();
    const ids = configs.map((config) => config.id);

    expect(ids).toContain("geek-light-blue");
    expect(ids).toContain("catppuccin-latte");
    expect(ids).toContain("github-light");
    expect(ids).toContain("one-light");
    expect(ids).toContain("dracula");
    expect(ids).toContain("nord");
    expect(ids).toContain("gruvbox-dark");
    expect(ids).toContain("tokyo-night");
  });

  it("keeps bundled dark presets in the Chinese console order", async () => {
    await refreshAvailableAppearancePresetConfigs();
    const configs = setServerAppearancePresetConfigs([]);
    const darkPresets = configs
      .filter((config) => config.mode === "dark")
      .map((config) => [config.id, config.label["zh-CN"]]);

    expect(darkPresets).toEqual([
      ["sunset-ember", "落日余烬"],
      ["tokyo-night", "东京之夜"],
      ["cappuccino-dark", "卡布奇诺"],
      ["gruvbox-dark", "复古唱片"],
      ["dracula", "盛夜古堡"],
      ["nord", "诺德风格"],
      ["monokai", "绿野仙踪"],
      ["cyberpunk", "赛博朋克"],
    ]);
  });

  it("merges server-imported preset configs with bundled preset files", () => {
    const configs = setServerAppearancePresetConfigs([
      {
        schemaVersion: "v0.0.1:schema:definition-1",
        id: "agent-preview",
        label: { en: "Agent Preview", "zh-CN": "智能体预览" },
        mode: "light",
        tokens: {
          "bg-base": "#fefce8",
          "bg-surface": "#ffffff",
          "bg-subtle": "#fef9c3",
          "text-primary": "#1f2937",
          "text-muted": "#854d0e",
          "text-on-brand": "#111827",
          "brand": "#eab308",
          "brand-strong": "#ca8a04",
          "brand-subtle": "#fef3c7",
          "success": "#15803d",
          "warning": "#b45309",
          "danger": "#b91c1c"
        },
      },
    ]);

    expect(configs.map((config) => config.id)).toContain("geek-light-blue");
    expect(readAvailableAppearancePresetConfigs().map((config) => config.id)).toContain("agent-preview");
  });

  it("applies a framework-provided custom preset config immediately", () => {
    const customConfig: AppearancePresetConfig = {
      schemaVersion: "v0.0.1:schema:definition-1",
      id: "agent-preview",
      label: { en: "Agent Preview", "zh-CN": "智能体预览" },
      mode: "light",
      tokens: {
        "bg-base": "#fefce8",
        "bg-surface": "#ffffff",
        "bg-subtle": "#fef9c3",
        "text-primary": "#1f2937",
        "text-muted": "#854d0e",
        "text-on-brand": "#111827",
        "brand": "#eab308",
        "brand-strong": "#ca8a04",
        "brand-subtle": "#fef3c7",
        "success": "#15803d",
        "warning": "#b45309",
        "danger": "#b91c1c"
      },
    };

    applyAppearancePresetDocument("agent-preview", [customConfig]);

    expect(document.documentElement.dataset.appearancePreset).toBe("agent-preview");
    expect(document.documentElement.style.getPropertyValue("--brand")).toBe("#eab308");
  });
});
