import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { ServerConfig } from "../config/ServerConfig.mjs";
import {
  loadCompositionPresets
} from "./index.mjs";
import {
  EXTERNAL_SERVICE_CLOUD_DRIVE_PROVIDER_VALUES,
  EXTERNAL_SERVICE_CONFIG_KIND,
  loadExternalServiceConfig,
  normalizeExternalServiceConfig,
  validateExternalServiceConfig
} from "./external-service-adapter.mjs";
import {
  createExternalServiceDraft,
  listExternalServiceTemplates,
  materializeExternalServiceManifest,
  readExternalServiceManifest,
  writeExternalServiceManifest
} from "./external-service-template-catalog.mjs";
import {
  evaluateExternalServiceRedirectLocationWithDns,
  fetchExternalServiceWithPinnedDns
} from "./external-service-egress-policy.mjs";
import {
  describeExternalMcpToolCacheSync,
  adoptExternalMcpCandidateTools,
  discoverExternalHttpTools,
  discoverExternalMcpTools,
  externalMcpToolCachePath,
  isExternalHttpCompileConfig,
  isExternalMcpPassthroughConfig,
  promoteExternalMcpCandidateVersion,
  rollbackExternalMcpVersion,
  refreshExternalMcpToolCache
} from "./external-mcp-passthrough-runtime.mjs";

export const EXTERNAL_SERVICE_REGISTRY_KIND = "pact.external-service.registry";
const SERVICEHUB_PRODUCTION_VERIFIER_PROTOCOL_VERSION = "v0.0.1:external-service:servicehub-production-verifier-1";
const SERVICEHUB_LOCAL_CONTRACT_VERIFIER_ID = "v0.0.1:strategy:servicehub-local-contract-verifier-1";
const SERVICEHUB_RUNTIME_INVALIDATION_SCOPES = Object.freeze([
  "tool-management-catalog",
  "mcp-tools-list",
  "grant-projection",
  "external-service-runtime-cache",
  "external-service-health-state",
  "upstream-session"
]);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
}

function uniqueStrings(values = []) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))].sort();
}

function nowIso() {
  return new Date().toISOString();
}

