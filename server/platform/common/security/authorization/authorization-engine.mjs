import crypto from "node:crypto";

export const AUTHORIZATION_PROTOCOL_VERSION = "pact.authorization.v1";

function hardcodedCapabilityLines(block) {
  return Object.freeze(
    String(block || "")
      .trim()
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
  );
}

export const KERNEL_API_OPERATION_IDS = hardcodedCapabilityLines(`
agent_gateway.call
agent_gateway.config.get
agent_gateway.config.set
agent_sessions.archive
agent_sessions.compare
agent_sessions.context.get
agent_sessions.events.append
agent_sessions.fork
agent_sessions.get
agent_sessions.list
agent_sessions.merge_proposal
agent_sync.config.get
agent_sync.config.set
agent_sync.publish
agent_sync.subscribe
acp_agent_relay.downstream_clients.refresh
acp_agent_relay.fs.read_text_file
acp_agent_relay.fs.write_text_file
acp_agent_relay.permission.resolve
acp_agent_relay.prompt.send
acp_agent_relay.session.cancel
acp_agent_relay.session.close
acp_agent_relay.session.create
acp_agent_relay.session.resume
acp_agent_relay.session.wake
acp_agent_relay.sessions.get
acp_agent_relay.sessions.list
acp_agent_relay.targets.list
acp_agent_relay.targets.upsert
acp_agent_relay.turn.observe
acp_agent_relay.turns.list
acp_agent_relay.virtual_agent.initialize
acp_agent_relay.virtual_agents.list
acp_agent_relay.virtual_agents.upsert
agent_workspaces.chain.get
agent_workspaces.context.get
agent_workspaces.context_bundle.export
agent_workspaces.context_bundle.restore
agent_workspaces.create
agent_workspaces.delete
agent_workspaces.file.delete
agent_workspaces.file.download
agent_workspaces.file.move
agent_workspaces.file.stat
agent_workspaces.file.upload
agent_workspaces.file.write
agent_workspaces.files.list
agent_workspaces.folder.create
agent_workspaces.get
agent_workspaces.issues.resolve
agent_workspaces.list
agent_workspaces.locks.list
agent_workspaces.locks.write
agent_workspaces.parent.set
agent_workspaces.profile.hotswap
agent_workspaces.share
agent_workspaces.sources.set
agent_workspaces.submissions.resolve
agent_workspaces.unshare
agents.create
agents.delete
agents.list
agents.update
architecture.live_map
asset_lineage.describe
asset_lineage.record
asset_lineage.reparse_plan
asset_lineage.trace
auth.audit
auth.audit.export
auth.audit.prune
auth.audit.retention.get
auth.audit.retention.set
auth.login
auth.logout
auth.oidc.get
auth.oidc.set
auth.roles.get
auth.session
auth.sessions
auth.sessions.revoke
auth.sessions.rotate
auth.users
auth.users.create
auth.users.update
authorization.agent_groups.list
authorization.agent_groups.upsert
authorization.agents.binding.upsert
authorization.agents.bindings.list
authorization.approvals.list
authorization.approvals.revoke
authorization.approvals.upsert
authorization.denied_requests.list
authorization.governance.summary
authorization.grants.create
authorization.grants.revoke
authorization.loan_records.list
authorization.policy.evaluate
authorization.receipts.list
authorization.roles.list
authorization.roles.upsert
authorization.subject.resolve
authorization.teams.list
authorization.teams.upsert
authorization.users.policies.list
authorization.users.policy.upsert
capability_packages.lifecycle
capability_packages.list
capability_packages.plan
capability_packages.submit
client_runtime.bootstrap.plan
client_runtime.bootstrap.pull
client_runtime.profiles.get
client_runtime.profiles.set
client_runtime.resolve
client_runtime.status
codespace.change.prepare
codespace.change.upload
codespace.diff.read
codespace.file.read
codespace.providers.manifest
codespace.repository.status
codespace.review.approve
codespace.review.comment
codespace.review.requestChanges
codespace.review.status.sync
codespace.tree.list
context.build_records
context.compaction.preview
context.compaction.records
context.compaction.run
context.evaluation.runs.create
context.preview
context.profiles.get
context.profiles.set
context.session_memory.clear
context.session_memory.get
data_connectors.governance.conformance
data_connectors.governance.describe
data_connectors.governance.plan
discovery.check_in
discovery.clients
discovery.clients.migration
discovery.get_config
discovery.set_config
email_rules.get
email_rules.set
events.subscribe
executive_report.generate
executive_report.list
executive_report.preview
external_services.config.get
external_services.config.save
external_services.config.verify
external_services.list
external_services.runtime.refresh
external.cloudDrive.connect
external.cloudDrive.file.download
external.cloudDrive.file.upload
external.cloudDrive.item.list
external.cloudDrive.permission.list
external.cloudDrive.status
external.cloudDrive.sync.apply
external.cloudDrive.sync.plan
external.knowledge.distillation.artifacts.export
external.knowledge.distillation.evidence.query
external.knowledge.distillation.projects.evidence.query
external.knowledge.distillation.runs.cancel
external.knowledge.distillation.runs.create
external.knowledge.distillation.runs.get
external.knowledge.distillation.runs.list
external.knowledge.distillation.service.capabilities
external.knowledge.distillation.service.health
external.knowledge.distillation.service.runtime_health
expert_vocabulary.get
expert_vocabulary.set
expert_vocabulary.versions
gerrit.git_upload
gerrit.maintain
gerrit.read
gerrit.write
jobs.create
jobs.delete
jobs.failed_review
jobs.get
jobs.list
jobs.normalized_document.get
jobs.normalized_documents
jobs.reparse
jobs.result
knowledge.access.denied_request.list
knowledge.access.evaluate
knowledge.access.loan_record.list
knowledge.access.receipt.list
knowledge.affair_taxonomy
knowledge.agent_explore.runs.create
knowledge.agent_explore.runs.get
knowledge.agent_skill.describe
knowledge.agent_skill.plan
knowledge.agent_skill.run
knowledge.asset
knowledge.backend.connect
knowledge.capabilities
knowledge.changes
knowledge.config_schema
knowledge.console
knowledge.contribution.submit
knowledge.corpus.significant_terms
knowledge.document_parse
knowledge.document_structure
knowledge.dossier.export
knowledge.evaluation.runs.create
knowledge.evaluation.runs.get
knowledge.evaluation.runs.list
knowledge.evidence
knowledge.evidence.get
knowledge.evidence_gate.evaluate
knowledge.evolution.deployments.list
knowledge.evolution.deployments.promote
knowledge.evolution.deployments.rollback
knowledge.evolution.describe
knowledge.evolution.runs.create
knowledge.evolution.runs.get
knowledge.evolution.runs.list
knowledge.export.request
knowledge.export_docx
knowledge.export_html
knowledge.export_markdown
knowledge.feedback
knowledge.gold_cases.list
knowledge.gold_cases.save
knowledge.golden_rules.list
knowledge.golden_rules.publish
knowledge.golden_rules.rollback
knowledge.golden_rules.save
knowledge.graph
knowledge.health
knowledge.hierarchy.audit
knowledge.item
knowledge.learning.health
knowledge.learning.jobs
knowledge.maintenance.get
knowledge.maintenance.run
knowledge.maintenance.set
knowledge.maintenance.settings
knowledge.model_decision
knowledge.model_roles
knowledge.permission.request
knowledge.reindex
knowledge.render_markdown
knowledge.review_items
knowledge.review_resolve
knowledge.rule_authoring.chat
knowledge.rule_authoring.runs.get
knowledge.search
knowledge.search.get
knowledge.skills.deployments.create
knowledge.skills.deployments.rollback
knowledge.skills.evaluation.runs.create
knowledge.skills.framework
knowledge.skills.framework_save
knowledge.skills.generate
knowledge.skills.get
knowledge.skills.list
knowledge.skills.propose
knowledge.skills.resolve
knowledge.sources.create
knowledge.sources.delete
knowledge.sources.list
knowledge.sources.refresh
knowledge.sources.refresh_all
knowledge.sources.update
knowledge.space.list
knowledge.suggestion_resolve
knowledge.suggestions
knowledge.summarization.runs.approve
knowledge.summarization.runs.create
knowledge.summarization.runs.get
knowledge.sync
knowledge.training_sets.export
knowledge.word_bags.add
knowledge.word_bags.delete
knowledge.word_bags.terms
knowledge.word_bags.update
knowledge.word_clouds.export
knowledge.word_clouds.get
knowledge.word_clouds.import
knowledge.word_clouds.propose
knowledge.word_clouds.save
knowledge_taxonomy.get
knowledge_taxonomy.set
knowledge_taxonomy.versions
maintenance_agent.chat
maintenance_agent.config.get
maintenance_agent.config.set
maintenance_agent.runs.approve
maintenance_agent.runs.cancel
maintenance_agent.runs.create
maintenance_agent.runs.get
maintenance_agent.runs.list
model_routing.health
module_ecosystem.contract_test
module_ecosystem.plan
module_ecosystem.scaffold
module_ecosystem.templates
oauth.codex_login
oauth.codex_return
oauth.codex_status
observability.trace.get
performance.capacity.benchmark
performance.capacity.targets
production.health
raw-corpus.format.convert
raw_objects.get
repo.branch.checkout
repo.branch.create
repo.change.abandon
repo.commit.create
repo.commit.read
repo.diff.read
repo.file.create
repo.file.delete
repo.file.move
repo.file.read
repo.file.update
repo.member.set
repo.merge
repo.proposal.close
repo.proposal.create
repo.protection.set
repo.push
repo.rebase
repo.revert
repo.review.approve
repo.review.comment
repo.review.requestChanges
repo.status
repo.submit
repo.tree.list
repo.webhook.set
runtime.info
runtime.dependencies.list
runtime.dependencies.download
runtime.dependencies.configure
runtime.mounts
runtime.path_browse
runtime.reload_mounts
runtime.set_mounts
sample_business_pack.get
sample_business_pack.list
sample_business_pack.materialize
search.query
settings.get
settings.model_probe
settings.set
sharedspace.file.read
sharedspace.file.write
sharedspace.item.delete
sharedspace.item.list
sharedspace.localDir.connect
sharedspace.localDir.list
sharedspace.sync.apply
sharedspace.sync.plan
storage.backups.create
storage.backups.list
storage.backups.restore
storage.backups.restore_preview
storage.doctor
storage.reconcile
storage.source_vocabulary.rebuild
storage.summary
strategy.agent_policy.evaluate
strategy.describe
strategy.route_policy.evaluate
strategy.tool_policy.preview
strategy.workflow_policy.evaluate
system.background_processes
system.bootstrap
system.checkpoint_trees.get
system.checkpoint_trees.list
system.console_state
system.health
system.interfaces
system.background_supervisor.recover
system.monitor_alerts.ack
system.monitor_alerts.get
system.monitor_alerts.set
tool_management.audit
tool_management.audit_item
tool_management.batch
tool_management.catalog
tool_management.catalog_item
tool_management.create_grant
tool_management.dry_run
tool_management.events
tool_management.execute
tool_management.grants
tool_management.mcp.list_requests
tool_management.mcp.request_authorization
tool_management.mcp.resolve_request
tool_management.metrics_export
tool_management.metrics_health
tool_management.metrics_prometheus
tool_management.metrics_prune
tool_management.metrics_storage
tool_management.metrics_summary
tool_management.pending_operations.list
tool_management.pending_operations.resolve
tool_management.policy_evaluate
tool_management.policy_preview
tool_management.profiles
tool_management.revoke_grant
tool_management.rotate_grant
tool_management.toolsets
tool_management.toolsets_resolve
tool_management.update_grant
uploads.create_session
uploads.get_session
uploads.upload_chunk
v001.baseline.status
workspace.asset.permission.check
workspace.asset.policy.set
workspace.audit.query
workspace.checkpoint.diff
workspace.checkpoint.node.get
workspace.checkpoint.restore
workspace.checkpoint.restore.preview
workspace.checkpoint.scope.query
workspace.checkpoint.tree.list
workspace.code.change.link
workspace.code.change.prepare
workspace.code.change.status.sync
workspace.code.change.upload
workspace.code.target.evaluate
workspace.contribution.adopt
workspace.contribution.assets.list
workspace.contribution.leaderboard
workspace.contribution.list
workspace.contribution.permission.grant
workspace.contribution.permission.request
workspace.contribution.preview
workspace.contribution.publish
workspace.contribution.reject
workspace.contribution.report
workspace.contribution.request_changes
workspace.contribution.review
workspace.contribution.revoke
workspace.contribution.scan
workspace.contribution.stats
workspace.contribution.submit
workspace.file.download
workspace.file.list
workspace.file.patch
workspace.file.read
workspace.file.upload
workspace.file.write
workspace.info
workspace.operation.history
workspace.operation.revert.scope
workspace.proposal.apply
workspace.proposal.create
workspace.skill.download
workspace.skill.list
workspace.skill.upload
workspace.skill.usage.report
workspace_governance.describe
workspace_governance.evaluate
workspace_governance.policy.set
workspace_governance.share_grant
`);

