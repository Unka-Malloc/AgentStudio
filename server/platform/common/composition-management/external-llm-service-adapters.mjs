import {
  EXTERNAL_SERVICE_MODEL_PROTOCOL,
  EXTERNAL_SERVICE_MODEL_PROTOCOL_VALUES,
  EXTERNAL_SERVICE_UPSTREAM_TYPE
} from "./external-service-adapter.mjs";

export const EXTERNAL_LLM_SERVICE_ADAPTER_KIND = "pact.external-llm-service.adapter-registry";
export const EXTERNAL_LLM_SERVICE_ADAPTER_STATUS = "scaffold";

function normalizeProtocol(value = "") {
  return String(value || "").trim() || EXTERNAL_SERVICE_MODEL_PROTOCOL.CUSTOM_JSON_HTTP;
}

function unimplementedLlmServiceAdapter({ adapterId, config, input, context } = {}) {
  // TODO: Replace this scaffold with the real LLM protocol adapter implementation.
  return { ok: false, status: "not_implemented", adapterId, config, input, context };
}

function openAiCompatibleAdapter(params = {}) {
  // TODO: Replace with OpenAI-compatible Chat Completions request/response mapping.
  return unimplementedLlmServiceAdapter({ ...params, adapterId: EXTERNAL_SERVICE_MODEL_PROTOCOL.OPENAI_COMPATIBLE });
}

function openAiResponsesAdapter(params = {}) {
  // TODO: Replace with OpenAI Responses request/response mapping.
  return unimplementedLlmServiceAdapter({ ...params, adapterId: EXTERNAL_SERVICE_MODEL_PROTOCOL.OPENAI_RESPONSES });
}

function anthropicMessagesAdapter(params = {}) {
  // TODO: Replace with Anthropic Messages request/response mapping.
  return unimplementedLlmServiceAdapter({ ...params, adapterId: EXTERNAL_SERVICE_MODEL_PROTOCOL.ANTHROPIC_MESSAGES });
}

function geminiGenerateContentAdapter(params = {}) {
  // TODO: Replace with Gemini generateContent request/response mapping.
  return unimplementedLlmServiceAdapter({ ...params, adapterId: EXTERNAL_SERVICE_MODEL_PROTOCOL.GEMINI_GENERATE_CONTENT });
}

function bedrockConverseAdapter(params = {}) {
  // TODO: Replace with AWS Bedrock Converse request/response mapping.
  return unimplementedLlmServiceAdapter({ ...params, adapterId: EXTERNAL_SERVICE_MODEL_PROTOCOL.BEDROCK_CONVERSE });
}

function cohereChatAdapter(params = {}) {
  // TODO: Replace with Cohere Chat request/response mapping.
  return unimplementedLlmServiceAdapter({ ...params, adapterId: EXTERNAL_SERVICE_MODEL_PROTOCOL.COHERE_CHAT });
}

function ollamaNativeAdapter(params = {}) {
  // TODO: Replace with Ollama native /api/chat and /api/generate mapping.
  return unimplementedLlmServiceAdapter({ ...params, adapterId: EXTERNAL_SERVICE_MODEL_PROTOCOL.OLLAMA_NATIVE });
}

function dashscopeNativeAdapter(params = {}) {
  // TODO: Replace with DashScope native generation and multimodal-generation mapping.
  return unimplementedLlmServiceAdapter({ ...params, adapterId: EXTERNAL_SERVICE_MODEL_PROTOCOL.DASHSCOPE_NATIVE });
}

function huggingFaceTgiAdapter(params = {}) {
  // TODO: Replace with Hugging Face TGI request/response mapping.
  return unimplementedLlmServiceAdapter({ ...params, adapterId: EXTERNAL_SERVICE_MODEL_PROTOCOL.HUGGINGFACE_TGI });
}

