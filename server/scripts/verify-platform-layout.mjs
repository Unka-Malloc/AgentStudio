import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FEATURE_MANIFEST } from "../platform/interactive/features/feature-manifest.mjs";
import { createPlatformRegistry } from "../platform/interactive/platform-registry.mjs";
import { registerCorePlatformServices } from "../platform/common/platform-core/register.mjs";
import { registerSecurityPlatformServices } from "../platform/common/security/register.mjs";
import { createDataStructureProvider } from "../platform/common/data-structure/data-structure-provider.mjs";
import { registerDataStructurePlatformServices } from "../platform/common/data-structure/register.mjs";
import { createModuleManagementProvider } from "../platform/common/module-manager/module-management-provider.mjs";
import { registerModuleManagementPlatformServices } from "../platform/common/module-manager/register.mjs";
import { registerStoragePlatformServices } from "../platform/common/storage/register.mjs";
import { createStorageProvider } from "../platform/common/storage/storage-provider.mjs";
import { createDevopsProvider } from "../platform/common/devops/devops-provider.mjs";
import { registerDevopsPlatformServices } from "../platform/common/devops/register.mjs";

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

const allowedServerDirectories = new Set([
  "config",
  "platform",
  "protocols",
  "scripts",
  "services"
]);

const requiredPaths = [
  "server/platform/common/platform-core",
  "server/platform/common/platform-core/core-platform-provider.mjs",
  "server/platform/common/platform-core/settings.mjs",
  "server/platform/common/security",
  "server/platform/common/security/register.mjs",
  "server/platform/common/operation-dispatcher",
  "server/platform/common/console",
  "server/platform/common/data-structure",
  "server/platform/common/data-structure/register.mjs",
  "server/services/server-runtime/http-server.mjs",
  "server/platform/common/observability",
  "server/platform/common/storage",
  "server/platform/common/module-manager",
  "server/platform/common/version-control",
  "server/platform/common/version-control/README.md",
  "server/platform/common/version-control/version-registry.json",
  "server/platform/common/version-control/version-registry.schema.json",
  "server/platform/common/version-control/version-scan.mjs",
  "server/platform/common/devops",
  "server/platform/specialized/knowledge/preprocessing/chunking",
  "server/platform/modules/knowledge",
  "server/platform/modules/agent",
  "server/platform/specialized/agent/agent-configs",
  "server/platform/specialized/agent/agent-memory",
  "server/platform/specialized/agent/agent-gateway",
  "server/platform/specialized/agent/agent-context",
  "server/platform/specialized/agent/agent-workspace",
  "server/platform/specialized/capabilities/tools",
  "server/platform/specialized/capabilities/skills",
  "server/platform/specialized/knowledge",
  "server/platform/specialized/knowledge/preprocessing",
  "server/platform/specialized/knowledge/storage",
  "server/platform/specialized/knowledge/retrieval",
  "server/platform/specialized/knowledge/invocation",
  "server/platform/specialized/knowledge/preprocessing/domain",
  "server/platform/interactive/server-runtime-providers.mjs",
  "server/platform/interactive/features/feature-manifest.mjs",
  "server/platform/interactive/composition-root.mjs",
  "server/platform/interactive/platform-registry.mjs",
  "server/platform/interactive/product-api.mjs",
  "server/platform/common/platform-core/register.mjs",
  "server/platform/common/security/register.mjs",
  "server/platform/common/data-structure/register.mjs",
  "server/platform/common/storage/register.mjs",
  "server/platform/common/module-manager/register.mjs",
  "server/platform/common/devops/register.mjs",
  "server/scripts/verify-version-naming.mjs",
  "server/scripts/verify-version-registry.mjs",
  "server/platform/specialized/capabilities/tools/tool-management-core",
  "server/services/client/client-runtime-core",
  "server/services/client/work-queue-core"
];

const featureRequiredPaths = [
  {
    featureId: "maintenance-agent-runbooks",
    path: "server/services/agent/maintenance-agent"
  }
];

