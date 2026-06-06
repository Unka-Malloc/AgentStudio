import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

let executeConsoleDomainOperation;

beforeAll(async () => {
  ({ executeConsoleDomainOperation } = await import(
    "../../../server/platform/specialized/console/console-domain-operation-executor.mjs"
  ));
});

beforeEach(() => {
  vi.clearAllMocks();
});

async function withTempDir(testCase) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pact-console-focused-"));
  try {
    return await testCase(root);
  } finally {
    await fs.rm(root, { force: true, recursive: true });
  }
}

function createAgentRuntimeHarness(initialModels = []) {
  let models = initialModels.map((model) => ({ ...model }));
  const clone = (model) => ({ ...model });
  const registry = {
    refresh: vi.fn(async ({ settingsFallback = {} } = {}) => {
      if (Array.isArray(settingsFallback.modelLibraryAgents) && settingsFallback.modelLibraryAgents.length > 0) {
        models = settingsFallback.modelLibraryAgents.map(clone);
      }
    }),
    replaceFromModelLibraryAgents: vi.fn(async (nextModels = []) => {
      models = nextModels.map(clone);
    }),
    getModelLibraryEntries: vi.fn(() => [...new Set(models.map((model) => String(model.provider || "").trim()).filter(Boolean))]),
    getModelLibraryAgents: vi.fn((options = {}) =>
      models.map((model) => {
        if (!options.redactSecrets) {
          return { ...model };
        }
        const { apiKey: _apiKey, token: _token, ...redacted } = model;
        return {
          ...redacted,
          apiKeyConfigured: Boolean(model.apiKey || model.token)
        };
      }))
  };
  const provider = {
    getAgentConfigRegistry: vi.fn(() => registry),
    publicAgentGatewayRegistry: vi.fn(async () => ({
      version: "test-registry",
      agents: models.map((model, index) => ({
        alias: model.uid || model.alias || model.model || `agent-${index + 1}`,
        provider: model.provider,
        model: model.model,
        label: model.label || model.agentName || ""
      }))
    }))
  };
  return {
    provider,
    registry,
    getModels: () => models.map(clone)
  };
}

