#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

async function read(relativePath) {
  return fs.readFile(path.join(repoRoot, relativePath), "utf8");
}

async function readJson(relativePath) {
  return JSON.parse(await read(relativePath));
}

function assertIncludes(text, values, label) {
  for (const value of values) {
    assert.ok(text.includes(value), `${label} must include ${value}`);
  }
}

const layerIds = [
  "agent-client-mcp-compatibility",
  "external-service-compatibility",
  "pact-internal-compatibility"
];

const protocols = await read("docs/protocols/PROTOCOLS.md");
assertIncludes(protocols, layerIds, "docs/protocols/PROTOCOLS.md");
assertIncludes(protocols, [
  "三个兼容层",
  "任何 adapter、connector、mount、compatibility component 或 runtime bridge 都必须归入以下三层之一",
  "Tool Management、Policy、Operation Ledger、Checkpoint Tree 和 audit 是跨三层的治理面",
  "外部服务 adapter 不放在 Protocol Adapters 下统一描述"
], "docs/protocols/PROTOCOLS.md");

const architecture = await read("docs/architecture/ARCHITECTURE.md");
assertIncludes(architecture, layerIds, "docs/architecture/ARCHITECTURE.md");
assertIncludes(architecture, [
  "三个兼容层",
  "Compatibility Layers",
  "三大兼容层归口",
  "module contract、resource operation、capability lifecycle、runtime environment 和 state boundary"
], "docs/architecture/ARCHITECTURE.md");

const gerritManifest = await readJson("server/platform/specialized/capabilities/code-review/gerrit/module.json");
assert.equal(gerritManifest.category, "external-service-compatibility");
assert.equal(gerritManifest.compatibilityLayer, "external-service-compatibility");
assert.equal(gerritManifest.compatibilityBoundary, "remote-service");
assert.equal(gerritManifest.serviceKind, "code-review");
assert.equal(gerritManifest.serviceProviders.includes("gerrit"), true);

const repoManifest = await readJson("server/platform/specialized/capabilities/code-repository/repo-operations/module.json");
assert.equal(repoManifest.category, "pact-internal-compatibility");
assert.equal(repoManifest.compatibilityLayer, "pact-internal-compatibility");
assert.equal(repoManifest.compatibilityBoundary, "resource-operation");
assert.equal(repoManifest.internalCompatibilityKind, "resource-operation");
assert.equal(repoManifest.providers.includes("gerrit"), true);
assert.equal(repoManifest.providers.includes("github"), true);

const trafficGatewayManifest = await readJson("server/platform/specialized/capabilities/agent-ingress/traffic-gateway/module.json");
assert.equal(trafficGatewayManifest.category, "agent-client-mcp-compatibility");
assert.equal(trafficGatewayManifest.compatibilityLayer, "agent-client-mcp-compatibility");
assert.equal(trafficGatewayManifest.compatibilityBoundary, "ingress-adapter");
assert.equal(trafficGatewayManifest.clientCompatibilityKind, "traffic-gateway");
assert.equal(trafficGatewayManifest.adapterProviders.includes("caddy"), true);
assert.equal(trafficGatewayManifest.adapterProviders.includes("nginx"), true);
assert.equal(trafficGatewayManifest.components.gatewayIngressProfile.directModeRequired, true);

console.log("[compatibility-layers] ok");
