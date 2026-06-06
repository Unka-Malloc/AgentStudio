import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildMessageGraph,
  chooseCompactionCutPoint,
  computeCompactionBudget,
  CONTEXT_COMPACTION_PROTOCOL_VERSION,
  createContextCompactionRuntime,
  createContextCompactionStrategyAdapter,
  estimateContextTokens,
  listContextCompactionStrategies,
  normalizeCompactionPolicy,
  redactCompactionValue,
} from "../../../server/platform/specialized/agent/agent-context/context-compact/index.mjs";

const tempRoots = [];

async function tempDir(prefix) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

function sampleMessages() {
  return [
    {
      id: "m1",
      role: "user",
      apiRoundId: "round-1",
      content: "We must keep evidence:ev-critical and never leak token=abc123. Work in /Users/unka/private/file.md.",
    },
    {
      id: "m2",
      role: "assistant",
      apiRoundId: "round-1",
      content: "Decision: use ContextCompactionRuntime. Calling knowledge tool.",
      toolCalls: [{ id: "tool-1", name: "knowledge.search" }],
    },
    {
      id: "m3",
      role: "tool",
      apiRoundId: "round-1",
      toolUseId: "tool-1",
      content: "risk-blocked risk-blocked ".repeat(260),
    },
    {
      id: "m4",
      role: "assistant",
      apiRoundId: "round-1",
      content: "The tool confirmed evidence:ev-critical and todo add boundary resume.",
    },
    {
      id: "m5",
      role: "user",
      apiRoundId: "round-2",
      content: "Next, preserve active plan and current files. API key sk-test-secret must not appear.",
      attachments: [
        {
          name: "huge-log.txt",
          text: "RAW_ATTACHMENT_PAYLOAD ".repeat(400),
        },
      ],
    },
    {
      id: "m6",
      role: "assistant",
      apiRoundId: "round-2",
      content: "Acknowledged. Keep evidence:ev-critical and risk-blocked.",
    },
  ];
}

function smallProfile(patch = {}) {
  return {
    profileId: "unit-compact",
    contextWindowTokens: 4096,
    outputReserveTokens: 256,
    modelCompression: {
      enabled: false,
    },
    compactionPolicy: {
      strategy: {
        id: "deterministic-extractive",
        params: { preserveFacts: true },
      },
      summaryReserveTokens: 512,
      reservedBufferTokens: 512,
      warningBufferTokens: 900,
      recentMessageProtectionCount: 2,
      recentTurnProtectionCount: 1,
      deterministicTargetRatio: 0.3,
      maxToolResultTokens: 90,
      maxAttachmentTokens: 80,
      reinjectionBudgetTokens: 220,
      persistSessionMemory: false,
      ...patch.compactionPolicy,
    },
    ...patch,
  };
}

