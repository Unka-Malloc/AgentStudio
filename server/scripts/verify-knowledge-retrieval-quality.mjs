import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createKnowledgeCoreMount } from "../platform/specialized/knowledge/storage/knowledge-core/index.mjs";

function buildDocument({ id, title, text, sourceId = "quality-source" }) {
  const documentId = `quality-document::${id}`;
  const sectionId = `quality-section::${id}`;
  return {
    documentId,
    collectionId: "quality-fixture",
    collectionTitle: "Retrieval Quality Fixture",
    collectionType: "test",
    batchId: "quality-batch",
    sourceId,
    documentType: "note",
    title,
    summary: text,
    sourcePath: `${sourceId}/${id}.md`,
    metadata: {
      source: "verify-retrieval-quality"
    },
    sections: [
      {
        sectionId,
        documentId,
        title: "Body",
        level: 1,
        position: 1,
        metadata: {}
      }
    ],
    blocks: [
      {
        blockId: `quality-block::${id}`,
        documentId,
        sectionId,
        blockType: "text",
        title,
        text,
        snippet: text,
        position: 1,
        sourceLocator: {
          batchId: "quality-batch",
          sourceId,
          sourcePath: `${sourceId}/${id}.md`
        },
        metadata: {}
      }
    ],
    assets: []
  };
}

function evaluateCases(cases = []) {
  const k = Math.max(1, Math.max(...cases.map((item) => Number(item.k || 0)), 1));
  let recallSum = 0;
  let reciprocalRankSum = 0;
  let top1Hits = 0;
  const caseResults = cases.map((testCase) => {
    const expected = new Set(testCase.expectedDocumentIds || []);
    const ranked = testCase.result.items.map((item) => item.documentId);
    const foundRanks = ranked
      .map((documentId, index) => expected.has(documentId) ? index + 1 : 0)
      .filter(Boolean);
    const recall = expected.size
      ? [...expected].filter((documentId) => ranked.includes(documentId)).length / expected.size
      : 1;
    const reciprocalRank = foundRanks.length ? 1 / Math.min(...foundRanks) : 0;
    const top1 = Boolean(ranked[0] && expected.has(ranked[0]));
    recallSum += recall;
    reciprocalRankSum += reciprocalRank;
    if (top1) {
      top1Hits += 1;
    }
    return {
      caseId: testCase.caseId,
      query: testCase.query,
      k,
      expectedDocumentIds: [...expected],
      rankedDocumentIds: ranked,
      recallAtK: recall,
      reciprocalRank,
      top1
    };
  });
  return {
    caseCount: caseResults.length,
    metrics: {
      recallAtK: Number((recallSum / Math.max(1, caseResults.length)).toFixed(6)),
      mrrAtK: Number((reciprocalRankSum / Math.max(1, caseResults.length)).toFixed(6)),
      top1Accuracy: Number((top1Hits / Math.max(1, caseResults.length)).toFixed(6))
    },
    caseResults
  };
}

const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-knowledge-retrieval-quality-"));
const knowledgeCore = await createKnowledgeCoreMount({ userDataPath });

