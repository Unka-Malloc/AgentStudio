import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 30_000 });

const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn()
}));

const durableWorkflowRuntimeMock = vi.hoisted(() => ({
  startWorkflow: vi.fn(async () => null),
  recoverWorkflow: vi.fn(async () => null),
  scheduleActivity: vi.fn(async () => null),
  startActivity: vi.fn(async () => null),
  completeActivity: vi.fn(async () => null),
  failActivity: vi.fn(async () => null),
  failWorkflow: vi.fn(async () => null),
  completeWorkflow: vi.fn(async () => null),
  recordSignal: vi.fn(async () => null),
  heartbeatActivity: vi.fn(async () => null),
  getWorkflow: vi.fn(async () => null),
  listWorkflows: vi.fn(async () => ({ items: [] }))
}));

const queueMonitorStarted = vi.hoisted(() =>
  vi.fn(async (_userDataPath, input = {}) => ({
    queueId: input.queueId || "",
    status: String(input.status || input.phase || "queued")
  }))
);

const queueMonitorHeartbeat = vi.hoisted(() =>
  vi.fn(async (_userDataPath, input = {}) => ({
    queueId: input.queueId || "",
    stage: input.stage || ""
  }))
);

const queueMonitorClosed = vi.hoisted(() =>
  vi.fn(async (_userDataPath, input = {}) => ({
    queueId: input.queueId || "",
    status: input.status || "closed"
  }))
);

const queueMonitorId = vi.hoisted(() => vi.fn((kind, ownerId) => `queue_${kind}_${ownerId}`));

const workerState = vi.hoisted(() => ({
  nextPid: 4100,
  workers: []
}));

const runSplitJobMock = vi.hoisted(() => vi.fn());
const workerProcessState = vi.hoisted(() => ({
  exitCalls: [],
  exitImpl: null,
  handlers: {
    message: [],
    uncaughtException: [],
    unhandledRejection: []
  },
  sendCalls: [],
  sendEnabled: true,
  sendImpl: null
}));

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual("node:child_process");
  return {
    ...actual,
    fork: vi.fn(() => {
      const messageHandlers = [];
      const onceHandlers = new Map();
      const worker = {
        pid: workerState.nextPid++,
        killed: false,
        killSignals: [],
        sentMessages: [],
        send: vi.fn((message) => {
          worker.sentMessages.push(message);
        }),
        kill: vi.fn((signal) => {
          worker.killSignals.push(signal);
          worker.killed = true;
          return true;
        }),
        on(event, handler) {
          if (event === "message") {
            messageHandlers.push(handler);
          }
          return worker;
        },
        once(event, handler) {
          if (!onceHandlers.has(event)) {
            onceHandlers.set(event, []);
          }
          onceHandlers.get(event).push(handler);
          return worker;
        },
        emit(event, ...args) {
          if (event === "message") {
            for (const handler of [...messageHandlers]) {
              handler(...args);
            }
            return;
          }

          const handlers = onceHandlers.get(event) || [];
          onceHandlers.delete(event);
          for (const handler of handlers) {
            handler(...args);
          }
        }
      };
      workerState.workers.push(worker);
      return worker;
    })
  };
});

vi.mock("node:process", () => {
  const fakeProcess = {
    env: process.env,
    pid: process.pid,
    on(event, handler) {
      if (workerProcessState.handlers[event]) {
        workerProcessState.handlers[event].push(handler);
      }
      return fakeProcess;
    },
    _send(message, callback) {
      workerProcessState.sendCalls.push(message);
      if (typeof workerProcessState.sendImpl === "function") {
        return workerProcessState.sendImpl(message, callback);
      }
      callback?.();
      return undefined;
    },
    get send() {
      return workerProcessState.sendEnabled ? fakeProcess._send.bind(fakeProcess) : undefined;
    },
    exit(code) {
      workerProcessState.exitCalls.push(code);
      return workerProcessState.exitImpl ? workerProcessState.exitImpl(code) : undefined;
    }
  };

  return {
    default: fakeProcess
  };
});

