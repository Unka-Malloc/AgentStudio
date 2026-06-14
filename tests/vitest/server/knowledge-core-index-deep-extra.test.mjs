import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { createKnowledgeCoreMount } from "../../../server/platform/specialized/knowledge/storage/knowledge-core/index.mjs";
import {
  asArray,
  clampNumber,
  compactObject,
  hashText,
  normalizeText,
  parseJson,
  stringifyJson,
  truncateText,
  uniqueStrings,
} from "../../../server/platform/specialized/knowledge/storage/knowledge-core/core-utils.mjs";
import {
  candidateTemporalSource,
  exponentialRecencyScore,
  firstTimestamp,
  parseTimestampMs,
  queryMatchQualityScore,
  queryTerms,
  tokenize,
} from "../../../server/platform/specialized/knowledge/storage/knowledge-core/retrieval-scoring.mjs";
import {
  hydrateAsset,
  hydrateBlock,
  hydrateDocument,
  hydrateFeedback,
  hydrateLearningRun,
  hydrateProfileDeployment,
  hydrateRetrievalProfile,
  hydrateReviewItem,
  hydrateSection,
  hydrateSuggestion,
} from "../../../server/platform/specialized/knowledge/storage/knowledge-core/row-hydrators.mjs";
import {
  createNoopDocumentOutlineRuntime,
  resolveDocumentOutlineRuntime,
} from "../../../server/platform/specialized/knowledge/storage/knowledge-core/outline-runtime-loader.mjs";

function hashSha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

async function withTempKnowledgeCore(testCase) {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-knowledge-core-deep-"));
  let mount = null;
  try {
    mount = await createKnowledgeCoreMount({ userDataPath, outlineEnabled: true });
    return await testCase({
      mount,
      userDataPath,
      storeRoot: path.join(userDataPath, "knowledge-core"),
    });
  } finally {
    await mount?.close?.();
    await fs.rm(userDataPath, { force: true, recursive: true });
  }
}

function buildDocument({
  documentId,
  batchId,
  sourceId,
  sourcePath,
  sourceHash,
  title,
  summary,
  bodyText,
  collectionId = "manual",
  sourceType = "sourceFiles",
  asset = null,
}) {
  return {
    documentId,
    collectionId,
    batchId,
    sourceId,
    sourcePath,
    sourceHash,
    documentType: "email",
    title,
    summary,
    metadata: {
      source: sourceType,
      sourceId,
    },
    sections: [
      {
        sectionId: `${documentId}-section`,
        documentId,
        title: "正文",
        level: 1,
        position: 1,
        metadata: { source: sourceType },
      },
    ],
    blocks: [
      {
        blockId: `${documentId}-block`,
        documentId,
        sectionId: `${documentId}-section`,
        blockType: "text",
        title: "正文",
        text: bodyText,
        snippet: bodyText.slice(0, 40),
        position: 1,
        sourceLocator: {
          batchId,
          sourceId,
        },
        metadata: {
          source: sourceType,
        },
      },
    ],
    assets: asset ? [asset] : [],
  };
}

