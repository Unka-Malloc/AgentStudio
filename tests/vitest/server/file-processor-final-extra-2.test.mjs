import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { strToU8, zipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const collectProtectedRawObjectPathsMock = vi.hoisted(() => vi.fn(async () => new Set()));
const createImportEntryIdMock = vi.hoisted(() => vi.fn());
const cleanupImportArtifactsMock = vi.hoisted(() =>
  vi.fn(async () => ({
    deletedTempFiles: [],
    deletedRawObjectFiles: []
  }))
);
const hydrateImportCheckpointSourcesMock = vi.hoisted(() => vi.fn(async ({ sources = [] } = {}) => sources));
const loadImportCheckpointEntryMock = vi.hoisted(() => vi.fn(async () => null));
const rawObjectPathsFromSourcesMock = vi.hoisted(() =>
  vi.fn((sources = []) =>
    (Array.isArray(sources) ? sources : [])
      .map((entry) => String(entry?.rawObject?.storageRelativePath || "").trim())
      .filter(Boolean)
  )
);
const saveImportCheckpointEntryMock = vi.hoisted(() => vi.fn(async () => undefined));
const validateImportCheckpointEntryMock = vi.hoisted(() => vi.fn(async () => false));
const persistRawMailObjectMock = vi.hoisted(() =>
  vi.fn(async (payload = {}) => ({
    objectId: "object-001",
    storageRelativePath: "objects/raw/object-001.bin",
    ...payload
  }))
);
const documentParserExtractDocumentMock = vi.hoisted(() => vi.fn());
const pdfProcessorExtractDocumentMock = vi.hoisted(() => vi.fn());

vi.mock("../../../server/platform/common/storage/import-resume-store.mjs", () => ({
  createImportEntryId: createImportEntryIdMock,
  hydrateImportCheckpointSources: hydrateImportCheckpointSourcesMock,
  loadImportCheckpointEntry: loadImportCheckpointEntryMock,
  rawObjectPathsFromSources: rawObjectPathsFromSourcesMock,
  saveImportCheckpointEntry: saveImportCheckpointEntryMock,
  validateImportCheckpointEntry: validateImportCheckpointEntryMock,
  collectProtectedRawObjectPaths: collectProtectedRawObjectPathsMock,
  cleanupImportArtifacts: cleanupImportArtifactsMock
}));

vi.mock("../../../server/platform/common/storage/raw-object-store.mjs", () => ({
  persistRawMailObject: persistRawMailObjectMock
}));

import {
  isSupportedImportFilePath,
  readInputSources
} from "../../../server/platform/specialized/knowledge/preprocessing/file-processor/index.mjs";
import { generateNormalizedDocuments } from "../../../server/platform/specialized/knowledge/preprocessing/file-processor/FileNormalizer/NormalizedDocuments/index.mjs";
import {
  getNormalizedManifestPath,
  loadNormalizedDocumentsManifest,
  resolveNormalizedDocumentEntry,
  resolveNormalizedDocumentPath
} from "../../../server/platform/specialized/knowledge/preprocessing/file-processor/FileNormalizer/NormalizedDocuments/store.mjs";

let importEntryCounter = 0;

async function withTempRoot(prefix, callback) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    return await callback(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function writeFile(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, value);
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
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
      pdfProcessor: {
        enabled: true,
        id: "pdf-processor",
        extractDocument: pdfProcessorExtractDocumentMock,
        ...overrides.pdfProcessor
      },
      ...overrides
    }
  };
}

