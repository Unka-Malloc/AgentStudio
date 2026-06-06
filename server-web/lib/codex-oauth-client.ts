import { getJson, postJson } from "./bridge-http";
import type { CodexOAuthLogin, CodexOAuthStatus } from "./types";

export function getCodexOAuthStatus() {
  return getJson<CodexOAuthStatus>("/api/oauth/codex/status");
}

export function startCodexOAuthLogin() {
  return postJson<CodexOAuthLogin>("/api/oauth/codex/login", {});
}
