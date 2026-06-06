import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  CORE_MOUNT_NAMES,
  loadMountConfig,
  mergeMountRouting,
  normalizeMountModules,
  normalizeMountRouting
} from "./mount-config.mjs";

const MOUNT_FEATURE_IDS = Object.freeze({
  analysis: "analysis-runtime",
  ocr: "ocr",
  multimodalParser: "multimodal-parser",
  documentParser: "document-parser",
  pdfProcessor: "pdf-processor",
  knowledgeBase: "knowledge-core",
  vectorStore: "vector-store-external",
  graphStore: "graph-store-external"
});

function normalizeProfile(value) {
  return value === "minimal" ? "minimal" : "default";
}

export function normalizeRuntimeOptions(runtimeOptions = {}) {
  const testHooks =
    runtimeOptions.testHooks && typeof runtimeOptions.testHooks === "object"
      ? {
          jobDelayMs: Number(runtimeOptions.testHooks.jobDelayMs || 0)
        }
      : {};

  return {
    profile: normalizeProfile(runtimeOptions.profile),
    cwd: runtimeOptions.cwd || process.cwd(),
    mountModules: normalizeMountModules(runtimeOptions.mountModules),
    mountRouting: normalizeMountRouting(runtimeOptions.mountRouting),
    featureRuntime: runtimeOptions.featureRuntime || null,
    testHooks
  };
}

function createNoopMount(kind, reason = "disabled") {
  return {
    id: `core/noop/${kind}`,
    kind,
    enabled: false,
    reason,
    supports() {
      return false;
    },
    async extractDocument() {
      return {
        parserId: `core/noop/${kind}`,
        text: "",
        metadata: {},
        embeddedDocuments: []
      };
    },
    async extractText() {
      return "";
    },
    async onBatchCompleted() {},
    async close() {}
  };
}

async function createBuiltinOcrMount() {
  const { extractTextWithPaddleOcr } = await import("../../modules/knowledge/file-processor/FileNormalizer/OCR/paddle-ocr.mjs");
  return {
    id: "builtin/paddleocr",
    kind: "ocr",
    enabled: true,
    async extractText(input) {
      return extractTextWithPaddleOcr(input);
    },
    async close() {}
  };
}

async function createBuiltinDocumentParserMount() {
  const {
    extractDocumentWithTika,
    extractTextWithTika,
    isTikaBackedDocument
  } = await import("../../modules/knowledge/file-processor/FileNormalizer/Tika/tika.mjs");
  return {
    id: "builtin/tika",
    kind: "documentParser",
    enabled: true,
    supports({ extension = "", mediaTypeHint = "" }) {
      return isTikaBackedDocument({ extension, mediaTypeHint });
    },
    async extractDocument(input) {
      return extractDocumentWithTika(input);
    },
    async extractText(input) {
      return extractTextWithTika(input);
    },
    async close() {}
  };
}

function createNoopBatchMount(kind) {
  return {
    id: `core/noop/${kind}`,
    kind,
    enabled: false,
    async onBatchCompleted() {},
    async close() {}
  };
}

async function createBuiltinPdfProcessorMount() {
  const { createPdfProcessorMount } = await import("../../modules/knowledge/file-processor/FileNormalizer/PDFProcessor/index.mjs");
  return createPdfProcessorMount();
}

function createMountFactories(builtinMountProviders = {}) {
  const knowledgeBaseProvider = builtinMountProviders.knowledgeBase || {};
  return {
    analysis: {
      builtinFactory: () => createNoopBatchMount("analysis"),
      minimalFactory: () => createNoopBatchMount("analysis"),
      fallbackFactory: () => createNoopBatchMount("analysis")
    },
    multimodalParser: {
      builtinFactory: () => createNoopMount("multimodalParser"),
      minimalFactory: () => createNoopMount("multimodalParser", "minimal-profile"),
      fallbackFactory: () => createNoopMount("multimodalParser")
    },
    ocr: {
      builtinFactory: createBuiltinOcrMount,
      minimalFactory: () => createNoopMount("ocr", "minimal-profile"),
      fallbackFactory: () => createNoopMount("ocr")
    },
    documentParser: {
      builtinFactory: createBuiltinDocumentParserMount,
      minimalFactory: () => createNoopMount("documentParser", "minimal-profile"),
      fallbackFactory: () => createNoopMount("documentParser")
    },
    pdfProcessor: {
      builtinFactory: createBuiltinPdfProcessorMount,
      minimalFactory: () => createNoopMount("pdfProcessor", "minimal-profile"),
      fallbackFactory: () => createNoopMount("pdfProcessor")
    },
    knowledgeBase: {
      builtinFactory: knowledgeBaseProvider.builtinFactory || (() => createNoopBatchMount("knowledgeBase")),
      minimalFactory: knowledgeBaseProvider.minimalFactory || (() => createNoopBatchMount("knowledgeBase")),
      fallbackFactory: () => createNoopBatchMount("knowledgeBase")
    },
    vectorStore: {
      builtinFactory: () => createNoopBatchMount("vectorStore"),
      minimalFactory: () => createNoopBatchMount("vectorStore"),
      fallbackFactory: () => createNoopBatchMount("vectorStore")
    },
    graphStore: {
      builtinFactory: () => createNoopBatchMount("graphStore"),
      minimalFactory: () => createNoopBatchMount("graphStore"),
      fallbackFactory: () => createNoopBatchMount("graphStore")
    }
  };
}

