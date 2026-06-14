import {
  downloadRuntimeDependency as downloadRuntimeDependencyClient,
  listRuntimeDependencies as listRuntimeDependenciesClient,
  saveRuntimeDependencyConfiguration as saveRuntimeDependencyConfigurationClient,
  type ListRuntimeDependenciesOptions,
  type RuntimeDependency,
  type RuntimeDependencyActionResult,
  type RuntimeDependencyConfigurationEntry,
  type RuntimeDependencyConfigurationGroup,
  type RuntimeDependencyConfigurationUpdateEntry,
  type RuntimeDependencyConfigurationUpdateResult,
  type RuntimeDependencyDetectionSource,
  type RuntimeDependencyDownloadStep,
  type RuntimeDependencyDownloadRun,
  type RuntimeDependencyLogEntry,
  type RuntimeDependencyListResponse,
} from "./runtime-dependencies-client";

const PATH_ENV_SOURCE_LABEL = "环境变量: PATH";

export type {
  RuntimeDependency,
  RuntimeDependencyActionResult,
  RuntimeDependencyConfigurationEntry,
  RuntimeDependencyConfigurationGroup,
  RuntimeDependencyConfigurationUpdateEntry,
  RuntimeDependencyConfigurationUpdateResult,
  RuntimeDependencyDetectionSource,
  RuntimeDependencyDownloadStep,
  RuntimeDependencyDownloadRun,
  RuntimeDependencyLogEntry,
  RuntimeDependencyListResponse,
  ListRuntimeDependenciesOptions,
} from "./runtime-dependencies-client";

export function statusLabel(status = "") {
  const labels: Record<string, string> = {
    queued: "等待安装",
    running: "安装中",
    loading: "检测中",
    present: "已存在",
    installed: "安装成功",
    failed: "不可用",
  };
  return labels[status] || status || "未知";
}

