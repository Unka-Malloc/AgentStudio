#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

const CANONICAL_TARGETS = Object.freeze([
  { id: "openclaw", label: "OpenClaw", profile: "pact.mcp.openclaw" },
  { id: "claude-code", label: "Claude Code", profile: "pact.mcp.claude-code" },
  { id: "codex", label: "Codex", profile: "pact.mcp.codex" },
  { id: "gemini-cli", label: "Gemini CLI", profile: "pact.mcp.gemini-cli" },
  { id: "antigravity", label: "Antigravity", profile: "pact.mcp.antigravity" },
  { id: "opencode", label: "OpenCode", profile: "pact.mcp.opencode" },
  { id: "copilot", label: "Copilot", profile: "pact.mcp.copilot" },
  { id: "kilo-code", label: "Kilo Code", profile: "pact.mcp.kilo-code" },
  { id: "cursor", label: "Cursor", profile: "pact.mcp.cursor" },
  { id: "hermes", label: "Hermes Agent", profile: "pact.mcp.hermes" },
  { id: "windsurf", label: "Windsurf", profile: "pact.mcp.windsurf" }
]);

const CANONICAL_IDS = Object.freeze(CANONICAL_TARGETS.map((target) => target.id));

async function readText(relativePath) {
  return fs.readFile(path.join(repoRoot, relativePath), "utf8");
}

async function readJson(relativePath) {
  return JSON.parse(await readText(relativePath));
}

function assertIncludes(text, needle, relativePath) {
  assert.equal(
    text.includes(needle),
    true,
    `${relativePath} must include ${needle}`
  );
}

async function assertTextHasIds(relativePath) {
  const text = await readText(relativePath);
  for (const target of CANONICAL_TARGETS) {
    assertIncludes(text, target.id, relativePath);
  }
}

async function assertTextHasLabels(relativePath) {
  const text = await readText(relativePath);
  for (const target of CANONICAL_TARGETS) {
    assertIncludes(text, target.label, relativePath);
  }
}

async function assertTargetDefinitionFile(relativePath) {
  const text = await readText(relativePath);
  for (const target of CANONICAL_TARGETS) {
    assertIncludes(text, `id: "${target.id}"`, relativePath);
    assertIncludes(text, `label: "${target.label}"`, relativePath);
  }
}

async function assertDartManualTargetList(relativePath) {
  const text = await readText(relativePath);
  for (const target of CANONICAL_TARGETS) {
    assertIncludes(text, `('${target.id}', '${target.label}')`, relativePath);
  }
}

async function assertPackagingManifest() {
  const manifest = await readJson("client-gui/packaging.modules.json");
  assert.deepEqual(
    manifest.modules?.["target-adapters"]?.targetAdapters,
    CANONICAL_IDS,
    "client-gui/packaging.modules.json targetAdapters must match canonical agent client support targets"
  );
  for (const target of CANONICAL_TARGETS) {
    assertIncludes(manifest.modules["target-adapters"].label, target.label, "client-gui/packaging.modules.json");
  }
}

async function assertGrantProfiles(relativePath) {
  const text = await readText(relativePath);
  for (const target of CANONICAL_TARGETS) {
    assertIncludes(text, target.profile, relativePath);
  }
}

await assertTargetDefinitionFile("client-cli/src/targets.rs");
await assertDartManualTargetList("client-gui/lib/src/ui/manual_target_dialog.dart");
await assertTextHasIds("client-gui/scripts/verify-client-architecture.mjs");
await assertTextHasLabels("client-gui/scripts/verify-client-plan.mjs");
await assertPackagingManifest();

await assertTextHasIds("mcp-connector/bin/pact-mcp.mjs");
await assertTextHasIds("server/scripts/mcp-install.mjs");
await assertTextHasIds("server/scripts/verify-mcp-http.mjs");
await assertTextHasIds("server/scripts/verify-mcp-release.mjs");
await assertTextHasIds("server/scripts/verify-mcp-agent-target-install.mjs");
await assertTextHasIds("server/platform/common/mcp/http-mcp-adapter.mjs");
await assertGrantProfiles("server/platform/specialized/capabilities/skills/tool-skill-management-provider.mjs");

for (const docPath of [
  "docs/AGENT-CLIENT-SUPPORT-TARGETS.md",
  "README.md",
  "README.zh-CN.md",
  "docs/CLIENT_ARCHITECTURE.md",
  "docs/PROTOCOLS.md",
  "docs/Architecture.md",
  "docs/WORKSPACE-ASSET-GOVERNANCE.md",
  "docs/boundary/N-2-N-Interfaces.md",
  "docs/boundary/2-3-5-Security-Model.md",
  "docs/MCP_INSTALL.md",
  "docs/MCP_INSTALL.zh-CN.md",
  "mcp-connector/README.md",
  "docs/PRODUCT.md"
]) {
  await assertTextHasLabels(docPath);
}

console.log("agent-client support targets verified");
