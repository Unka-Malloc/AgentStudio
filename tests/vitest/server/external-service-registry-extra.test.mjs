import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const loadCompositionPresetsMock = vi.hoisted(() => vi.fn());
const describeExternalMcpToolCacheSyncMock = vi.hoisted(() => vi.fn());
const discoverExternalMcpToolsMock = vi.hoisted(() => vi.fn());
const discoverExternalHttpToolsMock = vi.hoisted(() => vi.fn());
const refreshExternalMcpToolCacheMock = vi.hoisted(() => vi.fn());

vi.mock("../../../server/platform/common/composition-management/index.mjs", async () => {
  const actual = await vi.importActual("../../../server/platform/common/composition-management/index.mjs");
  return {
    ...actual,
    loadCompositionPresets: loadCompositionPresetsMock
  };
});

vi.mock("../../../server/platform/common/composition-management/external-mcp-passthrough-runtime.mjs", async () => {
  const actual = await vi.importActual("../../../server/platform/common/composition-management/external-mcp-passthrough-runtime.mjs");
  return {
    ...actual,
    describeExternalMcpToolCacheSync: describeExternalMcpToolCacheSyncMock,
    discoverExternalHttpTools: discoverExternalHttpToolsMock,
    discoverExternalMcpTools: discoverExternalMcpToolsMock,
    refreshExternalMcpToolCache: refreshExternalMcpToolCacheMock
  };
});

import {
  EXTERNAL_SERVICE_REGISTRY_KIND,
  describeExternalServices,
  externalServiceRegistryPath,
  refreshExternalServiceRuntime,
  saveExternalServiceConfig,
  verifyExternalServiceConfigPayload
} from "../../../server/platform/common/composition-management/external-service-registry.mjs";
import { normalizeExternalServiceConfig } from "../../../server/platform/common/composition-management/external-service-adapter.mjs";

const tempRoots = [];

async function tempDir(prefix) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeText(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, value, "utf8");
}

function setDefaultRuntimeMocks({
  services = {},
  updatedAt = "2024-01-01T00:00:00.000Z"
} = {}) {
  loadCompositionPresetsMock.mockResolvedValue([]);
  describeExternalMcpToolCacheSyncMock.mockReturnValue({ updatedAt, services });
}

function buildConnectedService(serviceId, overrides = {}) {
  return normalizeExternalServiceConfig({
    serviceId,
    serviceName: overrides.serviceName || `${serviceId}.service`,
    displayName: overrides.displayName || serviceId,
    mode: overrides.mode || "connected",
    startupPolicy: overrides.startupPolicy || "external-only",
    upstream: overrides.upstream || {
      type: "mcp",
      transport: "streamable-http",
      url: "http://127.0.0.1:8787/mcp"
    },
    binding: overrides.binding || {
      mode: "passthrough",
      outlet: "pact.skillHub"
    },
    scripts: overrides.scripts || {}
  });
}

function buildCompiledService(serviceId, overrides = {}) {
  return normalizeExternalServiceConfig({
    serviceId,
    serviceName: overrides.serviceName || `${serviceId}.service`,
    displayName: overrides.displayName || serviceId,
    mode: overrides.mode || "connected",
    startupPolicy: overrides.startupPolicy || "external-only",
    upstream: overrides.upstream || {
      type: "openapi",
      baseUrl: "https://api.example.test:8443",
      spec: {
        openapi: "3.0.0",
        paths: {}
      }
    },
    binding: overrides.binding || {
      mode: "compile",
      outlet: "pact.skillHub"
    },
    scripts: overrides.scripts || {}
  });
}

