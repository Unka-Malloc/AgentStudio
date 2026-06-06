import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  KNOWLEDGE_SKILL_PROTOCOL_VERSION,
  createKnowledgeSkillRuntime
} from "../../../server/platform/specialized/knowledge/invocation/knowledge-skill-runtime/index.mjs";

afterEach(() => {
  vi.restoreAllMocks();
});

function longText(seed, repeatCount = 40) {
  return Array.from({ length: repeatCount }, () => seed).join(" ");
}

function createKnowledgeCoreFixture({
  missingEvidenceIds = new Set()
} = {}) {
  const chatEvidence = {
    evidenceId: "ev-chat-1",
    itemId: "doc-chat-1",
    documentId: "doc-chat-1",
    title: "Payment reconciliation note",
    snippet: longText("Chat explains the reconciliation workflow.", 20),
    score: 0.98,
    hierarchy: { selected: true },
    modalities: ["text"],
    reasons: ["chat"],
    sourceLocator: {
      sourceType: "chat",
      providerId: "slack",
      externalId: "chat-external-1",
      syncBatchId: "batch-chat-1",
      sourcePath: "chat://workspace/conv-1/msg-1",
      chatRef: {
        providerId: "slack",
        workspaceId: "workspace-1",
        conversationId: "conv-1",
        messageId: "msg-1",
        externalId: "chat-external-1",
        syncBatchId: "batch-chat-1"
      }
    }
  };

  const fileEvidence = {
    evidenceId: "ev-file-2",
    itemId: "doc-file-2",
    documentId: "doc-file-2",
    title: "Payment ledger export",
    snippet: longText("CSV export with linked rows.", 22),
    score: 0.91,
    hierarchy: { selected: true },
    modalities: ["file"],
    reasons: ["file"],
    sourceLocator: {
      sourceType: "file",
      providerId: "gdrive",
      externalId: "file-external-2",
      syncBatchId: "batch-file-2",
      sourcePath: "file:///exports/ledger.csv",
      fileRef: {
        providerId: "gdrive",
        externalId: "file-external-2",
        originalFileName: "ledger.csv",
        storageRelativePath: "exports/ledger.csv",
        contentHash: "hash-abc-123",
        syncBatchId: "batch-file-2"
      }
    }
  };

  const unknownEvidence = {
    evidenceId: "ev-unknown-3",
    title: "Untyped evidence fragment",
    snippet: longText("This fragment intentionally lacks a source locator.", 24),
    score: 0.7,
    hierarchy: null,
    modalities: ["text"],
    reasons: ["unknown"]
  };

  const searchItems = [chatEvidence, fileEvidence, unknownEvidence];

  const evidenceById = {
    "ev-chat-1": {
      evidenceId: "ev-chat-1",
      title: "Payment reconciliation note",
      snippet: "Expanded chat evidence for the reconciliation flow.",
      locator: chatEvidence.sourceLocator,
      payload: {
        document: {
          documentId: "doc-chat-1",
          documentType: "chat",
          sourcePath: "chat://workspace/conv-1/msg-1",
          title: "Payment reconciliation note"
        },
        blocks: [
          { text: "The team confirmed the reconciliation workflow is stable." },
          { snippet: "A second block uses snippet fallback to verify normalization." }
        ]
      }
    },
    "ev-file-2": {
      evidenceId: "ev-file-2",
      title: "Payment ledger export",
      snippet: "Expanded file evidence for the reconciliation ledger.",
      sourceLocator: fileEvidence.sourceLocator,
      payload: {
        document: {
          documentId: "doc-file-2",
          documentType: "file",
          sourcePath: "file:///exports/ledger.csv",
          title: "Payment ledger export"
        },
        blocks: [
          { text: "Ledger rows with matching identifiers and total amounts." },
          { text: longText("The file evidence block is intentionally verbose to hit truncation.", 30) }
        ]
      }
    }
  };

  const search = vi.fn(async (input = {}) => ({
    query: input.query,
    count: searchItems.length,
    hierarchy: { selected: true },
    items: searchItems
  }));

  const getEvidence = vi.fn(async ({ evidenceId }) => {
    if (missingEvidenceIds.has(evidenceId)) {
      throw new Error(`missing evidence: ${evidenceId}`);
    }
    return evidenceById[evidenceId] || null;
  });

  return { search, getEvidence };
}

