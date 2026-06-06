import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const serviceEntry = path.join(repoRoot, "external-services/knowledge-distillation-service/server.mjs");
const dockerfilePath = path.join(repoRoot, "external-services/knowledge-distillation-service/Dockerfile");
const serviceSource = await fs.readFile(serviceEntry, "utf8");
const dockerfile = await fs.readFile(dockerfilePath, "utf8");
const gateToken = "test-only-external-kd-gate";

assert.match(serviceSource, /PACT_EXTERNAL_KD_API_TOKEN/, "service must support an external API token");
assert.match(serviceSource, /PACT_EXTERNAL_KD_REQUIRE_API_TOKEN/, "service must expose a required-auth gate");
assert.match(serviceSource, /PACT_EXTERNAL_KD_ALLOW_UNAUTHENTICATED_DEV/, "service must make unauthenticated mode explicit");
assert.match(serviceSource, /EXTERNAL_KD_AUTH_REQUIRED/, "service must return a machine-readable auth failure");
assert.match(serviceSource, /crypto\.timingSafeEqual/, "service token comparison must use constant-time comparison");
assert.match(serviceSource, /function isPublicHealthPath/, "service must isolate public health endpoints");
assert.match(serviceSource, /function requireAuthenticatedRequest/, "service must centralize request authentication");
assert.match(serviceSource, /PACT_EXTERNAL_KD_API_TOKEN must be set/, "service must fail startup when auth is required without a token");

assert.match(dockerfile, /ARG TIKA_APP_SHA512=/, "Dockerfile must pin the Tika app checksum");
assert.match(dockerfile, /sha512sum -c -/, "Dockerfile must verify the downloaded Tika app");
assert.match(dockerfile, /groupadd --system pactkd/, "Dockerfile must create a dedicated service group");
assert.match(dockerfile, /useradd --system --gid pactkd/, "Dockerfile must create a dedicated service user");
assert.match(dockerfile, /ENV PACT_EXTERNAL_KD_REQUIRE_API_TOKEN=1/, "container runtime must require API auth by default");
assert.match(dockerfile, /chown -R pactkd:pactkd \/data \/app/, "container writable paths must be owned by the service user");
assert.match(dockerfile, /^HEALTHCHECK\b/m, "Dockerfile must declare a healthcheck");
assert.match(dockerfile, /^USER pactkd$/m, "container must run as the dedicated service user");
assert.equal(/ENV\s+PACT_EXTERNAL_KD_API_TOKEN=/.test(dockerfile), false, "Dockerfile must not bake an API token into the image");

async function freePort() {
  const server = http.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  return {
    status: response.status,
    ok: response.ok,
    headers: response.headers,
    payload: text.trim() ? JSON.parse(text) : {}
  };
}

function authHeaders(token = gateToken) {
  return { Authorization: `Bearer ${token}` };
}

function spawnService({ port, dataDir, token = gateToken } = {}) {
  return spawn(process.execPath, [serviceEntry], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      SERVICE_DATA_DIR: dataDir,
      PACT_EXTERNAL_KD_API_TOKEN: token,
      SERVICE_API_TOKEN: "",
      PACT_EXTERNAL_KD_REQUIRE_API_TOKEN: "1",
      PACT_EXTERNAL_KD_ALLOW_UNAUTHENTICATED_DEV: "0"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
}

async function waitForService(baseUrl, child, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    assert.equal(child.exitCode, null, "external KD service exited before becoming healthy");
    try {
      const health = await fetchJson(`${baseUrl}/health`);
      if (health.status === 200 && health.payload.ok === true) {
        return health.payload;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error(`external KD service did not become healthy: ${lastError?.message || "timeout"}`);
}

async function stopService(child) {
  if (child.exitCode !== null) {
    return;
  }
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (child.exitCode === null) {
        child.kill("SIGKILL");
      }
      resolve();
    }, 1500);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function assertMissingTokenFailsStartup() {
  const port = await freePort();
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "pact-external-kd-gate-missing-token-"));
  const child = spawn(process.execPath, [serviceEntry], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      SERVICE_DATA_DIR: dataDir,
      PACT_EXTERNAL_KD_API_TOKEN: "",
      SERVICE_API_TOKEN: "",
      PACT_EXTERNAL_KD_REQUIRE_API_TOKEN: "1",
      PACT_EXTERNAL_KD_ALLOW_UNAUTHENTICATED_DEV: "0"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString("utf8");
  });
  const code = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 2500);
    child.once("exit", (exitCode) => {
      clearTimeout(timer);
      resolve(exitCode);
    });
  });
  try {
    assert.notEqual(code, null, "service must not keep running when auth is required without a token");
    assert.match(output, /PACT_EXTERNAL_KD_API_TOKEN must be set/, "startup failure must identify the missing auth configuration");
  } finally {
    await stopService(child);
    await fs.rm(dataDir, { recursive: true, force: true });
  }
}

await assertMissingTokenFailsStartup();

const port = await freePort();
const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "pact-external-kd-gate-"));
const serviceUrl = `http://127.0.0.1:${port}`;
const child = spawnService({ port, dataDir });
try {
  await waitForService(serviceUrl, child);

  const health = await fetchJson(`${serviceUrl}/health`);
  assert.equal(health.status, 200, "health endpoint must remain public for orchestrators");
  assert.equal(health.payload.ok, true);

  const runtimeHealth = await fetchJson(`${serviceUrl}/v1/runtime/health`);
  assert.equal(runtimeHealth.status, 200, "runtime health endpoint must remain public for orchestrators");

  const capabilitiesWithoutAuth = await fetchJson(`${serviceUrl}/v1/capabilities`);
  assert.equal(capabilitiesWithoutAuth.status, 401);
  assert.equal(capabilitiesWithoutAuth.payload.code, "EXTERNAL_KD_AUTH_REQUIRED");

  const listRunsWithoutAuth = await fetchJson(`${serviceUrl}/v1/distillation/runs`);
  assert.equal(listRunsWithoutAuth.status, 401);
  assert.equal(listRunsWithoutAuth.payload.code, "EXTERNAL_KD_AUTH_REQUIRED");

  const postRunWithoutAuth = await fetchJson(`${serviceUrl}/v1/distillation/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rawDocuments: [] })
  });
  assert.equal(postRunWithoutAuth.status, 401);
  assert.equal(postRunWithoutAuth.payload.code, "EXTERNAL_KD_AUTH_REQUIRED");

  const wrongToken = await fetchJson(`${serviceUrl}/v1/distillation/runs`, {
    headers: authHeaders("wrong-test-token")
  });
  assert.equal(wrongToken.status, 401);
  assert.equal(wrongToken.payload.code, "EXTERNAL_KD_AUTH_REQUIRED");

  const listRunsWithAuth = await fetchJson(`${serviceUrl}/v1/distillation/runs`, {
    headers: authHeaders()
  });
  assert.equal(listRunsWithAuth.status, 200);
  assert.equal(Array.isArray(listRunsWithAuth.payload.runs), true);

  const capabilitiesWithAuth = await fetchJson(`${serviceUrl}/v1/capabilities`, {
    headers: authHeaders()
  });
  assert.equal(capabilitiesWithAuth.status, 200);
  assert.equal(capabilitiesWithAuth.payload.serviceName, "external-knowledge-distillation");
} finally {
  await stopService(child);
  await fs.rm(dataDir, { recursive: true, force: true });
}

console.log("external knowledge distillation service gates verification passed");