const sourceOnlyRequiredPaths = [
  "server/services/agent/maintenance-agent"
];

const retiredPlatformRoots = [
  "server/platform/core",
  "server/platform/agent",
  "server/platform/client",
  "server/platform/storage",
  "server/platform/ops",
  "server/platform/common/core-platform",
  "server/platform/common/platform-core/auth",
  "server/platform/common/platform-core/security",
  "server/platform/common/console-shell",
  "server/platform/common/ops",
  "server/platform/common/chunking",
  "server/platform/common/storage-core",
  "server/platform/common/mount-manager-core",
  "server/platform/specialized/agent/agent-tools",
  "server/platform/specialized/agent/agent-skills",
  "server/products",
  "server/application",
  "server/features",
  "server/modules",
  "server/domain",
  "server/services/ops"
];

const retiredMigrationRoots = [
  "server/auth",
  "server/security",
  "server/interfaces",
  "server/runtime",
  "server/chunking",
  "server/observability",
  "server/storage",
  "server/jobs",
  "server/tool-management",
  "server/skills",
  "server/application/MaintenanceAgent",
  "server/application/background-workers"
];

const retiredMigrationFiles = [
  "server/application/archive-batch-id.mjs",
  "server/application/background-process-status.mjs",
  "server/application/batch-deletion-coordinator.mjs",
  "server/application/checkpoint-tree-store.mjs",
  "server/application/client-registry-service.mjs",
  "server/application/client-runtime-allocator.mjs",
  "server/application/import-resume-store.mjs",
  "server/application/job-pipeline.mjs",
  "server/application/monitor-alerts.mjs",
  "server/application/queue-monitor.mjs",
  "server/application/state-coordinator.mjs",
  "server/application/unified-registration.mjs"
];

async function pathExists(relativePath) {
  try {
    await fs.access(path.join(repoRoot, relativePath));
    return true;
  } catch {
    return false;
  }
}

async function loadPackagedActiveFeatureIds() {
  const activeFeaturesPath = path.join(repoRoot, "feature-profile", "active-features.json");
  try {
    const parsed = JSON.parse(await fs.readFile(activeFeaturesPath, "utf8"));
    return new Set(Array.isArray(parsed.activeFeatureIds) ? parsed.activeFeatureIds : []);
  } catch {
    return null;
  }
}

async function walk(relativePath) {
  const root = path.join(repoRoot, relativePath);
  if (!(await pathExists(relativePath))) {
    return [];
  }
  const out = [];
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    const childRelative = path.join(relativePath, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walk(childRelative)));
    } else if (entry.isFile()) {
      out.push(childRelative);
    }
  }
  return out;
}

function normalize(relativePath) {
  return relativePath.split(path.sep).join("/");
}

function specifierTarget(fileRelativePath, specifier) {
  const base = path.resolve(path.join(repoRoot, path.dirname(fileRelativePath)), specifier);
  const candidates = [base, `${base}.mjs`, `${base}.js`, path.join(base, "index.mjs")];
  return candidates.find((candidate) => candidate.startsWith(repoRoot)) || base;
}

function isServicePath(absolutePath) {
  const relativePath = normalize(path.relative(repoRoot, absolutePath));
  return relativePath.startsWith("server/services/");
}

function isNonInteractivePlatformPath(absolutePath) {
  const relativePath = normalize(path.relative(repoRoot, absolutePath));
  return relativePath.startsWith("server/platform/common/");
}

