#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ACP_METHODS,
  createRequest,
  parseJsonRpcMessage
} from "../platform/common/protocols/acp/index.mjs";

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const sourceResponseTimeoutMs = Number(process.env.PACT_ACP_RELAY_SOURCE_RESPONSE_TIMEOUT_MS || 120000);
const targetTimeoutMs = Number(process.env.PACT_ACP_RELAY_DOWNSTREAM_OPENCODE_ACP_TARGET_TIMEOUT_MS || 120000);

function createOutputLineReader(stream, label = "stream") {
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
    async receiveLine(waitMs = sourceResponseTimeoutMs) {
      if (queue.length > 0) {
        return queue.shift();
      }
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error(`Timed out waiting for ${label} line after ${waitMs}ms.`));
        }, waitMs);
        waiters.push((line) => {
          clearTimeout(timeout);
          resolve(line);
        });
      });
    }
  };
}

function spawnSourceServer({ runtimeOptions, storePath, sourceId, workspaceId }) {
  const sourceStdioScriptPath = path.join(repoRoot, "server/scripts/acp-agent-relay-source-stdio.mjs");
  const child = spawn(process.execPath, [sourceStdioScriptPath], {
    cwd: repoRoot,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      PACT_ACP_SOURCE_STDIO_RUNTIME_JSON: JSON.stringify(runtimeOptions),
      PACT_ACP_SOURCE_STDIO_CONTEXT_JSON: JSON.stringify({
        sourceId,
        workspaceId
      }),
      PACT_ACP_SOURCE_STDIO_STORE_PATH: storePath,
      PACT_ACP_SOURCE_ID: sourceId,
      PACT_ACP_WORKSPACE_ID: workspaceId
    }
  });
  const stdout = createOutputLineReader(child.stdout, "source ACP stdout");
  const stderr = createOutputLineReader(child.stderr, "source ACP stderr");
  return {
    child,
    stdout,
    stderr,
    async waitUntilReady() {
      const ready = JSON.parse(await stderr.receiveLine(30000));
      assert.equal(ready.event, "pact.acp.source_stdio.ready");
      assert.equal(ready.durableStore, true);
      assert.equal(ready.storagePath, storePath);
      return ready;
    },
    async request(message) {
      child.stdin.write(`${JSON.stringify(message)}\n`, "utf8");
      const notifications = [];
      for (let index = 0; index < 120; index += 1) {
        const rawResponse = await stdout.receiveLine();
        assert.ok(rawResponse, "source ACP service must return a JSON-RPC frame.");
        const parsed = parseJsonRpcMessage(rawResponse);
        if (parsed.method === ACP_METHODS.sessionUpdate) {
          notifications.push(parsed);
          continue;
        }
        assert.equal(parsed.id, message.id);
        Object.defineProperty(parsed, "notifications", {
          value: notifications,
          enumerable: false
        });
        return parsed;
      }
      throw new Error(`Timed out waiting for source ACP response ${String(message.id)}.`);
    }
  };
}

async function stopSourceServer(handle) {
  if (!handle) {
    return;
  }
  handle.child.stdin.end();
  if (handle.child.exitCode !== null || handle.child.signalCode) {
    return;
  }
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      handle.child.kill("SIGTERM");
      resolve();
    }, 5000);
    handle.child.once("exit", (code) => {
      clearTimeout(timer);
      if (code === 0 || code === null) {
        resolve();
      } else {
        reject(new Error(`source ACP stdio server exited with code ${code}`));
      }
    });
  });
}

async function readJsonlEvents(filePath) {
  return (await fs.readFile(filePath, "utf8").catch(() => ""))
    .trim()
    .split(/\n+/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function promptText(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => promptText(entry)).filter(Boolean).join("\n");
  }
  if (value && typeof value === "object") {
    return String(value.text || value.content || value.message || "");
  }
  return String(value || "");
}

