import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { promisify } from "node:util";

import {
  createPactium,
  createSqliteStoragePort,
  createStoragePort,
  sqliteStorageAvailable
} from "../../src/index.js";
import { getPactiumInternals } from "../../src/core/pactium-core.js";
import { writePrivateFileAtomic } from "../../src/storage/private-atomic-file.js";

const tempDirs = [];
const execFileAsync = promisify(execFile);

async function tempDataDir(prefix) {
  const directoryPath = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(directoryPath);
  return directoryPath;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directoryPath) =>
    fs.rm(directoryPath, { recursive: true, force: true })
  ));
});

function recordingFileSystem({ directoryOpenError = null, directorySyncError = null } = {}) {
  const events = [];
  const temporaryHandle = {
    async writeFile(_content, encoding) {
      events.push(`temporary:write:${encoding}`);
    },
    async sync() {
      events.push("temporary:sync");
    },
    async close() {
      events.push("temporary:close");
    }
  };
  const directoryHandle = {
    async sync() {
      events.push("directory:sync");
      if (directorySyncError) throw directorySyncError;
    },
    async close() {
      events.push("directory:close");
    }
  };
  return {
    events,
    fileSystem: {
      async mkdir(_directoryPath, options) {
        events.push(`mkdir:${options.mode.toString(8)}`);
      },
      async lstat() {
        return {
          isDirectory: () => true,
          isFile: () => false,
          isSymbolicLink: () => false
        };
      },
      async chmod(targetPath, mode) {
        events.push(`chmod:${path.basename(targetPath) || "directory"}:${mode.toString(8)}`);
      },
      async open(targetPath, flags, mode) {
        if (flags === "wx") {
          events.push(`open:temporary:${flags}:${mode.toString(8)}`);
          return temporaryHandle;
        }
        events.push(`open:directory:${flags}`);
        if (directoryOpenError) throw directoryOpenError;
        return directoryHandle;
      },
      async rename() {
        events.push("rename");
      },
      async rm() {
        events.push("cleanup");
      }
    }
  };
}

async function descriptorsUnder(directoryPath) {
  if (process.platform === "darwin") {
    try {
      const { stdout } = await execFileAsync("lsof", ["-Fn", "-p", String(process.pid)], {
        encoding: "utf8"
      });
      const normalizedDirectory = await fs.realpath(directoryPath).catch(() => path.resolve(directoryPath));
      return stdout.split("\n")
        .filter((line) => line.startsWith("n"))
        .map((line) => line.slice(1))
        .filter((target) => target.startsWith(`${normalizedDirectory}${path.sep}`))
        .length;
    } catch {
      return null;
    }
  }
  if (process.platform !== "linux") return null;
  const descriptorRoot = "/proc/self/fd";
  let names = null;
  try {
    names = await fs.readdir(descriptorRoot);
  } catch {
    return null;
  }
  const normalizedDirectory = path.resolve(directoryPath);
  let count = 0;
  for (const name of names) {
    try {
      const target = await fs.readlink(path.join(descriptorRoot, name));
      if (path.resolve(target).startsWith(`${normalizedDirectory}${path.sep}`)) count += 1;
    } catch {
      // Descriptors can close between directory enumeration and readlink.
    }
  }
  return count;
}

