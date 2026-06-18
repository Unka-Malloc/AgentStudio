import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { pactiumToken, resolveDataDir, resolveWithin } from "./paths.js";

export const MERKLE_STATE_SUBSTRATE_PROTOCOL_VERSION = "v0.1.0:pactium:merkle-state-substrate-1";

const EMPTY_INDEX_NAMESPACE = "default";

function nowIso() {
  return new Date().toISOString();
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function uniqueStrings(values = []) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function normalizeString(value) {
  return String(value || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function normalizePathKey(value) {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^\/+|\/+$/g, "");
}

function canonicalValue(value) {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return {
      $bytes: Buffer.from(value).toString("base64")
    };
  }
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string") {
    return normalizeString(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return null;
    }
    return value;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalValue);
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .filter((key) => value[key] !== undefined)
        .sort()
        .map((key) => [key, canonicalValue(value[key])])
    );
  }
  return String(value);
}

function stableJson(value) {
  const normalized = canonicalValue(value);
  if (normalized === null || normalized === undefined) {
    return "null";
  }
  if (Array.isArray(normalized)) {
    return `[${normalized.map((item) => stableJson(item)).join(",")}]`;
  }
  if (typeof normalized === "object") {
    return `{${Object.keys(normalized)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(normalized[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(normalized);
}

function sha256Buffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function sha256Canonical(value) {
  return sha256Buffer(Buffer.from(stableJson(value), "utf8"));
}

function cidForBytes(bytes) {
  return `cid:sha256:${sha256Buffer(bytes)}`;
}

function cidToFileName(cid) {
  const text = String(cid || "");
  const hash = text.startsWith("cid:sha256:") ? text.slice("cid:sha256:".length) : sha256Canonical(text);
  return `${hash}.json`;
}

function safePartitionId(value) {
  return String(value || "default")
    .trim()
    .replace(/[^a-zA-Z0-9._:-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 180) || "default";
}

function substrateRoot(userDataPath) {
  return resolveWithin(resolveDataDir(userDataPath), "state-substrate");
}

function blockPath(userDataPath, cid) {
  const fileName = cidToFileName(cid);
  return resolveWithin(substrateRoot(userDataPath), "blocks", fileName.slice(0, 2), fileName);
}

function eventLogPath(userDataPath, partitionId) {
  return resolveWithin(substrateRoot(userDataPath), "events", `${safePartitionId(partitionId)}.jsonl`);
}

function eventFrontierPath(userDataPath, partitionId) {
  return resolveWithin(substrateRoot(userDataPath), "events", `${safePartitionId(partitionId)}.frontier.json`);
}

function scopeStatePath(userDataPath, scope) {
  return resolveWithin(substrateRoot(userDataPath), "state-commits", "scopes", `${safePartitionId(scope)}.json`);
}

function commitPath(userDataPath, commitId) {
  return resolveWithin(substrateRoot(userDataPath), "state-commits", "commits", `${safePartitionId(commitId)}.json`);
}

function ingestSessionRoot(userDataPath, sessionId) {
  return resolveWithin(substrateRoot(userDataPath), "ingest", "sessions", safePartitionId(sessionId));
}

function ingestSegmentRoot(userDataPath) {
  return resolveWithin(substrateRoot(userDataPath), "ingest", "segments");
}

async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

async function writeJsonAtomic(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(tmpPath, filePath);
}

async function appendJsonLine(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, `${JSON.stringify(value)}\n`, "utf8");
}

async function readJsonLines(filePath) {
  try {
    const text = await fs.readFile(filePath, "utf8");
    return text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

function createCanonicalCodec() {
  return Object.freeze({
    protocolVersion: MERKLE_STATE_SUBSTRATE_PROTOCOL_VERSION,
    encode(value, codec = "dag-json") {
      if (codec === "raw") {
        return Buffer.isBuffer(value) ? value : Buffer.from(String(value ?? ""), "utf8");
      }
      return Buffer.from(stableJson(value), "utf8");
    },
    decode(bytes, codec = "dag-json") {
      const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || "");
      if (codec === "raw") {
        return buffer;
      }
      return JSON.parse(buffer.toString("utf8"));
    },
    hash(value, codec = "dag-json", algorithm = "sha256") {
      const bytes = this.encode(value, codec);
      return `${algorithm}:${crypto.createHash(algorithm).update(bytes).digest("hex")}`;
    },
    normalize(value) {
      return canonicalValue(value);
    },
    stableJson(value) {
      return stableJson(value);
    }
  });
}

function createContentAddressedStore({ userDataPath = "", codec = createCanonicalCodec() } = {}) {
  async function putBlock(bytesOrValue, metadata = {}) {
    const blockCodec = String(metadata.codec || (Buffer.isBuffer(bytesOrValue) || bytesOrValue instanceof Uint8Array ? "raw" : "dag-json"));
    const bytes = blockCodec === "raw"
      ? Buffer.from(bytesOrValue || "")
      : codec.encode(bytesOrValue, blockCodec);
    const cid = cidForBytes(bytes);
    const refs = uniqueStrings(metadata.refs || bytesOrValue?.refs || []);
    const record = {
      protocolVersion: MERKLE_STATE_SUBSTRATE_PROTOCOL_VERSION,
      cid,
      codec: blockCodec,
      payloadHash: `sha256:${sha256Buffer(bytes)}`,
      byteLength: bytes.length,
      refs,
      metadata: asObject(metadata.metadata || metadata),
      createdAt: nowIso(),
      payloadBase64: bytes.toString("base64")
    };
    const targetPath = blockPath(userDataPath, cid);
    const existing = await readJson(targetPath);
    if (existing) {
      if (existing.payloadHash !== record.payloadHash || existing.payloadBase64 !== record.payloadBase64) {
        throw new Error(`CAS cid collision or attempted overwrite: ${cid}`);
      }
      return {
        ...existing,
        deduped: true
      };
    }
    await writeJsonAtomic(targetPath, record);
    return {
      ...record,
      deduped: false
    };
  }

  async function getBlock(cid) {
    const record = await readJson(blockPath(userDataPath, cid));
    if (!record) {
      return null;
    }
    const bytes = Buffer.from(String(record.payloadBase64 || ""), "base64");
    if (`sha256:${sha256Buffer(bytes)}` !== record.payloadHash) {
      throw new Error(`CAS block hash mismatch: ${cid}`);
    }
    return {
      ...record,
      bytes
    };
  }

  async function hasBlock(cid) {
    return Boolean(await readJson(blockPath(userDataPath, cid)));
  }

  async function walk(rootCid) {
    const seen = new Set();
    const missing = [];
    const blocks = [];
    const stack = [String(rootCid || "").trim()].filter(Boolean);
    while (stack.length > 0) {
      const cid = stack.pop();
      if (!cid || seen.has(cid)) {
        continue;
      }
      seen.add(cid);
      const block = await getBlock(cid);
      if (!block) {
        missing.push(cid);
        continue;
      }
      blocks.push(block);
      for (const ref of asArray(block.refs).reverse()) {
        if (!seen.has(ref)) {
          stack.push(ref);
        }
      }
    }
    return {
      rootCid,
      blockCount: blocks.length,
      missing,
      blocks
    };
  }

  return Object.freeze({
    protocolVersion: MERKLE_STATE_SUBSTRATE_PROTOCOL_VERSION,
    putBlock,
    getBlock,
    hasBlock,
    listMissing(rootCid) {
      return walk(rootCid).then((result) => result.missing);
    },
    walk,
    async pin(rootCid, policy = {}) {
      const pin = {
        rootCid,
        policy: asObject(policy),
        pinnedAt: nowIso()
      };
      await writeJsonAtomic(resolveWithin(substrateRoot(userDataPath), "pins", `${cidToFileName(rootCid)}`), pin);
      return pin;
    },
    async gc() {
      return {
        protocolVersion: MERKLE_STATE_SUBSTRATE_PROTOCOL_VERSION,
        collected: 0,
        policy: "pins-only-not-implemented"
      };
    }
  });
}

function createMerkleDag({ cas }) {
  return Object.freeze({
    protocolVersion: MERKLE_STATE_SUBSTRATE_PROTOCOL_VERSION,
    async buildManifest(kind, entries = [], metadata = {}) {
      const normalizedEntries = asArray(entries)
        .map((entry) => ({
          key: normalizePathKey(entry.key || entry.path || entry.relativePath || entry.name || ""),
          cid: String(entry.cid || entry.rootCid || entry.valueRoot || "").trim(),
          byteLength: Number(entry.byteLength || entry.sizeBytes || 0),
          metadata: asObject(entry.metadata)
        }))
        .filter((entry) => entry.key && entry.cid)
        .sort((left, right) => left.key.localeCompare(right.key));
      const manifest = {
        type: "v0.0.1:storage:merkle-dag-manifest-1",
        kind: String(kind || "generic"),
        entries: normalizedEntries,
        refs: uniqueStrings(normalizedEntries.map((entry) => entry.cid)),
        metadataHash: `sha256:${sha256Canonical(metadata)}`,
        metadata: asObject(metadata)
      };
      const block = await cas.putBlock(manifest, {
        codec: "dag-json",
        refs: manifest.refs,
        metadata: {
          kind: "manifest",
          manifestKind: manifest.kind
        }
      });
      return {
        protocolVersion: MERKLE_STATE_SUBSTRATE_PROTOCOL_VERSION,
        rootCid: block.cid,
        kind: manifest.kind,
        refs: manifest.refs,
        entries: normalizedEntries,
        metadataHash: manifest.metadataHash
      };
    },
    walk(rootCid) {
      return cas.walk(rootCid);
    },
    async verify(rootCid) {
      const result = await cas.walk(rootCid);
      return {
        protocolVersion: MERKLE_STATE_SUBSTRATE_PROTOCOL_VERSION,
        rootCid,
        ok: result.missing.length === 0,
        missing: result.missing,
        blockCount: result.blockCount
      };
    },
    async diff(leftRoot, rightRoot) {
      const [left, right] = await Promise.all([cas.walk(leftRoot), cas.walk(rightRoot)]);
      const leftSet = new Set(left.blocks.map((block) => block.cid));
      const rightSet = new Set(right.blocks.map((block) => block.cid));
      return {
        protocolVersion: MERKLE_STATE_SUBSTRATE_PROTOCOL_VERSION,
        added: [...rightSet].filter((cid) => !leftSet.has(cid)).sort(),
        removed: [...leftSet].filter((cid) => !rightSet.has(cid)).sort(),
        missing: [...new Set([...left.missing, ...right.missing])].sort()
      };
    }
  });
}

function createMerkleIndex({ cas, codec = createCanonicalCodec() }) {
  async function readIndex(indexRootCid) {
    if (!indexRootCid) {
      return {
        type: "v0.0.1:storage:merkle-index-sorted-1",
        namespace: EMPTY_INDEX_NAMESPACE,
        entries: []
      };
    }
    const block = await cas.getBlock(indexRootCid);
    if (!block) {
      throw new Error(`index root missing: ${indexRootCid}`);
    }
    return codec.decode(block.bytes, block.codec);
  }

  async function writeIndex(index) {
    const entries = asArray(index.entries)
      .map((entry) => ({
        key: normalizePathKey(entry.key),
        valueRef: String(entry.valueRef || "").trim(),
        metadata: asObject(entry.metadata)
      }))
      .filter((entry) => entry.key)
      .sort((left, right) => left.key.localeCompare(right.key));
    const normalized = {
      type: "v0.0.1:storage:merkle-index-sorted-1",
      namespace: String(index.namespace || EMPTY_INDEX_NAMESPACE),
      entries,
      keyRange: {
        min: entries[0]?.key || "",
        max: entries[entries.length - 1]?.key || ""
      },
      refs: uniqueStrings(entries.map((entry) => entry.valueRef))
    };
    const block = await cas.putBlock(normalized, {
      codec: "dag-json",
      refs: normalized.refs,
      metadata: {
        kind: "merkle-index",
        namespace: normalized.namespace
      }
    });
    return {
      protocolVersion: MERKLE_STATE_SUBSTRATE_PROTOCOL_VERSION,
      indexRootCid: block.cid,
      indexKind: "sorted-chunk-v1",
      namespace: normalized.namespace,
      keyRange: normalized.keyRange,
      count: entries.length
    };
  }

  return Object.freeze({
    protocolVersion: MERKLE_STATE_SUBSTRATE_PROTOCOL_VERSION,
    create(namespace = EMPTY_INDEX_NAMESPACE, entries = []) {
      return writeIndex({ namespace, entries });
    },
    async get(indexRootCid, key) {
      const index = await readIndex(indexRootCid);
      const normalizedKey = normalizePathKey(key);
      return asArray(index.entries).find((entry) => entry.key === normalizedKey) || null;
    },
    async put(indexRootCid, key, valueRef, metadata = {}) {
      const index = await readIndex(indexRootCid);
      const normalizedKey = normalizePathKey(key);
      const entries = asArray(index.entries).filter((entry) => entry.key !== normalizedKey);
      entries.push({
        key: normalizedKey,
        valueRef: String(valueRef || "").trim(),
        metadata: asObject(metadata)
      });
      return writeIndex({
        ...index,
        entries
      });
    },
    async delete(indexRootCid, key) {
      const index = await readIndex(indexRootCid);
      const normalizedKey = normalizePathKey(key);
      return writeIndex({
        ...index,
        entries: asArray(index.entries).filter((entry) => entry.key !== normalizedKey)
      });
    },
    async scan(indexRootCid, range = {}) {
      const index = await readIndex(indexRootCid);
      const min = normalizePathKey(range.min || "");
      const max = normalizePathKey(range.max || "\uffff");
      const limit = Math.max(1, Math.min(Number(range.limit || 500), 5000));
      return asArray(index.entries)
        .filter((entry) => entry.key >= min && entry.key <= max)
        .slice(0, limit);
    },
    async prefix(indexRootCid, prefix = "") {
      const index = await readIndex(indexRootCid);
      const normalizedPrefix = normalizePathKey(prefix);
      return asArray(index.entries).filter((entry) =>
        normalizedPrefix ? entry.key === normalizedPrefix || entry.key.startsWith(`${normalizedPrefix}/`) : true
      );
    },
    async diff(leftRoot, rightRoot) {
      const [left, right] = await Promise.all([readIndex(leftRoot), readIndex(rightRoot)]);
      const leftMap = new Map(asArray(left.entries).map((entry) => [entry.key, entry]));
      const rightMap = new Map(asArray(right.entries).map((entry) => [entry.key, entry]));
      const keys = [...new Set([...leftMap.keys(), ...rightMap.keys()])].sort();
      return keys
        .map((key) => {
          const before = leftMap.get(key) || null;
          const after = rightMap.get(key) || null;
          const changed = stableJson(before) !== stableJson(after);
          return changed
            ? {
                key,
                action: before && after ? "update" : before ? "delete" : "create",
                before,
                after
              }
            : null;
        })
        .filter(Boolean);
    },
    async prove(indexRootCid, key) {
      const entry = await this.get(indexRootCid, key);
      return {
        protocolVersion: MERKLE_STATE_SUBSTRATE_PROTOCOL_VERSION,
        indexRootCid,
        key: normalizePathKey(key),
        exists: Boolean(entry),
        valueRef: entry?.valueRef || "",
        proofHash: `sha256:${sha256Canonical({ indexRootCid, key: normalizePathKey(key), entry })}`
      };
    }
  });
}

function createPartitionedEventLog({ userDataPath = "" } = {}) {
  async function appendEvent(input = {}) {
    const partitionId = safePartitionId(input.partitionId || input.scope || "default");
    const frontier = await readJson(eventFrontierPath(userDataPath, partitionId), {
      offset: -1,
      eventHash: ""
    });
    const offset = Number(frontier.offset || -1) + 1;
    const recordBase = {
      protocolVersion: MERKLE_STATE_SUBSTRATE_PROTOCOL_VERSION,
      eventId: String(input.eventId || pactiumToken("state_event", partitionId, offset, crypto.randomUUID())),
      partitionId,
      offset,
      prevEventHash: String(frontier.eventHash || ""),
      operationId: String(input.operationId || ""),
      beforeRoot: String(input.beforeRoot || ""),
      afterRoot: String(input.afterRoot || ""),
      contentRefs: uniqueStrings(input.contentRefs),
      payload: asObject(input.payload),
      createdAt: input.createdAt || nowIso()
    };
    const eventHash = `sha256:${sha256Canonical(recordBase)}`;
    const record = {
      ...recordBase,
      eventHash
    };
    await appendJsonLine(eventLogPath(userDataPath, partitionId), record);
    await writeJsonAtomic(eventFrontierPath(userDataPath, partitionId), {
      partitionId,
      offset,
      eventHash,
      updatedAt: record.createdAt
    });
    return record;
  }

  async function listEvents(partitionId, { limit = 500 } = {}) {
    const records = await readJsonLines(eventLogPath(userDataPath, partitionId));
    return records.slice(-Math.max(1, Math.min(Number(limit || 500), 5000)));
  }

  async function verifyPartition(partitionId) {
    const records = await readJsonLines(eventLogPath(userDataPath, partitionId));
    let previousHash = "";
    for (const [index, record] of records.entries()) {
      const { eventHash, ...recordBase } = record;
      const expectedHash = `sha256:${sha256Canonical(recordBase)}`;
      if (Number(record.offset) !== index || record.prevEventHash !== previousHash || eventHash !== expectedHash) {
        return {
          ok: false,
          partitionId: safePartitionId(partitionId),
          failedOffset: index,
          expectedHash,
          actualHash: eventHash || "",
          previousHash
        };
      }
      previousHash = eventHash;
    }
    return {
      ok: true,
      partitionId: safePartitionId(partitionId),
      eventCount: records.length,
      frontier: previousHash
    };
  }

  return Object.freeze({
    protocolVersion: MERKLE_STATE_SUBSTRATE_PROTOCOL_VERSION,
    appendEvent,
    listEvents,
    verifyPartition
  });
}

function createStateCommitPort({ userDataPath = "", merkleIndex, eventLog } = {}) {
  async function loadScope(scope) {
    return readJson(scopeStatePath(userDataPath, scope), {
      scope,
      currentRoot: "",
      currentCommitId: "",
      parentCommitIds: []
    });
  }

  async function commit(input = {}) {
    const scope = safePartitionId(input.scope || input.workspaceId || "default");
    const current = await loadScope(scope);
    let afterRoot = current.currentRoot || "";
    for (const mutation of asArray(input.mutations)) {
      const action = String(mutation.action || "put");
      if (action === "delete") {
        const next = await merkleIndex.delete(afterRoot, mutation.key);
        afterRoot = next.indexRootCid;
      } else {
        const next = await merkleIndex.put(afterRoot, mutation.key, mutation.valueRef, mutation.metadata);
        afterRoot = next.indexRootCid;
      }
    }
    if (!afterRoot && input.afterRoot) {
      afterRoot = String(input.afterRoot || "");
    }
    const event = await eventLog.appendEvent({
      partitionId: scope,
      operationId: input.operationId || "",
      beforeRoot: current.currentRoot || "",
      afterRoot,
      contentRefs: input.contentRefs,
      payload: asObject(input.payload)
    });
    const commitBase = {
      protocolVersion: MERKLE_STATE_SUBSTRATE_PROTOCOL_VERSION,
      parentCommitIds: current.currentCommitId ? [current.currentCommitId] : [],
      operationId: String(input.operationId || ""),
      scope,
      eventHash: event.eventHash,
      beforeRoot: current.currentRoot || "",
      afterRoot,
      contentRefs: uniqueStrings(input.contentRefs),
      indexRoots: {
        [scope]: afterRoot
      },
      createdAt: nowIso()
    };
    const commitId = `state_commit_${sha256Canonical(commitBase).slice(0, 40)}`;
    const record = {
      ...commitBase,
      commitId
    };
    await writeJsonAtomic(commitPath(userDataPath, commitId), record);
    await writeJsonAtomic(scopeStatePath(userDataPath, scope), {
      scope,
      currentRoot: afterRoot,
      currentCommitId: commitId,
      parentCommitIds: record.parentCommitIds,
      updatedAt: record.createdAt
    });
    return record;
  }

  async function verifyCommit(commitId) {
    const record = await readJson(commitPath(userDataPath, commitId));
    if (!record) {
      return {
        ok: false,
        error: "commit_missing",
        commitId
      };
    }
    const partition = await eventLog.verifyPartition(record.scope);
    const missing = record.afterRoot ? await merkleIndex.prefix(record.afterRoot, "").then(() => []) : [];
    return {
      protocolVersion: MERKLE_STATE_SUBSTRATE_PROTOCOL_VERSION,
      ok: partition.ok && missing.length === 0,
      commit: record,
      partition,
      missing
    };
  }

  return Object.freeze({
    protocolVersion: MERKLE_STATE_SUBSTRATE_PROTOCOL_VERSION,
    begin(operation = {}) {
      return loadScope(operation.scope || operation.workspaceId || "default");
    },
    commit,
    verifyCommit
  });
}

function chunkRecordKey(record = {}) {
  return [
    `upload:${safePartitionId(record.uploadSessionId || "")}`,
    `file:${safePartitionId(record.fileId || record.relativePath || "file")}`,
    `chunk:${String(Number(record.chunkIndex || 0)).padStart(12, "0")}`
  ].join("/");
}

function createLsmIngestPort({ userDataPath = "", cas, merkleDag } = {}) {
  async function sessionMeta(sessionId) {
    return readJson(resolveWithin(ingestSessionRoot(userDataPath, sessionId), "session.json"));
  }

  async function beginUploadSession(input = {}) {
    const timestamp = nowIso();
    const scope = safePartitionId(input.scope || input.workspaceId || "workspace");
    const uploadSessionId = String(input.uploadSessionId || pactiumToken("upload_session", scope, timestamp, crypto.randomUUID()));
    const session = {
      protocolVersion: MERKLE_STATE_SUBSTRATE_PROTOCOL_VERSION,
      uploadSessionId,
      scope,
      status: "staged",
      files: asArray(input.files),
      createdAt: timestamp,
      updatedAt: timestamp
    };
    await writeJsonAtomic(resolveWithin(ingestSessionRoot(userDataPath, uploadSessionId), "session.json"), session);
    return {
      ...session,
      nextOffset: 0
    };
  }

  async function appendChunkRecord(sessionId, record = {}) {
    const session = await sessionMeta(sessionId);
    if (!session) {
      throw new Error(`upload session missing: ${sessionId}`);
    }
    const chunkCid = String(record.chunkCid || record.cid || "").trim();
    if (!chunkCid || !(await cas.hasBlock(chunkCid))) {
      throw new Error("chunkCid must reference an existing CAS block.");
    }
    const normalized = {
      protocolVersion: MERKLE_STATE_SUBSTRATE_PROTOCOL_VERSION,
      uploadSessionId: session.uploadSessionId,
      scope: session.scope,
      fileId: String(record.fileId || record.relativePath || record.path || "file"),
      relativePath: normalizePathKey(record.relativePath || record.path || record.fileId || "file"),
      chunkIndex: Number(record.chunkIndex || 0),
      offset: Number(record.offset || 0),
      byteLength: Number(record.byteLength || 0),
      chunkCid,
      chunkHash: String(record.chunkHash || record.payloadHash || ""),
      receivedAt: record.receivedAt || nowIso()
    };
    await appendJsonLine(resolveWithin(ingestSessionRoot(userDataPath, sessionId), "wal.jsonl"), normalized);
    await writeJsonAtomic(resolveWithin(ingestSessionRoot(userDataPath, sessionId), "session.json"), {
      ...session,
      updatedAt: nowIso()
    });
    return normalized;
  }

  async function recoverSession(sessionId) {
    const session = await sessionMeta(sessionId);
    if (!session) {
      return null;
    }
    const records = await readJsonLines(resolveWithin(ingestSessionRoot(userDataPath, sessionId), "wal.jsonl"));
    const sorted = records.sort((left, right) => chunkRecordKey(left).localeCompare(chunkRecordKey(right)));
    return {
      ...session,
      status: records.length > 0 ? "staged" : session.status,
      recordCount: sorted.length,
      records: sorted,
      nextOffset: sorted.reduce((max, record) => Math.max(max, Number(record.offset || 0) + Number(record.byteLength || 0)), 0)
    };
  }

  async function flushMemTable(sessionId) {
    const recovered = await recoverSession(sessionId);
    if (!recovered) {
      throw new Error(`upload session missing: ${sessionId}`);
    }
    const records = recovered.records;
    const keys = records.map(chunkRecordKey).sort();
    const segmentPayload = {
      type: "v0.0.1:storage:lsm-ingest-segment-1",
      uploadSessionId: recovered.uploadSessionId,
      scope: recovered.scope,
      records: records.map((record) => ({
        ...record,
        key: chunkRecordKey(record)
      }))
    };
    const block = await cas.putBlock(segmentPayload, {
      codec: "dag-json",
      refs: uniqueStrings(records.map((record) => record.chunkCid)),
      metadata: {
        kind: "ingest-segment",
        scope: recovered.scope
      }
    });
    const segment = {
      protocolVersion: MERKLE_STATE_SUBSTRATE_PROTOCOL_VERSION,
      segmentId: `ingest_segment_${sha256Canonical(segmentPayload).slice(0, 40)}`,
      uploadSessionId: recovered.uploadSessionId,
      scope: recovered.scope,
      level: 0,
      minKey: keys[0] || "",
      maxKey: keys[keys.length - 1] || "",
      recordCount: records.length,
      rootCid: block.cid,
      sealedAt: nowIso()
    };
    await writeJsonAtomic(resolveWithin(ingestSegmentRoot(userDataPath), `${segment.segmentId}.json`), segment);
    return segment;
  }

  async function materializeManifest(sessionId) {
    const recovered = await recoverSession(sessionId);
    if (!recovered) {
      throw new Error(`upload session missing: ${sessionId}`);
    }
    return merkleDag.buildManifest(
      "workspace-upload",
      recovered.records.map((record) => ({
        key: `${record.relativePath}#${String(record.chunkIndex).padStart(12, "0")}`,
        cid: record.chunkCid,
        byteLength: record.byteLength,
        metadata: {
          offset: record.offset,
          fileId: record.fileId
        }
      })),
      {
        uploadSessionId: sessionId,
        scope: recovered.scope
      }
    );
  }

  async function compactSegments(scope = "") {
    const root = ingestSegmentRoot(userDataPath);
    await fs.mkdir(root, { recursive: true });
    const entries = await fs.readdir(root, { withFileTypes: true });
    const segments = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        continue;
      }
      const segment = await readJson(path.join(root, entry.name));
      if (segment && (!scope || segment.scope === safePartitionId(scope))) {
        segments.push(segment);
      }
    }
    const records = [];
    for (const segment of segments) {
      const block = await cas.getBlock(segment.rootCid);
      if (!block) {
        throw new Error(`segment root missing: ${segment.rootCid}`);
      }
      const payload = JSON.parse(block.bytes.toString("utf8"));
      records.push(...asArray(payload.records));
    }
    const compactedPayload = {
      type: "v0.0.1:storage:lsm-ingest-compacted-segment-1",
      scope: safePartitionId(scope || segments[0]?.scope || "workspace"),
      records: records.sort((left, right) => String(left.key || chunkRecordKey(left)).localeCompare(String(right.key || chunkRecordKey(right)))),
      sourceSegmentIds: segments.map((segment) => segment.segmentId).sort()
    };
    const block = await cas.putBlock(compactedPayload, {
      codec: "dag-json",
      refs: uniqueStrings(records.map((record) => record.chunkCid)),
      metadata: {
        kind: "ingest-compacted-segment",
        scope: compactedPayload.scope
      }
    });
    return {
      protocolVersion: MERKLE_STATE_SUBSTRATE_PROTOCOL_VERSION,
      segmentId: `ingest_segment_${sha256Canonical(compactedPayload).slice(0, 40)}`,
      scope: compactedPayload.scope,
      level: Math.max(1, ...segments.map((segment) => Number(segment.level || 0) + 1)),
      minKey: compactedPayload.records[0]?.key || "",
      maxKey: compactedPayload.records[compactedPayload.records.length - 1]?.key || "",
      recordCount: compactedPayload.records.length,
      rootCid: block.cid,
      sourceSegmentIds: compactedPayload.sourceSegmentIds,
      sealedAt: nowIso()
    };
  }

  return Object.freeze({
    protocolVersion: MERKLE_STATE_SUBSTRATE_PROTOCOL_VERSION,
    beginUploadSession,
    appendChunkRecord,
    flushMemTable,
    compactSegments,
    recoverSession,
    materializeManifest
  });
}

