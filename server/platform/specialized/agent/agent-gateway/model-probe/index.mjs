import {
  callCodexChatGptJson,
  getCodexOAuthStatus
} from "../../../../common/security/auth/codex-oauth-service.mjs";
import { callAgentGateway } from "../index.mjs";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_MODEL_PROBE_RESPONSE_BYTES = 4 * 1024 * 1024;
const PROBE_EXPECTED_ANSWER = "PactProbeOK";
const PROBE_PROMPT = `这是 Pact 模型库连通性探测。请只回复：${PROBE_EXPECTED_ANSWER}`;

function asPlainObject(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
}

function trimSlash(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function elapsedSince(startedAt) {
  return Math.max(0, Date.now() - startedAt);
}

function success({
  provider,
  model,
  startedAt,
  statusCode = 200,
  message = "模型已返回有效回答。",
  answerSnippet = ""
}) {
  return {
    ok: true,
    configured: true,
    provider,
    model,
    statusCode,
    latencyMs: elapsedSince(startedAt),
    checkedAt: new Date().toISOString(),
    message,
    answerSnippet
  };
}

function failure({ provider, model = "", startedAt, statusCode = 0, message, configured = true }) {
  return {
    ok: false,
    configured,
    provider,
    model,
    statusCode,
    latencyMs: elapsedSince(startedAt),
    checkedAt: new Date().toISOString(),
    message: String(message || "连接失败。")
  };
}

function timeoutSignal(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || DEFAULT_TIMEOUT_MS);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer)
  };
}

function modelProbeResponseTooLargeError(maxBytes = MAX_MODEL_PROBE_RESPONSE_BYTES) {
  const error = new Error(`Model probe response exceeded the ${maxBytes} byte response limit.`);
  error.code = "model_probe_response_too_large";
  error.maxBytes = maxBytes;
  return error;
}

async function readProbeResponseTextWithLimit(response, maxBytes = MAX_MODEL_PROBE_RESPONSE_BYTES) {
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    try {
      await response.body?.cancel?.();
    } catch {
      // The caller only needs the bounded failure.
    }
    throw modelProbeResponseTooLargeError(maxBytes);
  }
  if (!response.body?.getReader) {
    return "";
  }
  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (!value) {
        continue;
      }
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          // Preserve the size-limit error.
        }
        throw modelProbeResponseTooLargeError(maxBytes);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock?.();
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function fetchJsonProbe({
  url,
  method = "POST",
  headers = {},
  body,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl = fetch
}) {
  const timeout = timeoutSignal(timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: timeout.signal
    });
    const rawText = await readProbeResponseTextWithLimit(response).catch((error) =>
      error?.code === "model_probe_response_too_large" ? error.message : ""
    );
    return {
      ok: response.ok,
      status: response.status,
      contentType: String(response.headers.get("content-type") || ""),
      rawText
    };
  } finally {
    timeout.clear();
  }
}

function shortFailureText(rawText) {
  const normalized = String(rawText || "")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/(api[_-]?key["']?\s*[:=]\s*["']?)[^"',}\s]+/gi, "$1[REDACTED]")
    .replace(/(token["']?\s*[:=]\s*["']?)[^"',}\s]+/gi, "$1[REDACTED]")
    .replace(/\s+/g, " ")
    .trim();
  return normalized.length > 240 ? `${normalized.slice(0, 240)}...` : normalized;
}

function safeJsonParse(rawText) {
  try {
    return JSON.parse(String(rawText || ""));
  } catch {
    return null;
  }
}

