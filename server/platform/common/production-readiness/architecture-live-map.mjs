import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildProductionHealthReport } from "./report-reader.mjs";

export const ARCHITECTURE_LIVE_MAP_PROTOCOL_VERSION = "v0.0.1:platform:architecture-live-map-1";

const defaultRepoRoot = path.resolve(fileURLToPath(new URL("../../../..", import.meta.url)));

const ARCHITECTURE_NODES = Object.freeze([
  {
    nodeId: "workspace-asset-governance",
    label: "Workspace Asset Governance",
    docRefs: [
      "docs/Architecture.md",
      "docs/WORKSPACE-ASSET-GOVERNANCE.md",
      "docs/PROTOCOLS.md"
    ],
    implementationPaths: [
      "server/platform/specialized/agent/workspace-contribution/index.mjs",
      "server/platform/specialized/agent/workspace-governance/index.mjs"
    ],
    gateIds: ["workspace-contribution-governance", "workspace-governance"]
  },
  {
    nodeId: "agent-library-access",
    label: "AgentLibrary Access",
    docRefs: [
      "docs/Architecture.md",
      "docs/KNOWLEDGE-GOVERNANCE.md",
      "docs/PROTOCOLS.md"
    ],
    implementationPaths: [
      "server/platform/specialized/knowledge/agent-library/access-policy.mjs"
    ],
    gateIds: ["agent-library-access"]
  },
  {
    nodeId: "knowledge-core",
    label: "Knowledge Core",
    docRefs: [
      "docs/KNOWLEDGE-GOVERNANCE.md",
      "docs/PROTOCOLS.md"
    ],
    implementationPaths: [
      "server/platform/specialized/knowledge/storage/knowledge-core/index.mjs",
      "server/platform/specialized/knowledge/storage/external-knowledge-base/index.mjs"
    ],
    gateIds: ["external-knowledge-base-consistency", "rag-evaluation", "distillation-evaluation"]
  },
  {
    nodeId: "module-ecosystem",
    label: "Module Ecosystem",
    docRefs: [
      "docs/Architecture.md",
      "docs/PROTOCOLS.md"
    ],
    implementationPaths: [
      "server/platform/common/module-manager/module-ecosystem/index.mjs",
      "server/platform/common/module-manager/mount-manager.mjs"
    ],
    gateIds: ["module-ecosystem"]
  },
  {
    nodeId: "version-control",
    label: "Version Governance",
    docRefs: [
      "docs/Architecture.md",
      "docs/CONTEXT.md",
      "docs/PROTOCOLS.md"
    ],
    implementationPaths: [
      "server/platform/common/version-control/README.md",
      "server/platform/common/version-control/version-registry.json",
      "server/platform/common/version-control/version-registry.schema.json",
      "server/platform/common/version-control/version-scan.mjs",
      "server/scripts/verify-version-registry.mjs",
      "server/scripts/verify-version-naming.mjs"
    ],
    gateIds: ["architecture", "version-registry", "version-naming"]
  },
  {
    nodeId: "asset-lineage",
    label: "Multimodal Asset Lineage",
    docRefs: [
      "docs/KNOWLEDGE-GOVERNANCE.md",
      "docs/PROTOCOLS.md"
    ],
    implementationPaths: [
      "server/platform/specialized/knowledge/assets/asset-lineage/index.mjs"
    ],
    gateIds: ["asset-lineage"]
  },
  {
    nodeId: "production-readiness",
    label: "Production Readiness",
    docRefs: [
      "docs/PRODUCTION-CAPABILITY-GAP.md",
      "docs/PROTOCOLS.md"
    ],
    implementationPaths: [
      "server/scripts/production-readiness-gate.mjs",
      "server/platform/common/production-readiness/report-reader.mjs",
      "server/platform/common/production-readiness/executive-report.mjs"
    ],
    gateIds: ["architecture", "executive-report", "performance-capacity"]
  }
]);

function text(value) {
  return String(value ?? "").trim();
}

async function pathExists(repoRoot, relativePath) {
  try {
    await fs.access(path.join(repoRoot, relativePath));
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function gateStatus(gatesById, gateIds = []) {
  const statuses = gateIds.map((gateId) => text(gatesById.get(gateId)?.status || "missing"));
  if (statuses.includes("fail") || statuses.includes("timeout") || statuses.includes("blocked")) return "blocked";
  if (statuses.includes("missing")) return "partial";
  if (statuses.every((status) => status === "pass")) return "pass";
  return statuses[0] || "missing";
}

export async function buildArchitectureLiveMap(options = {}) {
  const repoRoot = options.repoRoot || defaultRepoRoot;
  const productionHealth = options.productionHealth || await buildProductionHealthReport({
    repoRoot,
    reportRoot: options.reportRoot
  });
  const gatesById = new Map((productionHealth.gates || []).map((gate) => [gate.id, gate]));
  const nodes = [];
  for (const node of ARCHITECTURE_NODES) {
    const docRefs = await Promise.all(node.docRefs.map(async (docPath) => ({
      path: docPath,
      exists: await pathExists(repoRoot, docPath)
    })));
    const implementationPaths = await Promise.all(node.implementationPaths.map(async (implPath) => ({
      path: implPath,
      exists: await pathExists(repoRoot, implPath)
    })));
    const gates = node.gateIds.map((gateId) => ({
      gateId,
      status: text(gatesById.get(gateId)?.status || "missing"),
      title: text(gatesById.get(gateId)?.title || gateId),
      nextStep: text(gatesById.get(gateId)?.nextStep || "")
    }));
    const missingDocs = docRefs.filter((item) => !item.exists).map((item) => item.path);
    const missingImplementations = implementationPaths.filter((item) => !item.exists).map((item) => item.path);
    const status = missingDocs.length || missingImplementations.length
      ? "partial"
      : gateStatus(gatesById, node.gateIds);
    nodes.push({
      protocolVersion: ARCHITECTURE_LIVE_MAP_PROTOCOL_VERSION,
      nodeId: node.nodeId,
      label: node.label,
      status,
      docRefs,
      implementationPaths,
      gates,
      missingDocs,
      missingImplementations
    });
  }
  return {
    schemaVersion: "v0.0.1:schema:definition-1",
    protocolVersion: ARCHITECTURE_LIVE_MAP_PROTOCOL_VERSION,
    generatedAt: new Date().toISOString(),
    productionStatus: text(productionHealth.status || "missing"),
    nodes,
    summary: {
      total: nodes.length,
      pass: nodes.filter((node) => node.status === "pass").length,
      partial: nodes.filter((node) => node.status === "partial").length,
      blocked: nodes.filter((node) => node.status === "blocked").length,
      missingDocs: nodes.reduce((sum, node) => sum + node.missingDocs.length, 0),
      missingImplementations: nodes.reduce((sum, node) => sum + node.missingImplementations.length, 0)
    }
  };
}
