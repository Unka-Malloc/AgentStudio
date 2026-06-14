// @vitest-environment jsdom
import { h, nextTick } from "vue";
import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ExternalServicesView from "../../../server-web/views/ExternalServicesView.vue";

const copyConsoleTextWithFeedback = vi.hoisted(() => vi.fn());

let activeController: Record<string, unknown> | null = null;

vi.mock("../../../server-web/composables/external-services-view-controller", () => ({
  useExternalServicesViewController: vi.fn(() => activeController),
}));

vi.mock("../../../server-web/composables/serverConsoleShellContext", () => ({
  useServerConsoleShellContext: vi.fn(() => ({})),
}));

vi.mock("../../../server-web/composables/console-browser-effects", () => ({
  copyConsoleTextWithFeedback: (...args: unknown[]) => copyConsoleTextWithFeedback(...args),
}));

const ConfigFloatingPanelMock = {
  name: "ConfigFloatingPanel",
  props: {
    open: { type: Boolean, required: true },
    title: { type: String, default: "" },
    subtitle: { type: String, default: "" },
    statusTone: { type: String, default: "" },
    statusLabel: { type: String, default: "" },
    verifying: { type: Boolean, default: false },
  },
  emits: ["close", "verify"],
  setup(props: Record<string, unknown>, context: {
    slots: { default?: () => any };
    emit: (event: "close" | "verify") => void;
  }) {
    if (!props.open) return () => null;
    return () =>
      h("section", { class: "mock-config-floating-panel" }, [
        h("header", { class: "mock-config-floating-header" }, [
          h("h3", String(props.title || "")),
          props.subtitle ? h("p", String(props.subtitle)) : null,
          h("button", { class: "mock-config-verify-button", onClick: () => context.emit("verify"), disabled: !!props.verifying }, props.verifying ? "校验中" : "校验配置"),
          h("button", { class: "mock-config-close-button", onClick: () => context.emit("close") }, "关闭"),
        ]),
        h("div", { class: "mock-config-floating-content" }, [
          h("div", { class: "mock-status", "data-tone": String(props.statusTone || ""), "data-label": String(props.statusLabel || "") }),
          context.slots.default?.(),
        ]),
      ]);
  },
};

const HelpTooltipMock = {
  name: "HelpTooltip",
  props: ["ariaLabel", "items", "text"],
  setup(props: Record<string, unknown>) {
    return () => h("span", { class: "mock-help-tooltip", "aria-label": String(props.ariaLabel || "") }, String(props.text || ""));
  },
};

const StatusPillMock = {
  name: "StatusPill",
  props: ["tone", "label"],
  setup(props: Record<string, unknown>) {
    return () =>
      h("span", { class: "mock-status-pill", "data-tone": String(props.tone || "") }, String(props.label || ""));
  },
};

const BinaryCheckboxMock = {
  name: "BinaryCheckbox",
  props: ["modelValue", "label", "disabled"],
  emits: ["update:model-value", "update:modelValue", "change"],
  setup(props: Record<string, unknown>, context: { emit: (event: string, value: unknown) => void }) {
    return () =>
      h(
        "button",
        {
          class: "mock-binary-checkbox",
          type: "button",
          disabled: !!props.disabled,
          onClick: () => {
            if (props.disabled) return;
            const nextValue = !(props.modelValue as boolean);
            context.emit("update:model-value", nextValue);
            context.emit("update:modelValue", nextValue);
            context.emit("change", nextValue);
          },
        },
        String(props.label || ""),
      );
  },
};

type ServiceFixture = {
  entryId: string;
  serviceId: string;
  serviceName: string;
  displayName: string;
  description: string;
  mode: string;
  startupPolicy: string;
  source: string;
  sourceLabel: string;
  filePath: string;
  requiredOperations: string[];
  scriptCount: number;
  validationStatus: "valid" | "invalid";
  validation: { ok: boolean; errors: string[]; warnings: string[] };
  externalMcp?: { tools: Array<string | { name?: string; toolId?: string; id?: string }> };
  upstreamTargetLabelText: string;
  upstreamTargetDetailText: string;
  sourceLabelText: string;
  discoveryLabelText: string;
  discoveryTone: string;
  discoveryRegistrationLabelText: string;
  discoveryRegistrationTone: string;
  heartbeatText: string;
  heartbeatRefreshing: boolean;
};

