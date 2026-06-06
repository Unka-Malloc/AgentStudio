import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const childProcessState = vi.hoisted(() => ({
  rgAvailable: true,
  rgMatchesByTerm: new Map()
}));

const execFileMock = vi.hoisted(() =>
  vi.fn((command, args, options, callback) => {
    const cb = typeof options === "function" ? options : callback;
    const cwd = typeof options === "object" && options ? options.cwd : process.cwd();
    const terms = [];
    for (let index = 0; index < args.length; index += 1) {
      if (args[index] === "-e" && typeof args[index + 1] === "string") {
        terms.push(args[index + 1]);
      }
    }
    const key = terms.map((term) => String(term).toLowerCase()).join("\u0000");
    const matches = childProcessState.rgMatchesByTerm.get(key) || [];
    const stdout = matches.map((file) => path.relative(cwd, file)).join("\n");
    queueMicrotask(() => cb(null, { stdout, stderr: "" }));
  })
);

const spawnSyncMock = vi.hoisted(() =>
  vi.fn(() => ({
    status: childProcessState.rgAvailable ? 0 : 1
  }))
);

const getIndexedSourceFileByEvidenceIdMock = vi.hoisted(() => vi.fn());
const indexedCandidateFilesForRootMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  execFile: execFileMock,
  spawnSync: spawnSyncMock
}));

vi.mock(
  "../../../server/platform/specialized/knowledge/storage/source-file-index-service.mjs",
  async () => {
    const actual = await vi.importActual(
      "../../../server/platform/specialized/knowledge/storage/source-file-index-service.mjs"
    );
    return {
      ...actual,
      getIndexedSourceFileByEvidenceId: getIndexedSourceFileByEvidenceIdMock,
      indexedCandidateFilesForRoot: indexedCandidateFilesForRootMock
    };
  }
);

let getSourceFileEvidence;
let isSourceEvidenceId;
let searchSourceFiles;
let sourceEvidenceIdForPath;

beforeAll(async () => {
  ({
    getSourceFileEvidence,
    isSourceEvidenceId,
    searchSourceFiles
  } = await import("../../../server/platform/specialized/knowledge/retrieval/source-file-search-service.mjs"));
  ({ sourceEvidenceIdForPath } = await import("../../../server/platform/specialized/knowledge/storage/source-file-index-service.mjs"));
});

beforeEach(() => {
  childProcessState.rgAvailable = true;
  childProcessState.rgMatchesByTerm.clear();
  execFileMock.mockClear();
  spawnSyncMock.mockClear();
  getIndexedSourceFileByEvidenceIdMock.mockReset();
  indexedCandidateFilesForRootMock.mockReset();
  getIndexedSourceFileByEvidenceIdMock.mockResolvedValue(null);
  indexedCandidateFilesForRootMock.mockResolvedValue({
    available: false,
    reason: "index_unavailable"
  });
});

async function withTempUserData(testCase) {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-source-search-extra-"));
  try {
    return await testCase(userDataPath);
  } finally {
    await fs.rm(userDataPath, { recursive: true, force: true });
  }
}

