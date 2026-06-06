import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loadSettingsMock = vi.hoisted(() => vi.fn());
const resolveGatewayRuntimePlanMock = vi.hoisted(() => vi.fn());
const cloudDriveConfigPathMock = vi.hoisted(() => vi.fn());
const knowledgeBackendConfigPathMock = vi.hoisted(() => vi.fn());
const spawnSyncMock = vi.hoisted(() => vi.fn());
const spawnMock = vi.hoisted(() => vi.fn(() => {
  throw new Error("spawn should not be called in runtime-dependencies focused tests");
}));

vi.mock("../../../server/platform/common/platform-core/settings.mjs", () => ({
  loadSettings: loadSettingsMock
}));

vi.mock("../../../server/platform/specialized/capabilities/agent/cloud-drive-port/index.mjs", () => ({
  cloudDriveConfigPath: cloudDriveConfigPathMock
}));

vi.mock("../../../server/platform/specialized/capabilities/agent-ingress/traffic-gateway/index.mjs", () => ({
  resolveGatewayRuntimePlan: resolveGatewayRuntimePlanMock
}));

vi.mock("../../../server/platform/specialized/knowledge/storage/knowledge-backend-port/index.mjs", () => ({
  knowledgeBackendConfigPath: knowledgeBackendConfigPathMock
}));

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
  spawnSync: spawnSyncMock
}));

const tempDirs = [];
const commandPaths = new Map();
const commandVersions = new Map();
const realAccessSync = fsSync.accessSync.bind(fsSync);

let workspaceDir = "";
let accessSpy = null;

async function makeTempWorkspace(prefix) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function makeExecutable(name, versionText) {
  const binDir = path.join(workspaceDir, "bin");
  const filePath = path.join(binDir, name);
  await fs.mkdir(binDir, { recursive: true });
  await fs.writeFile(filePath, "#!/bin/sh\n", "utf8");
  await fs.chmod(filePath, 0o755);
  commandPaths.set(name, filePath);
  commandVersions.set(name, versionText);
  return filePath;
}

function resetCommandMocks() {
  commandPaths.clear();
  commandVersions.clear();
  loadSettingsMock.mockResolvedValue({});
  cloudDriveConfigPathMock.mockImplementation((userDataPath = "") => path.join(userDataPath || workspaceDir, "cloud-drive.json"));
  knowledgeBackendConfigPathMock.mockImplementation((userDataPath = "") => path.join(userDataPath || workspaceDir, "knowledge-backend.json"));
  resolveGatewayRuntimePlanMock.mockImplementation(({ adapterId, runtimeUrl, cacheRoot }) => ({
    adapterId,
    runtimeUrl: runtimeUrl || `https://example.invalid/${adapterId}.tgz`,
    executableName: adapterId,
    configuredBinary: "",
    cachedExecutablePath: path.join(cacheRoot || workspaceDir, `${adapterId}.bin`)
  }));
  spawnMock.mockImplementation(() => {
    throw new Error("spawn should not be called in runtime-dependencies focused tests");
  });
  spawnSyncMock.mockImplementation((command, args = []) => {
    const commandName = String(command);
    if (commandName === "sh" && args[0] === "-c") {
      const match = String(args[1] || "").match(/command -v '([^']+)'/);
      const lookupName = match?.[1] || "";
      const filePath = commandPaths.get(lookupName) || "";
      return filePath
        ? { status: 0, signal: null, stdout: `${filePath}\n`, stderr: "" }
        : { status: 1, signal: null, stdout: "", stderr: "" };
    }

    if (commandName === "where" && args.length > 0) {
      const lookupName = String(args[0] || "");
      const filePath = commandPaths.get(lookupName) || "";
      return filePath
        ? { status: 0, signal: null, stdout: `${filePath}\r\n`, stderr: "" }
        : { status: 1, signal: null, stdout: "", stderr: "" };
    }

    const binaryName = path.basename(commandName);
    if (commandPaths.get(binaryName) === commandName) {
      if (binaryName === "docker" && args[0] === "image" && args[1] === "inspect") {
        return { status: 0, signal: null, stdout: "[]\n", stderr: "" };
      }
      if (args.includes("--version") || args.includes("-version") || args.includes("version")) {
        return {
          status: 0,
          signal: null,
          stdout: `${commandVersions.get(binaryName) || ""}\n`,
          stderr: ""
        };
      }
    }

    return { status: 1, signal: null, stdout: "", stderr: "" };
  });
}

