import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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
  readInputSources
} from "../../../server/platform/specialized/knowledge/preprocessing/file-processor/index.mjs";
import { generateNormalizedDocuments } from "../../../server/platform/specialized/knowledge/preprocessing/file-processor/FileNormalizer/NormalizedDocuments/index.mjs";
import {
  getNormalizedManifestPath,
  loadNormalizedDocumentsManifest,
  resolveNormalizedDocumentEntry,
  resolveNormalizedDocumentPath
} from "../../../server/platform/specialized/knowledge/preprocessing/file-processor/FileNormalizer/NormalizedDocuments/store.mjs";
import {
  DYNAMIC_PARAMETER_DOCUMENT_PARSING_POLICY_ID,
  bindDynamicDocumentParsingInvocation,
  dispatchDynamicDocumentParsingAlgorithm
} from "../../../server/platform/specialized/knowledge/preprocessing/dynamic-parameter-document-parsing.mjs";
import { runEmailAnalysis } from "../../../server/platform/specialized/knowledge/preprocessing/domain/rules/email-analysis.mjs";
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

function makeParserDisabledRuntime() {
  return {
    mounts: {
      documentParser: {
        enabled: false,
        id: "document-parser"
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
});

afterEach(async () => {
  vi.clearAllMocks();
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("file processor and domain final extra 3 coverage", () => {
  it("falls back to built-in text parsing when the parser is missing and rejects unsupported binary input", async () => {
    await withTempRoot("pact-file-processor-final-extra-3-", async (userDataPath) => {
      const textPath = path.join(userDataPath, "inputs", "notes.txt");
      const badPath = path.join(userDataPath, "inputs", "bad.bin");

      await writeFile(textPath, "  Hello world  \r\nSecond line  ");
      await writeFile(badPath, Buffer.from([0, 1, 2, 3, 4, 5, 0, 9]));

      const parsed = await readInputSources({
        filePaths: [textPath],
        userDataPath,
        settings: {},
        generatedAt: "2026-06-05T00:00:00.000Z",
        runtime: makeParserDisabledRuntime()
      });

      expect(parsed.sources).toHaveLength(1);
      expect(parsed.sources[0]).toMatchObject({
        kind: "text",
        name: "notes.txt",
        documentParserId: "builtin/text-direct",
        mediaType: "text/plain",
        text: "Hello world  \nSecond line"
      });
      expect(parsed.warnings).toEqual([]);

      await expect(
        readInputSources({
          filePaths: [badPath],
          userDataPath,
          settings: {},
          generatedAt: "2026-06-05T00:00:00.000Z",
          runtime: makeParserDisabledRuntime()
        })
      ).rejects.toMatchObject({
        reasonCode: "document_parse_no_usable_content",
        failureReasons: expect.arrayContaining([
          expect.objectContaining({
            reasonCode: "filesystem_input_parse_failed",
            sourceName: "bad.bin",
            sourceKind: "filesystem"
          })
        ])
      });
    });
  });

  it("generates fallback normalized documents for unsupported sources and keeps empty email analysis quiet", async () => {
    await withTempRoot("pact-normalized-documents-final-extra-3-", async (userDataPath) => {
      const manifest = await generateNormalizedDocuments({
        userDataPath,
        jobId: "job-fallback-empty",
        generatedAt: "2026-06-05T00:00:00.000Z",
        sources: [
          {
            id: "blob-1",
            kind: "blob",
            name: "",
            path: "",
            text: ""
          },
          {
            id: "mail-skip",
            kind: "email",
            text: "   "
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
      expect(manifest.warnings).toEqual([]);
      expect(manifest.summary).toMatchObject({
        documentCount: 1,
        sourceMaterialCount: 0,
        assetCount: 0,
        byGranularity: {
          source: 1
        }
      });

      const loaded = await loadNormalizedDocumentsManifest(userDataPath, "job-fallback-empty");
      expect(loaded.summary).toEqual(manifest.summary);
      const docEntry = resolveNormalizedDocumentEntry(loaded, manifest.documents[0].documentId);
      const docPath = resolveNormalizedDocumentPath(userDataPath, "job-fallback-empty", docEntry);
      await expect(fs.stat(docPath)).resolves.toBeTruthy();
      expect(await fs.readFile(getNormalizedManifestPath(userDataPath, "job-fallback-empty"), "utf8")).toContain(
        "pact.normalized-documents"
      );
    });
  });

  it("dispatches code and list fragments while clamping invalid dynamic parsing budgets", () => {
    const binding = bindDynamicDocumentParsingInvocation({
      sources: [
        {
          id: "source-1",
          name: "Mixed source",
          path: "/tmp/mixed.md",
          mediaType: "text/markdown",
          contentHash: "hash-1"
        }
      ],
      blocks: [
        {
          id: "code-1",
          sourceId: "source-1",
          kind: "code",
          text: "const a = 1;\nconst b = 2;\nconst c = a + b;",
          sourceStartLine: "1",
          sourceEndLine: "3",
          headingPath: ["Code"]
        },
        {
          id: "list-1",
          sourceId: "source-1",
          kind: "list",
          text: "- alpha\n- beta\n- gamma",
          sourceStartLine: "4",
          sourceEndLine: "6",
          headingPath: ["List"]
        }
      ],
      contextBudget: {
        knowledgeTokens: -5,
        budgetScope: ""
      },
      payloadBudget: {
        maxResponseBytes: 1,
        maxEvidenceBytes: 1
      },
      granularity: {
        preferOriginalStructure: false,
        allowPartialEvidence: false,
        secondaryParse: {
          enabled: true,
          algorithm: "auto",
          targetTokens: "bad",
          targetChars: "bad"
        }
      },
      chunking: {
        maxTokens: 16,
        maxChars: 32
      }
    });

    expect(binding.policy.contextBudget).toEqual({
      knowledgeTokens: 80,
      budgetScope: "knowledge-recall-only"
    });
    expect(binding.policy.payloadBudget).toEqual({
      maxResponseBytes: 4096,
      maxEvidenceBytes: 2048
    });
    expect(binding.policy.granularity.targetTokens).toBe(512);
    expect(binding.policy.granularity.targetChars).toBe(2048);
    expect(binding.policy.granularity.preferOriginalStructure).toBe(false);
    expect(binding.policy.granularity.allowPartialEvidence).toBe(false);
    expect(binding.granularityFragments).toHaveLength(2);
    expect(binding.backendTrace.secondaryParse).toMatchObject({
      enabled: true,
      algorithm: "auto",
      materialization: "on-demand-secondary-parse"
    });
    expect(binding.backendTrace.algorithms.map((item) => item.algorithm)).toEqual([
      "code-line-window-v1",
      "list-item-window-v1"
    ]);
    expect(binding.granularityFragments[0]).toMatchObject({
      policyId: DYNAMIC_PARAMETER_DOCUMENT_PARSING_POLICY_ID,
      granularity: "code-line-window",
      fragmentationTrace: {
        policy: DYNAMIC_PARAMETER_DOCUMENT_PARSING_POLICY_ID,
        algorithm: "code-line-window-v1"
      }
    });
    expect(binding.granularityFragments[1]).toMatchObject({
      policyId: DYNAMIC_PARAMETER_DOCUMENT_PARSING_POLICY_ID,
      granularity: "list-item-window",
      fragmentationTrace: {
        policy: DYNAMIC_PARAMETER_DOCUMENT_PARSING_POLICY_ID,
        algorithm: "list-item-window-v1"
      }
    });
  });

  it("treats malformed email sources as empty enough to fall back, and keeps zero-input analysis stable", () => {
    const parsed = runEmailAnalysis({
      sources: [
        {
          id: "mail-1",
          kind: "email",
          name: "",
          text: "   \n"
        }
      ],
      chunks: [],
      settings: {
        retrievalHalfLifeDays: 14,
        staleAfterDays: 30
      },
      generatedAt: "2026-06-05T00:00:00.000Z",
      rules: {}
    });

    expect(parsed.overview).toMatchObject({
      emailCount: 1,
      threadCount: 1,
      transactionCount: 1
    });
    expect(parsed.emails[0]).toMatchObject({
      subject: "未命名邮件",
      body: "",
      status: "active",
      formalUseAllowed: true
    });
    expect(parsed.timeline).toHaveLength(1);

    const empty = runEmailAnalysis({
      sources: [],
      chunks: [],
      settings: {
        retrievalHalfLifeDays: 14,
        staleAfterDays: 30
      },
      generatedAt: "2026-06-05T00:00:00.000Z",
      rules: {}
    });

    expect(empty.overview).toEqual({
      emailCount: 0,
      threadCount: 0,
      transactionCount: 0,
      peopleCount: 0,
      timelineCount: 0,
      currentCount: 0,
      agingCount: 0,
      historicalCount: 0
    });
    expect(empty.emails).toEqual([]);
    expect(empty.transactions).toEqual([]);
  });

  it("rejects invalid domain rule inputs and handles empty transaction roots without producing artifacts", async () => {
    await expect(
      // Missing settings exercises the exception path in the email analysis pipeline.
      () =>
        runEmailAnalysis({
          sources: [],
          chunks: [],
          generatedAt: "2026-06-05T00:00:00.000Z",
          rules: {}
        })
    ).toThrow(TypeError);

    await withTempRoot("pact-transaction-continuity-final-extra-3-", async (root) => {
      const emptyMailRoot = path.join(root, "mail-empty");
      const outputPath = path.join(root, "out");
      await fs.mkdir(emptyMailRoot, { recursive: true });

      const result = await buildTransactionContinuityModel({
        roots: [emptyMailRoot],
        outputPath,
        maxDocs: 0,
        reviewEvery: 1,
        reviewDaily: false,
        rebuild: false
      });

      expect(result.manifest.stats).toMatchObject({
        scannedFiles: 0,
        processedFiles: 0,
        skippedUnchanged: 0,
        failedFiles: 0
      });
      expect(result.manifest.files).toMatchObject({
        transactionsJson: "transactions.json",
        transactionsCsv: "transactions.csv",
        overviewDocx: "transaction-overview.docx",
        transactionDocDirectory: "transactions",
        transactionJsonDirectory: "transactions-json"
      });
      expect(result.summaries).toEqual([]);
      expect(result.generatedDocCount).toBe(1);

      await expect(fs.stat(path.join(outputPath, "manifest.json"))).resolves.toBeTruthy();
      await expect(fs.stat(path.join(outputPath, "transaction-overview.docx"))).resolves.toBeTruthy();
    });

    await expect(
      // Missing roots exercises the async argument validation failure.
      buildTransactionContinuityModel({
        outputPath: path.join(os.tmpdir(), "pact-transaction-missing-roots")
      })
    ).rejects.toThrow(TypeError);
  });
});
