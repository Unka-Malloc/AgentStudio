import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { startHttpServer } from "../services/server-runtime/http-server.mjs";
import { createKnowledgeCoreMount } from "../platform/specialized/knowledge/storage/knowledge-core/index.mjs";
import { getMetadataDatabasePath } from "../platform/common/storage/schema-manager.mjs";
import { installAuthenticatedFetch } from "./test-auth-helper.mjs";

const mockDocumentParserModulePath = fileURLToPath(
  new URL("../../tests/server/mock-structured-document-parser.mjs", import.meta.url)
);
const mockPostCommitModulePath = fileURLToPath(
  new URL("../../tests/server/mock-knowledge-postcommit.mjs", import.meta.url)
);

function buildUploadedFile(name, relativePath, text) {
  const buffer = Buffer.from(text, "utf8");
  return {
    name,
    relativePath,
    mediaType: "message/rfc822",
    dataBase64: buffer.toString("base64"),
    byteSize: buffer.length
  };
}

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

function buildKnowledgeIntentDocument({ id, title, text, sourcePath }) {
  const documentId = `document::${id}`;
  const sectionId = `section::${id}`;
  return {
    documentId,
    collectionId: "intent-fixture",
    collectionTitle: "Intent Fixture",
    collectionType: "test",
    batchId: "intent-batch",
    sourceId: sourcePath,
    documentType: "email",
    title,
    summary: text,
    sourcePath,
    metadata: {
      source: "verify"
    },
    sections: [
      {
        sectionId,
        documentId,
        title: "正文",
        level: 1,
        position: 1,
        metadata: {}
      }
    ],
    blocks: [
      {
        blockId: `block::${id}`,
        documentId,
        sectionId,
        blockType: "text",
        title,
        text,
        snippet: text,
        position: 1,
        sourceLocator: {
          batchId: "intent-batch",
          sourcePath
        },
        metadata: {}
      }
    ],
    assets: []
  };
}

