import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const TOOL_MANAGEMENT_API_PREFIX = "/api/tool-management/v1";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const ENTITY_CONFIG_ROOT = path.resolve(MODULE_DIR, "../../../../../config/entity-config/tools");

function loadEntityConfigList(kind, fallback = []) {
  const directory = path.join(ENTITY_CONFIG_ROOT, kind);
  let entries = [];
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return fallback;
  }
  const items = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json") || entry.name === "manifest.json") {
      continue;
    }
    const filePath = path.join(directory, entry.name);
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        items.push(parsed);
      }
    } catch (error) {
      throw new Error(`Invalid tool entity config ${filePath}: ${error.message}`);
    }
  }
  if (!items.length) {
    return fallback;
  }
  return items.sort((left, right) => String(left.id || "").localeCompare(String(right.id || "")));
}

const DEFAULT_TOOL_MANAGEMENT_SCOPES = Object.freeze([
  {
    id: "knowledge:read",
    label: "Read knowledge",
    description: "Search and read knowledge items, evidence, graph, skills, and agent context."
  },
  {
    id: "knowledge:write",
    label: "Write knowledge proposals",
    description: "Submit feedback, proposals, summaries, locks, and other non-admin knowledge changes."
  },
  {
    id: "knowledge:maintain",
    label: "Maintain knowledge",
    description: "Run review, learning, evaluation, evolution, and maintenance tasks."
  },
  {
    id: "knowledge:admin",
    label: "Administer knowledge",
    description: "Modify knowledge and context runtime settings."
  },
  {
    id: "workspace:read",
    label: "Read agent workspaces",
    description: "List and read agent workspace metadata, sessions, context summaries, and workspace references."
  },
  {
    id: "workspace:write",
    label: "Write agent workspaces",
    description: "Create workspaces and write non-admin workspace state such as locks and session events."
  },
  {
    id: "workspace:maintain",
    label: "Maintain agent workspaces",
    description: "Manage workspace inheritance, sharing, profiles, reviews, and governance changes."
  },
  {
    id: "repo:read",
    label: "Read repositories",
    description: "Read repository status, files, trees, diffs, commits, review targets, and change metadata."
  },
  {
    id: "repo:write",
    label: "Write repositories",
    description: "Write repository files, branches, commits, pushes, and review proposals."
  },
  {
    id: "repo:review",
    label: "Review repositories",
    description: "Comment on code review targets and request changes."
  },
  {
    id: "repo:approve",
    label: "Approve repositories",
    description: "Approve code review targets without merging or submitting them."
  },
  {
    id: "repo:maintain",
    label: "Maintain repositories",
    description: "Merge, submit, rebase, revert, close, abandon, or force-update repository review targets."
  },
  {
    id: "repo:admin",
    label: "Administer repositories",
    description: "Manage repository protection rules, webhooks, and member permissions."
  },
  {
    id: "storage:read",
    label: "Read storage",
    description: "Read server storage summaries."
  },
  {
    id: "storage:write",
    label: "Write storage",
    description: "Write workspace artifacts and related storage records."
  },
  {
    id: "drive:read",
    label: "Read cloud drives",
    description: "Read cloud drive accounts, safe metadata, downloads, sync plans, and provider status."
  },
  {
    id: "drive:write",
    label: "Write cloud drives",
    description: "Create drive connections and write mediated cloud drive projections."
  },
  {
    id: "drive:sync",
    label: "Sync cloud drives",
    description: "Plan and apply mediated cloud drive sync operations."
  },
  {
    id: "drive:share",
    label: "Read cloud drive permissions",
    description: "Read cloud drive ACL and sharing metadata without exposing provider secrets."
  },
  {
    id: "jobs:read",
    label: "Read jobs",
    description: "Read job lists and job details."
  },
  {
    id: "console:read",
    label: "Read console status",
    description: "Read console-facing status, interface, and release baseline summaries."
  },
  {
    id: "agent_sync:publish",
    label: "Publish agent sync",
    description: "Publish policy-filtered agent sync events."
  },
  {
    id: "auth:admin",
    label: "Administer authorization",
    description: "Create, revoke, inspect, and evaluate unified authorization grants and decisions."
  }
]);

const DEFAULT_TOOL_MANAGEMENT_TOOLSETS = Object.freeze([
  {
    id: "pact.knowledge.read",
    label: "Knowledge read",
    requiredScopes: ["knowledge:read"],
    maxRisk: "read_only",
    grantable: true,
    defaultForAgents: true
  },
  {
    id: "pact.knowledge.write",
    label: "Knowledge write",
    requiredScopes: ["knowledge:read", "knowledge:write"],
    maxRisk: "safe_write",
    grantable: true,
    defaultForAgents: false
  },
  {
    id: "pact.knowledge.maintain",
    label: "Knowledge maintenance",
    requiredScopes: ["knowledge:read", "knowledge:write", "knowledge:maintain"],
    maxRisk: "repair_write",
    grantable: true,
    defaultForAgents: false
  },
  {
    id: "pact.knowledge.admin",
    label: "Knowledge admin",
    requiredScopes: ["knowledge:read", "knowledge:write", "knowledge:maintain", "knowledge:admin"],
    maxRisk: "repair_write",
    grantable: true,
    defaultForAgents: false
  },
  {
    id: "pact.storage.read",
    label: "Storage read",
    requiredScopes: ["storage:read"],
    maxRisk: "read_only",
    grantable: true,
    defaultForAgents: true
  },
  {
    id: "pact.storage.write",
    label: "Storage write",
    requiredScopes: ["storage:write"],
    maxRisk: "safe_write",
    grantable: true,
    defaultForAgents: false
  },
  {
    id: "pact.drive.read",
    label: "Cloud drive read",
    requiredScopes: ["drive:read"],
    maxRisk: "read_only",
    grantable: true,
    defaultForAgents: false
  },
  {
    id: "pact.drive.write",
    label: "Cloud drive write",
    requiredScopes: ["drive:read", "drive:write"],
    maxRisk: "safe_write",
    grantable: true,
    defaultForAgents: false
  },
  {
    id: "pact.drive.sync",
    label: "Cloud drive sync",
    requiredScopes: ["drive:read", "drive:sync"],
    maxRisk: "safe_write",
    grantable: true,
    defaultForAgents: false
  },
  {
    id: "pact.drive.share",
    label: "Cloud drive share",
    requiredScopes: ["drive:read", "drive:share"],
    maxRisk: "read_only",
    grantable: true,
    defaultForAgents: false
  },
  {
    id: "pact.jobs.read",
    label: "Jobs read",
    requiredScopes: ["jobs:read"],
    maxRisk: "read_only",
    grantable: true,
    defaultForAgents: true
  },
  {
    id: "pact.console.read",
    label: "Console read",
    requiredScopes: ["console:read"],
    maxRisk: "read_only",
    grantable: true,
    defaultForAgents: false
  },
  {
    id: "pact.document.parse",
    label: "Document parse",
    requiredScopes: ["knowledge:read"],
    maxRisk: "read_only",
    grantable: true,
    defaultForAgents: false
  },
  {
    id: "pact.document.convert",
    label: "Document convert",
    requiredScopes: ["knowledge:write"],
    maxRisk: "safe_write",
    grantable: true,
    defaultForAgents: false
  },
  {
    id: "pact.mail.import",
    label: "Mail import",
    requiredScopes: ["knowledge:write"],
    maxRisk: "safe_write",
    grantable: true,
    defaultForAgents: false
  },
  {
    id: "pact.result.export",
    label: "Result export",
    requiredScopes: ["knowledge:read"],
    maxRisk: "read_only",
    grantable: true,
    defaultForAgents: false
  },
  {
    id: "pact.agent.workspace.read",
    label: "Agent workspace read",
    requiredScopes: ["workspace:read"],
    maxRisk: "read_only",
    grantable: true,
    defaultForAgents: true
  },
  {
    id: "pact.agent.workspace",
    label: "Agent workspace",
    requiredScopes: ["workspace:read", "workspace:write"],
    maxRisk: "safe_write",
    grantable: true,
    defaultForAgents: false
  },
  {
    id: "pact.agent.workspace.maintain",
    label: "Agent workspace maintain",
    requiredScopes: ["workspace:read", "workspace:write", "workspace:maintain"],
    maxRisk: "repair_write",
    grantable: true,
    defaultForAgents: false
  },
  {
    id: "pact.repo.read",
    label: "Repository read",
    requiredScopes: ["repo:read"],
    maxRisk: "read_only",
    grantable: true,
    defaultForAgents: true
  },
  {
    id: "pact.repo.write",
    label: "Repository write",
    requiredScopes: ["repo:read", "repo:write"],
    maxRisk: "safe_write",
    grantable: true,
    defaultForAgents: false
  },
  {
    id: "pact.repo.review",
    label: "Repository review",
    requiredScopes: ["repo:read", "repo:review"],
    maxRisk: "safe_write",
    grantable: true,
    defaultForAgents: false
  },
  {
    id: "pact.repo.approve",
    label: "Repository approve",
    requiredScopes: ["repo:read", "repo:review", "repo:approve"],
    maxRisk: "safe_write",
    grantable: true,
    defaultForAgents: false
  },
  {
    id: "pact.repo.maintain",
    label: "Repository maintain",
    requiredScopes: ["repo:read", "repo:write", "repo:review", "repo:approve", "repo:maintain"],
    maxRisk: "repair_write",
    grantable: true,
    defaultForAgents: false
  },
  {
    id: "pact.repo.admin",
    label: "Repository admin",
    requiredScopes: ["repo:read", "repo:write", "repo:review", "repo:approve", "repo:maintain", "repo:admin"],
    maxRisk: "repair_write",
    grantable: true,
    defaultForAgents: false
  },
  {
    id: "pact.agent.sync.publish",
    label: "Agent sync publish",
    requiredScopes: ["agent_sync:publish"],
    maxRisk: "safe_write",
    grantable: true,
    defaultForAgents: false
  },
  {
    id: "pact.authorization.admin",
    label: "Authorization admin",
    requiredScopes: ["auth:admin"],
    maxRisk: "repair_write",
    grantable: false,
    defaultForAgents: false
  },
  {
    id: "pact.runtime.read",
    label: "Runtime read",
    requiredScopes: ["storage:read", "jobs:read"],
    maxRisk: "read_only",
    grantable: true,
    defaultForAgents: false
  },
  {
    id: "pact.runtime.maintain",
    label: "Runtime maintain",
    requiredScopes: ["knowledge:maintain"],
    maxRisk: "repair_write",
    grantable: true,
    defaultForAgents: false
  },
  {
    id: "pact.mount.dev",
    label: "Mount development",
    requiredScopes: ["knowledge:admin"],
    maxRisk: "repair_write",
    grantable: false,
    defaultForAgents: false
  },
  {
    id: "pact.admin",
    label: "Pact admin",
    requiredScopes: ["knowledge:admin", "storage:read", "jobs:read", "agent_sync:publish", "auth:admin"],
    maxRisk: "repair_write",
    grantable: false,
    defaultForAgents: false
  }
]);

