import fs from "node:fs/promises";
import path from "node:path";
import {
  atomicWriteJson,
  queueStateMutation,
  waitForStateIdle
} from "../platform-core/state-coordinator.mjs";
import { getImportDefaultRoutingTable } from "./import-file-types.mjs";

export const CORE_MOUNT_NAMES = [
  "analysis",
  "ocr",
  "multimodalParser",
  "documentParser",
  "pdfProcessor",
  "knowledgeBase",
  "vectorStore",
  "graphStore"
];

export function normalizeModulePath(value) {
  return String(value || "").trim();
}

export function normalizeMountModules(value = {}) {
  const normalized = Object.fromEntries(
    CORE_MOUNT_NAMES.map((name) => [name, ""])
  );

  for (const [mountName, modulePath] of Object.entries(value || {})) {
    const normalizedName = String(mountName || "").trim();
    if (!normalizedName || normalizedName === "mountRouting") {
      continue;
    }

    normalized[normalizedName] = normalizeModulePath(modulePath);
  }

  return normalized;
}

function normalizeRouteTarget(value = {}, fallbackMountName = "", fallbackAction = "extractDocument") {
  return {
    mountName:
      String(value?.mountName || value?.mount || fallbackMountName || "")
        .trim(),
    action:
      String(value?.action || value?.capability || fallbackAction || "extractDocument")
        .trim() || "extractDocument"
  };
}

export function normalizeMountRouting(value = {}) {
  const {
    kindRoutes: defaultKindRouteTargets,
    extensionRoutes: defaultExtensionRouteTargets,
    mediaTypeRoutes: defaultMediaTypeRouteTargets
  } = getImportDefaultRoutingTable();
  const kindRoutes = {
    ...Object.fromEntries(
      Object.entries(defaultKindRouteTargets).map(([kind, route]) => [
        kind,
        normalizeRouteTarget(value.kindRoutes?.[kind], route.mountName, route.action)
      ])
    )
  };

  const extensionRoutes = Object.fromEntries(
    [
      ...Object.entries(defaultExtensionRouteTargets),
      ...Object.entries(value.extensionRoutes || {})
    ].map(([extension, route]) => [
      String(extension || "").toLowerCase().trim(),
      normalizeRouteTarget(route)
    ])
  );

  const mediaTypeRoutes = Object.fromEntries(
    [
      ...Object.entries(defaultMediaTypeRouteTargets),
      ...Object.entries(value.mediaTypeRoutes || {})
    ].map(([mediaType, route]) => [
      String(mediaType || "").toLowerCase().trim(),
      normalizeRouteTarget(route)
    ])
  );

  return {
    kindRoutes,
    extensionRoutes,
    mediaTypeRoutes
  };
}

export function mergeMountRouting(base = {}, patch = {}) {
  const normalizedBase = normalizeMountRouting(base);
  const normalizedPatch = normalizeMountRouting(patch);
  return {
    kindRoutes: {
      ...(normalizedBase.kindRoutes || {}),
      ...(normalizedPatch.kindRoutes || {})
    },
    extensionRoutes: {
      ...(normalizedBase.extensionRoutes || {}),
      ...(normalizedPatch.extensionRoutes || {})
    },
    mediaTypeRoutes: {
      ...(normalizedBase.mediaTypeRoutes || {}),
      ...(normalizedPatch.mediaTypeRoutes || {})
    }
  };
}

export function getMountModulesConfigPath(userDataPath) {
  return path.join(userDataPath, "mount-modules.json");
}

export function getMountRoutingConfigPath(userDataPath) {
  return path.join(userDataPath, "mount-routing.json");
}

export function getMountConfigPath(userDataPath) {
  return getMountModulesConfigPath(userDataPath);
}

export function getMountConfigPaths(userDataPath) {
  return {
    modulesPath: getMountModulesConfigPath(userDataPath),
    routingPath: getMountRoutingConfigPath(userDataPath)
  };
}

function mountConfigStateKey(userDataPath) {
  return `mount-config:${path.resolve(userDataPath)}`;
}

function normalizeMountConfig(value = {}) {
  const mountModulesSource =
    value?.mountModules && typeof value.mountModules === "object" && !Array.isArray(value.mountModules)
      ? value.mountModules
      : Object.fromEntries(
          Object.entries(value || {}).filter(([key]) => key !== "mountRouting")
        );
  return {
    mountModules: normalizeMountModules(mountModulesSource),
    mountRouting: normalizeMountRouting(value.mountRouting || {})
  };
}

async function loadMountConfigUnlocked(userDataPath) {
  const { modulesPath, routingPath } = getMountConfigPaths(userDataPath);
  let mountModules = null;
  let mountRouting = null;

  try {
    const raw = await fs.readFile(modulesPath, "utf8");
    mountModules = JSON.parse(raw);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }

  try {
    const raw = await fs.readFile(routingPath, "utf8");
    mountRouting = JSON.parse(raw);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }

  return normalizeMountConfig({
    mountModules: mountModules || {},
    mountRouting: mountRouting || {}
  });
}

export async function loadMountConfig(userDataPath) {
  await waitForStateIdle(mountConfigStateKey(userDataPath));
  return loadMountConfigUnlocked(userDataPath);
}

async function saveMountConfigUnlocked(userDataPath, incomingValue = {}) {
  const { modulesPath, routingPath } = getMountConfigPaths(userDataPath);
  const current = await loadMountConfigUnlocked(userDataPath);
  const incomingMountModules =
    incomingValue?.mountModules && typeof incomingValue.mountModules === "object"
      ? incomingValue.mountModules
      : Object.fromEntries(
          Object.entries(incomingValue || {}).filter(([key]) => key !== "mountRouting")
        );
  const next = normalizeMountConfig({
    ...current,
    ...(incomingValue || {}),
    mountModules: {
      ...(current.mountModules || {}),
      ...(incomingMountModules || {})
    },
    mountRouting: mergeMountRouting(
      current.mountRouting || {},
      (incomingValue && incomingValue.mountRouting) || {}
    )
  });

  await atomicWriteJson(modulesPath, next.mountModules, { trailingNewline: false });
  await atomicWriteJson(routingPath, next.mountRouting, { trailingNewline: false });
  return next;
}

export async function saveMountConfig(userDataPath, incomingValue = {}) {
  return queueStateMutation(mountConfigStateKey(userDataPath), () =>
    saveMountConfigUnlocked(userDataPath, incomingValue)
  );
}
