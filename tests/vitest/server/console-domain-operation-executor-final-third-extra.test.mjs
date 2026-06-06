import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const syncPolicyMock = vi.hoisted(() => ({
  loadAgentSyncConfig: vi.fn(async () => ({ enabled: true, topics: [] })),
  saveAgentSyncConfig: vi.fn(async () => ({ enabled: true, topics: [] })),
  normalizeAgentSyncTopic: vi.fn((value) => String(value || "").trim()),
  filterRequestedSubscriptionTopics: vi.fn((_, requestedTopics = []) => {
    const requested = [...new Set((requestedTopics || []).map((topic) => String(topic || "").trim()).filter(Boolean))];
    return { denyAll: false, requested, topics: requested };
  }),
  filterAgentSyncSubscriptionResult: vi.fn((_, result = {}) => result),
  publishAgentSyncEvent: vi.fn(async () => ({ ok: false, status: 503, error: "agent_sync not configured" }))
}));

vi.mock("../../../server/protocols/agent-sync/policy.mjs", () => syncPolicyMock);

let executeConsoleDomainOperation;

beforeAll(async () => {
  ({ executeConsoleDomainOperation } = await import(
    "../../../server/platform/specialized/console/console-domain-operation-executor.mjs"
  ));
});

beforeEach(() => {
  vi.clearAllMocks();
  syncPolicyMock.loadAgentSyncConfig.mockResolvedValue({ enabled: true, topics: [] });
  syncPolicyMock.filterRequestedSubscriptionTopics.mockImplementation((_, requestedTopics = []) => {
    const requested = [...new Set((requestedTopics || []).map((topic) => String(topic || "").trim()).filter(Boolean))];
    return { denyAll: false, requested, topics: requested };
  });
  syncPolicyMock.filterAgentSyncSubscriptionResult.mockImplementation((_, result = {}) => result);
  syncPolicyMock.publishAgentSyncEvent.mockResolvedValue({ ok: false, status: 503, error: "agent_sync not configured" });
});

async function withTempDir(testCase) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pact-console-domain-sync-third-"));
  try {
    return await testCase(root);
  } finally {
    await fs.rm(root, { force: true, recursive: true });
  }
}

async function runOperation(operationId, { input = {}, context = {} } = {}) {
  return executeConsoleDomainOperation({ operationId, input, context });
}

