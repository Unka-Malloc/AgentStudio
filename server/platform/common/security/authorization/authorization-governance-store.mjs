import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { ServerConfig } from "../../config/ServerConfig.mjs";

const DEFAULT_ROLES = Object.freeze({
  owner: { roleId: "owner", label: "Owner", scopes: [] },
  admin: { roleId: "admin", label: "Admin", scopes: [] },
  operator: { roleId: "operator", label: "Operator", scopes: [] },
  viewer: { roleId: "viewer", label: "Viewer", scopes: [] }
});

const CODE_OPERATION_RE = /^(codespace\.|workspace\.code\.|repo\.|gerrit\.)/;
const WRITE_ACTION_RE = /\.(prepare|upload|write|create|update|delete|move|push|approve|requestChanges|comment|submit|maintain|rebase|merge|abandon|restore|review)\b|:write|:maintain|:approve|:review|:admin/;

function nowIso() {
  return new Date().toISOString();
}

function randomId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function parseJson(value, fallback) {
  try {
    const parsed = JSON.parse(value || "");
    return parsed === undefined || parsed === null ? fallback : parsed;
  } catch {
    return fallback;
  }
}

function stringifyJson(value, fallback = null) {
  return JSON.stringify(value ?? fallback);
}

function uniqueStrings(values = []) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
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

function normalizeId(value, fallbackPrefix) {
  const text = String(value || "").trim();
  if (text) {
    return text.replace(/[^A-Za-z0-9_.:-]+/g, "-").slice(0, 160);
  }
  return randomId(fallbackPrefix);
}

function normalizePolicyList(value = []) {
  const input = Array.isArray(value) ? value : value?.policies || value?.resourcePolicies || [];
  return (Array.isArray(input) ? input : []).map((entry) => {
    const resource = objectOrNull(entry.resource) || {};
    return {
      resourceType: String(entry.resourceType || entry.type || resource.type || "*").trim() || "*",
      resourceId: String(entry.resourceId || entry.id || entry.repoId || entry.repositoryRef || resource.id || "*").trim() || "*",
      actions: uniqueStrings(entry.actions || entry.action || entry.scopes || []),
      targetProviders: uniqueStrings(entry.targetProviders || entry.providers || entry.provider || entry.targets || []),
      label: String(entry.label || "").trim()
    };
  }).filter((entry) => entry.actions.length > 0);
}

function normalizeRole(input = {}, fallback = {}) {
  const roleId = normalizeId(input.roleId || input.id || fallback.roleId, "role");
  const timestamp = nowIso();
  return {
    roleId,
    label: String(input.label || input.name || fallback.label || roleId).trim(),
    description: String(input.description || fallback.description || "").trim(),
    system: Boolean(input.system ?? fallback.system ?? false),
    enabled: input.enabled !== false,
    scopes: uniqueStrings(input.scopes || fallback.scopes || []),
    resourcePolicies: normalizePolicyList(input.resourcePolicies || fallback.resourcePolicies || []),
    createdAt: String(fallback.createdAt || input.createdAt || timestamp),
    updatedAt: timestamp
  };
}

function normalizeTeam(input = {}, fallback = {}) {
  const teamId = normalizeId(input.teamId || input.id || fallback.teamId, "team");
  const timestamp = nowIso();
  return {
    teamId,
    label: String(input.label || input.name || fallback.label || teamId).trim(),
    description: String(input.description || fallback.description || "").trim(),
    enabled: input.enabled !== false,
    roleIds: uniqueStrings(input.roleIds || input.roles || fallback.roleIds || []),
    memberUserIds: uniqueStrings(input.memberUserIds || input.members || fallback.memberUserIds || []),
    resourcePolicies: normalizePolicyList(input.resourcePolicies || fallback.resourcePolicies || []),
    createdAt: String(fallback.createdAt || input.createdAt || timestamp),
    updatedAt: timestamp
  };
}

function normalizeUserPolicy(input = {}, fallback = {}) {
  const userId = normalizeId(input.userId || input.subjectId || input.id || fallback.userId, "user");
  const timestamp = nowIso();
  return {
    userId,
    roleIds: uniqueStrings(input.roleIds || input.roles || fallback.roleIds || []),
    teamIds: uniqueStrings(input.teamIds || input.teams || fallback.teamIds || []),
    enabled: input.enabled !== false,
    resourcePolicies: normalizePolicyList(input.resourcePolicies || fallback.resourcePolicies || []),
    createdAt: String(fallback.createdAt || input.createdAt || timestamp),
    updatedAt: timestamp
  };
}