function createDynamicMountFactories(mountName) {
  return {
    builtinFactory: () => createNoopMount(mountName),
    minimalFactory: () => createNoopMount(mountName, "minimal-profile"),
    fallbackFactory: () => createNoopMount(mountName)
  };
}

async function loadMountFromModule(modulePath, mountName, context, generation) {
  if (!modulePath) {
    return null;
  }

  const resolvedPath = path.isAbsolute(modulePath)
    ? modulePath
    : path.resolve(context.cwd || process.cwd(), modulePath);
  const moduleUrl = new URL(pathToFileURL(resolvedPath).href);
  moduleUrl.searchParams.set("mount_generation", String(generation));
  const loaded = await import(moduleUrl.href);
  const factory =
    loaded.createMount ||
    loaded.default ||
    loaded[`create${mountName.slice(0, 1).toUpperCase()}${mountName.slice(1)}Mount`];

  if (typeof factory === "function") {
    return await factory({
      mountName,
      userDataPath: context.userDataPath,
      runtimeOptions: context.runtimeOptions
    });
  }

  if (loaded && typeof loaded === "object") {
    return loaded;
  }

  throw new Error(`挂载模块未导出可用工厂：${resolvedPath}`);
}

function normalizeMountedInstance(loaded, mountName) {
  return {
    enabled: loaded.enabled !== false,
    kind: mountName,
    supports: loaded.supports?.bind(loaded),
    extractDocument: loaded.extractDocument?.bind(loaded),
    extractText: loaded.extractText?.bind(loaded),
    onBatchCompleted: loaded.onBatchCompleted?.bind(loaded),
    reload: loaded.reload?.bind(loaded),
    close: loaded.close?.bind(loaded),
    ...loaded
  };
}

async function resolveMount({
  mountName,
  runtimeOptions,
  userDataPath,
  factories,
  generation
}) {
  const modulePath = runtimeOptions.mountModules[mountName];
  const loaded = await loadMountFromModule(modulePath, mountName, {
    userDataPath,
    runtimeOptions,
    cwd: runtimeOptions.cwd
  }, generation);

  if (loaded) {
    return normalizeMountedInstance(loaded, mountName);
  }

  if (runtimeOptions.profile === "minimal") {
    return await (factories.minimalFactory || factories.fallbackFactory)({ runtimeOptions });
  }

  return await (factories.builtinFactory || factories.fallbackFactory)({ runtimeOptions });
}

function listConfiguredMountNames(runtimeOptions = {}) {
  const configuredMounts = Object.keys(runtimeOptions.mountModules || {});
  const routedMounts = [
    ...Object.values(runtimeOptions.mountRouting?.kindRoutes || {}),
    ...Object.values(runtimeOptions.mountRouting?.extensionRoutes || {}),
    ...Object.values(runtimeOptions.mountRouting?.mediaTypeRoutes || {})
  ]
    .map((route) => String(route?.mountName || "").trim())
    .filter(Boolean);

  return [...new Set([...CORE_MOUNT_NAMES, ...configuredMounts, ...routedMounts])]
    .filter((mountName) => isMountFeatureActive(runtimeOptions, mountName));
}

function isMountFeatureActive(runtimeOptions = {}, mountName = "") {
  const featureId = MOUNT_FEATURE_IDS[mountName];
  if (!featureId) {
    return true;
  }
  return isMountRuntimeFeatureActive(runtimeOptions, featureId);
}

