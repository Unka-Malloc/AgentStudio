import {
  TOOL_MANAGEMENT_SCOPES,
  TOOL_MANAGEMENT_TOOLSETS,
  TOOL_MANAGEMENT_PROFILES,
  createToolCatalogRegistry
} from "./catalog.mjs";
import { createToolManagementStore, getToolManagementDatabasePath } from "./store.mjs";
import { createToolPolicyEngine } from "./policy.mjs";
import { createToolExecutionRuntime } from "./runtime.mjs";
import { createToolManagementHttpRouter } from "./http.mjs";
import { getRuntimeLogger } from "../../../../interactive/product-api.mjs";
import { createSecurityPermissionsProvider } from "../../../../common/security/security-permissions-provider.mjs";
import { broadcastMcpToolListChanged } from "../../../../common/mcp/http-mcp-adapter.mjs";
import {
  createExternalMcpPassthroughRuntime
} from "../../../../common/composition-management/external-mcp-passthrough-runtime.mjs";

export {
  TOOL_MANAGEMENT_SCOPES,
  TOOL_MANAGEMENT_TOOLSETS,
  TOOL_MANAGEMENT_PROFILES,
  getToolManagementDatabasePath
};

export function createToolManagementPlatform({
  userDataPath,
  operations,
  controllers,
  operationAuditStore = null,
  operationConcurrencyScope = "tool-management",
  protocolEventBus = null,
  consoleAuth = null,
  securityPermissions = null,
  strategyManagementProvider = null,
  featureRuntime = null,
  changeHandlers = [],
  logger = getRuntimeLogger()
}) {
  const registeredChangeHandlers = new Set(
    (Array.isArray(changeHandlers) ? changeHandlers : [changeHandlers])
      .filter((handler) => typeof handler === "function")
  );

  function notifyMcpToolCatalogChanged(event = {}) {
    const reasonCode = String(event.reasonCode || event.type || "tool_management_changed");
    const publicEvent = {
      schemaVersion: 1,
      source: String(event.source || "tool-management-platform"),
      type: String(event.type || reasonCode),
      reasonCode,
      grantId: String(event.grantId || ""),
      catalogFingerprint: String(event.catalogFingerprint || ""),
      at: String(event.at || new Date().toISOString())
    };
    const reasonByCode = {
      grant_created: "Tool grant was created; target-visible MCP catalog may have changed.",
      grant_updated: "Tool grant was updated; target-visible MCP catalog must refresh.",
      grant_deleted: "Tool grant was deleted; target-visible MCP catalog must refresh.",
      grant_revoked: "Tool grant was revoked; target-visible MCP catalog must refresh.",
      grant_token_rotated: "Tool grant token was rotated; target-visible MCP catalog must refresh.",
      catalog_snapshot_saved: "Pact MCP tool catalog changed.",
      external_service_catalog_refreshed: "External service tools changed; Pact MCP tool catalog must refresh."
    };
    const notification = broadcastMcpToolListChanged({
      grantId: publicEvent.grantId,
      reasonCode,
      reason: event.reason || reasonByCode[reasonCode] || "Pact MCP tool catalog changed.",
      details: {
        source: publicEvent.source,
        type: publicEvent.type,
        catalogFingerprint: publicEvent.catalogFingerprint
      }
    });
    const pendingNotifications = [];
    if (typeof protocolEventBus?.publish === "function") {
      const publishResult = protocolEventBus.publish("tool_management.mcp_catalog_changed", {
        ...publicEvent,
        notification
      }, {
        delivery: "best-effort"
      });
      if (publishResult && (typeof publishResult.then === "function" || typeof publishResult.catch === "function")) {
        pendingNotifications.push(Promise.resolve(publishResult).catch(() => null));
      }
    }
    for (const handler of registeredChangeHandlers) {
      try {
        const handled = handler({
          ...publicEvent,
          notification
        });
        if (handled && (typeof handled.then === "function" || typeof handled.catch === "function")) {
          pendingNotifications.push(Promise.resolve(handled).catch(() => null));
        }
      } catch {
        // best-effort notification hook
      }
    }
    logger?.debug?.("tool_management.mcp.list_changed", {
      reasonCode,
      grantId: publicEvent.grantId,
      deliveredConnectionCount: notification.deliveredConnectionCount || 0
    });
    if (pendingNotifications.length > 0) {
      return Promise.allSettled(pendingNotifications).then(() => notification);
    }
    return notification;
  }

  const effectiveSecurityPermissions =
    securityPermissions ||
    (consoleAuth ? createSecurityPermissionsProvider({ consoleAuth }) : null);
  const externalMcpPassthroughRuntime = createExternalMcpPassthroughRuntime({ userDataPath, logger });
  function activeOperationsWithExternalMcp() {
    return [
      ...operations,
      ...externalMcpPassthroughRuntime.listVirtualOperationsSync()
    ];
  }
  let effectiveOperations = activeOperationsWithExternalMcp();
  const registry = createToolCatalogRegistry({
    operations: effectiveOperations,
    activeFeatureIds: featureRuntime?.activeFeatureIds || null
  });
  const store = createToolManagementStore({
    userDataPath,
    registry,
    governancePolicyRevisionProvider: () => effectiveSecurityPermissions?.getGovernancePolicyRevision?.(),
    changeListener: notifyMcpToolCatalogChanged
  });
  const authorizationStore = effectiveSecurityPermissions?.authorizationStore || null;
  const policyEngine = createToolPolicyEngine({
    registry,
    store,
    securityPermissions: effectiveSecurityPermissions,
    strategyManagementProvider
  });
  const runtime = createToolExecutionRuntime({
    registry,
    store,
    policyEngine,
    securityPermissions: effectiveSecurityPermissions,
    operations: effectiveOperations,
    externalMcpPassthroughRuntime,
    controllers,
    operationAuditStore,
    operationConcurrencyScope,
    protocolEventBus,
    logger
  });
  const router = createToolManagementHttpRouter({
    platform: {
      registry,
      store,
      policyEngine,
      runtime,
      authorizationStore,
      securityPermissions: effectiveSecurityPermissions,
      catalog: () => registry.getCatalog()
    },
    securityPermissions: effectiveSecurityPermissions,
    logger
  });
  store.saveCatalogSnapshot(registry.getCatalog());

  function refreshExternalServiceTools() {
    effectiveOperations = activeOperationsWithExternalMcp();
    const catalog = registry.refresh(effectiveOperations);
    runtime.refreshOperations?.(effectiveOperations);
    store.saveCatalogSnapshot(catalog, { notify: false });
    notifyMcpToolCatalogChanged({
      type: "external_service_catalog_refreshed",
      reasonCode: "external_service_catalog_refreshed",
      catalogFingerprint: catalog.fingerprint
    });
    return {
      ok: true,
      toolCount: catalog.tools.length,
      externalMcpOperationCount: effectiveOperations.filter((operation) =>
        operation.aspects?.includes("external-mcp-passthrough")
      ).length,
      externalServiceOperationCount: effectiveOperations.filter((operation) =>
        operation.aspects?.includes("external-service")
      ).length,
      fingerprint: catalog.fingerprint
    };
  }

  return {
    registry,
    store,
    policyEngine,
    runtime,
    router,
    securityPermissions: effectiveSecurityPermissions,
    authorizationStore,
    catalog: () => registry.getCatalog(),
    externalMcpPassthroughRuntime,
    refreshExternalServiceTools,
    registerChangeHandler(handler) {
      if (typeof handler !== "function") {
        return () => {};
      }
      registeredChangeHandlers.add(handler);
      return () => {
        registeredChangeHandlers.delete(handler);
      };
    },
    close() {
      store.close();
    }
  };
}
