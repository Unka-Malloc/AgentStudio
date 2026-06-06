import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  getModelAgentSettingsPath,
  getModelProviderSettingsPath,
  loadSettings,
  normalizeSettings,
  resolveDefaultModelSettings,
  resolveModelForModule,
  saveSettings
} from "../../../server/platform/common/platform-core/settings.mjs";

async function withTempRoot(testCase) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pact-settings-platform-core-extra-"));
  try {
    return await testCase(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

describe("platform settings extra coverage", () => {
  it("infers module model providers and resolves agent-specific assignments", () => {
    const settings = normalizeSettings({
      modelIntelligenceEnabled: true,
      modelLibraryAgents: [
        {
          uid: "graph-openai",
          provider: "openai-chatgpt",
          model: "gpt-5.4-mini",
          moduleAccess: { mode: "selected", moduleIds: ["graphInsight"] }
        },
        {
          uid: "blocked-openai",
          provider: "openai-chatgpt",
          model: "gpt-5.4-mini",
          moduleAccess: { mode: "selected", moduleIds: ["timelineDistillation"] }
        }
      ],
      moduleModelAssignments: {
        knowledgeTaxonomy: { model: "gemini-flash-lite-latest" },
        graphInsight: "openai-chatgpt:gpt-5.4-mini",
        timelineDistillation: { model: "deepseek-v4-pro" },
        agentTools: { model: "copilot-default" },
        localOcr: { model: "local-llama" }
      },
      moduleAgentProfiles: {
        graphInsight: {
          primaryAgent: "graph-openai",
          agents: {
            "graph-openai": {
              enabled: false,
              roleId: "reviewer",
              profileId: "context-256k",
              prompt: "Use graph context",
              parameters: { temperature: 0.1 },
              dependencies: { graph: true }
            },
            "blocked-openai": {
              role: "blocked"
            }
          }
        }
      }
    });

    expect(resolveModelForModule(settings, "knowledgeTaxonomy")).toMatchObject({
      provider: "google-gemini",
      model: "gemini-flash-lite-latest",
      enabled: true
    });
    expect(resolveModelForModule(settings, "graphInsight")).toMatchObject({
      provider: "openai-chatgpt",
      model: "graph-openai",
      enabled: true,
      profile: {
        enabled: false,
        role: "reviewer",
        contextProfileId: "context-256k",
        systemPrompt: "Use graph context"
      }
    });
    expect(resolveModelForModule(settings, "timelineDistillation")).toMatchObject({
      provider: "deepseek",
      model: "deepseek-v4-pro",
      enabled: true
    });
    expect(resolveModelForModule(settings, "agentTools")).toMatchObject({
      provider: "copilot",
      model: "copilot-default",
      enabled: true
    });
    expect(resolveModelForModule(settings, "localOcr")).toMatchObject({
      provider: "local-model",
      model: "local-llama",
      enabled: true
    });
    expect(resolveModelForModule(settings, "unknown-module")).toMatchObject({
      provider: "",
      model: "",
      enabled: false
    });
  });

  it("writes split model settings, preserves secrets, redacts output, and deletes inactive providers", async () => {
    await withTempRoot(async (root) => {
      await expect(loadSettings(root)).resolves.toMatchObject({
        modelLibraryEntries: []
      });

      await saveSettings(root, {
        modelLibraryEntries: ["google-gemini", "openrouter", "deepseek", "copilot", "custom-http"],
        defaultModelProvider: "openrouter",
        defaultModel: "openrouter:anthropic/claude",
        googleApiKey: "google-secret",
        googleModel: "gemini-flash-lite-latest",
        openRouterApiKey: "openrouter-secret",
        openRouterModel: "anthropic/claude",
        deepSeekApiKey: "deepseek-secret",
        deepSeekModel: "deepseek-v4-pro",
        copilotApiKey: "copilot-secret",
        copilotModel: "copilot-default",
        customModelApiKey: "custom-secret",
        customHttpAdapter: {
          alias: "primary-custom",
          url: "http://127.0.0.1:9000",
          token: "primary-token",
          engine: "custom-engine"
        },
        customHttpAdapters: [
          {
            alias: "adapter-a",
            url: "http://127.0.0.1:9001",
            token: "adapter-token"
          }
        ],
        modelLibraryAgents: [
          {
            uid: "agent-a",
            provider: "custom-http",
            alias: "agent-a",
            model: "agent-engine",
            apiKey: "agent-api-key",
            token: "agent-token"
          }
        ],
        agentToolExecution: {
          local: {
            nodeCommand: "/custom/node",
            commands: [
              {
                commandId: "node-version",
                command: "",
                variables: [
                  { key: "flag", title: "Flag", default: "--version", options: "--version" },
                  { key: "" }
                ]
              }
            ]
          }
        }
      });

      const redacted = await saveSettings(root, {
        modelLibraryEntries: ["google-gemini", "openrouter", "deepseek", "copilot", "custom-http"],
        defaultModelProvider: "custom-http",
        defaultModel: "primary-custom",
        googleApiKey: "",
        openRouterApiKey: "",
        deepSeekApiKey: "",
        copilotApiKey: "",
        customModelApiKey: "",
        customHttpAdapter: {
          alias: "primary-custom",
          url: "http://127.0.0.1:9100"
        },
        customHttpAdapters: [
          {
            alias: "adapter-a",
            url: "http://127.0.0.1:9101"
          }
        ],
        modelLibraryAgents: [
          {
            uid: "agent-a",
            provider: "custom-http",
            alias: "agent-a",
            model: "agent-engine-next"
          }
        ]
      }, { redactSecrets: true });

      expect(redacted).toMatchObject({
        googleApiKey: "",
        googleApiKeyConfigured: true,
        openRouterApiKeyConfigured: true,
        deepSeekApiKeyConfigured: true,
        copilotApiKeyConfigured: true,
        customModelApiKeyConfigured: true,
        customHttpAdapter: {
          alias: "primary-custom",
          token: "",
          tokenConfigured: true
        },
        customHttpAdapters: expect.arrayContaining([
          expect.objectContaining({
            alias: "adapter-a",
            token: "",
            tokenConfigured: true
          })
        ]),
        modelLibraryAgents: [
          expect.objectContaining({
            uid: "agent-a",
            apiKey: "",
            apiKeyConfigured: true,
            token: "",
            tokenConfigured: true
          })
        ]
      });

      const loaded = await loadSettings(root);
      expect(loaded).toMatchObject({
        googleApiKey: "google-secret",
        openRouterApiKey: "openrouter-secret",
        deepSeekApiKey: "deepseek-secret",
        copilotApiKey: "copilot-secret",
        customModelApiKey: "custom-secret",
        customHttpAdapter: {
          alias: "primary-custom",
          url: "http://127.0.0.1:9100",
          token: "primary-token"
        },
        customHttpAdapters: expect.arrayContaining([
          expect.objectContaining({
            alias: "adapter-a",
            token: "adapter-token"
          })
        ]),
        modelLibraryAgents: [
          expect.objectContaining({
            uid: "agent-a",
            apiKey: "agent-api-key",
            token: "agent-token"
          })
        ]
      });

      expect(await readJson(getModelProviderSettingsPath(root, "google-gemini"))).toMatchObject({
        googleApiKey: "google-secret"
      });
      expect(await readJson(getModelAgentSettingsPath(root, "agent-a"))).toMatchObject({
        uid: "agent-a",
        token: "agent-token"
      });
      expect(resolveDefaultModelSettings(loaded)).toMatchObject({
        provider: "custom-http",
        model: "primary-custom",
        enabled: false
      });

      await saveSettings(root, {
        modelLibraryEntries: ["google-gemini"],
        defaultModelProvider: "openrouter",
        defaultModel: "anthropic/claude",
        googleApiKey: "",
        modelLibraryAgents: []
      });

      const googleOnly = await loadSettings(root);
      expect(googleOnly).toMatchObject({
        googleApiKey: "google-secret",
        defaultModelProvider: "",
        defaultModel: ""
      });
      await expect(fs.access(getModelProviderSettingsPath(root, "openrouter"))).rejects.toMatchObject({
        code: "ENOENT"
      });
      await expect(fs.access(getModelAgentSettingsPath(root, "agent-a"))).rejects.toMatchObject({
        code: "ENOENT"
      });
    });
  });
});
