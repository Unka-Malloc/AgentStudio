import { beforeEach, describe, expect, it, vi } from "vitest";

const sendJsonMock = vi.hoisted(() => vi.fn((response, status, payload) => {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(payload));
}));
const contentDispositionHeaderMock = vi.hoisted(() => vi.fn((disposition, fileName) => `${disposition}; filename="${fileName}"`));
const createSecurityPermissionsProviderMock = vi.hoisted(() => vi.fn(({ consoleAuth }) => ({ securityFromAuth: consoleAuth })));
const executeConsoleDomainOperationMock = vi.hoisted(() => vi.fn());
const resumeKnowledgeWordCloudTasksMock = vi.hoisted(() => vi.fn(async () => undefined));
const contextHelpers = vi.hoisted(() => ({
  knowledgeDomainContext: vi.fn((authSession) => ({ kind: "knowledge-domain", authSession })),
  knowledgeWorkflowContext: vi.fn((authSession) => ({ kind: "knowledge-workflow", authSession })),
  settingsAgentGatewayContext: vi.fn((authSession, extra = {}) => ({ kind: "agent-settings", authSession, ...extra })),
  authorizationFacadeContext: vi.fn((authSession, extra = {}) => ({ kind: "authorization", authSession, ...extra })),
  accessControlContext: vi.fn((authSession, extra = {}) => ({ kind: "access-control", authSession, ...extra })),
  appendConsoleOperationLog: vi.fn(),
  isFeatureActive: vi.fn((featureId) => featureId !== "off")
}));
const createSystemControllerContextsMock = vi.hoisted(() => vi.fn(() => ({
  executeConsoleDomainOperation: executeConsoleDomainOperationMock,
  ...contextHelpers,
  resumeKnowledgeWordCloudTasks: resumeKnowledgeWordCloudTasksMock
})));
const factoryCalls = vi.hoisted(() => ({}));
const factoryMocks = vi.hoisted(() => ({
  auth: vi.fn((args) => {
    factoryCalls.auth = args;
    return {
      async handleJsonEcho({ requestBody, response }) {
        await args.sendConsoleDomainOperation({
          operationId: "json.echo",
          input: args.parseJsonBody(requestBody),
          response,
          context: { fromHandler: "auth" }
        });
      },
      async handleOperationError({ response }) {
        await args.sendConsoleDomainOperation({
          operationId: "operation.error",
          response,
          errorMessage: "fallback error"
        });
      }
    };
  }),
  foundation: vi.fn((args) => {
    factoryCalls.foundation = args;
    return {
      async handleBinaryDownload({ response }) {
        await args.sendConsoleDomainOperation({
          operationId: "binary.download",
          response
        });
      },
      async handleProtocolAndWorkspace({ requestBody, url, response }) {
        const payload = args.protocolPayload(requestBody, url);
        await args.sendConsoleDomainOperation({
          operationId: "protocol.workspace",
          input: {
            ...payload,
            workspaceId: args.workspaceIdFrom(payload, "fallback-workspace")
          },
          response,
          context: args.accessControlContext({ id: "auth" }, { resource: "workspace" })
        });
      }
    };
  }),
  runtime: vi.fn((args) => {
    factoryCalls.runtime = args;
    return {
      async handleHtml({ response }) {
        await args.sendConsoleDomainOperation({
          operationId: "html.page",
          response
        });
      },
      async handleQueryPayload({ url, response }) {
        await args.sendConsoleDomainOperation({
          operationId: "query.payload",
          input: args.queryPayload(url),
          response,
          context: {
            featureOn: args.isFeatureActive("on"),
            featureOff: args.isFeatureActive("off")
          }
        });
      }
    };
  }),
  agentSettings: vi.fn((args) => {
    factoryCalls.agentSettings = args;
    return {
      async handleHeaders({ response }) {
        await args.sendConsoleDomainOperation({
          operationId: "headers.payload",
          response,
          context: args.settingsAgentGatewayContext({ id: "agent" }, { requestId: "req-1" })
        });
      }
    };
  }),
  workspaceProtocol: vi.fn((args) => {
    factoryCalls.workspaceProtocol = args;
    return {
      async handleResponseHandled({ response }) {
        await args.sendConsoleDomainOperation({
          operationId: "response.handled",
          response
        });
      }
    };
  }),
  capability: vi.fn((args) => {
    factoryCalls.capability = args;
    return { capabilityHandler: vi.fn(() => args.getStrategyManagementProvider()) };
  }),
  externalService: vi.fn((args) => {
    factoryCalls.externalService = args;
    return { externalServiceHandler: vi.fn(() => args.getToolManagementPlatform()) };
  }),
  knowledgeOperations: vi.fn((args) => {
    factoryCalls.knowledgeOperations = args;
    return { knowledgeOperationHandler: vi.fn(() => args.knowledgeWorkflowContext({ id: "knowledge" })) };
  }),
  opsObservation: vi.fn((args) => {
    factoryCalls.opsObservation = args;
    return { opsObservationHandler: vi.fn(() => args.queueMonitor) };
  }),
  knowledgeRuntime: vi.fn((args) => {
    factoryCalls.knowledgeRuntime = args;
    return { knowledgeRuntimeHandler: vi.fn(() => args.knowledgeDomainContext({ id: "runtime" })) };
  }),
  workspaceRuntime: vi.fn((args) => {
    factoryCalls.workspaceRuntime = args;
    return { workspaceRuntimeHandler: vi.fn(() => args.clientRuntimeBootstrap) };
  })
}));

