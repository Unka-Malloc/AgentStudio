import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { canonicalEncode } from "../../src/canonical/value.js";
import { createAppendOnlyEventLog } from "../../src/core/append-only-event-log.js";
import { createContentAddressedStore } from "../../src/core/content-addressed-store.js";
import { createStateCommitStore } from "../../src/core/state-commit-store.js";
import { cacheGet, cacheSet, createWeightedLruCache } from "../../src/shared/lru-cache.js";
import {
  decodeStoragePayload,
  encodeStoragePayload,
  STORAGE_COMPRESSION_BROTLI_V1,
  STORAGE_COMPRESSION_NONE
} from "../../src/storage/storage-codec.js";
import { createStoragePort } from "../../src/storage/storage-port.js";
import {
  detectSqliteCapabilities,
  loadSqliteStorageDriver,
  sqliteCapabilityProbePlan,
  sqliteStorageAvailable
} from "../../src/storage/sqlite-capability.js";

function memoryStorage() {
  const objects = new Map();
  const blocks = new Map();
  let gets = 0;
  let clears = 0;
  const key = (scope, id) => `${scope}\0${id}`;
  return {
    inMemory: true,
    objects,
    blocks,
    get gets() { return gets; },
    get clears() { return clears; },
    resetGets() { gets = 0; },
    clearCache() { clears += 1; },
    async getProtocolObject(scope, id, fallback = null) {
      gets += 1;
      return structuredClone(objects.has(key(scope, id)) ? objects.get(key(scope, id)) : fallback);
    },
    async putProtocolObject(scope, id, value) {
      objects.set(key(scope, id), structuredClone(value));
      return value;
    },
    async putBlock(value, options = {}) {
      const cid = `cid:${blocks.size + 1}`;
      const codec = options.codec || "pactium-canonical";
      const record = {
        cid,
        codec,
        kind: options.kind,
        bytes: codec === "raw" ? Buffer.from(value) : canonicalEncode(value),
        refs: options.refs || []
      };
      blocks.set(cid, record);
      return record;
    },
    async getBlock(cid) { return blocks.get(cid) || null; },
    async hasBlock(cid) { return blocks.has(cid); },
    async walk(rootCid) { return { rootCid, blockCount: blocks.has(rootCid) ? 1 : 0, missing: blocks.has(rootCid) ? [] : [rootCid] }; },
    async withWriteLock(task) { return task(); }
  };
}

function protocolObjectEntry(storage, suffix) {
  return [...storage.objects.entries()].find(([id]) => id.endsWith(`\0${suffix}`));
}

function stateHarness(overrides = {}) {
  const storage = overrides.storage || memoryStorage();
  const indexRoots = new Set();
  let rootSequence = 0;
  const indexEngine = overrides.indexEngine || {
    async createIndex() {
      const root = `root-${rootSequence += 1}`;
      indexRoots.add(root);
      return { root };
    },
    async mutate(root, mutations) {
      const next = `${root}:m${mutations.length}:${rootSequence += 1}`;
      indexRoots.add(next);
      return { root: next };
    },
    async readIndexRoot(root) {
      if (!indexRoots.has(root)) throw new Error("state root missing");
      return { root };
    }
  };
  let evidenceSequence = 0;
  const core = overrides.core || {
    async recordOperation() {
      evidenceSequence += 1;
      return {
        envelopeId: `envelope-${evidenceSequence}`,
        factId: `fact-${evidenceSequence}`,
        factRef: { ledgerEventId: `ledger-${evidenceSequence}`, ledgerIndex: evidenceSequence - 1 }
      };
    },
    async withMutationTransaction(task) { return task(); }
  };
  return { storage, indexEngine, indexRoots, core };
}

