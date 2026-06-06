import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  createCoreMount: null,
  createEmbeddingRuntime: null,
  pgState: null
}));

vi.mock("../../../server/platform/specialized/knowledge/storage/knowledge-core/index.mjs", () => ({
  KNOWLEDGE_PROTOCOL_VERSION: "pact.knowledge.v1",
  createKnowledgeCoreMount: async (...args) => harness.createCoreMount(...args)
}));

vi.mock("../../../server/platform/specialized/knowledge/retrieval/embedding-runtime/index.mjs", () => ({
  createEmbeddingRuntime: (...args) => harness.createEmbeddingRuntime(...args)
}));

vi.mock("pg", () => ({
  default: {
    Pool: class Pool {
      constructor(options = {}) {
        this.options = options;
        harness.pgState?.instances.push(this);
      }

      async query(sql, params = []) {
        return harness.pgState?.query(sql, params) ?? { rows: [], rowCount: 0 };
      }

      async end() {
        if (harness.pgState) {
          harness.pgState.ended = true;
        }
      }
    }
  },
  Pool: class Pool {
    constructor(options = {}) {
      this.options = options;
      harness.pgState?.instances.push(this);
    }

    async query(sql, params = []) {
      return harness.pgState?.query(sql, params) ?? { rows: [], rowCount: 0 };
    }

    async end() {
      if (harness.pgState) {
        harness.pgState.ended = true;
      }
    }
  }
}));

const tempRoots = [];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function tempDir(prefix) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

function buildDocument({
  batchId = "batch-local",
  documentId = "doc-local",
  sourceId = "source-local",
  blockId = `${documentId}-block`,
  assetId = `${documentId}-asset`
} = {}) {
  return {
    documentId,
    batchId,
    sourceId,
    sourcePath: `fixtures/${documentId}.md`,
    sourceHash: `sha256:${documentId}`,
    documentType: "document",
    title: `Renewal plan ${documentId}`,
    summary: "Renewal budget and approval evidence.",
    metadata: {
      unifiedSource: {
        sourceType: "document",
        providerId: "fixture",
        externalId: sourceId,
        capturedAt: "2026-05-17T00:00:00.000Z"
      }
    },
    sections: [
      {
        sectionId: `${documentId}-section`,
        documentId,
        title: "Renewal",
        level: 1,
        position: 1,
        metadata: {}
      }
    ],
    blocks: [
      {
        blockId,
        documentId,
        sectionId: `${documentId}-section`,
        blockType: "text",
        title: "Budget approval",
        text: "Renewal budget approval is required before the launch deadline.",
        snippet: "Renewal budget approval is required.",
        position: 1,
        sourceLocator: {
          sourcePath: `fixtures/${documentId}.md`,
          sourceRange: { startLine: 2, endLine: 4 }
        },
        metadata: {
          blockKind: "approval"
        }
      }
    ],
    assets: [
      {
        assetId,
        documentId,
        sectionId: `${documentId}-section`,
        title: "Approval scan",
        caption: "Renewal budget approval scan",
        ocrText: "Renewal budget approval scan",
        mediaType: "image/png",
        sourceLocator: {
          sourcePath: `fixtures/${documentId}.png`
        },
        metadata: {
          assetKind: "scan"
        }
      }
    ]
  };
}

function buildFakeEmbeddingRuntime() {
  return {
    embedText(input = "") {
      const text = String(input || "");
      return {
        providerId: "fake-text-embedder",
        dimension: 128,
        vector: Array.from({ length: 128 }, (_, index) => (index === 0 ? text.length : 0))
      };
    },
    embedImageEvidence(asset = {}) {
      const text = String(asset.caption || asset.ocrText || asset.text || asset.title || "");
      return {
        providerId: "fake-image-embedder",
        dimension: 128,
        vector: Array.from({ length: 128 }, (_, index) => (index === 1 ? text.length : 0))
      };
    }
  };
}

