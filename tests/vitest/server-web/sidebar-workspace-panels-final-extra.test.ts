// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { computed, defineComponent, h, ref } from "vue";

import ConsoleSideNavDebugSection from "../../../server-web/components/shell/side-nav/ConsoleSideNavDebugSection.vue";
import ConsoleSideNavKnowledgeSection from "../../../server-web/components/shell/side-nav/ConsoleSideNavKnowledgeSection.vue";
import ConsoleSideNavSystemSection from "../../../server-web/components/shell/side-nav/ConsoleSideNavSystemSection.vue";
import WorkspaceCheckpointPanel from "../../../server-web/components/workspaces/WorkspaceCheckpointPanel.vue";
import WorkspaceExpandedOverview from "../../../server-web/components/workspaces/WorkspaceExpandedOverview.vue";
import { provideConsoleSideNavContext } from "../../../server-web/composables/consoleSideNavContext";
import { provideWorkspacesView } from "../../../server-web/composables/workspacesViewContext";

const NavLinkStub = defineComponent({
  name: "ConsoleSideNavLink",
  props: ["active", "label", "subtle"],
  emits: ["activate"],
  setup(props, { emit }) {
    return () =>
      h(
        "button",
        {
          class: ["nav-link-stub", props.active ? "active" : "", props.subtle ? "subtle" : ""],
          type: "button",
          "data-active": String(Boolean(props.active)),
          onClick: () => emit("activate"),
        },
        String(props.label),
      );
  },
});

const ConfigFoldCardStub = defineComponent({
  name: "ConfigFoldCard",
  props: ["title"],
  setup(props, { slots }) {
    return () =>
      h("section", { class: "config-fold-card-stub", "data-title": props.title }, [
        h("h4", String(props.title ?? "")),
        ...(slots.default?.() || []),
      ]);
  },
});

const StatusPillStub = defineComponent({
  name: "StatusPill",
  props: ["tone", "label"],
  setup(props) {
    return () => h("span", { class: "status-pill-stub", "data-tone": props.tone }, String(props.label));
  },
});

const WorkspaceFileTreeStub = defineComponent({
  name: "WorkspaceFileTree",
  props: ["files"],
  setup(props) {
    return () => h("div", { class: "workspace-file-tree-stub" }, JSON.stringify(props.files));
  },
});

function mountWithSideNavContext(component: unknown, overrides: Record<string, unknown> = {}) {
  const context = {
    activeRouteAdminView: "storage",
    activeRouteDebugTab: "agentRetrieval",
    activeRouteKnowledgeTab: "management",
    activeRouteView: "debug",
    hasFeature: vi.fn((feature: string) => feature !== "disabled-feature"),
    jumpToKnowledgeFileImport: vi.fn(),
    knowledgeManagementPanel: "knowledge",
    localizedDebugTabLabel: vi.fn((tab: { label?: string; id: string }) => tab.label || tab.id),
    msg: {
      nav: {
        corpusAnalysis: "语料分析",
        debugPanel: "调试",
        jobs: "作业",
        knowledge: "知识",
        knowledgeArchive: "知识归档",
        knowledgeDistillation: "知识蒸馏",
        logs: "日志",
        maintenanceAgent: "维护智能体",
        modules: "模块",
        operations: "运维",
        opsMonitor: "监控",
        overview: "总览",
        parameterConfig: "参数配置",
        processingRules: "处理规则",
        productionHealth: "生产健康",
        runtimeDownloads: "运行时下载",
        strategyManagement: "策略管理",
        system: "系统",
      },
    },
    openAdmin: vi.fn(),
    openDebugTab: vi.fn(),
    openKnowledgeManagementPanel: vi.fn(),
    openKnowledgeTab: vi.fn(),
    visibleDebugTabs: ref([
      { id: "agentRetrieval", label: "检索" },
      { id: "knowledgeDistillation", label: "蒸馏" },
      { id: "modelProbe", label: "模型探测" },
    ]),
    ...overrides,
  } as any;

  const Parent = defineComponent({
    setup() {
      provideConsoleSideNavContext(context);
      return () => h(component as any);
    },
  });

  return {
    context,
    wrapper: mount(Parent, {
      global: {
        stubs: {
          ConsoleSideNavLink: NavLinkStub,
        },
      },
    }),
  };
}

