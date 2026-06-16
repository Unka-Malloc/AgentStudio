import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const managementRoot = path.join(repoRoot, "server-web");
const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".vue"]);

async function listFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === "dist") {
      continue;
    }
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(absolutePath));
      continue;
    }
    if (entry.isFile() && sourceExtensions.has(path.extname(entry.name))) {
      files.push(absolutePath);
    }
  }
  return files;
}

function relative(filePath) {
  return path.relative(repoRoot, filePath);
}

const forbiddenImportPattern =
  /\b(?:import|export)\s+(?:[^'"]+\s+from\s+)?["'](?:node:|fs(?:\/|["'])|path(?:\/|["'])|child_process|crypto|.*server\/platform|.*server\/services|.*server\/config|.*server\/scripts)/;

const forbiddenRuntimePatterns = [
  { pattern: /\.pact-server-data/, label: "runtime data path" },
  { pattern: /\bmetadataStore\b/, label: "metadata store" },
  { pattern: /\btoolManagementPlatform\b/, label: "Tool Management platform internals" },
  { pattern: /\bgetAgentConfigRegistry\b/, label: "agent config registry internals" },
  { pattern: /\bcreateJobManager\b/, label: "job manager construction" },
  { pattern: /\bcreateHttpServer\b/, label: "server runtime construction" }
];

function assertNoForbiddenImports(filePath, source) {
  const match = source.match(forbiddenImportPattern);
  assert.equal(
    match,
    null,
    `${relative(filePath)} imports backend/runtime internals instead of the service layer: ${match?.[0] || ""}`
  );
}

function assertNoForbiddenRuntimeReferences(filePath, source) {
  for (const item of forbiddenRuntimePatterns) {
    assert.equal(
      item.pattern.test(source),
      false,
      `${relative(filePath)} references ${item.label}; management layer must use API/bridge protocols`
    );
  }
}

function assertFetchesUseServiceLayer(filePath, source) {
  const fetchCalls = [...source.matchAll(/\bfetch\s*\(\s*([^,\n)]+)/g)];
  for (const call of fetchCalls) {
    const target = call[1].trim();
    if (target.startsWith("url") || target.startsWith("path") || target.startsWith("request")) {
      continue;
    }
    assert.match(
      target,
      /^["'`](\/api\/|http:\/\/127\.0\.0\.1:|http:\/\/localhost:)/,
      `${relative(filePath)} has a fetch target outside the service layer: ${target}`
    );
  }
}

const files = await listFiles(managementRoot);
assert.ok(files.length > 0, "server-web management source files must exist");

for (const filePath of files) {
  const source = await fs.readFile(filePath, "utf8");
  assertNoForbiddenImports(filePath, source);
  assertNoForbiddenRuntimeReferences(filePath, source);
  assertFetchesUseServiceLayer(filePath, source);
}

const serviceLayerFiles = await listFiles(path.join(managementRoot, "lib"));
const serviceLayerSource = (await Promise.all(
  serviceLayerFiles.map((filePath) => fs.readFile(filePath, "utf8"))
)).join("\n");
for (const required of [
  "/api/settings",
  "/api/console/state",
  "/api/agents",
  "/api/agent-gateway/call",
  "/api/tool-management/v1/catalog",
  "/api/knowledge/console"
]) {
  assert.equal(
    serviceLayerSource.includes(required),
    true,
    `server-web/lib must expose service-layer route ${required}`
  );
}

console.log(`management-layer verification passed (${files.length} source files)`);
