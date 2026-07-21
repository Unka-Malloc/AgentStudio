import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { promisify } from "node:util";

import { canonicalEncode } from "../../src/canonical/value.js";
import { PACTIUM_PROTOCOL, PACTIUM_SCHEMA_VERSION } from "../../src/protocol/constants.js";
import { cidForBytes } from "../../src/protocol/hashing.js";
import { createWeightedLruCache } from "../../src/shared/lru-cache.js";
import { loadSqliteStorageDriver } from "../../src/storage/sqlite-capability.js";
import {
  createSqliteStoragePort,
  PACTIUM_SQLITE_STORAGE_FORMAT,
  sqliteStorageAvailable
} from "../../src/storage/sqlite-storage-port.js";
import {
  decodeStoragePayload,
  encodeStoragePayload,
  STORAGE_COMPRESSION_NONE
} from "../../src/storage/storage-codec.js";

const tempDirs = [];
const execFileAsync = promisify(execFile);

async function tempDataDir(prefix = "pactium-sqlite-compressed-") {
  const directoryPath = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(directoryPath);
  return directoryPath;
}

function openDatabase(databasePath) {
  return loadSqliteStorageDriver(true).open(databasePath);
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directoryPath) =>
    fs.rm(directoryPath, { recursive: true, force: true })
  ));
});