describe("context compaction pure helpers", () => {
  it("estimates tokens, redacts secrets and normalizes policy bounds", () => {
    expect(estimateContextTokens("abcd中文")).toBeGreaterThan(1);
    expect(redactCompactionValue({
      token: "secret-token",
      nested: {
        message: "Bearer abc.def and /Users/unka/private/file.txt",
      },
      buffer: Buffer.from("abc"),
    })).toMatchObject({
      token: "<redacted>",
      nested: {
        message: expect.stringContaining("<redacted-secret>"),
      },
      buffer: {
        redacted: true,
        reason: "buffer",
        byteLength: 3,
      },
    });

    const policy = normalizeCompactionPolicy({
      compression: {
        protectLastNTurns: 2,
        summaryMaxTokens: 700,
        targetRatio: 0.2,
      },
      compactionPolicy: {
        enabled: false,
        strategy: {
          id: "custom-strategy",
          params: {
            preserve: true,
          },
        },
        hardThresholdRatio: 2,
        recentMessageProtectionCount: -1,
      },
    });
    expect(policy).toMatchObject({
      enabled: false,
      strategyId: "custom-strategy",
      strategy: {
        id: "custom-strategy",
        params: {
          preserve: true,
        },
      },
      hardThresholdRatio: 1,
      recentMessageProtectionCount: 0,
      deterministicTargetRatio: 0.24,
    });

    const budget = computeCompactionBudget({
      contextWindowTokens: 4096,
      outputReserveTokens: 256,
      compactionPolicy: {
        summaryReserveTokens: 512,
        reservedBufferTokens: 512,
        warningBufferTokens: 900,
      },
    });
    expect(budget).toMatchObject({
      contextWindowTokens: 4096,
      outputReserveTokens: 256,
      summaryReserveTokens: 512,
      effectiveWindowTokens: 3328,
      autoCompactThresholdTokens: 2816,
    });
  });

  it("builds message graphs and moves cut points to protect tool/API round groups", () => {
    const messages = sampleMessages();
    const graph = buildMessageGraph(messages);

    expect(graph.toolGroups[0]).toMatchObject({
      id: "tool-1",
      uses: [1, 2],
      results: [2],
    });
    expect(graph.apiRoundGroups.find((group) => group.id === "round-1")?.indexes).toEqual([0, 1, 2, 3]);

    const cutPoint = chooseCompactionCutPoint(messages, {
      profile: {
        compactionPolicy: {
          recentMessageProtectionCount: 3,
        },
      },
    });
    expect(cutPoint.proposedCutIndex).toBe(3);
    expect(cutPoint.cutIndex).toBe(0);
    expect(cutPoint.adjustments.map((item) => item.reason)).toContain("api_round_protection");

    const toolBoundaryCutPoint = chooseCompactionCutPoint([
      { id: "t1", role: "user", apiRoundId: "a", content: "start" },
      { id: "t2", role: "assistant", apiRoundId: "b", content: "call", toolCalls: [{ id: "tool-x" }] },
      { id: "t3", role: "user", apiRoundId: "c", content: "middle" },
      { id: "t4", role: "tool", apiRoundId: "d", toolUseId: "tool-x", content: "result" },
      { id: "t5", role: "assistant", apiRoundId: "e", content: "tail" },
    ], {
      profile: {
        compactionPolicy: {
          recentMessageProtectionCount: 2,
        },
      },
    });
    expect(toolBoundaryCutPoint.adjustments.map((item) => item.reason)).toContain("tool_chain_protection");
  });

  it("wraps custom strategy adapters and validates strategy metadata", async () => {
    expect(() => createContextCompactionStrategyAdapter({ id: "" }))
      .toThrow("context_compaction_strategy_id_required");
    expect(() => createContextCompactionStrategyAdapter({ id: "custom" }))
      .toThrow("context_compaction_strategy_run_required:custom");

    const adapter = createContextCompactionStrategyAdapter({
      id: "custom-adapter",
      label: "Custom adapter",
      inputAdapter: (context) => ({
        ids: context.compactedMessages.map((message) => message.id),
        limit: context.policy.strategy.params.limit,
      }),
      run: async (input) => ({
        executionMode: "custom-mode",
        summary: `Custom summary for ${input.ids.join(",")} limit=${input.limit}`,
        structured: {
          ids: input.ids,
        },
      }),
    });
    const result = await adapter.run({
      compactedMessages: [{ id: "m1" }, { id: "m2" }],
      policy: {
        strategy: {
          id: "custom-adapter",
          params: {
            limit: 3,
          },
        },
      },
      targetTokens: 100,
    });

    expect(result).toMatchObject({
      executionMode: "custom-mode",
      summaryResult: {
        summary: expect.stringContaining("m1,m2"),
        structured: {
          ids: ["m1", "m2"],
        },
      },
    });
    expect(listContextCompactionStrategies([adapter]).map((item) => item.id)).toContain("custom-adapter");
  });
});

