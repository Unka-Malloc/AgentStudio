import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createContextCompactionRuntimeMock = vi.hoisted(() => vi.fn());

vi.mock("../../../server/platform/specialized/agent/agent-context/context-compact/index.mjs", async () => {
  const actual = await vi.importActual("../../../server/platform/specialized/agent/agent-context/context-compact/index.mjs");
  return {
    ...actual,
    createContextCompactionRuntime: (...args) => createContextCompactionRuntimeMock(...args),
  };
});

import {
  CONTEXT_RUNTIME_PROTOCOL_VERSION,
  createContextRuntime,
  estimateTokens,
} from "../../../server/platform/specialized/agent/agent-context/interface/index.mjs";

const tempRoots = [];
let activeCompactionRuntime = null;

function createStubCompactionRuntime() {
  return {
    run: vi.fn(async () => ({
      protocolVersion: "pact.context.compaction.v1",
      status: "completed",
      compacted: false,
      triggerReason: "stub",
      summary: "stub summary",
      boundary: { boundaryId: "stub-boundary" },
      executionMode: "stub",
      strategy: { id: "session-memory-first", paramKeys: [] },
    })),
    preview: vi.fn(async () => ({
      protocolVersion: "pact.context.compaction.v1",
      status: "preview",
      compacted: false,
      executionMode: "stub",
    })),
    maybeCompact: vi.fn(async () => ({
      protocolVersion: "pact.context.compaction.v1",
      status: "skipped",
      compacted: false,
      triggerReason: "within_budget",
      compactedMessages: [],
    })),
    listRecords: vi.fn(async () => ({
      protocolVersion: "pact.context.compaction.v1",
      path: "",
      records: [],
    })),
    listStrategies: vi.fn(async () => ({
      protocolVersion: "pact.context.compaction.v1",
      strategies: [],
    })),
    listSessionMemory: vi.fn(async () => ({
      protocolVersion: "pact.context.compaction.v1",
      memories: [],
    })),
    clearSessionMemory: vi.fn(async () => ({
      protocolVersion: "pact.context.compaction.v1",
      cleared: 0,
    })),
  };
}

function withTempUserData(prefix = "pact-context-core-") {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix)).then((root) => {
    tempRoots.push(root);
    return root;
  });
}

beforeEach(() => {
  createContextCompactionRuntimeMock.mockImplementation(() => {
    const runtime = createStubCompactionRuntime();
    activeCompactionRuntime = runtime;
    return runtime;
  });
});

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  vi.clearAllMocks();
});

describe("context core: token estimation", () => {
  it("estimates tokens for strings, CJK text and non-string values", () => {
    expect(estimateTokens("hello world")).toBeGreaterThan(0);
    expect(estimateTokens("上下文压缩")).toBeGreaterThan(1);
    expect(estimateTokens({ value: 1, nested: { ok: true } })).toBeGreaterThan(0);
    expect(estimateTokens("")).toBe(1);
  });
});

