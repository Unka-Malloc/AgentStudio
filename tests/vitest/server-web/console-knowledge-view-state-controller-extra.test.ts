// @vitest-environment jsdom
import { nextTick, ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createConsoleKnowledgeViewStateController,
  unifiedKnowledgeIngestPipelineConfig,
} from "../../../server-web/composables/console-knowledge-view-state-controller";
import type { KnowledgeTab } from "../../../server-web/composables/useConsole";

const routeAndEffectMocks = vi.hoisted(() => ({
  route: { params: { tab: "" as string } },
  scrollDataAttributeElementIntoView: vi.fn(),
}));

vi.mock("vue-router", () => ({
  useRoute: () => routeAndEffectMocks.route,
}));

vi.mock("../../../server-web/composables/console-browser-effects", () => ({
  scrollDataAttributeElementIntoView: routeAndEffectMocks.scrollDataAttributeElementIntoView,
}));

function makeController(overrides: {
  collapsedIds?: string[];
  fallbackTab?: KnowledgeTab;
  managementPanel?: string;
} = {}) {
  const collapsedWordBagIds = ref(new Set(overrides.collapsedIds || []));
  const knowledgeManagementPanel = ref(overrides.managementPanel || "knowledge");
  const knowledgeTab = ref<KnowledgeTab>(overrides.fallbackTab || "wordCloud");
  const toggleWordCloudCollapsed = vi.fn((wordBagId: string) => {
    const next = new Set(collapsedWordBagIds.value);
    if (next.has(wordBagId)) {
      next.delete(wordBagId);
    } else {
      next.add(wordBagId);
    }
    collapsedWordBagIds.value = next;
  });

  return {
    collapsedWordBagIds,
    controller: createConsoleKnowledgeViewStateController({
      collapsedWordBagIds,
      knowledgeManagementPanel,
      knowledgeTab,
      toggleWordCloudCollapsed,
    }),
    knowledgeManagementPanel,
    knowledgeTab,
    toggleWordCloudCollapsed,
  };
}

beforeEach(() => {
  routeAndEffectMocks.route.params.tab = "";
  routeAndEffectMocks.scrollDataAttributeElementIntoView.mockReset();
});

describe("console knowledge view state controller extra coverage", () => {
  it("maps route tabs and falls back to the shell knowledge tab", () => {
    routeAndEffectMocks.route.params.tab = "";
    const fallbackController = makeController({ fallbackTab: "wordCloud" }).controller;
    expect(fallbackController.activeKnowledgeTab.value).toBe("wordCloud");
    expect(fallbackController.isKnownKnowledgeTab.value).toBe(true);
    expect(fallbackController.isManagementKnowledgePanel.value).toBe(false);
    expect(fallbackController.isManagementRulesPanel.value).toBe(false);

    routeAndEffectMocks.route.params.tab = "chunking";
    const chunkingController = makeController({ managementPanel: "knowledge" }).controller;
    expect(chunkingController.activeKnowledgeTab.value).toBe("management");
    expect(chunkingController.isManagementKnowledgePanel.value).toBe(true);
    expect(chunkingController.isManagementRulesPanel.value).toBe(false);
    expect(chunkingController.isKnownKnowledgeTab.value).toBe(true);

    routeAndEffectMocks.route.params.tab = "distillation";
    const distillationController = makeController({ managementPanel: "rules" }).controller;
    expect(distillationController.activeKnowledgeTab.value).toBe("management");
    expect(distillationController.isManagementKnowledgePanel.value).toBe(false);
    expect(distillationController.isManagementRulesPanel.value).toBe(true);

    routeAndEffectMocks.route.params.tab = "unknown";
    const maintenanceFallbackController = makeController({ fallbackTab: "maintenance" }).controller;
    expect(maintenanceFallbackController.activeKnowledgeTab.value).toBe("maintenance");
    expect(maintenanceFallbackController.isKnownKnowledgeTab.value).toBe(true);
  });

  it("toggles local expansion state and exposes preview policy constants", () => {
    const { controller } = makeController();

    controller.toggleSummaryExpanded("bag-a");
    expect([...controller.expandedSummaryIds.value]).toEqual(["bag-a"]);
    controller.toggleSummaryExpanded("bag-a");
    expect([...controller.expandedSummaryIds.value]).toEqual([]);

    controller.toggleAdvancedExpanded("bag-b");
    expect([...controller.expandedAdvancedIds.value]).toEqual(["bag-b"]);
    controller.toggleAdvancedExpanded("bag-b");
    expect([...controller.expandedAdvancedIds.value]).toEqual([]);

    controller.titleFocusedWordBagId.value = "bag-title";
    controller.documentPreviewResult.value = { ok: true };
    expect(controller.titleFocusedWordBagId.value).toBe("bag-title");
    expect(controller.documentPreviewResult.value).toEqual({ ok: true });
    expect(controller.unifiedKnowledgeIngestPipelineConfig).toBe(unifiedKnowledgeIngestPipelineConfig);
    expect(controller.dynamicParsingPreviewConfig).toMatchObject({
      dynamicParsing: { preserveStructureArtifacts: true },
      pipelineId: "dynamic-parameter-v1",
    });
    expect(JSON.parse(controller.dynamicParsingPolicySignature)).toMatchObject({
      expectedOutputs: ["preprocessResult", "chunks", "structureArtifacts", "granularityFragments"],
      payloadBudget: { maxResponseBytes: 1048576 },
    });
    expect(controller.dynamicParsingProfile).toMatchObject({
      parentArtifactId: "structureArtifacts[].metadata.parentArtifactId",
      structureArtifacts: "structureArtifacts",
    });
  });

  it("expands a collapsed word cloud before scrolling to it", async () => {
    const collapsed = makeController({ collapsedIds: ["bag-collapsed"] });

    collapsed.controller.jumpToCloud("bag-collapsed");
    expect(collapsed.toggleWordCloudCollapsed).toHaveBeenCalledWith("bag-collapsed");
    expect(collapsed.collapsedWordBagIds.value.has("bag-collapsed")).toBe(false);
    await nextTick();
    expect(routeAndEffectMocks.scrollDataAttributeElementIntoView).toHaveBeenCalledWith(
      "data-word-bag-id",
      "bag-collapsed",
    );

    routeAndEffectMocks.scrollDataAttributeElementIntoView.mockReset();
    const expanded = makeController({ collapsedIds: [] });
    expanded.controller.jumpToCloud("bag-open");
    expect(expanded.toggleWordCloudCollapsed).not.toHaveBeenCalled();
    await nextTick();
    expect(routeAndEffectMocks.scrollDataAttributeElementIntoView).toHaveBeenCalledWith(
      "data-word-bag-id",
      "bag-open",
    );
  });
});
