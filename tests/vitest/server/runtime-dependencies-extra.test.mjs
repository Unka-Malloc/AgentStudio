import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loadSettingsMock = vi.hoisted(() => vi.fn());
const resolveGatewayRuntimePlanMock = vi.hoisted(() => vi.fn());
const cloudDriveConfigPathMock = vi.hoisted(() => vi.fn());
const knowledgeBackendConfigPathMock = vi.hoisted(() => vi.fn());
const spawnSyncMock = vi.hoisted(() => vi.fn());
const spawnMock = vi.hoisted(() => vi.fn(() => {
  throw new Error("spawn should not be called in runtime-dependencies unit tests");
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

let workspaceDir = "";
let accessSpy = null;

async function makeTempWorkspace() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pact-runtime-dependencies-extra-"));
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
    throw new Error("spawn should not be called in runtime-dependencies unit tests");
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

describe("runtime dependencies extra coverage", () => {
  it("derives the runtime source config path from the user data root", () => {
    expect(runtimeDependencySourceConfigPath({ userDataPath: "/tmp/pact-runtime-data" })).toBe(
      "/tmp/pact-runtime-data/runtime/runtime-dependency-sources.json"
    );
  });

  it("lists dependencies and writes the default source config without touching real subprocesses", async () => {
    await makeExecutable("docker", "Docker version 25.0.0");
    await makeExecutable("java", "openjdk version \"21.0.1\"");
    await makeExecutable("python3", "Python 3.13.5");
    await makeExecutable("node", "v22.0.0");

    const result = await listRuntimeDependencies({
      userDataPath: workspaceDir,
      cacheRoot: path.join(workspaceDir, "cache")
    });

    expect(result.ok).toBe(true);
    expect(result.sourceConfigPath).toBe(runtimeDependencySourceConfigPath({ userDataPath: workspaceDir }));
    expect(result.summary).toEqual({ total: 10, present: 4, failed: 6 });
    expect(result.downloads).toEqual([]);

    const docker = result.dependencies.find((item) => item.id === "docker");
    expect(docker?.status).toBe("present");
    expect(docker?.configuration[0]).toMatchObject({
      kind: "path",
      title: "平台目录"
    });
    expect(
      docker?.configuration[0]?.entries.find((entry) => entry.key === "runtimeDependencySourceConfig")?.value
    ).toBe(result.sourceConfigPath);

    const sourceConfig = JSON.parse(await fs.readFile(result.sourceConfigPath, "utf8"));
    expect(sourceConfig.protocolVersion).toBe("pact.runtime-dependencies.v1");
    expect(sourceConfig.sources.gerrit.default.warUrl).toContain("gerrit-war");
    expect(sourceConfig.sources.python.default.url).toContain("python.org");
    expect(sourceConfig.sources.caddy.default.url).toContain("caddyserver.com/api/download");
  });

  it("updates source config entries and preserves existing nested fields", async () => {
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
              fileName: "Docker-custom.dmg"
            }
          }
        }
      }, null, 2),
      "utf8"
    );

    const update = await updateRuntimeDependencyConfiguration({
      userDataPath: workspaceDir,
      entries: [
        { key: "sources.docker.url", value: "https://mirror.example.invalid/Docker.dmg" },
        { key: "sources.python.mirrors", value: "https://mirror.one.invalid/python.tgz,\nhttps://mirror.two.invalid/python.tgz" },
        { key: "sources.gerrit.warUrl", value: "https://mirror.example.invalid/gerrit.war" }
      ]
    });

    expect(update.ok).toBe(true);
    expect(update.updated).toBe(3);
    expect(update.sourceConfigPath).toBe(configPath);

    const written = JSON.parse(await fs.readFile(configPath, "utf8"));
    expect(written.updatedAt).toBeTruthy();
    expect(written.sources.docker.default.fileName).toBe("Docker-custom.dmg");
    expect(written.sources.docker.default.url).toBe("https://mirror.example.invalid/Docker.dmg");
    expect(written.sources.python.mirrors).toEqual([
      "https://mirror.one.invalid/python.tgz",
      "https://mirror.two.invalid/python.tgz"
    ]);
    expect(written.sources.gerrit.default.warUrl).toBe("https://mirror.example.invalid/gerrit.war");
  });

  it("rejects invalid configuration updates and unsupported download targets", async () => {
    await expect(updateRuntimeDependencyConfiguration({
      userDataPath: workspaceDir,
      entries: []
    })).rejects.toThrow("Runtime dependency configuration update requires entries.");

    await expect(updateRuntimeDependencyConfiguration({
      userDataPath: workspaceDir,
      entries: [{ key: "sources.unknown.url", value: "https://example.invalid" }]
    })).rejects.toThrow("Unsupported runtime dependency source target: unknown");

    await expect(downloadRuntimeDependency({ userDataPath: workspaceDir, targetId: "not-real" }))
      .rejects.toThrow("Unsupported runtime dependency target: not-real");

    await expect(startRuntimeDependencyDownload({ userDataPath: workspaceDir }))
      .rejects.toThrow("Unsupported runtime dependency target: (empty)");
  });

  it("returns a planned dry-run install for Gerrit without invoking downloader subprocesses", async () => {
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

  it("tracks a background run from queued to completed", async () => {
    await makeExecutable("node", "v22.0.0");

    const queued = await startRuntimeDependencyDownload({
      userDataPath: workspaceDir,
      targetId: "node",
      cacheRoot: path.join(workspaceDir, "cache")
    });

    expect(queued.ok).toBe(true);
    expect(queued.status).toBe("queued");
    expect(queued.reason).toBe("background_install_started");
    expect(queued.run?.status).toBe("queued");

    expect(listRuntimeDependencyDownloadRuns().downloads).toHaveLength(1);

    for (let i = 0; i < 10; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      const current = listRuntimeDependencyDownloadRuns().downloads[0];
      if (current && current.status !== "queued" && current.status !== "running") {
        break;
      }
    }

    const runs = listRuntimeDependencyDownloadRuns().downloads;
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("present");
    expect(runs[0].ok).toBe(true);
    expect(runs[0].progressPercent).toBe(100);
    expect(runs[0].currentStepKey).toBe("complete");
    expect(runs[0].result?.status).toBe("present");
  });

  it("rebuilds invalid source config files using defaults and records the parse error", async () => {
    const configPath = runtimeDependencySourceConfigPath({ userDataPath: workspaceDir });
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, "not-json", "utf8");

    const result = await listRuntimeDependencies({ userDataPath: workspaceDir });

    expect(result.sourceConfigPath).toBe(configPath);
    const written = JSON.parse(await fs.readFile(configPath, "utf8"));
    expect(written.lastReadError).toContain("Unexpected token");
    expect(written.protocolVersion).toBe("pact.runtime-dependencies.v1");
    expect(result.summary.total).toBe(10);
  });

  it("updates array-backed source fields and scalar runtime fields in one pass", async () => {
    const update = await updateRuntimeDependencyConfiguration({
      userDataPath: workspaceDir,
      entries: [
        { key: "sources.dify.images", value: ["img-one", "", null, "img-two"] },
        { key: "sources.dify.mirrorPrefix", value: "  runtime://mirror " },
        { key: "sources.python.url", value: "https://example.invalid/python-1.tgz" }
      ]
    });

    expect(update.ok).toBe(true);
    expect(update.updated).toBe(3);

    const sourceConfigPath = runtimeDependencySourceConfigPath({ userDataPath: workspaceDir });
    const written = JSON.parse(await fs.readFile(sourceConfigPath, "utf8"));
    expect(written.sources.dify.images).toEqual(["img-one", "img-two"]);
    expect(written.sources.dify.mirrorPrefix).toBe("runtime://mirror");
    expect(written.sources.python.default?.url).toEqual("https://example.invalid/python-1.tgz");
  });

  it("supports runtime-target aliases and dry-run jre path", async () => {
    await updateRuntimeDependencyConfiguration({
      userDataPath: workspaceDir,
      entries: [{ key: "sources.jre.url", value: "" }]
    });

    const javaAliasResult = await downloadRuntimeDependency({
      userDataPath: workspaceDir,
      targetId: "java",
      dryRun: true
    });

    expect(javaAliasResult.targetId).toBe("jre");
    expect(javaAliasResult.ok).toBe(false);
    expect(javaAliasResult.status).toBe("failed");
    expect(javaAliasResult.reason).toBe("builtin_jre_source_missing");
  });

  it("supports gateway dry-run branches for caddy/nginx and includes ready-to-run command", async () => {
    const caddyDryRun = await downloadRuntimeDependency({
      userDataPath: workspaceDir,
      targetId: "caddy",
      dryRun: true
    });
    const nginxDryRun = await downloadRuntimeDependency({
      userDataPath: workspaceDir,
      targetId: "nginx",
      dryRun: true
    });

    expect(caddyDryRun.targetId).toBe("caddy");
    expect(caddyDryRun.planned).toBe(true);
    expect(caddyDryRun.command?.[0]).toBe("node");
    expect(caddyDryRun.command).toContain("runtime-pull");

    expect(nginxDryRun.targetId).toBe("nginx");
    expect(nginxDryRun.planned).toBe(true);
    expect(nginxDryRun.command?.[0]).toBe("node");
    expect(nginxDryRun.command).toContain("runtime-pull");
  });

  it("returns a failed knowledge backend branch for missing runtime images", async () => {
    const knowledgeResult = await downloadRuntimeDependency({
      userDataPath: workspaceDir,
      targetId: "dify"
    });

    expect(knowledgeResult.targetId).toBe("dify");
    expect(knowledgeResult.ok).toBe(false);
    expect(knowledgeResult.status).toBe("failed");
    expect(knowledgeResult.reason).toBe("provider_config_or_image_source_required");
  });

  it("supports async runtime download dispatch through downloadRuntimeDependency", async () => {
    await makeExecutable("node", "v22.0.0");

    const queued = await downloadRuntimeDependency({
      userDataPath: workspaceDir,
      targetId: "node",
      async: true
    });

    expect(queued.ok).toBe(true);
    expect(queued.status).toBe("queued");
    expect(queued.reason).toBe("background_install_started");

    for (let i = 0; i < 10; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      const runs = listRuntimeDependencyDownloadRuns().downloads;
      if (runs[0] && runs[0].status !== "queued" && runs[0].status !== "running") {
        break;
      }
    }
  });

  it("exposes failed cloud-drive state and dry-run all-target orchestration path", async () => {
    const cloudDrivesResult = await downloadRuntimeDependency({
      userDataPath: workspaceDir,
      targetId: "cloud-drives"
    });
    expect(cloudDrivesResult.targetId).toBe("cloud-drives");
    expect(cloudDrivesResult.ok).toBe(false);
    expect(cloudDrivesResult.status).toBe("failed");
    expect(cloudDrivesResult.reason).toBe("cloud_drive_adapters_require_local_folder_or_oauth_authorization");

    const allResult = await downloadRuntimeDependency({
      userDataPath: workspaceDir,
      targetId: "all",
      dryRun: true
    });
    expect(allResult.targetId).toBe("all");
    expect(allResult.results).toBeTruthy();
    expect(allResult.results.length).toBe(10);
    expect(allResult.results.some((result) => result.targetId === "dify")).toBe(true);
    expect(allResult.results.some((result) => result.targetId === "rag-flow")).toBe(true);
    expect(allResult.results.some((result) => result.targetId === "caddy")).toBe(true);
    expect(allResult.results.some((result) => result.targetId === "gerrit")).toBe(true);
  });
});
