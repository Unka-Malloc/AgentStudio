import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { getRawMailObjectRoot } from "./raw-object-store.mjs";
import { asBoolInt, asJson, scopedId } from "./metadata-helpers.mjs";

const SOURCE_VOCABULARY_MAX_TERMS_PER_BATCH = 25000;
const SOURCE_VOCABULARY_MAX_TERM_LENGTH = 128;
const SOURCE_VOCABULARY_PROFILE_VERSION = "v0.0.1:knowledge:source-vocabulary-profile-1";
const SIGNIFICANT_TERMS_PROFILE_VERSION = "v0.0.1:knowledge:significant-terms-profile-1";
const DOCUMENT_PROFILE_VERSION = "v0.0.1:knowledge:document-profile-1";
const SOURCE_VOCABULARY_BM25_K1 = 1.2;
const WORD_CLOUD_SCHEMA_VERSION = "v0.0.1:storage:word-cloud-schema-1";
const WORD_CLOUD_JSONL_SCHEMA_VERSION = "v0.0.1:storage:word-cloud-jsonl-schema-1";
const WORD_CLOUD_EXPORT_TYPE = "pact.knowledge.word_bags.export";
const WORD_CLOUD_SOURCE_QUERY_MAX_TERMS = 100000;
const WORD_CLOUD_STORAGE_MAX_TERMS = Number.MAX_SAFE_INTEGER;
const WORD_CLOUD_DEFAULT_WORD_BAG_ID = "default";
const WORD_CLOUD_OTHER_WORD_BAG_ID = "other";
const WORD_CLOUD_LOW_WEIGHT_THRESHOLD = 0.15;
const wordCloudJsonlWriteQueues = new Map();

function createDefaultTextIndexingService() {
  return {
    compileRuleSet: (rules = {}) => ({
      stopwords: new Set(
        Array.isArray(rules.keywordStopwords)
          ? rules.keywordStopwords.map((item) => String(item || "").trim().toLowerCase()).filter(Boolean)
          : []
      )
    }),
    tokenizeText(text, ruleSet = {}) {
      const counts = new Map();
      const normalized = String(text || "").toLowerCase();
      const stopwords = ruleSet.stopwords instanceof Set ? ruleSet.stopwords : new Set();

      for (const word of normalized.match(/[a-z0-9][a-z0-9._-]{1,}/g) || []) {
        if (!stopwords.has(word)) {
          counts.set(word, (counts.get(word) || 0) + 1);
        }
      }
      for (const run of normalized.match(/[\u4e00-\u9fff]{2,}/g) || []) {
        for (let index = 0; index < run.length - 1; index += 1) {
          const bigram = run.slice(index, index + 2);
          if (!stopwords.has(bigram)) {
            counts.set(bigram, (counts.get(bigram) || 0) + 1);
          }
        }
      }

      return counts;
    },
    buildSearchTerms(text, ruleSet) {
      return [...this.tokenizeText(text, ruleSet).keys()];
    }
  };
}

function asObjectJson(value) {
  return JSON.stringify(value && typeof value === "object" && !Array.isArray(value) ? value : {});
}

function parseJsonValue(value, fallback = {}) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function termCountsToJson(counts) {
  const payload = {};
  for (const [term, count] of counts.entries()) {
    if (!term || !Number.isFinite(count) || count <= 0) {
      continue;
    }

    payload[term] = Math.floor(count);
  }

  return JSON.stringify(payload);
}

function termCountsFromEntries(entries) {
  const counts = new Map();

  for (const entry of entries || []) {
    for (const [term, count] of entry.termCounts.entries()) {
      counts.set(term, (counts.get(term) || 0) + count);
    }
  }

  return counts;
}

function sha256Text(value) {
  return createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function saturatedBm25TermFrequency(termFrequency) {
  const frequency = Math.max(0, Number(termFrequency || 0));
  if (frequency <= 0) {
    return 0;
  }

  return (frequency * (SOURCE_VOCABULARY_BM25_K1 + 1)) / (frequency + SOURCE_VOCABULARY_BM25_K1);
}

function sourceDocumentProfileId(batchId, sourceId) {
  return scopedId(batchId, "source-document", sourceId);
}

function sourceDocumentFileHash(source = {}) {
  return String(
    source.rawObject?.sha256 ||
      source.rawObject?.contentHash ||
      source.contentHash ||
      source.originalSha256 ||
      ""
  )
    .trim()
    .toLowerCase();
}

function sourceDocumentMetadata(source = {}) {
  return asObjectJson({
    sourceMetadata: source.sourceMetadata || source.rawObject?.sourceMetadata || {},
    ingestOrigin: source.rawObject?.ingestOrigin || "",
    archiveFileName: source.rawObject?.archiveFileName || "",
    storageRelativePath: source.rawObject?.storageRelativePath || "",
    originalRelativePath: source.rawObject?.originalRelativePath || source.path || ""
  });
}

function sourceDocumentFtsQuery(query) {
  const terms = [
    ...new Set(String(query || "").toLowerCase().match(/[\p{L}\p{N}_-]+/gu) || [])
  ]
    .filter((term) => term.length > 1 && term.length <= 64)
    .slice(0, 16);
  return terms.map((term) => `"${term.replace(/"/g, '""')}"`).join(" OR ");
}

function normalizeScopeText(value) {
  return String(value || "").trim();
}

function normalizeSignificantTermsScope(input = {}) {
  const scope = input.scope && typeof input.scope === "object" ? input.scope : input;
  return {
    batchId: normalizeScopeText(scope.batchId || scope.batch_id),
    clientUid: normalizeScopeText(scope.clientUid || scope.client_uid),
    sourceType: normalizeScopeText(scope.sourceType || scope.source_type),
    providerId: normalizeScopeText(scope.providerId || scope.provider_id),
    syncBatchId: normalizeScopeText(scope.syncBatchId || scope.sync_batch_id),
    externalId: normalizeScopeText(scope.externalId || scope.external_id)
  };
}

function hasSignificantTermsScope(scope = {}) {
  return Object.values(scope).some((value) => String(value || "").trim());
}

function clampInteger(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.floor(numeric)));
}

function clampFiniteNumber(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, numeric));
}

function parseArrayJson(rawValue) {
  try {
    const parsed = JSON.parse(rawValue || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseObjectJson(rawValue) {
  try {
    const parsed = JSON.parse(rawValue || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function wordCloudJsonlRootPath(userDataPath) {
  return path.join(String(userDataPath || ""), "knowledge-word-clouds");
}

function sanitizeWordCloudFileStem(value) {
  const stem = String(value || "word-cloud")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);
  return stem || "word-cloud";
}

function wordCloudWordBagSetRootPath(userDataPath, wordBagSetId) {
  return path.join(wordCloudJsonlRootPath(userDataPath), sanitizeWordCloudFileStem(wordBagSetId));
}

function wordCloudWordBagManifestJsonlPath(userDataPath, wordBagSetId) {
  return path.join(wordCloudWordBagSetRootPath(userDataPath, wordBagSetId), "manifest.jsonl");
}

function wordCloudWordBagFileName(wordBagId) {
  const normalized = String(wordBagId || "word-bag").trim() || "word-bag";
  const digest = createHash("sha256").update(normalized).digest("hex").slice(0, 12);
  return `${sanitizeWordCloudFileStem(normalized)}-${digest}.jsonl`;
}

function wordCloudWordBagRelativeFilePath(wordBagId) {
  return path.posix.join("word-bags", wordCloudWordBagFileName(wordBagId));
}

function wordCloudWordBagJsonlPath(userDataPath, wordBagSetId, relativeFile) {
  const safeSegments = String(relativeFile || "")
    .split(/[\\/]+/g)
    .filter((segment) => segment && segment !== "." && segment !== "..");
  return path.join(wordCloudWordBagSetRootPath(userDataPath, wordBagSetId), ...safeSegments);
}

function wordCloudJsonlBody(records = []) {
  return records.map((record) => JSON.stringify(record)).join("\n") + "\n";
}

function writeWordCloudJsonlFileSync(filePath, records = []) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
  fs.writeFileSync(tmpPath, wordCloudJsonlBody(records), "utf8");
  fs.renameSync(tmpPath, filePath);
}

async function writeWordCloudJsonlFileAsync(filePath, records = []) {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
  await fs.promises.writeFile(tmpPath, wordCloudJsonlBody(records), "utf8");
  await fs.promises.rename(tmpPath, filePath);
}

function enqueueWordCloudJsonlWrite(queueKey, writeFn) {
  const previous = wordCloudJsonlWriteQueues.get(queueKey) || Promise.resolve();
  const queued = previous.catch(() => {}).then(writeFn);
  const cleanup = queued
    .finally(() => {
      if (wordCloudJsonlWriteQueues.get(queueKey) === cleanup) {
        wordCloudJsonlWriteQueues.delete(queueKey);
      }
    })
    .catch(() => {});
  wordCloudJsonlWriteQueues.set(queueKey, cleanup);
  return queued;
}

function wordCloudQueueToken(value) {
  return createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function wordCloudSetLockQueueKey(wordBagSetId) {
  return `word-cloud:set:${wordCloudQueueToken(wordBagSetId)}:lock`;
}

function wordCloudWordBagQueuePrefix(wordBagSetId) {
  return `word-cloud:set:${wordCloudQueueToken(wordBagSetId)}:word-bag:`;
}

function wordCloudWordBagQueueKey(wordBagSetId, wordBagId) {
  return `${wordCloudWordBagQueuePrefix(wordBagSetId)}${wordCloudQueueToken(wordBagId)}`;
}

async function waitForActiveWordCloudWordBagWrites(wordBagSetId) {
  const prefix = wordCloudWordBagQueuePrefix(wordBagSetId);
  const activeWrites = [...wordCloudJsonlWriteQueues.entries()]
    .filter(([queueKey]) => queueKey.startsWith(prefix))
    .map(([, promise]) => promise);
  if (activeWrites.length > 0) {
    await Promise.allSettled(activeWrites);
  }
}

function enqueueWordCloudSetWriteLock(wordBagSetId, writeFn) {
  return enqueueWordCloudJsonlWrite(wordCloudSetLockQueueKey(wordBagSetId), async () => {
    await waitForActiveWordCloudWordBagWrites(wordBagSetId);
    return writeFn();
  });
}

function enqueueWordCloudWordBagWrite(wordBagSetId, wordBagId, writeFn) {
  const setLockQueue = wordCloudJsonlWriteQueues.get(wordCloudSetLockQueueKey(wordBagSetId)) || Promise.resolve();
  return setLockQueue
    .catch(() => {})
    .then(() => enqueueWordCloudJsonlWrite(wordCloudWordBagQueueKey(wordBagSetId, wordBagId), writeFn));
}

function wordCloudChildWordBagIds(children = []) {
  return (Array.isArray(children) ? children : [])
    .map((child) => String(child?.wordBagId || child?.cloudId || child?.id || "").trim())
    .filter(Boolean);
}

function wordCloudWordBagRecordForJsonl({
  wordBagSetId,
  updatedAt,
  wordBag,
  parentWordBagId = "",
  childWordBagIds = [],
  order = 0,
  depth = 0
} = {}) {
  const flatWordBag = { ...(wordBag && typeof wordBag === "object" ? wordBag : {}) };
  const wordBagId = String(flatWordBag.wordBagId || flatWordBag.cloudId || flatWordBag.id || "").trim();
  if (!wordBagId) {
    return null;
  }
  delete flatWordBag.children;
  delete flatWordBag.cloudId;
  delete flatWordBag.id;
  delete flatWordBag.parentCloudId;
  delete flatWordBag.childCloudIds;
  delete flatWordBag.childWordBagIds;
  return {
    ...flatWordBag,
    recordType: "wordBag",
    schemaVersion: WORD_CLOUD_JSONL_SCHEMA_VERSION,
    wordBagSetId,
    wordBagSetUpdatedAt: updatedAt,
    wordBagId,
    parentWordBagId: String(flatWordBag.parentWordBagId || parentWordBagId || "").trim(),
    childWordBagIds: (Array.isArray(childWordBagIds) ? childWordBagIds : [])
      .map((item) => String(item || "").trim())
      .filter(Boolean),
    order,
    depth
  };
}

function flattenWordCloudWordBagsForJsonl({
  wordBagSetId,
  updatedAt,
  wordBags = [],
  parentWordBagId = "",
  depth = 0,
  target = []
} = {}) {
  for (const wordBag of Array.isArray(wordBags) ? wordBags : []) {
    if (!wordBag || typeof wordBag !== "object") {
      continue;
    }
    const flatWordBag = { ...wordBag };
    const children = Array.isArray(flatWordBag.children) ? flatWordBag.children : [];
    const wordBagId = String(flatWordBag.wordBagId || flatWordBag.cloudId || flatWordBag.id || "").trim();
    if (!wordBagId) {
      continue;
    }
    const childWordBagIds = wordCloudChildWordBagIds(children);
    const relativeFile = wordCloudWordBagRelativeFilePath(wordBagId);
    const record = wordCloudWordBagRecordForJsonl({
      wordBagSetId,
      updatedAt,
      wordBag: flatWordBag,
      parentWordBagId,
      childWordBagIds,
      order: target.length,
      depth
    });
    if (!record) {
      continue;
    }
    target.push({
      record,
      index: {
        recordType: "wordBagIndex",
        schemaVersion: WORD_CLOUD_JSONL_SCHEMA_VERSION,
        wordBagSetId,
        wordBagId,
        parentWordBagId: record.parentWordBagId,
        childWordBagIds,
        file: relativeFile,
        order: record.order,
        depth,
        updatedAt
      }
    });
    flattenWordCloudWordBagsForJsonl({
      wordBagSetId,
      updatedAt,
      wordBags: children,
      parentWordBagId: wordBagId,
      depth: depth + 1,
      target
    });
  }
  return target;
}

function wordCloudWordBagManifestRecords({ wordBagSetId, updatedAt, title, wordBagRecords = [] } = {}) {
  return [
    {
      recordType: "wordBagSet",
      schemaVersion: WORD_CLOUD_JSONL_SCHEMA_VERSION,
      wordBagSetId,
      title: String(title || "").trim(),
      updatedAt,
      wordBagCount: wordBagRecords.length
    },
    ...wordBagRecords.map((item) => item.index)
  ];
}

function wordCloudManifestFileSet(manifest) {
  return new Set((manifest?.entries || []).map((entry) => String(entry.file || "").trim()).filter(Boolean));
}

async function readWordCloudWordBagManifestAsync({ userDataPath, wordBagSetId } = {}) {
  try {
    return parseWordCloudWordBagManifestJsonl(
      await fs.promises.readFile(wordCloudWordBagManifestJsonlPath(userDataPath, wordBagSetId), "utf8")
    );
  } catch {
    return null;
  }
}

async function pruneStaleWordCloudWordBagFiles({
  userDataPath,
  wordBagSetId,
  previousFiles = new Set(),
  nextFiles = new Set()
} = {}) {
  for (const relativeFile of previousFiles) {
    if (!relativeFile || nextFiles.has(relativeFile)) {
      continue;
    }
    try {
      await fs.promises.unlink(wordCloudWordBagJsonlPath(userDataPath, wordBagSetId, relativeFile));
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    }
  }
}

function writeWordCloudWordBagsJsonlSync({ userDataPath, wordBagSetId, updatedAt, title, wordBags = [] } = {}) {
  const manifestPath = wordCloudWordBagManifestJsonlPath(userDataPath, wordBagSetId);
  const wordBagRecords = flattenWordCloudWordBagsForJsonl({ wordBagSetId, updatedAt, wordBags });
  for (const item of wordBagRecords) {
    writeWordCloudJsonlFileSync(
      wordCloudWordBagJsonlPath(userDataPath, wordBagSetId, item.index.file),
      [item.record]
    );
  }
  writeWordCloudJsonlFileSync(manifestPath, wordCloudWordBagManifestRecords({
    wordBagSetId,
    updatedAt,
    title,
    wordBagRecords
  }));
  return manifestPath;
}

async function writeWordCloudWordBagsJsonl({ userDataPath, wordBagSetId, updatedAt, title, wordBags = [] } = {}) {
  const manifestPath = wordCloudWordBagManifestJsonlPath(userDataPath, wordBagSetId);
  const previousManifest = await readWordCloudWordBagManifestAsync({ userDataPath, wordBagSetId });
  const wordBagRecords = flattenWordCloudWordBagsForJsonl({ wordBagSetId, updatedAt, wordBags });
  await Promise.all(wordBagRecords.map((item) => enqueueWordCloudJsonlWrite(
    wordCloudWordBagQueueKey(wordBagSetId, item.index.wordBagId),
    () => writeWordCloudJsonlFileAsync(
      wordCloudWordBagJsonlPath(userDataPath, wordBagSetId, item.index.file),
      [item.record]
    )
  )));
  await enqueueWordCloudJsonlWrite(
    `${wordBagSetId}:manifest`,
    () => writeWordCloudJsonlFileAsync(manifestPath, wordCloudWordBagManifestRecords({
      wordBagSetId,
      updatedAt,
      title,
      wordBagRecords
    }))
  );
  await pruneStaleWordCloudWordBagFiles({
    userDataPath,
    wordBagSetId,
    previousFiles: wordCloudManifestFileSet(previousManifest),
    nextFiles: new Set(wordBagRecords.map((item) => item.index.file))
  });
  return manifestPath;
}

function wordCloudWordBagsJsonlNeedsSchemaRefresh(filePath) {
  if (!fs.existsSync(filePath)) {
    return true;
  }
  try {
    const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/g);
    let headerFound = false;
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      if (trimmed.includes('"recordType":"wordBagSet"')) {
        headerFound = true;
        continue;
      }
      if (trimmed.includes('"recordType":"wordBagIndex"') && !trimmed.includes('"file"')) {
        return true;
      }
    }
    return !headerFound;
  } catch {
    return true;
  }
}

function normalizeWordBagRows(rows = []) {
  const normalizedRows = [];
  const seenWordBagIds = new Set();
  for (const row of rows) {
    const wordBagId = String(row?.wordBag?.wordBagId || "").trim();
    if (!wordBagId || seenWordBagIds.has(wordBagId)) {
      continue;
    }
    seenWordBagIds.add(wordBagId);
    normalizedRows.push({
      order: Number.isFinite(Number(row.order)) ? Number(row.order) : normalizedRows.length,
      wordBag: {
        ...row.wordBag,
        children: []
      }
    });
  }
  return normalizedRows;
}

function buildWordBagTreeFromRows(rows = []) {
  const normalizedRows = normalizeWordBagRows(rows);
  const byId = new Map(normalizedRows.map((row) => [row.wordBag.wordBagId, row.wordBag]));
  const attached = new Set();

  for (const row of normalizedRows) {
    const childIds = Array.isArray(row.wordBag.childWordBagIds) ? row.wordBag.childWordBagIds : [];
    if (childIds.length === 0) {
      continue;
    }
    row.wordBag.children = childIds
      .map((childId) => byId.get(String(childId || "").trim()))
      .filter(Boolean);
    for (const child of row.wordBag.children) {
      attached.add(child.wordBagId);
    }
  }

  const roots = [];
  for (const row of normalizedRows) {
    const parent = row.wordBag.parentWordBagId ? byId.get(row.wordBag.parentWordBagId) : null;
    if (parent && parent !== row.wordBag) {
      if (!attached.has(row.wordBag.wordBagId)) {
        parent.children.push(row.wordBag);
        attached.add(row.wordBag.wordBagId);
      }
    } else {
      roots.push(row.wordBag);
    }
  }
  return roots;
}

function parseWordCloudWordBagManifestJsonl(rawValue) {
  const manifest = { header: null, entries: [] };
  const lines = String(rawValue || "").split(/\r?\n/g);
  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = String(lines[index] || "").trim();
    if (!trimmed) {
      continue;
    }
    let parsed = null;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return null;
    }
    if (!parsed || typeof parsed !== "object") {
      continue;
    }
    if (parsed.recordType === "wordBagSet") {
      manifest.header = parsed;
      continue;
    }
    if (parsed.recordType === "wordBagIndex") {
      const wordBagId = String(parsed.wordBagId || "").trim();
      const file = String(parsed.file || "").trim();
      if (!wordBagId || !file) {
        continue;
      }
      manifest.entries.push({
        wordBagId,
        parentWordBagId: String(parsed.parentWordBagId || "").trim(),
        childWordBagIds: (Array.isArray(parsed.childWordBagIds) ? parsed.childWordBagIds : [])
          .map((item) => String(item || "").trim())
          .filter(Boolean),
        file,
        order: Number.isFinite(Number(parsed.order)) ? Number(parsed.order) : index,
        depth: Number.isFinite(Number(parsed.depth)) ? Number(parsed.depth) : 0
      });
    }
  }
  return manifest.header ? manifest : null;
}

function parseWordCloudWordBagRecordJsonl(rawValue, fallback = {}) {
  const lines = String(rawValue || "").split(/\r?\n/g);
  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = String(lines[index] || "").trim();
    if (!trimmed) {
      continue;
    }
    let parsed = null;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return null;
    }
    if (!parsed || typeof parsed !== "object" || parsed.recordType !== "wordBag") {
      continue;
    }
    const wordBag = parsed.wordBag && typeof parsed.wordBag === "object"
      ? { ...parsed.wordBag }
      : { ...parsed };
    for (const key of ["recordType", "schemaVersion", "wordBagSetId", "wordBagSetUpdatedAt", "order", "depth"]) {
      delete wordBag[key];
    }
    const wordBagId = String(wordBag.wordBagId || wordBag.id || "").trim();
    if (!wordBagId) {
      continue;
    }
    const childWordBagIds = (Array.isArray(wordBag.childWordBagIds) ? wordBag.childWordBagIds : [])
      .map((item) => String(item || "").trim())
      .filter(Boolean)
      .concat((Array.isArray(fallback.childWordBagIds) ? fallback.childWordBagIds : [])
        .map((item) => String(item || "").trim())
        .filter(Boolean))
      .filter((item, itemIndex, allItems) => allItems.indexOf(item) === itemIndex);
    delete wordBag.id;
    wordBag.wordBagId = wordBagId;
    wordBag.parentWordBagId = String(wordBag.parentWordBagId || fallback.parentWordBagId || "").trim();
    wordBag.childWordBagIds = childWordBagIds;
    wordBag.children = [];
    return {
      order: Number.isFinite(Number(parsed.order)) ? Number(parsed.order) : fallback.order || index,
      wordBag
    };
  }
  return null;
}