function mountWithWorkspaceContext(component: unknown, context: Record<string, unknown>) {
  const Parent = defineComponent({
    setup() {
      provideWorkspacesView(context as any);
      return () => h(component as any);
    },
  });

  return mount(Parent, {
    global: {
      stubs: {
        ConfigFoldCard: ConfigFoldCardStub,
        StatusPill: StatusPillStub,
        WorkspaceFileTree: WorkspaceFileTreeStub,
      },
    },
  });
}

describe("server-web sidebar sections final extra coverage", () => {
  it("filters the debug distillation tab and opens selected debug tabs", async () => {
    const { context, wrapper } = mountWithSideNavContext(ConsoleSideNavDebugSection);
    const links = wrapper.findAll(".nav-link-stub");

    expect(wrapper.find("section").attributes("aria-label")).toBe("调试");
    expect(links.map((link) => link.text())).toEqual(["检索", "模型探测"]);
    expect(links[0].attributes("data-active")).toBe("true");

    await links[1].trigger("click");
    expect(context.openDebugTab).toHaveBeenCalledWith("modelProbe");
  });

  it("renders knowledge links according to feature flags and calls navigation handlers", async () => {
    const { context, wrapper } = mountWithSideNavContext(ConsoleSideNavKnowledgeSection, {
      activeRouteView: "knowledge",
      hasFeature: vi.fn((feature: string) => feature !== "knowledge-distillation"),
    });

    expect(wrapper.find("section").exists()).toBe(true);
    expect(wrapper.findAll(".nav-link-stub").map((link) => link.text())).toEqual([
      "知识归档",
      "处理规则",
      "语料分析",
      "参数配置",
    ]);

    await wrapper.findAll(".nav-link-stub")[0].trigger("click");
    await wrapper.findAll(".nav-link-stub")[1].trigger("click");
    await wrapper.findAll(".nav-link-stub")[2].trigger("click");
    await wrapper.findAll(".nav-link-stub")[3].trigger("click");
    expect(context.jumpToKnowledgeFileImport).toHaveBeenCalled();
    expect(context.openKnowledgeManagementPanel).toHaveBeenCalledWith("rules");
    expect(context.openKnowledgeTab).toHaveBeenCalledWith("wordCloud");
    expect(context.openKnowledgeTab).toHaveBeenCalledWith("maintenance");
  });

  it("renders system and operations links and hides maintenance when disabled", async () => {
    const { context, wrapper } = mountWithSideNavContext(ConsoleSideNavSystemSection, {
      activeRouteView: "admin",
      activeRouteAdminView: "jobs",
      hasFeature: vi.fn((feature: string) => feature !== "maintenance-agent-runbooks"),
    });

    expect(wrapper.findAll("section")).toHaveLength(2);
    expect(wrapper.findAll(".nav-link-stub").map((link) => link.text())).toEqual([
      "总览",
      "模块",
      "运行时下载",
      "策略管理",
      "日志",
      "作业",
      "监控",
    ]);
    expect(wrapper.findAll(".nav-link-stub")[5].attributes("data-active")).toBe("true");

    await wrapper.findAll(".nav-link-stub")[2].trigger("click");
    await wrapper.findAll(".nav-link-stub")[6].trigger("click");
    expect(context.openAdmin).toHaveBeenCalledWith("runtimeDownloads");
    expect(context.openAdmin).toHaveBeenCalledWith("opsMonitor");
  });
});

