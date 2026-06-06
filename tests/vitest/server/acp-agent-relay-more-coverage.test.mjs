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

import { ACP_METHODS } from "../../../server/platform/common/protocols/acp/index.mjs";
import {
  AntigravityAgentApiClient,
  callAntigravityConnectRpc
} from "../../../server/platform/specialized/capabilities/agent-relay/acp-agent-relay/antigravity-agent-api-client.mjs";
import {
  AcpClientConnection
} from "../../../server/platform/specialized/capabilities/agent-relay/acp-agent-relay/acp-client-connection.mjs";
import {
  AcpRelayRouter
} from "../../../server/platform/specialized/capabilities/agent-relay/acp-agent-relay/acp-relay-router.mjs";
import {
  AcpTargetRegistry,
  createDefaultAcpTargetRegistry
} from "../../../server/platform/specialized/capabilities/agent-relay/acp-agent-relay/acp-target-registry.mjs";
import {
  AcpVirtualAgentRegistry,
  createDefaultAcpVirtualAgentRegistry
} from "../../../server/platform/specialized/capabilities/agent-relay/acp-agent-relay/acp-virtual-agent-registry.mjs";
import {
  createAcpSourceStdioServer,
  createAcpSourceStdioServerOptionsFromEnv
} from "../../../server/platform/specialized/capabilities/agent-relay/acp-agent-relay/acp-source-stdio-server.mjs";

afterEach(() => {
  childProcessMock.execFile.mockReset();
  httpsMock.request.mockReset();
  sourceJsonRpcMock.createAcpSourceJsonRpcLineTransport.mockReset();
  sourceJsonRpcMock.createAcpSourceJsonRpcService.mockReset();
});

