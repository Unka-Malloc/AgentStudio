import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { unzipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const collectProtectedRawObjectPathsMock = vi.hoisted(() => vi.fn(async () => new Set()));
const createImportEntryIdMock = vi.hoisted(() => vi.fn());
const persistRawMailObjectMock = vi.hoisted(() =>
  vi.fn(async (payload = {}) => ({
    objectId: "object-001",
    storageRelativePath: "objects/raw/object-001.bin",
    ...payload
  }))
);
const checkpointStoreMocks = vi.hoisted(() => ({
  createImportEntryId: createImportEntryIdMock,
  hydrateImportCheckpointSources: vi.fn(async ({ sources = [] } = {}) => sources),
  loadImportCheckpointEntry: vi.fn(async () => null),
  rawObjectPathsFromSources: vi.fn((sources = []) =>
    (Array.isArray(sources) ? sources : [])
      .map((entry) => String(entry?.rawObject?.storageRelativePath || "").trim())
      .filter(Boolean)
  ),
  saveImportCheckpointEntry: vi.fn(async () => undefined),
  validateImportCheckpointEntry: vi.fn(async () => false),
  collectProtectedRawObjectPaths: collectProtectedRawObjectPathsMock,
  cleanupImportArtifacts: vi.fn(async () => ({
    deletedTempFiles: [],
    deletedRawObjectFiles: []
  }))
}));

const documentParserExtractDocumentMock = vi.hoisted(() => vi.fn());

vi.mock("../../../server/platform/common/storage/import-resume-store.mjs", () => ({
  ...checkpointStoreMocks
}));

vi.mock("../../../server/platform/common/storage/raw-object-store.mjs", () => ({
  persistRawMailObject: persistRawMailObjectMock
}));

import {
  createFileRoutingDecision,
  isSupportedImportFilePath,
  readInputSources
} from "../../../server/platform/specialized/knowledge/preprocessing/file-processor/index.mjs";
import { generateNormalizedDocuments } from "../../../server/platform/specialized/knowledge/preprocessing/file-processor/FileNormalizer/NormalizedDocuments/index.mjs";
import { getNormalizedDocumentsDirectory } from "../../../server/platform/specialized/knowledge/preprocessing/file-processor/FileNormalizer/NormalizedDocuments/store.mjs";

let importEntryCounter = 0;

async function withTempRoot(prefix, callback) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    return await callback(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function writeText(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, value, "utf8");
}

function makeRuntime(overrides = {}) {
  return {
    mounts: {
      documentParser: {
        enabled: true,
        id: "document-parser",
        extractDocument: documentParserExtractDocumentMock,
        ...overrides.documentParser
      },
      ...overrides
    }
  };
}

function docxText(documentPath) {
  const payload = fs.readFile(documentPath).then((buffer) => {
    const entries = unzipSync(new Uint8Array(buffer));
    return Buffer.from(entries["word/document.xml"] || []).toString("utf8");
  });
  return payload;
}

beforeEach(() => {
  importEntryCounter = 0;
  createImportEntryIdMock.mockReset().mockImplementation(() => {
    importEntryCounter += 1;
    return `entry-${String(importEntryCounter).padStart(4, "0")}`;
  });
  collectProtectedRawObjectPathsMock.mockReset().mockResolvedValue(new Set());
  checkpointStoreMocks.hydrateImportCheckpointSources.mockReset().mockResolvedValue([]);
  checkpointStoreMocks.loadImportCheckpointEntry.mockReset().mockResolvedValue(null);
  checkpointStoreMocks.rawObjectPathsFromSources.mockReset().mockImplementation((sources = []) =>
    (Array.isArray(sources) ? sources : [])
      .map((entry) => String(entry?.rawObject?.storageRelativePath || "").trim())
      .filter(Boolean)
  );
  checkpointStoreMocks.saveImportCheckpointEntry.mockReset().mockResolvedValue(undefined);
  checkpointStoreMocks.validateImportCheckpointEntry.mockReset().mockResolvedValue(false);
  checkpointStoreMocks.cleanupImportArtifacts.mockReset().mockResolvedValue({
    deletedTempFiles: [],
    deletedRawObjectFiles: []
  });
  persistRawMailObjectMock.mockReset().mockImplementation(async (payload = {}) => ({
    objectId: "object-001",
    storageRelativePath: "objects/raw/object-001.bin",
    ...payload
  }));
  documentParserExtractDocumentMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("file processor path and parser boundaries", () => {
  it("recognizes supported import paths and returns false for read failures", async () => {
    await withTempRoot("pact-file-processor-support-", async (root) => {
      const supported = path.join(root, "notes.md");
      const missing = path.join(root, "missing.zzz");
      await writeText(supported, "# title\n\nbody");

      const routingDecision = createFileRoutingDecision({
        buffer: Buffer.alloc(0),
        mediaTypeHint: "application/pdf",
        allowTextFallback: false
      });

      expect(routingDecision).toMatchObject({
        extension: ".pdf",
        kind: "pdf",
        selectedSource: "media-type"
      });
      await expect(isSupportedImportFilePath(supported)).resolves.toBe(true);
      await expect(isSupportedImportFilePath(missing)).resolves.toBe(false);
    });
  });

  it("normalizes parser output, metadata, raw objects, and empty-content fallback across files and uploads", async () => {
    await withTempRoot("pact-file-processor-parse-", async (root) => {
      const sourceDir = path.join(root, "incoming");
      await writeText(
        path.join(sourceDir, "message-ok.eml"),
        [
          "From: ops@example.test",
          "To: team@example.test",
          "Subject: Routed message",
          "Content-Type: message/rfc822",
          "",
          "body"
        ].join("\n")
      );
      await writeText(
        path.join(sourceDir, "message-empty.eml"),
        [
          "From: ops@example.test",
          "Subject: Empty message",
          "Content-Type: message/rfc822",
          "",
          ""
        ].join("\n")
      );

      documentParserExtractDocumentMock.mockImplementation(async ({ fileName }) => {
        if (String(fileName || "").includes("message-empty")) {
          return {
            parserId: "document-parser",
            text: "",
            metadata: {
              "Content-Type": "message/rfc822"
            },
            warnings: ["  empty parser warning  "]
          };
        }

        if (String(fileName || "").includes("upload-ok")) {
          return "  Uploaded body  ";
        }

        return {
          parserId: "document-parser",
          text: "  Parsed body  \r\nSecond line  ",
          metadata: {
            "Content-Type": "message/rfc822",
            "X-Source": "filesystem"
          },
          embeddedDocuments: [
            {
              text: "  child body  ",
              metadata: {
                part: "body"
              }
            }
          ],
          warnings: [" parser warning "],
          failureReason: {
            reasonCode: "parser_note",
            message: "parser note"
          }
        };
      });

      const result = await readInputSources({
        filePaths: [sourceDir],
        uploadedFiles: [
          {
            originalFileName: "upload-ok.eml",
            dataBase64: Buffer.from(
              [
                "From: upload@example.test",
                "Subject: Upload",
                "Content-Type: message/rfc822",
                "",
                "ignored"
              ].join("\n")
            ).toString("base64"),
            providerId: "provider-upload",
            sourceMetadata: {
              upload: true
            }
          }
        ],
        inputText: "  pasted line 1  \r\nline 2  ",
        batchId: "batch-001",
        archiveBatchId: "archive-001",
        providerId: "provider-top",
        externalId: "external-top",
        syncBatchId: "sync-top",
        contentHash: "hash-top",
        capturedAt: "2026-06-05T00:00:00.000Z",
        userDataPath: root,
        settings: {},
        generatedAt: "2026-06-05T00:00:00.000Z",
        runtime: makeRuntime()
      });

      expect(result.sources).toHaveLength(3);
      expect(result.sources[0]).toMatchObject({
        id: "pasted-text",
        kind: "text",
        text: "pasted line 1  \nline 2"
      });

      const parsed = result.sources.find((entry) => entry.name === "message-ok.eml");
      expect(parsed).toMatchObject({
        kind: "email",
        text: "Parsed body  \nSecond line",
        documentParserId: "document-parser",
        documentMetadata: {
          "Content-Type": "message/rfc822",
          "X-Source": "filesystem"
        },
        warnings: ["parser warning"],
        failureReason: {
          reasonCode: "parser_note",
          message: "parser note"
        }
      });
      expect(parsed.embeddedDocuments).toEqual([
        {
          id: "embedded-1",
          text: "child body",
          metadata: {
            part: "body"
          }
        }
      ]);
      expect(parsed.rawObject).toMatchObject({
        objectId: "object-001",
        storageRelativePath: "objects/raw/object-001.bin"
      });
      expect(parsed.sourceMetadata).toMatchObject({
        providerId: "provider-top",
        externalId: "external-top",
        syncBatchId: "sync-top",
        capturedAt: "2026-06-05T00:00:00.000Z"
      });

      const upload = result.sources.find((entry) => entry.name === "upload-ok.eml");
      expect(upload).toMatchObject({
        kind: "email",
        text: "Uploaded body",
        sourceMetadata: {
          upload: true,
          providerId: "provider-upload",
          externalId: "external-top",
          syncBatchId: "sync-top",
          capturedAt: "2026-06-05T00:00:00.000Z"
        }
      });

      expect(result.warnings.some((message) => message.includes("message-empty.eml"))).toBe(true);
      expect(result.warnings.some((message) => message.includes("没有提取到邮件正文"))).toBe(true);
      expect(result.failureReasons.some((entry) => entry.reasonCode === "email_body_not_extracted")).toBe(true);
      expect(persistRawMailObjectMock).toHaveBeenCalled();
    });
  });

  it("rejects empty input, empty directories, and failing attachments with distinct reason codes", async () => {
    await withTempRoot("pact-file-processor-empty-", async (root) => {
      const emptyDir = path.join(root, "empty-dir");
      await fs.mkdir(emptyDir, { recursive: true });

      await expect(
        readInputSources({
          userDataPath: root,
          settings: {},
          generatedAt: "2026-06-05T00:00:00.000Z"
        })
      ).rejects.toMatchObject({
        reasonCode: "document_parse_input_missing"
      });

      await expect(
        readInputSources({
          filePaths: [emptyDir],
          userDataPath: root,
          settings: {},
          generatedAt: "2026-06-05T00:00:00.000Z"
        })
      ).rejects.toMatchObject({
        reasonCode: "document_parse_no_usable_content"
      });

      documentParserExtractDocumentMock.mockImplementation(async ({ fileName }) => {
        if (String(fileName || "").includes("upload-fail")) {
          throw new Error("upload parser exploded");
        }
        return {
          parserId: "document-parser",
          text: "ok"
        };
      });

      const rejected = await readInputSources({
        uploadedFiles: [
          {
            originalFileName: "upload-fail.eml",
            dataBase64: Buffer.from("From: upload@example.test\n\nbody").toString("base64")
          }
        ],
        userDataPath: root,
        settings: {},
        generatedAt: "2026-06-05T00:00:00.000Z",
        runtime: makeRuntime()
      }).catch((error) => error);

      expect(rejected).toMatchObject({
        reasonCode: "document_parse_no_usable_content"
      });
      expect(rejected.failureReasons).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            reasonCode: "upload_input_parse_failed",
            sourceKind: "upload",
            details: {
              error: "upload parser exploded"
            }
          })
        ])
      );
    });
  });
});

