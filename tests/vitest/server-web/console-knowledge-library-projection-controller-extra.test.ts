import { ref } from "vue";
import { describe, expect, it } from "vitest";
import {
  createConsoleKnowledgeLibraryProjectionController,
  type KnowledgeBackendProviderOption,
  type KnowledgeBackendProviderForm,
} from "../../../server-web/composables/console-knowledge-library-projection-controller";

describe("console knowledge library projection controller extra coverage", () => {
  it("builds visible cards from non-fixture spaces and preserves provider order", () => {
    const knowledgeBackendSpacesResult = ref<Record<string, unknown> | null>({
      metadataPolicy: "safeMetadataOnly",
      spaces: [
        {
          provider: "Dify",
          spaceId: "dify-primary",
          displayName: "Dify Alpha",
          description: "Primary external space",
          accessMode: "readwrite",
          dataClass: "graph",
          metadataPolicy: "publicOnly",
          contractVerified: true,
          derivedKnowledgeSpace: "legacy",
          upstreamRef: "u-1",
          sensitivity: "low",
          retrievalModes: ["vector", "bm25"],
        },
        {
          provider: "dify",
          label: "dify contract handbook",
          description: "Fixture space should be hidden",
          spaceId: "dify-fixture",
        },
        {
          provider: "ragflow",
          description: "contract metadata fixture space",
          spaceId: "ragflow-fixture",
        },
        {
          provider: "ragflow",
          spaceId: "ragflow-primary",
          title: "RAGFlow Alpha",
        },
        {
          provider: "pact",
          spaceId: "native-primary",
          derivedKnowledgeSpace: "native-derived",
        },
      ],
    });

    const knowledgeBackendProviderOptions: KnowledgeBackendProviderOption[] = [
      { value: "dify", label: "Dify" },
      { value: "ragflow", label: "RAG Flow" },
    ];
    const knowledgeBackendProviderForms = ref<Record<string, KnowledgeBackendProviderForm>>({
      dify: { mode: "contract", secretRef: "secret://dify", endpointRef: "endpoint://dify" },
      ragflow: { mode: "contract", secretRef: "secret://ragflow", endpointRef: "endpoint://ragflow" },
    });

    const controller = createConsoleKnowledgeLibraryProjectionController({
      knowledgeBackendProviderForms,
      knowledgeBackendProviderOptions,
      knowledgeBackendSpacesResult,
    });

    expect(controller.knowledgeBackendSpaces.value).toHaveLength(5);
    expect(controller.realKnowledgeBackendSpaces.value).toHaveLength(3);
    expect(controller.knowledgeLibraryCards.value).toHaveLength(3);
    expect(controller.knowledgeLibraryCards.value.map((card) => card.id)).toEqual([
      "external:dify-primary",
      "external:ragflow-primary",
      "external:native-primary",
    ]);
    expect(controller.knowledgeLibraryCards.value[0]).toMatchObject({
      providerLabel: "Dify",
      statusLabel: "已验证",
      statusTone: "success",
      description: "Primary external space",
      meta: ["readwrite", "graph", "publicOnly"],
    });
    expect(
      Object.fromEntries(
        controller.knowledgeLibraryCards.value[0].details.map((item) => [item.label, item.value]),
      )["Space ID"],
    ).toBe("dify-primary");
    expect(
      Object.fromEntries(
        controller.knowledgeLibraryCards.value[0].details.map((item) => [item.label, item.value]),
      )["Provider"],
    ).toBe("Dify");
    expect(controller.knowledgeLibraryCards.value[1]).toMatchObject({
      providerLabel: "RAG Flow",
      statusLabel: "元数据可见",
      statusTone: "info",
      description: "由 RAG Flow 暴露的派生知识空间。",
    });
    expect(controller.knowledgeLibraryCards.value[2]).toMatchObject({
      providerLabel: "pact",
      statusLabel: "元数据可见",
      title: "native-derived",
    });

    expect(controller.knowledgeBackendProviderCards.value[0]).toMatchObject({
      provider: "dify",
      title: "Dify",
      description: "Dify 后端配置",
      statusLabel: "1 个知识库",
      statusTone: "success",
      meta: ["contract", "secretRef"],
    });
    expect(
      Object.fromEntries(
        controller.knowledgeBackendProviderCards.value[0].details.map((item) => [item.label, item.value]),
      ),
    ).toMatchObject({
      Provider: "Dify",
      模式: "contract",
      "Secret Ref": "secret://dify",
      "Endpoint Ref": "endpoint://dify",
      知识库: "1 个",
      检索模式: JSON.stringify(["vector", "bm25"]),
    });
    expect(controller.knowledgeBackendProviderCards.value[1]).toMatchObject({
      provider: "ragflow",
      title: "RAG Flow",
      description: "RAG Flow 后端配置",
      statusLabel: "1 个知识库",
      statusTone: "success",
      meta: ["contract", "secretRef"],
    });
    expect(
      Object.fromEntries(
        controller.knowledgeBackendProviderCards.value[1].details.map((item) => [item.label, item.value]),
      ),
    ).toMatchObject({
      Provider: "RAG Flow",
      模式: "contract",
      "Secret Ref": "secret://ragflow",
      "Endpoint Ref": "endpoint://ragflow",
      知识库: "1 个",
      检索模式: "-",
    });
  });

  it("supports fallback projection values when spaces are empty", () => {
    const knowledgeBackendSpacesResult = ref<Record<string, unknown> | null>({
      metadataPolicy: "publicOnly",
      spaces: [],
    });
    const knowledgeBackendProviderOptions: KnowledgeBackendProviderOption[] = [
      { value: "dify", label: "Dify" },
      { value: "ragflow", label: "RAG Flow" },
    ];
    const knowledgeBackendProviderForms = ref<Record<string, KnowledgeBackendProviderForm>>({
      dify: { mode: "contract", secretRef: "", endpointRef: "" },
      ragflow: { mode: "live", secretRef: "secret://ragflow", endpointRef: "endpoint://ragflow" },
    });

    const controller = createConsoleKnowledgeLibraryProjectionController({
      knowledgeBackendProviderForms,
      knowledgeBackendProviderOptions,
      knowledgeBackendSpacesResult,
    });

    expect(controller.knowledgeBackendSpaces.value).toEqual([]);
    expect(controller.realKnowledgeBackendSpaces.value).toEqual([]);
    expect(controller.knowledgeLibraryCards.value).toEqual([]);
    expect(controller.knowledgeBackendProviderCards.value[0]).toMatchObject({
      provider: "dify",
      statusLabel: "未连接",
      statusTone: "warning",
    });
    expect(
      Object.fromEntries(
        controller.knowledgeBackendProviderCards.value[0].details.map((item) => [item.label, item.value]),
      ),
    ).toMatchObject({ 知识库: "0 个", 检索模式: "-" });
    expect(controller.knowledgeBackendProviderCards.value[1]).toMatchObject({
      provider: "ragflow",
      statusLabel: "未连接",
      meta: ["live", "secretRef"],
    });
    expect(controller.metadataPolicyLabel(null)).toBe("publicOnly");
  });

  it("maps labels and names through dedicated helpers", () => {
    const knowledgeBackendSpacesResult = ref<Record<string, unknown> | null>({
      spaces: [{ provider: "pact", name: "Pact Name", spaceId: "s-1" }],
    });
    const knowledgeBackendProviderOptions: KnowledgeBackendProviderOption[] = [{ value: "dify", label: "Dify" }];
    const knowledgeBackendProviderForms = ref<Record<string, KnowledgeBackendProviderForm>>({
      dify: { mode: "contract", secretRef: "secret://dify", endpointRef: "endpoint://dify" },
    });

    const controller = createConsoleKnowledgeLibraryProjectionController({
      knowledgeBackendProviderForms,
      knowledgeBackendProviderOptions,
      knowledgeBackendSpacesResult,
    });

    expect(controller.externalProviderLabel("dify")).toBe("Dify");
    expect(controller.externalProviderLabel("UNKNOWN")).toBe("UNKNOWN");
    expect(controller.knowledgeLibraryDisplayTitle("dify", "fallback")).toBe("Dify");
    expect(controller.knowledgeLibraryDisplayTitle("native", "fallback")).toBe("Pact Native");
    expect(controller.knowledgeLibraryDisplayTitle("other", "fallback")).toBe("fallback");
    expect(
      controller.knowledgeBackendSpaceDisplayName(
        {
          name: "Pact Name",
          label: "Fallback Label",
          displayName: "Display Name",
          title: "Title",
          derivedKnowledgeSpace: "Derived",
          spaceId: "s-1",
        },
        "Fallback",
      ),
    ).toBe("Display Name");
    expect(controller.textField({}, "missing", "fallback")).toBe("fallback");
  });
});
