import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildMessageGraph,
  chooseCompactionCutPoint,
  createContextCompactionRuntime,
  estimateContextTokens,
  redactCompactionValue
} from "../../../server/platform/specialized/agent/agent-context/interface/index.mjs";

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

function compactProfile(patch = {}) {
  return {
    profileId: "final-context-compact",
    contextWindowTokens: 4096,
    outputReserveTokens: 128,
    modelCompression: {
      enabled: false
    },
    compactionPolicy: {
      strategy: {
        id: "deterministic-extractive",
        params: {}
      },
      recentMessageProtectionCount: 0,
      recentTurnProtectionCount: 0,
      summaryReserveTokens: 512,
      reservedBufferTokens: 256,
      warningBufferTokens: 512,
      modelMaxInputTokens: 512,
      modelMaxOutputTokens: 512,
      deterministicTargetRatio: 0.4,
      ptlRetryLimit: 0,
      ptlHeadTrimRatio: 0.5,
      maxToolResultTokens: 24,
      maxAttachmentTokens: 28,
      reinjectionBudgetTokens: 80,
      persistBoundaries: true,
      persistSessionMemory: true,
      ...patch.compactionPolicy
    },
    ...patch,
    modelCompression: {
      enabled: false,
      ...(patch.modelCompression || {})
    }
  };
}

function longText(label, repeats = 80) {
  return Array.from({ length: repeats }, (_, index) => `${label}-${index} must preserve anchor-one decision-file.md`).join(" ");
}

function strategyMessages() {
  return [
    {
      id: "m1",
      role: "user",
      apiRoundId: "round-1",
      content: longText("round-one", 40)
    },
    {
      id: "m2",
      role: "assistant",
      apiRoundId: "round-2",
      content: longText("round-two", 40),
      toolCalls: [{ id: "tool-a", name: "knowledge.search" }]
    },
    {
      id: "m3",
      role: "tool",
      apiRoundId: "round-2",
      toolUseId: "tool-a",
      content: longText("tool-result", 40)
    },
    {
      id: "m4",
      role: "assistant",
      apiRoundId: "round-3",
      content: longText("round-three", 40)
    }
  ];
}

