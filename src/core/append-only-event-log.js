import { randomUUID } from "node:crypto";
import { PACTIUM_PROTOCOL, PACTIUM_SCHEMA_VERSION } from "../protocol/constants.js";
import { protocolHash } from "../protocol/hashing.js";
import { normalizeCanonicalValue } from "../canonical/value.js";

const DEFAULT_SEGMENT_SIZE = 256;
const DEFAULT_MAX_SEGMENT_BYTES = 1024 * 1024;

function text(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function asObject(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function nowIso() {
  return new Date().toISOString();
}

function storageKey(...parts) {
  return parts.map((part) => text(part, "_")).join(":");
}

function positiveSegmentSize(value) {
  const normalized = Number(value);
  return Number.isSafeInteger(normalized) && normalized > 0 && normalized <= 4096
    ? normalized
    : DEFAULT_SEGMENT_SIZE;
}

/** Segmented append-only partition log with O(1) tail append and direct lookup. */
export function createAppendOnlyEventLog({
  storage = null,
  protocolObjectScope = "pactium-event-log",
  hashDomain = "pactium.state-event",
  createEventId = null,
  withWriteLock = null,
  segmentSize = DEFAULT_SEGMENT_SIZE,
  maxSegmentBytes = DEFAULT_MAX_SEGMENT_BYTES
} = {}) {
  if (!storage || typeof storage.getProtocolObject !== "function") {
    throw new TypeError("createAppendOnlyEventLog requires a Pactium storage port.");
  }
  const segmentLimit = positiveSegmentSize(segmentSize);
  const segmentByteLimit = Math.max(4096, Math.min(Number(maxSegmentBytes) || DEFAULT_MAX_SEGMENT_BYTES, 16 * 1024 * 1024));
  const resolveEventId = typeof createEventId === "function"
    ? createEventId
    : ({ partitionId, operationId }) => storageKey(
      "state-event", partitionId, operationId || "", nowIso(), randomUUID()
    );

  const metaKey = (partitionId) => storageKey("event-log-meta", partitionId);
  const segmentKey = (partitionId, index) => storageKey("event-log-segment", partitionId, index);
  const sequenceKey = (partitionId, offset) => storageKey("event-log-sequence", partitionId, offset);
  const eventIdKey = (partitionId, eventId) => storageKey("event-log-event-id", partitionId, eventId);

  async function loadMeta(partitionId) {
    if (!storage.inMemory) storage.clearCache?.();
    return asObject(await storage.getProtocolObject(protocolObjectScope, metaKey(partitionId), null), {
    format: "pactium.segmented-event-log",
      partitionId,
      segmentSize: segmentLimit,
      maxSegmentBytes: segmentByteLimit,
      eventCount: 0,
      segmentCount: 0,
      tailSegment: 0,
      tailBytes: 0,
      lastEventHash: ""
    });
  }

  async function loadSegment(partitionId, index) {
    return asArray(await storage.getProtocolObject(protocolObjectScope, segmentKey(partitionId, index), []));
  }

  async function appendBatchUnlocked(inputs = []) {
    if (inputs.length === 0) return [];
    const partitionId = text(inputs[0]?.partitionId || inputs[0]?.scope, "default");
    if (inputs.some((input) => text(input.partitionId || input.scope, "default") !== partitionId)) {
      throw new TypeError("appendEvents requires one partition per batch.");
    }
    const meta = await loadMeta(partitionId);
  if (meta.format !== "pactium.segmented-event-log" ||
        meta.segmentSize !== segmentLimit || meta.maxSegmentBytes !== segmentByteLimit) {
      throw new Error("Pactium event log format does not match the configured segmented format.");
    }
    let segmentIndex = Number(meta.tailSegment || 0);
    let segment = Number(meta.eventCount || 0) === 0 ? [] : await loadSegment(partitionId, segmentIndex);
    let segmentBytes = Number(meta.tailBytes || 0);
    let previousHash = text(meta.lastEventHash);
    const appended = [];
    for (const input of inputs) {
      const offset = Number(meta.eventCount) + appended.length;
      const event = {
        protocol: PACTIUM_PROTOCOL,
        schema: PACTIUM_SCHEMA_VERSION,
        eventId: resolveEventId({ partitionId, operationId: text(input.operationId), offset }),
        partitionId,
        operationId: text(input.operationId),
        offset,
        beforeRoot: text(input.beforeRoot),
        afterRoot: text(input.afterRoot),
        contentRefs: asArray(input.contentRefs).map((value) => text(value)).filter(Boolean),
        payload: normalizeCanonicalValue(asObject(input.payload)),
        prevEventHash: previousHash,
        createdAt: nowIso()
      };
      event.eventHash = protocolHash(hashDomain, { ...event, eventHash: undefined });
      const eventBytes = Buffer.byteLength(JSON.stringify(event));
      if (eventBytes > segmentByteLimit) {
        throw new RangeError("Pactium event exceeds the configured segment byte limit.");
      }
      if (segment.length > 0 && (segment.length >= segmentLimit || segmentBytes + eventBytes > segmentByteLimit)) {
        await storage.putProtocolObject(protocolObjectScope, segmentKey(partitionId, segmentIndex), segment);
        segmentIndex += 1;
        segment = [];
        segmentBytes = 0;
      }
      previousHash = event.eventHash;
      segment.push(event);
      segmentBytes += eventBytes;
      await storage.putProtocolObject(protocolObjectScope, sequenceKey(partitionId, offset), {
        segmentIndex,
        position: segment.length - 1
      });
      await storage.putProtocolObject(protocolObjectScope, eventIdKey(partitionId, event.eventId), {
        offset,
        segmentIndex,
        position: segment.length - 1
      });
      appended.push(event);
    }
    await storage.putProtocolObject(protocolObjectScope, segmentKey(partitionId, segmentIndex), segment);
    await storage.putProtocolObject(protocolObjectScope, metaKey(partitionId), {
      format: "pactium.segmented-event-log",
      partitionId,
      segmentSize: segmentLimit,
      maxSegmentBytes: segmentByteLimit,
      eventCount: Number(meta.eventCount) + appended.length,
      segmentCount: segmentIndex + 1,
      tailSegment: segmentIndex,
      tailBytes: segmentBytes,
      lastEventHash: previousHash
    });
    return appended;
  }

  async function runExclusive(partitionId, task) {
    if (typeof withWriteLock === "function") {
      return withWriteLock(task, { name: `pactium-event-log-${storageKey("event-partition", partitionId)}` });
    }
    if (typeof storage.withWriteLock === "function" && !storage.inMemory) {
      return storage.withWriteLock(task, {
        name: `pactium-event-log-${storageKey("event-partition", partitionId)}`,
        timeoutMs: 30_000
      });
    }
    return task();
  }

  return Object.freeze({
    protocolObjectScope,
    hashDomain,
    segmentSize: segmentLimit,
    maxSegmentBytes: segmentByteLimit,
    async appendEvent(input = {}) {
      const partitionId = text(input.partitionId || input.scope, "default");
      return runExclusive(partitionId, async () => (await appendBatchUnlocked([input]))[0]);
    },
    async appendEvents(inputs = []) {
      const normalized = asArray(inputs);
      if (normalized.length === 0) return [];
      const partitionId = text(normalized[0]?.partitionId || normalized[0]?.scope, "default");
      return runExclusive(partitionId, () => appendBatchUnlocked(normalized));
    },
    async listEvents(partitionId, { limit = 100 } = {}) {
      const normalizedPartition = text(partitionId, "default");
      const safeLimit = Math.max(1, Math.min(Number(limit || 100), 10000));
      const meta = await loadMeta(normalizedPartition);
      const output = [];
      const segments = new Map();
      for (let offset = Number(meta.eventCount || 0) - 1; offset >= 0 && output.length < safeLimit; offset -= 1) {
        const location = await storage.getProtocolObject(protocolObjectScope, sequenceKey(normalizedPartition, offset), null);
        if (!location) throw new Error("Pactium event sequence index is incomplete.");
        if (!segments.has(location.segmentIndex)) {
          segments.set(location.segmentIndex, await loadSegment(normalizedPartition, location.segmentIndex));
        }
        output.push(segments.get(location.segmentIndex)[location.position]);
      }
      return output;
    },
    async getEvent(partitionId, offset) {
      const normalizedOffset = Number(offset);
      if (!Number.isSafeInteger(normalizedOffset) || normalizedOffset < 0) return null;
      const normalizedPartition = text(partitionId, "default");
      const meta = await loadMeta(normalizedPartition);
      if (normalizedOffset >= Number(meta.eventCount || 0)) return null;
      const location = await storage.getProtocolObject(protocolObjectScope, sequenceKey(normalizedPartition, normalizedOffset), null);
      if (!location) return null;
      const segment = await loadSegment(normalizedPartition, location.segmentIndex);
      return segment[location.position] || null;
    },
    async getEventById(partitionId, eventId) {
      const normalizedPartition = text(partitionId, "default");
      const location = await storage.getProtocolObject(protocolObjectScope, eventIdKey(normalizedPartition, text(eventId)), null);
      if (!location) return null;
      const segment = await loadSegment(normalizedPartition, location.segmentIndex);
      return segment[location.position] || null;
    },
    async readPage(partitionId, { afterOffset = -1, limit = 100 } = {}) {
      const normalizedPartition = text(partitionId, "default");
      const meta = await loadMeta(normalizedPartition);
      const safeLimit = Math.max(1, Math.min(Number(limit || 100), 10000));
      const events = [];
      for (let offset = Math.max(0, Number(afterOffset) + 1); offset < Number(meta.eventCount || 0) && events.length < safeLimit; offset += 1) {
        events.push(await this.getEvent(normalizedPartition, offset));
      }
      return { events, nextOffset: events.at(-1)?.offset ?? Number(afterOffset), eventCount: Number(meta.eventCount || 0) };
    },
    async verifyPartition(partitionId) {
      const normalizedPartition = text(partitionId, "default");
      const meta = await loadMeta(normalizedPartition);
      let previousHash = "";
      let verified = 0;
      for (let segmentIndex = 0; segmentIndex < Number(meta.segmentCount || 0); segmentIndex += 1) {
        const segment = await loadSegment(normalizedPartition, segmentIndex);
        for (const event of segment) {
          const expectedHash = protocolHash(hashDomain, { ...event, eventHash: undefined });
          if (event.offset !== verified || event.prevEventHash !== previousHash || event.eventHash !== expectedHash) {
            return { ok: false, partitionId: normalizedPartition, eventCount: Number(meta.eventCount || 0), failedOffset: verified };
          }
          previousHash = event.eventHash;
          verified += 1;
        }
      }
      return {
        ok: verified === Number(meta.eventCount || 0) && previousHash === text(meta.lastEventHash),
        partitionId: normalizedPartition,
        eventCount: Number(meta.eventCount || 0)
      };
    }
  });
}