export function statusTone(status = "") {
  if (status === "present" || status === "installed") return "success";
  if (status === "failed") return "danger";
  if (status === "running" || status === "loading") return "info";
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

export type RuntimeDependencySourceParts = {
  detail: string;
  path: string;
  source: string;
};

function sourcePartsFromDetectionSource(
  source: RuntimeDependencyDetectionSource | Record<string, unknown>,
): RuntimeDependencySourceParts | null {
  const label = String(source.label || "").trim();
  const sourcePath = String(source.path || "").trim();
  const detail = String(source.detail || "").trim();
  if (!label && !sourcePath && !detail) return null;
  return {
    detail,
    path: sourcePath,
    source: label || detail || "检测来源",
  };
}

function stringField(source: Record<string, unknown>, key: string): string {
  return String(source[key] || "").trim();
}

function configuredEntryValue(value: unknown): string {
  const text = String(value || "").trim();
  return text && text !== "未配置" ? text : "";
}

function versionFromText(value = ""): string {
  const match = String(value).match(/(?:^|[^\d])v?(\d+(?:\.\d+){1,3}(?:[+_~-][A-Za-z0-9.]+)?)/);
  return match?.[1]?.replace(/_/g, "+") || "";
}

function configuredVersion(item: RuntimeDependency): string {
  const entries = (item.configuration || []).flatMap((group) => group.entries || []);
  for (const entry of entries) {
    const key = String(entry.key || "").toLowerCase();
    const label = String(entry.label || "").toLowerCase();
    const value = configuredEntryValue(entry.value);
    if (value && (key.endsWith("version") || key.endsWith("_version") || label.includes("版本"))) {
      return value;
    }
  }
  for (const entry of entries) {
    const key = String(entry.key || "").toLowerCase();
    const value = configuredEntryValue(entry.value);
    if (value && /\.(?:url|warurl|filename)$/.test(key)) {
      const version = versionFromText(value);
      if (version) return version;
    }
  }
  return "";
}

export function runtimeVersionHint(item: RuntimeDependency): string {
  const detection = asRecord(item.detection);
  const availabilityLabel = stringField(detection, "availabilityLabel");
  if (availabilityLabel) return availabilityLabel;
  const version = stringField(detection, "javaVersion") ||
    stringField(detection, "pythonVersion") ||
    stringField(detection, "version") ||
    configuredVersion(item);
  if (version) return version;
  const childVersions = (item.children || [])
    .map((child) => {
      const childVersion: string = runtimeVersionHint(child);
      return childVersion && childVersion !== "未检测到" ? `${child.label}: ${childVersion}` : "";
    })
    .filter(Boolean)
    .join(" / ");
  return childVersions || "未检测到";
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
  if (/^\/(?:usr|opt|bin|sbin|var|System)\//.test(sourcePath) || sourcePath.includes("/.nvm/")) return PATH_ENV_SOURCE_LABEL;
  return "本地路径";
}

function legacyDetectionSourceParts(detection: Record<string, unknown>): RuntimeDependencySourceParts | null {
  const configPath = stringField(detection, "configPath");
  if ((detection.configured === true || hasItems(detection.configuredConnections)) && configPath) {
    return sourcePartsFromDetectionSource({ label: "平台配置", path: configPath });
  }
  const configuredBinary = stringField(detection, "configuredBinary");
  if (detection.configuredPresent === true && configuredBinary) {
    return sourcePartsFromDetectionSource({ label: "自定义配置", path: configuredBinary });
  }
  const cachedExecutablePath = stringField(detection, "cachedExecutablePath");
  if (detection.cachedPresent === true && cachedExecutablePath) {
    return sourcePartsFromDetectionSource({ label: "平台本地安装", path: cachedExecutablePath });
  }
  for (const key of ["dockerPath", "pathBinary", "nodePath"]) {
    const sourcePath = stringField(detection, key);
    if (sourcePath) return sourcePartsFromDetectionSource({ label: PATH_ENV_SOURCE_LABEL, path: sourcePath });
  }
  const appPath = stringField(detection, "appPath");
  if (detection.appPresent === true && appPath) {
    return sourcePartsFromDetectionSource({ label: "系统应用", path: appPath });
  }
  for (const key of ["javaPath", "pythonPath", "icloudRoot", "cloudStorageRoot", "warPath", "artifactPath", "installerPath"]) {
    const sourcePath = stringField(detection, key);
    if (sourcePath) return sourcePartsFromDetectionSource({ label: labelForLocalPath(sourcePath), path: sourcePath });
  }
  return null;
}

function sourcePartsText(parts: RuntimeDependencySourceParts): string {
  return formatDetectionSource({
    detail: parts.detail,
    label: parts.source,
    path: parts.path,
  });
}

export function sourceParts(item: RuntimeDependency): RuntimeDependencySourceParts {
  const detection = asRecord(item.detection);
  const source = asRecord(detection.source);
  const explicitParts = sourcePartsFromDetectionSource(source);
  if (explicitParts) return explicitParts;
  const legacyParts = legacyDetectionSourceParts(detection);
  if (legacyParts) return legacyParts;
  const childSources: string[] = (item.children || [])
    .map((child) => {
      const childSource = sourceParts(child);
      const childSourceText = sourcePartsText(childSource);
      return childSourceText ? `${child.label}: ${childSourceText}` : "";
    })
    .filter(Boolean);
  if (childSources.length) {
    return {
      detail: "",
      path: childSources.join(" / "),
      source: "子依赖",
    };
  }
  return {
    detail: "",
    path: "未返回路径",
    source: "未返回来源",
  };
}

export function sourceHint(item: RuntimeDependency): string {
  return sourcePartsText(sourceParts(item)) || "未返回来源路径";
}

export function runtimeConfigurationGroups(item: RuntimeDependency): RuntimeDependencyConfigurationGroup[] {
  const explicitGroups = (item.configuration || [])
    .map((group) => ({
      ...group,
      entries: (group.entries || []).filter((entry) => entry.label || entry.key || entry.value),
    }))
    .filter((group) => group.title && group.entries.length);
  if (explicitGroups.length) return explicitGroups;
  const detection = asRecord(item.detection);
  const entries = Object.entries(detection)
    .filter(([key, value]) => !["source", "sourcePolicy"].includes(key) && value !== undefined && value !== null && value !== "")
    .map(([key, value]) => ({
      kind: "detection",
      key,
      label: key,
      value: Array.isArray(value) ? value.join(", ") : String(value),
      configured: true,
    }));
  return entries.length ? [{ kind: "detection", title: "检测字段", entries }] : [];
}

export function canTrigger(item: RuntimeDependency) {
  return item.downloadable !== false && !["loading", "present"].includes(item.status);
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

export function listRuntimeDependencies(
  options: ListRuntimeDependenciesOptions = {},
): Promise<RuntimeDependencyListResponse> {
  return listRuntimeDependenciesClient(options);
}

export function downloadRuntimeDependency(item: RuntimeDependency): Promise<RuntimeDependencyActionResult> {
  return downloadRuntimeDependencyClient(dependencyDownloadPayload(item));
}

export function saveRuntimeDependencyConfiguration(
  targetId: string,
  entries: RuntimeDependencyConfigurationUpdateEntry[],
): Promise<RuntimeDependencyConfigurationUpdateResult> {
  return saveRuntimeDependencyConfigurationClient({ targetId, entries });
}