export const KERNEL_TOOL_IDS = hardcodedCapabilityLines(`
agent-exploration.http_request
agent-exploration.golden_rule_authoring
agent-exploration.keyword_search
agent-exploration.knowledge_aggregate
agent-exploration.knowledge_skill_propose
agent-exploration.knowledge_skill_search
agent-exploration.local_command
agent-exploration.open_evidence
maintenance-agent.jobs.failed_review
maintenance-agent.jobs.list
maintenance-agent.knowledge.health
maintenance-agent.knowledge.maintenance.run
maintenance-agent.knowledge.maintenance.settings
maintenance-agent.knowledge.reindex
maintenance-agent.runtime.info
maintenance-agent.runtime.reload_mounts
maintenance-agent.storage.doctor
maintenance-agent.storage.reconcile
maintenance-agent.storage.summary
maintenance-agent.system.health
pact.agentRelay.cancel
pact.agentRelay.downstreamClients.refresh
pact.agentRelay.fs.readTextFile
pact.agentRelay.fs.writeTextFile
pact.agentRelay.prompt
pact.agentRelay.session.close
pact.agentRelay.session.create
pact.agentRelay.session.resume
pact.agentRelay.session.wake
pact.agentRelay.sessions.get
pact.agentRelay.sessions.list
pact.agentRelay.targets.list
pact.agentRelay.targets.upsert
pact.agentRelay.turn.observe
pact.agentRelay.turns.list
pact.agentRelay.virtualAgent.initialize
pact.agentRelay.virtualAgents.list
pact.agentRelay.virtualAgents.upsert
pact.agentMemory.sessionMemory.clear
pact.agentMemory.sessionMemory.get
pact.agentSession.archive
pact.agentSession.compare
pact.agentSession.context
pact.agentSession.events.append
pact.agentSession.fork
pact.agentSession.get
pact.agentSession.list
pact.agentSession.mergeProposal
pact.agentSync.publish
pact.agentWorkspace.chain
pact.agentWorkspace.context
pact.agentWorkspace.contextBundle.export
pact.agentWorkspace.contextBundle.restore
pact.agentWorkspace.create
pact.agentWorkspace.file.delete
pact.agentWorkspace.file.download
pact.agentWorkspace.file.move
pact.agentWorkspace.file.stat
pact.agentWorkspace.file.upload
pact.agentWorkspace.file.write
pact.agentWorkspace.files.list
pact.agentWorkspace.folder.create
pact.agentWorkspace.get
pact.agentWorkspace.issueResolve
pact.agentWorkspace.list
pact.agentWorkspace.lock
pact.agentWorkspace.locks
pact.agentWorkspace.parent.set
pact.agentWorkspace.profile.hotswap
pact.agentWorkspace.share
pact.agentWorkspace.sources.set
pact.agentWorkspace.submissionResolve
pact.agentWorkspace.unshare
pact.architecture.liveMap
pact.assetLineage.describe
pact.assetLineage.record
pact.assetLineage.reparsePlan
pact.assetLineage.trace
pact.authorization.agentGroups.list
pact.authorization.agentGroups.upsert
pact.authorization.agents.binding.upsert
pact.authorization.agents.bindings.list
pact.authorization.approvals.list
pact.authorization.approvals.revoke
pact.authorization.approvals.upsert
pact.authorization.deniedRequests.list
pact.authorization.governance.summary
pact.authorization.grants.create
pact.authorization.grants.revoke
pact.authorization.loanRecords.list
pact.authorization.policy.evaluate
pact.authorization.receipts.list
pact.authorization.roles.list
pact.authorization.roles.upsert
pact.authorization.subject.resolve
pact.authorization.teams.list
pact.authorization.teams.upsert
pact.authorization.users.policies.list
pact.authorization.users.policy.upsert
pact.capabilityPackages.lifecycle
pact.capabilityPackages.list
pact.capabilityPackages.plan
pact.capabilityPackages.submit
pact.clientRuntime.bootstrapPlan
pact.clientRuntime.bootstrapPull
pact.clientRuntime.profiles
pact.clientRuntime.profiles.set
pact.clientRuntime.resolve
pact.clientRuntime.status
pact.codespace.change.prepare
pact.codespace.change.upload
pact.codespace.diff.read
pact.codespace.file.read
pact.codespace.providers.manifest
pact.codespace.repository.status
pact.codespace.review.approve
pact.codespace.review.comment
pact.codespace.review.requestChanges
pact.codespace.review.status.sync
pact.codespace.tree.list
pact.context.profiles
pact.context.profiles.set
pact.dataConnectors.governance
pact.dataConnectors.governance.conformance
pact.dataConnectors.governance.plan
pact.executiveReport.generate
pact.executiveReport.list
pact.executiveReport.preview
pact.external.cloudDrive.connect
pact.external.cloudDrive.file.download
pact.external.cloudDrive.file.upload
pact.external.cloudDrive.item.list
pact.external.cloudDrive.permission.list
pact.external.cloudDrive.status
pact.external.cloudDrive.sync.apply
pact.external.cloudDrive.sync.plan
pact.external.knowledge.distillation.artifacts.export
pact.external.knowledge.distillation.capabilities
pact.external.knowledge.distillation.evidence.query
pact.external.knowledge.distillation.health
pact.external.knowledge.distillation.projects.evidence.query
pact.external.knowledge.distillation.runtimeHealth
pact.external.knowledge.distillation.runs.cancel
pact.external.knowledge.distillation.runs.create
pact.external.knowledge.distillation.runs.get
pact.external.knowledge.distillation.runs.list
pact.gerrit.gitUpload
pact.gerrit.maintain
pact.gerrit.read
pact.gerrit.write
pact.jobs.get
pact.jobs.list
pact.knowledge.access.deniedRequest.list
pact.knowledge.access.evaluate
pact.knowledge.access.loanRecord.list
pact.knowledge.access.receipt.list
pact.knowledge.affairTaxonomy
pact.knowledge.agentSkill
pact.knowledge.agentSkill.plan
pact.knowledge.agentSkill.run
pact.knowledge.asset
pact.knowledge.backend.connect
pact.knowledge.capabilities
pact.knowledge.changes
pact.knowledge.configSchema
pact.knowledge.console
pact.knowledge.contribution.submit
pact.knowledge.documentStructure
pact.knowledge.dossier.export
pact.knowledge.evaluation.runs.create
pact.knowledge.evaluation.runs.get
pact.knowledge.evaluation.runs.list
pact.knowledge.evidence
pact.knowledge.evidence.get
pact.knowledge.evidenceGate.evaluate
pact.knowledge.evolution
pact.knowledge.evolution.deployments.list
pact.knowledge.evolution.deployments.promote
pact.knowledge.evolution.deployments.rollback
pact.knowledge.evolution.runs.create
pact.knowledge.evolution.runs.get
pact.knowledge.evolution.runs.list
pact.knowledge.export.request
pact.knowledge.exportDocx
pact.knowledge.feedback
pact.knowledge.goldCases.list
pact.knowledge.goldCases.set
pact.knowledge.goldenRules.list
pact.knowledge.goldenRules.publish
pact.knowledge.goldenRules.rollback
pact.knowledge.goldenRules.set
pact.knowledge.graph
pact.knowledge.health
pact.knowledge.hierarchy.audit
pact.knowledge.item
pact.knowledge.learning.health
pact.knowledge.learning.jobs
pact.knowledge.maintenance.get
pact.knowledge.maintenance.run
pact.knowledge.maintenance.set
pact.knowledge.modelDecision
pact.knowledge.modelRoles
pact.knowledge.permission.request
pact.knowledge.reindex
pact.knowledge.renderMarkdown
pact.knowledge.reviewItems
pact.knowledge.reviewResolve
pact.knowledge.ruleAuthoring.chat
pact.knowledge.ruleAuthoring.run
pact.knowledge.search
pact.knowledge.skillFramework
pact.knowledge.skillFramework.set
pact.knowledge.skills.deployments.create
pact.knowledge.skills.deployments.rollback
pact.knowledge.skills.evaluation.runs.create
pact.knowledge.skills.generate
pact.knowledge.skills.get
pact.knowledge.skills.list
pact.knowledge.skills.propose
pact.knowledge.skills.resolve
pact.knowledge.space.list
pact.knowledge.suggestionResolve
pact.knowledge.suggestions
pact.knowledge.summarization.runs.approve
pact.knowledge.summarization.runs.create
pact.knowledge.summarization.runs.get
pact.knowledge.sync
pact.knowledge.trainingSets.export
pact.modules.contractTest
pact.modules.plan
pact.modules.scaffold
pact.modules.templates
pact.performance.capacity.benchmark
pact.performance.capacity.targets
pact.rawCorpus.format.convert
pact.repo.branch.checkout
pact.repo.branch.create
pact.repo.change.abandon
pact.repo.commit.create
pact.repo.commit.read
pact.repo.diff.read
pact.repo.file.create
pact.repo.file.delete
pact.repo.file.move
pact.repo.file.read
pact.repo.file.update
pact.repo.member.set
pact.repo.merge
pact.repo.proposal.close
pact.repo.proposal.create
pact.repo.protection.set
pact.repo.push
pact.repo.rebase
pact.repo.revert
pact.repo.review.approve
pact.repo.review.comment
pact.repo.review.requestChanges
pact.repo.status
pact.repo.submit
pact.repo.tree.list
pact.repo.webhook.set
pact.runtime.info
pact.runtime.mounts
pact.runtime.mounts.reload
pact.runtime.mounts.set
pact.sampleBusinessPack.get
pact.sampleBusinessPack.list
pact.sampleBusinessPack.materialize
pact.sharedspace.drive.connect
pact.sharedspace.drive.file.download
pact.sharedspace.drive.file.upload
pact.sharedspace.drive.item.list
pact.sharedspace.drive.permission.list
pact.sharedspace.drive.status
pact.sharedspace.drive.sync.apply
pact.sharedspace.drive.sync.plan
pact.sharedspace.file.read
pact.sharedspace.file.write
pact.sharedspace.item.delete
pact.sharedspace.item.list
pact.sharedspace.localDir.connect
pact.sharedspace.localDir.list
pact.sharedspace.sync.apply
pact.sharedspace.sync.plan
pact.storageBackups.create
pact.storageBackups.list
pact.storageBackups.restore
pact.storageBackups.restorePreview
pact.storageSummary
pact.v001.baseline.status
pact.workspace.asset.permission.check
pact.workspace.asset.policy.set
pact.workspace.audit.query
pact.workspace.checkpoint.diff
pact.workspace.checkpoint.node.get
pact.workspace.checkpoint.restore
pact.workspace.checkpoint.restore.preview
pact.workspace.checkpoint.scope.query
pact.workspace.checkpoint.tree.list
pact.workspace.code.change.link
pact.workspace.code.change.prepare
pact.workspace.code.change.status.sync
pact.workspace.code.change.upload
pact.workspace.code.target.evaluate
pact.workspace.contribution.adopt
pact.workspace.contribution.assets.list
pact.workspace.contribution.leaderboard
pact.workspace.contribution.list
pact.workspace.contribution.permission.grant
pact.workspace.contribution.permission.request
pact.workspace.contribution.preview
pact.workspace.contribution.publish
pact.workspace.contribution.reject
pact.workspace.contribution.report
pact.workspace.contribution.requestChanges
pact.workspace.contribution.review
pact.workspace.contribution.revoke
pact.workspace.contribution.scan
pact.workspace.contribution.stats
pact.workspace.contribution.submit
pact.workspace.create
pact.workspace.file.delete
pact.workspace.file.download
pact.workspace.file.list
pact.workspace.file.move
pact.workspace.file.patch
pact.workspace.file.read
pact.workspace.file.stat
pact.workspace.file.upload
pact.workspace.file.write
pact.workspace.files.list
pact.workspace.folder.create
pact.workspace.info
pact.workspace.operation.history
pact.workspace.operation.revert.scope
pact.workspace.proposal.apply
pact.workspace.proposal.create
pact.workspace.skill.download
pact.workspace.skill.list
pact.workspace.skill.upload
pact.workspace.skill.usage.report
pact.workspaceGovernance.describe
pact.workspaceGovernance.evaluate
pact.workspaceGovernance.policy.set
pact.workspaceGovernance.shareGrant
system.health
`);

