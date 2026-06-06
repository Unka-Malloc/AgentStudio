import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it, vi } from "vitest";

const childProcessMock = vi.hoisted(() => ({
  execFile: vi.fn()
}));

const httpsMock = vi.hoisted(() => ({
  request: vi.fn()
}));

vi.mock("node:child_process", () => ({
  execFile: childProcessMock.execFile
}));

vi.mock("node:https", () => ({
  default: {
    request: httpsMock.request
  },
  request: httpsMock.request
}));

import { ACP_METHODS } from "../../../server/platform/common/protocols/acp/index.mjs";
import {
  AcpClientConnection
} from "../../../server/platform/specialized/capabilities/agent-relay/acp-agent-relay/acp-client-connection.mjs";
import {
  AcpSourceJsonRpcBridge
} from "../../../server/platform/specialized/capabilities/agent-relay/acp-agent-relay/acp-source-json-rpc-bridge.mjs";
import {
  AcpSourceOperationGuard
} from "../../../server/platform/specialized/capabilities/agent-relay/acp-agent-relay/acp-source-operation-guard.mjs";
import {
  RelayOperationExecutor
} from "../../../server/platform/specialized/capabilities/agent-relay/acp-agent-relay/relay-operation-executor.mjs";
import {
  AntigravityAgentApiClient,
  callAntigravityConnectRpc
} from "../../../server/platform/specialized/capabilities/agent-relay/acp-agent-relay/antigravity-agent-api-client.mjs";

const tempRoots = [];

