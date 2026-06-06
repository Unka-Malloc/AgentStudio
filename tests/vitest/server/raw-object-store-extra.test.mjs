import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

import {
  getRawMailObjectRoot,
  persistRawMailObject,
  resolveStoredObjectPath
} from "../../../server/platform/common/storage/raw-object-store.mjs";

const tempRoots = [];

async function tempDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pact-raw-object-store-"));
  tempRoots.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

describe("raw object store", () => {
  it("persists raw mail objects with sanitized archive path and normalized metadata", async () => {
    const userDataPath = await tempDir();
    const buffer = Buffer.from("From: test@example.test\n\nhello", "utf8");
    const result = await persistRawMailObject({
      userDataPath,
      batchId: "batch 01/unsafe",
      buffer,
      originalRelativePath: "\\Inbox/../safe.eml".replace("../", ""),
      originalSourcePath: "/Users/alice/Mail/safe.eml",
      sourceContainerPath: "/Users/alice/Mail",
      mediaType: "",
      ingestOrigin: "mail-import",
      clientUid: " desktop/a ",
      sourceType: "mail folder",
      providerId: 42,
      externalId: "external-1",
      syncBatchId: "sync-1",
      contentHash: "",
      capturedAt: "",
      sourceMetadata: ["not-object"],
      sourceCreatedAt: "2026-06-01T00:00:00.000Z",
      sourceUpdatedAt: "2026-06-02T00:00:00.000Z",
      sourceCollectedAt: "2026-06-03T00:00:00.000Z"
    });

    expect(getRawMailObjectRoot(userDataPath)).toBe(path.join(userDataPath, "objects"));
    expect(result).toMatchObject({
      ingestOrigin: "mail-import",
      clientUid: "desktop_a",
      sourceType: "mail_folder",
      archiveFileName: "safe__batch_01_unsafe.eml",
      originalFileName: "safe.eml",
      originalRelativePath: "Inbox/safe.eml",
      providerId: "42",
      externalId: "external-1",
      syncBatchId: "sync-1",
      contentHash: sha256(buffer),
      capturedAt: "2026-06-03T00:00:00.000Z",
      sourceMetadata: {},
      mediaType: "message/rfc822",
      sha256: sha256(buffer),
      byteSize: buffer.length,
      sourceCreatedAt: "2026-06-01T00:00:00.000Z",
      sourceUpdatedAt: "2026-06-02T00:00:00.000Z",
      sourceCollectedAt: "2026-06-03T00:00:00.000Z",
      createdAt: expect.any(String)
    });
    expect(result.storageRelativePath).toBe("objects/desktop_a/mail_folder/safe__batch_01_unsafe.eml");
    await expect(fs.readFile(resolveStoredObjectPath(userDataPath, result.storageRelativePath), "utf8")).resolves.toBe(buffer.toString("utf8"));
    expect(result.originalSourcePath).toMatch(/^[a-f0-9]{64}$/);
    expect(result.originalSourcePath).not.toBe("/Users/alice/Mail/safe.eml");
    expect(result.sourceContainerPath).toMatch(/^[a-f0-9]{64}$/);
    expect(result.sourceContainerPath).not.toBe("/Users/alice/Mail");
  });

  it("reuses same-content archive path and suffixes same-name different-content objects", async () => {
    const userDataPath = await tempDir();
    const firstBuffer = Buffer.from("first");
    const secondBuffer = Buffer.from("second");

    const first = await persistRawMailObject({
      userDataPath,
      batchId: "batch-1",
      buffer: firstBuffer,
      originalRelativePath: "mail/message.eml",
      clientUid: "client",
      sourceType: "mail"
    });
    const duplicate = await persistRawMailObject({
      userDataPath,
      batchId: "batch-1",
      buffer: firstBuffer,
      originalRelativePath: "mail/message.eml",
      clientUid: "client",
      sourceType: "mail"
    });
    const different = await persistRawMailObject({
      userDataPath,
      batchId: "batch-1",
      buffer: secondBuffer,
      originalRelativePath: "mail/message.eml",
      clientUid: "client",
      sourceType: "mail"
    });

    expect(duplicate.storageRelativePath).toBe(first.storageRelativePath);
    expect(different.storageRelativePath).not.toBe(first.storageRelativePath);
    expect(different.archiveFileName).toBe(`message__batch-1__${sha256(secondBuffer).slice(0, 12)}.eml`);
    await expect(fs.readFile(resolveStoredObjectPath(userDataPath, different.storageRelativePath), "utf8")).resolves.toBe("second");
  });

  it("rejects unsafe or empty relative paths and resolveStoredObjectPath blocks traversal", async () => {
    const userDataPath = await tempDir();
    const common = {
      userDataPath,
      batchId: "batch",
      buffer: Buffer.from("body")
    };

    await expect(persistRawMailObject({
      ...common,
      originalRelativePath: ""
    })).rejects.toThrow("原始邮件缺少可持久化的文件名。");
    await expect(persistRawMailObject({
      ...common,
      originalRelativePath: "safe/../escape.eml"
    })).rejects.toThrow("原始邮件路径不安全，已拒绝写入。");
    await expect(() => resolveStoredObjectPath(userDataPath, "../outside")).toThrow();
  });
});