describe("context compaction final uncovered strategy branches", () => {
  it("normalizes unusual message shapes and protects repeated assistant ids", () => {
    const graph = buildMessageGraph([
      {
        id: "assistant-repeat",
        role: "assistant",
        apiRoundId: "round-a",
        content: [
          "array content with token=secret",
          { text: "object item text" },
          { nested: true }
        ],
        blocks: [
          { type: "tool_use", toolUseId: "block-tool" },
          { name: "named block" }
        ],
        attachments: [
          { fileName: "notes.md", summary: "attachment summary" }
        ]
      },
      {
        id: "assistant-repeat",
        role: "assistant",
        apiRoundId: "round-b",
        content: {
          text: "object content",
          nested: { ok: true }
        },
        toolResults: [
          { id: "result-tool" }
        ],
        blocks: [
          { type: "tool_result", toolUseId: "block-tool" }
        ]
      },
      {
        id: "tail",
        role: "user",
        apiRoundId: "round-c",
        content: "tail"
      }
    ]);

    expect(graph.toolGroups.map((group) => group.id)).toEqual(expect.arrayContaining(["block-tool", "result-tool"]));
    expect(graph.messages[0].text).toContain("object item text");
    expect(graph.messages[1].text).toContain("\"nested\"");

    const toolCutPoint = chooseCompactionCutPoint(graph.messages, {
      profile: {
        compactionPolicy: {
          recentMessageProtectionCount: 2
        }
      }
    });
    expect(toolCutPoint.adjustments.map((item) => item.reason)).toContain("tool_chain_protection");

    const assistantCutPoint = chooseCompactionCutPoint([
      { id: "same-assistant", role: "assistant", apiRoundId: "a", content: "first" },
      { id: "middle", role: "user", apiRoundId: "b", content: "middle" },
      { id: "same-assistant", role: "assistant", apiRoundId: "c", content: "second" },
      { id: "tail", role: "user", apiRoundId: "d", content: "tail" }
    ], {
      profile: {
        compactionPolicy: {
          recentMessageProtectionCount: 2
        }
      }
    });
    expect(assistantCutPoint.adjustments.map((item) => item.reason)).toContain("assistant_message_id_protection");
  });

  it("covers deep redaction and preview input normalization with tool state", async () => {
    let deep = "leaf";
    for (let index = 0; index < 10; index += 1) {
      deep = { nested: deep };
    }
    expect(redactCompactionValue(deep)).toMatchObject({
      nested: {
        nested: {
          nested: {
            nested: {
              nested: {
                nested: {
                  nested: {
                    nested: {
                      nested: "<redacted-depth>"
                    }
                  }
                }
              }
            }
          }
        }
      }
    });

    const runtime = createContextCompactionRuntime({ userDataPath: await tempDir("pact-context-preview-final-") });
    await expect(runtime.listRecords({ limit: 2 })).resolves.toMatchObject({ records: [] });
    const preview = await runtime.preview({
      manual: true,
      profile: compactProfile(),
      history: "history must preserve anchor-one",
      recentTurns: [
        { id: "recent-1", role: "user", content: longText("recent-one", 20) }
      ],
      toolState: {
        activeToolUseIds: ["tool-state-1"],
        password: "secret"
      },
      requiredAnchors: [
        "",
        { id: "a", text: "anchor-one" },
        { id: "a", text: "anchor-one" }
      ],
      compactionQuality: {
        minimumRetentionRatio: 0
      }
    });

    expect(preview.preview).toBe(true);
    expect(preview.compacted).toBe(true);
    expect(preview.qualityReport.requiredAnchorCount).toBe(1);
    expect(preview.summary).toContain("anchor-one");
    expect(preview.summary).not.toContain("secret");
  });

  it("uses model-assisted summaries, records parser failures and opens the model circuit", async () => {
    vi.setSystemTime(new Date("2026-06-05T08:00:00.000Z"));
    const root = await tempDir("pact-context-model-final-");
    const modelCompressor = vi.fn()
      .mockResolvedValueOnce("```json\n{\"summary\":\"model summary anchor-one\",\"constraints\":[\"anchor-one\"]}\n```")
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce("```json\n[]\n```")
      .mockResolvedValueOnce("{}");
    const runtime = createContextCompactionRuntime({ userDataPath: root, modelCompressor });
    const profile = compactProfile({
      modelCompression: {
        enabled: true,
        alias: "compact-model"
      },
      compactionPolicy: {
        strategy: { id: "model-assisted", params: {} },
        ptlRetryLimit: 2,
        maxConsecutiveFailures: 1
      }
    });

    const success = await runtime.run({
      profile,
      sessionId: "model-session",
      messages: strategyMessages(),
      requiredAnchors: ["anchor-one"],
      compactionQuality: { minimumRetentionRatio: 0 }
    });
    expect(success).toMatchObject({
      executionMode: "model-assisted",
      modelEvents: [
        {
          used: true,
          degraded: false
        }
      ]
    });
    expect(success.summary).toBe("model summary anchor-one");

    const fallback = await runtime.run({
      profile,
      sessionId: "model-session-fail",
      messages: strategyMessages(),
      compactionQuality: { minimumRetentionRatio: 0 }
    });
    expect(fallback.executionMode).toBe("deterministic-extractive");
    expect(fallback.degradedReasons).toContain("model_compaction_summary_missing");
    expect(fallback.modelEvents[0]).toMatchObject({
      used: false,
      degraded: true,
      modelFailureCount: 1
    });

    const circuitFallback = await runtime.run({
      profile,
      sessionId: "model-session-circuit",
      messages: strategyMessages(),
      compactionQuality: { minimumRetentionRatio: 0 }
    });
    expect(circuitFallback.degradedReasons).toContain("model_circuit_breaker_open");
    expect(circuitFallback.circuitBreaker.open).toBe(true);
  });

  it("dehydrates workbench payloads and trims retry inputs for model calls", async () => {
    const heavyBase64 = "a".repeat(320);
    const workbenchMessages = [
      {
        id: "w1",
        role: "user",
        apiRoundId: "round-1",
        content: [
          { type: "image", name: "diagram.png", dataBase64: heavyBase64, summary: "diagram summary" },
          "plain text data:image/png;base64," + heavyBase64,
          { text: "object text apiKey=hidden-value" },
          42
        ],
        blocks: [
          { kind: "pdf", fileName: "source.pdf", bytes: heavyBase64, title: "source pdf" },
          { text: "block text with /Users/unka/private/source.pdf" },
          "raw block"
        ],
        attachments: [
          { type: "text", name: "small.txt", text: "tiny" },
          { mediaType: "application/pdf", fileName: "large.pdf", data: heavyBase64, text: longText("attachment", 20) }
        ]
      },
      {
        id: "w2",
        role: "assistant",
        apiRoundId: "round-2",
        content: longText("assistant-workbench", 80)
      },
      {
        id: "w3",
        role: "user",
        apiRoundId: "round-3",
        content: longText("user-workbench", 80)
      }
    ];
    const deterministicRuntime = createContextCompactionRuntime({ userDataPath: await tempDir("pact-context-workbench-det-") });
    const deterministic = await deterministicRuntime.run({
      profile: compactProfile({
        compactionPolicy: {
          strategy: { id: "workbench-reconstruction", params: {} }
        }
      }),
      sessionId: "workbench-det",
      messages: workbenchMessages,
      compactionQuality: { minimumRetentionRatio: 0 }
    });
    expect(deterministic.executionMode).toBe("workbench-deterministic");
    expect(deterministic.degradedReasons).toContain("model_compaction_not_configured");
    expect(deterministic.preprocessingEvents[0]).toMatchObject({
      type: "payload_dehydration",
      strippedBlockCount: expect.any(Number),
      dehydratedAttachmentCount: expect.any(Number)
    });
    expect(deterministic.preprocessingEvents[0].strippedBlockCount).toBeGreaterThan(0);
    expect(deterministic.preprocessingEvents[0].dehydratedAttachmentCount).toBeGreaterThan(0);

    const modelCompressor = vi.fn(async ({ prompt }) => ({
      summary: `{"summary":"workbench model summary anchor-one ${prompt.includes("w3") ? "tail" : "trimmed"}"}`
    }));
    const modelRuntime = createContextCompactionRuntime({
      userDataPath: await tempDir("pact-context-workbench-model-"),
      modelCompressor
    });
    const modelResult = await modelRuntime.run({
      profile: compactProfile({
        modelCompression: { enabled: true },
        compactionPolicy: {
          strategy: { id: "workbench-reconstruction", params: {} },
          modelMaxInputTokens: 40,
          ptlRetryLimit: 1,
          ptlHeadTrimRatio: 0.5
        }
      }),
      sessionId: "workbench-model",
      messages: [
        ...workbenchMessages,
        { id: "w4", role: "assistant", apiRoundId: "round-4", content: longText("tail-workbench", 80) }
      ],
      compactionQuality: { minimumRetentionRatio: 0 }
    });
    expect(modelResult.executionMode).toBe("workbench-reconstruction");
    expect(modelResult.modelEvents[0]).toMatchObject({
      used: true,
      promptCacheCompatible: true
    });
    expect(modelResult.modelEvents[0].attempts[0].inputTokens).toBeGreaterThan(0);
  });

  it("falls back from failing workbench model compression and reuses session memory", async () => {
    const failingRuntime = createContextCompactionRuntime({
      userDataPath: await tempDir("pact-context-workbench-fail-"),
      modelCompressor: vi.fn(async () => "not json")
    });
    const failedModel = await failingRuntime.run({
      profile: compactProfile({
        modelCompression: { enabled: true },
        compactionPolicy: {
          strategy: { id: "workbench-reconstruction", params: {} },
          ptlRetryLimit: 0
        }
      }),
      sessionId: "workbench-fail",
      messages: strategyMessages(),
      compactionQuality: { minimumRetentionRatio: 0 }
    });
    expect(failedModel.executionMode).toBe("workbench-deterministic");
    expect(failedModel.degradedReasons).toContain("model_compaction_json_missing");
    expect(failedModel.modelEvents[0]).toMatchObject({ used: false, degraded: true });

    const memoryRuntime = createContextCompactionRuntime({ userDataPath: await tempDir("pact-context-memory-final-") });
    const profile = compactProfile({
      compactionPolicy: {
        strategy: { id: "session-memory-first", params: {} }
      }
    });
    const input = {
      profile,
      sessionId: "memory-session",
      messages: strategyMessages(),
      compactionQuality: { minimumRetentionRatio: 0 }
    };
    const first = await memoryRuntime.run(input);
    expect(first.executionMode).toBe("deterministic-extractive");

    const reused = await memoryRuntime.run(input);
    expect(reused.executionMode).toBe("session-memory");
    expect(reused.memoryEvents[0]).toMatchObject({ used: true });

    const mismatch = await memoryRuntime.run({
      ...input,
      messages: [
        ...strategyMessages(),
        { id: "m5", role: "user", apiRoundId: "round-4", content: longText("changed", 20) }
      ]
    });
    expect(mismatch.memoryEvents[0]).toMatchObject({
      used: false,
      reason: "source_hash_mismatch"
    });

    await expect(memoryRuntime.clearSessionMemory({ sessionId: "memory-session" })).resolves.toMatchObject({
      protocolVersion: expect.any(String)
    });
    expect(memoryRuntime.listStrategies().strategies.map((item) => item.id)).toEqual(expect.arrayContaining([
      "deterministic-extractive",
      "model-assisted",
      "session-memory-first",
      "workbench-reconstruction"
    ]));
  });

  it("skips micro compaction when disabled and rejects empty custom strategy output", async () => {
    const runtime = createContextCompactionRuntime({
      userDataPath: await tempDir("pact-context-custom-empty-"),
      strategies: [
        {
          id: "empty-custom",
          run: async () => ({ summary: "" })
        }
      ]
    });
    await expect(runtime.run({
      persist: false,
      profile: compactProfile({
        compactionPolicy: {
          strategy: { id: "empty-custom", params: {} }
        }
      }),
      messages: strategyMessages()
    })).rejects.toThrow("context_compaction_strategy_summary_missing");

    const noMicroRuntime = createContextCompactionRuntime({ userDataPath: await tempDir("pact-context-no-micro-") });
    const noMicro = await noMicroRuntime.run({
      profile: compactProfile({
        compactionPolicy: {
          microCompaction: false,
          recentMessageProtectionCount: 1
        }
      }),
      sessionId: "no-micro",
      messages: [
        { id: "n1", role: "user", apiRoundId: "n1", content: longText("head", 30) },
        {
          id: "n2",
          role: "tool",
          apiRoundId: "n2",
          toolUseId: "tool-heavy",
          content: longText("tool-heavy", 120)
        }
      ],
      compactionQuality: { minimumRetentionRatio: 0 }
    });
    expect(noMicro.microCompaction).toMatchObject({
      changedCount: 0,
      dehydratedAttachmentCount: 0
    });
    expect(estimateContextTokens(noMicro.messagesToKeep[0].text)).toBeGreaterThan(24);
  });
});