describe("Pactium durable storage lifecycle", () => {
  it("syncs a private temporary file before rename and the parent directory afterward", async () => {
    const fixture = recordingFileSystem();
    await writePrivateFileAtomic("/virtual/private/state.json", "{}\n", {
      fileSystem: fixture.fileSystem,
      platform: "linux"
    });
    assert.deepEqual(fixture.events, [
      "mkdir:700",
      "chmod:private:700",
      "open:temporary:wx:600",
      "temporary:write:utf8",
      "temporary:sync",
      "temporary:close",
      "rename",
      "chmod:state.json:600",
      "open:directory:r",
      "directory:sync",
      "directory:close"
    ]);
  });

  it("ignores only Windows directory-sync unsupported errors and propagates other failures", async () => {
    const unsupported = Object.assign(new Error("directory sync unsupported"), { code: "EPERM" });
    const windowsFixture = recordingFileSystem({ directoryOpenError: unsupported });
    await assert.doesNotReject(() => writePrivateFileAtomic("C:/private/state.json", "{}\n", {
      fileSystem: windowsFixture.fileSystem,
      platform: "win32"
    }));

    const durableFailure = Object.assign(new Error("directory sync failed"), { code: "EIO" });
    const linuxFixture = recordingFileSystem({ directorySyncError: durableFailure });
    await assert.rejects(
      () => writePrivateFileAtomic("/virtual/private/state.json", "{}\n", {
        fileSystem: linuxFixture.fileSystem,
        platform: "linux"
      }),
      (error) => error === durableFailure
    );
    assert.equal(linuxFixture.events.at(-1), "cleanup");
  });

  it("creates private durable JSON state files", async () => {
    const dataDir = await tempDataDir("pactium-private-state-");
    const storage = createStoragePort({ dataDir, storageBackend: "json" });
    await storage.putProtocolObject("scope", "key", { ok: true });
    const manifestPath = path.join(dataDir, "pactium-manifest.json");
    const statePath = path.join(dataDir, "protocol", "scope", "key.json");
    if (process.platform !== "win32") {
      assert.equal((await fs.stat(path.dirname(statePath))).mode & 0o777, 0o700);
      assert.equal((await fs.stat(manifestPath)).mode & 0o777, 0o600);
      assert.equal((await fs.stat(statePath)).mode & 0o777, 0o600);
    }
    await storage.close();
  });

  it("latches JSON initialization failures and never writes through an invalid manifest", async () => {
    const dataDir = await tempDataDir("pactium-json-invalid-manifest-");
    await fs.writeFile(path.join(dataDir, "pactium-manifest.json"), JSON.stringify({
      protocol: "pactium.invalid",
      schema: "pactium.invalid.schema",
      storageBackend: "json"
    }), { mode: 0o600 });
    const storage = createStoragePort({ dataDir, storageBackend: "json" });

    await assert.rejects(() => storage.initialize(), /latest-schema-only boundary/);
    await assert.rejects(
      () => storage.putProtocolObject("scope", "must-not-exist", { visible: true }),
      /latest-schema-only boundary/
    );
    await assert.rejects(
      () => fs.stat(path.join(dataDir, "protocol", "scope", "must-not-exist.json")),
      { code: "ENOENT" }
    );
    await storage.close();
  });

  it("closes JSON storage after admitted writes drain and rejects every later operation", async () => {
    const dataDir = await tempDataDir("pactium-json-close-");
    const storage = createStoragePort({ dataDir, storageBackend: "json" });
    let releaseWrite;
    let closeSettled = false;
    const writeGate = new Promise((resolve) => {
      releaseWrite = resolve;
    });
    const write = storage.withWriteLock(async () => {
      await writeGate;
      await storage.putProtocolObject("scope", "key", { ok: true });
    });
    const closing = storage.close().then(() => {
      closeSettled = true;
    });
    await assert.rejects(
      () => storage.getProtocolObject("scope", "key", null),
      { code: "PACTIUM_STORAGE_CLOSED" }
    );
    assert.equal(closeSettled, false);
    releaseWrite();
    await Promise.all([write, closing, storage.close()]);
    await assert.rejects(() => storage.initialize(), { code: "PACTIUM_STORAGE_CLOSED" });
    await assert.rejects(
      () => storage.putProtocolObject("scope", "late", { ok: false }),
      { code: "PACTIUM_STORAGE_CLOSED" }
    );
    assert.throws(() => storage.clearCache(), { code: "PACTIUM_STORAGE_CLOSED" });
    assert.throws(() => storage.pruneBlocks(), { code: "PACTIUM_STORAGE_CLOSED" });
  });

  it("closes SQLite exactly once after its write lane drains and releases its descriptors", async (context) => {
    if (!sqliteStorageAvailable()) {
      context.skip("SQLite storage driver unavailable");
      return;
    }
    const dataDir = await tempDataDir("pactium-sqlite-close-");
    const storage = createSqliteStoragePort({ dataDir });
    await storage.initialize();
    const openDescriptorCount = await descriptorsUnder(dataDir);
    let releaseWrite;
    let closeSettled = false;
    const writeGate = new Promise((resolve) => {
      releaseWrite = resolve;
    });
    const write = storage.withWriteLock(async () => {
      await writeGate;
      await storage.putProtocolObject("scope", "key", { ok: true });
    });
    const firstClose = storage.close().then(() => {
      closeSettled = true;
    });
    const secondClose = storage.close();
    await Promise.resolve();
    assert.equal(closeSettled, false);
    releaseWrite();
    await Promise.all([write, firstClose, secondClose]);
    await storage.close();
    await assert.rejects(() => storage.initialize(), { code: "PACTIUM_STORAGE_CLOSED" });
    const closedDescriptorCount = await descriptorsUnder(dataDir);
    if (openDescriptorCount !== null && closedDescriptorCount !== null) {
      assert.ok(openDescriptorCount > closedDescriptorCount);
      assert.equal(closedDescriptorCount, 0);
    }
  });

  it("rejects reentrant close calls without deadlocking or closing the caller-owned lifecycle", async (context) => {
    const jsonDir = await tempDataDir("pactium-json-reentrant-close-");
    const jsonStorage = createStoragePort({ dataDir: jsonDir, storageBackend: "json" });
    await assert.rejects(
      () => jsonStorage.withWriteLock(() => jsonStorage.close()),
      { code: "PACTIUM_REENTRANT_CLOSE" }
    );
    await jsonStorage.putProtocolObject("lifecycle", "json-open", { ok: true });
    await jsonStorage.close();

    const autoDir = await tempDataDir("pactium-auto-reentrant-close-");
    const autoStorage = createStoragePort({ dataDir: autoDir, storageBackend: "auto" });
    await autoStorage.initialize();
    await assert.rejects(
      () => autoStorage.withWriteLock(() => autoStorage.close()),
      { code: "PACTIUM_REENTRANT_CLOSE" }
    );
    await autoStorage.putProtocolObject("lifecycle", "auto-open", { ok: true });
    await autoStorage.close();

    if (sqliteStorageAvailable()) {
      const sqliteDir = await tempDataDir("pactium-sqlite-reentrant-close-");
      const sqliteStorage = createSqliteStoragePort({ dataDir: sqliteDir });
      await assert.rejects(
        () => sqliteStorage.withWriteLock(() => sqliteStorage.close()),
        { code: "PACTIUM_REENTRANT_CLOSE" }
      );
      await sqliteStorage.putProtocolObject("lifecycle", "sqlite-open", { ok: true });
      await sqliteStorage.close();
    } else {
      context.diagnostic("SQLite storage driver unavailable; SQLite reentrant-close assertion skipped.");
    }

    const core = createPactium({ inMemory: true });
    await assert.rejects(
      () => core.withMutationTransaction(() => core.close()),
      { code: "PACTIUM_REENTRANT_CLOSE" }
    );
    await core.recordOperation({
      operationId: "lifecycle.reentrant-close-rejected",
      result: { ok: true }
    });
    await core.close();
  });

  it("rolls back compound SQLite mutations and nested core writes as one transaction", async (context) => {
    if (!sqliteStorageAvailable()) {
      context.skip("SQLite storage driver unavailable");
      return;
    }
    const dataDir = await tempDataDir("pactium-compound-transaction-");
    const pactium = createPactium({ dataDir, storageBackend: "sqlite" });
    const { storage } = getPactiumInternals(pactium);

    await assert.rejects(() => pactium.withMutationTransaction(async () => {
      await storage.putProtocolObject("compound", "projection", { visible: true });
      await pactium.recordOperation({
        operationId: "compound.rollback",
        workspaceId: "compound-test",
        input: { attempt: 1 },
        result: { visible: true }
      });
      throw new Error("rollback compound mutation");
    }), /rollback compound mutation/);

    assert.equal(await storage.getProtocolObject("compound", "projection", null), null);
    assert.equal((await pactium.doctor()).ledgerSize, 0);

    const committed = await pactium.withMutationTransaction(async () => {
      await storage.putProtocolObject("compound", "projection", { visible: true });
      return pactium.recordOperation({
        operationId: "compound.commit",
        workspaceId: "compound-test",
        input: { attempt: 2 },
        result: { visible: true }
      });
    });
    assert.equal(committed.envelopeKind, "operation-outcome");
    assert.deepEqual(await storage.getProtocolObject("compound", "projection", null), { visible: true });
    assert.ok((await pactium.doctor()).ledgerSize > 0);
    await pactium.close();
  });

  it("hardens SQLite directories, database files, and current sidecars under umask 022", async (context) => {
    if (!sqliteStorageAvailable()) {
      context.skip("SQLite storage driver unavailable");
      return;
    }
    const dataDir = await tempDataDir("pactium-sqlite-private-");
    if (process.platform !== "win32") await fs.chmod(dataDir, 0o755);
    const previousUmask = process.umask(0o022);
    const storage = createSqliteStoragePort({ dataDir });
    try {
      await storage.initialize();
      await storage.putProtocolObject("scope", "key", { ok: true });
    } finally {
      process.umask(previousUmask);
    }

    if (process.platform !== "win32") {
      assert.equal((await fs.lstat(dataDir)).mode & 0o777, 0o700);
      const databasePath = path.join(dataDir, "pactium.sqlite");
      const privateFiles = [databasePath, path.join(dataDir, "pactium-manifest.json")];
      for (const suffix of ["-wal", "-shm", "-journal"]) {
        const sidecarPath = `${databasePath}${suffix}`;
        if (await fs.lstat(sidecarPath).then(() => true, () => false)) privateFiles.push(sidecarPath);
      }
      for (const filePath of privateFiles) {
        const stat = await fs.lstat(filePath);
        assert.equal(stat.isFile(), true);
        assert.equal(stat.isSymbolicLink(), false);
        assert.equal(stat.mode & 0o777, 0o600);
      }
    }
    await storage.close();

    if (process.platform !== "win32") {
      const symlinkDir = await tempDataDir("pactium-sqlite-symlink-");
      const targetPath = path.join(symlinkDir, "target.sqlite");
      await fs.writeFile(targetPath, "", { mode: 0o600 });
      const databasePath = path.join(symlinkDir, "pactium.sqlite");
      await fs.symlink(targetPath, databasePath);
      const symlinkStorage = createSqliteStoragePort({ dataDir: symlinkDir });
      await assert.rejects(() => symlinkStorage.initialize(), { code: "PACTIUM_PRIVATE_PATH_INVALID" });
      await symlinkStorage.close();
    }
  });

  it("rejects an initialization that races SQLite close without leaking descriptors", async (context) => {
    if (!sqliteStorageAvailable()) {
      context.skip("SQLite storage driver unavailable");
      return;
    }
    const dataDir = await tempDataDir("pactium-sqlite-initialize-close-");
    const storage = createSqliteStoragePort({ dataDir });
    const initialization = storage.initialize();
    const closing = storage.close();
    await assert.rejects(() => initialization, { code: "PACTIUM_STORAGE_CLOSED" });
    await closing;
    const descriptorCount = await descriptorsUnder(dataDir);
    if (descriptorCount !== null) assert.equal(descriptorCount, 0);
  });

  it("closes selected and uninitialized auto ports without selecting a backend during close", async () => {
    const unopenedDir = await tempDataDir("pactium-auto-unopened-");
    const unopened = createStoragePort({ dataDir: unopenedDir, storageBackend: "auto" });
    await Promise.all([unopened.close(), unopened.close()]);
    assert.equal(await fs.stat(path.join(unopenedDir, "pactium-manifest.json")).then(() => true, () => false), false);
    await assert.rejects(() => unopened.initialize(), { code: "PACTIUM_STORAGE_CLOSED" });

    const selectedDir = await tempDataDir("pactium-auto-selected-");
    const selected = createStoragePort({ dataDir: selectedDir, storageBackend: "auto" });
    await selected.initialize();
    await Promise.all([selected.close(), selected.close()]);
    await assert.rejects(() => selected.getProtocolObject("scope", "key"), { code: "PACTIUM_STORAGE_CLOSED" });

    const racingDir = await tempDataDir("pactium-auto-selection-close-");
    const racing = createStoragePort({ dataDir: racingDir, storageBackend: "auto" });
    const initialization = racing.initialize();
    const closing = racing.close();
    await assert.rejects(() => initialization, { code: "PACTIUM_STORAGE_CLOSED" });
    await closing;
    assert.equal(await fs.stat(path.join(racingDir, "pactium-manifest.json")).then(() => true, () => false), false);
  });

  it("closes only storage owned by createPactium", async () => {
    const ownedDir = await tempDataDir("pactium-core-owned-close-");
    const ownedCore = createPactium({ dataDir: ownedDir, storageBackend: "auto" });
    await ownedCore.readProtocolObject("scope", "missing", null);
    const ownedStorage = getPactiumInternals(ownedCore).storage;
    await Promise.all([ownedCore.close(), ownedCore.close()]);
    await assert.rejects(() => ownedStorage.initialize(), { code: "PACTIUM_STORAGE_CLOSED" });

    const externalStorage = createStoragePort({ inMemory: true });
    let externalCloseCalls = 0;
    const observedStorage = {
      ...externalStorage,
      async close() {
        externalCloseCalls += 1;
        await externalStorage.close();
      }
    };
    const externalCore = createPactium({ storage: observedStorage });
    await externalCore.readProtocolObject("scope", "missing", null);
    await Promise.all([externalCore.close(), externalCore.close()]);
    assert.equal(externalCloseCalls, 0);
    await observedStorage.putProtocolObject("scope", "still-open", { ok: true });
    await observedStorage.close();
  });

  it("rejects new core calls as soon as close starts and drains already admitted work", async () => {
    const backingStorage = createStoragePort({ inMemory: true });
    let releaseMutation;
    let mutationEntered;
    const entered = new Promise((resolve) => {
      mutationEntered = resolve;
    });
    const mutationGate = new Promise((resolve) => {
      releaseMutation = resolve;
    });
    const storage = {
      ...backingStorage,
      async initialize() {
        mutationEntered();
        await mutationGate;
        return backingStorage.initialize();
      }
    };
    const core = createPactium({ storage });
    const admittedMutation = core.recordOperation({
      operationId: "lifecycle.admitted",
      workspaceId: "lifecycle",
      stateMutations: [{ key: "state/key", value: { ok: true } }]
    });
    await entered;

    let closeSettled = false;
    const closing = core.close().then(() => {
      closeSettled = true;
    });
    await assert.rejects(
      () => core.recordOperation({ operationId: "lifecycle.rejected" }),
      { code: "PACTIUM_CLOSED" }
    );
    await assert.rejects(
      () => core.readProtocolObject("scope", "key", null),
      { code: "PACTIUM_CLOSED" }
    );
    assert.throws(() => core.verifyCursor({}, {}), { code: "PACTIUM_CLOSED" });
    await Promise.resolve();
    assert.equal(closeSettled, false);

    releaseMutation();
    await admittedMutation;
    await closing;
    assert.equal(closeSettled, true);
    await backingStorage.close();
  });
});
