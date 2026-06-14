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

const EXTERNAL_SERVICE_RUNTIME_INVALIDATION_SCOPES = Object.freeze([
  "tool-management-catalog",
  "mcp-tools-list",
  "grant-projection",
  "external-service-runtime-cache",
  "external-service-health-state",
  "upstream-session"
]);
const EXTERNAL_SERVICE_RUNTIME_INVALIDATION_REASON_CODES = new Set([
  "external_service_config_saved",
  "external_service_secret_auth_changed",
  "external_service_secret_initialized",
  "external_service_secret_updated",
  "external_service_secret_rotated",
  "external_service_secret_revoked",
  "external_service_config_saved_requires_runtime_reprojection",
  "external_service_production_verified",
  "production_verification_requires_runtime_reprojection",
  "external_service_catalog_refreshed",
  "external_service_runtime_refreshed",
  "external_service_tools_adopted",
  "external_service_tools_adopted_requires_runtime_reprojection",
  "external_service_catalog_promoted",
  "external_service_catalog_promoted_requires_runtime_reprojection",
  "external_service_catalog_rolled_back",
  "rollback_requires_runtime_reprojection"
]);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
}

function uniqueStrings(values = []) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))].sort();
}

function isExternalServiceCatalogChange(event = {}) {
  const source = String(event.source || "").trim();
  const reasonCode = String(event.reasonCode || event.type || "").trim();
  return source.includes("external-service") || reasonCode.startsWith("external_service_");
}

function normalizeExternalServiceCatalogChange(event = {}) {
  const normalizedEvent = asObject(event, {});
  if (!isExternalServiceCatalogChange(normalizedEvent)) {
    return normalizedEvent;
  }
  const currentInvalidation = asObject(normalizedEvent.invalidation, {});
  const shouldEnsureRuntimeScopes =
    asArray(currentInvalidation.scopes).length === 0 ||
    EXTERNAL_SERVICE_RUNTIME_INVALIDATION_REASON_CODES.has(String(currentInvalidation.reasonCode || "").trim()) ||
    EXTERNAL_SERVICE_RUNTIME_INVALIDATION_REASON_CODES.has(String(normalizedEvent.reasonCode || "").trim()) ||
    EXTERNAL_SERVICE_RUNTIME_INVALIDATION_REASON_CODES.has(String(normalizedEvent.type || "").trim());
  if (!shouldEnsureRuntimeScopes) {
    return normalizedEvent;
  }
  return {
    ...normalizedEvent,
    invalidation: {
      ...currentInvalidation,
      reasonCode: String(
        currentInvalidation.reasonCode ||
          normalizedEvent.reasonCode ||
          normalizedEvent.type ||
          "external_service_runtime_reprojection_required"
      ).trim(),
      serviceId: String(currentInvalidation.serviceId || normalizedEvent.serviceId || "").trim(),
      scopes: uniqueStrings([
        ...EXTERNAL_SERVICE_RUNTIME_INVALIDATION_SCOPES,
        ...asArray(currentInvalidation.scopes),
        ...asArray(normalizedEvent.scopes)
      ])
    }
  };
}

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
    const normalizedEvent = normalizeExternalServiceCatalogChange(event);
    const reasonCode = String(normalizedEvent.reasonCode || normalizedEvent.type || "tool_management_changed");
    const publicEvent = {
      schemaVersion: "v0.0.1:schema:definition-1",
      source: String(normalizedEvent.source || "tool-management-platform"),
      type: String(normalizedEvent.type || reasonCode),
      reasonCode,
      grantId: String(normalizedEvent.grantId || ""),
      serviceId: String(normalizedEvent.serviceId || ""),
      serviceCatalogVersionId: String(normalizedEvent.serviceCatalogVersionId || ""),
      activeVersionId: String(normalizedEvent.activeVersionId || ""),
      candidateVersionId: String(normalizedEvent.candidateVersionId || ""),
      manifestFingerprint: String(normalizedEvent.manifestFingerprint || ""),
      catalogFingerprint: String(normalizedEvent.catalogFingerprint || ""),
      invalidation: normalizedEvent.invalidation || null,
      at: String(normalizedEvent.at || new Date().toISOString())
    };
    const reasonByCode = {
      grant_created: "Tool grant was created; target-visible MCP catalog may have changed.",
      grant_updated: "Tool grant was updated; target-visible MCP catalog must refresh.",
      grant_deleted: "Tool grant was deleted; target-visible MCP catalog must refresh.",
      grant_revoked: "Tool grant was revoked; target-visible MCP catalog must refresh.",
      grant_token_rotated: "Tool grant token was rotated; target-visible MCP catalog must refresh.",
      catalog_snapshot_saved: "Pact MCP tool catalog changed.",
      external_service_catalog_refreshed: "External service tools changed; Pact MCP tool catalog must refresh.",
      external_service_production_verified: "External service production verification changed; Pact MCP tool catalog must refresh.",
      external_service_tools_adopted: "External service tools were adopted; Pact MCP tool catalog must refresh.",
      external_service_catalog_promoted: "External service catalog version was promoted; Pact MCP tool catalog must refresh.",
      external_service_catalog_rolled_back: "External service catalog version was rolled back; Pact MCP tool catalog must refresh."
    };
    const notification = broadcastMcpToolListChanged({
      grantId: publicEvent.grantId,
      reasonCode,
      reason: normalizedEvent.reason || reasonByCode[reasonCode] || "Pact MCP tool catalog changed.",
      details: {
        source: publicEvent.source,
        type: publicEvent.type,
        catalogFingerprint: publicEvent.catalogFingerprint,
        serviceId: publicEvent.serviceId,
        serviceCatalogVersionId: publicEvent.serviceCatalogVersionId,
        activeVersionId: publicEvent.activeVersionId,
        candidateVersionId: publicEvent.candidateVersionId,
        manifestFingerprint: publicEvent.manifestFingerprint,
        invalidation: publicEvent.invalidation
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

  function refreshExternalServiceTools(catalogChange = {}) {
    const normalizedCatalogChange = normalizeExternalServiceCatalogChange(catalogChange);
    const runtimeInvalidation = typeof externalMcpPassthroughRuntime.invalidateRuntimeState === "function"
      ? externalMcpPassthroughRuntime.invalidateRuntimeState(normalizedCatalogChange)
      : null;
    effectiveOperations = activeOperationsWithExternalMcp();
    const catalog = registry.refresh(effectiveOperations);
    runtime.refreshOperations?.(effectiveOperations);
    store.saveCatalogSnapshot(catalog, { notify: false });
    notifyMcpToolCatalogChanged({
      ...normalizedCatalogChange,
      source: normalizedCatalogChange?.source || "tool-management-platform",
      type: normalizedCatalogChange?.type || "external_service_catalog_refreshed",
      reasonCode: normalizedCatalogChange?.reasonCode || "external_service_catalog_refreshed",
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
      fingerprint: catalog.fingerprint,
      catalogChange: {
        ...normalizedCatalogChange,
        catalogFingerprint: catalog.fingerprint
      },
      ...(runtimeInvalidation ? { runtimeInvalidation } : {})
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