async function writeStubOpenCodeTargetScript(scriptPath) {
  await fs.writeFile(
    scriptPath,
    `
import fs from "node:fs";
import readline from "node:readline";

const argv = process.argv.slice(2);
const logPath = process.env.PACT_STUB_OPENCODE_LOG_PATH || "";
const marker = process.env.PACT_STUB_OPENCODE_MARKER || "PACT_OPENCODE_ACP";
const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
let targetSessionId = "";
let targetResumeRef = "";

function log(event) {
  if (!logPath) return;
  fs.appendFileSync(logPath, JSON.stringify({ ...event, pid: process.pid, at: new Date().toISOString() }) + "\\n", "utf8");
}

function send(payload) {
  process.stdout.write(JSON.stringify(payload) + "\\n");
}

function textFromPrompt(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => textFromPrompt(entry)).filter(Boolean).join("\\n");
  }
  if (value && typeof value === "object") {
    return String(value.text || value.content || value.message || "");
  }
  return String(value || "");
}

log({ event: "stub_opencode_started", argv });
if (argv.length !== 1 || argv[0] !== "acp") {
  log({ event: "stub_opencode_bad_argv", argv });
  process.exitCode = 64;
  process.exit();
}

for await (const line of lines) {
  const message = JSON.parse(line);
  log({
    event: "stub_opencode_message",
    method: message.method || "",
    id: message.id || "",
    paramsKeys: Object.keys(message.params || {})
  });
  if (message.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: 1,
        agentInfo: {
          name: "stub-opencode-acp",
          version: "verify"
        },
        capabilities: {
          session: ["new", "resume", "close"],
          updates: ["progress"]
        }
      }
    });
  } else if (message.method === "session/new" || message.method === "session/resume") {
    targetSessionId = message.params?.sessionId || \`stub-opencode-session-\${process.pid}\`;
    targetResumeRef = \`stub-opencode-resume-\${process.pid}\`;
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        sessionId: targetSessionId,
        targetSessionId,
        targetResumeRef
      }
    });
  } else if (message.method === "session/prompt") {
    const text = textFromPrompt(message.params?.prompt || message.params?.content || message.params?.text);
    log({
      event: "stub_opencode_prompt",
      sessionId: message.params?.sessionId || "",
      markerIncluded: text.includes(marker),
      promptPreview: text.slice(0, 160)
    });
    send({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        type: "progress",
        phase: "working",
        text: \`OpenCode ACP target received \${marker}\`
      }
    });
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        stopReason: "completed",
        output: \`\${marker} received by OpenCode ACP target\`,
        targetSessionId,
        targetResumeRef,
        finalResponseAvailable: true,
        externalCompletionState: "completed",
        finalResponsePolicy: "target_acp_completion"
      }
    });
  } else if (message.method === "session/close") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        closed: true,
        sessionId: message.params?.sessionId || targetSessionId
      }
    });
    process.exit(0);
  } else {
    send({
      jsonrpc: "2.0",
      id: message.id,
      error: { code: -32601, message: "unsupported stub OpenCode ACP method" }
    });
  }
}
`,
    "utf8"
  );
}

async function writeStubOpenCodeCommand(commandPath) {
  await fs.writeFile(
    commandPath,
    `#!/bin/sh
exec "$PACT_STUB_OPENCODE_NODE" "$PACT_STUB_OPENCODE_TARGET_SCRIPT" "$@"
`,
    "utf8"
  );
  await fs.chmod(commandPath, 0o755);
}

const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pact-acp-downstream-opencode-workspace-"));
const stubBin = path.join(workspaceRoot, "bin");
const stubOpenCodePath = path.join(stubBin, "opencode");
const stubOpenCodeTargetScriptPath = path.join(workspaceRoot, "stub-opencode-acp-target.mjs");
const stubOpenCodeLogPath = path.join(workspaceRoot, "stub-opencode-events.jsonl");
const storePath = path.join(workspaceRoot, "source-stdio-store.json");
const marker = `PACT_DOWNSTREAM_OPENCODE_ACP_TARGET_VERIFY_${Date.now()}`;
const virtualAgentId = "opencode.acp-agent";
const targetId = "opencode.acp:default";
const sourceId = "downstream-opencode-acp-target-verifier";
const sourceSessionId = `downstream-opencode-acp-target-${marker}`;
const workspaceId = "downstream-opencode-acp-target-workspace";

await fs.mkdir(stubBin, { recursive: true });
await writeStubOpenCodeTargetScript(stubOpenCodeTargetScriptPath);
await writeStubOpenCodeCommand(stubOpenCodePath);

const runtimeOptions = {
  workspaceRoot,
  startDownstreamClientAspect: true,
  downstreamClientEnv: {
    ...process.env,
    PATH: `${stubBin}${path.delimiter}${process.env.PATH || ""}`
  },
  downstreamClientFrameworkOverrides: [
    {
      frameworkId: "opencode",
      acp: {
        command: {
          cwd: workspaceRoot,
          timeoutMs: targetTimeoutMs,
          env: {
            PACT_STUB_OPENCODE_NODE: process.execPath,
            PACT_STUB_OPENCODE_TARGET_SCRIPT: stubOpenCodeTargetScriptPath,
            PACT_STUB_OPENCODE_LOG_PATH: stubOpenCodeLogPath,
            PACT_STUB_OPENCODE_MARKER: marker
          }
        },
        target: {
          transport: {
            timeoutMs: targetTimeoutMs
          }
        }
      }
    }
  ]
};