async function assertInteractiveRegistrations() {
  const registry = createPlatformRegistry({ scope: "verify-platform-layout" });
  registerCorePlatformServices(registry, {
    protocolEventBus: {},
    runtimeLogger: {},
    featureRuntime: {},
    operationConcurrencyScope: "verify"
  });
  const storageProvider = createStorageProvider({
    userDataPath: "verify-data",
    metadataStore: {
      databasePath: "verify.sqlite",
      objectRootPath: "raw-objects",
      getStorageSummary: () => ({}),
      getRawMailObject: () => null,
      recordClientCheckIn: (input) => input,
      listClientRegistrations: () => ({ items: [] }),
      rebuildSourceVocabulary: () => ({}),
      getSignificantSourceTerms: () => ({}),
      search: () => ({ items: [] })
    }
  });
  registerStoragePlatformServices(registry, {
    storageProvider,
    userDataPath: "verify-data"
  });
  const moduleManagement = createModuleManagementProvider({
    userDataPath: "verify-data",
    runtime: {
      get runtimeOptions() {
        return {
          profile: "verify",
          cwd: "verify",
          mountModules: {},
          mountRouting: {}
        };
      },
      get mountGeneration() {
        return 1;
      },
      get mounts() {
        return {
          documentParser: {},
          knowledgeBase: {}
        };
      },
      createExecutionView() {
        return {};
      },
      async applyMountConfig() {
        return {};
      },
      async refreshMounts() {
        return {};
      }
    }
  });
  registerModuleManagementPlatformServices(registry, {
    moduleManagement
  });
  registerSecurityPlatformServices(registry, {
    consoleAuth: {},
    operationAuditStore: {}
  });
  registerDataStructurePlatformServices(registry, {
    dataStructures: createDataStructureProvider({ userDataPath: "verify-data" })
  });
  registerDevopsPlatformServices(registry, {
    userDataPath: "verify-data",
    devopsProvider: createDevopsProvider({ userDataPath: "verify-data" })
  });

  const registeredIds = new Set(registry.list().map((entry) => entry.id));
  for (const id of [
    "security.auth.console",
    "security.audit.operations",
    "core.provider",
    "core.events.protocol",
    "core.logging.runtime",
    "core.features.runtime",
    "core.operations.concurrencyScope",
    "core.operations.registry",
    "data-structure.provider",
    "data-structure.checkpointTree",
    "storage.provider",
    "storage.metadataStore",
    "module-management.provider",
    "module-management.serverRuntime",
    "module-management.mounts",
    "devops.provider",
    "devops.processStatus.get",
    "devops.monitorAlerts.state",
    "devops.monitorAlerts.saveConfig",
    "devops.monitorAlerts.runCycle",
    "devops.monitorAlerts.acknowledge",
    "devops.unifiedRegistration.normalize"
  ]) {
    assert.equal(registeredIds.has(id), true, `bottom platform interface must be registered: ${id}`);
  }

  assert.deepEqual(
    registry.list({ layer: "common" }).map((entry) => entry.layer).filter((layer) => layer !== "common"),
    [],
    "common registrations must be listable by common layer"
  );
  assert.equal(
    registry.requireInterface("devops.processStatus.get").layer,
    "common",
    "devops registrations must live in the common platform layer"
  );
  assert.throws(
    () => registry.register({ id: "agent.toolManagement", platform: "agent", value: {} }),
    /only accepts bottom platform interfaces/,
    "agent product must not register as a bottom platform interface"
  );
  assert.throws(
    () => registry.register({ id: "client.workQueue", platform: "client", value: {} }),
    /only accepts bottom platform interfaces/,
    "client product must not register as a bottom platform interface"
  );
}

