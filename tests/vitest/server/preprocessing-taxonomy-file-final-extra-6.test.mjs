import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createImportEntryIdMock = vi.hoisted(() => vi.fn());
const collectProtectedRawObjectPathsMock = vi.hoisted(() => vi.fn(async () => new Set()));
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
const ocrExtractTextMock = vi.hoisted(() => vi.fn());

vi.mock("../../../server/platform/common/storage/import-resume-store.mjs", () => ({
  createImportEntryId: createImportEntryIdMock,
  collectProtectedRawObjectPaths: collectProtectedRawObjectPathsMock,
  cleanupImportArtifacts: cleanupImportArtifactsMock,
  hydrateImportCheckpointSources: hydrateImportCheckpointSourcesMock,
  loadImportCheckpointEntry: loadImportCheckpointEntryMock,
  rawObjectPathsFromSources: rawObjectPathsFromSourcesMock,
  saveImportCheckpointEntry: saveImportCheckpointEntryMock,
  validateImportCheckpointEntry: validateImportCheckpointEntryMock
}));

vi.mock("../../../server/platform/common/storage/raw-object-store.mjs", () => ({
  persistRawMailObject: persistRawMailObjectMock
}));

import { readInputSources } from "../../../server/platform/specialized/knowledge/preprocessing/file-processor/index.mjs";
import {
  createKnowledgeTaxonomyRuntime,
  listKnowledgeTaxonomyVersions,
  loadKnowledgeGuidance,
  saveKnowledgeTaxonomy
} from "../../../server/platform/specialized/knowledge/preprocessing/domain/knowledge-taxonomy/index.mjs";
import { buildTransactionContinuityModel } from "../../../server/platform/specialized/knowledge/preprocessing/domain/rules/transaction-continuity-model.mjs";

let importEntryCounter = 0;
const tempRoots = [];

async function withTempRoot(prefix, callback) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
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

function emlFixture({
  from,
  to = "user@example.local",
  cc = "",
  subject,
  date = "Fri, 05 Jun 2026 09:00:00 +0000",
  messageId,
  listId = "",
  body = ""
}) {
  const lines = [`From: ${from}`, `To: ${to}`];
  if (cc) {
    lines.push(`Cc: ${cc}`);
  }
  if (subject !== undefined) {
    lines.push(`Subject: ${subject}`);
  }
  lines.push(`Date: ${date}`, `Message-ID: <${messageId}>`);
  if (listId) {
    lines.push(`List-ID: ${listId}`);
  }
  lines.push("Content-Type: text/plain; charset=utf-8", "", body);
  return lines.join("\n");
}

