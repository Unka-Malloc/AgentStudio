#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getSourceFileIndexRun, indexKnowledgeSourceFiles } from "../../server/platform/specialized/knowledge/storage/source-file-index-service.mjs";
import { getSourceFileEvidence, searchSourceFiles } from "../../server/platform/specialized/knowledge/retrieval/source-file-search-service.mjs";
import { getSourceSearchRulesPath } from "../../server/platform/specialized/knowledge/preprocessing/domain/rules/source-search-rules.mjs";
import {
  analyzeMemorySamples,
  captureMemorySample,
  forceGc,
  formatBytes,
  requireExposedGc,
  writeHeapSnapshotOnFailure,
  writeMemoryReport
} from "./lib/memory-profiler.mjs";

const repoRoot = path.resolve(new URL("../..", import.meta.url).pathname);
const reportDir = path.join(repoRoot, "build", "test-reports", "smoke");
const reportPath = path.join(reportDir, "source-evidence-memory-smoke.json");
const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-memory-smoke-"));
const sourceRoot = path.join(userDataPath, "mail-source");
const ignoredRoot = path.join(sourceRoot, "node_modules");
const samples = [];

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function eml({ subject, body }) {
  return [
    "From: smoke@example.test",
    "To: owner@example.test",
    `Subject: ${subject}`,
    "Date: Fri, 01 May 2026 10:00:00 +0000",
    "Content-Type: text/plain; charset=utf-8",
    "",
    body
  ].join("\n");
}

async function prepareFixture() {
  await fs.mkdir(sourceRoot, { recursive: true });
  await fs.mkdir(ignoredRoot, { recursive: true });
  for (let index = 0; index < 90; index += 1) {
    await fs.writeFile(
      path.join(sourceRoot, `google-billing-${index}.eml`),
      eml({
        subject: `Google 账单 smoke ${index}`,
        body: [
          `Google billing invoice smoke-token-${index}`,
          "invoice payment confirmation ".repeat(900),
          "账单 发票 收据 ".repeat(300)
        ].join("\n")
      }),
      "utf8"
    );
  }
  await fs.writeFile(
    path.join(sourceRoot, "large-google-billing.eml"),
    eml({
      subject: "Google 账单 large evidence",
      body: `Google billing invoice\n${"large-evidence-body ".repeat(70000)}\nTAIL-MUST-NOT-APPEAR`
    }),
    "utf8"
  );
  await fs.writeFile(
    path.join(ignoredRoot, "ignored.eml"),
    eml({
      subject: "Ignored memory smoke",
      body: "ignored-memory-smoke-token"
    }),
    "utf8"
  );
  await writeJson(getSourceSearchRulesPath(userDataPath), {
    schemaVersion: "v0.0.1:schema:definition-1",
    updatedAt: new Date().toISOString(),
    maxFileBytes: 2 * 1024 * 1024,
    maxEvidenceBytes: 48 * 1024,
    maxScanFiles: 500,
    readConcurrency: 4,
    indexConcurrency: 4,
    indexMaxTermsPerFile: 1500,
    cacheTtlMs: 1000,
    includeKnowledgeSources: false,
    useInvertedIndex: false,
    scanFallbackWhenIndexMissing: false,
    knowledgeSourceExtensions: [".eml"],
    ignoredDirectories: ["node_modules"],
    scanRoots: [
      {
        id: "memory-smoke-mail",
        label: "Memory smoke mail",
        relativePath: "mail-source",
        extensions: [".eml"],
        enabled: true
      }
    ],
    queryExpansions: [],
    snippetWindow: 180
  });
}

try {
  requireExposedGc();
  await prepareFixture();
  await forceGc();
  samples.push(captureMemorySample("baseline"));

  const indexRun = await indexKnowledgeSourceFiles({
    userDataPath,
    source: {
      sourceId: "memory-smoke-mail",
      directoryPath: sourceRoot,
      enabled: true,
      recursive: true
    },
    reason: "memory-smoke",
    force: true
  });
  assert.equal(indexRun.skipped, false);
  assert.equal(indexRun.failedCount, 0);
  assert.ok(indexRun.indexedCount >= 91);
  const persistedIndexRun = await getSourceFileIndexRun({ userDataPath, sourceId: "memory-smoke-mail" });
  assert.equal(persistedIndexRun.status, "indexed");
  await forceGc();
  samples.push(captureMemorySample("after-index"));

  const ignored = await searchSourceFiles({ userDataPath, query: "ignored-memory-smoke-token", limit: 5 });
  assert.equal(ignored.items.length, 0);

  for (let index = 0; index < 30; index += 1) {
    const query = index % 2 === 0 ? "Google billing invoice" : "账单 发票";
    const result = await searchSourceFiles({ userDataPath, query, limit: 12 });
    assert.ok(result.items.length > 0);
    const large = result.items.find((item) => String(item.title || "").includes("large evidence")) || result.items[0];
    const evidence = await getSourceFileEvidence({ userDataPath, evidenceId: large.evidenceId });
    assert.ok(evidence?.payload?.blocks?.[0]?.text);
    assert.ok(evidence.payload.blocks[0].text.length < 80 * 1024);
    assert.equal(evidence.payload.blocks[0].text.includes("TAIL-MUST-NOT-APPEAR"), false);
    if ((index + 1) % 5 === 0) {
      await forceGc();
      samples.push(captureMemorySample(`iteration-${index + 1}`, { query }));
    }
  }

  const analysis = analyzeMemorySamples(samples.slice(1), {
    maxRssDeltaBytes: 128 * 1024 * 1024,
    maxHeapUsedDeltaBytes: 32 * 1024 * 1024,
    maxExternalDeltaBytes: 32 * 1024 * 1024,
    maxArrayBuffersDeltaBytes: 32 * 1024 * 1024,
    maxHeapUsedSlopeBytes: 8 * 1024 * 1024,
    maxRssSlopeBytes: 32 * 1024 * 1024
  });
  const report = {
    schemaVersion: "v0.0.1:schema:definition-1",
    name: "source-evidence-memory-smoke",
    userDataPath,
    samples,
    analysis,
    createdAt: new Date().toISOString()
  };
  await writeMemoryReport(reportPath, report);
  if (!analysis.ok) {
    const heapSnapshotPath = await writeHeapSnapshotOnFailure(reportPath);
    throw new Error(`Memory smoke failed: ${analysis.failures.join("; ")}. Heap snapshot: ${heapSnapshotPath}`);
  }
  console.log(
    `source evidence memory smoke passed; heap delta ${formatBytes(analysis.deltas.heapUsed)}, rss delta ${formatBytes(analysis.deltas.rss)}`
  );
} finally {
  await fs.rm(userDataPath, { recursive: true, force: true });
}
