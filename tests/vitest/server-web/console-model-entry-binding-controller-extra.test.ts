import { ref } from "vue";
import { describe, expect, it } from "vitest";
import { createConsoleModelEntryBindingController } from "../../../server-web/composables/console-model-entry-binding-controller";

function modelEntry(overrides: Record<string, unknown> = {}) {
  return {
    uid: "agent-a",
    provider: "openai-chatgpt",
    model: "gpt-5",
    label: "Agent A",
    ...overrides,
  } as any;
}

function createHarness() {
  const entryA = modelEntry();
  const entryB = modelEntry({
    uid: "agent-b",
    provider: "deepseek",
    model: "deepseek-v4",
    label: "Agent B",
  });
  const settingsDraft = ref({
    agentExploreDefaults: {
      reviewFusionModelAlias: "agent-a",
    },
    moduleModelAssignments: {
      graphInsight: {
        provider: "openai-chatgpt",
        model: "gpt-5",
      },
      timelineDistillation: {
        provider: "deepseek",
        model: "deepseek-v4",
      },
    },
    moduleAgentProfiles: {
      graphInsight: {
        agents: {
          "openai-chatgpt:gpt-5": {
            temperature: 0.1,
          },
        },
      },
    },
  } as any);
  const visibleModelEntries = ref([entryA, entryB]);

  const controller = createConsoleModelEntryBindingController({
    agentExploreModelAlias: () => "agent-a",
    infoFeedModelAlias: () => "agent-a",
    infoFeedRunningSummary: () => ({
      modelAlias: "agent-a",
      runId: "run-1",
      status: "running",
    }),
    modelEntryMatchesAssignment: (entry, provider, model) =>
      String(entry.provider || "") === String(provider || "") &&
      String(entry.model || "") === String(model || ""),
    modelEntryMatchesUid: (entry, value) => String(entry.uid || "") === String(value || ""),
    modelEntryStatusKey: (entry) => `${entry.provider}:${entry.model}`,
    moduleNeedsIntelligence: (moduleId) => moduleId === "graphInsight" || moduleId === "timelineDistillation",
    ruleAuthoringModelAlias: () => "agent-a",
    settingsDraft,
    visibleModelEntries,
  });

  return {
    controller,
    entryA,
    entryB,
    settingsDraft,
    visibleModelEntries,
  };
}

describe("console model entry binding controller extra coverage", () => {
  it("deduplicates manually added bindings by binding id", () => {
    const { controller } = createHarness();
    const bindings: any[] = [];

    controller.addModelEntryBinding(bindings, {
      bindingId: "same",
      category: "测试",
      label: "第一次",
      detail: "first",
      source: "draft",
    });
    controller.addModelEntryBinding(bindings, {
      bindingId: "same",
      category: "测试",
      label: "第二次",
      detail: "second",
      source: "runtime",
    });

    expect(bindings).toEqual([
      {
        bindingId: "same",
        category: "测试",
        label: "第一次",
        detail: "first",
        source: "draft",
      },
    ]);
  });

  it("collects draft, runtime, review, assignment, and module profile bindings", () => {
    const { controller, entryA } = createHarness();

    const bindings = controller.collectModelEntryBindings(entryA);

    expect(bindings.map((item) => item.bindingId)).toEqual([
      "info-feed:form",
      "info-feed:running:run-1",
      "agent-explore:form",
      "rule-authoring:form",
      "knowledge-review:fusion",
      "module:graphInsight",
      "module-profile:graphInsight:openai-chatgpt:gpt-5",
    ]);
    expect(bindings.map((item) => item.label)).toEqual([
      "信息流智能体",
      "正在运行的信息流",
      "智能检索",
      "规则生成",
      "知识融合智能体",
      "知识图谱智能体",
      "知识图谱智能体 专属配置",
    ]);
    expect(controller.modelEntryIsBound(entryA)).toBe(true);
    expect(controller.modelEntryBindingSummary(entryA)).toBe(
      "信息流智能体、正在运行的信息流、智能检索、规则生成、知识融合智能体、知识图谱智能体、知识图谱智能体 专属配置",
    );
  });

  it("builds bindings by status key and returns empty summary for unbound entries", () => {
    const { controller, entryB, visibleModelEntries, settingsDraft } = createHarness();

    expect(controller.modelEntryBindings(entryB).map((item) => item.bindingId)).toEqual([
      "module:timelineDistillation",
    ]);
    expect(controller.modelEntryBindingsByKey.value["deepseek:deepseek-v4"]).toHaveLength(1);

    settingsDraft.value.moduleModelAssignments = {};
    settingsDraft.value.moduleAgentProfiles = {};
    visibleModelEntries.value = [entryB];

    expect(controller.modelEntryBindings(entryB)).toEqual([]);
    expect(controller.modelEntryIsBound(entryB)).toBe(false);
    expect(controller.modelEntryBindingSummary(entryB)).toBe("");
    expect(controller.modelEntryBindings(modelEntry({ uid: "agent-missing", provider: "x", model: "y" }))).toEqual([]);
  });
});
