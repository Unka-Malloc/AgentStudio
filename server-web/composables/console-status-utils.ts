import type {
  BackgroundProcessStatus,
  ClientMigrationState,
  ClientRuntimeHeatRow,
  QueueMonitorItem,
} from "../lib/types";

export function queueLifecycleTone(status: string) {
  const normalized = String(status || "").toLowerCase();
  if (["interrupted", "failed", "missing"].includes(normalized)) {
    return "danger";
  }
  if (["recovered", "closed", "completed", "completed_with_errors"].includes(normalized)) {
    return "success";
  }
  if (["running", "open"].includes(normalized)) {
    return "running";
  }
  if (["queued", "awaiting_approval", "standby"].includes(normalized)) {
    return "queued";
  }
  return "neutral";
}

export function queueLifecycleLabel(status: string) {
  const labels: Record<string, string> = {
    open: "运行中",
    queued: "排队中",
    running: "运行中",
    awaiting_approval: "待审批",
    interrupted: "已中断",
    recovered: "已恢复",
    closed: "已关闭",
    completed: "已完成",
    completed_with_errors: "有错误",
    failed: "失败",
    cancelled: "已取消",
    rejected: "已拒绝",
  };
  return labels[String(status || "").toLowerCase()] || status || "未知";
}

export function queueSourceLabel(source: string) {
  const labels: Record<string, string> = {
    "function-self-check": "功能自检",
    watchdog: "守护进程巡检",
    "watchdog-reconcile": "守护进程补录",
    "queue-monitor": "队列监控",
  };
  return labels[String(source || "")] || source || "队列监控";
}

export function queueMonitorDetail(item: QueueMonitorItem) {
  return [
    item.interruptedReason ? `中断原因 ${item.interruptedReason}` : "",
    item.recoveryStatus ? `恢复状态 ${item.recoveryStatus}` : "",
    item.metadata?.stage ? `阶段 ${String(item.metadata.stage)}` : "",
    item.checkpointTreeId ? `checkpoint ${item.checkpointTreeId}` : "",
  ].filter(Boolean).join(" · ") || item.kind || "队列";
}

export function maintenanceAgentStatusTone(status: string) {
  if (status === "awaiting_approval" || status === "queued") {
    return "queued";
  }
  if (status === "running") {
    return "running";
  }
  if (status === "completed") {
    return "completed";
  }
  if (status === "completed_with_errors") {
    return "queued";
  }
  return "failed";
}

export function maintenanceAgentStatusLabel(status: string) {
  const labels: Record<string, string> = {
    awaiting_approval: "待审批",
    queued: "排队",
    running: "运行中",
    completed: "已完成",
    completed_with_errors: "有错误",
    failed: "失败",
    cancelled: "已取消",
    rejected: "已拒绝",
  };
  return labels[status] || status || "未知";
}

export function backgroundProcessTone(status: string) {
  if (status === "running") {
    return "running";
  }
  if (status === "standby") {
    return "queued";
  }
  if (status === "starting") {
    return "queued";
  }
  if (status === "degraded" || status === "stale") {
    return "warning";
  }
  return "failed";
}

export function backgroundProcessLabel(status: string) {
  const labels: Record<string, string> = {
    running: "运行中",
    standby: "待接管",
    starting: "启动中",
    degraded: "降级",
    stale: "心跳超时",
    stopped: "已停止",
    exited: "已退出",
    failed: "失败",
    missing: "缺失",
  };
  return labels[status] || status || "未知";
}

export function processTypeLabel(processType?: string) {
  return processType === "daemon" ? "守护进程" : "服务进程";
}

export function processRelationText(processItem: BackgroundProcessStatus["processes"][number]) {
  const services = processItem.services?.length
    ? `服务：${processItem.services.join(" / ")}`
    : "";
  const monitors = processItem.monitors?.length
    ? `监控：${processItem.monitors.join(" / ")}`
    : "";
  const alerts = processItem.alerts?.length
    ? `报警：${processItem.alerts.join(" / ")}`
    : "";
  return [services, monitors, alerts].filter(Boolean).join("；") || processItem.description || "无关联说明";
}

export function clientRuntimeCoolingTone(state: string) {
  if (state === "hot") {
    return "running";
  }
  if (state === "cooled") {
    return "warning";
  }
  return "info";
}

export function clientRuntimeCoolingLabel(state: string) {
  const labels: Record<string, string> = {
    hot: "热连接",
    warm: "正常",
    cooled: "已冷却",
  };
  return labels[state] || state || "未知";
}

export function clientRuntimeReasonLabel(reason: string) {
  const labels: Record<string, string> = {
    "new-client": "新客户端",
    normal: "正常分配",
    "frequent-client": "高频使用",
    "outside-warm-client-limit": "超出保温上限",
    "least-recently-used-and-low-frequency": "最旧且低频",
  };
  return labels[reason] || reason || "无冷却原因";
}

export function clientRuntimeTaskText(row: ClientRuntimeHeatRow) {
  return row.taskTypes?.length
    ? row.taskTypes.map((item) => `${item.taskType}×${item.count}`).join(" / ")
    : "无任务记录";
}

export function clientRuntimeSurfaceText(row: ClientRuntimeHeatRow) {
  return row.surfaces?.length
    ? row.surfaces.map((item) => `${item.surface}×${item.count}`).join(" / ")
    : "无调用面记录";
}

export function clientRuntimeHeatStyle(row: ClientRuntimeHeatRow) {
  const heat = Math.max(4, Math.min(100, Number(row.heatPercent || 0)));
  return { "--heat": `${heat}%` };
}

export function monitorAlertSeverityTone(severity: string) {
  if (severity === "critical") {
    return "failed";
  }
  if (severity === "warning") {
    return "warning";
  }
  return "running";
}

export function monitorAlertSeverityLabel(severity: string) {
  const labels: Record<string, string> = {
    critical: "严重",
    warning: "警告",
    info: "提示",
  };
  return labels[severity] || severity || "未知";
}

export function maintenanceAgentRiskLabel(risk: string) {
  const labels: Record<string, string> = {
    read_only: "只读",
    safe_write: "安全写入",
    repair_write: "修复写入",
    destructive: "破坏性",
  };
  return labels[risk] || risk || "未知";
}

export function migrationTone(state: ClientMigrationState) {
  if (state === "aligned") {
    return "aligned";
  }

  if (state === "draining") {
    return "draining";
  }

  if (state === "offline") {
    return "offline";
  }

  return "attention";
}

export function migrationProgress(state: ClientMigrationState) {
  switch (state) {
    case "aligned":
      return 100;
    case "draining":
      return 68;
    case "outdated":
      return 28;
    case "bootstrap-only":
      return 12;
    case "offline":
      return 0;
    default:
      return 8;
  }
}

export function analysisExecutionModeLabel(value?: string) {
  const normalized = String(value || "").toLowerCase();

  if (normalized === "hybrid") {
    return "混合分析";
  }

  if (normalized === "external") {
    return "外置模块";
  }

  if (normalized === "builtin") {
    return "内置模块";
  }

  return value || "内置模块";
}

export function analysisModuleDescriptionForModule(
  module: { id?: string; description?: string } | null | undefined,
) {
  if (!module) {
    return "未发现可用分析模块，将使用内置启发式分析。";
  }

  if (module.id === "builtin:heuristic-hybrid-v1") {
    return "内置启发式分析管线，用于事务、人物、时间线和关联网络生成。";
  }

  return module.description || "外置分析模块。";
}
