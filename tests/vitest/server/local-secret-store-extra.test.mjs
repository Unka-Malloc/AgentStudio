import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest";

import {
  LOCAL_SECRET_STORE_VERSION,
  LOCAL_SECRET_TARGETS,
  defaultEndpointRefForProvider,
  defaultSecretRefForProvider,
  initializeLocalSecret,
  localSecretConfigured,
  localSecretStorePaths,
  listLocalSecretEntries,
  normalizeLocalSecretProvider,
  readLocalSecretRegistry,
  revokeLocalSecret,
  resolveLocalSecretPayload,
  resolveLocalSecretTarget,
  rotateLocalSecret
} from "../../../server/platform/common/security/secrets/local-secret-store.mjs";

const tempRoots = [];
const originalEnv = {};

async function createTempDir(prefix = "pact-local-secret-test-") {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

function snapshot() {
  const original = process.env.PACT_SERVER_DATA_DIR;
  return {
    dataDir: original,
    restore: () => {
      if (original === undefined) {
        delete process.env.PACT_SERVER_DATA_DIR;
        return;
      }
      process.env.PACT_SERVER_DATA_DIR = original;
    }
  };
}

function valueFileName(secretRef) {
  const hash = crypto.createHash("sha256").update(String(secretRef)).digest("hex");
  return `${hash.slice(0, 40)}.json`;
}

beforeEach(() => {
  originalEnv.PACT_SERVER_DATA_DIR = process.env.PACT_SERVER_DATA_DIR;
});

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))
  );
  vi.useRealTimers();
  if (originalEnv.PACT_SERVER_DATA_DIR === undefined) {
    delete process.env.PACT_SERVER_DATA_DIR;
  } else {
    process.env.PACT_SERVER_DATA_DIR = originalEnv.PACT_SERVER_DATA_DIR;
  }
});

describe("provider resolution and defaults", () => {
  it("normalizes aliases and resolves defaults", () => {
    expect(normalizeLocalSecretProvider(" GH ")).toBe("github");
    expect(normalizeLocalSecretProvider("one_drive")).toBe("onedrive");
    expect(normalizeLocalSecretProvider("not-known-provider")).toBe("not-known-provider");
    expect(resolveLocalSecretTarget("GH")).toMatchObject({ provider: "github", family: "codespace" });
    expect(resolveLocalSecretTarget("not-known-provider")).toBe(null);

    expect(defaultSecretRefForProvider("gerrit")).toBe("secret://pact/codespace/gerrit-service-account");
    expect(defaultEndpointRefForProvider("dify")).toBe("config://pact/knowledge/dify-endpoint");
    expect(defaultSecretRefForProvider("unknown")).toBe("");
    expect(defaultEndpointRefForProvider("unknown")).toBe("");
  });

  it("builds localSecretStorePaths with stable value filenames", () => {
    const secretRef = "secret://pact/knowledge/dify-api-key";
    const paths = localSecretStorePaths({ dataDir: "/tmp/custom-root", secretRef });
    expect(paths.root).toBe(path.join(path.resolve("/tmp/custom-root"), "secrets"));
    expect(paths.registryPath).toBe(path.join(paths.root, "registry.json"));
    expect(paths.auditPath).toBe(path.join(paths.root, "audit.jsonl"));
    expect(paths.valuesDir).toBe(path.join(paths.root, "values"));
    expect(paths.valuePath).toBe(path.join(paths.valuesDir, valueFileName(secretRef)));
    expect(paths.configRefsPath).toBe(path.join(path.resolve("/tmp/custom-root"), "config", "refs.json"));
    expect(localSecretStorePaths({ dataDir: "/tmp/custom-root" }).valuePath).toBe("");
  });
});

