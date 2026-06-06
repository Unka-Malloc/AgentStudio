import {
  CONSOLE_LANGUAGE_KEY,
  consoleMessages,
  type ConsoleLocale,
} from "../i18n/console";
import {
  readBrowserLocalStorageItem,
  writeBrowserLocalStorageItem,
} from "../lib/browser-window";

export type ThemeMode = "system" | "dark" | "light";

const THEME_KEY = "pact-theme";
const LANGUAGE_KEY = CONSOLE_LANGUAGE_KEY;

function browserDocument() {
  return typeof document === "undefined" ? null : document;
}

function readStorageValue(key: string) {
  try {
    return readBrowserLocalStorageItem(key);
  } catch (e) {
    return null;
  }
}

function writeStorageValue(key: string, value: string) {
  try {
    writeBrowserLocalStorageItem(key, value);
  } catch (e) {}
}

export function readStoredConsoleTheme(): ThemeMode | null {
  const saved = readStorageValue(THEME_KEY);
  return saved === "dark" || saved === "light" ? saved : null;
}

export function persistConsoleTheme(mode: ThemeMode) {
  writeStorageValue(THEME_KEY, mode);
}

export function applyConsoleThemeDocument(mode: ThemeMode) {
  const html = browserDocument()?.documentElement;
  if (!html) {
    return;
  }
  html.classList.remove("theme-dark", "theme-light");
  if (mode === "dark") {
    html.classList.add("theme-dark");
  }
  if (mode === "light") {
    html.classList.add("theme-light");
  }
}

export function readStoredConsoleLanguage(): ConsoleLocale | null {
  const saved = readStorageValue(LANGUAGE_KEY);
  return saved === "en" || saved === "zh-CN" ? saved : null;
}

export function persistConsoleLanguage(mode: ConsoleLocale) {
  writeStorageValue(LANGUAGE_KEY, mode);
}

export function applyConsoleLanguageDocument(mode: ConsoleLocale) {
  const doc = browserDocument();
  if (!doc) {
    return;
  }
  doc.documentElement.lang = mode === "en" ? "en" : "zh-CN";
  doc.title = consoleMessages[mode].appTitle;
}
