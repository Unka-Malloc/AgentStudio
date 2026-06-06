// @vitest-environment jsdom
import { computed, h, nextTick, reactive, ref } from "vue";
import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import WorkspacesView from "../../../server-web/views/WorkspacesView.vue";

let workspacesViewContext: Record<string, unknown>;

vi.mock("../../../server-web/composables/useWorkspacesConsole", () => ({
  useWorkspacesConsole: () => workspacesViewContext,
}));

const BinaryCheckboxMock = {
  name: "BinaryCheckbox",
  props: ["modelValue", "label", "disabled"],
  emits: ["update:modelValue", "update:model-value", "change"],
  setup(
    props: Record<string, unknown>,
    context: { emit: (event: string, value: unknown) => void },
  ) {
    return () =>
      h(
        "button",
        {
          type: "button",
          class: "mock-binary-checkbox",
          disabled: !!props.disabled,
          onClick: () => {
            if (props.disabled) return;
            const nextValue = !Boolean(props.modelValue);
            context.emit("update:modelValue", nextValue);
            context.emit("update:model-value", nextValue);
            context.emit("change", nextValue);
          },
        },
        String(props.label || ""),
      );
  },
};

const StatusPillMock = {
  name: "StatusPill",
  props: ["tone", "label"],
  setup(props: Record<string, unknown>) {
    return () =>
      h(
        "span",
        {
          class: "mock-status-pill",
          "data-tone": String(props.tone || ""),
        },
        String(props.label || ""),
      );
  },
};

const WorkspaceDetailPanelMock = {
  name: "WorkspaceDetailPanel",
  setup() {
    return () => h("div", { class: "mock-workspace-detail-panel" }, "工作空间详情面板");
  },
};

function makeWorkspace(overrides: Record<string, unknown> = {}) {
  return {
    workspaceId: "ws-1",
    title: "主工作区",
    objective: "构建统一指标",
    status: "active",
    parentWorkspaceId: null,
    profile: {},
    ownedSourceIds: ["source-a", "source-b", "source-c"],
    accessibleWorkspaceIds: ["ws-2"],
    currentGeneration: 3,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-04T10:00:00.000Z",
    summary: {
      runCount: 1,
      artifactCount: 2,
      openIssueCount: 3,
      sessionCount: 2,
    },
    fsPath: "/tmp/workspace-1",
    ...overrides,
  };
}

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: "s-1",
    workspaceId: "ws-1",
    title: "初始会话",
    objective: "追踪运行状态",
    status: "active",
    parentSessionId: "",
    forkedFromEventId: "",
    branchIndex: 0,
    eventCount: 3,
    lastEventId: "evt-3",
    appendOnly: true,
    createdAt: "2026-06-04T09:00:00.000Z",
    updatedAt: "2026-06-04T09:10:00.000Z",
    ...overrides,
  };
}

