import { useServerConsoleShellContext } from './serverConsoleShellContext';
import { createConsoleKnowledgeLibraryController } from './console-knowledge-library-controller';
import { createConsoleKnowledgeViewStateController } from './console-knowledge-view-state-controller';

export function useKnowledgeViewConsole() {
  const shellContext = useServerConsoleShellContext().knowledgeDomainConsole;

  const viewState = createConsoleKnowledgeViewStateController({
    collapsedWordBagIds: shellContext.viewState.collapsedWordBagIds,
    knowledgeManagementPanel: shellContext.viewState.knowledgeManagementPanel,
    knowledgeTab: shellContext.viewState.knowledgeTab,
    toggleWordCloudCollapsed: shellContext.viewState.toggleWordCloudCollapsed,
  });

  const unifiedKnowledgeIngestPipelineConfig = viewState.unifiedKnowledgeIngestPipelineConfig;
  const dynamicParsingPreviewPipelineId = "dynamic-parameter-v1";
  const dynamicParsingProfile = {
    contextBudget: { knowledgeTokens: 12000 },
    payloadBudget: { maxResponseBytes: 1048576 },
    granularity: {
      secondaryParse: { enabled: false },
    },
    secondaryParse: { enabled: false },
    dynamicParsing: viewState.dynamicParsingPreviewConfig.dynamicParsing,
    structureArtifacts: "structureArtifacts",
    granularityFragments: "granularityFragments",
    parentArtifactId: "structureArtifacts[].metadata.parentArtifactId",
    pipelineId: dynamicParsingPreviewPipelineId,
  };

  const dynamicParsingPreviewConfig = {
    ...viewState.dynamicParsingPreviewConfig,
    pipelineId: dynamicParsingPreviewPipelineId,
  };
  const uploadFilesToKnowledge = () =>
    shellContext.ingest.uploadFilesToKnowledge({
      documentParsing: unifiedKnowledgeIngestPipelineConfig,
    });

  const knowledgeLibrary = createConsoleKnowledgeLibraryController({
    canMaintainKnowledge: shellContext.libraryRuntime.canMaintainKnowledge,
    ingestJob: shellContext.libraryRuntime.ingestJob,
    isManagementRulesPanel: viewState.isManagementRulesPanel,
    knowledgeIngestExternalProvider: shellContext.libraryRuntime.knowledgeIngestExternalProvider,
    knowledgeIngestExternalRefs: shellContext.libraryRuntime.knowledgeIngestExternalRefs,
    knowledgeIngestExternalTargetLabels: shellContext.libraryRuntime.knowledgeIngestExternalTargetLabels,
    knowledgeIngestTargets: shellContext.libraryRuntime.knowledgeIngestTargets,
    knowledgeIngestTeamRefs: shellContext.libraryRuntime.knowledgeIngestTeamRefs,
    knowledgeIngestUserRefs: shellContext.libraryRuntime.knowledgeIngestUserRefs,
    refreshExpertRules: shellContext.libraryRuntime.refreshExpertRules,
    refreshIngestJob: shellContext.libraryRuntime.refreshIngestJob,
  });

  const page = {
    ...shellContext.page,
    activeKnowledgeTab: viewState.activeKnowledgeTab,
    dynamicParsingPolicySignature: viewState.dynamicParsingPolicySignature,
    isKnownKnowledgeTab: viewState.isKnownKnowledgeTab,
    isManagementKnowledgePanel: viewState.isManagementKnowledgePanel,
    isManagementRulesPanel: viewState.isManagementRulesPanel,
  };

  const ingest = {
    ...shellContext.ingest,
    documentPreviewResult: viewState.documentPreviewResult,
    uploadFilesToKnowledge,
    dynamicParsingPreviewPipelineId,
    dynamicParsingPreviewConfig,
    dynamicParsingProfile,
    unifiedKnowledgeIngestPipelineConfig,
    knowledgeIngestTargetDisplaySummary: knowledgeLibrary.knowledgeIngestTargetDisplaySummary,
    knowledgeIngestTargetOptions: knowledgeLibrary.knowledgeIngestTargetOptions,
    knowledgeIngestTargetValues: knowledgeLibrary.knowledgeIngestTargetValues,
    knowledgeLibraryBusy: knowledgeLibrary.knowledgeLibraryBusy,
    setKnowledgeIngestTargetValues: knowledgeLibrary.setKnowledgeIngestTargetValues,
  };

  const library = {
    isKnowledgeLibraryCardExpanded: knowledgeLibrary.isKnowledgeLibraryCardExpanded,
    knowledgeLibraryCards: knowledgeLibrary.knowledgeLibraryCards,
    knowledgeLibraryError: knowledgeLibrary.knowledgeLibraryError,
    toggleKnowledgeLibraryCard: knowledgeLibrary.toggleKnowledgeLibraryCard,
  };

  const maintenance = {
    ...shellContext.maintenance,
    connectKnowledgeBackendProvider: knowledgeLibrary.connectKnowledgeBackendProvider,
    isKnowledgeBackendCardExpanded: knowledgeLibrary.isKnowledgeBackendCardExpanded,
    knowledgeBackendModeOptions: knowledgeLibrary.knowledgeBackendModeOptions,
    knowledgeBackendProviderCards: knowledgeLibrary.knowledgeBackendProviderCards,
    knowledgeBackendProviderForms: knowledgeLibrary.knowledgeBackendProviderForms,
    knowledgeLibraryBusy: knowledgeLibrary.knowledgeLibraryBusy,
    knowledgeLibraryError: knowledgeLibrary.knowledgeLibraryError,
    toggleKnowledgeBackendCard: knowledgeLibrary.toggleKnowledgeBackendCard,
  };

  const rules = {
    ...shellContext.rules,
  };

  const wordCloud = {
    ...shellContext.wordCloud,
    expandedAdvancedIds: viewState.expandedAdvancedIds,
    expandedSummaryIds: viewState.expandedSummaryIds,
    jumpToCloud: viewState.jumpToCloud,
    titleFocusedWordBagId: viewState.titleFocusedWordBagId,
    toggleAdvancedExpanded: viewState.toggleAdvancedExpanded,
    toggleSummaryExpanded: viewState.toggleSummaryExpanded,
  };

  return {
    ingest,
    library,
    maintenance,
    page,
    rules,
    wordCloud,
  };
}
