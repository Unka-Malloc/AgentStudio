import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startHttpServer } from "../services/server-runtime/http-server.mjs";
import {
  CONTEXT_COMPACTION_PROTOCOL_VERSION,
  buildMessageGraph,
  chooseCompactionCutPoint,
  computeCompactionBudget,
  createContextCompactionStrategyAdapter,
  createContextCompactionRuntime,
  createContextRuntime,
  listContextCompactionStrategies,
  normalizeCompactionPolicy
} from "../platform/specialized/agent/agent-context/interface/index.mjs";
import { installAuthenticatedFetch } from "./test-auth-helper.mjs";

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const rawText = await response.text();
  return {
    status: response.status,
    payload: rawText.trim() ? JSON.parse(rawText) : {}
  };
}

function runCli(serverUrl, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        new URL("./pact.mjs", import.meta.url).pathname,
        ...args,
        "--server-url",
        serverUrl
      ],
      {
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"]
      }
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr || stdout || `pact CLI exited with ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout || "{}"));
      } catch (error) {
        reject(new Error(`CLI JSON parse failed: ${error.message}\n${stdout}\n${stderr}`));
      }
    });
  });
}

function longText(label, repeat = 120) {
  return Array.from({ length: repeat }, (_, index) =>
    `${label} ${index}: 必须保留 evidence:ev-critical，风险 risk-blocked，日期 2026-05-02，金额 $1,200。`
  ).join("\n");
}

function sampleMessages() {
  return [
    {
      id: "m1",
      role: "user",
      apiRoundId: "round-1",
      content: `${longText("任务背景", 80)}\ntoken=redaction-test-value-12345\n路径 /Users/unka/private/secret.json 必须脱敏。`
    },
    {
      id: "m2",
      role: "assistant",
      apiRoundId: "round-1",
      content: "Decision: use ContextCompactionRuntime and never split tool pairs."
    },
    {
      id: "m3",
      role: "user",
      apiRoundId: "round-2",
      content: [
        { type: "text", text: "TODO: add session memory, boundary resume, audit redaction, and knowledge reference vocab:v7." },
        {
          type: "image",
          name: "whiteboard.png",
          dataBase64: "RAW_IMAGE_PAYLOAD_SHOULD_NOT_REACH_MODEL".repeat(20),
          summary: "Architecture whiteboard showing the compaction boundary."
        }
      ]
    },
    {
      id: "m4",
      role: "assistant",
      apiRoundId: "round-2",
      content: longText("旧工具结果前置摘要", 35),
      blocks: [{ type: "tool_result", tool_use_id: "old-tool", content: longText("旧工具结果", 80) }],
      toolUseId: "old-tool",
      type: "tool_result"
    },
    {
      id: "m5",
      role: "assistant",
      apiRoundId: "round-tool",
      content: "Calling maintenance tool.",
      blocks: [{ type: "tool_use", id: "tool-1", name: "knowledge.health", input: { scope: "mail" } }]
    },
    {
      id: "m6",
      role: "tool",
      apiRoundId: "round-tool",
      toolUseId: "tool-1",
      content: `${longText("tool result body", 120)}\nartifactRef=artifact-large-1`,
      attachments: [
        {
          name: "large-result.json",
          path: "/Users/unka/private/large-result.json",
          text: longText("attachment", 120)
        }
      ]
    },
    {
      id: "m7",
      role: "assistant",
      apiRoundId: "round-3",
      content: "Recent failure must stay visible: error current import failed."
    },
    {
      id: "m8",
      role: "user",
      apiRoundId: "round-4",
      content: "最新用户意图：继续实现完整上下文压缩。"
    }
  ];
}

const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-context-compaction-"));

try {
  const profile = {
    profileId: "compaction-small",
    contextWindowTokens: 4096,
    outputReserveTokens: 256,
    compression: {
      enabled: true,
      mode: "model-assisted",
      targetRatio: 0.2,
      summaryMaxTokens: 700
    },
    modelCompression: {
      enabled: true,
      alias: "mock",
      maxOutputTokens: 400
    },
    compactionPolicy: {
      summaryReserveTokens: 512,
      reservedBufferTokens: 512,
      warningBufferTokens: 900,
      recentMessageProtectionCount: 3,
      recentTurnProtectionCount: 2,
      deterministicTargetRatio: 0.24,
      ptlRetryLimit: 3,
      modelMaxInputTokens: 50000,
      modelMaxOutputTokens: 420,
      maxToolResultTokens: 160,
      maxAttachmentTokens: 120,
      reinjectionBudgetTokens: 360
    }
  };
  const messages = sampleMessages();
  const graph = buildMessageGraph(messages);
  assert.equal(graph.toolGroups.some((group) => group.id === "tool-1"), true);
  const budget = computeCompactionBudget(profile);
  assert.equal(budget.effectiveWindowTokens, 3328);
  assert.equal(budget.autoCompactThresholdTokens, 2816);
  const cutPoint = chooseCompactionCutPoint(messages, { profile });
  assert.equal(cutPoint.proposedCutIndex, 5);
  assert.equal(cutPoint.cutIndex, 4);
  assert.equal(cutPoint.adjustments.some((item) => item.reason === "tool_chain_protection"), true);
  const availableStrategies = listContextCompactionStrategies();
  assert.ok(availableStrategies.some((strategy) => strategy.id === "deterministic-extractive"));
  assert.ok(availableStrategies.some((strategy) => strategy.id === "model-assisted"));
  assert.ok(availableStrategies.some((strategy) => strategy.id === "session-memory-first"));
  assert.ok(availableStrategies.some((strategy) => strategy.id === "workbench-reconstruction"));
  const assistedPolicy = normalizeCompactionPolicy({
    compactionPolicy: {
      strategy: "model-assisted"
    }
  });
  assert.equal(assistedPolicy.strategy.id, "model-assisted");
  const workbenchPolicy = normalizeCompactionPolicy({
    compactionPolicy: {
      strategy: "workbench-reconstruction"
    }
  });
  assert.equal(workbenchPolicy.strategy.id, "workbench-reconstruction");
  const explicitPolicy = normalizeCompactionPolicy({
    compactionPolicy: {
      strategy: {
        id: "deterministic-extractive",
        params: {
          preserveFacts: true
        }
      }
    }
  });
  assert.equal(explicitPolicy.strategy.id, "deterministic-extractive");
  assert.equal(explicitPolicy.strategy.params.preserveFacts, true);

  const directRuntime = createContextCompactionRuntime({ userDataPath });
  assert.ok(directRuntime.listStrategies().strategies.some((strategy) => strategy.id === "session-memory-first"));
  const deterministic = await directRuntime.run({
    profile: {
      ...profile,
      modelCompression: { enabled: false },
      compactionPolicy: {
        ...profile.compactionPolicy,
        strategy: {
          id: "deterministic-extractive",
          params: {
            preserveFacts: true
          }
        }
      }
    },
    sessionId: "deterministic",
    messages,
    taskBrief: "实现完整上下文压缩",
    requiredAnchors: ["evidence:ev-critical", "risk-blocked"],
    compactionQuality: {
      minimumRetentionRatio: 1
    },
    runtimeState: {
      activePlan: ["M0", "M1", "M2"],
      enabledTools: ["context.compaction.run"],
      currentFiles: ["/workspace/Pact/server/platform/specialized/agent/agent-context/interface/index.mjs"],
      knowledgeReference: "expert-vocabulary@v7",
      userConstraints: ["Do not copy Claude Code source"]
    }
  });
  assert.equal(deterministic.protocolVersion, CONTEXT_COMPACTION_PROTOCOL_VERSION);
  assert.equal(deterministic.strategy.id, "deterministic-extractive");
  assert.deepEqual(deterministic.strategy.paramKeys, ["preserveFacts"]);
  assert.equal(deterministic.executionMode, "deterministic-extractive");
  assert.equal(deterministic.compacted, true);
  assert.equal(deterministic.boundary.type, "compact_boundary");
  assert.ok(deterministic.tokenReport.savingsRatio > 0);
  assert.equal(/redaction-test-value-12345/.test(deterministic.summary), false);
  assert.equal(/\/Users\/unka\/private/.test(deterministic.summary), false);
  assert.equal(deterministic.qualityReport.protocolVersion, "v0.0.1:agent:context-compaction-quality-1");
  assert.equal(deterministic.qualityReport.passed, true);
  assert.equal(deterministic.qualityReport.requiredAnchorCount, 2);
  assert.equal(deterministic.qualityReport.missingAnchorCount, 0);
  assert.equal(deterministic.boundary.qualityReport.retentionRatio, 1);
  assert.ok(deterministic.reinjection.items.some((item) => item.key === "taskBrief"));
  assert.ok(deterministic.microCompaction.changedCount > 0);
  assert.ok(deterministic.attachmentsToReinject.length > 0);

  const qualityFailure = await directRuntime.run({
    profile: {
      ...profile,
      modelCompression: { enabled: false },
      compactionPolicy: {
        ...profile.compactionPolicy,
        strategy: {
          id: "deterministic-extractive",
          params: {
            preserveFacts: true
          }
        }
      }
    },
    persist: false,
    sessionId: "quality-failure",
    messages,
    taskBrief: "验证必需锚点缺失会被质量报告标记",
    requiredAnchors: ["anchor-that-should-not-survive"],
    compactionQuality: {
      minimumRetentionRatio: 1
    }
  });
  assert.equal(qualityFailure.qualityReport.passed, false);
  assert.equal(qualityFailure.qualityReport.missingAnchorCount, 1);
  assert.ok(qualityFailure.degradedReasons.includes("required_anchor_loss"));

  const workbenchPrompts = [];
  const workbenchRuntime = createContextCompactionRuntime({
    userDataPath: path.join(userDataPath, "workbench-runtime"),
    modelCompressor: async ({ messages: attemptMessages, prompt }) => {
      workbenchPrompts.push({ messages: attemptMessages, prompt });
      assert.equal(/RAW_IMAGE_PAYLOAD_SHOULD_NOT_REACH_MODEL/.test(prompt), false);
      if (attemptMessages.some((message) => message.apiRoundId === "round-1")) {
        throw new Error("prompt_too_large");
      }
      return {
        summary: JSON.stringify({
          summary: "Workbench reconstruction summary keeps evidence:ev-critical, active plan, open tool state, risk-blocked, and vocab:v7.",
          constraints: ["never split tool pairs"],
          decisions: ["use ContextCompactionRuntime"],
          risks: ["risk-blocked"],
          todos: ["add boundary resume"],
          evidenceRefs: ["evidence:ev-critical"],
          fileRefs: ["server/platform/specialized/agent/agent-context/interface/index.mjs"],
          knowledgeRefs: ["vocab:v7"]
        })
      };
    }
  });
  const workbenchRun = await workbenchRuntime.run({
    profile: {
      ...profile,
      compactionPolicy: {
        ...profile.compactionPolicy,
        strategy: {
          id: "workbench-reconstruction",
          params: {
            preserveWorkbenchState: true
          }
        },
        ptlHeadTrimRatio: 0.2,
        persistSessionMemory: false
      }
    },
    sessionId: "workbench",
    messages,
    taskBrief: "验证工作台重建式上下文压缩策略",
    runtimeState: {
      activePlan: ["M0", "M1", "M2"],
      activeSkill: "pact-context-compaction",
      activeToolUseIds: ["tool-1"],
      openToolCalls: [{ id: "tool-1", name: "knowledge.health" }],
      enabledTools: ["context.compaction.run", "context.session_memory.clear"],
      currentFiles: ["server/platform/specialized/agent/agent-context/context-compact/index.mjs"],
      fileAttachments: [{ name: "current-file-snapshot", summary: "context-compact strategy library" }],
      deferredToolDeltas: [{ op: "enable", tool: "context.compaction.run" }],
      knowledgeReference: "vocab:v7",
      mcpServers: ["knowledge"],
      worktreeState: { branch: "main", dirty: true }
    }
  });
  assert.equal(workbenchRun.strategy.id, "workbench-reconstruction");
  assert.deepEqual(workbenchRun.strategy.paramKeys, ["preserveWorkbenchState"]);
  assert.equal(workbenchRun.executionMode, "workbench-reconstruction");
  assert.equal(workbenchRun.compacted, true);
  assert.equal(workbenchRun.modelEvents[0].promptCacheCompatible, true);
  assert.equal(workbenchRun.modelEvents[0].attempts.length >= 2, true);
  assert.ok(workbenchRun.modelEvents[0].attempts.some((attempt) => attempt.droppedGroupCount >= 1));
  assert.ok(workbenchRun.preprocessingEvents[0].strippedBlockCount >= 1);
  assert.equal(/RAW_IMAGE_PAYLOAD_SHOULD_NOT_REACH_MODEL/.test(JSON.stringify(workbenchPrompts)), false);
  assert.match(workbenchRun.summary, /Workbench reconstruction summary/);
  assert.ok(workbenchRun.reinjection.items.some((item) => item.key === "activePlan"));
  assert.ok(workbenchRun.reinjection.items.some((item) => item.key === "openToolCalls"));
  assert.ok(workbenchRun.tokenReport.savingsRatio > 0);

  const resumed = directRuntime.resumeTranscript({
    messages: [
      { id: "old-1", role: "user", content: "old" },
      { id: "old-2", role: "assistant", content: "old" },
      deterministic.boundaryMessage,
      ...deterministic.messagesToKeep
    ]
  });
  assert.equal(resumed.resumed, true);
  assert.equal(resumed.skippedMessageCount, 2);
  assert.equal(resumed.messages[0].type, "compact_boundary");

  let customAdapterInput = null;
  const customAdapter = createContextCompactionStrategyAdapter({
    id: "verify-custom",
    label: "Verify custom adapter",
    inputAdapter: (context) => ({
      ids: context.compactedMessages.map((message) => message.id),
      limit: context.policy.strategy.params.limit,
      targetTokens: context.targetTokens
    }),
    run: async (strategyInput) => {
      customAdapterInput = strategyInput;
      return {
        executionMode: "custom_verify",
        summary: `CUSTOM:${strategyInput.ids.join(",")}:limit=${strategyInput.limit}`,
        structured: {
          ids: strategyInput.ids,
          limit: strategyInput.limit
        }
      };
    }
  });
  const customRuntime = createContextCompactionRuntime({
    userDataPath: path.join(userDataPath, "custom-runtime"),
    strategies: [customAdapter]
  });
  const customRun = await customRuntime.run({
    profile: {
      ...profile,
      modelCompression: { enabled: false },
      compactionPolicy: {
        ...profile.compactionPolicy,
        strategy: {
          id: "verify-custom",
          params: {
            limit: 7
          }
        },
        persistSessionMemory: false
      }
    },
    sessionId: "custom-adapter",
    messages,
    taskBrief: "验证自定义上下文压缩策略适配器"
  });
  assert.equal(customRun.strategy.id, "verify-custom");
  assert.equal(customRun.executionMode, "custom_verify");
  assert.deepEqual(customRun.strategy.paramKeys, ["limit"]);
  assert.equal(customAdapterInput.limit, 7);
  assert.match(customRun.summary, /CUSTOM:m1,m2,m3,m4/);

  const customContextRuntime = createContextRuntime({
    userDataPath: path.join(userDataPath, "custom-context-core"),
    compactionStrategies: [customAdapter]
  });
  await customContextRuntime.saveProfiles({
    profiles: [
      {
        ...profile,
        profileId: "custom-context-small",
        modelCompression: { enabled: false },
        compactionPolicy: {
          ...profile.compactionPolicy,
          strategy: {
            id: "verify-custom",
            params: {
              limit: 3
            }
          },
          persistSessionMemory: false
        }
      }
    ]
  });
  const customContextRun = await customContextRuntime.runCompaction({
    contextProfileId: "custom-context-small",
    sessionId: "custom-context-adapter",
    messages,
    taskBrief: "验证 ContextRuntime 归一化调用自定义压缩策略"
  });
  assert.equal(customContextRun.strategy.id, "verify-custom");
  assert.equal(customContextRun.executionMode, "custom_verify");
  assert.equal(customAdapterInput.limit, 3);

  const modelRuntime = createContextRuntime({
    userDataPath: path.join(userDataPath, "model-runtime"),
    modelCompressor: async ({ messages: attemptMessages }) => {
      if (attemptMessages.some((message) => message.apiRoundId === "round-1")) {
        throw new Error("prompt_too_large");
      }
      return {
        summary: JSON.stringify({
          summary: "Model summary keeps evidence:ev-critical, TODOs, risk-blocked, vocab:v7, and tool-1.",
          constraints: ["never split tool pairs"],
          decisions: ["use ContextCompactionRuntime"],
          risks: ["risk-blocked"],
          todos: ["add boundary resume"],
          evidenceRefs: ["evidence:ev-critical"],
          fileRefs: ["server/platform/specialized/agent/agent-context/interface/index.mjs"],
          knowledgeRefs: ["vocab:v7"]
        })
      };
    }
  });
  await modelRuntime.saveProfiles({ profiles: [profile] });
  const modelRun = await modelRuntime.runCompaction({
    contextProfileId: "compaction-small",
    sessionId: "model-session",
    messages,
    taskBrief: "模型辅助上下文压缩",
    useSessionMemory: false
  });
  assert.equal(modelRun.strategy.id, "session-memory-first");
  assert.equal(modelRun.executionMode, "model-assisted");
  assert.equal(modelRun.modelEvents[0].attempts.length >= 2, true);
  assert.match(modelRun.summary, /ev-critical/);

  const memoryRun = await modelRuntime.runCompaction({
    contextProfileId: "compaction-small",
    sessionId: "model-session",
    messages,
    taskBrief: "模型辅助上下文压缩"
  });
  assert.equal(memoryRun.strategy.id, "session-memory-first");
  assert.equal(memoryRun.executionMode, "session-memory");
  const memory = await modelRuntime.listSessionMemory({ sessionId: "model-session" });
  assert.ok(memory.records.length >= 1);
  const changedMemoryRun = await modelRuntime.runCompaction({
    contextProfileId: "compaction-small",
    sessionId: "model-session",
    messages: [
      ...messages,
      {
        id: "m9",
        role: "user",
        apiRoundId: "round-5",
        content: "New source state: session memory must not be reused for changed inputs."
      }
    ],
    taskBrief: "模型辅助上下文压缩 - changed input"
  });
  assert.notEqual(changedMemoryRun.executionMode, "session-memory");
  assert.ok(changedMemoryRun.memoryEvents.some((event) => event.reason === "source_hash_mismatch"));
  const cleared = await modelRuntime.clearSessionMemory({ sessionId: "model-session", reason: "verify" });
  assert.equal(cleared.ok, true);
  const afterClear = await modelRuntime.runCompaction({
    contextProfileId: "compaction-small",
    sessionId: "model-session",
    messages,
    taskBrief: "模型辅助上下文压缩",
    useSessionMemory: true
  });
  assert.notEqual(afterClear.executionMode, "session-memory");

  let failingCalls = 0;
  const fallbackRuntime = createContextRuntime({
    userDataPath: path.join(userDataPath, "fallback-runtime"),
    modelCompressor: async () => {
      failingCalls += 1;
      throw new Error("bad model schema");
    }
  });
  await fallbackRuntime.saveProfiles({
    profiles: [
      {
        ...profile,
        profileId: "fallback-small",
        compactionPolicy: {
          ...profile.compactionPolicy,
          strategy: "model-assisted",
          maxConsecutiveFailures: 3
        }
      }
    ]
  });
  for (let index = 0; index < 3; index += 1) {
    const run = await fallbackRuntime.runCompaction({
      contextProfileId: "fallback-small",
      sessionId: `fallback-${index}`,
      messages,
      useSessionMemory: false
    });
    assert.equal(run.executionMode, "deterministic-extractive");
    assert.equal(run.degraded, true);
  }
  const callsBeforeCircuit = failingCalls;
  const circuit = await fallbackRuntime.runCompaction({
    contextProfileId: "fallback-small",
    sessionId: "fallback-circuit",
    messages,
    useSessionMemory: false
  });
  assert.equal(circuit.executionMode, "deterministic-extractive");
  assert.equal(circuit.circuitBreaker.open, true);
  assert.equal(failingCalls, callsBeforeCircuit);

  const assembled = await modelRuntime.assemble({
    contextProfileId: "compaction-small",
    sessionId: "assemble-session",
    taskBrief: "验证 ContextRuntime assemble 集成",
    history: longText("assemble history", 120),
    recentTurns: messages.slice(4),
    toolState: {
      previousToolResults: [
        { tool: "knowledge.health", ok: true, count: 3 }
      ]
    },
    record: false
  });
  assert.equal(assembled.compaction.protocolVersion, CONTEXT_COMPACTION_PROTOCOL_VERSION);
  assert.ok(assembled.budgetReport.compaction);

  const serverDataPath = path.join(userDataPath, "server");
  const server = await startHttpServer({
    userDataPath: serverDataPath,
    runtimeOptions: { profile: "minimal" }
  });
  try {
    await installAuthenticatedFetch(server);
    const preview = await requestJson(`${server.url}/api/context/compaction/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contextProfileId: "balanced",
        sessionId: "http-preview",
        messages,
        force: true
      })
    });
    assert.equal(preview.status, 200);
    assert.equal(preview.payload.preview, true);

    const httpRun = await requestJson(`${server.url}/api/context/compaction/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contextProfileId: "balanced",
        sessionId: "http-run",
        messages,
        force: true
      })
    });
    assert.equal(httpRun.status, 200);
    assert.equal(httpRun.payload.compacted, true);

    const rpcRun = await requestJson(`${server.url}/api/rpc`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "context-run",
        method: "context.compaction.run",
        params: {
          contextProfileId: "balanced",
          sessionId: "rpc-run",
          messages,
          force: true
        }
      })
    });
    assert.equal(rpcRun.status, 200);
    assert.equal(rpcRun.payload.result.compacted, true);

    const cliRecords = await runCli(server.url, ["context", "compaction", "records", "--limit", "10"]);
    assert.equal(Array.isArray(cliRecords.records), true);

    const clearMemory = await requestJson(`${server.url}/api/context/session-memory/clear`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: "http-run",
        reason: "verify-clear"
      })
    });
    assert.equal(clearMemory.status, 200);
    assert.equal(clearMemory.payload.ok, true);

    const audit = await requestJson(`${server.url}/api/auth/audit?limit=200`);
    assert.equal(audit.status, 200);
    assert.ok(audit.payload.items.some((item) => item.operationId === "context.compaction.run"));
    assert.ok(audit.payload.items.some((item) => item.operationId === "context.session_memory.clear"));
    const auditText = JSON.stringify(audit.payload.items);
    assert.equal(/redaction-test-value-12345/.test(auditText), false);
    assert.equal(/\/Users\/unka\/private/.test(auditText), false);
  } finally {
    await server.close();
  }
} finally {
  await fs.rm(userDataPath, {
    recursive: true,
    force: true
  });
}

console.log("Context compaction verification passed.");