async function withRuntime({ core = null, modelDecisionRuntime = null } = {}, callback) {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-knowledge-skill-runtime-extra-"));
  const runtime = createKnowledgeSkillRuntime({
    userDataPath,
    runtime: core ? { mounts: { knowledgeBase: core } } : { mounts: {} },
    modelDecisionRuntime
  });
  try {
    return await callback({ runtime, userDataPath });
  } finally {
    runtime.close();
    await fs.rm(userDataPath, { recursive: true, force: true });
  }
}

function customFramework() {
  return {
    frameworkId: "  custom knowledge skill framework  ",
    version: "3",
    qualityGates: {
      minEvidence: 2,
      minDistinctDocuments: 2,
      requireCitations: true,
      requireHierarchy: true,
      minQualityScore: 0.6
    },
    termExtraction: {
      minTokenLength: 2,
      maxTokenLength: 64,
      stopWords: ["  workflow  "]
    },
    fallbackTemplates: {
      titleTemplate: "Skill for {{query}}",
      summaryParts: [
        "Query={{query}}",
        "Evidence={{evidenceCount}}",
        "Hierarchy={{hierarchyStatus}}"
      ],
      useWhen: ["Use when {{query}}"],
      avoidWhen: ["Avoid when there are no citations"],
      decisionHeuristics: ["Prefer {{titles}}"],
      honestBoundaries: ["Bounded by {{hierarchyStatus}}"],
      hierarchyStatus: {
        available: "hierarchy-ready",
        missing: "hierarchy-missing"
      }
    },
    agentCreation: {
      defaultStatus: "  draft  ",
      autoPublishAllowed: true,
      allowedSourceTypes: ["  agent_exploration  ", ""],
      requiredFields: [" title ", " summary ", " decisionHeuristics ", " honestBoundaries ", " evidenceRefs "],
      blockedFields: [" canonicalPatch "],
      reuseSignals: [" reuse signal "],
      recommendationMessages: {
        blockedCanonicalMutations: " blocked canonical mutation ",
        evidenceRefsResolved: " evidence refs resolved ",
        sourceTypeAllowed: " source type allowed ",
        requiredFieldMissing: " required field missing "
      },
      reviewPolicy: " review policy "
    },
    defaultHeuristicTemplates: [" default heuristic "],
    defaultAntiPatterns: [" default anti-pattern "],
    defaultBoundaryRules: [" default boundary "],
    verificationQuestionTemplates: [" What supports {{title}}? "]
  };
}

