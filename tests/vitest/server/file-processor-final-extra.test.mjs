import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { zipSync } from "fflate";
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
  createFileRoutingDecision,
  readInputSources
} from "../../../server/platform/specialized/knowledge/preprocessing/file-processor/index.mjs";

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

describe("file processor final extra coverage", () => {
  it("preserves already routed nested names on declared paths", () => {
    const decision = createFileRoutingDecision({
      buffer: Buffer.from("From: ops@example.test\n\nBody", "utf8"),
      fileName: "nested/inbox/message.eml",
      filePath: "nested/inbox/message.eml",
      declaredFileNames: ["nested/inbox/message.eml"]
    });

    expect(decision).toMatchObject({
      extension: ".eml",
      kind: "email",
      selectedSource: "declared-path",
      routedFileName: "nested/inbox/message.eml"
    });
  });

  it("routes zip signatures, rejects binary fallback, and preserves uploaded image raw objects", async () => {
    const zipLikeDocx = createFileRoutingDecision({
      buffer: Buffer.from("PK\u0003\u0004 word/document.xml [Content_Types].xml", "latin1"),
      fileName: "download.bin",
      filePath: "download.bin"
    });
    expect(zipLikeDocx).toMatchObject({
      selectedSource: "zip-container",
      extension: ".docx",
      kind: "docx"
    });

    const binary = createFileRoutingDecision({
      buffer: Buffer.from([0, 1, 2, 3, 4, 5]),
      fileName: "payload",
      filePath: "payload",
      allowTextFallback: false
    });
    expect(binary).toMatchObject({
      selectedSource: "unsupported",
      isReadableText: false
    });

    await withTempRoot("pact-file-processor-image-final-", async (userDataPath) => {
      const result = await readInputSources({
        uploadedFiles: [
          {
            originalFileName: "photo.png",
            dataBase64: Buffer.from([
              0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
              0x00, 0x00, 0x00, 0x0d
            ]).toString("base64"),
            providerId: "provider-image",
            externalId: "external-image",
            syncBatchId: "sync-image",
            sha256: "image-sha",
            sourceMetadata: { album: "screenshots" }
          }
        ],
        batchId: "batch-image",
        archiveBatchId: "archive-image",
        userDataPath,
        settings: { ocrEnabled: false },
        generatedAt: "2026-06-05T00:00:00.000Z",
        runtime: makeRuntime({
          ocr: {
            enabled: false,
            id: "ocr"
          }
        })
      });

      expect(result.sources).toHaveLength(1);
      expect(result.sources[0]).toMatchObject({
        name: "photo.png",
        kind: "image",
        text: "",
        mediaType: "image/png",
        ocrAttempted: false,
        providerId: "provider-image",
        externalId: "external-image",
        syncBatchId: "sync-image",
        contentHash: "image-sha",
        sourceMetadata: expect.objectContaining({
          album: "screenshots",
          providerId: "provider-image"
        }),
        rawObject: expect.objectContaining({
          storageRelativePath: "objects/raw/object-001.bin",
          ingestOrigin: "upload",
          sourceType: "upload"
        })
      });
      expect(result.sources[0].imageDataUrl).toMatch(/^data:image\/png;base64,/);
      expect(persistRawMailObjectMock).toHaveBeenCalledWith(expect.objectContaining({
        batchId: "archive-image",
        originalRelativePath: "photo.png",
        mediaType: "image/png",
        ingestOrigin: "upload",
        providerId: "provider-image",
        externalId: "external-image",
        syncBatchId: "sync-image"
      }));
    });
  });

  it("reads manifest input, pasted text, and uploaded files while keeping warnings and raw objects", async () => {
    await withTempRoot("pact-file-processor-final-", async (userDataPath) => {
      const hydratedDir = path.join(userDataPath, "knowledge-sources", "hydrated", "batch-001");
      const manifestPath = path.join(hydratedDir, "files.json");
      const manifestSourcePath = path.join(userDataPath, "mail", "manifest-note.eml");
      await writeFile(
        manifestSourcePath,
        [
          "From: manifest@example.test",
          "To: team@example.test",
          "Subject: Manifest note",
          "Content-Type: text/plain; charset=utf-8",
          "",
          "Manifest body"
        ].join("\n")
      );
      await writeJson(manifestPath, {
        files: [
          {
            absolutePath: manifestSourcePath,
            relativePath: "mail/manifest-note.eml"
          },
          {
            absolutePath: "",
            relativePath: "empty.txt"
          },
          {
            absolutePath: manifestSourcePath,
            relativePath: "../escape.txt"
          }
        ]
      });

      documentParserExtractDocumentMock.mockImplementation(async () => ({
        parserId: "document-parser",
        text: "  Manifest parsed body  \r\n",
        metadata: {
          "Content-Type": "message/rfc822",
          "X-Source": "manifest"
        },
        embeddedDocuments: [
          {
            id: "",
            text: "  Inner note  ",
            metadata: {
              part: "body"
            }
          }
        ],
        warnings: [" manifest parser warning "],
        failureReason: {
          reasonCode: "manifest_parser_note",
          message: "manifest parser note"
        }
      }));
      pdfProcessorExtractDocumentMock.mockImplementation(async () => ({
        parserId: "pdf-processor",
        text: "  Uploaded PDF text  \r\n",
        metadata: {
          "Content-Type": "application/pdf",
          "X-Source": "upload"
        },
        warnings: [" uploaded parser warning "],
        failureReason: {
          reasonCode: "upload_parser_note",
          message: "upload parser note"
        }
      }));

      const result = await readInputSources({
        fileManifestPath: manifestPath,
        inputText: "  Pasted text  \r\n",
        uploadedFiles: [
          {
            originalFileName: "report.pdf",
            dataBase64: Buffer.from("%PDF-1.7\n% upload", "utf8").toString("base64"),
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
        batchId: "batch-001",
        archiveBatchId: "archive-001",
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

      expect(result.sources).toHaveLength(3);
      expect(result.sources[0]).toMatchObject({
        id: "pasted-text",
        kind: "text",
        text: "Pasted text"
      });
      expect(result.sources[1]).toMatchObject({
        name: "manifest-note.eml",
        kind: "email",
        text: "Manifest parsed body",
        warnings: ["manifest parser warning"],
        failureReason: {
          reasonCode: "manifest_parser_note",
          message: "manifest parser note"
        },
        providerId: "provider-top",
        externalId: "external-top",
        syncBatchId: "sync-top",
        contentHash: "hash-top",
        rawObject: expect.objectContaining({
          storageRelativePath: "objects/raw/object-001.bin"
        })
      });
      expect(result.sources[1].documentMetadata).toMatchObject({
        "Content-Type": "message/rfc822",
        "X-Source": "manifest"
      });
      expect(result.sources[1].embeddedDocuments).toEqual([
        {
          id: "embedded-1",
          text: "Inner note",
          metadata: {
            part: "body"
          }
        }
      ]);
      expect(result.sources[2]).toMatchObject({
        name: "report.pdf",
        kind: "pdf",
        text: "Uploaded PDF text",
        warnings: ["uploaded parser warning"],
        failureReason: {
          reasonCode: "upload_parser_note",
          message: "upload parser note"
        },
        providerId: "provider-upload",
        externalId: "external-upload",
        syncBatchId: "sync-upload",
        contentHash: "hash-upload",
        rawObject: expect.objectContaining({
          storageRelativePath: "objects/raw/object-001.bin"
        })
      });
      expect(result.sources[2].documentMetadata).toMatchObject({
        "Content-Type": "application/pdf",
        "X-Source": "upload"
      });

      expect(result.warnings).toEqual(
        expect.arrayContaining([
          "知识源文件清单包含空路径，已跳过。",
          "知识源文件清单包含不安全路径，已跳过。",
          "manifest parser warning",
          "uploaded parser warning"
        ])
      );
      expect(result.failureReasons).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            reasonCode: "manifest_empty_path",
            sourceKind: "manifest"
          }),
          expect.objectContaining({
            reasonCode: "manifest_unsafe_path",
            sourceKind: "manifest"
          }),
          expect.objectContaining({
            reasonCode: "manifest_parser_note"
          }),
          expect.objectContaining({
            reasonCode: "upload_parser_note"
          })
        ])
      );
      expect(persistRawMailObjectMock).toHaveBeenCalledTimes(2);
      expect(persistRawMailObjectMock).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          originalRelativePath: "mail/manifest-note.eml",
          ingestOrigin: "filesystem",
          providerId: "provider-top",
          externalId: "external-top",
          syncBatchId: "sync-top"
        })
      );
      expect(persistRawMailObjectMock).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          originalRelativePath: "report.pdf",
          ingestOrigin: "upload",
          providerId: "provider-upload",
          externalId: "external-upload",
          syncBatchId: "sync-upload"
        })
      );
    });
  });

  it("expands file paths and reports empty, binary, and unsupported inputs with failure reasons", async () => {
    await withTempRoot("pact-file-processor-final-", async (userDataPath) => {
      const emptyPdfPath = path.join(userDataPath, "inputs", "empty.pdf");
      const acceptedPdfPath = path.join(userDataPath, "inputs", "accepted.pdf");
      const unsupportedPath = path.join(userDataPath, "inputs", "bad.bin");

      await writeFile(emptyPdfPath, Buffer.from("%PDF-1.7\n% empty", "utf8"));
      await writeFile(acceptedPdfPath, Buffer.from("%PDF-1.7\n% accepted", "utf8"));
      await writeFile(unsupportedPath, Buffer.from([0x00, 0x01, 0x02, 0x03]));

      pdfProcessorExtractDocumentMock.mockImplementation(async ({ fileName }) => {
        if (String(fileName || "").includes("empty")) {
          return {
            parserId: "pdf-processor",
            text: "",
            metadata: {
              "Content-Type": "application/pdf",
              "X-Source": "empty"
            },
            warnings: [" empty pdf warning "],
            failureReason: {
              reasonCode: "empty_pdf_parser_note",
              message: "empty pdf parser note"
            }
          };
        }

        return {
          parserId: "pdf-processor",
          text: "  Accepted PDF text  \r\n",
          metadata: {
            "Content-Type": "application/pdf",
            "X-Source": "accepted"
          },
          warnings: [" accepted pdf warning "],
          failureReason: {
            reasonCode: "accepted_pdf_parser_note",
            message: "accepted pdf parser note"
          }
        };
      });

      const result = await readInputSources({
        filePaths: [emptyPdfPath, acceptedPdfPath, unsupportedPath],
        userDataPath,
        settings: {},
        generatedAt: "2026-06-05T00:00:00.000Z",
        runtime: makeRuntime({
          documentParser: {
            enabled: false,
            id: "document-parser",
            extractDocument: documentParserExtractDocumentMock
          },
          pdfProcessor: {
            enabled: true,
            id: "pdf-processor",
            extractDocument: pdfProcessorExtractDocumentMock
          }
        })
      });

      expect(result.sources).toHaveLength(1);
      expect(result.sources[0]).toMatchObject({
        name: "accepted.pdf",
        kind: "pdf",
        text: "Accepted PDF text",
        warnings: ["accepted pdf warning"],
        failureReason: {
          reasonCode: "accepted_pdf_parser_note",
          message: "accepted pdf parser note"
        },
        rawObject: null
      });
      expect(result.sources[0].documentMetadata).toMatchObject({
        "Content-Type": "application/pdf",
        "X-Source": "accepted"
      });

      expect(result.warnings).toEqual(
        expect.arrayContaining([
          "empty.pdf 已尝试 PaddleOCR，但仍未提取到正文。可能是无文字扫描件，或识别质量不足。",
          `bad.bin 读取失败：暂不支持这种文件类型，或当前文件未交由 Java 文档解析链处理。`
        ])
      );
      expect(result.failureReasons).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            reasonCode: "pdf_ocr_no_text_extracted",
            sourceName: "empty.pdf",
            sourceKind: "pdf"
          }),
          expect.objectContaining({
            reasonCode: "accepted_pdf_parser_note"
          }),
          expect.objectContaining({
            reasonCode: "filesystem_input_parse_failed",
            sourceName: "bad.bin",
            sourceKind: "filesystem"
          })
        ])
      );
    });
  });

  it("rejects manifest paths outside the hydrated cache root", async () => {
    await withTempRoot("pact-file-processor-final-", async (userDataPath) => {
      await expect(
        readInputSources({
          fileManifestPath: path.join(userDataPath, "..", "outside", "files.json"),
          userDataPath,
          settings: {},
          generatedAt: "2026-06-05T00:00:00.000Z"
        })
      ).rejects.toThrow("知识源文件清单路径不在允许的自动下载缓存目录中。");
    });
  });

  it("dedupes repeated directories, skips non-file entries, and reports empty or missing inputs", async () => {
    await withTempRoot("pact-file-processor-directory-final-", async (userDataPath) => {
      const inputDir = path.join(userDataPath, "inputs");
      const emptyDir = path.join(userDataPath, "empty");
      const missingPath = path.join(userDataPath, "missing.txt");
      const textPath = path.join(inputDir, "note.txt");
      const symlinkPath = path.join(inputDir, "note-link.txt");

      await writeFile(textPath, "Directory note\n");
      await fs.mkdir(emptyDir, { recursive: true });
      await fs.symlink(textPath, symlinkPath);

      const result = await readInputSources({
        filePaths: [inputDir, inputDir, emptyDir, missingPath],
        userDataPath,
        settings: {},
        generatedAt: "2026-06-05T00:00:00.000Z"
      });

      expect(result.sources).toHaveLength(1);
      expect(result.sources[0]).toMatchObject({
        name: "note.txt",
        kind: "text",
        text: "Directory note"
      });
      expect(result.warnings).toEqual(expect.arrayContaining([
        "empty 中没有可解析的文件，已跳过。",
        expect.stringContaining("missing.txt 读取失败：")
      ]));
    });
  });

  it("covers media-type routing and mounted parser fallback extraction", async () => {
    const docxMediaType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    const routing = createFileRoutingDecision({
      buffer: Buffer.from("office-like payload", "utf8"),
      fileName: "proposal.docx",
      filePath: "proposal.docx",
      mediaTypeHint: docxMediaType
    });
    expect(routing).toMatchObject({
      extension: ".docx",
      kind: "docx",
      mediaTypeHint: docxMediaType,
      selectedSource: "declared-path"
    });

    await withTempRoot("pact-file-processor-mounted-fallback-", async (userDataPath) => {
      const textOnlyExtract = vi.fn(async ({ fileName, mediaTypeHint }) => ({
        parserId: "doc-text-only",
        text: `text fallback for ${fileName}`,
        metadata: {
          "Content-Type": mediaTypeHint
        }
      }));

      const textOnlyResult = await readInputSources({
        uploadedFiles: [
          {
            originalFileName: "proposal.docx",
            mediaType: docxMediaType,
            dataBase64: Buffer.from("docx body", "utf8").toString("base64")
          }
        ],
        userDataPath,
        settings: {},
        generatedAt: "2026-06-05T00:00:00.000Z",
        runtime: makeRuntime({
          documentParser: {
            enabled: true,
            id: "doc-text-only",
            extractDocument: undefined,
            extractText: textOnlyExtract
          }
        })
      });

      expect(textOnlyResult.sources[0]).toMatchObject({
        name: "proposal.docx",
        kind: "docx",
        text: "text fallback for proposal.docx",
        documentParserId: "doc-text-only"
      });
      expect(textOnlyExtract).toHaveBeenCalledWith(expect.objectContaining({
        fileName: "proposal.docx",
        mediaTypeHint: docxMediaType,
        sourceKind: "docx"
      }));

      const documentOnlyExtract = vi.fn(async ({ fileName }) => ({
        parserId: "doc-document-only",
        text: `document fallback for ${fileName}`,
        metadata: {
          "Content-Type": "application/pdf"
        }
      }));
      const documentOnlyResult = await readInputSources({
        uploadedFiles: [
          {
            originalFileName: "fallback.pdf",
            mediaType: "application/pdf",
            dataBase64: Buffer.from("%PDF-1.7\nfallback", "utf8").toString("base64")
          }
        ],
        userDataPath,
        settings: {},
        generatedAt: "2026-06-05T00:00:00.000Z",
        runtime: {
          mounts: {
            documentParser: {
              enabled: true,
              id: "doc-document-only",
              extractDocument: documentOnlyExtract
            }
          },
          resolveDocumentRoute: () => ({
            mountName: "documentParser",
            action: "extractText",
            matchedBy: "extension"
          })
        }
      });

      expect(documentOnlyResult.sources[0]).toMatchObject({
        name: "fallback.pdf",
        kind: "pdf",
        text: "document fallback for fallback.pdf",
        documentParserId: "doc-document-only"
      });
      expect(documentOnlyExtract).toHaveBeenCalledWith(expect.objectContaining({
        fileName: "fallback.pdf",
        sourceKind: "pdf"
      }));
    });
  });

  it("preserves uploaded images when OCR extraction fails", async () => {
    await withTempRoot("pact-file-processor-ocr-failure-", async (userDataPath) => {
      const ocrExtractText = vi.fn(async () => {
        throw new Error("ocr unavailable");
      });

      const result = await readInputSources({
        uploadedFiles: [
          {
            originalFileName: "receipt.png",
            dataBase64: Buffer.from([
              0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
              0x00, 0x00, 0x00, 0x0d
            ]).toString("base64")
          }
        ],
        userDataPath,
        settings: { ocrEnabled: true },
        generatedAt: "2026-06-05T00:00:00.000Z",
        runtime: makeRuntime({
          ocr: {
            enabled: true,
            id: "ocr",
            extractText: ocrExtractText
          }
        })
      });

      expect(result.sources).toHaveLength(1);
      expect(result.sources[0]).toMatchObject({
        name: "receipt.png",
        kind: "image",
        text: "",
        ocrAttempted: true,
        warnings: ["receipt.png OCR 未完成：ocr unavailable 已保留原始图片。"]
      });
    });
  });

  it("reports empty archives after skipping unsafe archive members", async () => {
    await withTempRoot("pact-file-processor-empty-archive-", async (userDataPath) => {
      const unsafeOnlyArchive = Buffer.from(zipSync({
        "folder/": new Uint8Array(),
        "../escape.txt": new Uint8Array(Buffer.from("escape", "utf8"))
      }));

      let thrown;
      try {
        await readInputSources({
          uploadedFiles: [
            {
              originalFileName: "unsafe.zip",
              dataBase64: unsafeOnlyArchive.toString("base64")
            }
          ],
          userDataPath,
          settings: {},
          generatedAt: "2026-06-05T00:00:00.000Z",
          runtime: makeRuntime()
        });
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(Error);
      expect(thrown.message).toContain("unsafe.zip 中没有可解析的文件。");
      expect(thrown.reasonCode).toBe("document_parse_no_usable_content");
      expect(thrown.failureReasons).toEqual([
        expect.objectContaining({
          reasonCode: "upload_input_parse_failed",
          sourceName: "upload-1",
          sourceKind: "upload"
        })
      ]);
    });
  });

  it("reports import progress and throttles intermediate filesystem indexing updates", async () => {
    await withTempRoot("pact-file-processor-progress-", async (userDataPath) => {
      const firstPath = path.join(userDataPath, "inputs", "first.txt");
      const secondPath = path.join(userDataPath, "inputs", "second.txt");
      await writeFile(firstPath, "First note\n");
      await writeFile(secondPath, "Second note\n");
      const reportProgress = vi.fn();

      const result = await readInputSources({
        filePaths: [firstPath, secondPath],
        userDataPath,
        settings: {},
        generatedAt: "2026-06-05T00:00:00.000Z",
        reportProgress
      });

      expect(result.sources.map((source) => source.text)).toEqual(["First note", "Second note"]);
      expect(reportProgress).toHaveBeenCalledWith(expect.objectContaining({
        stage: "展开输入目录",
        progressPercent: 26
      }));
      expect(reportProgress).toHaveBeenCalledWith(expect.objectContaining({
        stage: "建立文件索引 2/2"
      }));
    });
  });

  it("fails unsupported mounted parser actions after runtime supports probing", async () => {
    await withTempRoot("pact-file-processor-unsupported-action-", async (userDataPath) => {
      const supports = vi.fn(() => true);
      const extractDocument = vi.fn(async () => ({
        parserId: "unsupported-action-parser",
        text: "should not run"
      }));

      let thrown;
      try {
        await readInputSources({
          uploadedFiles: [
            {
              originalFileName: "payload.bin",
              dataBase64: Buffer.from([0, 1, 2, 3, 4, 5]).toString("base64")
            }
          ],
          userDataPath,
          settings: {},
          generatedAt: "2026-06-05T00:00:00.000Z",
          runtime: {
            mounts: {
              documentParser: {
                enabled: true,
                id: "unsupported-action-parser",
                supports,
                extractDocument
              }
            },
            resolveDocumentRoute: () => ({
              mountName: "documentParser",
              action: "extractTable",
              matchedBy: "default"
            })
          }
        });
      } catch (error) {
        thrown = error;
      }

      expect(supports).toHaveBeenCalledWith(expect.objectContaining({
        extension: ".bin",
        sourceKind: "document"
      }));
      expect(extractDocument).not.toHaveBeenCalled();
      expect(thrown).toBeInstanceOf(Error);
      expect(thrown.message).toContain("挂载 documentParser 不支持 extractTable。");
      expect(thrown.failureReasons).toEqual([
        expect.objectContaining({
          reasonCode: "upload_input_parse_failed",
          sourceName: "upload-1",
          sourceKind: "upload"
        })
      ]);
    });
  });

  it("classifies empty extracted content warnings by source kind", async () => {
    await withTempRoot("pact-file-processor-empty-content-", async (userDataPath) => {
      const emptyExtract = vi.fn(async ({ fileName, mediaTypeHint }) => ({
        parserId: "empty-parser",
        text: "",
        metadata: {
          "Content-Type": mediaTypeHint || (String(fileName || "").endsWith(".pdf") ? "application/pdf" : "application/rtf")
        }
      }));

      const result = await readInputSources({
        inputText: "keep this source",
        uploadedFiles: [
          {
            originalFileName: "empty.rtf",
            mediaType: "application/rtf",
            dataBase64: Buffer.from("{\\rtf1}", "utf8").toString("base64")
          },
          {
            originalFileName: "empty.pdf",
            mediaType: "application/pdf",
            dataBase64: Buffer.from("%PDF-1.7\nempty", "utf8").toString("base64")
          },
          {
            originalFileName: "blank.dat",
            dataBase64: ""
          }
        ],
        userDataPath,
        settings: { ocrEnabled: false },
        generatedAt: "2026-06-05T00:00:00.000Z",
        runtime: makeRuntime({
          documentParser: {
            enabled: true,
            id: "empty-document-parser",
            extractDocument: emptyExtract
          },
          pdfProcessor: {
            enabled: true,
            id: "empty-pdf-parser",
            extractDocument: emptyExtract
          },
          ocr: {
            enabled: false,
            id: "ocr"
          }
        })
      });

      expect(result.sources).toHaveLength(1);
      expect(result.sources[0]).toMatchObject({
        id: "pasted-text",
        text: "keep this source"
      });
      expect(result.warnings).toEqual(expect.arrayContaining([
        "empty.rtf 没有提取到正文，Tika 未返回有效文本。可能是扫描件、纯图片文档，或该格式需要补充依赖。",
        "empty.pdf 已尝试 PaddleOCR，但仍未提取到正文。可能是无文字扫描件，或识别质量不足。",
        "blank.txt 没有提取到可用内容，已跳过。"
      ]));
      expect(result.failureReasons).toEqual(expect.arrayContaining([
        expect.objectContaining({
          reasonCode: "document_no_text_extracted",
          sourceName: "empty.rtf"
        }),
        expect.objectContaining({
          reasonCode: "pdf_ocr_no_text_extracted",
          sourceName: "empty.pdf"
        }),
        expect.objectContaining({
          reasonCode: "no_usable_content_extracted",
          sourceName: "blank.txt"
        })
      ]));
    });
  });

  it("stops parsing archives beyond the supported nesting depth", async () => {
    await withTempRoot("pact-file-processor-nested-archive-", async (userDataPath) => {
      const innerArchive = Buffer.from(zipSync({
        "inner.txt": new Uint8Array(Buffer.from("nested text", "utf8"))
      }));
      const middleArchive = Buffer.from(zipSync({
        "inner.zip": new Uint8Array(innerArchive)
      }));
      const outerArchive = Buffer.from(zipSync({
        "middle.zip": new Uint8Array(middleArchive)
      }));

      let thrown;
      try {
        await readInputSources({
          uploadedFiles: [
            {
              originalFileName: "outer.zip",
              dataBase64: outerArchive.toString("base64")
            }
          ],
          userDataPath,
          settings: {},
          generatedAt: "2026-06-05T00:00:00.000Z",
          runtime: makeRuntime()
        });
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(Error);
      expect(thrown.message).toContain("压缩包嵌套层级过深");
      expect(thrown.failureReasons).toEqual([
        expect.objectContaining({
          reasonCode: "upload_input_parse_failed",
          sourceName: "upload-1",
          sourceKind: "upload"
        })
      ]);
    });
  });
});
