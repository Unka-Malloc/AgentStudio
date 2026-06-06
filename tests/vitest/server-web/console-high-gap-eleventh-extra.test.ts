// @vitest-environment jsdom
import { nextTick, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import ExternalServicesView from "../../../server-web/views/ExternalServicesView.vue";
import { createConsolePathPickerActionController } from "../../../server-web/composables/console-path-picker-action-controller";
import { createConsolePathPickerController } from "../../../server-web/composables/console-path-picker-controller";

const mockRuntimeInfoClient = vi.hoisted(() => ({
  browseServerPath: vi.fn(),
}));

const externalServicesController = vi.hoisted(() => ({
  current: null as Record<string, unknown> | null,
}));

const copyConsoleText = vi.hoisted(() => vi.fn());
const copyConsoleTextWithFeedback = vi.hoisted(() => vi.fn());

vi.mock("../../../server-web/lib/runtime-info-client", () => ({
  browseServerPath: mockRuntimeInfoClient.browseServerPath,
}));

vi.mock("../../../server-web/composables/external-services-view-controller", () => ({
  useExternalServicesViewController: vi.fn(() => externalServicesController.current),
}));

vi.mock("../../../server-web/composables/serverConsoleShellContext", () => ({
  useServerConsoleShellContext: vi.fn(() => ({})),
}));

vi.mock("../../../server-web/composables/console-browser-effects", () => ({
  copyConsoleTextToClipboard: copyConsoleText,
  copyTextToClipboard: copyConsoleText,
  copyConsoleTextWithFeedback: copyConsoleTextWithFeedback,
}));

type ServiceFixture = {
  entryId: string;
  serviceId: string;
  serviceName: string;
  displayName: string;
  description: string;
  mode: string;
  startupPolicy: string;
  requiredOperations: string[];
  scriptCount: number;
  validationStatus: "valid" | "invalid";
  validation: { ok: boolean; errors: string[]; warnings: string[] };
  externalMcp?: {
    tools: Array<string | { name?: string; toolId?: string; id?: string }>;
  };
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
  const serviceId = override.serviceId || "service-a";
  return {
    entryId: override.entryId || serviceId,
    serviceId,
    serviceName: override.serviceName || serviceId,
    displayName: override.displayName || serviceId,
    description: override.description || "",
    mode: override.mode || "connected",
    startupPolicy: override.startupPolicy || "external-only",
    requiredOperations: override.requiredOperations || ["knowledge.search"],
    scriptCount: override.scriptCount ?? 1,
    validationStatus: override.validationStatus || "valid",
    validation: override.validation || { ok: true, errors: [], warnings: [] },
    externalMcp: override.externalMcp || { tools: ["search", { name: "file.list" }, { id: "file.list" }, "status"] },
    upstreamTargetLabelText: override.upstreamTargetLabelText || "127.0.0.1:8787",
    upstreamTargetDetailText: override.upstreamTargetDetailText || "endpoint",
    sourceLabelText: override.sourceLabelText || "本地 / service-a",
    discoveryLabelText: override.discoveryLabelText || "MCP 服务",
    discoveryTone: override.discoveryTone || "success",
    discoveryRegistrationLabelText: override.discoveryRegistrationLabelText || "工具已发现",
    discoveryRegistrationTone: override.discoveryRegistrationTone || "success",
    heartbeatText: override.heartbeatText || "Latest: -",
    heartbeatRefreshing: override.heartbeatRefreshing || false,
  };
}

function createController(overrides: Record<string, unknown> = {}) {
  const services = (overrides.services as ServiceFixture[] | undefined) || [createService()];
  const fallback = {
    actionError: "",
    actionMessage: "",
    configEditorOpen: false,
    configEditorMode: "add",
    configEditorTitle: "",
    configEditorSubtitle: "",
    configStatusTone: "",
    configStatusLabel: "",
    configText: "{}",
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
    refreshExternalServices: vi.fn(),
    refreshRuntime: vi.fn(),
    saveConfig: vi.fn(),
    closeConfigEditor: vi.fn(),
    verifyConfig: vi.fn(),
    validationErrors: [],
    validationWarnings: [],
    validating: false,
    saving: false,
    serviceSourceDetail: (service: ServiceFixture) => service.sourceLabelText,
    serviceDiscoveryLabel: (service: ServiceFixture) => service.discoveryLabelText,
    serviceDiscoveryTone: (service: ServiceFixture) => service.discoveryTone,
    serviceDiscoveryRegistrationLabel: (service: ServiceFixture) => service.discoveryRegistrationLabelText,
    serviceDiscoveryRegistrationTone: (service: ServiceFixture) => service.discoveryRegistrationTone,
    upstreamTargetLabel: (service: ServiceFixture) => service.upstreamTargetLabelText,
    upstreamTargetDetailLabel: (service: ServiceFixture) => service.upstreamTargetDetailText,
    serviceHeartbeatLastAtLabel: (service: ServiceFixture) => service.heartbeatText,
    requiredScopesText: "knowledge:read",
    riskOptions: [],
    startupPolicyOptions: [{ value: "external-only", label: "external-only" }],
    upstreamTypeOptions: [{ value: "mcp", label: "MCP 服务" }],
    showCustomUpstreamType: false,
    discoveryCacheUpdatedAtLabel: "",
    configuredCount: services.filter((service) => service.validationStatus !== "invalid").length,
    presetCount: services.filter((service) => service.validationStatus === "valid").length,
    validServiceCount: services.filter((service) => service.validationStatus === "valid").length,
    services,
  };
  return {
    ...fallback,
    ...overrides,
  };
}

function mountView(overrides: Record<string, unknown> = {}) {
  externalServicesController.current = createController(overrides);
  return {
    controller: externalServicesController.current,
    wrapper: mount(ExternalServicesView, {
      global: {
        stubs: {
          ConfigFloatingPanel: true,
          HelpTooltip: true,
          StatusPill: true,
          BinaryCheckbox: true,
        },
      },
    }),
  };
}

beforeEach(() => {
  copyConsoleText.mockReset();
  copyConsoleTextWithFeedback.mockReset();
  mockRuntimeInfoClient.browseServerPath.mockReset();
  externalServicesController.current = null;
});

afterEach(() => {
  externalServicesController.current = null;
});

describe("console-path-picker-action-controller", () => {
  it("dispatches directory/file corpus selections to word-cloud path state", () => {
    const addWordCloudCorpusPaths = vi.fn();
    const applyLocalSourceDirectoryPath = vi.fn();
    const openServerPathPicker = vi.fn();
    const localSourceForm = ref({ directoryPath: "/workspace/data" });
    const settingsDraft = ref({
      ocrPythonPath: "",
      tikaJarPath: "",
      javaBinPath: "",
    } as {
      ocrPythonPath?: string;
      tikaJarPath?: string;
      javaBinPath?: string;
    });

    const controller = createConsolePathPickerActionController({
      addWordCloudCorpusPaths,
      applyLocalSourceDirectoryPath,
      localSourceForm,
      openServerPathPicker,
      settingsDraft,
    });

    controller.openWordCloudCorpusDirectoryPicker();
    controller.openWordCloudCorpusFilePicker();
    expect(openServerPathPicker).toHaveBeenCalledTimes(2);

    const directoryCall = openServerPathPicker.mock.calls[0]?.[0];
    const fileCall = openServerPathPicker.mock.calls[1]?.[0];

    expect(directoryCall).toMatchObject({ mode: "directory", title: "选择词云语料目录", closeOnSelect: false });
    expect(fileCall).toMatchObject({ mode: "file", title: "选择词云语料文件", closeOnSelect: false });

    directoryCall.applyPath("/tmp/corpus-dir");
    fileCall.applyPath("/tmp/sheet.txt");

    expect(addWordCloudCorpusPaths).toHaveBeenNthCalledWith(1, [{ path: "/tmp/corpus-dir", type: "directory" }]);
    expect(addWordCloudCorpusPaths).toHaveBeenNthCalledWith(2, [{ path: "/tmp/sheet.txt", type: "file" }]);

    controller.openSettingsPathPicker("javaBinPath", "选择 javaBin");
    const settingsCall = openServerPathPicker.mock.calls.at(-1)?.[0];
    settingsCall.applyPath("/usr/bin/java");
    expect(settingsDraft.value.javaBinPath).toBe("/usr/bin/java");
  });
});

describe("console-path-picker-controller", () => {
  it("propagates runtime path browser failures to picker state", async () => {
    mockRuntimeInfoClient.browseServerPath.mockRejectedValueOnce(new Error("路径服务不可用"));

    const pickerController = createConsolePathPickerController();
    pickerController.openServerPathPicker({
      title: "选择路径",
      mode: "directory",
      value: "/tmp",
      applyPath: vi.fn(),
    });

    await nextTick();
    await nextTick();

    expect(pickerController.pathPicker.value.error).toBe("路径服务不可用");
    expect(pickerController.pathPicker.value.open).toBe(true);
  });
});

describe("ExternalServicesView", () => {
  it("normalizes mixed tool descriptors and deduplicates trimmed values in the popover", async () => {
    const { wrapper } = mountView({
      services: [
        createService({
          serviceId: "service-alpha",
          externalMcp: {
            tools: [
              "  status  ",
              { name: "status" },
              { toolId: "  query-items  " },
              { id: "query-items" },
              { name: "   " },
              { id: "" },
              "status",
            ],
          },
        }),
      ],
    });

    const toolButton = wrapper.get(".external-service-tool-list-button");
    await toolButton.trigger("click");

    const tools = wrapper.findAll(".external-service-tool-item").map((item) => item.text());
    expect(tools).toEqual(["status", "query-items"]);
  });

  it("renders failed state and empty state together when list is empty", () => {
    const { wrapper } = mountView({
      services: [],
      loading: false,
      loadError: "加载列表失败",
      actionError: "保存失败",
    });

    const alerts = wrapper.findAll(".external-service-alert");
    expect(alerts).toHaveLength(2);
    expect(alerts[0].text()).toBe("加载列表失败");
    expect(alerts[1].text()).toBe("保存失败");

    expect(wrapper.find(".empty-state").exists()).toBe(true);
    expect(wrapper.find(".empty-state strong").text()).toBe("暂无外部服务");
  });

  it("dispatches row actions and keeps popover stable on resize-observer unavailable path", async () => {
    const addListener = vi.spyOn(document, "addEventListener");
    const removeListener = vi.spyOn(document, "removeEventListener");
    const previousResizeObserver = globalThis.ResizeObserver;
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    globalThis.ResizeObserver = undefined;

    const { controller, wrapper } = mountView({
      services: [createService({ serviceId: "service-edit" })],
    });

    await nextTick();
    const row = wrapper.get(".external-service-table-row");
    const rowButtons = row.findAll("button");
    await rowButtons.find((button) => button.text() === "修改配置")?.trigger("click");
    expect(controller.openEditServiceConfig).toHaveBeenCalledTimes(1);

    await rowButtons.find((button) => button.text() === "服务探测")?.trigger("click");
    expect(controller.refreshRuntime).toHaveBeenCalledWith("service-edit");

    wrapper.unmount();
    expect(removeListener).toHaveBeenCalledWith("pointerdown", expect.any(Function));

    globalThis.ResizeObserver = previousResizeObserver;
    addListener.mockRestore();
    removeListener.mockRestore();
  });
});