describe("knowledge skill runtime extra coverage", () => {
  it("loads the default framework, normalizes overrides, and describes the runtime", async () => {
    await withRuntime({}, async ({ runtime, userDataPath }) => {
      const defaultFramework = await runtime.loadFramework();
      expect(defaultFramework.frameworkId).toBe("pact.default-knowledge-skill-framework");
      expect(defaultFramework.layers).toHaveLength(5);

      const description = runtime.describe();
      expect(description).toMatchObject({
        protocolVersion: KNOWLEDGE_SKILL_PROTOCOL_VERSION,
        name: "pact.knowledge.skill-runtime",
        policies: {
          canonicalWritesAllowed: false,
          publishedSkillRequiresQualityGate: true,
          evidenceRefsRequired: true,
          modelUseRequiresExplicitEnable: true
        }
      });
      expect(description.storagePath).toContain(path.join(userDataPath, "knowledge-skills"));

      await runtime.saveFramework(customFramework());
      const framework = await runtime.loadFramework();
      expect(framework).toMatchObject({
        frameworkId: "custom knowledge skill framework",
        version: 3,
        qualityGates: {
          minEvidence: 2,
          minDistinctDocuments: 2,
          requireCitations: true,
          requireHierarchy: true,
          minQualityScore: 0.6
        },
        termExtraction: {
          minTokenLength: 2,
          maxTokenLength: 64,
          stopWords: ["workflow"]
        },
        fallbackTemplates: {
          titleTemplate: "Skill for {{query}}",
          hierarchyStatus: {
            available: "hierarchy-ready",
            missing: "hierarchy-missing"
          }
        },
        agentCreation: {
          defaultStatus: "draft",
          autoPublishAllowed: true,
          allowedSourceTypes: ["agent_exploration"],
          requiredFields: ["title", "summary", "decisionHeuristics", "honestBoundaries", "evidenceRefs"],
          blockedFields: ["canonicalPatch"],
          reuseSignals: ["reuse signal"],
          recommendationMessages: {
            blockedCanonicalMutations: "blocked canonical mutation",
            evidenceRefsResolved: "evidence refs resolved",
            sourceTypeAllowed: "source type allowed",
            requiredFieldMissing: "required field missing"
          },
          reviewPolicy: "review policy"
        }
      });
      expect(framework.defaultHeuristicTemplates).toEqual(["default heuristic"]);
      expect(framework.defaultAntiPatterns).toEqual(["default anti-pattern"]);
      expect(framework.defaultBoundaryRules).toEqual(["default boundary"]);
      expect(framework.verificationQuestionTemplates).toEqual(["What supports {{title}}?"]);
    });
  });

  it("generates a default published skill, builds source traces, and persists a bundle", async () => {
    const core = createKnowledgeCoreFixture();
    await withRuntime({ core }, async ({ runtime, userDataPath }) => {
      await runtime.saveFramework(customFramework());

      const result = await runtime.generateSkill({
        query: "payment reconciliation",
        publish: true,
        allowDirectPublish: true,
        limit: 3,
        maxOpenedEvidence: 2
      });

      expect(core.search).toHaveBeenCalledTimes(1);
      expect(core.getEvidence).toHaveBeenCalledTimes(2);
      expect(result).toMatchObject({
        protocolVersion: KNOWLEDGE_SKILL_PROTOCOL_VERSION,
        ok: true,
        statusReason: "quality_gate_passed_and_direct_publish_allowed",
        qualityReport: {
          passed: true,
          evidenceCount: 3,
          distinctDocumentCount: 2
        }
      });
      expect(result.skill).toMatchObject({
        status: "published",
        title: "Skill for payment reconciliation",
        summary: "Query=payment reconciliation Evidence=3 Hierarchy=hierarchy-ready",
        evidenceRefs: ["ev-chat-1", "ev-file-2", "ev-unknown-3"]
      });
      expect(result.skill.skill.applicability).toEqual({
        useWhen: ["Use when payment reconciliation"],
        avoidWhen: ["Avoid when there are no citations"]
      });
      expect(result.skill.skill.decisionHeuristics).toEqual([
        "default heuristic",
        "Prefer Payment reconciliation note；Payment ledger export；Untyped evidence fragment"
      ]);
      expect(result.skill.skill.honestBoundaries).toEqual([
        "default boundary",
        "Bounded by hierarchy-ready"
      ]);
      expect(result.skill.skill.verificationQuestions).toEqual([
        "What supports Skill for payment reconciliation?"
      ]);
      expect(result.openedEvidence).toHaveLength(2);
      expect(result.openedEvidence[0]).toMatchObject({
        evidenceId: "ev-chat-1",
        documentId: "doc-chat-1",
        documentType: "chat",
        sourcePath: "chat://workspace/conv-1/msg-1"
      });
      expect(result.openedEvidence[0].text).toContain("The team confirmed the reconciliation workflow");
      expect(result.searchResult.items).toHaveLength(3);
      expect(result.searchResult.items[0].sourceKey).toMatch(/^chat:/);
      expect(result.searchResult.items[1].sourceKey).toMatch(/^file:/);
      expect(result.searchResult.items[2].sourceKey).toBe("unknown-source");
      expect(result.qualityReport.sourceTrace).toMatchObject({
        sourceCount: 3,
        sourceTypes: ["chat", "file"],
        providerIds: ["gdrive", "slack"],
        syncBatchIds: ["batch-chat-1", "batch-file-2"]
      });

      const storedSkill = runtime.getSkill(result.skill.skillId);
      expect(storedSkill).toMatchObject({
        skillId: result.skill.skillId,
        status: "published",
        publishedAt: expect.any(String)
      });

      const bundleRoot = path.join(userDataPath, "knowledge-skills", "bundles");
      const [bundleDir] = await fs.readdir(bundleRoot);
      const bundlePath = path.join(bundleRoot, bundleDir);
      const manifest = JSON.parse(await fs.readFile(path.join(bundlePath, "manifest.json"), "utf8"));
      const quality = JSON.parse(await fs.readFile(path.join(bundlePath, "quality.json"), "utf8"));
      const readme = await fs.readFile(path.join(bundlePath, "README.md"), "utf8");
      expect(manifest).toMatchObject({
        bundleType: "pact.knowledge-skill.bundle",
        skillId: result.skill.skillId,
        status: "published"
      });
      expect(quality).toMatchObject({
        protocolVersion: KNOWLEDGE_SKILL_PROTOCOL_VERSION,
        skillId: result.skill.skillId
      });
      expect(readme).toContain(result.skill.skillId);

      const search = runtime.searchSkills({ query: "payment reconciliation", limit: 3 });
      expect(search.items[0]).toMatchObject({
        skillId: result.skill.skillId,
        matchScore: 1
      });

      const context = runtime.buildContextForQuery({ query: "payment reconciliation", limit: 1 });
      expect(context.skills[0]).toMatchObject({
        skillId: result.skill.skillId,
        title: "Skill for payment reconciliation"
      });
    });
  });

  it("normalizes model decisions and falls back when the model rejects the role", async () => {
    const core = createKnowledgeCoreFixture();
    const modelDecisionRuntime = {
      decide: vi.fn()
        .mockResolvedValueOnce({
          decision: {
            skill: {
              title: "  Model-led title  ",
              summary: "  Model-led summary  ",
              applicability: {
                useWhen: ["  use model judgment  "],
                avoidWhen: ["  avoid unsupported input  "]
              },
              coreConcepts: [
                { term: "  model concept  ", weight: "2", evidenceRefs: ["ev-chat-1", "ev-chat-1"] },
                " secondary concept "
              ],
              decisionHeuristics: ["  model heuristic  "],
              antiPatterns: ["  model anti-pattern  "],
              honestBoundaries: ["  model boundary  "],
              verificationQuestions: ["  model question  "],
              evidenceRefs: ["ev-chat-1", "ev-file-2", "ev-chat-1"]
            }
          }
        })
        .mockResolvedValueOnce({
          decision: {
            skill: {
              verdict: "unsupported_role"
            }
          }
        })
    };

    await withRuntime({ core, modelDecisionRuntime }, async ({ runtime }) => {
      await runtime.saveFramework(customFramework());

      const supported = await runtime.generateSkill({
        query: "payment reconciliation",
        limit: 2,
        maxOpenedEvidence: 2,
        modelEnabled: true
      });

      expect(modelDecisionRuntime.decide).toHaveBeenCalledTimes(1);
      expect(supported.skill).toMatchObject({
        title: "Model-led title",
        summary: "Model-led summary",
        status: "pending_review",
        evidenceRefs: ["ev-chat-1", "ev-file-2", "ev-unknown-3"]
      });
      expect(supported.skill.skill.applicability).toEqual({
        useWhen: ["  use model judgment  "],
        avoidWhen: ["  avoid unsupported input  "]
      });
      expect(supported.skill.skill.decisionHeuristics).toEqual(["model heuristic"]);
      expect(supported.skill.skill.antiPatterns).toEqual(["model anti-pattern"]);
      expect(supported.skill.skill.honestBoundaries).toEqual(["model boundary"]);
      expect(supported.skill.skill.verificationQuestions).toEqual(["model question"]);
      expect(supported.skill.skill.coreConcepts).toEqual([
        { term: "  model concept  ", weight: "2", evidenceRefs: ["ev-chat-1", "ev-chat-1"] },
        " secondary concept "
      ]);
      expect(supported.statusReason).toBe("quality_gate_passed_pending_review_until_skillset_deployment");
      expect(supported.qualityReport.passed).toBe(true);

      const fallback = await runtime.generateSkill({
        query: "payment reconciliation",
        limit: 2,
        maxOpenedEvidence: 2,
        modelEnabled: true
      });

      expect(modelDecisionRuntime.decide).toHaveBeenCalledTimes(2);
      expect(fallback.skill).toMatchObject({
        title: "Skill for payment reconciliation",
        status: "pending_review"
      });
      expect(fallback.skill.skill.applicability).toEqual({
        useWhen: ["Use when payment reconciliation"],
        avoidWhen: ["Avoid when there are no citations"]
      });
      expect(fallback.skill.skill.decisionHeuristics[0]).toBe("default heuristic");
      expect(runtime.getSkill(fallback.skill.skillId).version).toBe(2);
    });
  });

  it("persists proposal quality, handles resolution actions, and supports force publish", async () => {
    const core = createKnowledgeCoreFixture({
      missingEvidenceIds: new Set(["missing-404"])
    });

    await withRuntime({ core }, async ({ runtime }) => {
      await runtime.saveFramework(customFramework());

      const proposal = await runtime.proposeSkill({
        query: "workflow guard",
        evidenceRefs: ["ev-chat-1"],
        proposal: {
          title: "  Workflow Guard  ",
          summary: "  Keep workflow data safe  ",
          applicability: {
            useWhen: ["  when a workflow is sensitive  "],
            avoidWhen: ["  when canonical data must be rewritten  "]
          },
          coreConcepts: [
            " workflow ",
            { label: " Guardrails ", weight: "2", evidenceRefs: ["ev-file-2"] }
          ],
          decisionHeuristics: ["  check source type  "],
          antiPatterns: ["  do not mutate canonical data  "],
          honestBoundaries: ["  human review required  "],
          verificationQuestions: ["  which evidence supports this?  "],
          evidenceRefs: ["ev-chat-1", "missing-404", "ev-file-2"],
          canonicalPatch: { should: "be rejected" },
          sourceType: "agent_exploration",
          hierarchy: { selected: true },
          agentId: "agent-7",
          runId: "run-8",
          reuseReason: "reused"
        },
        maxOpenedEvidence: 3
      });

      expect(core.getEvidence).toHaveBeenCalledTimes(3);
      expect(proposal).toMatchObject({
        protocolVersion: KNOWLEDGE_SKILL_PROTOCOL_VERSION,
        ok: true,
        statusReason: "quality_gate_requires_review"
      });
      expect(proposal.qualityReport).toMatchObject({
        passed: false,
        sourceTrace: {
          sourceCount: 2
        }
      });
      expect(proposal.qualityReport.recommendations).toContain("blocked canonical mutation");
      expect(proposal.creationReport).toMatchObject({
        sourceType: "agent_exploration",
        blockedFields: ["canonicalPatch"]
      });
      expect(proposal.skill).toMatchObject({
        status: "draft",
        title: "Workflow Guard",
        summary: "Keep workflow data safe"
      });
      expect(proposal.skill.skill.coreConcepts).toEqual([
        { term: "workflow", weight: 1, evidenceRefs: [] },
        { term: "Guardrails", weight: 2, evidenceRefs: ["ev-file-2"] }
      ]);

      const publishRejected = runtime.resolveSkill({
        skillId: proposal.skill.skillId,
        action: "publish"
      });
      expect(publishRejected).toMatchObject({
        ok: false,
        error: "quality_gate_not_passed"
      });

      const reject = runtime.resolveSkill({
        skillId: proposal.skill.skillId,
        action: "reject"
      });
      expect(reject).toMatchObject({
        ok: true,
        action: "reject",
        skill: {
          status: "rejected"
        }
      });

      const archive = runtime.resolveSkill({
        skillId: proposal.skill.skillId,
        action: "archive"
      });
      expect(archive.skill.status).toBe("archived");

      const draft = runtime.resolveSkill({
        skillId: proposal.skill.skillId,
        action: "draft"
      });
      expect(draft.skill.status).toBe("draft");

      const forcedPublish = runtime.resolveSkill({
        skillId: proposal.skill.skillId,
        action: "publish",
        force: true
      });
      expect(forcedPublish).toMatchObject({
        ok: true,
        action: "publish",
        skill: {
          status: "published"
        }
      });
      expect(runtime.getSkill(proposal.skill.skillId)).toMatchObject({
        status: "published",
        publishedAt: expect.any(String)
      });

      expect(runtime.resolveSkill({
        skillId: "missing-skill",
        action: "publish"
      })).toBeNull();

      expect(runtime.resolveSkill({
        skillId: proposal.skill.skillId,
        action: "shelve"
      })).toMatchObject({
        ok: false,
        error: "unsupported_skill_resolution"
      });
    });
  });

  it("runs evaluations, records deployments, and rolls them back", async () => {
    const core = createKnowledgeCoreFixture();

    await withRuntime({ core }, async ({ runtime }) => {
      await runtime.saveFramework(customFramework());

      const generated = await runtime.generateSkill({
        query: "payment reconciliation",
        publish: true,
        allowDirectPublish: true,
        limit: 3,
        maxOpenedEvidence: 2
      });

      const fallbackContext = runtime.buildContextForQuery({
        query: "payment reconciliation",
        limit: 2
      });
      expect(fallbackContext.skills[0]).toMatchObject({
        skillId: generated.skill.skillId,
        title: "Skill for payment reconciliation"
      });

      const search = runtime.searchSkills({
        query: "payment reconciliation",
        limit: 2
      });
      expect(search.items[0]).toMatchObject({
        skillId: generated.skill.skillId,
        matchScore: 1
      });

      const failedRun = await runtime.runSkillEvaluation({
        runId: "run-failed",
        cases: [
          {
            caseId: "case-failed",
            query: "unrelated topic",
            expectedSkillId: generated.skill.skillId,
            requiredEvidenceIds: ["missing-evidence"],
            forbiddenEvidenceIds: ["ev-file-2", "ev-file-2"]
          }
        ],
        thresholds: {
          minSkillHitRate: 1,
          minEvidenceRecall: 1,
          maxForbiddenEvidenceHitRate: 0
        },
        k: 2,
        skillSetVersion: "v1"
      });
      expect(failedRun).toMatchObject({
        runId: "run-failed",
        status: "completed",
        passed: false,
        metrics: {
          skillHitRate: 0,
          evidenceRecall: 0
        }
      });

      expect(await runtime.createSkillDeployment({
        skillIds: [generated.skill.skillId],
        evaluationRunId: failedRun.runId
      })).toMatchObject({
        ok: false,
        error: "skill_evaluation_not_passed"
      });

      const passingRun = await runtime.runSkillEvaluation({
        runId: "run-passed",
        cases: [
          {
            caseId: "case-passed",
            query: "payment reconciliation",
            expectedSkillId: generated.skill.skillId,
            requiredEvidenceIds: generated.skill.evidenceRefs
          }
        ],
        thresholds: {
          minSkillHitRate: 1,
          minEvidenceRecall: 1,
          maxForbiddenEvidenceHitRate: 0
        },
        k: 3,
        skillSetVersion: "v2"
      });
      expect(passingRun).toMatchObject({
        runId: "run-passed",
        passed: true,
        metrics: {
          skillHitRate: 1,
          evidenceRecall: 1,
          forbiddenEvidenceHitRate: 0
        }
      });

      const deployment = await runtime.createSkillDeployment({
        skillIds: [generated.skill.skillId],
        status: "active",
        evaluationRunId: passingRun.runId,
        baseline: { deploymentId: "baseline-1" },
        trafficPercent: 15
      });
      expect(deployment).toMatchObject({
        ok: true,
        deployment: {
          status: "active",
          trafficPercent: 100,
          publishedSkillIds: [generated.skill.skillId],
          gate: {
            evaluationRunId: "run-passed",
            evaluationPassed: true,
            forced: false
          }
        }
      });

      const runs = await runtime.listSkillEvaluationRuns({ includeCases: true, limit: 10 });
      expect(runs.runs[0]).toMatchObject({
        runId: "run-passed",
        caseResults: expect.any(Array)
      });
      expect(runs.runs[1]).toMatchObject({
        runId: "run-failed"
      });

      const deployments = await runtime.listSkillDeployments({ limit: 10 });
      expect(deployments.deployments[0]).toMatchObject({
        deploymentId: deployment.deployment.deploymentId,
        status: "active"
      });

      expect(await runtime.rollbackSkillDeployment({
        deploymentId: "missing-deployment"
      })).toBeNull();

      const rollback = await runtime.rollbackSkillDeployment({
        deploymentId: deployment.deployment.deploymentId,
        reason: "bad metrics"
      });
      expect(rollback).toMatchObject({
        ok: true,
        deployment: {
          status: "rolled_back",
          rollbackOf: deployment.deployment.deploymentId,
          reason: "bad metrics"
        }
      });

      const deploymentsAfterRollback = await runtime.listSkillDeployments({ limit: 10 });
      expect(deploymentsAfterRollback.deployments[0]).toMatchObject({
        status: "rolled_back",
        rollbackOf: deployment.deployment.deploymentId
      });
    });
  });

  it("rejects invalid skill generation and proposal inputs", async () => {
    await withRuntime({}, async ({ runtime }) => {
      await expect(runtime.generateSkill({})).rejects.toThrow("生成知识 Skill 需要 query。");
      await expect(runtime.generateSkill({
        query: "payment reconciliation"
      })).rejects.toThrow("KnowledgeCore search 不可用，无法生成知识 Skill。");
      await expect(runtime.proposeSkill({})).rejects.toThrow("创建知识 Skill 提案需要 query 或 title。");
    });

    await withRuntime({
      core: { enabled: false, search: vi.fn() }
    }, async ({ runtime }) => {
      await expect(runtime.generateSkill({
        query: "payment reconciliation"
      })).rejects.toThrow("KnowledgeCore search 不可用，无法生成知识 Skill。");
    });
  });
});