describe("console-domain operation edge complements", () => {
  it("covers tool-grant response profile and session workspace context for knowledge search", async () => {
    await withTempDir(async (userDataPath) => {
      const knowledgeCore = {
        search: vi.fn(async () => ({ items: [{ evidenceId: "e-1" }] }))
      };
      const sessionContext = {
        sessionId: "session-1",
        workspaceId: "ws-session",
        contextProfileId: "ctx-session",
        modelAlias: "session-model",
        toolGrantId: "tool-grant-1",
        knowledgeSourceIds: ["source-session"]
      };
      const context = {
        userDataPath,
        runtime: { mounts: { knowledgeBase: knowledgeCore } },
        agentWorkspace: {
          getSessionContext: vi.fn((sessionId) => (sessionId === "session-1" ? sessionContext : null)),
          getWorkspaceContext: vi.fn()
        },
        authSession: { user: { userId: "u-1", username: "alice", roleId: "tool-grant" } }
      };

      const result = await runOperation("knowledge.search", {
        input: { query: "tool grant query", agentSessionId: "session-1" },
        context
      });

      expect(result).toMatchObject({
        status: 200,
        payload: {
          items: [{ evidenceId: "e-1" }],
          workspaceContext: {
            workspaceId: "ws-session",
            contextProfileId: "ctx-session",
            modelAlias: "session-model",
            toolGrantId: "tool-grant-1"
          }
        }
      });
      expect(knowledgeCore.search).toHaveBeenCalledWith(expect.objectContaining({
        query: "tool grant query",
        responseProfile: "agent",
        scopeSourceIds: ["source-session"]
      }));
      expect(context.agentWorkspace.getSessionContext).toHaveBeenCalledWith("session-1", {
        actorUserId: "u-1",
        canAccessAll: true,
        sharingMode: "team-shared"
      });
    });
  });

  it("parses string plugin list and stringified parameters when creating model entries", async () => {
    await withTempDir(async (userDataPath) => {
      const registry = {
        refresh: vi.fn(async () => {}),
        replaceFromModelLibraryAgents: vi.fn(async () => {}),
        getModelLibraryEntries: vi.fn(() => ["deepseek"]),
        getModelLibraryAgents: vi.fn(() => [{
          uid: "created-agent",
          provider: "deepseek",
          model: "deepseek-reasoner",
          label: "Created Agent"
        }])
      };
      const provider = {
        getAgentConfigRegistry: vi.fn(() => registry),
        publicAgentGatewayConfig: vi.fn(async () => ({})),
        publicAgentGatewayRegistry: vi.fn(async () => ({ version: "registry-v1", agents: [] })),
        probeModelConnection: vi.fn(async ({ provider, modelAlias }) => ({ ok: true, provider, model: modelAlias })),
        callAgentGateway: vi.fn(async ({ input }) => ({ ok: true, echoed: input.prompt || "" }))
      };

      const result = await runOperation("agents.create", {
        input: {
          provider: "deepseek",
          model: "deepseek-reasoner",
          label: "Created Agent",
          pluginList: "alpha, beta",
          parametersText: JSON.stringify({ timeoutMs: 12 })
        },
        context: {
          userDataPath,
          agentRuntimeProvider: provider,
          protocolEventBus: { publish: vi.fn(() => ({ id: "evt", topic: "settings.current" })) },
          appendConsoleOperationLog: vi.fn()
        }
      });

      expect(result).toMatchObject({ status: 200, payload: { ok: true, action: "created" } });
      const [nextModels] = registry.replaceFromModelLibraryAgents.mock.calls[0];
      expect(nextModels[0]).toMatchObject({
        provider: "deepseek",
        model: "deepseek-reasoner",
        label: "Created Agent",
        pluginList: ["alpha", "beta"],
        parameters: { timeoutMs: 12 }
      });
    });
  });

  it("covers checkpoint restore preview missing workspaceId and restore missing provider branches", async () => {
    await withTempDir(async (userDataPath) => {
      const previewWithoutWorkspaceId = {
        target: {
          metadata: {
            workspaceFileSnapshot: {
              files: [{ path: "notes.md", content: "draft" }]
            }
          }
        }
      };
      const contextWithoutWorkspace = {
        userDataPath,
        checkpointTreeApi: {
          previewCheckpointRestore: vi.fn(async () => previewWithoutWorkspaceId)
        }
      };

      const previewResult = await runOperation("workspace.checkpoint.restore.preview", {
        input: { treeId: "tree-1" },
        context: contextWithoutWorkspace
      });
      expect(previewResult).toMatchObject({
        status: 400,
        payload: { error: "checkpoint 文件快照缺少 workspaceId。" }
      });

      const restoreContext = {
        userDataPath,
        agentWorkspace: {},
        checkpointTreeApi: {
          previewCheckpointRestore: vi.fn(async () => ({
            target: {
              metadata: {
                workspaceFileSnapshot: {
                  workspaceId: "ws-1",
                  files: [{ path: "notes.md", content: "draft" }]
                }
              }
            }
          })),
          restoreCheckpointTree: vi.fn(async () => ({ ok: true, actions: [] }))
        }
      };

      const restoreResult = await runOperation("workspace.checkpoint.restore", {
        input: { treeId: "tree-1" },
        context: restoreContext
      });
      expect(restoreResult).toMatchObject({
        status: 503,
        payload: { error: "工作空间文件恢复接口不可用。" }
      });
      expect(restoreContext.checkpointTreeApi.restoreCheckpointTree).not.toHaveBeenCalled();
    });
  });

  it("returns null governance/permission events when protocol bus is absent during upsert", async () => {
    const result = await runOperation("authorization.roles.upsert", {
      input: { roleId: "role-1", displayName: "Role 1" },
      context: {
        authSession: { user: { userId: "u-1", username: "alice" } },
        securityPermissions: {
          upsertGovernanceRole: vi.fn((role) => role),
          getGovernancePolicyRevision: vi.fn(() => 19)
        }
      }
    });

    expect(result).toMatchObject({
      status: 200,
      payload: {
        ok: true,
        role: { roleId: "role-1", displayName: "Role 1" },
        policyRevision: 19,
        events: {
          governance: null,
          permissions: null
        }
      }
    });
  });

  it("covers agent_sync publish failure and subscription denyAll policy branches", async () => {
    syncPolicyMock.publishAgentSyncEvent.mockResolvedValue({ ok: false, status: 422, error: "policy blocked" });
    syncPolicyMock.filterRequestedSubscriptionTopics.mockReturnValueOnce({
      requested: ["agent.sync.answer"],
      topics: [],
      denyAll: true
    });

    const toolContext = {
      toolSkillManagementProvider: {
        authorizeRequest: vi.fn(async () => ({ ok: true, grant: { id: "grant-1" } }))
      }
    };

    await expect(runOperation("agent_sync.publish", {
      input: { topic: "answer", payload: { text: "hi" } },
      context: { ...toolContext, agentSyncFeatureActive: true }
    })).resolves.toMatchObject({
      status: 422,
      payload: { error: "policy blocked" }
    });

    await expect(runOperation("agent_sync.subscribe", {
      input: { topics: ["answer"] },
      context: {
        ...toolContext,
        agentSyncFeatureActive: true,
        protocolEventBus: { subscribe: vi.fn() }
      }
    })).resolves.toMatchObject({
      status: 200,
      payload: {
        events: [],
        snapshots: undefined,
        requestedTopics: ["agent.sync.answer"],
        topics: []
      }
    });
  });

  it("covers agent-sync feature inactive fallback policy and publish fallback error", async () => {
    await withTempDir(async (userDataPath) => {
      const context = { userDataPath, agentSyncFeatureActive: false };
      await expect(runOperation("agent_sync.config.get", { context }))
        .resolves.toMatchObject({ status: 200, payload: { config: { topics: [] } } });

      await expect(runOperation("agent_sync.config.set", {
        input: { topics: [{ topic: "agent.sync.answer", enabled: true }] },
        context
      })).resolves.toMatchObject({
        status: 200,
        payload: {
          config: { topics: [] }
        }
      });

      await expect(runOperation("agent_sync.publish", {
        input: { topic: "answer", payload: { text: "offline" } },
        context: {
          ...context,
          toolSkillManagementProvider: {
            authorizeRequest: vi.fn(async () => ({ ok: true, grant: { id: "grant-1" } }))
          }
        }
      })).resolves.toMatchObject({
        status: 404,
        payload: { error: "agent_sync feature is not active in this feature edition." }
      });
    });
  });

  it("covers checkpoint restore file-write branch and propagate non-OK file restore result", async () => {
    await withTempDir(async (userDataPath) => {
      const previewFailure = {
        ok: false,
        status: 409,
        error: "workspace restore denied"
      };
      const context = {
        userDataPath,
        agentWorkspace: {
          restoreWorkspaceFiles: vi.fn(async () => previewFailure)
        },
        checkpointTreeApi: {
          previewCheckpointRestore: vi.fn(async () => ({
            target: {
              metadata: {
                workspaceFileSnapshot: {
                  workspaceId: "ws-restore",
                  files: [{ path: "notes.md", content: "draft" }]
                }
              }
            }
          })),
          restoreCheckpointTree: vi.fn(async () => ({ ok: true, actions: [] }))
        }
      };

      const previewResult = await runOperation("workspace.checkpoint.restore.preview", {
        input: { treeId: "tree-1" },
        context
      });
      expect(previewResult).toMatchObject({
        status: 409,
        payload: {
          ok: false,
          error: "workspace restore denied"
        }
      });
      expect(context.agentWorkspace.restoreWorkspaceFiles).toHaveBeenCalled();

      const restoreResult = await runOperation("workspace.checkpoint.restore", {
        input: { treeId: "tree-1" },
        context
      });
      expect(restoreResult).toMatchObject({
        status: 409,
        payload: {
          ok: false,
          error: "workspace restore denied"
        }
      });
      expect(context.checkpointTreeApi.restoreCheckpointTree).not.toHaveBeenCalled();
      expect(context.agentWorkspace.restoreWorkspaceFiles).toHaveBeenCalledTimes(2);
    });
  });

  it("maps sessionThreadId alias through workspace context for agent gateway calls", async () => {
    const registry = {
      refresh: vi.fn(async () => {}),
      getModelLibraryEntries: vi.fn(() => ["deepseek"]),
      getModelLibraryAgents: vi.fn(() => [])
    };
    const provider = {
      getAgentConfigRegistry: vi.fn(() => registry),
      callAgentGateway: vi.fn(async ({ settings, input }) => ({ ok: true, settingsFromCall: settings, prompt: input.prompt }))
    };
    const sessionContext = {
      sessionId: "thread-1",
      workspaceId: "ws-session",
      contextProfileId: "ctx-1",
      modelAlias: "model-1",
      toolGrantId: "tool-grant-1",
      knowledgeSourceIds: ["k-1"]
    };

    await withTempDir(async (userDataPath) => {
      const context = {
        userDataPath,
        agentWorkspace: {
          getSessionContext: vi.fn((sessionId) => (sessionId === "thread-1" ? sessionContext : null))
        },
        agentRuntimeProvider: provider,
        authSession: { user: { userId: "u-1", username: "alice" } }
      };

      await expect(runOperation("agent_gateway.call", {
        input: { prompt: "hello", session_thread_id: "thread-1" },
        context
      })).resolves.toMatchObject({
        status: 200,
        payload: {
          ok: true,
          workspaceContext: {
            sessionId: "thread-1",
            workspaceId: "ws-session",
            contextProfileId: "ctx-1",
            modelAlias: "model-1",
            knowledgeSourceIds: ["k-1"]
          }
        }
      });
      expect(context.agentWorkspace.getSessionContext).toHaveBeenCalledWith(
        "thread-1",
        expect.objectContaining({ actorUserId: "u-1" })
      );
      expect(provider.callAgentGateway).toHaveBeenCalledWith(expect.objectContaining({
        input: expect.objectContaining({
          session_thread_id: "thread-1",
          workspaceId: "ws-session",
          contextProfileId: "ctx-1",
          modelAlias: "model-1",
          toolGrantId: "tool-grant-1",
          scopeSourceIds: ["k-1"]
        })
      }));

      const missingSessionContext = await runOperation("agent_gateway.call", {
        input: { prompt: "hello", session_thread_id: "missing" },
        context: {
          ...context,
          agentWorkspace: {
            getSessionContext: vi.fn(() => null)
          },
          userDataPath
        }
      });
      expect(missingSessionContext).toMatchObject({
        status: 404,
        payload: { error: "会话线程不存在或不可访问。" }
      });
    });
  });

  it("routes generic tool_management operations through passthrough dispatch", async () => {
    const handle = vi.fn(async () => true);
    const request = { method: "DELETE", headers: { "x-origin": "unit" } };
    const response = {};
    const requestBody = Buffer.from("tool-management");
    const url = new URL("https://example.local/api/tool-management/ping");

    await expect(runOperation("tool_management.health.status", {
      context: {
        toolSkillManagementProvider: { handleToolManagementHttpRequest: handle },
        request,
        response,
        requestBody,
        url
      }
    })).resolves.toMatchObject({ status: 200, payload: { __responseHandled: true } });
    expect(handle).toHaveBeenCalledWith({
      request,
      response,
      requestBody,
      url,
      method: "DELETE",
      dispatched: true
    });
  });
});
