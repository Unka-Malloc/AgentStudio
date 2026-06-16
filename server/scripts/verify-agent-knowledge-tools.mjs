import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startHttpServer } from "../services/server-runtime/http-server.mjs";
import { KERNEL_API_OPERATION_IDS } from "../platform/common/security/authorization/authorization-engine.mjs";
import { useIsolatedCapabilityKernelForVerifier } from "./capability-kernel-test-env.mjs";
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
    "X-Pact-Client-Kind": "pact-client",
    "X-Pact-Client-Id": "pact-client-agent-knowledge-tools-verifier",
    Authorization: `Bearer ${token}`
  };
}

function trustedPactClientHeaders() {
  return {
    "Content-Type": "application/json",
    "X-Pact-Client-Kind": "pact-client",
    "X-Pact-Client-Id": "pact-client-agent-knowledge-tools-verifier"
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
  "pact.agentLibrary.console",
  "pact.agentLibrary.configSchema",
  "pact.agentLibrary.capabilities",
  "pact.agentLibrary.health",
  "pact.agentLibrary.maintenance.get",
  "pact.agentLibrary.maintenance.set",
  "pact.agentLibrary.reindex",
  "pact.agentLibrary.maintenance.run",
  "pact.agentLibrary.sync",
  "pact.agentLibrary.changes",
  "pact.agentLibrary.reviewItems",
  "pact.agentLibrary.reviewResolve",
  "pact.agentLibrary.feedback",
  "pact.agentLibrary.suggestions",
  "pact.agentLibrary.suggestionResolve",
  "pact.agentLibrary.learning.jobs",
  "pact.agentLibrary.learning.health",
  "pact.agentLibrary.evidenceGate.evaluate",
  "pact.agentLibrary.agentSkill",
  "pact.agentLibrary.agentSkill.plan",
  "pact.agentLibrary.agentSkill.run",
  "pact.agentLibrary.retrievalPlaybook",
  "pact.agentLibrary.retrievalPlaybook.plan",
  "pact.agentLibrary.retrievalPlaybook.run",
  "pact.agentLibrary.skills.list",
  "pact.agentLibrary.skills.get",
  "pact.agentLibrary.skills.generate",
  "pact.agentLibrary.skills.propose",
  "pact.agentLibrary.skills.resolve",
  "pact.agentLibrary.skillFramework",
  "pact.agentLibrary.skillFramework.set",
  "pact.agentLibrary.playbooks.list",
  "pact.agentLibrary.playbooks.get",
  "pact.agentLibrary.playbooks.generate",
  "pact.agentLibrary.playbooks.propose",
  "pact.agentLibrary.playbooks.resolve",
  "pact.agentLibrary.playbookFramework",
  "pact.agentLibrary.playbookFramework.set",
  "pact.agentLibrary.goldenRules.list",
  "pact.agentLibrary.goldenRules.set",
  "pact.agentLibrary.goldenRules.publish",
  "pact.agentLibrary.goldenRules.rollback",
  "pact.agentLibrary.ruleAuthoring.chat",
  "pact.agentLibrary.ruleAuthoring.run",
  "pact.agentLibrary.goldCases.list",
  "pact.agentLibrary.goldCases.set",
  "pact.external.knowledge.distillation.health",
  "pact.external.knowledge.distillation.capabilities",
  "pact.external.knowledge.distillation.runs.list",
  "pact.external.knowledge.distillation.runs.create",
  "pact.external.knowledge.distillation.runs.get",
  "pact.external.knowledge.distillation.runs.cancel",
  "pact.external.knowledge.distillation.artifacts.export",
  "pact.agentLibrary.skills.evaluation.runs.create",
  "pact.agentLibrary.skills.deployments.create",
  "pact.agentLibrary.skills.deployments.rollback",
  "pact.agentLibrary.playbookSets.evaluation.runs.create",
  "pact.agentLibrary.playbookSets.deployments.create",
  "pact.agentLibrary.playbookSets.deployments.rollback",
  "pact.agentLibrary.trainingSets.export",
  "pact.agentLibrary.evaluation.runs.create",
  "pact.agentLibrary.evaluation.runs.list",
  "pact.agentLibrary.evaluation.runs.get",
  "pact.agentLibrary.modelRoles",
  "pact.agentLibrary.modelDecision",
  "pact.agentLibrary.evolution",
  "pact.agentLibrary.evolution.runs.create",
  "pact.agentLibrary.evolution.runs.list",
  "pact.agentLibrary.evolution.runs.get",
  "pact.agentLibrary.hierarchy.audit",
  "pact.agentLibrary.evolution.deployments.list",
  "pact.agentLibrary.evolution.deployments.promote",
  "pact.agentLibrary.evolution.deployments.rollback",
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
  "pact.agentLibrary.summarization.runs.create",
  "pact.agentLibrary.summarization.runs.get",
  "pact.agentLibrary.summarization.runs.approve",
  "pact.agentLibrary.search",
  "pact.agentLibrary.documentStructure",
  "pact.agentLibrary.item",
  "pact.agentLibrary.evidence",
  "pact.agentLibrary.asset",
  "pact.agentLibrary.renderMarkdown",
  "pact.agentLibrary.graph"
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
  "pact.agentLibrary.distillation.export",
  "pact.agentLibrary.distillation.runs.create",
  "pact.agentLibrary.distillation.runs.get",
  "pact.agentLibrary.distillation.workbench.runs.create",
  "pact.agentLibrary.distillation.workbench.stage.export"
];

const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-agent-knowledge-tools-"));
const restoreCapabilityKernelEnv = useIsolatedCapabilityKernelForVerifier();
const featureProfilePath = path.join(userDataPath, "feature-profile.json");
await fs.writeFile(
  featureProfilePath,
  `${JSON.stringify({
    name: "agent-knowledge-tools-verifier",
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
  const catalog = await fetchJson(`${server.url}/api/tool-management/v1/catalog`);
  assert.equal(catalog.status, 200);
  assert.equal(catalog.payload.schemaVersion, "v0.0.1:schema:definition-1");

  const tools = catalog.payload.tools || [];
  const toolIds = new Set(tools.map((tool) => tool.id));
  const toolById = new Map(tools.map((tool) => [tool.id, tool]));
  for (const toolId of expectedToolIds) {
    assert.equal(toolIds.has(toolId), true, `${toolId} should be advertised`);
  }
  for (const [legacyToolId, replacementToolId] of [
    ["pact.agentLibrary.agentSkill", "pact.agentLibrary.retrievalPlaybook"],
    ["pact.agentLibrary.agentSkill.plan", "pact.agentLibrary.retrievalPlaybook.plan"],
    ["pact.agentLibrary.agentSkill.run", "pact.agentLibrary.retrievalPlaybook.run"],
    ["pact.agentLibrary.skills.list", "pact.agentLibrary.playbooks.list"],
    ["pact.agentLibrary.skills.get", "pact.agentLibrary.playbooks.get"],
    ["pact.agentLibrary.skills.generate", "pact.agentLibrary.playbooks.generate"],
    ["pact.agentLibrary.skills.propose", "pact.agentLibrary.playbooks.propose"],
    ["pact.agentLibrary.skills.resolve", "pact.agentLibrary.playbooks.resolve"],
    ["pact.agentLibrary.skillFramework", "pact.agentLibrary.playbookFramework"],
    ["pact.agentLibrary.skillFramework.set", "pact.agentLibrary.playbookFramework.set"],
    ["pact.agentLibrary.skills.evaluation.runs.create", "pact.agentLibrary.playbookSets.evaluation.runs.create"],
    ["pact.agentLibrary.skills.deployments.create", "pact.agentLibrary.playbookSets.deployments.create"],
    ["pact.agentLibrary.skills.deployments.rollback", "pact.agentLibrary.playbookSets.deployments.rollback"]
  ]) {
    const legacyTool = toolById.get(legacyToolId);
    assert.equal(legacyTool?.deprecated, true, `${legacyToolId} should be marked deprecated`);
    assert.equal(legacyTool?.lifecycle?.replacementToolId, replacementToolId);
    assert.equal(toolById.get(replacementToolId)?.deprecated, false, `${replacementToolId} should be the preferred tool id`);
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
    "pact.agentLibrary.distillation.runs.create",
    {}
  );
  assert.equal(directLegacyDistillation.status, 404);
  assert.equal(directLegacyDistillation.payload.error.code, "unknown_tool");

  const noTokenHealth = await fetchJson(`${server.url}/api/tool-management/v1/execute`, {
    method: "POST",
    headers: trustedPactClientHeaders(),
    body: JSON.stringify({
      toolId: "pact.agentLibrary.health",
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
    "pact.agentLibrary.health",
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
    "pact.agentLibrary.search",
    {
      query: "agent knowledge tool verification",
      limit: 3,
      explain: true
    }
  );
  assert.equal(search.status, 200);
  assert.equal(search.payload.result.protocolVersion, "v0.0.1:knowledge:core-1");
  assert.equal(Array.isArray(search.payload.result.items), true);
  assert.equal(search.payload.result.responseProfile, "agent");
  assert.equal(
    search.payload.result.agentMessage?.protocolVersion,
    "v0.0.1:knowledge:search-agent-message-1"
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
      "workspace:maintain",
      "auth:admin"
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
  assert.equal(contextBundle.payload.result.bundleVersion, "v0.0.1:workspace:context-bundle-1");
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
    "pact.agentLibrary.feedback",
    {
      query: "agent knowledge tool verification",
      action: "searchMiss"
    }
  );
  assertPermissionDenied(
    writeDenied,
    "cap:tool:pact.agentLibrary.feedback:execute",
    "knowledge feedback with read grant"
  );

  const metrics = await fetchJson(`${server.url}/api/tool-management/v1/metrics/summary`);
  assert.equal(metrics.status, 200);
  assert.ok(metrics.payload.metrics.callsTotal >= 3);

  console.log("Agent knowledge tools verification passed.");
} finally {
  await server.close();
  await fs.rm(userDataPath, { recursive: true, force: true });
  restoreCapabilityKernelEnv();
}
