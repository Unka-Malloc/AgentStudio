import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  PACTIUM_MANIFEST_FILE,
  PACTIUM_PROTOCOL,
  PACTIUM_SCHEMA_VERSION,
  PACTIUM_SQLITE_FILE,
  PROTOCOL_STORAGE_CATEGORY,
  assertCurrentDataDir,
  classifyProtocolStorageArtifact,
  createAppendOnlyEventLog,
  createContentAddressedStore,
  createPactium,
  createStateCommitStore,
  createStoragePort,
  createVerifiableIndexEngine,
  inspectDataDir,
  toCanonicalSafeValue
} from "../../src/index.js";

describe("host-neutral helpers", () => {
  it("projects bounded digest-ready values across scalar and binary edges", () => {
    assert.equal(toCanonicalSafeValue(undefined), undefined);
    assert.equal(toCanonicalSafeValue(() => {}), undefined);
    assert.equal(toCanonicalSafeValue(Symbol("x")), undefined);
    assert.equal(toCanonicalSafeValue(null), null);
    assert.equal(toCanonicalSafeValue(true), true);
    assert.equal(toCanonicalSafeValue(12n), "12");
    assert.equal(toCanonicalSafeValue(Number.POSITIVE_INFINITY), "Infinity");
    assert.equal(toCanonicalSafeValue(1.5), "1.5");
    assert.equal(toCanonicalSafeValue(-0), 0);
    assert.equal(toCanonicalSafeValue(42), 42);
    assert.deepEqual(toCanonicalSafeValue(new Uint8Array([1, 2])), {
      type: "uint8array",
      byteLength: 2
    });
    assert.deepEqual(
      Buffer.from(toCanonicalSafeValue(Buffer.from("ab"), { binaryMode: "preserve" })),
      Buffer.from("ab")
    );
    assert.equal(toCanonicalSafeValue({ $bytes: "x" }).bytes, "x");
    assert.deepEqual(toCanonicalSafeValue(Object.create(null)), {});
    const projected = toCanonicalSafeValue({
      path: "docs/readme.md",
      nested: { deep: { enough: { to: { truncate: true } } } },
      list: [1, undefined, 2],
      blob: Buffer.from("abc"),
      skip: undefined
    }, { maxDepth: 2, maxStringLength: 8, maxArrayItems: 1, maxObjectKeys: 4 });
    assert.equal(projected.path, "docs/rea...");
    assert.deepEqual(projected.nested.deep, { enough: "[truncated-depth]" });
    assert.deepEqual(projected.list, [1]);
    assert.deepEqual(projected.blob, { type: "buffer", byteLength: 3 });
    assert.equal(Object.hasOwn(projected, "skip"), false);
  });

  it("classifies protocol substrate artifacts", () => {
    assert.equal(classifyProtocolStorageArtifact(PACTIUM_MANIFEST_FILE), PROTOCOL_STORAGE_CATEGORY);
    assert.equal(classifyProtocolStorageArtifact(PACTIUM_SQLITE_FILE), PROTOCOL_STORAGE_CATEGORY);
    assert.equal(classifyProtocolStorageArtifact(`${PACTIUM_SQLITE_FILE}-wal`), PROTOCOL_STORAGE_CATEGORY);
    assert.equal(classifyProtocolStorageArtifact(`${PACTIUM_SQLITE_FILE}-shm`), PROTOCOL_STORAGE_CATEGORY);
    assert.equal(classifyProtocolStorageArtifact("cas\\ab\\cdef.json"), PROTOCOL_STORAGE_CATEGORY);
    assert.equal(classifyProtocolStorageArtifact("protocol/core/x"), PROTOCOL_STORAGE_CATEGORY);
    assert.equal(classifyProtocolStorageArtifact("backups/one"), "");
    assert.equal(classifyProtocolStorageArtifact(), "");
  });

  it("inspects and asserts current data directories", async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "pactium-preflight-"));
    try {
      const fresh = inspectDataDir({ dataDir });
      assert.equal(fresh.ok, true);
      assert.equal(fresh.protocol, PACTIUM_PROTOCOL);
      assert.equal(fresh.schema, PACTIUM_SCHEMA_VERSION);
      assertCurrentDataDir({ dataDir });
      assertCurrentDataDir({ userDataPath: dataDir });

      await fs.writeFile(path.join(dataDir, PACTIUM_MANIFEST_FILE), JSON.stringify({
        protocol: "pactium.v0.2",
        schema: "old"
      }), "utf8");
      const stale = inspectDataDir({ dataDir });
      assert.equal(stale.ok, false);
      assert.equal(stale.findings[0].kind, "non-current-pactium-manifest");
      assert.throws(() => assertCurrentDataDir({ dataDir }), /current Pactium data directory/);
    } finally {
      await fs.rm(dataDir, { recursive: true, force: true });
    }
  });

  it("provides content-addressed store helpers and validates required storage", async () => {
    assert.throws(() => createContentAddressedStore({}), /storage port/);
    const storage = createStoragePort({ inMemory: true });
    const cas = createContentAddressedStore({ storage, defaultKind: "pactium.test-block" });
    const block = await cas.putBlock({ hello: "world" });
    assert.equal(await cas.hasBlock(block.cid), true);
    const loaded = await cas.getBlock(block.cid);
    assert.deepEqual(loaded.value, { hello: "world" });
    assert.equal((await cas.verify(block.cid)).ok, true);
    assert.deepEqual(await cas.listMissing(block.cid), []);
    const raw = await cas.putBlock(Buffer.from("raw"), { codec: "raw", kind: "raw-block", refs: [block.cid] });
    assert.equal((await cas.getBlock(raw.cid)).value, null);
    assert.equal(await cas.getBlock("missing"), null);
  });

  it("provides append-only event log helpers including verify failures", async () => {
    assert.throws(() => createAppendOnlyEventLog({}), /storage port/);
    const storage = createStoragePort({ inMemory: true });
    let locked = 0;
    const eventLog = createAppendOnlyEventLog({
      storage,
      createEventId: ({ partitionId, operationId, offset }) => `${partitionId}:${operationId}:${offset}`,
      withWriteLock: async (task) => {
        locked += 1;
        return task();
      }
    });
    const first = await eventLog.appendEvent({
      partitionId: "workspace-a",
      operationId: "op.one",
      beforeRoot: "",
      afterRoot: "root-1"
    });
    const second = await eventLog.appendEvent({
      scope: "workspace-a",
      operationId: "op.two",
      beforeRoot: "root-1",
      afterRoot: "root-2",
      contentRefs: ["cid:1"],
      payload: { ok: true }
    });
    assert.equal(locked >= 2, true);
    assert.equal(first.eventId, "workspace-a:op.one:0");
    assert.equal(second.prevEventHash, first.eventHash);
    assert.equal((await eventLog.verifyPartition("workspace-a")).ok, true);
    assert.equal((await eventLog.listEvents("workspace-a", { limit: 1 }))[0].eventId, second.eventId);
    assert.equal((await eventLog.getEvent("workspace-a", 0)).eventId, first.eventId);
    assert.equal(await eventLog.getEvent("workspace-a", -1), null);
    assert.equal(await eventLog.getEvent("workspace-a", 1.5), null);

    await storage.putProtocolObject(eventLog.protocolObjectScope, "event-log:workspace-a", [{
      ...first,
      eventHash: "tampered"
    }, second]);
    assert.equal((await eventLog.verifyPartition("workspace-a")).ok, false);

    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "pactium-event-lock-"));
    const durable = createStoragePort({ dataDir, storageBackend: "json" });
    try {
      const durableLog = createAppendOnlyEventLog({ storage: durable });
      const event = await durableLog.appendEvent({
        partitionId: "locked",
        operationId: "op.lock",
        afterRoot: "root"
      });
      assert.equal(event.offset, 0);
      assert.equal((await durableLog.verifyPartition("locked")).ok, true);
    } finally {
      await durable.close();
      await fs.rm(dataDir, { recursive: true, force: true });
    }
  });

  it("commits, restores, and looks up verifiable state through the state commit store", async () => {
    assert.throws(() => createStateCommitStore({}), /storage port/);
    const storage = createStoragePort({ inMemory: true });
    assert.throws(() => createStateCommitStore({ storage }), /Pactium core/);
    const core = createPactium({ inMemory: true, storage });
    assert.throws(() => createStateCommitStore({ storage, core }), /index engine/);
    const indexEngine = createVerifiableIndexEngine({ storage, domain: "helpers" });
    const state = createStateCommitStore({
      storage,
      core,
      indexEngine
    });
    try {
      const started = await state.begin({ scope: "alpha" });
      assert.equal(started.currentRoot, "");
      const cas = createContentAddressedStore({ storage });
      const value = await cas.putBlock({ file: "a.txt" });
      const commit = await state.commit({
        scope: "alpha",
        operationId: "pactium.state.commit",
        mutations: [{ action: "put", key: "a.txt", valueRef: value.cid }]
      });
      assert.equal(commit.beforeRoot, "");
      assert.ok(commit.afterRoot);
      assert.equal((await state.verifyCommit(commit.commitId)).ok, true);
      assert.equal((await state.verifyCommit("missing")).ok, false);
      await storage.putProtocolObject(state.scopes.stateCommit, "broken-root", {
        ...commit,
        commitId: "broken-root",
        afterRoot: "missing-root"
      });
      assert.equal((await state.verifyCommit("broken-root")).ok, false);
      const byEvent = await state.getCommitByEventHash({
        scope: "alpha",
        eventHash: commit.eventHash
      });
      assert.equal(byEvent.commitId, commit.commitId);
      assert.equal(await state.getCommitByEventHash({ scope: "alpha", eventHash: "" }), null);

      await assert.rejects(
        () => state.commit({
          scope: "alpha",
          expectedCurrentRoot: "stale",
          mutations: [{ action: "put", key: "b.txt", valueRef: value.cid }]
        }),
        (error) => error.code === "state_root_commit_conflict"
      );

      const deleted = await state.commit({
        scope: "alpha",
        expectedCurrentRoot: commit.afterRoot,
        mutations: [{ action: "delete", key: "a.txt" }],
        idempotencyKey: "delete-1",
        payload: { reason: "cleanup" }
      });
      assert.ok(deleted.afterRoot);
      const replayed = await state.commit({
        scope: "alpha",
        expectedCurrentRoot: commit.afterRoot,
        mutations: [{ action: "delete", key: "a.txt" }],
        idempotencyKey: "delete-1",
        payload: { reason: "cleanup" }
      });
      assert.equal(replayed.replayed, true);
      assert.equal(replayed.commitId, deleted.commitId);

      await assert.rejects(
        () => state.commit({
          scope: "alpha",
          mutations: [{ action: "put", key: "c.txt", valueRef: value.cid }],
          idempotencyKey: "delete-1",
          payload: { reason: "different" }
        }),
        (error) => error.code === "state_mutation_idempotency_conflict"
      );

      await assert.rejects(
        () => state.restoreRoot({ scope: "alpha" }),
        /requires a target root/
      );
      await assert.rejects(
        () => state.restoreRoot({
          scope: "alpha",
          targetRoot: commit.afterRoot,
          expectedCurrentRoot: "stale"
        }),
        (error) => error.code === "state_root_restore_conflict"
      );
      await assert.rejects(
        () => state.restoreRoot({
          scope: "alpha",
          targetRoot: commit.afterRoot,
          allowedOperationIds: ["pactium.state.commit"]
        }),
        (error) => error.code === "state_root_restore_lineage_conflict"
      );

      const restored = await state.restoreRoot({
        scope: "alpha",
        targetRoot: commit.afterRoot,
        anchor: {
          offset: 0,
          eventHash: commit.eventHash
        },
        allowedOperationIds: ["pactium.state.commit", "pactium.state.root.restore"],
        maxSuffixEvents: 10,
        idempotencyKey: "restore-1"
      });
      assert.equal(restored.afterRoot, commit.afterRoot);
      const restoreReplay = await state.restoreRoot({
        scope: "alpha",
        targetRoot: commit.afterRoot,
        anchor: {
          offset: 0,
          eventHash: commit.eventHash
        },
        allowedOperationIds: ["pactium.state.commit", "pactium.state.root.restore"],
        maxSuffixEvents: 10,
        idempotencyKey: "restore-1"
      });
      assert.equal(restoreReplay.replayed, true);
      assert.equal((await state.verifyRestoreLineage({
        scope: "alpha",
        targetRoot: commit.afterRoot,
        anchor: {
          offset: 0,
          eventHash: commit.eventHash
        },
        allowedOperationIds: ["pactium.state.commit", "pactium.state.root.restore"]
      })).ok, true);
    } finally {
      await core.close();
      await storage.close();
    }
  });
});
