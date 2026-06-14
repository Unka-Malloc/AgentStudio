#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const requiredVerifierScripts = [
  "client:verify:architecture",
  "client:verify:plan",
  "client:verify:state-store",
  "client:verify:targets",
  "client:verify:config-writes",
  "client:verify:pairing-skill-cli",
  "client:verify:mcp-plugins",
  "client:verify:thin-forwarding"
];
const firstTargets = [
  "OpenClaw",
  "Claude Code",
  "Codex",
  "Antigravity",
  "OpenCode",
  "Copilot",
  "Kilo Code",
  "Cursor",
  "Hermes Agent"
];
const sevenModules = ["Agents", "MCP Plugins", "Skill Hub", "Model Forwarding", "Mobile Relay", "Activity", "Settings"];

const failures = [];

function assert(condition, message) {
  if (!condition) {
    failures.push(message);
  }
}

async function readText(relativePath) {
  return fs.readFile(path.join(repoRoot, relativePath), "utf8");
}

async function readJson(relativePath) {
  return JSON.parse(await readText(relativePath));
}

function linesContaining(source, token) {
  return source
    .split(/\r?\n/)
    .map((line, index) => ({ line, number: index + 1 }))
    .filter((item) => item.line.includes(token));
}

const packageJson = await readJson("package.json");
const scripts = packageJson.scripts || {};
for (const scriptName of requiredVerifierScripts) {
  assert(Boolean(scripts[scriptName]), `package.json must define ${scriptName}`);
  assert(scripts["client:verify"]?.includes(scriptName), `client:verify must aggregate ${scriptName}`);
}
for (const scriptName of ["client:package:plan", "feature:build:client", "client:analyze", "client:test", "client:native:test"]) {
  assert(Boolean(scripts[scriptName]), `package.json must define ${scriptName}`);
}

const testsRunner = await readText("tests/run.mjs");
for (const suiteId of [
  "client.architecture",
  "client.plan",
  "client.targets",
  "client.config-writes",
  "client.state-store",
  "client.pairing-skill",
  "client.mcp-plugins",
  "client.thin-forwarding"
]) {
  assert(testsRunner.includes(`suite("${suiteId}"`), `tests/run.mjs must register suite ${suiteId}`);
  assert(testsRunner.includes(`"${suiteId}"`), `tests/run.mjs client profiles must include suite ${suiteId}`);
}

const architecture = await readText("docs/CLIENT_ARCHITECTURE.md");
const testFramework = await readText("docs/TEST-FRAMEWORK.md");

for (const target of firstTargets) {
  assert(architecture.includes(target), `CLIENT_ARCHITECTURE must include target ${target}`);
}
for (const moduleName of sevenModules) {
  assert(architecture.includes(moduleName), `CLIENT_ARCHITECTURE must include module ${moduleName}`);
}
for (const scriptName of requiredVerifierScripts) {
  assert(testFramework.includes(scriptName), `TEST-FRAMEWORK must document ${scriptName}`);
}

const protocolLines = linesContaining(architecture, "protocol_deferred");
assert(protocolLines.length > 0, "CLIENT_ARCHITECTURE must preserve protocol_deferred boundary language");
for (const item of protocolLines) {
  assert(!/\bdone\b|已完成|完成落地/.test(item.line), `CLIENT_ARCHITECTURE must not mark protocol_deferred as done at line ${item.number}`);
}

const packaging = await readJson("client-gui/packaging.modules.json");
assert(packaging.packageProfile === "future-client", "packaging.modules.json must default to future-client profile");
assert(!JSON.stringify(packaging).toLowerCase().includes("legacy"), "packaging.modules.json must not retain legacy modules");

if (failures.length > 0) {
  console.error(JSON.stringify({ ok: false, failures }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  verifierScripts: requiredVerifierScripts,
  targets: firstTargets,
  modules: sevenModules,
  protocolDeferredReferences: protocolLines.length
}, null, 2));
