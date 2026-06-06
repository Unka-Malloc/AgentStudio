// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { computed, defineComponent, h, nextTick, ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SourceCard from "../../../server-web/components/sources/SourceCard.vue";

const sourcesContextMock = vi.hoisted(() => ({
  current: null as Record<string, unknown> | null,
}));

vi.mock("../../../server-web/composables/sourcesViewContext", () => ({
  useSourcesViewContext: () => sourcesContextMock.current,
}));

const StatusPillStub = defineComponent({
  name: "StatusPill",
  props: {
    label: String,
    tone: String,
  },
  setup(props) {
    return () => h("span", { class: "status-pill-stub", "data-tone": props.tone || "" }, props.label || "");
  },
});

function makeSource(overrides: Record<string, unknown> = {}) {
  return {
    createdAt: "2026-06-04T08:00:00.000Z",
    directoryPath: "/data/cases",
    enabled: true,
    error: "",
    indexStatus: "indexed",
    label: "案件目录",
    lastFileCount: 3,
    lastHydratedFileCount: 2,
    lastHydrationFailedCount: 0,
    lastHydrationFailureSamples: [],
    lastIndexCheckpointTreeId: "checkpoint-index-abcdef1234567890",
    lastIndexFailedCount: 0,
    lastIndexedFileCount: 3,
    lastJobId: "job-abcdef1234567890",
    lastJobProgressPercent: 48,
    lastJobStage: "解析中",
    lastJobStatus: "running",
    lastScanAt: "2026-06-04T10:00:00.000Z",
    lastSyncCheckpointTreeId: "checkpoint-sync-abcdef1234567890",
    lastTotalBytes: 2048,
    sourceId: "source-a",
    status: "active",
    watcherCount: 1,
    watcherStatus: "watching",
    ...overrides,
  } as any;
}

function makeContext(overrides: Record<string, unknown> = {}) {
  const busy = ref("");
  return {
    busy,
    context: {
      busyKey: computed(() => busy.value),
      deleteKnowledgeSource: vi.fn(),
      refreshKnowledgeSource: vi.fn(),
      updateKnowledgeSource: vi.fn(),
      ...overrides,
    },
  };
}

function mountCard(source = makeSource(), contextOverrides: Record<string, unknown> = {}) {
  const harness = makeContext(contextOverrides);
  sourcesContextMock.current = harness.context;
  const wrapper = mount(SourceCard, {
    global: {
      stubs: {
        StatusPill: StatusPillStub,
      },
    },
    props: {
      source,
    },
  });
  return { ...harness, source, wrapper };
}

beforeEach(() => {
  sourcesContextMock.current = null;
});

describe("SourceCard extra coverage", () => {
  it("renders source metadata, progress, checkpoint ids, and actions", async () => {
    const { context, source, wrapper } = mountCard();

    expect(wrapper.text()).toContain("案件目录");
    expect(wrapper.text()).toContain("/data/cases");
    expect(wrapper.find(".status-pill-stub").attributes("data-tone")).toBe("warning");
    expect(wrapper.find(".status-pill-stub").text()).toBe("处理中");
    expect(wrapper.text()).toContain("3 个 / 2.0 KB");
    expect(wrapper.text()).toContain("watching / 1");
    expect(wrapper.text()).toContain("未执行 / 2 可入库");
    expect(wrapper.text()).toContain("已建索引 / 3 文件");
    expect(wrapper.text()).toContain("job-abcdef1234567890");
    expect(wrapper.text()).toContain("checkpoi…7890");
    expect(wrapper.text()).toContain("运行中");
    expect(wrapper.text()).toContain("解析中");
    expect(wrapper.find("progress").attributes("value")).toBe("48");

    const buttons = wrapper.findAll("button");
    await buttons[0].trigger("click");
    await buttons[1].trigger("click");
    await buttons[2].trigger("click");
    await buttons[3].trigger("click");

    expect(context.refreshKnowledgeSource).toHaveBeenNthCalledWith(1, source);
    expect(context.refreshKnowledgeSource).toHaveBeenNthCalledWith(2, source, true);
    expect(context.updateKnowledgeSource).toHaveBeenCalledWith(source, { enabled: false });
    expect(context.deleteKnowledgeSource).toHaveBeenCalledWith(source);
  });

  it("renders warning and error details and toggles disabled source back on", async () => {
    const source = makeSource({
      enabled: false,
      error: "目录不可读",
      indexStatus: "failed",
      lastHydrationFailedCount: 2,
      lastHydrationFailureSamples: [
        { reason: "missing", relativePath: "a.pdf" },
        { reason: "", relativePath: "b.pdf" },
        { reason: "offline", relativePath: "" },
        { reason: "ignored", relativePath: "d.pdf" },
      ],
      lastIndexError: "索引失败",
      lastJobId: "",
      lastScanAt: "",
      lastTotalBytes: 0,
      status: "pending",
      watcherCount: 0,
      watcherStatus: "error",
    });
    const { context, wrapper } = mountCard(source);

    expect(wrapper.find(".status-pill-stub").attributes("data-tone")).toBe("danger");
    expect(wrapper.find(".status-pill-stub").text()).toBe("异常");
    expect(wrapper.text()).toContain("最近扫描");
    expect(wrapper.text()).toContain("未记录");
    expect(wrapper.text()).toContain("待下载：a.pdf：missing；b.pdf：未下载；文件：offline");
    expect(wrapper.text()).not.toContain("d.pdf");
    expect(wrapper.text()).toContain("原文索引：索引失败");
    expect(wrapper.text()).toContain("目录不可读");
    expect(wrapper.find("progress").exists()).toBe(false);

    await wrapper.findAll("button")[2].trigger("click");
    expect(context.updateKnowledgeSource).toHaveBeenCalledWith(source, { enabled: true });
  });

  it("disables buttons based on busy keys", async () => {
    const refreshHarness = mountCard();
    refreshHarness.busy.value = "knowledge:source:refresh:source-a";
    await nextTick();
    expect(refreshHarness.wrapper.findAll("button").slice(0, 2).map((button) => button.attributes("disabled"))).toEqual(["", ""]);

    const updateHarness = mountCard();
    updateHarness.busy.value = "knowledge:source:source-a";
    await nextTick();
    expect(updateHarness.wrapper.findAll("button")[2].attributes("disabled")).toBeDefined();

    const deleteHarness = mountCard();
    deleteHarness.busy.value = "knowledge:source:delete:source-a";
    await nextTick();
    expect(deleteHarness.wrapper.findAll("button")[3].attributes("disabled")).toBeDefined();
  });
});
