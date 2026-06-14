// @vitest-environment jsdom
import { h, nextTick, type Ref } from "vue";
import { mount } from "@vue/test-utils";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
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
      h("span", { class: "mock-status-pill", "data-tone": String(props.tone || ""), }, String(props.label || ""));
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

function serviceToolNames(service: ServiceFixture) {
  return [...new Set((service.externalMcp?.tools || []).map((tool) => {
    if (typeof tool === "string") return tool.trim();
    if (tool && typeof tool === "object") {
      return String(tool.name || tool.toolId || tool.id || "").trim();
    }
    return "";
  }).filter(Boolean))];
}

function createController(overrides: Record<string, unknown> = {}) {
  const normalizedOverrides = { ...overrides };
  const servicesOverride = normalizedOverrides.services as ServiceFixture[] | undefined;
  delete normalizedOverrides.services;

  const services = servicesOverride || [
    createService({
      serviceId: "mcp-docs",
      discoveryLabelText: "MCP 服务",
      discoveryTone: "success",
      discoveryRegistrationLabelText: "工具已发现",
      externalMcp: {
        tools: ["search", { name: "search" }, { toolId: "file.list" }, { id: "file.list" }, "status"],
      },
    }),
    createService({
      serviceId: "llm-openai",
      discoveryLabelText: "LLM Service",
      discoveryTone: "warning",
      discoveryRegistrationLabelText: "模型已注册",
      externalMcp: {
        tools: ["chat", "chat"],
      },
    }),
    createService({
      serviceId: "cloud-drive",
      discoveryLabelText: "Cloud Drive Service",
      discoveryTone: "success",
      discoveryRegistrationLabelText: "网盘已注册",
      externalMcp: {
        tools: [],
      },
      source: "preset",
      sourceLabel: "预设",
      sourceLabelText: "预设 / cloud-drive",
      upstreamTargetLabelText: "/Users/name/Library/Mobile Documents",
      upstreamTargetDetailText: "local path",
    }),
    createService({
      serviceId: "http-gateway",
      discoveryLabelText: "HTTP / HTTPS 服务",
      discoveryTone: "info",
      discoveryRegistrationLabelText: "端点已注册",
      externalMcp: {
        tools: ["proxy", "proxy"],
      },
    }),
  ];

  const computed = {
    configuredCount: services.filter((service) => service.source === "configured").length,
    presetCount: services.filter((service) => service.source === "preset").length,
    validServiceCount: services.filter((service) => service.validationStatus === "valid").length,
    discoveredServiceCount: services.length,
    mcpToolCount: services.reduce((total, service) => total + (service.externalMcp?.tools?.length || 0), 0),
  };

  return {
    ...computed,
    configuredCount: (overrides.configuredCount as number) ?? computed.configuredCount,
    presetCount: (overrides.presetCount as number) ?? computed.presetCount,
    validServiceCount: (overrides.validServiceCount as number) ?? computed.validServiceCount,
    discoveredServiceCount: (overrides.discoveredServiceCount as number) ?? computed.discoveredServiceCount,
    mcpToolCount: (overrides.mcpToolCount as number) ?? computed.mcpToolCount,
    configEditorOpen: overrides.configEditorOpen ?? false,
    configEditorMode: overrides.configEditorMode || "add",
    configEditorTitle: overrides.configEditorTitle || (overrides.configEditorMode === "edit" ? "修改配置：服务" : "添加服务"),
    configEditorSubtitle: overrides.configEditorSubtitle || "填写服务身份、上游 endpoint 和 Pact 暴露方式。",
    configStatusTone: overrides.configStatusTone || "success",
    configStatusLabel: overrides.configStatusLabel || "Valid",
    loadError: overrides.loadError || "",
    actionError: overrides.actionError || "",
    actionMessage: overrides.actionMessage || "",
    discoveryCacheUpdatedAtLabel: overrides.discoveryCacheUpdatedAtLabel || "2026-06-04 11:30",
    configText: overrides.configText || `{\n  "serviceId": ""\n}`,
    configDraft: overrides.configDraft || {
      serviceId: "",
      serviceName: "",
      mode: "connected",
      startupPolicy: "external-only",
      description: "",
      scripts: {},
      upstream: {
        type: "mcp",
        transport: "streamable-http",
        url: "",
        timeoutMs: null,
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
        type: "none",
        url: "",
        host: "127.0.0.1",
        port: null,
        path: "/",
        timeoutMs: 60000,
        required: false,
      },
      metadata: {},
    },
    requiredScopesText: overrides.requiredScopesText || "knowledge:read",
    validationErrors: overrides.validationErrors || [],
    validationWarnings: overrides.validationWarnings || [],
    loading: overrides.loading || false,
    saving: overrides.saving || false,
    verifying: overrides.verifying || false,
    dirty: overrides.dirty || false,
    services,
    modeOptions: [{ value: "connected", label: "connected" }],
    startupPolicyOptions: [{ value: "external-only", label: "external-only" }],
    upstreamTypeOptions: [
      { value: "mcp", label: "MCP 服务" },
      { value: "llm", label: "LLM Service" },
      { value: "cloud-drive", label: "Cloud Drive Service" },
      { value: "http", label: "HTTP / HTTPS 服务" },
      { value: "other", label: "其它服务" },
    ],
    mcpTransportOptions: [{ value: "streamable-http", label: "streamable-http" }],
    modelProtocolOptions: [{ value: "openai-compatible", label: "OpenAI Compatible" }],
    modelProtocolSelectValue: overrides.modelProtocolSelectValue || "openai-compatible",
    cloudDriveModeOptions: [{ value: "contract", label: "contract" }],
    cloudDriveProviderOptions: [{ value: "icloud", label: "iCloud Drive" }],
    bindingModeOptions: [{ value: "passthrough", label: "passthrough" }],
    bindingOutletOptions: [{ value: "pact.skillHub", label: "pact.skillHub" }],
    healthCheckTypeOptions: [{ value: "none", label: "none" }],
    riskOptions: [{ value: "read_only", label: "read_only" }],
    isCloudDriveServiceDraft: overrides.isCloudDriveServiceDraft || false,
    isHttpJsonServiceDraft: overrides.isHttpJsonServiceDraft || false,
    isJsonRpcServiceDraft: overrides.isJsonRpcServiceDraft || false,
    isLlmServiceDraft: overrides.isLlmServiceDraft || false,
    isMcpServiceDraft: overrides.isMcpServiceDraft ?? true,
    isSseServiceDraft: overrides.isSseServiceDraft || false,
    showToolMappingFields: overrides.showToolMappingFields || false,
    showMcpTransportField: overrides.showMcpTransportField ?? true,
    showCustomUpstreamType: overrides.showCustomUpstreamType || false,
    endpointFieldLabel: overrides.endpointFieldLabel || "Endpoint URL",
    endpointFieldPlaceholder: overrides.endpointFieldPlaceholder || "https://mcp.example.com:443/mcp/",
    endpointFieldValue: overrides.endpointFieldValue || "",
    minimumFieldLabels: overrides.minimumFieldLabels || [],
    requiredFieldGroupSummaries: overrides.requiredFieldGroupSummaries || [],
    optionalFieldGroupSummaries: overrides.optionalFieldGroupSummaries || [],
    defaultedFieldLabels: overrides.defaultedFieldLabels || [],
    currentTemplateLabel: overrides.currentTemplateLabel || "Raw MCP Streamable HTTP",
    upstreamTypeSelectValue: overrides.upstreamTypeSelectValue || "mcp",
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
    serviceActiveToolCount: (service: ServiceFixture) => serviceToolNames(service).length,
    serviceCandidateToolCount: (service: ServiceFixture) => Number((service.externalMcp as any)?.candidateToolCount || 0),
    serviceToolAdoptionLabel: (service: ServiceFixture) =>
      Number((service.externalMcp as any)?.candidateToolCount || 0) > 0 ? "候选待采纳" : "工具已采纳",
    serviceActiveToolReviewRows: (service: ServiceFixture) =>
      serviceToolNames(service).map((name) => ({
        name,
        title: name,
        descriptionPreview: "",
        inputSchema: null,
        transport: {},
      })),
    serviceCandidateToolReviewRows: () => [],
    serviceCandidateToolFingerprintMap: () => ({}),
    isServiceToolAdopting: () => false,
    adoptCandidateTools: vi.fn().mockResolvedValue(undefined),
    ...normalizedOverrides,
  };
}

