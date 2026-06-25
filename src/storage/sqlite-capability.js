import { execFile } from "node:child_process";
import { createRequire } from "node:module";

export const PACTIUM_SQLITE_PROVIDER_NODE = "node:sqlite";
export const PACTIUM_SQLITE_PROVIDER_BETTER_SQLITE3 = "better-sqlite3";

const require = createRequire(import.meta.url);

function loadOptionalModule(moduleName, required = false) {
  try {
    return require(moduleName);
  } catch (error) {
    /* node:coverage ignore next 3 */
    if (!required) return null;
    throw error;
  }
}

export function loadNodeSqliteModule(required = false) {
  try {
    return require("node:sqlite");
  } catch (error) {
    /* node:coverage ignore next 6 */
    if (!required) return null;
    const wrapped = new Error("SQLite storage backend requires a supported SQLite driver.");
    wrapped.cause = error;
    wrapped.code = "PACTIUM_SQLITE_UNAVAILABLE";
    throw wrapped;
  }
}

function loadBetterSqlite3Module(required = false) {
  return loadOptionalModule("better-sqlite3", required);
}

function defaultResolvePackage(packageName) {
  try {
    return require.resolve(packageName);
  } catch {
    return "";
  }
}

function moduleExport(value) {
  return value?.default || value;
}

export function loadSqliteStorageDriver(required = false, {
  loadNodeSqlite = loadNodeSqliteModule,
  loadBetterSqlite3 = loadBetterSqlite3Module
} = {}) {
  const nodeSqlite = loadNodeSqlite(false);
  if (nodeSqlite?.DatabaseSync) {
    return {
      providerId: PACTIUM_SQLITE_PROVIDER_NODE,
      open(databasePath) {
        return new nodeSqlite.DatabaseSync(databasePath);
      }
    };
  }

  const betterSqlite3 = moduleExport(loadBetterSqlite3(false));
  if (typeof betterSqlite3 === "function") {
    return {
      providerId: PACTIUM_SQLITE_PROVIDER_BETTER_SQLITE3,
      open(databasePath) {
        return new betterSqlite3(databasePath);
      }
    };
  }

  if (!required) return null;
  const error = new Error("SQLite storage backend requires node:sqlite or better-sqlite3.");
  error.code = "PACTIUM_SQLITE_UNAVAILABLE";
  throw error;
}

export function sqliteStorageAvailable(options = {}) {
  return Boolean(loadSqliteStorageDriver(false, options));
}

function versionFromText(text) {
  return String(text || "").trim().split(/\s+/).find(Boolean) || "";
}

function normalizePlatform(platform = process.platform) {
  const value = String(platform || process.platform);
  if (value === "darwin" || value === "win32" || value === "linux") return value;
  return value;
}

function commandProbe({ id, source, command, args = [], platform = "all", packageName = "" }) {
  return { id, source, command, args, platform, packageName };
}

function packageProbe({ id, packageName, storageCapable = false }) {
  return { id, source: "npm", packageName, storageCapable };
}

export function sqliteCapabilityProbePlan({ platform = process.platform } = {}) {
  const normalizedPlatform = normalizePlatform(platform);
  const probes = [
    { id: PACTIUM_SQLITE_PROVIDER_NODE, source: "node", storageCapable: true },
    packageProbe({
      id: `npm:${PACTIUM_SQLITE_PROVIDER_BETTER_SQLITE3}`,
      packageName: PACTIUM_SQLITE_PROVIDER_BETTER_SQLITE3,
      storageCapable: true
    }),
    packageProbe({ id: "npm:sqlite3", packageName: "sqlite3" }),
    commandProbe({ id: "cli:sqlite3", source: "cli", command: "sqlite3", args: ["--version"] })
  ];

  if (normalizedPlatform === "darwin") {
    probes.push(commandProbe({
      id: "brew:sqlite",
      source: "package-manager",
      command: "brew",
      args: ["list", "--versions", "sqlite"],
      platform: "darwin",
      packageName: "sqlite"
    }));
  } else if (normalizedPlatform === "win32") {
    probes.push(commandProbe({
      id: "choco:sqlite",
      source: "package-manager",
      command: "choco",
      args: ["list", "--local-only", "--exact", "sqlite"],
      platform: "win32",
      packageName: "sqlite"
    }));
  } else if (normalizedPlatform === "linux") {
    probes.push(
      commandProbe({
        id: "apt:sqlite3",
        source: "package-manager",
        command: "dpkg-query",
        args: ["-W", "-f=${Version}", "sqlite3"],
        platform: "linux",
        packageName: "sqlite3"
      }),
      commandProbe({
        id: "rpm:sqlite",
        source: "package-manager",
        command: "rpm",
        args: ["-q", "sqlite"],
        platform: "linux",
        packageName: "sqlite"
      }),
      commandProbe({
        id: "pacman:sqlite",
        source: "package-manager",
        command: "pacman",
        args: ["-Q", "sqlite"],
        platform: "linux",
        packageName: "sqlite"
      })
    );
  }

  return probes;
}

