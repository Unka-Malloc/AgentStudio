import type {
  AgentSettings,
  AgentRegistryResponse,
  AgentSyncConfig,
  AgentSyncPublishRequest,
  BackgroundProcessStatus,
  BackgroundSupervisorRecoveryResponse,
  ClientRuntimeStatus,
  CodexOAuthLogin,
  CodexOAuthStatus,
  DiscoveryConfig,
  DiscoveryConfigResponse,
  DiscoveryClientsResponse,
  DocumentParseResponse,
  DocumentParsingConfig,
  EmailRuleSetResponse,
  EventSubscriptionResponse,
  ExpertVocabularyHistoryResponse,
  ExpertVocabularyResponse,
  KnowledgeConfigSchema,
  KnowledgeConsoleState,
  KnowledgeRuleAuthoringResponse,
  KnowledgeWordCloudExportResponse,
  KnowledgeWordCloudImportResponse,
  KnowledgeWordCloudProposeResponse,
  KnowledgeWordBag,
  KnowledgeWordBagMutationResponse,
  KnowledgeWordBagSet,
  KnowledgeWordBagTermsResponse,
  KnowledgeWordCloudState,
  MaintenanceAgentConfig,
  MaintenanceAgentRun,
  MaintenanceAgentSummary,
  MaintenanceSettings,
  MonitorAlertConfig,
  MonitorAlertState,
  ModelProbeResponse,
  ProductionHealthResponse,
  RenderMarkdownResponse,
  ServerPathBrowseResponse,
  RuntimeMountReloadResponse,
  RuntimeMountConfig,
  RuntimeMountsResponse,
  RuntimeInfoResponse,
  ServerConsoleState,
  SplitJob,
  SplitJobListResponse,
  SplitPayload,
  SplitResult,
  UploadSessionResponse,
  V001BaselineStatus,
} from "./types";
import type {
  ConsoleAuditItem,
  ConsoleAuthSummary,
  ConsoleOidcConfig,
  ConsoleUser,
} from "./auth-types";
import type {
  BridgeDownloadOptions,
  BridgeDownloadResult,
  BridgeRequestOptions,
} from "./bridge-http";
import type {
  AuthorizationGovernanceKind,
  AuthorizationGovernanceResponse,
  McpAuthorizationRequest,
  ResolveMcpAuthorizationRequestPayload,
} from "./authorization-governance-client";
import type {
  CreateToolGrantPayload,
  ToolManagementAuditResponse,
  ToolManagementCatalog,
  ToolManagementGrantIssue,
  ToolManagementGrantsResponse,
  ToolManagementMetricsResponse,
  UpdateToolGrantPayload,
} from "./tool-management-client";
import type {
  AgentGatewayCallRequest,
  AgentGatewayCallResponse,
  AgentGatewayConfig,
} from "./agent-gateway-client";
import type {
  CreateKnowledgeDistillationWorkbenchRunPayload,
} from "./knowledge-distillation-workbench-client";
import type {
  KnowledgeSourceMutationResponse,
  KnowledgeSourceState,
} from "./knowledge-sources-client";
import type {
  EvidencePack,
  KnowledgeSearchResponse,
} from "./knowledge-search-client";
import type {
  KnowledgeReviewItem,
  KnowledgeReviewItemsResponse,
} from "./knowledge-review-client";
import type {
  AgentExploreRunResponse,
  AgentWorkspaceListResponse,
} from "./agent-explore-client";
import type {
  RuntimeDependencyActionResult,
  RuntimeDependencyConfigurationUpdateEntry,
  RuntimeDependencyConfigurationUpdateResult,
  RuntimeDependencyListResponse,
} from "./runtime-dependencies-client";