const DEFAULT_TOOL_MANAGEMENT_PROFILES = Object.freeze([
  {
    id: "maintenance-agent",
    label: "Maintenance Agent",
    agentType: "maintenance",
    toolsets: ["pact.runtime.read", "pact.storage.read", "pact.jobs.read", "pact.knowledge.maintain"],
    toolAllow: [],
    toolDeny: ["pact.admin"],
    maxRisk: "repair_write",
    approvalPolicy: "confirm_repair",
    concurrencyLimit: 1,
    sandboxPolicy: "server-runtime",
    auditTags: ["maintenance-agent"]
  },
  {
    id: "agent-exploration",
    label: "Agent Exploration",
    agentType: "exploration",
    toolsets: ["pact.knowledge.read"],
    toolAllow: [],
    toolDeny: ["pact.admin"],
    maxRisk: "read_only",
    approvalPolicy: "deny_repair",
    concurrencyLimit: 4,
    sandboxPolicy: "knowledge-only",
    auditTags: ["agent-exploration"]
  },
  {
    id: "document-ingestion-agent",
    label: "Document Ingestion Agent",
    agentType: "ingestion",
    toolsets: ["pact.document.parse", "pact.document.convert", "pact.knowledge.write"],
    toolAllow: [],
    toolDeny: ["pact.admin"],
    maxRisk: "safe_write",
    approvalPolicy: "deny_repair",
    concurrencyLimit: 2,
    sandboxPolicy: "document-runtime",
    auditTags: ["document-ingestion"]
  },
  {
    id: "mail-import-agent",
    label: "Mail Import Agent",
    agentType: "mail-import",
    toolsets: ["pact.mail.import", "pact.document.parse", "pact.knowledge.write"],
    toolAllow: [],
    toolDeny: ["pact.admin"],
    maxRisk: "safe_write",
    approvalPolicy: "deny_repair",
    concurrencyLimit: 2,
    sandboxPolicy: "document-runtime",
    auditTags: ["mail-import"]
  },
  {
    id: "external-knowledge-reader",
    label: "External Knowledge Reader",
    agentType: "external",
    toolsets: ["pact.knowledge.read"],
    toolAllow: [],
    toolDeny: ["pact.admin"],
    maxRisk: "read_only",
    approvalPolicy: "deny_write",
    concurrencyLimit: 4,
    sandboxPolicy: "remote-token",
    auditTags: ["external-reader"]
  },
  {
    id: "external-knowledge-writer",
    label: "External Knowledge Writer",
    agentType: "external",
    toolsets: ["pact.knowledge.read", "pact.knowledge.write"],
    toolAllow: [],
    toolDeny: ["pact.admin"],
    maxRisk: "safe_write",
    approvalPolicy: "deny_repair",
    concurrencyLimit: 2,
    sandboxPolicy: "remote-token",
    auditTags: ["external-writer"]
  },
  {
    id: "admin-operator",
    label: "Admin Operator",
    agentType: "operator",
    toolsets: ["pact.admin", "pact.knowledge.admin", "pact.runtime.maintain", "pact.authorization.admin"],
    toolAllow: [],
    toolDeny: [],
    maxRisk: "repair_write",
    approvalPolicy: "confirm_repair",
    concurrencyLimit: 1,
    sandboxPolicy: "server-admin",
    auditTags: ["admin-operator"]
  }
]);

export const TOOL_MANAGEMENT_SCOPES = Object.freeze(
  loadEntityConfigList("scopes", DEFAULT_TOOL_MANAGEMENT_SCOPES)
);
export const TOOL_MANAGEMENT_TOOLSETS = Object.freeze(
  loadEntityConfigList("toolsets", DEFAULT_TOOL_MANAGEMENT_TOOLSETS)
);
export const TOOL_MANAGEMENT_PROFILES = Object.freeze(
  loadEntityConfigList("profiles", DEFAULT_TOOL_MANAGEMENT_PROFILES)
);

