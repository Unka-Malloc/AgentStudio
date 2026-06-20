import http from "node:http";
import { URL } from "node:url";
import { PACTIUM_PROTOCOL } from "./protocol/constants.js";
import { createPactium } from "./core/pactium-core.js";
import { createLicoLiteAspect } from "./aspects/licolite/index.js";

export const PACTIUM_HTTP_PROTOCOL = "pactium.v0.2.http";
export const PACTIUM_HTTP_MAX_BODY_BYTES = 1024 * 1024;

class PactiumHttpError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
    "content-length": Buffer.byteLength(body)
  });
  response.end(body);
}

async function readJson(request, { maxBodyBytes = PACTIUM_HTTP_MAX_BODY_BYTES } = {}) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maxBodyBytes) {
      throw new PactiumHttpError(413, "request_body_too_large", "Pactium HTTP request body exceeds the configured limit.");
    }
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new PactiumHttpError(400, "invalid_json", "Pactium HTTP request body must be valid JSON.");
  }
}

async function routeRequest({ pactium, licolite, request, response, maxBodyBytes }) {
  const baseUrl = `http://${request.headers.host || "127.0.0.1"}`;
  const url = new URL(request.url || "/", baseUrl);
  try {
    if (request.method === "GET" && url.pathname === "/health") {
      return sendJson(response, 200, {
        protocol: PACTIUM_HTTP_PROTOCOL,
        coreProtocol: PACTIUM_PROTOCOL,
        ok: true
      });
    }
    if (request.method === "GET" && url.pathname === "/protocols") {
      return sendJson(response, 200, await pactium.protocolCatalog());
    }
    if (request.method === "POST" && url.pathname === "/intents") {
      return sendJson(response, 200, await pactium.beginOperationIntent(await readJson(request, { maxBodyBytes })));
    }
    if (request.method === "POST" && url.pathname === "/outcomes") {
      return sendJson(response, 200, await pactium.appendOperationOutcome(await readJson(request, { maxBodyBytes })));
    }
    if (request.method === "POST" && url.pathname === "/operations") {
      return sendJson(response, 200, await pactium.recordOperation(await readJson(request, { maxBodyBytes })));
    }
    if (request.method === "POST" && url.pathname === "/licolite/operations") {
      return sendJson(response, 200, await licolite.recordWorkspaceOperation(await readJson(request, { maxBodyBytes })));
    }
    if (request.method === "POST" && url.pathname === "/verify/envelope") {
      return sendJson(response, 200, await pactium.verifyEnvelope(await readJson(request, { maxBodyBytes })));
    }
    if (request.method === "POST" && url.pathname === "/licolite/verify/envelope") {
      return sendJson(response, 200, await licolite.verifyEnvelope(await readJson(request, { maxBodyBytes })));
    }
    return sendJson(response, 404, {
      protocol: PACTIUM_HTTP_PROTOCOL,
      code: "not_found",
      error: "Pactium endpoint not found."
    });
  } catch (error) {
    const statusCode = error instanceof PactiumHttpError ? error.statusCode : 500;
    return sendJson(response, statusCode, {
      protocol: PACTIUM_HTTP_PROTOCOL,
      code: error instanceof PactiumHttpError ? error.code : "pactium_http_error",
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

export function createPactiumHttpServer({
  dataDir = "",
  userDataPath = "",
  pactium = null,
  licolite = null,
  maxBodyBytes = PACTIUM_HTTP_MAX_BODY_BYTES
} = {}) {
  const core = pactium || createPactium({ dataDir, userDataPath });
  const aspect = licolite || createLicoLiteAspect({ pactium: core, evidencePolicy: "opportunistic" });
  return http.createServer((request, response) => {
    routeRequest({ pactium: core, licolite: aspect, request, response, maxBodyBytes }).catch((error) => {
      sendJson(response, 500, {
        protocol: PACTIUM_HTTP_PROTOCOL,
        code: "pactium_http_error",
        error: error instanceof Error ? error.message : String(error)
      });
    });
  });
}

export async function startPactiumHttpServer({
  dataDir = "",
  userDataPath = "",
  host = "127.0.0.1",
  port = 7288,
  maxBodyBytes = PACTIUM_HTTP_MAX_BODY_BYTES
} = {}) {
  const server = createPactiumHttpServer({ dataDir, userDataPath, maxBodyBytes });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(Number(port), host, resolve);
  });
  return {
    protocol: PACTIUM_HTTP_PROTOCOL,
    server,
    host,
    port: Number(port),
    maxBodyBytes,
    url: `http://${host}:${Number(port)}`
  };
}