async function verifyBillingIntentSearch() {
  const directUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-knowledge-intent-"));
  const knowledgeCore = await createKnowledgeCoreMount({ userDataPath: directUserDataPath });
  try {
    knowledgeCore.upsertDocuments({
      documents: [
        buildKnowledgeIntentDocument({
          id: "billing",
          title: "Google Cloud 付费账号和 billing 设置",
          sourcePath: "mailbox/google-cloud-billing.eml",
          text: "您已升级为付费 Google Cloud 账号。请检查 billing account、payment profile 和发票抬头。"
        }),
        buildKnowledgeIntentDocument({
          id: "prime-ad",
          title: "Your Prime membership: discover eBooks and exclusive offers",
          sourcePath: "mailbox/prime-offers.eml",
          text: "Discover eBooks, magazines, Premier League highlights and exclusive offers in this promotional newsletter."
        }),
        buildKnowledgeIntentDocument({
          id: "prime-ad-variant-a",
          title: "Your Prime membership, YIZHUO YANG_ Discover new eBooks and magazines for £0.00 as well as other exclusive offers 8.eml",
          sourcePath: "mailbox/prime-offers-8.eml",
          text: "Discover eBooks, magazines and exclusive offers in this promotional newsletter."
        }),
        buildKnowledgeIntentDocument({
          id: "prime-ad-variant-b",
          title: "Your Prime membership, YIZHUO YANG_ Discover new eBooks and magazines for £0.00 as well as other exclusive offers 20.eml",
          sourcePath: "mailbox/prime-offers-20.eml",
          text: "Discover eBooks, magazines and exclusive offers in this promotional newsletter with a different tracker."
        }),
        buildKnowledgeIntentDocument({
          id: "payment-body",
          title: "Student tuition setup",
          sourcePath: "mailbox/student-tuition-setup.eml",
          text: "The student needs to set up payment installments for tuition before the deadline."
        }),
        buildKnowledgeIntentDocument({
          id: "security",
          title: "Your verification code for account login",
          sourcePath: "mailbox/security-code.eml",
          text: "Use this one-time verification code to complete your account sign-in. If this was not you, reset your password."
        })
      ]
    });
    const search = knowledgeCore.search({
      query: "账单",
      limit: 10,
      explain: true,
      learningEnabled: false
    });
    assert.equal(search.queryIntent.intentId, "billing");
    assert.ok(search.items.length > 0);
    assert.ok(search.items.some((item) => /Google Cloud|billing|付费/.test(item.title)));
    assert.ok(
      search.items.every((item) =>
        !/prime membership|exclusive offers|ebooks|magazines|premier league/i.test(
          `${item.title || ""}\n${item.snippet || ""}`
        )
      )
    );
    const specificMissSearch = knowledgeCore.search({
      query: "不存在的 Atlas 部署记录",
      limit: 10,
      explain: true,
      learningEnabled: false
    });
    assert.equal(specificMissSearch.items.length, 0);
    const paymentIntentSearch = knowledgeCore.search({
      query: "payment",
      limit: 10,
      explain: true,
      learningEnabled: false
    });
    assert.ok(paymentIntentSearch.items.some((item) => /Student tuition setup/i.test(item.title)));
    const promoSearch = knowledgeCore.search({
      query: "优惠",
      limit: 10,
      explain: true,
      learningEnabled: false
    });
    assert.equal(promoSearch.queryIntent.intentId, "marketing_promo");
    assert.ok(promoSearch.items.some((item) => /Prime membership|exclusive offers|ebooks|magazines/i.test(item.title)));
    assert.equal(
      promoSearch.items.filter((item) => /Discover new eBooks and magazines for £0\.00/i.test(item.title)).length,
      1
    );
    assert.ok(
      promoSearch.items.every((item) =>
        !/Google Cloud|billing account|发票|付费/i.test(`${item.title || ""}\n${item.snippet || ""}`)
      )
    );
    const securitySearch = knowledgeCore.search({
      query: "验证码",
      limit: 10,
      explain: true,
      learningEnabled: false
    });
    assert.equal(securitySearch.queryIntent.intentId, "account_security");
    assert.ok(securitySearch.items.some((item) => /verification code|account login/i.test(item.title)));
    assert.ok(
      securitySearch.items.every((item) =>
        !/exclusive offers|ebooks|magazines|premier league/i.test(`${item.title || ""}\n${item.snippet || ""}`)
      )
    );
    const taxonomyPath = path.join(directUserDataPath, "rules", "knowledge-taxonomy.json");
    const taxonomy = JSON.parse(await fs.readFile(taxonomyPath, "utf8"));
    const billingCategory = taxonomy.categories.find((entry) => entry.categoryId === "billing");
    assert.ok(billingCategory);
    billingCategory.queryTriggers = ["taxonomy-hot-reload-billing-disabled"];
    await new Promise((resolve) => setTimeout(resolve, 10));
    await fs.writeFile(taxonomyPath, `${JSON.stringify(taxonomy, null, 2)}\n`, "utf8");
    const reloadedSearch = knowledgeCore.search({
      query: "账单",
      limit: 10,
      explain: true,
      learningEnabled: false
    });
    assert.equal(reloadedSearch.queryIntent, null);

    const expertVocabularyPath = path.join(directUserDataPath, "rules", "expert-vocabulary.json");
    const expertVocabulary = JSON.parse(await fs.readFile(expertVocabularyPath, "utf8"));
    expertVocabulary.entries = [
      ...(expertVocabulary.entries || []),
      {
        pathSegments: ["测试", "专家词汇", "动态检索"],
        keywords: ["蓝色凭证测试词"],
        domains: [],
        status: "active",
        notes: "verify runtime guidance from expert-vocabulary.json"
      }
    ];
    expertVocabulary.version = Number(expertVocabulary.version || 1) + 1;
    expertVocabulary.updatedAt = new Date().toISOString();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await fs.writeFile(expertVocabularyPath, `${JSON.stringify(expertVocabulary, null, 2)}\n`, "utf8");
    knowledgeCore.upsertDocuments({
      documents: [
        buildKnowledgeIntentDocument({
          id: "expert-vocabulary-runtime",
          title: "蓝色凭证测试词 运行时专家词汇",
          sourcePath: "mailbox/expert-vocabulary-runtime.eml",
          text: "这是一条用于验证专家词汇库动态接入检索意图的资料。"
        })
      ]
    });
    const expertSearch = knowledgeCore.search({
      query: "蓝色凭证测试词",
      limit: 5,
      explain: true,
      learningEnabled: false
    });
    assert.equal(expertSearch.queryIntent.taxonomyPath, "测试/专家词汇/动态检索");
    assert.ok(expertSearch.items.some((item) => /专家词汇/.test(item.title)));

    const emailRulesPath = path.join(directUserDataPath, "rules", "email-rules.json");
    const emailRules = JSON.parse(await fs.readFile(emailRulesPath, "utf8"));
    emailRules.synonymDictionary = [
      ...(emailRules.synonymDictionary || []),
      {
        canonical: "开票动态规则",
        terms: ["青蓝开具测试词"]
      }
    ];
    emailRules.updatedAt = new Date().toISOString();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await fs.writeFile(emailRulesPath, `${JSON.stringify(emailRules, null, 2)}\n`, "utf8");
    knowledgeCore.upsertDocuments({
      documents: [
        buildKnowledgeIntentDocument({
          id: "email-rules-runtime",
          title: "青蓝开具测试词 运行时邮件规则",
          sourcePath: "mailbox/email-rules-runtime.eml",
          text: "这是一条用于验证邮件规则库同义词动态接入检索意图的资料。"
        })
      ]
    });
    const rulesSearch = knowledgeCore.search({
      query: "青蓝开具测试词",
      limit: 5,
      explain: true,
      learningEnabled: false
    });
    assert.equal(rulesSearch.queryIntent.taxonomyPath, "邮件规则/同义词/开票动态规则");
    assert.ok(rulesSearch.items.some((item) => /邮件规则/.test(item.title)));

    const firstDuplicateIngest = await knowledgeCore.ingestSources({
      batchId: "dedupe-a",
      sources: [
        {
          id: "duplicate-source-a",
          kind: "email",
          name: "铜色账款唯一词 2.eml",
          path: "mailbox/铜色账款唯一词 2.eml",
          mediaType: "message/rfc822",
          rawObjectSha256: "verify-duplicate-source-hash",
          text: "铜色账款唯一词 payment receipt"
        }
      ]
    });
    assert.equal(firstDuplicateIngest.documentCount, 1);
    const secondDuplicateIngest = await knowledgeCore.ingestSources({
      batchId: "dedupe-b",
      sources: [
        {
          id: "duplicate-source-b",
          kind: "email",
          name: "铜色账款唯一词.eml",
          path: "mailbox/铜色账款唯一词.eml",
          mediaType: "message/rfc822",
          rawObjectSha256: "verify-duplicate-source-hash",
          text: "铜色账款唯一词 payment receipt"
        }
      ]
    });
    assert.equal(secondDuplicateIngest.documentCount, 0);
    assert.equal(secondDuplicateIngest.skippedConflictCount, 1);
    assert.equal(secondDuplicateIngest.reviewItems[0].reason, "duplicate_source_document");
    const duplicateSearch = knowledgeCore.search({
      query: "铜色账款唯一词",
      limit: 10,
      explain: true,
      learningEnabled: false
    });
    assert.equal(duplicateSearch.items.length, 1);
    assert.equal(duplicateSearch.items[0].title, "铜色账款唯一词 2.eml");

    const sameBatchDuplicateIngest = await knowledgeCore.ingestSources({
      batchId: "dedupe-same-batch",
      sources: [
        {
          id: "same-batch-duplicate-a",
          kind: "email",
          name: "银色账款唯一词 2.eml",
          path: "mailbox/银色账款唯一词 2.eml",
          mediaType: "message/rfc822",
          rawObjectSha256: "verify-same-batch-duplicate-source-hash",
          text: "银色账款唯一词 invoice receipt"
        },
        {
          id: "same-batch-duplicate-b",
          kind: "email",
          name: "银色账款唯一词.eml",
          path: "mailbox/银色账款唯一词.eml",
          mediaType: "message/rfc822",
          rawObjectSha256: "verify-same-batch-duplicate-source-hash",
          text: "银色账款唯一词 invoice receipt"
        }
      ]
    });
    assert.equal(sameBatchDuplicateIngest.documentCount, 1);
    assert.equal(sameBatchDuplicateIngest.deduplicatedIncomingCount, 1);
    assert.equal(sameBatchDuplicateIngest.skippedConflictCount, 1);
    assert.equal(sameBatchDuplicateIngest.reviewItems[0].reason, "duplicate_source_document");

    await knowledgeCore.ingestSources({
      batchId: "keyword-noise",
      sources: [
        {
          id: "header-noise",
          kind: "email",
          name: "Header Metadata Noise.eml",
          path: "mailbox/header-metadata-noise.eml",
          mediaType: "message/rfc822",
          rawObjectSha256: "verify-header-noise-source-hash",
          text: "<html><head><meta name=\"x-ms\" content=\"needlepaymentreceipt\"></head><body>ordinary newsletter without target facts</body></html>"
        },
        {
          id: "image-resource-noise",
          kind: "email",
          name: "Image Resource Noise.eml",
          path: "mailbox/image-resource-noise.eml",
          mediaType: "message/rfc822",
          rawObjectSha256: "verify-image-resource-noise-source-hash",
          text: "<html><body><img src=\"https://cdn.example.test/assets/needlepaymentimage.png\">ordinary newsletter without target facts</body></html>"
        },
        {
          id: "body-match",
          kind: "email",
          name: "Real Payment Receipt.eml",
          path: "mailbox/real-payment-receipt.eml",
          mediaType: "message/rfc822",
          rawObjectSha256: "verify-body-payment-source-hash",
          text: "<html><body>needlepaymentreceipt is ready.</body></html>"
        }
      ]
    });
    const paymentSearch = knowledgeCore.search({
      query: "needlepaymentreceipt",
      limit: 5,
      explain: true,
      learningEnabled: false
    });
    assert.ok(paymentSearch.items.length > 0);
    assert.equal(paymentSearch.items[0].title, "Real Payment Receipt.eml");
    assert.ok(!paymentSearch.items.some((item) => item.title === "Header Metadata Noise.eml"));
    const imageResourceSearch = knowledgeCore.search({
      query: "needlepaymentimage",
      limit: 5,
      explain: true,
      learningEnabled: false
    });
    assert.ok(!imageResourceSearch.items.some((item) => item.title === "Image Resource Noise.eml"));
  } finally {
    await knowledgeCore.close();
    await fs.rm(directUserDataPath, {
      recursive: true,
      force: true
    });
  }
}

