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
  { value: "json-rpc", label: "JSON-RPC 服务" },
  { value: "sse", label: "SSE 服务" },
  { value: "openapi", label: "OpenAPI 服务" },
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
] as const;

export const externalServiceMcpTransportOptions = [
  { value: "streamable-http", label: "streamable-http" },
  { value: "sse", label: "sse" },
] as const;

export const externalServiceBindingModeOptions = [
  { value: "passthrough", label: "passthrough" },
  { value: "compile", label: "compile" },
] as const;

export const externalServiceBindingOutletOptions = [
  { value: "pact.serviceHub", label: "pact.serviceHub" },
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
  schemaVersion?: string;
  kind?: string;
  templateId?: string;
  policyPreset?: string;
  serviceId: string;
  serviceName?: string;
  displayName?: string;
  mode?: "managed" | "connected" | "on-demand" | string;
  startupPolicy?: "with-platform" | "on-demand" | "external-only" | string;
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
    eventFormat?: string;
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
    auth?: Record<string, unknown> | null;
    defaultHeaders?: Record<string, unknown>;
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
    activeToolCount?: number;
    candidateToolCount?: number;
    tools: unknown[];
    activeTools?: string[];
    candidateTools?: string[];
    activeToolDetails?: ExternalServiceToolReview[];
    candidateToolDetails?: ExternalServiceToolReview[];
    tombstoneCount?: number;
    tombstones?: ExternalServiceToolTombstone[];
    adoption?: Record<string, unknown> | null;
    discoveredAt: string;
    fingerprint?: string;
  } | null;
  config: ExternalServiceConfig;
};

export type ExternalServiceToolSchemaSummary = {
  type?: string;
  fingerprint?: string;
  required?: string[];
  propertyCount?: number;
  properties?: Array<{
    name: string;
    type?: string;
    required?: boolean;
    format?: string;
    enumCount?: number;
  }>;
  truncated?: boolean;
  additionalProperties?: string;
};

export type ExternalServiceToolReview = {
  name: string;
  title?: string;
  descriptionPreview?: string;
  fingerprint?: string;
  previousFingerprint?: string;
  adoptionState?: string;
  reasonCode?: string;
  discoveredAt?: string;
  adoptedAt?: string;
  adoptedBy?: string;
  risk?: string;
  readOnly?: boolean;
  requiredScopes?: string[];
  inputSchema?: ExternalServiceToolSchemaSummary;
  transport?: {
    type?: string;
    method?: string;
    path?: string;
    endpointRef?: string;
    rpcMethod?: string;
    rpcEndpointRef?: string;
    openapiOperationId?: string;
    endpointRedacted?: boolean;
  };
  review?: {
    protocolVersion?: string;
    state?: string;
    reasonCode?: string;
    current?: Record<string, unknown>;
    previous?: Record<string, unknown> | null;
    diff?: {
      changedFields?: string[];
      currentFingerprint?: string;
      previousFingerprint?: string;
    };
  };
};

export type ExternalServiceToolTombstone = {
  protocolVersion?: string;
  state?: string;
  name: string;
  title?: string;
  toolFingerprint?: string;
  previousFingerprint?: string;
  firstMissingAt?: string;
  lastMissingAt?: string;
  lastSeenAt?: string;
  discoveryFingerprint?: string;
  reasonCode?: string;
};

export type ExternalServiceTemplateField = {
  path: string;
  label: string;
  value?: unknown;
  placeholder?: string;
  note?: string;
  requiredWhenGroupUsed?: boolean;
  alternatives?: string[];
};

export type ExternalServiceTemplateFieldGroup = {
  id: string;
  label: string;
  kind: "required" | "minimum" | "optional" | "defaulted" | "materialized-only" | string;
  fields: ExternalServiceTemplateField[];
  mode?: "all-or-none" | "any" | string;
  hiddenByDefault?: boolean;
  note?: string;
};

export type ExternalServiceTemplateFieldModel = {
  schemaVersion: string;
  protocolFamily: string;
  endpointField: string;
  minimum: ExternalServiceTemplateFieldGroup;
  requiredGroups: ExternalServiceTemplateFieldGroup[];
  optionalGroups: ExternalServiceTemplateFieldGroup[];
  defaultedGroups: ExternalServiceTemplateFieldGroup[];
  materializedOnlyGroups: ExternalServiceTemplateFieldGroup[];
};

export type ExternalServiceTemplateCombination = {
  id: string;
  allOf?: string[];
  oneOf?: string[];
  anyOf?: string[];
  note?: string;
};

export type ExternalServiceTemplateMinimumCombination = {
  mode: "template-selected" | "self-describing-json" | string;
  fields: string[];
  draft?: ExternalServiceConfig;
};