const TOOL_ID_BY_OPERATION_ID = Object.freeze({
  "v001.baseline.status": "pact.v001.baseline.status",
  "system.health": "system.health",
  "runtime.info": "pact.runtime.info",
  "runtime.mounts": "pact.runtime.mounts",
  "runtime.set_mounts": "pact.runtime.mounts.set",
  "runtime.reload_mounts": "pact.runtime.mounts.reload",
  "architecture.live_map": "pact.architecture.liveMap",
  "sample_business_pack.list": "pact.sampleBusinessPack.list",
  "sample_business_pack.get": "pact.sampleBusinessPack.get",
  "sample_business_pack.materialize": "pact.sampleBusinessPack.materialize",
  "executive_report.list": "pact.executiveReport.list",
  "executive_report.preview": "pact.executiveReport.preview",
  "executive_report.generate": "pact.executiveReport.generate",
  "module_ecosystem.templates": "pact.modules.templates",
  "module_ecosystem.plan": "pact.modules.plan",
  "module_ecosystem.scaffold": "pact.modules.scaffold",
  "module_ecosystem.contract_test": "pact.modules.contractTest",
  "storage.summary": "pact.storageSummary",
  "storage.backups.list": "pact.storageBackups.list",
  "storage.backups.create": "pact.storageBackups.create",
  "storage.backups.restore_preview": "pact.storageBackups.restorePreview",
  "storage.backups.restore": "pact.storageBackups.restore",
  "jobs.list": "pact.jobs.list",
  "jobs.get": "pact.jobs.get",
  "knowledge.affair_taxonomy": "pact.knowledge.affairTaxonomy",
  "knowledge.console": "pact.knowledge.console",
  "knowledge.config_schema": "pact.knowledge.configSchema",
  "knowledge.capabilities": "pact.knowledge.capabilities",
  "knowledge.export_docx": "pact.knowledge.exportDocx",
  "knowledge.health": "pact.knowledge.health",
  "knowledge.maintenance.get": "pact.knowledge.maintenance.get",
  "knowledge.maintenance.set": "pact.knowledge.maintenance.set",
  "knowledge.reindex": "pact.knowledge.reindex",
  "knowledge.maintenance.run": "pact.knowledge.maintenance.run",
  "knowledge.sync": "pact.knowledge.sync",
  "knowledge.changes": "pact.knowledge.changes",
  "knowledge.review_items": "pact.knowledge.reviewItems",
  "knowledge.review_resolve": "pact.knowledge.reviewResolve",
  "knowledge.feedback": "pact.knowledge.feedback",
  "knowledge.suggestions": "pact.knowledge.suggestions",
  "knowledge.suggestion_resolve": "pact.knowledge.suggestionResolve",
  "knowledge.learning.jobs": "pact.knowledge.learning.jobs",
  "knowledge.learning.health": "pact.knowledge.learning.health",
  "knowledge.evidence_gate.evaluate": "pact.knowledge.evidenceGate.evaluate",
  "knowledge.agent_skill.describe": "pact.knowledge.agentSkill",
  "knowledge.agent_skill.plan": "pact.knowledge.agentSkill.plan",
  "knowledge.agent_skill.run": "pact.knowledge.agentSkill.run",
  "knowledge.skills.list": "pact.knowledge.skills.list",
  "knowledge.skills.get": "pact.knowledge.skills.get",
  "knowledge.skills.generate": "pact.knowledge.skills.generate",
  "knowledge.skills.propose": "pact.knowledge.skills.propose",
  "knowledge.skills.resolve": "pact.knowledge.skills.resolve",
  "knowledge.skills.framework": "pact.knowledge.skillFramework",
  "knowledge.skills.framework_save": "pact.knowledge.skillFramework.set",
  "knowledge.golden_rules.list": "pact.knowledge.goldenRules.list",
  "knowledge.golden_rules.save": "pact.knowledge.goldenRules.set",
  "knowledge.golden_rules.publish": "pact.knowledge.goldenRules.publish",
  "knowledge.golden_rules.rollback": "pact.knowledge.goldenRules.rollback",
  "knowledge.rule_authoring.chat": "pact.knowledge.ruleAuthoring.chat",
  "knowledge.rule_authoring.runs.get": "pact.knowledge.ruleAuthoring.run",
  "knowledge.gold_cases.list": "pact.knowledge.goldCases.list",
  "knowledge.gold_cases.save": "pact.knowledge.goldCases.set",
  "external.knowledge.distillation.service.health": "pact.external.knowledge.distillation.health",
  "external.knowledge.distillation.service.capabilities": "pact.external.knowledge.distillation.capabilities",
  "external.knowledge.distillation.service.runtime_health": "pact.external.knowledge.distillation.runtimeHealth",
  "external.knowledge.distillation.runs.list": "pact.external.knowledge.distillation.runs.list",
  "external.knowledge.distillation.runs.create": "pact.external.knowledge.distillation.runs.create",
  "external.knowledge.distillation.runs.get": "pact.external.knowledge.distillation.runs.get",
  "external.knowledge.distillation.runs.cancel": "pact.external.knowledge.distillation.runs.cancel",
  "external.knowledge.distillation.evidence.query": "pact.external.knowledge.distillation.evidence.query",
  "external.knowledge.distillation.projects.evidence.query": "pact.external.knowledge.distillation.projects.evidence.query",
  "external.knowledge.distillation.artifacts.export": "pact.external.knowledge.distillation.artifacts.export",
  "knowledge.skills.evaluation.runs.create": "pact.knowledge.skills.evaluation.runs.create",
  "knowledge.skills.deployments.create": "pact.knowledge.skills.deployments.create",
  "knowledge.skills.deployments.rollback": "pact.knowledge.skills.deployments.rollback",
  "knowledge.training_sets.export": "pact.knowledge.trainingSets.export",
  "knowledge.evaluation.runs.create": "pact.knowledge.evaluation.runs.create",
  "knowledge.evaluation.runs.list": "pact.knowledge.evaluation.runs.list",
  "knowledge.evaluation.runs.get": "pact.knowledge.evaluation.runs.get",
  "knowledge.model_roles": "pact.knowledge.modelRoles",
  "knowledge.model_decision": "pact.knowledge.modelDecision",
  "knowledge.evolution.describe": "pact.knowledge.evolution",
  "knowledge.evolution.runs.create": "pact.knowledge.evolution.runs.create",
  "knowledge.evolution.runs.list": "pact.knowledge.evolution.runs.list",
  "knowledge.evolution.runs.get": "pact.knowledge.evolution.runs.get",
  "knowledge.hierarchy.audit": "pact.knowledge.hierarchy.audit",
  "knowledge.evolution.deployments.list": "pact.knowledge.evolution.deployments.list",
  "knowledge.evolution.deployments.promote": "pact.knowledge.evolution.deployments.promote",
  "knowledge.evolution.deployments.rollback": "pact.knowledge.evolution.deployments.rollback",
  "context.profiles.get": "pact.context.profiles",
  "context.profiles.set": "pact.context.profiles.set",
  "context.session_memory.get": "pact.agentMemory.sessionMemory.get",
  "context.session_memory.clear": "pact.agentMemory.sessionMemory.clear",
  "client_runtime.profiles.get": "pact.clientRuntime.profiles",
  "client_runtime.profiles.set": "pact.clientRuntime.profiles.set",
  "client_runtime.resolve": "pact.clientRuntime.resolve",
  "client_runtime.bootstrap.plan": "pact.clientRuntime.bootstrapPlan",
  "client_runtime.bootstrap.pull": "pact.clientRuntime.bootstrapPull",
  "client_runtime.status": "pact.clientRuntime.status",
  "agent_workspaces.create": "pact.agentWorkspace.create",
  "agent_workspaces.list": "pact.agentWorkspace.list",
  "agent_workspaces.get": "pact.agentWorkspace.get",
  "agent_workspaces.context.get": "pact.agentWorkspace.context",
  "agent_workspaces.context_bundle.export": "pact.agentWorkspace.contextBundle.export",
  "agent_workspaces.context_bundle.restore": "pact.agentWorkspace.contextBundle.restore",
  "agent_workspaces.chain.get": "pact.agentWorkspace.chain",
  "agent_workspaces.parent.set": "pact.agentWorkspace.parent.set",
  "agent_workspaces.profile.hotswap": "pact.agentWorkspace.profile.hotswap",
  "agent_workspaces.sources.set": "pact.agentWorkspace.sources.set",
  "agent_workspaces.share": "pact.agentWorkspace.share",
  "agent_workspaces.unshare": "pact.agentWorkspace.unshare",
  "agent_workspaces.folder.create": "pact.agentWorkspace.folder.create",
  "agent_workspaces.files.list": "pact.agentWorkspace.files.list",
  "agent_workspaces.file.upload": "pact.agentWorkspace.file.upload",
  "agent_workspaces.file.stat": "pact.agentWorkspace.file.stat",
  "agent_workspaces.file.download": "pact.agentWorkspace.file.download",
  "agent_workspaces.file.write": "pact.agentWorkspace.file.write",
  "agent_workspaces.file.delete": "pact.agentWorkspace.file.delete",
  "agent_workspaces.file.move": "pact.agentWorkspace.file.move",
  "sharedspace.localDir.connect": "pact.sharedspace.localDir.connect",
  "sharedspace.localDir.list": "pact.sharedspace.localDir.list",
  "sharedspace.item.list": "pact.sharedspace.item.list",
  "sharedspace.file.read": "pact.sharedspace.file.read",
  "sharedspace.file.write": "pact.sharedspace.file.write",
  "sharedspace.item.delete": "pact.sharedspace.item.delete",
  "sharedspace.sync.plan": "pact.sharedspace.sync.plan",
  "sharedspace.sync.apply": "pact.sharedspace.sync.apply",
  "sharedspace.drive.connect": "pact.sharedspace.drive.connect",
  "sharedspace.drive.status": "pact.sharedspace.drive.status",
  "sharedspace.drive.item.list": "pact.sharedspace.drive.item.list",
  "sharedspace.drive.file.download": "pact.sharedspace.drive.file.download",
  "sharedspace.drive.file.upload": "pact.sharedspace.drive.file.upload",
  "sharedspace.drive.sync.plan": "pact.sharedspace.drive.sync.plan",
  "sharedspace.drive.sync.apply": "pact.sharedspace.drive.sync.apply",
  "sharedspace.drive.permission.list": "pact.sharedspace.drive.permission.list",
  "workspace.proposal.create": "pact.workspace.proposal.create",
  "workspace.proposal.apply": "pact.workspace.proposal.apply",
  "workspace_governance.describe": "pact.workspaceGovernance.describe",
  "workspace_governance.policy.set": "pact.workspaceGovernance.policy.set",
  "workspace_governance.evaluate": "pact.workspaceGovernance.evaluate",
  "workspace_governance.share_grant": "pact.workspaceGovernance.shareGrant",
  "repo.status": "pact.repo.status",
  "repo.file.read": "pact.repo.file.read",
  "repo.tree.list": "pact.repo.tree.list",
  "repo.diff.read": "pact.repo.diff.read",
  "repo.commit.read": "pact.repo.commit.read",
  "repo.file.create": "pact.repo.file.create",
  "repo.file.update": "pact.repo.file.update",
  "repo.file.delete": "pact.repo.file.delete",
  "repo.file.move": "pact.repo.file.move",
  "repo.branch.create": "pact.repo.branch.create",
  "repo.branch.checkout": "pact.repo.branch.checkout",
  "repo.commit.create": "pact.repo.commit.create",
  "repo.push": "pact.repo.push",
  "repo.proposal.create": "pact.repo.proposal.create",
  "repo.review.comment": "pact.repo.review.comment",
  "repo.review.requestChanges": "pact.repo.review.requestChanges",
  "repo.review.approve": "pact.repo.review.approve",
  "repo.merge": "pact.repo.merge",
  "repo.submit": "pact.repo.submit",
  "repo.rebase": "pact.repo.rebase",
  "repo.revert": "pact.repo.revert",
  "repo.proposal.close": "pact.repo.proposal.close",
  "repo.change.abandon": "pact.repo.change.abandon",
  "repo.protection.set": "pact.repo.protection.set",
  "repo.webhook.set": "pact.repo.webhook.set",
  "repo.member.set": "pact.repo.member.set",
  "gerrit.read": "pact.gerrit.read",
  "gerrit.write": "pact.gerrit.write",
  "gerrit.maintain": "pact.gerrit.maintain",
  "gerrit.git_upload": "pact.gerrit.gitUpload",
  "asset_lineage.describe": "pact.assetLineage.describe",
  "asset_lineage.record": "pact.assetLineage.record",
  "asset_lineage.trace": "pact.assetLineage.trace",
  "asset_lineage.reparse_plan": "pact.assetLineage.reparsePlan",
  "agent_sessions.list": "pact.agentSession.list",
  "agent_sessions.get": "pact.agentSession.get",
  "agent_sessions.context.get": "pact.agentSession.context",
  "agent_sessions.events.append": "pact.agentSession.events.append",
  "agent_sessions.fork": "pact.agentSession.fork",
  "agent_sessions.compare": "pact.agentSession.compare",
  "agent_sessions.merge_proposal": "pact.agentSession.mergeProposal",
  "agent_sessions.archive": "pact.agentSession.archive",
  "agent_workspaces.submissions.resolve": "pact.agentWorkspace.submissionResolve",
  "agent_workspaces.issues.resolve": "pact.agentWorkspace.issueResolve",
  "agent_workspaces.locks.list": "pact.agentWorkspace.locks",
  "agent_workspaces.locks.write": "pact.agentWorkspace.lock",
  "knowledge.summarization.runs.create": "pact.knowledge.summarization.runs.create",
  "knowledge.summarization.runs.get": "pact.knowledge.summarization.runs.get",
  "knowledge.summarization.runs.approve": "pact.knowledge.summarization.runs.approve",
  "knowledge.search": "pact.knowledge.search",
  "knowledge.document_structure": "pact.knowledge.documentStructure",
  "knowledge.item": "pact.knowledge.item",
  "knowledge.evidence": "pact.knowledge.evidence",
  "knowledge.asset": "pact.knowledge.asset",
  "knowledge.render_markdown": "pact.knowledge.renderMarkdown",
  "knowledge.graph": "pact.knowledge.graph",
  "agent_sync.publish": "pact.agentSync.publish",
  "data_connectors.governance.describe": "pact.dataConnectors.governance",
  "data_connectors.governance.plan": "pact.dataConnectors.governance.plan",
  "data_connectors.governance.conformance": "pact.dataConnectors.governance.conformance",
  "performance.capacity.targets": "pact.performance.capacity.targets",
  "performance.capacity.benchmark": "pact.performance.capacity.benchmark",
  "capability_packages.list": "pact.capabilityPackages.list",
  "capability_packages.plan": "pact.capabilityPackages.plan",
  "capability_packages.submit": "pact.capabilityPackages.submit",
  "capability_packages.lifecycle": "pact.capabilityPackages.lifecycle",
  "authorization.subject.resolve": "pact.authorization.subject.resolve",
  "authorization.policy.evaluate": "pact.authorization.policy.evaluate",
  "authorization.governance.summary": "pact.authorization.governance.summary",
  "authorization.roles.list": "pact.authorization.roles.list",
  "authorization.roles.upsert": "pact.authorization.roles.upsert",
  "authorization.teams.list": "pact.authorization.teams.list",
  "authorization.teams.upsert": "pact.authorization.teams.upsert",
  "authorization.users.policies.list": "pact.authorization.users.policies.list",
  "authorization.users.policy.upsert": "pact.authorization.users.policy.upsert",
  "authorization.agent_groups.list": "pact.authorization.agentGroups.list",
  "authorization.agent_groups.upsert": "pact.authorization.agentGroups.upsert",
  "authorization.agents.bindings.list": "pact.authorization.agents.bindings.list",
  "authorization.agents.binding.upsert": "pact.authorization.agents.binding.upsert",
  "authorization.approvals.list": "pact.authorization.approvals.list",
  "authorization.approvals.upsert": "pact.authorization.approvals.upsert",
  "authorization.approvals.revoke": "pact.authorization.approvals.revoke",
  "authorization.receipts.list": "pact.authorization.receipts.list",
  "authorization.loan_records.list": "pact.authorization.loanRecords.list",
  "authorization.denied_requests.list": "pact.authorization.deniedRequests.list",
  "authorization.grants.create": "pact.authorization.grants.create",
  "authorization.grants.revoke": "pact.authorization.grants.revoke",
  "workspace.info": "pact.workspace.info",
  "workspace.file.upload": "pact.workspace.file.upload",
  "workspace.file.list": "pact.workspace.file.list",
  "workspace.file.download": "pact.workspace.file.download",
  "workspace.file.read": "pact.workspace.file.read",
  "workspace.file.write": "pact.workspace.file.write",
  "workspace.file.patch": "pact.workspace.file.patch",
  "workspace.contribution.submit": "pact.workspace.contribution.submit",
  "knowledge.contribution.submit": "pact.knowledge.contribution.submit",
  "workspace.contribution.list": "pact.workspace.contribution.list",
  "workspace.contribution.leaderboard": "pact.workspace.contribution.leaderboard",
  "workspace.contribution.stats": "pact.workspace.contribution.stats",
  "workspace.contribution.report": "pact.workspace.contribution.report",
  "workspace.contribution.assets.list": "pact.workspace.contribution.assets.list",
  "workspace.contribution.permission.request": "pact.workspace.contribution.permission.request",
  "workspace.contribution.permission.grant": "pact.workspace.contribution.permission.grant",
  "workspace.contribution.scan": "pact.workspace.contribution.scan",
  "workspace.contribution.review": "pact.workspace.contribution.review",
  "workspace.contribution.preview": "pact.workspace.contribution.preview",
  "workspace.contribution.publish": "pact.workspace.contribution.publish",
  "workspace.contribution.adopt": "pact.workspace.contribution.adopt",
  "workspace.contribution.reject": "pact.workspace.contribution.reject",
  "workspace.contribution.request_changes": "pact.workspace.contribution.requestChanges",
  "workspace.contribution.revoke": "pact.workspace.contribution.revoke",
  "knowledge.access.evaluate": "pact.knowledge.access.evaluate",
  "knowledge.access.receipt.list": "pact.knowledge.access.receipt.list",
  "knowledge.access.loan_record.list": "pact.knowledge.access.loanRecord.list",
  "knowledge.access.denied_request.list": "pact.knowledge.access.deniedRequest.list",
  "knowledge.evidence.get": "pact.knowledge.evidence.get",
  "knowledge.backend.connect": "pact.knowledge.backend.connect",
  "knowledge.space.list": "pact.knowledge.space.list",
  "knowledge.export.request": "pact.knowledge.export.request",
  "knowledge.permission.request": "pact.knowledge.permission.request",
  "workspace.skill.upload": "pact.workspace.skill.upload",
  "workspace.skill.list": "pact.workspace.skill.list",
  "workspace.skill.download": "pact.workspace.skill.download",
  "workspace.skill.usage.report": "pact.workspace.skill.usage.report",
  "workspace.asset.policy.set": "pact.workspace.asset.policy.set",
  "workspace.asset.permission.check": "pact.workspace.asset.permission.check",
  "workspace.audit.query": "pact.workspace.audit.query",
  "workspace.operation.history": "pact.workspace.operation.history",
  "workspace.checkpoint.tree.list": "pact.workspace.checkpoint.tree.list",
  "workspace.checkpoint.node.get": "pact.workspace.checkpoint.node.get",
  "workspace.checkpoint.diff": "pact.workspace.checkpoint.diff",
  "workspace.checkpoint.restore.preview": "pact.workspace.checkpoint.restore.preview",
  "workspace.checkpoint.restore": "pact.workspace.checkpoint.restore",
  "workspace.checkpoint.scope.query": "pact.workspace.checkpoint.scope.query",
  "workspace.operation.revert.scope": "pact.workspace.operation.revert.scope",
  "workspace.code.target.evaluate": "pact.workspace.code.target.evaluate",
  "workspace.code.change.prepare": "pact.workspace.code.change.prepare",
  "workspace.code.change.upload": "pact.workspace.code.change.upload",
  "workspace.code.change.link": "pact.workspace.code.change.link",
  "workspace.code.change.status.sync": "pact.workspace.code.change.status.sync",
  "codespace.providers.manifest": "pact.codespace.providers.manifest",
  "codespace.repository.status": "pact.codespace.repository.status",
  "codespace.tree.list": "pact.codespace.tree.list",
  "codespace.file.read": "pact.codespace.file.read",
  "codespace.diff.read": "pact.codespace.diff.read",
  "codespace.change.prepare": "pact.codespace.change.prepare",
  "codespace.change.upload": "pact.codespace.change.upload",
  "codespace.review.comment": "pact.codespace.review.comment",
  "codespace.review.requestChanges": "pact.codespace.review.requestChanges",
  "codespace.review.approve": "pact.codespace.review.approve",
  "codespace.review.status.sync": "pact.codespace.review.status.sync",
  "raw-corpus.format.convert": "pact.rawCorpus.format.convert",
  "knowledge.dossier.export": "pact.knowledge.dossier.export"
});

