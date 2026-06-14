import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const loadCompositionPresetsMock = vi.hoisted(() => vi.fn());
const describeExternalMcpToolCacheSyncMock = vi.hoisted(() => vi.fn());
const discoverExternalMcpToolsMock = vi.hoisted(() => vi.fn());
const discoverExternalHttpToolsMock = vi.hoisted(() => vi.fn());
const promoteExternalMcpCandidateVersionMock = vi.hoisted(() => vi.fn());
const refreshExternalMcpToolCacheMock = vi.hoisted(() => vi.fn());
const rollbackExternalMcpVersionMock = vi.hoisted(() => vi.fn());

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
    promoteExternalMcpCandidateVersion: promoteExternalMcpCandidateVersionMock,
    refreshExternalMcpToolCache: refreshExternalMcpToolCacheMock,
    rollbackExternalMcpVersion: rollbackExternalMcpVersionMock
  };
});

import {
  EXTERNAL_SERVICE_REGISTRY_KIND,
  describeExternalServices,
  externalServiceRegistryPath,
  inspectExternalServiceHealth,
  promoteExternalServiceTools,
  refreshExternalServiceRuntime,
  rollbackExternalServiceTools,
  saveExternalServiceConfig,
  verifyExternalServiceProductionGates,
  verifyExternalServiceConfigPayload
} from "../../../server/platform/common/composition-management/external-service-registry.mjs";
import { normalizeExternalServiceConfig } from "../../../server/platform/common/composition-management/external-service-adapter.mjs";
import { externalMcpToolCachePath } from "../../../server/platform/common/composition-management/external-mcp-passthrough-runtime.mjs";
import {
  SERVICEHUB_MATERIALIZED_MANIFEST_KIND,
  externalServiceManifestPath,
  getExternalServiceTemplate,
  listExternalServiceTemplates
} from "../../../server/platform/common/composition-management/external-service-template-catalog.mjs";

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

function deleteDraftPath(draft, pathExpression = "") {
  for (const pathOption of String(pathExpression || "").split("|").map((entry) => entry.trim()).filter(Boolean)) {
    const segments = pathOption.split(".");
    let targets = [draft];
    for (let index = 0; index < segments.length - 1; index += 1) {
      const segment = segments[index];
      if (segment.endsWith("[]")) {
        const key = segment.slice(0, -2);
        targets = targets.flatMap((target) => Array.isArray(target?.[key]) ? target[key] : []);
      } else {
        targets = targets.map((target) => target?.[segment]).filter(Boolean);
      }
    }
    const finalSegment = segments.at(-1);
    if (!finalSegment) {
      continue;
    }
    if (finalSegment.endsWith("[]")) {
      const key = finalSegment.slice(0, -2);
      for (const target of targets) {
        delete target?.[key];
      }
    } else {
      for (const target of targets) {
        delete target?.[finalSegment];
      }
    }
  }
}