export function createMerkleStateSubstrate({ dataDir = "", userDataPath = "" } = {}) {
  const resolvedDataDir = resolveDataDir(dataDir || userDataPath);
  const codec = createCanonicalCodec();
  const cas = createContentAddressedStore({ userDataPath: resolvedDataDir, codec });
  const merkleDag = createMerkleDag({ cas });
  const merkleIndex = createMerkleIndex({ cas, codec });
  const eventLog = createPartitionedEventLog({ userDataPath: resolvedDataDir });
  const stateCommit = createStateCommitPort({ userDataPath: resolvedDataDir, merkleIndex, eventLog });
  const lsmIngest = createLsmIngestPort({ userDataPath: resolvedDataDir, cas, merkleDag });
  return Object.freeze({
    protocolVersion: MERKLE_STATE_SUBSTRATE_PROTOCOL_VERSION,
    dataDir: resolvedDataDir,
    canonicalCodec: codec,
    cas,
    merkleDag,
    merkleIndex,
    eventLog,
    stateCommit,
    lsmIngest,
    listCapabilities() {
      return {
        protocolVersion: MERKLE_STATE_SUBSTRATE_PROTOCOL_VERSION,
        capabilities: [
          "canonical-codec",
          "content-addressed-store",
          "merkle-dag",
          "merkle-index",
          "partitioned-event-log",
          "state-commit",
          "lsm-ingest"
        ]
      };
    }
  });
}