async function readWordCloudWordBagRecordAsync({ userDataPath, wordBagSetId, entry } = {}) {
  try {
    const rawValue = await fs.promises.readFile(
      wordCloudWordBagJsonlPath(userDataPath, wordBagSetId, entry.file),
      "utf8"
    );
    return parseWordCloudWordBagRecordJsonl(rawValue, entry);
  } catch {
    return null;
  }
}

async function readWordCloudWordBagsJsonlAsync({ userDataPath, wordBagSetId, targetWordBagId = "" } = {}) {
  try {
    const manifest = await readWordCloudWordBagManifestAsync({ userDataPath, wordBagSetId });
    if (!manifest) {
      return null;
    }
    const entries = targetWordBagId
      ? manifest.entries.filter((entry) => entry.wordBagId === targetWordBagId)
      : [...manifest.entries].sort((left, right) => left.order - right.order);
    if (targetWordBagId && entries.length === 0) {
      return [];
    }
    const rows = (await Promise.all(entries.map((entry) => readWordCloudWordBagRecordAsync({
      userDataPath,
      wordBagSetId,
      entry
    })))).filter(Boolean);
    if (targetWordBagId) {
      return normalizeWordBagRows(rows).map((row) => row.wordBag);
    }
    rows.sort((left, right) => left.order - right.order);
    return buildWordBagTreeFromRows(rows);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    return null;
  }
}

async function mutateWordCloudWordBagJsonlAsync({
  userDataPath,
  wordBagSetId,
  wordBagId,
  updatedAt,
  mutate
} = {}) {
  const targetWordBagId = String(wordBagId || "").trim();
  if (!targetWordBagId) {
    throw wordCloudError("缺少 wordBagId。", 400, "word_bag_id_required");
  }
  return enqueueWordCloudWordBagWrite(wordBagSetId, targetWordBagId, async () => {
    const manifest = await readWordCloudWordBagManifestAsync({ userDataPath, wordBagSetId });
    if (!manifest) {
      throw wordCloudError("词袋集合不存在。", 404, "word_bag_set_not_found");
    }
    const entry = manifest.entries.find((item) => item.wordBagId === targetWordBagId);
    if (!entry) {
      throw wordCloudError("词袋不存在。", 404, "word_bag_not_found");
    }
    const row = await readWordCloudWordBagRecordAsync({ userDataPath, wordBagSetId, entry });
    if (!row?.wordBag) {
      throw wordCloudError("词袋文件不存在或无法解析。", 404, "word_bag_file_not_found");
    }
    const nextWordBag = await mutate({ ...row.wordBag }, entry);
    if (!nextWordBag || typeof nextWordBag !== "object") {
      throw wordCloudError("词袋更新结果无效。", 400, "word_bag_invalid");
    }
    const childWordBagIds = Array.isArray(nextWordBag.childWordBagIds)
      ? nextWordBag.childWordBagIds
      : entry.childWordBagIds;
    const record = wordCloudWordBagRecordForJsonl({
      wordBagSetId,
      updatedAt,
      wordBag: {
        ...nextWordBag,
        wordBagId: targetWordBagId,
        parentWordBagId: entry.parentWordBagId
      },
      parentWordBagId: entry.parentWordBagId,
      childWordBagIds,
      order: entry.order,
      depth: entry.depth
    });
    if (!record) {
      throw wordCloudError("词袋更新结果缺少 wordBagId。", 400, "word_bag_id_required");
    }
    await writeWordCloudJsonlFileAsync(
      wordCloudWordBagJsonlPath(userDataPath, wordBagSetId, entry.file),
      [record]
    );
    return {
      ...nextWordBag,
      wordBagId: targetWordBagId,
      parentWordBagId: record.parentWordBagId,
      childWordBagIds: record.childWordBagIds,
      children: Array.isArray(nextWordBag.children) ? nextWordBag.children : []
    };
  });
}

function normalizeWordCloudTerm(input, fallbackFrequency = 0) {
  const term = typeof input === "string"
    ? input
    : input && typeof input === "object"
      ? input.term
      : "";
  const normalizedTerm = String(term || "").trim();
  if (!normalizedTerm) {
    return null;
  }
  const frequency = typeof input === "object" && input
    ? Number(input.frequency ?? input.count ?? fallbackFrequency)
    : Number(fallbackFrequency);
  return {
    term: normalizedTerm,
    frequency: Number.isFinite(frequency) ? Math.max(0, Math.floor(frequency)) : 0,
    weight: typeof input === "object" && input
      ? clampFiniteNumber(input.weight, 0, 0, 1000000)
      : 0,
    quality: typeof input === "object" && input
      ? String(input.quality || "").trim()
      : "",
    removed: Boolean(input && typeof input === "object" && input.removed)
  };
}

function wordCloudFrequencyForTerm(frequencyByTerm = new Map(), rawTerm = "") {
  const normalized = String(rawTerm || "").trim();
  if (!normalized) {
    return undefined;
  }
  if (frequencyByTerm.has(normalized)) {
    return frequencyByTerm.get(normalized);
  }
  return frequencyByTerm.get(normalized.toLowerCase());
}

function normalizeWordCloudTerms(items = [], frequencyByTerm = new Map(), maxTerms = 1000, options = {}) {
  const seen = new Set();
  const terms = [];
  const restrictToKnown = options.restrictToKnown === true && frequencyByTerm.size > 0;
  for (const item of Array.isArray(items) ? items : []) {
    const rawTerm = typeof item === "string" ? item : item?.term || "";
    const fallbackFrequency = wordCloudFrequencyForTerm(frequencyByTerm, rawTerm);
    if (restrictToKnown && fallbackFrequency === undefined) {
      continue;
    }
    const normalized = normalizeWordCloudTerm(item, fallbackFrequency || 0);
    const identity = normalized?.term.toLowerCase() || "";
    if (!normalized || seen.has(identity)) {
      continue;
    }
    seen.add(identity);
    terms.push(normalized);
    if (terms.length >= maxTerms) {
      break;
    }
  }
  return terms;
}

function normalizeWordCloudWordBags(items = [], frequencyByTerm = new Map(), parentWordBagId = "") {
  return (Array.isArray(items) ? items : [])
    .map((item, index) => {
      const record = item && typeof item === "object" ? item : {};
      const layout = record.layout && typeof record.layout === "object" ? record.layout : record;
      const wordBagId = String(
        record.wordBagId || record.cloudId || record.id || `word-bag-${index + 1}`
      ).trim() || `word-bag-${index + 1}`;
      const childItems = Array.isArray(record.children)
        ? record.children
        : Array.isArray(record.subgroups)
          ? record.subgroups
          : Array.isArray(record.groups)
            ? record.groups
            : [];
      return {
        wordBagId,
        label: String(record.label || record.title || `词云 ${index + 1}`).trim() || `词云 ${index + 1}`,
        summary: String(record.summary || record.description || "").trim(),
        relation: String(record.relation || "separate").trim() || "separate",
        parentWordBagId: String(
          record.parentWordBagId || record.parentCloudId || record.parentId || parentWordBagId || ""
        ).trim(),
        x: clampFiniteNumber(layout.x, 8 + (index % 3) * 26, 0, 84),
        y: clampFiniteNumber(layout.y, 8 + Math.floor(index / 3) * 22, 0, 84),
        width: clampFiniteNumber(layout.width, 32, 12, 90),
        height: clampFiniteNumber(layout.height, 26, 12, 90),
        color: String(layout.color || "").trim(),
        zIndex: clampFiniteNumber(layout.zIndex, 10 + index, 1, 60),
        terms: normalizeWordCloudTerms(record.terms || [], frequencyByTerm, WORD_CLOUD_STORAGE_MAX_TERMS),
        removedTerms: normalizeWordCloudTerms(record.removedTerms || [], frequencyByTerm, WORD_CLOUD_STORAGE_MAX_TERMS),
        children: normalizeWordCloudWordBags(childItems, frequencyByTerm, wordBagId)
      };
    })
    .filter((wordBag) => wordBag.terms.length > 0 || wordBag.children.length > 0 || wordBag.label);
}

function collectWordCloudTermIdentities(wordBags = [], target = new Set()) {
  for (const wordBag of Array.isArray(wordBags) ? wordBags : []) {
    for (const term of wordBag.terms || []) {
      const identity = String(term.term || "").trim().toLowerCase();
      if (identity) {
        target.add(identity);
      }
    }
    collectWordCloudTermIdentities(wordBag.children || [], target);
  }
  return target;
}

function wordCloudIsOtherWordBag(wordBag = {}) {
  const wordBagId = String(wordBag?.wordBagId || "").trim().toLowerCase();
  const label = String(wordBag?.label || "").trim().toLowerCase();
  return wordBagId === WORD_CLOUD_OTHER_WORD_BAG_ID || wordBagId === "others" || label === "other" || label === "others" || label === "其它" || label === "其他";
}

function wordCloudIsPresetWordBag(wordBag = {}) {
  return wordCloudIsDefaultWordBag(wordBag) || wordCloudIsOtherWordBag(wordBag);
}

function collectWordCloudAssignedTermIdentities(wordBags = [], target = new Set()) {
  for (const wordBag of Array.isArray(wordBags) ? wordBags : []) {
    if (wordCloudIsPresetWordBag(wordBag)) {
      continue;
    }
    for (const term of wordBag.terms || []) {
      const identity = wordCloudTermIdentity(term);
      if (identity) {
        target.add(identity);
      }
    }
    collectWordCloudAssignedTermIdentities(wordBag.children || [], target);
  }
  return target;
}

function wordCloudTermIsLowWeight(term = {}) {
  if (String(term?.quality || "").trim().toLowerCase() === "low") {
    return true;
  }
  const weight = Number(term?.weight);
  return Number.isFinite(weight) && weight > 0 && weight <= WORD_CLOUD_LOW_WEIGHT_THRESHOLD;
}

function createPresetWordCloudWordBag(kind, terms = [], existing = null) {
  const isDefault = kind === "default";
  return {
    ...(existing || {}),
    wordBagId: isDefault ? WORD_CLOUD_DEFAULT_WORD_BAG_ID : WORD_CLOUD_OTHER_WORD_BAG_ID,
    label: isDefault ? "默认" : "其它",
    summary: isDefault ? "所有尚未进入明确分组的词汇。" : "低权重、低置信或噪声词汇。",
    relation: "separate",
    absorbThreshold: 1,
    terms: normalizeWordCloudTerms(terms, new Map(), WORD_CLOUD_STORAGE_MAX_TERMS),
    removedTerms: normalizeWordCloudTerms(existing?.removedTerms || [], new Map(), WORD_CLOUD_STORAGE_MAX_TERMS),
    children: []
  };
}

function reconcilePresetWordCloudWordBags(wordBags = [], termsSnapshot = []) {
  const regularWordBags = (Array.isArray(wordBags) ? wordBags : []).filter((wordBag) => !wordCloudIsPresetWordBag(wordBag));
  const defaultWordBag = (Array.isArray(wordBags) ? wordBags : []).find(wordCloudIsDefaultWordBag) || null;
  const otherWordBag = (Array.isArray(wordBags) ? wordBags : []).find(wordCloudIsOtherWordBag) || null;
  const assigned = collectWordCloudAssignedTermIdentities(regularWordBags);
  const seen = new Set();
  const defaultTerms = [];
  const otherTerms = [];

  for (const term of normalizeWordCloudTerms(termsSnapshot, new Map(), WORD_CLOUD_STORAGE_MAX_TERMS)) {
    const identity = wordCloudTermIdentity(term);
    if (!identity || seen.has(identity) || assigned.has(identity)) {
      continue;
    }
    seen.add(identity);
    if (wordCloudTermIsLowWeight(term)) {
      otherTerms.push(term);
    } else {
      defaultTerms.push(term);
    }
  }

  return {
    wordBags: [
      ...regularWordBags,
      createPresetWordCloudWordBag("default", defaultTerms, defaultWordBag),
      createPresetWordCloudWordBag("other", otherTerms, otherWordBag)
    ],
    defaultTerms,
    otherTerms
  };
}

function normalizeWordCloudCorpusPaths(input = []) {
  const items = Array.isArray(input)
    ? input
    : String(input || "").split(/[\n,]/g);
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const record = item && typeof item === "object" ? item : { path: item };
    const rawPath = String(record.path || record.value || "").trim();
    if (!rawPath) {
      continue;
    }
    const normalizedPath = path.normalize(rawPath);
    const key = normalizedPath.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const type = String(record.type || "").trim();
    result.push({
      path: normalizedPath,
      type: type === "file" || type === "directory" ? type : ""
    });
  }
  return result;
}

