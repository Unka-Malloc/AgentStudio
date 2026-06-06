import { computed, type Ref } from "vue";

export type KnowledgeLibraryDetail = {
  label: string;
  value: string;
};

export type KnowledgeLibraryCard = {
  id: string;
  title: string;
  displayTitle: string;
  description: string;
  statusLabel: string;
  statusTone: string;
  boundaryLabel: string;
  boundaryTone: string;
  providerLabel: string;
  meta: string[];
  details: KnowledgeLibraryDetail[];
  externalSpace?: Record<string, unknown>;
};

export type KnowledgeBackendProviderCard = {
  provider: string;
  title: string;
  description: string;
  statusLabel: string;
  statusTone: string;
  meta: string[];
  details: KnowledgeLibraryDetail[];
};

export type KnowledgeBackendProviderOption = {
  value: string;
  label: string;
};

export type KnowledgeBackendProviderForm = {
  mode: string;
  secretRef: string;
  endpointRef: string;
};

type ConsoleKnowledgeLibraryProjectionControllerOptions = {
  knowledgeBackendProviderForms: Ref<Record<string, KnowledgeBackendProviderForm>>;
  knowledgeBackendProviderOptions: KnowledgeBackendProviderOption[];
  knowledgeBackendSpacesResult: Ref<Record<string, unknown> | null>;
};

export function createConsoleKnowledgeLibraryProjectionController(
  options: ConsoleKnowledgeLibraryProjectionControllerOptions,
) {
  const knowledgeBackendSpaces = computed<Array<Record<string, unknown>>>(() => {
    const items = options.knowledgeBackendSpacesResult.value?.spaces;
    return Array.isArray(items) ? items as Array<Record<string, unknown>> : [];
  });

  function textField(record: Record<string, unknown>, key: string, fallback = "") {
    const value = record[key];
    if (value === null || value === undefined || value === "") {
      return fallback;
    }
    return String(value);
  }

  function isContractFixtureKnowledgeSpace(space: Record<string, unknown>) {
    const label = textField(space, "label").toLowerCase();
    const description = textField(space, "description").toLowerCase();
    return (
      description.includes("contract metadata fixture") ||
      label === "dify contract handbook".toLowerCase() ||
      label === "ragflow contract handbook".toLowerCase()
    );
  }

  const realKnowledgeBackendSpaces = computed<Array<Record<string, unknown>>>(() =>
    knowledgeBackendSpaces.value.filter((space) => !isContractFixtureKnowledgeSpace(space)),
  );

  function externalProviderLabel(provider: unknown) {
    const id = String(provider || "").toLowerCase();
    return options.knowledgeBackendProviderOptions.find((option) => option.value === id)?.label ||
      String(provider || "外部");
  }

  function knowledgeLibraryDisplayTitle(provider: unknown, fallback: string) {
    const id = String(provider || "").toLowerCase();
    if (id === "pact" || id === "native" || id === "internal") return "Pact Native";
    if (id === "dify") return "Dify";
    if (id === "ragflow") return "RAG Flow";
    return fallback;
  }

  function knowledgeBackendSpaceDisplayName(space: Record<string, unknown>, providerLabel: string) {
    return (
      textField(space, "displayName") ||
      textField(space, "name") ||
      textField(space, "label") ||
      textField(space, "title") ||
      textField(space, "derivedKnowledgeSpace") ||
      textField(space, "spaceId") ||
      providerLabel
    );
  }

  function metadataPolicyLabel(value: unknown) {
    return String(value || options.knowledgeBackendSpacesResult.value?.metadataPolicy || "safeMetadataOnly");
  }

  const knowledgeLibraryCards = computed<KnowledgeLibraryCard[]>(() => {
    const cards: KnowledgeLibraryCard[] = [];
    for (const space of realKnowledgeBackendSpaces.value) {
      const providerLabel = externalProviderLabel(space.provider);
      const contractVerified = Boolean(
        space.contractVerified || options.knowledgeBackendSpacesResult.value?.contractVerified,
      );
      const title = knowledgeBackendSpaceDisplayName(
        space,
        knowledgeLibraryDisplayTitle(space.provider, providerLabel),
      );
      cards.push({
        id: `external:${textField(space, "spaceId", providerLabel)}`,
        title,
        displayTitle: title,
        description: textField(space, "description", `由 ${providerLabel} 暴露的派生知识空间。`),
        statusLabel: contractVerified ? "已验证" : "元数据可见",
        statusTone: contractVerified ? "success" : "info",
        boundaryLabel: "外部",
        boundaryTone: "warning",
        providerLabel,
        meta: [
          textField(space, "accessMode", "read"),
          textField(space, "dataClass", "knowledge"),
          metadataPolicyLabel(space.metadataPolicy),
        ],
        details: [
          { label: "Space ID", value: textField(space, "spaceId", "-") },
          { label: "Provider", value: providerLabel },
          { label: "派生空间", value: textField(space, "derivedKnowledgeSpace", "-") },
          { label: "上游引用", value: textField(space, "upstreamRef", "-") },
          { label: "元数据策略", value: metadataPolicyLabel(space.metadataPolicy) },
          { label: "敏感级别", value: textField(space, "sensitivity", "-") },
        ],
        externalSpace: space,
      });
    }
    return cards;
  });

  const knowledgeBackendProviderCards = computed<KnowledgeBackendProviderCard[]>(() =>
    options.knowledgeBackendProviderOptions.map((provider) => {
      const spaces = realKnowledgeBackendSpaces.value.filter(
        (space) => String(space.provider || "").toLowerCase() === provider.value,
      );
      const form = options.knowledgeBackendProviderForms.value[provider.value];
      return {
        provider: provider.value,
        title: provider.label,
        description: `${provider.label} 后端配置`,
        statusLabel: spaces.length ? `${spaces.length} 个知识库` : "未连接",
        statusTone: spaces.length ? "success" : "warning",
        meta: [
          form?.mode || "contract",
          "secretRef",
        ],
        details: [
          { label: "Provider", value: provider.label },
          { label: "模式", value: form?.mode || "contract" },
          { label: "Secret Ref", value: form?.secretRef || "-" },
          { label: "Endpoint Ref", value: form?.endpointRef || "-" },
          { label: "知识库", value: `${spaces.length} 个` },
          { label: "检索模式", value: spaces[0]?.retrievalModes ? JSON.stringify(spaces[0].retrievalModes) : "-" },
        ],
      };
    }),
  );

  return {
    externalProviderLabel,
    knowledgeBackendProviderCards,
    knowledgeBackendSpaceDisplayName,
    knowledgeBackendSpaces,
    knowledgeLibraryCards,
    knowledgeLibraryDisplayTitle,
    metadataPolicyLabel,
    realKnowledgeBackendSpaces,
    textField,
  };
}
