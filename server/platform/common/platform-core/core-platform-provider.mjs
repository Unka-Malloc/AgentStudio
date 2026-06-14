import {
  dispatchInternalOperation as dispatchInternalOperationCore,
  dispatchRegisteredHttpOperation as dispatchRegisteredHttpOperationCore,
  dispatchRpcOperation as dispatchRpcOperationCore,
  findProxyRegisteredApiRequest as findProxyRegisteredApiRequestCore,
  shouldProxyRegisteredApiRequest as shouldProxyRegisteredApiRequestCore
} from "../operation-dispatcher/operation-dispatcher.mjs";
import {
  listInterfaceCatalog,
  SERVER_API_OPERATIONS
} from "../operation-dispatcher/operation-registry.mjs";
import { PROTOCOL_OPERATION_IDS } from "../operation-dispatcher/protocol-operation-definitions.mjs";

export const CORE_PLATFORM_PROTOCOL_VERSION = "v0.0.1:platform:core-1";

const CORE_VERIFICATION_COMMAND = "npm run server:verify:core-platform";
const FULL_VERIFICATION_COMMAND = "npm run server:verify";
const PROTOCOL_OPERATION_ID_SET = new Set(PROTOCOL_OPERATION_IDS);

function normalizeOperations(operations) {
  return Array.isArray(operations) && operations.length > 0
    ? operations
    : SERVER_API_OPERATIONS;
}

function hasText(value) {
  return String(value || "").trim().length > 0;
}

function verificationCommandsForOperation(operation = {}) {
  const commands = new Set([CORE_VERIFICATION_COMMAND]);
  const id = String(operation.id || "");
  const feature = String(operation.feature || "");
  const aspects = new Set(operation.aspects || []);

  if (PROTOCOL_OPERATION_ID_SET.has(id)) {
    commands.add("npm run server:verify:protocol-operations");
  }
  if (id.startsWith("system.") || id.startsWith("runtime.") || id.startsWith("events.")) {
    commands.add("npm run server:verify:dispatcher-unified");
  }
  if (id.startsWith("discovery.")) {
    commands.add("npm run server:verify:unified-registration");
  }
  if (feature === "tool_management" || aspects.has("tool-management")) {
    commands.add("npm run server:verify:tool-management");
  }
  if (feature === "strategy_management" || aspects.has("strategy-management")) {
    commands.add("npm run server:verify:strategy-management");
  }
  if (feature === "agent_workspace" || id.startsWith("workspace.")) {
    commands.add("npm run server:verify:agent-workspace");
  }
  if (feature === "knowledge" || id.startsWith("knowledge.")) {
    commands.add("npm run server:verify:knowledge");
  }
  if (feature === "storage" || id.startsWith("storage.")) {
    commands.add("npm run server:verify:ops");
  }
  commands.add(FULL_VERIFICATION_COMMAND);
  return [...commands];
}

function operationIsWired(operation = {}) {
  return Boolean(
    hasText(operation.id) &&
    hasText(operation.target?.controller) &&
    hasText(operation.target?.method) &&
    hasText(operation.http?.method) &&
    hasText(operation.http?.path) &&
    hasText(operation.rpc?.method)
  );
}

function operationIsImplemented(operation = {}, controllers = null) {
  if (!controllers || typeof controllers !== "object") {
    return null;
  }
  const controller = controllers[operation.target?.controller];
  return typeof controller?.[operation.target?.method] === "function";
}

function lifecycleState({ wired, implemented, verified }) {
  if (verified && wired && implemented !== false) {
    return "verified";
  }
  if (implemented) {
    return "implemented";
  }
  if (wired) {
    return "wired";
  }
  return "registered";
}

function summarizeLifecycle(entries) {
  const summary = {
    total: entries.length,
    registered: entries.filter((entry) => entry.registered).length,
    wired: entries.filter((entry) => entry.wired).length,
    implemented: entries.filter((entry) => entry.implemented === true).length,
    implementationUnknown: entries.filter((entry) => entry.implemented === null).length,
    verified: entries.filter((entry) => entry.verified).length
  };
  const missing = {
    registered: entries.filter((entry) => !entry.registered).map((entry) => entry.id),
    wired: entries.filter((entry) => !entry.wired).map((entry) => entry.id),
    implemented: entries
      .filter((entry) => entry.implemented === false)
      .map((entry) => entry.id),
    verified: entries.filter((entry) => !entry.verified).map((entry) => entry.id)
  };
  return {
    ...summary,
    ready:
      missing.registered.length === 0 &&
      missing.wired.length === 0 &&
      missing.implemented.length === 0 &&
      missing.verified.length === 0,
    missing
  };
}

