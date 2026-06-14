import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import createDocumentOutlineRuntimeDefault, { createDocumentOutlineRuntime } from "../../../server/platform/specialized/knowledge/storage/knowledge-core/DocumentOutlineRuntime.mjs";
import {
  KNOWLEDGE_DOCX_EXPORT_CONTENT_TYPE,
  KNOWLEDGE_DOCX_EXPORT_PACKAGE_TYPE,
  buildKnowledgeDocxExport,
} from "../../../server/platform/specialized/knowledge/storage/knowledge-core/knowledge-docx-export.mjs";
import {
  KNOWLEDGE_HTML_EXPORT_CONTENT_TYPE,
  KNOWLEDGE_HTML_EXPORT_PACKAGE_TYPE,
  buildKnowledgeHtmlExport,
} from "../../../server/platform/specialized/knowledge/storage/knowledge-core/knowledge-html-export.mjs";
import {
  KNOWLEDGE_MARKDOWN_EXPORT_CONTENT_TYPE,
  KNOWLEDGE_MARKDOWN_EXPORT_PACKAGE_TYPE,
  buildKnowledgeMarkdownExport,
} from "../../../server/platform/specialized/knowledge/storage/knowledge-core/knowledge-markdown-export.mjs";
import {
  fuseLocalMirrorWithKnowledgeItems,
  localMirrorSourceLocator,
  localQueryHitsFromInput,
  normalizeLocalMirrorHit,
  sourceLocatorDedupeKey,
} from "../../../server/platform/specialized/knowledge/storage/knowledge-core/local-mirror-fusion.mjs";

function createExportDocuments() {
  return [
    {
      documentId: "doc-1",
      title: "Doc <One> & One",
      documentType: "memo",
      sourceId: "source-1",
      sourcePath: "/docs/one.md",
      batchId: "batch-1",
      summary: "Intro <alpha>\n\nSecond paragraph",
      sections: [
        { sectionId: "sec-a", title: "Alpha", level: 1, position: 1 },
        { sectionId: "sec-b", title: "Beta", level: 2, position: 1 },
      ],
      blocks: [
        {
          blockId: "blk-a1",
          sectionId: "sec-a",
          title: "Block A",
          text: "Alpha body",
          position: 1,
          sourceLocator: { page: 3 },
          metadata: { priority: 1 },
        },
        {
          blockId: "blk-a2",
          sectionId: "sec-a",
          title: "",
          snippet: "Snippet & <two>",
          position: 1,
          source_locator: { pageNumber: 5 },
        },
        {
          blockId: "blk-loose",
          title: "Loose <block>",
          text: "Loose body",
          position: 2,
        },
      ],
      assets: [
        {
          assetId: "asset-b",
          title: "Beta asset",
          caption: "Caption <1>",
          position: 2,
        },
        {
          assetId: "asset-a",
          title: "Alpha asset",
          ocrText: "OCR & text",
          position: 2,
        },
      ],
    },
    {
      documentId: "doc-2",
      title: "Second",
      documentType: "note",
      sourceId: "source-2",
      sourcePath: "/docs/two.md",
      summary: "",
      sections: [
        { sectionId: "sec-empty", title: "Empty", level: 1, position: 1 },
      ],
      blocks: [
        {
          blockId: "blk-b1",
          sectionId: "sec-empty",
          title: "Body",
          text: "Second body",
          position: 1,
        },
      ],
      assets: [],
    },
  ];
}

function createPlainOutlineBlocks() {
  return [
    { blockId: "p1", title: "正文", text: "plain text one", position: 1 },
    { blockId: "p2", title: "正文", text: "plain text two", position: 2 },
    { blockId: "p3", title: "正文", text: "plain text three", position: 3 },
    { blockId: "p4", title: "正文", text: "plain text four", position: 4 },
  ];
}

async function extractDocxText(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file("word/document.xml").async("text");
  return xml.replace(/\s+/g, " ");
}

