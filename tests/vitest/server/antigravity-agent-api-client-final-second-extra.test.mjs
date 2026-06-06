import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import fsNative from "node:fs";
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
  callAntigravityConnectRpc,
  discoverAntigravityAgentApiEndpoint,
  normalizeAntigravityAgentApiResponse,
  readAntigravityConversationMessages,
  readAntigravityTranscriptEntries,
  resolveAntigravityConversationBrainPath,
  resolveAntigravityMessagesDir,
  resolveAntigravityTranscriptPath,
  summarizeAntigravityConversationObservation,
  probeAntigravityAgentApiCapabilities,
  waitForAntigravityConversationObservation
} from "../../../server/platform/specialized/capabilities/agent-relay/acp-agent-relay/antigravity-agent-api-client.mjs";

const tempRoots = [];

async function makeTempRoot(prefix = "pact-acp-agent-relay-antigravity-final-second-extra-") {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value)}\n`, "utf8");
}

afterEach(async () => {
  childProcessMock.execFile.mockReset();
  httpsMock.request.mockReset();
  vi.restoreAllMocks();
  const roots = tempRoots.splice(0);
  await Promise.all(roots.map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("antigravity-agent-api-client final second extra coverage", () => {
  it("normalizes fallback response fields and reads transcript and message edge cases", async () => {
    const tempRoot = await makeTempRoot();
    const conversationId = "conversation-edge";

    assert.equal(resolveAntigravityConversationBrainPath("", { brainRoot: tempRoot }), "");
    assert.equal(
      resolveAntigravityConversationBrainPath(conversationId, { brainRoot: tempRoot }),
      path.join(tempRoot, conversationId)
    );
    assert.equal(
      resolveAntigravityTranscriptPath(conversationId, { brainRoot: tempRoot }),
      path.join(tempRoot, conversationId, ".system_generated/logs/transcript.jsonl")
    );
    assert.equal(
      resolveAntigravityMessagesDir(conversationId, { brainRoot: tempRoot }),
      path.join(tempRoot, conversationId, ".system_generated/messages")
    );

    const transcriptPath = resolveAntigravityTranscriptPath(conversationId, { brainRoot: tempRoot });
    await fs.mkdir(path.dirname(transcriptPath), { recursive: true });
    await fs.writeFile(
      transcriptPath,
      [
        "not-json",
        JSON.stringify({
          source: "MODEL",
          type: "PLANNER_RESPONSE",
          status: "DONE",
          step_index: 1,
          created_at: "2026-06-05T10:00:00Z",
          content: "处理中"
        }),
        JSON.stringify({
          source: "MODEL",
          type: "ERROR_MESSAGE",
          status: "DONE",
          step_index: 2,
          created_at: "2026-06-05T10:00:01Z",
          error: {
            message: "late known error"
          }
        }),
        JSON.stringify({
          source: "MODEL",
          type: "PLANNER_RESPONSE",
          status: "DONE",
          step_index: 3,
          created_at: "2026-06-05T10:00:02Z",
          content: "测试通过，补充完成。"
        })
      ].join("\n"),
      "utf8"
    );

    const transcript = await readAntigravityTranscriptEntries({
      conversationId,
      brainRoot: tempRoot
    });
    const tailTranscript = await readAntigravityTranscriptEntries({
      conversationId,
      brainRoot: tempRoot,
      maxEntries: 2
    });

    assert.equal(transcript.lineCount, 4);
    assert.equal(transcript.entries[0].parseError.length > 0, true);
    assert.equal(transcript.entries[3].content, "测试通过，补充完成。");
    assert.deepEqual(tailTranscript.entries.map((entry) => entry.lineIndex), [2, 3]);

    const messagesDir = resolveAntigravityMessagesDir(conversationId, { brainRoot: tempRoot });
    await fs.mkdir(messagesDir, { recursive: true });
    await writeJson(path.join(messagesDir, "older.json"), {
      id: "older",
      sender: "agent",
      recipient: conversationId,
      timestamp: "2026-06-05T10:00:00Z",
      content: "older note"
    });
    await writeJson(path.join(messagesDir, "marker.json"), {
      id: "marker",
      sender: "agent",
      recipient: conversationId,
      timestamp: "2026-06-05T10:00:01Z",
      content: "marker-stream next"
    });
    await writeJson(path.join(messagesDir, "newer.json"), {
      id: "newer",
      sender: "system",
      recipient: conversationId,
      timestamp: "2026-06-05T10:00:02Z",
      content: "fresh note"
    });
    await fs.writeFile(path.join(messagesDir, "broken.json"), "{not-json", "utf8");
    await fs.writeFile(path.join(messagesDir, "read.json"), JSON.stringify({ id: "read", content: "skip" }), "utf8");
    await fs.writeFile(path.join(messagesDir, "cursor.json"), JSON.stringify({ id: "cursor", content: "skip" }), "utf8");
    await fs.mkdir(path.join(messagesDir, "nested.json"));
    await fs.utimes(path.join(messagesDir, "older.json"), new Date("2026-06-05T10:00:00Z"), new Date("2026-06-05T10:00:00Z"));
    await fs.utimes(path.join(messagesDir, "marker.json"), new Date("2026-06-05T10:00:01Z"), new Date("2026-06-05T10:00:01Z"));
    await fs.utimes(path.join(messagesDir, "newer.json"), new Date("2026-06-05T10:00:02Z"), new Date("2026-06-05T10:00:02Z"));

    const messages = await readAntigravityConversationMessages({
      conversationId,
      brainRoot: tempRoot
    });
    const latestMessageOnly = await readAntigravityConversationMessages({
      conversationId,
      brainRoot: tempRoot,
      maxEntries: 1
    });
    const summary = summarizeAntigravityConversationObservation({
      conversationId,
      marker: "marker-stream",
      transcript,
      messages
    });

    assert.equal(messages.messageCount, 3);
    assert.deepEqual(messages.messages.map((message) => message.id), ["older", "marker", "newer"]);
    assert.deepEqual(latestMessageOnly.messages.map((message) => message.id), ["newer"]);
    assert.equal(summary.markerObserved, true);
    assert.equal(summary.markerMessageObserved, true);
    assert.equal(summary.markerTranscriptObserved, false);
    assert.equal(summary.progressAvailable, true);
    assert.equal(summary.finalResponseAvailable, true);
    assert.equal(summary.latestProgress?.text, "测试通过，补充完成。");
    assert.equal(summary.latestFinalResponse?.text, "测试通过，补充完成。");
    assert.equal(summary.latestKnownError?.errorPreview.includes("late known error"), true);
    assert.equal(summary.latestMarkerMessage?.id, "marker");

    const normalized = normalizeAntigravityAgentApiResponse(
      {
        response: {
          text: "conversation id: conv-77 recipient id: rec-88",
          updates: [{ kind: "stream" }],
          reasoningTraces: [{ thought: "step" }],
          model: "flash-lite"
        }
      },
      {
        stdout: "stdout fallback",
        stderr: "stderr fallback"
      }
    );

    assert.equal(normalized.conversationId, "conv-77");
    assert.equal(normalized.recipientId, "rec-88");
    assert.equal(normalized.model, "flash-lite");
    assert.equal(normalized.text, "conversation id: conv-77 recipient id: rec-88");
    assert.deepEqual(normalized.events, [{ kind: "stream" }]);
    assert.deepEqual(normalized.reasoning, [{ thought: "step" }]);
  });

  it("covers Agent API execution failures, capability probing, and env-backed endpoint discovery", async () => {
    const tempRoot = await makeTempRoot();
    const binaryPath = path.join(tempRoot, "antigravity-bin");
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
        assert.equal(error.stdout, `prefix ${JSON.stringify({ error: "agent api rejected" })} suffix`);
        assert.equal(error.stderr, "");
        return true;
      }
    );

    try {
      await client.runAgentApi(["list"], { timeoutMs: 1 });
      assert.fail("expected the third runAgentApi call to reject");
    } catch (error) {
      assert.equal(error.message, "plain failure");
      assert.equal(error.stdout, "");
      assert.equal(error.stderr, "plain stderr failure");
    }

    const probeClient = {
      commandUsage: vi.fn().mockRejectedValue({
        agentApiResponse: {
          error: JSON.stringify({ error: "usage unavailable" })
        }
      }),
      runAgentApi: vi.fn()
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce({
          stdout: JSON.stringify({ error: "get-conversation-messages failed" })
        })
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce({
          message: "stream fallback failure"
        })
    };

    const probe = await probeAntigravityAgentApiCapabilities(probeClient, {
      conversationId: "conversation-1",
      timeoutMs: 12
    });

    assert.equal(probe.usageText, "usage unavailable");
    assert.deepEqual(probe.availableCommands, []);
    assert.deepEqual(
      probe.finalResponseCapabilityProbe.map((entry) => [entry.command, entry.supported]),
      [
        ["get-conversation", true],
        ["get-conversation-messages", false],
        ["wait-for-response", true],
        ["stream-conversation", false]
      ]
    );
    assert.equal(probe.snapshot.finalResponseReadSupported, true);
    assert.equal(probe.snapshot.finalResponsePolicy, "pull_or_stream");
    assert.equal(probe.snapshot.commands.getConversation, true);
    assert.equal(probe.snapshot.availableCommands.includes("get-conversation"), true);
    assert.deepEqual(probeClient.runAgentApi.mock.calls.map((call) => call[0]), [
      ["get-conversation", "conversation-1"],
      ["get-conversation-messages", "conversation-1"],
      ["wait-for-response", "conversation-1"],
      ["stream-conversation", "conversation-1"]
    ]);

    const discoverSpy = vi.spyOn(AntigravityAgentApiClient.prototype, "getConversationMetadata").mockResolvedValue({
      response: {
        conversationMetadata: {
          metadata: {
            workspaces: []
          }
        }
      }
    });

    const discovered = await discoverAntigravityAgentApiEndpoint({
      conversationId: "conversation-1",
      binaryPath,
      env: {
        PACT_ACP_RELAY_ANTIGRAVITY_LS_ADDRESS: "127.0.0.1:34567",
        PACT_ACP_RELAY_ANTIGRAVITY_CSRF_TOKEN: "env-token"
      }
    });

    assert.equal(discovered.address, "127.0.0.1:34567");
    assert.equal(discovered.csrfToken, "env-token");
    assert.equal(discovered.source, "env");
    assert.equal(discovered.binaryPath, binaryPath);
    assert.equal(discoverSpy.mock.calls[0][0], "conversation-1");
  });

  it("parses connect RPC payloads, surfaces transport failures, and waits for a later final observation", async () => {
    const requestOptions = [];

    httpsMock.request
      .mockImplementationOnce((options, responseCallback) => {
        requestOptions.push(options);
        const request = new EventEmitter();
        request.setTimeout = vi.fn();
        request.destroy = vi.fn();
        request.end = vi.fn((payload) => {
          const response = new EventEmitter();
          response.statusCode = 500;
          response.setEncoding = vi.fn();
          responseCallback(response);
          response.emit("data", "noise [1,2] noise");
          response.emit("end");
        });
        return request;
      })
      .mockImplementationOnce(() => {
        const request = new EventEmitter();
        let timeoutHandler = null;
        request.setTimeout = vi.fn((ms, handler) => {
          timeoutHandler = handler;
        });
        request.destroy = vi.fn((error) => {
          request.emit("error", error);
        });
        request.end = vi.fn(() => {
          timeoutHandler?.();
        });
        return request;
      });

    const result = await callAntigravityConnectRpc({
      address: "127.0.0.1:8443",
      csrfToken: "csrf-token",
      method: "GetConversationMetadata",
      body: {
        conversationId: "conv-1"
      }
    });

    assert.equal(result.ok, false);
    assert.equal(result.statusCode, 500);
    assert.deepEqual(result.body, [1,2]);
    assert.equal(result.rawText, "noise [1,2] noise");
    assert.equal(
      requestOptions[0].path,
      "/exa.language_server_pb.LanguageServerService/GetConversationMetadata"
    );

    await assert.rejects(
      () => callAntigravityConnectRpc({
        address: "127.0.0.1:8443",
        csrfToken: "csrf-token",
        method: "GetConversationMetadata",
        body: {
          conversationId: "conv-1"
        },
        timeoutMs: 1
      }),
      /timed out/
    );

    const tempRoot = await makeTempRoot();
    const conversationId = "conversation-wait";
    const transcriptPath = resolveAntigravityTranscriptPath(conversationId, { brainRoot: tempRoot });
    const messagesDir = resolveAntigravityMessagesDir(conversationId, { brainRoot: tempRoot });

    await fs.mkdir(path.dirname(transcriptPath), { recursive: true });
    await fs.writeFile(
      transcriptPath,
      `${JSON.stringify({
        source: "MODEL",
        type: "PLANNER_RESPONSE",
        status: "DONE",
        step_index: 0,
        created_at: "2026-06-05T10:01:00Z",
        content: "still working"
      })}\n`,
      "utf8"
    );
    await fs.mkdir(messagesDir, { recursive: true });
    await writeJson(path.join(messagesDir, "first.json"), {
      id: "first",
      sender: "system",
      recipient: conversationId,
      timestamp: "2026-06-05T10:01:00Z",
      content: "first note"
    });

    setTimeout(() => {
      fsNative.appendFileSync(
        transcriptPath,
        `${JSON.stringify({
          source: "MODEL",
          type: "PLANNER_RESPONSE",
          status: "DONE",
          step_index: 1,
          created_at: "2026-06-05T10:01:01Z",
          content: "测试通过，补充完成。"
        })}\n`
      );
    }, 60);

    const observation = await waitForAntigravityConversationObservation({
      conversationId,
      brainRoot: tempRoot,
      timeoutMs: 1000,
      pollIntervalMs: 25,
      until: "final"
    });

    assert.equal(observation.finalResponseAvailable, true);
    assert.equal(observation.progressAvailable, true);
    assert.equal(observation.latestFinalResponse?.text, "测试通过，补充完成。");
  });
});