function createContext(overrides: {
  workspaces?: Array<Record<string, unknown>>;
  sessions?: Array<Record<string, unknown>>;
  selectedId?: string;
  panel?: "list" | "create" | "share" | "profile" | "parent" | "localDir" | "cloudDrive" | "codespace";
  localError?: string;
  showDeleteModal?: boolean;
  deleteFolderChecked?: boolean;
  shareFormAction?: string;
  sessionItems?: Array<Record<string, unknown>>;
} = {}) {
  const workspaces = ref(overrides.workspaces ? [...overrides.workspaces] : []);
  const sessions = ref(overrides.sessions ? [...overrides.sessions] : []);
  const selectedId = ref(overrides.selectedId || "");
  const expandedWorkspaceId = ref(overrides.selectedId || "");
  const panel = ref(overrides.panel || "list");
  const localError = ref(overrides.localError || "");
  const showDeleteModal = ref(!!overrides.showDeleteModal);
  const deleteFolderChecked = ref(!!overrides.deleteFolderChecked);
  const shareForm = reactive({ action: overrides.shareFormAction || "" });
  const statusTone = vi.fn((status: string) =>
    status === "active" ? "success" : status === "archived" ? "neutral" : "info",
  );

  const selected = computed(() => {
    const selectedWorkspace = workspaces.value.find((ws) => ws.workspaceId === selectedId.value);
    return selectedWorkspace ? selectedWorkspace : null;
  });

  const sessionItems = ref(
    overrides.sessionItems ??
      sessions.value.map((session) => ({
        id: session.sessionId,
        title: session.title,
        actionLabel: "分叉",
        actionDisabled: false,
      })),
  );

  const workspaceExpansionSlotId = vi.fn((ws: { workspaceId: string }) =>
    `workspace-expansion-${ws.workspaceId}`,
  );
  const isWorkspaceExpanded = vi.fn((ws: { workspaceId: string }) =>
    panel.value === "list" && expandedWorkspaceId.value === ws.workspaceId,
  );
  const toggleWorkspaceCard = vi.fn((ws: { workspaceId: string }) => {
    const shouldCollapse = isWorkspaceExpanded(ws);
    selectedId.value = ws.workspaceId;
    panel.value = "list";
    expandedWorkspaceId.value = shouldCollapse ? "" : ws.workspaceId;
  });

  const context = {
    formatCompactDate: vi.fn((value: string) => `compact(${value})`),
    workspaces,
    sessions,
    selectedId,
    expandedWorkspaceId,
    localError,
    panel,
    shareForm,
    showDeleteModal,
    deleteFolderChecked,
    selected,
    workspaceExpansionSlotId,
    isWorkspaceExpanded,
    toggleWorkspaceCard,
    sessionItems,
    statusTone,
    selectSession: vi.fn(),
    forkSession: vi.fn(),
    deleteWorkspace: vi.fn(),
    openProfile: vi.fn(),
    openParent: vi.fn(),
    openLocalDir: vi.fn(),
    openCloudDrive: vi.fn(),
    openCodespace: vi.fn(),
    load: vi.fn(),
  };

  return context;
}

