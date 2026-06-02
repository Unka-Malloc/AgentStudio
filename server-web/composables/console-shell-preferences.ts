import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  consoleLocales,
  consoleMessages,
  localizeConsoleText,
  setConsoleLocaleState,
  type ConsoleLocale,
} from "../i18n/console";
import { installConsoleDomLocalizer, type ConsoleDomLocalizer } from "../i18n/console-dom-localizer";
import {
  applyConsoleLanguageDocument,
  applyConsoleThemeDocument,
  persistConsoleLanguage,
  persistConsoleTheme,
  readStoredConsoleLanguage,
  readStoredConsoleTheme,
  type ThemeMode,
} from "./console-shell-preference-effects";

export function useConsoleShellPreferences() {
  const themeMode = ref<ThemeMode>("system");
  const languageMode = ref<ConsoleLocale>("zh-CN");
  let consoleDomLocalizer: ConsoleDomLocalizer | null = null;

  const languageOptionBarOptions = computed(() =>
    consoleLocales.map((locale) => ({
      value: locale.value,
      label:
        languageMode.value === "en"
          ? locale.value === "en"
            ? "English"
            : "Simplified Chinese"
          : locale.label,
    })),
  );
  const msg = computed(() => consoleMessages[languageMode.value]);

  function applyTheme(mode: ThemeMode) {
    applyConsoleThemeDocument(mode);
    persistConsoleTheme(mode);
    themeMode.value = mode;
  }

  function cycleTheme() {
    const next: Record<ThemeMode, ThemeMode> = { system: "dark", dark: "light", light: "system" };
    applyTheme(next[themeMode.value]);
  }

  function applyLanguage(mode: ConsoleLocale) {
    applyConsoleLanguageDocument(mode);
    persistConsoleLanguage(mode);
    setConsoleLocaleState(mode);
    languageMode.value = mode;
    void nextTick(() => consoleDomLocalizer?.refresh());
  }

  function setLanguage(value: string | number | boolean) {
    applyLanguage(value === "en" ? "en" : "zh-CN");
  }

  function toggleLanguage() {
    applyLanguage(languageMode.value === "en" ? "zh-CN" : "en");
  }

  function tt(text: string) {
    return localizeConsoleText(text, languageMode.value);
  }

  onMounted(() => {
    const savedTheme = readStoredConsoleTheme();
    if (savedTheme) {
      applyTheme(savedTheme);
    }
    applyLanguage(readStoredConsoleLanguage() || languageMode.value);
    consoleDomLocalizer = installConsoleDomLocalizer(() => languageMode.value);
  });

  watch(languageMode, async () => {
    await nextTick();
    consoleDomLocalizer?.refresh();
  });

  onBeforeUnmount(() => {
    consoleDomLocalizer?.disconnect();
    consoleDomLocalizer = null;
  });

  return {
    themeMode,
    languageMode,
    languageOptionBarOptions,
    msg,
    applyTheme,
    cycleTheme,
    applyLanguage,
    setLanguage,
    toggleLanguage,
    tt,
  };
}
