#!/usr/bin/env node
import { execFile } from "node:child_process";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 15_000;
const VERIFY_MODE_ENV = "PACT_EXTERNAL_SERVICE_VERIFY_MODE";

export function normalizeVerifyMode(value = "") {
  const mode = String(value || "").trim().toLowerCase();
  if (mode === "docker") {
    return "container";
  }
  if (mode === "container" || mode === "local" || mode === "auto") {
    return mode;
  }
  return "auto";
}

export function requestedVerifyMode() {
  return normalizeVerifyMode(process.env[VERIFY_MODE_ENV] || process.env.PACT_VERIFY_SERVICE_MODE || "auto");
}

export function repoRootFrom(importMetaUrl) {
  return path.resolve(new URL("..", importMetaUrl).pathname, "..");
}

export function run(command, args = [], options = {}) {
  return execFileAsync(command, args, {
    cwd: options.cwd || process.cwd(),
    env: { ...process.env, ...(options.env || {}) },
    timeout: options.timeoutMs || DEFAULT_TIMEOUT_MS,
    maxBuffer: options.maxBuffer || 20 * 1024 * 1024
  });
}

export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = address && typeof address === "object" ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

export function containerName(prefix = "pact-external-service") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function probeCommand(command, args = ["--version"], options = {}) {
  try {
    const result = await run(command, args, {
      timeoutMs: options.timeoutMs || 5000,
      cwd: options.cwd || process.cwd()
    });
    return {
      ok: true,
      command,
      stdout: String(result.stdout || "").trim(),
      stderr: String(result.stderr || "").trim()
    };
  } catch (error) {
    return {
      ok: false,
      command,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export const dockerContainerName = containerName;

export async function probeContainerRuntime() {
  const candidates = [
    {
      engine: "docker",
      command: "docker",
      versionArgs: ["version", "--format", "{{.Server.Version}}"]
    },
    {
      engine: "podman",
      command: "podman",
      versionArgs: ["version", "--format", "{{.Client.Version}}"]
    }
  ];
  const attempts = [];
  for (const candidate of candidates) {
    const probe = await probeCommand(candidate.command, candidate.versionArgs, { timeoutMs: 10_000 });
    attempts.push({
      engine: candidate.engine,
      command: candidate.command,
      ok: probe.ok,
      stdout: probe.stdout,
      stderr: probe.stderr,
      error: probe.error || ""
    });
    if (probe.ok) {
      return {
        available: true,
        engine: candidate.engine,
        command: candidate.command,
        version: probe.stdout,
        attempts
      };
    }
  }
  return {
    available: false,
    engine: "",
    command: "",
    version: "",
    attempts,
    error: attempts.map((attempt) => `${attempt.engine}: ${attempt.error || attempt.stderr || "unavailable"}`).join("; ")
  };
}

export async function probeDocker() {
  const probe = await probeCommand("docker", ["version", "--format", "{{.Server.Version}}"], { timeoutMs: 10_000 });
  return {
    ...probe,
    available: probe.ok,
    serverVersion: probe.ok ? probe.stdout : ""
  };
}

export async function probeNode() {
  const probe = await probeCommand(process.execPath, ["--version"]);
  return {
    ...probe,
    available: probe.ok,
    executable: process.execPath,
    version: probe.ok ? probe.stdout : ""
  };
}

export async function probePython() {
  const candidates = process.platform === "win32" ? ["py", "python", "python3"] : ["python3", "python"];
  for (const candidate of candidates) {
    const versionProbe = await probeCommand(candidate, ["--version"]);
    if (!versionProbe.ok) {
      continue;
    }
    const venvProbe = await probeCommand(candidate, ["-c", "import venv, ensurepip; print('ok')"]);
    return {
      available: venvProbe.ok,
      command: candidate,
      version: versionProbe.stdout || versionProbe.stderr,
      venv: venvProbe.ok,
      error: venvProbe.ok ? "" : venvProbe.error
    };
  }
  return {
    available: false,
    command: "",
    version: "",
    venv: false,
    error: "python3/python with venv and ensurepip is not available."
  };
}

function localProbeForKind(kind, probes) {
  if (kind === "http") {
    return {
      available: probes.node.available,
      runtime: "node",
      executable: probes.node.executable,
      reason: probes.node.available ? "" : probes.node.error
    };
  }
  if (kind === "mcp") {
    return {
      available: probes.python.available && probes.python.venv,
      runtime: "python",
      executable: probes.python.command,
      reason: probes.python.available && probes.python.venv ? "" : probes.python.error
    };
  }
  return {
    available: false,
    runtime: "",
    executable: "",
    reason: `Unsupported external service verification kind: ${kind}`
  };
}

export async function probeExternalServiceRuntime({ kind = "http", mode = requestedVerifyMode() } = {}) {
  const normalizedKind = String(kind || "").trim().toLowerCase();
  const requestedMode = normalizeVerifyMode(mode);
  const [container, node, python] = await Promise.all([
    probeContainerRuntime(),
    probeNode(),
    normalizedKind === "mcp" ? probePython() : Promise.resolve({
      available: false,
      command: "",
      version: "",
      venv: false,
      error: "not required"
    })
  ]);
  const local = localProbeForKind(normalizedKind, { node, python });

  let selected = "";
  if (requestedMode === "container") {
    selected = container.available ? "container" : "";
  } else if (requestedMode === "local") {
    selected = local.available ? "local" : "";
  } else {
    selected = container.available ? "container" : local.available ? "local" : "";
  }

  return {
    ok: Boolean(selected),
    kind: normalizedKind,
    requestedMode,
    selectedMode: selected,
    container,
    docker: {
      available: container.available && container.engine === "docker",
      engine: "docker",
      command: container.engine === "docker" ? container.command : "",
      serverVersion: container.engine === "docker" ? container.version : ""
    },
    local,
    node,
    python,
    env: {
      [VERIFY_MODE_ENV]: process.env[VERIFY_MODE_ENV] || "",
      PACT_VERIFY_SERVICE_MODE: process.env.PACT_VERIFY_SERVICE_MODE || ""
    },
    error: selected
      ? ""
      : `No usable ${normalizedKind} verification runtime. Container available=${container.available}; local available=${local.available}. ${local.reason || container.error || ""}`.trim()
  };
}

function cliArgs(argv = []) {
  const args = {
    kind: "http",
    mode: requestedVerifyMode(),
    json: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--kind") {
      args.kind = argv[index + 1] || args.kind;
      index += 1;
    } else if (arg === "--mode") {
      args.mode = normalizeVerifyMode(argv[index + 1] || args.mode);
      index += 1;
    } else if (arg === "--json") {
      args.json = true;
    }
  }
  return args;
}

async function main() {
  const args = cliArgs(process.argv.slice(2));
  const probe = await probeExternalServiceRuntime({
    kind: args.kind,
    mode: args.mode
  });
  if (args.json) {
    process.stdout.write(`${JSON.stringify(probe, null, 2)}\n`);
  } else {
    process.stdout.write(`kind=${probe.kind}\n`);
    process.stdout.write(`requested=${probe.requestedMode}\n`);
    process.stdout.write(`selected=${probe.selectedMode || "none"}\n`);
    process.stdout.write(`container=${probe.container.available ? probe.container.engine : "unavailable"}\n`);
    process.stdout.write(`local=${probe.local.available ? "available" : "unavailable"}\n`);
    if (probe.error) {
      process.stdout.write(`error=${probe.error}\n`);
    }
  }
  process.exitCode = probe.ok ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    process.exit(1);
  });
}
