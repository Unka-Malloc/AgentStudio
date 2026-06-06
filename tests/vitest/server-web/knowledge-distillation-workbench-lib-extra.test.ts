// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const getSettingsMock = vi.hoisted(() => vi.fn());
const probeModelMock = vi.hoisted(() => vi.fn());

const clientMocks = vi.hoisted(() => ({
  archiveKnowledgeDistillationWorkbenchRun: vi.fn(),
  cancelKnowledgeDistillationWorkbenchRun: vi.fn(),
  compareKnowledgeDistillationWorkbenchRuns: vi.fn(),
  createKnowledgeDistillationWorkbenchRun: vi.fn(),
  deleteKnowledgeDistillationWorkbenchRun: vi.fn(),
  getKnowledgeDistillationWorkbenchRun: vi.fn(),
  getKnowledgeDistillationWorkbenchRunArtifacts: vi.fn(),
  listKnowledgeDistillationWorkbenchRuns: vi.fn(),
  rerunKnowledgeDistillationWorkbenchStage: vi.fn(),
  resumeKnowledgeDistillationWorkbenchRun: vi.fn(),
}));

vi.mock("../../../server-web/lib/agent-settings-client", () => ({
  getSettings: getSettingsMock,
  probeModel: probeModelMock,
}));

vi.mock("../../../server-web/lib/knowledge-distillation-workbench-client", () => ({
  archiveKnowledgeDistillationWorkbenchRun: clientMocks.archiveKnowledgeDistillationWorkbenchRun,
  cancelKnowledgeDistillationWorkbenchRun: clientMocks.cancelKnowledgeDistillationWorkbenchRun,
  compareKnowledgeDistillationWorkbenchRuns: clientMocks.compareKnowledgeDistillationWorkbenchRuns,
  createKnowledgeDistillationWorkbenchRun: clientMocks.createKnowledgeDistillationWorkbenchRun,
  deleteKnowledgeDistillationWorkbenchRun: clientMocks.deleteKnowledgeDistillationWorkbenchRun,
  getKnowledgeDistillationWorkbenchRun: clientMocks.getKnowledgeDistillationWorkbenchRun,
  getKnowledgeDistillationWorkbenchRunArtifacts: clientMocks.getKnowledgeDistillationWorkbenchRunArtifacts,
  listKnowledgeDistillationWorkbenchRuns: clientMocks.listKnowledgeDistillationWorkbenchRuns,
  rerunKnowledgeDistillationWorkbenchStage: clientMocks.rerunKnowledgeDistillationWorkbenchStage,
  resumeKnowledgeDistillationWorkbenchRun: clientMocks.resumeKnowledgeDistillationWorkbenchRun,
  knowledgeDistillationWorkbenchExportUrl: vi.fn((runId: string, stageId: string, format = "markdown") =>
    `/api/export/${runId}/${stageId}?format=${format}`),
  knowledgeDistillationWorkbenchPackageUrl: vi.fn((runId: string) => `/api/package/${runId}`),
}));

import {
  asWorkbenchRun,
  cancelKnowledgeDistillationWorkbenchRun,
  compareKnowledgeDistillationWorkbenchRuns,
  createKnowledgeDistillationWorkbenchRun,
  deleteKnowledgeDistillationWorkbenchRun,
  getKnowledgeDistillationWorkbenchRun,
  getKnowledgeDistillationWorkbenchRunArtifacts,
  listKnowledgeDistillationWorkbenchRuns,
  optionSelectable,
  optionValue,
  probeDistillationModelStatus,
  rerunKnowledgeDistillationWorkbenchStage,
  resumeKnowledgeDistillationWorkbenchRun,
  statusLabel,
  statusTone,
} from "../../../server-web/lib/knowledge-distillation-workbench";

