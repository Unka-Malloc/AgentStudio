import { type ComputedRef, type Ref } from "vue";
import { getKnowledgeEvidence } from "../lib/knowledge-search-client";
import { evidenceIdFromHref } from "../lib/rendering";
import type {
  EvidencePack,
  KnowledgeSearchResult,
} from "../lib/types";
import type { DebugTab } from "../types/app";
import {
  evidenceDisplayTitle,
  candidateTextFromRecord,
  knowledgeResultEvidenceId,
  readableSnippetFromText,
} from "./console-knowledge-search-utils";

type LoadEvidenceOptions = {
  revealKnowledgeSearch?: boolean;
};

type ConsoleKnowledgeEvidenceLoaderControllerOptions = {
  agentEvidencePreviewOpen: Ref<boolean>;
  agentExploreContextBuildRecordId: () => string;
  busyKey: ComputedRef<string>;
  clearAllBusy: () => void;
  currentAgentExploreQuery: () => string;
  error: Ref<string>;
  evidenceLoadError: Ref<string>;
  evidenceLoadSequence: Ref<number>;
  infoFeedQuery: () => string;
  knowledgeSearchResults: Ref<KnowledgeSearchResult[]>;
  openDebugTab: (tab: DebugTab) => void;
  recordFeedback: (action: string, context?: Record<string, unknown>) => void;
  selectedEvidence: Ref<EvidencePack | null>;
  selectedEvidenceId: Ref<string>;
  setBusy: (key: string) => void;
};

export function createConsoleKnowledgeEvidenceLoaderController(
  options: ConsoleKnowledgeEvidenceLoaderControllerOptions,
) {
  function hydrateSearchResultPreview(evidence: EvidencePack) {
    const evidenceId = String(evidence.evidenceId || options.selectedEvidenceId.value || "");
    if (!evidenceId) {
      return;
    }
    const title = evidenceDisplayTitle(evidence);
    const snippet = readableSnippetFromText(candidateTextFromRecord(evidence));
    options.knowledgeSearchResults.value = options.knowledgeSearchResults.value.map((item) => {
      if (knowledgeResultEvidenceId(item) !== evidenceId) {
        return item;
      }
      return {
        ...item,
        title: title || item.title,
        snippet: snippet || item.snippet,
      };
    });
  }

  async function openKnowledgeSearchResult(item: KnowledgeSearchResult) {
    const evidenceId = knowledgeResultEvidenceId(item);
    if (!evidenceId) {
      options.error.value = "这个检索结果没有可打开的 evidenceId。";
      return;
    }
    await loadEvidence(evidenceId);
  }

  async function loadEvidence(evidenceId: string, loadOptions: LoadEvidenceOptions = {}) {
    const normalized = String(evidenceId || "").trim();
    if (!normalized) {
      return;
    }
    const sequence = options.evidenceLoadSequence.value + 1;
    options.evidenceLoadSequence.value = sequence;
    const requestBusyKey = `knowledge:evidence:${normalized}`;
    options.setBusy(requestBusyKey);
    options.selectedEvidenceId.value = normalized;
    options.selectedEvidence.value = null;
    options.evidenceLoadError.value = "";
    options.error.value = "";
    try {
      const evidence = await getKnowledgeEvidence(normalized);
      if (sequence !== options.evidenceLoadSequence.value) {
        return;
      }
      if (!evidence || typeof evidence !== "object") {
        throw new Error("服务端没有返回可展示的证据内容。");
      }
      options.selectedEvidence.value = evidence;
      options.selectedEvidenceId.value = String(evidence.evidenceId || normalized);
      hydrateSearchResultPreview(evidence);
      if (loadOptions.revealKnowledgeSearch !== false) {
        options.openDebugTab("knowledgeRecall");
      }
    } catch (nextError) {
      if (sequence !== options.evidenceLoadSequence.value) {
        return;
      }
      const message = nextError instanceof Error ? nextError.message : "加载证据包失败。";
      options.evidenceLoadError.value = message;
      options.error.value = message;
    } finally {
      if (sequence === options.evidenceLoadSequence.value && options.busyKey.value === requestBusyKey) {
        options.clearAllBusy();
      }
    }
  }

  async function openAgentEvidencePreview(evidenceId: string) {
    const normalized = String(evidenceId || "").trim();
    if (!normalized) {
      return;
    }
    options.agentEvidencePreviewOpen.value = true;
    options.selectedEvidenceId.value = normalized;
    options.selectedEvidence.value = null;
    options.evidenceLoadError.value = "";
    await loadEvidence(normalized, { revealKnowledgeSearch: false });
    options.recordFeedback("open", {
      surface: "evidence_preview",
      evidenceId: normalized,
      query: options.currentAgentExploreQuery() || options.infoFeedQuery() || "",
      contextBuildRecordId: options.agentExploreContextBuildRecordId(),
    });
  }

  function closeAgentEvidencePreview() {
    options.agentEvidencePreviewOpen.value = false;
  }

  function handleAgentAnswerClick(event: MouseEvent) {
    const target = event.target as HTMLElement | null;
    const anchor = target?.closest?.("a") as HTMLAnchorElement | null;
    const href = anchor?.getAttribute("href") || "";
    const evidenceId = evidenceIdFromHref(href);
    if (!evidenceId) {
      return;
    }
    event.preventDefault();
    void openAgentEvidencePreview(evidenceId);
  }

  return {
    closeAgentEvidencePreview,
    handleAgentAnswerClick,
    hydrateSearchResultPreview,
    loadEvidence,
    openAgentEvidencePreview,
    openKnowledgeSearchResult,
  };
}