function eml({ subject, body, from = "sender@example.test" }) {
  return [
    `From: ${from}`,
    "To: recipient@example.test",
    `Subject: ${subject}`,
    "Date: Fri, 01 May 2026 10:00:00 +0000",
    "Content-Type: text/plain; charset=utf-8",
    "",
    body
  ].join("\n");
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function prepareFixture(userDataPath) {
  const sourceRoot = path.join(userDataPath, "mail");
  const ignoredRoot = path.join(sourceRoot, "node_modules");
  const nestedRoot = path.join(sourceRoot, "nested");
  await fs.mkdir(ignoredRoot, { recursive: true });
  await fs.mkdir(nestedRoot, { recursive: true });

  const alphaBody = "alpha body token";
  const alphaMail = eml({
    subject: "Alpha bulletin",
    body: [`alpha line one`, alphaBody].join("\n")
  });
  await fs.writeFile(path.join(sourceRoot, "dup-a.eml"), alphaMail, "utf8");
  await fs.writeFile(path.join(sourceRoot, "dup-b.eml"), alphaMail, "utf8");

  await fs.writeFile(
    path.join(sourceRoot, "raw-only.eml"),
    eml({
      subject: "Tracking notice",
      body: [
        "This message only exposes the token through a URL.",
        "https://example.test/redirect?trackingcode=raw-only-token&campaign=summer"
      ].join("\n")
    }),
    "utf8"
  );

  await fs.writeFile(
    path.join(nestedRoot, "visible-cn.eml"),
    eml({
      subject: "检索测试",
      body: "这里包含检索测试 以及一些正文。"
    }),
    "utf8"
  );
  await fs.writeFile(
    path.join(ignoredRoot, "ignored-cn.eml"),
    eml({
      subject: "检索测试",
      body: "这个文件应该被忽略。"
    }),
    "utf8"
  );

  await fs.writeFile(
    path.join(sourceRoot, "preview-large.eml"),
    eml({
      subject: "Preview subject",
      body: [
        "Body header line",
        "x".repeat(20 * 1024),
        "TAIL-MUST-NOT-APPEAR"
      ].join("\n")
    }),
    "utf8"
  );

  await writeJson(path.join(userDataPath, "rules", "source-search-rules.json"), {
    schemaVersion: 1,
    updatedAt: "2026-06-04T00:00:00.000Z",
    maxFileBytes: 256 * 1024,
    maxEvidenceBytes: 16 * 1024,
    maxScanFiles: 100,
    readConcurrency: 2,
    indexConcurrency: 2,
    indexMaxTermsPerFile: 2000,
    cacheTtlMs: 60 * 1000,
    includeKnowledgeSources: false,
    useInvertedIndex: true,
    scanFallbackWhenIndexMissing: false,
    knowledgeSourceExtensions: [".eml"],
    ignoredDirectories: ["node_modules"],
    scanRoots: [
      {
        id: "mail-root",
        label: "Mail Root",
        relativePath: "mail",
        extensions: [".eml"],
        enabled: true
      }
    ],
    queryExpansions: [],
    snippetWindow: 120
  });

  return { sourceRoot };
}

describe("source-file-search service extra coverage", () => {
  it("recognizes source evidence ids", () => {
    expect(isSourceEvidenceId("source-evidence::abc123")).toBe(true);
    expect(isSourceEvidenceId("not-an-evidence-id")).toBe(false);
    expect(isSourceEvidenceId("")).toBe(false);
  });

  it("searches duplicate matches through ripgrep candidate search and dedupes by content hash", async () => {
    await withTempUserData(async (userDataPath) => {
      const { sourceRoot } = await prepareFixture(userDataPath);
      childProcessState.rgMatchesByTerm.set("alpha", [
        path.join(sourceRoot, "dup-a.eml"),
        path.join(sourceRoot, "dup-b.eml")
      ]);

      const result = await searchSourceFiles({
        userDataPath,
        query: "alpha",
        limit: 10
      });

      expect(spawnSyncMock).toHaveBeenCalledTimes(1);
      expect(execFileMock).toHaveBeenCalledTimes(1);
      expect(result.explain.candidateSearch).toBe("ripgrep-fixed-strings");
      expect(result.explain.highRelevanceCount).toBe(1);
      expect(result.explain.lowRelevanceCount).toBe(0);
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        title: "Alpha bulletin",
        relevanceTier: "high",
        lowRelevance: undefined,
        contextEligible: true,
        source: expect.objectContaining({
          relativePath: expect.stringMatching(/^mail\/dup-[ab]\.eml$/)
        })
      });
    });
  });

  it("falls back to directory walking for readable-only queries and respects ignored directories", async () => {
    await withTempUserData(async (userDataPath) => {
      await prepareFixture(userDataPath);

      const result = await searchSourceFiles({
        userDataPath,
        query: "检索测试",
        limit: 10
      });

      expect(result.explain.candidateSearch).toBe("js-directory-walk");
      expect(result.items).toHaveLength(1);
      expect(result.items[0].source.relativePath).toBe("mail/nested/visible-cn.eml");
      expect(result.items[0].title).toBe("检索测试");
      expect(result.items[0].relevanceTier).toBe("high");
    });
  });

  it("marks raw-only URL matches as low relevance", async () => {
    await withTempUserData(async (userDataPath) => {
      await prepareFixture(userDataPath);
      childProcessState.rgMatchesByTerm.set("raw-only-token", [
        path.join(userDataPath, "mail", "raw-only.eml")
      ]);

      const result = await searchSourceFiles({
        userDataPath,
        query: "raw-only-token",
        limit: 10
      });

      expect(result.items).toHaveLength(1);
      expect(result.explain.lowRelevanceCount).toBe(1);
      expect(result.items[0]).toMatchObject({
        title: "Tracking notice",
        relevanceTier: "low",
        lowRelevance: true,
        contextEligible: false,
        lowRelevanceReason: "query_matched_raw_eml_only_after_readable_body_gate_removed"
      });
    });
  });

  it("returns truncated evidence previews for large source files", async () => {
    await withTempUserData(async (userDataPath) => {
      const { sourceRoot } = await prepareFixture(userDataPath);
      const evidenceId = sourceEvidenceIdForPath(
        userDataPath,
        path.join(sourceRoot, "preview-large.eml")
      );

      const evidence = await getSourceFileEvidence({
        userDataPath,
        evidenceId
      });

      expect(evidence).toMatchObject({
        evidenceId,
        title: "Preview subject",
        documentId: evidenceId
      });
      expect(evidence.sourceLocator).toMatchObject({
        relativePath: "mail/preview-large.eml",
        truncated: true
      });
      expect(evidence.payload.blocks[0].text).toContain("[Pact evidence preview:");
      expect(evidence.payload.blocks[0].text).not.toContain("TAIL-MUST-NOT-APPEAR");
      expect(evidence.markdown).toContain("预览：仅返回前");
    });
  });

  it("returns null for non-source evidence ids", async () => {
    await withTempUserData(async (userDataPath) => {
      await prepareFixture(userDataPath);

      await expect(
        getSourceFileEvidence({
          userDataPath,
          evidenceId: "not-a-source-evidence"
        })
      ).resolves.toBeNull();
    });
  });

  it("derives knowledge-source defaults from directory path and falls back to scan-root extensions", async () => {
    await withTempUserData(async (userDataPath) => {
      const sourceRoot = path.join(userDataPath, "knowledge-default");
      await fs.mkdir(sourceRoot, { recursive: true });
      await fs.writeFile(
        path.join(sourceRoot, "invoice.eml"),
        eml({
          subject: "默认来源",
          body: "这里包含 发票 关键证据。"
        }),
        "utf8"
      );
      await writeJson(path.join(userDataPath, "rules", "source-search-rules.json"), {
        schemaVersion: 1,
        updatedAt: "source-defaults-2026-06-05",
        maxFileBytes: 256 * 1024,
        maxEvidenceBytes: 16 * 1024,
        maxScanFiles: 20,
        readConcurrency: 2,
        indexConcurrency: 2,
        indexMaxTermsPerFile: 2000,
        cacheTtlMs: 60 * 1000,
        includeKnowledgeSources: true,
        useInvertedIndex: true,
        scanFallbackWhenIndexMissing: true,
        knowledgeSourceExtensions: [],
        ignoredDirectories: [],
        scanRoots: [
          {
            id: "seed-root",
            label: "Seed Root",
            relativePath: "seed",
            extensions: [".eml"],
            enabled: true
          }
        ],
        queryExpansions: [],
        snippetWindow: 80
      });
      await writeJson(path.join(userDataPath, "knowledge-sources", "sources.json"), {
        sources: [
          {
            directoryPath: sourceRoot,
            enabled: true
          }
        ]
      });

      const result = await searchSourceFiles({
        userDataPath,
        query: "发票",
        limit: 5
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        title: "默认来源",
        relevanceTier: "high"
      });
      expect(result.explain.candidateSearch).toBe("js-directory-walk");
      expect(result.explain.invertedIndex.unavailableSources[0]).toMatchObject({
        sourceId: expect.stringMatching(/^knowledge-source-[a-f0-9]{12}$/),
        reason: "index_unavailable"
      });
    });
  });

  it("skips invalid roots and stops directory walking at maxScanFiles", async () => {
    await withTempUserData(async (userDataPath) => {
      const sourceRoot = path.join(userDataPath, "bounded");
      await fs.mkdir(sourceRoot, { recursive: true });
      await fs.writeFile(path.join(sourceRoot, "one.eml"), eml({
        subject: "第一份",
        body: "包含 上限 关键字。"
      }), "utf8");
      await fs.writeFile(path.join(sourceRoot, "two.eml"), eml({
        subject: "第二份",
        body: "也包含 上限 关键字。"
      }), "utf8");
      await writeJson(path.join(userDataPath, "rules", "source-search-rules.json"), {
        schemaVersion: 1,
        updatedAt: "bounded-walk-2026-06-05",
        maxFileBytes: 256 * 1024,
        maxEvidenceBytes: 16 * 1024,
        maxScanFiles: 1,
        readConcurrency: 99,
        indexConcurrency: 2,
        indexMaxTermsPerFile: 2000,
        cacheTtlMs: 60 * 1000,
        includeKnowledgeSources: false,
        useInvertedIndex: false,
        scanFallbackWhenIndexMissing: false,
        knowledgeSourceExtensions: [".eml"],
        ignoredDirectories: [],
        scanRoots: [
          {
            id: "escape",
            relativePath: "../outside",
            extensions: [".eml"],
            enabled: true
          },
          {
            id: "missing",
            relativePath: "missing",
            extensions: [".eml"],
            enabled: true
          },
          {
            id: "bounded",
            relativePath: "bounded",
            extensions: [".eml"],
            enabled: true
          }
        ],
        queryExpansions: [],
        snippetWindow: 80
      });

      const result = await searchSourceFiles({
        userDataPath,
        query: "上限",
        limit: 1
      });

      expect(result.items).toHaveLength(1);
      expect(result.explain.candidateFileCount).toBe(2);
      expect(result.explain.scannedFiles).toBe(2);
      expect(result.explain.readConcurrency).toBe(64);
      expect(result.items[0].source.relativePath).toMatch(/^bounded\/(?:one|two)\.eml$/);
    });
  });

  it("uses ripgrep no-match status as an authoritative empty native candidate set", async () => {
    await withTempUserData(async (userDataPath) => {
      const sourceRoot = path.join(userDataPath, "mail");
      await fs.mkdir(sourceRoot, { recursive: true });
      await fs.writeFile(path.join(sourceRoot, "miss.eml"), eml({
        subject: "Not scanned",
        body: "missing-token appears only in this file but rg reported no matches"
      }), "utf8");
      await writeJson(path.join(userDataPath, "rules", "source-search-rules.json"), {
        schemaVersion: 1,
        updatedAt: "rg-empty-2026-06-05",
        maxFileBytes: 256 * 1024,
        maxEvidenceBytes: 16 * 1024,
        maxScanFiles: 20,
        readConcurrency: 2,
        indexConcurrency: 2,
        indexMaxTermsPerFile: 2000,
        cacheTtlMs: 60 * 1000,
        includeKnowledgeSources: false,
        useInvertedIndex: false,
        scanFallbackWhenIndexMissing: false,
        knowledgeSourceExtensions: [".eml"],
        ignoredDirectories: [" "],
        scanRoots: [
          {
            id: "mail-root",
            relativePath: "mail",
            extensions: [".eml"],
            enabled: true
          }
        ],
        queryExpansions: [],
        snippetWindow: 80
      });
      childProcessState.rgAvailable = true;
      execFileMock.mockImplementationOnce((command, args, options, callback) => {
        const cb = typeof options === "function" ? options : callback;
        queueMicrotask(() => cb(Object.assign(new Error("no matches"), { code: 1, stdout: "" })));
      });

      const result = await searchSourceFiles({
        userDataPath,
        query: "missing-token",
        limit: 5
      });

      expect(result.items).toEqual([]);
      expect(result.explain.candidateSearch).toBe("ripgrep-fixed-strings");
      expect(result.explain.scannedFiles).toBe(0);
      expect(execFileMock).toHaveBeenCalled();
    });
  });

  it("returns MB-sized truncation notices for large evidence previews", async () => {
    await withTempUserData(async (userDataPath) => {
      const sourceRoot = path.join(userDataPath, "large-mail");
      await fs.mkdir(sourceRoot, { recursive: true });
      const file = path.join(sourceRoot, "large.eml");
      await fs.writeFile(file, eml({
        subject: "Large evidence",
        body: "x".repeat(1024 * 1024 + 64 * 1024)
      }), "utf8");
      await writeJson(path.join(userDataPath, "rules", "source-search-rules.json"), {
        schemaVersion: 1,
        updatedAt: "large-evidence-2026-06-05",
        maxFileBytes: 2 * 1024 * 1024,
        maxEvidenceBytes: 16 * 1024,
        maxScanFiles: 20,
        readConcurrency: 2,
        indexConcurrency: 2,
        indexMaxTermsPerFile: 2000,
        cacheTtlMs: 60 * 1000,
        includeKnowledgeSources: false,
        useInvertedIndex: false,
        scanFallbackWhenIndexMissing: false,
        knowledgeSourceExtensions: [".eml"],
        ignoredDirectories: [],
        scanRoots: [
          {
            id: "large-root",
            relativePath: "large-mail",
            extensions: [".eml"],
            enabled: true
          }
        ],
        queryExpansions: [],
        snippetWindow: 80
      });

      const evidence = await getSourceFileEvidence({
        userDataPath,
        evidenceId: sourceEvidenceIdForPath(userDataPath, file)
      });

      expect(evidence.sourceLocator).toMatchObject({
        truncated: true,
        previewBytes: 16 * 1024
      });
      expect(evidence.markdown).toContain("16.0 KB");
      expect(evidence.markdown).toContain("1.1 MB");
    });
  });
});
