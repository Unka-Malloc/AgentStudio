import http from "node:http";
import { URL } from "node:url";
import { createPactiumKernel } from "./kernel.js";
import { resolveDataDir } from "./paths.js";

export const PACTIUM_HTTP_PROTOCOL_VERSION = "v0.1.0:pactium:http-1";

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body)
  });
  response.end(body);
}

function notFound(response) {
  sendJson(response, 404, {
    code: "not_found",
    error: "Pactium endpoint not found."
  });
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) return {};
  return JSON.parse(text);
}

function queryObject(url) {
  return Object.fromEntries(url.searchParams.entries());
}

async function routeRequest({ kernel, request, response }) {
  const baseUrl = `http://${request.headers.host || "127.0.0.1"}`;
  const url = new URL(request.url || "/", baseUrl);
  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  try {
    if (request.method === "GET" && url.pathname === "/health") {
      return sendJson(response, 200, {
        protocolVersion: PACTIUM_HTTP_PROTOCOL_VERSION,
        ok: true,
        dataDir: kernel.dataDir
      });
    }
    if (request.method === "GET" && url.pathname === "/protocols") {
      return sendJson(response, 200, kernel.protocolCatalog());
    }
    if (request.method === "POST" && url.pathname === "/operations") {
      return sendJson(response, 200, await kernel.recordOperation(await readJson(request)));
    }
    if (request.method === "GET" && url.pathname === "/ledger") {
      return sendJson(response, 200, kernel.ledger.listEntries(queryObject(url)));
    }
    if (request.method === "GET" && parts[0] === "ledger" && parts[1]) {
      const entry = kernel.ledger.getEntry(parts[1]);
      return entry ? sendJson(response, 200, entry) : notFound(response);
    }
    if (request.method === "GET" && url.pathname === "/checkpoint-trees") {
      return sendJson(response, 200, {
        protocolVersion: kernel.checkpointTree.protocolVersion,
        items: await kernel.checkpointTree.list(queryObject(url))
      });
    }
    if (request.method === "GET" && parts[0] === "checkpoint-trees" && parts[1]) {
      const tree = await kernel.checkpointTree.load({ treeId: parts[1] });
      return tree ? sendJson(response, 200, tree) : notFound(response);
    }
    if (request.method === "POST" && parts[0] === "checkpoint-trees" && parts[1] && parts[2] === "restore-preview") {
      return sendJson(response, 200, await kernel.checkpointTree.previewRestore({
        ...(await readJson(request)),
        treeId: parts[1]
      }));
    }
    if (request.method === "POST" && parts[0] === "checkpoint-trees" && parts[1] && parts[2] === "restore") {
      return sendJson(response, 200, await kernel.checkpointTree.restore({
        ...(await readJson(request)),
        treeId: parts[1]
      }));
    }
    if (request.method === "POST" && url.pathname === "/state/commits") {
      return sendJson(response, 200, await kernel.merkleState.stateCommit.commit(await readJson(request)));
    }
    if (request.method === "GET" && parts[0] === "state" && parts[1] === "commits" && parts[2] && parts[3] === "verify") {
      return sendJson(response, 200, await kernel.merkleState.stateCommit.verifyCommit(parts[2]));
    }
    return notFound(response);
  } catch (error) {
    return sendJson(response, 500, {
      code: "pactium_error",
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

export function createPactiumHttpServer({ dataDir = "", kernel = null } = {}) {
  const resolvedKernel = kernel || createPactiumKernel({ dataDir: resolveDataDir(dataDir) });
  return http.createServer((request, response) => {
    routeRequest({ kernel: resolvedKernel, request, response }).catch((error) => {
      sendJson(response, 500, {
        code: "pactium_http_error",
        error: error instanceof Error ? error.message : String(error)
      });
    });
  });
}

export async function startPactiumHttpServer({ dataDir = "", host = "127.0.0.1", port = 7288 } = {}) {
  const server = createPactiumHttpServer({ dataDir });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(Number(port), host, resolve);
  });
  return {
    protocolVersion: PACTIUM_HTTP_PROTOCOL_VERSION,
    server,
    host,
    port: Number(port),
    url: `http://${host}:${Number(port)}`
  };
}