const TOOL_ALIAS_IDS_BY_OPERATION_ID = Object.freeze({
  "agent_workspaces.create": ["pact.workspace.create"],
  "agent_workspaces.folder.create": ["pact.workspace.folder.create"],
  "agent_workspaces.files.list": ["pact.workspace.files.list"],
  "agent_workspaces.file.stat": ["pact.workspace.file.stat"],
  "agent_workspaces.file.delete": ["pact.workspace.file.delete"],
  "agent_workspaces.file.move": ["pact.workspace.file.move"]
});

const SCOPE_BY_OPERATION_ID = Object.freeze({
  "v001.baseline.status": "console:read",
  "system.health": "storage:read",
  "runtime.info": "storage:read",
  "runtime.mounts": "storage:read",
  "runtime.set_mounts": "knowledge:maintain",
  "runtime.reload_mounts": "knowledge:maintain",
  "architecture.live_map": "storage:read",
  "sample_business_pack.list": "storage:read",
  "sample_business_pack.get": "storage:read",
  "sample_business_pack.materialize": "knowledge:maintain",
  "executive_report.list": "storage:read",
  "executive_report.preview": "storage:read",
  "executive_report.generate": "knowledge:maintain",
  "module_ecosystem.templates": "storage:read",
  "module_ecosystem.plan": "knowledge:admin",
  "module_ecosystem.scaffold": "knowledge:admin",
  "module_ecosystem.contract_test": "knowledge:admin",
  "storage.summary": "storage:read",
  "storage.backups.list": "storage:read",
  "storage.backups.create": "knowledge:maintain",
  "storage.backups.restore_preview": "storage:read",
  "storage.backups.restore": "knowledge:maintain",
  "jobs.list": "jobs:read",
  "jobs.get": "jobs:read",
  "knowledge.affair_taxonomy": "knowledge:write",
  "knowledge.maintenance.set": "knowledge:admin",
  "knowledge.reindex": "knowledge:maintain",
  "knowledge.maintenance.run": "knowledge:maintain",
  "knowledge.changes": "knowledge:write",
  "knowledge.review_resolve": "knowledge:maintain",
  "knowledge.feedback": "knowledge:write",
  "knowledge.suggestion_resolve": "knowledge:maintain",
  "knowledge.learning.jobs": "knowledge:maintain",
  "knowledge.skills.generate": "knowledge:maintain",
  "knowledge.skills.propose": "knowledge:write",
  "knowledge.skills.resolve": "knowledge:maintain",
  "knowledge.skills.framework_save": "knowledge:maintain",
  "knowledge.golden_rules.save": "knowledge:maintain",
  "knowledge.golden_rules.publish": "knowledge:maintain",
  "knowledge.golden_rules.rollback": "knowledge:maintain",
  "knowledge.rule_authoring.chat": "knowledge:maintain",
  "knowledge.gold_cases.save": "knowledge:maintain",
  "external.knowledge.distillation.runs.create": "knowledge:maintain",
  "external.knowledge.distillation.runs.cancel": "knowledge:maintain",
  "knowledge.skills.evaluation.runs.create": "knowledge:maintain",
  "knowledge.skills.deployments.create": "knowledge:maintain",
  "knowledge.skills.deployments.rollback": "knowledge:maintain",
  "knowledge.training_sets.export": "knowledge:maintain",
  "knowledge.evaluation.runs.create": "knowledge:maintain",
  "knowledge.evolution.runs.create": "knowledge:maintain",
  "knowledge.hierarchy.audit": "knowledge:maintain",
  "knowledge.evolution.deployments.promote": "knowledge:maintain",
  "knowledge.evolution.deployments.rollback": "knowledge:maintain",
  "context.profiles.set": "knowledge:admin",
  "context.session_memory.clear": "knowledge:admin",
  "client_runtime.profiles.set": "knowledge:admin",
  "client_runtime.bootstrap.plan": "knowledge:read",
  "client_runtime.bootstrap.pull": "knowledge:read",
  "agent_workspaces.create": "workspace:write",
  "agent_workspaces.submissions.resolve": "workspace:maintain",
  "agent_workspaces.issues.resolve": "workspace:maintain",
  "agent_workspaces.context_bundle.restore": "workspace:maintain",
  "workspace.proposal.create": "workspace:write",
  "workspace.proposal.apply": "workspace:maintain",
  "agent_workspaces.parent.set": "workspace:maintain",
  "agent_workspaces.profile.hotswap": "workspace:maintain",
  "agent_workspaces.sources.set": "workspace:maintain",
  "agent_workspaces.share": "workspace:maintain",
  "agent_workspaces.unshare": "workspace:maintain",
  "agent_workspaces.folder.create": "storage:write",
  "agent_workspaces.files.list": "storage:read",
  "agent_workspaces.file.upload": "storage:write",
  "agent_workspaces.file.stat": "storage:read",
  "agent_workspaces.file.download": "storage:read",
  "agent_workspaces.file.write": "storage:write",
  "agent_workspaces.file.delete": "storage:write",
  "agent_workspaces.file.move": "storage:write",
  "sharedspace.localDir.connect": "storage:write",
  "sharedspace.localDir.list": "storage:read",
  "sharedspace.item.list": "storage:read",
  "sharedspace.file.read": "storage:read",
  "sharedspace.file.write": "storage:write",
  "sharedspace.item.delete": "storage:write",
  "sharedspace.sync.plan": "storage:read",
  "sharedspace.sync.apply": "storage:write",
  "sharedspace.drive.connect": "drive:write",
  "sharedspace.drive.status": "drive:read",
  "sharedspace.drive.item.list": "drive:read",
  "sharedspace.drive.file.download": "drive:read",
  "sharedspace.drive.file.upload": "drive:write",
  "sharedspace.drive.sync.plan": "drive:sync",
  "sharedspace.drive.sync.apply": "drive:sync",
  "sharedspace.drive.permission.list": "drive:share",
  "workspace_governance.describe": "workspace:read",
  "workspace_governance.policy.set": "workspace:maintain",
  "workspace_governance.evaluate": "workspace:read",
  "workspace_governance.share_grant": "workspace:maintain",
  "repo.status": "repo:read",
  "repo.file.read": "repo:read",
  "repo.tree.list": "repo:read",
  "repo.diff.read": "repo:read",
  "repo.commit.read": "repo:read",
  "repo.file.create": "repo:write",
  "repo.file.update": "repo:write",
  "repo.file.delete": "repo:write",
  "repo.file.move": "repo:write",
  "repo.branch.create": "repo:write",
  "repo.branch.checkout": "repo:write",
  "repo.commit.create": "repo:write",
  "repo.push": "repo:write",
  "repo.proposal.create": "repo:write",
  "repo.review.comment": "repo:review",
  "repo.review.requestChanges": "repo:review",
  "repo.review.approve": "repo:approve",
  "repo.merge": "repo:maintain",
  "repo.submit": "repo:maintain",
  "repo.rebase": "repo:maintain",
  "repo.revert": "repo:maintain",
  "repo.proposal.close": "repo:maintain",
  "repo.change.abandon": "repo:maintain",
  "repo.protection.set": "repo:admin",
  "repo.webhook.set": "repo:admin",
  "repo.member.set": "repo:admin",
  "gerrit.read": "repo:read",
  "gerrit.write": "repo:write",
  "gerrit.maintain": "repo:maintain",
  "gerrit.git_upload": "repo:maintain",
  "asset_lineage.describe": "knowledge:read",
  "asset_lineage.record": "knowledge:maintain",
  "asset_lineage.trace": "knowledge:read",
  "asset_lineage.reparse_plan": "knowledge:maintain",
  "agent_workspaces.locks.write": "workspace:write",
  "agent_sessions.events.append": "workspace:write",
  "agent_sessions.fork": "workspace:write",
  "agent_sessions.merge_proposal": "workspace:write",
  "agent_sessions.archive": "workspace:write",
  "knowledge.summarization.runs.create": "knowledge:write",
  "knowledge.summarization.runs.approve": "knowledge:maintain",
  "agent_sync.publish": "agent_sync:publish",
  "data_connectors.governance.describe": "knowledge:read",
  "data_connectors.governance.plan": "knowledge:maintain",
  "data_connectors.governance.conformance": "knowledge:maintain",
  "performance.capacity.targets": "knowledge:read",
  "performance.capacity.benchmark": "knowledge:maintain",
  "capability_packages.list": "knowledge:read",
  "capability_packages.plan": "knowledge:maintain",
  "capability_packages.submit": "knowledge:maintain",
  "capability_packages.lifecycle": "knowledge:maintain",
  "authorization.subject.resolve": "auth:admin",
  "authorization.policy.evaluate": "auth:admin",
  "authorization.governance.summary": "auth:admin",
  "authorization.roles.list": "auth:admin",
  "authorization.roles.upsert": "auth:admin",
  "authorization.teams.list": "auth:admin",
  "authorization.teams.upsert": "auth:admin",
  "authorization.users.policies.list": "auth:admin",
  "authorization.users.policy.upsert": "auth:admin",
  "authorization.agent_groups.list": "auth:admin",
  "authorization.agent_groups.upsert": "auth:admin",
  "authorization.agents.bindings.list": "auth:admin",
  "authorization.agents.binding.upsert": "auth:admin",
  "authorization.approvals.list": "auth:admin",
  "authorization.approvals.upsert": "auth:admin",
  "authorization.approvals.revoke": "auth:admin",
  "authorization.receipts.list": "auth:admin",
  "authorization.loan_records.list": "auth:admin",
  "authorization.denied_requests.list": "auth:admin",
  "authorization.grants.create": "auth:admin",
  "authorization.grants.revoke": "auth:admin",
  "workspace.info": "workspace:read",
  "workspace.file.upload": "storage:write",
  "workspace.file.list": "storage:read",
  "workspace.file.download": "storage:read",
  "workspace.file.read": "storage:read",
  "workspace.file.write": "storage:write",
  "workspace.file.patch": "storage:write",
  "workspace.contribution.submit": "workspace:write",
  "knowledge.contribution.submit": "knowledge:write",
  "workspace.contribution.list": "workspace:read",
  "workspace.contribution.leaderboard": "workspace:read",
  "workspace.contribution.stats": "workspace:read",
  "workspace.contribution.report": "workspace:read",
  "workspace.contribution.assets.list": "workspace:read",
  "workspace.contribution.permission.request": "workspace:write",
  "workspace.contribution.permission.grant": "workspace:maintain",
  "workspace.contribution.scan": "workspace:maintain",
  "workspace.contribution.review": "workspace:maintain",
  "workspace.contribution.preview": "workspace:maintain",
  "workspace.contribution.publish": "workspace:maintain",
  "workspace.contribution.adopt": "workspace:write",
  "workspace.contribution.reject": "workspace:maintain",
  "workspace.contribution.request_changes": "workspace:maintain",
  "workspace.contribution.revoke": "workspace:maintain",
  "knowledge.access.evaluate": "knowledge:read",
  "knowledge.access.receipt.list": "knowledge:read",
  "knowledge.access.loan_record.list": "knowledge:read",
  "knowledge.access.denied_request.list": "knowledge:read",
  "knowledge.evidence.get": "knowledge:read",
  "knowledge.backend.connect": "knowledge:maintain",
  "knowledge.space.list": "knowledge:read",
  "knowledge.export.request": "knowledge:write",
  "knowledge.permission.request": "knowledge:write",
  "workspace.skill.upload": "workspace:write",
  "workspace.skill.list": "workspace:read",
  "workspace.skill.download": "workspace:read",
  "workspace.skill.usage.report": "workspace:write",
  "workspace.asset.policy.set": "workspace:maintain",
  "workspace.asset.permission.check": "workspace:read",
  "workspace.audit.query": "workspace:read",
  "workspace.operation.history": "workspace:read",
  "workspace.checkpoint.tree.list": "workspace:read",
  "workspace.checkpoint.node.get": "workspace:read",
  "workspace.checkpoint.diff": "workspace:read",
  "workspace.checkpoint.restore.preview": "workspace:maintain",
  "workspace.checkpoint.restore": "workspace:maintain",
  "workspace.checkpoint.scope.query": "workspace:read",
  "workspace.operation.revert.scope": "workspace:maintain",
  "workspace.code.target.evaluate": "repo:read",
  "workspace.code.change.prepare": "repo:write",
  "workspace.code.change.upload": "repo:maintain",
  "workspace.code.change.link": "repo:write",
  "workspace.code.change.status.sync": "repo:read",
  "codespace.providers.manifest": "repo:read",
  "codespace.repository.status": "repo:read",
  "codespace.tree.list": "repo:read",
  "codespace.file.read": "repo:read",
  "codespace.diff.read": "repo:read",
  "codespace.change.prepare": "repo:write",
  "codespace.change.upload": "repo:maintain",
  "codespace.review.comment": "repo:review",
  "codespace.review.requestChanges": "repo:review",
  "codespace.review.approve": "repo:approve",
  "codespace.review.status.sync": "repo:read",
  "raw-corpus.format.convert": "knowledge:write",
  "knowledge.dossier.export": "knowledge:read"
});

