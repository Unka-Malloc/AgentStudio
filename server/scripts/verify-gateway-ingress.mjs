#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  AGENT_TRAFFIC_GATEWAY_PROTOCOL_VERSION,
  getGatewayAdapter,
  listGatewayAdapters,
  normalizeGatewayIngressProfile,
  registerGatewayAdapter,
  renderGatewayConfig,
  validateGatewayIngressPlan
} from "../platform/specialized/capabilities/agent-ingress/traffic-gateway/index.mjs";

const baseInput = {
  directBaseUrl: "http://127.0.0.1:7228",
  publicBaseUrl: "http://127.0.0.1:7330",
  upstream: "http://127.0.0.1:7228,http://127.0.0.1:7229",
  maxBodySize: "256m",
  streamTimeout: "120s"
};

const adapterIds = listGatewayAdapters().map((adapter) => adapter.adapterId).sort();
assert.deepEqual(adapterIds, ["caddy", "nginx"]);

const caddy = renderGatewayConfig({ ...baseInput, adapterId: "caddy" });
assert.equal(caddy.profile.protocol, AGENT_TRAFFIC_GATEWAY_PROTOCOL_VERSION);
assert.equal(caddy.profile.directMode.required, true);
assert.equal(caddy.profile.directMode.mustWorkWithoutGateway, true);
assert.equal(caddy.profile.gatewayMode.optional, true);
assert.equal(caddy.routeManifest.directModeRequired, true);
assert.equal(caddy.routeManifest.routes.some((route) => route.path === "/mcp" && route.streaming), true);
assert.equal(caddy.routeManifest.routes.some((route) => route.path === "/api/upload-sessions" && route.streaming), true);
assert.match(caddy.config, /reverse_proxy @pact_streaming/);
assert.match(caddy.config, /flush_interval -1/);
assert.match(caddy.config, /X-Pact-Gateway caddy/);
assert.match(caddy.config, /\{http\.request\.uuid\}/);
assert.match(caddy.config, /http:\/\/127\.0\.0\.1:7228 http:\/\/127\.0\.0\.1:7229/);

const nginx = renderGatewayConfig({ ...baseInput, adapterId: "nginx" });
assert.equal(nginx.profile.gatewayMode.adapterId, "nginx");
assert.match(nginx.config, /upstream pact_backend/);
assert.match(nginx.config, /server 127\.0\.0\.1:7228;/);
assert.match(nginx.config, /server 127\.0\.0\.1:7229;/);
assert.match(nginx.config, /proxy_buffering off;/);
assert.match(nginx.config, /proxy_request_buffering off;/);
assert.match(nginx.config, /proxy_set_header Upgrade \$http_upgrade;/);
assert.match(nginx.config, /proxy_set_header X-Pact-Gateway nginx;/);
assert.match(nginx.config, /proxy_set_header X-Pact-Gateway-Request-Id \$request_id;/);

function parseLastJsonPayload(stdout = "") {
  const text = String(stdout || "").trim();
  if (!text) {
    throw new Error("No JSON payload found in empty stdout");
  }
  try {
    return JSON.parse(text);
  } catch {
    // Runtime download progress can precede the pretty-printed JSON payload.
  }
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== "{" && text[index] !== "[") {
      continue;
    }
    try {
      return JSON.parse(text.slice(index));
    } catch {
      // Keep scanning until the beginning of the final JSON payload is found.
    }
  }
  const lines = String(stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!line.startsWith("{") && !line.startsWith("[")) {
      continue;
    }
    try {
      return JSON.parse(line);
    } catch {
      // Keep scanning earlier lines; runtime download progress can share stdout.
    }
  }
  throw new Error(`No JSON payload found in stdout: ${stdout}`);
}

for (const adapterId of ["caddy", "nginx"]) {
  const report = validateGatewayIngressPlan({ ...baseInput, adapterId });
  assert.equal(report.ok, true, `${adapterId} gateway ingress plan must validate`);
  assert.equal(report.directModeRequired, true);
  assert.equal(report.gatewayOptional, true);
}

