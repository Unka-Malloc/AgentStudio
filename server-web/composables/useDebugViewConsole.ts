import { computed } from "vue";
import { useRoute } from "vue-router";
import { useDebugDistillationController } from "./console-debug-distillation-controller";
import { useServerConsoleShellContext } from "./serverConsoleShellContext";
import type { DebugTab } from "./useConsole";

export function useDebugViewConsole() {
  const { agentRetrievalConsole, debugConsole } = useServerConsoleShellContext();
  const {
    answer: shellAgentAnswer,
    form: shellAgentForm,
    page: shellAgentPage,
    progress: shellAgentProgress,
    tabs: shellAgentTabs,
    trace: shellAgentTrace,
    workspace: shellAgentWorkspace,
  } = agentRetrievalConsole;
  const {
    busyKey,
    currentView,
    debugTab,
    error,
    infoFeedModelOptions,
    isAuthenticated,
    knowledgeConsole,
    knowledgeRecallDebugForm,
    knowledgeRecallDebugGridStyle,
    knowledgeRecallDebugModeOptionBarOptions,
    knowledgeRecallDebugRuns,
    knowledgeRecallDebugTargetOptions,
    knowledgeSourceState,
    knowledgeStatus,
    openAgentEvidencePreview,
    runKnowledgeRecallDebugBatch,
    visibleDebugTabs,
  } = debugConsole;

  const route = useRoute();
  const activeDebugTab = computed<DebugTab>(() => {
    const tab = String(route.params.tab ?? "");
    return tab === "knowledgeRecall" || tab === "agentRetrieval" || tab === "knowledgeDistillation"
      ? tab
      : debugTab.value;
  });
  const debugDistillation = useDebugDistillationController({ infoFeedModelOptions });
  const agentRetrievalAnswer = {
    ...shellAgentAnswer,
    busyKey,
    openAgentEvidencePreview,
  };
  const agentRetrievalForm = {
    ...shellAgentForm,
    busyKey,
  };
  const agentRetrievalPage = {
    ...shellAgentPage,
  };
  const agentRetrievalProgress = {
    ...shellAgentProgress,
  };
  const agentRetrievalTabs = {
    ...shellAgentTabs,
  };
  const agentRetrievalTrace = {
    ...shellAgentTrace,
    busyKey,
  };
  const agentRetrievalWorkspace = {
    ...shellAgentWorkspace,
    busyKey,
  };

  return {
    agentRetrievalAnswer,
    agentRetrievalForm,
    agentRetrievalPage,
    agentRetrievalProgress,
    agentRetrievalTabs,
    agentRetrievalTrace,
    agentRetrievalWorkspace,
    busyKey,
    currentView,
    debugTab,
    error,
    infoFeedModelOptions,
    isAuthenticated,
    knowledgeConsole,
    knowledgeRecallDebugForm,
    knowledgeRecallDebugGridStyle,
    knowledgeRecallDebugModeOptionBarOptions,
    knowledgeRecallDebugRuns,
    knowledgeRecallDebugTargetOptions,
    knowledgeSourceState,
    knowledgeStatus,
    openAgentEvidencePreview,
    runKnowledgeRecallDebugBatch,
    visibleDebugTabs,
    activeDebugTab,
    ...debugDistillation,
  };
}