function mountView(overrides: Record<string, unknown> = {}) {
  const services = (overrides.services as ServiceFixture[] | undefined) || undefined;
  activeController = createController({
    ...overrides,
    services,
  });
  const controller = activeController;
  return {
    controller,
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

function findActionButton(wrapper: any, row: ReturnType<typeof wrapper.find>, label: string) {
  return row.findAll("button").find((button: any) => button.text() === label);
}

function setMockRect(element: Element, rect: Omit<DOMRect, "toJSON">) {
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => rect,
  });
}

afterEach(() => {
  copyConsoleTextWithFeedback.mockReset();
  activeController = null;
});

describe("ExternalServicesView", () => {
  it("renders stats and mixed service type tags in list", () => {
    const { wrapper, controller } = mountView();
    const cards = wrapper.findAll(".external-services-summary-item strong");
    expect(cards[0].text()).toBe(String(controller.configuredCount));
    expect(cards[1].text()).toBe(String(controller.discoveredServiceCount));
    expect(cards[2].text()).toBe(String(controller.mcpToolCount));
    expect(cards[3].text()).toBe(String(controller.validServiceCount));

    const list = wrapper.findAll(".external-service-table-row");
    expect(list).toHaveLength(4);
    expect(wrapper.text()).toContain("MCP 服务");
    expect(wrapper.text()).toContain("LLM Service");
    expect(wrapper.text()).toContain("Cloud Drive Service");
    expect(wrapper.text()).toContain("HTTP / HTTPS 服务");

    const toolListButtons = wrapper.findAll(".external-service-tool-list-button");
    expect(toolListButtons).toHaveLength(3);
    expect(wrapper.findAll("button").filter((button: any) => button.text() === "修改配置").length).toBe(4);
  });

  it("supports row edit / refresh actions and tool list popover", async () => {
    const { wrapper, controller } = mountView({
      services: [
        createService({
          serviceId: "mcp-main",
          discoveryLabelText: "MCP 服务",
          externalMcp: { tools: ["search", "search", { name: "status" }] },
        }),
      ],
    });

    const row = wrapper.find(".external-service-table-row");
    await findActionButton(wrapper, row, "修改配置")?.trigger("click");
    expect(controller.openEditServiceConfig).toHaveBeenCalledTimes(1);
    expect(controller.openEditServiceConfig).toHaveBeenCalledWith(
      expect.objectContaining({ serviceId: "mcp-main" }),
    );

    await findActionButton(wrapper, row, "服务探测")?.trigger("click");
    expect(controller.refreshRuntime).toHaveBeenCalledWith("mcp-main");

    const listRefresh = wrapper.findAll("button").find((button: any) => button.text() === "刷新列表");
    expect(listRefresh).toBeDefined();
    await listRefresh.trigger("click");
    expect(controller.refreshExternalServices).toHaveBeenCalledTimes(1);

    const toolListButton = row.find(".external-service-tool-list-button");
    await toolListButton.trigger("click");
    const popover = wrapper.find(".external-service-tool-popover");
    expect(popover.exists()).toBe(true);
    expect(popover.text()).toContain("工具审查");
    expect(popover.text()).toContain("search");
    expect(popover.text()).toContain("status");

    const toolItems = popover.findAll(".external-service-tool-item");
    expect(toolItems).toHaveLength(2);
    await popover.find(".external-service-tool-popover-close").trigger("click");
    expect(wrapper.find(".external-service-tool-popover").exists()).toBe(false);
  });

  it("covers loading state and error alerts", async () => {
    const { wrapper, controller } = mountView({
      loading: true,
      loadError: "加载列表失败",
      actionError: "保存失败",
      actionMessage: "处理完成",
      services: [
        createService({
          serviceId: "refreshing-service",
          heartbeatRefreshing: true,
          externalMcp: { tools: [] },
        }),
      ],
    });

    const refreshButton = wrapper
      .findAll(".external-service-actions button")
      .find((button: any) => button.text().includes("刷新"));
    expect(refreshButton?.attributes("disabled")).toBeDefined();
    expect(refreshButton?.text()).toBe("刷新中");
    expect(wrapper.text()).toContain("加载列表失败");
    expect(wrapper.text()).toContain("保存失败");
    expect(wrapper.text()).toContain("处理完成");

    const row = wrapper.find(".external-service-table-row");
    const runtimeButton = findActionButton(wrapper, row, "探测中");
    expect(runtimeButton?.attributes("disabled")).toBeDefined();
  });

  it("renders empty state when no service entries are loaded", () => {
    const { wrapper } = mountView({ services: [] });
    expect(wrapper.find(".empty-state").exists()).toBe(true);
    expect(wrapper.find(".empty-state").text()).toContain("暂无外部服务");
    expect(wrapper.findAll(".external-service-table-row")).toHaveLength(0);
  });

  it("handles config editor verify/save/cancel actions", async () => {
    const { wrapper, controller } = mountView({
      configEditorOpen: true,
      validationErrors: ["字段校验失败"],
      validationWarnings: ["存在风险项"],
      verifying: false,
    });

    const panel = wrapper.find(".mock-config-floating-panel");
    expect(panel.exists()).toBe(true);
    expect(panel.text()).toContain("字段校验失败");
    expect(panel.text()).toContain("存在风险项");

    await panel.find(".mock-config-verify-button").trigger("click");
    expect(controller.verifyConfig).toHaveBeenCalledTimes(1);

    await panel.findAll("button").find((button: any) => button.text() === "取消")?.trigger("click");
    expect(controller.closeConfigEditor).toHaveBeenCalledTimes(1);
    const form = panel.find("form");
    expect(form.exists()).toBe(true);
    await form.trigger("submit");
    expect(controller.saveConfig).toHaveBeenCalledTimes(1);
  });

  it("copies upstream target when clicking copy button", async () => {
    const { wrapper } = mountView();
    copyConsoleTextWithFeedback.mockResolvedValue(true);
    const copyButton = wrapper.find(".external-service-upstream-copy");
    await copyButton.trigger("mouseenter");
    expect(wrapper.find(".external-service-upstream-bubble").exists()).toBe(true);
    await copyButton.trigger("click");
    expect(copyConsoleTextWithFeedback).toHaveBeenCalledWith(
      expect.any(Object),
      "127.0.0.1:8787",
      { message: "已复制" },
    );
  });

  it("opens add config flow and toggles copy bubble by focus/blur", async () => {
    const { wrapper, controller } = mountView();
    const addButton = wrapper.findAll("button").find((button: any) => button.text() === "添加服务");
    expect(addButton).toBeDefined();
    await addButton?.trigger("click");
    expect(controller.openAddServiceConfig).toHaveBeenCalledTimes(1);

    const copyButton = wrapper.find(".external-service-upstream-copy");
    await copyButton.trigger("focus");
    expect(wrapper.find(".external-service-upstream-bubble").exists()).toBe(true);

    await copyButton.trigger("blur");
    expect(wrapper.find(".external-service-upstream-bubble").exists()).toBe(false);
  });

  it("supports tool popover close paths and keyboard dismiss", async () => {
    const { wrapper } = mountView({
      services: [
        createService({
          serviceId: "mcp-main",
          externalMcp: { tools: ["search", { name: "status" }] },
        }),
      ],
    });

    const row = wrapper.find(".external-service-table-row");
    const toolListButton = row.find(".external-service-tool-list-button");
    await toolListButton.trigger("click");
    expect(wrapper.find(".external-service-tool-popover").exists()).toBe(true);

    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    await nextTick();
    expect(wrapper.find(".external-service-tool-popover").exists()).toBe(false);

    await toolListButton.trigger("click");
    const popover = wrapper.find(".external-service-tool-popover");
    expect(popover.exists()).toBe(true);
    await popover.trigger("keydown.esc");
    expect(wrapper.find(".external-service-tool-popover").exists()).toBe(false);
  });

  it("handles scroller keyboard and drag interactions", async () => {
    const { wrapper } = mountView({
      services: [createService({ serviceId: "scroll-service" })],
    });

    const scroller = wrapper.find(".external-service-table-scroll");
    const scrollerElement = scroller.element as HTMLElement & {
      setPointerCapture: (pointerId: number) => void;
      releasePointerCapture: (pointerId: number) => void;
      hasPointerCapture: (pointerId: number) => boolean;
      scrollLeft: number;
    };

    Object.defineProperty(scrollerElement, "scrollWidth", { configurable: true, value: 800 });
    Object.defineProperty(scrollerElement, "clientWidth", { configurable: true, value: 220 });
    Object.defineProperty(scrollerElement, "scrollLeft", { configurable: true, writable: true, value: 0 });

    scrollerElement.setPointerCapture = vi.fn();
    scrollerElement.releasePointerCapture = vi.fn();
    scrollerElement.hasPointerCapture = vi.fn(() => true);

    scrollerElement.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 11, clientX: 60 }));
    scrollerElement.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 11, clientX: 120 }));
    expect(scrollerElement.setPointerCapture).toHaveBeenCalledWith(11);

    scrollerElement.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 11 }));
    expect(scrollerElement.releasePointerCapture).toHaveBeenCalledWith(11);

    await scroller.trigger("keydown", { key: "ArrowRight" });
    expect(scrollerElement.scrollLeft).toBe(36);

    await scroller.trigger("keydown", { key: "ArrowLeft", shiftKey: true });
    expect(scrollerElement.scrollLeft).toBe(-284);

    await scroller.trigger("keydown", { key: "Home" });
    expect(scrollerElement.scrollLeft).toBe(0);
  });

  it("covers drag pre-conditions, small movement, and unsupported table key events", async () => {
    const { wrapper } = mountView({
      services: [createService({ serviceId: "scroll-service" })],
    });
    const scroller = wrapper.find(".external-service-table-scroll");
    const scrollerElement = scroller.element as HTMLElement & {
      setPointerCapture: (pointerId: number) => void;
      releasePointerCapture: (pointerId: number) => void;
      hasPointerCapture: (pointerId: number) => boolean;
      scrollLeft: number;
      scrollWidth: number;
      clientWidth: number;
    };

    Object.defineProperty(scrollerElement, "scrollWidth", { configurable: true, value: 800 });
    Object.defineProperty(scrollerElement, "clientWidth", { configurable: true, value: 220 });
    Object.defineProperty(scrollerElement, "scrollLeft", { configurable: true, writable: true, value: 10 });

    scrollerElement.setPointerCapture = vi.fn();
    scrollerElement.releasePointerCapture = vi.fn();
    scrollerElement.hasPointerCapture = vi.fn(() => true);

    const interactiveTarget = scroller.find("button").element;
    scrollerElement.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 2, pointerId: 3, clientX: 10 }));
    expect(scrollerElement.setPointerCapture).not.toHaveBeenCalled();

    interactiveTarget.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true,
      button: 0,
      pointerId: 4,
      clientX: 30,
    }));
    expect(scrollerElement.setPointerCapture).not.toHaveBeenCalled();

    scrollerElement.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true,
      button: 0,
      pointerId: 11,
      clientX: 60,
    }));
    expect(scrollerElement.setPointerCapture).toHaveBeenCalledWith(11);

    scrollerElement.dispatchEvent(new PointerEvent("pointermove", {
      bubbles: true,
      pointerId: 11,
      clientX: 61,
    }));
    expect(scrollerElement.scrollLeft).toBe(10);

    scrollerElement.dispatchEvent(new PointerEvent("pointermove", {
      bubbles: true,
      pointerId: 12,
      clientX: 300,
    }));
    expect(scrollerElement.scrollLeft).toBe(10);

    scrollerElement.dispatchEvent(new PointerEvent("pointerup", {
      bubbles: true,
      pointerId: 11,
    }));
    expect(scrollerElement.releasePointerCapture).toHaveBeenCalledWith(11);

    await scroller.trigger("keydown", { key: "Enter" });
    expect(scrollerElement.scrollLeft).toBe(10);
    await scroller.trigger("keydown", { key: "End" });
    expect(scrollerElement.scrollLeft).toBe(800);
    await scroller.trigger("keydown", { key: "Home" });
    expect(scrollerElement.scrollLeft).toBe(0);
  });

  it("shows tool list popover position branches and keeps popover stable on inside clicks", async () => {
    const { wrapper } = mountView({
      services: [
        createService({
          serviceId: "mcp-main",
          externalMcp: {
            tools: [{ name: "search" }, { toolId: "status" }, { id: "query" }, "search"],
          },
        }),
      ],
    });

    const row = wrapper.find(".external-service-table-row");
    const toolListButton = row.find(".external-service-tool-list-button");
    expect(toolListButton.exists()).toBe(true);

    await toolListButton.trigger("click");
    const popover = wrapper.find(".external-service-tool-popover");
    expect(popover.exists()).toBe(true);
    expect(popover.text()).toContain("search");
    expect(popover.text()).toContain("status");
    expect(popover.text()).toContain("query");

    const popoverList = popover.find(".external-service-tool-list");
    popoverList.element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(wrapper.find(".external-service-tool-popover").exists()).toBe(true);

    await toolListButton.trigger("click");
    expect(wrapper.find(".external-service-tool-popover").exists()).toBe(false);
  });

  it("hides tool list affordance when service tools are empty", () => {
    const { wrapper } = mountView({
      services: [
        createService({
          serviceId: "no-tools",
          externalMcp: { tools: [] },
        }),
      ],
    });
    expect(wrapper.find(".external-service-tool-list-button").exists()).toBe(false);
  });

  it("positions upstream bubble above and below based on target geometry", async () => {
    const { wrapper } = mountView();
    const copyButton = wrapper.find(".external-service-upstream-copy");
    const copyButtonElement = copyButton.element;
    const originalInnerHeight = window.innerHeight;
    const originalInnerWidth = window.innerWidth;

    const bubbleBelowRect = {
      x: 18,
      y: 20,
      left: 18,
      right: 182,
      top: 20,
      bottom: 38,
      width: 164,
      height: 18,
      toJSON: () => ({ }),
    };
    const bubbleAboveRect = {
      x: 18,
      y: 630,
      left: 18,
      right: 182,
      top: 630,
      bottom: 648,
      width: 164,
      height: 18,
      toJSON: () => ({ }),
    };

    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 800,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      writable: true,
      value: 680,
    });
    setMockRect(copyButtonElement, bubbleBelowRect);
    await copyButton.trigger("mouseenter");
    expect(wrapper.find(".external-service-upstream-bubble").classes()).toContain("is-below");

    await copyButton.trigger("mouseleave");

    setMockRect(copyButtonElement, bubbleAboveRect);
    await copyButton.trigger("focus");
    expect(wrapper.find(".external-service-upstream-bubble").classes()).toContain("is-above");

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

  it("skips copy action when upstream text is empty", async () => {
    const { wrapper } = mountView({
      services: [
        createService({
          serviceId: "empty-upstream",
          upstreamTargetLabelText: " ",
          upstreamTargetDetailText: "missing target",
        }),
      ],
    });

    await wrapper.find(".external-service-upstream-copy").trigger("click");
    expect(copyConsoleTextWithFeedback).not.toHaveBeenCalled();
  });
});
