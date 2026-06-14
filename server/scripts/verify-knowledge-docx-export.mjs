import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { generateNormalizedDocuments } from "../platform/specialized/knowledge/preprocessing/file-processor/FileNormalizer/NormalizedDocuments/index.mjs";
import { createKnowledgeCoreMount } from "../platform/specialized/knowledge/storage/knowledge-core/index.mjs";

function docxFiles(buffer) {
  return unzipSync(new Uint8Array(buffer));
}

function docxXml(buffer) {
  const files = docxFiles(buffer);
  const documentXml = files["word/document.xml"];
  assert.ok(documentXml, "DOCX must contain word/document.xml");
  return strFromU8(documentXml);
}

function docxParagraphs(buffer) {
  const xml = docxXml(buffer);
  return {
    xml,
    paragraphs: [...xml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)].map((match) => {
      const paragraphXml = match[0];
      const styleMatch = /<w:pStyle\b[^>]*w:val="([^"]+)"/.exec(paragraphXml);
      const text = [...paragraphXml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
        .map((entry) => entry[1])
        .join("");
      return {
        xml: paragraphXml,
        style: styleMatch?.[1] || "",
        text
      };
    })
  };
}

function assertParagraphWithStyle(buffer, style, text, message) {
  const { paragraphs } = docxParagraphs(buffer);
  assert.ok(
    paragraphs.some((paragraph) => paragraph.style === style && paragraph.text.includes(text)),
    message || `DOCX must include ${text} with style ${style}`
  );
}

function assertBulletParagraph(buffer, text, message) {
  const { paragraphs } = docxParagraphs(buffer);
  assert.ok(
    paragraphs.some((paragraph) => paragraph.text.includes(text) && (
      paragraph.style === "ListParagraph" || /<w:numPr\b/.test(paragraph.xml)
    )),
    message || `DOCX must include list semantics for ${text}`
  );
}

function assertDocxIncludes(buffer, needle, message) {
  const xml = docxXml(buffer);
  assert.equal(xml.includes(needle), true, message || `DOCX must include ${needle}`);
}

function assertDocxNotIncludes(buffer, needle, message) {
  const xml = docxXml(buffer);
  assert.equal(xml.includes(needle), false, message || `DOCX must not include ${needle}`);
}

