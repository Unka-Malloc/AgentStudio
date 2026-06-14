import crypto from "node:crypto";
import http from "node:http";
import { spawn } from "node:child_process";
import { normalizeLocalSecretProvider, resolveLocalSecretTarget } from "./local-secret-store.mjs";

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_CALLBACK_PATH = "/oauth/callback";
const MAX_OAUTH_TOKEN_RESPONSE_BYTES = 1024 * 1024;

const OAUTH_PROVIDER_DEFAULTS = Object.freeze({
  onedrive: {
    tenant: "common",
    authorizationUrl: "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token",
    scope: "offline_access Files.ReadWrite.All User.Read",
    authorizeParams: {},
    tokenClientAuth: "body"
  },
  "google-drive": {
    authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scope: "https://www.googleapis.com/auth/drive.file",
    authorizeParams: {
      access_type: "offline",
      prompt: "consent"
    },
    tokenClientAuth: "body"
  },
  dropbox: {
    authorizationUrl: "https://www.dropbox.com/oauth2/authorize",
    tokenUrl: "https://api.dropboxapi.com/oauth2/token",
    scope: "files.metadata.read files.content.read files.content.write",
    authorizeParams: {
      token_access_type: "offline"
    },
    tokenClientAuth: "basic"
  }
});

function text(value) {
  return String(value ?? "").trim();
}

async function readResponseTextWithLimit(response, maxBytes = MAX_OAUTH_TOKEN_RESPONSE_BYTES) {
  if (!response?.body?.getReader) {
    const responseText = await response.text();
    if (Buffer.byteLength(responseText, "utf8") > maxBytes) {
      throw new Error(`OAuth token response exceeded the ${maxBytes} byte limit.`);
    }
    return responseText;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    const chunk = Buffer.from(value);
    total += chunk.length;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new Error(`OAuth token response exceeded the ${maxBytes} byte limit.`);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function base64Url(buffer) {
  return Buffer.from(buffer)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function randomBase64Url(bytes = 32) {
  return base64Url(crypto.randomBytes(bytes));
}

function sha256Base64Url(value) {
  return base64Url(crypto.createHash("sha256").update(String(value)).digest());
}

function templateUrl(value, { tenant = "" } = {}) {
  return String(value || "").replace(/\{tenant\}/g, encodeURIComponent(tenant || "common"));
}

function splitScope(value = "") {
  return String(value || "")
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .join(" ");
}

function parseExtraParams(value = "") {
  if (!value) return {};
  if (typeof value === "object") return value;
  const parsed = {};
  for (const entry of String(value).split(/[,&]/)) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 0) {
      parsed[trimmed] = "";
      continue;
    }
    parsed[trimmed.slice(0, separator).trim()] = trimmed.slice(separator + 1).trim();
  }
  return parsed;
}

function listen(server, host, port) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve(server.address());
    });
  });
}