function createChildProcess() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  return child;
}

async function withRuntimeDependenciesModule({ platform = process.platform, arch = process.arch } = {}, callback) {
  const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");
  const archDescriptor = Object.getOwnPropertyDescriptor(process, "arch");
  Object.defineProperty(process, "platform", { value: platform });
  Object.defineProperty(process, "arch", { value: arch });
  vi.resetModules();
  try {
    const moduleUrl = new URL(
      `../../../server/platform/specialized/capabilities/runtime-dependencies/index.mjs?platform=${platform}&arch=${arch}&t=${Date.now()}`,
      import.meta.url
    );
    const module = await import(moduleUrl.href);
    return await callback(module);
  } finally {
    if (platformDescriptor) {
      Object.defineProperty(process, "platform", platformDescriptor);
    }
    if (archDescriptor) {
      Object.defineProperty(process, "arch", archDescriptor);
    }
  }
}

beforeEach(async () => {
  workspaceDir = await makeTempWorkspace("pact-runtime-dependencies-focused-extra-2-");
  resetCommandMocks();
  accessSpy = vi.spyOn(fsSync, "accessSync").mockImplementation((targetPath, mode) => {
    const candidate = String(targetPath);
    if (candidate.startsWith(workspaceDir)) {
      return realAccessSync(targetPath, mode);
    }
    const error = new Error(`ENOENT: no such file or directory, access '${candidate}'`);
    error.code = "ENOENT";
    throw error;
  });
});

afterEach(async () => {
  vi.useRealTimers();
  accessSpy?.mockRestore();
  accessSpy = null;
  commandPaths.clear();
  commandVersions.clear();
  const dirs = tempDirs.splice(0);
  await Promise.all(dirs.map((dir) => fs.rm(dir, { force: true, recursive: true })));
});

