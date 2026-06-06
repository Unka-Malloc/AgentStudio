import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { generateNormalizedDocuments } from "../../../server/platform/specialized/knowledge/preprocessing/file-processor/FileNormalizer/NormalizedDocuments/index.mjs";
import {
  NORMALIZED_DOCUMENTS_DIR,
  NORMALIZED_MANIFEST_FILE,
  getJobDirectory,
  getNormalizedDocumentsDirectory,
  getNormalizedManifestPath,
  loadNormalizedDocumentsManifest,
  listNormalizedManifestEntries,
  resolveNormalizedDocumentEntry,
  resolveNormalizedDocumentPath,
  normalizedContentType,
} from "../../../server/platform/specialized/knowledge/preprocessing/file-processor/FileNormalizer/NormalizedDocuments/store.mjs";

const tempRoots = [];

async function withTempUserData(callback) {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-normalized-documents-extra-"));
  tempRoots.push(userDataPath);
  return callback(userDataPath);
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("normalized documents path helpers", () => {
  it("builds job, directory, and manifest paths from fixed constants", () => {
    const userDataPath = "/tmp/pact-user-data";
    const jobId = "job-boundary";

    expect(getJobDirectory(userDataPath, jobId)).toBe(path.join(userDataPath, "jobs", jobId));
    expect(getNormalizedDocumentsDirectory(userDataPath, jobId)).toBe(
      path.join(userDataPath, "jobs", jobId, NORMALIZED_DOCUMENTS_DIR)
    );
    expect(getNormalizedManifestPath(userDataPath, jobId)).toBe(
      path.join(userDataPath, "jobs", jobId, NORMALIZED_DOCUMENTS_DIR, NORMALIZED_MANIFEST_FILE)
    );
    expect(resolveNormalizedDocumentPath(userDataPath, jobId, { relativePath: "sources/test.docx" })).toBe(
      path.join(getNormalizedDocumentsDirectory(userDataPath, jobId), "sources", "test.docx")
    );
    expect(resolveNormalizedDocumentPath(userDataPath, jobId, {})).toBe(
      getNormalizedDocumentsDirectory(userDataPath, jobId)
    );
  });

  it("maps known extensions to stable content types", () => {
    expect(normalizedContentType("notes.docx")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    expect(normalizedContentType("slides.ppt")).toBe("application/vnd.ms-powerpoint");
    expect(normalizedContentType("report.html")).toBe("text/html; charset=utf-8");
    expect(normalizedContentType("config.yaml")).toBe("application/yaml; charset=utf-8");
    expect(normalizedContentType("mystery.bin")).toBe("application/octet-stream");
  });

  it("accepts in-bounds relative paths and rejects traversal paths", () => {
    const userDataPath = "/tmp/pact-user-data";
    const jobId = "job-boundary";
    const rootPath = getNormalizedDocumentsDirectory(userDataPath, jobId);
    expect(resolveNormalizedDocumentPath(userDataPath, jobId, { relativePath: "source-materials/report.docx" }))
      .toBe(path.join(rootPath, "source-materials", "report.docx"));
    expect(resolveNormalizedDocumentPath(userDataPath, jobId, { relativePath: "" })).toBe(rootPath);

    expect(() => resolveNormalizedDocumentPath(userDataPath, jobId, { relativePath: "../manifest.json" }))
      .toThrow("归一化文档路径越界。");
    expect(() => resolveNormalizedDocumentPath(userDataPath, jobId, { relativePath: "/etc/passwd" }))
      .toThrow("归一化文档路径越界。");
  });
});

describe("normalized documents store persistence", () => {
  it("writes manifest and source material files, then load + resolve entries from persisted store", async () => {
    await withTempUserData(async (userDataPath) => {
      const jobId = "job-manifest-save-load";
      const generatedAt = "2026-06-04T00:00:00.000Z";
      const manifest = await generateNormalizedDocuments({
        userDataPath,
        jobId,
        generatedAt,
        sources: [
          {
            id: "source-1",
            name: "report.html",
            path: "workspace/report.html",
            originalRelativePath: "incoming/report.html",
            kind: "document",
            originalBuffer: Buffer.from("<h1>归一化测试文档</h1>\n<p>第一段落。</p>\n<p>第二段落。</p>"),
            text: "归一化测试文档\n\n第一段落。\n\n第二段落。"
          }
        ],
        chunks: [],
        analysis: {}
      });

      expect(manifest.packageType).toBe("pact.normalized-documents");
      expect(manifest.packageRole).toBe("external-knowledge-corpus");
      expect(manifest.batchId).toBe(jobId);
      expect(manifest.generatedAt).toBe(generatedAt);
      expect(manifest.documents.length).toBeGreaterThan(0);
      expect(manifest.sourceMaterials.length).toBe(1);
      expect(manifest.summary.documentCount).toBe(manifest.documents.length);
      expect(manifest.summary.sourceMaterialCount).toBe(manifest.sourceMaterials.length);

      const manifestPath = getNormalizedManifestPath(userDataPath, jobId);
      const loaded = await loadNormalizedDocumentsManifest(userDataPath, jobId);
      expect(await fs.readFile(manifestPath, "utf8")).toMatch(/"packageType": "pact.normalized-documents"/);
      expect(loaded.batchId).toBe(jobId);
      expect(loaded.documents).toEqual(manifest.documents);
      expect(loaded.sourceMaterials).toEqual(manifest.sourceMaterials);
      expect(listNormalizedManifestEntries(loaded).length).toBe(
        manifest.documents.length + manifest.sourceMaterials.length
      );

      const documentEntry = resolveNormalizedDocumentEntry(loaded, manifest.documents[0].documentId);
      expect(documentEntry).toMatchObject({
        documentId: manifest.documents[0].documentId,
        relativePath: manifest.documents[0].relativePath
      });
      const documentPath = resolveNormalizedDocumentPath(userDataPath, jobId, documentEntry);
      const documentBuffer = await fs.readFile(documentPath);
      expect(documentBuffer.length).toBeGreaterThan(0);

      const materialEntry = resolveNormalizedDocumentEntry(loaded, manifest.sourceMaterials[0].documentId);
      expect(materialEntry).toMatchObject({
        documentId: manifest.sourceMaterials[0].documentId,
        relativePath: manifest.sourceMaterials[0].relativePath
      });
      const materialPath = resolveNormalizedDocumentPath(userDataPath, jobId, materialEntry);
      const materialBuffer = await fs.readFile(materialPath);
      expect(materialBuffer.toString("utf8")).toContain("归一化测试文档");
    });
  });

  it("returns ENOENT for missing manifest load and null for unmatched entry", async () => {
    await withTempUserData(async (userDataPath) => {
      await expect(loadNormalizedDocumentsManifest(userDataPath, "missing-job")).rejects.toMatchObject({
        code: "ENOENT"
      });

      expect(listNormalizedManifestEntries({})).toEqual([]);
      expect(resolveNormalizedDocumentEntry({}, "anything")).toBeNull();
      expect(resolveNormalizedDocumentEntry({ documents: "bad" }, "anything")).toBeNull();
      expect(resolveNormalizedDocumentEntry({ documents: [{ id: "legacy-id", relativePath: "legacy.txt" }] }, "missing")).toBeNull();
    });
  });

  it("handles boundary generate input with empty sources by still generating empty manifest artifact", async () => {
    await withTempUserData(async (userDataPath) => {
      const jobId = "job-empty-input";
      const manifest = await generateNormalizedDocuments({
        userDataPath,
        jobId,
        sources: [],
        chunks: [],
        analysis: {},
        generatedAt: "2026-06-04T00:00:00.000Z"
      });

      const loaded = await loadNormalizedDocumentsManifest(userDataPath, jobId);
      expect(manifest.documents).toHaveLength(0);
      expect(loaded.documents).toHaveLength(0);
      expect(loaded.sourceMaterials).toEqual([]);
      expect(loaded.summary).toMatchObject({ documentCount: 0, sourceMaterialCount: 0, assetCount: 0 });
      await expect(fs.stat(getNormalizedManifestPath(userDataPath, jobId))).resolves.toBeTruthy();
      await expect(fs.stat(path.join(getNormalizedDocumentsDirectory(userDataPath, jobId), "manifest.yaml"))).resolves.toBeTruthy();
    });
  });
});
