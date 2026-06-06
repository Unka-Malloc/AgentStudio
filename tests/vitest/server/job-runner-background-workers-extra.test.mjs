import { beforeEach, describe, expect, it, vi } from "vitest";

const createJobPipelineMock = vi.hoisted(() => vi.fn());
const resolveArchiveBatchIdentityMock = vi.hoisted(() => vi.fn());
const createServerRuntimeMock = vi.hoisted(() => vi.fn());

vi.mock("../../../server/services/client/work-queue-core/job-pipeline.mjs", () => ({
  createJobPipeline: createJobPipelineMock
}));

vi.mock("../../../server/services/client/work-queue-core/archive-batch-id.mjs", () => ({
  resolveArchiveBatchIdentity: resolveArchiveBatchIdentityMock
}));

vi.mock("../../../server/platform/interactive/product-api.mjs", () => ({
  createServerRuntime: createServerRuntimeMock
}));

import { runSplitJob } from "../../../server/services/client/work-queue-core/jobs/job-runner.mjs";
import { createBackgroundWorkerRuntime } from "../../../server/services/client/work-queue-core/background-workers/registry.mjs";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("job runner and background worker wrappers", () => {
  it("runs split jobs through the pipeline and closes runtime on success", async () => {
    const runtime = {
      metadataStore: {
        markBatchFailed: vi.fn()
      },
      close: vi.fn(async () => undefined)
    };
    const context = { jobId: "job-1" };
    const pipeline = {
      createContext: vi.fn(() => context),
      run: vi.fn(async (input) => ({ ok: true, input }))
    };
    const onProgress = vi.fn();
    createServerRuntimeMock.mockResolvedValue(runtime);
    createJobPipelineMock.mockReturnValue(pipeline);
    resolveArchiveBatchIdentityMock.mockReturnValue({ archiveBatchId: "archive-1" });
    const payload = {
      checkpointReceipt: {
        archiveBatchId: "receipt-archive",
        checkpointId: "checkpoint-1",
        manifestSha256: "manifest-1"
      },
      batchId: "batch-1",
      clientBatchId: "client-batch-1",
      inputDigest: "input-1"
    };

    await expect(runSplitJob("/data", payload, {
      jobId: "job-1",
      runtimeOptions: { featureFlags: { test: true } },
      onProgress
    })).resolves.toEqual({ ok: true, input: context });

    expect(resolveArchiveBatchIdentityMock).toHaveBeenCalledWith({
      archiveBatchId: "receipt-archive",
      batchId: "batch-1",
      clientBatchId: "client-batch-1",
      checkpointId: "checkpoint-1",
      manifestDigest: "manifest-1",
      inputDigest: "input-1"
    });
    expect(createServerRuntimeMock).toHaveBeenCalledWith({
      userDataPath: "/data",
      runtimeOptions: { featureFlags: { test: true } }
    });
    expect(createJobPipelineMock).toHaveBeenCalledWith({
      userDataPath: "/data",
      payload,
      runtime,
      reportProgress: onProgress,
      jobId: "job-1",
      generatedAt: expect.any(String)
    });
    expect(pipeline.createContext).toHaveBeenCalledOnce();
    expect(pipeline.run).toHaveBeenCalledWith(context);
    expect(runtime.metadataStore.markBatchFailed).not.toHaveBeenCalled();
    expect(runtime.close).toHaveBeenCalledOnce();
  });

  it("marks archive batch failed and still closes runtime when the pipeline throws", async () => {
    const error = new Error("pipeline failed");
    const runtime = {
      metadataStore: {
        markBatchFailed: vi.fn()
      },
      close: vi.fn(async () => undefined)
    };
    createServerRuntimeMock.mockResolvedValue(runtime);
    createJobPipelineMock.mockReturnValue({
      createContext: vi.fn(() => ({ jobId: "job-error" })),
      run: vi.fn(async () => {
        throw error;
      })
    });
    resolveArchiveBatchIdentityMock.mockReturnValue({ archiveBatchId: "" });

    await expect(runSplitJob("/data", {
      checkpoint: {
        batchId: "",
        clientBatchId: "",
        checkpointId: "",
        manifestDigest: ""
      }
    }, {
      jobId: "job-error",
      batchId: "batch-fallback"
    })).rejects.toThrow("pipeline failed");

    expect(runtime.metadataStore.markBatchFailed).toHaveBeenCalledWith("batch-fallback", "pipeline failed");
    expect(runtime.close).toHaveBeenCalledOnce();
  });

  it("creates standby agent worker runtime and rejects unknown worker roles", async () => {
    const runtime = await createBackgroundWorkerRuntime({
      role: "agent-worker",
      userDataPath: "/data"
    });

    expect(runtime.mode).toBe("standby");
    await expect(runtime.tick()).resolves.toEqual({
      status: "standby",
      details: {
        mode: "supervised_process_ready",
        note: "该后台角色由守护进程按需托管；智能体是否可用以模型库配置和探测状态为准。"
      }
    });
    await expect(runtime.close()).resolves.toBeUndefined();
    await expect(createBackgroundWorkerRuntime({
      role: "missing-worker",
      userDataPath: "/data"
    })).rejects.toThrow("Unknown background worker role: missing-worker");
  });
});
