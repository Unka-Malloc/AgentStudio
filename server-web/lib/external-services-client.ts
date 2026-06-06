import { getJson, postJson } from "./bridge-http";

export const externalServiceModeOptions = [
  { value: "managed", label: "managed" },
  { value: "connected", label: "connected" },
  { value: "on-demand", label: "on-demand" },
] as const;

export const externalServiceStartupPolicyOptions = [
  { value: "with-platform", label: "with-platform" },
  { value: "on-demand", label: "on-demand" },
  { value: "external-only", label: "external-only" },
] as const;

export const externalServiceUpstreamTypeOptions = [
  { value: "mcp", label: "MCP 服务" },
  { value: "acp", label: "ACP 服务" },
  { value: "llm", label: "LLM Service" },
  { value: "cloud-drive", label: "Cloud Drive Service" },
  { value: "http", label: "HTTP 服务" },
  { value: "https", label: "HTTPS 服务" },
  { value: "openapi", label: "OpenAPI 服务" },
  { value: "rpc", label: "RPC 服务" },
  { value: "other", label: "其它服务" },
] as const;

export const externalServiceCloudDriveProviderOptions = [
  { value: "icloud", label: "iCloud Drive" },
  { value: "onedrive", label: "OneDrive" },
  { value: "google-drive", label: "Google Drive" },
  { value: "dropbox", label: "Dropbox" },
] as const;

export const externalServiceCloudDriveModeOptions = [
  { value: "local", label: "local" },
  { value: "contract", label: "contract" },
  { value: "remote-live", label: "remote-live" },
] as const;

export const externalServiceModelProtocolOptions = [
  { value: "openai-compatible", label: "OpenAI Compatible" },
  { value: "openai-responses", label: "OpenAI Responses" },
  { value: "anthropic-messages", label: "Anthropic Messages" },
  { value: "gemini-generate-content", label: "Gemini generateContent" },
  { value: "bedrock-converse", label: "Bedrock Converse" },
  { value: "cohere-chat", label: "Cohere Chat" },
  { value: "ollama-native", label: "Ollama Native" },
  { value: "dashscope-native", label: "DashScope Native" },
  { value: "huggingface-tgi", label: "Hugging Face TGI" },
  { value: "azure-ai-inference", label: "Azure AI Inference" },
  { value: "vertex-ai-prediction", label: "Vertex AI Prediction" },
  { value: "custom-json-http", label: "Custom JSON HTTP" },
] as const;

export const externalServiceMcpTransportOptions = [
  { value: "streamable-http", label: "streamable-http" },
  { value: "http", label: "http" },
  { value: "sse", label: "sse" },
  { value: "stdio", label: "stdio" },
] as const;

export const externalServiceBindingModeOptions = [
  { value: "passthrough", label: "passthrough" },
  { value: "compile", label: "compile" },
] as const;

export const externalServiceBindingOutletOptions = [
  { value: "pact.skillHub", label: "pact.skillHub" },
] as const;

export const externalServiceRiskOptions = [
  { value: "read_only", label: "read_only" },
  { value: "safe_write", label: "safe_write" },
  { value: "repair_write", label: "repair_write" },
  { value: "destructive", label: "destructive" },
] as const;

export const externalServiceHealthCheckTypeOptions = [
  { value: "none", label: "none" },
  { value: "http", label: "http" },
] as const;

export type ExternalServiceValidation = {
  ok: boolean;
  errors?: string[];
  warnings?: string[];
  missingPaths?: string[];
};

export type ExternalServiceScriptEntry = {
  id?: string;
  path?: string;
  args?: unknown[];
  cwd?: string;
  env?: Record<string, unknown>;
  required?: boolean;
  longRunning?: boolean;
  description?: string;
  command?: {
    executable?: string;
    args?: unknown[];
  } | null;
};

