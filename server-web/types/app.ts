import type {
  AgentExploreRunResponse,
  AgentSelectorOption,
  AgentSettings,
  DiscoveryConfig,
  KnowledgeSearchResponse,
  KnowledgeSearchResult,
  MonitorAlertState,
  ServerPathBrowseResponse,
  UnifiedRegistrationRecord,
} from "../lib/types";

export type DrawerTab =
  | "preferences"
  | "discovery"
  | "users";
export type AppView =
  | "dashboard"
  | "feed"
  | "approval"
  | "debug"
  | "sources"
  | "externalServices"
  | "knowledge"
  | "workspaces"
  | "admin";
export type DebugTab = "knowledgeRecall" | "agentRetrieval" | "knowledgeDistillation";
export type ExternalServiceTab = "list";
export type RuleAuthoringMode = "chat" | "manual";
export type AdminView =
  | "jobs"
  | "logs"
  | "tools"
  | "toolList"
  | "toolGovernance"
  | "toolStats"
  | "agentPermissions"
  | "agentConfig"
  | "agentAssignment"
  | "contextManagement"
  | "maintenanceAgent"
  | "opsMonitor"
  | "runtimeDownloads"
  | "strategyManagement"
  | "versionRelease"
  | "versionAssembly"
  | "productionHealth"
  | "clients"
  | "storage"
  | "modules";
