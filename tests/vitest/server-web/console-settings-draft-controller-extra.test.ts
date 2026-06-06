import { describe, expect, it } from "vitest";
import { nextTick, ref } from "vue";
import {
  createConsoleSettingsDraftController,
  remoteDraftEquals,
} from "../../../server-web/composables/console-settings-draft-controller";
import { emptySettings } from "../../../server-web/composables/console-defaults";

function makeModel(provider: string, model: string, overrides: Record<string, unknown> = {}) {
  return {
    uid: `${provider}:${model}`,
    label: `${provider} ${model}`,
    provider,
    model,
    alias: `${provider}-${model}`,
    enabled: true,
    ...overrides,
  } as any;
}

function createFixture(initialSettings: any = {}) {
  const settingsDraft = ref<any>({
    ...emptySettings,
    ...initialSettings,
  });
  const settingsDraftDirty = ref(false);
  const normalizeModelEntry = (entry: any, index = 0) => ({
    uid: entry.uid || `model-${index}`,
    label: entry.label || entry.alias || entry.model || `Model ${index + 1}`,
    alias: entry.alias || entry.uid || `model-${index}`,
    provider: entry.provider || "custom-http",
    model: entry.model || "demo-model",
    enabled: entry.enabled !== false,
    parameters: entry.parameters || {},
  });
  const controller = createConsoleSettingsDraftController({
    modelEntryParameters: (entry: any) => ({
      temperature: Number(entry.parameters?.temperature ?? 0.2),
      topP: Number(entry.parameters?.topP ?? 1),
    }),
    modelRef: (provider: string, model: string) => `${provider}:${model}`,
    moduleModelAssignmentOptions: (moduleId: string) => {
      if (moduleId === "knowledgeTaxonomy") {
        return [{ ref: "openrouter:gpt-4.1-mini" }];
      }
      return [];
    },
    moduleNeedsIntelligence: (moduleId: string) => moduleId !== "agentTools",
    normalizeModelEntry,
    settingsDraft,
    settingsDraftDirty,
    visibleModelEntries: () => settingsDraft.value.modelLibraryAgents || [],
  });
  return {
    controller,
    settingsDraft,
    settingsDraftDirty,
  };
}