function mountWorkspacesView(overrides: Record<string, unknown> = {}) {
  const context = createContext(overrides as Parameters<typeof createContext>[0]);
  workspacesViewContext = context;

  const wrapper = mount(WorkspacesView, {
    global: {
      stubs: {
        BinaryCheckbox: BinaryCheckboxMock,
        StatusPill: StatusPillMock,
        WorkspaceDetailPanel: WorkspaceDetailPanelMock,
      },
    },
  });

  return { context, wrapper };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("WorkspacesView extra coverage", () => {
  it("renders empty state and supports create action", async () => {
    const { context, wrapper } = mountWorkspacesView({ workspaces: [], sessions: [] });

    const section = wrapper.get(".workspaces-view");
    expect(section.attributes("data-workspace-knowledge-context")).toContain('"workspaceEndpoint":"/api/agent-workspaces"');
    expect(wrapper.get(".empty-state").text()).toContain("暂无工作空间");
    expect(wrapper.text()).toContain("暂无会话");
    expect(wrapper.text()).toContain("智能体工作空间");
    expect(wrapper.findAll(".mock-workspace-detail-panel").length).toBe(1);
    expect(wrapper.findAll(".status-strip").length).toBe(0);

    await wrapper.get("button.tool-button").trigger("click");
    expect(context.panel.value).toBe("create");
  });

  it("renders workspace list with expansion, selection and action buttons", async () => {
    const { context, wrapper } = mountWorkspacesView({
      workspaces: [
        makeWorkspace(),
        makeWorkspace({
          workspaceId: "ws-2",
          title: "",
          objective: "",
          status: "archived",
          parentWorkspaceId: "ws-1",
          accessibleWorkspaceIds: [],
          summary: undefined,
          updatedAt: "2026-06-04T11:00:00.000Z",
        }),
      ],
      sessions: [makeSession(), makeSession({ sessionId: "s-2", workspaceId: "ws-2" })],
      selectedId: "ws-1",
      localError: "",
      showDeleteModal: false,
    });

    expect(wrapper.text()).toContain("2 个可继续会话");
    expect(wrapper.text()).toContain("主工作区");
    expect(wrapper.text()).toContain("ws-2");
    expect(wrapper.text()).toContain("↳ 继承");
    expect(wrapper.text()).toContain("构建统一指标");
    expect(wrapper.text()).toContain("0 个会话");

    const pills = wrapper.findAll(".mock-status-pill");
    expect(pills.map((pill) => pill.attributes("data-tone"))).toEqual(["success", "neutral"]);

    expect(wrapper.get(".split-toggle-card__body").find(".ws-card-expanded-slot").attributes("id"))
      .toBe("workspace-expansion-ws-1");

    const cards = wrapper.findAll(".ws-card");
    expect(cards.length).toBe(2);
    expect(cards[0].classes()).toContain("selected");
    expect(cards[0].classes()).toContain("expanded");
    expect(wrapper.findAll(".split-toggle-card[data-open='true']")).toHaveLength(1);

    await cards[0].find("button.split-toggle-card__toggle").trigger("click");
    expect(context.toggleWorkspaceCard).toHaveBeenCalledTimes(1);
    expect(context.selectedId.value).toBe("ws-1");
    await nextTick();
    expect(wrapper.findAll(".split-toggle-card[data-open='true']")).toHaveLength(0);

    await cards[1].findAll(".table-action")[0].trigger("click");
    expect(context.openProfile).toHaveBeenCalledTimes(1);
    expect(context.openProfile).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: "ws-2" }));

    await cards[1].findAll(".table-action")[1].trigger("click");
    expect(context.openParent).toHaveBeenCalledTimes(1);
    expect(context.openParent).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: "ws-2" }));

    await cards[1].find("button.split-toggle-card__toggle").trigger("click");
    expect(context.toggleWorkspaceCard).toHaveBeenCalledTimes(2);
    expect(context.selectedId.value).toBe("ws-2");
    expect(context.isWorkspaceExpanded({ workspaceId: "ws-2" })).toBe(true);
    await nextTick();
    expect(wrapper.findAll(".split-toggle-card[data-open='true']")).toHaveLength(1);

    await cards[1].findAll(".table-action")[2].trigger("click");
    expect(context.openLocalDir).toHaveBeenCalledTimes(1);
    expect(context.selectedId.value).toBe("ws-2");

    await cards[1].findAll(".table-action")[3].trigger("click");
    expect(context.openCloudDrive).toHaveBeenCalledTimes(1);
    expect(context.selectedId.value).toBe("ws-2");

    await cards[1].findAll(".table-action")[4].trigger("click");
    expect(context.openCodespace).toHaveBeenCalledTimes(1);
    expect(context.selectedId.value).toBe("ws-2");

    await cards[1].findAll(".table-action")[5].trigger("click");
    expect(context.panel.value).toBe("share");
    expect(context.shareForm.action).toBe("share");

    await wrapper.get(".history-session-item").trigger("click");
    expect(context.selectSession).toHaveBeenCalledWith("s-1");

    await wrapper.get(".history-session-action").trigger("click");
    expect(context.forkSession).toHaveBeenCalledWith("s-1");

    expect(context.expandedWorkspaceId.value).toBe("ws-2");
  });

  it("renders error and delete modal branches and handles their actions", async () => {
    const { context, wrapper } = mountWorkspacesView({
      workspaces: [makeWorkspace()],
      selectedId: "ws-1",
      showDeleteModal: true,
      localError: "加载失败",
    });

    expect(wrapper.get(".status-strip").text()).toContain("加载失败");
    await wrapper.get(".status-strip-action").trigger("click");
    expect(context.localError.value).toBe("");

    await nextTick();
    expect(wrapper.get("h3").text()).toContain("移除工作空间");

    const checkbox = wrapper.get(".mock-binary-checkbox");
    await checkbox.trigger("click");
    expect(context.deleteFolderChecked.value).toBe(true);

    await wrapper.get("button.danger-action").trigger("click");
    expect(context.deleteWorkspace).toHaveBeenCalledTimes(1);

    await wrapper.get("button.tool-button-ghost").trigger("click");
    expect(context.showDeleteModal.value).toBe(false);
  });
});