function buildFakeCore({
  documents = [],
  syncResponses = [],
  searchResult = null
} = {}) {
  const docs = new Map(documents.map((document) => [document.documentId, clone(document)]));
  const calls = {
    capabilities: 0,
    health: 0,
    upsertDocuments: [],
    ingestBatch: [],
    ingestSources: [],
    deleteBatch: [],
    search: [],
    reindex: [],
    syncMirror: [],
    reload: [],
    closed: false
  };
  let syncIndex = 0;

  const core = {
    calls,
    capabilities() {
      calls.capabilities += 1;
      return {
        protocolVersion: "pact.knowledge.v1",
        supports: {
          knowledgeCoreLocalSearch: true,
          evidenceRead: false,
          externalMirror: true
        },
        coreKind: "fake-core"
      };
    },
    async health() {
      calls.health += 1;
      return {
        ok: true,
        coreKind: "fake-core",
        enabled: true
      };
    },
    async upsertDocuments(input = {}) {
      calls.upsertDocuments.push(clone(input));
      for (const document of input.documents || []) {
        docs.set(document.documentId, clone(document));
      }
      return {
        protocolVersion: "pact.knowledge.v1",
        coreUpserted: (input.documents || []).length
      };
    },
    async ingestBatch(input = {}) {
      calls.ingestBatch.push(clone(input));
      return {
        protocolVersion: "pact.knowledge.v1",
        batchId: String(input.batchId || ""),
        coreIngestedBatch: true
      };
    },
    async ingestSources(input = {}) {
      calls.ingestSources.push(clone(input));
      return {
        protocolVersion: "pact.knowledge.v1",
        batchId: String(input.batchId || ""),
        coreIngestedSources: true
      };
    },
    async deleteBatch(batchId = "") {
      calls.deleteBatch.push(String(batchId || ""));
      for (const [documentId, document] of [...docs.entries()]) {
        if (String(document.batchId || "") === String(batchId || "")) {
          docs.delete(documentId);
        }
      }
      return {
        protocolVersion: "pact.knowledge.v1",
        ok: true,
        batchId: String(batchId || "")
      };
    },
    async search(input = {}) {
      calls.search.push(clone(input));
      return (
        searchResult || {
          protocolVersion: "pact.knowledge.v1",
          query: String(input.query || ""),
          retrievalMode: "keyword",
          items: [],
          coreFallback: true
        }
      );
    },
    getEvidence(input = {}) {
      return {
        evidenceId: String(input.evidenceId || "core-evidence"),
        source: "core-fallback",
        protocolVersion: "pact.knowledge.v1"
      };
    },
    renderMarkdown(input = {}) {
      return {
        protocolVersion: "pact.knowledge.v1",
        evidenceId: String(input.evidenceId || "core-evidence"),
        contentType: "text/markdown; charset=utf-8",
        markdown: "# core fallback\n"
      };
    },
    async reindex(input = {}) {
      calls.reindex.push(clone(input));
      return {
        protocolVersion: "pact.knowledge.v1",
        coreReindexed: true
      };
    },
    async syncMirror({ since = 0, limit = 1000 } = {}) {
      calls.syncMirror.push({ since, limit });
      const response = syncResponses[syncIndex] || {
        changes: [],
        cursor: since,
        latestCursor: since,
        hasMore: false
      };
      syncIndex += 1;
      return clone(response);
    },
    async getItem({ documentId } = {}) {
      return docs.get(String(documentId || "")) || null;
    },
    async reload({ settings = {} } = {}) {
      calls.reload.push(clone(settings));
    },
    async close() {
      calls.closed = true;
    },
    getMaintenance() {
      return { retrieval: { topK: 20 } };
    },
    setMaintenance(value = {}) {
      return { retrieval: { ...(value.retrieval || {}) } };
    },
    prepareHierarchyReasoning() {},
    recordFeedback() {},
    feedbackSince() { return []; },
    listSuggestions() { return []; },
    resolveSuggestion() {},
    listReviewItems() { return []; },
    resolveReviewItem() {},
    runLearningJob() {},
    learningHealth() { return { ok: true }; },
    createRetrievalProfileDeployment() {},
    listRetrievalProfileDeployments() { return []; },
    promoteRetrievalProfileDeployment() {},
    rollbackRetrievalProfileDeployment() {},
    auditHierarchyIndex() {},
    aggregate() { return {}; },
    getAssetContent() { return null; },
    exportDocx() { return null; },
    getDocumentStructure() { return null; },
    runMaintenance() {},
    listMaintenanceRuns() { return []; },
    listRetrievalProfiles() { return []; },
    getRetrievalProfile() { return null; }
  };

  return core;
}

