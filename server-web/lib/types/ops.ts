export type BackgroundProcessItem = {
  role: string;
  label: string;
  description: string;
  processType?: "service" | "daemon" | string;
  responsibility?: string;
  services?: string[];
  features?: string[];
  monitors?: string[];
  alerts?: string[];
  desired: boolean;
  pid: number;
  alive: boolean;
  stale: boolean;
  status: string;
  mode?: string;
  startedAt?: string;
  lastHeartbeatAt?: string;
  heartbeatAgeMs?: number | null;
  restartCount: number;
  lastExit?: Record<string, unknown> | null;
  details?: Record<string, unknown>;
  error?: string;
  unifiedRegistration?: UnifiedRegistrationRecord;
};

export type UnifiedOriginalType = "process" | "queue" | "task" | "monitor" | "alert" | string;

export type UnifiedRegistrationRecord = {
  schemaVersion: string;
  registrationId: string;
  originalType: UnifiedOriginalType;
  originalId: string;
  label: string;
  status: string;
  tone: string;
  source: string;
  registeredAt: string;
  route: {
    originalType: UnifiedOriginalType;
    section: string;
    behavior: string;
  };
  relations: Record<string, unknown>;
  attributes: Record<string, unknown>;
  originalRef: Record<string, unknown>;
};

export type UnifiedSystemStatus = {
  schemaVersion: string;
  updatedAt: string;
  source: string;
  summary: {
    totalCount: number;
    processCount: number;
    queueCount: number;
    taskCount: number;
    monitorCount: number;
    alertCount: number;
  };
  registrations: UnifiedRegistrationRecord[];
  routes: Record<string, { section: string; behavior: string }>;
  processes: UnifiedRegistrationRecord[];
  queues: UnifiedRegistrationRecord[];
  tasks: UnifiedRegistrationRecord[];
  monitors: UnifiedRegistrationRecord[];
  alerts: UnifiedRegistrationRecord[];
};

export type ClientRuntimeHeatRow = {
  clientUid: string;
  clientKey: string;
  profileId: string;
  matched: boolean;
  workspaceId: string;
  contextProfileId: string;
  retrievalProfileId: string;
  modelAlias: string;
  taskTypes: Array<{ taskType: string; count: number }>;
  surfaces: Array<{ surface: string; count: number }>;
  firstSeenAt: string;
  lastSeenAt: string;
  coolingState: "hot" | "warm" | "cooled" | string;
  heatLevel: "hot" | "warm" | "cold" | string;
  coolingReason: string;
  totalCalls: number;
  recentCalls: number;
  heatScore: number;
  heatPercent: number;
  ageMs: number;
};

export type ClientRuntimeStatus = {
  protocolVersion: string;
  schemaVersion: string;
  updatedAt: string;
  configPath: string;
  usagePath: string;
  coolingPolicy: Record<string, unknown>;
  summary: {
    totalClients: number;
    hotClients: number;
    warmClients: number;
    cooledClients: number;
    totalCalls: number;
    workspaceCount: number;
    contextCount: number;
  };
  heatmap: {
    clients: ClientRuntimeHeatRow[];
    workspaces: Array<Record<string, unknown>>;
    contexts: Array<Record<string, unknown>>;
  };
  cooledClients: ClientRuntimeHeatRow[];
};

export type BackgroundProcessStatus = {
  schemaVersion: string;
  ok: boolean;
  status: string;
  updatedAt: string;
  statePath: string;
  supervisor: {
    pid: number;
    alive: boolean;
    status: string;
    startedAt?: string;
    roles?: string[];
  };
  processes: BackgroundProcessItem[];
  systemStatus?: UnifiedSystemStatus;
};

export type BackgroundSupervisorRecovery = {
  ok: boolean;
  attempted: boolean;
  action?: string;
  reason?: string;
  platform?: string;
  serviceLabel?: string;
  serviceTarget?: string;
  launchTarget?: string;
  plistPath?: string;
  checkedAt?: string;
  commands?: Array<{
    args: string[];
    code: number;
    signal?: string;
    stderr?: string;
    stdout?: string;
  }>;
};

export type BackgroundSupervisorRecoveryResponse = {
  recovery: BackgroundSupervisorRecovery;
  backgroundProcessStatus?: BackgroundProcessStatus | null;
  monitorAlertState?: MonitorAlertState | null;
};

export type MonitorAlertRule = {
  enabled: boolean;
  severity: string;
  statuses?: string[];
  restartCountThreshold?: number;
  titleTemplate: string;
  messageTemplate: string;
};

export type MonitorAlertConfig = {
  schemaVersion: string;
  enabled: boolean;
  intervalMs: number;
  heartbeatStaleMs: number;
  queueHeartbeatStaleMs?: number;
  recoverInterruptedQueues?: boolean;
  historyLimit: number;
  serviceLabel?: string;
  rules: Record<string, MonitorAlertRule>;
};

export type MonitorAlertItem = {
  alertId: string;
  ruleId: string;
  severity: string;
  title: string;
  message: string;
  source: string;
  role: string;
  status: string;
  active: boolean;
  ackRequired?: boolean;
  acknowledgedAt?: string;
  queueId?: string;
  interruptedAt?: string;
  recoveredAt?: string;
  tone?: string;
  evidence?: Record<string, unknown>;
  firstSeenAt: string;
  lastSeenAt: string;
  resolvedAt?: string;
  variables?: Record<string, unknown>;
  unifiedRegistration?: UnifiedRegistrationRecord;
};

export type QueueMonitorItem = {
  queueId: string;
  kind: string;
  ownerId: string;
  label: string;
  source: string;
  sources?: string[];
  lifecycleStatus: string;
  phase: string;
  status: string;
  startedAt?: string;
  closedAt?: string;
  lastHeartbeatAt?: string;
  checkpointId?: string;
  checkpointTreeId?: string;
  lastCheckpointAt?: string;
  recoveryAttemptedAt?: string;
  recoveryQueuedAt?: string;
  recoveredAt?: string;
  interruptedAt?: string;
  interruptedReason?: string;
  acknowledgedAt?: string;
  recoveryStatus?: string;
  evidence?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  unifiedRegistration?: UnifiedRegistrationRecord;
};

export type QueueMonitorState = {
  schemaVersion: string;
  updatedAt: string;
  statePath: string;
  eventLogPath: string;
  summary: {
    totalCount: number;
    openCount: number;
    interruptedCount: number;
    recoveredCount: number;
    closedCount: number;
  };
  items: QueueMonitorItem[];
  systemStatus?: UnifiedSystemStatus;
};

export type MonitorAlertState = {
  schemaVersion: string;
  ok: boolean;
  status: string;
  updatedAt: string;
  configPath: string;
  shellConfigPath?: string;
  statePath: string;
  config: MonitorAlertConfig;
  summary: {
    activeCount: number;
    visibleCount?: number;
    recoveredCount?: number;
    criticalCount: number;
    warningCount: number;
    historyCount: number;
  };
  queueMonitor?: QueueMonitorState | null;
  acknowledgedAlerts?: Record<string, string>;
  systemStatus?: UnifiedSystemStatus;
  activeAlerts: MonitorAlertItem[];
  history: MonitorAlertItem[];
};
