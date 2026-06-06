import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";
import {
  AgentConfigRegistry,
  agentConfigPaths,
  getAgentConfigRegistry
} from "../../../server/platform/specialized/agent/agent-configs/config-registry.mjs";

async function withTempRoot(testCase) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pact-agent-config-registry-"));
  try {
    return await testCase(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

describe("agent config registry extras", () => {
  it("exposes stable path constants and initializes default manifests", async () => {
    const expectedRoot = path.resolve(process.cwd(), "server/platform/specialized/agent/agent-configs");
    expect(agentConfigPaths).toMatchObject({
      rootPath: expectedRoot,
      modelListPath: path.join(expectedRoot, "model-list"),
      agentListPath: path.join(expectedRoot, "agent-list"),
      modelManifestPath: path.join(expectedRoot, "model-list", "manifest.json"),
      agentManifestPath: path.join(expectedRoot, "agent-list", "manifest.json"),
    });

    await withTempRoot(async (root) => {
      const registry = new AgentConfigRegistry({ rootPath: root });
      await registry.ensureLayout();

      const modelManifest = await readJson(path.join(root, "model-list", "manifest.json"));
      const agentManifest = await readJson(path.join(root, "agent-list", "manifest.json"));

      expect(modelManifest).toMatchObject({
        schemaVersion: 1,
        kind: "model-list",
        entries: []
      });
      expect(agentManifest).toMatchObject({
        schemaVersion: 1,
        kind: "agent-list",
        entries: []
      });
      expect(modelManifest.updatedAt).toEqual(expect.any(String));
      expect(agentManifest.updatedAt).toEqual(expect.any(String));
    });
  });

  it("recovers from malformed manifest files and skips invalid config entries", async () => {
    await withTempRoot(async (root) => {
      const registry = new AgentConfigRegistry({ rootPath: root });
      await registry.ensureLayout();
      await fs.writeFile(path.join(root, "model-list", "manifest.json"), "{not-json", "utf8");
      await fs.writeFile(path.join(root, "agent-list", "manifest.json"), "{not-json", "utf8");

      await fs.writeFile(
        path.join(root, "model-list", "model_legacy.json"),
        JSON.stringify({ provider: "openai", model: "gpt-4o", label: "Legacy Model" }),
        "utf8"
      );
      await fs.writeFile(
        path.join(root, "model-list", "broken.json"),
        "not-json",
        "utf8"
      );
      await fs.writeFile(
        path.join(root, "agent-list", "agent_legacy.json"),
        JSON.stringify({
          uid: "agent-legacy",
          label: "Legacy Agent",
          modelUid: "model_legacy",
          parameters: { temperature: 0.5 },
        }),
        "utf8"
      );

      const state = await registry.refresh();

      expect(state.models).toHaveLength(1);
      expect(state.models[0].id).toBe("model_legacy");
      expect(state.models[0].provider).toBe("openai");
      expect(state.agents).toHaveLength(1);
      expect(state.agents[0].uid).toBe("agent-legacy");
      expect(state.modelLibraryAgents).toHaveLength(1);
      expect(state.modelLibraryAgents[0].parameters).toEqual({ temperature: 0.5 });
      expect(state.modelLibraryEntries).toEqual(["openai"]);
    });
  });

  it("merges model-library settings into model entries and combines agent/model fields", async () => {
    await withTempRoot(async (root) => {
      const registry = new AgentConfigRegistry({ rootPath: root });
      const state = await registry.refresh({
        settingsFallback: {
          modelLibraryAgents: [{
            uid: "agent-bridge",
            provider: "deepseek",
            model: "deepseek-v4-flash",
            modelLabel: "DeepSeek Flash",
            apiKey: "model-api-key",
            token: "model-token",
            timeoutMs: 150000,
            parameters: { maxTokens: 64000 }
          }]
        }
      });

      expect(state.models).toHaveLength(1);
      expect(state.models[0]).toMatchObject({
        apiKey: "model-api-key",
        token: "model-token",
        apiKeyConfigured: true,
        tokenConfigured: true,
        provider: "deepseek",
        model: "deepseek-v4-flash",
        parameters: { maxTokens: 64000 }
      });

      expect(state.modelLibraryAgents).toHaveLength(1);
      expect(state.modelLibraryAgents[0]).toMatchObject({
        uid: "agent-bridge",
        alias: "agent-bridge",
        provider: "deepseek",
        model: "deepseek-v4-flash",
        apiKey: "model-api-key",
        token: "model-token",
        tokenConfigured: true,
      });
      expect(state.modelLibraryAgents[0].parameters).toEqual({ maxTokens: 64000 });
    });
  });

  it("redacts secrets on projection and keeps internal values intact", async () => {
    await withTempRoot(async (root) => {
      const registry = new AgentConfigRegistry({ rootPath: root });
      await registry.upsertModel({
        id: "model-redacted",
        provider: "openai",
        model: "gpt-4o-mini",
        label: "Redacted model",
        apiKey: "model-secret",
        token: "token-secret",
      });
      await registry.upsertAgent({
        uid: "agent-redacted",
        label: "Redacted Agent",
        modelUid: "model-redacted",
        pluginList: ["search", "math"],
        provider: "openai",
        model: "gpt-4o-mini",
      });
      await registry.refresh();

      const redacted = registry.getModelLibraryAgents({ redactSecrets: true });
      expect(redacted).toHaveLength(1);
      expect(redacted[0]).toMatchObject({
        uid: "agent-redacted",
        apiKey: "",
        token: "",
        apiKeyConfigured: true,
        tokenConfigured: true,
      });

      const exposed = registry.getModelLibraryAgents();
      expect(exposed[0]).toMatchObject({
        uid: "agent-redacted",
        apiKey: "model-secret",
        token: "token-secret",
        apiKeyConfigured: true,
        tokenConfigured: true,
      });
    });
  });

  it("covers register/save/update/list/remove workflows in temp root", async () => {
    await withTempRoot(async (root) => {
      const registry = new AgentConfigRegistry({ rootPath: root });
      await registry.upsertFromModelLibraryEntry({
        uid: "agent-register",
        provider: "custom-http",
        model: "custom-http-lite",
        label: "Register Agent",
        baseUrl: "https://api.example",
      });

      let state = registry.getState();
      expect(state.modelLibraryAgents).toHaveLength(1);
      expect(state.modelLibraryAgents[0]).toMatchObject({
        uid: "agent-register",
        label: "Register Agent",
      });
      expect(state.modelLibraryEntries).toEqual(["custom-http"]);

      const modelManifest = await readJson(path.join(root, "model-list", "manifest.json"));
      const agentManifest = await readJson(path.join(root, "agent-list", "manifest.json"));
      expect(modelManifest.entries).toHaveLength(1);
      expect(agentManifest.entries).toHaveLength(1);

      const updated = await registry.upsertFromModelLibraryEntry({
        uid: "agent-register",
        provider: "custom-http",
        model: "custom-http-lite",
        label: "Register Agent Updated",
        baseUrl: "https://api.example",
        timeoutMs: 300000,
      });
      expect(updated.uid).toBe("agent-register");
      state = registry.getState();
      expect(state.modelLibraryAgents).toHaveLength(1);
      expect(state.modelLibraryAgents[0].label).toBe("Register Agent Updated");
      expect(state.models[0].timeoutMs).toBe(300000);

      const modelManifestAfterUpdate = await readJson(path.join(root, "model-list", "manifest.json"));
      const agentManifestAfterUpdate = await readJson(path.join(root, "agent-list", "manifest.json"));
      expect(modelManifestAfterUpdate.entries).toHaveLength(1);
      expect(agentManifestAfterUpdate.entries).toHaveLength(1);

      const deleted = await registry.deleteAgent("agent-register");
      expect(deleted).toBe(true);
      state = registry.getState();
      expect(state.agents).toHaveLength(0);
      expect(state.modelLibraryAgents).toHaveLength(0);
      expect(state.modelLibraryEntries).toEqual([]);
      expect(state.models).toHaveLength(1);

      const missing = await registry.deleteAgent("agent-register");
      expect(missing).toBe(false);
      const agentManifestAfterDelete = await readJson(path.join(root, "agent-list", "manifest.json"));
      expect(agentManifestAfterDelete.entries).toHaveLength(0);
    });
  });

  it("returns singleton registry via getAgentConfigRegistry", () => {
    const singletonA = getAgentConfigRegistry();
    const singletonB = getAgentConfigRegistry({ rootPath: "/tmp/should-ignore" });

    expect(singletonA).toBe(singletonB);
    expect(singletonA.rootPath).toBe(agentConfigPaths.rootPath);
  });
});
