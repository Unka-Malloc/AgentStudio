// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { h, nextTick } from "vue";

import HelpTooltip from "../../../server-web/components/HelpTooltip.vue";
import KnowledgeImportCard from "../../../server-web/components/KnowledgeImportCard.vue";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

function rect(top: number, bottom: number, left: number, right: number) {
  return {
    top,
    bottom,
    left,
    right,
    width: right - left,
    height: bottom - top,
    x: left,
    y: top,
    toJSON() {
      return this;
    },
  };
}

async function flushTooltipPosition() {
  await nextTick();
  await nextTick();
}

describe("HelpTooltip", () => {
  it("normalizes text and item content, positions below, and removes listeners on hide", async () => {
    vi.spyOn(window, "addEventListener");
    vi.spyOn(window, "removeEventListener");
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 420 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 520 });

    const wrapper = mount(HelpTooltip, {
      attachTo: document.body,
      props: {
        align: "end",
        ariaLabel: "字段说明",
        maxWidth: 240,
        text: "主说明",
        items: [
          ["元数据", "用于归档"],
          { label: "权限", description: "只读" },
          { title: "", description: "" },
        ],
      },
    });
    const trigger = wrapper.get("button");
    Object.defineProperty(trigger.element, "getBoundingClientRect", {
      configurable: true,
      value: () => rect(40, 60, 280, 320),
    });

    await trigger.trigger("focus");
    await flushTooltipPosition();

    const popover = document.body.querySelector(".help-tooltip-popover") as HTMLElement;
    expect(popover).toBeTruthy();
    expect(popover.textContent).toContain("主说明");
    expect(popover.textContent).toContain("元数据");
    expect(popover.textContent).toContain("权限");
    expect(popover.className).toContain("is-below");
    expect(popover.style.getPropertyValue("--help-tooltip-width")).toBe("240px");
    expect(popover.style.left).toBe("80px");
    expect(popover.style.top).toBe("68px");
    expect(trigger.attributes("aria-label")).toBe("字段说明");
    expect(trigger.attributes("aria-describedby")).toMatch(/^help-tooltip-/);
    expect(window.addEventListener).toHaveBeenCalledWith("resize", expect.any(Function));
    expect(window.addEventListener).toHaveBeenCalledWith("scroll", expect.any(Function), true);

    await trigger.trigger("blur");
    await nextTick();
    expect(document.body.querySelector(".help-tooltip-popover")).toBeNull();
    expect(window.removeEventListener).toHaveBeenCalledWith("resize", expect.any(Function));
    expect(window.removeEventListener).toHaveBeenCalledWith("scroll", expect.any(Function), true);
  });

  it("uses slot content, positions above when lower space is constrained, and stays hidden without content", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 360 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 240 });
    const wrapper = mount(HelpTooltip, {
      attachTo: document.body,
      props: { maxWidth: 320 },
      slots: {
        default: "<span class=\"slot-help\">插槽说明</span>",
      },
    });
    const trigger = wrapper.get("button");
    Object.defineProperty(trigger.element, "getBoundingClientRect", {
      configurable: true,
      value: () => rect(180, 202, 20, 42),
    });

    await trigger.trigger("mouseenter");
    await flushTooltipPosition();
    const popover = document.body.querySelector(".help-tooltip-popover") as HTMLElement;
    expect(popover.className).toContain("is-above");
    expect(popover.textContent).toContain("插槽说明");
    expect(popover.style.top).toBe("172px");

    wrapper.unmount();
    const empty = mount(HelpTooltip, {
      attachTo: document.body,
      props: { text: "   ", items: [{ title: "", description: "" }] },
    });
    await empty.get("button").trigger("focus");
    await flushTooltipPosition();
    expect(document.body.querySelector(".help-tooltip-popover")).toBeNull();
  });
});

function mountKnowledgeImportCard(props: Record<string, unknown> = {}) {
  return mount(KnowledgeImportCard, {
    props: {
      canReadKnowledge: true,
      canWriteJobs: true,
      busyKey: "",
      modeLabel: "本地导入",
      modeDescription: "支持文件和目录",
      ingestProgress: "",
      ingestJob: null,
      normalizedManifest: null,
      jobStatusLabels: { completed: "已完成", running: "运行中" },
      jobStatusTone: (status: string) => (status === "completed" ? "success" : "info"),
      formatBytes: (bytes: number) => `${bytes} B`,
      ...props,
    },
    global: {
      stubs: {
        BridgeDownloadButton: {
          props: ["href", "label", "buttonClass"],
          template: "<a :class=\"buttonClass\" :href=\"href\">{{ label }}</a>",
        },
        BrowseSelectButton: {
          props: ["buttonText", "disabled"],
          emits: ["select"],
          setup(props: any, { emit }: any) {
            return () => h(
              "button",
              {
                class: "browse-stub",
                disabled: props.disabled,
                onClick: () => emit("select", [{ name: "picked.txt" }]),
              },
              props.buttonText,
            );
          },
        },
        StatusPill: {
          props: ["tone", "label"],
          template: "<span class=\"status-pill-stub\" :data-tone=\"tone\">{{ label }}</span>",
        },
      },
    },
  });
}

