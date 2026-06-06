import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
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
  AcpSourceJsonRpcService
} from "../../../server/platform/specialized/capabilities/agent-relay/acp-agent-relay/acp-source-json-rpc-service.mjs";
import {
  AntigravityAgentApiClient,
  callAntigravityConnectRpc
} from "../../../server/platform/specialized/capabilities/agent-relay/acp-agent-relay/antigravity-agent-api-client.mjs";
import { RelayOperationExecutor } from "../../../server/platform/specialized/capabilities/agent-relay/acp-agent-relay/relay-operation-executor.mjs";

afterEach(() => {
  childProcessMock.execFile.mockReset();
  httpsMock.request.mockReset();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("agent relay ACP final extra coverage 3", () => {
  it("covers JSON-RPC parse, invalid request, unsupported method, and service error handling", async () => {
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

    const invalidRequest = await bridge.handle(JSON.stringify([
      {
        jsonrpc: "2.0",
        id: "invalid-1"
      }
    ]));
    assert.equal(invalidRequest[0].error.code, -32600);
    assert.equal(invalidRequest[0].error.message, "Unknown or incomplete JSON-RPC message.");

    const unknownMethod = await bridge.handle(JSON.stringify({
      jsonrpc: "2.0",
      id: "unknown-1",
      method: "acp_agent_relay.not_supported"
    }));
    assert.equal(unknownMethod.error.code, -32601);
    assert.equal(unknownMethod.error.message, "Unsupported ACP method: acp_agent_relay.not_supported");

    const bridgedError = await bridge.handle(JSON.stringify({
      jsonrpc: "2.0",
      id: "error-1",
      method: ACP_METHODS.fsReadTextFile,
      params: {
        path: "file:///tmp/example.txt"
      }
    }));
    assert.equal(bridgedError.error.code, -32603);
    assert.equal(bridgedError.error.message, "bridge execution failed");
    assert.equal(bridgedError.error.data.method, ACP_METHODS.fsReadTextFile);
    assert.equal(logger.error.mock.calls.length, 1);

    const runtime = {
      handleSourceAcpMessage: vi.fn(async (message) => {
        const parsed = JSON.parse(String(message));
        if (parsed.method === "explode") {
          throw new Error("service boom");
        }
        return null;
      })
    };
    const sent = [];
    const service = new AcpSourceJsonRpcService({
      runtime,
      logger
    });
    const frames = [
      JSON.stringify({
        jsonrpc: "2.0",
        id: 7,
        method: "explode",
        params: {
          ping: true
        }
      }),
      JSON.stringify({
        jsonrpc: "2.0",
        method: "notify-only",
        params: {
          ping: true
        }
      }),
      null
    ];
    const transport = {
      receive: vi.fn(async () => frames.shift() ?? null),
      send: vi.fn(async (payload) => {
        sent.push(JSON.parse(typeof payload === "string" ? payload : Buffer.from(payload).toString("utf8")));
        return true;
      })
    };

    await service.serveTransport(transport, {
      sourceIdentity: {
        sourceId: "source-1"
      }
    });
    service.close();

    assert.equal(service.closed, true);
    assert.equal(runtime.handleSourceAcpMessage.mock.calls.length, 2);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].error.code, -32603);
    assert.equal(sent[0].error.message, "service boom");
    assert.equal(logger.error.mock.calls.length >= 2, true);
  });

  it("covers connection close, timeout, and cancel boundaries", async () => {
    const cancelTransport = {
      send: vi.fn(async () => true),
      receive: vi.fn(async () => null),
      close: vi.fn()
    };
    const cancelConnection = new AcpClientConnection({
      target: {
        targetId: "target-cancel"
      },
      transport: null
    });
    const cancelResult = await cancelConnection.cancel({
      reason: "stop"
    });
    assert.equal(cancelResult.ok, true);
    assert.equal(cancelConnection.messages.length, 1);
    assert.equal(cancelConnection.messages[0].message.method, ACP_METHODS.sessionCancel);

    vi.useFakeTimers();
    const timeoutConnection = new AcpClientConnection({
      target: {
        targetId: "target-timeout"
      },
      transport: cancelTransport,
      requestTimeoutMs: 1
    });
    const timeoutPending = timeoutConnection.createPendingRequest(
      {
        id: "timeout-1"
      },
      {
        method: "session/prompt"
      }
    );
    const timeoutRejection = assert.rejects(timeoutPending.promise, /Timed out waiting for target ACP session\/prompt response after 1ms\./);
    await vi.advanceTimersByTimeAsync(5);
    await timeoutRejection;
    assert.equal(timeoutConnection.closed, true);
    assert.equal(cancelTransport.close.mock.calls.length, 1);

    const closeEvents = [];
    let onClose = null;
    const closedTransport = {
      send: vi.fn(async () => true),
      receive: vi.fn(async () => null),
      close: vi.fn(),
      onClose: vi.fn((callback) => {
        onClose = callback;
      })
    };
    const closeConnection = new AcpClientConnection({
      target: {
        targetId: "target-close"
      },
      transport: closedTransport,
      requestTimeoutMs: 0
    });
    const closePending = closeConnection.createPendingRequest(
      {
        id: "close-1"
      },
      {
        method: "session/prompt"
      }
    );
    onClose({
      error: new Error("transport closed")
    });
    await assert.rejects(closePending.promise, /Target ACP transport is closed: transport closed\./);
    assert.equal(closeConnection.closed, true);
    assert.equal(closeConnection.lastTransportError, "transport closed");
    assert.equal(closedTransport.close.mock.calls.length, 0);

    const receiveCloseTransport = {
      send: vi.fn(async () => true),
      receive: vi.fn(async () => null),
      close: vi.fn()
    };
    const receiveCloseConnection = new AcpClientConnection({
      target: {
        targetId: "target-receive-close"
      },
      transport: receiveCloseTransport,
      requestTimeoutMs: 0
    });
    await assert.rejects(
      () => receiveCloseConnection.request(ACP_METHODS.sessionPrompt, {
        relaySessionId: "relay-1"
      }),
      /Target ACP transport closed before response for session\/prompt\./
    );
    assert.equal(receiveCloseConnection.closed, false);
  });

  it("wraps Agent API failures and Connect RPC timeouts", async () => {
    childProcessMock.execFile.mockImplementationOnce((command, args, options, callback) => {
      const error = new Error("process failed");
      error.stdout = JSON.stringify({
        error: "agent api rejected"
      });
      error.stderr = "";
      callback(error);
    });

    const client = new AntigravityAgentApiClient({
      binaryPath: process.execPath,
      address: "127.0.0.1:9000",
      csrfToken: "csrf-token"
    });

    await assert.rejects(
      () => client.runAgentApi(["list"], {
        timeoutMs: 1
      }),
      (error) => {
        assert.equal(error.message, "agent api rejected");
        assert.deepEqual(error.agentApiResponse, {
          error: "agent api rejected"
        });
        assert.equal(error.stdout, JSON.stringify({
          error: "agent api rejected"
        }));
        assert.equal(error.stderr, "");
        return true;
      }
    );
    assert.deepEqual(childProcessMock.execFile.mock.calls[0][1], ["agentapi", "list"]);

    httpsMock.request.mockImplementationOnce((requestOptions, responseCallback) => {
      const request = new EventEmitter();
      let timeoutHandler = null;
      request.setTimeout = vi.fn((ms, handler) => {
        timeoutHandler = handler;
      });
      request.destroy = vi.fn((error) => {
        request.emit("error", error);
      });
      request.on = vi.fn(request.on.bind(request));
      request.end = vi.fn(() => {
        timeoutHandler?.();
      });
      return request;
    });

    await assert.rejects(
      () => callAntigravityConnectRpc({
        address: "127.0.0.1:9443",
        csrfToken: "csrf-token",
        method: "GetConversationMetadata",
        body: {
          conversationId: "conversation-1"
        },
        timeoutMs: 1
      }),
      /timed out/
    );
  });

  it("short-circuits unsupported relay operations and preflight failures", async () => {
    const guard = {
      preflight: vi.fn(async ({ operationId }) => {
        if (operationId === "acp_agent_relay.session.cancel") {
          return {
            ok: false,
            error: {
              code: "blocked_by_guard",
              message: "guard blocked"
            },
            decision: {
              reason: "test"
            }
          };
        }
        return {
          ok: true
        };
      })
    };
    const sessionDriver = {
      cancel: vi.fn(),
      closeSession: vi.fn(),
      wake: vi.fn(),
      prompt: vi.fn()
    };
    const executor = new RelayOperationExecutor({
      virtualAgentRegistry: {
        listEnabled: vi.fn(() => []),
        getAgent: vi.fn()
      },
      targetRegistry: {
        listTargets: vi.fn(() => []),
        getTarget: vi.fn()
      },
      router: {
        resolveForSourceSession: vi.fn()
      },
      store: {
        getSession: vi.fn(),
        getSessionBySourceKey: vi.fn()
      },
      sessionDriver,
      eventNormalizer: {},
      permissionBridge: {},
      operationGuard: guard
    });

    const blocked = await executor.execute("acp_agent_relay.session.cancel", {
      relaySessionId: "relay-1"
    });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.error.code, "blocked_by_guard");
    assert.equal(blocked.error.details.sourceAuthorizationDecision.reason, "test");
    assert.equal(sessionDriver.cancel.mock.calls.length, 0);

    const unknown = await executor.execute("acp_agent_relay.not_supported", {});
    assert.equal(unknown.ok, false);
    assert.equal(unknown.error.code, "unknown_operation");
    assert.equal(unknown.error.message, "Unknown ACP relay operation: acp_agent_relay.not_supported");
  });
});