function azureAiInferenceAdapter(params = {}) {
  // TODO: Replace with Azure AI Inference request/response mapping.
  return unimplementedLlmServiceAdapter({ ...params, adapterId: EXTERNAL_SERVICE_MODEL_PROTOCOL.AZURE_AI_INFERENCE });
}

function vertexAiPredictionAdapter(params = {}) {
  // TODO: Replace with Vertex AI Prediction request/response mapping.
  return unimplementedLlmServiceAdapter({ ...params, adapterId: EXTERNAL_SERVICE_MODEL_PROTOCOL.VERTEX_AI_PREDICTION });
}

function customJsonHttpAdapter(params = {}) {
  // TODO: Replace with the DSL-driven custom JSON HTTP request/response mapper.
  return unimplementedLlmServiceAdapter({ ...params, adapterId: EXTERNAL_SERVICE_MODEL_PROTOCOL.CUSTOM_JSON_HTTP });
}

const EXTERNAL_LLM_SERVICE_ADAPTERS = Object.freeze({
  [EXTERNAL_SERVICE_MODEL_PROTOCOL.OPENAI_COMPATIBLE]: openAiCompatibleAdapter,
  [EXTERNAL_SERVICE_MODEL_PROTOCOL.OPENAI_RESPONSES]: openAiResponsesAdapter,
  [EXTERNAL_SERVICE_MODEL_PROTOCOL.ANTHROPIC_MESSAGES]: anthropicMessagesAdapter,
  [EXTERNAL_SERVICE_MODEL_PROTOCOL.GEMINI_GENERATE_CONTENT]: geminiGenerateContentAdapter,
  [EXTERNAL_SERVICE_MODEL_PROTOCOL.BEDROCK_CONVERSE]: bedrockConverseAdapter,
  [EXTERNAL_SERVICE_MODEL_PROTOCOL.COHERE_CHAT]: cohereChatAdapter,
  [EXTERNAL_SERVICE_MODEL_PROTOCOL.OLLAMA_NATIVE]: ollamaNativeAdapter,
  [EXTERNAL_SERVICE_MODEL_PROTOCOL.DASHSCOPE_NATIVE]: dashscopeNativeAdapter,
  [EXTERNAL_SERVICE_MODEL_PROTOCOL.HUGGINGFACE_TGI]: huggingFaceTgiAdapter,
  [EXTERNAL_SERVICE_MODEL_PROTOCOL.AZURE_AI_INFERENCE]: azureAiInferenceAdapter,
  [EXTERNAL_SERVICE_MODEL_PROTOCOL.VERTEX_AI_PREDICTION]: vertexAiPredictionAdapter,
  [EXTERNAL_SERVICE_MODEL_PROTOCOL.CUSTOM_JSON_HTTP]: customJsonHttpAdapter
});

export function isExternalLlmServiceConfig(config = {}) {
  return config?.upstream?.type === EXTERNAL_SERVICE_UPSTREAM_TYPE.LLM;
}

export function resolveExternalLlmServiceAdapter(modelProtocol = "") {
  const protocol = normalizeProtocol(modelProtocol);
  return EXTERNAL_LLM_SERVICE_ADAPTERS[protocol] || customJsonHttpAdapter;
}

export function dispatchExternalLlmServiceAdapter(params = {}) {
  return resolveExternalLlmServiceAdapter(params.config?.upstream?.modelProtocol)(params);
}

export function callExternalLlmService(params = {}) {
  return dispatchExternalLlmServiceAdapter(params);
}

export function describeExternalLlmServiceAdapters() {
  return {
    schemaVersion: 1,
    kind: EXTERNAL_LLM_SERVICE_ADAPTER_KIND,
    status: EXTERNAL_LLM_SERVICE_ADAPTER_STATUS,
    protocols: EXTERNAL_SERVICE_MODEL_PROTOCOL_VALUES.map((protocol) => ({
      protocol,
      registered: typeof EXTERNAL_LLM_SERVICE_ADAPTERS[protocol] === "function"
    }))
  };
}