async function assertServerTopLevelDirectories() {
  const serverRoot = path.join(repoRoot, "server");
  const actual = (await fs.readdir(serverRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const unexpected = actual.filter((entry) => !allowedServerDirectories.has(entry));
  assert.deepEqual(unexpected, [], "server top-level directories must stay classified");
}

async function assertNoServerRootModules() {
  const serverRoot = path.join(repoRoot, "server");
  const actual = (await fs.readdir(serverRoot, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".mjs"))
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(actual, [], "server root must not contain loose .mjs modules");
}

async function assertPlatformDoesNotImportProducts() {
  const importPattern =
    /(\bfrom\s*["'])(\.{1,2}\/[^"']+)(["'])|(\bimport\s*\(\s*["'])(\.{1,2}\/[^"']+)(["']\s*\))/g;
  const violations = [];
  for (const root of [
    "server/platform/common",
    "server/platform/interactive",
    "server/platform/modules",
    "server/platform/specialized"
  ]) {
    for (const file of await walk(root)) {
      if (!file.endsWith(".mjs")) {
        continue;
      }
      const text = await fs.readFile(path.join(repoRoot, file), "utf8");
      for (const match of text.matchAll(importPattern)) {
        const specifier = match[2] || match[5];
      if (isServicePath(specifierTarget(file, specifier))) {
        violations.push({ file, specifier });
      }
      }
    }
  }
  assert.deepEqual(violations, [], "platform layers must not import product layer code directly");
}

async function assertServicesUseInteractiveLayerForBottomCalls() {
  const importPattern =
    /(\bfrom\s*["'])(\.{1,2}\/[^"']+)(["'])|(\bimport\s*\(\s*["'])(\.{1,2}\/[^"']+)(["']\s*\))/g;
  const violations = [];
  for (const root of ["server/services/agent", "server/services/client"]) {
    for (const file of await walk(root)) {
      if (!file.endsWith(".mjs")) {
        continue;
      }
      const text = await fs.readFile(path.join(repoRoot, file), "utf8");
      for (const match of text.matchAll(importPattern)) {
        const specifier = match[2] || match[5];
        if (isNonInteractivePlatformPath(specifierTarget(file, specifier))) {
          violations.push({ file, specifier });
        }
      }
    }
  }
  assert.deepEqual(violations, [], "services must call bottom platform capabilities through server/platform/interactive");
}

async function main() {
  const packagedActiveFeatureIds = await loadPackagedActiveFeatureIds();
  const effectiveRequiredPaths = [
    ...requiredPaths,
    ...featureRequiredPaths
      .filter((entry) => packagedActiveFeatureIds?.has(entry.featureId))
      .map((entry) => entry.path),
    ...(packagedActiveFeatureIds ? [] : sourceOnlyRequiredPaths)
  ];
  for (const relativePath of effectiveRequiredPaths) {
    assert.equal(await pathExists(relativePath), true, `${relativePath} must exist`);
  }
  for (const relativePath of [...retiredPlatformRoots, ...retiredMigrationRoots, ...retiredMigrationFiles]) {
    assert.equal(await pathExists(relativePath), false, `${relativePath} must not exist`);
  }

  const groups = new Set(FEATURE_MANIFEST.groups);
  for (const requiredGroup of ["core", "security", "module-management", "data-structure", "storage", "devops", "capabilities", "agent", "client"]) {
    assert.equal(groups.has(requiredGroup), true, `feature group ${requiredGroup} must exist`);
  }
  assert.equal(groups.has("ops"), false, "ops was renamed to devops");

  const featureById = new Map(FEATURE_MANIFEST.features.map((feature) => [feature.featureId, feature]));
  assert.equal(featureById.get("maintenance-agent-runbooks")?.group, "core");
  assert.equal(featureById.get("security-permissions")?.group, "security");
  assert.equal(featureById.get("data-structure-core")?.group, "data-structure");
  assert.equal(featureById.get("devops-core")?.group, "devops");
  assert.equal(featureById.get("agent-memory")?.group, "agent");
  assert.equal(featureById.get("tool-management-core")?.group, "capabilities");
  assert.equal(featureById.get("work-queue-core")?.group, "client");
  assert.equal(featureById.get("storage-core")?.group, "storage");
  assert.equal(featureById.get("module-management-core")?.group, "module-management");

  await assertInteractiveRegistrations();
  await assertServerTopLevelDirectories();
  await assertNoServerRootModules();
  await assertPlatformDoesNotImportProducts();
  await assertServicesUseInteractiveLayerForBottomCalls();
}

await main();
console.log("platform-layout verification passed");