function normalizeAgentGroup(input = {}, fallback = {}) {
  const groupId = normalizeId(input.groupId || input.id || fallback.groupId, "agent-group");
  const timestamp = nowIso();
  return {
    groupId,
    label: String(input.label || input.name || fallback.label || groupId).trim(),
    description: String(input.description || fallback.description || "").trim(),
    enabled: input.enabled !== false,
    resourcePolicies: normalizePolicyList(input.resourcePolicies || fallback.resourcePolicies || []),
    createdAt: String(fallback.createdAt || input.createdAt || timestamp),
    updatedAt: timestamp
  };
}

function normalizeAgentBinding(input = {}, fallback = {}) {
  const agentId = normalizeId(input.agentId || input.id || input.profileId || fallback.agentId, "agent");
  const timestamp = nowIso();
  return {
    agentId,
    boundUserId: String(input.boundUserId || input.userId || fallback.boundUserId || "").trim(),
    profileId: String(input.profileId || input.agentProfileId || fallback.profileId || "").trim(),
    groupIds: uniqueStrings(input.groupIds || input.groups || fallback.groupIds || []),
    enabled: input.enabled !== false,
    resourcePolicies: normalizePolicyList(input.resourcePolicies || fallback.resourcePolicies || []),
    createdAt: String(fallback.createdAt || input.createdAt || timestamp),
    updatedAt: timestamp
  };
}

function normalizeApproval(input = {}, fallback = {}) {
  const approvalId = normalizeId(input.approvalId || input.id || fallback.approvalId, "approval");
  const timestamp = nowIso();
  return {
    approvalId,
    userId: String(input.userId || input.subjectId || fallback.userId || "").trim(),
    agentId: String(input.agentId || fallback.agentId || "").trim(),
    resourceType: String(input.resourceType || fallback.resourceType || "*").trim() || "*",
    resourceId: String(input.resourceId || input.repoId || input.repositoryRef || fallback.resourceId || "*").trim() || "*",
    actions: uniqueStrings(input.actions || input.action || fallback.actions || []),
    targetProviders: uniqueStrings(input.targetProviders || input.provider || input.providers || fallback.targetProviders || []),
    grantKind: String(input.grantKind || input.kind || fallback.grantKind || "once").trim(),
    effect: String(input.effect || fallback.effect || "allow").trim(),
    expiresAt: String(input.expiresAt || fallback.expiresAt || "").trim(),
    revokedAt: String(input.revokedAt || fallback.revokedAt || "").trim(),
    reason: String(input.reason || fallback.reason || "").trim(),
    createdAt: String(fallback.createdAt || input.createdAt || timestamp),
    updatedAt: timestamp
  };
}

