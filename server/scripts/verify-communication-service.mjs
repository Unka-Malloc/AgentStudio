#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  COMMUNICATION_SERVICE_ID,
  COMMUNICATION_SERVICE_PROTOCOL_VERSION,
  createCommunicationServiceProvider
} from "../platform/specialized/capabilities/communication-service/index.mjs";
import { ACP_AGENT_RELAY_PROTOCOL_VERSION } from "../platform/specialized/capabilities/agent-relay/acp-agent-relay/index.mjs";
import {
  MCP_INTERFACE_VERSION,
  MCP_PROTOCOL_VERSION,
  MCP_SERVER_NAME,
  MCP_STABLE_TOOL_NAME
} from "../platform/common/mcp/http-mcp-adapter.mjs";
import { DOWNSTREAM_CLIENT_ASPECT_ROUTE_TARGETS } from "../platform/common/downstream-client-aspect/index.mjs";

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

async function read(relativePath) {
  return fs.readFile(path.join(repoRoot, relativePath), "utf8");
}

async function readJson(relativePath) {
  return JSON.parse(await read(relativePath));
}

function serviceById(services, serviceId) {
  const service = services.find((item) => item.serviceId === serviceId);
  assert.ok(service, `${serviceId} must be declared by communication service`);
  return service;
}

async function verifyProvider() {
  const provider = createCommunicationServiceProvider();
  assert.equal(provider.serviceId, COMMUNICATION_SERVICE_ID);
  assert.equal(provider.protocolVersion, COMMUNICATION_SERVICE_PROTOCOL_VERSION);

  const description = provider.describe();
  assert.equal(description.serviceId, COMMUNICATION_SERVICE_ID);
  assert.equal(description.protocolVersion, COMMUNICATION_SERVICE_PROTOCOL_VERSION);
  assert.equal(description.boundary, "platform-capability");
  assert.ok(description.capabilities.includes("communication.services.list"));
  assert.ok(description.capabilities.includes("communication.services.resolve"));

  const services = provider.listServices();
  assert.equal(services.length, 2);

  const acpRelay = serviceById(services, "acp-agent-relay");
  assert.equal(acpRelay.label, "ACP Relay");
  assert.equal(acpRelay.protocol, "acp");
  assert.equal(acpRelay.protocolVersion, ACP_AGENT_RELAY_PROTOCOL_VERSION);
  assert.equal(acpRelay.routeTarget, DOWNSTREAM_CLIENT_ASPECT_ROUTE_TARGETS.acp);
  assert.equal(acpRelay.runtimeBoundary, "platform-capability");
  assert.equal(acpRelay.operationBoundary, ACP_AGENT_RELAY_PROTOCOL_VERSION);
  assert.ok(acpRelay.functions.includes("virtual inbound agent catalog"));

  const mcpServer = serviceById(services, "mcp-server-side");
  assert.equal(mcpServer.label, "MCP Server");
  assert.equal(mcpServer.protocol, "mcp");
  assert.equal(mcpServer.protocolVersion, MCP_INTERFACE_VERSION);
  assert.equal(mcpServer.externalProtocolVersion, MCP_PROTOCOL_VERSION);
  assert.equal(mcpServer.routeTarget, DOWNSTREAM_CLIENT_ASPECT_ROUTE_TARGETS.mcp);
  assert.equal(mcpServer.serverName, MCP_SERVER_NAME);
  assert.equal(mcpServer.stableToolName, MCP_STABLE_TOOL_NAME);
  assert.equal(mcpServer.operationBoundary, "pact.tool-management.v1");
  assert.ok(mcpServer.functions.includes("Tool Management projection"));

  assert.equal(provider.resolveService({ protocol: "acp" }).serviceId, "acp-agent-relay");
  assert.equal(provider.resolveService({ protocol: "mcp" }).serviceId, "mcp-server-side");
  assert.equal(provider.resolveService({ routeTarget: "acp-agent-relay" }).protocol, "acp");
  assert.equal(provider.resolveService({ serviceId: "mcp-server-side" }).protocol, "mcp");
  assert.equal(provider.resolveService({ serviceId: "missing" }), null);
  assert.deepEqual(provider.routeTargetSnapshot(), {
    acp: DOWNSTREAM_CLIENT_ASPECT_ROUTE_TARGETS.acp,
    mcp: DOWNSTREAM_CLIENT_ASPECT_ROUTE_TARGETS.mcp
  });
}

async function verifyModuleManifest() {
  const manifest = await readJson("server/platform/specialized/capabilities/communication-service/module.json");
  assert.equal(manifest.protocol, COMMUNICATION_SERVICE_PROTOCOL_VERSION);
  assert.equal(manifest.components.communicationService.factory, "createCommunicationServiceProvider");

  const manifestAcp = serviceById(manifest.services, "acp-agent-relay");
  assert.equal(manifestAcp.routeTarget, DOWNSTREAM_CLIENT_ASPECT_ROUTE_TARGETS.acp);
  assert.equal(manifestAcp.modulePath, "server/platform/specialized/capabilities/agent-relay/acp-agent-relay");

  const manifestMcp = serviceById(manifest.services, "mcp-server-side");
  assert.equal(manifestMcp.routeTarget, DOWNSTREAM_CLIENT_ASPECT_ROUTE_TARGETS.mcp);
  assert.equal(manifestMcp.modulePath, "server/platform/common/mcp/http-mcp-adapter.mjs");
}

async function verifyDocs() {
  const html = await read("docs/architecture/PACT-SYSTEM-ARCHITECTURE.html");
  assert.ok(html.includes("通信服务"));
  assert.ok(html.includes("<code>communication-service</code>"));
  assert.ok(html.includes("<strong>ACP Relay</strong>"));
  assert.ok(html.includes("<strong>MCP Server</strong>"));
  assert.ok(html.includes("mcp-server-side"));
  assert.ok(html.includes("acp-agent-relay"));

  const architecture = await read("docs/Architecture.md");
  assert.ok(architecture.includes("通信服务归入能力层"));
  assert.ok(architecture.includes("communication service（ACP Relay、MCP Server Side）"));
}

async function main() {
  await verifyProvider();
  await verifyModuleManifest();
  await verifyDocs();
  console.log("[communication-service] ok");
}

await main();