vi.mock("../../../server/platform/interactive/product-api.mjs", async () => {
  const actual = await vi.importActual("../../../server/platform/interactive/product-api.mjs");
  return {
    ...actual,
    atomicWriteJsonThroughState: vi.fn(async () => null),
    createDurableWorkflowRuntime: vi.fn(() => durableWorkflowRuntimeMock),
    deleteCheckpointTree: vi.fn(async () => null),
    finishCheckpointTree: vi.fn(async () => null),
    getRuntimeLogger: vi.fn(() => loggerMock),
    removeImportCheckpoint: vi.fn(async () => null),
    startCheckpointTree: vi.fn(async () => null),
    summarizeError: vi.fn((error) => error?.message || String(error || "")),
    summarizeForLog: vi.fn((value) => value),
    traceDetails: vi.fn(() => ({ traceId: "unit-trace" })),
    upsertCheckpointNode: vi.fn(async () => null)
  };
});

vi.mock("../../../server/services/client/work-queue-core/queue-monitor.mjs", async () => {
  const actual = await vi.importActual("../../../server/services/client/work-queue-core/queue-monitor.mjs");
  return {
    ...actual,
    queueMonitorId,
    registerQueueStarted: queueMonitorStarted,
    registerQueueHeartbeat: queueMonitorHeartbeat,
    registerQueueClosed: queueMonitorClosed
  };
});

vi.mock("../../../server/services/client/work-queue-core/jobs/job-runner.mjs", () => ({
  runSplitJob: runSplitJobMock
}));

import { createJobManager } from "../../../server/services/client/work-queue-core/jobs/job-manager.mjs";
import { createJobsController } from "../../../server/platform/common/console/http/controllers/jobs-controller.mjs";

async function withTempDir(prefix, callback) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    return await callback(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function waitForCondition(predicate, timeoutMs = 1500) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await predicate()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return false;
}

async function flushMicrotasks() {
  await new Promise((resolve) => setImmediate(resolve));
}

function createResponseCapture() {
  return {
    statusCode: null,
    headers: {},
    chunks: [],
    writeHead(statusCode, headers = {}) {
      this.statusCode = statusCode;
      this.headers = { ...this.headers, ...headers };
    },
    write(chunk) {
      if (chunk !== undefined && chunk !== null) {
        this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      }
    },
    end(chunk) {
      if (chunk !== undefined && chunk !== null) {
        this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      }
    },
    bodyText() {
      return Buffer.concat(this.chunks).toString("utf8");
    },
    json() {
      return JSON.parse(this.bodyText() || "{}");
    }
  };
}

function jsonBody(value) {
  return Buffer.from(JSON.stringify(value), "utf8");
}

function createUploadSessionStore(overrides = {}) {
  return {
    appendUploadSessionChunk: vi.fn(async () => ({
      ok: true,
      session: {
        sessionId: "session-1",
        checkpointId: "checkpoint-1",
        manifestDigest: "manifest-1",
        status: "receiving",
        files: []
      }
    })),
    buildCheckpointReceiptFromUploadSession: vi.fn(async () => ({
      checkpointId: "checkpoint-from-session",
      archiveBatchId: "archive-from-session",
      clientUid: "client-session",
      sourceType: "upload-session",
      manifestSha256: "manifest-from-session",
      fileCount: 1,
      files: []
    })),
    createOrResumeUploadSession: vi.fn(async ({ checkpoint = {}, manifest = {}, files = [] }) => ({
      sessionId: "session-1",
      checkpointId: checkpoint.checkpointId || "checkpoint-1",
      manifestDigest: manifest.manifestDigest || "manifest-1",
      inputDigest: manifest.inputDigest || "input-1",
      status: "receiving",
      files: files.map((file, index) => ({
        index,
        name: file.name || `file-${index}`,
        byteSize: Number(file.byteSize || 0),
        receivedBytes: 0,
        completed: false
      }))
    })),
    getUploadSession: vi.fn(async () => null),
    ...overrides
  };
}