function createService(override: Partial<ServiceFixture> = {}): ServiceFixture {
  const serviceId = override.serviceId || "service-id";
  const sourceLabel = override.sourceLabel || "本地配置";
  return {
    entryId: override.entryId || serviceId,
    serviceId,
    serviceName: override.serviceName || serviceId,
    displayName: override.displayName || serviceId,
    description: override.description || "",
    mode: override.mode || "connected",
    startupPolicy: override.startupPolicy || "external-only",
    source: override.source || "configured",
    sourceLabel,
    filePath: override.filePath || "/tmp/pact/external-services.json",
    requiredOperations: override.requiredOperations || ["knowledge.search"],
    scriptCount: override.scriptCount ?? 1,
    validationStatus: override.validationStatus || "valid",
    validation: override.validation || { ok: true, errors: [], warnings: [] },
    externalMcp: override.externalMcp || null,
    upstreamTargetLabelText: override.upstreamTargetLabelText || "127.0.0.1:8787",
    upstreamTargetDetailText: override.upstreamTargetDetailText || "endpoint",
    sourceLabelText: override.sourceLabelText || `${sourceLabel} / ${serviceId}`,
    discoveryLabelText: override.discoveryLabelText || "MCP 服务",
    discoveryTone: override.discoveryTone || "success",
    discoveryRegistrationLabelText: override.discoveryRegistrationLabelText || "工具已发现",
    discoveryRegistrationTone: override.discoveryRegistrationTone || "success",
    heartbeatText: override.heartbeatText || "Latest: -",
    heartbeatRefreshing: override.heartbeatRefreshing || false,
  };
}

