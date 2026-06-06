#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createKnowledgeEvolutionRuntime,
  KNOWLEDGE_DISTILLATION_OPTIMIZATION_PROTOCOL_VERSION,
  KNOWLEDGE_EVOLUTION_PROTOCOL_VERSION
} from "../platform/specialized/knowledge/invocation/knowledge-evolution-runtime/index.mjs";

const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-distillation-optimization-"));

let evaluationCount = 0;
const knowledgeCore = {
  feedbackSince() {
    return [
      {
        feedbackId: "fb-1",
        query: "contract approval",
        action: "expert_feedback",
        evidenceId: "ev-1",
        context: {
          humanExpert: true
        }
      }
    ];
  }
};
const agentEvaluationRuntime = {
  async runEvaluation() {
    return { metrics: {}, passed: true };
  }
};
const modelDecisionRuntime = {
  describe() {
    return { roles: [{ roleId: "failure_attributor" }] };
  },
  async decide(input = {}) {
    return {
      roleId: input.roleId,
      usedModel: false,
      decision: {
        primaryCause: "missing_skill_case",
        confidence: 0.82
      }
    };
  }
};
const knowledgeDistillationService = {
  service: "external.knowledge.distillation",
  async createRun(input = {}) {
    return {
      service: "external.knowledge.distillation",
      runId: input.runId,
      candidates: [
        {
          skill: {
            skillId: "skill-contract-approval"
          }
        }
      ]
    };
  }
};
const goldenRuleRuntime = {
  async listGoldCases() {
    return {
      items: [
        {
          caseId: "gold-contract-approval",
          query: "contract approval",
          requiredEvidenceIds: ["ev-1"]
        }
      ]
    };
  }
};
const knowledgeSkillRuntime = {
  async runSkillEvaluation(input = {}) {
    evaluationCount += 1;
    const passed = evaluationCount > 1;
    return {
      runId: input.runId,
      passed,
      metrics: passed
        ? { passRate: 1, coverage: 0.9, unsupportedClaimRate: 0 }
        : { passRate: 0, coverage: 0.2, unsupportedClaimRate: 0.4 }
    };
  },
  async createSkillDeployment(input = {}) {
    return {
      deploymentId: input.deploymentId,
      skillIds: input.skillIds,
      status: input.status,
      trafficPercent: input.trafficPercent,
      evaluationRunId: input.evaluationRunId,
      metrics: input.metrics
    };
  }
};

try {
  const runtime = createKnowledgeEvolutionRuntime({
    userDataPath,
    knowledgeCore,
    agentEvaluationRuntime,
    modelDecisionRuntime,
    knowledgeDistillationService,
    goldenRuleRuntime,
    knowledgeSkillRuntime
  });

  const first = await runtime.runEvolution({
    runId: "distill-opt-1",
    target: "knowledgeSkillSet",
    modelAlias: "deepseek-v4-flash",
    promptVersion: "prompt:v1",
    evaluationDatasetVersion: "gold:v1"
  });
  assert.equal(first.protocolVersion, KNOWLEDGE_EVOLUTION_PROTOCOL_VERSION);
  assert.equal(first.status, "skillset_evaluation_failed");
  assert.equal(first.distillationOptimization.protocolVersion, KNOWLEDGE_DISTILLATION_OPTIMIZATION_PROTOCOL_VERSION);
  assert.equal(first.distillationService.service, "external.knowledge.distillation");
  assert.equal(first.stages.externalDistillationServiceCalled, true);
  assert.equal(first.distillationOptimization.promptVersion, "prompt:v1");
  assert.equal(first.distillationOptimization.evaluationDataset.caseCount, 1);
  assert.equal(first.distillationOptimization.errorAttribution.available, true);
  assert.equal(first.distillationOptimization.humanReview.required, true);
  assert.ok(first.distillationOptimization.humanReview.reasons.includes("evaluation_failed"));

  const second = await runtime.runEvolution({
    runId: "distill-opt-2",
    target: "knowledgeSkillSet",
    modelAlias: "deepseek-v4-flash",
    promptVersion: "prompt:v2",
    evaluationDatasetVersion: "gold:v1",
    canaryTrafficPercent: 25
  });
  assert.equal(second.status, "skillset_canary_published");
  assert.equal(second.deployment.status, "canary");
  assert.equal(second.distillationOptimization.candidate.skillIds[0], "skill-contract-approval");
  assert.equal(second.distillationOptimization.candidate.deploymentId, "distill-opt-2-skillset-canary");
  assert.equal(second.distillationOptimization.regressionTrend.previousRunCount, 1);
  assert.equal(second.distillationOptimization.regressionTrend.latest.passed, true);
  assert.equal(second.distillationOptimization.humanReview.required, false);

  const runs = await runtime.listRuns({ limit: 10 });
  assert.equal(runs.runs.some((run) => run.runId === "distill-opt-1"), true);
  assert.equal(runs.runs.some((run) => run.runId === "distill-opt-2"), true);

  console.log("[knowledge-distillation-optimization] ok");
} finally {
  if (process.env.PACT_KEEP_TEST_DATA !== "1") {
    await fs.rm(userDataPath, { recursive: true, force: true });
  } else {
    console.log(`kept test data: ${userDataPath}`);
  }
}
