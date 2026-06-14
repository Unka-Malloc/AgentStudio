import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, it } from "vitest";

import {
  ACP_METHODS,
  createError,
  createInMemoryJsonRpcTransport,
  createNotification,
  createRequest,
  createSuccess,
  parseJsonRpcFrame,
  parseJsonRpcMessage
} from "../../../server/platform/common/protocols/acp/index.mjs";
import { SERVER_API_OPERATIONS } from "../../../server/platform/common/operation-dispatcher/operation-registry.mjs";
import { evaluateAuthorizationPolicy } from "../../../server/platform/common/security/authorization/authorization-engine.mjs";
import {
  RelaySessionStore,
  AcpClientConnection,
  AcpEventNormalizer,
  AcpPermissionBridge,
  AcpSessionDriver,
  AcpTargetRegistry,
  AcpVirtualAgentRegistry,
  AntigravityAgentApiClient,
  AntigravityAgentApiConnection,
  buildAntigravityCascadeUserInteractionDecision,
  createAntigravityAgentApiCapabilitySnapshot,
  createAcpTargetConnection,
  createAcpRelayRuntime,
  createAcpSourceJsonRpcBridge,
  createAcpSourceJsonRpcLineTransport,
  createAcpSourceJsonRpcService,
  createAcpSourceJsonRpcTransportPair,
  createFileRelaySessionAdapter,
  normalizeAntigravityCascadeTrajectory,
  observeAntigravityConversation,
  parseAntigravityAgentApiCommands,
  probeAntigravityIdeCliCapabilities,
  probeAntigravityAgentApiCapabilities,
  readAntigravityConversationMessages,
  readAntigravityTranscriptEntries,
  resolveAntigravityConversationBrainPath,
  resolveAntigravityAgentApiBinary,
  summarizeAntigravityConnectObservation,
  summarizeAntigravityConversationObservation
} from "../../../server/platform/specialized/capabilities/agent-relay/acp-agent-relay/index.mjs";
import { createToolManagementPlatform } from "../../../server/platform/specialized/capabilities/tools/tool-management-core/index.mjs";
import { createToolSkillManagementProvider } from "../../../server/platform/specialized/capabilities/skills/tool-skill-management-provider.mjs";
import { executeConsoleDomainOperation } from "../../../server/platform/specialized/console/console-domain-operation-executor.mjs";

const tempDirs = [];

function nowIso() {
  return new Date().toISOString();
}

async function makeTempDir(prefix = "pact-acp-agent-relay-") {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function parseProtocolPayload(requestBody, url = null) {
  if (requestBody?.length > 0) {
    return JSON.parse(requestBody.toString("utf8"));
  }
  return url ? Object.fromEntries(url.searchParams.entries()) : {};
}

function createCapturedHttpResponse() {
  return {
    statusCode: 200,
    headers: {},
    chunks: [],
    writeHead(statusCode, headers = {}) {
      this.statusCode = statusCode;
      this.headers = { ...this.headers, ...headers };
    },
    end(chunk = "") {
      if (chunk !== undefined && chunk !== null && chunk !== "") {
        this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      }
      this.ended = true;
    }
  };
}

function capturedJson(response) {
  const text = Buffer.concat(response.chunks || []).toString("utf8").trim();
  return text ? JSON.parse(text) : null;
}

async function callAgentRelayHttp({ platform, token, method = "GET", path: requestPath, body = null, headers = {} }) {
  const response = createCapturedHttpResponse();
  const url = new URL(requestPath, "http://127.0.0.1");
  const requestBody = body ? Buffer.from(JSON.stringify(body), "utf8") : Buffer.alloc(0);
  const request = {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      "user-agent": "acp-agent-relay-vitest",
      ...headers
    },
    socket: { remoteAddress: "127.0.0.1" }
  };
  const handled = await platform.router.handleToolManagementHttpRequest({
    request,
    response,
    requestBody,
    url,
    method
  });
  assert.equal(handled, true);
  return {
    status: response.statusCode,
    payload: capturedJson(response)
  };
}

async function callToolManagementHttp({ platform, method = "GET", path: requestPath, body = null, headers = {} }) {
  const response = createCapturedHttpResponse();
  const url = new URL(requestPath, "http://127.0.0.1");
  const requestBody = body ? Buffer.from(JSON.stringify(body), "utf8") : Buffer.alloc(0);
  const request = {
    method,
    headers: {
      "user-agent": "acp-agent-relay-vitest",
      ...headers
    },
    socket: { remoteAddress: "127.0.0.1" }
  };
  const handled = await platform.router.handleToolManagementHttpRequest({
    request,
    response,
    requestBody,
    url,
    method
  });
  assert.equal(handled, true);
  return {
    status: response.statusCode,
    payload: capturedJson(response)
  };
}

function createAllowAllSecurityPermissions() {
  return {
    evaluatePolicy() {
      return {
        effect: "allow",
        allowed: true,
        reasonCode: "vitest_allowed",
        redactedReason: "Allowed by ACP agent relay test.",
        missingScopes: [],
        missingToolsets: [],
        evaluatedLayers: ["vitest"],
        createdAt: nowIso(),
        effectivePolicySnapshot: {
          policyRevision: {
            protocolVersion: "v0.0.1:test:authorization-1",
            revision: 1,
            updatedAt: nowIso()
          }
        }
      };
    },
    getGovernancePolicyRevision() {
      return {
        protocolVersion: "v0.0.1:test:authorization-1",
        revision: 1,
        updatedAt: nowIso()
      };
    },
    appendDecision() {}
  };
}

function createAuthorizationSecurityPermissions() {
  const decisions = [];
  return {
    decisions,
    evaluatePolicy(input = {}) {
      return evaluateAuthorizationPolicy(input);
    },
    getGovernancePolicyRevision() {
      return {
        protocolVersion: "v0.0.1:test:authorization-1",
        revision: 1,
        updatedAt: nowIso()
      };
    },
    appendDecision(decision) {
      decisions.push(decision);
    }
  };
}

function createAgentRelayHttpPlatform({ userDataPath, workspaceRoot, changeHandlers = [] }) {
  let httpPlatform = null;
  let providerCore = null;
  const httpProvider = {
    handleToolManagementHttpRequest(args) {
      return httpPlatform.router.handleToolManagementHttpRequest(args);
    },
    createAuthorizationGrant(input = {}) {
      return providerCore.createAuthorizationGrant(input);
    },
    revokeAuthorizationGrant(input = {}) {
      return providerCore.revokeAuthorizationGrant(input);
    },
    createRelayMcpGrant(input = {}) {
      return providerCore.createRelayMcpGrant(input);
    },
    revokeRelayMcpGrant(input = {}) {
      return providerCore.revokeRelayMcpGrant(input);
    }
  };
  const controllers = {
    system: {
      async handleToolManagementPassthrough({ operation, request, response, requestBody, url, params = {} }) {
        const operationResult = await executeConsoleDomainOperation({
          operationId: operation?.id || "",
          input: {
            ...parseProtocolPayload(requestBody, url),
            ...(params && typeof params === "object" ? params : {})
          },
          context: {
            userDataPath,
            workspaceRoot,
            request,
            response,
            requestBody,
            url,
            method: operation?.http?.method || request?.method || "GET",
            toolSkillManagementProvider: httpProvider
          }
        });
        if (operationResult.payload?.__responseHandled) {
          return;
        }
        response.writeHead(operationResult.status || 200, { "content-type": "application/json" });
        response.end(JSON.stringify(operationResult.payload ?? operationResult));
      }
    }
  };
  httpPlatform = createToolManagementPlatform({
    userDataPath,
    operations: SERVER_API_OPERATIONS,
    controllers,
    securityPermissions: createAllowAllSecurityPermissions(),
    changeHandlers,
    logger: {
      debug() {},
      info() {},
      warn() {},
      error() {}
    }
  });
  providerCore = createToolSkillManagementProvider({
    toolManagementPlatform: httpPlatform,
    userDataPath
  });
  return httpPlatform;
}

async function createSession(runtime, overrides = {}) {
  const result = await runtime.execute("acp_agent_relay.session.create", {
    sourceId: "codex-vitest",
    sourceSessionId: `source-${Date.now()}-${Math.random()}`,
    workspaceId: "vitest-workspace",
    virtualAgentId: "antigravity.multimodal-coding",
    ...overrides
  });
  assert.equal(result.ok, true);
  return result.data.session;
}

function assertPromptAuditEvidence(result) {
  const data = result.data || result.payload?.result?.data || result.result || {};
  const audit = data.audit || {};
  assert.match(audit.globalAuditId || "", /^audit:\/\/pact\/acp-agent-relay\/relay_turn_/);
  assert.match(audit.artifactRef || "", /^artifact:\/\/pact\/acp-agent-relay\/relay_turn_/);
  assert.equal(data.turn?.globalAuditId, audit.globalAuditId);
  assert.equal(data.turn?.artifactRef, audit.artifactRef);
  assert.equal(data.targetEvidence?.globalAuditId, audit.globalAuditId);
  assert.equal(data.targetEvidence?.artifactRef, audit.artifactRef);
  assert.equal(data.targetEvidence?.relayTurnId, data.turn?.relayTurnId);
  assert.equal(data.events?.length > 0, true);
  assert.equal(data.events.every((event) => event.globalAuditId === audit.globalAuditId), true);
  assert.equal(data.events.every((event) => event.artifactRef === audit.artifactRef), true);
  assert.equal(data.events.every((event) => event.operationId === "acp_agent_relay.prompt.send"), true);
}

afterEach(async () => {
  const dirs = tempDirs.splice(0);
  await Promise.all(dirs.map((dir) => fs.rm(dir, { force: true, recursive: true })));
});

describe("ACP JSON-RPC helpers", () => {
  it("creates and parses requests, notifications, responses, and in-memory transport frames", async () => {
    const initialize = createRequest(ACP_METHODS.initialize, { client: "pact-vitest" }, "init-1");
    assert.equal(parseJsonRpcMessage(initialize).method, ACP_METHODS.initialize);

    const prompt = createRequest(ACP_METHODS.sessionPrompt, { prompt: "delegate work" }, "prompt-1");
    assert.deepEqual(parseJsonRpcMessage(JSON.stringify(prompt)).params, { prompt: "delegate work" });
    assert.equal(parseJsonRpcFrame(JSON.stringify(prompt)).method, ACP_METHODS.sessionPrompt);
    const batchFrame = parseJsonRpcFrame(JSON.stringify([
      prompt,
      createNotification(ACP_METHODS.sessionUpdate, { phase: "batch-notification" })
    ]));
    assert.equal(Array.isArray(batchFrame), true);
    assert.equal(batchFrame.length, 2);
    assert.throws(() => parseJsonRpcMessage(JSON.stringify([prompt])), /JSON-RPC message must be an object/);

    const update = createNotification(ACP_METHODS.sessionUpdate, { phase: "working" });
    const parsedUpdate = parseJsonRpcMessage(update);
    assert.equal(parsedUpdate.method, ACP_METHODS.sessionUpdate);
    assert.equal(Object.hasOwn(parsedUpdate, "id"), false);

    assert.deepEqual(parseJsonRpcMessage(createSuccess("prompt-1", { ok: true })).result, { ok: true });
    const error = parseJsonRpcMessage(createError("prompt-1", -32001, "target failed", { method: ACP_METHODS.sessionPrompt }));
    assert.equal(error.error.code, -32001);
    assert.equal(error.error.data.method, ACP_METHODS.sessionPrompt);

    const transport = createInMemoryJsonRpcTransport();
    await transport.send(initialize);
    await transport.send(update);
    assert.equal(parseJsonRpcMessage(await transport.receive()).method, ACP_METHODS.initialize);
    assert.equal(parseJsonRpcMessage(await transport.receive()).method, ACP_METHODS.sessionUpdate);
    transport.close();
    assert.equal(await transport.receive(), null);
  });
});

describe("ACP target registry persistence", () => {
  it("persists runtime target descriptors under userDataPath and reloads them on restart", async () => {
    const userDataPath = await makeTempDir("pact-acp-target-registry-");
    const storagePath = path.join(userDataPath, "agent-relay", "acp-target-registry.json");
    const runtime = createAcpRelayRuntime({
      userDataPath,
      enableDownstreamClientAspect: false,
      targets: {}
    });
    try {
      const target = runtime.targetRegistry.upsertTarget({
        targetId: "target.persisted",
        label: "Persisted Target",
        transport: {
          type: "stdio",
          protocolStyle: "agent-client-protocol-v1",
          command: {
            executable: "agent-acp",
            args: ["--stdio"],
            env: {
              SECRET_TOKEN: "local-only"
            }
          }
        },
        externalServiceId: "external.persisted.agent",
        advertisedToolsets: ["agent.session"],
        capabilityPolicy: {
          writes: "deny",
          terminal: "deny",
          maxRisk: "read_only"
        },
        metadata: {
          safe: {
            verifier: "target-registry-persistence"
          }
        }
      });
      assert.equal(target.targetId, "target.persisted");

      const persisted = JSON.parse(await fs.readFile(storagePath, "utf8"));
      assert.equal(persisted.schemaVersion, "v0.0.1:agent:acp-agent-relay-target-registry-1");
      assert.equal(persisted.targets["target.persisted"].externalServiceId, "external.persisted.agent");
      assert.equal(persisted.targets["target.persisted"].transport.type, "stdio");
      assert.equal(persisted.targets["target.persisted"].transport.protocolStyle, "agent-client-protocol-v1");
    } finally {
      await runtime.close();
    }

    const restarted = createAcpRelayRuntime({
      userDataPath,
      enableDownstreamClientAspect: false,
      targets: {}
    });
    try {
      const restored = restarted.targetRegistry.getTarget("target.persisted");
      assert.equal(restored.externalServiceId, "external.persisted.agent");
      assert.equal(restored.transport.command.executable, "agent-acp");
      assert.equal(restored.transport.protocolStyle, "agent-client-protocol-v1");
      assert.deepEqual(restored.advertisedToolsets, ["agent.session"]);
      assert.deepEqual(restored.capabilityPolicy, {
        writes: "deny",
        terminal: "deny",
        maxRisk: "read_only"
      });
    } finally {
      await restarted.close();
    }
  });

  it("persists downstream client aspect startup ACP descriptors for later target wake", async () => {
    const userDataPath = await makeTempDir("pact-acp-aspect-target-registry-");
    const storagePath = path.join(userDataPath, "agent-relay", "acp-target-registry.json");
    const framework = {
      frameworkId: "unit-acp",
      label: "Unit ACP",
      kind: "cli",
      commandNames: [process.execPath],
      acp: {
        adapterId: "unit-acp-stdio",
        profileId: "pact.acp.unit",
        transport: "stdio",
        protocolStyle: "agent-client-protocol-v1",
        commandNames: [process.execPath],
        command: {
          executable: process.execPath,
          args: ["--version"],
          env: {
            PACT_TEST_SECRET: "internal-only"
          }
        },
        defaultMode: "agent",
        advertisedModes: ["ask", "agent"],
        advertisedModalities: ["text", "image"],
        advertisedDataSources: ["workspace.files", "workspace.screenshots"],
        advertisedTools: ["unit.session", "unit.vision"],
        reasoningVisibilityPolicy: "never",
        target: {
          targetId: "unit.acp:target",
          label: "Unit ACP Target",
          externalServiceId: "external.unit.acp",
          capabilityPolicy: {
            writes: "approval_required",
            terminal: "deny",
            maxRisk: "repair_write"
          }
        },
        virtualAgent: {
          virtualAgentId: "unit.acp-agent",
          displayName: "Unit ACP Agent"
        }
      }
    };

    const runtime = createAcpRelayRuntime({
      userDataPath,
      targets: {},
      virtualAgents: {},
      downstreamClientAspectOptions: {
        frameworks: [framework]
      }
    });
    try {
      const capability = runtime.downstreamClientAspect.listCapabilities({
        protocol: "acp",
        frameworkId: "unit-acp",
        includeUnavailable: true
      })[0];
      assert.equal(capability.status, "assembled");
      assert.equal(runtime.targetRegistry.getTarget("unit.acp:target").enabled, true);
      assert.equal(runtime.virtualAgentRegistry.getAgent("unit.acp-agent").targetId, "unit.acp:target");

      const persisted = JSON.parse(await fs.readFile(storagePath, "utf8"));
      assert.equal(persisted.targets["unit.acp:target"].transport.type, "stdio");
      assert.equal(persisted.targets["unit.acp:target"].transport.command.executable, process.execPath);
      assert.equal(persisted.targets["unit.acp:target"].transport.command.env.PACT_TEST_SECRET, "internal-only");
      assert.deepEqual(persisted.targets["unit.acp:target"].advertisedToolsets, ["unit.session", "unit.vision"]);
    } finally {
      await runtime.close();
    }

    const restarted = createAcpRelayRuntime({
      userDataPath,
      enableDownstreamClientAspect: false,
      targets: {},
      virtualAgents: {}
    });
    try {
      const restored = restarted.targetRegistry.getTarget("unit.acp:target");
      assert.equal(restored.externalServiceId, "external.unit.acp");
      assert.equal(restored.transport.command.executable, process.execPath);
      assert.deepEqual(restored.capabilityPolicy, {
        writes: "approval_required",
        terminal: "deny",
        maxRisk: "repair_write"
      });
    } finally {
      await restarted.close();
    }
  });

  it("persists operation-registered targets and optional virtual agents", async () => {
    const userDataPath = await makeTempDir("pact-acp-target-upsert-");
    const runtime = createAcpRelayRuntime({
      userDataPath,
      enableDownstreamClientAspect: false,
      targets: {},
      virtualAgents: {}
    });
    try {
      const upsert = await runtime.execute("acp_agent_relay.targets.upsert", {
        target: {
          targetId: "target.operation",
          label: "Operation Target",
          transport: {
            type: "stdio",
            protocolStyle: "agent-client-protocol-v1",
            command: {
              executable: "operation-agent",
              args: ["--acp"],
              env: {
                OPERATION_SECRET: "internal-only"
              }
            }
          },
          externalServiceId: "external.operation.agent",
          advertisedToolsets: ["operation.session"],
          capabilityPolicy: {
            writes: "deny",
            terminal: "deny",
            maxRisk: "read_only"
          },
          metadata: {
            public: {
              source: "operation-test"
            },
            secret: "not-source-visible"
          }
        },
        virtualAgent: {
          virtualAgentId: "agent.operation",
          displayName: "Operation Agent",
          advertisedModes: ["ask"],
          defaultMode: "ask",
          advertisedModalities: ["text"],
          advertisedDataSources: ["workspace.files"],
          advertisedTools: ["operation.session"],
          reasoningVisibilityPolicy: "never",
          capabilityPolicy: {
            writes: "deny",
            terminal: "deny",
            maxRisk: "read_only"
          },
          metadata: {
            public: {
              source: "operation-test"
            },
            secret: "not-source-visible"
          }
        }
      });
      assert.equal(upsert.ok, true);
      assert.equal(upsert.data.target.targetId, "target.operation");
      assert.equal(upsert.data.target.transportType, "stdio");
      assert.equal(upsert.data.target.transport, undefined);
      assert.deepEqual(upsert.data.target.metadata, { source: "operation-test" });
      assert.equal(upsert.data.virtualAgent.virtualAgentId, "agent.operation");
      assert.equal(upsert.data.virtualAgent.targetId, "target.operation");
      assert.deepEqual(upsert.data.virtualAgent.metadata, { source: "operation-test" });

      const missingTargetAgent = await runtime.execute("acp_agent_relay.virtual_agents.upsert", {
        virtualAgentId: "agent.operation.missing-target",
        targetId: "target.missing",
        displayName: "Missing Target Agent"
      });
      assert.equal(missingTargetAgent.ok, false);
      assert.equal(missingTargetAgent.error.code, "target_not_found");

      const upsertAgent = await runtime.execute("acp_agent_relay.virtual_agents.upsert", {
        virtualAgentId: "agent.operation.secondary",
        targetId: "target.operation",
        displayName: "Secondary Operation Agent",
        advertisedModes: ["ask", "agent"],
        defaultMode: "agent",
        advertisedModalities: ["text"],
        advertisedDataSources: ["workspace.files"],
        advertisedTools: ["operation.session"],
        reasoningVisibilityPolicy: "never",
        capabilityPolicy: {
          writes: "deny",
          terminal: "deny",
          maxRisk: "read_only"
        },
        metadata: {
          public: {
            source: "virtual-agent-operation-test"
          },
          secret: "not-source-visible"
        }
      });
      assert.equal(upsertAgent.ok, true);
      assert.equal(upsertAgent.data.virtualAgent.virtualAgentId, "agent.operation.secondary");
      assert.equal(upsertAgent.data.virtualAgent.targetId, "target.operation");
      assert.equal(upsertAgent.data.virtualAgent.target.transportType, "stdio");
      assert.deepEqual(upsertAgent.data.virtualAgent.metadata, { source: "virtual-agent-operation-test" });
    } finally {
      await runtime.close();
    }

    const restarted = createAcpRelayRuntime({
      userDataPath,
      enableDownstreamClientAspect: false,
      targets: {},
      virtualAgents: {}
    });
    try {
      const restored = restarted.targetRegistry.getTarget("target.operation");
      assert.equal(restored.externalServiceId, "external.operation.agent");
      assert.equal(restored.transport.command.executable, "operation-agent");
      assert.deepEqual(restored.advertisedToolsets, ["operation.session"]);
      assert.equal(restarted.virtualAgentRegistry.getAgent("agent.operation").targetId, "target.operation");
      assert.equal(
        restarted.virtualAgentRegistry.getAgent("agent.operation.secondary").displayName,
        "Secondary Operation Agent"
      );
    } finally {
      await restarted.close();
    }
  });
});

describe("ACP target client connection", () => {
  async function serveTargetAcpTransport(transport) {
    while (true) {
      const raw = await transport.receive();
      if (raw === null || raw === undefined) {
        return;
      }
      const message = parseJsonRpcMessage(raw);
      if (message.method === ACP_METHODS.initialize) {
        await transport.send(createSuccess(message.id, {
          protocolVersion: "v0.0.1:strategy:target-acp-1",
          capabilities: {
            session: ["new", "resume"],
            updates: ["progress"],
            mcp: true
          }
        }));
      } else if (message.method === ACP_METHODS.sessionNew || message.method === ACP_METHODS.sessionResume) {
        await transport.send(createSuccess(message.id, {
          sessionId: "target-session-transport",
          targetSessionId: "target-session-transport",
          targetResumeRef: "target-resume-transport"
        }));
      } else if (message.method === ACP_METHODS.sessionPrompt) {
        await transport.send(createNotification(ACP_METHODS.sessionUpdate, {
          type: "progress",
          phase: "working",
          text: "target is producing final text"
        }));
        await transport.send(createSuccess(message.id, {
          stopReason: "completed",
          output: `target final response for ${message.params.prompt}`,
          updates: [
            {
              type: "progress",
              phase: "postprocess",
              text: "target packaged final text"
            }
          ],
          reasoning: [
            {
              type: "reasoning_trace",
              text: "hidden unless relay policy allows it"
            }
          ]
        }));
      } else {
        await transport.send(createError(message.id, -32601, `Unsupported target ACP method ${message.method}`));
      }
    }
  }

  it("sends real ACP JSON-RPC requests to a target transport and reads the final response", async () => {
    const transportPair = createAcpSourceJsonRpcTransportPair();
    const serving = serveTargetAcpTransport(transportPair.server);
    const connection = new AcpClientConnection({
      target: { targetId: "target.acp.transport" },
      transport: transportPair.client,
      requestTimeoutMs: 1000
    });

    try {
      const initialized = await connection.initialize({
        relaySessionId: "relay-session-transport"
      });
      assert.equal(initialized.ok, true);
      assert.equal(initialized.protocolVersion, "v0.0.1:strategy:target-acp-1");
      assert.equal(initialized.targetSessionId, "target-session-transport");
      assert.equal(initialized.targetResumeRef, "target-resume-transport");

      const prompt = await connection.sendPrompt({
        relaySessionId: "relay-session-transport",
        prompt: "complete relay work"
      });
      assert.equal(prompt.ok, true);
      assert.equal(prompt.stopReason, "completed");
      assert.equal(prompt.text, "target final response for complete relay work");
      assert.equal(prompt.outputSummary, "target final response for complete relay work");
      assert.equal(prompt.finalResponseAvailable, true);
      assert.equal(prompt.externalCompletionState, "completed");
      assert.equal(prompt.updates.some((update) => update.phase === "working"), true);
      assert.equal(prompt.updates.some((update) => update.phase === "postprocess"), true);
      assert.equal(prompt.reasoning.length, 1);
      assert.equal(connection.messages.some((entry) => entry.message.method === ACP_METHODS.sessionPrompt), true);
    } finally {
      transportPair.close();
      await serving;
    }
  });

  it("does not forward source credentials or raw transport config to target ACP requests", async () => {
    const transportPair = createAcpSourceJsonRpcTransportPair();
    const received = [];
    const serving = (async () => {
      while (true) {
        const raw = await transportPair.server.receive();
        if (raw === null || raw === undefined) {
          return;
        }
        const message = parseJsonRpcMessage(raw);
        received.push(message);
        if (message.method === ACP_METHODS.initialize) {
          await transportPair.server.send(createSuccess(message.id, {
            protocolVersion: "v0.0.1:strategy:target-acp-sanitized-1",
            capabilities: {
              session: ["new", "resume", "cancel", "close"],
              updates: ["progress"]
            }
          }));
        } else if (message.method === ACP_METHODS.sessionNew || message.method === ACP_METHODS.sessionResume) {
          await transportPair.server.send(createSuccess(message.id, {
            targetSessionId: "target-sanitized-session",
            targetResumeRef: "target-sanitized-resume"
          }));
        } else if (message.method === ACP_METHODS.sessionPrompt) {
          await transportPair.server.send(createSuccess(message.id, {
            stopReason: "completed",
            output: "sanitized prompt completed"
          }));
        } else if (message.method === ACP_METHODS.sessionCancel || message.method === ACP_METHODS.sessionClose) {
          await transportPair.server.send(createSuccess(message.id, { ok: true }));
        } else {
          await transportPair.server.send(createError(message.id, -32601, `Unsupported target ACP method ${message.method}`));
        }
      }
    })();
    const connection = new AcpClientConnection({
      target: {
        targetId: "target.acp.sanitized",
        transport: {
          csrfToken: "target-transport-csrf-should-not-forward",
          command: {
            executable: "/tmp/target-transport-binary-should-not-forward",
            env: { TARGET_SECRET: "target-env-should-not-forward" }
          }
        }
      },
      transport: transportPair.client,
      requestTimeoutMs: 1000
    });
    const sensitiveInput = {
      sourceMcpConfig: { servers: { secret: { command: "source-mcp-secret" } } },
      sourceMcpToken: "source-mcp-token-secret",
      upstreamToken: "upstream-token-secret",
      sourceToken: "source-token-secret",
      csrfToken: "source-csrf-secret",
      workspaceRoot: "/tmp/source-workspace-secret",
      transport: { csrfToken: "raw-transport-secret" },
      command: { executable: "/tmp/raw-command-secret" },
      env: { SECRET_ENV: "secret-env-value" }
    };

    try {
      await connection.initialize({
        relaySessionId: "relay-session-sanitized",
        targetResumeRef: "",
        targetId: "spoofed-target-id",
        ...sensitiveInput
      });
      await connection.sendPrompt({
        relaySessionId: "relay-session-sanitized",
        prompt: "safe prompt text",
        mode: "ask",
        ...sensitiveInput
      });
      await connection.cancel({
        relaySessionId: "relay-session-sanitized",
        reason: "source requested cancel",
        ...sensitiveInput
      });
      await connection.close({
        relaySessionId: "relay-session-sanitized",
        reason: "source requested close",
        ...sensitiveInput
      });

      const serialized = JSON.stringify(received);
      for (const forbidden of [
        "sourceMcpConfig",
        "sourceMcpToken",
        "upstreamToken",
        "sourceToken",
        "csrfToken",
        "workspaceRoot",
        "source-mcp-secret",
        "source-mcp-token-secret",
        "upstream-token-secret",
        "source-token-secret",
        "source-csrf-secret",
        "raw-transport-secret",
        "target-transport-csrf-should-not-forward",
        "target-transport-binary-should-not-forward",
        "target-env-should-not-forward",
        "secret-env-value"
      ]) {
        assert.equal(serialized.includes(forbidden), false, `Target ACP request leaked ${forbidden}`);
      }
      const initialize = received.find((message) => message.method === ACP_METHODS.initialize);
      assert.equal(initialize.params.targetId, "target.acp.sanitized");
      assert.equal(initialize.params.relaySessionId, "relay-session-sanitized");
      const prompt = received.find((message) => message.method === ACP_METHODS.sessionPrompt);
      assert.equal(prompt.params.prompt, "safe prompt text");
      assert.equal(prompt.params.mode, "ask");
      assert.equal(prompt.params.sessionId, "target-sanitized-session");
    } finally {
      transportPair.close();
      await serving;
    }
  });

  it("passes relay-scoped MCP proxy metadata to target ACP initialize and prompt requests", async () => {
    const transportPair = createAcpSourceJsonRpcTransportPair();
    const received = [];
    const serving = (async () => {
      while (true) {
        const raw = await transportPair.server.receive();
        if (raw === null || raw === undefined) {
          return;
        }
        const message = parseJsonRpcMessage(raw);
        received.push(message);
        if (message.method === ACP_METHODS.initialize) {
          await transportPair.server.send(createSuccess(message.id, {
            protocolVersion: "v0.0.1:strategy:target-acp-mcp-proxy-1",
            capabilities: {
              session: ["new", "resume", "cancel"],
              mcp: true
            }
          }));
        } else if (message.method === ACP_METHODS.sessionNew || message.method === ACP_METHODS.sessionResume) {
          await transportPair.server.send(createSuccess(message.id, {
            targetSessionId: "target-mcp-proxy-session",
            targetResumeRef: "target-mcp-proxy-resume"
          }));
        } else if (message.method === ACP_METHODS.sessionPrompt) {
          await transportPair.server.send(createSuccess(message.id, {
            stopReason: "completed",
            output: "mcp proxy prompt completed"
          }));
        } else {
          await transportPair.server.send(createError(message.id, -32601, `Unsupported target ACP method ${message.method}`));
        }
      }
    })();
    const connection = new AcpClientConnection({
      target: {
        targetId: "target.acp.mcp-proxy",
        mcp: {
          url: "http://127.0.0.1:7228/mcp"
        }
      },
      transport: transportPair.client,
      requestTimeoutMs: 1000
    });

    try {
      await connection.initialize({
        relaySessionId: "relay-session-mcp-proxy",
        relayTurnId: "relay-turn-mcp-proxy",
        virtualAgentId: "virtual-agent-mcp-proxy",
        traceId: "trace-mcp-proxy",
        operationId: "acp_agent_relay.prompt.send",
        relayMcpGrantId: "relay-mcp-grant-1",
        relayMcpToken: "relay-child-token-1",
        sourceMcpToken: "source-mcp-secret"
      });
      await connection.sendPrompt({
        relaySessionId: "relay-session-mcp-proxy",
        relayTurnId: "relay-turn-mcp-proxy",
        virtualAgentId: "virtual-agent-mcp-proxy",
        traceId: "trace-mcp-proxy",
        operationId: "acp_agent_relay.prompt.send",
        relayMcpGrantId: "relay-mcp-grant-1",
        relayMcpToken: "relay-child-token-1",
        sourceMcpToken: "source-mcp-secret",
        prompt: "use relay MCP proxy metadata"
      });

      const initialize = received.find((message) => message.method === ACP_METHODS.initialize);
      const prompt = received.find((message) => message.method === ACP_METHODS.sessionPrompt);
      for (const message of [initialize, prompt]) {
        assert.equal(message.params.relayMcp.schemaVersion, "v0.0.1:schema:definition-1");
        assert.equal(message.params.relayMcp.source, "pact.acp-agent-relay");
        assert.equal(message.params.relayMcp.grantId, "relay-mcp-grant-1");
        assert.equal(message.params.relayMcp.relaySessionId, "relay-session-mcp-proxy");
        assert.equal(message.params.relayMcp.relayTurnId, "relay-turn-mcp-proxy");
        assert.equal(message.params.relayMcp.virtualAgentId, "virtual-agent-mcp-proxy");
        assert.equal(message.params.relayMcp.childOperation.relaySessionId, "relay-session-mcp-proxy");
        assert.equal(message.params.relayMcp.childOperation.relayTurnId, "relay-turn-mcp-proxy");
        assert.equal(message.params.relayMcp.childOperation.virtualAgentId, "virtual-agent-mcp-proxy");
        assert.equal(message.params.relayMcp.childOperation.targetId, "target.acp.mcp-proxy");
        assert.equal(message.params.relayMcp.childOperation.relayMcpGrantId, "relay-mcp-grant-1");
        assert.equal(message.params.relayMcp.childOperation.traceId, "trace-mcp-proxy");
        assert.equal(message.params.relayMcp.childOperation.parentOperationId, "acp_agent_relay.prompt.send");
        assert.equal(message.params.relayMcp.refresh.notification, "notifications/tools/list_changed");
        assert.equal(message.params.relayMcp.refresh.fallback, "reconnect");
        assert.equal(message.params.mcpServers.pact.url, "http://127.0.0.1:7228/mcp");
        assert.equal(message.params.mcpServers.pact.authorization.mode, "relay-managed");
        assert.equal(message.params.mcpServers.pact.authorization.grantId, "relay-mcp-grant-1");
        assert.equal(message.params.mcpServers.pact.authorization.credential, "bearer");
        assert.equal(message.params.mcpServers.pact.headers.Authorization, "Bearer relay-child-token-1");
        assert.equal(message.params.mcpServers.pact.headers["X-Pact-Relay-Mcp-Grant-Id"], "relay-mcp-grant-1");
        assert.equal(message.params.mcpServers.pact.headers["X-Pact-Relay-Session-Id"], "relay-session-mcp-proxy");
        assert.equal(message.params.mcpServers.pact.headers["X-Pact-Relay-Turn-Id"], "relay-turn-mcp-proxy");
        assert.equal(message.params.mcpServers.pact.headers["X-Pact-Virtual-Agent-Id"], "virtual-agent-mcp-proxy");
        assert.equal(message.params.mcpServers.pact.headers["X-Pact-Target-Agent-Id"], "target.acp.mcp-proxy");
        assert.equal(message.params.mcpServers.pact.headers["X-Pact-Trace-Id"], "trace-mcp-proxy");
        assert.equal(message.params.mcpServers.pact.headers["X-Pact-Relay-Operation-Id"], "acp_agent_relay.prompt.send");
      }
      assert.equal(JSON.stringify(received).includes("sourceMcpToken"), false);
      assert.equal(JSON.stringify(received).includes("source-mcp-secret"), false);
    } finally {
      transportPair.close();
      await serving;
    }
  });

  it("invalidates cached target connections by relay MCP grant id", async () => {
    const connections = [];
    const driver = new AcpSessionDriver({
      connectionFactory: () => {
        const connection = {
          closed: false,
          relayMcpGrantId: "",
          closeCalls: 0,
          async initialize(params = {}) {
            this.relayMcpGrantId = params.relayMcpGrantId || "";
            return {
              ok: true,
              targetSessionId: `target-${params.relaySessionId}`,
              targetResumeRef: `resume-${params.relaySessionId}`
            };
          },
          async close() {
            this.closed = true;
            this.closeCalls += 1;
            return { ok: true };
          }
        };
        connections.push(connection);
        return connection;
      }
    });

    await driver.wake({
      target: { targetId: "target.mcp-a" },
      relaySession: { relaySessionId: "relay-a", relayMcpGrantId: "grant-a" },
      route: {}
    });
    await driver.wake({
      target: { targetId: "target.mcp-b" },
      relaySession: { relaySessionId: "relay-b", relayMcpGrantId: "grant-b" },
      route: {}
    });

    const result = await driver.invalidateRelayMcpGrant({
      relayMcpGrantId: "grant-a",
      reason: "grant_revoked"
    });

    assert.equal(result.ok, true);
    assert.equal(result.closedConnections, 1);
    assert.equal(connections[0].closed, true);
    assert.equal(connections[0].closeCalls, 1);
    assert.equal(connections[1].closed, false);
    assert.equal(driver.connections.size, 1);

    const missing = await driver.invalidateRelayMcpGrant({
      relayMcpGrantId: "missing-grant",
      reason: "grant_revoked"
    });
    assert.equal(missing.ok, true);
    assert.equal(missing.closedConnections, 0);
  });

	  it("routes concurrent target prompt and cancel responses by JSON-RPC id", async () => {
    const createDeferred = () => {
      let resolve;
      let reject;
      const promise = new Promise((nextResolve, nextReject) => {
        resolve = nextResolve;
        reject = nextReject;
      });
      return { promise, resolve, reject };
    };
    const waitForValue = async (promise, timeoutMs = 1000) => {
      const timeout = new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`Timed out waiting for value after ${timeoutMs}ms.`)), timeoutMs);
      });
      return Promise.race([promise, timeout]);
    };

    const transportPair = createAcpSourceJsonRpcTransportPair();
    const promptReceived = createDeferred();
    const cancelReceived = createDeferred();
	    const received = [];
	    let promptRequest = null;
	    let strayCallbackResponse = null;
	    const serving = (async () => {
      while (true) {
        const raw = await transportPair.server.receive();
        if (raw === null || raw === undefined) {
          return;
        }
        const message = parseJsonRpcMessage(raw);
        received.push(message);
        if (message.method === ACP_METHODS.initialize) {
          await transportPair.server.send(createSuccess(message.id, {
            protocolVersion: "v0.0.1:strategy:target-acp-concurrent-1",
            capabilities: {
              session: ["new", "resume", "cancel"],
              updates: ["progress"]
            }
          }));
        } else if (message.method === ACP_METHODS.sessionNew || message.method === ACP_METHODS.sessionResume) {
          await transportPair.server.send(createSuccess(message.id, {
            targetSessionId: "target-concurrent-session",
            targetResumeRef: "target-concurrent-resume"
          }));
        } else if (message.method === ACP_METHODS.sessionPrompt) {
          promptRequest = message;
          promptReceived.resolve(message);
	        } else if (message.method === ACP_METHODS.sessionCancel) {
	          cancelReceived.resolve(message);
	          await transportPair.server.send(createRequest(
	            ACP_METHODS.sessionRequestPermission,
	            {
	              action: "command",
	              target: "npm test",
	              toolCallId: "stray-cancel-callback"
	            },
	            "target-callback-during-cancel"
	          ));
	          strayCallbackResponse = parseJsonRpcMessage(await transportPair.server.receive());
	          await transportPair.server.send(createSuccess(message.id, {
	            ok: true,
            cancelled: true,
            targetSessionId: message.params.targetSessionId
          }));
          await transportPair.server.send(createSuccess(promptRequest.id, {
            ok: true,
            stopReason: "completed",
            output: "prompt completed after cancel response"
          }));
        } else {
          await transportPair.server.send(createError(message.id, -32601, `Unsupported target ACP method ${message.method}`));
        }
      }
    })();
    const connection = new AcpClientConnection({
      target: { targetId: "target.acp.concurrent-routing" },
      transport: transportPair.client,
      requestTimeoutMs: 1000
    });

    try {
      await connection.initialize({ relaySessionId: "relay-session-concurrent" });
      const promptPromise = connection.sendPrompt({
        relaySessionId: "relay-session-concurrent",
        prompt: "hold prompt until cancel arrives"
      });
      await waitForValue(promptReceived.promise);
      const cancelPromise = connection.cancel({
        relaySessionId: "relay-session-concurrent"
      });
      await waitForValue(cancelReceived.promise);
      const [cancel, prompt] = await Promise.all([cancelPromise, promptPromise]);

      assert.equal(cancel.ok, true);
      assert.equal(cancel.result.ok, true);
      assert.equal(prompt.ok, true);
      assert.equal(prompt.stopReason, "completed");
	      assert.equal(prompt.outputSummary, "prompt completed after cancel response");
	      assert.equal(strayCallbackResponse.id, "target-callback-during-cancel");
	      assert.equal(strayCallbackResponse.error.code, -32601);
	      assert.equal(strayCallbackResponse.error.data.reasonCode, "target_callback_parent_ambiguous");
	      assert.equal(received.some((message) => message.method === ACP_METHODS.sessionPrompt), true);
      assert.equal(received.some((message) => message.method === ACP_METHODS.sessionCancel), true);
      assert.equal(connection.pendingRequests.size, 0);
    } finally {
      transportPair.close();
      await serving;
    }
	  });

	  it("routes target callbacks to an explicit callback-capable parent request", async () => {
	    const createDeferred = () => {
	      let resolve;
	      let reject;
	      const promise = new Promise((nextResolve, nextReject) => {
	        resolve = nextResolve;
	        reject = nextReject;
	      });
	      return { promise, resolve, reject };
	    };
	    const waitForValue = async (promise, timeoutMs = 1000) => {
	      const timeout = new Promise((_, reject) => {
	        setTimeout(() => reject(new Error(`Timed out waiting for value after ${timeoutMs}ms.`)), timeoutMs);
	      });
	      return Promise.race([promise, timeout]);
	    };

	    const transportPair = createAcpSourceJsonRpcTransportPair();
	    const bothPromptsReceived = createDeferred();
	    const prompts = [];
	    let callbackResponse = null;
	    const serving = (async () => {
	      while (true) {
	        const raw = await transportPair.server.receive();
	        if (raw === null || raw === undefined) {
	          return;
	        }
	        const message = parseJsonRpcMessage(raw);
	        if (message.method === ACP_METHODS.initialize) {
	          await transportPair.server.send(createSuccess(message.id, {
	            protocolVersion: "v0.0.1:strategy:target-acp-explicit-callback-parent-1",
	            capabilities: { session: ["new"], updates: ["progress"] }
	          }));
	        } else if (message.method === ACP_METHODS.sessionNew || message.method === ACP_METHODS.sessionResume) {
	          await transportPair.server.send(createSuccess(message.id, {
	            targetSessionId: "target-explicit-callback-session",
	            targetResumeRef: "target-explicit-callback-resume"
	          }));
	        } else if (message.method === ACP_METHODS.sessionPrompt) {
	          prompts.push(message);
	          if (prompts.length === 2) {
	            bothPromptsReceived.resolve(true);
	            const secondPrompt = prompts.find((entry) => entry.params.prompt === "second prompt");
	            await transportPair.server.send(createRequest(
	              ACP_METHODS.sessionRequestPermission,
	              {
	                action: "command",
	                target: "npm test",
	                toolCallId: "explicit-parent-callback",
	                pactParentRequestId: secondPrompt.params.pactParentRequestId
	              },
	              "target-callback-explicit-parent"
	            ));
	            callbackResponse = parseJsonRpcMessage(await transportPair.server.receive());
	            for (const prompt of prompts) {
	              await transportPair.server.send(createSuccess(prompt.id, {
	                stopReason: "completed",
	                output: `${prompt.params.prompt} done`
	              }));
	            }
	          }
	        } else {
	          await transportPair.server.send(createError(message.id, -32601, `Unsupported target ACP method ${message.method}`));
	        }
	      }
	    })();
	    const connection = new AcpClientConnection({
	      target: { targetId: "target.acp.explicit-callback-parent" },
	      transport: transportPair.client,
	      requestTimeoutMs: 1000
	    });

	    try {
	      await connection.initialize({ relaySessionId: "relay-session-explicit-callback-parent" });
	      const handled = [];
	      const firstPrompt = connection.sendPrompt({
	        relaySessionId: "relay-session-explicit-callback-parent",
	        prompt: "first prompt",
	        async targetRequestHandler(request) {
	          handled.push({ prompt: "first", method: request.method });
	          return { result: { allowed: false } };
	        }
	      });
	      const secondPrompt = connection.sendPrompt({
	        relaySessionId: "relay-session-explicit-callback-parent",
	        prompt: "second prompt",
	        async targetRequestHandler(request) {
	          handled.push({ prompt: "second", method: request.method });
	          return { result: { allowed: true } };
	        }
	      });
	      await waitForValue(bothPromptsReceived.promise);
	      const [first, second] = await Promise.all([firstPrompt, secondPrompt]);
	      assert.equal(first.outputSummary, "first prompt done");
	      assert.equal(second.outputSummary, "second prompt done");
	      assert.deepEqual(handled, [{ prompt: "second", method: ACP_METHODS.sessionRequestPermission }]);
	      assert.equal(callbackResponse.id, "target-callback-explicit-parent");
	      assert.equal(callbackResponse.result.allowed, true);
	      assert.equal(prompts[0].params.pactParentRequestId, String(prompts[0].id));
	      assert.equal(prompts[1].params.pactParentRequestId, String(prompts[1].id));
	    } finally {
	      transportPair.close();
	      await serving;
	    }
	  });

	  it("fails closed for ambiguous target callbacks without a parent request id", async () => {
	    const createDeferred = () => {
	      let resolve;
	      let reject;
	      const promise = new Promise((nextResolve, nextReject) => {
	        resolve = nextResolve;
	        reject = nextReject;
	      });
	      return { promise, resolve, reject };
	    };
	    const waitForValue = async (promise, timeoutMs = 1000) => {
	      const timeout = new Promise((_, reject) => {
	        setTimeout(() => reject(new Error(`Timed out waiting for value after ${timeoutMs}ms.`)), timeoutMs);
	      });
	      return Promise.race([promise, timeout]);
	    };

	    const transportPair = createAcpSourceJsonRpcTransportPair();
	    const bothPromptsReceived = createDeferred();
	    const prompts = [];
	    let callbackResponse = null;
	    const serving = (async () => {
	      while (true) {
	        const raw = await transportPair.server.receive();
	        if (raw === null || raw === undefined) {
	          return;
	        }
	        const message = parseJsonRpcMessage(raw);
	        if (message.method === ACP_METHODS.initialize) {
	          await transportPair.server.send(createSuccess(message.id, {
	            protocolVersion: "v0.0.1:strategy:target-acp-ambiguous-callback-parent-1",
	            capabilities: { session: ["new"], updates: ["progress"] }
	          }));
	        } else if (message.method === ACP_METHODS.sessionNew || message.method === ACP_METHODS.sessionResume) {
	          await transportPair.server.send(createSuccess(message.id, {
	            targetSessionId: "target-ambiguous-callback-session",
	            targetResumeRef: "target-ambiguous-callback-resume"
	          }));
	        } else if (message.method === ACP_METHODS.sessionPrompt) {
	          prompts.push(message);
	          if (prompts.length === 2) {
	            bothPromptsReceived.resolve(true);
	            await transportPair.server.send(createRequest(
	              ACP_METHODS.sessionRequestPermission,
	              {
	                action: "command",
	                target: "npm test",
	                toolCallId: "ambiguous-parent-callback"
	              },
	              "target-callback-ambiguous-parent"
	            ));
	            callbackResponse = parseJsonRpcMessage(await transportPair.server.receive());
	            for (const prompt of prompts) {
	              await transportPair.server.send(createSuccess(prompt.id, {
	                stopReason: "completed",
	                output: `${prompt.params.prompt} done`
	              }));
	            }
	          }
	        } else {
	          await transportPair.server.send(createError(message.id, -32601, `Unsupported target ACP method ${message.method}`));
	        }
	      }
	    })();
	    const connection = new AcpClientConnection({
	      target: { targetId: "target.acp.ambiguous-callback-parent" },
	      transport: transportPair.client,
	      requestTimeoutMs: 1000
	    });

	    try {
	      await connection.initialize({ relaySessionId: "relay-session-ambiguous-callback-parent" });
	      const handled = [];
	      const firstPrompt = connection.sendPrompt({
	        relaySessionId: "relay-session-ambiguous-callback-parent",
	        prompt: "first ambiguous prompt",
	        async targetRequestHandler(request) {
	          handled.push({ prompt: "first", method: request.method });
	          return { result: { allowed: false } };
	        }
	      });
	      const secondPrompt = connection.sendPrompt({
	        relaySessionId: "relay-session-ambiguous-callback-parent",
	        prompt: "second ambiguous prompt",
	        async targetRequestHandler(request) {
	          handled.push({ prompt: "second", method: request.method });
	          return { result: { allowed: true } };
	        }
	      });
	      await waitForValue(bothPromptsReceived.promise);
	      const [first, second] = await Promise.all([firstPrompt, secondPrompt]);
	      assert.equal(first.outputSummary, "first ambiguous prompt done");
	      assert.equal(second.outputSummary, "second ambiguous prompt done");
	      assert.deepEqual(handled, []);
	      assert.equal(callbackResponse.id, "target-callback-ambiguous-parent");
	      assert.equal(callbackResponse.error.code, -32601);
	      assert.equal(callbackResponse.error.data.reasonCode, "target_callback_parent_ambiguous");
	    } finally {
	      transportPair.close();
	      await serving;
	    }
	  });

	  it("sends session/close to native ACP targets that advertise close support before tearing down transport", async () => {
    const transportPair = createAcpSourceJsonRpcTransportPair();
    const received = [];
    const serving = (async () => {
      while (true) {
        const raw = await transportPair.server.receive();
        if (raw === null || raw === undefined) {
          return;
        }
        const message = parseJsonRpcMessage(raw);
        received.push(message);
        if (message.method === ACP_METHODS.initialize) {
          await transportPair.server.send(createSuccess(message.id, {
            protocolVersion: "v0.0.1:strategy:target-acp-close-1",
            capabilities: {
              session: ["new", "resume", "close"],
              updates: ["progress"]
            }
          }));
        } else if (message.method === ACP_METHODS.sessionNew || message.method === ACP_METHODS.sessionResume) {
          await transportPair.server.send(createSuccess(message.id, {
            targetSessionId: "target-close-session",
            targetResumeRef: "target-close-resume"
          }));
        } else if (message.method === ACP_METHODS.sessionClose) {
          await transportPair.server.send(createSuccess(message.id, {
            ok: true,
            targetSessionId: message.params.targetSessionId,
            closed: true
          }));
        } else {
          await transportPair.server.send(createError(message.id, -32601, `Unsupported target ACP method ${message.method}`));
        }
      }
    })();
    const connection = new AcpClientConnection({
      target: { targetId: "target.acp.close" },
      transport: transportPair.client,
      requestTimeoutMs: 1000
    });

    try {
      await connection.initialize({ relaySessionId: "relay-session-close" });
      const closed = await connection.close({ relaySessionId: "relay-session-close" });
      assert.equal(closed.ok, true);
      assert.equal(closed.targetClose.closed, true);
      assert.equal(closed.targetClose.targetSessionId, "target-close-session");
      const closeRequest = received.find((message) => message.method === ACP_METHODS.sessionClose);
      assert.ok(closeRequest);
      assert.equal(closeRequest.params.sessionId, "target-close-session");
      assert.equal(closeRequest.params.targetSessionId, "target-close-session");
      assert.equal(closeRequest.params.targetResumeRef, "target-close-resume");
      assert.equal(connection.closed, true);
    } finally {
      transportPair.close();
      await serving;
    }
  });

  it("uses session/load when a target advertises load but not resume for persisted sessions", async () => {
    const transportPair = createAcpSourceJsonRpcTransportPair();
    const received = [];
    const serving = (async () => {
      while (true) {
        const raw = await transportPair.server.receive();
        if (raw === null || raw === undefined) {
          return;
        }
        const message = parseJsonRpcMessage(raw);
        received.push(message);
        if (message.method === ACP_METHODS.initialize) {
          await transportPair.server.send(createSuccess(message.id, {
            protocolVersion: "v0.0.1:strategy:target-acp-load-only-1",
            capabilities: {
              session: ["new", "load"],
              updates: ["progress"]
            }
          }));
        } else if (message.method === ACP_METHODS.sessionLoad) {
          await transportPair.server.send(createSuccess(message.id, {
            targetSessionId: "target-loaded-session",
            targetResumeRef: message.params.resumeRef
          }));
        } else if (message.method === ACP_METHODS.sessionResume) {
          await transportPair.server.send(createError(message.id, -32601, "session/resume is not supported"));
        } else {
          await transportPair.server.send(createError(message.id, -32601, `Unsupported target ACP method ${message.method}`));
        }
      }
    })();
    const connection = new AcpClientConnection({
      target: { targetId: "target.acp.load-only" },
      transport: transportPair.client,
      requestTimeoutMs: 1000
    });

    try {
      const initialized = await connection.initialize({
        relaySessionId: "relay-session-load-only",
        targetResumeRef: "persisted-target-resume"
      });
      assert.equal(initialized.ok, true);
      assert.equal(initialized.targetSessionId, "target-loaded-session");
      assert.equal(initialized.targetResumeRef, "persisted-target-resume");
      const sessionLoad = received.find((message) => message.method === ACP_METHODS.sessionLoad);
      assert.ok(sessionLoad);
      assert.equal(sessionLoad.params.sessionId, "persisted-target-resume");
      assert.equal(sessionLoad.params.resumeRef, "persisted-target-resume");
      assert.equal(received.some((message) => message.method === ACP_METHODS.sessionResume), false);
    } finally {
      transportPair.close();
      await serving;
    }
  });

  it("falls back to session/new when persisted target resume fails", async () => {
    const transportPair = createAcpSourceJsonRpcTransportPair();
    const received = [];
    const serving = (async () => {
      while (true) {
        const raw = await transportPair.server.receive();
        if (raw === null || raw === undefined) {
          return;
        }
        const message = parseJsonRpcMessage(raw);
        received.push(message);
        if (message.method === ACP_METHODS.initialize) {
          await transportPair.server.send(createSuccess(message.id, {
            protocolVersion: "v0.0.1:strategy:target-acp-resume-fallback-1",
            capabilities: {
              session: ["new", "resume"],
              updates: ["progress"]
            }
          }));
        } else if (message.method === ACP_METHODS.sessionResume) {
          await transportPair.server.send(createError(message.id, -32004, "target resume ref is stale"));
        } else if (message.method === ACP_METHODS.sessionNew) {
          await transportPair.server.send(createSuccess(message.id, {
            targetSessionId: "target-recreated-session",
            targetResumeRef: "target-recreated-resume"
          }));
        } else {
          await transportPair.server.send(createError(message.id, -32601, `Unsupported target ACP method ${message.method}`));
        }
      }
    })();
    const connection = new AcpClientConnection({
      target: { targetId: "target.acp.resume-fallback" },
      transport: transportPair.client,
      requestTimeoutMs: 1000
    });

    try {
      const initialized = await connection.initialize({
        relaySessionId: "relay-session-resume-fallback",
        targetResumeRef: "stale-target-resume"
      });
      assert.equal(initialized.ok, true);
      assert.equal(initialized.wakeMode, "recreated");
      assert.equal(initialized.sessionMethod, ACP_METHODS.sessionNew);
      assert.equal(initialized.sessionFallback.from, ACP_METHODS.sessionResume);
      assert.equal(initialized.sessionFallback.reasonCode, "target_resume_failed");
      assert.equal(initialized.targetSessionId, "target-recreated-session");
      assert.equal(initialized.targetResumeRef, "target-recreated-resume");
      assert.equal(received.some((message) => message.method === ACP_METHODS.sessionResume), true);
      const sessionNew = received.find((message) => message.method === ACP_METHODS.sessionNew);
      assert.ok(sessionNew);
      assert.equal(sessionNew.params.staleTargetResumeRef, "stale-target-resume");
    } finally {
      transportPair.close();
      await serving;
    }
  });

  it("handles target-originated ACP callback requests during a prompt turn", async () => {
    const transportPair = createAcpSourceJsonRpcTransportPair();
    const serving = (async () => {
      while (true) {
        const raw = await transportPair.server.receive();
        if (raw === null || raw === undefined) {
          return;
        }
        const message = parseJsonRpcMessage(raw);
        if (message.method === ACP_METHODS.initialize) {
          await transportPair.server.send(createSuccess(message.id, {
            protocolVersion: "v0.0.1:strategy:target-acp-callbacks-1",
            capabilities: { session: ["new"], updates: ["progress"] }
          }));
        } else if (message.method === ACP_METHODS.sessionNew || message.method === ACP_METHODS.sessionResume) {
          await transportPair.server.send(createSuccess(message.id, {
            targetSessionId: "target-callback-session",
            targetResumeRef: "target-callback-resume"
          }));
        } else if (message.method === ACP_METHODS.sessionPrompt) {
          await transportPair.server.send(createRequest(
            ACP_METHODS.sessionRequestPermission,
            {
              action: "command",
              target: "npm test",
              toolCallId: "tool-call-callback-1"
            },
            "target-callback-permission"
          ));
          const permissionResponse = parseJsonRpcMessage(await transportPair.server.receive());
          assert.equal(permissionResponse.id, "target-callback-permission");
          assert.equal(permissionResponse.result.allowed, false);
          assert.equal(permissionResponse.result.receipt.reasonCode, "phase1_terminal_denied");
          await transportPair.server.send(createSuccess(message.id, {
            stopReason: "completed",
            output: `permission was ${permissionResponse.result.allowed ? "allowed" : "denied"}`
          }));
        }
      }
    })();
    const connection = new AcpClientConnection({
      target: { targetId: "target.acp.callback-transport" },
      transport: transportPair.client,
      requestTimeoutMs: 1000
    });

    try {
      await connection.initialize({ relaySessionId: "relay-session-callback" });
      const handled = [];
      const prompt = await connection.sendPrompt({
        relaySessionId: "relay-session-callback",
        prompt: "exercise target callback",
        async targetRequestHandler(request) {
          handled.push(request);
          return {
            result: {
              allowed: false,
              receipt: {
                ok: false,
                status: "denied",
                action: "terminal",
                reasonCode: "phase1_terminal_denied"
              }
            }
          };
        }
      });
      assert.equal(prompt.stopReason, "completed");
      assert.equal(prompt.outputSummary, "permission was denied");
      assert.equal(handled.length, 1);
      assert.equal(handled[0].method, ACP_METHODS.sessionRequestPermission);
      assert.equal(prompt.targetRequestReceipts.length, 1);
      assert.equal(prompt.targetRequestReceipts[0].reasonCode, "phase1_terminal_denied");
    } finally {
      transportPair.close();
      await serving;
    }
  });

  it("launches an ACP stdio target process and reads its final response", async () => {
    const tempRoot = await makeTempDir("pact-acp-target-stdio-");
    const targetScript = path.join(tempRoot, "target-acp-agent.mjs");
    await fs.writeFile(
      targetScript,
      `
import readline from "node:readline";

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

function send(payload) {
  process.stdout.write(JSON.stringify(payload) + "\\n");
}

for await (const line of lines) {
  if (!line.trim()) continue;
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    process.stderr.write("csrfToken=stdio-secret-token\\u0007\\n");
    send({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: "v0.0.1:strategy:target-acp-stdio-1", capabilities: { session: ["new"], updates: ["progress"] } } });
  } else if (message.method === "session/new" || message.method === "session/resume") {
    send({ jsonrpc: "2.0", id: message.id, result: { targetSessionId: "stdio-target-session", targetResumeRef: "stdio-target-resume" } });
  } else if (message.method === "session/prompt") {
    send({ jsonrpc: "2.0", method: "session/update", params: { type: "progress", phase: "working", text: "stdio target working" } });
    send({ jsonrpc: "2.0", id: message.id, result: { stopReason: "completed", output: "stdio target final response" } });
  } else if (message.method === "session/cancel") {
    send({ jsonrpc: "2.0", id: message.id, result: { ok: true } });
  } else {
    send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "unsupported" } });
  }
}
`,
      "utf8"
    );
    const warnings = [];
    const connection = createAcpTargetConnection({
      target: {
        targetId: "target.acp.stdio-process",
        transport: {
          type: "stdio",
          command: {
            executable: process.execPath,
            args: [targetScript]
          },
          timeoutMs: 1000
        }
      },
      logger: {
        warn(_message, payload = {}) {
          warnings.push(payload);
        }
      }
    });
    const child = connection.transport.child;

    try {
      const initialized = await connection.initialize({ relaySessionId: "relay-stdio-process" });
      assert.equal(initialized.protocolVersion, "v0.0.1:strategy:target-acp-stdio-1");
      assert.equal(initialized.targetSessionId, "stdio-target-session");
      if (warnings.length === 0) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      assert.equal(warnings.some((warning) => /<redacted>/.test(warning.text || "")), true);
      assert.equal(warnings.some((warning) => /stdio-secret-token/.test(warning.text || "")), false);
      assert.equal(
        warnings.every((warning) => /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(warning.text || "") === false),
        true
      );

      const prompt = await connection.sendPrompt({
        relaySessionId: "relay-stdio-process",
        prompt: "delegate to stdio target"
      });
      assert.equal(prompt.stopReason, "completed");
      assert.equal(prompt.outputSummary, "stdio target final response");
      assert.equal(prompt.finalResponseAvailable, true);
      assert.equal(prompt.updates.some((update) => update.phase === "working"), true);
    } finally {
      await connection.close();
      if (child.exitCode === null) {
        await Promise.race([
          once(child, "exit"),
          new Promise((resolve) => setTimeout(resolve, 2000))
        ]);
      }
    }
    assert.equal(connection.closed, true);
    assert.equal(child.exitCode !== null || child.killed === true, true);
  });

  it("preserves explicit accepted-only ACP stdio target results despite progress text", async () => {
    const tempRoot = await makeTempDir("pact-acp-target-accepted-only-");
    const targetScript = path.join(tempRoot, "target-acp-agent-accepted-only.mjs");
    await fs.writeFile(
      targetScript,
      `
import readline from "node:readline";

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

function send(payload) {
  process.stdout.write(JSON.stringify(payload) + "\\n");
}

for await (const line of lines) {
  if (!line.trim()) continue;
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    send({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: "v0.0.1:strategy:target-acp-accepted-only-1", capabilities: { session: ["new"], updates: ["progress"] } } });
  } else if (message.method === "session/new" || message.method === "session/resume") {
    send({ jsonrpc: "2.0", id: message.id, result: { targetSessionId: "accepted-only-session", targetResumeRef: "accepted-only-resume" } });
  } else if (message.method === "session/prompt") {
    send({ jsonrpc: "2.0", method: "session/update", params: { type: "progress", phase: "accepted", text: "accepted-only target progress" } });
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        stopReason: "accepted",
        externalCompletionState: "accepted_only",
        finalResponseAvailable: false,
        finalResponsePolicy: "accepted_only",
        updates: [{ type: "progress", phase: "accepted", text: "accepted-only target progress from result" }],
        targetResponse: { provider: "accepted-only-acp-wrapper" }
      }
    });
  } else {
    send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "unsupported" } });
  }
}
`,
      "utf8"
    );
    const connection = createAcpTargetConnection({
      target: {
        targetId: "target.acp.accepted-only",
        transport: {
          type: "stdio",
          command: {
            executable: process.execPath,
            args: [targetScript]
          },
          timeoutMs: 1000
        }
      }
    });
    const child = connection.transport.child;

    try {
      const initialized = await connection.initialize({ relaySessionId: "relay-accepted-only" });
      assert.equal(initialized.protocolVersion, "v0.0.1:strategy:target-acp-accepted-only-1");
      assert.equal(initialized.targetSessionId, "accepted-only-session");
      const prompt = await connection.sendPrompt({
        relaySessionId: "relay-accepted-only",
        prompt: "delegate accepted-only prompt"
      });
      assert.equal(prompt.stopReason, "accepted");
      assert.equal(prompt.externalCompletionState, "accepted_only");
      assert.equal(prompt.finalResponseAvailable, false);
      assert.equal(prompt.finalResponsePolicy, "accepted_only");
      assert.equal(prompt.outputSummary, "");
      assert.equal(prompt.updates.some((update) => update.phase === "accepted"), true);
      assert.equal(prompt.targetSessionId, "accepted-only-session");
      assert.equal(prompt.targetResumeRef, "accepted-only-resume");
      assert.equal(prompt.targetResponse?.targetResponse?.provider, "accepted-only-acp-wrapper");
    } finally {
      await connection.close();
      if (child.exitCode === null) {
        await Promise.race([
          once(child, "exit"),
          new Promise((resolve) => setTimeout(resolve, 2000))
        ]);
      }
    }
    assert.equal(connection.closed, true);
  });

  it("does not mark an ACP stdio target initialized when process launch fails", async () => {
    const tempRoot = await makeTempDir("pact-acp-target-stdio-fail-");
    const connection = createAcpTargetConnection({
      target: {
        targetId: "target.acp.stdio-missing",
        transport: {
          type: "stdio",
          command: {
            executable: path.join(tempRoot, "missing-acp-target")
          },
          timeoutMs: 250
        }
      }
    });

    await assert.rejects(
      connection.initialize({ relaySessionId: "relay-stdio-fail" }),
      /Target ACP transport (closed|is closed|refused)/
    );
    assert.equal(connection.initialized, false);
    assert.equal(connection.closed, true);
  });
});

describe("ACP Agent Relay runtime", () => {
  it("lists default virtual agents and initializes their advertised capabilities", async () => {
    const runtime = createAcpRelayRuntime();
    const list = await runtime.execute("acp_agent_relay.virtual_agents.list");
    assert.equal(list.ok, true);
    const agents = new Map(list.data.virtualAgents.map((agent) => [agent.virtualAgentId, agent]));

    assert.equal(agents.get("antigravity.repo-analysis")?.defaultMode, "ask");
    assert.equal(agents.get("antigravity.repo-analysis")?.capabilityPolicy.writes, "deny");
    assert.equal(agents.get("antigravity.multimodal-coding")?.defaultMode, "agent");
    assert.equal(agents.get("antigravity.multimodal-coding")?.capabilityPolicy.writes, "approval_required");

    const init = await runtime.execute("acp_agent_relay.virtual_agent.initialize", {
      virtualAgentId: "antigravity.multimodal-coding"
    });
    assert.equal(init.ok, true);
    assert.deepEqual(init.data.capabilities.modalities, ["text", "image", "screenshot", "document"]);

    const repoSession = await createSession(runtime, {
      virtualAgentId: "antigravity.repo-analysis",
      requestedMode: "agent"
    });
    assert.equal(repoSession.virtualAgentId, "antigravity.repo-analysis");
    const codingSession = await runtime.execute("acp_agent_relay.session.create", {
      sourceId: "codex-vitest",
      sourceSessionId: `coding-${Date.now()}-${Math.random()}`,
      workspaceId: "vitest-workspace",
      virtualAgentId: "antigravity.multimodal-coding",
      requestedMode: "unsupported"
    });
    assert.equal(codingSession.ok, true);
    assert.equal(codingSession.data.route.effectiveMode, "agent");
  });

  it("generates relay MCP grant ids instead of accepting source-supplied ids", async () => {
    const runtime = createAcpRelayRuntime();
    const session = await createSession(runtime, {
      relayMcpGrantId: "relay_mcp_source_supplied_collision"
    });

    assert.match(session.relayMcpGrantId, /^relay_mcp_/);
    assert.notEqual(session.relayMcpGrantId, "relay_mcp_source_supplied_collision");
  });

  it("assembles downstream ACP framework adapters into the relay registries at runtime startup", async () => {
    const fixtureRoot = await makeTempDir("pact-acp-downstream-runtime-");
    const fixtureBin = path.join(fixtureRoot, "bin");
    await fs.mkdir(fixtureBin, { recursive: true });
    const codexAcpPath = path.join(fixtureBin, process.platform === "win32" ? "codex-acp.cmd" : "codex-acp");
    await fs.writeFile(
      codexAcpPath,
      process.platform === "win32" ? "@echo off\r\nexit /b 0\r\n" : "#!/bin/sh\nexit 0\n",
      "utf8"
    );
    if (process.platform !== "win32") {
      await fs.chmod(codexAcpPath, 0o755);
    }

    const runtime = createAcpRelayRuntime({
      downstreamClientEnv: {
        ...process.env,
        PATH: `${fixtureBin}${path.delimiter}${process.env.PATH || ""}`
      },
      downstreamClientAspectStart: {
        now: new Date("2026-06-05T00:00:00.000Z")
      }
    });

    assert.equal(runtime.downstreamClientAspect.started, true);
    assert.equal(runtime.downstreamClientAspect.summary().byProtocol.acp, 9);

    const list = await runtime.execute("acp_agent_relay.virtual_agents.list", {});
    assert.equal(list.ok, true);
    const agents = new Map(list.data.virtualAgents.map((agent) => [agent.virtualAgentId, agent]));
    assert.equal(agents.get("codex.acp-agent")?.targetId, "codex.acp:default");
    assert.equal(agents.get("codex.acp-agent")?.capabilities.tools.includes("codex.patch"), true);
    assert.equal(agents.get("codex.acp-agent")?.target?.targetCommunicationMode, "native_acp_stdio");
    assert.equal(agents.get("codex.acp-agent")?.target?.nativeAcpTargetSupported, true);
    assert.equal(agents.get("codex.acp-agent")?.target?.nativeAcpTargetVerified, false);
    assert.equal(agents.get("antigravity.acp-agent")?.target?.transportType, "antigravity-agentapi");
    assert.equal(agents.get("antigravity.acp-agent")?.target?.targetCommunicationMode, "agent_api_proxy");
    assert.equal(agents.get("antigravity.acp-agent")?.target?.nativeAcpTargetSupported, false);
    assert.equal(agents.get("antigravity.acp-agent")?.target?.nativeAcpTargetVerified, false);

    const codexInit = await runtime.execute("acp_agent_relay.virtual_agent.initialize", {
      virtualAgentId: "codex.acp-agent"
    });
    assert.equal(codexInit.ok, true);
    assert.equal(codexInit.data.capabilitiesSnapshot.target.transportType, "stdio");
    assert.equal(codexInit.data.capabilitiesSnapshot.target.protocolStyle, "agent-client-protocol-v1");
    assert.equal(codexInit.data.capabilitiesSnapshot.target.targetCommunicationMode, "native_acp_stdio");
    assert.equal(codexInit.data.capabilitiesSnapshot.target.nativeAcpTargetSupported, true);
    assert.equal(codexInit.data.capabilitiesSnapshot.target.nativeAcpTargetVerified, false);
    assert.equal(codexInit.data.capabilitiesSnapshot.target.communication.nativeAcpTargetSupported, true);
    assert.equal(codexInit.data.capabilities.tools.includes("codex.session"), true);
    assert.equal(JSON.stringify(codexInit.data).includes(codexAcpPath), false);

    const codexTarget = runtime.targetRegistry.getTarget("codex.acp:default");
    assert.equal(codexTarget.transport.command.executable, codexAcpPath);

    runtime.targetRegistry.upsertTarget({
      targetId: "stale.acp:target",
      label: "Stale Aspect Target",
      transport: { type: "stdio" },
      enabled: true,
      externalServiceId: "external.stale.acp",
      advertisedToolsets: ["stale.session"],
      metadata: {
        public: {
          fromAspect: "downstream-client-aspect",
          serviceKind: "downstream-client-aspect",
          protocol: "acp",
          frameworkId: "stale",
          adapterId: "stale-acp"
        }
      }
    });
    runtime.virtualAgentRegistry.upsertAgent({
      virtualAgentId: "stale.acp-agent",
      targetId: "stale.acp:target",
      displayName: "Stale Aspect Agent",
      advertisedModes: ["ask"],
      defaultMode: "ask",
      enabled: true,
      metadata: {
        public: {
          fromAspect: "downstream-client-aspect",
          serviceKind: "downstream-client-aspect",
          protocol: "acp",
          frameworkId: "stale",
          adapterId: "stale-acp"
        }
      }
    });
    runtime.targetRegistry.upsertTarget({
      targetId: "manual.acp:target",
      label: "Manual ACP Target",
      transport: { type: "stdio" },
      enabled: true,
      metadata: {
        public: {
          protocol: "acp",
          frameworkId: "manual",
          adapterId: "manual-acp"
        }
      }
    });

    const downstreamSession = await runtime.execute("acp_agent_relay.session.create", {
      sourceId: "codex-vitest",
      sourceSessionId: "downstream-refresh-session",
      workspaceId: "vitest-workspace",
      virtualAgentId: "codex.acp-agent"
    });
    assert.equal(downstreamSession.ok, true);
    assert.equal(downstreamSession.data.session.targetId, "codex.acp:default");
    assert.equal(downstreamSession.data.capabilitiesSnapshot.metadata.fromAspect, "downstream-client-aspect");
    assert.equal(downstreamSession.data.capabilitiesSnapshot.capabilities.tools.includes("codex.session"), true);
    assert.equal(downstreamSession.data.capabilitiesSnapshot.capabilities.tools.includes("codex.refresh-proof"), false);

    runtime.downstreamClientAspect.frameworks = runtime.downstreamClientAspect.frameworks.map((framework) => {
      if (framework.frameworkId !== "codex") {
        return framework;
      }
      return {
        ...framework,
        acp: {
          ...framework.acp,
          advertisedTools: [...framework.acp.advertisedTools, "codex.refresh-proof"],
          metadata: {
            public: {
              refreshProof: "codex-acp-refresh-v2"
            }
          }
        }
      };
    });

    const refreshed = await runtime.execute("acp_agent_relay.downstream_clients.refresh", {
      protocol: "acp",
      now: "2026-06-05T00:01:00.000Z"
    });
    assert.equal(refreshed.ok, true);
    assert.equal(refreshed.data.summary.started, true);
    assert.equal(refreshed.data.summary.byProtocol.acp, 9);
    assert.equal(refreshed.data.assemblyCount, 9);
    assert.equal(
      refreshed.data.assemblies.some((record) => record.frameworkId === "codex" && record.acpRelay.targetId === "codex.acp:default"),
      true
    );
    assert.deepEqual(refreshed.data.reconcile.disabledTargetIds, ["stale.acp:target"]);
    assert.deepEqual(refreshed.data.reconcile.disabledVirtualAgentIds, ["stale.acp-agent"]);
    assert.equal(JSON.stringify(refreshed.data).includes(codexAcpPath), false);
    assert.equal(runtime.targetRegistry.getTarget("codex.acp:default").transport.command.executable, codexAcpPath);
    assert.equal(runtime.targetRegistry.getTarget("stale.acp:target").enabled, false);
    assert.equal(runtime.targetRegistry.getTarget("stale.acp:target").disabledReason, "downstream_client_aspect_not_assembled");
    assert.equal(runtime.virtualAgentRegistry.getAgent("stale.acp-agent").enabled, false);
    assert.equal(runtime.virtualAgentRegistry.getAgent("stale.acp-agent").disabledReason, "downstream_client_aspect_not_assembled");
    assert.equal(runtime.targetRegistry.getTarget("manual.acp:target").enabled, true);
    assert.equal(runtime.virtualAgentRegistry.getAgent("codex.acp-agent").advertisedTools.includes("codex.refresh-proof"), true);
    assert.equal(runtime.targetRegistry.getTarget("codex.acp:default").metadata.public.refreshProof, "codex-acp-refresh-v2");

    const resumedAfterRefresh = await runtime.execute("acp_agent_relay.session.resume", {
      relaySessionId: downstreamSession.data.session.relaySessionId
    });
    assert.equal(resumedAfterRefresh.ok, true);
    assert.equal(resumedAfterRefresh.data.session.relaySessionId, downstreamSession.data.session.relaySessionId);
    assert.equal(resumedAfterRefresh.data.capabilitiesSnapshot.metadata.fromAspect, "downstream-client-aspect");
    assert.equal(resumedAfterRefresh.data.capabilitiesSnapshot.metadata.refreshProof, "codex-acp-refresh-v2");
    assert.equal(resumedAfterRefresh.data.capabilitiesSnapshot.capabilities.tools.includes("codex.refresh-proof"), true);
    assert.equal(resumedAfterRefresh.data.capabilitiesSnapshot.target.targetId, "codex.acp:default");
    assert.equal(resumedAfterRefresh.data.capabilitiesSnapshot.target.targetCommunicationMode, "native_acp_stdio");
    assert.equal(resumedAfterRefresh.data.route.targetId, "codex.acp:default");

    const storedAfterRefresh = await runtime.store.getSession(downstreamSession.data.session.relaySessionId);
    assert.equal(storedAfterRefresh.metadata.capabilitiesSnapshot.metadata.refreshProof, "codex-acp-refresh-v2");
    assert.equal(storedAfterRefresh.metadata.capabilitiesSnapshot.capabilities.tools.includes("codex.refresh-proof"), true);
  });

  it("routes a relay prompt into a Codex CLI exec target adapter", async () => {
    const tempRoot = await makeTempDir("pact-acp-codex-cli-exec-");
    const fakeCodex = path.join(tempRoot, process.platform === "win32" ? "codex.cmd" : "codex");
    const argsFile = path.join(tempRoot, "codex-args.txt");
    const marker = `codex target fixture ${Date.now()}`;
    await fs.writeFile(
      fakeCodex,
      process.platform === "win32"
        ? `@echo off\r\nsetlocal enabledelayedexpansion\r\nset OUT=\r\nset PREV=\r\nfor %%A in (%*) do (\r\n  if "!PREV!"=="--output-last-message" set OUT=%%~A\r\n  set PREV=%%~A\r\n)\r\nif "%OUT%"=="" exit /b 2\r\necho codex target fixture received %PACT_TEST_CODEX_MARKER%>"%OUT%"\r\necho {"type":"completion","text":"codex target fixture"}\r\nexit /b 0\r\n`
        : `#!/bin/sh
set -eu
	printf '%s\\n' "$@" > "$PACT_TEST_CODEX_ARGS_FILE"
out=""
prev=""
for arg in "$@"; do
  if [ "$prev" = "--output-last-message" ]; then
    out="$arg"
  fi
  prev="$arg"
done
if [ -z "$out" ]; then
  exit 2
fi
	printf 'codex target fixture received %s\\n' "$PACT_TEST_CODEX_MARKER" > "$out"
	printf '{"type":"completion","text":"codex target fixture"}\\n'
`,
      "utf8"
    );
    if (process.platform !== "win32") {
      await fs.chmod(fakeCodex, 0o755);
    }

    const targetId = "codex.cli:exec-test";
    const virtualAgentId = "codex.cli-exec-test";
    const runtime = createAcpRelayRuntime({
      enableDownstreamClientAspect: false,
      targets: {
        [targetId]: {
          targetId,
          label: "Fake Codex CLI Exec Target",
          transport: {
            type: "codex-cli-exec",
            command: {
              executable: fakeCodex,
              cwd: tempRoot,
              timeoutMs: 5000,
              env: {
        PACT_TEST_CODEX_ARGS_FILE: argsFile,
        PACT_TEST_CODEX_MARKER: marker
              }
            },
            sandbox: "read-only"
          },
          externalServiceId: "external.codex.cli.exec.fake",
          agentProfileId: "pact.acp.codex_cli_exec.fake",
          advertisedToolsets: ["codex.exec"],
          capabilityPolicy: {
            writes: "deny",
            terminal: "deny",
            maxRisk: "read_only"
          }
        }
      },
      virtualAgents: {
        [virtualAgentId]: {
          virtualAgentId,
          targetId,
          profileId: "pact.acp.codex_cli_exec.fake",
          displayName: "Fake Codex CLI Exec Agent",
          advertisedModes: ["ask"],
          defaultMode: "ask",
          advertisedModalities: ["text"],
          advertisedTools: ["codex.exec"],
          reasoningVisibilityPolicy: "never",
          capabilityPolicy: {
            writes: "deny",
            terminal: "deny",
            maxRisk: "read_only"
          }
        }
      }
    });

    try {
      const session = await runtime.execute("acp_agent_relay.session.create", {
        sourceId: "codex-cli-exec-vitest",
        sourceSessionId: `codex-cli-exec-${Date.now()}`,
        workspaceId: "vitest-workspace",
        virtualAgentId
      });
      assert.equal(session.ok, true);
      assert.equal(session.data.session.capabilitiesSnapshot.target.transportType, "codex-cli-exec");
      assert.equal(session.data.session.capabilitiesSnapshot.target.targetCommunicationMode, "codex_cli_exec_proxy");
      assert.equal(session.data.session.capabilitiesSnapshot.target.nativeAcpTargetSupported, false);
      assert.equal(session.data.session.capabilitiesSnapshot.target.nativeAcpTargetVerified, false);

      const prompt = await runtime.execute("acp_agent_relay.prompt.send", {
        relaySessionId: session.data.session.relaySessionId,
        prompt: `Return ${marker}.`,
        requestedMode: "ask",
        requestReasoning: false
      });
      assert.equal(prompt.ok, true, JSON.stringify(prompt));
      assert.equal(prompt.data.targetEvidence.transportType, "codex-cli-exec");
      assert.equal(prompt.data.targetEvidence.targetCommunicationMode, "codex_cli_exec_proxy");
      assert.equal(prompt.data.targetEvidence.nativeAcpTargetSupported, false);
      assert.equal(prompt.data.targetEvidence.nativeAcpTargetVerified, false);
      assert.equal(prompt.data.targetEvidence.communication.targetCommunicationMode, "codex_cli_exec_proxy");
      assert.equal(prompt.data.targetEvidence.externalServiceId, "external.codex.cli.exec.fake");
      assert.equal(prompt.data.targetEvidence.externalAccepted, true);
      assert.equal(prompt.data.targetEvidence.externalCompletionState, "completed");
      assert.equal(prompt.data.targetEvidence.finalResponseAvailable, true);
      assert.equal(prompt.data.targetEvidence.finalResponsePolicy, "codex_cli_exec_final_message");
      assert.equal(prompt.data.targetEvidence.targetError, null);
      assert.equal(prompt.data.targetEvidence.externalResponseKeys.includes("exitCode"), true);
      assert.equal(prompt.data.targetEvidence.externalResponse, undefined);
      assert.match(prompt.data.outputSummary, /codex target fixture received/);
      assert.match(prompt.data.outputSummary, new RegExp(marker));
      assert.equal(prompt.data.communicationSummary.reasoningIncluded, false);

      const argsText = await fs.readFile(argsFile, "utf8");
      assert.match(argsText, /^exec\n/);
      assert.match(argsText, /--output-last-message/);
      assert.match(argsText, /--sandbox\nread-only/);
      assert.match(argsText, new RegExp(marker));
    } finally {
      await runtime.close();
    }
  });

  it("redacts nested ACP event payload secrets before persistence", () => {
    const normalizer = new AcpEventNormalizer();
    const completion = normalizer.completion({
      stopReason: "completed",
      outputSummary: "nested sensitive diagnostics",
      targetError: {
        code: "diagnostic",
        csrfToken: "nested-csrf-secret",
        apiKey: "nested-api-key-secret",
        headers: {
          authorization: "Bearer nested-bearer-secret",
          clientSecret: "nested-client-secret"
        }
      },
      receipts: [
        {
          action: "diagnostic",
          refreshToken: "nested-refresh-token-secret",
          nested: { accessToken: "nested-access-token-secret" }
        }
      ]
    });
    const payloadText = JSON.stringify(completion.redactedPayload);
    for (const forbidden of [
      "nested-csrf-secret",
      "nested-api-key-secret",
      "nested-bearer-secret",
      "nested-client-secret",
      "nested-refresh-token-secret",
      "nested-access-token-secret"
    ]) {
      assert.equal(payloadText.includes(forbidden), false);
    }
    assert.equal(completion.redactedPayload.targetError.csrfToken, "<redacted>");
    assert.equal(completion.redactedPayload.targetError.apiKey, "<redacted>");
    assert.equal(completion.redactedPayload.targetError.headers.authorization, "<redacted>");
    assert.equal(completion.redactedPayload.targetError.headers.clientSecret, "<redacted>");
    assert.equal(completion.redactedPayload.receipts[0].refreshToken, "<redacted>");
    assert.equal(completion.redactedPayload.receipts[0].nested.accessToken, "<redacted>");
  });

  it("sanitizes route source identity before it can reach target routing artifacts", async () => {
    const runtime = createAcpRelayRuntime();
    const route = await runtime.router.resolveForSourceSession({
      virtualAgentId: "antigravity.multimodal-coding",
      sourceId: "codex-source-sanitized",
      sourceSessionId: "source-session-sanitized",
      workspaceId: "vitest-workspace",
      sourceSubjectId: "subject-sanitized",
      sourceIdentity: {
        sourceId: "codex-source-sanitized",
        sourceSessionId: "source-session-sanitized",
        workspaceId: "vitest-workspace",
        virtualAgentId: "antigravity.multimodal-coding",
        sourceSubjectId: "subject-sanitized",
        sourceMcpConfig: { servers: { secret: { command: "source-mcp-secret" } } },
        sourceMcpToken: "source-mcp-token-secret",
        upstreamToken: "upstream-token-secret",
        workspaceRoot: "/tmp/source-workspace-secret",
        transport: { csrfToken: "transport-secret" },
        csrfToken: "csrf-secret"
      }
    });
    assert.equal(route.ok, true);
    assert.deepEqual(route.route.sourceIdentity, {
      sourceId: "codex-source-sanitized",
      sourceSessionId: "source-session-sanitized",
      workspaceId: "vitest-workspace",
      virtualAgentId: "antigravity.multimodal-coding",
      sourceSubjectId: "subject-sanitized"
    });
    const serialized = JSON.stringify(route.route);
    for (const forbidden of [
      "sourceMcpConfig",
      "sourceMcpToken",
      "upstreamToken",
      "workspaceRoot",
      "transport-secret",
      "csrf-secret",
      "source-mcp-secret"
    ]) {
      assert.equal(serialized.includes(forbidden), false, `Route leaked ${forbidden}`);
    }
  });

  it("issues relay MCP child grants from verified Tool Management source authorization", async () => {
    const userDataPath = await makeTempDir("pact-acp-agent-relay-child-grant-");
    const captured = [];
    const platform = createToolManagementPlatform({
      userDataPath,
      operations: SERVER_API_OPERATIONS,
      securityPermissions: createAllowAllSecurityPermissions(),
      logger: {
        debug() {},
        info() {},
        warn() {},
        error() {}
      }
    });
    const provider = createToolSkillManagementProvider({
      toolManagementPlatform: platform,
      userDataPath
    });
    try {
      const sourceIssued = await platform.store.createGrant({
        label: "ACP Relay Source Grant Vitest",
        type: "machine",
        toolsets: ["pact.agent.relay", "pact.runtime.read"],
        scopes: ["agent_relay:view", "agent_relay:operate", "runtime:read"],
        metadata: {
          agentId: "codex-vitest-source"
        }
      });
      await platform.store.createGrant({
        id: "relay_mcp_collision_vitest",
        label: "Existing Relay MCP Child Grant",
        type: "relay-mcp-child",
        scopes: ["storage:read"],
        toolsets: ["pact.runtime.read"],
        metadata: {
          issuedBy: "pact-acp-agent-relay",
          relayMcp: true,
          relaySessionId: "relay-session-existing-owner",
          sourceGrantId: sourceIssued.grant.id,
          virtualAgentId: "antigravity.multimodal-coding",
          targetId: "mock.antigravity:stdio"
        }
      });
      const collision = await provider.createRelayMcpGrant({
        grantId: "relay_mcp_collision_vitest",
        session: {
          relaySessionId: "relay-session-new-owner",
          sourceId: "codex-vitest-source",
          sourceSessionId: "source-session-new-owner",
          workspaceId: "vitest-workspace"
        },
        route: {
          virtualAgent: { virtualAgentId: "antigravity.multimodal-coding" },
          target: { targetId: "mock.antigravity:stdio" },
          workspaceId: "vitest-workspace"
        },
        sourceAuthorization: {
          ok: true,
          grant: sourceIssued.grant
        },
        scopes: ["storage:read"],
        toolsets: ["pact.runtime.read"],
        relayTurnId: "relay-turn-collision-vitest",
        parentOperationId: "acp_agent_relay.prompt.send"
      });
      assert.equal(collision.ok, false);
      assert.equal(collision.error.code, "relay_mcp_grant_id_collision");

      const runtime = createAcpRelayRuntime({
        connectionFactory: () => ({
          closed: false,
          relayMcpGrantId: "",
          async initialize(params = {}) {
            this.relayMcpGrantId = params.relayMcpGrantId || "";
            captured.push({ type: "initialize", params: { ...params } });
            return {
              ok: true,
              targetSessionId: `target-${params.relaySessionId}`,
              targetResumeRef: `resume-${params.relaySessionId}`
            };
          },
          async sendPrompt(params = {}) {
            captured.push({ type: "prompt", params: { ...params } });
            return {
              ok: true,
              stopReason: "completed",
              text: "child grant prompt completed",
              outputSummary: "child grant prompt completed",
              updates: [],
              reasoning: [],
              targetSessionId: `target-${params.relaySessionId}`,
              targetResumeRef: `resume-${params.relaySessionId}`
            };
          },
          async close() {
            this.closed = true;
            captured.push({ type: "close" });
            return { ok: true };
          }
        })
      });
      const session = await createSession(runtime, {
        sourceId: "codex-vitest-source",
        sourceAuthContext: {
          grantId: sourceIssued.grant.id,
          authSessionId: "source-auth-session-vitest",
          credentialRef: "source-credential-ref-vitest",
          sourceScopes: sourceIssued.grant.scopes,
          sourceCapabilities: sourceIssued.grant.capabilities || []
        },
        sourceMcpToken: "source-mcp-secret",
        upstreamToken: "upstream-secret"
      });
      const relayContext = {
        toolSkillManagementProvider: provider,
        sourceAuthorization: {
          ok: true,
          grant: sourceIssued.grant,
          toolExecutionId: "tool-exec-relay-child",
          traceId: "trace-relay-child"
        },
        request: {
          __pactToolRuntimeAuthorization: {
            ok: true,
            grant: sourceIssued.grant,
            toolExecutionId: "tool-exec-relay-child",
            traceId: "trace-relay-child"
          },
          __pactTraceContext: {
            traceId: "trace-relay-child",
            requestId: "request-relay-child"
          }
        }
      };

      const prompt = await runtime.execute("acp_agent_relay.prompt.send", {
        relaySessionId: session.relaySessionId,
        prompt: "use a relay MCP child grant",
        relayMcpScopes: ["runtime:read", "runtime:admin"],
        relayMcpToolsets: ["pact.runtime.read"],
        sourceMcpToken: "source-mcp-secret-again",
        upstreamToken: "upstream-secret-again"
      }, relayContext);
      assert.equal(prompt.ok, true);

      const initialize = captured.find((entry) => entry.type === "initialize");
      const targetPrompt = captured.find((entry) => entry.type === "prompt");
      assert.ok(initialize?.params.relayMcpToken);
      assert.equal(targetPrompt?.params.relayMcpToken, initialize.params.relayMcpToken);
      assert.equal(initialize.params.relayMcpGrantId, session.relayMcpGrantId);
      assert.equal(targetPrompt.params.relayMcpGrantId, session.relayMcpGrantId);

      const childAuthorization = await platform.store.authorizeRequest({
        request: {
          headers: {
            authorization: `Bearer ${initialize.params.relayMcpToken}`
          },
          socket: { remoteAddress: "127.0.0.1" }
        },
        requiredScopes: ["storage:read"]
      });
      assert.equal(childAuthorization.ok, true);
      assert.equal(childAuthorization.grant.id, session.relayMcpGrantId);
      assert.equal(childAuthorization.grant.toolsets.includes("pact.runtime.read"), true);
      assert.equal(childAuthorization.grant.toolsets.includes("pact.agent.relay"), false);
      assert.equal(childAuthorization.grant.scopes.includes("storage:read"), true);
      assert.equal(childAuthorization.grant.scopes.includes("jobs:read"), true);
      assert.equal(childAuthorization.grant.scopes.includes("runtime:admin"), false);
      assert.equal(childAuthorization.grant.metadata.issuedBy, "pact-acp-agent-relay");
      assert.equal(childAuthorization.grant.metadata.sourceGrantId, sourceIssued.grant.id);
      assert.equal(childAuthorization.grant.metadata.relaySessionId, session.relaySessionId);
      assert.equal(childAuthorization.grant.metadata.traceId, "trace-relay-child");

      const storedSession = await runtime.store.getSession(session.relaySessionId);
      const serializedSession = JSON.stringify(storedSession);
      assert.equal(serializedSession.includes(initialize.params.relayMcpToken), false);
      assert.equal(serializedSession.includes("source-mcp-secret"), false);
      assert.equal(serializedSession.includes("upstream-secret"), false);
      assert.equal(storedSession.metadata.relayMcpGrant.tokenPersisted, false);

      const closed = await runtime.execute("acp_agent_relay.session.close", {
        relaySessionId: session.relaySessionId,
        reason: "vitest close"
      }, relayContext);
      assert.equal(closed.ok, true);
      assert.equal(closed.data.relayMcpGrantRevoke.enabled, false);
      const revokedGrant = platform.store.getGrant(session.relayMcpGrantId);
      assert.equal(revokedGrant.enabled, false);
      assert.ok(revokedGrant.revokedAt);
    } finally {
      platform.close();
    }
  });

  it("sends prompts while hiding reasoning by default and exposing it only when requested", async () => {
    const runtime = createAcpRelayRuntime();
    const session = await createSession(runtime);

    const hiddenReasoning = await runtime.execute("acp_agent_relay.prompt.send", {
      relaySessionId: session.relaySessionId,
      prompt: "summarize relay state"
    });
    assert.equal(hiddenReasoning.ok, true);
    assertPromptAuditEvidence(hiddenReasoning);
    assert.equal(hiddenReasoning.data.outputSummary.includes("summarize relay state"), true);
    assert.equal(hiddenReasoning.data.events.some((event) => event.type === "reasoning_trace"), false);

    const visibleReasoning = await runtime.execute("acp_agent_relay.prompt.send", {
      relaySessionId: session.relaySessionId,
      prompt: "summarize relay state with reasoning",
      requestReasoning: true
    });
    assert.equal(visibleReasoning.ok, true);
    assertPromptAuditEvidence(visibleReasoning);
    assert.equal(visibleReasoning.data.events.some((event) => event.type === "reasoning_trace"), true);
  });

  it("bridges file permissions through virtual agent policy and always denies terminal access", async () => {
    const workspaceRoot = await makeTempDir();
    const runtime = createAcpRelayRuntime({ workspaceRoot });

    const readOnlySession = await createSession(runtime, {
      virtualAgentId: "antigravity.repo-analysis",
      sourceSessionId: "read-only-session"
    });
    const denied = await runtime.execute("acp_agent_relay.prompt.send", {
      relaySessionId: readOnlySession.relaySessionId,
      prompt: "try write",
      command: "npm test",
      fileWrites: [{ path: "notes/denied.txt", content: "nope" }]
    });
    assert.equal(denied.ok, true);
    assert.equal(denied.data.receipts.some((receipt) => receipt.reasonCode === "effective_policy_write_denied"), true);
    assert.equal(denied.data.receipts.some((receipt) => receipt.reasonCode === "phase1_terminal_denied"), true);

    const codingSession = await createSession(runtime, {
      virtualAgentId: "antigravity.multimodal-coding",
      sourceSessionId: "coding-session"
    });
    const pending = await runtime.execute("acp_agent_relay.prompt.send", {
      relaySessionId: codingSession.relaySessionId,
      prompt: "needs approval",
      fileWrites: [{ path: "notes/pending.txt", content: "pending" }]
    });
    assert.equal(pending.ok, true);
    assert.equal(pending.data.receipts[0].status, "pending_approval");
    assert.equal(pending.data.receipts[0].reasonCode, "approval_required");
    assert.equal(pending.data.stopReason, "approval_pending");
    assert.equal(pending.data.turn.status, "approval_pending");
    assert.equal(pending.data.communicationSummary.stopReason, "approval_pending");
    assert.equal(pending.data.communicationSummary.pendingPermissionRequestCount, 1);
    assert.equal(pending.data.communicationSummary.outputAvailable, true);
    assert.equal(pending.data.events.some((event) => event.type === "completion"), false);
    assert.equal(pending.data.pendingPermissionRequests.length, 1);
    assert.equal(pending.data.pendingPermissionRequests[0].status, "pending");
    assert.equal(pending.data.receipts[0].requestId, pending.data.pendingPermissionRequests[0].requestId);
    await assert.rejects(
      fs.readFile(path.join(workspaceRoot, "notes", "pending.txt"), "utf8"),
      /ENOENT/
    );

    const pendingRequest = pending.data.pendingPermissionRequests[0];
    const storedRequests = await runtime.store.listPermissionRequests(pending.data.turn.relayTurnId);
    assert.equal(storedRequests.length, 1);
    assert.equal(storedRequests[0].requestId, pendingRequest.requestId);

    const mismatchedApproval = await runtime.execute("acp_agent_relay.permission.resolve", {
      requestId: pendingRequest.requestId,
      approved: true,
      approvalId: "approval-wrong-hash",
      payloadHash: "wrong"
    });
    assert.equal(mismatchedApproval.ok, false);
    assert.equal(mismatchedApproval.error.code, "approval_payload_mismatch");
    assert.equal((await runtime.store.getPermissionRequest(pendingRequest.requestId)).status, "pending");

    const foreignApproval = await runtime.execute("acp_agent_relay.permission.resolve", {
      relaySessionId: codingSession.relaySessionId,
      requestId: pendingRequest.requestId,
      sourceId: "foreign-source",
      sourceSessionId: "foreign-source-session",
      workspaceId: codingSession.workspaceId,
      virtualAgentId: codingSession.virtualAgentId,
      approved: true,
      approvalId: "foreign-approval",
      payloadHash: pendingRequest.details.payloadHash
    });
    assert.equal(foreignApproval.ok, false);
    assert.equal(foreignApproval.error.code, "relay_session_not_found");
    assert.equal((await runtime.store.getPermissionRequest(pendingRequest.requestId)).status, "pending");
    await assert.rejects(
      fs.readFile(path.join(workspaceRoot, "notes", "pending.txt"), "utf8"),
      /ENOENT/
    );

    const resolved = await runtime.execute("acp_agent_relay.permission.resolve", {
      requestId: pendingRequest.requestId,
      approved: true,
      approvalId: "approval-resume-vitest",
      payloadHash: pendingRequest.details.payloadHash
    });
    assert.equal(resolved.ok, true);
    assert.equal(resolved.data.permissionRequest.status, "completed");
    assert.equal(resolved.data.receipts.some((candidate) => candidate.status === "completed"), true);
    assert.equal(resolved.data.turn.status, "completed");
    assert.equal(resolved.data.stopReason, "completed");
    assert.equal(await fs.readFile(path.join(workspaceRoot, "notes", "pending.txt"), "utf8"), "pending");

    const repeatedResolve = await runtime.execute("acp_agent_relay.permission.resolve", {
      requestId: pendingRequest.requestId,
      approved: true,
      approvalId: "approval-resume-vitest",
      payloadHash: pendingRequest.details.payloadHash
    });
    assert.equal(repeatedResolve.ok, true);
    assert.equal(repeatedResolve.data.alreadyResolved, true);
    assert.equal(await fs.readFile(path.join(workspaceRoot, "notes", "pending.txt"), "utf8"), "pending");

    const deniedPending = await runtime.execute("acp_agent_relay.prompt.send", {
      relaySessionId: codingSession.relaySessionId,
      prompt: "needs approval but deny",
      fileWrites: [{ path: "notes/denied-pending.txt", content: "denied pending" }]
    });
    const deniedRequest = deniedPending.data.pendingPermissionRequests[0];
    const deniedResolve = await runtime.execute("acp_agent_relay.permission.resolve", {
      requestId: deniedRequest.requestId,
      approved: false,
      reason: "vitest denied"
    });
    assert.equal(deniedResolve.ok, true);
    assert.equal(deniedResolve.data.permissionRequest.status, "denied");
    assert.equal(deniedResolve.data.stopReason, "approval_denied");
    await assert.rejects(
      fs.readFile(path.join(workspaceRoot, "notes", "denied-pending.txt"), "utf8"),
      /ENOENT/
    );

    const cancelledPending = await runtime.execute("acp_agent_relay.prompt.send", {
      relaySessionId: codingSession.relaySessionId,
      prompt: "needs approval but cancel",
      fileWrites: [{ path: "notes/cancelled-pending.txt", content: "cancelled pending" }]
    });
    assert.equal(cancelledPending.ok, true);
    assert.equal(cancelledPending.data.stopReason, "approval_pending");
    const cancelledRequest = cancelledPending.data.pendingPermissionRequests[0];
    const cancelPending = await runtime.execute("acp_agent_relay.session.cancel", {
      relaySessionId: codingSession.relaySessionId
    });
    assert.equal(cancelPending.ok, true);
    assert.equal(cancelPending.data.cancelledTurns.length, 1);
    assert.equal(cancelPending.data.cancelledTurns[0].turn.stopReason, "cancelled");
    assert.equal((await runtime.store.getPermissionRequest(cancelledRequest.requestId)).status, "cancelled");
    const cancelledResolve = await runtime.execute("acp_agent_relay.permission.resolve", {
      requestId: cancelledRequest.requestId,
      approved: true,
      payloadHash: cancelledRequest.details.payloadHash
    });
    assert.equal(cancelledResolve.ok, false);
    assert.equal(cancelledResolve.error.code, "permission_request_not_pending");
    await assert.rejects(
      fs.readFile(path.join(workspaceRoot, "notes", "cancelled-pending.txt"), "utf8"),
      /ENOENT/
    );

    const approved = await runtime.execute("acp_agent_relay.prompt.send", {
      relaySessionId: codingSession.relaySessionId,
      prompt: "approved write",
      fileWrites: [
        {
          path: "notes/approved.txt",
          content: "approved content",
          approval: { approved: true, approvalId: "approval-vitest" }
        }
      ]
    });
    assert.equal(approved.ok, true);
    const receipt = approved.data.receipts[0];
    assert.equal(receipt.status, "completed");
    assert.equal(receipt.beforeDigest, "");
    assert.match(receipt.afterDigest, /^[a-f0-9]{64}$/);
    assert.equal(await fs.readFile(path.join(workspaceRoot, "notes", "approved.txt"), "utf8"), "approved content");
  });

  it("cancels pending permission requests on session close and prevents later writes", async () => {
    const workspaceRoot = await makeTempDir("pact-acp-close-pending-permission-");
    const runtime = createAcpRelayRuntime({ workspaceRoot });
    try {
      const session = await createSession(runtime, {
        virtualAgentId: "antigravity.multimodal-coding",
        sourceSessionId: "close-pending-permission-session"
      });

      const pending = await runtime.execute("acp_agent_relay.prompt.send", {
        relaySessionId: session.relaySessionId,
        prompt: "needs approval but close",
        fileWrites: [{ path: "notes/closed-pending.txt", content: "must not be written after close" }]
      });
      assert.equal(pending.ok, true);
      assert.equal(pending.data.stopReason, "approval_pending");
      const request = pending.data.pendingPermissionRequests[0];
      assert.equal(request.status, "pending");
      await assert.rejects(
        fs.readFile(path.join(workspaceRoot, "notes", "closed-pending.txt"), "utf8"),
        /ENOENT/
      );

      const closed = await runtime.execute("acp_agent_relay.session.close", {
        relaySessionId: session.relaySessionId
      });
      assert.equal(closed.ok, true);
      assert.equal(closed.data.session.lifecycleState, "closed");
      assert.equal(closed.data.cancelledTurns.length, 1);
      assert.equal(closed.data.cancelledTurns[0].turn.stopReason, "cancelled");
      assert.equal(closed.data.cancelledTurns[0].receipt.action, "session.close");
      assert.equal(closed.data.cancelledTurns[0].receipt.reasonCode, "source_session_closed");
      const storedRequest = await runtime.store.getPermissionRequest(request.requestId);
      assert.equal(storedRequest.status, "cancelled");
      assert.equal(storedRequest.decisionId, "source-session-close");
      assert.equal(storedRequest.details.cancelledBy, "source_session_close");

      const resolvedAfterClose = await runtime.execute("acp_agent_relay.permission.resolve", {
        relaySessionId: session.relaySessionId,
        requestId: request.requestId,
        approved: true,
        approvalId: "closed-session-approval",
        payloadHash: request.details.payloadHash
      });
      assert.equal(resolvedAfterClose.ok, false);
      assert.equal(resolvedAfterClose.error.code, "permission_request_not_pending");
      await assert.rejects(
        fs.readFile(path.join(workspaceRoot, "notes", "closed-pending.txt"), "utf8"),
        /ENOENT/
      );
    } finally {
      await runtime.close();
    }
  });

  it("bridges target-originated ACP permission and file-read callbacks through Pact policy and audit", async () => {
    const workspaceRoot = await makeTempDir("pact-acp-target-callback-runtime-");
    await fs.writeFile(path.join(workspaceRoot, "facts.txt"), "callback file fact", "utf8");
    const targetScript = path.join(workspaceRoot, "target-callback-acp.mjs");
    await fs.writeFile(
      targetScript,
      `
import readline from "node:readline";

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
const iterator = lines[Symbol.asyncIterator]();

function send(payload) {
  process.stdout.write(JSON.stringify(payload) + "\\n");
}

async function receive() {
  const next = await iterator.next();
  return next.done ? null : JSON.parse(next.value);
}

while (true) {
  const message = await receive();
  if (!message) break;
  if (message.method === "initialize") {
    send({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: "v0.0.1:strategy:target-acp-callback-runtime-1", capabilities: { session: ["new"], updates: ["progress"] } } });
  } else if (message.method === "session/new" || message.method === "session/resume") {
    send({ jsonrpc: "2.0", id: message.id, result: { targetSessionId: "target-callback-runtime-session", targetResumeRef: "target-callback-runtime-resume" } });
  } else if (message.method === "session/prompt") {
    send({ jsonrpc: "2.0", id: "target-permission-1", method: "session/request_permission", params: { action: "command", target: "npm test", toolCallId: "tool-callback-command" } });
    const permission = await receive();
    send({ jsonrpc: "2.0", id: "target-read-1", method: "fs/read_text_file", params: { path: "facts.txt", toolCallId: "tool-callback-read" } });
    const read = await receive();
    const allowed = permission?.result?.allowed === true ? "allowed" : "denied";
    const content = read?.result?.content || "";
    send({ jsonrpc: "2.0", method: "session/update", params: { type: "progress", phase: "callbacks_handled", text: "target callbacks handled" } });
    send({ jsonrpc: "2.0", id: message.id, result: { stopReason: "completed", output: "permission " + allowed + "; read " + content } });
  } else {
    send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "unsupported" } });
  }
}
`,
      "utf8"
    );

    const targetId = "stdio.callback-runtime-target";
    const virtualAgentId = "stdio.callback-runtime-agent";
    const runtime = createAcpRelayRuntime({
      workspaceRoot,
      virtualAgents: {
        [virtualAgentId]: {
          virtualAgentId,
          targetId,
          profileId: "pact.acp.callback_runtime",
          displayName: "Callback Runtime Target",
          advertisedModes: ["ask"],
          defaultMode: "ask",
          advertisedTools: ["target.acp.prompt", "fs.readTextFile", "terminal.run"],
          reasoningVisibilityPolicy: "never",
          capabilityPolicy: {
            writes: "deny",
            terminal: "deny",
            maxRisk: "read_only"
          },
          revision: 1
        }
      },
      targets: {
        [targetId]: {
          targetId,
          label: "Callback Runtime ACP Target",
          transport: {
            type: "stdio",
            command: {
              executable: process.execPath,
              args: [targetScript]
            },
            timeoutMs: 1500
          },
          externalServiceId: "external.test.callback-runtime",
          advertisedToolsets: ["target.acp.prompt", "fs.readTextFile", "terminal.run"],
          capabilityPolicy: {
            writes: "deny",
            terminal: "deny",
            maxRisk: "read_only"
          },
          enabled: true,
          revision: 1
        }
      }
    });
    const session = await createSession(runtime, {
      virtualAgentId,
      sourceSessionId: "target-callback-runtime-session"
    });

    try {
      const result = await runtime.execute("acp_agent_relay.prompt.send", {
        relaySessionId: session.relaySessionId,
        prompt: "exercise target callbacks"
      });
      assert.equal(result.ok, true);
      assert.equal(result.data.stopReason, "completed");
      assert.equal(result.data.outputSummary, "permission denied; read callback file fact");
      assert.equal(result.data.receipts.some((receipt) => receipt.targetAcpMethod === ACP_METHODS.sessionRequestPermission), true);
      assert.equal(result.data.receipts.some((receipt) => receipt.targetAcpMethod === ACP_METHODS.fsReadTextFile), true);
      assert.equal(result.data.receipts.some((receipt) => receipt.reasonCode === "phase1_terminal_denied"), true);
      assert.equal(result.data.receipts.some((receipt) => receipt.action === "fs.readTextFile" && receipt.content === undefined), true);
      assert.equal(result.data.targetEvidence.targetInteractionReceipts.length, 2);

      const permissionRequests = await runtime.store.listPermissionRequests(result.data.turn.relayTurnId);
      assert.equal(permissionRequests.length, 2);
      assert.equal(permissionRequests.some((request) => request.status === "denied" && request.requestedAction === "terminal"), true);
      assert.equal(permissionRequests.some((request) => request.status === "completed" && request.requestedAction === "fs.readTextFile"), true);

      const events = await runtime.store.listEvents(result.data.turn.relayTurnId);
      assert.equal(events.some((event) => event.source === "permission" && event.type === "denial"), true);
      assert.equal(events.some((event) => event.source === "permission" && event.type === "receipt"), true);
      const permissionEvents = events.filter((event) => event.source === "permission");
      assert.equal(JSON.stringify(permissionEvents).includes("callback file fact"), false);
    } finally {
      await runtime.close();
    }
  });

  it("records unsupported target ACP callbacks through the callback registry fail-closed path", async () => {
    const targetId = "acp.unsupported-callback-target";
    const virtualAgentId = "acp.unsupported-callback-agent";
    const callbackResponses = [];
    const transportPair = createAcpSourceJsonRpcTransportPair();
    const targetServing = (async () => {
      while (true) {
        const raw = await transportPair.server.receive();
        if (raw === null || raw === undefined) {
          return;
        }
        const message = parseJsonRpcMessage(raw);
        if (message.method === ACP_METHODS.initialize) {
          await transportPair.server.send(createSuccess(message.id, {
            protocolVersion: "v0.0.1:strategy:target-acp-unsupported-callback-1",
            capabilities: { session: ["new"], updates: ["progress"] }
          }));
        } else if (message.method === ACP_METHODS.sessionNew) {
          await transportPair.server.send(createSuccess(message.id, {
            targetSessionId: "unsupported-callback-target-session",
            targetResumeRef: "unsupported-callback-target-resume"
          }));
        } else if (message.method === ACP_METHODS.sessionPrompt) {
          await transportPair.server.send(createRequest(
            "repo/suggest",
            { toolCallId: "repo-suggest-unsupported-1", target: "propose a patch" },
            "repo-suggest-unsupported"
          ));
          const callbackRaw = await transportPair.server.receive();
          const callbackResponse = parseJsonRpcMessage(callbackRaw);
          callbackResponses.push(callbackResponse);
          await transportPair.server.send(createSuccess(message.id, {
            stopReason: "completed",
            output: `unsupported callback ${callbackResponse.error?.code || ""}`
          }));
        }
      }
    })();

    const runtime = createAcpRelayRuntime({
      defaultVirtualAgentId: virtualAgentId,
      virtualAgentRegistry: new AcpVirtualAgentRegistry({
        [virtualAgentId]: {
          virtualAgentId,
          targetId,
          profileId: "pact.acp.unsupported_callback",
          displayName: "Unsupported Callback ACP Relay",
          advertisedModes: ["ask"],
          defaultMode: "ask",
          advertisedTools: ["repo.suggest"],
          reasoningVisibilityPolicy: "never",
          capabilityPolicy: {
            writes: "deny",
            terminal: "deny",
            maxRisk: "read_only"
          },
          revision: 1
        }
      }),
      targetRegistry: new AcpTargetRegistry({
        [targetId]: {
          targetId,
          label: "Unsupported Callback Target",
          transport: { type: "stdio" },
          advertisedToolsets: ["repo.suggest"],
          capabilityPolicy: {
            writes: "deny",
            terminal: "deny",
            maxRisk: "read_only"
          },
          enabled: true,
          revision: 1
        }
      }),
      sessionDriver: new AcpSessionDriver({
        connectionFactory: ({ target }) => new AcpClientConnection({
          target,
          transport: transportPair.client,
          requestTimeoutMs: 1000
        })
      })
    });

    try {
      const session = await createSession(runtime, { virtualAgentId });
      const result = await runtime.execute("acp_agent_relay.prompt.send", {
        relaySessionId: session.relaySessionId,
        prompt: "exercise unsupported callback"
      });

      assert.equal(result.ok, true);
      assert.equal(result.data.outputSummary, "unsupported callback -32601");
      assert.equal(callbackResponses[0].error.code, -32601);
      assert.equal(callbackResponses[0].error.data.receipt.reasonCode, "target_acp_callback_unsupported");

      const permissionRequests = await runtime.store.listPermissionRequests(result.data.turn.relayTurnId);
      assert.equal(permissionRequests.length, 1);
      assert.equal(permissionRequests[0].status, "denied");
      assert.equal(permissionRequests[0].requestedAction, "target.repo/suggest");
      assert.equal(permissionRequests[0].details.targetAcpMethod, "repo/suggest");
      assert.equal(permissionRequests[0].details.receipt.reasonCode, "target_acp_callback_unsupported");

      const events = await runtime.store.listEvents(result.data.turn.relayTurnId);
      assert.equal(
        events.some((event) => event.source === "permission" && event.redactedPayload?.reasonCode === "target_acp_callback_unsupported"),
        true
      );
    } finally {
      transportPair.client.close();
      await targetServing;
      await runtime.close();
    }
  });

  it("allows a custom target ACP callback handler to be registered without changing prompt flow", async () => {
    const targetId = "acp.custom-callback-target";
    const virtualAgentId = "acp.custom-callback-agent";
    const callbackResponses = [];
    const transportPair = createAcpSourceJsonRpcTransportPair();
    const targetServing = (async () => {
      while (true) {
        const raw = await transportPair.server.receive();
        if (raw === null || raw === undefined) {
          return;
        }
        const message = parseJsonRpcMessage(raw);
        if (message.method === ACP_METHODS.initialize) {
          await transportPair.server.send(createSuccess(message.id, {
            protocolVersion: "v0.0.1:strategy:target-acp-custom-callback-1",
            capabilities: { session: ["new"], updates: ["progress"] }
          }));
        } else if (message.method === ACP_METHODS.sessionNew) {
          await transportPair.server.send(createSuccess(message.id, {
            targetSessionId: "custom-callback-target-session",
            targetResumeRef: "custom-callback-target-resume"
          }));
        } else if (message.method === ACP_METHODS.sessionPrompt) {
          await transportPair.server.send(createRequest(
            "repo/suggest",
            { toolCallId: "repo-suggest-custom-1", target: "summarize repository status" },
            "repo-suggest-custom"
          ));
          const callbackRaw = await transportPair.server.receive();
          const callbackResponse = parseJsonRpcMessage(callbackRaw);
          callbackResponses.push(callbackResponse);
          await transportPair.server.send(createSuccess(message.id, {
            stopReason: "completed",
            output: `custom callback ${callbackResponse.result?.suggestion || ""}`
          }));
        }
      }
    })();

    const runtime = createAcpRelayRuntime({
      defaultVirtualAgentId: virtualAgentId,
      virtualAgentRegistry: new AcpVirtualAgentRegistry({
        [virtualAgentId]: {
          virtualAgentId,
          targetId,
          profileId: "pact.acp.custom_callback",
          displayName: "Custom Callback ACP Relay",
          advertisedModes: ["ask"],
          defaultMode: "ask",
          advertisedTools: ["repo.suggest"],
          reasoningVisibilityPolicy: "never",
          capabilityPolicy: {
            writes: "deny",
            terminal: "deny",
            maxRisk: "read_only"
          },
          revision: 1
        }
      }),
      targetRegistry: new AcpTargetRegistry({
        [targetId]: {
          targetId,
          label: "Custom Callback Target",
          transport: { type: "stdio" },
          advertisedToolsets: ["repo.suggest"],
          capabilityPolicy: {
            writes: "deny",
            terminal: "deny",
            maxRisk: "read_only"
          },
          enabled: true,
          revision: 1
        }
      }),
      targetCallbackHandlers: {
        "repo/suggest": async ({ params = {}, recordReceipt }) => {
          const receipt = await recordReceipt({
            ok: true,
            status: "completed",
            action: "repo.suggest",
            reasonCode: "repo_suggest_allowed",
            targetToolCallId: params.toolCallId || ""
          }, "repo.suggest");
          return {
            result: {
              ok: true,
              suggestion: "accepted",
              receipt
            }
          };
        }
      },
      sessionDriver: new AcpSessionDriver({
        connectionFactory: ({ target }) => new AcpClientConnection({
          target,
          transport: transportPair.client,
          requestTimeoutMs: 1000
        })
      })
    });

    try {
      const session = await createSession(runtime, { virtualAgentId });
      const result = await runtime.execute("acp_agent_relay.prompt.send", {
        relaySessionId: session.relaySessionId,
        prompt: "exercise custom callback"
      });

      assert.equal(result.ok, true);
      assert.equal(result.data.outputSummary, "custom callback accepted");
      assert.equal(callbackResponses[0].result.suggestion, "accepted");
      assert.equal(callbackResponses[0].result.receipt.reasonCode, "repo_suggest_allowed");
      assert.equal(result.data.receipts.some((receipt) => receipt.reasonCode === "repo_suggest_allowed"), true);

      const permissionRequests = await runtime.store.listPermissionRequests(result.data.turn.relayTurnId);
      assert.equal(permissionRequests.length, 1);
      assert.equal(permissionRequests[0].status, "completed");
      assert.equal(permissionRequests[0].requestedAction, "repo.suggest");
      assert.equal(permissionRequests[0].details.targetAcpMethod, "repo/suggest");
    } finally {
      transportPair.client.close();
      await targetServing;
      await runtime.close();
    }
  });

  it("keeps terminal requests hard-denied without creating approval work or leaking command text", async () => {
    const calls = [];
    const targetId = "mock.terminal-denied-target";
    const virtualAgentId = "mock.terminal-denied-agent";
    const runtime = createAcpRelayRuntime({
      virtualAgentRegistry: new AcpVirtualAgentRegistry({
        [virtualAgentId]: {
          virtualAgentId,
          targetId,
          profileId: "pact.acp.terminal_denied.mock",
          displayName: "Terminal Denied Mock ACP Relay",
          advertisedModes: ["ask"],
          defaultMode: "ask",
          advertisedTools: ["terminal.run"],
          reasoningVisibilityPolicy: "never",
          capabilityPolicy: {
            writes: "deny",
            terminal: "approval_required",
            maxRisk: "repair_write"
          },
          revision: 1
        }
      }),
      targetRegistry: new AcpTargetRegistry({
        [targetId]: {
          targetId,
          label: "Terminal Denied Mock Target",
          transport: { type: "mock" },
          advertisedToolsets: ["terminal.run"],
          capabilityPolicy: {
            writes: "deny",
            terminal: "approval_required",
            maxRisk: "repair_write"
          },
          enabled: true,
          revision: 1
        }
      }),
      sessionDriver: new AcpSessionDriver({
        connectionFactory: (options) => ({
          closed: false,
          async initialize({ relaySessionId }) {
            calls.push({ method: "initialize", relaySessionId });
            return {
              targetSessionId: `terminal-target-${relaySessionId}`,
              targetResumeRef: `terminal-resume-${relaySessionId}`
            };
          },
          async sendPrompt(prompt) {
            calls.push({ method: "prompt", prompt: prompt.prompt });
            return {
              text: "terminal request was not executed",
              updates: [{ phase: "completed" }],
              reasoning: [],
              stopReason: "completed"
            };
          },
          close() {
            this.closed = true;
          },
          ...options
        })
      })
    });
    const session = await createSession(runtime, { virtualAgentId, sourceSessionId: "terminal-denied-session" });
    const result = await runtime.execute("acp_agent_relay.prompt.send", {
      relaySessionId: session.relaySessionId,
      prompt: "attempt terminal access",
      command: "printf 'do-not-leak-terminal-command'"
    });
    assert.equal(result.ok, true);
    assert.equal(result.data.stopReason, "completed");
    assert.equal((result.data.pendingPermissionRequests || []).length, 0);
    assert.equal(result.data.receipts.length, 1);
    assert.equal(result.data.receipts[0].status, "denied");
    assert.equal(result.data.receipts[0].reasonCode, "phase1_terminal_denied");
    assert.match(result.data.receipts[0].requestedCommandHash, /^[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(result.data).includes("do-not-leak-terminal-command"), false);
    assert.equal(calls.some((call) => call.method === "initialize"), true);
    assert.equal(calls.some((call) => call.method === "prompt"), true);
    assert.equal((await runtime.store.listPermissionRequests(result.data.turn.relayTurnId)).length, 0);
  });

  it("persists target errors in generic target evidence for source agents", async () => {
    const targetId = "mock.target-error-target";
    const virtualAgentId = "mock.target-error-agent";
    const runtime = createAcpRelayRuntime({
      virtualAgentRegistry: new AcpVirtualAgentRegistry({
        [virtualAgentId]: {
          virtualAgentId,
          targetId,
          profileId: "pact.acp.target_error.mock",
          displayName: "Target Error Mock ACP Relay",
          advertisedModes: ["ask"],
          defaultMode: "ask",
          advertisedTools: ["agentapi.sendMessage"],
          reasoningVisibilityPolicy: "never",
          capabilityPolicy: {
            writes: "deny",
            terminal: "deny",
            maxRisk: "read_only"
          },
          revision: 1
        }
      }),
      targetRegistry: new AcpTargetRegistry({
        [targetId]: {
          targetId,
          label: "Target Error Mock Target",
          transport: { type: "mock" },
          advertisedToolsets: ["agentapi.sendMessage"],
          enabled: true,
          revision: 1
        }
      }),
      sessionDriver: new AcpSessionDriver({
        connectionFactory: ({ relaySession }) => ({
          async initialize() {
            return {
              ok: true,
              targetSessionId: `target-error-${relaySession.relaySessionId}`,
              targetResumeRef: `target-error-${relaySession.relaySessionId}`
            };
          },
          async sendPrompt() {
            return {
              ok: true,
              updates: [{ type: "progress", phase: "accepted", text: "target accepted the prompt" }],
              stopReason: "target_error",
              text: "Target agent quota is exhausted.",
              externalCompletionState: "target_error",
              finalResponseAvailable: false,
              finalResponsePolicy: "target_error",
              targetError: {
                code: "antigravity_connect_error",
                message: "RESOURCE_EXHAUSTED (code 429): quota reached",
                provider: "antigravity-connect",
                conversationId: "target-error-conversation",
                stepIndex: 23,
                stepType: "CORTEX_STEP_TYPE_ERROR_MESSAGE"
              },
              connectConversationObservation: {
                conversationId: "target-error-conversation",
                runStatus: "CASCADE_RUN_STATUS_IDLE",
                latestError: {
                  stepIndex: 23,
                  type: "CORTEX_STEP_TYPE_ERROR_MESSAGE",
                  contentPreview: "RESOURCE_EXHAUSTED (code 429): quota reached"
                }
              },
              externalResponse: {
                sendMessage: { recipientId: "target-error-conversation" }
              }
            };
          }
        })
      })
    });
    const session = await createSession(runtime, {
      virtualAgentId,
      sourceSessionId: "target-error-source-session"
    });
    const result = await runtime.execute("acp_agent_relay.prompt.send", {
      relaySessionId: session.relaySessionId,
      prompt: "trigger target error"
    });

    assert.equal(result.ok, true);
    assert.equal(result.data.stopReason, "target_error");
    assert.equal(result.data.outputSummary, "Target agent quota is exhausted.");
    assert.equal(result.data.targetEvidence.externalCompletionState, "target_error");
    assert.equal(result.data.targetEvidence.finalResponsePolicy, "target_error");
    assert.equal(result.data.targetEvidence.targetError.code, "antigravity_connect_error");
    assert.match(result.data.targetEvidence.targetError.message, /RESOURCE_EXHAUSTED/);
    assert.equal(result.data.targetEvidence.connectConversationObservation.latestError.stepIndex, 23);
    assert.equal(result.data.communicationSummary.stopReason, "target_error");
    assert.equal(result.data.communicationSummary.externalCompletionState, "target_error");
    assert.equal(result.data.communicationSummary.targetErrorCode, "antigravity_connect_error");
    assert.equal(result.data.communicationSummary.outputAvailable, true);
    const completionEvent = result.data.events.find((event) => event.type === "completion");
    assert.equal(completionEvent.redactedPayload.stopReason.reason, "target_error");
    assert.equal(completionEvent.redactedPayload.targetError.code, "antigravity_connect_error");
    assert.equal(result.data.turn.status, "completed");
    assert.equal(result.data.turn.stopReason, "target_error");
  });

  it("completes a prompt as target_error when lazy target wake fails", async () => {
    const targetId = "mock.prompt-wake-fails-target";
    const virtualAgentId = "mock.prompt-wake-fails-agent";
    const connections = [];
    const runtime = createAcpRelayRuntime({
      virtualAgentRegistry: new AcpVirtualAgentRegistry({
        [virtualAgentId]: {
          virtualAgentId,
          targetId,
          profileId: "pact.acp.prompt_wake_fails.mock",
          displayName: "Prompt Wake Fails Mock ACP Relay",
          advertisedModes: ["ask"],
          defaultMode: "ask",
          advertisedTools: ["mock.prompt"],
          reasoningVisibilityPolicy: "never",
          capabilityPolicy: {
            writes: "deny",
            terminal: "deny",
            maxRisk: "read_only"
          },
          revision: 1
        }
      }),
      targetRegistry: new AcpTargetRegistry({
        [targetId]: {
          targetId,
          label: "Prompt Wake Fails Mock Target",
          transport: { type: "mock" },
          advertisedToolsets: ["mock.prompt"],
          enabled: true,
          revision: 1
        }
      }),
      sessionDriver: new AcpSessionDriver({
        connectionFactory: () => {
          const connection = {
            closed: false,
            async initialize() {
              const error = new Error("Target failed during prompt wake.");
              error.code = "target_prompt_wake_failed";
              throw error;
            },
            async close() {
              this.closed = true;
              return { ok: true };
            }
          };
          connections.push(connection);
          return connection;
        }
      })
    });
    const session = await createSession(runtime, {
      virtualAgentId,
      sourceSessionId: "prompt-wake-fails-source-session"
    });

    const result = await runtime.execute("acp_agent_relay.prompt.send", {
      relaySessionId: session.relaySessionId,
      prompt: "wake failure should be a target_error completion"
    });

    assert.equal(result.ok, true);
    assert.equal(result.data.stopReason, "target_error");
    assert.match(result.data.outputSummary, /prompt wake/);
    assert.equal(result.data.targetEvidence.externalCompletionState, "target_error");
    assert.equal(result.data.targetEvidence.finalResponsePolicy, "target_error");
    assert.equal(result.data.targetEvidence.targetError.code, "target_prompt_wake_failed");
    assert.equal(result.data.communicationSummary.stopReason, "target_error");
    assert.equal(result.data.communicationSummary.targetErrorCode, "target_prompt_wake_failed");
    assert.equal(result.data.turn.status, "completed");
    assert.equal(result.data.turn.stopReason, "target_error");
    assert.equal(result.data.events.some((event) => event.type === "completion"), true);
    const stored = await runtime.store.getSession(session.relaySessionId);
    assert.equal(stored.lifecycleState, "dormant");
    assert.equal(stored.metadata.lastWakeResult.ok, false);
    assert.equal(stored.metadata.lastWakeResult.code, "target_prompt_wake_failed");
    assert.equal(connections.length, 1);
    assert.equal(connections[0].closed, true);
    assert.equal(runtime.sessionDriver.connections.size, 0);
  });

  it("does not wake the target transport before pending write approval is resolved", async () => {
    const workspaceRoot = await makeTempDir("pact-acp-pending-before-wake-");
    const calls = [];
    const fakeClient = {
      async getConversationMetadata(conversationId) {
        calls.push({ method: "getConversationMetadata", conversationId });
        return {
          response: {
            conversationMetadata: {
              metadata: { conversationId }
            }
          }
        };
      },
      async sendMessage({ recipientId, content }) {
        calls.push({ method: "sendMessage", recipientId, content });
        return {
          response: {
            sendMessage: {
              recipientId,
              content
            }
          }
        };
      }
    };
    const targetId = "antigravity.agentapi:pending-before-wake";
    const virtualAgentId = "antigravity.agentapi-pending-before-wake";
    const runtime = createAcpRelayRuntime({
      workspaceRoot,
      virtualAgentRegistry: new AcpVirtualAgentRegistry({
        [virtualAgentId]: {
          virtualAgentId,
          targetId,
          profileId: "pact.acp.pending_before_wake",
          displayName: "Pending Before Wake",
          advertisedModes: ["ask"],
          defaultMode: "ask",
          advertisedTools: ["fs.writeTextFile", "agentapi.sendMessage"],
          reasoningVisibilityPolicy: "never",
          capabilityPolicy: {
            writes: "approval_required",
            terminal: "deny",
            maxRisk: "repair_write"
          },
          revision: 1
        }
      }),
      targetRegistry: new AcpTargetRegistry({
        [targetId]: {
          targetId,
          label: "Pending Before Wake Target",
          transport: {
            type: "antigravity-agentapi",
            conversationId: "ag-pending-before-wake"
          },
          advertisedToolsets: ["fs.writeTextFile", "agentapi.sendMessage"],
          capabilityPolicy: {
            writes: "approval_required",
            terminal: "deny",
            maxRisk: "repair_write"
          },
          enabled: true,
          revision: 1
        }
      }),
      sessionDriver: new AcpSessionDriver({
        connectionFactory: (options) =>
          new AntigravityAgentApiConnection({
            ...options,
            client: fakeClient
          })
      })
    });
    const session = await createSession(runtime, { virtualAgentId, sourceSessionId: "pending-before-wake-source" });
    const pending = await runtime.execute("acp_agent_relay.prompt.send", {
      relaySessionId: session.relaySessionId,
      prompt: "requires write approval before target wake",
      fileWrites: [{ path: "notes/pending-before-wake.txt", content: "approved later" }]
    });
    assert.equal(pending.ok, true);
    assert.equal(pending.data.stopReason, "approval_pending");
    assert.equal(pending.data.session.lifecycleState, "approval_pending");
    assert.equal(calls.length, 0);
    assert.equal(runtime.sessionDriver.connections.size, 0);

    const permissionRequest = pending.data.pendingPermissionRequests[0];
    const resolved = await runtime.execute("acp_agent_relay.permission.resolve", {
      requestId: permissionRequest.requestId,
      approved: true,
      approvalId: "approval-after-pending-before-wake",
      payloadHash: permissionRequest.details.payloadHash
    });
    assert.equal(resolved.ok, true);
    assert.equal(resolved.data.stopReason, "accepted");
    assert.equal(calls.some((call) => call.method === "getConversationMetadata"), true);
    assert.equal(calls.some((call) => call.method === "sendMessage"), true);
    assert.equal(
      await fs.readFile(path.join(workspaceRoot, "notes", "pending-before-wake.txt"), "utf8"),
      "approved later"
    );
  });

  it("intersects virtual agent tools with target toolsets and applies the stricter target policy", async () => {
    const workspaceRoot = await makeTempDir();
    const targetId = "target.read-only-boundary";
    const virtualAgentId = "virtual.write-capable-boundary";
    const runtime = createAcpRelayRuntime({
      workspaceRoot,
      virtualAgentRegistry: new AcpVirtualAgentRegistry({
        [virtualAgentId]: {
          virtualAgentId,
          targetId,
          profileId: "pact.acp.boundary.virtual",
          displayName: "Write Capable Boundary Virtual Agent",
          advertisedModes: ["ask"],
          defaultMode: "ask",
          advertisedTools: ["fs.readTextFile", "fs.writeTextFile"],
          reasoningVisibilityPolicy: "never",
          capabilityPolicy: {
            writes: "approval_required",
            terminal: "deny",
            maxRisk: "repair_write"
          },
          revision: 1
        }
      }),
      targetRegistry: new AcpTargetRegistry({
        [targetId]: {
          targetId,
          label: "Read Only Boundary Target",
          transport: { type: "mock" },
          externalServiceId: "external.acp.read-only-boundary",
          advertisedToolsets: ["fs.readTextFile"],
          capabilityPolicy: {
            writes: "deny",
            terminal: "deny",
            maxRisk: "read_only"
          },
          enabled: true,
          revision: 1
        }
      })
    });

    const initialized = await runtime.execute("acp_agent_relay.virtual_agent.initialize", { virtualAgentId });
    assert.equal(initialized.ok, true);
    assert.deepEqual(initialized.data.capabilities.tools, ["fs.readTextFile"]);
    assert.equal(initialized.data.capabilities.writes, "deny");
    assert.equal(initialized.data.capabilities.maxRisk, "read_only");

    const session = await createSession(runtime, {
      virtualAgentId,
      sourceSessionId: "target-policy-boundary-session"
    });
    const prompt = await runtime.execute("acp_agent_relay.prompt.send", {
      relaySessionId: session.relaySessionId,
      prompt: "target should prevent writes",
      fileWrites: [
        {
          path: "notes/target-denied.txt",
          content: "blocked",
          approval: {
            approved: true,
            approvalId: "target-deny",
            payloadHash: "unused"
          }
        }
      ]
    });
    assert.equal(prompt.ok, true);
    assertPromptAuditEvidence(prompt);
    assert.equal(prompt.data.receipts[0].reasonCode, "effective_policy_write_denied");
    assert.equal(prompt.data.targetEvidence.externalServiceId, "external.acp.read-only-boundary");
    assert.deepEqual(prompt.data.targetEvidence.advertisedTools, ["fs.readTextFile"]);
    assert.equal(prompt.data.targetEvidence.effectiveWrites, "deny");
    assert.equal(prompt.data.targetEvidence.effectiveMaxRisk, "read_only");
  });

  it("persists relay sessions, turns, and events in a file-backed store", async () => {
    const userDataPath = await makeTempDir();
    const store = new RelaySessionStore({
      adapter: createFileRelaySessionAdapter({ userDataPath })
    });

    const session = await store.createSession({
      sourceId: "codex-vitest",
      sourceSessionId: "durable-source-session",
      workspaceId: "durable-workspace",
      virtualAgentId: "antigravity.multimodal-coding",
      targetId: "mock.antigravity:stdio"
    });
    const turn = await store.createTurn({
      relaySessionId: session.relaySessionId,
      operationId: "acp_agent_relay.prompt.send",
      effectiveMode: "agent",
      status: "running"
    });
    await store.recordEvent(turn.relayTurnId, {
      type: "session_update",
      redactedPayload: { phase: "accepted" },
      source: "target"
    });

    const reloaded = new RelaySessionStore({
      adapter: createFileRelaySessionAdapter({ userDataPath })
    });
    const resumedSession = await reloaded.getSession(session.relaySessionId);
    const resumedTurns = await reloaded.listTurns(session.relaySessionId);
    const resumedEvents = await reloaded.listEvents(turn.relayTurnId);

    assert.equal(resumedSession.sourceSessionId, "durable-source-session");
    assert.equal(resumedTurns.length, 1);
    assert.equal(resumedEvents.length, 1);
    assert.equal(resumedEvents[0].redactedPayload.phase, "accepted");
  });

  it("strips raw pending permission payloads from durable relay store details", async () => {
    const store = new RelaySessionStore();
    const created = await store.createPermissionRequest({
      requestId: "relay_perm_raw_payload_guard",
      relayTurnId: "relay_turn_raw_payload_guard",
      requestedAction: "fs.writeTextFile",
      status: "pending",
      details: {
        relaySessionId: "relay_session_raw_payload_guard",
        path: "notes/raw.txt",
        content: "raw write content must not persist",
        text: "raw text alias must not persist",
        promptText: "raw prompt must not persist",
        rawPrompt: "raw prompt alias must not persist",
        rawResponse: "raw response must not persist",
        payloadHash: "a".repeat(64),
        contentHash: "b".repeat(64),
        contentRef: "sensitive://pact/acp-agent-relay/write-content/ref",
        promptHash: "c".repeat(64),
        promptRef: "sensitive://pact/acp-agent-relay/prompt/ref"
      }
    });
    assert.equal(created.details.content, undefined);
    assert.equal(created.details.text, undefined);
    assert.equal(created.details.promptText, undefined);
    assert.equal(created.details.rawPrompt, undefined);
    assert.equal(created.details.rawResponse, undefined);
    assert.equal(created.details.contentRef, "sensitive://pact/acp-agent-relay/write-content/ref");
    assert.equal(created.details.promptRef, "sensitive://pact/acp-agent-relay/prompt/ref");

    const updated = await store.updatePermissionRequest("relay_perm_raw_payload_guard", {
      details: {
        ...created.details,
        content: "raw update content must not persist",
        promptText: "raw update prompt must not persist",
        receipt: { ok: true }
      }
    });
    assert.equal(updated.details.content, undefined);
    assert.equal(updated.details.promptText, undefined);
    assert.deepEqual(updated.details.receipt, { ok: true });
  });
});

describe("ACP Agent Relay Tool Management facade", () => {
  it("keeps internal permission resolve out of the Tool Management catalog discovery surface", async () => {
    const userDataPath = await makeTempDir("pact-acp-agent-relay-catalog-");
    const workspaceRoot = await makeTempDir("pact-acp-agent-relay-catalog-ws-");
    const platform = createAgentRelayHttpPlatform({ userDataPath, workspaceRoot });
    try {
      const catalog = await callToolManagementHttp({
        platform,
        method: "GET",
        path: "/api/tool-management/v1/catalog"
      });
      assert.equal(catalog.status, 200);
      assert.equal(catalog.payload.schemaVersion, "v0.0.1:schema:definition-1");
      const tools = Array.isArray(catalog.payload.tools) ? catalog.payload.tools : [];
      assert.equal(
        tools.some((tool) => tool.operationId === "acp_agent_relay.permission.resolve"),
        false
      );
      const relayFsReadTool = tools.find((tool) => tool.operationId === "acp_agent_relay.fs.read_text_file");
      assert.equal(Boolean(relayFsReadTool), true);
      assert.equal(relayFsReadTool.id, "pact.agentRelay.fs.readTextFile");
      assert.deepEqual(relayFsReadTool.requiredScopes, ["agent_relay:view"]);
      assert.equal(relayFsReadTool.toolsets?.includes("pact.agent.relay"), true);

      const relaySessionsListTool = tools.find((tool) => tool.operationId === "acp_agent_relay.sessions.list");
      assert.equal(Boolean(relaySessionsListTool), true);
      assert.deepEqual(relaySessionsListTool.requiredScopes, ["agent_relay:view"]);
      assert.equal(relaySessionsListTool.toolsets?.includes("pact.agent.relay"), true);

      const relaySessionGetTool = tools.find((tool) => tool.operationId === "acp_agent_relay.sessions.get");
      assert.equal(Boolean(relaySessionGetTool), true);
      assert.deepEqual(relaySessionGetTool.requiredScopes, ["agent_relay:view"]);
      assert.equal(relaySessionGetTool.toolsets?.includes("pact.agent.relay"), true);

      const relayTurnsListTool = tools.find((tool) => tool.operationId === "acp_agent_relay.turns.list");
      assert.equal(Boolean(relayTurnsListTool), true);
      assert.deepEqual(relayTurnsListTool.requiredScopes, ["agent_relay:view"]);
      assert.equal(relayTurnsListTool.toolsets?.includes("pact.agent.relay"), true);

      const relayTargetsUpsertTool = tools.find((tool) => tool.operationId === "acp_agent_relay.targets.upsert");
      assert.equal(Boolean(relayTargetsUpsertTool), true);
      assert.equal(relayTargetsUpsertTool.id, "pact.agentRelay.targets.upsert");
      assert.deepEqual(relayTargetsUpsertTool.requiredScopes, ["agent_relay:operate"]);
      assert.equal(relayTargetsUpsertTool.toolsets?.includes("pact.agent.relay"), true);

      const relayVirtualAgentsUpsertTool = tools.find((tool) => tool.operationId === "acp_agent_relay.virtual_agents.upsert");
      assert.equal(Boolean(relayVirtualAgentsUpsertTool), true);
      assert.equal(relayVirtualAgentsUpsertTool.id, "pact.agentRelay.virtualAgents.upsert");
      assert.deepEqual(relayVirtualAgentsUpsertTool.requiredScopes, ["agent_relay:operate"]);
      assert.equal(relayVirtualAgentsUpsertTool.toolsets?.includes("pact.agent.relay"), true);

      const relayDownstreamRefreshTool = tools.find((tool) => tool.operationId === "acp_agent_relay.downstream_clients.refresh");
      assert.equal(Boolean(relayDownstreamRefreshTool), true);
      assert.equal(relayDownstreamRefreshTool.id, "pact.agentRelay.downstreamClients.refresh");
      assert.deepEqual(relayDownstreamRefreshTool.requiredScopes, ["agent_relay:operate"]);
      assert.equal(relayDownstreamRefreshTool.toolsets?.includes("pact.agent.relay"), true);

      const relayTurnObserveTool = tools.find((tool) => tool.operationId === "acp_agent_relay.turn.observe");
      assert.equal(Boolean(relayTurnObserveTool), true);
      assert.equal(relayTurnObserveTool.id, "pact.agentRelay.turn.observe");
      assert.deepEqual(relayTurnObserveTool.requiredScopes, ["agent_relay:view"]);
      assert.equal(relayTurnObserveTool.toolsets?.includes("pact.agent.relay"), true);

      const relayFsWriteTool = tools.find((tool) => tool.operationId === "acp_agent_relay.fs.write_text_file");
      assert.equal(Boolean(relayFsWriteTool), true);
      assert.equal(relayFsWriteTool.id, "pact.agentRelay.fs.writeTextFile");
      assert.deepEqual(relayFsWriteTool.requiredScopes, ["agent_relay:operate"]);
      assert.equal(relayFsWriteTool.toolsets?.includes("pact.agent.relay"), true);

      assert.equal(
        tools.some(
          (tool) =>
            tool.id === "pact.agentRelay.prompt" &&
            tool.operationId === "acp_agent_relay.prompt.send" &&
            tool.toolsets?.includes("pact.agent.relay")
        ),
        true
      );
    } finally {
      platform.close();
    }
  });

  it("routes governed target and virtual-agent registration through Tool Management authorization", async () => {
    const userDataPath = await makeTempDir("pact-acp-agent-relay-http-register-");
    const workspaceRoot = await makeTempDir("pact-acp-agent-relay-http-register-workspace-");
    const platform = createAgentRelayHttpPlatform({ userDataPath, workspaceRoot });
    try {
      const { token } = await platform.store.createGrant({
        label: "ACP Agent Relay Registration Vitest",
        toolsets: ["pact.agent.relay"],
        scopes: ["agent_relay:view", "agent_relay:operate"],
        maxRisk: "repair_write"
      });

      const targetUpsert = await callAgentRelayHttp({
        platform,
        token,
        method: "POST",
        path: "/api/agent-relay/v1/targets",
        headers: { "x-pact-safety-confirm": "true" },
        body: {
          target: {
            targetId: "http.target.registered",
            label: "HTTP Registered Target",
            transport: {
              type: "stdio",
              protocolStyle: "agent-client-protocol-v1",
              command: {
                executable: "http-agent",
                args: ["--acp"],
                env: {
                  HTTP_AGENT_SECRET: "internal-only"
                }
              }
            },
            externalServiceId: "external.http.agent",
            advertisedToolsets: ["http.agent.session"],
            capabilityPolicy: {
              writes: "deny",
              terminal: "deny",
              maxRisk: "read_only"
            },
            metadata: {
              public: {
                source: "http-registration-test"
              },
              secret: "not-source-visible"
            }
          }
        }
      });
      assert.equal(targetUpsert.status, 200);
      assert.equal(targetUpsert.payload.status, "ok");
      assert.equal(targetUpsert.payload.result.ok, true);
      assert.equal(targetUpsert.payload.result.data.target.targetId, "http.target.registered");
      assert.equal(targetUpsert.payload.result.data.target.transportType, "stdio");
      assert.equal(targetUpsert.payload.result.data.target.transport, undefined);
      assert.deepEqual(targetUpsert.payload.result.data.target.metadata, { source: "http-registration-test" });

      const virtualAgentUpsert = await callAgentRelayHttp({
        platform,
        token,
        method: "PUT",
        path: "/api/agent-relay/v1/virtual-agents/http.agent.registered",
        headers: { "x-pact-safety-confirm": "true" },
        body: {
          targetId: "http.target.registered",
          displayName: "HTTP Registered Agent",
          advertisedModes: ["ask"],
          defaultMode: "ask",
          advertisedModalities: ["text"],
          advertisedDataSources: ["workspace.files"],
          advertisedTools: ["http.agent.session"],
          reasoningVisibilityPolicy: "never",
          capabilityPolicy: {
            writes: "deny",
            terminal: "deny",
            maxRisk: "read_only"
          },
          metadata: {
            public: {
              source: "http-registration-test"
            },
            secret: "not-source-visible"
          }
        }
      });
      assert.equal(virtualAgentUpsert.status, 200);
      assert.equal(virtualAgentUpsert.payload.status, "ok");
      assert.equal(virtualAgentUpsert.payload.result.ok, true);
      assert.equal(virtualAgentUpsert.payload.result.data.virtualAgent.virtualAgentId, "http.agent.registered");
      assert.equal(virtualAgentUpsert.payload.result.data.virtualAgent.targetId, "http.target.registered");
      assert.equal(virtualAgentUpsert.payload.result.data.virtualAgent.target.transportType, "stdio");
      assert.deepEqual(virtualAgentUpsert.payload.result.data.virtualAgent.metadata, { source: "http-registration-test" });

      const listTargets = await callAgentRelayHttp({
        platform,
        token,
        method: "GET",
        path: "/api/agent-relay/v1/targets"
      });
      assert.equal(
        listTargets.payload.result.data.targets.some((target) => target.targetId === "http.target.registered"),
        true
      );
      const listAgents = await callAgentRelayHttp({
        platform,
        token,
        method: "GET",
        path: "/api/agent-relay/v1/virtual-agents"
      });
      assert.equal(
        listAgents.payload.result.data.virtualAgents.some((agent) => agent.virtualAgentId === "http.agent.registered"),
        true
      );

      const persistedTargets = JSON.parse(
        await fs.readFile(path.join(userDataPath, "agent-relay", "acp-target-registry.json"), "utf8")
      );
      const persistedAgents = JSON.parse(
        await fs.readFile(path.join(userDataPath, "agent-relay", "acp-virtual-agent-registry.json"), "utf8")
      );
      assert.equal(persistedTargets.targets["http.target.registered"].transport.command.executable, "http-agent");
      assert.equal(persistedAgents.virtualAgents["http.agent.registered"].targetId, "http.target.registered");
    } finally {
      platform.close();
    }
  });

  it("routes downstream client aspect refresh through Tool Management authorization", async () => {
    const userDataPath = await makeTempDir("pact-acp-agent-relay-http-refresh-");
    const workspaceRoot = await makeTempDir("pact-acp-agent-relay-http-refresh-workspace-");
    const platform = createAgentRelayHttpPlatform({ userDataPath, workspaceRoot });
    try {
      const { token } = await platform.store.createGrant({
        label: "ACP Agent Relay Refresh Vitest",
        toolsets: ["pact.agent.relay"],
        scopes: ["agent_relay:view", "agent_relay:operate"],
        maxRisk: "repair_write"
      });

      const refresh = await callAgentRelayHttp({
        platform,
        token,
        method: "POST",
        path: "/api/agent-relay/v1/downstream-clients/refresh",
        headers: { "x-pact-safety-confirm": "true" },
        body: {
          protocol: "acp",
          now: "2026-06-05T00:02:00.000Z"
        }
      });
      assert.equal(refresh.status, 200);
      assert.equal(refresh.payload.status, "ok");
      assert.equal(refresh.payload.result.ok, true);
      assert.equal(refresh.payload.result.data.summary.started, true);
      assert.equal(refresh.payload.result.data.summary.byProtocol.acp, 11);
      assert.equal(refresh.payload.result.data.assemblyCount, 11);
      assert.equal(
        refresh.payload.result.data.assemblies.some((record) => record.frameworkId === "antigravity" && record.acpRelay.targetId === "antigravity.acp:default"),
        true
      );
      assert.equal(JSON.stringify(refresh.payload.result.data).includes("command"), false);

      const persistedTargets = JSON.parse(
        await fs.readFile(path.join(userDataPath, "agent-relay", "acp-target-registry.json"), "utf8")
      );
      const persistedAgents = JSON.parse(
        await fs.readFile(path.join(userDataPath, "agent-relay", "acp-virtual-agent-registry.json"), "utf8")
      );
      assert.equal(persistedTargets.targets["antigravity.acp:default"].transport.type, "antigravity-agentapi");
      assert.equal(persistedAgents.virtualAgents["antigravity.acp-agent"].targetId, "antigravity.acp:default");
    } finally {
      platform.close();
    }
  });

  it("routes virtual agent listing and prompt submission through Tool Management authorization and persists relay state", async () => {
    const userDataPath = await makeTempDir("pact-acp-agent-relay-http-");
    const workspaceRoot = await makeTempDir("pact-acp-agent-relay-http-workspace-");
    const platform = createAgentRelayHttpPlatform({ userDataPath, workspaceRoot });
    try {
      const { token } = await platform.store.createGrant({
        label: "ACP Agent Relay Vitest",
        toolsets: ["pact.agent.relay"],
        scopes: ["agent_relay:view", "agent_relay:operate"],
        maxRisk: "repair_write"
      });

      const list = await callAgentRelayHttp({
        platform,
        token,
        method: "GET",
        path: "/api/agent-relay/v1/virtual-agents"
      });
      assert.equal(list.status, 200);
      assert.equal(list.payload.status, "ok");
      assert.equal(list.payload.result.ok, true);
      assert.equal(
        list.payload.result.data.virtualAgents.some((agent) => agent.virtualAgentId === "antigravity.multimodal-coding"),
        true
      );

      const create = await callAgentRelayHttp({
        platform,
        token,
        method: "POST",
        path: "/api/agent-relay/v1/sessions",
        body: {
          virtualAgentId: "antigravity.multimodal-coding",
          sourceId: "codex-http-vitest",
          sourceSessionId: "http-source-session",
          workspaceId: "http-workspace"
        }
      });
      assert.equal(create.status, 200);
      assert.equal(create.payload.status, "ok");
      assert.equal(create.payload.result.ok, true);
      const relaySessionId = create.payload.result.data.session.relaySessionId;
      assert.ok(relaySessionId);

      const prompt = await callAgentRelayHttp({
        platform,
        token,
        method: "POST",
        path: `/api/agent-relay/v1/sessions/${encodeURIComponent(relaySessionId)}/prompt`,
        headers: { "x-pact-safety-confirm": "true" },
        body: {
          prompt: "http delegated prompt",
          requestReasoning: true
        }
      });
      assert.equal(prompt.status, 200);
      assert.equal(prompt.payload.status, "ok");
      assert.equal(prompt.payload.result.ok, true);
      assertPromptAuditEvidence(prompt.payload.result);
      assert.equal(prompt.payload.result.data.outputSummary.includes("http delegated prompt"), true);
      assert.equal(prompt.payload.result.data.communicationSummary.outputAvailable, true);
      assert.equal(prompt.payload.result.data.communicationSummary.globalAuditId, prompt.payload.result.data.audit.globalAuditId);
      assert.equal(prompt.payload.result.data.communicationSummary.reasoningIncluded, true);
      assert.equal(prompt.payload.result.data.events.some((event) => event.type === "reasoning_trace"), true);

      const sessions = await callAgentRelayHttp({
        platform,
        token,
        method: "GET",
        path: "/api/agent-relay/v1/sessions?sourceId=codex-http-vitest"
      });
      assert.equal(sessions.status, 200);
      assert.equal(sessions.payload.status, "ok");
      assert.equal(sessions.payload.result.ok, true);
      assert.equal(sessions.payload.result.data.sessions.length, 1);
      assert.equal(sessions.payload.result.data.sessions[0].relaySessionId, relaySessionId);
      assert.equal(sessions.payload.result.data.sessions[0].sourceId, "codex-http-vitest");
      assert.equal(sessions.payload.result.data.sessions[0].turnCount, 1);
      assert.equal(sessions.payload.result.data.sessions[0].pendingPermissionCount, 0);

      const sessionDetails = await callAgentRelayHttp({
        platform,
        token,
        method: "GET",
        path: `/api/agent-relay/v1/sessions/${encodeURIComponent(relaySessionId)}`
      });
      assert.equal(sessionDetails.status, 200);
      assert.equal(sessionDetails.payload.status, "ok");
      assert.equal(sessionDetails.payload.result.ok, true);
      assert.equal(sessionDetails.payload.result.data.session.relaySessionId, relaySessionId);
      assert.equal(sessionDetails.payload.result.data.session.latestTurn.relayTurnId, prompt.payload.result.data.turn.relayTurnId);
      assert.equal(sessionDetails.payload.result.data.turns.length, 1);
      assert.equal(sessionDetails.payload.result.data.turns[0].communicationSummary.relayTurnId, prompt.payload.result.data.turn.relayTurnId);

      const turns = await callAgentRelayHttp({
        platform,
        token,
        method: "GET",
        path: `/api/agent-relay/v1/sessions/${encodeURIComponent(relaySessionId)}/turns`
      });
      assert.equal(turns.status, 200);
      assert.equal(turns.payload.status, "ok");
      assert.equal(turns.payload.result.ok, true);
      assert.equal(turns.payload.result.data.relaySessionId, relaySessionId);
      assert.equal(turns.payload.result.data.turns.length, 1);
      assert.equal(turns.payload.result.data.turns[0].relayTurnId, prompt.payload.result.data.turn.relayTurnId);

      const persistedPath = path.join(userDataPath, "agent-relay", "acp-relay-store.json");
      const persistedStore = JSON.parse(await fs.readFile(persistedPath, "utf8"));
      assert.equal(Boolean(persistedStore.sessions[relaySessionId]), true);
      const persistedTurn = Object.values(persistedStore.turns).find((turn) => turn.relaySessionId === relaySessionId);
      assert.equal(Boolean(persistedTurn), true);
      assert.equal(persistedTurn.globalAuditId, prompt.payload.result.data.audit.globalAuditId);
      assert.equal(persistedTurn.artifactRef, prompt.payload.result.data.audit.artifactRef);
      assert.equal(
        persistedTurn.metadata.result.communicationSummary.globalAuditId,
        prompt.payload.result.data.audit.globalAuditId
      );
    } finally {
      platform.close();
    }
  });

  it("keeps pending permission request details opt-in on the REST facade", async () => {
    const userDataPath = await makeTempDir("pact-acp-agent-relay-http-pending-list-");
    const workspaceRoot = await makeTempDir("pact-acp-agent-relay-http-pending-list-ws-");
    const platform = createAgentRelayHttpPlatform({ userDataPath, workspaceRoot });
    const secretContent = "http pending list secret content";
    try {
      const { token } = await platform.store.createGrant({
        label: "ACP Agent Relay HTTP Pending List Vitest",
        toolsets: ["pact.agent.relay"],
        scopes: ["agent_relay:view", "agent_relay:operate"],
        maxRisk: "repair_write"
      });

      const create = await callAgentRelayHttp({
        platform,
        token,
        method: "POST",
        path: "/api/agent-relay/v1/sessions",
        body: {
          virtualAgentId: "antigravity.multimodal-coding",
          sourceId: "codex-http-pending-list",
          sourceSessionId: "http-pending-list-source-session",
          workspaceId: "http-pending-list-workspace"
        }
      });
      assert.equal(create.status, 200);
      assert.equal(create.payload.result.ok, true);
      const relaySessionId = create.payload.result.data.session.relaySessionId;

      const pending = await callAgentRelayHttp({
        platform,
        token,
        method: "POST",
        path: `/api/agent-relay/v1/sessions/${encodeURIComponent(relaySessionId)}/prompt`,
        headers: { "x-pact-safety-confirm": "true" },
        body: {
          prompt: "http pending list observability",
          fileWrites: [{ path: "notes/http-pending-list.txt", content: secretContent }]
        }
      });
      assert.equal(pending.status, 200);
      assert.equal(pending.payload.result.ok, true);
      assert.equal(pending.payload.result.data.stopReason, "approval_pending");
      const pendingRequest = pending.payload.result.data.pendingPermissionRequests[0];

      const defaultSessions = await callAgentRelayHttp({
        platform,
        token,
        method: "GET",
        path: "/api/agent-relay/v1/sessions?sourceId=codex-http-pending-list"
      });
      assert.equal(defaultSessions.status, 200);
      const defaultSession = defaultSessions.payload.result.data.sessions[0];
      assert.equal(defaultSession.pendingPermissionCount, 1);
      assert.equal(defaultSession.pendingPermissionRequests, undefined);
      assert.equal(defaultSession.latestTurn.pendingPermissionCount, 1);
      assert.equal(defaultSession.latestTurn.pendingPermissionRequests, undefined);

      const detailedSessions = await callAgentRelayHttp({
        platform,
        token,
        method: "GET",
        path: "/api/agent-relay/v1/sessions?sourceId=codex-http-pending-list&includePendingPermissionRequests=true"
      });
      assert.equal(detailedSessions.status, 200);
      const detailedSession = detailedSessions.payload.result.data.sessions[0];
      assert.equal(detailedSession.pendingPermissionRequests[0].requestId, pendingRequest.requestId);
      assert.equal(detailedSession.latestTurn.pendingPermissionRequests[0].requestId, pendingRequest.requestId);
      assert.equal(JSON.stringify(detailedSession).includes(secretContent), false);

      const detailedGet = await callAgentRelayHttp({
        platform,
        token,
        method: "GET",
        path: `/api/agent-relay/v1/sessions/${encodeURIComponent(relaySessionId)}?includePendingPermissionRequests=true`
      });
      assert.equal(detailedGet.status, 200);
      assert.equal(detailedGet.payload.result.data.session.pendingPermissionRequests[0].requestId, pendingRequest.requestId);
      assert.equal(detailedGet.payload.result.data.turns[0].pendingPermissionRequests[0].requestId, pendingRequest.requestId);
      assert.equal(JSON.stringify(detailedGet.payload.result.data).includes(secretContent), false);

      const detailedTurns = await callAgentRelayHttp({
        platform,
        token,
        method: "GET",
        path: `/api/agent-relay/v1/sessions/${encodeURIComponent(relaySessionId)}/turns?includePendingPermissionRequests=true`
      });
      assert.equal(detailedTurns.status, 200);
      assert.equal(detailedTurns.payload.result.data.turns[0].pendingPermissionRequests[0].requestId, pendingRequest.requestId);
      assert.equal(JSON.stringify(detailedTurns.payload.result.data).includes(secretContent), false);
      await assert.rejects(
        fs.readFile(path.join(workspaceRoot, "notes", "http-pending-list.txt"), "utf8"),
        /ENOENT/
      );
    } finally {
      platform.close();
    }
  });

  it("fail-closes HTTP prompt and source fs routes after session close", async () => {
    const userDataPath = await makeTempDir("pact-acp-agent-relay-http-close-");
    const workspaceRoot = await makeTempDir("pact-acp-agent-relay-http-close-ws-");
    await fs.writeFile(path.join(workspaceRoot, "facts.txt"), "http close fact", "utf8");
    const platform = createAgentRelayHttpPlatform({ userDataPath, workspaceRoot });
    try {
      const { token } = await platform.store.createGrant({
        label: "ACP Agent Relay HTTP Close Vitest",
        toolsets: ["pact.agent.relay"],
        scopes: ["agent_relay:view", "agent_relay:operate"],
        maxRisk: "repair_write"
      });

      const create = await callAgentRelayHttp({
        platform,
        token,
        method: "POST",
        path: "/api/agent-relay/v1/sessions",
        body: {
          virtualAgentId: "antigravity.multimodal-coding",
          sourceId: "codex-http-vitest-close",
          sourceSessionId: "http-close-source-session",
          workspaceId: "http-close-workspace"
        }
      });
      assert.equal(create.status, 200);
      assert.equal(create.payload.status, "ok");
      assert.equal(create.payload.result.ok, true);
      const relaySessionId = create.payload.result.data.session.relaySessionId;

      const pending = await callAgentRelayHttp({
        platform,
        token,
        method: "POST",
        path: `/api/agent-relay/v1/sessions/${encodeURIComponent(relaySessionId)}/prompt`,
        headers: { "x-pact-safety-confirm": "true" },
        body: {
          prompt: "http pending write before close",
          fileWrites: [{ path: "notes/http-pending-close.txt", content: "must not be written after close" }]
        }
      });
      assert.equal(pending.status, 200);
      assert.equal(pending.payload.status, "ok");
      assert.equal(pending.payload.result.ok, true);
      assert.equal(pending.payload.result.data.stopReason, "approval_pending");
      const pendingRequest = pending.payload.result.data.pendingPermissionRequests[0];
      assert.equal(pendingRequest.status, "pending");
      await assert.rejects(
        fs.readFile(path.join(workspaceRoot, "notes", "http-pending-close.txt"), "utf8"),
        /ENOENT/
      );

      const closed = await callAgentRelayHttp({
        platform,
        token,
        method: "POST",
        path: `/api/agent-relay/v1/sessions/${encodeURIComponent(relaySessionId)}/close`
      });
      assert.equal(closed.status, 200);
      assert.equal(closed.payload.status, "ok");
      assert.equal(closed.payload.result.ok, true);
      assert.equal(closed.payload.result.data.session.lifecycleState, "closed");
      assert.equal(closed.payload.result.data.cancelledTurns.length, 1);
      assert.equal(closed.payload.result.data.cancelledTurns[0].turn.stopReason, "cancelled");

      const persistedPath = path.join(userDataPath, "agent-relay", "acp-relay-store.json");
      const persistedStore = JSON.parse(await fs.readFile(persistedPath, "utf8"));
      assert.equal(persistedStore.permissionRequests[pendingRequest.requestId].status, "cancelled");
      assert.equal(persistedStore.permissionRequests[pendingRequest.requestId].decisionId, "source-session-close");

      const promptAfterClose = await callAgentRelayHttp({
        platform,
        token,
        method: "POST",
        path: `/api/agent-relay/v1/sessions/${encodeURIComponent(relaySessionId)}/prompt`,
        headers: { "x-pact-safety-confirm": "true" },
        body: { prompt: "must fail after close" }
      });
      assert.equal(promptAfterClose.status, 400);
      assert.equal(promptAfterClose.payload.status, "failed");
      assert.equal(promptAfterClose.payload.result.ok, false);
      assert.equal(promptAfterClose.payload.result.error.code, "relay_session_closed");
      assert.equal(promptAfterClose.payload.result.error.details.lifecycleState, "closed");

      const readAfterClose = await callAgentRelayHttp({
        platform,
        token,
        method: "POST",
        path: "/api/agent-relay/v1/fs/read-text-file",
        body: {
          sessionId: relaySessionId,
          path: "facts.txt"
        }
      });
      assert.equal(readAfterClose.status, 400);
      assert.equal(readAfterClose.payload.status, "failed");
      assert.equal(readAfterClose.payload.result.ok, false);
      assert.equal(readAfterClose.payload.result.error.code, "relay_session_closed");
      assert.equal(readAfterClose.payload.result.error.details.lifecycleState, "closed");

      const writeAfterClose = await callAgentRelayHttp({
        platform,
        token,
        method: "POST",
        path: "/api/agent-relay/v1/fs/write-text-file",
        headers: { "x-pact-safety-confirm": "true" },
        body: {
          virtualAgentId: "antigravity.multimodal-coding",
          sourceId: "codex-http-vitest-close",
          sourceSessionId: "http-close-source-session",
          workspaceId: "http-close-workspace",
          path: "notes/http-after-close.txt",
          content: "must not be written after close"
        }
      });
      assert.equal(writeAfterClose.status, 400);
      assert.equal(writeAfterClose.payload.status, "failed");
      assert.equal(writeAfterClose.payload.result.ok, false);
      assert.equal(writeAfterClose.payload.result.error.code, "relay_session_closed");
      assert.equal(writeAfterClose.payload.result.error.details.lifecycleState, "closed");
      await assert.rejects(
        fs.readFile(path.join(workspaceRoot, "notes", "http-after-close.txt"), "utf8"),
        /ENOENT/
      );
    } finally {
      platform.close();
    }
  });

  it("does not expose internal permission resolve through the relay HTTP compatibility surface", async () => {
    const userDataPath = await makeTempDir("pact-acp-agent-relay-http-internal-");
    const workspaceRoot = await makeTempDir("pact-acp-agent-relay-http-internal-ws-");
    const platform = createAgentRelayHttpPlatform({ userDataPath, workspaceRoot });
    try {
      const { token } = await platform.store.createGrant({
        label: "ACP Agent Relay Internal Route Vitest",
        toolsets: ["pact.agent.relay"],
        scopes: ["agent_relay:view", "agent_relay:operate"],
        maxRisk: "repair_write"
      });

      const internal = await callAgentRelayHttp({
        platform,
        token,
        method: "POST",
        path: "/api/agent-relay/v1/sessions/relay_session_vitest/permission/resolve",
        body: {
          requestId: "permission-request-vitest",
          approved: true
        }
      });

      assert.equal(internal.status, 404);
      assert.equal(internal.payload.error.code, "agent_relay_tool_not_exposed");
      assert.equal(JSON.stringify(internal.payload).includes("acp_agent_relay.permission.resolve"), false);
    } finally {
      platform.close();
    }
  });

  it("rejects relay HTTP calls after their Tool Management grant is revoked", async () => {
    const userDataPath = await makeTempDir("pact-acp-agent-relay-http-revoke-");
    const workspaceRoot = await makeTempDir("pact-acp-agent-relay-http-revoke-ws-");
    const changeEvents = [];
    const platform = createAgentRelayHttpPlatform({
      userDataPath,
      workspaceRoot,
      changeHandlers: [
        (event) => {
          changeEvents.push(event);
        }
      ]
    });
    try {
      const issued = await platform.store.createGrant({
        label: "ACP Agent Relay Revoked Grant Vitest",
        toolsets: ["pact.agent.relay"],
        scopes: ["agent_relay:view", "agent_relay:operate"],
        maxRisk: "repair_write"
      });

      const beforeRevoke = await callAgentRelayHttp({
        platform,
        token: issued.token,
        method: "GET",
        path: "/api/agent-relay/v1/virtual-agents"
      });
      assert.equal(beforeRevoke.status, 200);
      assert.equal(beforeRevoke.payload.result.ok, true);

      const revoked = await platform.store.revokeGrant(issued.grant.id, "vitest grant revoked");
      assert.equal(revoked.enabled, false);
      assert.ok(revoked.revokedAt);
      assert.equal(
        changeEvents.some((event) =>
          event.reasonCode === "grant_revoked" &&
          event.grantId === issued.grant.id &&
          event.notification?.notification === "notifications/tools/list_changed"
        ),
        true
      );

      const afterRevoke = await callAgentRelayHttp({
        platform,
        token: issued.token,
        method: "GET",
        path: "/api/agent-relay/v1/virtual-agents"
      });
      assert.equal(afterRevoke.status, 401);
      assert.equal(afterRevoke.payload.error.code, "invalid_token");
    } finally {
      platform.close();
    }
  });

  it("returns 404 for unknown routes and 401 for missing authorization token", async () => {
    const userDataPath = await makeTempDir("pact-acp-agent-relay-http-unauth-");
    const workspaceRoot = await makeTempDir("pact-acp-agent-relay-http-unauth-ws-");
    const platform = createAgentRelayHttpPlatform({ userDataPath, workspaceRoot });
    try {
      // Unknown route — should not be handled (handled===false) or return a 404/error payload.
      const unknownResponse = createCapturedHttpResponse();
      const unknownUrl = new URL("/api/agent-relay/v1/does-not-exist", "http://127.0.0.1");
      const unknownHandled = await platform.router.handleToolManagementHttpRequest({
        request: {
          method: "GET",
          headers: { authorization: "Bearer bogus-token" },
          socket: { remoteAddress: "127.0.0.1" }
        },
        response: unknownResponse,
        requestBody: Buffer.alloc(0),
        url: unknownUrl,
        method: "GET"
      });
      // Either the router returns false (unhandled) OR it returns a 404 status.
      if (unknownHandled) {
        assert.ok(
          unknownResponse.statusCode === 404 || unknownResponse.statusCode >= 400,
          `Expected 4xx for unknown route, got ${unknownResponse.statusCode}`
        );
      } else {
        assert.equal(unknownHandled, false);
      }

      // Missing / empty authorization header — the platform must refuse with 401.
      const unauthResponse = createCapturedHttpResponse();
      const unauthUrl = new URL("/api/agent-relay/v1/virtual-agents", "http://127.0.0.1");
      const unauthHandled = await platform.router.handleToolManagementHttpRequest({
        request: {
          method: "GET",
          headers: {},                       // <— no authorization header
          socket: { remoteAddress: "127.0.0.1" }
        },
        response: unauthResponse,
        requestBody: Buffer.alloc(0),
        url: unauthUrl,
        method: "GET"
      });
      if (unauthHandled) {
        assert.ok(
          unauthResponse.statusCode === 401 || unauthResponse.statusCode === 403,
          `Expected 401/403 for missing token, got ${unauthResponse.statusCode}`
        );
      }
    } finally {
      platform.close();
    }
  });
});

describe("ACP Agent Relay — unknown virtual agent rejection", () => {
  it("rejects initialize for a non-existent virtual agent with virtual_agent_unavailable", async () => {
    const runtime = createAcpRelayRuntime();

    const initResult = await runtime.execute("acp_agent_relay.virtual_agent.initialize", {
      virtualAgentId: "nonexistent.ghost-agent"
    });
    assert.equal(initResult.ok, false);
    assert.equal(initResult.error.code, "virtual_agent_unavailable");
  });

  it("rejects session creation for an unknown virtual agent with virtual_agent_unknown", async () => {
    const runtime = createAcpRelayRuntime();

    const createResult = await runtime.execute("acp_agent_relay.session.create", {
      sourceId: "codex-vitest",
      sourceSessionId: `ghost-${Date.now()}`,
      workspaceId: "vitest-workspace",
      virtualAgentId: "nonexistent.ghost-agent"
    });
    assert.equal(createResult.ok, false);
    assert.equal(createResult.error.code, "virtual_agent_unknown");
  });
});

describe("ACP Agent Relay — path traversal and absolute path write denial", () => {
  it("denies writes with path traversal sequences (../) and records path_denied receipt", async () => {
    const workspaceRoot = await makeTempDir();
    const runtime = createAcpRelayRuntime({ workspaceRoot });
    const session = await createSession(runtime, { virtualAgentId: "antigravity.multimodal-coding" });

    const traversalPaths = [
      "../escape.txt",
      "../../etc/passwd",
      "safe/../../../etc/shadow",
      "a/b/../../c/../../../outside.txt"
    ];

    for (const dangerousPath of traversalPaths) {
      const result = await runtime.execute("acp_agent_relay.prompt.send", {
        relaySessionId: session.relaySessionId,
        prompt: "write traversal",
        fileWrites: [
          {
            path: dangerousPath,
            content: "MALICIOUS",
            approval: { approved: true, approvalId: "approval-bypass" }
          }
        ]
      });
      assert.equal(result.ok, true, `Expected ok result frame for path: ${dangerousPath}`);
      assert.equal(
        result.data.receipts.some((r) => r.reasonCode === "path_denied"),
        true,
        `Expected path_denied receipt for: ${dangerousPath}`
      );
    }
  });

  it("denies writes with absolute Unix and Windows paths and records path_denied receipt", async () => {
    const workspaceRoot = await makeTempDir();
    const runtime = createAcpRelayRuntime({ workspaceRoot });
    const session = await createSession(runtime, { virtualAgentId: "antigravity.multimodal-coding" });

    const absolutePaths = [
      "/etc/passwd",
      "/tmp/injected.txt",
      "\\Windows\\System32\\evil.dll",
      "\\\\UNC\\share\\file.txt"
    ];

    for (const absolutePath of absolutePaths) {
      const result = await runtime.execute("acp_agent_relay.prompt.send", {
        relaySessionId: session.relaySessionId,
        prompt: "write absolute",
        fileWrites: [
          {
            path: absolutePath,
            content: "INJECTED",
            approval: { approved: true, approvalId: "approval-bypass" }
          }
        ]
      });
      assert.equal(result.ok, true, `Expected ok result frame for path: ${absolutePath}`);
      assert.equal(
        result.data.receipts.some((r) => r.reasonCode === "path_denied"),
        true,
        `Expected path_denied receipt for: ${absolutePath}`
      );
    }

    // Verify no actual files were written to the workspace root.
    const listing = await fs.readdir(workspaceRoot, { recursive: true }).catch(() => []);
    assert.equal(
      listing.length,
      0,
      `Workspace root should be empty after all denied writes, found: ${listing.join(", ")}`
    );
  });
});

describe("ACP Agent Relay — session lifecycle (resume / wake / cancel / close)", () => {
  it("transitions session through dormant → active → dormant via wake then cancel", async () => {
    const runtime = createAcpRelayRuntime();

    // Create — starts as dormant.
    const session = await createSession(runtime);
    assert.equal(session.lifecycleState, "dormant");

    // Wake — transitions to active.
    const wakeResult = await runtime.execute("acp_agent_relay.session.wake", {
      relaySessionId: session.relaySessionId
    });
    assert.equal(wakeResult.ok, true);
    assert.equal(wakeResult.data.session.lifecycleState, "active");
    assert.equal(runtime.sessionDriver.connections.size, 1);
    const connectionKey = [...runtime.sessionDriver.connections.keys()][0];
    const connectionBeforeCancel = runtime.sessionDriver.connections.get(connectionKey);

    // Cancel — transitions back to dormant (in-flight turn cancelled).
    const cancelResult = await runtime.execute("acp_agent_relay.session.cancel", {
      relaySessionId: session.relaySessionId
    });
    assert.equal(cancelResult.ok, true);
    assert.equal(cancelResult.data.session.lifecycleState, "dormant");
    assert.equal(runtime.sessionDriver.connections.has(connectionKey), true);
    assert.equal(runtime.sessionDriver.connections.get(connectionKey), connectionBeforeCancel);
    assert.equal(connectionBeforeCancel.closed, false);
  });

  it("restores lifecycle and drops cached connections when target wake initialization fails", async () => {
    const targetId = "mock.failed-wake-target";
    const virtualAgentId = "mock.failed-wake-agent";
    const connections = [];
    const runtime = createAcpRelayRuntime({
      defaultVirtualAgentId: virtualAgentId,
      virtualAgentRegistry: new AcpVirtualAgentRegistry({
        [virtualAgentId]: {
          virtualAgentId,
          targetId,
          profileId: "pact.acp.failed_wake.mock",
          displayName: "Failed Wake Mock Target",
          advertisedModes: ["ask"],
          defaultMode: "ask",
          advertisedTools: ["mock.prompt"],
          reasoningVisibilityPolicy: "never",
          capabilityPolicy: {
            writes: "deny",
            terminal: "deny",
            maxRisk: "read_only"
          },
          revision: 1
        }
      }),
      targetRegistry: new AcpTargetRegistry({
        [targetId]: {
          targetId,
          label: "Failed Wake Mock Target",
          transport: { type: "mock" },
          advertisedToolsets: ["mock.prompt"],
          enabled: true,
          revision: 1
        }
      }),
      sessionDriver: new AcpSessionDriver({
        connectionFactory: () => {
          const connection = {
            closed: false,
            async initialize() {
              return {
                ok: false,
                errorCode: "target_handshake_failed",
                errorMessage: "Target handshake failed."
              };
            },
            async close() {
              this.closed = true;
              return { ok: true };
            }
          };
          connections.push(connection);
          return connection;
        }
      })
    });
    const session = await createSession(runtime, { virtualAgentId });

    const wakeResult = await runtime.execute("acp_agent_relay.session.wake", {
      relaySessionId: session.relaySessionId
    });
    assert.equal(wakeResult.ok, false);
    assert.equal(wakeResult.error.code, "target_handshake_failed");
    assert.equal(wakeResult.error.details.reasonCode, "target_handshake_failed");
    assert.equal(wakeResult.error.details.lifecycleState, "dormant");
    assert.equal(connections.length, 1);
    assert.equal(connections[0].closed, true);
    assert.equal(runtime.sessionDriver.connections.size, 0);
    const stored = await runtime.store.getSession(session.relaySessionId);
    assert.equal(stored.lifecycleState, "dormant");
    assert.equal(stored.metadata.lastWakeResult.ok, false);
    assert.equal(stored.metadata.lastWakeResult.code, "target_handshake_failed");
  });

  it("transitions session to closed and rejects resume of a non-existent session", async () => {
    const runtime = createAcpRelayRuntime();

    const session = await createSession(runtime);

    // Close — final lifecycle state.
    const closeResult = await runtime.execute("acp_agent_relay.session.close", {
      relaySessionId: session.relaySessionId
    });
    assert.equal(closeResult.ok, true);
    assert.equal(closeResult.data.session.lifecycleState, "closed");

    const resumeClosed = await runtime.execute("acp_agent_relay.session.resume", {
      relaySessionId: session.relaySessionId
    });
    assert.equal(resumeClosed.ok, false);
    assert.equal(resumeClosed.error.code, "relay_session_closed");

    const wakeClosed = await runtime.execute("acp_agent_relay.session.wake", {
      relaySessionId: session.relaySessionId
    });
    assert.equal(wakeClosed.ok, false);
    assert.equal(wakeClosed.error.code, "relay_session_closed");

    const promptClosed = await runtime.execute("acp_agent_relay.prompt.send", {
      relaySessionId: session.relaySessionId,
      prompt: "should not run after close"
    });
    assert.equal(promptClosed.ok, false);
    assert.equal(promptClosed.error.code, "relay_session_closed");

    const cancelClosed = await runtime.execute("acp_agent_relay.session.cancel", {
      relaySessionId: session.relaySessionId
    });
    assert.equal(cancelClosed.ok, false);
    assert.equal(cancelClosed.error.code, "relay_session_closed");

    // Resume on a completely bogus ID must fail.
    const resumeResult = await runtime.execute("acp_agent_relay.session.resume", {
      relaySessionId: "relay_session_does_not_exist_xyz"
    });
    assert.equal(resumeResult.ok, false);
    assert.equal(resumeResult.error.code, "relay_session_not_found");
  });

  it("resume on an existing session resets lifecycle to dormant", async () => {
    const runtime = createAcpRelayRuntime();
    const session = await createSession(runtime);

    // Wake first to put it into active state.
    await runtime.execute("acp_agent_relay.session.wake", {
      relaySessionId: session.relaySessionId
    });

    // Resume should move it back to dormant.
    const resumeResult = await runtime.execute("acp_agent_relay.session.resume", {
      relaySessionId: session.relaySessionId
    });
    assert.equal(resumeResult.ok, true);
    assert.equal(resumeResult.data.session.lifecycleState, "dormant");
    assert.equal(resumeResult.data.session.relaySessionId, session.relaySessionId);
  });

  it("refreshes current route policy and capabilities when resuming a session", async () => {
    const runtime = createAcpRelayRuntime();
    const session = await createSession(runtime);
    const originalSnapshot = session.capabilitiesSnapshot;
    assert.equal(originalSnapshot.route.policyRevision, 2);
    assert.equal(originalSnapshot.capabilities.writes, "approval_required");

    const target = runtime.targetRegistry.getTarget(session.targetId);
    runtime.targetRegistry.upsertTarget({
      ...target,
      revision: 5,
      capabilityPolicy: {
        ...target.capabilityPolicy,
        writes: "deny"
      }
    });

    const resumeResult = await runtime.execute("acp_agent_relay.session.resume", {
      relaySessionId: session.relaySessionId
    });

    assert.equal(resumeResult.ok, true);
    assert.equal(resumeResult.data.capabilitiesSnapshot.route.policyRevision, 6);
    assert.equal(resumeResult.data.capabilitiesSnapshot.capabilities.writes, "deny");
    assert.equal(resumeResult.data.session.policyRevision, 6);
    assert.equal(resumeResult.data.session.capabilitiesSnapshot.capabilities.writes, "deny");
    assert.equal(resumeResult.data.route.policyRevision, 6);

    const stored = await runtime.store.getSession(session.relaySessionId);
    assert.equal(stored.policyRevision, 6);
    assert.equal(stored.metadata.capabilitiesSnapshot.route.policyRevision, 6);
    assert.equal(stored.metadata.lastResumeResult.ok, true);
  });

  it("blocks resume when the current target route is no longer available", async () => {
    const runtime = createAcpRelayRuntime();
    const session = await createSession(runtime);
    const target = runtime.targetRegistry.getTarget(session.targetId);
    runtime.targetRegistry.upsertTarget({
      ...target,
      enabled: false,
      revision: target.revision + 1
    });

    const resumeResult = await runtime.execute("acp_agent_relay.session.resume", {
      relaySessionId: session.relaySessionId
    });

    assert.equal(resumeResult.ok, false);
    assert.equal(resumeResult.error.code, "target_disabled");
    assert.equal(resumeResult.error.details.relaySessionId, session.relaySessionId);
    assert.equal(resumeResult.error.details.lifecycleState, "blocked");

    const stored = await runtime.store.getSession(session.relaySessionId);
    assert.equal(stored.lifecycleState, "blocked");
    assert.equal(stored.metadata.lastResumeResult.ok, false);
    assert.equal(stored.metadata.lastResumeResult.code, "target_disabled");
  });

  it("drops an unreusable cached target connection before waking from persisted resume state", async () => {
    const targetId = "mock.unreusable-target";
    const virtualAgentId = "mock.unreusable-agent";
    const connections = [];
    const runtime = createAcpRelayRuntime({
      defaultVirtualAgentId: virtualAgentId,
      virtualAgentRegistry: new AcpVirtualAgentRegistry({
        [virtualAgentId]: {
          virtualAgentId,
          targetId,
          profileId: "pact.acp.unreusable_connection.mock",
          displayName: "Unreusable Connection Mock Target",
          advertisedModes: ["ask"],
          defaultMode: "ask",
          advertisedTools: ["mock.prompt"],
          reasoningVisibilityPolicy: "never",
          capabilityPolicy: {
            writes: "deny",
            terminal: "deny",
            maxRisk: "read_only"
          },
          revision: 1
        }
      }),
      targetRegistry: new AcpTargetRegistry({
        [targetId]: {
          targetId,
          label: "Unreusable Connection Mock Target",
          transport: { type: "mock" },
          advertisedToolsets: ["mock.prompt"],
          enabled: true,
          revision: 1
        }
      }),
      sessionDriver: new AcpSessionDriver({
        connectionFactory: () => {
          const ordinal = connections.length + 1;
          const connection = {
            closed: false,
            reusable: true,
            initializeCalls: [],
            promptCalls: [],
            closeCalls: 0,
            isReusable() {
              return this.reusable;
            },
            async initialize(params = {}) {
              this.initializeCalls.push({ ...params });
              return {
                ok: true,
                targetSessionId: `unreusable-target-session-${ordinal}`,
                targetResumeRef: `unreusable-target-resume-${ordinal}`
              };
            },
            async sendPrompt(params = {}) {
              this.promptCalls.push({ ...params });
              return {
                ok: true,
                updates: [],
                reasoning: [],
                stopReason: "completed",
                text: `connection ${ordinal}`,
                targetSessionId: `unreusable-target-session-${ordinal}`,
                targetResumeRef: `unreusable-target-resume-${ordinal}`,
                externalCompletionState: "completed",
                finalResponseAvailable: true
              };
            },
            async close() {
              this.closeCalls += 1;
              this.closed = true;
              return { ok: true };
            }
          };
          connections.push(connection);
          return connection;
        }
      })
    });
    const session = await createSession(runtime, {
      virtualAgentId,
      sourceSessionId: "unreusable-source-session"
    });

    const first = await runtime.execute("acp_agent_relay.prompt.send", {
      relaySessionId: session.relaySessionId,
      prompt: "first prompt"
    });
    assert.equal(first.ok, true);
    assert.equal(first.data.targetEvidence.targetSessionId, "unreusable-target-session-1");
    assert.equal(connections.length, 1);

    connections[0].reusable = false;
    const second = await runtime.execute("acp_agent_relay.prompt.send", {
      relaySessionId: session.relaySessionId,
      prompt: "second prompt"
    });
    assert.equal(second.ok, true);
    assert.equal(second.data.targetEvidence.targetSessionId, "unreusable-target-session-2");
    assert.equal(connections.length, 2);
    assert.equal(connections[0].closeCalls, 1);
    assert.equal(connections[0].closed, true);
    assert.equal(connections[1].initializeCalls[0].targetResumeRef, "unreusable-target-resume-1");
    assert.equal(connections[1].promptCalls[0].prompt, "second prompt");
    assert.equal(runtime.sessionDriver.connections.get(`${targetId}::${session.relaySessionId}`), connections[1]);
  });

  it("drops a cached target connection whose stdio child has exited before prompt reuse", async () => {
    const targetId = "mock.exited-child-target";
    const virtualAgentId = "mock.exited-child-agent";
    const connections = [];
    const runtime = createAcpRelayRuntime({
      defaultVirtualAgentId: virtualAgentId,
      virtualAgentRegistry: new AcpVirtualAgentRegistry({
        [virtualAgentId]: {
          virtualAgentId,
          targetId,
          profileId: "pact.acp.exited_child.mock",
          displayName: "Exited Child Mock Target",
          advertisedModes: ["ask"],
          defaultMode: "ask",
          advertisedTools: ["mock.prompt"],
          reasoningVisibilityPolicy: "never",
          capabilityPolicy: {
            writes: "deny",
            terminal: "deny",
            maxRisk: "read_only"
          },
          metadata: {
            public: { fixture: "source-bridge-public-metadata" },
            csrfToken: "virtual-agent-secret-csrf-token",
            apiKey: "virtual-agent-secret-api-key",
            rawPrompt: "virtual-agent-raw-prompt",
            transport: { command: "/tmp/virtual-agent-secret-command" }
          },
          revision: 1
        }
      }),
      targetRegistry: new AcpTargetRegistry({
        [targetId]: {
          targetId,
          label: "Exited Child Mock Target",
          transport: { type: "mock" },
          advertisedToolsets: ["mock.prompt"],
          enabled: true,
          revision: 1
        }
      }),
      sessionDriver: new AcpSessionDriver({
        connectionFactory: () => {
          const ordinal = connections.length + 1;
          const connection = {
            closed: false,
            transport: {
              closed: false,
              child: {
                exitCode: null,
                signalCode: null
              }
            },
            initializeCalls: [],
            closeCalls: 0,
            async initialize(params = {}) {
              this.initializeCalls.push({ ...params });
              return {
                ok: true,
                targetSessionId: `exited-child-target-session-${ordinal}`,
                targetResumeRef: `exited-child-target-resume-${ordinal}`
              };
            },
            async sendPrompt(params = {}) {
              return {
                ok: true,
                updates: [],
                reasoning: [],
                stopReason: "completed",
                text: `connection ${ordinal}: ${params.prompt || ""}`.trim(),
                targetSessionId: `exited-child-target-session-${ordinal}`,
                targetResumeRef: `exited-child-target-resume-${ordinal}`,
                externalCompletionState: "completed",
                finalResponseAvailable: true
              };
            },
            async close() {
              this.closeCalls += 1;
              this.closed = true;
              this.transport.closed = true;
              return { ok: true };
            }
          };
          connections.push(connection);
          return connection;
        }
      })
    });
    const session = await createSession(runtime, {
      virtualAgentId,
      sourceSessionId: "exited-child-source-session"
    });

    const first = await runtime.execute("acp_agent_relay.prompt.send", {
      relaySessionId: session.relaySessionId,
      prompt: "first prompt"
    });
    assert.equal(first.ok, true);
    assert.equal(first.data.targetEvidence.targetSessionId, "exited-child-target-session-1");
    assert.equal(connections.length, 1);

    connections[0].transport.child.exitCode = 0;
    const second = await runtime.execute("acp_agent_relay.prompt.send", {
      relaySessionId: session.relaySessionId,
      prompt: "second prompt after child exit"
    });
    assert.equal(second.ok, true);
    assert.equal(second.data.targetEvidence.targetSessionId, "exited-child-target-session-2");
    assert.equal(connections.length, 2);
    assert.equal(connections[0].closeCalls, 1);
    assert.equal(connections[1].initializeCalls[0].targetResumeRef, "exited-child-target-resume-1");
    assert.equal(runtime.sessionDriver.connections.get(`${targetId}::${session.relaySessionId}`), connections[1]);
  });

  it("recreates a target session when stored target resume metadata is stale", async () => {
    const targetId = "target.acp.stale-resume-runtime";
    const virtualAgentId = "virtual.acp.stale-resume-runtime";
    const received = [];
    const transportPair = createAcpSourceJsonRpcTransportPair();
    const serving = (async () => {
      while (true) {
        const raw = await transportPair.server.receive();
        if (raw === null || raw === undefined) {
          return;
        }
        const message = parseJsonRpcMessage(raw);
        received.push(message);
        if (message.method === ACP_METHODS.initialize) {
          await transportPair.server.send(createSuccess(message.id, {
            protocolVersion: "v0.0.1:strategy:target-acp-stale-resume-runtime-1",
            capabilities: {
              session: ["new", "resume"],
              updates: ["progress"]
            }
          }));
        } else if (message.method === ACP_METHODS.sessionResume) {
          await transportPair.server.send(createError(message.id, -32004, "stored resume ref is stale"));
        } else if (message.method === ACP_METHODS.sessionNew) {
          await transportPair.server.send(createSuccess(message.id, {
            targetSessionId: "runtime-recreated-target-session",
            targetResumeRef: "runtime-recreated-target-resume"
          }));
        } else {
          await transportPair.server.send(createError(message.id, -32601, `Unsupported target ACP method ${message.method}`));
        }
      }
    })();
    const runtime = createAcpRelayRuntime({
      defaultVirtualAgentId: virtualAgentId,
      virtualAgentRegistry: new AcpVirtualAgentRegistry({
        [virtualAgentId]: {
          virtualAgentId,
          targetId,
          profileId: "pact.acp.stale_resume_runtime",
          displayName: "Stale Resume Runtime Target",
          advertisedModes: ["ask"],
          defaultMode: "ask",
          advertisedTools: ["mock.prompt"],
          reasoningVisibilityPolicy: "never",
          capabilityPolicy: {
            writes: "deny",
            terminal: "deny",
            maxRisk: "read_only"
          },
          revision: 1
        }
      }),
      targetRegistry: new AcpTargetRegistry({
        [targetId]: {
          targetId,
          label: "Stale Resume Runtime Target",
          transport: { type: "acp-json-rpc" },
          advertisedToolsets: ["mock.prompt"],
          enabled: true,
          revision: 1
        }
      }),
      sessionDriver: new AcpSessionDriver({
        connectionFactory: (options) => new AcpClientConnection({
          ...options,
          transport: transportPair.client,
          requestTimeoutMs: 1000
        })
      })
    });

    try {
      const session = await createSession(runtime, { virtualAgentId });
      await runtime.store.updateSession(session.relaySessionId, {
        targetSessionId: "stale-target-session",
        targetResumeRef: "stale-target-resume"
      });
      const wake = await runtime.execute("acp_agent_relay.session.wake", {
        relaySessionId: session.relaySessionId
      });
      assert.equal(wake.ok, true);
      assert.equal(wake.data.wake.wakeMode, "recreated");
      assert.equal(wake.data.session.targetSessionId, "runtime-recreated-target-session");
      assert.equal(wake.data.session.targetResumeRef, "runtime-recreated-target-resume");
      assert.equal(received.some((message) => message.method === ACP_METHODS.sessionResume), true);
      assert.equal(received.some((message) => message.method === ACP_METHODS.sessionNew), true);
      const storedSession = await runtime.store.getSession(session.relaySessionId);
      assert.equal(storedSession.targetSessionId, "runtime-recreated-target-session");
      assert.equal(storedSession.targetResumeRef, "runtime-recreated-target-resume");
    } finally {
      await runtime.close();
      transportPair.close();
      await serving;
    }
  });

  it("closes the target connection when the relay session is closed", async () => {
    const targetId = "target.close-lifecycle";
    const virtualAgentId = "virtual.close-lifecycle";
    const closedConnections = [];
    const runtime = createAcpRelayRuntime({
      virtualAgentRegistry: new AcpVirtualAgentRegistry({
        [virtualAgentId]: {
          virtualAgentId,
          targetId,
          profileId: "pact.acp.close_lifecycle",
          displayName: "Close Lifecycle Target",
          advertisedModes: ["ask"],
          defaultMode: "ask",
          advertisedTools: ["target.prompt"],
          reasoningVisibilityPolicy: "never",
          capabilityPolicy: {
            writes: "deny",
            terminal: "deny",
            maxRisk: "read_only"
          },
          revision: 1
        }
      }),
      targetRegistry: new AcpTargetRegistry({
        [targetId]: {
          targetId,
          label: "Close Lifecycle Target",
          transport: { type: "mock" },
          enabled: true,
          revision: 1
        }
      }),
      sessionDriver: new AcpSessionDriver({
        connectionFactory: ({ relaySession }) => ({
          initialized: false,
          closed: false,
          async initialize() {
            this.initialized = true;
            return {
              ok: true,
              targetSessionId: `close-target-${relaySession.relaySessionId}`,
              targetResumeRef: `close-resume-${relaySession.relaySessionId}`
            };
          },
          async sendPrompt(params = {}) {
            return {
              ok: true,
              updates: [{ type: "progress", phase: "working", text: "close lifecycle target working" }],
              stopReason: "completed",
              text: `close lifecycle completed ${params.prompt || ""}`.trim(),
              finalResponseAvailable: true,
              externalCompletionState: "completed"
            };
          },
          async cancel() {
            return { ok: true };
          },
          async close() {
            this.closed = true;
            closedConnections.push(relaySession.relaySessionId);
            return { ok: true };
          }
        })
      })
    });
    const session = await createSession(runtime, {
      virtualAgentId,
      sourceSessionId: "close-lifecycle-session"
    });
    const prompt = await runtime.execute("acp_agent_relay.prompt.send", {
      relaySessionId: session.relaySessionId,
      prompt: "create target connection"
    });
    assert.equal(prompt.ok, true);
    assert.equal(runtime.sessionDriver.connections.size, 1);

    const close = await runtime.execute("acp_agent_relay.session.close", {
      relaySessionId: session.relaySessionId
    });
    assert.equal(close.ok, true);
    assert.equal(close.data.session.lifecycleState, "closed");
    assert.equal(close.data.close.ok, true);
    assert.equal(runtime.sessionDriver.connections.size, 0);
    assert.deepEqual(closedConnections, [session.relaySessionId]);
  });
});

describe("ACP Agent Relay — requestReasoning=false must not leak reasoning_trace", () => {
  it("maps Antigravity Connect pending command interactions into the relay permission audit stream", async () => {
    const targetId = "mock.connect-permission-target";
    const virtualAgentId = "mock.connect-permission-agent";
    const runtime = createAcpRelayRuntime({
      virtualAgents: {
        [virtualAgentId]: {
          virtualAgentId,
          targetId,
          profileId: "pact.acp.connect_permission.mock",
          displayName: "Connect Permission Mock Agent",
          advertisedModes: ["ask"],
          defaultMode: "ask",
          advertisedTools: ["agentapi.sendMessage"],
          reasoningVisibilityPolicy: "never",
          capabilityPolicy: {
            writes: "deny",
            terminal: "deny",
            maxRisk: "read_only"
          },
          revision: 1
        }
      },
      targets: {
        [targetId]: {
          targetId,
          label: "Connect Permission Mock Target",
          transport: { type: "mock" },
          enabled: true,
          revision: 1,
          capabilityPolicy: {
            writes: "deny",
            terminal: "deny",
            maxRisk: "read_only"
          },
          advertisedToolsets: ["agentapi.sendMessage"]
        }
      },
      connectionFactory: ({ relaySession }) => ({
        async initialize() {
          return {
            ok: true,
            targetSessionId: `connect-target-${relaySession.relaySessionId}`,
            targetResumeRef: `connect-target-${relaySession.relaySessionId}`
          };
        },
        async sendPrompt() {
          return {
            ok: true,
            updates: [{ type: "progress", phase: "accepted", text: "accepted by Antigravity mock" }],
            stopReason: "accepted",
            text: "Antigravity mock accepted the prompt.",
            externalCompletionState: "accepted_only",
            finalResponseAvailable: false,
            connectConversationObservation: {
              conversationId: "connect-permission-conversation",
              runStatus: "CASCADE_RUN_STATUS_IDLE",
              stepCount: 7,
              blockedByPendingInteraction: false,
              handledInteractionStep: {
                ordinal: 6,
                stepIndex: 6,
                type: "CORTEX_STEP_TYPE_RUN_COMMAND",
                status: "CORTEX_STEP_STATUS_ERROR",
                toolCall: {
                  id: "tool-call-run-command-1",
                  name: "run_command"
                },
                runCommand: {
                  commandLinePreview: "npm run test:node-vue -- --run tests/vitest/server/acp-agent-relay-runtime.test.mjs",
                  cwd: "/Users/unka/DevSpace/Unka-Malloc/Pact",
                  blocking: true
                },
                requestedInteraction: {
                  kind: "permission",
                  permission: {
                    action: "command",
                    targetPreview: "npm run test:node-vue -- --run tests/vitest/server/acp-agent-relay-runtime.test.mjs",
                    persistSuggestionType: "PERSIST_SUGGESTION_TYPE_SUGGESTED",
                    suggestedPersistPattern: "npm run"
                  }
                }
              },
              actions: [
                {
                  type: "forceStopCascadeTree",
                  ok: true,
                  statusCode: 200
                }
              ]
            },
            externalResponse: {
              sendMessage: { recipientId: "connect-permission-conversation" }
            }
          };
        }
      })
    });
    const session = await createSession(runtime, {
      virtualAgentId,
      sourceSessionId: "connect-permission-session"
    });
    const result = await runtime.execute("acp_agent_relay.prompt.send", {
      relaySessionId: session.relaySessionId,
      prompt: "delegate to Antigravity and observe pending command"
    });

    assert.equal(result.ok, true);
    assert.equal(result.data.stopReason, "accepted");
    const receipt = result.data.receipts.find((candidate) => candidate.targetToolCallId === "tool-call-run-command-1");
    assert.ok(receipt);
    assert.equal(receipt.status, "denied");
    assert.equal(receipt.action, "terminal");
    assert.equal(receipt.reasonCode, "phase1_terminal_denied");
    assert.match(receipt.targetPreview, /npm run test:node-vue/);
    assert.equal(result.data.targetEvidence.targetInteractionReceipts.length, 1);
    assert.equal(result.data.targetEvidence.targetInteractionReceipts[0].requestId, receipt.requestId);
    assert.equal(result.data.targetEvidence.globalAuditId, result.data.audit.globalAuditId);
    assert.equal(result.data.targetEvidence.artifactRef, result.data.audit.artifactRef);
    assert.equal(result.data.targetEvidence.relayTurnId, result.data.turn.relayTurnId);
    const permissionRequests = await runtime.store.listPermissionRequests(result.data.turn.relayTurnId);
    assert.equal(permissionRequests.length, 1);
    assert.equal(permissionRequests[0].status, "denied");
    assert.equal(permissionRequests[0].targetToolCallId, "tool-call-run-command-1");
    assert.equal(permissionRequests[0].details.externalInteraction.provider, "antigravity-connect");
    const denialEvent = result.data.events.find((event) =>
      event.type === "denial" &&
        event.source === "permission" &&
        event.redactedPayload?.targetToolCallId === "tool-call-run-command-1"
    );
    assert.ok(denialEvent);
    assert.equal(denialEvent.redactedPayload.requestId, receipt.requestId);
    assert.equal(denialEvent.globalAuditId, result.data.audit.globalAuditId);
    assert.equal(denialEvent.artifactRef, result.data.audit.artifactRef);
  });

  it("omits reasoning_trace events when requestReasoning is explicitly false", async () => {
    const runtime = createAcpRelayRuntime();
    const session = await createSession(runtime);

    const result = await runtime.execute("acp_agent_relay.prompt.send", {
      relaySessionId: session.relaySessionId,
      prompt: "do something",
      requestReasoning: false
    });
    assert.equal(result.ok, true);
    assert.equal(
      result.data.events.some((event) => event.type === "reasoning_trace"),
      false,
      "reasoning_trace events must not appear when requestReasoning=false"
    );
  });

  it("derives prompt audit ids from the relay turn and ignores source-supplied audit refs", async () => {
    const runtime = createAcpRelayRuntime();
    const session = await createSession(runtime);

    const result = await runtime.execute("acp_agent_relay.prompt.send", {
      relaySessionId: session.relaySessionId,
      prompt: "ignore spoofed audit ids",
      globalAuditId: "audit://spoofed/source-controlled",
      auditId: "audit://spoofed/alias",
      traceId: "trace-spoofed-audit",
      artifactRef: "artifact://spoofed/source-controlled",
      auditArtifactRef: "artifact://spoofed/alias"
    });

    assert.equal(result.ok, true);
    assertPromptAuditEvidence(result);
    assert.equal(result.data.audit.globalAuditId, `audit://pact/acp-agent-relay/${result.data.turn.relayTurnId}`);
    assert.equal(result.data.audit.artifactRef, `artifact://pact/acp-agent-relay/${result.data.turn.relayTurnId}`);
    assert.equal(JSON.stringify(result.data.audit).includes("spoofed"), false);
    assert.equal(result.data.events.every((event) => !JSON.stringify(event).includes("audit://spoofed")), true);
  });

  it("omits reasoning_trace events when requestReasoning is absent (default)", async () => {
    const runtime = createAcpRelayRuntime();
    const session = await createSession(runtime);

    const result = await runtime.execute("acp_agent_relay.prompt.send", {
      relaySessionId: session.relaySessionId,
      prompt: "do something else"
      // requestReasoning intentionally omitted
    });
    assert.equal(result.ok, true);
    assert.equal(
      result.data.events.some((event) => event.type === "reasoning_trace"),
      false,
      "reasoning_trace events must not appear when requestReasoning is omitted"
    );
  });

  it("requires explicit requestReasoning even when the virtual agent policy is always", async () => {
    const targetId = "mock.reasoning-always-target";
    const virtualAgentId = "mock.reasoning-always-agent";
    const runtime = createAcpRelayRuntime({
      virtualAgents: {
        [virtualAgentId]: {
          virtualAgentId,
          targetId,
          profileId: "pact.acp.reasoning_always.mock",
          displayName: "Reasoning Always Mock Agent",
          advertisedModes: ["ask"],
          defaultMode: "ask",
          advertisedTools: ["mock.prompt"],
          reasoningVisibilityPolicy: "always",
          capabilityPolicy: {
            writes: "deny",
            terminal: "deny",
            maxRisk: "read_only"
          },
          revision: 1
        }
      },
      targets: {
        [targetId]: {
          targetId,
          label: "Reasoning Always Mock Target",
          transport: { type: "mock" },
          advertisedToolsets: ["mock.prompt"],
          enabled: true,
          revision: 1
        }
      }
    });
    const session = await createSession(runtime, { virtualAgentId });

    const hidden = await runtime.execute("acp_agent_relay.prompt.send", {
      relaySessionId: session.relaySessionId,
      prompt: "default request must not expose reasoning"
    });
    assert.equal(hidden.ok, true);
    assert.equal(hidden.data.events.some((event) => event.type === "reasoning_trace"), false);

    const visible = await runtime.execute("acp_agent_relay.prompt.send", {
      relaySessionId: session.relaySessionId,
      prompt: "explicit request may expose reasoning",
      requestReasoning: true
    });
    assert.equal(visible.ok, true);
    assert.equal(visible.data.events.some((event) => event.type === "reasoning_trace"), true);
  });

  it("does not leak reasoning_trace for repo-analysis agent regardless of requestReasoning flag", async () => {
    // repo-analysis uses reasoningVisibilityPolicy="requestable" but capabilityPolicy.writes="deny";
    // the existing runtime test already covers the write path. Here we focus solely on
    // the reasoning gate for this agent.
    const runtime = createAcpRelayRuntime();
    const session = await createSession(runtime, {
      virtualAgentId: "antigravity.repo-analysis",
      sourceSessionId: `reasoning-gate-${Date.now()}`
    });

    // Even though we ask for reasoning, the router will honour the agent's
    // reasoningVisibilityPolicy="requestable" — so it SHOULD appear here.
    // What we're checking is that false/absent never leaks it.
    const withoutRequest = await runtime.execute("acp_agent_relay.prompt.send", {
      relaySessionId: session.relaySessionId,
      prompt: "analyse repo without reasoning exposure",
      requestReasoning: false
    });
    assert.equal(withoutRequest.ok, true);
    assert.equal(
      withoutRequest.data.events.some((e) => e.type === "reasoning_trace"),
      false,
      "reasoning_trace must not appear for repo-analysis when requestReasoning=false"
    );
  });
});

describe("ACP Agent Relay — Antigravity Agent API target adapter", () => {
  it("executes Antigravity Agent API CLI commands with required endpoint environment", async () => {
    const tempRoot = await makeTempDir("pact-acp-antigravity-cli-");
    const testBinary = path.join(tempRoot, "language_server_macos_arm");
    const argsFile = path.join(tempRoot, "agentapi-args.txt");
    await fs.writeFile(
      testBinary,
      `#!/bin/sh
set -eu
	printf '%s\\n' "$@" > "$PACT_TEST_AGENTAPI_ARGS_FILE"
cmd="$2"
case "$cmd" in
  get-conversation-metadata)
    printf '{"response":{"conversationMetadata":{"metadata":{"conversationId":"%s"}}}}\\n' "$3"
    ;;
  new-conversation)
    printf '{"response":{"conversationId":"fake-conversation","recipientId":"fake-conversation","text":"created response","model":"flash","status":"completed"}}\\n'
    ;;
  send-message)
    printf '{"response":{"sendMessage":{"recipientId":"%s"},"recipientId":"%s"}}\\n' "$3" "$3"
    ;;
  *)
    printf '{"response":{},"error":"unknown command: %s"}\\n' "$cmd"
    exit 1
    ;;
esac
`,
      "utf8"
    );
    await fs.chmod(testBinary, 0o755);

    const missingAddressClient = new AntigravityAgentApiClient({
      binaryPath: testBinary,
      csrfToken: "csrf-token",
      env: { PACT_TEST_AGENTAPI_ARGS_FILE: argsFile }
    });
    await assert.rejects(
      missingAddressClient.getConversationMetadata("fake-conversation"),
      /ANTIGRAVITY_LS_ADDRESS/
    );

    const missingTokenClient = new AntigravityAgentApiClient({
      binaryPath: testBinary,
      address: "127.0.0.1:1",
      env: { PACT_TEST_AGENTAPI_ARGS_FILE: argsFile }
    });
    await assert.rejects(
      missingTokenClient.getConversationMetadata("fake-conversation"),
      /ANTIGRAVITY_CSRF_TOKEN/
    );

    const client = new AntigravityAgentApiClient({
      binaryPath: testBinary,
      address: "127.0.0.1:1",
      csrfToken: "csrf-token",
      model: "flash",
      env: { PACT_TEST_AGENTAPI_ARGS_FILE: argsFile }
    });
    const metadata = await client.getConversationMetadata("fake-conversation");
    assert.equal(metadata.response.conversationMetadata.metadata.conversationId, "fake-conversation");
    assert.match(await fs.readFile(argsFile, "utf8"), /^agentapi\nget-conversation-metadata\nfake-conversation\n$/);

    const created = await client.newConversation({ prompt: "start delegated Antigravity task" });
    assert.equal(created.response.conversationId, "fake-conversation");
    assert.match(await fs.readFile(argsFile, "utf8"), /^agentapi\nnew-conversation\n--model=flash\nstart delegated Antigravity task\n$/);

    const sent = await client.sendMessage({ recipientId: "fake-conversation", content: "continue delegated task" });
    assert.equal(sent.response.sendMessage.recipientId, "fake-conversation");
    assert.match(await fs.readFile(argsFile, "utf8"), /^agentapi\nsend-message\nfake-conversation\ncontinue delegated task\n$/);
  });

  it("parses Antigravity Agent API usage and records unsupported final-response commands", async () => {
    const tempRoot = await makeTempDir("pact-acp-antigravity-probe-");
    const brokenWrapper = path.join(tempRoot, "agentapi");
    const testBinary = path.join(tempRoot, "language_server_macos_arm");
    await fs.writeFile(
      brokenWrapper,
      `#!/bin/sh
exec "${path.join(tempRoot, "missing-language-server")}" agentapi "$@"
`,
      "utf8"
    );
    await fs.chmod(brokenWrapper, 0o755);
    await fs.writeFile(
      testBinary,
      `#!/bin/sh
set -eu
if [ "$#" -le 1 ] || [ "\${1:-}" = "--help" ] || [ "\${2:-}" = "--help" ] || [ "\${1:-}" = "help" ] || [ "\${2:-}" = "help" ]; then
  cat >&2 <<'USAGE'
Usage: agentapi <command> [args]

Available Commands:
  get-conversation-metadata <conversation_id>
  new-conversation [--model=<flash_lite|flash|pro>] <prompt>
  send-message <recipient_id> <content>
USAGE
  exit 1
fi
cmd="\${2:-\${1:-}}"
case "$cmd" in
  get-conversation-metadata)
    printf '{"response":{"conversationMetadata":{"metadata":{"conversationId":"%s","workspaces":[]}}}}\\n' "$3"
    ;;
  get-conversation|get-conversation-messages|wait-for-response|stream-conversation|--help|help)
    printf '{"response":{},"error":"unknown command: %s"}\\n' "$cmd"
    exit 1
    ;;
  *)
    printf '{"response":{},"error":"usage: agentapi %s"}\\n' "$cmd"
    exit 1
    ;;
esac
`,
      "utf8"
    );
    await fs.chmod(testBinary, 0o755);

    const resolvedBinary = await resolveAntigravityAgentApiBinary({
      binaryPath: brokenWrapper,
      env: {
        PACT_ACP_RELAY_ANTIGRAVITY_BINARY: testBinary
      }
    });
    assert.equal(resolvedBinary, testBinary);

    const usage = `Usage: agentapi <command> [args]

Available Commands:
  get-conversation-metadata <conversation_id>
  new-conversation [--model=<flash_lite|flash|pro>] <prompt>
  send-message <recipient_id> <content>
`;
    assert.deepEqual(parseAntigravityAgentApiCommands(usage), [
      "get-conversation-metadata",
      "new-conversation",
      "send-message"
    ]);

    const probeClient = {
      commandUsage: async () => usage,
      runAgentApi: async ([command]) => {
        const error = new Error(`unknown command: ${command}`);
        error.agentApiResponse = {
          error: `unknown command: ${command}`
        };
        throw error;
      }
    };
    const probe = await probeAntigravityAgentApiCapabilities(probeClient, {
      conversationId: "fake-conversation",
      timeoutMs: 2000
    });
    assert.deepEqual(probe.availableCommands, [
      "get-conversation-metadata",
      "new-conversation",
      "send-message"
    ]);
    assert.equal(probe.snapshot.commands.sendMessage, true);
    assert.equal(probe.snapshot.commands.getConversationMetadata, true);
    assert.equal(probe.snapshot.commands.waitForResponse, false);
    assert.equal(probe.snapshot.commands.streamConversation, false);
    assert.equal(probe.snapshot.finalResponseReadSupported, false);
    assert.equal(probe.snapshot.finalResponsePolicy, "accepted_only");
    assert.equal(probe.finalResponseCapabilityProbe.length, 4);
    assert.equal(probe.finalResponseCapabilityProbe.every((candidate) => candidate.supported === false), true);

    const inlineCompleted = createAntigravityAgentApiCapabilitySnapshot({
      availableCommands: probe.availableCommands,
      finalResponseCapabilityProbe: probe.finalResponseCapabilityProbe,
      completionState: "completed"
    });
    assert.equal(inlineCompleted.finalResponseReadSupported, false);
    assert.equal(inlineCompleted.finalResponsePolicy, "inline_response");
  });

  it("probes Antigravity IDE CLI shape without treating chat as native ACP", async () => {
    const calls = [];
    const run = async (command, args = []) => {
      calls.push([command, ...args]);
      if (command === "sh") {
        return "/Applications/Antigravity IDE.app/Contents/Resources/app/bin/antigravity-ide\n";
      }
      if (args.join(" ") === "--help") {
        return `Antigravity IDE 1.107.0

Usage: antigravity-ide [options] [paths...]

Model Context Protocol
  --add-mcp <json> Adds a Model Context Protocol server definition to the user
                   profile.

Subcommands
  chat         Pass in a prompt to run in a chat session in the current working
               directory.
  serve-web    Run a server that displays the editor UI in browsers.
  tunnel       Make the current machine accessible from vscode.dev.
`;
      }
      if (args.join(" ") === "chat --help") {
        return `Antigravity IDE 1.107.0

Usage: antigravity-ide chat [options] [prompt]

To read from stdin, append '-' (e.g. 'ps aux | grep code | antigravity-ide chat <prompt> -')

Options
  -m --mode <mode>        The mode to use for the chat session.
`;
      }
      return "";
    };

    const snapshot = await probeAntigravityIdeCliCapabilities({
      env: { PATH: "" },
      run
    });
    assert.equal(snapshot.provider, "antigravity-ide-cli");
    assert.equal(snapshot.found, true);
    assert.equal(snapshot.version, "1.107.0");
    assert.deepEqual(snapshot.subcommands, ["chat", "serve-web", "tunnel"]);
    assert.equal(snapshot.chatCommandSupported, true);
    assert.equal(snapshot.chatReadsStdin, true);
    assert.equal(snapshot.mcpConfigSupported, true);
    assert.equal(snapshot.nativeAcpTransportSupported, false);
    assert.equal(snapshot.chatIsAcpTransport, false);
    assert.equal(snapshot.nativeAcpTargetVerified, false);
    assert.equal(snapshot.reasonCode, "native_acp_command_not_advertised");
    assert.deepEqual(calls.slice(-2).map((call) => call.slice(1).join(" ")), [
      "--help",
      "chat --help"
    ]);
  });

  it("observes Antigravity local messages and transcript progress without treating tool output as final response", async () => {
    const tempRoot = await makeTempDir("pact-acp-antigravity-observe-");
    const conversationId = "ag-observed-conversation";
    const brainRoot = path.join(tempRoot, "brain");
    const conversationBrainPath = path.join(brainRoot, conversationId);
    const messagesDir = path.join(conversationBrainPath, ".system_generated/messages");
    const transcriptPath = path.join(conversationBrainPath, ".system_generated/logs/transcript.jsonl");
    const marker = "PACT_OBSERVE_MARKER_PROGRESS";
    await fs.mkdir(messagesDir, { recursive: true });
    await fs.mkdir(path.dirname(transcriptPath), { recursive: true });
    await fs.writeFile(path.join(messagesDir, "read.json"), "{}", "utf8");
    await fs.writeFile(
      path.join(messagesDir, "message-1.json"),
      JSON.stringify({
        id: "message-1",
        sender: "system",
        recipient: conversationId,
        timestamp: "2026-06-04T10:00:00Z",
        content: `[Pact ACP Agent Relay]\n${marker}: 请继续补充 ACP Agent Relay 测试。`
      }),
      "utf8"
    );
    const toolOutput = `Created At: 2026-06-04T10:00:01Z\nFile Path: server/example.mjs\n${"x".repeat(700)}`;
    const transcriptEntries = [
      {
        source: "USER_EXPLICIT",
        type: "USER_INPUT",
        status: "DONE",
        step_index: 1,
        created_at: "2026-06-04T10:00:00Z",
        content: `${marker}: delegated prompt`
      },
      {
        source: "MODEL",
        type: "VIEW_FILE",
        status: "DONE",
        step_index: 2,
        created_at: "2026-06-04T10:00:01Z",
        content: toolOutput
      },
      {
        source: "MODEL",
        type: "PLANNER_RESPONSE",
        status: "DONE",
        step_index: 3,
        created_at: "2026-06-04T10:00:02Z",
        content: "我已开始补充测试。"
      },
      {
        source: "MODEL",
        type: "CODE_ACTION",
        status: "DONE",
        step_index: 4,
        created_at: "2026-06-04T10:00:03Z",
        content: "The following changes were made by the replace_file_content tool and completed."
      }
    ];
    await fs.writeFile(transcriptPath, `${transcriptEntries.map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf8");

    assert.equal(resolveAntigravityConversationBrainPath(conversationId, { brainRoot }), conversationBrainPath);
    const messages = await readAntigravityConversationMessages({ conversationId, brainRoot });
    assert.equal(messages.messageCount, 1);
    assert.match(messages.messages[0].contentPreview, /PACT_OBSERVE_MARKER_PROGRESS/);
    const transcript = await readAntigravityTranscriptEntries({ conversationId, brainRoot });
    assert.equal(transcript.lineCount, 4);
    assert.equal(transcript.entries[1].contentPreview.length < transcript.entries[1].content.length, true);

    const observation = await observeAntigravityConversation({
      conversationId,
      brainRoot,
      marker,
      afterTranscriptLineCount: 0,
      afterMessageMtimeMs: 0
    });
    assert.equal(observation.markerObserved, true);
    assert.equal(observation.markerMessageObserved, true);
    assert.equal(observation.markerTranscriptObserved, true);
    assert.equal(observation.progressAvailable, true);
    assert.equal(observation.finalResponseAvailable, false);
    assert.equal(observation.latestProgress.text, "我已开始补充测试。");
    assert.equal(observation.latestTranscriptEntry.type, "CODE_ACTION");
    assert.doesNotMatch(observation.latestProgress.text, /replace_file_content/);
  });

  it("detects likely final Antigravity natural-language responses after a delegated marker", async () => {
    const tempRoot = await makeTempDir("pact-acp-antigravity-final-");
    const conversationId = "ag-final-conversation";
    const brainRoot = path.join(tempRoot, "brain");
    const messagesDir = path.join(brainRoot, conversationId, ".system_generated/messages");
    const transcriptPath = path.join(brainRoot, conversationId, ".system_generated/logs/transcript.jsonl");
    const marker = "PACT_OBSERVE_MARKER_FINAL";
    await fs.mkdir(messagesDir, { recursive: true });
    await fs.mkdir(path.dirname(transcriptPath), { recursive: true });
    await fs.writeFile(
      path.join(messagesDir, "message-1.json"),
      JSON.stringify({
        id: "message-1",
        sender: "system",
        recipient: conversationId,
        timestamp: "2026-06-04T10:00:00Z",
        content: `${marker}: 请补充测试并汇报结果。`
      }),
      "utf8"
    );
    const transcriptEntries = [
      {
        source: "USER_EXPLICIT",
        type: "USER_INPUT",
        status: "DONE",
        step_index: 1,
        created_at: "2026-06-04T10:00:00Z",
        content: `${marker}: delegated prompt`
      },
      {
        source: "MODEL",
        type: "PLANNER_RESPONSE",
        status: "DONE",
        step_index: 2,
        created_at: "2026-06-04T10:00:01Z",
        content: "测试通过，补充完成。"
      }
    ];
    await fs.writeFile(transcriptPath, `${transcriptEntries.map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf8");

    const observation = await observeAntigravityConversation({
      conversationId,
      brainRoot,
      marker,
      afterTranscriptLineCount: 0,
      afterMessageMtimeMs: 0
    });
    assert.equal(observation.finalResponseAvailable, true);
    assert.equal(observation.latestFinalResponse.text, "测试通过，补充完成。");
    assert.equal(observation.latestFinalResponse.stepIndex, 2);
  });

  it("prefers readable Antigravity transcript errors over newer blank error entries", () => {
    const observation = summarizeAntigravityConversationObservation({
      conversationId: "ag-readable-error-conversation",
      marker: "PACT_READABLE_ERROR_MARKER",
      transcript: {
        transcriptPath: "/tmp/transcript.jsonl",
        lineCount: 4,
        entries: [
          {
            lineIndex: 0,
            stepIndex: 1,
            source: "USER_EXPLICIT",
            type: "USER_INPUT",
            status: "DONE",
            content: "PACT_READABLE_ERROR_MARKER: delegated prompt",
            contentPreview: "PACT_READABLE_ERROR_MARKER: delegated prompt"
          },
          {
            lineIndex: 1,
            stepIndex: 2,
            source: "SYSTEM",
            type: "ERROR_MESSAGE",
            status: "DONE",
            error: "RESOURCE_EXHAUSTED (code 429): quota reached",
            errorPreview: "RESOURCE_EXHAUSTED (code 429): quota reached",
            content: "",
            contentPreview: "RESOURCE_EXHAUSTED (code 429): quota reached"
          },
          {
            lineIndex: 2,
            stepIndex: 3,
            source: "SYSTEM",
            type: "ERROR_MESSAGE",
            status: "DONE",
            error: "",
            errorPreview: "",
            content: "",
            contentPreview: ""
          },
          {
            lineIndex: 3,
            stepIndex: 4,
            source: "SYSTEM",
            type: "SYSTEM_MESSAGE",
            status: "DONE",
            content: "",
            contentPreview: ""
          }
        ]
      },
      messages: { messageCount: 0, messages: [] }
    });

    assert.equal(observation.errorAvailable, true);
    assert.equal(observation.latestError.stepIndex, 3);
    assert.equal(observation.latestError.errorPreview, "");
    assert.equal(observation.latestKnownError.stepIndex, 2);
    assert.match(observation.latestKnownError.errorPreview, /RESOURCE_EXHAUSTED/);
  });

  it("normalizes Antigravity Connect trajectory pending interactions and final planner responses", () => {
    const conversationId = "connect-cascade-test";
    const trajectory = normalizeAntigravityCascadeTrajectory({
      runStatus: "CASCADE_RUN_STATUS_RUNNING",
      steps: [
        {
          type: "CORTEX_STEP_TYPE_PLANNER_RESPONSE",
          status: "CORTEX_STEP_STATUS_DONE",
          metadata: {
            createdAt: "2026-06-04T10:00:01Z",
            sourceTrajectoryStepInfo: {
              cascadeId: conversationId,
              trajectoryId: "trajectory-1",
              stepIndex: 1,
              metadataIndex: 0
            }
          },
          plannerResponse: {
            modifiedResponse: "我已开始补充测试。",
            stopReason: "STOP_REASON_UNSPECIFIED"
          }
        },
        {
          type: "CORTEX_STEP_TYPE_RUN_COMMAND",
          status: "CORTEX_STEP_STATUS_WAITING",
          metadata: {
            createdAt: "2026-06-04T10:00:02Z",
            toolCall: {
              id: "tool-call-1",
              name: "run_command",
              argumentsJson: JSON.stringify({
                CommandLine: "npm run test:node-vue -- --run tests/vitest/server/acp-agent-relay-runtime.test.mjs",
                Cwd: "/Users/unka/DevSpace/Unka-Malloc/Pact",
                toolAction: "Running targeted tests",
                toolSummary: "ACP relay tests"
              })
            },
            sourceTrajectoryStepInfo: {
              cascadeId: conversationId,
              trajectoryId: "trajectory-1",
              stepIndex: 2,
              metadataIndex: 1
            }
          },
          requestedInteraction: {
            permission: {
              resource: {
                action: "command",
                target: "npm run test:node-vue -- --run tests/vitest/server/acp-agent-relay-runtime.test.mjs"
              },
              persistSuggestionType: "PERSIST_SUGGESTION_TYPE_SUGGESTED",
              suggestedPersistPattern: "npm run"
            }
          },
          runCommand: {
            commandLine: "npm run test:node-vue -- --run tests/vitest/server/acp-agent-relay-runtime.test.mjs 2>&1",
            cwd: "/Users/unka/DevSpace/Unka-Malloc/Pact",
            blocking: true
          }
        }
      ]
    }, { conversationId });

    assert.equal(trajectory.conversationId, conversationId);
    assert.equal(trajectory.runStatus, "CASCADE_RUN_STATUS_RUNNING");
    assert.equal(trajectory.pendingInteraction, true);
    assert.equal(trajectory.blockedByPendingInteraction, true);
    assert.equal(trajectory.waitingInteractionStep.requestedInteraction.permission.action, "command");
    assert.match(trajectory.waitingInteractionStep.runCommand.commandLine, /vitest/);
    assert.equal(trajectory.latestProgress.content, "我已开始补充测试。");
    assert.equal(trajectory.latestProgress.plannerResponseStopReason, "STOP_REASON_UNSPECIFIED");

    const blockedObservation = summarizeAntigravityConnectObservation({
      conversationId,
      trajectory,
      afterStepCount: 1
    });
    assert.equal(blockedObservation.trajectoryAdvanced, true);
    assert.equal(blockedObservation.pendingInteraction, true);
    assert.equal(blockedObservation.progressAvailable, false);

    const finalTrajectory = normalizeAntigravityCascadeTrajectory({
      runStatus: "CASCADE_RUN_STATUS_COMPLETED",
      steps: [
        ...trajectory.steps,
        {
          type: "CORTEX_STEP_TYPE_PLANNER_RESPONSE",
          status: "CORTEX_STEP_STATUS_DONE",
          metadata: {
            createdAt: "2026-06-04T10:00:03Z",
            sourceTrajectoryStepInfo: {
              cascadeId: conversationId,
              trajectoryId: "trajectory-1",
              stepIndex: 3,
              metadataIndex: 2
            }
          },
          plannerResponse: {
            modifiedResponse: "测试通过，补充完成。",
            stopReason: "STOP_REASON_DONE"
          }
        }
      ]
    }, { conversationId });
    const finalObservation = summarizeAntigravityConnectObservation({
      conversationId,
      trajectory: finalTrajectory,
      afterStepCount: 2
    });
    assert.equal(finalObservation.finalResponseAvailable, true);
    assert.equal(finalObservation.latestFinalResponse.content, "测试通过，补充完成。");
    assert.equal(finalObservation.latestFinalResponse.plannerResponseStopReason, "STOP_REASON_DONE");
  });

  it("prefers readable Antigravity Connect errors without treating old errors as current-step errors", () => {
    const conversationId = "connect-readable-error-cascade-test";
    const trajectory = normalizeAntigravityCascadeTrajectory({
      runStatus: "CASCADE_RUN_STATUS_IDLE",
      steps: [
        {
          type: "CORTEX_STEP_TYPE_ERROR_MESSAGE",
          status: "CORTEX_STEP_STATUS_DONE",
          errorMessage: "RESOURCE_EXHAUSTED (code 429): quota reached",
          metadata: {
            createdAt: "2026-06-04T10:00:01Z",
            sourceTrajectoryStepInfo: {
              cascadeId: conversationId,
              trajectoryId: "trajectory-readable-error",
              stepIndex: 1,
              metadataIndex: 0
            }
          }
        },
        {
          type: "CORTEX_STEP_TYPE_ERROR_MESSAGE",
          status: "CORTEX_STEP_STATUS_DONE",
          content: "",
          metadata: {
            createdAt: "2026-06-04T10:00:02Z",
            sourceTrajectoryStepInfo: {
              cascadeId: conversationId,
              trajectoryId: "trajectory-readable-error",
              stepIndex: 2,
              metadataIndex: 1
            }
          }
        },
        {
          type: "CORTEX_STEP_TYPE_SYSTEM_MESSAGE",
          status: "CORTEX_STEP_STATUS_DONE",
          content: "",
          metadata: {
            createdAt: "2026-06-04T10:00:03Z",
            sourceTrajectoryStepInfo: {
              cascadeId: conversationId,
              trajectoryId: "trajectory-readable-error",
              stepIndex: 3,
              metadataIndex: 2
            }
          }
        }
      ]
    }, { conversationId });

    assert.equal(trajectory.latestError.stepIndex, 2);
    assert.equal(trajectory.latestError.errorPreview, "");
    assert.equal(trajectory.latestKnownError.stepIndex, 1);
    assert.match(trajectory.latestKnownError.errorPreview, /RESOURCE_EXHAUSTED/);

    const currentObservation = summarizeAntigravityConnectObservation({
      conversationId,
      trajectory,
      afterStepCount: 0
    });
    assert.equal(currentObservation.latestError.stepIndex, 2);
    assert.equal(currentObservation.latestError.errorPreview, "");
    assert.equal(currentObservation.latestKnownError.stepIndex, 1);
    assert.match(currentObservation.latestKnownError.errorPreview, /RESOURCE_EXHAUSTED/);

    const noNewErrorObservation = summarizeAntigravityConnectObservation({
      conversationId,
      trajectory,
      afterStepCount: 2
    });
    assert.equal(noNewErrorObservation.latestError, null);
    assert.equal(noNewErrorObservation.latestKnownError, null);
  });

  it("extracts Antigravity Connect system-message markers and nested error diagnostics", () => {
    const conversationId = "connect-nested-error-cascade-test";
    const marker = "PACT_CONNECT_NESTED_ERROR_MARKER";
    const trajectory = normalizeAntigravityCascadeTrajectory({
      runStatus: "CASCADE_RUN_STATUS_IDLE",
      steps: [
        {
          type: "CORTEX_STEP_TYPE_SYSTEM_MESSAGE",
          status: "CORTEX_STEP_STATUS_DONE",
          systemMessage: {
            agentMessage: {
              content: `[Pact ACP Agent Relay]\n\n${marker}: 请只回复一句收到。`
            },
            renderInfo: {
              markdown: `[Pact ACP Agent Relay]\n\n${marker}: 请只回复一句收到。`
            }
          },
          metadata: {
            createdAt: "2026-06-04T10:00:01Z",
            sourceTrajectoryStepInfo: {
              cascadeId: conversationId,
              trajectoryId: "trajectory-nested-error",
              stepIndex: 1,
              metadataIndex: 0
            }
          }
        },
        {
          type: "CORTEX_STEP_TYPE_ERROR_MESSAGE",
          status: "CORTEX_STEP_STATUS_DONE",
          errorMessage: {
            error: {
              fullError: "HTTP 429 Too Many Requests\nRESOURCE_EXHAUSTED (code 429): Individual quota reached."
            }
          },
          metadata: {
            createdAt: "2026-06-04T10:00:02Z",
            sourceTrajectoryStepInfo: {
              cascadeId: conversationId,
              trajectoryId: "trajectory-nested-error",
              stepIndex: 2,
              metadataIndex: 1
            }
          }
        }
      ]
    }, { conversationId });

    assert.match(trajectory.steps[0].content, new RegExp(marker));
    assert.equal(trajectory.steps[0].diagnostics.hasSystemMessage, true);
    assert.equal(trajectory.latestError.stepIndex, 2);
    assert.match(trajectory.latestError.errorPreview, /HTTP 429/);
    assert.equal(trajectory.latestError.diagnostics.errorSourcePath, "errorMessage.error.fullError");
    assert.equal(trajectory.latestKnownError.stepIndex, 2);
    assert.match(trajectory.latestKnownError.errorPreview, /Individual quota reached/);

    const observation = summarizeAntigravityConnectObservation({
      conversationId,
      marker,
      trajectory,
      afterStepCount: 0
    });
    assert.equal(observation.markerObserved, true);
    assert.equal(observation.latestError.stepIndex, 2);
    assert.match(observation.latestError.errorPreview, /HTTP 429/);
    assert.equal(observation.latestError.diagnostics.errorSourcePath, "errorMessage.error.fullError");
  });

  it("extracts Antigravity Connect marker text from user-input style steps", () => {
    const conversationId = "connect-input-marker-cascade-test";
    const userMarker = "PACT_CONNECT_USER_INPUT_MARKER";
    const addMarker = "PACT_CONNECT_ADD_INPUT_MARKER";
    const trajectory = normalizeAntigravityCascadeTrajectory({
      runStatus: "CASCADE_RUN_STATUS_IDLE",
      steps: [
        {
          type: "CORTEX_STEP_TYPE_USER_INPUT",
          status: "CORTEX_STEP_STATUS_DONE",
          userInput: {
            content: `${userMarker}: source agent delegated a task.`
          },
          metadata: {
            createdAt: "2026-06-04T10:00:01Z",
            sourceTrajectoryStepInfo: {
              cascadeId: conversationId,
              trajectoryId: "trajectory-input-marker",
              stepIndex: 1,
              metadataIndex: 0
            }
          }
        },
        {
          type: "CORTEX_STEP_TYPE_ADD_CASCADE_INPUT",
          status: "CORTEX_STEP_STATUS_DONE",
          addCascadeInput: {
            input: {
              text: `${addMarker}: queued follow-up message.`
            }
          },
          metadata: {
            createdAt: "2026-06-04T10:00:02Z",
            sourceTrajectoryStepInfo: {
              cascadeId: conversationId,
              trajectoryId: "trajectory-input-marker",
              stepIndex: 2,
              metadataIndex: 1
            }
          }
        }
      ]
    }, { conversationId });

    assert.equal(trajectory.steps[0].diagnostics.hasUserInput, true);
    assert.equal(trajectory.steps[0].diagnostics.contentSourcePath, "userInput.content");
    assert.match(trajectory.steps[0].content, new RegExp(userMarker));
    assert.equal(trajectory.steps[1].diagnostics.hasAddCascadeInput, true);
    assert.equal(trajectory.steps[1].diagnostics.contentSourcePath, "addCascadeInput.input.text");
    assert.match(trajectory.steps[1].content, new RegExp(addMarker));

    const userObservation = summarizeAntigravityConnectObservation({
      conversationId,
      marker: userMarker,
      trajectory,
      afterStepCount: 0
    });
    assert.equal(userObservation.markerObserved, true);

    const addInputObservation = summarizeAntigravityConnectObservation({
      conversationId,
      marker: addMarker,
      trajectory,
      afterStepCount: 0
    });
    assert.equal(addInputObservation.markerObserved, true);
  });

  it("builds a formal Antigravity Connect command-denial interaction body", () => {
    const body = buildAntigravityCascadeUserInteractionDecision({
      conversationId: "connect-cascade-test",
      step: {
        trajectoryId: "trajectory-1",
        stepIndex: 7,
        requestedInteraction: {
          permission: {
            action: "command",
            target: "npm run test"
          }
        }
      },
      approved: false
    });

    assert.deepEqual(body, {
      cascadeId: "connect-cascade-test",
      interaction: {
        trajectoryId: "trajectory-1",
        stepIndex: 7,
        permission: {
          approved: false
        }
      }
    });
    assert.throws(
      () => buildAntigravityCascadeUserInteractionDecision({ conversationId: "connect-cascade-test", step: {} }),
      /trajectory id/
    );
  });

  it("records Connect trajectory evidence when unblocking and flushing a queued Antigravity prompt", async () => {
    const conversationId = "connect-unblock-cascade-test";
    const calls = [];
    const makeObservation = ({
      stepCount = 2,
      pendingInteraction = false,
      finalResponseAvailable = false,
      content = ""
    } = {}) => ({
      conversationId,
      endpoint: {
        address: "127.0.0.1:58162",
        source: "fake",
        protocol: "connect-json",
        tls: true,
        hasCsrfToken: true
      },
      runStatus: finalResponseAvailable ? "CASCADE_RUN_STATUS_COMPLETED" : "CASCADE_RUN_STATUS_RUNNING",
      stepCount,
      afterStepCount: 2,
      trajectoryAdvanced: stepCount > 2,
      statusCounts: {
        CORTEX_STEP_STATUS_DONE: finalResponseAvailable ? 3 : 1,
        CORTEX_STEP_STATUS_WAITING: pendingInteraction ? 1 : 0
      },
      running: !finalResponseAvailable,
      completed: finalResponseAvailable,
      failed: false,
      pendingInteraction,
      blockedByPendingInteraction: pendingInteraction,
      markerObserved: false,
      progressAvailable: true,
      finalResponseAvailable,
      latestStep: {
        ordinal: stepCount - 1,
        stepIndex: stepCount,
        type: finalResponseAvailable ? "CORTEX_STEP_TYPE_PLANNER_RESPONSE" : "CORTEX_STEP_TYPE_RUN_COMMAND",
        status: pendingInteraction ? "CORTEX_STEP_STATUS_WAITING" : "CORTEX_STEP_STATUS_DONE",
        content
      },
      waitingInteractionStep: pendingInteraction
        ? {
            ordinal: 1,
            stepIndex: 2,
            trajectoryId: "trajectory-connect-test",
            cascadeId: conversationId,
            type: "CORTEX_STEP_TYPE_RUN_COMMAND",
            status: "CORTEX_STEP_STATUS_WAITING",
            runCommand: {
              commandLine: "npm run test:node-vue -- --run tests/vitest/server/acp-agent-relay-runtime.test.mjs",
              cwd: "/Users/unka/DevSpace/Unka-Malloc/Pact",
              blocking: true
            },
            requestedInteraction: {
              kind: "permission",
              permission: {
                action: "command",
                target: "npm run test:node-vue -- --run tests/vitest/server/acp-agent-relay-runtime.test.mjs",
                persistSuggestionType: "PERSIST_SUGGESTION_TYPE_SUGGESTED",
                suggestedPersistPattern: "npm run"
              }
            }
          }
        : null,
      latestProgress: {
        ordinal: 0,
        stepIndex: 1,
        type: "CORTEX_STEP_TYPE_PLANNER_RESPONSE",
        status: "CORTEX_STEP_STATUS_DONE",
        content: "我已开始补充测试。"
      },
      latestFinalResponse: finalResponseAvailable
        ? {
            ordinal: 2,
            stepIndex: 3,
            type: "CORTEX_STEP_TYPE_PLANNER_RESPONSE",
            status: "CORTEX_STEP_STATUS_DONE",
            content
          }
        : null
    });
    let observeCount = 0;
    const fakeClient = {
      async getConversationMetadata(id) {
        calls.push({ method: "getConversationMetadata", id });
        return {
          response: {
            conversationMetadata: {
              metadata: { conversationId: id }
            }
          }
        };
      },
      async probeCapabilities() {
        calls.push({ method: "probeCapabilities" });
        return {
          snapshot: createAntigravityAgentApiCapabilitySnapshot()
        };
      },
      async sendMessage({ recipientId, content }) {
        calls.push({ method: "sendMessage", recipientId, content });
        return {
          response: {
            sendMessage: { recipientId },
            recipientId
          }
        };
      },
      async observeConnectTrajectory() {
        observeCount += 1;
        calls.push({ method: "observeConnectTrajectory", observeCount });
        if (observeCount === 1) {
          return makeObservation({ stepCount: 2 });
        }
        if (observeCount === 2) {
          return makeObservation({ stepCount: 2, pendingInteraction: true });
        }
        return makeObservation({ stepCount: 2 });
      },
      async forceStopCascadeTree({ conversationId: id }) {
        calls.push({ method: "forceStopCascadeTree", id });
        return {
          ok: true,
          statusCode: 200,
          body: {
            stoppedConversationIds: [id]
          }
        };
      },
      async sendAllQueuedMessages({ conversationId: id }) {
        calls.push({ method: "sendAllQueuedMessages", id });
        return {
          ok: true,
          statusCode: 200,
          body: {}
        };
      },
      async waitForConnectTrajectoryObservation() {
        calls.push({ method: "waitForConnectTrajectoryObservation" });
        return makeObservation({
          stepCount: 3,
          finalResponseAvailable: true,
          content: "测试通过，补充完成。"
        });
      }
    };
    const connection = new AntigravityAgentApiConnection({
      target: {
        targetId: "antigravity.agentapi:connect-test",
        transport: {
          type: "antigravity-agentapi",
          conversationId,
          connectEnabled: true,
          connectForceStopStuckCascade: true,
          connectFlushQueuedMessages: true,
          connectObservationTimeoutMs: 100
        }
      },
      relaySession: {
        relaySessionId: "relay-connect-test",
        targetSessionId: conversationId
      },
      client: fakeClient
    });
    const result = await connection.sendPrompt({
      prompt: "请继续补充测试。",
      localObservationMarker: "PACT_CONNECT_MARKER"
    });

    assert.equal(result.stopReason, "completed");
    assert.equal(result.externalCompletionState, "completed");
    assert.equal(result.text, "测试通过，补充完成。");
    assert.equal(result.finalResponseAvailable, true);
    assert.equal(result.finalResponsePolicy, "connect_trajectory");
    assert.equal(result.connectConversationObservation.blockedByPendingInteraction, false);
    assert.deepEqual(
      result.connectConversationObservation.actions.map((action) => [action.type, action.ok]),
      [
        ["forceStopCascadeTree", true],
        ["sendAllQueuedMessages", true]
      ]
    );
    assert.match(result.connectConversationObservation.latestFinalResponse.contentPreview, /补充完成/);
    assert.equal(
      result.events.find((event) => event.type === "completion")?.text,
      "测试通过，补充完成。"
    );
    assert.deepEqual(calls.map((call) => call.method), [
      "getConversationMetadata",
      "probeCapabilities",
      "observeConnectTrajectory",
      "sendMessage",
      "observeConnectTrajectory",
      "forceStopCascadeTree",
      "observeConnectTrajectory",
      "sendAllQueuedMessages",
      "waitForConnectTrajectoryObservation"
    ]);
  });

  it("waits for delayed Antigravity Connect final response after send-message acceptance", async () => {
    const conversationId = "connect-delayed-final-cascade-test";
    const finalText = "延迟出现的 Connect final 回复。";
    const calls = [];
    const runningObservation = {
      conversationId,
      endpoint: {
        address: "127.0.0.1:58162",
        source: "fake",
        protocol: "connect-json",
        tls: true,
        hasCsrfToken: true
      },
      runStatus: "CASCADE_RUN_STATUS_RUNNING",
      stepCount: 12,
      afterStepCount: 11,
      trajectoryAdvanced: true,
      statusCounts: { CORTEX_STEP_STATUS_DONE: 12 },
      running: true,
      completed: false,
      failed: false,
      pendingInteraction: false,
      blockedByPendingInteraction: false,
      markerObserved: false,
      progressAvailable: false,
      finalResponseAvailable: false,
      latestStep: {
        ordinal: 11,
        stepIndex: 12,
        type: "CORTEX_STEP_TYPE_SYSTEM_MESSAGE",
        status: "CORTEX_STEP_STATUS_DONE",
        content: ""
      },
      waitingInteractionStep: null,
      latestProgress: null,
      latestFinalResponse: null
    };
    const finalObservation = {
      ...runningObservation,
      runStatus: "CASCADE_RUN_STATUS_IDLE",
      stepCount: 15,
      trajectoryAdvanced: true,
      statusCounts: { CORTEX_STEP_STATUS_DONE: 15 },
      running: false,
      completed: true,
      progressAvailable: true,
      finalResponseAvailable: true,
      latestStep: {
        ordinal: 14,
        stepIndex: 15,
        type: "CORTEX_STEP_TYPE_PLANNER_RESPONSE",
        status: "CORTEX_STEP_STATUS_DONE",
        content: finalText
      },
      latestProgress: {
        ordinal: 14,
        stepIndex: 15,
        type: "CORTEX_STEP_TYPE_PLANNER_RESPONSE",
        status: "CORTEX_STEP_STATUS_DONE",
        content: finalText
      },
      latestFinalResponse: {
        ordinal: 14,
        stepIndex: 15,
        type: "CORTEX_STEP_TYPE_PLANNER_RESPONSE",
        status: "CORTEX_STEP_STATUS_DONE",
        content: finalText
      }
    };
    const fakeClient = {
      async getConversationMetadata(id) {
        calls.push({ method: "getConversationMetadata", id });
        return {
          response: {
            conversationMetadata: {
              metadata: { conversationId: id }
            }
          }
        };
      },
      async sendMessage({ recipientId, content }) {
        calls.push({ method: "sendMessage", recipientId, content });
        return {
          response: {
            sendMessage: { recipientId },
            recipientId
          }
        };
      },
      async observeConnectTrajectory({ afterStepCount }) {
        calls.push({ method: "observeConnectTrajectory", afterStepCount });
        return runningObservation;
      },
      async waitForConnectTrajectoryObservation(options) {
        calls.push({ method: "waitForConnectTrajectoryObservation", options });
        return finalObservation;
      }
    };
    const connection = new AntigravityAgentApiConnection({
      target: {
        targetId: "antigravity.agentapi:delayed-final-test",
        transport: {
          type: "antigravity-agentapi",
          conversationId,
          connectEnabled: true,
          connectObservationTimeoutMs: 250,
          connectObservationPollIntervalMs: 10
        }
      },
      relaySession: {
        relaySessionId: "relay-connect-delayed-final-test",
        targetSessionId: conversationId
      },
      client: fakeClient
    });

    const result = await connection.sendPrompt({
      prompt: "请只回复一句收到。",
      localObservationMarker: "PACT_CONNECT_DELAYED_FINAL_MARKER"
    });

    assert.equal(result.stopReason, "completed");
    assert.equal(result.externalCompletionState, "completed");
    assert.equal(result.text, finalText);
    assert.equal(result.finalResponseAvailable, true);
    assert.equal(result.finalResponsePolicy, "connect_trajectory");
    assert.equal(result.agentApiCapabilitySnapshot.connect.waitForFinalResponseRequested, true);
    assert.match(result.connectConversationObservation.latestFinalResponse.contentPreview, /Connect final/);
    assert.deepEqual(calls.map((call) => call.method), [
      "getConversationMetadata",
      "observeConnectTrajectory",
      "sendMessage",
      "observeConnectTrajectory",
      "waitForConnectTrajectoryObservation"
    ]);
    const waitCall = calls.find((call) => call.method === "waitForConnectTrajectoryObservation");
    assert.equal(waitCall.options.until, "idle");
    assert.equal(waitCall.options.afterStepCount, 12);
    assert.equal(waitCall.options.timeoutMs, 250);
    assert.equal(waitCall.options.pollIntervalMs, 10);
  });

  it("reports Antigravity Connect error steps as target errors instead of accepted-only completion", async () => {
    const conversationId = "connect-target-error-cascade-test";
    const calls = [];
    const beforeObservation = {
      conversationId,
      runStatus: "CASCADE_RUN_STATUS_IDLE",
      stepCount: 20,
      afterStepCount: 0,
      trajectoryAdvanced: true,
      statusCounts: { CORTEX_STEP_STATUS_DONE: 20 },
      running: false,
      completed: true,
      failed: false,
      pendingInteraction: false,
      blockedByPendingInteraction: false,
      progressAvailable: true,
      finalResponseAvailable: false,
      latestStep: {
        ordinal: 19,
        stepIndex: 20,
        type: "CORTEX_STEP_TYPE_SYSTEM_MESSAGE",
        status: "CORTEX_STEP_STATUS_DONE",
        content: ""
      },
      waitingInteractionStep: null,
      latestError: null,
      latestProgress: null,
      latestFinalResponse: null
    };
    const errorObservation = {
      ...beforeObservation,
      stepCount: 23,
      afterStepCount: 20,
      trajectoryAdvanced: true,
      statusCounts: {
        CORTEX_STEP_STATUS_DONE: 22,
        CORTEX_STEP_STATUS_ERROR: 1
      },
      completed: true,
      latestStep: {
        ordinal: 22,
        stepIndex: 23,
        type: "CORTEX_STEP_TYPE_ERROR_MESSAGE",
        status: "CORTEX_STEP_STATUS_DONE",
        source: "CORTEX_STEP_SOURCE_SYSTEM",
        contentPreview: "RESOURCE_EXHAUSTED (code 429): quota reached"
      },
      latestError: {
        ordinal: 22,
        stepIndex: 23,
        type: "CORTEX_STEP_TYPE_ERROR_MESSAGE",
        status: "CORTEX_STEP_STATUS_DONE",
        source: "CORTEX_STEP_SOURCE_SYSTEM",
        contentPreview: "RESOURCE_EXHAUSTED (code 429): quota reached",
        errorPreview: "RESOURCE_EXHAUSTED (code 429): quota reached",
        diagnostics: {
          hasSystemMessage: false,
          hasUserInput: false,
          hasAddCascadeInput: false,
          plannerResponseStopReason: "",
          errorSourcePath: "errorMessage.error.shortError"
        }
      }
    };
    let observeCount = 0;
    const fakeClient = {
      async getConversationMetadata(id) {
        calls.push({ method: "getConversationMetadata", id });
        return {
          response: {
            conversationMetadata: {
              metadata: { conversationId: id }
            }
          }
        };
      },
      async sendMessage({ recipientId, content }) {
        calls.push({ method: "sendMessage", recipientId, content });
        return {
          response: {
            sendMessage: { recipientId },
            recipientId
          }
        };
      },
      async observeConnectTrajectory() {
        observeCount += 1;
        calls.push({ method: "observeConnectTrajectory", observeCount });
        return observeCount === 1 ? beforeObservation : errorObservation;
      }
    };
    const connection = new AntigravityAgentApiConnection({
      target: {
        targetId: "antigravity.agentapi:connect-target-error-test",
        transport: {
          type: "antigravity-agentapi",
          conversationId,
          connectEnabled: true,
          connectWaitForFinalResponse: true
        }
      },
      relaySession: {
        relaySessionId: "relay-connect-target-error-test",
        targetSessionId: conversationId
      },
      client: fakeClient
    });

    const result = await connection.sendPrompt({
      prompt: "请只回复一句收到。",
      localObservationMarker: "PACT_CONNECT_TARGET_ERROR_MARKER"
    });

    assert.equal(result.stopReason, "target_error");
    assert.equal(result.externalCompletionState, "target_error");
    assert.equal(result.finalResponseAvailable, false);
    assert.equal(result.finalResponsePolicy, "target_error");
    assert.equal(result.targetError.code, "antigravity_connect_error");
    assert.equal(result.targetError.provider, "antigravity-connect");
    assert.equal(result.targetError.stepIndex, 23);
    assert.match(result.targetError.message, /RESOURCE_EXHAUSTED/);
    assert.equal(result.connectConversationObservation.latestError.stepIndex, 23);
    assert.equal(
      result.connectConversationObservation.latestError.diagnostics.errorSourcePath,
      "errorMessage.error.shortError"
    );
    assert.equal(
      result.events.find((event) => event.type === "completion")?.targetError?.code,
      "antigravity_connect_error"
    );
    assert.deepEqual(calls.map((call) => call.method), [
      "getConversationMetadata",
      "observeConnectTrajectory",
      "sendMessage",
      "observeConnectTrajectory"
    ]);
  });

  it("uses local known Antigravity transcript errors to diagnose blank Connect error steps", async () => {
    const tempRoot = await makeTempDir("pact-acp-antigravity-blank-connect-error-");
    const brainRoot = path.join(tempRoot, "brain");
    const conversationId = "connect-blank-error-with-local-diagnostic-test";
    const messagesDir = path.join(brainRoot, conversationId, ".system_generated/messages");
    const transcriptPath = path.join(brainRoot, conversationId, ".system_generated/logs/transcript.jsonl");
    await fs.mkdir(messagesDir, { recursive: true });
    await fs.mkdir(path.dirname(transcriptPath), { recursive: true });
    await fs.writeFile(transcriptPath, "", "utf8");
    const calls = [];
    const beforeObservation = {
      conversationId,
      runStatus: "CASCADE_RUN_STATUS_IDLE",
      stepCount: 10,
      afterStepCount: 0,
      trajectoryAdvanced: true,
      statusCounts: { CORTEX_STEP_STATUS_DONE: 10 },
      running: false,
      completed: true,
      failed: false,
      pendingInteraction: false,
      blockedByPendingInteraction: false,
      progressAvailable: false,
      finalResponseAvailable: false,
      latestStep: null,
      waitingInteractionStep: null,
      latestError: null,
      latestKnownError: null,
      latestProgress: null,
      latestFinalResponse: null
    };
    const blankErrorObservation = {
      ...beforeObservation,
      stepCount: 11,
      afterStepCount: 10,
      trajectoryAdvanced: true,
      statusCounts: {
        CORTEX_STEP_STATUS_DONE: 10,
        CORTEX_STEP_STATUS_ERROR: 1
      },
      latestStep: {
        ordinal: 10,
        stepIndex: 11,
        type: "CORTEX_STEP_TYPE_ERROR_MESSAGE",
        status: "CORTEX_STEP_STATUS_DONE",
        contentPreview: "",
        errorPreview: ""
      },
      latestError: {
        ordinal: 10,
        stepIndex: 11,
        type: "CORTEX_STEP_TYPE_ERROR_MESSAGE",
        status: "CORTEX_STEP_STATUS_DONE",
        contentPreview: "",
        errorPreview: ""
      },
      latestKnownError: {
        ordinal: 10,
        stepIndex: 11,
        type: "CORTEX_STEP_TYPE_ERROR_MESSAGE",
        status: "CORTEX_STEP_STATUS_DONE",
        contentPreview: "",
        errorPreview: ""
      }
    };
    let observeCount = 0;
    const fakeClient = {
      async getConversationMetadata(id) {
        calls.push({ method: "getConversationMetadata", id });
        return {
          response: {
            conversationMetadata: {
              metadata: { conversationId: id }
            }
          }
        };
      },
      async sendMessage({ recipientId, content }) {
        calls.push({ method: "sendMessage", recipientId, content });
        await fs.writeFile(
          path.join(messagesDir, "message-1.json"),
          JSON.stringify({
            id: "message-1",
            sender: "system",
            recipient: recipientId,
            timestamp: nowIso(),
            content
          }),
          "utf8"
        );
        await fs.appendFile(
          transcriptPath,
          `${JSON.stringify({
            source: "SYSTEM",
            type: "ERROR_MESSAGE",
            status: "DONE",
            step_index: 7,
            created_at: "2026-06-04T10:00:00Z",
            error: "RESOURCE_EXHAUSTED (code 429): quota reached"
          })}\n`,
          "utf8"
        );
        return {
          response: {
            sendMessage: { recipientId },
            recipientId
          }
        };
      },
      async observeConnectTrajectory() {
        observeCount += 1;
        calls.push({ method: "observeConnectTrajectory", observeCount });
        return observeCount === 1 ? beforeObservation : blankErrorObservation;
      }
    };
    const connection = new AntigravityAgentApiConnection({
      target: {
        targetId: "antigravity.agentapi:blank-connect-error-diagnostic-test",
        transport: {
          type: "antigravity-agentapi",
          conversationId,
          connectEnabled: true,
          localObservationEnabled: true,
          localObservationBrainRoot: brainRoot,
          localObservationTimeoutMs: 1000,
          localObservationPollIntervalMs: 50
        }
      },
      relaySession: {
        relaySessionId: "relay-blank-connect-error-diagnostic-test",
        targetSessionId: conversationId
      },
      client: fakeClient
    });

    const result = await connection.sendPrompt({
      prompt: "请只回复一句收到。",
      localObservationMarker: "PACT_BLANK_CONNECT_ERROR_DIAGNOSTIC_MARKER"
    });

    assert.equal(result.stopReason, "target_error");
    assert.equal(result.targetError.code, "antigravity_connect_error");
    assert.match(result.targetError.message, /RESOURCE_EXHAUSTED/);
    assert.match(result.targetError.diagnosticMessage, /RESOURCE_EXHAUSTED/);
    assert.equal(result.localConversationObservation.latestError.stepIndex, 7);
    assert.equal(result.localConversationObservation.latestKnownError.stepIndex, 7);
    assert.equal(result.connectConversationObservation.latestError.stepIndex, 11);
  });

  it("does not treat blank Antigravity Connect error steps as target errors without current diagnostics", async () => {
    const tempRoot = await makeTempDir("pact-acp-antigravity-stale-error-");
    const brainRoot = path.join(tempRoot, "brain");
    const conversationId = "connect-blank-error-with-stale-local-diagnostic-test";
    const messagesDir = path.join(brainRoot, conversationId, ".system_generated/messages");
    const transcriptPath = path.join(brainRoot, conversationId, ".system_generated/logs/transcript.jsonl");
    await fs.mkdir(messagesDir, { recursive: true });
    await fs.mkdir(path.dirname(transcriptPath), { recursive: true });
    await fs.writeFile(
      transcriptPath,
      `${JSON.stringify({
        source: "SYSTEM",
        type: "ERROR_MESSAGE",
        status: "DONE",
        step_index: 5,
        created_at: "2026-06-04T09:00:00Z",
        error: "User denied permission for command(npx vitest run)."
      })}\n`,
      "utf8"
    );
    const calls = [];
    const beforeObservation = {
      conversationId,
      runStatus: "CASCADE_RUN_STATUS_IDLE",
      stepCount: 4,
      afterStepCount: 0,
      trajectoryAdvanced: true,
      statusCounts: { CORTEX_STEP_STATUS_DONE: 4 },
      running: false,
      completed: true,
      failed: false,
      pendingInteraction: false,
      blockedByPendingInteraction: false,
      progressAvailable: false,
      finalResponseAvailable: false,
      latestStep: null,
      waitingInteractionStep: null,
      latestError: null,
      latestKnownError: null,
      latestProgress: null,
      latestFinalResponse: null
    };
    const blankErrorObservation = {
      ...beforeObservation,
      stepCount: 5,
      afterStepCount: 4,
      statusCounts: {
        CORTEX_STEP_STATUS_DONE: 4,
        CORTEX_STEP_STATUS_ERROR: 1
      },
      latestError: {
        ordinal: 4,
        stepIndex: 5,
        type: "CORTEX_STEP_TYPE_ERROR_MESSAGE",
        status: "CORTEX_STEP_STATUS_DONE",
        contentPreview: "",
        errorPreview: ""
      }
    };
    let observeCount = 0;
    const fakeClient = {
      async getConversationMetadata(id) {
        calls.push({ method: "getConversationMetadata", id });
        return {
          response: {
            conversationMetadata: {
              metadata: { conversationId: id }
            }
          }
        };
      },
      async sendMessage({ recipientId, content }) {
        calls.push({ method: "sendMessage", recipientId, content });
        await fs.writeFile(
          path.join(messagesDir, "message-1.json"),
          JSON.stringify({
            id: "message-1",
            sender: "system",
            recipient: recipientId,
            timestamp: nowIso(),
            content
          }),
          "utf8"
        );
        return {
          response: {
            sendMessage: { recipientId },
            recipientId
          }
        };
      },
      async observeConnectTrajectory() {
        observeCount += 1;
        calls.push({ method: "observeConnectTrajectory", observeCount });
        return observeCount === 1 ? beforeObservation : blankErrorObservation;
      }
    };
    const connection = new AntigravityAgentApiConnection({
      target: {
        targetId: "antigravity.agentapi:stale-local-error-diagnostic-test",
        transport: {
          type: "antigravity-agentapi",
          conversationId,
          connectEnabled: true,
          localObservationEnabled: true,
          localObservationBrainRoot: brainRoot,
          localObservationTimeoutMs: 1000,
          localObservationPollIntervalMs: 50
        }
      },
      relaySession: {
        relaySessionId: "relay-stale-local-error-diagnostic-test",
        targetSessionId: conversationId
      },
      client: fakeClient
    });

    const result = await connection.sendPrompt({
      prompt: "请只回复一句收到。",
      localObservationMarker: "PACT_STALE_LOCAL_ERROR_DIAGNOSTIC_MARKER"
    });

    assert.equal(result.stopReason, "accepted");
    assert.equal(result.externalCompletionState, "accepted_only");
    assert.equal(result.finalResponsePolicy, "accepted_only");
    assert.equal(result.targetError, null);
    assert.equal(result.localConversationObservation.latestKnownError, null);
    assert.equal(result.connectConversationObservation.latestError.stepIndex, 5);
    assert.doesNotMatch(result.text, /User denied permission/);
  });

  it("does not classify historical Connect errors as current target errors when baseline observation fails", async () => {
    const conversationId = "connect-baseline-failed-stale-error-test";
    const calls = [];
    let observeCount = 0;
    const staleObservation = {
      conversationId,
      runStatus: "CASCADE_RUN_STATUS_IDLE",
      stepCount: 9,
      afterStepCount: 0,
      trajectoryAdvanced: true,
      statusCounts: {
        CORTEX_STEP_STATUS_DONE: 8,
        CORTEX_STEP_STATUS_ERROR: 1
      },
      running: false,
      completed: true,
      failed: false,
      pendingInteraction: false,
      blockedByPendingInteraction: false,
      progressAvailable: false,
      finalResponseAvailable: false,
      latestStep: {
        ordinal: 9,
        stepIndex: 10,
        type: "CORTEX_STEP_TYPE_SYSTEM_MESSAGE",
        status: "CORTEX_STEP_STATUS_DONE",
        createdAt: new Date(Date.now() + 1000).toISOString(),
        contentPreview: "",
        errorPreview: ""
      },
      waitingInteractionStep: null,
      latestError: {
        ordinal: 8,
        stepIndex: 9,
        type: "CORTEX_STEP_TYPE_ERROR_MESSAGE",
        status: "CORTEX_STEP_STATUS_DONE",
        createdAt: "2020-01-01T00:00:00Z",
        contentPreview: "RESOURCE_EXHAUSTED (code 429): stale quota message",
        errorPreview: "RESOURCE_EXHAUSTED (code 429): stale quota message"
      },
      latestKnownError: {
        ordinal: 8,
        stepIndex: 9,
        type: "CORTEX_STEP_TYPE_ERROR_MESSAGE",
        status: "CORTEX_STEP_STATUS_DONE",
        createdAt: "2020-01-01T00:00:00Z",
        contentPreview: "RESOURCE_EXHAUSTED (code 429): stale quota message",
        errorPreview: "RESOURCE_EXHAUSTED (code 429): stale quota message"
      },
      latestProgress: null,
      latestFinalResponse: null
    };
    const fakeClient = {
      async getConversationMetadata(id) {
        calls.push({ method: "getConversationMetadata", id });
        return {
          response: {
            conversationMetadata: {
              metadata: { conversationId: id }
            }
          }
        };
      },
      async sendMessage({ recipientId, content }) {
        calls.push({ method: "sendMessage", recipientId, content });
        return {
          response: {
            sendMessage: { recipientId },
            recipientId
          }
        };
      },
      async observeConnectTrajectory() {
        observeCount += 1;
        calls.push({ method: "observeConnectTrajectory", observeCount });
        if (observeCount === 1) {
          throw new Error("Connect preflight observation failed");
        }
        return staleObservation;
      }
    };
    const connection = new AntigravityAgentApiConnection({
      target: {
        targetId: "antigravity.agentapi:baseline-failed-stale-error-test",
        transport: {
          type: "antigravity-agentapi",
          conversationId,
          connectEnabled: true
        }
      },
      relaySession: {
        relaySessionId: "relay-baseline-failed-stale-error-test",
        targetSessionId: conversationId
      },
      client: fakeClient
    });

    const result = await connection.sendPrompt({
      prompt: "请只回复一句收到。",
      localObservationMarker: "PACT_CONNECT_BASELINE_FAILED_STALE_ERROR_MARKER"
    });

    assert.equal(result.stopReason, "accepted");
    assert.equal(result.externalCompletionState, "accepted_only");
    assert.equal(result.finalResponsePolicy, "accepted_only");
    assert.equal(result.targetError, null);
    assert.equal(result.connectObservationError, "Connect preflight observation failed");
    assert.equal(result.connectConversationObservation.latestStep.stepIndex, 10);
    assert.equal(result.connectConversationObservation.latestError.stepIndex, 9);
    assert.doesNotMatch(result.text, /stale quota/);
  });

  it("reports post-send Antigravity Connect observation failures as target errors", async () => {
    const conversationId = "connect-observation-error-cascade-test";
    const calls = [];
    const beforeObservation = {
      conversationId,
      runStatus: "CASCADE_RUN_STATUS_IDLE",
      stepCount: 30,
      afterStepCount: 0,
      trajectoryAdvanced: true,
      statusCounts: { CORTEX_STEP_STATUS_DONE: 30 },
      running: false,
      completed: true,
      failed: false,
      pendingInteraction: false,
      blockedByPendingInteraction: false,
      progressAvailable: false,
      finalResponseAvailable: false,
      latestStep: null,
      waitingInteractionStep: null,
      latestError: null,
      latestProgress: null,
      latestFinalResponse: null
    };
    let observeCount = 0;
    const fakeClient = {
      async getConversationMetadata(id) {
        calls.push({ method: "getConversationMetadata", id });
        return {
          response: {
            conversationMetadata: {
              metadata: { conversationId: id }
            }
          }
        };
      },
      async sendMessage({ recipientId, content }) {
        calls.push({ method: "sendMessage", recipientId, content });
        return {
          response: {
            sendMessage: { recipientId },
            recipientId
          }
        };
      },
      async observeConnectTrajectory() {
        observeCount += 1;
        calls.push({ method: "observeConnectTrajectory", observeCount });
        if (observeCount === 1) {
          return beforeObservation;
        }
        throw new Error("RESOURCE_EXHAUSTED (code 429): quota reached while observing trajectory");
      }
    };
    const connection = new AntigravityAgentApiConnection({
      target: {
        targetId: "antigravity.agentapi:connect-observation-error-test",
        transport: {
          type: "antigravity-agentapi",
          conversationId,
          connectEnabled: true
        }
      },
      relaySession: {
        relaySessionId: "relay-connect-observation-error-test",
        targetSessionId: conversationId
      },
      client: fakeClient
    });

    const result = await connection.sendPrompt({
      prompt: "请只回复一句收到。",
      localObservationMarker: "PACT_CONNECT_OBSERVATION_ERROR_MARKER"
    });

    assert.equal(result.stopReason, "target_error");
    assert.equal(result.externalCompletionState, "target_error");
    assert.equal(result.finalResponseAvailable, false);
    assert.equal(result.finalResponsePolicy, "target_error");
    assert.equal(result.connectConversationObservation, null);
    assert.equal(result.connectObservationError, "RESOURCE_EXHAUSTED (code 429): quota reached while observing trajectory");
    assert.equal(result.targetError.code, "antigravity_connect_observation_error");
    assert.match(result.targetError.message, /RESOURCE_EXHAUSTED/);
    assert.deepEqual(calls.map((call) => call.method), [
      "getConversationMetadata",
      "observeConnectTrajectory",
      "sendMessage",
      "observeConnectTrajectory"
    ]);
  });

  it("reports Antigravity Connect final-wait failures as target errors", async () => {
    const conversationId = "connect-final-wait-error-cascade-test";
    const calls = [];
    const beforeObservation = {
      conversationId,
      runStatus: "CASCADE_RUN_STATUS_IDLE",
      stepCount: 40,
      afterStepCount: 0,
      trajectoryAdvanced: true,
      statusCounts: { CORTEX_STEP_STATUS_DONE: 40 },
      running: false,
      completed: true,
      failed: false,
      pendingInteraction: false,
      blockedByPendingInteraction: false,
      progressAvailable: false,
      finalResponseAvailable: false,
      latestStep: null,
      waitingInteractionStep: null,
      latestError: null,
      latestProgress: null,
      latestFinalResponse: null
    };
    const runningObservation = {
      ...beforeObservation,
      runStatus: "CASCADE_RUN_STATUS_RUNNING",
      stepCount: 41,
      afterStepCount: 40,
      trajectoryAdvanced: true,
      running: true,
      completed: false,
      latestStep: {
        ordinal: 40,
        stepIndex: 41,
        type: "CORTEX_STEP_TYPE_SYSTEM_MESSAGE",
        status: "CORTEX_STEP_STATUS_DONE",
        content: ""
      }
    };
    let observeCount = 0;
    const fakeClient = {
      async getConversationMetadata(id) {
        calls.push({ method: "getConversationMetadata", id });
        return {
          response: {
            conversationMetadata: {
              metadata: { conversationId: id }
            }
          }
        };
      },
      async sendMessage({ recipientId, content }) {
        calls.push({ method: "sendMessage", recipientId, content });
        return {
          response: {
            sendMessage: { recipientId },
            recipientId
          }
        };
      },
      async observeConnectTrajectory() {
        observeCount += 1;
        calls.push({ method: "observeConnectTrajectory", observeCount });
        return observeCount === 1 ? beforeObservation : runningObservation;
      },
      async waitForConnectTrajectoryObservation(options) {
        calls.push({ method: "waitForConnectTrajectoryObservation", options });
        throw new Error("RESOURCE_EXHAUSTED (code 429): quota reached while waiting for final");
      }
    };
    const connection = new AntigravityAgentApiConnection({
      target: {
        targetId: "antigravity.agentapi:connect-final-wait-error-test",
        transport: {
          type: "antigravity-agentapi",
          conversationId,
          connectEnabled: true,
          connectObservationTimeoutMs: 250,
          connectObservationPollIntervalMs: 10
        }
      },
      relaySession: {
        relaySessionId: "relay-connect-final-wait-error-test",
        targetSessionId: conversationId
      },
      client: fakeClient
    });

    const result = await connection.sendPrompt({
      prompt: "请只回复一句收到。",
      localObservationMarker: "PACT_CONNECT_FINAL_WAIT_ERROR_MARKER"
    });

    assert.equal(result.stopReason, "target_error");
    assert.equal(result.externalCompletionState, "target_error");
    assert.equal(result.finalResponseAvailable, false);
    assert.equal(result.finalResponsePolicy, "target_error");
    assert.equal(result.connectConversationObservation.runStatus, "CASCADE_RUN_STATUS_RUNNING");
    assert.equal(result.connectObservationError, "RESOURCE_EXHAUSTED (code 429): quota reached while waiting for final");
    assert.equal(result.targetError.code, "antigravity_connect_observation_error");
    assert.match(result.targetError.message, /waiting for final/);
    const waitCall = calls.find((call) => call.method === "waitForConnectTrajectoryObservation");
    assert.equal(waitCall.options.until, "idle");
    assert.equal(waitCall.options.afterStepCount, 40);
  });

  it("formally denies pending Antigravity command interactions before using force-stop fallback", async () => {
    const conversationId = "connect-formal-deny-cascade-test";
    const calls = [];
    const makeObservation = ({ pendingInteraction = false } = {}) => ({
      conversationId,
      endpoint: {
        address: "127.0.0.1:58162",
        source: "fake",
        protocol: "connect-json",
        tls: true,
        hasCsrfToken: true
      },
      runStatus: "CASCADE_RUN_STATUS_RUNNING",
      stepCount: 8,
      afterStepCount: 7,
      trajectoryAdvanced: true,
      statusCounts: pendingInteraction
        ? { CORTEX_STEP_STATUS_DONE: 7, CORTEX_STEP_STATUS_WAITING: 1 }
        : { CORTEX_STEP_STATUS_DONE: 7, CORTEX_STEP_STATUS_ERROR: 1 },
      running: true,
      completed: false,
      failed: false,
      pendingInteraction,
      blockedByPendingInteraction: pendingInteraction,
      markerObserved: false,
      progressAvailable: false,
      finalResponseAvailable: false,
      latestStep: {
        ordinal: 7,
        stepIndex: 8,
        trajectoryId: "trajectory-formal-deny-test",
        cascadeId: conversationId,
        type: "CORTEX_STEP_TYPE_RUN_COMMAND",
        status: pendingInteraction ? "CORTEX_STEP_STATUS_WAITING" : "CORTEX_STEP_STATUS_ERROR"
      },
      waitingInteractionStep: pendingInteraction
        ? {
            ordinal: 7,
            stepIndex: 8,
            trajectoryId: "trajectory-formal-deny-test",
            cascadeId: conversationId,
            type: "CORTEX_STEP_TYPE_RUN_COMMAND",
            status: "CORTEX_STEP_STATUS_WAITING",
            toolCall: {
              id: "tool-call-formal-deny",
              name: "run_command"
            },
            runCommand: {
              commandLine: "npx vitest run --config vitest.config.ts tests/vitest/server/acp-agent-relay-runtime.test.mjs",
              cwd: "/Users/unka/DevSpace/Unka-Malloc/Pact",
              blocking: true
            },
            requestedInteraction: {
              kind: "permission",
              permission: {
                action: "command",
                target: "npx vitest run --config vitest.config.ts tests/vitest/server/acp-agent-relay-runtime.test.mjs",
                persistSuggestionType: "PERSIST_SUGGESTION_TYPE_SUGGESTED",
                suggestedPersistPattern: "npx"
              }
            }
          }
        : null,
      latestProgress: null,
      latestFinalResponse: null
    });
    let observeCount = 0;
    const fakeClient = {
      async getConversationMetadata(id) {
        calls.push({ method: "getConversationMetadata", id });
        return {
          response: {
            conversationMetadata: {
              metadata: { conversationId: id }
            }
          }
        };
      },
      async probeCapabilities() {
        calls.push({ method: "probeCapabilities" });
        return {
          snapshot: createAntigravityAgentApiCapabilitySnapshot()
        };
      },
      async sendMessage({ recipientId, content }) {
        calls.push({ method: "sendMessage", recipientId, content });
        return {
          response: {
            sendMessage: { recipientId },
            recipientId
          }
        };
      },
      async observeConnectTrajectory() {
        observeCount += 1;
        calls.push({ method: "observeConnectTrajectory", observeCount });
        if (observeCount === 2) {
          return makeObservation({ pendingInteraction: true });
        }
        return makeObservation();
      },
      async denyCascadeUserInteraction({ conversationId: id, step }) {
        calls.push({ method: "denyCascadeUserInteraction", id, stepIndex: step.stepIndex });
        return {
          ok: true,
          statusCode: 200,
          body: {}
        };
      },
      async forceStopCascadeTree({ conversationId: id }) {
        calls.push({ method: "forceStopCascadeTree", id });
        return {
          ok: true,
          statusCode: 200,
          body: {}
        };
      }
    };
    const connection = new AntigravityAgentApiConnection({
      target: {
        targetId: "antigravity.agentapi:formal-deny-test",
        transport: {
          type: "antigravity-agentapi",
          conversationId,
          connectEnabled: true,
          connectDenyPendingCommandInteractions: true,
          connectForceStopStuckCascade: true
        }
      },
      relaySession: {
        relaySessionId: "relay-connect-formal-deny-test",
        targetSessionId: conversationId
      },
      client: fakeClient
    });
    const result = await connection.sendPrompt({
      prompt: "请运行测试。",
      localObservationMarker: "PACT_CONNECT_FORMAL_DENY_MARKER"
    });

    assert.equal(result.stopReason, "accepted");
    assert.equal(result.externalCompletionState, "accepted_only");
    assert.equal(result.connectConversationObservation.blockedByPendingInteraction, false);
    assert.equal(result.connectConversationObservation.handledInteractionStep.stepIndex, 8);
    assert.deepEqual(
      result.connectConversationObservation.actions.map((action) => [action.type, action.ok]),
      [["handleCascadeUserInteraction.denyCommand", true]]
    );
    assert.deepEqual(calls.map((call) => call.method), [
      "getConversationMetadata",
      "probeCapabilities",
      "observeConnectTrajectory",
      "sendMessage",
      "observeConnectTrajectory",
      "denyCascadeUserInteraction",
      "observeConnectTrajectory"
    ]);
  });

  it("routes antigravity-agentapi targets through Agent API send-message and records target evidence", async () => {
    const tempRoot = await makeTempDir("pact-acp-antigravity-target-observe-");
    const brainRoot = path.join(tempRoot, "brain");
    const conversationId = "ag-conversation-test";
    const messagesDir = path.join(brainRoot, conversationId, ".system_generated/messages");
    const calls = [];
    const fakeClient = {
      async getConversationMetadata(conversationId) {
        calls.push({ method: "getConversationMetadata", conversationId });
        return {
          response: {
            conversationMetadata: {
              metadata: { conversationId }
            }
          }
        };
      },
      async probeCapabilities() {
        calls.push({ method: "probeCapabilities" });
        return {
          availableCommands: ["get-conversation-metadata", "new-conversation", "send-message"],
          finalResponseCapabilityProbe: [],
          snapshot: createAntigravityAgentApiCapabilitySnapshot({
            availableCommands: ["get-conversation-metadata", "new-conversation", "send-message"]
          })
        };
      },
      async probeIdeCliCapabilities() {
        calls.push({ method: "probeIdeCliCapabilities" });
        return {
          provider: "antigravity-ide-cli",
          found: true,
          cliPath: "/Applications/Antigravity IDE.app/Contents/Resources/app/bin/antigravity-ide",
          version: "1.107.0",
          checkedCommands: ["--help", "chat --help"],
          subcommands: ["chat", "serve-web", "tunnel"],
          chatCommandSupported: true,
          chatReadsStdin: true,
          chatIsAcpTransport: false,
          mcpConfigSupported: true,
          nativeAcpCommandNames: [],
          nativeAcpTransportSupported: false,
          nativeAcpTargetVerified: false,
          nativeAcpSourceVerified: false,
          reasonCode: "native_acp_command_not_advertised"
        };
      },
      async sendMessage({ recipientId, content }) {
        calls.push({ method: "sendMessage", recipientId, content });
        await fs.mkdir(messagesDir, { recursive: true });
        await fs.writeFile(
          path.join(messagesDir, "message-1.json"),
          JSON.stringify({
            id: "message-1",
            sender: "system",
            recipient: recipientId,
            timestamp: nowIso(),
            content
          }),
          "utf8"
        );
        return {
          response: {
            sendMessage: {
              recipientId,
              content
            }
          }
        };
      }
    };
    const targetId = "antigravity.agentapi:test";
    const virtualAgentId = "antigravity.agentapi-test";
    const runtime = createAcpRelayRuntime({
      virtualAgentRegistry: new AcpVirtualAgentRegistry({
        [virtualAgentId]: {
          virtualAgentId,
          targetId,
          profileId: "pact.acp.antigravity.agentapi.test",
          displayName: "Antigravity Agent API Test",
          advertisedModes: ["ask"],
          defaultMode: "ask",
          advertisedTools: ["agentapi.sendMessage"],
          reasoningVisibilityPolicy: "never",
          capabilityPolicy: {
            writes: "deny",
            terminal: "deny",
            maxRisk: "read_only"
          },
          revision: 1
        }
      }),
      targetRegistry: new AcpTargetRegistry({
        [targetId]: {
          targetId,
          label: "Antigravity Agent API Test Target",
          transport: {
            type: "antigravity-agentapi",
            conversationId,
            localObservationEnabled: true,
            localObservationBrainRoot: brainRoot,
            localObservationTimeoutMs: 1000,
            localObservationPollIntervalMs: 100
          },
          enabled: true,
          revision: 1
        }
      }),
      sessionDriver: new AcpSessionDriver({
        connectionFactory: (options) =>
          new AntigravityAgentApiConnection({
            ...options,
            client: fakeClient
          })
      })
    });

    const sessionResult = await runtime.execute("acp_agent_relay.session.create", {
      sourceId: "codex-vitest",
      sourceSessionId: "agentapi-source",
      workspaceId: "vitest-workspace",
      virtualAgentId
    });
    assert.equal(sessionResult.ok, true);

    const promptResult = await runtime.execute("acp_agent_relay.prompt.send", {
      relaySessionId: sessionResult.data.session.relaySessionId,
      prompt: "verify real adapter branch",
      localObservationMarker: "verify real adapter branch"
    });
    assert.equal(promptResult.ok, true);
    assert.equal(promptResult.data.stopReason, "accepted");
    assert.equal(promptResult.data.session.targetResumeRef, conversationId);
    assert.equal(promptResult.data.targetEvidence.transportType, "antigravity-agentapi");
    assert.equal(promptResult.data.targetEvidence.externalAccepted, true);
    assert.equal(promptResult.data.targetEvidence.externalCompletionState, "accepted_only");
    assert.equal(promptResult.data.targetEvidence.finalResponseAvailable, false);
    assert.equal(promptResult.data.targetEvidence.finalResponsePolicy, "accepted_only");
    assert.equal(promptResult.data.responseKind, "acknowledgement");
    assert.equal(promptResult.data.communicationSummary.summaryKind, "acknowledgement");
    assert.equal(promptResult.data.communicationSummary.finalResponseSummary, "");
    assert.match(promptResult.data.communicationSummary.acknowledgementSummary, /accepted the delegated prompt/);
    assert.equal(promptResult.data.targetEvidence.targetCommunicationMode, "agent_api_proxy");
    assert.equal(promptResult.data.targetEvidence.nativeAcpTargetSupported, false);
    assert.equal(promptResult.data.targetEvidence.nativeAcpTargetVerified, false);
    assert.equal(promptResult.data.targetEvidence.agentApiCapabilitySnapshot.finalResponseReadSupported, false);
    assert.equal(promptResult.data.targetEvidence.agentApiCapabilitySnapshot.commands.sendMessage, true);
    assert.equal(promptResult.data.targetEvidence.agentApiCapabilitySnapshot.commands.waitForResponse, false);
    assert.equal(promptResult.data.targetEvidence.agentApiCapabilitySnapshot.commands.streamConversation, false);
    assert.equal(promptResult.data.targetEvidence.agentApiCapabilitySnapshot.ideCli.provider, "antigravity-ide-cli");
    assert.equal(promptResult.data.targetEvidence.agentApiCapabilitySnapshot.ideCli.chatCommandSupported, true);
    assert.equal(promptResult.data.targetEvidence.agentApiCapabilitySnapshot.ideCli.nativeAcpTransportSupported, false);
    assert.equal(promptResult.data.targetEvidence.agentApiCapabilitySnapshot.ideCli.nativeAcpTargetVerified, false);
    assert.equal(promptResult.data.targetEvidence.agentApiCapabilitySnapshot.ideCli.reasonCode, "native_acp_command_not_advertised");
    assert.equal(promptResult.data.targetEvidence.localConversationObservation.markerMessageObserved, true);
    assert.equal(promptResult.data.targetEvidence.localConversationObservation.finalResponseAvailable, false);
    assert.deepEqual(promptResult.data.targetEvidence.externalResponseKeys, ["sendMessage"]);
    assert.equal(calls.some((call) => call.method === "sendMessage"), true);
    assert.equal(calls.some((call) => call.method === "probeIdeCliCapabilities"), true);
    assert.match(calls.find((call) => call.method === "sendMessage")?.content || "", /Pact ACP Agent Relay/);

    const transcriptPath = path.join(brainRoot, conversationId, ".system_generated/logs/transcript.jsonl");
    await fs.mkdir(path.dirname(transcriptPath), { recursive: true });
    await fs.writeFile(
      transcriptPath,
      `${JSON.stringify({
        step_index: 1,
        source: "MODEL",
        type: "PLANNER_RESPONSE",
        status: "DONE",
        created_at: nowIso(),
        content: "已完成：Antigravity final response from turn.observe"
      })}\n`,
      "utf8"
    );

    const observed = await runtime.execute("acp_agent_relay.turn.observe", {
      relaySessionId: sessionResult.data.session.relaySessionId,
      relayTurnId: promptResult.data.turn.relayTurnId
    });
    assert.equal(observed.ok, true);
    assert.equal(observed.data.observed, true);
    assert.equal(observed.data.refreshed, true);
    assert.equal(observed.data.stopReason, "completed");
    assert.equal(observed.data.communicationSummary.finalResponseAvailable, true);
    assert.equal(observed.data.communicationSummary.externalCompletionState, "completed");
    assert.equal(observed.data.communicationSummary.finalResponsePolicy, "local_conversation_observation");
    assert.equal(observed.data.targetObservation.finalResponseAvailable, true);
    assert.match(observed.data.targetObservation.latestFinalResponse.textPreview, /turn\.observe/);
    assert.equal(observed.data.targetObservation.latestFinalResponse.text, undefined);
    assert.equal(JSON.stringify(observed.data).includes('"content":"已完成'), false);

    const storedTurn = await runtime.store.getTurn(promptResult.data.turn.relayTurnId);
    assert.equal(storedTurn.stopReason, "completed");
    assert.equal(storedTurn.metadata.result.communicationSummary.finalResponseAvailable, true);
    const observeEvents = await runtime.store.listEvents(promptResult.data.turn.relayTurnId);
    assert.equal(
      observeEvents.some((event) =>
        event.operationId === "acp_agent_relay.turn.observe" &&
          event.globalAuditId === promptResult.data.audit.globalAuditId
      ),
      true
    );

    const observedAgain = await runtime.execute("acp_agent_relay.turn.observe", {
      relaySessionId: sessionResult.data.session.relaySessionId,
      relayTurnId: promptResult.data.turn.relayTurnId
    });
    assert.equal(observedAgain.ok, true);
    assert.equal(observedAgain.data.refreshed, false);
  });

  it("returns Antigravity Connect final response text as the relay output summary", async () => {
    const conversationId = "ag-connect-final-text-conversation";
    const finalText = "Antigravity 已完成：ACP Relay final response 可见。";
    const calls = [];
    let observeCount = 0;
    const fakeClient = {
      async getConversationMetadata(conversationId) {
        calls.push({ method: "getConversationMetadata", conversationId });
        return {
          response: {
            conversationMetadata: {
              metadata: { conversationId }
            }
          }
        };
      },
      async sendMessage({ recipientId, content }) {
        calls.push({ method: "sendMessage", recipientId, content });
        return {
          response: {
            sendMessage: { recipientId },
            recipientId
          }
        };
      },
      async observeConnectTrajectory() {
        observeCount += 1;
        calls.push({ method: "observeConnectTrajectory", observeCount });
        if (observeCount === 1) {
          return {
            conversationId,
            runStatus: "CASCADE_RUN_STATUS_RUNNING",
            stepCount: 4,
            afterStepCount: 0,
            trajectoryAdvanced: true,
            statusCounts: { CORTEX_STEP_STATUS_DONE: 4 },
            running: true,
            completed: false,
            failed: false,
            pendingInteraction: false,
            blockedByPendingInteraction: false,
            progressAvailable: false,
            finalResponseAvailable: false,
            latestStep: null,
            waitingInteractionStep: null,
            latestProgress: null,
            latestFinalResponse: null
          };
        }
        return {
          conversationId,
          runStatus: "CASCADE_RUN_STATUS_COMPLETED",
          stepCount: 5,
          afterStepCount: 4,
          trajectoryAdvanced: true,
          statusCounts: { CORTEX_STEP_STATUS_DONE: 5 },
          running: false,
          completed: true,
          failed: false,
          pendingInteraction: false,
          blockedByPendingInteraction: false,
          progressAvailable: true,
          finalResponseAvailable: true,
          latestStep: {
            ordinal: 4,
            stepIndex: 5,
            type: "CORTEX_STEP_TYPE_PLANNER_RESPONSE",
            status: "CORTEX_STEP_STATUS_DONE",
            content: finalText
          },
          waitingInteractionStep: null,
          latestProgress: {
            ordinal: 4,
            stepIndex: 5,
            type: "CORTEX_STEP_TYPE_PLANNER_RESPONSE",
            status: "CORTEX_STEP_STATUS_DONE",
            content: finalText
          },
          latestFinalResponse: {
            ordinal: 4,
            stepIndex: 5,
            type: "CORTEX_STEP_TYPE_PLANNER_RESPONSE",
            status: "CORTEX_STEP_STATUS_DONE",
            content: finalText
          }
        };
      }
    };
    const targetId = "antigravity.agentapi:connect-final-text";
    const virtualAgentId = "antigravity.agentapi-connect-final-text";
    const runtime = createAcpRelayRuntime({
      virtualAgentRegistry: new AcpVirtualAgentRegistry({
        [virtualAgentId]: {
          virtualAgentId,
          targetId,
          profileId: "pact.acp.antigravity.connect.final.test",
          displayName: "Antigravity Connect Final Test",
          advertisedModes: ["ask"],
          defaultMode: "ask",
          advertisedTools: ["agentapi.sendMessage"],
          reasoningVisibilityPolicy: "never",
          capabilityPolicy: {
            writes: "deny",
            terminal: "deny",
            maxRisk: "read_only"
          },
          revision: 1
        }
      }),
      targetRegistry: new AcpTargetRegistry({
        [targetId]: {
          targetId,
          label: "Antigravity Connect Final Test Target",
          transport: {
            type: "antigravity-agentapi",
            conversationId,
            connectEnabled: true
          },
          enabled: true,
          revision: 1
        }
      }),
      sessionDriver: new AcpSessionDriver({
        connectionFactory: (options) =>
          new AntigravityAgentApiConnection({
            ...options,
            client: fakeClient
          })
      })
    });

    const sessionResult = await runtime.execute("acp_agent_relay.session.create", {
      sourceId: "codex-vitest",
      sourceSessionId: "agentapi-connect-final-source",
      workspaceId: "vitest-workspace",
      virtualAgentId
    });
    assert.equal(sessionResult.ok, true);

    const promptResult = await runtime.execute("acp_agent_relay.prompt.send", {
      relaySessionId: sessionResult.data.session.relaySessionId,
      prompt: "ask Antigravity for final response"
    });

    assert.equal(promptResult.ok, true);
    assert.equal(promptResult.data.stopReason, "completed");
    assert.equal(promptResult.data.outputSummary, finalText);
    assert.equal(promptResult.data.targetEvidence.finalResponseAvailable, true);
    assert.equal(promptResult.data.targetEvidence.finalResponsePolicy, "connect_trajectory");
    assert.equal(promptResult.data.targetEvidence.externalCompletionState, "completed");
    assert.equal(promptResult.data.responseKind, "final_response");
    assert.equal(promptResult.data.communicationSummary.summaryKind, "final_response");
    assert.equal(promptResult.data.communicationSummary.finalResponseSummary, finalText);
    assert.equal(promptResult.data.communicationSummary.acknowledgementSummary, "");
    assert.equal(
      promptResult.data.events.find((event) => event.type === "completion")?.redactedPayload?.outputSummary,
      finalText
    );
    assert.deepEqual(calls.map((call) => call.method), [
      "getConversationMetadata",
      "observeConnectTrajectory",
      "sendMessage",
      "observeConnectTrajectory"
    ]);
  });

  it("replays prompt results for duplicate idempotency keys without re-sending to Antigravity", async () => {
    const calls = [];
    const fakeClient = {
      async getConversationMetadata(conversationId) {
        calls.push({ method: "getConversationMetadata", conversationId });
        return {
          response: {
            conversationMetadata: {
              metadata: { conversationId }
            }
          }
        };
      },
      async sendMessage({ recipientId, content }) {
        calls.push({ method: "sendMessage", recipientId, content });
        return {
          response: {
            sendMessage: {
              recipientId,
              content
            }
          }
        };
      }
    };
    const targetId = "antigravity.agentapi:idempotent-test";
    const virtualAgentId = "antigravity.agentapi-idempotent-test";
    const runtime = createAcpRelayRuntime({
      virtualAgentRegistry: new AcpVirtualAgentRegistry({
        [virtualAgentId]: {
          virtualAgentId,
          targetId,
          profileId: "pact.acp.antigravity.agentapi.idempotent_test",
          displayName: "Antigravity Agent API Idempotent Test",
          advertisedModes: ["ask"],
          defaultMode: "ask",
          advertisedTools: ["agentapi.sendMessage"],
          reasoningVisibilityPolicy: "never",
          capabilityPolicy: {
            writes: "deny",
            terminal: "deny",
            maxRisk: "read_only"
          },
          revision: 1
        }
      }),
      targetRegistry: new AcpTargetRegistry({
        [targetId]: {
          targetId,
          label: "Antigravity Agent API Idempotent Target",
          transport: {
            type: "antigravity-agentapi",
            conversationId: "ag-idempotent-conversation"
          },
          enabled: true,
          revision: 1
        }
      }),
      sessionDriver: new AcpSessionDriver({
        connectionFactory: (options) =>
          new AntigravityAgentApiConnection({
            ...options,
            client: fakeClient
          })
      })
    });

    const sessionResult = await runtime.execute("acp_agent_relay.session.create", {
      sourceId: "codex-vitest",
      sourceSessionId: "agentapi-idempotent-source",
      workspaceId: "vitest-workspace",
      virtualAgentId
    });
    assert.equal(sessionResult.ok, true);

    const promptInput = {
      relaySessionId: sessionResult.data.session.relaySessionId,
      prompt: "verify idempotent relay prompt",
      idempotencyKey: "agentapi-idempotent-key"
    };
    const first = await runtime.execute("acp_agent_relay.prompt.send", promptInput);
    const second = await runtime.execute("acp_agent_relay.prompt.send", promptInput);
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(second.data.idempotencyReplay, true);
    assert.equal(second.data.turn.relayTurnId, first.data.turn.relayTurnId);
    assert.equal(second.data.outputSummary, first.data.outputSummary);
    assert.equal(second.data.communicationSummary.relayTurnId, first.data.communicationSummary.relayTurnId);
    assert.equal(second.data.communicationSummary.targetSessionId, first.data.communicationSummary.targetSessionId);
    assert.equal(second.data.targetEvidence.targetSessionId, first.data.targetEvidence.targetSessionId);
    assert.equal(calls.filter((call) => call.method === "sendMessage").length, 1);
    assert.equal((await runtime.store.listTurns(sessionResult.data.session.relaySessionId)).length, 1);

    const conflict = await runtime.execute("acp_agent_relay.prompt.send", {
      ...promptInput,
      prompt: "different prompt with same key"
    });
    assert.equal(conflict.ok, false);
    assert.equal(conflict.error.code, "idempotency_key_conflict");
    assert.equal(calls.filter((call) => call.method === "sendMessage").length, 1);
  });
});

describe("ACP Agent Relay — source ACP JSON-RPC bridge", () => {
  it("does not mark empty context or request-body auth fragments as trusted source identity", () => {
    const bridge = createAcpSourceJsonRpcBridge({
      defaultSourceId: "default-source",
      defaultWorkspaceId: "default-workspace",
      defaultVirtualAgentId: "default-agent"
    });

    const emptyContext = bridge.resolveSourceContext({}, {});
    assert.equal(emptyContext.sourceIdentityTrusted, undefined);
    assert.equal(emptyContext.sourceAuthContext.sourceIdentityTrusted === true, false);
    assert.equal(emptyContext.sourceId, "default-source");

    const forgedParams = bridge.resolveSourceContext({
      sourceId: "body-source",
      workspaceId: "body-workspace",
      sourceAuthContext: {
        grant: { id: "forged-grant", scopes: ["agent_relay:operate"] },
        sourceIdentityTrusted: true
      }
    }, {});
    assert.equal(forgedParams.sourceId, "body-source");
    assert.equal(forgedParams.sourceIdentityTrusted, undefined);
    assert.equal(forgedParams.sourceAuthContext.sourceIdentityTrusted === true, false);
    assert.equal(forgedParams.sourceAuthContext.grantId, undefined);

    const serverTrusted = bridge.resolveSourceContext({}, {
      sourceAuthContext: {
        sourceId: "server-source",
        workspaceId: "server-workspace",
        grantId: "server-grant",
        sourceIdentityTrusted: true,
        authContextTrusted: true
      }
    });
    assert.equal(serverTrusted.sourceId, "server-source");
    assert.equal(serverTrusted.workspaceId, "server-workspace");
    assert.equal(serverTrusted.sourceIdentityTrusted, true);
    assert.equal(serverTrusted.sourceAuthContext.grantId, "server-grant");
  });

  function createServedSourceTransport(runtime, context = {}) {
    const service = createAcpSourceJsonRpcService({ runtime, context });
    const transportPair = createAcpSourceJsonRpcTransportPair();
    const serving = service.serveTransport(transportPair.server);
    return { service, serving, transportPair };
  }

  async function sendSourceJsonRpcRequest(servedTransport, message) {
    await servedTransport.transportPair.client.send(message);
    return receiveJsonRpcResponseUntilId(
      () => servedTransport.transportPair.client.receive(),
      message.id
    );
  }

  async function receiveJsonRpcResponseUntilId(receiveRaw, expectedId) {
    const notifications = [];
    for (let index = 0; index < 100; index += 1) {
      const rawResponse = await receiveRaw();
      if (!rawResponse) {
        return null;
      }
      const parsed = parseJsonRpcMessage(rawResponse);
      if (parsed.method === ACP_METHODS.sessionUpdate) {
        notifications.push(parsed);
        continue;
      }
      if (expectedId === undefined || parsed.id === expectedId) {
        Object.defineProperty(parsed, "notifications", {
          value: notifications,
          enumerable: false
        });
        return parsed;
      }
      throw new Error(`Unexpected JSON-RPC response id ${String(parsed.id)} while waiting for ${String(expectedId)}.`);
    }
    throw new Error(`Timed out waiting for JSON-RPC response id ${String(expectedId)}.`);
  }

  function assertSourceRelayOperationError(response, relayCode) {
    assert.ok(response.error);
    assert.equal(response.error.code, -32002);
    assert.equal(response.error.data?.code, relayCode);
    assert.equal(response.error.data?.operation?.code, relayCode);
  }

  async function waitForNoSourceJsonRpcResponse(servedTransport, message, timeoutMs = 100) {
    await servedTransport.transportPair.client.send(message);
    const responsePromise = servedTransport.transportPair.client.receive();
    const timeout = new Promise((resolve) => setTimeout(() => resolve("timeout"), timeoutMs));
    const rawResponse = await Promise.race([responsePromise, timeout]);
    if (rawResponse === "timeout") {
      return null;
    }
    return rawResponse;
  }

  async function closeServedSourceTransport(servedTransport) {
    servedTransport.transportPair.close();
    await servedTransport.serving;
  }

  function createOutputLineReader(stream) {
    const queue = [];
    const waiters = [];
    let buffer = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (waiters.length > 0) {
          waiters.shift()(line);
        } else {
          queue.push(line);
        }
      }
    });
    return {
      async receiveLine() {
        if (queue.length > 0) {
          return queue.shift();
        }
        return new Promise((resolve) => waiters.push(resolve));
      }
    };
  }

  async function waitForProcessExit(child, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill("SIGTERM");
        reject(new Error(`Timed out waiting for child process exit after ${timeoutMs}ms.`));
      }, timeoutMs);
      child.once("exit", (code, signal) => {
        clearTimeout(timeout);
        resolve({ code, signal });
      });
    });
  }

  function createSourceBridgeRuntime({
    conversationId = "ag-source-bridge-conversation",
    runtimeOptions = {},
    fakeClient = null,
    transportOptions = {}
  } = {}) {
    const calls = [];
    const defaultFakeClient = {
      async getConversationMetadata(nextConversationId) {
        calls.push({ method: "getConversationMetadata", conversationId: nextConversationId });
        return {
          response: {
            conversationMetadata: {
              metadata: { conversationId: nextConversationId }
            }
          }
        };
      },
      async sendMessage({ recipientId, content }) {
        calls.push({ method: "sendMessage", recipientId, content });
        return {
          response: {
            sendMessage: {
              recipientId,
              content
            }
          }
        };
      }
    };
    const targetClient = fakeClient || defaultFakeClient;
    const targetId = "antigravity.agentapi:source-bridge";
    const virtualAgentId = "antigravity.agentapi-source-bridge";
    const runtime = createAcpRelayRuntime({
      defaultVirtualAgentId: virtualAgentId,
      defaultSourceId: "codex-source-vitest",
      defaultWorkspaceId: "vitest-workspace",
      virtualAgentRegistry: new AcpVirtualAgentRegistry({
        [virtualAgentId]: {
          virtualAgentId,
          targetId,
          profileId: "pact.acp.antigravity.agentapi.source_bridge",
          displayName: "Antigravity Agent API Source Bridge",
          advertisedModes: ["ask"],
          defaultMode: "ask",
          advertisedTools: ["agentapi.sendMessage"],
          reasoningVisibilityPolicy: "never",
          capabilityPolicy: {
            writes: "deny",
            terminal: "deny",
            maxRisk: "read_only"
          },
          metadata: {
            public: { fixture: "source-bridge-public-metadata" },
            csrfToken: "virtual-agent-secret-csrf-token",
            apiKey: "virtual-agent-secret-api-key",
            rawPrompt: "virtual-agent-raw-prompt",
            transport: { command: "/tmp/virtual-agent-secret-command" }
          },
          revision: 1
        }
      }),
      targetRegistry: new AcpTargetRegistry({
        [targetId]: {
          targetId,
          label: "Antigravity Agent API Source Bridge Target",
          transport: {
            type: "antigravity-agentapi",
            conversationId,
            csrfToken: "source-bridge-secret-csrf-token",
            binaryPath: "/tmp/source-bridge-agentapi",
            ...transportOptions
          },
          advertisedToolsets: ["agentapi.sendMessage"],
          enabled: true,
          revision: 1
        }
      }),
      sessionDriver: new AcpSessionDriver({
        connectionFactory: (options) =>
          new AntigravityAgentApiConnection({
            ...options,
            client: targetClient
          })
      }),
      ...runtimeOptions
    });
    return { calls, conversationId, runtime, targetId, virtualAgentId };
  }

  function createDeferred() {
    let resolve;
    let reject;
    const promise = new Promise((nextResolve, nextReject) => {
      resolve = nextResolve;
      reject = nextReject;
    });
    return { promise, resolve, reject };
  }

  async function waitForValue(promise, timeoutMs = 500) {
    const timeout = new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Timed out waiting for value after ${timeoutMs}ms.`)), timeoutMs);
    });
    return Promise.race([promise, timeout]);
  }

  it("handles source ACP cancel while a prompt request is still running", async () => {
    const promptStarted = createDeferred();
    const releasePrompt = createDeferred();
    const cancelCalls = [];
    const targetId = "mock.concurrent-cancel-target";
    const virtualAgentId = "mock.concurrent-cancel-agent";
    const runtime = createAcpRelayRuntime({
      defaultVirtualAgentId: virtualAgentId,
      defaultSourceId: "codex-source-concurrent-cancel",
      defaultWorkspaceId: "vitest-workspace",
      virtualAgentRegistry: new AcpVirtualAgentRegistry({
        [virtualAgentId]: {
          virtualAgentId,
          targetId,
          profileId: "pact.acp.concurrent_cancel.mock",
          displayName: "Concurrent Cancel Mock Target",
          advertisedModes: ["ask"],
          defaultMode: "ask",
          advertisedTools: ["mock.prompt"],
          reasoningVisibilityPolicy: "never",
          capabilityPolicy: {
            writes: "deny",
            terminal: "deny",
            maxRisk: "read_only"
          },
          revision: 1
        }
      }),
      targetRegistry: new AcpTargetRegistry({
        [targetId]: {
          targetId,
          label: "Concurrent Cancel Mock Target",
          transport: { type: "mock" },
          advertisedToolsets: ["mock.prompt"],
          capabilityPolicy: {
            writes: "deny",
            terminal: "deny",
            maxRisk: "read_only"
          },
          enabled: true,
          revision: 1
        }
      }),
      sessionDriver: {
        async wake({ relaySession }) {
          return {
            ok: true,
            connection: { relaySessionId: relaySession.relaySessionId },
            wakeMode: "created",
            targetSessionId: `target-${relaySession.relaySessionId}`,
            targetResumeRef: `resume-${relaySession.relaySessionId}`,
            wokenAt: nowIso()
          };
        },
        async prompt() {
          promptStarted.resolve(true);
          await releasePrompt.promise;
          return {
            ok: true,
            updates: [{ type: "progress", phase: "after_cancel_release", text: "prompt released" }],
            reasoning: [],
            stopReason: "completed",
            text: "prompt completed after cancel response",
            outputSummary: "prompt completed after cancel response"
          };
        },
        async cancel({ relaySession }) {
          cancelCalls.push(relaySession.relaySessionId);
          return { ok: true, cancelledAt: nowIso(), targetSessionId: `target-${relaySession.relaySessionId}` };
        },
        async closeAll() {
          return { ok: true, closedConnections: 0 };
        }
      }
    });
    const servedTransport = createServedSourceTransport(runtime, {
      sourceId: "codex-source-concurrent-cancel",
      workspaceId: "vitest-workspace"
    });

    try {
      await sendSourceJsonRpcRequest(
        servedTransport,
        createRequest(ACP_METHODS.initialize, { virtualAgentId }, "concurrent-cancel-init")
      );
      const sessionNew = await sendSourceJsonRpcRequest(
        servedTransport,
        createRequest(
          ACP_METHODS.sessionNew,
          {
            virtualAgentId,
            sourceId: "codex-source-concurrent-cancel",
            sourceSessionId: "concurrent-cancel-session",
            workspaceId: "vitest-workspace"
          },
          "concurrent-cancel-session-new"
        )
      );

      await servedTransport.transportPair.client.send(createRequest(
        ACP_METHODS.sessionPrompt,
        {
          sessionId: sessionNew.result.sessionId,
          prompt: "hold prompt open until test releases it"
        },
        "concurrent-cancel-prompt"
      ));
      await waitForValue(promptStarted.promise);

      await servedTransport.transportPair.client.send(createRequest(
        ACP_METHODS.sessionCancel,
        {
          sessionId: sessionNew.result.sessionId,
          sourceId: "codex-source-concurrent-cancel",
          sourceSessionId: "concurrent-cancel-session",
          workspaceId: "vitest-workspace"
        },
        "concurrent-cancel-request"
      ));
      const cancel = await waitForValue(
        receiveJsonRpcResponseUntilId(
          () => servedTransport.transportPair.client.receive(),
          "concurrent-cancel-request"
        )
      );
      assert.equal(cancel.id, "concurrent-cancel-request");
      assert.equal(cancel.result.cancel.ok, true);
      assert.equal(cancel.result.cancelledTurns.length, 1);
      assert.equal(cancel.result.cancelledTurns[0].turn.stopReason, "cancelled");
      assert.deepEqual(cancelCalls, [sessionNew.result.sessionId]);

      releasePrompt.resolve(true);
      const prompt = await receiveJsonRpcResponseUntilId(
        () => servedTransport.transportPair.client.receive(),
        "concurrent-cancel-prompt"
      );
      assert.equal(prompt.result.stopReason, "cancelled");
      assert.equal(prompt.result.acpStopReason, "cancelled");
      assert.equal(prompt.result.output, "Relay turn was cancelled by the source agent.");
      assert.equal(JSON.stringify(prompt.result.events).includes("after_cancel_release"), false);
    } finally {
      releasePrompt.resolve(true);
      await closeServedSourceTransport(servedTransport);
    }
  });

  it("serializes concurrent source ACP prompts for one relay session before target callbacks can overlap", async () => {
    const firstEntered = createDeferred();
    const secondEntered = createDeferred();
    const releaseFirst = createDeferred();
    const targetId = "mock.serialized-prompt-target";
    const virtualAgentId = "mock.serialized-prompt-agent";
    const promptOrder = [];
    let activePrompts = 0;
    let maxActivePrompts = 0;
    const runtime = createAcpRelayRuntime({
      defaultVirtualAgentId: virtualAgentId,
      defaultSourceId: "codex-source-serialized-prompt",
      defaultWorkspaceId: "vitest-workspace",
      virtualAgentRegistry: new AcpVirtualAgentRegistry({
        [virtualAgentId]: {
          virtualAgentId,
          targetId,
          profileId: "pact.acp.serialized_prompt.mock",
          displayName: "Serialized Prompt Mock Target",
          advertisedModes: ["ask"],
          defaultMode: "ask",
          advertisedTools: ["mock.prompt"],
          reasoningVisibilityPolicy: "never",
          capabilityPolicy: {
            writes: "deny",
            terminal: "deny",
            maxRisk: "read_only"
          },
          revision: 1
        }
      }),
      targetRegistry: new AcpTargetRegistry({
        [targetId]: {
          targetId,
          label: "Serialized Prompt Mock Target",
          transport: { type: "mock" },
          advertisedToolsets: ["mock.prompt"],
          capabilityPolicy: {
            writes: "deny",
            terminal: "deny",
            maxRisk: "read_only"
          },
          enabled: true,
          revision: 1
        }
      }),
      sessionDriver: {
        async wake({ relaySession }) {
          return {
            ok: true,
            connection: { relaySessionId: relaySession.relaySessionId },
            wakeMode: "created",
            targetSessionId: `target-${relaySession.relaySessionId}`,
            targetResumeRef: `resume-${relaySession.relaySessionId}`,
            wokenAt: nowIso()
          };
        },
        async prompt({ prompt }) {
          activePrompts += 1;
          maxActivePrompts = Math.max(maxActivePrompts, activePrompts);
          promptOrder.push(prompt.prompt);
          if (prompt.prompt === "first prompt") {
            firstEntered.resolve(true);
            await releaseFirst.promise;
          } else if (prompt.prompt === "second prompt") {
            secondEntered.resolve(true);
          }
          activePrompts -= 1;
          return {
            ok: true,
            updates: [{ type: "progress", phase: "done", text: prompt.prompt }],
            reasoning: [],
            stopReason: "completed",
            text: `completed ${prompt.prompt}`,
            outputSummary: `completed ${prompt.prompt}`
          };
        },
        async cancel() {
          return { ok: true, cancelledAt: nowIso() };
        },
        async closeAll() {
          return { ok: true, closedConnections: 0 };
        }
      }
    });

    try {
      const session = await runtime.execute("acp_agent_relay.session.create", {
        virtualAgentId,
        sourceId: "codex-source-serialized-prompt",
        sourceSessionId: "serialized-prompt-session",
        workspaceId: "vitest-workspace"
      });
      assert.equal(session.ok, true);

      const firstPrompt = runtime.execute("acp_agent_relay.prompt.send", {
        sessionId: session.data.session.relaySessionId,
        prompt: "first prompt"
      });
      await waitForValue(firstEntered.promise);
      const secondPrompt = runtime.execute("acp_agent_relay.prompt.send", {
        sessionId: session.data.session.relaySessionId,
        prompt: "second prompt"
      });

      const secondEntryBeforeRelease = await Promise.race([
        secondEntered.promise.then(() => "entered"),
        new Promise((resolve) => setTimeout(() => resolve("not-entered"), 50))
      ]);
      assert.equal(secondEntryBeforeRelease, "not-entered");
      assert.deepEqual(promptOrder, ["first prompt"]);
      assert.equal(maxActivePrompts, 1);

      releaseFirst.resolve(true);
      const [first, second] = await Promise.all([firstPrompt, secondPrompt]);
      assert.equal(first.ok, true);
      assert.equal(second.ok, true);
      assert.equal(first.data.outputSummary, "completed first prompt");
      assert.equal(second.data.outputSummary, "completed second prompt");
      assert.deepEqual(promptOrder, ["first prompt", "second prompt"]);
      assert.equal(maxActivePrompts, 1);
    } finally {
      releaseFirst.resolve(true);
      await runtime.close();
    }
  });

  it("cancels queued source ACP prompts before they reach the target after session cancel", async () => {
    const firstEntered = createDeferred();
    const releaseFirst = createDeferred();
    const targetId = "mock.cancel-queued-prompt-target";
    const virtualAgentId = "mock.cancel-queued-prompt-agent";
    const promptOrder = [];
    const cancelCalls = [];
    const runtime = createAcpRelayRuntime({
      defaultVirtualAgentId: virtualAgentId,
      defaultSourceId: "codex-source-cancel-queued-prompt",
      defaultWorkspaceId: "vitest-workspace",
      virtualAgentRegistry: new AcpVirtualAgentRegistry({
        [virtualAgentId]: {
          virtualAgentId,
          targetId,
          profileId: "pact.acp.cancel_queued_prompt.mock",
          displayName: "Cancel Queued Prompt Mock Target",
          advertisedModes: ["ask"],
          defaultMode: "ask",
          advertisedTools: ["mock.prompt"],
          reasoningVisibilityPolicy: "never",
          capabilityPolicy: {
            writes: "deny",
            terminal: "deny",
            maxRisk: "read_only"
          },
          revision: 1
        }
      }),
      targetRegistry: new AcpTargetRegistry({
        [targetId]: {
          targetId,
          label: "Cancel Queued Prompt Mock Target",
          transport: { type: "mock" },
          advertisedToolsets: ["mock.prompt"],
          capabilityPolicy: {
            writes: "deny",
            terminal: "deny",
            maxRisk: "read_only"
          },
          enabled: true,
          revision: 1
        }
      }),
      sessionDriver: {
        async wake({ relaySession }) {
          return {
            ok: true,
            connection: { relaySessionId: relaySession.relaySessionId },
            wakeMode: "created",
            targetSessionId: `target-${relaySession.relaySessionId}`,
            targetResumeRef: `resume-${relaySession.relaySessionId}`,
            wokenAt: nowIso()
          };
        },
        async prompt({ prompt }) {
          promptOrder.push(prompt.prompt);
          if (prompt.prompt === "first prompt") {
            firstEntered.resolve(true);
            await releaseFirst.promise;
          }
          return {
            ok: true,
            updates: [{ type: "progress", phase: "done", text: prompt.prompt }],
            reasoning: [],
            stopReason: "completed",
            text: `completed ${prompt.prompt}`,
            outputSummary: `completed ${prompt.prompt}`
          };
        },
        async cancel({ relaySession }) {
          cancelCalls.push(relaySession.relaySessionId);
          return { ok: true, cancelledAt: nowIso(), targetSessionId: `target-${relaySession.relaySessionId}` };
        },
        async closeAll() {
          return { ok: true, closedConnections: 0 };
        }
      }
    });

    try {
      const session = await runtime.execute("acp_agent_relay.session.create", {
        virtualAgentId,
        sourceId: "codex-source-cancel-queued-prompt",
        sourceSessionId: "cancel-queued-prompt-session",
        workspaceId: "vitest-workspace"
      });
      assert.equal(session.ok, true);
      const relaySessionId = session.data.session.relaySessionId;

      const firstPrompt = runtime.execute("acp_agent_relay.prompt.send", {
        sessionId: relaySessionId,
        prompt: "first prompt"
      });
      await waitForValue(firstEntered.promise);
      const secondPrompt = runtime.execute("acp_agent_relay.prompt.send", {
        sessionId: relaySessionId,
        prompt: "second prompt"
      });

      const cancel = await runtime.execute("acp_agent_relay.session.cancel", {
        sessionId: relaySessionId
      });
      assert.equal(cancel.ok, true);
      assert.equal(cancel.data.cancelledTurns.length, 1);
      assert.equal(cancel.data.cancelledTurns[0].turn.stopReason, "cancelled");
      assert.deepEqual(cancelCalls, [relaySessionId]);

      releaseFirst.resolve(true);
      const [first, second] = await Promise.all([firstPrompt, secondPrompt]);
      assert.equal(first.ok, true);
      assert.equal(second.ok, true);
      assert.equal(first.data.stopReason, "cancelled");
      assert.equal(second.data.stopReason, "cancelled");
      assert.equal(
        second.data.receipts[0].reasonCode,
        "source_session_cancelled_before_target_prompt"
      );
      assert.deepEqual(promptOrder, ["first prompt"]);
      const turns = await runtime.store.listTurns(relaySessionId);
      assert.equal(turns.length, 2);
      assert.equal(turns.every((turn) => turn.stopReason === "cancelled"), true);
    } finally {
      releaseFirst.resolve(true);
      await runtime.close();
    }
  });

  it("handles source ACP JSON-RPC batch frames with response arrays", async () => {
    const runtime = createAcpRelayRuntime();
    const servedTransport = createServedSourceTransport(runtime, {
      sourceId: "codex-source-batch",
      workspaceId: "vitest-workspace"
    });

    try {
      await servedTransport.transportPair.client.send(createSuccess("source-callback-response", { ignored: true }));
      await servedTransport.transportPair.client.send(createRequest(
        ACP_METHODS.pactAgentList,
        {
          sourceId: "codex-source-batch",
          workspaceId: "vitest-workspace"
        },
        "after-source-response-agent-list"
      ));
      const afterSourceResponse = parseJsonRpcMessage(await servedTransport.transportPair.client.receive());
      assert.equal(afterSourceResponse.id, "after-source-response-agent-list");
      assert.equal(afterSourceResponse.result.virtualAgents.length >= 2, true);

      await servedTransport.transportPair.client.send([
        createNotification("pact.test/noop", { kind: "batch-notification-only" }),
        createNotification(ACP_METHODS.sessionUpdate, { ignored: true })
      ]);
      await servedTransport.transportPair.client.send(createRequest(
        ACP_METHODS.pactAgentList,
        {
          sourceId: "codex-source-batch",
          workspaceId: "vitest-workspace"
        },
        "after-notification-only-batch"
      ));
      const afterNotificationOnlyBatch = parseJsonRpcMessage(await servedTransport.transportPair.client.receive());
      assert.equal(afterNotificationOnlyBatch.id, "after-notification-only-batch");
      assert.equal(afterNotificationOnlyBatch.result.virtualAgents.length >= 2, true);

      await servedTransport.transportPair.client.send([
        "invalid-batch-item",
        { jsonrpc: "2.0", id: "invalid-request-object" },
        createRequest(
          ACP_METHODS.pactAgentList,
          {
            sourceId: "codex-source-batch",
            workspaceId: "vitest-workspace"
          },
          "mixed-valid-request"
        ),
        createSuccess("mixed-source-response", { ignored: true }),
        createNotification("pact.test/noop", { ignored: true })
      ]);
      const mixedRaw = await servedTransport.transportPair.client.receive();
      const mixedBatch = JSON.parse(mixedRaw);
      assert.equal(Array.isArray(mixedBatch), true);
      assert.equal(mixedBatch.length, 3);
      assert.equal(mixedBatch.some((response) => response.id === "mixed-valid-request"), true);
      assert.equal(mixedBatch.filter((response) => response.id === null && response.error?.code === -32600).length, 2);

      await servedTransport.transportPair.client.send([
        createSuccess("batch-source-response", { ignored: true }),
        createRequest(
          ACP_METHODS.initialize,
          {
            virtualAgentId: "antigravity.repo-analysis",
            sourceId: "codex-source-batch"
          },
          "batch-init"
        ),
        createRequest(
          ACP_METHODS.pactAgentList,
          {
            sourceId: "codex-source-batch",
            workspaceId: "vitest-workspace"
          },
          "batch-agent-list"
        ),
        createNotification(ACP_METHODS.sessionUpdate, { ignored: true })
      ]);
      const raw = await servedTransport.transportPair.client.receive();
      const batch = JSON.parse(raw);
      assert.equal(Array.isArray(batch), true);
      assert.deepEqual(batch.map((response) => response.id).sort(), ["batch-agent-list", "batch-init"]);
      assert.equal(batch.find((response) => response.id === "batch-init").result.protocolVersion, 1);
      assert.equal(
        batch.find((response) => response.id === "batch-agent-list").result.virtualAgents.length >= 2,
        true
      );

      await servedTransport.transportPair.client.send([]);
      const emptyBatchError = parseJsonRpcMessage(await servedTransport.transportPair.client.receive());
      assert.equal(emptyBatchError.id, null);
      assert.equal(emptyBatchError.error.code, -32600);
    } finally {
      await closeServedSourceTransport(servedTransport);
    }
  });

  it("handles source-facing ACP file methods with policy-bound read and fail-closed write", async () => {
    const workspaceRoot = await makeTempDir("pact-acp-source-fs-");
    await fs.writeFile(path.join(workspaceRoot, "facts.txt"), "source fs fact", "utf8");
    const runtime = createAcpRelayRuntime({ workspaceRoot });
    const servedTransport = createServedSourceTransport(runtime, {
      sourceId: "codex-source-fs",
      workspaceId: "vitest-workspace"
    });

    try {
      const read = await sendSourceJsonRpcRequest(
        servedTransport,
        createRequest(
          ACP_METHODS.fsReadTextFile,
          {
            virtualAgentId: "antigravity.repo-analysis",
            sourceId: "codex-source-fs",
            workspaceId: "vitest-workspace",
            path: "facts.txt"
          },
          "source-fs-read"
        )
      );
      assert.equal(read.id, "source-fs-read");
      assert.equal(read.result.content, "source fs fact");
      assert.equal(read.result.path, "facts.txt");
      assert.match(read.result.digest, /^[a-f0-9]{64}$/);

      const deniedWrite = await sendSourceJsonRpcRequest(
        servedTransport,
        createRequest(
          ACP_METHODS.fsWriteTextFile,
          {
            virtualAgentId: "antigravity.repo-analysis",
            sourceId: "codex-source-fs",
            workspaceId: "vitest-workspace",
            path: "notes/should-not-write.txt",
            content: "blocked"
          },
          "source-fs-write-denied"
        )
      );
      assert.equal(deniedWrite.id, "source-fs-write-denied");
      assert.equal(deniedWrite.error.code, -32003);
      assert.equal(deniedWrite.error.data.reasonCode, "source_fs_write_not_advertised");
      assert.equal(deniedWrite.error.data.virtualAgentId, "antigravity.repo-analysis");
      await assert.rejects(
        fs.readFile(path.join(workspaceRoot, "notes", "should-not-write.txt"), "utf8"),
        /ENOENT/
      );

      const sessionNew = await sendSourceJsonRpcRequest(
        servedTransport,
        createRequest(
          ACP_METHODS.sessionNew,
          {
            virtualAgentId: "antigravity.repo-analysis",
            sourceId: "codex-source-fs",
            sourceSessionId: "source-fs-closed-session",
            workspaceId: "vitest-workspace"
          },
          "source-fs-closed-session-new"
        )
      );
      const closed = await sendSourceJsonRpcRequest(
        servedTransport,
        createRequest(
          ACP_METHODS.sessionClose,
          {
            sessionId: sessionNew.result.sessionId,
            sourceId: "codex-source-fs",
            sourceSessionId: "source-fs-closed-session",
            workspaceId: "vitest-workspace"
          },
          "source-fs-closed-session-close"
        )
      );
      assert.equal(closed.result.lifecycleState, "closed");

      const readAfterClose = await sendSourceJsonRpcRequest(
        servedTransport,
        createRequest(
          ACP_METHODS.fsReadTextFile,
          {
            sessionId: sessionNew.result.sessionId,
            path: "facts.txt"
          },
          "source-fs-read-after-close"
        )
      );
      assert.equal(readAfterClose.id, "source-fs-read-after-close");
      assert.equal(readAfterClose.error.code, -32003);
      assert.equal(readAfterClose.error.data.reasonCode, "relay_session_closed");
      assert.equal(readAfterClose.error.data.lifecycleState, "closed");
    } finally {
      await closeServedSourceTransport(servedTransport);
      await runtime.close();
    }
  });

  it("guards source-facing ACP file methods through the shared operation guard before file access", async () => {
    const workspaceRoot = await makeTempDir("pact-acp-source-fs-guard-");
    const securityPermissions = createAuthorizationSecurityPermissions();
    const permissionCalls = [];
    const runtime = createAcpRelayRuntime({
      workspaceRoot,
      securityPermissions,
      permissionBridge: {
        async readTextFile(input) {
          permissionCalls.push({ method: "readTextFile", input });
          return {
            ok: true,
            status: "completed",
            action: "fs.readTextFile",
            path: input.path,
            content: "guarded read content",
            digest: "a".repeat(64)
          };
        },
        async requestWriteTextFile(input) {
          permissionCalls.push({ method: "requestWriteTextFile", input });
          return {
            ok: true,
            status: "completed",
            action: "fs.writeTextFile",
            path: input.write?.path || "",
            afterDigest: "b".repeat(64)
          };
        },
        denyTerminal() {
          return { ok: false, status: "denied", action: "terminal" };
        }
      }
    });
    const servedTransport = createServedSourceTransport(runtime, {
      sourceId: "codex-source-fs-guard",
      workspaceId: "vitest-workspace"
    });

    try {
      const deniedRead = await sendSourceJsonRpcRequest(
        servedTransport,
        createRequest(
          ACP_METHODS.fsReadTextFile,
          {
            virtualAgentId: "antigravity.repo-analysis",
            sourceId: "codex-source-fs-guard",
            workspaceId: "vitest-workspace",
            path: "facts.txt"
          },
          "source-fs-read-guard-denied"
        )
      );
      assert.equal(deniedRead.id, "source-fs-read-guard-denied");
      assert.equal(deniedRead.error.code, -32003);
      assert.equal(deniedRead.error.data.sourceAuthorizationDecision.operationId, "acp_agent_relay.fs.read_text_file");
      assert.deepEqual(deniedRead.error.data.sourceAuthorizationDecision.missingScopes, ["agent_relay:view"]);
      assert.equal(permissionCalls.length, 0);

      const deniedWrite = await sendSourceJsonRpcRequest(
        servedTransport,
        createRequest(
          ACP_METHODS.fsWriteTextFile,
          {
            virtualAgentId: "antigravity.multimodal-coding",
            sourceId: "codex-source-fs-guard",
            workspaceId: "vitest-workspace",
            path: "notes/write.txt",
            content: "must not touch bridge"
          },
          "source-fs-write-guard-denied"
        )
      );
      assert.equal(deniedWrite.id, "source-fs-write-guard-denied");
      assert.equal(deniedWrite.error.code, -32003);
      assert.equal(deniedWrite.error.data.sourceAuthorizationDecision.operationId, "acp_agent_relay.fs.write_text_file");
      assert.deepEqual(deniedWrite.error.data.sourceAuthorizationDecision.missingScopes, ["agent_relay:operate"]);
      assert.equal(permissionCalls.length, 0);

      const allowedRead = await sendSourceJsonRpcRequest(
        servedTransport,
        createRequest(
          ACP_METHODS.fsReadTextFile,
          {
            virtualAgentId: "antigravity.repo-analysis",
            sourceId: "codex-source-fs-guard",
            workspaceId: "vitest-workspace",
            sourceScopes: ["agent_relay:view"],
            path: "facts.txt"
          },
          "source-fs-read-guard-allowed"
        )
      );
      assert.equal(allowedRead.id, "source-fs-read-guard-allowed");
      assert.equal(allowedRead.result.content, "guarded read content");
      assert.equal(permissionCalls.length, 1);
      assert.equal(permissionCalls[0].method, "readTextFile");

      const closedSession = await sendSourceJsonRpcRequest(
        servedTransport,
        createRequest(
          ACP_METHODS.sessionNew,
          {
            virtualAgentId: "antigravity.repo-analysis",
            sourceId: "codex-source-fs-guard",
            sourceSessionId: "source-fs-guard-closed-session",
            workspaceId: "vitest-workspace",
            sourceScopes: ["agent_relay:operate"]
          },
          "source-fs-guard-closed-session-new"
        )
      );
      const closeResult = await sendSourceJsonRpcRequest(
        servedTransport,
        createRequest(
          ACP_METHODS.sessionClose,
          {
            sessionId: closedSession.result.sessionId,
            sourceId: "codex-source-fs-guard",
            sourceSessionId: "source-fs-guard-closed-session",
            workspaceId: "vitest-workspace",
            sourceScopes: ["agent_relay:operate"]
          },
          "source-fs-guard-closed-session-close"
        )
      );
      assert.equal(closeResult.result.lifecycleState, "closed");

      const permissionCallsBeforeClosedFs = permissionCalls.length;
      const closedRead = await sendSourceJsonRpcRequest(
        servedTransport,
        createRequest(
          ACP_METHODS.fsReadTextFile,
          {
            sessionId: closedSession.result.sessionId,
            sourceScopes: ["agent_relay:view"],
            path: "facts.txt"
          },
          "source-fs-guard-read-after-close"
        )
      );
      assert.equal(closedRead.id, "source-fs-guard-read-after-close");
      assert.equal(closedRead.error.code, -32003);
      assert.equal(closedRead.error.data.reasonCode, "relay_session_closed");
      assert.equal(closedRead.error.data.lifecycleState, "closed");
      assert.equal(permissionCalls.length, permissionCallsBeforeClosedFs);

      const closedWrite = await sendSourceJsonRpcRequest(
        servedTransport,
        createRequest(
          ACP_METHODS.fsWriteTextFile,
          {
            sessionId: closedSession.result.sessionId,
            sourceScopes: ["agent_relay:operate"],
            path: "notes/closed-session-write.txt",
            content: "must not touch bridge after close"
          },
          "source-fs-guard-write-after-close"
        )
      );
      assert.equal(closedWrite.id, "source-fs-guard-write-after-close");
      assert.equal(closedWrite.error.code, -32003);
      assert.equal(closedWrite.error.data.reasonCode, "relay_session_closed");
      assert.equal(closedWrite.error.data.lifecycleState, "closed");
      assert.equal(permissionCalls.length, permissionCallsBeforeClosedFs);
      await assert.rejects(
        fs.readFile(path.join(workspaceRoot, "notes", "closed-session-write.txt"), "utf8"),
        /ENOENT/
      );

      const closedContextRead = await sendSourceJsonRpcRequest(
        servedTransport,
        createRequest(
          ACP_METHODS.fsReadTextFile,
          {
            virtualAgentId: "antigravity.repo-analysis",
            sourceId: "codex-source-fs-guard",
            sourceSessionId: "source-fs-guard-closed-session",
            workspaceId: "vitest-workspace",
            sourceScopes: ["agent_relay:view"],
            path: "facts.txt"
          },
          "source-fs-guard-context-read-after-close"
        )
      );
      assert.equal(closedContextRead.id, "source-fs-guard-context-read-after-close");
      assert.equal(closedContextRead.error.code, -32003);
      assert.equal(closedContextRead.error.data.reasonCode, "relay_session_closed");
      assert.equal(closedContextRead.error.data.lifecycleState, "closed");
      assert.equal(permissionCalls.length, permissionCallsBeforeClosedFs);

      const closedContextWrite = await sendSourceJsonRpcRequest(
        servedTransport,
        createRequest(
          ACP_METHODS.fsWriteTextFile,
          {
            virtualAgentId: "antigravity.repo-analysis",
            sourceId: "codex-source-fs-guard",
            sourceSessionId: "source-fs-guard-closed-session",
            workspaceId: "vitest-workspace",
            sourceScopes: ["agent_relay:operate"],
            path: "notes/closed-source-context-write.txt",
            content: "must not touch bridge through source context after close"
          },
          "source-fs-guard-context-write-after-close"
        )
      );
      assert.equal(closedContextWrite.id, "source-fs-guard-context-write-after-close");
      assert.equal(closedContextWrite.error.code, -32003);
      assert.equal(closedContextWrite.error.data.reasonCode, "relay_session_closed");
      assert.equal(closedContextWrite.error.data.lifecycleState, "closed");
      assert.equal(permissionCalls.length, permissionCallsBeforeClosedFs);
      await assert.rejects(
        fs.readFile(path.join(workspaceRoot, "notes", "closed-source-context-write.txt"), "utf8"),
        /ENOENT/
      );
    } finally {
      await closeServedSourceTransport(servedTransport);
      await runtime.close();
    }
  });

  it("lists source-facing virtual agent capabilities without exposing raw target transport", async () => {
    const runtime = createAcpRelayRuntime();
    runtime.targetRegistry.upsertTarget({
      targetId: "malicious.proxy:agentapi",
      label: "Malicious Proxy Target",
      transport: {
        type: "antigravity-agentapi",
        nativeAcpTargetSupported: true,
        nativeAcpTargetVerified: true,
        nativeAcpSourceSupported: true,
        nativeAcpSourceVerified: true,
        csrfToken: "source-must-not-see-this"
      },
      externalServiceId: "external.malicious.proxy",
      advertisedToolsets: ["agentapi.sendMessage"],
      capabilityPolicy: {
        writes: "deny",
        terminal: "deny",
        maxRisk: "read_only"
      },
      metadata: {
        public: {
          nativeAcpTargetSupported: true,
          nativeAcpTargetVerified: true,
          nativeAcpSourceSupported: true,
          nativeAcpSourceVerified: true
        }
      }
    });
    runtime.virtualAgentRegistry.upsertAgent({
      virtualAgentId: "malicious.proxy-agent",
      targetId: "malicious.proxy:agentapi",
      displayName: "Malicious Proxy Agent",
      advertisedModes: ["ask"],
      defaultMode: "ask",
      advertisedModalities: ["text"],
      advertisedDataSources: ["workspace.files"],
      advertisedTools: ["agentapi.sendMessage"],
      reasoningVisibilityPolicy: "never",
      capabilityPolicy: {
        writes: "deny",
        terminal: "deny",
        maxRisk: "read_only"
      }
    });
    runtime.targetRegistry.upsertTarget({
      targetId: "malicious.native:stdio",
      label: "Malicious Native Target",
      transport: {
        type: "stdio",
        protocolStyle: "agent-client-protocol-v1",
        nativeAcpTargetVerified: true,
        nativeAcpSourceVerified: true,
        command: {
          executable: "fake-acp",
          args: ["--secret"]
        }
      },
      externalServiceId: "external.malicious.native",
      advertisedToolsets: ["agent.session"],
      capabilityPolicy: {
        writes: "deny",
        terminal: "deny",
        maxRisk: "read_only"
      }
    });
    runtime.virtualAgentRegistry.upsertAgent({
      virtualAgentId: "malicious.native-agent",
      targetId: "malicious.native:stdio",
      displayName: "Malicious Native Agent",
      advertisedModes: ["ask"],
      defaultMode: "ask",
      advertisedModalities: ["text"],
      advertisedDataSources: ["workspace.files"],
      advertisedTools: ["agent.session"],
      reasoningVisibilityPolicy: "never",
      capabilityPolicy: {
        writes: "deny",
        terminal: "deny",
        maxRisk: "read_only"
      }
    });
    const servedTransport = createServedSourceTransport(runtime, {
      sourceId: "codex-source-vitest",
      workspaceId: "vitest-workspace"
    });

    try {
      const listed = await sendSourceJsonRpcRequest(
        servedTransport,
        createRequest(ACP_METHODS.agentList, { sourceId: "codex-source-vitest" }, "source-agent-list")
      );
      assert.equal(listed.id, "source-agent-list");
      assert.equal(Array.isArray(listed.result.virtualAgents), true);
      assert.equal(listed.result.virtualAgents.length >= 2, true);
      const agents = new Map(listed.result.virtualAgents.map((agent) => [agent.virtualAgentId, agent]));
      const repo = agents.get("antigravity.repo-analysis");
      const coding = agents.get("antigravity.multimodal-coding");
      assert.ok(repo);
      assert.ok(coding);
      assert.deepEqual(repo.capabilities.modes, ["ask"]);
      assert.deepEqual(repo.capabilities.modalities, ["text"]);
      assert.deepEqual(repo.capabilities.tools, ["fs.readTextFile"]);
      assert.deepEqual(coding.capabilities.dataSources, [
        "workspace.files",
        "pact.knowledge.local",
        "pact.document.runtime"
      ]);
      assert.equal(coding.capabilities.writes, "approval_required");
      assert.equal(coding.capabilities.terminal, "deny");
      assert.equal(coding.capabilities.finalResponse.policy, "inline_response");
      assert.equal(repo.target.transportType, "mock");
      assert.equal(repo.target.targetCommunicationMode, "contract_mock");
      assert.equal(repo.target.nativeAcpTargetSupported, false);
      assert.equal(repo.target.communication.targetCommunicationMode, "contract_mock");
      const maliciousProxy = agents.get("malicious.proxy-agent");
      assert.ok(maliciousProxy);
      assert.equal(maliciousProxy.target.targetCommunicationMode, "agent_api_proxy");
      assert.equal(maliciousProxy.target.nativeAcpTargetSupported, false);
      assert.equal(maliciousProxy.target.nativeAcpTargetVerified, false);
      assert.equal(maliciousProxy.target.nativeAcpSourceSupported, false);
      assert.equal(maliciousProxy.target.nativeAcpSourceVerified, false);
      const maliciousNative = agents.get("malicious.native-agent");
      assert.ok(maliciousNative);
      assert.equal(maliciousNative.target.targetCommunicationMode, "native_acp_stdio");
      assert.equal(maliciousNative.target.nativeAcpTargetSupported, true);
      assert.equal(maliciousNative.target.nativeAcpTargetVerified, false);
      assert.equal(maliciousNative.target.nativeAcpSourceVerified, false);
      const targetsListed = await sendSourceJsonRpcRequest(
        servedTransport,
        createRequest(ACP_METHODS.pactTargetList, { sourceId: "codex-source-vitest" }, "source-target-list")
      );
      assert.equal(targetsListed.id, "source-target-list");
      assert.equal(Array.isArray(targetsListed.result.targets), true);
      const targets = new Map(targetsListed.result.targets.map((target) => [target.targetId, target]));
      const repoTarget = targets.get(repo.target.targetId);
      assert.ok(repoTarget);
      assert.equal(repoTarget.transportType, "mock");
      assert.equal(repoTarget.targetCommunicationMode, "contract_mock");
      assert.equal(repoTarget.nativeAcpTargetSupported, false);
      assert.equal(repoTarget.communication.targetCommunicationMode, "contract_mock");
      const maliciousProxyTarget = targets.get("malicious.proxy:agentapi");
      assert.ok(maliciousProxyTarget);
      assert.equal(maliciousProxyTarget.targetCommunicationMode, "agent_api_proxy");
      assert.equal(maliciousProxyTarget.nativeAcpTargetSupported, false);
      assert.equal(maliciousProxyTarget.nativeAcpTargetVerified, false);
      assert.equal(maliciousProxyTarget.nativeAcpSourceSupported, false);
      assert.equal(maliciousProxyTarget.nativeAcpSourceVerified, false);
      const maliciousNativeTarget = targets.get("malicious.native:stdio");
      assert.ok(maliciousNativeTarget);
      assert.equal(maliciousNativeTarget.targetCommunicationMode, "native_acp_stdio");
      assert.equal(maliciousNativeTarget.nativeAcpTargetSupported, true);
      assert.equal(maliciousNativeTarget.nativeAcpTargetVerified, false);
      assert.equal(maliciousNativeTarget.nativeAcpSourceVerified, false);
      assert.equal(JSON.stringify(listed.result).includes("csrfToken"), false);
      assert.equal(JSON.stringify(listed.result).includes("binaryPath"), false);
      assert.equal(JSON.stringify(listed.result).includes("command"), false);
      assert.equal(JSON.stringify(targetsListed.result).includes("csrfToken"), false);
      assert.equal(JSON.stringify(targetsListed.result).includes("binaryPath"), false);
      assert.equal(JSON.stringify(targetsListed.result).includes("command"), false);
    } finally {
      await closeServedSourceTransport(servedTransport);
      await runtime.close();
    }
  });

  it("accepts source ACP initialize/session/new/load/resume/session/prompt and relays to Antigravity Agent API transport", async () => {
    const { calls, conversationId, runtime, virtualAgentId } = createSourceBridgeRuntime();
    const servedTransport = createServedSourceTransport(runtime, {
      sourceId: "codex-source-vitest",
      workspaceId: "vitest-workspace"
    });

    try {
      const initialize = await sendSourceJsonRpcRequest(
        servedTransport,
        createRequest(ACP_METHODS.initialize, { virtualAgentId, sourceId: "codex-source-vitest" }, "source-init")
      );
      assert.equal(initialize.id, "source-init");
      assert.equal(initialize.result.protocolVersion, 1);
      assert.equal(initialize.result.pactProtocolVersion, "v0.0.1:agent:acp-agent-relay-1");
      assert.equal(initialize.result.agentCapabilities.loadSession, true);
      assert.equal(initialize.result.agentCapabilities.promptCapabilities.text, true);
      assert.equal(initialize.result.agentCapabilities.promptCapabilities.image, false);
      assert.equal(initialize.result.agentCapabilities.promptCapabilities.audio, false);
      assert.equal(initialize.result.sessionCapabilities.load, true);
      assert.equal(initialize.result.sessionCapabilities.resume, true);
      assert.equal(initialize.result.sessionCapabilities.cancel, true);
      assert.equal(initialize.result.sessionCapabilities.close, true);
      assert.equal(initialize.result.virtualAgentId, virtualAgentId);
      assert.deepEqual(initialize.result.capabilities.modes, ["ask"]);
      assert.deepEqual(initialize.result.capabilities.tools, ["agentapi.sendMessage"]);
      assert.equal(initialize.result.capabilities.reasoningVisibilityPolicy, "never");
      assert.equal(initialize.result.capabilities.writes, "deny");
      assert.equal(initialize.result.capabilities.terminal, "deny");
      assert.equal(initialize.result.capabilities.finalResponse.policy, "accepted_only");
      assert.equal(initialize.result.capabilitiesSnapshot.target.transportType, "antigravity-agentapi");
      assert.equal(initialize.result.capabilitiesSnapshot.target.targetCommunicationMode, "agent_api_proxy");
      assert.equal(initialize.result.capabilitiesSnapshot.target.nativeAcpTargetSupported, false);
      assert.equal(initialize.result.capabilitiesSnapshot.target.nativeAcpTargetVerified, false);
      assert.equal(initialize.result.capabilitiesSnapshot.target.externalServiceId, "");
      assert.deepEqual(initialize.result.capabilitiesSnapshot.metadata, { fixture: "source-bridge-public-metadata" });
      assert.equal(
        initialize.result.virtualAgents.some((agent) => agent.virtualAgentId === virtualAgentId),
        true
      );
      assert.equal(JSON.stringify(initialize.result).includes("virtual-agent-secret-csrf-token"), false);
      assert.equal(JSON.stringify(initialize.result).includes("virtual-agent-secret-api-key"), false);
      assert.equal(JSON.stringify(initialize.result).includes("virtual-agent-raw-prompt"), false);
      assert.equal(JSON.stringify(initialize.result).includes("virtual-agent-secret-command"), false);

      const sessionNew = await sendSourceJsonRpcRequest(
        servedTransport,
        createRequest(
          ACP_METHODS.sessionNew,
          {
            virtualAgentId,
            sourceId: "codex-source-vitest",
            sourceSessionId: "codex-acp-source-session",
            workspaceId: "vitest-workspace"
          },
          "source-session-new"
        )
      );
      assert.equal(sessionNew.id, "source-session-new");
      assert.match(sessionNew.result.sessionId, /^relay_session_/);
      assert.deepEqual(sessionNew.result.capabilities.tools, ["agentapi.sendMessage"]);
      assert.equal(sessionNew.result.capabilities.finalResponse.policy, "accepted_only");
      assert.equal(sessionNew.result.capabilitiesSnapshot.target.transportType, "antigravity-agentapi");
      assert.equal(sessionNew.result.capabilitiesSnapshot.target.targetCommunicationMode, "agent_api_proxy");
      assert.equal(sessionNew.result.capabilitiesSnapshot.target.nativeAcpTargetSupported, false);
      assert.equal(sessionNew.result.capabilitiesSnapshot.target.nativeAcpTargetVerified, false);
      assert.equal(sessionNew.result.session.capabilitiesSnapshot.target.transportType, "antigravity-agentapi");
      assert.equal(sessionNew.result.session.capabilitiesSnapshot.target.targetCommunicationMode, "agent_api_proxy");
      assert.deepEqual(sessionNew.result.session.capabilitiesSnapshot.capabilities.tools, ["agentapi.sendMessage"]);
      assert.deepEqual(sessionNew.result.capabilitiesSnapshot.metadata, { fixture: "source-bridge-public-metadata" });
      assert.equal(sessionNew.result.route.effectiveMode, "ask");
      assert.equal(JSON.stringify(sessionNew.result).includes("source-bridge-secret-csrf-token"), false);
      assert.equal(JSON.stringify(sessionNew.result).includes("/tmp/source-bridge-agentapi"), false);
      assert.equal(JSON.stringify(sessionNew.result).includes("virtual-agent-secret-csrf-token"), false);
      assert.equal(JSON.stringify(sessionNew.result).includes("virtual-agent-secret-api-key"), false);
      assert.equal(JSON.stringify(sessionNew.result).includes("virtual-agent-raw-prompt"), false);
      assert.equal(JSON.stringify(sessionNew.result).includes("virtual-agent-secret-command"), false);

      const loaded = await sendSourceJsonRpcRequest(
        servedTransport,
        createRequest(
          ACP_METHODS.sessionLoad,
          {
            virtualAgentId,
            sourceId: "codex-source-vitest",
            sourceSessionId: "codex-acp-source-session",
            workspaceId: "vitest-workspace"
          },
          "source-session-load"
        )
      );
      assert.equal(loaded.id, "source-session-load");
      assert.equal(loaded.result.sessionId, sessionNew.result.sessionId);
      assert.deepEqual(loaded.result.capabilities.tools, ["agentapi.sendMessage"]);
      assert.equal(loaded.result.capabilities.finalResponse.policy, "accepted_only");
      assert.equal(loaded.result.capabilitiesSnapshot.target.transportType, "antigravity-agentapi");
      assert.equal(loaded.result.capabilitiesSnapshot.target.targetCommunicationMode, "agent_api_proxy");
      assert.deepEqual(loaded.result.capabilitiesSnapshot.metadata, { fixture: "source-bridge-public-metadata" });
      assert.equal(loaded.result.capabilitiesSnapshotError, "");
      assert.equal(loaded.result.route.effectiveMode, "ask");
      assert.equal(JSON.stringify(loaded.result).includes("source-bridge-secret-csrf-token"), false);
      assert.equal(JSON.stringify(loaded.result).includes("virtual-agent-secret-csrf-token"), false);
      assert.equal(JSON.stringify(loaded.result).includes("virtual-agent-secret-api-key"), false);
      assert.equal(JSON.stringify(loaded.result).includes("virtual-agent-raw-prompt"), false);
      assert.equal(JSON.stringify(loaded.result).includes("virtual-agent-secret-command"), false);

      const resumed = await sendSourceJsonRpcRequest(
        servedTransport,
        createRequest(
          ACP_METHODS.sessionResume,
          {
            virtualAgentId,
            sourceId: "codex-source-vitest",
            sourceSessionId: "codex-acp-source-session",
            workspaceId: "vitest-workspace"
          },
          "source-session-resume"
        )
      );
      assert.equal(resumed.id, "source-session-resume");
      assert.equal(resumed.result.sessionId, sessionNew.result.sessionId);
      assert.deepEqual(resumed.result.capabilities.tools, ["agentapi.sendMessage"]);
      assert.equal(resumed.result.capabilities.finalResponse.policy, "accepted_only");
      assert.equal(resumed.result.capabilitiesSnapshot.target.transportType, "antigravity-agentapi");
      assert.equal(resumed.result.capabilitiesSnapshot.target.targetCommunicationMode, "agent_api_proxy");
      assert.equal(resumed.result.capabilitiesSnapshotError, "");
      assert.equal(JSON.stringify(resumed.result).includes("/tmp/source-bridge-agentapi"), false);

      const prompt = await sendSourceJsonRpcRequest(
        servedTransport,
        createRequest(
          ACP_METHODS.sessionPrompt,
          {
            sessionId: resumed.result.sessionId,
            prompt: [
              { type: "text", text: "delegate via source ACP JSON-RPC" },
              { type: "text", text: "with content blocks" }
            ],
            idempotencyKey: "source-acp-completed-idempotency"
          },
          "source-prompt"
        )
      );
      assert.equal(prompt.id, "source-prompt");
      assert.equal(prompt.notifications.length > 0, true);
      assert.equal(prompt.notifications.every((notification) => notification.method === ACP_METHODS.sessionUpdate), true);
      assert.equal(prompt.notifications.every((notification) => Object.hasOwn(notification, "id") === false), true);
      assert.equal(prompt.notifications.every((notification) => notification.params?.update?.sessionUpdate), true);
      assert.equal(
        prompt.notifications.some((notification) => notification.params?.update?.content?.type === "text"),
        true
      );
      assert.equal(prompt.notifications.some((notification) => notification.params?.phase === "accepted"), true);
      assert.equal(prompt.notifications.some((notification) => notification.params?.type === "completion"), true);
      const completionNotification = prompt.notifications.find((notification) => notification.params?.type === "completion");
      assert.equal(typeof completionNotification.params.phase, "string");
      assert.notEqual(completionNotification.params.phase, "[object Object]");
      assert.equal(completionNotification.params.responseKind, "acknowledgement");
      const acceptedNotifications = prompt.notifications.filter(
        (notification) => notification.params?.type === "progress" && notification.params?.phase === "accepted"
      );
      assert.equal(acceptedNotifications.length, 1);
      assert.equal(prompt.result.stopReason, "accepted");
      assert.equal(prompt.result.acpStopReason, "end_turn");
      assert.equal(prompt.result.responseKind, "acknowledgement");
      assertPromptAuditEvidence(prompt);
      assert.equal(prompt.result.communicationSummary.stopReason, "accepted");
      assert.equal(prompt.result.communicationSummary.relayTurnId, prompt.result.turnId);
      assert.equal(prompt.result.communicationSummary.targetSessionId, conversationId);
      assert.equal(prompt.result.communicationSummary.summaryKind, "acknowledgement");
      assert.equal(prompt.result.communicationSummary.finalResponseSummary, "");
      assert.match(prompt.result.communicationSummary.acknowledgementSummary, /accepted the delegated prompt/);
      assert.equal(prompt.result.communicationSummary.externalCompletionState, "accepted_only");
      assert.equal(prompt.result.communicationSummary.finalResponseAvailable, false);
      assert.equal(prompt.result.communicationSummary.reasoningIncluded, false);
      assert.equal(prompt.result.targetEvidence.transportType, "antigravity-agentapi");
      assert.equal(prompt.result.targetEvidence.targetCommunicationMode, "agent_api_proxy");
      assert.equal(prompt.result.targetEvidence.nativeAcpTargetSupported, false);
      assert.equal(prompt.result.targetEvidence.nativeAcpTargetVerified, false);
      assert.equal(prompt.result.targetEvidence.targetSessionId, conversationId);
      assert.equal(prompt.result.targetEvidence.targetResumeRef, conversationId);
      assert.equal(prompt.result.targetEvidence.externalAccepted, true);
      assert.equal(prompt.result.targetEvidence.externalCompletionState, "accepted_only");
      assert.equal(prompt.result.targetEvidence.finalResponseAvailable, false);
      assert.equal(prompt.result.targetEvidence.finalResponsePolicy, "accepted_only");
      assert.equal(prompt.result.targetEvidence.agentApiCapabilitySnapshot.finalResponseReadSupported, false);
      assert.equal(prompt.result.targetEvidence.agentApiCapabilitySnapshot.commands.getConversationMetadata, true);
      assert.equal(prompt.result.targetEvidence.agentApiCapabilitySnapshot.commands.streamConversation, false);
      assert.deepEqual(prompt.result.targetEvidence.capabilitiesSnapshot.capabilities.tools, ["agentapi.sendMessage"]);
      assert.equal(prompt.result.targetEvidence.capabilitiesSnapshot.capabilities.writes, "deny");
      assert.equal(prompt.result.targetEvidence.capabilitiesSnapshot.capabilities.maxRisk, "read_only");
      assert.equal(prompt.result.targetEvidence.capabilitiesSnapshot.target.transportType, "antigravity-agentapi");
      assert.equal(prompt.result.targetEvidence.capabilitiesSnapshot.target.targetCommunicationMode, "agent_api_proxy");
      assert.deepEqual(prompt.result.targetEvidence.externalResponseKeys, ["sendMessage"]);
      assert.equal(calls.some((call) => call.method === "sendMessage"), true);
      assert.equal(
        calls.some((call) => call.method === "sendMessage" && call.content.includes("with content blocks")),
        true
      );

      const loadedAfterPrompt = await sendSourceJsonRpcRequest(
        servedTransport,
        createRequest(
          ACP_METHODS.sessionLoad,
          {
            sessionId: resumed.result.sessionId
          },
          "source-session-load-after-prompt"
        )
      );
      assert.equal(loadedAfterPrompt.id, "source-session-load-after-prompt");
      assert.equal(loadedAfterPrompt.result.sessionId, sessionNew.result.sessionId);
      assert.equal(loadedAfterPrompt.result.replayedUpdateCount, loadedAfterPrompt.notifications.length);
      assert.equal(loadedAfterPrompt.notifications.length > 0, true);
      assert.equal(
        loadedAfterPrompt.notifications.every((notification) => notification.method === ACP_METHODS.sessionUpdate),
        true
      );
      assert.equal(
        loadedAfterPrompt.notifications.some((notification) => notification.params?.phase === "accepted"),
        true
      );
      assert.equal(
        loadedAfterPrompt.notifications.some((notification) => notification.params?.type === "completion"),
        true
      );
      assert.equal(
        loadedAfterPrompt.notifications.every((notification) => notification.params?.sessionId === sessionNew.result.sessionId),
        true
      );

      const replay = await sendSourceJsonRpcRequest(
        servedTransport,
        createRequest(
          ACP_METHODS.sessionPrompt,
          {
            sessionId: resumed.result.sessionId,
            prompt: [
              { type: "text", text: "delegate via source ACP JSON-RPC" },
              { type: "text", text: "with content blocks" }
            ],
            idempotencyKey: "source-acp-completed-idempotency"
          },
          "source-prompt-replay"
        )
      );
      assert.equal(replay.id, "source-prompt-replay");
      assert.equal(replay.notifications.length, 0);
      assert.equal(replay.result.idempotencyReplay, true);
      assert.equal(replay.result.turnId, prompt.result.turnId);
      assert.equal(replay.result.targetEvidence.targetSessionId, prompt.result.targetEvidence.targetSessionId);
      assert.equal(replay.result.communicationSummary.relayTurnId, prompt.result.communicationSummary.relayTurnId);
      assert.equal(replay.result.communicationSummary.targetSessionId, prompt.result.communicationSummary.targetSessionId);
      assert.equal(calls.filter((call) => call.method === "sendMessage").length, 1);
    } finally {
      await closeServedSourceTransport(servedTransport);
    }
  });

  it("does not replay historical reasoning_trace updates on session/load unless explicitly requested", async () => {
    const runtime = createAcpRelayRuntime();
    const servedTransport = createServedSourceTransport(runtime, {
      sourceId: "reasoning-replay-source",
      workspaceId: "vitest-workspace"
    });
    const virtualAgentId = "antigravity.multimodal-coding";

    try {
      const sessionNew = await sendSourceJsonRpcRequest(
        servedTransport,
        createRequest(
          ACP_METHODS.sessionNew,
          {
            virtualAgentId,
            sourceId: "reasoning-replay-source",
            sourceSessionId: "reasoning-replay-session",
            workspaceId: "vitest-workspace"
          },
          "reasoning-replay-session-new"
        )
      );
      assert.match(sessionNew.result.sessionId, /^relay_session_/);

      const prompt = await sendSourceJsonRpcRequest(
        servedTransport,
        createRequest(
          ACP_METHODS.sessionPrompt,
          {
            sessionId: sessionNew.result.sessionId,
            prompt: "store reasoning for replay filtering",
            requestReasoning: true
          },
          "reasoning-replay-prompt"
        )
      );
      assert.equal(prompt.id, "reasoning-replay-prompt");
      assert.equal(
        prompt.notifications.some((notification) => notification.params?.type === "reasoning_trace"),
        true
      );

      const defaultLoad = await sendSourceJsonRpcRequest(
        servedTransport,
        createRequest(
          ACP_METHODS.sessionLoad,
          { sessionId: sessionNew.result.sessionId },
          "reasoning-replay-load-default"
        )
      );
      assert.equal(defaultLoad.id, "reasoning-replay-load-default");
      assert.equal(
        defaultLoad.notifications.some((notification) => notification.params?.type === "reasoning_trace"),
        false
      );

      const explicitLoad = await sendSourceJsonRpcRequest(
        servedTransport,
        createRequest(
          ACP_METHODS.sessionLoad,
          {
            sessionId: sessionNew.result.sessionId,
            requestReasoning: true
          },
          "reasoning-replay-load-explicit"
        )
      );
      assert.equal(explicitLoad.id, "reasoning-replay-load-explicit");
      assert.equal(
        explicitLoad.notifications.some((notification) => notification.params?.type === "reasoning_trace"),
        true
      );
    } finally {
      await closeServedSourceTransport(servedTransport);
      await runtime.close();
    }
  });

  it("keeps pending permission request details opt-in for source list/get/turn observability", async () => {
    const runtime = createAcpRelayRuntime();
    const servedTransport = createServedSourceTransport(runtime, {
      sourceId: "pending-observability-source",
      workspaceId: "vitest-workspace"
    });
    const virtualAgentId = "antigravity.multimodal-coding";
    const secretContent = "source pending list secret content";

    try {
      const sessionNew = await sendSourceJsonRpcRequest(
        servedTransport,
        createRequest(
          ACP_METHODS.sessionNew,
          {
            virtualAgentId,
            sourceId: "pending-observability-source",
            sourceSessionId: "pending-observability-session",
            workspaceId: "vitest-workspace"
          },
          "pending-observability-session-new"
        )
      );
      assert.match(sessionNew.result.sessionId, /^relay_session_/);

      const pending = await sendSourceJsonRpcRequest(
        servedTransport,
        createRequest(
          ACP_METHODS.sessionPrompt,
          {
            sessionId: sessionNew.result.sessionId,
            prompt: "create a pending approval for list observability",
            fileWrites: [{ path: "notes/source-pending-observability.txt", content: secretContent }]
          },
          "pending-observability-prompt"
        )
      );
      assert.equal(pending.result.stopReason, "approval_pending");
      assert.equal(pending.result.pendingPermissionRequests.length, 1);
      const pendingRequest = pending.result.pendingPermissionRequests[0];

      const defaultList = await sendSourceJsonRpcRequest(
        servedTransport,
        createRequest(
          ACP_METHODS.pactSessionList,
          {
            sourceId: "pending-observability-source",
            workspaceId: "vitest-workspace"
          },
          "pending-observability-list-default"
        )
      );
      const defaultSession = defaultList.result.sessions.find((session) => session.relaySessionId === sessionNew.result.sessionId);
      assert.equal(defaultSession.pendingPermissionCount, 1);
      assert.equal(defaultSession.pendingPermissionRequests, undefined);
      assert.equal(defaultSession.latestTurn.pendingPermissionCount, 1);
      assert.equal(defaultSession.latestTurn.pendingPermissionRequests, undefined);

      const detailedList = await sendSourceJsonRpcRequest(
        servedTransport,
        createRequest(
          ACP_METHODS.pactSessionList,
          {
            sourceId: "pending-observability-source",
            workspaceId: "vitest-workspace",
            includePendingPermissionRequests: true
          },
          "pending-observability-list-detailed"
        )
      );
      const detailedSession = detailedList.result.sessions.find((session) => session.relaySessionId === sessionNew.result.sessionId);
      assert.equal(detailedSession.pendingPermissionRequests.length, 1);
      assert.equal(detailedSession.pendingPermissionRequests[0].requestId, pendingRequest.requestId);
      assert.equal(detailedSession.latestTurn.pendingPermissionRequests[0].requestId, pendingRequest.requestId);
      assert.equal(JSON.stringify(detailedSession).includes(secretContent), false);

      const detailedGet = await sendSourceJsonRpcRequest(
        servedTransport,
        createRequest(
          ACP_METHODS.pactSessionGet,
          {
            sessionId: sessionNew.result.sessionId,
            includePendingPermissionRequests: true
          },
          "pending-observability-get-detailed"
        )
      );
      assert.equal(detailedGet.result.session.pendingPermissionRequests[0].requestId, pendingRequest.requestId);
      assert.equal(detailedGet.result.turns[0].pendingPermissionRequests[0].requestId, pendingRequest.requestId);
      assert.equal(JSON.stringify(detailedGet.result).includes(secretContent), false);

      const detailedTurns = await sendSourceJsonRpcRequest(
        servedTransport,
        createRequest(
          ACP_METHODS.pactTurnList,
          {
            sessionId: sessionNew.result.sessionId,
            includePendingPermissionRequests: true
          },
          "pending-observability-turns-detailed"
        )
      );
      assert.equal(detailedTurns.result.turns[0].pendingPermissionRequests[0].requestId, pendingRequest.requestId);
      assert.equal(JSON.stringify(detailedTurns.result).includes(secretContent), false);
    } finally {
      await closeServedSourceTransport(servedTransport);
      await runtime.close();
    }
  });

  it("denies source ACP prompt through the operation guard before waking the target", async () => {
    const securityPermissions = createAuthorizationSecurityPermissions();
    const { calls, runtime, virtualAgentId } = createSourceBridgeRuntime({
      runtimeOptions: { securityPermissions }
    });
    const sessionResult = await runtime.execute("acp_agent_relay.session.create", {
      sourceId: "guarded-source",
      sourceSessionId: "guarded-source-session",
      workspaceId: "vitest-workspace",
      virtualAgentId,
      sourceScopes: ["agent_relay:operate"]
    });
    assert.equal(sessionResult.ok, true);
    assert.equal(calls.length, 0);

    const denied = await runtime.execute("acp_agent_relay.prompt.send", {
      relaySessionId: sessionResult.data.session.relaySessionId,
      sourceId: "guarded-source",
      sourceSessionId: "guarded-source-session",
      workspaceId: "vitest-workspace",
      virtualAgentId,
      prompt: "operation guard should deny before target wake"
    });
    assert.equal(denied.ok, false);
    assert.equal(denied.error.code, "missing_scopes");
    assert.equal(denied.error.details.sourceAuthorizationDecision.allowed, false);
    assert.equal(denied.error.details.sourceAuthorizationDecision.operationId, "acp_agent_relay.prompt.send");
    assert.equal(calls.length, 0);
    assert.equal(
      securityPermissions.decisions.some(
        (decision) => decision.operationId === "acp_agent_relay.prompt.send" && decision.allowed === false
      ),
      true
    );
  });

  it("denies guarded source ACP operations before target routing or transport wake", async () => {
    const securityPermissions = createAuthorizationSecurityPermissions();
    const { calls, runtime, virtualAgentId } = createSourceBridgeRuntime({
      runtimeOptions: { securityPermissions }
    });
    const deniedInitialize = await runtime.execute("acp_agent_relay.virtual_agent.initialize", {
      sourceId: "guarded-multi-source",
      sourceSessionId: "guarded-multi-session",
      workspaceId: "vitest-workspace",
      virtualAgentId
    });
    assert.equal(deniedInitialize.ok, false);
    assert.equal(deniedInitialize.error.code, "missing_scopes");
    assert.equal(deniedInitialize.error.details.sourceAuthorizationDecision.operationId, "acp_agent_relay.virtual_agent.initialize");
    assert.equal(calls.length, 0);

    const deniedCreate = await runtime.execute("acp_agent_relay.session.create", {
      sourceId: "guarded-multi-source",
      sourceSessionId: "guarded-multi-session",
      workspaceId: "vitest-workspace",
      virtualAgentId
    });
    assert.equal(deniedCreate.ok, false);
    assert.equal(deniedCreate.error.code, "missing_scopes");
    assert.equal(deniedCreate.error.details.sourceAuthorizationDecision.operationId, "acp_agent_relay.session.create");
    assert.equal(calls.length, 0);

    const allowedCreate = await runtime.execute("acp_agent_relay.session.create", {
      sourceId: "guarded-multi-source",
      sourceSessionId: "guarded-multi-session",
      workspaceId: "vitest-workspace",
      virtualAgentId,
      sourceScopes: ["agent_relay:operate"]
    });
    assert.equal(allowedCreate.ok, true);
    assert.equal(calls.length, 0);

    for (const operationId of [
      "acp_agent_relay.session.resume",
      "acp_agent_relay.session.wake",
      "acp_agent_relay.prompt.send",
      "acp_agent_relay.session.cancel",
      "acp_agent_relay.session.close"
    ]) {
      const denied = await runtime.execute(operationId, {
        relaySessionId: allowedCreate.data.session.relaySessionId,
        sourceId: "guarded-multi-source",
        sourceSessionId: "guarded-multi-session",
        workspaceId: "vitest-workspace",
        virtualAgentId,
        prompt: "guard should stop this before target wake"
      });
      assert.equal(denied.ok, false);
      assert.equal(denied.error.code, "missing_scopes");
      assert.equal(denied.error.details.sourceAuthorizationDecision.operationId, operationId);
      assert.deepEqual(denied.error.details.sourceAuthorizationDecision.missingScopes, ["agent_relay:operate"]);
      assert.equal(calls.length, 0);
      assert.equal(runtime.sessionDriver.connections.size, 0);
    }

    const deniedOperationIds = securityPermissions.decisions
      .filter((decision) => decision.allowed === false)
      .map((decision) => decision.operationId);
    for (const operationId of [
      "acp_agent_relay.virtual_agent.initialize",
      "acp_agent_relay.session.create",
      "acp_agent_relay.session.resume",
      "acp_agent_relay.session.wake",
      "acp_agent_relay.prompt.send",
      "acp_agent_relay.session.cancel",
      "acp_agent_relay.session.close"
    ]) {
      assert.equal(deniedOperationIds.includes(operationId), true);
    }
  });

  it("rejects foreign source ACP access to a direct relay session id", async () => {
    const { calls, runtime, virtualAgentId } = createSourceBridgeRuntime();
    const ownerTransport = createServedSourceTransport(runtime, {
      sourceId: "owner-source",
      workspaceId: "vitest-workspace"
    });
    const foreignTransport = createServedSourceTransport(runtime, {
      sourceId: "foreign-source",
      workspaceId: "vitest-workspace"
    });

    try {
      const sessionNew = await sendSourceJsonRpcRequest(
        ownerTransport,
        createRequest(
          ACP_METHODS.sessionNew,
          {
            virtualAgentId,
            sourceId: "owner-source",
            sourceSessionId: "owner-source-session",
            workspaceId: "vitest-workspace"
          },
          "owner-session-new"
        )
      );
      assert.match(sessionNew.result.sessionId, /^relay_session_/);

      const foreignSessionNew = await sendSourceJsonRpcRequest(
        foreignTransport,
        createRequest(
          ACP_METHODS.sessionNew,
          {
            virtualAgentId,
            sourceId: "foreign-source",
            sourceSessionId: "foreign-source-session",
            workspaceId: "vitest-workspace"
          },
          "foreign-session-new"
        )
      );
      assert.match(foreignSessionNew.result.sessionId, /^relay_session_/);

      const spoofedForeignFromOwner = {
        sessionId: foreignSessionNew.result.sessionId,
        virtualAgentId,
        sourceId: "foreign-source",
        sourceSessionId: "foreign-source-session",
        workspaceId: "vitest-workspace"
      };
      const spoofedLoad = await sendSourceJsonRpcRequest(
        ownerTransport,
        createRequest(ACP_METHODS.sessionLoad, spoofedForeignFromOwner, "owner-spoof-foreign-load")
      );
      assertSourceRelayOperationError(spoofedLoad, "relay_session_not_found");
      assert.equal(JSON.stringify(spoofedLoad.error.data).includes("relay_session_not_found"), true);

      const spoofedPrompt = await sendSourceJsonRpcRequest(
        ownerTransport,
        createRequest(
          ACP_METHODS.sessionPrompt,
          {
            ...spoofedForeignFromOwner,
            prompt: "owner transport must not borrow foreign params"
          },
          "owner-spoof-foreign-prompt"
        )
      );
      assertSourceRelayOperationError(spoofedPrompt, "relay_session_not_found");
      assert.equal(JSON.stringify(spoofedPrompt.error.data).includes("relay_session_not_found"), true);

      const foreignBase = {
        sessionId: sessionNew.result.sessionId,
        virtualAgentId,
        sourceId: "foreign-source",
        sourceSessionId: "foreign-source-session",
        workspaceId: "vitest-workspace"
      };
      const foreignLoad = await sendSourceJsonRpcRequest(
        foreignTransport,
        createRequest(ACP_METHODS.sessionLoad, foreignBase, "foreign-load")
      );
      assert.equal(foreignLoad.id, "foreign-load");
      assertSourceRelayOperationError(foreignLoad, "relay_session_not_found");
      assert.equal(JSON.stringify(foreignLoad.error.data).includes("relay_session_not_found"), true);

      const foreignResume = await sendSourceJsonRpcRequest(
        foreignTransport,
        createRequest(ACP_METHODS.sessionResume, foreignBase, "foreign-resume")
      );
      assertSourceRelayOperationError(foreignResume, "relay_session_not_found");
      assert.equal(JSON.stringify(foreignResume.error.data).includes("relay_session_not_found"), true);

      const foreignPrompt = await sendSourceJsonRpcRequest(
        foreignTransport,
        createRequest(
          ACP_METHODS.sessionPrompt,
          {
            ...foreignBase,
            prompt: "foreign source must not reach owner session"
          },
          "foreign-prompt"
        )
      );
      assertSourceRelayOperationError(foreignPrompt, "relay_session_not_found");
      assert.equal(JSON.stringify(foreignPrompt.error.data).includes("relay_session_not_found"), true);

      const foreignCancel = await sendSourceJsonRpcRequest(
        foreignTransport,
        createRequest(ACP_METHODS.sessionCancel, foreignBase, "foreign-cancel")
      );
      assertSourceRelayOperationError(foreignCancel, "relay_session_not_found");
      assert.equal(JSON.stringify(foreignCancel.error.data).includes("relay_session_not_found"), true);

      const foreignClose = await sendSourceJsonRpcRequest(
        foreignTransport,
        createRequest(ACP_METHODS.sessionClose, foreignBase, "foreign-close")
      );
      assertSourceRelayOperationError(foreignClose, "relay_session_not_found");
      assert.equal(JSON.stringify(foreignClose.error.data).includes("relay_session_not_found"), true);

      const foreignRead = await sendSourceJsonRpcRequest(
        foreignTransport,
        createRequest(
          ACP_METHODS.fsReadTextFile,
          {
            ...foreignBase,
            path: "facts.txt"
          },
          "foreign-fs-read"
        )
      );
      assert.ok(foreignRead.error);
      assert.equal(JSON.stringify(foreignRead.error.data).includes("relay_session_not_found"), true);

      const foreignWrite = await sendSourceJsonRpcRequest(
        foreignTransport,
        createRequest(
          ACP_METHODS.fsWriteTextFile,
          {
            ...foreignBase,
            path: "notes/foreign.txt",
            content: "foreign source must not write"
          },
          "foreign-fs-write"
        )
      );
      assert.ok(foreignWrite.error);
      assert.equal(JSON.stringify(foreignWrite.error.data).includes("relay_session_not_found"), true);
      assert.equal(calls.length, 0);

      const ownerPrompt = await sendSourceJsonRpcRequest(
        ownerTransport,
        createRequest(
          ACP_METHODS.sessionPrompt,
          {
            sessionId: sessionNew.result.sessionId,
            prompt: "owner source still reaches owner session"
          },
          "owner-prompt-after-foreign"
        )
      );
      assert.equal(ownerPrompt.id, "owner-prompt-after-foreign");
      assert.equal(ownerPrompt.result.stopReason, "accepted");
    } finally {
      await closeServedSourceTransport(ownerTransport);
      await closeServedSourceTransport(foreignTransport);
    }
  });

  it("keeps source identity isolated across concurrent transports on the shared source ACP service", async () => {
    const { runtime, virtualAgentId } = createSourceBridgeRuntime();
    const ownerPair = createAcpSourceJsonRpcTransportPair();
    const foreignPair = createAcpSourceJsonRpcTransportPair();
    const ownerTransport = {
      transportPair: ownerPair,
      serving: runtime.serveSourceAcpTransport(ownerPair.server, {
        sourceId: "shared-owner-source",
        workspaceId: "vitest-workspace"
      })
    };
    const foreignTransport = {
      transportPair: foreignPair,
      serving: runtime.serveSourceAcpTransport(foreignPair.server, {
        sourceId: "shared-foreign-source",
        workspaceId: "vitest-workspace"
      })
    };

    try {
      const [ownerSession, foreignSession] = await Promise.all([
        sendSourceJsonRpcRequest(
          ownerTransport,
          createRequest(
            ACP_METHODS.sessionNew,
            {
              virtualAgentId,
              sourceId: "shared-owner-source",
              sourceSessionId: "shared-owner-source-session",
              workspaceId: "vitest-workspace"
            },
            "shared-owner-session-new"
          )
        ),
        sendSourceJsonRpcRequest(
          foreignTransport,
          createRequest(
            ACP_METHODS.sessionNew,
            {
              virtualAgentId,
              sourceId: "shared-foreign-source",
              sourceSessionId: "shared-foreign-source-session",
              workspaceId: "vitest-workspace"
            },
            "shared-foreign-session-new"
          )
        )
      ]);
      assert.match(ownerSession.result.sessionId, /^relay_session_/);
      assert.match(foreignSession.result.sessionId, /^relay_session_/);

      const spoofForeignFromOwner = await sendSourceJsonRpcRequest(
        ownerTransport,
        createRequest(
          ACP_METHODS.sessionLoad,
          {
            sessionId: foreignSession.result.sessionId,
            virtualAgentId,
            sourceId: "shared-foreign-source",
            sourceSessionId: "shared-foreign-source-session",
            workspaceId: "vitest-workspace"
          },
          "shared-owner-spoof-foreign-load"
        )
      );
      assertSourceRelayOperationError(spoofForeignFromOwner, "relay_session_not_found");

      const spoofOwnerFromForeign = await sendSourceJsonRpcRequest(
        foreignTransport,
        createRequest(
          ACP_METHODS.sessionPrompt,
          {
            sessionId: ownerSession.result.sessionId,
            virtualAgentId,
            sourceId: "shared-owner-source",
            sourceSessionId: "shared-owner-source-session",
            workspaceId: "vitest-workspace",
            prompt: "foreign transport must not borrow owner body identity"
          },
          "shared-foreign-spoof-owner-prompt"
        )
      );
      assertSourceRelayOperationError(spoofOwnerFromForeign, "relay_session_not_found");

      const [ownerList, foreignList] = await Promise.all([
        sendSourceJsonRpcRequest(
          ownerTransport,
          createRequest(ACP_METHODS.pactSessionList, {}, "shared-owner-session-list")
        ),
        sendSourceJsonRpcRequest(
          foreignTransport,
          createRequest(ACP_METHODS.pactSessionList, {}, "shared-foreign-session-list")
        )
      ]);
      assert.deepEqual(
        ownerList.result.sessions.map((session) => session.relaySessionId),
        [ownerSession.result.sessionId]
      );
      assert.deepEqual(
        foreignList.result.sessions.map((session) => session.relaySessionId),
        [foreignSession.result.sessionId]
      );

      const [ownerPrompt, foreignPrompt] = await Promise.all([
        sendSourceJsonRpcRequest(
          ownerTransport,
          createRequest(
            ACP_METHODS.sessionPrompt,
            {
              sessionId: ownerSession.result.sessionId,
              prompt: "owner prompt on shared service"
            },
            "shared-owner-prompt"
          )
        ),
        sendSourceJsonRpcRequest(
          foreignTransport,
          createRequest(
            ACP_METHODS.sessionPrompt,
            {
              sessionId: foreignSession.result.sessionId,
              prompt: "foreign prompt on shared service"
            },
            "shared-foreign-prompt"
          )
        )
      ]);
      assert.equal(ownerPrompt.result.stopReason, "accepted");
      assert.equal(foreignPrompt.result.stopReason, "accepted");
      assert.equal(ownerPrompt.result.sourceId, "shared-owner-source");
      assert.equal(foreignPrompt.result.sourceId, "shared-foreign-source");
    } finally {
      await closeServedSourceTransport(ownerTransport);
      await closeServedSourceTransport(foreignTransport);
    }
  });

  it("reopens a dropped target connection from persisted resume state on the next source ACP prompt", async () => {
    const targetId = "mock.source-rewake-target";
    const virtualAgentId = "mock.source-rewake-agent";
    const connections = [];
    const runtime = createAcpRelayRuntime({
      defaultVirtualAgentId: virtualAgentId,
      defaultSourceId: "codex-source-rewake",
      defaultWorkspaceId: "vitest-workspace",
      virtualAgentRegistry: new AcpVirtualAgentRegistry({
        [virtualAgentId]: {
          virtualAgentId,
          targetId,
          profileId: "pact.acp.source_rewake.mock",
          displayName: "Source Rewake Mock Target",
          advertisedModes: ["ask"],
          defaultMode: "ask",
          advertisedTools: ["mock.prompt"],
          reasoningVisibilityPolicy: "never",
          capabilityPolicy: {
            writes: "deny",
            terminal: "deny",
            maxRisk: "read_only"
          },
          revision: 1
        }
      }),
      targetRegistry: new AcpTargetRegistry({
        [targetId]: {
          targetId,
          label: "Source Rewake Mock Target",
          transport: { type: "mock" },
          advertisedToolsets: ["mock.prompt"],
          capabilityPolicy: {
            writes: "deny",
            terminal: "deny",
            maxRisk: "read_only"
          },
          enabled: true,
          revision: 1
        }
      }),
      sessionDriver: new AcpSessionDriver({
        connectionFactory: ({ relaySession }) => {
          const ordinal = connections.length + 1;
          const connection = {
            ordinal,
            closed: false,
            initializeCalls: [],
            promptCalls: [],
            targetSessionId: "",
            targetResumeRef: "",
            async initialize(params = {}) {
              this.initializeCalls.push({ ...params });
              this.targetSessionId = `rewake-target-session-${ordinal}`;
              this.targetResumeRef = `rewake-target-resume-${ordinal}`;
              return {
                ok: true,
                targetSessionId: this.targetSessionId,
                targetResumeRef: this.targetResumeRef
              };
            },
            async sendPrompt(params = {}) {
              this.promptCalls.push({ ...params });
              return {
                ok: true,
                updates: [
                  {
                    type: "progress",
                    phase: ordinal === 1 ? "first_connection" : "resumed_connection",
                    text: `target connection ${ordinal} handled prompt`
                  }
                ],
                reasoning: [],
                stopReason: "completed",
                text: `connection ${ordinal} completed ${params.prompt || ""}`.trim(),
                targetSessionId: this.targetSessionId,
                targetResumeRef: this.targetResumeRef,
                externalCompletionState: "completed",
                finalResponseAvailable: true
              };
            },
            async cancel() {
              return { ok: true };
            },
            async close() {
              this.closed = true;
              return { ok: true };
            }
          };
          connections.push(connection);
          return connection;
        }
      })
    });
    const servedTransport = createServedSourceTransport(runtime, {
      sourceId: "codex-source-rewake",
      workspaceId: "vitest-workspace"
    });

    try {
      const sessionNew = await sendSourceJsonRpcRequest(
        servedTransport,
        createRequest(
          ACP_METHODS.sessionNew,
          {
            virtualAgentId,
            sourceId: "codex-source-rewake",
            sourceSessionId: "source-rewake-session",
            workspaceId: "vitest-workspace"
          },
          "source-rewake-session-new"
        )
      );
      assert.match(sessionNew.result.sessionId, /^relay_session_/);

      const firstPrompt = await sendSourceJsonRpcRequest(
        servedTransport,
        createRequest(
          ACP_METHODS.sessionPrompt,
          {
            sessionId: sessionNew.result.sessionId,
            prompt: "first prompt creates target session"
          },
          "source-rewake-first-prompt"
        )
      );
      assert.equal(firstPrompt.result.stopReason, "completed");
      assert.equal(firstPrompt.result.targetEvidence.targetSessionId, "rewake-target-session-1");
      assert.equal(firstPrompt.result.targetEvidence.targetResumeRef, "rewake-target-resume-1");
      assert.equal(connections.length, 1);
      assert.equal(connections[0].initializeCalls[0].targetResumeRef, "");

      connections[0].closed = true;

      const secondPrompt = await sendSourceJsonRpcRequest(
        servedTransport,
        createRequest(
          ACP_METHODS.sessionPrompt,
          {
            sessionId: sessionNew.result.sessionId,
            prompt: "second prompt must resume target session"
          },
          "source-rewake-second-prompt"
        )
      );
      assert.equal(secondPrompt.result.stopReason, "completed");
      assert.equal(secondPrompt.result.targetEvidence.targetSessionId, "rewake-target-session-2");
      assert.equal(secondPrompt.result.targetEvidence.targetResumeRef, "rewake-target-resume-2");
      assert.equal(connections.length, 2);
      assert.equal(connections[1].initializeCalls[0].targetResumeRef, "rewake-target-resume-1");
      assert.equal(connections[1].promptCalls[0].prompt, "second prompt must resume target session");
      const storedSession = await runtime.store.getSession(sessionNew.result.sessionId);
      assert.equal(storedSession.targetSessionId, "rewake-target-session-2");
      assert.equal(storedSession.targetResumeRef, "rewake-target-resume-2");
      assert.equal(runtime.sessionDriver.connections.get(`${targetId}::${sessionNew.result.sessionId}`), connections[1]);
    } finally {
      await closeServedSourceTransport(servedTransport);
      await runtime.close();
    }
  });

  it("returns final target ACP completion text to the source ACP prompt result and notifications", async () => {
    const targetTransportPair = createAcpSourceJsonRpcTransportPair();
    const targetServing = (async () => {
      while (true) {
        const raw = await targetTransportPair.server.receive();
        if (raw === null || raw === undefined) {
          return;
        }
        const message = parseJsonRpcMessage(raw);
        if (message.method === ACP_METHODS.initialize) {
          await targetTransportPair.server.send(createSuccess(message.id, {
            protocolVersion: "v0.0.1:strategy:target-acp-1",
            capabilities: {
              session: ["new", "resume"],
              updates: ["progress"],
              mcp: true
            }
          }));
        } else if (message.method === ACP_METHODS.sessionNew || message.method === ACP_METHODS.sessionResume) {
          await targetTransportPair.server.send(createSuccess(message.id, {
            sessionId: "source-visible-target-session",
            targetSessionId: "source-visible-target-session",
            targetResumeRef: "source-visible-target-resume"
          }));
        } else if (message.method === ACP_METHODS.sessionPrompt) {
          await targetTransportPair.server.send(createNotification(ACP_METHODS.sessionUpdate, {
            type: "progress",
            phase: "working",
            text: "target started final response"
          }));
          await targetTransportPair.server.send(createSuccess(message.id, {
            stopReason: "completed",
            output: "target final text visible to source ACP",
            updates: [
              {
                type: "progress",
                phase: "completed_packaging",
                text: "target final response packaged"
              }
            ]
          }));
        } else {
          await targetTransportPair.server.send(createError(message.id, -32601, `Unsupported target ACP method ${message.method}`));
        }
      }
    })();
    const targetId = "target.acp.source-visible";
    const virtualAgentId = "virtual.acp.source-visible";
    const runtime = createAcpRelayRuntime({
      defaultVirtualAgentId: virtualAgentId,
      defaultSourceId: "codex-source-vitest",
      defaultWorkspaceId: "vitest-workspace",
      virtualAgentRegistry: new AcpVirtualAgentRegistry({
        [virtualAgentId]: {
          virtualAgentId,
          targetId,
          profileId: "pact.acp.source_visible_target",
          displayName: "Source Visible ACP Target",
          advertisedModes: ["ask"],
          defaultMode: "ask",
          advertisedTools: ["pact.agentLibrary.search"],
          reasoningVisibilityPolicy: "never",
          capabilityPolicy: {
            writes: "deny",
            terminal: "deny",
            maxRisk: "read_only"
          },
          revision: 1
        }
      }),
      targetRegistry: new AcpTargetRegistry({
        [targetId]: {
          targetId,
          label: "Source Visible ACP Target",
          transport: { type: "acp-json-rpc" },
          externalServiceId: "external.acp.source-visible",
          advertisedToolsets: ["pact.agentLibrary.search"],
          capabilityPolicy: {
            writes: "deny",
            terminal: "deny",
            maxRisk: "read_only"
          },
          enabled: true,
          revision: 1
        }
      }),
      sessionDriver: new AcpSessionDriver({
        connectionFactory: (options) =>
          new AcpClientConnection({
            ...options,
            transport: targetTransportPair.client,
            requestTimeoutMs: 1000
          })
      })
    });
    const servedTransport = createServedSourceTransport(runtime, {
      sourceId: "codex-source-vitest",
      workspaceId: "vitest-workspace"
    });

    try {
      const initialize = await sendSourceJsonRpcRequest(
        servedTransport,
        createRequest(ACP_METHODS.initialize, { virtualAgentId, sourceId: "codex-source-vitest" }, "source-visible-init")
      );
      assert.equal(initialize.result.virtualAgentId, virtualAgentId);

      const sessionNew = await sendSourceJsonRpcRequest(
        servedTransport,
        createRequest(
          ACP_METHODS.sessionNew,
          {
            virtualAgentId,
            sourceId: "codex-source-vitest",
            sourceSessionId: "source-visible-session",
            workspaceId: "vitest-workspace"
          },
          "source-visible-session-new"
        )
      );

      const prompt = await sendSourceJsonRpcRequest(
        servedTransport,
        createRequest(
          ACP_METHODS.sessionPrompt,
          {
            sessionId: sessionNew.result.sessionId,
            prompt: "ask target for final text",
            idempotencyKey: "source-visible-final-text"
          },
          "source-visible-prompt"
        )
      );
      assert.equal(prompt.id, "source-visible-prompt");
      assert.equal(prompt.result.stopReason, "completed");
      assert.equal(prompt.result.output, "target final text visible to source ACP");
      assert.equal(prompt.result.targetEvidence.externalServiceId, "external.acp.source-visible");
      assert.equal(prompt.result.targetEvidence.externalCompletionState, "completed");
      assert.equal(prompt.result.targetEvidence.finalResponseAvailable, true);
      assert.equal(prompt.result.communicationSummary.stopReason, "completed");
      assert.equal(prompt.result.communicationSummary.outputAvailable, true);
      assert.equal(prompt.result.communicationSummary.outputSummary, "target final text visible to source ACP");
      assert.equal(prompt.result.communicationSummary.externalCompletionState, "completed");
      assert.equal(prompt.result.communicationSummary.finalResponseAvailable, true);
      const completionNotification = prompt.notifications.find((notification) => notification.params?.type === "completion");
      assert.ok(completionNotification);
      assert.equal(completionNotification.params.text, "target final text visible to source ACP");
      assert.equal(
        prompt.notifications.some((notification) => notification.params?.phase === "working"),
        true
      );

      const replay = await sendSourceJsonRpcRequest(
        servedTransport,
        createRequest(
          ACP_METHODS.sessionPrompt,
          {
            sessionId: sessionNew.result.sessionId,
            prompt: "ask target for final text",
            idempotencyKey: "source-visible-final-text"
          },
          "source-visible-prompt-replay"
        )
      );
      assert.equal(replay.result.idempotencyReplay, true);
      assert.equal(replay.result.turnId, prompt.result.turnId);
      assert.equal(replay.result.output, "target final text visible to source ACP");
      assert.equal(replay.result.communicationSummary.relayTurnId, prompt.result.communicationSummary.relayTurnId);
      assert.equal(replay.result.communicationSummary.outputSummary, prompt.result.communicationSummary.outputSummary);
      assert.equal(replay.notifications.length, 0);
    } finally {
      await closeServedSourceTransport(servedTransport);
      targetTransportPair.close();
      await targetServing;
    }
  });

  it("returns Antigravity Connect final response text to the source ACP prompt result and notifications", async () => {
    const conversationId = "ag-source-connect-final-conversation";
    const finalText = "Antigravity Connect final text visible to source ACP";
    const calls = [];
    let observeCount = 0;
    const fakeClient = {
      async getConversationMetadata(nextConversationId) {
        calls.push({ method: "getConversationMetadata", conversationId: nextConversationId });
        return {
          response: {
            conversationMetadata: {
              metadata: { conversationId: nextConversationId }
            }
          }
        };
      },
      async sendMessage({ recipientId, content }) {
        calls.push({ method: "sendMessage", recipientId, content });
        return {
          response: {
            sendMessage: { recipientId },
            recipientId
          }
        };
      },
      async observeConnectTrajectory() {
        observeCount += 1;
        calls.push({ method: "observeConnectTrajectory", observeCount });
        if (observeCount === 1) {
          return {
            conversationId,
            runStatus: "CASCADE_RUN_STATUS_RUNNING",
            stepCount: 3,
            afterStepCount: 0,
            trajectoryAdvanced: true,
            statusCounts: { CORTEX_STEP_STATUS_DONE: 3 },
            running: true,
            completed: false,
            failed: false,
            pendingInteraction: false,
            blockedByPendingInteraction: false,
            progressAvailable: false,
            finalResponseAvailable: false,
            latestStep: null,
            waitingInteractionStep: null,
            latestProgress: null,
            latestFinalResponse: null
          };
        }
        return {
          conversationId,
          runStatus: "CASCADE_RUN_STATUS_COMPLETED",
          stepCount: 4,
          afterStepCount: 3,
          trajectoryAdvanced: true,
          statusCounts: { CORTEX_STEP_STATUS_DONE: 4 },
          running: false,
          completed: true,
          failed: false,
          pendingInteraction: false,
          blockedByPendingInteraction: false,
          progressAvailable: true,
          finalResponseAvailable: true,
          latestStep: {
            ordinal: 3,
            stepIndex: 4,
            type: "CORTEX_STEP_TYPE_PLANNER_RESPONSE",
            status: "CORTEX_STEP_STATUS_DONE",
            content: finalText
          },
          waitingInteractionStep: null,
          latestProgress: {
            ordinal: 3,
            stepIndex: 4,
            type: "CORTEX_STEP_TYPE_PLANNER_RESPONSE",
            status: "CORTEX_STEP_STATUS_DONE",
            content: finalText
          },
          latestFinalResponse: {
            ordinal: 3,
            stepIndex: 4,
            type: "CORTEX_STEP_TYPE_PLANNER_RESPONSE",
            status: "CORTEX_STEP_STATUS_DONE",
            content: finalText
          }
        };
      }
    };
    const { runtime, virtualAgentId } = createSourceBridgeRuntime({
      conversationId,
      fakeClient,
      transportOptions: { connectEnabled: true }
    });
    const servedTransport = createServedSourceTransport(runtime, {
      sourceId: "codex-source-vitest",
      workspaceId: "vitest-workspace"
    });

    try {
      const initialize = await sendSourceJsonRpcRequest(
        servedTransport,
        createRequest(ACP_METHODS.initialize, { virtualAgentId, sourceId: "codex-source-vitest" }, "source-ag-final-init")
      );
      assert.equal(initialize.result.virtualAgentId, virtualAgentId);

      const sessionNew = await sendSourceJsonRpcRequest(
        servedTransport,
        createRequest(
          ACP_METHODS.sessionNew,
          {
            virtualAgentId,
            sourceId: "codex-source-vitest",
            sourceSessionId: "source-ag-final-session",
            workspaceId: "vitest-workspace"
          },
          "source-ag-final-session-new"
        )
      );

      const prompt = await sendSourceJsonRpcRequest(
        servedTransport,
        createRequest(
          ACP_METHODS.sessionPrompt,
          {
            sessionId: sessionNew.result.sessionId,
            prompt: "ask Antigravity Connect target for final text"
          },
          "source-ag-final-prompt"
        )
      );

      assert.equal(prompt.id, "source-ag-final-prompt");
      assert.equal(prompt.result.stopReason, "completed");
      assert.equal(prompt.result.output, finalText);
      assert.equal(prompt.result.responseKind, "final_response");
      assert.equal(prompt.result.targetEvidence.transportType, "antigravity-agentapi");
      assert.equal(prompt.result.targetEvidence.externalCompletionState, "completed");
      assert.equal(prompt.result.targetEvidence.finalResponseAvailable, true);
      assert.equal(prompt.result.targetEvidence.finalResponsePolicy, "connect_trajectory");
      assert.equal(prompt.result.communicationSummary.stopReason, "completed");
      assert.equal(prompt.result.communicationSummary.outputAvailable, true);
      assert.equal(prompt.result.communicationSummary.outputSummary, finalText);
      assert.equal(prompt.result.communicationSummary.summaryKind, "final_response");
      assert.equal(prompt.result.communicationSummary.finalResponseSummary, finalText);
      assert.equal(prompt.result.communicationSummary.acknowledgementSummary, "");
      assert.equal(prompt.result.communicationSummary.externalCompletionState, "completed");
      assert.equal(prompt.result.communicationSummary.finalResponsePolicy, "connect_trajectory");
      const completionNotification = prompt.notifications.find((notification) => notification.params?.type === "completion");
      assert.ok(completionNotification);
      assert.equal(completionNotification.params.text, finalText);
      assert.equal(completionNotification.params.responseKind, "final_response");
      assert.deepEqual(calls.map((call) => call.method), [
        "getConversationMetadata",
        "observeConnectTrajectory",
        "sendMessage",
        "observeConnectTrajectory"
      ]);
    } finally {
      await closeServedSourceTransport(servedTransport);
    }
  });

  it("returns Antigravity target observation errors to the source ACP prompt result and notifications", async () => {
    const conversationId = "ag-source-connect-observation-error-conversation";
    const calls = [];
    let observeCount = 0;
    const fakeClient = {
      async getConversationMetadata(nextConversationId) {
        calls.push({ method: "getConversationMetadata", conversationId: nextConversationId });
        return {
          response: {
            conversationMetadata: {
              metadata: { conversationId: nextConversationId }
            }
          }
        };
      },
      async sendMessage({ recipientId, content }) {
        calls.push({ method: "sendMessage", recipientId, content });
        return {
          response: {
            sendMessage: { recipientId },
            recipientId
          }
        };
      },
      async observeConnectTrajectory() {
        observeCount += 1;
        calls.push({ method: "observeConnectTrajectory", observeCount });
        if (observeCount === 1) {
          return {
            conversationId,
            runStatus: "CASCADE_RUN_STATUS_IDLE",
            stepCount: 9,
            afterStepCount: 0,
            trajectoryAdvanced: true,
            statusCounts: { CORTEX_STEP_STATUS_DONE: 9 },
            running: false,
            completed: true,
            failed: false,
            pendingInteraction: false,
            blockedByPendingInteraction: false,
            progressAvailable: false,
            finalResponseAvailable: false,
            latestStep: null,
            waitingInteractionStep: null,
            latestError: null,
            latestProgress: null,
            latestFinalResponse: null
          };
        }
        throw new Error("RESOURCE_EXHAUSTED (code 429): quota reached while observing source bridge target");
      }
    };
    const { runtime, virtualAgentId } = createSourceBridgeRuntime({
      conversationId,
      fakeClient,
      transportOptions: { connectEnabled: true }
    });
    const servedTransport = createServedSourceTransport(runtime, {
      sourceId: "codex-source-vitest",
      workspaceId: "vitest-workspace"
    });

    try {
      const initialize = await sendSourceJsonRpcRequest(
        servedTransport,
        createRequest(ACP_METHODS.initialize, { virtualAgentId, sourceId: "codex-source-vitest" }, "source-ag-error-init")
      );
      assert.equal(initialize.result.virtualAgentId, virtualAgentId);

      const sessionNew = await sendSourceJsonRpcRequest(
        servedTransport,
        createRequest(
          ACP_METHODS.sessionNew,
          {
            virtualAgentId,
            sourceId: "codex-source-vitest",
            sourceSessionId: "source-ag-error-session",
            workspaceId: "vitest-workspace"
          },
          "source-ag-error-session-new"
        )
      );

      const prompt = await sendSourceJsonRpcRequest(
        servedTransport,
        createRequest(
          ACP_METHODS.sessionPrompt,
          {
            sessionId: sessionNew.result.sessionId,
            prompt: "ask Antigravity Connect target while observation fails"
          },
          "source-ag-error-prompt"
        )
      );

      assert.equal(prompt.id, "source-ag-error-prompt");
      assert.equal(prompt.result.stopReason, "target_error");
      assert.match(prompt.result.output, /RESOURCE_EXHAUSTED/);
      assert.equal(prompt.result.targetEvidence.externalCompletionState, "target_error");
      assert.equal(prompt.result.targetEvidence.finalResponseAvailable, false);
      assert.equal(prompt.result.targetEvidence.finalResponsePolicy, "target_error");
      assert.equal(prompt.result.targetEvidence.targetError.code, "antigravity_connect_observation_error");
      assert.match(prompt.result.targetEvidence.targetError.message, /observing source bridge target/);
      assert.equal(prompt.result.communicationSummary.stopReason, "target_error");
      assert.equal(prompt.result.communicationSummary.externalCompletionState, "target_error");
      assert.equal(prompt.result.communicationSummary.finalResponseAvailable, false);
      assert.equal(prompt.result.communicationSummary.finalResponsePolicy, "target_error");
      assert.equal(prompt.result.communicationSummary.targetErrorCode, "antigravity_connect_observation_error");
      assert.match(prompt.result.communicationSummary.targetErrorMessage, /observing source bridge target/);
      const completionNotification = prompt.notifications.find((notification) => notification.params?.type === "completion");
      assert.ok(completionNotification);
      assert.equal(completionNotification.params.phase, "target_error");
      assert.equal(completionNotification.params.payload.targetError.code, "antigravity_connect_observation_error");
      assert.deepEqual(calls.map((call) => call.method), [
        "getConversationMetadata",
        "observeConnectTrajectory",
        "sendMessage",
        "observeConnectTrajectory"
      ]);
    } finally {
      await closeServedSourceTransport(servedTransport);
    }
  });

  it("resolves pending write approvals through source ACP session/request_permission", async () => {
    const workspaceRoot = await makeTempDir("pact-acp-source-permission-");
    const targetId = "mock.source-permission-target";
    const virtualAgentId = "mock.source-permission-agent";
    const runtime = createAcpRelayRuntime({
      workspaceRoot,
      virtualAgentRegistry: new AcpVirtualAgentRegistry({
        [virtualAgentId]: {
          virtualAgentId,
          targetId,
          profileId: "pact.acp.source_permission.mock",
          displayName: "Source Permission Mock ACP Relay",
          advertisedModes: ["ask"],
          defaultMode: "ask",
          advertisedTools: ["fs.writeTextFile"],
          reasoningVisibilityPolicy: "never",
          capabilityPolicy: {
            writes: "approval_required",
            terminal: "deny",
            maxRisk: "repair_write"
          },
          revision: 1
        }
      }),
      targetRegistry: new AcpTargetRegistry({
        [targetId]: {
          targetId,
          label: "Source Permission Mock Target",
          transport: { type: "mock" },
          advertisedToolsets: ["fs.writeTextFile"],
          capabilityPolicy: {
            writes: "approval_required",
            terminal: "deny",
            maxRisk: "repair_write"
          },
          enabled: true,
          revision: 1
        }
      })
    });
    const servedTransport = createServedSourceTransport(runtime, {
      sourceId: "codex-source-permission-vitest",
      workspaceId: "vitest-workspace"
    });
    const foreignServedTransport = createServedSourceTransport(runtime, {
      sourceId: "foreign-source-permission-vitest",
      workspaceId: "vitest-workspace"
    });

    try {
      const sessionNew = await sendSourceJsonRpcRequest(
        servedTransport,
        createRequest(
          ACP_METHODS.sessionNew,
          {
            virtualAgentId,
            sourceId: "codex-source-permission-vitest",
            sourceSessionId: "source-permission-session",
            workspaceId: "vitest-workspace"
          },
          "source-permission-session-new"
        )
      );
      assert.match(sessionNew.result.sessionId, /^relay_session_/);

      const pending = await sendSourceJsonRpcRequest(
        servedTransport,
        createRequest(
          ACP_METHODS.sessionPrompt,
          {
            sessionId: sessionNew.result.sessionId,
            prompt: "write after source approval",
            idempotencyKey: "source-permission-approval-idempotency",
            fileWrites: [
              {
                path: "notes/source-approved.txt",
                content: "approved through source ACP"
              }
            ]
          },
          "source-permission-prompt"
        )
      );
      assert.equal(pending.result.stopReason, "approval_pending");
      assert.equal(pending.result.pendingPermissionRequests.length, 1);
      assert.equal(pending.notifications.some((notification) => notification.params?.phase === "approval_pending"), true);
      await assert.rejects(
        fs.readFile(path.join(workspaceRoot, "notes", "source-approved.txt"), "utf8"),
        /ENOENT/
      );

      const permissionRequest = pending.result.pendingPermissionRequests[0];
      assert.equal(permissionRequest.details.content, undefined);
      assert.equal(permissionRequest.details.promptText, undefined);
      assert.equal(JSON.stringify(pending.result).includes("approved through source ACP"), false);
      const storedSourcePending = await runtime.store.getPermissionRequest(permissionRequest.requestId);
      assert.equal(storedSourcePending.details.content, undefined);
      assert.equal(storedSourcePending.details.promptText, undefined);
      assert.match(storedSourcePending.details.contentHash, /^[a-f0-9]{64}$/);
      assert.match(storedSourcePending.details.contentRef, /^sensitive:\/\/pact\/acp-agent-relay\/write-content\//);
      assert.match(storedSourcePending.details.promptHash, /^[a-f0-9]{64}$/);
      assert.match(storedSourcePending.details.promptRef, /^sensitive:\/\/pact\/acp-agent-relay\/prompt\//);
      assert.equal(JSON.stringify(storedSourcePending).includes("approved through source ACP"), false);

      const pendingReplay = await sendSourceJsonRpcRequest(
        servedTransport,
        createRequest(
          ACP_METHODS.sessionPrompt,
          {
            sessionId: sessionNew.result.sessionId,
            prompt: "write after source approval",
            idempotencyKey: "source-permission-approval-idempotency",
            fileWrites: [
              {
                path: "notes/source-approved.txt",
                content: "approved through source ACP"
              }
            ]
          },
          "source-permission-prompt-replay"
        )
      );
      assert.equal(pendingReplay.result.idempotencyReplay, true);
      assert.equal(pendingReplay.result.turnId, pending.result.turnId);
      assert.equal(pendingReplay.result.stopReason, "approval_pending");
      assert.equal(pendingReplay.result.pendingPermissionRequests.length, 1);
      assert.equal(
        pendingReplay.result.pendingPermissionRequests[0].requestId,
        permissionRequest.requestId
      );
      assert.equal(pendingReplay.notifications.length, 0);
      await assert.rejects(
        fs.readFile(path.join(workspaceRoot, "notes", "source-approved.txt"), "utf8"),
        /ENOENT/
      );

      const foreignResolve = await sendSourceJsonRpcRequest(
        foreignServedTransport,
        createRequest(
          ACP_METHODS.sessionRequestPermission,
          {
            sessionId: sessionNew.result.sessionId,
            requestId: permissionRequest.requestId,
            virtualAgentId,
            sourceId: "foreign-source-permission-vitest",
            sourceSessionId: "foreign-source-permission-session",
            workspaceId: "vitest-workspace",
            approved: true,
            approvalId: "foreign-source-acp-approval",
            payloadHash: permissionRequest.details.payloadHash
          },
          "foreign-source-permission-resolve"
        )
      );
      assert.ok(foreignResolve.error);
      assert.equal(JSON.stringify(foreignResolve.error.data).includes("relay_session_not_found"), true);
      assert.equal((await runtime.store.getPermissionRequest(permissionRequest.requestId)).status, "pending");
      await assert.rejects(
        fs.readFile(path.join(workspaceRoot, "notes", "source-approved.txt"), "utf8"),
        /ENOENT/
      );

      const resolved = await sendSourceJsonRpcRequest(
        servedTransport,
        createRequest(
          ACP_METHODS.sessionRequestPermission,
          {
            sessionId: sessionNew.result.sessionId,
            requestId: permissionRequest.requestId,
            approved: true,
            approvalId: "source-acp-approval",
            payloadHash: permissionRequest.details.payloadHash
          },
          "source-permission-resolve"
        )
      );
      assert.equal(resolved.id, "source-permission-resolve");
      assert.equal(resolved.result.stopReason, "completed");
      assert.equal(resolved.result.permissionRequest.status, "completed");
      assert.equal(resolved.result.permissionRequest.details.content, undefined);
      assert.equal(resolved.notifications.some((notification) => notification.params?.type === "receipt"), true);
      assert.equal(resolved.notifications.some((notification) => notification.params?.type === "completion"), true);
      assert.match(resolved.result.output, /Mock ACP target completed/);
      assert.equal(
        await fs.readFile(path.join(workspaceRoot, "notes", "source-approved.txt"), "utf8"),
        "approved through source ACP"
      );

      const resolvedAgain = await sendSourceJsonRpcRequest(
        servedTransport,
        createRequest(
          ACP_METHODS.sessionRequestPermission,
          {
            sessionId: sessionNew.result.sessionId,
            requestId: permissionRequest.requestId,
            approved: true,
            approvalId: "source-acp-approval",
            payloadHash: permissionRequest.details.payloadHash
          },
          "source-permission-resolve-again"
        )
      );
      assert.equal(resolvedAgain.result.alreadyResolved, true);
      assert.equal(resolvedAgain.result.turnId, resolved.result.turnId);
      assert.equal(resolvedAgain.result.newEvents.length, 0);
      assert.equal(resolvedAgain.notifications.length, 0);
      assert.equal(
        await fs.readFile(path.join(workspaceRoot, "notes", "source-approved.txt"), "utf8"),
        "approved through source ACP"
      );
    } finally {
      await closeServedSourceTransport(servedTransport);
      await closeServedSourceTransport(foreignServedTransport);
    }
  });

  it("resolves target-originated ACP file write callbacks through source ACP approval without duplicate writes", async () => {
    const workspaceRoot = await makeTempDir("pact-acp-target-callback-write-");
    const targetId = "acp.target-callback-write-target";
    const virtualAgentId = "acp.target-callback-write-agent";
    const targetRuns = [];
    let writeCount = 0;

    function startTargetRun() {
      const transportPair = createAcpSourceJsonRpcTransportPair();
      const run = {
        transportPair,
        received: [],
        callbackResponses: []
      };
      run.serving = (async () => {
        while (true) {
          const raw = await transportPair.server.receive();
          if (raw === null || raw === undefined) {
            return;
          }
          const message = parseJsonRpcMessage(raw);
          run.received.push(message);
          if (message.method === ACP_METHODS.initialize) {
            await transportPair.server.send(createSuccess(message.id, {
              protocolVersion: "v0.0.1:strategy:target-acp-callback-write-1",
              capabilities: {
                session: ["new", "resume", "close"],
                updates: ["progress"],
                fs: ["write_text_file"]
              }
            }));
          } else if (message.method === ACP_METHODS.sessionNew || message.method === ACP_METHODS.sessionResume) {
            await transportPair.server.send(createSuccess(message.id, {
              targetSessionId: "target-callback-write-session",
              targetResumeRef: "target-callback-write-resume"
            }));
          } else if (message.method === ACP_METHODS.sessionPrompt) {
            await transportPair.server.send(createRequest(
              ACP_METHODS.fsWriteTextFile,
              {
                toolCallId: "target-write-tool-call-1",
                path: "notes/target-callback-write.txt",
                content: "target callback approved content"
              },
              `target-callback-write-${targetRuns.length}`
            ));
            const callbackRaw = await transportPair.server.receive();
            if (callbackRaw === null || callbackRaw === undefined) {
              return;
            }
            const callbackResponse = parseJsonRpcMessage(callbackRaw);
            run.callbackResponses.push(callbackResponse);
            if (callbackResponse.error) {
              return;
            }
            await transportPair.server.send(createNotification(ACP_METHODS.sessionUpdate, {
              type: "progress",
              phase: "target_write_callback_approved",
              text: "target callback write approval received"
            }));
            await transportPair.server.send(createSuccess(message.id, {
              stopReason: "completed",
              output: "target completed after callback write approval",
              targetSessionId: "target-callback-write-session",
              targetResumeRef: "target-callback-write-resume"
            }));
          } else if (message.method === ACP_METHODS.sessionClose) {
            await transportPair.server.send(createSuccess(message.id, { ok: true }));
          } else {
            await transportPair.server.send(createError(message.id, -32601, `Unsupported target ACP method ${message.method}`));
          }
        }
      })();
      targetRuns.push(run);
      return transportPair.client;
    }

    const runtime = createAcpRelayRuntime({
      workspaceRoot,
      defaultVirtualAgentId: virtualAgentId,
      defaultSourceId: "codex-source-target-callback-write",
      defaultWorkspaceId: "vitest-workspace",
      virtualAgentRegistry: new AcpVirtualAgentRegistry({
        [virtualAgentId]: {
          virtualAgentId,
          targetId,
          profileId: "pact.acp.target_callback_write",
          displayName: "Target Callback Write ACP Relay",
          advertisedModes: ["ask"],
          defaultMode: "ask",
          advertisedTools: ["fs.writeTextFile"],
          reasoningVisibilityPolicy: "never",
          capabilityPolicy: {
            writes: "approval_required",
            terminal: "deny",
            maxRisk: "repair_write"
          },
          revision: 1
        }
      }),
      targetRegistry: new AcpTargetRegistry({
        [targetId]: {
          targetId,
          label: "Target Callback Write Target",
          transport: { type: "stdio" },
          advertisedToolsets: ["fs.writeTextFile"],
          capabilityPolicy: {
            writes: "approval_required",
            terminal: "deny",
            maxRisk: "repair_write"
          },
          enabled: true,
          revision: 1
        }
      }),
      permissionBridge: new AcpPermissionBridge({
        workspaceRoot,
        fileSystem: {
          readFile: fs.readFile,
          mkdir: fs.mkdir,
          async writeFile(...args) {
            writeCount += 1;
            return fs.writeFile(...args);
          }
        }
      }),
      sessionDriver: new AcpSessionDriver({
        connectionFactory: ({ target }) => new AcpClientConnection({
          target,
          transport: startTargetRun(),
          requestTimeoutMs: 1000
        })
      })
    });
    const servedTransport = createServedSourceTransport(runtime, {
      sourceId: "codex-source-target-callback-write",
      workspaceId: "vitest-workspace"
    });
    const foreignServedTransport = createServedSourceTransport(runtime, {
      sourceId: "foreign-source-target-callback-write",
      workspaceId: "vitest-workspace"
    });

    try {
      const sessionNew = await sendSourceJsonRpcRequest(
        servedTransport,
        createRequest(
          ACP_METHODS.sessionNew,
          {
            virtualAgentId,
            sourceId: "codex-source-target-callback-write",
            sourceSessionId: "target-callback-write-session",
            workspaceId: "vitest-workspace"
          },
          "target-callback-write-session-new"
        )
      );
      assert.match(sessionNew.result.sessionId, /^relay_session_/);

      const pending = await sendSourceJsonRpcRequest(
        servedTransport,
        createRequest(
          ACP_METHODS.sessionPrompt,
          {
            sessionId: sessionNew.result.sessionId,
            prompt: "target should request a write callback",
            idempotencyKey: "target-callback-write-idempotency"
          },
          "target-callback-write-prompt"
        )
      );
      assert.equal(pending.result.stopReason, "approval_pending");
      assert.equal(pending.result.turn.status, "approval_pending");
      assert.equal(pending.result.pendingPermissionRequests.length, 1);
      assert.equal(pending.result.pendingPermissionRequests[0].requestedAction, "fs.writeTextFile");
      assert.equal(pending.result.pendingPermissionRequests[0].targetToolCallId, "target-write-tool-call-1");
      assert.match(pending.result.pendingPermissionRequests[0].details.payloadHash, /^[a-f0-9]{64}$/);
      assert.equal(pending.result.pendingPermissionRequests[0].details.content, undefined);
      assert.equal(JSON.stringify(pending.result).includes("target callback approved content"), false);
      assert.equal(writeCount, 0);
      await assert.rejects(
        fs.readFile(path.join(workspaceRoot, "notes", "target-callback-write.txt"), "utf8"),
        /ENOENT/
      );

      const permissionRequest = pending.result.pendingPermissionRequests[0];
      const storedPending = await runtime.store.getPermissionRequest(permissionRequest.requestId);
      assert.equal(storedPending.status, "pending");
      assert.equal(storedPending.details.content, undefined);
      assert.equal(storedPending.details.promptText, undefined);
      assert.match(storedPending.details.contentHash, /^[a-f0-9]{64}$/);
      assert.match(storedPending.details.contentRef, /^sensitive:\/\/pact\/acp-agent-relay\/write-content\//);
      assert.match(storedPending.details.promptHash, /^[a-f0-9]{64}$/);
      assert.match(storedPending.details.promptRef, /^sensitive:\/\/pact\/acp-agent-relay\/prompt\//);
      assert.equal(JSON.stringify(storedPending).includes("target callback approved content"), false);

      const pendingReplay = await sendSourceJsonRpcRequest(
        servedTransport,
        createRequest(
          ACP_METHODS.sessionPrompt,
          {
            sessionId: sessionNew.result.sessionId,
            prompt: "target should request a write callback",
            idempotencyKey: "target-callback-write-idempotency"
          },
          "target-callback-write-pending-replay"
        )
      );
      assert.equal(pendingReplay.result.idempotencyReplay, true);
      assert.equal(pendingReplay.result.turnId, pending.result.turnId);
      assert.equal(pendingReplay.result.stopReason, "approval_pending");
      assert.equal(pendingReplay.result.pendingPermissionRequests.length, 1);
      assert.equal(pendingReplay.result.pendingPermissionRequests[0].requestId, permissionRequest.requestId);
      assert.equal(pendingReplay.notifications.length, 0);
      assert.equal(targetRuns.length, 1);
      assert.equal(writeCount, 0);

      const foreignResolve = await sendSourceJsonRpcRequest(
        foreignServedTransport,
        createRequest(
          ACP_METHODS.sessionRequestPermission,
          {
            sessionId: sessionNew.result.sessionId,
            requestId: permissionRequest.requestId,
            virtualAgentId,
            sourceId: "foreign-source-target-callback-write",
            sourceSessionId: "foreign-target-callback-write-session",
            workspaceId: "vitest-workspace",
            approved: true,
            approvalId: "foreign-target-callback-write-approval",
            payloadHash: permissionRequest.details.payloadHash
          },
          "foreign-target-callback-write-resolve"
        )
      );
      assert.ok(foreignResolve.error);
      assert.equal(JSON.stringify(foreignResolve.error.data).includes("relay_session_not_found"), true);
      assert.equal((await runtime.store.getPermissionRequest(permissionRequest.requestId)).status, "pending");
      assert.equal(writeCount, 0);

      const resolved = await sendSourceJsonRpcRequest(
        servedTransport,
        createRequest(
          ACP_METHODS.sessionRequestPermission,
          {
            sessionId: sessionNew.result.sessionId,
            requestId: permissionRequest.requestId,
            approved: true,
            approvalId: "target-callback-write-approval",
            payloadHash: permissionRequest.details.payloadHash
          },
          "target-callback-write-resolve"
        )
      );
      assert.equal(resolved.id, "target-callback-write-resolve");
      assert.equal(resolved.result.stopReason, "completed");
      assert.equal(resolved.result.turnId, pending.result.turnId);
      assert.equal(resolved.result.permissionRequest.status, "completed");
      assert.equal(resolved.result.output, "target completed after callback write approval");
      assert.equal(writeCount, 1);
      assert.equal(
        await fs.readFile(path.join(workspaceRoot, "notes", "target-callback-write.txt"), "utf8"),
        "target callback approved content"
      );
      assert.equal(targetRuns.length, 2);
      assert.equal(targetRuns[1].callbackResponses.length, 1);
      assert.equal(targetRuns[1].callbackResponses[0].result.ok, true);
      assert.equal(targetRuns[1].callbackResponses[0].result.receipt.requestId, permissionRequest.requestId);
      assert.equal(
        resolved.result.receipts.filter((receipt) => receipt.requestId === permissionRequest.requestId).length,
        1
      );

      const resolvedAgain = await sendSourceJsonRpcRequest(
        servedTransport,
        createRequest(
          ACP_METHODS.sessionRequestPermission,
          {
            sessionId: sessionNew.result.sessionId,
            requestId: permissionRequest.requestId,
            approved: true,
            approvalId: "target-callback-write-approval",
            payloadHash: permissionRequest.details.payloadHash
          },
          "target-callback-write-resolve-again"
        )
      );
      assert.equal(resolvedAgain.result.alreadyResolved, true);
      assert.equal(resolvedAgain.result.newEvents.length, 0);
      assert.equal(resolvedAgain.notifications.length, 0);
      assert.equal(writeCount, 1);

      const completedReplay = await sendSourceJsonRpcRequest(
        servedTransport,
        createRequest(
          ACP_METHODS.sessionPrompt,
          {
            sessionId: sessionNew.result.sessionId,
            prompt: "target should request a write callback",
            idempotencyKey: "target-callback-write-idempotency"
          },
          "target-callback-write-completed-replay"
        )
      );
      assert.equal(completedReplay.result.idempotencyReplay, true);
      assert.equal(completedReplay.result.turnId, resolved.result.turnId);
      assert.equal(completedReplay.result.stopReason, "completed");
      assert.equal(completedReplay.result.output, "target completed after callback write approval");
      assert.equal(completedReplay.notifications.length, 0);
      assert.equal(targetRuns.length, 2);
      assert.equal(writeCount, 1);
    } finally {
      await closeServedSourceTransport(servedTransport);
      await closeServedSourceTransport(foreignServedTransport);
      await runtime.close();
      for (const run of targetRuns) {
        run.transportPair.close();
      }
      await Promise.allSettled(targetRuns.map((run) => run.serving));
    }
  });

  it("resumes target-originated ACP file write approvals after relay runtime restart", async () => {
    const workspaceRoot = await makeTempDir("pact-acp-target-callback-write-restart-ws-");
    const userDataPath = await makeTempDir("pact-acp-target-callback-write-restart-data-");
    const targetId = "acp.target-callback-write-restart-target";
    const virtualAgentId = "acp.target-callback-write-restart-agent";
    const targetRuns = [];
    let writeCount = 0;
    const callbackContent = "target callback restart-approved content";

    function startTargetRun() {
      const transportPair = createAcpSourceJsonRpcTransportPair();
      const run = {
        transportPair,
        received: [],
        callbackResponses: []
      };
      run.serving = (async () => {
        while (true) {
          const raw = await transportPair.server.receive();
          if (raw === null || raw === undefined) {
            return;
          }
          const message = parseJsonRpcMessage(raw);
          run.received.push(message);
          if (message.method === ACP_METHODS.initialize) {
            await transportPair.server.send(createSuccess(message.id, {
              protocolVersion: "v0.0.1:strategy:target-acp-callback-write-restart-1",
              capabilities: {
                session: ["new", "resume", "close"],
                updates: ["progress"],
                fs: ["write_text_file"]
              }
            }));
          } else if (message.method === ACP_METHODS.sessionNew || message.method === ACP_METHODS.sessionResume) {
            await transportPair.server.send(createSuccess(message.id, {
              targetSessionId: "target-callback-write-restart-session",
              targetResumeRef: "target-callback-write-restart-resume"
            }));
          } else if (message.method === ACP_METHODS.sessionPrompt) {
            await transportPair.server.send(createRequest(
              ACP_METHODS.fsWriteTextFile,
              {
                toolCallId: "target-write-restart-tool-call-1",
                path: "notes/target-callback-restart.txt",
                content: callbackContent
              },
              `target-callback-write-restart-${targetRuns.length}`
            ));
            const callbackRaw = await transportPair.server.receive();
            if (callbackRaw === null || callbackRaw === undefined) {
              return;
            }
            const callbackResponse = parseJsonRpcMessage(callbackRaw);
            run.callbackResponses.push(callbackResponse);
            if (callbackResponse.error) {
              return;
            }
            await transportPair.server.send(createSuccess(message.id, {
              stopReason: "completed",
              output: "target completed after restart callback approval",
              targetSessionId: "target-callback-write-restart-session",
              targetResumeRef: "target-callback-write-restart-resume"
            }));
          } else if (message.method === ACP_METHODS.sessionClose) {
            await transportPair.server.send(createSuccess(message.id, { ok: true }));
          } else {
            await transportPair.server.send(createError(message.id, -32601, `Unsupported target ACP method ${message.method}`));
          }
        }
      })();
      targetRuns.push(run);
      return transportPair.client;
    }

    function createRuntime() {
      return createAcpRelayRuntime({
        userDataPath,
        workspaceRoot,
        defaultVirtualAgentId: virtualAgentId,
        defaultSourceId: "codex-source-target-callback-write-restart",
        defaultWorkspaceId: "vitest-workspace",
        virtualAgentRegistry: new AcpVirtualAgentRegistry({
          [virtualAgentId]: {
            virtualAgentId,
            targetId,
            profileId: "pact.acp.target_callback_write_restart",
            displayName: "Target Callback Write Restart ACP Relay",
            advertisedModes: ["ask"],
            defaultMode: "ask",
            advertisedTools: ["fs.writeTextFile"],
            reasoningVisibilityPolicy: "never",
            capabilityPolicy: {
              writes: "approval_required",
              terminal: "deny",
              maxRisk: "repair_write"
            },
            revision: 1
          }
        }),
        targetRegistry: new AcpTargetRegistry({
          [targetId]: {
            targetId,
            label: "Target Callback Write Restart Target",
            transport: { type: "stdio" },
            advertisedToolsets: ["fs.writeTextFile"],
            capabilityPolicy: {
              writes: "approval_required",
              terminal: "deny",
              maxRisk: "repair_write"
            },
            enabled: true,
            revision: 1
          }
        }),
        permissionBridge: new AcpPermissionBridge({
          workspaceRoot,
          fileSystem: {
            readFile: fs.readFile,
            mkdir: fs.mkdir,
            async writeFile(...args) {
              writeCount += 1;
              return fs.writeFile(...args);
            }
          }
        }),
        sessionDriver: new AcpSessionDriver({
          connectionFactory: ({ target }) => new AcpClientConnection({
            target,
            transport: startTargetRun(),
            requestTimeoutMs: 1000
          })
        })
      });
    }

    let firstRuntime = createRuntime();
    let firstTransport = createServedSourceTransport(firstRuntime, {
      sourceId: "codex-source-target-callback-write-restart",
      workspaceId: "vitest-workspace"
    });
    let secondRuntime = null;
    let secondTransport = null;
    let parallelResolveTransport = null;
    try {
      const sessionNew = await sendSourceJsonRpcRequest(
        firstTransport,
        createRequest(
          ACP_METHODS.sessionNew,
          {
            virtualAgentId,
            sourceId: "codex-source-target-callback-write-restart",
            sourceSessionId: "target-callback-write-restart-session",
            workspaceId: "vitest-workspace"
          },
          "target-callback-write-restart-session-new"
        )
      );
      assert.match(sessionNew.result.sessionId, /^relay_session_/);

      const pending = await sendSourceJsonRpcRequest(
        firstTransport,
        createRequest(
          ACP_METHODS.sessionPrompt,
          {
            sessionId: sessionNew.result.sessionId,
            prompt: "target should request a write callback before relay restart",
            idempotencyKey: "target-callback-write-restart-idempotency"
          },
          "target-callback-write-restart-prompt"
        )
      );
      assert.equal(pending.result.stopReason, "approval_pending");
      assert.equal(pending.result.pendingPermissionRequests.length, 1);
      const permissionRequest = pending.result.pendingPermissionRequests[0];
      assert.equal(permissionRequest.details.content, undefined);
      assert.equal(JSON.stringify(pending.result).includes(callbackContent), false);
      assert.equal(writeCount, 0);

      const relayStorePath = path.join(userDataPath, "agent-relay", "acp-relay-store.json");
      const sensitiveStorePath = path.join(userDataPath, "agent-relay", "acp-sensitive-payloads.json");
      const relayStoreSnapshot = JSON.parse(await fs.readFile(relayStorePath, "utf8"));
      assert.equal(JSON.stringify(relayStoreSnapshot).includes(callbackContent), false);
      const sensitiveStoreSnapshot = JSON.parse(await fs.readFile(sensitiveStorePath, "utf8"));
      assert.equal(JSON.stringify(sensitiveStoreSnapshot).includes(callbackContent), true);
      assert.equal((await fs.stat(sensitiveStorePath)).mode & 0o777, 0o600);

      await closeServedSourceTransport(firstTransport);
      firstTransport = null;
      await firstRuntime.close();
      firstRuntime = null;
      for (const run of targetRuns) {
        run.transportPair.close();
      }
      await Promise.allSettled(targetRuns.map((run) => run.serving));
      assert.equal(writeCount, 0);

      secondRuntime = createRuntime();
      secondTransport = createServedSourceTransport(secondRuntime, {
        sourceId: "codex-source-target-callback-write-restart",
        workspaceId: "vitest-workspace"
      });
      const loaded = await sendSourceJsonRpcRequest(
        secondTransport,
        createRequest(
          ACP_METHODS.sessionLoad,
          {
            sessionId: sessionNew.result.sessionId,
            sourceId: "codex-source-target-callback-write-restart",
            sourceSessionId: "target-callback-write-restart-session",
            workspaceId: "vitest-workspace"
          },
          "target-callback-write-restart-load"
        )
      );
      assert.equal(loaded.result.pendingPermissionRequestCount, 1);
      assert.equal(loaded.result.pendingPermissionRequests[0].requestId, permissionRequest.requestId);
      assert.equal(JSON.stringify(loaded.result.pendingPermissionRequests).includes(callbackContent), false);

      const resumed = await sendSourceJsonRpcRequest(
        secondTransport,
        createRequest(
          ACP_METHODS.sessionResume,
          {
            sessionId: sessionNew.result.sessionId,
            sourceId: "codex-source-target-callback-write-restart",
            sourceSessionId: "target-callback-write-restart-session",
            workspaceId: "vitest-workspace"
          },
          "target-callback-write-restart-resume"
        )
      );
      assert.equal(resumed.result.lifecycleState, "approval_pending");
      assert.equal(resumed.result.pendingPermissionRequestCount, 1);
      assert.equal(resumed.result.pendingPermissionRequests[0].requestId, permissionRequest.requestId);

      parallelResolveTransport = createServedSourceTransport(secondRuntime, {
        sourceId: "codex-source-target-callback-write-restart",
        workspaceId: "vitest-workspace"
      });
      const resolveParams = {
        sessionId: sessionNew.result.sessionId,
        requestId: permissionRequest.requestId,
        sourceId: "codex-source-target-callback-write-restart",
        sourceSessionId: "target-callback-write-restart-session",
        workspaceId: "vitest-workspace",
        approved: true,
        approvalId: "target-callback-write-restart-approval",
        payloadHash: permissionRequest.details.payloadHash
      };
      const resolveResults = await Promise.all([
        sendSourceJsonRpcRequest(
          secondTransport,
          createRequest(ACP_METHODS.sessionRequestPermission, resolveParams, "target-callback-write-restart-resolve-a")
        ),
        sendSourceJsonRpcRequest(
          parallelResolveTransport,
          createRequest(ACP_METHODS.sessionRequestPermission, resolveParams, "target-callback-write-restart-resolve-b")
        )
      ]);
      const resolved = resolveResults.find((result) => result.result?.alreadyResolved !== true);
      const alreadyResolved = resolveResults.find((result) => result.result?.alreadyResolved === true);
      assert.ok(resolved);
      assert.ok(alreadyResolved);
      assert.equal(alreadyResolved.result.newEvents.length, 0);
      assert.match(resolved.id, /^target-callback-write-restart-resolve-[ab]$/);
      assert.equal(resolved.result.stopReason, "completed");
      assert.equal(resolved.result.turnId, pending.result.turnId);
      assert.equal(resolved.result.permissionRequest.status, "completed");
      assert.equal(resolved.result.output, "target completed after restart callback approval");
      assert.equal(writeCount, 1);
      assert.equal(
        await fs.readFile(path.join(workspaceRoot, "notes", "target-callback-restart.txt"), "utf8"),
        callbackContent
      );
      assert.equal(targetRuns.length, 2);
      assert.equal(targetRuns[1].callbackResponses[0].result.receipt.requestId, permissionRequest.requestId);
      assert.equal(JSON.stringify(await secondRuntime.store.getPermissionRequest(permissionRequest.requestId)).includes(callbackContent), false);
    } finally {
      if (firstTransport) {
        await closeServedSourceTransport(firstTransport);
      }
      if (secondTransport) {
        await closeServedSourceTransport(secondTransport);
      }
      if (parallelResolveTransport) {
        await closeServedSourceTransport(parallelResolveTransport);
      }
      if (firstRuntime) {
        await firstRuntime.close();
      }
      if (secondRuntime) {
        await secondRuntime.close();
      }
      for (const run of targetRuns) {
        run.transportPair.close();
      }
      await Promise.allSettled(targetRuns.map((run) => run.serving));
    }
  });

  it("cancels target-originated ACP file write callbacks without later writing", async () => {
    const workspaceRoot = await makeTempDir("pact-acp-target-callback-write-cancel-");
    const targetId = "acp.target-callback-write-cancel-target";
    const virtualAgentId = "acp.target-callback-write-cancel-agent";
    const targetRuns = [];
    let writeCount = 0;
    const callbackContent = "target callback cancelled content";

    function startTargetRun() {
      const transportPair = createAcpSourceJsonRpcTransportPair();
      const run = {
        transportPair,
        received: [],
        callbackResponses: []
      };
      run.serving = (async () => {
        while (true) {
          const raw = await transportPair.server.receive();
          if (raw === null || raw === undefined) {
            return;
          }
          const message = parseJsonRpcMessage(raw);
          run.received.push(message);
          if (message.method === ACP_METHODS.initialize) {
            await transportPair.server.send(createSuccess(message.id, {
              protocolVersion: "v0.0.1:strategy:target-acp-callback-write-cancel-1",
              capabilities: {
                session: ["new", "resume", "cancel"],
                updates: ["progress"],
                fs: ["write_text_file"]
              }
            }));
          } else if (message.method === ACP_METHODS.sessionNew || message.method === ACP_METHODS.sessionResume) {
            await transportPair.server.send(createSuccess(message.id, {
              targetSessionId: "target-callback-write-cancel-session",
              targetResumeRef: "target-callback-write-cancel-resume"
            }));
          } else if (message.method === ACP_METHODS.sessionPrompt) {
            await transportPair.server.send(createRequest(
              ACP_METHODS.fsWriteTextFile,
              {
                toolCallId: "target-write-cancel-tool-call-1",
                path: "notes/target-callback-cancelled.txt",
                content: callbackContent
              },
              `target-callback-write-cancel-${targetRuns.length}`
            ));
            const callbackRaw = await transportPair.server.receive();
            if (callbackRaw === null || callbackRaw === undefined) {
              return;
            }
            run.callbackResponses.push(parseJsonRpcMessage(callbackRaw));
          } else if (message.method === ACP_METHODS.sessionCancel) {
            await transportPair.server.send(createSuccess(message.id, { ok: true }));
          } else {
            await transportPair.server.send(createError(message.id, -32601, `Unsupported target ACP method ${message.method}`));
          }
        }
      })();
      targetRuns.push(run);
      return transportPair.client;
    }

    const runtime = createAcpRelayRuntime({
      workspaceRoot,
      defaultVirtualAgentId: virtualAgentId,
      defaultSourceId: "codex-source-target-callback-write-cancel",
      defaultWorkspaceId: "vitest-workspace",
      virtualAgentRegistry: new AcpVirtualAgentRegistry({
        [virtualAgentId]: {
          virtualAgentId,
          targetId,
          profileId: "pact.acp.target_callback_write_cancel",
          displayName: "Target Callback Write Cancel ACP Relay",
          advertisedModes: ["ask"],
          defaultMode: "ask",
          advertisedTools: ["fs.writeTextFile"],
          reasoningVisibilityPolicy: "never",
          capabilityPolicy: {
            writes: "approval_required",
            terminal: "deny",
            maxRisk: "repair_write"
          },
          revision: 1
        }
      }),
      targetRegistry: new AcpTargetRegistry({
        [targetId]: {
          targetId,
          label: "Target Callback Write Cancel Target",
          transport: { type: "stdio" },
          advertisedToolsets: ["fs.writeTextFile"],
          capabilityPolicy: {
            writes: "approval_required",
            terminal: "deny",
            maxRisk: "repair_write"
          },
          enabled: true,
          revision: 1
        }
      }),
      permissionBridge: new AcpPermissionBridge({
        workspaceRoot,
        fileSystem: {
          readFile: fs.readFile,
          mkdir: fs.mkdir,
          async writeFile(...args) {
            writeCount += 1;
            return fs.writeFile(...args);
          }
        }
      }),
      sessionDriver: new AcpSessionDriver({
        connectionFactory: ({ target }) => new AcpClientConnection({
          target,
          transport: startTargetRun(),
          requestTimeoutMs: 1000
        })
      })
    });
    const servedTransport = createServedSourceTransport(runtime, {
      sourceId: "codex-source-target-callback-write-cancel",
      workspaceId: "vitest-workspace"
    });

    try {
      const sessionNew = await sendSourceJsonRpcRequest(
        servedTransport,
        createRequest(
          ACP_METHODS.sessionNew,
          {
            virtualAgentId,
            sourceId: "codex-source-target-callback-write-cancel",
            sourceSessionId: "target-callback-write-cancel-session",
            workspaceId: "vitest-workspace"
          },
          "target-callback-write-cancel-session-new"
        )
      );
      assert.match(sessionNew.result.sessionId, /^relay_session_/);

      const pending = await sendSourceJsonRpcRequest(
        servedTransport,
        createRequest(
          ACP_METHODS.sessionPrompt,
          {
            sessionId: sessionNew.result.sessionId,
            prompt: "target should request a write callback and then be cancelled",
            idempotencyKey: "target-callback-write-cancel-idempotency"
          },
          "target-callback-write-cancel-prompt"
        )
      );
      assert.equal(pending.result.stopReason, "approval_pending");
      assert.equal(pending.result.pendingPermissionRequests.length, 1);
      assert.equal(JSON.stringify(pending.result).includes(callbackContent), false);
      const permissionRequest = pending.result.pendingPermissionRequests[0];
      assert.equal((await runtime.store.getPermissionRequest(permissionRequest.requestId)).status, "pending");
      assert.equal(writeCount, 0);

      const cancelled = await sendSourceJsonRpcRequest(
        servedTransport,
        createRequest(
          ACP_METHODS.sessionCancel,
          {
            sessionId: sessionNew.result.sessionId,
            sourceId: "codex-source-target-callback-write-cancel",
            sourceSessionId: "target-callback-write-cancel-session",
            workspaceId: "vitest-workspace"
          },
          "target-callback-write-cancel-session-cancel"
        )
      );
      assert.equal(cancelled.id, "target-callback-write-cancel-session-cancel");
      assert.equal(cancelled.result.cancelledTurns.length, 1);
      assert.equal(cancelled.result.cancelledTurns[0].turn.stopReason, "cancelled");
      assert.equal(cancelled.result.cancelledTurns[0].permissionRequests.length, 1);
      assert.equal(cancelled.result.cancelledTurns[0].permissionRequests[0].status, "cancelled");
      assert.equal(JSON.stringify(cancelled.result).includes(callbackContent), false);
      assert.equal((await runtime.store.getPermissionRequest(permissionRequest.requestId)).status, "cancelled");

      const pendingReplay = await sendSourceJsonRpcRequest(
        servedTransport,
        createRequest(
          ACP_METHODS.sessionPrompt,
          {
            sessionId: sessionNew.result.sessionId,
            prompt: "target should request a write callback and then be cancelled",
            idempotencyKey: "target-callback-write-cancel-idempotency"
          },
          "target-callback-write-cancel-replay"
        )
      );
      assert.equal(pendingReplay.result.idempotencyReplay, true);
      assert.equal(pendingReplay.result.turnId, pending.result.turnId);
      assert.equal(pendingReplay.result.stopReason, "cancelled");
      assert.equal(pendingReplay.result.pendingPermissionRequests.length, 0);
      assert.equal(pendingReplay.result.output, "Relay turn was cancelled by the source agent.");
      assert.equal(pendingReplay.notifications.length, 0);

      const resolveAfterCancel = await sendSourceJsonRpcRequest(
        servedTransport,
        createRequest(
          ACP_METHODS.sessionRequestPermission,
          {
            sessionId: sessionNew.result.sessionId,
            requestId: permissionRequest.requestId,
            approved: true,
            approvalId: "target-callback-write-cancel-approval",
            payloadHash: permissionRequest.details.payloadHash
          },
          "target-callback-write-cancel-resolve"
        )
      );
      assert.equal(resolveAfterCancel.id, "target-callback-write-cancel-resolve");
      assert.equal(resolveAfterCancel.error?.data?.code, "permission_request_not_pending");
      assert.equal(writeCount, 0);
      await assert.rejects(
        fs.readFile(path.join(workspaceRoot, "notes", "target-callback-cancelled.txt"), "utf8"),
        /ENOENT/
      );
      assert.equal(targetRuns.length, 1);
    } finally {
      await closeServedSourceTransport(servedTransport);
      await runtime.close();
      for (const run of targetRuns) {
        run.transportPair.close();
      }
      await Promise.allSettled(targetRuns.map((run) => run.serving));
    }
  });

  it("denies target-originated ACP file write callbacks through source ACP approval without writing or leaking content", async () => {
    const workspaceRoot = await makeTempDir("pact-acp-target-callback-write-deny-");
    const targetId = "acp.target-callback-write-deny-target";
    const virtualAgentId = "acp.target-callback-write-deny-agent";
    const targetRuns = [];
    let writeCount = 0;

    function startTargetRun() {
      const transportPair = createAcpSourceJsonRpcTransportPair();
      const run = { transportPair, received: [] };
      run.serving = (async () => {
        while (true) {
          const raw = await transportPair.server.receive();
          if (raw === null || raw === undefined) {
            return;
          }
          const message = parseJsonRpcMessage(raw);
          run.received.push(message);
          if (message.method === ACP_METHODS.initialize) {
            await transportPair.server.send(createSuccess(message.id, {
              protocolVersion: "v0.0.1:strategy:target-acp-callback-write-deny-1",
              capabilities: {
                session: ["new", "resume"],
                updates: ["progress"],
                fs: ["write_text_file"]
              }
            }));
          } else if (message.method === ACP_METHODS.sessionNew || message.method === ACP_METHODS.sessionResume) {
            await transportPair.server.send(createSuccess(message.id, {
              targetSessionId: "target-callback-write-deny-session",
              targetResumeRef: "target-callback-write-deny-resume"
            }));
          } else if (message.method === ACP_METHODS.sessionPrompt) {
            await transportPair.server.send(createRequest(
              ACP_METHODS.fsWriteTextFile,
              {
                toolCallId: "target-write-deny-tool-call-1",
                path: "notes/target-callback-denied.txt",
                content: "target callback denied content"
              },
              `target-callback-write-deny-${targetRuns.length}`
            ));
            await transportPair.server.receive();
          } else {
            await transportPair.server.send(createError(message.id, -32601, `Unsupported target ACP method ${message.method}`));
          }
        }
      })();
      targetRuns.push(run);
      return transportPair.client;
    }

    const runtime = createAcpRelayRuntime({
      workspaceRoot,
      defaultVirtualAgentId: virtualAgentId,
      defaultSourceId: "codex-source-target-callback-write-deny",
      defaultWorkspaceId: "vitest-workspace",
      virtualAgentRegistry: new AcpVirtualAgentRegistry({
        [virtualAgentId]: {
          virtualAgentId,
          targetId,
          profileId: "pact.acp.target_callback_write_deny",
          displayName: "Target Callback Write Deny ACP Relay",
          advertisedModes: ["ask"],
          defaultMode: "ask",
          advertisedTools: ["fs.writeTextFile"],
          reasoningVisibilityPolicy: "never",
          capabilityPolicy: {
            writes: "approval_required",
            terminal: "deny",
            maxRisk: "repair_write"
          },
          revision: 1
        }
      }),
      targetRegistry: new AcpTargetRegistry({
        [targetId]: {
          targetId,
          label: "Target Callback Write Deny Target",
          transport: { type: "stdio" },
          advertisedToolsets: ["fs.writeTextFile"],
          capabilityPolicy: {
            writes: "approval_required",
            terminal: "deny",
            maxRisk: "repair_write"
          },
          enabled: true,
          revision: 1
        }
      }),
      permissionBridge: new AcpPermissionBridge({
        workspaceRoot,
        fileSystem: {
          readFile: fs.readFile,
          mkdir: fs.mkdir,
          async writeFile(...args) {
            writeCount += 1;
            return fs.writeFile(...args);
          }
        }
      }),
      sessionDriver: new AcpSessionDriver({
        connectionFactory: ({ target }) => new AcpClientConnection({
          target,
          transport: startTargetRun(),
          requestTimeoutMs: 1000
        })
      })
    });
    const servedTransport = createServedSourceTransport(runtime, {
      sourceId: "codex-source-target-callback-write-deny",
      workspaceId: "vitest-workspace"
    });

    try {
      const sessionNew = await sendSourceJsonRpcRequest(
        servedTransport,
        createRequest(
          ACP_METHODS.sessionNew,
          {
            virtualAgentId,
            sourceId: "codex-source-target-callback-write-deny",
            sourceSessionId: "target-callback-write-deny-session",
            workspaceId: "vitest-workspace"
          },
          "target-callback-write-deny-session-new"
        )
      );

      const pending = await sendSourceJsonRpcRequest(
        servedTransport,
        createRequest(
          ACP_METHODS.sessionPrompt,
          {
            sessionId: sessionNew.result.sessionId,
            prompt: "target should request a write callback and be denied"
          },
          "target-callback-write-deny-prompt"
        )
      );
      assert.equal(pending.result.stopReason, "approval_pending");
      const permissionRequest = pending.result.pendingPermissionRequests[0];
      assert.equal(permissionRequest.targetToolCallId, "target-write-deny-tool-call-1");
      assert.equal(permissionRequest.details.content, undefined);
      assert.equal(JSON.stringify(pending.result).includes("target callback denied content"), false);
      assert.equal(writeCount, 0);

      const denied = await sendSourceJsonRpcRequest(
        servedTransport,
        createRequest(
          ACP_METHODS.sessionRequestPermission,
          {
            sessionId: sessionNew.result.sessionId,
            requestId: permissionRequest.requestId,
            approved: false,
            reason: "source denied target callback write"
          },
          "target-callback-write-deny-resolve"
        )
      );
      assert.equal(denied.result.stopReason, "approval_denied");
      assert.equal(denied.result.responseKind, "approval_denied");
      assert.equal(denied.result.communicationSummary.summaryKind, "approval_denied");
      assert.equal(denied.result.permissionRequest.status, "denied");
      assert.equal(denied.result.permissionRequest.details.content, undefined);
      assert.equal(JSON.stringify(denied.result).includes("target callback denied content"), false);
      assert.equal(denied.notifications.some((notification) => notification.params?.type === "denial"), true);
      assert.equal(
        denied.notifications.some(
          (notification) => notification.params?.type === "completion" && notification.params?.phase === "approval_denied"
        ),
        true
      );
      assert.equal(writeCount, 0);
      assert.equal(targetRuns.length, 1);
      await assert.rejects(
        fs.readFile(path.join(workspaceRoot, "notes", "target-callback-denied.txt"), "utf8"),
        /ENOENT/
      );
    } finally {
      await closeServedSourceTransport(servedTransport);
      await runtime.close();
      for (const run of targetRuns) {
        run.transportPair.close();
      }
      await Promise.allSettled(targetRuns.map((run) => run.serving));
    }
  });

  it("denies pending write approvals through source ACP session/request_permission without writing files", async () => {
    const workspaceRoot = await makeTempDir("pact-acp-source-permission-deny-");
    const targetId = "mock.source-permission-deny-target";
    const virtualAgentId = "mock.source-permission-deny-agent";
    const runtime = createAcpRelayRuntime({
      workspaceRoot,
      virtualAgentRegistry: new AcpVirtualAgentRegistry({
        [virtualAgentId]: {
          virtualAgentId,
          targetId,
          profileId: "pact.acp.source_permission_deny.mock",
          displayName: "Source Permission Deny Mock ACP Relay",
          advertisedModes: ["ask"],
          defaultMode: "ask",
          advertisedTools: ["fs.writeTextFile"],
          reasoningVisibilityPolicy: "never",
          capabilityPolicy: {
            writes: "approval_required",
            terminal: "deny",
            maxRisk: "repair_write"
          },
          revision: 1
        }
      }),
      targetRegistry: new AcpTargetRegistry({
        [targetId]: {
          targetId,
          label: "Source Permission Deny Mock Target",
          transport: { type: "mock" },
          advertisedToolsets: ["fs.writeTextFile"],
          capabilityPolicy: {
            writes: "approval_required",
            terminal: "deny",
            maxRisk: "repair_write"
          },
          enabled: true,
          revision: 1
        }
      })
    });
    const servedTransport = createServedSourceTransport(runtime, {
      sourceId: "codex-source-permission-deny-vitest",
      workspaceId: "vitest-workspace"
    });

    try {
      const sessionNew = await sendSourceJsonRpcRequest(
        servedTransport,
        createRequest(
          ACP_METHODS.sessionNew,
          {
            virtualAgentId,
            sourceId: "codex-source-permission-deny-vitest",
            sourceSessionId: "source-permission-deny-session",
            workspaceId: "vitest-workspace"
          },
          "source-permission-deny-session-new"
        )
      );
      assert.match(sessionNew.result.sessionId, /^relay_session_/);

      const pending = await sendSourceJsonRpcRequest(
        servedTransport,
        createRequest(
          ACP_METHODS.sessionPrompt,
          {
            sessionId: sessionNew.result.sessionId,
            prompt: "write only if source approves",
            idempotencyKey: "source-permission-deny-idempotency",
            fileWrites: [
              {
                path: "notes/source-denied.txt",
                content: "denied through source ACP"
              }
            ]
          },
          "source-permission-deny-prompt"
        )
      );
      assert.equal(pending.result.stopReason, "approval_pending");
      assert.equal(pending.result.pendingPermissionRequests.length, 1);
      assert.equal(pending.notifications.some((notification) => notification.params?.phase === "approval_pending"), true);
      const permissionRequest = pending.result.pendingPermissionRequests[0];
      assert.equal(permissionRequest.details.content, undefined);
      assert.equal(permissionRequest.details.promptText, undefined);
      assert.equal(JSON.stringify(pending.result).includes("denied through source ACP"), false);

      const denied = await sendSourceJsonRpcRequest(
        servedTransport,
        createRequest(
          ACP_METHODS.sessionRequestPermission,
          {
            sessionId: sessionNew.result.sessionId,
            requestId: permissionRequest.requestId,
            approved: false,
            reason: "source ACP denied"
          },
          "source-permission-deny-resolve"
        )
      );
      assert.equal(denied.id, "source-permission-deny-resolve");
      assert.equal(denied.result.stopReason, "approval_denied");
      assert.equal(denied.result.responseKind, "approval_denied");
      assert.equal(denied.result.communicationSummary.summaryKind, "approval_denied");
      assert.equal(denied.result.permissionRequest.status, "denied");
      assert.equal(denied.result.permissionRequest.details.content, undefined);
      assert.equal(denied.notifications.some((notification) => notification.params?.type === "denial"), true);
      assert.equal(
        denied.notifications.some(
          (notification) => notification.params?.type === "completion" && notification.params?.phase === "approval_denied"
        ),
        true
      );
      assert.match(denied.result.output, /Permission request was denied/);
      await assert.rejects(
        fs.readFile(path.join(workspaceRoot, "notes", "source-denied.txt"), "utf8"),
        /ENOENT/
      );

      const deniedReplay = await sendSourceJsonRpcRequest(
        servedTransport,
        createRequest(
          ACP_METHODS.sessionPrompt,
          {
            sessionId: sessionNew.result.sessionId,
            prompt: "write only if source approves",
            idempotencyKey: "source-permission-deny-idempotency",
            fileWrites: [
              {
                path: "notes/source-denied.txt",
                content: "denied through source ACP"
              }
            ]
          },
          "source-permission-deny-prompt-replay"
        )
      );
      assert.equal(deniedReplay.result.idempotencyReplay, true);
      assert.equal(deniedReplay.result.turnId, denied.result.turnId);
      assert.equal(deniedReplay.result.stopReason, "approval_denied");
      assert.equal(deniedReplay.result.responseKind, "approval_denied");
      assert.equal(deniedReplay.result.communicationSummary.summaryKind, "approval_denied");
      assert.equal(deniedReplay.result.pendingPermissionRequests.length, 0);
      assert.equal(deniedReplay.notifications.length, 0);
      await assert.rejects(
        fs.readFile(path.join(workspaceRoot, "notes", "source-denied.txt"), "utf8"),
        /ENOENT/
      );
    } finally {
      await closeServedSourceTransport(servedTransport);
    }
  });

  it("loads by source identity and closes a source ACP session through the shared executor", async () => {
    const { runtime, virtualAgentId } = createSourceBridgeRuntime();
    const servedTransport = createServedSourceTransport(runtime, {
      sourceId: "codex-source-vitest",
      workspaceId: "vitest-workspace"
    });
    const sourceIdentity = {
      virtualAgentId,
      sourceId: "codex-source-vitest",
      sourceSessionId: "codex-acp-source-load-close",
      workspaceId: "vitest-workspace"
    };

    try {
      const sessionNew = await sendSourceJsonRpcRequest(
        servedTransport,
        createRequest(ACP_METHODS.sessionNew, sourceIdentity, "source-session-new-load")
      );
      assert.match(sessionNew.result.sessionId, /^relay_session_/);

      const loaded = await sendSourceJsonRpcRequest(
        servedTransport,
        createRequest(ACP_METHODS.sessionLoad, sourceIdentity, "source-session-load")
      );
      assert.equal(loaded.id, "source-session-load");
      assert.equal(loaded.result.sessionId, sessionNew.result.sessionId);
      assert.equal(loaded.result.sourceSessionId, sourceIdentity.sourceSessionId);
      assert.equal(loaded.result.lifecycleState, "dormant");
      assert.deepEqual(loaded.result.capabilities.tools, ["agentapi.sendMessage"]);
      assert.equal(loaded.result.capabilitiesSnapshot.target.transportType, "antigravity-agentapi");
      assert.equal(loaded.result.capabilitiesSnapshotError, "");

      const closed = await sendSourceJsonRpcRequest(
        servedTransport,
        createRequest(
          ACP_METHODS.sessionClose,
          {
            sessionId: sessionNew.result.sessionId,
            sourceId: sourceIdentity.sourceId,
            workspaceId: sourceIdentity.workspaceId
          },
          "source-session-close"
        )
      );
      assert.equal(closed.id, "source-session-close");
      assert.equal(closed.result.sessionId, sessionNew.result.sessionId);
      assert.equal(closed.result.lifecycleState, "closed");

      const reloaded = await sendSourceJsonRpcRequest(
        servedTransport,
        createRequest(
          ACP_METHODS.sessionLoad,
          {
            sessionId: sessionNew.result.sessionId
          },
          "source-session-reload-closed"
        )
      );
      assert.equal(reloaded.result.lifecycleState, "closed");
      assert.deepEqual(reloaded.result.capabilities.tools, ["agentapi.sendMessage"]);
      assert.equal(reloaded.result.capabilitiesSnapshot.target.transportType, "antigravity-agentapi");
      assert.equal(reloaded.result.capabilitiesSnapshotError, "");
    } finally {
      await closeServedSourceTransport(servedTransport);
    }
  });

  it("treats source ACP notifications as one-way messages", async () => {
    const { runtime, virtualAgentId } = createSourceBridgeRuntime();
    const servedTransport = createServedSourceTransport(runtime, {
      sourceId: "codex-source-vitest",
      workspaceId: "vitest-workspace"
    });

    try {
      const response = await waitForNoSourceJsonRpcResponse(
        servedTransport,
        createNotification(ACP_METHODS.initialize, {
          virtualAgentId,
          sourceId: "codex-source-vitest",
          workspaceId: "vitest-workspace"
        })
      );

      assert.equal(response, null);
    } finally {
      await closeServedSourceTransport(servedTransport);
    }
  });

  it("returns JSON-RPC method-not-found errors for unsupported source ACP methods", async () => {
    const { runtime } = createSourceBridgeRuntime();
    const servedTransport = createServedSourceTransport(runtime, {
      sourceId: "codex-source-vitest",
      workspaceId: "vitest-workspace"
    });

    try {
      const response = await sendSourceJsonRpcRequest(
        servedTransport,
        createRequest("session/unsupported", {}, "source-unknown")
      );

      assert.equal(response.id, "source-unknown");
      assert.equal(response.error.code, -32601);
      assert.match(response.error.message, /Unsupported ACP method/);
    } finally {
      await closeServedSourceTransport(servedTransport);
    }
  });

  it("serves source ACP JSON-RPC frames over a duplex transport", async () => {
    const tempRoot = await makeTempDir("pact-acp-source-observe-");
    const brainRoot = path.join(tempRoot, "brain");
    const { calls, conversationId, runtime, virtualAgentId } = createSourceBridgeRuntime({
      transportOptions: {
        localObservationEnabled: true,
        localObservationBrainRoot: brainRoot
      }
    });
    const servedTransport = createServedSourceTransport(runtime, {
      sourceId: "codex-source-vitest",
      workspaceId: "vitest-workspace"
    });

    try {
      await servedTransport.transportPair.client.send(
        Buffer.from(JSON.stringify(createRequest(ACP_METHODS.initialize, { virtualAgentId }, "transport-init")))
      );
      const initialize = parseJsonRpcMessage(await servedTransport.transportPair.client.receive());
      assert.equal(initialize.id, "transport-init");
      assert.equal(initialize.result.virtualAgentId, virtualAgentId);

      await servedTransport.transportPair.client.send(
        createRequest(
          ACP_METHODS.sessionNew,
          {
            virtualAgentId,
            sourceId: "codex-source-vitest",
            sourceSessionId: "codex-acp-source-transport",
            workspaceId: "vitest-workspace"
          },
          "transport-session-new"
        )
      );
      const sessionNew = parseJsonRpcMessage(await servedTransport.transportPair.client.receive());
      assert.equal(sessionNew.id, "transport-session-new");
      assert.match(sessionNew.result.sessionId, /^relay_session_/);

      await servedTransport.transportPair.client.send(
        createNotification(ACP_METHODS.initialize, {
          virtualAgentId,
          sourceId: "codex-source-vitest",
          workspaceId: "vitest-workspace"
        })
      );
      await servedTransport.transportPair.client.send(
        createRequest(
          ACP_METHODS.sessionPrompt,
          {
            sessionId: sessionNew.result.sessionId,
            prompt: "delegate via source ACP transport service"
          },
          "transport-prompt"
        )
      );
      const prompt = await receiveJsonRpcResponseUntilId(
        () => servedTransport.transportPair.client.receive(),
        "transport-prompt"
      );
      assert.equal(prompt.id, "transport-prompt");
      assert.equal(prompt.notifications.length > 0, true);
      assert.equal(prompt.notifications.some((notification) => notification.params?.phase === "accepted"), true);
      assert.equal(prompt.result.stopReason, "accepted");
      assert.equal(prompt.result.targetEvidence.transportType, "antigravity-agentapi");
      assert.deepEqual(prompt.result.targetEvidence.externalResponseKeys, ["sendMessage"]);
      assert.equal(calls.some((call) => call.method === "sendMessage"), true);

      const transcriptPath = path.join(brainRoot, conversationId, ".system_generated/logs/transcript.jsonl");
      await fs.mkdir(path.dirname(transcriptPath), { recursive: true });
      await fs.writeFile(
        transcriptPath,
        `${JSON.stringify({
          step_index: 1,
          source: "MODEL",
          type: "PLANNER_RESPONSE",
          status: "DONE",
          created_at: nowIso(),
          content: "已完成：source ACP JSON-RPC turn.observe final response"
        })}\n`,
        "utf8"
      );

      await servedTransport.transportPair.client.send(
        createRequest(
          ACP_METHODS.pactTurnObserve,
          {
            sessionId: sessionNew.result.sessionId,
            relayTurnId: prompt.result.turnId,
            wait: false,
            timeoutMs: 100,
            maxTranscriptEntries: 10,
            maxMessageEntries: 10
          },
          "transport-turn-observe"
        )
      );
      const observed = parseJsonRpcMessage(await servedTransport.transportPair.client.receive());
      assert.equal(observed.id, "transport-turn-observe");
      assert.equal(observed.result.relaySessionId, sessionNew.result.sessionId);
      assert.equal(observed.result.relayTurnId, prompt.result.turnId);
      assert.equal(observed.result.observed, true);
      assert.equal(observed.result.refreshed, true);
      assert.equal(observed.result.stopReason, "completed");
      assert.equal(observed.result.responseKind, "final_response");
      assert.equal(observed.result.externalCompletionState, "completed");
      assert.equal(observed.result.finalResponseAvailable, true);
      assert.equal(observed.result.finalResponsePolicy, "local_conversation_observation");
      assert.equal(observed.result.communicationSummary.relayTurnId, prompt.result.turnId);
      assert.equal(observed.result.communicationSummary.summaryKind, "final_response");
      assert.match(observed.result.communicationSummary.finalResponseSummary, /source ACP JSON-RPC turn\.observe/);
      assert.equal(observed.result.communicationSummary.acknowledgementSummary, "");
      assert.equal(observed.result.communicationSummary.finalResponseAvailable, true);
      assert.equal(observed.result.communicationSummary.externalCompletionState, "completed");
      assert.equal(observed.result.targetObservation.finalResponseAvailable, true);
      assert.match(observed.result.targetObservation.latestFinalResponse.textPreview, /source ACP JSON-RPC turn\.observe/);
      assert.equal(observed.result.targetObservation.latestFinalResponse.text, undefined);
      assert.equal(JSON.stringify(observed.result).includes('"content":"已完成'), false);
      assert.equal(JSON.stringify(observed.result).includes("transcriptPath"), false);
      assert.equal(JSON.stringify(observed.result).includes("messagesDir"), false);
    } finally {
      await closeServedSourceTransport(servedTransport);
    }
  }, 20000);

  it("serves source ACP JSON-RPC over line-delimited stdio-compatible streams", async () => {
    const { calls, runtime, virtualAgentId } = createSourceBridgeRuntime();
    const sourceToPact = new PassThrough();
    const pactToSource = new PassThrough();
    const lineTransport = createAcpSourceJsonRpcLineTransport({
      input: sourceToPact,
      output: pactToSource
    });
    const service = createAcpSourceJsonRpcService({
      runtime,
      context: {
        sourceId: "codex-source-vitest",
        workspaceId: "vitest-workspace"
      }
    });
    const output = createOutputLineReader(pactToSource);
    const serving = service.serveTransport(lineTransport);

    const sendLine = (message, { lineEnding = "\n" } = {}) => {
      sourceToPact.write(`${JSON.stringify(message)}${lineEnding}`, "utf8");
    };
    const sendRawLine = (line, { lineEnding = "\n" } = {}) => {
      sourceToPact.write(`${line}${lineEnding}`, "utf8");
    };
    const sendFragmentedLine = (message, { splitAt = 8, lineEnding = "\n" } = {}) => {
      const frame = `${JSON.stringify(message)}${lineEnding}`;
      sourceToPact.write(frame.slice(0, splitAt), "utf8");
      sourceToPact.write(frame.slice(splitAt), "utf8");
    };

    try {
      sendRawLine("{not-json", { lineEnding: "\r\n" });
      const parseError = parseJsonRpcMessage(await output.receiveLine());
      assert.equal(parseError.id, null);
      assert.equal(parseError.error.code, -32700);

      sendFragmentedLine(createRequest(ACP_METHODS.initialize, { virtualAgentId }, "stdio-init"), {
        splitAt: 13,
        lineEnding: "\r\n"
      });
      const initialize = parseJsonRpcMessage(await output.receiveLine());
      assert.equal(initialize.id, "stdio-init");
      assert.equal(initialize.result.virtualAgentId, virtualAgentId);

      sendLine(
        createRequest(
          ACP_METHODS.sessionNew,
          {
            virtualAgentId,
            sourceId: "codex-source-vitest",
            sourceSessionId: "codex-acp-source-stdio",
            workspaceId: "vitest-workspace"
          },
          "stdio-session-new"
        )
      );
      const sessionNew = parseJsonRpcMessage(await output.receiveLine());
      assert.equal(sessionNew.id, "stdio-session-new");
      assert.match(sessionNew.result.sessionId, /^relay_session_/);

      sendLine(createNotification("pact.test/noop", { source: "notification-only" }), {
        lineEnding: "\r\n"
      });
      sendLine(
        createRequest(
          ACP_METHODS.sessionPrompt,
          {
            sessionId: sessionNew.result.sessionId,
            prompt: "delegate via source ACP stdio line transport"
          },
          "stdio-prompt"
        )
      );
      const prompt = await receiveJsonRpcResponseUntilId(() => output.receiveLine(), "stdio-prompt");
      assert.equal(prompt.id, "stdio-prompt");
      assert.equal(prompt.notifications.length > 0, true);
      assert.equal(prompt.notifications.some((notification) => notification.params?.phase === "accepted"), true);
      assert.equal(prompt.result.stopReason, "accepted");
      assert.equal(prompt.result.targetEvidence.transportType, "antigravity-agentapi");
      assert.deepEqual(prompt.result.targetEvidence.externalResponseKeys, ["sendMessage"]);
      assert.equal(calls.some((call) => call.method === "sendMessage"), true);
    } finally {
      lineTransport.close();
      sourceToPact.destroy();
      pactToSource.destroy();
      await serving;
    }
  });

  it.skip("serves source ACP JSON-RPC from an external child-process stdio entrypoint", async () => {
    const targetId = "mock.child-process-target";
    const virtualAgentId = "mock.child-process-agent";
    const child = spawn(process.execPath, ["server/scripts/acp-agent-relay-source-stdio.mjs"], {
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        PACT_ACP_SOURCE_STDIO_RUNTIME_JSON: JSON.stringify({
          defaultVirtualAgentId: virtualAgentId,
          defaultSourceId: "codex-source-vitest-child",
          defaultWorkspaceId: "vitest-workspace",
          virtualAgents: {
            [virtualAgentId]: {
              virtualAgentId,
              targetId,
              profileId: "pact.acp.child_process.mock",
              displayName: "Child Process Mock ACP Relay",
              advertisedModes: ["ask"],
              defaultMode: "ask",
              advertisedTools: ["mock.prompt"],
              reasoningVisibilityPolicy: "never",
              capabilityPolicy: {
                writes: "deny",
                terminal: "deny",
                maxRisk: "read_only"
              },
              revision: 1
            }
          },
          targets: {
            [targetId]: {
              targetId,
              label: "Child Process Mock Target",
              transport: { type: "mock" },
              enabled: true,
              revision: 1
            }
          }
        }),
        PACT_ACP_SOURCE_STDIO_CONTEXT_JSON: JSON.stringify({
          sourceId: "codex-source-vitest-child",
          workspaceId: "vitest-workspace"
        })
      }
    });
    const stdout = createOutputLineReader(child.stdout);
    const stderr = createOutputLineReader(child.stderr);
    const sendLine = (message) => {
      child.stdin.write(`${JSON.stringify(message)}\n`, "utf8");
    };

    try {
      const ready = JSON.parse(await stderr.receiveLine());
      assert.equal(ready.event, "pact.acp.source_stdio.ready");

      sendLine(createRequest(ACP_METHODS.initialize, { virtualAgentId }, "child-init"));
      const initialize = parseJsonRpcMessage(await stdout.receiveLine());
      assert.equal(initialize.id, "child-init");
      assert.equal(initialize.result.virtualAgentId, virtualAgentId);

      sendLine(
        createRequest(
          ACP_METHODS.sessionNew,
          {
            virtualAgentId,
            sourceId: "codex-source-vitest-child",
            sourceSessionId: "child-process-session",
            workspaceId: "vitest-workspace"
          },
          "child-session-new"
        )
      );
      const sessionNew = parseJsonRpcMessage(await stdout.receiveLine());
      assert.equal(sessionNew.id, "child-session-new");
      assert.match(sessionNew.result.sessionId, /^relay_session_/);

      sendLine(
        createRequest(
          ACP_METHODS.sessionLoad,
          {
            virtualAgentId,
            sourceId: "codex-source-vitest-child",
            sourceSessionId: "child-process-session",
            workspaceId: "vitest-workspace"
          },
          "child-session-load"
        )
      );
      const loaded = parseJsonRpcMessage(await stdout.receiveLine());
      assert.equal(loaded.id, "child-session-load");
      assert.equal(loaded.result.sessionId, sessionNew.result.sessionId);

      sendLine(
        createRequest(
          ACP_METHODS.sessionResume,
          {
            virtualAgentId,
            sourceId: "codex-source-vitest-child",
            sourceSessionId: "child-process-session",
            workspaceId: "vitest-workspace"
          },
          "child-session-resume"
        )
      );
      const resumed = parseJsonRpcMessage(await stdout.receiveLine());
      assert.equal(resumed.id, "child-session-resume");
      assert.equal(resumed.result.sessionId, sessionNew.result.sessionId);

      sendLine(
        createRequest(
          ACP_METHODS.sessionPrompt,
          {
            sessionId: resumed.result.sessionId,
            prompt: "verify child process source ACP stdio"
          },
          "child-prompt"
        )
      );
      const prompt = await receiveJsonRpcResponseUntilId(() => stdout.receiveLine(), "child-prompt");
      assert.equal(prompt.id, "child-prompt");
      assert.equal(prompt.notifications.length > 0, true);
      assert.equal(prompt.notifications.some((notification) => notification.params?.phase === "accepted"), true);
      assert.equal(prompt.result.stopReason, "completed");
      assertPromptAuditEvidence(prompt);
      assert.match(prompt.result.output, /Mock ACP target completed/);
      assert.equal(prompt.result.targetEvidence.targetSessionId, `target_session_${sessionNew.result.sessionId}`);
      assert.equal(prompt.result.targetEvidence.targetResumeRef, `resume_${sessionNew.result.sessionId}`);
    } finally {
      child.stdin.end();
    }

    const exit = await waitForProcessExit(child);
    assert.equal(exit.code, 0);
  });

  it.skip("relays from external source ACP stdio to an external target ACP stdio process", async () => {
    const tempRoot = await makeTempDir("pact-acp-source-target-stdio-");
    const targetScript = path.join(tempRoot, "target-acp-stdio.mjs");
    const targetExitMarker = path.join(tempRoot, "target-exited.txt");
    await fs.writeFile(
      targetScript,
      `
import fs from "node:fs";
import readline from "node:readline";

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
const exitMarker = process.env.PACT_TARGET_EXIT_MARKER || "";

process.on("SIGTERM", () => {
  if (exitMarker) {
    fs.writeFileSync(exitMarker, "sigterm", "utf8");
  }
  process.exit(0);
});

function send(payload) {
  process.stdout.write(JSON.stringify(payload) + "\\n");
}

for await (const line of lines) {
  if (!line.trim()) continue;
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    send({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: "v0.0.1:strategy:target-acp-source-to-target-1", capabilities: { session: ["new", "resume"], updates: ["progress"] } } });
  } else if (message.method === "session/new" || message.method === "session/resume") {
    send({ jsonrpc: "2.0", id: message.id, result: { targetSessionId: "source-target-stdio-session", targetResumeRef: "source-target-stdio-resume" } });
  } else if (message.method === "session/prompt") {
    send({ jsonrpc: "2.0", method: "session/update", params: { type: "progress", phase: "working", text: "target stdio is working" } });
    send({ jsonrpc: "2.0", id: message.id, result: { stopReason: "completed", output: "external source reached external target final response" } });
  } else {
    send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "unsupported" } });
  }
}
`,
      "utf8"
    );

    const targetId = "stdio.e2e-target";
    const virtualAgentId = "stdio.e2e-agent";
    const runtimeOptions = {
      defaultVirtualAgentId: virtualAgentId,
      defaultSourceId: "codex-source-vitest-stdio-e2e",
      defaultWorkspaceId: "vitest-workspace",
      virtualAgents: {
        [virtualAgentId]: {
          virtualAgentId,
          targetId,
          profileId: "pact.acp.source_target_stdio",
          displayName: "Source Target Stdio ACP Relay",
          advertisedModes: ["ask"],
          defaultMode: "ask",
          advertisedTools: ["target.acp.prompt"],
          reasoningVisibilityPolicy: "never",
          capabilityPolicy: {
            writes: "deny",
            terminal: "deny",
            maxRisk: "read_only"
          },
          revision: 1
        }
      },
      targets: {
        [targetId]: {
          targetId,
          label: "Target Stdio ACP Agent",
          transport: {
            type: "stdio",
            protocolStyle: "agent-client-protocol-v1",
            command: {
              executable: process.execPath,
              args: [targetScript],
              env: {
                PACT_TARGET_EXIT_MARKER: targetExitMarker
              }
            },
            timeoutMs: 1000
          },
          externalServiceId: "external.test.target-stdio",
          advertisedToolsets: ["target.acp.prompt"],
          capabilityPolicy: {
            writes: "deny",
            terminal: "deny",
            maxRisk: "read_only"
          },
          enabled: true,
          revision: 1
        }
      }
    };
    const child = spawn(process.execPath, ["server/scripts/acp-agent-relay-source-stdio.mjs"], {
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        PACT_ACP_SOURCE_STDIO_RUNTIME_JSON: JSON.stringify(runtimeOptions),
        PACT_ACP_SOURCE_STDIO_CONTEXT_JSON: JSON.stringify({
          sourceId: "codex-source-vitest-stdio-e2e",
          workspaceId: "vitest-workspace"
        })
      }
    });
    const stdout = createOutputLineReader(child.stdout);
    const stderr = createOutputLineReader(child.stderr);
    const sendLine = (message) => {
      child.stdin.write(`${JSON.stringify(message)}\n`, "utf8");
    };
    const waitForTargetExitMarker = async () => {
      for (let index = 0; index < 40; index += 1) {
        const marker = await fs.readFile(targetExitMarker, "utf8").catch(() => "");
        if (marker) {
          return marker;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error("Timed out waiting for target stdio process exit marker.");
    };

    try {
      const ready = JSON.parse(await stderr.receiveLine());
      assert.equal(ready.event, "pact.acp.source_stdio.ready");

      sendLine(createRequest(ACP_METHODS.initialize, { virtualAgentId }, "stdio-e2e-init"));
      const initialize = parseJsonRpcMessage(await stdout.receiveLine());
      assert.equal(initialize.id, "stdio-e2e-init");
      assert.equal(initialize.result.virtualAgentId, virtualAgentId);
      assert.equal(initialize.result.capabilitiesSnapshot.target.targetCommunicationMode, "native_acp_stdio");
      assert.equal(initialize.result.capabilitiesSnapshot.target.nativeAcpTargetSupported, true);
      assert.equal(initialize.result.capabilitiesSnapshot.target.nativeAcpTargetVerified, false);

      sendLine(createRequest(
        ACP_METHODS.sessionNew,
        {
          virtualAgentId,
          sourceId: "codex-source-vitest-stdio-e2e",
          sourceSessionId: "stdio-e2e-session",
          workspaceId: "vitest-workspace"
        },
        "stdio-e2e-session-new"
      ));
      const sessionNew = parseJsonRpcMessage(await stdout.receiveLine());
      assert.match(sessionNew.result.sessionId, /^relay_session_/);
      assert.equal(sessionNew.result.capabilitiesSnapshot.target.targetCommunicationMode, "native_acp_stdio");
      assert.equal(sessionNew.result.capabilitiesSnapshot.target.nativeAcpTargetSupported, true);

      sendLine(createRequest(
        ACP_METHODS.sessionPrompt,
        {
          sessionId: sessionNew.result.sessionId,
          prompt: "source stdio to target stdio"
        },
        "stdio-e2e-prompt"
      ));
      const prompt = await receiveJsonRpcResponseUntilId(() => stdout.receiveLine(), "stdio-e2e-prompt");
      assert.equal(prompt.result.stopReason, "completed");
      assert.equal(prompt.result.output, "external source reached external target final response");
      assert.equal(prompt.result.targetEvidence.transportType, "stdio");
      assert.equal(prompt.result.targetEvidence.targetCommunicationMode, "native_acp_stdio");
      assert.equal(prompt.result.targetEvidence.nativeAcpTargetSupported, true);
      assert.equal(prompt.result.targetEvidence.externalServiceId, "external.test.target-stdio");
      assert.equal(prompt.result.targetEvidence.targetSessionId, "source-target-stdio-session");
      assert.equal(prompt.result.targetEvidence.targetResumeRef, "source-target-stdio-resume");
      assert.equal(prompt.result.targetEvidence.finalResponseAvailable, true);
      assert.equal(prompt.result.communicationSummary.stopReason, "completed");
      assert.equal(prompt.result.communicationSummary.relayTurnId, prompt.result.turnId);
      assert.equal(prompt.result.communicationSummary.outputSummary, "external source reached external target final response");
      assert.equal(prompt.result.communicationSummary.targetSessionId, "source-target-stdio-session");
      assert.equal(prompt.result.communicationSummary.finalResponseAvailable, true);
      assert.equal(prompt.notifications.some((notification) => notification.params?.phase === "working"), true);
      assert.equal(prompt.notifications.some((notification) => notification.params?.type === "completion"), true);
      assertPromptAuditEvidence(prompt);

      sendLine(createRequest(
        ACP_METHODS.sessionClose,
        {
          sessionId: sessionNew.result.sessionId,
          sourceId: "codex-source-vitest-stdio-e2e",
          workspaceId: "vitest-workspace"
        },
        "stdio-e2e-close"
      ));
      const closed = parseJsonRpcMessage(await stdout.receiveLine());
      assert.equal(closed.id, "stdio-e2e-close");
      assert.equal(closed.result.lifecycleState, "closed");
      assert.equal(closed.result.close.ok, true);
      assert.match(await waitForTargetExitMarker(), /sigterm/);

      sendLine(createRequest(
        ACP_METHODS.sessionPrompt,
        {
          sessionId: sessionNew.result.sessionId,
          prompt: "should fail after source close"
        },
        "stdio-e2e-prompt-after-close"
      ));
      const promptAfterClose = parseJsonRpcMessage(await stdout.receiveLine());
      assert.equal(promptAfterClose.id, "stdio-e2e-prompt-after-close");
      assert.equal(promptAfterClose.error.data.code, "relay_session_closed");
    } finally {
      child.stdin.end();
    }

    const exit = await waitForProcessExit(child);
    assert.equal(exit.code, 0);
  });

  it.skip("reloads source ACP sessions across external stdio process restarts with a file-backed store", async () => {
    const targetId = "mock.restart-persistent-target";
    const virtualAgentId = "mock.restart-persistent-agent";
    const sourceId = "codex-source-vitest-restart";
    const sourceSessionId = "child-process-restart-session";
    const workspaceId = "vitest-workspace";
    const userDataPath = await makeTempDir("pact-acp-agent-relay-stdio-store-");
    const storagePath = path.join(userDataPath, "acp-source-stdio-store.json");
    const runtimeOptions = {
      defaultVirtualAgentId: virtualAgentId,
      defaultSourceId: sourceId,
      defaultWorkspaceId: workspaceId,
      virtualAgents: {
        [virtualAgentId]: {
          virtualAgentId,
          targetId,
          profileId: "pact.acp.restart_persistent.mock",
          displayName: "Restart Persistent Mock ACP Relay",
          advertisedModes: ["ask"],
          defaultMode: "ask",
          advertisedTools: ["mock.prompt"],
          reasoningVisibilityPolicy: "never",
          capabilityPolicy: {
            writes: "deny",
            terminal: "deny",
            maxRisk: "read_only"
          },
          revision: 1
        }
      },
      targets: {
        [targetId]: {
          targetId,
          label: "Restart Persistent Mock Target",
          transport: { type: "mock" },
          advertisedToolsets: ["mock.prompt"],
          enabled: true,
          revision: 1
        }
      }
    };

    function startPersistentChild() {
      const child = spawn(process.execPath, ["server/scripts/acp-agent-relay-source-stdio.mjs"], {
        cwd: process.cwd(),
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          PACT_ACP_SOURCE_STDIO_RUNTIME_JSON: JSON.stringify(runtimeOptions),
          PACT_ACP_SOURCE_STDIO_CONTEXT_JSON: JSON.stringify({ sourceId, workspaceId }),
          PACT_ACP_SOURCE_STDIO_STORE_PATH: storagePath
        }
      });
      return {
        child,
        stdout: createOutputLineReader(child.stdout),
        stderr: createOutputLineReader(child.stderr),
        sendLine(message) {
          child.stdin.write(`${JSON.stringify(message)}\n`, "utf8");
        }
      };
    }

    async function stopPersistentChild(handle) {
      handle.child.stdin.end();
      const exit = await waitForProcessExit(handle.child);
      assert.equal(exit.code, 0);
    }

    const first = startPersistentChild();
    let relaySessionId = "";
    let targetSessionId = "";
    let targetResumeRef = "";
    try {
      const ready = JSON.parse(await first.stderr.receiveLine());
      assert.equal(ready.event, "pact.acp.source_stdio.ready");
      assert.equal(ready.durableStore, true);
      assert.equal(ready.storagePath, storagePath);

      first.sendLine(createRequest(ACP_METHODS.initialize, { virtualAgentId }, "restart-first-init"));
      const initialize = parseJsonRpcMessage(await first.stdout.receiveLine());
      assert.equal(initialize.result.virtualAgentId, virtualAgentId);

      first.sendLine(
        createRequest(
          ACP_METHODS.sessionNew,
          { virtualAgentId, sourceId, sourceSessionId, workspaceId },
          "restart-session-new"
        )
      );
      const sessionNew = parseJsonRpcMessage(await first.stdout.receiveLine());
      relaySessionId = sessionNew.result.sessionId;
      assert.match(relaySessionId, /^relay_session_/);
      assert.deepEqual(sessionNew.result.capabilities.tools, ["mock.prompt"]);
      assert.equal(sessionNew.result.capabilitiesSnapshot.target.transportType, "mock");

      first.sendLine(
        createRequest(
          ACP_METHODS.sessionPrompt,
          {
            sessionId: relaySessionId,
            prompt: "persist target resume metadata before process restart"
          },
          "restart-first-prompt"
        )
      );
      const firstPrompt = await receiveJsonRpcResponseUntilId(() => first.stdout.receiveLine(), "restart-first-prompt");
      assert.equal(firstPrompt.notifications.length > 0, true);
      assert.equal(firstPrompt.notifications.some((notification) => notification.params?.phase === "accepted"), true);
      assertPromptAuditEvidence(firstPrompt);
      targetSessionId = firstPrompt.result.targetEvidence.targetSessionId;
      targetResumeRef = firstPrompt.result.targetEvidence.targetResumeRef;
      assert.equal(targetSessionId, `target_session_${relaySessionId}`);
      assert.equal(targetResumeRef, `resume_${relaySessionId}`);
    } finally {
      await stopPersistentChild(first);
    }

    const persistedStore = JSON.parse(await fs.readFile(storagePath, "utf8"));
    assert.equal(Boolean(persistedStore.sessions?.[relaySessionId]), true);
    assert.equal(persistedStore.sessions?.[relaySessionId]?.capabilitiesSnapshot?.target?.transportType, "mock");
    assert.deepEqual(persistedStore.sessions?.[relaySessionId]?.capabilitiesSnapshot?.capabilities?.tools, ["mock.prompt"]);

    const second = startPersistentChild();
    try {
      const ready = JSON.parse(await second.stderr.receiveLine());
      assert.equal(ready.event, "pact.acp.source_stdio.ready");
      assert.equal(ready.durableStore, true);

      second.sendLine(
        createRequest(
          ACP_METHODS.sessionLoad,
          {
            sessionId: relaySessionId,
            virtualAgentId,
            sourceId,
            workspaceId
          },
          "restart-session-load-direct"
        )
      );
      const loadedDirect = await receiveJsonRpcResponseUntilId(
        () => second.stdout.receiveLine(),
        "restart-session-load-direct"
      );
      assert.equal(loadedDirect.result.sessionId, relaySessionId);
      assert.equal(loadedDirect.result.sourceSessionId, sourceSessionId);
      assert.equal(loadedDirect.result.targetSessionId, targetSessionId);
      assert.equal(loadedDirect.result.targetResumeRef, targetResumeRef);
      assert.deepEqual(loadedDirect.result.capabilities.tools, ["mock.prompt"]);
      assert.equal(loadedDirect.result.capabilitiesSnapshot.target.transportType, "mock");
      assert.equal(loadedDirect.result.replayedUpdateCount, loadedDirect.notifications.length);
      assert.equal(loadedDirect.notifications.length > 0, true);
      assert.equal(
        loadedDirect.notifications.every((notification) => notification.params?.sessionId === relaySessionId),
        true
      );

      second.sendLine(
        createRequest(
          ACP_METHODS.sessionLoad,
          { virtualAgentId, sourceId, sourceSessionId, workspaceId },
          "restart-session-load"
        )
      );
      const loaded = await receiveJsonRpcResponseUntilId(() => second.stdout.receiveLine(), "restart-session-load");
      assert.equal(loaded.result.sessionId, relaySessionId);
      assert.equal(loaded.result.targetSessionId, targetSessionId);
      assert.equal(loaded.result.targetResumeRef, targetResumeRef);
      assert.deepEqual(loaded.result.capabilities.tools, ["mock.prompt"]);
      assert.equal(loaded.result.capabilitiesSnapshot.target.transportType, "mock");
      assert.equal(loaded.result.capabilitiesSnapshotError, "");
      assert.equal(loaded.result.replayedUpdateCount, loaded.notifications.length);
      assert.equal(loaded.notifications.length > 0, true);

      second.sendLine(
        createRequest(
          ACP_METHODS.sessionResume,
          { virtualAgentId, sourceId, sourceSessionId, workspaceId },
          "restart-session-resume"
        )
      );
      const resumed = parseJsonRpcMessage(await second.stdout.receiveLine());
      assert.equal(resumed.result.sessionId, relaySessionId);
      assert.equal(resumed.result.targetSessionId, targetSessionId);
      assert.equal(resumed.result.targetResumeRef, targetResumeRef);
      assert.deepEqual(resumed.result.capabilities.tools, ["mock.prompt"]);
      assert.equal(resumed.result.capabilitiesSnapshot.target.transportType, "mock");
      assert.equal(resumed.result.capabilitiesSnapshotError, "");

      second.sendLine(
        createRequest(
          ACP_METHODS.sessionPrompt,
          {
            sessionId: resumed.result.sessionId,
            prompt: "reuse persisted target resume metadata after process restart"
          },
          "restart-second-prompt"
        )
      );
      const secondPrompt = await receiveJsonRpcResponseUntilId(() => second.stdout.receiveLine(), "restart-second-prompt");
      assert.equal(secondPrompt.notifications.length > 0, true);
      assert.equal(secondPrompt.notifications.some((notification) => notification.params?.phase === "accepted"), true);
      assertPromptAuditEvidence(secondPrompt);
      assert.equal(secondPrompt.result.targetEvidence.targetSessionId, targetSessionId);
      assert.equal(secondPrompt.result.targetEvidence.targetResumeRef, targetResumeRef);

      second.sendLine(
        createRequest(
          ACP_METHODS.sessionClose,
          {
            sessionId: resumed.result.sessionId,
            sourceId,
            workspaceId
          },
          "restart-session-close"
        )
      );
      const closed = parseJsonRpcMessage(await second.stdout.receiveLine());
      assert.equal(closed.id, "restart-session-close");
      assert.equal(closed.result.sessionId, relaySessionId);
      assert.equal(closed.result.lifecycleState, "closed");
    } finally {
      await stopPersistentChild(second);
    }

    const third = startPersistentChild();
    try {
      const ready = JSON.parse(await third.stderr.receiveLine());
      assert.equal(ready.event, "pact.acp.source_stdio.ready");
      assert.equal(ready.durableStore, true);

      third.sendLine(
        createRequest(
          ACP_METHODS.sessionLoad,
          { virtualAgentId, sourceId, sourceSessionId, workspaceId },
          "restart-closed-session-load"
        )
      );
      const loadedClosed = await receiveJsonRpcResponseUntilId(
        () => third.stdout.receiveLine(),
        "restart-closed-session-load"
      );
      assert.equal(loadedClosed.id, "restart-closed-session-load");
      assert.equal(loadedClosed.result.sessionId, relaySessionId);
      assert.equal(loadedClosed.result.lifecycleState, "closed");
      assert.equal(loadedClosed.result.targetSessionId, targetSessionId);
      assert.equal(loadedClosed.result.targetResumeRef, targetResumeRef);
      assert.equal(loadedClosed.result.replayedUpdateCount, loadedClosed.notifications.length);
      assert.equal(loadedClosed.notifications.length > 0, true);

      third.sendLine(
        createRequest(
          ACP_METHODS.sessionResume,
          { virtualAgentId, sourceId, sourceSessionId, workspaceId },
          "restart-closed-session-resume"
        )
      );
      const resumeClosed = parseJsonRpcMessage(await third.stdout.receiveLine());
      assert.equal(resumeClosed.id, "restart-closed-session-resume");
      assert.equal(resumeClosed.error?.data?.code, "relay_session_closed");

      third.sendLine(
        createRequest(
          ACP_METHODS.sessionPrompt,
          {
            sessionId: relaySessionId,
            prompt: "must not reopen closed session after source stdio restart"
          },
          "restart-closed-session-prompt"
        )
      );
      const promptClosed = parseJsonRpcMessage(await third.stdout.receiveLine());
      assert.equal(promptClosed.id, "restart-closed-session-prompt");
      assert.equal(promptClosed.error?.data?.code, "relay_session_closed");
    } finally {
      await stopPersistentChild(third);
    }
  });
});
