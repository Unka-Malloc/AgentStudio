import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";

const taxonomyLoadMock = vi.hoisted(() => vi.fn());
const outlineBuildMock = vi.hoisted(() => vi.fn());

vi.mock("../../../server/platform/specialized/knowledge/preprocessing/domain/knowledge-taxonomy/index.mjs", () => ({
  createKnowledgeTaxonomyRuntime: vi.fn(() => ({
    path: "/tmp/mock-knowledge-taxonomy.json",
    expertVocabularyPath: "/tmp/mock-expert-vocabulary.json",
    emailRulesPath: "/tmp/mock-email-rules.json",
    loadSync: taxonomyLoadMock
  }))
}));

vi.mock("../../../server/platform/specialized/knowledge/retrieval/embedding-runtime/index.mjs", () => ({
  EMBEDDING_PROTOCOL_VERSION: "pact.embedding.v1",
  createEmbeddingRuntime: vi.fn(() => ({
    protocolVersion: "pact.embedding.v1",
    embedText: vi.fn((value = "") => ({
      vector: Array.from(String(value)).map(() => 0.01),
      text: String(value),
      model: "mock-text-model",
      dimension: 8
    })),
    embedImageEvidence: vi.fn(() => ({
      vector: Array(8).fill(0.1),
      contentType: "image/mock",
      model: "mock-image-model",
      dimension: 8
    })),
    embedJointEvidence: vi.fn(() => ({
      vector: Array(8).fill(0.2),
      modality: "joint",
      model: "mock-joint-model",
      dimension: 8
    })),
    health: vi.fn(() => ({
      protocolVersion: "pact.embedding.v1",
      ok: true,
      degraded: false
    })),
    capabilities: vi.fn(() => ({
      protocolVersion: "pact.embedding.v1",
      providers: []
    }))
  }))
}));

vi.mock("../../../server/platform/specialized/knowledge/retrieval/vector-store/LocalVectorStore/index.mjs", () => ({
  SQLITE_VEC_PROVIDER_ID: "sqlite-vec",
  createLocalVectorStore: vi.fn(() => ({
    providerId: "sqlite-vec",
    upsert: vi.fn(),
    deleteByTargetIds: vi.fn(),
    search: vi.fn(() => []),
    health: vi.fn(() => ({
      protocolVersion: "pact.vector.v1",
      ok: true,
      degraded: false
    })),
    capabilities: vi.fn(() => ({
      protocolVersion: "pact.vector.v1",
      providers: ["sqlite-vec"]
    })),
    close: vi.fn()
  }))
}));

vi.mock("../../../server/platform/specialized/knowledge/retrieval/learning-runtime/index.mjs", () => ({
  LEARNING_PROTOCOL_VERSION: "pact.learning.v1",
  createLearningRuntime: vi.fn(() => ({
    protocolVersion: "pact.learning.v1",
    health: vi.fn(async () => ({
      protocolVersion: "pact.learning.v1",
      ok: true,
      degraded: false
    })),
    capabilities: vi.fn(() => ({
      protocolVersion: "pact.learning.v1",
      enabled: true,
      safeAutoApplySuggestionTypes: ["retrievalProfile", "rankingRule", "decay"]
    })),
    fuseCandidatesSync: vi.fn(({ candidates = [] } = {}) => ({
      runtime: "mock",
      degraded: false,
      candidates,
      explanations: []
    })),
    proposeProfile: vi.fn(() => ({
      protocolVersion: "pact.learning.v1",
      profileId: "balanced"
    })),
    generateSuggestions: vi.fn(() => [])
  }))
}));

vi.mock("../../../server/platform/specialized/knowledge/storage/knowledge-core/outline-runtime-loader.mjs", () => ({
  createNoopDocumentOutlineRuntime: vi.fn(() => ({
    protocolVersion: "pact.document-outline.v1",
    build: outlineBuildMock,
    rangeContainsPosition: vi.fn(() => false)
  })),
  resolveDocumentOutlineRuntime: vi.fn(async () => ({
    protocolVersion: "pact.document-outline.v1",
    build: outlineBuildMock,
    rangeContainsPosition: vi.fn(() => false)
  }))
}));

