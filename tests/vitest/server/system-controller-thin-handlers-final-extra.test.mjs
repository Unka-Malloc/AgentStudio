import { describe, expect, it, vi } from "vitest";

const sendJsonMock = vi.hoisted(() => vi.fn());
const externalServiceMocks = vi.hoisted(() => ({
  describeExternalServices: vi.fn(async ({ userDataPath }) => ({ ok: true, userDataPath })),
  refreshExternalServiceRuntime: vi.fn(async ({ userDataPath, serviceId }) => ({
    ok: true,
    userDataPath,
    serviceId,
    refreshedCount: serviceId ? 1 : 3,
  })),
  saveExternalServiceConfig: vi.fn(async ({ userDataPath, payload }) => ({
    ok: payload.ok !== false,
    userDataPath,
    payload,
  })),
  verifyExternalServiceConfigPayload: vi.fn(async ({ payload, requireKnownPaths }) => ({
    ok: true,
    payload,
    requireKnownPaths,
  })),
}));

vi.mock("../../../server/platform/common/console/http/http-utils.mjs", () => ({
  sendJson: sendJsonMock,
}));
vi.mock("../../../server/platform/common/composition-management/external-service-registry.mjs", () => externalServiceMocks);

import { createSystemControllerAuthHandlers } from "../../../server/platform/common/console/http/controllers/system-controller-auth-handlers.mjs";
import { createSystemControllerExternalServiceHandlers } from "../../../server/platform/common/console/http/controllers/system-controller-external-service-handlers.mjs";
import { createSystemControllerKnowledgeOperationsHandlers } from "../../../server/platform/common/console/http/controllers/system-controller-knowledge-operations-handlers.mjs";
import { createSystemControllerOpsObservationHandlers } from "../../../server/platform/common/console/http/controllers/system-controller-ops-observation-handlers.mjs";
import { createSystemControllerRuntimeHandlers } from "../../../server/platform/common/console/http/controllers/system-controller-runtime-handlers.mjs";

function body(value) {
  return Buffer.from(JSON.stringify(value));
}

function lastCall(mock) {
  return mock.mock.calls.at(-1)?.[0];
}