export function apiCapabilityId(operationId) {
  return `cap:api:${String(operationId || "").trim()}`;
}

export function toolExecuteCapabilityId(toolId) {
  return `cap:tool:${String(toolId || "").trim()}:execute`;
}

export const KERNEL_API_CAPABILITY_PERMISSIONS = Object.freeze(KERNEL_API_OPERATION_IDS.map(apiCapabilityId));
export const KERNEL_TOOL_CAPABILITY_PERMISSIONS = Object.freeze(KERNEL_TOOL_IDS.map(toolExecuteCapabilityId));
export const KERNEL_CAPABILITY_WILDCARDS = Object.freeze(["cap:*", "cap:api:*", "cap:tool:*"]);
export const KERNEL_CAPABILITY_PERMISSIONS = Object.freeze([
  ...KERNEL_API_CAPABILITY_PERMISSIONS,
  ...KERNEL_TOOL_CAPABILITY_PERMISSIONS
]);

const KERNEL_API_OPERATION_ID_SET = new Set(KERNEL_API_OPERATION_IDS);
const KERNEL_TOOL_ID_SET = new Set(KERNEL_TOOL_IDS);
const KERNEL_CAPABILITY_PERMISSION_SET = new Set(KERNEL_CAPABILITY_PERMISSIONS);
const KERNEL_CAPABILITY_WILDCARD_SET = new Set(KERNEL_CAPABILITY_WILDCARDS);

