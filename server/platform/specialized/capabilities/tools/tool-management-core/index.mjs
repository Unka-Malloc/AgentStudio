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
  logger = getRuntimeLogger()
}) {
  const effectiveSecurityPermissions =
    securityPermissions ||
    (consoleAuth ? createSecurityPermissionsProvider({ consoleAuth }) : null);
  const registry = createToolCatalogRegistry({
    operations,
    activeFeatureIds: featureRuntime?.activeFeatureIds || null
  });
  const store = createToolManagementStore({
    userDataPath,
    registry,
    governancePolicyRevisionProvider: () => effectiveSecurityPermissions?.getGovernancePolicyRevision?.()
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
    operations,
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

  return {
    registry,
    store,
    policyEngine,
    runtime,
    router,
    securityPermissions: effectiveSecurityPermissions,
    authorizationStore,
    catalog: () => registry.getCatalog(),
    close() {
      store.close();
    }
  };
}