describe("context runtime profile management", () => {
  it("lists fallback context profiles and resolves persisted runtime metadata", async () => {
    const userDataPath = await withTempUserData("pact-context-core-default-");
    const runtime = createContextRuntime({ userDataPath });
    const profileIndex = await runtime.listProfiles();

    expect(profileIndex.protocolVersion).toBe(CONTEXT_RUNTIME_PROTOCOL_VERSION);
    expect(profileIndex.path).toBe(path.join(userDataPath, "context-core", "context-profiles.json"));
    expect(profileIndex.defaults).toEqual(expect.arrayContaining([
      expect.objectContaining({ profileId: "context-32k" }),
      expect.objectContaining({ profileId: "context-128k" }),
      expect.objectContaining({ profileId: "context-1m" }),
      expect.objectContaining({ profileId: "balanced" }),
      expect.objectContaining({ profileId: "small-context" }),
      expect.objectContaining({ profileId: "deepseek-v3-671b" }),
    ]));
  });

  it("normalizes profiles when saving and reloading", async () => {
    const userDataPath = await withTempUserData("pact-context-core-save-");
    const runtime = createContextRuntime({ userDataPath });
    const { profiles } = await runtime.saveProfiles({
      profiles: [
        {
          profileId: "custom-unit",
          contextWindowTokens: 1024,
          outputReserveTokens: -12,
          toolReserveTokens: "bad",
          budgetPolicy: {
            fixedMemoryRatio: "1.5",
            expertGuidanceRatio: -3,
          },
          rankingWeights: {
            queryRelevance: -1,
            evidenceConfidence: "0.66",
          },
          placementPolicy: {
            criticalEvidenceHeadCount: 0,
            evidenceTailChecklist: false,
            repeatTaskInTail: false,
          },
          compression: {
            mode: "invalid-mode",
            threshold: 2,
            targetRatio: -1,
            summaryMaxTokens: "bad",
          },
          modelCompression: {
            enabled: true,
            maxInputTokens: "bad",
            maxOutputTokens: "bad",
          },
        },
      ],
    });

    const normalized = profiles.find((profile) => profile.profileId === "custom-unit");
    expect(normalized).toBeDefined();
    expect(normalized.contextWindowTokens).toBeGreaterThanOrEqual(4096);
    expect(normalized.outputReserveTokens).toBeGreaterThanOrEqual(256);
    expect(normalized.toolReserveTokens).toBeGreaterThan(0);
    expect(normalized.budgetPolicy.fixedMemoryRatio).toBe(1);
    expect(normalized.budgetPolicy.expertGuidanceRatio).toBe(0);
    expect(normalized.rankingWeights.queryRelevance).toBe(0);
    expect(normalized.rankingWeights.evidenceConfidence).toBe(0.66);
    expect(normalized.placementPolicy.criticalEvidenceHeadCount).toBe(1);
    expect(normalized.placementPolicy.evidenceTailChecklist).toBe(false);
    expect(normalized.placementPolicy.repeatTaskInTail).toBe(false);
    expect(normalized.compression.mode).toBe("deterministic-extractive");
    expect(normalized.compression.threshold).toBe(0.95);
    expect(normalized.modelCompression.enabled).toBe(true);
    expect(normalized.modelCompression.maxInputTokens).toBe(24000);
    expect(normalized.modelCompression.maxOutputTokens).toBe(4000);
  });

  it("falls back to defaults when stored profile file is malformed", async () => {
    const userDataPath = await withTempUserData("pact-context-core-bad-profiles-");
    const runtime = createContextRuntime({ userDataPath });
    await runtime.saveProfiles({ profiles: [] });
    await fs.writeFile(runtime.profilesPath, "not-json", "utf8");

    const profileIndex = await runtime.listProfiles();
    const profileIds = new Set(profileIndex.profiles.map((item) => item.profileId));

    expect(profileIds.has("balanced")).toBe(true);
    expect(profileIds.has("context-1m")).toBe(true);
  });
});

describe("context runtime profile resolution and compaction helpers", () => {
  it("resolves context profile by explicit ids, model alias and allocator result", async () => {
    const userDataPath = await withTempUserData("pact-context-core-resolve-");
    const runtime = createContextRuntime({ userDataPath });
    await runtime.saveProfiles({
      profiles: [{ profileId: "custom-resolved", modelAlias: "alias-model", contextWindowTokens: 5000 }],
    });

    const explicitById = await runtime.resolveProfile({ contextProfileId: "custom-resolved" });
    const explicitByAlias = await runtime.resolveProfile({ modelAlias: "alias-model" });
    const fallback = await runtime.resolveProfile({});
    const allocatorRuntime = createContextRuntime({
      userDataPath,
      clientRuntimeAllocator: {
        resolve: vi.fn(async () => ({
          contextProfileId: "custom-resolved",
        })),
      },
    });
    const fromAllocator = await allocatorRuntime.resolveProfile({});

    expect(explicitById.profileId).toBe("custom-resolved");
    expect(explicitByAlias.profileId).toBe("custom-resolved");
    expect(fallback.profileId).toBe("balanced");
    expect(fromAllocator.profileId).toBe("custom-resolved");
  });

  it("delegates compact and compaction listing helpers to compaction runtime", async () => {
    const userDataPath = await withTempUserData("pact-context-core-compact-proxy-");
    const runtime = createContextRuntime({ userDataPath });
    const previewInput = {
      profileId: "context-128k",
      text: "preview text",
    };
    const compactInput = {
      messages: [{ id: "m1", role: "user", content: "x" }],
      contextProfileId: "context-128k",
    };

    const compactResult = await runtime.compact(compactInput);
    const previewResult = await runtime.previewCompaction(previewInput);
    const runResult = await runtime.runCompaction(previewInput);
    const recordsResult = await runtime.listCompactionRecords({ limit: 1 });
    const strategyResult = await runtime.listCompactionStrategies();
    const sessionMemoryResult = await runtime.listSessionMemory({ limit: 1 });
    const clearSessionResult = await runtime.clearSessionMemory({ sessionId: "s-1" });

    expect(activeCompactionRuntime.run).toHaveBeenCalledTimes(2);
    expect(activeCompactionRuntime.preview).toHaveBeenCalledTimes(1);
    expect(activeCompactionRuntime.listRecords).toHaveBeenCalledWith({ limit: 1 });
    expect(activeCompactionRuntime.listStrategies).toHaveBeenCalledTimes(1);
    expect(activeCompactionRuntime.listSessionMemory).toHaveBeenCalledTimes(1);
    expect(activeCompactionRuntime.clearSessionMemory).toHaveBeenCalledTimes(1);
    expect(compactResult).toMatchObject({ protocolVersion: "pact.context.compaction.v1" });
    expect(previewResult).toMatchObject({
      status: "preview",
      protocolVersion: "pact.context.compaction.v1",
    });
    expect(runResult).toMatchObject({
      status: "completed",
      executionMode: "stub",
    });
    expect(recordsResult).toMatchObject({ protocolVersion: "pact.context.compaction.v1" });
    expect(strategyResult).toMatchObject({ protocolVersion: "pact.context.compaction.v1" });
    expect(sessionMemoryResult).toMatchObject({ protocolVersion: "pact.context.compaction.v1" });
    expect(clearSessionResult).toMatchObject({ protocolVersion: "pact.context.compaction.v1" });
  });
});

