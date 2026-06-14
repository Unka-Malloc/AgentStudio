#!/usr/bin/env node
import assert from "node:assert/strict";
import { SERVER_API_OPERATIONS } from "../platform/common/operation-dispatcher/operation-registry.mjs";
import {
  ARCHITECTURE_LIVE_MAP_PROTOCOL_VERSION,
  buildArchitectureLiveMap
} from "../platform/common/production-readiness/architecture-live-map.mjs";
import { createToolCatalog } from "../platform/specialized/capabilities/tools/tool-management-core/catalog.mjs";

const ALL_GATE_IDS = [
  "workspace-contribution-governance",
  "workspace-governance",
  "agent-library-access",
  "external-knowledge-base-consistency",
  "rag-evaluation",
  "distillation-evaluation",
  "module-ecosystem",
  "version-registry",
  "version-naming",
  "asset-lineage",
  "architecture",
  "executive-report",
  "performance-capacity"
];

function productionHealth(overrides = {}) {
  const gateOverrides = new Map((overrides.gates || []).map((gate) => [gate.id, gate]));
  return {
    schemaVersion: "v0.0.1:schema:definition-1",
    reportType: "v0.0.1:platform:production-health-1",
    generatedAt: "2026-05-22T00:00:00.000Z",
    status: overrides.status || "pass",
    latestReport: {
      runId: "20260522T000000Z",
      reportPath: "docs/reports/history/production-readiness/20260522T000000Z/report.json"
    },
    summary: { pass: ALL_GATE_IDS.length, fail: 0, timeout: 0, blockedP0: 0 },
    coverage: { required: [], missing: [] },
    gates: ALL_GATE_IDS.map((id) => ({
      id,
      title: id,
      status: "pass",
      blockerLevel: id === "architecture" ? "P0" : "P3",
      nextStep: "",
      ...gateOverrides.get(id)
    }))
  };
}

async function verifyLiveMap() {
  const liveMap = await buildArchitectureLiveMap({ productionHealth: productionHealth() });
  assert.equal(liveMap.protocolVersion, ARCHITECTURE_LIVE_MAP_PROTOCOL_VERSION);
  assert.equal(liveMap.schemaVersion, "v0.0.1:schema:definition-1");
  assert.equal(liveMap.productionStatus, "pass");
  assert.ok(liveMap.nodes.length >= 6, "core architecture nodes must be listed");
  assert.equal(liveMap.summary.total, liveMap.nodes.length);
  assert.equal(liveMap.summary.pass, liveMap.nodes.length);
  assert.equal(liveMap.summary.partial, 0);
  assert.equal(liveMap.summary.blocked, 0);
  assert.equal(liveMap.summary.missingDocs, 0);
  assert.equal(liveMap.summary.missingImplementations, 0);

  const nodesById = new Map(liveMap.nodes.map((node) => [node.nodeId, node]));
  const workspaceNode = nodesById.get("workspace-asset-governance");
  assert.ok(workspaceNode, "workspace asset governance node must exist");
  assert.equal(workspaceNode.status, "pass");
  assert.ok(workspaceNode.docRefs.every((ref) => ref.exists), "workspace docs must resolve");
  assert.ok(workspaceNode.implementationPaths.every((ref) => ref.exists), "workspace implementations must resolve");
  assert.deepEqual(
    workspaceNode.gates.map((gate) => gate.gateId),
    ["workspace-contribution-governance", "workspace-governance"]
  );
  const versionControlNode = nodesById.get("version-control");
  assert.ok(versionControlNode, "version control node must exist");
  assert.equal(versionControlNode.status, "pass");
  assert.ok(versionControlNode.docRefs.every((ref) => ref.exists), "version control docs must resolve");
  assert.ok(versionControlNode.implementationPaths.every((ref) => ref.exists), "version control implementation path must resolve");
  assert.deepEqual(
    versionControlNode.gates.map((gate) => gate.gateId),
    ["architecture", "version-registry", "version-naming"]
  );

  const blockedMap = await buildArchitectureLiveMap({
    productionHealth: productionHealth({
      status: "blocked",
      gates: [
        {
          id: "asset-lineage",
          status: "fail",
          nextStep: "repair asset lineage"
        }
      ]
    })
  });
  const blockedAssetNode = blockedMap.nodes.find((node) => node.nodeId === "asset-lineage");
  assert.equal(blockedAssetNode.status, "blocked");
  assert.equal(blockedAssetNode.gates[0].nextStep, "repair asset lineage");
  assert.equal(blockedMap.summary.blocked, 1);
}

function verifyOperationsAndTools() {
  const operations = new Map(SERVER_API_OPERATIONS.map((operation) => [operation.id, operation]));
  const operation = operations.get("architecture.live_map");
  assert.ok(operation, "architecture live map operation must be registered");
  assert.equal(operation.target.method, "handleArchitectureLiveMap");
  assert.equal(operation.http.method, "GET");
  assert.equal(operation.http.path, "/api/architecture/live-map");
  assert.equal(operation.readOnly, true);
  assert.equal(operation.concurrencySafe, true);

  const catalog = createToolCatalog({ operations: SERVER_API_OPERATIONS });
  const tool = catalog.tools.find((item) => item.id === "pact.architecture.liveMap");
  assert.ok(tool, "architecture live map tool must be exposed");
  assert.equal(tool.operationId, "architecture.live_map");
  assert.ok(tool.toolsets.includes("pact.runtime.read"));
  assert.ok(tool.requiredScopes.includes("storage:read"));
}

async function main() {
  await verifyLiveMap();
  verifyOperationsAndTools();
  console.log("[architecture-live-map] ok");
}

await main();