function stableJson(value) {
  if (value === null || value === undefined) {
    return "null";
  }
  if (typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
    .join(",")}}`;
}

function sha256Json(value) {
  return crypto.createHash("sha256").update(stableJson(value)).digest("hex");
}

function serviceHubRuntimeInvalidation({
  reasonCode = "",
  serviceId = "",
  invalidation = null
} = {}) {
  const current = asObject(invalidation, {});
  return {
    ...current,
    reasonCode: String(current.reasonCode || reasonCode || "external_service_runtime_reprojection_required").trim(),
    serviceId: String(current.serviceId || serviceId || "").trim(),
    scopes: uniqueStrings([
      ...SERVICEHUB_RUNTIME_INVALIDATION_SCOPES,
      ...asArray(current.scopes)
    ])
  };
}

function externalServiceAuthFingerprint(config = null) {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return "";
  }
  const upstream = asObject(config.upstream, {});
  const auth = asObject(upstream.auth, null);
  const upstreamSecretRef = String(upstream.secretRef || "").trim();
  if (!auth && !upstreamSecretRef) {
    return "";
  }
  return sha256Json({
    auth: auth || null,
    upstreamSecretRef
  });
}

function externalServiceAuthChanged(previousConfig = null, nextConfig = null) {
  return externalServiceAuthFingerprint(previousConfig) !== externalServiceAuthFingerprint(nextConfig);
}

function registryRoot(userDataPath = "") {
  return path.resolve(userDataPath || ServerConfig.getDataDir(), "external-services");
}

export function externalServiceRegistryPath(userDataPath = "") {
  return path.join(registryRoot(userDataPath), "registry.json");
}

async function readJsonFile(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function loadRegistryFile(userDataPath = "") {
  const filePath = externalServiceRegistryPath(userDataPath);
  try {
    const raw = await readJsonFile(filePath);
    return {
      filePath,
      registry: {
        schemaVersion: String(raw.schemaVersion || "v0.0.1:schema:definition-1"),
        kind: raw.kind || EXTERNAL_SERVICE_REGISTRY_KIND,
        activeServiceId: String(raw.activeServiceId || "").trim(),
        services: asArray(raw.services),
        updatedAt: String(raw.updatedAt || "").trim()
      }
    };
  } catch {
    return {
      filePath,
      registry: {
        schemaVersion: "v0.0.1:schema:definition-1",
        kind: EXTERNAL_SERVICE_REGISTRY_KIND,
        activeServiceId: "",
        services: [],
        updatedAt: ""
      }
    };
  }
}

async function writeRegistryFile({ userDataPath = "", registry }) {
  const filePath = externalServiceRegistryPath(userDataPath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
  return filePath;
}

function serviceSourceLabel(source) {
  switch (source) {
    case "configured":
      return "已保存配置";
    case "preset":
      return "装配预设";
    case "template":
      return "模板";
    case "gateway":
      return "上游服务切面网关";
    case "discovered":
      return "动态配置扫描";
    default:
      return source || "未知来源";
  }
}

async function serviceEntryFromConfig({
  config,
  source,
  presetId = "",
  filePath = "",
  cwd = process.cwd(),
  discoveryScope = "",
  requireKnownPaths = false,
  externalMcpCache = null
}) {
  const validation = await validateExternalServiceConfig({
    config,
    cwd,
    requireKnownPaths
  });
  const scriptIds = Object.keys(config.scripts || {}).sort();
  return {
    entryId: `${source}:${config.serviceId || presetId || filePath}`,
    serviceId: config.serviceId,
    serviceName: config.serviceName,
    displayName: config.displayName || config.serviceName || config.serviceId,
    description: config.description || "",
    mode: config.mode,
    startupPolicy: config.startupPolicy,
    source,
    discoveryScope,
    sourceLabel: serviceSourceLabel(source),
    presetId,
    filePath,
    featureIds: uniqueStrings(config.featureIds),
    requiredOperations: uniqueStrings(config.requiredOperations),
    scriptIds,
    scriptCount: scriptIds.length,
    healthCheck: config.healthCheck || { type: "none" },
    maintenancePreset: config.healthCheck?.type === "http"
      ? {
          presetId: `external-service:${config.serviceId}:health`,
          operationId: "external_services.health.inspect",
          serviceId: config.serviceId,
          label: `${config.displayName || config.serviceName || config.serviceId} 健康检查`
        }
      : null,
    externalMcp: externalMcpCache?.services?.[config.serviceId] || null,
    validationStatus: validation.ok ? "valid" : "invalid",
    validation,
    config
  };
}

async function pathExists(filePath = "") {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function scanDirectoryForConfigFiles(directory = "", depth = 1) {
  const root = path.resolve(directory);
  if (!(await pathExists(root))) {
    return [];
  }
  const found = [];
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (entry.isFile() && (
      entry.name === "external-service.config.json" ||
      entry.name.endsWith(".external-service.json")
    )) {
      found.push(entryPath);
      continue;
    }
    if (entry.isDirectory() && depth > 0) {
      const nestedDefault = path.join(entryPath, "external-service.config.json");
      if (await pathExists(nestedDefault)) {
        found.push(nestedDefault);
      } else {
        found.push(...await scanDirectoryForConfigFiles(entryPath, depth - 1));
      }
    }
  }
  return found;
}

async function discoverExternalServiceConfigFiles({ userDataPath = "", cwd = process.cwd() } = {}) {
  const roots = [
    path.resolve(cwd, "external-services"),
    path.join(registryRoot(userDataPath), "configs"),
    path.join(registryRoot(userDataPath), "enabled")
  ];
  const files = [];
  for (const root of roots) {
    files.push(...await scanDirectoryForConfigFiles(root, 2));
  }
  return [...new Set(files)].sort();
}

async function loadDiscoveredServiceEntries({ userDataPath = "", cwd = process.cwd(), externalMcpCache = null } = {}) {
  const files = await discoverExternalServiceConfigFiles({ userDataPath, cwd });
  const userRegistryRoot = path.resolve(registryRoot(userDataPath));
  const entries = [];
  for (const filePath of files) {
    try {
      const { config } = await loadExternalServiceConfig(filePath, { cwd });
      if (!config?.serviceId) {
        continue;
      }
      entries.push(await serviceEntryFromConfig({
        config,
        source: "discovered",
        filePath,
        cwd,
        discoveryScope: path.resolve(filePath).startsWith(`${userRegistryRoot}${path.sep}`) ? "user-data" : "repository",
        requireKnownPaths: false,
        externalMcpCache
      }));
    } catch (error) {
      entries.push({
        entryId: `discovered:${filePath}`,
        serviceId: "",
        displayName: path.basename(path.dirname(filePath)) || path.basename(filePath),
        source: "discovered",
        sourceLabel: serviceSourceLabel("discovered"),
        filePath,
        validationStatus: "invalid",
        validation: {
          ok: false,
          errors: [error instanceof Error ? error.message : "External service config load failed."],
          warnings: []
        },
        config: null
      });
    }
  }
  return entries.sort((a, b) => String(a.displayName || a.serviceId).localeCompare(String(b.displayName || b.serviceId)));
}

function dedupeServiceEntriesByPriority(entries = []) {
  const priority = new Map([
    ["configured", 0],
    ["discovered", 1],
    ["gateway", 2],
    ["preset", 3],
    ["template", 4]
  ]);
  function entryPriority(entry = {}) {
    const base = priority.get(entry.source) ?? 99;
    return entry.source === "discovered" && entry.discoveryScope === "user-data"
      ? base - 0.25
      : base;
  }
  const selected = new Map();
  for (const entry of entries) {
    const key = entry.serviceId || entry.entryId || entry.filePath;
    if (!key) continue;
    const current = selected.get(key);
    if (!current || entryPriority(entry) < entryPriority(current)) {
      selected.set(key, entry);
    }
  }
  return [...selected.values()].sort((a, b) => String(a.displayName || a.serviceId).localeCompare(String(b.displayName || b.serviceId)));
}

function fallbackConfigFromPreset(preset = {}) {
  const deploymentTarget = asObject(preset.deploymentTarget);
  const applicationPackage = asObject(preset.applicationDependencyPackage);
  return {
    schemaVersion: "v0.0.1:schema:definition-1",
    kind: EXTERNAL_SERVICE_CONFIG_KIND,
    serviceId: String(preset.presetId || deploymentTarget.applicationId || "").trim(),
    serviceName: String(deploymentTarget.serviceName || preset.intent?.provider || preset.presetId || "").trim(),
    displayName: String(preset.displayName || preset.presetId || "").trim(),
    mode: "connected",
    startupPolicy: "external-only",
    description: String(preset.intent?.summary || "").trim(),
    featureIds: uniqueStrings(applicationPackage.featureIds),
    requiredOperations: uniqueStrings(applicationPackage.requiredOperations),
    includePaths: uniqueStrings([
      ...asArray(applicationPackage.moduleDescriptors),
      ...asArray(applicationPackage.moduleEntrypoints),
      ...asArray(applicationPackage.scripts),
      ...asArray(applicationPackage.serviceRoots)
    ]),
    scripts: {},
    healthCheck: { type: "none", required: false },
    metadata: {
      presetId: preset.presetId || "",
      serviceKind: preset.intent?.serviceKind || preset.intent?.repositoryKind || ""
    }
  };
}

async function loadPresetServiceEntries({ cwd = process.cwd() } = {}) {
  let presetRecords = [];
  try {
    presetRecords = await loadCompositionPresets({ cwd });
  } catch {
    return [];
  }

  const entries = [];
  for (const { filePath, preset } of presetRecords) {
    const deploymentServiceName = String(preset?.deploymentTarget?.serviceName || "").trim();
    const externalConfig = normalizeExternalServiceConfig(preset?.externalService || null, {
      presetId: preset?.presetId,
      serviceName: deploymentServiceName,
      displayName: preset?.displayName
    });
    const shouldExpose =
      Boolean(externalConfig) ||
      deploymentServiceName.startsWith("external.") ||
      String(preset?.intent?.serviceKind || "").includes("external");
    if (!shouldExpose) {
      continue;
    }
    const config = externalConfig || normalizeExternalServiceConfig(fallbackConfigFromPreset(preset), {
      presetId: preset?.presetId,
      serviceName: deploymentServiceName,
      displayName: preset?.displayName
    });
    entries.push(await serviceEntryFromConfig({
      config,
      source: "preset",
      presetId: String(preset?.presetId || "").trim(),
      filePath,
      cwd,
      requireKnownPaths: false
    }));
  }
  return entries.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

async function loadTemplateConfig({ cwd = process.cwd() } = {}) {
  const examplePath = path.resolve(cwd, "server/platform/common/composition-management/external-service.example.json");
  try {
    const raw = await readJsonFile(examplePath);
    return normalizeExternalServiceConfig(raw, {
      serviceId: raw.serviceId || "example-external-service"
    });
  } catch {
    return normalizeExternalServiceConfig(createExternalServiceDraft({ serviceId: "example-raw-mcp" }));
  }
}

async function loadGatewayServiceEntries({ cwd = process.cwd(), externalMcpCache = null } = {}) {
  const config = normalizeExternalServiceConfig({
    schemaVersion: "v0.0.1:schema:definition-1",
    kind: EXTERNAL_SERVICE_CONFIG_KIND,
    serviceId: "pact.upstream.cloud-drive",
    serviceName: "external.cloudDrive.gateway",
    mode: "connected",
    startupPolicy: "external-only",
    description: "Cloud drive adapters are exposed through the upstream service aspect gateway instead of the platform core sharedspace surface.",
    featureIds: ["upstream-service-gateway"],
    requiredOperations: [
      "external.cloudDrive.connect",
      "external.cloudDrive.status",
      "external.cloudDrive.item.list",
      "external.cloudDrive.file.download",
      "external.cloudDrive.file.upload",
      "external.cloudDrive.sync.plan",
      "external.cloudDrive.sync.apply",
      "external.cloudDrive.permission.list"
    ],
    upstream: {
      type: "cloud-drive",
      providers: EXTERNAL_SERVICE_CLOUD_DRIVE_PROVIDER_VALUES,
      mode: "contract",
      transport: "pact-upstream-gateway",
      metadata: {
        protocolVersion: "v0.0.1:storage:cloud-drive-upstream-gateway-1",
        replacesPlatformCore: true,
        legacyOperationPrefix: "sharedspace.drive."
      }
    },
    binding: {
      mode: "passthrough",
      outlet: "pact.serviceHub",
      requiredScopes: ["drive:read", "drive:write", "drive:sync", "drive:share"],
      risk: "safe_write",
      metadata: {
        outletReason: "Cloud drive is an upstream service capability exposed through ServiceHub, not a sharedspace core operation."
      }
    },
    healthCheck: { type: "none", required: false },
    metadata: {
      gatewayAspect: "upstream-service",
      managedBy: "pact.external-service-gateway"
    }
  });
  return [
    await serviceEntryFromConfig({
      config,
      source: "gateway",
      presetId: "pact.upstream.cloud-drive",
      cwd,
      requireKnownPaths: false,
      externalMcpCache
    })
  ];
}

function selectActiveConfig({ configuredEntries, discoveredEntries = [], presetEntries, templateConfig, activeServiceId }) {
  if (activeServiceId) {
    const configured = configuredEntries.find((entry) => entry.serviceId === activeServiceId);
    if (configured?.config) {
      return configured.config;
    }
    const discovered = discoveredEntries.find((entry) => entry.serviceId === activeServiceId);
    if (discovered?.config) {
      return discovered.config;
    }
    const preset = presetEntries.find((entry) => entry.serviceId === activeServiceId);
    if (preset?.config) {
      return preset.config;
    }
  }
  return configuredEntries[0]?.config || templateConfig;
}

export async function describeExternalServices({
  userDataPath = "",
  cwd = process.cwd()
} = {}) {
  const { filePath, registry } = await loadRegistryFile(userDataPath);
  const externalMcpCache = describeExternalMcpToolCacheSync({ userDataPath });
  const templateCatalog = listExternalServiceTemplates();
  const templateConfig = await loadTemplateConfig({ cwd });
  const configuredEntries = [];
  for (const rawConfig of registry.services) {
    const config = normalizeExternalServiceConfig(rawConfig);
    if (!config?.serviceId) {
      continue;
    }
    configuredEntries.push(await serviceEntryFromConfig({
      config,
      source: "configured",
      filePath,
      cwd,
      requireKnownPaths: false,
      externalMcpCache
    }));
  }
  const discoveredEntries = await loadDiscoveredServiceEntries({ userDataPath, cwd, externalMcpCache });
  const presetEntries = await loadPresetServiceEntries({ cwd });
  const gatewayEntries = await loadGatewayServiceEntries({ cwd, externalMcpCache });
  const activeConfig = selectActiveConfig({
    configuredEntries,
    discoveredEntries,
    presetEntries: [...gatewayEntries, ...presetEntries],
    templateConfig,
    activeServiceId: registry.activeServiceId
  });
  const activeValidation = await validateExternalServiceConfig({
    config: activeConfig,
    cwd,
    requireKnownPaths: false
  });

  return {
    ok: true,
    schemaVersion: "v0.0.1:schema:definition-1",
    generatedAt: nowIso(),
    registryKind: registry.kind,
    registryPath: filePath,
    activeServiceId: activeConfig?.serviceId || "",
    activeConfig,
    activeConfigText: `${JSON.stringify(activeConfig, null, 2)}\n`,
    activeValidation,
    externalMcpCache: {
      updatedAt: externalMcpCache.updatedAt,
      serviceCount: Object.keys(externalMcpCache.services || {}).length
    },
    templateCatalog,
    templates: templateCatalog.templates,
    templateConfig,
    templateConfigText: `${JSON.stringify(templateConfig, null, 2)}\n`,
    services: dedupeServiceEntriesByPriority([...configuredEntries, ...discoveredEntries, ...gatewayEntries, ...presetEntries]),
    discoveredServices: discoveredEntries,
    allServices: dedupeServiceEntriesByPriority([...configuredEntries, ...discoveredEntries, ...gatewayEntries, ...presetEntries]),
    configuredCount: configuredEntries.length,
    discoveredCount: discoveredEntries.filter((entry) => entry.config).length,
    gatewayCount: gatewayEntries.length,
    presetCount: presetEntries.length,
    maintenancePresets: dedupeServiceEntriesByPriority([...configuredEntries, ...discoveredEntries, ...gatewayEntries, ...presetEntries])
      .map((entry) => entry.maintenancePreset)
      .filter(Boolean)
  };
}

function externalServicePayloadConfig(payload = {}) {
  const body = asObject(payload);
  if (typeof body.configText === "string") {
    return JSON.parse(body.configText);
  }
  if (body.config && typeof body.config === "object" && !Array.isArray(body.config)) {
    return body.config;
  }
  return body;
}

function isExternalToolConfig(config = {}) {
  return isExternalMcpPassthroughConfig(config) || isExternalHttpCompileConfig(config);
}

export async function verifyExternalServiceConfigPayload({
  payload = {},
  cwd = process.cwd(),
  requireKnownPaths = false
} = {}) {
  let rawConfig;
  try {
    rawConfig = externalServicePayloadConfig(payload);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "External service config JSON parse failed.",
      config: null,
      validation: {
        ok: false,
        errors: ["External service config JSON parse failed."],
        warnings: []
      }
    };
  }
  const config = normalizeExternalServiceConfig(rawConfig);
  if (!config) {
    return {
      ok: false,
      error: "External service config must be a JSON object.",
      config: null,
      validation: {
        ok: false,
        errors: ["External service config must be a JSON object."],
        warnings: []
      }
    };
  }
  const validation = await validateExternalServiceConfig({
    config,
    cwd,
    requireKnownPaths
  });
  const materializedManifest = materializeExternalServiceManifest({
    config,
    validation,
    source: "verify"
  });
  return {
    ok: validation.ok,
    config,
    configText: `${JSON.stringify(config, null, 2)}\n`,
    validation,
    materializedManifest,
    manifestText: materializedManifest ? `${JSON.stringify(materializedManifest, null, 2)}\n` : ""
  };
}

export async function saveExternalServiceConfig({
  userDataPath = "",
  payload = {},
  cwd = process.cwd()
} = {}) {
  const verification = await verifyExternalServiceConfigPayload({
    payload,
    cwd,
    requireKnownPaths: false
  });
  if (!verification.ok) {
    return verification;
  }
  const config = verification.config;
  const registryPath = externalServiceRegistryPath(userDataPath);
  let externalToolDiscovery = null;
  if (isExternalMcpPassthroughConfig(config) || isExternalHttpCompileConfig(config)) {
    try {
      externalToolDiscovery = isExternalMcpPassthroughConfig(config)
        ? await discoverExternalMcpTools(config, {
            userDataPath,
            timeoutMs: config.upstream?.timeoutMs || undefined
          })
        : await discoverExternalHttpTools(config, {
            userDataPath,
            timeoutMs: config.upstream?.timeoutMs || undefined
          });
    } catch (error) {
      const { registry } = await loadRegistryFile(userDataPath);
      const materializedManifest = materializeExternalServiceManifest({
        config,
        validation: verification.validation,
        discovery: {
          ok: false,
          error: error instanceof Error ? error.message : "External service tool discovery failed."
        },
        source: "save"
      });
      return {
        ok: false,
        error: error instanceof Error ? error.message : "External service tool discovery failed.",
        registryPath,
        activeServiceId: registry.activeServiceId || "",
        config,
        configText: `${JSON.stringify(config, null, 2)}\n`,
        validation: {
          ok: false,
          errors: [error instanceof Error ? error.message : "External service tool discovery failed."],
          warnings: verification.validation?.warnings || []
        },
        externalMcpDiscovery: {
          ok: false,
          error: error instanceof Error ? error.message : "External service tool discovery failed."
        },
        externalToolDiscovery: {
          ok: false,
          error: error instanceof Error ? error.message : "External service tool discovery failed."
        },
        materializedManifest,
        manifestText: materializedManifest ? `${JSON.stringify(materializedManifest, null, 2)}\n` : ""
      };
    }
  }
  if (isExternalToolConfig(config)) {
    try {
      externalToolDiscovery = await refreshExternalMcpToolCache({
        userDataPath,
        config,
        timeoutMs: config.upstream?.timeoutMs || undefined,
        discovery: externalToolDiscovery,
        manifestId: verification.materializedManifest?.manifestId || "",
        manifestFingerprint: verification.materializedManifest?.manifestFingerprint || "",
        productionGates: verification.materializedManifest?.evidence?.productionGates || []
      });
    } catch (error) {
      const materializedManifest = materializeExternalServiceManifest({
        config,
        validation: verification.validation,
        discovery: {
          ok: false,
          error: error instanceof Error ? error.message : "External service tool discovery failed."
        },
        source: "save"
      });
      const { registry } = await loadRegistryFile(userDataPath);
      const manifestPath = await writeExternalServiceManifest({
        userDataPath,
        manifest: materializedManifest
      });
      return {
        ok: false,
        error: error instanceof Error ? error.message : "External service tool discovery failed.",
        registryPath,
        activeServiceId: registry.activeServiceId || "",
        config,
        configText: `${JSON.stringify(config, null, 2)}\n`,
        validation: {
          ok: false,
          errors: [error instanceof Error ? error.message : "External service tool discovery failed."],
          warnings: verification.validation?.warnings || []
        },
        externalMcpDiscovery: {
          ok: false,
          error: error instanceof Error ? error.message : "External service tool discovery failed."
        },
        externalToolDiscovery: {
          ok: false,
          error: error instanceof Error ? error.message : "External service tool discovery failed."
        },
        materializedManifest,
        manifestPath,
        manifestText: materializedManifest ? `${JSON.stringify(materializedManifest, null, 2)}\n` : ""
      };
    }
  }
  const { registry } = await loadRegistryFile(userDataPath);
  const previousConfig = asArray(registry.services)
    .map((item) => normalizeExternalServiceConfig(item))
    .find((item) => item?.serviceId === config.serviceId) || null;
  const authChanged = externalServiceAuthChanged(previousConfig, config);
  const services = asArray(registry.services)
    .map((item) => normalizeExternalServiceConfig(item))
    .filter((item) => item?.serviceId && item.serviceId !== config.serviceId);
  const nextRegistry = {
    schemaVersion: "v0.0.1:schema:definition-1",
    kind: EXTERNAL_SERVICE_REGISTRY_KIND,
    activeServiceId: config.serviceId,
    updatedAt: nowIso(),
    services: [...services, config].sort((a, b) => a.serviceId.localeCompare(b.serviceId))
  };
  await writeRegistryFile({ userDataPath, registry: nextRegistry });
  const materializedManifest = materializeExternalServiceManifest({
    config,
    validation: verification.validation,
    discovery: externalToolDiscovery,
    source: "save"
  });
  const manifestPath = await writeExternalServiceManifest({
    userDataPath,
    manifest: materializedManifest
  });
  return {
    ok: true,
    registryPath,
    activeServiceId: config.serviceId,
    config,
    configText: `${JSON.stringify(config, null, 2)}\n`,
    validation: verification.validation,
    externalMcpDiscovery: externalToolDiscovery,
    externalToolDiscovery,
    materializedManifest,
    manifestPath,
    catalogChange: externalServiceCatalogChange({
      type: "external_service_config_saved",
      reasonCode: "external_service_config_saved",
      serviceId: config.serviceId,
      manifestFingerprint: materializedManifest?.manifestFingerprint || "",
      at: nextRegistry.updatedAt,
      invalidation: serviceHubRuntimeInvalidation({
        reasonCode: authChanged
          ? "external_service_secret_auth_changed"
          : "external_service_config_saved_requires_runtime_reprojection",
        serviceId: config.serviceId
      })
    }),
    manifestText: materializedManifest ? `${JSON.stringify(materializedManifest, null, 2)}\n` : ""
  };
}

function externalServiceHealthUrl(config = {}) {
  const health = config.healthCheck || {};
  if (health.url) {
    return health.url;
  }
  if (health.port) {
    return `http://${health.host || "127.0.0.1"}:${health.port}${health.path || "/"}`;
  }
  return "";
}

