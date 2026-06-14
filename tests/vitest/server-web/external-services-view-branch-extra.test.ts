// @vitest-environment jsdom
import { h, nextTick, reactive } from "vue";
import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import ExternalServicesView from "../../../server-web/views/ExternalServicesView.vue";

let activeController: Record<string, unknown> | null = null;

vi.mock("../../../server-web/composables/external-services-view-controller", () => ({
  useExternalServicesViewController: vi.fn(() => activeController),
}));

vi.mock("../../../server-web/composables/serverConsoleShellContext", () => ({
  useServerConsoleShellContext: vi.fn(() => ({})),
}));

vi.mock("../../../server-web/composables/console-browser-effects", () => ({
  copyConsoleTextWithFeedback: vi.fn(),
}));

const ConfigFloatingPanelMock = {
  name: "ConfigFloatingPanel",
  props: ["open", "title", "subtitle", "statusTone", "statusLabel", "verifying"],
  emits: ["close", "verify"],
  setup(props: Record<string, unknown>, context: { slots: { default?: () => any }; emit: (event: "close" | "verify") => void }) {
    return () => {
      if (!props.open) return null;
      return h("section", { class: "mock-config-floating-panel" }, [
        h("header", [
          h("h3", String(props.title || "")),
          h("button", { class: "mock-config-verify-button", onClick: () => context.emit("verify") }, "校验配置"),
          h("button", { class: "mock-config-close-button", onClick: () => context.emit("close") }, "关闭"),
        ]),
        context.slots.default?.(),
      ]);
    };
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
  props: ["tone", "label", "showDot"],
  setup(props: Record<string, unknown>) {
    return () => h("span", { class: "mock-status-pill", "data-tone": String(props.tone || "") }, String(props.label || ""));
  },
};

const BinaryCheckboxMock = {
  name: "BinaryCheckbox",
  props: ["label", "modelValue", "disabled"],
  emits: ["update:model-value"],
  setup(props: Record<string, unknown>, context: { emit: (event: string, value: unknown) => void }) {
    return () =>
      h(
        "button",
        {
          class: "mock-binary-checkbox",
          type: "button",
          disabled: !!props.disabled,
          onClick: () => context.emit("update:model-value", !(props.modelValue as boolean)),
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
  externalMcp?: { tools: Array<string | { name?: string; toolId?: string; id?: string } | null | number> };
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
  const configDraft = {
    serviceId: "mcp-docs",
    serviceName: "Docs MCP",
    mode: "connected",
    startupPolicy: "external-only",
    description: "Documentation service",
    upstream: {
      type: "mcp",
      transport: "streamable-http",
      url: "http://127.0.0.1:8787/mcp",
      endpointUrl: "",
      endpointRef: "",
      rootPath: "",
      secretRef: "",
      provider: "",
      mode: "",
      modelProtocol: "",
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
      host: "127.0.0.1",
      port: null,
      path: "/",
      timeoutMs: 60000,
      required: false,
      url: "",
    },
    metadata: {},
    scripts: {},
  };

  return {
    actionError: "",
    actionMessage: "",
    bindingModeOptions: [{ value: "passthrough", label: "passthrough" }],
    bindingOutletOptions: [{ value: "pact.skillHub", label: "pact.skillHub" }],
    closeConfigEditor: vi.fn(),
    cloudDriveModeOptions: [
      { value: "local", label: "local" },
      { value: "contract", label: "contract" },
      { value: "remote-live", label: "remote-live" },
    ],
    cloudDriveProviderOptions: [{ value: "icloud", label: "iCloud Drive" }],
    configDraft,
    configEditorMode: "add",
    configEditorOpen: false,
    configEditorSubtitle: "填写服务身份、上游 endpoint 和 Pact 暴露方式。",
    configEditorTitle: "添加服务",
    configStatusLabel: "Valid",
    configStatusTone: "success",
    configText: "{\n  \"serviceId\": \"mcp-docs\"\n}",
    dirty: false,
    healthCheckTypeOptions: [{ value: "none", label: "none" }],
    isCloudDriveServiceDraft: false,
    isHttpJsonServiceDraft: false,
    isJsonRpcServiceDraft: false,
    isLlmServiceDraft: false,
    isMcpServiceDraft: true,
    isSseServiceDraft: false,
    loading: false,
    loadError: "",
    mcpTransportOptions: [
      { value: "streamable-http", label: "streamable-http" },
      { value: "sse", label: "sse" },
    ],
    modeOptions: [{ value: "connected", label: "connected" }],
    modelProtocolOptions: [{ value: "openai-compatible", label: "OpenAI Compatible" }],
    modelProtocolSelectValue: "openai-compatible",
    onConfigInput: vi.fn(),
    openAddServiceConfig: vi.fn(),
    openEditServiceConfig: vi.fn(),
    presetCount: 0,
    refreshExternalServices: vi.fn(),
    refreshRuntime: vi.fn(),
    requiredScopesText: "knowledge:read",
    riskOptions: [{ value: "read_only", label: "read_only" }],
    saveConfig: vi.fn(),
    saving: false,
    showToolMappingFields: false,
    showMcpTransportField: true,
    endpointFieldLabel: "Endpoint URL",
    endpointFieldPlaceholder: "https://mcp.example.com:443/mcp/",
    endpointFieldValue: "",
    minimumFieldLabels: [],
    requiredFieldGroupSummaries: [],
    optionalFieldGroupSummaries: [],
    defaultedFieldLabels: [],
    advancedOptionalFieldRows: [],
    currentTemplateLabel: "Raw MCP Streamable HTTP",
    httpMethodOptions: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    primaryToolName: "",
    primaryHttpMethod: "GET",
    primaryHttpPath: "/",
    primaryRpcMethod: "",
    upstreamAuthType: "none",
    upstreamAuthHeaderName: "",
    upstreamAuthSecretRef: "",
    serviceDiscoveryLabel: vi.fn(() => "MCP 服务"),
    serviceDiscoveryRegistrationLabel: vi.fn(() => "工具已发现"),
    serviceDiscoveryRegistrationTone: vi.fn(() => "success"),
    serviceDiscoveryTone: vi.fn(() => "success"),
    serviceHeartbeatLastAtLabel: vi.fn(() => "Latest: -"),
    isServiceHeartbeatRefreshing: vi.fn(() => false),
    serviceActiveToolCount: vi.fn(() => 0),
    serviceCandidateToolCount: vi.fn(() => 0),
    serviceToolAdoptionLabel: vi.fn(() => "工具已采纳"),
    serviceActiveToolReviewRows: vi.fn(() => []),
    serviceCandidateToolReviewRows: vi.fn(() => []),
    serviceCandidateToolFingerprintMap: vi.fn(() => ({})),
    isServiceToolAdopting: vi.fn(() => false),
    adoptCandidateTools: vi.fn().mockResolvedValue(undefined),
    serviceSourceDetail: vi.fn(() => "本地配置 / mcp-docs"),
    services: [],
    showCustomUpstreamType: false,
    startupPolicyOptions: [{ value: "external-only", label: "external-only" }],
    upstreamTargetDetailLabel: vi.fn(() => ""),
    upstreamTargetLabel: vi.fn(() => ""),
    upstreamTypeOptions: [
      { value: "mcp", label: "MCP 服务" },
      { value: "llm", label: "LLM Service" },
      { value: "cloud-drive", label: "Cloud Drive Service" },
      { value: "http", label: "HTTP / HTTPS 服务" },
      { value: "other", label: "其它服务" },
    ],
    upstreamTypeSelectValue: "mcp",
    updateBindingField: vi.fn(),
    updateCloudDriveMode: vi.fn(),
    updateCloudDriveProvider: vi.fn(),
    updateCustomUpstreamType: vi.fn(),
    updateHealthCheckField: vi.fn(),
    updateHealthCheckRequired: vi.fn(),
    updateModelProtocol: vi.fn(),
    updateModelProvider: vi.fn(),
    updatePrimaryToolField: vi.fn(),
    updateAdvancedOptionalField: vi.fn(),
    updateUpstreamAuthField: vi.fn(),
    updateRequiredScopes: vi.fn(),
    updateRootField: vi.fn(),
    updateUpstreamField: vi.fn(),
    updateUpstreamTypeSelection: vi.fn(),
    validationErrors: [],
    validationWarnings: [],
    verifying: false,
    visibleServiceCount: 0,
    ...overrides,
  };
}

function mountView(overrides: Record<string, unknown> = {}) {
  activeController = createController(overrides);
  return mount(ExternalServicesView, {
    global: {
      stubs: {
        BinaryCheckbox: BinaryCheckboxMock,
        ConfigFloatingPanel: ConfigFloatingPanelMock,
        HelpTooltip: HelpTooltipMock,
        StatusPill: StatusPillMock,
      },
    },
  });
}

function getSetupState(wrapper: any) {
  return wrapper.vm.$?.setupState ?? wrapper.vm;
}

function setMaybeRef(state: Record<string, any>, key: string, value: any) {
  if (state[key] && typeof state[key] === "object" && "value" in state[key]) {
    state[key].value = value;
  } else {
    state[key] = value;
  }
}

function getLabeledControl(form: any, labelText: string, selector: string) {
  const label = form.findAll("label").find((entry: any) => entry.text().includes(labelText));
  expect(label, `expected control label containing ${labelText}`).toBeDefined();
  return label!.get(selector);
}

afterEach(() => {
  activeController = null;
});

describe("ExternalServicesView branch coverage", () => {
  it("renders LLM and custom upstream controls while keeping cloud drive controls hidden", () => {
    const wrapper = mountView({
      configEditorOpen: true,
      isLlmServiceDraft: true,
      showCustomUpstreamType: true,
      services: [],
    });

    expect(wrapper.find('input[placeholder="internal-proprietary-service"]').exists()).toBe(true);
    expect(wrapper.find('select[aria-label="模型协议"]').exists()).toBe(true);
    expect(wrapper.find('input[placeholder="openai / anthropic / google / aws-bedrock"]').exists()).toBe(true);
    expect(wrapper.find('input[placeholder="https://mcp.example.com:443/mcp/"]').exists()).toBe(true);
    expect(wrapper.find('select[aria-label="网盘 Provider"]').exists()).toBe(false);
    expect(wrapper.find('select[aria-label="网盘适配模式"]').exists()).toBe(false);
    expect(wrapper.find('input[placeholder="http://127.0.0.1:8787/cloud-drive/"]').exists()).toBe(false);
  });

  it("renders cloud drive remote-live fields, validation messages, and empty state", () => {
    const wrapper = mountView({
      configEditorOpen: true,
      configDraft: {
        serviceId: "icloud-drive",
        serviceName: "iCloud Drive",
        mode: "connected",
        startupPolicy: "external-only",
        description: "",
        upstream: {
          type: "cloud-drive",
          provider: "icloud",
          mode: "remote-live",
          transport: "streamable-http",
          url: "",
          endpointUrl: "http://127.0.0.1:8787/cloud-drive/",
          endpointRef: "config://cloud-drive",
          rootPath: "/Users/name/Library/Mobile Documents",
          secretRef: "secret://drive",
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
          host: "127.0.0.1",
          port: null,
          path: "/",
          timeoutMs: 60000,
          required: false,
          url: "",
        },
        metadata: {},
        scripts: {},
      },
      isCloudDriveServiceDraft: true,
      validationErrors: ["缺少 secretRef"],
      validationWarnings: ["remote-live 需要明确 endpoint"],
      services: [],
    });

    expect(wrapper.find('select[aria-label="网盘 Provider"]').exists()).toBe(true);
    expect(wrapper.find('select[aria-label="网盘适配模式"]').exists()).toBe(true);
    expect(wrapper.find('input[placeholder="/Users/name/Library/Mobile Documents/com~apple~CloudDocs"]').exists()).toBe(true);
    expect(wrapper.find('input[placeholder="http://127.0.0.1:8787/cloud-drive/"]').exists()).toBe(true);
    expect(wrapper.find('input[placeholder="http://127.0.0.1:8787/mcp/"]').exists()).toBe(false);
    expect(wrapper.text()).toContain("缺少 secretRef");
    expect(wrapper.text()).toContain("remote-live 需要明确 endpoint");
    expect(wrapper.find(".empty-state").exists()).toBe(true);
    expect(wrapper.text()).toContain("暂无外部服务");
  });

  it("filters invalid tool entries, keeps the popover stable, and reacts to service list growth", async () => {
    const services = reactive([
      createService({
        serviceId: "mcp-main",
        externalMcp: {
          tools: ["search", null as any, { name: "search" }, { toolId: "status" }, 42 as any],
        },
      }),
    ]) as unknown as any[];

    const wrapper = mountView({ services });
    const row = wrapper.find(".external-service-table-row");
    const toolListButton = row.find(".external-service-tool-list-button");

    await toolListButton.trigger("click");
    const popover = wrapper.find(".external-service-tool-popover");
    expect(popover.exists()).toBe(true);
    expect(popover.text()).toContain("search");
    expect(popover.text()).toContain("status");
    expect(popover.findAll(".external-service-tool-item")).toHaveLength(2);

    toolListButton.element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(wrapper.find(".external-service-tool-popover").exists()).toBe(true);

    services.push(
      createService({
        serviceId: "mcp-extra",
        externalMcp: { tools: ["sync"] },
      }),
    );
    await nextTick();
    expect(wrapper.findAll(".external-service-table-row")).toHaveLength(2);
  });

  it("covers drag and keydown preconditions plus the services-length watch", async () => {
    const wrapper = mountView({
      services: [createService({ serviceId: "scroll-service" })],
    });
    const state = getSetupState(wrapper);
    expect(typeof state.beginServiceTableDrag).toBe("function");
    expect(typeof state.moveServiceTableDrag).toBe("function");
    expect(typeof state.handleServiceTableKeydown).toBe("function");

    const scroller = wrapper.find(".external-service-table-scroll").element as HTMLElement & {
      setPointerCapture: (pointerId: number) => void;
      releasePointerCapture: (pointerId: number) => void;
      hasPointerCapture: (pointerId: number) => boolean;
      scrollLeft: number;
      scrollWidth: number;
      clientWidth: number;
    };
    Object.defineProperty(scroller, "scrollWidth", { configurable: true, value: 240 });
    Object.defineProperty(scroller, "clientWidth", { configurable: true, value: 240 });
    scroller.setPointerCapture = vi.fn();
    scroller.releasePointerCapture = vi.fn();
    scroller.hasPointerCapture = vi.fn(() => true);

    setMaybeRef(state, "serviceTableScroller", scroller);
    state.beginServiceTableDrag({
      button: 0,
      target: document.createTextNode("x"),
      pointerId: 11,
      clientX: 20,
    } as any);
    expect(scroller.setPointerCapture).not.toHaveBeenCalled();

    setMaybeRef(state, "serviceTableDragPointerId", 11);
    setMaybeRef(state, "serviceTableScroller", null);
    state.moveServiceTableDrag({
      pointerId: 11,
      clientX: 60,
      preventDefault: vi.fn(),
    } as any);

    state.handleServiceTableKeydown({
      target: wrapper.element,
      key: "ArrowRight",
      shiftKey: false,
      preventDefault: vi.fn(),
    } as any);

    const watchServices = reactive([createService({ serviceId: "watch-1" })]) as unknown as any[];
    const watchWrapper = mountView({ services: watchServices });
    watchServices.push(createService({ serviceId: "watch-2" }));
    await nextTick();
    expect(watchWrapper.findAll(".external-service-table-row")).toHaveLength(2);
  });

  it("covers config editor root, upstream, binding, and health field updates", async () => {
    const wrapper = mountView({
      configEditorOpen: true,
      showCustomUpstreamType: true,
      isLlmServiceDraft: false,
      isCloudDriveServiceDraft: false,
      configDraft: {
        serviceId: "mcp-docs",
        serviceName: "Docs MCP",
        mode: "connected",
        startupPolicy: "external-only",
        description: "Documentation service",
        upstream: {
          type: "mcp",
          transport: "streamable-http",
          url: "http://127.0.0.1:8787/mcp",
          timeoutMs: 60_000,
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
          port: 8787,
          path: "/health",
          timeoutMs: 60_000,
          required: false,
        },
        metadata: {},
        scripts: {},
      },
      modeOptions: [
        { value: "managed", label: "managed" },
        { value: "connected", label: "connected" },
      ],
      startupPolicyOptions: [
        { value: "with-platform", label: "with-platform" },
        { value: "on-demand", label: "on-demand" },
        { value: "external-only", label: "external-only" },
      ],
      upstreamTypeOptions: [
        { value: "mcp", label: "MCP 服务" },
        { value: "llm", label: "LLM Service" },
        { value: "cloud-drive", label: "Cloud Drive Service" },
        { value: "http", label: "HTTP 服务" },
        { value: "https", label: "HTTPS 服务" },
        { value: "json-rpc", label: "JSON-RPC 服务" },
        { value: "sse", label: "SSE 服务" },
        { value: "other", label: "其它服务" },
      ],
      mcpTransportOptions: [
        { value: "streamable-http", label: "streamable-http" },
        { value: "sse", label: "sse" },
      ],
      bindingModeOptions: [
        { value: "passthrough", label: "passthrough" },
        { value: "compile", label: "compile" },
      ],
      bindingOutletOptions: [
        { value: "pact.skillHub", label: "pact.skillHub" },
      ],
      riskOptions: [
        { value: "read_only", label: "read_only" },
        { value: "safe_write", label: "safe_write" },
        { value: "repair_write", label: "repair_write" },
      ],
      healthCheckTypeOptions: [
        { value: "none", label: "none" },
        { value: "http", label: "http" },
      ],
      services: [createService({ serviceId: "mcp-docs" })],
    });
    const controller = activeController as Record<string, any>;

    const form = wrapper.get(".external-service-config-form");

    await getLabeledControl(form, "服务 ID", "input").setValue("mcp-docs-v2");
    expect(controller.updateRootField).toHaveBeenCalledWith("serviceId", "mcp-docs-v2");

    await getLabeledControl(form, "服务名称", "input").setValue("Docs MCP v2");
    expect(controller.updateRootField).toHaveBeenCalledWith("serviceName", "Docs MCP v2");

    await getLabeledControl(form, "启动策略", "select").setValue("on-demand");
    expect(controller.updateRootField).toHaveBeenCalledWith("startupPolicy", "on-demand");

    await getLabeledControl(form, "描述", "textarea").setValue("Updated service description");
    expect(controller.updateRootField).toHaveBeenCalledWith("description", "Updated service description");

    await wrapper.get('select[aria-label="上游类型"]').setValue("other");
    expect(controller.updateUpstreamTypeSelection).toHaveBeenCalledWith("other");

    await getLabeledControl(form, "超时 ms", "input").setValue("45000");
    expect(controller.updateUpstreamField).toHaveBeenCalledWith("timeoutMs", "45000");

    await getLabeledControl(form, "MCP Transport", "select").setValue("sse");
    expect(controller.updateUpstreamField).toHaveBeenCalledWith("transport", "sse");

    await getLabeledControl(form, "Endpoint URL", "input").setValue("http://127.0.0.1:8787/mcp/v2");
    expect(controller.updateUpstreamField).toHaveBeenCalledWith("url", "http://127.0.0.1:8787/mcp/v2");

    await getLabeledControl(form, "绑定模式", "select").setValue("compile");
    expect(controller.updateBindingField).toHaveBeenCalledWith("mode", "compile");

    await getLabeledControl(form, "Outlet", "select").setValue("pact.skillHub");
    expect(controller.updateBindingField).toHaveBeenCalledWith("outlet", "pact.skillHub");

    await getLabeledControl(form, "风险", "select").setValue("safe_write");
    expect(controller.updateBindingField).toHaveBeenCalledWith("risk", "safe_write");

    await getLabeledControl(form, "Required Scopes", "input").setValue("knowledge:read, knowledge:write");
    expect(controller.updateRequiredScopes).toHaveBeenCalledWith("knowledge:read, knowledge:write");

    await wrapper.get('select[aria-label="健康检查类型"]').setValue("http");
    expect(controller.updateHealthCheckField).toHaveBeenCalledWith("type", "http");

    await getLabeledControl(form, "Host", "input").setValue("127.0.0.1");
    expect(controller.updateHealthCheckField).toHaveBeenCalledWith("host", "127.0.0.1");

    await getLabeledControl(form, "Port", "input").setValue("8080");
    expect(controller.updateHealthCheckField).toHaveBeenCalledWith("port", "8080");

    await getLabeledControl(form, "Timeout ms", "input").setValue("120000");
    expect(controller.updateHealthCheckField).toHaveBeenCalledWith("timeoutMs", "120000");

    await getLabeledControl(form, "健康检查 URL", "input").setValue("http://127.0.0.1:8080/health");
    expect(controller.updateHealthCheckField).toHaveBeenCalledWith("url", "http://127.0.0.1:8080/health");
  });

  it("covers LLM and cloud-drive remote-live branches", async () => {
    const wrapper = mountView({
      configEditorOpen: true,
      isLlmServiceDraft: true,
      isCloudDriveServiceDraft: true,
      configDraft: {
        serviceId: "icloud-drive",
        serviceName: "iCloud Drive",
        mode: "connected",
        startupPolicy: "external-only",
        description: "",
        upstream: {
          type: "cloud-drive",
          provider: "icloud",
          mode: "remote-live",
          transport: "streamable-http",
          url: "",
          endpointUrl: "http://127.0.0.1:8787/cloud-drive/",
          endpointRef: "config://cloud-drive",
          rootPath: "/Users/name/Library/Mobile Documents",
          secretRef: "secret://drive",
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
          host: "127.0.0.1",
          port: null,
          path: "/",
          timeoutMs: 60000,
          required: false,
          url: "",
        },
        metadata: {},
        scripts: {},
      },
      cloudDriveProviderOptions: [
        { value: "icloud", label: "iCloud Drive" },
        { value: "onedrive", label: "OneDrive" },
      ],
      cloudDriveModeOptions: [
        { value: "local", label: "local" },
        { value: "contract", label: "contract" },
        { value: "remote-live", label: "remote-live" },
      ],
      services: [createService({ serviceId: "icloud-drive" })],
    });
    const controller = activeController as Record<string, any>;

    const form = wrapper.get(".external-service-config-form");

    await wrapper.get('input[placeholder="openai / anthropic / google / aws-bedrock"]').setValue("anthropic");
    expect(controller.updateModelProvider).toHaveBeenCalledWith("anthropic");

    await getLabeledControl(form, "网盘 Provider", "select").setValue("onedrive");
    expect(controller.updateCloudDriveProvider).toHaveBeenCalledWith("onedrive");

    await getLabeledControl(form, "适配模式", "select").setValue("remote-live");
    expect(controller.updateCloudDriveMode).toHaveBeenCalledWith("remote-live");

    await getLabeledControl(form, "Secret Ref", "input").setValue("secret://drive-v2");
    expect(controller.updateUpstreamField).toHaveBeenCalledWith("secretRef", "secret://drive-v2");

    await getLabeledControl(form, "Endpoint Ref", "input").setValue("config://cloud-drive-v2");
    expect(controller.updateUpstreamField).toHaveBeenCalledWith("endpointRef", "config://cloud-drive-v2");

    await getLabeledControl(form, "iCloud Root Path", "input").setValue("/Users/name/Library/Mobile Documents/Custom");
    expect(controller.updateUpstreamField).toHaveBeenCalledWith(
      "rootPath",
      "/Users/name/Library/Mobile Documents/Custom",
    );

    await getLabeledControl(form, "Endpoint URL", "input").setValue("http://127.0.0.1:8787/cloud-drive/v2");
    expect(controller.updateUpstreamField).toHaveBeenCalledWith("endpointUrl", "http://127.0.0.1:8787/cloud-drive/v2");
  });
});
