#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __root = path.resolve(fileURLToPath(import.meta.url), "../..");

async function updateJson(file, updater) {
  const fullPath = path.join(__root, file);
  const content = JSON.parse(await fs.readFile(fullPath, "utf8"));
  updater(content);
  await fs.writeFile(fullPath, JSON.stringify(content, null, 2) + "\n");
  console.log(`[updated] ${file}`);
}

async function updateFile(file, updater) {
  const fullPath = path.join(__root, file);
  const content = await fs.readFile(fullPath, "utf8");
  const newContent = updater(content);
  if (content !== newContent) {
    await fs.writeFile(fullPath, newContent);
    console.log(`[updated] ${file}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  let newVersion = null;
  let newDescription = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--version" || args[i] === "-v") {
      newVersion = args[++i];
    } else if (args[i] === "--description" || args[i] === "-d") {
      newDescription = args[++i];
    }
  }

  if (!newVersion && !newDescription) {
    console.error("Usage: node scripts/bump-project-metadata.mjs [--version <ver>] [--description <desc>]");
    process.exit(1);
  }

  // 1. Update package.json
  await updateJson("package.json", (json) => {
    if (newVersion) json.version = newVersion;
    if (newDescription) json.description = newDescription;
  });

  // 2. Update server/platform/common/mcp/gateway-installer/package.json
  await updateJson("server/platform/common/mcp/gateway-installer/package.json", (json) => {
    if (newVersion) json.version = newVersion;
    if (newDescription) json.description = newDescription;
  });

  // 3. Update server/platform/common/mcp/http-mcp-adapter.mjs
  await updateFile("server/platform/common/mcp/http-mcp-adapter.mjs", (content) => {
    let res = content;
    if (newVersion) {
      res = res.replace(/export const MCP_SERVER_VERSION = "[^"]+"/, `export const MCP_SERVER_VERSION = "${newVersion}"`);
      res = res.replace(/export const MCP_CONNECTOR_VERSION = "[^"]+"/, `export const MCP_CONNECTOR_VERSION = "${newVersion}"`);
    }
    if (newDescription) {
      // Update capabilitiesSummary and buildPactMcpDiscovery description
      res = res.replace(/capabilitiesSummary: "Pact Unified Agent Workspace MCP\. Outlets: [^"]+"/, `capabilitiesSummary: "Pact Unified Agent Workspace MCP. ${newDescription}"`);
      res = res.replace(/description: "Pact Unified Agent Workspace MCP\. Provides [^"]+"/, `description: "${newDescription}"`);
    }
    return res;
  });

  // 4. Update server/scripts/verify-mcp-http.mjs (Version check only)
  if (newVersion) {
    await updateFile("server/scripts/verify-mcp-http.mjs", (content) => {
      // Replace version assertions: assert.equal(..., "0.0.x")
      return content.replace(/assert\.equal\((discovery\.payload\.serverVersion|handshake\.payload\.payload\.server\.serverVersion), "[^"]+"\)/g, (match, p1) => {
        return `assert.equal(${p1}, "${newVersion}")`;
      });
    });
  }

  // 5. Update server/platform/common/mcp/gateway-installer/bin/pact-mcp.mjs (Hardcoded descriptions)
  if (newDescription) {
    await updateFile("server/platform/common/mcp/gateway-installer/bin/pact-mcp.mjs", (content) => {
      // Find strings like "Pact Unified Agent Workspace MCP. Provides..."
      return content.replace(/"Pact Unified Agent Workspace MCP\. Provides [^"]+"/g, `"${newDescription}"`);
    });
  }

  console.log("\nMetadata sync complete.");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