function isMountRuntimeFeatureActive(runtimeOptions = {}, featureId = "") {
  if (!featureId) {
    return true;
  }
  const activeFeatureIds = runtimeOptions.featureRuntime?.activeFeatureIds;
  if (!Array.isArray(activeFeatureIds) || activeFeatureIds.length === 0) {
    return true;
  }
  return activeFeatureIds.includes(featureId);
}

function buildPostCommitHooks(mounts) {
  return Object.entries(mounts || {})
    .filter(([, mount]) => typeof mount?.onBatchCompleted === "function")
    .map(([name, mount]) => ({
      name,
      execute: mount.onBatchCompleted.bind(mount)
    }));
}

function mountSupportsRouteAction(mount, action = "") {
  if (action === "extractDocument") {
    return typeof mount?.extractDocument === "function" || typeof mount?.extractText === "function";
  }
  if (action === "extractText") {
    return typeof mount?.extractText === "function" || typeof mount?.extractDocument === "function";
  }
  return Boolean(action && typeof mount?.[action] === "function");
}

function validateMountRoutingCapabilities(mounts = {}, mountRouting = {}) {
  const routeEntries = [
    ...Object.entries(mountRouting.kindRoutes || {}).map(([key, route]) => ["kind", key, route]),
    ...Object.entries(mountRouting.extensionRoutes || {}).map(([key, route]) => ["extension", key, route]),
    ...Object.entries(mountRouting.mediaTypeRoutes || {}).map(([key, route]) => ["mediaType", key, route])
  ];
  for (const [routeType, routeKey, route] of routeEntries) {
    const mountName = String(route?.mountName || "").trim();
    const action = String(route?.action || "extractDocument").trim() || "extractDocument";
    if (!mountName) {
      continue;
    }
    const mount = mounts[mountName];
    if (!mount) {
      throw new Error(`挂载路由 ${routeType}:${routeKey} 指向未加载模块 ${mountName}。`);
    }
    if (!mountSupportsRouteAction(mount, action)) {
      throw new Error(`挂载路由 ${routeType}:${routeKey} 指向的 ${mountName} 不支持 ${action}。`);
    }
  }
}

function filterMountRoutingForLoadedMounts(mountRouting = {}, mounts = {}) {
  const filterRoutes = (routes = {}) =>
    Object.fromEntries(
      Object.entries(routes || {}).filter(([, route]) => {
        const mountName = String(route?.mountName || "").trim();
        return !mountName || Boolean(mounts[mountName]);
      })
    );

  return {
    kindRoutes: filterRoutes(mountRouting.kindRoutes),
    extensionRoutes: filterRoutes(mountRouting.extensionRoutes),
    mediaTypeRoutes: filterRoutes(mountRouting.mediaTypeRoutes)
  };
}

async function closeMounts(mounts = {}) {
  await Promise.all(
    Object.values(mounts).map(async (mount) => {
      if (typeof mount?.close === "function") {
        await mount.close();
      }
    })
  );
}

