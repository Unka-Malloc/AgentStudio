import { describe, expect, it, vi } from "vitest";
import { createSystemControllerKnowledgeOperationsHandlers } from "../../../server/platform/common/console/http/controllers/system-controller-knowledge-operations-handlers.mjs";
import { createSystemControllerRuntimeHandlers } from "../../../server/platform/common/console/http/controllers/system-controller-runtime-handlers.mjs";

function body(value) {
  return Buffer.from(JSON.stringify(value), "utf8");
}

function parseBody(requestBody) {
  return JSON.parse(Buffer.from(requestBody || Buffer.alloc(0)).toString("utf8") || "{}");
}

function idsFrom(mock) {
  return mock.mock.calls.map((call) => call[0].operationId);
}

function callById(mock, operationId) {
  return mock.mock.calls.map((call) => call[0]).find((call) => call.operationId === operationId);
}

describe("system controller runtime and knowledge operations final coverage", () => {
  it("routes every knowledge operation handler through the console domain executor", async () => {
    const sendConsoleDomainOperation = vi.fn(async () => undefined);
    const parseJsonBody = vi.fn(parseBody);
    const queryPayload = vi.fn((url) => Object.fromEntries(url.searchParams.entries()));
    const knowledgeWorkflowContext = vi.fn((authSession) => ({ scope: "knowledge", authSession }));
    const storageProvider = { id: "storage" };
    const handlers = createSystemControllerKnowledgeOperationsHandlers({
      sendConsoleDomainOperation,
      parseJsonBody,
      queryPayload,
      knowledgeWorkflowContext,
      storageProvider
    });
    const common = {
      requestBody: body({ label: "unit", wordBagId: "body-bag" }),
      url: new URL("http://localhost/api?limit=5&format=short"),
      response: { id: "response" },
      authSession: { userId: "owner" },
      wordBagId: "route-bag"
    };

    for (const handler of Object.values(handlers)) {
      await handler(common);
    }
    await handlers.handleKnowledgeWordClouds({ ...common, requestBody: Buffer.alloc(0) });
    await handlers.handleGetKnowledgeWordBagTerms({ ...common, requestBody: Buffer.alloc(0) });
    await handlers.handleExportKnowledgeWordClouds({ ...common, requestBody: Buffer.alloc(0) });
    await handlers.handleDeleteKnowledgeWordBag({
      ...common,
      requestBody: Buffer.alloc(0),
      url: new URL("http://localhost/api?confirm=true")
    });

    expect(idsFrom(sendConsoleDomainOperation)).toEqual(
      expect.arrayContaining([
        "email_rules.get",
        "email_rules.set",
        "expert_vocabulary.get",
        "expert_vocabulary.set",
        "expert_vocabulary.versions",
        "knowledge_taxonomy.get",
        "knowledge_taxonomy.set",
        "knowledge_taxonomy.versions",
        "storage.summary",
        "storage.source_vocabulary.rebuild",
        "knowledge.corpus.significant_terms",
        "knowledge.document_parse",
        "knowledge.word_clouds.get",
        "knowledge.word_bags.terms",
        "knowledge.word_clouds.save",
        "knowledge.word_clouds.export",
        "knowledge.word_clouds.import",
        "knowledge.word_bags.add",
        "knowledge.word_bags.update",
        "knowledge.word_bags.delete",
        "knowledge.word_clouds.propose",
        "storage.doctor",
        "storage.reconcile",
        "storage.backups.list",
        "storage.backups.create",
        "storage.backups.restore_preview",
        "storage.backups.restore",
        "knowledge.affair_taxonomy"
      ])
    );
    expect(callById(sendConsoleDomainOperation, "knowledge.word_bags.update")).toMatchObject({
      input: { label: "unit", wordBagId: "body-bag" },
      context: { scope: "knowledge", authSession: common.authSession }
    });
    expect(callById(sendConsoleDomainOperation, "knowledge.word_bags.delete")).toMatchObject({
      input: { label: "unit", wordBagId: "body-bag" }
    });
    expect(sendConsoleDomainOperation.mock.calls.at(-1)[0]).toMatchObject({
      operationId: "knowledge.word_bags.delete",
      input: { confirm: "true", wordBagId: "route-bag" }
    });
    expect(callById(sendConsoleDomainOperation, "storage.summary")).toMatchObject({
      context: { storageProvider }
    });
    expect(parseJsonBody).toHaveBeenCalled();
    expect(queryPayload).toHaveBeenCalledWith(common.url);
    expect(knowledgeWorkflowContext).toHaveBeenCalledWith(common.authSession);
  });

  it("routes every runtime handler and covers empty body/default provider branches", async () => {
    const sendConsoleDomainOperation = vi.fn(async () => undefined);
    const parseJsonBody = vi.fn(parseBody);
    const queryPayload = vi.fn((url) => Object.fromEntries(url.searchParams.entries()));
    const protocolEventBus = { id: "bus" };
    const storageProvider = { id: "storage" };
    const securityPermissions = { id: "security" };
    const maintenanceAgent = { id: "maintenance" };
    const moduleManagement = { id: "modules" };
    const runtime = { id: "runtime" };
    const jobWorkflowProvider = { id: "jobs" };
    const clientRuntimeAllocator = { id: "client-runtime" };
    const consoleDomainServices = { id: "domain" };
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
      runtime,
      moduleManagement,
      jobWorkflowProvider,
      storageProvider,
      securityPermissions,
      maintenanceAgent,
      clientRuntimeAllocator,
      consoleDomainServices
    });
    const common = {
      request: { id: "request" },
      requestBody: body({ enabled: true }),
      url: new URL("http://localhost/api?limit=9&topic=events"),
      response: { id: "response" },
      authSession: { userId: "owner" },
      clientId: "client-1",
      runId: "run-1"
    };

    for (const handler of Object.values(handlers)) {
      await handler(common);
    }
    await handlers.handleAgentSyncConfig({ ...common, requestBody: Buffer.alloc(0) });
    await handlers.handleMaintenanceAgentConfig({ ...common, requestBody: Buffer.alloc(0) });
    await handlers.handleMaintenanceAgentRuns({ ...common, requestBody: Buffer.alloc(0) });

    expect(idsFrom(sendConsoleDomainOperation)).toEqual(
      expect.arrayContaining([
        "system.bootstrap",
        "system.health",
        "system.interfaces",
        "v001.baseline.status",
        "events.subscribe",
        "agent_sync.config.set",
        "agent_sync.publish",
        "agent_sync.subscribe",
        "discovery.check_in",
        "discovery.clients",
        "discovery.clients.migration",
        "discovery.get_config",
        "discovery.set_config",
        "runtime.info",
        "runtime.path_browse",
        "runtime.mounts",
        "runtime.set_mounts",
        "runtime.reload_mounts",
        "runtime.dependencies.list",
        "runtime.dependencies.download",
        "runtime.dependencies.configure",
        "system.console_state",
        "maintenance_agent.config.set",
        "maintenance_agent.chat",
        "maintenance_agent.runs.create",
        "maintenance_agent.runs.get",
        "maintenance_agent.runs.approve",
        "maintenance_agent.runs.cancel",
        "agent_sync.config.get",
        "maintenance_agent.config.get",
        "maintenance_agent.runs.list"
      ])
    );
    expect(callById(sendConsoleDomainOperation, "discovery.clients")).toMatchObject({
      context: {
        storageProvider,
        discoveryState: { serverId: "srv" },
        toolSkillManagementProvider: null,
        consoleDomainServices
      }
    });
    expect(callById(sendConsoleDomainOperation, "runtime.info")).toMatchObject({
      context: {
        runtime,
        moduleManagement,
        storageProvider,
        serverUrl: "http://localhost:7228",
        securityPermissions,
        request: common.request,
        features: [{ id: "feature" }],
        consoleDomainServices
      }
    });
    expect(callById(sendConsoleDomainOperation, "system.console_state")).toMatchObject({
      context: {
        jobWorkflowProvider,
        maintenanceAgent,
        clientRuntimeAllocator,
        toolSkillManagementProvider: null
      }
    });
    expect(sendConsoleDomainOperation.mock.calls.at(-1)[0]).toMatchObject({
      operationId: "maintenance_agent.runs.list",
      input: { limit: 9 },
      context: { maintenanceAgent, authSession: common.authSession }
    });
    expect(parseJsonBody).toHaveBeenCalled();
    expect(queryPayload).toHaveBeenCalledWith(common.url);
  });

  it("uses null feature entries when no feature entry provider is supplied", async () => {
    const sendConsoleDomainOperation = vi.fn(async () => undefined);
    const handlers = createSystemControllerRuntimeHandlers({
      sendConsoleDomainOperation,
      parseJsonBody: parseBody,
      queryPayload: () => ({}),
      isFeatureActive: () => false,
      knowledgeWorkflowContext: () => ({}),
      coreProvider: {},
      getControllers: () => [],
      protocolEventBus: {},
      getDiscoveryState: () => ({}),
      setDiscoveryState: () => undefined,
      getListenUrl: () => "http://localhost:7228",
      serverLabel: "Pact",
      distPath: "/dist",
      runtime: {},
      moduleManagement: {},
      jobWorkflowProvider: {},
      storageProvider: {},
      securityPermissions: {},
      maintenanceAgent: {},
      clientRuntimeAllocator: {},
      consoleDomainServices: {}
    });

    await handlers.handleGetRuntimeInfo({ request: {}, response: {} });
    await handlers.handleGetMounts({ request: {}, response: {} });
    await handlers.handleGetConsoleState({ request: {}, response: {} });

    expect(sendConsoleDomainOperation.mock.calls.map((call) => call[0].context.features)).toEqual([
      null,
      null,
      null
    ]);
  });
});
