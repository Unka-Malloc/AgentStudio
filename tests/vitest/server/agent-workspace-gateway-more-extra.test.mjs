import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAgentWorkspace
} from "../../../server/platform/specialized/agent/agent-workspace/index.mjs";
import {
  callAgentGateway,
  publicAgentGatewayConfig,
  publicAgentGatewayRegistry,
  resolveAgentGatewayConfig,
  resolveAgentGatewayRegistry
} from "../../../server/platform/specialized/agent/agent-gateway/index.mjs";

const runModelRoutingMock = vi.hoisted(() => vi.fn());

vi.mock("../../../server/platform/specialized/agent/agent-gateway/model-routing/index.mjs", async () => {
  const actual = await vi.importActual("../../../server/platform/specialized/agent/agent-gateway/model-routing/index.mjs");
  return {
    ...actual,
    runModelRouting: (...args) => runModelRoutingMock(...args)
  };
});

const tempRoots = [];
const TEXT_ENCODER = new TextEncoder();

function sha256(value = "") {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function tempDir(prefix) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

async function withWorkspaceRuntime(root, fn) {
  const runtime = createAgentWorkspace({ userDataPath: root });
  try {
    return await fn(runtime);
  } finally {
    runtime.close();
  }
}

function createJsonResponse(body, {
  status = 200,
  ok = true,
  contentType = "application/json; charset=utf-8"
} = {}) {
  const bodyText = typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok,
    status,
    headers: {
      get(key) {
        return String(key || "").toLowerCase() === "content-type" ? contentType : "";
      }
    },
    text: async () => bodyText
  };
}

function createStreamResponse(streamText, {
  status = 200,
  ok = true,
  contentType = "text/event-stream; charset=utf-8"
} = {}) {
  return {
    ok,
    status,
    headers: {
      get(key) {
        return String(key || "").toLowerCase() === "content-type" ? contentType : "";
      }
    },
    body: {
      async *[Symbol.asyncIterator]() {
        if (streamText) {
          yield TEXT_ENCODER.encode(streamText);
        }
      }
    },
    text: async () => streamText
  };
}

afterEach(async () => {
  vi.clearAllMocks();
  while (tempRoots.length) {
    const root = tempRoots.pop();
    await fs.rm(root, { recursive: true, force: true });
  }
});

beforeEach(() => {
  runModelRoutingMock.mockReset();
});

