import { afterEach, describe, expect, it, vi } from "vitest";
import { createToolSkillManagementProvider } from "../../../server/platform/specialized/capabilities/skills/tool-skill-management-provider.mjs";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function createRegistry({ describeImpl } = {}) {
  return {
    describe: describeImpl || vi.fn().mockResolvedValue({
      updatedAt: "2026-06-04T00:00:00.000Z",
      activeByKey: {
        "skill.visible": "skill.visible",
        "skill.hidden": "skill.hidden"
      },
      packages: [
        {
          status: "active",
          manifest: {
            kind: "skill",
            packageId: "skill.visible",
            name: "skill.visible",
            version: "1.0.0",
            title: "Visible Skill",
            description: "Visible for read grants",
            owner: "tests",
            source: "fixture",
            risk: "read_only",
            capabilities: ["demo.visible"],
            protocolVersion: "v0.0.1:tool:skill-registry-1"
          },
          library: {
            storage: "server-skill-library",
            root: "/tmp/visible"
          }
        },
        {
          status: "active",
          manifest: {
            kind: "skill",
            packageId: "skill.hidden",
            name: "skill.hidden",
            version: "1.0.0",
            title: "Hidden Skill",
            description: "Hidden for read grants",
            owner: "tests",
            source: "fixture",
            risk: "repair_write",
            capabilities: ["demo.hidden"],
            protocolVersion: "v0.0.1:tool:skill-registry-1"
          },
          library: {
            storage: "server-skill-library",
            root: "/tmp/hidden"
          }
        }
      ]
    })
  };
}

function createPlatform({
  catalogTools = [],
  describeRegistry,
  runtimeExecuteTool,
  authorizeRequest,
  createGrant,
  revokeGrant,
  listGrants,
  updateGrant,
  createMcpAuthorizationRequest,
  listMcpAuthorizationRequests,
  resolveMcpAuthorizationRequest,
  authorizeOperation,
  handleToolManagementHttpRequest,
  logger
} = {}) {
  const grants = [];
  const updateLog = [];

  const defaultCreateGrant = vi.fn((input = {}) => {
    const grant = {
      id: input.id || `grant_${grants.length + 1}`,
      label: input.label || "",
      type: input.type || "machine",
      toolsets: input.toolsets || [],
      scopes: input.scopes || [],
      toolAllow: input.toolAllow || [],
      toolDeny: input.toolDeny || [],
      metadata: input.metadata || {},
      tokenPrefix: "ock_test",
      enabled: input.enabled !== false,
      createdAt: "2026-06-04T00:00:00.000Z",
      updatedAt: "2026-06-04T00:00:00.000Z"
    };
    grants.push(grant);
    return { grant, token: "ock_test_token" };
  });

  const store = {
    authorizeRequest: authorizeRequest || vi.fn(async ({ request, requiredScopes = [] } = {}) => ({
      ok: true,
      requiredScopes,
      grant: {
        id: "grant_auth",
        label: "Grant Auth",
        scopes: ["knowledge:read"],
        toolsets: ["pact.agentLibrary.read"],
        toolAllow: [],
        toolDeny: [],
        metadata: { maxRisk: "read_only" }
      },
      sawAlias: request.headers["x-pact-tool-token"] === "ock_test"
    })),
    createGrant: createGrant || defaultCreateGrant,
    revokeGrant: revokeGrant || vi.fn(() => true),
    listGrants: listGrants || vi.fn(() => grants),
    updateGrant: updateGrant || vi.fn((id, patch = {}) => {
      const grant = grants.find((item) => item.id === id);
      if (!grant) {
        return null;
      }
      Object.assign(grant, patch);
      updateLog.push({ id, patch, grant });
      return grant;
    }),
    createMcpAuthorizationRequest: createMcpAuthorizationRequest || vi.fn((input = {}) => ({
      requestId: "mcp_auth_1",
      status: "pending",
      ...input
    })),
    listMcpAuthorizationRequests: listMcpAuthorizationRequests || vi.fn(() => [
      { requestId: "mcp_auth_1", status: "pending" }
    ]),
    resolveMcpAuthorizationRequest: resolveMcpAuthorizationRequest || vi.fn(() => true)
  };

  const platform = {
    securityPermissions: {
      decisions: [],
      appendDecision: vi.fn((decision) => {
        platform.securityPermissions.decisions.push(decision);
      }),
      authorizeOperation: authorizeOperation || vi.fn(async () => ({ ok: true }))
    },
    catalog: vi.fn(() => ({ tools: catalogTools })),
    registry: {
      resolveToolset: vi.fn((input = {}) => ({
        toolsets: Array.isArray(input.toolsets) ? input.toolsets : [],
        requiredScopes: ["knowledge:read"],
        maxRisk: "safe_write"
      })),
      listToolsets: vi.fn(() => [
        { id: "pact.agentLibrary.read", grantable: true },
        { id: "pact.agentLibrary.write", grantable: true },
        { id: "pact.storage.read", grantable: true },
        { id: "pact.storage.write", grantable: true },
        { id: "pact.agent.workspace.read", grantable: true },
        { id: "pact.agent.workspace", grantable: true },
        { id: "pact.document.parse", grantable: true },
        { id: "pact.result.export", grantable: true },
        { id: "pact.jobs.read", grantable: true },
        { id: "pact.runtime.read", grantable: true },
        { id: "pact.repo.read", grantable: true }
      ]),
      ...(describeRegistry ? { describe: describeRegistry } : {})
    },
    store,
    runtime: {
      executeTool: runtimeExecuteTool || vi.fn(async ({ toolId }) => {
        if (toolId === "pact.agentWorkspace.list") {
          return {
            ok: true,
            status: 200,
            payload: {
              result: {
                workspaces: [
                  { workspaceId: "workspace_a", title: "Alpha" },
                  {
                    nested: {
                      workspaces: [{ workspaceId: "workspace_b", title: "Beta" }]
                    }
                  }
                ]
              }
            }
          };
        }
        return {
          ok: true,
          status: 200,
          payload: {
            result: {
              ok: true,
              toolId
            }
          }
        };
      })
    },
    router: {
      handleToolManagementHttpRequest: handleToolManagementHttpRequest || vi.fn(async () => true)
    }
  };

  return { platform, store, updateLog };
}

