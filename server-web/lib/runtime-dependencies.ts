import {
  downloadRuntimeDependency as downloadRuntimeDependencyClient,
  listRuntimeDependencies as listRuntimeDependenciesClient,
  type RuntimeDependency,
  type RuntimeDependencyActionResult,
  type RuntimeDependencyDetectionSource,
  type RuntimeDependencyDownloadStep,
  type RuntimeDependencyDownloadRun,
  type RuntimeDependencyLogEntry,
  type RuntimeDependencyListResponse,
} from "./runtime-dependencies-client";

export type {
  RuntimeDependency,
  RuntimeDependencyActionResult,
  RuntimeDependencyDetectionSource,
  RuntimeDependencyDownloadStep,
  RuntimeDependencyDownloadRun,
  RuntimeDependencyLogEntry,
  RuntimeDependencyListResponse,
} from "./runtime-dependencies-client";

export function statusLabel(status = "") {
  const labels: Record<string, string> = {
    queued: "等待安装",
    running: "安装中",
    present: "已存在",
    installed: "安装成功",
    failed: "安装失败",
  };
  return labels[status] || status || "未知";
}

export function statusTone(status = "") {
  if (status === "present" || status === "installed") return "success";
  if (status === "failed") return "danger";
  if (status === "running") return "info";
  if (status === "queued") return "warning";
  return "neutral";
}

export function childSummary(item: RuntimeDependency) {
  const children = item.children || [];
  if (!children.length) return "";
  return children.map((child) => `${child.label}: ${statusLabel(child.status)}`).join(" / ");
}

function languageRuntimeLabel(id = "", fallback = "") {
  const labels: Record<string, string> = {
    java: "Java 环境",
    jre: "Java 环境",
    node: "Node.js 环境",
    nodejs: "Node.js 环境",
    python: "Python 环境",
  };
  return labels[id] || fallback || id;
}