export async function createMountManager({
  userDataPath,
  runtimeOptions = {},
  builtinMountProviders = {}
}) {
  const normalizedRuntimeOptions = normalizeRuntimeOptions(runtimeOptions);
  const persistedMountConfig = await loadMountConfig(userDataPath);
  const initialRuntimeOptions = normalizeRuntimeOptions({
    ...normalizedRuntimeOptions,
    mountModules: {
      ...(persistedMountConfig.mountModules || {}),
      ...(normalizedRuntimeOptions.mountModules || {})
    },
    mountRouting: mergeMountRouting(
      persistedMountConfig.mountRouting || {},
      normalizedRuntimeOptions.mountRouting || {}
    )
  });

  const factories = createMountFactories(builtinMountProviders);
  let currentRuntimeOptions = initialRuntimeOptions;
  let currentMounts = {};
  let generation = 0;
  let operationChain = Promise.resolve();

  function resolveDocumentRoute({ sourceKind = "", extension = "", mediaTypeHint = "" } = {}) {
    const normalizedExtension = String(extension || "").toLowerCase().trim();
    const normalizedMediaType = String(mediaTypeHint || "").toLowerCase().trim();
    const normalizedKind = String(sourceKind || "").trim();
    const routing = currentRuntimeOptions.mountRouting || {};
    const extensionRoute =
      normalizedExtension && routing.extensionRoutes?.[normalizedExtension]
        ? {
            ...routing.extensionRoutes[normalizedExtension],
            matchedBy: "extension"
          }
        : null;
    const mediaTypeRoute =
      normalizedMediaType && routing.mediaTypeRoutes?.[normalizedMediaType]
        ? {
            ...routing.mediaTypeRoutes[normalizedMediaType],
            matchedBy: "mediaType"
          }
        : null;
    const kindRoute = routing.kindRoutes?.[normalizedKind]
      ? {
          ...routing.kindRoutes[normalizedKind],
          matchedBy: "kind"
        }
      : null;

    return (
      extensionRoute ||
      mediaTypeRoute ||
      kindRoute ||
      {
        mountName: "documentParser",
        action: "extractDocument",
        matchedBy: "default"
      }
    );
  }

  function createExecutionView() {
    return {
      mounts: currentMounts,
      postCommitHooks: buildPostCommitHooks(currentMounts),
      runtimeOptions: currentRuntimeOptions,
      resolveDocumentRoute
    };
  }

  async function instantiateMounts(nextRuntimeOptions, settings) {
    const nextGeneration = generation + 1;
    const mountEntries = await Promise.all(
      listConfiguredMountNames(nextRuntimeOptions).map(async (mountName) => {
        const mountFactories = factories[mountName] || createDynamicMountFactories(mountName);
        const mount = await resolveMount({
          mountName,
          runtimeOptions: nextRuntimeOptions,
          userDataPath,
          factories: mountFactories,
          generation: nextGeneration
        });

        if (mount && typeof mount.reload === "function") {
          await mount.reload({
            settings,
            mountName,
            runtimeOptions: nextRuntimeOptions
          });
        }

        return [mountName, mount];
      })
    );
    const mounts = Object.fromEntries(mountEntries);
    const effectiveRuntimeOptions = {
      ...nextRuntimeOptions,
      mountRouting: filterMountRoutingForLoadedMounts(nextRuntimeOptions.mountRouting || {}, mounts)
    };
    validateMountRoutingCapabilities(mounts, effectiveRuntimeOptions.mountRouting || {});

    return {
      generation: nextGeneration,
      mounts,
      runtimeOptions: effectiveRuntimeOptions
    };
  }

  async function queueOperation(fn) {
    const run = async () => fn();
    operationChain = operationChain.then(run, run);
    return operationChain;
  }

  async function applyRuntimeOptions(nextRuntimeOptions, { settings } = {}) {
    return queueOperation(async () => {
      const normalizedNext = normalizeRuntimeOptions({
        ...currentRuntimeOptions,
        ...nextRuntimeOptions,
        mountModules: {
          ...(currentRuntimeOptions.mountModules || {}),
          ...((nextRuntimeOptions && nextRuntimeOptions.mountModules) || {})
        },
        mountRouting: mergeMountRouting(
          currentRuntimeOptions.mountRouting || {},
          (nextRuntimeOptions && nextRuntimeOptions.mountRouting) || {}
        )
      });

      const {
        generation: nextGeneration,
        mounts: nextMounts,
        runtimeOptions: effectiveRuntimeOptions
      } = await instantiateMounts(
        normalizedNext,
        settings
      );
      const previousMounts = currentMounts;
      currentMounts = nextMounts;
      currentRuntimeOptions = effectiveRuntimeOptions;
      generation = nextGeneration;
      await closeMounts(previousMounts);
      return createExecutionView();
    });
  }

  async function refreshCurrentMounts({ settings } = {}) {
    return queueOperation(async () => {
      await Promise.all(
        Object.entries(currentMounts).map(async ([mountName, mount]) => {
          if (typeof mount?.reload === "function") {
            await mount.reload({
              settings,
              mountName,
              runtimeOptions: currentRuntimeOptions
            });
          }
        })
      );
      return createExecutionView();
    });
  }

  await applyRuntimeOptions(initialRuntimeOptions);

  return {
    get mounts() {
      return currentMounts;
    },
    get runtimeOptions() {
      return currentRuntimeOptions;
    },
    get generation() {
      return generation;
    },
    createExecutionView,
    async applyMountConfig({ mountModules = {}, mountRouting = {} } = {}, { settings } = {}) {
      return applyRuntimeOptions(
        {
          mountModules: normalizeMountModules(mountModules),
          mountRouting: normalizeMountRouting(mountRouting)
        },
        { settings }
      );
    },
    async reloadMounts({ settings } = {}) {
      return applyRuntimeOptions(
        {
          mountModules: {
            ...(currentRuntimeOptions.mountModules || {})
          }
        },
        { settings }
      );
    },
    async refreshMounts({ settings } = {}) {
      return refreshCurrentMounts({ settings });
    },
    async close() {
      await queueOperation(async () => {
        const mountsToClose = currentMounts;
        currentMounts = {};
        await closeMounts(mountsToClose);
      });
    }
  };
}
