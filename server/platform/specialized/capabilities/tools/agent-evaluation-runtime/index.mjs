import fs from "node:fs/promises";
import path from "node:path";

export const AGENT_EVALUATION_PROTOCOL_VERSION = "v0.0.1:agent:evaluation-1";

function nowIso() {
  return new Date().toISOString();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function stableRunId(prefix = "eval") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function ndcgAtK(rankedEvidenceIds = [], requiredEvidenceIds = [], k = 10) {
  const required = new Set(requiredEvidenceIds);
  const dcg = rankedEvidenceIds.slice(0, k).reduce((sum, id, index) => {
    if (!required.has(id)) {
      return sum;
    }
    return sum + 1 / Math.log2(index + 2);
  }, 0);
  const idealCount = Math.min(required.size, k);
  const idcg = Array.from({ length: idealCount }).reduce(
    (sum, _value, index) => sum + 1 / Math.log2(index + 2),
    0
  );
  return idcg > 0 ? dcg / idcg : 0;
}

function mrrAtK(rankedEvidenceIds = [], requiredEvidenceIds = [], k = 10) {
  const required = new Set(requiredEvidenceIds);
  const index = rankedEvidenceIds.slice(0, k).findIndex((id) => required.has(id));
  return index >= 0 ? 1 / (index + 1) : 0;
}

function recallAtK(rankedEvidenceIds = [], requiredEvidenceIds = [], k = 10) {
  const required = new Set(requiredEvidenceIds);
  if (!required.size) {
    return 0;
  }
  const hitCount = rankedEvidenceIds.slice(0, k).filter((id) => required.has(id)).length;
  return hitCount / required.size;
}

function normalizeCase(item = {}, index = 0) {
  const query = normalizeText(item.query || item.q || item.question || "");
  return {
    caseId: String(item.caseId || item.id || `case-${index + 1}`),
    query,
    expectedAnswer: String(item.expectedAnswer || item.answer || ""),
    requiredEvidenceIds: asArray(item.requiredEvidenceIds || item.evidenceIds)
      .map((id) => String(id || "").trim())
      .filter(Boolean),
    tags: asArray(item.tags),
    thresholds: asObject(item.thresholds),
    metadata: asObject(item.metadata)
  };
}

function aggregateCaseResults(caseResults = [], thresholds = {}) {
  if (!caseResults.length) {
    return {
      metrics: {
        caseCount: 0,
        recallAtK: 0,
        mrrAtK: 0,
        ndcgAtK: 0,
        gatePassRate: 0,
        unsupportedClaimRate: 0,
        conflictRate: 0
      },
      gates: {
        minRecallAtK: Number(thresholds.minRecallAtK ?? 0),
        minMrrAtK: Number(thresholds.minMrrAtK ?? 0),
        minNdcgAtK: Number(thresholds.minNdcgAtK ?? 0),
        minGatePassRate: Number(thresholds.minGatePassRate ?? 0)
      },
      passed: false
    };
  }
  const count = caseResults.length || 1;
  const metrics = {
    caseCount: caseResults.length,
    recallAtK: caseResults.reduce((sum, item) => sum + item.metrics.recallAtK, 0) / count,
    mrrAtK: caseResults.reduce((sum, item) => sum + item.metrics.mrrAtK, 0) / count,
    ndcgAtK: caseResults.reduce((sum, item) => sum + item.metrics.ndcgAtK, 0) / count,
    gatePassRate: caseResults.filter((item) => item.gate?.ok).length / count,
    unsupportedClaimRate:
      caseResults.reduce((sum, item) => sum + Number(item.gate?.metrics?.uncitedClaimCount || 0), 0) / count,
    conflictRate:
      caseResults.reduce((sum, item) => sum + Number(item.gate?.metrics?.conflictCount || 0), 0) / count
  };
  const rounded = Object.fromEntries(
    Object.entries(metrics).map(([key, value]) => [key, Number(Number(value || 0).toFixed(6))])
  );
  const gates = {
    minRecallAtK: Number(thresholds.minRecallAtK ?? 0),
    minMrrAtK: Number(thresholds.minMrrAtK ?? 0),
    minNdcgAtK: Number(thresholds.minNdcgAtK ?? 0),
    minGatePassRate: Number(thresholds.minGatePassRate ?? 0)
  };
  const passed =
    rounded.recallAtK >= gates.minRecallAtK &&
    rounded.mrrAtK >= gates.minMrrAtK &&
    rounded.ndcgAtK >= gates.minNdcgAtK &&
    rounded.gatePassRate >= gates.minGatePassRate;
  return {
    metrics: rounded,
    gates,
    passed
  };
}

export function createAgentEvaluationRuntime({ userDataPath, knowledgeAgentSkill }) {
  const rootPath = path.join(userDataPath, "agent-evaluation");
  const runsPath = path.join(rootPath, "evaluation-runs.json");

  async function readStore() {
    try {
      return JSON.parse(await fs.readFile(runsPath, "utf8"));
    } catch {
      return {
        protocolVersion: AGENT_EVALUATION_PROTOCOL_VERSION,
        runs: []
      };
    }
  }

  async function writeStore(store) {
    await fs.mkdir(rootPath, { recursive: true });
    await fs.writeFile(
      runsPath,
      JSON.stringify(
        {
          protocolVersion: AGENT_EVALUATION_PROTOCOL_VERSION,
          runs: asArray(store.runs).slice(-200)
        },
        null,
        2
      ),
      "utf8"
    );
  }

  async function generateCases(input = {}) {
    const queries = [
      ...asArray(input.queries),
      input.query,
      input.seedQuery
    ].map(normalizeText).filter(Boolean);
    const uniqueQueries = [...new Set(queries)].slice(0, Math.max(1, Math.min(Number(input.limit || 12), 100)));
    const cases = [];
    for (const [index, query] of uniqueQueries.entries()) {
      const result = await knowledgeAgentSkill.run({
        query,
        limit: Math.max(1, Math.min(Number(input.evidencePerCase || 5), 20)),
        thresholds: {
          minEvidence: 1,
          minSources: 1,
          requireCitationsForAnswer: false
        }
      });
      cases.push({
        caseId: `generated-${index + 1}`,
        query,
        expectedAnswer: "",
        requiredEvidenceIds: asArray(result.searchResult?.items).slice(0, Number(input.requiredEvidencePerCase || 1)).map((item) => item.evidenceId).filter(Boolean),
        tags: ["generated", result.plan?.intent || "unknown"],
        metadata: {
          generatedAt: nowIso(),
          gateDecision: result.gate?.decision,
          evidenceCount: result.gate?.metrics?.evidenceCount || 0
        }
      });
    }
    return {
      protocolVersion: AGENT_EVALUATION_PROTOCOL_VERSION,
      cases: cases.filter((item) => item.query && item.requiredEvidenceIds.length)
    };
  }

  async function runEvaluation(input = {}) {
    const startedAt = nowIso();
    const runId = String(input.runId || "").trim() || stableRunId("agent_eval");
    const k = Math.max(1, Math.min(Number(input.k || input.limit || 10), 100));
    const casesInput = asArray(input.cases).length
      ? asArray(input.cases)
      : (await generateCases(input)).cases;
    const cases = casesInput.map(normalizeCase).filter((item) => item.query);
    const caseResults = [];
    for (const testCase of cases) {
      const skillResult = await knowledgeAgentSkill.run({
        query: testCase.query,
        limit: k,
        retrievalProfileId: input.retrievalProfileId || input.profileId || "",
        profileKey: input.profileKey || input.retrievalProfileKey || "",
        learningEnabled: input.learningEnabled !== false,
        thresholds: {
          minEvidence: Math.max(1, testCase.requiredEvidenceIds.length || 1),
          minSources: 1,
          requireCitationsForAnswer: false,
          ...asObject(input.gateThresholds),
          ...testCase.thresholds
        }
      });
      const rankedEvidenceIds = asArray(skillResult.searchResult?.items)
        .map((item) => item.evidenceId)
        .filter(Boolean);
      caseResults.push({
        caseId: testCase.caseId,
        query: testCase.query,
        requiredEvidenceIds: testCase.requiredEvidenceIds,
        rankedEvidenceIds,
        gate: skillResult.gate,
        answerPolicy: skillResult.answerPolicy,
        metrics: {
          recallAtK: Number(recallAtK(rankedEvidenceIds, testCase.requiredEvidenceIds, k).toFixed(6)),
          mrrAtK: Number(mrrAtK(rankedEvidenceIds, testCase.requiredEvidenceIds, k).toFixed(6)),
          ndcgAtK: Number(ndcgAtK(rankedEvidenceIds, testCase.requiredEvidenceIds, k).toFixed(6))
        }
      });
    }
    const aggregate = aggregateCaseResults(caseResults, input.thresholds || {});
    const run = {
      protocolVersion: AGENT_EVALUATION_PROTOCOL_VERSION,
      runId,
      status: "completed",
      k,
      inputWindow: {
        caseCount: cases.length,
        retrievalProfileId: input.retrievalProfileId || input.profileId || "",
        learningEnabled: input.learningEnabled !== false
      },
      metrics: aggregate.metrics,
      gates: aggregate.gates,
      passed: aggregate.passed,
      caseResults,
      recommendations: aggregate.passed
        ? []
        : [
            "不要自动发布候选检索 profile；先查看低分 case。",
            "优先补充 query rewrite、领域同义词或证据覆盖。",
            "若 gatePassRate 低，调高召回 limit 或降低过严阈值后重新评估。"
          ],
      startedAt,
      finishedAt: nowIso()
    };
    const store = await readStore();
    const nextRuns = asArray(store.runs).filter((item) => item.runId !== runId);
    nextRuns.push(run);
    await writeStore({ runs: nextRuns });
    return run;
  }

  async function listRuns(input = {}) {
    const store = await readStore();
    const limit = Math.max(1, Math.min(Number(input.limit || 50), 200));
    return {
      protocolVersion: AGENT_EVALUATION_PROTOCOL_VERSION,
      runs: asArray(store.runs)
        .slice()
        .sort((left, right) => String(right.startedAt || "").localeCompare(String(left.startedAt || "")))
        .slice(0, limit)
        .map((run) => ({
          ...run,
          caseResults: undefined
        }))
    };
  }

  async function getRun(runId) {
    const store = await readStore();
    return asArray(store.runs).find((run) => run.runId === runId) || null;
  }

  return {
    protocolVersion: AGENT_EVALUATION_PROTOCOL_VERSION,
    rootPath,
    runsPath,
    generateCases,
    runEvaluation,
    listRuns,
    getRun
  };
}

export default createAgentEvaluationRuntime;
