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

import {
  AntigravityAgentApiClient,
  buildAntigravityCascadeUserInteractionDecision,
  callAntigravityConnectRpc,
  discoverAntigravityAgentApiEndpoint,
  discoverAntigravityConnectEndpoint,
  extractAntigravityConversationId,
  normalizeAntigravityCascadeTrajectory,
  summarizeAntigravityConnectObservation
} from "../../../server/platform/specialized/capabilities/agent-relay/acp-agent-relay/antigravity-agent-api-client.mjs";

const tempRoots = [];

async function makeTempRoot(prefix = "pact-antigravity-client-final-third-extra-") {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

function createHttpsResponder(responses) {
  let callIndex = 0;
  httpsMock.request.mockImplementation((requestOptions, responseCallback) => {
    const request = new EventEmitter();
    request.setTimeout = vi.fn();
    request.destroy = vi.fn();
    request.on = request.addListener.bind(request);
    request.end = vi.fn((payload) => {
      const responseSpec = responses[Math.min(callIndex, responses.length - 1)] || {};
      callIndex += 1;
      const response = new EventEmitter();
      response.statusCode = responseSpec.statusCode ?? 200;
      response.setEncoding = vi.fn();
      responseCallback(response);
      for (const chunk of responseSpec.chunks || []) {
        response.emit("data", chunk);
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

describe("antigravity-agent-api-client final third extra coverage", () => {
  it("extracts nested conversation ids and builds interaction decisions from cascade ids", () => {
    assert.equal(
      extractAntigravityConversationId({
        response: {
          sendMessage: {
            recipient_id: "recipient-from-send-message"
          }
        }
      }),
      "recipient-from-send-message"
    );

    assert.equal(
      extractAntigravityConversationId({
        response: {
          conversationMetadata: {
            metadata: {
              id: "conversation-from-metadata-id"
            }
          }
        }
      }),
      "conversation-from-metadata-id"
    );

    assert.deepEqual(
      buildAntigravityCascadeUserInteractionDecision({
        cascadeId: "cascade-from-option",
        step: {
          trajectoryId: "trajectory-1",
          stepIndex: "7"
        }
      }),
      {
        cascadeId: "cascade-from-option",
        interaction: {
          trajectoryId: "trajectory-1",
          stepIndex: 7,
          permission: {
            approved: false
          }
        }
      }
    );
  });

  it("discovers connect endpoints from env and fallback scans", async () => {
    const tempRoot = await makeTempRoot();
    const binaryPath = path.join(tempRoot, "agentapi");
    await fs.writeFile(binaryPath, "binary", "utf8");

    createHttpsResponder([
      {
        chunks: [
          JSON.stringify({
            response: {
              conversationMetadata: {
                metadata: {
                  workspaces: [{ workspaceFolderAbsoluteUri: tempRoot }]
                }
              }
            }
          })
        ]
      },
      {
        chunks: [
          JSON.stringify({
            response: {
              conversationMetadata: {
                metadata: {
                  workspaces: [{ workspaceFolderAbsoluteUri: "/different/workspace" }]
                }
              }
            }
          })
        ]
      },
      {
        chunks: [
          JSON.stringify({
            response: {
              conversationMetadata: {
                metadata: {
                  workspaces: [{ workspaceFolderAbsoluteUri: tempRoot }]
                }
              }
            }
          })
        ]
      }
    ]);

    const run = vi.fn(async (command) => {
      if (command === "pgrep") {
        return `3210 /tmp/other-language-server --csrf_token=scan-token`;
      }
      if (command === "lsof") {
        return `127.0.0.1:9555 (LISTEN)\n127.0.0.1:9555 (LISTEN)\n`;
      }
      return "";
    });

    const envEndpoint = await discoverAntigravityConnectEndpoint({
      conversationId: "conversation-connect-env",
      connectAddress: "127.0.0.1:9443",
      connectCsrfToken: "connect-env-token",
      workspaceRoot: tempRoot,
      run
    });

    assert.deepEqual(envEndpoint, {
      address: "127.0.0.1:9443",
      csrfToken: "connect-env-token",
      source: "env",
      protocol: "connect-json",
      tls: true
    });

    const scannedEndpoint = await discoverAntigravityConnectEndpoint({
      conversationId: "conversation-connect-scan",
      workspaceRoot: tempRoot,
      run
    });

    assert.deepEqual(scannedEndpoint, {
      address: "127.0.0.1:9555",
      csrfToken: "scan-token",
      source: "pid:3210:fallback",
      protocol: "connect-json",
      tls: true
    });

    const rpcResult = await callAntigravityConnectRpc({
      address: "https://127.0.0.1:9443/base",
      csrfToken: "connect-env-token",
      method: "GetConversationMetadata",
      body: { conversationId: "conversation-connect-env" }
    });

    assert.equal(rpcResult.ok, true);
    assert.equal(rpcResult.rawText.includes("conversationMetadata"), true);
    assert.equal(rpcResult.body.response.conversationMetadata.metadata.workspaces[0].workspaceFolderAbsoluteUri, tempRoot);
    assert.equal(httpsMock.request.mock.calls[2][0].path, "/base/exa.language_server_pb.LanguageServerService/GetConversationMetadata");
  });

  it("discovers agent-api endpoints from env and fallback scans", async () => {
    const tempRoot = await makeTempRoot();
    const binaryPath = path.join(tempRoot, "agentapi");
    await fs.writeFile(binaryPath, "binary", "utf8");

    let metadataCallCount = 0;
    childProcessMock.execFile.mockImplementation((command, args, options, callback) => {
      if (command === "pgrep") {
        callback(null, {
          stdout: `4321 /tmp/other-language-server --csrf_token=scan-agent-token`,
          stderr: ""
        });
        return;
      }
      if (command === "lsof") {
        callback(null, {
          stdout: "127.0.0.1:9666 (LISTEN)\n",
          stderr: ""
        });
        return;
      }
      if (Array.isArray(args) && args[0] === "get-conversation-metadata") {
        metadataCallCount += 1;
        const workspaceFolderAbsoluteUri = metadataCallCount === 1 ? tempRoot : "/different/workspace";
        callback(null, {
          stdout: JSON.stringify({
            response: {
              conversationMetadata: {
                metadata: {
                  workspaces: [{ workspaceFolderAbsoluteUri }]
                }
              }
            }
          }),
          stderr: ""
        });
        return;
      }
      callback(null, { stdout: "", stderr: "" });
    });

    const envEndpoint = await discoverAntigravityAgentApiEndpoint({
      conversationId: "conversation-agent-env",
      binaryPath,
      env: {
        PACT_ACP_RELAY_ANTIGRAVITY_LS_ADDRESS: "127.0.0.1:9777",
        PACT_ACP_RELAY_ANTIGRAVITY_CSRF_TOKEN: "agent-env-token"
      }
    });

    assert.deepEqual(envEndpoint, {
      address: "127.0.0.1:9777",
      csrfToken: "agent-env-token",
      source: "env",
      binaryPath
    });

    const scannedEndpoint = await discoverAntigravityAgentApiEndpoint({
      conversationId: "conversation-agent-scan",
      binaryPath,
      workspaceRoot: tempRoot,
      env: {}
    });

    assert.deepEqual(scannedEndpoint, {
      address: "127.0.0.1:9666",
      csrfToken: "scan-agent-token",
      source: "pid:4321:fallback",
      binaryPath
    });
  });

  it("normalizes complex trajectories and connect summaries from nested payloads", () => {
    const trajectory = normalizeAntigravityCascadeTrajectory({
      runStatus: "CASCADE_RUN_STATUS_FAILED",
      steps: [
        {
          type: "CORTEX_STEP_TYPE_PLANNER_RESPONSE",
          status: "CORTEX_STEP_STATUS_DONE",
          metadata: {
            createdAt: "2026-06-05T10:00:00Z",
            sourceTrajectoryStepInfo: {
              cascadeId: "conversation-trajectory",
              trajectoryId: "trajectory-edge",
              stepIndex: 1,
              metadataIndex: 11
            }
          },
          systemMessage: {
            renderInfo: {
              markdown: "planner markdown content"
            }
          }
        },
        {
          type: "CORTEX_STEP_TYPE_RUN_COMMAND",
          status: "CORTEX_STEP_STATUS_WAITING",
          metadata: {
            createdAt: "2026-06-05T10:00:01Z",
            toolCall: {
              id: "tool-call-edge",
              name: "run_command",
              argumentsJson: "{not-json"
            },
            sourceTrajectoryStepInfo: {
              cascadeId: "conversation-trajectory",
              trajectoryId: "trajectory-edge",
              stepIndex: 2,
              metadataIndex: 12
            }
          },
          requestedInteraction: {
            prompt: "permission details are missing"
          },
          addCascadeInput: {
            nested: {
              value: "fallback-json"
            }
          },
          runCommand: {
            commandLine: "npm test -- --run marker-edge",
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
              cascadeId: "conversation-trajectory",
              trajectoryId: "trajectory-edge",
              stepIndex: 3,
              metadataIndex: 13
            }
          },
          plannerResponse: {
            response: "测试通过，补充完成。"
          }
        },
        {
          type: "CORTEX_STEP_TYPE_ERROR_MESSAGE",
          status: "CORTEX_STEP_STATUS_DONE",
          metadata: {
            createdAt: "2026-06-05T10:00:03Z",
            sourceTrajectoryStepInfo: {
              cascadeId: "conversation-trajectory",
              trajectoryId: "trajectory-edge",
              stepIndex: 4,
              metadataIndex: 14
            }
          },
          errorMessage: {
            error: {
              fullError: "deep failure message"
            }
          }
        }
      ]
    }, {
      conversationId: "conversation-trajectory"
    });

    assert.equal(trajectory.conversationId, "conversation-trajectory");
    assert.equal(trajectory.runStatus, "CASCADE_RUN_STATUS_FAILED");
    assert.equal(trajectory.failed, true);
    assert.equal(trajectory.running, false);
    assert.equal(trajectory.stepCount, 4);
    assert.equal(trajectory.pendingInteraction, true);
    assert.equal(trajectory.latestStep.stepIndex, 4);
    assert.equal(trajectory.waitingInteractionStep.stepIndex, 2);
    assert.equal(trajectory.latestProgress.content, "测试通过，补充完成。");
    assert.equal(trajectory.latestFinalResponse.content, "测试通过，补充完成。");
    assert.equal(trajectory.latestKnownError.errorPreview.includes("deep failure message"), true);

    const summary = summarizeAntigravityConnectObservation({
      conversationId: "conversation-trajectory",
      marker: "marker-edge",
      trajectory,
      afterStepCount: 1
    });

    assert.equal(summary.afterStepCount, 1);
    assert.equal(summary.trajectoryAdvanced, true);
    assert.equal(summary.markerObserved, true);
    assert.equal(summary.progressAvailable, true);
    assert.equal(summary.finalResponseAvailable, true);
    assert.equal(summary.latestProgress.content, "测试通过，补充完成。");
    assert.equal(summary.latestFinalResponse.content, "测试通过，补充完成。");
    assert.equal(summary.latestError.errorPreview.includes("deep failure message"), true);
    assert.equal(summary.latestKnownError.errorPreview.includes("deep failure message"), true);
    assert.equal(summary.waitingInteractionStep.runCommand.commandLine.includes("marker-edge"), true);
    assert.equal(summary.latestStep.content.includes("deep failure message"), false);
    assert.equal(summary.latestStep.errorPreview.includes("deep failure message"), true);
  });

  it("covers connect RPC forwarding, polling, and guarded client helpers", async () => {
    createHttpsResponder([
      {
        chunks: [
          JSON.stringify({
            cascadeTrajectory: {
              runStatus: "CASCADE_RUN_STATUS_RUNNING",
              steps: [
                {
                  type: "CORTEX_STEP_TYPE_PLANNER_RESPONSE",
                  status: "CORTEX_STEP_STATUS_DONE",
                  metadata: {
                    createdAt: "2026-06-05T10:01:00Z",
                    sourceTrajectoryStepInfo: {
                      cascadeId: "conversation-client",
                      trajectoryId: "trajectory-client",
                      stepIndex: 1,
                      metadataIndex: 21
                    }
                  },
                  plannerResponse: {
                    response: "still working"
                  }
                }
              ]
            }
          })
        ]
      },
      {
        chunks: [
          JSON.stringify({
            response: {
              message: "queued messages flushed"
            }
          })
        ]
      },
      {
        chunks: [
          JSON.stringify({
            response: {
              message: "conversation became idle"
            }
          })
        ]
      }
    ]);

    const client = new AntigravityAgentApiClient({
      binaryPath: process.execPath,
      address: "127.0.0.1:1",
      csrfToken: "csrf-token",
      connectObservationTimeoutMs: 77
    });

    const cascade = await client.getCascadeTrajectory({
      conversationId: "conversation-client",
      endpoint: {
        address: "127.0.0.1:9888/base",
        csrfToken: "csrf-token",
        source: "env",
        protocol: "connect-json",
        tls: true
      }
    });

    assert.equal(cascade.ok, true);
    assert.equal(cascade.endpoint.address, "127.0.0.1:9888/base");
    assert.equal(cascade.endpoint.hasCsrfToken, true);
    assert.equal(cascade.trajectory.conversationId, "conversation-client");
    assert.equal(cascade.trajectory.progressAvailable, true);

    const flushed = await client.sendAllQueuedMessages({
      conversationId: "conversation-client",
      cascadeConfig: {
        reason: "coverage"
      },
      endpoint: {
        address: "127.0.0.1:9888/base",
        csrfToken: "csrf-token",
        source: "env",
        protocol: "connect-json",
        tls: true
      }
    });

    assert.equal(flushed.ok, true);
    assert.equal(flushed.body.response.message, "queued messages flushed");

    const idle = await client.waitForConversationFullyIdle({
      conversationId: "conversation-client",
      inactivityTimeoutSeconds: 5,
      stabilizationDurationSeconds: 2,
      returnOnExecutorError: false,
      endpoint: {
        address: "127.0.0.1:9888/base",
        csrfToken: "csrf-token",
        source: "env",
        protocol: "connect-json",
        tls: true
      }
    });

    assert.equal(idle.ok, true);
    assert.equal(idle.body.response.message, "conversation became idle");

    assert.equal(httpsMock.request.mock.calls[0][0].path, "/base/exa.language_server_pb.LanguageServerService/GetCascadeTrajectory");
    assert.equal(httpsMock.request.mock.calls[1][0].path, "/base/exa.language_server_pb.LanguageServerService/SendAllQueuedMessages");
    assert.equal(httpsMock.request.mock.calls[2][0].path, "/base/exa.language_server_pb.LanguageServerService/WaitForConversationFullyIdle");
    await assert.rejects(
      () => client.sendAllQueuedMessages({}),
      /requires a conversation id/
    );

    await assert.rejects(
      () => client.waitForConversationFullyIdle({}),
      /requires a conversation id/
    );
    await assert.rejects(
      () => client.cancelCascadeInvocation({}),
      /requires a conversation id/
    );
    await assert.rejects(
      () => client.forceStopCascadeTree({}),
      /requires a conversation id/
    );

    const trajectoryObserver = vi.fn();
    client.observeConnectTrajectory = trajectoryObserver;

    vi.useFakeTimers();
    try {
      const waitScenarios = [
        ["final", { finalResponseAvailable: true }],
        ["idle", { completed: true }],
        ["trajectory", { trajectoryAdvanced: true }],
        ["progress", { pendingInteraction: true }]
      ];

      for (const [until, satisfiedObservation] of waitScenarios) {
        trajectoryObserver
          .mockResolvedValueOnce({
            progressAvailable: false,
            finalResponseAvailable: false,
            completed: false,
            failed: false,
            pendingInteraction: false,
            trajectoryAdvanced: false,
            markerObserved: false,
            markerMessageObserved: false,
            markerTranscriptObserved: false
          })
          .mockResolvedValueOnce({
            progressAvailable: false,
            finalResponseAvailable: false,
            completed: false,
            failed: false,
            pendingInteraction: false,
            trajectoryAdvanced: false,
            markerObserved: false,
            markerMessageObserved: false,
            markerTranscriptObserved: false,
            ...satisfiedObservation
          });

        const waitPromise = client.waitForConnectTrajectoryObservation({
          conversationId: "conversation-client",
          endpoint: {
            address: "127.0.0.1:9888/base",
            csrfToken: "csrf-token",
            source: "env",
            protocol: "connect-json",
            tls: true
          },
          until,
          pollIntervalMs: 1,
          timeoutMs: 5
        });

        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(100);
        const observed = await waitPromise;
        assert.equal(observed[until === "final" ? "finalResponseAvailable" : until === "idle" ? "completed" : until === "trajectory" ? "trajectoryAdvanced" : "pendingInteraction"], true);
        assert.equal(trajectoryObserver.mock.calls.length, 2);
        trajectoryObserver.mockReset();
      }
    } finally {
      vi.useRealTimers();
    }
  });
});
