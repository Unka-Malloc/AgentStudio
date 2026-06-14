import { performance } from "node:perf_hooks";
import {
  createDataConnectorGovernance
} from "../../connectors/data-connector-governance/index.mjs";
import { createKnowledgeCoreMount } from "../../storage/knowledge-core/index.mjs";

export const PERFORMANCE_CAPACITY_PROTOCOL_VERSION = "v0.0.1:platform:performance-capacity-1";

export const CAPACITY_TARGET_PROFILES = Object.freeze({
  smoke: {
    profileId: "smoke",
    documentCount: 8,
    pagesPerDocument: 2,
    imageAssetCount: 2,
    concurrentUploads: 2,
    queryCount: 5,
    externalSyncItemCount: 2,
    maxIngestMs: 3000,
    maxSearchP95Ms: 300,
    minSearchQps: 10,
    minDistillationDocsPerSec: 50,
    maxExternalSyncMs: 1000,
    maxEstimatedCostUsd: 0.01
  },
  pilot: {
    profileId: "pilot",
    documentCount: 500,
    pagesPerDocument: 8,
    imageAssetCount: 120,
    concurrentUploads: 8,
    queryCount: 80,
    externalSyncItemCount: 500,
    maxIngestMs: 120000,
    maxSearchP95Ms: 1200,
    minSearchQps: 25,
    minDistillationDocsPerSec: 15,
    maxExternalSyncMs: 60000,
    maxEstimatedCostUsd: 2
  },
  production: {
    profileId: "production",
    documentCount: 50000,
    pagesPerDocument: 12,
    imageAssetCount: 10000,
    concurrentUploads: 32,
    queryCount: 1000,
    externalSyncItemCount: 50000,
    maxIngestMs: 3600000,
    maxSearchP95Ms: 1500,
    minSearchQps: 50,
    minDistillationDocsPerSec: 10,
    maxExternalSyncMs: 1800000,
    maxEstimatedCostUsd: 250
  }
});

function nowIso() {
  return new Date().toISOString();
}

function clampInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function percentile(values = [], p = 95) {
  const sorted = values.map((value) => Number(value || 0)).filter(Number.isFinite).sort((left, right) => left - right);
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Number(sorted[index].toFixed(3));
}

function sum(values = []) {
  return values.reduce((total, value) => total + Number(value || 0), 0);
}

function elapsedMs(startedAt) {
  return Number((performance.now() - startedAt).toFixed(3));
}

function normalizeCapacityBenchmarkPlan(input = {}) {
  const target = CAPACITY_TARGET_PROFILES[input.profileId] || CAPACITY_TARGET_PROFILES[input.profile] || CAPACITY_TARGET_PROFILES.smoke;
  const overrides = input.targets && typeof input.targets === "object" && !Array.isArray(input.targets)
    ? input.targets
    : {};
  const plan = {
    ...target,
    ...overrides
  };
  return {
    protocolVersion: PERFORMANCE_CAPACITY_PROTOCOL_VERSION,
    profileId: String(plan.profileId || target.profileId || "smoke"),
    documentCount: clampInteger(plan.documentCount, target.documentCount, 1, 100000),
    pagesPerDocument: clampInteger(plan.pagesPerDocument, target.pagesPerDocument, 1, 200),
    imageAssetCount: clampInteger(plan.imageAssetCount, target.imageAssetCount, 0, 100000),
    concurrentUploads: clampInteger(plan.concurrentUploads, target.concurrentUploads, 1, 256),
    queryCount: clampInteger(plan.queryCount, target.queryCount, 1, 5000),
    externalSyncItemCount: clampInteger(plan.externalSyncItemCount, target.externalSyncItemCount, 1, 100000),
    maxIngestMs: Math.max(1, Number(plan.maxIngestMs || target.maxIngestMs)),
    maxSearchP95Ms: Math.max(1, Number(plan.maxSearchP95Ms || target.maxSearchP95Ms)),
    minSearchQps: Math.max(0.001, Number(plan.minSearchQps || target.minSearchQps)),
    minDistillationDocsPerSec: Math.max(0.001, Number(plan.minDistillationDocsPerSec || target.minDistillationDocsPerSec)),
    maxExternalSyncMs: Math.max(1, Number(plan.maxExternalSyncMs || target.maxExternalSyncMs)),
    maxEstimatedCostUsd: Math.max(0, Number(plan.maxEstimatedCostUsd ?? target.maxEstimatedCostUsd)),
    failureInjection: {
      rateLimit: input.failureInjection?.rateLimit !== false,
      missingQuery: input.failureInjection?.missingQuery !== false
    }
  };
}

