import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  acknowledgeMonitorAlert,
  getMonitorAlertState,
  loadMonitorAlertConfig,
  monitorAlertStatePath,
  runMonitorAlertCycle,
  saveMonitorAlertConfig
} from "../platform/common/devops/monitor-alert-core/monitor-alerts.mjs";
import {
  recoverBackgroundSupervisor,
  recoverSystemInspection,
  supervisorLaunchAgentTargets,
  systemInspectionLaunchAgentTargets
} from "../platform/common/devops/supervisor-recovery/supervisor-recovery.mjs";
import {
  acknowledgeQueueMonitorAlert,
  inspectQueueMonitor,
  queueMonitorId,
  queueMonitorStatePath,
  registerQueueHeartbeat
} from "../services/client/work-queue-core/queue-monitor.mjs";
import {
  getBackgroundProcessStatus,
  inspectAgentWorkerDemand,
  inspectImportParseWorkerDemand,
  inspectMaintenanceWorkerDemand,
  inspectSourceWatcherDemand
} from "../platform/common/devops/process-status/background-process-status.mjs";

function oldIso(ms = 120000) {
  return new Date(Date.now() - ms).toISOString();
}

function waitForChildExit(child, timeoutMs = 1000) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      child.off("exit", onExit);
      resolve(null);
    }, timeoutMs);
    function onExit(code, signal) {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({ code, signal });
    }
    child.once("exit", onExit);
  });
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  child.kill("SIGTERM");
  const stopped = await waitForChildExit(child, 1000);
  if (!stopped && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await waitForChildExit(child, 1000);
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-monitor-alerts-"));
const queueMonitor = {
  inspect: (input) => inspectQueueMonitor({ userDataPath, ...input }),
  acknowledge: (alertId) => acknowledgeQueueMonitorAlert(userDataPath, alertId)
};

try {
  await saveMonitorAlertConfig(userDataPath, {
    enabled: true,
    intervalMs: 5000,
    heartbeatStaleMs: 15000,
    queueHeartbeatStaleMs: 5000,
    recoverInterruptedQueues: true,
    rules: {
      supervisorStopped: { enabled: false },
      processNotRunning: { enabled: false },
      processStale: { enabled: false },
      processRestarted: { enabled: false },
      queueInterrupted: {
        enabled: true,
        severity: "critical",
        titleTemplate: "{{queueLabel}} 中断",
        messageTemplate: "{{queueLabel}} 已中断，恢复状态 {{recoveryStatus}}。"
      }
    }
  });
  const savedConfig = await loadMonitorAlertConfig(userDataPath);
  assert.equal(savedConfig.supervisorRecovery.enabled, true);
  assert.equal(savedConfig.supervisorRecovery.cooldownMs, 30000);
  assert.equal(savedConfig.supervisorRecovery.startupWaitMs, 1200);

  const supervisorLivenessDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-monitor-supervisor-liveness-"));
  let supervisorChild = null;
  try {
    supervisorChild = spawn(process.execPath, [
      path.join(process.cwd(), "server", "scripts", "background-supervisor.mjs"),
      "--data-dir",
      supervisorLivenessDataPath,
      "--interval-ms",
      "500",
      "--restart-delay-ms",
      "200"
    ], {
      cwd: process.cwd(),
      stdio: ["ignore", "ignore", "ignore"]
    });
    const earlyExit = await waitForChildExit(supervisorChild, 1000);
    assert.equal(
      earlyExit,
      null,
      "所有按需 Worker 都待命时 background-supervisor 仍必须常驻等待后续任务"
    );
  } finally {
    await stopChild(supervisorChild);
    await fs.rm(supervisorLivenessDataPath, { recursive: true, force: true });
  }

  const supervisorAlertDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-monitor-supervisor-alerts-"));
  try {
    await saveMonitorAlertConfig(supervisorAlertDataPath, {
      enabled: true,
      rules: {
        supervisorStopped: { enabled: true },
        processNotRunning: { enabled: true },
        processStale: { enabled: false },
        processRestarted: { enabled: false },
        queueInterrupted: { enabled: false }
      }
    });
    const supervisorState = await runMonitorAlertCycle(supervisorAlertDataPath);
    const supervisorAlertIds = supervisorState.activeAlerts.map((alert) => alert.alertId);
    const supervisorAlert = supervisorState.activeAlerts.find((alert) => alert.alertId === "monitor.supervisor.stopped");
    assert.ok(
      supervisorAlertIds.includes("monitor.supervisor.stopped"),
      "守护进程离线应使用专用 supervisorStopped 报警"
    );
    assert.equal(supervisorAlert?.title, "后台 Worker 管理进程离线");
    assert.match(
      supervisorAlert?.message || "",
      /^后台 Worker 管理进程未运行，PID —。它负责拉起和管理导入解析、目录同步、智能巡检和智能体 Worker；请检查 launchd 服务 dev\.pact\.background-supervisor。$/
    );
    assert.equal(
      supervisorAlertIds.includes("monitor.process.background-supervisor.not_running"),
      false,
      "background-supervisor 不应再生成重复的通用进程未运行报警"
    );
    assert.ok(
      supervisorAlertIds.includes("monitor.process.system-inspection.not_running"),
      "普通常驻巡检进程仍应生成通用进程未运行报警"
    );
    assert.equal(
      supervisorAlertIds.includes("monitor.process.import-worker.not_running"),
      false,
      "无导入解析任务时 import-worker 应保持待命且不报警"
    );
    assert.equal(
      supervisorAlertIds.includes("monitor.process.source-watcher.not_running"),
      false,
      "无本地目录配置时 source-watcher 应保持待命且不报警"
    );
    assert.equal(
      supervisorAlertIds.includes("monitor.process.maintenance-worker.not_running"),
      false,
      "智能巡检未启用时 maintenance-worker 应保持待命且不报警"
    );
    assert.equal(
      supervisorAlertIds.includes("monitor.process.agent-worker.not_running"),
      false,
      "智能体未配置或未接通时 agent-worker 应保持待命且不报警"
    );
  } finally {
    await fs.rm(supervisorAlertDataPath, { recursive: true, force: true });
  }

  const importDemandDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-monitor-import-demand-"));
  try {
    await saveMonitorAlertConfig(importDemandDataPath, {
      enabled: true,
      rules: {
        supervisorStopped: { enabled: false },
        processNotRunning: { enabled: true },
        processStale: { enabled: false },
        processRestarted: { enabled: false },
        queueInterrupted: { enabled: false }
      }
    });
    const idleDemand = await inspectImportParseWorkerDemand(importDemandDataPath);
    assert.equal(idleDemand.active, false);
    const idleProcessStatus = await getBackgroundProcessStatus(importDemandDataPath);
    const idleImportProcess = idleProcessStatus.processes.find((item) => item.role === "import-worker");
    assert.equal(idleImportProcess?.desired, false);
    assert.equal(idleImportProcess?.status, "standby");
    const idleAlertState = await runMonitorAlertCycle(importDemandDataPath);
    const idleAlertIds = idleAlertState.activeAlerts.map((alert) => alert.alertId);
    assert.equal(
      idleAlertIds.includes("monitor.process.import-worker.not_running"),
      false,
      "没有 queued/running 导入解析任务时不应检测 import-worker 未运行"
    );

    const importJobId = "verify-import-worker-demand";
    await writeJson(path.join(importDemandDataPath, "jobs", importJobId, "meta.json"), {
      id: importJobId,
      status: "queued",
      createdAt: oldIso(1000),
      updatedAt: oldIso(1000)
    });
    const activeDemand = await inspectImportParseWorkerDemand(importDemandDataPath);
    assert.equal(activeDemand.active, true);
    assert.deepEqual(activeDemand.activeJobIds, [importJobId]);
    const activeProcessStatus = await getBackgroundProcessStatus(importDemandDataPath);
    const activeImportProcess = activeProcessStatus.processes.find((item) => item.role === "import-worker");
    assert.equal(activeImportProcess?.desired, true);
    assert.equal(activeImportProcess?.status, "missing");
    const activeAlertState = await runMonitorAlertCycle(importDemandDataPath);
    const activeAlertIds = activeAlertState.activeAlerts.map((alert) => alert.alertId);
    assert.ok(
      activeAlertIds.includes("monitor.process.import-worker.not_running"),
      "存在 queued/running 导入解析任务时才检测 import-worker 未运行"
    );
  } finally {
    await fs.rm(importDemandDataPath, { recursive: true, force: true });
  }

  const sourceDemandDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-monitor-source-demand-"));
  try {
    await saveMonitorAlertConfig(sourceDemandDataPath, {
      enabled: true,
      rules: {
        supervisorStopped: { enabled: false },
        processNotRunning: { enabled: true },
        processStale: { enabled: false },
        processRestarted: { enabled: false },
        queueInterrupted: { enabled: false }
      }
    });
    await writeJson(path.join(sourceDemandDataPath, "knowledge-sources", "sources.json"), {
      schemaVersion: 1,
      updatedAt: oldIso(1000),
      sources: []
    });
    const idleSourceDemand = await inspectSourceWatcherDemand(sourceDemandDataPath);
    assert.equal(idleSourceDemand.active, false);
    const idleSourceProcessStatus = await getBackgroundProcessStatus(sourceDemandDataPath);
    const idleSourceProcess = idleSourceProcessStatus.processes.find((item) => item.role === "source-watcher");
    assert.equal(idleSourceProcess?.desired, false);
    assert.equal(idleSourceProcess?.status, "standby");
    const idleSourceAlertState = await runMonitorAlertCycle(sourceDemandDataPath);
    const idleSourceAlertIds = idleSourceAlertState.activeAlerts.map((alert) => alert.alertId);
    assert.equal(
      idleSourceAlertIds.includes("monitor.process.source-watcher.not_running"),
      false,
      "没有启用自动同步本地目录时不应检测 source-watcher 未运行"
    );

    await writeJson(path.join(sourceDemandDataPath, "knowledge-sources", "sources.json"), {
      schemaVersion: 1,
      updatedAt: oldIso(1000),
      sources: [
        {
          sourceId: "verify-local-source",
          label: "verify local source",
          directoryPath: sourceDemandDataPath,
          enabled: true,
          autoSync: true,
          recursive: true
        }
      ]
    });
    const activeSourceDemand = await inspectSourceWatcherDemand(sourceDemandDataPath);
    assert.equal(activeSourceDemand.active, true);
    assert.deepEqual(activeSourceDemand.watchableSourceIds, ["verify-local-source"]);
    const activeSourceProcessStatus = await getBackgroundProcessStatus(sourceDemandDataPath);
    const activeSourceProcess = activeSourceProcessStatus.processes.find((item) => item.role === "source-watcher");
    assert.equal(activeSourceProcess?.desired, true);
    assert.equal(activeSourceProcess?.status, "missing");
    const activeSourceAlertState = await runMonitorAlertCycle(sourceDemandDataPath);
    const activeSourceAlertIds = activeSourceAlertState.activeAlerts.map((alert) => alert.alertId);
    assert.ok(
      activeSourceAlertIds.includes("monitor.process.source-watcher.not_running"),
      "存在启用自动同步本地目录时才检测 source-watcher 未运行"
    );
  } finally {
    await fs.rm(sourceDemandDataPath, { recursive: true, force: true });
  }

  const maintenanceDemandDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-monitor-maintenance-demand-"));
  try {
    await saveMonitorAlertConfig(maintenanceDemandDataPath, {
      enabled: true,
      rules: {
        supervisorStopped: { enabled: false },
        processNotRunning: { enabled: true },
        processStale: { enabled: false },
        processRestarted: { enabled: false },
        queueInterrupted: { enabled: false }
      }
    });
    const idleMaintenanceDemand = await inspectMaintenanceWorkerDemand(maintenanceDemandDataPath);
    assert.equal(idleMaintenanceDemand.active, false);
    const idleMaintenanceProcessStatus = await getBackgroundProcessStatus(maintenanceDemandDataPath);
    const idleMaintenanceProcess = idleMaintenanceProcessStatus.processes.find((item) => item.role === "maintenance-worker");
    assert.equal(idleMaintenanceProcess?.label, "智能巡检 Worker");
    assert.equal(idleMaintenanceProcess?.desired, false);
    assert.equal(idleMaintenanceProcess?.status, "standby");
    const idleMaintenanceAlertState = await runMonitorAlertCycle(maintenanceDemandDataPath);
    const idleMaintenanceAlertIds = idleMaintenanceAlertState.activeAlerts.map((alert) => alert.alertId);
    assert.equal(
      idleMaintenanceAlertIds.includes("monitor.process.maintenance-worker.not_running"),
      false,
      "智能巡检未启用且没有待恢复运行时不应检测 maintenance-worker 未运行"
    );

    await writeJson(path.join(maintenanceDemandDataPath, "maintenance-agent.json"), {
      schemaVersion: 1,
      enabled: true,
      scheduler: { tickSeconds: 30 },
      schedules: [
        {
          id: "verify-inspection-schedule",
          label: "verify inspection schedule",
          enabled: true,
          runbook: "health_smoke",
          intervalMinutes: 60,
          nextRunAt: ""
        }
      ]
    });
    const activeMaintenanceDemand = await inspectMaintenanceWorkerDemand(maintenanceDemandDataPath);
    assert.equal(activeMaintenanceDemand.active, true);
    assert.equal(activeMaintenanceDemand.enabled, true);
    assert.equal(activeMaintenanceDemand.enabledScheduleCount, 1);
    const activeMaintenanceProcessStatus = await getBackgroundProcessStatus(maintenanceDemandDataPath);
    const activeMaintenanceProcess = activeMaintenanceProcessStatus.processes.find((item) => item.role === "maintenance-worker");
    assert.equal(activeMaintenanceProcess?.desired, true);
    assert.equal(activeMaintenanceProcess?.status, "missing");
    const activeMaintenanceAlertState = await runMonitorAlertCycle(maintenanceDemandDataPath);
    const activeMaintenanceAlertIds = activeMaintenanceAlertState.activeAlerts.map((alert) => alert.alertId);
    assert.ok(
      activeMaintenanceAlertIds.includes("monitor.process.maintenance-worker.not_running"),
      "智能巡检启用并存在启用 schedule 时才检测 maintenance-worker 未运行"
    );
  } finally {
    await fs.rm(maintenanceDemandDataPath, { recursive: true, force: true });
  }

  const agentDemandDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-monitor-agent-demand-"));
  try {
    await saveMonitorAlertConfig(agentDemandDataPath, {
      enabled: true,
      rules: {
        supervisorStopped: { enabled: false },
        processNotRunning: { enabled: true },
        processStale: { enabled: false },
        processRestarted: { enabled: false },
        queueInterrupted: { enabled: false }
      }
    });
    const emptyAgentDemand = await inspectAgentWorkerDemand(agentDemandDataPath);
    assert.equal(emptyAgentDemand.active, false);
    assert.equal(emptyAgentDemand.reason, "not_configured");
    const emptyAgentProcessStatus = await getBackgroundProcessStatus(agentDemandDataPath);
    const emptyAgentProcess = emptyAgentProcessStatus.processes.find((item) => item.role === "agent-worker");
    assert.equal(emptyAgentProcess?.desired, false);
    assert.equal(emptyAgentProcess?.status, "not_configured");
    const emptyAgentAlertState = await runMonitorAlertCycle(agentDemandDataPath);
    const emptyAgentAlertIds = emptyAgentAlertState.activeAlerts.map((alert) => alert.alertId);
    assert.equal(
      emptyAgentAlertIds.includes("monitor.process.agent-worker.not_running"),
      false,
      "没有配置智能体时不应把 agent-worker 归类为进程未正常运行"
    );

    await writeJson(path.join(agentDemandDataPath, "settings.json"), {
      schemaVersion: 1,
      modelLibraryAgents: [
        {
          uid: "agent_verify_unconnected",
          provider: "deepseek",
          label: "verify unconnected agent",
          model: "deepseek-v4-pro",
          apiKeyConfigured: false
        }
      ]
    });
    const disconnectedAgentDemand = await inspectAgentWorkerDemand(agentDemandDataPath);
    assert.equal(disconnectedAgentDemand.active, false);
    assert.equal(disconnectedAgentDemand.reason, "not_connected");
    const disconnectedAgentProcessStatus = await getBackgroundProcessStatus(agentDemandDataPath);
    const disconnectedAgentProcess = disconnectedAgentProcessStatus.processes.find((item) => item.role === "agent-worker");
    assert.equal(disconnectedAgentProcess?.desired, false);
    assert.equal(disconnectedAgentProcess?.status, "not_connected");
    const disconnectedAgentAlertState = await runMonitorAlertCycle(agentDemandDataPath);
    const disconnectedAgentAlertIds = disconnectedAgentAlertState.activeAlerts.map((alert) => alert.alertId);
    assert.equal(
      disconnectedAgentAlertIds.includes("monitor.process.agent-worker.not_running"),
      false,
      "智能体未接通时不应把 agent-worker 归类为进程未正常运行"
    );
  } finally {
    await fs.rm(agentDemandDataPath, { recursive: true, force: true });
  }

  const legacyAlertDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-monitor-legacy-alerts-"));
  try {
    await writeJson(monitorAlertStatePath(legacyAlertDataPath), {
      schemaVersion: 1,
      ok: false,
      status: "alerting",
      activeAlerts: [
        {
          alertId: "legacy-process",
          title: "后台进程守护器 未正常运行",
          message: "后台进程守护器 当前状态为 stopped，PID —，最近心跳 —。",
          unifiedRegistration: {
            label: "后台进程守护器 未正常运行",
            summary: { message: "后台进程守护器 当前状态为 stopped，PID —，最近心跳 —。" }
          }
        },
        {
          alertId: "legacy-maintenance-worker",
          title: "维护任务 Worker 未正常运行",
          message: "维护任务 Worker 当前状态为 missing，PID —，最近心跳 —。",
          unifiedRegistration: {
            label: "维护任务 Worker 未正常运行",
            summary: { message: "维护任务 Worker 当前状态为 missing，PID —，最近心跳 —。" }
          }
        },
        {
          alertId: "legacy-agent-worker",
          title: "智能体 Worker 未正常运行",
          message: "智能体 Worker 当前状态为 missing，PID —，最近心跳 —。",
          unifiedRegistration: {
            label: "智能体 Worker 未正常运行",
            summary: { message: "智能体 Worker 当前状态为 missing，PID —，最近心跳 —。" }
          }
        }
      ],
      history: [
        {
          alertId: "legacy-supervisor",
          title: "后台守护进程离线",
          message: "后台守护进程未运行，PID 96726。请检查 launchd 服务 dev.pact.background-supervisor。",
          unifiedRegistration: {
            label: "后台守护进程离线",
            summary: {
              message: "后台守护进程未运行，PID 96726。请检查 launchd 服务 dev.pact.background-supervisor。",
              monitors: ["工作队列闭环", "维护任务队列"]
            }
          }
        }
      ]
    });
    const legacyState = await getMonitorAlertState(legacyAlertDataPath, { refresh: false });
    const legacyPayload = JSON.stringify(legacyState);
    assert.equal(legacyPayload.includes("后台进程守护器"), false);
    assert.equal(legacyPayload.includes("后台守护进程"), false);
    assert.equal(legacyPayload.includes("维护任务 Worker"), false);
    assert.equal(legacyPayload.includes("智能体 Worker 未正常运行"), false);
    assert.equal(legacyPayload.includes("智能体 Worker 当前状态为 missing"), false);
    assert.equal(legacyPayload.includes("维护任务队列"), false);
    assert.equal(legacyPayload.includes("工作队列"), false);
    assert.ok(legacyPayload.includes("后台 Worker 管理进程离线"));
    assert.ok(legacyPayload.includes("它负责拉起和管理导入解析、目录同步、智能巡检和智能体 Worker"));
    assert.ok(legacyPayload.includes("智能巡检 Worker 未正常运行"));
    assert.ok(legacyPayload.includes("智能体未配置或未接通"));
    assert.ok(legacyPayload.includes("智能体模型库未配置或未接通，请在智能体仓库配置并探测可用模型。"));
    assert.ok(legacyPayload.includes("任务队列闭环"));
  } finally {
    await fs.rm(legacyAlertDataPath, { recursive: true, force: true });
  }

  const jobId = "verify-interrupted-job";
  const queueId = queueMonitorId("import_parse_job", jobId);
  const staleAt = oldIso();
  const jobDir = path.join(userDataPath, "jobs", jobId);
  await writeJson(path.join(jobDir, "payload.json"), {
    inputText: "monitor alert interrupted queue verification",
    uploadedFiles: [],
    settings: {}
  });
  await writeJson(path.join(jobDir, "meta.json"), {
    id: jobId,
    queueId,
    status: "running",
    createdAt: staleAt,
    updatedAt: staleAt,
    startedAt: staleAt,
    progressPercent: 32,
    stage: "验证队列运行中",
    checkpointId: "checkpoint_verify",
    checkpointTreeId: "",
    uploadSessionId: ""
  });
  await writeJson(queueMonitorStatePath(userDataPath), {
    schemaVersion: 1,
    updatedAt: staleAt,
    items: {
      [queueId]: {
        queueId,
        kind: "import_parse_job",
        ownerId: jobId,
        label: "验证导入解析队列",
        source: "function-self-check",
        sources: ["function-self-check"],
        lifecycleStatus: "open",
        phase: "running",
        status: "running",
        startedAt: staleAt,
        lastHeartbeatAt: staleAt,
        checkpointId: "checkpoint_verify",
        checkpointTreeId: "",
        metadata: {}
      }
    }
  });

  const interruptedState = await runMonitorAlertCycle(userDataPath, { queueMonitor });
  const interruptedAlerts = interruptedState.activeAlerts.filter(
    (alert) => alert.ruleId === "queueInterrupted"
  );
  assert.equal(interruptedAlerts.length, 1, "同一队列只能生成一个中断报警");
  assert.equal(interruptedAlerts[0].queueId, queueId);
  assert.equal(interruptedAlerts[0].active, true);

  const recoveredJob = JSON.parse(await fs.readFile(path.join(jobDir, "meta.json"), "utf8"));
  assert.equal(recoveredJob.status, "queued", "中断恢复切面应把运行中 job 拉回 queued");

  const dedupedState = await runMonitorAlertCycle(userDataPath, { queueMonitor });
  assert.equal(
    dedupedState.activeAlerts.filter((alert) => alert.ruleId === "queueInterrupted").length,
    1,
    "重复巡检不能为同一队列追加第二个中断报警"
  );

  const runningAt = new Date().toISOString();
  await writeJson(path.join(jobDir, "meta.json"), {
    ...recoveredJob,
    status: "running",
    stage: "恢复后重新运行",
    updatedAt: runningAt
  });
  await registerQueueHeartbeat(userDataPath, {
    queueId,
    kind: "import_parse_job",
    ownerId: jobId,
    label: "验证导入解析队列",
    phase: "running",
    status: "running",
    source: "function-self-check"
  });

  const restoredState = await runMonitorAlertCycle(userDataPath, { queueMonitor });
  const restoredAlerts = restoredState.activeAlerts.filter(
    (alert) => alert.ruleId === "queueInterrupted"
  );
  assert.equal(restoredAlerts.length, 1, "恢复信息应沿用同一个报警 ID");
  assert.equal(restoredAlerts[0].alertId, interruptedAlerts[0].alertId);
  assert.equal(restoredAlerts[0].active, false);
  assert.equal(restoredAlerts[0].ackRequired, true);
  assert.equal(restoredState.status, "recovered");

  const acknowledged = await acknowledgeMonitorAlert(userDataPath, restoredAlerts[0].alertId, { queueMonitor });
  assert.equal(
    acknowledged.activeAlerts.some((alert) => alert.alertId === restoredAlerts[0].alertId),
    false,
    "确认恢复信息后应从报警列表关闭"
  );

  const afterAck = await runMonitorAlertCycle(userDataPath, { queueMonitor });
  assert.equal(
    afterAck.activeAlerts.some((alert) => alert.alertId === restoredAlerts[0].alertId),
    false,
    "ACK 后再次巡检不应重新显示已恢复信息"
  );

  const launchTargets = supervisorLaunchAgentTargets({
    serviceLabel: "dev.pact.verify-supervisor",
    uid: 501,
    homeDir: "/Users/tester"
  });
  assert.equal(launchTargets.launchTarget, "gui/501");
  assert.equal(launchTargets.serviceTarget, "gui/501/dev.pact.verify-supervisor");
  assert.match(launchTargets.plistPath, /dev\.pact\.verify-supervisor\.plist$/);

  const supervisorPlist = path.join(userDataPath, "dev.pact.verify-supervisor.plist");
  await fs.writeFile(supervisorPlist, "<plist />", "utf8");
  const kickstartCommands = [];
  const kickstarted = await recoverBackgroundSupervisor({
    platform: "darwin",
    uid: 501,
    serviceLabel: "dev.pact.verify-supervisor",
    plistPath: supervisorPlist,
    backgroundStatus: { supervisor: { alive: false } },
    runCommand: async (command, args) => {
      kickstartCommands.push([command, ...args]);
      return { code: 0, stdout: "", stderr: "" };
    }
  });
  assert.equal(kickstarted.ok, true);
  assert.equal(kickstarted.action, "kickstart");
  assert.deepEqual(kickstartCommands, [
    ["/bin/launchctl", "kickstart", "-k", "gui/501/dev.pact.verify-supervisor"]
  ]);

  const bootstrapCommands = [];
  const bootstrapped = await recoverBackgroundSupervisor({
    platform: "darwin",
    uid: 501,
    serviceLabel: "dev.pact.verify-supervisor",
    plistPath: supervisorPlist,
    backgroundStatus: { supervisor: { alive: false } },
    runCommand: async (command, args) => {
      bootstrapCommands.push([command, ...args]);
      if (bootstrapCommands.length === 1) {
        return { code: 113, stdout: "", stderr: "Could not find service" };
      }
      return { code: 0, stdout: "", stderr: "" };
    }
  });
  assert.equal(bootstrapped.ok, true);
  assert.equal(bootstrapped.action, "bootstrap_then_kickstart");
  assert.deepEqual(bootstrapCommands, [
    ["/bin/launchctl", "kickstart", "-k", "gui/501/dev.pact.verify-supervisor"],
    ["/bin/launchctl", "bootstrap", "gui/501", supervisorPlist],
    ["/bin/launchctl", "kickstart", "-k", "gui/501/dev.pact.verify-supervisor"]
  ]);

  const alreadyRunning = await recoverBackgroundSupervisor({
    platform: "darwin",
    backgroundStatus: { supervisor: { alive: true } },
    runCommand: async () => {
      throw new Error("already-running supervisor must not invoke launchctl");
    }
  });
  assert.equal(alreadyRunning.attempted, false);
  assert.equal(alreadyRunning.reason, "already_running");

  const inspectionTargets = systemInspectionLaunchAgentTargets({
    uid: 501,
    homeDir: "/Users/tester"
  });
  assert.equal(inspectionTargets.launchTarget, "gui/501");
  assert.equal(inspectionTargets.serviceTarget, "gui/501/dev.pact.system-inspection");
  assert.match(inspectionTargets.plistPath, /dev\.pact\.system-inspection\.plist$/);

  const inspectionPlist = path.join(userDataPath, "dev.pact.verify-inspection.plist");
  await fs.writeFile(inspectionPlist, "<plist />", "utf8");
  const inspectionCommands = [];
  const inspectionRecovered = await recoverSystemInspection({
    platform: "darwin",
    uid: 501,
    serviceLabel: "dev.pact.verify-inspection",
    plistPath: inspectionPlist,
    backgroundStatus: {
      processes: [
        {
          role: "system-inspection",
          alive: false,
          status: "stopped"
        }
      ]
    },
    runCommand: async (command, args) => {
      inspectionCommands.push([command, ...args]);
      return { code: 0, stdout: "", stderr: "" };
    }
  });
  assert.equal(inspectionRecovered.ok, true);
  assert.equal(inspectionRecovered.action, "kickstart");
  assert.deepEqual(inspectionCommands, [
    ["/bin/launchctl", "kickstart", "-k", "gui/501/dev.pact.verify-inspection"]
  ]);

  const inspectionAlreadyRunning = await recoverSystemInspection({
    platform: "darwin",
    backgroundStatus: {
      processes: [
        {
          role: "system-inspection",
          alive: true,
          status: "running"
        }
      ]
    },
    runCommand: async () => {
      throw new Error("running system-inspection must not invoke launchctl");
    }
  });
  assert.equal(inspectionAlreadyRunning.attempted, false);
  assert.equal(inspectionAlreadyRunning.reason, "already_running");

  console.log("Monitor alerts verification passed.");
} finally {
  await fs.rm(userDataPath, { recursive: true, force: true });
}
