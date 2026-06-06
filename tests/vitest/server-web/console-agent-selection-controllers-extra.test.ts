// @vitest-environment jsdom
import { nextTick, ref } from "vue";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  createConsoleAgentSelectionReferenceController,
  AGENT_SELECTION_REFERENCE_LOG_LIMIT,
} from "../../../server-web/composables/console-agent-selection-reference-controller";
import {
  createConsoleAgentSelectorController,
  inactiveAgentModelOption,
  normalizeAgentSelectorOption,
  selectedAgentFromOptions,
} from "../../../server-web/composables/console-agent-selector-controller";

function selectorOption(overrides: Record<string, unknown> = {}) {
  return {
    value: "agent-a",
    agentUid: "agent-a",
    label: "Agent A",
    provider: "openai-chatgpt",
    model: "gpt",
    moduleIds: ["agentTools"],
    capabilities: ["search"],
    status: "ready",
    selectable: true,
    reason: "",
    ...overrides,
  } as any;
}

function createSelectorHarness(options = [selectorOption()]) {
  const agentExploreForm = ref({
    query: "",
    modelAlias: "agent-a",
    contextProfileId: "",
    thinkingMode: "default",
    temperature: 0.2,
    maxTokens: 1000,
    maxIterations: 3,
    limit: 8,
    toolChoice: "auto",
    workspaceId: "",
  });
  const agentModelOptionLabelCache = ref<Record<string, string>>({});
  const consoleState = ref({
    agentSelector: {
      options,
    },
  } as any);
  const controller = createConsoleAgentSelectorController({
    agentExploreForm,
    agentModelOptionLabelCache,
    consoleState,
  });

  return {
    agentExploreForm,
    agentModelOptionLabelCache,
    consoleState,
    controller,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-04T12:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("console agent selector controller", () => {
  it("normalizes selectable and disabled options", () => {
    expect(normalizeAgentSelectorOption(selectorOption({
      value: "legacy",
      agentUid: "agent-uid",
      selectable: false,
      reason: "permission denied",
    }))).toMatchObject({
      value: "agent-uid",
      enabled: false,
      disabledReason: "permission denied",
    });

    expect(inactiveAgentModelOption(" removed ")).toMatchObject({
      value: "removed",
      agentUid: "removed",
      label: "已移除的智能体",
      selectable: false,
      enabled: false,
      disabledReason: "已从智能体列表删除",
    });

    expect(selectedAgentFromOptions([], "")).toMatchObject({
      value: "",
      label: "未选择智能体",
      disabledReason: "未分配",
    });
    expect(selectedAgentFromOptions([], "missing")).toMatchObject({
      value: "missing",
      label: "已移除的智能体",
    });
  });

  it("filters options by module and derives selected model state", () => {
    const harness = createSelectorHarness([
      selectorOption({ agentUid: "agent-a", label: "Agent A", moduleIds: ["agentTools"] }),
      selectorOption({ agentUid: "agent-b", label: "Agent B", moduleIds: ["admin"] }),
      selectorOption({ agentUid: "agent-c", label: "Agent C", moduleIds: ["*"], selectable: false, reason: "offline" }),
    ]);

    expect(harness.controller.agentSelectorOptions.value.map((item) => item.value)).toEqual([
      "agent-a",
      "agent-b",
      "agent-c",
    ]);
    expect(harness.controller.agentOptionsForModule("agentTools").map((item) => item.value)).toEqual([
      "agent-a",
      "agent-c",
    ]);
    expect(harness.controller.agentExploreAgentOptions.value.map((item) => item.value)).toEqual([
      "agent-a",
      "agent-c",
    ]);
    expect(harness.controller.selectedAgentExploreModel.value).toMatchObject({
      value: "agent-a",
      label: "Agent A",
      enabled: true,
    });

    harness.agentExploreForm.value.modelAlias = "agent-c";
    expect(harness.controller.selectedAgentExploreModel.value).toMatchObject({
      value: "agent-c",
      enabled: false,
      disabledReason: "offline",
    });

    harness.agentExploreForm.value.modelAlias = "deleted";
    expect(harness.controller.selectedAgentExploreModel.value).toMatchObject({
      value: "deleted",
      label: "已移除的智能体",
    });
  });

  it("validates, labels, and caches model options from current state", () => {
    const harness = createSelectorHarness([
      selectorOption({ agentUid: "agent-a", label: "Agent A" }),
      selectorOption({ agentUid: "agent-b", label: "Agent B" }),
    ]);

    expect([...harness.controller.agentModelOptionValueSet.value]).toEqual(["agent-a", "agent-b"]);
    expect(harness.controller.hasAgentModelOption("agent-a")).toBe(true);
    expect(harness.controller.hasAgentModelOption(" missing ")).toBe(false);
    expect(harness.controller.validAgentModelAlias("agent-b")).toBe("agent-b");
    expect(harness.controller.validAgentModelAlias("agent-z")).toBe("");
    expect(harness.controller.currentAgentModelOptionLabel("agent-a")).toBe("Agent A");
    expect(harness.controller.currentAgentModelOptionLabel("")).toBe("");
    expect(harness.controller.currentAgentModelOptionLabel("agent-z")).toBe("");

    harness.controller.cacheAgentModelOptionLabels([
      { value: " agent-a ", label: "Cached A" },
      { value: "agent-empty", label: " " },
      { value: "", label: "Nope" },
    ]);

    expect(harness.agentModelOptionLabelCache.value).toEqual({
      "agent-a": "Cached A",
    });

    harness.consoleState.value = null as any;
    expect(harness.controller.agentSelectorOptions.value).toEqual([]);
    expect(harness.controller.agentExploreAgentOptions.value).toEqual([]);
  });
});

describe("console agent selection reference controller", () => {
  it("logs lost and restored references while suppressing duplicate states", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const controller = createConsoleAgentSelectionReferenceController();

    expect(controller.normalizeAgentSelectionAlias(" agent-a ")).toBe("agent-a");

    controller.trackAgentSelectionReference("agentExplore", "智能检索", "agent-a", {
      enabled: false,
      label: "已移除的智能体",
      selectable: false,
    });
    expect(controller.agentSelectionReferenceLogs.value).toHaveLength(1);
    expect(controller.agentSelectionReferenceLogs.value[0]).toMatchObject({
      kindLabel: "智能体引用",
      target: "智能检索（agent-a）",
      status: "missing",
      statusLabel: "引用丢失",
      tone: "warning",
    });

    controller.trackAgentSelectionReference("agentExplore", "智能检索", "agent-a", {
      enabled: false,
      label: "已移除的智能体",
      selectable: false,
    });
    expect(controller.agentSelectionReferenceLogs.value).toHaveLength(1);

    controller.trackAgentSelectionReference("agentExplore", "智能检索", "agent-a", {
      enabled: true,
      label: "Agent A",
      selectable: true,
    });
    expect(controller.agentSelectionReferenceLogs.value).toHaveLength(2);
    expect(controller.agentSelectionReferenceLogs.value[0]).toMatchObject({
      status: "available",
      statusLabel: "引用恢复",
      tone: "success",
    });

    controller.trackAgentSelectionReference("agentExplore", "智能检索", "agent-a", {
      enabled: false,
      label: "已移除的智能体",
      selectable: false,
    });
    expect(controller.agentSelectionReferenceLogs.value[0]).toMatchObject({
      status: "missing",
      statusLabel: "引用丢失",
    });
    expect(controller.agentSelectionReferenceStates.value.agentExplore).toEqual({
      alias: "agent-a",
      state: "removed",
    });
    expect(warnSpy).toHaveBeenCalled();
  });

  it("caps explicit logs and watches alias/selection changes", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const controller = createConsoleAgentSelectionReferenceController();

    for (let index = 0; index < AGENT_SELECTION_REFERENCE_LOG_LIMIT + 3; index += 1) {
      controller.emitAgentSelectionReferenceLog({
        context: "bulk",
        contextLabel: "批量",
        alias: `agent-${index}`,
        stage: "lost",
        reason: "missing",
      });
    }
    expect(controller.agentSelectionReferenceLogs.value).toHaveLength(AGENT_SELECTION_REFERENCE_LOG_LIMIT);
    expect(controller.agentSelectionReferenceLogs.value[0].target).toContain("agent-82");

    const alias = ref("agent-watch");
    const selectable = ref(false);
    controller.watchAgentSelectionReference(
      "watch",
      "Watcher",
      () => alias.value,
      () => ({
        enabled: selectable.value,
        label: selectable.value ? "Agent Watch" : "Removed",
        selectable: selectable.value,
      }),
    );
    await nextTick();
    expect(controller.agentSelectionReferenceStates.value.watch).toEqual({
      alias: "agent-watch",
      state: "removed",
    });

    selectable.value = true;
    await nextTick();
    expect(controller.agentSelectionReferenceLogs.value[0]).toMatchObject({
      target: "Watcher（agent-watch）",
      status: "available",
    });

    alias.value = "";
    await nextTick();
    expect(controller.agentSelectionReferenceStates.value.watch).toEqual({
      alias: "",
      state: "empty",
    });
    expect(warnSpy).toHaveBeenCalled();
  });
});
