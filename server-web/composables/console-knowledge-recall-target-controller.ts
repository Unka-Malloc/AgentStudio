import { computed, ref, watch, type ComputedRef, type Ref } from "vue";
import { listKnowledgeSpaces } from "../lib/knowledge-search-client";
import type {
  KnowledgeConsoleState,
  KnowledgeSource,
} from "../lib/types";
import type { OptionBarOption } from "../types/app";
import { asRecord } from "./console-model-utils";
import type {
  KnowledgeRecallDebugFormState,
  KnowledgeRecallDebugTarget,
} from "./console-knowledge-recall-types";

type ConsoleKnowledgeRecallTargetControllerOptions = {
  activeKnowledgeSources: ComputedRef<KnowledgeSource[]>;
  knowledgeConsole: Ref<KnowledgeConsoleState | null>;
};

function normalizeModeOptions(value: unknown, fallback: OptionBarOption[] = []): OptionBarOption[] {
  const rawItems = Array.isArray(value) ? value : value ? [value] : [];
  const options = rawItems
    .map((item) => {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const record = item as Record<string, unknown>;
        const optionValue = String(record.value || record.id || record.mode || record.name || "").trim();
        if (!optionValue) {
          return null;
        }
        return {
          value: optionValue,
          label: String(record.label || record.title || optionValue),
        } as OptionBarOption;
      }
      const optionValue = String(item || "").trim();
      return optionValue ? ({ value: optionValue, label: optionValue } as OptionBarOption) : null;
    })
    .filter(Boolean) as OptionBarOption[];
  const unique = options.filter(
    (option, index, list) => list.findIndex((candidate) => candidate.value === option.value) === index,
  );
  return unique.length ? unique : fallback;
}

function coreModeOptions(knowledgeConsole: KnowledgeConsoleState | null) {
  const capabilities = asRecord(knowledgeConsole?.capabilities) || {};
  const healthCapabilities = asRecord(knowledgeConsole?.health?.capabilities) || {};
  const retrievalPolicy = asRecord(capabilities.retrievalPolicy) || asRecord(healthCapabilities.retrievalPolicy) || {};
  return normalizeModeOptions(
    capabilities.retrievalModes || healthCapabilities.retrievalModes || retrievalPolicy.modes,
    [
      { value: "hybrid", label: "Hybrid" },
      { value: "keyword", label: "Keyword" },
    ],
  );
}

function externalKnowledgeSpaceModeOptions(space: Record<string, unknown>) {
  return normalizeModeOptions(
    space.retrievalModes || space.searchModes,
    [{ value: "backendContract", label: "Backend Contract" }],
  );
}

export function createConsoleKnowledgeRecallTargetController(
  options: ConsoleKnowledgeRecallTargetControllerOptions,
) {
  const knowledgeRecallDebugForm = ref<KnowledgeRecallDebugFormState>({
    query: "",
    targetId: "internal:global",
    retrievalMode: "hybrid",
    keywordOnly: false,
    learningEnabled: true,
    explain: true,
  });
  const knowledgeRecallBackendSpacesResult = ref<Record<string, unknown> | null>(null);

  const knowledgeRecallBackendSpaces = computed<Array<Record<string, unknown>>>(() => {
    const spaces = knowledgeRecallBackendSpacesResult.value?.spaces;
    return Array.isArray(spaces) ? spaces as Array<Record<string, unknown>> : [];
  });

  const knowledgeRecallDebugTargets = computed<KnowledgeRecallDebugTarget[]>(() => {
    const coreModes = coreModeOptions(options.knowledgeConsole.value);
    const targets: KnowledgeRecallDebugTarget[] = [{
      value: "internal:global",
      label: "全局知识空间",
      kind: "internal",
      modeOptions: coreModes,
    }];
    for (const source of options.activeKnowledgeSources.value) {
      targets.push({
        value: `source:${source.sourceId}`,
        label: source.label || source.directoryPath || "受管知识目录",
        kind: "source",
        sourceId: source.sourceId,
        modeOptions: coreModes,
      });
    }
    for (const space of knowledgeRecallBackendSpaces.value) {
      const provider = String(space.provider || "").trim();
      const spaceId = String(space.spaceId || "").trim();
      if (!spaceId) {
        continue;
      }
      targets.push({
        value: `external:${spaceId}`,
        label: `${String(space.label || provider || "外部知识库")} · ${provider || "external"}`,
        kind: "external",
        provider,
        spaceId,
        modeOptions: externalKnowledgeSpaceModeOptions(space),
      });
    }
    return targets;
  });

  const knowledgeRecallDebugTargetOptions = computed<OptionBarOption[]>(() =>
    knowledgeRecallDebugTargets.value.map((target) => ({
      value: target.value,
      label: target.label,
    })),
  );

  const selectedKnowledgeRecallDebugTarget = computed<KnowledgeRecallDebugTarget>(() =>
    knowledgeRecallDebugTargets.value.find((target) => target.value === knowledgeRecallDebugForm.value.targetId) ||
      knowledgeRecallDebugTargets.value[0],
  );

  const knowledgeRecallDebugModeOptionBarOptions = computed<OptionBarOption[]>(() =>
    selectedKnowledgeRecallDebugTarget.value?.modeOptions?.length
      ? selectedKnowledgeRecallDebugTarget.value.modeOptions
      : coreModeOptions(options.knowledgeConsole.value),
  );

  function ensureKnowledgeRecallDebugSelection() {
    const targets = knowledgeRecallDebugTargets.value;
    if (!targets.length) {
      return;
    }
    if (!targets.some((target) => target.value === knowledgeRecallDebugForm.value.targetId)) {
      knowledgeRecallDebugForm.value.targetId = targets[0].value;
    }
    const modes = knowledgeRecallDebugModeOptionBarOptions.value;
    if (modes.length && !modes.some((option) => option.value === knowledgeRecallDebugForm.value.retrievalMode)) {
      knowledgeRecallDebugForm.value.retrievalMode = String(modes[0].value);
    }
  }

  watch(knowledgeRecallDebugTargets, ensureKnowledgeRecallDebugSelection, { immediate: true });
  watch(() => knowledgeRecallDebugForm.value.targetId, ensureKnowledgeRecallDebugSelection);
  watch(knowledgeRecallDebugModeOptionBarOptions, ensureKnowledgeRecallDebugSelection);

  async function refreshKnowledgeRecallBackendSpaces() {
    try {
      knowledgeRecallBackendSpacesResult.value = await listKnowledgeSpaces();
    } catch {
      knowledgeRecallBackendSpacesResult.value = null;
    } finally {
      ensureKnowledgeRecallDebugSelection();
    }
  }

  return {
    knowledgeRecallDebugForm,
    knowledgeRecallDebugModeOptionBarOptions,
    knowledgeRecallDebugTargetOptions,
    refreshKnowledgeRecallBackendSpaces,
    selectedKnowledgeRecallDebugTarget,
  };
}
