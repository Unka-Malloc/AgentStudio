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
  startRuntimeDependencyDownload
} from "../../../server/platform/specialized/capabilities/runtime-dependencies/index.mjs";

const tempDirs = [];
const commandPaths = new Map();
const commandVersions = new Map();
const realAccessSync = fsSync.accessSync.bind(fsSync);

let workspaceDir = "";
let accessSpy = null;

async function makeTempWorkspace() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pact-runtime-dependencies-more-extra-"));
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

function defaultPythonRuntimeUrl() {
  const version = process.env.PACT_PYTHON_RUNTIME_VERSION || "3.13.5";
  if (process.platform === "darwin") {
    return `https://www.python.org/ftp/python/${version}/python-${version}-macos11.pkg`;
  }
  if (process.platform === "win32") {
    return `https://www.python.org/ftp/python/${version}/python-${version}-amd64.exe`;
  }
  return `https://www.python.org/ftp/python/${version}/Python-${version}.tgz`;
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

describe("runtime dependencies more extra coverage", () => {
  it("reports fake PATH executables as present and uses system-path detection", async () => {
    await makeExecutable("docker", "Docker version 25.0.0");
    await makeExecutable("java", "openjdk version \"21.0.1\"");
    await makeExecutable("python3", "Python 3.13.5");
    await makeExecutable("node", "v22.0.0");

    const result = await listRuntimeDependencies({
      userDataPath: workspaceDir,
      cacheRoot: path.join(workspaceDir, "cache")
    });

    expect(result.ok).toBe(true);
    expect(result.summary).toEqual({ total: 10, present: 4, failed: 6 });

    const docker = result.dependencies.find((item) => item.id === "docker");
    const jre = result.dependencies.find((item) => item.id === "jre");
    const python = result.dependencies.find((item) => item.id === "python");
    const node = result.dependencies.find((item) => item.id === "node");

    expect(docker?.detection.source.kind).toBe("system-path");
    expect(jre?.detection.source.kind).toBe("system-path");
    expect(python?.detection.source.kind).toBe("system-path");
    expect(node?.detection.source.kind).toBe("system-path");
  });

  it("uses platform-specific source config overrides in dry-run downloads", async () => {
    const configPath = runtimeDependencySourceConfigPath({ userDataPath: workspaceDir });
    const platformKey = `${process.platform}-${process.arch}`;
    const overrideUrl = "https://mirror.example.invalid/python-platform.tgz";
    const overrideFileName = `python-${platformKey}-mirror.tgz`;

    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(
      configPath,
      JSON.stringify({
        schemaVersion: 1,
        protocolVersion: "pact.runtime-dependencies.v1",
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
    expect(result.url).toBe(overrideUrl);
    expect(path.basename(result.artifactPath)).toBe(overrideFileName);
  });

  it("falls back from malformed source config objects without breaking dry-run download planning", async () => {
    const configPath = runtimeDependencySourceConfigPath({ userDataPath: workspaceDir });
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(
      configPath,
      JSON.stringify({
        schemaVersion: 1,
        protocolVersion: "pact.runtime-dependencies.v1",
        sources: {
          python: null,
          docker: []
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
    expect(result.url).toBe(defaultPythonRuntimeUrl());
  });

  it("normalizes runtime aliases for nodejs, language-runtimes, and rag-flow-backend", async () => {
    await makeExecutable("java", "openjdk version \"21.0.1\"");
    await makeExecutable("python3", "Python 3.13.5");
    await makeExecutable("node", "v22.0.0");

    const nodeAlias = await downloadRuntimeDependency({
      userDataPath: workspaceDir,
      targetId: "nodejs"
    });
    const languageAlias = await downloadRuntimeDependency({
      userDataPath: workspaceDir,
      targetId: "language-runtimes"
    });
    const ragFlowAlias = await downloadRuntimeDependency({
      userDataPath: workspaceDir,
      targetId: "rag-flow-backend"
    });

    expect(nodeAlias.targetId).toBe("node");
    expect(nodeAlias.ok).toBe(true);
    expect(nodeAlias.status).toBe("present");
    expect(nodeAlias.reason).toBe("present");

    expect(languageAlias.targetId).toBe("programming-runtimes");
    expect(languageAlias.ok).toBe(true);
    expect(languageAlias.results).toHaveLength(3);
    expect(languageAlias.results.map((item) => item.targetId)).toEqual(["jre", "python", "node"]);
    expect(languageAlias.results.every((item) => item.ok)).toBe(true);

    expect(ragFlowAlias.targetId).toBe("rag-flow");
    expect(ragFlowAlias.ok).toBe(false);
    expect(ragFlowAlias.status).toBe("failed");
    expect(ragFlowAlias.reason).toBe("provider_config_or_image_source_required");
  });

  it("prunes older background download runs after the limit is exceeded", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    const createdRunIds = new Set();
    const totalRuns = 36;
    for (let i = 0; i < totalRuns; i += 1) {
      const started = await startRuntimeDependencyDownload({
        userDataPath: workspaceDir,
        targetId: `runtime-${String(i).padStart(2, "0")}`
      });
      createdRunIds.add(started.runId);
    }

    const queued = listRuntimeDependencyDownloadRuns().downloads.filter((run) => createdRunIds.has(run.runId));
    expect(queued).toHaveLength(totalRuns);
    expect(queued.every((run) => run.status === "queued")).toBe(true);

    for (let i = 0; i < totalRuns; i += 1) {
      vi.setSystemTime(new Date(Date.parse("2026-01-01T00:00:00.000Z") + (i + 1) * 1000));
      await vi.advanceTimersToNextTimerAsync();
    }

    const downloads = listRuntimeDependencyDownloadRuns().downloads.filter((run) => createdRunIds.has(run.runId));
    expect(downloads.length).toBeLessThanOrEqual(30);
    expect(downloads.length).toBeLessThan(totalRuns);
    expect(downloads.every((run) => run.status === "failed")).toBe(true);
  });
});