function textFromContent(value, { includeReasoning = false } = {}) {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => textFromContent(item, { includeReasoning })).join("");
  }
  if (typeof value !== "object") {
    return "";
  }
  const type = String(value.type || "").toLowerCase();
  if (!includeReasoning && (type.includes("reasoning") || type.includes("thinking"))) {
    return "";
  }
  for (const key of ["text", "content", "output_text", "value"]) {
    if (value[key] !== undefined && value[key] !== null) {
      return textFromContent(value[key], { includeReasoning });
    }
  }
  if (includeReasoning) {
    for (const key of ["reasoning_content", "reasoning", "reasoning_details", "thinking", "summary"]) {
      if (value[key] !== undefined && value[key] !== null) {
        return textFromContent(value[key], { includeReasoning: true });
      }
    }
  }
  return "";
}

function shortAnswerText(rawText) {
  const normalized = String(rawText || "")
    .replace(/\s+/g, " ")
    .trim();
  return normalized.length > 120 ? `${normalized.slice(0, 120)}...` : normalized;
}

function answeredSuccess({ provider, model, startedAt, statusCode = 200, answerText }) {
  const answerSnippet = shortAnswerText(answerText);
  if (!answerSnippet) {
    return failure({
      provider,
      model,
      startedAt,
      statusCode,
      message: "模型接口已响应，但所选模型没有返回可用回答。"
    });
  }
  return success({
    provider,
    model,
    startedAt,
    statusCode,
    answerSnippet,
    message: `模型已返回回答：${answerSnippet}`
  });
}

function extractGeminiAnswer(rawText) {
  const json = safeJsonParse(rawText);
  if (!json) {
    return "";
  }
  const candidates = Array.isArray(json.candidates) ? json.candidates : [];
  return candidates
    .flatMap((candidate) => {
      const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
      return parts.map((part) => part?.text || "");
    })
    .join("");
}

function extractChatCompletionAnswer(rawText) {
  const json = safeJsonParse(rawText);
  if (!json) {
    return String(rawText || "").trim();
  }
  const choices = Array.isArray(json.choices) ? json.choices : [];
  const choiceText = choices
    .map((choice) => {
      const message = asPlainObject(choice?.message);
      const delta = asPlainObject(choice?.delta);
      return (
        textFromContent(message.content) ||
        textFromContent(delta.content) ||
        textFromContent(choice.text)
      );
    })
    .join("");
  return (
    choiceText ||
    textFromContent(json.answer) ||
    textFromContent(json.text) ||
    textFromContent(json.content) ||
    textFromContent(json.data?.answer) ||
    textFromContent(json.data?.text) ||
    textFromContent(json.data?.content)
  );
}

function extractAgentGatewayAnswer(result) {
  const direct = String(result?.answer || result?.text || "").trim();
  if (direct) {
    return direct;
  }
  const chunks = asPlainObject(result?.chunks);
  const chunkText = [
    ...(Array.isArray(chunks.answer) ? chunks.answer : []),
    ...(Array.isArray(chunks.text) ? chunks.text : [])
  ].join("");
  return String(chunkText || "").trim();
}

function chatCompletionsUrl(baseUrl) {
  const normalized = trimSlash(baseUrl);
  if (/\/chat\/completions$/i.test(normalized)) {
    return normalized;
  }
  return `${normalized}/chat/completions`;
}

async function probeGoogleGemini(settings, options) {
  const provider = "google-gemini";
  const startedAt = Date.now();
  const apiKey = String(settings.googleApiKey || "").trim();
  const model = String(settings.googleModel || "gemini-flash-lite-latest").trim();
  if (!apiKey) {
    return failure({ provider, model, startedAt, configured: false, message: "Google API Key 未配置。" });
  }

  const modelPath = model.startsWith("models/") ? model : `models/${model}`;
  const url =
    `https://generativelanguage.googleapis.com/v1beta/${encodeURIComponent(modelPath).replace(/%2F/g, "/")}:generateContent` +
    `?key=${encodeURIComponent(apiKey)}`;
  const result = await fetchJsonProbe({
    url,
    headers: { "Content-Type": "application/json" },
    body: {
      contents: [
        {
          role: "user",
          parts: [{ text: PROBE_PROMPT }]
        }
      ],
      generationConfig: { maxOutputTokens: 12, temperature: 0 }
    },
    timeoutMs: 30_000,
    fetchImpl: options.fetchImpl
  });
  if (!result.ok) {
    return failure({
      provider,
      model,
      startedAt,
      statusCode: result.status,
      message: shortFailureText(result.rawText) || `Gemini 探测失败：${result.status}`
    });
  }
  return answeredSuccess({
    provider,
    model,
    startedAt,
    statusCode: result.status,
    answerText: extractGeminiAnswer(result.rawText)
  });
}