async function assertNormalizedHumanDocxAndYamlMachineState() {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-normalized-docx-"));
  const jobId = "normalized-docx-export";
  const markdownText = [
    "# 客户续费",
    "",
    "## 背景",
    "背景证据正文。",
    "",
    "- 法务确认合同条款",
    "- 补齐预算审批记录",
    "",
    "| 项目 | 状态 |",
    "| --- | --- |",
    "| 合同 | 待确认 |",
    "| 预算 | 已提交 |"
  ].join("\n");
  const manifest = await generateNormalizedDocuments({
    userDataPath,
    jobId,
    generatedAt: "2026-05-17T00:00:00.000Z",
    sources: [
      {
        id: "source-md",
        name: "renewal.md",
        path: "fixtures/renewal.md",
        kind: "document",
        mediaType: "text/markdown",
        text: markdownText,
        documentParserId: "verify"
      }
    ],
    chunks: [
      {
        id: "chunk-background",
        sourceId: "source-md",
        sectionId: "section-background",
        titlePath: ["客户续费", "背景"],
        content: "背景证据正文。",
        sourceRange: { startLine: 3, endLine: 4 },
        sourceStartLine: 3,
        sourceEndLine: 4,
        metadata: {
          strategy: "markdown-section-v1",
          preservesSectionBoundary: true
        }
      }
    ],
    analysis: {
      emails: [
        {
          id: "email-null-sender",
          sourceId: "email-null-sender",
          subject: "Null sender metadata",
          from: null,
          to: [null, { name: "Ops", address: "ops@example.test" }],
          cc: [null],
          sentAt: "2026-05-17T01:00:00.000Z",
          messageIdHeader: "<null-sender@example.test>",
          excerpt: "Email metadata can contain null participants.",
          body: "Email metadata can contain null participants."
        }
      ],
      threads: [],
      transactions: [],
      timeline: []
    }
  });

  assert.equal(manifest.packageType, "pact.normalized-documents");
  assert.equal(manifest.packageRole, "external-knowledge-corpus");
  assert.equal(manifest.architecture.corpusExport.format, "docx");
  assert.equal(manifest.humanReadable.format, "docx");
  assert.equal(manifest.machineReadable.format, "yaml");
  assert.equal(manifest.architecture.agentContext.interface.includes("knowledge.search"), true);
  assert.ok(manifest.documents.length > 0);
  assert.ok(
    manifest.documents.some((document) =>
      document.adapterId === "builtin/mail-adapter" && document.title.includes("Null sender metadata")
    ),
    "normalized package should render email docs with null participant metadata"
  );

  const firstDocx = manifest.documents.find((document) =>
    document.artifactType === "docx" && document.sourceId === "source-md"
  );
  assert.ok(firstDocx, "normalized package must contain DOCX documents");
  const buffer = await fs.readFile(path.join(userDataPath, "jobs", jobId, "normalized-documents", firstDocx.relativePath));
  assertDocxIncludes(buffer, "客户续费", "human DOCX must keep Markdown title text");
  assertDocxIncludes(buffer, "背景", "human DOCX must keep Markdown section text");
  assertDocxIncludes(buffer, "背景证据正文", "human DOCX must keep body text");
  assertParagraphWithStyle(buffer, "Heading1", "客户续费", "human DOCX must render Markdown heading as Word heading");
  assertParagraphWithStyle(buffer, "Heading2", "背景", "human DOCX must render nested Markdown heading as Word heading");
  assertBulletParagraph(buffer, "法务确认合同条款", "human DOCX must preserve Markdown bullets");
  assertBulletParagraph(buffer, "补齐预算审批记录", "human DOCX must preserve multiple Markdown bullets");
  assert.equal((docxXml(buffer).match(/<w:tbl\b/g) || []).length >= 1, true, "human DOCX must render Markdown tables as Word tables");
  assertDocxNotIncludes(buffer, "chunk-background", "human DOCX must not expose chunk ids");
  assertDocxNotIncludes(buffer, "startLine", "human DOCX must not expose source range internals");

  assert.deepEqual(firstDocx.exportConsistencyBaseline, {
    schemaVersion: "v0.0.1:schema:definition-1",
    sourceFormat: "markdown",
    targetFormat: "docx",
    sectionCount: 1,
    sections: [{
      index: 1,
      title: "",
      markdownStructure: {
        headingCount: 2,
        headingTexts: [
          { level: 1, text: "客户续费" },
          { level: 2, text: "背景" }
        ],
        bulletCount: 2,
        bulletTexts: ["法务确认合同条款", "补齐预算审批记录"],
        tableCount: 1,
        tableShapes: [{ rows: 3, columns: 2, header: ["项目", "状态"] }],
        paragraphCount: 1,
        paragraphSamples: ["背景证据正文。"]
      }
    }],
    totals: {
      headingCount: 2,
      bulletCount: 2,
      tableCount: 1,
      paragraphCount: 1
    }
  }, "normalized manifest should carry a machine-readable Markdown to DOCX consistency baseline");

  assert.equal(firstDocx.machineReadableFormat, "yaml");
  assert.ok(firstDocx.machineReadableRelativePath.endsWith(".yaml"));
  const machineYaml = await fs.readFile(
    path.join(userDataPath, "jobs", jobId, "normalized-documents", firstDocx.machineReadableRelativePath),
    "utf8"
  );
  assert.ok(machineYaml.includes("v0.0.1:knowledge:normalized-document-machine-1"));
  assert.ok(machineYaml.includes("chunk-background"));
  assert.ok(machineYaml.includes("section-background"));
  assert.ok(machineYaml.includes("exportConsistencyBaseline:"));
  assert.ok(machineYaml.includes("sourceFormat: \"markdown\""));
  assert.ok(machineYaml.includes("bulletTexts:"));
  assert.ok(machineYaml.includes("法务确认合同条款"));
  assert.ok(machineYaml.includes("tableShapes:"));
  await fs.access(path.join(userDataPath, "jobs", jobId, "normalized-documents", "manifest.yaml"));
}

