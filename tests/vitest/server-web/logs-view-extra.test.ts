// @vitest-environment jsdom
import { defineComponent, h, nextTick, ref, type Ref } from "vue";
import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KnowledgeLogRow } from "../../../server-web/types/app";
import LogsView from "../../../server-web/views/admin/LogsView.vue";

type ShellContext = {
  adminView: Ref<string>;
  busyKey: Ref<string>;
  currentView: Ref<string>;
  error: Ref<string | null>;
  exportKnowledgeLogRows: ReturnType<typeof vi.fn>;
  filteredKnowledgeLogRows: Ref<KnowledgeLogRow[]>;
  handleKnowledgeLogTableScroll: ReturnType<typeof vi.fn>;
  isAuthenticated: Ref<boolean>;
  knowledgeLogAdvancedOpen: Ref<boolean>;
  knowledgeLogColumnWidths: Ref<Record<string, number>>;
  knowledgeLogFilters: Ref<{
    id: string;
    status: string;
    stage: string;
    from: string;
    to: string;
  }>;
  knowledgeLogStatusOptionBarOptions: Ref<Array<{ value: string; label: string }>>;
  knowledgeLogTableShellRef: Ref<HTMLElement | null>;
  monitorAlertSummary: { visibleCount: number; activeCount: number };
  workQueueSummary: { total: number };
  serverLogRows: Ref<KnowledgeLogRow[]>;
};

const shellContextState = vi.hoisted(() => ({
  current: null as ShellContext | null,
}));

vi.mock("../../../server-web/composables/serverConsoleShellContext", () => ({
  useServerConsoleShellContext: vi.fn(() => {
    if (!shellContextState.current) {
      throw new Error("logs view shell context mock is not initialized");
    }
    return shellContextState.current;
  }),
}));

const DataTableStub = defineComponent({
  name: "DataTable",
  props: {
    data: {
      type: Array,
      default: () => [],
    },
    rowKey: {
      type: [String, Function],
      default: "",
    },
    emptyText: {
      type: String,
      default: "",
    },
  },
  emits: ["scroll", "header-dragend"],
  setup(props, { emit, slots }) {
    return () => {
      const columns = slots.default?.() ?? [];
      return h("section", { class: "mock-data-table" }, [
        h(
          "button",
          {
            class: "mock-data-table-scroll",
            type: "button",
            onClick: () => emit("scroll", { scrollLeft: 48 }),
          },
          "scroll",
        ),
        h(
          "button",
          {
            class: "mock-data-table-header-dragend",
            type: "button",
            onClick: () => emit("header-dragend", 256, 220, { property: "target" }),
          },
          "drag",
        ),
        props.data.length === 0
          ? h("div", { class: "mock-data-table-empty" }, String(props.emptyText || ""))
          : h(
              "table",
              { class: "mock-data-table-table" },
              [
                h(
                  "thead",
                  h(
                    "tr",
                    columns.map((column: any) =>
                      h("th", { class: "mock-data-table-head", "data-prop": String(column.props?.prop || "") }, String(column.props?.label || "")),
                    ),
                  ),
                ),
                h(
                  "tbody",
                  (props.data as Array<Record<string, unknown>>).map((row) =>
                    h(
                      "tr",
                      {
                        class: "mock-data-table-row",
                        "data-log-id": String(row.logId || ""),
                      },
                      columns.map((column: any) => {
                        const slot = column.children && typeof column.children === "object" ? column.children.default : null;
                        const cell = typeof slot === "function" ? slot({ row }) : null;
                        return h(
                          "td",
                          {
                            class: "mock-data-table-cell",
                            "data-prop": String(column.props?.prop || ""),
                          },
                          cell,
                        );
                      }),
                    ),
                  ),
                ),
              ],
            ),
      ]);
    };
  },
});

