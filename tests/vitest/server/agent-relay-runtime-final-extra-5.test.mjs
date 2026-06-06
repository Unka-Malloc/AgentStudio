import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { afterEach, describe, it, vi } from "vitest";

const httpsMock = vi.hoisted(() => ({
  request: vi.fn()
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
  AntigravityAgentApiClient,
  callAntigravityConnectRpc
} from "../../../server/platform/specialized/capabilities/agent-relay/acp-agent-relay/antigravity-agent-api-client.mjs";
import {
  AntigravityAgentApiConnection
} from "../../../server/platform/specialized/capabilities/agent-relay/acp-agent-relay/antigravity-agent-api-connection.mjs";
import {
  RelayOperationExecutor
} from "../../../server/platform/specialized/capabilities/agent-relay/acp-agent-relay/relay-operation-executor.mjs";

afterEach(() => {
  httpsMock.request.mockReset();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function makeRelayRoute() {
  return {
    relaySessionId: "relay-1",
    sourceId: "source-1",
    sourceSessionId: "source-session-1",
    virtualAgentId: "agent-1",
    workspaceId: "workspace-1",
    sourceSubjectId: "subject-1",
    policyRevision: 3,
    effectiveMode: "ask",
    turnFingerprint: "turn-fingerprint",
    virtualAgent: {
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
      metadata: {}
    },
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

function makeExecutorHarness() {
  const session = {
    relaySessionId: "relay-1",
    sourceId: "source-1",
    workspaceId: "workspace-1",
    sourceSessionId: "source-session-1",
    virtualAgentId: "agent-1",
    sourceSubjectId: "subject-1",
    lifecycleState: "active"
  };
  const route = makeRelayRoute();
  const store = {
    getSession: vi.fn(async (relaySessionId) => (relaySessionId === session.relaySessionId ? session : null)),
    getSessionBySourceKey: vi.fn(async () => session),
    updateSession: vi.fn(async (relaySessionId, patch) => ({
      ...session,
      relaySessionId,
      ...patch
    })),
    createPermissionRequest: vi.fn(async (payload) => ({
      requestId: payload.requestId,
      status: payload.status,
      reasonCode: "",
      details: payload.details,
      requestedAction: payload.requestedAction
    })),
    recordEvent: vi.fn(async () => {}),
    getTurn: vi.fn(async () => null),
    listEvents: vi.fn(async () => []),
    listPermissionRequests: vi.fn(async () => []),
    resolvePermissionRequest: vi.fn(async () => null)
  };
  const router = {
    resolveForSourceSession: vi.fn(async () => ({
      ok: true,
      route
    }))
  };
  const permissionBridge = {
    denyTerminal: vi.fn(({ command }) => ({
      ok: false,
      status: "denied",
      action: "terminal",
      reasonCode: "phase1_terminal_denied",
      message: `Denied: ${command}`
    })),
    readTextFile: vi.fn(async () => ({
      ok: false,
      status: "denied",
      action: "fs.readTextFile",
      reasonCode: "read_denied"
    })),
    requestWriteTextFile: vi.fn(async () => ({
      ok: false,
      status: "denied",
      action: "fs.writeTextFile",
      reasonCode: "write_denied"
    }))
  };
  const sessionDriver = {
    wake: vi.fn(async () => ({
      connection: {},
      wokenAt: "2026-06-05T10:00:00Z"
    })),
    prompt: vi.fn(async () => ({
      ok: true,
      updates: [],
      reasoning: [],
      stopReason: "completed",
      text: "done"
    })),
    cancel: vi.fn(async () => ({ ok: true })),
    closeSession: vi.fn(async () => ({ ok: true }))
  };
  const eventNormalizer = {
    progress: vi.fn((payload) => ({ type: "progress", redactedPayload: payload })),
    denial: vi.fn((payload) => ({ type: "denial", redactedPayload: payload })),
    receipt: vi.fn((payload) => ({ type: "receipt", redactedPayload: payload })),
    completion: vi.fn((payload) => ({ type: "completion", redactedPayload: payload })),
    reasoning: vi.fn((payload) => ({ type: "reasoning_trace", redactedPayload: payload }))
  };
  return {
    session,
    route,
    store,
    router,
    permissionBridge,
    sessionDriver,
    eventNormalizer
  };
}

function installHttpsResponseOnce({ statusCode = 200, body = "", timeoutMs = 0 } = {}) {
  let timeoutCallback = null;
  httpsMock.request.mockImplementationOnce((requestOptions, responseCallback) => {
    const request = new EventEmitter();
    request.setTimeout = vi.fn((ms, callback) => {
      timeoutCallback = callback;
      request.timeoutMs = ms;
    });
    request.destroy = vi.fn((error) => {
      request.emit("error", error);
    });
    request.end = vi.fn((payload) => {
      request.payload = payload;
      if (timeoutMs > 0) {
        return;
      }
      const response = new EventEmitter();
      response.statusCode = statusCode;
      response.setEncoding = vi.fn();
      responseCallback(response);
      if (body !== undefined) {
        response.emit("data", body);
      }
      response.emit("end");
    });
    request.__triggerTimeout = () => {
      if (typeof timeoutCallback === "function") {
        timeoutCallback();
      }
    };
    request.__options = requestOptions;
    return request;
  });
}

describe("agent relay runtime final extra 5", () => {
  it("covers bridge parsing, unsupported methods, relay executor unknown operations, and permission input boundaries", async () => {
    const logger = {
      error: vi.fn()
    };
    const bridge = new AcpSourceJsonRpcBridge({
      executor: {
        execute: vi.fn(async () => {
          throw new Error("bridge execution failed");
        })
      },
      logger
    });

    const parseError = await bridge.handle("{");
    assert.equal(parseError.error.code, -32700);

    const invalidBatch = await bridge.handle(JSON.stringify([
      {
        jsonrpc: "2.0",
        id: "batch-1"
      }
    ]));
    assert.equal(invalidBatch[0].error.code, -32600);
    assert.equal(invalidBatch[0].error.message, "Unknown or incomplete JSON-RPC message.");

    const unsupportedMethod = await bridge.handle(JSON.stringify({
      jsonrpc: "2.0",
      id: "unknown-1",
      method: "acp_agent_relay.not_supported"
    }));
    assert.equal(unsupportedMethod.error.code, -32601);
    assert.equal(unsupportedMethod.error.message, "Unsupported ACP method: acp_agent_relay.not_supported");

    const dispatchFailure = await bridge.handle(JSON.stringify({
      jsonrpc: "2.0",
      id: "agent-list-1",
      method: ACP_METHODS.agentList
    }));
    assert.equal(dispatchFailure.error.code, -32603);
    assert.equal(dispatchFailure.error.data.method, ACP_METHODS.agentList);
    assert.equal(logger.error.mock.calls.length, 1);

    const harness = makeExecutorHarness();
    const executor = new RelayOperationExecutor({
      virtualAgentRegistry: {
        listEnabled: vi.fn(() => [harness.route.virtualAgent]),
        getAgent: vi.fn(() => harness.route.virtualAgent)
      },
      targetRegistry: {
        getTarget: vi.fn(() => harness.route.target)
      },
      router: harness.router,
      store: harness.store,
      sessionDriver: harness.sessionDriver,
      eventNormalizer: harness.eventNormalizer,
      permissionBridge: harness.permissionBridge
    });

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

    const unknownOperation = await executor.execute("acp_agent_relay.nope", {});
    assert.equal(unknownOperation.ok, false);
    assert.equal(unknownOperation.error.code, "unknown_operation");

    const readDenied = await executor.readTextFile({
      relaySessionId: harness.session.relaySessionId,
      path: "file:///tmp/example.txt"
    });
    assert.equal(readDenied.ok, false);
    assert.equal(readDenied.error.code, "source_fs_read_not_advertised");

    const writeDenied = await executor.writeTextFile({
      relaySessionId: harness.session.relaySessionId,
      path: "../secret.txt",
      content: "top secret"
    });
    assert.equal(writeDenied.ok, false);
    assert.equal(writeDenied.error.code, "source_fs_write_not_advertised");

    const missingRequestId = await executor.resolvePermission({});
    assert.equal(missingRequestId.ok, false);
    assert.equal(missingRequestId.error.code, "permission_request_required");

    const notFoundRequest = await executor.resolvePermission({
      requestId: "missing-request"
    });
    assert.equal(notFoundRequest.ok, false);
    assert.equal(notFoundRequest.error.code, "permission_request_not_found");

    const unsupportedPermission = await executor.handleTargetAcpRequest({
      request: {
        method: ACP_METHODS.sessionRequestPermission,
        params: {
          permission: {
            action: "custom.interaction"
          }
        }
      },
      route: harness.route,
      session: harness.session,
      turn: {
        relayTurnId: "turn-1",
        metadata: {}
      },
      audit: {
        globalAuditId: "audit-1",
        artifactRef: "artifact-1",
        relayTurnId: "turn-1",
        policyRevision: 3,
        relayMcpGrantId: "grant-1"
      }
    });
    assert.equal(unsupportedPermission.result.approved, false);
    assert.equal(unsupportedPermission.result.reasonCode, "target_permission_action_unsupported");

    const deniedPermission = await executor.handleTargetAcpRequest({
      request: {
        method: ACP_METHODS.sessionRequestPermission,
        params: {
          permission: {
            action: "command",
            target: "echo hi"
          }
        }
      },
      route: harness.route,
      session: harness.session,
      turn: {
        relayTurnId: "turn-2",
        metadata: {}
      },
      audit: {
        globalAuditId: "audit-2",
        artifactRef: "artifact-2",
        relayTurnId: "turn-2",
        policyRevision: 3,
        relayMcpGrantId: "grant-2"
      }
    });
    assert.equal(deniedPermission.result.approved, false);
    assert.equal(deniedPermission.result.receipt.action, "terminal");
    assert.equal(harness.permissionBridge.denyTerminal.mock.calls.length >= 1, true);

    const pathDenied = await executor.handleTargetAcpRequest({
      request: {
        method: ACP_METHODS.sessionRequestPermission,
        params: {
          permission: {
            action: "fs.read_text_file",
            path: "/etc/passwd"
          }
        }
      },
      route: harness.route,
      session: harness.session,
      turn: {
        relayTurnId: "turn-3",
        metadata: {}
      },
      audit: {
        globalAuditId: "audit-3",
        artifactRef: "artifact-3",
        relayTurnId: "turn-3",
        policyRevision: 3,
        relayMcpGrantId: "grant-3"
      }
    });
    assert.equal(pathDenied.result.approved, false);
    assert.equal(pathDenied.result.reasonCode, "path_denied");
  });

  it("covers Antigravity Connect RPC headers, noisy JSON parsing, error responses, and timeout rejection", async () => {
    installHttpsResponseOnce({
      statusCode: 200,
      body: 'noise before {"response":{"conversationId":"conversation-1","recipientId":"recipient-1"}} noise after'
    });

    const parsed = await callAntigravityConnectRpc({
      address: "https://127.0.0.1:8443/api",
      csrfToken: "csrf-token",
      method: "GetConversationMetadata",
      body: {
        conversationId: "conversation-1"
      }
    });

    assert.equal(parsed.ok, true);
    assert.equal(parsed.statusCode, 200);
    assert.equal(parsed.body.response.conversationId, "conversation-1");
    const parsedRequest = httpsMock.request.mock.calls[0][0];
    assert.equal(parsedRequest.path, "/api/exa.language_server_pb.LanguageServerService/GetConversationMetadata");
    assert.equal(parsedRequest.headers["content-type"], "application/json");
    assert.equal(parsedRequest.headers.accept, "application/json");
    assert.equal(parsedRequest.headers["x-codeium-csrf-token"], "csrf-token");
    assert.equal(parsedRequest.headers["content-length"], Buffer.byteLength('{"conversationId":"conversation-1"}'));

    installHttpsResponseOnce({
      statusCode: 500,
      body: '{"error":"connect failed"}'
    });
    const client = new AntigravityAgentApiClient({
      address: "https://127.0.0.1:8443",
      csrfToken: "csrf-token"
    });
    await assert.rejects(
      () => client.runConnectRpc("GetConversationMetadata", {
        conversationId: "conversation-1"
      }, {
        endpoint: {
          address: "https://127.0.0.1:8443",
          csrfToken: "csrf-token"
        }
      }),
      /Antigravity Connect RPC GetConversationMetadata failed: connect failed/
    );

    installHttpsResponseOnce({
      timeoutMs: 1
    });
    const timeoutPromise = callAntigravityConnectRpc({
      address: "https://127.0.0.1:8443",
      csrfToken: "csrf-token",
      method: "WaitForConversationFullyIdle",
      body: {
        conversationId: "conversation-1"
      },
      timeoutMs: 1
    });
    const timeoutRequest = httpsMock.request.mock.results[2].value;
    timeoutRequest.__triggerTimeout();
    await assert.rejects(
      timeoutPromise,
      /Antigravity Connect RPC WaitForConversationFullyIdle timed out\./
    );
  });

  it("covers Antigravity agent API connection observation failures and ACP client timeout/close boundaries", async () => {
    const client = {
      getConversationMetadata: vi.fn(async () => {
        throw new Error("metadata unavailable");
      }),
      probeCapabilities: vi.fn(async () => {
        throw new Error("capability probe failed");
      }),
      sendMessage: vi.fn(async () => ({
        response: {
          sendMessage: true,
          conversationId: "conversation-1",
          recipientId: "conversation-1"
        },
        stdout: JSON.stringify({
          response: {
            sendMessage: true,
            conversationId: "conversation-1",
            recipientId: "conversation-1"
          }
        }),
        stderr: ""
      })),
      observeConnectTrajectory: vi.fn(async () => {
        throw new Error("connect observe failed");
      })
    };

    const connection = new AntigravityAgentApiConnection({
      target: {
        targetId: "target-1",
        transport: {
          agentApi: {
            connectEnabled: true,
            connectWaitForFinalResponse: false,
            conversationId: "conversation-1"
          }
        }
      },
      relaySession: {
        relaySessionId: "relay-1"
      },
      route: {
        virtualAgent: {
          virtualAgentId: "agent-1"
        },
        effectiveMode: "ask"
      },
      client
    });

    const initialized = await connection.initialize({
      relaySessionId: "relay-1"
    });
    assert.equal(initialized.ok, true);
    assert.equal(connection.capabilityProbe.error, "capability probe failed");

    const promptResult = await connection.sendPrompt({
      prompt: "check observation failure",
      marker: "marker-1"
    });
    assert.equal(promptResult.ok, true);
    assert.equal(promptResult.targetError.code, "antigravity_connect_observation_error");
    assert.equal(promptResult.connectObservationError, "connect observe failed");
    assert.equal(promptResult.externalCompletionState, "target_error");

    const connectionActions = [];
    let onClose = null;
    const transport = {
      send: vi.fn(async () => true),
      receive: vi.fn(async () => null),
      close: vi.fn(),
      onClose: vi.fn((callback) => {
        onClose = callback;
      })
    };
    vi.useFakeTimers();
    const acpConnection = new AcpClientConnection({
      target: {
        targetId: "target-2"
      },
      transport,
      requestTimeoutMs: 1
    });

    const pending = acpConnection.createPendingRequest({
      id: "pending-1"
    }, {
      method: "session/prompt"
    });
    const timeoutAssertion = assert.rejects(
      pending.promise,
      /Timed out waiting for target ACP session\/prompt response after 1ms\./
    );
    await vi.advanceTimersByTimeAsync(5);
    await timeoutAssertion;
    connectionActions.push(transport.close.mock.calls.length);
    assert.equal(acpConnection.closed, true);
    assert.equal(transport.close.mock.calls.length, 1);

    const closeTransport = {
      send: vi.fn(async () => true),
      receive: vi.fn(async () => null),
      close: vi.fn(),
      onClose: vi.fn((callback) => {
        onClose = callback;
      })
    };
    const closeConnection = new AcpClientConnection({
      target: {
        targetId: "target-3"
      },
      transport: closeTransport,
      requestTimeoutMs: 0
    });
    const closePending = closeConnection.createPendingRequest({
      id: "pending-2"
    }, {
      method: "session/prompt"
    });
    onClose({
      error: new Error("transport closed")
    });
    await assert.rejects(
      closePending.promise,
      /Target ACP transport is closed: transport closed\./
    );
    assert.equal(closeConnection.closed, true);
    assert.equal(closeConnection.lastTransportError, "transport closed");
    assert.equal(closeTransport.close.mock.calls.length, 0);
    assert.equal(connectionActions[0], 1);
  });

  it("covers relay session summaries, route blocking, and advertised source file operations", async () => {
    const harness = makeExecutorHarness();
    const turns = [
      {
        relayTurnId: "turn-old",
        relaySessionId: "relay-1",
        operationId: "acp_agent_relay.prompt.send",
        status: "completed",
        startedAt: "2026-06-05T09:00:00.000Z",
        updatedAt: "2026-06-05T09:00:01.000Z",
        metadata: {
          result: {
            communicationSummary: {
              outputSummary: "old"
            }
          }
        }
      },
      {
        relayTurnId: "turn-new",
        relaySessionId: "relay-1",
        operationId: "acp_agent_relay.prompt.send",
        status: "pending_permission",
        startedAt: "2026-06-05T09:01:00.000Z",
        updatedAt: "2026-06-05T09:01:01.000Z"
      }
    ];
    harness.store.listSessions = vi.fn(async () => [
      {
        ...harness.session,
        relaySessionId: "foreign",
        sourceId: "other-source",
        updatedAt: "2026-06-05T09:02:00.000Z"
      },
      {
        ...harness.session,
        updatedAt: "2026-06-05T09:01:00.000Z",
        metadata: {
          lastWakeResult: {
            ok: true,
            targetSessionId: "target-session-secret",
            targetResumeRef: "resume-secret"
          }
        }
      }
    ]);
    harness.store.listTurns = vi.fn(async (relaySessionId) => (relaySessionId === "relay-1" ? turns : []));
    harness.store.listPermissionRequests = vi.fn(async (relayTurnId) => (
      relayTurnId === "turn-new"
        ? [{ requestId: "perm-1", status: "pending" }]
        : [{ requestId: "perm-2", status: "approved" }]
    ));
    harness.route.decision.advertisedTools = ["fs.readTextFile", "fs.writeTextFile"];
    harness.permissionBridge.readTextFile
      .mockRejectedValueOnce(new Error("read bridge unavailable"))
      .mockResolvedValueOnce({
        ok: true,
        status: "completed",
        action: "fs.readTextFile",
        path: "notes.txt",
        digest: "digest-1",
        content: "hello"
      });
    harness.permissionBridge.requestWriteTextFile.mockResolvedValueOnce({
      ok: true,
      status: "completed",
      action: "fs.writeTextFile",
      path: "notes.txt",
      payloadHash: "hash-1"
    });

    const executor = new RelayOperationExecutor({
      virtualAgentRegistry: {
        listEnabled: vi.fn(() => [harness.route.virtualAgent]),
        getAgent: vi.fn(() => harness.route.virtualAgent)
      },
      targetRegistry: {
        listTargets: vi.fn(() => [harness.route.target]),
        getTarget: vi.fn(() => harness.route.target)
      },
      router: harness.router,
      store: harness.store,
      sessionDriver: harness.sessionDriver,
      eventNormalizer: harness.eventNormalizer,
      permissionBridge: harness.permissionBridge
    });

    const sessionList = await executor.execute("acp_agent_relay.sessions.list", {
      sourceId: "source-1",
      limit: 1
    });
    assert.equal(sessionList.ok, true);
    assert.equal(sessionList.data.count, 1);
    assert.equal(sessionList.data.sessions[0].pendingPermissionCount, 1);
    assert.equal(sessionList.data.sessions[0].latestTurn.relayTurnId, "turn-new");

    const missingGetId = await executor.execute("acp_agent_relay.sessions.get", {});
    assert.equal(missingGetId.ok, false);
    assert.equal(missingGetId.error.code, "relay_session_id_required");

    const filteredGet = await executor.execute("acp_agent_relay.sessions.get", {
      relaySessionId: "relay-1",
      sourceId: "other-source"
    });
    assert.equal(filteredGet.ok, false);
    assert.equal(filteredGet.error.code, "relay_session_not_found");

    const turnList = await executor.execute("acp_agent_relay.turns.list", {
      relaySessionId: "relay-1",
      limit: 1
    });
    assert.equal(turnList.ok, true);
    assert.equal(turnList.data.turns[0].relayTurnId, "turn-new");
    assert.equal(turnList.data.turns[0].pendingPermissionCount, 1);

    const missingTurnId = await executor.execute("acp_agent_relay.turns.list", {});
    assert.equal(missingTurnId.ok, false);
    assert.equal(missingTurnId.error.code, "relay_session_id_required");

    const readFailure = await executor.execute("acp_agent_relay.fs.read_text_file", {
      relaySessionId: "relay-1",
      path: "notes.txt"
    });
    assert.equal(readFailure.ok, false);
    assert.equal(readFailure.error.code, "read_failed");
    assert.equal(readFailure.error.details.receipt.reasonCode, "read_failed");

    const readSuccess = await executor.execute("acp_agent_relay.fs.read_text_file", {
      relaySessionId: "relay-1",
      path: "notes.txt"
    });
    assert.equal(readSuccess.ok, true);
    assert.equal(readSuccess.data.content, "hello");
    assert.equal(readSuccess.data.receipt.digest, "digest-1");

    const writeSuccess = await executor.execute("acp_agent_relay.fs.write_text_file", {
      relaySessionId: "relay-1",
      path: "notes.txt",
      content: "hello"
    });
    assert.equal(writeSuccess.ok, true);
    assert.equal(writeSuccess.data.receipt.payloadHash, "hash-1");

    harness.router.resolveForSourceSession.mockResolvedValueOnce({
      ok: false,
      error: {
        code: "route_blocked",
        message: "route blocked"
      }
    });
    const blockedWake = await executor.execute("acp_agent_relay.session.wake", {
      relaySessionId: "relay-1"
    });
    assert.equal(blockedWake.ok, false);
    assert.equal(blockedWake.error.code, "route_blocked");
    assert.equal(harness.store.updateSession.mock.calls.some((call) => call[1]?.lifecycleState === "blocked"), true);

    const noAgentExecutor = new RelayOperationExecutor({
      virtualAgentRegistry: {
        getAgent: vi.fn(() => null)
      },
      targetRegistry: {
        getTarget: vi.fn(() => null)
      },
      router: harness.router,
      store: harness.store,
      sessionDriver: harness.sessionDriver,
      eventNormalizer: harness.eventNormalizer,
      permissionBridge: harness.permissionBridge
    });
    const resumedWithoutAgent = await noAgentExecutor.execute("acp_agent_relay.session.resume", {
      relaySessionId: "relay-1"
    });
    assert.equal(resumedWithoutAgent.ok, true);
    assert.equal(resumedWithoutAgent.data.capabilities, null);
    assert.equal(resumedWithoutAgent.data.capabilitiesSnapshot, null);
  });
});
