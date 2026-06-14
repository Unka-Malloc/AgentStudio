import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getStateMutationDispatcher,
  mutateState,
  stateFileKey
} from "../platform/common/platform-core/state-coordinator.mjs";
import { searchSourceFiles } from "../platform/specialized/knowledge/retrieval/source-file-search-service.mjs";
import {
  importFileTypeConfigPath,
  mediaTypeForImportExtension,
  reloadImportFileTypeRegistry
} from "../platform/specialized/knowledge/preprocessing/file-processor/import-file-types.mjs";
import { setRuntimeLogger } from "../platform/common/observability/runtime-logger.mjs";

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

async function readText(relativePath) {
  return fs.readFile(path.join(repoRoot, relativePath), "utf8");
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function assertStaticSingletonBoundaries() {
  const stateCoordinator = await readText("server/platform/common/platform-core/state-coordinator.mjs");
  assert.ok(stateCoordinator.includes("const stateQueues = new Map();"));
  assert.ok(stateCoordinator.includes("let defaultStateMutationDispatcher = null;"));
  assert.ok(stateCoordinator.includes("return `file:${path.resolve(filePath)}`;"));
  assert.ok(
    stateCoordinator.includes("const currentLogger = () => logger || getRuntimeLogger();"),
    "default StateMutationDispatcher must read the current runtime logger dynamically"
  );

  const operationDispatcher = await readText("server/platform/common/operation-dispatcher/operation-dispatcher.mjs");
  assert.ok(operationDispatcher.includes("const operationLocks = new Map();"));
  assert.ok(
    operationDispatcher.includes("const key = `${concurrencyScope}:${operation.concurrencyGroup || operation.id}`;"),
    "operation locks must be scoped by caller-provided concurrencyScope"
  );

  const compositionRoot = await readText("server/platform/interactive/composition-root.mjs");
  assert.ok(
    compositionRoot.includes("const operationConcurrencyScope = path.resolve(userDataPath);"),
    "HTTP/RPC dispatcher lock scope must be per userDataPath"
  );

  const toolRuntime = await readText("server/platform/specialized/capabilities/tools/tool-management-core/runtime.mjs");
  assert.ok(toolRuntime.includes("concurrencyScope: operationConcurrencyScope"));
  const maintenanceTools = await readText("server/services/agent/maintenance-agent/tool-registry.mjs");
  assert.ok(maintenanceTools.includes("concurrencyScope: operationConcurrencyScope"));

  const sourceSearch = await readText("server/platform/specialized/knowledge/retrieval/source-file-search-service.mjs");
  assert.ok(sourceSearch.includes("const SEARCH_CACHE = new Map();"));
  assert.ok(sourceSearch.includes("userDataPath: path.resolve(userDataPath)"));
  assert.ok(sourceSearch.includes("rulesUpdatedAt: rules.updatedAt"));
  assert.ok(sourceSearch.includes("scanRoots: sourceRoots.map((root) => ({"));
  assert.ok(sourceSearch.includes("setBoundedMapEntry(SEARCH_CACHE"));

  const importTypes = await readText("server/platform/specialized/knowledge/preprocessing/file-processor/import-file-types.mjs");
  assert.ok(importTypes.includes("let cachedRegistry = null;"));
  assert.ok(importTypes.includes("cachedPath === filePath"));
  assert.ok(importTypes.includes("cachedMtimeMs === stat.mtimeMs"));

  const entityDoc = await readText("docs/ENTITY-CONFIG-LAYOUT.md");
  assert.ok(entityDoc.includes("Single JSON files remain acceptable only for singleton snapshots"));
  assert.ok(entityDoc.includes("knowledge-skills/bundles/<skillId>"));
}

async function verifyStateDispatcherLoggerSingleton() {
  const events = [];
  const fixtureLogger = {
    debug(event, details = {}) {
      events.push({ level: "debug", event, details });
    },
    error(event, details = {}) {
      events.push({ level: "error", event, details });
    }
  };

  getStateMutationDispatcher();
  setRuntimeLogger(fixtureLogger);
  try {
    await mutateState({
      key: "verify-singleton-boundaries:logger",
      kind: "verify.singleton.logger",
      task: async () => "ok"
    });
  } finally {
    setRuntimeLogger(null);
  }

  assert.ok(
    events.some((entry) => entry.event === "state.dispatch.started"),
    "default StateMutationDispatcher singleton must not capture a stale null logger"
  );
}

function sourceSearchRules() {
  return {
    schemaVersion: "v0.0.1:schema:definition-1",
    updatedAt: "singleton-boundary-test",
    maxFileBytes: 1024 * 1024,
    maxEvidenceBytes: 128 * 1024,
    maxScanFiles: 1000,
    readConcurrency: 1,
    indexConcurrency: 1,
    indexMaxTermsPerFile: 1000,
    cacheTtlMs: 10 * 60 * 1000,
    includeKnowledgeSources: false,
    useInvertedIndex: false,
    scanFallbackWhenIndexMissing: true,
    knowledgeSourceExtensions: [".eml"],
    ignoredDirectories: [],
    scanRoots: [
      {
        id: "mail-root",
        label: "Mail Root",
        relativePath: "sources",
        extensions: [".eml"],
        enabled: true
      }
    ],
    queryExpansions: [],
    snippetWindow: 120
  };
}

async function seedSourceRoot(userDataPath, title) {
  await writeJson(path.join(userDataPath, "rules", "source-search-rules.json"), sourceSearchRules());
  await fs.mkdir(path.join(userDataPath, "sources"), { recursive: true });
  await fs.writeFile(
    path.join(userDataPath, "sources", `${title.toLowerCase()}.eml`),
    [
      `Subject: ${title}`,
      "From: sender@example.test",
      "",
      `Body contains sharedneedle for ${title}.`
    ].join("\n"),
    "utf8"
  );
}

async function verifySourceSearchCacheIsUserDataScoped() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pact-singleton-source-"));
  const userA = path.join(root, "a");
  const userB = path.join(root, "b");
  try {
    await seedSourceRoot(userA, "Alpha Source");
    await seedSourceRoot(userB, "Beta Source");

    const first = await searchSourceFiles({
      userDataPath: userA,
      query: "sharedneedle",
      limit: 10
    });
    const second = await searchSourceFiles({
      userDataPath: userB,
      query: "sharedneedle",
      limit: 10
    });
    const firstAgain = await searchSourceFiles({
      userDataPath: userA,
      query: "sharedneedle",
      limit: 10
    });

    assert.equal(first.fromCache, false);
    assert.equal(second.fromCache, false);
    assert.equal(firstAgain.fromCache, true);
    assert.equal(first.items[0]?.title, "Alpha Source");
    assert.equal(second.items[0]?.title, "Beta Source");
    assert.notEqual(first.items[0]?.evidenceId, second.items[0]?.evidenceId);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

function importDictionary(mediaType) {
  return {
    schemaVersion: "v0.0.1:schema:definition-1",
    groups: [
      {
        id: "singleton-test",
        label: "Singleton Test",
        entries: [
          {
            label: "Singleton Fixture",
            kind: "document",
            mediaType,
            extensions: [".singleton"]
          }
        ]
      }
    ]
  };
}

async function verifyImportRegistryCacheBoundary() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pact-singleton-import-"));
  const originalPath = process.env.PACT_IMPORT_FILE_TYPES_PATH;
  try {
    const firstPath = path.join(root, "first.json");
    const secondPath = path.join(root, "second.json");
    await writeJson(firstPath, importDictionary("application/x-singleton-a"));
    process.env.PACT_IMPORT_FILE_TYPES_PATH = firstPath;
    reloadImportFileTypeRegistry();
    assert.equal(importFileTypeConfigPath(), path.resolve(firstPath));
    assert.equal(mediaTypeForImportExtension(".singleton"), "application/x-singleton-a");

    await new Promise((resolve) => setTimeout(resolve, 25));
    await writeJson(firstPath, importDictionary("application/x-singleton-b"));
    await fs.utimes(firstPath, new Date(), new Date(Date.now() + 2000));
    assert.equal(
      mediaTypeForImportExtension(".singleton"),
      "application/x-singleton-b",
      "import file type singleton cache must invalidate when its source file mtime changes"
    );

    await writeJson(secondPath, importDictionary("application/x-singleton-c"));
    process.env.PACT_IMPORT_FILE_TYPES_PATH = secondPath;
    assert.equal(importFileTypeConfigPath(), path.resolve(secondPath));
    assert.equal(
      mediaTypeForImportExtension(".singleton"),
      "application/x-singleton-c",
      "import file type singleton cache must invalidate when its source path changes"
    );
  } finally {
    if (originalPath === undefined) {
      delete process.env.PACT_IMPORT_FILE_TYPES_PATH;
    } else {
      process.env.PACT_IMPORT_FILE_TYPES_PATH = originalPath;
    }
    reloadImportFileTypeRegistry();
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function verifyPathScopedStateKeys() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pact-singleton-state-"));
  try {
    const first = stateFileKey(path.join(root, "a", "settings.json"));
    const second = stateFileKey(path.join(root, "b", "settings.json"));
    assert.notEqual(first, second);
    assert.ok(first.startsWith("file:"));
    assert.ok(second.startsWith("file:"));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

await assertStaticSingletonBoundaries();
await verifyStateDispatcherLoggerSingleton();
await verifyPathScopedStateKeys();
await verifySourceSearchCacheIsUserDataScoped();
await verifyImportRegistryCacheBoundary();

console.log("singleton-boundaries verification passed");
