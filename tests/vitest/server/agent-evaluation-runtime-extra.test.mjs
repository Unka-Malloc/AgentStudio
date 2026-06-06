import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AGENT_EVALUATION_PROTOCOL_VERSION,
  createAgentEvaluationRuntime,
} from "../../../server/platform/specialized/capabilities/tools/agent-evaluation-runtime/index.mjs";
import createAgentEvaluationRuntimeDefault from "../../../server/platform/specialized/capabilities/tools/agent-evaluation-runtime/index.mjs";

const tempRoots = [];

async function withTempUserData(callback) {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-agent-evaluation-runtime-extra-"));
  tempRoots.push(userDataPath);
  return callback(userDataPath);
}

async function seedRuns(runsPath, runs) {
  await fs.mkdir(path.dirname(runsPath), { recursive: true });
  await fs.writeFile(
    runsPath,
    JSON.stringify(
      {
        protocolVersion: AGENT_EVALUATION_PROTOCOL_VERSION,
        runs,
      },
      null,
      2
    ),
    "utf8"
  );
}

function createSkillMock() {
  const skillRun = vi.fn(async (input = {}) => {
    const query = String(input.query || "");
    const fixtures = {
      "alpha query": {
        searchResult: {
          items: [
            { evidenceId: "ev-alpha-1" },
            { evidenceId: "ev-alpha-2" },
            { evidenceId: "ev-alpha-3" },
          ],
        },
        gate: {
          ok: true,
          decision: "pass",
          metrics: {
            evidenceCount: 3,
            uncitedClaimCount: 1,
            conflictCount: 0,
          },
        },
        plan: { intent: "alpha-intent" },
      },
      "beta beta": {
        searchResult: {
          items: [],
        },
        gate: {
          ok: false,
          decision: "fail",
          metrics: {
            evidenceCount: 0,
            uncitedClaimCount: 0,
            conflictCount: 0,
          },
        },
        plan: { intent: "beta-intent" },
      },
      "first question": {
        searchResult: {
          items: [
            { evidenceId: "ev-1" },
            { evidenceId: "ev-2" },
            { evidenceId: "ev-3" },
          ],
        },
        gate: {
          ok: true,
          decision: "pass",
          metrics: {
            evidenceCount: 3,
            uncitedClaimCount: 1,
            conflictCount: 0,
          },
        },
        answerPolicy: { mode: "strict" },
        plan: { intent: "first-intent" },
      },
      "second question": {
        searchResult: {
          items: [
            { evidenceId: "ev-a" },
            { evidenceId: "ev-b" },
          ],
        },
        gate: {
          ok: false,
          decision: "fail",
          metrics: {
            evidenceCount: 2,
            uncitedClaimCount: 0,
            conflictCount: 2,
          },
        },
        answerPolicy: { mode: "relaxed" },
        plan: { intent: "second-intent" },
      },
      "no evidence case": {
        searchResult: {
          items: [
            { evidenceId: "ev-z" },
          ],
        },
        gate: {
          ok: true,
          decision: "pass",
          metrics: {
            evidenceCount: 1,
            uncitedClaimCount: 0,
            conflictCount: 0,
          },
        },
        answerPolicy: { mode: "default" },
        plan: { intent: "no-evidence-intent" },
      },
      "oldest query": {
        searchResult: {
          items: [{ evidenceId: "ev-oldest" }],
        },
        gate: {
          ok: true,
          decision: "pass",
          metrics: {
            evidenceCount: 1,
            uncitedClaimCount: 0,
            conflictCount: 0,
          },
        },
        plan: { intent: "oldest-intent" },
      },
    };

    return fixtures[query] || {
      searchResult: {
        items: [{ evidenceId: `${query || "empty"}-evidence` }],
      },
      gate: {
        ok: true,
        decision: "pass",
        metrics: {
          evidenceCount: 1,
          uncitedClaimCount: 0,
          conflictCount: 0,
        },
      },
      plan: { intent: "fallback-intent" },
    };
  });

  return { skillRun };
}

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))
  );
});

describe("agent evaluation runtime exports and initialization", () => {
  it("exports the public protocol version and default factory", async () => {
    await withTempUserData(async (userDataPath) => {
      const runtime = createAgentEvaluationRuntime({
        userDataPath,
        knowledgeAgentSkill: { run: vi.fn() },
      });

      expect(AGENT_EVALUATION_PROTOCOL_VERSION).toBe("pact.agent-evaluation.v1");
      expect(createAgentEvaluationRuntimeDefault).toBe(createAgentEvaluationRuntime);
      expect(runtime).toMatchObject({
        protocolVersion: AGENT_EVALUATION_PROTOCOL_VERSION,
        rootPath: path.join(userDataPath, "agent-evaluation"),
        runsPath: path.join(userDataPath, "agent-evaluation", "evaluation-runs.json"),
        generateCases: expect.any(Function),
        runEvaluation: expect.any(Function),
        listRuns: expect.any(Function),
        getRun: expect.any(Function),
      });
    });
  });
});