const TOOLSET_BY_SCOPE = Object.freeze({
  "knowledge:read": "pact.knowledge.read",
  "knowledge:write": "pact.knowledge.write",
  "knowledge:maintain": "pact.knowledge.maintain",
  "knowledge:admin": "pact.knowledge.admin",
  "workspace:read": "pact.agent.workspace.read",
  "workspace:write": "pact.agent.workspace",
  "workspace:maintain": "pact.agent.workspace.maintain",
  "repo:read": "pact.repo.read",
  "repo:write": "pact.repo.write",
  "repo:review": "pact.repo.review",
  "repo:approve": "pact.repo.approve",
  "repo:maintain": "pact.repo.maintain",
  "repo:admin": "pact.repo.admin",
  "storage:read": "pact.storage.read",
  "storage:write": "pact.storage.write",
  "drive:read": "pact.drive.read",
  "drive:write": "pact.drive.write",
  "drive:sync": "pact.drive.sync",
  "drive:share": "pact.drive.share",
  "jobs:read": "pact.jobs.read",
  "console:read": "pact.console.read",
  "agent_sync:publish": "pact.agent.sync.publish",
  "auth:admin": "pact.authorization.admin"
});

const RISK_RANK = Object.freeze({
  read_only: 0,
  safe_write: 1,
  repair_write: 2,
  destructive: 3
});

