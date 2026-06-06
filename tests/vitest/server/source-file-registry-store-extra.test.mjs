import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSourceFileRegistryStore } from "../../../server/platform/common/storage/source-file-registry-store.mjs";
import { getMetadataDatabasePath } from "../../../server/platform/common/storage/schema-manager.mjs";

async function withTempUserDataPath(testCase) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pact-source-file-registry-store-extra-"));
  await fs.mkdir(path.join(root, "metadata"), { recursive: true });

  try {
    return await testCase(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

function createOptionalPurgeTables(db) {
  db.exec(`
    CREATE TABLE source_files (
      record_id TEXT PRIMARY KEY,
      source_ref TEXT NOT NULL,
      source_path TEXT NOT NULL
    );

    CREATE TABLE raw_mail_objects (
      object_id TEXT PRIMARY KEY,
      source_ref TEXT NOT NULL,
      original_source_path TEXT NOT NULL
    );

    CREATE TABLE source_document_profiles (
      document_id TEXT PRIMARY KEY,
      source_ref TEXT NOT NULL
    );

    CREATE TABLE source_blocks (
      record_id TEXT PRIMARY KEY,
      source_ref TEXT NOT NULL
    );

    CREATE TABLE source_chunks (
      record_id TEXT PRIMARY KEY,
      source_ref TEXT NOT NULL
    );

    CREATE TABLE email_messages (
      message_id TEXT PRIMARY KEY,
      source_ref TEXT NOT NULL
    );
  `);
}

function seedOptionalPurgeRows(db) {
  db.exec(`
    INSERT INTO source_files (record_id, source_ref, source_path) VALUES
      ('file-keep', 'keep', '/abs/keep'),
      ('file-ref', 'ref-file', '/abs/one'),
      ('file-empty', '', '/abs/one');

    INSERT INTO raw_mail_objects (object_id, source_ref, original_source_path) VALUES
      ('mail-keep', 'keep', '/abs/keep'),
      ('mail-ref', 'ref-mail', '/abs/two');

    INSERT INTO source_document_profiles (document_id, source_ref) VALUES
      ('profile-keep', 'keep'),
      ('profile-file', 'ref-file'),
      ('profile-mail', 'ref-mail');

    INSERT INTO source_blocks (record_id, source_ref) VALUES
      ('block-keep', 'keep'),
      ('block-file', 'ref-file'),
      ('block-mail', 'ref-mail');

    INSERT INTO source_chunks (record_id, source_ref) VALUES
      ('chunk-keep', 'keep'),
      ('chunk-file', 'ref-file'),
      ('chunk-mail', 'ref-mail');

    INSERT INTO email_messages (message_id, source_ref) VALUES
      ('message-keep', 'keep'),
      ('message-file', 'ref-file'),
      ('message-mail', 'ref-mail');
  `);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("source-file-registry-store extra coverage", () => {
  it("persists fingerprint, registry source, alias, and file rows with boundary handling", async () => {
    await withTempUserDataPath(async (root) => {
      const store = createSourceFileRegistryStore({ userDataPath: root });
      const originalExtname = path.extname;
      const extnameSpy = vi.spyOn(path, "extname");
      extnameSpy.mockImplementation((filePath) => {
        if (filePath === "mock-no-dot") {
          return "md";
        }
        return originalExtname.call(path, filePath);
      });

      try {
        expect(store.listBySource("missing")).toEqual(new Map());
        expect(store.countRegisteredFiles("missing")).toBe(0);
        expect(store.listRegisteredFiles("missing")).toEqual([]);

        store.applyDelta({
          sourceId: "source-a",
          scanId: "scan-1",
          files: [
            { relativePath: "docs/readme.txt", byteSize: 10, mtimeMs: 20 },
            { relativePath: "docs/readme.txt", byteSize: 11, mtimeMs: 22 },
            { relativePath: "plain", byteSize: 5, mtimeMs: 6 }
          ],
          removedPaths: ["plain"]
        });

        const fingerprintEntries = [...store.listBySource("source-a").entries()];
        expect(fingerprintEntries).toEqual([
          [
            "docs/readme.txt",
            {
              relativePath: "docs/readme.txt",
              byteSize: 11,
              mtimeMs: 22,
              fingerprint: "11:22"
            }
          ]
        ]);

        store.upsertRegistrySource({
          sourceId: "  source-a  ",
          label: "  Primary source  ",
          directoryPath: "  /tmp/source-a  ",
          enabled: false,
          autoSync: false,
          recursive: false,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-02T00:00:00.000Z"
        });
        store.upsertRegistrySource({
          sourceId: "source-a",
          label: "Updated source",
          directoryPath: "/tmp/source-a",
          enabled: true,
          autoSync: true,
          recursive: true
        });

        store.recordPathAlias({
          sourceId: "source-a",
          aliasDirectoryPath: "/alias/source-a",
          canonicalDirectoryPath: "/canonical/source-a"
        });
        store.recordPathAlias({
          sourceId: "source-a",
          aliasDirectoryPath: "/alias/source-a",
          canonicalDirectoryPath: "/canonical/source-a-v2"
        });

        const inspectBeforeRemoval = new Database(getMetadataDatabasePath(root));
        try {
          expect(
            inspectBeforeRemoval.prepare(
              "SELECT source_id, label, directory_path, enabled, auto_sync, recursive, created_at, updated_at FROM knowledge_source_registry_sources"
            ).all()
          ).toEqual([
            {
              source_id: "source-a",
              label: "Updated source",
              directory_path: "/tmp/source-a",
              enabled: 1,
              auto_sync: 1,
              recursive: 1,
              created_at: "2026-01-01T00:00:00.000Z",
              updated_at: expect.any(String)
            }
          ]);
          expect(
            inspectBeforeRemoval.prepare(
              "SELECT source_id, alias_directory_path, canonical_directory_path FROM knowledge_source_path_aliases"
            ).all()
          ).toEqual([
            {
              source_id: "source-a",
              alias_directory_path: "/alias/source-a",
              canonical_directory_path: "/canonical/source-a-v2"
            }
          ]);
        } finally {
          inspectBeforeRemoval.close();
        }

        store.syncRegistryFiles({
          source: { sourceId: "source-a", directoryPath: "/tmp/source-a" },
          scanId: "scan-registry-1",
          files: [
            { relativePath: "folder/report.md", byteSize: 20, mtimeMs: 30 },
            { relativePath: "mock-no-dot", byteSize: 8, mtimeMs: 9 }
          ]
        });
        store.syncRegistryFiles({
          source: { sourceId: "source-a", directoryPath: "/tmp/source-a" },
          scanId: "scan-registry-2",
          files: [
            { relativePath: "folder/report.md", byteSize: 21, mtimeMs: 31 }
          ],
          removedPaths: ["mock-no-dot"]
        });

        expect(store.countRegisteredFiles("source-a")).toBe(1);
        expect(store.listRegisteredFiles("source-a")).toEqual([
          {
            sourceId: "source-a",
            relativePath: "folder/report.md",
            absolutePath: "/tmp/source-a/folder/report.md",
            extension: ".md",
            byteSize: 21,
            mtimeMs: 31,
            fingerprint: "21:31",
            lastScanId: "scan-registry-2",
            updatedAt: expect.any(String)
          }
        ]);
        expect(store.listRegisteredFiles("source-a", { limit: 0, offset: -9 })).toEqual([
          {
            sourceId: "source-a",
            relativePath: "folder/report.md",
            absolutePath: "/tmp/source-a/folder/report.md",
            extension: ".md",
            byteSize: 21,
            mtimeMs: 31,
            fingerprint: "21:31",
            lastScanId: "scan-registry-2",
            updatedAt: expect.any(String)
          }
        ]);
        expect(store.listRegisteredFiles("source-a", { limit: 9999, offset: 1 })).toEqual([]);

        store.clearSourceFiles("source-a");
        expect(store.countRegisteredFiles("source-a")).toBe(0);
        expect(store.listRegisteredFiles("source-a")).toEqual([]);
        store.removeRegistrySource("source-a");
        store.purgePersistedSourcePaths(["/abs/does-not-exist"]);

        const db = new Database(getMetadataDatabasePath(root));
        try {
          expect(
            db.prepare("SELECT source_id, label, directory_path, enabled, auto_sync, recursive, created_at, updated_at FROM knowledge_source_registry_sources").all()
          ).toEqual([]);
          expect(
            db.prepare("SELECT source_id, alias_directory_path, canonical_directory_path FROM knowledge_source_path_aliases").all()
          ).toEqual([
            {
              source_id: "source-a",
              alias_directory_path: "/alias/source-a",
              canonical_directory_path: "/canonical/source-a-v2"
            }
          ]);
          expect(
            db.prepare("SELECT COUNT(*) AS count FROM knowledge_source_file_fingerprints WHERE source_id = ?").get("source-a").count
          ).toBe(0);
          expect(
            db.prepare("SELECT COUNT(*) AS count FROM knowledge_source_registry_files WHERE source_id = ?").get("source-a").count
          ).toBe(0);
        } finally {
          db.close();
        }
      } finally {
        store.close();
        extnameSpy.mockRestore();
      }
    });
  });

  it("purges persisted source refs when optional lookup tables exist", async () => {
    await withTempUserDataPath(async (root) => {
      const dbPath = getMetadataDatabasePath(root);
      const setupDb = new Database(dbPath);
      try {
        createOptionalPurgeTables(setupDb);
        seedOptionalPurgeRows(setupDb);
      } finally {
        setupDb.close();
      }

      const store = createSourceFileRegistryStore({ userDataPath: root });
      try {
        store.purgePersistedSourcePaths(["/abs/one", "/abs/two", "/abs/one"]);
      } finally {
        store.close();
      }

      const db = new Database(dbPath);
      try {
        expect(db.prepare("SELECT record_id, source_ref FROM source_files ORDER BY record_id").all()).toEqual([
          { record_id: "file-empty", source_ref: "" },
          { record_id: "file-keep", source_ref: "keep" }
        ]);
        expect(db.prepare("SELECT object_id, source_ref FROM raw_mail_objects ORDER BY object_id").all()).toEqual([
          { object_id: "mail-keep", source_ref: "keep" }
        ]);
        expect(db.prepare("SELECT document_id, source_ref FROM source_document_profiles ORDER BY document_id").all()).toEqual([
          { document_id: "profile-keep", source_ref: "keep" }
        ]);
        expect(db.prepare("SELECT record_id, source_ref FROM source_blocks ORDER BY record_id").all()).toEqual([
          { record_id: "block-keep", source_ref: "keep" }
        ]);
        expect(db.prepare("SELECT record_id, source_ref FROM source_chunks ORDER BY record_id").all()).toEqual([
          { record_id: "chunk-keep", source_ref: "keep" }
        ]);
        expect(db.prepare("SELECT message_id, source_ref FROM email_messages ORDER BY message_id").all()).toEqual([
          { message_id: "message-keep", source_ref: "keep" }
        ]);
        expect(
          db.prepare("SELECT COUNT(*) AS count FROM source_files WHERE source_ref IN ('ref-file', 'ref-mail')").get().count
        ).toBe(0);
        expect(
          db.prepare("SELECT COUNT(*) AS count FROM raw_mail_objects WHERE source_ref IN ('ref-file', 'ref-mail')").get().count
        ).toBe(0);
      } finally {
        db.close();
      }
    });
  });
});
