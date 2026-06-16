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

const PORTABLE_DOCUMENT_FORBIDDEN_KEYS = new Set([
  "evidenceRefs",
  "evidenceId",
  "documentId",
  "assetId",
  "sourceId",
  "batchId",
  "syncBatchId",
  "sourceKey"
]);

function forbiddenPortablePaths(value, pathParts = []) {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => forbiddenPortablePaths(entry, [...pathParts, String(index)]));
  }
  if (!value || typeof value !== "object") {
    return [];
  }
  return Object.entries(value).flatMap(([key, entry]) => {
    const nextPath = [...pathParts, key];
    return [
      ...(PORTABLE_DOCUMENT_FORBIDDEN_KEYS.has(key) ? [nextPath.join(".")] : []),
      ...forbiddenPortablePaths(entry, nextPath)
    ];
  });
}

const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-golden-distillation-"));
const featureProfilePath = path.join(userDataPath, "feature-profile.json");
await fs.writeFile(
  featureProfilePath,
  `${JSON.stringify({
    name: "knowledge-golden-distillation-verifier",
    enableFeatures: ["knowledge-distillation"]
  }, null, 2)}\n`,
  "utf8"
);
const server = await startHttpServer({
  userDataPath,
  runtimeOptions: {
    profile: "minimal",
    featureProfile: featureProfilePath
  }
});
await installAuthenticatedFetch(server);

try {
  const billingBody = "本月账单需要在 2026-05-10 前完成付款。发票抬头为 Pact Test Ltd，付款金额为 1200 元。";
  const securityBody = "账号登录验证码为 123456。如果不是本人操作，需要立即检查账号安全。";
  const adBody = "限时电子书和会员优惠活动，本邮件不包含账单付款、发票或安全风险。";
  await createKnowledgeJob(
    server.url,
    "账单付款提醒",
    billingBody
  );
  await createKnowledgeJob(
    server.url,
    "安全验证码提醒",
    securityBody
  );
  await createKnowledgeJob(
    server.url,
    "会员优惠广告",
    adBody
  );

  const rules = await fetchJson(`${server.url}/api/knowledge/golden-rules`);
  assert.equal(rules.protocolVersion, "v0.0.1:knowledge:golden-rule-1");
  assert.ok(rules.items.some((item) => item.packageId === "default-golden-rules"));

  const framework = await fetchJson(`${server.url}/api/knowledge/skill-framework`);
  await fetchJson(`${server.url}/api/knowledge/skill-framework`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...framework.framework,
      qualityGates: {
        ...framework.framework.qualityGates,
        minEvidence: 1,
        requireHierarchy: false
      }
    })
  });

  const generated = await fetchJson(`${server.url}/api/knowledge/skills/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: "账单 发票 付款",
      title: "账单付款 Skill",
      limit: 5,
      publish: true
    })
  });
  assert.equal(generated.protocolVersion, "v0.0.1:knowledge:skill-1");
  assert.equal(generated.skill.status, "pending_review");
  assert.equal(generated.qualityReport.passed, true);

  const published = await fetchJson(
    `${server.url}/api/knowledge/skills/${encodeURIComponent(generated.skill.skillId)}/resolve`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "publish" })
    }
  );
  assert.equal(published.skill.status, "published");

  const goldCasesAfterReview = await fetchJson(`${server.url}/api/knowledge/gold-cases`);
  assert.ok(goldCasesAfterReview.items.some((item) => item.expectedSkillId === generated.skill.skillId));

  const savedGoldCase = await fetchJson(`${server.url}/api/knowledge/gold-cases`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: "账单 发票 付款",
      expectedSkillId: generated.skill.skillId,
      requiredEvidenceIds: generated.skill.evidenceRefs,
      answerRubric: "必须回答账单付款时间、金额和发票抬头。",
      tags: ["verify"]
    })
  });
  assert.equal(savedGoldCase.goldCase.expectedSkillId, generated.skill.skillId);

  const evaluation = await fetchJson(`${server.url}/api/knowledge/skills/evaluation/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      cases: [
        {
          query: "账单 发票 付款",
          expectedSkillId: generated.skill.skillId,
          requiredEvidenceIds: generated.skill.evidenceRefs
        }
      ],
      thresholds: {
        minSkillHitRate: 1,
        minEvidenceRecall: 1
      }
    })
  });
  assert.equal(evaluation.passed, true);

  const deployment = await fetchJson(`${server.url}/api/knowledge/skills/deployments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      skillIds: [generated.skill.skillId],
      status: "canary",
      evaluationRunId: evaluation.runId,
      trafficPercent: 10
    })
  });
  assert.equal(deployment.ok, true);
  assert.equal(deployment.deployment.status, "canary");

  const rollback = await fetchJson(
    `${server.url}/api/knowledge/skills/deployments/${encodeURIComponent(deployment.deployment.deploymentId)}/rollback`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "verify rollback" })
    }
  );
  assert.equal(rollback.ok, true);
  assert.equal(rollback.deployment.rollbackOf, deployment.deployment.deploymentId);

  const exportResult = await fetchJson(`${server.url}/api/knowledge/training-sets/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({})
  });
  assert.equal(exportResult.ok, true);
  assert.ok(exportResult.recordCount >= 4);
  const exportStat = await fs.stat(exportResult.filePath);
  assert.ok(exportStat.size > 0);

  const evolution = await fetchJson(`${server.url}/api/knowledge/evolution/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      target: "knowledgeSkillSet",
      query: "账单 发票 付款",
      publish: false,
      skillThresholds: {
        minSkillHitRate: 0,
        minEvidenceRecall: 0
      }
    })
  });
  assert.equal(evolution.target, "knowledgeSkillSet");
  assert.equal(evolution.stages.goldenRuleGateApplied, true);
  assert.equal(evolution.stages.offlineEvaluated, true);
} finally {
  await server.close();
  await fs.rm(userDataPath, { recursive: true, force: true });
}

console.log("knowledge golden distillation verification passed.");