describe("agent workspace persistence and boundary coverage", () => {
  it("persists session, file, lock, profile, share, and inheritance state across reopen", async () => {
    const root = await tempDir("pact-agent-workspace-more-");

    let sourceWorkspaceId = "";
    let childWorkspaceId = "";
    let sessionId = "";

    await withWorkspaceRuntime(root, async (runtime) => {
      const source = runtime.createWorkspace({
        title: "Source Workspace",
        ownerUserId: "owner-1"
      }).workspace;
      const child = runtime.createWorkspace({
        title: "Child Workspace"
      }).workspace;

      sourceWorkspaceId = source.workspaceId;
      childWorkspaceId = child.workspaceId;

      expect(runtime.setWorkspaceParent(child.workspaceId, source.workspaceId)).toMatchObject({ ok: true });
      expect(runtime.setOwnedSourceIds(source.workspaceId, ["source-owned"])).toMatchObject({ ok: true });
      expect(runtime.setOwnedSourceIds(child.workspaceId, ["child-owned"])).toMatchObject({ ok: true });
      expect(runtime.hotSwapProfile(source.workspaceId, {
        contextProfileId: "root-profile",
        toolGrantId: "root-grant",
        modelAlias: "root-model",
        knowledgeScope: {
          includeSourceIds: ["root-include"],
          excludeSourceIds: ["root-exclude"]
        }
      })).toMatchObject({ ok: true });
      expect(runtime.hotSwapProfile(child.workspaceId, {
        modelAlias: "child-model",
        knowledgeScope: {
          includeSourceIds: ["child-include"],
          excludeSourceIds: ["child-exclude"]
        }
      })).toMatchObject({ ok: true });
      expect(runtime.shareWorkspace(source.workspaceId, child.workspaceId)).toMatchObject({ ok: true });

      const session = runtime.createSession({
        workspaceId: source.workspaceId,
        title: "Persisted Session",
        objective: "Keep this thread",
        context: {
          contextProfileId: "session-profile",
          knowledgeSourceIds: ["session-source"],
          modelAlias: "session-model",
          toolGrantId: "session-grant"
        }
      });
      expect(session.ok).toBe(true);
      sessionId = session.session.sessionId;

      expect(runtime.appendSessionEvent({
        sessionId,
        type: "session_note",
        title: "Note",
        summary: "stored",
        payload: { targetId: "artifact-1" }
      })).toMatchObject({
        event: expect.objectContaining({ type: "session_note" })
      });

      const upload = await runtime.uploadWorkspaceFile({
        workspaceId: source.workspaceId,
        path: "docs/readme.md",
        content: "hello",
        createdBy: "tester"
      });
      expect(upload.ok).toBe(true);

      const lock = runtime.acquireLock({
        workspaceId: source.workspaceId,
        targetType: "artifact",
        targetId: "artifact-1",
        ownerAgentId: "agent-a",
        ttlMs: 600000
      });
      expect(lock.ok).toBe(true);

      expect(runtime.createSessionMergeProposal({
        targetSessionId: sessionId,
        sourceSessionId: "missing-session"
      })).toMatchObject({
        ok: false,
        error: "会话不存在"
      });
    });

    await withWorkspaceRuntime(root, async (runtime) => {
      const source = runtime.getWorkspace({ workspaceId: sourceWorkspaceId });
      const child = runtime.getWorkspace({ workspaceId: childWorkspaceId });
      expect(source.workspace.workspaceId).toBe(sourceWorkspaceId);
      expect(child.workspace.workspaceId).toBe(childWorkspaceId);

      const chain = runtime.resolveWorkspaceChain(childWorkspaceId);
      expect(chain.map((item) => item.workspaceId)).toEqual([sourceWorkspaceId, childWorkspaceId]);

      const context = runtime.getWorkspaceContext(childWorkspaceId);
      expect(context).toMatchObject({
        workspaceId: childWorkspaceId,
        contextProfileId: "root-profile",
        toolGrantId: "root-grant",
        modelAlias: "child-model",
        knowledgeSourceIds: expect.arrayContaining([
          "source-owned",
          "child-owned",
          "root-include",
          "child-include"
        ])
      });

      const sessionContext = runtime.getSessionContext(sessionId);
      expect(sessionContext).toMatchObject({
        sessionId,
        sessionProtocolVersion: "pact.agent-session-thread.v1",
        sessionContext: expect.objectContaining({
          contextProfileId: "session-profile",
          knowledgeSourceIds: ["session-source"]
        }),
        knowledgeSourceIds: ["session-source"],
        modelAlias: "session-model",
        toolGrantId: "session-grant"
      });

      const files = await runtime.listWorkspaceFiles({
        workspaceId: sourceWorkspaceId,
        folderPath: "docs",
        recursive: true,
        includeHash: true
      });
      expect(files.ok).toBe(true);
      expect(files.paths).toContain("docs/readme.md");

      const locks = runtime.listLocks({ workspaceId: sourceWorkspaceId });
      expect(locks).toHaveLength(1);
      expect(locks[0]).toMatchObject({
        targetType: "artifact",
        targetId: "artifact-1",
        ownerAgentId: "agent-a"
      });

      expect(runtime.acquireLock({
        workspaceId: sourceWorkspaceId,
        targetType: "artifact",
        targetId: "artifact-1"
      })).toMatchObject({
        ok: false,
        error: "missing_lock_fields"
      });
      expect(runtime.acquireLock({
        workspaceId: sourceWorkspaceId,
        targetType: "artifact",
        targetId: "artifact-1",
        ownerAgentId: "agent-b"
      })).toMatchObject({
        ok: false,
        error: "lock_held"
      });
      expect(runtime.releaseLock({
        workspaceId: sourceWorkspaceId,
        targetType: "artifact",
        targetId: "artifact-1",
        ownerAgentId: "agent-b"
      })).toMatchObject({
        ok: false,
        error: "lock_owner_mismatch"
      });

      expect(runtime.createSessionMergeProposal({
        targetSessionId: sessionId,
        sourceSessionId: "missing-session"
      })).toMatchObject({
        ok: false,
        error: "会话不存在"
      });

      expect(await runtime.workspaceFileMetadata({
        workspaceId: sourceWorkspaceId,
        path: "../escape"
      })).toMatchObject({
        ok: false,
        status: 400,
        error: "路径不能跳出工作空间。"
      });
      expect(await runtime.downloadWorkspaceFile({
        workspaceId: sourceWorkspaceId,
        path: "docs"
      })).toMatchObject({
        ok: false,
        status: 400,
        error: "目标路径不是文件。"
      });
      expect(await runtime.writeWorkspaceFile({
        workspaceId: sourceWorkspaceId,
        path: "docs/missing.txt",
        content: "x"
      })).toMatchObject({
        ok: false,
        status: 404,
        error: "文件不存在。"
      });
      expect(await runtime.patchWorkspaceFile({
        workspaceId: sourceWorkspaceId,
        path: "docs/readme.md",
        expectedSha256: sha256("hello"),
        hunks: [{ oldText: "hello", newText: "hello" }]
      })).toMatchObject({
        ok: false,
        status: 409,
        error: "patch 未改变文件内容。"
      });
      expect(await runtime.deleteWorkspaceFile({
        workspaceId: sourceWorkspaceId,
        path: "docs/missing.txt"
      })).toMatchObject({
        ok: false,
        status: 404,
        error: "文件不存在。"
      });
      expect(await runtime.moveWorkspaceFile({
        workspaceId: sourceWorkspaceId,
        sourcePath: "",
        targetPath: "docs/renamed.md"
      })).toMatchObject({
        ok: false,
        status: 400,
        error: "sourcePath (from) 不能为空。"
      });
      expect(runtime.createSession({
        workspaceId: "missing-workspace",
        title: "bad"
      })).toMatchObject({
        ok: false,
        error: "工作空间不存在"
      });
      expect(await runtime.adminReleaseLock({
        workspaceId: sourceWorkspaceId,
        targetType: "artifact",
        targetId: "artifact-1"
      })).toMatchObject({
        ok: true,
        released: true
      });
      expect(runtime.listLocks({ workspaceId: sourceWorkspaceId })).toHaveLength(0);
    });
  });
});

