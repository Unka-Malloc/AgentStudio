import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startHttpServer } from "../services/server-runtime/http-server.mjs";
import { createAgentWorkspace } from "../platform/specialized/agent/agent-workspace/index.mjs";
import { createContextRuntime } from "../platform/specialized/agent/agent-context/interface/index.mjs";
import { createModelDecisionRuntime } from "../platform/specialized/agent/agent-gateway/model-decision-runtime/index.mjs";
import { createAgentExplorationRuntime } from "../platform/specialized/capabilities/tools/agent-exploration-runtime/index.mjs";
import { createAgentLibraryPlaybookRuntime } from "../platform/specialized/knowledge/invocation/knowledge-skill-runtime/index.mjs";
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

const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-knowledge-skillization-"));
const modelDecisionRuntime = createModelDecisionRuntime();
const modelRoleIds = new Set(modelDecisionRuntime.describe().roles.map((role) => role.roleId));
assert.equal(modelRoleIds.has("knowledge_playbook_distiller"), true);
assert.equal(modelRoleIds.has("knowledge_skill_distiller"), true);
const playbookDistillationDecision = await modelDecisionRuntime.decide({
  roleId: "knowledge_playbook_distiller",
  input: {
    query: "contract approval",
    fallbackSkill: {
      title: "Contract Approval Playbook",
      summary: "Check approval evidence before answering.",
      evidenceRefs: ["ev_contract"]
    }
  }
});
assert.equal(playbookDistillationDecision.roleId, "knowledge_playbook_distiller");
assert.equal(playbookDistillationDecision.decision.skill.title, "Contract Approval Playbook");
const legacyDistillationDecision = await modelDecisionRuntime.decide({
  roleId: "knowledge_skill_distiller",
  input: {
    query: "contract approval",
    fallbackSkill: {
      title: "Legacy Contract Skill",
      summary: "Compatibility role alias.",
      evidenceRefs: ["ev_contract"]
    }
  }
});
assert.equal(legacyDistillationDecision.roleId, "knowledge_skill_distiller");
assert.equal(legacyDistillationDecision.decision.skill.title, "Legacy Contract Skill");