try {
  const exactDocumentId = "quality-document::omega-exact";
  const hierarchyDocumentId = "quality-document::retention-escalation";
  const identifierDocumentId = "quality-document::agent-context-hot-swap";
  await knowledgeCore.upsertDocuments({
    documents: [
      buildDocument({
        id: "omega-exact",
        sourceId: "workspace-alpha",
        title: "Omega exact renewal approval runbook",
        text: [
          "omega renewal finance approval invoice title",
          "The renewal runbook says finance approval must happen before invoice title confirmation."
        ].join(" ")
      }),
      buildDocument({
        id: "omega-scattered",
        sourceId: "workspace-alpha",
        title: "Omega scattered finance newsletter",
        text: [
          "omega customer newsletter about renewal reminders.",
          "The finance department published an approval calendar.",
          "Invoice title examples appear in a separate appendix."
        ].join(" ")
      }),
      buildDocument({
        id: "omega-denied",
        sourceId: "workspace-denied",
        title: "Workspace denied omega renewal finance approval invoice title",
        text: "omega renewal finance approval invoice title appears here but belongs to a denied workspace."
      }),
      buildDocument({
        id: "retention-escalation",
        sourceId: "workspace-hierarchy",
        title: "Retention escalation owner timeline",
        text: "retention escalation owner timeline maps customer risk, next owner, and response window."
      }),
      buildDocument({
        id: "general-noise",
        sourceId: "workspace-alpha",
        title: "General operating notes",
        text: "team lunch notes and release checklist without the target retrieval facts."
      }),
      buildDocument({
        id: "agent-context-hot-swap",
        sourceId: "workspace-alpha",
        title: "AgentContextHotSwapProtocol",
        text: [
          "AgentContextHotSwapProtocol",
          "Enterprise operators use this internal identifier for live workspace state switching."
        ].join(" ")
      }),
      buildDocument({
        id: "agent-context-scattered",
        sourceId: "workspace-alpha",
        title: "Agent context workshop notes",
        text: [
          "An agent context meeting discussed unrelated workspace plans.",
          "Hot deployment and swap windows were listed in another checklist.",
          "Protocol ownership was mentioned in a distant appendix."
        ].join(" ")
      })
    ]
  });

  const exactSearch = knowledgeCore.search({
    query: "omega renewal finance approval invoice title",
    sourceIds: ["workspace-alpha"],
    limit: 3,
    explain: true,
    learningEnabled: false
  });
  assert.equal(exactSearch.items[0].documentId, exactDocumentId);
  assert.ok(
    exactSearch.items[0].reasons.some((reason) =>
      reason.kind === "query-match-quality" && reason.exactPhrase === true
    ),
    "top result must expose query-match-quality exact phrase evidence"
  );
  assert.ok(!exactSearch.items.some((item) => item.documentId === "quality-document::omega-denied"));

  const hierarchySearch = knowledgeCore.search({
    query: "retention escalation owner timeline",
    sourceIds: ["workspace-hierarchy"],
    hierarchyReasoning: true,
    limit: 3,
    explain: true,
    learningEnabled: false
  });
  assert.equal(hierarchySearch.items[0].documentId, hierarchyDocumentId);
  assert.equal(hierarchySearch.hierarchy.reasoning.enabled, true);
  assert.ok(hierarchySearch.hierarchy.selected.documents.length >= 1);

  const identifierSearch = knowledgeCore.search({
    query: "agent context hot swap protocol",
    sourceIds: ["workspace-alpha"],
    limit: 5,
    explain: true,
    learningEnabled: false
  });
  assert.equal(identifierSearch.items[0].documentId, identifierDocumentId);
  assert.ok(
    identifierSearch.items[0].reasons.some((reason) =>
      reason.kind === "token-like" || reason.kind === "query-match-quality"
    ),
    "identifier query must expose token-like or query quality evidence"
  );

  const quality = evaluateCases([
    {
      caseId: "exact-phrase-ranking",
      query: exactSearch.query,
      expectedDocumentIds: [exactDocumentId],
      result: exactSearch,
      k: 3
    },
    {
      caseId: "hierarchy-routing",
      query: hierarchySearch.query,
      expectedDocumentIds: [hierarchyDocumentId],
      result: hierarchySearch,
      k: 3
    },
    {
      caseId: "camelcase-identifier-token-like",
      query: identifierSearch.query,
      expectedDocumentIds: [identifierDocumentId],
      result: identifierSearch,
      k: 5
    }
  ]);
  assert.equal(quality.metrics.recallAtK, 1);
  assert.equal(quality.metrics.mrrAtK, 1);
  assert.equal(quality.metrics.top1Accuracy, 1);

  process.stdout.write(`${JSON.stringify({
    ok: true,
    protocolVersion: "v0.0.1:knowledge:retrieval-quality-1",
    metrics: quality.metrics,
    caseCount: quality.caseCount,
    cases: quality.caseResults.map((item) => ({
      caseId: item.caseId,
      recallAtK: item.recallAtK,
      reciprocalRank: item.reciprocalRank,
      top1: item.top1
    }))
  }, null, 2)}\n`);
} finally {
  await knowledgeCore.close();
  await fs.rm(userDataPath, {
    recursive: true,
    force: true
  });
}