describe("agent gateway registry, config, call, and routing coverage", () => {
  it("resolves registry/config fallbacks and rejects openrouter without an API key", async () => {
    const settings = {
      customHttpAdapter: {
        uid: "primary-http",
        model: "gateway-lite",
        url: "https://gateway.local/call",
        token: "gateway-token"
      },
      customHttpAdapters: [
        {
          uid: "ignored-duplicate",
          alias: "primary-http",
          url: "https://gateway.local/duplicate",
          token: "ignored"
        },
        {
          uid: "backup-http",
          model: "gateway-backup",
          url: "https://gateway.local/backup",
          token: "backup-token"
        }
      ],
      modelLibraryAgents: [
        {
          provider: "deepseek",
          alias: "deepseek-route",
          model: "deepseek-v4-pro",
          baseUrl: "https://deepseek.example",
          apiKey: "deep-token"
        },
        {
          provider: "local-model",
          alias: "local-qwen",
          model: "qwen2.5",
          baseUrl: "http://localhost:11434/v1",
          token: "local-token"
        },
        {
          provider: "openrouter",
          alias: "openrouter-route",
          model: "gpt-4o-mini",
          baseUrl: "https://openrouter.example"
        },
        {
          provider: "ignored-provider",
          alias: "ignored",
          model: ""
        }
      ]
    };

    const registry = resolveAgentGatewayRegistry(settings);
    expect(registry).toEqual(expect.arrayContaining([
      expect.objectContaining({
        alias: "primary-http",
        provider: "custom-http",
        model: "gateway-lite"
      }),
      expect.objectContaining({
        alias: "backup-http",
        provider: "custom-http",
        model: "gateway-backup"
      }),
      expect.objectContaining({
        alias: "deepseek-route",
        provider: "deepseek",
        model: "deepseek-v4-pro"
      }),
      expect.objectContaining({
        alias: "local-qwen",
        provider: "local-model",
        model: "qwen2.5"
      }),
      expect.objectContaining({
        alias: "openrouter-route",
        provider: "openrouter",
        model: "gpt-4o-mini"
      })
    ]));

    expect(publicAgentGatewayRegistry(settings)).toMatchObject({
      schemaVersion: 1,
      provider: "agent-gateway",
      defaultAlias: "primary-http"
    });
    expect(publicAgentGatewayConfig(settings)).toMatchObject({
      alias: "primary-http",
      provider: "custom-http",
      token: ""
    });
    expect(resolveAgentGatewayConfig(settings, { provider: "local-model" })).toMatchObject({
      provider: "local-model",
      alias: "local-qwen"
    });
    expect(resolveAgentGatewayConfig(settings, { alias: "deepseek" })).toMatchObject({
      provider: "deepseek",
      alias: "deepseek"
    });
    expect(resolveAgentGatewayConfig({}, { alias: "standalone" })).toMatchObject({
      provider: "custom-http",
      alias: "standalone"
    });

    const fetchImpl = vi.fn();
    await expect(callAgentGateway({
      settings,
      input: {
        provider: "openrouter",
        alias: "openrouter-route",
        question: "should fail before fetch"
      },
      fetchImpl
    })).rejects.toThrow("OpenRouter gpt-4o-mini API Key 未配置。");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("routes deepseek calls through model routing and exercises local-model request shaping", async () => {
    const root = await tempDir("pact-agent-gateway-more-");
    const fetchCalls = [];

    const settings = {
      customHttpAdapter: {
        uid: "primary-http",
        model: "gateway-lite",
        url: "https://gateway.local/call",
        token: "gateway-token"
      },
      modelLibraryAgents: [
        {
          provider: "deepseek",
          alias: "deepseek-route",
          model: "deepseek-v4-pro",
          baseUrl: "https://deepseek.example",
          apiKey: "deep-token",
          systemPrompt: "DeepSeek system prompt"
        },
        {
          provider: "local-model",
          alias: "local-qwen",
          model: "qwen2.5",
          baseUrl: "http://localhost:11434/v1",
          token: "local-token",
          systemPrompt: "Local system prompt"
        }
      ],
      modelRouting: {
        enabled: true,
        fallbackChain: ["deepseek-route"]
      }
    };

    runModelRoutingMock.mockImplementation(async (routingInput) => {
      const dryRun = await routingInput.executeCandidate({
        input: {
          ...routingInput.input,
          alias: "deepseek-route",
          provider: "deepseek",
          question: "路由后的深度请求",
          messages: [{ role: "user", content: "路由后的深度请求" }],
          stream: true
        },
        dryRun: true
      });
      const executed = await routingInput.executeCandidate({
        input: {
          ...routingInput.input,
          alias: "deepseek-route",
          provider: "deepseek",
          question: "路由后的深度请求",
          messages: [{ role: "user", content: "路由后的深度请求" }],
          stream: true
        },
        dryRun: false
      });
      return {
        routing: {
          protocolVersion: "pact.model-routing.v1",
          routeId: "route-deepseek",
          selectedAlias: dryRun.config.alias,
          fallbackUsed: false
        },
        result: executed.result
      };
    });

    const fetchImpl = vi.fn(async (url, request) => {
      fetchCalls.push({ url, request });
      if (String(url).includes("deepseek.example")) {
        return createStreamResponse([
          'data: {"id":"deep-1","model":"deepseek-v4-pro","choices":[{"index":0,"delta":{"reasoning_content":"思路:"}}]}',
          'data: {"id":"deep-1","model":"deepseek-v4-pro","choices":[{"index":0,"delta":{"content":"深度"}}]}',
          'data: {"id":"deep-1","model":"deepseek-v4-pro","choices":[{"index":0,"delta":{"content":"回答","tool_calls":[{"index":0,"id":"tool-1","type":"function","function":{"name":"lookup","arguments":"{\\"q\\":\\"x\\"}"}}]}}]}',
          "data: [DONE]"
        ].join("\n"));
      }
      return createJsonResponse({
        answer: "local-model reply",
        dialogId: "local-1",
        finish: true,
        payload: { echoed: true }
      });
    });

    const routed = await callAgentGateway({
      settings,
      input: {
        alias: "deepseek-route",
        provider: "deepseek",
        question: "路由后的深度请求",
        sessionId: "session-1",
        userId: "user-1",
        projectId: "project-1"
      },
      fetchImpl,
      userDataPath: root
    });
    expect(routed).toMatchObject({
      ok: true,
      answer: "深度回答",
      modelRouting: {
        protocolVersion: "pact.model-routing.v1",
        routeId: "route-deepseek",
        selectedAlias: "deepseek-route"
      }
    });
    expect(fetchCalls[0].url).toBe("https://deepseek.example/chat/completions");
    expect(fetchCalls[0].request.headers).toMatchObject({
      Authorization: "Bearer deep-token"
    });
    expect(JSON.parse(fetchCalls[0].request.body)).toMatchObject({
      model: "deepseek-v4-pro",
      stream: true,
      messages: [
        { role: "system", content: "DeepSeek system prompt" },
        { role: "user", content: "路由后的深度请求" }
      ]
    });
    expect(routed.toolCalls).toEqual([
      expect.objectContaining({
        id: "tool-1",
        function: expect.objectContaining({
          name: "lookup"
        })
      })
    ]);

    const local = await callAgentGateway({
      settings: {
        ...settings,
        modelRouting: undefined
      },
      input: {
        provider: "local-model",
        alias: "local-qwen",
        question: "本地模型请求",
        sessionId: "session-2",
        userId: "user-2",
        projectId: "project-2",
        parameters: {
          pact_thinking_mode: "enabled"
        }
      },
      fetchImpl,
      userDataPath: root
    });
    expect(local).toMatchObject({
      ok: true,
      upstream: {
        provider: "local-model"
      }
    });
    expect(fetchCalls[1].url).toBe("http://localhost:11434/v1/chat/completions");
    const localRequest = JSON.parse(fetchCalls[1].request.body);
    expect(localRequest).toMatchObject({
      model: "qwen2.5",
      messages: [
        { role: "system", content: "Local system prompt" },
        { role: "user", content: "本地模型请求" }
      ],
      chat_template_kwargs: {
        enable_thinking: true
      }
    });
    expect(fetchCalls[1].request.headers).toMatchObject({
      Authorization: "Bearer local-token"
    });
  });
});