describe("Pactium SQLite compressed storage", () => {
  it("bounds weighted LRU caches and validates the storage codec envelope", () => {
    const cache = createWeightedLruCache({ maxEntries: 2, maxWeight: 3 });
    cache.set("a", 1, 2);
    cache.set("b", 2, 2);
    assert.equal(cache.has("a"), false);
    assert.equal(cache.get("b"), 2);
    cache.set("c", 3, 1);
    assert.equal(cache.size, 2);
    assert.equal(cache.weight, 3);
    cache.set("oversized", 4, 4);
    assert.equal(cache.has("oversized"), false);
    assert.equal(cache.delete("missing"), false);
    cache.clear();
    assert.equal(cache.size, 0);

    const fallbackLimits = createWeightedLruCache({
      maxEntries: 0,
      maxWeight: Number.NaN,
      weightOf: () => 2
    });
    assert.equal(fallbackLimits.get("missing"), undefined);
    fallbackLimits.set("same", 1);
    fallbackLimits.set("same", 2);
    fallbackLimits.set("zero-weight", 3, -1);
    assert.equal(fallbackLimits.get("same"), 2);
    assert.equal(fallbackLimits.weight, 2);
    assert.deepEqual([...fallbackLimits.keys()].sort(), ["same", "zero-weight"]);
    const entryBound = createWeightedLruCache({ maxEntries: 1, maxWeight: 10 });
    entryBound.set("first", true);
    entryBound.set("second", true);
    assert.deepEqual([...entryBound.keys()], ["second"]);
    const defaultCache = createWeightedLruCache();
    defaultCache.set("default", true);
    assert.equal(defaultCache.has("default"), true);

    const raw = Buffer.from("small-payload");
    const encoded = encodeStoragePayload(raw);
    assert.equal(encoded.compression, STORAGE_COMPRESSION_NONE);
    assert.equal(decodeStoragePayload(encoded.payload, encoded).equals(raw), true);
    assert.throws(
      () => decodeStoragePayload(raw, { compression: STORAGE_COMPRESSION_NONE, rawLength: raw.length + 1 }),
      /length mismatch/
    );
    assert.throws(
      () => decodeStoragePayload(raw, { compression: "removed-codec", rawLength: raw.length }),
      /Unsupported Pactium storage compression/
    );
    assert.throws(
      () => encodeStoragePayload(raw, { maximumRawLength: 1 }),
      /outside the supported boundary/
    );
    assert.equal(
      encodeStoragePayload("text", { compressionThresholdBytes: -1 }).compression,
      STORAGE_COMPRESSION_NONE
    );
    assert.equal(
      encodeStoragePayload(randomBytes(2048), { compressionThresholdBytes: 0 }).compression,
      STORAGE_COMPRESSION_NONE
    );
    assert.throws(
      () => decodeStoragePayload(raw, { compression: STORAGE_COMPRESSION_NONE, rawLength: -1 }),
      /outside the supported boundary/
    );
  });

  it("stores canonical bytes in adaptive Brotli BLOBs without changing CIDs", async (context) => {
    if (!sqliteStorageAvailable()) {
      context.skip("SQLite storage driver unavailable");
      return;
    }
    const dataDir = await tempDataDir();
    const storage = createSqliteStoragePort({ dataDir });
    const value = { repeated: "proof-material-".repeat(1024) };
    const canonicalBytes = canonicalEncode(value);
    const block = await storage.putBlock(value, { kind: "compression-fixture" });

    assert.equal(block.cid, cidForBytes(canonicalBytes));
    assert.equal(block.bytes.equals(canonicalBytes), true);
    assert.equal(block.compression, "br-v1");
    assert.ok(block.storedByteLength < block.byteLength);

    await storage.putProtocolObject("compression", "fixture", value);
    storage.clearCache();
    assert.deepEqual(await storage.getProtocolObject("compression", "fixture"), value);
    assert.equal((await storage.getBlock(block.cid)).bytes.equals(canonicalBytes), true);

    const database = openDatabase(storage.sqlitePath);
    try {
      const blockColumns = database.prepare("PRAGMA table_info(blocks)").all().map((row) => row.name);
      const objectColumns = database.prepare("PRAGMA table_info(protocol_objects)").all().map((row) => row.name);
      assert.deepEqual(blockColumns, [
        "cid", "codec", "kind", "compression", "raw_length", "payload", "created_at"
      ]);
      assert.deepEqual(objectColumns, [
        "scope", "key", "compression", "raw_length", "value_hash", "payload", "updated_at"
      ]);
      assert.equal(database.prepare("SELECT typeof(payload) AS type FROM blocks WHERE cid = ?").get(block.cid).type, "blob");
      assert.equal(database.prepare("PRAGMA auto_vacuum").get().auto_vacuum, 2);
      assert.equal(database.prepare("PRAGMA user_version").get().user_version, 2);
    } finally {
      database.close();
    }
    const manifest = JSON.parse(await fs.readFile(path.join(dataDir, "pactium-manifest.json"), "utf8"));
    assert.equal(manifest.storageFormat, PACTIUM_SQLITE_STORAGE_FORMAT);
    await storage.close();
    const reopened = createSqliteStoragePort({ dataDir });
    assert.equal((await reopened.getBlock(block.cid)).bytes.equals(canonicalBytes), true);
    await reopened.close();
  });

  it("unions duplicate CAS references and performs a content-hash no-op protocol UPSERT", async (context) => {
    if (!sqliteStorageAvailable()) {
      context.skip("SQLite storage driver unavailable");
      return;
    }
    const dataDir = await tempDataDir();
    const storage = createSqliteStoragePort({ dataDir });
    const firstRef = `cid:sha256:${"1".repeat(64)}`;
    const secondRef = `cid:sha256:${"2".repeat(64)}`;
    const first = await storage.putBlock({ immutable: true }, { refs: [firstRef] });
    const duplicate = await storage.putBlock({ immutable: true }, { refs: [secondRef, firstRef] });
    assert.equal(duplicate.deduped, true);
    assert.deepEqual((await storage.getBlock(first.cid)).refs, [firstRef, secondRef]);

    await storage.putProtocolObject("no-op", "same", { stable: true });
    const database = openDatabase(storage.sqlitePath);
    let firstUpdatedAt;
    try {
      firstUpdatedAt = database.prepare(`
        SELECT updated_at FROM protocol_objects WHERE scope = ? AND key = ?
      `).get("no-op", "same").updated_at;
    } finally {
      database.close();
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
    await storage.putProtocolObject("no-op", "same", { stable: true });

    const verificationDatabase = openDatabase(storage.sqlitePath);
    try {
      const row = verificationDatabase.prepare(`
        SELECT updated_at FROM protocol_objects WHERE scope = ? AND key = ?
      `).get("no-op", "same");
      assert.equal(row.updated_at, firstUpdatedAt);
      assert.equal(
        verificationDatabase.prepare("SELECT count(*) AS count FROM block_refs WHERE parent_cid = ?").get(first.cid).count,
        2
      );
    } finally {
      verificationDatabase.close();
    }
    assert.deepEqual(await storage.listProtocolObjectKeys("no-op"), ["same"]);
    await storage.deleteProtocolObject("no-op", "same");
    assert.equal(await storage.getProtocolObject("no-op", "same", null), null);
    const walk = await storage.walk(first.cid);
    assert.deepEqual(walk.missing.sort(), [firstRef, secondRef].sort());
    await storage.close();
  });

  it("keeps transaction-local cache writes invisible after rollback", async (context) => {
    if (!sqliteStorageAvailable()) {
      context.skip("SQLite storage driver unavailable");
      return;
    }
    const storage = createSqliteStoragePort({ dataDir: await tempDataDir() });
    await storage.putProtocolObject("transaction", "existing", { version: 1 });
    assert.deepEqual(await storage.getProtocolObject("transaction", "existing"), { version: 1 });
    const stableRef = `cid:sha256:${"3".repeat(64)}`;
    const rolledRef = `cid:sha256:${"4".repeat(64)}`;
    const stableBlock = await storage.putBlock({ stable: true }, { refs: [stableRef] });
    let rolledBlockCid = "";

    await assert.rejects(() => storage.withWriteLock(async () => {
      await storage.putProtocolObject("transaction", "existing", { version: 2 });
      await storage.putProtocolObject("transaction", "new", { visible: false });
      await storage.putBlock({ stable: true }, { refs: [rolledRef] });
      rolledBlockCid = (await storage.putBlock({ rolled: true })).cid;
      assert.deepEqual(await storage.getProtocolObject("transaction", "existing"), { version: 2 });
      assert.equal(await storage.hasBlock(rolledBlockCid), true);
      throw new Error("rollback fixture");
    }), /rollback fixture/);

    assert.deepEqual(await storage.getProtocolObject("transaction", "existing"), { version: 1 });
    assert.equal(await storage.getProtocolObject("transaction", "new", null), null);
    assert.equal(await storage.getBlock(rolledBlockCid), null);
    assert.deepEqual((await storage.getBlock(stableBlock.cid)).refs, [stableRef]);
    await storage.close();
  });

  it("scans durable metadata and fail-closes conservative mark-sweep collection", async (context) => {
    if (!sqliteStorageAvailable()) {
      context.skip("SQLite storage driver unavailable");
      return;
    }
    const storage = createSqliteStoragePort({ dataDir: await tempDataDir() });
    const child = await storage.putBlock({ child: true }, { kind: "gc-eligible" });
    const root = await storage.putBlock({ root: true }, { kind: "gc-root", refs: [child.cid] });
    const orphan = await storage.putBlock({ orphan: true }, { kind: "gc-eligible" });
    const unknown = await storage.putBlock({ retainedByKind: true }, { kind: "unknown-custom-kind" });

    const firstPage = await storage.scanBlocks({ limit: 2 });
    assert.equal(firstPage.supported, true);
    assert.equal(firstPage.items.length, 2);
    assert.equal(firstPage.done, false);
    const secondPage = await storage.scanBlocks({ afterCid: firstPage.nextCursor, limit: 10 });
    assert.equal(secondPage.items.length, 2);
    assert.equal(secondPage.done, true);
    assert.deepEqual(
      (await storage.scanBlocks({ kinds: ["gc-root"] })).items.map((item) => item.cid),
      [root.cid]
    );

    assert.equal((await storage.collectGarbage()).reason, "no-retention-roots");
    assert.equal((await storage.collectGarbage({ roots: [root.cid] })).reason, "no-sweep-kinds");
    assert.equal((await storage.collectGarbage({
      roots: [root.cid],
      sweepKinds: ["gc-eligible"],
      createdBefore: "not-a-date",
      dryRun: false
    })).reason, "invalid-created-before");
    const ageProtected = await storage.collectGarbage({
      roots: [root.cid],
      sweepKinds: ["gc-eligible"],
      createdBefore: "1970-01-01T00:00:00.000Z"
    });
    assert.equal(ageProtected.candidateCount, 0);

    const missingRoot = await storage.collectGarbage({
      roots: [`cid:sha256:${"0".repeat(64)}`],
      sweepKinds: ["gc-eligible"],
      dryRun: false
    });
    assert.equal(missingRoot.aborted, true);
    assert.equal(missingRoot.reason, "incomplete-reachable-graph");
    assert.equal(await storage.hasBlock(orphan.cid), true);

    const preview = await storage.collectGarbage({
      roots: [root.cid],
      sweepKinds: ["gc-eligible"]
    });
    assert.equal(preview.dryRun, true);
    assert.deepEqual(preview.candidates.map((candidate) => candidate.cid), [orphan.cid]);
    const swept = await storage.collectGarbage({
      roots: [root.cid],
      sweepKinds: ["gc-eligible"],
      dryRun: false
    });
    assert.equal(swept.deletedCount, 1);
    assert.equal(await storage.getBlock(orphan.cid), null);
    assert.equal(await storage.hasBlock(child.cid), true);
    assert.equal(await storage.hasBlock(root.cid), true);
    assert.equal(await storage.hasBlock(unknown.cid), true);
    assert.equal((await storage.reclaimDatabasePages({ pages: 32 })).supported, true);
    await storage.withWriteLock(async () => {
      assert.equal((await storage.reclaimDatabasePages()).deferred, true);
    });
    await storage.close();
  });

  it("requires the current storage-format manifest", async (context) => {
    if (!sqliteStorageAvailable()) {
      context.skip("SQLite storage driver unavailable");
      return;
    }
    const missingFormatDir = await tempDataDir("pactium-sqlite-missing-format-");
    await fs.writeFile(path.join(missingFormatDir, "pactium.sqlite"), "");
    await fs.writeFile(path.join(missingFormatDir, "pactium-manifest.json"), JSON.stringify({
      protocol: PACTIUM_PROTOCOL,
      schema: PACTIUM_SCHEMA_VERSION,
      storageBackend: "sqlite",
      sqlitePath: "pactium.sqlite"
    }));
    const missingFormatStorage = createSqliteStoragePort({ dataDir: missingFormatDir });
    await assert.rejects(() => missingFormatStorage.initialize(), /non-current SQLite manifest/);
    await missingFormatStorage.close();

    const wrongProtocolDir = await tempDataDir("pactium-sqlite-wrong-protocol-");
    await fs.writeFile(path.join(wrongProtocolDir, "pactium-manifest.json"), JSON.stringify({
      protocol: "pactium.removed",
      schema: PACTIUM_SCHEMA_VERSION,
      storageBackend: "sqlite",
      storageFormat: PACTIUM_SQLITE_STORAGE_FORMAT
    }));
    const wrongProtocol = createSqliteStoragePort({ dataDir: wrongProtocolDir });
    await assert.rejects(() => wrongProtocol.initialize(), /non-current protocol data directory/);
    await wrongProtocol.close();

    const wrongBackendDir = await tempDataDir("pactium-sqlite-wrong-backend-");
    await fs.writeFile(path.join(wrongBackendDir, "pactium-manifest.json"), JSON.stringify({
      protocol: PACTIUM_PROTOCOL,
      schema: PACTIUM_SCHEMA_VERSION,
      storageBackend: "json",
      storageFormat: PACTIUM_SQLITE_STORAGE_FORMAT
    }));
    const wrongBackend = createSqliteStoragePort({ dataDir: wrongBackendDir });
    await assert.rejects(() => wrongBackend.initialize(), /uses json storage backend/i);
    await wrongBackend.close();

    const extraTableDir = await tempDataDir("pactium-sqlite-extra-table-");
    const extraTableSeed = createSqliteStoragePort({ dataDir: extraTableDir });
    await extraTableSeed.initialize();
    await extraTableSeed.close();
    const extraTableDatabase = openDatabase(path.join(extraTableDir, "pactium.sqlite"));
    extraTableDatabase.exec("CREATE TABLE unexpected_current_schema (id INTEGER PRIMARY KEY)");
    extraTableDatabase.close();
    const extraTableStorage = createSqliteStoragePort({ dataDir: extraTableDir });
    await assert.rejects(() => extraTableStorage.initialize(), /non-current SQLite application tables/);
    await extraTableStorage.close();

    const wrongVersionDir = await tempDataDir("pactium-sqlite-wrong-version-");
    const wrongVersionSeed = createSqliteStoragePort({ dataDir: wrongVersionDir });
    await wrongVersionSeed.initialize();
    await wrongVersionSeed.close();
    const wrongVersionDatabase = openDatabase(path.join(wrongVersionDir, "pactium.sqlite"));
    wrongVersionDatabase.exec("PRAGMA user_version = 1");
    wrongVersionDatabase.close();
    const wrongVersionStorage = createSqliteStoragePort({ dataDir: wrongVersionDir });
    await assert.rejects(() => wrongVersionStorage.initialize(), /non-current SQLite storage format/);
    await wrongVersionStorage.close();

    const wrongColumnsDir = await tempDataDir("pactium-sqlite-wrong-columns-");
    const wrongColumnsSeed = createSqliteStoragePort({ dataDir: wrongColumnsDir });
    await wrongColumnsSeed.initialize();
    await wrongColumnsSeed.close();
    const wrongColumnsDatabase = openDatabase(path.join(wrongColumnsDir, "pactium.sqlite"));
    wrongColumnsDatabase.exec("DROP TABLE block_refs");
    wrongColumnsDatabase.exec("CREATE TABLE block_refs (parent_cid TEXT PRIMARY KEY)");
    wrongColumnsDatabase.close();
    const wrongColumnsStorage = createSqliteStoragePort({ dataDir: wrongColumnsDir });
    await assert.rejects(() => wrongColumnsStorage.initialize(), /non-current SQLite table block_refs/);
    await wrongColumnsStorage.close();
  });

  it("fails closed on tampered SQLite block and protocol-object payloads", async (context) => {
    if (!sqliteStorageAvailable()) {
      context.skip("SQLite storage driver unavailable");
      return;
    }
    const storage = createSqliteStoragePort({ dataDir: await tempDataDir("pactium-sqlite-integrity-") });
    const block = await storage.putBlock({ protected: true });
    await storage.putProtocolObject("integrity", "object", { protected: true });
    storage.clearCache();

    const database = openDatabase(storage.sqlitePath);
    database.prepare(`
      UPDATE blocks SET compression = ?, raw_length = ?, payload = ? WHERE cid = ?
    `).run(STORAGE_COMPRESSION_NONE, 8, Buffer.from("tampered"), block.cid);
    database.prepare(`
      UPDATE protocol_objects SET value_hash = ? WHERE scope = ? AND key = ?
    `).run(`sha256:${"0".repeat(64)}`, "integrity", "object");
    database.close();

    await assert.rejects(() => storage.getBlock(block.cid), /CAS block integrity failure/);
    await assert.rejects(
      () => storage.getProtocolObject("integrity", "object"),
      /protocol object integrity failure/
    );
    await storage.close();
  });

  it("converges concurrent first-open processes on one current schema and manifest", async (context) => {
    if (!sqliteStorageAvailable()) {
      context.skip("SQLite storage driver unavailable");
      return;
    }
    const dataDir = await tempDataDir("pactium-sqlite-concurrent-init-");
    const storageModuleUrl = new URL("../../src/storage/sqlite-storage-port.js", import.meta.url).href;
    const childSource = `
      const { createSqliteStoragePort } = await import(${JSON.stringify(storageModuleUrl)});
      const storage = createSqliteStoragePort({ dataDir: process.argv[1] });
      await storage.initialize();
      await storage.close();
    `;
    await Promise.all(Array.from({ length: 6 }, () => execFileAsync(
      process.execPath,
      ["--input-type=module", "--eval", childSource, dataDir],
      { timeout: 15_000 }
    )));

    const storage = createSqliteStoragePort({ dataDir });
    await storage.initialize();
    const manifest = JSON.parse(await fs.readFile(path.join(dataDir, "pactium-manifest.json"), "utf8"));
    assert.equal(manifest.storageFormat, PACTIUM_SQLITE_STORAGE_FORMAT);
    const database = openDatabase(storage.sqlitePath);
    try {
      assert.deepEqual(
        database.prepare(`
          SELECT name FROM sqlite_master
          WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
          ORDER BY name
        `).all().map((row) => row.name),
        ["block_refs", "blocks", "protocol_objects"]
      );
    } finally {
      database.close();
    }
    await storage.close();

    await fs.unlink(path.join(dataDir, "pactium-manifest.json"));
    const recovered = createSqliteStoragePort({ dataDir });
    await recovered.initialize();
    assert.equal(
      JSON.parse(await fs.readFile(path.join(dataDir, "pactium-manifest.json"), "utf8")).storageFormat,
      PACTIUM_SQLITE_STORAGE_FORMAT
    );
    await recovered.close();
  });
});
