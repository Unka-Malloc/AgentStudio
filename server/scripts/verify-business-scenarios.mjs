#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import {
  expectAuditEvent,
  expectHttpRpcCliParity,
  expectNoSensitiveText,
  expectOk,
  expectSafetyDenied,
  expectStatus,
  expectUnauthorized,
  parseBusinessScenarioArgs,
  printBusinessScenarioHelp,
  runScenarioSuite,
  scenario,
  startMockAgentGateway
} from "./business-scenario-framework.mjs";

function bearerHeaders(token, extra = {}) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    ...extra
  };
}

function operationIds(payload) {
  return new Set((payload?.interfaces || []).map((item) => item.id));
}

function findAgent(registry, agentId) {
  return (registry?.agents || []).find((agent) => agent.alias === agentId || agent.uid === agentId);
}

function knowledgeSources(payload) {
  return payload?.items || payload?.sources || payload?.state?.items || payload?.state?.sources || [];
}

function jobItems(payload) {
  return payload?.jobs || payload?.items || [];
}

function eventItems(payload) {
  return [
    ...(Array.isArray(payload?.events) ? payload.events : []),
    ...(Array.isArray(payload?.snapshots) ? payload.snapshots : [])
  ];
}

function findEventByRevision(payload, revision) {
  return eventItems(payload).find((event) => Number(event?.payload?.policyRevision?.revision || 0) === revision);
}

async function saveSettings(harness, auth, patch) {
  const current = await harness.get("/api/settings", { auth });
  expectOk(current, "settings get");
  const saved = await harness.post(
    "/api/settings",
    {
      ...current.payload,
      ...patch
    },
    { auth }
  );
  expectOk(saved, "settings save");
  return saved.payload;
}