describe("acp-agent-relay more coverage", () => {
  it("treats plain text Agent API output as a non-JSON response", async () => {
    childProcessMock.execFile.mockImplementation((command, args, options, callback) => {
      callback(null, { stdout: "plain text agentapi output", stderr: "" });
    });

    const client = new AntigravityAgentApiClient({
      binaryPath: process.execPath,
      address: "127.0.0.1:1",
      csrfToken: "csrf-token"
    });

    const response = await client.runAgentApi(["get-conversation-metadata", "conversation-1"], {
      timeoutMs: 1000
    });

    assert.equal(response.rawText, "plain text agentapi output");
    assert.equal(response.text, "plain text agentapi output");
    assert.equal(response.response.text, "plain text agentapi output");
    assert.equal(response.stdout, "plain text agentapi output");
    assert.equal(response.stderr, "");
  });

  it("rethrows Agent API process errors without JSON payloads and preserves stderr and stdout", async () => {
    childProcessMock.execFile.mockImplementation((command, args, options, callback) => {
      const error = new Error("agentapi failed");
      error.stdout = "";
      error.stderr = "non-json stderr output";
      callback(error);
    });

    const client = new AntigravityAgentApiClient({
      binaryPath: process.execPath,
      address: "127.0.0.1:1",
      csrfToken: "csrf-token"
    });

    await assert.rejects(
      () => client.runAgentApi(["get-conversation-metadata", "conversation-2"], { timeoutMs: 1000 }),
      (error) => {
        assert.equal(error.message, "agentapi failed");
        assert.equal(error.stdout, "");
        assert.equal(error.stderr, "non-json stderr output");
        return true;
      }
    );
  });

  it("treats non-JSON Connect RPC responses as empty bodies with raw text preserved", async () => {
    httpsMock.request.mockImplementation((requestOptions, responseCallback) => {
      const request = new EventEmitter();
      request.setTimeout = vi.fn();
      request.destroy = vi.fn();
      request.end = vi.fn((payload) => {
        const response = new EventEmitter();
        response.statusCode = 500;
        response.setEncoding = vi.fn();
        responseCallback(response);
        response.emit("data", "<html>gateway error</html>");
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

    assert.equal(result.ok, false);
    assert.equal(result.statusCode, 500);
    assert.deepEqual(result.body, {});
    assert.equal(result.rawText, "<html>gateway error</html>");
  });

  it("covers registry and router boundary checks for unknown, disabled, and mismatched bindings", async () => {
    const virtualAgentRegistry = new AcpVirtualAgentRegistry({
      "agent.enabled": {
        virtualAgentId: "agent.enabled",
        targetId: "target.enabled",
        profileId: "profile.enabled",
        displayName: "Enabled Agent",
        advertisedModes: ["ask", "edit"],
        defaultMode: "edit",
        advertisedTools: ["tool.a", "tool.b"],
        reasoningVisibilityPolicy: "never",
        capabilityPolicy: {
          writes: "deny",
          terminal: "deny",
          maxRisk: "read_only"
        },
        enabled: true,
        revision: 4,
        metadata: {
          expectedExternalServiceId: "service-a"
        }
      },
      "agent.disabled": {
        virtualAgentId: "agent.disabled",
        targetId: "target.enabled",
        displayName: "Disabled Agent",
        advertisedModes: ["ask"],
        defaultMode: "ask",
        advertisedTools: [],
        enabled: false
      }
    });
    const targetRegistry = new AcpTargetRegistry({
      "target.enabled": {
        targetId: "target.enabled",
        label: "Enabled Target",
        transport: { type: "mock" },
        enabled: true,
        externalServiceId: "service-a",
        advertisedToolsets: ["tool.a", "tool.z"],
        capabilityPolicy: {
          writes: "approval_required",
          terminal: "deny",
          maxRisk: "repair_write"
        },
        revision: 2
      },
      "target.disabled": {
        targetId: "target.disabled",
        label: "Disabled Target",
        transport: { type: "mock" },
        enabled: false,
        externalServiceId: "service-a",
        advertisedToolsets: []
      }
    });

    assert.equal(virtualAgentRegistry.upsertAgent({}), null);
    assert.equal(createDefaultAcpVirtualAgentRegistry().listEnabled().length > 0, true);
    assert.equal(createDefaultAcpTargetRegistry().listTargets().length > 0, true);
    assert.deepEqual(virtualAgentRegistry.getToolsetForMode("agent.enabled", "unknown"), {
      agent: virtualAgentRegistry.getAgent("agent.enabled"),
      effectiveMode: "edit",
      advertisedTools: ["tool.a", "tool.b"]
    });
    assert.deepEqual(targetRegistry.getAdvertisedToolsets("missing-target"), []);
    assert.equal(targetRegistry.getPolicy("missing-target"), null);

    const router = new AcpRelayRouter({
      virtualAgentRegistry,
      targetRegistry
    });

    const success = await router.resolveForSourceSession({
      virtualAgentId: "agent.enabled",
      workspaceId: "workspace-1",
      requestedMode: "edit",
      prompt: "hello relay",
      sourceId: "source-1"
    });
    assert.equal(success.ok, true);
    assert.equal(success.route.effectiveMode, "edit");
    assert.deepEqual(success.route.decision.advertisedTools, ["tool.a"]);
    assert.equal(success.route.decision.reasoningAllowed, false);
    assert.equal(success.route.policyRevision, 6);
    assert.match(success.route.turnFingerprint, /^[a-f0-9]{64}$/);

    const unknownAgent = await router.resolveForSourceSession({
      virtualAgentId: "agent.missing"
    });
    assert.equal(unknownAgent.ok, false);
    assert.equal(unknownAgent.status, 404);
    assert.equal(unknownAgent.error.code, "virtual_agent_unknown");

    const disabledAgent = await router.resolveForSourceSession({
      virtualAgentId: "agent.disabled"
    });
    assert.equal(disabledAgent.ok, false);
    assert.equal(disabledAgent.status, 403);
    assert.equal(disabledAgent.error.code, "virtual_agent_disabled");

    const disabledTargetRouter = new AcpRelayRouter({
      virtualAgentRegistry,
      targetRegistry: new AcpTargetRegistry({
        "target.enabled": {
          targetId: "target.enabled",
          label: "Enabled Target",
          transport: { type: "mock" },
          enabled: false,
          externalServiceId: "service-a",
          advertisedToolsets: []
        }
      })
    });
    const disabledTarget = await disabledTargetRouter.resolveForSourceSession({
      virtualAgentId: "agent.enabled"
    });
    assert.equal(disabledTarget.ok, false);
    assert.equal(disabledTarget.status, 403);
    assert.equal(disabledTarget.error.code, "target_disabled");

    const mismatchRouter = new AcpRelayRouter({
      virtualAgentRegistry,
      targetRegistry: new AcpTargetRegistry({
        "target.enabled": {
          targetId: "target.enabled",
          label: "Enabled Target",
          transport: { type: "mock" },
          enabled: true,
          externalServiceId: "service-b",
          advertisedToolsets: ["tool.a", "tool.z"],
          capabilityPolicy: {
            writes: "approval_required",
            terminal: "deny",
            maxRisk: "repair_write"
          },
          revision: 2
        }
      })
    });
    const mismatch = await mismatchRouter.resolveForSourceSession({
      virtualAgentId: "agent.enabled"
    });
    assert.equal(mismatch.ok, false);
    assert.equal(mismatch.status, 403);
    assert.equal(mismatch.error.code, "target_external_service_mismatch");
  });

  it("covers AcpClientConnection fallback and transport update handling", async () => {
    const fallbackConnection = new AcpClientConnection({
      target: {
        targetId: "mock.target"
      }
    });

    const initialize = await fallbackConnection.initialize({ relaySessionId: "relay-session-1" });
    assert.equal(initialize.ok, true);
    assert.equal(initialize.capabilities.session.includes("new"), true);
    assert.equal(fallbackConnection.initialized, true);

    const prompt = await fallbackConnection.sendPrompt({
      prompt: "describe fallback path"
    });
    assert.equal(prompt.ok, true);
    assert.equal(prompt.stopReason, "completed");
    assert.equal(prompt.text, "Mock ACP target completed: describe fallback path");
    assert.equal(prompt.finalResponseAvailable, undefined);

    const sentMessages = [];
    const queued = [];
    const waiters = [];
    const pushFrame = (frame) => {
      const waiter = waiters.shift();
      if (waiter) {
        waiter(frame);
        return;
      }
      queued.push(frame);
    };
    const transport = {
      async send(message) {
        sentMessages.push(message);
        if (message.method === ACP_METHODS.initialize) {
          pushFrame(JSON.stringify({
            jsonrpc: "2.0",
            id: message.id,
            result: {
              capabilities: { session: ["new"], updates: ["progress"], fs: [], terminal: false, mcp: false },
              protocolVersion: "1.0"
            }
          }));
          return true;
        }
        if (message.method === ACP_METHODS.sessionNew) {
          pushFrame(JSON.stringify({
            jsonrpc: "2.0",
            id: message.id,
            result: {
              targetSessionId: "target-session-1",
              targetResumeRef: "resume-1"
            }
          }));
          return true;
        }
        if (message.method === ACP_METHODS.sessionPrompt) {
          pushFrame(JSON.stringify({
            jsonrpc: "2.0",
            method: ACP_METHODS.sessionUpdate,
            params: {
              phase: "working",
              text: "collecting updates"
            }
          }));
          pushFrame(JSON.stringify({
            jsonrpc: "2.0",
            id: message.id,
            result: {
              ok: true,
              text: "final transport response",
              targetSessionId: "target-session-1",
              targetResumeRef: "resume-1",
              updates: [{ type: "progress", phase: "working" }],
              reasoning: ["because transport"],
              stopReason: "completed"
            }
          }));
          return true;
        }
        return false;
      },
      async receive() {
        return queued.length > 0
          ? queued.shift()
          : new Promise((resolve) => waiters.push(resolve));
      },
      close() {
        while (waiters.length) {
          waiters.shift()(null);
        }
      }
    };

    const transportConnection = new AcpClientConnection({
      target: {
        targetId: "mock.transport-target"
      },
      transport
    });

    const transportInitialize = await transportConnection.initialize({
      relaySessionId: "relay-session-2"
    });
    assert.equal(sentMessages[0].method, ACP_METHODS.initialize);
    assert.equal(sentMessages[1].method, ACP_METHODS.sessionNew);
    assert.equal(transportInitialize.targetSessionId, "target-session-1");
    assert.equal(transportInitialize.targetResumeRef, "resume-1");
    assert.equal(transportConnection.initialized, true);

    const transportPrompt = await transportConnection.sendPrompt({
      prompt: "collect transport updates"
    });
    assert.equal(sentMessages[2].method, ACP_METHODS.sessionPrompt);
    assert.equal(transportPrompt.ok, true);
    assert.equal(transportPrompt.text, "final transport response");
    assert.equal(transportPrompt.targetSessionId, "target-session-1");
    assert.equal(transportPrompt.targetResumeRef, "resume-1");
    assert.equal(transportPrompt.updates.length, 2);
    assert.equal(transportPrompt.reasoning[0], "because transport");
    assert.equal(transportPrompt.externalCompletionState, "completed");
  });

  it("rejects invalid stdio env JSON and emits ready diagnostics for a bounded serve loop", async () => {
    assert.throws(
      () => createAcpSourceStdioServerOptionsFromEnv({
        PACT_ACP_SOURCE_STDIO_RUNTIME_JSON: "{not-json"
      }),
      /Invalid JSON environment configuration/
    );

    const runtime = {
      store: {
        adapter: {
          storagePath: "/tmp/acp-source-store.json"
        }
      },
      close: vi.fn()
    };
    const service = {
      serveTransport: vi.fn(async () => {}),
      close: vi.fn()
    };
    const transport = {
      receive: vi.fn(async () => null),
      send: vi.fn(async () => true),
      close: vi.fn()
    };
    const diagnostics = {
      write: vi.fn()
    };
    sourceJsonRpcMock.createAcpSourceJsonRpcLineTransport.mockReturnValue(transport);
    sourceJsonRpcMock.createAcpSourceJsonRpcService.mockReturnValue(service);

    const server = createAcpSourceStdioServer({
      runtime,
      context: {
        sourceId: "source-stdio-1",
        workspaceId: "workspace-stdio-1"
      },
      input: new EventEmitter(),
      output: {
        write() {
          return true;
        }
      },
      diagnostics
    });

    const result = await server.serve();
    assert.deepEqual(result, { ok: true });
    assert.equal(service.serveTransport.mock.calls.length, 1);
    assert.equal(runtime.close.mock.calls.length, 1);
    assert.equal(diagnostics.write.mock.calls.length, 1);

    const payload = JSON.parse(diagnostics.write.mock.calls[0][0]);
    assert.equal(payload.event, "pact.acp.source_stdio.ready");
    assert.equal(payload.durableStore, true);
    assert.equal(payload.storagePath, "/tmp/acp-source-store.json");
    assert.equal(payload.sourceId, "source-stdio-1");
    assert.equal(payload.workspaceId, "workspace-stdio-1");
  });
});
