import type { Bridge } from "./bridge-types";
import { downloadFile } from "./bridge-http";
import {
  getAuthOidc,
  getAuthSession,
  listAuthAudit,
  listAuthSessions,
  listAuthUsers,
  loginAuth,
  logoutAuth,
  revokeAuthSession,
  saveAuthOidc,
  updateAuthUser,
} from "./auth-client";
import {
  getSettings,
  probeModel,
  saveSettings,
} from "./agent-settings-client";
import { listAgents } from "./agent-registry-client";
import {
  getAgentSyncConfig,
  publishAgentSync,
  saveAgentSyncConfig,
  subscribeAgentSync,
} from "./agent-sync-client";
import {
  getCodexOAuthStatus,
  startCodexOAuthLogin,
} from "./codex-oauth-client";
import { getServerConsoleState } from "./console-state-client";
import {
  getDiscoveryClients,
  getDiscoveryConfig,
  saveDiscoveryConfig,
} from "./discovery-client";
import {
  approveMaintenanceAgentRun,
  cancelMaintenanceAgentRun,
  chatMaintenanceAgent,
  getMaintenanceAgentConfig,
  getMaintenanceAgentRun,
  listMaintenanceAgentRuns,
  saveMaintenanceAgentConfig,
  startMaintenanceAgentRun,
} from "./maintenance-agent-client";
import {
  downloadRuntimeDependency,
  listRuntimeDependencies,
  saveRuntimeDependencyConfiguration,
} from "./runtime-dependencies-client";
import {
  reloadRuntimeMounts,
  saveRuntimeMounts,
} from "./runtime-mounts-client";
import {
  browseServerPath,
  getRuntimeInfo,
} from "./runtime-info-client";
import { subscribeEvents } from "./server-events-client";
import {
  getNormalizedDocuments,
  knowledgeDocxExportUrl,
  knowledgeHtmlExportUrl,
  knowledgeMarkdownExportUrl,
  normalizedDocumentUrl,
  parseDocument,
} from "./knowledge-documents-client";
import {
  createUploadSession,
  getUploadSession,
  uploadSessionChunk,
} from "./upload-session-client";
import {
  createJob,
  deleteJob,
  getJob,
  getJobResult,
  listJobs,
  reparseJob,
} from "./jobs-client";
import {
  archiveKnowledgeDistillationWorkbenchRun,
  cancelKnowledgeDistillationWorkbenchRun,
  compareKnowledgeDistillationWorkbenchRuns,
  createKnowledgeDistillationWorkbenchRun,
  deleteKnowledgeDistillationWorkbenchRun,
  getKnowledgeDistillationWorkbenchRun,
  getKnowledgeDistillationWorkbenchRunArtifacts,
  knowledgeDistillationWorkbenchExportUrl,
  knowledgeDistillationWorkbenchPackageUrl,
  listKnowledgeDistillationWorkbenchRuns,
  rerunKnowledgeDistillationWorkbenchStage,
  resumeKnowledgeDistillationWorkbenchRun,
} from "./knowledge-distillation-workbench-client";
import {
  getProductionHealth,
  getV001BaselineStatus,
} from "./production-health-client";
import {
  acknowledgeMonitorAlert,
  getBackgroundProcesses,
  getClientRuntimeStatus,
  getMonitorAlerts,
  recoverBackgroundSupervisor,
  saveMonitorAlertConfig,
} from "./ops-monitor-client";
import {
  getContextProfiles,
  listContextBuildRecords,
  previewContextPack,
  runContextEvaluation,
} from "./context-compiler-client";
import {
  getAuthorizationGovernance,
  listMcpAuthorizationRequests,
  resolveMcpAuthorizationRequest,
  revokeAuthorizationApproval,
  upsertAuthorizationGovernance,
} from "./authorization-governance-client";
import {
  createToolGrant,
  deleteToolGrant,
  getToolManagementAudit,
  getToolManagementCatalog,
  getToolManagementGrants,
  getToolManagementMetrics,
  previewToolPolicy,
  rotateToolGrantToken,
  updateToolGrant,
} from "./tool-management-client";
import {
  callAgentGateway,
  getAgentGatewayConfig,
  saveAgentGatewayConfig,
} from "./agent-gateway-client";
import {
  createKnowledgeSource,
  deleteKnowledgeSource,
  getKnowledgeSources,
  refreshAllKnowledgeSources,
  refreshKnowledgeSource,
  updateKnowledgeSource,
} from "./knowledge-sources-client";
import {
  addKnowledgeWordBag,
  deleteKnowledgeWordBag,
  exportKnowledgeWordClouds,
  getKnowledgeWordBagTerms,
  getKnowledgeWordClouds,
  importKnowledgeWordClouds,
  proposeKnowledgeWordClouds,
  rebuildSourceVocabulary,
  saveKnowledgeWordClouds,
  updateKnowledgeWordBag,
} from "./knowledge-word-cloud-client";
import {
  getKnowledgeConfigSchema,
  getKnowledgeConsole,
  getKnowledgeMaintenance,
  reindexKnowledge,
  runKnowledgeMaintenance,
  saveKnowledgeMaintenance,
} from "./knowledge-maintenance-client";
import {
  chatKnowledgeRuleAuthoring,
  getEmailRules,
  getExpertVocabulary,
  getExpertVocabularyVersions,
  getGoldenRules,
  publishGoldenRules,
  saveEmailRules,
  saveExpertVocabulary,
  saveGoldenRules,
} from "./knowledge-rules-client";
import {
  connectKnowledgeBackend,
  getKnowledgeEvidence,
  knowledgeAssetUrl,
  listKnowledgeSpaces,
  recordKnowledgeFeedback,
  renderKnowledgeMarkdown,
  requestKnowledgeExport,
  requestKnowledgePermission,
  searchKnowledge,
} from "./knowledge-search-client";
import {
  listKnowledgeReviewItems,
  resolveKnowledgeReviewItem,
} from "./knowledge-review-client";
import {
  getAgentWorkspace,
  getKnowledgeAgentExploreRun,
  listAgentWorkspaces,
  runKnowledgeAgentExplore,
} from "./agent-explore-client";