async function verifyKnowledgeIngestConflictReview() {
  const directUserDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-knowledge-conflict-"));
  const knowledgeCore = await createKnowledgeCoreMount({ userDataPath: directUserDataPath });
  try {
    const first = await knowledgeCore.ingestSources({
      batchId: "conflict-batch-a",
      sources: [
        {
          id: "policy-a",
          kind: "text",
          name: "policy.txt",
          path: "shared/policy.txt",
          originalRelativePath: "shared/policy.txt",
          text: "Original policy version with needleoriginalpolicy."
        }
      ]
    });
    assert.equal(first.documentCount, 1);
    assert.equal(first.skippedConflictCount, 0);

    const second = await knowledgeCore.ingestSources({
      batchId: "conflict-batch-b",
      sources: [
        {
          id: "policy-b",
          kind: "text",
          name: "policy.txt",
          path: "shared/policy.txt",
          originalRelativePath: "shared/policy.txt",
          text: "Updated policy version with needleupdatedpolicy."
        }
      ]
    });
    assert.equal(second.documentCount, 0);
    assert.equal(second.skippedConflictCount, 1);
    assert.equal(second.reviewItems[0].reason, "source_path_content_conflict");

    const pending = await knowledgeCore.listReviewItems({ status: "pending" });
    assert.equal(pending.items.length, 1);
    assert.equal(pending.items[0].reason, "source_path_content_conflict");

    const resolved = await knowledgeCore.resolveReviewItem({
      reviewId: pending.items[0].reviewId,
      resolution: "replace"
    });
    assert.equal(resolved.status, "resolved");

    const search = await knowledgeCore.search({
      query: "needleupdatedpolicy",
      limit: 5,
      learningEnabled: false
    });
    assert.ok(search.items.length > 0);
    assert.ok(search.items.some((item) => item.title === "policy.txt"));
  } finally {
    await knowledgeCore.close();
    await fs.rm(directUserDataPath, {
      recursive: true,
      force: true
    });
  }
}