async function probeOpenRouter(settings, options) {
  const provider = "openrouter";
  const startedAt = Date.now();
  const apiKey = String(settings.openRouterApiKey || "").trim();
  const model = String(settings.openRouterModel || "openai/gpt-4.1-mini").trim();
  const baseUrl = trimSlash(settings.openRouterBaseUrl || "https://openrouter.ai/api/v1");
  if (!apiKey) {
    return failure({ provider, model, startedAt, configured: false, message: "OpenRouter API Key 未配置。" });
  }
  const result = await fetchJsonProbe({
    url: chatCompletionsUrl(baseUrl),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: {
      model,
      messages: [{ role: "user", content: PROBE_PROMPT }],
      max_tokens: 12,
      temperature: 0
    },
    timeoutMs: 30_000,
    fetchImpl: options.fetchImpl
  });
  if (!result.ok) {
    return failure({
      provider,
      model,
      startedAt,
      statusCode: result.status,
      message: shortFailureText(result.rawText) || `OpenRouter 探测失败：${result.status}`
    });
  }
  return answeredSuccess({
    provider,
    model,
    startedAt,
    statusCode: result.status,
    answerText: extractChatCompletionAnswer(result.rawText)
  });
}

function findModelLibraryProbeEntry(settings = {}, { provider = "", modelAlias = "", model = "" } = {}) {
  const normalizedProvider = String(provider || "").trim();
  const normalizedAlias = String(modelAlias || "").trim();
  const normalizedModel = String(model || "").trim();
  const models = Array.isArray(settings.modelLibraryAgents) ? settings.modelLibraryAgents : [];
  if (normalizedAlias) {
    const byAlias = models.find((entry) =>
      [entry?.uid, entry?.instanceId, entry?.alias]
        .map((value) => String(value || "").trim())
        .includes(normalizedAlias)
    );
    if (byAlias) {
      return byAlias;
    }
  }
  return models.find((entry) => {
    if (normalizedProvider && String(entry?.provider || "").trim() !== normalizedProvider) {
      return false;
    }
    if (!normalizedModel) {
      return true;
    }
    return [entry?.model, entry?.engine].map((value) => String(value || "").trim()).includes(normalizedModel);
  });
}

async function probeDeepSeek(settings, options) {
  const provider = "deepseek";
  const startedAt = Date.now();
  const model = String(settings.deepSeekModel ?? "").trim();
  const selectedEntry = String(options.modelAlias || "").trim()
    ? findModelLibraryProbeEntry(settings, {
        provider,
        modelAlias: options.modelAlias,
        model
      })
    : null;
  const selectedAlias = String(
    selectedEntry?.uid || selectedEntry?.instanceId || selectedEntry?.alias || ""
  ).trim();
  const apiKey = selectedEntry
    ? String(selectedEntry.apiKey || "").trim()
    : String(settings.deepSeekApiKey || "").trim();
  if (!model) {
    return failure({ provider, model, startedAt, configured: false, message: "DeepSeek 模型 ID 未配置。" });
  }
  if (!apiKey) {
    return failure({ provider, model, startedAt, configured: false, message: "DeepSeek API Key 未配置。" });
  }
  try {
    const probeSettings = selectedEntry
      ? { ...settings, deepSeekApiKey: apiKey }
      : settings;
    const result = await callAgentGateway({
      settings: probeSettings,
      input: {
        alias: selectedAlias || "deepseek",
        question: PROBE_PROMPT,
        engine: model,
        parameters: {
          max_tokens: 128,
          temperature: 0,
          thinking: { type: "disabled" }
        }
      },
      fetchImpl: options.fetchImpl,
      userDataPath: options.userDataPath
    });
    return answeredSuccess({
      provider,
      model: result.upstream?.model || model,
      startedAt,
      statusCode: result.upstream?.status || 200,
      answerText: extractAgentGatewayAnswer(result)
    });
  } catch (error) {
    return failure({
      provider,
      model,
      startedAt,
      message: error instanceof Error ? shortFailureText(error.message) : "DeepSeek 探测失败。"
    });
  }
}

