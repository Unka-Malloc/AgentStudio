#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadMonitorAlertConfig,
  runMonitorAlertCycle
} from "../platform/common/devops/monitor-alert-core/monitor-alerts.mjs";
import { getBackgroundProcessStatus } from "../platform/common/devops/process-status/background-process-status.mjs";
import { recoverBackgroundSupervisor } from "../platform/common/devops/supervisor-recovery/supervisor-recovery.mjs";
import { inspectQueueMonitor } from "../services/client/work-queue-core/queue-monitor.mjs";
import { ServerConfig } from "../platform/common/config/ServerConfig.mjs";

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--project-root") {
      args.projectRoot = argv[index + 1] || "";
      index += 1;
    } else if (item === "--data-dir") {
      args.dataDir = argv[index + 1] || "";
      index += 1;
    }
  }
  return args;
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(Math.trunc(parsed), max));
}

const args = parseArgs(process.argv.slice(2));
const projectRoot =
  args.projectRoot ||
  path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const dataDir = path.resolve(
  String(args.dataDir || process.env.PACT_SERVER_DATA_DIR || ServerConfig.getDataDir())
);
let lastSupervisorRecoveryAt = 0;
let lastSupervisorRecovery = null;

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function recoverSupervisorIfNeeded(config) {
  const recoveryConfig = config.supervisorRecovery || {};
  if (recoveryConfig.enabled === false) {
    return {
      ok: false,
      attempted: false,
      reason: "disabled",
      checkedAt: nowIso()
    };
  }
  const backgroundStatus = await getBackgroundProcessStatus(dataDir);
  if (backgroundStatus.supervisor?.alive) {
    return {
      ok: true,
      attempted: false,
      reason: "already_running",
      checkedAt: nowIso()
    };
  }
  const cooldownMs = normalizeInteger(recoveryConfig.cooldownMs, 30000, 1000, 3600000);
  const nowMs = Date.now();
  if (lastSupervisorRecoveryAt && nowMs - lastSupervisorRecoveryAt < cooldownMs) {
    return {
      ...(lastSupervisorRecovery || {}),
      ok: false,
      attempted: false,
      reason: "cooldown",
      cooldownMs,
      checkedAt: nowIso()
    };
  }
  lastSupervisorRecoveryAt = nowMs;
  lastSupervisorRecovery = await recoverBackgroundSupervisor({
    backgroundStatus,
    serviceLabel: config.serviceLabel,
    plistPath: recoveryConfig.plistPath || ""
  });
  if (lastSupervisorRecovery.ok) {
    await sleep(normalizeInteger(recoveryConfig.startupWaitMs, 1200, 0, 60000));
  }
  return lastSupervisorRecovery;
}

async function loop() {
  while (true) {
    let intervalMs = 5000;
    try {
      const config = await loadMonitorAlertConfig(dataDir);
      intervalMs = normalizeInteger(config.intervalMs, 5000, 1000, 600000);
      const supervisorRecovery = await recoverSupervisorIfNeeded(config);
      await runMonitorAlertCycle(dataDir, {
        queueMonitor: {
          inspect: (input) => inspectQueueMonitor({ userDataPath: dataDir, ...input })
        },
        inspectionDaemon: {
          pid: process.pid,
          status: "running",
          updatedAt: nowIso(),
          projectRoot,
          dataDir,
          supervisorServiceLabel: config.serviceLabel || "dev.pact.background-supervisor",
          supervisorRecovery,
          runtime: "node"
        }
      });
    } catch (error) {
      console.error(`[system-inspection] ${error?.stack || error?.message || error}`);
    }
    await sleep(intervalMs);
  }
}

await loop();
