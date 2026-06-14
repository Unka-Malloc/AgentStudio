#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { SERVER_API_OPERATIONS } from "../platform/common/operation-dispatcher/operation-registry.mjs";
import {
  SAMPLE_BUSINESS_PACK_PROTOCOL_VERSION,
  createSampleBusinessPackStore,
  getSampleBusinessPack,
  listSampleBusinessPacks
} from "../platform/common/production-readiness/sample-business-pack.mjs";
import { createToolCatalog } from "../platform/specialized/capabilities/tools/tool-management-core/catalog.mjs";

const SAMPLE_PACK_ID = "enterprise-knowledge-pilot";

async function readText(filePath) {
  return fs.readFile(filePath, "utf8");
}

function assertCategories(manifest) {
  for (const category of ["email", "pdf", "ppt", "markdown_project", "external_knowledge_base"]) {
    assert.ok(manifest.assetCategories.includes(category), `${category} sample asset must be declared`);
  }
}

async function verifyManifestAndMaterialization(tempRoot) {
  const list = listSampleBusinessPacks();
  assert.equal(list.protocolVersion, SAMPLE_BUSINESS_PACK_PROTOCOL_VERSION);
  assert.ok(list.packs.some((pack) => pack.packId === SAMPLE_PACK_ID));

  const manifest = getSampleBusinessPack(SAMPLE_PACK_ID);
  assert.equal(manifest.protocolVersion, SAMPLE_BUSINESS_PACK_PROTOCOL_VERSION);
  assert.equal(manifest.assetCount, 7);
  assertCategories(manifest);
  assert.ok(manifest.ingestPlan.some((step) => step.route === "externalKnowledgeBase"));
  assert.ok(manifest.externalServices.some((service) => service.serviceId === "qdrant"));

  const store = createSampleBusinessPackStore({ userDataPath: tempRoot });
  const materialized = await store.materialize({ packId: SAMPLE_PACK_ID });
  assert.equal(materialized.protocolVersion, SAMPLE_BUSINESS_PACK_PROTOCOL_VERSION);
  assert.equal(materialized.writtenFiles.length, manifest.assetCount);
  assert.ok(materialized.targetRoot.startsWith(path.join(tempRoot, "sample-business-packs")));

  const filesByPath = new Map(materialized.writtenFiles.map((file) => [file.relativePath, file]));
  const email = await readText(filesByPath.get("mail/vendor-renewal-thread.eml").absolutePath);
  assert.match(email, /Subject: 供应商续约排期和风险确认/);

  const pdf = await fs.readFile(filesByPath.get("documents/security-review.pdf").absolutePath);
  assert.ok(pdf.subarray(0, 8).toString("utf8").startsWith("%PDF-1."));

  const ppt = unzipSync(new Uint8Array(await fs.readFile(filesByPath.get("documents/roadmap-review.pptx").absolutePath)));
  assert.ok(ppt["ppt/presentation.xml"], "ppt presentation entry must exist");
  assert.match(strFromU8(ppt["ppt/slides/slide1.xml"]), /知识库试点路线图/);

  const markdown = await readText(filesByPath.get("markdown-project/decisions/ADR-001-knowledge-governance.md").absolutePath);
  assert.match(markdown, /canonical evidence/);

  const compose = await readText(filesByPath.get("external-knowledge/docker-compose.yml").absolutePath);
  assert.match(compose, /qdrant\/qdrant/);
  assert.match(compose, /postgres:17-alpine/);

  const writtenManifest = JSON.parse(await readText(materialized.manifestPath));
  assert.equal(writtenManifest.protocolVersion, SAMPLE_BUSINESS_PACK_PROTOCOL_VERSION);
  assert.equal(writtenManifest.writtenFiles.length, manifest.assetCount);

  await assert.rejects(
    () => store.materialize({ packId: SAMPLE_PACK_ID, targetRoot: "../../outside" }),
    /targetRoot must stay inside/
  );
}

function verifyOperationsAndTools() {
  const operations = new Map(SERVER_API_OPERATIONS.map((operation) => [operation.id, operation]));
  for (const id of [
    "sample_business_pack.list",
    "sample_business_pack.get",
    "sample_business_pack.materialize"
  ]) {
    assert.ok(operations.has(id), `${id} must be registered`);
  }
  assert.equal(operations.get("sample_business_pack.get").http.path, "/api/sample-business-packs/:packId");
  assert.equal(operations.get("sample_business_pack.materialize").target.method, "handleSampleBusinessPackMaterialize");
  assert.equal(operations.get("sample_business_pack.materialize").safety.risk, "safe_write");

  const catalog = createToolCatalog({ operations: SERVER_API_OPERATIONS });
  const materializeTool = catalog.tools.find((tool) => tool.id === "pact.sampleBusinessPack.materialize");
  assert.ok(materializeTool, "sample business pack materialize tool must be exposed");
  assert.equal(materializeTool.operationId, "sample_business_pack.materialize");
  assert.ok(materializeTool.toolsets.includes("pact.agentLibrary.maintain"));
  assert.ok(materializeTool.requiredScopes.includes("knowledge:maintain"));
}

async function main() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pact-sample-business-pack-"));
  try {
    await verifyManifestAndMaterialization(tempRoot);
    verifyOperationsAndTools();
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
  console.log("[sample-business-pack] ok");
}

await main();
