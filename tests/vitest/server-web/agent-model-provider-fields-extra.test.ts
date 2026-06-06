// @vitest-environment jsdom
import { defineComponent, h, nextTick, reactive, ref, type Ref } from "vue";
import { mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import AgentModelProviderFields from "../../../server-web/components/admin/agent-config/AgentModelProviderFields.vue";
import { provideAgentModelEntryCardContext } from "../../../server-web/composables/agentModelEntryCardContext";
import type { AgentModelConfig } from "../../../server-web/lib/types";

const mountedWrappers: VueWrapper[] = [];

const ConfigFoldCardStub = defineComponent({
  name: "ConfigFoldCard",
  props: {
    title: String,
    subtitle: String,
    open: Boolean,
  },
  setup(props, { slots }) {
    return () =>
      h(
        "section",
        {
          class: "config-fold-card-stub",
          "data-title": props.title || "",
          "data-subtitle": props.subtitle || "",
          "data-open": String(Boolean(props.open)),
        },
        [
          h("header", { class: "config-fold-card-stub__title" }, props.title || ""),
          slots.default?.(),
        ],
      );
  },
});

type ProviderFieldContext = {
  beginCodexOAuthLogin: ReturnType<typeof vi.fn>;
  busyKey: Ref<string>;
  codexOAuthStatus: Ref<{ valid?: boolean; email?: string; reason?: string } | null>;
  settingsDraft: {
    googleApiKey: string;
    openRouterBaseUrl: string;
    openRouterApiKey: string;
    copilotEndpoint: string;
    copilotApiKey: string;
    localModelEndpoint: string;
  };
};

function makeEntry(provider: string, overrides: Partial<AgentModelConfig> = {}): AgentModelConfig {
  return {
    uid: "model-1",
    instanceId: "model-1",
    provider,
    alias: "model-1",
    label: "Model One",
    model: "test-model",
    baseUrl: "",
    url: "",
    apiKey: "",
    apiKeyConfigured: false,
    token: "",
    tokenConfigured: false,
    tokenHeader: "token",
    tokenPrefix: "",
    pluginList: [],
    engine: "",
    systemPrompt: "",
    parameters: {},
    moduleAccess: { mode: "all", moduleIds: [] },
    permissionGroupId: "",
    timeoutMs: 120000,
    parametersText: "{}",
    ...overrides,
  };
}

function makeContext(overrides: Partial<ProviderFieldContext> = {}): ProviderFieldContext {
  return {
    beginCodexOAuthLogin: vi.fn(),
    busyKey: ref(""),
    codexOAuthStatus: ref(null),
    settingsDraft: reactive({
      googleApiKey: "",
      openRouterBaseUrl: "",
      openRouterApiKey: "",
      copilotEndpoint: "",
      copilotApiKey: "",
      localModelEndpoint: "",
    }),
    ...overrides,
  };
}

function mountProviderFields(
  provider: string,
  entryOverrides: Partial<AgentModelConfig> = {},
  contextOverrides: Partial<ProviderFieldContext> = {},
) {
  const entry = makeEntry(provider, entryOverrides);
  const context = makeContext(contextOverrides);

  const Host = defineComponent({
    name: "AgentModelProviderFieldsHost",
    setup() {
      provideAgentModelEntryCardContext(context as any);
      return () => h(AgentModelProviderFields, { entry });
    },
  });

  const wrapper = mount(Host, {
    attachTo: document.body,
    global: {
      stubs: {
        ConfigFoldCard: ConfigFoldCardStub,
      },
    },
  });

  mountedWrappers.push(wrapper);

  return {
    context,
    entry,
    wrapper,
  };
}

async function flush() {
  await nextTick();
  await Promise.resolve();
  await nextTick();
}

afterEach(() => {
  while (mountedWrappers.length) {
    mountedWrappers.pop()?.unmount();
  }
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("AgentModelProviderFields", () => {
  it("binds the Google API key field to the shared settings draft", async () => {
    const { context, wrapper } = mountProviderFields("google-gemini");

    const labels = wrapper.findAll("label");
    expect(labels).toHaveLength(1);
    expect(labels[0].text()).toContain("Google API Key");

    const input = wrapper.get('input[type="password"]');
    await input.setValue("google-secret");

    expect(context.settingsDraft.googleApiKey).toBe("google-secret");
  });

  it("renders the Codex OAuth status hint and login button state", async () => {
    const { context, wrapper } = mountProviderFields("openai-chatgpt", {}, {
      codexOAuthStatus: ref({ valid: false, reason: "需要连接 Codex OAuth。" }),
    });

    expect(wrapper.text()).toContain("需要连接 Codex OAuth。");
    const button = wrapper.get("button");
    expect(button.text()).toBe("连接 Codex");
    expect(button.attributes("disabled")).toBeUndefined();

    await button.trigger("click");
    expect(context.beginCodexOAuthLogin).toHaveBeenCalledTimes(1);

    context.codexOAuthStatus.value = { valid: true, email: "alice@example.com" };
    context.busyKey.value = "codex-oauth";
    await flush();

    expect(wrapper.text()).toContain("已连接 alice@example.com");
    expect(button.attributes("disabled")).toBeDefined();
    expect(button.text()).toBe("等待中");
  });

  it("renders openrouter, copilot, local-model, and deepseek fields with live v-model updates", async () => {
    const { context: openrouterContext, wrapper: openrouterWrapper } = mountProviderFields("openrouter");
    const openrouterInputs = openrouterWrapper.findAll("input");
    expect(openrouterInputs).toHaveLength(2);

    await openrouterInputs[0].setValue("https://router.example/v1");
    await openrouterInputs[1].setValue("router-key");
    expect(openrouterContext.settingsDraft.openRouterBaseUrl).toBe("https://router.example/v1");
    expect(openrouterContext.settingsDraft.openRouterApiKey).toBe("router-key");

    const { context: copilotContext, wrapper: copilotWrapper } = mountProviderFields("copilot");
    const copilotInputs = copilotWrapper.findAll("input");
    expect(copilotInputs).toHaveLength(2);

    await copilotInputs[0].setValue("https://copilot.example");
    await copilotInputs[1].setValue("copilot-token");
    expect(copilotContext.settingsDraft.copilotEndpoint).toBe("https://copilot.example");
    expect(copilotContext.settingsDraft.copilotApiKey).toBe("copilot-token");

    const { context: localContext, wrapper: localWrapper } = mountProviderFields("local-model");
    const localInputs = localWrapper.findAll("input");
    expect(localInputs).toHaveLength(1);

    await localInputs[0].setValue("http://localhost:8080");
    expect(localContext.settingsDraft.localModelEndpoint).toBe("http://localhost:8080");

    const { wrapper: deepseekWrapper, entry: deepseekEntry } = mountProviderFields("deepseek");
    const deepseekInputs = deepseekWrapper.findAll("input");
    expect(deepseekInputs).toHaveLength(3);

    await deepseekInputs[0].setValue("https://api.deepseek.test");
    await deepseekInputs[1].setValue("deepseek-key");
    await deepseekInputs[2].setValue("18000");

    expect(deepseekEntry.baseUrl).toBe("https://api.deepseek.test");
    expect(deepseekEntry.apiKey).toBe("deepseek-key");
    expect(deepseekEntry.timeoutMs).toBe(18000);
  });

  it("renders custom HTTP fields and the advanced fold card", async () => {
    const { wrapper, entry } = mountProviderFields("custom-http");

    expect(wrapper.text()).toContain("高级连接参数");
    const foldCard = wrapper.get(".config-fold-card-stub");
    expect(foldCard.attributes("data-title")).toBe("高级连接参数");

    const inputs = wrapper.findAll("input");
    expect(inputs).toHaveLength(5);

    await inputs[0].setValue("https://custom.example/api");
    await inputs[1].setValue("custom-token");
    await inputs[2].setValue("x-api-token");
    await inputs[3].setValue("Bearer");
    await inputs[4].setValue("24000");

    expect(entry.url).toBe("https://custom.example/api");
    expect(entry.token).toBe("custom-token");
    expect(entry.tokenHeader).toBe("x-api-token");
    expect(entry.tokenPrefix).toBe("Bearer");
    expect(entry.timeoutMs).toBe(24000);
  });

  it("renders no provider fields for unsupported providers", () => {
    const { wrapper } = mountProviderFields("unsupported-provider");

    expect(wrapper.findAll("input")).toHaveLength(0);
    expect(wrapper.findAll("button")).toHaveLength(0);
    expect(wrapper.findAll(".config-fold-card-stub")).toHaveLength(0);
    expect(wrapper.text()).toBe("");
  });
});