describe("knowledge-core index deep coverage", () => {
  it("covers helper contracts across core-utils, scoring, hydrators, and the outline loader", async () => {
    expect(compactObject({ a: 1, b: null, c: "", d: 0, e: false })).toEqual({ a: 1, d: 0, e: false });
    expect(asArray("x")).toEqual([]);
    expect(asArray([1, 2])).toEqual([1, 2]);
    expect(normalizeText("  alpha\r\nbeta  ")).toBe("alpha\nbeta");
    expect(uniqueStrings(["Alpha", "alpha", "", "Beta"], 2)).toEqual(["Alpha", "Beta"]);
    expect(clampNumber("not-a-number", 1, 5, 3)).toBe(3);
    expect(clampNumber(9, 1, 5, 3)).toBe(5);
    expect(parseJson("{bad", { ok: true })).toEqual({ ok: true });
    expect(stringifyJson({ a: 1 })).toBe("{\"a\":1}");
    expect(hashText("abc", 8)).toHaveLength(8);
    expect(truncateText("abcdef", 4)).toBe("abc…");

    expect(tokenize("FooBar_baz12")).toEqual(expect.arrayContaining(["foo", "bar", "baz", "12"]));
    expect(queryTerms("中文测试")).toEqual(expect.arrayContaining(["中文", "测试"]));
    expect(parseTimestampMs("invalid")).toBe(0);
    expect(firstTimestamp("", "still-bad", "2026-06-05T00:00:00.000Z")).toEqual({
      value: "2026-06-05T00:00:00.000Z",
      timestamp: Date.parse("2026-06-05T00:00:00.000Z"),
    });
    expect(queryMatchQualityScore("", "")).toMatchObject({
      score: 1,
      coverage: 1,
      orderedCoverage: 1,
      proximity: 1,
      exactPhrase: false,
    });
    expect(queryMatchQualityScore("alpha beta", "alpha beta gamma")).toMatchObject({
      exactPhrase: true,
    });
    expect(queryMatchQualityScore("alpha", "")).toMatchObject({
      score: 0,
      coverage: 0,
    });
    expect(exponentialRecencyScore(0, 0)).toBe(1);
    expect(
      exponentialRecencyScore(
        Date.parse("2026-06-04T00:00:00.000Z"),
        Date.parse("2026-06-05T00:00:00.000Z"),
        { recencyHalfLifeDays: 1, recencyFloor: 0.2 },
      ),
    ).toBeGreaterThanOrEqual(0.2);
    expect(
      candidateTemporalSource({
        source_locator_json: stringifyJson({ timestamp: "2026-06-05T00:00:00.000Z" }),
        metadata_json: stringifyJson({}),
        document_metadata_json: stringifyJson({}),
        updated_at: "2026-06-05T00:00:00.000Z",
        created_at: "2026-06-04T00:00:00.000Z",
        document_updated_at: "2026-06-03T00:00:00.000Z",
      }),
    ).toEqual({
      value: "2026-06-05T00:00:00.000Z",
      timestamp: Date.parse("2026-06-05T00:00:00.000Z"),
    });

    expect(hydrateDocument(null)).toBeNull();
    expect(
      hydrateDocument({
        document_id: "doc-1",
        collection_id: "collection-1",
        batch_id: "batch-1",
        source_id: "source-1",
        document_type: "email",
        title: "Document",
        summary: "Summary",
        source_path: "/source/doc-1.txt",
        source_hash: "sha-1",
        metadata_json: "{bad",
        created_at: "2026-06-05T00:00:00.000Z",
        updated_at: "2026-06-05T00:00:00.000Z",
      }),
    ).toMatchObject({
      documentId: "doc-1",
      metadata: {},
    });
    expect(hydrateSection(null)).toBeNull();
    expect(
      hydrateSection({
        section_id: "sec-1",
        document_id: "doc-1",
        title: "Section",
        level: "2",
        position: "3",
        metadata_json: "{bad",
      }),
    ).toMatchObject({
      sectionId: "sec-1",
      level: 2,
      position: 3,
      metadata: {},
    });
    expect(hydrateBlock(null)).toBeNull();
    expect(
      hydrateBlock({
        block_id: "block-1",
        document_id: "doc-1",
        section_id: "sec-1",
        block_type: "text",
        title: "Block",
        text: "Block text",
        snippet: "Block snippet",
        position: 4,
        source_locator_json: "{bad",
        metadata_json: "{bad",
        created_at: "2026-06-05T00:00:00.000Z",
        updated_at: "2026-06-05T00:00:00.000Z",
      }),
    ).toMatchObject({
      blockId: "block-1",
      sourceLocator: {},
      metadata: {},
    });
    expect(hydrateAsset(null)).toBeNull();
    expect(
      hydrateAsset({
        asset_id: "asset-1",
        document_id: "doc-1",
        section_id: "sec-1",
        block_id: "block-1",
        asset_type: "image",
        media_type: "text/plain",
        title: "Asset",
        text: "Asset text",
        ocr_text: "OCR",
        caption: "Caption",
        relative_path: "assets/a.txt",
        sha256: "sha-1",
        byte_size: "7",
        width: "8",
        height: "9",
        source_locator_json: "{bad",
        metadata_json: "{bad",
        created_at: "2026-06-05T00:00:00.000Z",
        updated_at: "2026-06-05T00:00:00.000Z",
      }),
    ).toMatchObject({
      assetId: "asset-1",
      byteSize: 7,
      width: 8,
      height: 9,
      sourceLocator: {},
      metadata: {},
    });
    expect(hydrateFeedback(null)).toBeNull();
    expect(
      hydrateFeedback({
        feedback_id: "fb-1",
        client_id: "client-1",
        query: "alpha",
        action: "thumb_up",
        item_id: "item-1",
        evidence_id: "evidence-1",
        result_rank: "2",
        context_json: "{bad",
        created_at: "2026-06-05T00:00:00.000Z",
      }),
    ).toMatchObject({
      feedbackId: "fb-1",
      resultRank: 2,
      context: {},
    });
    expect(hydrateRetrievalProfile(null)).toBeNull();
    expect(
      hydrateRetrievalProfile({
        profile_key: "balanced@1",
        profile_id: "balanced",
        version: "1",
        active: 1,
        weights_json: "{bad",
        top_k: "7",
        fusion_mode: "reciprocal_rank",
        reranker_json: "{bad",
        thresholds_json: "{bad",
        metrics_json: "{bad",
        created_at: "2026-06-05T00:00:00.000Z",
        updated_at: "2026-06-05T00:00:00.000Z",
      }),
    ).toMatchObject({
      profileKey: "balanced@1",
      topK: 7,
      active: true,
      weights: {},
    });
    expect(hydrateSuggestion(null)).toBeNull();
    expect(
      hydrateSuggestion({
        suggestion_id: "s-1",
        suggestion_type: "retrievalProfile",
        confidence: "0.5",
        proposed_patch_json: "{bad",
        evidence_refs_json: "{bad",
        status: "pending",
        created_at: "2026-06-05T00:00:00.000Z",
        updated_at: "2026-06-05T00:00:00.000Z",
        resolved_at: "",
        resolution_json: "{bad",
      }),
    ).toMatchObject({
      suggestionId: "s-1",
      confidence: 0.5,
      proposedPatch: {},
      evidenceRefs: [],
    });
    expect(hydrateReviewItem(null)).toBeNull();
    expect(
      hydrateReviewItem({
        review_id: "r-1",
        source: "knowledge-core",
        status: "pending",
        reason: "duplicate_source_document",
        severity: "medium",
        operation_id: "op-1",
        batch_id: "batch-1",
        entity_id: "entity-1",
        entity_type: "document",
        title: "Review",
        summary: "Summary",
        current_record_json: "{bad",
        incoming_record_json: "{bad",
        evidence_refs_json: "{bad",
        created_at: "2026-06-05T00:00:00.000Z",
        updated_at: "2026-06-05T00:00:00.000Z",
        resolved_at: "",
        resolution_json: "{bad",
      }),
    ).toMatchObject({
      reviewId: "r-1",
      currentRecord: {},
      incomingRecord: {},
      evidenceRefs: [],
    });
    expect(hydrateLearningRun(null)).toBeNull();
    expect(
      hydrateLearningRun({
        run_id: "run-1",
        status: "completed",
        input_json: "{bad",
        metrics_before_json: "{bad",
        metrics_after_json: "{bad",
        candidate_profile_json: "{bad",
        generated_suggestions_json: "{bad",
        output_json: "{bad",
        started_at: "2026-06-05T00:00:00.000Z",
        finished_at: "",
      }),
    ).toMatchObject({
      runId: "run-1",
      input: {},
      generatedSuggestions: [],
    });
    expect(hydrateProfileDeployment(null)).toBeNull();
    expect(
      hydrateProfileDeployment({
        deployment_id: "deploy-1",
        profile_key: "canary@1",
        profile_id: "canary",
        version: "2",
        status: "canary",
        traffic_percent: "100",
        baseline_profile_key: "balanced@1",
        metrics_json: "{bad",
        gate_json: "{bad",
        reason: "test",
        created_at: "2026-06-05T00:00:00.000Z",
        updated_at: "2026-06-05T00:00:00.000Z",
        finished_at: "",
      }),
    ).toMatchObject({
      deploymentId: "deploy-1",
      profileKey: "canary@1",
      trafficPercent: 100,
      metrics: {},
      gate: {},
    });

    const noop = createNoopDocumentOutlineRuntime();
    const outline = noop.build({
      document: { documentId: "doc-outline" },
      sections: [{ sectionId: "sec-1" }],
      blocks: [{ blockId: "blk-1" }],
      assets: [{ assetId: "asset-1" }],
    });
    expect(noop.protocolVersion).toBe("v0.0.1:knowledge:document-outline-1");
    expect(noop.rangeContainsPosition({ blockStart: 1, blockEnd: 2 }, 2)).toBe(false);
    expect(outline).toMatchObject({
      documentId: "doc-outline",
      nodeCount: 0,
      syntheticNodeCount: 0,
      sourceStats: {
        sectionCount: 1,
        blockCount: 1,
        assetCount: 1,
      },
    });
    expect(outline.qualityFindings[0]).toMatchObject({
      code: "outline_runtime_disabled",
    });

    const resolvedNoop = await resolveDocumentOutlineRuntime({ enabled: false });
    expect(resolvedNoop.protocolVersion).toBe("v0.0.1:knowledge:document-outline-1");
    expect(resolvedNoop.build({ document: { documentId: "doc-2" } }).qualityFindings[0].code).toBe(
      "outline_runtime_disabled",
    );
  });

  it("covers item retrieval, evidence creation, search routing, mirror sync, and hierarchy rebuilding", async () => {
    await withTempKnowledgeCore(async ({ mount, storeRoot }) => {
      const alphaAssetText = "alpha asset";
      const alphaAssetRelativePath = "assets/alpha/alpha.txt";
      await fs.mkdir(path.dirname(path.join(storeRoot, alphaAssetRelativePath)), { recursive: true });
      await fs.writeFile(path.join(storeRoot, alphaAssetRelativePath), alphaAssetText, "utf8");

      const alphaDoc = buildDocument({
        documentId: "doc-alpha",
        batchId: "batch-main",
        sourceId: "source-alpha",
        sourcePath: "alpha.txt",
        sourceHash: "sha-alpha",
        title: "Alpha Email",
        summary: "Alpha summary",
        bodyText: "From: alpha@example.com\nTo: team@example.org\nalpha alpha beta",
        asset: {
          assetId: "asset-alpha",
          documentId: "doc-alpha",
          sectionId: "doc-alpha-section",
          blockId: "doc-alpha-block",
          assetType: "image",
          mediaType: "text/plain",
          title: "Alpha Asset",
          text: "asset payload",
          ocrText: "",
          caption: "Alpha asset",
          relativePath: alphaAssetRelativePath,
          sha256: hashSha256(alphaAssetText),
          byteSize: Buffer.byteLength(alphaAssetText),
          sourceLocator: {
            batchId: "batch-main",
            sourceId: "source-alpha",
          },
          metadata: {},
        },
      });
      const bravoDoc = buildDocument({
        documentId: "doc-bravo",
        batchId: "batch-main",
        sourceId: "source-bravo",
        sourcePath: "bravo.txt",
        sourceHash: "sha-bravo",
        title: "Bravo Email",
        summary: "Bravo summary",
        bodyText: "From: bravo@example.org\nTo: alpha@example.com\nbravo alpha",
        asset: {
          assetId: "asset-bravo",
          documentId: "doc-bravo",
          sectionId: "doc-bravo-section",
          blockId: "doc-bravo-block",
          assetType: "image",
          mediaType: "text/plain",
          title: "Bravo Asset",
          text: "asset payload",
          ocrText: "",
          caption: "",
          relativePath: alphaAssetRelativePath,
          sha256: hashSha256(alphaAssetText),
          byteSize: Buffer.byteLength(alphaAssetText),
          sourceLocator: {
            batchId: "batch-main",
            sourceId: "source-bravo",
          },
          metadata: {},
        },
      });

      await mount.upsertDocuments({ documents: [alphaDoc, bravoDoc] });

      const item = mount.getItem({ documentId: "doc-alpha" });
      expect(item).toMatchObject({
        documentId: "doc-alpha",
        collectionId: "manual",
      });
      expect(item.sections).toHaveLength(1);
      expect(item.blocks).toHaveLength(1);
      expect(item.assets).toHaveLength(1);
      expect(mount.getItem({ itemId: "missing-doc" })).toBeNull();

      const structure = mount.getDocumentStructure({ documentId: "doc-alpha" });
      expect(structure).toMatchObject({
        document: {
          documentId: "doc-alpha",
        },
        nodeCount: expect.any(Number),
      });
      expect(structure.tree[0]).toMatchObject({
        nodeType: "document",
        targetId: "doc-alpha",
      });

      const sync = mount.syncMirror({ since: 0, limit: 2 });
      expect(sync.scope).toBe("mirror");
      expect(sync.changes).toHaveLength(2);
      expect(sync.hasMore).toBe(true);
      expect(sync.changes.map((change) => change.kind)).toEqual(["document", "section"]);

      const followUpSync = mount.syncMirror({ since: Number(sync.cursor), limit: 50 });
      expect(followUpSync.hasMore).toBe(false);
      expect(Number(followUpSync.latestCursor)).toBeGreaterThanOrEqual(Number(sync.cursor));

      const aggregate = mount.aggregate({
        metric: "custom_metric",
        groupBy: "senderDomain",
        batchId: "batch-main",
        documentType: "email",
        limit: 10,
      });
      expect(aggregate.ok).toBe(true);
      expect(aggregate.groups).toHaveLength(2);
      expect(aggregate.groups[0].key).toBe("example.com");
      const evidenceId = aggregate.groups[0].evidenceRefs[0];
      expect(evidenceId).toBeTruthy();

      const evidence = mount.getEvidence({ evidenceId });
      expect(evidence).toMatchObject({
        evidenceId,
        documentId: "doc-alpha",
      });
      expect(mount.getEvidence({ evidenceId: "missing-evidence" })).toBeNull();

      const markdown = mount.renderMarkdown({ evidenceId });
      expect(markdown).toMatchObject({
        protocolVersion: "v0.0.1:knowledge:core-1",
        evidenceId,
        contentType: "text/markdown; charset=utf-8",
      });
      expect(mount.renderMarkdown({ query: "alpha", batchId: "batch-main" })?.evidenceId).toBeTruthy();

      const activeProfile = mount.getRetrievalProfile({});
      expect(activeProfile.profileKey).toBeTruthy();
      const explicitKeySearch = mount.search({
        query: "alpha",
        batchId: "batch-main",
        profileKey: activeProfile.profileKey,
        limit: 1,
      });
      expect(explicitKeySearch.profileRoute.routedBy).toBe("explicit_profile_key");
      expect(explicitKeySearch.items).toHaveLength(1);

      const explicitIdSearch = mount.search({
        query: "alpha",
        batchId: "batch-main",
        retrievalProfileId: activeProfile.profileId,
        limit: 1,
      });
      expect(explicitIdSearch.profileRoute.routedBy).toBe("explicit_profile_id");

      const agentSearch = mount.search({
        query: "alpha",
        batchId: "batch-main",
        responseProfile: "agent",
        limit: 1,
      });
      expect(agentSearch.responseProfile).toBe("agent");
      expect(agentSearch.agentMessage).toMatchObject({
        protocolVersion: "v0.0.1:knowledge:search-agent-message-1",
        query: "alpha",
      });

      const agentSuppressedSearch = mount.search({
        query: "alpha",
        batchId: "batch-main",
        requestSurface: "agent",
        agentMessage: false,
        limit: 1,
      });
      expect(agentSuppressedSearch.responseProfile).toBe("agent");
      expect(agentSuppressedSearch.agentMessage).toBeUndefined();

      const canaryProfile = mount.createRetrievalProfileDeployment({
        profile: {
          profileId: "canary-profile",
          version: 2,
          topK: 5,
          weights: {
            bm25: 0.4,
            vector: 0.4,
            image: 0.2,
            graph: 0,
            feedbackBoost: 0.1,
          },
        },
        status: "canary",
        trafficPercent: 100,
        baselineProfileKey: activeProfile.profileKey,
      });
      expect(canaryProfile.status).toBe("canary");
      expect(mount.listRetrievalProfileDeployments({ status: "canary", limit: 10 }).deployments[0].deploymentId).toBe(
        canaryProfile.deploymentId,
      );
      expect(mount.getRetrievalProfile({ profileKey: canaryProfile.profileKey })).toMatchObject({
        profileKey: canaryProfile.profileKey,
      });
      expect(mount.getRetrievalProfile({ profileId: canaryProfile.profileId })).toMatchObject({
        profileId: canaryProfile.profileId,
      });
      expect(mount.promoteRetrievalProfileDeployment({ deploymentId: "missing" })).toBeNull();
      expect(mount.rollbackRetrievalProfileDeployment({ deploymentId: "missing" })).toBeNull();

      const canarySearch = mount.search({
        query: "alpha",
        batchId: "batch-main",
        clientId: "client-canary",
        limit: 1,
      });
      expect(canarySearch.profileRoute.routedBy).toBe("canary");
      expect(canarySearch.profileRoute.deploymentId).toBe(canaryProfile.deploymentId);

      const promoted = mount.promoteRetrievalProfileDeployment({ deploymentId: canaryProfile.deploymentId });
      expect(promoted.deployment.status).toBe("active");
      expect(promoted.activeProfile.profileId).toBe("canary-profile");
      const rolledBack = mount.rollbackRetrievalProfileDeployment({ deploymentId: canaryProfile.deploymentId });
      expect(rolledBack.deployment.status).toBe("rolled_back");

      expect(mount.health().counts.documents).toBeGreaterThanOrEqual(2);

      const maintenance = mount.runMaintenance({ taskType: "reindex", batchSize: 1 });
      expect(maintenance.status).toBe("completed");
      expect(mount.health().maintenance.indexStale).toBe(false);
      await expect(mount.getAssetContent({ assetId: "asset-alpha" })).resolves.toMatchObject({
        fileName: "alpha.txt",
        contentType: "text/plain",
      });
    });
  });

  it("covers feedback, review, suggestions, retrieval profiles, quality checks, and maintenance edge cases", async () => {
    await withTempKnowledgeCore(async ({ mount, storeRoot }) => {
      const reviewResult = await mount.ingestSources({
        batchId: "batch-review",
        sources: [
          {
            id: "review-1",
            path: "review.txt",
            name: "review",
            text: "From: review@example.com\nalpha review",
          },
          {
            id: "review-2",
            path: "review.txt",
            name: "review",
            text: "From: review@example.com\nalpha review",
          },
        ],
      });
      expect(reviewResult.reviewItems).toHaveLength(1);
      const pendingReviews = mount.listReviewItems();
      expect(pendingReviews.status).toBe("pending");
      expect(pendingReviews.items).toHaveLength(1);
      const reviewResolution = await mount.resolveReviewItem({
        reviewId: pendingReviews.items[0].reviewId,
        resolution: "accept",
      });
      expect(reviewResolution.status).toBe("resolved");
      expect(reviewResolution.resolvedDocument).toMatchObject({
        documentId: expect.any(String),
      });
      expect(mount.resolveReviewItem({ reviewId: "missing-review" })).toBeNull();

      expect(() => mount.recordFeedback({ clientId: "client-1", query: "alpha" })).toThrow(
        "knowledge.feedback.record 缺少 action。",
      );
      const recordedFeedback = await mount.recordFeedback({
        clientId: "client-1",
        query: "alpha",
        event: "thumb-down",
        itemId: "item-1",
        evidenceId: "evidence-1",
        resultRank: 3,
        context: { surface: "console" },
      });
      expect(recordedFeedback.feedback.action).toBe("thumb_down");
      expect(mount.feedbackSince({ windowHours: 1, limit: 10 })).toHaveLength(1);

      const learningRun = mount.runMaintenance({
        taskType: "learning_run",
        autoApply: false,
        feedbackWindowHours: 24,
        feedbackLimit: 50,
      });
      expect(learningRun.status).toBe("completed");
      expect(learningRun.output.generatedSuggestionCount).toBeGreaterThan(0);
      const suggestions = mount.listSuggestions({ status: "pending", limit: 20 });
      const profileSuggestion = suggestions.items.find((item) => item.type === "retrievalProfile");
      expect(profileSuggestion).toBeTruthy();
      const resolvedSuggestion = mount.resolveSuggestion({
        suggestionId: profileSuggestion.suggestionId,
        resolution: "merge",
        patch: { topK: 11 },
      });
      expect(resolvedSuggestion.status).toBe("resolved");
      expect(resolvedSuggestion.appliedProfile.profileId).toBeTruthy();
      expect(mount.resolveSuggestion({ suggestionId: "missing-suggestion" })).toBeNull();
      expect(mount.listSuggestions({ status: "resolved", limit: 10 }).items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            suggestionId: profileSuggestion.suggestionId,
          }),
        ]),
      );

      const activeProfile = mount.getRetrievalProfile({});
      const canaryDeployment = mount.createRetrievalProfileDeployment({
        profile: {
          profileId: "canary-profile-2",
          version: 4,
          topK: 4,
          weights: {
            bm25: 0.45,
            vector: 0.35,
            image: 0.2,
            graph: 0,
            feedbackBoost: 0.05,
          },
        },
        status: "canary",
        trafficPercent: 100,
        baselineProfileKey: activeProfile.profileKey,
      });
      expect(canaryDeployment.status).toBe("canary");
      expect(() => mount.createRetrievalProfileDeployment({})).toThrow(
        "retrieval profile deployment 缺少 profile 或 profileKey。",
      );
      expect(mount.listRetrievalProfileDeployments({ status: "canary", limit: 10 }).deployments).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            deploymentId: canaryDeployment.deploymentId,
          }),
        ]),
      );

      const canarySearch = mount.search({
        query: "alpha",
        clientId: "client-canary-2",
        limit: 1,
      });
      expect(canarySearch.profileRoute.routedBy).toBe("canary");

      expect(mount.promoteRetrievalProfileDeployment({ deploymentId: "missing-deployment" })).toBeNull();
      expect(mount.rollbackRetrievalProfileDeployment({ deploymentId: "missing-deployment" })).toBeNull();
      const promoted = mount.promoteRetrievalProfileDeployment({
        deploymentId: canaryDeployment.deploymentId,
        reason: "integration-test",
      });
      expect(promoted.deployment.status).toBe("active");
      const rolledBack = mount.rollbackRetrievalProfileDeployment({
        deploymentId: canaryDeployment.deploymentId,
        reason: "integration-test",
      });
      expect(rolledBack.deployment.status).toBe("rolled_back");

      const qualityRoot = path.join(storeRoot, "assets", "quality");
      await fs.mkdir(qualityRoot, { recursive: true });
      await fs.writeFile(path.join(qualityRoot, "c.png"), "quality-c", "utf8");

      await mount.upsertDocuments({
        documents: [
          buildDocument({
            documentId: "doc-quality-a",
            batchId: "batch-quality",
            sourceId: "quality-a",
            sourcePath: "quality-a.txt",
            sourceHash: "same-quality-hash",
            title: "Quality A",
            summary: "Quality summary",
            bodyText: "From: quality@example.com\nalpha quality",
          }),
          buildDocument({
            documentId: "doc-quality-c",
            batchId: "batch-quality",
            sourceId: "quality-c",
            sourcePath: "quality-c.txt",
            sourceHash: "unique-quality-hash",
            title: "Quality C",
            summary: "Image quality",
            bodyText: "From: image@example.org\nimage quality",
            asset: {
              assetId: "asset-quality-c",
              documentId: "doc-quality-c",
              sectionId: "doc-quality-c-section",
              blockId: "doc-quality-c-block",
              assetType: "image",
              mediaType: "image/png",
              title: "Quality C asset",
              text: "asset payload",
              ocrText: "",
              caption: "",
              relativePath: "assets/quality/c.png",
              sha256: hashSha256("quality-c"),
              byteSize: Buffer.byteLength("quality-c"),
              sourceLocator: {
                batchId: "batch-quality",
                sourceId: "quality-c",
              },
              metadata: {},
            },
          }),
        ],
      });

      const db = new Database(path.join(storeRoot, "knowledge.sqlite"));
      try {
        const sourceRow = db
          .prepare(
            `
              SELECT *
              FROM kc_documents
              WHERE document_id = ?
            `,
          )
          .get("doc-quality-a");
        db.prepare(
          `
            INSERT INTO kc_documents (
              document_id, collection_id, batch_id, source_id, document_type, title, summary,
              source_path, source_hash, metadata_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
        ).run(
          "doc-quality-b",
          sourceRow.collection_id,
          sourceRow.batch_id,
          "quality-b",
          sourceRow.document_type,
          "Quality B",
          sourceRow.summary,
          "quality-b.txt",
          sourceRow.source_hash,
          sourceRow.metadata_json,
          sourceRow.created_at,
          sourceRow.updated_at,
        );
      } finally {
        db.close();
      }

      const quality = mount.runMaintenance({ taskType: "validate_quality" }).output;
      expect(quality.ok).toBe(false);
      expect(quality.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "documents_without_blocks" }),
          expect.objectContaining({ code: "duplicate_source_hash_documents" }),
          expect.objectContaining({ code: "images_without_ocr_or_caption" }),
        ]),
      );
      expect(
        mount.runMaintenance({ taskType: "validate_quality", requireOcrOrCaption: false }).output.findings.some(
          (finding) => finding.code === "images_without_ocr_or_caption",
        ),
      ).toBe(false);

      const validateQualityMaintenance = mount.runMaintenance({ taskType: "validate_quality" });
      expect(validateQualityMaintenance.status).toBe("completed");
      expect(validateQualityMaintenance.output.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "documents_without_blocks" }),
        ]),
      );

      const dedupeMaintenance = mount.runMaintenance({
        taskType: "deduplicate_sources",
        dryRun: true,
      });
      expect(dedupeMaintenance.status).toBe("completed");
      expect(dedupeMaintenance.output.duplicateGroupCount).toBeGreaterThan(0);

      const comparisonMaintenance = mount.runMaintenance({
        taskType: "compare_retrieval_profiles",
        queries: ["alpha"],
        limit: 2,
      });
      expect(comparisonMaintenance.status).toBe("completed");
      expect(comparisonMaintenance.output.queryCount).toBe(1);

      expect(mount.runMaintenance({ taskType: "mystery-cleanup" }).output).toEqual({
        ok: false,
        error: "未知知识库维护任务：mystery_cleanup",
      });

      const disabledResult = mount.runMaintenance({
        taskType: "reembed_by_model_version",
        modelVersion: "v2",
        embeddingModel: {
          text: "builtin:hashing-multilingual-v2",
        },
      });
      expect(disabledResult.status).toBe("completed");
      expect(mount.getMaintenance().embeddingModel.version).toBe("v2");
      expect(mount.health().maintenance.indexStale).toBe(false);

      mount.setMaintenance({
        learning: {
          enabled: false,
        },
      });
      const disabledSearch = mount.search({
        query: "alpha",
        batchId: "batch-quality",
        limit: 1,
      });
      expect(disabledSearch.profileRoute.routedBy).toBe("learning_disabled");
      expect(disabledSearch.learningEnabled).toBe(false);
      expect(mount.health().protocolModules.learning.enabled).toBe(false);
    });
  });
});
