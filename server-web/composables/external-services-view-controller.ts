import { computed, onBeforeUnmount, onMounted, proxyRefs, ref } from "vue";
import {
  externalServiceBindingModeOptions,
  externalServiceBindingOutletOptions,
  externalServiceCloudDriveModeOptions,
  externalServiceCloudDriveProviderOptions,
  externalServiceHealthCheckTypeOptions,
  externalServiceModelProtocolOptions,
  externalServiceMcpTransportOptions,
  externalServiceModeOptions,
  externalServiceRiskOptions,
  externalServiceStartupPolicyOptions,
  externalServiceUpstreamTypeOptions,
  getExternalServiceConfig,
  refreshExternalServiceRuntime,
  saveExternalServiceConfig,
  verifyExternalServiceConfig,
  type ExternalServiceConfig,
  type ExternalServiceEntry,
  type ExternalServiceRuntimeRefreshResult,
  type ExternalServiceState,
  type ExternalServiceValidation,
} from "../lib/external-services-client";
import type { ServerConsoleShellContext } from "./serverConsoleShellContext";
import { usePageRefreshHandler } from "./usePageRefresh";

type ConfigEditorMode = "add" | "edit";
type ServiceHeartbeatStatus = "idle" | "running" | "refreshed" | "checked" | "failed";
type ServiceHeartbeatState = {
  count: number;
  lastAt: string;
  message: string;
  refreshing: boolean;
  status: ServiceHeartbeatStatus;
};

const EXTERNAL_SERVICE_CONFIG_KIND = "pact.external-service.config";
const SERVICE_HEARTBEAT_INTERVAL_MS = 60000;
const SERVICE_HEARTBEAT_INITIAL_DELAY_MS = 1200;
const SERVICE_HEARTBEAT_STAGGER_MS = 900;
const SERVICE_TYPE_ALIASES: Record<string, string> = {
  "model-context-protocol": "mcp",
  "mcp-server": "mcp",
  "agent-client-protocol": "acp",
  "agent-communication-protocol": "acp",
  "agent-collaboration-protocol": "acp",
  "acp-server": "acp",
  model: "llm",
  "model-service": "llm",
  llm: "llm",
  "llm-service": "llm",
  drive: "cloud-drive",
  "drive-service": "cloud-drive",
  "cloud-drive": "cloud-drive",
  "cloud-drive-service": "cloud-drive",
  "icloud-drive": "cloud-drive",
  onedrive: "cloud-drive",
  "one-drive": "cloud-drive",
  "google-drive": "cloud-drive",
  dropbox: "cloud-drive",
  openai: "llm",
  "http-service": "http",
  "https-service": "https",
  "rpc-service": "rpc",
  "json-rpc": "rpc",
  "json-rpc-service": "rpc",
  "openai-api": "llm",
  "openai-compatible": "llm",
  "openai-compatible-api": "llm",
  "anthropic-messages": "llm",
  "gemini-generate-content": "llm",
  "bedrock-converse": "llm",
  "cohere-chat": "llm",
  "ollama-native": "llm",
  "dashscope-native": "llm",
  "huggingface-tgi": "llm",
  "azure-ai-inference": "llm",
  "vertex-ai-prediction": "llm",
  "custom-json-http": "llm",
  custom: "other",
};
const SERVICE_TYPE_TAGS: Record<string, { label: string; tone: string }> = {
  mcp: { label: "MCP 服务", tone: "success" },
  acp: { label: "ACP 服务", tone: "info" },
  llm: { label: "LLM Service", tone: "warning" },
  "cloud-drive": { label: "Cloud Drive Service", tone: "success" },
  http: { label: "HTTP / HTTPS 服务", tone: "info" },
  https: { label: "HTTP / HTTPS 服务", tone: "info" },
  rpc: { label: "RPC 服务", tone: "info" },
  other: { label: "其它服务", tone: "neutral" },
};
const UPSTREAM_TYPE_OPTION_VALUES = new Set<string>(externalServiceUpstreamTypeOptions.map((option) => option.value));
const MODEL_PROTOCOL_OPTION_VALUES = new Set<string>(externalServiceModelProtocolOptions.map((option) => option.value));

