import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createAgentWorkspace } from "../platform/specialized/agent/agent-workspace/index.mjs";
import { createSummarizationRuntime } from "../platform/specialized/knowledge/invocation/knowledge-summarization-runtime/index.mjs";
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

async function verifySummarizationWorkspaceContextHotSwap() {
  const directDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-summarization-direct-"));
  const workspaceId = "verify-summarization-workspace-hot-swap";
  const actor = {
    actorUserId: "verify-summarization-owner",
    userId: "verify-summarization-owner",
    subjectId: "verify-summarization-owner",
    username: "verify-summarization-owner"
  };
  const agentWorkspace = createAgentWorkspace({ userDataPath: directDataPath });
  try {
    agentWorkspace.createWorkspace({
      ...actor,
      ownerUserId: actor.actorUserId,
      workspaceId,
      title: "Workspace scoped summarization",
      objective: "Verify summarization runtime consumes workspace context"
    });
    agentWorkspace.hotSwapProfile(workspaceId, {
      contextProfileId: "small-context",
      modelAlias: "workspace-summarizer",
      toolGrantId: "workspace-summary-grant",
      knowledgeScope: {
        includeSourceIds: ["summary-source-a"]
      }
    }, actor);

    let searchInput = null;
    let allocatorCallCount = 0;
    const contextInputs = [];
    const summarizationRuntime = createSummarizationRuntime({
      userDataPath: directDataPath,
      agentWorkspace,
      contextRuntime: {
        async assemble(input = {}) {
          contextInputs.push(input);
          assert.equal(input.contextProfileId, "small-context");
          assert.equal(input.modelAlias, "workspace-summarizer");
          assert.equal(input.workspaceContext.workspaceId, workspaceId);
          assert.equal(input.workspaceContext.toolGrantId, "workspace-summary-grant");
          assert.deepEqual(input.knowledgeSourceIds, ["summary-source-a"]);
          return {
            protocolVersion: "v0.0.1:agent:context-1",
            profileId: input.contextProfileId,
            roleId: input.roleId,
            budgetReport: { maxInputTokens: 4096, estimatedTokens: 256 },
            citations: [],
            workspaceContext: input.workspaceContext
          };
        }
      },
      runtime: {
        mounts: {
          knowledgeBase: {
            enabled: true,
            async search(input = {}) {
              searchInput = input;
              assert.deepEqual(input.scopeSourceIds, ["summary-source-a"]);
              return {
                protocolVersion: "v0.0.1:knowledge:core-1",
                query: input.query,
                items: [
                  {
                    id: "summary-evidence-1",
                    evidenceId: "summary-evidence-1",
                    title: "供应商发票抬头",
                    snippet: "summary-source-a 提供供应商发票抬头、预算审批和付款风险证据。",
                    confidence: 0.92,
                    source: {
                      sourceId: "summary-source-a",
                      sourcePath: "summary-source-a.md",
                      documentId: "summary-doc-a"
                    },
                    hierarchy: {
                      documentId: "summary-doc-a",
                      sectionId: "summary-section-a"
                    }
                  }
                ]
              };
            }
          }
        }
      },
      clientRuntimeAllocator: {
        async apply(input = {}, context = {}) {
          allocatorCallCount += 1;
          assert.equal(context.surface, "summarization-runtime");
          assert.equal(input.workspaceId, workspaceId);
          return {
            input: {
              ...input,
              modelAlias: "allocator-summarizer",
              contextProfileId: "allocator-context",
              toolGrantId: "allocator-summary-grant",
              scopeSourceIds: ["allocator-source"]
            },
            allocation: {
              profileId: "allocator-defaults",
              modelAlias: "allocator-summarizer"
            }
          };
        }
      }
    });

    const result = await summarizationRuntime.startRun({
      ...actor,
      workspaceId,
      query: "供应商 发票抬头 预算审批",
      limit: 4,
      includeState: true
    });
    assert.equal(allocatorCallCount, 1);
    assert.equal(result.run.status, "completed");
    assert.equal(result.workspaceContext.workspaceId, workspaceId);
    assert.equal(result.workspaceContext.modelAlias, "workspace-summarizer");
    assert.equal(result.workspaceContext.contextProfileId, "small-context");
    assert.equal(result.workspaceContext.toolGrantId, "workspace-summary-grant");
    assert.deepEqual(result.workspaceContext.knowledgeSourceIds, ["summary-source-a"]);
    assert.equal(result.run.input.modelAlias, "workspace-summarizer");
    assert.equal(result.run.input.contextProfileId, "small-context");
    assert.equal(result.run.input.toolGrantId, "workspace-summary-grant");
    assert.deepEqual(result.run.input.scopeSourceIds, ["summary-source-a"]);
    assert.equal(result.run.input.clientRuntimeAllocation.profileId, "allocator-defaults");
    assert.deepEqual(searchInput.scopeSourceIds, ["summary-source-a"]);
    assert.ok(contextInputs.length >= 2);
  } finally {
    agentWorkspace.close();
    await fs.rm(directDataPath, {
      recursive: true,
      force: true
    });
  }
}