const OptionBarStub = defineComponent({
  name: "OptionBar",
  props: {
    modelValue: {
      type: [String, Number, Boolean, Array, Object],
      default: "",
    },
    options: {
      type: Array,
      default: () => [],
    },
    label: {
      type: String,
      default: "",
    },
  },
  emits: ["update:modelValue", "change"],
  setup(props, { emit }) {
    return () =>
      h("label", { class: "mock-option-bar" }, [
        props.label ? h("span", { class: "mock-option-bar-label" }, String(props.label)) : null,
        h(
          "select",
          {
            class: "mock-option-bar-select",
            value: String(props.modelValue ?? ""),
            onChange: (event: Event) => {
              const value = (event.target as HTMLSelectElement).value;
              emit("update:modelValue", value);
              emit("change", value);
            },
          },
          (props.options as Array<{ value: string | number | boolean; label: string }>).map((option) =>
            h("option", { value: String(option.value) }, option.label),
          ),
        ),
      ]);
  },
});

const StatusPillStub = defineComponent({
  name: "StatusPill",
  props: {
    tone: {
      type: String,
      default: "",
    },
    label: {
      type: [String, Number],
      default: "",
    },
  },
  setup(props) {
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
});

function flush() {
  return nextTick().then(() => nextTick());
}

function makeRow(overrides: Partial<KnowledgeLogRow> = {}): KnowledgeLogRow {
  return {
    logId: "log-1",
    kindLabel: "任务",
    displayId: "display-1",
    target: "source-1",
    status: "done",
    statusLabel: "完成",
    tone: "success",
    stage: "ingest",
    occurredAt: "2026-06-04T10:03:04",
    createdAt: "2026-06-04T09:02:03",
    progressPercent: 66,
    detail: "initial detail",
    error: "",
    ...overrides,
  };
}

function createShellContext(overrides: Partial<{
  rows: KnowledgeLogRow[];
  filteredRows: KnowledgeLogRow[];
  open: boolean;
  visibleCount: number;
  activeCount: number;
}> = {}) {
  const rows = ref(overrides.rows ?? [makeRow()]);
  const filteredRows = ref(overrides.filteredRows ?? rows.value);

  return {
    adminView: ref("logs"),
    busyKey: ref(""),
    currentView: ref("admin"),
    error: ref(null),
    exportKnowledgeLogRows: vi.fn(),
    filteredKnowledgeLogRows: filteredRows,
    handleKnowledgeLogTableScroll: vi.fn(),
    isAuthenticated: ref(true),
    knowledgeLogAdvancedOpen: ref(overrides.open ?? false),
    knowledgeLogColumnWidths: ref({
      kind: 120,
      target: 220,
      status: 112,
      stage: 150,
      progress: 80,
      time: 122,
      detail: 220,
      error: 180,
    }),
    knowledgeLogFilters: ref({
      id: "",
      status: "",
      stage: "",
      from: "",
      to: "",
    }),
    knowledgeLogStatusOptionBarOptions: ref([
      { value: "", label: "全部状态" },
      { value: "完成", label: "完成" },
      { value: "失败", label: "失败" },
    ]),
    knowledgeLogTableShellRef: ref<HTMLElement | null>(null),
    monitorAlertSummary: {
      visibleCount: overrides.visibleCount ?? 0,
      activeCount: overrides.activeCount ?? 3,
    },
    workQueueSummary: { total: 7 },
    serverLogRows: rows,
  } as ShellContext;
}

function mountLogsView(shellContext: ShellContext) {
  shellContextState.current = shellContext;
  return mount(LogsView, {
    global: {
      stubs: {
        "el-table-column": defineComponent({
          name: "ElTableColumn",
          setup() {
            return () => null;
          },
        }),
        DataTable: DataTableStub,
        OptionBar: OptionBarStub,
        StatusPill: StatusPillStub,
      },
    },
  });
}

beforeEach(() => {
  shellContextState.current = null;
  vi.clearAllMocks();
});

afterEach(() => {
  shellContextState.current = null;
  document.body.innerHTML = "";
});

describe("LogsView extra coverage", () => {
  it("toggles advanced filters, updates bindings, renders log rows, and wires table actions", async () => {
    const row = makeRow({
      logId: "log-42",
      kindLabel: "知识库",
      displayId: "display-42",
      target: "workspace-42",
      stage: "review",
      occurredAt: "2026-06-04T10:03:04",
      createdAt: "2026-06-04T09:02:03",
      statusLabel: "完成",
      tone: "success",
      progressPercent: 77.4,
      detail: "ready for export",
      error: "timeout",
    });

    const shellContext = createShellContext({
      rows: [row],
      filteredRows: [row],
      visibleCount: 0,
      activeCount: 5,
    });
    const wrapper = mountLogsView(shellContext);

    expect(wrapper.get("h3").text()).toBe("日志记录");
    expect(wrapper.get(".section-tags").text()).toContain("总计 1");
    expect(wrapper.get(".section-tags").text()).toContain("显示 1");
    expect(wrapper.get(".section-tags").text()).toContain("队列 7");
    expect(wrapper.get(".section-tags").text()).toContain("报警 5");
    expect(wrapper.get(".source-actions button").text()).toBe("高级筛选");

    await wrapper.get(".source-actions button").trigger("click");
    await flush();

    expect(shellContext.knowledgeLogAdvancedOpen.value).toBe(true);
    expect(wrapper.get(".source-actions button").text()).toBe("收起筛选");
    expect(wrapper.find(".knowledge-log-filters").exists()).toBe(true);

    const idInput = wrapper.get('.knowledge-log-filters input[placeholder="筛选 ID / 对象"]');
    await idInput.setValue("log-42");
    await flush();
    expect(shellContext.knowledgeLogFilters.value.id).toBe("log-42");

    await wrapper.get(".mock-option-bar-select").setValue("失败");
    await flush();
    expect(shellContext.knowledgeLogFilters.value.status).toBe("失败");

    expect(wrapper.get(".knowledge-log-kind").text()).toBe("知识库");
    expect(wrapper.get(".knowledge-log-target .mono-compact").text()).toBe("log-42");
    expect(wrapper.get(".knowledge-log-target small").text()).toBe("workspace-42");
    expect(wrapper.get(".knowledge-log-target .mono-compact").attributes("title")).toBe("log-42");
    expect(wrapper.get(".knowledge-log-time").text()).toBe("06-04 10:03");
    expect(wrapper.get(".knowledge-log-time").attributes("title")).toBe("2026-06-04 10:03:04");
    expect(wrapper.get(".knowledge-log-status .mock-status-pill").text()).toBe("完成");
    expect(wrapper.get(".knowledge-log-status .mock-status-pill").attributes("data-tone")).toBe("success");
    expect(wrapper.get(".knowledge-log-progress").text()).toBe("77%");
    expect(wrapper.get(".knowledge-log-stage").text()).toBe("review");
    expect(wrapper.get(".knowledge-log-detail").text()).toBe("ready for export");
    expect(wrapper.get(".knowledge-log-error").text()).toBe("timeout");

    await wrapper.get(".mock-data-table-scroll").trigger("click");
    expect(shellContext.handleKnowledgeLogTableScroll).toHaveBeenCalledWith({ scrollLeft: 48 });

    await wrapper.get(".mock-data-table-header-dragend").trigger("click");
    expect(shellContext.knowledgeLogColumnWidths.value.target).toBe(256);

    await wrapper.get(".source-actions button:last-child").trigger("click");
    expect(shellContext.exportKnowledgeLogRows).toHaveBeenCalledTimes(1);

    await wrapper.get(".source-actions button").trigger("click");
    await flush();
    expect(shellContext.knowledgeLogAdvancedOpen.value).toBe(false);
    expect(wrapper.find(".knowledge-log-filters").exists()).toBe(false);
  });

  it("renders the empty state when no filtered rows are available", async () => {
    const shellContext = createShellContext({
      rows: [makeRow({ logId: "log-empty" })],
      filteredRows: [],
      open: true,
    });
    const wrapper = mountLogsView(shellContext);

    expect(wrapper.get(".mock-data-table-empty").text()).toBe("暂无系统日志");
    expect(wrapper.find(".mock-data-table-row").exists()).toBe(false);

    await wrapper.get(".source-actions button").trigger("click");
    await flush();
    expect(shellContext.knowledgeLogAdvancedOpen.value).toBe(false);
  });
});