function createResponse({ ok = true, status = 200, body = "", headers = {} } = {}) {
  const normalizedHeaders = new Map(
    Object.entries(headers).map(([key, value]) => [String(key).toLowerCase(), String(value)])
  );
  return {
    ok,
    status,
    headers: {
      get(name) {
        return normalizedHeaders.get(String(name).toLowerCase()) || null;
      }
    },
    body: {
      async cancel() {}
    },
    async text() {
      return typeof body === "string" ? body : JSON.stringify(body);
    }
  };
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
    policyPreset: overrides.policyPreset || "servicehub.development-local",
    upstream: overrides.upstream || {
      type: "mcp",
      transport: "streamable-http",
      url: "http://127.0.0.1:8787/mcp"
    },
    binding: overrides.binding || {
      mode: "passthrough",
      outlet: "pact.serviceHub"
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
    policyPreset: overrides.policyPreset,
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
      outlet: "pact.serviceHub"
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
    expect(state.activeServiceId).toBe("example-raw-mcp");
    expect(state.activeConfig).toMatchObject({
      serviceId: "example-raw-mcp",
      templateId: "external-service.template.raw-mcp-streamable-http",
      binding: {
        outlet: "pact.serviceHub"
      }
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
    expect(state.activeServiceId).toBe("example-raw-mcp");
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
            outlet: "pact.serviceHub",
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
            outlet: "pact.serviceHub"
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
    expect(state.services).toHaveLength(4);

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
    expect(state.services.filter((entry) => entry.serviceId === "saved-service")).toHaveLength(1);

    expect(presetService).toMatchObject({
      source: "preset",
      sourceLabel: "装配预设",
      validationStatus: "valid"
    });
    expect(fallbackService).toMatchObject({
      source: "preset",
      sourceLabel: "装配预设",
      validationStatus: "invalid"
    });
    expect(gatewayService).toMatchObject({
      serviceId: "pact.upstream.cloud-drive",
      sourceLabel: "上游服务切面网关"
    });
    expect(state.externalMcpCache.serviceCount).toBe(1);
    expect(state.templateCatalog).toMatchObject({
      kind: "pact.servicehub.template-catalog",
      defaultPolicyPreset: "servicehub.production-default"
    });
    expect(state.templates.map((template) => template.templateId)).toEqual(expect.arrayContaining([
      "external-service.template.raw-mcp-streamable-http",
      "external-service.template.https-json",
      "external-service.template.json-rpc",
      "external-service.template.sse",
      "external-service.template.openai-model-gateway"
    ]));
  });

  it("normalizes payloads, materializes manifests, and rejects malformed config bodies", async () => {
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
            outlet: "pact.serviceHub",
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
          policyPreset: "servicehub.development-local",
          upstream: {
            type: "mcp",
            transport: "streamable-http",
            url: "http://127.0.0.1:8787/mcp"
          },
          binding: {
            mode: "passthrough",
            outlet: "pact.serviceHub"
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
    expect(normalizedFromObject.materializedManifest).toMatchObject({
      kind: SERVICEHUB_MATERIALIZED_MANIFEST_KIND,
      serviceId: "normalized-service",
      lifecycle: "draftVerified",
      productionReady: false
    });
    expect(normalizedFromObject.materializedManifest.promotion.missingGateIds).toContain("external-call-receipt");

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
      schemaVersion: "v0.0.1:schema:definition-1",
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
          mode: "connected",
          upstream: {
            type: "internal-proprietary-service"
          }
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
    const manifestPath = externalServiceManifestPath({ userDataPath, serviceId: "alpha" });
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    expect(saved.manifestPath).toBe(manifestPath);
    expect(saved.materializedManifest).toMatchObject({
      kind: SERVICEHUB_MATERIALIZED_MANIFEST_KIND,
      serviceId: "alpha",
      lifecycle: "draftVerified",
      productionReady: false
    });
    expect(manifest).toMatchObject({
      serviceId: "alpha",
      manifestFingerprint: expect.any(String),
      promotion: {
        status: "not_promoted"
      }
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
      config: { serviceId: "mcp-service" },
      manifestId: "servicehub.manifest.mcp-service",
      manifestFingerprint: expect.any(String)
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
    expect(saved.materializedManifest).toMatchObject({
      kind: SERVICEHUB_MATERIALIZED_MANIFEST_KIND,
      manifestFingerprint: refreshExternalMcpToolCacheMock.mock.calls[0][0].manifestFingerprint,
      serviceId: "mcp-service",
      lifecycle: "contractVerified",
      productionReady: false
    });
    expect(saved.materializedManifest.evidence.discovery).toMatchObject({
      ok: true,
      status: "verified",
      toolCount: 1
    });
    expect(await fs.access(externalServiceManifestPath({ userDataPath, serviceId: "mcp-service" })).then(() => true)).toBe(true);
    expect(registry.services).toHaveLength(1);
    expect(registry.activeServiceId).toBe("mcp-service");
  });

  it("returns ServiceHub runtime invalidation scopes when saved auth bindings change", async () => {
    const userDataPath = await tempDir("pact-external-service-registry-auth-invalidation-");
    const registryPath = externalServiceRegistryPath(userDataPath);

    await writeJson(registryPath, {
      schemaVersion: "v0.0.1:schema:definition-1",
      kind: EXTERNAL_SERVICE_REGISTRY_KIND,
      activeServiceId: "mcp-service",
      services: [
        buildConnectedService("mcp-service", {
          upstream: {
            type: "mcp",
            transport: "streamable-http",
            url: "https://mcp.example.test:443/mcp",
            auth: {
              type: "bearer",
              secretRef: "secret://servicehub/mcp-service/old-token"
            }
          }
        })
      ]
    });
    discoverExternalMcpToolsMock.mockResolvedValue({
      ok: true,
      serviceId: "mcp-service",
      toolCount: 1,
      tools: [{ name: "echo" }],
      discoveredAt: "2026-06-14T00:00:00.000Z"
    });
    refreshExternalMcpToolCacheMock.mockResolvedValue({
      ok: true,
      serviceId: "mcp-service",
      toolCount: 1,
      tools: [{ name: "echo" }],
      discoveredAt: "2026-06-14T00:00:00.000Z",
      cachePath: path.join(userDataPath, "cache.json")
    });

    const saved = await saveExternalServiceConfig({
      userDataPath,
      payload: {
        config: buildConnectedService("mcp-service", {
          upstream: {
            type: "mcp",
            transport: "streamable-http",
            url: "https://mcp.example.test:443/mcp",
            auth: {
              type: "bearer",
              secretRef: "secret://servicehub/mcp-service/new-token"
            }
          }
        })
      }
    });

    expect(saved).toMatchObject({
      ok: true,
      catalogChange: {
        source: "external-service-registry",
        type: "external_service_config_saved",
        reasonCode: "external_service_config_saved",
        serviceId: "mcp-service",
        invalidation: {
          reasonCode: "external_service_secret_auth_changed",
          serviceId: "mcp-service",
          scopes: expect.arrayContaining([
            "tool-management-catalog",
            "mcp-tools-list",
            "grant-projection",
            "external-service-runtime-cache",
            "external-service-health-state",
            "upstream-session"
          ])
        }
      }
    });
    expect(JSON.stringify(saved.catalogChange)).not.toContain("new-token");
  });

  it("wraps ServiceHub version promotion and rollback with refreshed service state", async () => {
    const userDataPath = await tempDir("pact-external-service-registry-versions-");
    await writeJson(externalServiceRegistryPath(userDataPath), {
      schemaVersion: "v0.0.1:schema:definition-1",
      kind: EXTERNAL_SERVICE_REGISTRY_KIND,
      activeServiceId: "mcp-service",
      services: [buildConnectedService("mcp-service")]
    });
    setDefaultRuntimeMocks({
      services: {
        "mcp-service": {
          serviceId: "mcp-service",
          manifestFingerprint: "manifest-fp",
          activeVersionId: "servicehub.version.mcp.active",
          candidateVersion: {
            versionId: "servicehub.version.mcp.candidate",
            fingerprint: "candidate-fp"
          },
          tools: ["echo"],
          activeTools: ["echo"],
          candidateTools: []
        }
      }
    });
    promoteExternalMcpCandidateVersionMock.mockResolvedValue({
      ok: true,
      serviceId: "mcp-service",
      activeVersion: { versionId: "v0.0.1:strategy:servicehub-version-mcp-active-2" },
      rollbackTargetVersionId: "servicehub.version.mcp.active"
    });
    rollbackExternalMcpVersionMock.mockResolvedValue({
      ok: true,
      serviceId: "mcp-service",
      targetVersionId: "servicehub.version.mcp.active",
      restoredToolNames: ["echo"]
    });

    const promotion = await promoteExternalServiceTools({
      userDataPath,
      serviceId: "mcp-service",
      toolNames: ["echo"],
      promotedBy: "operator-1",
      expectedCandidateVersionId: "servicehub.version.mcp.candidate",
      expectedCandidateFingerprint: "candidate-fp"
    });

    expect(promoteExternalMcpCandidateVersionMock).toHaveBeenCalledWith(expect.objectContaining({
      userDataPath,
      serviceId: "mcp-service",
      toolNames: ["echo"],
      promotedBy: "operator-1",
      expectedCandidateVersionId: "servicehub.version.mcp.candidate",
      expectedCandidateFingerprint: "candidate-fp"
    }));
    expect(promotion).toMatchObject({
      ok: true,
      rollbackTargetVersionId: "servicehub.version.mcp.active",
      catalogChange: {
        reasonCode: "external_service_catalog_promoted",
        serviceId: "mcp-service",
        activeVersionId: "v0.0.1:strategy:servicehub-version-mcp-active-2",
        invalidation: {
          reasonCode: "external_service_catalog_promoted_requires_runtime_reprojection",
          scopes: expect.arrayContaining([
            "external-service-runtime-cache",
            "upstream-session"
          ])
        }
      },
      state: {
        ok: true,
        services: expect.arrayContaining([expect.objectContaining({
          serviceId: "mcp-service",
          externalMcp: expect.objectContaining({
            activeVersionId: "servicehub.version.mcp.active"
          })
        })])
      }
    });

    const rollback = await rollbackExternalServiceTools({
      userDataPath,
      serviceId: "mcp-service",
      targetVersionId: "servicehub.version.mcp.active",
      rolledBackBy: "operator-1",
      reason: "bad_candidate"
    });

    expect(rollbackExternalMcpVersionMock).toHaveBeenCalledWith(expect.objectContaining({
      userDataPath,
      serviceId: "mcp-service",
      targetVersionId: "servicehub.version.mcp.active",
      rolledBackBy: "operator-1",
      reason: "bad_candidate"
    }));
    expect(rollback).toMatchObject({
      ok: true,
      restoredToolNames: ["echo"],
      catalogChange: {
        reasonCode: "external_service_catalog_rolled_back",
        serviceId: "mcp-service",
        invalidation: {
          reasonCode: "rollback_requires_runtime_reprojection",
          scopes: expect.arrayContaining([
            "mcp-tools-list",
            "external-service-runtime-cache",
            "external-service-health-state",
            "upstream-session"
          ])
        }
      },
      state: {
        ok: true
      }
    });
  });

  it("lists typed templates and redacts literal secrets from materialized manifests", async () => {
    const userDataPath = await tempDir("pact-external-service-registry-template-redact-");
    const catalog = listExternalServiceTemplates();
    const httpsTemplate = getExternalServiceTemplate("external-service.template.https-json");
    const minimumFieldExpectations = new Map([
      [
        "external-service.template.raw-mcp-streamable-http",
        {
          fieldModel: ["serviceId", "upstream.url"],
          requiredFields: ["serviceId", "upstream.url"],
          hasTools: false
        }
      ],
      [
        "external-service.template.raw-mcp-sse",
        {
          fieldModel: ["serviceId", "upstream.url"],
          requiredFields: ["serviceId", "upstream.url"],
          hasTools: false
        }
      ],
      [
        "external-service.template.http-json",
        {
          fieldModel: ["serviceId", "upstream.baseUrl", "tools[].name", "tools[].method", "tools[].path"],
          requiredFields: ["serviceId", "upstream.baseUrl", "tools[].name", "tools[].method", "tools[].path"],
          hasTools: true
        }
      ],
      [
        "external-service.template.https-json",
        {
          fieldModel: ["serviceId", "upstream.baseUrl", "tools[].name", "tools[].method", "tools[].path"],
          requiredFields: ["serviceId", "upstream.baseUrl", "tools[].name", "tools[].method", "tools[].path"],
          hasTools: true
        }
      ],
      [
        "external-service.template.json-rpc",
        {
          fieldModel: ["serviceId", "upstream.url", "tools[].name", "tools[].method"],
          requiredFields: ["serviceId", "upstream.url", "tools[].name", "tools[].method|tools[].rpc.method"],
          hasTools: true
        }
      ],
      [
        "external-service.template.sse",
        {
          fieldModel: ["serviceId", "upstream.url", "tools[].name"],
          requiredFields: ["serviceId", "upstream.url", "tools[].name"],
          hasTools: true
        }
      ],
      [
        "external-service.template.openai-model-gateway",
        {
          fieldModel: ["serviceId", "upstream.url"],
          requiredFields: ["serviceId", "upstream.url"],
          hasTools: false
        }
      ]
    ]);

    expect(catalog.templates).toHaveLength(7);
    for (const template of catalog.templates) {
      const expected = minimumFieldExpectations.get(template.templateId);

      expect(expected, `missing template field expectation for ${template.templateId}`).toBeTruthy();
      expect(template.operatorMinimumDraft).not.toHaveProperty("templateId");
      expect(template.operatorMinimumDraft).not.toHaveProperty("schemaVersion");
      expect(template.operatorMinimumDraft).not.toHaveProperty("kind");
      expect(template.operatorMinimumDraft).not.toHaveProperty("serviceName");
      expect(template.operatorMinimumDraft).not.toHaveProperty("displayName");
      expect(template.operatorMinimumDraft).not.toHaveProperty("mode");
      expect(template.operatorMinimumDraft).not.toHaveProperty("startupPolicy");
      expect(template.operatorMinimumDraft).not.toHaveProperty("binding");
      expect(template.operatorMinimumDraft).not.toHaveProperty("policyPreset");
      expect(template.operatorMinimumDraft).not.toHaveProperty("policies");
      expect(template.operatorMinimumDraft).not.toHaveProperty("healthCheck");
      expect(template.operatorMinimumDraft).not.toHaveProperty("metadata");
      expect(template.operatorMinimumDraft.upstream || {}).not.toHaveProperty("type");
      expect(template.operatorMinimumDraft.upstream || {}).not.toHaveProperty("transport");
      expect(template.operatorMinimumDraft.upstream || {}).not.toHaveProperty("eventFormat");
      expect(template.operatorMinimumDraft.upstream || {}).not.toHaveProperty("rpcVersion");
      expect(template.minimumDraft).toHaveProperty("templateId", template.templateId);
      expect(template.minimumDraft.upstream || {}).not.toHaveProperty("type");
      expect(template.fieldModel.minimum.fields.map((field) => field.path)).toEqual(expected.fieldModel);
      expect(template.formContract.requiredFields).toEqual(expected.requiredFields);
      expect(template.formContract.templateSelectedRequiredFields).toEqual(expected.requiredFields);
      expect(template.formContract.directJsonRequiredFields).toEqual(["templateId", ...expected.requiredFields]);
      expect(template.formContract.minimumUsableCombination).toMatchObject({
        mode: "template-selected",
        fields: expected.requiredFields,
        draft: template.operatorMinimumDraft
      });
      expect(template.formContract.directJsonMinimumCombination).toMatchObject({
        mode: "self-describing-json",
        fields: ["templateId", ...expected.requiredFields],
        draft: template.minimumDraft
      });
      expect(template.formContract.fieldCategories).toMatchObject({
        required: expected.requiredFields,
        defaultedByNormalizerFields: expect.arrayContaining(["schemaVersion", "kind", "binding", "policyPreset"]),
        materializedOnlyFields: expect.arrayContaining(["evidence", "promotion", "expandedPolicies"])
      });
      if (expected.hasTools) {
        expect(template.operatorMinimumDraft.tools).toEqual(expect.any(Array));
        expect(template.operatorMinimumDraft.tools.length).toBeGreaterThan(0);
      } else {
        expect(template.operatorMinimumDraft).not.toHaveProperty("tools");
      }
    }
    expect(httpsTemplate.draft).toMatchObject({
      templateId: "external-service.template.https-json",
      serviceId: "https-json-demo",
      upstream: {
        baseUrl: "https://api.example.com:443"
      }
    });
    expect(httpsTemplate.draft.upstream).not.toHaveProperty("type");
    expect(httpsTemplate.operatorMinimumDraft).toMatchObject({
      serviceId: "https-json-demo",
      upstream: {
        baseUrl: "https://api.example.com:443"
      }
    });
    expect(httpsTemplate.operatorMinimumDraft).not.toHaveProperty("templateId");
    expect(getExternalServiceTemplate("external-service.template.raw-mcp-sse").runtimeStatus).toMatchObject({
      state: "production-candidate"
    });
    expect(getExternalServiceTemplate("external-service.template.openai-model-gateway").runtimeStatus).toMatchObject({
      state: "production-candidate"
    });
    expect(getExternalServiceTemplate("external-service.template.openai-model-gateway").draft.upstream).not.toHaveProperty("auth");
    expect(getExternalServiceTemplate("external-service.template.openai-model-gateway").fieldModel.minimum.fields.map((field) => field.path)).toEqual([
      "serviceId",
      "upstream.url"
    ]);
    expect(getExternalServiceTemplate("external-service.template.json-rpc").runtimeStatus).toMatchObject({
      state: "production-candidate"
    });
    expect(getExternalServiceTemplate("external-service.template.json-rpc").fieldModel).toMatchObject({
      protocolFamily: "json-rpc-2.0",
      endpointField: "upstream.url",
      minimum: {
        fields: [
          expect.objectContaining({ path: "serviceId" }),
          expect.objectContaining({ path: "upstream.url" }),
          expect.objectContaining({ path: "tools[].name" }),
          expect.objectContaining({ path: "tools[].method", alternatives: ["tools[].rpc.method"] })
        ]
      },
      optionalGroups: expect.arrayContaining([
        expect.objectContaining({ id: "multi-endpoint", mode: "all-or-none" })
      ])
    });
    expect(getExternalServiceTemplate("external-service.template.sse").fieldModel).toMatchObject({
      protocolFamily: "generic-sse",
      endpointField: "upstream.url",
      minimum: {
        fields: [
          expect.objectContaining({ path: "serviceId" }),
          expect.objectContaining({ path: "upstream.url" }),
          expect.objectContaining({ path: "tools[].name" })
        ]
      },
      optionalGroups: expect.arrayContaining([
        expect.objectContaining({ id: "stream-budget", mode: "any" })
      ])
    });
    expect(httpsTemplate.materializedDraft).toMatchObject({
      templateId: "external-service.template.https-json",
      binding: {
        outlet: "pact.serviceHub"
      }
    });
    expect(httpsTemplate.requiredCombinations).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "https-endpoint", allOf: ["upstream.baseUrl"] }),
      expect.objectContaining({ id: "https-tool-mapping" })
    ]));
    expect(httpsTemplate.requiredCombinations.find((group) => group.id === "https-endpoint")).not.toHaveProperty("oneOf");
    expect(httpsTemplate.defaultedFields).toEqual(expect.arrayContaining([
      "schemaVersion",
      "kind",
      "binding",
      "policyPreset"
    ]));
    expect(httpsTemplate.formContract).toMatchObject({
      schemaVersion: "v0.0.1:schema:definition-1",
      requiredFields: [
        "serviceId",
        "upstream.baseUrl",
        "tools[].name",
        "tools[].method",
        "tools[].path"
      ],
      optionalCombinations: expect.arrayContaining([
        expect.objectContaining({ id: "secret-auth" })
      ]),
      templateSelectedRequiredFields: [
        "serviceId",
        "upstream.baseUrl",
        "tools[].name",
        "tools[].method",
        "tools[].path"
      ],
      directJsonRequiredFields: [
        "templateId",
        "serviceId",
        "upstream.baseUrl",
        "tools[].name",
        "tools[].method",
        "tools[].path"
      ],
      fieldCategories: expect.objectContaining({
        defaultedByTemplateFields: ["upstream.type"],
        optionalCombinations: expect.arrayContaining([
          expect.objectContaining({ id: "secret-auth" }),
          expect.objectContaining({ id: "request-mapping" })
        ])
      }),
      hiddenByDefaultFields: expect.arrayContaining([
        "binding",
        "healthCheck",
        "policyPreset",
        "evidence",
        "promotion"
      ]),
      materializedOnlyFields: expect.arrayContaining([
        "evidence",
        "promotion",
        "expandedPolicies"
      ]),
      fieldModel: expect.objectContaining({
        protocolFamily: "https-json",
        minimum: expect.objectContaining({
          fields: [
            expect.objectContaining({ path: "serviceId" }),
            expect.objectContaining({ path: "upstream.baseUrl" }),
            expect.objectContaining({ path: "tools[].name" }),
            expect.objectContaining({ path: "tools[].method", value: "POST" }),
            expect.objectContaining({ path: "tools[].path" })
          ]
        }),
        optionalGroups: expect.arrayContaining([
          expect.objectContaining({ id: "secret-auth", mode: "all-or-none" }),
          expect.objectContaining({ id: "request-mapping", mode: "any" })
        ])
      })
    });
    expect(getExternalServiceTemplate("external-service.template.json-rpc").formContract.fieldCategories).toMatchObject({
      defaultedByTemplateFields: ["upstream.type", "upstream.rpcVersion"],
      optionalCombinations: expect.arrayContaining([
        expect.objectContaining({ id: "multi-endpoint", allOf: ["upstream.endpoints", "tools[].rpc.endpointRef"] })
      ])
    });
    expect(getExternalServiceTemplate("external-service.template.sse").formContract.fieldCategories).toMatchObject({
      defaultedByTemplateFields: ["upstream.type", "upstream.eventFormat"],
      optionalCombinations: expect.arrayContaining([
        expect.objectContaining({
          id: "event-filter",
          anyOf: ["tools[].sse.eventTypes"]
        }),
        expect.objectContaining({
          id: "stream-budget",
          anyOf: ["tools[].sse.maxEvents", "tools[].sse.maxBytes", "policies.streaming"]
        })
      ])
    });
    expect(httpsTemplate.draft).not.toHaveProperty("binding");
    expect(httpsTemplate.draft).not.toHaveProperty("policyPreset");
    expect(httpsTemplate.draft).not.toHaveProperty("healthCheck");

    const minimumDraftValidation = await verifyExternalServiceConfigPayload({
      payload: {
        config: {
          templateId: "external-service.template.https-json",
          serviceId: "minimum-https-service",
          upstream: {
            baseUrl: "https://api.example.test:443"
          },
          tools: [
            {
              name: "searchItems",
              method: "POST",
              path: "/v1/search"
            }
          ]
        }
      }
    });
    expect(minimumDraftValidation.ok).toBe(true);
    expect(minimumDraftValidation.config.upstream).toMatchObject({
      type: "https",
      baseUrl: "https://api.example.test:443"
    });

    const invalidLiteralCredentials = await verifyExternalServiceConfigPayload({
      payload: {
        config: {
          serviceId: "literal-secret-service",
          upstream: {
            type: "https",
            baseUrl: "https://api.example.test:443",
            auth: {
              type: "bearer",
              token: "literal-token"
            },
            defaultHeaders: {
              Authorization: "Bearer literal-token",
              "X-Custom-Auth": "Bearer literal-token",
              "X-Trace": "ok"
            }
          },
          tools: [
            {
              name: "searchItems",
              method: "POST",
              path: "/v1/search"
            }
          ]
        }
      }
    });
    expect(invalidLiteralCredentials.ok).toBe(false);
    expect(invalidLiteralCredentials.validation.errors).toEqual(expect.arrayContaining([
      "ServiceHub upstream auth must use upstream.auth.secretRef; literal credentials are not allowed.",
      "ServiceHub upstream auth must not contain literal credential field token; use secretRef.",
      "ServiceHub upstream.defaultHeaders must not declare literal sensitive header Authorization; use upstream.auth.secretRef.",
      "ServiceHub upstream.defaultHeaders must not declare literal credential value for header X-Custom-Auth; use upstream.auth.secretRef."
    ]));
    expect(invalidLiteralCredentials.manifestText.includes("literal-token")).toBe(false);

    discoverExternalHttpToolsMock.mockResolvedValue({
      ok: true,
      serviceId: "secret-service",
      toolCount: 1,
      tools: [{ name: "searchItems" }],
      discoveredAt: "2024-02-03T04:05:06.000Z"
    });
    refreshExternalMcpToolCacheMock.mockResolvedValue({
      ok: true,
      serviceId: "secret-service",
      toolCount: 1,
      tools: [{ name: "searchItems" }],
      discoveredAt: "2024-02-03T04:05:06.000Z"
    });

    const saved = await saveExternalServiceConfig({
      userDataPath,
      payload: {
        config: {
          serviceId: "secret-service",
          upstream: {
            type: "https",
            baseUrl: "https://api.example.test:443",
            auth: {
              type: "bearer",
              secretRef: "secret://servicehub/secret-service/api-token"
            },
            defaultHeaders: {
              "X-Trace": "ok"
            }
          },
          tools: [
            {
              name: "searchItems",
              method: "POST",
              path: "/v1/search"
            }
          ]
        }
      }
    });
    const manifestText = await fs.readFile(saved.manifestPath, "utf8");
    const manifest = JSON.parse(manifestText);

    expect(saved.ok).toBe(true);
    expect(manifest.redactedConfig.upstream.auth).toMatchObject({
      type: "bearer",
      secretRef: "secret://servicehub/secret-service/api-token"
    });
    expect(manifest.redactedConfig.upstream.defaultHeaders["X-Trace"]).toBe("ok");
    expect(manifestText.includes("literal-token")).toBe(false);
    expect(manifest.template.formContract.hiddenByDefaultFields).toEqual(expect.arrayContaining([
      "binding",
      "healthCheck",
      "promotion"
    ]));
  });

  it("accepts the self-describing minimum draft for every ServiceHub protocol template", async () => {
    const catalog = listExternalServiceTemplates();
    const expectedUpstreams = new Map([
      [
        "external-service.template.raw-mcp-streamable-http",
        { type: "mcp", transport: "streamable-http", endpointField: "url" }
      ],
      [
        "external-service.template.raw-mcp-sse",
        { type: "mcp", transport: "sse", endpointField: "url" }
      ],
      [
        "external-service.template.http-json",
        { type: "http", endpointField: "baseUrl" }
      ],
      [
        "external-service.template.https-json",
        { type: "https", endpointField: "baseUrl" }
      ],
      [
        "external-service.template.json-rpc",
        { type: "json-rpc", endpointField: "url" }
      ],
      [
        "external-service.template.sse",
        { type: "sse", endpointField: "url" }
      ],
      [
        "external-service.template.openai-model-gateway",
        { type: "llm", endpointField: "url", modelProtocol: "openai-responses" }
      ]
    ]);

    expect(catalog.templates).toHaveLength(expectedUpstreams.size);

    for (const template of catalog.templates) {
      const validation = await verifyExternalServiceConfigPayload({
        payload: {
          config: structuredClone(template.minimumDraft)
        }
      });
      const expected = expectedUpstreams.get(template.templateId);

      expect(validation.ok, `${template.templateId}: ${validation.validation.errors.join("; ")}`).toBe(true);
      expect(validation.config.templateId).toBe(template.templateId);
      expect(validation.config.upstream).toMatchObject({
        type: expected.type
      });
      expect(String(validation.config.upstream?.[expected.endpointField] || "")).toBeTruthy();
      if (expected.transport) {
        expect(validation.config.upstream?.transport).toBe(expected.transport);
      }
      if (expected.modelProtocol) {
        expect(validation.config.upstream?.modelProtocol).toBe(expected.modelProtocol);
      }
    }
  });

  it("rejects ServiceHub protocol drafts that omit any template minimum field", async () => {
    const catalog = listExternalServiceTemplates();

    for (const template of catalog.templates) {
      for (const requiredField of template.formContract.templateSelectedRequiredFields) {
        const draft = structuredClone(template.minimumDraft);
        deleteDraftPath(draft, requiredField);

        const validation = await verifyExternalServiceConfigPayload({
          payload: {
            config: draft
          }
        });

        expect(
          validation.ok,
          `${template.templateId} accepted a draft without ${requiredField}: ${validation.validation.errors.join("; ")}`
        ).toBe(false);
      }
    }
  });

  it("accepts JSON-RPC rpc.method as the minimum method mapping alternative", async () => {
    const template = getExternalServiceTemplate("external-service.template.json-rpc");
    const draft = structuredClone(template.minimumDraft);
    delete draft.tools[0].method;
    draft.tools[0].rpc = {
      method: "ticket.lookup"
    };

    const validation = await verifyExternalServiceConfigPayload({
      payload: {
        config: draft
      }
    });

    expect(validation.ok, validation.validation.errors.join("; ")).toBe(true);
    expect(validation.config.tools[0]).toMatchObject({
      name: "lookupTicket",
      rpc: {
        method: "ticket.lookup"
      }
    });
  });

  it("keeps Generic SSE optional controls on the runtime sse field group", async () => {
    const template = getExternalServiceTemplate("external-service.template.sse");
    const draft = structuredClone(template.minimumDraft);
    draft.tools[0].sse = {
      eventTypes: ["delta"],
      maxEvents: 2,
      maxBytes: 4096
    };

    const validation = await verifyExternalServiceConfigPayload({
      payload: {
        config: draft
      }
    });

    expect(validation.ok, validation.validation.errors.join("; ")).toBe(true);
    expect(validation.config.tools[0]).toMatchObject({
      name: "watchEvents",
      sse: {
        eventTypes: ["delta"],
        maxEvents: 2,
        maxBytes: 4096
      }
    });
    expect(template.formContract.fieldCategories.optionalFields).toEqual(expect.arrayContaining([
      "tools[].sse.eventTypes",
      "tools[].sse.maxEvents",
      "tools[].sse.maxBytes"
    ]));
  });

  it("enforces all-or-none optional combinations for ServiceHub auth and JSON-RPC endpoint refs", async () => {
    const httpsTemplate = getExternalServiceTemplate("external-service.template.https-json");
    const jsonRpcTemplate = getExternalServiceTemplate("external-service.template.json-rpc");
    const missingSecretRef = structuredClone(httpsTemplate.minimumDraft);
    missingSecretRef.upstream.auth = {
      type: "bearer"
    };
    const missingAuthType = structuredClone(httpsTemplate.minimumDraft);
    missingAuthType.upstream.auth = {
      secretRef: "secret://servicehub/https-json/api-key"
    };
    const completeAuth = structuredClone(httpsTemplate.minimumDraft);
    completeAuth.upstream.auth = {
      type: "bearer",
      secretRef: "secret://servicehub/https-json/api-key"
    };
    const missingEndpointMap = structuredClone(jsonRpcTemplate.minimumDraft);
    missingEndpointMap.tools[0].rpc = {
      method: "ticket.lookup",
      endpointRef: "primary"
    };
    delete missingEndpointMap.tools[0].method;
    const completeEndpointRef = structuredClone(jsonRpcTemplate.minimumDraft);
    completeEndpointRef.upstream.endpoints = {
      primary: {
        url: "https://rpc.example.com:443/jsonrpc/primary"
      }
    };
    completeEndpointRef.tools[0].rpc = {
      method: "ticket.lookup",
      endpointRef: "primary"
    };
    delete completeEndpointRef.tools[0].method;

    await expect(verifyExternalServiceConfigPayload({
      payload: { config: missingSecretRef }
    })).resolves.toMatchObject({
      ok: false,
      validation: {
        errors: expect.arrayContaining([
          "ServiceHub upstream auth must use upstream.auth.secretRef; literal credentials are not allowed."
        ])
      }
    });
    await expect(verifyExternalServiceConfigPayload({
      payload: { config: missingAuthType }
    })).resolves.toMatchObject({
      ok: false,
      validation: {
        errors: expect.arrayContaining([
          "ServiceHub upstream auth must declare upstream.auth.type when auth is used."
        ])
      }
    });
    await expect(verifyExternalServiceConfigPayload({
      payload: { config: completeAuth }
    })).resolves.toMatchObject({
      ok: true
    });
    await expect(verifyExternalServiceConfigPayload({
      payload: { config: missingEndpointMap }
    })).resolves.toMatchObject({
      ok: false,
      validation: {
        errors: expect.arrayContaining([
          "External RPC tool ticket.lookup references unknown endpointRef: primary."
        ])
      }
    });
    await expect(verifyExternalServiceConfigPayload({
      payload: { config: completeEndpointRef }
    })).resolves.toMatchObject({
      ok: true
    });
  });

  it("generates production gate evidence and writes it back to the manifest and tool cache", async () => {
    const userDataPath = await tempDir("pact-external-service-production-verify-");
    const serviceId = "production-verify-service";
    setDefaultRuntimeMocks();

    discoverExternalHttpToolsMock.mockResolvedValueOnce({
      ok: true,
      serviceId,
      toolCount: 1,
      tools: [{ name: "searchItems" }],
      discoveredAt: "2026-06-14T00:00:00.000Z"
    });
    refreshExternalMcpToolCacheMock.mockResolvedValueOnce({
      ok: true,
      serviceId,
      toolCount: 1,
      tools: ["searchItems"],
      discoveredAt: "2026-06-14T00:00:00.000Z",
      cachePath: externalMcpToolCachePath(userDataPath)
    });

    const saved = await saveExternalServiceConfig({
      userDataPath,
      payload: {
        config: {
          templateId: "external-service.template.https-json",
          serviceId,
          upstream: {
            baseUrl: "https://api.example.test:443"
          },
          tools: [
            {
              name: "searchItems",
              method: "POST",
              path: "/v1/search",
              inputSchema: {
                type: "object",
                properties: {
                  query: { type: "string", maxLength: 80 }
                },
                required: ["query"],
                additionalProperties: false
              }
            }
          ]
        }
      }
    });
    const candidateVersion = {
      protocolVersion: "v0.0.1:external-service:servicehub-tool-version-1",
      state: "candidate",
      versionId: "servicehub.version.production-verify-service.candidate",
      fingerprint: "candidate-fp-production-verify",
      serviceId,
      manifestId: saved.materializedManifest.manifestId,
      manifestFingerprint: saved.materializedManifest.manifestFingerprint,
      toolCount: 1,
      toolNames: ["searchItems"],
      tombstoneCount: 0,
      createdAt: "2026-06-14T00:00:00.000Z"
    };
    await writeJson(externalMcpToolCachePath(userDataPath), {
      schemaVersion: "v0.0.1:schema:definition-1",
      kind: "pact.external-mcp.tool-cache",
      updatedAt: "2026-06-14T00:00:00.000Z",
      services: {
        [serviceId]: {
          serviceId,
          serviceName: serviceId,
          displayName: serviceId,
          policyPreset: "servicehub.production-default",
          manifestId: saved.materializedManifest.manifestId,
          manifestFingerprint: saved.materializedManifest.manifestFingerprint,
          serviceCatalogVersionId: "",
          activeVersionId: "",
          candidateVersion,
          productionGates: saved.materializedManifest.evidence.productionGates,
          tools: [
            {
              name: "searchItems",
              inputSchema: {
                type: "object",
                properties: {
                  query: { type: "string", maxLength: 80 }
                },
                required: ["query"],
                additionalProperties: false
              },
              adoption: {
                state: "candidate",
                fingerprint: "tool-fp-searchItems"
              }
            }
          ],
          toolCount: 1,
          activeToolCount: 0,
          candidateToolCount: 1
        }
      }
    });

    const verified = await verifyExternalServiceProductionGates({
      userDataPath,
      serviceId,
      expectedCandidateVersionId: candidateVersion.versionId,
      expectedCandidateFingerprint: candidateVersion.fingerprint,
      verifiedBy: "operator-1"
    });
    const manifest = JSON.parse(await fs.readFile(externalServiceManifestPath({ userDataPath, serviceId }), "utf8"));
    const cache = JSON.parse(await fs.readFile(externalMcpToolCachePath(userDataPath), "utf8"));
    const cacheService = cache.services[serviceId];

    expect(saved.ok).toBe(true);
    expect(verified).toMatchObject({
      ok: true,
      serviceId,
      verificationMode: "local-contract",
      candidateVersionId: candidateVersion.versionId,
      candidateFingerprint: candidateVersion.fingerprint,
      gateCount: saved.materializedManifest.evidence.productionGates.length,
      catalogChange: {
        reasonCode: "external_service_production_verified",
        serviceId,
        invalidation: {
          reasonCode: "production_verification_requires_runtime_reprojection",
          scopes: expect.arrayContaining([
            "external-service-runtime-cache",
            "upstream-session"
          ])
        }
      }
    });
    expect(verified.productionGateEvidence.gates.every((gate) => gate.status === "passed")).toBe(true);
    expect(verified.productionGateEvidence.gates.every((gate) => gate.evidenceRef && gate.evidenceDigest && gate.recordDigest)).toBe(true);
    expect(manifest).toMatchObject({
      lifecycle: "productionVerified",
      productionReady: true,
      promotion: {
        status: "ready_for_promotion",
        missingGateIds: [],
        candidateVersionId: candidateVersion.versionId,
        candidateFingerprint: candidateVersion.fingerprint
      }
    });
    expect(manifest.evidence.productionGates).toHaveLength(saved.materializedManifest.evidence.productionGates.length);
    expect(manifest.evidence.productionGates.every((gate) => gate.status === "passed")).toBe(true);
    expect(cacheService.productionEvidenceCandidateFingerprint).toBe(candidateVersion.fingerprint);
    expect(cacheService.productionGates.every((gate) => gate.manifestFingerprint === saved.materializedManifest.manifestFingerprint)).toBe(true);
    expect(cacheService.productionGates.every((gate) => gate.candidateFingerprint === candidateVersion.fingerprint)).toBe(true);
  });

  it("returns discovery and refresh failures without activating candidate services", async () => {
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
    await expect(fs.access(discoveryFailureRegistry)).rejects.toMatchObject({
      code: "ENOENT"
    });

    expect(discoveryFailed.ok).toBe(false);
    expect(discoveryFailed.error).toBe("openapi discovery failed");
    expect(discoveryFailed.externalToolDiscovery).toMatchObject({
      ok: false,
      error: "openapi discovery failed"
    });
    expect(discoveryFailed.activeServiceId).toBe("");

    expect(refreshFailed.ok).toBe(false);
    expect(refreshFailed.error).toBe("refresh failed");
    expect(refreshFailed.externalToolDiscovery).toMatchObject({
      ok: false,
      error: "refresh failed"
    });
    expect(refreshFailed.activeServiceId).toBe("");
    await expect(fs.access(refreshFailureRegistry)).rejects.toMatchObject({
      code: "ENOENT"
    });
    expect(refreshFailed.materializedManifest).toMatchObject({
      serviceId: "refresh-failure",
      lifecycle: "draftVerified",
      productionReady: false,
      evidence: {
        discovery: {
          ok: false,
          status: "failed",
          error: "refresh failed"
        }
      }
    });
    expect(await fs.access(refreshFailed.manifestPath).then(() => true)).toBe(true);
  });

  it("refreshes, skips, and fails registry entries while honoring a requested service filter", async () => {
    const userDataPath = await tempDir("pact-external-service-registry-refresh-");
    const cwd = await tempDir("pact-external-service-registry-refresh-cwd-");
    const registryPath = externalServiceRegistryPath(userDataPath);

    await writeJson(registryPath, {
      schemaVersion: "v0.0.1:schema:definition-1",
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
      cwd,
      serviceId: "tool-service"
    });
    const fullRefresh = await refreshExternalServiceRuntime({ userDataPath, cwd });

    expect(filtered.ok).toBe(true);
    expect(filtered.requestedServiceId).toBe("tool-service");
    expect(filtered.catalogChange).toMatchObject({
      reasonCode: "external_service_catalog_refreshed",
      serviceId: "tool-service",
      invalidation: {
        reasonCode: "external_service_runtime_refreshed",
        scopes: expect.arrayContaining([
          "external-service-runtime-cache",
          "upstream-session"
        ])
      }
    });
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
    expect(fullRefresh.failedCount).toBe(2);
    expect(fullRefresh.skippedCount).toBe(0);
    expect(fullRefresh.results.find((item) => item.serviceId === "skipped-service")).toMatchObject({
      status: "failed",
      error: "External service config is missing upstream."
    });
    expect(fullRefresh.results.find((item) => item.serviceId === "invalid-service")).toMatchObject({
      status: "failed",
      error: "External OpenAPI upstream requires upstream.baseUrl or upstream.url."
    });
    expect(fullRefresh.state.registryPath).toBe(registryPath);
    expect(fullRefresh.state.activeServiceId).toBe("tool-service");
  });

  it("records health check redirect Location decisions without following redirects", async () => {
    const userDataPath = await tempDir("pact-external-service-registry-health-");
    const cwd = await tempDir("pact-external-service-registry-health-cwd-");
    await writeJson(externalServiceRegistryPath(userDataPath), {
      schemaVersion: "v0.0.1:schema:definition-1",
      kind: EXTERNAL_SERVICE_REGISTRY_KIND,
      activeServiceId: "health-service",
      updatedAt: "2024-02-03T04:05:06.000Z",
      services: [
        buildConnectedService("health-service", {
          policyPreset: "servicehub.production-default",
          upstream: {
            type: "mcp",
            transport: "streamable-http",
            url: "https://93.184.216.34:443/mcp"
          }
        })
      ].map((service) => ({
        ...service,
        healthCheck: {
          type: "http",
          url: "https://93.184.216.34:443/health",
          required: true
        }
      }))
    });

    setDefaultRuntimeMocks();
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock.mockResolvedValueOnce(createResponse({
      ok: false,
      status: 302,
      headers: {
        location: "http://127.0.0.1:8080/internal"
      }
    }));

    try {
      const result = await inspectExternalServiceHealth({ userDataPath, cwd, serviceId: "health-service" });

      expect(result).toMatchObject({
        ok: false,
        checkedCount: 1,
        results: [{
          serviceId: "health-service",
          status: "unhealthy",
          httpStatus: 302,
          redirectDecision: {
            ok: false,
            reason: "restricted_address_loopback",
            targetUrl: "http://127.0.0.1:8080/internal"
          }
        }]
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][1]).toMatchObject({
        redirect: "manual"
      });
    } finally {
      fetchMock.mockRestore();
    }
  });
});
