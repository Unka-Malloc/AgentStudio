import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

let executeConsoleDomainOperation;

beforeAll(async () => {
  ({ executeConsoleDomainOperation } = await import(
    "../../../server/platform/specialized/console/console-domain-operation-executor.mjs"
  ));
});

async function withTempDir(testCase) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pact-console-settings-"));
  try {
    return await testCase(root);
  } finally {
    await fs.rm(root, { force: true, recursive: true });
  }
}

function protocolEventBus() {
  return {
    publish: vi.fn((topic, _payload, options = {}) => ({
      id: `evt-${options.type || topic}`,
      offset: 1,
      topic
    }))
  };
}

function createAgentRuntimeHarness(initialModels = []) {
  let models = initialModels.map((model) => ({ ...model }));
  const normalizeModel = (model, index) => ({
    uid: model.uid || model.alias || model.instanceId || `agent-${index + 1}`,
    alias: model.alias || model.uid || model.instanceId || `agent-${index + 1}`,
    instanceId: model.instanceId || model.uid || model.alias || `agent-${index + 1}`,
    provider: model.provider || "deepseek",
    model: model.model || model.engine || "deepseek-v4-pro",
    engine: model.engine || model.model || "deepseek-v4-pro",
    label: model.label || model.agentName || model.uid || `Agent ${index + 1}`,
    agentName: model.agentName || model.label || model.uid || `Agent ${index + 1}`,
    baseUrl: model.baseUrl || "",
    apiKey: model.apiKey || "",
    timeoutMs: model.timeoutMs || 120000
  });
  const publicAgents = () => models.map((model, index) => {
    const normalized = normalizeModel(model, index);
    return {
      alias: normalized.uid,
      provider: normalized.provider,
      model: normalized.model,
      label: normalized.label
    };
  });
  const registry = {
    refresh: vi.fn(async ({ settingsFallback = {} } = {}) => {
      if (Array.isArray(settingsFallback.modelLibraryAgents) && settingsFallback.modelLibraryAgents.length > 0) {
        models = settingsFallback.modelLibraryAgents.map((model, index) => normalizeModel(model, index));
      }
    }),
    replaceFromModelLibraryAgents: vi.fn(async (nextModels = []) => {
      models = nextModels.map((model, index) => normalizeModel(model, index));
    }),
    getModelLibraryEntries: vi.fn(() => [...new Set(models.map((model) => model.provider).filter(Boolean))]),
    getModelLibraryAgents: vi.fn((options = {}) => models.map((model, index) => {
      const normalized = normalizeModel(model, index);
      if (options.redactSecrets) {
        const { apiKey: _apiKey, token: _token, ...redacted } = normalized;
        return { ...redacted, apiKeyConfigured: Boolean(normalized.apiKey || normalized.token) };
      }
      return normalized;
    }))
  };
  const provider = {
    getAgentConfigRegistry: vi.fn(() => registry),
    publicAgentGatewayConfig: vi.fn(async (settings = {}) => ({
      adapterAlias: settings.customHttpAdapter?.alias || settings.customModelAlias || "",
      entries: settings.modelLibraryEntries || []
    })),
    probeModelConnection: vi.fn(async ({ provider: providerId, modelAlias }) => ({
      ok: true,
      configured: true,
      provider: providerId,
      model: modelAlias,
      latencyMs: 7,
      statusCode: 200,
      checkedAt: "2026-06-04T00:00:00.000Z"
    })),
    callAgentGateway: vi.fn(async ({ input }) => ({ ok: true, echoed: input.prompt || "" })),
    publicAgentGatewayRegistry: vi.fn(async () => ({
      version: "test-registry",
      agents: publicAgents()
    })),
    inspectAgentModelRouting: vi.fn(async ({ limit }) => ({ ok: true, limit }))
  };
  return { provider, registry };
}

async function runOperation(operationId, { input = {}, context = {} } = {}) {
  return executeConsoleDomainOperation({ operationId, input, context });
}