await verifySummarizationWorkspaceContextHotSwap();

const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-multi-agent-summarization-"));
const featureProfilePath = path.join(userDataPath, "feature-profile.json");
await fs.writeFile(
  featureProfilePath,
  `${JSON.stringify({
    name: "multi-agent-summarization-verifier",
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
  await createKnowledgeJob(
    server.url,
    "合同续签与发票抬头",
    "合同续签需要确认发票抬头、盖章顺序、预算审批和供应商最终报价。财务团队需要在 2026-05-10 前确认。"
  );
  await createKnowledgeJob(
    server.url,
    "采购付款与风险",
    "采购付款涉及 120000 元预算，供应商报价需要二次核对，若发票抬头错误会影响付款审批。"
  );

  const profiles = await fetchJson(`${server.url}/api/context/profiles`);
  assert.equal(profiles.protocolVersion, "v0.0.1:agent:context-1");
  assert.equal(profiles.profiles.some((profile) => profile.profileId === "context-128k"), true);

  const created = await fetchJson(`${server.url}/api/knowledge/summarization/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: "合同 供应商 发票抬头 预算审批",
      limit: 12,
      contextProfileId: "small-context",
      includePrivate: true
    })
  });
  assert.equal(created.protocolVersion, "v0.0.1:knowledge:summarization-1");
  assert.equal(created.coordinatorProtocolVersion, "v0.0.1:agent:multi-agent-1");
  assert.equal(created.graphRuntime, "langgraph-js");
  assert.equal(created.run.status, "completed");
  assert.ok(created.workspace.workspaceId);
  assert.ok(created.workspaceSummary.submissionCount >= 1);
  assert.ok(created.coverage.totalEvidence >= 1);
  assert.ok(created.coverage.coveredEvidence >= 1);
  assert.ok(created.artifacts.some((artifact) => artifact.level === "ExecutiveSummary"));

  const executive = created.artifacts.find((artifact) => artifact.level === "ExecutiveSummary");
  assert.match(executive.content, /\[[^\]]+\]/);
  assert.equal(executive.coverageReport.totalEvidence, created.coverage.totalEvidence);

  const fetched = await fetchJson(
    `${server.url}/api/knowledge/summarization/runs/${encodeURIComponent(created.run.runId)}?includePrivate=1`
  );
  assert.equal(fetched.run.runId, created.run.runId);
  assert.ok(fetched.workspaceSummary.artifactCount >= 1);

  const workspace = await fetchJson(
    `${server.url}/api/agent-workspaces/${encodeURIComponent(created.workspace.workspaceId)}?includePrivate=1`
  );
  assert.equal(workspace.workspace.workspaceId, created.workspace.workspaceId);
  assert.ok(workspace.privateStates.length >= 1);
  assert.ok(workspace.issues.every((issue) => issue.runId === created.run.runId));

  const approved = await fetchJson(
    `${server.url}/api/knowledge/summarization/runs/${encodeURIComponent(created.run.runId)}/approve`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "approve"
      })
    }
  );
  assert.equal(approved.run.status, "approved");
  assert.equal(approved.artifacts.every((artifact) => artifact.status === "approved"), true);
} finally {
  await server.close();
  await fs.rm(userDataPath, {
    recursive: true,
    force: true
  });
}

console.log("Multi-agent summarization verification passed.");