async function makeTempRoot(prefix = "pact-acp-agent-relay-more-extra-") {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

function makeRoute(agentOverrides = {}) {
  const virtualAgent = {
    virtualAgentId: "agent-1",
    targetId: "target-1",
    profileId: "profile-1",
    displayName: "Agent One",
    description: "Agent one",
    defaultMode: "ask",
    advertisedModes: ["ask"],
    advertisedModalities: ["text"],
    advertisedDataSources: [],
    advertisedTools: [],
    reasoningVisibilityPolicy: "requestable",
    visibilityPolicy: "public",
    capabilityPolicy: {
      writes: "deny",
      terminal: "deny",
      maxRisk: "read_only"
    },
    enabled: true,
    revision: 1,
    metadata: {},
    ...agentOverrides
  };
  return {
    relaySessionId: "relay-1",
    sourceId: "source-1",
    sourceSessionId: "source-session-1",
    virtualAgentId: virtualAgent.virtualAgentId,
    workspaceId: "workspace-1",
    sourceSubjectId: "subject-1",
    policyRevision: 3,
    effectiveMode: "ask",
    turnFingerprint: "turn-fingerprint",
    virtualAgent,
    target: {
      targetId: "target-1",
      externalServiceId: "external-1",
      transport: {
        type: "mock"
      }
    },
    decision: {
      advertisedTools: [],
      maxRisk: "read_only",
      reasoningAllowed: false,
      writesPolicy: {
        writes: "deny"
      },
      terminalPolicy: {
        terminal: "deny"
      }
    }
  };
}

function makeTransport({ send = async () => true, receive = async () => null } = {}) {
  return {
    send: vi.fn(send),
    receive: vi.fn(receive),
    close: vi.fn()
  };
}

function installHttpsResponse({ statusCode = 200, body = "", error = null } = {}) {
  httpsMock.request.mockImplementationOnce((options, callback) => {
    const request = new EventEmitter();
    request.setTimeout = vi.fn();
    request.destroy = vi.fn((destroyError) => {
      request.emit("error", destroyError);
    });
    request.end = vi.fn(() => {
      if (error) {
        request.emit("error", error);
        return;
      }
      const response = new EventEmitter();
      response.statusCode = statusCode;
      response.setEncoding = vi.fn();
      callback(response);
      if (body !== undefined) {
        response.emit("data", body);
      }
      response.emit("end");
    });
    return request;
  });
}

afterEach(async () => {
  childProcessMock.execFile.mockReset();
  httpsMock.request.mockReset();
  vi.restoreAllMocks();
  const roots = tempRoots.splice(0);
  await Promise.all(roots.map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("agent-relay acp more extra coverage", () => {
  it("normalizes bridge JSON-RPC input and falls back on parse and dispatch errors", async () => {
    const bridge = new AcpSourceJsonRpcBridge({
      inboundFacade: { executor: { execute: vi.fn() } },
      executor: { execute: vi.fn() }
    });

    const parseError = await bridge.handle("not-json");
    assert.equal(parseError.error.code, -32700);
    assert.equal(parseError.jsonrpc, "2.0");

    const responseMessage = { jsonrpc: "2.0", id: 7, result: { ok: true } };
    assert.equal(await bridge.handle(Buffer.from(JSON.stringify(responseMessage))), null);
    assert.equal(await bridge.handle(new Uint8Array(Buffer.from(JSON.stringify(responseMessage)))), null);

    const batchError = await bridge.handleBatch([]);
    assert.equal(batchError.error.code, -32600);

    const invalidBatch = await bridge.handleBatch([{
      jsonrpc: "2.0",
      id: 8
    }]);
    assert.equal(invalidBatch[0].error.code, -32600);
    assert.match(invalidBatch[0].error.message, /unknown or incomplete/i);

    const unsupported = await bridge.dispatch({
      jsonrpc: "2.0",
      id: 9,
      method: "unknown.method",
      params: { sourceId: "source-1" }
    });
    assert.equal(unsupported.error.code, -32601);
    assert.equal(unsupported.error.data.method, "unknown.method");
  });

  it("dispatches relay executor fallbacks and successful target listings", async () => {
    const blockedExecutor = new RelayOperationExecutor({
      virtualAgentRegistry: {},
      targetRegistry: {},
      router: {},
      store: {},
      sessionDriver: {},
      eventNormalizer: {},
      permissionBridge: {},
      operationGuard: {
        preflight: vi.fn(async () => ({
          ok: false,
          error: {
            code: "blocked",
            message: "blocked by policy"
          },
          decision: {
            reason: "deny"
          }
        }))
      }
    });

    const blocked = await blockedExecutor.execute("acp_agent_relay.targets.list", {});
    assert.equal(blocked.ok, false);
    assert.equal(blocked.error.code, "blocked");
    assert.equal(blocked.error.details.sourceAuthorizationDecision.reason, "deny");

    const targetRegistry = {
      listTargets: vi.fn(() => [{
        targetId: "target-1",
        label: "Target One",
        transport: {
          type: "stdio",
          csrfToken: "secret-csrf-token",
          binaryPath: "/private/bin/agent",
          command: {
            executable: "/private/bin/agent",
            args: ["--token", "secret-token"]
          }
        },
        advertisedToolsets: ["fs.readTextFile", "vision.describe"],
        capabilityPolicy: {
          writes: "deny",
          terminal: "deny",
          maxRisk: "read_only"
        },
        externalServiceId: "external.target.one"
      }])
    };
    const router = {
      resolveForSourceSession: vi.fn(async () => ({
        ok: true,
        route: makeRoute()
      }))
    };
    const virtualAgentRegistry = {
      listEnabled: vi.fn(() => [makeRoute().virtualAgent])
    };

    const executor = new RelayOperationExecutor({
      virtualAgentRegistry,
      targetRegistry,
      router,
      store: {},
      sessionDriver: {},
      eventNormalizer: {},
      permissionBridge: {}
    });

    const unknown = await executor.execute("acp_agent_relay.nope", {});
    assert.equal(unknown.ok, false);
    assert.equal(unknown.error.code, "unknown_operation");

    const targets = await executor.execute("acp_agent_relay.targets.list", {});
    assert.equal(targets.ok, true);
    assert.equal(targets.data.targets[0].targetId, "target-1");
    assert.equal(targets.data.targets[0].transportType, "stdio");
    assert.deepEqual(targets.data.targets[0].capabilities.toolsets, ["fs.readTextFile", "vision.describe"]);
    assert.equal(JSON.stringify(targets.data.targets).includes("secret-csrf-token"), false);
    assert.equal(JSON.stringify(targets.data.targets).includes("/private/bin/agent"), false);
    assert.equal(JSON.stringify(targets.data.targets).includes("secret-token"), false);
    assert.equal(targetRegistry.listTargets.mock.calls.length, 1);

    const virtualAgents = await executor.execute("acp_agent_relay.virtual_agents.list", {
      prompt: "test prompt"
    });
    assert.equal(virtualAgents.ok, true);
    assert.equal(virtualAgents.data.virtualAgents[0].virtualAgentId, "agent-1");
    assert.equal(router.resolveForSourceSession.mock.calls.length, 1);
    assert.equal(virtualAgentRegistry.listEnabled.mock.calls.length, 1);
  });

  it("exposes source-facing target discovery through ACP without raw transport secrets", async () => {
    const inboundFacade = {
      listTargets: vi.fn(async (input) => ({
        ok: true,
        data: {
          targets: [{
            targetId: "target-vision",
            label: "Vision Target",
            transportType: "antigravity-agentapi",
            advertisedToolsets: ["agentapi.sendMessage", "vision.describe"],
            capabilityPolicy: {
              writes: "deny",
              terminal: "deny",
              maxRisk: "read_only"
            },
            capabilities: {
              toolsets: ["agentapi.sendMessage", "vision.describe"],
              writes: "deny",
              terminal: "deny",
              maxRisk: "read_only",
              finalResponse: {
                policy: "connect_trajectory_if_observed"
              }
            }
          }]
        },
        input
      }))
    };
    const bridge = new AcpSourceJsonRpcBridge({
      inboundFacade,
      executor: {
        execute: vi.fn()
      },
      defaultSourceId: "source-default",
      defaultWorkspaceId: "workspace-default"
    });

    const pactTargets = await bridge.dispatch({
      jsonrpc: "2.0",
      id: "target-list-1",
      method: ACP_METHODS.pactTargetList,
      params: {
        sourceId: "source-1",
        workspaceId: "workspace-1"
      }
    });
    assert.equal(pactTargets.result.protocolVersion, 1);
    assert.equal(pactTargets.result.sourceIdentity.sourceId, "source-1");
    assert.equal(pactTargets.result.targets[0].targetId, "target-vision");
    assert.deepEqual(pactTargets.result.targets[0].capabilities.toolsets, ["agentapi.sendMessage", "vision.describe"]);

    const plainTargets = await bridge.dispatch({
      jsonrpc: "2.0",
      id: "target-list-2",
      method: ACP_METHODS.targetList,
      params: {
        sourceId: "source-1",
        workspaceId: "workspace-1"
      }
    });
    assert.equal(plainTargets.result.targets[0].transportType, "antigravity-agentapi");
    assert.equal(inboundFacade.listTargets.mock.calls.length, 2);
  });

  it("binds source identity to platform authentication context before request body fields", async () => {
    const inboundFacade = {
      listSessions: vi.fn(async (input) => ({
        ok: true,
        data: {
          sessions: [],
          count: 0,
          limit: Number(input.limit || 0)
        }
      }))
    };
    const bridge = new AcpSourceJsonRpcBridge({
      inboundFacade,
      executor: {
        execute: vi.fn()
      },
      defaultSourceId: "source-default",
      defaultWorkspaceId: "workspace-default",
      defaultVirtualAgentId: "agent-default"
    });
    const authContext = {
      authenticationContext: {
        sourceIdentity: {
          sourceSessionId: "source-session-auth",
          virtualAgentId: "agent-auth"
        }
      },
      authSession: {
        sessionId: "auth-session-1",
        user: {
          userId: "auth-user-1",
          username: "alice",
          scopes: ["agent_relay:view"]
        }
      },
      grant: {
        id: "grant-auth-1",
        metadata: {
          sourceId: "codex-auth-source",
          workspaceId: "workspace-auth",
          agentProfileId: "profile-auth",
          credentialRef: "credential://pact/source/auth-1"
        }
      }
    };

    const sessions = await bridge.dispatch({
      jsonrpc: "2.0",
      id: "session-list-auth-binding",
      method: ACP_METHODS.sessionList,
      params: {
        sourceId: "attacker-source",
        workspaceId: "attacker-workspace",
        sourceSessionId: "attacker-session",
        sourceSubjectId: "attacker-subject",
        virtualAgentId: "attacker-agent",
        limit: 5
      }
    }, authContext);

    assert.equal(sessions.result.sourceIdentity.sourceId, "codex-auth-source");
    assert.equal(sessions.result.sourceIdentity.workspaceId, "workspace-auth");
    assert.equal(sessions.result.sourceIdentity.sourceSessionId, "source-session-auth");
    assert.equal(sessions.result.sourceIdentity.sourceSubjectId, "auth-user-1");
    assert.equal(sessions.result.sourceIdentity.virtualAgentId, "agent-auth");
    assert.equal(sessions.result.sourceIdentity.agentProfileId, "profile-auth");
    assert.equal(sessions.result.sourceIdentity.sourceIdentityTrusted, true);
    assert.equal(JSON.stringify(sessions.result.sourceIdentity).includes("credential://"), false);
    assert.equal(JSON.stringify(sessions.result.sourceIdentity).includes("auth-session-1"), false);

    const input = inboundFacade.listSessions.mock.calls[0][0];
    assert.equal(input.sourceId, "codex-auth-source");
    assert.equal(input.workspaceId, "workspace-auth");
    assert.equal(input.sourceSessionId, "source-session-auth");
    assert.equal(input.sourceSubjectId, "auth-user-1");
    assert.equal(input.virtualAgentId, "agent-auth");
    assert.deepEqual(input.sourceIdentity, sessions.result.sourceIdentity);
    assert.equal(input.sourceAuthContext.authSessionId, "auth-session-1");
    assert.equal(input.sourceAuthContext.grantId, "grant-auth-1");
    assert.equal(input.sourceAuthContext.credentialRef, "credential://pact/source/auth-1");
    assert.deepEqual(input.sourceAuthContext.sourceScopes, ["agent_relay:view"]);
  });

  it("uses authenticated source context for the ACP source operation guard subject", async () => {
    const policyCalls = [];
    const securityPermissions = {
      evaluatePolicy: vi.fn((input) => {
        policyCalls.push(input);
        return {
          effect: "allow",
          allowed: true,
          reasonCode: "vitest_allowed",
          redactedReason: "Allowed by source auth context test.",
          missingScopes: [],
          missingToolsets: [],
          missingCapabilities: [],
          evaluatedLayers: ["vitest_source_auth_context"]
        };
      }),
      appendDecision: vi.fn()
    };
    const guard = new AcpSourceOperationGuard({
      securityPermissions,
      context: {
        authenticationContext: {
          sourceIdentity: {
            sourceId: "codex-auth-source",
            workspaceId: "workspace-auth"
          },
          credentialRef: "credential://pact/source/auth-1"
        },
        authSession: {
          sessionId: "auth-session-1",
          user: {
            userId: "auth-user-1",
            scopes: ["agent_relay:view"]
          }
        },
        grant: {
          id: "grant-auth-1",
          metadata: {
            agentProfileId: "profile-auth"
          }
        }
      }
    });

    const result = await guard.preflight({
      operationId: "acp_agent_relay.sessions.list",
      input: {
        sourceId: "attacker-source",
        workspaceId: "attacker-workspace",
        sourceSubjectId: "attacker-subject",
        sourceScopes: ["agent_relay:view", "admin:all"]
      }
    });

    assert.equal(result.ok, true);
    assert.equal(policyCalls.length, 1);
    assert.equal(policyCalls[0].context.sourceId, "codex-auth-source");
    assert.equal(policyCalls[0].context.workspaceId, "workspace-auth");
    assert.equal(policyCalls[0].context.sourceSubjectId, "auth-user-1");
    assert.equal(policyCalls[0].context.sourceAuthContext.authSessionId, "auth-session-1");
    assert.equal(policyCalls[0].context.sourceAuthContext.grantId, "grant-auth-1");
    assert.equal(policyCalls[0].context.sourceAuthContext.credentialRef, "credential://pact/source/auth-1");
    assert.equal(policyCalls[0].subject.subjectId, "auth-user-1");
    assert.equal(policyCalls[0].subject.agentProfileId, "profile-auth");
    assert.deepEqual(policyCalls[0].subject.scopes, ["agent_relay:view"]);
  });

  it("exposes source-facing relay session and turn observability through ACP summaries", async () => {
    const inboundFacade = {
      listSessions: vi.fn(async (input) => ({
        ok: true,
        data: {
          sessions: [{
            relaySessionId: "relay-session-1",
            sourceId: input.sourceId,
            workspaceId: input.workspaceId,
            virtualAgentId: input.virtualAgentId,
            targetSessionId: "target-session-secret",
            targetResumeRef: "target-resume-secret",
            relayMcpGrantId: "relay-mcp-grant-secret",
            turnCount: 1,
            pendingPermissionCount: 0,
            lastWakeResult: {
              ok: true,
              targetSessionId: "target-session-secret",
              targetResumeRef: "target-resume-secret",
              transportType: "antigravity-agentapi"
            },
            latestTurn: {
              relayTurnId: "relay-turn-1",
              status: "completed",
              communicationSummary: {
                relayTurnId: "relay-turn-1",
                targetSessionId: "target-session-secret",
                targetResumeRef: "target-resume-secret",
                relayMcpGrantId: "relay-mcp-grant-secret",
                reasoningIncluded: false
              }
            }
          }],
          count: 1,
          limit: 50
        }
      })),
      getSession: vi.fn(async (input) => ({
        ok: true,
        data: {
          session: {
            relaySessionId: input.sessionId,
            sourceId: input.sourceId,
            workspaceId: input.workspaceId,
            virtualAgentId: input.virtualAgentId,
            targetSessionId: "target-session-secret",
            targetResumeRef: "target-resume-secret",
            relayMcpGrantId: "relay-mcp-grant-secret",
            turnCount: 1
          },
          turns: [{
            relayTurnId: "relay-turn-1",
            relaySessionId: input.sessionId,
            status: "completed",
            communicationSummary: {
              relayTurnId: "relay-turn-1",
              targetSessionId: "target-session-secret",
              targetResumeRef: "target-resume-secret",
              relayMcpGrantId: "relay-mcp-grant-secret",
              reasoningIncluded: false
            }
          }]
        }
      })),
      listTurns: vi.fn(async (input) => ({
        ok: true,
        data: {
          relaySessionId: input.sessionId,
          turns: [{
            relayTurnId: "relay-turn-1",
            relaySessionId: input.sessionId,
            status: "completed",
            communicationSummary: {
              relayTurnId: "relay-turn-1",
              targetSessionId: "target-session-secret",
              targetResumeRef: "target-resume-secret",
              relayMcpGrantId: "relay-mcp-grant-secret",
              reasoningIncluded: false
            }
          }],
          count: 1,
          limit: 25
        }
      }))
    };
    const bridge = new AcpSourceJsonRpcBridge({
      inboundFacade,
      executor: {
        execute: vi.fn()
      },
      defaultSourceId: "source-default",
      defaultWorkspaceId: "workspace-default",
      defaultVirtualAgentId: "agent-default"
    });

    const sessions = await bridge.dispatch({
      jsonrpc: "2.0",
      id: "session-list-1",
      method: ACP_METHODS.pactSessionList,
      params: {
        sourceId: "source-1",
        workspaceId: "workspace-1",
        virtualAgentId: "agent-1",
        limit: 50
      }
    });
    assert.equal(sessions.result.protocolVersion, 1);
    assert.equal(sessions.result.sourceIdentity.sourceId, "source-1");
    assert.equal(sessions.result.sessions[0].relaySessionId, "relay-session-1");
    assert.equal(sessions.result.sessions[0].latestTurn.communicationSummary.reasoningIncluded, false);
    assert.equal(JSON.stringify(sessions.result).includes("target-session-secret"), false);
    assert.equal(JSON.stringify(sessions.result).includes("target-resume-secret"), false);
    assert.equal(JSON.stringify(sessions.result).includes("relay-mcp-grant-secret"), false);
    assert.equal(inboundFacade.listSessions.mock.calls[0][0].sourceId, "source-1");
    assert.equal(inboundFacade.listSessions.mock.calls[0][0].workspaceId, "workspace-1");
    assert.equal(inboundFacade.listSessions.mock.calls[0][0].virtualAgentId, "agent-1");

    const trustedSourceContext = {
      sourceIdentity: {
        sourceId: "source-1",
        workspaceId: "workspace-1",
        virtualAgentId: "agent-1"
      }
    };

    const spoofedSessions = await bridge.dispatch({
      jsonrpc: "2.0",
      id: "session-list-spoof",
      method: ACP_METHODS.sessionList,
      params: {
        sourceId: "attacker-source",
        workspaceId: "attacker-workspace",
        virtualAgentId: "attacker-agent"
      }
    }, trustedSourceContext);
    assert.equal(spoofedSessions.result.sourceIdentity.sourceId, "source-1");
    assert.equal(inboundFacade.listSessions.mock.calls[1][0].sourceId, "source-1");
    assert.equal(inboundFacade.listSessions.mock.calls[1][0].workspaceId, "workspace-1");
    assert.equal(inboundFacade.listSessions.mock.calls[1][0].virtualAgentId, "agent-1");

    const session = await bridge.dispatch({
      jsonrpc: "2.0",
      id: "session-get-1",
      method: ACP_METHODS.sessionGet,
      params: {
        sessionId: "relay-session-1",
        sourceId: "source-1",
        workspaceId: "workspace-1",
        virtualAgentId: "agent-1"
      }
    });
    assert.equal(session.result.session.relaySessionId, "relay-session-1");
    assert.equal(session.result.turns[0].communicationSummary.reasoningIncluded, false);
    assert.equal(JSON.stringify(session.result).includes("target-session-secret"), false);
    assert.equal(JSON.stringify(session.result).includes("target-resume-secret"), false);
    assert.equal(JSON.stringify(session.result).includes("relay-mcp-grant-secret"), false);
    assert.equal(inboundFacade.getSession.mock.calls[0][0].sessionId, "relay-session-1");
    assert.equal(inboundFacade.getSession.mock.calls[0][0].sourceId, "source-1");

    const turns = await bridge.dispatch({
      jsonrpc: "2.0",
      id: "turn-list-1",
      method: ACP_METHODS.turnList,
      params: {
        sessionId: "relay-session-1",
        sourceId: "source-1",
        workspaceId: "workspace-1",
        virtualAgentId: "agent-1",
        limit: 25
      }
    });
    assert.equal(turns.result.relaySessionId, "relay-session-1");
    assert.equal(turns.result.turns[0].relayTurnId, "relay-turn-1");
    assert.equal(turns.result.turns[0].communicationSummary.reasoningIncluded, false);
    assert.equal(JSON.stringify(turns.result).includes("target-session-secret"), false);
    assert.equal(JSON.stringify(turns.result).includes("target-resume-secret"), false);
    assert.equal(JSON.stringify(turns.result).includes("relay-mcp-grant-secret"), false);
    assert.equal(inboundFacade.listTurns.mock.calls[0][0].sessionId, "relay-session-1");
    assert.equal(inboundFacade.listTurns.mock.calls[0][0].sourceId, "source-1");
  });

  it("normalizes client connection request and response flows", async () => {
    const transport = makeTransport();
    const connection = new AcpClientConnection({
      target: { targetId: "target-1" },
      transport,
      requestTimeoutMs: 0
    });

    await connection.handleTargetRequest({
      jsonrpc: "2.0",
      id: "callback-1",
      method: "target/callback",
      params: {}
    });
    assert.equal(transport.send.mock.calls[0][0].error.code, -32601);

    const pendingTransport = makeTransport();
    const pendingConnection = new AcpClientConnection({
      target: { targetId: "target-2" },
      transport: pendingTransport,
      requestTimeoutMs: 0
    });
    const pendingEntry = pendingConnection.createPendingRequest(
      { id: "pending-1" },
      {
        method: "session/prompt",
        collectUpdates: true,
        handleRequest: async () => ({
          __pactTargetApprovalPending: true,
          pendingApproval: {
            outputSummary: "waiting for approval",
            receipts: [{ ok: true }],
            pendingPermissionRequests: [{ requestId: "perm-1" }]
          }
        })
      }
    );

    await pendingConnection.dispatchIncomingMessage({
      jsonrpc: "2.0",
      id: "target-request-1",
      method: "target/request",
      params: {
        request: true
      }
    });
    const pendingResolution = await pendingEntry.promise;
    assert.equal(pendingResolution.result.ok, true);
    assert.equal(pendingResolution.result.stopReason, "approval_pending");
    assert.equal(pendingResolution.result.externalCompletionState, "approval_pending");
    assert.equal(pendingTransport.close.mock.calls.length, 1);

    const responseTransport = makeTransport();
    const responseConnection = new AcpClientConnection({
      target: { targetId: "target-3" },
      transport: responseTransport,
      requestTimeoutMs: 0
    });
    const responseEntry = responseConnection.createPendingRequest(
      { id: "response-1" },
      {
        method: ACP_METHODS.sessionPrompt,
        collectUpdates: true
      }
    );
    await responseConnection.dispatchIncomingMessage({
      jsonrpc: "2.0",
      method: ACP_METHODS.sessionUpdate,
      params: {
        type: "progress",
        phase: "working",
        text: "Target is working."
      }
    });
    await responseConnection.dispatchIncomingMessage({
      jsonrpc: "2.0",
      method: "target/notification",
      params: {
        note: "stored"
      }
    });
    await responseConnection.dispatchIncomingMessage({
      jsonrpc: "2.0",
      id: "response-1",
      result: {
        ok: true,
        targetSessionId: "target-session-1",
        targetResumeRef: "resume-1",
        receipts: [{ kind: "receipt" }]
      }
    });
    const responseResolution = await responseEntry.promise;
    assert.equal(responseResolution.result.ok, true);
    assert.equal(responseResolution.result.targetSessionId, "target-session-1");
    assert.equal(responseResolution.updates.length, 1);
    assert.equal(responseResolution.targetNotifications.length, 1);

    const errorEntry = responseConnection.createPendingRequest(
      { id: "response-2" },
      {
        method: ACP_METHODS.sessionPrompt
      }
    );
    await responseConnection.dispatchIncomingMessage({
      jsonrpc: "2.0",
      id: "response-2",
      error: {
        code: 4242,
        message: "target failed",
        data: {
          retry: false
        }
      }
    });
    await assert.rejects(
      errorEntry.promise,
      (error) => {
        assert.equal(error.code, 4242);
        assert.equal(error.message, "target failed");
        assert.deepEqual(error.data, { retry: false });
        return true;
      }
    );
  });

  it("covers connection refusal paths and Antigravity status and exception branches", async () => {
    const unopenedConnection = new AcpClientConnection({
      target: { targetId: "target-4" }
    });
    await assert.rejects(
      () => unopenedConnection.request(ACP_METHODS.sessionPrompt, {}),
      /transport is not configured/
    );

    const refusingTransport = makeTransport({
      send: async () => false
    });
    const refusingConnection = new AcpClientConnection({
      target: { targetId: "target-5" },
      transport: refusingTransport,
      requestTimeoutMs: 0
    });
    await assert.rejects(
      () => refusingConnection.request(ACP_METHODS.sessionPrompt, { prompt: "test" }),
      /refused session\/prompt request/
    );
    assert.equal(refusingConnection.closed, true);
    assert.equal(refusingTransport.close.mock.calls.length, 1);

    const tempRoot = await makeTempRoot();
    const binaryPath = path.join(tempRoot, "agentapi-bin");
    await fs.writeFile(binaryPath, "binary", "utf8");

    const client = new AntigravityAgentApiClient({
      binaryPath,
      address: "127.0.0.1:9000",
      csrfToken: "csrf-token"
    });

    childProcessMock.execFile
      .mockImplementationOnce((command, args, options, callback) => {
        callback(null, {
          stdout: "",
          stderr: ""
        });
      })
      .mockImplementationOnce((command, args, options, callback) => {
        const error = new Error("process failed");
        error.stdout = `prefix ${JSON.stringify({ error: "agent api rejected" })} suffix`;
        error.stderr = "";
        callback(error);
      })
      .mockImplementationOnce((command, args, options, callback) => {
        const error = new Error("plain failure");
        error.stdout = "";
        error.stderr = "plain stderr failure";
        callback(error);
      });

    const empty = await client.runAgentApi(["list"], { timeoutMs: 1 });
    assert.deepEqual(empty, {
      response: {},
      rawText: "",
      stdout: "",
      stderr: ""
    });
    assert.deepEqual(childProcessMock.execFile.mock.calls[0][1], ["agentapi", "list"]);

    await assert.rejects(
      () => client.runAgentApi(["list"], { timeoutMs: 1 }),
      (error) => {
        assert.equal(error.message, "agent api rejected");
        assert.deepEqual(error.agentApiResponse, { error: "agent api rejected" });
        assert.equal(error.stdout.includes("agent api rejected"), true);
        return true;
      }
    );

    await assert.rejects(
      () => client.runAgentApi(["list"], { timeoutMs: 1 }),
      (error) => {
        assert.equal(error.message, "plain failure");
        assert.equal(error.stdout, "");
        assert.equal(error.stderr, "plain stderr failure");
        return true;
      }
    );

    installHttpsResponse({
      statusCode: 500,
      body: JSON.stringify({
        error: "connect failed"
      })
    });
    const result = await callAntigravityConnectRpc({
      address: "127.0.0.1:9443",
      csrfToken: "csrf-token",
      method: "GetCascadeTrajectory",
      body: {
        cascadeId: "cascade-1"
      },
      timeoutMs: 1
    });
    assert.equal(result.ok, false);
    assert.equal(result.statusCode, 500);
    assert.equal(result.body.error, "connect failed");
    assert.equal(result.method, "GetCascadeTrajectory");

    const requestError = new Error("network down");
    installHttpsResponse({
      error: requestError
    });
    await assert.rejects(
      () => callAntigravityConnectRpc({
        address: "127.0.0.1:9443",
        csrfToken: "csrf-token",
        method: "GetCascadeTrajectory",
        body: {
          cascadeId: "cascade-2"
        },
        timeoutMs: 1
      }),
      /network down/
    );
  });
});
