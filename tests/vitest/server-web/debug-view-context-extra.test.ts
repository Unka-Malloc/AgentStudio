// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { describe, expect, it } from "vitest";
import {
  createDebugViewContext,
  provideDebugView,
  useDebugViewContext,
} from "../../../server-web/composables/debugViewContext";

function makeDebugView() {
  return {
    busyKey: "debug-busy",
    distillationBusy: false,
    distillationError: "",
    distillationFile: null,
    distillationFileLabel: "未选择",
    distillationModelAlias: "model-a",
    distillationModelLabel: "Model A",
    distillationModelOptions: [{ label: "Model A", value: "model-a" }],
    distillationModelReady: true,
    distillationProgressSegments: [],
    distillationProgressSummary: "ready",
    distillationResultFiles: [],
    distillationRunId: "",
    distillationStatusMessage: "ready",
    distillationStep: "idle",
    handleDebugDistillationFileSelected: () => undefined,
    knowledgeConsole: { available: true },
    knowledgeRecallDebugForm: { query: "" },
    knowledgeRecallDebugGridStyle: { gridTemplateColumns: "1fr" },
    knowledgeRecallDebugModeOptionBarOptions: [],
    knowledgeRecallDebugRuns: [],
    knowledgeRecallDebugTargetOptions: [],
    knowledgeSourceState: { items: [] },
    knowledgeStatus: { available: true },
    openAgentEvidencePreview: () => undefined,
    runKnowledgeRecallDebugBatch: () => undefined,
    startDebugKnowledgeDistillation: () => undefined,
    ignoredExtraKey: "ignore me",
  } as any;
}

describe("debug view context extra coverage", () => {
  it("projects only the debug view keys and provides the context", () => {
    const debugView = makeDebugView();
    const context = createDebugViewContext(debugView);
    const observed: Record<string, unknown> = {};
    const Consumer = defineComponent({
      setup() {
        observed.context = useDebugViewContext();
        return () => h("span", "debug consumer");
      },
    });
    const Host = defineComponent({
      setup() {
        provideDebugView(context);
        return () => h(Consumer);
      },
    });

    const wrapper = mount(Host);

    expect(wrapper.text()).toBe("debug consumer");
    expect(observed.context).toBe(context);
    expect(context.busyKey).toBe("debug-busy");
    expect(context.distillationModelAlias).toBe("model-a");
    expect(context.knowledgeConsole).toEqual({ available: true });
    expect("ignoredExtraKey" in context).toBe(false);
  });

  it("throws an explicit error without a provider", () => {
    expect(() => useDebugViewContext()).toThrow("Debug view context is not available");
  });
});