async function startMockQdrant({ failSearch = false, failDelete = false } = {}) {
  const state = {
    collectionCreated: false,
    points: new Map(),
    requests: []
  };
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    state.requests.push({ method: request.method, pathname: url.pathname });
    response.setHeader("content-type", "application/json");
    try {
      if (request.method === "GET" && url.pathname === "/collections/pact_external_test") {
        if (!state.collectionCreated) {
          response.statusCode = 404;
          response.end(JSON.stringify({ status: { error: "not found" } }));
          return;
        }
        response.end(JSON.stringify({ result: { status: "green" } }));
        return;
      }
      if (request.method === "PUT" && url.pathname === "/collections/pact_external_test") {
        state.collectionCreated = true;
        response.end(JSON.stringify({ result: true }));
        return;
      }
      if (request.method === "PUT" && url.pathname === "/collections/pact_external_test/points") {
        const body = await readJson(request);
        for (const point of body.points || []) {
          state.points.set(String(point.id), point);
        }
        response.end(JSON.stringify({ result: { operation_id: 1, status: "completed" } }));
        return;
      }
      if (request.method === "POST" && url.pathname === "/collections/pact_external_test/points/search") {
        const body = await readJson(request);
        if (failSearch) {
          response.statusCode = 500;
          response.end(JSON.stringify({ error: "search unavailable" }));
          return;
        }
        const result = [...state.points.values()]
          .filter((point) => matchesQdrantFilter(point.payload || {}, body.filter || {}))
          .map((point, index) => ({
            id: point.id,
            score: 0.96 - index * 0.05,
            payload: point.payload
          }));
        response.end(JSON.stringify({ result }));
        return;
      }
      if (request.method === "POST" && url.pathname === "/collections/pact_external_test/points/delete") {
        if (failDelete) {
          response.statusCode = 500;
          response.end(JSON.stringify({ error: "delete unavailable" }));
          return;
        }
        const body = await readJson(request);
        for (const [id, point] of state.points.entries()) {
          if (matchesQdrantFilter(point.payload || {}, body.filter || {})) {
            state.points.delete(id);
          }
        }
        response.end(JSON.stringify({ result: { operation_id: 2, status: "completed" } }));
        return;
      }
      response.statusCode = 404;
      response.end(JSON.stringify({ error: "not found" }));
    } catch (error) {
      response.statusCode = 500;
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
  });

  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const fixture = {
    state,
    baseUrl: `http://127.0.0.1:${address.port}`,
    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  };
  return fixture;
}

function matchesQdrantFilter(payload = {}, filter = {}) {
  for (const condition of filter.must || []) {
    const key = condition.key;
    const match = condition.match || {};
    if (Object.prototype.hasOwnProperty.call(match, "value") && payload[key] !== match.value) {
      return false;
    }
    if (Array.isArray(match.any) && !match.any.includes(payload[key])) {
      return false;
    }
  }
  return true;
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text.trim() ? JSON.parse(text) : {};
}

function matchesOpenSearchFilters(source = {}, filters = []) {
  for (const filter of filters) {
    if (filter.term) {
      const [[key, value]] = Object.entries(filter.term);
      if (source[key] !== value) {
        return false;
      }
    }
    if (filter.terms) {
      const [[key, values]] = Object.entries(filter.terms);
      if (!values.includes(source[key])) {
        return false;
      }
    }
  }
  return true;
}

async function startMockOpenSearch({ failLexical = false } = {}) {
  const state = {
    indexCreated: false,
    documents: new Map(),
    requests: []
  };
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    state.requests.push({ method: request.method, pathname: url.pathname });
    response.setHeader("content-type", "application/json");
    try {
      if (request.method === "HEAD" && url.pathname === "/pact_external_test") {
        response.statusCode = state.indexCreated ? 200 : 404;
        response.end();
        return;
      }
      if (request.method === "PUT" && url.pathname === "/pact_external_test") {
        state.indexCreated = true;
        response.end(JSON.stringify({ acknowledged: true }));
        return;
      }
      if (request.method === "POST" && url.pathname === "/_bulk") {
        const chunks = [];
        for await (const chunk of request) {
          chunks.push(chunk);
        }
        const lines = Buffer.concat(chunks).toString("utf8").trim().split("\n").filter(Boolean);
        for (let index = 0; index < lines.length; index += 2) {
          const action = JSON.parse(lines[index]);
          const source = JSON.parse(lines[index + 1]);
          state.documents.set(action.index._id, source);
        }
        response.end(JSON.stringify({ errors: false, items: [] }));
        return;
      }
      if (request.method === "POST" && url.pathname === "/pact_external_test/_search") {
        const body = await readJson(request);
        const filters = body.query?.bool?.filter || body.query?.knn?.embedding?.filter?.bool?.filter || [];
        const isLexical = Boolean(body.query?.bool?.must?.multi_match);
        if (isLexical && failLexical) {
          response.statusCode = 500;
          response.end(JSON.stringify({ error: "lexical search unavailable" }));
          return;
        }
        const hits = [...state.documents.entries()]
          .filter(([, source]) => matchesOpenSearchFilters(source, filters))
          .map(([id, source], index) => ({
            _id: id,
            _score: (isLexical ? 2.5 : 2.1) - index * 0.1,
            _source: source
          }));
        response.end(JSON.stringify({ hits: { hits } }));
        return;
      }
      if (request.method === "POST" && url.pathname === "/pact_external_test/_delete_by_query") {
        const body = await readJson(request);
        const filters = body.query?.bool?.filter || [];
        for (const [id, source] of state.documents.entries()) {
          if (matchesOpenSearchFilters(source, filters)) {
            state.documents.delete(id);
          }
        }
        response.end(JSON.stringify({ deleted: 1 }));
        return;
      }
      response.statusCode = 404;
      response.end(JSON.stringify({ error: "not found" }));
    } catch (error) {
      response.statusCode = 500;
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
  });

  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const fixture = {
    state,
    baseUrl: `http://127.0.0.1:${address.port}`,
    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  };
  return fixture;
}

