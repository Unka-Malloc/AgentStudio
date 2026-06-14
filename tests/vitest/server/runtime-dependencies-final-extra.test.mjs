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
  throw new Error("spawn should not be called unless a test configures it");
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

import {
  downloadRuntimeDependency,
  listRuntimeDependencies,
  listRuntimeDependencyDownloadRuns,
  runtimeDependencySourceConfigPath,
  startRuntimeDependencyDownload,
  updateRuntimeDependencyConfiguration
} from "../../../server/platform/specialized/capabilities/runtime-dependencies/index.mjs";

const tempDirs = [];
const commandPaths = new Map();
const commandVersions = new Map();
const realAccessSync = fsSync.accessSync.bind(fsSync);
const platformKey = `${process.platform}-${process.arch}`;

let workspaceDir = "";
let accessSpy = null;

async function waitForDownloadRun(runId, predicate, timeoutMs = 3000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const run = listRuntimeDependencyDownloadRuns().downloads.find((item) => item.runId === runId);
    if (run && predicate(run)) {
      return run;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return listRuntimeDependencyDownloadRuns().downloads.find((item) => item.runId === runId);
}

function createChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  return child;
}

async function makeTempWorkspace() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pact-runtime-dependencies-final-extra-"));
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

async function writeSourceConfig(config) {
  const configPath = runtimeDependencySourceConfigPath({ userDataPath: workspaceDir });
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return configPath;
}