const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-knowledge-"));
await verifyBillingIntentSearch();
await verifyKnowledgeIngestConflictReview();
const server = await startHttpServer({
  userDataPath,
  runtimeOptions: {
    mountModules: {
      documentParser: mockDocumentParserModulePath,
      knowledgeBase: mockPostCommitModulePath,
      vectorStore: mockPostCommitModulePath,
      graphStore: mockPostCommitModulePath
    }
  }
});
await installAuthenticatedFetch(server);

try {
  const createdJob = await fetchJson(`${server.url}/api/jobs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      uploadedFiles: [
        buildUploadedFile(
          "contract-renewal.eml",
          "mailbox/contract-renewal.eml",
          [
            "From: Alice Chen <alice@contoso.com>",
            "To: Bob Li <bob@contoso.com>, Cathy Wu <cathy@vendor.io>",
            "Subject: 合同续签推进",
            "Date: Tue, 28 Apr 2026 09:00:00 +0000",
            "Message-ID: <contract-renewal@contoso.com>",
            "",
            "预算已经确认，按最新报价执行。",
            "待确认事项包括盖章顺序和发票抬头。",
            "请 Cathy 最终确认发票抬头，Alice 安排盖章。"
          ].join("\n")
        ),
        buildUploadedFile(
          "contract-followup.eml",
          "mailbox/contract-followup.eml",
          [
            "From: Bob Li <bob@contoso.com>",
            "To: Alice Chen <alice@contoso.com>",
            "Subject: Re: 合同续签推进",
            "Date: Tue, 28 Apr 2026 10:00:00 +0000",
            "In-Reply-To: <contract-renewal@contoso.com>",
            "References: <contract-renewal@contoso.com>",
            "",
            "预算条目已核对完成。",
            "如果发票抬头确认，今天可以进入合同盖章。"
          ].join("\n")
        ),
        buildUploadedFile(
          "prime-offers.eml",
          "mailbox/prime-offers.eml",
          [
            "From: Amazon Offers <amazon-offers@example.com>",
            "To: Bob Li <bob@contoso.com>",
            "Subject: Your Prime membership: discover eBooks and exclusive offers",
            "Date: Tue, 28 Apr 2026 11:00:00 +0000",
            "Message-ID: <prime-offers@example.com>",
            "",
            "Discover new eBooks, magazines, Premier League highlights and exclusive offers.",
            "This promotional newsletter is only about entertainment benefits."
          ].join("\n")
        )
      ],
      settings: {}
    })
  });

  await waitForJob(server.url, createdJob.id);
  const result = await fetchJson(`${server.url}/api/jobs/${createdJob.id}/result`);
  assert.equal(result.preprocess?.resultType, "pact.agentLibrary.preprocess-result");
  assert.ok(result.preprocess.blocks.length > 0);
  assert.ok(result.preprocess.chunks.length > 0);
  assert.equal(result.preprocess.counts.sources, result.sourceFiles.length);
  const storageSummary = await fetchJson(`${server.url}/api/storage/summary`);
  assert.ok(storageSummary.preprocessBlockCount >= result.preprocess.counts.blocks);
  assert.ok(storageSummary.preprocessChunkCount >= result.preprocess.counts.chunks);
  assert.ok(storageSummary.sourceVocabularyTermCount > 0);
  assert.ok(storageSummary.sourceVocabularyTotalFrequency >= storageSummary.sourceVocabularyTermCount);
  const metadataDb = new Database(getMetadataDatabasePath(userDataPath), {
    readonly: true
  });
  try {
    const contractTerm = metadataDb
      .prepare("SELECT frequency FROM source_vocabulary_terms WHERE term = ?")
      .get("合同");
    assert.ok(contractTerm?.frequency > 0);
  } finally {
    metadataDb.close();
  }
  assert.ok(result.knowledge);
  assert.ok(result.knowledge.items.length > 0);
  assert.ok(result.knowledge.chunks.length > 0);
  assert.ok(result.knowledge.graph.nodes.length > 0);

  for (const mountName of ["knowledgeBase", "vectorStore", "graphStore"]) {
    const record = JSON.parse(
      await fs.readFile(path.join(userDataPath, `postcommit-${mountName}.json`), "utf8")
    );
    assert.equal(record.batchId, createdJob.archiveBatchId);
    assert.ok(record.itemCount > 0);
  }

  const sync = await fetchJson(`${server.url}/api/knowledge/sync?since=0`);
  assert.ok(Number(sync.cursor) > 0);
  assert.ok(sync.changes.some((change) => change.kind === "item"));
  assert.equal(sync.cachePolicy.storesNormalizedDocuments, false);

  const emptySync = await fetchJson(`${server.url}/api/knowledge/sync?since=${sync.cursor}`);
  assert.equal(emptySync.changes.length, 0);

  const search = await fetchJson(`${server.url}/api/knowledge/search`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      query: "合同",
      itemTypes: ["transaction"],
      limit: 5
    })
  });
  assert.ok(search.items.length > 0);
  const target = search.items[0];
  assert.equal(target.itemType, "transaction");

  const detail = await fetchJson(
    `${server.url}/api/knowledge/items/${encodeURIComponent(target.itemId)}`
  );
  assert.equal(detail.itemId, target.itemId);
  assert.ok(detail.revision >= 1);

  const graph = await fetchJson(
    `${server.url}/api/knowledge/graph?seed=${encodeURIComponent(target.itemId)}&depth=1`
  );
  assert.ok(graph.nodes.length >= 1);

  const accepted = await fetchJson(`${server.url}/api/knowledge/changes`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      changes: [
        {
          operationId: "op-accepted",
          entityId: target.itemId,
          entityType: target.itemType,
          baseRevision: detail.revision,
          fieldPatch: {
            status: "watch",
            tags: ["离线结构化编辑"]
          },
          clientId: "verify-client",
          createdAt: "2026-04-28T00:00:00.000Z"
        }
      ]
    })
  });
  assert.equal(accepted.accepted.length, 1);
  assert.equal(accepted.accepted[0].item.status, "watch");

  const conflicted = await fetchJson(`${server.url}/api/knowledge/changes`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      changes: [
        {
          operationId: "op-conflict",
          entityId: target.itemId,
          entityType: target.itemType,
          baseRevision: detail.revision,
          fieldPatch: {
            status: "closed"
          },
          clientId: "verify-client",
          createdAt: "2026-04-28T00:01:00.000Z"
        }
      ]
    })
  });
  assert.equal(conflicted.conflicts.length, 1);
  assert.equal(conflicted.conflicts[0].reviewItem.reason, "revision_conflict");

  const reviewItems = await fetchJson(`${server.url}/api/knowledge/review-items`);
  assert.ok(reviewItems.items.length >= 1);
  const reviewId = conflicted.conflicts[0].reviewItem.reviewId;
  const resolved = await fetchJson(
    `${server.url}/api/knowledge/review-items/${encodeURIComponent(reviewId)}/resolve`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        resolution: "reject"
      })
    }
  );
  assert.equal(resolved.status, "rejected");
} finally {
  await server.close();
  await fs.rm(userDataPath, {
    recursive: true,
    force: true
  });
}

console.log("Knowledge kernel verification passed.");