const RISK_RANK = Object.freeze({
  read_only: 0,
  safe_write: 1,
  repair_write: 2,
  destructive: 3
});

function nowIso() {
  return new Date().toISOString();
}

function randomId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function uniqueStrings(values = []) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function stringSet(values = []) {
  return new Set(uniqueStrings(values));
}

function objectOrNull(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function firstString(...values) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) {
      return text;
    }
  }
  return "";
}

function stringsFrom(...values) {
  const output = [];
  for (const value of values) {
    if (Array.isArray(value)) {
      output.push(...value);
    } else if (typeof value === "string" && value.includes(",")) {
      output.push(...value.split(","));
    } else if (value !== undefined && value !== null) {
      output.push(value);
    }
  }
  return uniqueStrings(output);
}

export function isKernelCapabilityPermission(value) {
  const capability = String(value || "").trim();
  return KERNEL_CAPABILITY_PERMISSION_SET.has(capability) || KERNEL_CAPABILITY_WILDCARD_SET.has(capability);
}

export function unknownKernelCapabilities(...values) {
  return uniqueStrings(stringsFrom(...values).filter((capability) => !isKernelCapabilityPermission(capability)));
}

export function assertKnownKernelCapabilities(...values) {
  const unknown = unknownKernelCapabilities(...values);
  if (unknown.length > 0) {
    throw new Error(`Unknown kernel capability permission: ${unknown.join(", ")}`);
  }
  return normalizeKernelCapabilities(...values);
}