describe("normalized document generation coverage", () => {
  it("covers mail, presentation, pdf, html, markdown, and fallback adapters with small fixtures", async () => {
    await withTempRoot("pact-normalized-docs-", async (userDataPath) => {
      const jobId = "job-rich-fixtures";
      const manifest = await generateNormalizedDocuments({
        userDataPath,
        jobId,
        generatedAt: "2026-06-05T00:00:00.000Z",
        sources: [
          {
            id: "presentation-1",
            name: "deck.pptx",
            path: "workspace/deck.pptx",
            kind: "presentation",
            originalRelativePath: "workspace/deck.pptx",
            originalBuffer: Buffer.from("pptx"),
            text: "Slide one\n\nSlide two"
          },
          {
            id: "pdf-1",
            name: "scan.pdf",
            path: "docs/scan.pdf",
            kind: "pdf",
            originalRelativePath: "docs/scan.pdf",
            originalBuffer: Buffer.from("%PDF-1.7"),
            text: "Page one\fPage two",
            visualElements: [
              {
                kind: "image",
                sequence: 1,
                title: "Figure 1",
                fileName: "figure-001.png",
                mediaType: "image/png",
                imageDataUrl:
                  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAC0lEQVR42mP8/x8AAwMCAO+kvxkAAAAASUVORK5CYII="
              },
              {
                kind: "table",
                sequence: 1,
                title: "Table 1",
                markdown: "|A|B|\n|---|---|\n|1|2|",
                index: 1,
                rowCount: 1,
                columnCount: 2,
                extractionMethod: "ocr"
              }
            ]
          },
          {
            id: "html-1",
            name: "page.html",
            path: "web/page.html",
            kind: "document",
            originalRelativePath: "web/page.html",
            originalBuffer: Buffer.from("<h1>Alpha</h1>"),
            text: "<h1>Alpha</h1>",
            warnings: [" html warning "]
          },
          {
            id: "markdown-1",
            name: "notes.md",
            path: "notes/notes.md",
            kind: "document",
            originalRelativePath: "notes/notes.md",
            originalBuffer: Buffer.from("# Notes"),
            text: "# Notes\n\n- Item",
            warnings: [" markdown warning "]
          },
          {
            id: "fallback-1",
            name: "blob.bin",
            path: "blob.bin",
            kind: "blob",
            text: "Fallback content"
          }
        ],
        chunks: [
          {
            sourceId: "html-1",
            id: "chunk-html-1",
            titlePath: ["HTML", "正文"],
            content: "Alpha chunk",
            sourceRange: "1-2",
            sourceStartLine: 1,
            sourceEndLine: 2
          },
          {
            sourceId: "markdown-1",
            id: "chunk-md-1",
            titlePath: ["Notes"],
            content: "Markdown chunk",
            sourceRange: "1-1",
            sourceStartLine: 1,
            sourceEndLine: 1
          }
        ],
        analysis: {
          emails: [
            {
              id: "mail-1",
              subject: "",
              excerpt: "",
              body: "",
              sourceId: "mail-1",
              sourceName: "mail.eml",
              sourcePath: "mail/mail.eml"
            }
          ],
          threads: [
            {
              id: "thread-1",
              subject: "",
              messageIds: ["mail-1"],
              summary: "",
              startedAt: "2026-06-05T00:00:00.000Z",
              latestActivityAt: "2026-06-05T01:00:00.000Z",
              status: "open",
              cadence: "daily"
            }
          ],
          transactions: [
            {
              id: "txn-1",
              title: "",
              messageIds: ["mail-1"],
              threadIds: ["thread-1"],
              participantIds: ["p-1"],
              summary: "",
              decisions: ["Ship"],
              pendingItems: ["Follow up"]
            }
          ],
          timeline: [
            {
              id: "event-1",
              transactionId: "txn-1",
              timestamp: "2026-06-05T00:00:00.000Z",
              title: "Created",
              summary: "Started"
            }
          ]
        }
      });

      expect(manifest.packageType).toBe("pact.normalized-documents");
      expect(manifest.summary).toMatchObject({
        documentCount: 16,
        sourceMaterialCount: 3,
        assetCount: 1
      });
      expect(manifest.summary.byGranularity).toMatchObject({
        message: 1,
        thread: 1,
        transaction: 1,
        deck: 1,
        section: 3,
        slide: 2,
        document: 2,
        page: 1,
        "page-window": 1,
        block: 1,
        source: 1,
        "visual-table": 1
      });
      expect(manifest.assets).toHaveLength(1);
      expect(manifest.assets[0]).toMatchObject({
        artifactType: "image",
        mediaType: "image/png"
      });

      const normalizedRoot = getNormalizedDocumentsDirectory(userDataPath, jobId);
      const messageDoc = manifest.documents.find((entry) => entry.granularity === "message");
      expect(messageDoc).toBeTruthy();
      const messageDocXml = await docxText(path.join(normalizedRoot, messageDoc.relativePath));
      expect(messageDocXml).toContain("未提取到正文。");

      const pdfDoc = manifest.documents.find(
        (entry) => entry.adapterId === "builtin/pdf-adapter" && entry.granularity === "document"
      );
      expect(pdfDoc).toBeTruthy();
      const pdfDocXml = await docxText(path.join(normalizedRoot, pdfDoc.relativePath));
      expect(pdfDocXml).toContain("PDF 已提取视觉元素");
      expect(pdfDocXml).toContain("解析备注");

      const htmlDoc = manifest.documents.find(
        (entry) => entry.adapterId === "builtin/html-adapter" && entry.granularity === "page"
      );
      expect(htmlDoc).toBeTruthy();
      await expect(fs.stat(path.join(normalizedRoot, htmlDoc.relativePath))).resolves.toBeTruthy();

      const sourceMaterialPaths = manifest.sourceMaterials.map((entry) =>
        path.join(normalizedRoot, entry.relativePath)
      );
      await Promise.all(sourceMaterialPaths.map((entryPath) => fs.stat(entryPath)));
    });
  });
});