export type ExternalServiceConfig = {
  schemaVersion?: number;
  kind?: string;
  serviceId: string;
  serviceName: string;
  displayName?: string;
  mode: "managed" | "connected" | "on-demand" | string;
  startupPolicy: "with-platform" | "on-demand" | "external-only" | string;
  description?: string;
  coreFeatureIds?: string[];
  featureIds?: string[];
  requiredOperations?: string[];
  includePaths?: string[];
  scriptRoots?: string[];
  scripts?: Record<string, ExternalServiceScriptEntry>;
  tools?: unknown[];
  upstream?: {
    type?: string;
    provider?: string;
    providers?: string[];
    mode?: string;
    modelProtocol?: string;
    transport?: string;
    url?: string;
    baseUrl?: string;
    path?: string;
    rpcPath?: string;
    protocol?: string;
    endpoints?: Record<string, unknown> | unknown[];
    rpcEndpoints?: Record<string, unknown> | unknown[];
    spec?: unknown;
    specUrl?: string;
    specFile?: string;
    endpointUrl?: string;
    endpointRef?: string;
    rootPath?: string;
    secretRef?: string;
    timeoutMs?: number | null;
    metadata?: Record<string, unknown>;
  } | null;
  binding?: {
    mode?: string;
    outlet?: string;
    requiredScopes?: string[];
    risk?: string;
    metadata?: Record<string, unknown>;
  } | null;
  healthCheck?: {
    type?: string;
    url?: string;
    host?: string;
    port?: number | null;
    path?: string;
    timeoutMs?: number;
    required?: boolean;
  };
  runtimeDependencies?: unknown[];
  docker?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

export type ExternalServiceEntry = {
  entryId: string;
  serviceId: string;
  serviceName: string;
  displayName: string;
  description: string;
  mode: string;
  startupPolicy: string;
  source: "configured" | "preset" | string;
  sourceLabel: string;
  presetId?: string;
  filePath?: string;
  featureIds: string[];
  requiredOperations: string[];
  scriptIds: string[];
  scriptCount: number;
  healthCheck?: ExternalServiceConfig["healthCheck"];
  validationStatus: "valid" | "invalid" | string;
  validation: ExternalServiceValidation;
  externalMcp?: {
    serviceId: string;
    upstream?: {
      type?: string;
      provider?: string;
      providers?: string[];
      mode?: string;
      modelProtocol?: string;
      transport?: string;
      url?: string;
      endpointUrl?: string;
      endpointRef?: string;
      rootPath?: string;
      secretRef?: string;
    } | null;
    binding?: {
      mode?: string;
      outlet?: string;
    } | null;
    toolCount: number;
    tools: unknown[];
    discoveredAt: string;
    fingerprint?: string;
  } | null;
  config: ExternalServiceConfig;
};

export type ExternalServiceState = {
  ok: boolean;
  schemaVersion: number;
  generatedAt: string;
  registryKind: string;
  registryPath: string;
  activeServiceId: string;
  activeConfig: ExternalServiceConfig;
  activeConfigText: string;
  activeValidation: ExternalServiceValidation;
  templateConfig: ExternalServiceConfig;
  templateConfigText: string;
  externalMcpCache?: {
    updatedAt?: string;
    serviceCount?: number;
  };
  services: ExternalServiceEntry[];
  configuredCount: number;
  presetCount: number;
};

export type ExternalServiceVerifyResult = {
  ok: boolean;
  error?: string;
  config: ExternalServiceConfig | null;
  configText?: string;
  validation: ExternalServiceValidation;
};

export type ExternalServiceSaveResult = ExternalServiceVerifyResult & {
  registryPath?: string;
  activeServiceId?: string;
};

export type ExternalServiceRuntimeRefreshResult = {
  ok: boolean;
  error?: string;
  registryPath?: string;
  activeServiceId?: string;
  requestedServiceId?: string;
  refreshedAt?: string;
  refreshedCount: number;
  failedCount: number;
  skippedCount: number;
  results: Array<{
    ok: boolean;
    status: "refreshed" | "failed" | "skipped" | string;
    serviceId: string;
    serviceName?: string;
    displayName?: string;
    upstreamType?: string;
    transport?: string;
    toolCount?: number;
    tools?: string[];
    discoveredAt?: string;
    error?: string;
    reason?: string;
  }>;
  state?: ExternalServiceState;
  toolCatalogRefresh?: {
    ok: boolean;
    toolCount?: number;
    externalMcpOperationCount?: number;
    fingerprint?: string;
  };
};

export function getExternalServices() {
  return getJson<ExternalServiceState>("/api/external-services");
}

export function getExternalServiceConfig() {
  return getJson<ExternalServiceState>("/api/external-services/config");
}

export function verifyExternalServiceConfig(configText: string, requireKnownPaths = false) {
  return postJson<ExternalServiceVerifyResult>("/api/external-services/verify", {
    configText,
    requireKnownPaths,
  });
}

export function saveExternalServiceConfig(configText: string) {
  return postJson<ExternalServiceSaveResult>(
    "/api/external-services/config",
    { configText },
    { safetyConfirm: true },
  );
}

export function refreshExternalServiceRuntime(serviceId = "") {
  return postJson<ExternalServiceRuntimeRefreshResult>(
    "/api/external-services/refresh",
    serviceId ? { serviceId } : {},
    { safetyConfirm: true },
  );
}