afterEach(async () => {
  vi.resetAllMocks();
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("external service registry extras", () => {
  it("computes registry paths and falls back to the bundled template when nothing is saved", async () => {
    const userDataPath = await tempDir("pact-external-service-registry-empty-");
    const cwd = await tempDir("pact-external-service-registry-cwd-");

    setDefaultRuntimeMocks();

    const state = await describeExternalServices({ userDataPath, cwd });

    expect(externalServiceRegistryPath(userDataPath)).toBe(
      path.join(userDataPath, "external-services", "registry.json")
    );
    expect(state.ok).toBe(true);
    expect(state.registryKind).toBe(EXTERNAL_SERVICE_REGISTRY_KIND);
    expect(state.registryPath).toBe(externalServiceRegistryPath(userDataPath));
    expect(state.configuredCount).toBe(0);
    expect(state.gatewayCount).toBe(1);
    expect(state.presetCount).toBe(0);
    expect(state.activeServiceId).toBe("example-external-service");
    expect(state.activeConfig).toMatchObject({
      serviceId: "example-external-service",
      displayName: "Example External Service"
    });
    expect(state.services).toHaveLength(1);
    expect(state.services[0]).toMatchObject({
      serviceId: "pact.upstream.cloud-drive",
      source: "gateway",
      sourceLabel: "上游服务切面网关"
    });
  });

  it("treats malformed registry JSON as an empty registry", async () => {
    const userDataPath = await tempDir("pact-external-service-registry-malformed-");
    const cwd = await tempDir("pact-external-service-registry-cwd-");

    await writeText(
      externalServiceRegistryPath(userDataPath),
      "{not-json"
    );
    setDefaultRuntimeMocks();

    const state = await describeExternalServices({ userDataPath, cwd });

    expect(state.configuredCount).toBe(0);
    expect(state.activeServiceId).toBe("example-external-service");
    expect(state.services).toHaveLength(1);
  });

  it("describes configured, preset, and gateway entries while honoring activeServiceId", async () => {
    const userDataPath = await tempDir("pact-external-service-registry-describe-");
    const cwd = await tempDir("pact-external-service-registry-cwd-");

    const registryPath = externalServiceRegistryPath(userDataPath);
    await writeJson(registryPath, {
      schemaVersion: 9,
      kind: EXTERNAL_SERVICE_REGISTRY_KIND,
      activeServiceId: "preset-service",
      updatedAt: "2024-02-03T04:05:06.000Z",
      services: [
        buildConnectedService("saved-service", {
          displayName: "Saved Service",
          serviceName: "saved.service",
          binding: {
            mode: "passthrough",
            outlet: "pact.skillHub",
            scopes: ["workspace:read", "workspace:read", "workspace:write"]
          }
        }),
        {
          serviceName: "missing-id"
        },
        buildConnectedService("saved-service", {
          displayName: "Saved Service Duplicate",
          serviceName: "saved.service",
          binding: {
            mode: "passthrough",
            outlet: "pact.skillHub"
          }
        })
      ]
    });

    loadCompositionPresetsMock.mockResolvedValue([
      {
        filePath: path.join(cwd, "preset-service.preset.json"),
        preset: {
          presetId: "preset-service",
          displayName: "Preset Service",
          deploymentTarget: {
            serviceName: "external.preset.service"
          },
          intent: {
            serviceKind: "external-service",
            summary: "Preset-backed external service"
          },
          externalService: buildConnectedService("preset-service", {
            displayName: "Preset Service",
            serviceName: "external.preset.service"
          })
        }
      },
      {
        filePath: path.join(cwd, "fallback-service.preset.json"),
        preset: {
          presetId: "fallback-service",
          displayName: "Fallback Service",
          deploymentTarget: {
            serviceName: "external.fallback.service",
            applicationId: "fallback-service"
          },
          intent: {
            serviceKind: "external-service",
            summary: "Fallback preset"
          },
          applicationDependencyPackage: {
            featureIds: ["feature-b", "feature-b"],
            requiredOperations: ["operation-b"]
          }
        }
      }
    ]);
    describeExternalMcpToolCacheSyncMock.mockReturnValue({
      updatedAt: "2024-02-03T04:05:06.000Z",
      services: {
        "saved-service": { toolCount: 1 }
      }
    });

    const state = await describeExternalServices({ userDataPath, cwd });

    expect(state.configuredCount).toBe(2);
    expect(state.gatewayCount).toBe(1);
    expect(state.presetCount).toBe(2);
    expect(state.activeServiceId).toBe("preset-service");
    expect(state.activeConfig.serviceId).toBe("preset-service");
    expect(state.services).toHaveLength(5);

    const savedService = state.services.find((entry) => entry.serviceId === "saved-service");
    const presetService = state.services.find((entry) => entry.serviceId === "preset-service");
    const fallbackService = state.services.find((entry) => entry.serviceId === "fallback-service");
    const gatewayService = state.services.find((entry) => entry.source === "gateway");

    expect(savedService).toMatchObject({
      source: "configured",
      sourceLabel: "已保存配置",
      validationStatus: "valid",
      externalMcp: { toolCount: 1 }
    });
    expect(savedService.featureIds).toEqual([]);
    expect(savedService.config.binding?.requiredScopes).toEqual(["workspace:read", "workspace:write"]);
    expect(state.services.filter((entry) => entry.serviceId === "saved-service")).toHaveLength(2);

    expect(presetService).toMatchObject({
      source: "preset",
      sourceLabel: "装配预设",
      validationStatus: "valid"
    });
    expect(fallbackService).toMatchObject({
      source: "preset",
      sourceLabel: "装配预设",
      validationStatus: "valid"
    });
    expect(gatewayService).toMatchObject({
      serviceId: "pact.upstream.cloud-drive",
      sourceLabel: "上游服务切面网关"
    });
    expect(state.externalMcpCache.serviceCount).toBe(1);
  });

  it("normalizes payloads and rejects malformed config bodies", async () => {
    const normalizedFromObject = await verifyExternalServiceConfigPayload({
      payload: {
        config: {
          id: "normalized-service",
          serviceName: "Normalized Service",
          displayName: "Normalized Display",
          mode: "connected",
          upstream: {
            type: "openapi",
            baseUrl: "https://api.example.test:8443",
            spec: {
              openapi: "3.0.0",
              paths: {}
            }
          },
          binding: {
            mode: "compile",
            outlet: "pact.skillHub",
            scopes: ["knowledge:read", "knowledge:read"]
          }
        }
      }
    });
    const normalizedFromText = await verifyExternalServiceConfigPayload({
      payload: {
        configText: JSON.stringify({
          serviceId: "text-service",
          serviceName: "Text Service",
          upstream: {
            type: "mcp",
            transport: "streamable-http",
            url: "http://127.0.0.1:8787/mcp"
          },
          binding: {
            mode: "passthrough",
            outlet: "pact.skillHub"
          }
        })
      }
    });
    const invalidJson = await verifyExternalServiceConfigPayload({
      payload: { configText: "{not-json" }
    });
    const invalidShape = await verifyExternalServiceConfigPayload({
      payload: { configText: "[]" }
    });

    expect(normalizedFromObject.ok).toBe(true);
    expect(normalizedFromObject.config).toMatchObject({
      serviceId: "normalized-service",
      serviceName: "Normalized Service",
      displayName: "Normalized Display"
    });
    expect(normalizedFromObject.config.binding?.requiredScopes).toEqual(["knowledge:read"]);
    expect(normalizedFromObject.configText).toContain('"serviceId": "normalized-service"');

    expect(normalizedFromText.ok).toBe(true);
    expect(normalizedFromText.config.serviceId).toBe("text-service");

    expect(invalidJson.ok).toBe(false);
    expect(invalidJson.error).toContain("JSON");
    expect(invalidJson.validation.errors).toEqual([
      "External service config JSON parse failed."
    ]);

    expect(invalidShape.ok).toBe(false);
    expect(invalidShape.error).toBe("External service config must be a JSON object.");
    expect(invalidShape.validation.errors).toEqual([
      "External service config must be a JSON object."
    ]);
  });

  it("overwrites duplicate service ids and updates the active service on save", async () => {
    const userDataPath = await tempDir("pact-external-service-registry-save-");
    const registryPath = externalServiceRegistryPath(userDataPath);

    await writeJson(registryPath, {
      schemaVersion: 1,
      kind: EXTERNAL_SERVICE_REGISTRY_KIND,
      activeServiceId: "beta",
      updatedAt: "2024-02-03T04:05:06.000Z",
      services: [
        buildConnectedService("alpha", {
          displayName: "Alpha Old",
          serviceName: "alpha.service"
        }),
        buildConnectedService("beta", {
          displayName: "Beta",
          serviceName: "beta.service"
        }),
        buildConnectedService("alpha", {
          displayName: "Alpha Stale",
          serviceName: "alpha.service"
        })
      ]
    });

    const saved = await saveExternalServiceConfig({
      userDataPath,
      payload: {
        config: {
          serviceId: "alpha",
          serviceName: "Alpha Prime",
          displayName: "Alpha Prime",
          mode: "connected"
        }
      }
    });

    const registry = JSON.parse(await fs.readFile(registryPath, "utf8"));

    expect(saved.ok).toBe(true);
    expect(saved.activeServiceId).toBe("alpha");
    expect(registry.activeServiceId).toBe("alpha");
    expect(registry.services).toHaveLength(2);
    expect(registry.services.map((item) => item.serviceId)).toEqual(["alpha", "beta"]);
    expect(registry.services[0]).toMatchObject({
      serviceId: "alpha",
      serviceName: "Alpha Prime",
      displayName: "Alpha Prime"
    });
    expect(registry.services[1]).toMatchObject({
      serviceId: "beta",
      serviceName: "beta.service"
    });
  });

  it("refreshes external MCP services through discovery and cache refresh", async () => {
    const userDataPath = await tempDir("pact-external-service-registry-save-mcp-");
    const registryPath = externalServiceRegistryPath(userDataPath);
    const config = buildConnectedService("mcp-service", {
      displayName: "MCP Service",
      serviceName: "external.mcp.service"
    });

    discoverExternalMcpToolsMock.mockResolvedValue({
      ok: true,
      serviceId: "mcp-service",
      toolCount: 1,
      tools: [{ name: "echo" }],
      discoveredAt: "2024-02-03T04:05:06.000Z"
    });
    refreshExternalMcpToolCacheMock.mockResolvedValue({
      ok: true,
      serviceId: "mcp-service",
      toolCount: 1,
      tools: [{ name: "echo" }],
      discoveredAt: "2024-02-03T04:05:06.000Z",
      cachePath: path.join(userDataPath, "cache.json")
    });

    const saved = await saveExternalServiceConfig({
      userDataPath,
      payload: { config }
    });
    const registry = JSON.parse(await fs.readFile(registryPath, "utf8"));

    expect(saved.ok).toBe(true);
    expect(discoverExternalMcpToolsMock).toHaveBeenCalledTimes(1);
    expect(refreshExternalMcpToolCacheMock).toHaveBeenCalledTimes(1);
    expect(refreshExternalMcpToolCacheMock.mock.calls[0][0]).toMatchObject({
      userDataPath,
      config: { serviceId: "mcp-service" }
    });
    expect(saved.externalMcpDiscovery).toMatchObject({
      ok: true,
      toolCount: 1,
      cachePath: path.join(userDataPath, "cache.json")
    });
    expect(saved.externalToolDiscovery).toMatchObject({
      ok: true,
      toolCount: 1
    });
    expect(registry.services).toHaveLength(1);
    expect(registry.activeServiceId).toBe("mcp-service");
  });

  it("returns discovery failures before the registry is written and refresh failures after write", async () => {
    const discoveryFailurePath = await tempDir("pact-external-service-registry-save-http-failure-");
    const refreshFailurePath = await tempDir("pact-external-service-registry-save-refresh-failure-");
    const discoveryFailureRegistry = externalServiceRegistryPath(discoveryFailurePath);
    const refreshFailureRegistry = externalServiceRegistryPath(refreshFailurePath);

    discoverExternalHttpToolsMock.mockRejectedValueOnce(new Error("openapi discovery failed"));
    const discoveryFailed = await saveExternalServiceConfig({
      userDataPath: discoveryFailurePath,
      payload: {
        config: buildCompiledService("http-service")
      }
    });

    discoverExternalMcpToolsMock.mockResolvedValueOnce({
      ok: true,
      serviceId: "refresh-failure",
      toolCount: 1,
      tools: [{ name: "echo" }],
      discoveredAt: "2024-02-03T04:05:06.000Z"
    });
    refreshExternalMcpToolCacheMock.mockRejectedValueOnce(new Error("refresh failed"));
    const refreshFailed = await saveExternalServiceConfig({
      userDataPath: refreshFailurePath,
      payload: {
        config: buildConnectedService("refresh-failure")
      }
    });
    const refreshFailureRegistryJson = JSON.parse(await fs.readFile(refreshFailureRegistry, "utf8"));

    await expect(fs.access(discoveryFailureRegistry)).rejects.toMatchObject({
      code: "ENOENT"
    });

    expect(discoveryFailed.ok).toBe(false);
    expect(discoveryFailed.error).toBe("openapi discovery failed");
    expect(discoveryFailed.externalToolDiscovery).toMatchObject({
      ok: false,
      error: "openapi discovery failed"
    });

    expect(refreshFailed.ok).toBe(false);
    expect(refreshFailed.error).toBe("refresh failed");
    expect(refreshFailed.externalToolDiscovery).toMatchObject({
      ok: false,
      error: "refresh failed"
    });
    expect(refreshFailureRegistryJson.activeServiceId).toBe("refresh-failure");
    expect(refreshFailureRegistryJson.services.map((item) => item.serviceId)).toEqual([
      "refresh-failure"
    ]);
  });

  it("refreshes, skips, and fails registry entries while honoring a requested service filter", async () => {
    const userDataPath = await tempDir("pact-external-service-registry-refresh-");
    const registryPath = externalServiceRegistryPath(userDataPath);

    await writeJson(registryPath, {
      schemaVersion: 1,
      kind: EXTERNAL_SERVICE_REGISTRY_KIND,
      activeServiceId: "tool-service",
      updatedAt: "2024-02-03T04:05:06.000Z",
      services: [
        buildConnectedService("tool-service", {
          displayName: "Tool Service"
        }),
        {
          serviceId: "skipped-service",
          serviceName: "Skipped Service",
          mode: "connected",
          displayName: "Skipped Service"
        },
        buildCompiledService("invalid-service", {
          displayName: "Invalid Service",
          upstream: {
            type: "openapi",
            baseUrl: "",
            spec: null
          }
        })
      ]
    });

    loadCompositionPresetsMock.mockResolvedValue([]);
    describeExternalMcpToolCacheSyncMock.mockReturnValue({
      updatedAt: "2024-02-03T04:05:06.000Z",
      services: {}
    });
    refreshExternalMcpToolCacheMock.mockResolvedValue({
      ok: true,
      toolCount: 2,
      tools: [{ name: "echo" }, { name: "status" }],
      discoveredAt: "2024-02-03T04:05:06.000Z",
      cachePath: path.join(userDataPath, "cache.json")
    });

    const filtered = await refreshExternalServiceRuntime({
      userDataPath,
      serviceId: "tool-service"
    });
    const fullRefresh = await refreshExternalServiceRuntime({ userDataPath });

    expect(filtered.ok).toBe(true);
    expect(filtered.requestedServiceId).toBe("tool-service");
    expect(filtered.results).toHaveLength(1);
    expect(filtered.results[0]).toMatchObject({
      serviceId: "tool-service",
      status: "refreshed",
      ok: true,
      toolCount: 2
    });

    expect(fullRefresh.ok).toBe(false);
    expect(fullRefresh.results).toHaveLength(3);
    expect(fullRefresh.refreshedCount).toBe(1);
    expect(fullRefresh.failedCount).toBe(1);
    expect(fullRefresh.skippedCount).toBe(1);
    expect(fullRefresh.results.find((item) => item.serviceId === "skipped-service")).toMatchObject({
      status: "skipped",
      reason: "not_external_tool_service"
    });
    expect(fullRefresh.results.find((item) => item.serviceId === "invalid-service")).toMatchObject({
      status: "failed",
      error: "External OpenAPI upstream requires upstream.baseUrl or upstream.url."
    });
    expect(fullRefresh.state.registryPath).toBe(registryPath);
    expect(fullRefresh.state.activeServiceId).toBe("tool-service");
  });
});
