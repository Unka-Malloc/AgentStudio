import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startHttpServer } from "../services/server-runtime/http-server.mjs";
import { authHeaders, installAuthenticatedFetch } from "./test-auth-helper.mjs";

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  return {
    status: response.status,
    ok: response.ok,
    payload: text.trim() ? JSON.parse(text) : {}
  };
}

function mcpHeaders(token) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
    "X-Pact-Api-Key": token
  };
}

function mcpRequest(method, params = {}, id = 1) {
  return {
    jsonrpc: "2.0",
    id,
    method,
    params
  };
}

async function localMcpGrant(serverUrl, body = {}, headers = {}) {
  return fetchJson(`${serverUrl}/api/mcp/local-grant`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers
    },
    body: JSON.stringify(body)
  });
}

let requestId = 0;

async function callKnowledgeOperation({ serverUrl, token, operation, input = {} }) {
  requestId += 1;
  return fetchJson(`${serverUrl}/mcp`, {
    method: "POST",
    headers: mcpHeaders(token),
    body: JSON.stringify(mcpRequest("tools/call", {
      name: "pact.knowledge",
      arguments: {
        apiVersion: "pact.mcp.v1",
        operation,
        input,
        clientVersion: "verify-knowledge-transformation"
      }
    }, requestId))
  });
}

function structuredPayload(response) {
  return response.payload?.result?.structuredContent?.payload;
}

function assertKnowledgeOk(response, operation) {
  assert.equal(response.status, 200, JSON.stringify(response.payload, null, 2));
  assert.equal(response.payload.error, undefined, JSON.stringify(response.payload.error || {}, null, 2));
  assert.equal(response.payload.result.structuredContent.operation, operation);
  const payload = structuredPayload(response);
  assert.equal(payload?.ok, true, JSON.stringify(payload || {}, null, 2));
  assert.equal(payload.protocolVersion, "pact.knowledge-transformation.v1");
  assert.equal(payload.knowledgeAccessDecision?.allowed, true, JSON.stringify(payload.knowledgeAccessDecision || {}, null, 2));
  assert.ok(payload.contentBase64, `${operation} must return a portable contentBase64 package`);
  assert.ok(payload.byteSize > 0, `${operation} must render non-empty output`);
  return payload;
}

const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-knowledge-transformation-"));
const server = await startHttpServer({
  userDataPath,
  distPath: "",
  port: 0,
  runtimeOptions: {
    profile: "minimal"
  }
});

try {
  const auth = await installAuthenticatedFetch(server, { safetyConfirm: false });
  const grant = await localMcpGrant(server.url, {
    label: "verify-knowledge-transformation",
    toolsets: ["pact.knowledge.read", "pact.knowledge.write"],
    grantMode: "write",
    targets: ["knowledge-transformation-verify"]
  }, { "x-pact-safety-confirm": "true" });
  assert.equal(grant.status, 201, JSON.stringify(grant.payload, null, 2));
  const token = grant.payload.token;

  const raw = assertKnowledgeOk(await callKnowledgeOperation({
    serverUrl: server.url,
    token,
    operation: "pact.rawCorpus.format.convert",
    input: {
      targetFormat: "markdown",
      title: "Raw corpus conversion smoke",
      documents: [
        {
          title: "Mail thread",
          text: "Customer renewal evidence\nBudget approval follows.",
          sourcePath: "mail/customer-renewal.eml"
        }
      ]
    }
  }), "pact.rawCorpus.format.convert");
  assert.equal(raw.operationId, "raw-corpus.format.convert");
  assert.equal(raw.outputFormat, "markdown");
  assert.match(raw.content, /Customer renewal evidence/);

  const dossier = assertKnowledgeOk(await callKnowledgeOperation({
    serverUrl: server.url,
    token,
    operation: "pact.knowledge.dossier.export",
    input: {
      outputFormat: "html",
      query: "customer renewal",
      items: [
        {
          title: "Renewal approval",
          text: "Approval evidence is attached to the account renewal dossier.",
          sourcePath: "evidence/renewal.md"
        }
      ]
    }
  }), "pact.knowledge.dossier.export");
  assert.equal(dossier.operationId, "knowledge.dossier.export");
  assert.equal(dossier.outputFormat, "html");
  assert.equal(dossier.sourceDocumentCount, 1);
  assert.match(dossier.content, /Renewal approval/);

  const receipts = await fetchJson(`${server.url}/api/rpc`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(auth, { method: "POST" })
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "knowledge-access-receipts",
      method: "knowledge.access.receipt.list",
      params: { limit: 20 }
    })
  });
  assert.equal(receipts.status, 200, JSON.stringify(receipts.payload, null, 2));
  assert.ok(receipts.payload.result.count >= 3, JSON.stringify(receipts.payload.result, null, 2));
  assert.ok(
    receipts.payload.result.items.some((item) => item.accessMode === "exportAllowed"),
    "knowledge transformation exports must append AgentLibrary access receipts"
  );

  console.log("knowledge transformation protocol verification passed");
} finally {
  await server.close();
  await fs.rm(userDataPath, { recursive: true, force: true });
}
