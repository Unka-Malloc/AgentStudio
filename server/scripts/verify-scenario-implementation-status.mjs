#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { SERVER_API_OPERATIONS } from "../platform/common/operation-dispatcher/operation-registry.mjs";
import { createToolCatalogRegistry } from "../platform/specialized/capabilities/tools/tool-management-core/catalog.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");

const scenarioCatalogPath = path.join(repoRoot, "docs", "scenarios", "scenario-catalog.json");
const scenarioStatusPath = path.join(repoRoot, "docs", "scenarios", "scenario-implementation-status.json");
const packageJsonPath = path.join(repoRoot, "package.json");

const ALLOWED_SCENARIO_STATUS = new Set(["verified", "partial", "contract", "blocked"]);
const ALLOWED_PROVIDER_MODE = new Set(["contract", "dry-run", "local-live", "remote-live", "failed"]);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeScriptNameFromCommand(command) {
  const text = String(command || "").trim();
  const match = text.match(/^npm\s+run\s+([^\s]+)/);
  return match ? match[1] : "";
}

function assertRelativeAndExistingPaths(paths = [], label = "path") {
  for (const raw of paths) {
    assert.equal(typeof raw, "string", `${label} entry must be a string`);
    const target = raw.trim();
    assert.notEqual(target.length, 0, `${label} entry must not be empty`);
    assert.equal(target.includes(".."), false, `${label} entry must not escape repository root: ${target}`);
    assert.equal(path.isAbsolute(target), false, `${label} entry must use repo-relative path: ${target}`);
  }
}

const scenarioCatalog = JSON.parse(await fs.readFile(scenarioCatalogPath, "utf8"));
const scenarioStatus = JSON.parse(await fs.readFile(scenarioStatusPath, "utf8"));
const packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf8"));

assert.equal(scenarioStatus.schemaVersion, 1, "scenario implementation status schemaVersion must be 1");
assert.equal(typeof scenarioStatus.updatedAt, "string", "scenario implementation status updatedAt must be present");
assert.equal(typeof scenarioStatus.factSource, "string", "scenario implementation status factSource must be present");

const scenarios = asArray(scenarioStatus.scenarios);
const catalogScenarioIds = asArray(scenarioCatalog.confirmedScenarios).map((entry) => entry.id);
assert.equal(catalogScenarioIds.length, 8, "scenario catalog must keep 8 confirmed scenarios");
assert.equal(scenarios.length, catalogScenarioIds.length, "scenario implementation status must cover all confirmed scenarios");

const scripts = packageJson.scripts || {};
const operationsById = new Map(SERVER_API_OPERATIONS.map((entry) => [entry.id, entry]));
const toolRegistry = createToolCatalogRegistry({ operations: SERVER_API_OPERATIONS });
const toolsById = new Map(toolRegistry.listTools().map((tool) => [tool.id, tool]));