const featureProfilePath = path.join(userDataPath, "feature-profile.json");
await fs.writeFile(
  featureProfilePath,
  `${JSON.stringify({
    name: "knowledge-skillization-verifier",
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
    "合同预算审批",
    "合同续签需要预算审批、发票抬头确认和供应商最终报价。财务负责人需要在 2026-05-10 前完成审批。"
  );
  await createKnowledgeJob(
    server.url,
    "供应商付款风险",
    "供应商付款金额为 120000 元。若发票抬头错误会影响审批，采购团队需要保留报价证据。"
  );

  const framework = await fetchJson(`${server.url}/api/knowledge/skill-framework`);
  assert.equal(framework.framework.frameworkId, "pact.default-knowledge-skill-framework");
  assert.ok(framework.framework.layers.some((layer) => layer.id === "honest_boundaries"));
  const playbookFramework = await fetchJson(`${server.url}/api/knowledge/playbook-framework`);
  assert.equal(playbookFramework.framework.frameworkId, framework.framework.frameworkId);

  const updatedFramework = await fetchJson(`${server.url}/api/knowledge/skill-framework`, {
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
  assert.equal(updatedFramework.framework.qualityGates.minEvidence, 1);
  const updatedPlaybookFramework = await fetchJson(`${server.url}/api/knowledge/playbook-framework`);
  assert.equal(updatedPlaybookFramework.framework.qualityGates.minEvidence, 1);

  const generated = await fetchJson(`${server.url}/api/knowledge/playbooks/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: "合同预算审批 发票抬头 供应商付款",
      title: "合同预算审批 Skill",
      limit: 5,
      publish: true
    })
  });
  assert.equal(generated.protocolVersion, "v0.0.1:knowledge:skill-1");
  assert.equal(generated.skill.status, "pending_review");
  assert.equal(generated.qualityReport.passed, true);
  assert.ok(generated.skill.evidenceRefs.length >= 1);
  assert.ok(generated.skill.skill.decisionHeuristics.length >= 1);
  assert.ok(generated.skill.skill.honestBoundaries.length >= 1);

  const published = await fetchJson(
    `${server.url}/api/knowledge/playbooks/${encodeURIComponent(generated.skill.skillId)}/resolve`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "publish" })
    }
  );
  assert.equal(published.skill.status, "published");

  const proposed = await fetchJson(`${server.url}/api/knowledge/skills/propose`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sourceType: "agent_exploration",
      agentId: "verify-agent",
      runId: "verify-run",
      publish: true,
      proposal: {
        title: "合同预算审批 Agent Skill",
        sourceQuery: "合同预算审批",
        summary: "把合同续签、预算审批、发票抬头和供应商报价作为同一类审批风险检查。",
        applicability: {
          useWhen: ["用户询问合同续签或付款审批注意事项。"],
          avoidWhen: ["用户要求改写原始合同或发票内容。"]
        },
        decisionHeuristics: ["先核对预算审批，再核对发票抬头和供应商报价证据。"],
        honestBoundaries: ["只能作为检索和回答策略，不能直接改写 canonical fact。"],
        evidenceRefs: [generated.skill.evidenceRefs[0]],
        reuseReason: "合同付款类问题会反复出现。"
      }
    })
  });
  assert.equal(proposed.protocolVersion, "v0.0.1:knowledge:skill-1");
  assert.equal(proposed.skill.status, "pending_review");
  assert.equal(proposed.qualityReport.creation.passed, true);
  assert.equal(proposed.skill.scope.createdByAgent, true);

  const skillId = generated.skill.skillId;
  const listed = await fetchJson(
    `${server.url}/api/knowledge/skills?status=published&query=${encodeURIComponent("发票抬头")}`
  );
  assert.ok(listed.items.some((item) => item.skillId === skillId));
  const listedPlaybooks = await fetchJson(
    `${server.url}/api/knowledge/playbooks?status=published&query=${encodeURIComponent("发票抬头")}`
  );
  assert.ok(listedPlaybooks.items.some((item) => item.skillId === skillId));

  const fetched = await fetchJson(`${server.url}/api/knowledge/skills/${encodeURIComponent(skillId)}`);
  assert.equal(fetched.skillId, skillId);
  assert.equal(fetched.status, "published");
  const fetchedPlaybook = await fetchJson(`${server.url}/api/knowledge/playbooks/${encodeURIComponent(skillId)}`);
  assert.equal(fetchedPlaybook.skillId, skillId);
  assert.equal(fetchedPlaybook.status, "published");

  const rejected = await fetchJson(
    `${server.url}/api/knowledge/playbooks/${encodeURIComponent(skillId)}/resolve`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "archive" })
    }
  );
  assert.equal(rejected.skill.status, "archived");
} finally {
  await server.close();
}

const migrationRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pact-playbook-storage-migration-"));
try {
  const legacyBundleDir = path.join(migrationRoot, "knowledge-skills", "bundles", "legacy_contract");
  await fs.mkdir(legacyBundleDir, { recursive: true });
  await fs.writeFile(
    path.join(legacyBundleDir, "skill.json"),
    `${JSON.stringify({
      protocolVersion: "v0.0.1:knowledge:skill-1",
      skillId: "legacy_contract",
      version: 1,
      status: "published",
      title: "Legacy Contract Skill",
      sourceQuery: "contract approval",
      summary: "Historical KnowledgeSkill record.",
      skill: {
        decisionHeuristics: ["Check budget approval evidence before answering."],
        honestBoundaries: ["Do not rewrite canonical facts."]
      },
      evidenceRefs: ["ev_contract"],
      qualityReport: { passed: true },
      createdAt: "2026-06-14T00:00:00.000Z",
      updatedAt: "2026-06-14T00:00:00.000Z",
      publishedAt: "2026-06-14T00:00:00.000Z"
    }, null, 2)}\n`,
    "utf8"
  );
  const playbookRuntime = createAgentLibraryPlaybookRuntime({
    userDataPath: migrationRoot,
    runtime: { mounts: {} }
  });
  try {
    const migration = playbookRuntime.migrateLegacySkillsToPlaybooks();
    assert.equal(migration.ok, true);
    assert.equal(migration.migratedCount, 1);
    const listedPlaybooks = playbookRuntime.listSkills({ status: "published" });
    assert.equal(listedPlaybooks.playbookProtocolVersion, "v0.0.1:knowledge:playbook-1");
    assert.ok(listedPlaybooks.items.some((item) =>
      item.playbookId === "legacy_contract" &&
      item.legacySkillId === "legacy_contract" &&
      item.skillId === "legacy_contract"
    ));
    const migratedPlaybook = playbookRuntime.getSkill("legacy_contract");
    assert.equal(migratedPlaybook.playbookId, "legacy_contract");
    assert.equal(migratedPlaybook.legacySkillId, "legacy_contract");
    await fs.stat(path.join(migrationRoot, "agentlibrary-playbooks", "agentlibrary-playbooks.sqlite"));
    await fs.stat(path.join(migrationRoot, "agentlibrary-playbooks", "bundles", "legacy_contract", "playbook.json"));
    await fs.stat(path.join(migrationRoot, "knowledge-skills", "bundles", "legacy_contract", "skill.json"));
  } finally {
    playbookRuntime.close();
  }
} finally {
  await fs.rm(migrationRoot, { recursive: true, force: true });
}

const agentRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pact-knowledge-skill-agent-"));
const agentWorkspace = createAgentWorkspace({ userDataPath: agentRoot });
const contextRuntime = createContextRuntime({ userDataPath: agentRoot });
const fixtureKnowledgeCore = {
  enabled: true,
  async search(input = {}) {
    return {
      protocolVersion: "v0.0.1:knowledge:core-1",
      query: input.query,
      hierarchy: {
        enforced: true,
        selected: {
          documents: [{ documentId: "doc_contract", title: "合同预算审批" }]
        }
      },
      items: [
        {
          evidenceId: "ev_contract",
          documentId: "doc_contract",
          title: "合同预算审批",
          snippet: "合同续签需要预算审批和发票抬头确认。",
          score: 0.92,
          hierarchy: { path: "collection:docs > document:doc_contract" },
          modalities: ["text"]
        }
      ],
      explain: { candidateCount: 1 }
    };
  }
};
const fixtureKnowledgeSkillRuntime = {
  buildContextForQuery() {
    return {
      protocolVersion: "v0.0.1:knowledge:skill-1",
      query: "合同预算审批",
      skills: [
        {
          skillId: "knowledge_skill_contract",
          title: "合同预算审批 Skill",
          summary: "先识别预算审批、发票抬头和供应商报价。",
          matchScore: 1,
          decisionHeuristics: ["先判断是否涉及合同续签，再核对发票抬头和报价证据。"],
          honestBoundaries: ["不能自动改写 canonical fact。"],
          evidenceRefs: ["ev_contract"]
        }
      ]
    };
  },
  searchSkills() {
    return {
      protocolVersion: "v0.0.1:knowledge:skill-1",
      items: [
        {
          skillId: "knowledge_skill_contract",
          title: "合同预算审批 Skill",
          summary: "先识别预算审批、发票抬头和供应商报价。",
          matchScore: 1,
          evidenceRefs: ["ev_contract"],
          qualityReport: { score: 1 },
          skill: {
            decisionHeuristics: ["先判断是否涉及合同续签，再核对发票抬头和报价证据。"],
            honestBoundaries: ["不能自动改写 canonical fact。"]
          }
        }
      ]
    };
  },
  proposeSkill(input = {}) {
    return {
      protocolVersion: "v0.0.1:knowledge:skill-1",
      ok: true,
      skill: {
        skillId: "knowledge_skill_agent_proposed",
        status: "pending_review",
        title: input.proposal?.title || "Agent proposed skill",
        summary: input.proposal?.summary || "",
        evidenceRefs: input.evidenceRefs || input.proposal?.evidenceRefs || []
      },
      qualityReport: {
        passed: true,
        creation: { passed: true }
      },
      statusReason: "created_for_review"
    };
  }
};
let callCount = 0;
const explorationRuntime = createAgentExplorationRuntime({
  userDataPath: agentRoot,
  runtime: {
    mounts: {
      knowledgeBase: fixtureKnowledgeCore
    }
  },
  agentWorkspace,
  contextRuntime,
  knowledgeSkillRuntime: fixtureKnowledgeSkillRuntime,
  agentGatewayCall: async (input = {}) => {
    callCount += 1;
    assert.match(input.messages[0].content, /AgentLibraryPlaybookContext/);
    assert.ok(
      input.parameters.tools.some((tool) => tool.function?.name === "playbook_search"),
      "agent exploration must expose playbook_search"
    );
    assert.ok(
      input.parameters.tools.some((tool) => tool.function?.name === "knowledge_skill_search"),
      "agent exploration must expose knowledge_skill_search"
    );
    assert.ok(
      input.parameters.tools.some((tool) => tool.function?.name === "playbook_propose"),
      "agent exploration must expose playbook_propose"
    );
    assert.ok(
      input.parameters.tools.some((tool) => tool.function?.name === "knowledge_skill_propose"),
      "agent exploration must expose knowledge_skill_propose"
    );
    if (callCount === 1) {
      return {
        ok: true,
        answer: "",
        toolCalls: [
          {
            id: "call_skill",
            type: "function",
            function: {
              name: "playbook_search",
              arguments: JSON.stringify({ query: "合同预算审批", limit: 1 })
            }
          }
        ]
      };
    }
    if (callCount === 2) {
      return {
        ok: true,
        answer: "",
        toolCalls: [
          {
            id: "call_search",
            type: "function",
            function: {
              name: "keyword_search",
              arguments: JSON.stringify({ query: "合同预算审批 发票抬头", limit: 1 })
            }
          }
        ]
      };
    }
    if (callCount === 3) {
      return {
        ok: true,
        answer: "",
        toolCalls: [
          {
            id: "call_skill_propose",
            type: "function",
            function: {
              name: "playbook_propose",
              arguments: JSON.stringify({
                title: "合同续签审批检查 Skill",
                sourceQuery: "合同续签需要注意什么？",
                summary: "复用合同续签审批检查流程。",
                decisionHeuristics: ["先确认预算审批，再确认发票抬头。"],
                honestBoundaries: ["不能自动修改合同事实。"],
                evidenceRefs: ["ev_contract"],
                reuseReason: "合同续签检查会重复出现。",
                confidence: 0.8
              })
            }
          }
        ]
      };
    }
    return {
      ok: true,
      answer: "合同续签需要预算审批和发票抬头确认。\n\n📎 证据来源：evidence::ev_contract"
    };
  }
});

try {
  const result = await explorationRuntime.run({
    query: "合同续签需要注意什么？",
    modelAlias: "deepseek",
    maxIterations: 4,
    limit: 1
  });
  assert.equal(result.ok, true);
  assert.equal(result.toolResults[0].tool, "playbook_search");
  assert.equal(result.toolResults[1].tool, "keyword_search");
  assert.equal(result.toolResults[2].tool, "playbook_propose");
  assert.equal(result.toolResults[2].result.status, "pending_review");
  assert.ok(result.knowledgeSkillContext.skills.length >= 1);
  assert.ok(result.evidenceRefs.includes("ev_contract"));
} finally {
  agentWorkspace.close();
  await fs.rm(agentRoot, { recursive: true, force: true });
  await fs.rm(userDataPath, { recursive: true, force: true });
}

console.log("Knowledge skillization verification passed.");
