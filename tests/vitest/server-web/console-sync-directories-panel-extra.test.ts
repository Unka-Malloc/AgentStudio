// @vitest-environment jsdom
import { defineComponent, h, nextTick, ref } from "vue";
import { mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ConsoleSyncDirectoriesPanel from "../../../server-web/components/shell/ConsoleSyncDirectoriesPanel.vue";
import type { KnowledgeSource } from "../../../server-web/lib/types";

const shellContextState = vi.hoisted(() => ({
  current: null as any,
}));

vi.mock("../../../server-web/composables/serverConsoleShellContext", () => ({
  useServerConsoleShellContext: () => shellContextState.current,
}));

const mountedWrappers: VueWrapper[] = [];

const BrowseSelectButtonStub = defineComponent({
  name: "BrowseSelectButton",
  props: {
    buttonClass: String,
    buttonText: String,
    disabled: Boolean,
  },
  emits: ["browse"],
  setup(props, { emit }) {
    return () =>
      h(
        "button",
        {
          class: ["browse-select-button-stub", props.buttonClass],
          type: "button",
          disabled: !!props.disabled,
          onClick: () => {
            if (!props.disabled) {
              emit("browse");
            }
          },
        },
        props.buttonText || "浏览",
      );
  },
});

const BinaryCheckboxStub = defineComponent({
  name: "BinaryCheckbox",
  props: {
    disabled: Boolean,
    label: String,
    modelValue: Boolean,
  },
  emits: ["update:modelValue", "change"],
  setup(props, { emit }) {
    return () =>
      h(
        "button",
        {
          class: "binary-checkbox-stub",
          type: "button",
          role: "checkbox",
          "aria-checked": String(!!props.modelValue),
          disabled: !!props.disabled,
          onClick: () => {
            if (props.disabled) {
              return;
            }
            const nextValue = !props.modelValue;
            emit("update:modelValue", nextValue);
            emit("change", nextValue);
          },
        },
        props.label || "",
      );
  },
});

const StatusPillStub = defineComponent({
  name: "StatusPill",
  props: {
    label: [String, Number],
    tone: String,
  },
  setup(props) {
    return () =>
      h(
        "span",
        {
          class: "status-pill-stub",
          "data-tone": props.tone || "",
        },
        String(props.label ?? ""),
      );
  },
});

function makeSource(overrides: Partial<KnowledgeSource> = {}): KnowledgeSource {
  return {
    sourceId: "source-a",
    label: "公司共享资料",
    directoryPath: "/srv/company-share",
    enabled: true,
    autoSync: true,
    recursive: true,
    hydrationEnabled: true,
    status: "idle",
    watcherStatus: "watching",
    watcherCount: 2,
    lastFileCount: 12,
    lastTotalBytes: 1024 * 1024,
    lastScanAt: "2026-06-04T01:02:03.000Z",
    lastHydrationStatus: "hydrated",
    lastHydratedFileCount: 8,
    lastHydrationFailedCount: 0,
    indexStatus: "indexed",
    lastIndexedFileCount: 7,
    lastIndexFailedCount: 0,
    lastJobId: "job-1234567890abcdef",
    lastJobStatus: "running",
    lastJobStage: "syncing",
    lastJobProgressPercent: 37,
    lastSyncCheckpointTreeId: "sync-tree-1234567890abcdef",
    lastIndexCheckpointTreeId: "index-tree-1234567890abcdef",
    lastHydrationFailureSamples: [],
    error: "",
    ...overrides,
  } as KnowledgeSource;
}

function createShellContext(overrides: Record<string, unknown> = {}) {
  return {
    activeKnowledgeSources: ref<KnowledgeSource[]>([]),
    addKnowledgeSource: vi.fn(),
    busyKey: ref(""),
    canBrowseServerPaths: ref(true),
    canWriteJobs: ref(true),
    deleteKnowledgeSource: vi.fn(),
    localSourceForm: ref({
      label: "",
      directoryPath: "",
      autoSync: true,
      recursive: false,
      hydrationEnabled: true,
    }),
    openLocalSourceDirectoryPicker: vi.fn(),
    refreshKnowledgeSource: vi.fn(),
    syncLocalSourceLabelFromPath: vi.fn(),
    updateKnowledgeSource: vi.fn(),
    ...overrides,
  };
}

function mountPanel() {
  const wrapper = mount(ConsoleSyncDirectoriesPanel, {
    global: {
      stubs: {
        BinaryCheckbox: BinaryCheckboxStub,
        BrowseSelectButton: BrowseSelectButtonStub,
        StatusPill: StatusPillStub,
      },
    },
  });
  mountedWrappers.push(wrapper);
  return wrapper;
}

function findCardButton(card: ReturnType<VueWrapper["find"]>, label: string) {
  const button = card.findAll("button").find((item) => item.text().includes(label));
  if (!button) {
    throw new Error(`Missing button with label: ${label}`);
  }
  return button;
}

beforeEach(() => {
  vi.clearAllMocks();
  shellContextState.current = createShellContext();
});

afterEach(() => {
  while (mountedWrappers.length) {
    mountedWrappers.pop()?.unmount();
  }
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("ConsoleSyncDirectoriesPanel", () => {
  it("renders the empty state and blocks top-level actions when writes and browsing are unavailable", async () => {
    shellContextState.current = createShellContext({
      activeKnowledgeSources: ref([]),
      canBrowseServerPaths: ref(false),
      canWriteJobs: ref(false),
      busyKey: ref("knowledge:sources:add"),
    });

    const wrapper = mountPanel();

    expect(wrapper.get(".empty-state strong").text()).toBe("暂无目录");
    expect(wrapper.get(".path-action-button").attributes("disabled")).toBeDefined();
    expect(wrapper.get("button.primary-action").attributes("disabled")).toBeDefined();
    expect(wrapper.get("button.primary-action").text()).toBe("添加中");

    await wrapper.get(".path-action-button").trigger("click");
    await wrapper.get("button.primary-action").trigger("click");

    expect(shellContextState.current.openLocalSourceDirectoryPicker).not.toHaveBeenCalled();
    expect(shellContextState.current.addKnowledgeSource).not.toHaveBeenCalled();
  });

  it("renders sources, forwards form and row events, and reflects busy states", async () => {
    const sourceA = makeSource({
      sourceId: "source-a",
      label: "公司共享资料",
      directoryPath: "/srv/company-share",
      error: "目录读取失败",
      lastHydrationFailedCount: 2,
      lastHydrationFailureSamples: [
        { relativePath: "docs/report.md", reason: "缺少权限" },
        { relativePath: "notes/todo.md", reason: "未下载" },
      ],
      lastIndexError: "索引器返回超时",
      lastJobStatus: "completed",
      lastJobStage: "done",
    });
    const sourceB = makeSource({
      sourceId: "source-b",
      label: "项目文档",
      directoryPath: "/srv/project-docs",
      lastJobStatus: "queued",
      lastJobProgressPercent: 19,
      lastJobStage: "queued",
      lastHydrationFailedCount: 0,
      lastHydrationStatus: "readable",
      lastIndexedFileCount: 3,
      enabled: true,
      watcherStatus: "idle",
    });
    const sourceC = makeSource({
      sourceId: "source-c",
      label: "归档目录",
      directoryPath: "/srv/archive",
      enabled: false,
      watcherStatus: "idle",
      lastJobId: "",
      lastJobStatus: "",
      lastScanAt: "",
      hydrationEnabled: false,
      indexStatus: "indexed",
      lastHydrationStatus: "partial",
      lastHydratedFileCount: 0,
      lastIndexedFileCount: 0,
    });

    shellContextState.current = createShellContext({
      activeKnowledgeSources: ref([sourceA, sourceB, sourceC]),
      localSourceForm: ref({
        label: "",
        directoryPath: "",
        autoSync: true,
        recursive: false,
        hydrationEnabled: true,
      }),
    });

    const wrapper = mountPanel();
    const cards = wrapper.findAll(".knowledge-source-card");

    expect(cards).toHaveLength(3);
    expect(cards[0].text()).toContain("公司共享资料");
    expect(cards[0].text()).toContain("/srv/company-share");
    expect(cards[0].get(".status-pill-stub").attributes("data-tone")).toBe("danger");
    expect(cards[0].get(".status-pill-stub").text()).toBe("异常");
    expect(cards[0].text()).toContain("待下载：docs/report.md：缺少权限");
    expect(cards[0].text()).toContain("原文索引：索引器返回超时");
    expect(cards[0].get("progress").element.value).toBe(100);
    expect(cards[1].get(".status-pill-stub").attributes("data-tone")).toBe("warning");
    expect(cards[1].text()).toContain("2 个 / 1.0 MB");
    expect(cards[1].text()).toContain("3 文件");
    expect(cards[1].get("progress").element.value).toBe(19);
    expect(cards[2].get(".status-pill-stub").attributes("data-tone")).toBe("neutral");
    expect(cards[2].get(".status-pill-stub").text()).toBe("已停用");
    expect(cards[2].text()).toContain("已关闭 / 0 可入库");
    expect(cards[2].text()).toContain("未记录");
    expect(cards[2].text()).toContain("无");

    const browseButton = wrapper.get(".path-action-button");
    await browseButton.trigger("click");
    expect(shellContextState.current.openLocalSourceDirectoryPicker).toHaveBeenCalledTimes(1);

    const pathInput = wrapper.get(".source-path-field input");
    await pathInput.setValue("/srv/new-source");
    expect(shellContextState.current.localSourceForm.value.directoryPath).toBe("/srv/new-source");
    expect(shellContextState.current.syncLocalSourceLabelFromPath).toHaveBeenCalledTimes(1);

    const checkboxes = wrapper.findAll(".binary-checkbox-stub");
    await checkboxes[0].trigger("click");
    await nextTick();
    await checkboxes[1].trigger("click");
    await nextTick();
    await checkboxes[2].trigger("click");
    await nextTick();
    expect(shellContextState.current.localSourceForm.value).toMatchObject({
      autoSync: false,
      recursive: true,
      hydrationEnabled: false,
    });

    await wrapper.get("form").trigger("submit");
    expect(shellContextState.current.addKnowledgeSource).toHaveBeenCalledTimes(1);

    await findCardButton(cards[0], "同步目录").trigger("click");
    expect(shellContextState.current.refreshKnowledgeSource).toHaveBeenCalledWith(sourceA);

    await findCardButton(cards[0], "重新整理").trigger("click");
    expect(shellContextState.current.refreshKnowledgeSource).toHaveBeenCalledWith(sourceA, true);

    await findCardButton(cards[0], "暂停").trigger("click");
    expect(shellContextState.current.updateKnowledgeSource).toHaveBeenCalledWith(sourceA, { enabled: false });

    await findCardButton(cards[0], "删除").trigger("click");
    expect(shellContextState.current.deleteKnowledgeSource).toHaveBeenCalledWith(sourceA);

    await findCardButton(cards[2], "启用").trigger("click");
    expect(shellContextState.current.updateKnowledgeSource).toHaveBeenCalledWith(sourceC, { enabled: true });

    shellContextState.current.busyKey.value = "knowledge:sources:add";
    await nextTick();
    expect(wrapper.get("button.primary-action").attributes("disabled")).toBeDefined();
    expect(wrapper.get("button.primary-action").text()).toBe("添加中");

    shellContextState.current.busyKey.value = "knowledge:source:refresh:source-a";
    await nextTick();
    expect(findCardButton(cards[0], "同步目录").attributes("disabled")).toBeDefined();
    expect(findCardButton(cards[0], "重新整理").attributes("disabled")).toBeDefined();

    shellContextState.current.busyKey.value = "knowledge:source:source-a";
    await nextTick();
    expect(findCardButton(cards[0], "暂停").attributes("disabled")).toBeDefined();

    shellContextState.current.busyKey.value = "knowledge:source:delete:source-a";
    await nextTick();
    expect(findCardButton(cards[0], "删除").attributes("disabled")).toBeDefined();

    shellContextState.current.canBrowseServerPaths.value = false;
    await nextTick();
    expect(wrapper.get(".path-action-button").attributes("disabled")).toBeDefined();
  });
});