async function probeCustomHttp(settings, options) {
  const provider = "custom-http";
  const startedAt = Date.now();
  const selectedEntry = findModelLibraryProbeEntry(settings, {
    provider,
    modelAlias: options.modelAlias,
    model: settings.customModelAlias || settings.customHttpAdapter?.alias || ""
  });
  const model = String(
    options.modelAlias ||
      selectedEntry?.uid ||
      selectedEntry?.instanceId ||
      selectedEntry?.alias ||
      settings.customModelAlias ||
      "external-agent"
  ).trim();
  if (!String(settings.customHttpAdapter?.url || "").trim()) {
    return failure({ provider, model, startedAt, configured: false, message: "自定义 HTTP Adapter URL 未配置。" });
  }
  try {
    const selectedToken = String(selectedEntry?.token || selectedEntry?.apiKey || "").trim();
    const selectedAdapter = selectedEntry
      ? {
          ...(settings.customHttpAdapter || {}),
          ...selectedEntry,
          alias: model,
          token: selectedToken,
          tokenConfigured: Boolean(selectedToken),
          url: String(selectedEntry.url || settings.customHttpAdapter?.url || "").trim(),
          engine: String(selectedEntry.engine || selectedEntry.model || "").trim()
        }
      : null;
    const probeSettings = selectedAdapter
      ? {
          ...settings,
          customHttpAdapter: selectedAdapter,
          customHttpAdapters: [selectedAdapter]
        }
      : settings;
    const result = await callAgentGateway({
      settings: probeSettings,
      input: {
        alias: model,
        question: PROBE_PROMPT,
        parameters: { probe: true }
      },
      fetchImpl: options.fetchImpl,
      userDataPath: options.userDataPath
    });
    return answeredSuccess({
      provider,
      model,
      startedAt,
      statusCode: result.upstream?.status || 200,
      answerText: extractAgentGatewayAnswer(result)
    });
  } catch (error) {
    return failure({
      provider,
      model,
      startedAt,
      message: error instanceof Error ? shortFailureText(error.message) : "自定义 HTTP Adapter 探测失败。"
    });
  }
}

async function probeCopilot(settings, options) {
  const provider = "copilot";
  const startedAt = Date.now();
  const endpoint = trimSlash(settings.copilotEndpoint || "");
  const apiKey = String(settings.copilotApiKey || "").trim();
  const model = String(settings.copilotModel || "copilot-default").trim();
  if (!endpoint) {
    return failure({ provider, model, startedAt, configured: false, message: "Copilot / 企业代理 Endpoint 未配置。" });
  }
  const result = await fetchJsonProbe({
    url: chatCompletionsUrl(endpoint),
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
    },
    body: {
      model,
      messages: [{ role: "user", content: PROBE_PROMPT }],
      max_tokens: 12,
      temperature: 0
    },
    timeoutMs: 30_000,
    fetchImpl: options.fetchImpl
  });
  if (!result.ok) {
    return failure({
      provider,
      model,
      startedAt,
      statusCode: result.status,
      message: shortFailureText(result.rawText) || `Copilot / 企业代理探测失败：${result.status}`
    });
  }
  return answeredSuccess({
    provider,
    model,
    startedAt,
    statusCode: result.status,
    answerText: extractChatCompletionAnswer(result.rawText)
  });
}

