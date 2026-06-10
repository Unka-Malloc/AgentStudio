import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  markdownExport: vi.fn(),
  htmlExport: vi.fn(),
  docxExport: vi.fn(),
  accessPolicy: vi.fn()
}));

vi.mock("../../../server/platform/specialized/knowledge/storage/knowledge-core/knowledge-markdown-export.mjs", () => ({
  buildKnowledgeMarkdownExport: harness.markdownExport
}));

vi.mock("../../../server/platform/specialized/knowledge/storage/knowledge-core/knowledge-html-export.mjs", () => ({
  buildKnowledgeHtmlExport: harness.htmlExport
}));

vi.mock("../../../server/platform/specialized/knowledge/storage/knowledge-core/knowledge-docx-export.mjs", () => ({
  buildKnowledgeDocxExport: harness.docxExport
}));

vi.mock("../../../server/platform/specialized/knowledge/agent-library/access-policy.mjs", () => ({
  evaluateKnowledgeAccess: harness.accessPolicy
}));

let createKnowledgeTransformationProvider;
let KNOWLEDGE_TRANSFORMATION_PROTOCOL_VERSION;

beforeAll(async () => {
  ({
    createKnowledgeTransformationProvider,
    KNOWLEDGE_TRANSFORMATION_PROTOCOL_VERSION
  } = await import("../../../server/platform/specialized/knowledge/transformation/knowledge-transformation-provider.mjs"));
});

beforeEach(() => {
  vi.clearAllMocks();

  harness.markdownExport.mockImplementation(({ documents = [] } = {}) => ({
    buffer: Buffer.from(`markdown:${documents.length}`, "utf8"),
    contentType: "text/markdown; charset=utf-8",
    fileName: "knowledge-export.md"
  }));

  harness.htmlExport.mockImplementation(({ documents = [] } = {}) => ({
    buffer: Buffer.from(`html:${documents.length}`, "utf8"),
    contentType: "text/html; charset=utf-8",
    fileName: "knowledge-export.html"
  }));

  harness.docxExport.mockImplementation(({ documents = [] } = {}) => ({
    buffer: Buffer.from(`docx:${documents.length}`, "utf8"),
    contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    fileName: "knowledge-export.docx"
  }));

  harness.accessPolicy.mockImplementation((payload = {}, policy = {}) => ({
    allowed: true,
    payload,
    policy
  }));
});

function createKnowledgeCore(overrides = {}) {
  return {
    search: vi.fn(async () => ({ items: [] })),
    getEvidence: vi.fn(async () => null),
    ...overrides
  };
}

function createMetadataStore(overrides = {}) {
  return {
    listRawCorpusDocuments: vi.fn(async () => []),
    ...overrides
  };
}

