import { ref } from "vue";
import { describe, expect, it } from "vitest";
import { createConsoleAgentExploreStateController } from "../../../server-web/composables/console-agent-explore-state-controller";
import type { AgentSettings } from "../../../server-web/lib/types";

function createSettings(overrides: Partial<AgentSettings> = {}) {
  return ref<AgentSettings>({
    providers: [],
    models: [],
    routing: {},
    security: {},
    agentExploreDefaults: {},
    ...overrides,
  } as AgentSettings);
}

describe("console agent explore state controller extra coverage", () => {
  it("bounds numeric defaults and normalizes tool choice from settings", () => {
    const settingsDraft = createSettings({
      agentExploreDefaults: {
        maxIterations: 99,
        limit: -3,
        temperature: 9,
        maxTokens: 64,
        toolChoice: "  required  ",
      },
    });
    const controller = createConsoleAgentExploreStateController({ settingsDraft });

    expect(controller.agentExploreConfiguredMaxIterations.value).toBe(8);
    expect(controller.agentExploreConfiguredLimit.value).toBe(1);
    expect(controller.agentExploreConfiguredTemperature.value).toBe(2);
    expect(controller.agentExploreConfiguredMaxTokens.value).toBe(128);
    expect(controller.agentExploreConfiguredToolChoice.value).toBe("required");

    expect(controller.boundedAgentExploreNumber("bad", 4, 1, 8)).toBe(4);
    expect(controller.boundedAgentExploreNumber(0, 4, 1, 8)).toBe(1);
    expect(controller.boundedAgentExploreNumber(99, 4, 1, 8)).toBe(8);
  });

  it("normalizes thinking modes and emits provider parameters only for explicit modes", () => {
    const settingsDraft = createSettings({
      agentExploreDefaults: {
        thinkingMode: "enabled",
      },
    });
    const controller = createConsoleAgentExploreStateController({ settingsDraft });

    expect(controller.normalizeAgentExploreThinkingMode("enabled")).toBe("enabled");
    expect(controller.normalizeAgentExploreThinkingMode("disabled")).toBe("disabled");
    expect(controller.normalizeAgentExploreThinkingMode("unknown")).toBe("default");
    expect(controller.selectedAgentExploreThinkingMode.value).toBe("default");

    controller.agentExploreForm.value.thinkingMode = "enabled";
    expect(controller.selectedAgentExploreThinkingMode.value).toBe("enabled");
    expect(controller.agentExploreThinkingParameters()).toEqual({ pact_thinking_mode: "enabled" });

    controller.agentExploreForm.value.thinkingMode = "disabled";
    expect(controller.selectedAgentExploreThinkingMode.value).toBe("disabled");
    expect(controller.agentExploreThinkingParameters()).toEqual({ pact_thinking_mode: "disabled" });

    controller.agentExploreForm.value.thinkingMode = "default";
    expect(controller.agentExploreThinkingParameters()).toEqual({});
  });

  it("selects context profiles with fallback and applies settings defaults once", () => {
    const settingsDraft = createSettings({
      agentExploreDefaults: {
        agentRetrievalModelAlias: "retrieval-model",
        contextProfileId: "context-1m",
        thinkingMode: "disabled",
        maxIterations: 3,
        limit: 12,
        temperature: 0.7,
        maxTokens: 4096,
        toolChoice: "auto",
      },
    });
    const controller = createConsoleAgentExploreStateController({ settingsDraft });

    expect(controller.selectedAgentExploreContextProfile.value).toMatchObject({
      value: "context-128k",
      label: "128K",
    });

    controller.applyAgentExploreDefaultsFromSettings();

    expect(controller.agentExploreForm.value).toMatchObject({
      modelAlias: "retrieval-model",
      contextProfileId: "context-1m",
      thinkingMode: "disabled",
      maxIterations: 3,
      limit: 12,
      temperature: 0.7,
      maxTokens: 4096,
      toolChoice: "auto",
    });
    expect(controller.selectedAgentExploreContextProfile.value).toMatchObject({
      value: "context-1m",
      label: "1M",
    });
    expect(controller.agentExploreDefaults()).toEqual({
      temperature: 0.7,
      maxTokens: 4096,
      maxIterations: 3,
      limit: 12,
      toolChoice: "auto",
    });

    controller.agentExploreForm.value.query = "keep me";
    settingsDraft.value.agentExploreDefaults = {
      ...settingsDraft.value.agentExploreDefaults,
      agentRetrievalModelAlias: "new-model",
      contextProfileId: "context-32k",
    };
    controller.applyAgentExploreDefaultsFromSettings();
    expect(controller.agentExploreForm.value.modelAlias).toBe("retrieval-model");
    expect(controller.agentExploreForm.value.contextProfileId).toBe("context-1m");
  });

  it("keeps mutable run, history, tab, hidden, and closed state isolated per controller", () => {
    const first = createConsoleAgentExploreStateController({ settingsDraft: createSettings() });
    const second = createConsoleAgentExploreStateController({ settingsDraft: createSettings() });

    first.agentExploreActiveTabId.value = "tab-1";
    first.agentExploreHiddenRunIds.value.add("run-hidden");
    first.agentExploreClosedTabIds.value.add("tab-closed");
    first.agentExploreHistory.value = [{ sessionId: "history-1" } as any];
    first.agentExploreDraftTabs.value = [{ sessionId: "draft-1" } as any];

    expect(first.agentExploreActiveTabId.value).toBe("tab-1");
    expect(first.agentExploreHiddenRunIds.value.has("run-hidden")).toBe(true);
    expect(first.agentExploreClosedTabIds.value.has("tab-closed")).toBe(true);
    expect(first.agentExploreHistory.value).toHaveLength(1);
    expect(first.agentExploreDraftTabs.value).toHaveLength(1);

    expect(second.agentExploreActiveTabId.value).toBe("");
    expect(second.agentExploreHiddenRunIds.value.size).toBe(0);
    expect(second.agentExploreClosedTabIds.value.size).toBe(0);
    expect(second.agentExploreHistory.value).toEqual([]);
    expect(second.agentExploreDraftTabs.value).toEqual([]);
  });
});
