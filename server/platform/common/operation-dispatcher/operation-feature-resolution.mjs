const LOCAL_SHAREDSPACE_OPERATION_IDS = new Set([
  "agent_workspaces.create",
  "agent_workspaces.list",
  "agent_workspaces.get",
  "agent_workspaces.delete",
  "agent_workspaces.folder.create",
  "agent_workspaces.files.list",
  "agent_workspaces.file.upload",
  "agent_workspaces.file.stat",
  "agent_workspaces.file.download",
  "agent_workspaces.file.write",
  "agent_workspaces.file.delete",
  "agent_workspaces.file.move"
]);

const FEATURE_BY_REGISTRY_FEATURE = Object.freeze({
  auth: "security-permissions",
  discovery: "core-platform",
  events: "core-platform",
  runtime: "core-platform",
  settings: "core-platform",
  storage: "storage-core",
  system: "core-platform",
  raw_objects: "storage-core",
  jobs: "work-queue-core",
  uploads: "work-queue-core",
  tool_management: "tool-management-core",
  mobile_relay: "mobile-relay",
  strategy_management: "strategy-management",
  agent_memory: "agent-memory",
  client_runtime_allocator: "client-runtime-core",
  context_runtime: "client-runtime-core",
  knowledge: "knowledge-core",
  knowledge_taxonomy: "knowledge-core",
  email_rules: "knowledge-core",
  expert_vocabulary: "knowledge-core",
  search: "knowledge-core",
  custom_http_adapter: "agent-gateway",
  agent_gateway: "agent-gateway",
  agent_sync: "agent-gateway",
  oauth: "agent-gateway",
  agent_workspace: "agent-exploration",
  maintenance_agent: "maintenance-agent-runbooks"
});

export function operationFeatureId(operation = {}) {
  const operationId = String(operation.id || "");
  const operationFeature = String(operation.feature || "");

  if (
    LOCAL_SHAREDSPACE_OPERATION_IDS.has(operationId) ||
    operationId.startsWith("workspace.file.") ||
    operationId.startsWith("sharedspace.") ||
    operationId.startsWith("external.cloudDrive.")
  ) {
    return "local-sharedspace";
  }
  if (operationId.startsWith("capability_packages.") || operationId.startsWith("workspace.skill.")) {
    return "skill-hub";
  }

  if (operationId === "knowledge.document_structure" || operationId === "knowledge.hierarchy.audit") {
    return "knowledge-outline-reasoning";
  }
  if (
    operationId.startsWith("knowledge.learning.") ||
    operationId.startsWith("knowledge.evolution.") ||
    operationId.startsWith("knowledge.skills.evaluation.") ||
    operationId.startsWith("knowledge.skills.deployments.") ||
    operationId.startsWith("knowledge.playbook_sets.evaluation.") ||
    operationId.startsWith("knowledge.playbook_sets.deployments.")
  ) {
    return "knowledge-evolution";
  }
  if (operationId.startsWith("external.knowledge.distillation.")) {
    return "external-knowledge-distillation";
  }
  if (operationId.startsWith("knowledge.summarization.")) {
    return "knowledge-summarization";
  }
  if (
    operationId.startsWith("knowledge.agent_skill.") ||
    operationId.startsWith("knowledge.retrieval_playbook.") ||
    operationId.startsWith("knowledge.skills.") ||
    operationId.startsWith("knowledge.playbooks.") ||
    operationId.startsWith("knowledge.playbook_framework.") ||
    operationId.startsWith("knowledge.golden_rules.") ||
    operationId.startsWith("knowledge.rule_authoring.") ||
    operationId.startsWith("knowledge.gold_cases.") ||
    operationId.startsWith("knowledge.training_sets.") ||
    operationId.startsWith("knowledge.evaluation.") ||
    operationId === "knowledge.evidence_gate.evaluate" ||
    operationId === "knowledge.model_roles" ||
    operationId === "knowledge.model_decision"
  ) {
    return "agentlibrary-playbooks";
  }
  if (operationId.startsWith("knowledge.agent_explore.") || operationId.startsWith("agent_workspaces.")) {
    return "agent-exploration";
  }
  if (operationId.startsWith("context.session_memory.") || operationId.startsWith("agent_memory.")) {
    return "agent-memory";
  }
  if (operationId.startsWith("maintenance_agent.")) {
    return "maintenance-agent-runbooks";
  }
  if (["agents.list", "agents.create", "agents.update", "agents.delete"].includes(operationId)) {
    return "agent-management";
  }
  if (operationId === "settings.model_probe") {
    return "agent-gateway";
  }
  if (operationId.startsWith("agent_gateway.") || operationId.startsWith("agent_sync.") || operationId.startsWith("oauth.")) {
    return "agent-gateway";
  }
  if (operationId.startsWith("mobile_relay.")) {
    return "mobile-relay";
  }
  if (operationId.startsWith("repo.")) {
    return "code-repository-operations";
  }
  if (operationId.startsWith("codespace.") || operationId.startsWith("workspace.code.")) {
    return "codespace-management";
  }
  if (operationId.startsWith("gerrit.") || operationId.startsWith("runtime.dependencies.")) {
    return "gerrit-service";
  }

  return FEATURE_BY_REGISTRY_FEATURE[operationFeature] || "core-platform";
}
