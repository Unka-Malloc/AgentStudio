// @vitest-environment jsdom
import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  applyConsoleLanguageDocument,
  applyConsoleThemeDocument,
  persistConsoleLanguage,
  persistConsoleTheme,
  readStoredConsoleLanguage,
  readStoredConsoleTheme,
} from "../../../server-web/composables/console-shell-preference-effects";
import { consoleMessages } from "../../../server-web/i18n/console";

const browserWindowMock = vi.hoisted(() => ({
  readBrowserLocalStorageItem: vi.fn(),
  writeBrowserLocalStorageItem: vi.fn(),
}));

vi.mock("../../../server-web/lib/browser-window", () => ({
  readBrowserLocalStorageItem: browserWindowMock.readBrowserLocalStorageItem,
  writeBrowserLocalStorageItem: browserWindowMock.writeBrowserLocalStorageItem,
}));

describe("console shell preference effects extra coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.documentElement.className = "";
    document.documentElement.lang = "";
    document.title = "";
  });

  it("reads only supported stored theme and language values", () => {
    browserWindowMock.readBrowserLocalStorageItem.mockReturnValueOnce("dark");
    expect(readStoredConsoleTheme()).toBe("dark");

    browserWindowMock.readBrowserLocalStorageItem.mockReturnValueOnce("light");
    expect(readStoredConsoleTheme()).toBe("light");

    browserWindowMock.readBrowserLocalStorageItem.mockReturnValueOnce("system");
    expect(readStoredConsoleTheme()).toBeNull();

    browserWindowMock.readBrowserLocalStorageItem.mockReturnValueOnce("en");
    expect(readStoredConsoleLanguage()).toBe("en");

    browserWindowMock.readBrowserLocalStorageItem.mockReturnValueOnce("zh-CN");
    expect(readStoredConsoleLanguage()).toBe("zh-CN");

    browserWindowMock.readBrowserLocalStorageItem.mockReturnValueOnce("fr");
    expect(readStoredConsoleLanguage()).toBeNull();
  });

  it("returns null when storage reads throw and swallows write failures", () => {
    browserWindowMock.readBrowserLocalStorageItem.mockImplementation(() => {
      throw new Error("storage blocked");
    });
    browserWindowMock.writeBrowserLocalStorageItem.mockImplementation(() => {
      throw new Error("storage blocked");
    });

    expect(readStoredConsoleTheme()).toBeNull();
    expect(readStoredConsoleLanguage()).toBeNull();
    expect(() => persistConsoleTheme("dark")).not.toThrow();
    expect(() => persistConsoleLanguage("en")).not.toThrow();
  });

  it("persists preferences using stable storage keys", () => {
    persistConsoleTheme("light");
    persistConsoleLanguage("zh-CN");

    expect(browserWindowMock.writeBrowserLocalStorageItem).toHaveBeenCalledWith("pact-theme", "light");
    expect(browserWindowMock.writeBrowserLocalStorageItem).toHaveBeenCalledWith("pact-language", "zh-CN");
  });

  it("applies theme classes exclusively and clears classes for system mode", () => {
    applyConsoleThemeDocument("dark");
    expect(document.documentElement.classList.contains("theme-dark")).toBe(true);
    expect(document.documentElement.classList.contains("theme-light")).toBe(false);

    applyConsoleThemeDocument("light");
    expect(document.documentElement.classList.contains("theme-dark")).toBe(false);
    expect(document.documentElement.classList.contains("theme-light")).toBe(true);

    applyConsoleThemeDocument("system");
    expect(document.documentElement.classList.contains("theme-dark")).toBe(false);
    expect(document.documentElement.classList.contains("theme-light")).toBe(false);
  });

  it("applies document language and localized title", () => {
    applyConsoleLanguageDocument("en");
    expect(document.documentElement.lang).toBe("en");
    expect(document.title).toBe(consoleMessages.en.appTitle);

    applyConsoleLanguageDocument("zh-CN");
    expect(document.documentElement.lang).toBe("zh-CN");
    expect(document.title).toBe(consoleMessages["zh-CN"].appTitle);
  });
});