describe("DocumentOutlineRuntime", () => {
  it("builds section outlines, keeps the alias export, and evaluates position ranges", () => {
    expect(createDocumentOutlineRuntimeDefault).toBe(createDocumentOutlineRuntime);

    const runtime = createDocumentOutlineRuntime({
      defaultMinDocumentBlocks: 4,
      defaultMaxTreeNodes: 6,
    });

    expect(runtime.protocolVersion).toBe("v0.0.1:knowledge:document-outline-1");
    expect(runtime.rangeContainsPosition({ blockStart: 2, blockEnd: 4 }, 3)).toBe(true);
    expect(runtime.rangeContainsPosition({ blockStart: 2, blockEnd: 4 }, 1)).toBe(false);

    const outline = runtime.build({
      document: {
        documentId: "doc-outline",
        documentType: "memo",
        title: "Outline Doc",
      },
      sections: [
        { sectionId: "a-root", title: "Root", level: 1, position: 1 },
        { sectionId: "b-child", title: "Child", level: 2, position: 1 },
      ],
      blocks: [
        {
          blockId: "block-root",
          sectionId: "a-root",
          title: "Root block",
          text: "Root text",
          position: 1,
          sourceLocator: { page: 3 },
        },
        {
          blockId: "block-child",
          sectionId: "b-child",
          title: "Child block",
          snippet: "Child snippet",
          position: 2,
          source_locator: { pageIndex: 7 },
        },
      ],
      assets: [{ assetId: "asset-1" }],
    });

    expect(outline).toMatchObject({
      protocolVersion: "v0.0.1:knowledge:document-outline-1",
      documentId: "doc-outline",
      nodeCount: 2,
      syntheticNodeCount: 0,
      sourceStats: {
        sectionCount: 2,
        blockCount: 2,
        assetCount: 1,
      },
    });
    expect(outline.qualityFindings).toEqual([]);
    expect(outline.nodes[0]).toMatchObject({
      nodeType: "section",
      targetId: "a-root",
      parentNodeType: "document",
      parentTargetId: "doc-outline",
      metadata: {
        outlineOrigin: "source-section",
        sourceRange: {
          blockStart: 1,
          blockEnd: 1,
          pageStart: 3,
          pageEnd: 3,
        },
      },
    });
    expect(outline.nodes[1]).toMatchObject({
      nodeType: "section",
      targetId: "b-child",
      parentNodeType: "section",
      parentTargetId: "a-root",
      metadata: {
        sourceRange: {
          blockStart: 2,
          blockEnd: 2,
          pageStart: 7,
          pageEnd: 7,
        },
      },
    });
  });

  it("builds synthetic heading outlines when source sections are coarse", () => {
    const runtime = createDocumentOutlineRuntime({
      defaultMinDocumentBlocks: 4,
      defaultMaxTreeNodes: 6,
    });

    const outline = runtime.build({
      document: {
        documentId: "doc-heading",
        documentType: "note",
        title: "Outline Doc",
      },
      blocks: [
        { blockId: "h1", title: "Outline Doc", text: "# Alpha", position: 1 },
        { blockId: "h2", title: "正文", text: "## Beta", position: 2 },
        { blockId: "h3", title: "block", text: "### Gamma", position: 3 },
        { blockId: "h4", title: "", text: "plain text", position: 4 },
      ],
    });

    expect(outline.nodeCount).toBe(3);
    expect(outline.syntheticNodeCount).toBe(3);
    expect(outline.qualityFindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "missing_source_sections" }),
        expect.objectContaining({ code: "coarse_source_structure" }),
      ])
    );
    expect(outline.qualityFindings.some((finding) => finding.code === "synthetic_window_outline")).toBe(false);
    expect(outline.nodes[0]).toMatchObject({
      nodeType: "outline",
      title: "Alpha",
      parentNodeType: "document",
      metadata: {
        outlineOrigin: "markdown-heading",
        quality: {
          synthetic: true,
          reliable: true,
          reason: "markdown-heading",
        },
      },
    });
    expect(outline.nodes[1]).toMatchObject({
      parentNodeType: "outline",
      parentTargetId: outline.nodes[0].targetId,
      title: "Beta",
    });
    expect(outline.nodes[2]).toMatchObject({
      parentNodeType: "outline",
      parentTargetId: outline.nodes[1].targetId,
      title: "Gamma",
    });
  });

  it("falls back to window outlines when no headings are available", () => {
    const runtime = createDocumentOutlineRuntime({
      defaultMinDocumentBlocks: 4,
      defaultMaxTreeNodes: 6,
    });

    const outline = runtime.build({
      document: {
        documentId: "doc-window",
        documentType: "note",
        title: "Plain Doc",
      },
      blocks: createPlainOutlineBlocks(),
    });

    expect(outline.nodeCount).toBe(2);
    expect(outline.syntheticNodeCount).toBe(2);
    expect(outline.qualityFindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "missing_source_sections" }),
        expect.objectContaining({ code: "coarse_source_structure" }),
        expect.objectContaining({ code: "synthetic_window_outline" }),
      ])
    );
    expect(outline.nodes[0]).toMatchObject({
      nodeType: "outline",
      title: "自然片段 1",
      metadata: {
        outlineOrigin: "synthetic-block-window",
        quality: {
          synthetic: true,
          reliable: false,
          reason: "coarse_or_missing_sections",
        },
      },
    });
    expect(outline.nodes[1].title).toBe("自然片段 2");
  });
});

