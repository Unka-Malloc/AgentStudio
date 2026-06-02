#!/usr/bin/env node
import http from "node:http";

const calls = [];
const port = Number(process.env.PORT || 8788);
const host = process.env.HOST || "0.0.0.0";

function readJsonRequest(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("error", reject);
    request.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      if (!text.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(text));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json"
  });
  response.end(`${JSON.stringify(payload)}\n`);
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);

    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, { ok: true, service: "pact-external-http-adapters" });
      return;
    }

    if (request.method === "GET" && url.pathname === "/__calls") {
      sendJson(response, 200, { calls });
      return;
    }

    calls.push({
      method: request.method,
      path: url.pathname,
      search: url.search
    });

    const openApiMatch = url.pathname.match(/^\/openapi\/items\/([^/]+)$/);
    if (request.method === "GET" && openApiMatch) {
      sendJson(response, 200, {
        source: "openapi",
        id: decodeURIComponent(openApiMatch[1]),
        includeMeta: url.searchParams.get("includeMeta") === "true",
        name: `item-${decodeURIComponent(openApiMatch[1])}`
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/rest/search") {
      const body = await readJsonRequest(request);
      sendJson(response, 200, {
        source: "rest",
        query: body.query || "",
        results: [String(body.query || "").toUpperCase()]
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/gateway/invoke") {
      const body = await readJsonRequest(request);
      if (body.jsonrpc === "2.0" && body.method === "lookup") {
        const value = Number(body.params?.value || 0);
        sendJson(response, 200, {
          jsonrpc: "2.0",
          id: body.id ?? null,
          result: {
            source: "rpc",
            value,
            doubled: value * 2
          }
        });
        return;
      }
      sendJson(response, 400, { error: "unsupported_rpc" });
      return;
    }

    if (request.method === "POST" && url.pathname === "/gateway/v2/invoke") {
      const body = await readJsonRequest(request);
      if (body.jsonrpc === "2.0" && body.method === "lookupV2") {
        const value = Number(body.params?.value || 0);
        sendJson(response, 200, {
          jsonrpc: "2.0",
          id: body.id ?? null,
          result: {
            source: "rpc",
            version: "v2",
            value,
            tripled: value * 3
          }
        });
        return;
      }
      sendJson(response, 400, { error: "unsupported_rpc_v2" });
      return;
    }

    if (request.method === "POST" && url.pathname === "/rpc") {
      const body = await readJsonRequest(request);
      if (body.action !== "classify") {
        sendJson(response, 400, { error: "unsupported_action" });
        return;
      }
      const text = String(body.payload?.text || "");
      sendJson(response, 200, {
        result: {
          source: "json-rpc",
          label: text.length > 12 ? "long" : "short",
          text
        }
      });
      return;
    }

    sendJson(response, 404, {
      error: "not_found",
      path: url.pathname
    });
  } catch (error) {
    sendJson(response, 500, {
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

server.listen(port, host, () => {
  process.stdout.write(`pact external HTTP fake service listening on ${host}:${port}\n`);
});
