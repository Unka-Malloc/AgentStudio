// @vitest-environment jsdom
import { nextTick } from "vue";
import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { router } from "../../../server-web/router";
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

type ServiceFixture = {
  entryId: string;
  serviceId: string;
  serviceName: string;
  displayName: string;
  description: string;
  mode: string;
  startupPolicy: string;
  sourceLabelText: string;
  discoveryLabelText: string;
  discoveryTone: string;
  discoveryRegistrationLabelText: string;
  discoveryRegistrationTone: string;
  heartbeatText: string;
  heartbeatRefreshing: boolean;
  upstreamTargetLabelText: string;
  upstreamTargetDetailText: string;
  requiredOperations: string[];
  scriptCount: number;
  validationStatus: "valid" | "invalid";
  validation: { ok: boolean; errors: string[]; warnings: string[] };
  externalMcp?: { tools: Array<string | { name?: string; toolId?: string; id?: string }> };
};

function createService(overrides: Partial<ServiceFixture> = {}): ServiceFixture {
  const serviceId = overrides.serviceId || "service-a";
  return {
    entryId: overrides.entryId || serviceId,
    serviceId,
    serviceName: overrides.serviceName || serviceId,
    displayName: overrides.displayName || "Service A",
    description: overrides.description || "",
    mode: overrides.mode || "connected",
    startupPolicy: overrides.startupPolicy || "external-only",
    sourceLabelText: overrides.sourceLabelText || "本地 / service-a",
    discoveryLabelText: overrides.discoveryLabelText || "MCP 服务",
    discoveryTone: overrides.discoveryTone || "success",
    discoveryRegistrationLabelText: overrides.discoveryRegistrationLabelText || "工具已发现",
    discoveryRegistrationTone: overrides.discoveryRegistrationTone || "success",
    heartbeatText: overrides.heartbeatText || "Latest: -",
    heartbeatRefreshing: overrides.heartbeatRefreshing || false,
    upstreamTargetLabelText: overrides.upstreamTargetLabelText || "127.0.0.1:8787",
    upstreamTargetDetailText: overrides.upstreamTargetDetailText || "endpoint",
    requiredOperations: overrides.requiredOperations || ["knowledge.search"],
    scriptCount: overrides.scriptCount ?? 1,
    validationStatus: overrides.validationStatus || "valid",
    validation: overrides.validation || { ok: true, errors: [], warnings: [] },
    externalMcp: overrides.externalMcp,
  };
}

function createController(overrides: Record<string, unknown> = {}) {
  const services = (overrides.services as ServiceFixture[] | undefined) || [
    createService({
      serviceId: "blank-upstream",
      upstreamTargetLabelText: "   ",
      externalMcp: { tools: [] },
    }),
  ];

  return {
    actionError: "",
    actionMessage: "",
    configEditorOpen: false,
    configEditorMode: "add",
    configEditorSubtitle: "",
    configEditorTitle: "",
    configStatusLabel: "",
    configStatusTone: "",
    configDraft: {
      serviceId: "blank-upstream",
      serviceName: "blank-upstream",
      mode: "connected",
      startupPolicy: "external-only",
      description: "",
      upstream: { provider: "icloud", mode: "contract", type: "cloud-drive" },
    },
    customUpstreamTypeValue: "",
    discoveredServiceCount: services.length,
    isCloudDriveServiceDraft: false,
    isLlmServiceDraft: false,
    isServiceHeartbeatRefreshing: vi.fn(() => false),
    loadError: "",
    loading: false,
    modeOptions: [{ value: "connected", label: "connected" }],
    mcpToolCount: services.reduce((total, service) => total + (service.externalMcp?.tools?.length || 0), 0),
    openAddServiceConfig: vi.fn(),
    openEditServiceConfig: vi.fn(),
    presetCount: 0,
    refreshExternalServices: vi.fn(),
    refreshRuntime: vi.fn(),
    requiredScopesText: "knowledge:read",
    riskOptions: [],
    saveConfig: vi.fn(),
    serviceDiscoveryLabel: vi.fn((service: ServiceFixture) => service.discoveryLabelText),
    serviceDiscoveryRegistrationLabel: vi.fn((service: ServiceFixture) => service.discoveryRegistrationLabelText),
    serviceDiscoveryRegistrationTone: vi.fn((service: ServiceFixture) => service.discoveryRegistrationTone),
    serviceDiscoveryTone: vi.fn((service: ServiceFixture) => service.discoveryTone),
    serviceHeartbeatLastAtLabel: vi.fn((service: ServiceFixture) => service.heartbeatText),
    serviceSourceDetail: vi.fn((service: ServiceFixture) => service.sourceLabelText),
    services,
    showCustomUpstreamType: false,
    startupPolicyOptions: [{ value: "external-only", label: "external-only" }],
    stream: false,
    trigger: false,
    upstreamTargetDetailLabel: vi.fn((service: ServiceFixture) => service.upstreamTargetDetailText),
    upstreamTargetLabel: vi.fn((service: ServiceFixture) => service.upstreamTargetLabelText),
    verifyConfig: vi.fn(),
    ...overrides,
  };
}

function mountView(overrides: Record<string, unknown> = {}) {
  activeController = createController(overrides);
  return mount(ExternalServicesView, {
    global: {
      stubs: {
        ConfigFloatingPanel: true,
        HelpTooltip: true,
        StatusPill: true,
        BinaryCheckbox: true,
      },
    },
  });
}

beforeEach(() => {
  copyConsoleTextWithFeedback.mockReset();
  activeController = null;
});

afterEach(() => {
  activeController = null;
});

describe("console high-gap tenth extra", () => {
  it("ignores blank upstream values and omits tool popovers when a service has no tools", async () => {
    const wrapper = mountView();
    await nextTick();

    expect(wrapper.find(".external-service-tool-list-button").exists()).toBe(false);

    const upstreamButton = wrapper.get(".external-service-upstream-copy");
    await upstreamButton.trigger("mouseenter");
    await upstreamButton.trigger("click");
    await nextTick();

    expect(wrapper.find(".external-service-upstream-bubble").exists()).toBe(false);
    expect(copyConsoleTextWithFeedback).not.toHaveBeenCalled();

    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    await nextTick();
    expect(wrapper.find(".external-service-tool-popover").exists()).toBe(false);
  });

  it("keeps redirect records and scroll behavior aligned with router boundaries", () => {
    expect(router.getRoutes().find((route) => route.path === "/external-services")?.redirect).toBe("/external-services/list");
    expect(router.getRoutes().find((route) => route.path === "/knowledge")?.redirect).toBe("/knowledge/management");
    expect(router.getRoutes().find((route) => route.path === "/debug")?.redirect).toBe("/debug/knowledgeRecall");
    expect(router.getRoutes().find((route) => route.path === "/admin")?.redirect).toBe("/admin/storage");
    expect(router.getRoutes().find((route) => route.path === "/admin/tools")?.redirect).toBe("/admin/tool-list");
    expect(router.getRoutes().find((route) => route.path === "/admin/agent-management")?.redirect).toBe("/admin/agent-config");
    expect(router.options.scrollBehavior?.({} as any, {} as any, {} as any)).toEqual({ top: 0 });
  });
});