const scenarios = [
  scenario({
    id: "auth.permission-boundaries",
    title: "认证、角色边界、CSRF 和 safety-confirm",
    tags: ["auth", "security", "permissions"],
    async setup({ harness, state }) {
      state.owner = await harness.loginOwner();
      state.admin = await harness.createConsoleUser({
        username: "business_admin",
        roleId: "admin"
      });
      state.operator = await harness.createConsoleUser({
        username: "business_operator",
        roleId: "operator"
      });
      state.viewer = await harness.createConsoleUser({
        username: "business_viewer",
        roleId: "viewer"
      });
    },
    async run({ harness, state }) {
      state.unauthConsole = await harness.get("/api/console/state");
      state.ownerUsers = await harness.get("/api/auth/users", { auth: state.owner });
      state.httpCreateUser = await harness.post(
        "/api/auth/users",
        { username: "http_should_not_create", password: "never", roleId: "viewer" },
        { auth: state.owner }
      );
      state.viewerSettings = await harness.get("/api/settings", { auth: state.viewer.auth });
      state.viewerWrite = await harness.post(
        "/api/settings",
        { businessScenarioWrite: "viewer-must-not-write" },
        { auth: state.viewer.auth }
      );
      state.operatorMonitorWrite = await harness.post(
        "/api/system/monitor-alerts/config",
        { enabled: true },
        { auth: state.operator.auth }
      );
      state.ownerMissingCsrf = await harness.post(
        "/api/settings",
        { businessScenarioWrite: "missing-csrf" },
        {
          headers: {
            Cookie: state.owner.cookie
          }
        }
      );
      state.ownerMissingSafety = await harness.post(
        "/api/settings",
        { businessScenarioWrite: "missing-safety" },
        { auth: state.owner, safetyConfirm: false }
      );
      state.adminMonitorWrite = await harness.post(
        "/api/system/monitor-alerts/config",
        {
          enabled: true,
          rules: {
            processNotRunning: { enabled: false },
            processStale: { enabled: false },
            processRestarted: { enabled: false }
          }
        },
        { auth: state.admin.auth }
      );
    },
    assert({ state }) {
      expectUnauthorized(state.unauthConsole, "unauthenticated console state");
      expectNoSensitiveText(state.unauthConsole, ["password", "apiKey", "secret"]);
      expectOk(state.ownerUsers, "owner can list auth users");
      assert.ok(state.ownerUsers.payload.users.some((user) => user.username === "business_viewer"));
      expectStatus(state.httpCreateUser, 405, "HTTP user creation must not set initial passwords");
      expectOk(state.viewerSettings, "viewer can read settings");
      expectUnauthorized(state.viewerWrite, "viewer cannot save runtime settings");
      expectUnauthorized(state.operatorMonitorWrite, "operator cannot edit monitor alert config");
      expectSafetyDenied(state.ownerMissingCsrf, "write without csrf must fail");
      expectSafetyDenied(state.ownerMissingSafety, "write without safety confirmation must fail");
      expectOk(state.adminMonitorWrite, "admin can save monitor alert config");
    }
  }),

  scenario({
    id: "config.current-architecture-persistence",
    title: "配置和模块字段只使用当前架构并可重启恢复",
    tags: ["config", "persistence", "modules"],
    async setup({ harness, state }) {
      state.owner = await harness.loginOwner();
    },
    async run({ harness, state }) {
      state.saved = await saveSettings(harness, state.owner, {
        modelLibraryEntries: ["custom-http"],
        modelLibraryAgentIds: ["business-config-agent"],
        modelLibraryAgents: [
          {
            uid: "business-config-agent",
            provider: "custom-http",
            label: "Business Config Agent",
            model: "business-model",
            url: "http://127.0.0.1:65531/agent",
            permissionGroupId: "business-config-permission"
          }
        ],
        customHttpAdapter: {
          provider: "custom-http",
          alias: "business-config-agent",
          url: "http://127.0.0.1:65531/agent",
          token: "",
          agentName: "business-config-agent"
        },
        customHttpAdapters: [
          {
            provider: "custom-http",
            alias: "business-config-agent",
            url: "http://127.0.0.1:65531/agent",
            token: "",
            agentName: "business-config-agent"
          }
        ],
        moduleModelAssignments: {
          knowledgeTaxonomy: {
            provider: "custom-http",
            model: "business-config-agent"
          },
          agentTools: {
            provider: "custom-http",
            model: "business-config-agent"
          }
        },
        agentPermissionGroups: [
          {
            id: "business-config-permission",
            label: "Business Config Permission",
            scopeIds: ["knowledge:read"],
            toolsetIds: ["pact.knowledge.read"]
          }
        ]
      });
      state.persisted = await harness.readJson(harness.filePath("settings.json"), {});
      await harness.restart();
      state.ownerAfterRestart = await harness.login("owner", state.owner.password);
      state.reloaded = await harness.get("/api/settings", { auth: state.ownerAfterRestart });
    },
    assert({ state }) {
      assert.equal(state.saved.modelLibraryAgentIds.includes("business-config-agent"), true);
      assert.equal(state.saved.modelLibraryAgents[0].permissionGroupId, "business-config-permission");
      for (const legacyField of ["agentGateway", "modelLibraryModels"]) {
        assert.equal(Object.hasOwn(state.saved, legacyField), false, `${legacyField} must not be exposed`);
        assert.equal(Object.hasOwn(state.persisted, legacyField), false, `${legacyField} must not persist`);
      }
      expectOk(state.reloaded, "settings after restart");
      assert.equal(state.reloaded.payload.modelLibraryAgentIds.includes("business-config-agent"), true);
      assert.deepEqual(state.reloaded.payload.moduleModelAssignments.knowledgeTaxonomy, {
        provider: "custom-http",
        model: "business-config-agent"
      });
      assert.deepEqual(state.reloaded.payload.moduleModelAssignments.agentTools, {
        provider: "custom-http",
        model: "business-config-agent"
      });
    }
  }),

  scenario({
    id: "agents.management-and-permission-groups",
    title: "智能体新增、修改、删除和权限组规范化",
    tags: ["agents", "permissions", "config"],
    async setup({ harness, state }) {
      state.owner = await harness.loginOwner();
    },
    async run({ harness, state }) {
      state.created = await harness.post(
        "/api/agents",
        {
          uid: "business-agent-alpha",
          provider: "custom-http",
          name: "Business Agent Alpha",
          model: "alpha-model",
          url: "http://127.0.0.1:65532/alpha"
        },
        { auth: state.owner }
      );
      state.updated = await harness.post(
        "/api/agents/business-agent-alpha",
        {
          label: "Business Agent Alpha Updated",
          model: "alpha-model-v2",
          permissionGroupId: "business-agent-readers"
        },
        { auth: state.owner }
      );
      state.settings = await saveSettings(harness, state.owner, {
        agentPermissionGroups: [
          {
            id: "business-agent-readers",
            label: "Business Agent Readers",
            scopeIds: ["knowledge:read"],
            toolsetIds: ["pact.knowledge.read"]
          },
          {
            id: "business-agent-readers",
            label: "Duplicate Should Be Dropped",
            scopeIds: ["runtime:admin"]
          }
        ]
      });
      state.listed = await harness.get("/api/agents", { auth: state.owner });
      state.deleted = await harness.delete("/api/agents/business-agent-alpha", { auth: state.owner });
      state.afterDelete = await harness.get("/api/agents", { auth: state.owner });
    },
    assert({ state }) {
      expectOk(state.created, "agent create");
      assert.equal(state.created.payload.agentId, "business-agent-alpha");
      expectOk(state.updated, "agent update");
      assert.equal(state.updated.payload.agentId, "business-agent-alpha");
      const groups = state.settings.agentPermissionGroups.filter((group) => group.id === "business-agent-readers");
      assert.equal(groups.length, 1, "duplicate permission group ids must normalize to one unambiguous group");
      expectOk(state.listed, "agent list");
      const updatedAgent = findAgent(state.listed.payload, "business-agent-alpha");
      assert.ok(updatedAgent, "created agent must be listed");
      expectOk(state.deleted, "agent delete");
      assert.equal(findAgent(state.afterDelete.payload, "business-agent-alpha"), undefined);
    }
  }),

  scenario({
    id: "tool-management.current-contracts",
    title: "工具管理只暴露 v1，授权、裁决、审计和指标一致",
    tags: ["tools", "security", "audit"],
    async setup({ harness, state }) {
      state.owner = await harness.loginOwner();
    },
    async run({ harness, state }) {
      state.interfaces = await harness.get("/api/interfaces", { auth: state.owner });
      state.catalog = await harness.get("/api/tool-management/v1/catalog", { auth: state.owner });
      state.initialGovernanceUpdate = await harness.post(
        "/api/authorization/teams",
        {
          teamId: "business-scenario-bootstrap-team",
          label: "Business Scenario Bootstrap Team"
        },
        { auth: state.owner }
      );
      state.grant = await harness.post(
        "/api/tool-management/v1/grants",
        {
          label: "business-scenario-tool-grant",
          scopes: ["knowledge:read"],
          toolAllow: ["pact.knowledge.health"]
        },
        { auth: state.owner }
      );
      state.previewAllowed = await harness.post(
        "/api/tool-management/v1/policy/preview",
        {
          toolId: "pact.knowledge.health",
          grantId: state.grant.payload.grant.id
        },
        { auth: state.owner }
      );
      state.governanceUpdate = await harness.post(
        "/api/authorization/teams",
        {
          teamId: "business-scenario-tool-team",
          label: "Business Scenario Tool Team"
        },
        { auth: state.owner }
      );
      state.previewAfterGovernanceUpdate = await harness.post(
        "/api/tool-management/v1/policy/preview",
        {
          toolId: "pact.knowledge.health",
          grantId: state.grant.payload.grant.id
        },
        { auth: state.owner }
      );
      state.governanceEvents = await harness.get("/api/events", {
        auth: state.owner,
        query: {
          topic: "authorization.governance.updated",
          includeSnapshot: 1,
          limit: 20
        }
      });
      state.permissionEvents = await harness.get("/api/events", {
        auth: state.owner,
        query: {
          topic: "permissions.updated",
          includeSnapshot: 1,
          limit: 20
        }
      });
      state.executed = await harness.post(
        "/api/tool-management/v1/execute",
        {
          toolId: "pact.knowledge.health",
          input: {}
        },
        {
          headers: bearerHeaders(state.grant.payload.token)
        }
      );
      state.denied = await harness.post(
        "/api/tool-management/v1/execute",
        {
          toolId: "pact.knowledge.search",
          input: {}
        },
        {
          headers: bearerHeaders(state.grant.payload.token)
        }
      );
      state.audit = await harness.get("/api/tool-management/v1/audit", {
        auth: state.owner,
        query: { limit: 50 }
      });
      state.metrics = await harness.get("/api/tool-management/v1/metrics/summary", { auth: state.owner });
      state.rotated = await harness.post(
        `/api/tool-management/v1/grants/${encodeURIComponent(state.grant.payload.grant.id)}/rotate`,
        {},
        { auth: state.owner }
      );
      state.oldTokenAfterRotate = await harness.post(
        "/api/tool-management/v1/execute",
        {
          toolId: "pact.knowledge.health",
          input: {}
        },
        {
          headers: bearerHeaders(state.grant.payload.token)
        }
      );
      state.revoked = await harness.post(
        `/api/tool-management/v1/grants/${encodeURIComponent(state.grant.payload.grant.id)}/revoke`,
        { reason: "business scenario complete" },
        { auth: state.owner }
      );
      state.legacyHttpPlatform = await harness.get("/api/tool-platform/catalog", { auth: state.owner });
      state.legacyHttpAgentTools = await harness.get("/api/agent-tools/catalog", { auth: state.owner });
      state.legacyRpc = await harness.rpc("tool_platform.catalog", {}, { auth: state.owner });
      state.legacyCli = await harness.cli(["tool-platform", "catalog"], { auth: state.owner });
    },
    assert({ state }) {
      expectOk(state.interfaces, "interfaces");
      const ids = operationIds(state.interfaces.payload);
      assert.equal(ids.has("tool_management.catalog"), true);
      assert.equal([...ids].some((id) => id.startsWith("tool_platform.")), false);
      assert.equal([...ids].some((id) => id.startsWith("agent_tools.")), false);
      expectOk(state.catalog, "tool catalog");
      assert.ok(state.catalog.payload.tools.some((tool) => tool.id === "pact.knowledge.health"));
      expectOk(state.initialGovernanceUpdate, "initial authorization governance update");
      expectStatus(state.grant, 201, "create grant");
      assert.equal(
        state.grant.payload.grant.metadata.policyRevision,
        state.initialGovernanceUpdate.payload.policyRevision.revision
      );
      expectOk(state.previewAllowed, "policy preview");
      assert.equal(state.previewAllowed.payload.decision.effect, "allow");
      expectOk(state.governanceUpdate, "authorization governance update");
      assert.equal(state.governanceUpdate.payload.refresh.grantRefreshRequired, true);
      assert.equal(state.governanceUpdate.payload.refresh.gatewayPolicyReloadRequired, true);
      assert.equal(state.governanceUpdate.payload.events.governance.topic, "authorization.governance.updated");
      assert.equal(state.governanceUpdate.payload.events.permissions.topic, "permissions.updated");
      expectOk(state.previewAfterGovernanceUpdate, "policy preview after governance update");
      assert.equal(state.previewAfterGovernanceUpdate.payload.decision.grantPolicyState, "stale");
      const policyRevision = state.governanceUpdate.payload.policyRevision.revision;
      const grantPolicyRevision = Number(state.grant.payload.grant.metadata.policyRevision || 0);
      assert.equal(policyRevision > grantPolicyRevision, true);
      expectOk(state.governanceEvents, "authorization governance event stream");
      const governanceEvent = findEventByRevision(state.governanceEvents.payload, policyRevision);
      assert.ok(governanceEvent, "governance update must publish a retained event");
      assert.equal(governanceEvent.payload.refresh.grantRefreshRequired, true);
      assert.equal(governanceEvent.payload.mutation.entityType, "team");
      assert.equal(governanceEvent.payload.mutation.entityId, "business-scenario-tool-team");
      expectOk(state.permissionEvents, "permissions update event stream");
      const permissionEvent = findEventByRevision(state.permissionEvents.payload, policyRevision);
      assert.ok(permissionEvent, "permission update must be visible to clients");
      assert.equal(permissionEvent.payload.sourceTopic, "authorization.governance.updated");
      assert.equal(permissionEvent.payload.refresh.gatewayPolicyReloadRequired, true);
      expectOk(state.executed, "execute allowed tool");
      expectStatus(state.denied, 403, "deny tool outside allowlist");
      expectAuditEvent(
        state.audit.payload.items,
        (item) => item.toolExecutionId === state.executed.payload.toolExecutionId,
        "successful tool execution must be audited"
      );
      expectAuditEvent(
        state.audit.payload.items,
        (item) => item.status === "denied" || item.decision === "deny",
        "denied tool execution must be audited"
      );
      assert.ok(state.metrics.payload.metrics.callsTotal >= 2);
      expectStatus(state.rotated, 200, "rotate grant");
      expectStatus(state.oldTokenAfterRotate, 401, "old token must fail after rotation");
      expectOk(state.revoked, "revoke grant");
      expectStatus(state.legacyHttpPlatform, 404, "legacy tool-platform HTTP must be unavailable");
      expectStatus(state.legacyHttpAgentTools, 404, "legacy agent-tools HTTP must be unavailable");
      assert.ok(state.legacyRpc.payload.error, "legacy RPC must return JSON-RPC error");
      assert.notEqual(state.legacyCli.status, 0, "legacy CLI command must fail");
    }
  }),

  scenario({
    id: "knowledge.management-rules-and-review",
    title: "知识源、规则读写、审核队列公开契约",
    tags: ["knowledge", "rules", "queue"],
    async setup({ harness, state }) {
      state.owner = await harness.loginOwner();
      state.sourceDir = await harness.makeFixtureDir("knowledge-source");
      await fs.writeFile(path.join(state.sourceDir, "business-note.md"), "# Business Note\n\nQueue and knowledge fixture.\n", "utf8");
    },
    async run({ harness, state }) {
      state.created = await harness.post(
        "/api/knowledge/sources",
        {
          sourceId: "business-knowledge-source",
          label: "Business Knowledge Source",
          directoryPath: state.sourceDir,
          enabled: true,
          autoSync: false,
          recursive: true,
          runNow: false
        },
        { auth: state.owner }
      );
      state.updated = await harness.post(
        "/api/knowledge/sources/business-knowledge-source",
        {
          enabled: false,
          label: "Business Knowledge Source Paused"
        },
        { auth: state.owner }
      );
      state.reenabled = await harness.post(
        "/api/knowledge/sources/business-knowledge-source",
        {
          enabled: true,
          autoSync: false
        },
        { auth: state.owner }
      );
      state.refreshed = await harness.post(
        "/api/knowledge/sources/business-knowledge-source/refresh",
        { reason: "business-scenario", force: true },
        { auth: state.owner }
      );
      state.sources = await harness.get("/api/knowledge/sources", { auth: state.owner });
      state.jobs = await harness.get("/api/jobs", { auth: state.owner, query: { limit: 20 } });
      state.savedEmailRules = await harness.post(
        "/api/email-rules",
        {
          rules: {
            reportSeries: [
              {
                id: "business-weekly-report",
                label: "Business Weekly Report",
                cadence: "weekly",
                keywords: ["weekly", "business"]
              }
            ],
            synonymDictionary: [
              {
                canonical: "business",
                terms: ["business", "biz"]
              }
            ]
          }
        },
        { auth: state.owner }
      );
      state.emailRules = await harness.get("/api/email-rules", { auth: state.owner });
      state.savedVocabulary = await harness.post(
        "/api/expert-vocabulary",
        {
          vocabulary: {
            entries: [
              {
                id: "business-vocabulary",
                pathSegments: ["Business", "Scenario"],
                terms: ["business scenario"],
                aliases: ["biz scenario"]
              }
            ]
          }
        },
        { auth: state.owner }
      );
      state.vocabulary = await harness.get("/api/expert-vocabulary", { auth: state.owner });
      state.reviewPending = await harness.get("/api/knowledge/review-items", {
        auth: state.owner,
        query: { status: "pending", limit: 20 }
      });
      state.deleted = await harness.delete("/api/knowledge/sources/business-knowledge-source", { auth: state.owner });
    },
    assert({ state }) {
      expectOk(state.created, "knowledge source create");
      expectOk(state.updated, "knowledge source pause");
      assert.equal(state.updated.payload.source.enabled, false);
      expectOk(state.reenabled, "knowledge source re-enable");
      expectOk(state.refreshed, "knowledge source refresh");
      expectOk(state.sources, "knowledge source list");
      assert.ok(knowledgeSources(state.sources.payload).some((source) => source.sourceId === "business-knowledge-source"));
      expectOk(state.jobs, "jobs list after knowledge refresh");
      assert.ok(Array.isArray(jobItems(state.jobs.payload)), "job list must expose queue surface");
      assert.ok(state.savedEmailRules.payload.rules.reportSeries.some((rule) => rule.id === "business-weekly-report"));
      assert.ok(state.emailRules.payload.rules.synonymDictionary.some((item) => item.canonical === "business"));
      assert.ok(state.savedVocabulary.payload.vocabulary.entries.some((entry) => entry.id === "business-vocabulary"));
      assert.ok(state.vocabulary.payload.vocabulary.entries.some((entry) => entry.id === "business-vocabulary"));
      expectOk(state.reviewPending, "review item list");
      assert.equal(Array.isArray(state.reviewPending.payload.items), true);
      expectOk(state.deleted, "knowledge source delete");
    }
  }),

  scenario({
    id: "queues.monitor-alerts-unified-registration",
    title: "工作队列中断、恢复信息、确认关闭和统一注册",
    tags: ["queue", "monitoring", "alerts", "registration"],
    async setup({ harness, state }) {
      state.owner = await harness.loginOwner();
      state.config = await harness.post(
        "/api/system/monitor-alerts/config",
        {
          enabled: true,
          intervalMs: 5000,
          heartbeatStaleMs: 15000,
          queueHeartbeatStaleMs: 5000,
          recoverInterruptedQueues: true,
          rules: {
            supervisorStopped: { enabled: false },
            processNotRunning: { enabled: false },
            processStale: { enabled: false },
            processRestarted: { enabled: false },
            queueInterrupted: {
              enabled: true,
              severity: "critical",
              titleTemplate: "{{queueLabel}} 中断",
              messageTemplate: "{{queueLabel}} 已中断，恢复状态 {{recoveryStatus}}。"
            }
          }
        },
        { auth: state.owner }
      );
      state.fixture = await harness.writeInterruptedQueueFixture();
    },
    async run({ harness, state }) {
      state.interrupted = await harness.get("/api/system/monitor-alerts", { auth: state.owner });
      state.recoveredJob = await harness.readJson(path.join(state.fixture.jobDir, "meta.json"), {});
      state.deduped = await harness.get("/api/system/monitor-alerts", { auth: state.owner });
      const queueState = await harness.readJson(harness.filePath("background", "queue-monitor-state.json"), {});
      const item = queueState.items[state.fixture.queueId];
      const runningAt = new Date().toISOString();
      await harness.writeJson(path.join(state.fixture.jobDir, "meta.json"), {
        ...state.recoveredJob,
        status: "running",
        stage: "恢复后重新运行",
        updatedAt: runningAt
      });
      await harness.writeJson(harness.filePath("background", "queue-monitor-state.json"), {
        ...queueState,
        updatedAt: runningAt,
        items: {
          ...queueState.items,
          [state.fixture.queueId]: {
            ...item,
            lifecycleStatus: "interrupted",
            status: "running",
            phase: "running",
            lastHeartbeatAt: runningAt
          }
        }
      });
      state.restored = await harness.get("/api/system/monitor-alerts", { auth: state.owner });
      const restoredAlert = state.restored.payload.activeAlerts.find(
        (alert) => alert.ruleId === "queueInterrupted" && alert.queueId === state.fixture.queueId
      );
      state.ack = await harness.post(
        `/api/system/monitor-alerts/${encodeURIComponent(restoredAlert.alertId)}/ack`,
        {},
        { auth: state.owner }
      );
      state.backgroundProcesses = await harness.get("/api/system/background-processes", { auth: state.owner });
    },
    assert({ state }) {
      expectOk(state.config, "monitor alert config");
      expectOk(state.interrupted, "monitor interrupted state");
      const interruptedAlerts = state.interrupted.payload.activeAlerts.filter(
        (alert) => alert.ruleId === "queueInterrupted" && alert.queueId === state.fixture.queueId
      );
      assert.equal(interruptedAlerts.length, 1, "one queue can only have one interruption alert");
      assert.equal(interruptedAlerts[0].active, true);
      assert.equal(state.recoveredJob.status, "queued", "interrupted job must be queued for recovery");
      const dedupedAlerts = state.deduped.payload.activeAlerts.filter(
        (alert) => alert.ruleId === "queueInterrupted" && alert.queueId === state.fixture.queueId
      );
      assert.equal(dedupedAlerts.length, 1, "repeated scans must not duplicate queue interruption alerts");
      const restoredAlerts = state.restored.payload.activeAlerts.filter(
        (alert) => alert.ruleId === "queueInterrupted" && alert.queueId === state.fixture.queueId
      );
      assert.equal(restoredAlerts.length, 1, "restored info must reuse the interruption alert slot");
      assert.equal(restoredAlerts[0].alertId, interruptedAlerts[0].alertId);
      assert.equal(restoredAlerts[0].active, false);
      assert.equal(restoredAlerts[0].ackRequired, true);
      expectOk(state.ack, "ack restored alert");
      assert.equal(
        state.ack.payload.activeAlerts.some((alert) => alert.alertId === restoredAlerts[0].alertId),
        false
      );
      const registrations = state.restored.payload.systemStatus.registrations || [];
      for (const type of ["process", "queue", "monitor", "alert"]) {
        assert.ok(
          registrations.some((registration) => registration.originalType === type),
          `system status must contain ${type} registrations`
        );
      }
      expectOk(state.backgroundProcesses, "background process status");
      assert.ok(state.backgroundProcesses.payload.processes.length > 0);
      assert.ok(
        state.backgroundProcesses.payload.processes.every((processItem) =>
          ["daemon", "service"].includes(processItem.processType)
        ),
        "processes must classify daemon/service role"
      );
    }
  }),

  scenario({
    id: "maintenance-agent.mock-gateway-approval",
    title: "智能巡检通过 mock gateway 规划，高风险步骤必须审批",
    tags: ["maintenance", "agents", "approval"],
    async setup({ harness, state }) {
      state.owner = await harness.loginOwner();
      state.gateway = await startMockAgentGateway();
      state.settings = await saveSettings(harness, state.owner, {
        defaultModelProvider: "custom-http",
        modelLibraryEntries: ["custom-http"],
        customHttpAdapter: {
          provider: "custom-http",
          alias: "business-maintenance-gateway",
          url: state.gateway.url,
          token: "",
          agentName: "business-maintenance-gateway",
          timeoutMs: 30000
        },
        customHttpAdapters: [
          {
            provider: "custom-http",
            alias: "business-maintenance-gateway",
            url: state.gateway.url,
            token: "",
            agentName: "business-maintenance-gateway",
            timeoutMs: 30000
          }
        ]
      });
      const current = await harness.get("/api/maintenance-agent/config", { auth: state.owner });
      state.config = await harness.post(
        "/api/maintenance-agent/config",
        {
          config: {
            ...current.payload.config,
            enabled: true,
            plannerMode: "gateway",
            autoApproveRisk: "safe_write",
            schedules: current.payload.config.schedules.map((schedule) => ({ ...schedule, enabled: false }))
          }
        },
        { auth: state.owner }
      );
    },
    async run({ harness, state }) {
      state.safeRun = await harness.post(
        "/api/maintenance-agent/chat",
        {
          message: "run health inspection"
        },
        { auth: state.owner }
      );
      state.riskyRun = await harness.post(
        "/api/maintenance-agent/chat",
        {
          message: "risk repair approve knowledge index"
        },
        { auth: state.owner }
      );
      state.badApprove = await harness.post(
        `/api/maintenance-agent/runs/${encodeURIComponent(state.riskyRun.payload.run.runId)}/approve`,
        { planHash: "wrong-plan-hash" },
        { auth: state.owner }
      );
      state.goodApprove = await harness.post(
        `/api/maintenance-agent/runs/${encodeURIComponent(state.riskyRun.payload.run.runId)}/approve`,
        { planHash: state.riskyRun.payload.run.planHash },
        { auth: state.owner }
      );
      state.failedRun = await harness.post(
        "/api/maintenance-agent/chat",
        {
          message: "fail gateway now"
        },
        { auth: state.owner }
      );
      state.runs = await harness.get("/api/maintenance-agent/runs", {
        auth: state.owner,
        query: { limit: 20 }
      });
      state.audit = await harness.readJsonLines(harness.filePath("maintenance-agent-audit.jsonl"));
      await state.gateway.close();
      state.gatewayClosed = true;
    },
    assert({ state }) {
      expectOk(state.config, "maintenance config");
      expectOk(state.safeRun, "safe maintenance run");
      assert.equal(state.safeRun.payload.run.status, "completed");
      assert.equal(state.safeRun.payload.run.risk, "read_only");
      expectOk(state.riskyRun, "risky maintenance run");
      assert.equal(state.riskyRun.payload.run.status, "awaiting_approval");
      assert.equal(state.riskyRun.payload.run.requiresApproval, true);
      assert.equal(state.riskyRun.payload.run.risk, "repair_write");
      expectStatus(state.badApprove, 409, "bad plan hash must fail");
      expectOk(state.goodApprove, "approved risky run");
      assert.ok(["completed", "completed_with_errors", "failed"].includes(state.goodApprove.payload.run.status));
      expectStatus(state.failedRun, 400, "gateway failure must be reported");
      expectOk(state.runs, "maintenance run list");
      assert.ok(state.runs.payload.items.length >= 2);
      assert.ok(state.audit.some((entry) => entry.runId === state.riskyRun.payload.run.runId));
      assert.ok(state.gateway.requests.length >= 3, "mock gateway must receive planner calls");
    }
  }),

  scenario({
    id: "events.logout-consistency",
    title: "事件流推送状态变化，登出后旧会话不能回填状态",
    tags: ["events", "auth", "consistency"],
    async setup({ harness, state }) {
      state.owner = await harness.loginOwner();
    },
    async run({ harness, state }) {
      state.initialEvents = await harness.get("/api/events", {
        auth: state.owner,
        query: { includeSnapshot: 1, timeoutMs: 10, limit: 50 }
      });
      await saveSettings(harness, state.owner, {
        businessScenarioEventMarker: `event-${Date.now()}`
      });
      state.afterSaveEvents = await harness.get("/api/events", {
        auth: state.owner,
        query: { cursor: 0, timeoutMs: 10, limit: 100 }
      });
      state.logout = await harness.post("/api/auth/logout", {}, { auth: state.owner });
      state.afterLogoutConsole = await harness.get("/api/console/state", {
        headers: { Cookie: state.owner.cookie }
      });
      state.afterLogoutEvents = await harness.get("/api/events", {
        headers: { Cookie: state.owner.cookie },
        query: { includeSnapshot: 1, timeoutMs: 10, limit: 10 }
      });
    },
    assert({ state }) {
      expectOk(state.initialEvents, "initial event subscription");
      assert.equal(Array.isArray(state.initialEvents.payload.events), true);
      expectOk(state.afterSaveEvents, "events after settings save");
      assert.ok(
        state.afterSaveEvents.payload.events.some((event) =>
          ["settings.current", "system.console_state"].includes(event.topic)
        ),
        "event stream must publish settings or console state changes"
      );
      expectOk(state.logout, "logout");
      expectUnauthorized(state.afterLogoutConsole, "old session cannot read console state after logout");
      expectUnauthorized(state.afterLogoutEvents, "old event subscription credentials cannot fetch snapshots after logout");
    }
  }),

  scenario({
    id: "interfaces.http-rpc-cli-parity-and-legacy-unavailable",
    title: "HTTP/RPC/CLI 标准调用面等价，旧接口明确失败",
    tags: ["interfaces", "rpc", "cli", "legacy"],
    async setup({ harness, state }) {
      state.owner = await harness.loginOwner();
    },
    async run({ harness, state }) {
      state.httpHealth = await harness.get("/api/healthz");
      state.rpcHealth = await harness.rpc("system.health");
      state.cliHealth = await harness.cli(["health"]);
      state.httpInterfaces = await harness.get("/api/interfaces", { auth: state.owner });
      state.rpcInterfaces = await harness.rpc("system.interfaces", {}, { auth: state.owner });
      state.cliInterfaces = await harness.cli(["interfaces"], { auth: state.owner });
      state.legacyRpcToolPlatform = await harness.rpc("tool_platform.grants", {}, { auth: state.owner });
      state.legacyRpcAgentTools = await harness.rpc("agent_tools.catalog", {}, { auth: state.owner });
      state.legacyHttpToolPlatform = await harness.get("/api/tool-platform/grants", { auth: state.owner });
      state.legacyHttpAgentTools = await harness.get("/api/agent-tools/catalog", { auth: state.owner });
    },
    assert({ state }) {
      expectOk(state.httpHealth, "http health");
      expectOk(state.rpcHealth, "rpc health transport");
      assert.ok(state.rpcHealth.payload.result, "rpc health result");
      assert.equal(state.cliHealth.status, 0, "cli health");
      expectHttpRpcCliParity({
        httpPayload: state.httpHealth.payload,
        rpcPayload: state.rpcHealth.payload,
        cliPayload: state.cliHealth.payload,
        pick: (payload) => ({ ok: payload.ok, status: payload.status })
      });
      expectOk(state.httpInterfaces, "http interfaces");
      expectOk(state.rpcInterfaces, "rpc interfaces");
      assert.equal(state.cliInterfaces.status, 0, "cli interfaces");
      expectHttpRpcCliParity({
        httpPayload: state.httpInterfaces.payload,
        rpcPayload: state.rpcInterfaces.payload,
        cliPayload: state.cliInterfaces.payload,
        pick: (payload) => ({
          hasToolManagement: operationIds(payload).has("tool_management.catalog"),
          hasLegacyToolPlatform: [...operationIds(payload)].some((id) => id.startsWith("tool_platform.")),
          hasLegacyAgentTools: [...operationIds(payload)].some((id) => id.startsWith("agent_tools."))
        })
      });
      assert.ok(state.legacyRpcToolPlatform.payload.error);
      assert.ok(state.legacyRpcAgentTools.payload.error);
      expectStatus(state.legacyHttpToolPlatform, 404, "legacy tool-platform HTTP unavailable");
      expectStatus(state.legacyHttpAgentTools, 404, "legacy agent-tools HTTP unavailable");
    }
  })
];

const options = parseBusinessScenarioArgs(process.argv.slice(2));
if (options.help) {
  printBusinessScenarioHelp();
  process.exit(0);
}

const { exitCode } = await runScenarioSuite(scenarios, options);
process.exit(exitCode);
