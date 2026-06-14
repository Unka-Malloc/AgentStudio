import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { startHttpServer } from "../services/server-runtime/http-server.mjs";
import { installAuthenticatedFetch } from "./test-auth-helper.mjs";
import {
  buildMaintenancePlan,
  compareRetrievalProfiles,
  computeHealthFindings,
  summarizeMaintenanceRuns,
  validateKnowledgeQualityAssertions
} from "../platform/specialized/knowledge/storage/knowledge-core/maintenance.mjs";

const ONE_PIXEL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const rawText = await response.text();
  const payload = rawText.trim() ? JSON.parse(rawText) : {};
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${rawText}`);
  }
  return payload;
}

async function waitForJob(baseUrl, jobId) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const job = await fetchJson(`${baseUrl}/api/jobs/${encodeURIComponent(jobId)}`);
    if (job.status === "completed") {
      return job;
    }
    if (job.status === "failed") {
      throw new Error(job.error || "Job failed.");
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Job did not complete in time.");
}

function parseMarkdownJsonBlock(markdown) {
  const match = String(markdown || "").match(/```json\s*([\s\S]*?)```/);
  assert.ok(match, "Markdown output must include a JSON metadata block.");
  return JSON.parse(match[1]);
}

function hasCriticalFindings(findings) {
  return findings.some((finding) => finding.severity === "critical" || finding.severity === "error");
}

async function seedGarbageCleanupData(userDataPath) {
  const now = new Date().toISOString();
  const dbPath = path.join(userDataPath, "knowledge-core", "knowledge.sqlite");
  const db = new Database(dbPath);
  try {
    const payload = "x".repeat(2048);
    const insertSyncLog = db.prepare(`
      INSERT INTO kc_sync_log (kind, action, entity_id, item_id, batch_id, revision, server_updated_at, payload_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertReviewItem = db.prepare(`
      INSERT INTO kc_review_items (
        review_id, source, status, reason, severity, operation_id, batch_id,
        entity_id, entity_type, title, summary, current_record_json,
        incoming_record_json, evidence_refs_json, created_at, updated_at,
        resolved_at, resolution_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const transaction = db.transaction(() => {
      for (let index = 0; index < 20; index += 1) {
        insertSyncLog.run(
          "block",
          "upsert",
          `verify-gc-entity-${index}`,
          `verify-gc-item-${index}`,
          "verify-gc-batch",
          1,
          now,
          JSON.stringify({ payload, index })
        );
      }
      for (let index = 0; index < 8; index += 1) {
        insertReviewItem.run(
          `verify-gc-review-${index}`,
          "verify",
          "pending",
          "duplicate_source_document",
          "low",
          "",
          "verify-gc-batch",
          `verify-gc-entity-${index}`,
          "document",
          `Duplicate source ${index}`,
          "",
          JSON.stringify({ payload, index }),
          JSON.stringify({ payload, index }),
          "[]",
          now,
          now,
          "",
          "{}"
        );
      }
    });
    transaction();
  } finally {
    db.close();
  }
  const reportsPath = path.join(userDataPath, "knowledge-skills");
  await fs.mkdir(reportsPath, { recursive: true });
  for (let index = 0; index < 3; index += 1) {
    await fs.writeFile(
      path.join(reportsPath, `distillation-report-verify-${index}.json`),
      JSON.stringify({ index, payload: "x".repeat(512) }, null, 2)
    );
  }
}

const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-knowledge-maint-"));
const server = await startHttpServer({
  userDataPath,
  runtimeOptions: {
    profile: "minimal"
  }
});
await installAuthenticatedFetch(server);

try {
  const imageBuffer = Buffer.from(ONE_PIXEL_PNG_BASE64, "base64");
  const createdJob = await fetchJson(`${server.url}/api/jobs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      inputText: [
        "# M6/M8 Knowledge Maintenance Probe",
        "",
        "The Alpha Portal maintenance milestone requires health checks, reindex verification, Markdown metadata, and readable image assets.",
        "产品截图 alpha-maintenance.png 是 M8 图文知识库质量断言的视觉证据。",
        "The expected retrieval phrase is alpha portal maintenance."
      ].join("\n"),
      uploadedFiles: [
        {
          name: "alpha-maintenance.png",
          relativePath: "assets/alpha-maintenance.png",
          mediaType: "image/png",
          dataBase64: ONE_PIXEL_PNG_BASE64,
          byteSize: imageBuffer.length
        }
      ],
      settings: {
        knowledgeCoreEnabled: true
      }
    })
  });

  await waitForJob(server.url, createdJob.id);

  const initialMaintenance = await fetchJson(`${server.url}/api/knowledge/maintenance`);
  assert.equal(initialMaintenance.markdown.includeMachineReadableAppendix, true);
  assert.ok(initialMaintenance.retrieval.topK > 0);
  assert.equal(initialMaintenance.retrieval.recencyHalfLifeDays, 45);

  const initialHealth = await fetchJson(`${server.url}/api/knowledge/health`);
  assert.equal(initialHealth.ok, true);
  assert.ok(initialHealth.counts.documents >= 1);
  assert.ok(initialHealth.counts.blocks >= 1);
  assert.ok(initialHealth.counts.assets >= 1);
  assert.equal(initialHealth.maintenance.missingAssets, 0);

  const initialFindings = computeHealthFindings({
    health: initialHealth,
    settings: initialMaintenance
  });
  assert.equal(hasCriticalFindings(initialFindings), false);

  const baselineSearch = await fetchJson(`${server.url}/api/knowledge/search`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      query: "alpha portal maintenance",
      limit: 5
    })
  });
  assert.ok(baselineSearch.items.length > 0);

  const updatedMaintenance = await fetchJson(`${server.url}/api/knowledge/maintenance`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      retrieval: {
        topK: 9,
        bm25Weight: 0.5,
        vectorWeight: 0.35,
        imageWeight: 0.15,
        recencyWeight: 0.1,
        recencyHalfLifeDays: 21,
        parentExpansionDepth: 1
      },
      maintenance: {
        reindexBatchSize: 64,
        staleIndexHours: 12
      },
      markdown: {
        includeMachineReadableAppendix: true
      }
    })
  });
  assert.equal(updatedMaintenance.retrieval.topK, 9);
  assert.equal(updatedMaintenance.retrieval.recencyHalfLifeDays, 21);
  assert.equal(updatedMaintenance.maintenance.reindexBatchSize, 64);

  const reindex = await fetchJson(`${server.url}/api/knowledge/reindex`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      confirm: true,
      reason: "verify-knowledge-maintenance"
    })
  });
  assert.equal(reindex.status, "completed");
  assert.ok(reindex.blockEmbeddings >= 1);
  assert.ok(reindex.assetEmbeddings >= 1);

  const healthAfterReindex = await fetchJson(`${server.url}/api/knowledge/health`);
  assert.equal(healthAfterReindex.ok, true);
  assert.equal(healthAfterReindex.maintenance.missingAssets, 0);
  assert.ok(
    healthAfterReindex.counts.embeddings >=
      healthAfterReindex.counts.blocks + healthAfterReindex.counts.assets
  );

  const candidateSearch = await fetchJson(`${server.url}/api/knowledge/search`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      query: "alpha portal maintenance",
      limit: 5
    })
  });
  assert.ok(candidateSearch.items.length > 0);

  const profileComparison = compareRetrievalProfiles(
    {
      name: "baseline",
      retrieval: baselineSearch.retrievalProfile,
      results: [baselineSearch]
    },
    {
      name: "candidate",
      retrieval: candidateSearch.retrievalProfile,
      results: [candidateSearch]
    },
    {
      minOverlap: 0.2,
      maxTopScoreDrop: 2
    }
  );
  assert.equal(profileComparison.ok, true);

  const imageItem = candidateSearch.items.find((item) => item.modalities.includes("image"));
  assert.ok(imageItem, "Search results must include an image evidence item.");
  const evidence = await fetchJson(
    `${server.url}/api/knowledge/evidence/${encodeURIComponent(imageItem.evidenceId)}`
  );
  assert.equal(evidence.evidenceId, imageItem.evidenceId);
  assert.ok(evidence.payload.assets.length >= 1);
  const asset = evidence.payload.assets[0];
  assert.ok(asset.assetId);

  const rendered = await fetchJson(`${server.url}/api/knowledge/render/markdown`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      evidenceId: evidence.evidenceId,
      format: "markdown"
    })
  });
  assert.equal(rendered.contentType, "text/markdown; charset=utf-8");
  assert.match(rendered.markdown, /^---\npact_knowledge:/);
  const markdownMetadata = parseMarkdownJsonBlock(rendered.markdown);
  assert.equal(markdownMetadata.protocolVersion, "v0.0.1:knowledge:core-1");
  assert.equal(markdownMetadata.evidenceId, evidence.evidenceId);
  assert.ok(markdownMetadata.modalities.includes("image"));

  const assetResponse = await fetch(`${server.url}/api/knowledge/assets/${encodeURIComponent(asset.assetId)}`);
  assert.equal(assetResponse.ok, true);
  assert.equal(assetResponse.headers.get("content-type"), "image/png");
  const assetByteLength = (await assetResponse.arrayBuffer()).byteLength;
  assert.ok(assetByteLength > 0);

  const mirrorSync = await fetchJson(`${server.url}/api/knowledge/sync?since=0&scope=mirror`);
  assert.equal(mirrorSync.scope, "mirror");
  assert.ok(Number(mirrorSync.cursor) > 0);
  assert.equal(mirrorSync.cachePolicy.storesNormalizedDocuments, true);
  assert.ok(mirrorSync.changes.some((change) => change.kind === "document"));
  assert.ok(mirrorSync.changes.some((change) => change.kind === "block"));
  assert.ok(mirrorSync.changes.some((change) => change.kind === "asset"));

  await seedGarbageCleanupData(userDataPath);
  const garbagePreview = await fetchJson(`${server.url}/api/knowledge/maintenance/run`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      taskType: "garbage_cleanup",
      dryRun: true,
      keepSyncLogRows: 5,
      keepDuplicateReviewItems: 2,
      maxDistillationReports: 1
    })
  });
  assert.equal(garbagePreview.status, "completed");
  assert.equal(garbagePreview.output.dryRun, true);
  assert.ok(garbagePreview.output.planned.syncLogRows >= 15);
  assert.equal(garbagePreview.output.planned.duplicateReviewItems, 6);
  assert.equal(garbagePreview.output.planned.distillationReports, 2);

  const garbageBlocked = await fetch(`${server.url}/api/knowledge/maintenance/run`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      taskType: "garbage_cleanup",
      dryRun: false
    })
  });
  assert.equal(garbageBlocked.status, 400);

  const garbageApplied = await fetchJson(`${server.url}/api/knowledge/maintenance/run`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      taskType: "garbage_cleanup",
      confirm: true,
      dryRun: false,
      keepSyncLogRows: 5,
      keepDuplicateReviewItems: 2,
      maxDistillationReports: 1,
      checkpoint: true,
      vacuum: false
    })
  });
  assert.equal(garbageApplied.status, "completed");
  assert.equal(garbageApplied.output.dryRun, false);
  assert.ok(garbageApplied.output.applied.syncLogRows >= 15);
  assert.equal(garbageApplied.output.applied.duplicateReviewItems, 6);
  assert.equal(garbageApplied.output.applied.distillationReports, 2);
  assert.equal(garbageApplied.output.applied.sqliteCheckpoint.ok, true);
  const garbageDb = new Database(path.join(userDataPath, "knowledge-core", "knowledge.sqlite"));
  try {
    const remainingDuplicateReviews = garbageDb.prepare(`
      SELECT COUNT(*) AS count
      FROM kc_review_items
      WHERE reason = 'duplicate_source_document'
        AND source = 'verify'
    `).get();
    assert.equal(Number(remainingDuplicateReviews.count || 0), 2);
  } finally {
    garbageDb.close();
  }

  const assetReadability = {
    [asset.assetId]: {
      assetId: asset.assetId,
      readable: true,
      byteLength: assetByteLength
    }
  };
  const quality = validateKnowledgeQualityAssertions(
    [
      {
        id: "search-maintenance-query",
        query: "alpha portal maintenance",
        minItems: 1,
        requiredTerms: ["Alpha Portal", "maintenance"],
        requiredModalities: ["text"]
      },
      {
        id: "image-evidence",
        actual: evidence,
        minAssets: 1,
        requiredModalities: ["image"],
        requiredAssetIds: [asset.assetId],
        requireReadableAssets: true
      },
      {
        id: "markdown-machine-readable",
        target: "markdown",
        requireMarkdownMetadata: true,
        requiredMetadataKeys: ["protocolVersion", "evidenceId", "modalities"],
        expected: {
          metadata: {
            protocolVersion: "v0.0.1:knowledge:core-1",
            evidenceId: evidence.evidenceId
          },
          assetRefs: [`/api/knowledge/assets/${encodeURIComponent(asset.assetId)}`]
        }
      }
    ],
    {
      searchResults: {
        "alpha portal maintenance": candidateSearch
      },
      evidence,
      rendered,
      assetReadability
    }
  );
  assert.equal(quality.ok, true, JSON.stringify(quality.results, null, 2));

  const runSummary = summarizeMaintenanceRuns([
    {
      runId: reindex.runId,
      taskType: "reindex",
      status: reindex.status,
      startedAt: "2026-04-28T00:00:00.000Z",
      finishedAt: "2026-04-28T00:00:01.000Z",
      output: reindex
    }
  ]);
  assert.equal(runSummary.total, 1);
  assert.equal(runSummary.completedRuns, 1);
  assert.equal(runSummary.failedRuns, 0);

  const plan = buildMaintenancePlan({
    health: healthAfterReindex,
    settings: updatedMaintenance,
    quality,
    retrievalComparison: profileComparison
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.status, "healthy");

  const deleted = await fetchJson(`${server.url}/api/jobs/${encodeURIComponent(createdJob.id)}`, {
    method: "DELETE"
  });
  assert.equal(deleted.ok, true);
  const deleteMirrorSync = await fetchJson(
    `${server.url}/api/knowledge/sync?since=${encodeURIComponent(mirrorSync.cursor)}&scope=mirror`
  );
  assert.ok(deleteMirrorSync.changes.some((change) => change.kind === "tombstone"));
} finally {
  await server.close();
  await fs.rm(userDataPath, {
    recursive: true,
    force: true
  });
}

console.log("Knowledge maintenance verification passed.");