function closeServer(server) {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

function htmlResponse({ ok = true, title = "Pact OAuth", message = "" } = {}) {
  const escapedTitle = String(title).replace(/[<>&"]/g, "");
  const escapedMessage = String(message).replace(/[<>&"]/g, "");
  return [
    "<!doctype html>",
    "<meta charset=\"utf-8\">",
    `<title>${escapedTitle}</title>`,
    `<h1>${escapedTitle}</h1>`,
    `<p>${escapedMessage || (ok ? "OAuth 已返回，可以关闭此页。" : "OAuth 失败。")}</p>`
  ].join("");
}

function openBrowser(url) {
  const platform = process.platform;
  const command = platform === "darwin"
    ? "open"
    : platform === "win32"
      ? "cmd"
      : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, {
    stdio: "ignore",
    detached: true
  });
  child.unref();
}

function tokenExpiryFromResponse(token = {}) {
  const seconds = Number(token.expires_in || token.expiresIn || 0);
  return seconds > 0 ? new Date(Date.now() + seconds * 1000).toISOString() : "";
}

async function exchangeAuthorizationCode({
  tokenUrl,
  code,
  redirectUri,
  clientId,
  clientSecret = "",
  codeVerifier,
  clientAuth = "body"
}) {
  const body = new URLSearchParams();
  body.set("grant_type", "authorization_code");
  body.set("code", code);
  body.set("redirect_uri", redirectUri);
  body.set("client_id", clientId);
  body.set("code_verifier", codeVerifier);
  const headers = {
    accept: "application/json",
    "content-type": "application/x-www-form-urlencoded"
  };
  if (clientSecret) {
    if (clientAuth === "basic") {
      headers.authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
    } else if (clientAuth !== "none") {
      body.set("client_secret", clientSecret);
    }
  }
  const response = await fetch(tokenUrl, {
    method: "POST",
    headers,
    body
  });
  const responseText = await readResponseTextWithLimit(response);
  let payload = {};
  try {
    payload = responseText ? JSON.parse(responseText) : {};
  } catch {
    payload = { raw: responseText };
  }
  if (!response.ok) {
    const error = new Error(payload.error_description || payload.error || responseText || `OAuth token exchange failed: ${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

export function oauthDefaultsForProvider(provider = "", options = {}) {
  const providerId = normalizeLocalSecretProvider(provider);
  const defaults = OAUTH_PROVIDER_DEFAULTS[providerId];
  if (!defaults) {
    return null;
  }
  const tenant = text(options.tenant || defaults.tenant || "common");
  return {
    provider: providerId,
    tenant,
    authorizationUrl: templateUrl(options.authorizationUrl || defaults.authorizationUrl, { tenant }),
    tokenUrl: templateUrl(options.tokenUrl || defaults.tokenUrl, { tenant }),
    scope: splitScope(options.scope || defaults.scope),
    authorizeParams: {
      ...defaults.authorizeParams,
      ...parseExtraParams(options.authorizeParams)
    },
    tokenClientAuth: text(options.tokenClientAuth || defaults.tokenClientAuth || "body")
  };
}

export async function runLocalOAuthAuthorizationCodeFlow({
  provider = "",
  clientId = "",
  clientSecret = "",
  authorizationUrl = "",
  tokenUrl = "",
  tenant = "",
  scope = "",
  authorizeParams = "",
  tokenClientAuth = "",
  host = "127.0.0.1",
  port = 0,
  callbackPath = DEFAULT_CALLBACK_PATH,
  open = true,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  stderr = process.stderr
} = {}) {
  const providerId = normalizeLocalSecretProvider(provider);
  const target = resolveLocalSecretTarget(providerId);
  if (!target || target.authType !== "oauth2") {
    throw new Error(`Provider does not support Pact OAuth redirect flow: ${provider}`);
  }
  const resolvedClientId = text(clientId);
  if (!resolvedClientId) {
    throw new Error("--client-id is required for OAuth redirect flow.");
  }
  const defaults = oauthDefaultsForProvider(providerId, {
    tenant,
    authorizationUrl,
    tokenUrl,
    scope,
    authorizeParams,
    tokenClientAuth
  });
  if (!defaults?.authorizationUrl || !defaults?.tokenUrl) {
    throw new Error(`OAuth endpoints are not configured for provider: ${providerId}`);
  }

  const state = randomBase64Url(24);
  const codeVerifier = randomBase64Url(48);
  const codeChallenge = sha256Base64Url(codeVerifier);
  let callbackResolve;
  let callbackReject;
  const callback = new Promise((resolve, reject) => {
    callbackResolve = resolve;
    callbackReject = reject;
  });

  const server = http.createServer((request, response) => {
    try {
      const requestUrl = new URL(request.url || "/", `http://${request.headers.host || host}`);
      if (requestUrl.pathname !== callbackPath) {
        response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        response.end("Not Found");
        return;
      }
      const error = requestUrl.searchParams.get("error");
      if (error) {
        const description = requestUrl.searchParams.get("error_description") || error;
        response.writeHead(400, { "content-type": "text/html; charset=utf-8" });
        response.end(htmlResponse({ ok: false, title: "Pact OAuth Failed", message: description }));
        callbackReject(new Error(description));
        return;
      }
      if (requestUrl.searchParams.get("state") !== state) {
        response.writeHead(400, { "content-type": "text/html; charset=utf-8" });
        response.end(htmlResponse({ ok: false, title: "Pact OAuth State Mismatch", message: "state 校验失败。" }));
        callbackReject(new Error("OAuth state mismatch."));
        return;
      }
      const code = requestUrl.searchParams.get("code");
      if (!code) {
        response.writeHead(400, { "content-type": "text/html; charset=utf-8" });
        response.end(htmlResponse({ ok: false, title: "Pact OAuth Missing Code", message: "OAuth 回跳缺少 code。" }));
        callbackReject(new Error("OAuth callback did not include code."));
        return;
      }
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(htmlResponse({ ok: true, title: "Pact OAuth Complete", message: "OAuth 已完成，可以关闭此页并返回终端。" }));
      callbackResolve({ code });
    } catch (error) {
      callbackReject(error);
    }
  });

  const address = await listen(server, host, positiveInteger(port, 0));
  const redirectUri = `http://${host}:${address.port}${callbackPath}`;
  const authorizeUrl = new URL(defaults.authorizationUrl);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", resolvedClientId);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("scope", defaults.scope);
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("code_challenge", codeChallenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  for (const [key, value] of Object.entries(defaults.authorizeParams || {})) {
    if (value !== undefined && value !== null) {
      authorizeUrl.searchParams.set(key, String(value));
    }
  }

  const timeout = setTimeout(() => {
    callbackReject(new Error("OAuth redirect timed out."));
  }, positiveInteger(timeoutMs, DEFAULT_TIMEOUT_MS));

  try {
    stderr.write(`oauthRedirectUri=${redirectUri}\n`);
    stderr.write(`oauthAuthorizationUrl=${authorizeUrl.toString()}\n`);
    if (open) {
      openBrowser(authorizeUrl.toString());
    }
    const { code } = await callback;
    const token = await exchangeAuthorizationCode({
      tokenUrl: defaults.tokenUrl,
      code,
      redirectUri,
      clientId: resolvedClientId,
      clientSecret,
      codeVerifier,
      clientAuth: defaults.tokenClientAuth
    });
    return {
      ok: true,
      provider: providerId,
      redirectUri,
      authorizationUrl: authorizeUrl.toString(),
      scope: defaults.scope,
      tokenUrl: defaults.tokenUrl,
      tokenClientAuth: defaults.tokenClientAuth,
      oauth: {
        accessToken: text(token.access_token || token.accessToken),
        refreshToken: text(token.refresh_token || token.refreshToken),
        tokenType: text(token.token_type || token.tokenType || "Bearer"),
        expiresAt: tokenExpiryFromResponse(token),
        scope: text(token.scope || defaults.scope),
        idToken: text(token.id_token || token.idToken),
        providerResponse: {
          ...token,
          access_token: undefined,
          refresh_token: undefined,
          id_token: undefined
        }
      }
    };
  } finally {
    clearTimeout(timeout);
    await closeServer(server);
  }
}