describe("agent evaluation runtime generation and execution", () => {
  it("normalizes generated cases, dedupes queries, and filters cases without evidence", async () => {
    await withTempUserData(async (userDataPath) => {
      const { skillRun } = createSkillMock();
      const runtime = createAgentEvaluationRuntime({
        userDataPath,
        knowledgeAgentSkill: { run: skillRun },
      });

      const result = await runtime.generateCases({
        queries: ["  alpha query  ", "alpha query", " beta   beta ", "", null],
        seedQuery: "beta beta",
        limit: 2,
        evidencePerCase: 99,
        requiredEvidencePerCase: 2,
      });

      expect(skillRun).toHaveBeenCalledTimes(2);
      expect(skillRun.mock.calls[0][0]).toMatchObject({
        query: "alpha query",
        limit: 20,
        thresholds: {
          minEvidence: 1,
          minSources: 1,
          requireCitationsForAnswer: false,
        },
      });
      expect(skillRun.mock.calls[1][0].query).toBe("beta beta");
      expect(result).toEqual({
        protocolVersion: AGENT_EVALUATION_PROTOCOL_VERSION,
        cases: [
          {
            caseId: "generated-1",
            query: "alpha query",
            expectedAnswer: "",
            requiredEvidenceIds: ["ev-alpha-1", "ev-alpha-2"],
            tags: ["generated", "alpha-intent"],
            metadata: {
              generatedAt: expect.any(String),
              gateDecision: "pass",
              evidenceCount: 3,
            },
          },
        ],
      });
    });
  });

  it("runs explicit cases, aggregates metrics, trims run ids, and truncates stored history", async () => {
    await withTempUserData(async (userDataPath) => {
      const { skillRun } = createSkillMock();
      const runtime = createAgentEvaluationRuntime({
        userDataPath,
        knowledgeAgentSkill: { run: skillRun },
      });

      const seededRuns = Array.from({ length: 205 }, (_value, index) => ({
        runId: `old-${index + 1}`,
        startedAt: `2025-01-${String((index % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
        status: "completed",
        caseResults: [{ caseId: `case-${index + 1}` }],
      }));
      await seedRuns(runtime.runsPath, seededRuns);

      const run = await runtime.runEvaluation({
        runId: "  custom-run  ",
        profileId: "profile-fallback",
        profileKey: "profile-key",
        learningEnabled: false,
        thresholds: {
          minRecallAtK: 0.6,
          minMrrAtK: 0.6,
          minNdcgAtK: 0.6,
          minGatePassRate: 0.9,
        },
        gateThresholds: {
          minEvidence: 99,
        },
        cases: [
          {
            id: "case-a",
            q: "  first question  ",
            answer: "ignored",
            evidenceIds: [" ev-1 ", "", null, "ev-2"],
            tags: ["alpha"],
            thresholds: { minMrrAtK: 0.8 },
            metadata: { source: "one" },
          },
          {
            question: "second question",
            expectedAnswer: "ignored",
            requiredEvidenceIds: ["ev-x"],
            thresholds: { minRecallAtK: 0.1 },
            metadata: { source: "two" },
          },
          {
            question: "no evidence case",
            expectedAnswer: "",
            requiredEvidenceIds: [],
            metadata: { source: "three" },
          },
        ],
      });

      expect(skillRun).toHaveBeenCalledTimes(3);
      expect(skillRun.mock.calls[0][0]).toMatchObject({
        query: "first question",
        limit: 10,
        retrievalProfileId: "profile-fallback",
        profileKey: "profile-key",
        learningEnabled: false,
        thresholds: {
          minEvidence: 99,
          minSources: 1,
          requireCitationsForAnswer: false,
          minMrrAtK: 0.8,
        },
      });
      expect(skillRun.mock.calls[1][0]).toMatchObject({
        query: "second question",
        thresholds: {
          minEvidence: 99,
          minSources: 1,
          requireCitationsForAnswer: false,
          minRecallAtK: 0.1,
        },
      });
      expect(skillRun.mock.calls[2][0].thresholds.minEvidence).toBe(99);

      expect(run).toMatchObject({
        protocolVersion: AGENT_EVALUATION_PROTOCOL_VERSION,
        runId: "custom-run",
        status: "completed",
        k: 10,
        inputWindow: {
          caseCount: 3,
          retrievalProfileId: "profile-fallback",
          learningEnabled: false,
        },
        metrics: {
          caseCount: 3,
          recallAtK: 0.333333,
          mrrAtK: 0.333333,
          ndcgAtK: 0.333333,
          gatePassRate: 0.666667,
          unsupportedClaimRate: 0.333333,
          conflictRate: 0.666667,
        },
        gates: {
          minRecallAtK: 0.6,
          minMrrAtK: 0.6,
          minNdcgAtK: 0.6,
          minGatePassRate: 0.9,
        },
        passed: false,
        recommendations: [
          "不要自动发布候选检索 profile；先查看低分 case。",
          "优先补充 query rewrite、领域同义词或证据覆盖。",
          "若 gatePassRate 低，调高召回 limit 或降低过严阈值后重新评估。",
        ],
      });
      expect(run.caseResults).toHaveLength(3);
      expect(run.caseResults[0]).toMatchObject({
        caseId: "case-a",
        query: "first question",
        requiredEvidenceIds: ["ev-1", "ev-2"],
        rankedEvidenceIds: ["ev-1", "ev-2", "ev-3"],
        answerPolicy: { mode: "strict" },
        metrics: {
          recallAtK: 1,
          mrrAtK: 1,
          ndcgAtK: 1,
        },
      });
      expect(run.caseResults[2]).toMatchObject({
        caseId: "case-3",
        query: "no evidence case",
        requiredEvidenceIds: [],
        metrics: {
          recallAtK: 0,
          mrrAtK: 0,
          ndcgAtK: 0,
        },
      });

      const persisted = JSON.parse(await fs.readFile(runtime.runsPath, "utf8"));
      expect(persisted.protocolVersion).toBe(AGENT_EVALUATION_PROTOCOL_VERSION);
      expect(persisted.runs).toHaveLength(200);
      expect(persisted.runs[0].runId).toBe("old-7");
      expect(persisted.runs.at(-1)).toMatchObject({
        runId: "custom-run",
        caseResults: expect.any(Array),
      });
    });
  });

  it("creates empty runs when no cases are available and generates a stable id", async () => {
    await withTempUserData(async (userDataPath) => {
      const { skillRun } = createSkillMock();
      const runtime = createAgentEvaluationRuntime({
        userDataPath,
        knowledgeAgentSkill: { run: skillRun },
      });

      const run = await runtime.runEvaluation({});

      expect(skillRun).not.toHaveBeenCalled();
      expect(run.runId.startsWith("agent_eval_")).toBe(true);
      expect(run.metrics).toEqual({
        caseCount: 0,
        recallAtK: 0,
        mrrAtK: 0,
        ndcgAtK: 0,
        gatePassRate: 0,
        unsupportedClaimRate: 0,
        conflictRate: 0,
      });
      expect(run.gates).toEqual({
        minRecallAtK: 0,
        minMrrAtK: 0,
        minNdcgAtK: 0,
        minGatePassRate: 0,
      });
      expect(run.passed).toBe(false);
      expect(run.recommendations).toHaveLength(3);
      expect(run.caseResults).toEqual([]);

      const persisted = JSON.parse(await fs.readFile(runtime.runsPath, "utf8"));
      expect(persisted.runs).toHaveLength(1);
      expect(persisted.runs[0].runId).toBe(run.runId);
    });
  });

  it("lists runs in descending order and resolves getRun from stored state", async () => {
    await withTempUserData(async (userDataPath) => {
      const runtime = createAgentEvaluationRuntime({
        userDataPath,
        knowledgeAgentSkill: { run: vi.fn() },
      });

      await seedRuns(runtime.runsPath, [
        {
          runId: "run-old",
          startedAt: "2024-01-01T00:00:00.000Z",
          status: "completed",
          caseResults: [{ caseId: "c-old" }],
        },
        {
          runId: "run-new",
          startedAt: "2025-01-01T00:00:00.000Z",
          status: "completed",
          caseResults: [{ caseId: "c-new" }],
        },
        {
          runId: "run-middle",
          startedAt: "2024-06-01T00:00:00.000Z",
          status: "completed",
          caseResults: [{ caseId: "c-middle" }],
        },
      ]);

      const listed = await runtime.listRuns({ limit: 2 });
      expect(listed).toEqual({
        protocolVersion: AGENT_EVALUATION_PROTOCOL_VERSION,
        runs: [
          {
            runId: "run-new",
            startedAt: "2025-01-01T00:00:00.000Z",
            status: "completed",
            caseResults: undefined,
          },
          {
            runId: "run-middle",
            startedAt: "2024-06-01T00:00:00.000Z",
            status: "completed",
            caseResults: undefined,
          },
        ],
      });

      expect(await runtime.getRun("run-old")).toMatchObject({
        runId: "run-old",
        status: "completed",
        caseResults: [{ caseId: "c-old" }],
      });
      expect(await runtime.getRun("missing-run")).toBeNull();
    });
  });
});
