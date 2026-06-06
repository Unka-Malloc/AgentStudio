import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const startCheckpointTreeMock = vi.hoisted(() => vi.fn(async () => undefined));
const upsertCheckpointNodeMock = vi.hoisted(() => vi.fn(async () => undefined));
const finishCheckpointTreeMock = vi.hoisted(() => vi.fn(async () => undefined));
const deleteCheckpointTreeMock = vi.hoisted(() => vi.fn(async () => undefined));
const checkpointTreeIdMock = vi.hoisted(() => vi.fn((kind, ...parts) => {
  const suffix = parts.filter(Boolean).join("_") || "root";
  return `checkpoint_tree_${kind}_${suffix}`;
}));

vi.mock("../../../server/platform/common/data-structure/checkpoint-tree-store.mjs", () => ({
  checkpointTreeId: checkpointTreeIdMock,
  deleteCheckpointTree: deleteCheckpointTreeMock,
  finishCheckpointTree: finishCheckpointTreeMock,
  startCheckpointTree: startCheckpointTreeMock,
  upsertCheckpointNode: upsertCheckpointNodeMock
}));

import {
  appendUploadSessionChunk,
  buildCheckpointReceiptFromUploadSession,
  createOrResumeUploadSession,
  deleteUploadSession,
  getUploadSession,
  resolveUploadSessionFiles
} from "../../../server/protocols/checkpoint/upload-session-store.mjs";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function withTempUserData(testCase) {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-upload-session-store-extra-"));
  try {
    return await testCase(userDataPath);
  } finally {
    await fs.rm(userDataPath, { recursive: true, force: true });
  }
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

function sessionMetaPath(userDataPath, sessionId) {
  return path.join(userDataPath, "upload-sessions", sessionId, "meta.json");
}

function sessionFilePath(userDataPath, sessionId, fileIndex) {
  return path.join(userDataPath, "upload-sessions", sessionId, "files", `${fileIndex}.part`);
}

beforeEach(() => {
  startCheckpointTreeMock.mockClear();
  upsertCheckpointNodeMock.mockClear();
  finishCheckpointTreeMock.mockClear();
  deleteCheckpointTreeMock.mockClear();
  checkpointTreeIdMock.mockClear();
});

describe("upload-session store extra coverage", () => {
  it("creates, resumes, reads, resolves and deletes an upload session end to end", async () => {
    await withTempUserData(async (userDataPath) => {
      const created = await createOrResumeUploadSession({
        userDataPath,
        checkpoint: {
          checkpointId: "client-checkpoint-1",
          archiveBatchId: "archive-batch-1",
          clientUid: "client-a",
          sourceType: "mail"
        },
        manifest: {
          manifestDigest: sha256("manifest-a"),
          inputDigest: sha256("input-a")
        },
        files: [
          {
            relativePath: "nested\\inbox\\message.eml",
            sha256: sha256("hello world"),
            byteSize: 11,
            mediaType: "message/rfc822"
          }
        ]
      });

      expect(created).toMatchObject({
        checkpointId: expect.any(String),
        sessionId: expect.any(String),
        archiveBatchId: "archive-batch-1",
        clientUid: "client-a",
        sourceType: "mail",
        status: "uploading",
        files: [
          {
            index: 0,
            originalFileName: "message.eml",
            completed: false,
            receivedBytes: 0
          }
        ]
      });
      expect(startCheckpointTreeMock).toHaveBeenCalledTimes(1);
      expect(upsertCheckpointNodeMock).toHaveBeenCalled();

      const metaPath = sessionMetaPath(userDataPath, created.sessionId);
      const filePath = sessionFilePath(userDataPath, created.sessionId, 0);
      await expect(fs.stat(metaPath)).resolves.toBeTruthy();
      await expect(fs.stat(filePath)).rejects.toThrow();

      const resume = await createOrResumeUploadSession({
        userDataPath,
        checkpoint: {
          checkpointId: "client-checkpoint-1",
          archiveBatchId: "archive-batch-1"
        },
        manifest: {
          manifestDigest: sha256("manifest-a"),
          inputDigest: sha256("input-a")
        }
      });

      expect(resume.sessionId).toBe(created.sessionId);
      expect(resume.status).toBe("uploading");

      const append = await appendUploadSessionChunk({
        userDataPath,
        sessionId: created.sessionId,
        fileIndex: 0,
        offset: 0,
        buffer: Buffer.from("hello world")
      });

      expect(append).toMatchObject({
        ok: true,
        code: "ok",
        session: {
          sessionId: created.sessionId,
          status: "complete"
        }
      });

      const session = await getUploadSession(userDataPath, created.sessionId);
      expect(session).toMatchObject({
        sessionId: created.sessionId,
        status: "complete",
        files: [
          {
            index: 0,
            originalFileName: "message.eml",
            receivedBytes: 11,
            completed: true
          }
        ]
      });

      const resolvedFiles = await resolveUploadSessionFiles(userDataPath, created.sessionId);
      expect(resolvedFiles).toHaveLength(1);
      expect(resolvedFiles[0]).toMatchObject({
        name: expect.any(String),
        relativePath: expect.any(String),
        originalFileName: "message.eml",
        archiveBatchId: "archive-batch-1",
        stagedPath: filePath
      });

      const receipt = await buildCheckpointReceiptFromUploadSession(userDataPath, created.sessionId);
      expect(receipt).toMatchObject({
        checkpointId: expect.any(String),
        archiveBatchId: "archive-batch-1",
        clientUid: "client-a",
        sourceType: "mail",
        fileCount: 1,
        files: [
          {
            originalFileName: "message.eml",
            byteSize: 11,
            sha256: sha256("hello world")
          }
        ]
      });

      await deleteUploadSession(userDataPath, created.sessionId);
      await expect(fs.stat(metaPath)).rejects.toThrow();
      await expect(fs.stat(path.join(userDataPath, "upload-sessions", created.sessionId))).rejects.toThrow();
      expect(deleteCheckpointTreeMock).toHaveBeenCalledTimes(1);
    });
  });

  it("rejects invalid tokens, missing files, unsafe paths and digest validation failures", async () => {
    await withTempUserData(async (userDataPath) => {
      await expect(
        createOrResumeUploadSession({
          userDataPath,
          checkpoint: { checkpointId: "" },
          manifest: { manifestDigest: sha256("manifest-b") }
        })
      ).rejects.toThrow("upload session 缺少 checkpointId。");

      await expect(
        createOrResumeUploadSession({
          userDataPath,
          checkpoint: { checkpointId: "client-checkpoint-2" },
          manifest: { manifestDigest: "not-a-sha256" }
        })
      ).rejects.toThrow("manifestDigest 必须是 sha256 hex。");

      await expect(
        createOrResumeUploadSession({
          userDataPath,
          checkpoint: { checkpointId: "client-checkpoint-2" },
          manifest: { manifestDigest: sha256("manifest-c") },
          files: [
            {
              relativePath: "../escape.txt",
              sha256: sha256("payload"),
              byteSize: 7
            }
          ]
        })
      ).rejects.toThrow("上传路径不安全，已拒绝。");

      const created = await createOrResumeUploadSession({
        userDataPath,
        checkpoint: { checkpointId: "client-checkpoint-3" },
        manifest: { manifestDigest: sha256("manifest-d"), inputDigest: sha256("input-d") },
        files: [
          {
            relativePath: "folder\\child.txt",
            sha256: sha256("payload"),
            byteSize: 7
          }
        ]
      });

      const meta = await readJson(sessionMetaPath(userDataPath, created.sessionId));
      expect(meta.files[0]).toMatchObject({
        originalFileName: "child.txt",
        receivedBytes: 0,
        completedAt: ""
      });

      await expect(getUploadSession(userDataPath, "not-a-session-token")).resolves.toBeNull();
      await expect(resolveUploadSessionFiles(userDataPath, "not-a-session-token")).rejects.toThrow(
        /token 格式无效/
      );

      const missing = await appendUploadSessionChunk({
        userDataPath,
        sessionId: created.sessionId,
        fileIndex: 1,
        offset: 0,
        buffer: Buffer.from("x")
      });
      expect(missing).toMatchObject({
        ok: false,
        code: "file_not_found"
      });

      const invalidTokenResult = await appendUploadSessionChunk({
        userDataPath,
        sessionId: "invalid-session-token",
        fileIndex: 0,
        offset: 0,
        buffer: Buffer.from("x")
      });
      expect(invalidTokenResult).toMatchObject({
        ok: false,
        code: "not_found",
        session: null
      });

      const offsetMismatch = await appendUploadSessionChunk({
        userDataPath,
        sessionId: created.sessionId,
        fileIndex: 0,
        offset: 1,
        buffer: Buffer.from("pay")
      });
      expect(offsetMismatch).toMatchObject({
        ok: false,
        code: "offset_mismatch",
        expectedOffset: 0
      });

      const tooLarge = await appendUploadSessionChunk({
        userDataPath,
        sessionId: created.sessionId,
        fileIndex: 0,
        offset: 0,
        buffer: Buffer.from("payload-too-large")
      });
      expect(tooLarge).toMatchObject({
        ok: false,
        code: "chunk_too_large"
      });
    });
  });

  it("reconciles tampered files, returns null for missing sessions and clears a valid session", async () => {
    await withTempUserData(async (userDataPath) => {
      const created = await createOrResumeUploadSession({
        userDataPath,
        checkpoint: {
          checkpointId: "client-checkpoint-4",
          archiveBatchId: "archive-batch-4"
        },
        manifest: {
          manifestDigest: sha256("manifest-e"),
          inputDigest: sha256("input-e")
        },
        files: [
          {
            relativePath: "message.txt",
            sha256: sha256("data"),
            byteSize: 4
          }
        ]
      });

      await appendUploadSessionChunk({
        userDataPath,
        sessionId: created.sessionId,
        fileIndex: 0,
        offset: 0,
        buffer: Buffer.from("data")
      });

      const filePath = sessionFilePath(userDataPath, created.sessionId, 0);

      await fs.writeFile(filePath, Buffer.from("data++"));
      const truncated = await getUploadSession(userDataPath, created.sessionId);
      expect(truncated.files[0]).toMatchObject({
        receivedBytes: 4,
        completed: true
      });

      await fs.writeFile(filePath, Buffer.from("oops"));
      const mismatch = await getUploadSession(userDataPath, created.sessionId);
      expect(mismatch.files[0]).toMatchObject({
        receivedBytes: 0,
        completed: false
      });

      const metaPath = sessionMetaPath(userDataPath, created.sessionId);
      const meta = await readJson(metaPath);
      meta.files[0].receivedBytes = 0;
      meta.files[0].completedAt = "2026-01-01T00:00:00.000Z";
      meta.files[0].verifiedSha256 = "deadbeef";
      meta.updatedAt = "2026-01-01T00:00:00.000Z";
      await fs.writeFile(metaPath, `${JSON.stringify(meta, null, 2)}\n`, "utf8");

      const cleared = await getUploadSession(userDataPath, created.sessionId);
      expect(cleared.files[0]).toMatchObject({
        receivedBytes: 0,
        completed: false,
        completedAt: ""
      });

      await expect(resolveUploadSessionFiles(userDataPath, created.sessionId)).rejects.toThrow(
        `上传会话尚未完成：${created.sessionId}`
      );
      await expect(buildCheckpointReceiptFromUploadSession(userDataPath, created.sessionId)).rejects.toThrow(
        `上传会话尚未完成：${created.sessionId}`
      );

      await expect(deleteUploadSession(userDataPath, "")).resolves.toBeUndefined();
      expect(deleteCheckpointTreeMock).not.toHaveBeenCalledWith(
        expect.objectContaining({ treeId: expect.any(String) })
      );
    });
  });
});