function buildKnowledgeDocument() {
  return {
    documentId: "docx-export-doc",
    collectionId: "docx-export-fixture",
    collectionTitle: "DOCX Export Fixture",
    collectionType: "test",
    batchId: "batch-docx",
    sourceId: "source-docx",
    documentType: "document",
    title: "客户续费资料",
    summary: "用于验证知识库 DOCX 导出的摘要。",
    sourcePath: "fixtures/customer-renewal.md",
    sourceHash: "sha256:fixture",
    metadata: {
      importRole: "canonical-knowledge"
    },
    sections: [
      {
        sectionId: "section-background",
        documentId: "docx-export-doc",
        title: "背景",
        level: 1,
        position: 1,
        metadata: {
          sourceRange: { startLine: 1, endLine: 5 }
        }
      }
    ],
    blocks: [
      {
        blockId: "block-background",
        documentId: "docx-export-doc",
        sectionId: "section-background",
        blockType: "text",
        title: "背景证据",
        text: "背景证据正文，包含续费窗口、法务跟进和预算审批事实。",
        snippet: "背景证据正文",
        position: 1,
        sourceLocator: {
          sourcePath: "fixtures/customer-renewal.md",
          sourceRange: { startLine: 2, endLine: 4 }
        },
        metadata: {
          chunkId: "chunk-background"
        }
      }
    ],
    assets: [
      {
        assetId: "asset-renewal-table",
        documentId: "docx-export-doc",
        sectionId: "section-background",
        blockId: "block-background",
        assetType: "table",
        mediaType: "text/plain",
        title: "续费表格",
        text: "客户 | 金额 | 状态",
        caption: "续费金额和状态表。",
        position: 1,
        metadata: {
          sourceRange: { startLine: 6, endLine: 8 }
        }
      }
    ]
  };
}

async function assertKnowledgeCoreDocxExport() {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-knowledge-docx-"));
  const knowledgeCore = await createKnowledgeCoreMount({ userDataPath });
  try {
    knowledgeCore.upsertDocuments({
      documents: [buildKnowledgeDocument()]
    });

    const capabilities = await knowledgeCore.capabilities();
    assert.equal(capabilities.outputFormats.includes("docx"), true);
    assert.equal(capabilities.knowledgePartitions.corpusExport.format, "docx");
    assert.equal(capabilities.knowledgePartitions.agentContext.interface.includes("knowledge.search"), true);

    const result = await knowledgeCore.exportDocx({ batchId: "batch-docx", limit: 50 });
    assert.equal(result.contentType, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    assert.equal(result.fileName.endsWith(".docx"), true);
    assert.equal(result.manifest.packageRole, "external-knowledge-corpus");
    assert.equal(result.manifest.documentRole, "human-readable-normalized-knowledge-document");
    assert.equal(result.manifest.documentCount, 1);
    assert.ok(result.buffer.length > 0);
    assertDocxIncludes(result.buffer, "Pact 知识文档导出");
    assertDocxIncludes(result.buffer, "客户续费资料");
    assertDocxIncludes(result.buffer, "背景证据正文");
    assertDocxNotIncludes(result.buffer, "external-knowledge-corpus");
    assertDocxNotIncludes(result.buffer, "chunk-background");

    const machineResult = await knowledgeCore.exportDocx({
      batchId: "batch-docx",
      limit: 50,
      includeMachineReadable: true
    });
    assert.equal(machineResult.manifest.machineReadableAppendixFormat, "yaml");
    assertDocxIncludes(machineResult.buffer, "机器可读 YAML 附录");
    assertDocxIncludes(machineResult.buffer, "machine-readable-export-appendix");
    assertDocxIncludes(machineResult.buffer, "chunk-background");
  } finally {
    await knowledgeCore.close();
  }
}

async function main() {
  await assertNormalizedHumanDocxAndYamlMachineState();
  await assertKnowledgeCoreDocxExport();
  console.log("knowledge docx export verification passed");
}

await main();
