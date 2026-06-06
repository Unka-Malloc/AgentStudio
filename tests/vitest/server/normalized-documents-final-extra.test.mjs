import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock(
  "../../../server/platform/specialized/knowledge/document-export/docx-human-renderer.mjs",
  async () => {
    const actual = await vi.importActual(
      "../../../server/platform/specialized/knowledge/document-export/docx-human-renderer.mjs"
    );
    return {
      ...actual,
      renderHumanDocxBodyBlocks(text, options) {
        if (String(text || "").includes("__explode__")) {
          throw new Error("render exploded");
        }
        return actual.renderHumanDocxBodyBlocks(text, options);
      }
    };
  }
);

import { generateNormalizedDocuments } from "../../../server/platform/specialized/knowledge/preprocessing/file-processor/FileNormalizer/NormalizedDocuments/index.mjs";
import {
  getNormalizedDocumentsDirectory,
  getNormalizedManifestPath,
  loadNormalizedDocumentsManifest,
  resolveNormalizedDocumentEntry,
  resolveNormalizedDocumentPath
} from "../../../server/platform/specialized/knowledge/preprocessing/file-processor/FileNormalizer/NormalizedDocuments/store.mjs";

const tempRoots = [];

async function withTempUserData(callback) {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-normalized-documents-final-extra-"));
  tempRoots.push(userDataPath);
  return callback(userDataPath);
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("normalized documents final extra coverage", () => {
  it("covers html, presentation, and pdf branches with preserved source material, assets, and fallback sections", async () => {
    await withTempUserData(async (userDataPath) => {
      const manifest = await generateNormalizedDocuments({
        userDataPath,
        jobId: "job-multi-format",
        generatedAt: "2026-06-05T00:00:00.000Z",
        sources: [
          {
            id: "html-1",
            name: "",
            path: "workspace/site/page.html",
            originalRelativePath: "incoming/site/page.html",
            kind: "document",
            mediaType: "text/html",
            originalBuffer: Buffer.from("<html><body><h1>HTML</h1></body></html>"),
            text: "HTML Heading\n\nFirst block\n\nSecond block"
          },
          {
            id: "ppt-1",
            name: "",
            path: "workspace/deck.pptx",
            originalRelativePath: "incoming/deck.pptx",
            kind: "document",
            mediaType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            originalBuffer: Buffer.from("PK\u0003\u0004presentation"),
            text: "--- page: 1 ---\nSlide one\n\n--- page: 2 ---\nSlide two"
          },
          {
            id: "pdf-1",
            name: "",
            path: "workspace/paper.pdf",
            originalRelativePath: "incoming/paper.pdf",
            kind: "pdf",
            mediaType: "application/pdf",
            originalBuffer: Buffer.from("%PDF-1.4\n%mock\n"),
            text: "Page 1\n\n--- page 2 ---\nPage 2\n\n--- page 3 ---\nPage 3\n\n--- page 4 ---\nPage 4",
            chunks: undefined,
            visualElements: [
              {
                kind: "image",
                sequence: 2,
                page: 2,
                title: "Valid figure",
                fileName: "figure-2.png",
                imageDataUrl:
                  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2XvwsAAAAASUVORK5CYII="
              },
              {
                kind: "image",
                sequence: 3,
                page: 3,
                title: "Broken figure",
                fileName: "broken.png",
                imageDataUrl: "not-a-data-url"
              },
              {
                kind: "table",
                sequence: 1,
                page: 4,
                index: 7,
                title: "Table Alpha",
                markdown: "| a | b |\n| --- | --- |\n| 1 | 2 |"
              }
            ]
          }
        ],
        chunks: [
          {
            id: "html-chunk-1",
            sourceId: "html-1",
            titlePath: ["Section A"],
            content: "First block\n\nSecond block",
            text: "First block\n\nSecond block",
            metadata: { sourceRange: "1-2", sourceLocator: "section-a" }
          },
          {
            id: "ppt-chunk-1",
            sourceId: "ppt-1",
            titlePath: ["Intro"],
            content: "Intro content\n\n- Alpha\n- Beta",
            metadata: { sourceRange: "1-9", sourceLocator: "intro" }
          },
          {
            id: "pdf-chunk-1",
            sourceId: "pdf-1",
            titlePath: [""],
            content: "",
            text: "",
            metadata: { sourceRange: "", sourceLocator: "" }
          }
        ],
        analysis: {}
      });

      expect(manifest.packageType).toBe("pact.normalized-documents");
      expect(manifest.summary).toMatchObject({
        documentCount: manifest.documents.length,
        sourceMaterialCount: manifest.sourceMaterials.length,
        assetCount: 1
      });
      expect(manifest.sourceMaterials).toHaveLength(3);
      expect(manifest.assets).toHaveLength(1);
      expect(manifest.warnings).toEqual([]);

      expect(manifest.summary.byGranularity.page).toBe(1);
      expect(manifest.summary.byGranularity.section).toBeGreaterThanOrEqual(3);
      expect(manifest.summary.byGranularity.block).toBe(1);
      expect(manifest.summary.byGranularity.deck).toBe(1);
      expect(manifest.summary.byGranularity.document).toBe(1);
      expect(manifest.summary.byGranularity["page-window"]).toBeGreaterThanOrEqual(1);
      expect(manifest.summary.byGranularity.slide).toBeGreaterThanOrEqual(1);
      expect(manifest.summary.byGranularity["visual-table"]).toBe(1);

      const htmlPage = manifest.documents.find((entry) => entry.granularity === "page");
      const presentationDoc = manifest.documents.find(
        (entry) => entry.granularity === "deck" && entry.adapterId === "builtin/presentation-adapter"
      );
      const pdfDoc = manifest.documents.find(
        (entry) => entry.granularity === "document" && entry.adapterId === "builtin/pdf-adapter"
      );
      const visualTable = manifest.documents.find((entry) => entry.granularity === "visual-table");

      expect(htmlPage).toMatchObject({
        artifactType: "docx",
        adapterId: "builtin/html-adapter",
        title: "workspace/site/page.html - HTML 页面"
      });
      expect(presentationDoc).toMatchObject({
        adapterId: "builtin/presentation-adapter",
        title: "workspace/deck.pptx - 全局演示文稿"
      });
      expect(pdfDoc).toMatchObject({
        adapterId: "builtin/pdf-adapter",
        title: "workspace/paper.pdf - PDF 全文"
      });
      expect(visualTable).toMatchObject({
        granularity: "visual-table",
        title: "workspace/paper.pdf - Table 1"
      });

      const htmlMaterial = manifest.sourceMaterials.find((entry) => entry.adapterId === "builtin/html-adapter");
      const pptMaterial = manifest.sourceMaterials.find((entry) => entry.adapterId === "builtin/presentation-adapter");
      const pdfMaterial = manifest.sourceMaterials.find((entry) => entry.adapterId === "builtin/pdf-adapter");
      expect(htmlMaterial).toMatchObject({
        granularity: "source-material",
        title: "workspace/site/page.html 原始材料"
      });
      expect(pptMaterial).toMatchObject({
        granularity: "source-material",
        title: "workspace/deck.pptx 原始材料"
      });
      expect(pdfMaterial).toMatchObject({
        granularity: "source-material",
        title: "workspace/paper.pdf 原始材料"
      });

      const manifestFromDisk = await loadNormalizedDocumentsManifest(userDataPath, "job-multi-format");
      expect(manifestFromDisk.summary).toEqual(manifest.summary);

      const htmlEntry = resolveNormalizedDocumentEntry(manifestFromDisk, htmlPage.documentId);
      const htmlDocPath = resolveNormalizedDocumentPath(userDataPath, "job-multi-format", htmlEntry);
      await expect(fs.stat(htmlDocPath)).resolves.toBeTruthy();
      const htmlRelativePath = path.relative(
        getNormalizedDocumentsDirectory(userDataPath, "job-multi-format"),
        htmlDocPath
      );
      expect(htmlRelativePath.split(path.sep)[0]).toBe("sources");
      expect(htmlRelativePath.endsWith("page.docx")).toBe(true);

      const pdfAssetPath = resolveNormalizedDocumentPath(
        userDataPath,
        "job-multi-format",
        manifest.assets[0]
      );
      await expect(fs.stat(pdfAssetPath)).resolves.toBeTruthy();

      const manifestPath = getNormalizedManifestPath(userDataPath, "job-multi-format");
      await expect(fs.stat(manifestPath)).resolves.toBeTruthy();
    });
  });

  it("falls back to source-level output and records adapter failures as warnings", async () => {
    await withTempUserData(async (userDataPath) => {
      const manifest = await generateNormalizedDocuments({
        userDataPath,
        jobId: "job-fallback-and-error",
        generatedAt: "2026-06-05T00:00:00.000Z",
        sources: [
          {
            id: "blob-1",
            name: "",
            path: "",
            kind: "blob",
            text: "孤立内容"
          },
          {
            id: "broken-md",
            name: "broken.md",
            path: "workspace/broken.md",
            originalRelativePath: "incoming/broken.md",
            kind: "document",
            mediaType: "text/markdown",
            text: "__explode__ markdown payload"
          },
          {
            id: "mail-1",
            name: "mail.eml",
            path: "workspace/mail.eml",
            kind: "email",
            text: "ignored"
          }
        ],
        chunks: [],
        analysis: {}
      });

      expect(manifest.documents).toHaveLength(1);
      expect(manifest.documents[0]).toMatchObject({
        adapterId: "builtin/fallback-adapter",
        granularity: "source",
        title: "blob-1 - 归一化来源文档"
      });
      expect(manifest.sourceMaterials).toEqual([]);
      expect(manifest.assets).toEqual([]);
      expect(manifest.warnings).toEqual([
        "broken.md 归一化失败：render exploded"
      ]);
      expect(manifest.summary).toMatchObject({
        documentCount: 1,
        sourceMaterialCount: 0,
        assetCount: 0,
        byGranularity: { source: 1 }
      });

      const loaded = await loadNormalizedDocumentsManifest(userDataPath, "job-fallback-and-error");
      expect(loaded.documents).toEqual(manifest.documents);
      const sourceEntry = resolveNormalizedDocumentEntry(loaded, manifest.documents[0].documentId);
      const sourcePath = resolveNormalizedDocumentPath(userDataPath, "job-fallback-and-error", sourceEntry);
      await expect(fs.stat(sourcePath)).resolves.toBeTruthy();
      expect(path.basename(sourcePath)).toBe("source.docx");
    });
  });

  it("derives visual image extensions and handles long or empty source text boundaries", async () => {
    await withTempUserData(async (userDataPath) => {
      const tinyImage = "AQIDBA==";
      const longMarkdown = `${"Long paragraph ".repeat(2400)}\n\nTail`;
      const manifest = await generateNormalizedDocuments({
        userDataPath,
        jobId: "job-media-boundaries",
        generatedAt: "2026-06-05T00:00:00.000Z",
        sources: [
          {
            id: "pdf-media",
            name: "media.pdf",
            path: "workspace/media.pdf",
            originalRelativePath: "incoming/media.pdf",
            kind: "pdf",
            mediaType: "application/pdf",
            originalBuffer: Buffer.from("%PDF-1.4\n"),
            text: "",
            visualElements: [
              { kind: "image", sequence: 1, imageDataUrl: `data:image/jpeg;base64,${tinyImage}` },
              { kind: "image", sequence: 2, imageDataUrl: `data:image/png;base64,${tinyImage}` },
              { kind: "image", sequence: 3, imageDataUrl: `data:image/webp;base64,${tinyImage}` },
              { kind: "image", sequence: 4, imageDataUrl: `data:image/gif;base64,${tinyImage}` },
              { kind: "image", sequence: 5, imageDataUrl: `data:image/tiff;base64,${tinyImage}` },
              { kind: "image", sequence: 6, imageDataUrl: `data:;base64,${tinyImage}` }
            ]
          },
          {
            id: "markdown-long",
            name: "long.md",
            path: "workspace/long.md",
            originalRelativePath: "incoming/long.md",
            kind: "document",
            mediaType: "text/markdown",
            originalBuffer: Buffer.from(longMarkdown),
            text: longMarkdown,
            warnings: ["long markdown warning"]
          }
        ],
        chunks: [],
        analysis: {}
      });

      expect(manifest.assets.map((asset) => path.basename(asset.relativePath))).toEqual([
        "visual-001.jpg",
        "visual-002.png",
        "visual-003.webp",
        "visual-004.gif",
        "visual-005.tiff",
        "visual-006.bin"
      ]);
      expect(manifest.summary.assetCount).toBe(6);
      expect(manifest.summary.byGranularity["visual-image"]).toBeUndefined();
      expect(manifest.documents.some((entry) =>
        entry.adapterId === "builtin/markdown-adapter" && entry.granularity === "document"
      )).toBe(true);
      expect(manifest.documents.some((entry) =>
        entry.adapterId === "builtin/pdf-adapter" && entry.granularity === "page-window"
      )).toBe(true);

      for (const asset of manifest.assets) {
        const assetPath = resolveNormalizedDocumentPath(userDataPath, "job-media-boundaries", asset);
        await expect(fs.stat(assetPath)).resolves.toBeTruthy();
      }
    });
  });
});
