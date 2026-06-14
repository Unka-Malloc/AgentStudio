import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startHttpServer } from "../services/server-runtime/http-server.mjs";
import { installAuthenticatedFetch } from "./test-auth-helper.mjs";

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const rawText = await response.text();
  const payload = rawText.trim() ? JSON.parse(rawText) : {};
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${rawText}`);
  }
  return payload;
}

async function waitForJob(baseUrl, jobId) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const job = await fetchJson(`${baseUrl}/api/jobs/${encodeURIComponent(jobId)}`);
    if (job.status === "completed") {
      return job;
    }
    if (job.status === "failed") {
      throw new Error(job.error || "Job failed.");
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Job did not complete in time.");
}

async function createKnowledgeJob(baseUrl, title, body) {
  const job = await fetchJson(`${baseUrl}/api/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      inputText: [`# ${title}`, "", body].join("\n"),
      settings: {
        knowledgeCoreEnabled: true
      }
    })
  });
  await waitForJob(baseUrl, job.id);
  return job;
}

const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-knowledge-evolution-loop-"));
const server = await startHttpServer({
  userDataPath,
  runtimeOptions: {
    profile: "minimal"
  }
});
await installAuthenticatedFetch(server);

try {
  await createKnowledgeJob(
    server.url,
    "Alpha Contract Approval",
    "Alpha contract renewal requires budget approval, invoice title confirmation, and supplier final quote evidence."
  );
  await createKnowledgeJob(
    server.url,
    "Alpha Payment Risk",
    "Alpha supplier payment is 120000 CNY. If the invoice title is wrong, finance approval can be delayed."
  );

  const roles = await fetchJson(`${server.url}/api/knowledge/model-roles`);
  assert.equal(roles.protocolVersion, "v0.0.1:strategy:model-decision-1");
  assert.ok(roles.roles.some((role) => role.roleId === "evidence_entailment_judge"));
  assert.equal(roles.explicitModelEnableRequired, true);

  const evolution = await fetchJson(`${server.url}/api/knowledge/evolution`);
  assert.equal(evolution.protocolVersion, "v0.0.1:knowledge:evolution-1");
  assert.equal(evolution.policy.canaryBeforeActive, true);
  assert.equal(evolution.policy.noDatasetSpecificFineTuning, true);

  const search = await fetchJson(`${server.url}/api/knowledge/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: "Alpha contract invoice approval",
      limit: 5,
      explain: true,
      clientId: "verify-client"
    })
  });
  assert.ok(search.items.length >= 1);
  const topEvidenceId = search.items[0].evidenceId;

  const unsupportedGate = await fetchJson(`${server.url}/api/knowledge/evidence-gate/evaluate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: "Alpha contract invoice approval",
      searchResult: search,
      answer: `Alpha contract was fully cancelled. [${topEvidenceId}]`,
      thresholds: {
        minEvidence: 1,
        minSources: 1,
        requireHierarchy: true,
        semanticSupportRequired: true
      }
    })
  });
  assert.equal(unsupportedGate.ok, false);
  assert.ok(unsupportedGate.failures.some((failure) => failure.code === "semantic_unsupported_claims"));

  const skillRun = await fetchJson(`${server.url}/api/knowledge/agent-skill/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: "Alpha contract invoice approval",
      answer: `Alpha contract renewal requires invoice title confirmation. [${topEvidenceId}]`,
      limit: 5,
      semanticSupportRequired: true,
      thresholds: {
        minEvidence: 1,
        minSources: 1,
        requireHierarchy: true,
        minSemanticSupportScore: 0.1
      }
    })
  });
  assert.equal(skillRun.protocolVersion, "v0.0.1:knowledge:agent-skill-1");
  assert.equal(skillRun.modelDecisions.semanticJudgement.roleId, "evidence_entailment_judge");
  assert.equal(skillRun.modelDecisions.semanticJudgement.usedModel, false);

  await fetchJson(`${server.url}/api/knowledge/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      feedbackId: "verify-evolution-open",
      clientId: "verify-client",
      query: "Alpha contract invoice approval",
      action: "open",
      itemId: search.items[0].itemId,
      evidenceId: topEvidenceId,
      resultRank: 1,
      context: {
        reasons: search.items[0].reasons,
        hierarchy: search.items[0].hierarchy
      },
      createdAt: "2026-04-30T00:00:00.000Z"
    })
  });
  await fetchJson(`${server.url}/api/knowledge/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      feedbackId: "verify-evolution-miss",
      clientId: "verify-client",
      query: "missing Alpha approval owner",
      action: "searchMiss",
      resultRank: 0,
      createdAt: "2026-04-30T00:01:00.000Z"
    })
  });

  const hierarchyAudit = await fetchJson(`${server.url}/api/knowledge/hierarchy/audit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      splitThreshold: 1,
      persistSuggestions: true
    })
  });
  assert.equal(hierarchyAudit.protocolVersion, "v0.0.1:knowledge:evolution-1");
  assert.equal(hierarchyAudit.audit.policy.suggestionReviewRequired, true);
  assert.equal(hierarchyAudit.modelDecision.roleId, "hierarchy_quality_reviewer");

  const evolutionRun = await fetchJson(`${server.url}/api/knowledge/evolution/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      runId: "verify-evolution-loop",
      feedbackWindowHours: 24 * 365,
      canaryTrafficPercent: 100,
      cases: [
        {
          caseId: "alpha-contract-opened-evidence",
          query: "Alpha contract invoice approval",
          requiredEvidenceIds: [topEvidenceId],
          tags: ["verified", "feedback"]
        }
      ],
      thresholds: {
        minRecallAtK: 1,
        minMrrAtK: 1,
        minNdcgAtK: 1,
        minGatePassRate: 1
      },
      regressionThresholds: {
        tolerance: 0
      }
    })
  });
  assert.equal(evolutionRun.protocolVersion, "v0.0.1:knowledge:evolution-1");
  assert.equal(evolutionRun.status, "canary_published");
  assert.equal(evolutionRun.caseSource, "provided");
  assert.equal(evolutionRun.regressionGate.passed, true);
  assert.equal(evolutionRun.deployment.status, "canary");

  const canarySearch = await fetchJson(`${server.url}/api/knowledge/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: "Alpha contract invoice approval",
      clientId: "verify-client-canary",
      limit: 3
    })
  });
  assert.equal(canarySearch.profileRoute.routedBy, "canary");
  assert.equal(canarySearch.profileRoute.deploymentId, evolutionRun.deployment.deploymentId);

  const deployments = await fetchJson(`${server.url}/api/knowledge/evolution/deployments?status=canary`);
  assert.ok(deployments.deployments.some((deployment) => deployment.deploymentId === evolutionRun.deployment.deploymentId));

  const promoted = await fetchJson(
    `${server.url}/api/knowledge/evolution/deployments/${encodeURIComponent(evolutionRun.deployment.deploymentId)}/promote`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reason: "verify promote"
      })
    }
  );
  assert.equal(promoted.ok, true);
  assert.equal(promoted.status, "promoted");
  assert.equal(promoted.result.deployment.status, "active");

  const rolledBack = await fetchJson(
    `${server.url}/api/knowledge/evolution/deployments/${encodeURIComponent(evolutionRun.deployment.deploymentId)}/rollback`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reason: "verify rollback"
      })
    }
  );
  assert.equal(rolledBack.ok, true);
  assert.equal(rolledBack.status, "rolled_back");
  assert.equal(rolledBack.result.deployment.status, "rolled_back");

  const fetchedRun = await fetchJson(`${server.url}/api/knowledge/evolution/runs/verify-evolution-loop`);
  assert.equal(fetchedRun.runId, "verify-evolution-loop");
  assert.equal(fetchedRun.deployment.deploymentId, evolutionRun.deployment.deploymentId);
} finally {
  await server.close();
  await fs.rm(userDataPath, {
    recursive: true,
    force: true
  });
}

console.log("Knowledge evolution loop verification passed.");
