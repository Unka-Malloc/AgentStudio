import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  afterEach,
  describe,
  expect,
  it
} from "vitest";

import {
  BACKUP_RESTORE_PROTOCOL_VERSION,
  createStorageBackup,
  listStorageBackups,
  restoreStorageBackup
} from "../../../server/platform/common/storage/backup-restore.mjs";

const tempRoots = [];

async function tempDir(prefix) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

async function writeFixture(root, relativePath, content = "") {
  const filePath = path.join(root, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, String(content), "utf8");
  return filePath;
}

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))
  );
});

describe("storage backup restore", () => {
  it("createStorageBackup skips excluded top-level directories and classifies files", async () => {
    const userDataPath = await tempDir("pact-backup-classify-");
    await writeFixture(userDataPath, "auth/token.json", JSON.stringify({ token: "abc" }));
    await writeFixture(userDataPath, "jobs/queue.json", JSON.stringify({ state: "queued" }));
    await writeFixture(userDataPath, "objects/index.dat", "objects");
    await writeFixture(userDataPath, "raw-objects/raw.bin", "raw data");
    await writeFixture(userDataPath, "checkpoint-trees/root/index.dat", "checkpoint");
    await writeFixture(userDataPath, "state.sqlite", "database-bytes");
    await writeFixture(userDataPath, "state.json", "{\"ok\":true}");
    await writeFixture(userDataPath, "app.yaml", "node: 1");
    await writeFixture(userDataPath, "notes/readme.txt", "plain text");
    await writeFixture(userDataPath, "nested/a/b/c.md", "# markdown");
    await writeFixture(userDataPath, "backups/old/should-not-backup.txt", "ignored");
    await writeFixture(userDataPath, "logs/error.log", "ignored");
    await writeFixture(userDataPath, "tmp/cache.dat", "ignored");

    const manifest = await createStorageBackup({
      userDataPath,
      label: "scope"
    });

    expect(manifest.protocolVersion).toBe(BACKUP_RESTORE_PROTOCOL_VERSION);
    expect(manifest.label).toBe("scope");
    expect(manifest.summary.fileCount).toBe(10);
    expect(manifest.summary.byCategory).toMatchObject({
      auth: 1,
      jobs: 1,
      "raw-object": 2,
      "checkpoint-tree": 1,
      database: 1,
      "json-state": 1,
      config: 1,
      file: 2
    });

    const paths = new Set(manifest.files.map((item) => item.relativePath));
    expect(paths.has("backups/old/should-not-backup.txt")).toBe(false);
    expect(paths.has("logs/error.log")).toBe(false);
    expect(paths.has("tmp/cache.dat")).toBe(false);

    expect(paths.has("auth/token.json")).toBe(true);
    expect(paths.has("jobs/queue.json")).toBe(true);
    expect(paths.has("objects/index.dat")).toBe(true);
    expect(paths.has("raw-objects/raw.bin")).toBe(true);
    expect(paths.has("checkpoint-trees/root/index.dat")).toBe(true);
    expect(paths.has("state.sqlite")).toBe(true);
    expect(paths.has("state.json")).toBe(true);
    expect(paths.has("app.yaml")).toBe(true);
    expect(paths.has("notes/readme.txt")).toBe(true);
    expect(paths.has("nested/a/b/c.md")).toBe(true);
  });

  it("listStorageBackups returns empty for missing backup root and ignores malformed entries", async () => {
    const userDataPath = await tempDir("pact-backup-list-missing-");
    const emptyListing = await listStorageBackups({ userDataPath });
    expect(emptyListing).toEqual({
      schemaVersion: 1,
      protocolVersion: BACKUP_RESTORE_PROTOCOL_VERSION,
      backups: []
    });

    const validBackup = await createStorageBackup({ userDataPath, label: "valid" });
    const invalidBackupId = "not-a-backup-id";
    const invalidDir = path.join(userDataPath, "backups", invalidBackupId);
    await fs.mkdir(invalidDir, { recursive: true });
    await writeFixture(invalidDir, "backup-manifest.json", JSON.stringify({
      schemaVersion: 1,
      protocolVersion: "other.protocol",
      backupId: invalidBackupId,
      createdAt: "1999-01-01T00:00:00.000Z",
      backupPath: invalidDir,
      filesRoot: path.join(invalidDir, "files"),
      summary: { fileCount: 0, bytes: 0, byCategory: {} },
      files: []
    }));
    await fs.mkdir(path.join(invalidDir, "files"), { recursive: true });

    const listing = await listStorageBackups({ userDataPath });
    expect(listing.backups).toHaveLength(1);
    expect(listing.backups[0].backupId).toBe(validBackup.backupId);
    expect(new Date(listing.backups[0].createdAt).getTime()).toBeGreaterThan(0);
  });

  it("restoreStorageBackup validates backupId and include path constraints", async () => {
    const userDataPath = await tempDir("pact-backup-restore-validate-");
    const manifest = await createStorageBackup({ userDataPath, label: "validated" });

    await expect(
      restoreStorageBackup({
        userDataPath,
        backupId: "bad backup id",
        includePaths: []
      })
    ).rejects.toThrow("Invalid backupId.");

    await expect(
      restoreStorageBackup({
        userDataPath,
        backupId: manifest.backupId,
        includePaths: ["../outside", "notes/readme.txt"]
      })
    ).rejects.toThrow("Unsafe backup relative path: ../outside");
  });

  it("restoreStorageBackup dry-run classifies create, replace and noop actions with include filtering", async () => {
    const userDataPath = await tempDir("pact-backup-restore-dryrun-");
    await writeFixture(userDataPath, "scope/keep.txt", "same-content");
    await writeFixture(userDataPath, "scope/replace.txt", "old-content");
    await writeFixture(userDataPath, "scope/create.txt", "will-be-removed");

    const manifest = await createStorageBackup({ userDataPath, label: "dry-run" });
    await writeFixture(userDataPath, "scope/replace.txt", "changed-content");
    await fs.rm(path.join(userDataPath, "scope/create.txt"), { force: true });

    const report = await restoreStorageBackup({
      userDataPath,
      backupId: manifest.backupId,
      includePaths: ["scope"]
    });

    expect(report.dryRun).toBe(true);
    expect(report.applied).toBe(false);
    expect(report.selectedFileCount).toBe(3);
    expect(report.summary).toMatchObject({
      create: 1,
      replace: 1,
      noop: 1,
      blocked: 0
    });

    const actions = Object.fromEntries(report.plannedActions.map((item) => [item.relativePath, item]));
    expect(actions["scope/create.txt"]).toMatchObject({
      action: "create",
      reason: "target_missing",
      expectedSha256: expect.any(String)
    });
    expect(actions["scope/replace.txt"]).toMatchObject({
      action: "replace",
      reason: "hash_mismatch",
      currentSha256: expect.any(String),
      expectedSha256: expect.any(String)
    });
    expect(actions["scope/keep.txt"]).toMatchObject({
      action: "noop",
      reason: "hash_match"
    });
  });

  it("restoreStorageBackup marks blocked entries when backup files are missing", async () => {
    const userDataPath = await tempDir("pact-backup-restore-blocked-");
    await writeFixture(userDataPath, "scope/blocked.txt", "missing-backup-file");

    const manifest = await createStorageBackup({ userDataPath, label: "blocked" });
    await fs.rm(path.join(manifest.filesRoot, "scope/blocked.txt"), { force: true });

    const preview = await restoreStorageBackup({
      userDataPath,
      backupId: manifest.backupId,
      includePaths: ["scope/blocked.txt"]
    });

    expect(preview.summary.blocked).toBe(1);
    expect(preview.plannedActions).toHaveLength(1);
    expect(preview.plannedActions[0]).toMatchObject({
      relativePath: "scope/blocked.txt",
      action: "blocked",
      reason: "backup_file_missing"
    });

    await expect(
      restoreStorageBackup({
        userDataPath,
        backupId: manifest.backupId,
        dryRun: false,
        apply: true,
        includePaths: ["scope/blocked.txt"]
      })
    ).rejects.toThrow("Cannot restore scope/blocked.txt: backup_file_missing");
  });

  it("restoreStorageBackup apply branch writes report and performs target updates", async () => {
    const userDataPath = await tempDir("pact-backup-restore-apply-");
    await writeFixture(userDataPath, "restore/keep.txt", "stable");
    await writeFixture(userDataPath, "restore/replace.txt", "old-content");
    await writeFixture(userDataPath, "restore/create.txt", "will be recreated");

    const manifest = await createStorageBackup({ userDataPath, label: "apply" });
    await fs.writeFile(path.join(userDataPath, "restore/replace.txt"), "changed", "utf8");
    await fs.rm(path.join(userDataPath, "restore/create.txt"), { force: true });

    const report = await restoreStorageBackup({
      userDataPath,
      backupId: manifest.backupId,
      dryRun: false,
      apply: true,
      includePaths: ["restore"]
    });

    expect(report.applied).toBe(true);
    expect(report.dryRun).toBe(false);
    expect(report.summary).toMatchObject({
      create: 1,
      replace: 1,
      noop: 1
    });
    expect(typeof report.reportPath).toBe("string");

    await expect(fs.access(report.reportPath)).resolves.toBeUndefined();
    const reportData = JSON.parse(await fs.readFile(report.reportPath, "utf8"));
    expect(reportData.applied).toBe(true);
    expect(reportData.dryRun).toBe(false);
    expect(reportData.selectedFileCount).toBe(3);

    expect(await fs.readFile(path.join(userDataPath, "restore/create.txt"), "utf8")).toBe("will be recreated");
    expect(await fs.readFile(path.join(userDataPath, "restore/replace.txt"), "utf8")).toBe("old-content");
    expect(await fs.readFile(path.join(userDataPath, "restore/keep.txt"), "utf8")).toBe("stable");
  });
});