describe("context runtime assemble workflows", () => {
  it("builds pack with skipped runtime compaction when no compose-able messages exist", async () => {
    const userDataPath = await withTempUserData("pact-context-core-assemble-skip-");
    const runtime = createContextRuntime({ userDataPath });
    const pack = await runtime.assemble({
      contextProfileId: "context-128k",
      taskBrief: "简短任务描述",
      expertGuidance: [{ label: "guide", instruction: "优先使用证据", query: "task" }],
      retrievedEvidence: [
        {
          evidenceId: "ev-1",
          title: "证据 1",
          snippet: "证据摘要 EV-1",
          confidence: 0.94,
        },
      ],
    });

    expect(activeCompactionRuntime.maybeCompact).toHaveBeenCalledTimes(0);
    expect(pack.compaction).toMatchObject({
      status: "skipped",
      compacted: false,
      triggerReason: "no_messages",
    });
    expect(pack.budgetReport.totalTokens).toBeGreaterThan(0);
    expect(pack.contextBuildRecordId).toBeTruthy();
  });

  it("composes messages from history/recent-turn/tool-state and degrades compaction on runtime failure", async () => {
    const userDataPath = await withTempUserData("pact-context-core-assemble-fail-");
    const runtime = createContextRuntime({ userDataPath });
    activeCompactionRuntime.maybeCompact.mockRejectedValue(new Error("compact-failed"));

    const pack = await runtime.assemble({
      contextProfileId: "context-32k",
      taskBrief: "任务需要审阅上下文",
      history: "历史摘要中包含 evidence:ev-1",
      recentTurns: [
        { id: "r-1", role: "user", content: "最近回合1" },
        { id: "r-2", role: "assistant", content: "最近回合2" },
      ],
      toolState: {
        previousToolResults: [
          {
            tool: "knowledge.search",
            ok: true,
            evidenceId: "ev-tool",
          },
        ],
      },
      retrievedEvidence: [
        {
          evidenceId: "ev-2",
          title: "证据 2",
          snippet: "ev-2 内容",
          confidence: 0.8,
        },
      ],
    });

    const maybeCompactArgs = activeCompactionRuntime.maybeCompact.mock.calls[0]?.[0];
    expect(maybeCompactArgs.messages.map((message) => message.id)).toEqual([
      "history",
      "r-1",
      "r-2",
      "tool-state",
    ]);
    expect(pack.compaction).toMatchObject({
      status: "failed",
      compacted: false,
      degraded: true,
    });
    expect(pack.compaction.error).toContain("compact-failed");
  });

  it("applies model-assisted compaction profile budget and drops knowledge under token pressure", async () => {
    const userDataPath = await withTempUserData("pact-context-core-assemble-budget-");
    const modelCompressor = vi.fn(async () => ({ summary: "model compressed summary for deterministic test" }));
    const runtime = createContextRuntime({
      userDataPath,
      modelCompressor,
    });

    await runtime.saveProfiles({
      profiles: [
        {
          profileId: "budget-test",
          contextWindowTokens: 4096,
          outputReserveTokens: 256,
          toolReserveTokens: 256,
          compression: {
            enabled: true,
            mode: "model-assisted",
            threshold: 0.1,
            targetRatio: 0.22,
          },
          modelCompression: {
            enabled: true,
            alias: "test-model",
            maxInputTokens: 1000,
            maxOutputTokens: 256,
          },
        },
      ],
    });

    const pack = await runtime.assemble({
      contextProfileId: "budget-test",
      taskBrief: "budget token test ".repeat(3000),
      history: "历史 ".repeat(1800),
      recentTurns: [
        { id: "r1", role: "user", content: "recent ".repeat(500) },
        { id: "r2", role: "assistant", content: "assistant ".repeat(480) },
      ],
      toolState: {
        previousToolResults: [
          {
            tool: "knowledge.search",
            ok: true,
            count: 10,
            evidenceId: "ev-tool",
          },
        ],
      },
      expertGuidance: [{ label: "g1", instruction: "Use evidence and protect citations", evidenceRefs: ["ev-1"] }],
      retrievedEvidence: [
        {
          evidenceId: "ev-1",
          title: "证据1",
          snippet: "snippet ".repeat(800),
          confidence: 0.9,
        },
        {
          evidenceId: "ev-2",
          title: "证据2",
          snippet: "snippet ".repeat(800),
          confidence: 0.7,
        },
      ],
      privateSummary: "私有摘要 ".repeat(300),
    });

    expect(modelCompressor).toHaveBeenCalledTimes(2);
    expect(pack.budgetReport.compressed).toBe(true);
    expect(pack.budgetReport.compressionMode).toBe("model-assisted");
    expect(pack.budgetReport.modelCompression.used).toBe(true);
    expect(pack.budgetReport.modelCompression.degraded).toBe(false);
    expect(pack.budgetReport.droppedKnowledgeCount).toBeGreaterThan(0);
  });

  it("keeps runtime operational when model compressor throws and reports degraded compression", async () => {
    const userDataPath = await withTempUserData("pact-context-core-assemble-fallback-");
    const modelCompressor = vi.fn(async () => {
      throw new Error("compressor failure");
    });
    const runtime = createContextRuntime({
      userDataPath,
      modelCompressor,
    });
    await runtime.saveProfiles({
      profiles: [
        {
          profileId: "fallback-model",
          contextWindowTokens: 4096,
          outputReserveTokens: 256,
          toolReserveTokens: 256,
          compression: {
            enabled: true,
            mode: "model-assisted",
          },
          modelCompression: {
            enabled: true,
            alias: "fallback-model",
          },
        },
      ],
    });

    const pack = await runtime.assemble({
      contextProfileId: "fallback-model",
      taskBrief: "token ".repeat(3000),
      history: "history ".repeat(1000),
      retrievedEvidence: [
        {
          evidenceId: "ev-degrade",
          title: "证据退化",
          snippet: "degrade snippet",
          confidence: 0.8,
        },
      ],
    });

    expect(modelCompressor).toHaveBeenCalled();
    expect(pack.budgetReport.modelCompression.degraded).toBe(true);
    expect(pack.budgetReport.modelCompression.used).toBe(false);
    expect(pack.budgetReport.droppedKnowledgeCount).toBeGreaterThanOrEqual(0);
  });
});

