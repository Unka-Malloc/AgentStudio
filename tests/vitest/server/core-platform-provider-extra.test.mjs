import { beforeEach, describe, expect, it, vi } from "vitest";

const dispatcherMocks = vi.hoisted(() => ({
  dispatchInternalOperation: vi.fn((input) => ({ kind: "internal", input })),
  dispatchRegisteredHttpOperation: vi.fn((input) => ({ kind: "http", input })),
  dispatchRpcOperation: vi.fn((input) => ({ kind: "rpc", input })),
  shouldProxyRegisteredApiRequest: vi.fn((input) => ({ kind: "proxy", input }))
}));
const operationRegistryMocks = vi.hoisted(() => ({
  SERVER_API_OPERATIONS: [
    {
      id: "system.health",
      feature: "system",
      target: { controller: "system", method: "handleHealth" },
      http: { method: "GET", path: "/api/system/health" },
      rpc: { method: "system.health" }
    }
  ],
  listInterfaceCatalog: vi.fn((operations) => ({
    operationIds: operations.map((operation) => operation.id)
  }))
}));
const protocolOperationIdsMock = vi.hoisted(() => ["system.health", "knowledge.search"]);

vi.mock("../../../server/platform/common/operation-dispatcher/operation-dispatcher.mjs", () => dispatcherMocks);
vi.mock("../../../server/platform/common/operation-dispatcher/operation-registry.mjs", () => operationRegistryMocks);
vi.mock("../../../server/platform/common/operation-dispatcher/protocol-operation-definitions.mjs", () => ({
  PROTOCOL_OPERATION_IDS: protocolOperationIdsMock
}));

import {
  CORE_PLATFORM_PROTOCOL_VERSION,
  createCorePlatformProvider
} from "../../../server/platform/common/platform-core/core-platform-provider.mjs";

beforeEach(() => {
  vi.clearAllMocks();
});

function createOperations() {
  return [
    {
      id: "system.health",
      feature: "system",
      target: { controller: "system", method: "handleHealth" },
      http: { method: "GET", path: "/api/system/health" },
      rpc: { method: "system.health" }
    },
    {
      id: "knowledge.search",
      feature: "knowledge",
      aspects: ["tool-management"],
      target: { controller: "knowledge", method: "handleSearch" },
      http: { method: "POST", path: "/api/knowledge/search" },
      rpc: { method: "knowledge.search" }
    },
    {
      id: "storage.summary",
      feature: "storage",
      target: { controller: "storage", method: "" },
      http: { method: "GET", path: "/api/storage" },
      rpc: { method: "storage.summary" }
    },
    {
      id: "discovery.scan",
      feature: "discovery",
      target: { controller: "system", method: "handleDiscovery" },
      http: { method: "POST", path: "/api/discovery" },
      rpc: { method: "discovery.scan" }
    }
  ];
}

