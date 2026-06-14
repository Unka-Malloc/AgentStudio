import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  EXTERNAL_SERVICE_CONFIG_KIND,
  EXTERNAL_SERVICE_MODEL_PROTOCOL,
  EXTERNAL_SERVICE_MODE,
  EXTERNAL_SERVICE_UPSTREAM_TYPE,
  compositionPresetFromExternalServiceConfig,
  externalServicePathRefs,
  loadExternalServiceConfig,
  normalizeExternalServiceConfig,
  validateExternalServiceConfig,
  writeExternalServiceArtifacts,
} from "../../../server/platform/common/composition-management/external-service-adapter.mjs";

const tempRoots = [];

async function tempDir(prefix) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

async function writeText(filePath, text) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, text, "utf8");
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("external service adapter", () => {
  it("normalizes model, cloud-drive, RPC, scripts, health and binding fields", async () => {
    const modelConfig = normalizeExternalServiceConfig({
      id: "deepseek",
      serviceName: "DeepSeek",
      mode: "managed",
      displayName: "DeepSeek Gateway",
      startupPolicy: "external-only",
      upstream: {
        type: "llm",
        url: "https://api.deepseek.com/v1/chat/completions",
      },
      binding: {
        mode: "compile",
        outlet: "pact.serviceHub",
        scopes: ["models:invoke", "models:invoke", ""],
        risk: "safe_write",
      },
      prepareScript: {
        path: "scripts/prepare.sh",
        env: {
          NODE_ENV: "test",
        },
      },
      startCommand: {
        command: {
          executable: "node",
          args: ["server.mjs"],
        },
      },
      health: {
        port: 8080,
        path: "/healthz",
      },
      dependencies: ["node", "docker"],
    });

    expect(modelConfig).toMatchObject({
      kind: EXTERNAL_SERVICE_CONFIG_KIND,
      serviceId: "deepseek",
      mode: EXTERNAL_SERVICE_MODE.MANAGED,
      startupPolicy: "external-only",
      upstream: {
        type: EXTERNAL_SERVICE_UPSTREAM_TYPE.LLM,
        provider: "deepseek",
        modelProtocol: EXTERNAL_SERVICE_MODEL_PROTOCOL.OPENAI_COMPATIBLE,
      },
      binding: {
        outlet: "pact.serviceHub",
        requiredScopes: ["models:invoke"],
        risk: "safe_write",
      },
      healthCheck: {
        type: "http",
        host: "127.0.0.1",
        port: 8080,
        path: "/healthz",
      },
      runtimeDependencies: ["node", "docker"],
    });
    expect(modelConfig.scripts.prepare.path).toBe("scripts/prepare.sh");
    expect(modelConfig.scripts.start.command.executable).toBe("node");
    expect(externalServicePathRefs(modelConfig)).toEqual(["scripts/prepare.sh"]);

    const cloudDrive = normalizeExternalServiceConfig({
      serviceId: "drive",
      serviceName: "Drive",
      upstream: {
        type: "cloud-drive",
        provider: "google",
        mode: "remote",
        endpointUrl: "https://drive.example/api",
        secretRef: "secret://pact/drive/google",
      },
    });
    expect(cloudDrive.upstream).toMatchObject({
      type: "cloud-drive",
      provider: "google-drive",
      providers: ["google-drive"],
      mode: "remote-live",
      endpointUrl: "https://drive.example/api",
    });

    const rpc = normalizeExternalServiceConfig({
      serviceId: "rpc-service",
      serviceName: "RPC",
      upstream: {
        type: "rpc",
        baseUrl: "https://rpc.example",
        rpcPath: "/rpc",
        rpcEndpoints: {
          primary: "/primary",
        },
      },
      tools: [
        {
          operationId: "rpc.echo",
          rpc: {
            endpointRef: "primary",
            method: "echo",
          },
        },
      ],
    });
    expect(rpc.upstream.endpoints.primary).toBe("/primary");

    const jsonRpc = normalizeExternalServiceConfig({
      serviceId: "json-rpc-service",
      serviceName: "JSON RPC",
      upstream: {
        type: "json-rpc",
        url: "https://rpc.example.com:443/jsonrpc",
        auth: {
          type: "bearer",
          secretRef: "secret://servicehub/json-rpc/api-key"
        },
        defaultHeaders: {
          "X-Trace": "trace-ok"
        }
      },
      tools: [
        {
          name: "lookup",
          method: "ticket.lookup"
        }
      ]
    });
    expect(jsonRpc.upstream).toMatchObject({
      type: "json-rpc",
      url: "https://rpc.example.com:443/jsonrpc",
      auth: {
        type: "bearer",
        secretRef: "secret://servicehub/json-rpc/api-key"
      },
      defaultHeaders: {
        "X-Trace": "trace-ok"
      }
    });

    const apiKeyHeader = normalizeExternalServiceConfig({
      serviceId: "api-key-header",
      serviceName: "API Key Header",
      upstream: {
        type: "https",
        baseUrl: "https://api.example.com:443",
        auth: {
          type: "api-key",
          secretRef: "secret://servicehub/api-key-header/api-key",
          headerName: "X-Custom-Key"
        }
      },
      tools: [
        {
          name: "search",
          method: "GET",
          path: "/v1/search"
        }
      ]
    });
    expect(apiKeyHeader.upstream.auth).toMatchObject({
      type: "api-key",
      secretRef: "secret://servicehub/api-key-header/api-key",
      headerName: "X-Custom-Key"
    });
    await expect(validateExternalServiceConfig({
      config: apiKeyHeader,
      requireKnownPaths: false
    })).resolves.toMatchObject({
      ok: true,
      errors: []
    });
  });

  it("validates upstream-specific errors, missing paths, and warnings", async () => {
    const cwd = await tempDir("pact-external-service-validate-");
    await writeText(path.join(cwd, "scripts", "ok.sh"), "#!/bin/sh\n");
    const valid = normalizeExternalServiceConfig({
      serviceId: "valid",
      serviceName: "Valid",
      mode: "managed",
      policyPreset: "servicehub.development-local",
      scripts: {
        start: {
          path: "scripts/ok.sh",
        },
      },
      upstream: {
        type: "mcp",
        transport: "streamable-http",
        url: "http://127.0.0.1:8787/mcp",
      },
    });

    await expect(validateExternalServiceConfig({ config: valid, cwd }))
      .resolves.toMatchObject({
        ok: true,
        errors: [],
      });

    const invalidRpc = normalizeExternalServiceConfig({
      serviceId: "bad-rpc",
      serviceName: "Bad RPC",
      upstream: {
        type: "rpc",
        url: "https://rpc.example",
      },
      tools: [
        {
          operationId: "rpc.bad",
          rpc: {
            endpointRef: "missing",
          },
        },
      ],
      healthCheck: {
        type: "http",
      },
      scripts: {
        doctor: {
          path: "missing.sh",
        },
      },
    });
    const invalid = await validateExternalServiceConfig({
      config: invalidRpc,
      cwd,
      requireKnownPaths: true,
    });
    expect(invalid.ok).toBe(false);
    expect(invalid.errors).toEqual(expect.arrayContaining([
      "External RPC tool rpc.bad references unknown endpointRef: missing.",
      expect.stringContaining("External RPC tool rpc.bad requires an explicit RPC endpoint path"),
      "External service references missing path missing.sh.",
    ]));
    expect(invalid.warnings).toContain("External service HTTP health check has no url or port.");

    const invalidDrive = normalizeExternalServiceConfig({
      serviceId: "drive",
      serviceName: "Drive",
      upstream: {
        type: "cloud-drive",
        provider: "dropbox",
        mode: "remote-live",
        secretRef: "not-secret-ref",
      },
    });
    const driveValidation = await validateExternalServiceConfig({
      config: invalidDrive,
      requireKnownPaths: false,
    });
    expect(driveValidation.errors).toEqual(expect.arrayContaining([
      "External cloud-drive remote-live upstream requires endpointUrl or url.",
      "External cloud-drive OAuth provider secret must use a secret:// secretRef.",
    ]));
  });

  it("rejects restricted ServiceHub egress by default and requires an explicit local-development preset", async () => {
    const productionLocal = normalizeExternalServiceConfig({
      serviceId: "local-mcp-production",
      upstream: {
        type: "mcp",
        transport: "streamable-http",
        url: "http://127.0.0.1:8787/mcp",
      },
    });

    const productionValidation = await validateExternalServiceConfig({
      config: productionLocal,
      requireKnownPaths: false,
    });
    expect(productionValidation.ok).toBe(false);
    expect(productionValidation.errors).toEqual(expect.arrayContaining([
      "ServiceHub egress denied for upstream.url: restricted_address_loopback.",
    ]));

    const developmentLocal = normalizeExternalServiceConfig({
      serviceId: "local-mcp-development",
      policyPreset: "servicehub.development-local",
      upstream: {
        type: "mcp",
        transport: "streamable-http",
        url: "http://127.0.0.1:8787/mcp",
      },
    });

    await expect(validateExternalServiceConfig({
      config: developmentLocal,
      requireKnownPaths: false,
    })).resolves.toMatchObject({
      ok: true,
      errors: [],
    });
  });

  it("loads configs, builds composition presets, and writes packaged artifacts", async () => {
    const cwd = await tempDir("pact-external-service-load-");
    const sourceRoot = await tempDir("pact-external-service-source-");
    const outputRoot = await tempDir("pact-external-service-output-");
    await writeText(path.join(cwd, "scripts", "start.sh"), "#!/bin/sh\necho start\n");
    await writeText(path.join(cwd, "service-root", "README.md"), "service root\n");
    const rawConfig = {
      serviceId: "artifact-service",
      serviceName: "Artifact Service",
      displayName: "Artifact",
      mode: "connected",
      scriptRoots: ["service-root"],
      scripts: {
        start: {
          path: "scripts/start.sh",
        },
      },
      upstream: {
        type: "openapi",
        baseUrl: "https://api.example/v1",
        spec: {
          openapi: "3.0.0",
          paths: {},
        },
      },
      featureIds: ["external-artifact"],
      requiredOperations: ["artifact.run"],
    };
    const configPath = path.join(cwd, "external-service.json");
    await writeText(configPath, JSON.stringify(rawConfig, null, 2));

    const loaded = await loadExternalServiceConfig(configPath);
    expect(loaded.config).toMatchObject({
      serviceId: "artifact-service",
      serviceName: "Artifact Service",
      upstream: {
        type: "openapi",
        baseUrl: "https://api.example/v1",
      },
    });

    const preset = compositionPresetFromExternalServiceConfig(loaded.config, {
      filePath: loaded.filePath,
      outputRoot,
    });
    expect(preset).toMatchObject({
      kind: "pact.composition.preset",
      presetId: "artifact-service",
      deploymentTarget: {
        outputRoot,
      },
      externalService: {
        serviceId: "artifact-service",
      },
      applicationDependencyPackage: {
        featureIds: ["external-artifact"],
        scripts: ["scripts/start.sh"],
        requiredOperations: ["artifact.run"],
      },
    });

    const artifactResult = await writeExternalServiceArtifacts({
      config: loaded.config,
      sourceRoot,
      outputRoot,
      cwd,
    });
    expect(artifactResult).toMatchObject({
      ok: true,
      serviceId: "artifact-service",
      copiedPaths: [
        {
          id: "start",
          packagedPath: "composition/external-service-scripts/1-start.sh",
        },
      ],
      copiedRoots: [
        {
          packagedPath: "composition/external-service-scripts/root-1-service-root",
        },
      ],
    });
    const packagedConfig = JSON.parse(await fs.readFile(artifactResult.sourceConfigPath, "utf8"));
    expect(packagedConfig.scripts.start.path).toBe("composition/external-service-scripts/1-start.sh");
    expect(packagedConfig.scriptRoots).toEqual(["composition/external-service-scripts/root-1-service-root"]);
    await expect(fs.readFile(path.join(sourceRoot, "composition", "EXTERNAL_SERVICE.md"), "utf8"))
      .resolves.toContain("Artifact");
    await expect(fs.readFile(path.join(outputRoot, "external-service.config.json"), "utf8"))
      .resolves.toContain("artifact-service");

    await expect(writeExternalServiceArtifacts({ config: null, sourceRoot }))
      .resolves.toBeNull();
    expect(normalizeExternalServiceConfig(null)).toBeNull();
  });
});
