import { randomUUID } from "node:crypto";
import {
  PACTIUM_PROTOCOL,
  PACTIUM_SCHEMA_VERSION
} from "../protocol/constants.js";
import { protocolHash } from "../protocol/hashing.js";
import { normalizeCanonicalValue } from "../canonical/value.js";

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

/**
 * Append-only partition log persisted in protocol objects.
 * Hosts may override scope and hash domain; defaults are Pactium-neutral.
 */
export function createAppendOnlyEventLog({
  storage = null,
  protocolObjectScope = "pactium-event-log",
  hashDomain = "pactium.state-event",
  createEventId = null,
  withWriteLock = null
} = {}) {
  if (!storage || typeof storage.getProtocolObject !== "function") {
    throw new TypeError("createAppendOnlyEventLog requires a Pactium storage port.");
  }

  const resolveEventId = typeof createEventId === "function"
    ? createEventId
    : ({ partitionId, operationId }) => storageKey(
      "state-event",
      partitionId,
      operationId || "",
      nowIso(),
      randomUUID()
    );

  async function loadEvents(partitionId) {
    if (!storage.inMemory) storage.clearCache?.();
    return asArray(await storage.getProtocolObject(protocolObjectScope, storageKey("event-log", partitionId), []));
  }

  async function saveEvents(partitionId, events) {
    await storage.putProtocolObject(protocolObjectScope, storageKey("event-log", partitionId), events);
  }

  async function appendUnlocked(input = {}) {
    const partitionId = text(input.partitionId || input.scope, "default");
    const events = await loadEvents(partitionId);
    const previous = events.at(-1) || null;
    const event = {
      protocol: PACTIUM_PROTOCOL,
      schema: PACTIUM_SCHEMA_VERSION,
      eventId: resolveEventId({
        partitionId,
        operationId: text(input.operationId),
        offset: events.length
      }),
      partitionId,
      operationId: text(input.operationId),
      offset: events.length,
      beforeRoot: text(input.beforeRoot),
      afterRoot: text(input.afterRoot),
      contentRefs: asArray(input.contentRefs).map(text).filter(Boolean),
      payload: normalizeCanonicalValue(asObject(input.payload)),
      prevEventHash: previous?.eventHash || "",
      createdAt: nowIso()
    };
    event.eventHash = protocolHash(hashDomain, {
      ...event,
      eventHash: undefined
    });
    events.push(event);
    await saveEvents(partitionId, events);
    return event;
  }

  async function runExclusive(partitionId, task) {
    if (typeof withWriteLock === "function") {
      return withWriteLock(task, {
        name: `pactium-event-log-${storageKey("event-partition", partitionId)}`
      });
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
    async appendEvent(input = {}) {
      const partitionId = text(input.partitionId || input.scope, "default");
      return runExclusive(partitionId, () => appendUnlocked(input));
    },
    async listEvents(partitionId, { limit = 100 } = {}) {
      const events = await loadEvents(partitionId);
      return [...events].reverse().slice(0, Math.max(1, Math.min(Number(limit || 100), 10000)));
    },
    async getEvent(partitionId, offset) {
      const normalizedOffset = Number(offset);
      if (!Number.isSafeInteger(normalizedOffset) || normalizedOffset < 0) {
        return null;
      }
      const events = await loadEvents(partitionId);
      return events[normalizedOffset] || null;
    },
    async verifyPartition(partitionId) {
      const events = await loadEvents(partitionId);
      let previousHash = "";
      for (let index = 0; index < events.length; index += 1) {
        const event = events[index];
        const expectedHash = protocolHash(hashDomain, {
          ...event,
          eventHash: undefined
        });
        if (event.offset !== index || event.prevEventHash !== previousHash || event.eventHash !== expectedHash) {
          return {
            ok: false,
            partitionId: text(partitionId, "default"),
            eventCount: events.length,
            failedOffset: index
          };
        }
        previousHash = event.eventHash;
      }
      return {
        ok: true,
        partitionId: text(partitionId, "default"),
        eventCount: events.length
      };
    }
  });
}