function makePgState({ failSchema = false, failUpsert = false } = {}) {
  return {
    instances: [],
    ended: false,
    records: new Map(),
    queries: [],
    query(sql, params = []) {
      this.queries.push({ sql, params });
      const normalizedSql = String(sql || "").trim();
      if (normalizedSql.startsWith("CREATE EXTENSION")) {
        if (failSchema) {
          throw new Error("pg schema unavailable");
        }
        return { rows: [], rowCount: 0 };
      }
      if (normalizedSql.startsWith("CREATE TABLE IF NOT EXISTS pact_external_knowledge")) {
        if (failSchema) {
          throw new Error("pg schema unavailable");
        }
        return { rows: [], rowCount: 0 };
      }
      if (normalizedSql.startsWith("CREATE INDEX IF NOT EXISTS idx_pact_external_knowledge")) {
        if (failSchema) {
          throw new Error("pg schema unavailable");
        }
        return { rows: [], rowCount: 0 };
      }
      if (normalizedSql.startsWith("INSERT INTO pact_external_knowledge")) {
        if (failUpsert) {
          throw new Error("pg upsert unavailable");
        }
        const [recordId, externalId, targetType, targetId, documentId, sectionId, blockId, assetId, batchId, sourceId, title, text, snippet] = params;
        this.records.set(String(recordId), {
          recordId: String(recordId),
          externalId: String(externalId),
          targetType: String(targetType),
          targetId: String(targetId),
          documentId: String(documentId),
          sectionId: String(sectionId || ""),
          blockId: String(blockId || ""),
          assetId: String(assetId || ""),
          batchId: String(batchId || ""),
          sourceId: String(sourceId || ""),
          title: String(title || ""),
          text: String(text || ""),
          snippet: String(snippet || ""),
          deleted: false
        });
        return { rows: [], rowCount: 1 };
      }
      if (normalizedSql.includes("FROM pact_external_knowledge") && normalizedSql.includes("embedding <=> $1::vector")) {
        let index = 2;
        let batchId = "";
        let sourceIds = [];
        if (typeof params[index] === "string") {
          batchId = params[index];
          index += 1;
        }
        if (Array.isArray(params[index])) {
          sourceIds = params[index];
          index += 1;
        }
        const limit = Number(params[index] || 20);
        const rows = [...this.records.values()]
          .filter((record) => !record.deleted)
          .filter((record) => !batchId || record.batchId === batchId)
          .filter((record) => !sourceIds.length || sourceIds.includes(record.sourceId))
          .map((record, rowIndex) => ({
            record_id: record.recordId,
            external_id: record.externalId,
            score: 1 - rowIndex * 0.1
          }))
          .slice(0, limit);
        return { rows, rowCount: rows.length };
      }
      if (normalizedSql.startsWith("UPDATE pact_external_knowledge SET deleted_at = now()")) {
        const batchId = String(params[0] || "");
        let count = 0;
        for (const record of this.records.values()) {
          if (!record.deleted && record.batchId === batchId) {
            record.deleted = true;
            count += 1;
          }
        }
        return { rows: [], rowCount: count };
      }
      return { rows: [], rowCount: 0 };
    }
  };
}

async function importMount() {
  const module = await import("../../../server/platform/specialized/knowledge/storage/external-knowledge-base/index.mjs");
  return module.createExternalKnowledgeBaseMount;
}

beforeEach(() => {
  harness.createCoreMount = null;
  harness.createEmbeddingRuntime = null;
  harness.pgState = null;
});

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  vi.resetModules();
});

