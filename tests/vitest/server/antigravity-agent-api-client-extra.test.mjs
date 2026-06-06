import assert from "node:assert/strict";
import { afterEach, describe, it, vi } from "vitest";

const childProcessMock = vi.hoisted(() => ({
  execFile: vi.fn()
}));

vi.mock("node:child_process", () => ({
  execFile: childProcessMock.execFile
}));

import {
  AntigravityAgentApiClient,
  createAntigravityAgentApiCapabilitySnapshot,
  normalizeAntigravityAgentApiConfig,
  normalizeAntigravityAgentApiResponse,
  normalizeAntigravityCascadeTrajectory,
  parseAntigravityAgentApiCommands,
  probeAntigravityAgentApiCapabilities,
  summarizeAntigravityConnectObservation
} from "../../../server/platform/specialized/capabilities/agent-relay/acp-agent-relay/antigravity-agent-api-client.mjs";

afterEach(() => {
  childProcessMock.execFile.mockReset();
});

describe("antigravity-agent-api-client extra coverage", () => {
  it("normalizes Agent API config with precedence, coercion, and defaults", () => {
    const config = normalizeAntigravityAgentApiConfig(
      {
        commandPath: "  /custom/agentapi  ",
        url: "  127.0.0.1:12345  ",
        token: "  token-from-options  ",
        recipientId: "  conversation-from-options  ",
        timeoutMs: "not-a-number",
        localObservationEnabled: true,
        localObservationTimeoutMs: "42",
        localObservationPollIntervalMs: "250",
        localObservationBrainRoot: "  /brain/root  ",
        connectObservationEnabled: "1",
        rpcAddress: "  127.0.0.1:56789  ",
        rpcCsrfToken: "  connect-token  ",
        rpcTimeoutMs: "5000",
        connectObserveTimeoutMs: "12000",
        connectObservePollIntervalMs: "1500",
        flushQueuedMessages: "0",
        denyPendingCommandInteraction: "yes",
        forceStopStuckCascade: "true",
        cwd: "  /workspace/root  "
      },
      {
        PACT_ACP_RELAY_ANTIGRAVITY_MODEL: "pro",
        PACT_ACP_RELAY_ANTIGRAVITY_CSRF_TOKEN: "env-token",
        PACT_ACP_RELAY_ANTIGRAVITY_CONNECT_ENABLED: "yes",
        PACT_ACP_RELAY_ANTIGRAVITY_CONNECT_FLUSH_QUEUE: "yes",
        PACT_ACP_RELAY_ANTIGRAVITY_CONNECT_FORCE_STOP_STUCK: "1"
      }
    );

    assert.deepEqual(config, {
      binaryPath: "/custom/agentapi",
      address: "127.0.0.1:12345",
      csrfToken: "token-from-options",
      model: "pro",
      conversationId: "conversation-from-options",
      timeoutMs: 120000,
      localObservationEnabled: true,
      localObservationTimeoutMs: 42,
      localObservationPollIntervalMs: 250,
      localObservationBrainRoot: "/brain/root",
      connectEnabled: true,
      connectAddress: "127.0.0.1:56789",
      connectCsrfToken: "connect-token",
      connectTimeoutMs: 5000,
      connectObservationTimeoutMs: 12000,
      connectObservationPollIntervalMs: 1500,
      connectFlushQueuedMessages: false,
      connectWaitForFinalResponse: true,
      connectDenyPendingCommandInteractions: true,
      connectForceStopStuckCascade: true,
      cwd: "/workspace/root"
    });
  });

  it("parses Agent API command listings and ignores duplicates and noise", () => {
    const usage = `
Agent API usage

Available Commands:
  get-conversation-metadata   Fetch metadata
  new-conversation
  send-message
  send-message
  wait-for-response
  not-a-command

Other Section:
  stream-conversation
`;

    assert.deepEqual(parseAntigravityAgentApiCommands(usage), [
      "get-conversation-metadata",
      "new-conversation",
      "send-message",
      "wait-for-response",
      "not-a-command",
      "stream-conversation"
    ]);
    assert.deepEqual(parseAntigravityAgentApiCommands("Usage only, no command block"), []);
  });

  it("normalizes Agent API responses and preserves error and fallback text boundaries", () => {
    const structured = normalizeAntigravityAgentApiResponse({
      response: {
        metadata: {
          conversationId: "conversation-structured",
          recipient_id: "recipient-structured",
          model: "flash-lite"
        },
        responses: [
          { text: "older response" },
          { content: "latest response" }
        ],
        reasoning_trace: [{ step: 1 }],
        updates: [{ type: "progress" }],
        status: "running"
      }
    }, {
      stdout: "stdout fallback",
      stderr: "stderr fallback"
    });

    assert.deepEqual(structured, {
      conversationId: "conversation-structured",
      recipientId: "recipient-structured",
      model: "flash-lite",
      text: "latest response",
      stopReason: "running",
      reasoning: [{ step: 1 }],
      events: [{ type: "progress" }],
      raw: {
        metadata: {
          conversationId: "conversation-structured",
          recipient_id: "recipient-structured",
          model: "flash-lite"
        },
        responses: [
          { text: "older response" },
          { content: "latest response" }
        ],
        reasoning_trace: [{ step: 1 }],
        updates: [{ type: "progress" }],
        status: "running"
      },
      stdout: "stdout fallback",
      stderr: "stderr fallback"
    });

    const errorResponse = normalizeAntigravityAgentApiResponse({
      response: {
        error: true
      }
    }, {
      stdout: "conversation id: conv-raw recipient id: rec-raw"
    });

    assert.equal(errorResponse.conversationId, "conv-raw");
    assert.equal(errorResponse.recipientId, "rec-raw");
    assert.equal(errorResponse.text, "conversation id: conv-raw recipient id: rec-raw");
    assert.equal(errorResponse.stopReason, "error");
  });

  it("normalizes connect trajectories and summaries from raw trajectory payloads", () => {
    const conversationId = "connect-extra-conversation";
    const rawTrajectory = {
      runStatus: "CASCADE_RUN_STATUS_COMPLETED",
      steps: [
        {
          type: "CORTEX_STEP_TYPE_PLANNER_RESPONSE",
          status: "CORTEX_STEP_STATUS_DONE",
          metadata: {
            createdAt: "2026-06-05T10:00:00Z",
            sourceTrajectoryStepInfo: {
              cascadeId: conversationId,
              trajectoryId: "trajectory-extra",
              stepIndex: 1,
              metadataIndex: 3
            }
          },
          plannerResponse: {
            response: "我已开始补充测试。"
          }
        },
        {
          type: "CORTEX_STEP_TYPE_RUN_COMMAND",
          status: "CORTEX_STEP_STATUS_WAITING",
          metadata: {
            createdAt: "2026-06-05T10:00:01Z",
            toolCall: {
              id: "tool-call-extra",
              name: "run_command",
              argumentsJson: JSON.stringify({
                CommandLine: "npm run test:node-vue -- --run tests/vitest/server/antigravity-agent-api-client-extra.test.mjs",
                Cwd: "/Users/unka/DevSpace/Unka-Malloc/Pact",
                toolAction: "Running the extra test",
                toolSummary: "Agent API client coverage"
              })
            },
            sourceTrajectoryStepInfo: {
              cascadeId: conversationId,
              trajectoryId: "trajectory-extra",
              stepIndex: 2,
              metadataIndex: 4
            }
          },
          requestedInteraction: {
            permission: {
              resource: {
                action: "command",
                target: "npm run test:node-vue -- --run tests/vitest/server/antigravity-agent-api-client-extra.test.mjs"
              },
              persistSuggestionType: "PERSIST_SUGGESTION_TYPE_SUGGESTED",
              suggestedPersistPattern: "npm run"
            }
          },
          runCommand: {
            commandLine: "npm run test:node-vue -- --run tests/vitest/server/antigravity-agent-api-client-extra.test.mjs 2>&1",
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
              cascadeId: conversationId,
              trajectoryId: "trajectory-extra",
              stepIndex: 3,
              metadataIndex: 5
            }
          },
          plannerResponse: {
            modifiedResponse: "测试通过，补充完成。"
          }
        }
      ]
    };

    const trajectory = normalizeAntigravityCascadeTrajectory(rawTrajectory, { conversationId });

    assert.equal(trajectory.conversationId, conversationId);
    assert.equal(trajectory.runStatus, "CASCADE_RUN_STATUS_COMPLETED");
    assert.equal(trajectory.stepCount, 3);
    assert.equal(trajectory.completed, true);
    assert.equal(trajectory.failed, false);
    assert.equal(trajectory.running, false);
    assert.equal(trajectory.pendingInteraction, true);
    assert.equal(trajectory.blockedByPendingInteraction, true);
    assert.equal(trajectory.statusCounts.CORTEX_STEP_STATUS_DONE, 2);
    assert.equal(trajectory.statusCounts.CORTEX_STEP_STATUS_WAITING, 1);
    assert.equal(trajectory.latestProgress.content, "测试通过，补充完成。");
    assert.equal(trajectory.latestFinalResponse.content, "测试通过，补充完成。");
    assert.equal(trajectory.waitingInteractionStep.requestedInteraction.kind, "permission");
    assert.equal(trajectory.waitingInteractionStep.toolArguments.commandLine.includes("antigravity-agent-api-client-extra"), true);

    const summary = summarizeAntigravityConnectObservation({
      conversationId,
      marker: "npm run test:node-vue",
      trajectory: { cascadeTrajectory: rawTrajectory },
      afterStepCount: 3
    });

    assert.equal(summary.conversationId, conversationId);
    assert.equal(summary.trajectoryAdvanced, false);
    assert.equal(summary.pendingInteraction, true);
    assert.equal(summary.markerObserved, true);
    assert.equal(summary.progressAvailable, false);
    assert.equal(summary.finalResponseAvailable, false);
    assert.equal(summary.latestProgress, null);
    assert.equal(summary.latestFinalResponse, null);
  });

  it("probes capability snapshots from usage text and final-response command results", async () => {
    const client = {
      async commandUsage() {
        return `
Usage: agentapi <command>

Available Commands:
  get-conversation-metadata
  new-conversation
  send-message
  get-conversation
  get-conversation
`;
      },
      async runAgentApi(args = []) {
        const command = args[0];
        if (command === "get-conversation") {
          return { ok: true };
        }
        if (command === "get-conversation-messages") {
          const error = new Error("command unavailable");
          error.stdout = JSON.stringify({ error: "command unavailable" });
          throw error;
        }
        if (command === "wait-for-response") {
          const error = new Error("timeout");
          error.stderr = "timeout";
          throw error;
        }
        const error = new Error("streaming disabled");
        error.stdout = "streaming disabled";
        throw error;
      }
    };

    const probe = await probeAntigravityAgentApiCapabilities(client, {
      conversationId: "probe-conversation",
      timeoutMs: 1500
    });

    assert.deepEqual(probe.availableCommands, [
      "get-conversation-metadata",
      "new-conversation",
      "send-message",
      "get-conversation"
    ]);
    assert.equal(probe.finalResponseCapabilityProbe.length, 4);
    assert.equal(probe.finalResponseCapabilityProbe.find((entry) => entry.command === "get-conversation")?.supported, true);
    assert.equal(probe.finalResponseCapabilityProbe.find((entry) => entry.command === "get-conversation-messages")?.supported, false);
    assert.equal(probe.finalResponseCapabilityProbe.find((entry) => entry.command === "wait-for-response")?.supported, false);
    assert.equal(probe.finalResponseCapabilityProbe.find((entry) => entry.command === "stream-conversation")?.supported, false);
    assert.equal(probe.snapshot.finalResponseReadSupported, true);
    assert.equal(probe.snapshot.finalResponsePolicy, "pull_or_stream");
    assert.equal(probe.snapshot.commands.getConversation, true);
    assert.equal(probe.snapshot.commands.getConversationMessages, false);
    assert.equal(probe.snapshot.commands.waitForResponse, false);
    assert.equal(probe.snapshot.commands.streamConversation, false);
    assert.deepEqual(probe.snapshot.unsupportedFinalResponseCommands, [
      "get-conversation-messages",
      "wait-for-response",
      "stream-conversation"
    ]);

    const fallbackSnapshot = createAntigravityAgentApiCapabilitySnapshot({
      availableCommands: [],
      completionState: "accepted_only"
    });

    assert.equal(fallbackSnapshot.finalResponseReadSupported, false);
    assert.equal(fallbackSnapshot.finalResponsePolicy, "accepted_only");
    assert.deepEqual(fallbackSnapshot.availableCommands, [
      "get-conversation-metadata",
      "new-conversation",
      "send-message"
    ]);
  });

  it("treats invalid Agent API JSON as plain text and surfaces JSON error payloads", async () => {
    childProcessMock.execFile
      .mockImplementationOnce((command, args, options, callback) => {
        callback(null, { stdout: "plain text output from agentapi", stderr: "" });
      })
      .mockImplementationOnce((command, args, options, callback) => {
        const error = new Error("agentapi failed");
        error.stdout = JSON.stringify({ error: "boom" });
        error.stderr = "";
        callback(error);
      });

    const client = new AntigravityAgentApiClient({
      binaryPath: process.execPath,
      address: "127.0.0.1:1",
      csrfToken: "csrf-token"
    });

    const normalized = await client.runAgentApi(["get-conversation-metadata", "conversation-1"], {
      timeoutMs: 1000
    });

    assert.equal(normalized.rawText, "plain text output from agentapi");
    assert.equal(normalized.text, "plain text output from agentapi");
    assert.equal(normalized.response.text, "plain text output from agentapi");
    assert.equal(normalized.stdout, "plain text output from agentapi");
    assert.equal(normalized.stderr, "");
    assert.equal(childProcessMock.execFile.mock.calls[0][0], process.execPath);
    assert.deepEqual(childProcessMock.execFile.mock.calls[0][1], [
      "agentapi",
      "get-conversation-metadata",
      "conversation-1"
    ]);

    await assert.rejects(
      () => client.runAgentApi(["get-conversation-metadata", "conversation-2"], {
        timeoutMs: 1000
      }),
      (error) => {
        assert.equal(error.message, "boom");
        assert.deepEqual(error.agentApiResponse, { error: "boom" });
        assert.equal(error.stdout, "{\"error\":\"boom\"}");
        assert.equal(error.stderr, "");
        return true;
      }
    );
  });
});