const TOOLSET_BY_ID = new Map(TOOL_MANAGEMENT_TOOLSETS.map((toolset) => [toolset.id, toolset]));

function riskRank(risk = "read_only") {
  return RISK_RANK[String(risk || "read_only")] ?? RISK_RANK.read_only;
}

function toolsetAllowsRisk(toolsetId, risk = "read_only") {
  const declaredRisk = TOOLSET_BY_ID.get(toolsetId)?.maxRisk || "read_only";
  return riskRank(risk) <= riskRank(declaredRisk);
}

function uniqueStrings(values = []) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function stableJson(value) {
  if (value === null || value === undefined) {
    return "null";
  }
  if (typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
    .join(",")}}`;
}

function fingerprint(value) {
  return crypto.createHash("sha256").update(stableJson(value)).digest("hex");
}

function operationScope(operation) {
  if (SCOPE_BY_OPERATION_ID[operation.id]) {
    return SCOPE_BY_OPERATION_ID[operation.id];
  }
  const operationId = String(operation.id || "");
  if (
    operationId.startsWith("knowledge.") ||
    operationId.startsWith("external.knowledge.") ||
    operationId.startsWith("context.") ||
    operationId.startsWith("client_runtime.") ||
    operationId.startsWith("agent_workspaces.") ||
    operationId.startsWith("agent_sessions.")
  ) {
    return operationId.startsWith("agent_workspaces.") || operationId.startsWith("agent_sessions.")
      ? "workspace:read"
      : "knowledge:read";
  }
  if (operationId.startsWith("jobs.")) {
    return "jobs:read";
  }
  return "";
}

function normalizeRisk(operation = {}) {
  if (operation.destructive) {
    return "destructive";
  }
  const risk = String(operation.safety?.risk || "").trim();
  if (risk && RISK_RANK[risk] !== undefined) {
    return risk;
  }
  return operation.readOnly === false ? "safe_write" : "read_only";
}

function inferToolsets(operation, scopes = [], toolId = "", risk = "read_only") {
  const toolsets = new Set(scopes.map((scope) => TOOLSET_BY_SCOPE[scope]).filter(Boolean));
  if (toolId.startsWith("pact.runtime.")) {
    if (operation.id === "runtime.info" || operation.id === "runtime.mounts") {
      toolsets.add("pact.runtime.read");
    } else {
      toolsets.add("pact.runtime.maintain");
    }
  }
  if (toolId.startsWith("pact.architecture.")) {
    toolsets.add("pact.runtime.read");
  }
  if (toolId.startsWith("pact.sampleBusinessPack.")) {
    toolsets.add(operation.id === "sample_business_pack.materialize" ? "pact.knowledge.maintain" : "pact.runtime.read");
  }
  if (toolId.startsWith("pact.storageBackups.")) {
    toolsets.add(
      operation.id === "storage.backups.list" || operation.id === "storage.backups.restore_preview"
        ? "pact.runtime.read"
        : "pact.runtime.maintain"
    );
  }
  if (toolId.startsWith("pact.modules.")) {
    toolsets.add(operation.id === "module_ecosystem.templates" ? "pact.runtime.read" : "pact.mount.dev");
  }
  if (toolId.startsWith("pact.executiveReport.")) {
    toolsets.add(operation.id === "executive_report.generate" ? "pact.knowledge.maintain" : "pact.runtime.read");
  }
  if (
    toolId.startsWith("pact.agentWorkspace.") ||
    toolId.startsWith("pact.workspace.") ||
    toolId.startsWith("pact.sharedspace.") ||
    toolId.startsWith("pact.agentSession.") ||
    toolId.startsWith("pact.workspaceGovernance.")
  ) {
    toolsets.add("pact.agent.workspace");
  }
  if (toolId.includes(".renderMarkdown")) {
    toolsets.add("pact.result.export");
  }
  if (toolId.includes(".asset") || toolId.includes(".evidence")) {
    toolsets.add("pact.document.parse");
  }
  if (toolId.startsWith("pact.assetLineage.")) {
    toolsets.add("pact.document.parse");
    toolsets.add("pact.knowledge.maintain");
  }
  if (operation.id === "agent_sync.publish") {
    toolsets.add("pact.agent.sync.publish");
  }
  return [...toolsets].filter((toolsetId) => toolsetAllowsRisk(toolsetId, risk));
}

function normalizeHttpEndpoint(operation = {}) {
  const method = String(operation.http?.method || "POST").toUpperCase();
  const path = String(operation.http?.path || "");
  const query = Array.isArray(operation.http?.query) && operation.http.query.length
    ? `?${operation.http.query.map((item) => `${item.name.toUpperCase()}=${item.name}`).join("&")}`
    : "";
  return { method, endpoint: `${path}${query}` };
}

function createInternalToolDefinition({
  id,
  label,
  description,
  owner = "pact",
  source = "handler-backed",
  handlerId,
  featureId = "core-platform",
  toolsets,
  requiredScopes,
  risk = "read_only",
  inputSchema = { type: "object" },
  tags = []
}) {
  const writeCapable = risk !== "read_only";
  const approvalRequired = risk === "repair_write" || risk === "destructive";
  return {
    id,
    version: "1",
    label,
    description,
    owner,
    source,
    featureId,
    operationId: "",
    handlerId,
    transport: {
      internal: true
    },
    toolsets: uniqueStrings(toolsets),
    requiredScopes: uniqueStrings(requiredScopes),
    inputSchema,
    outputSchema: { type: "object" },
    risk,
    readOnly: !writeCapable,
    destructive: risk === "destructive",
    concurrencySafe: risk === "read_only",
    requiresApproval: approvalRequired,
    approvalScope: approvalRequired ? "tool:approve" : "",
    timeoutMs: 30_000,
    maxResultBytes: 2 * 1024 * 1024,
    redactionPolicy: {
      input: "default",
      output: "summary"
    },
    auditPolicy: {
      enabled: true,
      recordInput: true,
      recordOutput: false
    },
    telemetryPolicy: {
      enabled: true
    },
    status: "internal",
    tags: uniqueStrings([source, featureId, risk, ...tags])
  };
}

function createInternalToolDefinitions() {
  return [
    createInternalToolDefinition({
      id: "agent-exploration.knowledge_skill_search",
      label: "Agent exploration skill search",
      description: "Search published Pact KnowledgeSkills inside the agent exploration runtime.",
      handlerId: "AgentExplorationRuntime.knowledge_skill_search",
      toolsets: ["pact.knowledge.read"],
      requiredScopes: ["knowledge:read"],
      featureId: "agent-exploration",
      tags: ["agent-exploration"]
    }),
    createInternalToolDefinition({
      id: "agent-exploration.keyword_search",
      label: "Agent exploration keyword search",
      description: "Run local knowledge recall inside the agent exploration runtime.",
      handlerId: "AgentExplorationRuntime.keyword_search",
      toolsets: ["pact.knowledge.read"],
      requiredScopes: ["knowledge:read"],
      featureId: "agent-exploration",
      tags: ["agent-exploration"]
    }),
    createInternalToolDefinition({
      id: "agent-exploration.knowledge_aggregate",
      label: "Agent exploration aggregate",
      description: "Run knowledge aggregation inside the agent exploration runtime.",
      handlerId: "AgentExplorationRuntime.knowledge_aggregate",
      toolsets: ["pact.knowledge.read"],
      requiredScopes: ["knowledge:read"],
      featureId: "agent-exploration",
      tags: ["agent-exploration"]
    }),
    createInternalToolDefinition({
      id: "agent-exploration.open_evidence",
      label: "Agent exploration open evidence",
      description: "Open a specific evidence pack inside the agent exploration runtime.",
      handlerId: "AgentExplorationRuntime.open_evidence",
      toolsets: ["pact.knowledge.read", "pact.document.parse"],
      requiredScopes: ["knowledge:read"],
      featureId: "agent-exploration",
      tags: ["agent-exploration"]
    }),
    createInternalToolDefinition({
      id: "agent-exploration.knowledge_skill_propose",
      label: "Agent exploration skill proposal",
      description: "Create a pending-review KnowledgeSkill from evidence found by an exploration run.",
      handlerId: "AgentExplorationRuntime.knowledge_skill_propose",
      toolsets: ["pact.knowledge.write", "pact.agent.workspace"],
      requiredScopes: ["knowledge:read", "knowledge:write"],
      risk: "safe_write",
      featureId: "agent-exploration",
      tags: ["agent-exploration"]
    }),
    createInternalToolDefinition({
      id: "agent-exploration.golden_rule_authoring",
      label: "Agent exploration golden rule authoring",
      description: "Create a pending-review golden rule draft through the agent exploration runtime.",
      handlerId: "AgentExplorationRuntime.golden_rule_authoring",
      toolsets: ["pact.knowledge.write", "pact.agent.workspace"],
      requiredScopes: ["knowledge:read", "knowledge:write"],
      risk: "safe_write",
      featureId: "agent-exploration",
      tags: ["agent-exploration", "rule-authoring"]
    }),
    createInternalToolDefinition({
      id: "agent-exploration.http_request",
      label: "Agent exploration HTTP request",
      description: "Call an allowlisted HTTP endpoint from the agent exploration runtime.",
      handlerId: "AgentExplorationRuntime.http_request",
      toolsets: ["pact.agent.workspace"],
      requiredScopes: ["knowledge:read", "knowledge:write"],
      risk: "safe_write",
      featureId: "agent-exploration",
      tags: ["agent-exploration", "allowlisted-http"]
    }),
    createInternalToolDefinition({
      id: "agent-exploration.local_command",
      label: "Agent exploration local command",
      description: "Run an allowlisted local command from the agent exploration runtime.",
      handlerId: "AgentExplorationRuntime.local_command",
      toolsets: ["pact.mount.dev"],
      requiredScopes: ["knowledge:admin"],
      risk: "repair_write",
      featureId: "agent-exploration",
      tags: ["agent-exploration", "allowlisted-command"]
    }),
    ...[
      ["system.health", "System health", "pact.runtime.read", "storage:read", "read_only"],
      ["runtime.info", "Runtime info", "pact.runtime.read", "storage:read", "read_only"],
      ["storage.summary", "Storage summary", "pact.storage.read", "storage:read", "read_only"],
      ["storage.doctor", "Storage doctor", "pact.runtime.read", "storage:read", "read_only"],
      ["storage.reconcile", "Storage reconcile", "pact.runtime.maintain", "knowledge:maintain", "repair_write"],
      ["jobs.list", "Jobs list", "pact.jobs.read", "jobs:read", "read_only"],
      ["jobs.failed_review", "Failed jobs review", "pact.jobs.read", "jobs:read", "read_only"],
      ["knowledge.health", "Knowledge health", "pact.knowledge.read", "knowledge:read", "read_only"],
      ["knowledge.maintenance.settings", "Knowledge maintenance settings", "pact.knowledge.maintain", "knowledge:maintain", "read_only"],
      ["knowledge.maintenance.run", "Knowledge maintenance run", "pact.knowledge.maintain", "knowledge:maintain", "safe_write"],
      ["knowledge.reindex", "Knowledge reindex", "pact.knowledge.maintain", "knowledge:maintain", "repair_write"],
      ["runtime.reload_mounts", "Runtime reload mounts", "pact.runtime.maintain", "knowledge:maintain", "repair_write"]
    ].map(([toolName, label, toolset, scope, risk]) =>
      createInternalToolDefinition({
        id: `maintenance-agent.${toolName}`,
        label: `Maintenance agent ${label}`,
        description: `Run ${label.toLowerCase()} through the MaintenanceAgent internal tool registry.`,
        handlerId: `MaintenanceAgent.${toolName}`,
        toolsets: [toolset],
        requiredScopes: [scope],
        risk,
        featureId: "maintenance-agent-runbooks",
        tags: ["maintenance-agent"]
      })
    )
  ];
}

function validateToolDefinitions(tools = [], operationsById = new Map()) {
  const ids = new Set();
  const validScopes = new Set(TOOL_MANAGEMENT_SCOPES.map((scope) => scope.id));
  const validToolsets = new Set(TOOL_MANAGEMENT_TOOLSETS.map((toolset) => toolset.id));
  const toolsetById = new Map(TOOL_MANAGEMENT_TOOLSETS.map((toolset) => [toolset.id, toolset]));
  for (const tool of tools) {
    if (!tool.id) {
      throw new Error("Tool definition is missing id.");
    }
    if (ids.has(tool.id)) {
      throw new Error(`Duplicate tool id: ${tool.id}`);
    }
    ids.add(tool.id);
    if (tool.operationId && !operationsById.has(tool.operationId)) {
      throw new Error(`Tool ${tool.id} references unknown operation: ${tool.operationId}`);
    }
    for (const scope of tool.requiredScopes || []) {
      if (!validScopes.has(scope)) {
        throw new Error(`Tool ${tool.id} references unknown scope: ${scope}`);
      }
    }
    for (const toolset of tool.toolsets || []) {
      if (!validToolsets.has(toolset)) {
        throw new Error(`Tool ${tool.id} references unknown toolset: ${toolset}`);
      }
    }
    if (!tool.toolsets?.length) {
      throw new Error(`Tool ${tool.id} must belong to at least one toolset.`);
    }
    const unsafeToolsets = (tool.toolsets || []).filter((toolset) => {
      const declaredRisk = toolsetById.get(toolset)?.maxRisk || "read_only";
      return riskRank(tool.risk) > riskRank(declaredRisk);
    });
    if (unsafeToolsets.length > 0) {
      throw new Error(`Tool ${tool.id} risk ${tool.risk} exceeds declared toolset risk for ${unsafeToolsets.join(", ")}.`);
    }
    if (tool.readOnly === false && tool.auditPolicy?.enabled !== true) {
      throw new Error(`Write-capable tool ${tool.id} must enable audit.`);
    }
    if ((tool.destructive || tool.requiresApproval) && !tool.approvalScope) {
      throw new Error(`Approval-capable tool ${tool.id} must declare approvalScope.`);
    }
  }
}

export function scopesToToolsets(scopes = []) {
  return uniqueStrings(scopes.map((scope) => TOOLSET_BY_SCOPE[scope]).filter(Boolean));
}

export function toolsetsToScopes(toolsets = []) {
  const selected = new Set(toolsets);
  const scopes = [];
  for (const toolset of TOOL_MANAGEMENT_TOOLSETS) {
    if (!selected.has(toolset.id)) {
      continue;
    }
    scopes.push(...(toolset.requiredScopes || []));
  }
  return uniqueStrings(scopes);
}

export function createToolCatalog({ operations = [], activeFeatureIds = null } = {}) {
  const operationsById = new Map(operations.map((operation) => [operation.id, operation]));
  const activeFeatureSet = activeFeatureIds?.length ? new Set(activeFeatureIds) : null;
  const tools = [];
  for (const operation of operations) {
    const toolId = TOOL_ID_BY_OPERATION_ID[operation.id];
    if (!toolId) {
      continue;
    }
    const scope = operationScope(operation);
    const requiredScopes = scope ? [scope] : [];
    const { method, endpoint } = normalizeHttpEndpoint(operation);
    const risk = normalizeRisk(operation);
    const requiresApproval = operation.destructive === true || risk === "destructive" || operation.safety?.requiresConfirmation === true;
    const tool = {
      id: toolId,
      version: "1",
      label: String(operation.label || toolId),
      description: String(operation.description || operation.label || toolId),
      owner: "pact",
      source: "operation-backed",
      featureId: operation.featureId || "",
      operationId: operation.id,
      handlerId: operation.target?.method || "",
      transport: {
        http: {
          method,
          path: operation.http?.path || "",
          query: operation.http?.query || []
        },
        rpc: operation.rpc || null,
        cli: operation.cli || null,
        binary: operation.binary === true
      },
      toolsets: inferToolsets(operation, requiredScopes, toolId, risk),
      requiredScopes,
      inputSchema: operation.inputSchema || { type: "object" },
      outputSchema: operation.binary ? { type: "binary" } : { type: "object" },
      risk,
      readOnly: operation.readOnly !== false,
      destructive: operation.destructive === true || risk === "destructive",
      concurrencySafe: operation.concurrencySafe === true,
      requiresApproval,
      approvalScope: requiresApproval ? operation.safety?.approvalScope || "tool:approve" : "",
      timeoutMs: 30_000,
      maxResultBytes: operation.binary ? 32 * 1024 * 1024 : 2 * 1024 * 1024,
      redactionPolicy: {
        input: "default",
        output: operation.audit?.recordOutput === true ? "default" : "summary"
      },
      auditPolicy: {
        enabled: true,
        recordInput: operation.audit?.recordInput !== false,
        recordOutput: operation.audit?.recordOutput === true
      },
      telemetryPolicy: {
        enabled: true
      },
      status: "active",
      tags: uniqueStrings([operation.featureId || "", operation.feature, operation.binary ? "binary" : "", risk])
    };
    tools.push(tool);
    for (const aliasId of TOOL_ALIAS_IDS_BY_OPERATION_ID[operation.id] || []) {
      tools.push({
        ...tool,
        id: aliasId,
        label: `${tool.label} (${aliasId})`,
        tags: uniqueStrings([...tool.tags, "alias"])
      });
    }
  }
  tools.push(
    ...createInternalToolDefinitions().filter((tool) =>
      !activeFeatureSet || activeFeatureSet.has(tool.featureId || "core-platform")
    )
  );
  const catalog = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    scopes: TOOL_MANAGEMENT_SCOPES,
    toolsets: TOOL_MANAGEMENT_TOOLSETS,
    profiles: TOOL_MANAGEMENT_PROFILES,
    tools
  };
  validateToolDefinitions(tools, operationsById);
  return {
    ...catalog,
    fingerprint: fingerprint(tools.map((tool) => ({
      id: tool.id,
      version: tool.version,
      operationId: tool.operationId,
      toolsets: tool.toolsets,
      scopes: tool.requiredScopes,
      risk: tool.risk
    })))
  };
}

export function createToolCatalogRegistry({ operations = [], activeFeatureIds = null } = {}) {
  let catalog = createToolCatalog({ operations, activeFeatureIds });
  let toolsById = new Map(catalog.tools.map((tool) => [tool.id, tool]));
  let toolsByOperationId = new Map(catalog.tools.filter((tool) => tool.operationId).map((tool) => [tool.operationId, tool]));

  function refresh(nextOperations = operations) {
    catalog = createToolCatalog({ operations: nextOperations, activeFeatureIds });
    toolsById = new Map(catalog.tools.map((tool) => [tool.id, tool]));
    toolsByOperationId = new Map(catalog.tools.filter((tool) => tool.operationId).map((tool) => [tool.operationId, tool]));
    return catalog;
  }

  function listTools(filters = {}) {
    return catalog.tools.filter((tool) => {
      if (filters.status && tool.status !== filters.status) {
        return false;
      }
      if (filters.toolset && !tool.toolsets.includes(filters.toolset)) {
        return false;
      }
      if (filters.scope && !tool.requiredScopes.includes(filters.scope)) {
        return false;
      }
      if (filters.risk && tool.risk !== filters.risk) {
        return false;
      }
      if (filters.owner && tool.owner !== filters.owner) {
        return false;
      }
      return true;
    });
  }

  function resolveToolset(input = {}) {
    const requestedToolsets = uniqueStrings(input.toolsets || input.toolsetIds || input.toolset || []);
    const requestedScopes = uniqueStrings(input.scopes || input.scopeIds || input.scope || []);
    const requestedCombined = [...new Set([...requestedToolsets, ...scopesToToolsets(requestedScopes)])];
    const allow = new Set(uniqueStrings(input.toolAllow || []));
    const deny = new Set(uniqueStrings(input.toolDeny || []));
    const selected = requestedCombined.length
      ? new Set(requestedCombined)
      : new Set(TOOL_MANAGEMENT_TOOLSETS.filter((toolset) => toolset.defaultForAgents).map((toolset) => toolset.id));
    const tools = catalog.tools.filter((tool) => {
      if (deny.has(tool.id)) {
        return false;
      }
      if (allow.size > 0 && !allow.has(tool.id)) {
        return false;
      }
      return tool.toolsets.some((toolset) => selected.has(toolset));
    });
    return {
      toolsets: [...selected],
      tools,
      toolIds: tools.map((tool) => tool.id),
      requiredScopes: uniqueStrings([
        ...toolsetsToScopes([...selected]),
        ...tools.flatMap((tool) => tool.requiredScopes)
      ]),
      maxRisk: tools.reduce((max, tool) => (riskRank(tool.risk) > riskRank(max) ? tool.risk : max), "read_only")
    };
  }

  return {
    refresh,
    getCatalog: () => catalog,
    listTools,
    getTool: (toolId) => toolsById.get(String(toolId || "")) || null,
    getToolByOperationId: (operationId) => toolsByOperationId.get(String(operationId || "")) || null,
    listToolsets: () => TOOL_MANAGEMENT_TOOLSETS,
    listProfiles: () => TOOL_MANAGEMENT_PROFILES,
    resolveToolset
  };
}