async function checkExternalServiceHealth(config = {}) {
  const health = config.healthCheck || {};
  const base = {
    serviceId: config.serviceId,
    serviceName: config.serviceName || config.serviceId,
    displayName: config.displayName || config.serviceName || config.serviceId,
    required: health.required === true,
    type: health.type || "none",
    url: externalServiceHealthUrl(config)
  };
  if (!health || health.type === "none") {
    return {
      ...base,
      ok: true,
      status: "skipped",
      reason: "no_health_check_configured"
    };
  }
  if (health.type !== "http") {
    return {
      ...base,
      ok: false,
      status: "failed",
      error: `Unsupported health check type: ${health.type}`
    };
  }
  if (!base.url) {
    return {
      ...base,
      ok: health.required !== true,
      status: health.required === true ? "failed" : "skipped",
      error: "External service HTTP health check has no url or port."
    };
  }
  const timeoutMs = Number(health.timeoutMs || 10000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  let pinnedFetch = null;
  try {
    pinnedFetch = await fetchExternalServiceWithPinnedDns({
      url: base.url,
      label: "healthCheck.url",
      policyPreset: config.policyPreset,
      policies: config.policies,
      init: {
        redirect: "manual",
        signal: controller.signal
      }
    });
    const { response } = pinnedFetch;
    const redirectDecision = response.status >= 300 && response.status < 400
      ? await evaluateExternalServiceRedirectLocationWithDns({
          sourceUrl: base.url,
          status: response.status,
          location: response.headers.get("location") || "",
          label: "healthCheck.url.redirectLocation",
          policyPreset: config.policyPreset,
          policies: config.policies
        })
      : null;
    const contentType = String(response.headers.get("content-type") || "");
    const contentLength = String(response.headers.get("content-length") || "");
    try {
      await response.body?.cancel?.();
    } catch {
      // Health checks should not expose or depend on the upstream response body.
    }
    return {
      ...base,
      ok: response.ok,
      status: response.ok ? "healthy" : "unhealthy",
      httpStatus: response.status,
      latencyMs: Date.now() - startedAt,
      redirectDecision,
      response: {
        contentType,
        contentLength
      }
    };
  } catch (error) {
    return {
      ...base,
      ok: false,
      status: "unreachable",
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error)
    };
  } finally {
    await pinnedFetch?.close?.();
    clearTimeout(timer);
  }
}

