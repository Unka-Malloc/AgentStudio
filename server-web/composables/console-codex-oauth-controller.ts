import { ref, type Ref } from "vue";
import { openBrowserPopup } from "../lib/browser-window";
import {
  getCodexOAuthStatus,
  startCodexOAuthLogin,
} from "../lib/codex-oauth-client";
import type { CodexOAuthLogin, CodexOAuthStatus } from "../lib/types";
import { createConsoleIntervalController } from "./console-timer-controller";

const CODEX_OAUTH_BUSY_KEY = "codex-oauth";
const CODEX_OAUTH_POLL_INTERVAL_MS = 2000;

type ConsoleCodexOAuthControllerOptions = {
  clearBusy: (key: string) => void;
  error: Ref<string>;
  setBusy: (key: string) => void;
};

export function createConsoleCodexOAuthController(
  options: ConsoleCodexOAuthControllerOptions,
) {
  const codexOAuthStatus = ref<CodexOAuthStatus | null>(null);
  const codexOAuthLogin = ref<CodexOAuthLogin | null>(null);
  const codexOAuthPolling = createConsoleIntervalController();
  const codexOAuthPollTimer = codexOAuthPolling.timer;

  function stopCodexOAuthPolling() {
    codexOAuthPolling.stop();
  }

  async function refreshCodexOAuthStatus() {
    const status = await getCodexOAuthStatus();
    codexOAuthStatus.value = status;
    if (status.valid) {
      stopCodexOAuthPolling();
      codexOAuthLogin.value = null;
    }
    return status;
  }

  function startCodexOAuthPolling() {
    stopCodexOAuthPolling();
    codexOAuthPolling.start(() => {
      void refreshCodexOAuthStatus();
    }, CODEX_OAUTH_POLL_INTERVAL_MS);
  }

  async function beginCodexOAuthLogin() {
    options.setBusy(CODEX_OAUTH_BUSY_KEY);
    options.error.value = "";

    try {
      const login = await startCodexOAuthLogin();
      codexOAuthLogin.value = login;
      codexOAuthStatus.value = login.status;
      openBrowserPopup(login.authorizationUrl || "", "pact-codex-oauth");
      startCodexOAuthPolling();
      return login.status.valid;
    } catch (nextError) {
      options.error.value =
        nextError instanceof Error ? nextError.message : "启动 Codex OAuth 验证失败。";
      return false;
    } finally {
      options.clearBusy(CODEX_OAUTH_BUSY_KEY);
    }
  }

  async function ensureCodexOAuthReady(startLogin = false) {
    const status = await refreshCodexOAuthStatus();
    if (status.valid) {
      return true;
    }
    if (startLogin) {
      return beginCodexOAuthLogin();
    }
    return false;
  }

  return {
    beginCodexOAuthLogin,
    codexOAuthLogin,
    codexOAuthPollTimer,
    codexOAuthStatus,
    ensureCodexOAuthReady,
    refreshCodexOAuthStatus,
    startCodexOAuthPolling,
    stopCodexOAuthPolling,
  };
}