export type { BridgeDownloadOptions, BridgeDownloadResult } from "./bridge-http";
export type { McpAuthorizationRequest } from "./authorization-governance-client";

function parseDocumentWithBridgeConfig(payload: Parameters<Bridge["parseDocument"]>[0]) {
  const {
    chunking,
    contextBudget,
    payloadBudget,
    granularity,
    dynamicParsing,
    ...rest
  } = payload;

  return parseDocument({
    ...rest,
    chunking,
    contextBudget,
    payloadBudget,
    granularity,
    dynamicParsing,
  });
}

const browserBridge: Bridge = {
  getAuthSession,
  loginAuth,
  logoutAuth,
  downloadFile,
  listAuthUsers,
  updateAuthUser,
  getAuthOidc,
  saveAuthOidc,
  listAuthAudit,
  listAuthSessions,
  revokeAuthSession,
  getAuthorizationGovernance,
  upsertAuthorizationGovernance,
  revokeAuthorizationApproval,
  listMcpAuthorizationRequests,
  resolveMcpAuthorizationRequest,
  getSettings,
  saveSettings,
  probeModel,
  getAgentGatewayConfig,
  saveAgentGatewayConfig,
  callAgentGateway,
  listAgents,
  runKnowledgeAgentExplore,
  getKnowledgeAgentExploreRun,
  listAgentWorkspaces,
  getAgentWorkspace,
  getAgentSyncConfig,
  saveAgentSyncConfig,
  publishAgentSync,
  subscribeAgentSync,
  getCodexOAuthStatus,
  startCodexOAuthLogin,
  getRuntimeInfo,
  browseServerPath,
  saveRuntimeMounts,
  reloadRuntimeMounts,
  listRuntimeDependencies,
  downloadRuntimeDependency,
  saveRuntimeDependencyConfiguration,
  getServerConsoleState,
  getMaintenanceAgentConfig,
  saveMaintenanceAgentConfig,
  chatMaintenanceAgent,
  startMaintenanceAgentRun,
  listMaintenanceAgentRuns,
  getMaintenanceAgentRun,
  approveMaintenanceAgentRun,
  cancelMaintenanceAgentRun,
  getBackgroundProcesses,
  recoverBackgroundSupervisor,
  getClientRuntimeStatus,
  getMonitorAlerts,
  getProductionHealth,
  getV001BaselineStatus,
  saveMonitorAlertConfig,
  acknowledgeMonitorAlert,
  subscribeEvents,
  getToolManagementCatalog,
  getToolManagementAudit,
  getToolManagementMetrics,
  previewToolPolicy,
  getToolManagementGrants,
  createToolGrant,
  updateToolGrant,
  deleteToolGrant,
  rotateToolGrantToken,
  getDiscoveryConfig,
  saveDiscoveryConfig,
  getEmailRules,
  saveEmailRules,
  getGoldenRules,
  saveGoldenRules,
  getExpertVocabulary,
  saveExpertVocabulary,
  getExpertVocabularyVersions,
  pickFiles: async () => [],
  pickFolders: async () => [],
  createJob,
  reparseJob,
  parseDocument: parseDocumentWithBridgeConfig,
  listJobs,
  deleteJob,
  getJob,
  getJobResult,
  getDiscoveryClients,
  getKnowledgeConsole,
  getKnowledgeConfigSchema,
  getKnowledgeSources,
  getKnowledgeWordClouds,
  saveKnowledgeWordClouds,
  exportKnowledgeWordClouds,
  importKnowledgeWordClouds,
  addKnowledgeWordBag,
  updateKnowledgeWordBag,
  deleteKnowledgeWordBag,
  getKnowledgeWordBagTerms,
  proposeKnowledgeWordClouds,
  listKnowledgeReviewItems,
  resolveKnowledgeReviewItem,
  chatKnowledgeRuleAuthoring,
  publishGoldenRules,
  createKnowledgeSource,
  updateKnowledgeSource,
  deleteKnowledgeSource,
  refreshKnowledgeSource,
  refreshAllKnowledgeSources,
  getKnowledgeMaintenance,
  saveKnowledgeMaintenance,
  runKnowledgeMaintenance,
  reindexKnowledge,
  rebuildSourceVocabulary,
  searchKnowledge,
  connectKnowledgeBackend,
  listKnowledgeSpaces,
  requestKnowledgeExport,
  requestKnowledgePermission,
  recordKnowledgeFeedback,
  getContextProfiles,
  previewContextPack,
  listContextBuildRecords,
  runContextEvaluation,
  getKnowledgeEvidence,
  renderKnowledgeMarkdown,
  knowledgeAssetUrl,
  knowledgeDocxExportUrl,
  knowledgeMarkdownExportUrl,
  knowledgeHtmlExportUrl,
  createUploadSession,
  uploadSessionChunk,
  getUploadSession,
  getNormalizedDocuments,
  normalizedDocumentUrl,
  listKnowledgeDistillationWorkbenchRuns,
  createKnowledgeDistillationWorkbenchRun,
  getKnowledgeDistillationWorkbenchRun,
  resumeKnowledgeDistillationWorkbenchRun,
  cancelKnowledgeDistillationWorkbenchRun,
  archiveKnowledgeDistillationWorkbenchRun,
  deleteKnowledgeDistillationWorkbenchRun,
  rerunKnowledgeDistillationWorkbenchStage,
  getKnowledgeDistillationWorkbenchRunArtifacts,
  compareKnowledgeDistillationWorkbenchRuns,
  knowledgeDistillationWorkbenchExportUrl,
  knowledgeDistillationWorkbenchPackageUrl,
};

export const bridge = browserBridge;
