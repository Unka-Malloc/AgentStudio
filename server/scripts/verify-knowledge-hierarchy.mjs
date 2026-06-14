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

const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-knowledge-hierarchy-"));
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
    "合同续签与发票抬头",
    "合同续签需要确认发票抬头、盖章顺序、预算审批和供应商最终报价。"
  );
  await createKnowledgeJob(
    server.url,
    "产品路线图与视觉设计",
    "产品路线图讨论移动端视觉设计、交互动效、图标规范和设计系统验收。"
  );

  const health = await fetchJson(`${server.url}/api/knowledge/health`);
  assert.equal(health.ok, true);
  assert.ok(health.counts.hierarchyNodes >= health.counts.documents);
  assert.equal(health.capabilities.retrievalPolicy.coarseToFineRequired, true);

  const search = await fetchJson(`${server.url}/api/knowledge/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: "发票抬头 合同盖章",
      limit: 5,
      explain: true
    })
  });
  assert.equal(search.protocolVersion, "v0.0.1:knowledge:core-1");
  assert.equal(search.hierarchy.enabled, true);
  assert.equal(search.hierarchy.policy, "coarse_to_fine");
  assert.equal(search.hierarchy.enforced, true);
  assert.ok(search.hierarchy.selected.documents.length + search.hierarchy.selected.sections.length >= 1);
  assert.ok(search.explain.generatedCandidateCount >= search.explain.hierarchyCandidateCount);
  assert.ok(search.items.length >= 1);
  assert.ok(search.items.every((item) => item.hierarchy && item.hierarchy.documentId));
  assert.match(`${search.items[0].title}\n${search.items[0].snippet}`, /合同|发票|盖章/);
  const structure = await fetchJson(
    `${server.url}/api/knowledge/documents/${encodeURIComponent(search.items[0].documentId)}/structure`
  );
  assert.equal(structure.protocolVersion, "v0.0.1:knowledge:core-1");
  assert.equal(structure.document.documentId, search.items[0].documentId);
  assert.ok(structure.tree.length >= 1);
  assert.ok(structure.nodes.every((node) => node.text === undefined));

  const grant = await fetchJson(`${server.url}/api/tool-management/v1/grants`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      label: "hierarchy-agent",
      scopes: ["knowledge:read"]
    })
  });
  const agentSearch = await fetchJson(`${server.url}/api/tool-management/v1/execute`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${grant.token}`
    },
    body: JSON.stringify({
      toolId: "pact.agentLibrary.search",
      input: {
        query: "发票抬头 合同盖章",
        limit: 3,
        explain: true
      }
    })
  });
  assert.equal(agentSearch.result.hierarchy.enabled, true);
  assert.equal(agentSearch.result.hierarchy.enforced, true);
  const agentStructure = await fetchJson(`${server.url}/api/tool-management/v1/execute`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${grant.token}`
    },
    body: JSON.stringify({
      toolId: "pact.agentLibrary.documentStructure",
      input: {
        documentId: search.items[0].documentId,
        maxNodes: 20
      }
    })
  });
  assert.equal(agentStructure.result.document.documentId, search.items[0].documentId);
  assert.ok(agentStructure.result.tree.length >= 1);
} finally {
  await server.close();
  await fs.rm(userDataPath, { recursive: true, force: true });
}
