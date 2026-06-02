import { useServerConsoleShellContext } from './serverConsoleShellContext';
import { createConsoleKnowledgeLibraryController } from './console-knowledge-library-controller';
import { createConsoleKnowledgeViewStateController } from './console-knowledge-view-state-controller';

export function useKnowledgeViewConsole() {
  const { knowledgeDomainConsole } = useServerConsoleShellContext();
  const {
    ingest: shellIngest,
    libraryRuntime: shellLibraryRuntime,
    maintenance: shellMaintenance,
    page: shellPage,
    rules: shellRules,
    viewState: shellViewState,
    wordCloud: shellWordCloud,
  } = knowledgeDomainConsole;

  const viewState = createConsoleKnowledgeViewStateController({
    collapsedWordBagIds: shellViewState.collapsedWordBagIds,
    knowledgeManagementPanel: shellViewState.knowledgeManagementPanel,
    knowledgeTab: shellViewState.knowledgeTab,
    toggleWordCloudCollapsed: shellViewState.toggleWordCloudCollapsed,
  });

  const knowledgeLibrary = createConsoleKnowledgeLibraryController({
    canMaintainKnowledge: shellLibraryRuntime.canMaintainKnowledge,
    ingestJob: shellLibraryRuntime.ingestJob,
    isManagementRulesPanel: viewState.isManagementRulesPanel,
    knowledgeIngestExternalProvider: shellLibraryRuntime.knowledgeIngestExternalProvider,
    knowledgeIngestExternalRefs: shellLibraryRuntime.knowledgeIngestExternalRefs,
    knowledgeIngestExternalTargetLabels: shellLibraryRuntime.knowledgeIngestExternalTargetLabels,
    knowledgeIngestTargets: shellLibraryRuntime.knowledgeIngestTargets,
    knowledgeIngestTeamRefs: shellLibraryRuntime.knowledgeIngestTeamRefs,
    knowledgeIngestUserRefs: shellLibraryRuntime.knowledgeIngestUserRefs,
    refreshExpertRules: shellLibraryRuntime.refreshExpertRules,
    refreshIngestJob: shellLibraryRuntime.refreshIngestJob,
  });

  const page = {
    ...shellPage,
    activeKnowledgeTab: viewState.activeKnowledgeTab,
    dynamicParsingPolicySignature: viewState.dynamicParsingPolicySignature,
    isKnownKnowledgeTab: viewState.isKnownKnowledgeTab,
    isManagementKnowledgePanel: viewState.isManagementKnowledgePanel,
    isManagementRulesPanel: viewState.isManagementRulesPanel,
  };

  const ingest = {
    ...shellIngest,
    documentPreviewResult: viewState.documentPreviewResult,
    dynamicParsingPreviewConfig: viewState.dynamicParsingPreviewConfig,
    knowledgeIngestTargetDisplaySummary: knowledgeLibrary.knowledgeIngestTargetDisplaySummary,
    knowledgeIngestTargetOptions: knowledgeLibrary.knowledgeIngestTargetOptions,
    knowledgeIngestTargetValues: knowledgeLibrary.knowledgeIngestTargetValues,
    setKnowledgeIngestTargetValues: knowledgeLibrary.setKnowledgeIngestTargetValues,
  };

  const library = {
    isKnowledgeLibraryCardExpanded: knowledgeLibrary.isKnowledgeLibraryCardExpanded,
    knowledgeLibraryCards: knowledgeLibrary.knowledgeLibraryCards,
    knowledgeLibraryError: knowledgeLibrary.knowledgeLibraryError,
    toggleKnowledgeLibraryCard: knowledgeLibrary.toggleKnowledgeLibraryCard,
  };

  const maintenance = {
    ...shellMaintenance,
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
    ...shellRules,
  };

  const wordCloud = {
    ...shellWordCloud,
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