beforeEach(() => {
  importEntryCounter = 0;
  createImportEntryIdMock.mockReset().mockImplementation(() => {
    importEntryCounter += 1;
    return `entry-${String(importEntryCounter).padStart(4, "0")}`;
  });
  collectProtectedRawObjectPathsMock.mockReset().mockResolvedValue(new Set());
  cleanupImportArtifactsMock.mockReset().mockResolvedValue({
    deletedTempFiles: [],
    deletedRawObjectFiles: []
  });
  hydrateImportCheckpointSourcesMock.mockReset().mockResolvedValue([]);
  loadImportCheckpointEntryMock.mockReset().mockResolvedValue(null);
  rawObjectPathsFromSourcesMock.mockReset().mockImplementation((sources = []) =>
    (Array.isArray(sources) ? sources : [])
      .map((entry) => String(entry?.rawObject?.storageRelativePath || "").trim())
      .filter(Boolean)
  );
  saveImportCheckpointEntryMock.mockReset().mockResolvedValue(undefined);
  validateImportCheckpointEntryMock.mockReset().mockResolvedValue(false);
  persistRawMailObjectMock.mockReset().mockImplementation(async (payload = {}) => ({
    objectId: "object-001",
    storageRelativePath: "objects/raw/object-001.bin",
    ...payload
  }));
  documentParserExtractDocumentMock.mockReset();
  pdfProcessorExtractDocumentMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("file processor final extra 2 coverage", () => {
  it("routes uploaded files by buffer signature even when name and declared media type disagree", async () => {
    await withTempRoot("pact-file-processor-final-extra-2-", async (userDataPath) => {
      documentParserExtractDocumentMock.mockImplementation(async () => ({
        parserId: "document-parser",
        text: "",
        metadata: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        }
      }));
      pdfProcessorExtractDocumentMock.mockImplementation(async () => ({
        parserId: "pdf-processor",
        text: "  Routed PDF text  \r\n",
        metadata: {
          "Content-Type": "application/pdf",
          "X-Source": "signature"
        },
        embeddedDocuments: [
          {
            text: "  Inner attachment  ",
            metadata: {
              part: "attachment"
            }
          }
        ]
      }));

      const result = await readInputSources({
        batchId: "batch-upload-routing",
        uploadedFiles: [
          {
            originalFileName: "invoice.txt",
            relativePath: "nested/invoice.txt",
            dataBase64: Buffer.from("%PDF-1.7\n% routed by signature", "utf8").toString("base64"),
            mediaType: "text/plain",
            providerId: "provider-upload",
            externalId: "external-upload",
            syncBatchId: "sync-upload",
            contentHash: "hash-upload",
            capturedAt: "2026-06-05T00:00:00.000Z",
            sourceMetadata: {
              source: "upload"
            }
          }
        ],
        providerId: "provider-top",
        externalId: "external-top",
        syncBatchId: "sync-top",
        contentHash: "hash-top",
        capturedAt: "2026-06-05T00:00:00.000Z",
        userDataPath,
        settings: {},
        generatedAt: "2026-06-05T00:00:00.000Z",
        runtime: makeRuntime()
      });

      expect(result.sources).toHaveLength(1);
      expect(result.sources[0]).toMatchObject({
        name: "invoice.pdf",
        kind: "pdf",
        text: "Routed PDF text",
        mediaType: "application/pdf",
        documentParserId: "pdf-processor",
        providerId: "provider-upload",
        externalId: "external-upload",
        syncBatchId: "sync-upload",
        contentHash: "hash-upload",
        rawObject: expect.objectContaining({
          storageRelativePath: "objects/raw/object-001.bin"
        })
      });
      expect(result.sources[0].embeddedDocuments).toEqual([
        {
          id: "embedded-1",
          text: "Inner attachment",
          metadata: {
            part: "attachment"
          }
        }
      ]);
      expect(persistRawMailObjectMock).toHaveBeenCalledTimes(1);
      expect(persistRawMailObjectMock).toHaveBeenCalledWith(
        expect.objectContaining({
          originalRelativePath: "invoice.txt",
          ingestOrigin: "upload",
          providerId: "provider-upload",
          externalId: "external-upload",
          syncBatchId: "sync-upload"
        })
      );
    });
  });

  it("rejects invalid zip inputs as bad input and preserves the parse failure reason", async () => {
    await withTempRoot("pact-file-processor-final-extra-2-", async (userDataPath) => {
      const zipPath = path.join(userDataPath, "inputs", "broken.zip");
      await writeFile(zipPath, Buffer.from("not a zip archive", "utf8"));

      await expect(
        readInputSources({
          filePaths: [zipPath],
          userDataPath,
          settings: {},
          generatedAt: "2026-06-05T00:00:00.000Z"
        })
      ).rejects.toMatchObject({
        reasonCode: "document_parse_no_usable_content",
        failureReasons: expect.arrayContaining([
          expect.objectContaining({
            reasonCode: "filesystem_input_parse_failed",
            sourceName: "broken.zip",
            sourceKind: "filesystem"
          })
        ])
      });
    });
  });

  it("rejects empty input when nothing is supplied", async () => {
    await withTempRoot("pact-file-processor-final-extra-2-", async (userDataPath) => {
      await expect(
        readInputSources({
          userDataPath,
          settings: {},
          generatedAt: "2026-06-05T00:00:00.000Z"
        })
      ).rejects.toMatchObject({
        reasonCode: "document_parse_input_missing"
      });
    });
  });

  it("rejects a routed document when the parser returns no usable text", async () => {
    await withTempRoot("pact-file-processor-final-extra-2-", async (userDataPath) => {
      const docxPath = path.join(userDataPath, "inputs", "empty.docx");
      await writeFile(
        docxPath,
        zipSync({
          "[Content_Types].xml": strToU8("<Types/>"),
          "word/document.xml": strToU8("<w:document/>")
        })
      );

      documentParserExtractDocumentMock.mockResolvedValue({
        parserId: "document-parser",
        text: "",
        metadata: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        },
        warnings: [" parser returned nothing "]
      });

      await expect(
        readInputSources({
          filePaths: [docxPath],
          userDataPath,
          settings: {},
          generatedAt: "2026-06-05T00:00:00.000Z",
          runtime: makeRuntime()
        })
      ).rejects.toMatchObject({
        reasonCode: "document_parse_no_usable_content",
        failureReasons: expect.arrayContaining([
          expect.objectContaining({
            reasonCode: "docx_no_text_extracted",
            sourceName: "empty.docx",
            sourceKind: "docx"
          })
        ])
      });
    });
  });

  it("normalizes embedded documents returned by the parser", async () => {
    await withTempRoot("pact-file-processor-final-extra-2-", async (userDataPath) => {
      const emailPath = path.join(userDataPath, "inputs", "thread.eml");
      await writeFile(
        emailPath,
        [
          "From: team@example.test",
          "Subject: Thread",
          "",
          "Parent body"
        ].join("\n")
      );

      documentParserExtractDocumentMock.mockResolvedValue({
        parserId: "document-parser",
        text: "  Parent body  \r\n",
        metadata: {
          "Content-Type": "message/rfc822",
          "X-Source": "filesystem"
        },
        embeddedDocuments: [
          {
            id: "",
            text: "  First nested note  ",
            metadata: {
              part: "body"
            }
          },
          {
            text: "\nSecond nested note\n",
            metadata: {
              part: "attachment"
            }
          }
        ]
      });

      const result = await readInputSources({
        filePaths: [emailPath],
        userDataPath,
        settings: {},
        generatedAt: "2026-06-05T00:00:00.000Z",
        runtime: makeRuntime()
      });

      expect(result.sources).toHaveLength(1);
      expect(result.sources[0]).toMatchObject({
        kind: "email",
        text: "Parent body",
        documentMetadata: {
          "Content-Type": "message/rfc822",
          "X-Source": "filesystem"
        }
      });
      expect(result.sources[0].embeddedDocuments).toEqual([
        {
          id: "embedded-1",
          text: "First nested note",
          metadata: {
            part: "body"
          }
        },
        {
          id: "embedded-2",
          text: "Second nested note",
          metadata: {
            part: "attachment"
          }
        }
      ]);
    });
  });

  it("restores checkpointed sources and records incremental index failures", async () => {
    await withTempRoot("pact-file-processor-final-extra-2-", async (userDataPath) => {
      validateImportCheckpointEntryMock.mockResolvedValue(true);
      loadImportCheckpointEntryMock.mockResolvedValue({
        sources: [
          {
            id: "restored-source-1",
            name: "restored.txt",
            path: "restored.txt",
            kind: "text",
            text: "restored checkpoint text",
            rawObject: {
              storageRelativePath: "objects/raw/restored.bin"
            }
          }
        ],
        warnings: ["restored warning"],
        failureReasons: [
          {
            reasonCode: "restored_reason",
            message: "restored reason"
          }
        ]
      });
      hydrateImportCheckpointSourcesMock.mockImplementation(async ({ sources = [] } = {}) => sources);

      const ingestSources = vi.fn(async () => {
        throw new Error("index unavailable");
      });
      const result = await readInputSources({
        batchId: "batch-restored",
        archiveBatchId: "archive-restored",
        uploadedFiles: [
          {
            name: "restored.txt",
            dataBase64: Buffer.from("ignored", "utf8").toString("base64")
          }
        ],
        userDataPath,
        settings: {},
        generatedAt: "2026-06-05T00:00:00.000Z",
        runtime: {
          mounts: {
            knowledgeBase: {
              ingestSources
            }
          }
        }
      });

      expect(result.sources).toHaveLength(1);
      expect(result.sources[0]).toMatchObject({
        id: "restored-source-1",
        text: "restored checkpoint text"
      });
      expect(result.warnings).toEqual(
        expect.arrayContaining([
          "restored warning",
          "upload 增量检索索引写入失败：index unavailable"
        ])
      );
      expect(result.failureReasons).toEqual([
        {
          reasonCode: "restored_reason",
          message: "restored reason"
        }
      ]);
      expect(ingestSources).toHaveBeenCalledWith(
        expect.objectContaining({
          batchId: "archive-restored",
          sources: [expect.objectContaining({ id: "restored-source-1" })]
        })
      );
      expect(cleanupImportArtifactsMock).toHaveBeenCalledTimes(2);
      expect(collectProtectedRawObjectPathsMock).toHaveBeenCalledTimes(1);
    });
  });

  it("rejects checkpointed sources that hydrate without text or image payloads", async () => {
    await withTempRoot("pact-file-processor-final-extra-2-", async (userDataPath) => {
      validateImportCheckpointEntryMock.mockResolvedValue(true);
      loadImportCheckpointEntryMock.mockResolvedValue({
        sources: [
          {
            id: "restored-empty",
            name: "restored-empty.pdf",
            path: "restored-empty.pdf",
            kind: "document",
            text: ""
          }
        ],
        warnings: [],
        failureReasons: []
      });
      hydrateImportCheckpointSourcesMock.mockImplementation(async ({ sources = [] } = {}) => sources);

      await expect(readInputSources({
        batchId: "batch-restored-empty",
        uploadedFiles: [
          {
            name: "restored-empty.pdf",
            dataBase64: Buffer.from("ignored", "utf8").toString("base64")
          }
        ],
        userDataPath,
        settings: {},
        generatedAt: "2026-06-05T00:00:00.000Z"
      })).rejects.toMatchObject({
        reasonCode: "document_parse_no_text_or_image"
      });
    });
  });

  it("detects readable unknown files and rejects unreadable or missing import paths", async () => {
    await withTempRoot("pact-file-processor-final-extra-2-", async (userDataPath) => {
      const readablePath = path.join(userDataPath, "inputs", "notes.unknown");
      const unreadablePath = path.join(userDataPath, "inputs", "binary.unknown");
      const missingPath = path.join(userDataPath, "inputs", "missing.unknown");
      await writeFile(readablePath, "plain text without a known extension");
      await writeFile(unreadablePath, Buffer.from([0, 1, 2, 3, 4, 5]));

      await expect(isSupportedImportFilePath(readablePath)).resolves.toBe(true);
      await expect(isSupportedImportFilePath(unreadablePath)).resolves.toBe(false);
      await expect(isSupportedImportFilePath(missingPath)).resolves.toBe(false);
    });
  });
});

