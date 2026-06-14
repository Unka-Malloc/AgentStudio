#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SERVER_API_OPERATIONS } from "../platform/common/operation-dispatcher/operation-registry.mjs";
import {
  ASSET_LINEAGE_PROTOCOL_VERSION,
  createAssetLineageRegistry,
  normalizeAssetLineageRecord
} from "../platform/specialized/knowledge/assets/asset-lineage/index.mjs";
import { createToolCatalog } from "../platform/specialized/capabilities/tools/tool-management-core/catalog.mjs";

function imageRecord() {
  return {
    assetId: "asset-image-1",
    assetType: "image",
    mediaType: "image/png",
    rawObject: {
      objectId: "raw-pdf-1",
      uri: "objects/raw-pdf-1.pdf",
      contentHash: "sha256:old",
      mediaType: "application/pdf",
      byteSize: 2048
    },
    sourceAnchor: {
      documentId: "doc-1",
      page: 2,
      bbox: [10, 20, 300, 180],
      coordinateSystem: "page-pixels",
      sourceRange: { blockStart: 5, blockEnd: 8 }
    },
    parser: {
      id: "pdf-visual",
      version: "1.0.0"
    },
    visualModel: {
      id: "vision-layout",
      provider: "local",
      version: "2026-05-01",
      promptVersion: "layout-v1"
    },
    ocr: {
      id: "paddleocr",
      version: "3.0.0"
    },
    producedBy: {
      operationId: "knowledge.import",
      jobId: "job-1",
      batchId: "batch-1",
      mountName: "pdfProcessor",
      parserRoute: "extension:.pdf"
    }
  };
}

async function verifyRuntime(tempRoot) {
  const registry = createAssetLineageRegistry({ userDataPath: tempRoot });
  const normalized = normalizeAssetLineageRecord(imageRecord());
  assert.equal(normalized.protocolVersion, ASSET_LINEAGE_PROTOCOL_VERSION);
  assert.equal(normalized.sourceAnchor.page, 2);
  assert.deepEqual(normalized.sourceAnchor.bbox, [10, 20, 300, 180]);
  assert.equal(normalized.parser.id, "pdf-visual");
  assert.equal(normalized.visualModel.promptVersion, "layout-v1");

  const image = await registry.record(imageRecord());
  assert.equal(image.record.assetId, "asset-image-1");
  assert.equal(image.audit.eventType, "asset_lineage.recorded");

  const table = await registry.record({
    assetId: "asset-table-1",
    assetType: "table",
    rawObject: imageRecord().rawObject,
    sourceAnchor: {
      documentId: "doc-1",
      page: 2,
      bbox: { x: 12, y: 210, width: 480, height: 160 },
      tableIndex: 1
    },
    parser: { id: "pdf-visual", version: "1.0.0" },
    visualModel: { id: "vision-layout", version: "2026-05-01", promptVersion: "layout-v1" },
    derivedFromAssetIds: ["asset-image-1"],
    producedBy: { operationId: "knowledge.table.extract", jobId: "job-1" }
  });
  assert.equal(table.record.sourceAnchor.bbox[2], 480);
  assert.deepEqual(table.record.derivedFromAssetIds, ["asset-image-1"]);

  const trace = await registry.trace({ assetId: "asset-table-1" });
  assert.equal(trace.protocolVersion, ASSET_LINEAGE_PROTOCOL_VERSION);
  assert.equal(trace.found, true);
  assert.deepEqual(trace.chain.map((item) => item.assetId), ["asset-table-1", "asset-image-1"]);
  assert.deepEqual(trace.rootRawObjects, ["raw-pdf-1"]);

  const reparse = await registry.planReparse({
    parser: { id: "pdf-visual", version: "1.1.0" },
    visualModel: { id: "vision-layout", version: "2026-05-20", promptVersion: "layout-v2" },
    rawObject: { contentHash: "sha256:new" }
  });
  assert.equal(reparse.protocolVersion, ASSET_LINEAGE_PROTOCOL_VERSION);
  assert.equal(reparse.candidateCount, 2);
  assert.ok(reparse.candidates.every((item) => item.reasons.includes("parser_version_changed")));
  assert.ok(reparse.candidates.every((item) => item.reasons.includes("visual_model_version_changed")));
  assert.ok(reparse.candidates.every((item) => item.reasons.includes("prompt_version_changed")));
  assert.ok(reparse.candidates.every((item) => item.reasons.includes("raw_object_hash_changed")));

  const described = await registry.describe();
  assert.equal(described.recordCount, 2);
  assert.ok(described.auditEvents.length >= 2);
}

function verifyOperationsAndTools() {
  const operations = new Map(SERVER_API_OPERATIONS.map((operation) => [operation.id, operation]));
  for (const id of [
    "asset_lineage.describe",
    "asset_lineage.record",
    "asset_lineage.trace",
    "asset_lineage.reparse_plan"
  ]) {
    assert.ok(operations.has(id), `${id} must be registered`);
  }
  assert.equal(operations.get("asset_lineage.record").http.path, "/api/asset-lineage/records");
  assert.equal(operations.get("asset_lineage.trace").target.method, "handleAssetLineageTrace");

  const catalog = createToolCatalog({ operations: SERVER_API_OPERATIONS });
  const recordTool = catalog.tools.find((tool) => tool.id === "pact.assetLineage.record");
  assert.ok(recordTool, "asset lineage record tool must be exposed");
  assert.ok(recordTool.toolsets.includes("pact.agentLibrary.maintain"));
  assert.equal(recordTool.toolsets.includes("pact.document.parse"), false);
}

async function main() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pact-asset-lineage-"));
  try {
    await verifyRuntime(tempRoot);
    verifyOperationsAndTools();
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
  console.log("[asset-lineage] ok");
}

await main();