function createController(overrides: Record<string, unknown> = {}) {
  const servicesOverride = overrides.services as ServiceFixture[] | undefined;
  const services = servicesOverride || [
    createService({
      serviceId: "service-a",
      displayName: "",
      serviceName: "fallback-service",
      externalMcp: {
        tools: ["search", { toolId: "tool-id" }, { id: "tool-id-2" }],
      },
    }),
  ];

  return {
    configuredCount: (overrides.configuredCount as number) ?? services.filter((service) => service.source === "configured").length,
    presetCount: (overrides.presetCount as number) ?? services.filter((service) => service.source === "preset").length,
    validServiceCount: (overrides.validServiceCount as number) ?? services.filter((service) => service.validationStatus === "valid").length,
    discoveredServiceCount: (overrides.discoveredServiceCount as number) ?? services.length,
    mcpToolCount: (overrides.mcpToolCount as number) ?? services.reduce((total, service) => total + (service.externalMcp?.tools?.length || 0), 0),
    configEditorOpen: overrides.configEditorOpen ?? false,
    configEditorMode: overrides.configEditorMode || "add",
    configEditorTitle: overrides.configEditorTitle || "添加服务",
    configEditorSubtitle: overrides.configEditorSubtitle || "填写服务身份、上游 endpoint 和 Pact 暴露方式。",
    configStatusTone: overrides.configStatusTone || "success",
    configStatusLabel: overrides.configStatusLabel || "Valid",
    loadError: overrides.loadError || "",
    actionError: overrides.actionError || "",
    actionMessage: overrides.actionMessage || "",
    discoveryCacheUpdatedAtLabel: overrides.discoveryCacheUpdatedAtLabel || "2026-06-04 11:30",
    configText: overrides.configText || "{\n  \"serviceId\": \"\"\n}",
    configDraft: overrides.configDraft || {
      serviceId: "service-a",
      serviceName: "Service A",
      mode: "connected",
      startupPolicy: "external-only",
      description: "",
      scripts: {},
      upstream: {
        type: "cloud-drive",
        transport: "streamable-http",
        provider: "icloud",
        mode: "remote-live",
        url: "http://127.0.0.1:8787/cloud-drive/",
        endpointUrl: "",
        timeoutMs: 60000,
        secretRef: "secret://pact/drive/icloud",
        endpointRef: "config://pact/drive/provider-endpoint",
        rootPath: "/Users/name/Library/Mobile Documents/com~apple~CloudDocs",
        metadata: {},
      },
      binding: {
        mode: "passthrough",
        outlet: "pact.skillHub",
        requiredScopes: ["knowledge:read"],
        risk: "read_only",
        metadata: {},
      },
      healthCheck: {
        type: "http",
        host: "127.0.0.1",
        port: 8787,
        timeoutMs: 60000,
        url: "http://127.0.0.1:8787/health",
        required: false,
      },
    },
    requiredScopesText: overrides.requiredScopesText || "knowledge:read",
    validationErrors: overrides.validationErrors || ["字段校验失败"],
    validationWarnings: overrides.validationWarnings || ["存在风险项"],
    loading: overrides.loading || false,
    saving: overrides.saving || false,
    verifying: overrides.verifying || false,
    dirty: overrides.dirty || false,
    services,
    modeOptions: [
      { value: "connected", label: "connected" },
      { value: "managed", label: "managed" },
    ],
    startupPolicyOptions: [{ value: "external-only", label: "external-only" }],
    upstreamTypeOptions: [
      { value: "MCP 服务", label: "MCP 服务" },
      { value: "LLM Service", label: "LLM Service" },
      { value: "Cloud Drive Service", label: "Cloud Drive Service" },
      { value: "HTTP / HTTPS 服务", label: "HTTP / HTTPS 服务" },
      { value: "其它服务", label: "其它服务" },
    ],
    mcpTransportOptions: [{ value: "streamable-http", label: "streamable-http" }],
	    modelProtocolOptions: [
	      { value: "openai-compatible", label: "OpenAI Compatible" },
	      { value: "openai-responses", label: "OpenAI Responses" },
	    ],
    modelProtocolSelectValue: overrides.modelProtocolSelectValue || "openai-compatible",
    cloudDriveModeOptions: [{ value: "contract", label: "contract" }],
    cloudDriveProviderOptions: [
      { value: "icloud", label: "iCloud Drive" },
      { value: "onedrive", label: "OneDrive" },
    ],
    bindingModeOptions: [{ value: "passthrough", label: "passthrough" }],
    bindingOutletOptions: [{ value: "pact.skillHub", label: "pact.skillHub" }],
    healthCheckTypeOptions: [{ value: "none", label: "none" }],
    riskOptions: [{ value: "read_only", label: "read_only" }],
    isCloudDriveServiceDraft: overrides.isCloudDriveServiceDraft || false,
    isHttpJsonServiceDraft: overrides.isHttpJsonServiceDraft || false,
    isJsonRpcServiceDraft: overrides.isJsonRpcServiceDraft || false,
    isLlmServiceDraft: overrides.isLlmServiceDraft || false,
    isMcpServiceDraft: overrides.isMcpServiceDraft ?? false,
    isSseServiceDraft: overrides.isSseServiceDraft || false,
    showToolMappingFields: overrides.showToolMappingFields || false,
    showMcpTransportField: overrides.showMcpTransportField ?? false,
    showCustomUpstreamType: overrides.showCustomUpstreamType || false,
    endpointFieldLabel: overrides.endpointFieldLabel || "Endpoint URL",
    endpointFieldPlaceholder: overrides.endpointFieldPlaceholder || "https://mcp.example.com:443/mcp/",
    endpointFieldValue: overrides.endpointFieldValue || "",
    minimumFieldLabels: overrides.minimumFieldLabels || [],
    requiredFieldGroupSummaries: overrides.requiredFieldGroupSummaries || [],
    optionalFieldGroupSummaries: overrides.optionalFieldGroupSummaries || [],
    defaultedFieldLabels: overrides.defaultedFieldLabels || [],
    advancedOptionalFieldRows: overrides.advancedOptionalFieldRows || [],
    currentTemplateLabel: overrides.currentTemplateLabel || "Raw MCP Streamable HTTP",
    httpMethodOptions: overrides.httpMethodOptions || ["GET", "POST", "PUT", "PATCH", "DELETE"],
    primaryToolName: overrides.primaryToolName || "",
    primaryHttpMethod: overrides.primaryHttpMethod || "GET",
    primaryHttpPath: overrides.primaryHttpPath || "/",
    primaryRpcMethod: overrides.primaryRpcMethod || "",
    upstreamAuthType: overrides.upstreamAuthType || "none",
    upstreamAuthHeaderName: overrides.upstreamAuthHeaderName || "",
    upstreamAuthSecretRef: overrides.upstreamAuthSecretRef || "",
    upstreamTypeSelectValue: overrides.upstreamTypeSelectValue || "Cloud Drive Service",
    customUpstreamTypeValue: overrides.customUpstreamTypeValue || "",
    activeConfigSummary: overrides.activeConfigSummary || {},
    openAddServiceConfig: vi.fn(),
    openEditServiceConfig: vi.fn(),
    closeConfigEditor: vi.fn(),
    refreshExternalServices: vi.fn().mockResolvedValue(undefined),
    verifyConfig: vi.fn().mockResolvedValue(undefined),
    saveConfig: vi.fn().mockResolvedValue(undefined),
    refreshRuntime: vi.fn().mockResolvedValue(undefined),
    updateRootField: vi.fn(),
    updateUpstreamTypeSelection: vi.fn(),
    updateCustomUpstreamType: vi.fn(),
    updateModelProtocol: vi.fn(),
    updateModelProvider: vi.fn(),
    updatePrimaryToolField: vi.fn(),
    updateAdvancedOptionalField: vi.fn(),
    updateUpstreamAuthField: vi.fn(),
    updateCloudDriveProvider: vi.fn(),
    updateCloudDriveMode: vi.fn(),
    updateBindingField: vi.fn(),
    updateRequiredScopes: vi.fn(),
    updateUpstreamField: vi.fn(),
    updateHealthCheckField: vi.fn(),
    updateHealthCheckRequired: vi.fn(),
    onConfigInput: vi.fn(),
    serviceSourceDetail: (service: ServiceFixture) => service.sourceLabelText,
    upstreamTargetLabel: (service: ServiceFixture) => service.upstreamTargetLabelText,
    upstreamTargetDetailLabel: (service: ServiceFixture) => service.upstreamTargetDetailText,
    serviceDiscoveryLabel: (service: ServiceFixture) => service.discoveryLabelText,
    serviceDiscoveryTone: (service: ServiceFixture) => service.discoveryTone,
    serviceDiscoveryRegistrationLabel: (service: ServiceFixture) => service.discoveryRegistrationLabelText,
    serviceDiscoveryRegistrationTone: (service: ServiceFixture) => service.discoveryRegistrationTone,
    serviceHeartbeatLastAtLabel: (service: ServiceFixture) => service.heartbeatText,
    isServiceHeartbeatRefreshing: (service: ServiceFixture) => service.heartbeatRefreshing,
    serviceActiveToolCount: (service: ServiceFixture) => service.externalMcp?.tools?.length || 0,
    serviceCandidateToolCount: (service: ServiceFixture) => Number((service.externalMcp as any)?.candidateToolCount || 0),
    serviceToolAdoptionLabel: (service: ServiceFixture) =>
      Number((service.externalMcp as any)?.candidateToolCount || 0) > 0 ? "候选待采纳" : "工具已采纳",
    serviceActiveToolReviewRows: (service: ServiceFixture) =>
      (service.externalMcp?.tools || []).map((tool: any) => ({
        name: typeof tool === "string" ? tool : tool.toolId || tool.id || tool.name || "",
        title: typeof tool === "string" ? tool : tool.title || tool.toolId || tool.id || tool.name || "",
        descriptionPreview: "",
        inputSchema: null,
        transport: {},
      })),
    serviceCandidateToolReviewRows: () => [],
    serviceCandidateToolFingerprintMap: () => ({}),
    isServiceToolAdopting: () => false,
    adoptCandidateTools: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function mountView(overrides: Record<string, unknown> = {}) {
  activeController = createController(overrides);
  return {
    controller: activeController,
    wrapper: mount(ExternalServicesView, {
      global: {
        stubs: {
          ConfigFloatingPanel: ConfigFloatingPanelMock,
          HelpTooltip: HelpTooltipMock,
          StatusPill: StatusPillMock,
          BinaryCheckbox: BinaryCheckboxMock,
        },
      },
    }),
  };
}

function setMockRect(element: Element, rect: Omit<DOMRect, "toJSON">) {
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => rect,
  });
}