describe("knowledge transformation provider", () => {
  it("exports the protocol version and normalizes explicit raw corpus inputs across format branches", async () => {
    const metadataStore = createMetadataStore();
    const provider = createKnowledgeTransformationProvider({ metadataStore });
    const subject = {
      subjectId: "subject-1",
      username: "agent-1",
      roleId: "auditor"
    };

    const explicitInput = {
      title: "  Raw export  ",
      agentProfileId: "profile-x",
      authorizationPolicy: "not-an-object",
      authorizationOverlay: "also-not-an-object",
      view: null,
      documents: [{
        id: "doc-1",
        name: "  Doc A  ",
        documentType: "brief",
        mediaType: "text/markdown",
        sourceId: "src-1",
        sourcePath: " /a.md ",
        batchId: "batch-1",
        metadata: null,
        blocks: [{
          id: "blk-1",
          sectionId: "sec-1",
          type: "quote",
          content: "Block body",
          snippet: "Snippet",
          position: 0,
          metadata: { foo: "bar" }
        }],
        assets: "asset-one"
      }],
      items: [{
        title: "Item Doc",
        content: "Item body",
        sourcePath: " /item.txt "
      }],
      rawCorpus: {
        documents: [{
          fileName: "Corpus File",
          markdown: "Corpus body"
        }]
      },
      rawCorpusDocuments: [{
        name: "Legacy raw doc",
        body: "Legacy body"
      }]
    };

    expect(KNOWLEDGE_TRANSFORMATION_PROTOCOL_VERSION).toBe("pact.knowledge-transformation.v1");

    const markdownResult = await provider.convertRawCorpus({
      ...explicitInput,
      outputFormat: "md"
    }, { subject });

    expect(markdownResult).toMatchObject({
      ok: true,
      protocolVersion: KNOWLEDGE_TRANSFORMATION_PROTOCOL_VERSION,
      operationId: "raw-corpus.format.convert",
      outputFormat: "markdown",
      contentType: "text/markdown; charset=utf-8",
      content: "markdown:4",
      byteSize: "markdown:4".length,
      fileName: "knowledge-export.md"
    });
    expect(markdownResult.manifest).toMatchObject({
      documentCount: 4
    });
    expect(markdownResult.knowledgeAccessDecision.allowed).toBe(true);
    expect(harness.markdownExport).toHaveBeenCalledTimes(1);
    expect(harness.htmlExport).not.toHaveBeenCalled();
    expect(harness.docxExport).not.toHaveBeenCalled();

    const markdownArgs = harness.markdownExport.mock.calls[0][0];
    expect(markdownArgs.documents).toHaveLength(4);
    expect(markdownArgs.documents.map((doc) => doc.title)).toEqual([
      "Doc A",
      "Item Doc",
      "Corpus File",
      "Legacy raw doc"
    ]);
    expect(markdownArgs.documents[0]).toMatchObject({
      documentId: "doc-1",
      title: "Doc A",
      documentType: "brief",
      mediaType: "text/markdown",
      sourceId: "src-1",
      sourcePath: "/a.md",
      batchId: "batch-1",
      metadata: {},
      assets: ["asset-one"]
    });
    expect(markdownArgs.documents[0].blocks[0]).toMatchObject({
      blockId: "blk-1",
      sectionId: "sec-1",
      type: "quote",
      text: "Block body",
      snippet: "Snippet",
      position: 1,
      metadata: { foo: "bar" }
    });
    expect(markdownArgs.documents[1].blocks[0]).toMatchObject({
      blockId: "block_1",
      sectionId: "main",
      type: "text",
      text: "Item body",
      snippet: "Item body",
      position: 1
    });
    expect(markdownArgs.documents[2].blocks[0]).toMatchObject({
      text: "Corpus body",
      sectionId: "main"
    });
    expect(markdownArgs.documents[3].blocks[0]).toMatchObject({
      text: "Legacy body",
      sectionId: "main"
    });

    expect(harness.accessPolicy).toHaveBeenCalledTimes(1);
    const [accessPayload, accessPolicy] = harness.accessPolicy.mock.calls[0];
    expect(accessPayload).toMatchObject({
      libraryCardId: expect.stringMatching(/^knowledge_export_card_/),
      operatorId: "subject-1",
      requestedAction: "export",
      requestedAccessMode: "exportAllowed",
      requestedEgress: "exportFile",
      taskId: "knowledge-transformation-export",
      agentProfile: { profileId: "profile-x" }
    });
    expect(accessPayload.targetRefs).toHaveLength(4);
    expect(accessPayload.targetRefs[0]).toEqual({
      ref: "doc-1",
      refType: "knowledgeDocument"
    });
    expect(accessPolicy).toMatchObject({
      view: {
        refs: accessPayload.targetRefs,
        allowedActions: ["discover", "read", "export", "checkout"],
        authorizationOverlay: {
          defaultAccessMode: "exportAllowed"
        }
      }
    });

    const jsonResult = await provider.convertRawCorpus({
      ...explicitInput,
      format: "json",
      title: "JSON export"
    }, { subject });

    expect(jsonResult.ok).toBe(true);
    expect(jsonResult.outputFormat).toBe("json");
    expect(jsonResult.contentType).toBe("application/json; charset=utf-8");
    expect(jsonResult.fileName).toMatch(/\.json$/);
    const parsedJsonResult = JSON.parse(jsonResult.content);
    expect(parsedJsonResult).toMatchObject({
      protocolVersion: KNOWLEDGE_TRANSFORMATION_PROTOCOL_VERSION,
      title: "JSON export"
    });
    expect(parsedJsonResult.documents).toHaveLength(4);
    expect(parsedJsonResult.documents[0].title).toBe("Doc A");

    const textResult = await provider.convertRawCorpus({
      ...explicitInput,
      format: "text",
      title: "Text export"
    }, { subject });

    expect(textResult.ok).toBe(true);
    expect(textResult.outputFormat).toBe("text");
    expect(textResult.contentType).toBe("text/plain; charset=utf-8");
    expect(textResult.fileName).toMatch(/\.txt$/);
    expect(textResult.content).toContain("Doc A");
    expect(textResult.content).toContain("Block body");

    const fallbackResult = await provider.convertRawCorpus({
      ...explicitInput,
      format: "bogus",
      title: "Fallback export"
    }, { subject });

    expect(fallbackResult.ok).toBe(true);
    expect(fallbackResult.outputFormat).toBe("markdown");
    expect(fallbackResult.contentType).toBe("text/markdown; charset=utf-8");
    expect(fallbackResult.content).toBe("markdown:4");
    expect(harness.markdownExport).toHaveBeenCalledTimes(2);
  });

  it("falls back to metadataStore raw corpus documents and clamps the listing limit for html exports", async () => {
    const metadataStore = createMetadataStore({
      listRawCorpusDocuments: vi.fn(async () => [{
        documentId: "store-doc",
        title: "Store Doc",
        text: "Store body",
        sourcePath: "/store.md"
      }])
    });
    const provider = createKnowledgeTransformationProvider({ metadataStore });

    const result = await provider.convertRawCorpus({
      targetFormat: "htm",
      batchId: "batch-2",
      query: "store-query",
      limit: 0
    }, { subject: { username: "html-agent" } });

    expect(metadataStore.listRawCorpusDocuments).toHaveBeenCalledWith({
      batchId: "batch-2",
      query: "store-query",
      limit: 100
    });
    expect(harness.htmlExport).toHaveBeenCalledTimes(1);
    expect(harness.markdownExport).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: true,
      outputFormat: "html",
      contentType: "text/html; charset=utf-8",
      content: "html:1",
      fileName: "knowledge-export.html"
    });
    expect(result.manifest).toMatchObject({
      documentCount: 1
    });
    expect(harness.htmlExport.mock.calls[0][0].documents[0]).toMatchObject({
      documentId: "store-doc",
      title: "Store Doc",
      sourcePath: "/store.md"
    });
  });

  it("returns 403 for raw corpus export when access is denied", async () => {
    harness.accessPolicy.mockReturnValue({
      allowed: false
    });

    const provider = createKnowledgeTransformationProvider({
      metadataStore: createMetadataStore()
    });

    const result = await provider.convertRawCorpus({
      text: "Denied raw body"
    }, { subject: { username: "blocked" } });

    expect(result).toEqual({
      ok: false,
      status: 403,
      protocolVersion: KNOWLEDGE_TRANSFORMATION_PROTOCOL_VERSION,
      operationId: "raw-corpus.format.convert",
      error: "AgentLibrary access denied for raw corpus export.",
      knowledgeAccessDecision: { allowed: false }
    });
    expect(harness.markdownExport).not.toHaveBeenCalled();
    expect(harness.htmlExport).not.toHaveBeenCalled();
    expect(harness.docxExport).not.toHaveBeenCalled();
  });

  it("exports dossiers from evidence documents and skips search", async () => {
    const knowledgeCore = createKnowledgeCore({
      search: vi.fn(async () => {
        throw new Error("search should not be called when evidence exists");
      }),
      getEvidence: vi.fn(async ({ evidenceId }) => ({
        evidenceId,
        title: "Evidence Title",
        summary: "Evidence summary",
        snippet: "Evidence snippet",
        markdown: "Evidence markdown",
        text: "Evidence text",
        blocks: [{ text: "Block one" }],
        sourceId: "src-e1",
        sourcePath: "/evidence.md"
      }))
    });
    const provider = createKnowledgeTransformationProvider({ knowledgeCore });

    const result = await provider.exportDossier({
      title: "Evidence dossier",
      evidenceIds: "e-1",
      documents: [{
        title: "Request doc",
        text: "Request body",
        sourcePath: "/request.md"
      }],
      format: "docx"
    }, { subject: { username: "dossier-agent" } });

    expect(knowledgeCore.getEvidence).toHaveBeenCalledWith({
      evidenceId: "e-1"
    });
    expect(knowledgeCore.search).not.toHaveBeenCalled();
    expect(harness.docxExport).toHaveBeenCalledTimes(1);
    expect(harness.docxExport.mock.calls[0][0]).toMatchObject({
      documents: [{
        title: "Evidence dossier"
      }],
      filters: {
        query: "",
        evidenceCount: 2
      },
      includeMachineReadable: true
    });
    expect(harness.docxExport.mock.calls[0][0].documents[0].blocks[0].text).toContain("Evidence summary");
    expect(harness.docxExport.mock.calls[0][0].documents[0].blocks[0].text).toContain("Evidence snippet");
    expect(harness.docxExport.mock.calls[0][0].documents[0].blocks[0].text).toContain("Evidence markdown");
    expect(harness.docxExport.mock.calls[0][0].documents[0].blocks[0].text).toContain("Evidence text");
    expect(harness.docxExport.mock.calls[0][0].documents[0].blocks[0].text).toContain("Block one");
    expect(harness.docxExport.mock.calls[0][0].documents[0].blocks[0].text).toContain("Request body");
    expect(result).toMatchObject({
      ok: true,
      operationId: "knowledge.dossier.export",
      outputFormat: "docx",
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      content: undefined,
      sourceDocumentCount: 2
    });
    expect(result.manifest).toMatchObject({
      documentCount: 1
    });
  });

  it("uses search results when no evidence is present and normalizes the dossier search limit", async () => {
    const knowledgeCore = createKnowledgeCore({
      search: vi.fn(async (input = {}) => ({
        items: [{
          evidenceId: "search-1",
          title: "Search evidence",
          summary: "Search summary",
          snippet: "Search snippet",
          markdown: "Search markdown",
          text: "Search text"
        }]
      })),
      getEvidence: vi.fn(async () => null)
    });
    const provider = createKnowledgeTransformationProvider({ knowledgeCore });

    const result = await provider.exportDossier({
      query: "alpha",
      batchId: "batch-3",
      sourceIds: ["src-1"],
      limit: 500,
      title: "Search dossier"
    }, { subject: { username: "search-agent" } });

    expect(knowledgeCore.search).toHaveBeenCalledWith({
      query: "alpha",
      limit: 100,
      batchId: "batch-3",
      sourceIds: ["src-1"],
      modalityPolicy: "multimodal"
    });
    expect(harness.markdownExport).toHaveBeenCalledTimes(1);
    expect(harness.markdownExport.mock.calls[0][0].documents[0].blocks[0].text).toContain("Search evidence");
    expect(harness.markdownExport.mock.calls[0][0].documents[0].blocks[0].text).toContain("Search summary");
    expect(harness.markdownExport.mock.calls[0][0].documents[0].blocks[0].text).toContain("Search snippet");
    expect(harness.markdownExport.mock.calls[0][0].documents[0].blocks[0].text).toContain("Search markdown");
    expect(harness.markdownExport.mock.calls[0][0].documents[0].blocks[0].text).toContain("Search text");
    expect(result).toMatchObject({
      ok: true,
      operationId: "knowledge.dossier.export",
      outputFormat: "markdown",
      contentType: "text/markdown; charset=utf-8",
      content: "markdown:1",
      sourceDocumentCount: 1
    });
  });

  it("returns 403 for export operations when access is denied", async () => {
    harness.accessPolicy.mockReturnValue({
      allowed: false
    });

    const provider = createKnowledgeTransformationProvider({
      knowledgeCore: createKnowledgeCore(),
      metadataStore: createMetadataStore()
    });

    await expect(provider.convertRawCorpus({ text: "Denied body" }, { subject: { username: "blocked" } })).resolves.toEqual({
      ok: false,
      status: 403,
      protocolVersion: KNOWLEDGE_TRANSFORMATION_PROTOCOL_VERSION,
      operationId: "raw-corpus.format.convert",
      error: "AgentLibrary access denied for raw corpus export.",
      knowledgeAccessDecision: { allowed: false }
    });

    await expect(provider.exportDossier({ query: "blocked" }, { subject: { username: "blocked" } })).resolves.toEqual({
      ok: false,
      status: 403,
      protocolVersion: KNOWLEDGE_TRANSFORMATION_PROTOCOL_VERSION,
      operationId: "knowledge.dossier.export",
      error: "AgentLibrary access denied for dossier export.",
      knowledgeAccessDecision: { allowed: false }
    });
  });
});