function formatDateTime(value = "") {
  if (!value) return "未生成";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatCompactDateTime(value = "") {
  if (!value) return "未生成";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function cloneConfig(config: ExternalServiceConfig): ExternalServiceConfig {
  return JSON.parse(JSON.stringify(config || {})) as ExternalServiceConfig;
}

function configForSerialization(config: ExternalServiceConfig): ExternalServiceConfig {
  const normalized = cloneConfig(config || createEmptyExternalServiceConfig());
  delete normalized.displayName;
  return normalized;
}

function serializeConfig(config: ExternalServiceConfig) {
  return `${JSON.stringify(configForSerialization(config), null, 2)}\n`;
}

function validationFromState(state: ExternalServiceState | null): ExternalServiceValidation {
  return state?.activeValidation || { ok: false, errors: [], warnings: [] };
}

function uniqueListFromText(value = "") {
  return [...new Set(String(value).split(/[,\n]/).map((item) => item.trim()).filter(Boolean))];
}

function scopesTextFromConfig(config: ExternalServiceConfig) {
  return (config.binding?.requiredScopes || []).join(", ");
}

function createEmptyExternalServiceConfig(): ExternalServiceConfig {
  return {
    schemaVersion: 1,
    kind: EXTERNAL_SERVICE_CONFIG_KIND,
    serviceId: "",
    serviceName: "",
    mode: "connected",
    startupPolicy: "external-only",
    description: "",
    scripts: {},
    upstream: {
      type: "mcp",
      transport: "streamable-http",
      url: "",
      timeoutMs: null,
      metadata: {},
    },
    binding: {
      mode: "passthrough",
      outlet: "pact.skillHub",
      requiredScopes: ["knowledge:read"],
      risk: "read_only",
      metadata: {},
    },
    healthCheck: {
      type: "none",
      url: "",
      host: "127.0.0.1",
      port: null,
      path: "/",
      timeoutMs: 60000,
      required: false,
    },
    metadata: {},
  };
}

function normalizeConfigDraft(
  raw: ExternalServiceConfig,
  options: { preserveMissingUpstream?: boolean } = {},
): ExternalServiceConfig {
  const config = cloneConfig(raw || createEmptyExternalServiceConfig());
  const empty = createEmptyExternalServiceConfig();
  const hasUpstreamConfig = Boolean(
    config.upstream && typeof config.upstream === "object" && !Array.isArray(config.upstream),
  );
  const upstream = options.preserveMissingUpstream && !hasUpstreamConfig
    ? undefined
    : {
        ...empty.upstream,
        ...(config.upstream || {}),
        type: config.upstream?.type || empty.upstream?.type,
        provider: config.upstream?.provider || "",
        providers: config.upstream?.providers || [],
        mode: config.upstream?.mode || "",
        modelProtocol: config.upstream?.modelProtocol || "",
        transport: config.upstream?.transport || empty.upstream?.transport,
        url: config.upstream?.url || "",
        endpointUrl: config.upstream?.endpointUrl || "",
        endpointRef: config.upstream?.endpointRef || "",
        rootPath: config.upstream?.rootPath || "",
        secretRef: config.upstream?.secretRef || "",
        timeoutMs: config.upstream?.timeoutMs ?? null,
      };
  return {
    ...config,
    schemaVersion: Number(config.schemaVersion || 1),
    kind: config.kind || EXTERNAL_SERVICE_CONFIG_KIND,
    serviceId: String(config.serviceId || ""),
    serviceName: String(config.serviceName || ""),
    displayName: String(config.displayName || ""),
    mode: config.mode || empty.mode,
    startupPolicy: config.startupPolicy || empty.startupPolicy,
    description: String(config.description || ""),
    scripts: config.scripts || {},
    upstream,
    binding: {
      ...empty.binding,
      ...(config.binding || {}),
      mode: config.binding?.mode || empty.binding?.mode,
      outlet: config.binding?.outlet || empty.binding?.outlet,
      requiredScopes: config.binding?.requiredScopes || empty.binding?.requiredScopes || [],
      risk: config.binding?.risk || empty.binding?.risk,
    },
    healthCheck: {
      ...empty.healthCheck,
      ...(config.healthCheck || {}),
      type: config.healthCheck?.type || empty.healthCheck?.type,
      url: config.healthCheck?.url || "",
      host: config.healthCheck?.host || empty.healthCheck?.host,
      port: config.healthCheck?.port ?? null,
      path: config.healthCheck?.path || empty.healthCheck?.path,
      timeoutMs: Number(config.healthCheck?.timeoutMs || empty.healthCheck?.timeoutMs || 60000),
      required: config.healthCheck?.required === true,
    },
    metadata: config.metadata || {},
  };
}

function configTextFromEntry(entry: ExternalServiceEntry) {
  return serializeConfig(normalizeConfigDraft(entry.config || createEmptyExternalServiceConfig()));
}

function serviceUpstream(entry: ExternalServiceEntry): NonNullable<ExternalServiceConfig["upstream"]> | null {
  return (entry.config?.upstream || entry.externalMcp?.upstream || null) as NonNullable<ExternalServiceConfig["upstream"]> | null;
}

function normalizeServiceType(value = "") {
  const normalized = String(value || "").trim().toLowerCase().replace(/[\s_]+/g, "-");
  return SERVICE_TYPE_ALIASES[normalized] || normalized;
}

function parseEndpoint(value = "") {
  try {
    return new URL(String(value || "").trim());
  } catch {
    return null;
  }
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function textField(record: Record<string, unknown> | null | undefined, keys: string[]) {
  if (!record) return "";
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return "";
}

function endpointHostPort(value = "") {
  const endpoint = parseEndpoint(value);
  if (!endpoint?.hostname) {
    return "";
  }
  return endpoint.port ? `${endpoint.hostname}:${endpoint.port}` : `${endpoint.hostname}:未声明端口`;
}

function firstConfiguredScriptPath(entry: ExternalServiceEntry) {
  const scripts = entry.config?.scripts || {};
  for (const script of Object.values(scripts)) {
    const pathValue = String(script?.path || script?.cwd || script?.command?.executable || "").trim();
    if (pathValue) {
      return pathValue;
    }
  }
  return "";
}

function resolveUpstreamTarget(entry: ExternalServiceEntry) {
  const upstream = serviceUpstream(entry);
  const upstreamMetadata = objectRecord(upstream?.metadata);
  const docker = objectRecord(entry.config?.docker);
  const dockerMetadata = objectRecord(entry.config?.metadata ? objectRecord(entry.config.metadata)?.docker : null);
  const urlTarget = endpointHostPort(upstream?.url || upstream?.endpointUrl || "");
  if (urlTarget) {
    return { detail: "endpoint", label: urlTarget };
  }
  const rootPath = String(
    upstream?.rootPath ||
    textField(upstreamMetadata, ["rootPath", "localPath", "path", "basePath"]) ||
    "",
  ).trim();
  if (rootPath) {
    return { detail: "local path", label: rootPath };
  }
  const dockerContainer = textField(docker, ["containerName", "container", "name", "serviceName", "composeService"]) ||
    textField(dockerMetadata, ["containerName", "container", "name", "serviceName", "composeService"]);
  if (dockerContainer) {
    return { detail: "docker container", label: dockerContainer };
  }
  const scriptPath = firstConfiguredScriptPath(entry);
  if (scriptPath) {
    return { detail: "script path", label: scriptPath };
  }
  const includePath = String(entry.config?.includePaths?.[0] || entry.config?.scriptRoots?.[0] || "").trim();
  if (includePath) {
    return { detail: "local path", label: includePath };
  }
  const healthHost = String(entry.healthCheck?.host || "").trim();
  const healthPort = entry.healthCheck?.port;
  if (healthHost && healthPort) {
    return { detail: "health target", label: `${healthHost}:${healthPort}` };
  }
  const endpointRef = String(upstream?.endpointRef || "").trim();
  if (endpointRef) {
    return { detail: "endpoint ref", label: endpointRef };
  }
  const filePath = String(entry.filePath || "").trim();
  if (filePath) {
    return { detail: "config path", label: filePath };
  }
  return { detail: "missing target", label: "未声明上游目标" };
}

function inferServiceTypeFromIdentity(entry: ExternalServiceEntry) {
  const text = [entry.serviceId, entry.serviceName, entry.displayName].join(" ").toLowerCase();
  if (text.includes("openai")) {
    return "llm";
  }
  if (/\b(icloud|onedrive|one-drive|google-drive|dropbox|cloud-drive|drive)\b/.test(text)) {
    return "cloud-drive";
  }
  if (/\b(llm|model)\b/.test(text)) {
    return "llm";
  }
  if (/\bacp\b/.test(text)) {
    return "acp";
  }
  if (/\bmcp\b/.test(text)) {
    return "mcp";
  }
  return "";
}

function isOpenAiHost(host = "") {
  return host === "openai.com" || host.endsWith(".openai.com");
}

function inferServiceType(entry: ExternalServiceEntry) {
  const upstream = serviceUpstream(entry);
  const explicitType = normalizeServiceType(upstream?.type || "");
  if (explicitType) {
    return explicitType;
  }
  if (upstream?.modelProtocol || upstream?.provider) {
    return "llm";
  }
  const endpoint = parseEndpoint(upstream?.url || "");
  const host = endpoint?.hostname.toLowerCase() || "";
  if (isOpenAiHost(host)) {
    return "llm";
  }
  const identityType = inferServiceTypeFromIdentity(entry);
  if (identityType) {
    return identityType;
  }
  if (endpoint?.protocol === "http:") {
    return "http";
  }
  if (endpoint?.protocol === "https:") {
    return "https";
  }
  return "other";
}

function serviceTypeTag(entry: ExternalServiceEntry) {
  const upstream = serviceUpstream(entry);
  const rawType = String(upstream?.type || "").trim();
  const type = inferServiceType(entry);
  const known = SERVICE_TYPE_TAGS[type];
  if (known) {
    return { ...known, type, rawType };
  }
  return {
    label: `${rawType || type} 服务`,
    tone: "neutral",
    type,
    rawType,
  };
}

function numericOrNull(value: string | number | null | undefined) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

export function useExternalServicesViewController(shell: ServerConsoleShellContext) {
  const state = ref<ExternalServiceState | null>(null);
  const configDraft = ref<ExternalServiceConfig>(createEmptyExternalServiceConfig());
  const configText = ref(serializeConfig(configDraft.value));
  const configEditorOpen = ref(false);
  const configEditorMode = ref<ConfigEditorMode>("add");
  const editingServiceLabel = ref("");
  const requiredScopesText = ref(scopesTextFromConfig(configDraft.value));
  const loading = ref(false);
  const saving = ref(false);
  const verifying = ref(false);
  const refreshingRuntime = ref(false);
  const dirty = ref(false);
  const loadError = ref("");
  const actionError = ref("");
  const actionMessage = ref("");
  const activeValidation = ref<ExternalServiceValidation>({ ok: false, errors: [], warnings: [] });
  const serviceHeartbeats = ref<Record<string, ServiceHeartbeatState>>({});
  const serviceHeartbeatTimers = new Map<string, { intervalId?: number; timeoutId?: number }>();

  const activeTab = computed(() => "list");
  const services = computed(() => state.value?.services || []);
  const configuredCount = computed(() => state.value?.configuredCount || 0);
  const presetCount = computed(() => state.value?.presetCount || 0);
  const validServiceCount = computed(() => services.value.filter((item) => item.validationStatus === "valid").length);
  const discoveredServiceCount = computed(() => services.value.length);
  const mcpToolCount = computed(() =>
    services.value.reduce((total, item) => total + Number(item.externalMcp?.toolCount || 0), 0),
  );
  const discoveryCacheUpdatedAtLabel = computed(() => formatDateTime(state.value?.externalMcpCache?.updatedAt || ""));
  const registryPath = computed(() => state.value?.registryPath || "");
  const validationErrors = computed(() => activeValidation.value.errors || []);
  const validationWarnings = computed(() => activeValidation.value.warnings || []);
  const configStatusTone = computed(() => activeValidation.value.ok ? "success" : "danger");
  const configStatusLabel = computed(() => activeValidation.value.ok ? "Valid" : "Invalid");
  const upstreamTypeSelectValue = computed(() => {
    const type = String(configDraft.value.upstream?.type || "").trim();
    return UPSTREAM_TYPE_OPTION_VALUES.has(type) ? type : "other";
  });
  const showCustomUpstreamType = computed(() => upstreamTypeSelectValue.value === "other");
  const isLlmServiceDraft = computed(() =>
    normalizeServiceType(configDraft.value.upstream?.type || "") === "llm" ||
    (
      normalizeServiceType(configDraft.value.upstream?.type || "") !== "cloud-drive" &&
      Boolean(configDraft.value.upstream?.modelProtocol || configDraft.value.upstream?.provider)
    ),
  );
  const isCloudDriveServiceDraft = computed(() =>
    normalizeServiceType(configDraft.value.upstream?.type || "") === "cloud-drive",
  );
  const modelProtocolSelectValue = computed(() => {
    const protocol = String(configDraft.value.upstream?.modelProtocol || "").trim();
    return MODEL_PROTOCOL_OPTION_VALUES.has(protocol) ? protocol : "custom-json-http";
  });
  const customUpstreamTypeValue = computed(() => {
    const type = String(configDraft.value.upstream?.type || "").trim();
    return UPSTREAM_TYPE_OPTION_VALUES.has(type) ? "" : type;
  });
  const configEditorTitle = computed(() =>
    configEditorMode.value === "add" ? "添加服务" : `修改配置：${editingServiceLabel.value || configDraft.value.serviceId}`,
  );
  const configEditorSubtitle = computed(() =>
    configEditorMode.value === "add"
      ? "填写服务身份、上游 endpoint 和 Pact 暴露方式。"
      : "修改当前外部服务配置；Service ID 已锁定，避免误新增服务。",
  );

  const activeConfigSummary = computed(() => ({
    serviceId: configDraft.value.serviceId || "-",
    serviceName: configDraft.value.serviceName || "-",
    mode: configDraft.value.mode || "-",
    startupPolicy: configDraft.value.startupPolicy || "-",
    upstreamType: configDraft.value.upstream?.type || "-",
    upstreamEndpoint: configDraft.value.upstream?.url || configDraft.value.upstream?.endpointUrl || "-",
    scripts: Object.keys(configDraft.value.scripts || {}).sort(),
    featureIds: configDraft.value.featureIds || [],
    requiredOperations: configDraft.value.requiredOperations || [],
  }));

  function commitConfigDraft(
    config: ExternalServiceConfig,
    options: { markDirty?: boolean; preserveMissingUpstream?: boolean } = {},
  ) {
    const normalized = normalizeConfigDraft(config, {
      preserveMissingUpstream: options.preserveMissingUpstream === true,
    });
    configDraft.value = normalized;
    configText.value = serializeConfig(normalized);
    requiredScopesText.value = scopesTextFromConfig(normalized);
    dirty.value = options.markDirty === true;
  }

  function serviceHeartbeatKey(entry: ExternalServiceEntry | string) {
    if (typeof entry === "string") {
      return entry;
    }
    return entry.serviceId || entry.entryId;
  }

  function emptyServiceHeartbeat(): ServiceHeartbeatState {
    return {
      count: 0,
      lastAt: "",
      message: "尚未刷新",
      refreshing: false,
      status: "idle",
    };
  }

  function updateServiceHeartbeat(serviceId: string, patch: Partial<ServiceHeartbeatState>) {
    const key = serviceHeartbeatKey(serviceId);
    if (!key) return;
    serviceHeartbeats.value = {
      ...serviceHeartbeats.value,
      [key]: {
        ...(serviceHeartbeats.value[key] || emptyServiceHeartbeat()),
        ...patch,
      },
    };
  }

  function clearServiceHeartbeatTimer(serviceId: string) {
    const key = serviceHeartbeatKey(serviceId);
    const timer = serviceHeartbeatTimers.get(key);
    if (timer?.timeoutId) {
      window.clearTimeout(timer.timeoutId);
    }
    if (timer?.intervalId) {
      window.clearInterval(timer.intervalId);
    }
    serviceHeartbeatTimers.delete(key);
  }

  function clearServiceHeartbeatTimers() {
    for (const key of serviceHeartbeatTimers.keys()) {
      clearServiceHeartbeatTimer(key);
    }
  }

  function resultHeartbeatStatus(status = ""): ServiceHeartbeatStatus {
    if (status === "failed") return "failed";
    if (status === "refreshed") return "refreshed";
    return "checked";
  }

  function resultHeartbeatMessage(result: ExternalServiceRuntimeRefreshResult["results"][number] | undefined) {
    if (!result) return "已检查";
    if (result.status === "failed") return result.error || "刷新失败";
    if (result.status === "refreshed") {
      return typeof result.toolCount === "number" ? `${result.toolCount} tools` : "已刷新";
    }
    if (result.reason === "not_mcp_passthrough") return "已检查";
    return result.reason || "已检查";
  }

  function scheduleServiceHeartbeat(entry: ExternalServiceEntry, index = 0) {
    const key = serviceHeartbeatKey(entry);
    if (!key || typeof window === "undefined" || serviceHeartbeatTimers.has(key)) return;
    const run = () => {
      void refreshRuntime(key, { heartbeat: true, silent: true });
    };
    const timeoutId = window.setTimeout(() => {
      run();
      const intervalId = window.setInterval(run, SERVICE_HEARTBEAT_INTERVAL_MS);
      serviceHeartbeatTimers.set(key, { intervalId });
    }, SERVICE_HEARTBEAT_INITIAL_DELAY_MS + index * SERVICE_HEARTBEAT_STAGGER_MS);
    serviceHeartbeatTimers.set(key, { timeoutId });
  }

  function reconcileServiceHeartbeats(nextServices: ExternalServiceEntry[]) {
    const nextIds = new Set(nextServices.map((entry) => serviceHeartbeatKey(entry)).filter(Boolean));
    const nextHeartbeats: Record<string, ServiceHeartbeatState> = {};
    for (const entry of nextServices) {
      const key = serviceHeartbeatKey(entry);
      if (!key) continue;
      nextHeartbeats[key] = serviceHeartbeats.value[key] || emptyServiceHeartbeat();
    }
    serviceHeartbeats.value = nextHeartbeats;
    for (const key of serviceHeartbeatTimers.keys()) {
      if (!nextIds.has(key)) {
        clearServiceHeartbeatTimer(key);
      }
    }
    nextServices.forEach((entry, index) => scheduleServiceHeartbeat(entry, index));
  }

  async function refreshExternalServices() {
    loading.value = true;
    loadError.value = "";
    try {
      const payload = await getExternalServiceConfig();
      state.value = payload;
      activeValidation.value = validationFromState(payload);
      reconcileServiceHeartbeats(payload.services || []);
    } catch (error) {
      loadError.value = error instanceof Error ? error.message : String(error);
    } finally {
      loading.value = false;
    }
  }

  function openAddServiceConfig() {
    configEditorMode.value = "add";
    editingServiceLabel.value = "";
    commitConfigDraft(createEmptyExternalServiceConfig());
    activeValidation.value = { ok: false, errors: [], warnings: [] };
    actionError.value = "";
    actionMessage.value = "";
    configEditorOpen.value = true;
    shell.openExternalServiceTab("list");
  }

  function openEditServiceConfig(entry: ExternalServiceEntry) {
    configEditorMode.value = "edit";
    editingServiceLabel.value = entry.displayName || entry.serviceId;
    commitConfigDraft(entry.config || createEmptyExternalServiceConfig(), { preserveMissingUpstream: true });
    activeValidation.value = entry.validation || { ok: false, errors: [], warnings: [] };
    actionError.value = "";
    actionMessage.value = "";
    configEditorOpen.value = true;
    shell.openExternalServiceTab("list");
  }

  function closeConfigEditor() {
    configEditorOpen.value = false;
    actionError.value = "";
    actionMessage.value = "";
  }

  async function verifyConfig() {
    verifying.value = true;
    actionError.value = "";
    actionMessage.value = "";
    try {
      const result = await verifyExternalServiceConfig(configText.value);
      activeValidation.value = result.validation;
      actionMessage.value = result.ok ? "配置校验通过。" : "配置校验未通过。";
    } catch (error) {
      actionError.value = error instanceof Error ? error.message : String(error);
    } finally {
      verifying.value = false;
    }
  }

  async function refreshRuntime(
    serviceId = "",
    options: { heartbeat?: boolean; silent?: boolean } = {},
  ) {
    const scopedServiceId = String(serviceId || "").trim();
    if (scopedServiceId && serviceHeartbeats.value[scopedServiceId]?.refreshing) {
      return;
    }
    if (scopedServiceId) {
      updateServiceHeartbeat(scopedServiceId, {
        refreshing: true,
        status: "running",
        message: "刷新中",
      });
    } else {
      refreshingRuntime.value = true;
    }
    if (!options.silent) {
      actionError.value = "";
      actionMessage.value = "";
    }
    try {
      const result = await refreshExternalServiceRuntime(scopedServiceId);
      if (result.state) {
        state.value = result.state;
        activeValidation.value = validationFromState(result.state);
        reconcileServiceHeartbeats(result.state.services || []);
      } else {
        await refreshExternalServices();
      }
      const refreshedAt = result.refreshedAt || new Date().toISOString();
      const results = result.results || [];
      if (scopedServiceId) {
        const itemResult = results.find((item) => item.serviceId === scopedServiceId) || results[0];
        const previous = serviceHeartbeats.value[scopedServiceId] || emptyServiceHeartbeat();
        updateServiceHeartbeat(scopedServiceId, {
          count: previous.count + 1,
          lastAt: refreshedAt,
          message: resultHeartbeatMessage(itemResult),
          refreshing: false,
          status: resultHeartbeatStatus(itemResult?.status || (result.ok ? "checked" : "failed")),
        });
      } else {
        for (const itemResult of results) {
          const key = itemResult.serviceId;
          const previous = serviceHeartbeats.value[key] || emptyServiceHeartbeat();
          updateServiceHeartbeat(key, {
            count: previous.count + 1,
            lastAt: refreshedAt,
            message: resultHeartbeatMessage(itemResult),
            refreshing: false,
            status: resultHeartbeatStatus(itemResult.status),
          });
        }
      }
      const catalogCount = result.toolCatalogRefresh?.externalMcpOperationCount;
      const suffix = typeof catalogCount === "number" ? `，目录中 ${catalogCount} 个外部 MCP 工具。` : "。";
      if (!options.silent) {
        const scopedResult = scopedServiceId
          ? (results.find((item) => item.serviceId === scopedServiceId) || results[0])
          : undefined;
        actionMessage.value = scopedServiceId
          ? `${scopedResult?.displayName || scopedServiceId} 服务探测完成：${resultHeartbeatMessage(scopedResult)}。`
          : result.ok
            ? `后台刷新完成：${result.refreshedCount} 个服务已刷新，${result.skippedCount} 个跳过${suffix}`
            : `后台刷新完成：${result.refreshedCount} 个成功，${result.failedCount} 个失败。`;
        if (!result.ok) {
          actionError.value = results.find((item) => item.status === "failed")?.error || "";
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (scopedServiceId) {
        const previous = serviceHeartbeats.value[scopedServiceId] || emptyServiceHeartbeat();
        updateServiceHeartbeat(scopedServiceId, {
          count: previous.count + 1,
          lastAt: new Date().toISOString(),
          message,
          refreshing: false,
          status: "failed",
        });
      }
      if (!options.silent) {
        actionError.value = message;
      }
    } finally {
      if (scopedServiceId) {
        updateServiceHeartbeat(scopedServiceId, { refreshing: false });
      } else {
        refreshingRuntime.value = false;
      }
    }
  }

  async function saveConfig() {
    saving.value = true;
    actionError.value = "";
    actionMessage.value = "";
    try {
      const result = await saveExternalServiceConfig(configText.value);
      activeValidation.value = result.validation;
      if (!result.ok) {
        actionError.value = result.error || "配置保存失败。";
        return;
      }
      dirty.value = false;
      actionMessage.value = "配置已保存。";
      configEditorOpen.value = false;
      await refreshExternalServices();
    } catch (error) {
      actionError.value = error instanceof Error ? error.message : String(error);
    } finally {
      saving.value = false;
    }
  }

  function updateRootField(field: keyof ExternalServiceConfig, value: string) {
    commitConfigDraft({
      ...configDraft.value,
      [field]: value,
    }, { markDirty: true });
  }

  function updateUpstreamField(
    field: "type" | "transport" | "url" | "endpointUrl" | "endpointRef" | "rootPath" | "secretRef" | "timeoutMs",
    value: string,
  ) {
    commitConfigDraft({
      ...configDraft.value,
      upstream: {
        ...(configDraft.value.upstream || {}),
        [field]: field === "timeoutMs" ? numericOrNull(value) : value,
      },
    }, { markDirty: true });
  }

  function updateUpstreamTypeSelection(value: string) {
    const nextUpstream = {
      ...(configDraft.value.upstream || {}),
      type: value,
    };
    if (value === "llm" && !nextUpstream.modelProtocol) {
      nextUpstream.modelProtocol = "openai-compatible";
    }
    const nextConfig: ExternalServiceConfig = {
      ...configDraft.value,
      upstream: nextUpstream,
    };
    if (value === "cloud-drive") {
      nextUpstream.transport = "pact-upstream-gateway";
      nextUpstream.provider = nextUpstream.provider || "icloud";
      nextUpstream.mode = nextUpstream.mode || "local";
      nextConfig.binding = {
        ...(nextConfig.binding || {}),
        requiredScopes: ["drive:read", "drive:write", "drive:sync", "drive:share"],
        risk: "safe_write",
      };
    }
    commitConfigDraft(nextConfig, { markDirty: true });
  }

  function updateCustomUpstreamType(value: string) {
    updateUpstreamField("type", String(value || "").trim() || "other");
  }

  function updateModelProtocol(value: string) {
    commitConfigDraft({
      ...configDraft.value,
      upstream: {
        ...(configDraft.value.upstream || {}),
        type: "llm",
        modelProtocol: value,
      },
    }, { markDirty: true });
  }

  function updateModelProvider(value: string) {
    commitConfigDraft({
      ...configDraft.value,
      upstream: {
        ...(configDraft.value.upstream || {}),
        type: "llm",
        provider: value,
      },
    }, { markDirty: true });
  }

  function updateCloudDriveProvider(value: string) {
    const provider = String(value || "").trim();
    const isLocalProjectionProvider = provider === "icloud" || provider === "onedrive";
    const currentMode = configDraft.value.upstream?.mode;
    const mode = isLocalProjectionProvider
      ? (currentMode === "remote-live" ? "remote-live" : "local")
      : (currentMode === "local" ? "contract" : currentMode || "contract");
    commitConfigDraft({
      ...configDraft.value,
      upstream: {
        ...(configDraft.value.upstream || {}),
        type: "cloud-drive",
        provider,
        providers: provider ? [provider] : [],
        mode,
        transport: "pact-upstream-gateway",
      },
    }, { markDirty: true });
  }

  function updateCloudDriveMode(value: string) {
    commitConfigDraft({
      ...configDraft.value,
      upstream: {
        ...(configDraft.value.upstream || {}),
        type: "cloud-drive",
        mode: value,
        transport: "pact-upstream-gateway",
      },
    }, { markDirty: true });
  }

  function updateBindingField(field: "mode" | "outlet" | "risk", value: string) {
    commitConfigDraft({
      ...configDraft.value,
      binding: {
        ...(configDraft.value.binding || {}),
        [field]: value,
      },
    }, { markDirty: true });
  }

  function updateRequiredScopes(value: string) {
    requiredScopesText.value = value;
    commitConfigDraft({
      ...configDraft.value,
      binding: {
        ...(configDraft.value.binding || {}),
        requiredScopes: uniqueListFromText(value),
      },
    }, { markDirty: true });
  }

  function updateHealthCheckField(field: "type" | "url" | "host" | "port" | "path" | "timeoutMs", value: string) {
    commitConfigDraft({
      ...configDraft.value,
      healthCheck: {
        ...(configDraft.value.healthCheck || {}),
        [field]: field === "port" || field === "timeoutMs" ? numericOrNull(value) : value,
      },
    }, { markDirty: true });
  }

  function updateHealthCheckRequired(value: boolean) {
    commitConfigDraft({
      ...configDraft.value,
      healthCheck: {
        ...(configDraft.value.healthCheck || {}),
        required: value,
      },
    }, { markDirty: true });
  }

  function onConfigInput(value: string) {
    configText.value = value;
    dirty.value = true;
    try {
      const parsed = JSON.parse(value || "{}");
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const normalized = normalizeConfigDraft(parsed as ExternalServiceConfig);
        configDraft.value = normalized;
        requiredScopesText.value = scopesTextFromConfig(normalized);
      }
    } catch {
      // Keep editing raw JSON; validation will report parse errors.
    }
  }

  function serviceSourceDetail(entry: ExternalServiceEntry) {
    return [entry.sourceLabel, entry.serviceId].filter(Boolean).join(" / ") || "-";
  }

  function upstreamTargetLabel(entry: ExternalServiceEntry) {
    return resolveUpstreamTarget(entry).label;
  }

  function upstreamTargetDetailLabel(entry: ExternalServiceEntry) {
    return resolveUpstreamTarget(entry).detail;
  }

  function serviceDiscoveryLabel(entry: ExternalServiceEntry) {
    return serviceTypeTag(entry).label;
  }

  function serviceDiscoveryTone(entry: ExternalServiceEntry) {
    return serviceTypeTag(entry).tone;
  }

  function serviceDiscoveryRegistrationLabel(entry: ExternalServiceEntry) {
    const tag = serviceTypeTag(entry);
    const upstream = serviceUpstream(entry);
    if (tag.type === "mcp") {
      return entry.externalMcp ? "工具已发现" : "工具待刷新";
    }
    if (tag.type === "llm") {
      return "模型已注册";
    }
    if (tag.type === "cloud-drive") {
      return "网盘已注册";
    }
    if (upstream?.url) {
      return "端点已注册";
    }
    if (tag.rawType && tag.type !== "other") {
      return "类型已注册";
    }
    return "服务已注册";
  }

  function serviceDiscoveryRegistrationTone(entry: ExternalServiceEntry) {
    const tag = serviceTypeTag(entry);
    if (tag.type === "mcp" && !entry.externalMcp) {
      return "warning";
    }
    return "success";
  }

  function serviceHeartbeat(entry: ExternalServiceEntry) {
    return serviceHeartbeats.value[serviceHeartbeatKey(entry)] || emptyServiceHeartbeat();
  }

  function serviceHeartbeatLastAtLabel(entry: ExternalServiceEntry) {
    const lastAt = serviceHeartbeat(entry).lastAt;
    return lastAt ? `Latest: ${formatCompactDateTime(lastAt)}` : "Latest: -";
  }

  function isServiceHeartbeatRefreshing(entry: ExternalServiceEntry) {
    return serviceHeartbeat(entry).refreshing === true;
  }

  onMounted(() => {
    void refreshExternalServices();
  });

  onBeforeUnmount(() => {
    clearServiceHeartbeatTimers();
  });

  usePageRefreshHandler(
    (detail) => detail.viewId === "externalServices",
    refreshExternalServices,
  );

  return proxyRefs({
    actionError,
    actionMessage,
    activeConfigSummary,
    activeTab,
    activeValidation,
    bindingModeOptions: externalServiceBindingModeOptions,
    bindingOutletOptions: externalServiceBindingOutletOptions,
    closeConfigEditor,
    configDraft,
    configEditorMode,
    configEditorOpen,
    configEditorSubtitle,
    configEditorTitle,
    configStatusLabel,
    configStatusTone,
    configText,
    configuredCount,
    customUpstreamTypeValue,
    dirty,
    discoveredServiceCount,
    discoveryCacheUpdatedAtLabel,
    healthCheckTypeOptions: externalServiceHealthCheckTypeOptions,
    cloudDriveModeOptions: externalServiceCloudDriveModeOptions,
    cloudDriveProviderOptions: externalServiceCloudDriveProviderOptions,
    isCloudDriveServiceDraft,
    isLlmServiceDraft,
    loadError,
    loading,
    mcpTransportOptions: externalServiceMcpTransportOptions,
    modelProtocolOptions: externalServiceModelProtocolOptions,
    modelProtocolSelectValue,
    mcpToolCount,
    modeOptions: externalServiceModeOptions,
    onConfigInput,
    openAddServiceConfig,
    openEditServiceConfig,
    presetCount,
    refreshExternalServices,
    refreshingRuntime,
    refreshRuntime,
    registryPath,
    requiredScopesText,
    riskOptions: externalServiceRiskOptions,
    saveConfig,
    saving,
    serviceSourceDetail,
    serviceDiscoveryLabel,
    serviceDiscoveryRegistrationLabel,
    serviceDiscoveryRegistrationTone,
    serviceDiscoveryTone,
    serviceHeartbeatLastAtLabel,
    services,
    isServiceHeartbeatRefreshing,
    showCustomUpstreamType,
    startupPolicyOptions: externalServiceStartupPolicyOptions,
    updateBindingField,
    updateHealthCheckField,
    updateHealthCheckRequired,
    updateModelProtocol,
    updateModelProvider,
    updateCloudDriveMode,
    updateCloudDriveProvider,
    updateRequiredScopes,
    updateRootField,
    updateCustomUpstreamType,
    updateUpstreamField,
    updateUpstreamTypeSelection,
    upstreamTypeSelectValue,
    upstreamTargetDetailLabel,
    upstreamTargetLabel,
    upstreamTypeOptions: externalServiceUpstreamTypeOptions,
    validServiceCount,
    validationErrors,
    validationWarnings,
    verifyConfig,
    verifying,
  });
}