export type Bridge = {
  getAuthSession: () => Promise<ConsoleAuthSummary>;
  loginAuth: (payload: { username: string; password: string }) => Promise<ConsoleAuthSummary & { ok: boolean }>;
  logoutAuth: () => Promise<{ ok: boolean }>;
  listAuthUsers: () => Promise<{ users: ConsoleUser[]; roles: ConsoleAuthSummary["roles"] }>;
  updateAuthUser: (
    userId: string,
    payload: { displayName?: string; password?: string; roleId?: string; enabled?: boolean },
  ) => Promise<{ user: ConsoleUser; users: ConsoleUser[] }>;
  getAuthOidc: () => Promise<{ oidc: ConsoleOidcConfig }>;
  saveAuthOidc: (payload: Partial<ConsoleOidcConfig> & { clientSecret?: string }) => Promise<{ oidc: ConsoleOidcConfig }>;
  listAuthAudit: (limit?: number) => Promise<{ items: ConsoleAuditItem[] }>;
  listAuthSessions: () => Promise<{ sessions: Array<Record<string, unknown>> }>;
  revokeAuthSession: (sessionId: string) => Promise<{ ok: boolean }>;
  getAuthorizationGovernance: () => Promise<AuthorizationGovernanceResponse>;
  upsertAuthorizationGovernance: (
    kind: AuthorizationGovernanceKind,
    payload: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
  revokeAuthorizationApproval: (approvalId: string, reason?: string) => Promise<Record<string, unknown>>;
  listMcpAuthorizationRequests: (status?: string) => Promise<{ requests: McpAuthorizationRequest[] }>;
  resolveMcpAuthorizationRequest: (
    requestId: string,
    payload: ResolveMcpAuthorizationRequestPayload,
  ) => Promise<{ ok: boolean; grantId?: string }>;
  getSettings: () => Promise<AgentSettings>;
  saveSettings: (settings: AgentSettings) => Promise<AgentSettings>;
  probeModel: (payload: {
    provider: string;
    modelAlias?: string;
    settings?: AgentSettings;
  }) => Promise<ModelProbeResponse>;
  downloadFile: (url: string, options?: BridgeDownloadOptions) => Promise<BridgeDownloadResult>;
  getAgentGatewayConfig: () => Promise<{ config: AgentGatewayConfig }>;
  saveAgentGatewayConfig: (config: Partial<AgentGatewayConfig>) => Promise<{ config: AgentGatewayConfig }>;
  callAgentGateway: (payload: AgentGatewayCallRequest) => Promise<AgentGatewayCallResponse>;
  listAgents: () => Promise<AgentRegistryResponse>;
  runKnowledgeAgentExplore: (payload: Record<string, unknown>) => Promise<AgentExploreRunResponse>;
  getKnowledgeAgentExploreRun: (runId: string, params?: { workspaceId?: string }) => Promise<AgentExploreRunResponse>;
  listAgentWorkspaces: (params?: { limit?: number; includeSummary?: boolean }) => Promise<AgentWorkspaceListResponse>;
  getAgentWorkspace: (workspaceId: string, params?: { includePrivate?: boolean }) => Promise<Record<string, unknown>>;
  getAgentSyncConfig: () => Promise<{ config: AgentSyncConfig }>;
  saveAgentSyncConfig: (config: Partial<AgentSyncConfig>) => Promise<{ config: AgentSyncConfig }>;
  publishAgentSync: (payload: AgentSyncPublishRequest) => Promise<Record<string, unknown>>;
  subscribeAgentSync: (params?: {
    cursor?: number;
    topic?: string;
    timeoutMs?: number;
    includeSnapshot?: boolean;
  }) => Promise<EventSubscriptionResponse>;
  getCodexOAuthStatus: () => Promise<CodexOAuthStatus>;
  startCodexOAuthLogin: () => Promise<CodexOAuthLogin>;
  getRuntimeInfo: () => Promise<RuntimeInfoResponse>;
  browseServerPath: (payload: {
    path?: string;
    mode?: "directory" | "file";
    extensions?: string[];
    includeHidden?: boolean;
  }) => Promise<ServerPathBrowseResponse>;
  saveRuntimeMounts: (payload: Partial<RuntimeMountConfig>) => Promise<RuntimeMountsResponse>;
  reloadRuntimeMounts: (settings?: AgentSettings) => Promise<RuntimeMountReloadResponse>;
  listRuntimeDependencies: () => Promise<RuntimeDependencyListResponse>;
  downloadRuntimeDependency: (payload: Record<string, unknown>) => Promise<RuntimeDependencyActionResult>;
  saveRuntimeDependencyConfiguration: (payload: {
    targetId?: string;
    entries: RuntimeDependencyConfigurationUpdateEntry[];
  }) => Promise<RuntimeDependencyConfigurationUpdateResult>;
  getServerConsoleState: () => Promise<ServerConsoleState>;
  getMaintenanceAgentConfig: () => Promise<{ path: string; config: MaintenanceAgentConfig }>;
  saveMaintenanceAgentConfig: (config: Partial<MaintenanceAgentConfig>) => Promise<{ config: MaintenanceAgentConfig }>;
  chatMaintenanceAgent: (payload: {
    message: string;
    modelAlias?: string;
    agentName?: string;
    wait?: boolean;
  }) => Promise<{ plan: MaintenanceAgentRun["plan"]; run: MaintenanceAgentRun }>;
  startMaintenanceAgentRun: (payload: {
    runbook?: string;
    wait?: boolean;
  }) => Promise<MaintenanceAgentRun>;
  listMaintenanceAgentRuns: (limit?: number) => Promise<{
    items: MaintenanceAgentRun[];
    activeRunId: string;
    queuedRunIds: string[];
  }>;
  getMaintenanceAgentRun: (runId: string) => Promise<{ run: MaintenanceAgentRun }>;
  approveMaintenanceAgentRun: (
    runId: string,
    payload: { planHash: string; wait?: boolean },
  ) => Promise<{ run: MaintenanceAgentRun }>;
  cancelMaintenanceAgentRun: (
    runId: string,
    payload?: { reason?: string },
  ) => Promise<{ run: MaintenanceAgentRun }>;
  getMaintenanceAgentSummaryFromState?: () => Promise<MaintenanceAgentSummary | null>;
  getBackgroundProcesses: () => Promise<BackgroundProcessStatus>;
  recoverBackgroundSupervisor: () => Promise<BackgroundSupervisorRecoveryResponse>;
  getClientRuntimeStatus: () => Promise<ClientRuntimeStatus>;
  getMonitorAlerts: () => Promise<MonitorAlertState>;
  getProductionHealth: () => Promise<ProductionHealthResponse>;
  getV001BaselineStatus: () => Promise<V001BaselineStatus>;
  saveMonitorAlertConfig: (config: MonitorAlertConfig) => Promise<MonitorAlertState>;
  acknowledgeMonitorAlert: (alertId: string) => Promise<MonitorAlertState>;
  subscribeEvents: (params?: {
    cursor?: number;
    topic?: string;
    timeoutMs?: number;
    includeSnapshot?: boolean;
  }, options?: BridgeRequestOptions) => Promise<EventSubscriptionResponse>;
  getToolManagementCatalog: () => Promise<ToolManagementCatalog>;
  getToolManagementAudit: (limit?: number) => Promise<ToolManagementAuditResponse>;
  getToolManagementMetrics: () => Promise<ToolManagementMetricsResponse>;
  previewToolPolicy: (payload: Record<string, unknown>) => Promise<Record<string, unknown>>;
  getToolManagementGrants: () => Promise<ToolManagementGrantsResponse>;
  createToolGrant: (payload: CreateToolGrantPayload) => Promise<ToolManagementGrantIssue>;
  updateToolGrant: (grantId: string, payload: UpdateToolGrantPayload) => Promise<{ grant: ToolManagementGrantIssue["grant"] }>;
  deleteToolGrant: (grantId: string) => Promise<{ grant: ToolManagementGrantIssue["grant"] }>;
  rotateToolGrantToken: (grantId: string) => Promise<ToolManagementGrantIssue>;
  getDiscoveryConfig: () => Promise<DiscoveryConfigResponse>;
  saveDiscoveryConfig: (config: DiscoveryConfig) => Promise<DiscoveryConfigResponse>;
  getEmailRules: () => Promise<EmailRuleSetResponse>;
  saveEmailRules: (payload: EmailRuleSetResponse["rules"]) => Promise<EmailRuleSetResponse>;
  getGoldenRules: () => Promise<Record<string, unknown>>;
  saveGoldenRules: (payload: Record<string, unknown>) => Promise<Record<string, unknown>>;
  getExpertVocabulary: () => Promise<ExpertVocabularyResponse>;
  saveExpertVocabulary: (
    payload: ExpertVocabularyResponse["vocabulary"],
  ) => Promise<ExpertVocabularyResponse>;
  getExpertVocabularyVersions: () => Promise<ExpertVocabularyHistoryResponse>;
  pickFiles: () => Promise<string[]>;
  pickFolders: () => Promise<string[]>;
  createJob: (payload: SplitPayload) => Promise<SplitJob>;
  reparseJob: (jobId: string, payload?: {
    documentParsing?: DocumentParsingConfig;
    settings?: AgentSettings;
  }) => Promise<SplitJob>;
  parseDocument: (payload: {
    pipelineId?: string;
    expectedOutput?: string;
    expectedOutputs?: string[];
    inputText?: string;
    sources?: Array<Record<string, unknown>>;
    filePaths?: string[];
    uploadedFiles?: Array<Record<string, unknown>>;
    uploadSessionId?: string;
    cleanupUploadSession?: boolean;
    dryRun?: boolean;
    chunking?: DocumentParsingConfig["chunking"];
    contextBudget?: DocumentParsingConfig["contextBudget"];
    payloadBudget?: DocumentParsingConfig["payloadBudget"];
    granularity?: DocumentParsingConfig["granularity"];
    dynamicParsing?: DocumentParsingConfig["dynamicParsing"];
    documentParsing?: DocumentParsingConfig;
    settings?: AgentSettings;
  }) => Promise<DocumentParseResponse>;
  listJobs: (limit?: number) => Promise<SplitJobListResponse>;
  deleteJob: (jobId: string) => Promise<{ ok: boolean; deletedJob: SplitJob }>;
  getJob: (jobId: string) => Promise<SplitJob | null>;
  getJobResult: (jobId: string) => Promise<SplitResult>;
  getDiscoveryClients: () => Promise<DiscoveryClientsResponse>;
  getKnowledgeConsole: () => Promise<KnowledgeConsoleState>;
  getKnowledgeConfigSchema: () => Promise<KnowledgeConfigSchema>;
  getKnowledgeSources: () => Promise<KnowledgeSourceState>;
  getKnowledgeWordClouds: (params?: {
    wordBagSetId?: string;
    wordBagId?: string;
    limit?: number;
    minFrequency?: number;
    query?: string;
    corpusPaths?: Array<{ path: string; type?: string }>;
  }) => Promise<KnowledgeWordCloudState>;
  saveKnowledgeWordClouds: (payload: {
    wordBagSet?: Partial<KnowledgeWordBagSet>;
    auditAction?: string;
    auditPaths?: Array<{ path: string; type?: string }>;
    limit?: number;
    minFrequency?: number;
  }) => Promise<{ ok: boolean; wordBagSet: KnowledgeWordBagSet }>;
  exportKnowledgeWordClouds: (payload?: {
    wordBagSetId?: string;
  }) => Promise<KnowledgeWordCloudExportResponse>;
  importKnowledgeWordClouds: (payload: {
    importPayload?: Record<string, unknown> | string;
    wordBagSet?: Partial<KnowledgeWordBagSet>;
    mode?: "copy" | "overwrite" | string;
    overwrite?: boolean;
  }) => Promise<KnowledgeWordCloudImportResponse>;
  addKnowledgeWordBag: (payload: {
    wordBagSetId: string;
    parentWordBagId?: string;
    wordBag: Partial<KnowledgeWordBag>;
  }) => Promise<KnowledgeWordBagMutationResponse>;
  updateKnowledgeWordBag: (
    wordBagId: string,
    payload: {
      wordBagSetId: string;
      wordBag?: Partial<KnowledgeWordBag>;
      patch?: Partial<KnowledgeWordBag>;
    },
  ) => Promise<KnowledgeWordBagMutationResponse>;
  deleteKnowledgeWordBag: (
    wordBagId: string,
    params: { wordBagSetId: string },
  ) => Promise<KnowledgeWordBagMutationResponse>;
  getKnowledgeWordBagTerms: (payload: {
    wordBagSetId?: string;
    wordBagId?: string;
    wordBagIds?: string[];
    includeChildren?: boolean;
  }) => Promise<KnowledgeWordBagTermsResponse>;
  proposeKnowledgeWordClouds: (payload: Record<string, unknown>) => Promise<KnowledgeWordCloudProposeResponse>;
  listKnowledgeReviewItems: (params?: { status?: string; limit?: number }) => Promise<KnowledgeReviewItemsResponse>;
  resolveKnowledgeReviewItem: (
    reviewId: string,
    payload: { resolution: string; patch?: Record<string, unknown> },
  ) => Promise<KnowledgeReviewItem>;
  chatKnowledgeRuleAuthoring: (payload: Record<string, unknown>) => Promise<KnowledgeRuleAuthoringResponse>;
  publishGoldenRules: (
    packageId: string,
    payload: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
  createKnowledgeSource: (payload: Record<string, unknown>) => Promise<KnowledgeSourceMutationResponse>;
  updateKnowledgeSource: (
    sourceId: string,
    payload: Record<string, unknown>,
  ) => Promise<KnowledgeSourceMutationResponse>;
  deleteKnowledgeSource: (sourceId: string) => Promise<KnowledgeSourceMutationResponse>;
  refreshKnowledgeSource: (
    sourceId: string,
    payload?: Record<string, unknown>,
  ) => Promise<KnowledgeSourceMutationResponse>;
  refreshAllKnowledgeSources: (payload?: Record<string, unknown>) => Promise<KnowledgeSourceMutationResponse>;
  getKnowledgeMaintenance: () => Promise<MaintenanceSettings>;
  saveKnowledgeMaintenance: (settings: MaintenanceSettings) => Promise<MaintenanceSettings>;
  runKnowledgeMaintenance: (payload: {
    taskType: string;
    confirm?: boolean;
    [key: string]: unknown;
  }) => Promise<Record<string, unknown>>;
  reindexKnowledge: (payload?: { confirm?: boolean; [key: string]: unknown }) => Promise<Record<string, unknown>>;
  rebuildSourceVocabulary: (payload?: { confirm?: boolean; [key: string]: unknown }) => Promise<Record<string, unknown>>;
  searchKnowledge: (payload: Record<string, unknown>) => Promise<KnowledgeSearchResponse>;
  connectKnowledgeBackend: (payload: Record<string, unknown>) => Promise<Record<string, unknown>>;
  listKnowledgeSpaces: (params?: { provider?: string }) => Promise<Record<string, unknown>>;
  requestKnowledgeExport: (payload: Record<string, unknown>) => Promise<Record<string, unknown>>;
  requestKnowledgePermission: (payload: Record<string, unknown>) => Promise<Record<string, unknown>>;
  recordKnowledgeFeedback: (payload: Record<string, unknown>) => Promise<Record<string, unknown>>;
  getContextProfiles: () => Promise<Record<string, unknown>>;
  previewContextPack: (payload: Record<string, unknown>) => Promise<Record<string, unknown>>;
  listContextBuildRecords: (limit?: number) => Promise<Record<string, unknown>>;
  runContextEvaluation: (payload: Record<string, unknown>) => Promise<Record<string, unknown>>;
  getKnowledgeEvidence: (evidenceId: string) => Promise<EvidencePack>;
  renderKnowledgeMarkdown: (payload: {
    evidenceId: string;
    format?: "markdown" | string;
  }) => Promise<RenderMarkdownResponse>;
  knowledgeAssetUrl: (assetId: string) => string;
  knowledgeDocxExportUrl: (params?: {
    documentId?: string;
    batchId?: string;
    sourceId?: string;
    limit?: number;
    includeMachineReadable?: boolean;
  }) => string;
  knowledgeMarkdownExportUrl: (params?: {
    documentId?: string;
    batchId?: string;
    sourceId?: string;
    limit?: number;
  }) => string;
  knowledgeHtmlExportUrl: (params?: {
    documentId?: string;
    batchId?: string;
    sourceId?: string;
    limit?: number;
  }) => string;
  createUploadSession: (payload: Record<string, unknown>) => Promise<UploadSessionResponse>;
  uploadSessionChunk: (
    sessionId: string,
    fileIndex: number,
    offset: number,
    chunk: Blob | ArrayBuffer,
  ) => Promise<UploadSessionResponse>;
  getUploadSession: (sessionId: string) => Promise<UploadSessionResponse>;
  getNormalizedDocuments: (jobId: string) => Promise<SplitResult["normalizedDocuments"]>;
  normalizedDocumentUrl: (jobId: string, documentId: string) => string;
  listKnowledgeDistillationWorkbenchRuns: (limit?: number) => Promise<Record<string, unknown>>;
  createKnowledgeDistillationWorkbenchRun: (payload: CreateKnowledgeDistillationWorkbenchRunPayload) => Promise<Record<string, unknown>>;
  getKnowledgeDistillationWorkbenchRun: (runId: string) => Promise<Record<string, unknown>>;
  resumeKnowledgeDistillationWorkbenchRun: (runId: string) => Promise<Record<string, unknown>>;
  cancelKnowledgeDistillationWorkbenchRun: (runId: string, reason?: string) => Promise<Record<string, unknown>>;
  archiveKnowledgeDistillationWorkbenchRun: (runId: string) => Promise<Record<string, unknown>>;
  deleteKnowledgeDistillationWorkbenchRun: (runId: string) => Promise<Record<string, unknown>>;
  rerunKnowledgeDistillationWorkbenchStage: (runId: string, stageId: string) => Promise<Record<string, unknown>>;
  getKnowledgeDistillationWorkbenchRunArtifacts: (runId: string) => Promise<Record<string, unknown>>;
  compareKnowledgeDistillationWorkbenchRuns: (leftRunId: string, rightRunId: string) => Promise<Record<string, unknown>>;
  knowledgeDistillationWorkbenchExportUrl: (runId: string, stageId: string, format?: string) => string;
  knowledgeDistillationWorkbenchPackageUrl: (runId: string) => string;
};