let sourceServer;
try {
  sourceServer = spawnSourceServer({
    runtimeOptions,
    storePath,
    sourceId,
    workspaceId
  });
  const ready = await sourceServer.waitUntilReady();

  const initialize = await sourceServer.request(createRequest(
    ACP_METHODS.initialize,
    { virtualAgentId, sourceId, workspaceId },
    "downstream-opencode-acp-init"
  ));
  assert.equal(initialize.result?.pactProtocolVersion, "v0.0.1:agent:acp-agent-relay-1");
  assert.equal(initialize.result?.virtualAgentId, virtualAgentId);
  assert.equal(initialize.result?.capabilitiesSnapshot?.target?.targetId, targetId);
  assert.equal(initialize.result?.capabilitiesSnapshot?.target?.transportType, "stdio");
  assert.equal(initialize.result?.capabilitiesSnapshot?.target?.protocolStyle, "agent-client-protocol-v1");
  assert.equal(initialize.result?.capabilitiesSnapshot?.target?.targetCommunicationMode, "native_acp_stdio");
  assert.equal(initialize.result?.capabilitiesSnapshot?.target?.nativeAcpTargetSupported, true);
  assert.equal(initialize.result?.capabilitiesSnapshot?.metadata?.fromAspect, "downstream-client-aspect");

  const agents = await sourceServer.request(createRequest(
    ACP_METHODS.pactAgentList,
    { sourceId, workspaceId },
    "downstream-opencode-acp-agent-list"
  ));
  const agentDescriptor = (agents.result?.virtualAgents || agents.result?.agents || [])
    .find((item) => item.virtualAgentId === virtualAgentId);
  assert.ok(agentDescriptor, "source-facing agent/list must expose OpenCode ACP virtual agent.");
  assert.equal(agentDescriptor.targetId, targetId);
  assert.equal(agentDescriptor.metadata?.frameworkId, "opencode");
  assert.equal(agentDescriptor.metadata?.adapterId, "opencode-acp-stdio");
  assert.equal(agentDescriptor.capabilities?.tools?.includes("opencode.acp"), true);

  const targetsBeforePrompt = await sourceServer.request(createRequest(
    ACP_METHODS.pactTargetList,
    { sourceId, workspaceId, virtualAgentId },
    "downstream-opencode-acp-target-list"
  ));
  const targetDescriptor = (targetsBeforePrompt.result?.targets || []).find((item) => item.targetId === targetId);
  assert.ok(targetDescriptor, "source-facing target/list must expose OpenCode ACP target.");
  assert.equal(targetDescriptor.metadata?.fromAspect, "downstream-client-aspect");
  assert.equal(targetDescriptor.metadata?.frameworkId, "opencode");
  assert.equal(targetDescriptor.metadata?.adapterId, "opencode-acp-stdio");
  assert.equal(targetDescriptor.metadata?.nativeOpenCodeAcp, true);
  assert.equal(targetDescriptor.metadata?.launchCommand, "opencode acp");
  assert.equal(targetDescriptor.transportType, "stdio");
  assert.equal(targetDescriptor.protocolStyle, "agent-client-protocol-v1");
  assert.equal(targetDescriptor.targetCommunicationMode, "native_acp_stdio");
  assert.equal(targetDescriptor.nativeAcpTargetSupported, true);
  assert.equal(Boolean(targetDescriptor.transport?.command), false, "source-facing target/list must not leak OpenCode launch env.");

  const session = await sourceServer.request(createRequest(
    ACP_METHODS.sessionNew,
    {
      virtualAgentId,
      sourceId,
      sourceSessionId,
      workspaceId
    },
    "downstream-opencode-acp-session-new"
  ));
  assert.match(session.result?.sessionId || "", /^relay_session_/);
  assert.equal(session.result?.capabilitiesSnapshot?.target?.targetId, targetId);

  const prompt = await sourceServer.request(createRequest(
    ACP_METHODS.sessionPrompt,
    {
      sessionId: session.result.sessionId,
      prompt: `${marker}\nYou are the OpenCode ACP target discovered by Pact downstream-client-aspect startup assembly.`,
      requestedMode: "ask",
      requestReasoning: false
    },
    "downstream-opencode-acp-prompt"
  ));
  assert.equal(prompt.result?.targetEvidence?.targetId, targetId);
  assert.equal(prompt.result?.targetEvidence?.externalServiceId, "external.agent-framework.opencode.acp");
  assert.equal(prompt.result?.targetEvidence?.transportType, "stdio");
  assert.equal(prompt.result?.targetEvidence?.targetCommunicationMode, "native_acp_stdio");
  assert.equal(prompt.result?.targetEvidence?.nativeAcpTargetSupported, true);
  assert.equal(
    prompt.result?.targetEvidence?.finalResponseAvailable,
    true,
    `OpenCode ACP final response must be projected: ${JSON.stringify(prompt.result, null, 2)}`
  );
  assert.equal(prompt.result?.targetEvidence?.externalCompletionState, "completed");
  assert.equal(prompt.result?.responseKind, "final_response");
  assert.equal(prompt.result?.communicationSummary?.summaryKind, "final_response");
  assert.equal(prompt.result?.communicationSummary?.reasoningIncluded, false);
  assert.match(prompt.result?.output || prompt.result?.communicationSummary?.outputSummary || "", new RegExp(marker));
  const completionNotification = prompt.notifications.find((notification) => notification.params?.type === "completion");
  assert.ok(completionNotification);
  assert.equal(completionNotification.params?.responseKind, "final_response");

  const close = await sourceServer.request(createRequest(
    ACP_METHODS.sessionClose,
    {
      sessionId: session.result.sessionId,
      sourceId,
      workspaceId
    },
    "downstream-opencode-acp-close"
  ));
  assert.equal(close.result?.lifecycleState, "closed");

  const stubOpenCodeEvents = await readJsonlEvents(stubOpenCodeLogPath);
  const startEvent = stubOpenCodeEvents.find((event) => event.event === "stub_opencode_started");
  const promptEvent = stubOpenCodeEvents.find((event) => event.event === "stub_opencode_prompt");
  assert.deepEqual(startEvent?.argv, ["acp"], "Pact must launch OpenCode ACP as `opencode acp`.");
  assert.equal(promptEvent?.markerIncluded, true, "OpenCode ACP target must receive the delegated prompt text.");

  console.log(JSON.stringify({
    ok: true,
    verifier: "acp-agent-relay-downstream-opencode-acp-target",
    marker,
    sourceAcpProtocolVerified: true,
    sourceAcpTransport: "pact-source-facing-acp-stdio",
    sourceAcpReady: ready.event,
    downstreamClientAspectStarted: true,
    downstreamClientAspectAssemblyUsed: true,
    relaySessionId: session.result.sessionId,
    relayTurnId: prompt.result.turnId,
    virtualAgentId,
    targetId,
    transportType: "stdio",
    protocolStyle: "agent-client-protocol-v1",
    targetCommunicationMode: "native_acp_stdio",
    nativeAcpTargetSupported: true,
    nativeOpenCodeAcp: true,
    launchCommandVerified: "opencode acp",
    sourceFacingCommandRedacted: Boolean(targetDescriptor && !targetDescriptor.transport?.command),
    responseKind: prompt.result.responseKind,
    summaryKind: prompt.result.communicationSummary.summaryKind,
    finalResponseAvailable: prompt.result.targetEvidence.finalResponseAvailable === true,
    externalServiceId: prompt.result.targetEvidence.externalServiceId,
    agentDiscoveryProof: {
      agentListed: Boolean(agentDescriptor),
      targetId: agentDescriptor?.targetId || "",
      frameworkId: agentDescriptor?.metadata?.frameworkId || "",
      adapterId: agentDescriptor?.metadata?.adapterId || "",
      toolListed: agentDescriptor?.capabilities?.tools?.includes("opencode.acp") === true
    },
    targetDiscoveryProof: {
      targetListed: Boolean(targetDescriptor),
      frameworkId: targetDescriptor?.metadata?.frameworkId || "",
      adapterId: targetDescriptor?.metadata?.adapterId || "",
      nativeOpenCodeAcp: targetDescriptor?.metadata?.nativeOpenCodeAcp === true,
      launchCommand: targetDescriptor?.metadata?.launchCommand || "",
      commandRedacted: Boolean(targetDescriptor && !targetDescriptor.transport?.command)
    },
    proof: "pact-downstream-client-aspect-to-opencode-native-acp-stdio-target"
  }, null, 2));
} finally {
  await stopSourceServer(sourceServer);
  await fs.rm(workspaceRoot, { recursive: true, force: true });
}