const seenIds = new Set();
for (const scenario of scenarios) {
  const scenarioId = String(scenario.id || "").trim();
  assert.notEqual(scenarioId.length, 0, "scenario id must not be empty");
  assert.equal(seenIds.has(scenarioId), false, `duplicate scenario id in status file: ${scenarioId}`);
  seenIds.add(scenarioId);
  assert.equal(catalogScenarioIds.includes(scenarioId), true, `scenario id is not part of confirmed catalog: ${scenarioId}`);

  const status = String(scenario.status || "").trim();
  assert.equal(ALLOWED_SCENARIO_STATUS.has(status), true, `${scenarioId} has unsupported status: ${status}`);

  const providerModeRaw = scenario.providerMode;
  if (providerModeRaw !== undefined && providerModeRaw !== null && String(providerModeRaw).trim().length > 0) {
    const providerMode = String(providerModeRaw).trim();
    assert.equal(ALLOWED_PROVIDER_MODE.has(providerMode), true, `${scenarioId} has unsupported providerMode: ${providerMode}`);
    if (status === "verified") {
      assert.equal(
        providerMode === "contract" || providerMode === "dry-run",
        false,
        `${scenarioId} cannot be verified when providerMode is ${providerMode}`
      );
    }
  }

  const operationIds = asArray(scenario.operationIds);
  const toolIds = asArray(scenario.toolIds);
  const verifier = asArray(scenario.verifier);
  const evidence = asArray(scenario.evidence);
  const blockers = asArray(scenario.blockers);

  assert.ok(Array.isArray(operationIds), `${scenarioId} operationIds must be an array`);
  assert.ok(Array.isArray(toolIds), `${scenarioId} toolIds must be an array`);
  assert.ok(Array.isArray(verifier), `${scenarioId} verifier must be an array`);
  assert.ok(Array.isArray(evidence), `${scenarioId} evidence must be an array`);
  assert.ok(Array.isArray(blockers), `${scenarioId} blockers must be an array`);

  const operationIdSet = new Set();
  for (const operationIdRaw of operationIds) {
    const operationId = String(operationIdRaw || "").trim();
    assert.notEqual(operationId.length, 0, `${scenarioId} operationIds must not contain empty values`);
    assert.equal(operationIdSet.has(operationId), false, `${scenarioId} operationIds contains duplicate: ${operationId}`);
    operationIdSet.add(operationId);
    assert.equal(operationsById.has(operationId), true, `${scenarioId} references unknown operationId: ${operationId}`);
  }

  const toolIdSet = new Set();
  for (const toolIdRaw of toolIds) {
    const toolId = String(toolIdRaw || "").trim();
    assert.notEqual(toolId.length, 0, `${scenarioId} toolIds must not contain empty values`);
    assert.equal(toolIdSet.has(toolId), false, `${scenarioId} toolIds contains duplicate: ${toolId}`);
    toolIdSet.add(toolId);
    assert.equal(toolsById.has(toolId), true, `${scenarioId} references unknown toolId: ${toolId}`);
  }

  for (const commandRaw of verifier) {
    const command = String(commandRaw || "").trim();
    assert.notEqual(command.length, 0, `${scenarioId} verifier command must not be empty`);
    assert.equal(/fake/i.test(command), false, `${scenarioId} verifier command must not contain fake keyword: ${command}`);

    const scriptName = normalizeScriptNameFromCommand(command);
    if (scriptName) {
      assert.equal(
        Object.prototype.hasOwnProperty.call(scripts, scriptName),
        true,
        `${scenarioId} verifier command points to missing npm script: ${scriptName}`
      );
    }
  }

  assertRelativeAndExistingPaths(evidence, `${scenarioId} evidence`);
  for (const relativePath of evidence) {
    const absolute = path.join(repoRoot, relativePath);
    try {
      const stat = await fs.stat(absolute);
      assert.equal(stat.isFile() || stat.isDirectory(), true, `${scenarioId} evidence path must exist: ${relativePath}`);
    } catch {
      assert.fail(`${scenarioId} evidence path does not exist: ${relativePath}`);
    }
  }

  for (const blockerRaw of blockers) {
    const blocker = String(blockerRaw || "").trim();
    assert.notEqual(blocker.length, 0, `${scenarioId} blockers must not contain empty values`);
  }

  if (status === "verified") {
    assert.equal(operationIds.length > 0, true, `${scenarioId} verified status requires operationIds`);
    assert.equal(toolIds.length > 0, true, `${scenarioId} verified status requires toolIds`);
    assert.equal(verifier.length > 0, true, `${scenarioId} verified status requires verifier commands`);
    assert.equal(evidence.length > 0, true, `${scenarioId} verified status requires evidence`);
    assert.equal(blockers.length, 0, `${scenarioId} verified status must not keep blockers`);
  }

  assert.equal(
    String(JSON.stringify(scenario)).toLowerCase().includes("fake"),
    false,
    `${scenarioId} must not include fake path/provider/receipt markers`
  );
}

for (const scenarioId of catalogScenarioIds) {
  assert.equal(seenIds.has(scenarioId), true, `missing scenario implementation status entry for ${scenarioId}`);
}

console.log(
  `[verify-scenario-implementation-status] ok: ${scenarios.length} scenarios, ${operationsById.size} operations, ${toolsById.size} tools`
);
