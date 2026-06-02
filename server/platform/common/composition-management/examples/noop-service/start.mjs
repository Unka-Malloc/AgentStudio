#!/usr/bin/env node
import http from "node:http";

const port = Number(process.env.PACT_EXTERNAL_EXAMPLE_PORT || 18080);
const server = http.createServer((request, response) => {
  if (request.url === "/healthz") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ok: true, service: "example-external-service" }));
    return;
  }
  response.writeHead(404, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ ok: false }));
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(JSON.stringify({ ok: true, step: "start", port }) + "\n");
});