describe("console-domain executor focused coverage", () => {
  it("normalizes knowledge search response profiles and workspace context before dispatch", async () => {
    const search = vi.fn(async (payload) => ({ ok: true, payload }));
    const prepareHierarchyReasoning = vi.fn(async (payload) => ({ ok: true, payload }));
    const agentWorkspace = {
      getWorkspaceContext: vi.fn(() => ({
        workspaceId: "ws-search",
        contextProfileId: "ctx-search",
        modelAlias: "workspace-model",
        toolGrantId: "grant-search",
        knowledgeSourceIds: ["source-a", "source-b"]
      }))
    };
    const context = {
      agentWorkspace,
      runtime: {
        mounts: {
          knowledgeBase: {
            enabled: true,
            search,
            prepareHierarchyReasoning
          }
        }
      }
    };

    const consoleResult = await executeConsoleDomainOperation({
      operationId: "knowledge.search",
      input: {
        query: "alpha",
        workspaceId: "ws-search",
        responseProfile: "management-console",
        hierarchyReasoning: true
      },
      context
    });

    expect(consoleResult.status).toBe(200);
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "alpha",
        responseProfile: "console",
        requestSurface: "console",
        machineReadable: false,
        agentMessage: false
      })
    );
    expect(prepareHierarchyReasoning).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "alpha",
        sourceIds: ["source-a", "source-b"],
        limit: 20,
        modelEnabled: false
      })
    );
    expect(agentWorkspace.getWorkspaceContext).toHaveBeenCalledWith(
      "ws-search",
      expect.objectContaining({
        actorUserId: "",
        canAccessAll: true,
        sharingMode: "team-shared"
      })
    );

    await executeConsoleDomainOperation({
      operationId: "knowledge.search",
      input: {
        query: "beta",
        workspaceId: "ws-search",
        agentMessage: false
      },
      context: {
        ...context,
        authSession: {
          user: {
            userId: "u-1",
            username: "alice",
            roleId: "tool-grant"
          }
        }
      }
    });

    expect(search).toHaveBeenLastCalledWith(
      expect.objectContaining({
        query: "beta",
        responseProfile: "agent",
        requestSurface: "agent",
        machineReadable: false,
        agentMessage: false
      })
    );

    await executeConsoleDomainOperation({
      operationId: "knowledge.search",
      input: {
        query: "gamma",
        workspaceId: "ws-search",
        responseProfile: "rpc"
      },
      context
    });

    expect(search).toHaveBeenLastCalledWith(
      expect.objectContaining({
        query: "gamma",
        responseProfile: "api",
        requestSurface: "api"
      })
    );
  });

  it("restores checkpoint file snapshots from entries and files fallbacks", async () => {
    await withTempDir(async (userDataPath) => {
      const restoreWorkspaceFiles = vi.fn(async (payload) => ({
        ok: true,
        workspaceId: payload.workspaceId,
        dryRun: payload.dryRun,
        files: payload.snapshot.files,
        basePath: payload.snapshot.basePath,
        deleteExtraneous: payload.snapshot.deleteExtraneous
      }));
      const checkpointTreeApi = {
        previewCheckpointRestore: vi
          .fn()
          .mockResolvedValueOnce({
            actions: [{ action: "preview-marker" }],
            target: {
              metadata: {
                workspaceFileSnapshot: {
                  entries: [{ path: "entry.md", content: "entry" }],
                  rootPath: "/restore/root"
                }
              }
            }
          })
          .mockResolvedValueOnce({
            actions: [{ action: "restore-marker" }],
            target: {
              metadata: {
                workspaceFileSnapshot: {
                  workspaceId: "ws-restore",
                  rootPath: "/restore/root-2"
                }
              }
            }
          }),
        restoreCheckpointTree: vi.fn(async () => ({
          ok: true,
          actions: [{ action: "checkpoint-restored" }]
        }))
      };
      const context = {
        userDataPath,
        authSession: {
          user: {
            userId: "u-restore",
            username: "restorer"
          }
        },
        checkpointTreeApi,
        agentWorkspace: {
          restoreWorkspaceFiles
        }
      };

      const previewResult = await executeConsoleDomainOperation({
        operationId: "workspace.checkpoint.restore.preview",
        input: {
          treeId: "tree-1",
          nodeId: "node-1",
          workspaceId: "ws-preview",
          files: [{ path: "fallback.md", content: "input" }],
          deleteExtraneous: true
        },
        context
      });

      expect(previewResult).toMatchObject({
        status: 200,
        payload: {
          ok: true,
          workspaceFileRestore: {
            ok: true,
            workspaceId: "ws-preview",
            dryRun: true,
            basePath: "/restore/root",
            deleteExtraneous: true
          }
        }
      });
      expect(restoreWorkspaceFiles).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: "ws-preview",
          dryRun: true,
          snapshot: expect.objectContaining({
            files: [{ path: "entry.md", content: "entry" }],
            basePath: "/restore/root",
            deleteExtraneous: true
          }),
          actor: "restorer"
        })
      );

      const restoreResult = await executeConsoleDomainOperation({
        operationId: "workspace.checkpoint.restore",
        input: {
          treeId: "tree-1",
          nodeId: "node-1",
          files: [{ path: "input.md", content: "restore" }],
          reason: "apply"
        },
        context
      });

      expect(restoreResult).toMatchObject({
        status: 200,
        payload: {
          ok: true,
          workspaceFileRestore: {
            ok: true,
            workspaceId: "ws-restore",
            dryRun: false,
            basePath: "/restore/root-2"
          }
        }
      });
      expect(checkpointTreeApi.restoreCheckpointTree).toHaveBeenCalledWith(
        expect.objectContaining({
          actor: "restorer",
          reason: "apply"
        })
      );
      expect(restoreWorkspaceFiles).toHaveBeenLastCalledWith(
        expect.objectContaining({
          workspaceId: "ws-restore",
          dryRun: false,
          snapshot: expect.objectContaining({
            files: [{ path: "input.md", content: "restore" }],
            basePath: "/restore/root-2"
          })
        })
      );
    });
  });

  it("normalizes agent payloads and audits model-library diffs without stable ids", async () => {
    await withTempDir(async (userDataPath) => {
      const { provider, registry, getModels } = createAgentRuntimeHarness([
        {
          provider: "deepseek",
          model: "deepseek-chat",
          label: "Seed Agent",
          agentName: "Seed Agent"
        }
      ]);
      const context = {
        userDataPath,
        agentRuntimeProvider: provider,
        protocolEventBus: {
          publish: vi.fn(async () => ({ id: "evt-1", topic: "settings.current" }))
        },
        appendConsoleOperationLog: vi.fn(),
        authSession: {
          user: {
            userId: "u-1",
            username: "alice"
          }
        },
        moduleManagement: {
          refreshMounts: vi.fn(async () => ({ ok: true }))
        }
      };

      const createResult = await executeConsoleDomainOperation({
        operationId: "agents.create",
        input: {
          provider: "deepseek",
          model: "deepseek-reasoner",
          label: "Created Agent",
          parameters: {
            retries: 3
          },
          pluginList: ["alpha", "", "beta"]
        },
        context
      });

      expect(createResult.status).toBe(200);
      expect(getModels()[0]).toMatchObject({
        provider: "deepseek",
        model: "deepseek-reasoner",
        label: "Created Agent",
        parameters: {
          retries: 3
        },
        pluginList: ["alpha", "beta"]
      });

      const createdAgentId = createResult.payload.agentId;
      const updateResult = await executeConsoleDomainOperation({
        operationId: "agents.update",
        input: {
          agentId: createdAgentId,
          label: "Updated Agent",
          parametersText: null,
          plugins: 42
        },
        context
      });

      expect(updateResult.status).toBe(200);
      expect(getModels()[0]).toMatchObject({
        uid: createdAgentId,
        label: "Updated Agent",
        parameters: {}
      });

      const settingsResult = await executeConsoleDomainOperation({
        operationId: "settings.set",
        input: {
          modelLibraryAgents: [
            {
              provider: "deepseek",
              model: "deepseek-chat",
              label: "Alpha"
            },
            {
              provider: "custom-http",
              model: "custom-model",
              label: "Beta"
            }
          ]
        },
        context
      });

      expect(settingsResult.status).toBe(200);
      expect(registry.replaceFromModelLibraryAgents).toHaveBeenCalledWith([
        expect.objectContaining({
          provider: "deepseek",
          model: "deepseek-chat"
        }),
        expect.objectContaining({
          provider: "custom-http",
          model: "custom-model"
        })
      ]);
      expect(context.protocolEventBus.publish).toHaveBeenCalledWith(
        "settings.current",
        expect.objectContaining({
          modelLibraryAgents: expect.arrayContaining([
            expect.objectContaining({
              provider: "deepseek",
              model: "deepseek-chat"
            }),
            expect.objectContaining({
              provider: "custom-http",
              model: "custom-model"
            })
          ])
        }),
        { type: "settings.updated" }
      );
      expect(context.appendConsoleOperationLog).toHaveBeenCalledWith(
        expect.objectContaining({
          operationId: "settings.model_library.save"
        })
      );
    });
  });
});