import createKnowledgeCoreMount from "../../../server/platform/specialized/knowledge/storage/knowledge-core/index.mjs";

const pngDataUrl =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2Y0mQAAAAASUVORK5CYII=";
const octetDataUrl = "data:application/octet-stream;base64,AA==";

function buildOutlineNodes(documentId) {
  const documentOutlineId = `${documentId}-outline`;
  const sectionOutlineId = `${documentId}-section-outline`;
  return [
    {
      nodeType: "collection",
      targetId: `collection-${documentId}`,
      title: `Collection ${documentId}`,
      summary: `Collection ${documentId}`,
      text: `Collection ${documentId}`,
      categoryPath: ["collections", documentId],
      metadata: {}
    },
    {
      nodeType: "document",
      targetId: `${documentId}-doc-node`,
      title: `Document ${documentId}`,
      summary: "Document summary",
      text: "Document text",
      categoryPath: ["documents", documentId],
      metadata: {}
    },
    {
      nodeType: "section",
      targetId: sectionOutlineId,
      title: `Section ${documentId}`,
      summary: "Section summary",
      text: "Section text",
      categoryPath: ["documents", documentId, "section"],
      metadata: {}
    },
    {
      nodeType: "outline",
      targetId: documentOutlineId,
      parentNodeType: "section",
      parentTargetId: sectionOutlineId,
      title: `Outline ${documentId}`,
      summary: "Outline summary",
      text: "Outline text",
      categoryPath: ["documents", documentId, "outline"],
      metadata: {}
    },
    {
      nodeType: "chapter",
      targetId: `${documentId}-chapter`,
      title: `Chapter ${documentId}`,
      summary: "Chapter summary",
      text: "Chapter text",
      categoryPath: ["documents", documentId, "chapter"],
      metadata: {}
    }
  ];
}

function buildMailText({
  sender = "Alice Example <alice@example.com>",
  recipient = "bob@example.net",
  subject = "Sale promo",
  metaSender = "meta.sender@example.com",
  metaRecipient = "meta.recipient@example.net",
  body = "Sale offer for Alice with &amp; &#65; &#x41; &madeup;=3D and broken =ff."
} = {}) {
  return [
    `From: ${sender}`,
    `To: ${recipient}`,
    `Subject: ${subject}`,
    "Content-Type: text/html; charset=utf-8",
    "",
    "<html>",
    "<head>",
    `<meta name=\"description\" content=\"A &amp; B &#65; &#x41; &madeup;\">`,
    `<meta name=\"Message:From-Email\" content=\"${metaSender}\">`,
    `<meta name=\"Message:To-Email\" content=\"${metaRecipient}\">`,
    "<style>body{color:red}</style>",
    "<script>console.log('ignore')</script>",
    "</head>",
    "<body>",
    `<div>${body}</div>`,
    "<p>Visit https://example.com/track</p>",
    "<img src=\"cdn/assets/hero.png\">",
    "</body>",
    "</html>"
  ].join("\n");
}

function buildPlainMailText({
  sender = "Sender <sender@example.com>",
  recipient = "recipient@example.org",
  subject = "Sale alert",
  body = "Sale unsubscribe offer"
} = {}) {
  return [
    `From: ${sender}`,
    `To: ${recipient}`,
    `Subject: ${subject}`,
    "",
    body,
    "Loose line with url https://example.com/plain",
    "Loose image refs/promo.jpg"
  ].join("\n");
}