vi.mock("../../../server/platform/common/console/http/http-utils.mjs", () => ({
  contentDispositionHeader: contentDispositionHeaderMock,
  sendJson: sendJsonMock
}));

vi.mock("../../../server/platform/common/security/security-permissions-provider.mjs", () => ({
  createSecurityPermissionsProvider: createSecurityPermissionsProviderMock
}));

vi.mock("../../../server/platform/common/console/http/controllers/system-controller-contexts.mjs", () => ({
  createSystemControllerContexts: createSystemControllerContextsMock
}));

vi.mock("../../../server/platform/common/console/http/controllers/system-controller-auth-handlers.mjs", () => ({
  createSystemControllerAuthHandlers: factoryMocks.auth
}));
vi.mock("../../../server/platform/common/console/http/controllers/system-controller-foundation-handlers.mjs", () => ({
  createSystemControllerFoundationHandlers: factoryMocks.foundation
}));
vi.mock("../../../server/platform/common/console/http/controllers/system-controller-runtime-handlers.mjs", () => ({
  createSystemControllerRuntimeHandlers: factoryMocks.runtime
}));
vi.mock("../../../server/platform/common/console/http/controllers/system-controller-agent-settings-handlers.mjs", () => ({
  createSystemControllerAgentSettingsHandlers: factoryMocks.agentSettings
}));
vi.mock("../../../server/platform/common/console/http/controllers/system-controller-workspace-protocol-handlers.mjs", () => ({
  createSystemControllerWorkspaceProtocolHandlers: factoryMocks.workspaceProtocol
}));
vi.mock("../../../server/platform/common/console/http/controllers/system-controller-capability-ecosystem-handlers.mjs", () => ({
  createSystemControllerCapabilityEcosystemHandlers: factoryMocks.capability
}));
vi.mock("../../../server/platform/common/console/http/controllers/system-controller-external-service-handlers.mjs", () => ({
  createSystemControllerExternalServiceHandlers: factoryMocks.externalService
}));
vi.mock("../../../server/platform/common/console/http/controllers/system-controller-knowledge-operations-handlers.mjs", () => ({
  createSystemControllerKnowledgeOperationsHandlers: factoryMocks.knowledgeOperations
}));
vi.mock("../../../server/platform/common/console/http/controllers/system-controller-ops-observation-handlers.mjs", () => ({
  createSystemControllerOpsObservationHandlers: factoryMocks.opsObservation
}));
vi.mock("../../../server/platform/common/console/http/controllers/system-controller-knowledge-runtime-handlers.mjs", () => ({
  createSystemControllerKnowledgeRuntimeHandlers: factoryMocks.knowledgeRuntime
}));
vi.mock("../../../server/platform/common/console/http/controllers/system-controller-workspace-runtime-handlers.mjs", () => ({
  createSystemControllerWorkspaceRuntimeHandlers: factoryMocks.workspaceRuntime
}));

import { createSystemController } from "../../../server/platform/common/console/http/controllers/system-controller.mjs";

function createResponse() {
  return {
    writeHead: vi.fn(),
    end: vi.fn()
  };
}