describe("knowledge docx/html/markdown exports", () => {
  it("exports an empty corpus with machine-readable appendix metadata in DOCX", async () => {
    const generatedAt = "2026-06-05T01:02:03.000Z";
    const exported = await buildKnowledgeDocxExport({
      documents: [],
      generatedAt,
      filters: { documentId: "Doc 42" },
      includeMachineReadable: true,
    });

    expect(KNOWLEDGE_DOCX_EXPORT_PACKAGE_TYPE).toBe("pact.knowledge.docx-export");
    expect(KNOWLEDGE_DOCX_EXPORT_CONTENT_TYPE).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(exported.contentType).toBe(KNOWLEDGE_DOCX_EXPORT_CONTENT_TYPE);
    expect(exported.fileName).toBe("pact-knowledge-doc-42-20260605T01020.docx");
    expect(exported.manifest).toMatchObject({
      packageType: KNOWLEDGE_DOCX_EXPORT_PACKAGE_TYPE,
      packageRole: "external-knowledge-corpus",
      documentRole: "human-readable-normalized-knowledge-document",
      machineReadableAppendixFormat: "yaml",
      generatedAt,
      documentCount: 0,
      sectionCount: 0,
      blockCount: 0,
      assetCount: 0,
    });

    const xml = await extractDocxText(exported.buffer);
    expect(xml).toContain("Pact 知识文档导出");
    expect(xml).toContain("当前筛选条件下没有可导出的知识文档。");
    expect(xml).toContain("机器可读 YAML 附录");
    expect(xml).toContain("pact.knowledge.docx-export");
  });

  it("exports ordered document content with sections, blocks, assets, and appendix in DOCX", async () => {
    const generatedAt = "2026-06-05T01:02:03.000Z";
    const exported = await buildKnowledgeDocxExport({
      documents: createExportDocuments(),
      generatedAt,
      filters: { sourceId: "Source 42" },
      includeMachineReadable: false,
    });

    expect(exported.fileName).toBe("pact-knowledge-source-42-20260605T01020.docx");
    expect(exported.manifest).toMatchObject({
      documentCount: 2,
      sectionCount: 3,
      blockCount: 4,
      assetCount: 2,
      machineReadableAppendixFormat: "",
    });

    const xml = await extractDocxText(exported.buffer);
    expect(xml).toContain("Doc &lt;One&gt; &amp; One");
    expect(xml).toContain("Intro &lt;alpha&gt;");
    expect(xml).toContain("Alpha");
    expect(xml).toContain("Beta");
    expect(xml).toContain("Loose &lt;block&gt;");
    expect(xml).toContain("资产与多模态证据");
    expect(xml.indexOf("Alpha")).toBeLessThan(xml.indexOf("Beta"));
    expect(xml.indexOf("Alpha asset")).toBeLessThan(xml.indexOf("Beta asset"));
    expect(xml).not.toContain("机器可读 YAML 附录");
  });

  it("renders HTML and markdown exports for both empty and populated corpora", () => {
    const generatedAt = "2026-06-05T01:02:03.000Z";
    const documents = createExportDocuments();

    const emptyHtml = buildKnowledgeHtmlExport({
      documents: [],
      generatedAt,
      filters: { batchId: "Batch 7" },
    });
    expect(KNOWLEDGE_HTML_EXPORT_PACKAGE_TYPE).toBe("pact.knowledge.html-export");
    expect(KNOWLEDGE_HTML_EXPORT_CONTENT_TYPE).toBe("text/html; charset=utf-8");
    expect(emptyHtml.contentType).toBe(KNOWLEDGE_HTML_EXPORT_CONTENT_TYPE);
    expect(emptyHtml.fileName).toBe("pact-knowledge-batch-7-20260605T01020.html");
    const emptyHtmlText = emptyHtml.buffer.toString("utf8");
    expect(emptyHtmlText).toContain("当前筛选条件下没有可导出的知识文档。");
    expect(emptyHtmlText).toContain("导出时间");

    const html = buildKnowledgeHtmlExport({
      documents,
      generatedAt,
      filters: { documentId: "Doc 42" },
    });
    const htmlText = html.buffer.toString("utf8");
    expect(html.fileName).toBe("pact-knowledge-doc-42-20260605T01020.html");
    expect(htmlText).toContain("Doc &lt;One&gt; &amp; One");
    expect(htmlText).toContain("<h2>Doc &lt;One&gt; &amp; One</h2>");
    expect(htmlText).toContain("<h3>摘要</h3>");
    expect(htmlText).toContain("Loose &lt;block&gt;");
    expect(htmlText).toContain("未归属章节知识块");
    expect(htmlText).toContain("资产与多模态证据");
    expect(htmlText).toContain("Alpha asset");
    expect(htmlText.indexOf("Alpha")).toBeLessThan(htmlText.indexOf("Beta"));

    const emptyMarkdown = buildKnowledgeMarkdownExport({
      documents: [],
      generatedAt,
      filters: { sourceId: "Source 7" },
    });
    expect(KNOWLEDGE_MARKDOWN_EXPORT_PACKAGE_TYPE).toBe("pact.knowledge.markdown-export");
    expect(KNOWLEDGE_MARKDOWN_EXPORT_CONTENT_TYPE).toBe("text/markdown; charset=utf-8");
    expect(emptyMarkdown.contentType).toBe(KNOWLEDGE_MARKDOWN_EXPORT_CONTENT_TYPE);
    expect(emptyMarkdown.fileName).toBe("pact-knowledge-source-7-20260605T01020.md");
    const emptyMarkdownText = emptyMarkdown.buffer.toString("utf8");
    expect(emptyMarkdownText).toContain("*当前筛选条件下没有可导出的知识文档。*");

    const markdown = buildKnowledgeMarkdownExport({
      documents,
      generatedAt,
      filters: { documentId: "Doc 42" },
    });
    const markdownText = markdown.buffer.toString("utf8");
    expect(markdown.fileName).toBe("pact-knowledge-doc-42-20260605T01020.md");
    expect(markdownText).toContain("# Pact 知识库导出");
    expect(markdownText).toContain("# Doc <One> & One");
    expect(markdownText).toContain("## 摘要");
    expect(markdownText).toContain("Loose <block>");
    expect(markdownText).toContain("## 未归属章节知识块");
    expect(markdownText).toContain("## 资产与多模态证据");
    expect(markdownText).toContain("Alpha asset");
    expect(markdownText.indexOf("Alpha")).toBeLessThan(markdownText.indexOf("Beta"));
  });
});

