import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startHttpServer } from "../services/server-runtime/http-server.mjs";
import { KERNEL_API_OPERATION_IDS } from "../platform/common/security/authorization/authorization-engine.mjs";
import { installAuthenticatedFetch } from "./test-auth-helper.mjs";

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const rawText = await response.text();
  const payload = rawText.trim() ? JSON.parse(rawText) : {};
  return {
    ok: response.ok,
    status: response.status,
    payload
  };
}

function bearerHeaders(token) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`
  };
}

async function executeTool(baseUrl, token, toolId, input = {}) {
  return fetchJson(`${baseUrl}/api/tool-management/v1/execute`, {
    method: "POST",
    headers: bearerHeaders(token),
    body: JSON.stringify({ toolId, input })
  });
}

async function createToolGrant(baseUrl, label, scopes) {
  const result = await fetchJson(`${baseUrl}/api/tool-management/v1/grants`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ label, scopes })
  });
  assert.equal(result.status, 201, `${label} grant should be created`);
  assert.ok(result.payload.token, `${label} grant should return a token`);
  return result.payload.token;
}

function assertPermissionDenied(result, expectedCapability, label) {
  assert.equal(result.status, 403, `${label} should be denied`);
  const code = result.payload.error?.code;
  assert.equal(
    ["missing_scopes", "missing_capabilities"].includes(code),
    true,
    `${label} should fail with a permission denial code`
  );
  if (code === "missing_capabilities") {
    assert.equal(
      result.payload.error.details?.missingCapabilities?.includes(expectedCapability),
      true,
      `${label} should report missing capability ${expectedCapability}`
    );
  }
}

const expectedToolIds = [
  "pact.knowledge.console",
  "pact.knowledge.configSchema",
  "pact.knowledge.capabilities",
  "pact.knowledge.health",
  "pact.knowledge.maintenance.get",
  "pact.knowledge.maintenance.set",
  "pact.knowledge.reindex",
  "pact.knowledge.maintenance.run",
  "pact.knowledge.sync",
  "pact.knowledge.changes",
  "pact.knowledge.reviewItems",
  "pact.knowledge.reviewResolve",
  "pact.knowledge.feedback",
  "pact.knowledge.suggestions",
  "pact.knowledge.suggestionResolve",
  "pact.knowledge.learning.jobs",
  "pact.knowledge.learning.health",
  "pact.knowledge.evidenceGate.evaluate",
  "pact.knowledge.agentSkill",
  "pact.knowledge.agentSkill.plan",
  "pact.knowledge.agentSkill.run",
  "pact.knowledge.skills.list",
  "pact.knowledge.skills.get",
  "pact.knowledge.skills.generate",
  "pact.knowledge.skills.propose",
  "pact.knowledge.skills.resolve",
  "pact.knowledge.skillFramework",
  "pact.knowledge.skillFramework.set",
  "pact.knowledge.goldenRules.list",
  "pact.knowledge.goldenRules.set",
  "pact.knowledge.goldenRules.publish",
  "pact.knowledge.goldenRules.rollback",
  "pact.knowledge.ruleAuthoring.chat",
  "pact.knowledge.ruleAuthoring.run",
  "pact.knowledge.goldCases.list",
  "pact.knowledge.goldCases.set",
  "pact.external.knowledge.distillation.health",
  "pact.external.knowledge.distillation.capabilities",
  "pact.external.knowledge.distillation.runs.list",
  "pact.external.knowledge.distillation.runs.create",
  "pact.external.knowledge.distillation.runs.get",
  "pact.external.knowledge.distillation.runs.cancel",
  "pact.external.knowledge.distillation.artifacts.export",
  "pact.knowledge.skills.evaluation.runs.create",
  "pact.knowledge.skills.deployments.create",
  "pact.knowledge.skills.deployments.rollback",
  "pact.knowledge.trainingSets.export",
  "pact.knowledge.evaluation.runs.create",
  "pact.knowledge.evaluation.runs.list",
  "pact.knowledge.evaluation.runs.get",
  "pact.knowledge.modelRoles",
  "pact.knowledge.modelDecision",
  "pact.knowledge.evolution",
  "pact.knowledge.evolution.runs.create",
  "pact.knowledge.evolution.runs.list",
  "pact.knowledge.evolution.runs.get",
  "pact.knowledge.hierarchy.audit",
  "pact.knowledge.evolution.deployments.list",
  "pact.knowledge.evolution.deployments.promote",
  "pact.knowledge.evolution.deployments.rollback",
  "pact.context.profiles",
  "pact.context.profiles.set",
  "pact.clientRuntime.profiles",
  "pact.clientRuntime.profiles.set",
  "pact.clientRuntime.resolve",
  "pact.clientRuntime.status",
  "pact.agentWorkspace.create",
  "pact.agentWorkspace.list",
  "pact.agentWorkspace.get",
  "pact.agentWorkspace.context",
  "pact.agentWorkspace.contextBundle.export",
  "pact.agentWorkspace.contextBundle.restore",
  "pact.agentWorkspace.chain",
  "pact.agentWorkspace.parent.set",
  "pact.agentWorkspace.profile.hotswap",
  "pact.agentWorkspace.sources.set",
  "pact.agentWorkspace.share",
  "pact.agentWorkspace.unshare",
  "pact.agentWorkspace.folder.create",
  "pact.agentWorkspace.files.list",
  "pact.agentWorkspace.file.upload",
  "pact.agentWorkspace.file.stat",
  "pact.agentWorkspace.file.download",
  "pact.workspace.create",
  "pact.workspace.folder.create",
  "pact.workspace.files.list",
  "pact.workspace.file.upload",
  "pact.workspace.file.stat",
  "pact.workspace.file.download",
  "pact.agentWorkspace.submissionResolve",
  "pact.agentWorkspace.issueResolve",
  "pact.agentWorkspace.locks",
  "pact.agentWorkspace.lock",
  "pact.knowledge.summarization.runs.create",
  "pact.knowledge.summarization.runs.get",
  "pact.knowledge.summarization.runs.approve",
  "pact.knowledge.search",
  "pact.knowledge.documentStructure",
  "pact.knowledge.item",
  "pact.knowledge.evidence",
  "pact.knowledge.asset",
  "pact.knowledge.renderMarkdown",
  "pact.knowledge.graph"
];

const legacyInternalDistillationOperationIds = [
  "knowledge.distillation.export",
  "knowledge.distillation.runs.create",
  "knowledge.distillation.runs.get",
  "knowledge.distillation.workbench.runs.list",
  "knowledge.distillation.workbench.runs.create",
  "knowledge.distillation.workbench.runs.get",
  "knowledge.distillation.workbench.runs.resume",
  "knowledge.distillation.workbench.runs.cancel",
  "knowledge.distillation.workbench.runs.archive",
  "knowledge.distillation.workbench.runs.delete",
  "knowledge.distillation.workbench.stage.rerun",
  "knowledge.distillation.workbench.stage.export",
  "knowledge.distillation.workbench.runs.package",
  "knowledge.distillation.workbench.runs.artifacts",
  "knowledge.distillation.workbench.runs.compare"
];

const legacyInternalDistillationToolIds = [
  "pact.knowledge.distillation.export",
  "pact.knowledge.distillation.runs.create",
  "pact.knowledge.distillation.runs.get",
  "pact.knowledge.distillation.workbench.runs.create",
  "pact.knowledge.distillation.workbench.stage.export"
];

const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-agent-knowledge-tools-"));
const server = await startHttpServer({
  userDataPath,
  runtimeOptions: {
    profile: "minimal"
  }
});
await installAuthenticatedFetch(server);

try {
  const catalog = await fetchJson(`${server.url}/api/tool-management/v1/catalog`);
  assert.equal(catalog.status, 200);
  assert.equal(catalog.payload.schemaVersion, 1);

  const tools = catalog.payload.tools || [];
  const toolIds = new Set(tools.map((tool) => tool.id));
  for (const toolId of expectedToolIds) {
    assert.equal(toolIds.has(toolId), true, `${toolId} should be advertised`);
  }
  for (const operationId of legacyInternalDistillationOperationIds) {
    assert.equal(
      tools.some((tool) => tool.operationId === operationId),
      false,
      `${operationId} must not be advertised to agents`
    );
    assert.equal(
      KERNEL_API_OPERATION_IDS.includes(operationId),
      false,
      `${operationId} must not remain in the agent authorization kernel`
    );
  }
  for (const toolId of legacyInternalDistillationToolIds) {
    assert.equal(toolIds.has(toolId), false, `${toolId} must not be advertised to agents`);
  }
  const legacyOperationPrefix = `${"agent"}_${"tools"}.`;
  assert.equal(
    tools.some((tool) => String(tool.operationId || "").startsWith(legacyOperationPrefix)),
    false
  );

  const legacyProbeToken = await createToolGrant(
    server.url,
    "verify-agent-knowledge-tools-legacy-probe",
    ["knowledge:maintain"]
  );
  const directLegacyDistillation = await executeTool(
    server.url,
    legacyProbeToken,
    "pact.knowledge.distillation.runs.create",
    {}
  );
  assert.equal(directLegacyDistillation.status, 404);
  assert.equal(directLegacyDistillation.payload.error.code, "unknown_tool");

  const noTokenHealth = await fetchJson(`${server.url}/api/tool-management/v1/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      toolId: "pact.knowledge.health",
      input: {}
    })
  });
  assert.equal(noTokenHealth.status, 401);

  const healthGrantToken = await createToolGrant(
    server.url,
    "verify-agent-knowledge-tools-health-read",
    ["knowledge:read"]
  );
  const health = await executeTool(
    server.url,
    healthGrantToken,
    "pact.knowledge.health",
    {}
  );
  assert.equal(health.status, 200);
  assert.equal(health.payload.status, "ok");
  assert.equal(health.payload.grant.scopes.includes("knowledge:read"), true);
  assert.equal(health.payload.result.ok, true);

  const searchGrantToken = await createToolGrant(
    server.url,
    "verify-agent-knowledge-tools-search-read",
    ["knowledge:read"]
  );
  const search = await executeTool(
    server.url,
    searchGrantToken,
    "pact.knowledge.search",
    {
      query: "agent knowledge tool verification",
      limit: 3,
      explain: true
    }
  );
  assert.equal(search.status, 200);
  assert.equal(search.payload.result.protocolVersion, "pact.knowledge.v1");
  assert.equal(Array.isArray(search.payload.result.items), true);
  assert.equal(search.payload.result.responseProfile, "agent");
  assert.equal(
    search.payload.result.agentMessage?.protocolVersion,
    "pact.knowledge-search.agent-message.v1"
  );
  assert.equal(search.payload.result.agentMessage?.machineReadable, true);

  const adminGrantToken = await createToolGrant(
    server.url,
    "verify-agent-workspace-context-tools-admin",
    [
      "knowledge:read",
      "knowledge:write",
      "knowledge:maintain",
      "knowledge:admin",
      "workspace:read",
      "workspace:write",
      "workspace:maintain"
    ]
  );

  const workspace = await fetchJson(`${server.url}/api/agent-workspaces`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "Tool Workspace Source",
      objective: "Verify context bundle tool export"
    })
  });
  assert.equal(workspace.status, 201);
  const targetWorkspace = await fetchJson(`${server.url}/api/agent-workspaces`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "Tool Workspace Target",
      objective: "Verify context bundle tool restore"
    })
  });
  assert.equal(targetWorkspace.status, 201);

  const workspaceId = workspace.payload.workspace.workspaceId;
  const targetWorkspaceId = targetWorkspace.payload.workspace.workspaceId;
  const profile = await fetchJson(`${server.url}/api/agent-workspaces/${encodeURIComponent(workspaceId)}/profile`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contextProfileId: "tool-context-profile",
      modelAlias: "tool-model-alias",
      toolGrantId: "tool-workspace-grant",
      knowledgeScope: {
        includeSourceIds: ["tool-source-a"]
      }
    })
  });
  assert.equal(profile.status, 200);

  const workspaceContext = await executeTool(
    server.url,
    adminGrantToken,
    "pact.agentWorkspace.context",
    { workspaceId }
  );
  assert.equal(workspaceContext.status, 200);
  assert.equal(workspaceContext.payload.result.contextProfileId, "tool-context-profile");
  assert.equal(workspaceContext.payload.result.modelAlias, "tool-model-alias");
  assert.equal(workspaceContext.payload.result.toolGrantId, "tool-workspace-grant");
  assert.deepEqual(workspaceContext.payload.result.knowledgeSourceIds, ["tool-source-a"]);

  const contextBundle = await executeTool(
    server.url,
    adminGrantToken,
    "pact.agentWorkspace.contextBundle.export",
    {
      workspaceId,
      format: "compressed"
    }
  );
  assert.equal(contextBundle.status, 200);
  assert.equal(contextBundle.payload.result.bundleVersion, "pact.workspace-context-bundle.v1");
  assert.equal(contextBundle.payload.result.compressed.encoding, "gzip+base64");
  assert.ok(contextBundle.payload.result.bundleHash);

  const restored = await executeTool(
    server.url,
    adminGrantToken,
    "pact.agentWorkspace.contextBundle.restore",
    {
      workspaceId: targetWorkspaceId,
      compressed: contextBundle.payload.result.compressed,
      bundleHash: contextBundle.payload.result.bundleHash
    }
  );
  assert.equal(restored.status, 200);
  assert.equal(restored.payload.result.ok, true);
  assert.equal(restored.payload.result.restoredContext.contextProfileId, "tool-context-profile");
  assert.equal(restored.payload.result.restoredContext.modelAlias, "tool-model-alias");
  assert.equal(restored.payload.result.restoredContext.toolGrantId, "tool-workspace-grant");
  assert.deepEqual(restored.payload.result.restoredContext.knowledgeSourceIds, ["tool-source-a"]);

  const restoreDeniedToken = await createToolGrant(
    server.url,
    "verify-agent-workspace-context-tools-restore-denied",
    ["knowledge:read"]
  );
  const restoreDenied = await executeTool(
    server.url,
    restoreDeniedToken,
    "pact.agentWorkspace.contextBundle.restore",
    {
      workspaceId: targetWorkspaceId,
      compressed: contextBundle.payload.result.compressed,
      bundleHash: contextBundle.payload.result.bundleHash
    }
  );
  assertPermissionDenied(
    restoreDenied,
    "cap:tool:pact.agentWorkspace.contextBundle.restore:execute",
    "context bundle restore with read grant"
  );

  const writeDeniedToken = await createToolGrant(
    server.url,
    "verify-agent-knowledge-tools-write-denied",
    ["knowledge:read"]
  );
  const writeDenied = await executeTool(
    server.url,
    writeDeniedToken,
    "pact.knowledge.feedback",
    {
      query: "agent knowledge tool verification",
      action: "searchMiss"
    }
  );
  assertPermissionDenied(
    writeDenied,
    "cap:tool:pact.knowledge.feedback:execute",
    "knowledge feedback with read grant"
  );

  const metrics = await fetchJson(`${server.url}/api/tool-management/v1/metrics/summary`);
  assert.equal(metrics.status, 200);
  assert.ok(metrics.payload.metrics.callsTotal >= 3);

  console.log("Agent knowledge tools verification passed.");
} finally {
  await server.close();
  await fs.rm(userDataPath, { recursive: true, force: true });
}