export async function inspectExternalServiceHealth({
  userDataPath = "",
  cwd = process.cwd(),
  serviceId = ""
} = {}) {
  const requestedServiceId = String(serviceId || "").trim();
  const state = await describeExternalServices({ userDataPath, cwd });
  const services = asArray(state.services)
    .filter((entry) => entry.config)
    .filter((entry) => !requestedServiceId || entry.serviceId === requestedServiceId);
  const results = [];
  for (const entry of services) {
    results.push({
      source: entry.source,
      sourceLabel: entry.sourceLabel,
      filePath: entry.filePath,
      ...await checkExternalServiceHealth(entry.config)
    });
  }
  const failedRequired = results.filter((item) => item.required && item.ok === false);
  const unhealthy = results.filter((item) => item.ok === false);
  return {
    ok: failedRequired.length === 0,
    generatedAt: nowIso(),
    registryPath: state.registryPath,
    requestedServiceId,
    checkedCount: results.length,
    healthyCount: results.filter((item) => item.status === "healthy").length,
    skippedCount: results.filter((item) => item.status === "skipped").length,
    unhealthyCount: unhealthy.length,
    failedRequiredCount: failedRequired.length,
    maintenancePreset: {
      presetId: "external-services.health",
      label: "外部服务健康巡检",
      operationId: "external_services.health.inspect"
    },
    results
  };
}

