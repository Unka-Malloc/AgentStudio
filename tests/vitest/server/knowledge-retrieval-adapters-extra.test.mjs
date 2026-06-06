import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  LANCEDB_PROVIDER_ID,
  VECTOR_PROTOCOL_VERSION,
  createLanceDbVectorStore,
  createMount as createLanceMount
} from "../../../server/platform/specialized/knowledge/retrieval/vector-store/LanceDB/index.mjs";
import {
  LEARNING_PROTOCOL_VERSION,
  createLearningRuntime
} from "../../../server/platform/specialized/knowledge/retrieval/learning-runtime/index.mjs";

const tempRoots = [];

afterEach(async () => {
  vi.restoreAllMocks();
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    await fsp.rm(root, { recursive: true, force: true });
  }
});

async function withTempRoot() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "pact-knowledge-retrieval-adapters-"));
  tempRoots.push(root);
  return root;
}

async function readJson(filePath) {
  return JSON.parse(await fsp.readFile(filePath, "utf8"));
}

describe("LanceDB vector-store adapter", () => {
  it("exposes capabilities and degraded health without a uri, then switches when configured", async () => {
    const userDataPath = await withTempRoot();

    const localStore = createLanceDbVectorStore({ userDataPath });
    expect(localStore.id).toBe("builtin/lancedb-vector-store");
    expect(localStore.kind).toBe("vectorStore");
    expect(localStore.enabled).toBe(true);
    expect(localStore.protocolVersion).toBe(VECTOR_PROTOCOL_VERSION);
    expect(localStore.providerId).toBe(LANCEDB_PROVIDER_ID);

    const capabilities = localStore.capabilities();
    expect(capabilities).toMatchObject({
      protocolVersion: VECTOR_PROTOCOL_VERSION,
      providerId: LANCEDB_PROVIDER_ID,
      providerType: "lancedb",
      backend: "lancedb-adapter",
      externalUriConfigured: false,
      noImplicitDownloads: true,
      explicitModelRequired: true,
      embeddingModel: "",
      operations: {
        ensureSchema: true,
        upsert: true,
        search: true,
        deleteByTargetIds: true,
        onBatchCompleted: true
      },
      framework: {
        lancedb: "external-component-via-js-adapter-or-service",
        hybridSearch: true,
        reranking: "explicitly-configured"
      }
    });

    const degradedHealth = localStore.health();
    expect(degradedHealth).toMatchObject({
      protocolVersion: VECTOR_PROTOCOL_VERSION,
      ok: true,
      degraded: true,
      providerId: LANCEDB_PROVIDER_ID,
      providerType: "lancedb",
      backend: "lancedb-adapter-spool",
      externalUriConfigured: false,
      explicitModelConfigured: false,
      noImplicitDownloads: true
    });
    expect(degradedHealth.recordCount).toBe(0);

    const configuredStore = createLanceMount({
      userDataPath,
      runtimeOptions: {
        vectorStore: {
          lancedb: {
            uri: "lancedb://example.test/vector",
            embeddingModel: "mock-embed-model"
          }
        }
      }
    });

    expect(configuredStore.capabilities()).toMatchObject({
      externalUriConfigured: true,
      embeddingModel: "mock-embed-model"
    });
    expect(configuredStore.health()).toMatchObject({
      degraded: false,
      backend: "lancedb-external",
      externalUriConfigured: true,
      explicitModelConfigured: true
    });
  });

  it("stores batch records, writes manifests, searches with normalized inputs, and deletes by targetId", async () => {
    const userDataPath = await withTempRoot();
    const store = createLanceDbVectorStore({
      userDataPath,
      settings: {
        uri: "lancedb://example.test/vector",
        embeddingModel: "mock-embed-model"
      }
    });

    const completed = await store.onBatchCompleted({
      batchId: "batch-42",
      jobId: "job-42",
      result: {
        generatedAt: "2026-06-05T00:00:00.000Z",
        sourceFiles: [
          {
            id: "source-1",
            name: "renewal.md",
            path: "docs/renewal.md",
            mediaType: "text/markdown"
          }
        ],
        chunks: [
          {
            chunkId: "chunk-1",
            title: "Renewal launch",
            text: "Renewal budget approval is required before launch.",
            snippet: "Renewal budget approval is required.",
            sourceId: "source-1",
            metadata: {
              transactionIds: ["tx-1"],
              personIds: ["person-1"],
              threadIds: ["thread-1"],
              timeWeight: 0.75,
              formalUseAllowed: true
            }
          },
          {
            chunkId: "chunk-2",
            text: "A separate chunk without matching query terms.",
            sourceId: "source-1"
          }
        ]
      }
    });

    expect(completed).toMatchObject({
      protocolVersion: VECTOR_PROTOCOL_VERSION,
      providerId: LANCEDB_PROVIDER_ID,
      batchId: "batch-42",
      jobId: "job-42",
      recordCount: 2,
      upserted: 2,
      backend: "lancedb-adapter-spool"
    });
    expect(await fsp.readFile(completed.manifestPath, "utf8")).toContain("\"batchId\": \"batch-42\"");

    const spoolPath = path.join(userDataPath, "lancedb-vector-store", "upserts.json");
    const storedRecords = await readJson(spoolPath);
    expect(storedRecords).toHaveLength(2);
    expect(storedRecords.find((record) => record.entityId === "chunk-1")).toMatchObject({
      providerId: LANCEDB_PROVIDER_ID,
      batchId: "batch-42",
      jobId: "job-42",
      entityId: "chunk-1",
      sourceFileId: "source-1",
      sourceName: "renewal.md",
      sourcePath: "docs/renewal.md",
      metadata: expect.objectContaining({
        provider: LANCEDB_PROVIDER_ID,
        source: expect.objectContaining({
          sourceFileId: "source-1"
        })
      })
    });

    const searchResult = store.search({
      query: "  renewal   budget   approval  ",
      limit: "1"
    });
    expect(searchResult).toMatchObject({
      protocolVersion: VECTOR_PROTOCOL_VERSION,
      providerId: LANCEDB_PROVIDER_ID,
      backend: "lancedb-adapter-spool",
      query: "renewal budget approval"
    });
    expect(searchResult.results).toHaveLength(1);
    expect(searchResult.results[0]).toMatchObject({
      targetType: "block",
      targetId: "chunk-1",
      metadata: expect.objectContaining({
        provider: LANCEDB_PROVIDER_ID
      })
    });

    const deleted = store.deleteByTargetIds({ targetId: "chunk-1" });
    expect(deleted.deleted).toBe(1);
    expect(await readJson(spoolPath)).toHaveLength(1);
  });

  it("returns an error health payload when schema preparation fails", () => {
    const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "pact-knowledge-retrieval-health-"));
    tempRoots.push(userDataPath);
    const store = createLanceDbVectorStore({ userDataPath });

    vi.spyOn(fs, "mkdirSync").mockImplementation(() => {
      throw new Error("boom");
    });

    expect(store.health()).toMatchObject({
      protocolVersion: VECTOR_PROTOCOL_VERSION,
      ok: false,
      providerId: LANCEDB_PROVIDER_ID,
      error: "boom"
    });
  });
});