function createController(overrides = {}) {
  return createSystemController({
    userDataPath: "/unit-data",
    distPath: "/dist",
    runtime: { name: "runtime" },
    moduleManagement: { name: "module-management" },
    jobWorkflowProvider: { name: "jobs" },
    metadataStore: { name: "metadata" },
    storageProvider: { name: "storage" },
    serverLabel: "Unit Server",
    getDiscoveryState: vi.fn(() => ({ discovered: true })),
    setDiscoveryState: vi.fn(),
    getListenUrl: vi.fn(() => "http://127.0.0.1:0"),
    coreProvider: { name: "core" },
    getControllers: vi.fn(() => ({})),
    protocolEventBus: { name: "events" },
    consoleAuth: { name: "console-auth" },
    operationAuditStore: { name: "audit" },
    maintenanceAgent: { name: "maintenance" },
    knowledgeSourceService: { name: "knowledge-source" },
    agentWorkspace: { name: "workspace" },
    contextRuntime: { name: "context-runtime" },
    clientRuntimeAllocator: { name: "client-runtime" },
    clientRuntimeBootstrap: { name: "bootstrap" },
    checkpointTreeApi: { name: "checkpoint" },
    queueMonitor: { name: "queue" },
    devopsProvider: { name: "devops" },
    getFeatureEntries: vi.fn(() => ({ activeFeatureIds: ["on"] })),
    getToolSkillManagementProvider: vi.fn(() => ({ name: "tool-skill" })),
    getToolManagementPlatform: vi.fn(() => ({ name: "tool-platform" })),
    consoleDomainServices: { name: "domain-services" },
    strategyManagementProvider: { name: "strategy" },
    ...overrides
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(factoryCalls)) {
    delete factoryCalls[key];
  }
  executeConsoleDomainOperationMock.mockImplementation(async ({ operationId, input }) => ({
    status: 200,
    payload: { ok: true, operationId, input }
  }));
});

