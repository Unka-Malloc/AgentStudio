import http from "node:http";
import { URL } from "node:url";
import { PACTIUM_PROTOCOL } from "./protocol/constants.js";
import { createPactium } from "./core/pactium-core.js";
import { createMaintenanceTaskEngine } from "./maintenance/task-engine.js";
import { createLicoLiteAspect } from "./aspects/licolite/index.js";
import { verifyProofBundle } from "./proof/bundle.js";

export const PACTIUM_HTTP_PROTOCOL = "pactium.v0.2.http";
export const PACTIUM_HTTP_MAX_BODY_BYTES = 1024 * 1024;

// Route capability classification for authorization gating.
// Read routes: always allowed, GET or POST. These do not modify runtime state.
const READ_ROUTES = new Set([
  "/health",
  "/protocols",
  "/doctor",
  "/intents/lookup",
  "/outcomes/lookup",
  "/workspaces/projection",
  "/workspaces/membership",
  "/cursors/ledger",
  "/cursors/workspace",
  "/cursors/verify",
  "/append-conditions",
  "/verify/envelope",
  "/verify/bundle",
  "/licolite/verify/envelope",
  "/licolite/verify/bundle",
  "/trusted-heads/advance",
  "/repair/plan",
  "/licolite/repair/plan",
  "/maintenance/tasks/plan"
]);
// Mutation routes: modify runtime state (ledger, runtime-state, proof bundle cache).
// Gated behind enableMutations.
const MUTATION_ROUTES = new Set([
  "/intents",
  "/outcomes",
  "/operations",
  "/licolite/operations",
  "/bundles/export",
  "/licolite/bundles/export"
]);
// Privileged routes: storage-level or maintenance execution. Separately gated.
const PRIVILEGED_ROUTES = new Set([
  "/maintenance/tasks/run",
  "/extensions",
  "/envelopes"
]);

function classifyRoute(pathname) {
  if (PRIVILEGED_ROUTES.has(pathname)) return "privileged";
  // Dynamic routes: GET /intents/:id, GET /outcomes/:id, GET /workspaces/:id/projection
  if (pathname.startsWith("/intents/") || pathname.startsWith("/outcomes/") ||
      pathname.startsWith("/workspaces/")) return "read";
  if (MUTATION_ROUTES.has(pathname)) return "mutation";
  if (READ_ROUTES.has(pathname)) return "read";
  return "unknown";
}

function unauthorizedResponse(code, message) {
  return {
    protocol: PACTIUM_HTTP_PROTOCOL,
    code,
    error: message,
    ok: false
  };
}

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

function routeId(pathname, prefix) {
  const base = `${prefix}/`;
  if (!pathname.startsWith(base)) return "";
  return decodeURIComponent(pathname.slice(base.length));
}

function envelopeAndOptions(input) {
  if (input && typeof input === "object" && input.envelope) {
    return { envelope: input.envelope, options: input.options || {} };
  }
  return { envelope: input, options: {} };
}

function bundleAndOptions(input) {
  if (input && typeof input === "object" && input.bundle) {
    return { bundle: input.bundle, options: input.options || {} };
  }
  return { bundle: input, options: {} };
}

function bundleExportRequest(input) {
  if (typeof input === "string") return { envelopeOrId: input, options: {} };
  if (input && typeof input === "object") {
    if (input.envelope) return { envelopeOrId: input.envelope, options: input.options || {} };
    if (input.envelopeId) return { envelopeOrId: String(input.envelopeId), options: input.options || {} };
    if (input.id) return { envelopeOrId: String(input.id), options: input.options || {} };
    if (input.envelopeKind || input.envelopeType) return { envelopeOrId: input, options: {} };
  }
  return { envelopeOrId: input, options: {} };
}

