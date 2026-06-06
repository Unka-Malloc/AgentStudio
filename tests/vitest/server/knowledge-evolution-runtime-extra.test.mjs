import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  createKnowledgeEvolutionRuntime,
  KNOWLEDGE_DISTILLATION_OPTIMIZATION_PROTOCOL_VERSION,
  KNOWLEDGE_EVOLUTION_PROTOCOL_VERSION
} from "../../../server/platform/specialized/knowledge/invocation/knowledge-evolution-runtime/index.mjs";

async function withTempDir(testCase) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pact-knowledge-evolution-"));
  try {
    return await testCase(root);
  } finally {
    await fs.rm(root, { force: true, recursive: true });
  }
}

function feedbackItems() {
  return [
    {
      feedbackId: "fb-1",
      action: "thumb_up",
      query: "contract approval",
      evidenceId: "evidence-1",
      context: {
        gold: true,
        evidenceRefs: ["evidence-2"]
      }
    },
    {
      feedbackId: "fb-ignored",
      action: "dismiss",
      query: "ignored",
      evidenceId: "evidence-ignored"
    }
  ];
}

function retrievalKnowledgeCore({ candidateProfile = null, deploymentResult = null } = {}) {
  const deployments = [];
  return {
    feedbackSince: vi.fn(() => feedbackItems()),
    getRetrievalProfile: vi.fn(() => ({ profileKey: "baseline", profileId: "profile-baseline" })),
    runLearningJob: vi.fn(async () => ({
      runId: "learning-1",
      candidateProfile,
      generatedSuggestions: candidateProfile ? [] : [{ type: "other" }]
    })),
    createRetrievalProfileDeployment: vi.fn((input) => {
      const deployment = deploymentResult || {
        deploymentId: input.deploymentId,
        profileKey: input.profileKey,
        status: input.status,
        trafficPercent: input.trafficPercent,
        metrics: input.metrics
      };
      deployments.push(deployment);
      return deployment;
    }),
    promoteRetrievalProfileDeployment: vi.fn((input) => ({ deploymentId: input.deploymentId, status: "active" })),
    rollbackRetrievalProfileDeployment: vi.fn((input) => ({ deploymentId: input.deploymentId, status: "rolled_back" })),
    listRetrievalProfileDeployments: vi.fn(() => ({
      protocolVersion: KNOWLEDGE_EVOLUTION_PROTOCOL_VERSION,
      deployments
    })),
    auditHierarchyIndex: vi.fn(() => ({
      ok: true,
      findings: [{ id: "finding-1" }],
      suggestions: [{ id: "suggestion-1" }]
    }))
  };
}

function evaluationRuntime({ passed = true, candidateMetrics = {} } = {}) {
  return {
    runEvaluation: vi.fn(async ({ runId, profileKey, retrievalProfileId }) => {
      const candidate = String(runId || "").includes("candidate");
      return {
        runId,
        passed: candidate ? passed : true,
        profileKey,
        retrievalProfileId,
        metrics: candidate
          ? {
              recallAtK: 0.91,
              mrrAtK: 0.82,
              ndcgAtK: 0.8,
              gatePassRate: 1,
              unsupportedClaimRate: 0,
              conflictRate: 0,
              ...candidateMetrics
            }
          : {
              recallAtK: 0.8,
              mrrAtK: 0.7,
              ndcgAtK: 0.65,
              gatePassRate: 0.9,
              unsupportedClaimRate: 0.01,
              conflictRate: 0.02
            },
        caseResults: [{ caseId: "case-1", passed: true }]
      };
    })
  };
}

function modelDecisionRuntime() {
  return {
    describe: vi.fn(() => ({
      roles: [
        { roleId: "failure_attributor" },
        { roleId: "profile_proposer" },
        { roleId: "hierarchy_quality_reviewer" }
      ]
    })),
    decide: vi.fn(async ({ roleId }) => ({
      roleId,
      decision: { ok: true, reason: roleId }
    }))
  };
}