function normalizeWordCloudSetInput(input = {}, fallbackTerms = []) {
  const wordBagSet = input.wordBagSet && typeof input.wordBagSet === "object" ? input.wordBagSet : input;
  const now = new Date().toISOString();
  const fallbackFrequencyByTerm = new Map();
  for (const term of fallbackTerms || []) {
    const key = String(term.term || "").trim();
    if (!key) {
      continue;
    }
    fallbackFrequencyByTerm.set(key, Number(term.frequency || 0));
    fallbackFrequencyByTerm.set(key.toLowerCase(), Number(term.frequency || 0));
  }
  const termsSnapshot = normalizeWordCloudTerms(
    wordBagSet.termsSnapshot || wordBagSet.terms || fallbackTerms,
    fallbackFrequencyByTerm,
    WORD_CLOUD_STORAGE_MAX_TERMS
  );
  const frequencyByTerm = new Map();
  for (const term of termsSnapshot) {
    frequencyByTerm.set(term.term, term.frequency);
    frequencyByTerm.set(term.term.toLowerCase(), term.frequency);
  }
  const wordBags = normalizeWordCloudWordBags(wordBagSet.wordBags || [], frequencyByTerm);
  const reconciled = reconcilePresetWordCloudWordBags(wordBags, termsSnapshot);
  return {
    wordBagSetId: String(wordBagSet.wordBagSetId || wordBagSet.id || `word_bag_${randomUUID()}`).trim(),
    title: String(wordBagSet.title || "语料词云").trim() || "语料词云",
    status: String(wordBagSet.status || "draft").trim() || "draft",
    wordBagCount: clampInteger(wordBagSet.wordBagCount || reconciled.wordBags.length, reconciled.wordBags.length, 0, WORD_CLOUD_STORAGE_MAX_TERMS),
    termsSnapshot,
    wordBags: reconciled.wordBags,
    unassignedTerms: reconciled.defaultTerms,
    corpusPaths: normalizeWordCloudCorpusPaths(
      wordBagSet.corpusPaths || input.corpusPaths || input.corpusPath || []
    ),
    modelAlias: String(wordBagSet.modelAlias || wordBagSet.agentModelAlias || "").trim(),
    agentResponse: wordBagSet.agentResponse && typeof wordBagSet.agentResponse === "object"
      ? wordBagSet.agentResponse
      : {},
    createdAt: String(wordBagSet.createdAt || now),
    updatedAt: now
  };
}

function wordCloudError(message, statusCode = 400, code = "word_cloud_error") {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function parseWordCloudImportEnvelope(input = {}) {
  let envelope = input.importPayload || input.exportPayload || input.wordBagExport || input.wordCloudExport || input;
  if (typeof envelope === "string") {
    try {
      envelope = JSON.parse(envelope);
    } catch {
      throw wordCloudError("导入文件不是有效 JSON。", 400, "word_bag_import_invalid_json");
    }
  }
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    throw wordCloudError("导入内容必须是词袋导出对象。", 400, "word_bag_import_invalid_payload");
  }
  const exportType = String(envelope.exportType || envelope.type || "").trim();
  if (exportType && exportType !== WORD_CLOUD_EXPORT_TYPE) {
    throw wordCloudError("导入文件类型不匹配。", 400, "word_bag_import_type_mismatch");
  }
  const wordBagSet = envelope.wordBagSet && typeof envelope.wordBagSet === "object"
    ? envelope.wordBagSet
    : input.wordBagSet && typeof input.wordBagSet === "object"
      ? input.wordBagSet
      : null;
  if (!wordBagSet) {
    throw wordCloudError("导入内容缺少 wordBagSet。", 400, "word_bag_import_missing_set");
  }
  return { envelope, wordBagSet };
}

function normalizeWordCloudImportMode(input = {}, envelope = {}) {
  const rawMode = String(input.mode || input.strategy || envelope.mode || "").trim().toLowerCase();
  if (input.overwrite === true || rawMode === "overwrite" || rawMode === "replace") {
    return "overwrite";
  }
  return "copy";
}

function wordCloudTermIdentity(value) {
  const term = typeof value === "string" ? value : value?.term;
  return String(term || "").trim().toLowerCase();
}

function wordCloudFrequencyMapFromTerms(terms = []) {
  const frequencyByTerm = new Map();
  for (const term of Array.isArray(terms) ? terms : []) {
    const key = String(term?.term || "").trim();
    if (!key) {
      continue;
    }
    const frequency = Number(term.frequency || term.count || 0);
    frequencyByTerm.set(key, Number.isFinite(frequency) ? Math.max(0, Math.floor(frequency)) : 0);
    frequencyByTerm.set(key.toLowerCase(), Number.isFinite(frequency) ? Math.max(0, Math.floor(frequency)) : 0);
  }
  return frequencyByTerm;
}

function countWordCloudWordBags(wordBags = []) {
  let count = 0;
  for (const wordBag of Array.isArray(wordBags) ? wordBags : []) {
    count += 1 + countWordCloudWordBags(wordBag?.children || []);
  }
  return count;
}

function cloneWordCloudWordBagTree(wordBags = []) {
  return JSON.parse(JSON.stringify(Array.isArray(wordBags) ? wordBags : []));
}

function collectWordCloudWordBagIds(wordBags = [], target = new Set()) {
  for (const wordBag of Array.isArray(wordBags) ? wordBags : []) {
    const wordBagId = String(wordBag?.wordBagId || "").trim();
    if (wordBagId) {
      target.add(wordBagId);
    }
    collectWordCloudWordBagIds(wordBag?.children || [], target);
  }
  return target;
}

function assertUniqueWordCloudWordBagIds(wordBags = []) {
  const seen = new Set();
  const visit = (items = []) => {
    for (const item of Array.isArray(items) ? items : []) {
      const wordBagId = String(item?.wordBagId || "").trim();
      if (!wordBagId) {
        throw wordCloudError("词袋缺少 wordBagId。", 400, "word_bag_id_required");
      }
      if (seen.has(wordBagId)) {
        throw wordCloudError(`词袋 ID 重复：${wordBagId}`, 409, "word_bag_id_duplicate");
      }
      seen.add(wordBagId);
      visit(item?.children || []);
    }
  };
  visit(wordBags);
}

function findWordCloudWordBagInTree(wordBags = [], wordBagId = "", parent = null, pathItems = []) {
  const targetWordBagId = String(wordBagId || "").trim();
  if (!targetWordBagId) {
    return null;
  }
  const siblings = Array.isArray(wordBags) ? wordBags : [];
  for (let index = 0; index < siblings.length; index += 1) {
    const wordBag = siblings[index];
    if (!wordBag || typeof wordBag !== "object") {
      continue;
    }
    const nextPath = [...pathItems, wordBag];
    if (String(wordBag.wordBagId || "").trim() === targetWordBagId) {
      return { wordBag, parent, path: nextPath, index, siblings };
    }
    const child = findWordCloudWordBagInTree(wordBag.children || [], targetWordBagId, wordBag, nextPath);
    if (child) {
      return child;
    }
  }
  return null;
}

function wordCloudIsDefaultWordBag(wordBag = {}) {
  const wordBagId = String(wordBag?.wordBagId || "").trim().toLowerCase();
  const label = String(wordBag?.label || "").trim().toLowerCase();
  return wordBagId === WORD_CLOUD_DEFAULT_WORD_BAG_ID || label === "default" || label === "默认";
}

function findDefaultWordCloudWordBag(wordBags = []) {
  for (const wordBag of Array.isArray(wordBags) ? wordBags : []) {
    if (wordCloudIsDefaultWordBag(wordBag)) {
      return wordBag;
    }
    const child = findDefaultWordCloudWordBag(wordBag?.children || []);
    if (child) {
      return child;
    }
  }
  return null;
}

function collectWordCloudActiveTerms(wordBags = [], target = []) {
  for (const wordBag of Array.isArray(wordBags) ? wordBags : []) {
    for (const term of wordBag?.terms || []) {
      if (term && typeof term === "object" && term.removed) {
        continue;
      }
      if (wordCloudTermIdentity(term)) {
        target.push(term);
      }
    }
    collectWordCloudActiveTerms(wordBag?.children || [], target);
  }
  return target;
}

function cloneWordCloudTermsForService(terms = []) {
  return (Array.isArray(terms) ? terms : [])
    .filter((term) => term && typeof term === "object" && String(term.term || "").trim())
    .map((term) => ({ ...term }));
}

function normalizeRequestedWordBagIds(input = {}) {
  const rawValue = input.wordBagIds ?? input.wordBagId ?? input.ids ?? input.id ?? [];
  const items = Array.isArray(rawValue)
    ? rawValue
    : String(rawValue || "").split(/[,，\s]+/g);
  const seen = new Set();
  const ids = [];
  for (const item of items) {
    const wordBagId = String(item || "").trim();
    if (!wordBagId || seen.has(wordBagId)) {
      continue;
    }
    seen.add(wordBagId);
    ids.push(wordBagId);
  }
  return ids;
}

function flattenWordCloudWordBagsForTerms(wordBag = {}, includeChildren = true, target = []) {
  if (!wordBag || typeof wordBag !== "object") {
    return target;
  }
  target.push(wordBag);
  if (includeChildren) {
    for (const child of Array.isArray(wordBag.children) ? wordBag.children : []) {
      flattenWordCloudWordBagsForTerms(child, true, target);
    }
  }
  return target;
}

function buildWordCloudTermsGroup(wordBag = {}, includeChildren = true) {
  const sourceWordBags = flattenWordCloudWordBagsForTerms(wordBag, includeChildren);
  const wordBags = sourceWordBags.map((source) => ({
    wordBagId: String(source.wordBagId || "").trim(),
    label: String(source.label || "").trim(),
    parentWordBagId: String(source.parentWordBagId || "").trim(),
    childWordBagIds: wordCloudChildWordBagIds(source.children || []),
    terms: cloneWordCloudTermsForService(source.terms || []),
    removedTerms: cloneWordCloudTermsForService(source.removedTerms || [])
  }));
  return {
    wordBagId: String(wordBag.wordBagId || "").trim(),
    label: String(wordBag.label || "").trim(),
    parentWordBagId: String(wordBag.parentWordBagId || "").trim(),
    includeChildren,
    sourceWordBagIds: wordBags.map((item) => item.wordBagId).filter(Boolean),
    childWordBagIds: wordCloudChildWordBagIds(wordBag.children || []),
    wordBags,
    terms: wordBags.flatMap((item) => item.terms),
    removedTerms: wordBags.flatMap((item) => item.removedTerms)
  };
}

function mergeWordCloudTerms(existingTerms = [], termsToAdd = [], frequencyByTerm = new Map()) {
  const merged = normalizeWordCloudTerms(existingTerms, frequencyByTerm, WORD_CLOUD_STORAGE_MAX_TERMS);
  const seen = new Set(merged.map((term) => wordCloudTermIdentity(term)).filter(Boolean));
  for (const term of normalizeWordCloudTerms(termsToAdd, frequencyByTerm, WORD_CLOUD_STORAGE_MAX_TERMS)) {
    const identity = wordCloudTermIdentity(term);
    if (!identity || seen.has(identity)) {
      continue;
    }
    seen.add(identity);
    merged.push({ ...term, removed: false });
    if (merged.length >= WORD_CLOUD_STORAGE_MAX_TERMS) {
      break;
    }
  }
  return merged;
}

function ensureDefaultWordCloudWordBag(wordBags = [], frequencyByTerm = new Map()) {
  const existing = findDefaultWordCloudWordBag(wordBags);
  if (existing) {
    return existing;
  }
  const [created] = normalizeWordCloudWordBags([
    {
      wordBagId: "default",
      label: "默认",
      summary: "所有尚未进入明确分组的词汇。",
      relation: "separate",
      terms: [],
      children: [],
      x: 60,
      y: 62,
      width: 32,
      height: 24,
      zIndex: 10
    }
  ], frequencyByTerm);
  wordBags.push(created);
  return created;
}

function removeWordCloudWordBagFromTree(wordBags = [], wordBagId = "") {
  const targetWordBagId = String(wordBagId || "").trim();
  const siblings = Array.isArray(wordBags) ? wordBags : [];
  for (let index = 0; index < siblings.length; index += 1) {
    const wordBag = siblings[index];
    if (String(wordBag?.wordBagId || "").trim() === targetWordBagId) {
      const [removed] = siblings.splice(index, 1);
      return removed || null;
    }
    const removed = removeWordCloudWordBagFromTree(wordBag?.children || [], targetWordBagId);
    if (removed) {
      return removed;
    }
  }
  return null;
}

function assignMissingWordBagIds(input = {}, usedIds = new Set()) {
  const record = input && typeof input === "object" ? { ...input } : {};
  let wordBagId = String(record.wordBagId || "").trim();
  if (!wordBagId) {
    do {
      wordBagId = `word-bag-${randomUUID()}`;
    } while (usedIds.has(wordBagId));
  }
  record.wordBagId = wordBagId;
  usedIds.add(wordBagId);

  const children = Array.isArray(record.children)
    ? record.children
    : Array.isArray(record.wordBags)
      ? record.wordBags
      : Array.isArray(record.subgroups)
        ? record.subgroups
        : Array.isArray(record.groups)
          ? record.groups
          : [];
  if (children.length > 0) {
    record.children = children.map((child) => assignMissingWordBagIds(child, usedIds));
  }
  delete record.wordBags;
  delete record.subgroups;
  delete record.groups;
  return record;
}

