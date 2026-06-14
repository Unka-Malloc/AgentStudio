import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { ServerConfig } from "../../../../common/config/ServerConfig.mjs";

export const ASSET_LINEAGE_PROTOCOL_VERSION = "v0.0.1:asset:asset-lineage-1";

const REGISTRY_FILE = path.join("asset-lineage", "registry.json");

function nowIso() {
  return new Date().toISOString();
}

function asObject(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === "") return [];
  return [value];
}

function text(value) {
  return String(value ?? "").trim();
}

function uniqueStrings(value = []) {
  return [...new Set(asArray(value).map(text).filter(Boolean))];
}

function stableJson(value) {
  if (value === undefined || value === null) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

function hash(value, length = 20) {
  return crypto.createHash("sha256").update(stableJson(value)).digest("hex").slice(0, length);
}

function registryPath(userDataPath = "") {
  return path.join(userDataPath || ServerConfig.getDataDir(), REGISTRY_FILE);
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function emptyRegistry() {
  return {
    schemaVersion: "v0.0.1:schema:definition-1",
    protocolVersion: ASSET_LINEAGE_PROTOCOL_VERSION,
    updatedAt: nowIso(),
    records: {},
    auditEvents: []
  };
}

function normalizeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeBbox(value = []) {
  const source = asArray(value);
  if (source.length >= 4) {
    return source.slice(0, 4).map((item) => normalizeNumber(item, 0));
  }
  const object = asObject(value);
  return [
    normalizeNumber(object.x, 0),
    normalizeNumber(object.y, 0),
    normalizeNumber(object.width ?? object.w, 0),
    normalizeNumber(object.height ?? object.h, 0)
  ];
}

function normalizeVersionedRuntime(value = {}, defaults = {}) {
  const source = asObject(value);
  return {
    id: text(source.id || source.parserId || source.modelId || source.engine || defaults.id || ""),
    provider: text(source.provider || defaults.provider || ""),
    name: text(source.name || source.model || source.parser || defaults.name || ""),
    version: text(source.version || source.parserVersion || source.modelVersion || defaults.version || ""),
    promptVersion: text(source.promptVersion || defaults.promptVersion || ""),
    parametersHash: text(source.parametersHash || defaults.parametersHash || "")
  };
}

function normalizeRawObject(value = {}) {
  const source = asObject(value);
  return {
    objectId: text(source.objectId || source.rawObjectId || source.id || ""),
    uri: text(source.uri || source.path || source.filePath || ""),
    contentHash: text(source.contentHash || source.sha256 || source.hash || ""),
    mediaType: text(source.mediaType || source.mimeType || ""),
    byteSize: Math.max(0, normalizeNumber(source.byteSize || source.size, 0))
  };
}

function normalizeSourceAnchor(value = {}) {
  const source = asObject(value);
  const page = normalizeNumber(source.page ?? source.pageNumber ?? source.pageIndex, 0);
  return {
    documentId: text(source.documentId || source.sourceDocumentId || ""),
    page,
    slideIndex: normalizeNumber(source.slideIndex, 0),
    sheetName: text(source.sheetName || ""),
    tableIndex: normalizeNumber(source.tableIndex, 0),
    figureIndex: normalizeNumber(source.figureIndex, 0),
    bbox: normalizeBbox(source.bbox || source.boundingBox),
    coordinateSystem: text(source.coordinateSystem || "page-pixels"),
    sourceRange: asObject(source.sourceRange)
  };
}

export function normalizeAssetLineageRecord(input = {}) {
  const source = asObject(input.record || input.asset || input);
  const rawObject = normalizeRawObject(source.rawObject || source.rawObjectRef || source.source);
  const sourceAnchor = normalizeSourceAnchor(source.sourceAnchor || source.anchor || source);
  const assetId = text(source.assetId || source.id || `asset_${hash({ rawObject, sourceAnchor })}`);
  const parser = normalizeVersionedRuntime(source.parser || {
    parserId: source.parserId,
    parserVersion: source.parserVersion
  });
  const visualModel = normalizeVersionedRuntime(source.visualModel || {
    provider: source.visualProvider,
    modelId: source.visualModelId,
    modelVersion: source.visualModelVersion,
    promptVersion: source.promptVersion
  });
  const ocr = normalizeVersionedRuntime(source.ocr || {
    engine: source.ocrEngine,
    version: source.ocrVersion
  });
  const record = {
    schemaVersion: "v0.0.1:schema:definition-1",
    protocolVersion: ASSET_LINEAGE_PROTOCOL_VERSION,
    lineageId: text(source.lineageId || `lineage_${hash({ assetId, rawObject, sourceAnchor, parser, visualModel })}`),
    assetId,
    assetType: text(source.assetType || source.type || "visual"),
    mediaType: text(source.mediaType || rawObject.mediaType || ""),
    rawObject,
    sourceAnchor,
    parser,
    visualModel,
    ocr,
    derivedFromAssetIds: uniqueStrings(source.derivedFromAssetIds || source.derivedFrom || source.parentAssetIds),
    producedBy: {
      operationId: text(source.producedBy?.operationId || source.operationId || ""),
      jobId: text(source.producedBy?.jobId || source.jobId || ""),
      batchId: text(source.producedBy?.batchId || source.batchId || ""),
      mountName: text(source.producedBy?.mountName || source.mountName || ""),
      parserRoute: text(source.producedBy?.parserRoute || source.parserRoute || "")
    },
    reparsePolicy: {
      strategy: text(source.reparsePolicy?.strategy || source.reparseStrategy || "on-runtime-change"),
      whenParserChanges: source.reparsePolicy?.whenParserChanges !== false,
      whenModelChanges: source.reparsePolicy?.whenModelChanges !== false,
      whenSourceHashChanges: source.reparsePolicy?.whenSourceHashChanges !== false
    },
    auditRefs: uniqueStrings(source.auditRefs || source.auditIds),
    createdAt: text(source.createdAt || nowIso()),
    updatedAt: text(source.updatedAt || nowIso()),
    metadata: asObject(source.metadata)
  };
  return record;
}

function lineageDiff(record = {}, runtime = {}) {
  const reasons = [];
  const parser = asObject(runtime.parser);
  const visualModel = asObject(runtime.visualModel);
  const rawObject = asObject(runtime.rawObject);
  if (record.reparsePolicy.whenParserChanges) {
    if (parser.id && parser.id !== record.parser.id) reasons.push("parser_id_changed");
    if (parser.version && parser.version !== record.parser.version) reasons.push("parser_version_changed");
  }
  if (record.reparsePolicy.whenModelChanges) {
    if (visualModel.id && visualModel.id !== record.visualModel.id) reasons.push("visual_model_id_changed");
    if (visualModel.version && visualModel.version !== record.visualModel.version) reasons.push("visual_model_version_changed");
    if (visualModel.promptVersion && visualModel.promptVersion !== record.visualModel.promptVersion) reasons.push("prompt_version_changed");
  }
  if (record.reparsePolicy.whenSourceHashChanges && rawObject.contentHash && rawObject.contentHash !== record.rawObject.contentHash) {
    reasons.push("raw_object_hash_changed");
  }
  return reasons;
}

function traceRecord(records = {}, assetId = "", seen = new Set()) {
  const record = Object.values(records).find((item) => item.assetId === assetId || item.lineageId === assetId);
  if (!record || seen.has(record.lineageId)) {
    return [];
  }
  seen.add(record.lineageId);
  return [
    record,
    ...record.derivedFromAssetIds.flatMap((parentAssetId) => traceRecord(records, parentAssetId, seen))
  ];
}

export function createAssetLineageRegistry({ userDataPath = "" } = {}) {
  const filePath = registryPath(userDataPath);

  async function readRegistry() {
    const loaded = await readJson(filePath, emptyRegistry());
    return {
      ...emptyRegistry(),
      ...loaded,
      records: asObject(loaded.records),
      auditEvents: asArray(loaded.auditEvents)
    };
  }

  async function writeRegistry(registry) {
    const next = {
      ...registry,
      protocolVersion: ASSET_LINEAGE_PROTOCOL_VERSION,
      updatedAt: nowIso()
    };
    await writeJson(filePath, next);
    return next;
  }

  function audit(registry, eventType, payload = {}) {
    const event = {
      auditId: `asset_lineage_audit_${hash({ eventType, payload, nonce: crypto.randomUUID() })}`,
      eventType,
      assetId: text(payload.assetId || ""),
      payload,
      createdAt: nowIso()
    };
    registry.auditEvents.push(event);
    return event;
  }

  return {
    protocolVersion: ASSET_LINEAGE_PROTOCOL_VERSION,
    async describe() {
      const registry = await readRegistry();
      return {
        schemaVersion: registry.schemaVersion,
        protocolVersion: registry.protocolVersion,
        updatedAt: registry.updatedAt,
        recordCount: Object.keys(registry.records).length,
        records: Object.values(registry.records),
        auditEvents: registry.auditEvents
      };
    },
    async record(input = {}) {
      const registry = await readRegistry();
      const record = normalizeAssetLineageRecord(input.record || input);
      registry.records[record.lineageId] = {
        ...(registry.records[record.lineageId] || {}),
        ...record,
        updatedAt: nowIso()
      };
      const event = audit(registry, "asset_lineage.recorded", {
        lineageId: record.lineageId,
        assetId: record.assetId,
        rawObjectId: record.rawObject.objectId,
        page: record.sourceAnchor.page,
        bbox: record.sourceAnchor.bbox
      });
      await writeRegistry(registry);
      return {
        protocolVersion: ASSET_LINEAGE_PROTOCOL_VERSION,
        record: registry.records[record.lineageId],
        audit: event
      };
    },
    async trace(input = {}) {
      const registry = await readRegistry();
      const assetId = text(input.assetId || input.lineageId || input.id || "");
      const chain = traceRecord(registry.records, assetId);
      return {
        protocolVersion: ASSET_LINEAGE_PROTOCOL_VERSION,
        assetId,
        found: chain.length > 0,
        chain,
        rootRawObjects: [...new Set(chain.map((item) => item.rawObject.objectId || item.rawObject.uri).filter(Boolean))]
      };
    },
    async planReparse(input = {}) {
      const registry = await readRegistry();
      const runtime = {
        parser: normalizeVersionedRuntime(input.parser),
        visualModel: normalizeVersionedRuntime(input.visualModel),
        rawObject: normalizeRawObject(input.rawObject)
      };
      const candidates = Object.values(registry.records)
        .map((record) => ({
          lineageId: record.lineageId,
          assetId: record.assetId,
          reasons: lineageDiff(record, runtime),
          reparsePolicy: record.reparsePolicy
        }))
        .filter((item) => item.reasons.length > 0);
      return {
        protocolVersion: ASSET_LINEAGE_PROTOCOL_VERSION,
        runtime,
        candidateCount: candidates.length,
        candidates
      };
    }
  };
}
