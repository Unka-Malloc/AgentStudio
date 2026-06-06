import { onMounted, ref, type Ref } from "vue";
import {
  connectKnowledgeBackend,
  listKnowledgeSpaces,
} from "../lib/knowledge-search-client";
import type { KnowledgeIngestTargetKind, SplitJob } from "../lib/types";
import { createConsoleKnowledgeIngestTargetController } from "./console-knowledge-ingest-target-controller";
import {
  createConsoleKnowledgeLibraryProjectionController,
  type KnowledgeBackendProviderForm,
} from "./console-knowledge-library-projection-controller";
import { usePageRefreshHandler } from "./usePageRefresh";

type ReadonlyRef<T> = {
  readonly value: T;
};

type KnowledgeLibraryControllerOptions = {
  canMaintainKnowledge: ReadonlyRef<boolean>;
  ingestJob: Ref<SplitJob | null>;
  isManagementRulesPanel: ReadonlyRef<boolean>;
  knowledgeIngestExternalProvider: Ref<string>;
  knowledgeIngestExternalRefs: Ref<string>;
  knowledgeIngestExternalTargetLabels: Ref<Record<string, string>>;
  knowledgeIngestTargets: Ref<Record<KnowledgeIngestTargetKind, boolean>>;
  knowledgeIngestTeamRefs: Ref<string>;
  knowledgeIngestUserRefs: Ref<string>;
  refreshExpertRules: (options?: { forceDrafts?: boolean }) => Promise<void>;
  refreshIngestJob: (options?: { silent?: boolean }) => Promise<void>;
};

