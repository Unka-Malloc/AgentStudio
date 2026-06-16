import http from "node:http";
import https from "node:https";

const PORT = Number(process.env.PORT || 8788);
const HOST = process.env.HOST || "0.0.0.0";
const RAW_BACKEND_URL = String(process.env.RAG_BACKEND_URL || "").trim();
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade"
]);

function json(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body)
  });
  response.end(body);
}

function normalizeBackendUrl(value = "") {
  if (!value) return null;
  const parsed = new URL(value);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("RAG_BACKEND_URL must use http or https.");
  }
  parsed.username = "";
  parsed.password = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/+$/, "");
}

function requestTargetUrl(requestUrl = "/", backendUrl = "") {
  const inbound = new URL(String(requestUrl || "/"), "http://127.0.0.1");
  return new URL(`${inbound.pathname}${inbound.search}`, `${backendUrl}/`);
}

function sanitizeRequestHeaders(headers = {}, target) {
  const output = {};
  for (const [name, value] of Object.entries(headers || {})) {
    const lower = name.toLowerCase();
    if (lower === "host" || HOP_BY_HOP_HEADERS.has(lower)) {
      continue;
    }
    output[name] = value;
  }
  output.host = target.host;
  return output;
}

function sanitizeResponseHeaders(headers = {}) {
  const output = {};
  for (const [name, value] of Object.entries(headers || {})) {
    if (HOP_BY_HOP_HEADERS.has(name.toLowerCase())) {
      continue;
    }
    output[name] = value;
  }
  return output;
}

let backendUrl = null;
let backendError = null;
try {
  backendUrl = normalizeBackendUrl(RAW_BACKEND_URL);
} catch (error) {
  backendError = error;
}

function proxy(request, response) {
  if (backendError) {
    json(response, 500, { ok: false, error: backendError.message });
    return;
  }
  if (!backendUrl) {
    json(response, 501, { ok: false, error: "RAG_BACKEND_URL is not configured" });
    return;
  }

  let target;
  try {
    target = requestTargetUrl(request.url, backendUrl);
  } catch {
    json(response, 400, { ok: false, error: "invalid request target" });
    return;
  }

  const client = target.protocol === "https:" ? https : http;
  const upstream = client.request(
    target,
    {
      method: request.method || "GET",
      headers: sanitizeRequestHeaders(request.headers, target),
      timeout: 30_000
    },
    (upstreamResponse) => {
      response.writeHead(
        upstreamResponse.statusCode || 502,
        sanitizeResponseHeaders(upstreamResponse.headers)
      );
      upstreamResponse.pipe(response);
    }
  );
  upstream.on("timeout", () => {
    upstream.destroy(new Error("upstream timeout"));
  });
  upstream.on("error", (error) => {
    if (!response.headersSent) {
      json(response, 502, { ok: false, error: error.message });
      return;
    }
    response.destroy(error);
  });
  request.pipe(upstream);
}

const server = http.createServer((request, response) => {
  if (request.url === "/health" || request.url === "/healthz") {
    json(response, 200, {
      ok: true,
      service: "external.knowledge.rag",
      backendConfigured: Boolean(backendUrl),
      backendValid: !backendError
    });
    return;
  }
  proxy(request, response);
});

server.listen(PORT, HOST);
