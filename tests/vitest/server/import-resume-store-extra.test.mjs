import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  cleanupImportArtifacts,
  collectProtectedRawObjectPaths,
  createImportEntryId,
  getImportCheckpointDirectory,
  hashFileSha256,
  hydrateImportCheckpointSources,
  listImportCheckpointEntries,
  loadImportCheckpointEntry,
  rawObjectPathsFromSources,
  removeImportCheckpoint,
  saveImportCheckpointEntry,
  validateImportCheckpointEntry
} from "../../../server/platform/common/storage/import-resume-store.mjs";

const tempRoots = [];

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function tempDir(prefix) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

async function writeText(root, relativePath, content = "") {
  const filePath = path.join(root, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, String(content), "utf8");
  return filePath;
}

async function writeJson(root, relativePath, value) {
  return writeText(root, relativePath, JSON.stringify(value, null, 2));
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("import-resume-store extra coverage", () => {
  it("creates stable entry ids, resolves checkpoint directories and rejects unsafe ids", async () => {
    const userDataPath = await tempDir("pact-import-resume-id-");
    const payloadA = {
      batchId: "batch-a",
      inputKind: "mail",
      sources: [
        {
          kind: "text",
          rawObject: { storageRelativePath: "objects/client/raw__batch-a.bin" },
          metadata: { z: 1, a: [2, { k: "v" }] }
        }
      ]
    };
    const payloadB = {
      sources: [
        {
          metadata: { a: [2, { k: "v" }], z: 1 },
          rawObject: { storageRelativePath: "objects/client/raw__batch-a.bin" },
          kind: "text"
        }
      ],
      inputKind: "mail",
      batchId: "batch-a"
    };

    expect(createImportEntryId(payloadA)).toBe(createImportEntryId(payloadB));
    expect(createImportEntryId({ ...payloadA, batchId: "batch-b" })).not.toBe(createImportEntryId(payloadA));

    expect(getImportCheckpointDirectory(userDataPath, "batch-a")).toBe(
      path.join(userDataPath, "jobs", "batch-a", "import-checkpoint")
    );
    expect(() => getImportCheckpointDirectory(userDataPath, "../../../escape")).toThrow("路径越界，已拒绝。");

    await expect(
      loadImportCheckpointEntry({ userDataPath, batchId: "batch-a", entryId: "not-a-valid-entry" })
    ).rejects.toThrow("导入断点 entryId 无效。");

    await expect(removeImportCheckpoint({ userDataPath, batchId: "" })).resolves.toBeUndefined();
  });

  it("saves, updates, lists and removes checkpoint entries while preserving createdAt", async () => {
    const userDataPath = await tempDir("pact-import-resume-save-");
    const batchId = "batch-state";
    const checkpointDir = getImportCheckpointDirectory(userDataPath, batchId);
    const rawRelativePath = "objects/client/raw__batch-state.bin";
    const rawFilePath = await writeText(userDataPath, rawRelativePath, "raw-object-bytes");
    const checkpointMaterialPath = await writeText(userDataPath, "tmp/checkpoint-material.txt", "checkpoint-material");
    const entryId = createImportEntryId({ batchId, inputKind: "mail", rawRelativePath });

    expect(await hashFileSha256(rawFilePath)).toBe(sha256("raw-object-bytes"));

    const created = await saveImportCheckpointEntry({
      userDataPath,
      batchId,
      entryId,
      inputKind: "mail",
      signature: { z: 1, a: { nested: [2, 3] } },
      sources: [
        {
          kind: "text",
          rawObject: {
            storageRelativePath: rawRelativePath,
            byteSize: "16",
            sha256: sha256("raw-object-bytes")
          },
          checkpointMaterialPath,
          originalBuffer: Buffer.from("should-not-persist"),
          imageBuffer: Buffer.from("image-should-not-persist"),
          imageDataUrl: "data:text/plain;base64,c2hvdWxkLW5vdC1wZXJzaXN0"
        }
      ],
      warnings: [null, "needs-review"],
      failureReasons: "ignored-non-array"
    });

    expect(created).toMatchObject({
      schemaVersion: 1,
      entryId,
      batchId,
      inputKind: "mail",
      status: "completed",
      warnings: ["", "needs-review"],
      failureReasons: [],
      sources: [
        {
          kind: "text",
          rawObject: {
            storageRelativePath: rawRelativePath,
            byteSize: "16",
            sha256: sha256("raw-object-bytes")
          },
          checkpointMaterialPath
        }
      ]
    });
    expect(created.createdAt).toBe(created.updatedAt);

    const persistedPath = path.join(checkpointDir, "entries", `${entryId}.json`);
    const persisted = JSON.parse(await fs.readFile(persistedPath, "utf8"));
    expect(persisted.sources[0]).not.toHaveProperty("originalBuffer");
    expect(persisted.sources[0]).not.toHaveProperty("imageBuffer");
    expect(persisted.sources[0]).not.toHaveProperty("imageDataUrl");
    expect(persisted.manifest).toBeUndefined();

    const loaded = await loadImportCheckpointEntry({ userDataPath, batchId, entryId });
    expect(loaded).toMatchObject({
      entryId,
      batchId,
      status: "completed",
      warnings: ["", "needs-review"]
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    const updated = await saveImportCheckpointEntry({
      userDataPath,
      batchId,
      entryId,
      inputKind: "document",
      signature: { a: { nested: [2, 3] }, z: 1 },
      sources: created.sources,
      warnings: ["follow-up"],
      failureReasons: []
    });

    expect(updated.createdAt).toBe(created.createdAt);
    expect(updated.updatedAt).not.toBe(created.updatedAt);
    expect(updated.inputKind).toBe("document");

    const manifest = JSON.parse(await fs.readFile(path.join(checkpointDir, "manifest.json"), "utf8"));
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      batchId,
      updatedAt: updated.updatedAt
    });

    const listed = await listImportCheckpointEntries({ userDataPath, batchId });
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      entryId,
      batchId,
      inputKind: "document"
    });

    await removeImportCheckpoint({ userDataPath, batchId });
    await expect(fs.stat(checkpointDir)).rejects.toThrow();
    await expect(loadImportCheckpointEntry({ userDataPath, batchId, entryId })).resolves.toBeNull();
  });

  it("handles missing records, malformed files and damaged JSON", async () => {
    const userDataPath = await tempDir("pact-import-resume-read-");
    const batchId = "batch-read";

    await expect(listImportCheckpointEntries({ userDataPath, batchId })).resolves.toEqual([]);
    await expect(loadImportCheckpointEntry({ userDataPath, batchId, entryId: "a".repeat(40) })).resolves.toBeNull();

    const validEntryId = "b".repeat(40);
    const skippedEntryId = "c".repeat(40);
    const corruptEntryId = "d".repeat(40);

    await writeText(
      userDataPath,
      path.join("jobs", batchId, "import-checkpoint", "entries", "not-an-entry.txt"),
      "ignored"
    );
    await writeJson(
      userDataPath,
      path.join("jobs", batchId, "import-checkpoint", "entries", `${skippedEntryId}.json`),
      {
        schemaVersion: 2,
        entryId: skippedEntryId,
        batchId,
        status: "completed"
      }
    );
    await writeJson(
      userDataPath,
      path.join("jobs", batchId, "import-checkpoint", "entries", `${validEntryId}.json`),
      {
        schemaVersion: 1,
        entryId: validEntryId,
        batchId,
        status: "completed",
        signature: { ok: true },
        sources: []
      }
    );

    const listed = await listImportCheckpointEntries({ userDataPath, batchId });
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      entryId: validEntryId,
      schemaVersion: 1
    });

    await writeText(
      userDataPath,
      path.join("jobs", batchId, "import-checkpoint", "entries", `${corruptEntryId}.json`),
      "{\"schemaVersion\":1"
    );
    await expect(
      loadImportCheckpointEntry({ userDataPath, batchId, entryId: corruptEntryId })
    ).rejects.toThrow(SyntaxError);
  });

  it("hydrates sources from checkpoint material, raw objects and fallback paths", async () => {
    const userDataPath = await tempDir("pact-import-resume-hydrate-");
    const fallbackRawRelativePath = "objects/client/fallback__batch-hydrate.bin";
    await writeText(userDataPath, fallbackRawRelativePath, "fallback-bytes");
    const staleMaterialPath = await writeText(userDataPath, "tmp/stale-material.txt", "stale-material");
    const pathSourcePath = await writeText(userDataPath, "tmp/path-source.txt", "path-bytes");
    const imagePath = await writeText(userDataPath, "tmp/image-source.bin", "image-bytes");

    const hydrated = await hydrateImportCheckpointSources({
      userDataPath,
      sources: [
        {
          kind: "text",
          checkpointMaterialPath: staleMaterialPath,
          rawObject: { storageRelativePath: fallbackRawRelativePath },
          originalSha256: sha256("fallback-bytes")
        },
        {
          kind: "text",
          path: pathSourcePath,
          originalSha256: sha256("path-bytes")
        },
        {
          kind: "image",
          path: imagePath,
          mediaType: "image/png"
        },
        {
          kind: "text",
          path: `${pathSourcePath}#fragment`
        }
      ]
    });

    expect(hydrated).toHaveLength(4);
    expect(hydrated[0].originalBuffer?.toString()).toBe("fallback-bytes");
    expect(hydrated[0].checkpointMaterialPath).toBe(staleMaterialPath);
    expect(hydrated[1].originalBuffer?.toString()).toBe("path-bytes");
    expect(hydrated[2]).toMatchObject({
      kind: "image",
      mediaType: "image/png"
    });
    expect(hydrated[2].originalBuffer?.toString()).toBe("image-bytes");
    expect(hydrated[2].imageBuffer?.toString()).toBe("image-bytes");
    expect(hydrated[2].imageDataUrl).toBe(
      `data:image/png;base64,${Buffer.from("image-bytes").toString("base64")}`
    );
    expect(hydrated[3]).not.toHaveProperty("originalBuffer");
  });

  it("validates protected raw objects and cleans temporary artifacts selectively", async () => {
    const userDataPath = await tempDir("pact-import-resume-cleanup-");
    const batchId = "batch-cleanup";
    const rawRelativePath = "objects/client/keep__batch-cleanup.bin";
    const deleteRelativePath = "objects/client/delete__batch-cleanup.bin";
    const rawFilePath = await writeText(userDataPath, rawRelativePath, "keep-me");
    const deleteFilePath = await writeText(userDataPath, deleteRelativePath, "delete-me");
    const imagePath = await writeText(userDataPath, "tmp/image-material.txt", "image-material");
    const oldTempPath = await writeText(userDataPath, "tmp/tika/old.txt", "old-temp");
    const freshTempPath = await writeText(userDataPath, "tmp/ocr/fresh.txt", "fresh-temp");
    const oldTime = new Date(Date.now() - 60_000);
    await fs.utimes(oldTempPath, oldTime, oldTime);
    await fs.utimes(deleteFilePath, oldTime, oldTime);

    const entryId = "e".repeat(40);
    const entry = await saveImportCheckpointEntry({
      userDataPath,
      batchId,
      entryId,
      inputKind: "mail",
      signature: { kind: "cleanup", a: [1, 2], z: 3 },
      sources: [
        {
          kind: "text",
          rawObject: {
            storageRelativePath: rawRelativePath,
            byteSize: String("keep-me".length),
            sha256: sha256("keep-me")
          }
        },
        {
          kind: "image",
          checkpointMaterialPath: imagePath,
          mediaType: "image/png"
        }
      ]
    });

    expect(
      rawObjectPathsFromSources([
        {
          rawObject: {
            storageRelativePath: `\\${rawRelativePath}`
          }
        }
      ])
    ).toEqual([rawRelativePath]);
    expect(rawObjectPathsFromSources(entry.sources)).toEqual([rawRelativePath]);

    expect(
      await validateImportCheckpointEntry({
        userDataPath,
        entry,
        expectedSignature: { z: 3, a: [1, 2], kind: "cleanup" }
      })
    ).toBe(true);
    expect(
      await validateImportCheckpointEntry({
        userDataPath,
        entry,
        expectedSignature: { kind: "different" }
      })
    ).toBe(false);

    const protectedPaths = await collectProtectedRawObjectPaths({
      userDataPath,
      batchId,
      expectedEntries: [
        { entryId, signature: { a: [1, 2], kind: "cleanup", z: 3 } },
        { entryId: "f".repeat(40), signature: { missing: true } }
      ]
    });
    expect(protectedPaths).toEqual(new Set([rawRelativePath]));

    const cleanup = await cleanupImportArtifacts({
      userDataPath,
      batchId,
      protectedRawObjectPaths: protectedPaths,
      tempMinimumAgeMs: 1000
    });

    expect(cleanup.deletedTempFiles).toContain("tmp/tika/old.txt");
    expect(cleanup.deletedTempFiles).not.toContain("tmp/ocr/fresh.txt");
    expect(cleanup.deletedRawObjectFiles).toEqual([deleteRelativePath]);

    await expect(fs.stat(rawFilePath)).resolves.toBeTruthy();
    await expect(fs.stat(deleteFilePath)).rejects.toThrow();
    await expect(fs.stat(oldTempPath)).rejects.toThrow();
    await expect(fs.stat(freshTempPath)).resolves.toBeTruthy();
  });
});