function ensureSchema(db) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;

    CREATE TABLE IF NOT EXISTS authorization_roles (
      role_id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      system INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1,
      scopes_json TEXT NOT NULL DEFAULT '[]',
      resource_policies_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS authorization_teams (
      team_id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      role_ids_json TEXT NOT NULL DEFAULT '[]',
      member_user_ids_json TEXT NOT NULL DEFAULT '[]',
      resource_policies_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS authorization_user_policies (
      user_id TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 1,
      role_ids_json TEXT NOT NULL DEFAULT '[]',
      team_ids_json TEXT NOT NULL DEFAULT '[]',
      resource_policies_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS authorization_agent_groups (
      group_id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      resource_policies_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS authorization_agent_bindings (
      agent_id TEXT PRIMARY KEY,
      bound_user_id TEXT NOT NULL DEFAULT '',
      profile_id TEXT NOT NULL DEFAULT '',
      group_ids_json TEXT NOT NULL DEFAULT '[]',
      enabled INTEGER NOT NULL DEFAULT 1,
      resource_policies_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS authorization_approval_grants (
      approval_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT '',
      agent_id TEXT NOT NULL DEFAULT '',
      resource_type TEXT NOT NULL DEFAULT '*',
      resource_id TEXT NOT NULL DEFAULT '*',
      actions_json TEXT NOT NULL DEFAULT '[]',
      target_providers_json TEXT NOT NULL DEFAULT '[]',
      grant_kind TEXT NOT NULL DEFAULT 'once',
      effect TEXT NOT NULL DEFAULT 'allow',
      expires_at TEXT NOT NULL DEFAULT '',
      revoked_at TEXT NOT NULL DEFAULT '',
      reason TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS authorization_governance_events (
      event_id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL DEFAULT '',
      entity_id TEXT NOT NULL DEFAULT '',
      event_type TEXT NOT NULL DEFAULT '',
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_authorization_teams_enabled ON authorization_teams(enabled);
    CREATE INDEX IF NOT EXISTS idx_authorization_agents_bound_user ON authorization_agent_bindings(bound_user_id);
    CREATE INDEX IF NOT EXISTS idx_authorization_approvals_user ON authorization_approval_grants(user_id);
    CREATE INDEX IF NOT EXISTS idx_authorization_approvals_agent ON authorization_approval_grants(agent_id);
  `);
}

function roleFromRow(row) {
  if (!row) return null;
  return {
    roleId: row.role_id,
    label: row.label,
    description: row.description || "",
    system: Boolean(row.system),
    enabled: Boolean(row.enabled),
    scopes: parseJson(row.scopes_json, []),
    resourcePolicies: parseJson(row.resource_policies_json, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function teamFromRow(row) {
  if (!row) return null;
  return {
    teamId: row.team_id,
    label: row.label,
    description: row.description || "",
    enabled: Boolean(row.enabled),
    roleIds: parseJson(row.role_ids_json, []),
    memberUserIds: parseJson(row.member_user_ids_json, []),
    resourcePolicies: parseJson(row.resource_policies_json, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function userPolicyFromRow(row) {
  if (!row) return null;
  return {
    userId: row.user_id,
    enabled: Boolean(row.enabled),
    roleIds: parseJson(row.role_ids_json, []),
    teamIds: parseJson(row.team_ids_json, []),
    resourcePolicies: parseJson(row.resource_policies_json, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function agentGroupFromRow(row) {
  if (!row) return null;
  return {
    groupId: row.group_id,
    label: row.label,
    description: row.description || "",
    enabled: Boolean(row.enabled),
    resourcePolicies: parseJson(row.resource_policies_json, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function agentBindingFromRow(row) {
  if (!row) return null;
  return {
    agentId: row.agent_id,
    boundUserId: row.bound_user_id || "",
    profileId: row.profile_id || "",
    groupIds: parseJson(row.group_ids_json, []),
    enabled: Boolean(row.enabled),
    resourcePolicies: parseJson(row.resource_policies_json, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function approvalFromRow(row) {
  if (!row) return null;
  return {
    approvalId: row.approval_id,
    userId: row.user_id || "",
    agentId: row.agent_id || "",
    resourceType: row.resource_type || "*",
    resourceId: row.resource_id || "*",
    actions: parseJson(row.actions_json, []),
    targetProviders: parseJson(row.target_providers_json, []),
    grantKind: row.grant_kind || "once",
    effect: row.effect || "allow",
    expiresAt: row.expires_at || "",
    revokedAt: row.revoked_at || "",
    reason: row.reason || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function policyMatches(policy = {}, request = {}) {
  const resourceType = String(request.resourceType || "").trim();
  const resourceId = String(request.resourceId || "").trim();
  const action = String(request.action || "").trim();
  const targetProvider = String(request.targetProvider || "").trim();
  const policyType = String(policy.resourceType || "*");
  const policyId = String(policy.resourceId || "*");
  const actions = uniqueStrings(policy.actions || []);
  const targetProviders = uniqueStrings(policy.targetProviders || []);
  return (
    (policyType === "*" || policyType === resourceType) &&
    (policyId === "*" || policyId === resourceId) &&
    (actions.includes("*") || actions.includes(action) || actions.includes(request.scopeAction)) &&
    (targetProviders.length === 0 || targetProviders.includes("*") || targetProviders.includes(targetProvider))
  );
}

function policiesMatch(policies = [], request = {}) {
  return normalizePolicyList(policies).some((policy) => policyMatches(policy, request));
}

function activeRolePolicies(roleIds = [], getRole = () => null) {
  return uniqueStrings(roleIds).flatMap((roleId) => {
    const role = getRole(roleId);
    return role?.enabled ? role.resourcePolicies || [] : [];
  });
}

function inferScopeAction(operationId = "", action = "") {
  if (action.startsWith("repo:")) return action;
  if (/approve/i.test(operationId)) return "repo:approve";
  if (/review\.(comment|requestChanges)/.test(operationId)) return "repo:review";
  if (/(upload|git_upload|submit|maintain|abandon|rebase|merge|revert)/.test(operationId)) return "repo:maintain";
  if (/(prepare|write|create|update|delete|push|link)/.test(operationId)) return "repo:write";
  return "repo:read";
}

function inferGovernanceRequest({ operation = {}, tool = null, input = {}, context = {}, subject = {}, grant = null } = {}) {
  const inputResource = objectOrNull(input.resource) || {};
  const contextResource = objectOrNull(context.resource) || {};
  const operationId = String(operation.id || tool?.operationId || input.operationId || "").trim();
  const rawAction = firstString(input.requestedAction, context.requestedAction, input.action, operationId);
  const action = rawAction || operationId || "read";
  const resourceType = firstString(
    input.resourceType,
    input["resource-type"],
    inputResource.resourceType,
    inputResource.type,
    context.resourceType,
    contextResource.resourceType,
    CODE_OPERATION_RE.test(operationId) ? "repo" : ""
  );
  const resourceId = firstString(
    input.resourceId,
    input.repoId,
    input.repositoryRef,
    input.repository,
    inputResource.resourceId,
    inputResource.id,
    context.resourceId,
    context.repoId,
    contextResource.resourceId,
    "*"
  );
  const targetProvider = firstString(
    input.targetProvider,
    input.provider,
    input.reviewProvider,
    inputResource.targetProvider,
    context.targetProvider,
    contextResource.targetProvider,
    operationId.includes("gerrit") ? "gerrit" : ""
  );
  const agentId = firstString(
    input.agentId,
    input.agentProfileId,
    context.agentId,
    context.profileId,
    context.agentProfileId,
    grant?.metadata?.agentId,
    grant?.metadata?.agentProfileId,
    subject.agentProfileId
  );
  const boundUserId = firstString(
    input.boundUserId,
    input.userId,
    context.boundUserId,
    context.userId,
    grant?.metadata?.boundUserId,
    grant?.metadata?.userId,
    subject.type === "console-user" ? subject.subjectId : ""
  );
  return {
    operationId,
    resourceType,
    resourceId,
    targetProvider,
    action,
    scopeAction: inferScopeAction(operationId, action),
    discoveryLike: /^(codespace\.providers\.manifest|tool_management\.catalog|tool_management\.tools\.list|tool_management\.toolsets\.list)$/.test(operationId),
    agentId,
    boundUserId,
    teamIds: uniqueStrings([
      ...(subject.teamIds || []),
      ...stringsFrom(input.teamIds, context.teamIds, grant?.metadata?.teamIds)
    ]),
    applies: Boolean(resourceType && (resourceType === "repo" || resourceType === "codespace" || CODE_OPERATION_RE.test(operationId))),
    writeLike: WRITE_ACTION_RE.test(action) || WRITE_ACTION_RE.test(operationId)
  };
}

function isActiveApproval(approval = {}, request = {}, { userId = "", agentId = "" } = {}) {
  if (!approval || approval.effect === "deny" || approval.revokedAt) return false;
  if (approval.expiresAt && Date.parse(approval.expiresAt) <= Date.now()) return false;
  if (approval.userId && userId && approval.userId !== userId) return false;
  if (approval.agentId && agentId && approval.agentId !== agentId) return false;
  return policyMatches({
    resourceType: approval.resourceType,
    resourceId: approval.resourceId,
    actions: approval.actions,
    targetProviders: approval.targetProviders
  }, request);
}

export function createAuthorizationGovernanceStore({
  userDataPath = "",
  rootPath = "",
  builtinRoles = DEFAULT_ROLES
} = {}) {
  const resolvedRoot = rootPath ||
    path.join(userDataPath || ServerConfig.getDataDir(), "security", "authorization");
  fs.mkdirSync(resolvedRoot, { recursive: true });
  const db = new Database(path.join(resolvedRoot, "authorization-governance.sqlite"));
  ensureSchema(db);

  const roleUpsert = db.prepare(`
    INSERT INTO authorization_roles (
      role_id, label, description, system, enabled, scopes_json, resource_policies_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(role_id) DO UPDATE SET
      label = excluded.label,
      description = excluded.description,
      system = excluded.system,
      enabled = excluded.enabled,
      scopes_json = excluded.scopes_json,
      resource_policies_json = excluded.resource_policies_json,
      updated_at = excluded.updated_at
  `);
  const teamUpsert = db.prepare(`
    INSERT INTO authorization_teams (
      team_id, label, description, enabled, role_ids_json, member_user_ids_json, resource_policies_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(team_id) DO UPDATE SET
      label = excluded.label,
      description = excluded.description,
      enabled = excluded.enabled,
      role_ids_json = excluded.role_ids_json,
      member_user_ids_json = excluded.member_user_ids_json,
      resource_policies_json = excluded.resource_policies_json,
      updated_at = excluded.updated_at
  `);
  const userPolicyUpsert = db.prepare(`
    INSERT INTO authorization_user_policies (
      user_id, enabled, role_ids_json, team_ids_json, resource_policies_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      enabled = excluded.enabled,
      role_ids_json = excluded.role_ids_json,
      team_ids_json = excluded.team_ids_json,
      resource_policies_json = excluded.resource_policies_json,
      updated_at = excluded.updated_at
  `);
  const agentGroupUpsert = db.prepare(`
    INSERT INTO authorization_agent_groups (
      group_id, label, description, enabled, resource_policies_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(group_id) DO UPDATE SET
      label = excluded.label,
      description = excluded.description,
      enabled = excluded.enabled,
      resource_policies_json = excluded.resource_policies_json,
      updated_at = excluded.updated_at
  `);
  const agentBindingUpsert = db.prepare(`
    INSERT INTO authorization_agent_bindings (
      agent_id, bound_user_id, profile_id, group_ids_json, enabled, resource_policies_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(agent_id) DO UPDATE SET
      bound_user_id = excluded.bound_user_id,
      profile_id = excluded.profile_id,
      group_ids_json = excluded.group_ids_json,
      enabled = excluded.enabled,
      resource_policies_json = excluded.resource_policies_json,
      updated_at = excluded.updated_at
  `);
  const approvalUpsert = db.prepare(`
    INSERT INTO authorization_approval_grants (
      approval_id, user_id, agent_id, resource_type, resource_id, actions_json, target_providers_json,
      grant_kind, effect, expires_at, revoked_at, reason, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(approval_id) DO UPDATE SET
      user_id = excluded.user_id,
      agent_id = excluded.agent_id,
      resource_type = excluded.resource_type,
      resource_id = excluded.resource_id,
      actions_json = excluded.actions_json,
      target_providers_json = excluded.target_providers_json,
      grant_kind = excluded.grant_kind,
      effect = excluded.effect,
      expires_at = excluded.expires_at,
      revoked_at = excluded.revoked_at,
      reason = excluded.reason,
      updated_at = excluded.updated_at
  `);

  function appendEvent(entityType, entityId, eventType, payload = {}) {
    db.prepare(`
      INSERT INTO authorization_governance_events (event_id, entity_type, entity_id, event_type, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(randomId("authz_gov_event"), entityType, entityId, eventType, stringifyJson(payload, {}), nowIso());
  }

  function getPolicyRevision() {
    const row = db.prepare(`
      SELECT count(*) AS revision, max(created_at) AS updated_at
      FROM authorization_governance_events
    `).get();
    return {
      protocolVersion: "v0.0.1:risk-control:governance-policy-revision-1",
      revision: Number(row?.revision || 0),
      updatedAt: row?.updated_at || ""
    };
  }

  function seedBuiltins() {
    for (const role of Object.values(builtinRoles || DEFAULT_ROLES)) {
      const existing = getRole(role.roleId || role.id);
      if (existing && existing.system === false) continue;
      upsertRole({ ...role, system: true, enabled: role.enabled !== false }, { seed: true });
    }
  }

  function upsertRole(input = {}, { seed = false } = {}) {
    const existing = getRole(input.roleId || input.id);
    const role = normalizeRole(input, existing || {});
    roleUpsert.run(
      role.roleId,
      role.label,
      role.description,
      role.system ? 1 : 0,
      role.enabled ? 1 : 0,
      stringifyJson(role.scopes, []),
      stringifyJson(role.resourcePolicies, []),
      role.createdAt,
      role.updatedAt
    );
    if (!seed) appendEvent("role", role.roleId, existing ? "updated" : "created", role);
    return role;
  }

  function getRole(roleId) {
    return roleFromRow(db.prepare("SELECT * FROM authorization_roles WHERE role_id = ?").get(String(roleId || "")));
  }

  function listRoles({ includeDisabled = true } = {}) {
    const rows = includeDisabled
      ? db.prepare("SELECT * FROM authorization_roles ORDER BY system DESC, role_id ASC").all()
      : db.prepare("SELECT * FROM authorization_roles WHERE enabled = 1 ORDER BY system DESC, role_id ASC").all();
    return rows.map(roleFromRow);
  }

  function upsertTeam(input = {}) {
    const existing = getTeam(input.teamId || input.id);
    const team = normalizeTeam(input, existing || {});
    teamUpsert.run(
      team.teamId,
      team.label,
      team.description,
      team.enabled ? 1 : 0,
      stringifyJson(team.roleIds, []),
      stringifyJson(team.memberUserIds, []),
      stringifyJson(team.resourcePolicies, []),
      team.createdAt,
      team.updatedAt
    );
    appendEvent("team", team.teamId, existing ? "updated" : "created", team);
    return team;
  }

  function getTeam(teamId) {
    return teamFromRow(db.prepare("SELECT * FROM authorization_teams WHERE team_id = ?").get(String(teamId || "")));
  }

  function listTeams({ includeDisabled = true } = {}) {
    const rows = includeDisabled
      ? db.prepare("SELECT * FROM authorization_teams ORDER BY team_id ASC").all()
      : db.prepare("SELECT * FROM authorization_teams WHERE enabled = 1 ORDER BY team_id ASC").all();
    return rows.map(teamFromRow);
  }

  function upsertUserPolicy(input = {}) {
    const existing = getUserPolicy(input.userId || input.id);
    const policy = normalizeUserPolicy(input, existing || {});
    userPolicyUpsert.run(
      policy.userId,
      policy.enabled ? 1 : 0,
      stringifyJson(policy.roleIds, []),
      stringifyJson(policy.teamIds, []),
      stringifyJson(policy.resourcePolicies, []),
      policy.createdAt,
      policy.updatedAt
    );
    appendEvent("user-policy", policy.userId, existing ? "updated" : "created", policy);
    return policy;
  }

  function getUserPolicy(userId) {
    return userPolicyFromRow(db.prepare("SELECT * FROM authorization_user_policies WHERE user_id = ?").get(String(userId || "")));
  }

  function listUserPolicies() {
    return db.prepare("SELECT * FROM authorization_user_policies ORDER BY user_id ASC").all().map(userPolicyFromRow);
  }

  function upsertAgentGroup(input = {}) {
    const existing = getAgentGroup(input.groupId || input.id);
    const group = normalizeAgentGroup(input, existing || {});
    agentGroupUpsert.run(
      group.groupId,
      group.label,
      group.description,
      group.enabled ? 1 : 0,
      stringifyJson(group.resourcePolicies, []),
      group.createdAt,
      group.updatedAt
    );
    appendEvent("agent-group", group.groupId, existing ? "updated" : "created", group);
    return group;
  }

  function getAgentGroup(groupId) {
    return agentGroupFromRow(db.prepare("SELECT * FROM authorization_agent_groups WHERE group_id = ?").get(String(groupId || "")));
  }

  function listAgentGroups({ includeDisabled = true } = {}) {
    const rows = includeDisabled
      ? db.prepare("SELECT * FROM authorization_agent_groups ORDER BY group_id ASC").all()
      : db.prepare("SELECT * FROM authorization_agent_groups WHERE enabled = 1 ORDER BY group_id ASC").all();
    return rows.map(agentGroupFromRow);
  }

  function upsertAgentBinding(input = {}) {
    const existing = getAgentBinding(input.agentId || input.id || input.profileId);
    const binding = normalizeAgentBinding(input, existing || {});
    agentBindingUpsert.run(
      binding.agentId,
      binding.boundUserId,
      binding.profileId,
      stringifyJson(binding.groupIds, []),
      binding.enabled ? 1 : 0,
      stringifyJson(binding.resourcePolicies, []),
      binding.createdAt,
      binding.updatedAt
    );
    appendEvent("agent-binding", binding.agentId, existing ? "updated" : "created", binding);
    return binding;
  }

  function getAgentBinding(agentId) {
    return agentBindingFromRow(db.prepare("SELECT * FROM authorization_agent_bindings WHERE agent_id = ?").get(String(agentId || "")));
  }

  function listAgentBindings() {
    return db.prepare("SELECT * FROM authorization_agent_bindings ORDER BY agent_id ASC").all().map(agentBindingFromRow);
  }

  function upsertApproval(input = {}) {
    const existing = getApproval(input.approvalId || input.id);
    const approval = normalizeApproval(input, existing || {});
    approvalUpsert.run(
      approval.approvalId,
      approval.userId,
      approval.agentId,
      approval.resourceType,
      approval.resourceId,
      stringifyJson(approval.actions, []),
      stringifyJson(approval.targetProviders, []),
      approval.grantKind,
      approval.effect,
      approval.expiresAt,
      approval.revokedAt,
      approval.reason,
      approval.createdAt,
      approval.updatedAt
    );
    appendEvent("approval", approval.approvalId, existing ? "updated" : "created", approval);
    return approval;
  }

  function getApproval(approvalId) {
    return approvalFromRow(db.prepare("SELECT * FROM authorization_approval_grants WHERE approval_id = ?").get(String(approvalId || "")));
  }

  function listApprovals({ userId = "", agentId = "", includeRevoked = false } = {}) {
    const clauses = [];
    const params = [];
    if (userId) {
      clauses.push("user_id = ?");
      params.push(String(userId));
    }
    if (agentId) {
      clauses.push("agent_id = ?");
      params.push(String(agentId));
    }
    if (!includeRevoked) {
      clauses.push("revoked_at = ''");
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    return db.prepare(`SELECT * FROM authorization_approval_grants ${where} ORDER BY created_at DESC`).all(...params).map(approvalFromRow);
  }

  function revokeApproval(approvalId, reason = "") {
    const approval = getApproval(approvalId);
    if (!approval) return null;
    const updated = upsertApproval({ ...approval, revokedAt: nowIso(), reason: reason || approval.reason });
    appendEvent("approval", approval.approvalId, "revoked", { reason });
    return updated;
  }

  function hasGovernancePolicies() {
    const counts = [
      db.prepare("SELECT count(*) AS count FROM authorization_teams WHERE enabled = 1").get().count,
      db.prepare("SELECT count(*) AS count FROM authorization_user_policies WHERE enabled = 1").get().count,
      db.prepare("SELECT count(*) AS count FROM authorization_agent_bindings WHERE enabled = 1").get().count,
      db.prepare("SELECT count(*) AS count FROM authorization_agent_groups WHERE enabled = 1").get().count,
      db.prepare("SELECT count(*) AS count FROM authorization_approval_grants WHERE revoked_at = ''").get().count
    ];
    return counts.some((count) => Number(count || 0) > 0);
  }

  function evaluateGovernance(input = {}) {
    const subject = input.subject || {};
    const request = inferGovernanceRequest(input);
    const active = hasGovernancePolicies();
    if (!request.applies || (!active && input.governanceRequired !== true)) {
      return {
        applicable: false,
        effect: "allow",
        reasonCode: "governance_not_applicable",
        request
      };
    }

    const userId = firstString(request.boundUserId, subject.type === "console-user" ? subject.subjectId : "");
    const agentId = request.agentId;
    const userPolicy = userId ? getUserPolicy(userId) : null;
    const teamsFromUserPolicy = userPolicy?.enabled ? userPolicy.teamIds : [];
    const teamIds = uniqueStrings([...request.teamIds, ...teamsFromUserPolicy]);
    const teams = teamIds.map(getTeam).filter((team) => team?.enabled);
    const teamPolicies = teams.flatMap((team) => [
      ...(team.resourcePolicies || []),
      ...activeRolePolicies(team.roleIds || [], getRole)
    ]);
    const userPolicies = userPolicy?.enabled
      ? [
          ...(userPolicy.resourcePolicies || []),
          ...activeRolePolicies(userPolicy.roleIds || [], getRole)
        ]
      : [];
    const teamAllowed = policiesMatch(teamPolicies, request);
    const approvals = listApprovals({ userId, agentId, includeRevoked: false })
      .filter((approval) => isActiveApproval(approval, request, { userId, agentId }));
    const approvalAllowed = approvals.some((approval) => approval.effect === "allow");
    const userExplicitAllowed = policiesMatch(userPolicies, request);
    const userAllowed = Boolean(userPolicy?.enabled && userExplicitAllowed) || approvalAllowed;
    const agentBinding = agentId ? getAgentBinding(agentId) : null;
    const groupPolicies = (agentBinding?.groupIds || [])
      .map(getAgentGroup)
      .filter((group) => group?.enabled)
      .flatMap((group) => group.resourcePolicies || []);
    const directUserOperation = !agentId && subject.type === "console-user";
    const agentBound = directUserOperation || (agentBinding?.enabled && (!userId || !agentBinding.boundUserId || agentBinding.boundUserId === userId));
    const agentAllowed = directUserOperation ||
      Boolean(agentBound && (policiesMatch(agentBinding?.resourcePolicies || [], request) || policiesMatch(groupPolicies, request) || approvalAllowed));

    const snapshot = {
      protocolVersion: "v0.0.1:risk-control:governance-1",
      policyRevision: getPolicyRevision(),
      request,
      team: {
        teamIds,
        matchedTeamIds: teams
          .filter((team) => policiesMatch([
            ...(team.resourcePolicies || []),
            ...activeRolePolicies(team.roleIds || [], getRole)
          ], request))
          .map((team) => team.teamId),
        roleIds: uniqueStrings(teams.flatMap((team) => team.roleIds || [])),
        allowed: teamAllowed
      },
      user: {
        userId,
        policyPresent: Boolean(userPolicy),
        roleIds: userPolicy?.roleIds || [],
        explicitAllowed: Boolean(userPolicy?.enabled && userExplicitAllowed),
        approvalIds: approvals.map((approval) => approval.approvalId),
        allowed: userAllowed
      },
      agent: {
        agentId,
        bindingPresent: Boolean(agentBinding),
        boundUserId: agentBinding?.boundUserId || "",
        groupIds: agentBinding?.groupIds || [],
        allowed: agentAllowed
      }
    };

    if (!userId && agentId && !agentBinding && request.discoveryLike && !request.writeLike) {
      return {
        applicable: true,
        effect: "allow",
        reasonCode: "agent_readonly_discovery_allowed",
        effectivePolicySnapshot: snapshot
      };
    }

    if (!teamAllowed) {
      return {
        applicable: true,
        effect: "deny",
        deniedLayer: "team",
        reasonCode: "team_policy_not_allowed",
        redactedReason: "Team policy does not allow this resource action.",
        effectivePolicySnapshot: snapshot
      };
    }
    if (!userAllowed) {
      return {
        applicable: true,
        effect: "needsApproval",
        deniedLayer: "user",
        reasonCode: "user_approval_required",
        redactedReason: "User approval is required for this resource action.",
        requiredApproval: {
          userId,
          agentId,
          resourceType: request.resourceType,
          resourceId: request.resourceId,
          actions: [request.action, request.scopeAction].filter(Boolean),
          targetProviders: request.targetProvider ? [request.targetProvider] : [],
          grantKinds: ["once", "timed", "permanent"]
        },
        effectivePolicySnapshot: snapshot
      };
    }
    if (!agentBound) {
      return {
        applicable: true,
        effect: "deny",
        deniedLayer: "agent",
        reasonCode: "agent_not_bound_to_user",
        redactedReason: "Agent is not bound to the requested user.",
        effectivePolicySnapshot: snapshot
      };
    }
    if (request.writeLike && !agentAllowed) {
      return {
        applicable: true,
        effect: "needsApproval",
        deniedLayer: "agent",
        reasonCode: "agent_approval_required",
        redactedReason: "Agent approval is required for this resource action.",
        requiredApproval: {
          userId,
          agentId,
          resourceType: request.resourceType,
          resourceId: request.resourceId,
          actions: [request.action, request.scopeAction].filter(Boolean),
          targetProviders: request.targetProvider ? [request.targetProvider] : [],
          grantKinds: ["once", "timed", "permanent"]
        },
        effectivePolicySnapshot: snapshot
      };
    }
    return {
      applicable: true,
      effect: "allow",
      reasonCode: "governance_allowed",
      effectivePolicySnapshot: snapshot
    };
  }

  seedBuiltins();

  return {
    close() {
      db.close();
    },
    listRoles,
    getRole,
    upsertRole,
    listTeams,
    getTeam,
    upsertTeam,
    listUserPolicies,
    getUserPolicy,
    upsertUserPolicy,
    listAgentGroups,
    getAgentGroup,
    upsertAgentGroup,
    listAgentBindings,
    getAgentBinding,
    upsertAgentBinding,
    listApprovals,
    getApproval,
    upsertApproval,
    revokeApproval,
    getPolicyRevision,
    hasGovernancePolicies,
    evaluateGovernance
  };
}
