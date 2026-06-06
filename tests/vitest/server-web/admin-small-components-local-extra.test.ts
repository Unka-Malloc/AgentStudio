// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, ref } from "vue";
import RuntimeModuleConfigItem from "../../../server-web/components/admin/modules/RuntimeModuleConfigItem.vue";
import RuntimeModuleGroup from "../../../server-web/components/admin/modules/RuntimeModuleGroup.vue";
import RuntimeModulesPanel from "../../../server-web/components/admin/modules/RuntimeModulesPanel.vue";
import OpsMonitorClientRuntimeCard from "../../../server-web/components/admin/ops-monitor/OpsMonitorClientRuntimeCard.vue";
import OpsMonitorProcessTable from "../../../server-web/components/admin/ops-monitor/OpsMonitorProcessTable.vue";
import ProductionBaselineCard from "../../../server-web/components/admin/production-health/ProductionBaselineCard.vue";
import ProductionCoverageWarning from "../../../server-web/components/admin/production-health/ProductionCoverageWarning.vue";
import ProductionGateTable from "../../../server-web/components/admin/production-health/ProductionGateTable.vue";
import ProductionHealthBottomGrid from "../../../server-web/components/admin/production-health/ProductionHealthBottomGrid.vue";
import ProductionHealthHeroCard from "../../../server-web/components/admin/production-health/ProductionHealthHeroCard.vue";
import ProductionSectionGrid from "../../../server-web/components/admin/production-health/ProductionSectionGrid.vue";
import StorageDiscoveryCard from "../../../server-web/components/admin/storage/StorageDiscoveryCard.vue";
import StorageOverviewCard from "../../../server-web/components/admin/storage/StorageOverviewCard.vue";
import StorageRuntimeCard from "../../../server-web/components/admin/storage/StorageRuntimeCard.vue";
import StorageSessionCard from "../../../server-web/components/admin/storage/StorageSessionCard.vue";

const opsMonitorContextMock = vi.hoisted(() => vi.fn());
const modulesContextMock = vi.hoisted(() => vi.fn());
const storageContextMock = vi.hoisted(() => vi.fn());

vi.mock("../../../server-web/composables/opsMonitorViewContext", () => ({
  useOpsMonitorViewContext: opsMonitorContextMock
}));

vi.mock("../../../server-web/composables/modulesViewContext", () => ({
  useModulesViewContext: modulesContextMock
}));

vi.mock("../../../server-web/composables/storageViewContext", () => ({
  useStorageViewContext: storageContextMock
}));

const StatusPillStub = defineComponent({
  name: "StatusPill",
  props: ["tone", "label", "enabled"],
  setup(props) {
    return () => h("span", { class: ["status-pill-stub", props.tone], "data-enabled": String(props.enabled) }, String(props.label || ""));
  }
});

const BrowseSelectButtonStub = defineComponent({
  name: "BrowseSelectButton",
  props: ["disabled", "buttonText"],
  emits: ["browse"],
  setup(props, { emit }) {
    return () => h("button", {
      class: "browse-select-stub",
      type: "button",
      disabled: Boolean(props.disabled),
      onClick: () => {
        if (!props.disabled) {
          emit("browse");
        }
      }
    }, String(props.buttonText || "browse"));
  }
});

const FeatureToggleStub = defineComponent({
  name: "FeatureToggle",
  props: ["modelValue", "disabled"],
  emits: ["update:model-value", "update:modelValue"],
  setup(props, { emit }) {
    return () => h("button", {
      class: "feature-toggle-stub",
      type: "button",
      disabled: Boolean(props.disabled),
      onClick: () => {
        if (!props.disabled) {
          emit("update:model-value", !props.modelValue);
          emit("update:modelValue", !props.modelValue);
        }
      }
    }, String(props.modelValue));
  }
});

