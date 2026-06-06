import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, describe, it, vi } from "vitest";

import { ACP_METHODS } from "../../../server/platform/common/protocols/acp/index.mjs";
import { AcpRelayRouter } from "../../../server/platform/specialized/capabilities/agent-relay/acp-agent-relay/acp-relay-router.mjs";
import { AcpSessionDriver } from "../../../server/platform/specialized/capabilities/agent-relay/acp-agent-relay/acp-session-driver.mjs";
import { AcpSourceJsonRpcBridge } from "../../../server/platform/specialized/capabilities/agent-relay/acp-agent-relay/acp-source-json-rpc-bridge.mjs";
import { AcpSourceOperationGuard } from "../../../server/platform/specialized/capabilities/agent-relay/acp-agent-relay/acp-source-operation-guard.mjs";
import {
  createAcpSourceStdioServer
} from "../../../server/platform/specialized/capabilities/agent-relay/acp-agent-relay/acp-source-stdio-server.mjs";
import { AcpTargetRegistry } from "../../../server/platform/specialized/capabilities/agent-relay/acp-agent-relay/acp-target-registry.mjs";
import { AcpVirtualAgentRegistry } from "../../../server/platform/specialized/capabilities/agent-relay/acp-agent-relay/acp-virtual-agent-registry.mjs";
import { RelayOperationExecutor } from "../../../server/platform/specialized/capabilities/agent-relay/acp-agent-relay/relay-operation-executor.mjs";
import { RelaySessionStore } from "../../../server/platform/specialized/capabilities/agent-relay/acp-agent-relay/relay-session-store.mjs";

afterEach(() => {
  vi.restoreAllMocks();
});

function createLineTransportHarness() {
  const input = new PassThrough();
  const output = new PassThrough();
  const outputChunks = [];
  output.on("data", (chunk) => {
    outputChunks.push(Buffer.from(chunk).toString("utf8"));
  });
  return { input, output, outputChunks };
}