function resetCommandMocks() {
  commandPaths.clear();
  commandVersions.clear();
  loadSettingsMock.mockReset();
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
  spawnMock.mockReset();
  spawnMock.mockImplementation(() => {
    throw new Error("spawn should not be called unless a test configures it");
  });
  spawnSyncMock.mockReset();
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

    const binaryName = path.basename(commandName);
    if (commandPaths.get(binaryName) === commandName) {
      if (binaryName === "docker" && args[0] === "image" && args[1] === "inspect") {
        return { status: 1, signal: null, stdout: "", stderr: "" };
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

beforeEach(async () => {
  workspaceDir = await makeTempWorkspace();
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

describe("runtime dependencies final extra coverage", () => {
  it("writes darwin-specific default source config entries", async () => {
    const result = await listRuntimeDependencies({
      userDataPath: workspaceDir,
      cacheRoot: path.join(workspaceDir, "cache")
    });

    expect(result.ok).toBe(true);
    expect(result.dependencies).toHaveLength(10);
    expect(result.summary.total).toBe(10);

    const config = JSON.parse(await fs.readFile(result.sourceConfigPath, "utf8"));
    expect(config.protocolVersion).toBe("v0.0.1:platform:runtime-dependencies-1");
    expect(config.sources.python.default.fileName).toBe("python-3.13.5-macos11.pkg");
    expect(config.sources.python.default.url).toContain("/python/3.13.5/");
    expect(config.sources.jre.default.fileName).toBe("OpenJDK21U-jre_aarch64_mac_hotspot_21.0.10_7.tar.gz");
    expect(config.sources.jre.default.url).toContain("adoptium/temurin21-binaries");
    expect(config.sources.caddy.default.url).toContain("os=darwin");
    expect(config.sources.caddy.default.url).toContain("arch=arm64");
    expect(config.sources.gerrit.mirrors).toHaveLength(1);
  });

  it("falls back to the default artifact filename when a source URL cannot be parsed", async () => {
    const platformArtifactName = `python-${platformKey}`;
    await writeSourceConfig({
      schemaVersion: "v0.0.1:schema:definition-1",
      protocolVersion: "v0.0.1:platform:runtime-dependencies-1",
      sources: {
        python: {
          default: {
            url: "not a valid url",
            fileName: ""
          }
        }
      }
    });

    const result = await downloadRuntimeDependency({
      userDataPath: workspaceDir,
      targetId: "python",
      dryRun: true
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe("installed");
    expect(result.planned).toBe(true);
    expect(path.basename(result.artifactPath)).toBe(platformArtifactName);
    expect(result.url).toBe("not a valid url");
  });

  it("treats an existing Docker installer cache as already available", async () => {
    const configPath = await writeSourceConfig({
      schemaVersion: "v0.0.1:schema:definition-1",
      protocolVersion: "v0.0.1:platform:runtime-dependencies-1",
      sources: {
        docker: {
          default: {
            url: "https://download.example.invalid/Docker.dmg",
            fileName: "Docker-cache.dmg"
          }
        }
      }
    });
    const cachedInstallerPath = path.join(workspaceDir, "runtime", "runtime-dependencies", "docker", "Docker-cache.dmg");
    await fs.mkdir(path.dirname(cachedInstallerPath), { recursive: true });
    await fs.writeFile(cachedInstallerPath, "cached-docker-installer", "utf8");

    const result = await downloadRuntimeDependency({
      userDataPath: workspaceDir,
      targetId: "docker"
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe("installed");
    expect(result.alreadyAvailable).toBe(true);
    expect(result.artifactPath).toBe(cachedInstallerPath);
    expect(result.reason).toBe("artifact_already_available");
    expect(JSON.parse(await fs.readFile(configPath, "utf8")).sources.docker.default.fileName).toBe("Docker-cache.dmg");
  });

  it("keeps a dry-run Gerrit plan available even when the WAR URL is blank", async () => {
    await writeSourceConfig({
      schemaVersion: "v0.0.1:schema:definition-1",
      protocolVersion: "v0.0.1:platform:runtime-dependencies-1",
      sources: {
        gerrit: {
          default: {
            warUrl: ""
          }
        }
      }
    });

    const result = await downloadRuntimeDependency({
      userDataPath: workspaceDir,
      targetId: "gerrit",
      dryRun: true,
      version: "3.14.0",
      root: path.join(workspaceDir, "gerrit-root")
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe("installed");
    expect(result.planned).toBe(true);
    expect(result.command).toEqual([
      process.execPath,
      "server/scripts/gerrit-local.mjs",
      "download"
    ]);
  });

  it("records a failed background run when a backend target has no provider or images", async () => {
    const queued = await startRuntimeDependencyDownload({
      userDataPath: workspaceDir,
      targetId: "dify"
    });

    expect(queued.status).toBe("queued");
    expect(queued.run.status).toBe("queued");

    await new Promise((resolve) => setTimeout(resolve, 25));

    const run = listRuntimeDependencyDownloadRuns().downloads.find((item) => item.runId === queued.runId);
    expect(run).toMatchObject({
      runId: queued.runId,
      targetId: "dify",
      status: "failed",
      ok: false
    });
    expect(run?.latestMessage).toBe("安装流程失败。");
    expect(run?.result).toMatchObject({
      ok: false,
      targetId: "dify",
      status: "failed",
      reason: "provider_config_or_image_source_required"
    });
    expect(run?.steps.some((step) => step.status === "failed")).toBe(true);
    expect(run?.progressPercent).toBeGreaterThan(0);
  });

  it("resolves platform-specific overrides and cached artifacts without spawning", async () => {
    const overrideUrl = "https://mirror.example.invalid/python-platform.tgz";
    const overrideFileName = `python-${platformKey}-mirror.tgz`;
    const configPath = await writeSourceConfig({
      schemaVersion: "v0.0.1:schema:definition-1",
      protocolVersion: "v0.0.1:platform:runtime-dependencies-1",
      sources: {
        python: {
          default: {
            url: "https://default.example.invalid/python-default.tgz",
            fileName: "python-default.tgz"
          },
          [platformKey]: {
            url: overrideUrl,
            fileName: overrideFileName
          }
        }
      }
    });
    const artifactPath = path.join(workspaceDir, "runtime", "runtime-dependencies", "python", overrideFileName);
    await fs.mkdir(path.dirname(artifactPath), { recursive: true });
    await fs.writeFile(artifactPath, "cached-artifact", "utf8");

    const result = await downloadRuntimeDependency({
      userDataPath: workspaceDir,
      targetId: "python"
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe("installed");
    expect(result.alreadyAvailable).toBe(true);
    expect(result.artifactPath).toBe(artifactPath);
  });

  it("returns mirror guidance for missing builtin sources and surfaces curl failures", async () => {
    await writeSourceConfig({
      schemaVersion: "v0.0.1:schema:definition-1",
      protocolVersion: "v0.0.1:platform:runtime-dependencies-1",
      sources: {
        caddy: {
          default: {
            url: "",
            fileName: "caddy-missing.tar.gz"
          }
        },
        python: {
          default: {
            url: "https://download.example.invalid/python.tgz",
            fileName: "python.tgz"
          }
        }
      }
    });

    const missingSource = await downloadRuntimeDependency({
      userDataPath: workspaceDir,
      targetId: "caddy"
    });

    expect(missingSource.ok).toBe(false);
    expect(missingSource.status).toBe("failed");
    expect(missingSource.reason).toBe("builtin_source_missing");
    expect(missingSource.mirrorRequired).toBe(true);
    expect(missingSource.sourceConfigPath).toBe(runtimeDependencySourceConfigPath({ userDataPath: workspaceDir }));

    spawnMock.mockImplementation((command, args = []) => {
      const child = createChild();
      if (String(command) !== "curl") {
        setImmediate(() => child.emit("error", new Error(`unexpected spawn: ${String(command)} ${args.join(" ")}`)));
        return child;
      }
      setImmediate(() => {
        child.stderr.emit("data", "curl: (7) Failed to connect\n");
        child.emit("close", 1, null);
      });
      return child;
    });

    const failedDownload = await downloadRuntimeDependency({
      userDataPath: workspaceDir,
      targetId: "python"
    });

    expect(failedDownload.ok).toBe(false);
    expect(failedDownload.status).toBe("failed");
    expect(failedDownload.reason).toBe("download_failed");
    expect(failedDownload.mirrorRequired).toBe(true);
    expect(failedDownload.commandResult).toMatchObject({ status: 1 });
    expect(failedDownload.command).toEqual([
      "curl",
      "-L",
      "--fail",
      "-o",
      path.join(workspaceDir, "runtime", "runtime-dependencies", "python", "python.tgz"),
      "https://download.example.invalid/python.tgz"
    ]);
  });

  it("completes a mocked JRE install and refreshes detection after setup-local-runtime", async () => {
    const testJavaPath = path.join(workspaceDir, "runtime", "jre", "bin", "java");
    const testTikaPath = path.join(workspaceDir, "runtime", "tika", "tika.jar");
    loadSettingsMock
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        javaBinPath: testJavaPath,
        tikaJarPath: testTikaPath
      });

    spawnMock.mockImplementation((command, args = []) => {
      const child = createChild();
      if (String(command) !== process.execPath || !String(args[0] || "").includes("setup-local-runtime.mjs")) {
        setImmediate(() => child.emit("error", new Error(`unexpected spawn: ${String(command)} ${args.join(" ")}`)));
        return child;
      }
      setImmediate(() => {
        fsSync.mkdirSync(path.dirname(testJavaPath), { recursive: true });
        fsSync.writeFileSync(testJavaPath, "#!/bin/sh\n");
        fsSync.chmodSync(testJavaPath, 0o755);
        fsSync.mkdirSync(path.dirname(testTikaPath), { recursive: true });
        fsSync.writeFileSync(testTikaPath, "tika-jar");
        child.stdout.emit("data", "setup complete\n");
        child.emit("close", 0, null);
      });
      return child;
    });

    const result = await downloadRuntimeDependency({
      userDataPath: workspaceDir,
      targetId: "jre"
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe("installed");
    expect(result.before.present).toBe(false);
    expect(result.detection.present).toBe(true);
    expect(result.detection.detection.javaPath).toBe(testJavaPath);
    expect(result.commandResult).toMatchObject({ status: 0 });
  });

  it("tracks queued and completed states for background dry-run installs", async () => {
    const queued = await startRuntimeDependencyDownload({
      userDataPath: workspaceDir,
      targetId: "python",
      dryRun: true
    });

    expect(queued.status).toBe("queued");
    expect(queued.run.status).toBe("queued");
    const initialRun = listRuntimeDependencyDownloadRuns().downloads.find((item) => item.runId === queued.runId);
    expect(initialRun).toMatchObject({
      runId: queued.runId,
      status: "queued"
    });

    const finalRun = await waitForDownloadRun(
      queued.runId,
      (run) => run.status === "installed" && run.progressPercent === 100
    );
    expect(finalRun).toMatchObject({
      runId: queued.runId,
      status: "installed",
      ok: true,
      progressPercent: 100
    });
    expect(finalRun.steps.every((step) => step.status === "completed")).toBe(true);
    expect(finalRun.latestMessage).toContain("安装流程结束");
  });

  it("pulls knowledge backend images when Docker is ready and falls back cleanly when it is not", async () => {
    await makeExecutable("docker", "Docker version 25.0.0");
    spawnMock.mockImplementation((command, args = []) => {
      const child = createChild();
      if (String(command) !== "docker" || args[0] !== "pull") {
        setImmediate(() => child.emit("error", new Error(`unexpected spawn: ${String(command)} ${args.join(" ")}`)));
        return child;
      }
      setImmediate(() => {
        child.stdout.emit("data", `pulled ${args[1]}\n`);
        child.emit("close", 0, null);
      });
      return child;
    });

    await writeSourceConfig({
      schemaVersion: "v0.0.1:schema:definition-1",
      protocolVersion: "v0.0.1:platform:runtime-dependencies-1",
      sources: {
        dify: {
          images: ["example.invalid/dify:latest"],
          mirrorPrefix: ""
        }
      }
    });

    const pulled = await downloadRuntimeDependency({
      userDataPath: workspaceDir,
      targetId: "dify"
    });

    expect(pulled.ok).toBe(true);
    expect(pulled.status).toBe("installed");
    expect(pulled.detection.present).toBe(false);
    expect(pulled.images).toEqual([
      expect.objectContaining({
        image: "example.invalid/dify:latest",
        status: "installed"
      })
    ]);

    commandPaths.delete("docker");
    const dockerMissing = await downloadRuntimeDependency({
      userDataPath: workspaceDir,
      targetId: "dify"
    });

    expect(dockerMissing.ok).toBe(false);
    expect(dockerMissing.status).toBe("failed");
    expect(dockerMissing.reason).toBe("docker_required_for_container_image_download");
    expect(dockerMissing.nextTarget).toBe("docker");
  });

  it("normalizes malformed source configs and array-style updates", async () => {
    const configPath = runtimeDependencySourceConfigPath({ userDataPath: workspaceDir });
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, "{not valid json", "utf8");

    const listed = await listRuntimeDependencies({
      userDataPath: workspaceDir,
      cacheRoot: path.join(workspaceDir, "cache")
    });

    expect(listed.ok).toBe(true);
    expect(listed.sourceConfigPath).toBe(configPath);
    expect(listed.summary.total).toBe(10);

    const normalized = JSON.parse(await fs.readFile(configPath, "utf8"));
    expect(normalized.lastReadError).toContain("JSON");
    expect(normalized.sources.dify).toBeTruthy();
    expect(normalized.sources["rag-flow"]).toBeTruthy();

    const update = await updateRuntimeDependencyConfiguration({
      userDataPath: workspaceDir,
      entries: [
        { key: "sources.dify.images", value: ["example.invalid/dify:1", "example.invalid/dify:2"] },
        { key: "sources.rag-flow.images", value: "example.invalid/rag-flow:1,\nexample.invalid/rag-flow:2" },
        { key: "sources.gerrit.mirrors", value: ["https://mirror.one.invalid/gerrit.war", "https://mirror.two.invalid/gerrit.war"] },
        { key: "sources.dify.mirrorPrefix", value: "https://mirror.example.invalid/dify" }
      ]
    });

    expect(update.ok).toBe(true);
    expect(update.updated).toBe(4);

    const rewritten = JSON.parse(await fs.readFile(configPath, "utf8"));
    expect(rewritten.sources.dify.images).toEqual([
      "example.invalid/dify:1",
      "example.invalid/dify:2"
    ]);
    expect(rewritten.sources["rag-flow"].images).toEqual([
      "example.invalid/rag-flow:1",
      "example.invalid/rag-flow:2"
    ]);
    expect(rewritten.sources.gerrit.mirrors).toEqual([
      "https://mirror.one.invalid/gerrit.war",
      "https://mirror.two.invalid/gerrit.war"
    ]);
    expect(rewritten.sources.dify.mirrorPrefix).toBe("https://mirror.example.invalid/dify");
  });

  it("summarizes cached installs separately from present dependencies", async () => {
    await writeSourceConfig({
      schemaVersion: "v0.0.1:schema:definition-1",
      protocolVersion: "v0.0.1:platform:runtime-dependencies-1",
      sources: {
        docker: {
          default: {
            url: "https://download.example.invalid/Docker.dmg",
            fileName: "Docker-cache.dmg"
          }
        }
      }
    });

    const cachedInstallerPath = path.join(workspaceDir, "cache", "docker", "Docker-cache.dmg");
    await fs.mkdir(path.dirname(cachedInstallerPath), { recursive: true });
    await fs.writeFile(cachedInstallerPath, "cached-docker-installer", "utf8");

    const result = await listRuntimeDependencies({
      userDataPath: workspaceDir,
      cacheRoot: path.join(workspaceDir, "cache")
    });

    expect(result.ok).toBe(true);
    expect(result.summary).toMatchObject({
      total: 10,
      installed: 1
    });

    const docker = result.dependencies.find((item) => item.id === "docker");
    expect(docker).toMatchObject({
      id: "docker",
      status: "installed",
      cached: true
    });
    expect(docker?.detection.installerCached).toBe(true);
    expect(docker?.actions.download).toBe("already-installed");
  });

  it("combines provider-ready and manifest-backed knowledge backends", async () => {
    await makeExecutable("docker", "Docker version 25.0.0");
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

      const binaryName = path.basename(commandName);
      if (binaryName === "docker") {
        if (args[0] === "image" && args[1] === "inspect" && args[2] === "example.invalid/rag-flow:latest") {
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

      if (commandPaths.get(binaryName) === commandName) {
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

    const knowledgeConfigPath = path.join(workspaceDir, "knowledge-backend.json");
    await fs.writeFile(
      knowledgeConfigPath,
      JSON.stringify({
        providers: {
          dify: {
            enabled: true,
            mode: "manual",
            credentialConfigured: true,
            endpointUrl: "https://dify.example.invalid"
          }
        }
      }, null, 2),
      "utf8"
    );

    await writeSourceConfig({
      schemaVersion: "v0.0.1:schema:definition-1",
      protocolVersion: "v0.0.1:platform:runtime-dependencies-1",
      sources: {
        dify: {
          images: [],
          mirrorPrefix: ""
        },
        "rag-flow": {
          images: ["example.invalid/rag-flow:latest"],
          mirrorPrefix: ""
        }
      }
    });

    const result = await downloadRuntimeDependency({
      userDataPath: workspaceDir,
      targetId: "knowledge-backends"
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe("present");
    expect(result.results).toHaveLength(2);
    expect(result.results[0]).toMatchObject({
      targetId: "dify",
      status: "present",
      reason: "present_or_configured"
    });
    expect(result.results[1]).toMatchObject({
      targetId: "rag-flow",
      status: "present"
    });
    expect(result.results[1].detection.detection.images).toEqual([
      expect.objectContaining({
        image: "example.invalid/rag-flow:latest",
        present: true
      })
    ]);
  });

  it("normalizes target aliases and surfaces node verification failure for boundary input", async () => {
    await expect(downloadRuntimeDependency({
      userDataPath: workspaceDir,
      targetId: "   "
    })).rejects.toThrow("Unsupported runtime dependency target: (empty)");

    const aliasResult = await downloadRuntimeDependency({
      userDataPath: workspaceDir,
      targetId: "NODEJS"
    });

    expect(aliasResult.ok).toBe(true);
    expect(aliasResult.targetId).toBe("node");
    expect(aliasResult.status).toBe("present");

    const originalExecPath = process.execPath;
    Object.defineProperty(process, "execPath", {
      value: "",
      configurable: true,
      writable: true
    });

    try {
      const failed = await downloadRuntimeDependency({
        userDataPath: workspaceDir,
        targetId: "node"
      });

      expect(failed.ok).toBe(false);
      expect(failed.status).toBe("failed");
      expect(failed.reason).toBe("node_runtime_missing");
    } finally {
      Object.defineProperty(process, "execPath", {
        value: originalExecPath,
        configurable: true,
        writable: true
      });
    }
  });
});