function createJobWorkflowProvider(overrides = {}) {
  const jobs = new Map([
    ["pending", { id: "pending", status: "running" }],
    ["running", { id: "running", status: "running" }],
    ["completed", { id: "completed", status: "completed" }]
  ]);

  return {
    createJob: vi.fn(async (payload) => ({ id: "created-job", status: "queued", payload })),
    getJob: vi.fn(async (jobId) => jobs.get(jobId) || null),
    getJobByCheckpointId: vi.fn(async () => null),
    getJobResult: vi.fn(async () => ({ jobId: "completed", ok: true })),
    listJobs: vi.fn(async () => []),
    reparseJob: vi.fn(async (jobId, options) => ({ id: "reparsed-job", status: "queued", jobId, options })),
    ...overrides
  };
}

function createControllerHarness(overrides = {}) {
  const discoveryState = overrides.discoveryState || {
    mode: "local",
    advertisedBaseUrl: "http://local",
    activeServiceUrl: "http://local"
  };
  const uploadSessionStore = overrides.uploadSessionStore || createUploadSessionStore();
  const jobWorkflowProvider = overrides.jobWorkflowProvider || createJobWorkflowProvider();
  const storageProvider = overrides.storageProvider || {
    readRawObjectById: vi.fn(async () => null)
  };
  const deletionCoordinator = overrides.deletionCoordinator || {
    deleteBatch: vi.fn(async () => ({ ok: false }))
  };
  const protocolEventBus = overrides.protocolEventBus || {
    publish: vi.fn(async () => null)
  };
  const proxyApiRequest = overrides.proxyApiRequest || vi.fn(async ({ response }) => {
    response.writeHead(209, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ proxied: true }));
  });
  const loadNormalizedDocumentStore =
    overrides.loadNormalizedDocumentStore ||
    vi.fn(async () => ({
      loadNormalizedDocumentsManifest: vi.fn(async () => ({ documents: [] })),
      normalizedContentType: vi.fn(() => "text/plain"),
      resolveNormalizedDocumentEntry: vi.fn(() => null),
      resolveNormalizedDocumentPath: vi.fn(() => "/tmp/normalized.txt")
    }));

  const controller = createJobsController({
    userDataPath: overrides.userDataPath || "/tmp/pact-job-runtime-controller-test",
    jobWorkflowProvider,
    storageProvider,
    deletionCoordinator,
    getDiscoveryState: () => discoveryState,
    proxyApiRequest,
    protocolEventBus,
    uploadSessionStore,
    loadNormalizedDocumentStore
  });

  return {
    controller,
    deletionCoordinator,
    discoveryState,
    jobWorkflowProvider,
    loadNormalizedDocumentStore,
    protocolEventBus,
    proxyApiRequest,
    storageProvider,
    uploadSessionStore
  };
}

async function loadJobWorkerModule() {
  await vi.resetModules();
  return import("../../../server/services/client/work-queue-core/jobs/job-worker.mjs");
}

beforeEach(() => {
  loggerMock.info.mockClear();
  loggerMock.warn.mockClear();
  loggerMock.error.mockClear();
  loggerMock.debug.mockClear();
  durableWorkflowRuntimeMock.startWorkflow.mockClear();
  durableWorkflowRuntimeMock.recoverWorkflow.mockClear();
  durableWorkflowRuntimeMock.scheduleActivity.mockClear();
  durableWorkflowRuntimeMock.startActivity.mockClear();
  durableWorkflowRuntimeMock.completeActivity.mockClear();
  durableWorkflowRuntimeMock.failActivity.mockClear();
  durableWorkflowRuntimeMock.failWorkflow.mockClear();
  durableWorkflowRuntimeMock.completeWorkflow.mockClear();
  durableWorkflowRuntimeMock.recordSignal.mockClear();
  durableWorkflowRuntimeMock.heartbeatActivity.mockClear();
  durableWorkflowRuntimeMock.getWorkflow.mockClear();
  durableWorkflowRuntimeMock.listWorkflows.mockClear();
  queueMonitorStarted.mockClear();
  queueMonitorHeartbeat.mockClear();
  queueMonitorClosed.mockClear();
  queueMonitorId.mockClear();
  workerState.nextPid = 4100;
  workerState.workers.length = 0;
  runSplitJobMock.mockReset();
  workerProcessState.exitCalls.length = 0;
  workerProcessState.exitImpl = null;
  workerProcessState.sendCalls.length = 0;
  workerProcessState.sendEnabled = true;
  workerProcessState.sendImpl = null;
  workerProcessState.handlers.message.length = 0;
  workerProcessState.handlers.uncaughtException.length = 0;
  workerProcessState.handlers.unhandledRejection.length = 0;
});