function hasOwnWordCloudPatchValue(record = {}, key = "") {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function wordCloudPatchHasAny(record = {}, keys = []) {
  return keys.some((key) => hasOwnWordCloudPatchValue(record, key));
}

function wordCloudPatchChildren(record = {}) {
  if (Array.isArray(record.children)) {
    return record.children;
  }
  if (Array.isArray(record.wordBags)) {
    return record.wordBags;
  }
  if (Array.isArray(record.subgroups)) {
    return record.subgroups;
  }
  if (Array.isArray(record.groups)) {
    return record.groups;
  }
  return null;
}

function wordCloudPatchIsStructural(record = {}) {
  return Boolean(
    wordCloudPatchChildren(record) ||
      Array.isArray(record.childWordBagIds) ||
      hasOwnWordCloudPatchValue(record, "parentWordBagId") ||
      hasOwnWordCloudPatchValue(record, "parentId")
  );
}

function patchNumberField(target, record, layout, key, min, max) {
  if (hasOwnWordCloudPatchValue(layout, key)) {
    target[key] = clampFiniteNumber(layout[key], target[key], min, max);
    return;
  }
  if (hasOwnWordCloudPatchValue(record, key)) {
    target[key] = clampFiniteNumber(record[key], target[key], min, max);
  }
}

function applyWordCloudWordBagPatch(existing = {}, patch = {}, frequencyByTerm = new Map(), options = {}) {
  const record = patch && typeof patch === "object" ? patch : {};
  const layout = record.layout && typeof record.layout === "object" ? record.layout : {};
  const updated = {
    ...existing,
    children: Array.isArray(existing.children) ? existing.children : []
  };
  if (wordCloudPatchHasAny(record, ["label", "title"])) {
    updated.label = String(record.label ?? record.title ?? updated.label ?? "").trim() || updated.label || "词袋";
  }
  if (wordCloudPatchHasAny(record, ["summary", "description"])) {
    updated.summary = String(record.summary ?? record.description ?? "").trim();
  }
  if (hasOwnWordCloudPatchValue(record, "relation")) {
    updated.relation = String(record.relation || "separate").trim() || "separate";
  }
  if (hasOwnWordCloudPatchValue(record, "absorbThreshold")) {
    updated.absorbThreshold = clampFiniteNumber(record.absorbThreshold, updated.absorbThreshold || 0.78, 0, 1);
  }
  patchNumberField(updated, record, layout, "x", 0, 84);
  patchNumberField(updated, record, layout, "y", 0, 84);
  patchNumberField(updated, record, layout, "width", 12, 90);
  patchNumberField(updated, record, layout, "height", 12, 90);
  patchNumberField(updated, record, layout, "zIndex", 1, 60);
  if (hasOwnWordCloudPatchValue(layout, "color") || hasOwnWordCloudPatchValue(record, "color")) {
    updated.color = String(layout.color ?? record.color ?? "").trim();
  }
  if (hasOwnWordCloudPatchValue(record, "terms")) {
    updated.terms = normalizeWordCloudTerms(record.terms || [], frequencyByTerm, WORD_CLOUD_STORAGE_MAX_TERMS);
  }
  if (hasOwnWordCloudPatchValue(record, "removedTerms")) {
    updated.removedTerms = normalizeWordCloudTerms(record.removedTerms || [], frequencyByTerm, WORD_CLOUD_STORAGE_MAX_TERMS);
  }
  if (options.replaceChildren) {
    const children = wordCloudPatchChildren(record) || [];
    updated.children = normalizeWordCloudWordBags(
      children.map((child) => assignMissingWordBagIds(child)),
      frequencyByTerm,
      updated.wordBagId
    );
  }
  return updated;
}

function normalizeWordCloudParentIds(wordBags = [], parentWordBagId = "") {
  for (const wordBag of Array.isArray(wordBags) ? wordBags : []) {
    wordBag.parentWordBagId = parentWordBagId;
    normalizeWordCloudParentIds(wordBag.children || [], wordBag.wordBagId);
  }
}

function normalizeWordCloudSetForMutation(wordBagSet = {}, updatedAt = new Date().toISOString()) {
  const normalized = normalizeWordCloudSetInput({ wordBagSet }, wordBagSet.termsSnapshot || []);
  normalized.createdAt = String(wordBagSet.createdAt || normalized.createdAt);
  normalized.updatedAt = updatedAt;
  normalized.wordBagCount = countWordCloudWordBags(normalized.wordBags);
  return normalized;
}

function normalizeSourcePathForCorpusMatch(value = "") {
  const normalized = path.normalize(String(value || "").trim());
  return normalized ? normalized.toLowerCase() : "";
}

function sourceMatchesCorpusPath(source = {}, corpusPath = {}) {
  const selectedPath = normalizeSourcePathForCorpusMatch(corpusPath.path);
  if (!selectedPath) {
    return false;
  }
  const selectedType = String(corpusPath.type || "").trim();
  const candidates = [
    source.path,
    source.name,
    source.rawObject?.originalSourcePath,
    source.rawObject?.originalRelativePath
  ]
    .map(normalizeSourcePathForCorpusMatch)
    .filter(Boolean);
  const directoryPrefix = selectedPath.endsWith(path.sep) ? selectedPath : `${selectedPath}${path.sep}`;
  return candidates.some((candidate) => {
    if (selectedType === "file") {
      return candidate === selectedPath;
    }
    if (selectedType === "directory") {
      return candidate === selectedPath || candidate.startsWith(directoryPrefix);
    }
    return candidate === selectedPath || candidate.startsWith(directoryPrefix);
  });
}

function termPresenceRate(documentFrequency, documentCount) {
  const count = Math.max(0, Number(documentCount || 0));
  if (count <= 0) {
    return 0;
  }
  const smoothing = 0.5;
  return (Math.max(0, Number(documentFrequency || 0)) + smoothing) / (count + smoothing * 2);
}

function significantTermScore({
  foregroundDocumentFrequency,
  foregroundDocumentCount,
  backgroundDocumentFrequency,
  backgroundDocumentCount
}) {
  const foregroundRate = termPresenceRate(foregroundDocumentFrequency, foregroundDocumentCount);
  const backgroundRate = termPresenceRate(backgroundDocumentFrequency, backgroundDocumentCount);
  if (foregroundRate <= backgroundRate || backgroundRate <= 0) {
    return {
      foregroundRate,
      backgroundRate,
      lift: backgroundRate > 0 ? foregroundRate / backgroundRate : 0,
      score: 0
    };
  }

  const lift = foregroundRate / backgroundRate;
  return {
    foregroundRate,
    backgroundRate,
    lift,
    score: (foregroundRate - backgroundRate) * Math.log(lift) * Math.log1p(foregroundDocumentFrequency)
  };
}

function buildSourceVocabularyFileKey(source = {}, text = "") {
  const contentHash = String(
    source.contentHash ||
      source.rawObject?.contentHash ||
      source.rawObject?.sha256 ||
      source.originalSha256 ||
      ""
  )
    .trim()
    .toLowerCase();
  if (contentHash) {
    return `hash:${contentHash}`;
  }

  if (String(text || "").trim()) {
    return `text:${sha256Text(text)}`;
  }

  return "";
}

function buildSourceVocabularyFileEntries(sources = [], rules = {}, textIndexing) {
  const ruleSet = textIndexing.compileRuleSet(rules || {});
  const entries = new Map();

  for (const source of sources || []) {
    const text = String(source?.text || "");
    if (!text.trim()) {
      continue;
    }
    const fileKey = buildSourceVocabularyFileKey(source, text);
    if (!fileKey || entries.has(fileKey)) {
      continue;
    }

    const termCounts = new Map();
    for (const [term, count] of textIndexing.tokenizeText(text, ruleSet).entries()) {
      const normalizedTerm = String(term || "").trim();
      const normalizedCount = Number(count || 0);
      if (
        !normalizedTerm ||
        normalizedTerm.length > SOURCE_VOCABULARY_MAX_TERM_LENGTH ||
        !Number.isFinite(normalizedCount) ||
        normalizedCount <= 0
      ) {
        continue;
      }

      termCounts.set(
        normalizedTerm,
        (termCounts.get(normalizedTerm) || 0) + Math.floor(normalizedCount)
      );
    }

    if (termCounts.size === 0) {
      continue;
    }

    entries.set(fileKey, {
      fileKey,
      termCounts: new Map(
        [...termCounts.entries()]
          .sort((left, right) => {
            if (right[1] !== left[1]) {
              return right[1] - left[1];
            }

            return left[0].localeCompare(right[0]);
          })
          .slice(0, SOURCE_VOCABULARY_MAX_TERMS_PER_BATCH)
      )
    });
  }

  return [...entries.values()];
}

function buildSourceVocabularyEntriesFromSourceFileIndex({ userDataPath } = {}) {
  const indexPath = path.join(String(userDataPath || ""), "source-file-index", "source-files.sqlite");
  if (!indexPath || !fs.existsSync(indexPath)) {
    return {
      scannedSourceCount: 0,
      entries: []
    };
  }

  let indexDb = null;
  try {
    indexDb = new Database(indexPath, { readonly: true, fileMustExist: true });
    const files = indexDb
      .prepare(`
        SELECT file_id, source_id, content_hash, readable_preview
        FROM source_file_index_files
        WHERE status = 'indexed'
      `)
      .all();
    if (!Array.isArray(files) || files.length === 0) {
      return {
        scannedSourceCount: 0,
        entries: []
      };
    }

    const sourceIds = new Set();
    const entriesByFileId = new Map();
    for (const row of files) {
      const fileId = String(row.file_id || "").trim();
      if (!fileId) {
        continue;
      }
      const sourceId = String(row.source_id || "").trim();
      if (sourceId) {
        sourceIds.add(sourceId);
      }
      const contentHash = String(row.content_hash || "").trim().toLowerCase();
      const text = String(row.readable_preview || "");
      const fileKey = buildSourceVocabularyFileKey({ contentHash }, text);
      if (!fileKey) {
        continue;
      }
      entriesByFileId.set(fileId, {
        fileKey,
        termCounts: new Map()
      });
    }
    if (entriesByFileId.size === 0) {
      return {
        scannedSourceCount: sourceIds.size,
        entries: []
      };
    }

    const terms = indexDb
      .prepare(`
        SELECT file_id, term, SUM(count) AS frequency
        FROM source_file_index_terms
        GROUP BY file_id, term
        ORDER BY file_id ASC, frequency DESC, term ASC
      `)
      .iterate();
    const termLimit = SOURCE_VOCABULARY_MAX_TERMS_PER_BATCH;
    for (const row of terms) {
      const fileId = String(row.file_id || "").trim();
      const entry = entriesByFileId.get(fileId);
      if (!entry) {
        continue;
      }
      if (entry.termCounts.size >= termLimit) {
        continue;
      }
      const term = String(row.term || "").trim();
      const frequency = Math.floor(Number(row.frequency || 0));
      if (
        !term ||
        term.length > SOURCE_VOCABULARY_MAX_TERM_LENGTH ||
        !Number.isFinite(frequency) ||
        frequency <= 0
      ) {
        continue;
      }
      entry.termCounts.set(term, frequency);
    }

    const dedupedByFileKey = new Map();
    for (const entry of entriesByFileId.values()) {
      if (entry.termCounts.size === 0) {
        continue;
      }
      if (!dedupedByFileKey.has(entry.fileKey)) {
        dedupedByFileKey.set(entry.fileKey, entry);
      }
    }
    return {
      scannedSourceCount: sourceIds.size,
      entries: [...dedupedByFileKey.values()]
    };
  } catch {
    return {
      scannedSourceCount: 0,
      entries: []
    };
  } finally {
    if (indexDb) {
      indexDb.close();
    }
  }
}

export function createBatchRepository({ db, userDataPath, textIndexing = null }) {
  const textIndexingService = textIndexing || createDefaultTextIndexingService();
  const insertBatchStmt = db.prepare(`
    INSERT INTO import_batches (
      batch_id, job_id, status, created_at, updated_at, generated_at, settings_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(batch_id) DO UPDATE SET
      job_id = excluded.job_id,
      status = excluded.status,
      updated_at = excluded.updated_at,
      generated_at = excluded.generated_at,
      settings_json = excluded.settings_json
  `);
  const updateBatchProgressStmt = db.prepare(`
    UPDATE import_batches
    SET
      status = ?,
      updated_at = ?,
      source_count = ?,
      raw_object_count = ?,
      warnings_json = ?,
      error = ''
    WHERE batch_id = ?
  `);
  const updateBatchStatusStmt = db.prepare(`
    UPDATE import_batches
    SET status = ?, updated_at = ?, error = ?
    WHERE batch_id = ?
  `);
  const failBatchStmt = db.prepare(`
    UPDATE import_batches
    SET status = 'failed', updated_at = ?, error = ?
    WHERE batch_id = ?
  `);
  const persistRawObjectStmt = db.prepare(`
    INSERT INTO raw_mail_objects (
      object_id, batch_id, source_ref, ingest_origin, original_file_name, original_relative_path,
      client_uid, source_type, provider_id, external_id, sync_batch_id, content_hash,
      captured_at, source_metadata_json, archive_file_name, original_source_path, source_container_path,
      storage_rel_path, sha256, byte_size, media_type,
      source_created_at, source_updated_at, source_collected_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const persistSourceStmt = db.prepare(`
    INSERT INTO source_files (
      record_id, batch_id, source_ref, name, source_path, kind, raw_object_id,
      source_created_at, source_updated_at, source_collected_at, provider_id, external_id,
      sync_batch_id, content_hash, captured_at, source_metadata_json, media_type, extracted_text,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const persistSourceDocumentProfileStmt = db.prepare(`
    INSERT INTO source_document_profiles (
      document_id, batch_id, source_ref, raw_object_id, file_hash, content_hash,
      original_file_name, source_path, source_type, provider_id, external_id,
      sync_batch_id, media_type, byte_size, captured_at, source_created_at,
      source_updated_at, source_collected_at, profile_version, metadata_json,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(batch_id, source_ref) DO UPDATE SET
      raw_object_id = excluded.raw_object_id,
      file_hash = excluded.file_hash,
      content_hash = excluded.content_hash,
      original_file_name = excluded.original_file_name,
      source_path = excluded.source_path,
      source_type = excluded.source_type,
      provider_id = excluded.provider_id,
      external_id = excluded.external_id,
      sync_batch_id = excluded.sync_batch_id,
      media_type = excluded.media_type,
      byte_size = excluded.byte_size,
      captured_at = excluded.captured_at,
      source_created_at = excluded.source_created_at,
      source_updated_at = excluded.source_updated_at,
      source_collected_at = excluded.source_collected_at,
      profile_version = excluded.profile_version,
      metadata_json = excluded.metadata_json,
      updated_at = excluded.updated_at
  `);
  const insertSourceDocumentFtsStmt = db.prepare(`
    INSERT INTO source_document_fts (
      document_id, title, text, source_path, source_type, metadata
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertSourceVocabularyBatchStmt = db.prepare(`
    INSERT INTO source_vocabulary_batches (
      batch_id, terms_json, file_keys_json, indexed_at
    ) VALUES (?, ?, ?, ?)
    ON CONFLICT(batch_id) DO UPDATE SET
      terms_json = excluded.terms_json,
      file_keys_json = excluded.file_keys_json,
      indexed_at = excluded.indexed_at
  `);
  const deleteSourceVocabularyBatchStmt = db.prepare(`
    DELETE FROM source_vocabulary_batches WHERE batch_id = ?
  `);
  const insertSourceCorpusRawTermStmt = db.prepare(`
    INSERT INTO source_corpus_raw_terms (
      term, frequency
    ) VALUES (?, ?)
    ON CONFLICT(term) DO UPDATE SET
      frequency = source_corpus_raw_terms.frequency + excluded.frequency
  `);
  const upsertSourceVocabularyTermStmt = db.prepare(`
    INSERT INTO source_vocabulary_terms (
      term, frequency, document_frequency, bm25_weight, profile_version, first_seen_at, last_seen_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(term) DO UPDATE SET
      frequency = source_vocabulary_terms.frequency + excluded.frequency,
      document_frequency = source_vocabulary_terms.document_frequency + excluded.document_frequency,
      bm25_weight = source_vocabulary_terms.bm25_weight + excluded.bm25_weight,
      profile_version = excluded.profile_version,
      last_seen_at = excluded.last_seen_at
  `);
  const clearSourceVocabularyStmt = db.prepare("DELETE FROM source_vocabulary_terms");
  const clearSourceVocabularyBatchesStmt = db.prepare("DELETE FROM source_vocabulary_batches");
  const clearSourceCorpusRawTermsStmt = db.prepare("DELETE FROM source_corpus_raw_terms");
  const listSourceCorpusRawTermsStmt = db.prepare(`
    SELECT term, frequency
    FROM source_corpus_raw_terms
    WHERE frequency >= ?
      AND (? = '' OR term LIKE ?)
    ORDER BY frequency DESC, term ASC
    LIMIT ?
  `);
  const listSourceVocabularyBatchIdsStmt = db.prepare(`
    SELECT DISTINCT batch_id FROM source_files ORDER BY batch_id ASC
  `);
  const listSourcesForVocabularyStmt = db.prepare(`
    SELECT
      s.batch_id,
      s.source_ref,
      s.name,
      s.source_path,
      s.kind,
      s.provider_id,
      s.external_id,
      s.sync_batch_id,
      s.content_hash,
      s.extracted_text,
      r.content_hash AS raw_content_hash,
      r.sha256 AS raw_sha256,
      r.original_source_path AS raw_original_source_path,
      r.original_relative_path AS raw_original_relative_path
    FROM source_files s
    LEFT JOIN raw_mail_objects r ON r.object_id = s.raw_object_id
    WHERE s.batch_id = ?
    ORDER BY s.created_at ASC, s.source_ref ASC
  `);
  const insertPreprocessBlockStmt = db.prepare(`
    INSERT INTO preprocess_blocks (
      record_id, batch_id, source_ref, block_id, kind, level, text, metadata_json,
      position, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(batch_id, block_id) DO UPDATE SET
      source_ref = excluded.source_ref,
      kind = excluded.kind,
      level = excluded.level,
      text = excluded.text,
      metadata_json = excluded.metadata_json,
      position = excluded.position,
      created_at = excluded.created_at
  `);
  const insertPreprocessChunkStmt = db.prepare(`
    INSERT INTO preprocess_chunks (
      record_id, batch_id, source_ref, chunk_id, title, title_path_json, block_ids_json,
      chunk_type, content, token_count, metadata_json, position, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(batch_id, chunk_id) DO UPDATE SET
      source_ref = excluded.source_ref,
      title = excluded.title,
      title_path_json = excluded.title_path_json,
      block_ids_json = excluded.block_ids_json,
      chunk_type = excluded.chunk_type,
      content = excluded.content,
      token_count = excluded.token_count,
      metadata_json = excluded.metadata_json,
      position = excluded.position,
      created_at = excluded.created_at
  `);
  const insertPersonStmt = db.prepare(`
    INSERT INTO people (
      record_id, batch_id, person_id, name, primary_email, aliases_json, organization,
      primary_department, departments_json, relation, role, sent_count, received_count,
      cc_count, bcc_count, transaction_count, first_seen_at, last_seen_at, top_topics_json,
      top_counterparties_json, summary, time_weight, freshness, formal_use_allowed
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertMessageStmt = db.prepare(`
    INSERT INTO email_messages (
      record_id, batch_id, message_id, source_ref, raw_object_id, subject, normalized_subject,
      sent_at, excerpt, body, keywords_json, chunk_ids_json, message_id_header, in_reply_to,
      references_json, previous_message_ids_json, conversation_key, thread_id, transaction_id,
      participant_ids_json, time_weight, freshness, status, formal_use_allowed
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertMessageParticipantStmt = db.prepare(`
    INSERT INTO email_message_participants (
      batch_id, message_record_id, person_id, role, position
    ) VALUES (?, ?, ?, ?, ?)
  `);
  const insertThreadStmt = db.prepare(`
    INSERT INTO email_threads (
      record_id, batch_id, thread_id, subject, normalized_subject, summary, message_ids_json,
      participant_ids_json, sender_ids_json, started_at, latest_activity_at, keywords_json,
      status, cadence, categories_json, pending_signals_json, transaction_id, time_weight,
      freshness, formal_use_allowed
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertThreadMessageStmt = db.prepare(`
    INSERT INTO email_thread_messages (
      batch_id, thread_record_id, message_record_id, position
    ) VALUES (?, ?, ?, ?)
  `);
  const insertTransactionStmt = db.prepare(`
    INSERT INTO transactions (
      record_id, batch_id, transaction_id, title, normalized_subject, summary, status, started_at, latest_activity_at,
      thread_ids_json, message_ids_json, participant_ids_json, timeline_event_ids_json, keywords_json,
      decisions_json, pending_items_json, cadence, categories_json, source_departments_json, lineage_id,
      lifecycle_stage, lifecycle_previous_state, lifecycle_next_state, lifecycle_match_score,
      lifecycle_match_reasons_json, lifecycle_matched_batch_id, lifecycle_matched_transaction_id,
      lifecycle_pulled_event_count, lifecycle_pulled_batch_count, lifecycle_pulled_transaction_count,
      source_spread, time_weight, freshness, formal_use_allowed
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertTransactionThreadStmt = db.prepare(`
    INSERT INTO transaction_threads (
      batch_id, transaction_record_id, thread_record_id, position
    ) VALUES (?, ?, ?, ?)
  `);
  const insertTimelineStmt = db.prepare(`
    INSERT INTO timeline_events (
      record_id, batch_id, timeline_event_id, timestamp, title, summary, type, source,
      message_id, thread_id, transaction_id, lineage_id, timeline_phase, origin_batch_id,
      origin_transaction_id, participant_ids_json, time_weight, freshness
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertRetrievalStmt = db.prepare(`
    INSERT INTO retrieval_documents (
      record_id, batch_id, retrieval_id, entity_type, entity_id, title, text, snippet,
      timestamp, source, keywords_json, participant_ids_json, transaction_id, thread_id,
      raw_object_id, time_weight, freshness, status, formal_use_allowed, review_due_at,
      search_terms_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertRetrievalFtsStmt = db.prepare(`
    INSERT INTO retrieval_fts (
      record_id, title, search_text, source, keywords
    ) VALUES (?, ?, ?, ?, ?)
  `);
  const completeBatchStmt = db.prepare(`
    UPDATE import_batches
    SET
      status = 'completed',
      updated_at = ?,
      warnings_json = ?,
      overview_json = ?,
      email_count = ?,
      thread_count = ?,
      transaction_count = ?,
      people_count = ?,
      retrieval_count = ?,
      error = ''
    WHERE batch_id = ?
  `);
  const selectRawObjectStmt = db.prepare(`
    SELECT * FROM raw_mail_objects WHERE object_id = ?
  `);
  const listRawObjectStoragePathsByBatchStmt = db.prepare(`
    SELECT storage_rel_path
    FROM raw_mail_objects
    WHERE batch_id = ?
    ORDER BY created_at ASC
  `);
  const selectSummaryStmt = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM import_batches) AS batch_count,
      (SELECT COUNT(*) FROM raw_mail_objects) AS raw_object_count,
      (SELECT COUNT(*) FROM source_files) AS source_count,
      (SELECT COUNT(*) FROM source_document_profiles) AS source_document_profile_count,
      (SELECT COUNT(*) FROM source_corpus_raw_terms) AS source_corpus_raw_term_count,
      (SELECT COALESCE(SUM(frequency), 0) FROM source_corpus_raw_terms) AS source_corpus_raw_total_frequency,
      (SELECT COUNT(*) FROM source_vocabulary_terms) AS source_vocabulary_term_count,
      (SELECT COALESCE(SUM(frequency), 0) FROM source_vocabulary_terms) AS source_vocabulary_total_frequency,
      (SELECT COALESCE(SUM(document_frequency), 0) FROM source_vocabulary_terms) AS source_vocabulary_total_document_frequency,
      (SELECT COALESCE(SUM(bm25_weight), 0) FROM source_vocabulary_terms) AS source_vocabulary_total_bm25_weight,
      (SELECT COUNT(*) FROM source_vocabulary_batches) AS source_vocabulary_batch_count,
      (SELECT COUNT(DISTINCT COALESCE(NULLIF(content_hash, ''), NULLIF(file_hash, ''), document_id)) FROM source_document_profiles) AS source_vocabulary_unique_file_count,
      (SELECT COUNT(*) FROM preprocess_blocks) AS preprocess_block_count,
      (SELECT COUNT(*) FROM preprocess_chunks) AS preprocess_chunk_count,
      (SELECT COUNT(*) FROM email_messages) AS email_count,
      (SELECT COUNT(*) FROM email_threads) AS thread_count,
      (SELECT COUNT(*) FROM transactions) AS transaction_count,
      (SELECT COUNT(*) FROM transaction_lineages) AS lineage_count,
      (SELECT COUNT(*) FROM transaction_lineage_runs) AS lineage_run_count,
      (SELECT COUNT(*) FROM client_registrations) AS client_count,
      (SELECT COUNT(*) FROM people) AS people_count,
      (SELECT COUNT(*) FROM retrieval_documents) AS retrieval_count
  `);
  const selectBatchExistsStmt = db.prepare(`
    SELECT batch_id FROM import_batches WHERE batch_id = ?
  `);
  const selectBatchStmt = db.prepare(`
    SELECT * FROM import_batches WHERE batch_id = ?
  `);
  const searchSourceDocumentsStmt = db.prepare(`
    SELECT
      p.document_id,
      p.batch_id,
      p.source_ref,
      p.original_file_name,
      p.source_path,
      p.source_type,
      p.provider_id,
      p.external_id,
      p.sync_batch_id,
      p.media_type,
      p.byte_size,
      p.file_hash,
      p.captured_at,
      bm25(source_document_fts, 0.0, 6.0, 1.0, 0.5, 0.5, 0.2) AS lexical_rank
    FROM source_document_fts
    JOIN source_document_profiles p
      ON p.document_id = source_document_fts.document_id
    WHERE source_document_fts MATCH ?
    ORDER BY lexical_rank ASC, p.updated_at DESC
    LIMIT ?
  `);
  const listRawCorpusDocumentsByBatchStmt = db.prepare(`
    SELECT
      p.document_id,
      p.batch_id,
      p.source_ref,
      COALESCE(NULLIF(p.original_file_name, ''), s.name) AS original_file_name,
      COALESCE(NULLIF(p.source_path, ''), s.source_path) AS source_path,
      COALESCE(NULLIF(p.source_type, ''), s.kind) AS source_type,
      COALESCE(NULLIF(p.provider_id, ''), s.provider_id) AS provider_id,
      COALESCE(NULLIF(p.external_id, ''), s.external_id) AS external_id,
      COALESCE(NULLIF(p.sync_batch_id, ''), s.sync_batch_id) AS sync_batch_id,
      COALESCE(NULLIF(p.media_type, ''), s.media_type) AS media_type,
      p.byte_size,
      COALESCE(NULLIF(p.content_hash, ''), s.content_hash, r.content_hash, r.sha256) AS content_hash,
      COALESCE(NULLIF(p.captured_at, ''), s.captured_at, r.captured_at) AS captured_at,
      COALESCE(NULLIF(p.source_created_at, ''), s.source_created_at, r.source_created_at) AS source_created_at,
      COALESCE(NULLIF(p.source_updated_at, ''), s.source_updated_at, r.source_updated_at) AS source_updated_at,
      COALESCE(NULLIF(p.source_collected_at, ''), s.source_collected_at, r.source_collected_at) AS source_collected_at,
      s.extracted_text,
      s.source_metadata_json,
      r.object_id AS raw_object_id,
      r.storage_rel_path AS raw_storage_rel_path,
      r.sha256 AS raw_sha256,
      r.original_relative_path AS raw_original_relative_path
    FROM source_document_profiles p
    JOIN source_files s ON s.batch_id = p.batch_id AND s.source_ref = p.source_ref
    LEFT JOIN raw_mail_objects r ON r.object_id = p.raw_object_id
    WHERE (? = '' OR p.batch_id = ?)
    ORDER BY
      COALESCE(NULLIF(p.captured_at, ''), NULLIF(p.source_created_at, ''), NULLIF(p.source_updated_at, ''), p.created_at) ASC,
      p.batch_id ASC,
      p.source_ref ASC
    LIMIT ?
  `);
  const searchRawCorpusDocumentsStmt = db.prepare(`
    SELECT
      p.document_id,
      p.batch_id,
      p.source_ref,
      COALESCE(NULLIF(p.original_file_name, ''), s.name) AS original_file_name,
      COALESCE(NULLIF(p.source_path, ''), s.source_path) AS source_path,
      COALESCE(NULLIF(p.source_type, ''), s.kind) AS source_type,
      COALESCE(NULLIF(p.provider_id, ''), s.provider_id) AS provider_id,
      COALESCE(NULLIF(p.external_id, ''), s.external_id) AS external_id,
      COALESCE(NULLIF(p.sync_batch_id, ''), s.sync_batch_id) AS sync_batch_id,
      COALESCE(NULLIF(p.media_type, ''), s.media_type) AS media_type,
      p.byte_size,
      COALESCE(NULLIF(p.content_hash, ''), s.content_hash, r.content_hash, r.sha256) AS content_hash,
      COALESCE(NULLIF(p.captured_at, ''), s.captured_at, r.captured_at) AS captured_at,
      COALESCE(NULLIF(p.source_created_at, ''), s.source_created_at, r.source_created_at) AS source_created_at,
      COALESCE(NULLIF(p.source_updated_at, ''), s.source_updated_at, r.source_updated_at) AS source_updated_at,
      COALESCE(NULLIF(p.source_collected_at, ''), s.source_collected_at, r.source_collected_at) AS source_collected_at,
      s.extracted_text,
      s.source_metadata_json,
      r.object_id AS raw_object_id,
      r.storage_rel_path AS raw_storage_rel_path,
      r.sha256 AS raw_sha256,
      r.original_relative_path AS raw_original_relative_path,
      bm25(source_document_fts, 0.0, 6.0, 1.0, 0.5, 0.5, 0.2) AS lexical_rank
    FROM source_document_fts
    JOIN source_document_profiles p ON p.document_id = source_document_fts.document_id
    JOIN source_files s ON s.batch_id = p.batch_id AND s.source_ref = p.source_ref
    LEFT JOIN raw_mail_objects r ON r.object_id = p.raw_object_id
    WHERE source_document_fts MATCH ?
      AND (? = '' OR p.batch_id = ?)
    ORDER BY lexical_rank ASC, p.updated_at DESC
    LIMIT ?
  `);
  const selectSourceVocabularyDocumentCountStmt = db.prepare(`
    SELECT COUNT(DISTINCT COALESCE(NULLIF(content_hash, ''), NULLIF(file_hash, ''), document_id)) AS count
    FROM source_document_profiles
  `);
  const listScopedSourcesForVocabularyStmt = db.prepare(`
    SELECT
      s.batch_id,
      s.source_ref,
      s.name,
      s.source_path,
      s.kind,
      s.provider_id,
      s.external_id,
      s.sync_batch_id,
      s.content_hash,
      s.extracted_text,
      r.content_hash AS raw_content_hash,
      r.sha256 AS raw_sha256,
      r.original_source_path AS raw_original_source_path,
      r.original_relative_path AS raw_original_relative_path
    FROM source_files s
    JOIN source_document_profiles p
      ON p.batch_id = s.batch_id AND p.source_ref = s.source_ref
    LEFT JOIN raw_mail_objects r ON r.object_id = p.raw_object_id
    WHERE (? = '' OR p.batch_id = ?)
      AND (? = '' OR COALESCE(NULLIF(r.client_uid, ''), '') = ?)
      AND (? = '' OR p.source_type = ?)
      AND (? = '' OR p.provider_id = ?)
      AND (? = '' OR p.sync_batch_id = ?)
      AND (? = '' OR p.external_id = ?)
    ORDER BY p.updated_at DESC, p.document_id ASC
    LIMIT ?
  `);
  const selectSourceVocabularyTermStatsStmt = db.prepare(`
    SELECT term, frequency, document_frequency, bm25_weight
    FROM source_vocabulary_terms
    WHERE term = ?
  `);
  function listSourceVocabularyTermStatsByTerms(input = {}) {
    const candidates = Array.isArray(input?.terms) ? input.terms : [];
    const normalized = new Set();
    for (const candidate of candidates) {
      const normalizedTerm = String(candidate || "").trim().toLowerCase();
      if (!normalizedTerm) {
        continue;
      }
      normalized.add(normalizedTerm);
    }
    const termList = Array.from(normalized);
    if (termList.length === 0) {
      return [];
    }
    const map = new Map();
    const SQLITE_VARIABLE_LIMIT = 900;
    for (let offset = 0; offset < termList.length; offset += SQLITE_VARIABLE_LIMIT) {
      const chunk = termList.slice(offset, offset + SQLITE_VARIABLE_LIMIT);
      const placeholders = chunk.map(() => "?").join(",");
      const stmt = db.prepare(`
        SELECT term, frequency, document_frequency, bm25_weight
        FROM source_vocabulary_terms
        WHERE term IN (${placeholders})
      `);
      const rows = stmt.all(chunk);
      for (const row of rows) {
        map.set(String(row.term || "").trim().toLowerCase(), {
          term: String(row.term || "").trim(),
          frequency: Number(row.frequency || 0) || 0,
          documentFrequency: Number(row.document_frequency || 0) || 0,
          bm25Weight: Number(row.bm25_weight || 0) || 0
        });
      }
    }
    return termList.map((term) => {
      const found = map.get(term);
      return found || {
        term,
        frequency: 0,
        documentFrequency: 0,
        bm25Weight: 0
      };
    });
  }
  const selectLatestWordCloudSetStmt = db.prepare(`
    SELECT *
    FROM knowledge_word_cloud_sets
    ORDER BY updated_at DESC
    LIMIT 1
  `);
  const selectWordCloudSetStmt = db.prepare(`
    SELECT *
    FROM knowledge_word_cloud_sets
    WHERE cloud_set_id = ?
  `);
  const listWordCloudSetsStmt = db.prepare(`
    SELECT *
    FROM knowledge_word_cloud_sets
    ORDER BY updated_at DESC
    LIMIT ?
  `);
  const upsertWordCloudSetStmt = db.prepare(`
    INSERT INTO knowledge_word_cloud_sets (
      cloud_set_id, title, status, cloud_count, terms_snapshot_json,
      clouds_json, unassigned_terms_json, corpus_paths_json, model_alias, agent_response_json,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(cloud_set_id) DO UPDATE SET
      title = excluded.title,
      status = excluded.status,
      cloud_count = excluded.cloud_count,
      terms_snapshot_json = excluded.terms_snapshot_json,
      clouds_json = excluded.clouds_json,
      unassigned_terms_json = excluded.unassigned_terms_json,
      corpus_paths_json = excluded.corpus_paths_json,
      model_alias = excluded.model_alias,
      agent_response_json = excluded.agent_response_json,
      updated_at = excluded.updated_at
  `);
  function backfillWordCloudWordBagsJsonl() {
    const rows = db.prepare(`
      SELECT cloud_set_id, title, updated_at, clouds_json
      FROM knowledge_word_cloud_sets
    `).all();
    for (const row of rows) {
      const filePath = wordCloudWordBagManifestJsonlPath(userDataPath, row.cloud_set_id);
      if (!wordCloudWordBagsJsonlNeedsSchemaRefresh(filePath)) {
        continue;
      }
      writeWordCloudWordBagsJsonlSync({
        userDataPath,
        wordBagSetId: row.cloud_set_id,
        updatedAt: row.updated_at,
        title: row.title,
        wordBags: normalizeWordCloudWordBags(parseArrayJson(row.clouds_json))
      });
    }
  }
  backfillWordCloudWordBagsJsonl();
  const insertDeletionOperationStmt = db.prepare(`
    INSERT INTO batch_deletion_operations (
      operation_id, batch_id, job_id, status, state_json, error, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(batch_id) DO UPDATE SET
      job_id = excluded.job_id,
      status = excluded.status,
      state_json = excluded.state_json,
      error = excluded.error,
      updated_at = excluded.updated_at
  `);
  const updateDeletionOperationStmt = db.prepare(`
    UPDATE batch_deletion_operations
    SET status = ?, state_json = ?, error = ?, updated_at = ?
    WHERE operation_id = ?
  `);
  const selectDeletionOperationByBatchStmt = db.prepare(`
    SELECT * FROM batch_deletion_operations WHERE batch_id = ?
  `);
  const selectDeletionOperationByIdStmt = db.prepare(`
    SELECT * FROM batch_deletion_operations WHERE operation_id = ?
  `);
  const listDeletionOperationsStmt = db.prepare(`
    SELECT * FROM batch_deletion_operations
    WHERE status <> 'completed'
    ORDER BY updated_at ASC
  `);
  const deleteDeletionOperationStmt = db.prepare(`
    DELETE FROM batch_deletion_operations WHERE operation_id = ?
  `);
  const deleteBatchStmt = db.prepare("DELETE FROM import_batches WHERE batch_id = ?");

  function hydrateDeletionOperation(row) {
    if (!row) {
      return null;
    }

    let state = {};
    try {
      state = JSON.parse(row.state_json || "{}");
    } catch {
      state = {};
    }

    return {
      operationId: row.operation_id,
      batchId: row.batch_id,
      jobId: row.job_id || "",
      status: row.status,
      state,
      error: row.error || "",
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  function persistSourceVocabularyBatch({ batchId, entries, now }) {
    const batchTerms = termCountsFromEntries(entries);
    if (batchTerms.size === 0) {
      deleteSourceVocabularyBatchStmt.run(batchId);
      return;
    }

    insertSourceVocabularyBatchStmt.run(
      batchId,
      termCountsToJson(batchTerms),
      "[]",
      now
    );
  }

  function persistCorpusTermsFromEntries(entries, now) {
    const byTerm = new Map();
    for (const entry of entries || []) {
      for (const [term, count] of entry.termCounts.entries()) {
        const current = byTerm.get(term) || {
          frequency: 0,
          documentFrequency: 0,
          bm25Weight: 0
        };
        current.frequency += count;
        current.documentFrequency += 1;
        current.bm25Weight += saturatedBm25TermFrequency(count);
        byTerm.set(term, current);
      }
    }

    for (const [term, stats] of byTerm.entries()) {
      insertSourceCorpusRawTermStmt.run(
        term,
        stats.frequency
      );
      upsertSourceVocabularyTermStmt.run(
        term,
        stats.frequency,
        stats.documentFrequency,
        stats.bm25Weight,
        SOURCE_VOCABULARY_PROFILE_VERSION,
        now,
        now
      );
    }
  }

  function rowToSourceForVocabulary(row) {
    return {
      id: row.source_ref,
      name: row.name,
      path: row.source_path,
      kind: row.kind,
      providerId: row.provider_id,
      externalId: row.external_id,
      syncBatchId: row.sync_batch_id,
      contentHash: row.content_hash || row.raw_content_hash || row.raw_sha256 || "",
      text: row.extracted_text || "",
      rawObject: {
        contentHash: row.raw_content_hash || "",
        sha256: row.raw_sha256 || "",
        originalSourcePath: row.raw_original_source_path || "",
        originalRelativePath: row.raw_original_relative_path || ""
      }
    };
  }

  function buildCorpusRawTermsFromSources(sources = [], input = {}) {
    const limit = clampInteger(input.limit, 300, 1, WORD_CLOUD_SOURCE_QUERY_MAX_TERMS);
    const minFrequency = clampInteger(input.minFrequency, 1, 1, 1000000000);
    const query = String(input.query || "").trim().toLowerCase();
    const entriesByFileKey = new Map();
    for (const entry of buildSourceVocabularyFileEntries(sources, input.rules || {}, textIndexingService)) {
      if (!entriesByFileKey.has(entry.fileKey)) {
        entriesByFileKey.set(entry.fileKey, entry);
      }
    }
    const byTerm = new Map();
    for (const entry of entriesByFileKey.values()) {
      for (const [term, count] of entry.termCounts.entries()) {
        byTerm.set(term, (byTerm.get(term) || 0) + count);
      }
    }
    return [...byTerm.entries()]
      .map(([term, frequency]) => ({ term, frequency: Number(frequency || 0) }))
      .filter((item) => item.frequency >= minFrequency)
      .filter((item) => !query || item.term.toLowerCase().includes(query))
      .sort((left, right) => {
        if (right.frequency !== left.frequency) {
          return right.frequency - left.frequency;
        }
        return left.term.localeCompare(right.term);
      })
      .slice(0, limit);
  }

  function rowToRawCorpusDocument(row) {
    return {
      documentId: row.document_id,
      batchId: row.batch_id,
      sourceRef: row.source_ref,
      title: row.original_file_name || row.source_path || row.source_ref,
      sourcePath: row.source_path || "",
      sourceType: row.source_type || "",
      providerId: row.provider_id || "",
      externalId: row.external_id || "",
      syncBatchId: row.sync_batch_id || "",
      mediaType: row.media_type || "",
      byteSize: Number(row.byte_size || 0),
      contentHash: row.content_hash || "",
      capturedAt: row.captured_at || "",
      sourceCreatedAt: row.source_created_at || "",
      sourceUpdatedAt: row.source_updated_at || "",
      sourceCollectedAt: row.source_collected_at || "",
      text: row.extracted_text || "",
      sourceMetadata: parseJsonValue(row.source_metadata_json, {}),
      rawObject: row.raw_object_id
        ? {
            objectId: row.raw_object_id,
            storageRelativePath: row.raw_storage_rel_path || "",
            sha256: row.raw_sha256 || "",
            originalRelativePath: row.raw_original_relative_path || ""
          }
        : null,
      lexicalRank: row.lexical_rank
    };
  }

  function listSourceCorpusRawTermsByPaths(input = {}) {
    const corpusPaths = normalizeWordCloudCorpusPaths(input.corpusPaths || input.corpusPath || []);
    if (corpusPaths.length === 0) {
      return null;
    }
    const matchedSources = [];
    for (const row of listSourceVocabularyBatchIdsStmt.all()) {
      const batchId = String(row.batch_id || "").trim();
      if (!batchId) {
        continue;
      }
      const sources = listSourcesForVocabularyStmt.all(batchId).map(rowToSourceForVocabulary);
      matchedSources.push(
        ...sources.filter((source) =>
          corpusPaths.some((corpusPath) => sourceMatchesCorpusPath(source, corpusPath))
        )
      );
    }
    return buildCorpusRawTermsFromSources(matchedSources, input);
  }

  function rebuildSourceVocabulary({ rules } = {}) {
    const now = new Date().toISOString();
    db.exec("BEGIN");
    try {
      clearSourceVocabularyBatchesStmt.run();
      clearSourceVocabularyStmt.run();
      clearSourceCorpusRawTermsStmt.run();

      let rebuiltBatchCount = 0;
      let scannedSourceCount = 0;
      const corpusEntriesByFileKey = new Map();
      for (const row of listSourceVocabularyBatchIdsStmt.all()) {
        const batchId = String(row.batch_id || "").trim();
        if (!batchId) {
          continue;
        }
        const sources = listSourcesForVocabularyStmt.all(batchId).map(rowToSourceForVocabulary);
        scannedSourceCount += sources.length;
        const entries = buildSourceVocabularyFileEntries(sources, rules, textIndexingService);
        persistSourceVocabularyBatch({
          batchId,
          entries,
          now
        });
        for (const entry of entries) {
          if (!corpusEntriesByFileKey.has(entry.fileKey)) {
            corpusEntriesByFileKey.set(entry.fileKey, entry);
          }
        }
        rebuiltBatchCount += 1;
      }
      if (rebuiltBatchCount === 0) {
        const fallback = buildSourceVocabularyEntriesFromSourceFileIndex({ userDataPath });
        scannedSourceCount += fallback.scannedSourceCount;
        if (fallback.entries.length > 0) {
          const fallbackBatchId = "source-file-index";
          persistSourceVocabularyBatch({
            batchId: fallbackBatchId,
            entries: fallback.entries,
            now
          });
          for (const entry of fallback.entries) {
            if (!corpusEntriesByFileKey.has(entry.fileKey)) {
              corpusEntriesByFileKey.set(entry.fileKey, entry);
            }
          }
          rebuiltBatchCount += 1;
        }
      }
      persistCorpusTermsFromEntries([...corpusEntriesByFileKey.values()], now);

      db.exec("COMMIT");
      const counts = selectSummaryStmt.get() || {};
      return {
        ok: true,
        rebuiltAt: now,
        rebuiltBatchCount,
        scannedSourceCount,
        sourceCorpusRawTermCount: counts.source_corpus_raw_term_count || 0,
        sourceCorpusRawTotalFrequency: counts.source_corpus_raw_total_frequency || 0,
        sourceVocabularyBatchCount: counts.source_vocabulary_batch_count || 0,
        sourceVocabularyUniqueFileCount: counts.source_vocabulary_unique_file_count || 0,
        sourceVocabularyTermCount: counts.source_vocabulary_term_count || 0,
        sourceVocabularyTotalFrequency: counts.source_vocabulary_total_frequency || 0,
        sourceVocabularyTotalDocumentFrequency: counts.source_vocabulary_total_document_frequency || 0,
        sourceVocabularyTotalBm25Weight: counts.source_vocabulary_total_bm25_weight || 0
      };
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function computeSignificantSourceTerms(input = {}) {
    const scope = normalizeSignificantTermsScope(input);
    const limit = clampInteger(input.limit, 50, 1, 500);
    const minForegroundDocumentFrequency = clampInteger(
      input.minForegroundDocumentFrequency || input.minDocumentFrequency,
      1,
      1,
      1000000
    );
    const maxForegroundFiles = clampInteger(input.maxForegroundFiles, 100000, 1, 100000);
    if (!hasSignificantTermsScope(scope)) {
      return {
        ok: false,
        error: "scope_required",
        profileVersion: SIGNIFICANT_TERMS_PROFILE_VERSION,
        scope,
        terms: []
      };
    }

    const scopedSources = listScopedSourcesForVocabularyStmt.all(
      scope.batchId,
      scope.batchId,
      scope.clientUid,
      scope.clientUid,
      scope.sourceType,
      scope.sourceType,
      scope.providerId,
      scope.providerId,
      scope.syncBatchId,
      scope.syncBatchId,
      scope.externalId,
      scope.externalId,
      maxForegroundFiles
    ).map(rowToSourceForVocabulary);
    const foregroundEntries = buildSourceVocabularyFileEntries(scopedSources, input.rules || {}, textIndexingService);
    const foregroundByTerm = new Map();
    for (const entry of foregroundEntries) {
      for (const [term, count] of entry.termCounts.entries()) {
        const current = foregroundByTerm.get(term) || {
          term,
          foregroundFrequency: 0,
          foregroundDocumentFrequency: 0,
          foregroundBm25Weight: 0
        };
        current.foregroundFrequency += count;
        current.foregroundDocumentFrequency += 1;
        current.foregroundBm25Weight += saturatedBm25TermFrequency(count);
        foregroundByTerm.set(term, current);
      }
    }

    const foregroundDocumentCount = foregroundEntries.length;
    const totalDocumentCount = Number(selectSourceVocabularyDocumentCountStmt.get()?.count || 0);
    const restDocumentCount = Math.max(0, totalDocumentCount - foregroundDocumentCount);
    const backgroundDocumentCount = restDocumentCount > 0 ? restDocumentCount : totalDocumentCount;
    const terms = [];
    for (const item of foregroundByTerm.values()) {
      if (item.foregroundDocumentFrequency < minForegroundDocumentFrequency) {
        continue;
      }

      const globalStats = selectSourceVocabularyTermStatsStmt.get(item.term) || {};
      const globalDocumentFrequency = Number(globalStats.document_frequency || 0);
      const backgroundDocumentFrequency =
        restDocumentCount > 0
          ? Math.max(0, globalDocumentFrequency - item.foregroundDocumentFrequency)
          : globalDocumentFrequency;
      const scoring = significantTermScore({
        foregroundDocumentFrequency: item.foregroundDocumentFrequency,
        foregroundDocumentCount,
        backgroundDocumentFrequency,
        backgroundDocumentCount
      });
      if (scoring.score <= 0) {
        continue;
      }

      terms.push({
        term: item.term,
        score: Number(scoring.score.toFixed(8)),
        lift: Number(scoring.lift.toFixed(8)),
        foregroundFrequency: item.foregroundFrequency,
        foregroundDocumentFrequency: item.foregroundDocumentFrequency,
        foregroundRate: Number(scoring.foregroundRate.toFixed(8)),
        foregroundBm25Weight: Number(item.foregroundBm25Weight.toFixed(8)),
        backgroundDocumentFrequency,
        backgroundRate: Number(scoring.backgroundRate.toFixed(8)),
        globalFrequency: Number(globalStats.frequency || 0),
        globalDocumentFrequency,
        globalBm25Weight: Number(globalStats.bm25_weight || 0)
      });
    }

    terms.sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      if (right.foregroundDocumentFrequency !== left.foregroundDocumentFrequency) {
        return right.foregroundDocumentFrequency - left.foregroundDocumentFrequency;
      }
      if (right.foregroundFrequency !== left.foregroundFrequency) {
        return right.foregroundFrequency - left.foregroundFrequency;
      }
      return left.term.localeCompare(right.term);
    });

    return {
      ok: true,
      profileVersion: SIGNIFICANT_TERMS_PROFILE_VERSION,
      scope,
      limit,
      minForegroundDocumentFrequency,
      foregroundDocumentCount,
      backgroundDocumentCount,
      totalDocumentCount,
      truncatedForeground: scopedSources.length >= maxForegroundFiles,
      terms: terms.slice(0, limit)
    };
  }

  function listSourceCorpusRawTerms(input = {}) {
    const scopedTerms = listSourceCorpusRawTermsByPaths(input);
    if (scopedTerms) {
      return scopedTerms;
    }
    const limit = clampInteger(input.limit, 300, 1, WORD_CLOUD_SOURCE_QUERY_MAX_TERMS);
    const minFrequency = clampInteger(input.minFrequency, 1, 1, 1000000000);
    const query = String(input.query || "").trim();
    const likeQuery = query ? `%${query.replace(/[%_]/g, "\\$&")}%` : "";
    return listSourceCorpusRawTermsStmt.all(minFrequency, query, likeQuery, limit).map((row) => ({
      term: row.term,
      frequency: Number(row.frequency || 0)
    }));
  }

  async function hydrateWordCloudSet(row, options = {}) {
    if (!row) {
      return null;
    }
    const storedWordBags = await readWordCloudWordBagsJsonlAsync({
      userDataPath,
      wordBagSetId: row.cloud_set_id,
      targetWordBagId: options.targetWordBagId
    }) ?? normalizeWordCloudWordBags(parseArrayJson(row.clouds_json));
    const termsSnapshot = normalizeWordCloudTerms(
      parseArrayJson(row.terms_snapshot_json),
      new Map(),
      WORD_CLOUD_STORAGE_MAX_TERMS
    );
    const reconciled = options.targetWordBagId
      ? { wordBags: storedWordBags, defaultTerms: parseArrayJson(row.unassigned_terms_json) }
      : reconcilePresetWordCloudWordBags(storedWordBags, termsSnapshot);
    return {
      schemaVersion: WORD_CLOUD_SCHEMA_VERSION,
      wordBagSetId: row.cloud_set_id,
      title: row.title,
      status: row.status,
      wordBagCount: countWordCloudWordBags(reconciled.wordBags),
      termsSnapshot,
      wordBags: reconciled.wordBags,
      unassignedTerms: reconciled.defaultTerms,
      corpusPaths: normalizeWordCloudCorpusPaths(parseArrayJson(row.corpus_paths_json)),
      modelAlias: row.model_alias || "",
      agentResponse: parseObjectJson(row.agent_response_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  function upsertWordCloudSetSnapshot(normalized = {}, existing = null) {
    const wordBagCount = countWordCloudWordBags(normalized.wordBags);
    upsertWordCloudSetStmt.run(
      normalized.wordBagSetId,
      normalized.title,
      normalized.status,
      wordBagCount,
      JSON.stringify(normalized.termsSnapshot || []),
      JSON.stringify(normalized.wordBags || []),
      JSON.stringify(normalized.unassignedTerms || []),
      JSON.stringify(normalized.corpusPaths || []),
      normalized.modelAlias || "",
      JSON.stringify(normalized.agentResponse || {}),
      existing?.created_at || normalized.createdAt,
      normalized.updatedAt
    );
  }

  async function persistNormalizedWordCloudSet(normalized = {}) {
    const existing = selectWordCloudSetStmt.get(normalized.wordBagSetId);
    await writeWordCloudWordBagsJsonl({
      userDataPath,
      wordBagSetId: normalized.wordBagSetId,
      updatedAt: normalized.updatedAt,
      title: normalized.title,
      wordBags: normalized.wordBags
    });
    upsertWordCloudSetSnapshot(normalized, existing);
    return hydrateWordCloudSet(selectWordCloudSetStmt.get(normalized.wordBagSetId));
  }

  async function refreshWordCloudSetSnapshotFromJsonl(wordBagSetId, updatedAt = new Date().toISOString()) {
    const row = selectWordCloudSetStmt.get(wordBagSetId);
    if (!row) {
      throw wordCloudError("词袋集合不存在。", 404, "word_bag_set_not_found");
    }
    const current = await hydrateWordCloudSet(row);
    const normalized = normalizeWordCloudSetForMutation({
      ...current,
      updatedAt
    }, updatedAt);
    upsertWordCloudSetSnapshot(normalized, row);
    return hydrateWordCloudSet(selectWordCloudSetStmt.get(wordBagSetId));
  }

  async function saveKnowledgeWordCloudSet(input = {}) {
    const corpusPaths = normalizeWordCloudCorpusPaths(
      input.corpusPaths || input.corpusPath || input.wordBagSet?.corpusPaths || []
    );
    const fallbackTerms = listSourceCorpusRawTerms({
      limit: input.limit || 300,
      minFrequency: input.minFrequency || 1,
      corpusPaths,
      rules: input.rules
    });
    const normalized = normalizeWordCloudSetInput(input, fallbackTerms);
    return enqueueWordCloudSetWriteLock(normalized.wordBagSetId, async () => ({
      ok: true,
      wordBagSet: await persistNormalizedWordCloudSet(normalized)
    }));
  }

  function nextImportedWordBagSetId(sourceWordBagSetId = "") {
    const base = String(sourceWordBagSetId || "word_bag")
      .trim()
      .replace(/[^A-Za-z0-9_.:-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 96) || "word_bag";
    const suffix = Date.now().toString(36);
    for (let index = 0; index < 1000; index += 1) {
      const candidate = `${base}-import-${suffix}${index > 0 ? `-${index}` : ""}`;
      if (!selectWordCloudSetStmt.get(candidate)) {
        return candidate;
      }
    }
    return `word_bag_${randomUUID()}`;
  }

  async function exportKnowledgeWordCloudSet(input = {}) {
    const wordBagSetId = String(input.wordBagSetId || input.wordBagSet?.wordBagSetId || "").trim();
    const selectedRow = wordBagSetId
      ? selectWordCloudSetStmt.get(wordBagSetId)
      : selectLatestWordCloudSetStmt.get();
    if (!selectedRow) {
      throw wordCloudError("词袋集合不存在。", 404, "word_bag_set_not_found");
    }
    const selectedWordBagSetId = String(selectedRow.cloud_set_id || "").trim();
    return enqueueWordCloudSetWriteLock(selectedWordBagSetId, async () => {
      const row = selectWordCloudSetStmt.get(selectedWordBagSetId);
      if (!row) {
        throw wordCloudError("词袋集合不存在。", 404, "word_bag_set_not_found");
      }
      return {
        ok: true,
        exportType: WORD_CLOUD_EXPORT_TYPE,
        schemaVersion: WORD_CLOUD_SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        wordBagSet: await hydrateWordCloudSet(row)
      };
    });
  }

  async function importKnowledgeWordCloudSet(input = {}) {
    const { envelope, wordBagSet } = parseWordCloudImportEnvelope(input);
    const sourceWordBagSetId = String(wordBagSet.wordBagSetId || wordBagSet.id || "").trim();
    const mode = normalizeWordCloudImportMode(input, envelope);
    const importedWordBagSet = {
      ...wordBagSet,
      wordBagSetId: mode === "overwrite"
        ? sourceWordBagSetId || String(wordBagSet.wordBagSetId || "").trim()
        : nextImportedWordBagSetId(sourceWordBagSetId)
    };
    const updatedAt = new Date().toISOString();
    const normalized = normalizeWordCloudSetForMutation(importedWordBagSet, updatedAt);
    return enqueueWordCloudSetWriteLock(normalized.wordBagSetId, async () => ({
      ok: true,
      action: "imported",
      mode,
      importedFromWordBagSetId: sourceWordBagSetId,
      exportType: WORD_CLOUD_EXPORT_TYPE,
      wordBagSet: await persistNormalizedWordCloudSet(normalized)
    }));
  }

  async function addKnowledgeWordBag(input = {}) {
    const wordBagSetId = String(input.wordBagSetId || input.wordBagSet?.wordBagSetId || "").trim();
    if (!wordBagSetId) {
      throw wordCloudError("缺少 wordBagSetId。", 400, "word_bag_set_id_required");
    }
    return enqueueWordCloudSetWriteLock(wordBagSetId, async () => {
      const row = selectWordCloudSetStmt.get(wordBagSetId);
      if (!row) {
        throw wordCloudError("词袋集合不存在。", 404, "word_bag_set_not_found");
      }
      const current = await hydrateWordCloudSet(row);
      const wordBags = cloneWordCloudWordBagTree(current.wordBags || []);
      const frequencyByTerm = wordCloudFrequencyMapFromTerms(current.termsSnapshot || []);
      const source = input.wordBag && typeof input.wordBag === "object" ? input.wordBag : input;
      const parentWordBagId = String(input.parentWordBagId || source.parentWordBagId || "").trim();
      const existingIds = collectWordCloudWordBagIds(wordBags);
      const [wordBag] = normalizeWordCloudWordBags([
        {
          ...assignMissingWordBagIds(source, new Set(existingIds)),
          parentWordBagId
        }
      ], frequencyByTerm, parentWordBagId);
      if (!wordBag) {
        throw wordCloudError("新增词袋内容无效。", 400, "word_bag_invalid");
      }
      for (const nextWordBagId of collectWordCloudWordBagIds([wordBag])) {
        if (existingIds.has(nextWordBagId)) {
          throw wordCloudError(`词袋 ID 已存在：${nextWordBagId}`, 409, "word_bag_id_duplicate");
        }
      }
      if (parentWordBagId) {
        const parent = findWordCloudWordBagInTree(wordBags, parentWordBagId);
        if (!parent) {
          throw wordCloudError("父词袋不存在。", 404, "parent_word_bag_not_found");
        }
        parent.wordBag.children = [...(parent.wordBag.children || []), wordBag];
      } else {
        wordBags.push(wordBag);
      }
      normalizeWordCloudParentIds(wordBags);
      assertUniqueWordCloudWordBagIds(wordBags);
      const updatedAt = new Date().toISOString();
      const normalized = normalizeWordCloudSetForMutation({
        ...current,
        wordBags
      }, updatedAt);
      const wordBagSet = await persistNormalizedWordCloudSet(normalized);
      const saved = findWordCloudWordBagInTree(wordBagSet.wordBags || [], wordBag.wordBagId)?.wordBag || wordBag;
      return {
        ok: true,
        action: "added",
        wordBag: saved,
        wordBagSet
      };
    });
  }

  async function updateKnowledgeWordBag(input = {}) {
    const wordBagSetId = String(input.wordBagSetId || input.wordBagSet?.wordBagSetId || "").trim();
    const wordBagId = String(input.wordBagId || input.id || input.wordBag?.wordBagId || "").trim();
    if (!wordBagSetId) {
      throw wordCloudError("缺少 wordBagSetId。", 400, "word_bag_set_id_required");
    }
    if (!wordBagId) {
      throw wordCloudError("缺少 wordBagId。", 400, "word_bag_id_required");
    }
    const patch = input.wordBag && typeof input.wordBag === "object"
      ? input.wordBag
      : input.patch && typeof input.patch === "object"
        ? input.patch
        : input;
    const updatedAt = new Date().toISOString();
    if (!wordCloudPatchIsStructural(patch)) {
      const row = selectWordCloudSetStmt.get(wordBagSetId);
      if (!row) {
        throw wordCloudError("词袋集合不存在。", 404, "word_bag_set_not_found");
      }
      const frequencyByTerm = wordCloudFrequencyMapFromTerms(parseArrayJson(row.terms_snapshot_json));
      const wordBag = await mutateWordCloudWordBagJsonlAsync({
        userDataPath,
        wordBagSetId,
        wordBagId,
        updatedAt,
        mutate(currentWordBag) {
          if (wordCloudIsPresetWordBag(currentWordBag) && wordCloudPatchHasAny(patch, ["label", "title"])) {
            throw wordCloudError("预设词袋标题不能更改。", 409, "preset_word_bag_title_update_forbidden");
          }
          return applyWordCloudWordBagPatch(currentWordBag, patch, frequencyByTerm);
        }
      });
      const wordBagSet = await refreshWordCloudSetSnapshotFromJsonl(wordBagSetId, updatedAt);
      return {
        ok: true,
        action: "updated",
        wordBag,
        wordBagSet
      };
    }

    return enqueueWordCloudSetWriteLock(wordBagSetId, async () => {
      const row = selectWordCloudSetStmt.get(wordBagSetId);
      if (!row) {
        throw wordCloudError("词袋集合不存在。", 404, "word_bag_set_not_found");
      }
      const current = await hydrateWordCloudSet(row);
      const wordBags = cloneWordCloudWordBagTree(current.wordBags || []);
      const match = findWordCloudWordBagInTree(wordBags, wordBagId);
      if (!match) {
        throw wordCloudError("词袋不存在。", 404, "word_bag_not_found");
      }
      if (wordCloudIsPresetWordBag(match.wordBag) && wordCloudPatchHasAny(patch, ["label", "title"])) {
        throw wordCloudError("预设词袋标题不能更改。", 409, "preset_word_bag_title_update_forbidden");
      }
      const frequencyByTerm = wordCloudFrequencyMapFromTerms(current.termsSnapshot || []);
      const updatedWordBag = applyWordCloudWordBagPatch(match.wordBag, patch, frequencyByTerm, {
        replaceChildren: wordCloudPatchChildren(patch) !== null
      });
      if (Array.isArray(patch.childWordBagIds)) {
        const childWordBagIds = patch.childWordBagIds
          .map((item) => String(item || "").trim())
          .filter(Boolean);
        const childById = new Map((updatedWordBag.children || []).map((child) => [child.wordBagId, child]));
        const missingChild = childWordBagIds.find((childWordBagId) => !childById.has(childWordBagId));
        if (missingChild) {
          throw wordCloudError(`子词袋不存在：${missingChild}`, 404, "child_word_bag_not_found");
        }
        updatedWordBag.children = childWordBagIds.map((childWordBagId) => childById.get(childWordBagId));
      }

      const requestedParentWordBagId = wordCloudPatchHasAny(patch, ["parentWordBagId", "parentId"])
        ? String(patch.parentWordBagId ?? patch.parentId ?? "").trim()
        : (match.parent?.wordBagId || "");
      const currentParentWordBagId = match.parent?.wordBagId || "";
      if (requestedParentWordBagId !== currentParentWordBagId) {
        const removed = removeWordCloudWordBagFromTree(wordBags, wordBagId);
        if (!removed) {
          throw wordCloudError("词袋不存在。", 404, "word_bag_not_found");
        }
        Object.assign(removed, updatedWordBag);
        if (requestedParentWordBagId) {
          const parent = findWordCloudWordBagInTree(wordBags, requestedParentWordBagId);
          if (!parent) {
            throw wordCloudError("父词袋不存在，或不能移动到自己的子树里。", 404, "parent_word_bag_not_found");
          }
          parent.wordBag.children = [...(parent.wordBag.children || []), removed];
        } else {
          wordBags.push(removed);
        }
      } else {
        Object.assign(match.wordBag, updatedWordBag);
      }

      normalizeWordCloudParentIds(wordBags);
      assertUniqueWordCloudWordBagIds(wordBags);
      const normalized = normalizeWordCloudSetForMutation({
        ...current,
        wordBags
      }, updatedAt);
      const wordBagSet = await persistNormalizedWordCloudSet(normalized);
      const saved = findWordCloudWordBagInTree(wordBagSet.wordBags || [], wordBagId)?.wordBag || updatedWordBag;
      return {
        ok: true,
        action: "updated",
        wordBag: saved,
        wordBagSet
      };
    });
  }

  async function deleteKnowledgeWordBag(input = {}) {
    const wordBagSetId = String(input.wordBagSetId || input.wordBagSet?.wordBagSetId || "").trim();
    const wordBagId = String(input.wordBagId || input.id || "").trim();
    if (!wordBagSetId) {
      throw wordCloudError("缺少 wordBagSetId。", 400, "word_bag_set_id_required");
    }
    if (!wordBagId) {
      throw wordCloudError("缺少 wordBagId。", 400, "word_bag_id_required");
    }
    return enqueueWordCloudSetWriteLock(wordBagSetId, async () => {
      const row = selectWordCloudSetStmt.get(wordBagSetId);
      if (!row) {
        throw wordCloudError("词袋集合不存在。", 404, "word_bag_set_not_found");
      }
      const current = await hydrateWordCloudSet(row);
      const wordBags = cloneWordCloudWordBagTree(current.wordBags || []);
      const match = findWordCloudWordBagInTree(wordBags, wordBagId);
      if (!match) {
        throw wordCloudError("词袋不存在。", 404, "word_bag_not_found");
      }
      if (wordCloudIsPresetWordBag(match.wordBag)) {
        throw wordCloudError("预设词袋不能删除。", 409, "preset_word_bag_delete_forbidden");
      }
      const removed = removeWordCloudWordBagFromTree(wordBags, wordBagId);
      if (!removed) {
        throw wordCloudError("词袋不存在。", 404, "word_bag_not_found");
      }
      const frequencyByTerm = wordCloudFrequencyMapFromTerms(current.termsSnapshot || []);
      const returnedTerms = normalizeWordCloudTerms(
        collectWordCloudActiveTerms([removed]),
        frequencyByTerm,
        WORD_CLOUD_STORAGE_MAX_TERMS
      );
      let defaultWordBagId = "";
      if (returnedTerms.length > 0) {
        const defaultWordBag = ensureDefaultWordCloudWordBag(wordBags, frequencyByTerm);
        defaultWordBag.terms = mergeWordCloudTerms(defaultWordBag.terms || [], returnedTerms, frequencyByTerm);
        defaultWordBagId = defaultWordBag.wordBagId;
      }
      normalizeWordCloudParentIds(wordBags);
      assertUniqueWordCloudWordBagIds(wordBags);
      const normalized = normalizeWordCloudSetForMutation({
        ...current,
        wordBags
      }, new Date().toISOString());
      const wordBagSet = await persistNormalizedWordCloudSet(normalized);
      return {
        ok: true,
        action: "deleted",
        deletedWordBagId: wordBagId,
        returnedTermCount: returnedTerms.length,
        defaultWordBagId,
        wordBagSet
      };
    });
  }

  async function getKnowledgeWordBagTerms(input = {}) {
    const wordBagSetId = String(input.wordBagSetId || input.wordBagSet?.wordBagSetId || "").trim();
    const requestedWordBagIds = normalizeRequestedWordBagIds(input);
    if (requestedWordBagIds.length === 0) {
      throw wordCloudError("缺少 wordBagId 或 wordBagIds。", 400, "word_bag_id_required");
    }

    const selectedRow = wordBagSetId
      ? selectWordCloudSetStmt.get(wordBagSetId)
      : selectLatestWordCloudSetStmt.get();
    if (!selectedRow) {
      throw wordCloudError("词袋集合不存在。", 404, "word_bag_set_not_found");
    }
    const selectedWordBagSetId = String(selectedRow.cloud_set_id || "").trim();

    return enqueueWordCloudSetWriteLock(selectedWordBagSetId, async () => {
      const row = selectWordCloudSetStmt.get(selectedWordBagSetId);
      if (!row) {
        throw wordCloudError("词袋集合不存在。", 404, "word_bag_set_not_found");
      }
      const wordBagSet = await hydrateWordCloudSet(row);
      const includeChildren = input.includeChildren !== false;
      const groups = [];
      const missingWordBagIds = [];
      for (const requestedWordBagId of requestedWordBagIds) {
        const match = findWordCloudWordBagInTree(wordBagSet?.wordBags || [], requestedWordBagId);
        if (!match?.wordBag) {
          missingWordBagIds.push(requestedWordBagId);
          continue;
        }
        groups.push(buildWordCloudTermsGroup(match.wordBag, includeChildren));
      }

      return {
        ok: true,
        schemaVersion: WORD_CLOUD_SCHEMA_VERSION,
        wordBagSetId: selectedWordBagSetId,
        title: wordBagSet?.title || "",
        status: wordBagSet?.status || "",
        updatedAt: wordBagSet?.updatedAt || row.updated_at,
        includeChildren,
        requestedWordBagIds,
        missingWordBagIds,
        groups,
        terms: groups.flatMap((group) => group.terms),
        removedTerms: groups.flatMap((group) => group.removedTerms)
      };
    });
  }

  async function getKnowledgeWordCloudState(input = {}) {
    const limit = clampInteger(input.limit, 300, 1, 1000);
    const minFrequency = clampInteger(input.minFrequency, 1, 1, 1000000000);
    const corpusPaths = normalizeWordCloudCorpusPaths(input.corpusPaths || input.corpusPath || []);
    const terms = listSourceCorpusRawTerms({
      limit,
      minFrequency,
      query: input.query,
      corpusPaths,
      rules: input.rules
    });
    const wordBagSetId = String(input.wordBagSetId || "").trim();
    const targetWordBagId = String(input.wordBagId || input.targetWordBagId || "").trim();
    const selected = wordBagSetId
      ? selectWordCloudSetStmt.get(wordBagSetId)
      : selectLatestWordCloudSetStmt.get();
    const wordBagSetRows = listWordCloudSetsStmt.all(clampInteger(input.setLimit, 20, 1, 100));
    const [wordBagSet, wordBagSets] = await Promise.all([
      hydrateWordCloudSet(selected, { targetWordBagId }),
      Promise.all(wordBagSetRows.map((row) => hydrateWordCloudSet(row)))
    ]);
    return {
      ok: true,
      schemaVersion: WORD_CLOUD_SCHEMA_VERSION,
      terms,
      corpusPaths,
      wordBagSet,
      wordBagSets
    };
  }

  function deleteBatchDataRecords(batchId) {
    db.exec("BEGIN");
    try {
      deleteSourceVocabularyBatchStmt.run(batchId);
      db.prepare(`
        DELETE FROM retrieval_fts
        WHERE record_id IN (
          SELECT record_id FROM retrieval_documents WHERE batch_id = ?
        )
      `).run(batchId);
      db.prepare("DELETE FROM retrieval_documents WHERE batch_id = ?").run(batchId);
      db.prepare("DELETE FROM timeline_events WHERE batch_id = ?").run(batchId);
      db.prepare("DELETE FROM transaction_threads WHERE batch_id = ?").run(batchId);
      db.prepare("DELETE FROM transaction_lineage_runs WHERE batch_id = ?").run(batchId);
      db.prepare("DELETE FROM transactions WHERE batch_id = ?").run(batchId);
      db.prepare("DELETE FROM email_thread_messages WHERE batch_id = ?").run(batchId);
      db.prepare("DELETE FROM email_threads WHERE batch_id = ?").run(batchId);
      db.prepare("DELETE FROM email_message_participants WHERE batch_id = ?").run(batchId);
      db.prepare("DELETE FROM email_messages WHERE batch_id = ?").run(batchId);
      db.prepare("DELETE FROM people WHERE batch_id = ?").run(batchId);
      db.prepare("DELETE FROM preprocess_chunks WHERE batch_id = ?").run(batchId);
      db.prepare("DELETE FROM preprocess_blocks WHERE batch_id = ?").run(batchId);
      db.prepare(`
        DELETE FROM source_document_fts
        WHERE document_id IN (
          SELECT document_id FROM source_document_profiles WHERE batch_id = ?
        )
      `).run(batchId);
      db.prepare("DELETE FROM source_document_profiles WHERE batch_id = ?").run(batchId);
      db.prepare("DELETE FROM source_files WHERE batch_id = ?").run(batchId);
      db.prepare("DELETE FROM raw_mail_objects WHERE batch_id = ?").run(batchId);
      db.prepare(`
        DELETE FROM transaction_lineages
        WHERE lineage_id NOT IN (
          SELECT DISTINCT lineage_id FROM transaction_lineage_runs
        )
      `).run();
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  return {
    get objectRootPath() {
      return getRawMailObjectRoot(userDataPath);
    },
    beginBatch({ batchId, jobId, generatedAt, settings }) {
      const now = new Date().toISOString();
      insertBatchStmt.run(
        batchId,
        jobId,
        "ingesting",
        now,
        now,
        generatedAt,
        JSON.stringify(settings || {})
      );
    },
    updateBatchStatus(batchId, status, error = "") {
      updateBatchStatusStmt.run(status, new Date().toISOString(), String(error || ""), batchId);
    },
    persistSources({ batchId, sources, warnings, rules }) {
      const now = new Date().toISOString();
      deleteBatchDataRecords(batchId);
      db.exec("BEGIN");
      try {
        let rawObjectCount = 0;

        for (const source of sources || []) {
          if (source.rawObject) {
            rawObjectCount += 1;
            persistRawObjectStmt.run(
              source.rawObject.objectId,
              batchId,
              source.id,
              source.rawObject.ingestOrigin,
              source.rawObject.originalFileName,
              source.rawObject.originalRelativePath,
              source.rawObject.clientUid || "",
              source.rawObject.sourceType || "",
              source.rawObject.providerId || "",
              source.rawObject.externalId || "",
              source.rawObject.syncBatchId || "",
              source.rawObject.contentHash || source.rawObject.sha256 || "",
              source.rawObject.capturedAt || "",
              asObjectJson(source.rawObject.sourceMetadata),
              source.rawObject.archiveFileName || "",
              source.rawObject.originalSourcePath,
              source.rawObject.sourceContainerPath,
              source.rawObject.storageRelativePath,
              source.rawObject.sha256,
              source.rawObject.byteSize,
              source.rawObject.mediaType,
              source.rawObject.sourceCreatedAt,
              source.rawObject.sourceUpdatedAt,
              source.rawObject.sourceCollectedAt,
              source.rawObject.createdAt
            );
          }

          persistSourceStmt.run(
            scopedId(batchId, "source", source.id),
            batchId,
            source.id,
            source.name,
            source.path || "",
            source.kind,
            source.rawObject?.objectId || null,
            source.sourceCreatedAt || "",
            source.sourceUpdatedAt || "",
            source.sourceCollectedAt || "",
            source.providerId || source.rawObject?.providerId || "",
            source.externalId || source.rawObject?.externalId || "",
            source.syncBatchId || source.rawObject?.syncBatchId || "",
            source.contentHash || source.rawObject?.contentHash || source.originalSha256 || "",
            source.capturedAt || source.rawObject?.capturedAt || "",
            asObjectJson(source.sourceMetadata || source.rawObject?.sourceMetadata),
            source.mediaType || "",
            source.text || "",
            now
          );

          const documentId = sourceDocumentProfileId(batchId, source.id);
          const fileHash = sourceDocumentFileHash(source);
          const contentHash = String(source.contentHash || source.rawObject?.contentHash || fileHash || "").trim();
          const sourceType = String(source.rawObject?.sourceType || source.kind || "").trim();
          persistSourceDocumentProfileStmt.run(
            documentId,
            batchId,
            source.id,
            source.rawObject?.objectId || "",
            fileHash,
            contentHash,
            source.rawObject?.originalFileName || source.name || "",
            source.path || source.rawObject?.originalRelativePath || "",
            sourceType,
            source.providerId || source.rawObject?.providerId || "",
            source.externalId || source.rawObject?.externalId || "",
            source.syncBatchId || source.rawObject?.syncBatchId || "",
            source.mediaType || source.rawObject?.mediaType || "",
            Number(source.rawObject?.byteSize || 0),
            source.capturedAt || source.rawObject?.capturedAt || "",
            source.sourceCreatedAt || source.rawObject?.sourceCreatedAt || "",
            source.sourceUpdatedAt || source.rawObject?.sourceUpdatedAt || "",
            source.sourceCollectedAt || source.rawObject?.sourceCollectedAt || "",
            DOCUMENT_PROFILE_VERSION,
            sourceDocumentMetadata(source),
            now,
            now
          );
          insertSourceDocumentFtsStmt.run(
            documentId,
            source.name || source.rawObject?.originalFileName || "",
            source.text || "",
            source.path || source.rawObject?.originalRelativePath || "",
            sourceType,
            [
              source.providerId || source.rawObject?.providerId || "",
              source.externalId || source.rawObject?.externalId || "",
              source.syncBatchId || source.rawObject?.syncBatchId || "",
              source.mediaType || source.rawObject?.mediaType || ""
            ].filter(Boolean).join(" ")
          );
        }

        updateBatchProgressStmt.run(
          "analyzing",
          now,
          sources.length,
          rawObjectCount,
          JSON.stringify(warnings || []),
          batchId
        );
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      rebuildSourceVocabulary({ rules });
    },
    persistPreprocessResult({ batchId, preprocessResult }) {
      const now = new Date().toISOString();
      const blocks = Array.isArray(preprocessResult?.blocks) ? preprocessResult.blocks : [];
      const chunks = Array.isArray(preprocessResult?.chunks) ? preprocessResult.chunks : [];
      db.exec("BEGIN");
      try {
        db.prepare("DELETE FROM preprocess_chunks WHERE batch_id = ?").run(batchId);
        db.prepare("DELETE FROM preprocess_blocks WHERE batch_id = ?").run(batchId);

        blocks.forEach((block, index) => {
          const blockId = String(block.id || "").trim();
          if (!blockId) {
            return;
          }
          insertPreprocessBlockStmt.run(
            scopedId(batchId, "preprocess-block", blockId),
            batchId,
            String(block.sourceId || "").trim(),
            blockId,
            String(block.kind || "").trim(),
            Number(block.level || 0),
            String(block.text || ""),
            asObjectJson({
              ...(block.metadata || {}),
              sourceName: block.sourceName || undefined
            }),
            Number(block.position || index + 1),
            now
          );
        });

        chunks.forEach((chunk, index) => {
          const chunkId = String(chunk.id || "").trim();
          if (!chunkId) {
            return;
          }
          insertPreprocessChunkStmt.run(
            scopedId(batchId, "preprocess-chunk", chunkId),
            batchId,
            String(chunk.sourceId || "").trim(),
            chunkId,
            String(chunk.title || "").trim(),
            asJson(Array.isArray(chunk.titlePath) ? chunk.titlePath : []),
            asJson(Array.isArray(chunk.blockIds) ? chunk.blockIds : []),
            String(chunk.chunkType || "").trim(),
            String(chunk.content || ""),
            Number(chunk.tokenCount || 0),
            asObjectJson({
              ...(chunk.metadata || {}),
              sourceName: chunk.sourceName || undefined,
              sourceCreatedAt: chunk.sourceCreatedAt || undefined,
              sourceUpdatedAt: chunk.sourceUpdatedAt || undefined,
              sourceCollectedAt: chunk.sourceCollectedAt || undefined
            }),
            Number(chunk.position || index + 1),
            now
          );
        });

        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    persistAnalysis({ batchId, result, warnings, rules, afterCorePersist }) {
      const now = new Date().toISOString();
      const sourceToRawObjectId = new Map(
        (result.sourceFiles || [])
          .filter((source) => source.rawObjectId)
          .map((source) => [source.id, source.rawObjectId])
      );
      const messageIdToRawObjectId = new Map(
        (result.emails || []).map((email) => [
          email.id,
          email.rawObjectId || sourceToRawObjectId.get(email.sourceId) || ""
        ])
      );

      db.exec("BEGIN");
      try {
        for (const person of result.people || []) {
          const recordId = scopedId(batchId, "person", person.id);
          insertPersonStmt.run(
            recordId,
            batchId,
            person.id,
            person.name,
            person.primaryEmail || "",
            asJson(person.aliases),
            person.organization,
            person.primaryDepartment || "",
            asJson(person.departments),
            person.relation,
            person.role,
            person.sentCount,
            person.receivedCount,
            person.ccCount,
            person.bccCount,
            person.transactionCount,
            person.firstSeenAt,
            person.lastSeenAt,
            asJson(person.topTopics),
            asJson(person.topCounterparties),
            person.summary,
            person.timeWeight,
            person.freshness,
            asBoolInt(person.formalUseAllowed)
          );
        }

        for (const email of result.emails || []) {
          const recordId = scopedId(batchId, "message", email.id);
          insertMessageStmt.run(
            recordId,
            batchId,
            email.id,
            email.sourceId,
            email.rawObjectId || sourceToRawObjectId.get(email.sourceId) || null,
            email.subject,
            email.normalizedSubject || "",
            email.sentAt,
            email.excerpt,
            email.body,
            asJson(email.keywords),
            asJson(email.chunkIds),
            email.messageIdHeader || "",
            email.inReplyTo || "",
            asJson(email.references),
            asJson(email.previousMessageIds),
            email.conversationKey || "",
            email.threadId || "",
            email.transactionId || "",
            asJson(email.participantIds),
            email.timeWeight,
            email.freshness,
            email.status,
            asBoolInt(email.formalUseAllowed)
          );

          const participantBuckets = [
            [email.from ? [email.from] : [], "from"],
            [email.to || [], "to"],
            [email.cc || [], "cc"],
            [email.bcc || [], "bcc"]
          ];

          for (const [participants, role] of participantBuckets) {
            participants.forEach((participant, index) => {
              insertMessageParticipantStmt.run(batchId, recordId, participant.id, role, index);
            });
          }
        }

        for (const thread of result.threads || []) {
          const threadRecordId = scopedId(batchId, "thread", thread.id);
          insertThreadStmt.run(
            threadRecordId,
            batchId,
            thread.id,
            thread.subject,
            thread.normalizedSubject || "",
            thread.summary,
            asJson(thread.messageIds),
            asJson(thread.participantIds),
            asJson(thread.senderIds),
            thread.startedAt,
            thread.latestActivityAt,
            asJson(thread.keywords),
            thread.status,
            thread.cadence,
            asJson(thread.categories),
            asJson(thread.pendingSignals),
            thread.transactionId || "",
            thread.timeWeight,
            thread.freshness,
            asBoolInt(thread.formalUseAllowed)
          );

          thread.messageIds.forEach((messageId, index) => {
            insertThreadMessageStmt.run(
              batchId,
              threadRecordId,
              scopedId(batchId, "message", messageId),
              index
            );
          });
        }

        for (const transaction of result.transactions || []) {
          const transactionRecordId = scopedId(batchId, "transaction", transaction.id);
          insertTransactionStmt.run(
            transactionRecordId,
            batchId,
            transaction.id,
            transaction.title,
            transaction.normalizedSubject || "",
            transaction.summary,
            transaction.status,
            transaction.startedAt,
            transaction.latestActivityAt,
            asJson(transaction.threadIds),
            asJson(transaction.messageIds),
            asJson(transaction.participantIds),
            asJson(transaction.timelineEventIds),
            asJson(transaction.keywords),
            asJson(transaction.decisions),
            asJson(transaction.pendingItems),
            transaction.cadence,
            asJson(transaction.categories),
            asJson(transaction.sourceDepartments),
            transaction.lineageId || "",
            transaction.lifecycle?.stage || "",
            transaction.lifecycle?.previousState || "",
            transaction.lifecycle?.nextState || "",
            Number(transaction.lifecycle?.matchScore || 0),
            asJson(transaction.lifecycle?.matchReasons),
            transaction.lifecycle?.matchedBatchId || "",
            transaction.lifecycle?.matchedTransactionId || "",
            Number(transaction.lifecycle?.pulledEventCount || 0),
            Number(transaction.lifecycle?.pulledBatchCount || 0),
            Number(transaction.lifecycle?.pulledTransactionCount || 0),
            transaction.sourceSpread,
            transaction.timeWeight,
            transaction.freshness,
            asBoolInt(transaction.formalUseAllowed)
          );

          transaction.threadIds.forEach((threadId, index) => {
            insertTransactionThreadStmt.run(
              batchId,
              transactionRecordId,
              scopedId(batchId, "thread", threadId),
              index
            );
          });
        }

        for (const event of result.timeline || []) {
          insertTimelineStmt.run(
            scopedId(batchId, "timeline", event.id),
            batchId,
            event.id,
            event.timestamp,
            event.title,
            event.summary,
            event.type,
            event.source,
            event.messageId || "",
            event.threadId || "",
            event.transactionId || "",
            event.lineageId || "",
            event.timelinePhase || "current",
            event.originBatchId || batchId,
            event.originTransactionId || event.transactionId || "",
            asJson(event.participantIds),
            event.timeWeight,
            event.freshness
          );
        }

        for (const item of result.retrieval?.items || []) {
          const searchTerms = textIndexingService.buildSearchTerms(
            [item.title, item.text, ...(item.keywords || [])].join("\n"),
            rules
          );
          insertRetrievalStmt.run(
            scopedId(batchId, "retrieval", item.id),
            batchId,
            item.id,
            item.entityType,
            item.entityType === "message"
              ? item.id.replace(/^retrieval::message::/, "")
              : item.entityType === "thread"
                ? item.id.replace(/^retrieval::thread::/, "")
                : item.entityType === "transaction"
                  ? item.id.replace(/^retrieval::transaction::/, "")
                  : item.id.replace(/^retrieval::person::/, ""),
            item.title,
            item.text,
            item.snippet,
            item.timestamp,
            item.source,
            asJson(item.keywords),
            asJson(item.participantIds),
            item.transactionId || "",
            item.threadId || "",
            item.entityType === "message"
              ? messageIdToRawObjectId.get(item.id.replace(/^retrieval::message::/, "")) || ""
              : "",
            item.timeWeight,
            item.freshness,
            item.status,
            asBoolInt(item.formalUseAllowed),
            item.reviewDueAt || "",
            asJson(searchTerms),
            now
          );
          insertRetrievalFtsStmt.run(
            scopedId(batchId, "retrieval", item.id),
            item.title,
            searchTerms.join(" "),
            item.source,
            (item.keywords || []).join(" ")
          );
        }

        if (typeof afterCorePersist === "function") {
          afterCorePersist({ batchId, result, now });
        }

        completeBatchStmt.run(
          now,
          JSON.stringify(warnings || []),
          JSON.stringify(result.overview || {}),
          result.emails?.length || 0,
          result.threads?.length || 0,
          result.transactions?.length || 0,
          result.people?.length || 0,
          result.retrieval?.items?.length || 0,
          batchId
        );

        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    markBatchFailed(batchId, errorMessage) {
      failBatchStmt.run(new Date().toISOString(), String(errorMessage || "执行失败"), batchId);
    },
    getRawMailObject(objectId) {
      return selectRawObjectStmt.get(objectId) || null;
    },
    listRawObjectStoragePathsByBatch(batchId) {
      return listRawObjectStoragePathsByBatchStmt
        .all(batchId)
        .map((row) => String(row.storage_rel_path || ""))
        .filter(Boolean);
    },
    hasBatch(batchId) {
      return Boolean(selectBatchExistsStmt.get(batchId));
    },
    getBatch(batchId) {
      return selectBatchStmt.get(batchId) || null;
    },
    searchSourceDocuments({ query = "", limit = 20 } = {}) {
      const matchQuery = sourceDocumentFtsQuery(query);
      if (!matchQuery) {
        return [];
      }
      const safeLimit = Math.max(1, Math.min(Number(limit || 20), 100));
      return searchSourceDocumentsStmt.all(matchQuery, safeLimit).map((row) => ({
        documentId: row.document_id,
        batchId: row.batch_id,
        sourceRef: row.source_ref,
        originalFileName: row.original_file_name,
        sourcePath: row.source_path,
        sourceType: row.source_type,
        providerId: row.provider_id,
        externalId: row.external_id,
        syncBatchId: row.sync_batch_id,
        mediaType: row.media_type,
        byteSize: row.byte_size,
        fileHash: row.file_hash,
        capturedAt: row.captured_at,
        lexicalRank: row.lexical_rank
      }));
    },
    listRawCorpusDocuments({ batchId = "", query = "", limit = 50 } = {}) {
      const safeLimit = Math.max(1, Math.min(Number(limit || 50), 500));
      const scopedBatchId = String(batchId || "").trim();
      const matchQuery = sourceDocumentFtsQuery(query);
      if (matchQuery) {
        const matched = searchRawCorpusDocumentsStmt
          .all(matchQuery, scopedBatchId, scopedBatchId, safeLimit)
          .map(rowToRawCorpusDocument)
          .filter((item) => String(item.text || "").trim());
        if (matched.length > 0) {
          return matched;
        }
      }
      return listRawCorpusDocumentsByBatchStmt
        .all(scopedBatchId, scopedBatchId, safeLimit)
        .map(rowToRawCorpusDocument)
        .filter((item) => String(item.text || "").trim());
    },
    listSourceVocabularyTermStatsByTerms(input = {}) {
      return listSourceVocabularyTermStatsByTerms(input);
    },
    getSignificantSourceTerms(input = {}) {
      return computeSignificantSourceTerms(input);
    },
    listSourceCorpusRawTerms,
    getKnowledgeWordCloudState,
    getKnowledgeWordBagTerms,
    saveKnowledgeWordCloudSet,
    exportKnowledgeWordCloudSet,
    importKnowledgeWordCloudSet,
    addKnowledgeWordBag,
    updateKnowledgeWordBag,
    deleteKnowledgeWordBag,
    getStorageSummary() {
      const counts = selectSummaryStmt.get() || {};
      return {
        batchCount: counts.batch_count || 0,
        rawObjectCount: counts.raw_object_count || 0,
        sourceCount: counts.source_count || 0,
        sourceDocumentProfileCount: counts.source_document_profile_count || 0,
        sourceCorpusRawTermCount: counts.source_corpus_raw_term_count || 0,
        sourceCorpusRawTotalFrequency: counts.source_corpus_raw_total_frequency || 0,
        sourceVocabularyTermCount: counts.source_vocabulary_term_count || 0,
        sourceVocabularyTotalFrequency: counts.source_vocabulary_total_frequency || 0,
        sourceVocabularyTotalDocumentFrequency: counts.source_vocabulary_total_document_frequency || 0,
        sourceVocabularyTotalBm25Weight: counts.source_vocabulary_total_bm25_weight || 0,
        sourceVocabularyBatchCount: counts.source_vocabulary_batch_count || 0,
        sourceVocabularyUniqueFileCount: counts.source_vocabulary_unique_file_count || 0,
        preprocessBlockCount: counts.preprocess_block_count || 0,
        preprocessChunkCount: counts.preprocess_chunk_count || 0,
        emailCount: counts.email_count || 0,
        threadCount: counts.thread_count || 0,
        transactionCount: counts.transaction_count || 0,
        lineageCount: counts.lineage_count || 0,
        lineageRunCount: counts.lineage_run_count || 0,
        clientCount: counts.client_count || 0,
        peopleCount: counts.people_count || 0,
        retrievalCount: counts.retrieval_count || 0
      };
    },
    deleteBatchRecords(batchId) {
      deleteBatchDataRecords(batchId);
      rebuildSourceVocabulary();
    },
    rebuildSourceVocabulary(input = {}) {
      return rebuildSourceVocabulary(input);
    },
    deleteBatchRow(batchId) {
      deleteBatchStmt.run(batchId);
    },
    upsertDeletionOperation({ batchId, jobId = "", status, state = {}, error = "", operationId = "" }) {
      const now = new Date().toISOString();
      const existing =
        (operationId && selectDeletionOperationByIdStmt.get(operationId)) ||
        selectDeletionOperationByBatchStmt.get(batchId);
      const nextOperationId = existing?.operation_id || operationId || randomUUID();
      insertDeletionOperationStmt.run(
        nextOperationId,
        batchId,
        jobId,
        status,
        JSON.stringify(state || {}),
        String(error || ""),
        existing?.created_at || now,
        now
      );
      return hydrateDeletionOperation(selectDeletionOperationByIdStmt.get(nextOperationId));
    },
    updateDeletionOperation(operationId, { status, state = {}, error = "" }) {
      updateDeletionOperationStmt.run(
        status,
        JSON.stringify(state || {}),
        String(error || ""),
        new Date().toISOString(),
        operationId
      );
      return hydrateDeletionOperation(selectDeletionOperationByIdStmt.get(operationId));
    },
    getDeletionOperationByBatchId(batchId) {
      return hydrateDeletionOperation(selectDeletionOperationByBatchStmt.get(batchId));
    },
    listPendingDeletionOperations() {
      return listDeletionOperationsStmt.all().map(hydrateDeletionOperation);
    },
    deleteDeletionOperation(operationId) {
      deleteDeletionOperationStmt.run(operationId);
    },
    getBatchArtifactPaths(batchId) {
      return {
        batchId,
        objectRootPath: getRawMailObjectRoot(userDataPath)
      };
    }
  };
}
