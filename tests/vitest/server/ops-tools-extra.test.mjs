import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { runStorageDoctor, locateStorageEntity, reconcileStorage } from "../../../server/platform/common/storage/ops-tools.mjs";
import {
  getMetadataDatabasePath,
  initializeMetadataSchema
} from "../../../server/platform/common/storage/schema-manager.mjs";

const FIXED_NOW = "2026-01-01T00:00:00.000Z";

async function createTempUserDataPath(prefix = "pact-ops-tools-") {
  return await fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function createMetadataDb(userDataPath) {
  await fs.mkdir(path.dirname(getMetadataDatabasePath(userDataPath)), { recursive: true });
  const db = new Database(getMetadataDatabasePath(userDataPath));
  initializeMetadataSchema(db);
  return db;
}

async function writeJobArtifacts(userDataPath, jobId, {
  withMeta = true,
  withPayload = true,
  withResult = true
} = {}) {
  const jobDirectory = path.join(userDataPath, "jobs", jobId);
  await fs.mkdir(jobDirectory, { recursive: true });

  if (withMeta) {
    await fs.writeFile(path.join(jobDirectory, "meta.json"), JSON.stringify({ jobId }), "utf8");
  }

  if (withPayload) {
    await fs.writeFile(path.join(jobDirectory, "payload.json"), JSON.stringify({ sourceType: "mail" }), "utf8");
  }

  if (withResult) {
    await fs.writeFile(path.join(jobDirectory, "result.json"), JSON.stringify({ ok: true }), "utf8");
  }
}

function insertBatchRow(db, {
  batchId,
  jobId,
  status = "completed",
  sourceCount = 0,
  rawObjectCount = 0,
  emailCount = 0,
  threadCount = 0,
  transactionCount = 0,
  peopleCount = 0,
  retrievalCount = 0
}) {
  db.prepare(`
    INSERT INTO import_batches (
      batch_id, job_id, status, created_at, updated_at, generated_at,
      settings_json, warnings_json, overview_json,
      source_count, raw_object_count, email_count, thread_count,
      transaction_count, people_count, retrieval_count, error
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    batchId,
    jobId,
    status,
    FIXED_NOW,
    FIXED_NOW,
    FIXED_NOW,
    "{}",
    "[]",
    "{}",
    sourceCount,
    rawObjectCount,
    emailCount,
    threadCount,
    transactionCount,
    peopleCount,
    retrievalCount,
    ""
  );
}

function insertRawObject(db, {
  objectId,
  batchId,
  sourceRef,
  storageRelativePath,
  clientUid = "client-local",
  sourceType = "mail"
}) {
  db.prepare(`
    INSERT INTO raw_mail_objects (
      object_id, batch_id, source_ref, ingest_origin, original_file_name,
      original_relative_path, client_uid, source_type, provider_id, external_id,
      sync_batch_id, content_hash, captured_at, source_metadata_json,
      archive_file_name, original_source_path, source_container_path,
      storage_rel_path, sha256, byte_size, media_type,
      source_created_at, source_updated_at, source_collected_at, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    objectId,
    batchId,
    sourceRef,
    "unit-test",
    `${objectId}.eml`,
    `${sourceRef}.eml`,
    clientUid,
    sourceType,
    "provider-local",
    `${objectId}-external`,
    `${objectId}-sync`,
    `sha-${objectId}`,
    FIXED_NOW,
    "{}",
    `${objectId}.archive.eml`,
    "/source/path",
    "/container/path",
    storageRelativePath,
    `sha256-${objectId}`,
    12,
    "message/rfc822",
    FIXED_NOW,
    FIXED_NOW,
    FIXED_NOW,
    FIXED_NOW
  );
}

function insertSourceFile(db, {
  recordId,
  batchId,
  sourceRef,
  rawObjectId = null
}) {
  db.prepare(`
    INSERT INTO source_files (
      record_id, batch_id, source_ref, name, source_path, kind,
      raw_object_id, source_created_at, source_updated_at, source_collected_at,
      provider_id, external_id, sync_batch_id, content_hash, captured_at,
      source_metadata_json, media_type, extracted_text, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    recordId,
    batchId,
    sourceRef,
    `${sourceRef}.eml`,
    sourceRef,
    "mail",
    rawObjectId,
    FIXED_NOW,
    FIXED_NOW,
    FIXED_NOW,
    "provider-local",
    `${recordId}-external`,
    `${recordId}-sync`,
    `hash-${recordId}`,
    FIXED_NOW,
    "{}",
    "message/rfc822",
    "text",
    FIXED_NOW
  );
}

function insertEmailMessage(db, {
  recordId,
  batchId,
  messageId,
  sourceRef,
  rawObjectId = null
}) {
  db.prepare(`
    INSERT INTO email_messages (
      record_id, batch_id, message_id, source_ref, raw_object_id,
      subject, normalized_subject, sent_at, excerpt, body,
      time_weight, freshness, status, formal_use_allowed
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    recordId,
    batchId,
    messageId,
    sourceRef,
    rawObjectId,
    `subject-${recordId}`,
    `subject-${recordId}`,
    FIXED_NOW,
    "excerpt",
    "message body",
    0.1,
    "current",
    "done",
    1
  );
}

function insertRetrievalDocument(db, {
  recordId,
  batchId
}) {
  db.prepare(`
    INSERT INTO retrieval_documents (
      record_id, batch_id, retrieval_id, entity_type, entity_id,
      title, text, snippet, timestamp, source,
      time_weight, freshness, status, formal_use_allowed, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    recordId,
    batchId,
    `ret-${recordId}`,
    "mail",
    `entity-${recordId}`,
    `Title ${recordId}`,
    "text",
    "snippet",
    FIXED_NOW,
    "source",
    1,
    "current",
    "done",
    1,
    FIXED_NOW
  );
}

function insertRetrievalFts(db, { recordId }) {
  db.prepare(`
    INSERT INTO retrieval_fts (record_id, title, search_text, source, keywords)
    VALUES (?, ?, ?, ?, ?)
  `).run(recordId, `Title ${recordId}`, "search", "source", "keyword");
}

function insertStaleDeletionOperation(db, { operationId, batchId }) {
  db.prepare(`
    INSERT INTO batch_deletion_operations (
      operation_id, batch_id, job_id, status, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(operationId, batchId, `job-${batchId}`, "pending", FIXED_NOW, FIXED_NOW);
}

describe("storage ops tools", () => {
  it("returns missing-database findings and orphaned filesystem entities", async () => {
    const root = await createTempUserDataPath();

    await fs.mkdir(path.join(root, "jobs", "legacy-job"), { recursive: true });
    await fs.mkdir(path.join(root, "objects", "mail"), { recursive: true });
    await fs.writeFile(path.join(root, "jobs", "legacy-job", "note.txt"), "legacy", "utf8");
    await fs.writeFile(path.join(root, "objects", "mail", "orphan.eml"), "orphan", "utf8");

    try {
      const doctor = await runStorageDoctor({ userDataPath: root });

      expect(doctor.databasePresent).toBe(false);
      expect(doctor.summary).toMatchObject({
        batchCount: 0,
        rawObjectCount: 0,
        sourceCount: 0,
        emailCount: 0,
        threadCount: 0,
        transactionCount: 0,
        peopleCount: 0,
        retrievalCount: 0
      });
      expect(doctor.issues.databaseMissing).toEqual([{ databasePath: getMetadataDatabasePath(root) }]);
      expect(doctor.issues.orphanJobDirectories).toEqual([
        {
          jobId: "legacy-job",
          path: path.join(root, "jobs", "legacy-job")
        }
      ]);
      expect(doctor.issues.orphanRawObjectFiles).toEqual([
        {
          storageRelativePath: "objects/mail/orphan.eml",
          path: path.join(root, "objects", "mail", "orphan.eml")
        }
      ]);
      expect(doctor.healthy).toBe(false);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("detects missing job artifacts, dangling references, and count mismatches", async () => {
    const root = await createTempUserDataPath("pact-ops-tools-mismatch-");
    const db = await createMetadataDb(root);

    await writeJobArtifacts(root, "job-a", { withResult: false, withPayload: false });
    await fs.mkdir(path.join(root, "objects"), { recursive: true });
    await fs.mkdir(path.join(root, "jobs", "orphan-job"), { recursive: true });
    await fs.writeFile(path.join(root, "objects", "orphan.bin"), "orphan", "utf8");

    insertBatchRow(db, {
      batchId: "batch-a",
      jobId: "job-a",
      sourceCount: 0,
      rawObjectCount: 0,
      emailCount: 0,
      threadCount: 0,
      transactionCount: 0,
      peopleCount: 0,
      retrievalCount: 0
    });
    insertRawObject(db, {
      objectId: "obj-a",
      batchId: "batch-a",
      sourceRef: "source-a",
      storageRelativePath: "objects/client-a/missing.bin"
    });
    insertSourceFile(db, {
      recordId: "source-record-a",
      batchId: "batch-a",
      sourceRef: "source-a",
      rawObjectId: "ghost-object"
    });
    insertEmailMessage(db, {
      recordId: "message-a",
      batchId: "batch-a",
      messageId: "msg-a",
      sourceRef: "source-a",
      rawObjectId: "ghost-message-object"
    });
    insertRetrievalDocument(db, {
      recordId: "retrieval-a",
      batchId: "batch-a"
    });
    insertRetrievalFts(db, { recordId: "ghost-doc" });
    insertStaleDeletionOperation(db, { operationId: "op-stale", batchId: "batch-stale" });

    try {
      const doctor = await runStorageDoctor({ userDataPath: root });

      expect(doctor.databasePresent).toBe(true);
      expect(doctor.healthy).toBe(false);
      expect(doctor.issues.missingJobMeta).toEqual([]);
      expect(doctor.issues.missingJobPayload).toEqual([
        {
          jobId: "job-a",
          batchId: "batch-a",
          path: path.join(root, "jobs", "job-a", "payload.json")
        }
      ]);
      expect(doctor.issues.missingJobResult).toEqual([
        {
          jobId: "job-a",
          batchId: "batch-a",
          path: path.join(root, "jobs", "job-a", "result.json")
        }
      ]);
      expect(doctor.issues.orphanJobDirectories).toEqual([
        {
          jobId: "orphan-job",
          path: path.join(root, "jobs", "orphan-job")
        }
      ]);
      expect(doctor.issues.missingRawObjectFiles).toEqual([
        {
          objectId: "obj-a",
          batchId: "batch-a",
          storageRelativePath: "objects/client-a/missing.bin",
          path: path.join(root, "objects", "client-a", "missing.bin")
        }
      ]);
      expect(doctor.issues.orphanRawObjectFiles).toEqual([
        {
          storageRelativePath: "objects/orphan.bin",
          path: path.join(root, "objects", "orphan.bin")
        }
      ]);
      expect(doctor.issues.danglingSourceRawObjectRefs).toEqual([
        {
          batchId: "batch-a",
          sourceId: "source-a",
          rawObjectId: "ghost-object"
        }
      ]);
      expect(doctor.issues.danglingMessageRawObjectRefs).toEqual([
        {
          batchId: "batch-a",
          messageId: "msg-a",
          rawObjectId: "ghost-message-object"
        }
      ]);
      expect(doctor.issues.retrievalFtsMissingRows).toEqual([
        {
          recordId: "retrieval-a",
          title: "Title retrieval-a"
        }
      ]);
      expect(doctor.issues.retrievalFtsOrphanRows).toEqual([
        {
          recordId: "ghost-doc"
        }
      ]);
      expect(doctor.issues.staleDeletionOperations).toEqual([
        {
          operationId: "op-stale",
          batchId: "batch-stale",
          jobId: "job-batch-stale",
          status: "pending",
          error: "",
          updatedAt: FIXED_NOW
        }
      ]);
      expect(doctor.issues.batchCountMismatches).toEqual([
        {
          batchId: "batch-a",
          jobId: "job-a",
          stored: {
            rawObjectCount: 0,
            sourceCount: 0,
            emailCount: 0,
            threadCount: 0,
            transactionCount: 0,
            peopleCount: 0,
            retrievalCount: 0
          },
          actual: {
            rawObjectCount: 1,
            sourceCount: 1,
            emailCount: 1,
            threadCount: 0,
            transactionCount: 0,
            peopleCount: 0,
            retrievalCount: 1
          }
        }
      ]);
    } finally {
      db.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("throws on missing locate query arguments", async () => {
    const root = await createTempUserDataPath();
    try {
      await expect(
        locateStorageEntity({ userDataPath: root })
      ).rejects.toThrow("至少需要提供 --job-id、--batch-id 或 --object-id 其中一个参数。");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("returns fallback job projection when database is absent", async () => {
    const root = await createTempUserDataPath("pact-ops-tools-no-db-");
    await writeJobArtifacts(root, "batch-legacy", { withPayload: true, withResult: true });

    try {
      const result = await locateStorageEntity({ userDataPath: root, batchId: "batch-legacy" });

      expect(result.databasePresent).toBe(false);
      expect(result.jobsRootPresent).toBe(true);
      expect(result.objectRootPresent).toBe(false);
      expect(result.query.batchId).toBe("batch-legacy");
      expect(result.job.jobId).toBe("batch-legacy");
      expect(result.job.meta).toMatchObject({ jobId: "batch-legacy" });
      expect(result.batch).toBeUndefined();
      expect(result.object).toBeUndefined();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("looks up batch and object details when metadata is present", async () => {
    const root = await createTempUserDataPath("pact-ops-tools-locate-present-");
    const db = await createMetadataDb(root);

    await writeJobArtifacts(root, "job-live");
    await fs.mkdir(path.join(root, "objects", "client-live"), { recursive: true });
    await fs.writeFile(path.join(root, "objects", "client-live", "stored.bin"), "payload", "utf8");

    insertBatchRow(db, {
      batchId: "batch-live",
      jobId: "job-live"
    });
    insertRawObject(db, {
      objectId: "obj-live",
      batchId: "batch-live",
      sourceRef: "source-live",
      storageRelativePath: "objects/client-live/stored.bin",
      clientUid: "client-live",
      sourceType: "mail-forward"
    });
    insertSourceFile(db, {
      recordId: "source-live",
      batchId: "batch-live",
      sourceRef: "source-live",
      rawObjectId: "obj-live"
    });
    insertEmailMessage(db, {
      recordId: "message-live",
      batchId: "batch-live",
      messageId: "message-live",
      sourceRef: "source-live",
      rawObjectId: "obj-live"
    });

    try {
      const result = await locateStorageEntity({ userDataPath: root, jobId: "job-live", objectId: "obj-live" });

      expect(result.databasePresent).toBe(true);
      expect(result.job.jobId).toBe("job-live");
      expect(result.batch).toMatchObject({
        batchId: "batch-live",
        jobId: "job-live",
        deletionOperation: null
      });
      expect(result.batch.sampleObjects).toHaveLength(1);
      expect(result.batch.sampleSources).toHaveLength(1);
      expect(result.object).toMatchObject({
        objectId: "obj-live",
        batchId: "batch-live",
        sourceId: "source-live",
        clientUid: "client-live",
        sourceType: "mail-forward",
        path: path.join(root, "objects", "client-live", "stored.bin"),
        exists: true
      });
      expect(result.object.source).toMatchObject({
        source_ref: "source-live"
      });
      expect(result.object.messages).toEqual([
        {
          message_id: "message-live",
          subject: "subject-message-live",
          thread_id: "",
          transaction_id: ""
        }
      ]);

      const missingObject = await locateStorageEntity({ userDataPath: root, objectId: "missing-id" });
      expect(missingObject.object).toBeUndefined();
      expect(missingObject.batch).toBeUndefined();
    } finally {
      db.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("dry-runs reconciliation without mutating state", async () => {
    const root = await createTempUserDataPath("pact-ops-tools-dryrun-");
    const db = await createMetadataDb(root);
    await fs.mkdir(path.join(root, "objects"), { recursive: true });
    await fs.mkdir(path.join(root, "jobs", "job-dry"), { recursive: true });
    await fs.writeFile(path.join(root, "objects", "dangling.bin"), "dangling", "utf8");

    insertBatchRow(db, {
      batchId: "batch-dry",
      jobId: "job-dry",
      sourceCount: 0,
      rawObjectCount: 0,
      emailCount: 0,
      retrievalCount: 0
    });
    insertRawObject(db, {
      objectId: "obj-dry",
      batchId: "batch-dry",
      sourceRef: "source-dry",
      storageRelativePath: "objects/client-dry/missing.bin"
    });
    insertSourceFile(db, {
      recordId: "source-dry",
      batchId: "batch-dry",
      sourceRef: "source-dry",
      rawObjectId: "obj-dry"
    });
    insertRetrievalDocument(db, {
      recordId: "retrieval-dry",
      batchId: "batch-dry"
    });

    const report = await reconcileStorage({
      userDataPath: root,
      apply: false,
      pruneOrphanObjects: true
    });

    try {
      expect(report.databasePresent).toBe(true);
      expect(report.healthyAfter).toBe(false);
      expect(report.appliedActions).toEqual({
        rebuiltRetrievalFts: 0,
        syncedBatchCounts: 0,
        clearedStaleDeletionOperations: 0,
        prunedOrphanRawObjectFiles: 0
      });
      expect(report.plannedActions.rebuildRetrievalFts).toBe(1);
      expect(report.plannedActions.syncBatchCounts).toBe(1);
      expect(report.plannedActions.clearStaleDeletionOperations).toBe(0);
      expect(report.doctor.issues.retrievalFtsMissingRows).toHaveLength(1);
      await expect(fs.readFile(path.join(root, "objects", "dangling.bin"), "utf8")).resolves.toBe("dangling");
    } finally {
      db.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("applies fixes for repairable issues and removes orphan objects when enabled", async () => {
    const root = await createTempUserDataPath("pact-ops-tools-apply-");
    const db = await createMetadataDb(root);

    await writeJobArtifacts(root, "job-apply");
    await fs.mkdir(path.join(root, "objects"), { recursive: true });
    await fs.mkdir(path.join(root, "objects", "client-live"), { recursive: true });
    await fs.writeFile(path.join(root, "objects", "client-live", "stored.bin"), "payload", "utf8");
    await fs.writeFile(path.join(root, "objects", "ghost.bin"), "ghost", "utf8");

    insertBatchRow(db, {
      batchId: "batch-apply",
      jobId: "job-apply",
      sourceCount: 0,
      rawObjectCount: 0,
      emailCount: 0,
      retrievalCount: 0
    });
    insertRawObject(db, {
      objectId: "obj-apply",
      batchId: "batch-apply",
      sourceRef: "source-apply",
      storageRelativePath: "objects/client-live/stored.bin"
    });
    insertSourceFile(db, {
      recordId: "source-apply",
      batchId: "batch-apply",
      sourceRef: "source-apply",
      rawObjectId: "obj-apply"
    });
    insertRetrievalDocument(db, {
      recordId: "retrieval-apply",
      batchId: "batch-apply"
    });
    insertStaleDeletionOperation(db, {
      operationId: "op-stale-apply",
      batchId: "batch-stale"
    });

    const report = await reconcileStorage({
      userDataPath: root,
      apply: true,
      pruneOrphanObjects: true
    });

    try {
      expect(report.databasePresent).toBe(true);
      expect(report.healthyAfter).toBe(true);
      expect(report.appliedActions).toMatchObject({
        rebuiltRetrievalFts: 1,
        syncedBatchCounts: 1,
        clearedStaleDeletionOperations: 1,
        prunedOrphanRawObjectFiles: 1
      });
      expect(report.doctor.issues.retrievalFtsMissingRows).toHaveLength(0);
      expect(report.doctor.issues.retrievalFtsOrphanRows).toHaveLength(0);
      expect(report.doctor.issues.staleDeletionOperations).toHaveLength(0);
      await expect(fs.stat(path.join(root, "objects", "ghost.bin"))).rejects.toThrow();
      const afterDb = new Database(getMetadataDatabasePath(root));
      const batch = afterDb.prepare("SELECT raw_object_count, retrieval_count FROM import_batches WHERE batch_id = ?").get("batch-apply");
      afterDb.close();
      expect(batch.raw_object_count).toBe(1);
      expect(batch.retrieval_count).toBe(1);
    } finally {
      db.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("returns immediately in dry-run mode when metadata DB is missing", async () => {
    const root = await createTempUserDataPath("pact-ops-tools-no-db-reconcile-");
    try {
      const report = await reconcileStorage({
        userDataPath: root,
        apply: true,
        pruneOrphanObjects: true
      });

      expect(report.databasePresent).toBe(false);
      expect(report.healthyAfter).toBe(false);
      expect(report.plannedActions.rebuildRetrievalFts).toBe(0);
      expect(report.plannedActions.syncBatchCounts).toBe(0);
      expect(report.plannedActions.clearStaleDeletionOperations).toBe(0);
      expect(report.appliedActions).toEqual({
        rebuiltRetrievalFts: 0,
        syncedBatchCounts: 0,
        clearedStaleDeletionOperations: 0,
        prunedOrphanRawObjectFiles: 0
      });
      expect(report.doctor.issues.databaseMissing).toEqual([{ databasePath: getMetadataDatabasePath(root) }]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("skips orphan-object pruning when prune flag is false", async () => {
    const root = await createTempUserDataPath("pact-ops-tools-prune-");
    const db = await createMetadataDb(root);

    await fs.mkdir(path.join(root, "objects"), { recursive: true });
    await fs.writeFile(path.join(root, "objects", "ghost.bin"), "ghost", "utf8");
    insertBatchRow(db, {
      batchId: "batch-skip",
      jobId: "job-skip",
      sourceCount: 0,
      rawObjectCount: 0,
      emailCount: 0,
      retrievalCount: 0
    });

    try {
      const report = await reconcileStorage({
        userDataPath: root,
        apply: true,
        pruneOrphanObjects: false
      });

      expect(report.appliedActions.prunedOrphanRawObjectFiles).toBe(0);
      expect(report.plannedActions.pruneOrphanRawObjectFiles).toBe(0);
      await expect(fs.readFile(path.join(root, "objects", "ghost.bin"), "utf8")).resolves.toBe("ghost");
    } finally {
      db.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
