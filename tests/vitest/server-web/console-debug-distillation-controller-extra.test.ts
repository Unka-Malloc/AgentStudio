// @vitest-environment jsdom
import { defineComponent, nextTick, ref } from "vue";
import { mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDebugDistillationController } from "../../../server-web/composables/console-debug-distillation-controller";

const apiMocks = vi.hoisted(() => ({
  createJob: vi.fn(),
  createKnowledgeDistillationWorkbenchRun: vi.fn(),
  createKnowledgeUploadSession: vi.fn(),
  getJob: vi.fn(),
  getKnowledgeDistillationWorkbenchRun: vi.fn(),
  getKnowledgeDistillationWorkbenchRunArtifacts: vi.fn(),
  getSettings: vi.fn(),
  waitForConsoleDelay: vi.fn(async () => undefined),
}));

vi.mock("../../../server-web/lib/agent-settings-client", () => ({
  getSettings: apiMocks.getSettings,
}));

vi.mock("../../../server-web/lib/jobs-client", () => ({
  createJob: apiMocks.createJob,
  getJob: apiMocks.getJob,
}));

vi.mock("../../../server-web/lib/knowledge-distillation-workbench", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../server-web/lib/knowledge-distillation-workbench")>();
  return {
    ...actual,
    createKnowledgeDistillationWorkbenchRun: apiMocks.createKnowledgeDistillationWorkbenchRun,
    getKnowledgeDistillationWorkbenchRun: apiMocks.getKnowledgeDistillationWorkbenchRun,
    getKnowledgeDistillationWorkbenchRunArtifacts: apiMocks.getKnowledgeDistillationWorkbenchRunArtifacts,
  };
});

vi.mock("../../../server-web/lib/knowledge-upload-session", () => ({
  createKnowledgeUploadSession: apiMocks.createKnowledgeUploadSession,
}));

vi.mock("../../../server-web/composables/console-timer-controller", () => ({
  waitForConsoleDelay: apiMocks.waitForConsoleDelay,
}));

const mountedWrappers: VueWrapper[] = [];

function flush() {
  return nextTick().then(() => Promise.resolve()).then(() => nextTick());
}

function mountControllerHarness(
  modelOptions = ref([
    { value: "model-a", label: "Model A", enabled: false },
    { value: "model-b", label: "Model B", enabled: true },
  ]),
) {
  let controller!: ReturnType<typeof useDebugDistillationController>;
  const Host = defineComponent({
    name: "DebugDistillationControllerHost",
    setup() {
      controller = useDebugDistillationController({ infoFeedModelOptions: modelOptions });
      return () => null;
    },
  });

  const wrapper = mount(Host);
  mountedWrappers.push(wrapper);
  return { controller, modelOptions, wrapper };
}

function makeCompletedRun(runId = "run-1") {
  return {
    runId,
    title: "report.final.md 知识蒸馏",
    status: "completed",
    stages: [
      {
        stageId: "knowledge-distillation",
        status: "completed",
        output: {
          markdown: "# Done\n",
          markdownLength: 7,
          json: { summary: "done" },
        },
      },
    ],
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  apiMocks.createJob.mockResolvedValue({ id: "job-1", status: "completed", stage: "done" } as never);
  apiMocks.createKnowledgeDistillationWorkbenchRun.mockResolvedValue({
    runId: "run-1",
    status: "running",
    stages: [],
  } as never);
  apiMocks.createKnowledgeUploadSession.mockResolvedValue({ session: { sessionId: "session-1" } } as never);
  apiMocks.getJob.mockResolvedValue({ id: "job-1", status: "completed", stage: "done" } as never);
  apiMocks.getKnowledgeDistillationWorkbenchRun.mockResolvedValue(makeCompletedRun() as never);
  apiMocks.getKnowledgeDistillationWorkbenchRunArtifacts.mockResolvedValue({
    items: [],
  } as never);
  apiMocks.getSettings.mockResolvedValue({ settings: { ok: true } } as never);
  apiMocks.waitForConsoleDelay.mockResolvedValue(undefined);
});