async function probeLocalModel(settings, options) {
  const provider = "local-model";
  const startedAt = Date.now();
  const endpoint = trimSlash(settings.localModelEndpoint || "");
  const model = String(settings.localModelName || "local-default").trim();
  if (!endpoint) {
    return failure({ provider, model, startedAt, configured: false, message: "本地模型 Endpoint 未配置。" });
  }

  const chat = await fetchJsonProbe({
    url: chatCompletionsUrl(endpoint),
    headers: { "Content-Type": "application/json" },
    body: {
      model,
      messages: [{ role: "user", content: PROBE_PROMPT }],
      max_tokens: 12,
      temperature: 0
    },
    timeoutMs: 30_000,
    fetchImpl: options.fetchImpl
  });
  if (!chat.ok) {
    return failure({
      provider,
      model,
      startedAt,
      statusCode: chat.status || 0,
      message:
        shortFailureText(chat.rawText) ||
        "本地模型探测失败。"
    });
  }
  return answeredSuccess({
    provider,
    model,
    startedAt,
    statusCode: chat.status,
    answerText: extractChatCompletionAnswer(chat.rawText)
  });
}

async function probeOpenAiChatGpt(settings, options) {
  const provider = "openai-chatgpt";
  const startedAt = Date.now();
  const model = String(settings.openAiModel || "gpt-5.4-mini").trim();
  const status = await (options.getCodexOAuthStatus || getCodexOAuthStatus)();
  if (!status.valid) {
    return failure({
      provider,
      model,
      startedAt,
      configured: false,
      message: status.reason || "ChatGPT OAuth 未验证。"
    });
  }
  try {
    const result = await (options.callCodexChatGptJson || callCodexChatGptJson)({
      model,
      prompt: `Return a JSON object exactly like {"answer":"${PROBE_EXPECTED_ANSWER}"}.`
    });
    return answeredSuccess({
      provider,
      model,
      startedAt,
      answerText: result?.answer || (result?.ok ? PROBE_EXPECTED_ANSWER : "")
    });
  } catch (error) {
    return failure({
      provider,
      model,
      startedAt,
      message: error instanceof Error ? shortFailureText(error.message) : "ChatGPT OAuth 探测失败。"
    });
  }
}

export async function probeModelConnection({
  provider,
  settings,
  modelAlias = "",
  userDataPath = "",
  fetchImpl = fetch,
  getCodexOAuthStatus: codexStatusProvider = getCodexOAuthStatus,
  callCodexChatGptJson: codexCallProvider = callCodexChatGptJson
} = {}) {
  const normalizedProvider = String(provider || settings?.defaultModelProvider || "").trim();
  const normalizedSettings = asPlainObject(settings);
  const options = {
    fetchImpl,
    modelAlias: String(modelAlias || normalizedSettings.modelProbeModelAlias || "").trim(),
    userDataPath,
    getCodexOAuthStatus: codexStatusProvider,
    callCodexChatGptJson: codexCallProvider
  };
  switch (normalizedProvider) {
    case "google-gemini":
      return probeGoogleGemini(normalizedSettings, options);
    case "openai-chatgpt":
      return probeOpenAiChatGpt(normalizedSettings, options);
    case "deepseek":
      return probeDeepSeek(normalizedSettings, options);
    case "openrouter":
      return probeOpenRouter(normalizedSettings, options);
    case "copilot":
      return probeCopilot(normalizedSettings, options);
    case "custom-http":
      return probeCustomHttp(normalizedSettings, options);
    case "local-model":
      return probeLocalModel(normalizedSettings, options);
    default:
      return failure({
        provider: normalizedProvider || "unknown",
        startedAt: Date.now(),
        configured: false,
        message: `不支持的模型类型：${normalizedProvider || "unknown"}`
      });
  }
}