function dragPayload(files: File[] = []) {
  return {
    dataTransfer: {
      types: ["Files"],
      files,
      dropEffect: "move",
    },
  };
}

describe("KnowledgeImportCard", () => {
  it("handles drag state, dropped files, browse selection, and upload emit", async () => {
    const wrapper = mountKnowledgeImportCard();
    const card = wrapper.get("article");

    await card.trigger("dragenter", dragPayload());
    expect(card.classes()).toContain("active");
    await card.trigger("dragover", dragPayload());
    expect((wrapper.emitted("select") || []).length).toBe(0);

    const inner = document.createElement("span");
    card.element.appendChild(inner);
    await card.trigger("dragleave", { relatedTarget: inner });
    expect(card.classes()).toContain("active");

    const dropped = new File(["body"], "evidence.txt", { type: "text/plain" });
    await card.trigger("drop", dragPayload([dropped]));
    expect(card.classes()).not.toContain("active");
    expect(wrapper.emitted("select")?.at(-1)?.[0]).toEqual([dropped]);

    await wrapper.findAll(".browse-stub")[0].trigger("click");
    expect((wrapper.emitted("select")?.at(-1)?.[0] as File[])[0].name).toBe("picked.txt");

    await wrapper.get(".knowledge-import-submit").trigger("click");
    expect(wrapper.emitted("upload")).toHaveLength(1);
  });

  it("renders busy/permission states, ingest status, normalized documents, and export links", async () => {
    const wrapper = mountKnowledgeImportCard({
      canReadKnowledge: true,
      canWriteJobs: false,
      busyKey: "knowledge:ingest",
      ingestProgress: "正在解析 2 个文件",
      ingestJob: {
        id: "job-1",
        status: "running",
        stage: "",
        progressPercent: 42,
      },
      normalizedManifest: {
        batchId: "batch-1",
        documents: [{
          documentId: "doc-1",
          title: "报告",
          granularity: "document",
          byteSize: 12,
        }],
        sourceMaterials: [{
          documentId: "src-1",
          title: "原文",
          granularity: "source",
          byteSize: 8,
        }],
      },
    });

    expect(wrapper.text()).toContain("解析中");
    expect(wrapper.text()).toContain("正在解析 2 个文件");
    expect(wrapper.text()).toContain("job-1");
    expect(wrapper.text()).toContain("等待开始");
    expect(wrapper.get("progress").attributes("value")).toBe("42");
    expect(wrapper.get(".status-pill-stub").attributes("data-tone")).toBe("info");
    expect(wrapper.findAll(".browse-stub").every((button) => button.attributes("disabled") !== undefined)).toBe(true);
    expect(wrapper.get(".knowledge-import-submit").attributes("disabled")).not.toBeUndefined();

    const links = wrapper.findAll("a");
    expect(links.map((link) => link.text())).toEqual(expect.arrayContaining(["报告", "原文", "导出知识库"]));
    expect(links.map((link) => link.attributes("href"))).toEqual(expect.arrayContaining([
      "/api/jobs/batch-1/normalized-documents/doc-1",
      "/api/jobs/batch-1/normalized-documents/src-1",
      "/api/knowledge/export/docx",
    ]));

    await wrapper.get("select").setValue("markdown");
    expect(wrapper.findAll("a").map((link) => link.attributes("href"))).toContain("/api/knowledge/export/markdown");
  });

  it("shows disabled export fallback when read permission is absent and ignores non-file drags", async () => {
    const wrapper = mountKnowledgeImportCard({ canReadKnowledge: false });
    const card = wrapper.get("article");

    await card.trigger("dragenter", { dataTransfer: { types: ["text/plain"], files: [] } });
    expect(card.classes()).not.toContain("active");
    expect(wrapper.find("a").exists()).toBe(false);
    expect(wrapper.find(".knowledge-import-export-row button[disabled]").text()).toBe("导出知识库");
  });
});