describe("system controller thin handlers final extra coverage", () => {
  it("routes auth handlers with default ids, parsed bodies, and query inputs", async () => {
    const sendConsoleDomainOperation = vi.fn();
    const parseJsonBody = vi.fn((requestBody) => JSON.parse(Buffer.from(requestBody).toString("utf8") || "{}"));
    const securityPermissions = { id: "security" };
    const operationAuditStore = { id: "audit" };
    const appendConsoleOperationLog = vi.fn();
    const handlers = createSystemControllerAuthHandlers({
      sendConsoleDomainOperation,
      parseJsonBody,
      securityPermissions,
      operationAuditStore,
      appendConsoleOperationLog,
    });
    const response = {};
    const request = { headers: {} };
    const authSession = { userId: "owner" };

    await handlers.handleAuthSession({ response, request });
    expect(lastCall(sendConsoleDomainOperation)).toMatchObject({
      operationId: "auth.session",
      context: { securityPermissions, request },
    });

    await handlers.handleAuthLogin({ request, requestBody: body({ username: "owner" }), response });
    expect(lastCall(sendConsoleDomainOperation)).toMatchObject({
      operationId: "auth.login",
      input: { username: "owner" },
      context: { securityPermissions, request, appendConsoleOperationLog },
    });

    await handlers.handleAuthUsers({ requestBody: Buffer.alloc(0), response });
    expect(lastCall(sendConsoleDomainOperation)).toMatchObject({
      operationId: "auth.users",
      input: {},
    });
    await handlers.handleAuthUsers({ requestBody: body({ username: "new" }), response });
    expect(lastCall(sendConsoleDomainOperation)).toMatchObject({
      operationId: "auth.users.create",
      input: { username: "new" },
    });

    await handlers.handleAuthUpdateUser({ userId: "user-1", requestBody: body({ roleId: "admin" }), authSession, response });
    expect(lastCall(sendConsoleDomainOperation)).toMatchObject({
      operationId: "auth.users.update",
      input: { roleId: "admin", userId: "user-1" },
      context: { securityPermissions, authSession },
    });

    const auditUrl = new URL("http://localhost/api/auth/audit?limit=7&operation-id=login&user-id=u&status=ok&trace-id=t&tenant-id=tenant&created-from=a&created-to=b");
    await handlers.handleAuthAudit({ url: auditUrl, response });
    expect(lastCall(sendConsoleDomainOperation)).toMatchObject({
      operationId: "auth.audit",
      input: {
        limit: 7,
        operationId: "login",
        userId: "u",
        status: "ok",
        traceId: "t",
        tenantId: "tenant",
        createdFrom: "a",
        createdTo: "b",
      },
      context: { securityPermissions, operationAuditStore },
    });

    await handlers.handleAuthRole({ roleId: "operator", response });
    expect(lastCall(sendConsoleDomainOperation)).toMatchObject({
      operationId: "auth.roles.get",
      input: { roleId: "operator" },
    });

    await handlers.handleAuthAuditPrune({ requestBody: body({ olderThanDays: 90 }), authSession, response });
    expect(lastCall(sendConsoleDomainOperation)).toMatchObject({
      operationId: "auth.audit.prune",
      input: { olderThanDays: 90 },
      context: { securityPermissions, operationAuditStore, authSession },
    });

    await handlers.handleAuthSessions({ response });
    expect(lastCall(sendConsoleDomainOperation)).toMatchObject({
      operationId: "auth.sessions",
      context: { securityPermissions },
    });

    await handlers.handleAuthRevokeSession({ sessionId: "session-1", authSession, response });
    expect(lastCall(sendConsoleDomainOperation)).toMatchObject({
      operationId: "auth.sessions.revoke",
      input: { sessionId: "session-1" },
      context: { securityPermissions, authSession },
    });
  });

  it("routes operations observation handlers through default ids", async () => {
    const sendConsoleDomainOperation = vi.fn();
    const parseJsonBody = vi.fn((requestBody) => JSON.parse(Buffer.from(requestBody).toString("utf8") || "{}"));
    const jobWorkflowProvider = { id: "jobs" };
    const checkpointTreeApi = { id: "checkpoint-tree" };
    const queueMonitor = { id: "queue" };
    const devopsProvider = { id: "devops" };
    const response = {};
    const handlers = createSystemControllerOpsObservationHandlers({
      sendConsoleDomainOperation,
      parseJsonBody,
      jobWorkflowProvider,
      checkpointTreeApi,
      queueMonitor,
      devopsProvider,
    });

    await handlers.handleFailedJobsReview({ limit: 5, response });
    expect(lastCall(sendConsoleDomainOperation)).toMatchObject({
      operationId: "jobs.failed_review",
      input: { limit: 5 },
      context: { jobWorkflowProvider },
    });

    await handlers.handleRecoverBackgroundSupervisor({ response });
    expect(lastCall(sendConsoleDomainOperation)).toMatchObject({
      operationId: "system.background_supervisor.recover",
      input: {},
      context: { devopsProvider, queueMonitor },
    });
  });

  it("routes knowledge operation handlers with body/query fallback and id injection", async () => {
    const sendConsoleDomainOperation = vi.fn();
    const parseJsonBody = vi.fn((requestBody) => JSON.parse(Buffer.from(requestBody).toString("utf8") || "{}"));
    const queryPayload = vi.fn((url) => Object.fromEntries(url.searchParams.entries()));
    const knowledgeWorkflowContext = vi.fn((authSession) => ({ authSession, runtime: "knowledge" }));
    const storageProvider = { id: "storage" };
    const handlers = createSystemControllerKnowledgeOperationsHandlers({
      sendConsoleDomainOperation,
      parseJsonBody,
      queryPayload,
      knowledgeWorkflowContext,
      storageProvider,
    });
    const response = {};
    const authSession = { userId: "owner" };

    await handlers.handleSetRules({ requestBody: body({ version: 2 }), response, authSession });
    expect(lastCall(sendConsoleDomainOperation)).toMatchObject({
      operationId: "email_rules.set",
      input: { version: 2 },
      context: { authSession, runtime: "knowledge" },
    });

    await handlers.handleKnowledgeWordClouds({
      requestBody: Buffer.alloc(0),
      url: new URL("http://localhost/api?limit=3"),
      response,
      authSession,
    });
    expect(lastCall(sendConsoleDomainOperation)).toMatchObject({
      operationId: "knowledge.word_clouds.get",
      input: { limit: "3" },
    });

    await handlers.handleUpdateKnowledgeWordBag({
      wordBagId: "route-bag",
      requestBody: body({ label: "Bag" }),
      response,
      authSession,
    });
    expect(lastCall(sendConsoleDomainOperation)).toMatchObject({
      operationId: "knowledge.word_bags.update",
      input: { label: "Bag", wordBagId: "route-bag" },
    });

    await handlers.handleDeleteKnowledgeWordBag({
      wordBagId: "route-delete",
      requestBody: Buffer.alloc(0),
      url: new URL("http://localhost/api?confirm=true"),
      response,
      authSession,
    });
    expect(lastCall(sendConsoleDomainOperation)).toMatchObject({
      operationId: "knowledge.word_bags.delete",
      input: { confirm: "true", wordBagId: "route-delete" },
    });

    await handlers.handleStorageDoctor({ response });
    expect(lastCall(sendConsoleDomainOperation)).toMatchObject({
      operationId: "storage.doctor",
      context: { storageProvider },
    });
  });

  it("routes runtime handlers with feature context, body branches, and URL limits", async () => {
    const sendConsoleDomainOperation = vi.fn();
    const parseJsonBody = vi.fn((requestBody) => JSON.parse(Buffer.from(requestBody).toString("utf8") || "{}"));
    const queryPayload = vi.fn((url) => Object.fromEntries(url.searchParams.entries()));
    const protocolEventBus = { id: "bus" };
    const storageProvider = { id: "storage" };
    const securityPermissions = { id: "security" };
    const maintenanceAgent = { id: "maintenance" };
    const moduleManagement = { id: "modules" };
    const consoleDomainServices = { id: "domain" };
    const toolSkillManagementProvider = { id: "tool-skill" };
    const handlers = createSystemControllerRuntimeHandlers({
      sendConsoleDomainOperation,
      parseJsonBody,
      queryPayload,
      isFeatureActive: vi.fn((feature) => feature === "agent-gateway"),
      knowledgeWorkflowContext: vi.fn(() => ({ workflow: "knowledge" })),
      coreProvider: { id: "core" },
      getControllers: vi.fn(() => ["controller"]),
      getFeatureEntries: vi.fn(() => [{ id: "feature" }]),
      protocolEventBus,
      getDiscoveryState: vi.fn(() => ({ serverId: "srv" })),
      setDiscoveryState: vi.fn(),
      getListenUrl: vi.fn(() => "http://localhost:7228"),
      serverLabel: "Pact",
      distPath: "/dist",
      runtime: { id: "runtime" },
      moduleManagement,
      jobWorkflowProvider: { id: "jobs" },
      storageProvider,
      securityPermissions,
      maintenanceAgent,
      clientRuntimeAllocator: { id: "client-runtime" },
      getToolSkillManagementProvider: () => toolSkillManagementProvider,
      consoleDomainServices,
    });
    const response = {};
    const request = {};
    const authSession = { userId: "owner" };

    await handlers.handleBootstrap({ response });
    expect(lastCall(sendConsoleDomainOperation)).toMatchObject({
      operationId: "system.bootstrap",
      context: { workflow: "knowledge", discoveryState: { serverId: "srv" } },
    });

    await handlers.handleSubscribeEvents({ request, url: new URL("http://localhost/events?topic=a"), response });
    expect(lastCall(sendConsoleDomainOperation)).toMatchObject({
      operationId: "events.subscribe",
      input: { topic: "a" },
      context: { protocolEventBus, request, response, agentSyncFeatureActive: true },
    });

    await handlers.handleAgentSyncConfig({ requestBody: Buffer.alloc(0), response });
    expect(lastCall(sendConsoleDomainOperation)).toMatchObject({
      operationId: "agent_sync.config.get",
      input: {},
    });
    await handlers.handleAgentSyncConfig({ requestBody: body({ enabled: true }), response });
    expect(lastCall(sendConsoleDomainOperation)).toMatchObject({
      operationId: "agent_sync.config.set",
      input: { enabled: true },
    });

    await handlers.handleRequestClientMigration({ clientId: "client-1", requestBody: body({ target: "gui" }), response, authSession });
    expect(lastCall(sendConsoleDomainOperation)).toMatchObject({
      operationId: "discovery.clients.migration",
      input: { target: "gui", clientId: "client-1" },
      context: { discoveryState: { serverId: "srv" }, storageProvider, protocolEventBus, authSession },
    });

    await handlers.handleGetRuntimeInfo({ request, response });
    expect(lastCall(sendConsoleDomainOperation)).toMatchObject({
      operationId: "runtime.info",
      context: {
        distPath: "/dist",
        moduleManagement,
        storageProvider,
        serverUrl: "http://localhost:7228",
        securityPermissions,
        request,
        features: [{ id: "feature" }],
        consoleDomainServices,
      },
    });

    await handlers.handleMaintenanceAgentRuns({
      requestBody: Buffer.alloc(0),
      url: new URL("http://localhost/api?limit=9"),
      authSession,
      response,
    });
    expect(lastCall(sendConsoleDomainOperation)).toMatchObject({
      operationId: "maintenance_agent.runs.list",
      input: { limit: 9 },
      context: { maintenanceAgent, authSession },
    });
    await handlers.handleMaintenanceAgentRuns({
      requestBody: body({ runbook: "weekly" }),
      url: new URL("http://localhost/api"),
      authSession,
      response,
    });
    expect(lastCall(sendConsoleDomainOperation)).toMatchObject({
      operationId: "maintenance_agent.runs.create",
      input: { runbook: "weekly" },
    });
  });

  it("handles external service responses, parse fallbacks, and tool catalog refresh", async () => {
    sendJsonMock.mockClear();
    const parseJsonBody = vi.fn((requestBody) => JSON.parse(Buffer.from(requestBody).toString("utf8") || "{}"));
    const refreshExternalServiceTools = vi.fn(() => ({ ok: true, toolCount: 2 }));
    const handlers = createSystemControllerExternalServiceHandlers({
      parseJsonBody,
      userDataPath: "/tmp/user-data",
      getToolManagementPlatform: () => ({ refreshExternalServiceTools }),
    });
    const response = {};

    await handlers.handleExternalServices({ response });
    expect(sendJsonMock).toHaveBeenLastCalledWith(response, 200, { ok: true, userDataPath: "/tmp/user-data" });

    await handlers.handleExternalServiceConfigSave({ requestBody: body({ ok: true, configText: "x" }), response });
    expect(sendJsonMock.mock.calls.at(-1)[1]).toBe(200);
    expect(sendJsonMock.mock.calls.at(-1)[2]).toMatchObject({
      ok: true,
      payload: { ok: true, configText: "x" },
      toolCatalogRefresh: { ok: true, toolCount: 2 },
    });

    await handlers.handleExternalServiceConfigSave({ requestBody: body({ ok: false }), response });
    expect(sendJsonMock.mock.calls.at(-1)[1]).toBe(400);
    expect(sendJsonMock.mock.calls.at(-1)[2].toolCatalogRefresh).toBeUndefined();

    await handlers.handleExternalServiceRuntimeRefresh({ requestBody: body({ serviceId: "svc-1" }), response });
    expect(externalServiceMocks.refreshExternalServiceRuntime).toHaveBeenLastCalledWith({
      userDataPath: "/tmp/user-data",
      serviceId: "svc-1",
    });
    expect(sendJsonMock.mock.calls.at(-1)[2]).toMatchObject({
      serviceId: "svc-1",
      toolCatalogRefresh: { ok: true, toolCount: 2 },
    });

    await handlers.handleExternalServiceConfigVerify({ requestBody: Buffer.alloc(0), response });
    expect(sendJsonMock).toHaveBeenLastCalledWith(response, 200, {
      ok: true,
      payload: {},
      requireKnownPaths: false,
    });
  });
});
