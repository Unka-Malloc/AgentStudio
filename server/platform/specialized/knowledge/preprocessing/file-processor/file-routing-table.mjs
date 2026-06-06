import {
  getImportExtensionRoutes,
  getImportKindRoutes,
  getImportMediaTypeRoutes,
  getImportDefaultRoutingTable
} from "./import-file-types.mjs";

export const FILE_PROCESSOR_ROUTE_TABLE_VERSION = 2;

export function getFileProcessorDefaultRoutingTable() {
  return getImportDefaultRoutingTable();
}

export function getFileProcessorDefaultExtensionRouteTargets() {
  return getImportExtensionRoutes();
}

export function getFileProcessorDefaultKindRouteTargets() {
  return getImportKindRoutes();
}

export function getFileProcessorDefaultMediaTypeRouteTargets() {
  return getImportMediaTypeRoutes();
}

function createDynamicRouteTargetView(readRoutes) {
  return new Proxy(Object.create(null), {
    get(_target, property) {
      return readRoutes()[property];
    },
    has(_target, property) {
      return property in readRoutes();
    },
    ownKeys() {
      return Reflect.ownKeys(readRoutes());
    },
    getOwnPropertyDescriptor(_target, property) {
      const value = readRoutes()[property];
      return value === undefined
        ? undefined
        : {
            enumerable: true,
            configurable: true,
            value
          };
    }
  });
}

export const FILE_PROCESSOR_DEFAULT_EXTENSION_ROUTE_TARGETS =
  createDynamicRouteTargetView(getFileProcessorDefaultExtensionRouteTargets);

export const FILE_PROCESSOR_DEFAULT_KIND_ROUTE_TARGETS =
  createDynamicRouteTargetView(getFileProcessorDefaultKindRouteTargets);
