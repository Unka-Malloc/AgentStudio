import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const CODEX_DEVICE_URL = "https://auth.openai.com/codex/device";
const CODEX_RESPONSES_URL = "https://chatgpt.com/backend-api/codex/responses";
const TOKEN_REFRESH_MARGIN_MS = 60_000;
const DEVICE_LOGIN_TTL_MS = 15 * 60_000;
const MAX_CODEX_RESPONSE_BYTES = 4 * 1024 * 1024;

let activeDeviceLogin = null;

function codexHome() {
  return (
    process.env.CODEX_HOME ||
    (process.env.HOME ? path.join(process.env.HOME, ".codex") : "")
  );
}

function authPath() {
  const home = codexHome();
  return home ? path.join(home, "auth.json") : "";
}

function stripAnsi(value) {
  return String(value || "").replace(/\u001b\[[0-9;]*m/g, "");
}

async function readResponseTextWithLimit(response, maxBytes = MAX_CODEX_RESPONSE_BYTES) {
  if (!response?.body?.getReader) {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > maxBytes) {
      throw new Error(`Codex response exceeded the ${maxBytes} byte limit.`);
    }
    return text;
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
      throw new Error(`Codex response exceeded the ${maxBytes} byte limit.`);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function decodeJwtPayload(token) {
  const parts = String(token || "").split(".");
  if (parts.length < 2) {
    return {};
  }
  try {
    const normalized = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(Buffer.from(normalized, "base64").toString("utf8"));
  } catch {
    return {};
  }
}

function tokenExpiresAt(token) {
  const payload = decodeJwtPayload(token);
  return payload?.exp ? new Date(Number(payload.exp) * 1000).toISOString() : "";
}

function isFutureIso(value, marginMs = TOKEN_REFRESH_MARGIN_MS) {
  const timestamp = Date.parse(value || "");
  return Number.isFinite(timestamp) && timestamp > Date.now() + marginMs;
}

async function readCodexAuth() {
  const filePath = authPath();
  if (!filePath) {
    return { filePath, parsed: null, error: "CODEX_HOME 未配置。" };
  }

  try {
    return {
      filePath,
      parsed: JSON.parse(await fs.readFile(filePath, "utf8")),
      error: ""
    };
  } catch {
    return { filePath, parsed: null, error: "未找到 Codex OAuth 登录信息。" };
  }
}

export async function getCodexOAuthStatus() {
  const { filePath, parsed, error } = await readCodexAuth();
  const accessToken = parsed?.tokens?.access_token || "";
  const accountId = parsed?.tokens?.account_id || "";
  const idPayload = decodeJwtPayload(parsed?.tokens?.id_token || "");
  const accessTokenExpiresAt = tokenExpiresAt(accessToken);
  const authMode = String(parsed?.auth_mode || "");
  const hasRefreshToken = Boolean(parsed?.tokens?.refresh_token);
  const valid =
    authMode === "chatgpt" &&
    Boolean(accessToken) &&
    Boolean(accountId) &&
    isFutureIso(accessTokenExpiresAt);

  return {
    configured: Boolean(parsed),
    valid,
    authMode,
    accountIdConfigured: Boolean(accountId),
    accessTokenExpiresAt,
    lastRefresh: parsed?.last_refresh || "",
    email: idPayload?.email || "",
    hasRefreshToken,
    codexHome: codexHome(),
    authPath: filePath,
    reason: valid
      ? ""
      : error ||
        (authMode && authMode !== "chatgpt"
          ? "当前 Codex 不是 ChatGPT 登录模式。"
          : !accessToken
            ? "缺少 ChatGPT access token。"
            : !accountId
              ? "缺少 ChatGPT account_id。"
              : "ChatGPT OAuth 已过期或即将过期。"),
    login: activeDeviceLogin
      ? {
          active: activeDeviceLogin.active,
          authorizationUrl: activeDeviceLogin.authorizationUrl,
          userCode: activeDeviceLogin.userCode,
          startedAt: activeDeviceLogin.startedAt,
          expiresAt: activeDeviceLogin.expiresAt,
          message: activeDeviceLogin.message,
          error: activeDeviceLogin.error
        }
      : null
  };
}

function parseDeviceLoginOutput(chunk, login) {
  const output = stripAnsi(chunk);
  login.output = `${login.output || ""}${output}`;

  const urlMatch = login.output.match(/https:\/\/auth\.openai\.com\/codex\/device/i);
  if (urlMatch) {
    login.authorizationUrl = CODEX_DEVICE_URL;
  }

  const codeMatch = login.output.match(/\b[A-Z0-9]{4}-[A-Z0-9]{5}\b/);
  if (codeMatch) {
    login.userCode = codeMatch[0];
  }

  if (login.authorizationUrl && login.userCode) {
    login.message = "请在 Codex 验证页输入一次性代码。";
  }
}

export async function startCodexDeviceLogin() {
  const status = await getCodexOAuthStatus();
  if (status.valid) {
    return {
      started: false,
      alreadyValid: true,
      authorizationUrl: "",
      userCode: "",
      status
    };
  }

  if (activeDeviceLogin?.active) {
    return {
      started: false,
      alreadyValid: false,
      authorizationUrl: activeDeviceLogin.authorizationUrl,
      userCode: activeDeviceLogin.userCode,
      expiresAt: activeDeviceLogin.expiresAt,
      status
    };
  }

  const startedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + DEVICE_LOGIN_TTL_MS).toISOString();
  const login = {
    active: true,
    authorizationUrl: "",
    userCode: "",
    startedAt,
    expiresAt,
    message: "正在启动 Codex 设备验证。",
    error: "",
    output: "",
    process: null
  };
  activeDeviceLogin = login;

  const env = {
    ...process.env,
    CODEX_HOME: codexHome(),
    HOME: process.env.HOME || "/tmp"
  };
  const child = spawn("codex", ["login", "--device-auth"], {
    env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  login.process = child;

  child.stdout.on("data", (chunk) => parseDeviceLoginOutput(chunk.toString("utf8"), login));
  child.stderr.on("data", (chunk) => parseDeviceLoginOutput(chunk.toString("utf8"), login));
  child.on("error", (error) => {
    login.active = false;
    login.error = error instanceof Error ? error.message : "Codex 登录进程启动失败。";
  });
  child.on("close", (code) => {
    login.active = false;
    if (code && code !== 0 && !login.error) {
      login.error = `Codex 登录进程退出：${code}`;
    }
  });

  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline && !login.authorizationUrl && !login.userCode && !login.error) {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  return {
    started: true,
    alreadyValid: false,
    authorizationUrl: login.authorizationUrl || CODEX_DEVICE_URL,
    userCode: login.userCode,
    expiresAt,
    status: await getCodexOAuthStatus()
  };
}

function extractJsonText(rawText) {
  const normalized = String(rawText || "").trim();
  const fencedMatch = normalized.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch) {
    return fencedMatch[1].trim();
  }
  const start = normalized.indexOf("{");
  const end = normalized.lastIndexOf("}");
  return start >= 0 && end > start ? normalized.slice(start, end + 1) : normalized;
}

function collectResponseText(response) {
  const output = Array.isArray(response?.output) ? response.output : [];
  return output
    .flatMap((item) => (Array.isArray(item?.content) ? item.content : []))
    .map((part) => part?.text || "")
    .join("");
}

function parseCodexSse(rawText) {
  let outputText = "";
  let completedResponse = null;
  for (const line of String(rawText || "").split(/\r?\n/)) {
    if (!line.startsWith("data:")) {
      continue;
    }
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") {
      continue;
    }
    const event = JSON.parse(data);
    if (typeof event.delta === "string") {
      outputText += event.delta;
    }
    if (event.type === "response.completed") {
      completedResponse = event.response;
    }
  }
  return outputText || collectResponseText(completedResponse);
}

export async function callCodexChatGptJson({ model, prompt }) {
  const { parsed } = await readCodexAuth();
  const accessToken = parsed?.tokens?.access_token || "";
  const accountId = parsed?.tokens?.account_id || "";
  const expiresAt = tokenExpiresAt(accessToken);
  if (!accessToken || !accountId || !isFutureIso(expiresAt)) {
    const error = new Error("ChatGPT OAuth 未配置或已过期。");
    error.code = "CODEX_OAUTH_REQUIRED";
    throw error;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch(CODEX_RESPONSES_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "chatgpt-account-id": accountId
      },
      body: JSON.stringify({
        model,
        store: false,
        stream: true,
        instructions: "你是客户端知识图谱的轻量语义增强器。只返回 JSON，不要 Markdown。",
        input: [
          {
            role: "user",
            content: [{ type: "input_text", text: prompt }]
          }
        ],
        text: { format: { type: "json_object" } }
      }),
      signal: controller.signal
    });
    const rawText = await readResponseTextWithLimit(response);
    if (!response.ok) {
      throw new Error(rawText || `Codex Responses 请求失败：${response.status}`);
    }
    return JSON.parse(extractJsonText(parseCodexSse(rawText)));
  } finally {
    clearTimeout(timer);
  }
}
