import fs from "node:fs/promises";
import path from "node:path";

import { ServerConfig } from "../config/ServerConfig.mjs";
import {
  loadCompositionPresets
} from "./index.mjs";
import {
  EXTERNAL_SERVICE_CLOUD_DRIVE_PROVIDER_VALUES,
  EXTERNAL_SERVICE_CONFIG_KIND,
  normalizeExternalServiceConfig,
  validateExternalServiceConfig
} from "./external-service-adapter.mjs";
import {
  describeExternalMcpToolCacheSync,
  discoverExternalHttpTools,
  discoverExternalMcpTools,
  isExternalHttpCompileConfig,
  isExternalMcpPassthroughConfig,
  refreshExternalMcpToolCache
} from "./external-mcp-passthrough-runtime.mjs";

export const EXTERNAL_SERVICE_REGISTRY_KIND = "pact.external-service.registry";

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
        schemaVersion: Number(raw.schemaVersion || 1),
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
        schemaVersion: 1,
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
    sourceLabel: serviceSourceLabel(source),
    presetId,
    filePath,
    featureIds: uniqueStrings(config.featureIds),
    requiredOperations: uniqueStrings(config.requiredOperations),
    scriptIds,
    scriptCount: scriptIds.length,
    healthCheck: config.healthCheck || { type: "none" },
    externalMcp: externalMcpCache?.services?.[config.serviceId] || null,
    validationStatus: validation.ok ? "valid" : "invalid",
    validation,
    config
  };
}

function fallbackConfigFromPreset(preset = {}) {
  const deploymentTarget = asObject(preset.deploymentTarget);
  const applicationPackage = asObject(preset.applicationDependencyPackage);
  return {
    schemaVersion: 1,
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
    return normalizeExternalServiceConfig({
      schemaVersion: 1,
      kind: EXTERNAL_SERVICE_CONFIG_KIND,
      serviceId: "example-external-service",
      serviceName: "external.example.service",
      displayName: "Example External Service",
      mode: "on-demand",
      startupPolicy: "on-demand",
      description: "Example config for adapting an external service into a Pact composition package.",
      scripts: {},
      healthCheck: { type: "none", required: false }
    });
  }
}

async function loadGatewayServiceEntries({ cwd = process.cwd(), externalMcpCache = null } = {}) {
  const config = normalizeExternalServiceConfig({
    schemaVersion: 1,
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
        protocolVersion: "pact.cloud-drive-upstream-gateway.v1",
        replacesPlatformCore: true,
        legacyOperationPrefix: "sharedspace.drive."
      }
    },
    binding: {
      mode: "passthrough",
      outlet: "pact.skillHub",
      requiredScopes: ["drive:read", "drive:write", "drive:sync", "drive:share"],
      risk: "safe_write",
      metadata: {
        outletReason: "Cloud drive is an upstream service capability, not a sharedspace core operation."
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

function selectActiveConfig({ configuredEntries, presetEntries, templateConfig, activeServiceId }) {
  if (activeServiceId) {
    const configured = configuredEntries.find((entry) => entry.serviceId === activeServiceId);
    if (configured?.config) {
      return configured.config;
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
  const presetEntries = await loadPresetServiceEntries({ cwd });
  const gatewayEntries = await loadGatewayServiceEntries({ cwd, externalMcpCache });
  const activeConfig = selectActiveConfig({
    configuredEntries,
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
    schemaVersion: 1,
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
    templateConfig,
    templateConfigText: `${JSON.stringify(templateConfig, null, 2)}\n`,
    services: [...configuredEntries, ...gatewayEntries, ...presetEntries],
    configuredCount: configuredEntries.length,
    gatewayCount: gatewayEntries.length,
    presetCount: presetEntries.length
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
  return {
    ok: validation.ok,
    config,
    configText: `${JSON.stringify(config, null, 2)}\n`,
    validation
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
            timeoutMs: config.upstream?.timeoutMs || undefined
          })
        : await discoverExternalHttpTools(config, {
            timeoutMs: config.upstream?.timeoutMs || undefined
          });
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "External service tool discovery failed.",
        registryPath,
        activeServiceId: config.serviceId,
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
        }
      };
    }
  }
  const { registry } = await loadRegistryFile(userDataPath);
  const services = asArray(registry.services)
    .map((item) => normalizeExternalServiceConfig(item))
    .filter((item) => item?.serviceId && item.serviceId !== config.serviceId);
  const nextRegistry = {
    schemaVersion: 1,
    kind: EXTERNAL_SERVICE_REGISTRY_KIND,
    activeServiceId: config.serviceId,
    updatedAt: nowIso(),
    services: [...services, config].sort((a, b) => a.serviceId.localeCompare(b.serviceId))
  };
  await writeRegistryFile({ userDataPath, registry: nextRegistry });
  if (isExternalToolConfig(config)) {
    try {
      externalToolDiscovery = await refreshExternalMcpToolCache({
        userDataPath,
        config,
        timeoutMs: config.upstream?.timeoutMs || undefined,
        discovery: externalToolDiscovery
      });
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "External service tool discovery failed.",
        registryPath,
        activeServiceId: config.serviceId,
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
        }
      };
    }
  }
  return {
    ok: true,
    registryPath,
    activeServiceId: config.serviceId,
    config,
    configText: `${JSON.stringify(config, null, 2)}\n`,
    validation: verification.validation,
    externalMcpDiscovery: externalToolDiscovery,
    externalToolDiscovery
  };
}

export async function refreshExternalServiceRuntime({
  userDataPath = "",
  cwd = process.cwd(),
  serviceId = ""
} = {}) {
  const { filePath, registry } = await loadRegistryFile(userDataPath);
  const requestedServiceId = String(serviceId || "").trim();
  const configs = asArray(registry.services)
    .map((item) => normalizeExternalServiceConfig(item))
    .filter((item) => item?.serviceId)
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
      const discovery = await refreshExternalMcpToolCache({
        userDataPath,
        config,
        timeoutMs: config.upstream?.timeoutMs || undefined
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
    state: await describeExternalServices({ userDataPath, cwd })
  };
}