beforeEach(() => {
  activeController = null;
  copyConsoleTextWithFeedback.mockReset();
});

afterEach(() => {
  activeController = null;
});

describe("ExternalServicesView", () => {
  it("renders the conditional editor fields and forwards the interactive updates", async () => {
    const { wrapper, controller } = mountView({
      configEditorOpen: true,
      configEditorMode: "edit",
      isCloudDriveServiceDraft: true,
      isLlmServiceDraft: true,
      showCustomUpstreamType: true,
    });

    expect(wrapper.text()).toContain("字段校验失败");
    expect(wrapper.text()).toContain("存在风险项");
    expect(wrapper.text()).toContain("自定义类型");
    expect(wrapper.text()).toContain("模型协议");
    expect(wrapper.text()).toContain("Provider");
    expect(wrapper.text()).toContain("网盘 Provider");
    expect(wrapper.text()).toContain("适配模式");
    expect(wrapper.text()).toContain("Secret Ref");
    expect(wrapper.text()).toContain("Endpoint Ref");
    expect(wrapper.text()).toContain("iCloud Root Path");
    expect(wrapper.text()).toContain("Endpoint URL");

    const serviceIdInput = wrapper.get('input[autocomplete="off"][value="service-a"]');
    expect(serviceIdInput.attributes("disabled")).toBeDefined();

    await wrapper.get('select[aria-label="运行模式"]').setValue("managed");
    expect(controller.updateRootField).toHaveBeenCalledWith("mode", "managed");

    await wrapper.get('select[aria-label="模型协议"]').setValue("openai-responses");
    expect(controller.updateModelProtocol).toHaveBeenCalledWith("openai-responses");

    await wrapper.get('select[aria-label="网盘 Provider"]').setValue("onedrive");
    expect(controller.updateCloudDriveProvider).toHaveBeenCalledWith("onedrive");

    await wrapper.get('select[aria-label="网盘适配模式"]').setValue("contract");
    expect(controller.updateCloudDriveMode).toHaveBeenCalledWith("contract");

    await wrapper.get('input[placeholder="internal-proprietary-service"]').setValue("internal-service");
    expect(controller.updateCustomUpstreamType).toHaveBeenCalledWith("internal-service");

    await wrapper.get('input[placeholder="secret://pact/drive/onedrive-oauth"]').setValue("secret://custom");
    expect(controller.updateUpstreamField).toHaveBeenCalledWith("secretRef", "secret://custom");

    await wrapper.get('.external-service-config-editor').setValue('{"serviceId":"service-a"}');
    expect(controller.onConfigInput).toHaveBeenCalledWith('{"serviceId":"service-a"}');

    await wrapper.get(".mock-binary-checkbox").trigger("click");
    expect(controller.updateHealthCheckRequired).toHaveBeenCalledWith(true);
  });

  it("falls back to serviceName for the popover title and ignores inside button pointerdowns", async () => {
    const { wrapper } = mountView({
      services: [
        createService({
          serviceId: "fallback-service",
          displayName: "",
          serviceName: "fallback-service",
          externalMcp: {
            tools: ["search", { toolId: "status" }, { id: "query" }],
          },
        }),
      ],
    });

    const originalInnerHeight = window.innerHeight;
    const originalInnerWidth = window.innerWidth;
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      writable: true,
      value: 500,
    });
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 800,
    });

    const toolButton = wrapper.get(".external-service-tool-list-button");
    setMockRect(toolButton.element, {
      x: 40,
      y: 320,
      left: 40,
      right: 140,
      top: 320,
      bottom: 360,
      width: 100,
      height: 40,
      toJSON: () => ({}),
    });

    await toolButton.trigger("click");
    const popover = wrapper.get(".external-service-tool-popover");
    expect(popover.classes()).toContain("is-above");
    expect(popover.text()).toContain("fallback-service");
    expect(popover.text()).toContain("search");
    expect(popover.text()).toContain("status");
    expect(popover.text()).toContain("query");

    toolButton.element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(wrapper.find(".external-service-tool-popover").exists()).toBe(true);

    await toolButton.trigger("click");
    expect(wrapper.find(".external-service-tool-popover").exists()).toBe(false);

    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      writable: true,
      value: originalInnerHeight,
    });
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: originalInnerWidth,
    });
  });

  it("observes the service table on mount and disconnects the resize observer on unmount", async () => {
    const observed: Element[] = [];
    let disconnected = false;
    const previousResizeObserver = globalThis.ResizeObserver;

    class FakeResizeObserver {
      constructor(_callback: ResizeObserverCallback) {}

      observe(target: Element) {
        observed.push(target);
      }

      disconnect() {
        disconnected = true;
      }
    }

    globalThis.ResizeObserver = FakeResizeObserver as any;

    try {
      const { wrapper } = mountView({
        services: [createService({ serviceId: "observer-service", externalMcp: { tools: ["search"] } })],
      });

      await nextTick();
      await nextTick();

      expect(observed.length).toBeGreaterThan(0);
      expect(observed.some((element) => element.classList.contains("external-service-table-scroll"))).toBe(true);
      expect(observed.some((element) => element.classList.contains("external-service-table"))).toBe(true);

      wrapper.unmount();
      expect(disconnected).toBe(true);
    } finally {
      globalThis.ResizeObserver = previousResizeObserver;
    }
  });
});
