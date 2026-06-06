import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { afterEach, describe, it, vi } from "vitest";

const childProcessMock = vi.hoisted(() => ({
  execFile: vi.fn()
}));

const httpsMock = vi.hoisted(() => ({
  request: vi.fn()
}));

const sourceJsonRpcMock = vi.hoisted(() => ({
  createAcpSourceJsonRpcLineTransport: vi.fn(),
  createAcpSourceJsonRpcService: vi.fn()
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

vi.mock("../../../server/platform/specialized/capabilities/agent-relay/acp-agent-relay/acp-source-json-rpc-service.mjs", () => sourceJsonRpcMock);

import { AcpClientConnection } from "../../../server/platform/specialized/capabilities/agent-relay/acp-agent-relay/acp-client-connection.mjs";
import { AcpSourceJsonRpcBridge } from "../../../server/platform/specialized/capabilities/agent-relay/acp-agent-relay/acp-source-json-rpc-bridge.mjs";
import { ACP_METHODS } from "../../../server/platform/common/protocols/acp/index.mjs";
import {
  AntigravityAgentApiClient,
  callAntigravityConnectRpc,
  normalizeAntigravityAgentApiResponse
} from "../../../server/platform/specialized/capabilities/agent-relay/acp-agent-relay/antigravity-agent-api-client.mjs";
import { AntigravityAgentApiConnection } from "../../../server/platform/specialized/capabilities/agent-relay/acp-agent-relay/antigravity-agent-api-connection.mjs";
import { RelayOperationExecutor } from "../../../server/platform/specialized/capabilities/agent-relay/acp-agent-relay/relay-operation-executor.mjs";
import {
  createAcpSourceStdioServer,
  createAcpSourceStdioServerOptionsFromEnv
} from "../../../server/platform/specialized/capabilities/agent-relay/acp-agent-relay/acp-source-stdio-server.mjs";

afterEach(() => {
  childProcessMock.execFile.mockReset();
  httpsMock.request.mockReset();
  sourceJsonRpcMock.createAcpSourceJsonRpcLineTransport.mockReset();
  sourceJsonRpcMock.createAcpSourceJsonRpcService.mockReset();
  vi.restoreAllMocks();
});

describe("agent relay ACP final extra coverage", () => {
  it("handles binary JSON-RPC input, ignores response messages, and logs bridge dispatch failures", async () => {
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

    const response = await bridge.handle(
      Buffer.from(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: ACP_METHODS.fsReadTextFile,
          params: {
            path: "file:///tmp/example.txt"
          }
        })
      )
    );

    assert.equal(response.error.code, -32603);
    assert.equal(response.error.message, "bridge execution failed");
    assert.equal(response.error.data.method, ACP_METHODS.fsReadTextFile);
    assert.equal(logger.error.mock.calls.length, 1);

    const ignored = await bridge.handle(
      new Uint8Array(
        Buffer.from(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 2,
            result: {
              ok: true
            }
          })
        )
      )
    );
    assert.equal(ignored, null);
  });

  it("resumes only active relay sessions and surfaces closed-session errors", async () => {
    const store = {
      getSession: vi.fn(async () => ({
        relaySessionId: "relay-1",
        sourceId: "source-1",
        workspaceId: "workspace-1",
        sourceSessionId: "source-session-1",
        virtualAgentId: "agent-1",
        lifecycleState: "closed"
      }))
    };
    const executor = new RelayOperationExecutor({
      virtualAgentRegistry: {},
      targetRegistry: {},
      router: {},
      store,
      sessionDriver: {},
      eventNormalizer: {},
      permissionBridge: {}
    });

    const result = await executor.execute("acp_agent_relay.session.resume", {
      relaySessionId: "relay-1",
      sourceId: "source-1",
      workspaceId: "workspace-1",
      sourceSessionId: "source-session-1",
      virtualAgentId: "agent-1"
    });

    assert.equal(result.ok, false);
    assert.equal(result.error.code, "relay_session_closed");
    assert.equal(result.error.details.lifecycleState, "closed");
    assert.equal(store.getSession.mock.calls.length, 1);
  });

  it("marks connections closed from transport callbacks and rejects stale requests", async () => {
    let onClose = null;
    const transport = {
      closed: false,
      child: {
        exitCode: 1,
        signalCode: null
      },
      send: vi.fn(),
      receive: vi.fn(),
      onClose: vi.fn((callback) => {
        onClose = callback;
      }),
      close: vi.fn()
    };
    const connection = new AcpClientConnection({
      target: {
        targetId: "target-1"
      },
      transport,
      requestTimeoutMs: 0
    });

    assert.equal(connection.hasTransport(), true);
    assert.equal(connection.isReusable(), false);

    const pending = connection.createPendingRequest(
      { id: "pending-1" },
      {
        method: "session/prompt"
      }
    );

    onClose({
      error: new Error("transport kaboom")
    });

    await assert.rejects(
      pending.promise,
      (error) => {
        assert.equal(error.message, "Target ACP transport is closed: transport kaboom.");
        return true;
      }
    );
    assert.equal(connection.closed, true);
    assert.equal(connection.lastTransportError, "transport kaboom");
    assert.equal(transport.close.mock.calls.length, 0);
  });

  it("runs parsed Agent API JSON responses and normalizes extracted identifiers", async () => {
    childProcessMock.execFile.mockImplementationOnce((command, args, options, callback) => {
      callback(null, {
        stdout: JSON.stringify({
          conversationId: "conversation-9",
          recipientId: "recipient-9",
          text: "hello world",
          responses: [
            { text: "older text" },
            { message: "newer text" }
          ],
          reasoning: ["because"],
          events: ["progress note"]
        }),
        stderr: ""
      });
    });

    const client = new AntigravityAgentApiClient({
      binaryPath: "/bin/echo",
      address: "127.0.0.1:1",
      csrfToken: "csrf-token"
    });

    const response = await client.runAgentApi(["get-conversation-metadata", "conversation-9"], {
      timeoutMs: 1000
    });

    assert.deepEqual(childProcessMock.execFile.mock.calls[0][1], ["agentapi", "get-conversation-metadata", "conversation-9"]);
    assert.equal(response.rawText.includes("conversationId"), true);
    assert.equal(response.response.conversationId, "conversation-9");
    assert.equal(response.response.recipientId, "recipient-9");
    assert.equal(response.response.text, "hello world");

    const normalized = normalizeAntigravityAgentApiResponse(
      {
        response: {
          responses: [
            { text: "older answer" },
            { content: "newest answer" }
          ],
          reasoning: ["reason one"]
        }
      },
      {
        stdout: "conversation id: conv-12 recipient id: rec-12"
      }
    );

    assert.equal(normalized.conversationId, "conv-12");
    assert.equal(normalized.recipientId, "rec-12");
    assert.equal(normalized.text, "newest answer");
    assert.equal(normalized.reasoning[0], "reason one");
  });

  it("rejects malformed Connect RPC inputs and preserves empty HTTP responses", async () => {
    await assert.rejects(
      () => callAntigravityConnectRpc({
        csrfToken: "csrf-token",
        method: "GetConversationMetadata",
        body: {
          conversationId: "conversation-1"
        }
      }),
      /requires a local address/
    );

    await assert.rejects(
      () => callAntigravityConnectRpc({
        address: "127.0.0.1:8443",
        method: "GetConversationMetadata",
        body: {
          conversationId: "conversation-1"
        }
      }),
      /requires a CSRF token/
    );

    await assert.rejects(
      () => callAntigravityConnectRpc({
        address: "127.0.0.1:8443",
        csrfToken: "csrf-token",
        body: {
          conversationId: "conversation-1"
        }
      }),
      /requires a method/
    );

    await assert.rejects(
      () => callAntigravityConnectRpc({
        address: "http://127.0.0.1:8443",
        csrfToken: "csrf-token",
        method: "GetConversationMetadata",
        body: {
          conversationId: "conversation-1"
        }
      }),
      /currently requires an HTTPS endpoint/
    );

    httpsMock.request.mockImplementationOnce((requestOptions, responseCallback) => {
      const request = new EventEmitter();
      request.setTimeout = vi.fn();
      request.destroy = vi.fn();
      request.on = vi.fn(request.on.bind(request));
      request.end = vi.fn(() => {
        const response = new EventEmitter();
        response.statusCode = 204;
        response.setEncoding = vi.fn();
        responseCallback(response);
        response.emit("end");
      });
      return request;
    });

    const response = await callAntigravityConnectRpc({
      address: "127.0.0.1:8443",
      csrfToken: "csrf-token",
      method: "GetConversationMetadata",
      body: {
        conversationId: "conversation-1"
      }
    });

    assert.equal(response.ok, true);
    assert.equal(response.statusCode, 204);
    assert.deepEqual(response.body, {});
    assert.equal(response.rawText, "");
  });

  it("initializes the Agent API connection even when metadata and probes fail", async () => {
    const client = {
      getConversationMetadata: vi.fn(async () => {
        throw new Error("metadata unavailable");
      }),
      probeCapabilities: vi.fn(async () => {
        throw new Error("probe unavailable");
      })
    };
    const connection = new AntigravityAgentApiConnection({
      target: {
        targetId: "target-1",
        transport: {
          agentApi: {
            conversationId: "conversation-configured",
            connectEnabled: false
          }
        }
      },
      relaySession: {
        relaySessionId: "relay-1"
      },
      client
    });

    const result = await connection.initialize({
      relaySessionId: "relay-1"
    });

    assert.equal(result.ok, true);
    assert.equal(result.targetSessionId, "conversation-configured");
    assert.equal(connection.capabilityProbe.error, "probe unavailable");
    assert.equal(connection.messages[0].method, "agentapi.initialize");
  });

  it("normalizes Agent API prompt responses into accepted relay output", async () => {
    const client = {
      getConversationMetadata: vi.fn(async () => ({
        response: {
          conversationId: "conversation-2"
        }
      })),
      probeCapabilities: vi.fn(async () => ({
        snapshot: {
          availableCommands: ["get-conversation-metadata"],
          finalResponseReadSupported: false,
          finalResponsePolicy: "accepted_only"
        }
      })),
      sendMessage: vi.fn(async () => ({
        response: {
          sendMessage: true,
          recipientId: "conversation-2",
          text: "assistant answer",
          reasoning: ["reason one"],
          events: ["progress note", { type: "custom", text: "kept" }]
        },
        stdout: "",
        stderr: ""
      }))
    };
    const connection = new AntigravityAgentApiConnection({
      target: {
        targetId: "target-1",
        transport: {
          agentApi: {
            conversationId: "conversation-2",
            connectEnabled: false
          }
        }
      },
      relaySession: {
        relaySessionId: "relay-1"
      },
      route: {
        effectiveMode: "edit"
      },
      client
    });

    await connection.initialize({
      relaySessionId: "relay-1"
    });

    const result = await connection.sendPrompt({
      prompt: "do the thing"
    });

    assert.equal(result.ok, true);
    assert.equal(result.stopReason, "accepted");
    assert.equal(result.externalCompletionState, "accepted_only");
    assert.equal(result.finalResponseAvailable, false);
    assert.equal(result.reasoning[0].text, "reason one");
    assert.equal(result.events[0].phase, "accepted");
    assert.equal(result.events[1].text, "progress note");
    assert.equal(result.events[2].type, "custom");
  });

  it("parses stdio server env options and closes runtime, service, and transport", async () => {
    const options = createAcpSourceStdioServerOptionsFromEnv({
      PACT_ACP_SOURCE_STDIO_RUNTIME_JSON: JSON.stringify({
        store: {
          adapter: {
            storagePath: "/tmp/relay-store.json"
          }
        }
      }),
      PACT_ACP_SOURCE_STDIO_CONTEXT_JSON: JSON.stringify({
        sourceId: "source-base",
        workspaceId: "workspace-base",
        sourceScopes: ["ctx.scope"],
        sourceCapabilities: ["ctx.capability"],
        sourceIdentity: {
          role: "reader"
        }
      }),
      PACT_ACP_SOURCE_ID: "source-env",
      PACT_ACP_WORKSPACE_ID: "workspace-env",
      PACT_ACP_SOURCE_SCOPES: "alpha beta",
      PACT_ACP_SOURCE_CAPABILITIES: "gamma,delta",
      PACT_ACP_SOURCE_IDENTITY_JSON: JSON.stringify({
        role: "writer",
        traceId: "trace-1"
      })
    });

    assert.deepEqual(options.runtimeOptions.store.adapter, {
      storagePath: "/tmp/relay-store.json"
    });
    assert.equal(options.context.sourceId, "source-env");
    assert.equal(options.context.workspaceId, "workspace-env");
    assert.equal(options.context.sourceScopes, undefined);
    assert.equal(options.context.sourceCapabilities, undefined);
    assert.deepEqual(options.context.sourceIdentity, {
      role: "writer",
      traceId: "trace-1"
    });

    const runtime = {
      store: {
        adapter: {
          storagePath: "/tmp/relay-store.json"
        }
      },
      close: vi.fn(async () => {})
    };
    const transport = {
      close: vi.fn()
    };
    const service = {
      serveTransport: vi.fn(async () => {}),
      close: vi.fn()
    };
    sourceJsonRpcMock.createAcpSourceJsonRpcLineTransport.mockReturnValue(transport);
    sourceJsonRpcMock.createAcpSourceJsonRpcService.mockReturnValue(service);

    const server = createAcpSourceStdioServer({
      runtime,
      context: {
        sourceId: "source-env",
        workspaceId: "workspace-env"
      },
      input: new EventEmitter(),
      output: {
        write() {
          return true;
        }
      },
      diagnostics: null
    });

    await server.close();

    assert.equal(service.close.mock.calls.length, 1);
    assert.equal(transport.close.mock.calls.length, 1);
    assert.equal(runtime.close.mock.calls.length, 1);
  });
});