describe("initialization and manifest branches", () => {
  it("writes a codespace secret, audit log, manifest and config refs", async () => {
    const dataDir = await createTempDir("pact-secret-codespace-");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-04T00:00:00.000Z"));

    const result = await initializeLocalSecret({
      dataDir,
      provider: "GERRIT",
      payload: {
        httpPassword: "pa55",
        refresh: "abc",
        oauth: { token: "hidden" }
      },
      endpointRef: "",
      endpoint: "https://gerrit.internal.invalid",
      mode: "live",
      metadata: { workspaceId: "repo-01" }
    });

    expect(result.ok).toBe(true);
    expect(result.protocolVersion).toBe(LOCAL_SECRET_STORE_VERSION);
    expect(result.family).toBe("codespace");
    expect(result.manifestUpdate).toMatchObject({
      kind: "codespace-provider-manifest",
      provider: "gerrit",
      path: path.join(dataDir, "code-management", "codespace-providers.json"),
      endpointRef: "config://pact/codespace/gerrit-endpoint"
    });
    expect(result.entry.secretRef).toBe("secret://pact/codespace/gerrit-service-account");
    expect(result.entry.redacted).toEqual({
      httpPassword: "****",
      refresh: "****",
      oauth: "[redacted-object]"
    });
    expect(result.entry.storageRef).toBe(`local:${valueFileName(result.entry.secretRef)}`);
    expect(result.entry.createdAt).toBe("2026-06-04T00:00:00.000Z");
    expect(result.entry.updatedAt).toBe("2026-06-04T00:00:00.000Z");

    const registry = await readLocalSecretRegistry({ dataDir });
    expect(registry.schemaVersion).toBe(1);
    expect(registry.refs[result.entry.secretRef]).toMatchObject({
      provider: "gerrit",
      family: "codespace",
      endpointRef: "config://pact/codespace/gerrit-endpoint",
      storageRef: result.entry.storageRef
    });

    const codespaceManifest = await readJson(path.join(dataDir, "code-management", "codespace-providers.json"));
    expect(codespaceManifest.providers.gerrit).toMatchObject({
      provider: "gerrit",
      enabled: true,
      mode: "live",
      authType: "serviceAccount",
      endpointRef: "config://pact/codespace/gerrit-endpoint",
      credentialConfigured: true
    });

    const configRefs = await readJson(path.join(dataDir, "config", "refs.json"));
    expect(configRefs.refs["config://pact/codespace/gerrit-endpoint"]).toMatchObject({
      provider: "gerrit",
      kind: "endpoint",
      value: "https://gerrit.internal.invalid"
    });

    const manifestAudit = await fs.readFile(result.auditPath, "utf8");
    const auditEntries = manifestAudit.trim().split("\n").map((line) => JSON.parse(line));
    expect(auditEntries).toEqual([
      {
        event: "secret.initialized",
        secretRef: result.entry.secretRef,
        provider: "gerrit",
        family: "codespace",
        mode: "live",
        authType: "serviceAccount",
        valueKeys: ["httpPassword", "oauth", "refresh"],
        previousRevision: 0,
        revision: 1,
        status: "active",
        manifestUpdated: true,
        createdAt: "2026-06-04T00:00:00.000Z"
      }
    ]);

    expect(await localSecretConfigured({ dataDir, provider: "gerrit" })).toBe(true);
    expect(await localSecretConfigured({ dataDir, provider: "dify" })).toBe(false);
  });

  it("writes a knowledge secret and redacts short and long payload values", async () => {
    const dataDir = await createTempDir("pact-secret-knowledge-");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-04T10:00:00.000Z"));

    const result = await initializeLocalSecret({
      dataDir,
      provider: "ragflow",
      payload: {
        apiKey: "abc",
        longValue: "knowledge-secret-value"
      },
      endpoint: "https://ragflow.internal.invalid"
    });

    expect(result.family).toBe("knowledge");
    expect(result.manifestUpdate).toMatchObject({
      kind: "knowledge-backend-manifest",
      provider: "ragflow",
      path: path.join(dataDir, "knowledge", "knowledge-backends.json")
    });
    expect(result.entry.redacted).toEqual({
      apiKey: "****",
      longValue: "***alue"
    });

    const knowledgeManifest = await readJson(path.join(dataDir, "knowledge", "knowledge-backends.json"));
    expect(knowledgeManifest.providers.ragflow.secretRef).toBe("secret://pact/knowledge/ragflow-api-key");
    expect(knowledgeManifest.providers.ragflow.endpointRef).toBe("config://pact/knowledge/ragflow-endpoint");
    expect(knowledgeManifest.providers.ragflow.credentialConfigured).toBe(true);

    const configRefs = await readJson(path.join(dataDir, "config", "refs.json"));
    expect(configRefs.refs["config://pact/knowledge/ragflow-endpoint"]).toMatchObject({
      provider: "ragflow",
      value: "https://ragflow.internal.invalid"
    });
  });

  it("writes an oauth cloud-drive secret and stores cloud-drive manifest metadata", async () => {
    const dataDir = await createTempDir("pact-secret-cloud-");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-04T10:30:00.000Z"));

    const result = await initializeLocalSecret({
      dataDir,
      provider: "onedrive",
      payload: {
        oauth: JSON.stringify({ refreshToken: "refresh-token", clientId: "client-id" })
      },
      endpoint: "https://onedrive.internal.invalid",
      mode: "contract",
      metadata: {
        workspaceId: "ws-42",
        driveRef: "contract-drive",
        label: "Pact Workspace"
      }
    });

    expect(result.family).toBe("cloud-drive");
    expect(result.manifestUpdate).toMatchObject({
      kind: "cloud-drive-connections",
      provider: "onedrive",
      path: path.join(dataDir, "agent-workspaces", "cloud-drive-connections.json"),
      driveRef: "contract-drive",
      endpointRef: "config://pact/drive/onedrive-endpoint"
    });

    const cloudManifest = await readJson(path.join(dataDir, "agent-workspaces", "cloud-drive-connections.json"));
    expect(cloudManifest.connections["contract-drive"]).toMatchObject({
      provider: "onedrive",
      workspaceId: "ws-42",
      label: "Pact Workspace",
      mode: "contract",
      requestedMode: "contract",
      authType: "oauth2",
      status: "active",
      credentialConfigured: true,
      contractVerified: true,
      localAdapterVerified: false
    });

    const configRefs = await readJson(path.join(dataDir, "config", "refs.json"));
    expect(configRefs.refs["config://pact/drive/onedrive-endpoint"]).toMatchObject({
      provider: "onedrive",
      kind: "endpoint",
      value: "https://onedrive.internal.invalid"
    });
  });

  it("updates cloud-drive manifest even when endpoint is missing and falls back endpointRef", async () => {
    const dataDir = await createTempDir("pact-secret-cloud-no-endpoint-");

    const result = await initializeLocalSecret({
      dataDir,
      provider: "google-drive",
      payload: { oauth: "oauth-json" },
      endpoint: ""
    });

    expect(result.manifestUpdate).toMatchObject({
      kind: "cloud-drive-connections",
      provider: "google-drive",
      endpointRef: "config://pact/drive/google-drive-endpoint"
    });

    const configRefPath = path.join(dataDir, "config", "refs.json");
    await expect(fs.access(configRefPath)).rejects.toThrow();
  });

  it("updates an existing secret as `secret.updated` while preserving createdAt", async () => {
    const dataDir = await createTempDir("pact-secret-update-");
    vi.useFakeTimers();
    const createdAt = new Date("2026-06-04T11:00:00.000Z");
    const updatedAt = new Date("2026-06-04T11:30:00.000Z");

    vi.setSystemTime(createdAt);
    await initializeLocalSecret({
      dataDir,
      provider: "dify",
      payload: { apiKey: "first-key" },
      endpoint: "https://dify.internal.invalid/v1"
    });
    vi.setSystemTime(updatedAt);
    const result = await initializeLocalSecret({
      dataDir,
      provider: "dify",
      secretRef: defaultSecretRefForProvider("dify"),
      payload: { apiKey: "second-key" },
      endpoint: "https://dify.internal.invalid/v2"
    });

    const registry = await readLocalSecretRegistry({ dataDir });
    const entry = registry.refs[defaultSecretRefForProvider("dify")];
    expect(entry.createdAt).toBe(createdAt.toISOString());
    expect(entry.updatedAt).toBe(updatedAt.toISOString());
    expect(entry.revision).toBe(2);
    expect(entry.rotatedAt).toBe(updatedAt.toISOString());
    expect(entry.status).toBe("active");
    expect(result.entry.valueKeys).toEqual(["apiKey"]);
    expect(result.entry.valueKeys).toEqual(entry.valueKeys);

    const audit = (await fs.readFile(result.auditPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    expect(audit.map((item) => item.event)).toEqual(["secret.initialized", "secret.updated"]);
    expect(audit[1]).toMatchObject({
      event: "secret.updated",
      valueKeys: ["apiKey"],
      secretRef: defaultSecretRefForProvider("dify"),
      previousRevision: 1,
      revision: 2,
      rotatedAt: updatedAt.toISOString(),
      status: "active",
      createdAt: updatedAt.toISOString()
    });
  });

  it("uses contract mode fallback when target default mode is blank", async () => {
    const dataDir = await createTempDir("pact-secret-default-mode-");
    const target = LOCAL_SECRET_TARGETS.dify;
    const originalMode = target.defaultMode;

    try {
      target.defaultMode = "";
      const result = await initializeLocalSecret({
        dataDir,
        provider: "dify",
        payload: { apiKey: "x" },
        mode: "",
        endpoint: "https://dify.example.invalid"
      });
      expect(result.mode).toBe("contract");
    } finally {
      target.defaultMode = originalMode;
    }
  });
});

describe("query APIs and validation errors", () => {
  it("reads empty registry/list from missing files", async () => {
    const dataDir = await createTempDir("pact-secret-empty-");
    const registry = await readLocalSecretRegistry({ dataDir });
    const entries = await listLocalSecretEntries({ dataDir });

    expect(registry.schemaVersion).toBe(1);
    expect(registry.refs).toEqual({});
    expect(entries).toEqual([]);
  });

  it("covers readJson parse failure on invalid registry payload", async () => {
    const dataDir = await createTempDir("pact-secret-corrupt-");
    const root = path.join(dataDir, "secrets");
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(path.join(root, "registry.json"), "{bad", "utf8");

    await expect(readLocalSecretRegistry({ dataDir })).rejects.toThrow();
  });

  it("uses fake env dataDir when dataDir is omitted", async () => {
    const envRestore = snapshot();
    const envDataDir = await createTempDir("pact-secret-env-");
    process.env.PACT_SERVER_DATA_DIR = envDataDir;

    const result = await initializeLocalSecret({
      provider: "google-drive",
      payload: {
        oauth: "oauth-json"
      },
      endpoint: "https://google-drive.internal.invalid"
    });
    envRestore.restore();

    expect(result.dataDir).toBe(envDataDir);
    const entries = await listLocalSecretEntries({ dataDir: envDataDir });
    expect(entries.some((entry) => entry.secretRef === result.secretRef)).toBe(true);
  });

  it("skips config-ref writes when endpoint is missing", async () => {
    const dataDir = await createTempDir("pact-secret-no-endpoint-");

    const result = await initializeLocalSecret({
      dataDir,
      provider: "dify",
      payload: { apiKey: "test-key-no-endpoint" },
      endpoint: ""
    });

    const configRefPath = path.join(dataDir, "config", "refs.json");
    await expect(fs.access(configRefPath)).rejects.toThrow();
    expect(result.entry.endpointRef).toBe("config://pact/knowledge/dify-endpoint");
  });

  it("can initialize without writing manifest or config refs", async () => {
    const dataDir = await createTempDir("pact-secret-no-manifest-");

    const result = await initializeLocalSecret({
      dataDir,
      provider: "github",
      payload: { token: "manifest-disabled" },
      endpoint: "https://github.example.invalid",
      updateManifest: false
    });

    expect(result.manifestUpdate).toBe(null);
    await expect(readLocalSecretRegistry({ dataDir })).resolves.toMatchObject({
      refs: {
        [result.secretRef]: {
          provider: "github",
          family: "codespace"
        }
      }
    });
  });

  it("returns null manifest update when target family is unknown", async () => {
    const dataDir = await createTempDir("pact-secret-unknown-family-");
    const target = LOCAL_SECRET_TARGETS.gerrit;
    const originalFamily = target.family;

    try {
      target.family = "mystery";
      const result = await initializeLocalSecret({
        dataDir,
        provider: "gerrit",
        payload: { httpPassword: "no-manifest" }
      });
      expect(result.manifestUpdate).toBe(null);
    } finally {
      target.family = originalFamily;
    }
  });

  it("lists and sorts entries by provider for multiple providers", async () => {
    const dataDir = await createTempDir("pact-secret-sort-");

    await initializeLocalSecret({
      dataDir,
      provider: "gerrit",
      payload: { httpPassword: "one" },
      endpoint: "https://gerrit.example.invalid"
    });
    await initializeLocalSecret({
      dataDir,
      provider: "dify",
      payload: { apiKey: "two" },
      endpoint: "https://dify.example.invalid"
    });
    await initializeLocalSecret({
      dataDir,
      provider: "onedrive",
      payload: { oauth: "three" },
      endpoint: "https://onedrive.example.invalid"
    });

    const entries = await listLocalSecretEntries({ dataDir });
    expect(entries.map((entry) => entry.provider)).toEqual(["dify", "gerrit", "onedrive"]);
  });

  it("uses secretRef filter and provider fallback when listing malformed refs", async () => {
    const dataDir = await createTempDir("pact-secret-filter-fallback-");
    const registryPath = path.join(dataDir, "secrets", "registry.json");
    await fs.mkdir(path.dirname(registryPath), { recursive: true });
    await fs.writeFile(
      registryPath,
      JSON.stringify({
        schemaVersion: "v0.0.1:schema:definition-1",
        protocolVersion: LOCAL_SECRET_STORE_VERSION,
        updatedAt: "2026-06-04T00:00:00.000Z",
        refs: {
          "secret://fallback": {
            secretRef: "secret://fallback",
            valueKeys: ["token"],
            redacted: { token: "****" },
            credentialConfigured: true
          },
          "secret://known-provider": {
            secretRef: "secret://known-provider",
            provider: "github",
            valueKeys: ["token"],
            redacted: { token: "****" },
            credentialConfigured: true
          }
        }
      }),
      "utf8"
    );

    expect(await localSecretConfigured({
      dataDir,
      secretRef: "secret://fallback"
    })).toBe(true);

    const entries = await listLocalSecretEntries({ dataDir });
    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.provider || entry.secretRef)).toEqual(["github", "secret://fallback"]);
  });

  it("returns cloud-drive manifest without endpointRef when target endpointRef is temporarily cleared", async () => {
    const dataDir = await createTempDir("pact-secret-cloud-empty-endpoint-ref-");
    const target = LOCAL_SECRET_TARGETS.dropbox;
    const originalEndpointRef = target.endpointRef;

    try {
      target.endpointRef = "";
      const result = await initializeLocalSecret({
        dataDir,
        provider: "dropbox",
        payload: { oauth: "token" },
        endpoint: ""
      });

      expect(result.manifestUpdate.endpointRef).toBe("");
    } finally {
      target.endpointRef = originalEndpointRef;
    }
  });

  it("resolves ServiceHub secret payloads from local storage without exposing values in registry", async () => {
    const dataDir = await createTempDir("pact-secret-servicehub-");
    const secretRef = "secret://servicehub/external-http/api-token";

    const result = await initializeLocalSecret({
      dataDir,
      provider: "servicehub",
      secretRef,
      payload: {
        token: "servicehub-secret-token"
      },
      updateManifest: false
    });

    expect(result.provider).toBe("servicehub");
    expect(result.family).toBe("servicehub");
    expect(result.manifestUpdate).toBe(null);

    const registry = await readLocalSecretRegistry({ dataDir });
    expect(JSON.stringify(registry)).not.toContain("servicehub-secret-token");
    expect(registry.refs[secretRef]).toMatchObject({
      provider: "servicehub",
      family: "servicehub",
      credentialConfigured: true,
      valueKeys: ["token"],
      redacted: {
        token: "***oken"
      }
    });

    await expect(resolveLocalSecretPayload({ dataDir, secretRef })).resolves.toMatchObject({
      secretRef,
      provider: "servicehub",
      family: "servicehub",
      authType: "bearer",
      payload: {
        token: "servicehub-secret-token"
      }
    });
    await expect(resolveLocalSecretPayload({
      dataDir,
      secretRef: "secret://servicehub/missing"
    })).rejects.toMatchObject({
      code: "local_secret_not_configured"
    });
  });

  it("rotates ServiceHub secrets with revision, rotatedAt and scoped registry metadata", async () => {
    const dataDir = await createTempDir("pact-secret-servicehub-rotate-");
    const secretRef = "secret://servicehub/weather/api-token";
    vi.useFakeTimers();
    const createdAt = new Date("2026-06-05T08:00:00.000Z");
    const rotatedAt = new Date("2026-06-05T09:00:00.000Z");

    vi.setSystemTime(createdAt);
    await initializeLocalSecret({
      dataDir,
      provider: "servicehub",
      secretRef,
      payload: { token: "first-servicehub-token" },
      metadata: {
        scope: {
          serviceId: "weather-api",
          tenantId: "tenant-a",
          workspaceId: "workspace-a",
          allowedHosts: ["api.weather.example.invalid"],
          allowedProtocols: ["https"],
          scopes: ["forecast.read"]
        },
        token: "metadata-token-must-not-enter-registry"
      },
      updateManifest: false
    });

    vi.setSystemTime(rotatedAt);
    const rotated = await rotateLocalSecret({
      dataDir,
      provider: "servicehub",
      secretRef,
      payload: { token: "second-servicehub-token" },
      expectedRevision: 1,
      metadata: {
        scope: {
          serviceId: "weather-api",
          tenantId: "tenant-a",
          workspaceId: "workspace-a",
          allowedHosts: ["api.weather.example.invalid"],
          allowedProtocols: ["https"],
          scopes: ["forecast.current.read"]
        },
        token: "rotated-metadata-token-must-not-enter-registry"
      },
      updateManifest: false
    });

    expect(rotated).toMatchObject({
      provider: "servicehub",
      family: "servicehub",
      status: "active",
      revision: 2,
      rotatedAt: rotatedAt.toISOString(),
      catalogChange: {
        source: "secret-store",
        type: "external_service_secret_rotated",
        reasonCode: "external_service_secret_rotated",
        serviceId: "weather-api",
        invalidation: {
          reasonCode: "external_service_secret_rotated",
          serviceId: "weather-api",
          scopes: expect.arrayContaining([
            "tool-management-catalog",
            "mcp-tools-list",
            "external-service-runtime-cache",
            "upstream-session"
          ])
        }
      }
    });
    expect(rotated.catalogChange.secretRefFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(rotated.catalogChange)).not.toContain(secretRef);
    expect(JSON.stringify(rotated.catalogChange)).not.toContain("second-servicehub-token");
    expect(rotated.entry).toMatchObject({
      credentialConfigured: true,
      status: "active",
      revision: 2,
      rotatedAt: rotatedAt.toISOString(),
      metadata: {
        scope: {
          serviceId: "weather-api",
          tenantId: "tenant-a",
          workspaceId: "workspace-a",
          allowedHosts: ["api.weather.example.invalid"],
          allowedProtocols: ["https"],
          scopes: ["forecast.current.read"]
        }
      }
    });

    const registry = await readLocalSecretRegistry({ dataDir });
    expect(JSON.stringify(registry)).not.toContain("first-servicehub-token");
    expect(JSON.stringify(registry)).not.toContain("second-servicehub-token");
    expect(JSON.stringify(registry)).not.toContain("metadata-token-must-not-enter-registry");
    expect(JSON.stringify(registry)).not.toContain("rotated-metadata-token-must-not-enter-registry");
    expect(registry.refs[secretRef]).toMatchObject(rotated.entry);

	    await expect(resolveLocalSecretPayload({ dataDir, secretRef })).resolves.toMatchObject({
	      status: "active",
	      revision: 2,
	      metadata: {
	        scope: {
          serviceId: "weather-api",
          tenantId: "tenant-a",
          workspaceId: "workspace-a",
          allowedHosts: ["api.weather.example.invalid"],
          allowedProtocols: ["https"],
          scopes: ["forecast.current.read"]
        }
	      },
	      payload: { token: "second-servicehub-token" }
	    });
	    await expect(resolveLocalSecretPayload({
	      dataDir,
	      secretRef,
	      expectedScope: {
	        serviceId: "weather-api",
	        tenantId: "tenant-a",
	        workspaceId: "workspace-a",
	        host: "api.weather.example.invalid",
	        protocol: "https",
	        scopes: ["forecast.current.read"]
	      }
	    })).resolves.toMatchObject({
	      revision: 2,
	      payload: { token: "second-servicehub-token" }
	    });
	    await expect(resolveLocalSecretPayload({
	      dataDir,
	      secretRef,
	      expectedScope: {
	        serviceId: "other-api",
	        host: "api.weather.example.invalid",
	        protocol: "https"
	      }
	    })).rejects.toMatchObject({
	      code: "local_secret_scope_denied",
	      reasonCode: "service_id_mismatch"
	    });
	    await expect(resolveLocalSecretPayload({
	      dataDir,
	      secretRef,
	      expectedScope: {
	        serviceId: "weather-api",
	        host: "evil.example.invalid",
	        protocol: "https"
	      }
	    })).rejects.toMatchObject({
	      code: "local_secret_scope_denied",
	      reasonCode: "host_not_allowed"
	    });
	    await expect(resolveLocalSecretPayload({
	      dataDir,
	      secretRef,
	      expectedScope: {
	        serviceId: "weather-api",
	        host: "api.weather.example.invalid",
	        protocol: "https",
	        scopes: ["forecast.write"]
	      }
	    })).rejects.toMatchObject({
	      code: "local_secret_scope_denied",
	      reasonCode: "scope_not_allowed"
	    });
	    await expect(rotateLocalSecret({
	      dataDir,
	      provider: "servicehub",
      secretRef,
      payload: { token: "stale-servicehub-token" },
      expectedRevision: 1,
      updateManifest: false
    })).rejects.toMatchObject({
      code: "local_secret_revision_conflict",
      expectedRevision: 1,
      actualRevision: 2
    });
    await expect(resolveLocalSecretPayload({ dataDir, secretRef })).resolves.toMatchObject({
      revision: 2,
      payload: { token: "second-servicehub-token" }
    });

    const audit = (await fs.readFile(rotated.auditPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    expect(audit.map((item) => item.event)).toEqual(["secret.initialized", "secret.rotated"]);
    expect(audit[1]).toMatchObject({
      event: "secret.rotated",
      secretRef,
      previousRevision: 1,
      revision: 2,
      rotatedAt: rotatedAt.toISOString(),
      status: "active"
    });
  });

  it("revokes ServiceHub secrets fail closed for resolve and configured checks", async () => {
    const dataDir = await createTempDir("pact-secret-servicehub-revoke-");
    const secretRef = "secret://servicehub/revoked/api-token";
    vi.useFakeTimers();
    const createdAt = new Date("2026-06-05T10:00:00.000Z");
    const revokedAt = new Date("2026-06-05T10:15:00.000Z");

    vi.setSystemTime(createdAt);
    const initialized = await initializeLocalSecret({
      dataDir,
      provider: "servicehub",
      secretRef,
      payload: { token: "revoked-servicehub-token" },
      metadata: {
        scope: {
          serviceId: "revoked-api"
        }
      },
      updateManifest: false
    });
    await expect(resolveLocalSecretPayload({ dataDir, secretRef })).resolves.toMatchObject({
      payload: { token: "revoked-servicehub-token" }
    });

    vi.setSystemTime(revokedAt);
    const revoked = await revokeLocalSecret({
      dataDir,
      provider: "servicehub",
      secretRef,
      expectedRevision: 1,
      reason: "operator rotation cleanup"
    });

    expect(revoked).toMatchObject({
      credentialConfigured: false,
      status: "revoked",
      revision: 2,
      revokedAt: revokedAt.toISOString(),
      catalogChange: {
        source: "secret-store",
        type: "external_service_secret_revoked",
        reasonCode: "external_service_secret_revoked",
        serviceId: "revoked-api",
        invalidation: {
          serviceId: "revoked-api",
          scopes: expect.arrayContaining([
            "external-service-runtime-cache",
            "upstream-session"
          ])
        }
      }
    });
    expect(revoked.catalogChange.secretRefFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(revoked.catalogChange)).not.toContain(secretRef);
    expect(JSON.stringify(revoked.catalogChange)).not.toContain("revoked-servicehub-token");
    expect(revoked.entry).toMatchObject({
      credentialConfigured: false,
      status: "revoked",
      revision: 2,
      revokedAt: revokedAt.toISOString()
    });
    expect(await localSecretConfigured({ dataDir, provider: "servicehub", secretRef })).toBe(false);
    await expect(resolveLocalSecretPayload({ dataDir, secretRef })).rejects.toMatchObject({
      code: "local_secret_revoked",
      status: "revoked"
    });
    await expect(fs.access(initialized.valuePath)).rejects.toThrow();

    const registry = await readLocalSecretRegistry({ dataDir });
    expect(JSON.stringify(registry)).not.toContain("revoked-servicehub-token");
    expect(registry.refs[secretRef]).toMatchObject({
      credentialConfigured: false,
      status: "revoked",
      revision: 2,
      revokedAt: revokedAt.toISOString()
    });

    const audit = (await fs.readFile(revoked.auditPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    expect(audit.map((item) => item.event)).toEqual(["secret.initialized", "secret.revoked"]);
    expect(audit[1]).toMatchObject({
      event: "secret.revoked",
      secretRef,
      previousRevision: 1,
      revision: 2,
      status: "revoked",
      revokedAt: revokedAt.toISOString(),
      reason: "operator rotation cleanup"
    });
  });

  it("throws for invalid or unsupported inputs", async () => {
    const dataDir = await createTempDir("pact-secret-errors-");

    await expect(initializeLocalSecret({
      dataDir,
      provider: "dify",
      secretRef: "not-a-secret-ref",
      payload: { apiKey: "bad" }
    })).rejects.toThrow("Pact secret init requires a secret:// secretRef.");

    await expect(initializeLocalSecret({
      dataDir,
      provider: "dify",
      payload: {}
    })).rejects.toThrow("Pact secret init requires a secret payload");

    await expect(initializeLocalSecret({
      dataDir,
      provider: "unknown-provider",
      payload: { secret: "x" }
    })).rejects.toThrow("Unsupported Pact secret provider: unknown-provider");
  });
});
