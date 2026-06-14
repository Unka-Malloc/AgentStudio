import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  inspectModelRouting,
  runModelRouting,
  shouldUseModelRouting
} from "./model-routing/index.mjs";

function asPlainObject(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asStringList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value.split(",").map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function normalizeTimeout(value) {
  const parsed = Number(value || 120000);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 120000;
}

function nowIso() {
  return new Date().toISOString();
}

const MAX_AGENT_GATEWAY_RESPONSE_BYTES = 4 * 1024 * 1024;

function truncateText(value, maxLength = 4000) {
  const text = String(value ?? "");
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - 24))}...[truncated ${text.length}]`;
}

function gatewayResponseTooLargeError(label, maxBytes = MAX_AGENT_GATEWAY_RESPONSE_BYTES) {
  const error = new Error(`${label} exceeded the ${maxBytes} byte response limit.`);
  error.code = "agent_gateway_response_too_large";
  error.maxBytes = maxBytes;
  return error;
}

async function readGatewayResponseTextWithLimit(response, {
  label = "Agent gateway upstream response",
  maxBytes = MAX_AGENT_GATEWAY_RESPONSE_BYTES
} = {}) {
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    try {
      await response.body?.cancel?.();
    } catch {
      // The bounded failure is sufficient for the caller.
    }
    throw gatewayResponseTooLargeError(label, maxBytes);
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
        throw gatewayResponseTooLargeError(label, maxBytes);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock?.();
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readGatewayErrorDetails(response, label) {
  try {
    return await readGatewayResponseTextWithLimit(response, { label });
  } catch (error) {
    if (error?.code === "agent_gateway_response_too_large") {
      return error.message;
    }
    return "";
  }
}

function byteLengthOfChunk(chunk) {
  if (typeof chunk === "string") {
    return Buffer.byteLength(chunk);
  }
  return chunk?.byteLength || Buffer.byteLength(String(chunk || ""));
}

function redactSecretText(value) {
  return String(value ?? "")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/(authorization["']?\s*[:=]\s*["']?\s*Bearer\s+)[^"',}\s]+/gi, "$1[REDACTED]")
    .replace(/(api[_-]?key["']?\s*[:=]\s*["']?)[^"',}\s]+/gi, "$1[REDACTED]")
    .replace(/(token["']?\s*[:=]\s*["']?)[^"',}\s]+/gi, "$1[REDACTED]");
}

function safeUrlSummary(value) {
  try {
    const parsed = new URL(String(value || ""));
    return {
      origin: parsed.origin,
      pathname: parsed.pathname
    };
  } catch {
    return {
      origin: "",
      pathname: String(value || "").replace(/[?#].*$/, "")
    };
  }
}

function sanitizePayload(value, depth = 0) {
  if (depth > 8) {
    return "[MaxDepth]";
  }
  if (value === undefined || value === null) {
    return value;
  }
  if (typeof value === "string") {
    return truncateText(redactSecretText(value), 4000);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizePayload(item, depth + 1));
  }
  if (typeof value !== "object") {
    return String(value);
  }
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    const lower = key.toLowerCase();
    if (
      lower.includes("apikey") ||
      lower.includes("api_key") ||
      lower === "token" ||
      lower.endsWith("token") ||
      lower === "authorization" ||
      lower === "cookie" ||
      lower === "set-cookie"
    ) {
      output[key] = item ? "[REDACTED]" : "";
      continue;
    }
    output[key] = sanitizePayload(item, depth + 1);
  }
  return output;
}

function summarizeMessages(messages = []) {
  return asArray(messages).map((message, index) => {
    const value = asPlainObject(message);
    const contentText = textFromContent(value.content, { includeReasoning: true });
    const reasoningText = textFromContent(value.reasoning_content ?? value.reasoning, {
      includeReasoning: true
    });
    return {
      index,
      role: String(value.role || ""),
      contentLength: contentText.length,
      contentPreview: truncateText(contentText.replace(/\s+/g, " ").trim(), 500),
      hasReasoningContent: Boolean(reasoningText),
      reasoningLength: reasoningText.length,
      toolCallNames: asArray(value.tool_calls)
        .map((call) => String(call?.function?.name || call?.name || "").trim())
        .filter(Boolean),
      toolCallIds: asArray(value.tool_calls)
        .map((call) => String(call?.id || call?.tool_call_id || "").trim())
        .filter(Boolean),
      toolCallId: value.tool_call_id ? String(value.tool_call_id) : ""
    };
  });
}

function estimateGatewayTokens(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  const cjkCount = (text.match(/[\u3400-\u9fff]/g) || []).length;
  const nonCjkCount = Math.max(0, text.length - cjkCount);
  return Math.max(1, Math.ceil(cjkCount * 0.9 + nonCjkCount / 4));
}

function gatewayMessageText(message = {}) {
  return textFromContent(message.content ?? message.text ?? message.summary ?? "", {
    includeReasoning: true
  }) || JSON.stringify(message.content ?? message.text ?? "");
}

function toCompactionMessages(input = {}) {
  if (Array.isArray(input.transcript)) {
    return input.transcript;
  }
  if (Array.isArray(input.messages)) {
    return input.messages;
  }
  const messages = [];
  if (input.history || input.compressedHistory) {
    messages.push({
      id: "gateway-history",
      role: "system",
      apiRoundId: "gateway-history",
      content: input.history || input.compressedHistory
    });
  }
  for (const [index, turn] of asArray(input.recentTurns).entries()) {
    messages.push({
      ...asPlainObject(turn),
      id: turn?.id || turn?.messageId || `gateway-turn-${index + 1}`,
      apiRoundId: turn?.apiRoundId || turn?.roundId || `gateway-turn-round-${Math.floor(index / 2) + 1}`
    });
  }
  const question = String(input.question || input.query || "").trim();
  if (question) {
    messages.push({
      id: "gateway-current-question",
      role: "user",
      apiRoundId: "gateway-current",
      content: question
    });
  }
  return messages;
}

function shouldCompactAgentGatewayInput(input = {}, messages = []) {
  if (input.contextCompaction === false || input.skipContextCompaction === true) {
    return false;
  }
  const options = asPlainObject(input.contextCompaction);
  if (options.force === true || input.forceContextCompaction === true) {
    return true;
  }
  if (Array.isArray(input.messages) || Array.isArray(input.transcript)) {
    return true;
  }
  if (input.history || input.compressedHistory || asArray(input.recentTurns).length) {
    return true;
  }
  return estimateGatewayTokens(messages) > Number(options.autoThresholdTokens || 12000);
}

function compactedMessagesForGateway(result = {}) {
  const summary = String(result.summary || result.boundaryMessage?.content || "").trim();
  const messages = [];
  if (summary) {
    messages.push({
      role: "system",
      content: [
        "Pact context compaction summary follows. It is auxiliary memory, not canonical evidence.",
        summary
      ].join("\n")
    });
  }
  for (const item of asArray(result.reinjection?.items)) {
    messages.push({
      role: "system",
      content: `Reinjected runtime state (${item.key}): ${JSON.stringify(item.value)}`
    });
  }
  for (const message of asArray(result.messagesToKeep).slice(-24)) {
    messages.push({
      role: ["system", "assistant", "user", "tool"].includes(String(message.role || ""))
        ? String(message.role)
        : "user",
      content: gatewayMessageText(message)
    });
  }
  return messages;
}

async function prepareAgentGatewayInputWithCompaction({
  input = {},
  contextRuntime = null,
  source = "agent-gateway"
} = {}) {
  if (!contextRuntime || typeof contextRuntime.runCompaction !== "function") {
    return { input, compaction: null };
  }
  const messages = toCompactionMessages(input);
  if (!messages.length || !shouldCompactAgentGatewayInput(input, messages)) {
    return { input, compaction: null };
  }
  const question = String(input.question || input.query || "").trim();
  const options = asPlainObject(input.contextCompaction);
  const compaction = await contextRuntime.runCompaction({
    contextProfileId:
      input.contextProfileId ||
      input.compactionProfileId ||
      options.contextProfileId ||
      options.profileId ||
      input.modelAlias ||
      input.alias ||
      "",
    sessionId: input.sessionId || input.conversationId || input.threadId || "",
    messages,
    taskBrief: question || input.taskBrief || input.intent || "",
    runtimeState: {
      ...asPlainObject(input.runtimeState),
      taskBrief: question || input.taskBrief || input.intent || "",
      enabledTools: input.pluginList || input.tools || input.runtimeState?.enabledTools || [],
      operationCatalog: input.operationCatalog || input.runtimeState?.operationCatalog || [],
      activePlan: input.activePlan || input.plan || input.runtimeState?.activePlan || null,
      userConstraints: input.userConstraints || input.runtimeState?.userConstraints || []
    },
    inputSource: source,
    force: options.force === true || input.forceContextCompaction === true,
    compactionPolicy: {
      ...asPlainObject(options.policy),
      recentMessageProtectionCount:
        options.recentMessageProtectionCount === undefined && options.force === true
          ? 1
          : options.recentMessageProtectionCount,
      recentTurnProtectionCount:
        options.recentTurnProtectionCount === undefined && options.force === true
          ? 1
          : options.recentTurnProtectionCount
    },
    persist: options.persist !== false,
    useSessionMemory: options.useSessionMemory !== false,
    modelAssisted: options.modelAssisted === true
  });
  if (!compaction?.compacted) {
    return { input, compaction };
  }
  const gatewayMessages = compactedMessagesForGateway(compaction);
  const compactedQuestion = [
    "Pact compacted prior context before this agent call.",
    `Boundary: ${compaction.boundary?.boundaryId || ""}`,
    compaction.summary || "",
    compaction.reinjection?.items?.length
      ? `Runtime state: ${JSON.stringify(compaction.reinjection.items.map((item) => ({
          key: item.key,
          value: item.value
        })))}`
      : "",
    question ? `Current question:\n${question}` : ""
  ].filter(Boolean).join("\n\n");
  return {
    input: {
      ...input,
      question: compactedQuestion,
      query: input.query && !input.question ? compactedQuestion : input.query,
      messages: Array.isArray(input.messages) ? gatewayMessages : input.messages,
      contextCompaction: false,
      contextCompactionResult: {
        compacted: true,
        boundaryId: compaction.boundary?.boundaryId || "",
        strategy: compaction.strategy || "",
        tokenReport: compaction.tokenReport || null
      }
    },
    compaction
  };
}

function publicGatewayCompactionResult(compaction = null) {
  if (!compaction) {
    return null;
  }
  return {
    protocolVersion: compaction.protocolVersion || "",
    status: compaction.status || "",
    compacted: compaction.compacted === true,
    strategy: compaction.strategy || "",
    triggerReason: compaction.triggerReason || "",
    degraded: compaction.degraded === true,
    degradedReasons: compaction.degradedReasons || [],
    boundaryId: compaction.boundary?.boundaryId || "",
    tokenReport: compaction.tokenReport || null
  };
}

function summarizeTools(tools = []) {
  return asArray(tools).map((tool, index) => {
    const fn = asPlainObject(tool?.function);
    return {
      index,
      type: String(tool?.type || ""),
      name: String(fn.name || tool?.name || ""),
      descriptionLength: String(fn.description || "").length,
      parameterKeys: Object.keys(asPlainObject(fn.parameters?.properties))
    };
  });
}

function summarizeAgentGatewayPayload(payload = {}) {
  const value = asPlainObject(payload);
  return {
    agentName: String(value.agentName || ""),
    pluginList: asArray(value.pluginList),
    questionLength: String(value.question || "").length,
    questionPreview: truncateText(String(value.question || "").replace(/\s+/g, " ").trim(), 500),
    sessionId: String(value.sessionId || ""),
    userId: String(value.userId || ""),
    projectId: String(value.projectId || ""),
    engine: String(value.engine || ""),
    parameters: sanitizePayload(value.parameters || {})
  };
}

function summarizeDeepSeekPayload(payload = {}) {
  const value = asPlainObject(payload);
  return {
    model: String(value.model || ""),
    stream: value.stream === true,
    messages: summarizeMessages(value.messages),
    tools: summarizeTools(value.tools),
    toolChoice: sanitizePayload(value.tool_choice),
    parameters: sanitizePayload(
      Object.fromEntries(
        Object.entries(value).filter(
          ([key]) => !["model", "messages", "stream", "tools", "tool_choice"].includes(key)
        )
      )
    )
  };
}

function summarizeGatewayResult(result = {}) {
  const answerText = String(result.answer || result.text || "");
  const reasoningText = asArray(result.chunks?.reasoning).join("");
  return {
    ok: result.ok === true,
    answerLength: answerText.length,
    answerPreview: truncateText(answerText.replace(/\s+/g, " ").trim(), 500),
    hasReasoningContent: Boolean(reasoningText),
    reasoningLength: reasoningText.length,
    toolCalls: asArray(result.toolCalls || result.tool_calls)
      .map((call, index) => normalizeGatewayToolCall(call, index))
      .filter(Boolean)
      .map((call) => ({
        id: call.id,
        name: call.function.name,
        arguments: sanitizePayload(safeJsonParse(call.function.arguments) || call.function.arguments || {})
      })),
    dialogId: String(result.dialogId || ""),
    finish: result.finish === true,
    payload: sanitizePayload(result.payload || {})
  };
}

async function appendAgentGatewayAudit({ userDataPath = "", event = {} } = {}) {
  if (!userDataPath) {
    return;
  }
  const logPath = path.join(userDataPath, "logs", "agent-gateway.jsonl");
  try {
    await fs.mkdir(path.dirname(logPath), { recursive: true });
    await fs.appendFile(
      logPath,
      `${JSON.stringify({
        ts: nowIso(),
        schemaVersion: "v0.0.1:schema:definition-1",
        component: "AgentGateway",
        ...sanitizePayload(event)
      })}\n`,
      "utf8"
    );
  } catch {
    // Audit logging must never break model calls.
  }
}

function adapterAlias(value, fallback = "external-agent") {
  const normalized = String(value || "").trim();
  if (normalized) {
    return normalized;
  }
  if (fallback === "") {
    return "";
  }
  return String(fallback || "external-agent").trim() || "external-agent";
}

function readPresentString(source = {}, keys = []) {
  const value = asPlainObject(source);
  for (const key of keys) {
    if (Object.hasOwn(value, key)) {
      return String(value[key] ?? "").trim();
    }
  }
  return undefined;
}

function normalizeCustomHttpAdapterEntry(value = {}, settings = {}, fallbacks = {}) {
  const gateway = asPlainObject(value);
  const alias = adapterAlias(
    gateway.uid ||
      gateway.instanceId ||
      gateway.alias ||
      gateway.modelAlias ||
      fallbacks.alias ||
      settings.customModelAlias ||
      process.env.PACT_CUSTOM_HTTP_ADAPTER_ALIAS
  );
  const model = String(gateway.model || gateway.engine || "").trim();
  return {
    alias,
    model,
    provider: "custom-http",
    label: String(
      gateway.label ||
        gateway.agentName ||
        fallbacks.label ||
        settings.customModelLabel ||
        "自定义 HTTP Adapter"
    ).trim(),
    url: String(gateway.url || process.env.PACT_CUSTOM_HTTP_ADAPTER_URL || "").trim(),
    token: String(
      gateway.token ||
        gateway.apiKey ||
        fallbacks.token ||
        settings.customModelApiKey ||
        process.env.PACT_CUSTOM_HTTP_ADAPTER_TOKEN ||
        ""
    ).trim(),
    tokenHeader:
      String(
        gateway.tokenHeader || process.env.PACT_CUSTOM_HTTP_ADAPTER_TOKEN_HEADER || "token"
      ).trim() || "token",
    tokenPrefix: String(
      gateway.tokenPrefix ?? process.env.PACT_CUSTOM_HTTP_ADAPTER_TOKEN_PREFIX ?? ""
    ),
    agentName: String(
      gateway.agentName ||
        gateway.label ||
        process.env.PACT_CUSTOM_HTTP_ADAPTER_AGENT_NAME ||
        ""
    ).trim(),
    pluginList: asStringList(gateway.pluginList),
    engine: String(
      gateway.engine || gateway.model || process.env.PACT_CUSTOM_HTTP_ADAPTER_ENGINE || ""
    ).trim(),
    parameters: asPlainObject(gateway.parameters),
    timeoutMs: normalizeTimeout(
      gateway.timeoutMs || process.env.PACT_CUSTOM_HTTP_ADAPTER_TIMEOUT_MS
    ),
    systemPrompt: String(gateway.systemPrompt || gateway.prompt || "").trim()
  };
}

function normalizeDeepSeekEntry(settings = {}, entry = {}) {
  const modelEntry = asPlainObject(entry);
  const hasModelEntry = Object.keys(modelEntry).length > 0;
  const baseUrl =
    String(
      modelEntry.baseUrl ||
        modelEntry.url ||
        settings.deepSeekBaseUrl ||
        process.env.PACT_DEEPSEEK_BASE_URL ||
        "https://api.deepseek.com"
    ).trim() || "https://api.deepseek.com";
  const modelFieldPresent = ["model", "modelId", "engine"].some((key) =>
    Object.hasOwn(modelEntry, key)
  );
  const configuredModel = readPresentString(modelEntry, ["model", "modelId", "engine"]);
  const model = configuredModel ?? (
    hasModelEntry
      ? ""
      : String(settings.deepSeekModel || process.env.PACT_DEEPSEEK_MODEL || "").trim()
  );
  const alias = adapterAlias(
    modelEntry.uid ||
      modelEntry.instanceId ||
      modelEntry.alias ||
      modelEntry.modelAlias ||
      (hasModelEntry ? model : ""),
    "deepseek"
  );
  return {
    alias,
    model,
    modelFieldPresent,
    provider: "deepseek",
    label:
      readPresentString(modelEntry, ["label", "name", "agentName"]) ??
      `DeepSeek ${model}`.trim(),
    baseUrl,
    url: deepSeekChatCompletionsUrl(baseUrl),
    token: String(
      modelEntry.apiKey ||
        modelEntry.token ||
        settings.deepSeekApiKey ||
        process.env.PACT_DEEPSEEK_API_KEY ||
        ""
    ).trim(),
    tokenHeader: "Authorization",
    tokenPrefix: "Bearer ",
    agentName:
      readPresentString(modelEntry, ["agentName", "label", "name"]) ??
      String(alias || "deepseek").trim(),
    pluginList: asStringList(modelEntry.pluginList),
    engine: readPresentString(modelEntry, ["engine", "model", "modelId"]) ?? model,
    parameters: asPlainObject(modelEntry.parameters),
    systemPrompt: String(modelEntry.systemPrompt || modelEntry.prompt || "").trim(),
    timeoutMs: normalizeTimeout(
      modelEntry.timeoutMs || settings.deepSeekTimeoutMs || process.env.PACT_DEEPSEEK_TIMEOUT_MS
    )
  };
}

function normalizeOpenAiCompatibleEntry(settings = {}, entry = {}, provider = "") {
  const modelEntry = asPlainObject(entry);
  const providerId = String(provider || modelEntry.provider || "").trim();
  let defaultBaseUrl = "";
  let defaultToken = "";
  let defaultLabel = "";
  if (providerId === "openrouter") {
    defaultBaseUrl = settings.openRouterBaseUrl || "https://openrouter.ai/api/v1";
    defaultToken = settings.openRouterApiKey || "";
    defaultLabel = "OpenRouter";
  } else if (providerId === "copilot") {
    defaultBaseUrl = settings.copilotEndpoint || "";
    defaultToken = settings.copilotApiKey || "";
    defaultLabel = "Copilot";
  } else if (providerId === "local-model") {
    defaultBaseUrl = settings.localModelEndpoint || "";
    defaultToken = modelEntry.token || modelEntry.apiKey || "";
    defaultLabel = "Local Model";
  }
  const model = readPresentString(modelEntry, ["model", "modelId", "engine"]) ?? "";
  const alias = adapterAlias(
    modelEntry.uid ||
      modelEntry.instanceId ||
      modelEntry.alias ||
      modelEntry.modelAlias ||
      model,
    model
  );
  const baseUrl = String(modelEntry.baseUrl || modelEntry.url || defaultBaseUrl || "").trim();
  const token = String(modelEntry.apiKey || modelEntry.token || defaultToken || "").trim();
  return {
    alias,
    model,
    provider: providerId,
    label:
      readPresentString(modelEntry, ["label", "name", "agentName"]) ??
      `${defaultLabel} ${model}`.trim(),
    baseUrl,
    url: chatCompletionsUrl(baseUrl),
    token,
    tokenHeader: String(modelEntry.tokenHeader || "Authorization").trim() || "Authorization",
    tokenPrefix:
      modelEntry.tokenPrefix !== undefined
        ? String(modelEntry.tokenPrefix || "")
        : (token ? "Bearer " : ""),
    agentName:
      readPresentString(modelEntry, ["agentName", "label", "name"]) ??
      String(alias).trim(),
    pluginList: asStringList(modelEntry.pluginList),
    engine: readPresentString(modelEntry, ["engine", "model", "modelId"]) ?? model,
    parameters: asPlainObject(modelEntry.parameters),
    systemPrompt: String(modelEntry.systemPrompt || modelEntry.prompt || "").trim(),
    timeoutMs: normalizeTimeout(modelEntry.timeoutMs)
  };
}

export function resolveAgentGatewayRegistry(settings = {}) {
  const entries = [];
  const seen = new Set();
  const addEntry = (entry, fallbacks = {}) => {
    const raw = asPlainObject(entry);
    const hasExplicitConfig = Boolean(
      raw.uid ||
        raw.instanceId ||
        raw.alias ||
        raw.modelAlias ||
        raw.url ||
        raw.token ||
        raw.apiKey ||
        raw.model ||
        raw.engine ||
        fallbacks.alias ||
        fallbacks.token
    );
    if (!hasExplicitConfig) {
      return;
    }
    const config = normalizeCustomHttpAdapterEntry(entry, settings, fallbacks);
    if (!config.alias || seen.has(config.alias) || (!config.url && !config.token && !config.model)) {
      return;
    }
    seen.add(config.alias);
    entries.push(config);
  };

  addEntry(
    asPlainObject(settings.customHttpAdapter),
    {
      alias: settings.customModelAlias,
      label: settings.customModelLabel,
      token: settings.customModelApiKey
    }
  );

  for (const item of Array.isArray(settings.customHttpAdapters)
    ? settings.customHttpAdapters
    : []) {
    addEntry(item);
  }

  for (const item of Array.isArray(settings.modelLibraryAgents)
    ? settings.modelLibraryAgents
    : []) {
    const provider = String(item?.provider || "").trim();
    if (provider === "deepseek") {
      const config = normalizeDeepSeekEntry(settings, item);
      if (config.alias && !seen.has(config.alias)) {
        seen.add(config.alias);
        entries.push(config);
      }
      continue;
    }
    if (provider === "custom-http") {
      addEntry(item);
      continue;
    }
    if (["openrouter", "copilot", "local-model"].includes(provider)) {
      const config = normalizeOpenAiCompatibleEntry(settings, item, provider);
      if (config.alias && !seen.has(config.alias)) {
        seen.add(config.alias);
        entries.push(config);
      }
    }
  }

  return entries.filter((entry) => entry.alias);
}

function publicAgentGatewayEntry(config) {
  return {
    alias: config.alias,
    model: config.model || "",
    provider: config.provider || "custom-http",
    label: config.label,
    callMode: "server-proxy",
    serverHttpPath: "/api/agent-gateway/call",
    serverRpcMethod: "agent_gateway.call",
    urlConfigured: Boolean(config.url),
    tokenConfigured: Boolean(config.token),
    agentName: config.agentName,
    pluginList: config.pluginList,
    engine: config.engine,
    timeoutMs: config.timeoutMs,
    parameterKeys: Object.keys(asPlainObject(config.parameters)),
    systemPromptConfigured: Boolean(config.systemPrompt),
    capabilities: ["agent.invoke", "knowledge.agent.answer"]
  };
}

export function publicAgentGatewayRegistry(settings = {}) {
  const agents = resolveAgentGatewayRegistry(settings).map(publicAgentGatewayEntry);
  const defaultAlias =
    agents.find((agent) => agent.urlConfigured && agent.tokenConfigured)?.alias ||
    agents.find((agent) => agent.provider === "custom-http")?.alias ||
    agents.find((agent) => agent.urlConfigured)?.alias ||
    agents[0]?.alias ||
    "";
  return {
    schemaVersion: "v0.0.1:schema:definition-1",
    provider: "agent-gateway",
    defaultAlias,
    agents
  };
}

export function resolveAgentGatewayConfig(settings = {}, input = {}) {
  const registry = resolveAgentGatewayRegistry(settings);
  const requestedProvider = String(input.provider || "").trim();
  const requestedAlias = adapterAlias(
    input.alias || input.agentAlias || input.modelAlias || input.model || "",
    ""
  );
  if (requestedProvider) {
    const byProvider = registry.find((entry) => entry.provider === requestedProvider);
    if (byProvider) {
      return byProvider;
    }
  }
  if (requestedAlias) {
    const explicitEntry = registry.find(
      (entry) => entry.alias === requestedAlias || entry.model === requestedAlias
    );
    if (explicitEntry) {
      return explicitEntry;
    }
    if (requestedAlias === "deepseek") {
      return normalizeDeepSeekEntry(settings, {});
    }
    if (["openrouter", "copilot", "local-model"].includes(requestedAlias)) {
      return normalizeOpenAiCompatibleEntry(settings, {}, requestedAlias);
    }
    return (
      registry.find((entry) => entry.provider === requestedAlias) ||
      normalizeCustomHttpAdapterEntry({ alias: requestedAlias }, settings)
    );
  }
  return registry[0] || normalizeCustomHttpAdapterEntry({}, settings);
}

export function publicAgentGatewayConfig(settings = {}) {
  const config = resolveAgentGatewayConfig(settings);
  return {
    ...config,
    token: "",
    urlConfigured: Boolean(config.url),
    tokenConfigured: Boolean(config.token)
  };
}

export function buildAgentGatewayPayload(input = {}, settings = {}) {
  const config = resolveAgentGatewayConfig(settings, input);
  const payload = {
    agentName: String(input.agentName || config.agentName || "").trim(),
    pluginList: asStringList(input.pluginList ?? config.pluginList),
    question: String(input.question || input.query || "").trim(),
    sessionId: String(input.sessionId || "").trim(),
    userId: String(input.userId || "").trim(),
    projectId: String(input.projectId || "").trim(),
    engine: String(input.engine || config.engine || "").trim(),
    parameters: {
      ...config.parameters,
      ...asPlainObject(input.parameters)
    }
  };
  const contextProfileId = String(input.contextProfileId || input.profileId || "").trim();
  const toolGrantId = String(input.toolGrantId || input.grantId || "").trim();
  if (contextProfileId) {
    payload.contextProfileId = contextProfileId;
  }
  if (toolGrantId) {
    payload.toolGrantId = toolGrantId;
    payload.grantId = toolGrantId;
  }
  if (input.workspaceContext && typeof input.workspaceContext === "object" && !Array.isArray(input.workspaceContext)) {
    payload.workspaceContext = {
      workspaceId: String(input.workspaceContext.workspaceId || "").trim(),
      currentGeneration: Number(input.workspaceContext.currentGeneration || 0),
      contextFingerprint: String(input.workspaceContext.contextFingerprint || "").trim(),
      contextProfileId: String(input.workspaceContext.contextProfileId || "").trim(),
      modelAlias: String(input.workspaceContext.modelAlias || "").trim(),
      toolGrantId: String(input.workspaceContext.toolGrantId || "").trim(),
      knowledgeSourceIds: asStringList(input.workspaceContext.knowledgeSourceIds)
    };
  }
  const systemPrompt = String(input.systemPrompt || config.systemPrompt || "").trim();
  if (systemPrompt) {
    payload.systemPrompt = systemPrompt;
  }
  if (systemPrompt && !payload.parameters.systemPrompt) {
    payload.parameters.systemPrompt = payload.systemPrompt;
  }
  return payload;
}

function createHeaders(config) {
  const headers = {
    "Content-Type": "application/json"
  };
  if (config.token) {
    headers[config.tokenHeader] = `${config.tokenPrefix || ""}${config.token}`;
  }
  return headers;
}

function resolveModuleAgentProfile(settings = {}, input = {}, config = {}) {
  const moduleId = String(
    input.moduleId || input.featureId || input.functionId || input.module || ""
  ).trim();
  if (!moduleId) {
    return null;
  }
  const alias = String(config.alias || input.alias || input.modelAlias || "").trim();
  const group = asPlainObject(settings.moduleAgentProfiles?.[moduleId]);
  const profile = asPlainObject(group.agents?.[alias]);
  if (!alias || !profile || profile.enabled === false) {
    return null;
  }
  return {
    moduleId,
    alias,
    role: String(profile.role || "primary").trim() || "primary",
    contextProfileId: String(profile.contextProfileId || "").trim(),
    systemPrompt: String(profile.systemPrompt || "").trim(),
    parameters: asPlainObject(profile.parameters),
    dependencyContext: asPlainObject(profile.dependencyContext || profile.dependencies)
  };
}

function withModuleAgentProfileInput(settings = {}, input = {}, config = {}) {
  const profile = resolveModuleAgentProfile(settings, input, config);
  if (!profile) {
    return {
      input,
      profile: null
    };
  }
  const dependencyBlock = {
    moduleId: profile.moduleId,
    agentAlias: profile.alias,
    role: profile.role,
    contextProfileId: profile.contextProfileId,
    sessionId: String(input.sessionId || "").trim(),
    taskId: String(input.taskId || input.runId || "").trim(),
    dependencyContext: profile.dependencyContext
  };
  const modulePrompt = [
    profile.systemPrompt,
    `模块/功能运行上下文：${JSON.stringify(dependencyBlock)}`
  ].filter(Boolean).join("\n\n");
  return {
    profile,
    input: {
      ...input,
      moduleAgentProfile: dependencyBlock,
      systemPrompt: [modulePrompt, input.systemPrompt].filter(Boolean).join("\n\n"),
      parameters: {
        ...profile.parameters,
        ...asPlainObject(input.parameters)
      },
      contextProfileId: input.contextProfileId || profile.contextProfileId || ""
    }
  };
}

function deepSeekChatCompletionsUrl(baseUrl) {
  const normalized = String(baseUrl || "https://api.deepseek.com").trim()
    .replace(/\/+$/, "");
  if (/\/chat\/completions$/i.test(normalized)) {
    return normalized;
  }
  return `${normalized}/chat/completions`;
}

function chatCompletionsUrl(baseUrl) {
  const normalized = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!normalized) {
    return "";
  }
  if (/\/chat\/completions$/i.test(normalized)) {
    return normalized;
  }
  return `${normalized}/chat/completions`;
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
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

  const directKeys = ["text", "content", "output_text", "value"];
  for (const key of directKeys) {
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

function choiceTextFromJson(json) {
  const choices = Array.isArray(json?.choices) ? json.choices : [];
  return choices
    .map((choice) => {
      const message = asPlainObject(choice?.message);
      const delta = asPlainObject(choice?.delta);
      return (
        textFromContent(message.content) ||
        textFromContent(delta.content) ||
        textFromContent(choice?.text)
      );
    })
    .join("");
}

function reasoningTextFromMessage(message = {}, delta = {}) {
  return [
    message.reasoning_content,
    delta.reasoning_content,
    message.reasoning,
    delta.reasoning,
    message.reasoning_details,
    delta.reasoning_details,
    message.thinking,
    delta.thinking
  ]
    .map((item) => textFromContent(item, { includeReasoning: true }))
    .join("");
}

function contentFromEvent(event) {
  const data = asPlainObject(event?.data);
  return textFromContent(data.content);
}

export function createAgentStreamAccumulator() {
  const events = [];
  const answerParts = [];
  const textParts = [];
  const rawTextParts = [];
  let dialogId = "";
  let finish = false;

  function push(event) {
    if (!event || typeof event !== "object") {
      return;
    }
    const type = String(event.type || "");
    const content = contentFromEvent(event);
    events.push({
      type,
      content,
      nodeId: event?.data?.nodeId || null,
      riskDescription: event?.data?.riskDescription || null,
      finish: event.finish === true
    });
    if (type === "answer") {
      answerParts.push(content);
    } else if (type === "text") {
      textParts.push(content);
    } else if (type === "dialogId") {
      dialogId = content;
    } else if (type === "finish" || event.finish === true) {
      finish = true;
    } else if (type === "rawData" && content) {
      const raw = safeJsonParse(content);
      if (raw && raw.text !== undefined && raw.text !== null) {
        rawTextParts.push(String(raw.text));
      }
    }
  }

  function result() {
    const answer =
      answerParts.length > 0
        ? answerParts.join("")
        : textParts.length > 0
          ? textParts.join("")
          : rawTextParts.join("");
    return {
      answer,
      text: answer,
      dialogId,
      finish,
      events,
      chunks: {
        answer: answerParts,
        text: textParts,
        rawText: rawTextParts
      }
    };
  }

  return { push, result };
}

export function parseAgentGatewayStreamText(streamText) {
  const accumulator = createAgentStreamAccumulator();
  for (const rawLine of String(streamText || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || !line.startsWith("data:")) {
      continue;
    }
    const payloadText = line.slice("data:".length).trim();
    if (!payloadText || payloadText === "[DONE]") {
      continue;
    }
    const event = safeJsonParse(payloadText);
    if (event) {
      accumulator.push(event);
    }
  }
  return accumulator.result();
}

async function readStreamResponse(response) {
  const accumulator = createAgentStreamAccumulator();
  const decoder = new TextDecoder();
  let pending = "";
  let totalBytes = 0;

  for await (const chunk of response.body) {
    totalBytes += byteLengthOfChunk(chunk);
    if (totalBytes > MAX_AGENT_GATEWAY_RESPONSE_BYTES) {
      throw gatewayResponseTooLargeError("Agent gateway stream response");
    }
    pending += decoder.decode(chunk, { stream: true });
    let lineEndIndex = pending.indexOf("\n");
    while (lineEndIndex >= 0) {
      const rawLine = pending.slice(0, lineEndIndex).replace(/\r$/, "");
      pending = pending.slice(lineEndIndex + 1);
      const line = rawLine.trim();
      if (line.startsWith("data:")) {
        const payloadText = line.slice("data:".length).trim();
        if (payloadText && payloadText !== "[DONE]") {
          const event = safeJsonParse(payloadText);
          if (event) {
            accumulator.push(event);
          }
        }
      }
      lineEndIndex = pending.indexOf("\n");
    }
  }

  pending += decoder.decode();
  const finalLine = pending.trim();
  if (finalLine.startsWith("data:")) {
    const event = safeJsonParse(finalLine.slice("data:".length).trim());
    if (event) {
      accumulator.push(event);
    }
  }
  return accumulator.result();
}

async function readJsonOrTextResponse(response) {
  const text = await readGatewayResponseTextWithLimit(response);
  if (text.includes("data:")) {
    return parseAgentGatewayStreamText(text);
  }
  const json = safeJsonParse(text);
  if (!json) {
    return {
      answer: text,
      text,
      dialogId: "",
      finish: true,
      events: [],
      payload: text
    };
  }
  const data = asPlainObject(json.data);
  const toolCalls = [
    ...asArray(json.toolCalls || json.tool_calls),
    ...asArray(data.toolCalls || data.tool_calls),
    ...asArray(json?.choices).flatMap((choice) => toolCallsFromMessage(asPlainObject(choice?.message))),
    ...asArray(data?.choices).flatMap((choice) => toolCallsFromMessage(asPlainObject(choice?.message)))
  ]
    .map(normalizeGatewayToolCall)
    .filter(Boolean);
  const answer =
    textFromContent(json.answer) ||
    textFromContent(json.text) ||
    textFromContent(json.content) ||
    textFromContent(data.answer) ||
    textFromContent(data.text) ||
    textFromContent(data.content) ||
    choiceTextFromJson(json) ||
    choiceTextFromJson(data);
  return {
    answer,
    text: answer,
    dialogId: String(json.dialogId || json.data?.dialogId || ""),
    finish: json.finish !== false,
    events: [],
    payload: json,
    toolCalls
  };
}

const DEEPSEEK_PARAMETER_KEYS = new Set([
  "frequency_penalty",
  "logprobs",
  "max_tokens",
  "presence_penalty",
  "reasoning_effort",
  "response_format",
  "seed",
  "stop",
  "temperature",
  "thinking",
  "tool_choice",
  "tools",
  "top_logprobs",
  "top_p"
]);

const OPENAI_COMPATIBLE_PARAMETER_KEYS = new Set([
  ...DEEPSEEK_PARAMETER_KEYS,
  "best_of",
  "chat_template_kwargs",
  "echo",
  "guided_choice",
  "guided_decoding_backend",
  "guided_grammar",
  "guided_json",
  "guided_regex",
  "ignore_eos",
  "include_stop_str_in_output",
  "min_p",
  "min_tokens",
  "n",
  "parallel_tool_calls",
  "repetition_penalty",
  "skip_special_tokens",
  "spaces_between_special_tokens",
  "stream_options",
  "top_k",
  "use_beam_search"
]);

const CHAT_COMPLETIONS_RESERVED_KEYS = new Set(["model", "messages"]);

function normalizeDeepSeekMessages(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((message) => {
      if (!message || typeof message !== "object") {
        return null;
      }
      const role = String(message.role || "").trim();
      if (!role) {
        return null;
      }
      const normalized = {
        role,
        content:
          message.content === undefined || message.content === null
            ? ""
            : message.content
      };
      const reasoningContent =
        message.reasoning_content === undefined || message.reasoning_content === null
          ? message.reasoning
          : message.reasoning_content;
      if (reasoningContent !== undefined && reasoningContent !== null) {
        normalized.reasoning_content = textFromContent(reasoningContent, {
          includeReasoning: true
        });
      }
      if (message.tool_calls !== undefined && message.tool_calls !== null) {
        normalized.tool_calls = message.tool_calls;
      }
      if (message.tool_call_id !== undefined && message.tool_call_id !== null) {
        normalized.tool_call_id = String(message.tool_call_id);
      }
      if (message.name !== undefined && message.name !== null) {
        normalized.name = String(message.name);
      }
      return normalized;
    })
    .filter(Boolean);
}

function resolveDeepSeekModel(input = {}, config = {}) {
  if (config.modelFieldPresent === true && !String(config.model || config.engine || "").trim()) {
    return "";
  }
  const candidates = [
    input.engine,
    input.deepSeekModel,
    input.model,
    config.engine,
    config.model
  ];
  for (const candidate of candidates) {
    const model = String(candidate || "").trim();
    if (!model || model === config.alias || model === config.provider) {
      continue;
    }
    return model;
  }
  return "deepseek-v4-pro";
}

function normalizePactThinkingMode(value) {
  const mode = String(value || "").trim().toLowerCase();
  return ["enabled", "disabled"].includes(mode) ? mode : "";
}

function applyPactThinkingMode(parameters = {}, config = {}, input = {}) {
  const mode = normalizePactThinkingMode(parameters.pact_thinking_mode);
  delete parameters.pact_thinking_mode;
  if (!mode) {
    return parameters;
  }
  const model = resolveDeepSeekModel(input, config);
  const isQwenCompatible =
    String(config.provider || "").trim() === "local-model" ||
    /qwen/i.test(model);
  if (isQwenCompatible) {
    parameters.chat_template_kwargs = {
      ...asPlainObject(parameters.chat_template_kwargs),
      enable_thinking: mode === "enabled"
    };
    return parameters;
  }
  if (parameters.thinking === undefined || parameters.thinking === null) {
    parameters.thinking = { type: mode };
  }
  return parameters;
}

function buildChatMessages(input = {}, config = {}, parameters = {}) {
  const messages = normalizeDeepSeekMessages(input.messages);
  const configuredSystemPrompt = String(
    input.systemPrompt || config.systemPrompt || parameters.systemPrompt || ""
  ).trim();
  if (messages.length === 0) {
    if (configuredSystemPrompt) {
      messages.push({ role: "system", content: configuredSystemPrompt });
    }
    messages.push({
      role: "user",
      content: String(input.question || input.query || "").trim()
    });
  } else if (configuredSystemPrompt) {
    messages.unshift({ role: "system", content: configuredSystemPrompt });
  }
  return messages;
}

function buildDeepSeekRequest(input = {}, config = {}) {
  const parameters = {
    ...asPlainObject(config.parameters),
    ...asPlainObject(input.parameters)
  };
  applyPactThinkingMode(parameters, config, input);
  const messages = buildChatMessages(input, config, parameters);
  delete parameters.systemPrompt;

  const model = resolveDeepSeekModel(input, config);
  if (!model) {
    throw new Error("DeepSeek 模型 ID 为空，不能发起模型调用。");
  }

  const body = {
    model,
    messages,
    stream: input.stream === true || parameters.stream === true
  };

  for (const [key, value] of Object.entries(parameters)) {
    if (DEEPSEEK_PARAMETER_KEYS.has(key) && value !== undefined && value !== null) {
      body[key] = value;
    }
  }

  return body;
}

function buildOpenAiCompatibleRequest(input = {}, config = {}) {
  const configParameters = asPlainObject(config.parameters);
  const inputParameters = asPlainObject(input.parameters);
  const parameters = {
    ...configParameters,
    ...inputParameters
  };
  applyPactThinkingMode(parameters, config, input);
  const extraBody = {
    ...asPlainObject(configParameters.extra_body),
    ...asPlainObject(inputParameters.extra_body)
  };
  const messages = buildChatMessages(input, config, parameters);
  delete parameters.systemPrompt;
  delete parameters.extra_body;

  const body = {
    model: resolveDeepSeekModel(input, config),
    messages,
    stream: input.stream === true || parameters.stream === true
  };

  for (const [key, value] of Object.entries(extraBody)) {
    if (
      !CHAT_COMPLETIONS_RESERVED_KEYS.has(key) &&
      value !== undefined &&
      value !== null
    ) {
      body[key] = value;
    }
  }

  for (const [key, value] of Object.entries(parameters)) {
    if (OPENAI_COMPATIBLE_PARAMETER_KEYS.has(key) && value !== undefined && value !== null) {
      body[key] = value;
    }
  }

  return body;
}

function deepSeekEvent(type, content, extra = {}) {
  return {
    type,
    content,
    nodeId: extra.nodeId || null,
    riskDescription: null,
    finish: extra.finish === true
  };
}

function normalizeGatewayToolCall(call = {}, index = 0) {
  if (!call || typeof call !== "object") {
    return null;
  }
  const fn = asPlainObject(call.function || call.function_call);
  const name = String(call.name || fn.name || "").trim();
  if (!name) {
    return null;
  }
  const args = fn.arguments ?? call.arguments ?? {};
  return {
    id: String(call.id || call.tool_call_id || `tool_call_${index + 1}`),
    type: "function",
    function: {
      name,
      arguments:
        typeof args === "string"
          ? args
          : JSON.stringify(asPlainObject(args))
    }
  };
}

function toolCallsFromMessage(message = {}) {
  const calls = [];
  for (const call of Array.isArray(message.tool_calls) ? message.tool_calls : []) {
    const normalized = normalizeGatewayToolCall(call, calls.length);
    if (normalized) {
      calls.push(normalized);
    }
  }
  if (message.function_call) {
    const normalized = normalizeGatewayToolCall(message.function_call, calls.length);
    if (normalized) {
      calls.push(normalized);
    }
  }
  return calls;
}

function parseDeepSeekJsonPayload(json) {
  const choices = Array.isArray(json?.choices) ? json.choices : [];
  const answerParts = [];
  const reasoningParts = [];
  const toolCalls = [];
  let finish = false;
  for (const choice of choices) {
    const message = asPlainObject(choice?.message);
    const delta = asPlainObject(choice?.delta);
    const content =
      message.content === undefined || message.content === null
        ? delta.content
        : message.content;
    const answerText = textFromContent(content);
    if (answerText) {
      answerParts.push(answerText);
    }
    const reasoningText = reasoningTextFromMessage(message, delta);
    if (reasoningText) {
      reasoningParts.push(reasoningText);
    }
    for (const call of toolCallsFromMessage(message)) {
      toolCalls.push(call);
    }
    if (choice?.finish_reason) {
      finish = true;
    }
  }
  const answer = answerParts.join("");
  return {
    answer,
    text: answer,
    dialogId: String(json?.id || ""),
    finish: finish || Boolean(json?.id),
    events: [
      ...reasoningParts.map((content) => deepSeekEvent("reasoning", content)),
      ...answerParts.map((content) => deepSeekEvent("answer", content, { finish }))
    ],
    chunks: {
      answer: answerParts,
      reasoning: reasoningParts
    },
    toolCalls,
    payload: {
      id: json?.id || "",
      model: json?.model || "",
      usage: json?.usage || null
    }
  };
}

async function readDeepSeekJsonResponse(response) {
  const text = await readGatewayResponseTextWithLimit(response, { label: "DeepSeek response" });
  if (text.includes("data:")) {
    return parseDeepSeekStreamText(text);
  }
  const json = safeJsonParse(text);
  if (!json) {
    return {
      answer: text,
      text,
      dialogId: "",
      finish: true,
      events: [],
      payload: text
    };
  }
  return parseDeepSeekJsonPayload(json);
}

export function parseDeepSeekStreamText(streamText) {
  const answerParts = [];
  const reasoningParts = [];
  const toolCallParts = new Map();
  const events = [];
  let dialogId = "";
  let finish = false;
  let model = "";

  const mergeToolCallDelta = (call = {}, fallbackIndex = 0) => {
    if (!call || typeof call !== "object") {
      return;
    }
    const index = Number.isInteger(call.index) ? call.index : fallbackIndex;
    const current =
      toolCallParts.get(index) || {
        id: "",
        type: "function",
        function: {
          name: "",
          arguments: ""
        }
      };
    if (call.id !== undefined && call.id !== null) {
      current.id = String(call.id);
    }
    if (call.type !== undefined && call.type !== null) {
      current.type = String(call.type || "function") || "function";
    }
    const fn = asPlainObject(call.function || call.function_call);
    if (fn.name !== undefined && fn.name !== null) {
      current.function.name = String(fn.name);
    }
    if (fn.arguments !== undefined && fn.arguments !== null) {
      current.function.arguments += String(fn.arguments);
    }
    toolCallParts.set(index, current);
  };

  for (const rawLine of String(streamText || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || !line.startsWith("data:")) {
      continue;
    }
    const payloadText = line.slice("data:".length).trim();
    if (!payloadText) {
      continue;
    }
    if (payloadText === "[DONE]") {
      finish = true;
      continue;
    }
    const payload = safeJsonParse(payloadText);
    if (!payload) {
      continue;
    }
    dialogId = dialogId || String(payload.id || "");
    model = model || String(payload.model || "");
    const choices = Array.isArray(payload.choices) ? payload.choices : [];
    for (const choice of choices) {
      const delta = asPlainObject(choice.delta);
      const reasoningText = reasoningTextFromMessage({}, delta);
      if (reasoningText) {
        const content = reasoningText;
        reasoningParts.push(content);
        events.push(deepSeekEvent("reasoning", content));
      }
      const answerText = textFromContent(delta.content);
      if (answerText) {
        const content = answerText;
        answerParts.push(content);
        events.push(deepSeekEvent("answer", content));
      }
      asArray(delta.tool_calls).forEach((call, index) => {
        mergeToolCallDelta(call, index);
      });
      if (delta.function_call) {
        mergeToolCallDelta({ index: 0, function: delta.function_call }, 0);
      }
      if (choice.finish_reason) {
        finish = true;
      }
    }
  }
  const answer = answerParts.join("");
  return {
    answer,
    text: answer,
    dialogId,
    finish,
    events,
    chunks: {
      answer: answerParts,
      reasoning: reasoningParts
    },
    toolCalls: Array.from(toolCallParts.entries())
      .sort(([left], [right]) => left - right)
      .map(([, call], index) => normalizeGatewayToolCall(call, index))
      .filter(Boolean),
    payload: {
      id: dialogId,
      model
    }
  };
}

async function readDeepSeekStreamResponse(response) {
  const decoder = new TextDecoder();
  let pending = "";
  let streamText = "";
  let totalBytes = 0;
  for await (const chunk of response.body) {
    totalBytes += byteLengthOfChunk(chunk);
    if (totalBytes > MAX_AGENT_GATEWAY_RESPONSE_BYTES) {
      throw gatewayResponseTooLargeError("DeepSeek stream response");
    }
    pending += decoder.decode(chunk, { stream: true });
    let lineEndIndex = pending.indexOf("\n");
    while (lineEndIndex >= 0) {
      const rawLine = pending.slice(0, lineEndIndex).replace(/\r$/, "");
      pending = pending.slice(lineEndIndex + 1);
      streamText += `${rawLine}\n`;
      lineEndIndex = pending.indexOf("\n");
    }
  }
  pending += decoder.decode();
  if (pending) {
    streamText += pending;
  }
  return parseDeepSeekStreamText(streamText);
}

async function callDeepSeekGateway({
  config,
  input = {},
  fetchImpl = fetch,
  userDataPath = ""
} = {}) {
  if (!config.token) {
    throw new Error("DeepSeek API Key 未配置。");
  }
  const question = String(input.question || input.query || "").trim();
  if (!question && !Array.isArray(input.messages)) {
    throw new Error("question 不能为空。");
  }
  const payload = buildDeepSeekRequest(input, config);
  const request = {
    agentName: String(input.agentName || config.agentName || "").trim(),
    pluginList: asStringList(input.pluginList ?? config.pluginList),
    question,
    sessionId: String(input.sessionId || "").trim(),
    userId: String(input.userId || "").trim(),
    projectId: String(input.projectId || "").trim(),
    engine: payload.model,
    parameters: {
      ...asPlainObject(config.parameters),
      ...asPlainObject(input.parameters)
    }
  };
  const auditCallId = crypto.randomUUID();
  const upstreamTarget = safeUrlSummary(config.url);
  await appendAgentGatewayAudit({
    userDataPath,
    event: {
      event: "request_started",
      callId: auditCallId,
      provider: "deepseek",
      alias: config.alias,
      model: payload.model,
      upstreamTarget,
      timeoutMs: config.timeoutMs,
      request: summarizeDeepSeekPayload(payload)
    }
  });
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), config.timeoutMs);
  let response;
  try {
    response = await fetchImpl(config.url, {
      method: "POST",
      headers: createHeaders(config),
      body: JSON.stringify(payload),
      signal: abortController.signal
    });
  } catch (error) {
    await appendAgentGatewayAudit({
      userDataPath,
      event: {
        event: "request_failed",
        callId: auditCallId,
        provider: "deepseek",
        alias: config.alias,
        model: payload.model,
        upstreamTarget,
        errorStage: "transport",
        error: error instanceof Error ? error.message : String(error)
      }
    });
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const details = await readGatewayErrorDetails(response, "DeepSeek error response");
    const publicDetails = truncateText(redactSecretText(details), 8000);
    await appendAgentGatewayAudit({
      userDataPath,
      event: {
        event: "request_failed",
        callId: auditCallId,
        provider: "deepseek",
        alias: config.alias,
        model: payload.model,
        upstreamTarget,
        errorStage: "http",
        status: response.status,
        contentType: String(response.headers.get("content-type") || ""),
        error: publicDetails
      }
    });
    throw new Error(`DeepSeek 调用失败：${response.status}${publicDetails ? ` ${publicDetails}` : ""}`.trim());
  }

  const contentType = String(response.headers.get("content-type") || "");
  const parsed =
    /text\/event-stream/i.test(contentType) && response.body
      ? await readDeepSeekStreamResponse(response)
      : await readDeepSeekJsonResponse(response);
  const result = {
    ok: true,
    request: {
      ...request,
      engine: payload.model
    },
    upstream: {
      provider: "deepseek",
      status: response.status,
      contentType,
      model: payload.model
    },
    ...parsed
  };
  await appendAgentGatewayAudit({
    userDataPath,
    event: {
      event: "request_completed",
      callId: auditCallId,
      provider: "deepseek",
      alias: config.alias,
      model: payload.model,
      upstreamTarget,
      status: response.status,
      contentType,
      response: summarizeGatewayResult(result)
    }
  });

  return result;
}

async function callOpenAiCompatibleGateway({
  config,
  input = {},
  fetchImpl = fetch,
  userDataPath = ""
} = {}) {
  const provider = config.provider || "openai-compatible";
  if (provider !== "local-model" && !config.token) {
    throw new Error(`${config.label || provider} API Key 未配置。`);
  }
  const question = String(input.question || input.query || "").trim();
  if (!question && !Array.isArray(input.messages)) {
    throw new Error("question 不能为空。");
  }
  const payload = buildOpenAiCompatibleRequest(input, config);
  const request = {
    agentName: String(input.agentName || config.agentName || "").trim(),
    pluginList: asStringList(input.pluginList ?? config.pluginList),
    question,
    sessionId: String(input.sessionId || "").trim(),
    userId: String(input.userId || "").trim(),
    projectId: String(input.projectId || "").trim(),
    engine: payload.model,
    parameters: {
      ...asPlainObject(config.parameters),
      ...asPlainObject(input.parameters)
    }
  };
  const auditCallId = crypto.randomUUID();
  const upstreamTarget = safeUrlSummary(config.url);
  await appendAgentGatewayAudit({
    userDataPath,
    event: {
      event: "request_started",
      callId: auditCallId,
      provider,
      alias: config.alias,
      model: payload.model,
      upstreamTarget,
      timeoutMs: config.timeoutMs,
      request: summarizeDeepSeekPayload(payload)
    }
  });
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), config.timeoutMs);
  let response;
  try {
    response = await fetchImpl(config.url, {
      method: "POST",
      headers: createHeaders(config),
      body: JSON.stringify(payload),
      signal: abortController.signal
    });
  } catch (error) {
    await appendAgentGatewayAudit({
      userDataPath,
      event: {
        event: "request_failed",
        callId: auditCallId,
        provider,
        alias: config.alias,
        model: payload.model,
        upstreamTarget,
        errorStage: "transport",
        error: error instanceof Error ? error.message : String(error)
      }
    });
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const details = await readGatewayErrorDetails(response, `${config.label || provider} error response`);
    const publicDetails = truncateText(redactSecretText(details), 8000);
    await appendAgentGatewayAudit({
      userDataPath,
      event: {
        event: "request_failed",
        callId: auditCallId,
        provider,
        alias: config.alias,
        model: payload.model,
        upstreamTarget,
        errorStage: "http",
        status: response.status,
        contentType: String(response.headers.get("content-type") || ""),
        error: publicDetails
      }
    });
    throw new Error(`${config.label || provider} 调用失败：${response.status}${publicDetails ? ` ${publicDetails}` : ""}`.trim());
  }

  const contentType = String(response.headers.get("content-type") || "");
  const parsed =
    /text\/event-stream/i.test(contentType) && response.body
      ? await readDeepSeekStreamResponse(response)
      : await readDeepSeekJsonResponse(response);
  const result = {
    ok: true,
    request: {
      ...request,
      engine: payload.model
    },
    upstream: {
      provider,
      status: response.status,
      contentType,
      model: payload.model
    },
    ...parsed
  };
  await appendAgentGatewayAudit({
    userDataPath,
    event: {
      event: "request_completed",
      callId: auditCallId,
      provider,
      alias: config.alias,
      model: payload.model,
      upstreamTarget,
      status: response.status,
      contentType,
      response: summarizeGatewayResult(result)
    }
  });

  return result;
}

async function executeAgentGatewayCandidate({
  settings = {},
  input = {},
  fetchImpl = fetch,
  userDataPath = "",
  dryRun = false
} = {}) {
  const config = resolveAgentGatewayConfig(settings, input);
  const moduleProfileLayer = withModuleAgentProfileInput(settings, input, config);
  const effectiveInput = moduleProfileLayer.input;
  if (!config.url) {
    throw new Error(`智能体 URL 未配置：${config.alias || "default"}`);
  }
  if (dryRun) {
    return { config, input: effectiveInput, result: null };
  }
  if (config.provider === "deepseek") {
    const result = await callDeepSeekGateway({ config, input: effectiveInput, fetchImpl, userDataPath });
    return { config, input: effectiveInput, result };
  }
  if (["openrouter", "copilot", "local-model"].includes(config.provider)) {
    const result = await callOpenAiCompatibleGateway({ config, input: effectiveInput, fetchImpl, userDataPath });
    return { config, input: effectiveInput, result };
  }
  const payload = buildAgentGatewayPayload(effectiveInput, settings);
  if (!payload.question) {
    throw new Error("question 不能为空。");
  }

  const auditCallId = crypto.randomUUID();
  const upstreamTarget = safeUrlSummary(config.url);
  await appendAgentGatewayAudit({
    userDataPath,
    event: {
      event: "request_started",
      callId: auditCallId,
      provider: config.provider || "custom-http",
      alias: config.alias,
      model: config.model || config.alias,
      upstreamTarget,
      timeoutMs: config.timeoutMs,
      request: summarizeAgentGatewayPayload(payload)
    }
  });
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), config.timeoutMs);
  let response;
  try {
    response = await fetchImpl(config.url, {
      method: "POST",
      headers: createHeaders(config),
      body: JSON.stringify(payload),
      signal: abortController.signal
    });
  } catch (error) {
    await appendAgentGatewayAudit({
      userDataPath,
      event: {
        event: "request_failed",
        callId: auditCallId,
        provider: config.provider || "custom-http",
        alias: config.alias,
        model: config.model || config.alias,
        upstreamTarget,
        errorStage: "transport",
        error: error instanceof Error ? error.message : String(error)
      }
    });
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const details = await readGatewayErrorDetails(response, "Agent gateway error response");
    const publicDetails = truncateText(redactSecretText(details), 8000);
    await appendAgentGatewayAudit({
      userDataPath,
      event: {
        event: "request_failed",
        callId: auditCallId,
        provider: config.provider || "custom-http",
        alias: config.alias,
        model: config.model || config.alias,
        upstreamTarget,
        errorStage: "http",
        status: response.status,
        contentType: String(response.headers.get("content-type") || ""),
        error: publicDetails
      }
    });
    throw new Error(`智能体调用失败：${response.status}${publicDetails ? ` ${publicDetails}` : ""}`.trim());
  }

  const contentType = String(response.headers.get("content-type") || "");
  const isStream =
    /text\/event-stream/i.test(contentType) ||
    /application\/x-ndjson/i.test(contentType);
  const parsed = isStream && response.body
    ? await readStreamResponse(response)
    : await readJsonOrTextResponse(response);

  const result = {
    ok: true,
    request: payload,
    upstream: {
      status: response.status,
      contentType
    },
    ...parsed
  };
  await appendAgentGatewayAudit({
    userDataPath,
    event: {
      event: "request_completed",
      callId: auditCallId,
      provider: config.provider || "custom-http",
      alias: config.alias,
      model: config.model || config.alias,
      upstreamTarget,
      status: response.status,
      contentType,
      response: summarizeGatewayResult(result)
    }
  });
  return { config, input: effectiveInput, result };
}

export async function callAgentGateway({
  settings = {},
  input = {},
  fetchImpl = fetch,
  userDataPath = "",
  contextRuntime = null,
  contextCompactionSource = "agent-gateway",
  clientRuntimeAllocator = null,
  strategyProvider = null
} = {}) {
  const allocationResult = typeof clientRuntimeAllocator?.apply === "function"
    ? await clientRuntimeAllocator.apply(input, {
        taskType: input.taskType || input.operationId || input.moduleId || "agent_gateway.call",
        surface: contextCompactionSource || "agent-gateway"
      })
    : null;
  const allocatedInput = allocationResult?.input || input;
  const prepared = await prepareAgentGatewayInputWithCompaction({
    input: allocatedInput,
    contextRuntime,
    source: contextCompactionSource
  });
  let effectiveInput = prepared.input;
  const contextCompaction = publicGatewayCompactionResult(prepared.compaction);
  const withRuntimeMetadata = (result = {}) => {
    const withAllocation = allocationResult?.allocation
      ? { ...result, clientRuntimeAllocation: allocationResult.allocation }
      : result;
    return contextCompaction ? { ...withAllocation, contextCompaction } : withAllocation;
  };
  if (shouldUseModelRouting(effectiveInput, settings)) {
    const routingInput = {
      settings,
      input: effectiveInput,
      userDataPath,
      registry: resolveAgentGatewayRegistry(settings),
      executeCandidate: ({ input: candidateInput, dryRun }) =>
        executeAgentGatewayCandidate({
          settings,
          input: candidateInput,
          fetchImpl,
          userDataPath,
          dryRun
        })
    };
    const routed = typeof strategyProvider?.runModelRouting === "function"
      ? await strategyProvider.runModelRouting({
          ...routingInput,
          baseRunModelRouting: runModelRouting
        })
      : await runModelRouting(routingInput);
    return withRuntimeMetadata({
      ...routed.result,
      modelRouting: routed.routing
    });
  }
  const executed = await executeAgentGatewayCandidate({
    settings,
    input: effectiveInput,
    fetchImpl,
    userDataPath
  });
  return withRuntimeMetadata(executed.result);
}

export async function inspectAgentModelRouting({ userDataPath = "", limit = 50 } = {}) {
  return inspectModelRouting({ userDataPath, limit });
}