export function createConsoleKnowledgeLibraryController(options: KnowledgeLibraryControllerOptions) {
  const knowledgeBackendSpacesResult = ref<Record<string, unknown> | null>(null);
  const knowledgeLibraryBusy = ref("spaces");
  const knowledgeLibraryError = ref("");
  const knowledgeBackendProviderOptions = [
    { value: "dify", label: "Dify" },
    { value: "ragflow", label: "RAG Flow" },
  ];
  const knowledgeBackendModeOptions = [
    { value: "contract", label: "contract" },
    { value: "live", label: "live" },
  ];
  const knowledgeBackendProviderForms = ref<Record<string, KnowledgeBackendProviderForm>>({
    dify: {
      mode: "contract",
      secretRef: "secret://pact/knowledge/dify-api-key",
      endpointRef: "config://pact/knowledge/dify-endpoint",
    },
    ragflow: {
      mode: "contract",
      secretRef: "secret://pact/knowledge/ragflow-api-key",
      endpointRef: "config://pact/knowledge/ragflow-endpoint",
    },
  });
  const expandedKnowledgeLibraryCards = ref<Record<string, boolean>>({});
  const expandedKnowledgeBackendCards = ref<Record<string, boolean>>({ builtin: true });

  function isKnowledgeLibraryCardExpanded(id: string) {
    return Boolean(expandedKnowledgeLibraryCards.value[id]);
  }

  function toggleKnowledgeLibraryCard(id: string) {
    expandedKnowledgeLibraryCards.value = {
      ...expandedKnowledgeLibraryCards.value,
      [id]: !expandedKnowledgeLibraryCards.value[id],
    };
  }

  function isKnowledgeBackendCardExpanded(id: string) {
    return Boolean(expandedKnowledgeBackendCards.value[id]);
  }

  function toggleKnowledgeBackendCard(id: string) {
    expandedKnowledgeBackendCards.value = {
      ...expandedKnowledgeBackendCards.value,
      [id]: !expandedKnowledgeBackendCards.value[id],
    };
  }

  const {
    externalProviderLabel,
    knowledgeBackendProviderCards,
    knowledgeBackendSpaceDisplayName,
    knowledgeBackendSpaces,
    knowledgeLibraryCards,
    knowledgeLibraryDisplayTitle,
    metadataPolicyLabel,
    realKnowledgeBackendSpaces,
    textField,
  } = createConsoleKnowledgeLibraryProjectionController({
    knowledgeBackendProviderForms,
    knowledgeBackendProviderOptions,
    knowledgeBackendSpacesResult,
  });

  const {
    knowledgeIngestExternalValue,
    knowledgeIngestTargetDisplaySummary,
    knowledgeIngestTargetOptions,
    knowledgeIngestTargetValues,
    parseKnowledgeIngestExternalRef,
    parseKnowledgeIngestExternalValue,
    setKnowledgeIngestTargetValues,
  } = createConsoleKnowledgeIngestTargetController({
    externalProviderLabel,
    knowledgeBackendSpaceDisplayName,
    knowledgeIngestExternalProvider: options.knowledgeIngestExternalProvider,
    knowledgeIngestExternalRefs: options.knowledgeIngestExternalRefs,
    knowledgeIngestExternalTargetLabels: options.knowledgeIngestExternalTargetLabels,
    knowledgeIngestTargets: options.knowledgeIngestTargets,
    knowledgeIngestTeamRefs: options.knowledgeIngestTeamRefs,
    knowledgeIngestUserRefs: options.knowledgeIngestUserRefs,
    knowledgeLibraryDisplayTitle,
    realKnowledgeBackendSpaces,
    textField,
  });

  async function refreshKnowledgeLibrarySpaces() {
    knowledgeLibraryBusy.value = "spaces";
    knowledgeLibraryError.value = "";
    try {
      knowledgeBackendSpacesResult.value = await listKnowledgeSpaces();
    } catch (caught) {
      knowledgeLibraryError.value = caught instanceof Error ? caught.message : String(caught);
    } finally {
      setKnowledgeIngestTargetValues(knowledgeIngestTargetValues.value);
      knowledgeLibraryBusy.value = "";
    }
  }

  async function connectKnowledgeBackendProvider(provider: string) {
    const form = knowledgeBackendProviderForms.value[provider];
    if (!form) {
      return;
    }
    if (!options.canMaintainKnowledge.value) {
      knowledgeLibraryError.value = "当前账号没有知识库维护权限。";
      return;
    }
    knowledgeLibraryBusy.value = `backend:${provider}`;
    knowledgeLibraryError.value = "";
    try {
      const result = await connectKnowledgeBackend({
        provider,
        mode: form.mode,
        secretRef: form.secretRef,
        endpointRef: form.endpointRef,
      });
      const publicProvider = result.provider && typeof result.provider === "object"
        ? result.provider as Record<string, unknown>
        : null;
      if (publicProvider) {
        knowledgeBackendProviderForms.value = {
          ...knowledgeBackendProviderForms.value,
          [provider]: {
            mode: String(publicProvider.mode || form.mode || "contract"),
            secretRef: String(publicProvider.secretRef || form.secretRef || ""),
            endpointRef: String(publicProvider.endpointRef || form.endpointRef || ""),
          },
        };
      }
      await refreshKnowledgeLibrarySpaces();
    } catch (caught) {
      knowledgeLibraryError.value = caught instanceof Error ? caught.message : String(caught);
    } finally {
      if (knowledgeLibraryBusy.value === `backend:${provider}`) {
        knowledgeLibraryBusy.value = "";
      }
    }
  }

  onMounted(() => {
    void refreshKnowledgeLibrarySpaces();
  });

  usePageRefreshHandler(
    (detail) => detail.viewId === "knowledge" && detail.knowledgeTab === "management",
    async () => {
      await Promise.all([
        refreshKnowledgeLibrarySpaces(),
        options.ingestJob.value ? options.refreshIngestJob({ silent: true }) : Promise.resolve(),
        options.isManagementRulesPanel.value ? options.refreshExpertRules({ forceDrafts: true }) : Promise.resolve(),
      ]);
    },
  );

  return {
    connectKnowledgeBackendProvider,
    expandedKnowledgeBackendCards,
    expandedKnowledgeLibraryCards,
    externalProviderLabel,
    isKnowledgeBackendCardExpanded,
    isKnowledgeLibraryCardExpanded,
    knowledgeBackendModeOptions,
    knowledgeBackendProviderCards,
    knowledgeBackendProviderForms,
    knowledgeBackendProviderOptions,
    knowledgeBackendSpaceDisplayName,
    knowledgeBackendSpaces,
    knowledgeBackendSpacesResult,
    knowledgeIngestExternalValue,
    knowledgeIngestTargetDisplaySummary,
    knowledgeIngestTargetOptions,
    knowledgeIngestTargetValues,
    knowledgeLibraryBusy,
    knowledgeLibraryCards,
    knowledgeLibraryDisplayTitle,
    knowledgeLibraryError,
    metadataPolicyLabel,
    parseKnowledgeIngestExternalRef,
    parseKnowledgeIngestExternalValue,
    realKnowledgeBackendSpaces,
    refreshKnowledgeLibrarySpaces,
    setKnowledgeIngestTargetValues,
    textField,
    toggleKnowledgeBackendCard,
    toggleKnowledgeLibraryCard,
  };
}