export function normalizeRuntimeDependencies(items: RuntimeDependency[] = []): RuntimeDependency[] {
  return items.flatMap((item) => {
    if (!["programming-runtimes", "language-runtimes"].includes(item.id) || !item.children?.length) {
      return [item];
    }
    return item.children.map((child) => ({
      ...child,
      label: languageRuntimeLabel(child.id, child.label),
    }));
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function formatDetectionSource(source: RuntimeDependencyDetectionSource | Record<string, unknown>): string {
  const label = String(source.label || "").trim();
  const sourcePath = String(source.path || "").trim();
  const detail = String(source.detail || "").trim();
  const base = [label, sourcePath].filter(Boolean).join("：");
  return [base, detail].filter(Boolean).join("；");
}

function stringField(source: Record<string, unknown>, key: string): string {
  return String(source[key] || "").trim();
}

export function runtimeVersionHint(item: RuntimeDependency): string {
  const detection = asRecord(item.detection);
  const version = stringField(detection, "javaVersion") ||
    stringField(detection, "pythonVersion") ||
    stringField(detection, "version");
  if (version) return `现在使用的版本：${version}`;
  const childVersions = (item.children || [])
    .map((child) => {
      const childVersion: string = runtimeVersionHint(child).replace(/^现在使用的版本：/, "");
      return childVersion ? `${child.label}: ${childVersion}` : "";
    })
    .filter(Boolean)
    .join(" / ");
  return `现在使用的版本：${childVersions || "未检测到"}`;
}

function hasItems(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

function labelForLocalPath(sourcePath = ""): string {
  if (sourcePath.includes("/server/platform/modules/")) return "平台本地运行时";
  if (sourcePath.includes("/runtime-dependencies/") || sourcePath.includes("/gateway-cache/")) return "平台缓存";
  if (sourcePath.includes("/build/local-data/")) return "平台缓存";
  if (sourcePath.includes("/Library/Mobile Documents/")) return "系统 iCloud";
  if (sourcePath.includes("/Library/CloudStorage/")) return "系统云盘目录";
  if (sourcePath.startsWith("/Applications/")) return "系统应用";
  if (/^\/(?:usr|opt|bin|sbin|var|System)\//.test(sourcePath) || sourcePath.includes("/.nvm/")) return "系统 PATH";
  return "本地路径";
}

function legacyDetectionSource(detection: Record<string, unknown>): string {
  const configPath = stringField(detection, "configPath");
  if ((detection.configured === true || hasItems(detection.configuredConnections)) && configPath) {
    return formatDetectionSource({ label: "平台配置", path: configPath });
  }
  const configuredBinary = stringField(detection, "configuredBinary");
  if (detection.configuredPresent === true && configuredBinary) {
    return formatDetectionSource({ label: "自定义配置", path: configuredBinary });
  }
  const cachedExecutablePath = stringField(detection, "cachedExecutablePath");
  if (detection.cachedPresent === true && cachedExecutablePath) {
    return formatDetectionSource({ label: "平台本地安装", path: cachedExecutablePath });
  }
  for (const key of ["dockerPath", "pathBinary", "nodePath"]) {
    const sourcePath = stringField(detection, key);
    if (sourcePath) return formatDetectionSource({ label: "系统 PATH", path: sourcePath });
  }
  const appPath = stringField(detection, "appPath");
  if (detection.appPresent === true && appPath) {
    return formatDetectionSource({ label: "系统应用", path: appPath });
  }
  for (const key of ["javaPath", "pythonPath", "icloudRoot", "cloudStorageRoot", "warPath", "artifactPath", "installerPath"]) {
    const sourcePath = stringField(detection, key);
    if (sourcePath) return formatDetectionSource({ label: labelForLocalPath(sourcePath), path: sourcePath });
  }
  return "";
}

export function sourceHint(item: RuntimeDependency): string {
  const detection = asRecord(item.detection);
  const source = asRecord(detection.source);
  const sourceText = formatDetectionSource(source);
  if (sourceText) return sourceText;
  const legacySourceText = legacyDetectionSource(detection);
  if (legacySourceText) return legacySourceText;
  const childSources: string[] = (item.children || [])
    .map((child) => {
      const childSource: string = sourceHint(child);
      return childSource ? `${child.label}: ${childSource}` : "";
    })
    .filter(Boolean);
  if (childSources.length) return childSources.join(" / ");
  return "未返回来源路径";
}

export function canTrigger(item: RuntimeDependency) {
  return item.downloadable !== false && item.status !== "present";
}

export function dependencyDownloadPayload(item: RuntimeDependency) {
  return { targetId: item.id, async: true };
}

export function isRuntimeDependencyRunActive(status = "") {
  return status === "queued" || status === "running";
}

export function runtimeDependencyLogText(log: RuntimeDependencyLogEntry[] = []) {
  return runtimeDependencyLogEntries(log)
    .map((entry) => `${entry.prefix ? `[${entry.prefix}] ` : ""}${entry.message}`)
    .join("\n");
}

export function runtimeDependencyLogEntries(log: RuntimeDependencyLogEntry[] = []) {
  return log
    .map((entry, index) => {
      const at = entry.at ? new Date(entry.at).toLocaleTimeString("zh-CN", { hour12: false }) : "";
      const level = String(entry.level || "info");
      const message = String(entry.message || "").trim();
      return {
        key: `${entry.at || ""}:${level}:${index}`,
        time: at,
        level,
        message,
        prefix: [at, level].filter(Boolean).join(" "),
      };
    })
    .filter((entry) => entry.message);
}

function progressSegmentState(status = "") {
  if (status === "completed" || status === "complete") return "complete";
  if (status === "running" || status === "active") return "active";
  if (status === "failed") return "failed";
  return "pending";
}

export function runtimeDependencyRunProgressState(run: RuntimeDependencyDownloadRun | null | undefined) {
  const steps = run?.steps || [];
  const totalSteps = Number(run?.totalSteps || steps.length || 0);
  const completedSteps = Number(
    run?.completedSteps ?? steps.filter((step) => step.status === "completed").length,
  );
  const explicitPercent = Number(run?.progressPercent);
  const progressPercent = Number.isFinite(explicitPercent)
    ? Math.max(0, Math.min(100, explicitPercent))
    : totalSteps
      ? Math.round((completedSteps / totalSteps) * 100)
      : 0;
  return {
    completedSteps,
    detail: run?.latestMessage || "",
    label: totalSteps ? `${completedSteps}/${totalSteps}` : "",
    progressPercent,
    segments: steps.map((step: RuntimeDependencyDownloadStep) => ({
      key: step.key,
      label: step.label || step.key,
      state: progressSegmentState(step.status),
    })),
    totalSteps,
  };
}

export function listRuntimeDependencies(): Promise<RuntimeDependencyListResponse> {
  return listRuntimeDependenciesClient();
}

export function downloadRuntimeDependency(item: RuntimeDependency): Promise<RuntimeDependencyActionResult> {
  return downloadRuntimeDependencyClient(dependencyDownloadPayload(item));
}