describe("console settings draft controller", () => {
  it("compares remote draft objects by stable JSON representation", () => {
    expect(remoteDraftEquals({ a: 1 }, { a: 1 })).toBe(true);
    expect(remoteDraftEquals({ a: 1 }, { a: "1" })).toBe(false);
    expect(remoteDraftEquals([1, 2], [1, 2])).toBe(true);
  });

  it("marks local edits dirty but not remote replacement", async () => {
    const { controller, settingsDraft, settingsDraftDirty } = createFixture();

    settingsDraft.value.customModelLabel = "Local edit";
    expect(settingsDraftDirty.value).toBe(true);

    controller.replaceSettingsDraftFromServer({
      customModelAlias: "remote-agent",
      customModelLabel: "Remote Agent",
      customHttpAdapter: {
        alias: "remote-agent",
        label: "Remote Adapter",
        url: "https://remote.example.test",
      },
    } as any);

    expect(controller.isApplyingRemoteSettings()).toBe(true);
    expect(settingsDraftDirty.value).toBe(false);
    expect(settingsDraft.value.customModelAlias).toBe("remote-agent");
    expect(settingsDraft.value.customHttpAdapter.alias).toBe("remote-agent");

    await nextTick();
    await Promise.resolve();
    expect(controller.isApplyingRemoteSettings()).toBe(false);

    settingsDraft.value.customModelLabel = "Another local edit";
    expect(settingsDraftDirty.value).toBe(true);
  });

  it("respects markClean=false and no-op replacement equality", () => {
    const { controller, settingsDraft, settingsDraftDirty } = createFixture();
    const normalized = controller.normalizedSettingsFromServer({
      customModelAlias: "same-agent",
      customModelLabel: "Same Agent",
    } as any);

    settingsDraft.value = normalized;
    settingsDraftDirty.value = true;

    controller.replaceSettingsDraftFromServer({
      customModelAlias: "same-agent",
      customModelLabel: "Same Agent",
    } as any, { markClean: false });

    expect(settingsDraftDirty.value).toBe(true);
    controller.replaceSettingsDraftFromServer({
      customModelAlias: "same-agent",
      customModelLabel: "Same Agent",
    } as any);
    expect(settingsDraftDirty.value).toBe(false);
  });

  it("normalizes http adapter settings and model library agents", () => {
    const { controller } = createFixture();
    const normalized = controller.normalizeHttpAdapterSettings({
      ...emptySettings,
      customModelAlias: "",
      customModelLabel: "自定义智能体",
      customHttpAdapter: {
        alias: "",
        label: "",
        url: "https://adapter.example.test",
      },
      customHttpAdapters: [
        { alias: "external-agent", url: "old" },
        { alias: "secondary", url: "https://secondary.example.test" },
      ],
      modelLibraryEntries: ["openrouter", "openrouter", ""],
      modelLibraryAgents: [
        makeModel("openrouter", "gpt-4.1-mini", { uid: "agent-a" }),
      ],
      agentPermissionGroups: [
        { id: "group-a", label: "Group A", scopes: ["knowledge:read"] },
      ],
      agentToolExecution: {
        http: { timeoutMs: 5000 },
        local: {
          commands: [
            {
              commandId: "cmd-a",
              command: "node",
              args: ["--version"],
            },
          ],
        },
      },
    } as any);

    expect(normalized.customModelAlias).toBe("自定义智能体");
    expect(normalized.customModelLabel).toBe("自定义智能体");
    expect(normalized.customHttpAdapter.alias).toBe("自定义智能体");
    expect(normalized.customHttpAdapters[0].alias).toBe("自定义智能体");
    expect(normalized.customHttpAdapters.map((item: any) => item.alias)).toContain("secondary");
    expect(normalized.modelLibraryAgents[0]).toMatchObject({
      provider: "openrouter",
      model: "gpt-4.1-mini",
    });
    expect(normalized.agentExploreDefaults.contextProfileId).toBe("context-128k");
    expect(normalized.agentToolExecution.http.timeoutMs).toBe(5000);
    expect(normalized.agentToolExecution.local.commands[0]).toMatchObject({
      commandId: "cmd-a",
      command: "node",
    });
  });

  it("builds save payload with visible model entries, filtered assignments and profile agents", () => {
    const visibleA = makeModel("openrouter", "gpt-4.1-mini", {
      uid: "agent-a",
      parameters: { temperature: 0.45, topP: 0.7 },
    });
    const visibleB = makeModel("custom-http", "custom-model", {
      uid: "agent-b",
      parameters: { temperature: 0.1 },
    });
    const { controller, settingsDraft } = createFixture({
      modelLibraryAgents: [visibleA, visibleB],
      moduleModelAssignments: {
        knowledgeTaxonomy: { provider: "openrouter", model: "gpt-4.1-mini" },
        graphInsight: { provider: "openrouter", model: "not-selectable" },
        agentTools: { provider: "openrouter", model: "gpt-4.1-mini" },
      },
      moduleAgentProfiles: {
        knowledgeTaxonomy: {
          primaryAgent: " agent-a ",
          agents: {
            " agent-a ": {
              enabled: true,
              role: "classifier",
              contextProfileId: "context-32k",
              systemPrompt: "Classify",
              parameters: { temperature: 0.2 },
              dependencyContext: { include: true },
              ignored: "drop",
            },
            " ": {
              enabled: true,
              role: "empty",
            },
          },
        },
        emptyModule: {
          primaryAgent: "",
          agents: {},
        },
      },
    });

    const payload = controller.settingsPayloadForSave();

    expect(payload.modelLibraryAgents).toHaveLength(2);
    expect(payload.modelLibraryAgents[0]).toMatchObject({
      uid: "agent-a",
      provider: "openrouter",
      model: "gpt-4.1-mini",
      parameters: {
        temperature: 0.45,
        topP: 0.7,
      },
    });
    expect(payload.modelLibraryEntries).toEqual(["openrouter", "custom-http"]);
    expect(payload.moduleModelAssignments).toEqual({
      knowledgeTaxonomy: { provider: "openrouter", model: "gpt-4.1-mini" },
    });
    expect(payload.moduleAgentProfiles).toEqual({
      knowledgeTaxonomy: {
        primaryAgent: "agent-a",
        agents: {
          "agent-a": {
            enabled: true,
            role: "classifier",
            contextProfileId: "context-32k",
            systemPrompt: "Classify",
            parameters: {},
            dependencyContext: {},
          },
        },
      },
    });

    settingsDraft.value.moduleAgentProfiles.knowledgeTaxonomy.agents[" agent-a "].role = "reviewer";
    expect(controller.moduleAgentProfilesPayload().knowledgeTaxonomy.agents["agent-a"].role).toBe("reviewer");
  });
});
