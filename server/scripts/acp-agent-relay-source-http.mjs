#!/usr/bin/env node
import http from "node:http";

import { createAcpRelayRuntime } from "../platform/specialized/capabilities/agent-relay/acp-agent-relay/index.mjs";

function parseJsonEnv(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (!value) {
      continue;
    }
    return JSON.parse(value);
  }
  return {};
}

function textEnv(...names) {
  for (const name of names) {
    const value = String(process.env[name] || "").trim();
    if (value) {
      return value;
    }
  }
  return "";
}

function sendJson(response, status, payload) {
  const body = `${JSON.stringify(payload)}\n`;
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body)
  });
  response.end(body);
}

function readBody(request, { limit = 2 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("request body too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    request.on("error", reject);
  });
}

const runtimeOptions = parseJsonEnv(
  "PACT_ACP_SOURCE_HTTP_RUNTIME_JSON",
  "PACT_ACP_SOURCE_STDIO_RUNTIME_JSON"
);
const baseContext = parseJsonEnv(
  "PACT_ACP_SOURCE_HTTP_CONTEXT_JSON",
  "PACT_ACP_SOURCE_STDIO_CONTEXT_JSON"
);
const storePath = textEnv(
  "PACT_ACP_SOURCE_HTTP_STORE_PATH",
  "PACT_ACP_SOURCE_STDIO_STORE_PATH"
);
const token = textEnv("PACT_ACP_SOURCE_HTTP_TOKEN");
const runtime = createAcpRelayRuntime({
  ...runtimeOptions,
  ...(storePath ? { storePath } : {})
});

function requestContext() {
  const sourceIdentity = {
    ...baseContext,
    ...(baseContext.sourceIdentity || {}),
    sourceIdentityTrusted: true,
    authContextTrusted: true,
    sourceTransport: "loopback-http"
  };
  return {
    ...baseContext,
    authContextTrusted: true,
    sourceIdentityTrusted: true,
    sourceTransport: "loopback-http",
    sourceIdentity
  };
}

function isAuthorized(request) {
  if (!token) {
    return true;
  }
  return request.headers.authorization === `Bearer ${token}`;
}

let closing = false;
const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    if (request.method === "GET" && url.pathname === "/healthz") {
      sendJson(response, 200, {
        ok: true,
        event: "pact.acp.source_http.health",
        durableStore: Boolean(storePath),
        authRequired: Boolean(token)
      });
      return;
    }
    if (request.method === "POST" && url.pathname === "/shutdown") {
      if (!isAuthorized(request)) {
        sendJson(response, 401, { ok: false, error: "unauthorized" });
        return;
      }
      sendJson(response, 200, { ok: true, status: "closing" });
      await closeServer();
      return;
    }
    if (request.method !== "POST" || url.pathname !== "/acp") {
      sendJson(response, 404, { ok: false, error: "not_found" });
      return;
    }
    if (!isAuthorized(request)) {
      sendJson(response, 401, { ok: false, error: "unauthorized" });
      return;
    }
    const rawBody = await readBody(request);
    const message = JSON.parse(rawBody);
    const notifications = [];
    const result = await runtime.sourceJsonRpcService.handleMessageWithEmitter(
      message,
      requestContext(),
      async (notification) => {
        notifications.push(notification);
      }
    );
    sendJson(response, 200, {
      ok: true,
      response: result,
      notifications
    });
  } catch (error) {
    sendJson(response, 500, {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

function closeServer() {
  if (closing) {
    return Promise.resolve();
  }
  closing = true;
  return Promise.resolve()
    .then(() => runtime.close?.())
    .catch(() => null)
    .then(() => new Promise((resolve) => server.close(resolve)))
    .then(() => {
      process.exitCode = 0;
    });
}

process.once("SIGTERM", () => {
  closeServer().then(() => process.exit(0));
});
process.once("SIGINT", () => {
  closeServer().then(() => process.exit(0));
});

server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}`;
  process.stderr.write(`${JSON.stringify({
    event: "pact.acp.source_http.ready",
    url,
    durableStore: Boolean(storePath),
    storagePath: storePath,
    authRequired: Boolean(token)
  })}\n`);
});