describe("core platform provider", () => {
  it("describes lifecycle state, interfaces, and capabilities", () => {
    const provider = createCorePlatformProvider({
      operations: createOperations(),
      protocolEventBus: { name: "events" },
      runtimeLogger: { name: "logger" },
      featureRuntime: { name: "features" },
      operationConcurrencyScope: "core"
    });

    expect(Object.isFrozen(provider)).toBe(true);
    expect(provider.protocolVersion).toBe(CORE_PLATFORM_PROTOCOL_VERSION);
    expect(provider.getProtocolEventBus()).toEqual({ name: "events" });
    expect(provider.getRuntimeLogger()).toEqual({ name: "logger" });
    expect(provider.getFeatureRuntime()).toEqual({ name: "features" });
    expect(provider.getOperationConcurrencyScope()).toBe("core");

    const registry = provider.describeOperationRegistry({
      controllers: {
        system: {
          handleHealth: vi.fn(),
          handleDiscovery: vi.fn()
        },
        knowledge: {}
      }
    });

    expect(operationRegistryMocks.listInterfaceCatalog).toHaveBeenCalledWith(createOperations());
    expect(registry).toMatchObject({
      protocolVersion: CORE_PLATFORM_PROTOCOL_VERSION,
      summary: {
        total: 4,
        registered: 4,
        wired: 3,
        implemented: 2,
        implementationUnknown: 0,
        verified: 4,
        ready: false,
        missing: {
          registered: [],
          wired: ["storage.summary"],
          implemented: ["knowledge.search", "storage.summary"],
          verified: []
        }
      },
      interfaces: {
        operationIds: ["system.health", "knowledge.search", "storage.summary", "discovery.scan"]
      }
    });
    expect(registry.lifecycle.find((entry) => entry.id === "system.health")).toMatchObject({
      target: "system.handleHealth",
      wired: true,
      implemented: true,
      state: "verified",
      verificationCommands: expect.arrayContaining([
        "npm run server:verify:core-platform",
        "npm run server:verify:protocol-operations",
        "npm run server:verify:dispatcher-unified",
        "npm run server:verify"
      ])
    });
    expect(registry.lifecycle.find((entry) => entry.id === "knowledge.search")).toMatchObject({
      state: "wired",
      verificationCommands: expect.arrayContaining([
        "npm run server:verify:knowledge",
        "npm run server:verify:tool-management"
      ])
    });
    expect(registry.lifecycle.find((entry) => entry.id === "discovery.scan")).toMatchObject({
      state: "verified",
      verificationCommands: expect.arrayContaining(["npm run server:verify:unified-registration"])
    });

    expect(provider.buildSystemInterfaces({ features: { active: ["a"] } })).toMatchObject({
      protocolVersion: CORE_PLATFORM_PROTOCOL_VERSION,
      transport: {
        http: "direct",
        rpc: "POST /api/rpc",
        events: "GET /api/events"
      },
      operationRegistry: {
        summary: expect.any(Object),
        lifecycle: expect.any(Array)
      },
      features: { active: ["a"] }
    });
    expect(provider.listCapabilities()).toMatchObject({
      protocolVersion: CORE_PLATFORM_PROTOCOL_VERSION,
      capabilities: expect.arrayContaining([
        expect.objectContaining({ id: "operation-dispatch" }),
        expect.objectContaining({ id: "operation-registry-governance" }),
        expect.objectContaining({ id: "runtime-core-ports" })
      ])
    });
  });

  it("uses defaults and forwards effective operations to dispatcher helpers", () => {
    const provider = createCorePlatformProvider({ operations: [] });
    const overrideOperations = [{
      id: "runtime.ping",
      target: { controller: "system", method: "handlePing" },
      http: { method: "GET", path: "/api/runtime/ping" },
      rpc: { method: "runtime.ping" }
    }];

    expect(provider.listInterfaceCatalog()).toEqual({ operationIds: ["system.health"] });
    expect(provider.shouldProxyRegisteredApiRequest({ url: "/api/runtime/ping", operations: overrideOperations })).toEqual({
      kind: "proxy",
      input: {
        url: "/api/runtime/ping",
        operations: overrideOperations
      }
    });
    expect(provider.dispatchRegisteredHttpOperation({ method: "GET", operations: overrideOperations })).toEqual({
      kind: "http",
      input: {
        method: "GET",
        operations: overrideOperations
      }
    });
    expect(provider.dispatchRpcOperation({ rpc: "runtime.ping", operations: overrideOperations })).toEqual({
      kind: "rpc",
      input: {
        rpc: "runtime.ping",
        operations: overrideOperations
      }
    });
    expect(provider.dispatchInternalOperation({ operationId: "runtime.ping", operations: overrideOperations })).toEqual({
      kind: "internal",
      input: {
        operationId: "runtime.ping",
        operations: overrideOperations
      }
    });
  });

  it("marks implementation as unknown when no controller map is supplied", () => {
    const provider = createCorePlatformProvider({ operations: createOperations().slice(0, 1) });
    const registry = provider.describeOperationRegistry();

    expect(registry.summary).toMatchObject({
      implementationUnknown: 1,
      implemented: 0
    });
    expect(registry.lifecycle[0]).toMatchObject({
      implemented: null,
      state: "verified"
    });
  });
});
