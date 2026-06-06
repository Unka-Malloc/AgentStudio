import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it, vi } from "vitest";

import { ACP_METHODS } from "../../../server/platform/common/protocols/acp/index.mjs";
import {
  AcpClientConnection
} from "../../../server/platform/specialized/capabilities/agent-relay/acp-agent-relay/acp-client-connection.mjs";
import {
  AcpSourceJsonRpcBridge
} from "../../../server/platform/specialized/capabilities/agent-relay/acp-agent-relay/acp-source-json-rpc-bridge.mjs";
import {
  RelayOperationExecutor
} from "../../../server/platform/specialized/capabilities/agent-relay/acp-agent-relay/relay-operation-executor.mjs";
import {
  RelaySessionStore,
  createFileRelaySessionAdapter
} from "../../../server/platform/specialized/capabilities/agent-relay/acp-agent-relay/relay-session-store.mjs";
import {
  discoverAntigravityConnectEndpoint,
  normalizeAntigravityAgentApiResponse,
  redactAntigravityConnectEndpoint
} from "../../../server/platform/specialized/capabilities/agent-relay/acp-agent-relay/antigravity-agent-api-client.mjs";

const tempRoots = [];

async function makeTempRoot(prefix = "pact-acp-agent-relay-final-second-extra-") {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

function makeRelaySession() {
  return {
    relaySessionId: "relay-1",
    sourceId: "source-1",
    sourceSessionId: "source-session-1",
    virtualAgentId: "agent-1",
    targetId: "target-1",
    workspaceId: "workspace-1",
    sourceSubjectId: "subject-1",
    lifecycleState: "active",
    relayMcpGrantId: "grant-1",
    policyRevision: 3
  };
}

function makeRoute() {
  return {
    relaySessionId: "relay-1",
    sourceId: "source-1",
    sourceSessionId: "source-session-1",
    virtualAgentId: "agent-1",
    workspaceId: "workspace-1",
    sourceSubjectId: "subject-1",
    policyRevision: 3,
    effectiveMode: "ask",
    turnFingerprint: "fingerprint",
    virtualAgent: {
      virtualAgentId: "agent-1",
      targetId: "target-1"
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

afterEach(async () => {
  vi.restoreAllMocks();
  const roots = tempRoots.splice(0);
  await Promise.all(roots.map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("acp agent relay final second extra coverage", () => {
  it("keeps the relay session store stable through file fallback and detail sanitization", async () => {
    const tempRoot = await makeTempRoot();
    const storagePath = path.join(tempRoot, "relay-store.json");
    await fs.writeFile(storagePath, "{broken-json", "utf8");

    const store = new RelaySessionStore({
      adapter: createFileRelaySessionAdapter({ filePath: storagePath })
    });

    const session = await store.createSession({
      sourceId: "source-1",
      sourceSessionId: "source-session-1",
      virtualAgentId: "agent-1",
      targetId: "target-1",
      workspaceId: "workspace-1",
      sourcePayload: {
        adapterHint: "file-bridge",
        createdBy: "vitest",
        metadata: {
          note: "kept"
        }
      }
    });

    assert.equal(session.metadata.adapterHint, "file-bridge");
    assert.equal(session.metadata.createdBy, "vitest");
    assert.equal(await store.updateSession("missing", { lifecycleState: "closed" }), null);
    assert.equal(
      (await store.getSessionBySourceKey({
        sourceId: "source-1",
        workspaceId: "workspace-1",
        sourceSessionId: "source-session-1",
        virtualAgentId: "agent-1"
      })).relaySessionId,
      session.relaySessionId
    );

    const earlierTurn = await store.createTurn({
      relaySessionId: session.relaySessionId,
      idempotencyKey: "dup-key",
      startedAt: "2026-06-05T10:00:00Z",
      updatedAt: "2026-06-05T10:00:00Z",
      status: "completed"
    });
    const laterTurn = await store.createTurn({
      relaySessionId: session.relaySessionId,
      idempotencyKey: "dup-key",
      startedAt: "2026-06-05T10:00:01Z",
      updatedAt: "2026-06-05T10:00:02Z",
      status: "running"
    });

    assert.equal((await store.getTurnByIdempotencyKey(session.relaySessionId, "dup-key")).relayTurnId, laterTurn.relayTurnId);
    assert.equal(await store.getTurnByIdempotencyKey(session.relaySessionId, ""), null);

    const permission = await store.createPermissionRequest({
      relayTurnId: earlierTurn.relayTurnId,
      targetToolCallId: "tool-call-1",
      requestedAction: "fs.writeTextFile",
      details: {
        path: "/tmp/allowed.txt",
        content: "secret",
        text: "secret",
        promptText: "prompt",
        rawTranscript: "transcript",
        extra: "kept"
      }
    });

    assert.equal(permission.details.path, "/tmp/allowed.txt");
    assert.equal(permission.details.extra, "kept");
    assert.equal("content" in permission.details, false);
    assert.equal("text" in permission.details, false);
    assert.equal("promptText" in permission.details, false);
    assert.equal("rawTranscript" in permission.details, false);

    const saved = JSON.parse(await fs.readFile(storagePath, "utf8"));
    assert.equal(saved.sessions[session.relaySessionId].metadata.adapterHint, "file-bridge");
    assert.equal(saved.permissionRequests[permission.requestId].details.extra, "kept");
  });

  it("covers target callback errors, pending approvals, response errors, and session-update collection", async () => {
    const sent = [];
    const transport = {
      send: vi.fn(async (message) => {
        sent.push(message);
        return true;
      }),
      receive: vi.fn(async () => null),
      close: vi.fn()
    };
    const connection = new AcpClientConnection({
      target: { targetId: "target-1" },
      transport,
      requestTimeoutMs: 0
    });

    await connection.handleTargetRequest(
      {
        jsonrpc: "2.0",
        id: "callback-1",
        method: "target/callback",
        params: {
          foo: "bar"
        }
      },
      {
        handleRequest: async () => ({
          error: {
            code: 418,
            message: "teapot",
            data: {
              brew: true
            }
          }
        })
      }
    );

    await connection.handleTargetRequest(
      {
        jsonrpc: "2.0",
        id: "callback-2",
        method: "target/unsupported",
        params: {}
      },
      {}
    );

    assert.equal(sent[0].error.code, 418);
    assert.equal(sent[0].error.message, "teapot");
    assert.deepEqual(sent[0].error.data, { brew: true });
    assert.equal(sent[1].error.code, -32601);
    assert.equal(sent[1].error.message, "Unsupported target ACP callback method: target/unsupported");

    const pendingTransport = {
      send: vi.fn(async () => true),
      receive: vi.fn(async () => null),
      close: vi.fn()
    };
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
    const pendingResult = await pendingEntry.promise;
    assert.equal(pendingResult.result.stopReason, "approval_pending");
    assert.equal(pendingResult.result.targetResponse.pendingApproval, true);
    assert.equal(pendingResult.updates[0].phase, "approval_pending");
    assert.equal(pendingTransport.close.mock.calls.length, 1);
    assert.equal(pendingConnection.closed, true);

    const updateTransport = {
      send: vi.fn(async () => true),
      receive: vi.fn(async () => null),
      close: vi.fn()
    };
    const updateConnection = new AcpClientConnection({
      target: { targetId: "target-3" },
      transport: updateTransport,
      requestTimeoutMs: 0
    });
    const updateEntry = updateConnection.createPendingRequest(
      { id: "update-1" },
      {
        method: "session/prompt",
        collectUpdates: true
      }
    );

    await updateConnection.dispatchIncomingMessage({
      jsonrpc: "2.0",
      method: ACP_METHODS.sessionUpdate,
      params: {
        phase: "working",
        text: "step"
      }
    });
    assert.deepEqual(updateEntry.updates, [{ phase: "working", text: "step" }]);

    const errorTransport = {
      send: vi.fn(async () => true),
      receive: vi.fn(async () => null),
      close: vi.fn()
    };
    const errorConnection = new AcpClientConnection({
      target: { targetId: "target-4" },
      transport: errorTransport,
      requestTimeoutMs: 0
    });
    const errorEntry = errorConnection.createPendingRequest(
      { id: "response-1" },
      {
        method: "session/prompt"
      }
    );

    const rejection = assert.rejects(errorEntry.promise, (error) => {
      assert.equal(error.message, "target fail");
      assert.equal(error.code, -32003);
      assert.deepEqual(error.data, { reason: "boom" });
      return true;
    });

    await errorConnection.dispatchIncomingMessage({
      jsonrpc: "2.0",
      id: "response-1",
      error: {
        code: -32003,
        message: "target fail",
        data: {
          reason: "boom"
        }
      }
    });
    await rejection;
  });

  it("rejects malformed source JSON-RPC input and resolves source bridge error paths", async () => {
    const session = makeRelaySession();
    const bridge = new AcpSourceJsonRpcBridge({
      inboundFacade: {
        async loadSession() {
          return {
            ok: true,
            data: {
              session,
              capabilities: {
                read: true
              },
              capabilitiesSnapshot: {
                capabilities: {
                  read: true,
                  write: false
                },
                route: {
                  decision: {
                    advertisedTools: ["tool.alpha"]
                  }
                }
              },
              capabilitiesSnapshotError: ""
            }
          };
        }
      },
      executor: {},
      store: {
        async getSession() {
          return session;
        },
        async getSessionBySourceKey() {
          return session;
        }
      }
    });

    const parseError = await bridge.handle(Buffer.from("not-json"));
    const batchError = await bridge.handleBatch([]);
    const methodError = await bridge.dispatch({
      jsonrpc: "2.0",
      id: "rpc-1",
      method: "bogus.method",
      params: {}
    });
    const initializeError = await bridge.initialize("init-1", {}, {});
    const loadSuccess = await bridge.loadSession(
      "load-1",
      {},
      {
        sourceId: "source-1",
        workspaceId: "workspace-1",
        sourceSessionId: "source-session-1",
        virtualAgentId: "agent-1"
      }
    );
    const missingLoad = await bridge.loadSession("load-2", {}, {});
    const routeError = await bridge.resolveRouteForSourceFs({}, {});
    const readError = await bridge.readTextFile("read-1", { path: "file:///tmp/example.txt" }, {});
    const writeError = await bridge.writeTextFile("write-1", { path: "file:///tmp/example.txt", content: "x" }, {});

    assert.equal(parseError.error.code, -32700);
    assert.equal(batchError.error.code, -32600);
    assert.equal(methodError.error.code, -32601);
    assert.equal(initializeError.error.code, -32600);
    assert.equal(loadSuccess.result.capabilitiesSnapshot.capabilities.write, false);
    assert.deepEqual(loadSuccess.result.capabilitiesSnapshot.route.decision.advertisedTools, ["tool.alpha"]);
    assert.equal(missingLoad.result.capabilitiesSnapshotError, "");
    assert.equal(routeError.ok, false);
    assert.equal(routeError.error.code, "relay_router_unavailable");
    assert.equal(readError.error.message, "ACP relay file bridge is unavailable.");
    assert.equal(writeError.error.message, "ACP relay file bridge is unavailable.");
  });

  it("keeps relay executor boundary checks and antigravity helpers on their fallback paths", async () => {
    const session = makeRelaySession();
    const store = {
      async getSession(relaySessionId) {
        return relaySessionId === session.relaySessionId ? session : null;
      },
      async getSessionBySourceKey(input = {}) {
        return input.sourceId === session.sourceId &&
          input.workspaceId === session.workspaceId &&
          input.sourceSessionId === session.sourceSessionId &&
          input.virtualAgentId === session.virtualAgentId
          ? session
          : null;
      },
      async getTurnByIdempotencyKey() {
        return {
          relayTurnId: "turn-existing",
          relaySessionId: session.relaySessionId,
          metadata: {
            idempotency: {
              requestFingerprint: "different-fingerprint"
            }
          }
        };
      },
      async getPermissionRequest(requestId) {
        if (requestId === "completed") {
          return {
            requestId: "completed",
            relayTurnId: "turn-1",
            status: "completed",
            details: {
              receipt: {
                ok: true
              }
            }
          };
        }
        if (requestId === "stale") {
          return {
            requestId: "stale",
            relayTurnId: "turn-1",
            status: "denied",
            details: {}
          };
        }
        return null;
      },
      async getTurn() {
        return {
          relayTurnId: "turn-1",
          relaySessionId: session.relaySessionId,
          metadata: {}
        };
      },
      async listEvents() {
        return [];
      }
    };
    const router = {
      async resolveForSourceSession() {
        return {
          ok: true,
          route: makeRoute()
        };
      }
    };
    const executor = new RelayOperationExecutor({
      virtualAgentRegistry: {
        listEnabled() {
          return [];
        },
        getAgent() {
          return null;
        }
      },
      targetRegistry: {
        listTargets() {
          return [];
        },
        getTarget() {
          return makeRoute().target;
        }
      },
      router,
      store,
      sessionDriver: {},
      eventNormalizer: {
        progress(value) {
          return { type: "progress", redactedPayload: value };
        },
        receipt(value) {
          return { type: "receipt", redactedPayload: value };
        },
        denial(value) {
          return { type: "denial", redactedPayload: value };
        },
        completion(value) {
          return { type: "completion", redactedPayload: value };
        }
      },
      permissionBridge: {
        denyTerminal() {
          return { ok: false, status: "denied", action: "terminal", reasonCode: "terminal_denied" };
        },
        async readTextFile() {
          return { ok: true };
        },
        async requestWriteTextFile() {
          return { ok: true };
        }
      },
      operationGuard: {
        async preflight() {
          return { ok: true };
        }
      }
    });

    const guarded = new RelayOperationExecutor({
      virtualAgentRegistry: executor.virtualAgentRegistry,
      targetRegistry: executor.targetRegistry,
      router,
      store,
      sessionDriver: {},
      eventNormalizer: executor.eventNormalizer,
      permissionBridge: executor.permissionBridge,
      operationGuard: {
        async preflight() {
          return {
            ok: false,
            error: {
              code: "guarded",
              message: "blocked"
            },
            decision: {
              policy: "deny"
            }
          };
        }
      }
    });

    const guardedResult = await guarded.execute("acp_agent_relay.session.create", {});
    assert.equal(guardedResult.ok, false);
    assert.equal(guardedResult.error.code, "guarded");
    assert.equal(guardedResult.error.details.sourceAuthorizationDecision.policy, "deny");

    const unknownOperation = await executor.execute("acp_agent_relay.unknown", {});
    assert.equal(unknownOperation.ok, false);
    assert.equal(unknownOperation.error.code, "unknown_operation");

    const idempotencyConflict = await executor.sendPrompt({
      relaySessionId: session.relaySessionId,
      sourceId: session.sourceId,
      workspaceId: session.workspaceId,
      sourceSessionId: session.sourceSessionId,
      virtualAgentId: session.virtualAgentId,
      idempotencyKey: "dup-key",
      prompt: "hello"
    });
    assert.equal(idempotencyConflict.ok, false);
    assert.equal(idempotencyConflict.error.code, "idempotency_key_conflict");

    const readDenied = await executor.readTextFile({
      relaySessionId: session.relaySessionId,
      sourceId: session.sourceId,
      workspaceId: session.workspaceId,
      sourceSessionId: session.sourceSessionId,
      virtualAgentId: session.virtualAgentId,
      path: "file:///tmp/relay-read.txt"
    });
    const writeDenied = await executor.writeTextFile({
      relaySessionId: session.relaySessionId,
      sourceId: session.sourceId,
      workspaceId: session.workspaceId,
      sourceSessionId: session.sourceSessionId,
      virtualAgentId: session.virtualAgentId,
      path: "file:///tmp/relay-write.txt",
      content: "payload"
    });
    assert.equal(readDenied.error.code, "source_fs_read_not_advertised");
    assert.equal(writeDenied.error.code, "source_fs_write_not_advertised");

    const missingRequestId = await executor.resolvePermission({});
    const completedRequest = await executor.resolvePermission({ requestId: "completed" });
    const staleRequest = await executor.resolvePermission({ requestId: "stale" });
    assert.equal(missingRequestId.error.code, "permission_request_required");
    assert.equal(completedRequest.ok, true);
    assert.equal(completedRequest.data.alreadyResolved, true);
    assert.equal(staleRequest.error.code, "permission_request_not_pending");

    assert.deepEqual(
      redactAntigravityConnectEndpoint({
        address: "127.0.0.1:8443",
        source: "env",
        protocol: "custom",
        tls: false,
        csrfToken: "csrf-token"
      }),
      {
        address: "127.0.0.1:8443",
        source: "env",
        protocol: "custom",
        tls: false,
        hasCsrfToken: true
      }
    );

    assert.deepEqual(
      await discoverAntigravityConnectEndpoint({
        env: {
          PACT_ACP_RELAY_ANTIGRAVITY_CONNECT_ADDRESS: "127.0.0.1:8443",
          PACT_ACP_RELAY_ANTIGRAVITY_CONNECT_CSRF_TOKEN: "csrf-token"
        }
      }),
      {
        address: "127.0.0.1:8443",
        csrfToken: "csrf-token",
        source: "env",
        protocol: "connect-json",
        tls: true
      }
    );

    assert.equal(
      normalizeAntigravityAgentApiResponse(
        {
          response: {
            error: true
          }
        },
        {
          stdout: "conversation id: conv-9 recipient id: rec-9"
        }
      ).stopReason,
      "error"
    );
  });
});
