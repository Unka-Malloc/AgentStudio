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
  createAntigravityAgentApiCapabilitySnapshot,
  readAntigravityConversationMessages,
  readAntigravityTranscriptEntries,
  resolveAntigravityAgentApiBinary,
  resolveAntigravityMessagesDir,
  resolveAntigravityTranscriptPath,
  summarizeAntigravityConversationObservation
} from "../../../server/platform/specialized/capabilities/agent-relay/acp-agent-relay/antigravity-agent-api-client.mjs";

const tempRoots = [];

async function makeTempRoot(prefix = "pact-acp-agent-relay-antigravity-final-extra-") {
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
  const roots = tempRoots.splice(0);
  await Promise.all(roots.map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("antigravity-agent-api-client final extra coverage", () => {
  it("skips broken shell wrappers when resolving binaries and still honors later usable candidates", async () => {
    const tempRoot = await makeTempRoot();
    const wrapperPath = path.join(tempRoot, "agentapi");
    const targetPath = path.join(tempRoot, "missing-target");
    const envBinaryPath = path.join(tempRoot, "real-agentapi");

    await fs.writeFile(wrapperPath, `#!/bin/sh\nexec "${targetPath}" agentapi\n`, "utf8");
    await fs.writeFile(envBinaryPath, "binary", "utf8");

    const resolved = await resolveAntigravityAgentApiBinary({
      binaryPath: wrapperPath,
      env: {
        PACT_ACP_RELAY_ANTIGRAVITY_BINARY: envBinaryPath
      }
    });

    assert.equal(resolved, envBinaryPath);
  });

  it("covers Connect RPC validation failures and the happy-path response body", async () => {
    await assert.rejects(
      () => callAntigravityConnectRpc({
        csrfToken: "csrf-token",
        method: "GetConversationMetadata",
        body: { conversationId: "conversation-1" }
      }),
      /requires a local address/
    );

    await assert.rejects(
      () => callAntigravityConnectRpc({
        address: "127.0.0.1:8443",
        method: "GetConversationMetadata",
        body: { conversationId: "conversation-1" }
      }),
      /requires a CSRF token/
    );

    await assert.rejects(
      () => callAntigravityConnectRpc({
        address: "127.0.0.1:8443",
        csrfToken: "csrf-token",
        body: { conversationId: "conversation-1" }
      }),
      /requires a method/
    );

    await assert.rejects(
      () => callAntigravityConnectRpc({
        address: "http://127.0.0.1:8443",
        csrfToken: "csrf-token",
        method: "GetConversationMetadata",
        body: { conversationId: "conversation-1" }
      }),
      /requires an HTTPS endpoint/
    );

    const seen = {};
    httpsMock.request.mockImplementation((requestOptions, responseCallback) => {
      Object.assign(seen, requestOptions);
      const request = new EventEmitter();
      request.end = vi.fn((payload) => {
        seen.payload = payload;
        const response = new EventEmitter();
        response.statusCode = 200;
        response.setEncoding = vi.fn();
        responseCallback(response);
        response.emit("data", '{"response":{"conversationId":"conversation-1"}}');
        response.emit("end");
      });
      request.setTimeout = vi.fn();
      request.destroy = vi.fn();
      return request;
    });

    const result = await callAntigravityConnectRpc({
      address: "127.0.0.1:8443",
      csrfToken: "csrf-token",
      method: "GetConversationMetadata",
      body: { conversationId: "conversation-1" }
    });

    assert.equal(result.ok, true);
    assert.equal(result.statusCode, 200);
    assert.deepEqual(result.body, {
      response: {
        conversationId: "conversation-1"
      }
    });
    assert.equal(result.rawText, '{"response":{"conversationId":"conversation-1"}}');
    assert.equal(seen.path, "/exa.language_server_pb.LanguageServerService/GetConversationMetadata");
    assert.equal(seen.headers["x-codeium-csrf-token"], "csrf-token");
    assert.equal(seen.payload, '{"conversationId":"conversation-1"}');
  });

  it("summarizes transcript and message markers while preserving known errors and final responses", async () => {
    const tempRoot = await makeTempRoot();
    const conversationId = "conversation-final-extra";
    const transcriptPath = resolveAntigravityTranscriptPath(conversationId, { brainRoot: tempRoot });
    const messagesDir = resolveAntigravityMessagesDir(conversationId, { brainRoot: tempRoot });

    await writeJson(path.join(path.dirname(transcriptPath), path.basename(transcriptPath)), {
      source: "MODEL",
      type: "PLANNER_RESPONSE",
      status: "DONE",
      step_index: 1,
      created_at: "2026-06-05T10:00:00Z",
      content: "marker-final-extra: 起始"
    });
    await fs.appendFile(
      transcriptPath,
      `${JSON.stringify({
        source: "MODEL",
        type: "ERROR_MESSAGE",
        status: "DONE",
        step_index: 2,
        created_at: "2026-06-05T10:00:01Z",
        error: {
          message: "relay exploded"
        }
      })}\n`,
      "utf8"
    );
    await fs.appendFile(
      transcriptPath,
      `${JSON.stringify({
        source: "MODEL",
        type: "PLANNER_RESPONSE",
        status: "DONE",
        step_index: 3,
        created_at: "2026-06-05T10:00:02Z",
        content: "测试通过，补充完成。"
      })}\n`,
      "utf8"
    );

    await fs.mkdir(messagesDir, { recursive: true });
    const markerMessagePath = path.join(messagesDir, "message-marker.json");
    const laterMessagePath = path.join(messagesDir, "message-later.json");
    await fs.writeFile(
      markerMessagePath,
      JSON.stringify({
        id: "message-marker",
        sender: "system",
        recipient: conversationId,
        timestamp: "2026-06-05T10:00:00Z",
        content: "marker-final-extra: message"
      }),
      "utf8"
    );
    await fs.writeFile(
      laterMessagePath,
      JSON.stringify({
        id: "message-later",
        sender: "agent",
        recipient: conversationId,
        timestamp: "2026-06-05T10:00:03Z",
        content: "latest relay note"
      }),
      "utf8"
    );
    await fs.utimes(markerMessagePath, new Date("2026-06-05T10:00:00Z"), new Date("2026-06-05T10:00:00Z"));
    await fs.utimes(laterMessagePath, new Date("2026-06-05T10:00:03Z"), new Date("2026-06-05T10:00:03Z"));

    const transcript = await readAntigravityTranscriptEntries({
      conversationId,
      brainRoot: tempRoot
    });
    const messages = await readAntigravityConversationMessages({
      conversationId,
      brainRoot: tempRoot
    });
    const summary = summarizeAntigravityConversationObservation({
      conversationId,
      marker: "marker-final-extra",
      transcript,
      messages
    });

    assert.equal(summary.markerObserved, true);
    assert.equal(summary.markerTranscriptObserved, true);
    assert.equal(summary.markerMessageObserved, true);
    assert.equal(summary.progressAvailable, true);
    assert.equal(summary.finalResponseAvailable, true);
    assert.equal(summary.latestProgress?.text, "测试通过，补充完成。");
    assert.equal(summary.latestFinalResponse?.text, "测试通过，补充完成。");
    assert.equal(summary.latestKnownError?.errorPreview.includes("relay exploded"), true);
    assert.equal(summary.latestMessage?.id, "message-later");
  });

  it("validates interaction decisions, capability snapshots, and client command builders", async () => {
    assert.throws(
      () => buildAntigravityCascadeUserInteractionDecision({}),
      /requires a conversation id/
    );
    assert.throws(
      () => buildAntigravityCascadeUserInteractionDecision({
        conversationId: "conversation-1",
        step: {}
      }),
      /requires an interaction trajectory id/
    );

    assert.deepEqual(
      buildAntigravityCascadeUserInteractionDecision({
        conversationId: "conversation-1",
        step: {
          trajectoryId: "trajectory-1",
          stepIndex: 4
        },
        approved: true
      }),
      {
        cascadeId: "conversation-1",
        interaction: {
          trajectoryId: "trajectory-1",
          stepIndex: 4,
          permission: {
            approved: true
          }
        }
      }
    );

    const snapshot = createAntigravityAgentApiCapabilitySnapshot({
      availableCommands: [],
      completionState: "completed"
    });
    assert.equal(snapshot.finalResponseReadSupported, false);
    assert.equal(snapshot.finalResponsePolicy, "inline_response");
    assert.deepEqual(snapshot.availableCommands, [
      "get-conversation-metadata",
      "new-conversation",
      "send-message"
    ]);

    const tempRoot = await makeTempRoot();
    const binaryPath = path.join(tempRoot, "agentapi");
    await fs.writeFile(binaryPath, "binary", "utf8");

    childProcessMock.execFile.mockImplementation((command, args, options, callback) => {
      callback(null, {
        stdout: JSON.stringify({
          response: {
            conversationId: "conversation-created",
            recipientId: "conversation-created"
          }
        }),
        stderr: ""
      });
    });

    const client = new AntigravityAgentApiClient({
      binaryPath,
      address: "127.0.0.1:1",
      csrfToken: "csrf-token"
    });

    await assert.rejects(
      () => client.getConversationMetadata(""),
      /requires a conversation id/
    );
    await assert.rejects(
      () => client.newConversation({ prompt: "" }),
      /requires a prompt/
    );
    await assert.rejects(
      () => client.sendMessage({ recipientId: "conversation-1", content: "" }),
      /requires content/
    );

    await client.newConversation({ prompt: "hello relay" });
    await client.sendMessage({ recipientId: "conversation-1", content: "hello again" });

    assert.deepEqual(childProcessMock.execFile.mock.calls[0][1], [
      "new-conversation",
      "--model=flash",
      "hello relay"
    ]);
    assert.deepEqual(childProcessMock.execFile.mock.calls[1][1], [
      "send-message",
      "conversation-1",
      "hello again"
    ]);
  });
});