describe("server-web workspace panels final extra coverage", () => {
  it("renders checkpoint trees, node actions, empty/error states, and restore previews", async () => {
    const context = {
      busyKey: "",
      checkpointNodeBasePath: vi.fn((node: { basePath?: string }) => node.basePath || "/workspace"),
      checkpointNodeFileCount: vi.fn((node: { files?: unknown[] }) => node.files?.length || 0),
      formatCompactDate: vi.fn((value: string) => `date:${value}`),
      loadWorkspaceCheckpointTree: vi.fn(),
      loadWorkspaceCheckpoints: vi.fn(),
      previewWorkspaceCheckpointRestore: vi.fn(),
      restoreWorkspaceCheckpoint: vi.fn(),
      selectedCheckpointNodeId: "node-1",
      selectedCheckpointTreeId: "tree-1",
      selectedId: "ws-1",
      workspaceCheckpointError: "",
      workspaceCheckpointNodes: [
        { nodeId: "node-1", label: "Before change", files: [{ path: "a.txt" }], updatedAt: "2026-06-05", basePath: "/tmp/ws" },
      ],
      workspaceCheckpointPreview: {
        applied: false,
        restoreId: "restore-1",
        workspaceFileRestore: { actions: [{ op: "write" }] },
      },
      workspaceCheckpointPreviewRestore: { dryRun: true, actions: [{ op: "write" }] },
      workspaceCheckpointTrees: [
        { treeId: "tree-12345678901234567890", status: "ready", nodeCount: 2, updatedAt: "2026-06-05" },
      ],
    };
    const wrapper = mountWithWorkspaceContext(WorkspaceCheckpointPanel, context);

    expect(wrapper.text()).toContain("1 个文件 checkpoint tree");
    expect(wrapper.text()).toContain("tree-123456789012");
    await wrapper.find(".checkpoint-toolbar button").trigger("click");
    await wrapper.find(".checkpoint-tree-item").trigger("click");
    await wrapper.findAll(".checkpoint-node-actions button")[0].trigger("click");
    await wrapper.findAll(".checkpoint-node-actions button")[1].trigger("click");
    expect(context.loadWorkspaceCheckpoints).toHaveBeenCalledWith("ws-1");
    expect(context.loadWorkspaceCheckpointTree).toHaveBeenCalledWith("tree-12345678901234567890");
    expect(context.previewWorkspaceCheckpointRestore).toHaveBeenCalledWith("node-1");
    expect(context.restoreWorkspaceCheckpoint).toHaveBeenCalledWith("node-1");
    expect(wrapper.find(".checkpoint-preview").text()).toContain("restoreId: restore-1");

    const empty = mountWithWorkspaceContext(WorkspaceCheckpointPanel, {
      ...context,
      workspaceCheckpointTrees: [],
      workspaceCheckpointNodes: [],
      workspaceCheckpointPreview: null,
    });
    expect(empty.text()).toContain("当前工作空间还没有文件 checkpoint");

    const error = mountWithWorkspaceContext(WorkspaceCheckpointPanel, {
      ...context,
      workspaceCheckpointError: "读取失败",
      workspaceCheckpointTrees: [],
    });
    expect(error.find(".checkpoint-error").text()).toBe("读取失败");
  });

  it("renders selected workspace expanded overview without repeating summary metadata", async () => {
    const context = {
      chainData: { chain: [{ workspaceId: "root", title: "Root" }, { workspaceId: "ws-1", title: "Current" }] },
      contextData: {
        knowledgeSourceIds: ["source-1234567890abcdef"],
        contextProfileId: "profile-1",
        toolGrantId: "grant-1",
        modelAlias: "model-a",
      },
      formatCompactDate: vi.fn((value: string) => `date:${value}`),
      selected: {
        workspaceId: "ws-1",
        title: "Workspace",
        objective: "Ship",
        status: "active",
        currentGeneration: 3,
        parentWorkspaceId: "",
        fsPath: "/tmp/ws",
        updatedAt: "2026-06-05",
        profile: { model: "m" },
      },
      selectedId: "ws-1",
      selectedSession: {
        events: [
          { eventId: "event-1", sequence: 1, title: "Started", type: "start", createdAt: "2026-06-05" },
        ],
      },
      sessionContextData: {
        agentSessionId: "session-1",
        sessionEventCount: 1,
        parentSessionId: "",
        forkedFromEventId: "",
      },
      statusTone: vi.fn(() => "success"),
      workspaceFilesData: { files: [{ path: "README.md", kind: "file" }] },
    };
    const wrapper = mountWithWorkspaceContext(WorkspaceExpandedOverview, context);

    expect(wrapper.text()).not.toContain("Generation 3");
    expect(wrapper.text()).not.toContain("工作空间 ID");
    expect(wrapper.text()).not.toContain("/tmp/ws");
    expect(wrapper.text()).toContain("继承链");
    expect(wrapper.text()).toContain("Current");
    expect(wrapper.text()).toContain("当前会话线程");
    expect(wrapper.text()).toContain("解析后的运行上下文");
    expect(wrapper.text()).toContain("source-1234567");
    expect(wrapper.find(".workspace-file-tree-stub").text()).toContain("README.md");

    const hidden = mountWithWorkspaceContext(WorkspaceExpandedOverview, {
      ...context,
      selected: null,
    });
    expect(hidden.text()).toBe("");
  });
});
