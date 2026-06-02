import { ref, type ComputedRef, type Ref } from "vue";
import type {
  EvidencePack,
  KnowledgeSearchResult,
} from "../lib/types";
import type { DebugTab } from "../types/app";
import { createConsoleKnowledgeEvidenceLoaderController } from "./console-knowledge-evidence-loader-controller";
import { createConsoleKnowledgeEvidenceRenderController } from "./console-knowledge-evidence-render-controller";

type ConsoleKnowledgeEvidenceControllerOptions = {
  busyKey: ComputedRef<string>;
  clearAllBusy: () => void;
  currentAgentExploreQuery: () => string;
  error: Ref<string>;
  infoFeedQuery: () => string;
  knowledgeSearchResults: Ref<KnowledgeSearchResult[]>;
  agentExploreContextBuildRecordId: () => string;
  openDebugTab: (tab: DebugTab) => void;
  recordFeedback: (action: string, context?: Record<string, unknown>) => void;
  setBusy: (key: string) => void;
};

export function createConsoleKnowledgeEvidenceController(
  options: ConsoleKnowledgeEvidenceControllerOptions,
) {
  const selectedEvidence = ref<EvidencePack | null>(null);
  const selectedEvidenceId = ref("");
  const evidenceLoadError = ref("");
  const agentEvidencePreviewOpen = ref(false);
  const evidenceLoadSequence = ref(0);

  const renderController = createConsoleKnowledgeEvidenceRenderController({
    selectedEvidence,
    selectedEvidenceId,
  });

  const loaderController = createConsoleKnowledgeEvidenceLoaderController({
    agentEvidencePreviewOpen,
    agentExploreContextBuildRecordId: options.agentExploreContextBuildRecordId,
    busyKey: options.busyKey,
    clearAllBusy: options.clearAllBusy,
    currentAgentExploreQuery: options.currentAgentExploreQuery,
    error: options.error,
    evidenceLoadError,
    evidenceLoadSequence,
    infoFeedQuery: options.infoFeedQuery,
    knowledgeSearchResults: options.knowledgeSearchResults,
    openDebugTab: options.openDebugTab,
    recordFeedback: options.recordFeedback,
    selectedEvidence,
    selectedEvidenceId,
    setBusy: options.setBusy,
  });

  return {
    agentEvidencePreviewOpen,
    evidenceLoadError,
    evidenceLoadSequence,
    selectedEvidence,
    selectedEvidenceId,
    ...renderController,
    ...loaderController,
  };
}