describe("normalized documents final extra 2 coverage", () => {
  it("builds mail message, thread, and transaction documents from analysis data", async () => {
    await withTempRoot("pact-normalized-documents-final-extra-2-", async (userDataPath) => {
      const manifest = await generateNormalizedDocuments({
        userDataPath,
        jobId: "job-mail-analysis",
        generatedAt: "2026-06-05T00:00:00.000Z",
        sources: [],
        chunks: [],
        analysis: {
          emails: [
            {
              id: "mail-1",
              subject: "Weekly sync",
              sentAt: "2026-06-05T08:00:00.000Z",
              from: { name: "Alice", address: "alice@example.test" },
              to: [{ name: "Bob", address: "bob@example.test" }],
              excerpt: "Short summary",
              body: "Full message body",
              rawObjectId: "raw-001",
              sourceName: "inbox/weekly-sync.eml",
              sourcePath: "mail/weekly-sync.eml"
            }
          ],
          threads: [
            {
              id: "thread-1",
              subject: "Weekly sync",
              messageIds: ["mail-1"],
              summary: "Thread summary",
              startedAt: "2026-06-05T08:00:00.000Z",
              latestActivityAt: "2026-06-05T08:05:00.000Z",
              status: "open",
              cadence: "weekly"
            }
          ],
          transactions: [
            {
              id: "txn-1",
              title: "Weekly sync",
              messageIds: ["mail-1"],
              threadIds: ["thread-1"],
              participantIds: ["alice", "bob"],
              summary: "Transaction summary",
              decisions: ["Confirm agenda"],
              pendingItems: ["Send notes"],
              startedAt: "2026-06-05T08:00:00.000Z",
              latestActivityAt: "2026-06-05T08:05:00.000Z"
            }
          ],
          timeline: [
            {
              id: "event-1",
              transactionId: "txn-1",
              timestamp: "2026-06-05T08:05:00.000Z",
              title: "Notes sent",
              summary: "Follow-up notes were delivered."
            }
          ]
        }
      });

      expect(manifest.documents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            granularity: "message",
            adapterId: "builtin/mail-adapter",
            title: "Weekly sync - Message"
          }),
          expect.objectContaining({
            granularity: "thread",
            adapterId: "builtin/mail-adapter",
            title: "Weekly sync - Thread"
          }),
          expect.objectContaining({
            granularity: "transaction",
            adapterId: "builtin/mail-adapter",
            title: "Weekly sync - Transaction Timeline"
          })
        ])
      );
      expect(manifest.summary).toMatchObject({
        documentCount: 3,
        sourceMaterialCount: 0,
        assetCount: 0,
        byGranularity: {
          message: 1,
          thread: 1,
          transaction: 1
        }
      });
      expect(manifest.warnings).toEqual([]);

      const loaded = await loadNormalizedDocumentsManifest(userDataPath, "job-mail-analysis");
      expect(loaded.summary).toEqual(manifest.summary);
      await expect(fs.stat(getNormalizedManifestPath(userDataPath, "job-mail-analysis"))).resolves.toBeTruthy();

      const messageEntry = resolveNormalizedDocumentEntry(loaded, manifest.documents[0].documentId);
      const messagePath = resolveNormalizedDocumentPath(userDataPath, "job-mail-analysis", messageEntry);
      await expect(fs.stat(messagePath)).resolves.toBeTruthy();
    });
  });
});