describe("context compaction runtime", () => {
  it("skips maybeCompact when source tokens remain under threshold", async () => {
    const userDataPath = await tempDir("pact-context-skip-");
    const runtime = createContextCompactionRuntime({ userDataPath });

    const skipped = await runtime.maybeCompact({
      profile: smallProfile(),
      sessionId: "short-session",
      messages: [
        { id: "s1", role: "user", content: "short" },
        { id: "s2", role: "assistant", content: "ok" },
      ],
    });

    expect(skipped).toMatchObject({
      protocolVersion: CONTEXT_COMPACTION_PROTOCOL_VERSION,
      status: "skipped",
      shouldCompact: false,
      compacted: false,
      triggerReason: "within_budget",
    });
    expect(skipped.tokenReport.savingsRatio).toBe(0);
  });

  it("runs deterministic compaction with redaction, quality checks, persistence and resume", async () => {
    vi.setSystemTime(new Date("2026-06-04T12:00:00.000Z"));
    const userDataPath = await tempDir("pact-context-run-");
    const runtime = createContextCompactionRuntime({ userDataPath });
    const result = await runtime.run({
      profile: smallProfile(),
      sessionId: "session-1",
      source: "unit",
      messages: sampleMessages(),
      taskBrief: "Implement context compaction coverage",
      runtimeState: {
        activePlan: ["read", "test", "scan"],
        enabledTools: ["context.compaction.run"],
        currentFiles: ["/Users/unka/DevSpace/Pact/server/platform/specialized/agent/agent-context/context-compact/index.mjs"],
        activeToolUseIds: [],
      },
      requiredAnchors: ["evidence:ev-critical", "risk-blocked"],
      compactionQuality: {
        minimumRetentionRatio: 1,
      },
    });

    expect(result).toMatchObject({
      protocolVersion: CONTEXT_COMPACTION_PROTOCOL_VERSION,
      status: "completed",
      compacted: true,
      strategy: {
        id: "deterministic-extractive",
        paramKeys: ["preserveFacts"],
      },
      executionMode: "deterministic-extractive",
      boundary: {
        type: "compact_boundary",
      },
      qualityReport: {
        passed: false,
        missingAnchorCount: 0,
      },
    });
    expect(result.summary).toContain("evidence:ev-critical");
    expect(result.summary).not.toContain("abc123");
    expect(result.summary).not.toContain("/Users/unka/private");
    expect(result.degradedReasons).toContain("compaction_quality_failed");
    expect(result.microCompaction.changedCount).toBeGreaterThan(0);
    expect(result.attachmentsToReinject.length).toBeGreaterThan(0);
    expect(result.reinjection.items.map((item) => item.key)).toContain("taskBrief");

    const records = await runtime.listRecords({ limit: 5 });
    expect(records.records[0]).toMatchObject({
      protocolVersion: CONTEXT_COMPACTION_PROTOCOL_VERSION,
      status: "completed",
      boundaryId: result.boundary.boundaryId,
    });
    const boundaries = await runtime.listBoundaries({ limit: 5 });
    expect(boundaries.boundaries[0].boundaryId).toBe(result.boundary.boundaryId);

    const resumed = runtime.resumeTranscript({
      messages: [
        { id: "old-1", role: "user", content: "old" },
        result.boundaryMessage,
        ...result.messagesToKeep,
      ],
    });
    expect(resumed).toMatchObject({
      protocolVersion: CONTEXT_COMPACTION_PROTOCOL_VERSION,
      resumed: true,
      skippedMessageCount: 1,
    });
    expect(resumed.messages[0].type).toBe("compact_boundary");
  });

  it("marks missing anchors as degraded and keeps custom strategy output", async () => {
    const userDataPath = await tempDir("pact-context-custom-");
    const customAdapter = createContextCompactionStrategyAdapter({
      id: "unit-custom",
      run: async (input) => ({
        executionMode: "unit-custom-mode",
        summary: `Custom kept ${input.messages.length} messages but not the required anchor`,
        structured: {
          messageCount: input.messages.length,
        },
      }),
    });
    const runtime = createContextCompactionRuntime({
      userDataPath,
      strategies: [customAdapter],
    });

    const result = await runtime.run({
      profile: smallProfile({
        compactionPolicy: {
          strategy: {
            id: "unit-custom",
            params: {
              tuned: true,
            },
          },
          persistSessionMemory: false,
        },
      }),
      persist: false,
      sessionId: "custom-session",
      messages: sampleMessages(),
      requiredAnchors: ["anchor-that-is-not-present"],
      compactionQuality: {
        minimumRetentionRatio: 1,
      },
    });

    expect(result).toMatchObject({
      status: "completed",
      executionMode: "unit-custom-mode",
      degraded: true,
      degradedReasons: ["required_anchor_loss"],
      strategy: {
        id: "unit-custom",
        paramKeys: ["tuned"],
      },
      structuredSummary: {
        messageCount: expect.any(Number),
      },
      qualityReport: {
        passed: false,
        missingAnchorCount: 1,
      },
    });
  });
});