describe("runtime dependencies focused extra coverage", () => {
  it("writes darwin runtime metadata after recovering from malformed source config JSON", async () => {
    await withRuntimeDependenciesModule({}, async ({ listRuntimeDependencies, runtimeDependencySourceConfigPath }) => {
      const configPath = runtimeDependencySourceConfigPath({ userDataPath: workspaceDir });

      await fs.mkdir(path.dirname(configPath), { recursive: true });
      await fs.writeFile(configPath, "{ not valid json", "utf8");

      const result = await listRuntimeDependencies({
        userDataPath: workspaceDir,
        cacheRoot: path.join(workspaceDir, "cache")
      });

      expect(result.ok).toBe(true);
      expect(result.sourceConfigPath).toBe(configPath);
      const written = JSON.parse(await fs.readFile(configPath, "utf8"));
      expect(written.lastReadError).toContain("Expected property name");
      expect(written.sources.python.default.fileName).toBe("python-3.13.5-macos11.pkg");
      expect(written.sources.jre.default.fileName).toBe("OpenJDK21U-jre_aarch64_mac_hotspot_21.0.10_7.tar.gz");
    });
  });

  it("uses win32/x64 defaults for Python, JRE, Caddy, and gateway source keys", async () => {
    await withRuntimeDependenciesModule({
      platform: "win32",
      arch: "x64"
    }, async ({ listRuntimeDependencies, runtimeDependencySourceConfigPath }) => {
      await makeExecutable("node", "v22.0.0");

      const result = await listRuntimeDependencies({
        userDataPath: workspaceDir,
        cacheRoot: path.join(workspaceDir, "cache"),
        gatewayRuntimeCacheRoot: path.join(workspaceDir, "gateway-cache")
      });

      expect(result.ok).toBe(true);
      expect(result.sourceConfigPath).toBe(runtimeDependencySourceConfigPath({ userDataPath: workspaceDir }));

      const config = JSON.parse(await fs.readFile(result.sourceConfigPath, "utf8"));
      expect(config.sources.python.default.fileName).toBe("python-3.13.5-amd64.exe");
      expect(config.sources.python.default.url).toBe("https://www.python.org/ftp/python/3.13.5/python-3.13.5-amd64.exe");
      expect(config.sources.jre.default.fileName).toBe("jre-win32-x64.tar.gz");
      expect(config.sources.jre.default.url).toBe("");
      expect(config.sources.caddy.default.url).toContain("os=windows");
      expect(config.sources.caddy.default.url).toContain("arch=amd64");

      const python = result.dependencies.find((item) => item.id === "python");
      const jre = result.dependencies.find((item) => item.id === "jre");
      expect(python?.detection.source.kind).toBe("missing");
      expect(jre?.detection.source.kind).toBe("missing");
    });
  });

  it("surfaces macOS version details when sw_vers is available", async () => {
    const { listRuntimeDependencies } = await withRuntimeDependenciesModule({}, async (module) => module);
    accessSpy.mockImplementation((targetPath, mode) => {
      const candidate = String(targetPath);
      if (candidate === "/usr/bin/sw_vers") {
        return undefined;
      }
      if (candidate.startsWith(workspaceDir)) {
        return realAccessSync(targetPath, mode);
      }
      const error = new Error(`ENOENT: no such file or directory, access '${candidate}'`);
      error.code = "ENOENT";
      throw error;
    });
    spawnSyncMock.mockImplementation((command) => {
      if (String(command) === "/usr/bin/sw_vers") {
        return {
          status: 0,
          signal: null,
          stdout: "ProductName: macOS\nRandom line without colon\nProductVersion: 14.6\nBuildVersion: 23G80\n",
          stderr: ""
        };
      }
      return { status: 1, signal: null, stdout: "", stderr: "" };
    });

    const result = await listRuntimeDependencies({
      userDataPath: workspaceDir,
      cacheRoot: path.join(workspaceDir, "cache")
    });

    const cloudDrives = result.dependencies.find((item) => item.id === "cloud-drives");
    expect(cloudDrives?.detection.macos).toMatchObject({
      productName: "macOS",
      productVersion: "14.6",
      buildVersion: "23G80",
      label: "macOS 14.6"
    });
  });

  it("keeps mixed backend images on the image-present path without waiting on sleeps", async () => {
    await withRuntimeDependenciesModule({}, async ({ downloadRuntimeDependency, runtimeDependencySourceConfigPath }) => {
      await makeExecutable("docker", "Docker version 25.0.0");

      const sourceConfigPath = runtimeDependencySourceConfigPath({ userDataPath: workspaceDir });
      await fs.mkdir(path.dirname(sourceConfigPath), { recursive: true });
      await fs.writeFile(
        sourceConfigPath,
        JSON.stringify({
          schemaVersion: 1,
          protocolVersion: "pact.runtime-dependencies.v1",
          sources: {
            dify: {
              images: ["example.invalid/dify:present", "example.invalid/dify:missing"]
            }
          }
        }, null, 2),
        "utf8"
      );
      await fs.mkdir(path.dirname(knowledgeBackendConfigPathMock(workspaceDir)), { recursive: true });
      await fs.writeFile(
        knowledgeBackendConfigPathMock(workspaceDir),
        JSON.stringify({
          providers: {
            dify: {
              enabled: false,
              mode: "contract",
              credentialConfigured: false,
              endpointUrl: ""
            }
          }
        }, null, 2),
        "utf8"
      );

      spawnSyncMock.mockImplementation((command, args = []) => {
        const commandName = String(command);
        if (commandName === "sh" && args[0] === "-c") {
          const match = String(args[1] || "").match(/command -v '([^']+)'/);
          const lookupName = match?.[1] || "";
          const filePath = commandPaths.get(lookupName) || "";
          return filePath
            ? { status: 0, signal: null, stdout: `${filePath}\n`, stderr: "" }
            : { status: 1, signal: null, stdout: "", stderr: "" };
        }
        if (String(commandName) === "docker" && args[0] === "image" && args[1] === "inspect") {
          return String(args[2] || "").includes("present")
            ? { status: 0, signal: null, stdout: "[]\n", stderr: "" }
            : { status: 1, signal: null, stdout: "", stderr: "" };
        }
        return { status: 1, signal: null, stdout: "", stderr: "" };
      });
      spawnMock.mockImplementation((command, args = []) => {
        const child = createChildProcess();
        if (String(command) !== "docker" || args[0] !== "pull") {
          setImmediate(() => child.emit("error", new Error(`unexpected spawn: ${String(command)} ${args.join(" ")}`)));
          return child;
        }
        setImmediate(() => {
          child.stdout.emit("data", "pulling layer\n");
          child.stderr.emit("data", "");
          child.emit("close", 0, null);
        });
        return child;
      });

      const result = await downloadRuntimeDependency({
        userDataPath: workspaceDir,
        targetId: "dify"
      });

      expect(result.ok).toBe(true);
      expect(result.status).toBe("installed");
      expect(result.images).toEqual([
        { image: "example.invalid/dify:present", status: "present", reason: "present" },
        expect.objectContaining({ image: "example.invalid/dify:missing", status: "installed" })
      ]);
    });
  });

  it("uses root default source entries when no platform-specific runtime source exists", async () => {
    await withRuntimeDependenciesModule({
      platform: "linux",
      arch: "x64"
    }, async ({ downloadRuntimeDependency, runtimeDependencySourceConfigPath }) => {
      const configPath = runtimeDependencySourceConfigPath({ userDataPath: workspaceDir });
      await fs.mkdir(path.dirname(configPath), { recursive: true });
      await fs.writeFile(
        configPath,
        JSON.stringify({
          schemaVersion: 1,
          protocolVersion: "pact.runtime-dependencies.v1",
          sources: {
            python: {
              default: {
                url: "https://mirror.example.invalid/python-3.13.5.tgz",
                fileName: "python-default.tgz"
              }
            }
          }
        }, null, 2),
        "utf8"
      );

      const result = await downloadRuntimeDependency({
        userDataPath: workspaceDir,
        targetId: "python",
        dryRun: true
      });

      expect(result.ok).toBe(true);
      expect(result.status).toBe("installed");
      expect(result.planned).toBe(true);
      expect(result.url).toBe("https://mirror.example.invalid/python-3.13.5.tgz");
      expect(path.basename(result.artifactPath)).toBe("python-default.tgz");
    });
  });

  it("returns builtin_source_missing for Docker when no default installer URL is available", async () => {
    await withRuntimeDependenciesModule({
      platform: "linux",
      arch: "x64"
    }, async ({ downloadRuntimeDependency }) => {
      const result = await downloadRuntimeDependency({
        userDataPath: workspaceDir,
        targetId: "docker"
      });

      expect(result.ok).toBe(false);
      expect(result.status).toBe("failed");
      expect(result.reason).toBe("builtin_source_missing");
      expect(result.mirrorRequired).toBe(true);
    });
  });

  it("surfaces downloader subprocess failures as download_failed", async () => {
    spawnMock.mockImplementation(() => {
      const child = createChildProcess();
      setImmediate(() => {
        child.stdout.emit("data", "downloading\n");
        child.emit("close", 1, null);
      });
      return child;
    });

    await withRuntimeDependenciesModule({}, async ({ downloadRuntimeDependency }) => {
      const configPath = path.join(workspaceDir, "runtime", "runtime-dependency-sources.json");
      await fs.mkdir(path.dirname(configPath), { recursive: true });
      await fs.writeFile(
        configPath,
        JSON.stringify({
          schemaVersion: 1,
          protocolVersion: "pact.runtime-dependencies.v1",
          sources: {
            docker: {
              default: {
                url: "https://download.example.invalid/Docker.dmg",
                fileName: "Docker-failure.dmg"
              }
            }
          }
        }, null, 2),
        "utf8"
      );

      const result = await downloadRuntimeDependency({
        userDataPath: workspaceDir,
        targetId: "docker"
      });

      expect(result.ok).toBe(false);
      expect(result.status).toBe("failed");
      expect(result.reason).toBe("download_failed");
      expect(result.mirrorRequired).toBe(true);
      expect(result.commandResult.status).toBe(1);
    });
  });

  it("moves a successfully downloaded Docker artifact into the runtime cache", async () => {
    spawnMock.mockImplementation((_command, args = []) => {
      const child = createChildProcess();
      const outputIndex = args.indexOf("-o");
      const tempPath = outputIndex >= 0 ? args[outputIndex + 1] : "";
      setImmediate(async () => {
        await fs.writeFile(tempPath, "docker installer", "utf8");
        child.stdout.emit("data", "download complete\n");
        child.stderr.emit("data", "curl: reused connection\n");
        child.emit("close", 0, null);
      });
      return child;
    });

    await withRuntimeDependenciesModule({}, async ({ downloadRuntimeDependency, runtimeDependencySourceConfigPath }) => {
      const configPath = runtimeDependencySourceConfigPath({ userDataPath: workspaceDir });
      await fs.mkdir(path.dirname(configPath), { recursive: true });
      await fs.writeFile(
        configPath,
        JSON.stringify({
          schemaVersion: 1,
          protocolVersion: "pact.runtime-dependencies.v1",
          sources: {
            docker: {
              default: {
                url: "https://download.example.invalid/Docker.dmg",
                fileName: "Docker-success.dmg"
              }
            }
          }
        }, null, 2),
        "utf8"
      );

      const result = await downloadRuntimeDependency({
        userDataPath: workspaceDir,
        cacheRoot: path.join(workspaceDir, "cache"),
        targetId: "docker"
      });

      expect(result.ok).toBe(true);
      expect(result.status).toBe("installed");
      expect(path.basename(result.artifactPath)).toBe("Docker-success.dmg");
      expect(await fs.readFile(result.artifactPath, "utf8")).toBe("docker installer");
    });
  });

  it("records downloader startup errors as failed command summaries", async () => {
    spawnMock.mockImplementationOnce(() => {
      const child = createChildProcess();
      setImmediate(() => {
        child.emit("error", new Error("curl not found"));
      });
      return child;
    });

    await withRuntimeDependenciesModule({}, async ({ downloadRuntimeDependency, runtimeDependencySourceConfigPath }) => {
      const configPath = runtimeDependencySourceConfigPath({ userDataPath: workspaceDir });
      await fs.mkdir(path.dirname(configPath), { recursive: true });
      await fs.writeFile(
        configPath,
        JSON.stringify({
          schemaVersion: 1,
          protocolVersion: "pact.runtime-dependencies.v1",
          sources: {
            python: {
              default: {
                url: "https://download.example.invalid/python.tgz",
                fileName: "python-startup-error.tgz"
              }
            }
          }
        }, null, 2),
        "utf8"
      );

      const startupError = await downloadRuntimeDependency({
        userDataPath: workspaceDir,
        cacheRoot: path.join(workspaceDir, "cache"),
        targetId: "python"
      });

      expect(startupError.ok).toBe(false);
      expect(startupError.reason).toBe("download_failed");
      expect(startupError.commandResult.stderr).toContain("curl not found");
    });
  });

  it("runs JRE setup failure and gateway/Gerrit command success paths", async () => {
    spawnMock.mockImplementation((command, args = []) => {
      const child = createChildProcess();
      setImmediate(() => {
        if (String(command) === process.execPath && String(args[0] || "").includes("setup-local-runtime.mjs")) {
          child.stderr.emit("data", "setup failed\n");
          child.emit("close", 1, null);
          return;
        }
        child.stdout.emit("data", "command ok\n");
        child.emit("close", 0, null);
      });
      return child;
    });

    await withRuntimeDependenciesModule({}, async ({ downloadRuntimeDependency, runtimeDependencySourceConfigPath }) => {
      const configPath = runtimeDependencySourceConfigPath({ userDataPath: workspaceDir });
      await fs.mkdir(path.dirname(configPath), { recursive: true });
      await fs.writeFile(
        configPath,
        JSON.stringify({
          schemaVersion: 1,
          protocolVersion: "pact.runtime-dependencies.v1",
          sources: {
            jre: {
              default: {
                url: "https://download.example.invalid/jre.tar.gz",
                fileName: "jre.tar.gz"
              }
            },
            tika: {
              default: {
                url: "https://download.example.invalid/tika.jar",
                fileName: "tika.jar"
              }
            },
            caddy: {
              default: {
                url: "https://download.example.invalid/caddy.tgz"
              }
            },
            gerrit: {
              default: {
                warUrl: "https://download.example.invalid/gerrit.war"
              }
            }
          }
        }, null, 2),
        "utf8"
      );

      const jreFailure = await downloadRuntimeDependency({
        userDataPath: workspaceDir,
        targetId: "jre"
      });
      expect(jreFailure.ok).toBe(false);
      expect(jreFailure.status).toBe("failed");
      expect(jreFailure.commandResult.stderr).toContain("setup failed");

      const caddySuccess = await downloadRuntimeDependency({
        userDataPath: workspaceDir,
        targetId: "caddy",
        gatewayRuntimeCacheRoot: path.join(workspaceDir, "gateway-cache")
      });
      expect(caddySuccess.ok).toBe(true);
      expect(caddySuccess.status).toBe("installed");
      expect(caddySuccess.commandResult.stdout).toContain("command ok");

      const gerritSuccess = await downloadRuntimeDependency({
        userDataPath: workspaceDir,
        targetId: "gerrit",
        version: "3.14.0",
        root: path.join(workspaceDir, "gerrit-root")
      });
      expect(gerritSuccess.ok).toBe(true);
      expect(gerritSuccess.status).toBe("installed");
      expect(gerritSuccess.commandResult.stdout).toContain("command ok");
    });
  });

});