export type ExternalServiceTemplateFieldCategories = {
  required?: string[];
  requiredCombinations?: ExternalServiceTemplateCombination[];
  optionalCombinations?: ExternalServiceTemplateCombination[];
  optionalFields?: string[];
  advancedOptionalFields?: string[];
  defaultedByTemplateFields?: string[];
  defaultedByNormalizerFields?: string[];
  materializedOnlyFields?: string[];
};

export type ExternalServiceTemplate = {
  templateId: string;
  label: string;
  upstreamType: string;
  bindingMode: string;
  requiredFields?: string[];
  requiredCombinations?: ExternalServiceTemplateCombination[];
  minimalRequiredFields: string[];
  optionalCombinations?: ExternalServiceTemplateCombination[];
  optionalGroups: string[];
  defaultedFields?: string[];
  productionGates?: string[];
  draft?: ExternalServiceConfig;
  minimumDraft?: ExternalServiceConfig;
  operatorMinimumDraft?: ExternalServiceConfig;
  materializedDraft?: ExternalServiceConfig;
  fieldModel?: ExternalServiceTemplateFieldModel;
  formContract?: {
    schemaVersion: string;
    protocolFamily?: string;
    endpointField?: string;
    requiredFields?: string[];
    templateSelectedRequiredFields?: string[];
    directJsonRequiredFields?: string[];
    requiredCombinations?: ExternalServiceTemplateCombination[];
    optionalCombinations?: ExternalServiceTemplateCombination[];
    optionalFields?: string[];
    fieldModel?: ExternalServiceTemplateFieldModel;
    minimumUsableCombination?: ExternalServiceTemplateMinimumCombination;
    directJsonMinimumCombination?: ExternalServiceTemplateMinimumCombination;
    fieldCategories?: ExternalServiceTemplateFieldCategories;
    defaultedFields?: string[];
    advancedOptionalFields?: string[];
    materializedOnlyFields?: string[];
    hiddenByDefaultFields?: string[];
    minimumDraft?: ExternalServiceConfig;
    operatorMinimumDraft?: ExternalServiceConfig;
  };
};

export type ExternalServiceTemplateCatalog = {
  ok?: boolean;
  schemaVersion: string;
  kind: string;
  generatedAt: string;
  defaultPolicyPreset: string;
  templates: ExternalServiceTemplate[];
};

export type ExternalServiceMaterializedManifest = {
  schemaVersion: string;
  kind: string;
  manifestId: string;
  serviceId: string;
  serviceName: string;
  templateId: string;
  policyPreset: string;
  lifecycle: "invalid" | "draftVerified" | "contractVerified" | string;
  productionReady: boolean;
  generatedAt: string;
  source: string;
  binding?: Record<string, unknown>;
  upstream?: Record<string, unknown>;
  draftConfigHash?: string;
  redactedConfig?: ExternalServiceConfig;
  evidence?: Record<string, unknown>;
  promotion?: {
    status?: string;
    reason?: string;
    missingGateIds?: string[];
  };
};

export type ExternalServiceState = {
  ok: boolean;
  schemaVersion: string;
  generatedAt: string;
  registryKind: string;
  registryPath: string;
  activeServiceId: string;
  activeConfig: ExternalServiceConfig;
  activeConfigText: string;
  activeValidation: ExternalServiceValidation;
  templateCatalog?: ExternalServiceTemplateCatalog;
  templates?: ExternalServiceTemplate[];
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
  materializedManifest?: ExternalServiceMaterializedManifest | null;
  manifestText?: string;
};

export type ExternalServiceSaveResult = ExternalServiceVerifyResult & {
  registryPath?: string;
  activeServiceId?: string;
  manifestPath?: string;
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

export type ExternalServiceToolAdoptionResult = {
  ok: boolean;
  error?: string;
  code?: string;
  cachePath?: string;
  serviceId: string;
  adoptedAt?: string;
  adoptedBy?: string;
  adoptedToolNames?: string[];
  activeToolCount?: number;
  candidateToolCount?: number;
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

export function getExternalServiceTemplates() {
  return getJson<ExternalServiceTemplateCatalog>("/api/external-services/templates");
}

export function createExternalServiceTemplateDraft(templateId: string, serviceId = "") {
  return postJson<{ ok: boolean; draft: ExternalServiceConfig; draftText: string }>(
    "/api/external-services/templates/draft",
    { templateId, serviceId },
  );
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

export function adoptExternalServiceTools({
  serviceId,
  toolNames = [],
  adoptAll = false,
  adoptedBy = "operator",
  expectedFingerprints = {},
}: {
  serviceId: string;
  toolNames?: string[];
  adoptAll?: boolean;
  adoptedBy?: string;
  expectedFingerprints?: Record<string, string>;
}) {
  return postJson<ExternalServiceToolAdoptionResult>(
    "/api/external-services/tools/adopt",
    { serviceId, toolNames, adoptAll, adoptedBy, expectedFingerprints },
    { safetyConfirm: true },
  );
}