async function routeRequest({ pactium, licolite, request, response, maxBodyBytes, authorize = null, enableMutations = false }) {
  const baseUrl = `http://${request.headers.host || "127.0.0.1"}`;
  const url = new URL(request.url || "/", baseUrl);
  const pathname = url.pathname;
  const maintenance = createMaintenanceTaskEngine({ pactium });

  // -- Authorization gating --
  const capability = classifyRoute(pathname);
  const routeMethod = request.method;
  const isGet = routeMethod === "GET";
  const isPost = routeMethod === "POST";

  // Default: only read GET routes are allowed without explicit enableMutations
  if (!enableMutations && capability !== "read") {
    // Allow POST to read routes (lookups) even without enableMutations
    if (capability === "mutation" || capability === "privileged") {
      return sendJson(response, 403, unauthorizedResponse(
        "mutations_disabled",
        "Pactium HTTP server mutations are disabled. Set enableMutations: true to enable write operations."
      ));
    }
  }

  // Privileged routes require explicit gating even with enableMutations
  if (capability === "privileged" && !enableMutations) {
    return sendJson(response, 403, unauthorizedResponse(
      "privileged_route_disabled",
      "Pactium HTTP privileged routes require explicit enableMutations."
    ));
  }

  // Custom authorization hook
  if (typeof authorize === "function") {
    const authResult = await authorize({ method: routeMethod, pathname, capability, headers: request.headers });
    if (authResult === false || (authResult && authResult.allowed === false)) {
      const reason = authResult?.reason || "Authorization hook rejected the request.";
      return sendJson(response, authResult?.statusCode || 403, unauthorizedResponse(
        "unauthorized",
        reason
      ));
    }
  }

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
    if (request.method === "GET" && url.pathname === "/doctor") {
      return sendJson(response, 200, await pactium.doctor());
    }
    if (request.method === "POST" && url.pathname === "/intents") {
      return sendJson(response, 200, await pactium.beginOperationIntent(await readJson(request, { maxBodyBytes })));
    }
    if (request.method === "POST" && url.pathname === "/intents/lookup") {
      const input = await readJson(request, { maxBodyBytes });
      return sendJson(response, 200, await pactium.lookupOpenIntent(input.intentId || input.id || ""));
    }
    const intentId = routeId(url.pathname, "/intents");
    if (request.method === "GET" && intentId) {
      return sendJson(response, 200, await pactium.lookupOpenIntent(intentId));
    }
    if (request.method === "POST" && url.pathname === "/outcomes") {
      return sendJson(response, 200, await pactium.appendOperationOutcome(await readJson(request, { maxBodyBytes })));
    }
    if (request.method === "POST" && url.pathname === "/outcomes/lookup") {
      const input = await readJson(request, { maxBodyBytes });
      return sendJson(response, 200, await pactium.lookupOutcome(input.intentId || input.id || ""));
    }
    const outcomeIntentId = routeId(url.pathname, "/outcomes");
    if (request.method === "GET" && outcomeIntentId) {
      return sendJson(response, 200, await pactium.lookupOutcome(outcomeIntentId));
    }
    if (request.method === "POST" && url.pathname === "/operations") {
      return sendJson(response, 200, await pactium.recordOperation(await readJson(request, { maxBodyBytes })));
    }
    if (request.method === "POST" && url.pathname === "/licolite/operations") {
      return sendJson(response, 200, await licolite.recordWorkspaceOperation(await readJson(request, { maxBodyBytes })));
    }
    if (request.method === "POST" && url.pathname === "/verify/envelope") {
      const input = await readJson(request, { maxBodyBytes });
      const { envelope, options } = envelopeAndOptions(input);
      return sendJson(response, 200, await pactium.verifyEnvelope(envelope, options));
    }
    if (request.method === "POST" && url.pathname === "/verify/bundle") {
      const input = await readJson(request, { maxBodyBytes });
      const { bundle, options } = bundleAndOptions(input);
      return sendJson(response, 200, await verifyProofBundle(bundle, options));
    }
    if (request.method === "POST" && url.pathname === "/licolite/verify/envelope") {
      const input = await readJson(request, { maxBodyBytes });
      const { envelope, options } = envelopeAndOptions(input);
      return sendJson(response, 200, await licolite.verifyEnvelope(envelope, options));
    }
    if (request.method === "POST" && url.pathname === "/licolite/verify/bundle") {
      const input = await readJson(request, { maxBodyBytes });
      const { bundle, options } = bundleAndOptions(input);
      return sendJson(response, 200, await licolite.verifyBundle(bundle, options));
    }
    if (request.method === "POST" && url.pathname === "/bundles/export") {
      const { envelopeOrId, options } = bundleExportRequest(await readJson(request, { maxBodyBytes }));
      return sendJson(response, 200, await pactium.exportProofBundle(envelopeOrId, options));
    }
    if (request.method === "POST" && url.pathname === "/licolite/bundles/export") {
      const { envelopeOrId, options } = bundleExportRequest(await readJson(request, { maxBodyBytes }));
      return sendJson(response, 200, await licolite.exportProofBundle(envelopeOrId, options));
    }
    if (request.method === "POST" && url.pathname === "/workspaces/projection") {
      const input = await readJson(request, { maxBodyBytes });
      return sendJson(response, 200, await pactium.getWorkspaceProjection(input.workspaceId || input.id || "default"));
    }
    const projectionWorkspaceId = routeId(url.pathname, "/workspaces");
    if (request.method === "GET" && projectionWorkspaceId.endsWith("/projection")) {
      return sendJson(response, 200, await pactium.getWorkspaceProjection(projectionWorkspaceId.slice(0, -"/projection".length)));
    }
    if (request.method === "POST" && url.pathname === "/workspaces/membership") {
      return sendJson(response, 200, await pactium.proveWorkspaceMembership(await readJson(request, { maxBodyBytes })));
    }
    if (request.method === "POST" && url.pathname === "/cursors/ledger") {
      return sendJson(response, 200, await pactium.getLedgerCursor(await readJson(request, { maxBodyBytes })));
    }
    if (request.method === "POST" && url.pathname === "/cursors/workspace") {
      return sendJson(response, 200, await pactium.getWorkspaceCursor(await readJson(request, { maxBodyBytes })));
    }
    if (request.method === "POST" && url.pathname === "/cursors/verify") {
      const input = await readJson(request, { maxBodyBytes });
      return sendJson(response, 200, {
        protocol: PACTIUM_PROTOCOL,
        ok: pactium.verifyCursor(input.cursor || input, input.context || {})
      });
    }
    if (request.method === "POST" && url.pathname === "/append-conditions") {
      return sendJson(response, 200, pactium.createAppendCondition(await readJson(request, { maxBodyBytes })));
    }
    if (request.method === "POST" && url.pathname === "/trusted-heads/advance") {
      return sendJson(response, 200, pactium.advanceTrustedHead(await readJson(request, { maxBodyBytes })));
    }
    if (request.method === "POST" && url.pathname === "/repair/plan") {
      return sendJson(response, 200, pactium.planRecovery(await readJson(request, { maxBodyBytes })));
    }
    if (request.method === "POST" && url.pathname === "/licolite/repair/plan") {
      const input = await readJson(request, { maxBodyBytes });
      return sendJson(response, 200, licolite.planRepair(input.failures || input));
    }
    if (request.method === "POST" && url.pathname === "/maintenance/tasks/plan") {
      const input = await readJson(request, { maxBodyBytes });
      return sendJson(response, 200, maintenance.planTask(input.taskType || input.type || "doctor", input.input || {}));
    }
    if (request.method === "POST" && url.pathname === "/maintenance/tasks/run") {
      return sendJson(response, 200, await maintenance.runTask(await readJson(request, { maxBodyBytes })));
    }
    if (request.method === "POST" && url.pathname === "/extensions") {
      return sendJson(response, 200, await pactium.createExtension(await readJson(request, { maxBodyBytes })));
    }
    if (request.method === "POST" && url.pathname === "/envelopes") {
      return sendJson(response, 200, await pactium.storeEnvelope(await readJson(request, { maxBodyBytes })));
    }
    return sendJson(response, 404, {
      protocol: PACTIUM_HTTP_PROTOCOL,
      code: "not_found",
      error: "Pactium endpoint not found."
    });
  } catch (error) {
    const statusCode = error instanceof PactiumHttpError ? error.statusCode : 500;
    const code = error instanceof PactiumHttpError ? error.code : "pactium_http_error";
    const message = error instanceof PactiumHttpError
      ? error.message
      : "An internal error occurred. See server logs for details.";
    return sendJson(response, statusCode, {
      protocol: PACTIUM_HTTP_PROTOCOL,
      code,
      error: message
    });
  }
}

