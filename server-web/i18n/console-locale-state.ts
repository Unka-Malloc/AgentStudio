import { readonly, ref } from "vue";

export type ConsoleLocale = "en" | "zh-CN";

export const CONSOLE_LANGUAGE_KEY = "pact-language";

const consoleLocaleState = ref<ConsoleLocale>("zh-CN");

export const currentConsoleLocale = readonly(consoleLocaleState);

export function setConsoleLocaleState(mode: ConsoleLocale) {
  consoleLocaleState.value = mode;
}

export const consoleLocales = [
  { value: "en", label: "English" },
  { value: "zh-CN", label: "简体中文" },
] as const;