export function createCorePlatformProvider({
  operations = SERVER_API_OPERATIONS,
  protocolEventBus = null,
  runtimeLogger = null,
  featureRuntime = null,
  operationConcurrencyScope = ""
} = {}) {
  const configuredOperations = normalizeOperations(operations);

  function effectiveOperations(input = {}) {
    return normalizeOperations(input.operations || configuredOperations);
  }

  function describeOperationRegistry(input = {}) {
    const selectedOperations = effectiveOperations(input);
    const controllers = input.controllers || null;
    const interfaces = listInterfaceCatalog(selectedOperations);
    const lifecycle = selectedOperations.map((operation) => {
      const verificationCommands = verificationCommandsForOperation(operation);
      const wired = operationIsWired(operation);
      const implemented = operationIsImplemented(operation, controllers);
      const verified = verificationCommands.length > 0;
      return {
        id: operation.id,
        feature: operation.feature || "",
        target: `${operation.target?.controller || ""}.${operation.target?.method || ""}`,
        registered: true,
        wired,
        implemented,
        verified,
        state: lifecycleState({ wired, implemented, verified }),
        verificationCommands
      };
    });

    return {
      protocolVersion: CORE_PLATFORM_PROTOCOL_VERSION,
      summary: summarizeLifecycle(lifecycle),
      lifecycle,
      interfaces
    };
  }

  function buildSystemInterfaces(input = {}) {
    const operationRegistry = describeOperationRegistry(input);
    return {
      protocolVersion: CORE_PLATFORM_PROTOCOL_VERSION,
      transport: {
        http: "direct",
        rpc: "POST /api/rpc",
        events: "GET /api/events"
      },
      interfaces: operationRegistry.interfaces,
      operationRegistry: {
        summary: operationRegistry.summary,
        lifecycle: operationRegistry.lifecycle
      },
      features: input.features || null
    };
  }

  function listCapabilities() {
    return {
      protocolVersion: CORE_PLATFORM_PROTOCOL_VERSION,
      capabilities: [
        {
          id: "operation-dispatch",
          kind: "dispatcher",
          operations: [
            "dispatchRegisteredHttpOperation",
            "dispatchRpcOperation",
            "dispatchInternalOperation",
            "shouldProxyRegisteredApiRequest"
          ]
        },
        {
          id: "operation-registry-governance",
          kind: "registry",
          operations: [
            "listInterfaceCatalog",
            "describeOperationRegistry",
            "buildSystemInterfaces"
          ]
        },
        {
          id: "runtime-core-ports",
          kind: "composition",
          operations: [
            "getProtocolEventBus",
            "getRuntimeLogger",
            "getFeatureRuntime",
            "getOperationConcurrencyScope"
          ]
        }
      ]
    };
  }

  return Object.freeze({
    protocolVersion: CORE_PLATFORM_PROTOCOL_VERSION,
    getProtocolEventBus: () => protocolEventBus,
    getRuntimeLogger: () => runtimeLogger,
    getFeatureRuntime: () => featureRuntime,
    getOperationConcurrencyScope: () => operationConcurrencyScope,
    listInterfaceCatalog: (input = {}) => listInterfaceCatalog(effectiveOperations(input)),
    describeOperationRegistry,
    buildSystemInterfaces,
    shouldProxyRegisteredApiRequest(input = {}) {
      return shouldProxyRegisteredApiRequestCore({
        ...input,
        operations: effectiveOperations(input)
      });
    },
    findProxyRegisteredApiRequest(input = {}) {
      return findProxyRegisteredApiRequestCore({
        ...input,
        operations: effectiveOperations(input)
      });
    },
    dispatchRegisteredHttpOperation(input = {}) {
      return dispatchRegisteredHttpOperationCore({
        ...input,
        operations: effectiveOperations(input)
      });
    },
    dispatchRpcOperation(input = {}) {
      return dispatchRpcOperationCore({
        ...input,
        operations: effectiveOperations(input)
      });
    },
    dispatchInternalOperation(input = {}) {
      return dispatchInternalOperationCore({
        ...input,
        operations: effectiveOperations(input)
      });
    },
    listCapabilities
  });
}