describe("local mirror fusion", () => {
  it("normalizes hit sources, dedupe keys, and query input flattening", () => {
    const hits = localQueryHitsFromInput({
      localQuery: [{ id: "q-1", title: "one" }],
      localQueryResults: { results: [{ id: "q-2", title: "two" }] },
      localHits: { hits: [{ id: "q-3", title: "three" }] },
      sourceHits: [{ id: "q-4", title: "four" }],
      localQueryResult: { items: [{ id: "q-5", title: "five" }] },
      localMirror: [{ id: "q-6", title: "six" }],
      ignored: "not-an-array",
    });

    expect(hits).toHaveLength(6);
    expect(hits.map((hit) => hit.id)).toEqual(["q-1", "q-5", "q-2", "q-6", "q-3", "q-4"]);

    const locator = localMirrorSourceLocator({
      kind: "mail",
      providerId: "Slack",
      externalId: "MSG-9",
      syncBatchId: "batch-9",
      path: "/tmp/source.eml",
      sha256: "hash-1",
      timestamp: "2026-06-05T00:00:00.000Z",
      originalFileName: "source.eml",
      chatRef: {
        workspaceId: "workspace-a",
        conversationId: "conv-a",
      },
      fileRef: {
        originalFileName: "nested.eml",
      },
    });
    expect(locator).toMatchObject({
      sourceType: "mail",
      providerId: "Slack",
      externalId: "MSG-9",
      syncBatchId: "batch-9",
      sourcePath: "/tmp/source.eml",
      contentHash: "hash-1",
      capturedAt: "2026-06-05T00:00:00.000Z",
      originalFileName: "source.eml",
    });
    expect(sourceLocatorDedupeKey(locator)).toBe("provider:slack:msg-9");
    expect(sourceLocatorDedupeKey({
      chatRef: {
        providerId: "slack",
        workspaceId: "workspace-a",
        conversationId: "conv-a",
        messageId: "msg-1",
        threadTs: "123",
      },
    })).toBe("chat:slack:workspace-a:conv-a:msg-1:123");
    expect(sourceLocatorDedupeKey({
      fileRef: {
        storageRelativePath: "/files/a.eml",
      },
    })).toBe("file::/files/a.eml");
    expect(sourceLocatorDedupeKey({
      contentHash: "abc123",
    })).toBe("hash::abc123");
    expect(sourceLocatorDedupeKey({})).toBe("");
  });

  it("normalizes local hits and fuses them with indexed knowledge items", () => {
    const normalized = normalizeLocalMirrorHit({
      hit: {
        kind: "chat",
        providerId: "Slack",
        externalId: "MSG-1",
        title: "Chat title",
        text: "alpha beta gamma",
        relevanceScore: 0.9,
        timestamp: "2026-06-04T00:00:00.000Z",
        participants: [{ id: "u-1" }],
      },
      query: "alpha beta",
      settings: {
        retrieval: {
          localMirrorWeight: 0.6,
          recencyHalfLifeDays: 30,
        },
      },
      referenceMs: Date.parse("2026-06-05T00:00:00.000Z"),
      index: 0,
    });

    expect(normalized).toMatchObject({
      item: {
        itemType: "chat",
        title: "Chat title",
        modalities: ["chat"],
        localMirror: {
          matched: true,
          sourceType: "chat",
          providerId: "Slack",
          externalId: "MSG-1",
          status: "local_mirror_not_yet_ingested",
        },
        participants: [{ id: "u-1" }],
      },
      dedupeKey: "provider:slack:msg-1",
    });
    expect(normalized.item.reasons[0]).toMatchObject({
      kind: "local-mirror-query",
      remoteCalls: false,
      weight: 0.6,
    });
    expect(normalized.finalScore).toBeGreaterThan(0);
    expect(normalized.finalScore).toBeLessThanOrEqual(1);

    const fused = fuseLocalMirrorWithKnowledgeItems({
      items: [
        {
          itemId: "server-1",
          title: "Server match",
          snippet: "server snippet",
          finalScore: 0.9,
          source: {
            providerId: "Slack",
            externalId: "MSG-1",
          },
        },
        {
          itemId: "server-2",
          title: "Server only",
          snippet: "server only snippet",
          finalScore: 0.8,
        },
      ],
      localHits: [
        {
          providerId: "Slack",
          externalId: "MSG-1",
          title: "Local duplicate",
          text: "alpha beta",
          score: 0.7,
          timestamp: "2026-06-04T00:00:00.000Z",
        },
        {
          providerId: "Mail",
          externalId: "MAIL-2",
          title: "Local append",
          text: "delta epsilon",
          score: 0.65,
          timestamp: "2026-06-04T00:00:00.000Z",
        },
      ],
      query: "alpha beta",
      settings: {
        retrieval: {
          localMirrorWeight: 0.75,
          recencyHalfLifeDays: 30,
        },
      },
      limit: 3,
      explain: true,
      referenceMs: Date.parse("2026-06-05T00:00:00.000Z"),
    });

    expect(fused.items).toHaveLength(3);
    expect(fused.items.find((item) => item.itemId === "server-1")).toMatchObject({
      itemId: "server-1",
      localMirror: {
        status: "local_mirror_duplicate_of_indexed_evidence",
      },
      fusion: {
        origin: "knowledge-core",
        localMirrorMerged: true,
      },
    });
    expect(fused.items.find((item) => item.localMirror?.status === "local_mirror_not_yet_ingested")).toMatchObject({
      localMirror: {
        status: "local_mirror_not_yet_ingested",
      },
      fusion: {
        origin: "local-mirror",
        remoteCalls: false,
      },
    });
    expect(fused.fusion).toMatchObject({
      mode: "server-index-plus-local-mirror",
      localQueryRemoteCalls: false,
      serverItemCount: 2,
      localHitCount: 2,
      localMergedCount: 1,
      localAppendedCount: 1,
      returnedLocalOnlyCount: 1,
    });
    expect(fused.fusion.localCandidates).toHaveLength(2);

    const passthrough = fuseLocalMirrorWithKnowledgeItems({
      items: [{ itemId: "server-keep", title: "keep", finalScore: 0.4 }],
      localHits: [],
      limit: 5,
    });
    expect(passthrough).toEqual({
      items: [{ itemId: "server-keep", title: "keep", finalScore: 0.4 }],
      fusion: null,
    });
  });
});