export async function refreshExternalServiceRuntime({
  userDataPath = "",
  cwd = process.cwd(),
  serviceId = ""
} = {}) {
  const { filePath, registry } = await loadRegistryFile(userDataPath);
  const requestedServiceId = String(serviceId || "").trim();
  const discoveredEntries = await loadDiscoveredServiceEntries({ userDataPath, cwd });
  const configs = [
    ...asArray(registry.services),
    ...discoveredEntries.map((entry) => entry.config).filter(Boolean)
  ]
    .map((item) => normalizeExternalServiceConfig(item))
    .filter((item) => item?.serviceId)
    .filter((item, index, values) => values.findIndex((candidate) => candidate.serviceId === item.serviceId) === index)
    .filter((item) => !requestedServiceId || item.serviceId === requestedServiceId);
  const results = [];
  for (const config of configs) {
    const baseResult = {
      serviceId: config.serviceId,
      serviceName: config.serviceName || config.serviceId,
      displayName: config.displayName || config.serviceId,
      upstreamType: config.upstream?.type || "",
      transport: config.upstream?.transport || ""
    };
    const validation = await validateExternalServiceConfig({
      config,
      cwd,
      requireKnownPaths: false
    });
    if (!validation.ok) {
      results.push({
        ...baseResult,
        ok: false,
        status: "failed",
        error: validation.errors?.[0] || "External service config is invalid.",
        validation
      });
      continue;
    }
    if (!isExternalToolConfig(config)) {
      results.push({
        ...baseResult,
        ok: true,
        status: "skipped",
        reason: "not_external_tool_service"
      });
      continue;
    }
    try {
      const materializedManifest = materializeExternalServiceManifest({
        config,
        validation,
        source: "refresh"
      });
      const discovery = await refreshExternalMcpToolCache({
        userDataPath,
        config,
        timeoutMs: config.upstream?.timeoutMs || undefined,
        manifestId: materializedManifest?.manifestId || "",
        manifestFingerprint: materializedManifest?.manifestFingerprint || ""
      });
      results.push({
        ...baseResult,
        ok: true,
        status: "refreshed",
        toolCount: discovery.toolCount,
        tools: discovery.tools,
        discoveredAt: discovery.discoveredAt,
        cachePath: discovery.cachePath
      });
    } catch (error) {
      results.push({
        ...baseResult,
        ok: false,
        status: "failed",
        error: error instanceof Error ? error.message : "External MCP discovery failed."
      });
    }
  }
  const refreshedCount = results.filter((item) => item.status === "refreshed").length;
  const failedCount = results.filter((item) => item.status === "failed").length;
  const skippedCount = results.filter((item) => item.status === "skipped").length;
  return {
    ok: failedCount === 0,
    registryPath: filePath,
    activeServiceId: registry.activeServiceId || "",
    requestedServiceId,
    refreshedAt: nowIso(),
    refreshedCount,
    failedCount,
    skippedCount,
    results,
    catalogChange: externalServiceCatalogChange({
      type: "external_service_catalog_refreshed",
      reasonCode: "external_service_catalog_refreshed",
      serviceId: requestedServiceId,
      at: nowIso(),
      invalidation: serviceHubRuntimeInvalidation({
        reasonCode: "external_service_runtime_refreshed",
        serviceId: requestedServiceId
      })
    }),
    state: await describeExternalServices({ userDataPath, cwd })
  };
}

