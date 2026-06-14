import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  ASSET_LINEAGE_PROTOCOL_VERSION,
  createAssetLineageRegistry,
  normalizeAssetLineageRecord,
} from "../../../server/platform/specialized/knowledge/assets/asset-lineage/index.mjs";

async function withTempRoot(testCase) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pact-asset-lineage-test-"));
  try {
    return await testCase(root);
  } finally {
    await fs.rm(root, { force: true, recursive: true });
  }
}

async function writeRegistry(root, value) {
  const filePath = path.join(root, "asset-lineage", "registry.json");
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return filePath;
}

describe("asset lineage coverage", () => {
  it("normalizes direct, nested, and generated records across object and array inputs", () => {
    const direct = normalizeAssetLineageRecord({
      record: {
        assetId: " asset-direct ",
        type: "figure",
        mediaType: " image/png ",
        rawObject: {
          objectId: " raw-direct ",
          path: " /objects/raw-direct.png ",
          sha256: " sha256:direct ",
          mimeType: " image/png ",
          size: "256",
        },
        sourceAnchor: {
          documentId: " doc-1 ",
          pageNumber: "2",
          slideIndex: "3",
          sheetName: " Sheet A ",
          tableIndex: "4",
          figureIndex: "5",
          bbox: { x: "10", y: "20", width: "300", height: "180" },
          coordinateSystem: " page-canvas ",
          sourceRange: { start: 1, end: 3 },
        },
        parser: {
          parserId: " parser-a ",
          name: " parser-a-name ",
          parserVersion: " 1.2.3 ",
          provider: " local ",
          promptVersion: " p-1 ",
          parametersHash: " params-1 ",
        },
        visualModel: {
          modelId: " vision-a ",
          model: " vision-name ",
          modelVersion: " 2026-01-01 ",
          provider: " openai ",
          promptVersion: " v-1 ",
          parametersHash: " params-2 ",
        },
        ocr: {
          engine: " ocr-a ",
          version: " 4.5.6 ",
        },
        derivedFromAssetIds: [" parent-a ", "parent-a", " parent-b "],
        auditRefs: [" audit-a ", "audit-a"],
        producedBy: {
          operationId: " op-1 ",
          jobId: " job-1 ",
          batchId: " batch-1 ",
          mountName: " mount-1 ",
          parserRoute: " route-1 ",
        },
        reparsePolicy: {
          strategy: "manual",
          whenParserChanges: false,
          whenModelChanges: true,
          whenSourceHashChanges: false,
        },
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-02T00:00:00.000Z",
        metadata: { nested: true },
      },
    });

    expect(direct).toMatchObject({
      schemaVersion: "v0.0.1:schema:definition-1",
      protocolVersion: ASSET_LINEAGE_PROTOCOL_VERSION,
      assetId: "asset-direct",
      assetType: "figure",
      mediaType: "image/png",
      rawObject: {
        objectId: "raw-direct",
        uri: "/objects/raw-direct.png",
        contentHash: "sha256:direct",
        mediaType: "image/png",
        byteSize: 256,
      },
      sourceAnchor: {
        documentId: "doc-1",
        page: 2,
        slideIndex: 3,
        sheetName: "Sheet A",
        tableIndex: 4,
        figureIndex: 5,
        bbox: [10, 20, 300, 180],
        coordinateSystem: "page-canvas",
        sourceRange: { start: 1, end: 3 },
      },
      parser: {
        id: "parser-a",
        provider: "local",
        name: "parser-a-name",
        version: "1.2.3",
        promptVersion: "p-1",
        parametersHash: "params-1",
      },
      visualModel: {
        id: "vision-a",
        provider: "openai",
        name: "vision-name",
        version: "2026-01-01",
        promptVersion: "v-1",
        parametersHash: "params-2",
      },
      ocr: {
        id: "ocr-a",
        version: "4.5.6",
      },
      derivedFromAssetIds: ["parent-a", "parent-b"],
      auditRefs: ["audit-a"],
      producedBy: {
        operationId: "op-1",
        jobId: "job-1",
        batchId: "batch-1",
        mountName: "mount-1",
        parserRoute: "route-1",
      },
      reparsePolicy: {
        strategy: "manual",
        whenParserChanges: false,
        whenModelChanges: true,
        whenSourceHashChanges: false,
      },
      createdAt: "2026-06-01T00:00:00.000Z",
      updatedAt: "2026-06-02T00:00:00.000Z",
      metadata: { nested: true },
    });
    expect(direct.lineageId).toMatch(/^lineage_[a-f0-9]{20}$/);

    const generated = normalizeAssetLineageRecord({
      asset: {
        type: "",
        rawObjectRef: {
          rawObjectId: "raw-generated",
          filePath: " /tmp/raw-generated.csv ",
          hash: " sha256:generated ",
          mimeType: " text/csv ",
          size: "-20",
        },
        anchor: {
          sourceDocumentId: " doc-2 ",
          pageIndex: "0",
          bbox: [1, "2", "3", "4"],
        },
        parserId: " parser-b ",
        parserVersion: " 2.0.0 ",
        visualModelId: " vision-b ",
        visualModelVersion: " 3.0.0 ",
        ocrEngine: " ocr-b ",
        ocrVersion: " 1.0 ",
        derivedFrom: " single-parent ",
        auditIds: " audit-single ",
      },
    });

    expect(generated).toMatchObject({
      protocolVersion: ASSET_LINEAGE_PROTOCOL_VERSION,
      assetType: "visual",
      mediaType: "text/csv",
      rawObject: {
        objectId: "raw-generated",
        uri: "/tmp/raw-generated.csv",
        contentHash: "sha256:generated",
        mediaType: "text/csv",
        byteSize: 0,
      },
      sourceAnchor: {
        documentId: "doc-2",
        page: 0,
        bbox: [1, 2, 3, 4],
        coordinateSystem: "page-pixels",
        sourceRange: {},
      },
      parser: {
        id: "parser-b",
        version: "2.0.0",
      },
      visualModel: {
        id: "vision-b",
        version: "3.0.0",
      },
      ocr: {
        id: "ocr-b",
        version: "1.0",
      },
      derivedFromAssetIds: ["single-parent"],
      auditRefs: ["audit-single"],
      reparsePolicy: {
        strategy: "on-runtime-change",
        whenParserChanges: true,
        whenModelChanges: true,
        whenSourceHashChanges: true,
      },
    });
    expect(generated.assetId).toMatch(/^asset_[a-f0-9]{20}$/);
    expect(generated.lineageId).toMatch(/^lineage_[a-f0-9]{20}$/);
  });

  it("coerces malformed stored registry shapes and surfaces invalid JSON", async () => {
    await withTempRoot(async (root) => {
      await writeRegistry(root, {
        schemaVersion: "v0.0.1:schema:definition-1",
        protocolVersion: ASSET_LINEAGE_PROTOCOL_VERSION,
        updatedAt: "2026-06-01T00:00:00.000Z",
        records: [],
        auditEvents: "seed-audit",
      });

      const registry = createAssetLineageRegistry({ userDataPath: root });
      const described = await registry.describe();

      expect(described).toMatchObject({
        schemaVersion: "v0.0.1:schema:definition-1",
        protocolVersion: ASSET_LINEAGE_PROTOCOL_VERSION,
        recordCount: 0,
        records: [],
        auditEvents: ["seed-audit"],
      });
    });

    await withTempRoot(async (root) => {
      const filePath = path.join(root, "asset-lineage", "registry.json");
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, "{", "utf8");

      const registry = createAssetLineageRegistry({ userDataPath: root });
      await expect(registry.describe()).rejects.toThrow();
    });
  });

  it("records, merges, traces, and plans reparses from stored lineage entries", async () => {
    await withTempRoot(async (root) => {
      await writeRegistry(root, {
        schemaVersion: "v0.0.1:schema:definition-1",
        protocolVersion: ASSET_LINEAGE_PROTOCOL_VERSION,
        updatedAt: "2026-06-01T00:00:00.000Z",
        records: {
          "lineage-child": {
            lineageId: "lineage-child",
            assetId: "asset-child",
            legacyTag: "keep-me",
          },
        },
        auditEvents: [],
      });

      const registry = createAssetLineageRegistry({ userDataPath: root });

      const parent = await registry.record({
        assetId: "asset-parent",
        lineageId: "lineage-parent",
        assetType: "image",
        rawObject: {
          objectId: "raw-parent",
          uri: "/assets/parent.png",
          contentHash: "sha256:parent",
          mediaType: "image/png",
          byteSize: 100,
        },
        sourceAnchor: {
          documentId: "doc-parent",
          page: 1,
          bbox: [0, 0, 10, 10],
        },
        parser: {
          parserId: "parser-parent",
          parserVersion: "1.0.0",
        },
        visualModel: {
          modelId: "vision-parent",
          modelVersion: "1.0.0",
        },
        ocr: {
          engine: "ocr-parent",
          version: "1.0.0",
        },
      });

      expect(parent.record).toMatchObject({
        lineageId: "lineage-parent",
        assetId: "asset-parent",
        rawObject: {
          objectId: "raw-parent",
        },
      });
      expect(parent.audit).toMatchObject({
        eventType: "asset_lineage.recorded",
        assetId: "asset-parent",
        payload: {
          lineageId: "lineage-parent",
          assetId: "asset-parent",
          rawObjectId: "raw-parent",
          page: 1,
          bbox: [0, 0, 10, 10],
        },
      });
      expect(parent.audit.auditId).toMatch(/^asset_lineage_audit_/);

      const child = await registry.record({
        record: {
          assetId: "asset-child",
          lineageId: "lineage-child",
          assetType: "table",
          rawObject: {
            objectId: "raw-child",
            uri: "/assets/child.csv",
            contentHash: "sha256:child",
            mediaType: "text/csv",
            byteSize: 200,
          },
          sourceAnchor: {
            documentId: "doc-child",
            page: 2,
            bbox: { x: 11, y: 12, width: 13, height: 14 },
          },
          parser: {
            parserId: "parser-child",
            parserVersion: "2.0.0",
          },
          visualModel: {
            modelId: "vision-child",
            modelVersion: "2.0.0",
            promptVersion: "prompt-v1",
          },
          derivedFromAssetIds: ["asset-parent"],
          producedBy: {
            operationId: "op-child",
            jobId: "job-child",
            batchId: "batch-child",
          },
          reparsePolicy: {
            whenParserChanges: false,
            whenModelChanges: true,
            whenSourceHashChanges: false,
          },
        },
      });

      expect(child.record).toMatchObject({
        lineageId: "lineage-child",
        assetId: "asset-child",
        legacyTag: "keep-me",
        derivedFromAssetIds: ["asset-parent"],
        reparsePolicy: {
          strategy: "on-runtime-change",
          whenParserChanges: false,
          whenModelChanges: true,
          whenSourceHashChanges: false,
        },
      });
      expect(child.record.updatedAt).toEqual(expect.any(String));

      const described = await registry.describe();
      expect(described.recordCount).toBe(2);
      expect(described.records.map((item) => item.lineageId).sort()).toEqual([
        "lineage-child",
        "lineage-parent",
      ]);

      const traced = await registry.trace({ id: "asset-child" });
      expect(traced).toMatchObject({
        protocolVersion: ASSET_LINEAGE_PROTOCOL_VERSION,
        assetId: "asset-child",
        found: true,
        chain: [
          expect.objectContaining({ assetId: "asset-child", lineageId: "lineage-child" }),
          expect.objectContaining({ assetId: "asset-parent", lineageId: "lineage-parent" }),
        ],
        rootRawObjects: ["raw-child", "raw-parent"],
      });

      const missingTrace = await registry.trace({ assetId: "missing-asset" });
      expect(missingTrace).toEqual({
        protocolVersion: ASSET_LINEAGE_PROTOCOL_VERSION,
        assetId: "missing-asset",
        found: false,
        chain: [],
        rootRawObjects: [],
      });

      const noChanges = await registry.planReparse({});
      expect(noChanges).toMatchObject({
        protocolVersion: ASSET_LINEAGE_PROTOCOL_VERSION,
        candidateCount: 0,
        candidates: [],
      });

      const planned = await registry.planReparse({
        parser: {
          id: "parser-child",
          version: "2.1.0",
        },
        visualModel: {
          id: "vision-child",
          version: "2.1.0",
          promptVersion: "prompt-v2",
        },
        rawObject: {
          contentHash: "sha256:changed",
        },
      });

      expect(planned.protocolVersion).toBe(ASSET_LINEAGE_PROTOCOL_VERSION);
      expect(planned.candidateCount).toBe(2);
      expect(planned.candidates).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            lineageId: "lineage-parent",
            assetId: "asset-parent",
            reasons: expect.arrayContaining([
              "parser_version_changed",
              "visual_model_version_changed",
              "prompt_version_changed",
              "raw_object_hash_changed",
            ]),
          }),
          expect.objectContaining({
            lineageId: "lineage-child",
            assetId: "asset-child",
            reasons: expect.arrayContaining([
              "visual_model_version_changed",
              "prompt_version_changed",
            ]),
          }),
        ])
      );
      expect(planned.candidates.find((item) => item.lineageId === "lineage-child").reasons).not.toContain(
        "parser_version_changed"
      );
      expect(planned.candidates.find((item) => item.lineageId === "lineage-child").reasons).not.toContain(
        "raw_object_hash_changed"
      );
    });
  });
});