describe("external knowledge base mount", () => {
  it("covers disabled/local capability, health, search, evidence, render, and delete flows", async () => {
    const userDataPath = await tempDir("pact-external-kb-disabled-");
    const document = buildDocument({ batchId: "batch-local", documentId: "doc-local", sourceId: "source-local" });
    const core = buildFakeCore({ documents: [document] });
    harness.createCoreMount = async (options = {}) => {
      core.mountOptions = clone(options);
      return core;
    };
    harness.createEmbeddingRuntime = () => buildFakeEmbeddingRuntime();

    const createExternalKnowledgeBaseMount = await importMount();
    const mount = await createExternalKnowledgeBaseMount({ userDataPath });

    try {
      expect(core.mountOptions).toMatchObject({ userDataPath, outlineEnabled: true });

      const capabilities = mount.capabilities();
      expect(capabilities).toMatchObject({
        adapterProtocolVersion: "pact.external-knowledge-adapter.v1",
        backend: {
          adapterId: "external-knowledge-base",
          backendKind: "external-disabled",
          vendor: "disabled"
        },
        supports: {
          knowledgeCoreLocalSearch: true,
          evidenceRead: true,
          vectorSearch: false,
          lexicalSearch: false,
          hybridSearch: false,
          search: true,
          deleteBatch: true,
          reindex: true
        },
        externalKnowledgeBase: {
          enabled: false,
          provider: "disabled"
        }
      });

      await mount.upsertDocuments({ documents: [document] });
      const emptyUpsert = await mount.upsertDocuments({ documents: [] });
      expect(emptyUpsert.externalKnowledgeBase).toMatchObject({
        upserted: 0
      });
      const health = await mount.health();
      expect(health).toMatchObject({
        ok: true,
        degraded: true,
        backend: {
          enabled: false,
          provider: "disabled"
        },
        external: {
          ok: true,
          enabled: false,
          degraded: true
        },
        counts: {
          records: 2,
          tombstones: 0
        }
      });

      const search = await mount.search({
        query: "renewal budget approval",
        batchId: "batch-local",
        scopeSourceIds: ["source-local", "source-missing"],
        limit: 5
      });
      expect(search).toMatchObject({
        protocolVersion: "pact.knowledge.v1",
        query: "renewal budget approval",
        batchId: "batch-local",
        retrievalMode: "hybrid",
        externalKnowledgeBase: {
          provider: "disabled",
          enabled: false,
          used: false,
          fallback: true,
          error: ""
        }
      });
      expect(search.items).toHaveLength(2);
      expect(search.items.some((item) => item.modalities.includes("text"))).toBe(true);
      expect(search.items.some((item) => item.modalities.includes("image"))).toBe(true);

      const evidence = await mount.getEvidence({ evidenceId: search.items[0].evidenceId });
      expect(evidence).toMatchObject({
        evidenceId: search.items[0].evidenceId,
        documentId: "doc-local",
        batchId: "batch-local"
      });
      expect(evidence.markdown).toMatch(/source: external-knowledge-base/);
      expect(evidence.markdown).toMatch(/Renewal budget approval/);

      const rendered = await mount.renderMarkdown({ evidenceId: search.items[0].evidenceId });
      expect(rendered).toMatchObject({
        contentType: "text/markdown; charset=utf-8",
        evidenceId: search.items[0].evidenceId
      });
      expect(rendered.markdown).toMatch(/pact_knowledge:/);
      expect(rendered.markdown).toMatch(/Budget approval|Approval scan/);

      expect(mount.getEvidence({ evidenceId: "missing-core-evidence" })).toMatchObject({
        source: "core-fallback"
      });
      expect(mount.renderMarkdown({ evidenceId: "missing-core-evidence" })).toMatchObject({
        markdown: "# core fallback\n"
      });

      const fallbackSearch = await mount.search({
        query: "not in sidecar",
        batchId: "batch-local",
        scopeSourceIds: ["source-local"]
      });
      expect(fallbackSearch).toMatchObject({
        retrievalMode: "keyword",
        coreFallback: true,
        externalKnowledgeBase: {
          provider: "disabled",
          enabled: false,
          used: false,
          fallback: true
        }
      });
      expect(fallbackSearch.items).toHaveLength(0);

      const deleted = await mount.deleteBatch("batch-local");
      expect(deleted).toMatchObject({
        batchId: "batch-local",
        externalKnowledgeBase: {
          sidecarDeleted: 2
        }
      });

      const afterDelete = await mount.search({
        query: "renewal budget approval",
        batchId: "batch-local",
        scopeSourceIds: ["source-local"],
        limit: 5
      });
      expect(afterDelete.items).toHaveLength(0);
      expect(afterDelete.coreFallback).toBe(true);

      const afterDeleteHealth = await mount.health();
      expect(afterDeleteHealth.counts).toMatchObject({
        records: 0,
        tombstones: 2
      });
    } finally {
      await mount.close();
      expect(core.calls.closed).toBe(true);
    }
  });

  it("covers ingestBatch, ingestSources, and reindex syncing from core changes", async () => {
    const userDataPath = await tempDir("pact-external-kb-sync-");
    const document = buildDocument({ batchId: "batch-sync", documentId: "doc-sync", sourceId: "source-sync" });
    const core = buildFakeCore({
      documents: [document],
      syncResponses: [
        {
          changes: [
            { kind: "document", entityId: "doc-sync" }
          ],
          cursor: 11,
          latestCursor: 11,
          hasMore: false
        },
        {
          changes: [
            { kind: "block", itemId: "doc-sync" }
          ],
          cursor: 22,
          latestCursor: 22,
          hasMore: false
        },
        {
          changes: [
            { action: "delete", entityId: "doc-sync-asset" },
            { kind: "document", entityId: "doc-sync" }
          ],
          cursor: 33,
          latestCursor: 33,
          hasMore: false
        }
      ]
    });
    harness.createCoreMount = async () => core;
    harness.createEmbeddingRuntime = () => buildFakeEmbeddingRuntime();

    const createExternalKnowledgeBaseMount = await importMount();
    const mount = await createExternalKnowledgeBaseMount({ userDataPath });

    try {
      const ingestBatch = await mount.ingestBatch({
        batchId: "batch-sync",
        result: { sourceFiles: [{ id: "source-sync" }] }
      });
      expect(ingestBatch.coreIngestedBatch).toBe(true);
      expect(ingestBatch.externalKnowledgeBase).toMatchObject({
        upserted: 2,
        tombstoned: 0
      });

      const ingestSources = await mount.ingestSources({
        batchId: "batch-sync",
        sources: [{ id: "source-sync" }]
      });
      expect(ingestSources.coreIngestedSources).toBe(true);
      expect(ingestSources.externalKnowledgeBase).toMatchObject({
        upserted: 2,
        tombstoned: 0
      });

      const reindex = await mount.reindex({ batchId: "batch-sync" });
      expect(reindex.coreReindexed).toBe(true);
      expect(reindex.externalKnowledgeBase).toMatchObject({
        upserted: 2,
        tombstoned: 1,
        cursor: "33"
      });
      expect(core.calls.syncMirror).toHaveLength(3);
    } finally {
      await mount.close();
    }
  });

  it("covers qdrant capability, health, upsert, search, and delete flows", async () => {
    const userDataPath = await tempDir("pact-external-kb-qdrant-");
    const qdrant = await startMockQdrant();
    const document = buildDocument({ batchId: "batch-qdrant", documentId: "doc-qdrant", sourceId: "source-qdrant" });
    const core = buildFakeCore({ documents: [document] });
    harness.createCoreMount = async () => core;
    harness.createEmbeddingRuntime = () => buildFakeEmbeddingRuntime();

    const createExternalKnowledgeBaseMount = await importMount();
    const mount = await createExternalKnowledgeBaseMount({
      userDataPath,
      runtimeOptions: {
        externalKnowledgeBase: {
          provider: "qdrant",
          endpoint: qdrant.baseUrl,
          collection: "pact_external_test",
          dimension: 128
        }
      }
    });

    try {
      const health = await mount.health();
      expect(health.external).toMatchObject({
        ok: true,
        enabled: true,
        providerId: "qdrant",
        backend: "qdrant",
        collection: "pact_external_test"
      });

      const capabilities = mount.capabilities();
      expect(capabilities.supports.vectorSearch).toBe(true);
      expect(capabilities.supports.lexicalSearch).toBe(false);
      expect(capabilities.backend).toMatchObject({
        backendKind: "external",
        vendor: "qdrant",
        profileId: "pact_external_test"
      });

      const upsert = await mount.upsertDocuments({ documents: [document] });
      expect(upsert.externalKnowledgeBase.providerId).toBe("qdrant");
      expect(qdrant.state.points.size).toBe(2);

      const search = await mount.search({
        query: "renewal budget approval",
        batchId: "batch-qdrant",
        scopeSourceIds: ["source-qdrant"]
      });
      expect(search.externalKnowledgeBase).toMatchObject({
        provider: "qdrant",
        enabled: true,
        used: true,
        fallback: false
      });
      expect(search.retrievalMode).toBe("vector");
      expect(search.items).toHaveLength(2);
      expect(search.items[0].reasons[0].backendTrace.providerId).toBe("qdrant");

      const deleted = await mount.deleteBatch("batch-qdrant");
      expect(deleted.externalKnowledgeBase.external).toMatchObject({
        providerId: "qdrant",
        deletedBatchId: "batch-qdrant"
      });

      const afterDelete = await mount.search({
        query: "renewal budget approval",
        batchId: "batch-qdrant",
        scopeSourceIds: ["source-qdrant"]
      });
      expect(afterDelete.items).toHaveLength(0);
      expect(qdrant.state.points.size).toBe(0);
    } finally {
      await mount.close();
      await qdrant.close();
    }
  });

  it("covers search failure fallback, onBatchCompleted skip, and reload", async () => {
    const userDataPath = await tempDir("pact-external-kb-reload-");
    const qdrant = await startMockQdrant({ failSearch: true, failDelete: true });
    const document = buildDocument({ batchId: "batch-reload", documentId: "doc-reload", sourceId: "source-reload" });
    const core = buildFakeCore({ documents: [document] });
    harness.createCoreMount = async (options = {}) => {
      core.mountOptions = clone(options);
      return core;
    };
    harness.createEmbeddingRuntime = () => buildFakeEmbeddingRuntime();

    const createExternalKnowledgeBaseMount = await importMount();
    const mount = await createExternalKnowledgeBaseMount({
      userDataPath,
      runtimeOptions: {
        externalKnowledgeBase: {
          provider: "qdrant",
          endpoint: qdrant.baseUrl,
          collection: "pact_external_test",
          dimension: 128
        }
      }
    });

    try {
      await mount.upsertDocuments({ documents: [document] });

      const search = await mount.search({
        query: "renewal budget approval",
        batchId: "batch-reload",
        scopeSourceIds: ["source-reload"]
      });
      expect(search.externalKnowledgeBase).toMatchObject({
        provider: "qdrant",
        enabled: true,
        used: false,
        fallback: true
      });
      expect(search.externalKnowledgeBase.error).toMatch(/500|search unavailable/);
      expect(search.items).toHaveLength(2);

      const delegated = await mount.onBatchCompleted({
        batchId: "batch-reload",
        result: {}
      });
      expect(delegated.externalKnowledgeBase).toBeDefined();

      const skipped = await mount.onBatchCompleted({
        batchId: "batch-reload",
        result: {},
        settings: {
          knowledgeCoreEnabled: false
        }
      });
      expect(skipped).toMatchObject({
        skipped: true,
        reason: "knowledgeCoreEnabled=false"
      });

      const deleteFailure = await mount.deleteBatch("batch-reload");
      expect(deleteFailure.externalKnowledgeBase.external).toMatchObject({
        deleted: 0,
        degraded: true
      });

      await mount.reload({
        settings: {
          externalKnowledgeBase: {
            provider: "disabled"
          }
        }
      });
      expect(core.calls.reload).toHaveLength(1);
      expect(mount.capabilities().backend.backendKind).toBe("external-disabled");
      expect((await mount.health()).external.enabled).toBe(false);
    } finally {
      await mount.close();
      await qdrant.close();
    }
  });

  it("covers opensearch capability, degraded search fusion, and delete flows", async () => {
    const userDataPath = await tempDir("pact-external-kb-opensearch-");
    const opensearch = await startMockOpenSearch({ failLexical: true });
    const document = buildDocument({ batchId: "batch-opensearch", documentId: "doc-opensearch", sourceId: "source-opensearch" });
    const core = buildFakeCore({ documents: [document] });
    harness.createCoreMount = async () => core;
    harness.createEmbeddingRuntime = () => buildFakeEmbeddingRuntime();

    const createExternalKnowledgeBaseMount = await importMount();
    const mount = await createExternalKnowledgeBaseMount({
      userDataPath,
      runtimeOptions: {
        externalKnowledgeBase: {
          provider: "opensearch",
          endpoint: opensearch.baseUrl,
          collection: "pact_external_test",
          dimension: 128
        }
      }
    });

    try {
      const health = await mount.health();
      expect(health.external).toMatchObject({
        ok: true,
        enabled: true,
        providerId: "opensearch",
        backend: "opensearch",
        index: "pact_external_test"
      });

      const upsert = await mount.upsertDocuments({ documents: [document] });
      expect(upsert.externalKnowledgeBase.providerId).toBe("opensearch");
      expect(opensearch.state.documents.size).toBe(2);

      const search = await mount.search({
        query: "renewal budget approval",
        batchId: "batch-opensearch",
        scopeSourceIds: ["source-opensearch"]
      });
      expect(search.externalKnowledgeBase).toMatchObject({
        provider: "opensearch",
        enabled: true,
        used: true,
        fallback: false
      });
      expect(search.retrievalMode).toBe("hybrid");
      expect(search.items).toHaveLength(2);
      expect(search.items[0].reasons[0].backendTrace.providerId).toBe("opensearch");

      const deleted = await mount.deleteBatch("batch-opensearch");
      expect(deleted.externalKnowledgeBase.external).toMatchObject({
        providerId: "opensearch",
        deletedBatchId: "batch-opensearch"
      });

      const afterDelete = await mount.search({
        query: "renewal budget approval",
        batchId: "batch-opensearch",
        scopeSourceIds: ["source-opensearch"]
      });
      expect(afterDelete.items).toHaveLength(0);
      expect(opensearch.state.documents.size).toBe(0);
    } finally {
      await mount.close();
      await opensearch.close();
    }
  });

  it("covers pgvector health, upsert, search, and delete flows with a fake pg pool", async () => {
    const userDataPath = await tempDir("pact-external-kb-pg-");
    const document = buildDocument({ batchId: "batch-pg", documentId: "doc-pg", sourceId: "source-pg" });
    const core = buildFakeCore({ documents: [document] });
    harness.createCoreMount = async () => core;
    harness.createEmbeddingRuntime = () => buildFakeEmbeddingRuntime();
    harness.pgState = makePgState();

    const createExternalKnowledgeBaseMount = await importMount();
    const mount = await createExternalKnowledgeBaseMount({
      userDataPath,
      runtimeOptions: {
        externalKnowledgeBase: {
          provider: "pgvector",
          connectionString: "postgres://user:pass@127.0.0.1:5432/pact",
          collection: "pact_external_test",
          dimension: 128
        }
      }
    });

    try {
      const health = await mount.health();
      expect(health.external).toMatchObject({
        ok: true,
        enabled: true,
        providerId: "pgvector",
        backend: "postgresql-pgvector"
      });

      const upsert = await mount.upsertDocuments({ documents: [document] });
      expect(upsert.externalKnowledgeBase.providerId).toBe("pgvector");
      expect(harness.pgState.records.size).toBe(2);

      const search = await mount.search({
        query: "renewal budget approval",
        batchId: "batch-pg",
        scopeSourceIds: ["source-pg"]
      });
      expect(search.externalKnowledgeBase).toMatchObject({
        provider: "pgvector",
        enabled: true,
        used: true,
        fallback: false
      });
      expect(search.retrievalMode).toBe("hybrid");
      expect(search.items).toHaveLength(2);
      expect(search.items[0].reasons[0].backendTrace.providerId).toBe("pgvector");

      const deleted = await mount.deleteBatch("batch-pg");
      expect(deleted.externalKnowledgeBase.external).toMatchObject({
        providerId: "pgvector",
        deleted: 2
      });

      const afterDelete = await mount.search({
        query: "renewal budget approval",
        batchId: "batch-pg",
        scopeSourceIds: ["source-pg"]
      });
      expect(afterDelete.items).toHaveLength(0);
      expect(harness.pgState.records.size).toBe(2);
      expect(harness.pgState.ended).toBe(false);
    } finally {
      await mount.close();
      expect(harness.pgState.ended).toBe(true);
    }
  });

  it("covers pgvector health and upsert degradation when schema or insert fails", async () => {
    const document = buildDocument({ batchId: "batch-pg-fail", documentId: "doc-pg-fail", sourceId: "source-pg-fail" });
    const createExternalKnowledgeBaseMount = await importMount();

    const healthPath = await tempDir("pact-external-kb-pg-health-fail-");
    const healthCore = buildFakeCore({ documents: [document] });
    harness.createCoreMount = async () => healthCore;
    harness.createEmbeddingRuntime = () => buildFakeEmbeddingRuntime();
    harness.pgState = makePgState({ failSchema: true });
    const healthMount = await createExternalKnowledgeBaseMount({
      userDataPath: healthPath,
      runtimeOptions: {
        externalKnowledgeBase: {
          provider: "pgvector",
          connectionString: "postgres://user:pass@127.0.0.1:5432/pact",
          collection: "pact_external_test",
          dimension: 128
        }
      }
    });

    try {
      const health = await healthMount.health();
      expect(health.external).toMatchObject({
        ok: false,
        enabled: true,
        degraded: true,
        providerId: "pgvector",
        backend: "postgresql-pgvector"
      });
      expect(health.external.error).toMatch(/pg schema unavailable/);
    } finally {
      await healthMount.close();
    }

    const upsertPath = await tempDir("pact-external-kb-pg-upsert-fail-");
    const upsertCore = buildFakeCore({ documents: [document] });
    harness.createCoreMount = async () => upsertCore;
    harness.createEmbeddingRuntime = () => buildFakeEmbeddingRuntime();
    harness.pgState = makePgState({ failUpsert: true });
    const upsertMount = await createExternalKnowledgeBaseMount({
      userDataPath: upsertPath,
      runtimeOptions: {
        externalKnowledgeBase: {
          provider: "pgvector",
          connectionString: "postgres://user:pass@127.0.0.1:5432/pact",
          collection: "pact_external_test",
          dimension: 128
        }
      }
    });

    try {
      const health = await upsertMount.health();
      expect(health.external).toMatchObject({
        ok: true,
        enabled: true,
        providerId: "pgvector"
      });

      const upsert = await upsertMount.upsertDocuments({ documents: [document] });
      expect(upsert.externalKnowledgeBase).toMatchObject({
        providerId: "pgvector",
        upserted: 0,
        sidecarUpserted: 2,
        degraded: true
      });
      expect(upsert.externalKnowledgeBase.error).toMatch(/pg upsert unavailable/);
    } finally {
      await upsertMount.close();
    }
  });

  it("falls back to a disabled client for unsupported providers", async () => {
    const userDataPath = await tempDir("pact-external-kb-unsupported-");
    const core = buildFakeCore();
    harness.createCoreMount = async () => core;
    harness.createEmbeddingRuntime = () => buildFakeEmbeddingRuntime();

    const createExternalKnowledgeBaseMount = await importMount();
    const mount = await createExternalKnowledgeBaseMount({
      userDataPath,
      runtimeOptions: {
        externalKnowledgeBase: {
          provider: "unsupported-provider",
          endpoint: "http://127.0.0.1:1",
          collection: "pact_external_test",
          dimension: 128
        }
      }
    });

    try {
      expect(mount.capabilities()).toMatchObject({
        backend: {
          backendKind: "external",
          vendor: "unsupported-provider"
        },
        externalKnowledgeBase: {
          provider: "unsupported-provider",
          enabled: true
        }
      });

      const health = await mount.health();
      expect(health.external).toMatchObject({
        ok: true,
        enabled: false,
        degraded: true,
        providerId: "unsupported-provider"
      });
    } finally {
      await mount.close();
    }
  });
});