function parseFrames(outputChunks) {
  return outputChunks
    .join("")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

describe("agent relay runtime final extra 4", () => {
  it("covers target registry, router, and relay session status boundaries", async () => {
    const targetRegistry = new AcpTargetRegistry({
      "target.enabled": {
        targetId: "target.enabled",
        label: "Enabled Target",
        transport: { type: "mock" },
        enabled: true,
        externalServiceId: "service-a",
        advertisedToolsets: ["tool.a", "tool.shared"],
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
        status: {
          enabled: false,
          disabledReason: "maintenance"
        },
        externalServiceId: "service-a",
        advertisedToolsets: []
      }
    });
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
    const router = new AcpRelayRouter({
      virtualAgentRegistry,
      targetRegistry
    });
    const store = new RelaySessionStore();

    assert.equal(targetRegistry.upsertTarget({}), null);
    assert.equal(targetRegistry.getTarget("missing"), null);
    assert.deepEqual(targetRegistry.getAdvertisedToolsets("missing"), []);
    assert.equal(targetRegistry.getPolicy("missing"), null);
    assert.equal(targetRegistry.isTargetEnabled("target.disabled"), false);
    assert.equal(targetRegistry.getTarget("target.disabled").disabledReason, "maintenance");

    const success = await router.resolveForSourceSession({
      virtualAgentId: "agent.enabled",
      workspaceId: "workspace-1",
      requestedMode: "ask",
      prompt: "route this"
    });
    assert.equal(success.ok, true);
    assert.equal(success.route.effectiveMode, "ask");
    assert.deepEqual(success.route.decision.advertisedTools, ["tool.a"]);
    assert.equal(success.route.decision.writesPolicy.writes, "deny");
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
      virtualAgentRegistry: new AcpVirtualAgentRegistry({
        "agent.mismatch": {
          virtualAgentId: "agent.mismatch",
          targetId: "target.enabled",
          displayName: "Mismatch Agent",
          advertisedModes: ["ask"],
          defaultMode: "ask",
          advertisedTools: ["tool.a"],
          metadata: {
            expectedExternalServiceId: "service-b"
          },
          enabled: true
        }
      }),
      targetRegistry
    });
    const mismatch = await mismatchRouter.resolveForSourceSession({
      virtualAgentId: "agent.mismatch"
    });
    assert.equal(mismatch.ok, false);
    assert.equal(mismatch.status, 403);
    assert.equal(mismatch.error.code, "target_external_service_mismatch");

    const session = await store.createSession({
      sourceId: "source-1",
      sourceSessionId: "source-session-1",
      virtualAgentId: "agent.enabled",
      targetId: "target.enabled",
      workspaceId: "workspace-1"
    });
    assert.equal(session.lifecycleState, "dormant");
    assert.equal((await store.getSession(session.relaySessionId)).lifecycleState, "dormant");
    assert.equal(await store.updateSession("missing-session", { lifecycleState: "closed" }), null);

    const closedSession = await store.updateSession(session.relaySessionId, { lifecycleState: "closed" });
    assert.equal(closedSession.lifecycleState, "closed");
  });

  it("covers operation guard deny and confirmation decisions", async () => {
    const appendDecision = vi.fn();
    const denySecurityPermissions = {
      evaluatePolicy: vi.fn(async () => ({
        effect: "deny",
        allowed: false,
        reasonCode: "source_operation_denied",
        redactedReason: "Source ACP operation denied.",
        missingScopes: ["agent_relay:operate"],
        evaluatedLayers: ["source_acp_policy"]
      })),
      appendDecision
    };
    const denyGuard = new AcpSourceOperationGuard({
      securityPermissions: denySecurityPermissions,
      context: {
        sourceId: "source-1",
        workspaceId: "workspace-1"
      }
    });

    const denied = await denyGuard.preflight({
      operationId: "acp_agent_relay.prompt.send",
      input: {
        sourceSessionId: "source-session-1",
        virtualAgentId: "agent.enabled"
      }
    });
    assert.equal(denied.ok, false);
    assert.equal(denied.error.code, "source_operation_denied");
    assert.equal(denied.error.status, 403);
    assert.equal(denied.decision.allowed, false);
    assert.equal(appendDecision.mock.calls.length, 1);
    assert.equal(denySecurityPermissions.evaluatePolicy.mock.calls.length, 1);

    const confirmSecurityPermissions = {
      evaluatePolicy: vi.fn(async () => ({
        effect: "deny",
        allowed: false,
        reasonCode: "confirmation_required",
        redactedReason: "Confirmation required before continuing.",
        missingScopes: ["agent_relay:operate"],
        evaluatedLayers: ["source_acp_policy"]
      })),
      appendDecision: vi.fn()
    };
    const confirmGuard = new AcpSourceOperationGuard({
      securityPermissions: confirmSecurityPermissions,
      enforceConfirmation: true
    });

    const confirmed = await confirmGuard.preflight({
      operationId: "acp_agent_relay.prompt.send",
      input: {
        sourceId: "source-2",
        workspaceId: "workspace-2"
      }
    });
    assert.equal(confirmed.ok, false);
    assert.equal(confirmed.error.code, "confirmation_required");
    assert.equal(confirmed.error.status, 409);
    assert.equal(confirmed.decision.reasonCode, "confirmation_required");
    assert.equal(confirmSecurityPermissions.appendDecision.mock.calls.length, 1);
  });

  it("covers session driver reuse, discard, and close error handling", async () => {
    const closeError = new Error("close failed");
    const closeSpy = vi.fn(async () => {
      throw closeError;
    });
    const initializeSpy = vi.fn(async () => ({
      ok: true,
      wakeMode: "created",
      targetSessionId: "target-session-1",
      targetResumeRef: "resume-1"
    }));
    const connectionFactory = vi.fn(() => ({
      closed: false,
      transport: {
        child: {
          exitCode: 1,
          signalCode: null
        }
      },
      initialize: initializeSpy,
      close: closeSpy
    }));
    const driver = new AcpSessionDriver({
      connectionFactory
    });
    const target = { targetId: "target-1" };
    const relaySession = {
      relaySessionId: "relay-1",
      targetResumeRef: ""
    };

    const firstWake = await driver.wake({ target, relaySession, route: {} });
    assert.equal(firstWake.ok, true);
    assert.equal(firstWake.wakeMode, "created");
    assert.equal(connectionFactory.mock.calls.length, 1);
    assert.equal(initializeSpy.mock.calls.length, 1);

    const secondWake = await driver.wake({ target, relaySession, route: {} });
    assert.equal(secondWake.ok, true);
    assert.equal(secondWake.wakeMode, "created");
    assert.equal(connectionFactory.mock.calls.length, 2);
    assert.equal(closeSpy.mock.calls.length >= 1, true);

    const closeResult = await driver.closeAll();
    assert.equal(closeResult.ok, false);
    assert.equal(closeResult.closedConnections >= 1, true);
    assert.equal(closeResult.results[0].result.ok, false);
    assert.equal(closeResult.results[0].result.error, "close failed");
  });

  it("covers stdio server bad frame and unknown method responses", async () => {
    const runtime = {
      close: vi.fn(async () => {}),
      handleSourceAcpMessage: vi.fn()
    };
    const bridge = new AcpSourceJsonRpcBridge({
      executor: {
        execute: vi.fn(async () => ({
          ok: true,
          data: {}
        }))
      },
      logger: {
        error: vi.fn()
      }
    });
    runtime.handleSourceAcpMessage.mockImplementation((message, context) => bridge.handle(message, context));

    const { input, output, outputChunks } = createLineTransportHarness();
    const server = createAcpSourceStdioServer({
      runtime,
      context: {
        sourceId: "source-stdio",
        workspaceId: "workspace-stdio"
      },
      input,
      output,
      diagnostics: null
    });

    const served = server.serve();
    input.write("{not-json}\n");
    input.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: "unknown-method",
        method: "acp_agent_relay.not_supported",
        params: {}
      })}\n`
    );
    input.end();

    const result = await served;
    assert.deepEqual(result, { ok: true });
    assert.equal(runtime.close.mock.calls.length, 1);

    const frames = parseFrames(outputChunks);
    assert.equal(frames.length, 2);
    assert.equal(frames[0].error.code, -32700);
    assert.equal(frames[1].id, "unknown-method");
    assert.equal(frames[1].error.code, -32601);
    assert.equal(frames[1].error.message, "Unsupported ACP method: acp_agent_relay.not_supported");

    await server.close();
  });

  it("covers relay executor unknown, permission, and preflight branches", async () => {
    const store = {
      createSession: vi.fn(),
      getSession: vi.fn(async () => ({
        relaySessionId: "relay-1",
        sourceId: "source-1",
        sourceSessionId: "source-session-1",
        virtualAgentId: "agent-1",
        workspaceId: "workspace-1",
        lifecycleState: "active"
      })),
      updateSession: vi.fn(),
      createTurn: vi.fn(),
      getTurn: vi.fn(),
      updateTurn: vi.fn(),
      listEvents: vi.fn(async () => []),
      recordEvent: vi.fn(),
      createPermissionRequest: vi.fn(),
      getPermissionRequest: vi.fn(async () => ({
        requestId: "request-1",
        relayTurnId: "turn-1",
        requestedAction: "fs.writeTextFile",
        status: "revoked",
        details: {
          relaySessionId: "relay-1"
        }
      })),
      updatePermissionRequest: vi.fn(),
      listPermissionRequests: vi.fn(async () => [])
    };
    const executor = new RelayOperationExecutor({
      virtualAgentRegistry: new AcpVirtualAgentRegistry(),
      targetRegistry: new AcpTargetRegistry(),
      router: {
        resolveForSourceSession: vi.fn()
      },
      store,
      sessionDriver: {
        wake: vi.fn(),
        cancel: vi.fn(),
        closeSession: vi.fn()
      },
      eventNormalizer: {
        denial: vi.fn((payload) => payload),
        receipt: vi.fn((payload) => payload),
        completion: vi.fn((payload) => payload)
      },
      permissionBridge: {
        readTextFile: vi.fn(),
        requestWriteTextFile: vi.fn(),
        denyTerminal: vi.fn()
      }
    });

    const unknown = await executor.execute("acp_agent_relay.nope", {});
    assert.equal(unknown.ok, false);
    assert.equal(unknown.error.code, "unknown_operation");

    const permission = await executor.execute("acp_agent_relay.permission.resolve", {
      requestId: "request-1"
    });
    assert.equal(permission.ok, false);
    assert.equal(permission.error.code, "permission_request_not_pending");
    assert.equal(permission.error.details.requestId, "request-1");
    assert.equal(
      store.getPermissionRequest.mock.calls.some(([requestId]) => requestId === "request-1"),
      true
    );

    const guard = {
      preflight: vi.fn(async () => ({
        ok: false,
        decision: {
          decisionId: "decision-1",
          allowed: false,
          reasonCode: "source_operation_denied"
        },
        error: {
          code: "source_operation_denied",
          message: "Source ACP operation denied.",
          status: 403,
          details: {
            operationId: "acp_agent_relay.prompt.send"
          }
        }
      }))
    };
    const guardedExecutor = new RelayOperationExecutor({
      virtualAgentRegistry: new AcpVirtualAgentRegistry(),
      targetRegistry: new AcpTargetRegistry(),
      router: {
        resolveForSourceSession: vi.fn()
      },
      store: {
        createSession: vi.fn(),
        getSession: vi.fn(),
        updateSession: vi.fn(),
        createTurn: vi.fn(),
        getTurn: vi.fn(),
        updateTurn: vi.fn(),
        listEvents: vi.fn(),
        recordEvent: vi.fn(),
        createPermissionRequest: vi.fn(),
        getPermissionRequest: vi.fn(),
        updatePermissionRequest: vi.fn(),
        listPermissionRequests: vi.fn()
      },
      sessionDriver: {
        wake: vi.fn(),
        cancel: vi.fn(),
        closeSession: vi.fn()
      },
      eventNormalizer: {
        denial: vi.fn(),
        receipt: vi.fn(),
        completion: vi.fn()
      },
      permissionBridge: {
        readTextFile: vi.fn(),
        requestWriteTextFile: vi.fn(),
        denyTerminal: vi.fn()
      },
      operationGuard: guard
    });

    const preflightDenied = await guardedExecutor.execute("acp_agent_relay.prompt.send", {
      sourceId: "source-1",
      workspaceId: "workspace-1"
    });
    assert.equal(preflightDenied.ok, false);
    assert.equal(preflightDenied.error.code, "source_operation_denied");
    assert.equal(preflightDenied.error.details.sourceAuthorizationDecision.decisionId, "decision-1");
    assert.equal(guard.preflight.mock.calls.length, 1);
  });
});
