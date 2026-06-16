import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { zipSync } from "fflate";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createJobsController } from "../../../server/platform/common/console/http/controllers/jobs-controller.mjs";

const tempRoots = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  vi.restoreAllMocks();
});

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
    bodyBuffer() {
      return Buffer.concat(this.chunks);
    },
    json() {
      return JSON.parse(this.bodyBuffer().toString("utf8") || "{}");
    }
  };
}

function jsonBody(value) {
  return Buffer.from(JSON.stringify(value), "utf8");
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function uploadedFile(name, content, extra = {}) {
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(String(content), "utf8");
  return {
    name,
    relativePath: extra.relativePath || name,
    dataBase64: buffer.toString("base64"),
    byteSize: buffer.length,
    sha256: sha256(buffer),
    ...extra
  };
}

async function makeTempRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pact-jobs-controller-"));
  tempRoots.push(root);
  return root;
}

function createRequiredUploadSessionStore(overrides = {}) {
  return {
    appendUploadSessionChunk: vi.fn(async () => ({
      ok: true,
      session: {
        sessionId: "session-1",
        checkpointId: "checkpoint-1",
        manifestDigest: "manifest-1",
        status: "receiving",
        files: [{ index: 0, name: "input.txt", byteSize: 4, receivedBytes: 4, completed: true }]
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
    getUploadSession: vi.fn(async (_root, sessionId) => (
      sessionId === "missing"
        ? null
        : {
            sessionId,
            checkpointId: "checkpoint-1",
            manifestDigest: "manifest-1",
            status: "receiving",
            files: []
          }
    )),
    ...overrides
  };
}

function createRequiredJobWorkflow(overrides = {}) {
  const jobs = new Map([
    ["completed", { id: "completed", status: "completed" }],
    ["pending", { id: "pending", status: "running" }]
  ]);
  return {
    createJob: vi.fn(async (payload) => ({ id: "created-job", status: "queued", payload })),
    getJob: vi.fn(async (jobId) => jobs.get(jobId) || null),
    getJobByCheckpointId: vi.fn(async () => null),
    getJobResult: vi.fn(async (jobId) => ({ jobId, ok: true, markdown: "# Result" })),
    listJobs: vi.fn(async ({ limit }) => [{ id: "job-listed", limit }]),
    reparseJob: vi.fn(async (jobId, options) => ({ id: `${jobId}-reparse`, status: "queued", options })),
    ...overrides
  };
}

function createHarness(overrides = {}) {
  const discoveryState = overrides.discoveryState || { mode: "local", advertisedBaseUrl: "http://local" };
  const uploadSessionStore = overrides.uploadSessionStore || createRequiredUploadSessionStore();
  const jobWorkflowProvider = overrides.jobWorkflowProvider || createRequiredJobWorkflow();
  const storageProvider = overrides.storageProvider || {
    readRawObjectById: vi.fn(async (objectId) => (
      objectId === "raw-1"
        ? { contentType: "text/plain", fileName: "raw.txt", buffer: Buffer.from("raw-body") }
        : null
    ))
  };
  const deletionCoordinator = overrides.deletionCoordinator || {
    deleteBatch: vi.fn(async (jobId) => (jobId === "delete-ok" ? { ok: true, id: jobId } : { ok: false }))
  };
  const protocolEventBus = overrides.protocolEventBus || { publish: vi.fn(async () => ({ ok: true })) };
  const proxyApiRequest = overrides.proxyApiRequest || vi.fn(async ({ response, targetBaseUrl }) => {
    response.writeHead(209, { "Content-Type": "application/json", "X-Proxy-Target": targetBaseUrl });
    response.end(JSON.stringify({ proxied: true, targetBaseUrl }));
  });
  const controller = createJobsController({
    userDataPath: overrides.userDataPath || "/tmp/pact-jobs-controller-test",
    jobWorkflowProvider,
    storageProvider,
    deletionCoordinator,
    getDiscoveryState: () => discoveryState,
    proxyApiRequest,
    protocolEventBus,
    loadNormalizedDocumentStore: overrides.loadNormalizedDocumentStore,
    uploadSessionStore,
    resolveArchiveBatchIdentity: overrides.resolveArchiveBatchIdentity
  });

  return {
    controller,
    deletionCoordinator,
    discoveryState,
    jobWorkflowProvider,
    protocolEventBus,
    proxyApiRequest,
    storageProvider,
    uploadSessionStore
  };
}

describe("jobs controller", () => {
  it("validates provider contracts when the controller is created", () => {
    expect(() => createJobsController({
      jobWorkflowProvider: createRequiredJobWorkflow(),
      storageProvider: { readRawObjectById: vi.fn() },
      uploadSessionStore: {}
    })).toThrow(/uploadSessionStore provider is not configured/);

    expect(() => createJobsController({
      jobWorkflowProvider: {},
      storageProvider: { readRawObjectById: vi.fn() },
      uploadSessionStore: createRequiredUploadSessionStore()
    })).toThrow(/jobWorkflowProvider is not configured/);

    expect(() => createJobsController({
      jobWorkflowProvider: createRequiredJobWorkflow(),
      storageProvider: {},
      uploadSessionStore: createRequiredUploadSessionStore()
    })).toThrow(/storageProvider is not configured/);
  });

  it("creates, reads, and appends upload sessions with trace events and failure statuses", async () => {
    const appendUploadSessionChunk = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        session: {
          sessionId: "session-1",
          checkpointId: "checkpoint-1",
          manifestDigest: "manifest-1",
          status: "receiving",
          files: [{ index: 0, name: "input.txt", byteSize: 4, receivedBytes: 4, completed: true }]
        }
      })
      .mockResolvedValueOnce({
        ok: false,
        code: "offset_mismatch",
        expectedOffset: 8,
        session: { sessionId: "session-1", status: "receiving" }
      })
      .mockResolvedValueOnce({
        ok: false,
        code: "not_found",
        expectedOffset: 0,
        session: null
      });
    const { controller, protocolEventBus, uploadSessionStore } = createHarness({
      uploadSessionStore: createRequiredUploadSessionStore({ appendUploadSessionChunk })
    });

    const createResponse = createResponseCapture();
    await controller.handleCreateUploadSession({
      requestBody: jsonBody({
        checkpoint: { checkpointId: "checkpoint-client" },
        manifest: { manifestDigest: "manifest-client", inputDigest: "input-client" },
        files: [{ name: "input.txt", byteSize: 4 }]
      }),
      response: createResponse
    });
    expect(createResponse.statusCode).toBe(200);
    expect(createResponse.json()).toMatchObject({
      sessionId: "session-1",
      checkpointId: "checkpoint-client",
      manifestDigest: "manifest-client"
    });
    expect(uploadSessionStore.createOrResumeUploadSession).toHaveBeenCalledWith(
      expect.objectContaining({
        checkpoint: { checkpointId: "checkpoint-client" },
        manifest: { manifestDigest: "manifest-client", inputDigest: "input-client" }
      })
    );

    const existingResponse = createResponseCapture();
    await controller.handleGetUploadSession({ sessionId: "session-1", response: existingResponse });
    expect(existingResponse.statusCode).toBe(200);
    expect(existingResponse.json()).toMatchObject({ sessionId: "session-1" });

    const missingResponse = createResponseCapture();
    await controller.handleGetUploadSession({ sessionId: "missing", response: missingResponse });
    expect(missingResponse.statusCode).toBe(404);
    expect(missingResponse.json()).toMatchObject({ error: "上传会话不存在。" });

    const chunkResponse = createResponseCapture();
    await controller.handleUploadChunk({
      sessionId: "session-1",
      fileIndex: "0",
      offset: "0",
      requestBody: Buffer.from("data"),
      response: chunkResponse
    });
    expect(chunkResponse.statusCode).toBe(200);
    expect(chunkResponse.json()).toMatchObject({ sessionId: "session-1" });

    const mismatchResponse = createResponseCapture();
    await controller.handleUploadChunk({
      sessionId: "session-1",
      fileIndex: "0",
      offset: "4",
      requestBody: Buffer.from("more"),
      response: mismatchResponse
    });
    expect(mismatchResponse.statusCode).toBe(409);
    expect(mismatchResponse.json()).toMatchObject({
      code: "offset_mismatch",
      expectedOffset: 8
    });

    const notFoundResponse = createResponseCapture();
    await controller.handleUploadChunk({
      sessionId: "missing",
      fileIndex: "0",
      offset: "0",
      requestBody: Buffer.from("data"),
      response: notFoundResponse
    });
    expect(notFoundResponse.statusCode).toBe(404);
    expect(notFoundResponse.json()).toMatchObject({ code: "not_found" });

    expect(protocolEventBus.publish).toHaveBeenCalledWith(
      "uploads.session",
      expect.any(Object),
      expect.objectContaining({ type: "uploads.session.upserted" })
    );
    expect(protocolEventBus.publish).toHaveBeenCalledWith(
      "uploads.session",
      expect.any(Object),
      expect.objectContaining({ type: "uploads.session.chunk.accepted" })
    );
    expect(protocolEventBus.publish.mock.calls.some(([topic]) => topic === "uploads.trace")).toBe(true);
  });

  it("creates jobs from verified uploads, reuses checkpoints, and rejects tampered uploads", async () => {
    const jobWorkflowProvider = createRequiredJobWorkflow();
    const { controller } = createHarness({ jobWorkflowProvider });
    const files = [
      uploadedFile("contract.pdf", Buffer.from("%PDF-1.7\nbody")),
      uploadedFile("mail.eml", "Subject: Test\nDate: Thu, 04 Jun 2026 00:00:00 +0000\n\nBody"),
      uploadedFile("page.html", "<!doctype html><html><body>ok</body></html>"),
      uploadedFile("script.py", "def main():\n    return 1\n"),
      uploadedFile("note.bin", Buffer.from([0, 1, 2, 3]), { mediaType: "application/x-custom" })
    ];

    const response = createResponseCapture();
    await controller.handleCreateJob({
      request: {},
      requestBody: jsonBody({
        checkpoint: { checkpointId: "client-checkpoint", mode: "parse" },
        uploadedFiles: files,
        clientUid: "client-1",
        sourceType: "document-upload",
        providerId: "local",
        syncBatchId: "sync-1",
        sourceMetadata: { ignored: true },
        settings: { parse: true }
      }),
      response
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({ id: "created-job", status: "queued" });
    const createdPayload = jobWorkflowProvider.createJob.mock.calls.at(-1)[0];
    expect(createdPayload.filePaths).toEqual([]);
    expect(createdPayload.checkpoint).toMatchObject({
      clientUid: "client-1",
      sourceType: "document-upload",
      providerId: "local",
      syncBatchId: "sync-1"
    });
    expect(createdPayload.uploadedFiles.map((file) => file.name)).toEqual([
      expect.stringMatching(/\.pdf$/),
      expect.stringMatching(/\.eml$/),
      expect.stringMatching(/\.html$/),
      expect.stringMatching(/\.py$/),
      expect.not.stringMatching(/\.[a-z0-9]+$/)
    ]);
    expect(createdPayload.uploadedFiles[0]).toMatchObject({
      originalFileName: "contract.pdf",
      mediaType: "application/octet-stream",
      clientUid: "client-1"
    });
    expect(createdPayload.uploadedFiles[0].sourceNameHash).not.toBe("contract.pdf");
    expect(createdPayload.uploadedFiles[0].sourceRelativePathHash).not.toBe("contract.pdf");

    jobWorkflowProvider.getJobByCheckpointId.mockResolvedValueOnce({ id: "existing-job", status: "completed" });
    const reuseResponse = createResponseCapture();
    await controller.handleCreateJob({
      request: {},
      requestBody: jsonBody({
        checkpoint: { checkpointId: "client-checkpoint" },
        uploadedFiles: [uploadedFile("same.txt", "same")]
      }),
      response: reuseResponse
    });
    expect(reuseResponse.statusCode).toBe(202);
    expect(reuseResponse.json()).toMatchObject({ id: "existing-job" });

    const tampered = uploadedFile("tampered.txt", "actual", { sha256: "0".repeat(64) });
    await expect(controller.handleCreateJob({
      request: {},
      requestBody: jsonBody({ uploadedFiles: [tampered] }),
      response: createResponseCapture()
    })).rejects.toThrow(/文件哈希校验失败/);
  });

  it("proxies forwarded job creation unless the request is based on an upload session", async () => {
    const forwardHarness = createHarness({
      discoveryState: {
        mode: "forward",
        advertisedBaseUrl: "http://local",
        forwardBaseUrl: "http://upstream",
        activeServiceUrl: "http://active"
      }
    });
    const forwardedResponse = createResponseCapture();
    await forwardHarness.controller.handleCreateJob({
      request: { method: "POST" },
      requestBody: jsonBody({ uploadedFiles: [uploadedFile("input.txt", "input")] }),
      response: forwardedResponse
    });
    expect(forwardedResponse.statusCode).toBe(209);
    expect(forwardHarness.proxyApiRequest).toHaveBeenCalledWith(expect.objectContaining({
      targetBaseUrl: "http://upstream"
    }));
    expect(forwardHarness.jobWorkflowProvider.createJob).not.toHaveBeenCalled();

    const sessionResponse = createResponseCapture();
    await forwardHarness.controller.handleCreateJob({
      request: { method: "POST" },
      requestBody: jsonBody({ uploadSessionId: "session-1", forceNewVersion: true }),
      response: sessionResponse
    });
    expect(sessionResponse.statusCode).toBe(202);
    expect(forwardHarness.uploadSessionStore.buildCheckpointReceiptFromUploadSession)
      .toHaveBeenCalledWith("/tmp/pact-jobs-controller-test", "session-1");
    expect(forwardHarness.jobWorkflowProvider.createJob).toHaveBeenCalledWith(expect.objectContaining({
      checkpointId: "checkpoint-from-session",
      uploadedFiles: []
    }));
  });

  it("handles list/get/reparse/delete/result paths and forward fallbacks", async () => {
    const local = createHarness();

    const listResponse = createResponseCapture();
    await local.controller.handleListJobs({ limit: 5, response: listResponse });
    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json()).toEqual([{ id: "job-listed", limit: 5 }]);

    const getResponse = createResponseCapture();
    await local.controller.handleGetJob({ request: {}, requestBody: Buffer.alloc(0), jobId: "completed", response: getResponse });
    expect(getResponse.statusCode).toBe(200);

    const missingResponse = createResponseCapture();
    await local.controller.handleGetJob({ request: {}, requestBody: Buffer.alloc(0), jobId: "missing", response: missingResponse });
    expect(missingResponse.statusCode).toBe(404);

    const reparseResponse = createResponseCapture();
    await local.controller.handleReparseJob({
      request: {},
      requestBody: jsonBody({ documentParsing: { mode: "plain" }, settings: { force: true } }),
      jobId: "completed",
      response: reparseResponse
    });
    expect(reparseResponse.statusCode).toBe(202);
    expect(local.jobWorkflowProvider.reparseJob).toHaveBeenCalledWith("completed", {
      documentParsing: { mode: "plain" },
      settings: { force: true }
    });
    expect(local.protocolEventBus.publish).toHaveBeenCalledWith(
      "jobs.job",
      expect.objectContaining({ parentJobId: "completed" }),
      expect.objectContaining({ type: "jobs.job.reparse.created" })
    );

    const deleteOkResponse = createResponseCapture();
    await local.controller.handleDeleteJob({
      request: {},
      requestBody: Buffer.alloc(0),
      jobId: "delete-ok",
      response: deleteOkResponse
    });
    expect(deleteOkResponse.statusCode).toBe(200);

    const deleteMissingResponse = createResponseCapture();
    await local.controller.handleDeleteJob({
      request: {},
      requestBody: Buffer.alloc(0),
      jobId: "missing",
      response: deleteMissingResponse
    });
    expect(deleteMissingResponse.statusCode).toBe(404);

    const pendingResultResponse = createResponseCapture();
    await local.controller.handleGetJobResult({
      request: {},
      requestBody: Buffer.alloc(0),
      jobId: "pending",
      response: pendingResultResponse
    });
    expect(pendingResultResponse.statusCode).toBe(409);

    const resultResponse = createResponseCapture();
    await local.controller.handleGetJobResult({
      request: {},
      requestBody: Buffer.alloc(0),
      jobId: "completed",
      response: resultResponse
    });
    expect(resultResponse.statusCode).toBe(200);
    expect(resultResponse.json()).toMatchObject({ jobId: "completed", ok: true });

    const forward = createHarness({
      discoveryState: {
        mode: "forward",
        advertisedBaseUrl: "http://local",
        forwardBaseUrl: "http://upstream"
      },
      deletionCoordinator: { deleteBatch: vi.fn(async () => ({ ok: false })) }
    });
    const forwardedGetResponse = createResponseCapture();
    await forward.controller.handleGetJob({
      request: { method: "GET" },
      requestBody: Buffer.alloc(0),
      jobId: "missing",
      response: forwardedGetResponse
    });
    expect(forwardedGetResponse.statusCode).toBe(209);
    expect(forward.proxyApiRequest).toHaveBeenCalled();
  });

  it("binds job read APIs and raw objects to the authenticated owner", async () => {
    const jobs = new Map([
      ["owned-job", {
        id: "owned-job",
        status: "completed",
        ownerSubjectId: "owner-a",
        ownerUserId: "owner-a",
        archiveBatchId: "batch-owned"
      }],
      ["other-job", {
        id: "other-job",
        status: "completed",
        ownerSubjectId: "owner-b",
        ownerUserId: "owner-b",
        archiveBatchId: "batch-other"
      }]
    ]);
    const jobWorkflowProvider = createRequiredJobWorkflow({
      getJob: vi.fn(async (jobId) => jobs.get(jobId) || null),
      getJobResult: vi.fn(async (jobId) => ({ jobId, ok: true })),
      listJobs: vi.fn(async () => ({
        items: [...jobs.values()],
        summary: { totalCount: jobs.size, activeJobIds: [] }
      }))
    });
    const storageProvider = {
      readRawObjectById: vi.fn(async (objectId) => (
        objectId === "raw-owned"
          ? {
              rawObject: { object_id: objectId, batch_id: "batch-owned" },
              contentType: "text/plain",
              fileName: "owned.txt",
              buffer: Buffer.from("owned")
            }
          : null
      ))
    };
    const { controller } = createHarness({ jobWorkflowProvider, storageProvider });
    const ownerAuth = { user: { userId: "owner-a", roleId: "member", scopes: ["jobs:read"] } };
    const otherAuth = { user: { userId: "owner-b", roleId: "member", scopes: ["jobs:read"] } };
    const adminAuth = { user: { userId: "admin", roleId: "admin", scopes: ["jobs:read"] } };

    const ownerResult = createResponseCapture();
    await controller.handleGetJobResult({
      request: {},
      requestBody: Buffer.alloc(0),
      jobId: "owned-job",
      response: ownerResult,
      authSession: ownerAuth
    });
    expect(ownerResult.statusCode).toBe(200);

    const deniedResult = createResponseCapture();
    await controller.handleGetJobResult({
      request: {},
      requestBody: Buffer.alloc(0),
      jobId: "owned-job",
      response: deniedResult,
      authSession: otherAuth
    });
    expect(deniedResult.statusCode).toBe(403);

    const listResponse = createResponseCapture();
    await controller.handleListJobs({ response: listResponse, authSession: ownerAuth });
    expect(listResponse.json().items.map((job) => job.id)).toEqual(["owned-job"]);

    const ownerRaw = createResponseCapture();
    await controller.handleGetRawObject({
      objectId: "raw-owned",
      response: ownerRaw,
      authSession: ownerAuth
    });
    expect(ownerRaw.statusCode).toBe(200);

    const deniedRaw = createResponseCapture();
    await controller.handleGetRawObject({
      objectId: "raw-owned",
      response: deniedRaw,
      authSession: otherAuth
    });
    expect(deniedRaw.statusCode).toBe(403);

    const adminRaw = createResponseCapture();
    await controller.handleGetRawObject({
      objectId: "raw-owned",
      response: adminRaw,
      authSession: adminAuth
    });
    expect(adminRaw.statusCode).toBe(200);
  });

  it("stores authenticated owner claims on created jobs", async () => {
    const jobWorkflowProvider = createRequiredJobWorkflow();
    const { controller } = createHarness({ jobWorkflowProvider });
    const response = createResponseCapture();
    await controller.handleCreateJob({
      request: { method: "POST" },
      requestBody: jsonBody({
        workspaceId: "ws-owner",
        uploadedFiles: [uploadedFile("note.txt", "hello")]
      }),
      response,
      authSession: {
        user: {
          userId: "owner-a",
          username: "alice",
          roleId: "member",
          tenantId: "tenant-1",
          scopes: ["jobs:read"]
        }
      }
    });
    expect(response.statusCode).toBe(202);
    expect(jobWorkflowProvider.createJob).toHaveBeenCalledWith(expect.objectContaining({
      ownerSubjectId: "owner-a",
      ownerUserId: "owner-a",
      ownerUsername: "alice",
      ownerRoleId: "member",
      ownerTenantId: "tenant-1",
      workspaceId: "ws-owner"
    }));
  });

  it("serves normalized document manifests, document bytes, and raw objects", async () => {
    const userDataPath = await makeTempRoot();
    const documentPath = path.join(userDataPath, "normalized.txt");
    await fs.writeFile(documentPath, "normalized body", "utf8");
    const manifest = {
      documents: [{
        documentId: "doc-1",
        id: "doc-1",
        relativePath: "normalized.txt",
        title: "Normalized Doc"
      }]
    };
    const loadNormalizedDocumentStore = vi.fn(async () => ({
      loadNormalizedDocumentsManifest: vi.fn(async () => manifest),
      normalizedContentType: vi.fn(() => "text/plain; charset=utf-8"),
      resolveNormalizedDocumentEntry: vi.fn((loadedManifest, documentId) => (
        loadedManifest.documents.find((entry) => entry.documentId === documentId || entry.id === documentId) || null
      )),
      resolveNormalizedDocumentPath: vi.fn(() => documentPath)
    }));
    const { controller, storageProvider } = createHarness({ userDataPath, loadNormalizedDocumentStore });

    const manifestResponse = createResponseCapture();
    await controller.handleListNormalizedDocuments({
      request: {},
      requestBody: Buffer.alloc(0),
      jobId: "completed",
      response: manifestResponse
    });
    expect(manifestResponse.statusCode).toBe(200);
    expect(manifestResponse.json()).toEqual(manifest);

    const documentResponse = createResponseCapture();
    await controller.handleGetNormalizedDocument({
      request: {},
      requestBody: Buffer.alloc(0),
      jobId: "completed",
      documentId: "doc-1",
      response: documentResponse
    });
    expect(documentResponse.statusCode).toBe(200);
    expect(documentResponse.headers["Content-Type"]).toBe("text/plain; charset=utf-8");
    expect(documentResponse.headers["Content-Disposition"]).toContain("normalized.txt");
    expect(documentResponse.bodyBuffer().toString("utf8")).toBe("normalized body");

    const missingDocumentResponse = createResponseCapture();
    await controller.handleGetNormalizedDocument({
      request: {},
      requestBody: Buffer.alloc(0),
      jobId: "completed",
      documentId: "missing-doc",
      response: missingDocumentResponse
    });
    expect(missingDocumentResponse.statusCode).toBe(404);
    expect(missingDocumentResponse.json()).toMatchObject({ error: "归一化文档不存在。" });

    const notCompletedResponse = createResponseCapture();
    await controller.handleListNormalizedDocuments({
      request: {},
      requestBody: Buffer.alloc(0),
      jobId: "pending",
      response: notCompletedResponse
    });
    expect(notCompletedResponse.statusCode).toBe(409);

    const missingStoreController = createHarness({
      loadNormalizedDocumentStore: async () => {
        const error = new Error("missing manifest");
        error.code = "ENOENT";
        throw error;
      }
    }).controller;
    const missingManifestResponse = createResponseCapture();
    await missingStoreController.handleListNormalizedDocuments({
      request: {},
      requestBody: Buffer.alloc(0),
      jobId: "completed",
      response: missingManifestResponse
    });
    expect(missingManifestResponse.statusCode).toBe(404);

    const rawResponse = createResponseCapture();
    await controller.handleGetRawObject({ objectId: "raw-1", response: rawResponse });
    expect(rawResponse.statusCode).toBe(200);
    expect(rawResponse.headers["Content-Type"]).toBe("text/plain");
    expect(rawResponse.bodyBuffer().toString("utf8")).toBe("raw-body");
    expect(storageProvider.readRawObjectById).toHaveBeenCalledWith("raw-1");

    const rawMissingResponse = createResponseCapture();
    await controller.handleGetRawObject({ objectId: "missing", response: rawMissingResponse });
    expect(rawMissingResponse.statusCode).toBe(404);
  });

  it("infers additional uploaded file extensions and rejects byte-size mismatches", async () => {
    const jobWorkflowProvider = createRequiredJobWorkflow();
    const { controller } = createHarness({ jobWorkflowProvider });
    const zipBuffer = (entries) => Buffer.from(zipSync(entries));
    const controlBytes = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 14, 15, 16, 17, 18, 19, 20, 21]);
    const files = [
      uploadedFile("empty", Buffer.alloc(0)),
      uploadedFile("photo", Buffer.from([0xff, 0xd8, 0xff, 0x00])),
      uploadedFile("anim", Buffer.from("GIF89a body", "ascii")),
      uploadedFile("slides", zipBuffer({ "ppt/presentation.xml": new Uint8Array([1]) })),
      uploadedFile("document", zipBuffer({ "word/document.xml": new Uint8Array([1]) })),
      uploadedFile("sheet", zipBuffer({ "xl/workbook.xml": new Uint8Array([1]) })),
      uploadedFile("archive", zipBuffer({ "plain.txt": new Uint8Array([1]) })),
      uploadedFile("bad-slides", Buffer.from("PK\x03\x04ppt/presentation.xml", "latin1")),
      uploadedFile("bad-doc", Buffer.from("PK\x03\x04word/document.xml", "latin1")),
      uploadedFile("bad-sheet", Buffer.from("PK\x03\x04xl/workbook.xml", "latin1")),
      uploadedFile("opaque", controlBytes)
    ];

    const response = createResponseCapture();
    await controller.handleCreateJob({
      request: {},
      requestBody: jsonBody({ uploadedFiles: files, forceNewVersion: true }),
      response
    });

    expect(response.statusCode).toBe(202);
    const names = jobWorkflowProvider.createJob.mock.calls.at(-1)[0].uploadedFiles.map((file) => file.name);
    expect(names).toEqual([
      expect.stringMatching(/\.txt$/),
      expect.stringMatching(/\.jpg$/),
      expect.stringMatching(/\.gif$/),
      expect.stringMatching(/\.pptx$/),
      expect.stringMatching(/\.docx$/),
      expect.stringMatching(/\.xlsx$/),
      expect.stringMatching(/\.zip$/),
      expect.stringMatching(/\.pptx$/),
      expect.stringMatching(/\.docx$/),
      expect.stringMatching(/\.xlsx$/),
      expect.not.stringMatching(/\.[a-z0-9]+$/)
    ]);

    const mismatched = uploadedFile("size.txt", "actual", { byteSize: 999 });
    await expect(controller.handleCreateJob({
      request: {},
      requestBody: jsonBody({ uploadedFiles: [mismatched] }),
      response: createResponseCapture()
    })).rejects.toThrow(/文件大小校验失败/);
  });

  it("covers upload-session reuse traces and normalized document fallback branches", async () => {
    const jobWorkflowProvider = createRequiredJobWorkflow({
      getJobByCheckpointId: vi.fn(async (checkpointId) => (
        checkpointId === "checkpoint-from-session" ? { id: "existing-session-job", status: "completed" } : null
      ))
    });
    const { controller, protocolEventBus } = createHarness({ jobWorkflowProvider });

    const reuseResponse = createResponseCapture();
    await controller.handleCreateJob({
      request: {},
      requestBody: jsonBody({ uploadSessionId: "session-1" }),
      response: reuseResponse
    });
    expect(reuseResponse.statusCode).toBe(202);
    expect(reuseResponse.json()).toMatchObject({ id: "existing-session-job" });
    expect(protocolEventBus.publish.mock.calls.some(([, payload]) => (
      payload?.stage === "job_reused" && payload?.jobId === "existing-session-job"
    ))).toBe(true);

    const defaultStoreHarness = createHarness();
    const missingManifestResponse = createResponseCapture();
    await defaultStoreHarness.controller.handleListNormalizedDocuments({
      request: {},
      requestBody: Buffer.alloc(0),
      jobId: "completed",
      response: missingManifestResponse
    });
    expect(missingManifestResponse.statusCode).toBe(404);

    const forward = createHarness({
      discoveryState: {
        mode: "forward",
        advertisedBaseUrl: "http://local",
        forwardBaseUrl: "http://upstream",
        activeServiceUrl: "http://active"
      }
    });
    const forwardListResponse = createResponseCapture();
    await forward.controller.handleListNormalizedDocuments({
      request: { method: "GET" },
      requestBody: Buffer.alloc(0),
      jobId: "missing",
      response: forwardListResponse
    });
    expect(forwardListResponse.statusCode).toBe(209);

    const forwardDocumentResponse = createResponseCapture();
    await forward.controller.handleGetNormalizedDocument({
      request: { method: "GET" },
      requestBody: Buffer.alloc(0),
      jobId: "missing",
      documentId: "doc-1",
      response: forwardDocumentResponse
    });
    expect(forwardDocumentResponse.statusCode).toBe(209);
    expect(forward.proxyApiRequest).toHaveBeenCalledTimes(2);
  });
});