describe("job worker entry", () => {
  it("ignores non-run messages and supports missing process.send", async () => {
    workerProcessState.sendEnabled = false;

    await loadJobWorkerModule();
    workerProcessState.handlers.message[0]({ type: "noop", trace: { traceId: "ignored" } });
    workerProcessState.handlers.message[0]({
        type: "run",
        userDataPath: "/tmp/job-worker-test",
        payload: { text: "payload" },
        jobId: "job-1",
        runtimeOptions: { workerConcurrency: 2 },
        trace: { traceId: "trace-1" }
      });

    await waitForCondition(() => workerProcessState.exitCalls.length > 0);

    expect(runSplitJobMock).toHaveBeenCalledTimes(1);
    expect(workerProcessState.exitCalls).toEqual([0]);
    expect(workerProcessState.sendCalls).toEqual([]);
  });

  it("sends progress and completion messages for a successful run", async () => {
    const messages = [];
    workerProcessState.sendEnabled = true;
    workerProcessState.sendImpl = (message, callback) => {
      messages.push(message);
      callback?.();
    };

    runSplitJobMock.mockImplementation(async (_userDataPath, payload, options) => {
      expect(payload).toEqual({ text: "payload" });
      expect(options.jobId).toBe("job-2");
      options.onProgress({ progressPercent: 25, stage: "处理中" });
      return { ok: true, entries: 3 };
    });

    await loadJobWorkerModule();
    workerProcessState.handlers.message[0]({
      type: "run",
      userDataPath: "/tmp/job-worker-test",
      payload: { text: "payload" },
      jobId: "job-2",
      runtimeOptions: { workerConcurrency: 4 },
      trace: { traceId: "trace-2" }
    });

    await waitForCondition(() => workerProcessState.exitCalls.length > 0);

    expect(messages).toEqual([
      {
        type: "progress",
        trace: { traceId: "trace-2" },
        progressPercent: 25,
        stage: "处理中"
      },
      {
        type: "completed",
        trace: { traceId: "trace-2" },
        result: { ok: true, entries: 3 }
      }
    ]);
    expect(workerProcessState.exitCalls).toEqual([0]);
  });

  it("reports failures from runSplitJob and process-level exceptions", async () => {
    const messages = [];
    workerProcessState.sendEnabled = true;
    workerProcessState.sendImpl = (message, callback) => {
      messages.push(message);
      callback?.();
    };
    runSplitJobMock.mockRejectedValueOnce(new Error("run failed"));

    await loadJobWorkerModule();
    workerProcessState.handlers.message[0]({
      type: "run",
      userDataPath: "/tmp/job-worker-test",
      payload: { text: "payload" },
      jobId: "job-3",
      runtimeOptions: {},
      trace: { traceId: "trace-3" }
    });

    await waitForCondition(() => workerProcessState.exitCalls.length > 0);
    expect(messages.at(0)).toMatchObject({
      type: "failed",
      trace: { traceId: "trace-3" },
      error: "run failed"
    });
    expect(workerProcessState.exitCalls).toEqual([1]);

    workerProcessState.handlers.uncaughtException[0](new Error("boom"));
    workerProcessState.handlers.unhandledRejection[0](new Error("reject boom"));
    await waitForCondition(() => messages.length >= 3);

    expect(messages.slice(-2)).toEqual([
      { type: "failed", error: "boom" },
      { type: "failed", error: "reject boom" }
    ]);
    expect(workerProcessState.exitCalls).toEqual([1, 1, 1]);
  });
});

