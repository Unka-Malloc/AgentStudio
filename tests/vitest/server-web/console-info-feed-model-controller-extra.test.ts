// @vitest-environment jsdom
import { nextTick, ref } from "vue";
import { describe, expect, it } from "vitest";
import type { AgentSettings } from "../../../server-web/lib/types";
import { emptySettings } from "../../../server-web/composables/console-defaults";
import {
  createConsoleInfoFeedModelController,
  type InfoFeedAgentOption,
} from "../../../server-web/composables/console-info-feed-model-controller";

function createSettingsDraft(overrides: Partial<AgentSettings> = {}) {
  return ref<AgentSettings>({
    ...emptySettings,
    ...overrides,
    agentExploreDefaults: {
      ...emptySettings.agentExploreDefaults,
      ...overrides.agentExploreDefaults,
    },
  });
}

function createController(overrides: {
  agentExploreContextWindowOptions?: Array<{ value: string; label: string; description?: string }>;
  agentExploreForm?: {
    thinkingMode: string;
    contextProfileId: string;
    modelAlias?: string;
    query?: string;
    temperature?: number;
    maxTokens?: number;
  };
  agentExploreThinkingModeOptions?: Array<{ value: string }>;
  agentSelectorOptions?: InfoFeedAgentOption[];
  settingsDraft?: ReturnType<typeof createSettingsDraft>;
} = {}) {
  const settingsDraft = overrides.settingsDraft || createSettingsDraft();
  const agentExploreForm = ref({
    thinkingMode: "default",
    contextProfileId: "context-32k",
    modelAlias: "",
    query: "",
    temperature: 0.2,
    maxTokens: 1800,
    ...(overrides.agentExploreForm || {}),
  });
  const agentExploreContextWindowOptions = overrides.agentExploreContextWindowOptions || [
    { value: "context-32k", label: "32K" },
    { value: "context-128k", label: "128K" },
  ];
  const agentSelectorOptions = ref(
    overrides.agentSelectorOptions || [
      {
        value: "model-a",
        agentUid: "model-a",
        label: "模型 A",
        provider: "openai",
        model: "gpt-5",
        moduleIds: ["agentTools"],
        capabilities: [],
        status: "available",
        enabled: true,
        selectable: true,
        disabledReason: "",
        reason: "",
      },
      {
        value: "model-b",
        agentUid: "model-b",
        label: "模型 B",
        provider: "openai",
        model: "gpt-5-mini",
        moduleIds: ["agentTools"],
        capabilities: [],
        status: "available",
        enabled: true,
        selectable: true,
        disabledReason: "",
        reason: "",
      },
    ],
  );

  const controller = createConsoleInfoFeedModelController({
    agentExploreContextWindowOptions,
    agentExploreForm,
    agentExploreThinkingModeOptions: overrides.agentExploreThinkingModeOptions || [
      { value: "default" },
      { value: "enabled" },
      { value: "disabled" },
    ],
    agentSelectorOptions,
    settingsDraft,
  });

  return {
    agentExploreForm,
    agentSelectorOptions,
    controller,
    settingsDraft,
  };
}

describe("console info feed model controller", () => {
  it("loads defaults, normalizes selections, and computes summary defaults", async () => {
    const { controller, settingsDraft } = createController({
      agentExploreForm: {
        thinkingMode: "disabled",
        contextProfileId: "context-32k",
        modelAlias: "",
      },
      settingsDraft: createSettingsDraft({
        agentExploreDefaults: {
          systemPrompt: "",
          toolPolicyPrompt: "",
          continuationPrompt: "",
          answerTemplate: "",
          contextProfileId: "context-128k",
          thinkingMode: "enabled",
          temperature: 0.55,
          maxTokens: 2048,
          maxIterations: 4,
          limit: 8,
          toolChoice: "auto",
          infoFeedSummaryModelAlias: " model-a ",
        },
      }),
    });

    await nextTick();

    expect(controller.infoFeedForm.value.modelAlias).toBe("model-a");
    expect(controller.selectedInfoFeedModel.value.value).toBe("model-a");
    expect(controller.selectedThinkingMode.value).toBe("disabled");
    expect(controller.agentExploreThinkingParameters()).toEqual({
      pact_thinking_mode: "disabled",
    });
    expect(controller.hasAgentModelOption(" model-a ")).toBe(true);
    expect(controller.validAgentModelAlias(" model-a ")).toBe("model-a");
    expect(controller.validAgentModelAlias("missing-model")).toBe("");
    expect(controller.infoFeedSummaryDefaults()).toEqual({
      modelAlias: "model-a",
      contextProfileId: "context-32k",
      temperature: 0.2,
      maxTokens: 1800,
    });
    expect(controller.infoFeedModelDisplayLabel("model-a")).toBe("模型 A");
    expect(controller.infoFeedModelDisplayLabel("missing-model")).toBe("已移除的智能体");
    expect(controller.infoFeedModelDisplayLabel("")).toBe("未记录");

    expect(settingsDraft.value.agentExploreDefaults?.infoFeedSummaryModelAlias).toBe(" model-a ");
  });

  it("falls back safely when context options are empty and reacts to late defaults", async () => {
    const { controller, settingsDraft } = createController({
      agentExploreContextWindowOptions: [],
      agentExploreForm: {
        thinkingMode: "unsupported",
        contextProfileId: "",
        modelAlias: "",
        temperature: 1.4,
        maxTokens: 2600,
      },
      agentSelectorOptions: [],
      settingsDraft: createSettingsDraft({
        agentExploreDefaults: {
          systemPrompt: "",
          toolPolicyPrompt: "",
          continuationPrompt: "",
          answerTemplate: "",
          contextProfileId: "",
          thinkingMode: "unsupported",
          temperature: 1.4,
          maxTokens: 2600,
          maxIterations: 4,
          limit: 8,
          toolChoice: "auto",
          infoFeedSummaryModelAlias: "",
        },
      }),
    });

    expect(controller.selectedInfoFeedModel.value.label).toBe("未选择智能体");
    expect(controller.selectedInfoFeedModel.value.disabledReason).toBe("未分配");
    expect(controller.infoFeedModelDisplayLabel("ghost-model")).toBe("已移除的智能体");
    expect(controller.selectedThinkingMode.value).toBe("default");
    expect(controller.agentExploreThinkingParameters()).toEqual({});
    expect(controller.selectedInfoFeedContextProfile.value.value).toBe("context-32k");
    expect(controller.selectedInfoFeedContextProfile.value.label).toBe("未配置上下文");
    expect(controller.infoFeedFallbackContextProfileId()).toBe("context-32k");
    controller.infoFeedForm.value.temperature = 1.4;
    controller.infoFeedForm.value.maxTokens = 2600;
    controller.infoFeedForm.value.contextProfileId = "";

    expect(controller.infoFeedSummaryDefaults()).toEqual({
      modelAlias: "",
      contextProfileId: "context-32k",
      temperature: 1.4,
      maxTokens: 2600,
    });

    settingsDraft.value.agentExploreDefaults = {
      ...(settingsDraft.value.agentExploreDefaults || {}),
      infoFeedSummaryModelAlias: "model-b",
    };
    await nextTick();

    expect(controller.infoFeedForm.value.modelAlias).toBe("model-b");
    expect(controller.selectedInfoFeedModel.value.value).toBe("model-b");
  });
});
