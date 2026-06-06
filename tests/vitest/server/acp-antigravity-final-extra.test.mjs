import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { afterEach, describe, it, vi } from "vitest";

const childProcessMock = vi.hoisted(() => ({
  execFile: vi.fn(),
  spawn: vi.fn()
}));

const httpsMock = vi.hoisted(() => ({
  request: vi.fn()
}));

const fsMock = vi.hoisted(() => ({
  access: vi.fn(),
  readFile: vi.fn(),
  readdir: vi.fn(),
  stat: vi.fn(),
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  rename: vi.fn()
}));

vi.mock("node:child_process", () => ({
  execFile: childProcessMock.execFile,
  spawn: childProcessMock.spawn
}));

vi.mock("node:https", () => ({
  default: {
    request: httpsMock.request
  },
  request: httpsMock.request
}));

vi.mock("node:fs/promises", () => ({
  default: fsMock
}));

import {
  AntigravityAgentApiClient,
  callAntigravityConnectRpc,
  normalizeAntigravityCascadeTrajectory,
  summarizeAntigravityConnectObservation
} from "../../../server/platform/specialized/capabilities/agent-relay/acp-agent-relay/antigravity-agent-api-client.mjs";
import {
  AcpClientConnection
} from "../../../server/platform/specialized/capabilities/agent-relay/acp-agent-relay/acp-client-connection.mjs";
import {
  AcpRelayRouter
} from "../../../server/platform/specialized/capabilities/agent-relay/acp-agent-relay/acp-relay-router.mjs";
import {
  AcpSessionDriver
} from "../../../server/platform/specialized/capabilities/agent-relay/acp-agent-relay/acp-session-driver.mjs";
import {
  AcpInboundFacade
} from "../../../server/platform/specialized/capabilities/agent-relay/acp-agent-relay/acp-inbound-facade.mjs";

afterEach(() => {
  childProcessMock.execFile.mockReset();
  childProcessMock.spawn.mockReset();
  httpsMock.request.mockReset();
  fsMock.access.mockReset();
  fsMock.readFile.mockReset();
  fsMock.readdir.mockReset();
  fsMock.stat.mockReset();
  fsMock.mkdir.mockReset();
  fsMock.writeFile.mockReset();
  fsMock.rename.mockReset();
});

