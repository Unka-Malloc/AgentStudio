import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const callAgentGatewayMock = vi.hoisted(() => vi.fn());

vi.mock("../../../server/platform/specialized/agent/agent-gateway/index.mjs", async () => {
  const actual = await vi.importActual("../../../server/platform/specialized/agent/agent-gateway/index.mjs");
  return {
    ...actual,
    callAgentGateway: callAgentGatewayMock
  };
});

import {
  AgentConfigRegistry
} from "../../../server/platform/specialized/agent/agent-configs/config-registry.mjs";
import {
  createAgentMemory
} from "../../../server/platform/specialized/agent/agent-memory/index.mjs";
import {
  probeModelConnection
} from "../../../server/platform/specialized/agent/agent-gateway/model-probe/index.mjs";

async function withTempRoot(testCase) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pact-agent-model-final-extra-2-"));
  try {
    return await testCase(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

function createGatewayResult({
  answer = "PactProbeOK",
  model = "probe-model",
  statusCode = 200,
  useChunks = false
} = {}) {
  return {
    ok: true,
    upstream: { model, status: statusCode },
    ...(useChunks ? { chunks: { answer: [answer] } } : { answer })
  };
}

describe("agent gateway, model probe, registry, and memory extras", () => {
  beforeEach(() => {
    callAgentGatewayMock.mockReset();
  });

  it("normalizes registry imports and falls back blank providers to deepseek", async () => {
    await withTempRoot(async (root) => {
      const registry = new AgentConfigRegistry({ rootPath: root });
      await registry.upsertFromModelLibraryEntry({
        uid: "legacy-entry",
        provider: "openrouter",
        model: "gpt-4o-mini",
        baseUrl: "https://legacy.example",
        apiKey: "legacy-key"
      });

      await registry.replaceFromModelLibraryAgents([
        {
          uid: "  qa alias  ",
          provider: "  ",
          model: "  local-model  ",
          baseUrl: "http://localhost:11434/v1",
          token: "mem-token",
          label: "  Local Probe  ",
          parameters: { temperature: 0.05 }
        },
        {
          uid: "router-1",
          provider: "openrouter",
          model: " gpt-4.1-mini ",
          baseUrl: " https://router.example/api/v1/ ",
          apiKey: "router-key"
        }
      ]);

      await registry.refresh({
        settingsFallback: {
          modelLibraryAgents: [
            {
              uid: "qa alias",
              provider: "",
              model: "local-model",
              baseUrl: "http://localhost:11434/v1",
              token: "mem-token",
              apiKey: "model-key",
              label: "Local Probe",
              parameters: { temperature: 0.05 }
            },
            {
              uid: "router-1",
              provider: "openrouter",
              model: "gpt-4.1-mini",
              baseUrl: "https://router.example/api/v1",
              apiKey: "router-key"
            }
          ]
        }
      });

      const state = registry.getState();
      expect(state.models).toHaveLength(2);
      expect(state.agents).toHaveLength(2);
      expect(state.modelManifest.entries).toHaveLength(2);
      expect(state.agentManifest.entries).toHaveLength(2);
      expect(state.modelLibraryEntries).toEqual(expect.arrayContaining(["deepseek", "openrouter"]));
      expect(state.modelLibraryAgents[0]).toMatchObject({
        uid: "qa alias",
        alias: "qa alias",
        provider: "deepseek",
        model: "local-model",
        label: "Local Probe",
        token: "mem-token",
        tokenConfigured: true
      });
      expect(state.modelLibraryAgents[0].parameters).toEqual({ temperature: 0.05 });
      expect(state.modelLibraryAgents[1]).toMatchObject({
        uid: "router-1",
        provider: "openrouter",
        model: "gpt-4.1-mini",
        apiKey: "router-key",
        apiKeyConfigured: true
      });
    });
  });

  it("falls back to defaultModelProvider and routes probe aliases through custom-http", async () => {
    callAgentGatewayMock.mockResolvedValue(
      createGatewayResult({
        useChunks: true,
        model: "gateway-lite",
        answer: "PactProbeOK"
      })
    );

    const result = await probeModelConnection({
      settings: {
        defaultModelProvider: "custom-http",
        modelProbeModelAlias: "probe-route",
        customHttpAdapter: {
          uid: "probe-route",
          model: "gateway-lite",
          url: "https://gateway.example/call",
          token: "gateway-token"
        }
      }
    });

    expect(result).toMatchObject({
      ok: true,
      provider: "custom-http",
      model: "probe-route",
      answerSnippet: "PactProbeOK"
    });
    expect(callAgentGatewayMock).toHaveBeenCalledTimes(1);
    expect(callAgentGatewayMock.mock.calls[0][0].input.alias).toBe("probe-route");
  });

  it("redacts probe errors from deepseek gateway failures", async () => {
    callAgentGatewayMock.mockRejectedValue(new Error("Bearer SECRET_DEEPSEEK_TOKEN while opening /Users/unka/private/tmp.json"));

    const result = await probeModelConnection({
      provider: "deepseek",
      modelAlias: "deepseek-route",
      settings: {
        deepSeekModel: "deepseek-chat",
        modelLibraryAgents: [
          {
            uid: "deepseek-route",
            provider: "deepseek",
            model: "deepseek-chat",
            apiKey: "deepseek-secret"
          }
        ]
      }
    });

    expect(result).toMatchObject({
      ok: false,
      configured: true,
      provider: "deepseek",
      model: "deepseek-chat"
    });
    expect(result.message).toContain("Bearer [REDACTED]");
    expect(result.message).not.toContain("SECRET_DEEPSEEK_TOKEN");
    expect(callAgentGatewayMock).toHaveBeenCalledTimes(1);
  });

  it("requires at least one agent memory path and rejects empty construction", () => {
    expect(() => createAgentMemory()).toThrow("agent_memory_user_data_path_required");
  });

  it("redacts stored memory, clamps list limits, and clears latest session memory", async () => {
    await withTempRoot(async (root) => {
      const memory = createAgentMemory({ userDataPath: root });

      const older = await memory.appendSessionMemory({
        sessionId: "session-1",
        profileId: "profile-1",
        sourceHash: "hash-a",
        summary: "Stored in /Users/unka/secret.md with token: abc123",
        structured: {
          apiKey: "top-secret",
          nested: {
            password: "p@ss",
            path: "/Users/unka/private/notes.txt"
          }
        },
        sourceRange: {
          filePath: "/tmp/inner.json"
        },
        createdAt: "2026-01-01T00:00:00.000Z"
      });

      const newer = await memory.appendSessionMemory({
        sessionId: "session-1",
        profileId: "profile-1",
        sourceHash: "hash-b",
        summary: "Second record",
        structured: {
          token: "another-secret"
        },
        createdAt: "2026-01-02T00:00:00.000Z"
      });

      expect(older.summary).toContain("<redacted-path>");
      expect(older.summary).toContain("token:<redacted>");
      expect(older.structured).toMatchObject({
        apiKey: "<redacted>",
        nested: {
          password: "<redacted>",
          path: "<redacted-path>"
        }
      });
      expect(older.sourceRange).toEqual({
        filePath: "<redacted-path>"
      });

      const listed = await memory.listSessionMemory({
        sessionId: "session-1",
        profileId: "profile-1",
        limit: -1
      });

      expect(listed.protocolVersion).toBe("pact.agent-memory.v1");
      expect(listed.records).toHaveLength(1);
      expect(listed.records[0].memoryId).toBe(newer.memoryId);

      const latest = await memory.latestSessionMemory({
        sessionId: "session-1",
        profileId: "profile-1",
        sourceHash: "hash-a"
      });
      expect(latest?.memoryId).toBe(older.memoryId);

      const cleared = await memory.clearSessionMemory({
        sessionId: "session-1",
        profileId: "profile-1",
        reason: "rotate"
      });

      expect(cleared.ok).toBe(true);
      expect(cleared.record.status).toBe("cleared");

      const afterClear = await memory.latestSessionMemory({
        sessionId: "session-1",
        profileId: "profile-1"
      });
      expect(afterClear).toBeNull();
    });
  });
});