export function normalizeKernelCapabilities(...values) {
  return uniqueStrings(stringsFrom(...values).filter(isKernelCapabilityPermission));
}

export function listKernelCapabilityPermissions() {
  return [...KERNEL_CAPABILITY_PERMISSIONS];
}

function requiredCapabilitiesFor(operation = {}, tool = null) {
  const toolId = String(tool?.id || "").trim();
  if (toolId && KERNEL_TOOL_ID_SET.has(toolId)) {
    return [toolExecuteCapabilityId(toolId)];
  }
  const operationId = String(operation?.id || tool?.operationId || "").trim();
  return operationId && KERNEL_API_OPERATION_ID_SET.has(operationId)
    ? [apiCapabilityId(operationId)]
    : [];
}

function subjectCapabilities(subject = {}, actor = null, authSession = null, grant = null) {
  return normalizeKernelCapabilities(
    subject.capabilities,
    subject.capabilityIds,
    subject.permissions,
    actor?.capabilities,
    actor?.capabilityIds,
    actor?.permissions,
    actor?.user?.capabilities,
    actor?.user?.capabilityIds,
    authSession?.user?.capabilities,
    authSession?.user?.capabilityIds,
    grant?.capabilities,
    grant?.capabilityIds,
    grant?.metadata?.capabilities,
    grant?.metadata?.capabilityIds
  );
}

function hasCapability(capabilities = [], capability = "") {
  const capabilityId = String(capability || "").trim();
  if (!capabilityId) {
    return true;
  }
  const capabilitySet = stringSet(capabilities);
  if (capabilitySet.has("cap:*") || capabilitySet.has(capabilityId)) {
    return true;
  }
  if (capabilityId.startsWith("cap:api:") && capabilitySet.has("cap:api:*")) {
    return true;
  }
  if (capabilityId.startsWith("cap:tool:") && capabilitySet.has("cap:tool:*")) {
    return true;
  }
  return false;
}

function riskRank(value = "read_only") {
  return RISK_RANK[String(value || "read_only")] ?? RISK_RANK.read_only;
}

function hasConfirmation(input = {}, request = null) {
  if (input?.confirm === true || input?.confirmed === true) {
    return true;
  }
  const header = String(
    request?.headers?.["x-pact-confirm"] ||
      request?.headers?.["x-pact-safety-confirm"] ||
      ""
  ).toLowerCase();
  return ["1", "true", "yes"].includes(header);
}

function requestOrigin(request) {
  const origin = String(request?.headers?.origin || "").trim();
  if (origin) {
    return origin.replace(/\/+$/, "");
  }
  const referer = String(request?.headers?.referer || "").trim();
  if (referer) {
    try {
      return new URL(referer).origin;
    } catch {
      return "";
    }
  }
  return "";
}

function sourceIpFromRequest(request) {
  return String(
    request?.headers?.["x-forwarded-for"] ||
      request?.socket?.remoteAddress ||
      request?.connection?.remoteAddress ||
      ""
  ).split(",")[0].trim();
}

function normalizeIp(value) {
  const text = String(value || "").trim();
  return text.startsWith("::ffff:") ? text.slice("::ffff:".length) : text;
}

function ipv4ToInt(value) {
  const parts = normalizeIp(value).split(".");
  if (parts.length !== 4) {
    return null;
  }
  let output = 0;
  for (const part of parts) {
    const number = Number(part);
    if (!Number.isInteger(number) || number < 0 || number > 255) {
      return null;
    }
    output = (output << 8) + number;
  }
  return output >>> 0;
}

