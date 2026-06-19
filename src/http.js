import http from "node:http";
import { URL } from "node:url";
import { PACTIUM_PROTOCOL } from "./protocol/constants.js";
import { createPactium } from "./core/pactium-core.js";
import { createLicoLiteAspect } from "./aspects/licolite/index.js";

export const PACTIUM_HTTP_PROTOCOL = "pactium.v0.2.http";

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body)
  });
  response.end(body);
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8").trim();
  return text ? JSON.parse(text) : {};
}

async function routeRequest({ pactium, licolite, request, response }) {
  const baseUrl = `http://${request.headers.host || "127.0.0.1"}`;
  const url = new URL(request.url || "/", baseUrl);
  try {
    if (request.method === "GET" && url.pathname === "/health") {
      return sendJson(response, 200, {
        protocol: PACTIUM_HTTP_PROTOCOL,
        coreProtocol: PACTIUM_PROTOCOL,
        ok: true,
        dataDir: pactium.dataDir
      });
    }
    if (request.method === "GET" && url.pathname === "/protocols") {
      return sendJson(response, 200, await pactium.protocolCatalog());
    }
    if (request.method === "POST" && url.pathname === "/intents") {
      return sendJson(response, 200, await pactium.beginOperationIntent(await readJson(request)));
    }
    if (request.method === "POST" && url.pathname === "/outcomes") {
      return sendJson(response, 200, await pactium.appendOperationOutcome(await readJson(request)));
    }
    if (request.method === "POST" && url.pathname === "/operations") {
      return sendJson(response, 200, await pactium.recordOperation(await readJson(request)));
    }
    if (request.method === "POST" && url.pathname === "/licolite/operations") {
      return sendJson(response, 200, await licolite.recordWorkspaceOperation(await readJson(request)));
    }
    if (request.method === "POST" && url.pathname === "/verify/envelope") {
      return sendJson(response, 200, await pactium.verifyEnvelope(await readJson(request)));
    }
    if (request.method === "POST" && url.pathname === "/licolite/verify/envelope") {
      return sendJson(response, 200, await licolite.verifyEnvelope(await readJson(request)));
    }
    return sendJson(response, 404, {
      protocol: PACTIUM_HTTP_PROTOCOL,
      code: "not_found",
      error: "Pactium endpoint not found."
    });
  } catch (error) {
    return sendJson(response, 500, {
      protocol: PACTIUM_HTTP_PROTOCOL,
      code: "pactium_http_error",
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

export function createPactiumHttpServer({ dataDir = "", userDataPath = "", pactium = null, licolite = null } = {}) {
  const core = pactium || createPactium({ dataDir, userDataPath });
  const aspect = licolite || createLicoLiteAspect({ pactium: core, evidencePolicy: "opportunistic" });
  return http.createServer((request, response) => {
    routeRequest({ pactium: core, licolite: aspect, request, response }).catch((error) => {
      sendJson(response, 500, {
        protocol: PACTIUM_HTTP_PROTOCOL,
        code: "pactium_http_error",
        error: error instanceof Error ? error.message : String(error)
      });
    });
  });
}

export async function startPactiumHttpServer({ dataDir = "", userDataPath = "", host = "127.0.0.1", port = 7288 } = {}) {
  const server = createPactiumHttpServer({ dataDir, userDataPath });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(Number(port), host, resolve);
  });
  return {
    protocol: PACTIUM_HTTP_PROTOCOL,
    server,
    host,
    port: Number(port),
    url: `http://${host}:${Number(port)}`
  };
}
