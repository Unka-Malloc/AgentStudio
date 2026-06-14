import { getJson, postJson } from "./bridge-http";

export type RuntimeDependency = {
  id: string;
  label: string;
  category?: string;
  description?: string;
  status: string;
  present?: boolean;
  cached?: boolean;
  downloadable?: boolean;
  children?: RuntimeDependency[];
  detection?: Record<string, unknown>;
  actions?: Record<string, unknown>;
  accepts?: Record<string, boolean>;
  configuration?: RuntimeDependencyConfigurationGroup[];
};

export type RuntimeDependencyConfigurationEntry = {
  editable?: boolean;
  kind?: string;
  key: string;
  label: string;
  inputType?: string;
  options?: Array<{ label: string; value: string }>;
  value?: string;
  configured?: boolean;
  required?: boolean;
  source?: string;
  description?: string;
};

export type RuntimeDependencyConfigurationGroup = {
  kind?: string;
  title: string;
  entries?: RuntimeDependencyConfigurationEntry[];
};

export type RuntimeDependencyDetectionSource = {
  kind?: string;
  label?: string;
  path?: string;
  detail?: string;
};

export type RuntimeDependencyLogEntry = {
  at?: string;
  level?: string;
  message?: string;
  data?: Record<string, unknown>;
};

export type RuntimeDependencyDownloadStep = {
  key: string;
  label: string;
  index?: number;
  status: string;
  startedAt?: string;
  updatedAt?: string;
  completedAt?: string;
};

export type RuntimeDependencyDownloadRun = {
  runId: string;
  targetId: string;
  status: string;
  ok?: boolean;
  startedAt?: string;
  updatedAt?: string;
  completedAt?: string;
  latestMessage?: string;
  steps?: RuntimeDependencyDownloadStep[];
  completedSteps?: number;
  totalSteps?: number;
  currentStepKey?: string;
  currentStepIndex?: number;
  progressPercent?: number;
  log?: RuntimeDependencyLogEntry[];
  result?: RuntimeDependencyActionResult | null;
};

export type RuntimeDependencyListResponse = {
  ok: boolean;
  generatedAt?: string;
  cacheRoot?: string;
  sourceConfigPath?: string;
  triggerMode?: string;
  targets?: string[];
  selectedTargets?: string[];
  partial?: boolean;
  dependencies?: RuntimeDependency[];
  downloads?: RuntimeDependencyDownloadRun[];
  summary?: Record<string, number>;
};

export type RuntimeDependencyActionResult = {
  ok: boolean;
  targetId?: string;
  status?: string;
  runId?: string;
  run?: RuntimeDependencyDownloadRun;
  log?: RuntimeDependencyLogEntry[];
  reason?: string;
  mirrorHint?: string;
  sourceConfigPath?: string;
  detection?: RuntimeDependency;
  results?: RuntimeDependencyActionResult[];
};

export type RuntimeDependencyConfigurationUpdateEntry = {
  key: string;
  value?: string;
};

export type RuntimeDependencyConfigurationUpdateResult = {
  ok: boolean;
  generatedAt?: string;
  protocolVersion?: string;
  schemaVersion?: string;
  sourceConfigPath?: string;
  updated?: number;
};

export type ListRuntimeDependenciesOptions = {
  targetId?: string;
  targets?: string[];
};

function runtimeDependencyListUrl(options: ListRuntimeDependenciesOptions = {}) {
  const query = new URLSearchParams();
  if (options.targetId) {
    query.set("targetId", options.targetId);
  }
  if (options.targets?.length) {
    query.set("targets", options.targets.join(","));
  }
  const queryString = query.toString();
  return `/api/runtime/dependencies${queryString ? `?${queryString}` : ""}`;
}

export function listRuntimeDependencies(options: ListRuntimeDependenciesOptions = {}) {
  return getJson<RuntimeDependencyListResponse>(runtimeDependencyListUrl(options));
}

export function downloadRuntimeDependency(payload: Record<string, unknown>) {
  return postJson<RuntimeDependencyActionResult>(
    "/api/runtime/dependencies/download",
    {
      ...payload,
      confirm: true,
    },
    { safetyConfirm: true },
  );
}

export function saveRuntimeDependencyConfiguration(payload: {
  targetId?: string;
  entries: RuntimeDependencyConfigurationUpdateEntry[];
}) {
  return postJson<RuntimeDependencyConfigurationUpdateResult>(
    "/api/runtime/dependencies/configuration",
    payload,
  );
}