describe("acp antigravity final extra coverage", () => {
  it("parses wrapped Agent API JSON output and preserves the raw text boundary", async () => {
    fsMock.access.mockResolvedValue(undefined);
    fsMock.readFile.mockResolvedValue("");
    childProcessMock.execFile.mockImplementation((command, args, options, callback) => {
      callback(null, {
        stdout: 'prefix {"response":{"text":"wrapped success"}} suffix',
        stderr: ""
      });
    });

    const client = new AntigravityAgentApiClient({
      binaryPath: "/tmp/pact-agentapi-test-bin",
      address: "127.0.0.1:12345",
      csrfToken: "csrf-token"
    });

    const response = await client.runAgentApi(["get-conversation-metadata", "conversation-1"], {
      timeoutMs: 1000
    });

    assert.equal(response.rawText, 'prefix {"response":{"text":"wrapped success"}} suffix');
    assert.equal(response.response.text, "wrapped success");
    assert.equal(response.stdout, 'prefix {"response":{"text":"wrapped success"}} suffix');
    assert.equal(response.stderr, "");
    assert.equal(childProcessMock.execFile.mock.calls[0][0], "/tmp/pact-agentapi-test-bin");
    assert.deepEqual(childProcessMock.execFile.mock.calls[0][1], [
      "agentapi",
      "get-conversation-metadata",
      "conversation-1"
    ]);
    assert.equal(childProcessMock.execFile.mock.calls[0][2].env.ANTIGRAVITY_LS_ADDRESS, "127.0.0.1:12345");
    assert.equal(childProcessMock.execFile.mock.calls[0][2].env.ANTIGRAVITY_CSRF_TOKEN, "csrf-token");
  });

  it("rethrows Agent API JSON errors with stdout and stderr attached", async () => {
    fsMock.access.mockResolvedValue(undefined);
    fsMock.readFile.mockResolvedValue("");
    childProcessMock.execFile.mockImplementation((command, args, options, callback) => {
      const error = new Error("agentapi failed");
      error.stdout = '{"error":"wrapped failure","details":{"phase":"parse"}}';
      error.stderr = "stderr trace";
      callback(error);
    });

    const client = new AntigravityAgentApiClient({
      binaryPath: "/tmp/pact-agentapi-test-bin",
      address: "127.0.0.1:12345",
      csrfToken: "csrf-token"
    });

    await assert.rejects(
      () => client.runAgentApi(["get-conversation-metadata", "conversation-2"], { timeoutMs: 1000 }),
      (error) => {
        assert.equal(error.message, "wrapped failure");
        assert.deepEqual(error.agentApiResponse, {
          error: "wrapped failure",
          details: {
            phase: "parse"
          }
        });
        assert.equal(error.stdout, '{"error":"wrapped failure","details":{"phase":"parse"}}');
        assert.equal(error.stderr, "stderr trace");
        return true;
      }
    );
  });

  it("sends Connect RPCs with the expected auth header and treats null bodies as empty JSON", async () => {
    const seen = {};
    httpsMock.request.mockImplementation((requestOptions, responseCallback) => {
      Object.assign(seen, requestOptions);
      const request = new EventEmitter();
      request.setTimeout = vi.fn();
      request.destroy = vi.fn();
      request.on = request.addListener.bind(request);
      request.end = vi.fn((payload) => {
        seen.payload = payload;
        const response = new EventEmitter();
        response.statusCode = 200;
        response.setEncoding = vi.fn();
        responseCallback(response);
        response.emit("data", "null");
        response.emit("end");
      });
      return request;
    });

    const result = await callAntigravityConnectRpc({
      address: "127.0.0.1:8443",
      csrfToken: "csrf-token",
      method: "GetConversationMetadata",
      body: { conversationId: "conversation-3" }
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.body, {});
    assert.equal(result.rawText, "null");
    assert.equal(seen.rejectUnauthorized, false);
    assert.equal(seen.headers["x-codeium-csrf-token"], "csrf-token");
    assert.equal(seen.headers["content-type"], "application/json");
    assert.equal(seen.headers.accept, "application/json");
    assert.equal(seen.path, "/exa.language_server_pb.LanguageServerService/GetConversationMetadata");
    assert.equal(seen.payload, '{"conversationId":"conversation-3"}');
    assert.equal(seen.headers["content-length"], Buffer.byteLength(seen.payload));
  });

  it("rejects Connect RPCs when the timeout fires", async () => {
    httpsMock.request.mockImplementation((requestOptions, responseCallback) => {
      const request = new EventEmitter();
      request.on = request.addListener.bind(request);
      request.destroy = vi.fn((error) => {
        request.emit("error", error);
      });
      request.setTimeout = vi.fn((timeoutMs, handler) => {
        queueMicrotask(handler);
        return request;
      });
      request.end = vi.fn();
      return request;
    });

    await assert.rejects(
      () => callAntigravityConnectRpc({
        address: "127.0.0.1:8443",
        csrfToken: "csrf-token",
        method: "GetConversationMetadata",
        body: { conversationId: "conversation-4" },
        timeoutMs: 5
      }),
      /timed out/
    );
  });

  it("normalizes stream-style trajectory events and marker-based observations", () => {
    const trajectory = normalizeAntigravityCascadeTrajectory({
      runStatus: "CASCADE_RUN_STATUS_COMPLETED",
      steps: [
        {
          type: "CORTEX_STEP_TYPE_PLANNER_RESPONSE",
          status: "CORTEX_STEP_STATUS_DONE",
          metadata: {
            createdAt: "2026-06-05T10:00:00Z",
            sourceTrajectoryStepInfo: {
              cascadeId: "conversation-5",
              trajectoryId: "trajectory-1",
              stepIndex: 1,
              metadataIndex: 1
            }
          },
          plannerResponse: {
            response: "处理中"
          }
        },
        {
          type: "CORTEX_STEP_TYPE_RUN_COMMAND",
          status: "CORTEX_STEP_STATUS_WAITING",
          metadata: {
            createdAt: "2026-06-05T10:00:01Z",
            toolCall: {
              id: "tool-call-1",
              name: "run_command",
              argumentsJson: JSON.stringify({
                CommandLine: "npm test -- --run tests/vitest/server/acp-antigravity-final-extra.test.mjs",
                Cwd: "/Users/unka/DevSpace/Unka-Malloc/Pact",
                toolAction: "running a targeted check",
                toolSummary: "final extra coverage"
              })
            },
            sourceTrajectoryStepInfo: {
              cascadeId: "conversation-5",
              trajectoryId: "trajectory-1",
              stepIndex: 2,
              metadataIndex: 2
            }
          },
          requestedInteraction: {
            permission: {
              resource: {
                action: "command",
                target: "npm test -- --run tests/vitest/server/acp-antigravity-final-extra.test.mjs"
              },
              persistSuggestionType: "PERSIST_SUGGESTION_TYPE_SUGGESTED",
              suggestedPersistPattern: "npm test"
            }
          },
          runCommand: {
            commandLine: "npm test -- --run tests/vitest/server/acp-antigravity-final-extra.test.mjs",
            cwd: "/Users/unka/DevSpace/Unka-Malloc/Pact",
            blocking: true
          }
        },
        {
          type: "CORTEX_STEP_TYPE_PLANNER_RESPONSE",
          status: "CORTEX_STEP_STATUS_DONE",
          metadata: {
            createdAt: "2026-06-05T10:00:02Z",
            sourceTrajectoryStepInfo: {
              cascadeId: "conversation-5",
              trajectoryId: "trajectory-1",
              stepIndex: 3,
              metadataIndex: 3
            }
          },
          plannerResponse: {
            response: "全部通过"
          }
        },
        {
          type: "CORTEX_STEP_TYPE_ERROR_MESSAGE",
          status: "CORTEX_STEP_STATUS_DONE",
          metadata: {
            createdAt: "2026-06-05T10:00:03Z",
            sourceTrajectoryStepInfo: {
              cascadeId: "conversation-5",
              trajectoryId: "trajectory-1",
              stepIndex: 4,
              metadataIndex: 4
            }
          },
          error: "late failure"
        }
      ]
    }, {
      conversationId: "conversation-5"
    });

    const summary = summarizeAntigravityConnectObservation({
      conversationId: "conversation-5",
      marker: "acp-antigravity-final-extra.test.mjs",
      trajectory,
      afterStepCount: 1
    });

    assert.equal(trajectory.pendingInteraction, true);
    assert.equal(trajectory.progressAvailable, true);
    assert.equal(trajectory.finalResponseAvailable, true);
    assert.equal(summary.markerObserved, true);
    assert.equal(summary.progressAvailable, true);
    assert.equal(summary.finalResponseAvailable, true);
    assert.equal(summary.latestFinalResponse.content, "全部通过");
    assert.equal(summary.latestError.errorPreview, "late failure");
  });

  it("falls back to synthetic target session ids and closes sessions defensively", async () => {
    const driver = new AcpSessionDriver({
      connectionFactory: () => ({
        closed: false,
        async initialize() {
          return {
            ok: true,
            capabilities: {
              session: ["new"]
            },
            protocolVersion: "1.0"
          };
        },
        async sendPrompt() {
          return { ok: true, text: "prompt" };
        },
        async cancel() {
          return { ok: true };
        },
        async close() {
          throw new Error("close failed");
        }
      })
    });

    const relaySession = {
      relaySessionId: "relay-5"
    };
    const target = {
      targetId: "target-5",
      transport: {
        type: "stdio"
      }
    };

    const wake = await driver.wake({ target, relaySession });
    assert.equal(wake.targetSessionId, "target_session_relay-5");
    assert.equal(wake.targetResumeRef, "resume_relay-5");
    assert.equal(wake.wakeMode, "created");

    const cancelMissing = await driver.cancel({
      target,
      relaySession: {
        relaySessionId: "missing-relay"
      }
    });
    assert.equal(cancelMissing.ok, true);
    assert.equal(cancelMissing.alreadyClosed, true);

    const closeResult = await driver.closeSession({ target, relaySession });
    assert.equal(closeResult.ok, false);
    assert.equal(closeResult.result.ok, false);
    assert.equal(closeResult.result.error, "close failed");
  });

  it("reports session-store and router guards for missing bindings", async () => {
    const router = new AcpRelayRouter({
      virtualAgentRegistry: {
        getAgent(virtualAgentId) {
          return {
            virtualAgentId,
            targetId: "missing-target",
            enabled: true
          };
        }
      },
      targetRegistry: {
        getTarget() {
          return null;
        }
      }
    });

    const route = await router.resolveForSourceSession({
      virtualAgentId: "agent-1",
      workspaceId: "workspace-1"
    });
    assert.equal(route.ok, false);
    assert.equal(route.status, 404);
    assert.equal(route.error.code, "target_unknown");

    const unavailableFacade = new AcpInboundFacade({
      executor: {
        execute: vi.fn()
      },
      store: null
    });
    const unavailable = await unavailableFacade.loadSession({ sessionId: "relay-1" });
    assert.equal(unavailable.ok, false);
    assert.equal(unavailable.error.code, "relay_session_store_unavailable");

    const missingFacade = new AcpInboundFacade({
      executor: {
        execute: vi.fn()
      },
      store: {
        async getSession() {
          return null;
        },
        async getSessionBySourceKey() {
          return null;
        }
      }
    });
    const missing = await missingFacade.loadSession({
      sourceId: "source-1",
      workspaceId: "workspace-1",
      sourceSessionId: "source-session-1",
      virtualAgentId: "agent-1"
    });
    assert.equal(missing.ok, false);
    assert.equal(missing.error.code, "relay_session_not_found");
  });

  it("refuses ACP requests when the transport stops accepting requests", async () => {
    const refusedConnection = new AcpClientConnection({
      target: {
        targetId: "target-1"
      },
      transport: {
        send: vi.fn(async () => false),
        receive: vi.fn(async () => null),
        close: vi.fn()
      },
      requestTimeoutMs: 5
    });

    await assert.rejects(
      () => refusedConnection.request("session/prompt", { prompt: "hello" }),
      /refused session\/prompt request/
    );
    assert.equal(refusedConnection.closed, true);

    let closeTransport;
    const closedBeforeResponseConnection = new AcpClientConnection({
      target: {
        targetId: "target-2"
      },
      transport: {
        send: vi.fn(async () => true),
        receive: vi.fn(() => new Promise((resolve) => {
          closeTransport = resolve;
        })),
        close: vi.fn()
      },
      requestTimeoutMs: 5
    });

    const requestPromise = closedBeforeResponseConnection.request("session/prompt", { prompt: "hello" });
    await Promise.resolve();
    const rejectionAssertion = assert.rejects(
      requestPromise,
      /closed before .*response/
    );
    closeTransport(null);
    await rejectionAssertion;
  });
});