function buildSyntheticSources(plan) {
  return Array.from({ length: plan.documentCount }, (_, index) => {
    const topic = index % 2 === 0 ? "budget" : "security";
    const imageHint = index < plan.imageAssetCount ? ` image-asset-${index}` : "";
    const pages = Array.from({ length: plan.pagesPerDocument }, (__, pageIndex) =>
      `Page ${pageIndex + 1}: ${topic} capacity fixture ${index}. benchmark query token bench-${index % plan.queryCount}.${imageHint}`
    );
    return {
      id: `capacity-doc-${index}`,
      name: `Capacity Document ${index}`,
      path: `capacity://doc/${index}`,
      kind: "document",
      text: pages.join("\n"),
      sourceType: "benchmark",
      providerId: "capacity-benchmark",
      externalId: `capacity-doc-${index}`,
      syncBatchId: "capacity-benchmark",
      capturedAt: "2026-05-21T00:00:00.000Z",
      sourceMetadata: {
        pageCount: plan.pagesPerDocument,
        synthetic: true
      }
    };
  });
}

function buildQueries(plan) {
  return Array.from({ length: plan.queryCount }, (_, index) =>
    index % 2 === 0 ? `budget bench-${index}` : `security bench-${index}`
  );
}

function evaluateThresholds(metrics, plan) {
  const checks = [
    {
      id: "ingest-latency",
      status: metrics.ingest.latencyMs <= plan.maxIngestMs ? "pass" : "fail",
      actual: metrics.ingest.latencyMs,
      target: plan.maxIngestMs
    },
    {
      id: "search-p95",
      status: metrics.search.p95Ms <= plan.maxSearchP95Ms ? "pass" : "fail",
      actual: metrics.search.p95Ms,
      target: plan.maxSearchP95Ms
    },
    {
      id: "search-qps",
      status: metrics.search.qps >= plan.minSearchQps ? "pass" : "fail",
      actual: metrics.search.qps,
      target: plan.minSearchQps
    },
    {
      id: "distillation-throughput",
      status: metrics.distillation.throughputDocsPerSec >= plan.minDistillationDocsPerSec ? "pass" : "fail",
      actual: metrics.distillation.throughputDocsPerSec,
      target: plan.minDistillationDocsPerSec
    },
    {
      id: "external-sync-latency",
      status: metrics.externalSync.latencyMs <= plan.maxExternalSyncMs ? "pass" : "fail",
      actual: metrics.externalSync.latencyMs,
      target: plan.maxExternalSyncMs
    },
    {
      id: "estimated-cost",
      status: metrics.cost.estimatedUsd <= plan.maxEstimatedCostUsd ? "pass" : "fail",
      actual: metrics.cost.estimatedUsd,
      target: plan.maxEstimatedCostUsd
    }
  ];
  return {
    status: checks.every((check) => check.status === "pass") ? "pass" : "failed",
    checks
  };
}

async function runExternalSyncSimulation({ userDataPath, plan }) {
  const governance = createDataConnectorGovernance({ userDataPath });
  await governance.register({
    providerId: "capacity-sync",
    sourceType: "file",
    version: "1.0.0",
    capabilities: ["sync", "localQuery"],
    auth: { type: "oauth2", refreshRequired: true, scopes: ["files.read"] },
    sync: {
      mode: "incrementalCursor",
      conflictPolicy: "newerCapturedAtWins",
      hashCollisionPolicy: "quarantine",
      rateLimit: {
        maxItemsPerSync: plan.externalSyncItemCount
      }
    },
    localQuery: { remoteCallsAllowed: false },
    mirror: {
      dedupeKeys: ["providerId", "sourceType", "externalId", "contentHash"]
    }
  }, { actor: "capacity-benchmark" });
  const items = Array.from({ length: plan.externalSyncItemCount }, (_, index) => ({
    externalId: `sync-${index}`,
    title: `Sync item ${index}`,
    text: `External sync benchmark item ${index}`,
    contentHash: `sync-hash-${index}`
  }));
  const startedAt = performance.now();
  const applied = await governance.applySyncBatch({
    providerId: "capacity-sync",
    syncBatchId: "capacity-sync",
    nextCursor: "capacity-cursor-1",
    items
  });
  let rateLimitInjected = false;
  if (plan.failureInjection.rateLimit) {
    const limited = await governance.applySyncBatch({
      providerId: "capacity-sync",
      syncBatchId: "capacity-rate-limit",
      items: [...items, { externalId: "overflow", text: "overflow" }]
    });
    rateLimitInjected = limited.ok === false && limited.run.status === "rate_limited";
  }
  return {
    latencyMs: elapsedMs(startedAt),
    itemCount: applied.run.itemCount,
    insertedCount: applied.run.insertedCount,
    rateLimitInjected,
    cursor: applied.run.nextCursor
  };
}