async function withTempKnowledgeCore({
  taxonomy,
  outlineResultFactory,
  testCase
} = {}) {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-knowledge-core-focused-extra-2-"));
  let mount = null;
  try {
    taxonomyLoadMock.mockReturnValue(taxonomy);
    outlineBuildMock.mockImplementation(({ document }) => outlineResultFactory(document));
    mount = await createKnowledgeCoreMount({
      userDataPath,
      outlineEnabled: true
    });
    return await testCase({
      mount,
      userDataPath,
      storeRoot: path.join(userDataPath, "knowledge-core")
    });
  } finally {
    await mount?.close?.();
    await fs.rm(userDataPath, { force: true, recursive: true });
  }
}

function openKnowledgeDb(storeRoot) {
  return new Database(path.join(storeRoot, "knowledge.sqlite"));
}

describe("knowledge-core focused extra coverage 2", () => {
  it("covers HTML/text cleanup, hierarchy defaults, search agent messages, and aggregate fallback parsing", async () => {
    await withTempKnowledgeCore({
      taxonomy: {
        checksum: "taxonomy-empty",
        version: 1,
        source: "mock-taxonomy",
        categories: []
      },
      outlineResultFactory: (document) => ({
        protocolVersion: "pact.document-outline.v1",
        documentId: document.documentId || "",
        nodeCount: 5,
        syntheticNodeCount: 0,
        nodes: buildOutlineNodes(document.documentId || ""),
        qualityFindings: []
      }),
      testCase: async ({ mount, storeRoot }) => {
        const manualDocument = {
          documentId: "doc-manual-mail",
          collectionId: "manual",
          collectionTitle: "Manual Knowledge",
          documentType: "email",
          title: "Manual Mail Preview",
          summary: "Sale promo preview",
          sourcePath: "mail/manual-preview.eml",
          sourceHash: "",
          metadata: {
            originalRelativePath: "mail/manual-preview.eml",
            source: "manual"
          },
          sections: [
            {
              sectionId: "doc-manual-mail-section",
              documentId: "doc-manual-mail",
              title: "正文",
              level: 1,
              position: 1,
              metadata: {}
            }
          ],
          blocks: [
            {
              blockId: "doc-manual-mail-block",
              documentId: "doc-manual-mail",
              sectionId: "doc-manual-mail-section",
              blockType: "text",
              title: "正文",
              text: buildMailText(),
              snippet: "Sale promo preview",
              position: 1,
              sourceLocator: {
                batchId: "manual-batch",
                sourceId: "manual-source"
              },
              metadata: {
                source: "manual"
              }
            }
          ],
          assets: []
        };

        const insertResult = mount.upsertDocuments({
          documents: [manualDocument]
        });
        expect(insertResult.documentCount).toBe(1);

        const ingestResult = await mount.ingestBatch({
          batchId: "batch-focused-extra-2",
          result: {
            sourceFiles: [
            {
              id: "source-hash-png",
              kind: "email",
              path: "mail/hashed-preview.eml",
              text: buildMailText({
                sender: "Hashed Sender <hashed@example.com>",
                recipient: "hashed-recipient@example.net",
                subject: "Sale hash promo",
                metaSender: "hashed.meta@example.com",
                metaRecipient: "hashed.meta-recipient@example.net",
                body: "Sale hash promo with https://example.com/hash and encoded =3D marker."
              }),
              rawObjectSha256: "hash-aaaa",
              mediaType: "image/png",
              imageDataUrl: pngDataUrl
            },
            {
              id: "source-path-bin",
              kind: "email",
              path: "mail/path-only.msg",
              text: buildPlainMailText({
                sender: "Path Sender <path@example.com>",
                recipient: "path-recipient@example.org",
                subject: "Sale path alert",
                body: "Sale path alert unsubscribe"
              }),
              mediaType: "application/octet-stream",
              imageDataUrl: octetDataUrl
            },
            {
              id: "source-random",
              kind: "email",
              name: "Loose Mail",
              text: "Plain mail body with sale mention and https://example.com/plain",
              imageDataUrl: octetDataUrl
            }
            ]
          }
        });

        expect(ingestResult).toMatchObject({
          batchId: "batch-focused-extra-2",
          receivedDocumentCount: 3,
          documentCount: 3,
          assetCount: 3
        });

        const db = openKnowledgeDb(storeRoot);
        try {
          const docs = db.prepare(
            "SELECT document_id, source_path, source_hash, metadata_json FROM kc_documents ORDER BY document_id ASC"
          ).all();
          expect(docs).toHaveLength(4);
          expect(docs.some((row) => String(row.source_path || "").includes("manual-preview.eml"))).toBe(true);
        } finally {
          db.close();
        }

        const agentSearch = mount.search({
          query: "sale promo",
          responseProfile: "agent",
          machineReadable: true,
          explain: true,
          timeRange: {
            from: "2026-01-01",
            to: "2026-01-31",
            mode: "created"
          },
          scopeSourceIds: ["source-hash-png", "source-hash-png"],
          sourceIds: ["source-path-bin"],
          retrievalMode: "keyword",
          keywordOnly: true,
          limit: 5
        });

        expect(agentSearch.responseProfile).toBe("agent");
        expect(agentSearch.agentMessage).toMatchObject({
          protocolVersion: "pact.knowledge-search.agent-message.v1",
          machineReadable: true,
          responseProfile: "agent",
          query: "sale promo",
          constraints: {
            sourceIds: ["source-hash-png", "source-path-bin"],
            keywordOnly: true,
            retrievalMode: "keyword",
            timeRange: {
              from: "2026-01-01",
              to: "2026-01-31",
              mode: "created"
            },
            temporalFilter: {
              requested: true,
              applied: false,
              reason: "time_range_filter_not_yet_supported_by_knowledge_search"
            }
          }
        });
        expect(agentSearch.items.length).toBeGreaterThan(0);
        expect(agentSearch.explain.generatedCandidateCount).toBeGreaterThan(0);

        const consoleSearch = mount.search({
          query: "sale promo",
          responseProfile: "console",
          agentMessage: "yes",
          limit: 3
        });
        expect(consoleSearch.responseProfile).toBe("agent");
        expect(consoleSearch.agentMessage?.protocolVersion).toBe("pact.knowledge-search.agent-message.v1");

        const senderAggregate = mount.aggregate({
          metric: "email_advertising_by_sender",
          classification: "advertising",
          groupBy: "senderDomain",
          documentType: "email",
          query: "sale",
          limit: 10
        });
        expect(senderAggregate.ok).toBe(true);
        expect(senderAggregate.filters).toMatchObject({
          categoryId: "",
          classification: "advertising",
          documentType: "email"
        });
        expect(senderAggregate.topGroup?.key).toBe("example.com");
        expect(senderAggregate.matchedDocumentCount).toBeGreaterThan(0);

        const recipientAggregate = mount.aggregate({
          metric: "email_advertising_by_sender",
          classification: "advertising",
          groupBy: "recipientEmail",
          documentType: "email",
          query: "sale",
          limit: 10
        });
        expect(recipientAggregate.topGroup?.key).toBe("hashed.meta-recipient@example.net");

        const recipientDomainAggregate = mount.aggregate({
          metric: "email_advertising_by_sender",
          classification: "advertising",
          groupBy: "recipientDomain",
          documentType: "email",
          query: "sale",
          limit: 10
        });
        expect(recipientDomainAggregate.topGroup?.key).toBe("example.net");

        const typeAggregate = mount.aggregate({
          metric: "email_advertising_by_sender",
          classification: "advertising",
          groupBy: "documentType",
          documentType: "email",
          query: "sale",
          limit: 10
        });
        expect(typeAggregate.topGroup?.key).toBe("email");

        const fallbackAggregate = mount.aggregate({
          metric: "email_advertising_by_sender",
          classification: "advertising",
          documentType: "email",
          query: "sale",
          limit: 10
        });
        expect(fallbackAggregate.topGroup?.key).toBe("hashed.meta@example.com");

        mount.getDocumentStructure({
          documentId: "doc-manual-mail"
        });
      }
    });
  });

  it("covers explicit category-path matching, negative dominance, and media extension fallbacks", async () => {
    await withTempKnowledgeCore({
      taxonomy: {
        checksum: "taxonomy-marketing",
        version: 2,
        source: "mock-taxonomy",
        categories: [
          {
            categoryId: "marketing_promo",
            path: "marketing > promo",
            label: "Promo",
            primaryTerms: ["sale"],
            keywords: ["offer", "promo"],
            strongTerms: ["sale"],
            negativeTerms: ["unsubscribe", "notice"],
            minPrimaryHits: 1,
            minPositiveHits: 1,
            negativeDominance: 2
          }
        ]
      },
      outlineResultFactory: (document) => ({
        protocolVersion: "pact.document-outline.v1",
        documentId: document.documentId || "",
        nodeCount: 5,
        syntheticNodeCount: 0,
        nodes: buildOutlineNodes(document.documentId || ""),
        qualityFindings: []
      }),
      testCase: async ({ mount, storeRoot }) => {
        const ingestResult = await mount.ingestBatch({
          batchId: "batch-marketing",
          result: {
            sourceFiles: [
            {
              id: "source-positive",
              kind: "email",
              path: "mail/promo-positive.eml",
              text: buildMailText({
                sender: "Promo Sender <promo@example.com>",
                recipient: "promo-recipient@example.org",
                subject: "Sale promo offer",
                metaSender: "promo.meta@example.com",
                metaRecipient: "promo.recipient@example.org",
                body: "Sale promo offer with bonus and no unsubscribe"
              }),
              rawObjectSha256: "hash-positive",
              mediaType: "image/png",
              imageDataUrl: pngDataUrl
            },
            {
              id: "source-negative",
              kind: "email",
              path: "mail/promo-negative.msg",
              text: buildPlainMailText({
                sender: "Unsub Sender <unsub@example.com>",
                recipient: "unsub@example.org",
                subject: "Sale unsubscribe notice",
                body: "Sale unsubscribe notice and offer"
              }),
              mediaType: "text/plain",
              imageDataUrl: octetDataUrl
            }
            ]
          }
        });

        expect(ingestResult).toMatchObject({
          batchId: "batch-marketing",
          receivedDocumentCount: 2,
          documentCount: 2,
          assetCount: 2
        });

        const db = openKnowledgeDb(storeRoot);
        try {
          const paths = db.prepare(
            "SELECT source_path, metadata_json FROM kc_documents ORDER BY source_path ASC"
          ).all();
          expect(paths.some((row) => String(row.source_path || "").includes("promo-positive.eml"))).toBe(true);
          expect(paths.some((row) => String(row.source_path || "").includes("promo-negative.msg"))).toBe(true);
        } finally {
          db.close();
        }

        const defaultMetricAggregate = mount.aggregate({
          metric: "email_advertising_by_sender",
          groupBy: "senderDomain",
          documentType: "email",
          query: "sale",
          limit: 10
        });
        expect(defaultMetricAggregate.filters).toMatchObject({
          categoryId: "marketing_promo",
          categoryPath: "marketing > promo"
        });
        expect(defaultMetricAggregate.topGroup?.key).toBe("example.com");
        expect(defaultMetricAggregate.matchedDocumentCount).toBeGreaterThanOrEqual(1);

        const explicitPathAggregate = mount.aggregate({
          metric: "engagement_report",
          categoryPath: "marketing > promo",
          groupBy: "recipientEmail",
          documentType: "email",
          query: "sale",
          limit: 10
        });
        expect(explicitPathAggregate.filters).toMatchObject({
          categoryId: "marketing_promo",
          categoryPath: "marketing > promo"
        });
        expect(explicitPathAggregate.topGroup?.key).toBe("promo.recipient@example.org");
        expect(explicitPathAggregate.matchedDocumentCount).toBeGreaterThanOrEqual(1);

        mount.getDocumentStructure({
          documentId: defaultMetricAggregate.topGroup?.examples?.[0]?.documentId || ""
        });
      }
    });
  });
});
