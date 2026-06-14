import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createExternalKnowledgeBaseMount } from "../platform/specialized/knowledge/storage/external-knowledge-base/index.mjs";

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text.trim() ? JSON.parse(text) : {};
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

async function startMockQdrant() {
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
        await readJson(request);
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
        const result = [...state.points.values()]
          .filter((point) => matchesQdrantFilter(point.payload || {}, body.filter || {}))
          .map((point, index) => ({
            id: point.id,
            score: 0.95 - index * 0.05,
            payload: point.payload
          }));
        response.end(JSON.stringify({ result }));
        return;
      }
      if (request.method === "POST" && url.pathname === "/collections/pact_external_test/points/delete") {
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
  return {
    state,
    baseUrl: `http://127.0.0.1:${address.port}`,
    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  };
}

function matchesOpenSearchFilters(source = {}, filters = []) {
  for (const filter of filters) {
    if (filter.term) {
      const [[key, value]] = Object.entries(filter.term);
      if (source[key] !== value) return false;
    }
    if (filter.terms) {
      const [[key, values]] = Object.entries(filter.terms);
      if (!values.includes(source[key])) return false;
    }
  }
  return true;
}

async function startMockOpenSearch() {
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
        await readJson(request);
        response.end(JSON.stringify({ acknowledged: true }));
        return;
      }
      if (request.method === "POST" && url.pathname === "/_bulk") {
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
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
        const hits = [...state.documents.entries()]
          .filter(([, source]) => matchesOpenSearchFilters(source, filters))
          .map(([id, source], index) => ({
            _id: id,
            _score: 2.5 - index * 0.1,
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
  return {
    state,
    baseUrl: `http://127.0.0.1:${address.port}`,
    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  };
}

function buildKnowledgeDocument({
  batchId = "batch-external",
  documentId = "external-doc-renewal",
  sourceId = "source-renewal",
  blockId = "block-renewal-budget"
} = {}) {
  return {
    documentId,
    collectionId: "external-fixture",
    collectionTitle: "External Fixture",
    collectionType: "test",
    batchId,
    sourceId,
    documentType: "document",
    title: "Customer renewal plan",
    summary: "Renewal timeline and budget approval evidence.",
    sourcePath: "fixtures/customer-renewal.md",
    sourceHash: "sha256:external-fixture",
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
        sectionId: "section-renewal",
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
        sectionId: "section-renewal",
        blockType: "text",
        title: "Budget approval",
        text: "The renewal window opens in May. Legal review and budget approval must finish before the contract deadline.",
        snippet: "Legal review and budget approval before the deadline.",
        position: 1,
        sourceLocator: {
          sourcePath: "fixtures/customer-renewal.md",
          sourceRange: { startLine: 2, endLine: 4 }
        },
        metadata: {
          chunkId: "chunk-renewal-budget"
        }
      }
    ],
    assets: []
  };
}

async function assertQdrantAdapter() {
  const mockQdrant = await startMockQdrant();
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-external-kb-"));
  const mount = await createExternalKnowledgeBaseMount({
    userDataPath,
    runtimeOptions: {
      externalKnowledgeBase: {
        provider: "qdrant",
        endpoint: mockQdrant.baseUrl,
        collection: "pact_external_test",
        dimension: 128
      }
    }
  });

  try {
    const upsert = await mount.upsertDocuments({ documents: [buildKnowledgeDocument()] });
    assert.equal(upsert.externalKnowledgeBase.providerId, "qdrant");
    assert.equal(mockQdrant.state.points.size, 1);

    const health = await mount.health();
    assert.equal(health.ok, true);
    assert.equal(health.external.providerId, "qdrant");

    const search = await mount.search({
      query: "renewal budget approval",
      limit: 5,
      batchId: "batch-external"
    });
    assert.equal(search.protocolVersion, "v0.0.1:knowledge:core-1");
    assert.equal(search.externalKnowledgeBase.used, true);
    assert.equal(search.items.length, 1);
    assert.match(search.items[0].title, /Budget approval/);

    const evidence = await mount.getEvidence({ evidenceId: search.items[0].evidenceId });
    assert.equal(evidence.documentId, "external-doc-renewal");
    assert.match(evidence.markdown, /pact_knowledge:/);
    assert.match(evidence.markdown, /budget approval/i);

    const rendered = await mount.renderMarkdown({ evidenceId: search.items[0].evidenceId });
    assert.equal(rendered.contentType, "text/markdown; charset=utf-8");
    assert.match(rendered.markdown, /Customer renewal|Budget approval/);

    const deleted = await mount.deleteBatch("batch-external");
    assert.equal(deleted.externalKnowledgeBase.sidecarDeleted, 1);

    const afterDelete = await mount.search({
      query: "renewal budget approval",
      limit: 5,
      batchId: "batch-external"
    });
    assert.equal(afterDelete.items.length, 0);
    assert.equal([...mockQdrant.state.points.values()].length, 0);

    assert.ok(mockQdrant.state.requests.some((entry) => entry.pathname.endsWith("/points/search")));
  } finally {
    await mount.close();
    await mockQdrant.close();
  }
}

async function assertOpenSearchAdapter() {
  const mockOpenSearch = await startMockOpenSearch();
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-external-kb-os-"));
  const mount = await createExternalKnowledgeBaseMount({
    userDataPath,
    runtimeOptions: {
      externalKnowledgeBase: {
        provider: "opensearch",
        endpoint: mockOpenSearch.baseUrl,
        collection: "pact_external_test",
        dimension: 128
      }
    }
  });

  try {
    const upsert = await mount.upsertDocuments({
      documents: [
        buildKnowledgeDocument({
          batchId: "batch-opensearch",
          documentId: "external-doc-opensearch",
          sourceId: "source-opensearch",
          blockId: "block-opensearch-budget"
        })
      ]
    });
    assert.equal(upsert.externalKnowledgeBase.providerId, "opensearch");
    assert.equal(mockOpenSearch.state.documents.size, 1);

    const search = await mount.search({
      query: "renewal budget approval",
      limit: 5,
      batchId: "batch-opensearch"
    });
    assert.equal(search.externalKnowledgeBase.used, true);
    assert.equal(search.items.length, 1);
    assert.equal(search.items[0].documentId, "external-doc-opensearch");

    await mount.deleteBatch("batch-opensearch");
    const afterDelete = await mount.search({
      query: "renewal budget approval",
      limit: 5,
      batchId: "batch-opensearch"
    });
    assert.equal(afterDelete.items.length, 0);
    assert.equal(mockOpenSearch.state.documents.size, 0);
    assert.ok(mockOpenSearch.state.requests.some((entry) => entry.pathname.endsWith("/_search")));
  } finally {
    await mount.close();
    await mockOpenSearch.close();
  }
}

async function main() {
  await assertQdrantAdapter();
  await assertOpenSearchAdapter();
  console.log("external knowledge base verification passed");
}

await main();