describe("console-domain settings and agent gateway dispatch", () => {
  it("covers settings, gateway config, model probe, routing health, and gateway call operations", async () => {
    await withTempDir(async (userDataPath) => {
      const { provider, registry } = createAgentRuntimeHarness([
        {
          uid: "agent-alpha",
          provider: "deepseek",
          model: "deepseek-v4-pro",
          label: "Agent Alpha",
          apiKey: "secret"
        }
      ]);
      const context = {
        userDataPath,
        agentRuntimeProvider: provider,
        protocolEventBus: protocolEventBus(),
        appendConsoleOperationLog: vi.fn(),
        authSession: { user: { userId: "u-1", username: "alice" } },
        moduleManagement: {
          refreshMounts: vi.fn(async () => ({ ok: true }))
        }
      };

      await expect(runOperation("settings.get", { context })).resolves.toMatchObject({
        status: 200,
        payload: {
          modelLibraryAgentIds: ["agent-alpha"]
        }
      });
      await expect(runOperation("settings.set", {
        input: {
          modelLibraryEntries: ["deepseek"],
          modelLibraryAgents: [
            {
              uid: "agent-beta",
              provider: "deepseek",
              model: "deepseek-reasoner",
              label: "Agent Beta"
            },
            {
              uid: "agent-filtered",
              provider: "openrouter",
              model: "openrouter-model"
            }
          ]
        },
        context
      })).resolves.toMatchObject({ status: 200 });
      expect(registry.replaceFromModelLibraryAgents).toHaveBeenCalledWith([
        expect.objectContaining({ uid: "agent-beta" })
      ]);
      expect(context.moduleManagement.refreshMounts).toHaveBeenCalled();
      expect(context.protocolEventBus.publish).toHaveBeenCalled();
      expect(context.appendConsoleOperationLog).toHaveBeenCalledWith(expect.objectContaining({
        operationId: "settings.model_library.save"
      }));

      await expect(runOperation("settings.model_probe", {
        input: {
          provider: "deepseek",
          modelAlias: "agent-beta",
          settings: {
            modelLibraryAgents: [{ uid: "agent-beta", provider: "deepseek", model: "deepseek-reasoner" }]
          }
        },
        context
      })).resolves.toMatchObject({ status: 200, payload: { ok: true, provider: "deepseek" } });
      await expect(runOperation("agent_gateway.config.get", { context }))
        .resolves.toMatchObject({ status: 200, payload: { config: expect.any(Object) } });
      await expect(runOperation("agent_gateway.config.set", {
        input: {
          alias: "custom-agent",
          url: "https://agent.example.invalid",
          token: "secret"
        },
        context
      })).resolves.toMatchObject({ status: 200, payload: { config: expect.any(Object) } });
      await expect(runOperation("agent_gateway.call", {
        input: { prompt: "hello" },
        context
      })).resolves.toMatchObject({ status: 200, payload: { ok: true, echoed: "hello" } });
      await expect(runOperation("agents.list", { context }))
        .resolves.toMatchObject({ status: 200, payload: { version: "test-registry" } });
      await expect(runOperation("model_routing.health", {
        input: { limit: "3" },
        context
      })).resolves.toMatchObject({ status: 200, payload: { ok: true, limit: 3 } });

      expect(provider.publicAgentGatewayConfig).toHaveBeenCalled();
      expect(provider.callAgentGateway).toHaveBeenCalledWith(expect.objectContaining({
        input: expect.objectContaining({ prompt: "hello" }),
        userDataPath
      }));
      expect(provider.inspectAgentModelRouting).toHaveBeenCalledWith(expect.objectContaining({
        userDataPath,
        limit: 3
      }));
    });
  });

  it("covers agent model create, update, delete, not-found, and provider failure branches", async () => {
    await withTempDir(async (userDataPath) => {
      const { provider } = createAgentRuntimeHarness([
        {
          uid: "agent-existing",
          provider: "deepseek",
          model: "deepseek-v4-pro",
          label: "Existing"
        }
      ]);
      const context = {
        userDataPath,
        agentRuntimeProvider: provider,
        protocolEventBus: protocolEventBus(),
        appendConsoleOperationLog: vi.fn(),
        authSession: { user: { userId: "u-2", username: "bob" } }
      };

      await expect(runOperation("agents.create", {
        input: {
          provider: "deepseek",
          model: "deepseek-chat",
          label: "Created Agent"
        },
        context
      })).resolves.toMatchObject({
        status: 200,
        payload: { ok: true, action: "created" }
      });
      await expect(runOperation("agents.update", {
        input: {
          agentId: "agent-existing",
          model: "deepseek-reasoner",
          label: "Updated Agent"
        },
        context
      })).resolves.toMatchObject({
        status: 200,
        payload: { ok: true, action: "updated", agentId: "agent-existing" }
      });
      await expect(runOperation("agents.update", {
        input: { agentId: "missing-agent", label: "Missing" },
        context
      })).resolves.toMatchObject({ status: 404 });
      await expect(runOperation("agents.delete", {
        input: { agentId: "agent-existing" },
        context
      })).resolves.toMatchObject({
        status: 200,
        payload: { ok: true, action: "deleted", agentId: "agent-existing" }
      });
      await expect(runOperation("agents.delete", {
        input: { agentId: "missing-agent" },
        context
      })).resolves.toMatchObject({ status: 404 });

      provider.publicAgentGatewayRegistry = vi.fn(async () => {
        throw new Error("registry unavailable");
      });
      await expect(runOperation("agents.create", {
        input: { provider: "deepseek", model: "broken-model" },
        context
      })).resolves.toMatchObject({ status: 500 });

      const configlessProvider = { getAgentConfigRegistry: provider.getAgentConfigRegistry };
      await expect(runOperation("agent_gateway.config.get", {
        context: {
          userDataPath,
          agentRuntimeProvider: configlessProvider
        }
      })).resolves.toMatchObject({ status: 503 });
      await expect(runOperation("agent_gateway.call", {
        context: {
          userDataPath,
          agentRuntimeProvider: configlessProvider
        }
      })).resolves.toMatchObject({ status: 503 });
      await expect(runOperation("agents.list", {
        context: {
          userDataPath,
          agentRuntimeProvider: configlessProvider
        }
      })).resolves.toMatchObject({ status: 503 });
      await expect(runOperation("model_routing.health", {
        context: {
          userDataPath,
          agentRuntimeProvider: configlessProvider
        }
      })).resolves.toMatchObject({ status: 503 });

      expect(context.appendConsoleOperationLog).toHaveBeenCalledWith(expect.objectContaining({
        event: "console.settings.model_library.create_failed"
      }));
    });
  });

  it("records model probe failures as a successful console response with failed probe payload", async () => {
    await withTempDir(async (userDataPath) => {
      const { provider } = createAgentRuntimeHarness();
      provider.probeModelConnection = vi.fn(async () => {
        throw new Error("probe failed");
      });
      const context = {
        userDataPath,
        agentRuntimeProvider: provider,
        appendConsoleOperationLog: vi.fn()
      };

      await expect(runOperation("settings.model_probe", {
        input: { provider: "custom-http", modelAlias: "agent-zeta" },
        context
      })).resolves.toMatchObject({
        status: 200,
        payload: {
          ok: false,
          configured: false,
          provider: "custom-http",
          model: "agent-zeta",
          message: "probe failed"
        }
      });
      expect(context.appendConsoleOperationLog).toHaveBeenCalledWith(expect.objectContaining({
        operationId: "settings.model_library.probe",
        status: "failed"
      }));
    });
  });
});