describe("context runtime evaluation persistence", () => {
  it("runs evaluation cases and writes deterministic run records", async () => {
    const userDataPath = await withTempUserData("pact-context-core-eval-");
    const runtime = createContextRuntime({ userDataPath });
    const result = await runtime.runEvaluation({
      runId: "eval-unit-1",
      profiles: ["context-128k"],
      cases: [
        {
          caseId: "case-hit",
          taskBrief: "case hit",
          requiredEvidenceIds: ["ev-hit"],
          retrievedEvidence: [
            {
              evidenceId: "ev-hit",
              title: "命中证据",
              snippet: "hit",
            },
          ],
        },
        {
          caseId: "case-miss",
          taskBrief: "case miss",
          requiredEvidenceIds: ["ev-miss"],
          retrievedEvidence: [
            {
              evidenceId: "ev-other",
              title: "未命中",
              snippet: "other",
            },
          ],
        },
      ],
    });

    expect(result.protocolVersion).toBe(CONTEXT_RUNTIME_PROTOCOL_VERSION);
    expect(result.runId).toBe("eval-unit-1");
    expect(result.results).toHaveLength(2);
    expect(result.metrics.averageRequiredEvidenceRecall).toBe(0.5);

    const runsContent = await fs.readFile(runtime.evaluationRunsPath, "utf8");
    const lines = runsContent.trim().split("\n").filter(Boolean);
    const stored = JSON.parse(lines.at(-1));
    expect(stored.runId).toBe("eval-unit-1");
    expect(stored.metrics.averageRequiredEvidenceRecall).toBe(0.5);
  });

  it("returns empty records when build-record store contains invalid json", async () => {
    const userDataPath = await withTempUserData("pact-context-core-build-invalid-");
    const runtime = createContextRuntime({ userDataPath });
    await fs.mkdir(path.dirname(runtime.buildRecordsPath), { recursive: true });
    await fs.writeFile(runtime.buildRecordsPath, "invalid-json\n", "utf8");

    const records = await runtime.listBuildRecords({ limit: 2 });
    expect(records.records).toEqual([]);
  });
});