describe("job manager queue and state boundaries", () => {
  it("exposes running and queued queue states, then drains them in order", async () => {
    await withTempDir("pact-job-runtime-manager-queue-", async (userDataPath) => {
      const manager = createJobManager({
        userDataPath,
        processingEnabled: true,
        runtimeOptions: { workerConcurrency: 1 }
      });

      const firstJob = await manager.createJob({
        inputText: "first job"
      });

      await waitForCondition(async () => {
        const job = await manager.getJob(firstJob.id);
        return job?.status === "running";
      });

      const secondJobPromise = manager.createJob({
        inputText: "second job"
      });
      const secondJob = await secondJobPromise;

      const firstRunning = await manager.getJob(firstJob.id);
      const secondQueued = await manager.getJob(secondJob.id);
      const listedWhileQueued = await manager.listJobs({ limit: 2 });

      expect(firstRunning).toMatchObject({
        id: firstJob.id,
        status: "running",
        queueState: expect.objectContaining({
          active: true,
          activeJobId: firstJob.id,
          waitingReason: "running"
        })
      });
      expect(secondQueued).toMatchObject({
        id: secondJob.id,
        status: "queued",
        queueState: expect.objectContaining({
          active: false,
          activeJobId: firstJob.id,
          activeJobIds: [firstJob.id],
          waitingReason: "waiting_for_available_worker"
        })
      });
      expect(listedWhileQueued.summary).toMatchObject({
        totalCount: 2,
        queuedCount: 1,
        runningCount: 1,
        completedCount: 0,
        failedCount: 0,
        queuedJobIds: [secondJob.id]
      });

      const firstWorker = workerState.workers[0];
      firstWorker.emit("message", {
        type: "completed",
        result: { emails: [], transactions: [], people: [], warnings: [] }
      });

      await waitForCondition(async () => {
        const job = await manager.getJob(secondJob.id);
        return job?.status === "running";
      });

      const secondRunning = await manager.getJob(secondJob.id);
      expect(secondRunning).toMatchObject({
        id: secondJob.id,
        status: "running",
        queueState: expect.objectContaining({
          active: true,
          activeJobId: secondJob.id,
          activeJobIds: [secondJob.id],
          waitingReason: "running"
        })
      });

      const secondWorker = workerState.workers[1];
      secondWorker.emit("message", {
        type: "completed",
        result: { emails: [1], transactions: [], people: [], warnings: [] }
      });

      await expect(waitForCondition(async () => {
        const jobs = await manager.listJobs({ limit: 2 });
        return jobs.summary.completedCount === 2;
      }, 6_000)).resolves.toBe(true);

      const finalListing = await manager.listJobs({ limit: 2 });
      expect(finalListing.summary).toMatchObject({
        totalCount: 2,
        queuedCount: 0,
        runningCount: 0,
        completedCount: 2,
        failedCount: 0,
        queuedJobIds: []
      });
    });
  });

  it("rejects new work after close and reports the closed scan state", async () => {
    await withTempDir("pact-job-runtime-manager-close-", async (userDataPath) => {
      const manager = createJobManager({
        userDataPath,
        processingEnabled: true
      });

      await manager.close();

      await expect(manager.createJob({ inputText: "late job" })).rejects.toThrow(
        "后台任务管理器已经关闭。"
      );

      await expect(manager.scanPersistedQueue()).resolves.toEqual({
        scanned: false,
        reason: "closed"
      });
    });
  });
});