describe("learning runtime adapter", () => {
  it("exposes capabilities and health for the builtin fallback runtime", async () => {
    const runtime = createLearningRuntime();

    expect(runtime.protocolVersion).toBe(LEARNING_PROTOCOL_VERSION);
    expect(runtime.defaultProfile).toMatchObject({
      profileId: "balanced",
      active: true,
      topK: 20
    });
    expect(runtime.safeAutoApplySuggestionTypes instanceof Set).toBe(true);

    expect(runtime.capabilities()).toMatchObject({
      protocolVersion: LEARNING_PROTOCOL_VERSION,
      frameworkPreference: ["javascript-adapter", "external-service"],
      defaultRuntime: "builtin-deterministic-fallback",
      optionalRuntime: "external-js-adapter",
      noImplicitDownloads: true,
      autoApplyBoundaries: {
        retrievalProfiles: true,
        rankingRules: true,
        canonicalFacts: false,
        entityMerges: false,
        relations: false,
        taxonomy: false
      },
      safeAutoApplySuggestionTypes: ["retrievalProfile", "rankingRule", "decay"]
    });

    await expect(runtime.health()).resolves.toMatchObject({
      protocolVersion: LEARNING_PROTOCOL_VERSION,
      ok: true,
      degraded: false,
      runtime: "builtin-deterministic-fallback",
      noImplicitDownloads: true,
      frameworks: {
        llamaIndex: {
          providerId: "llamaindex",
          status: "external-component-via-js-adapter",
          requiredForDefaultRuntime: false
        },
        lanceDb: {
          providerId: "lancedb",
          status: "external-component-via-js-adapter-or-service",
          requiredForDefaultRuntime: false
        }
      }
    });
  });

  it("fuses candidates with normalized profile input and supports both async and sync entry points", async () => {
    const runtime = createLearningRuntime();
    const candidates = [
      {
        targetType: "block",
        targetId: "candidate-a",
        score: 0.4,
        reasons: [
          { kind: "vector-match", score: 0.9 },
          { kind: "bm25", score: 0.1 }
        ]
      },
      {
        targetType: "block",
        targetId: "candidate-b",
        score: 0.4,
        reasons: [
          { kind: "bm25", score: 1.0 }
        ]
      }
    ];

    const input = {
      profile: {
        profileId: "custom-profile",
        topK: "250",
        retrieval: {
          bm25Weight: 0.2,
          vectorWeight: 0.6,
          imageWeight: 0.2
        }
      },
      candidates
    };

    const syncResult = runtime.fuseCandidatesSync(input);
    expect(syncResult.runtime).toBe("builtin-deterministic-fallback");
    expect(syncResult.degraded).toBe(true);
    expect(syncResult.candidates.map((candidate) => candidate.targetId)).toEqual(["candidate-a", "candidate-b"]);
    expect(syncResult.explanations).toHaveLength(2);
    expect(syncResult.explanations[0]).toMatchObject({
      key: "block::candidate-a",
      baseScore: 0.4
    });
    expect(syncResult.explanations[0].fusedScore).toBeGreaterThan(syncResult.explanations[1].fusedScore);

    const asyncResult = await runtime.fuseCandidates({
      profile: {
        weights: {
          bm25: 0.5,
          vector: 0.25,
          image: 0.25
        }
      },
      candidates
    });
    expect(asyncResult.runtime).toBe("builtin-deterministic-fallback");
    expect(asyncResult.degraded).toBe(false);
    expect(asyncResult.explanations).toHaveLength(2);
    expect(asyncResult.candidates).toHaveLength(2);
  });

  it("proposes profiles and suggestions from feedback, and tolerates sparse evaluation inputs", () => {
    const runtime = createLearningRuntime();

    const proposal = runtime.proposeProfile({
      activeProfile: {
        profileId: "balanced",
        version: 2,
        topK: 6,
        retrieval: { bm25Weight: 0.45, vectorWeight: 0.35, imageWeight: 0.2 },
        metrics: { mrrAtK: 0.1, ndcgAtK: 0.2, recallAtK: 0.3, latencyP95Ms: 900 }
      },
      feedback: [
        {
          action: "thumb_up",
          query: "renewal budget",
          context: { reasons: [{ kind: "vector-match", score: 1 }] }
        },
        {
          action: "searchMiss",
          query: "renewal budget approval",
          context: {
            reasons: [{ kind: "bm25-like", score: 1 }],
            evidenceRefs: ["ref-1"]
          }
        },
        {
          action: "human_expert_correction",
          query: "renewal approval",
          context: {
            humanExpert: true,
            selectedOption: { label: "confirmed direction", followUpQuestion: "which evidence?" },
            anchor: "source-1"
          }
        },
        {
          action: "ignored",
          context: { reasons: [{ kind: "image-match", score: 1 }] }
        }
      ]
    });

    expect(proposal.counts).toMatchObject({
      positive: 2,
      negative: 1,
      searchMiss: 1,
      vector: 1,
      lexical: 1
    });
    expect(proposal.candidate).toMatchObject({
      profileId: "balanced",
      active: false,
      topK: 7
    });
    expect(proposal.autoApplicable).toBe(true);
    expect(proposal.metricsAfter.mrrAtK).toBeGreaterThan(proposal.metricsBefore.mrrAtK);

    const suggestions = runtime.generateSuggestions({
      activeProfile: proposal.candidate,
      feedback: [
        {
          action: "search_miss",
          query: "renewal budget approval",
          context: { evidenceRefs: ["ref-1"] }
        },
        {
          action: "expert_choice",
          query: "renewal approval",
          context: {
            selectedOption: { label: "confirmed direction", followUpQuestion: "which evidence?" },
            anchor: "source-1"
          }
        },
        {
          action: "thumb_up",
          query: ""
        }
      ]
    });

    expect(suggestions).toHaveLength(2);
    expect(suggestions[0]).toMatchObject({
      type: "rankingRule",
      proposedPatch: {
        query: "renewal budget approval",
        retrievalProfileId: "balanced",
        reason: "search_miss",
        rule: "expand_candidates_before_rerank"
      },
      evidenceRefs: ["ref-1"],
      status: "pending"
    });
    expect(suggestions[1]).toMatchObject({
      type: "retrievalRule",
      proposedPatch: {
        query: "renewal approval",
        retrievalProfileId: "balanced",
        reason: "human_expert_guidance",
        rule: "prefer_human_confirmed_direction",
        guidance: {
          label: "confirmed direction",
          followUpQuestion: "which evidence?",
          anchor: "source-1"
        }
      }
    });

    expect(runtime.evaluateCandidateProfile({
      baseline: proposal.candidate,
      candidate: {
        metrics: {
          mrrAtK: proposal.candidate.metrics.mrrAtK + 0.01,
          ndcgAtK: proposal.candidate.metrics.ndcgAtK + 0.01,
          recallAtK: proposal.candidate.metrics.recallAtK + 0.01
        }
      }
    })).toMatchObject({
      ok: true
    });

    expect(runtime.evaluateCandidateProfile({
      baseline: proposal.candidate,
      candidate: {}
    })).toMatchObject({
      ok: false
    });
  });
});