function makeParserRuntime() {
  let pdfRouteStage = 0;

  return {
    resolveDocumentRoute({ sourceKind = "", extension = "" } = {}) {
      if (sourceKind === "image") {
        return {
          mountName: "ocr",
          action: "extractText",
          matchedBy: "image-route"
        };
      }

      if (sourceKind === "pdf" || extension === ".pdf") {
        pdfRouteStage += 1;
        return pdfRouteStage === 1
          ? {
              mountName: "documentParser",
              action: "extractDocument",
              matchedBy: "initial-pdf-parse"
            }
          : {
              mountName: "ocr",
              action: "extractText",
              matchedBy: "pdf-ocr-fallback"
            };
      }

      return {
        mountName: "documentParser",
        action: "extractDocument",
        matchedBy: "default"
      };
    },
    mounts: {
      documentParser: {
        enabled: true,
        id: "document-parser",
        extractDocument: documentParserExtractDocumentMock
      },
      ocr: {
        enabled: true,
        id: "ocr",
        extractText: ocrExtractTextMock
      }
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
  ocrExtractTextMock.mockReset();
});

afterEach(async () => {
  vi.clearAllMocks();
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("preprocessing taxonomy/file final extra 6 coverage", () => {
  it("routes pasted text, parsed text files, pdf OCR fallback, and uploaded image OCR through mocked handlers", async () => {
    await withTempRoot("pact-preprocessing-file-extra-6-", async (userDataPath) => {
      const inputsDir = path.join(userDataPath, "inputs");
      const notesPath = path.join(inputsDir, "notes.txt");
      const reportPath = path.join(inputsDir, "report.pdf");

      await writeFile(notesPath, "  Notes body  \r\nSecond line  ");
      await writeFile(reportPath, Buffer.from("%PDF-1.7\n% mocked report", "utf8"));

      documentParserExtractDocumentMock.mockImplementation(async ({ fileName = "" } = {}) => {
        if (String(fileName).endsWith("notes.txt")) {
          return {
            parserId: "document-parser",
            text: "  Notes body  \r\nSecond line  ",
            metadata: {
              "Content-Type": "text/plain"
            }
          };
        }

        if (String(fileName).endsWith("report.pdf")) {
          return {
            parserId: "document-parser",
            text: "",
            metadata: {
              "Content-Type": "application/pdf"
            },
            warnings: [" parser warning "]
          };
        }

        return {
          parserId: "document-parser",
          text: "fallback",
          metadata: {
            "Content-Type": "text/plain"
          }
        };
      });

      ocrExtractTextMock.mockResolvedValue({
        parserId: "ocr",
        text: "  OCR line 1 \nOCR line 2  ",
        metadata: {
          "Content-Type": "text/plain"
        },
        warnings: []
      });

      const result = await readInputSources({
        inputText: "  Pasted  \r\nText  ",
        filePaths: [notesPath, reportPath],
        uploadedFiles: [
          {
            originalFileName: "scan.png",
            dataBase64: Buffer.from(
              "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2XvwsAAAAASUVORK5CYII=",
              "base64"
            ).toString("base64"),
            mediaType: "image/png",
            providerId: "provider-1",
            externalId: "external-1",
            syncBatchId: "sync-1",
            contentHash: "hash-1",
            capturedAt: "2026-06-05T00:00:00.000Z"
          }
        ],
        batchId: "batch-preprocessing-6",
        archiveBatchId: "batch-preprocessing-6",
        userDataPath,
        settings: {
          ocrEnabled: true
        },
        generatedAt: "2026-06-05T00:00:00.000Z",
        runtime: makeParserRuntime()
      });

      expect(cleanupImportArtifactsMock).toHaveBeenCalledTimes(2);
      expect(result.sources).toHaveLength(4);

      const byName = new Map(result.sources.map((entry) => [entry.name, entry]));
      expect(byName.get("粘贴文本")).toMatchObject({
        kind: "text",
        text: "Pasted  \nText"
      });
      expect(byName.get("notes.txt")).toMatchObject({
        kind: "text",
        text: "Notes body  \nSecond line",
        documentParserId: "builtin/text-direct"
      });
      expect(byName.get("report.pdf")).toMatchObject({
        kind: "pdf",
        text: expect.stringContaining("OCR line 1"),
        documentParserId: "document-parser",
        ocrAttempted: true
      });
      expect(byName.get("report.pdf").text).toContain("OCR line 2");
      expect(byName.get("scan.png")).toMatchObject({
        kind: "image",
        text: expect.stringContaining("OCR line 1"),
        documentParserId: "ocr",
        ocrAttempted: true,
        rawObject: expect.objectContaining({
          storageRelativePath: "objects/raw/object-001.bin"
        })
      });
      expect(byName.get("scan.png").text).toContain("OCR line 2");
      expect(result.warnings).toEqual(expect.arrayContaining(["parser warning"]));
    });
  });

  it("loads bundled guidance without a user path and preserves saved taxonomy categories when categories are omitted", async () => {
    const bundledGuidance = await loadKnowledgeGuidance();
    expect(bundledGuidance.categories.length).toBeGreaterThan(0);
    expect(bundledGuidance.guidance.compiled.categoryCount).toBeGreaterThan(0);

    await withTempRoot("pact-taxonomy-extra-6-", async (userDataPath) => {
      const rulesDir = path.join(userDataPath, "rules");
      await fs.mkdir(rulesDir, { recursive: true });
      await fs.writeFile(path.join(rulesDir, "knowledge-taxonomy.json"), "{ not valid json");

      const runtime = createKnowledgeTaxonomyRuntime(userDataPath);
      const first = runtime.loadSync();
      const second = runtime.loadSync();

      expect(first).toBe(second);
      expect(first.guidance.compiled.categoryCount).toBeGreaterThan(0);

      const saved = await saveKnowledgeTaxonomy(userDataPath, {
        source: "custom",
        fallbackPath: "general/fallback"
      });

      expect(saved.version).toBeGreaterThan(first.version);
      expect(saved.categories.length).toBeGreaterThan(0);

      const versions = await listKnowledgeTaxonomyVersions(userDataPath);
      expect(versions.current.version).toBe(saved.version);
      expect(versions.history).toHaveLength(1);
      expect(versions.history[0].version).toBe(first.version);
      expect(versions.history[0].path).toContain(`knowledge-taxonomy.v${first.version}.`);
    });
  });

  it("builds continuity signals for annual, direct-address, generic-local, and deduplicated recipient messages", async () => {
    await withTempRoot("pact-transaction-extra-6-", async (root) => {
      const mailRoot = path.join(root, "mail");
      const outputPath = path.join(root, "out");
      await fs.mkdir(mailRoot, { recursive: true });

      await writeFile(
        path.join(mailRoot, "annual-report.eml"),
        emlFixture({
          from: "Alerts <alerts@news.example.co.uk>",
          to: "alpha@example.test; alpha@example.test, beta@example.test",
          cc: "beta@example.test, gamma@example.test",
          subject: "Annual report digest",
          date: "Fri, 05 Jun 2026 09:00:00 +0000",
          messageId: "annual-report",
          listId: "< Weekly.Updates.News.Example.Co.Uk >",
          body: [
            "Please review invoice INV-2024-9001 for Project Apollo.",
            "Contract CN-2024-7788 is attached.",
            "Order PO-998877 requires approval."
          ].join("\n")
        })
      );

      await writeFile(
        path.join(mailRoot, "direct-address.eml"),
        emlFixture({
          from: "alice@service.example",
          to: "bob@example.local",
          subject: "Monthly statement",
          date: "Sat, 06 Jun 2026 09:00:00 +0000",
          messageId: "direct-address",
          body: "Monthly billing statement ready."
        })
      );

      await writeFile(
        path.join(mailRoot, "reminder.eml"),
        emlFixture({
          from: "Support <support@ops.example>",
          to: "ops@example.local",
          subject: "Reminder: action required today",
          date: "Sun, 07 Jun 2026 09:00:00 +0000",
          messageId: "reminder",
          body: "Please verify the reminder and confirm receipt."
        })
      );

      const result = await buildTransactionContinuityModel({
        roots: [mailRoot],
        outputPath,
        rebuild: true,
        reviewEvery: 5000,
        reviewDaily: false,
        maxDocs: 0
      });

      expect(result.manifest.stats.failedFiles).toBe(0);
      expect(result.summaries).toHaveLength(3);

      const summariesByFile = new Map(result.summaries.map((item) => [item.messages[0].filePath, item]));
      const annualSummary = summariesByFile.get("annual-report.eml");
      const directSummary = summariesByFile.get("direct-address.eml");
      const reminderSummary = summariesByFile.get("reminder.eml");

      expect(annualSummary).toBeTruthy();
      expect(annualSummary.senderOrg).toBe("example.co.uk");
      expect(annualSummary.cadence).toBe("annual");
      expect(annualSummary.listIds).toEqual(expect.arrayContaining(["example.co.uk"]));
      expect(annualSummary.messages[0].recipients).toEqual(
        expect.arrayContaining([
          "alpha@example.test",
          "beta@example.test",
          "gamma@example.test"
        ])
      );

      expect(directSummary).toBeTruthy();
      expect(directSummary.senderOrg).toBe("service.example");
      expect(directSummary.cadence).toBe("monthly");

      expect(reminderSummary).toBeTruthy();
      expect(reminderSummary.cadence).toBe("irregular");
    });
  });
});