const RuntimeModuleGroupStub = defineComponent({
  name: "RuntimeModuleGroup",
  props: ["group"],
  setup(props) {
    return () => h("section", { class: "runtime-module-group-stub" }, String((props.group as any)?.label || ""));
  }
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("admin small component local extra coverage", () => {
  it("renders ops monitor client runtime rows and empty state", () => {
    opsMonitorContextMock.mockReturnValueOnce({
      clientRuntimeCoolingLabel: vi.fn((state) => `cool:${state}`),
      clientRuntimeCoolingTone: vi.fn((state) => (state === "cooling" ? "warning" : "success")),
      clientRuntimeHeatRows: [
        {
          clientUid: "client-a",
          profileId: "profile-a",
          matched: true,
          heatLevel: "hot",
          coolingState: "cooling",
          coolingReason: "quota",
          workspaceId: "workspace-a",
          retrievalProfileId: "retrieval-a",
          contextProfileId: "context-a",
          modelAlias: "model-a",
          recentCalls: 7,
          totalCalls: 11,
          lastSeenAt: "2026-06-05T00:00:00.000Z",
          taskType: "analysis",
          surface: "console"
        }
      ],
      clientRuntimeHeatStyle: vi.fn(() => ({ width: "70%" })),
      clientRuntimeReasonLabel: vi.fn((reason) => `reason:${reason}`),
      clientRuntimeSummary: { totalClients: 1, totalCalls: 11, hotClients: 1, cooledClients: 1 },
      clientRuntimeSurfaceText: vi.fn(() => "控制台"),
      clientRuntimeTaskText: vi.fn(() => "分析"),
      formatCompactDate: vi.fn(() => "today")
    });
    const wrapper = mount(OpsMonitorClientRuntimeCard, {
      global: { stubs: { StatusPill: StatusPillStub } }
    });
    expect(wrapper.text()).toContain("client-a");
    expect(wrapper.text()).toContain("reason:quota");
    expect(wrapper.find(".client-runtime-heatbar").attributes("style")).toContain("width: 70%");

    opsMonitorContextMock.mockReturnValueOnce({
      clientRuntimeCoolingLabel: vi.fn(),
      clientRuntimeCoolingTone: vi.fn(),
      clientRuntimeHeatRows: [],
      clientRuntimeHeatStyle: vi.fn(),
      clientRuntimeReasonLabel: vi.fn(),
      clientRuntimeSummary: { totalClients: 0, totalCalls: 0, hotClients: 0, cooledClients: 0 },
      clientRuntimeSurfaceText: vi.fn(),
      clientRuntimeTaskText: vi.fn(),
      formatCompactDate: vi.fn()
    });
    const empty = mount(OpsMonitorClientRuntimeCard, {
      global: { stubs: { StatusPill: StatusPillStub } }
    });
    expect(empty.text()).toContain("暂无客户端运行时热度");
  });

  it("renders ops monitor process table rows and empty state", () => {
    opsMonitorContextMock.mockReturnValueOnce({
      backgroundProcessLabel: vi.fn((status) => `label:${status}`),
      backgroundProcessStatus: { status: "ready" },
      backgroundProcessTone: vi.fn(() => "success"),
      backgroundProcesses: [
        {
          role: "worker",
          label: "Worker",
          restartCount: 2,
          processType: "child",
          status: "running",
          pid: 1234,
          lastHeartbeatAt: "2026-06-05T00:00:00.000Z",
          responsibility: "Run jobs",
          description: "Fallback",
          parentRole: "server"
        }
      ],
      backgroundRunningCount: 1,
      formatCompactDate: vi.fn(() => "now"),
      processRelationText: vi.fn(() => "server -> worker"),
      processTypeLabel: vi.fn((type) => `type:${type}`)
    });
    const wrapper = mount(OpsMonitorProcessTable, {
      global: { stubs: { StatusPill: StatusPillStub } }
    });
    expect(wrapper.text()).toContain("Worker");
    expect(wrapper.text()).toContain("type:child");
    expect(wrapper.text()).toContain("server -> worker");

    opsMonitorContextMock.mockReturnValueOnce({
      backgroundProcessLabel: vi.fn(),
      backgroundProcessStatus: null,
      backgroundProcessTone: vi.fn(),
      backgroundProcesses: [],
      backgroundRunningCount: 0,
      formatCompactDate: vi.fn(),
      processRelationText: vi.fn(),
      processTypeLabel: vi.fn()
    });
    const empty = mount(OpsMonitorProcessTable, {
      global: { stubs: { StatusPill: StatusPillStub } }
    });
    expect(empty.text()).toContain("暂无进程状态");
    expect(empty.text()).toContain("未读取");
  });

  it("renders production health success, degraded, fallback, and load error branches", () => {
    const health = {
      generatedAt: "2026-06-05T00:00:00.000Z",
      reportRoot: "/reports",
      summary: { pass: 7, fail: 1, timeout: 2, blockedP0: 3 },
      latestReport: {
        runId: "run-1",
        generatedAt: "2026-06-05T01:00:00.000Z",
        git: { commit: "abcdef1234567890", branch: "main", dirtyFileCount: 4 }
      },
      capabilityKernel: {
        ok: false,
        degraded: true,
        provider: "kernel",
        securityMode: "sealed",
        status: "warning",
        message: "degraded",
        bindingCount: 5,
        permissionBindingCount: 6,
        recoverySupported: true
      },
      capabilityBindingGuard: {
        ok: true,
        degraded: false,
        provider: "guard",
        securityMode: "memory",
        status: "ok",
        message: "ready",
        activeBindingCount: 2,
        bindingCount: 3
      }
    };
    const wrapper = mount(ProductionHealthHeroCard, {
      props: { health: health as any, loadError: "boom" }
    });
    expect(wrapper.text()).toContain("读取失败");
    expect(wrapper.text()).toContain("run-1");
    expect(wrapper.text()).toContain("abcdef123456");
    expect(wrapper.find(".status-strip.warning").text()).toContain("Capability Kernel");
    expect(wrapper.find(".status-strip.success").text()).toContain("Binding Guard");

    const fallback = mount(ProductionHealthHeroCard, {
      props: { health: null, loadError: "" }
    });
    expect(fallback.text()).toContain("无报告");
    expect(fallback.text()).toContain("unknown");
    expect(fallback.text()).toContain("docs/reports/history/production-readiness");
  });

  it("renders runtime module groups and config item actions", async () => {
    const enableMountModule = vi.fn();
    const disableMountModule = vi.fn();
    const openMountPathPicker = vi.fn();
    const mountDraft = ref({ parser: "/opt/parser.mjs", disabled: "" });
    modulesContextMock.mockReturnValue({
      busyKey: ref(""),
      canBrowseServerPaths: ref(true),
      disableMountModule,
      enableMountModule,
      mountDraft,
      openMountPathPicker
    });
    const row = {
      name: "parser",
      label: "Parser",
      description: "Parse documents",
      externalEnabled: true,
      runtimeMount: { id: "mount-parser", capabilities: ["parse"], status: "ready" },
      desiredPath: "/opt/parser.mjs"
    };
    const wrapper = mount(RuntimeModuleConfigItem, {
      props: { item: row as any },
      global: {
        stubs: {
          BrowseSelectButton: BrowseSelectButtonStub,
          FeatureToggle: FeatureToggleStub,
          StatusPill: StatusPillStub
        }
      }
    });
    expect(wrapper.text()).toContain("Parser");
    expect(wrapper.text()).toContain("mount-parser");
    await wrapper.find(".browse-select-stub").trigger("click");
    await wrapper.find(".feature-toggle-stub").trigger("click");
    expect(openMountPathPicker).toHaveBeenCalledWith("parser");
    expect(disableMountModule).toHaveBeenCalledWith("parser");

    const group = mount(RuntimeModuleGroup, {
      props: {
        group: {
          id: "knowledge",
          label: "Knowledge modules",
          description: "Knowledge extension modules",
          rows: [row]
        } as any
      },
      global: { stubs: { RuntimeModuleConfigItem: RuntimeModuleGroupStub } }
    });
    expect(group.text()).toContain("Knowledge modules");
    expect(group.text()).toContain("Knowledge extension modules");

    modulesContextMock.mockReturnValueOnce({
      busyKey: ref(""),
      canBrowseServerPaths: ref(false),
      disableMountModule,
      enableMountModule,
      mountDraft: ref({ disabled: "" }),
      openMountPathPicker
    });
    const disabled = mount(RuntimeModuleConfigItem, {
      props: {
        item: {
          ...row,
          name: "disabled",
          externalEnabled: false,
          runtimeMount: null
        } as any
      },
      global: {
        stubs: {
          BrowseSelectButton: BrowseSelectButtonStub,
          FeatureToggle: FeatureToggleStub,
          StatusPill: StatusPillStub
        }
      }
    });
    expect(disabled.find(".feature-toggle-stub").attributes("disabled")).toBeDefined();
    expect(disabled.find(".browse-select-stub").attributes("disabled")).toBeDefined();
  });

  it("wires runtime module panel actions and busy labels", async () => {
    const reloadModules = vi.fn();
    const saveMountModules = vi.fn();
    const busyKey = ref("");
    modulesContextMock.mockReturnValue({
      busyKey,
      consoleState: ref({ runtime: { mountGeneration: 12 } }),
      enabledMountCount: ref(1),
      moduleGroups: ref([{ id: "parser", label: "Parser modules" }]),
      reloadModules,
      saveMountModules,
      totalMountCount: ref(3)
    });
    const wrapper = mount(RuntimeModulesPanel, {
      global: { stubs: { RuntimeModuleGroup: RuntimeModuleGroupStub } }
    });
    expect(wrapper.text()).toContain("运行代次 12");
    expect(wrapper.text()).toContain("启用 1/3");
    expect(wrapper.text()).toContain("Parser modules");

    const buttons = wrapper.findAll("button");
    await buttons[0].trigger("click");
    await buttons[1].trigger("click");
    expect(reloadModules).toHaveBeenCalledTimes(1);
    expect(saveMountModules).toHaveBeenCalledTimes(1);

    busyKey.value = "module-reload";
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain("重载中");
  });

  it("renders storage cards and forwards navigation actions", async () => {
    const openDrawer = vi.fn();
    const openAdmin = vi.fn();
    const logoutConsole = vi.fn();
    const consoleState = {
      discovery: {
        value: {
          serverId: "server-1",
          advertisedBaseUrl: "https://pact.example",
          activeServiceUrl: "http://localhost:7228",
          configVersion: 3
        }
      },
      jobs: { summary: { totalCount: 8, runningCount: 2, queuedCount: 3 } },
      storage: {
        batchCount: 4,
        sourceCount: 5,
        emailCount: 6,
        transactionCount: 7,
        rawObjectCount: 8,
        threadCount: 9,
        peopleCount: 10,
        retrievalCount: 11
      },
      clients: { summary: { totalCount: 12 } },
      runtime: { profile: "production", mountGeneration: 13 }
    };
    storageContextMock.mockReturnValue({
      activeJobCount: 2,
      attentionClientCount: 1,
      busyKey: "",
      consoleState,
      currentUser: { displayName: "Owner", roleLabel: "Admin" },
      enabledMountCount: 2,
      enabledMountPercent: 67,
      logoutConsole,
      openAdmin,
      openDrawer,
      totalMountCount: 3
    });

    const discovery = mount(StorageDiscoveryCard);
    expect(discovery.text()).toContain("server-1");
    await discovery.find("button").trigger("click");
    expect(openDrawer).toHaveBeenCalledWith("discovery");

    const overview = mount(StorageOverviewCard);
    expect(overview.text()).toContain("2/3");
    expect(overview.find(".metric-progress-bar").attributes("style")).toContain("width: 67%");

    const runtime = mount(StorageRuntimeCard);
    expect(runtime.text()).toContain("production");
    await runtime.find("button").trigger("click");
    expect(openAdmin).toHaveBeenCalledWith("modules");

    const session = mount(StorageSessionCard);
    expect(session.text()).toContain("Owner");
    await session.find("button").trigger("click");
    expect(logoutConsole).toHaveBeenCalledTimes(1);

    storageContextMock.mockReturnValueOnce({
      busyKey: "auth:logout",
      currentUser: null,
      logoutConsole
    });
    const busySession = mount(StorageSessionCard);
    expect(busySession.find("button").attributes("disabled")).toBeDefined();
  });

  it("renders production health detail cards and empty states", () => {
    const gate = {
      id: "coverage.unit-threshold",
      title: "Coverage gate",
      status: "fail",
      tone: "danger",
      owner: "quality",
      coverage: ["server", "server-web"],
      blockerLevel: "P0",
      commandSummary: { total: 2, failed: 1, timedOut: 1, elapsedMs: 1200 },
      evidencePath: "build/test-reports/latest.json",
      nextStep: "Raise coverage"
    };
    const gateTable = mount(ProductionGateTable, {
      props: { gates: [gate] as any },
      global: { stubs: { StatusPill: StatusPillStub } }
    });
    expect(gateTable.text()).toContain("Coverage gate");
    expect(gateTable.text()).toContain("未通过 1");

    const emptyGateTable = mount(ProductionGateTable, {
      props: { gates: [] },
      global: { stubs: { StatusPill: StatusPillStub } }
    });
    expect(emptyGateTable.text()).toContain("暂无生产准入报告");

    const warning = mount(ProductionCoverageWarning, {
      props: { missing: ["server", "server-web"] }
    });
    expect(warning.text()).toContain("2 项");

    const baseline = mount(ProductionBaselineCard, {
      props: {
        baseline: {
          status: "ready",
          protocolVersion: "v1",
          verificationMode: "strict",
          mcpOutlets: ["stdio", "http"],
          ports: [
            { port: "SecretStorePort", verificationMode: "sealed", implementation: "sealed" },
            { port: "StoragePort", implementation: "sqlite" }
          ],
          storageStates: ["queued"],
          rootPath: "/data/baseline",
          boundaries: { externalState: "contract" }
        } as any,
        baselineError: "baseline failed"
      },
      global: { stubs: { StatusPill: StatusPillStub } }
    });
    expect(baseline.text()).toContain("baseline failed");
    expect(baseline.text()).toContain("Secret 模式");

    const bottomGrid = mount(ProductionHealthBottomGrid, {
      props: {
        actions: [{ id: "run", label: "Run gate", command: "npm run test:unit-coverage:gate" }],
        history: [{ runId: "history-1", status: "pass", generatedAt: "2026-06-05T00:00:00.000Z" }]
      } as any,
      global: { stubs: { StatusPill: StatusPillStub } }
    });
    expect(bottomGrid.text()).toContain("history-1");
    expect(bottomGrid.text()).toContain("npm run test:unit-coverage:gate");

    const emptyBottomGrid = mount(ProductionHealthBottomGrid, {
      props: { actions: [], history: [] },
      global: { stubs: { StatusPill: StatusPillStub } }
    });
    expect(emptyBottomGrid.text()).toContain("没有历史报告");

    const sectionGrid = mount(ProductionSectionGrid, {
      props: {
        sections: [{
          id: "quality",
          label: "Quality",
          description: "Quality gates",
          status: "warning",
          tone: "warning",
          passed: 1,
          total: 3,
          gates: [{ id: "coverage", title: "Coverage", tone: "danger" }],
          missingGateIds: ["security"]
        }]
      } as any,
      global: { stubs: { StatusPill: StatusPillStub } }
    });
    expect(sectionGrid.text()).toContain("Quality");
    expect(sectionGrid.text()).toContain("security");
  });
});