function runDistillationSimulation(sources = []) {
  const startedAt = performance.now();
  const summaries = sources.map((source) => ({
    sourceId: source.id,
    summary: String(source.text || "").split(/\s+/).slice(0, 18).join(" ")
  }));
  const latencyMs = elapsedMs(startedAt);
  return {
    latencyMs,
    documentCount: summaries.length,
    throughputDocsPerSec: Number((summaries.length / Math.max(0.001, latencyMs / 1000)).toFixed(3))
  };
}

export function listCapacityBenchmarkTargets() {
  return {
    ok: true,
    protocolVersion: PERFORMANCE_CAPACITY_PROTOCOL_VERSION,
    profiles: Object.values(CAPACITY_TARGET_PROFILES)
  };
}

export async function runPerformanceCapacityBenchmark({ userDataPath, profileId = "smoke", targets = {}, failureInjection = {} } = {}) {
  if (!userDataPath) {
    throw new Error("userDataPath is required.");
  }
  const plan = normalizeCapacityBenchmarkPlan({ profileId, targets, failureInjection });
  const sources = buildSyntheticSources(plan);
  const queries = buildQueries(plan);
  const knowledgeCore = await createKnowledgeCoreMount({ userDataPath });
  try {
    const ingestStartedAt = performance.now();
    const ingest = await knowledgeCore.ingestSources({
      batchId: `capacity-${plan.profileId}-${Date.now()}`,
      generatedAt: nowIso(),
      sources
    });
    const ingestLatencyMs = elapsedMs(ingestStartedAt);

    const searchLatencies = [];
    let totalHits = 0;
    const searchStartedAt = performance.now();
    for (const query of queries) {
      const startedAt = performance.now();
      const result = knowledgeCore.search({
        query,
        limit: 10,
        keywordOnly: true
      });
      searchLatencies.push(elapsedMs(startedAt));
      totalHits += Array.isArray(result.items) ? result.items.length : 0;
    }
    let missingQueryRecovered = true;
    if (plan.failureInjection.missingQuery) {
      const missing = knowledgeCore.search({
        query: "no-match-capacity-benchmark-token",
        limit: 5,
        keywordOnly: true
      });
      missingQueryRecovered = Array.isArray(missing.items);
    }
    const searchTotalMs = elapsedMs(searchStartedAt);
    const externalSync = await runExternalSyncSimulation({ userDataPath, plan });
    const distillation = runDistillationSimulation(sources);
    const estimatedTokenCount = sources.reduce((total, source) => total + String(source.text || "").split(/\s+/).length, 0);
    const metrics = {
      ingest: {
        latencyMs: ingestLatencyMs,
        documentCount: Number(ingest.documentCount || sources.length),
        pagesPerDocument: plan.pagesPerDocument,
        concurrentUploadTarget: plan.concurrentUploads
      },
      search: {
        queryCount: queries.length,
        totalHits,
        totalMs: searchTotalMs,
        p50Ms: percentile(searchLatencies, 50),
        p95Ms: percentile(searchLatencies, 95),
        qps: Number((queries.length / Math.max(0.001, searchTotalMs / 1000)).toFixed(3)),
        missingQueryRecovered
      },
      distillation,
      externalSync,
      cost: {
        estimatedTokenCount,
        estimatedUsd: Number(((estimatedTokenCount / 1000) * 0.0002).toFixed(6))
      }
    };
    const thresholds = evaluateThresholds(metrics, plan);
    return {
      ok: thresholds.status === "pass",
      status: thresholds.status,
      protocolVersion: PERFORMANCE_CAPACITY_PROTOCOL_VERSION,
      generatedAt: nowIso(),
      plan,
      metrics,
      thresholds
    };
  } finally {
    await knowledgeCore.close();
  }
}
