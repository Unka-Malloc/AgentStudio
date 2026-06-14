import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createKnowledgeCoreMount } from "../platform/specialized/knowledge/storage/knowledge-core/index.mjs";

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function buildLongDocument({ sourcePath }) {
  const documentId = "doc::outline-march-billing";
  const sectionId = "section::outline-root";
  const headings = [
    ["March Billing Overview", "March invoice package includes cloud invoice, card charge, approval owner and vendor billing profile."],
    ["Payment Schedule", "Payment schedule states that the March billing run closes on March 28 and the final invoice is due April 5."],
    ["Vendor Contact", "Vendor contact for billing questions is finance-ops@example.test with purchase order PO-2026-03."],
    ["Renewal Risk", "Renewal risk is low if finance confirms payment profile before the due date."],
    ["Approval Chain", "Approval chain requires project owner, finance reviewer and procurement reviewer."],
    ["Drive Attachment", "Drive attachment contains the PDF invoice and the reconciliation workbook."],
    ["Slack Reminder", "Slack reminder asked the team to confirm March bill ownership in the finance channel."],
    ["Outlook Mail Thread", "Outlook mail thread contains the same invoice number and payment schedule."],
    ["Local Folder Mirror", "Local folder mirror stores the original bill PDF without metadata mutation."],
    ["Exception Handling", "Exception handling requires manual review if source hash changes after sync."],
    ["Audit Evidence", "Audit evidence must preserve source application, external id and sync batch id."],
    ["Closure", "Closure is complete when the invoice is paid and the approval comment is recorded."]
  ];
  return {
    documentId,
    collectionId: "collection::outline",
    collectionTitle: "Outline Fixtures",
    batchId: "batch::outline",
    sourceId: "source::march-billing",
    documentType: "document",
    title: "March Billing Cross Source Packet",
    summary: "Long fixture used to verify PageIndex-style outline routing inside KnowledgeCore.",
    sourcePath,
    sourceHash: "",
    metadata: {
      sourceType: "local-folder",
      providerId: "fixture",
      originalFileName: "march-billing.md"
    },
    sections: [
      {
        sectionId,
        documentId,
        title: "Body",
        level: 1,
        position: 1,
        metadata: {
          summary: "Coarse root section that should be refined by DocumentOutlineRuntime."
        }
      }
    ],
    blocks: headings.map(([title, text], index) => ({
      blockId: `block::outline::${index + 1}`,
      documentId,
      sectionId,
      blockType: "text",
      title,
      text: [`# ${title}`, "", text].join("\n"),
      snippet: text,
      position: index + 1,
      sourceLocator: {
        blockIndex: index + 1
      },
      metadata: {}
    })),
    assets: []
  };
}

const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-knowledge-outline-"));
const sourcePath = path.join(userDataPath, "source", "march-billing.md");
const sourceBytes = Buffer.from([
  "# March Billing Cross Source Packet",
  "",
  "This source file is a fixture. KnowledgeCore must not rewrite this file while building outline metadata."
].join("\n"));
await fs.mkdir(path.dirname(sourcePath), { recursive: true });
await fs.writeFile(sourcePath, sourceBytes);
const beforeHash = sha256(await fs.readFile(sourcePath));

const knowledgeCore = await createKnowledgeCoreMount({ userDataPath });

try {
  const upsert = knowledgeCore.upsertDocuments({
    collectionId: "collection::outline",
    documents: [buildLongDocument({ sourcePath })]
  });
  assert.equal(upsert.protocolVersion, "v0.0.1:knowledge:core-1");
  assert.equal(upsert.documentCount, 1);

  const structure = knowledgeCore.getDocumentStructure({
    documentId: "doc::outline-march-billing",
    maxNodes: 80
  });
  assert.equal(structure.protocolVersion, "v0.0.1:knowledge:core-1");
  assert.equal(structure.document.documentId, "doc::outline-march-billing");
  assert.ok(structure.tree.length >= 1);
  assert.ok(structure.sourceStats.outlineNodeCount >= 8);
  assert.ok(structure.sourceStats.syntheticNodeCount >= 8);
  assert.ok(structure.nodes.every((node) => node.text === undefined));
  assert.ok(structure.nodes.every((node) => node.sourceRange && typeof node.sourceRange === "object"));

  const paymentNode = structure.nodes.find((node) => /Payment Schedule/i.test(node.title));
  assert.ok(paymentNode, "expected Payment Schedule outline node");
  assert.equal(paymentNode.quality.synthetic, true);
  assert.ok(paymentNode.sourceRange.blockStart > 0);
  assert.ok(paymentNode.sourceRange.blockEnd >= paymentNode.sourceRange.blockStart);

  const defaultSearch = knowledgeCore.search({
    query: "payment schedule final invoice",
    limit: 4,
    explain: true,
    hierarchyReasoning: false
  });
  assert.equal(defaultSearch.hierarchy.reasoning.enabled, false);

  const reasoningSearch = knowledgeCore.search({
    query: "payment schedule final invoice",
    limit: 4,
    explain: true,
    hierarchyReasoning: true
  });
  assert.equal(reasoningSearch.hierarchy.reasoning.enabled, true);
  assert.equal(reasoningSearch.hierarchy.reasoning.usedModel, false);
  assert.ok(reasoningSearch.hierarchy.selected.outlines.length >= 1);
  assert.ok(reasoningSearch.items.length >= 1);
  assert.ok(reasoningSearch.items[0].hierarchy?.outlineRoute);

  let modelCalls = 0;
  const modelDecision = await knowledgeCore.prepareHierarchyReasoning({
    query: "payment schedule",
    modelEnabled: true,
    modelDecisionRuntime: {
      decide: async () => {
        modelCalls += 1;
        return {
          usedModel: true,
          degraded: false,
          decision: {
            selectedNodeIds: [paymentNode.hierarchyId],
            nodeScores: {
              [paymentNode.hierarchyId]: 0.99
            },
            reason: "mock router selected payment schedule",
            confidence: 0.99
          }
        };
      }
    }
  });
  assert.equal(modelCalls, 1);
  assert.equal(modelDecision.usedModel, true);
  assert.deepEqual(modelDecision.selectedNodeIds, [paymentNode.hierarchyId]);

  const modelSearch = knowledgeCore.search({
    query: "payment schedule",
    limit: 3,
    hierarchyReasoning: true,
    hierarchyReasoningDecision: modelDecision
  });
  assert.equal(modelSearch.hierarchy.reasoning.usedModel, true);
  assert.ok(
    modelSearch.items.some((item) => item.hierarchy?.outlineRoute?.hierarchyId === paymentNode.hierarchyId),
    "mock-selected outline should route at least one returned evidence item"
  );

  const degradedDecision = await knowledgeCore.prepareHierarchyReasoning({
    query: "payment schedule",
    modelEnabled: true,
    modelDecisionRuntime: {
      decide: async () => {
        throw new Error("mock unavailable");
      }
    }
  });
  assert.equal(degradedDecision.degraded, true);
  assert.equal(degradedDecision.usedModel, false);
  const degradedSearch = knowledgeCore.search({
    query: "payment schedule",
    limit: 3,
    hierarchyReasoning: true,
    hierarchyReasoningDecision: degradedDecision
  });
  assert.ok(degradedSearch.items.length >= 1);

  const afterHash = sha256(await fs.readFile(sourcePath));
  assert.equal(afterHash, beforeHash);
} finally {
  knowledgeCore.close();
  await fs.rm(userDataPath, { recursive: true, force: true });
}
