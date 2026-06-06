import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  MODEL_USAGE_DEFINITIONS,
  getAgentToolExecutionSettingsPath,
  getAgentToolSettingsDirectory,
  getModelAgentSettingsDirectory,
  getModelAgentSettingsPath,
  getModelProviderSettingsPath,
  getModelSettingsDirectory,
  getSettingsPath,
  loadSettings,
  normalizeSettings,
  resolveDefaultModelSettings,
  resolveModelForModule,
  saveSettings,
} from "../../../server/platform/common/platform-core/settings.mjs";

async function withTempUserData(testCase) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pact-platform-settings-"));
  try {
    return await testCase(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

describe("platform settings path helpers", () => {
  it("builds stable settings paths and rejects unsupported split config ids", () => {
    const root = "/tmp/pact-user-data";

    expect(getSettingsPath(root)).toBe("/tmp/pact-user-data/settings.json");
    expect(getModelSettingsDirectory(root)).toBe("/tmp/pact-user-data/model-settings");
    expect(getModelAgentSettingsDirectory(root)).toBe("/tmp/pact-user-data/model-agents");
    expect(getAgentToolSettingsDirectory(root)).toBe("/tmp/pact-user-data/tool-management");
    expect(getAgentToolExecutionSettingsPath(root)).toBe("/tmp/pact-user-data/tool-management/execution.json");
    expect(getModelProviderSettingsPath(root, "openai-chatgpt")).toBe(
      "/tmp/pact-user-data/model-settings/openai-chatgpt.json",
    );
    expect(getModelAgentSettingsPath(root, " Agent One/Primary ")).toBe(
      "/tmp/pact-user-data/model-agents/Agent_One_Primary.json",
    );
    expect(() => getModelProviderSettingsPath(root, "bad-provider")).toThrow("不支持的模型配置类型");
    expect(() => getModelAgentSettingsPath(root, " /// ")).toThrow("模型智能体 UID 为空");
  });
});

describe("platform settings normalization and model resolution", () => {
  it("normalizes providers, agents, module assignments, permissions, and tool execution", () => {
    const normalized = normalizeSettings({
      cloudParsingEnabled: true,
      tikaTimeoutMs: -10,
      defaultModel: "gpt-5.4-mini",
      modelLibraryEntries: ["openai-chatgpt", "bad", "custom-http", "openai-chatgpt"],
      modelLibraryAgents: [
        {
          uid: "agent-alpha",
          provider: "openai-chatgpt",
          model: "gpt-5.4-mini",
          apiKey: "agent-secret",
          moduleAccess: {
            mode: "selected",
            moduleIds: ["knowledgeTaxonomy", "missing"],
          },
        },
        {
          provider: "custom-http",
          modelAlias: "agent-beta",
          engine: "beta-engine",
          token: "beta-token",
          pluginList: "search, summarize",
        },
        {
          provider: "bad-provider",
          model: "ignored",
        },
      ],
      moduleModelAssignments: {
        knowledgeTaxonomy: "openai-chatgpt:agent-alpha",
        graphInsight: { provider: "custom-http", model: "agent-beta" },
        localOcr: "bad-provider:model",
      },
      moduleAgentProfiles: {
        knowledgeTaxonomy: {
          primaryAgent: "agent-alpha",
          agents: {
            "agent-alpha": {
              profileId: "context-64k",
              prompt: "Classify documents",
              parameters: { temperature: 0 },
              dependencies: { knowledge: true },
            },
            unknown: { profileId: "skip" },
          },
        },
        graphInsight: {
          primaryAgent: "agent-beta",
        },
      },
      moduleIntelligence: {
        graphInsight: false,
        localOcr: true,
      },
      agentPermissionGroups: [
        {
          groupId: "reviewers",
          name: "Reviewers",
          enabled: false,
          scopes: "knowledge:read, knowledge:write",
          toolsets: ["review"],
          allowTools: ["knowledge.search", "knowledge.search"],
          denyTools: "dangerous.tool",
        },
        { id: "reviewers", label: "duplicate" },
      ],
      agentExploreDefaults: {
        temperature: 0,
        maxTokens: -1,
        maxIterations: "3",
        limit: "0",
        thinkingMode: "invalid",
      },
      agentToolExecution: {
        http: {
          enabled: false,
          allowedHosts: "localhost, 127.0.0.1",
          timeoutMs: 5,
          maxResponseBytes: -1,
        },
        local: {
          enabled: false,
          allowDirectCommands: true,
          nodeCommand: "/usr/local/bin/node",
          timeoutMs: 10,
          commands: [
            {
              id: "node-version",
              command: "",
              args: [],
              variables: [{ key: "flag", default: "--version" }],
            },
            {
              id: "custom-command",
              command: "echo",
              args: ["hello"],
            },
          ],
        },
      },
      customHttpAdapter: {
        modelAlias: "custom-main",
        endpoint: "https://example.test/api",
        apiKey: "custom-secret",
        timeoutMs: -1,
      },
      customHttpAdapters: [
        {
          alias: "custom-main",
          url: "https://duplicate.example",
          token: "duplicate",
        },
        {
          alias: "custom-secondary",
          endpoint: "https://secondary.example",
          apiKey: "secondary-secret",
        },
      ],
    });

    expect(normalized.cloudParsingEnabled).toBeUndefined();
    expect(normalized.tikaTimeoutMs).toBe(DEFAULT_SETTINGS.tikaTimeoutMs);
    expect(normalized.defaultModelProvider).toBe("openai-chatgpt");
    expect(normalized.modelLibraryEntries).toEqual(["openai-chatgpt", "custom-http"]);
    expect(normalized.modelLibraryAgents.map((item) => item.uid)).toEqual([
      "agent-alpha",
      expect.stringMatching(/^agent_[a-f0-9]{16}$/),
    ]);
    expect(normalized.modelLibraryAgents[0]).toMatchObject({
      provider: "openai-chatgpt",
      alias: "agent-alpha",
      moduleAccess: { mode: "selected", moduleIds: ["knowledgeTaxonomy"] },
      apiKey: "agent-secret",
      token: "agent-secret",
    });
    expect(normalized.moduleModelAssignments.knowledgeTaxonomy).toEqual({
      provider: "openai-chatgpt",
      model: "agent-alpha",
    });
    expect(normalized.moduleModelAssignments.graphInsight.provider).toBe("custom-http");
    expect(normalized.moduleIntelligence.knowledgeTaxonomy).toBe(true);
    expect(normalized.moduleIntelligence.graphInsight).toBe(true);
    expect(normalized.moduleIntelligence.localOcr).toBe(true);
    expect(normalized.moduleAgentProfiles.knowledgeTaxonomy).toMatchObject({
      primaryAgent: "agent-alpha",
      agents: {
        "agent-alpha": {
          enabled: true,
          role: "primary",
          contextProfileId: "context-64k",
          systemPrompt: "Classify documents",
          parameters: { temperature: 0 },
          dependencyContext: { knowledge: true },
        },
      },
    });
    expect(normalized.agentPermissionGroups).toEqual([
      {
        id: "reviewers",
        label: "Reviewers",
        description: "",
        enabled: false,
        scopeIds: ["knowledge:read", "knowledge:write"],
        toolsetIds: ["review"],
        toolAllow: ["knowledge.search"],
        toolDeny: ["dangerous.tool"],
      },
    ]);
    expect(normalized.agentExploreDefaults).toMatchObject({
      maxTokens: DEFAULT_SETTINGS.agentExploreDefaults.maxTokens,
      maxIterations: 3,
      limit: DEFAULT_SETTINGS.agentExploreDefaults.limit,
      thinkingMode: "default",
    });
    expect(normalized.agentToolExecution.http).toMatchObject({
      enabled: false,
      allowedHosts: ["localhost", "127.0.0.1"],
      timeoutMs: 5,
      maxResponseBytes: 65536,
    });
    expect(normalized.agentToolExecution.local).toMatchObject({
      enabled: false,
      allowDirectCommands: false,
      nodeCommand: "/usr/local/bin/node",
      timeoutMs: 10,
    });
    expect(normalized.agentToolExecution.local.commands[0]).toMatchObject({
      commandId: "node-version",
      command: "/usr/local/bin/node",
      args: ["{{flag}}"],
      allowExtraArgs: false,
    });
    expect(normalized.agentToolExecution.local.commands[1]).toMatchObject({
      commandId: "custom-command",
      command: "echo",
      args: ["hello"],
      allowExtraArgs: true,
    });
    expect(normalized.customHttpAdapter).toMatchObject({
      alias: "custom-main",
      url: "https://example.test/api",
      token: "custom-secret",
      timeoutMs: 120000,
    });
    expect(normalized.customHttpAdapters.map((item) => item.alias)).toEqual([
      "custom-main",
      "custom-secondary",
    ]);
  });

  it("resolves default and module-specific model settings", () => {
    expect(resolveDefaultModelSettings({
      defaultModelProvider: "openrouter",
      defaultModel: "openai/gpt-4.1-mini",
      modelIntelligenceEnabled: false,
    })).toEqual({
      provider: "openrouter",
      model: "openai/gpt-4.1-mini",
      enabled: false,
    });

    const settings = normalizeSettings({
      modelIntelligenceEnabled: true,
      modelLibraryAgents: [
        {
          uid: "agent-alpha",
          provider: "openai-chatgpt",
          model: "gpt-5.4-mini",
          moduleAccess: { mode: "selected", moduleIds: ["knowledgeTaxonomy"] },
        },
      ],
      moduleModelAssignments: {
        knowledgeTaxonomy: "openai-chatgpt:agent-alpha",
        localOcr: "openai-chatgpt:agent-alpha",
      },
      moduleAgentProfiles: {
        knowledgeTaxonomy: {
          primaryAgent: "agent-alpha",
          agents: {
            "agent-alpha": { profileId: "context-32k", role: "reviewer" },
          },
        },
      },
    });

    expect(resolveModelForModule(settings, "knowledgeTaxonomy")).toMatchObject({
      provider: "openai-chatgpt",
      model: "agent-alpha",
      enabled: true,
      moduleId: "knowledgeTaxonomy",
      profile: {
        role: "reviewer",
        contextProfileId: "context-32k",
      },
    });
    expect(resolveModelForModule({
      moduleIntelligence: { localOcr: false },
    }, "localOcr")).toEqual({
      provider: "",
      model: "",
      enabled: false,
      moduleId: "localOcr",
    });
    expect(resolveModelForModule(settings, "localOcr")).toMatchObject({
      provider: "openai-chatgpt",
      model: "agent-alpha",
      enabled: true,
      moduleId: "localOcr",
    });
    expect(MODEL_USAGE_DEFINITIONS.some((item) => item.id === "knowledgeTaxonomy")).toBe(true);
  });
});

describe("platform settings persistence", () => {
  it("saves split settings, reloads them, redacts secrets, and preserves existing tokens", async () => {
    await withTempUserData(async (root) => {
      const saved = await saveSettings(root, {
        defaultModelProvider: "google-gemini",
        defaultModel: "gemini-1.5-pro",
        modelLibraryEntries: ["google-gemini", "custom-http"],
        googleApiKey: "google-secret",
        googleModel: "gemini-1.5-pro",
        customModelAlias: "external-agent",
        customModelApiKey: "custom-secret",
        customHttpAdapter: {
          alias: "external-agent",
          url: "https://agent.example/api",
          token: "custom-secret",
        },
        customHttpAdapters: [
          {
            alias: "secondary",
            url: "https://secondary.example/api",
            token: "secondary-secret",
          },
        ],
        modelLibraryAgents: [
          {
            uid: "agent-alpha",
            provider: "custom-http",
            model: "external-agent",
            token: "agent-token",
          },
        ],
        agentToolExecution: {
          local: {
            commands: [
              {
                id: "custom-command",
                command: "node",
                args: ["--version"],
              },
            ],
          },
        },
      });

      expect(saved.googleApiKey).toBe("google-secret");
      expect(saved.customHttpAdapter.token).toBe("custom-secret");
      expect(saved.modelLibraryAgents[0].token).toBe("agent-token");

      const rootSettings = await readJson(getSettingsPath(root));
      expect(rootSettings.googleApiKey).toBeUndefined();
      expect(rootSettings.customHttpAdapter).toBeUndefined();
      expect(rootSettings.agentToolExecution).toBeUndefined();
      expect(rootSettings.modelLibraryAgentIds).toEqual(["agent-alpha"]);

      const googleSplit = await readJson(getModelProviderSettingsPath(root, "google-gemini"));
      expect(googleSplit).toMatchObject({
        googleApiKey: "google-secret",
        googleModel: "gemini-1.5-pro",
      });
      const customSplit = await readJson(getModelProviderSettingsPath(root, "custom-http"));
      expect(customSplit.customHttpAdapter).toMatchObject({
        alias: "external-agent",
        token: "custom-secret",
      });
      expect(customSplit.customHttpAdapters[1]).toMatchObject({
        alias: "secondary",
        token: "secondary-secret",
      });
      const agentSplit = await readJson(getModelAgentSettingsPath(root, "agent-alpha"));
      expect(agentSplit).toMatchObject({
        uid: "agent-alpha",
        instanceId: "agent-alpha",
        alias: "agent-alpha",
        token: "agent-token",
      });
      const toolExecutionSplit = await readJson(getAgentToolExecutionSettingsPath(root));
      expect(toolExecutionSplit.local.commands[0]).toMatchObject({
        commandId: "custom-command",
        command: "node",
      });

      const redacted = await loadSettings(root, { redactSecrets: true });
      expect(redacted.googleApiKey).toBe("");
      expect(redacted.googleApiKeyConfigured).toBe(true);
      expect(redacted.customHttpAdapter.token).toBe("");
      expect(redacted.customHttpAdapter.tokenConfigured).toBe(true);
      expect(redacted.customHttpAdapters.find((item) => item.alias === "secondary")).toMatchObject({
        token: "",
        tokenConfigured: true,
      });
      expect(redacted.modelLibraryAgents[0]).toMatchObject({
        token: "",
        tokenConfigured: true,
      });

      const preserved = await saveSettings(root, {
        modelLibraryEntries: ["custom-http"],
        defaultModelProvider: "google-gemini",
        defaultModel: "gemini-1.5-pro",
        customHttpAdapter: {
          alias: "external-agent",
          url: "https://agent.example/api",
          token: "",
        },
        customHttpAdapters: [
          {
            alias: "secondary",
            url: "https://secondary.example/api",
            token: "",
          },
        ],
        modelLibraryAgents: [
          {
            uid: "agent-alpha",
            provider: "custom-http",
            model: "external-agent",
          },
        ],
      });

      expect(preserved.defaultModelProvider).toBe("");
      expect(preserved.defaultModel).toBe("");
      expect(preserved.customHttpAdapter.token).toBe("custom-secret");
      expect(preserved.customHttpAdapters.find((item) => item.alias === "secondary")?.token).toBe("secondary-secret");
      expect(preserved.modelLibraryAgents[0].token).toBe("agent-token");
      await expect(fs.access(getModelProviderSettingsPath(root, "google-gemini"))).rejects.toMatchObject({
        code: "ENOENT",
      });
    });
  });

  it("loads defaults when files are absent and throws on malformed root JSON", async () => {
    await withTempUserData(async (root) => {
      const defaults = await loadSettings(root);
      expect(defaults.analysisModuleId).toBe(DEFAULT_SETTINGS.analysisModuleId);
      expect(defaults.agentToolExecution.local.commands[0].commandId).toBe("node-version");

      await fs.writeFile(getSettingsPath(root), "{not-json", "utf8");
      await expect(loadSettings(root)).rejects.toThrow(SyntaxError);
    });
  });
});