describe("system controller aggregate", () => {
  it("creates effective security permissions, contexts, and aggregates all handler groups", () => {
    const controller = createController();

    expect(createSecurityPermissionsProviderMock).toHaveBeenCalledWith({ consoleAuth: { name: "console-auth" } });
    expect(createSystemControllerContextsMock).toHaveBeenCalledWith(expect.objectContaining({
      userDataPath: "/unit-data",
      runtime: { name: "runtime" },
      securityPermissions: { securityFromAuth: { name: "console-auth" } },
      consoleDomainServices: { name: "domain-services" }
    }));
    expect(controller).toEqual(expect.objectContaining({
      handleJsonEcho: expect.any(Function),
      handleBinaryDownload: expect.any(Function),
      handleHtml: expect.any(Function),
      handleHeaders: expect.any(Function),
      handleResponseHandled: expect.any(Function),
      capabilityHandler: expect.any(Function),
      externalServiceHandler: expect.any(Function),
      knowledgeOperationHandler: expect.any(Function),
      opsObservationHandler: expect.any(Function),
      knowledgeRuntimeHandler: expect.any(Function),
      workspaceRuntimeHandler: expect.any(Function)
    }));
    expect(factoryMocks.auth).toHaveBeenCalledWith(expect.objectContaining({
      securityPermissions: { securityFromAuth: { name: "console-auth" } },
      appendConsoleOperationLog: contextHelpers.appendConsoleOperationLog
    }));
    expect(factoryCalls.workspaceRuntime.clientRuntimeBootstrap).toEqual({ name: "bootstrap" });
  });

  it("sends JSON, protocol/query payloads, and headers through sendConsoleDomainOperation helpers", async () => {
    const controller = createController();
    const response = createResponse();
    const queryUrl = new URL("http://example.test/console?tag=a&tag=b&workspace=workspace-query");

    await controller.handleJsonEcho({
      requestBody: Buffer.from(JSON.stringify({ alpha: 1 }), "utf8"),
      response
    });
    await controller.handleProtocolAndWorkspace({
      requestBody: Buffer.alloc(0),
      url: queryUrl,
      response
    });
    await controller.handleQueryPayload({
      url: queryUrl,
      response
    });
    await controller.handleHeaders({ response });

    expect(executeConsoleDomainOperationMock).toHaveBeenNthCalledWith(1, {
      operationId: "json.echo",
      input: { alpha: 1 },
      context: {
        userDataPath: "/unit-data",
        fromHandler: "auth"
      }
    });
    expect(executeConsoleDomainOperationMock).toHaveBeenNthCalledWith(2, {
      operationId: "protocol.workspace",
      input: {
        tag: "b",
        workspace: "workspace-query",
        workspaceId: "workspace-query"
      },
      context: {
        userDataPath: "/unit-data",
        kind: "access-control",
        authSession: { id: "auth" },
        resource: "workspace"
      }
    });
    expect(executeConsoleDomainOperationMock).toHaveBeenNthCalledWith(3, {
      operationId: "query.payload",
      input: {
        tag: ["a", "b"],
        workspace: "workspace-query"
      },
      context: {
        userDataPath: "/unit-data",
        featureOn: true,
        featureOff: false
      }
    });
    expect(executeConsoleDomainOperationMock).toHaveBeenNthCalledWith(4, {
      operationId: "headers.payload",
      input: {},
      context: {
        userDataPath: "/unit-data",
        kind: "agent-settings",
        authSession: { id: "agent" },
        requestId: "req-1"
      }
    });
    expect(sendJsonMock).toHaveBeenCalledTimes(4);
  });

  it("handles binary, html, custom header, already-handled, and error operation results", async () => {
    const controller = createController();
    executeConsoleDomainOperationMock.mockImplementation(async ({ operationId }) => {
      if (operationId === "binary.download") {
        return {
          status: 206,
          payload: {
            __binaryResponse: true,
            disposition: "attachment",
            fileName: "report.txt",
            contentType: "text/plain",
            buffer: Buffer.from("hello"),
            headers: { "X-Unit": "binary" }
          }
        };
      }
      if (operationId === "html.page") {
        return {
          status: 201,
          payload: {
            __htmlResponse: true,
            contentType: "text/html",
            body: "<h1>ok</h1>",
            headers: { "X-Unit": "html" }
          }
        };
      }
      if (operationId === "headers.payload") {
        return {
          status: 202,
          payload: {
            ok: true,
            value: 1,
            __headers: { "X-Unit": "json" }
          }
        };
      }
      if (operationId === "response.handled") {
        return {
          status: 200,
          payload: { __responseHandled: true }
        };
      }
      if (operationId === "operation.error") {
        throw new Error("domain exploded");
      }
      return { status: 200, payload: { ok: true } };
    });

    const binaryResponse = createResponse();
    await controller.handleBinaryDownload({ response: binaryResponse });
    expect(contentDispositionHeaderMock).toHaveBeenCalledWith("attachment", "report.txt");
    expect(binaryResponse.writeHead).toHaveBeenCalledWith(206, {
      "Content-Type": "text/plain",
      "Content-Disposition": "attachment; filename=\"report.txt\"",
      "Content-Length": "5",
      "Cache-Control": "no-store",
      "X-Unit": "binary"
    });
    expect(binaryResponse.end).toHaveBeenCalledWith(Buffer.from("hello"));

    const htmlResponse = createResponse();
    await controller.handleHtml({ response: htmlResponse });
    expect(htmlResponse.writeHead).toHaveBeenCalledWith(201, {
      "Content-Type": "text/html",
      "Cache-Control": "no-store",
      "X-Unit": "html"
    });
    expect(htmlResponse.end).toHaveBeenCalledWith("<h1>ok</h1>");

    const headerResponse = createResponse();
    await controller.handleHeaders({ response: headerResponse });
    expect(headerResponse.writeHead).toHaveBeenCalledWith(202, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Unit": "json"
    });
    expect(headerResponse.end).toHaveBeenCalledWith(JSON.stringify({ ok: true, value: 1 }));

    const handledResponse = createResponse();
    await controller.handleResponseHandled({ response: handledResponse });
    expect(handledResponse.writeHead).not.toHaveBeenCalled();
    expect(handledResponse.end).not.toHaveBeenCalled();

    const errorResponse = createResponse();
    await controller.handleOperationError({ response: errorResponse });
    expect(sendJsonMock).toHaveBeenLastCalledWith(errorResponse, 400, {
      ok: false,
      operationId: "operation.error",
      error: "domain exploded"
    });
  });

  it("uses provided security permissions instead of creating them from console auth", () => {
    const securityPermissions = { explicit: true };
    createController({ securityPermissions });

    expect(createSecurityPermissionsProviderMock).not.toHaveBeenCalled();
    expect(createSystemControllerContextsMock).toHaveBeenCalledWith(expect.objectContaining({
      securityPermissions
    }));
    expect(factoryCalls.auth.securityPermissions).toBe(securityPermissions);
  });
});
