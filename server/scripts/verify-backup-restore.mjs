#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SERVER_API_OPERATIONS } from "../platform/common/operation-dispatcher/operation-registry.mjs";
import {
  BACKUP_RESTORE_PROTOCOL_VERSION,
  createStorageBackup,
  listStorageBackups,
  restoreStorageBackup
} from "../platform/common/storage/backup-restore.mjs";
import { createToolCatalog } from "../platform/specialized/capabilities/tools/tool-management-core/catalog.mjs";

async function writeFixture(root, relativePath, content) {
  const filePath = path.join(root, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
  return filePath;
}

async function verifyBackupRestore(tempRoot) {
  await writeFixture(tempRoot, "settings.json", JSON.stringify({ version: 1, name: "before" }, null, 2));
  await writeFixture(tempRoot, "jobs/job-a/meta.json", JSON.stringify({ status: "completed" }, null, 2));
  await writeFixture(tempRoot, "objects/raw-a.txt", "canonical raw object\n");
  await writeFixture(tempRoot, "checkpoint-trees/tree-a.json", JSON.stringify({ status: "running" }, null, 2));
  await writeFixture(tempRoot, "logs/runtime/ignored.jsonl", "must not enter backup\n");

  const backup = await createStorageBackup({ userDataPath: tempRoot, label: "verify" });
  assert.equal(backup.protocolVersion, BACKUP_RESTORE_PROTOCOL_VERSION);
  assert.ok(backup.backupId.startsWith("backup_"));
  assert.equal(backup.summary.fileCount, 4);
  assert.equal(backup.summary.byCategory["json-state"], 1);
  assert.equal(backup.summary.byCategory.jobs, 1);
  assert.equal(backup.summary.byCategory["raw-object"], 1);
  assert.equal(backup.summary.byCategory["checkpoint-tree"], 1);
  assert.ok(!backup.files.some((entry) => entry.relativePath.startsWith("logs/")));

  const listed = await listStorageBackups({ userDataPath: tempRoot });
  assert.equal(listed.protocolVersion, BACKUP_RESTORE_PROTOCOL_VERSION);
  assert.equal(listed.backups.length, 1);
  assert.equal(listed.backups[0].backupId, backup.backupId);

  await writeFixture(tempRoot, "settings.json", JSON.stringify({ version: 2, name: "after" }, null, 2));
  await fs.rm(path.join(tempRoot, "objects/raw-a.txt"), { force: true });

  const preview = await restoreStorageBackup({
    userDataPath: tempRoot,
    backupId: backup.backupId,
    includePaths: ["settings.json", "objects"]
  });
  assert.equal(preview.protocolVersion, BACKUP_RESTORE_PROTOCOL_VERSION);
  assert.equal(preview.dryRun, true);
  assert.equal(preview.summary.replace, 1);
  assert.equal(preview.summary.create, 1);
  assert.equal(preview.summary.noop, 0);

  const restored = await restoreStorageBackup({
    userDataPath: tempRoot,
    backupId: backup.backupId,
    dryRun: false,
    apply: true,
    includePaths: ["settings.json", "objects"]
  });
  assert.equal(restored.applied, true);
  assert.ok(restored.reportPath.endsWith(".json"));
  assert.match(await fs.readFile(path.join(tempRoot, "settings.json"), "utf8"), /"before"/);
  assert.equal(await fs.readFile(path.join(tempRoot, "objects/raw-a.txt"), "utf8"), "canonical raw object\n");

  await assert.rejects(
    () => restoreStorageBackup({ userDataPath: tempRoot, backupId: "../../outside" }),
    /Invalid backupId/
  );
}

function verifyOperationsAndTools() {
  const operations = new Map(SERVER_API_OPERATIONS.map((operation) => [operation.id, operation]));
  for (const id of [
    "storage.backups.list",
    "storage.backups.create",
    "storage.backups.restore_preview",
    "storage.backups.restore"
  ]) {
    assert.ok(operations.has(id), `${id} must be registered`);
  }
  assert.equal(operations.get("storage.backups.create").http.path, "/api/storage/backups");
  assert.equal(operations.get("storage.backups.restore").safety.risk, "repair_write");
  assert.equal(operations.get("storage.backups.restore_preview").readOnly, true);

  const catalog = createToolCatalog({ operations: SERVER_API_OPERATIONS });
  const restoreTool = catalog.tools.find((tool) => tool.id === "pact.storageBackups.restore");
  assert.ok(restoreTool, "storage restore tool must be exposed");
  assert.equal(restoreTool.operationId, "storage.backups.restore");
  assert.ok(restoreTool.toolsets.includes("pact.runtime.maintain"));
  assert.ok(restoreTool.requiredScopes.includes("runtime:admin"));
}

async function main() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pact-backup-restore-"));
  try {
    await verifyBackupRestore(tempRoot);
    verifyOperationsAndTools();
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
  console.log("[backup-restore] ok");
}

await main();