registerGatewayAdapter({
  adapterId: "example-edge",
  label: "Example Edge",
  fileName: "example-edge.conf",
  renderConfig: (profile) => JSON.stringify({
    adapterId: "example-edge",
    directBaseUrl: profile.directMode.baseUrl,
    routeCount: profile.routes.length
  })
});
assert.equal(getGatewayAdapter("example-edge").fileName, "example-edge.conf");
const example = renderGatewayConfig({ ...baseInput, adapterId: "example-edge" });
assert.match(example.config, /example-edge/);

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pact-gateway-ingress-"));
try {
  const fixtureCaddyBin = path.join(tempRoot, "fixture-caddy");
  await fs.writeFile(fixtureCaddyBin, "#!/bin/sh\nexit 0\n", "utf8");
  await fs.chmod(fixtureCaddyBin, 0o755);

  const writeResult = spawnSync(
    process.execPath,
    [
      "server/scripts/gateway-ingress.mjs",
      "write",
      "--gateway",
      "all",
      "--direct-base-url",
      baseInput.directBaseUrl,
      "--public-base-url",
      baseInput.publicBaseUrl,
      "--output",
      tempRoot,
      "--json"
    ],
    { encoding: "utf8" }
  );
  assert.equal(writeResult.status, 0, writeResult.stderr || writeResult.stdout);
  const report = parseLastJsonPayload(writeResult.stdout);
  assert.equal(report.written.length >= 2, true);
  assert.equal(await fileExists(path.join(tempRoot, "caddy", "Caddyfile")), true);
  assert.equal(await fileExists(path.join(tempRoot, "nginx", "nginx.conf")), true);
  assert.equal(await fileExists(path.join(tempRoot, "active-gateway.json")), true);

  const runtimePlan = spawnSync(
    process.execPath,
    [
      "server/scripts/gateway-ingress.mjs",
      "runtime-plan",
      "--gateway",
      "caddy",
      "--runtime-cache-dir",
      tempRoot,
      "--json"
    ],
    { encoding: "utf8" }
  );
  assert.equal(runtimePlan.status, 0, runtimePlan.stderr || runtimePlan.stdout);
  const runtimePlanPayload = parseLastJsonPayload(runtimePlan.stdout);
  assert.match(runtimePlanPayload.cacheRoot, /pact-gateway-ingress-/);
  assert.equal(runtimePlanPayload.cached, false);

  const runtimePull = spawnSync(
    process.execPath,
    [
      "server/scripts/gateway-ingress.mjs",
      "runtime-pull",
      "--gateway",
      "caddy",
      "--runtime-cache-dir",
      tempRoot,
      "--runtime-binary",
      fixtureCaddyBin
    ],
    { encoding: "utf8" }
  );
  assert.equal(runtimePull.status, 0, runtimePull.stderr || runtimePull.stdout);
  const runtimePullPayload = parseLastJsonPayload(runtimePull.stdout);
  assert.equal(runtimePullPayload.sourceType, "configured-binary");
  assert.equal(await fileExists(runtimePullPayload.cachedExecutablePath), true);

  const runtimeUrlRoot = path.join(tempRoot, "runtime-url");
  await fs.mkdir(runtimeUrlRoot, { recursive: true });
  const runtimeUrlBin = path.join(runtimeUrlRoot, "download");
  await fs.writeFile(runtimeUrlBin, "#!/bin/sh\nexit 0\n", "utf8");
  await fs.chmod(runtimeUrlBin, 0o755);
  const runtimePullUrl = spawnSync(
    process.execPath,
    [
      "server/scripts/gateway-ingress.mjs",
      "runtime-pull",
      "--gateway",
      "caddy",
      "--runtime-cache-dir",
      runtimeUrlRoot,
      "--runtime-url",
      `file://${runtimeUrlBin}`
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        PACT_DISABLE_NATIVE_RUNTIME_INSTALL: "1",
        PATH: "/usr/bin:/bin"
      }
    }
  );
  assert.equal(runtimePullUrl.status, 0, runtimePullUrl.stderr || runtimePullUrl.stdout);
  const runtimePullUrlPayload = parseLastJsonPayload(runtimePullUrl.stdout);
  assert.equal(runtimePullUrlPayload.sourceType, "runtime-url-executable");
  assert.equal(await fileExists(runtimePullUrlPayload.cachedExecutablePath), true);

  const directSwitch = spawnSync(
    process.execPath,
    [
      "server/scripts/gateway-ingress.mjs",
      "switch",
      "--gateway",
      "direct",
      "--direct-base-url",
      baseInput.directBaseUrl,
      "--output",
      tempRoot,
      "--json"
    ],
    { encoding: "utf8" }
  );
  assert.equal(directSwitch.status, 0, directSwitch.stderr || directSwitch.stdout);
  const activeGateway = JSON.parse(await fs.readFile(path.join(tempRoot, "active-gateway.json"), "utf8"));
  assert.equal(activeGateway.activeAdapterId, "direct");
  assert.equal(activeGateway.directModeRequired, true);
  assert.equal(activeGateway.gatewayCanBeRemoved, true);
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

console.log("[gateway-ingress] ok");