afterEach(() => {
  while (mountedWrappers.length) {
    mountedWrappers.pop()?.unmount();
  }
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("console debug distillation controller", () => {
  it("normalizes model selection and resets the form when files change", async () => {
    const { controller } = mountControllerHarness();
    await flush();

    expect(controller.distillationModelAlias.value).toBe("model-b");
    expect(controller.distillationModelReady.value).toBe(true);
    expect(controller.distillationModelLabel.value).toBe("Model B");

    controller.distillationError.value = "旧错误";
    controller.distillationStep.value = "failed";
    controller.distillationUploadPercent.value = 88;
    controller.distillationJob.value = { id: "job-1" } as never;
    controller.distillationRun.value = { runId: "run-1" } as never;
    controller.distillationArtifactSizes.value = { markdown: 128 };

    const file = new File(["hello"], "report.final.md", { type: "text/markdown" });
    controller.handleDebugDistillationFileSelected([file]);

    expect(controller.distillationFile.value).toBe(file);
    expect(controller.distillationFileLabel.value).toBe("report.final.md · 5 B");
    expect(controller.distillationStep.value).toBe("idle");
    expect(controller.distillationBusy.value).toBe(false);
    expect(controller.distillationUploadPercent.value).toBe(0);
    expect(controller.distillationJob.value).toBeNull();
    expect(controller.distillationRun.value).toBeNull();
    expect(controller.distillationArtifactSizes.value).toEqual({});
    expect(controller.distillationError.value).toBe("");
    expect(controller.distillationStatusMessage.value).toBe("文件已选择");

    controller.handleDebugDistillationFileSelected([]);

    expect(controller.distillationFile.value).toBeNull();
    expect(controller.distillationFileLabel.value).toBe("未选择文件");
    expect(controller.distillationStatusMessage.value).toBe("等待文件");
  });

  it("rejects empty submissions without calling the runner", async () => {
    const { controller } = mountControllerHarness();
    await flush();

    await controller.startDebugKnowledgeDistillation();

    expect(controller.distillationError.value).toBe("请先选择文件。");
    expect(controller.distillationBusy.value).toBe(false);
    expect(apiMocks.createKnowledgeUploadSession).not.toHaveBeenCalled();
    expect(apiMocks.getSettings).not.toHaveBeenCalled();
    expect(apiMocks.createJob).not.toHaveBeenCalled();
    expect(apiMocks.getKnowledgeDistillationWorkbenchRun).not.toHaveBeenCalled();
    expect(apiMocks.getKnowledgeDistillationWorkbenchRunArtifacts).not.toHaveBeenCalled();
  });

  it("completes a successful run and normalizes the derived result state", async () => {
    apiMocks.createKnowledgeUploadSession.mockImplementation(async (_files, options) => {
      options?.onProgress?.({ percent: 100, message: "上传完成" });
      return { session: { sessionId: "session-1" } } as never;
    });
    apiMocks.createKnowledgeDistillationWorkbenchRun.mockResolvedValue({
      runId: "run-1",
      status: "running",
      stages: [],
    } as never);
    apiMocks.getKnowledgeDistillationWorkbenchRun
      .mockResolvedValueOnce({
        runId: "run-1",
        status: "running",
        stages: [],
      } as never)
      .mockResolvedValueOnce(makeCompletedRun() as never);
    apiMocks.getKnowledgeDistillationWorkbenchRunArtifacts.mockResolvedValue({
      items: [
        {
          artifactId: "knowledge-distillation:markdown",
          stageId: "knowledge-distillation",
          format: "markdown",
          byteSize: 128,
        },
        {
          artifactId: "run:package",
          format: "package",
          byteSize: 2048,
        },
      ],
    } as never);

    const { controller } = mountControllerHarness();
    await flush();

    controller.handleDebugDistillationFileSelected([
      new File(["hello"], "report.final.md", { type: "text/markdown" }),
    ]);
    await controller.startDebugKnowledgeDistillation();
    await flush();

    expect(apiMocks.createKnowledgeUploadSession).toHaveBeenCalledTimes(1);
    expect(apiMocks.createKnowledgeDistillationWorkbenchRun).toHaveBeenCalledWith(expect.objectContaining({
      fileName: "report.final.md",
      modelAlias: "model-b",
      workflowScope: "document",
    }));
    expect(controller.distillationStep.value).toBe("completed");
    expect(controller.distillationBusy.value).toBe(false);
    expect(controller.distillationError.value).toBe("");
    expect(controller.distillationStatusMessage.value).toBe("知识蒸馏完成，可下载结果");
    expect(controller.distillationRunId.value).toBe("run-1");
    expect(controller.distillationResultMarkdown.value).toBe("# Done\n");
    expect(controller.distillationResultMarkdownLength.value).toBe(7);
    expect(controller.distillationProgressSummary.value).toBe("3/3");
    expect(controller.distillationResultBaseName.value).toBe("report.final");
    expect(controller.distillationDownloadUrl.value).toBe(
      "/api/knowledge/distillation/workbench/runs/run-1/exports/knowledge-distillation?format=markdown",
    );
    expect(controller.distillationPackageUrl.value).toBe(
      "/api/knowledge/distillation/workbench/runs/run-1/package",
    );
    expect(controller.distillationArtifactSizes.value).toMatchObject({
      "knowledge-distillation:markdown": 128,
      markdown: 128,
      "run:package": 2048,
      package: 2048,
    });
    expect(controller.distillationResultFiles.value).toHaveLength(4);
    expect(controller.distillationResultFiles.value.find((file) => file.key === "markdown")).toMatchObject({
      name: "report.final.md",
      size: 128,
    });
    expect(controller.distillationResultFiles.value.find((file) => file.key === "package")).toMatchObject({
      name: "report.final-workspace-package.zip",
      size: 2048,
    });
  });

  it("surfaces run failures and clears busy state", async () => {
    apiMocks.getKnowledgeDistillationWorkbenchRun.mockResolvedValueOnce({
      runId: "run-1",
      status: "failed",
      error: "distill failed",
      stages: [],
    } as never);

    const { controller } = mountControllerHarness();
    await flush();

    controller.handleDebugDistillationFileSelected([
      new File(["hello"], "report.final.md", { type: "text/markdown" }),
    ]);
    await controller.startDebugKnowledgeDistillation();
    await flush();

    expect(controller.distillationStep.value).toBe("failed");
    expect(controller.distillationBusy.value).toBe(false);
    expect(controller.distillationError.value).toBe("distill failed");
    expect(controller.distillationStatusMessage.value).toBe("任务失败");
    expect(controller.distillationResultFiles.value).toEqual([]);
    expect(controller.distillationProgressSummary.value).toBe("1/3");
  });
});