function baseSettings(overrides: Record<string, unknown> = {}) {
  return {
    modelLibraryAgents: [],
    defaultModelProvider: "deepseek",
    deepSeekModel: "",
    customHttpAdapter: {
      alias: "",
      url: "",
      token: "",
      tokenHeader: "",
      tokenPrefix: "",
      engine: "",
      parameters: {},
      pluginList: [],
      timeoutMs: 30_000,
      agentName: "",
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("knowledge distillation workbench model helper functions", () => {
  it("asWorkbenchRun 统一化字段并回退默认值", () => {
    expect(asWorkbenchRun(null)).toMatchObject({
      runId: "",
      title: "知识蒸馏工作台",
      status: "unknown",
      progressPercent: 0,
      jobId: "",
      batchId: "",
      priority: "normal",
      modelAlias: "",
      modelEnabled: false,
      workflowScope: undefined,
      stages: [],
    });

    expect(asWorkbenchRun({ runId: 1, title: "标题", status: "completed", workflowScope: "document" })).toMatchObject({
      runId: "1",
      title: "标题",
      status: "completed",
      workflowScope: "document",
    });
    expect(asWorkbenchRun({ runId: 1, workflowScope: "bad" })).toMatchObject({
      workflowScope: undefined,
    });
  });

  it("状态和模型选项函数给出一致的状态映射", () => {
    expect(statusLabel("running")).toBe("运行中");
    expect(statusLabel("completed")).toBe("已完成");
    expect(statusLabel("unknown")).toBe("unknown");
    expect(statusTone("completed")).toBe("success");
    expect(statusTone("running")).toBe("warning");
    expect(statusTone("failed")).toBe("danger");
    expect(statusTone("archived")).toBe("muted");

    expect(optionValue({ agentUid: "a1", value: 1 })).toBe("a1");
    expect(optionSelectable({ disabled: true, selectable: true, enabled: true })).toBe(false);
    expect(optionSelectable({ selectable: false })).toBe(false);
    expect(optionSelectable({ enabled: false })).toBe(false);
    expect(optionSelectable({})).toBe(true);
  });
});

describe("knowledge distillation workbench client wrappers", () => {
  it("列表/详情/重跑/恢复接口透传参数并进行结果转换", async () => {
    const rawRun = {
      runId: "run-1",
      title: "run title",
      status: "queued",
      progressPercent: "66",
      jobId: "job-1",
      batchId: "batch-1",
      workflowScope: "project",
      stages: [
        {
          stageId: "s-1",
          title: "准备",
          actionLabel: "prepare",
          description: "prepare",
          status: "completed",
        },
      ],
    };

    clientMocks.listKnowledgeDistillationWorkbenchRuns.mockResolvedValue({ items: [rawRun] });
    clientMocks.createKnowledgeDistillationWorkbenchRun.mockResolvedValue(rawRun);
    clientMocks.getKnowledgeDistillationWorkbenchRun.mockResolvedValue(rawRun);
    clientMocks.cancelKnowledgeDistillationWorkbenchRun.mockResolvedValue(rawRun);
    clientMocks.compareKnowledgeDistillationWorkbenchRuns.mockResolvedValue({ changes: 1 });
    clientMocks.deleteKnowledgeDistillationWorkbenchRun.mockResolvedValue({});
    clientMocks.getKnowledgeDistillationWorkbenchRunArtifacts.mockResolvedValue({});
    clientMocks.rerunKnowledgeDistillationWorkbenchStage.mockResolvedValue(rawRun);
    clientMocks.resumeKnowledgeDistillationWorkbenchRun.mockResolvedValue(rawRun);

    const listRuns = await listKnowledgeDistillationWorkbenchRuns(11);
    expect(listRuns).toHaveLength(1);
    expect(listRuns[0]).toMatchObject({
      runId: "run-1",
      status: "queued",
      workflowScope: "project",
      progressPercent: 66,
      stages: [
        {
          stageId: "s-1",
          status: "completed",
        },
      ],
    });
    expect(clientMocks.listKnowledgeDistillationWorkbenchRuns).toHaveBeenCalledWith(11);

    const created = await createKnowledgeDistillationWorkbenchRun({
      title: "run title",
      jobId: "job-1",
      batchId: "batch-1",
      query: "query",
      workflowScope: "project",
    } as any);
    expect(created.runId).toBe("run-1");
    expect(clientMocks.createKnowledgeDistillationWorkbenchRun).toHaveBeenCalledWith({
      title: "run title",
      jobId: "job-1",
      batchId: "batch-1",
      query: "query",
      workflowScope: "project",
    });

    await expect(getKnowledgeDistillationWorkbenchRun("run-1")).resolves.toMatchObject({ runId: "run-1" });
    await expect(rerunKnowledgeDistillationWorkbenchStage("run-1", "s-1")).resolves.toMatchObject({
      runId: "run-1",
    });
    await expect(resumeKnowledgeDistillationWorkbenchRun("run-1")).resolves.toMatchObject({
      runId: "run-1",
    });

    await expect(cancelKnowledgeDistillationWorkbenchRun("run-1", "manual cancel")).resolves.toMatchObject({
      runId: "run-1",
    });

    await expect(compareKnowledgeDistillationWorkbenchRuns("run-1", "run-2")).resolves.toMatchObject({});
    await expect(deleteKnowledgeDistillationWorkbenchRun("run-1")).resolves.toMatchObject({});
    await expect(getKnowledgeDistillationWorkbenchRunArtifacts("run-1")).resolves.toMatchObject({});
  });

  it("列表响应若无 items 时返回空数组并向上传递失败", async () => {
    clientMocks.listKnowledgeDistillationWorkbenchRuns.mockResolvedValue({});
    await expect(listKnowledgeDistillationWorkbenchRuns()).resolves.toEqual([]);

    const boom = new Error("network failed");
    clientMocks.getKnowledgeDistillationWorkbenchRun.mockRejectedValue(boom);
    await expect(getKnowledgeDistillationWorkbenchRun("run-1")).rejects.toThrow("network failed");
  });
});

describe("knowledge distillation model probe status", () => {
  it("空别名直接返回未配置状态且不会发起探测", async () => {
    getSettingsMock.mockResolvedValue(baseSettings());

    const result = await probeDistillationModelStatus("");
    expect(result.state).toBe("unconfigured");
    expect(result.message).toContain("当前模型库为空");
    expect(getSettingsMock).toHaveBeenCalledTimes(1);
    expect(probeModelMock).not.toHaveBeenCalled();
  });

  it("成功探测与离线/未配置分支按返回体映射", async () => {
    const customSettings = baseSettings({
      defaultModelProvider: "custom-http",
      modelLibraryAgents: [
        {
          uid: "custom-uid",
          instanceId: "custom-ins",
          provider: "custom-http",
          alias: "custom-model",
          model: "gpt-x",
          engine: "gpt-x-engine",
        },
      ] as any[],
      customHttpAdapter: {
        alias: "",
        url: "http://example",
        token: "token",
        tokenHeader: "Authorization",
        tokenPrefix: "Bearer",
        parameters: {},
        engine: "",
        pluginList: [],
        timeoutMs: 30_000,
        agentName: "",
      },
    });

    probeModelMock.mockResolvedValueOnce({
      ok: true,
      configured: true,
      provider: "deepseek",
      model: "deepseek-v2",
      statusCode: 200,
      latencyMs: 10,
      checkedAt: "2026-06-04T00:00:00.000Z",
      message: "模型在线",
    });
    getSettingsMock.mockResolvedValueOnce(customSettings);

    const onlineResult = await probeDistillationModelStatus("deepseek-pro");
    expect(onlineResult.state).toBe("online");
    expect(onlineResult.message).toBe("模型在线");
    expect(probeModelMock).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "deepseek",
        modelAlias: "deepseek-pro",
        settings: expect.objectContaining({
          deepSeekModel: "deepseek-pro",
        }),
      }),
    );

    probeModelMock.mockResolvedValueOnce({
      ok: false,
      configured: false,
      provider: "custom-http",
      model: "custom-model",
      statusCode: 500,
      latencyMs: 10,
      checkedAt: "2026-06-04T00:10:00.000Z",
      message: "未配置 custom provider",
    });
    getSettingsMock.mockResolvedValueOnce(customSettings);

    const unconfiguredResult = await probeDistillationModelStatus("custom-model");
    expect(unconfiguredResult.state).toBe("unconfigured");
    expect(unconfiguredResult.message).toBe("未配置 custom provider");
    expect(probeModelMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        provider: "custom-http",
        modelAlias: "custom-uid",
        settings: expect.objectContaining({
          customHttpAdapter: expect.objectContaining({
            alias: "custom-uid",
            engine: "gpt-x-engine",
          }),
        }),
      }),
    );

    probeModelMock.mockResolvedValueOnce({
      ok: false,
      configured: true,
      provider: "custom-http",
      model: "custom-model",
      statusCode: 500,
      latencyMs: 10,
      checkedAt: "2026-06-04T00:10:00.000Z",
      message: "服务不可用",
    });
    getSettingsMock.mockResolvedValueOnce(customSettings);

    const offlineResult = await probeDistillationModelStatus("custom-model");
    expect(offlineResult.state).toBe("offline");
    expect(offlineResult.message).toBe("服务不可用");
  });

  it("探测失败会透传异常", async () => {
    getSettingsMock.mockResolvedValueOnce(baseSettings());
    probeModelMock.mockRejectedValueOnce(new Error("connect failed"));
    await expect(probeDistillationModelStatus("deepseek-pro")).rejects.toThrow("connect failed");
  });
});
