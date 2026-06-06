import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest";
import { strToU8, zipSync } from "fflate";
const collectProtectedRawObjectPathsMock = vi.hoisted(() => vi.fn(async () => new Set()));
const createImportEntryIdMock = vi.hoisted(() => vi.fn());
const createImportCheckpointStoreMocks = vi.hoisted(() => ({
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
const persistRawMailObjectMock = vi.hoisted(() => vi.fn(async (payload = {}) => ({
  objectId: "object-001",
  storageRelativePath: "objects/raw/object-001.bin",
  ...payload
})));

vi.mock("../../../server/platform/common/storage/import-resume-store.mjs", () => ({
  ...createImportCheckpointStoreMocks
}));

vi.mock("../../../server/platform/common/storage/raw-object-store.mjs", () => ({
  persistRawMailObject: persistRawMailObjectMock
}));

import {
  createFileRoutingDecision,
  readInputSources
} from "../../../server/platform/specialized/knowledge/preprocessing/file-processor/index.mjs";

let importEntryCounter = 0;

async function withTempDirectory(testFn) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pact-file-processor-test-"));
  try {
    return await testFn(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function createFile(root, relativePath, content) {
  const fullPath = path.join(root, relativePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, Buffer.from(content));
  return fullPath;
}

function makeRuntime(overrides = {}) {
  return {
    mounts: {
      ...overrides
    }
  };
}

afterEach(() => {
  persistRawMailObjectMock.mockClear();
  collectProtectedRawObjectPathsMock.mockClear();
  createImportCheckpointStoreMocks.hydrateImportCheckpointSources.mockClear();
  createImportCheckpointStoreMocks.loadImportCheckpointEntry.mockClear();
  createImportCheckpointStoreMocks.rawObjectPathsFromSources.mockClear();
  createImportCheckpointStoreMocks.saveImportCheckpointEntry.mockClear();
  createImportCheckpointStoreMocks.validateImportCheckpointEntry.mockClear();
  createImportCheckpointStoreMocks.cleanupImportArtifacts.mockClear();
  createImportCheckpointStoreMocks.collectProtectedRawObjectPaths.mockClear();
  createImportEntryIdMock.mockClear();
});

beforeEach(() => {
  importEntryCounter = 0;
  createImportEntryIdMock.mockImplementation(() => {
    importEntryCounter += 1;
    return `entry-${importEntryCounter.toString().padStart(4, "0")}`;
  });
});

describe("file processor routing decisions", () => {
  it("prefers declared file paths over weaker text sniffing signals", () => {
    const decision = createFileRoutingDecision({
      buffer: Buffer.from("# Baseline\n\nFrom: ops@example.test\n\nMarkdown body.", "utf8"),
      fileName: "knowledge-baseline.md",
      mediaTypeHint: "message/rfc822"
    });

    expect(decision).toMatchObject({
      extension: ".md",
      kind: "text",
      mediaTypeHint: "text/plain",
      selectedSource: "declared-path",
      routedFileName: "knowledge-baseline.md"
    });
    expect(decision.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "declared-path", extension: ".md" }),
        expect.objectContaining({ source: "text-sniff", extension: ".eml" })
      ])
    );
  });

  it("routes binary signatures before misleading file names", () => {
    const decision = createFileRoutingDecision({
      buffer: Buffer.from("%PDF-1.7\n% routed by signature\n", "utf8"),
      fileName: "wrong-extension.md"
    });

    expect(decision).toMatchObject({
      extension: ".pdf",
      kind: "pdf",
      mediaTypeHint: "application/pdf",
      selectedSource: "binary-signature",
      routedFileName: "wrong-extension.pdf"
    });
  });

  it("detects office document zip containers before plain zip routing", () => {
    const decision = createFileRoutingDecision({
      buffer: Buffer.from(zipSync({
        "[Content_Types].xml": strToU8("<Types/>"),
        "word/document.xml": strToU8("<w:document/>")
      })),
      fileName: "uploaded.zip"
    });

    expect(decision).toMatchObject({
      extension: ".docx",
      kind: "docx",
      selectedSource: "zip-container",
      routedFileName: "uploaded.docx"
    });
  });

  it("uses text sniffing for extensionless email uploads", () => {
    const decision = createFileRoutingDecision({
      buffer: Buffer.from("From: ops@example.test\nSubject: Routed\n\nBody", "utf8"),
      fileName: "upload"
    });

    expect(decision).toMatchObject({
      extension: ".eml",
      kind: "email",
      selectedSource: "text-sniff",
      routedFileName: "upload.eml"
    });
  });

  it("routes by media type when filename and signature are absent", () => {
    const decision = createFileRoutingDecision({
      buffer: Buffer.from("not a pdf signature", "utf8"),
      mediaTypeHint: "application/pdf"
    });

    expect(decision).toMatchObject({
      extension: ".pdf",
      kind: "pdf",
      mediaTypeHint: "application/pdf",
      selectedSource: "media-type",
      routedFileName: ""
    });
  });

  it("leaves readable unknown text unsupported when fallback is disabled", () => {
    const decision = createFileRoutingDecision({
      buffer: Buffer.from("fn main() {\n  return 42\n}\n", "utf8"),
      fileName: "module.customlang",
      allowTextFallback: false
    });

    expect(decision).toMatchObject({
      extension: "",
      descriptor: null,
      kind: "text",
      selectedSource: "unsupported",
      selectedConfidence: 0,
      isReadableText: true,
      routedFileName: "module.customlang"
    });
    expect(decision.signals).toEqual([]);
  });
});

describe("readInputSources coverage", () => {
  it("collects directory inputs and parses only supported files", async () => {
    await withTempDirectory(async (root) => {
      await createFile(root, "doc/readme.md", "Root\r\nline");
      await createFile(root, "doc/nested/notes.txt", "Nested\nline");
      await createFile(root, "ignore.bin", "\x00\x01\x02");

      const { sources, warnings, failureReasons } = await readInputSources({
        filePaths: [path.join(root, "doc")],
        userDataPath: root,
        settings: {},
        generatedAt: "2026-06-04T00:00:00.000Z"
      });

      expect(warnings).toHaveLength(0);
      expect(failureReasons).toHaveLength(0);
      expect(sources).toHaveLength(2);

      const map = Object.fromEntries(sources.map((item) => [item.name, item.text]));
      expect(map["readme.md"]).toBe("Root\nline");
      expect(map["notes.txt"]).toBe("Nested\nline");
    });
  });

  it("expands zip archives and keeps only parsed supported entries", async () => {
    await withTempDirectory(async (root) => {
      const zipBuffer = zipSync({
        "nested/readme.md": strToU8("From zip\r\nline"),
        "nested/ignore.bin": new Uint8Array([0x00, 0x01, 0x02])
      });
      await createFile(root, "bundle.zip", zipBuffer);

      const { sources } = await readInputSources({
        filePaths: [path.join(root, "bundle.zip")],
        userDataPath: root,
        settings: {}
      });

      expect(sources).toHaveLength(1);
      expect(sources[0]).toMatchObject({
        name: "nested/readme.md",
        kind: "text",
        text: "From zip\nline"
      });
    });
  });

  it("normalizes pasted text into a standalone text source", async () => {
    await withTempDirectory(async (root) => {
      const { sources } = await readInputSources({
        inputText: "  \r\nLine1\r\nLine2\r\n  ",
        userDataPath: root,
        settings: {},
        generatedAt: "2026-06-04T00:00:00.000Z"
      });

      expect(sources).toHaveLength(1);
      expect(sources[0]).toMatchObject({
        id: "pasted-text",
        name: "粘贴文本",
        kind: "text",
        path: "",
        text: "Line1\nLine2"
      });
    });
  });

  it("normalizes upload source metadata and returns raw object payload", async () => {
    await withTempDirectory(async (root) => {
      const uploadedPayload = Buffer.from("Uploaded text sample");
      const { sources } = await readInputSources({
        batchId: "batch-001",
        userDataPath: root,
        settings: {},
        uploadedFiles: [
          {
            originalFileName: "report.txt",
            dataBase64: uploadedPayload.toString("base64"),
            sourceMetadata: { manifest: "from-options" }
          }
        ],
        providerId: "provider-top",
        externalId: "external-top",
        syncBatchId: "sync-top",
        contentHash: "content-top",
        capturedAt: "2026-06-04T00:00:00.000Z"
      });

      expect(persistRawMailObjectMock).toHaveBeenCalledTimes(1);
      expect(createImportEntryIdMock).toHaveBeenCalledTimes(1);

      const source = sources[0];
      expect(source).toMatchObject({
        name: "report.txt",
        kind: "text",
        text: "Uploaded text sample",
        providerId: "provider-top",
        externalId: "external-top",
        syncBatchId: "sync-top",
        contentHash: "content-top",
        sourceMetadata: {
          manifest: "from-options",
          providerId: "provider-top",
          externalId: "external-top",
          syncBatchId: "sync-top",
          capturedAt: "2026-06-04T00:00:00.000Z"
        },
        rawObject: {
          storageRelativePath: "objects/raw/object-001.bin",
          providerId: "provider-top",
          externalId: "external-top",
          syncBatchId: "sync-top",
          contentHash: "content-top"
        }
      });
    });
  });

  it("fails with unsupported branch when a file is neither routable nor readable text", async () => {
    await withTempDirectory(async (root) => {
      const unreadablePath = await createFile(root, "bad.bin", "\u0000\u0001\u0002\u0003");
      await expect(
        readInputSources({
          filePaths: [unreadablePath],
          userDataPath: root,
          settings: {},
          generatedAt: "2026-06-04T00:00:00.000Z"
        })
      ).rejects.toMatchObject({
        reasonCode: "document_parse_no_usable_content",
        failureReasons: expect.arrayContaining([
          expect.objectContaining({ reasonCode: "filesystem_input_parse_failed" })
        ])
      });
    });
  });

  it("uses OCR mount for images and returns normalized text", async () => {
    await withTempDirectory(async (root) => {
      const pngPath = await createFile(root, "sample.png", "\x89PNG\r\n\x1a\n\x00\x00");
      const extractTextMock = vi.fn(async () => "  OCR\u7ed3\u679c \r\n");
      const { sources } = await readInputSources({
        filePaths: [pngPath],
        userDataPath: root,
        settings: { ocrEnabled: true },
        runtime: makeRuntime({
          ocr: {
            enabled: true,
            id: "ocr-mock",
            extractText: extractTextMock
          }
        })
      });

      expect(extractTextMock).toHaveBeenCalledTimes(1);
      expect(sources).toHaveLength(1);
      expect(sources[0]).toMatchObject({
        kind: "image",
        text: "OCR结果",
        warnings: [],
        ocrAttempted: true,
        documentParserId: "ocr-mock",
        mediaType: "image/png",
        imageDataUrl: expect.stringMatching(/^data:image\/png;base64,/)
      });
    });
  });

  it("parses PDF files through the PDF processor mount", async () => {
    await withTempDirectory(async (root) => {
      const pdfPath = await createFile(root, "report.pdf", "%PDF-1.7\n% mock");
      const extractDocumentMock = vi.fn(async () => ({ text: "  PDF\u89e3\u6790\u5b8c\u6210 \r\n" }));
      const { sources } = await readInputSources({
        filePaths: [pdfPath],
        userDataPath: root,
        settings: {},
        runtime: makeRuntime({
          pdfProcessor: {
            enabled: true,
            id: "pdf-mock",
            extractDocument: extractDocumentMock
          }
        })
      });

      expect(extractDocumentMock).toHaveBeenCalledTimes(1);
      expect(sources).toHaveLength(1);
      expect(sources[0]).toMatchObject({
        kind: "pdf",
        text: "PDF\u89e3\u6790\u5b8c\u6210",
        mediaType: "application/pdf",
        documentParserId: "pdf-mock",
        ocrAttempted: false
      });
    });
  });
});
