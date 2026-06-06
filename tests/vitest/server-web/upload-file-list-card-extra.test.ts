// @vitest-environment jsdom
import { mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { afterEach, describe, expect, it } from "vitest";
import UploadFileListCard from "../../../server-web/components/UploadFileListCard.vue";
import type { SplitJob } from "../../../server-web/lib/types";

const mounted: VueWrapper[] = [];

function makeFile(name: string, size: number, relativePath = name) {
  const file = new File([new Uint8Array(size)], name, { lastModified: 1_710_000_000_000 });
  Object.defineProperty(file, "webkitRelativePath", {
    configurable: true,
    value: relativePath,
  });
  return file;
}

const UploadSplitButtonStub = defineComponent({
  name: "UploadSplitButton",
  props: {
    disabled: Boolean,
  },
  emits: ["select"],
  setup(props, { emit }) {
    return () =>
      h(
        "button",
        {
          class: "upload-split-stub",
          disabled: props.disabled,
          type: "button",
          onClick: () => emit("select", [makeFile("chosen.md", 6, "picked/chosen.md")]),
        },
        "select files",
      );
  },
});

const UploadFileListRowStub = defineComponent({
  name: "UploadFileListRow",
  props: {
    entry: Object,
    fileIconUrl: String,
    formatBytes: Function,
    mode: String,
    progressState: Object,
    progressStepLabels: Array,
    totalProgressSteps: Number,
  },
  setup(props) {
    return () => {
      const entry = props.entry as Record<string, unknown>;
      const progressState = props.progressState as Record<string, unknown>;
      return h(
        "div",
        {
          class: "upload-row-stub",
          "data-completed": String(progressState.completedSteps),
          "data-detail": String(progressState.detail),
          "data-mode": props.mode,
          "data-path": String(entry.relativePath),
          "data-tone": String(progressState.tone),
        },
        `${entry.name}:${progressState.label}`,
      );
    };
  },
});

function mountCard(props: Record<string, unknown> = {}) {
  const wrapper = mount(UploadFileListCard, {
    global: {
      stubs: {
        UploadFileListRow: UploadFileListRowStub,
        UploadSplitButton: UploadSplitButtonStub,
      },
    },
    props,
  });
  mounted.push(wrapper);
  return wrapper;
}

function findButton(wrapper: VueWrapper, text: string) {
  const button = wrapper.findAll("button").find((candidate) => candidate.text() === text);
  if (!button) {
    throw new Error(`button not found: ${text}`);
  }
  return button;
}

afterEach(() => {
  while (mounted.length > 0) {
    mounted.pop()?.unmount();
  }
});

describe("UploadFileListCard extra coverage", () => {
  it("renders upload entries and forwards select, preview, and upload events", async () => {
    const wrapper = mountCard({
      canSubmit: true,
      canWriteJobs: true,
      files: [makeFile("report.txt", 4, "cases/report.txt")],
      formatBytes: (bytes: number) => `${bytes} bytes`,
    });

    const row = wrapper.find(".upload-row-stub");
    expect(wrapper.attributes("data-mode")).toBe("upload");
    expect(wrapper.text()).toContain("1 个文件 · 4 bytes");
    expect(row.attributes("data-mode")).toBe("upload");
    expect(row.attributes("data-path")).toBe("cases/report.txt");
    expect(row.attributes("data-completed")).toBe("1");
    expect(row.attributes("data-detail")).toBe("等待入库");
    expect(row.text()).toContain("待处理");

    await wrapper.find(".upload-split-stub").trigger("click");
    await findButton(wrapper, "预览解析").trigger("click");
    await findButton(wrapper, "开始入库").trigger("click");

    expect(wrapper.emitted("select")?.[0][0]).toEqual([expect.objectContaining({ name: "chosen.md" })]);
    expect(wrapper.emitted("preview")).toHaveLength(1);
    expect(wrapper.emitted("upload")).toHaveLength(1);
  });

  it("disables file choices and actions while an ingest job is busy", () => {
    const wrapper = mountCard({
      busyKey: "knowledge:ingest",
      canSubmit: true,
      canWriteJobs: true,
      files: [makeFile("source.pdf", 10)],
      ingestProgress: "排队中",
    });

    const splitButton = wrapper.find(".upload-split-stub");
    const row = wrapper.find(".upload-row-stub");
    expect(splitButton.attributes("disabled")).toBeDefined();
    expect(findButton(wrapper, "预览解析").attributes("disabled")).toBeDefined();
    expect(findButton(wrapper, "入库中").attributes("disabled")).toBeDefined();
    expect(row.attributes("data-completed")).toBe("2");
    expect(row.attributes("data-detail")).toBe("排队中");
    expect(row.text()).toContain("上传中");
  });

  it("shows the current ingest job and completed progress tone", () => {
    const ingestJob: SplitJob = {
      createdAt: "2026-06-04T00:00:00.000Z",
      id: "job-complete",
      progressPercent: 100,
      stage: "完成阶段",
      status: "completed",
      updatedAt: "2026-06-04T00:01:00.000Z",
    };
    const wrapper = mountCard({
      canSubmit: true,
      canWriteJobs: true,
      files: [makeFile("done.csv", 12)],
      ingestJob,
      jobStatusLabels: { completed: "已结束" },
      jobStatusTone: (status: string) => status === "completed" ? "success" : "neutral",
    });

    const row = wrapper.find(".upload-row-stub");
    expect(wrapper.text()).toContain("任务 job-complete");
    expect(row.attributes("data-completed")).toBe("5");
    expect(row.attributes("data-detail")).toBe("完成阶段");
    expect(row.attributes("data-tone")).toBe("success");
    expect(row.text()).toContain("已结束");
  });

  it("renders download results without upload controls", () => {
    const wrapper = mountCard({
      formatBytes: (bytes: number) => `${bytes} B`,
      mode: "download",
      resultFiles: [
        { href: "/download/bundle.zip", name: "bundle.zip", size: 2048 },
        { name: "notes", relativePath: "reports/notes", size: 0 },
      ],
    });
    const rows = wrapper.findAll(".upload-row-stub");

    expect(wrapper.attributes("data-mode")).toBe("download");
    expect(wrapper.text()).toContain("2 个文件 · 2048 B");
    expect(wrapper.find(".upload-split-stub").exists()).toBe(false);
    expect(wrapper.find(".upload-file-list-footer").exists()).toBe(false);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.attributes("data-mode"))).toEqual(["download", "download"]);
    expect(rows.map((row) => row.attributes("data-path"))).toEqual(["bundle.zip", "reports/notes"]);
  });

  it("keeps the empty upload state inert", () => {
    const wrapper = mountCard({
      canWriteJobs: false,
      summary: "手动摘要",
      title: "自定义列表",
    });

    expect(wrapper.text()).toContain("自定义列表");
    expect(wrapper.text()).toContain("手动摘要");
    expect(wrapper.text()).toContain("暂无文件");
    expect(wrapper.find(".upload-row-stub").exists()).toBe(false);
    expect(wrapper.find(".upload-split-stub").attributes("disabled")).toBeDefined();
    expect(findButton(wrapper, "预览解析").attributes("disabled")).toBeDefined();
    expect(findButton(wrapper, "开始入库").attributes("disabled")).toBeDefined();
    expect(wrapper.text()).toContain("等待开始");
  });
});