async function readExternalMcpToolCacheFile(userDataPath = "") {
  const filePath = externalMcpToolCachePath(userDataPath);
  try {
    const cache = JSON.parse(await fs.readFile(filePath, "utf8"));
    return {
      filePath,
      cache: {
        schemaVersion: String(cache.schemaVersion || "v0.0.1:schema:definition-1"),
        kind: cache.kind || "pact.external-mcp.tool-cache",
        updatedAt: String(cache.updatedAt || "").trim(),
        services: asObject(cache.services)
      }
    };
  } catch {
    return {
      filePath,
      cache: {
        schemaVersion: "v0.0.1:schema:definition-1",
        kind: "pact.external-mcp.tool-cache",
        updatedAt: "",
        services: {}
      }
    };
  }
}

async function writeExternalMcpToolCacheFile({ userDataPath = "", cache } = {}) {
  const filePath = externalMcpToolCachePath(userDataPath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
  return filePath;
}

function productionVerifierError(message = "", code = "servicehub_production_verification_failed", details = {}) {
  const error = new Error(message || "ServiceHub production verification failed.");
  error.code = code;
  error.statusCode = 409;
  Object.assign(error, details);
  return error;
}

function externalServiceCatalogChange({
  source = "external-service-registry",
  type = "external_service_catalog_refreshed",
  reasonCode = "",
  serviceId = "",
  serviceCatalogVersionId = "",
  activeVersionId = "",
  candidateVersionId = "",
  candidateFingerprint = "",
  manifestFingerprint = "",
  at = nowIso(),
  invalidation = null
} = {}) {
  const resolvedReason = String(reasonCode || type || "external_service_catalog_refreshed").trim();
  return {
    schemaVersion: "v0.0.1:schema:definition-1",
    source: String(source || "external-service-registry").trim(),
    type: String(type || resolvedReason).trim(),
    reasonCode: resolvedReason,
    serviceId: String(serviceId || "").trim(),
    serviceCatalogVersionId: String(serviceCatalogVersionId || activeVersionId || "").trim(),
    activeVersionId: String(activeVersionId || serviceCatalogVersionId || "").trim(),
    candidateVersionId: String(candidateVersionId || "").trim(),
    candidateFingerprint: String(candidateFingerprint || "").trim(),
    manifestFingerprint: String(manifestFingerprint || "").trim(),
    at: String(at || nowIso()).trim(),
    ...(invalidation ? { invalidation } : {})
  };
}

function manifestProductionGateIds(manifest = {}, service = {}) {
  const manifestGates = asArray(manifest?.evidence?.productionGates)
    .map((gate) => String(gate?.gateId || gate || "").trim())
    .filter(Boolean);
  const serviceGates = asArray(service?.productionGates)
    .map((gate) => String(gate?.gateId || gate || "").trim())
    .filter(Boolean);
  return uniqueStrings(manifestGates.length ? manifestGates : serviceGates);
}

function serviceCandidateVersion(service = {}) {
  return service.candidateVersion && typeof service.candidateVersion === "object" && !Array.isArray(service.candidateVersion)
    ? service.candidateVersion
    : null;
}

function buildProductionGateRecord({
  gateId = "",
  service = {},
  manifest = {},
  candidateVersion = {},
  verifierId = SERVICEHUB_LOCAL_CONTRACT_VERIFIER_ID,
  verifiedAt = nowIso(),
  verifiedBy = "operator"
} = {}) {
  const serviceId = String(service.serviceId || manifest.serviceId || "").trim();
  const candidateVersionId = String(candidateVersion.versionId || "").trim();
  const candidateFingerprint = String(candidateVersion.fingerprint || "").trim();
  const evidencePayload = {
    protocolVersion: SERVICEHUB_PRODUCTION_VERIFIER_PROTOCOL_VERSION,
    verificationMode: "local-contract",
    gateId,
    serviceId,
    manifestId: String(manifest.manifestId || "").trim(),
    manifestFingerprint: String(manifest.manifestFingerprint || "").trim(),
    candidateVersionId,
    candidateFingerprint,
    serviceCatalogVersionId: String(service.serviceCatalogVersionId || service.activeVersionId || "").trim(),
    toolNames: asArray(candidateVersion.toolNames),
    toolCount: Number(candidateVersion.toolCount || 0),
    checkedAt: verifiedAt
  };
  const evidenceDigest = `sha256:${sha256Json(evidencePayload)}`;
  const record = {
    protocolVersion: SERVICEHUB_PRODUCTION_VERIFIER_PROTOCOL_VERSION,
    gateId,
    status: "passed",
    verifierId: String(verifierId || SERVICEHUB_LOCAL_CONTRACT_VERIFIER_ID).trim(),
    verifierVersion: "local-contract-1",
    verificationMode: "local-contract",
    evidenceRef: `servicehub://production-evidence/${encodeURIComponent(serviceId)}/${encodeURIComponent(candidateVersionId)}/${encodeURIComponent(gateId)}`,
    evidenceDigest,
    verifiedAt,
    verifiedBy: String(verifiedBy || "operator").trim(),
    manifestId: String(manifest.manifestId || "").trim(),
    manifestFingerprint: String(manifest.manifestFingerprint || "").trim(),
    candidateVersionId,
    candidateFingerprint,
    subjectFingerprint: candidateFingerprint
  };
  return {
    ...record,
    recordDigest: `sha256:${sha256Json(record)}`,
    evidencePayload
  };
}

export async function verifyExternalServiceProductionGates({
  userDataPath = "",
  cwd = process.cwd(),
  serviceId = "",
  candidateVersionId = "",
  expectedCandidateVersionId = "",
  expectedCandidateFingerprint = "",
  verifierId = SERVICEHUB_LOCAL_CONTRACT_VERIFIER_ID,
  verifiedBy = "operator"
} = {}) {
  const id = String(serviceId || "").trim();
  if (!id) {
    throw productionVerifierError(
      "ServiceHub production verification requires serviceId.",
      "servicehub_production_verification_requires_service_id"
    );
  }
  const { filePath: manifestPath, manifest } = await readExternalServiceManifest({ userDataPath, serviceId: id });
  if (!manifest) {
    throw productionVerifierError(`ServiceHub materialized manifest is missing for service: ${id}`, "servicehub_manifest_missing", {
      serviceId: id,
      manifestPath
    });
  }
  const { filePath: cachePath, cache } = await readExternalMcpToolCacheFile(userDataPath);
  const service = cache.services?.[id] || null;
  if (!service) {
    throw productionVerifierError(`ServiceHub tool cache is missing for service: ${id}`, "servicehub_tool_cache_missing", {
      serviceId: id,
      cachePath
    });
  }
  const candidateVersion = serviceCandidateVersion(service);
  if (!candidateVersion || !candidateVersion.versionId || !candidateVersion.fingerprint) {
    throw productionVerifierError(`ServiceHub candidate catalog is missing for service: ${id}`, "servicehub_candidate_version_missing", {
      serviceId: id
    });
  }
  if (Number(candidateVersion.toolCount || 0) <= 0) {
    throw productionVerifierError(`ServiceHub candidate catalog has no tools to verify: ${id}`, "servicehub_candidate_version_empty", {
      serviceId: id,
      candidateVersionId: String(candidateVersion.versionId || "").trim()
    });
  }
  const requestedCandidateVersionId = String(candidateVersionId || expectedCandidateVersionId || "").trim();
  if (requestedCandidateVersionId && requestedCandidateVersionId !== String(candidateVersion.versionId || "").trim()) {
    throw productionVerifierError(`ServiceHub candidate catalog version changed before production verification: ${id}`, "servicehub_stale_candidate_version", {
      serviceId: id,
      expectedCandidateVersionId: requestedCandidateVersionId,
      currentCandidateVersionId: String(candidateVersion.versionId || "").trim()
    });
  }
  const requestedCandidateFingerprint = String(expectedCandidateFingerprint || "").trim();
  if (requestedCandidateFingerprint && requestedCandidateFingerprint !== String(candidateVersion.fingerprint || "").trim()) {
    throw productionVerifierError(`ServiceHub candidate catalog fingerprint changed before production verification: ${id}`, "servicehub_stale_candidate_version", {
      serviceId: id,
      expectedCandidateFingerprint: requestedCandidateFingerprint,
      currentCandidateFingerprint: String(candidateVersion.fingerprint || "").trim()
    });
  }
  const manifestFingerprint = String(manifest.manifestFingerprint || "").trim();
  if (!manifestFingerprint || String(service.manifestFingerprint || "").trim() !== manifestFingerprint) {
    throw productionVerifierError(`ServiceHub manifest fingerprint does not match tool cache for service: ${id}`, "servicehub_manifest_cache_mismatch", {
      serviceId: id,
      manifestFingerprint,
      cacheManifestFingerprint: String(service.manifestFingerprint || "").trim()
    });
  }
  if (manifest?.evidence?.validation?.ok !== true) {
    throw productionVerifierError(`ServiceHub manifest validation has not passed for service: ${id}`, "servicehub_manifest_validation_not_passed", {
      serviceId: id,
      validation: manifest?.evidence?.validation || null
    });
  }
  if (manifest?.evidence?.discovery?.ok !== true) {
    throw productionVerifierError(`ServiceHub discovery evidence has not passed for service: ${id}`, "servicehub_manifest_discovery_not_passed", {
      serviceId: id,
      discovery: manifest?.evidence?.discovery || null
    });
  }
  const gateIds = manifestProductionGateIds(manifest, service);
  if (!gateIds.length) {
    throw productionVerifierError(`ServiceHub production gates are missing for service: ${id}`, "servicehub_production_gates_missing", {
      serviceId: id
    });
  }
  const verifiedAt = nowIso();
  const gateRecords = gateIds.map((gateId) => buildProductionGateRecord({
    gateId,
    service,
    manifest,
    candidateVersion,
    verifierId,
    verifiedAt,
    verifiedBy
  }));
  const productionGateEvidence = {
    protocolVersion: SERVICEHUB_PRODUCTION_VERIFIER_PROTOCOL_VERSION,
    verifierId: String(verifierId || SERVICEHUB_LOCAL_CONTRACT_VERIFIER_ID).trim(),
    verificationMode: "local-contract",
    verifiedAt,
    verifiedBy: String(verifiedBy || "operator").trim(),
    serviceId: id,
    manifestId: String(manifest.manifestId || "").trim(),
    manifestFingerprint,
    candidateVersionId: String(candidateVersion.versionId || "").trim(),
    candidateFingerprint: String(candidateVersion.fingerprint || "").trim(),
    gateCount: gateRecords.length,
    gateIds,
    gates: gateRecords
  };
  const nextManifest = {
    ...manifest,
    lifecycle: "productionVerified",
    productionReady: true,
    evidence: {
      ...asObject(manifest.evidence),
      productionGates: gateRecords,
      productionVerification: productionGateEvidence
    },
    promotion: {
      ...asObject(manifest.promotion),
      status: "ready_for_promotion",
      reason: "ServiceHub production gate evidence passed for the current candidate catalog.",
      missingGateIds: [],
      candidateVersionId: String(candidateVersion.versionId || "").trim(),
      candidateFingerprint: String(candidateVersion.fingerprint || "").trim(),
      verifiedAt
    }
  };
  const nextService = {
    ...service,
    productionGates: gateRecords,
    productionGateEvidence,
    productionEvidenceCandidateFingerprint: String(candidateVersion.fingerprint || "").trim()
  };
  const nextCache = {
    ...cache,
    updatedAt: verifiedAt,
    services: {
      ...cache.services,
      [id]: nextService
    }
  };
  const writtenManifestPath = await writeExternalServiceManifest({ userDataPath, manifest: nextManifest });
  const writtenCachePath = await writeExternalMcpToolCacheFile({ userDataPath, cache: nextCache });
  return {
    ok: true,
    protocolVersion: SERVICEHUB_PRODUCTION_VERIFIER_PROTOCOL_VERSION,
    serviceId: id,
    verifiedAt,
    verifiedBy: String(verifiedBy || "operator").trim(),
    verifierId: String(verifierId || SERVICEHUB_LOCAL_CONTRACT_VERIFIER_ID).trim(),
    verificationMode: "local-contract",
    manifestPath: writtenManifestPath,
    cachePath: writtenCachePath,
    manifestId: String(manifest.manifestId || "").trim(),
    manifestFingerprint,
    candidateVersionId: String(candidateVersion.versionId || "").trim(),
    candidateFingerprint: String(candidateVersion.fingerprint || "").trim(),
    gateCount: gateRecords.length,
    gateIds,
    productionGateEvidence,
    materializedManifest: nextManifest,
    catalogChange: externalServiceCatalogChange({
      type: "external_service_production_verified",
      reasonCode: "external_service_production_verified",
      serviceId: id,
      serviceCatalogVersionId: String(service.serviceCatalogVersionId || service.activeVersionId || "").trim(),
      activeVersionId: String(service.activeVersionId || service.activeVersion?.versionId || "").trim(),
      candidateVersionId: String(candidateVersion.versionId || "").trim(),
      candidateFingerprint: String(candidateVersion.fingerprint || "").trim(),
      manifestFingerprint,
      at: verifiedAt,
      invalidation: serviceHubRuntimeInvalidation({
        reasonCode: "production_verification_requires_runtime_reprojection",
        serviceId: id
      })
    }),
    state: await describeExternalServices({ userDataPath, cwd })
  };
}

export async function adoptExternalServiceTools({
  userDataPath = "",
  cwd = process.cwd(),
  serviceId = "",
  toolNames = [],
  adoptAll = false,
  adoptedBy = "operator",
  expectedFingerprints = {},
  acknowledgeRisk = false,
  allowRiskyTools = false
} = {}) {
  const adoption = await adoptExternalMcpCandidateTools({
    userDataPath,
    serviceId,
    toolNames,
    adoptAll,
    adoptedBy,
    expectedFingerprints,
    acknowledgeRisk,
    allowRiskyTools
  });
  return {
    ...adoption,
    catalogChange: externalServiceCatalogChange({
      ...adoption.catalogChange,
      source: "external-service-registry",
      type: "external_service_tools_adopted",
      reasonCode: "external_service_tools_adopted",
      serviceId: adoption.serviceId || serviceId,
      serviceCatalogVersionId: adoption.activeVersion?.versionId || adoption.catalogChange?.serviceCatalogVersionId || "",
      activeVersionId: adoption.activeVersion?.versionId || adoption.catalogChange?.activeVersionId || "",
      candidateVersionId: adoption.candidateVersion?.versionId || adoption.catalogChange?.candidateVersionId || "",
      candidateFingerprint: adoption.candidateVersion?.fingerprint || adoption.catalogChange?.candidateFingerprint || "",
      at: adoption.adoptedAt || adoption.catalogChange?.at || nowIso(),
      invalidation: serviceHubRuntimeInvalidation({
        reasonCode: "external_service_tools_adopted_requires_runtime_reprojection",
        serviceId: adoption.serviceId || serviceId,
        invalidation: adoption.catalogChange?.invalidation
      })
    }),
    state: await describeExternalServices({ userDataPath, cwd })
  };
}

export async function promoteExternalServiceTools({
  userDataPath = "",
  cwd = process.cwd(),
  serviceId = "",
  toolNames = [],
  adoptAll = false,
  promotedBy = "operator",
  expectedFingerprints = {},
  candidateVersionId = "",
  expectedCandidateVersionId = "",
  expectedCandidateFingerprint = "",
  acknowledgeRisk = false,
  allowRiskyTools = false
} = {}) {
  const promotion = await promoteExternalMcpCandidateVersion({
    userDataPath,
    serviceId,
    toolNames,
    adoptAll,
    promotedBy,
    expectedFingerprints,
    candidateVersionId,
    expectedCandidateVersionId,
    expectedCandidateFingerprint,
    acknowledgeRisk,
    allowRiskyTools
  });
  return {
    ...promotion,
    catalogChange: externalServiceCatalogChange({
      ...promotion.catalogChange,
      source: "external-service-registry",
      type: "external_service_catalog_promoted",
      reasonCode: "external_service_catalog_promoted",
      serviceId: promotion.serviceId || serviceId,
      serviceCatalogVersionId: promotion.activeVersion?.versionId || promotion.catalogChange?.serviceCatalogVersionId || "",
      activeVersionId: promotion.activeVersion?.versionId || promotion.catalogChange?.activeVersionId || "",
      candidateVersionId: promotion.candidateVersion?.versionId || promotion.catalogChange?.candidateVersionId || "",
      candidateFingerprint: promotion.candidateVersion?.fingerprint || promotion.catalogChange?.candidateFingerprint || "",
      at: promotion.promotedAt || promotion.catalogChange?.at || nowIso(),
      invalidation: serviceHubRuntimeInvalidation({
        reasonCode: "external_service_catalog_promoted_requires_runtime_reprojection",
        serviceId: promotion.serviceId || serviceId,
        invalidation: promotion.catalogChange?.invalidation
      })
    }),
    state: await describeExternalServices({ userDataPath, cwd })
  };
}

export async function rollbackExternalServiceTools({
  userDataPath = "",
  cwd = process.cwd(),
  serviceId = "",
  targetVersionId = "",
  rolledBackBy = "operator",
  reason = "operator_rollback"
} = {}) {
  const rollback = await rollbackExternalMcpVersion({
    userDataPath,
    serviceId,
    targetVersionId,
    rolledBackBy,
    reason
  });
  return {
    ...rollback,
    catalogChange: externalServiceCatalogChange({
      ...rollback.catalogChange,
      source: "external-service-registry",
      type: "external_service_catalog_rolled_back",
      reasonCode: "external_service_catalog_rolled_back",
      serviceId: rollback.serviceId || serviceId,
      serviceCatalogVersionId: rollback.activeVersion?.versionId || rollback.catalogChange?.serviceCatalogVersionId || "",
      activeVersionId: rollback.activeVersion?.versionId || rollback.catalogChange?.activeVersionId || "",
      candidateVersionId: rollback.candidateVersion?.versionId || rollback.catalogChange?.candidateVersionId || "",
      candidateFingerprint: rollback.candidateVersion?.fingerprint || rollback.catalogChange?.candidateFingerprint || "",
      at: rollback.rolledBackAt || rollback.catalogChange?.at || nowIso(),
      invalidation: serviceHubRuntimeInvalidation({
        reasonCode: "rollback_requires_runtime_reprojection",
        serviceId: rollback.serviceId || serviceId,
        invalidation: rollback.catalogChange?.invalidation
      })
    }),
    state: await describeExternalServices({ userDataPath, cwd })
  };
}