function runCommandDefault(command, args = [], { timeoutMs = 750 } = {}) {
  return new Promise((resolve) => {
    execFile(command, args, {
      encoding: "utf8",
      timeout: Math.max(1, Number(timeoutMs || 750)),
      windowsHide: true
    }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        stdout: String(stdout || ""),
        stderr: String(stderr || ""),
        status: typeof error?.code === "number" ? error.code : 0,
        errorCode: typeof error?.code === "string" ? error.code : ""
      });
    });
  });
}

function nodeCapability({ loadNodeSqlite = loadNodeSqliteModule } = {}) {
  let module = null;
  let loadError = null;
  try {
    module = loadNodeSqlite(false);
  } catch (error) {
    loadError = error;
  }
  const available = Boolean(module?.DatabaseSync);
  return {
    id: PACTIUM_SQLITE_PROVIDER_NODE,
    source: "node",
    available,
    storageCapable: available,
    usableByPactium: available,
    providerId: available ? PACTIUM_SQLITE_PROVIDER_NODE : "",
    version: available ? process.versions?.node || "" : "",
    detail: available
      ? "node:sqlite DatabaseSync is available."
      : `node:sqlite DatabaseSync is not available${loadError?.message ? `: ${loadError.message}` : "."}`
  };
}

function npmCapability(probe, {
  resolvePackage = defaultResolvePackage,
  loadBetterSqlite3 = loadBetterSqlite3Module
} = {}) {
  let resolvedPath = "";
  let loadError = null;
  try {
    resolvedPath = resolvePackage(probe.packageName);
  } catch (error) {
    loadError = error;
  }
  let storageCapable = false;
  if (probe.packageName === PACTIUM_SQLITE_PROVIDER_BETTER_SQLITE3 && resolvedPath) {
    try {
      storageCapable = typeof moduleExport(loadBetterSqlite3(false)) === "function";
    } catch (error) {
      loadError = error;
    }
  }
  return {
    id: probe.id,
    source: "npm",
    packageName: probe.packageName,
    available: Boolean(resolvedPath),
    storageCapable,
    usableByPactium: storageCapable,
    providerId: storageCapable ? PACTIUM_SQLITE_PROVIDER_BETTER_SQLITE3 : "",
    path: resolvedPath || "",
    detail: storageCapable
      ? `${probe.packageName} is available as a Pactium SQLite storage provider.`
      : `${probe.packageName} is ${resolvedPath ? "installed" : "not installed"}; no Pactium storage adapter is selected for it${loadError?.message ? `: ${loadError.message}` : "."}`
  };
}

async function commandCapability(probe, { runCommand = runCommandDefault, timeoutMs = 750 } = {}) {
  const result = await runCommand(probe.command, probe.args, { timeoutMs, probe });
  const available = Boolean(result?.ok);
  return {
    id: probe.id,
    source: probe.source,
    platform: probe.platform,
    packageName: probe.packageName || "",
    command: probe.command,
    args: probe.args,
    available,
    storageCapable: false,
    usableByPactium: false,
    version: available ? versionFromText(`${result.stdout}\n${result.stderr}`) : "",
    detail: available
      ? `${probe.id} reports SQLite capability, but this is a system capability signal, not a Pactium storage driver.`
      : `${probe.id} did not report an installed SQLite capability.`,
    status: result?.status ?? 0,
    errorCode: result?.errorCode || ""
  };
}

export async function detectSqliteCapabilities({
  platform = process.platform,
  timeoutMs = 750,
  includeSystem = true,
  resolvePackage = defaultResolvePackage,
  runCommand = runCommandDefault,
  loadNodeSqlite = loadNodeSqliteModule,
  loadBetterSqlite3 = loadBetterSqlite3Module
} = {}) {
  const probes = sqliteCapabilityProbePlan({ platform })
    .filter((probe) => includeSystem || probe.source === "node" || probe.source === "npm");
  const capabilities = [];

  for (const probe of probes) {
    if (probe.source === "node") {
      capabilities.push(nodeCapability({ loadNodeSqlite }));
    } else if (probe.source === "npm") {
      capabilities.push(npmCapability(probe, { resolvePackage, loadBetterSqlite3 }));
    } else {
      capabilities.push(await commandCapability(probe, { runCommand, timeoutMs }));
    }
  }

  const storageProviders = capabilities.filter((capability) => capability.usableByPactium && capability.storageCapable);
  return {
    platform: normalizePlatform(platform),
    sqliteAvailable: capabilities.some((capability) => capability.available),
    storageAvailable: storageProviders.length > 0,
    selectedStorageProvider: storageProviders[0]?.providerId || "",
    capabilities
  };
}
