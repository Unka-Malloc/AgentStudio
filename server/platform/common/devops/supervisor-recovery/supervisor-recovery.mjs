import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const DEFAULT_SUPERVISOR_SERVICE_LABEL = "dev.pact.background-supervisor";
const DEFAULT_SYSTEM_INSPECTION_SERVICE_LABEL = "dev.pact.system-inspection";

function nowIso() {
  return new Date().toISOString();
}

function defaultRunCommand(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: options.cwd || process.cwd(),
      env: options.env || process.env
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      resolve({ code: code || 0, signal: signal || "", stdout, stderr });
    });
  });
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function launchAgentTargets(options = {}) {
  const defaultServiceLabel = String(options.defaultServiceLabel || DEFAULT_SUPERVISOR_SERVICE_LABEL);
  const serviceLabel = String(options.serviceLabel || defaultServiceLabel).trim() || defaultServiceLabel;
  const uid = Number.isInteger(Number(options.uid))
    ? Number(options.uid)
    : typeof process.getuid === "function"
      ? process.getuid()
      : 0;
  const homeDir = options.homeDir || os.homedir();
  const plistPath = path.resolve(
    String(options.plistPath || path.join(homeDir, "Library", "LaunchAgents", `${serviceLabel}.plist`))
  );
  const launchTarget = `gui/${uid}`;
  const serviceTarget = `${launchTarget}/${serviceLabel}`;
  return {
    serviceLabel,
    uid,
    launchTarget,
    serviceTarget,
    plistPath
  };
}

export function supervisorLaunchAgentTargets(options = {}) {
  return launchAgentTargets({
    defaultServiceLabel: DEFAULT_SUPERVISOR_SERVICE_LABEL,
    ...options
  });
}

export function systemInspectionLaunchAgentTargets(options = {}) {
  return launchAgentTargets({
    defaultServiceLabel: DEFAULT_SYSTEM_INSPECTION_SERVICE_LABEL,
    ...options
  });
}

function commandSummary(item) {
  return {
    args: item.args,
    code: item.result?.code ?? 0,
    signal: item.result?.signal || "",
    stderr: String(item.result?.stderr || "").trim(),
    stdout: String(item.result?.stdout || "").trim()
  };
}

function isAlreadyLoaded(result = {}) {
  const text = `${result.stderr || ""}\n${result.stdout || ""}`;
  return /already\s+(?:bootstrapped|loaded|exists)|Bootstrap failed:\s*5/i.test(text);
}

export async function recoverBackgroundSupervisor(options = {}) {
  const backgroundStatus = options.backgroundStatus || {};
  return recoverLaunchAgentService({
    ...options,
    serviceLabel: options.serviceLabel || DEFAULT_SUPERVISOR_SERVICE_LABEL,
    alreadyRunning: Boolean(backgroundStatus.supervisor?.alive),
    targetsFactory: supervisorLaunchAgentTargets
  });
}

export async function recoverSystemInspection(options = {}) {
  const backgroundStatus = options.backgroundStatus || {};
  const processItem =
    options.processItem ||
    (Array.isArray(backgroundStatus.processes)
      ? backgroundStatus.processes.find((item) => item?.role === "system-inspection")
      : null);
  return recoverLaunchAgentService({
    ...options,
    serviceLabel: options.serviceLabel || DEFAULT_SYSTEM_INSPECTION_SERVICE_LABEL,
    alreadyRunning: Boolean(processItem?.alive && processItem?.status !== "stopped"),
    targetsFactory: systemInspectionLaunchAgentTargets
  });
}

async function recoverLaunchAgentService(options = {}) {
  const checkedAt = nowIso();
  if (options.alreadyRunning) {
    return {
      ok: true,
      attempted: false,
      reason: "already_running",
      checkedAt
    };
  }

  const platform = String(options.platform || process.platform);
  if (platform !== "darwin") {
    return {
      ok: false,
      attempted: false,
      reason: "unsupported_platform",
      platform,
      checkedAt
    };
  }

  const targetsFactory = options.targetsFactory || launchAgentTargets;
  const targets = targetsFactory(options);
  const exists = typeof options.fileExists === "function"
    ? await options.fileExists(targets.plistPath)
    : await fileExists(targets.plistPath);
  if (!exists) {
    return {
      ok: false,
      attempted: false,
      reason: "plist_missing",
      ...targets,
      checkedAt
    };
  }

  const launchctlPath = options.launchctlPath || "/bin/launchctl";
  const runCommand = options.runCommand || defaultRunCommand;
  const commands = [];

  async function runLaunchctl(args) {
    const result = await runCommand(launchctlPath, args);
    commands.push({ args, result });
    return result;
  }

  const kickstart = await runLaunchctl(["kickstart", "-k", targets.serviceTarget]);
  if (kickstart.code === 0) {
    return {
      ok: true,
      attempted: true,
      action: "kickstart",
      ...targets,
      checkedAt,
      commands: commands.map(commandSummary)
    };
  }

  const bootstrap = await runLaunchctl(["bootstrap", targets.launchTarget, targets.plistPath]);
  if (bootstrap.code !== 0 && !isAlreadyLoaded(bootstrap)) {
    return {
      ok: false,
      attempted: true,
      reason: "bootstrap_failed",
      ...targets,
      checkedAt,
      commands: commands.map(commandSummary)
    };
  }

  const retryKickstart = await runLaunchctl(["kickstart", "-k", targets.serviceTarget]);
  return {
    ok: retryKickstart.code === 0,
    attempted: true,
    action: retryKickstart.code === 0 ? "bootstrap_then_kickstart" : "kickstart_failed",
    reason: retryKickstart.code === 0 ? "" : "kickstart_failed",
    ...targets,
    checkedAt,
    commands: commands.map(commandSummary)
  };
}