describe("Pactium bounded runtime structures", () => {
  it("bounds weighted LRU entries by count and retained weight", () => {
    const cache = createWeightedLruCache({ maxEntries: 2, maxWeight: 5 });
    cache.set("a", "a", 2);
    cache.set("b", "b", 2);
    assert.equal(cache.get("a"), "a");
    cache.set("c", "c", 2);
    assert.equal(cache.has("b"), false);
    assert.equal(cache.size, 2);
    assert.equal(cache.weight, 4);
    cache.set("oversize", "oversize", 6);
    assert.equal(cache.has("oversize"), false);
    assert.equal(cache.weight, 4);
  });

  it("covers LRU replacement, default weighting, eviction, deletion, and reset", () => {
    const entries = new Map([["a", 1], ["b", 2]]);
    assert.equal(cacheGet(entries, "missing"), undefined);
    assert.equal(cacheGet(entries, "a"), 1);
    assert.deepEqual([...entries.keys()], ["b", "a"]);
    cacheSet(entries, "b", 3, 2);
    assert.deepEqual([...entries.entries()], [["a", 1], ["b", 3]]);
    cacheSet(entries, "c", 4, 2);
    assert.deepEqual([...entries.entries()], [["b", 3], ["c", 4]]);

    const cache = createWeightedLruCache({
      maxEntries: 0,
      maxWeight: 0,
      weightOf: (value) => value.weight
    });
    cache.set("zero", { weight: 0 });
    cache.set("negative", { weight: -1 });
    cache.set("finite", { weight: 2 });
    cache.set("finite", { weight: 3 });
    assert.equal(cache.weight, 3);
    assert.equal(cache.delete("missing"), false);
    assert.equal(cache.delete("finite"), true);
    assert.deepEqual([...cache.keys()].sort(), ["negative", "zero"]);
    cache.clear();
    assert.equal(cache.size, 0);
    assert.equal(cache.weight, 0);
  });

  it("encodes and validates every storage compression boundary", () => {
    const raw = Buffer.from("short");
    const plain = encodeStoragePayload(raw);
    assert.equal(plain.compression, STORAGE_COMPRESSION_NONE);
    assert.deepEqual(decodeStoragePayload(plain.payload, plain), raw);

    const compressed = encodeStoragePayload(Buffer.alloc(4096, 97), { compressionThresholdBytes: 0 });
    assert.equal(compressed.compression, STORAGE_COMPRESSION_BROTLI_V1);
    assert.deepEqual(decodeStoragePayload(compressed.payload, compressed), Buffer.alloc(4096, 97));

    const incompressible = Buffer.from(Array.from({ length: 1024 }, (_, index) => index & 0xff));
    assert.equal(encodeStoragePayload(incompressible, { compressionThresholdBytes: -1 }).rawLength, 1024);
    assert.throws(
      () => encodeStoragePayload(Buffer.alloc(2), { maximumRawLength: 1 }),
      /outside the supported boundary/
    );
    assert.throws(
      () => decodeStoragePayload(raw, { compression: "unknown", rawLength: raw.length }),
      /Unsupported Pactium storage compression/
    );
    assert.throws(
      () => decodeStoragePayload(raw, { compression: STORAGE_COMPRESSION_NONE, rawLength: raw.length + 1 }),
      /payload length mismatch/
    );
    assert.throws(
      () => decodeStoragePayload(raw, { compression: STORAGE_COMPRESSION_NONE, rawLength: -1 }),
      /outside the supported boundary/
    );
  });

  it("appends through bounded segments and resolves sequence and event-id indexes", async () => {
    const storage = memoryStorage();
    const log = createAppendOnlyEventLog({
      storage,
      segmentSize: 4,
      maxSegmentBytes: 4096,
      createEventId: ({ offset }) => `event-${offset}`
    });
    await log.appendEvents(Array.from({ length: 17 }, (_, index) => ({
      partitionId: "p",
      operationId: `op-${index}`,
      payload: { index }
    })));
    const segments = [...storage.objects.entries()]
      .filter(([id]) => id.includes("event-log-segment:p:"))
      .map(([, events]) => events);
    assert.equal(segments.every((events) => events.length <= 4), true);
    assert.equal((await log.getEvent("p", 13)).eventId, "event-13");
    assert.equal((await log.getEventById("p", "event-9")).offset, 9);
    storage.resetGets();
    assert.deepEqual((await log.listEvents("p", { limit: 3 })).map((event) => event.offset), [16, 15, 14]);
    assert.ok(storage.gets <= 7);
    assert.equal((await log.verifyPartition("p")).ok, true);
  });

  it("coalesces a state commit into one sorted Merkle mutation batch", async () => {
    const storage = memoryStorage();
    const calls = [];
    const indexEngine = {
      async createIndex() { return { root: "root-0" }; },
      async mutate(root, mutations) { calls.push({ root, mutations }); return { root: "root-1" }; },
      async readIndexRoot() { return { root: "root-1" }; }
    };
    const core = {
      async recordOperation() {
        return { envelopeId: "envelope", factId: "fact", factRef: { ledgerEventId: "ledger", ledgerIndex: 0 } };
      },
      async withMutationTransaction(task) { return task(); }
    };
    const state = createStateCommitStore({ storage, core, indexEngine });
    const commit = await state.commit({
      scope: "batch",
      mutations: [
        { action: "put", key: "z", valueRef: "first" },
        { action: "delete", key: "a" },
        { action: "put", key: "z", valueRef: "last" }
      ]
    });
    assert.equal(commit.afterRoot, "root-1");
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].mutations.map((mutation) => [mutation.key, mutation.action]), [["a", "delete"], ["z", "put"]]);
    assert.equal(calls[0].mutations[1].valueRef, "last");
  });

  it("persists pin generations and aborts GC when authority changes", async () => {
    const storage = memoryStorage();
    const cas = createContentAddressedStore({ storage });
    await cas.pinRoot("cid:root-a");
    const reopened = createContentAddressedStore({ storage });
    assert.deepEqual((await reopened.listPins()).roots, ["cid:root-a"]);
    let calls = 0;
    storage.collectGarbage = async ({ dryRun }) => {
      calls += 1;
      if (dryRun) {
        const stateKey = [...storage.objects.keys()].find((id) => id.endsWith("\0pin-authority"));
        const state = storage.objects.get(stateKey);
        storage.objects.set(stateKey, { ...state, generation: state.generation + 1, roots: [...state.roots, "cid:root-b"] });
      }
      return { supported: true, aborted: false, dryRun, deletedCount: dryRun ? 0 : 1, deletedBytes: dryRun ? 0 : 10 };
    };
    const result = await reopened.collectGarbage({ sweepKinds: ["block"], dryRun: false });
    assert.equal(result.aborted, true);
    assert.equal(result.reason, "pin-generation-changed");
    assert.equal(result.deletedCount, 0);
    assert.equal(calls, 1);
  });

  it("covers segmented-log configuration, lock, lookup, and corruption boundaries", async () => {
    assert.throws(
      () => createAppendOnlyEventLog(),
      /requires a Pactium storage port/
    );

    const storage = memoryStorage();
    storage.inMemory = false;
    let storageLocks = 0;
    storage.withWriteLock = async (task, options) => {
      storageLocks += 1;
      assert.match(options.name, /pactium-event-log/);
      return task();
    };
    const log = createAppendOnlyEventLog({
      storage,
      segmentSize: -1,
      maxSegmentBytes: 1
    });
    assert.equal(log.segmentSize, 256);
    assert.equal(log.maxSegmentBytes, 4096);
    assert.deepEqual(await log.appendEvents([]), []);
    const first = await log.appendEvent({ scope: "locked", operationId: "write" });
    assert.equal(first.partitionId, "locked");
    assert.equal(storageLocks, 1);
    assert.ok(storage.clears > 0);
    assert.equal(await log.getEvent("locked", -1), null);
    assert.equal(await log.getEvent("locked", 99), null);
    assert.equal(await log.getEventById("locked", "missing"), null);
    assert.deepEqual((await log.readPage("locked", { limit: 1 })).events.map((event) => event.offset), [0]);
    assert.deepEqual(await log.readPage("empty", { afterOffset: 7, limit: 0 }), {
      events: [],
      nextOffset: 7,
      eventCount: 0
    });
    assert.equal((await log.verifyPartition("empty")).ok, true);

    let customLocks = 0;
    const customLockLog = createAppendOnlyEventLog({
      storage: memoryStorage(),
      withWriteLock: async (task, options) => {
        customLocks += 1;
        assert.match(options.name, /custom/);
        return task();
      }
    });
    await customLockLog.appendEvent({ partitionId: "custom" });
    await customLockLog.appendEvents([{ scope: "custom-scope" }]);
    assert.equal(customLocks, 2);

    const defaultByteLimitLog = createAppendOnlyEventLog({
      storage: memoryStorage(),
      maxSegmentBytes: ""
    });
    assert.equal(defaultByteLimitLog.maxSegmentBytes, 1024 * 1024);

    await assert.rejects(
      log.appendEvents([{ partitionId: "a" }, { partitionId: "b" }]),
      /one partition per batch/
    );
    await assert.rejects(
      log.appendEvent({ partitionId: "oversize", payload: { value: "x".repeat(5000) } }),
      /exceeds the configured segment byte limit/
    );

    const metaEntry = protocolObjectEntry(storage, "event-log-meta:locked");
    assert.ok(metaEntry);
    storage.objects.set(metaEntry[0], { ...metaEntry[1], segmentSize: 1 });
    await assert.rejects(
      log.appendEvent({ partitionId: "locked" }),
      /format does not match/
    );
  });

  it("reports incomplete segmented-log indexes and failed hash-chain verification", async () => {
    const storage = memoryStorage();
    const log = createAppendOnlyEventLog({
      storage,
      segmentSize: 2,
      createEventId: ({ offset }) => `indexed-${offset}`
    });
    await log.appendEvents([
      { partitionId: "audit", operationId: "one" },
      { partitionId: "audit", operationId: "two" },
      { partitionId: "audit", operationId: "three" }
    ]);
    assert.equal((await log.getEventById("audit", "indexed-2")).offset, 2);
    assert.equal((await log.readPage("audit", { afterOffset: 0, limit: 10 })).nextOffset, 2);

    const sequenceEntry = protocolObjectEntry(storage, "event-log-sequence:audit:1");
    assert.ok(sequenceEntry);
    storage.objects.delete(sequenceEntry[0]);
    assert.equal(await log.getEvent("audit", 1), null);
    const firstSequenceEntry = protocolObjectEntry(storage, "event-log-sequence:audit:0");
    storage.objects.set(firstSequenceEntry[0], { ...firstSequenceEntry[1], position: 99 });
    assert.equal(await log.getEvent("audit", 0), null);
    const eventIdEntry = protocolObjectEntry(storage, "event-log-event-id:audit:indexed-2");
    storage.objects.set(eventIdEntry[0], { ...eventIdEntry[1], position: 99 });
    assert.equal(await log.getEventById("audit", "indexed-2"), null);
    await assert.rejects(log.listEvents("audit"), /sequence index is incomplete/);

    const segmentEntry = protocolObjectEntry(storage, "event-log-segment:audit:0");
    assert.ok(segmentEntry);
    const corrupted = structuredClone(segmentEntry[1]);
    corrupted[0].eventHash = "corrupt";
    storage.objects.set(segmentEntry[0], corrupted);
    const verification = await log.verifyPartition("audit");
    assert.equal(verification.ok, false);
    assert.equal(verification.failedOffset, 0);
  });

  it("covers byte-bounded segments and each partition verification failure boundary", async () => {
    const storage = memoryStorage();
    const log = createAppendOnlyEventLog({
      storage,
      segmentSize: 5000,
      maxSegmentBytes: 4096,
      createEventId: ({ offset }) => `bounded-${offset}`
    });
    assert.equal(log.segmentSize, 256);
    await log.appendEvents([
      { partitionId: "bounded", payload: { value: "a".repeat(1700) } },
      { partitionId: "bounded", payload: { value: "b".repeat(1700) } }
    ]);
    const segments = [...storage.objects.entries()]
      .filter(([id]) => id.includes("event-log-segment:bounded:"));
    assert.equal(segments.length, 2);
    assert.equal(await log.getEvent("bounded", 0.5), null);

    const firstSegment = segments.find(([id]) => id.endsWith("event-log-segment:bounded:0"));
    assert.ok(firstSegment);
    const originalFirstSegment = structuredClone(firstSegment[1]);

    storage.objects.set(firstSegment[0], [{ ...originalFirstSegment[0], offset: 4 }]);
    assert.deepEqual(await log.verifyPartition("bounded"), {
      ok: false,
      partitionId: "bounded",
      eventCount: 2,
      failedOffset: 0
    });

    storage.objects.set(firstSegment[0], [{ ...originalFirstSegment[0], prevEventHash: "wrong" }]);
    assert.equal((await log.verifyPartition("bounded")).failedOffset, 0);
    storage.objects.set(firstSegment[0], originalFirstSegment);

    const metaEntry = protocolObjectEntry(storage, "event-log-meta:bounded");
    assert.ok(metaEntry);
    storage.objects.set(metaEntry[0], { ...metaEntry[1], lastEventHash: "wrong" });
    assert.equal((await log.verifyPartition("bounded")).ok, false);

    const capped = createAppendOnlyEventLog({
      storage: memoryStorage(),
      maxSegmentBytes: 64 * 1024 * 1024
    });
    assert.equal(capped.maxSegmentBytes, 16 * 1024 * 1024);
  });

  it("covers content-addressed block, pin, walk, and GC result variants", async () => {
    assert.throws(
      () => createContentAddressedStore(),
      /requires a Pactium storage port/
    );
    const storage = memoryStorage();
    const cas = createContentAddressedStore({ storage });
    assert.equal(await cas.getBlock("missing"), null);

    const canonical = await cas.putBlock({ answer: 42 }, {
      metadata: { kind: "answer" },
      refs: ["cid:parent", ""]
    });
    assert.deepEqual((await cas.getBlock(canonical.cid)).value, { answer: 42 });
    assert.equal(canonical.kind, "answer");
    assert.deepEqual(canonical.refs, ["cid:parent"]);
    const raw = await cas.putBlock(Buffer.from("raw"), { codec: "raw", kind: "blob" });
    const rawRead = await cas.getBlock(raw.cid);
    assert.equal(rawRead.value, null);
    assert.equal(rawRead.bytes.toString(), "raw");
    storage.blocks.set("cid:base64", {
      cid: "cid:base64",
      codec: "pactium-canonical",
      payloadBase64: canonicalEncode({ base64: true }).toString("base64")
    });
    assert.deepEqual((await cas.getBlock("cid:base64")).value, { base64: true });
    assert.equal(await cas.hasBlock(canonical.cid), true);

    await assert.rejects(cas.listPins(), { code: "PACTIUM_CAS_PIN_AUTHORITY_INCOMPLETE" });
    await assert.rejects(cas.pinRoot(" "), /pin root is required/);
    await cas.pinRoot(canonical.cid);
    await cas.pinRoot(canonical.cid);
    assert.deepEqual((await cas.listPins()).roots, [canonical.cid]);
    await cas.unpinRoot(canonical.cid);
    assert.deepEqual((await cas.listPins()).roots, []);

    assert.deepEqual(await cas.collectGarbage(), {
      supported: false,
      aborted: true,
      reason: "storage-gc-unsupported"
    });
    let gcCalls = 0;
    storage.collectGarbage = async ({ dryRun }) => {
      gcCalls += 1;
      return { supported: true, aborted: false, dryRun, deletedCount: dryRun ? 0 : 2, deletedBytes: dryRun ? 0 : 8 };
    };
    assert.equal((await cas.collectGarbage({ dryRun: true })).pinGeneration, 3);
    assert.equal(gcCalls, 1);
    const swept = await cas.collectGarbage({ dryRun: false });
    assert.equal(swept.aborted, false);
    assert.equal(swept.deletedCount, 2);
    assert.equal(gcCalls, 3);

    storage.collectGarbage = async () => ({ supported: true, aborted: true, reason: "storage-busy" });
    assert.equal((await cas.collectGarbage({ dryRun: false })).reason, "storage-busy");
    assert.deepEqual(await cas.listMissing("cid:missing"), ["cid:missing"]);
    assert.equal((await cas.verify(canonical.cid)).ok, true);
    assert.equal((await cas.verify("cid:missing")).ok, false);
  });

  it("runs pin updates without an optional storage lock and rejects corrupt authority", async () => {
    const storage = memoryStorage();
    delete storage.withWriteLock;
    const cas = createContentAddressedStore({ storage });
    await cas.pinRoot("cid:root");
    const pinEntry = protocolObjectEntry(storage, "pin-authority");
    assert.ok(pinEntry);
    storage.objects.set(pinEntry[0], { format: "wrong", generation: "bad", roots: null });
    await assert.rejects(cas.listPins(), { code: "PACTIUM_CAS_PIN_AUTHORITY_INCOMPLETE" });
  });

  it("aborts garbage collection when the root set changes without a generation change", async () => {
    const storage = memoryStorage();
    const cas = createContentAddressedStore({ storage });
    await cas.pinRoot("cid:root-a");
    storage.collectGarbage = async ({ dryRun }) => {
      if (dryRun) {
        const pinEntry = protocolObjectEntry(storage, "pin-authority");
        storage.objects.set(pinEntry[0], {
          ...pinEntry[1],
          roots: [...pinEntry[1].roots, "cid:root-b"]
        });
      }
      return { supported: true, aborted: false, dryRun, deletedCount: 0, deletedBytes: 0 };
    };
    assert.equal((await cas.collectGarbage({ dryRun: false })).reason, "pin-generation-changed");
  });

  it("covers state-store validation, custom transaction, and deterministic identity hooks", async () => {
    const harness = stateHarness();
    harness.storage.inMemory = false;
    assert.throws(
      () => createStateCommitStore(),
      /requires a Pactium storage port/
    );
    assert.throws(
      () => createStateCommitStore({ storage: harness.storage }),
      /requires a Pactium core/
    );
    assert.throws(
      () => createStateCommitStore({ storage: harness.storage, core: harness.core }),
      /requires a verifiable index engine/
    );

    let transactionCapability = "";
    const customEvents = [];
    const state = createStateCommitStore({
      ...harness,
      core: {
        async recordOperation() { return { envelopeId: "envelope-custom", factId: "fact-custom" }; }
      },
      eventLog: {
        async appendEvent(input) {
          const event = { ...input, eventId: "event-custom", eventHash: "hash-custom", offset: customEvents.length };
          customEvents.push(event);
          return event;
        },
        async listEvents() { return [...customEvents].reverse(); }
      },
      createCommitId: ({ scope }) => `commit:${scope}`,
      withTransaction: async (task, { capability }) => {
        transactionCapability = capability;
        return task();
      }
    });
    assert.deepEqual(await state.begin({ scope: "custom" }), { scope: "custom", currentRoot: "" });
    const commit = await state.commit({ scope: "custom", payload: { custom: true } });
    assert.equal(commit.commitId, "commit:custom");
    assert.equal(commit.evidence.ledgerEventId, "");
    assert.equal(commit.evidence.ledgerIndex, -1);
    assert.equal(transactionCapability, "State commits");
    assert.equal(customEvents.length, 1);
    assert.ok(harness.storage.clears > 0);
  });

  it("enforces state mutation idempotency, root conflicts, indexes, and verification", async () => {
    const harness = stateHarness();
    const state = createStateCommitStore({ ...harness });
    const input = {
      scope: "workspace",
      operationId: "state.write",
      idempotencyKey: "write-1",
      expectedCurrentRoot: "",
      contentRefs: ["cid:a", ""],
      payload: { request: 1 },
      mutations: [
        { action: "put", key: "/", valueRef: "ignored" },
        { action: "delete", key: "old/file" },
        { key: "\\new\\file", value: "cid:first" },
        { key: "new/file", valueRef: "cid:last", metadata: { mode: "final" } }
      ]
    };
    const commit = await state.commit(input);
    assert.notEqual(commit.beforeRoot, commit.afterRoot);
    assert.deepEqual(commit.contentRefs, ["cid:a"]);
    assert.equal((await state.begin({ scope: "workspace" })).currentRoot, commit.afterRoot);

    const replay = await state.commit(input);
    assert.equal(replay.replayed, true);
    assert.equal(replay.commitId, commit.commitId);
    await assert.rejects(
      state.commit({ ...input, payload: { request: 2 } }),
      { code: "state_mutation_idempotency_conflict" }
    );
    await assert.rejects(
      state.commit({ scope: "workspace", expectedCurrentRoot: "wrong" }),
      { code: "state_root_commit_conflict", status: 409 }
    );

    assert.equal((await state.verifyCommit("missing")).error, "commit_missing");
    assert.equal((await state.verifyCommit(commit.commitId)).ok, true);
    assert.equal(await state.getCommitByEventHash({ scope: "workspace" }), null);
    assert.equal(await state.getCommitByEventHash({ scope: "workspace", eventHash: "missing" }), null);
    assert.equal(
      (await state.getCommitByEventHash({ scope: "workspace", eventHash: commit.eventHash })).commitId,
      commit.commitId
    );
    const eventIndexEntry = [...harness.storage.objects.entries()]
      .find(([key]) => key.includes("pactium-state-commit-event-index\0"));
    assert.ok(eventIndexEntry);
    harness.storage.objects.set(eventIndexEntry[0], {});
    assert.equal(await state.getCommitByEventHash({ scope: "workspace", eventHash: commit.eventHash }), null);

    harness.indexRoots.delete(commit.afterRoot);
    const failedVerification = await state.verifyCommit(commit.commitId);
    assert.equal(failedVerification.ok, false);
    assert.equal(failedVerification.error, "state root missing");
  });

  it("validates restore lineage and replays one authorized root restore", async () => {
    const harness = stateHarness();
    const state = createStateCommitStore({ ...harness });
    const base = await state.commit({
      scope: "restore",
      operationId: "state.base",
      mutations: [{ key: "file", valueRef: "cid:file" }]
    });
    const events = await state.eventLog.listEvents("restore");
    const anchor = { offset: events[0].offset, eventHash: events[0].eventHash };

    await assert.rejects(state.restoreRoot({ scope: "restore" }), /requires a target root/);
    await assert.rejects(
      state.restoreRoot({ scope: "restore", targetRoot: base.afterRoot, expectedCurrentRoot: "wrong" }),
      { code: "state_root_restore_conflict" }
    );
    await assert.rejects(
      state.verifyRestoreLineage({
        scope: "restore",
        targetRoot: base.afterRoot,
        anchor: { ...anchor, eventHash: "wrong" },
        allowedOperationIds: ["state.base"]
      }),
      { code: "state_root_restore_lineage_conflict", status: 409 }
    );

    const restoreInput = {
      scope: "restore",
      operationId: "state.restore",
      idempotencyKey: "restore-1",
      targetRoot: base.afterRoot,
      expectedCurrentRoot: base.afterRoot,
      anchor,
      allowedOperationIds: ["state.base"],
      maxSuffixEvents: 8,
      payload: { approved: true }
    };
    assert.deepEqual(await state.verifyRestoreLineage(restoreInput), { ok: true, eventCount: 0 });
    const restored = await state.restoreRoot(restoreInput);
    assert.equal(restored.afterRoot, base.afterRoot);
    assert.equal((await state.restoreRoot(restoreInput)).replayed, true);

    await assert.rejects(
      state.verifyRestoreLineage({
        scope: "restore",
        targetRoot: base.afterRoot,
        anchor,
        allowedOperationIds: ["unrelated"]
      }),
      { code: "state_root_restore_lineage_conflict" }
    );
  });

  it("rejects each independent restore-lineage guard and accepts a bounded suffix", async () => {
    const harness = stateHarness();
    const state = createStateCommitStore({ ...harness });
    const base = await state.commit({
      scope: "lineage",
      operationId: "state.base",
      mutations: [{ key: "base", valueRef: "cid:base", valueHash: "hash:base" }]
    });
    const baseEvent = (await state.eventLog.listEvents("lineage"))[0];
    const anchor = { offset: baseEvent.offset, eventHash: baseEvent.eventHash };
    await state.commit({
      scope: "lineage",
      operationId: "state.followup",
      mutations: [{ key: "followup", valueRef: "cid:followup" }]
    });

    await assert.rejects(
      state.verifyRestoreLineage({
        scope: "lineage",
        targetRoot: base.afterRoot,
        allowedOperationIds: ["state.followup"]
      }),
      { code: "state_root_restore_lineage_conflict" }
    );
    await assert.rejects(
      state.verifyRestoreLineage({
        scope: "lineage",
        targetRoot: base.afterRoot,
        anchor,
        allowedOperationIds: []
      }),
      { code: "state_root_restore_lineage_conflict" }
    );
    assert.deepEqual(await state.verifyRestoreLineage({
      scope: "lineage",
      targetRoot: base.afterRoot,
      anchor,
      allowedOperationIds: ["state.followup"],
      maxSuffixEvents: 1
    }), { ok: true, eventCount: 1 });
  });

  it("selects SQLite drivers and platform probe plans through injected capabilities", () => {
    class NodeDatabase {
      constructor(databasePath) { this.databasePath = databasePath; }
    }
    const nodeDriver = loadSqliteStorageDriver(true, {
      loadNodeSqlite: () => ({ DatabaseSync: NodeDatabase }),
      loadBetterSqlite3: () => null
    });
    assert.equal(nodeDriver.providerId, "node:sqlite");
    assert.equal(nodeDriver.open("node.db").databasePath, "node.db");

    function BetterDatabase(databasePath) { this.databasePath = databasePath; }
    const betterDriver = loadSqliteStorageDriver(true, {
      loadNodeSqlite: () => null,
      loadBetterSqlite3: () => ({ default: BetterDatabase })
    });
    assert.equal(betterDriver.providerId, "better-sqlite3");
    assert.equal(betterDriver.open("better.db").databasePath, "better.db");
    assert.equal(sqliteStorageAvailable({
      loadNodeSqlite: () => null,
      loadBetterSqlite3: () => BetterDatabase
    }), true);
    assert.equal(loadSqliteStorageDriver(false, {
      loadNodeSqlite: () => null,
      loadBetterSqlite3: () => null
    }), null);
    assert.throws(
      () => loadSqliteStorageDriver(true, {
        loadNodeSqlite: () => null,
        loadBetterSqlite3: () => null
      }),
      { code: "PACTIUM_SQLITE_UNAVAILABLE" }
    );
    assert.equal(sqliteCapabilityProbePlan({ platform: "darwin" }).some(({ id }) => id === "brew:sqlite"), true);
    assert.equal(sqliteCapabilityProbePlan({ platform: "win32" }).some(({ id }) => id === "choco:sqlite"), true);
    assert.equal(sqliteCapabilityProbePlan({ platform: "linux" }).some(({ id }) => id === "apt:sqlite3"), true);
    assert.equal(sqliteCapabilityProbePlan({ platform: "freebsd" }).length, 4);
  });

  it("detects injected SQLite capabilities across every provider class", async () => {
    class NodeDatabase {}
    function BetterDatabase() {}
    const runCommand = async (_command, _args, { probe }) => probe.id === "cli:sqlite3"
      ? { ok: true, stdout: "3.45.0\n", stderr: "", status: 0, errorCode: "" }
      : { ok: false, stdout: "", stderr: "", status: 127, errorCode: "ENOENT" };

    const node = await detectSqliteCapabilities({
      platform: "freebsd",
      includeSystem: false,
      loadNodeSqlite: () => ({ DatabaseSync: NodeDatabase }),
      loadBetterSqlite3: () => null,
      resolvePackage: () => ""
    });
    assert.equal(node.storageAvailable, true);
    assert.equal(node.selectedStorageProvider, "node:sqlite");

    const better = await detectSqliteCapabilities({
      platform: "freebsd",
      includeSystem: false,
      loadNodeSqlite: () => null,
      loadBetterSqlite3: () => BetterDatabase,
      resolvePackage: (packageName) => packageName === "better-sqlite3" ? "/fixture/better-sqlite3" : ""
    });
    assert.equal(better.storageAvailable, true);
    assert.equal(better.selectedStorageProvider, "better-sqlite3");

    const systemOnly = await detectSqliteCapabilities({
      platform: "freebsd",
      loadNodeSqlite: () => null,
      loadBetterSqlite3: () => null,
      resolvePackage: (packageName) => packageName === "sqlite3" ? "/fixture/sqlite3" : "",
      runCommand
    });
    assert.equal(systemOnly.sqliteAvailable, true);
    assert.equal(systemOnly.storageAvailable, false);
    assert.equal(systemOnly.selectedStorageProvider, "");
    assert.equal(systemOnly.capabilities.find(({ id }) => id === "cli:sqlite3").version, "3.45.0");

    const failures = await detectSqliteCapabilities({
      platform: "linux",
      loadNodeSqlite: () => { throw new Error("node unavailable"); },
      loadBetterSqlite3: () => { throw new Error("better unavailable"); },
      resolvePackage: (packageName) => {
        if (packageName === "better-sqlite3") return "/fixture/better-sqlite3";
        throw new Error("package unavailable");
      },
      runCommand: async () => ({ ok: false, stdout: "", stderr: "", errorCode: "ENOENT" })
    });
    assert.equal(failures.sqliteAvailable, true);
    assert.match(failures.capabilities.find(({ id }) => id === "node:sqlite").detail, /node unavailable/);
    assert.match(failures.capabilities.find(({ id }) => id === "npm:better-sqlite3").detail, /better unavailable/);
    assert.match(failures.capabilities.find(({ id }) => id === "npm:sqlite3").detail, /package unavailable/);
    assert.equal(failures.capabilities.find(({ id }) => id === "cli:sqlite3").status, 0);
  });

  it("covers JSON and auto storage selection without leaving durable fixtures", async () => {
    assert.throws(
      () => createStoragePort({ storageBackend: "unsupported" }),
      /Unsupported Pactium storage backend/
    );
    const memory = createStoragePort({ inMemory: true, storageBackend: "" });
    await memory.initialize();
    await memory.close();

    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "pactium-auto-storage-"));
    try {
      const json = createStoragePort({ dataDir, storageBackend: "json" });
      await json.initialize();
      await json.close();

      const auto = createStoragePort({ dataDir, storageBackend: "auto" });
      assert.equal(auto.storageBackend, "auto");
      assert.equal(auto.selectedStorageBackend, "");
      assert.equal(auto.storageFormat, "");
      assert.equal(auto.atomicTransactions, false);
      assert.equal(auto.pruneBlocks(), 0);
      assert.equal(auto.pruneProtocolObjects(), 0);
      await auto.initialize();
      assert.equal(auto.selectedStorageBackend, "json");
      assert.equal(await auto.withWriteLock(async () => "locked"), "locked");
      await auto.close();
      await auto.close();
      await assert.rejects(auto.getBlock("missing"), { code: "PACTIUM_STORAGE_CLOSED" });
    } finally {
      await fs.rm(dataDir, { recursive: true, force: true });
    }
  });
});
