import { computed, type Ref } from "vue";
import type { KnowledgeIngestTargetKind } from "../lib/types";

type ReadonlyRef<T> = {
  readonly value: T;
};

type KnowledgeIngestTargetOption = {
  value: string;
  label: string;
  provider?: string;
  spaceId?: string;
};

type ConsoleKnowledgeIngestTargetControllerOptions = {
  externalProviderLabel: (provider: unknown) => string;
  knowledgeBackendSpaceDisplayName: (space: Record<string, unknown>, providerLabel: string) => string;
  knowledgeIngestExternalProvider: Ref<string>;
  knowledgeIngestExternalRefs: Ref<string>;
  knowledgeIngestExternalTargetLabels: Ref<Record<string, string>>;
  knowledgeIngestTargets: Ref<Record<KnowledgeIngestTargetKind, boolean>>;
  knowledgeIngestTeamRefs: Ref<string>;
  knowledgeIngestUserRefs: Ref<string>;
  knowledgeLibraryDisplayTitle: (provider: unknown, fallback: string) => string;
  realKnowledgeBackendSpaces: ReadonlyRef<Array<Record<string, unknown>>>;
  textField: (record: Record<string, unknown>, key: string, fallback?: string) => string;
};

const KNOWLEDGE_INGEST_EXTERNAL_PREFIX = "external:";

export function createConsoleKnowledgeIngestTargetController(
  options: ConsoleKnowledgeIngestTargetControllerOptions,
) {
  function knowledgeIngestExternalValue(provider: string, spaceId: string) {
    return `${KNOWLEDGE_INGEST_EXTERNAL_PREFIX}${provider}:${spaceId}`;
  }

  function parseKnowledgeIngestExternalValue(value: string) {
    if (!value.startsWith(KNOWLEDGE_INGEST_EXTERNAL_PREFIX)) {
      return null;
    }
    const externalRef = value.slice(KNOWLEDGE_INGEST_EXTERNAL_PREFIX.length);
    const separatorIndex = externalRef.indexOf(":");
    if (separatorIndex <= 0 || separatorIndex === externalRef.length - 1) {
      return null;
    }
    return {
      provider: externalRef.slice(0, separatorIndex),
      spaceId: externalRef.slice(separatorIndex + 1),
    };
  }

  function parseKnowledgeIngestExternalRef(ref: string) {
    const separatorIndex = ref.indexOf(":");
    if (separatorIndex <= 0 || separatorIndex === ref.length - 1) {
      const provider = options.knowledgeIngestExternalProvider.value || "dify";
      return ref ? knowledgeIngestExternalValue(provider, ref) : "";
    }
    return knowledgeIngestExternalValue(ref.slice(0, separatorIndex), ref.slice(separatorIndex + 1));
  }

  const knowledgeIngestTargetOptions = computed<KnowledgeIngestTargetOption[]>(() => {
    const values: KnowledgeIngestTargetOption[] = [];
    const seen = new Set(values.map((option) => option.value));
    for (const space of options.realKnowledgeBackendSpaces.value) {
      const provider = String(space.provider || "").trim().toLowerCase();
      const spaceId = options.textField(space, "spaceId");
      if (!provider || !spaceId) {
        continue;
      }
      const value = knowledgeIngestExternalValue(provider, spaceId);
      if (seen.has(value)) {
        continue;
      }
      seen.add(value);
      const providerLabel = options.knowledgeLibraryDisplayTitle(
        space.provider,
        options.externalProviderLabel(space.provider),
      );
      values.push({
        value,
        label: options.knowledgeBackendSpaceDisplayName(space, providerLabel),
        provider,
        spaceId,
      });
    }
    return values;
  });

  const knowledgeIngestTargetValues = computed<string[]>({
    get: () => {
      const values: string[] = [];
      if (options.knowledgeIngestTargets.value.global) {
        values.push("global");
      }
      if (options.knowledgeIngestTargets.value.external) {
        const externalValues = String(options.knowledgeIngestExternalRefs.value || "")
          .split(/[,，\n]/)
          .map((item) => parseKnowledgeIngestExternalRef(item.trim()))
          .filter((value): value is string => Boolean(value));
        values.push(...externalValues);
      }
      const validValues = new Set(knowledgeIngestTargetOptions.value.map((option) => option.value));
      return values.filter((value) => validValues.has(value));
    },
    set: (values) => {
      const selectedValues = values.map(String);
      const externalTargets = selectedValues
        .map((value) => parseKnowledgeIngestExternalValue(value))
        .filter((target): target is { provider: string; spaceId: string } => Boolean(target));
      const externalRefs = externalTargets.map((target) => `${target.provider}:${target.spaceId}`);
      const optionLabels = new Map(knowledgeIngestTargetOptions.value.map((option) => [option.value, option.label]));
      options.knowledgeIngestTargets.value = {
        global: false,
        external: externalRefs.length > 0,
        team: false,
        user: false,
      };
      options.knowledgeIngestExternalProvider.value =
        externalTargets[0]?.provider || options.knowledgeIngestExternalProvider.value;
      options.knowledgeIngestExternalRefs.value = externalRefs.join(", ");
      options.knowledgeIngestExternalTargetLabels.value = Object.fromEntries(
        externalTargets.map((target) => {
          const value = knowledgeIngestExternalValue(target.provider, target.spaceId);
          return [`${target.provider}:${target.spaceId}`, optionLabels.get(value) || target.spaceId];
        }),
      );
      options.knowledgeIngestTeamRefs.value = "";
      options.knowledgeIngestUserRefs.value = "";
    },
  });

  const knowledgeIngestTargetDisplaySummary = computed(() => {
    const selectedValues = new Set(knowledgeIngestTargetValues.value);
    const labels = knowledgeIngestTargetOptions.value
      .filter((option) => selectedValues.has(option.value))
      .map((option) => option.label);
    return labels.length ? `将入库到：${labels.join("、")}` : "请选择入库目标";
  });

  function setKnowledgeIngestTargetValues(values: string | number | boolean | Array<string | number | boolean>) {
    knowledgeIngestTargetValues.value = Array.isArray(values) ? values.map(String) : [String(values)];
  }

  return {
    knowledgeIngestExternalValue,
    knowledgeIngestTargetDisplaySummary,
    knowledgeIngestTargetOptions,
    knowledgeIngestTargetValues,
    parseKnowledgeIngestExternalRef,
    parseKnowledgeIngestExternalValue,
    setKnowledgeIngestTargetValues,
  };
}
