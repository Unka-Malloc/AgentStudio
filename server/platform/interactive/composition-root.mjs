import path from "node:path";
import { resolveFeatureRuntimeFromEnv, filterOperationsForFeatures, publicFeatureRuntime } from "./features/feature-manifest.mjs";
import { createProtocolEventBus } from "../../protocols/pubsub/event-bus.mjs";
import { createCorePlatformProvider } from "../common/platform-core/core-platform-provider.mjs";
import { registerCorePlatformServices } from "../common/platform-core/register.mjs";
import { createDataStructureProvider } from "../common/data-structure/data-structure-provider.mjs";
import { registerDataStructurePlatformServices } from "../common/data-structure/register.mjs";
import { createConsoleAuth } from "../common/security/auth/console-auth.mjs";
import { createOperationAuditStore } from "../common/security/operation-audit.mjs";
import { registerSecurityPlatformServices } from "../common/security/register.mjs";
import { createSecurityPermissionsProvider } from "../common/security/security-permissions-provider.mjs";
import { createModuleManagementProvider } from "../common/module-manager/module-management-provider.mjs";
import { createServerRuntime } from "../common/module-manager/server-runtime.mjs";
import { registerModuleManagementPlatformServices } from "../common/module-manager/register.mjs";
import { SERVER_API_OPERATIONS } from "../common/operation-dispatcher/operation-registry.mjs";
import { loadSettings } from "../common/platform-core/settings.mjs";
import { registerStoragePlatformServices } from "../common/storage/register.mjs";
import { createStorageProvider } from "../common/storage/storage-provider.mjs";
import { createDevopsProvider } from "../common/devops/devops-provider.mjs";
import { registerDevopsPlatformServices } from "../common/devops/register.mjs";
import { getAgentConfigRegistry } from "../specialized/agent/agent-configs/config-registry.mjs";
import { createConsoleDomainServices } from "../specialized/console/console-domain-services.mjs";
import { createPlatformRegistry } from "./platform-registry.mjs";

async function createRuntimeKnowledgeProviders({ userDataPath, featureRuntime }) {
  if (!featureRuntime.activeFeatureIds.includes("knowledge-core")) {
    return {
      metadataStoreDomainServices: {},
      builtinMountProviders: {}
    };
  }
  const [
    metadataModule,
    mountModule
  ] = await Promise.all([
    import("../specialized/knowledge/storage/metadata-store-domain-services.mjs"),
    import("../specialized/knowledge/storage/builtin-mount-providers.mjs")
  ]);
  return {
    metadataStoreDomainServices: metadataModule.createKnowledgeMetadataStoreDomainServices(),
    builtinMountProviders: mountModule.createKnowledgeBuiltinMountProviders({ userDataPath })
  };
}

export async function createServerCompositionRoot({
  userDataPath,
  runtimeOptions = {},
  runtimeLogger
}) {
  const featureRuntime = await resolveFeatureRuntimeFromEnv({ runtimeOptions });
  const platformRegistry = createPlatformRegistry({
    scope: path.resolve(userDataPath)
  });
  const runtimeOptionsWithFeatures = {
    ...runtimeOptions,
    featureRuntime,
    featureEdition: featureRuntime.edition
  };
  const activeApiOperations = filterOperationsForFeatures(
    SERVER_API_OPERATIONS,
    featureRuntime
  );
  const publicFeatures = () =>
    publicFeatureRuntime(featureRuntime, SERVER_API_OPERATIONS);
  const isFeatureActive = (featureId) =>
    featureRuntime.activeFeatureIds.includes(featureId);
  const isAnyFeatureActive = (...featureIds) =>
    featureIds.some((featureId) => isFeatureActive(featureId));

  const knowledgeProviders = await createRuntimeKnowledgeProviders({ userDataPath, featureRuntime });
  const runtime = await createServerRuntime({
    userDataPath,
    runtimeOptions: runtimeOptionsWithFeatures,
    metadataStoreDomainServices: knowledgeProviders.metadataStoreDomainServices,
    builtinMountProviders: knowledgeProviders.builtinMountProviders
  });
  const consoleAuth = createConsoleAuth({ userDataPath });
  const securityPermissions = createSecurityPermissionsProvider({ consoleAuth });
  const moduleManagement = createModuleManagementProvider({ runtime, userDataPath });
  const dataStructures = createDataStructureProvider({ userDataPath });
  const operationAuditStore = createOperationAuditStore({ userDataPath });
  const operationConcurrencyScope = path.resolve(userDataPath);
  const protocolEventBus = createProtocolEventBus({ userDataPath, logger: runtimeLogger });
  const coreProvider = createCorePlatformProvider({
    operations: activeApiOperations,
    protocolEventBus,
    runtimeLogger,
    featureRuntime,
    operationConcurrencyScope
  });
  const consoleDomainServices = createConsoleDomainServices();
  const storageProvider = createStorageProvider({
    userDataPath,
    metadataStore: runtime.metadataStore
  });
  const devopsProvider = createDevopsProvider({ userDataPath });

  registerCorePlatformServices(platformRegistry, {
    protocolEventBus,
    runtimeLogger,
    featureRuntime,
    operationConcurrencyScope,
    coreProvider
  });
  registerSecurityPlatformServices(platformRegistry, {
    securityPermissions,
    consoleAuth,
    operationAuditStore
  });
  registerModuleManagementPlatformServices(platformRegistry, {
    moduleManagement,
    runtime,
    runtimeOptions: runtimeOptionsWithFeatures
  });
  registerDataStructurePlatformServices(platformRegistry, { dataStructures });
  registerDevopsPlatformServices(platformRegistry, { userDataPath, devopsProvider });
  registerStoragePlatformServices(platformRegistry, {
    storageProvider,
    metadataStore: runtime.metadataStore,
    userDataPath
  });
  await getAgentConfigRegistry({ rootPath: path.join(userDataPath, "agent-configs") }).refresh({
    settingsFallback: await loadSettings(userDataPath)
  });

  return Object.freeze({
    userDataPath,
    runtimeOptions: runtimeOptionsWithFeatures,
    featureRuntime,
    allApiOperationCount: SERVER_API_OPERATIONS.length,
    activeApiOperations,
    publicFeatures,
    isFeatureActive,
    isAnyFeatureActive,
    platformRegistry,
    coreProvider,
    runtime,
    moduleManagement,
    dataStructures,
    consoleAuth,
    securityPermissions,
    operationAuditStore,
    operationConcurrencyScope,
    protocolEventBus,
    consoleDomainServices,
    storageProvider,
    devopsProvider,
    metadataStore: runtime.metadataStore
  });
}

export async function ensureConsoleOwner({ consoleAuth, enabled }) {
  if (!enabled) {
    return { created: false };
  }
  return consoleAuth.ensureInitialOwner();
}