describe("jobs controller missing and error paths", () => {
  it("handles empty payloads and missing ids while returning the expected status codes", async () => {
    const harness = createControllerHarness();

    const uploadResponse = createResponseCapture();
    await harness.controller.handleCreateUploadSession({
      requestBody: Buffer.alloc(0),
      response: uploadResponse
    });
    expect(uploadResponse.statusCode).toBe(200);
    expect(harness.uploadSessionStore.createOrResumeUploadSession).toHaveBeenCalledWith(
      expect.objectContaining({
        checkpoint: {},
        manifest: {},
        files: []
      })
    );

    const reparseResponse = createResponseCapture();
    await harness.controller.handleReparseJob({
      request: {},
      requestBody: Buffer.alloc(0),
      jobId: undefined,
      response: reparseResponse
    });
    expect(reparseResponse.statusCode).toBe(202);
    expect(harness.jobWorkflowProvider.reparseJob).toHaveBeenCalledWith(undefined, {
      documentParsing: undefined,
      settings: undefined
    });

    const missingJobResponse = createResponseCapture();
    await harness.controller.handleGetJob({
      request: {},
      requestBody: Buffer.alloc(0),
      jobId: undefined,
      response: missingJobResponse
    });
    expect(missingJobResponse.statusCode).toBe(404);

    const deleteMissingResponse = createResponseCapture();
    await harness.controller.handleDeleteJob({
      request: {},
      requestBody: Buffer.alloc(0),
      jobId: undefined,
      response: deleteMissingResponse
    });
    expect(deleteMissingResponse.statusCode).toBe(404);
    expect(harness.deletionCoordinator.deleteBatch).toHaveBeenCalledWith(undefined);

    const pendingResultResponse = createResponseCapture();
    await harness.controller.handleGetJobResult({
      request: {},
      requestBody: Buffer.alloc(0),
      jobId: "pending",
      response: pendingResultResponse
    });
    expect(pendingResultResponse.statusCode).toBe(409);

    const pendingManifestResponse = createResponseCapture();
    await harness.controller.handleListNormalizedDocuments({
      request: {},
      requestBody: Buffer.alloc(0),
      jobId: "running",
      response: pendingManifestResponse
    });
    expect(pendingManifestResponse.statusCode).toBe(409);

    const missingDocumentResponse = createResponseCapture();
    await harness.controller.handleGetNormalizedDocument({
      request: {},
      requestBody: Buffer.alloc(0),
      jobId: "completed",
      documentId: "missing-doc",
      response: missingDocumentResponse
    });
    expect(missingDocumentResponse.statusCode).toBe(404);

    const rawMissingResponse = createResponseCapture();
    await harness.controller.handleGetRawObject({
      objectId: undefined,
      response: rawMissingResponse
    });
    expect(rawMissingResponse.statusCode).toBe(404);
  });

  it("propagates provider and manifest errors from the controller", async () => {
    const harness = createControllerHarness({
      uploadSessionStore: createUploadSessionStore({
        createOrResumeUploadSession: vi.fn(async () => {
          throw new Error("upload create failed");
        }),
        buildCheckpointReceiptFromUploadSession: vi.fn(async () => {
          throw new Error("session receipt failed");
        })
      }),
      jobWorkflowProvider: createJobWorkflowProvider({
        reparseJob: vi.fn(async () => {
          throw new Error("reparse failed");
        })
      }),
      deletionCoordinator: {
        deleteBatch: vi.fn(async () => {
          throw new Error("delete failed");
        })
      },
      loadNormalizedDocumentStore: vi.fn(async () => ({
        loadNormalizedDocumentsManifest: vi.fn(async () => {
          const error = new Error("manifest failed");
          error.code = "EIO";
          throw error;
        }),
        normalizedContentType: vi.fn(() => "text/plain"),
        resolveNormalizedDocumentEntry: vi.fn(() => null),
        resolveNormalizedDocumentPath: vi.fn(() => "/tmp/normalized.txt")
      }))
    });

    await expect(
      harness.controller.handleCreateUploadSession({
        requestBody: Buffer.alloc(0),
        response: createResponseCapture()
      })
    ).rejects.toThrow("upload create failed");

    await expect(
      harness.controller.handleCreateJob({
        request: {},
        requestBody: jsonBody({ uploadSessionId: "session-1" }),
        response: createResponseCapture()
      })
    ).rejects.toThrow("session receipt failed");

    await expect(
      harness.controller.handleReparseJob({
        request: {},
        requestBody: Buffer.alloc(0),
        jobId: "completed",
        response: createResponseCapture()
      })
    ).rejects.toThrow("reparse failed");

    await expect(
      harness.controller.handleDeleteJob({
        request: {},
        requestBody: Buffer.alloc(0),
        jobId: "completed",
        response: createResponseCapture()
      })
    ).rejects.toThrow("delete failed");

    await expect(
      harness.controller.handleListNormalizedDocuments({
        request: {},
        requestBody: Buffer.alloc(0),
        jobId: "completed",
        response: createResponseCapture()
      })
    ).rejects.toThrow("manifest failed");
  });
});