export type KnowledgeTab = "management" | "wordCloud" | "maintenance" | "chunking" | "distillation";
export type KnowledgeManagementPanel = "knowledge" | "rules" | "expert";
export type OptionBarValue = string | number | boolean;
export type OptionBarOption = {
  value: OptionBarValue;
  label: string;
  disabled?: boolean;
  swatches?: string[];
  icon?: "moon" | "sun";
};
export type KnowledgeLogRow = {
  logId: string;
  kindLabel: string;
  displayId: string;
  target: string;
  status: string;
  statusLabel: string;
  tone: string;
  stage: string;
  occurredAt: string;
  createdAt: string;
  progressPercent: number;
  detail: string;
  error: string;
};
export type AgentExploreSession = {
  runId: string;
  workspaceId: string;
  query: string;
  modelAlias: string;
  contextProfileId: string;
  thinkingMode: string;
  temperature: number;
  maxTokens: number;
  maxIterations: number;
  limit: number;
  toolChoice: string;
  status: string;
  answerPreview: string;
  updatedAt: string;
};
export type KnowledgeRecallDebugRun = {
  runId: string;
  label: string;
  topK: number;
  status: "queued" | "running" | "completed" | "failed";
  elapsedMs: number;
  startedAt: string;
  response: KnowledgeSearchResponse | null;
  items: KnowledgeSearchResult[];
  error: string;
};
export type HistorySessionPanelItem = {
  id: string;
  title: string;
  meta?: string;
  preview?: string;
  active?: boolean;
  disabled?: boolean;
  actionLabel?: string;
  actionAriaLabel?: string;
  actionDisabled?: boolean;
  deleteText?: string;
  deleteLabel?: string;
};
export type ModelEntryBinding = {
  bindingId: string;
  category: string;
  label: string;
  detail: string;
  source: "draft" | "settings" | "runtime";
};
export type AgentConfigurationAlert = {
  alertId: string;
  category: string;
  title: string;
  detail: string;
  status: string;
  tone: "warning" | "danger";
  view: AppView;
  adminView?: AdminView;
  targetId: string;
};
export type DashboardAlert = {
  alertId: string;
  category: string;
  title: string;
  detail: string;
  status: string;
  tone: "warning" | "danger" | "success";
  actionLabel: string;
  source: "configuration" | "monitor";
  actionKind?: "open" | "recover-supervisor";
  firstSeenAt?: string;
  lastSeenAt?: string;
  live?: boolean;
  resolvedAt?: string;
  configAlert?: AgentConfigurationAlert;
  monitorAlert?: MonitorAlertState["activeAlerts"][number];
};
export type WorkQueueRow = {
  rowId: string;
  queueId: string;
  kind: string;
  label: string;
  ownerId: string;
  source: "queue-monitor" | "split-job" | "maintenance-agent";
  sourceLabel: string;
  lifecycleStatus: string;
  status: string;
  phase: string;
  tone: string;
  startedAt: string;
  updatedAt: string;
  lastHeartbeatAt: string;
  checkpointTreeId: string;
  detail: string;
  registration?: UnifiedRegistrationRecord;
};
export type InfoFeedStageStatus = "idle" | "running" | "completed" | "failed";
export type InfoFeedAttachment = {
  id: string;
  name: string;
  size: number;
  type: string;
  status: InfoFeedStageStatus;
  progress: number;
  text: string;
  error: string;
};
export type InfoFeedClarificationOption = {
  optionId: string;
  label: string;
  description: string;
  followUpQuestion: string;
};
export type InfoFeedExpertFeedbackAnchor = "summary" | "report";
export type InfoFeedClarification = {
  questionId: string;
  prompt: string;
  reason: string;
  anchor: InfoFeedExpertFeedbackAnchor;
  status: "open" | "answered";
  selectedOptionId: string;
  options: InfoFeedClarificationOption[];
};
export type InfoFeedExpertFeedback = {
  feedbackId: string;
  questionId: string;
  anchor: InfoFeedExpertFeedbackAnchor;
  prompt: string;
  reason: string;
  selectedOptionId: string;
  selectedLabel: string;
  selectedDescription: string;
  followUpQuestion: string;
  sourceQuery: string;
  createdAt: string;
  syncedAt: string;
  syncStatus: "pending" | "synced" | "failed";
  syncError: string;
};
export type InfoFeedTurnSnapshot = {
  turnId: string;
  query: string;
  followUpQuestion: string;
  attachments?: InfoFeedAttachment[];
  completedAt: string;
  summaryAnswer: string;
  summaryError: string;
  summaryFallback: boolean;
  summaryModelAlias: string;
  evidenceRefs: string[];
  expertFeedback: InfoFeedExpertFeedback[];
};
export type InfoFeedRetryStage = "keyword" | "agent" | "summary";
export type InfoFeedRetryState = {
  stage: InfoFeedRetryStage;
  attempts: number;
  limit: number;
  error: string;
  updatedAt: string;
};
export type InfoFeedRunState = {
  runId: string;
  query: string;
  startedAt: string;
  completedAt: string;
  attachments: InfoFeedAttachment[];
  followUp?: {
    parentRunId: string;
    parentQuery: string;
    question: string;
    parentSummary: string;
    parentEvidenceRefs: string[];
  };
  clarification?: InfoFeedClarification;
  expertFeedback: InfoFeedExpertFeedback[];
  turns: InfoFeedTurnSnapshot[];
  keyword: {
    status: InfoFeedStageStatus;
    progress: number;
    stage: string;
    fromCache: boolean;
    response: KnowledgeSearchResponse | null;
    error: string;
  };
  agent: {
    status: InfoFeedStageStatus;
    progress: number;
    runId: string;
    workspaceId: string;
    response: AgentExploreRunResponse | null;
    error: string;
  };
  summary: {
    status: InfoFeedStageStatus;
    progress: number;
    modelAlias: string;
    contextProfileId: string;
    parametersOpen: boolean;
    temperature?: number;
    maxTokens?: number;
    answer: string;
    error: string;
    fallback: boolean;
  };
  pausedForModelSelection?: "agent" | "summary" | "";
  pausedForRetry?: InfoFeedRetryStage | "";
  retry?: InfoFeedRetryState;
};
export type PathPickerMode = "directory" | "file";
export type PathPickerState = {
  open: boolean;
  title: string;
  mode: PathPickerMode;
  value: string;
  extensions: string[];
  includeHidden: boolean;
  loading: boolean;
  error: string;
  response: ServerPathBrowseResponse | null;
  closeOnSelect: boolean;
  applyPath: (nextPath: string) => void;
};
export type WordCloudCorpusAuditAction = "add" | "remove" | "clear" | "save";
export type RefreshStateOptions = {
  silent?: boolean;
  forceSettings?: boolean;
  forceDrafts?: boolean;
};
export type CloudProvider =
  | "google-gemini"
  | "openai-chatgpt"
  | "deepseek"
  | "openrouter"
  | "copilot"
  | "custom-http"
  | "local-model";