describe("knowledge evolution runtime", () => {
  it("describes runtime policy and returns unavailable when core dependencies are missing", async () => {
    await withTempDir(async (userDataPath) => {
      const runtime = createKnowledgeEvolutionRuntime({
        userDataPath,
        modelDecisionRuntime: modelDecisionRuntime()
      });

      expect(runtime.describe()).toMatchObject({
        protocolVersion: KNOWLEDGE_EVOLUTION_PROTOCOL_VERSION,
        policy: {
          requiresEvaluationBeforeActivation: true,
          canonicalKnowledgeMutationAllowed: false
        },
        modelRoles: expect.any(Array)
      });
      await expect(runtime.runEvolution({ runId: "missing-runtime" })).resolves.toMatchObject({
        ok: false,
        status: "unavailable"
      });
      await expect(runtime.promote({ deploymentId: "d-1" })).resolves.toMatchObject({
        ok: false,
        status: "unavailable"
      });
      await expect(runtime.rollback({ deploymentId: "d-1" })).resolves.toMatchObject({
        ok: false,
        status: "unavailable"
      });
      expect(runtime.listDeployments()).toMatchObject({ deployments: [] });
    });
  });

  it("handles retrieval-profile no-candidate, missing-cases, successful canary, list, get, promote, and rollback", async () => {
    await withTempDir(async (userDataPath) => {
      const decisions = modelDecisionRuntime();
      const coreWithoutCandidate = retrievalKnowledgeCore();
      const runtimeWithoutCandidate = createKnowledgeEvolutionRuntime({
        userDataPath,
        knowledgeCore: coreWithoutCandidate,
        agentEvaluationRuntime: evaluationRuntime(),
        modelDecisionRuntime: decisions
      });

      await expect(runtimeWithoutCandidate.runEvolution({ runId: "no-candidate" })).resolves.toMatchObject({
        ok: false,
        status: "no_candidate_profile",
        caseCount: 1
      });

      const candidateProfile = { profileKey: "candidate", profileId: "profile-candidate", topK: 12 };
      const core = retrievalKnowledgeCore({ candidateProfile });
      const runtime = createKnowledgeEvolutionRuntime({
        userDataPath,
        knowledgeCore: core,
        agentEvaluationRuntime: evaluationRuntime(),
        modelDecisionRuntime: decisions
      });

      await expect(runtime.runEvolution({
        runId: "needs-cases",
        cases: [],
        minCaseCount: 2
      })).resolves.toMatchObject({
        ok: false,
        status: "evaluation_failed",
        caseCount: 1
      });

      const success = await runtime.runEvolution({
        runId: "retrieval-success",
        cases: [{ caseId: "case-1", query: "contract", requiredEvidenceIds: ["evidence-1"] }],
        canaryTrafficPercent: 25,
        regressionThresholds: {
          minRecallDelta: 0.01,
          maxUnsupportedClaimDelta: 0
        }
      });
      expect(success).toMatchObject({
        ok: true,
        status: "canary_published",
        stages: {
          feedbackCollected: true,
          failuresAttributed: true,
          offlineEvaluated: true,
          canaryPublished: true
        },
        deployment: {
          deploymentId: "retrieval-success-canary",
          trafficPercent: 25
        },
        hierarchyAudit: {
          protocolVersion: KNOWLEDGE_EVOLUTION_PROTOCOL_VERSION,
          audit: { ok: true },
          modelDecision: expect.objectContaining({ roleId: "hierarchy_quality_reviewer" })
        }
      });
      expect(core.createRetrievalProfileDeployment).toHaveBeenCalledWith(expect.objectContaining({
        status: "canary",
        reason: "offline_evaluation_passed"
      }));

      const active = await runtime.runEvolution({
        runId: "retrieval-active",
        cases: [{ caseId: "case-2", query: "approval", requiredEvidenceIds: ["evidence-2"] }],
        publishMode: "active"
      });
      expect(active.status).toBe("canary_published");
      expect(core.promoteRetrievalProfileDeployment).toHaveBeenCalledWith(expect.objectContaining({
        deploymentId: "retrieval-active-canary",
        reason: "explicit_active_publish_after_evaluation"
      }));

      const listed = await runtime.listRuns({ limit: 10 });
      expect(listed.runs.map((run) => run.runId)).toEqual(expect.arrayContaining([
        "no-candidate",
        "needs-cases",
        "retrieval-success",
        "retrieval-active"
      ]));
      expect(listed.runs.find((run) => run.runId === "retrieval-success").candidateEvaluation.caseResults)
        .toBeUndefined();
      await expect(runtime.getRun("retrieval-success")).resolves.toMatchObject({
        runId: "retrieval-success",
        candidateEvaluation: {
          caseResults: expect.any(Array)
        }
      });
      await expect(runtime.auditHierarchy({ modelEnabled: true })).resolves.toMatchObject({
        audit: { ok: true },
        modelDecision: { roleId: "hierarchy_quality_reviewer" }
      });
      expect(runtime.listDeployments()).toMatchObject({ deployments: expect.any(Array) });
      await expect(runtime.promote({ deploymentId: "retrieval-success-canary" })).resolves.toMatchObject({
        ok: true,
        status: "promoted"
      });
      await expect(runtime.rollback({ deploymentId: "retrieval-success-canary" })).resolves.toMatchObject({
        ok: true,
        status: "rolled_back"
      });
    });
  });

  it("handles knowledge SkillSet distillation failure, success, and external service errors", async () => {
    await withTempDir(async (userDataPath) => {
      const core = retrievalKnowledgeCore();
      const decisions = modelDecisionRuntime();
      const distillationService = {
        createRun: vi.fn(async ({ runId }) => ({
          runId,
          candidates: [{ skillId: "skill-contract-approval" }]
        }))
      };
      const goldenRuleRuntime = {
        listGoldCases: vi.fn(async () => ({
          items: [{ caseId: "gold-1", query: "contract", requiredEvidenceIds: ["evidence-1"] }]
        }))
      };
      let evaluationPassed = false;
      const knowledgeSkillRuntime = {
        runSkillEvaluation: vi.fn(async ({ runId, cases }) => ({
          runId,
          cases,
          passed: evaluationPassed,
          metrics: {
            recallAtK: evaluationPassed ? 0.92 : 0.1,
            mrrAtK: evaluationPassed ? 0.8 : 0.1,
            ndcgAtK: evaluationPassed ? 0.78 : 0.1,
            gatePassRate: evaluationPassed ? 1 : 0,
            unsupportedClaimRate: evaluationPassed ? 0 : 0.5,
            conflictRate: evaluationPassed ? 0 : 0.4
          }
        })),
        createSkillDeployment: vi.fn(async (input) => ({
          deploymentId: input.deploymentId,
          skillIds: input.skillIds,
          status: input.status,
          trafficPercent: input.trafficPercent,
          evaluationRunId: input.evaluationRunId
        }))
      };
      const runtime = createKnowledgeEvolutionRuntime({
        userDataPath,
        knowledgeCore: core,
        agentEvaluationRuntime: evaluationRuntime(),
        modelDecisionRuntime: decisions,
        knowledgeDistillationService: distillationService,
        goldenRuleRuntime,
        knowledgeSkillRuntime
      });

      const failed = await runtime.runEvolution({
        runId: "skillset-failed",
        target: "knowledgeSkillSet",
        promptVersion: "prompt:v1",
        evaluationDatasetVersion: "gold:v1"
      });
      expect(failed).toMatchObject({
        ok: false,
        status: "skillset_evaluation_failed",
        distillationOptimization: {
          protocolVersion: KNOWLEDGE_DISTILLATION_OPTIMIZATION_PROTOCOL_VERSION,
          humanReview: {
            required: true,
            reasons: expect.arrayContaining(["evaluation_failed", "not_published_to_canary"])
          }
        },
        distillationService: {
          ok: true,
          error: null
        }
      });

      evaluationPassed = true;
      const passed = await runtime.runEvolution({
        runId: "skillset-passed",
        target: "knowledgeSkillSet",
        promptVersion: "prompt:v2",
        canaryTrafficPercent: 40
      });
      expect(passed).toMatchObject({
        ok: true,
        status: "skillset_canary_published",
        deployment: {
          deploymentId: "skillset-passed-skillset-canary",
          skillIds: ["skill-contract-approval"],
          trafficPercent: 40
        },
        distillationOptimization: {
          candidate: {
            skillIds: ["skill-contract-approval"],
            deploymentId: "skillset-passed-skillset-canary"
          },
          regressionTrend: {
            previousRunCount: 1
          },
          humanReview: {
            required: false
          }
        }
      });
      expect(knowledgeSkillRuntime.createSkillDeployment).toHaveBeenCalledWith(expect.objectContaining({
        status: "canary",
        trafficPercent: 40,
        force: false
      }));

      const serviceError = Object.assign(new Error("distillation unavailable"), {
        statusCode: 503,
        externalServiceCall: { serviceId: "external.knowledge.distillation" }
      });
      distillationService.createRun = vi.fn(async () => {
        throw serviceError;
      });
      const errored = await runtime.runEvolution({
        runId: "skillset-service-error",
        target: "knowledgeSkillSet",
        publish: false
      });
      expect(errored).toMatchObject({
        status: "skillset_evaluation_passed",
        distillationRun: null,
        distillationService: {
          ok: false,
          error: {
            message: "distillation unavailable",
            statusCode: 503,
            service: "external.knowledge.distillation"
          }
        },
        distillationOptimization: {
          candidate: {
            skillIds: [],
            deploymentId: ""
          },
          humanReview: {
            required: true,
            reasons: expect.arrayContaining(["not_published_to_canary"])
          }
        }
      });
    });
  });
});
