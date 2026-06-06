// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import KnowledgeDistillationRunOverview from "../../../server-web/components/knowledge-distillation/KnowledgeDistillationRunOverview.vue";

function run(overrides: Record<string, unknown> = {}) {
  return {
    runId: "run-1",
    title: "Alpha run",
    jobId: "job-1",
    status: "running",
    updatedAt: "2026-06-04T00:00:00.000Z",
    progressPercent: 42,
    storage: {
      rootRelativePath: "runs/run-1",
      checkpointFile: "checkpoint.json",
    },
    waitingFor: { reviewer: "alice" },
    modelAlias: "summary-model",
    priority: "high",
    taskManagement: {
      queue: "distillation",
      worker: "worker-a",
    },
    error: "",
    ...overrides,
  } as any;
}

function mountOverview(props: Record<string, unknown> = {}) {
  const selectedRun = run(props.selectedRun as Record<string, unknown>);
  return mount(KnowledgeDistillationRunOverview, {
    props: {
      activeRunProgress: 42,
      busy: "",
      compareResult: { summary: { changed: true } },
      compareRightRunId: "run-2",
      formatCompactDate: (value: string) => value ? `date:${value.slice(0, 10)}` : "date:none",
      packageHref: "/api/package/run-1",
      runs: [
        selectedRun,
        run({ runId: "run-2", title: "Beta run", updatedAt: "2026-06-03T00:00:00.000Z" }),
      ],
      selectedRun,
      ...props,
    },
    global: {
      stubs: {
        BridgeDownloadButton: {
          props: ["href", "label", "buttonClass"],
          template: "<a class=\"download-stub\" :href=\"href\" :class=\"buttonClass\">{{ label }}</a>",
        },
        StatusPill: {
          props: ["tone", "label"],
          template: "<span class=\"status-stub\" :data-tone=\"tone\">{{ label }}</span>",
        },
      },
    },
  });
}

describe("KnowledgeDistillationRunOverview extra coverage", () => {
  it("renders selected run metadata, defaults, comparison preview, and emits actions", async () => {
    const wrapper = mountOverview();

    expect(wrapper.text()).toContain("Alpha run");
    expect(wrapper.text()).toContain("run-1 · Job job-1");
    expect(wrapper.text()).toContain("date:2026-06-04");
    expect(wrapper.find(".status-stub").attributes("data-tone")).toBe("warning");
    expect(wrapper.find("progress").attributes("value")).toBe("42");
    expect(wrapper.text()).toContain("runs/run-1");
    expect(wrapper.text()).toContain("checkpoint.json");
    expect(wrapper.text()).toContain(JSON.stringify({ reviewer: "alice" }));
    expect(wrapper.text()).toContain("summary-model · high");
    expect(wrapper.text()).toContain("distillation · worker-a");
    expect(wrapper.find(".download-stub").attributes("href")).toBe("/api/package/run-1");
    expect(wrapper.find("pre").text()).toContain("\"changed\": true");

    const buttons = wrapper.findAll("button");
    await buttons.find((button) => button.text() === "继续任务")?.trigger("click");
    await buttons.find((button) => button.text() === "取消")?.trigger("click");
    await buttons.find((button) => button.text() === "归档")?.trigger("click");
    await buttons.find((button) => button.text() === "删除")?.trigger("click");
    await buttons.find((button) => button.text() === "比较版本")?.trigger("click");

    expect(wrapper.emitted("resume")).toHaveLength(1);
    expect(wrapper.emitted("cancel")).toHaveLength(1);
    expect(wrapper.emitted("archive")).toHaveLength(1);
    expect(wrapper.emitted("delete")).toHaveLength(1);
    expect(wrapper.emitted("compare")).toHaveLength(1);

    await wrapper.find("select").setValue("run-2");
    expect(wrapper.emitted("update:compareRightRunId")).toEqual([["run-2"]]);
    expect(wrapper.findAll("option").map((option) => option.text())).toContain("Beta run · date:2026-06-03");
  });

  it("applies disabled and fallback display branches for busy, completed, single-run, and error states", () => {
    const wrapper = mountOverview({
      activeRunProgress: 0,
      busy: "resume",
      compareResult: null,
      compareRightRunId: "",
      runs: [run({ runId: "run-1" })],
      selectedRun: {
        status: "completed",
        jobId: "",
        updatedAt: "",
        storage: {},
        waitingFor: null,
        modelAlias: "",
        priority: "",
        taskManagement: {},
        error: "failed reason",
      },
    });

    expect(wrapper.text()).toContain("Job n/a");
    expect(wrapper.text()).toContain("knowledge-distillation-workbench");
    expect(wrapper.text()).toContain("run.json");
    expect(wrapper.text()).toContain("无");
    expect(wrapper.text()).toContain("未记录模型 · normal");
    expect(wrapper.text()).toContain("queue-monitor · workbench");
    expect(wrapper.text()).toContain("failed reason");
    expect(wrapper.find("progress").attributes("value")).toBe("0");
    expect(wrapper.find("pre").exists()).toBe(false);
    expect(wrapper.find("select").exists()).toBe(false);

    const resumeButton = wrapper.findAll("button").find((button) => button.text() === "恢复中");
    expect(resumeButton?.attributes("disabled")).toBeDefined();

    const cancelButton = wrapper.findAll("button").find((button) => button.text() === "取消");
    expect(cancelButton?.attributes("disabled")).toBeDefined();
  });
});