export function createPactiumHttpServer({
  dataDir = "",
  userDataPath = "",
  pactium = null,
  licolite = null,
  maxBodyBytes = PACTIUM_HTTP_MAX_BODY_BYTES,
  authorize = null,
  enableMutations = false
} = {}) {
  const core = pactium || createPactium({ dataDir, userDataPath });
  const aspect = licolite || createLicoLiteAspect({ pactium: core, evidencePolicy: "opportunistic" });
  return http.createServer((request, response) => {
    routeRequest({
      pactium: core,
      licolite: aspect,
      request,
      response,
      maxBodyBytes,
      authorize,
      enableMutations
    }).catch((error) => {
      sendJson(response, 500, {
        protocol: PACTIUM_HTTP_PROTOCOL,
        code: "pactium_http_error",
        error: "An internal server error occurred. See server logs for details."
      });
    });
  });
}

export async function startPactiumHttpServer({
  dataDir = "",
  userDataPath = "",
  host = "127.0.0.1",
  port = 7288,
  maxBodyBytes = PACTIUM_HTTP_MAX_BODY_BYTES,
  authorize = null,
  enableMutations = false
} = {}) {
  const server = createPactiumHttpServer({ dataDir, userDataPath, maxBodyBytes, authorize, enableMutations });
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
