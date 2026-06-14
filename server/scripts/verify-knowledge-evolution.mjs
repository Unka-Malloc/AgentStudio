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

const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-knowledge-evolution-"));
const server = await startHttpServer({
  userDataPath,
  runtimeOptions: {
    profile: "minimal"
  }
});
await installAuthenticatedFetch(server);

try {
  const emptyGate = await fetchJson(`${server.url}/api/knowledge/evidence-gate/evaluate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: "合同预算审批",
      thresholds: {
        minEvidence: 1,
        requireHierarchy: false
      }
    })
  });
  assert.equal(emptyGate.ok, false);
  assert.equal(emptyGate.answerability, "not_enough_evidence");

  await createKnowledgeJob(
    server.url,
    "合同预算审批",
    "合同续签需要预算审批、发票抬头确认和供应商最终报价。财务负责人需要在 2026-05-10 前完成审批。"
  );
  await createKnowledgeJob(
    server.url,
    "供应商付款风险",
    "供应商付款金额为 120000 元，若发票抬头错误会影响审批，采购团队需要保留报价证据。"
  );

  const skill = await fetchJson(`${server.url}/api/knowledge/agent-skill`);
  assert.equal(skill.protocolVersion, "v0.0.1:knowledge:agent-skill-1");
  assert.equal(skill.toolPolicy.coarseToFineRequired, true);

  const plan = await fetchJson(`${server.url}/api/knowledge/agent-skill/plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: "合同预算审批和发票抬头",
      intent: "fact_check"
    })
  });
  assert.equal(plan.plan.coarseIndexFirst, true);
  assert.ok(plan.plan.queryRewrites.length >= 2);
  assert.ok(plan.plan.verificationChecks.includes("citation_coverage"));

  const run = await fetchJson(`${server.url}/api/knowledge/agent-skill/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: "合同预算审批和发票抬头",
      limit: 5,
      thresholds: {
        minEvidence: 1,
        minSources: 1,
        requireCitationsForAnswer: false
      }
    })
  });
  assert.equal(run.protocolVersion, "v0.0.1:knowledge:agent-skill-1");
  assert.equal(run.plan.coarseIndexFirst, true);
  assert.equal(run.searchResult.hierarchy.enforced, true);
  assert.equal(run.gate.ok, true);
  assert.equal(run.answerPolicy, "answer_with_citations");
  assert.ok(run.searchResult.items.length >= 1);

  const topEvidenceId = run.searchResult.items[0].evidenceId;
  const answerGate = await fetchJson(`${server.url}/api/knowledge/evidence-gate/evaluate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: "合同预算审批和发票抬头",
      searchResult: run.searchResult,
      answer: `- 合同续签需要预算审批和发票抬头确认。[${topEvidenceId}]`,
      thresholds: {
        minEvidence: 1,
        minSources: 1,
        requireHierarchy: true
      }
    })
  });
  assert.equal(answerGate.ok, true);
  assert.equal(answerGate.metrics.citedEvidenceCount, 1);

  const evalRun = await fetchJson(`${server.url}/api/knowledge/evaluation/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      runId: "verify-knowledge-evolution",
      k: 5,
      cases: [
        {
          caseId: "contract-budget",
          query: "合同预算审批和发票抬头",
          requiredEvidenceIds: [topEvidenceId]
        }
      ],
      thresholds: {
        minRecallAtK: 1,
        minMrrAtK: 1,
        minNdcgAtK: 1,
        minGatePassRate: 1
      }
    })
  });
  assert.equal(evalRun.protocolVersion, "v0.0.1:agent:evaluation-1");
  assert.equal(evalRun.status, "completed");
  assert.equal(evalRun.passed, true);
  assert.equal(evalRun.metrics.recallAtK, 1);
  assert.equal(evalRun.metrics.mrrAtK, 1);

  const runs = await fetchJson(`${server.url}/api/knowledge/evaluation/runs`);
  assert.ok(runs.runs.some((item) => item.runId === "verify-knowledge-evolution"));

  const fetchedRun = await fetchJson(`${server.url}/api/knowledge/evaluation/runs/verify-knowledge-evolution`);
  assert.equal(fetchedRun.runId, "verify-knowledge-evolution");
  assert.equal(fetchedRun.caseResults.length, 1);
} finally {
  await server.close();
  await fs.rm(userDataPath, {
    recursive: true,
    force: true
  });
}

console.log("Knowledge evolution verification passed.");