function ipMatchesRule(ip, rule) {
  const normalizedRule = String(rule || "").trim();
  const normalizedIp = normalizeIp(ip);
  if (!normalizedRule) {
    return false;
  }
  if (!normalizedRule.includes("/")) {
    return normalizedIp === normalizeIp(normalizedRule);
  }
  const [base, bitsText] = normalizedRule.split("/");
  const bits = Number(bitsText);
  const ipInt = ipv4ToInt(normalizedIp);
  const baseInt = ipv4ToInt(base);
  if (ipInt === null || baseInt === null || !Number.isInteger(bits) || bits < 0 || bits > 32) {
    return false;
  }
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

function maxRiskAllowed(profile = null, grant = null, subject = null, fallback = "safe_write") {
  const candidates = [
    profile?.maxRisk,
    grant?.maxRisk,
    grant?.metadata?.maxRisk,
    subject?.maxRisk
  ].filter(Boolean);
  if (candidates.length === 0) {
    return fallback;
  }
  return candidates.reduce((lowest, item) =>
    riskRank(item) < riskRank(lowest) ? item : lowest
  );
}

function inferOperationAction(operation = {}, tool = null) {
  if (operation?.action) {
    return String(operation.action);
  }
  const operationId = String(operation?.id || tool?.operationId || "");
  if (!operationId) {
    return tool?.readOnly === false ? "write" : "read";
  }
  const last = operationId.split(".").filter(Boolean).pop() || "";
  if (["list", "get", "read", "download", "query", "evaluate", "preview", "history", "info"].includes(last)) {
    return "read";
  }
  return "write";
}

function operationRisk(operation = {}, tool = null) {
  return String(tool?.risk || operation?.safety?.risk || (operation?.readOnly === false ? "safe_write" : "read_only"));
}

function requiredScopesFor(operation = {}, tool = null) {
  return uniqueStrings([
    ...(Array.isArray(operation?.requiredScopes) ? operation.requiredScopes : []),
    ...(Array.isArray(tool?.requiredScopes) ? tool.requiredScopes : [])
  ]);
}

function subjectScopes(subject = {}, actor = null, authSession = null, grant = null) {
  return uniqueStrings([
    ...(Array.isArray(subject.scopes) ? subject.scopes : []),
    ...(Array.isArray(actor?.scopes) ? actor.scopes : []),
    ...(Array.isArray(actor?.user?.scopes) ? actor.user.scopes : []),
    ...(Array.isArray(authSession?.user?.scopes) ? authSession.user.scopes : []),
    ...(Array.isArray(grant?.scopes) ? grant.scopes : [])
  ]);
}

function grantHasToolset(grant = null, tool = null) {
  if (!tool || !grant?.toolsets?.length) {
    return true;
  }
  return (tool.toolsets || []).some((toolset) => grant.toolsets.includes(toolset));
}

function toolsetMisses(grant = null, tool = null) {
  if (!tool || !grant?.toolsets?.length) {
    return [];
  }
  const grantToolsets = stringSet(grant.toolsets);
  return uniqueStrings(tool.toolsets || []).filter((toolset) => !grantToolsets.has(toolset));
}

function effectDetails(effect, reasonCode, redactedReason, extra = {}) {
  return { effect, reasonCode, redactedReason, ...extra };
}

function subjectHasTenantBypass(subject = {}) {
  return subject.roleId === "owner" || subject.scopes?.includes("auth:admin");
}

function resolveResourceContext({ operation = {}, tool = null, input = {}, context = {} } = {}) {
  const inputResource = objectOrNull(input.resource) || {};
  const contextResource = objectOrNull(context.resource) || {};
  const operationResource = objectOrNull(operation.resource) || {};
  const toolResource = objectOrNull(tool?.resource) || {};
  return {
    tenantId: firstString(
      input.tenantId,
      input["tenant-id"],
      inputResource.tenantId,
      context.tenantId,
      contextResource.tenantId,
      operationResource.tenantId,
      toolResource.tenantId
    ),
    workspaceId: firstString(
      input.workspaceId,
      input.workspace,
      input["workspace-id"],
      inputResource.workspaceId,
      context.workspaceId,
      context.workspace,
      contextResource.workspaceId,
      operationResource.workspaceId,
      toolResource.workspaceId
    ),
    dataClass: firstString(
      input.dataClass,
      input["data-class"],
      inputResource.dataClass,
      context.dataClass,
      contextResource.dataClass,
      operationResource.dataClass,
      toolResource.dataClass
    ),
    requestedEgress: firstString(
      input.requestedEgress,
      input["requested-egress"],
      context.requestedEgress,
      operationResource.requestedEgress,
      toolResource.requestedEgress
    )
  };
}

function abacDenyDetails({ subject = {}, grant = null, profile = null, resource = {} } = {}) {
  const tenantPolicy = firstString(subject.tenantId, grant?.tenantId, grant?.metadata?.tenantId, profile?.tenantId);
  if (
    resource.tenantId &&
    tenantPolicy &&
    tenantPolicy !== resource.tenantId &&
    !subjectHasTenantBypass(subject)
  ) {
    return effectDetails("deny", "tenant_mismatch", "Requested tenant is outside the subject boundary.");
  }

  const allowedWorkspaceIds = stringsFrom(
    subject.allowedWorkspaceIds,
    grant?.allowedWorkspaceIds,
    grant?.metadata?.allowedWorkspaceIds,
    profile?.allowedWorkspaceIds
  );
  if (resource.workspaceId && allowedWorkspaceIds.length > 0 && !allowedWorkspaceIds.includes(resource.workspaceId)) {
    return effectDetails("deny", "workspace_not_allowed", "Requested workspace is outside the allowed workspace set.");
  }

  const allowedDataClasses = stringsFrom(
    subject.allowedDataClasses,
    grant?.allowedDataClasses,
    grant?.metadata?.allowedDataClasses,
    profile?.allowedDataClasses
  );
  if (resource.dataClass && allowedDataClasses.length > 0 && !allowedDataClasses.includes(resource.dataClass)) {
    return effectDetails("deny", "data_class_not_allowed", "Requested data class is outside the allowed data classes.");
  }

  const allowedEgress = stringsFrom(
    subject.allowedEgress,
    grant?.allowedEgress,
    grant?.metadata?.allowedEgress,
    profile?.allowedEgress
  );
  if (resource.requestedEgress && allowedEgress.length > 0 && !allowedEgress.includes(resource.requestedEgress)) {
    return effectDetails("deny", "egress_not_allowed", "Requested egress is outside the allowed egress set.");
  }

  return null;
}

export function resolveAuthorizationSubject({
  subject = null,
  actor = null,
  authSession = null,
  grant = null
} = {}) {
  const user = authSession?.user || actor?.user || null;
  const metadata = objectOrNull(subject?.metadata) || objectOrNull(grant?.metadata) || {};
  const attributes = {
    ...(objectOrNull(user?.attributes) || {}),
    ...(objectOrNull(actor?.attributes) || {}),
    ...(objectOrNull(subject?.attributes) || {}),
    ...(objectOrNull(metadata.attributes) || {})
  };
  if (subject && typeof subject === "object" && !Array.isArray(subject)) {
    return {
      type: subject.type || subject.subjectType || (grant ? "tool-grant" : user ? "console-user" : "subject"),
      subjectId: String(subject.subjectId || subject.userId || subject.id || user?.userId || grant?.id || ""),
      username: String(subject.username || user?.username || grant?.label || ""),
      roleId: String(subject.roleId || user?.roleId || ""),
      scopes: uniqueStrings(subjectScopes(subject, actor, authSession, grant)),
      capabilities: subjectCapabilities(subject, actor, authSession, grant),
      agentProfileId: String(subject.agentProfileId || subject.profileId || ""),
      maxRisk: subject.maxRisk || "",
      tenantId: firstString(subject.tenantId, user?.tenantId, grant?.tenantId, metadata.tenantId),
      orgId: firstString(subject.orgId, user?.orgId, grant?.orgId, metadata.orgId),
      teamIds: stringsFrom(subject.teamIds, user?.teamIds, grant?.teamIds, metadata.teamIds),
      allowedWorkspaceIds: stringsFrom(
        subject.allowedWorkspaceIds,
        user?.allowedWorkspaceIds,
        grant?.allowedWorkspaceIds,
        metadata.allowedWorkspaceIds
      ),
      allowedDataClasses: stringsFrom(
        subject.allowedDataClasses,
        user?.allowedDataClasses,
        grant?.allowedDataClasses,
        metadata.allowedDataClasses
      ),
      allowedEgress: stringsFrom(subject.allowedEgress, user?.allowedEgress, grant?.allowedEgress, metadata.allowedEgress),
      attributes
    };
  }
  if (grant) {
    return {
      type: "tool-grant",
      subjectId: String(grant.id || ""),
      username: String(grant.label || grant.id || ""),
      roleId: "tool-grant",
      scopes: uniqueStrings(grant.scopes || []),
      capabilities: subjectCapabilities({}, actor, authSession, grant),
      agentProfileId: "",
      maxRisk: grant.maxRisk || grant.metadata?.maxRisk || "",
      tenantId: firstString(grant.tenantId, metadata.tenantId),
      orgId: firstString(grant.orgId, metadata.orgId),
      teamIds: stringsFrom(grant.teamIds, metadata.teamIds),
      allowedWorkspaceIds: stringsFrom(grant.allowedWorkspaceIds, metadata.allowedWorkspaceIds),
      allowedDataClasses: stringsFrom(grant.allowedDataClasses, metadata.allowedDataClasses),
      allowedEgress: stringsFrom(grant.allowedEgress, metadata.allowedEgress),
      attributes
    };
  }
  if (user) {
    return {
      type: "console-user",
      subjectId: String(user.userId || user.username || ""),
      username: String(user.username || user.userId || ""),
      roleId: String(user.roleId || ""),
      scopes: uniqueStrings(user.scopes || []),
      capabilities: subjectCapabilities({}, actor, authSession, grant),
      agentProfileId: "",
      maxRisk: "",
      tenantId: firstString(user.tenantId),
      orgId: firstString(user.orgId),
      teamIds: stringsFrom(user.teamIds),
      allowedWorkspaceIds: stringsFrom(user.allowedWorkspaceIds),
      allowedDataClasses: stringsFrom(user.allowedDataClasses),
      allowedEgress: stringsFrom(user.allowedEgress),
      attributes
    };
  }
  if (actor) {
    return {
      type: actor.type || "actor",
      subjectId: String(actor.userId || actor.subjectId || actor.id || actor.username || ""),
      username: String(actor.username || actor.label || ""),
      roleId: String(actor.roleId || ""),
      scopes: uniqueStrings(actor.scopes || []),
      capabilities: subjectCapabilities({}, actor, authSession, grant),
      agentProfileId: String(actor.agentProfileId || ""),
      maxRisk: actor.maxRisk || "",
      tenantId: firstString(actor.tenantId),
      orgId: firstString(actor.orgId),
      teamIds: stringsFrom(actor.teamIds),
      allowedWorkspaceIds: stringsFrom(actor.allowedWorkspaceIds),
      allowedDataClasses: stringsFrom(actor.allowedDataClasses),
      allowedEgress: stringsFrom(actor.allowedEgress),
      attributes
    };
  }
  return {
    type: "anonymous",
    subjectId: "",
    username: "",
    roleId: "",
    scopes: [],
    capabilities: [],
    agentProfileId: "",
    maxRisk: "",
    tenantId: "",
    orgId: "",
    teamIds: [],
    allowedWorkspaceIds: [],
    allowedDataClasses: [],
    allowedEgress: [],
    attributes: {}
  };
}

export function evaluateAuthorizationPolicy({
  operation = {},
  tool = null,
  grant = null,
  profile = null,
  subject = null,
  actor = null,
  authSession = null,
  input = {},
  request = null,
  context = {},
  dryRun = false,
  traceId = "",
  toolExecutionId = "",
  grantRequired = false,
  enforceConfirmation = true,
  store = null,
  governanceStore = null,
  governanceRequired = false
} = {}) {
  const resolvedSubject = resolveAuthorizationSubject({ subject, actor, authSession, grant });
  const resourceContext = resolveResourceContext({ operation, tool, input, context });
  const requiredScopes = requiredScopesFor(operation, tool);
  const requiredCapabilities = requiredCapabilitiesFor(operation, tool);
  const scopeSet = stringSet(resolvedSubject.scopes);
  const missingScopes = requiredScopes.filter((scope) => !scopeSet.has(scope));
  const capabilityMode = requiredCapabilities.length > 0 && resolvedSubject.capabilities.length > 0;
  const missingCapabilities = capabilityMode
    ? requiredCapabilities.filter((capability) => !hasCapability(resolvedSubject.capabilities, capability))
    : [];
  const effectiveMissingScopes = capabilityMode ? [] : missingScopes;
  const missingToolsets = toolsetMisses(grant, tool);
  const risk = operationRisk(operation, tool);
  const evaluatedLayers = uniqueStrings([
    "authorization_subject",
    requiredCapabilities.length > 0 ? "operation_capability_policy" : "",
    "operation_scope_policy",
    tool ? "tool_catalog_policy" : "",
    grant ? "grant_policy" : "",
    profile ? "agent_profile_policy" : "",
    resourceContext.tenantId ? "tenant_boundary_policy" : "",
    resourceContext.workspaceId || resourceContext.dataClass || resourceContext.requestedEgress ? "abac_resource_policy" : "",
    "runtime_safety_policy"
  ]);
  let details = effectDetails("allow", "allowed", "Request allowed.");
  const governanceDecision = governanceStore && typeof governanceStore.evaluateGovernance === "function"
    ? governanceStore.evaluateGovernance({
        operation,
        tool,
        grant,
        profile,
        subject: resolvedSubject,
        input,
        request,
        context,
        governanceRequired
      })
    : null;
  const abacDetails = abacDenyDetails({
    subject: resolvedSubject,
    grant,
    profile,
    resource: resourceContext
  });

  if (governanceDecision?.applicable && governanceDecision.effect === "deny") {
    details = effectDetails("deny", governanceDecision.reasonCode, governanceDecision.redactedReason, {
      deniedLayer: governanceDecision.deniedLayer || "governance",
      effectivePolicySnapshot: governanceDecision.effectivePolicySnapshot || null
    });
  } else if (governanceDecision?.applicable && governanceDecision.effect === "needsApproval") {
    details = effectDetails("needsApproval", governanceDecision.reasonCode, governanceDecision.redactedReason, {
      deniedLayer: governanceDecision.deniedLayer || "governance",
      requiredApproval: governanceDecision.requiredApproval || null,
      effectivePolicySnapshot: governanceDecision.effectivePolicySnapshot || null
    });
  } else if (governanceDecision?.applicable && governanceDecision.effect === "allow") {
    details = effectDetails("allow", governanceDecision.reasonCode || "governance_allowed", "Request allowed by governance policy.", {
      effectivePolicySnapshot: governanceDecision.effectivePolicySnapshot || null
    });
  } else if (tool === null && context?.toolExpected === true) {
    details = effectDetails("deny", "unknown_tool", "Tool is not registered.");
  } else if (abacDetails) {
    details = abacDetails;
  } else if (tool && tool.status !== "active") {
    details = effectDetails("deny", "tool_inactive", "Tool is inactive.");
  } else if (grantRequired && !grant) {
    details = effectDetails("deny", "missing_grant", "No grant was provided.");
  } else if (grant?.expiresAt && Date.parse(grant.expiresAt) <= Date.now()) {
    details = effectDetails("deny", "grant_expired", "Grant is expired.");
  } else if (Number(grant?.maxUses || 0) > 0 && Number(grant?.useCount || 0) >= Number(grant?.maxUses || 0)) {
    details = effectDetails("deny", "grant_max_uses", "Grant has exceeded its maximum use count.");
  } else if (
    grant?.allowedOrigins?.length > 0 &&
    (!requestOrigin(request) || !grant.allowedOrigins.map((item) => String(item || "").replace(/\/+$/, "")).includes(requestOrigin(request)))
  ) {
    details = effectDetails("deny", "origin_not_allowed", "Request origin is not allowed by grant.");
  } else if (
    grant?.allowedCidrs?.length > 0 &&
    !grant.allowedCidrs.some((rule) => ipMatchesRule(sourceIpFromRequest(request), rule))
  ) {
    details = effectDetails("deny", "cidr_not_allowed", "Request source address is not allowed by grant.");
  } else if (context?.grantRateLimited === true || context?.rateLimited === true) {
    details = effectDetails("deny", "rate_limited", "Grant rate limit has been exceeded.");
  } else if (operation?.public === true || operation?.externalAuth === true) {
    details = effectDetails("allow", "allowed_public_or_external", "Public or externally authenticated operation.");
  } else if (missingCapabilities.length > 0) {
    details = effectDetails("deny", "missing_capabilities", "Credential is missing required capabilities.");
  } else if (effectiveMissingScopes.length > 0) {
    details = effectDetails("deny", "missing_scopes", "Subject is missing required scopes.");
  } else if (!grantHasToolset(grant, tool)) {
    details = effectDetails("deny", "missing_toolsets", "Grant is missing a toolset that contains this tool.");
  } else if (tool?.id && grant?.toolDeny?.includes(tool.id)) {
    details = effectDetails("deny", "tool_denied", "Grant denies this tool.");
  } else if (tool?.id && grant?.toolAllow?.length > 0 && !grant.toolAllow.includes(tool.id)) {
    details = effectDetails("deny", "tool_not_allowed", "Tool is not in the grant allowlist.");
  } else if (tool?.id && profile?.toolDeny?.includes(tool.id)) {
    details = effectDetails("deny", "profile_tool_denied", "Agent profile denies this tool.");
  } else if (tool?.id && profile?.toolAllow?.length > 0 && !profile.toolAllow.includes(tool.id)) {
    details = effectDetails("deny", "profile_tool_not_allowed", "Tool is not in the profile allowlist.");
  } else if (riskRank(risk) > riskRank(maxRiskAllowed(
    profile,
    grant,
    resolvedSubject,
    grantRequired || grant || tool ? "safe_write" : "destructive"
  ))) {
    details = effectDetails("deny", "risk_exceeds_policy", "Requested risk exceeds effective policy.");
  } else if (enforceConfirmation && (tool?.destructive || tool?.requiresApproval || operation?.safety?.requiresConfirmation) && !hasConfirmation(input, request)) {
    details = effectDetails("require_confirmation", "confirmation_required", "Request requires confirmation.");
  } else if (dryRun) {
    details = effectDetails("dry_run_only", "dry_run", "Dry-run requested.");
  }

  const decision = {
    protocolVersion: AUTHORIZATION_PROTOCOL_VERSION,
    decisionId: randomId("authz_decision"),
    auditId: randomId("authz_audit"),
    toolExecutionId,
    traceId,
    operationId: String(operation?.id || tool?.operationId || ""),
    toolId: String(tool?.id || ""),
    grantId: String(grant?.id || ""),
    subject: resolvedSubject,
    resource: {
      operationId: String(operation?.id || tool?.operationId || ""),
      toolId: String(tool?.id || ""),
      feature: String(operation?.feature || tool?.featureId || ""),
      risk,
      tenantId: resourceContext.tenantId,
      workspaceId: resourceContext.workspaceId,
      dataClass: resourceContext.dataClass
    },
    action: String(input.requestedAction || context.requestedAction || inferOperationAction(operation, tool)),
    requestedEgress: resourceContext.requestedEgress,
    effect: details.effect,
    allowed: ["allow", "dry_run_only"].includes(details.effect),
    reasonCode: details.reasonCode,
    redactedReason: details.redactedReason,
    deniedLayer: details.deniedLayer || "",
    effectivePolicySnapshot: details.effectivePolicySnapshot || governanceDecision?.effectivePolicySnapshot || null,
    requiredCapabilities,
    subjectCapabilities: resolvedSubject.capabilities,
    missingCapabilities: uniqueStrings(missingCapabilities),
    requiredScopes,
    subjectScopes: resolvedSubject.scopes,
    missingScopes: uniqueStrings(effectiveMissingScopes),
    missingToolsets: details.effect === "deny" ? uniqueStrings(missingToolsets) : [],
    requiredApproval: details.requiredApproval || (details.effect === "require_approval" ? { reasonCode: details.reasonCode } : null),
    requiredConfirmation: details.effect === "require_confirmation",
    evaluatedLayers,
    tenant: {
      subjectTenantId: resolvedSubject.tenantId || "",
      resourceTenantId: resourceContext.tenantId || "",
      orgId: resolvedSubject.orgId || "",
      teamIds: resolvedSubject.teamIds || []
    },
    abac: {
      workspaceId: resourceContext.workspaceId || "",
      dataClass: resourceContext.dataClass || "",
      requestedEgress: resourceContext.requestedEgress || "",
      allowedWorkspaceIds: resolvedSubject.allowedWorkspaceIds || [],
      allowedDataClasses: resolvedSubject.allowedDataClasses || [],
      allowedEgress: resolvedSubject.allowedEgress || []
    },
    createdAt: nowIso()
  };

  if (store && typeof store.appendDecision === "function") {
    store.appendDecision(decision);
  }
  return decision;
}

export function createAuthorizationEngine({ store = null, governanceStore = null } = {}) {
  return {
    protocolVersion: AUTHORIZATION_PROTOCOL_VERSION,
    capabilityPermissions: KERNEL_CAPABILITY_PERMISSIONS,
    listCapabilityPermissions: listKernelCapabilityPermissions,
    resolveSubject: resolveAuthorizationSubject,
    evaluate: (input = {}) => evaluateAuthorizationPolicy({ ...input, store, governanceStore })
  };
}