function createRequest({
  headers = {},
  remoteAddress = "127.0.0.1"
} = {}) {
  return {
    headers: { ...headers },
    socket: { remoteAddress },
    __pactRequestId: "test-request"
  };
}

describe("tool skill management provider extra", () => {
  it("filters tools and skills by grant state and records denied authorization decisions", async () => {
    const { platform } = createPlatform({
      catalogTools: [
        {
          id: "tool.visible",
          status: "active",
          requiredScopes: ["knowledge:read"],
          toolsets: ["pact.agentLibrary.read"],
          risk: "read_only"
        },
        {
          id: "tool.denied",
          status: "active",
          requiredScopes: ["knowledge:read"],
          toolsets: ["pact.agentLibrary.read"],
          risk: "read_only"
        },
        {
          id: "tool.missing-scope",
          status: "active",
          requiredScopes: ["knowledge:write"],
          toolsets: ["pact.agentLibrary.read"],
          risk: "read_only"
        },
        {
          id: "tool.missing-toolset",
          status: "active",
          requiredScopes: ["knowledge:read"],
          toolsets: ["pact.storage.write"],
          risk: "read_only"
        },
        {
          id: "tool.risky",
          status: "active",
          requiredScopes: ["knowledge:read"],
          toolsets: ["pact.agentLibrary.read"],
          risk: "repair_write"
        },
        {
          id: "tool.inactive",
          status: "deprecated",
          requiredScopes: ["knowledge:read"],
          toolsets: ["pact.agentLibrary.read"],
          risk: "read_only"
        }
      ]
    });

    platform.store.authorizeRequest = vi.fn(async ({ request, requiredScopes = [] } = {}) => ({
      ok: false,
      status: 401,
      error: "No matching grant.",
      reasonCode: "missing_scope",
      missingScopes: ["knowledge:read"],
      requiredScopes,
      grant: {
        id: "grant_auth",
        label: "Grant Auth",
        scopes: ["knowledge:read"],
        toolsets: ["pact.agentLibrary.read"],
        toolAllow: [],
        toolDeny: [],
        metadata: { maxRisk: "read_only" }
      },
      sawAlias: request.headers["x-pact-tool-token"] === "ock_test"
    }));

    const provider = createToolSkillManagementProvider({
      toolManagementPlatform: platform,
      capabilityPackageRegistry: createRegistry()
    });

    const request = createRequest({
      headers: {
        "x-pact-api-key": "ock_test"
      }
    });

    const deniedAuthorization = await provider.authorizeRequest({
      request,
      requiredScopes: ["knowledge:read"]
    });

    expect(deniedAuthorization.ok).toBe(false);
    expect(deniedAuthorization.sawAlias).toBe(true);
    expect(platform.securityPermissions.appendDecision).toHaveBeenCalledTimes(1);
    expect(platform.securityPermissions.decisions[0]).toMatchObject({
      operationId: "mcp.request",
      action: "mcp.authorize",
      effect: "deny",
      reasonCode: "missing_scope",
      requiredScopes: ["knowledge:read"]
    });

    const visibleGrant = {
      id: "grant_visible",
      scopes: ["knowledge:read"],
      toolsets: ["pact.agentLibrary.read"],
      toolAllow: [
        "tool.visible",
        "tool.denied",
        "tool.missing-scope",
        "tool.missing-toolset",
        "tool.risky"
      ],
      toolDeny: ["tool.denied"],
      maxRisk: "read_only"
    };

    expect(provider.visibleGrantSummary({ authorization: { grant: visibleGrant } })).toMatchObject({
      id: "grant_visible",
      maxRisk: "read_only"
    });
    expect(provider.listVisibleTools({ authorization: { grant: visibleGrant } }).map((tool) => tool.id)).toEqual([
      "tool.visible"
    ]);
    expect(provider.listVisibleTools({ authorization: null }).map((tool) => tool.id)).toEqual([
      "tool.visible",
      "tool.denied",
      "tool.missing-scope",
      "tool.missing-toolset",
      "tool.risky"
    ]);
    expect(provider.listVisibleTools({
      authorization: {
        grant: {
          id: "grant_string_allow",
          scopes: "knowledge:read",
          toolsets: "pact.agentLibrary.read",
          toolAllow: "tool.visible, tool.risky",
          maxRisk: "repair_write"
        }
      }
    }).map((tool) => tool.id)).toEqual(["tool.visible", "tool.risky"]);
    expect(provider.listVisibleTools({
      authorization: {
        grant: {
          id: "grant_empty",
          scopes: [],
          toolsets: [],
          toolAllow: ["tool.visible"],
          maxRisk: "repair_write"
        }
      }
    })).toEqual([]);

    const visibleSkills = await provider.listVisibleSkills({
      authorization: {
        grant: {
          id: "skill_grant",
          scopes: ["knowledge:read"],
          toolsets: ["pact.agentLibrary.read"],
          metadata: { maxRisk: "read_only" }
        }
      }
    });
    expect(visibleSkills.summary).toEqual({
      activeSkillCount: 2,
      visibleSkillCount: 1
    });
    expect(visibleSkills.skills.map((skill) => skill.packageId)).toEqual(["skill.visible"]);
    expect(visibleSkills.skills[0]).toMatchObject({
      packageId: "skill.visible",
      mcpOutlet: "pact.skillHub",
      requiredScopes: ["knowledge:read"],
      toolsets: ["pact.agentLibrary.read"]
    });

    const allSkills = await provider.listVisibleSkills();
    expect(allSkills.summary).toEqual({
      activeSkillCount: 2,
      visibleSkillCount: 2
    });
    const allSkillsWithNullGrant = await provider.listVisibleSkills({ authorization: { grant: null } });
    expect(allSkillsWithNullGrant.summary).toEqual({
      activeSkillCount: 2,
      visibleSkillCount: 2
    });
    const hiddenByToolset = await provider.listVisibleSkills({
      authorization: {
        grant: {
          id: "skill_toolset_mismatch",
          scopes: ["knowledge:read", "knowledge:maintain"],
          toolsets: ["pact.storage.write"],
          metadata: { maxRisk: "repair_write" }
        }
      }
    });
    expect(hiddenByToolset.summary).toEqual({
      activeSkillCount: 2,
      visibleSkillCount: 0
    });

    const failingLogger = { warn: vi.fn() };
    const failingProvider = createToolSkillManagementProvider({
      toolManagementPlatform: platform,
      capabilityPackageRegistry: createRegistry({
        describeImpl: vi.fn(async () => {
          throw new Error("boom");
        })
      }),
      logger: failingLogger
    });
    const unavailableSkills = await failingProvider.listVisibleSkills({ authorization: { grant: visibleGrant } });
    expect(unavailableSkills.status).toBe("unavailable");
    expect(unavailableSkills.summary).toEqual({
      activeSkillCount: 0,
      visibleSkillCount: 0
    });
    expect(failingLogger.warn).toHaveBeenCalledWith(
      "tool_skill_management.skill_catalog.failed",
      expect.objectContaining({
        error: "boom"
      })
    );

    expect(provider.describe()).toEqual({
      schemaVersion: "v0.0.1:schema:definition-1",
      protocolVersion: "v0.0.1:tool:skill-management-1",
      capabilities: [
        "tool_catalog",
        "tool_grants",
        "tool_execution",
        "mcp_local_grant",
        "mcp_relay_child_grant",
        "mcp_workspace_reference_projection",
        "skill_registry_surface",
        "active_skill_catalog"
      ]
    });
  });

  it("resolves workspace references and sanitizes public MCP payloads", async () => {
    const runtimeExecuteTool = vi.fn(async ({ toolId }) => {
      if (toolId === "pact.agentWorkspace.list") {
        return {
          ok: true,
          status: 200,
          payload: {
            result: {
              workspaces: [
                { workspaceId: "workspace_a", title: "Alpha" },
                { workspaceId: "workspace_b", title: "Beta" }
              ]
            }
          }
        };
      }
      return {
        ok: true,
        status: 200,
        payload: { result: { ok: true, toolId } }
      };
    });
    const { platform } = createPlatform({
      runtimeExecuteTool
    });

    const provider = createToolSkillManagementProvider({
      toolManagementPlatform: platform,
      capabilityPackageRegistry: createRegistry()
    });
    const request = createRequest();

    const untouched = await provider.resolveMcpWorkspaceInput({
      input: { simple: true },
      request,
      context: { traceId: "no-resolution" }
    });
    expect(untouched).toEqual({
      input: { simple: true },
      workspaceDirectory: null
    });
    expect(runtimeExecuteTool).not.toHaveBeenCalled();

    const resolvedByIndex = await provider.resolveMcpWorkspaceInput({
      input: { workspaceIndex: "2" },
      request,
      context: { traceId: "workspace-index" }
    });
    expect(resolvedByIndex.input).toEqual({
      workspaceIndex: "2",
      workspaceId: "workspace_b"
    });
    expect(resolvedByIndex.workspaceDirectory.entries.map((entry) => entry.id)).toEqual([
      "workspace_a",
      "workspace_b"
    ]);
    expect(runtimeExecuteTool).toHaveBeenCalledWith({
      toolId: "pact.agentWorkspace.list",
      input: {},
      request,
      context: {
        traceId: "workspace-index",
        transport: "mcp",
        internalPurpose: "workspace-reference-resolution"
      },
      dryRun: false
    });

    const complexInput = {
      workspaceRef: "workspace-2",
      workspaceRefs: ["workspace-1", "Alpha"],
      workspaceName: "Alpha",
      nested: {
        workspaceId: "Alpha",
        deep: {
          workspaceId: "workspace-1"
        }
      }
    };
    const resolvedComplex = await provider.resolveMcpWorkspaceInput({
      input: complexInput,
      request,
      context: { traceId: "workspace-complex" }
    });
    expect(resolvedComplex.input).toEqual({
      workspaceRef: "workspace-2",
      workspaceId: "workspace_b",
      workspaceRefs: ["workspace-1", "Alpha"],
      workspaceIds: ["workspace_a", "workspace_a"],
      workspaceName: "Alpha",
      nested: {
        workspaceId: "workspace_a",
        deep: {
          workspaceId: "workspace_a"
        }
      }
    });

    const resolvedHyphenKeys = await provider.resolveMcpWorkspaceInput({
      input: {
        "workspace-index": "1",
        "workspace-name": "Beta",
        nested: [{ workspaceId: "workspace-2" }, { workspaceRef: "missing" }]
      },
      request,
      context: { traceId: "workspace-hyphen" }
    });
    expect(resolvedHyphenKeys.input).toEqual({
      "workspace-index": "1",
      "workspace-name": "Beta",
      workspaceId: "workspace_a",
      nested: [{ workspaceId: "workspace_b" }, { workspaceRef: "missing" }]
    });

    runtimeExecuteTool.mockClear();
    const publicPayload = await provider.publicMcpToolPayload({
      payload: {
        workspaces: [
          { workspaceId: "workspace_a", title: "Alpha" },
          { workspaceId: "workspace_b", title: "Beta" }
        ],
        selected: {
          workspaceId: "workspace_a",
          workspaceIds: ["workspace_a", "workspace_b"],
          absolutePath: "/Users/unka/private.txt"
        },
        cacheReceipt: {
          cacheKey: "workspace:workspace_a:notes",
          indexRoots: {
            "workspace:workspace_a": "cid:sha256:abc"
          }
        },
        metadata: {
          token: "ock_private_token",
          tokenPrefix: "ock_private",
          secret: "shh",
          password: "pw",
          secretRef: "secret://pact/drive/google-oauth",
          endpointRef: "config://pact/drive/google-endpoint"
        },
        error: {
          message: "Failed at /Users/unka/private.txt for workspace_a with Authorization: Bearer ock_private_token, token=ock_private_token, and --token ock_private_token",
          details: {
            sourcePath: "/Users/unka/private.txt",
            workspaceId: "workspace_a",
            headers: {
              Authorization: "Bearer ock_private_token",
              "X-Pact-Api-Key": "ock_private_token",
              Accept: "application/json"
            },
            apiKey: "ock_private_token",
            password: "ock_private_password"
          }
        }
      },
      request,
      context: { traceId: "payload" }
    });

    expect(publicPayload.selected).toMatchObject({
      workspaceRef: "workspace-1",
      workspaceIndex: 1,
      workspaceName: "Alpha"
    });
    expect(Object.prototype.hasOwnProperty.call(publicPayload.selected, "absolutePath")).toBe(false);
    expect(publicPayload.selected.workspaceRefs).toEqual(["workspace-1", "workspace-2"]);
    expect(publicPayload.cacheReceipt.cacheKey).toBe("workspace:workspace-1:notes");
    expect(publicPayload.cacheReceipt.indexRoots["workspace:workspace-1"]).toBe("cid:sha256:abc");
    expect(publicPayload.metadata.secretRef).toBe("secret://pact/drive/google-oauth");
    expect(publicPayload.metadata.endpointRef).toBe("config://pact/drive/google-endpoint");
    expect(Object.prototype.hasOwnProperty.call(publicPayload.metadata, "token")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(publicPayload.metadata, "tokenPrefix")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(publicPayload.metadata, "secret")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(publicPayload.metadata, "password")).toBe(false);
    expect(publicPayload.error.message).toBe(
      "Failed at [server-internal-path] for workspace-1 with Authorization: Bearer <redacted-token>, token=<redacted-secret>, and --token <redacted-token>"
    );
    expect(publicPayload.error.details.workspaceRef).toBe("workspace-1");
    expect(Object.prototype.hasOwnProperty.call(publicPayload.error.details, "sourcePath")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(publicPayload.error.details.headers, "Authorization")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(publicPayload.error.details.headers, "X-Pact-Api-Key")).toBe(false);
    expect(publicPayload.error.details.headers.Accept).toBe("application/json");
    expect(Object.prototype.hasOwnProperty.call(publicPayload.error.details, "apiKey")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(publicPayload.error.details, "password")).toBe(false);
    expect(JSON.stringify(publicPayload)).not.toContain("workspace_a");
    expect(JSON.stringify(publicPayload)).not.toContain("ock_private_token");
    expect(JSON.stringify(publicPayload)).not.toContain("/Users/unka");

    runtimeExecuteTool.mockClear();
    const fallbackPayload = await provider.publicMcpToolPayload({
      payload: {
        envelope: {
          workspaceId: "workspace_a",
          note: "workspace_a"
        }
      },
      request,
      context: { traceId: "fallback" }
    });
    expect(runtimeExecuteTool).toHaveBeenCalledTimes(1);
    expect(fallbackPayload.envelope).toMatchObject({
      workspaceRef: "workspace-1",
      note: "workspace-1"
    });

    const edgePayload = await provider.publicMcpToolPayload({
      payload: {
        empty: { workspaceId: "" },
        unknown: { workspaceId: "workspace_unknown", title: "Fallback Workspace" },
        data: [{ workspaceId: null }, { workspaceIds: ["workspace_missing"] }],
        note: "C:\\Users\\unit\\secret.txt",
        secretText: "X-Pact-Api-Key: ock_secret x-pact-tool-token: ock_tool access_token=abc",
        "workspace_a-key": "value"
      },
      workspaceDirectory: resolvedComplex.workspaceDirectory,
      request,
      context: { traceId: "payload-edge" }
    });
    expect(edgePayload.empty.workspaceRef).toBeNull();
    expect(edgePayload.unknown).toMatchObject({
      workspaceRef: "workspace-hidden",
      workspaceName: "Fallback Workspace"
    });
    expect(edgePayload.data).toEqual([
      { workspaceRef: null },
      { workspaceRefs: ["workspace-hidden"] }
    ]);
    expect(edgePayload.note).toBe("[server-internal-path]");
    expect(edgePayload.secretText).toContain("X-Pact-Api-Key: <redacted-token>");
    expect(edgePayload.secretText).toContain("x-pact-tool-token: <redacted-token>");
    expect(edgePayload.secretText).toContain("access_token=<redacted-secret>");
    expect(edgePayload["workspace-1-key"]).toBe("value");
  });

  it("delegates tool execution, handles runtime absence, and projects client connections", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-04T00:00:00.000Z"));

    const runtimeExecuteTool = vi.fn(async ({ toolId, input, request, context, dryRun }) => ({
      ok: true,
      status: 200,
      payload: {
        result: {
          toolId,
          input,
          requestId: request.__pactRequestId,
          context,
          dryRun
        }
      }
    }));
    const { platform } = createPlatform({
      runtimeExecuteTool,
      listGrants: vi.fn(() => [
        {
          id: "grant_connected",
          type: "mcp-client",
          label: "Codex (MCP Client)",
          createdAt: "2026-06-03T23:59:40.000Z",
          updatedAt: "2026-06-03T23:59:50.000Z",
          lastUsedAt: "2026-06-03T23:59:59.000Z",
          enabled: true,
          metadata: {
            targets: ["codex"],
            currentDeviceVisible: false,
            connectorVersion: "1.0.0",
            serverId: "server-1"
          }
        },
        {
          id: "grant_offline",
          type: "mcp-client",
          label: "Claude Code (MCP Client)",
          createdAt: "2026-06-03T22:59:40.000Z",
          updatedAt: "2026-06-03T22:59:50.000Z",
          lastUsedAt: "2026-06-03T23:58:00.000Z",
          enabled: true,
          metadata: { targets: ["claude-code"], connectorVersion: "1.0.0", serverId: "server-1" }
        },
        {
          id: "grant_disabled",
          type: "mcp-client",
          label: "Cursor (MCP Client)",
          createdAt: "2026-06-03T23:30:00.000Z",
          updatedAt: "2026-06-03T23:30:00.000Z",
          lastUsedAt: "2026-06-03T23:59:59.000Z",
          enabled: false,
          metadata: { targets: ["cursor"], connectorVersion: "1.0.0", serverId: "server-1" }
        },
        {
          id: "grant_revoked",
          type: "mcp-client",
          label: "Windsurf (MCP Client)",
          createdAt: "2026-06-03T23:30:00.000Z",
          updatedAt: "2026-06-03T23:30:00.000Z",
          revokedAt: "2026-06-03T23:45:00.000Z",
          enabled: true,
          metadata: { targets: ["windsurf"], connectorVersion: "1.0.0", serverId: "server-1" }
        },
        {
          id: "grant_issued",
          type: "machine",
          label: "Claude Code (MCP Client)",
          createdAt: "2026-06-03T23:30:00.000Z",
          updatedAt: "2026-06-03T23:30:00.000Z",
          enabled: true,
          metadata: {
            issuedBy: "pact-mcp-local-pairing",
            mcpTarget: ["claude-code"],
            connectorVersion: "1.0.0",
            serverId: "server-1"
          }
        },
        {
          id: "grant_server",
          type: "machine",
          label: "Gemini CLI (MCP Client)",
          createdAt: "2026-06-03T23:30:00.000Z",
          updatedAt: "2026-06-03T23:30:00.000Z",
          enabled: true,
          metadata: {
            mcpServer: "pact-mcp-server",
            mcpTarget: ["gemini-cli"],
            connectorVersion: "1.0.0",
            serverId: "server-1"
          }
        },
        {
          id: "grant_uninstalled",
          type: "mcp-client",
          label: "OpenClaw (MCP Client)",
          createdAt: "2026-06-03T23:30:00.000Z",
          updatedAt: "2026-06-03T23:30:00.000Z",
          enabled: true,
          metadata: {
            targets: ["openclaw"],
            uninstalledTargets: ["openclaw"],
            uninstalledAt: "2026-06-03T23:50:00.000Z",
            currentDeviceVisible: false,
            connectorVersion: "1.0.0",
            serverId: "server-1"
          }
        }
      ])
    });

    const provider = createToolSkillManagementProvider({
      toolManagementPlatform: platform,
      capabilityPackageRegistry: createRegistry()
    });
    const request = createRequest();

    const execution = await provider.executeTool({
      toolId: "pact.agentLibrary.health",
      input: { ok: true },
      request,
      context: { traceId: "exec-1" },
      dryRun: true
    });
    expect(runtimeExecuteTool).toHaveBeenCalledWith({
      toolId: "pact.agentLibrary.health",
      input: { ok: true },
      request,
      context: { traceId: "exec-1" },
      dryRun: true
    });
    expect(execution.payload.result).toMatchObject({
      toolId: "pact.agentLibrary.health",
      input: { ok: true },
      requestId: "test-request",
      context: { traceId: "exec-1" },
      dryRun: true
    });

    const runtimeMissingProvider = createToolSkillManagementProvider({
      toolManagementPlatform: {
        ...platform,
        runtime: {}
      },
      capabilityPackageRegistry: createRegistry()
    });
    const unavailableExecution = await runtimeMissingProvider.executeTool({
      toolId: "pact.agentLibrary.health",
      input: {},
      request,
      context: {}
    });
    expect(unavailableExecution.status).toBe(503);
    expect(unavailableExecution.payload.error.code).toBe("tool_runtime_unavailable");

    const connections = provider.listMcpClientConnections({ offlineAfterSeconds: 30 });
    expect(connections.map((row) => row.clientId)).toEqual([
      "mcp:grant_connected:codex",
      "mcp:grant_offline:claude-code",
      "mcp:grant_disabled:cursor",
      "mcp:grant_revoked:windsurf",
      "mcp:grant_issued:claude-code",
      "mcp:grant_server:gemini-cli"
    ]);
    expect(connections.map((row) => row.connectionState)).toEqual([
      "connected",
      "offline",
      "disabled",
      "revoked",
      "offline",
      "offline"
    ]);
    expect(connections.find((row) => row.sourceGrantId === "grant_uninstalled")).toBeUndefined();
    expect(connections.find((row) => row.sourceGrantId === "grant_server")).toMatchObject({
      platform: "MCP 插件",
      connectionMethod: "MCP 服务",
      connectionKind: "mcp-plugin"
    });
    expect(connections.find((row) => row.sourceGrantId === "grant_issued")).toMatchObject({
      platform: "MCP 插件",
      connectionMethod: "MCP 服务",
      connectionKind: "mcp-plugin"
    });

    const warningLogger = { warn: vi.fn() };
    const failingConnectionsProvider = createToolSkillManagementProvider({
      toolManagementPlatform: {
        ...platform,
        store: {
          ...platform.store,
          listGrants: vi.fn(() => {
            throw new Error("connection projection failed");
          })
        }
      },
      capabilityPackageRegistry: createRegistry(),
      logger: warningLogger
    });
    expect(failingConnectionsProvider.listMcpClientConnections()).toEqual([]);
    expect(warningLogger.warn).toHaveBeenCalledWith(
      "tool_skill_management.client_connections.failed",
      expect.objectContaining({
        error: "connection projection failed"
      })
    );

    const missingListProvider = createToolSkillManagementProvider({
      toolManagementPlatform: {
        ...platform,
        store: {}
      },
      capabilityPackageRegistry: createRegistry()
    });
    expect(missingListProvider.listMcpClientConnections()).toEqual([]);
  });

  it("creates, rejects, uninstalls, and routes local MCP grants plus grant-request delegation", async () => {
    const createGrant = vi.fn((input = {}) => ({
      grant: {
        id: input.id || `grant_${createGrant.mock.calls.length}`,
        label: input.label || "",
        type: input.type || "machine",
        toolsets: input.toolsets || [],
        scopes: input.scopes || [],
        toolAllow: input.toolAllow || [],
        toolDeny: input.toolDeny || [],
        metadata: input.metadata || {},
        tokenPrefix: "ock_test",
        enabled: input.enabled !== false,
        createdAt: "2026-06-04T00:00:00.000Z",
        updatedAt: "2026-06-04T00:00:00.000Z"
      },
      token: "ock_test_token"
    }));
    const updateGrant = vi.fn((id, patch = {}) => ({
      id,
      ...patch
    }));
    const resolveToolset = vi.fn((input = {}) => {
      if (Array.isArray(input.toolsets) && input.toolsets.includes("pact.blocked")) {
        return {
          toolsets: ["pact.blocked"],
          requiredScopes: ["knowledge:read"],
          maxRisk: "safe_write"
        };
      }
      if (Array.isArray(input.toolsets) && input.toolsets.length === 1 && input.toolsets[0] === "pact.document.parse") {
        return {
          toolsets: ["pact.document.parse"],
          requiredScopes: ["knowledge:read"],
          maxRisk: "repair_write"
        };
      }
      return {
        toolsets: Array.isArray(input.toolsets) ? input.toolsets : ["pact.agentLibrary.read"],
        requiredScopes: ["knowledge:read"],
        maxRisk: "safe_write"
      };
    });
    const { platform, store } = createPlatform({
      createGrant,
      updateGrant,
      authorizeOperation: vi.fn(async () => ({ ok: true })),
      listGrants: vi.fn(() => [
        {
          id: "grant_multi",
          type: "mcp-client",
          label: "Codex (MCP Client)",
          enabled: true,
          metadata: {
            targets: ["codex", "claude-code"],
            currentDeviceVisible: false,
            connectorVersion: "1.0.0",
            serverId: "server-1"
          }
        },
        {
          id: "grant_single",
          type: "mcp-client",
          label: "Codex (MCP Client)",
          enabled: true,
          metadata: {
            targets: ["codex"],
            connectorVersion: "1.0.0",
            serverId: "server-1"
          }
        }
      ])
    });
    platform.registry.resolveToolset = resolveToolset;
    platform.registry.listToolsets = vi.fn(() => [
      { id: "pact.agentLibrary.read", grantable: true },
      { id: "pact.document.parse", grantable: true },
      { id: "pact.blocked", grantable: false }
    ]);

    const provider = createToolSkillManagementProvider({
      toolManagementPlatform: platform,
      capabilityPackageRegistry: createRegistry()
    });

    const remoteDenied = await provider.createLocalMcpGrant({
      request: createRequest({ remoteAddress: "10.0.0.5" }),
      requestBody: Buffer.from("{}", "utf8"),
      url: new URL("http://127.0.0.1:7228/api/mcp/local-grant")
    });
    expect(remoteDenied.status).toBe(403);
    expect(remoteDenied.body.error.code).toBe("local_pairing_required");

    const missingTargets = await provider.markLocalMcpGrantUninstalled({
      request: createRequest(),
      requestBody: Buffer.from("{}", "utf8")
    });
    expect(missingTargets.status).toBe(400);
    expect(missingTargets.body.error.code).toBe("targets_required");

    const remoteUninstallDenied = await provider.markLocalMcpGrantUninstalled({
      request: createRequest({ remoteAddress: "10.0.0.5" }),
      requestBody: Buffer.from(JSON.stringify({ target: "codex" }), "utf8")
    });
    expect(remoteUninstallDenied.status).toBe(403);
    expect(remoteUninstallDenied.body.error.code).toBe("local_pairing_required");

    const unavailableUninstallProvider = createToolSkillManagementProvider({
      toolManagementPlatform: {
        ...platform,
        store: {
          listGrants: vi.fn(() => [])
        }
      },
      capabilityPackageRegistry: createRegistry()
    });
    const unavailableUninstall = await unavailableUninstallProvider.markLocalMcpGrantUninstalled({
      request: createRequest(),
      requestBody: Buffer.from(JSON.stringify({ target: "codex" }), "utf8")
    });
    expect(unavailableUninstall.status).toBe(503);
    expect(unavailableUninstall.body.error.code).toBe("tool_management_unavailable");

    const blockedToolset = await provider.createLocalMcpGrant({
      request: createRequest(),
      requestBody: Buffer.from(JSON.stringify({ target: "codex", toolsets: ["pact.blocked"] }), "utf8"),
      url: new URL("http://127.0.0.1:7228/api/mcp/local-grant")
    });
    expect(blockedToolset.status).toBe(403);
    expect(blockedToolset.body.error.code).toBe("toolset_not_grantable");

    const confirmRequired = await provider.createLocalMcpGrant({
      request: createRequest(),
      requestBody: Buffer.from(JSON.stringify({ target: "custom-target", toolsets: ["pact.agentLibrary.read"] }), "utf8"),
      url: new URL("http://127.0.0.1:7228/api/mcp/local-grant")
    });
    expect(confirmRequired.status).toBe(403);
    expect(confirmRequired.body.error.code).toBe("confirmation_required");

    const repairRequired = await provider.createLocalMcpGrant({
      request: createRequest({
        headers: {
          "x-pact-safety-confirm": "true"
        }
      }),
      requestBody: Buffer.from(JSON.stringify({ target: "custom-target", grantMode: "write", toolsets: ["pact.document.parse"] }), "utf8"),
      discoveryState: { serverId: "server-1", mcpIdentity: { keyId: "key-1" } },
      url: new URL("http://127.0.0.1:7228/api/mcp/local-grant")
    });
    expect(repairRequired.status).toBe(403);
    expect(repairRequired.body.error.code).toBe("repair_grant_mode_required");

    const emptyBody = await provider.createLocalMcpGrant({
      request: createRequest({
        headers: {
          "x-pact-safety-confirm": "true"
        }
      }),
      requestBody: Buffer.from("", "utf8"),
      url: new URL("http://127.0.0.1:7228/api/mcp/local-grant")
    });
    expect(emptyBody.status).toBe(201);
    expect(emptyBody.body.targets).toEqual([]);
    expect(emptyBody.body.targetMatch).toMatchObject({
      matched: false,
      matchedTargets: [],
      unmatchedTargets: []
    });

    const localGrant = await provider.createLocalMcpGrant({
      request: createRequest({
        headers: {
          "x-pact-safety-confirm": "true",
          host: "127.0.0.1:7228",
          "x-forwarded-proto": "http"
        }
      }),
      requestBody: Buffer.from(JSON.stringify({ target: "codex", label: "Codex grant" }), "utf8"),
      discoveryState: {
        activeServiceUrl: "https://127.0.0.1:9443/",
        serverId: "server-1",
        mcpIdentity: { keyId: "key-1" }
      },
      url: new URL("http://127.0.0.1:7228/api/mcp/local-grant")
    });
    expect(localGrant.status).toBe(201);
    expect(localGrant.body.grant.metadata).toMatchObject({
      issuedBy: "pact-mcp-local-pairing",
      targetMatch: true,
      agentProfileId: "pact.mcp.codex",
      serverId: "server-1",
      identityKeyId: "key-1",
      maxRisk: "safe_write"
    });
    expect(localGrant.body.sharedHub.canonicalMcpUrl).toBe("https://127.0.0.1:9443/mcp");
    expect(localGrant.body.sharedHub.vmMcpUrl).toBe("https://host.orb.internal:9443/mcp");
    expect(localGrant.body.targetMatch.matched).toBe(true);
    expect(localGrant.body.targetMatch.matchedTargetDetails).toEqual([
      {
        target: "codex",
        agentProfileId: "pact.mcp.codex",
        toolsets: [
          "pact.runtime.read",
          "pact.storage.read",
          "pact.jobs.read",
          "pact.agentLibrary.read",
          "pact.agentLibrary.write",
          "pact.storage.write",
          "pact.agent.workspace.read",
          "pact.agent.workspace",
          "pact.document.parse",
          "pact.result.export",
          "pact.repo.read"
        ],
        maxRisk: "safe_write"
      }
    ]);
    expect(createGrant).toHaveBeenCalledWith(
      expect.objectContaining({
        label: "Codex grant",
        type: "machine",
        toolDeny: ["pact.admin"],
        metadata: expect.objectContaining({
          issuedBy: "pact-mcp-local-pairing",
          targets: ["codex"],
          targetMatch: true,
          agentProfileId: "pact.mcp.codex",
          serverId: "server-1",
          identityKeyId: "key-1",
          maxRisk: "safe_write"
        })
      })
    );

    const noBaseUrlGrant = await provider.createLocalMcpGrant({
      request: createRequest({
        headers: {
          "x-pact-safety-confirm": "true"
        }
      }),
      requestBody: Buffer.from(JSON.stringify({ target: "codex,unknown-target", label: "No base URL" }), "utf8"),
      url: new URL("http://127.0.0.1:7228/api/mcp/local-grant")
    });
    expect(noBaseUrlGrant.status).toBe(201);
    expect(noBaseUrlGrant.body.sharedHub.canonicalMcpUrl).toBe("");
    expect(noBaseUrlGrant.body.sharedHub.vmMcpUrl).toBe("");
    expect(noBaseUrlGrant.body.connector.discoverCommand).toBe("npx pact-mcp-connector@latest discover-local --json");
    expect(noBaseUrlGrant.body.connector.clientInstallCommand).toBe("npx pact-mcp-connector@latest install --target <client>");
    expect(noBaseUrlGrant.body.targetMatch).toMatchObject({
      matched: true,
      matchedTargets: ["codex"],
      unmatchedTargets: ["unknown-target"],
      agentProfileId: "pact.mcp.codex"
    });

    const explicitGrant = await provider.createLocalMcpGrant({
      request: createRequest({
        headers: {
          "x-pact-safety-confirm": "true",
          host: "127.0.0.1:7228"
        }
      }),
      requestBody: Buffer.from(JSON.stringify({
        target: "custom-target",
        toolsets: ["pact.agentLibrary.read"],
        label: "Explicit grant",
        connectorVersion: "1.2.3"
      }), "utf8"),
      url: new URL("http://127.0.0.1:7228/api/mcp/local-grant")
    });
    expect(explicitGrant.status).toBe(201);
    expect(platform.securityPermissions.authorizeOperation).toHaveBeenCalledWith({
      request: expect.any(Object),
      method: "POST",
      url: new URL("http://127.0.0.1:7228/api/mcp/local-grant"),
      operation: {
        id: "mcp.local_grant",
        requiredScopes: ["runtime:admin"],
        skipCsrf: false
      }
    });
    expect(explicitGrant.body.connector.discoverCommand).toContain("npx pact-mcp-connector@latest discover-local --url 'http://127.0.0.1:7228' --json");
    expect(explicitGrant.body.sharedHub.canonicalMcpUrl).toBe("http://127.0.0.1:7228/mcp");
    expect(explicitGrant.body.sharedHub.vmMcpUrl).toBe("http://host.orb.internal:7228/mcp");
    expect(explicitGrant.body.targetMatch.matched).toBe(false);
    expect(explicitGrant.body.targetMatch.unmatchedTargets).toEqual(["custom-target"]);

    const uninstall = await provider.markLocalMcpGrantUninstalled({
      request: createRequest(),
      requestBody: Buffer.from(JSON.stringify({ target: "codex" }), "utf8")
    });
    expect(uninstall.status).toBe(200);
    expect(uninstall.body.updatedCount).toBe(2);
    expect(uninstall.body.updated).toEqual([
      {
        grantId: "grant_multi",
        targets: ["codex"],
        currentDeviceVisible: true
      },
      {
        grantId: "grant_single",
        targets: ["codex"],
        currentDeviceVisible: false
      }
    ]);
    expect(updateGrant).toHaveBeenCalledTimes(2);
    expect(updateGrant).toHaveBeenCalledWith(
      "grant_multi",
      expect.objectContaining({
        enabled: true,
        metadata: expect.objectContaining({
          uninstalledTargets: ["codex"],
          currentDeviceVisible: true,
          lastUninstalledAt: expect.any(String),
          lastUninstallConnectorVersion: ""
        })
      })
    );
    expect(updateGrant).toHaveBeenCalledWith(
      "grant_single",
      expect.objectContaining({
        enabled: false,
        metadata: expect.objectContaining({
          uninstalledTargets: ["codex"],
          currentDeviceVisible: false,
          uninstalledAt: expect.any(String)
        })
      })
    );

    const skipOnlyProvider = createToolSkillManagementProvider({
      toolManagementPlatform: {
        ...platform,
        store: {
          listGrants: vi.fn(() => [
            {
              id: "grant_plain",
              type: "machine",
              metadata: { targets: ["codex"] }
            }
          ]),
          updateGrant: vi.fn()
        }
      },
      capabilityPackageRegistry: createRegistry()
    });
    const skipOnlyUninstall = await skipOnlyProvider.markLocalMcpGrantUninstalled({
      request: createRequest(),
      requestBody: Buffer.from(JSON.stringify({ target: "codex" }), "utf8")
    });
    expect(skipOnlyUninstall.body.updatedCount).toBe(0);
    expect(skipOnlyProvider.listMcpClientConnections()).toEqual([]);

    const createdGrant = await provider.createAuthorizationGrant({
      grant: { label: "Created grant", type: "machine" }
    });
    expect(createdGrant.grant).toMatchObject({
      id: expect.any(String),
      label: "Created grant"
    });

    const revokedGrant = await provider.revokeAuthorizationGrant({
      grantId: "grant_123",
      reason: "cleanup"
    });
    expect(revokedGrant).toBe(true);

    const authRequest = await provider.createMcpAuthorizationRequest(
      {
        clientName: "Codex",
        requestedScopes: ["knowledge:read"],
        requestedTools: ["tool.visible"],
        reason: "need access"
      },
      { request: createRequest() }
    );
    expect(authRequest).toMatchObject({
      requestId: "mcp_auth_1",
      status: "pending",
      clientName: "Codex",
      requestedScopes: ["knowledge:read"],
      requestedTools: ["tool.visible"],
      reason: "need access"
    });
    expect(store.createMcpAuthorizationRequest).toHaveBeenCalledWith({
      request: expect.any(Object),
      clientName: "Codex",
      requestedScopes: ["knowledge:read"],
      requestedTools: ["tool.visible"],
      reason: "need access"
    });

    const pendingRequests = await provider.listMcpAuthorizationRequests({});
    expect(pendingRequests).toEqual([{ requestId: "mcp_auth_1", status: "pending" }]);

    const resolvedApproved = await provider.resolveMcpAuthorizationRequest({
      requestId: "mcp_auth_1",
      resolution: "approved",
      clientName: "Codex",
      scopes: ["knowledge:read"],
      toolsets: ["pact.agentLibrary.read"],
      toolAllow: ["tool.visible"]
    });
    expect(resolvedApproved.success).toBe(true);
    expect(resolvedApproved.grantId).toMatch(/^grant_/);
    expect(createGrant).toHaveBeenCalledWith(
      expect.objectContaining({
        label: "Codex (MCP Client)",
        type: "mcp-client",
        scopes: ["knowledge:read"],
        toolsets: ["pact.agentLibrary.read"],
        toolAllow: ["tool.visible"],
        enabled: true,
        reason: "Approved MCP authorization request mcp_auth_1"
      })
    );

    const resolvedDenied = await provider.resolveMcpAuthorizationRequest({
      requestId: "mcp_auth_2",
      resolution: "denied"
    });
    expect(resolvedDenied).toEqual({
      success: true,
      grantId: ""
    });

    const handlerResult = await provider.handleToolManagementHttpRequest({ request: {}, response: {}, method: "GET" });
    expect(handlerResult).toBe(true);

    const handlerMissingProvider = createToolSkillManagementProvider({
      toolManagementPlatform: {
        ...platform,
        router: {}
      },
      capabilityPackageRegistry: createRegistry()
    });
    expect(await handlerMissingProvider.handleToolManagementHttpRequest({ request: {}, response: {}, method: "GET" })).toBe(false);
  });
});
