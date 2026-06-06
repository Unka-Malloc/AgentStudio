import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const backupMocks = vi.hoisted(() => ({
  createStorageBackup: vi.fn(async (input) => ({ kind: "create-backup", input })),
  listStorageBackups: vi.fn(async (input) => ({ kind: "list-backups", input })),
  restoreStorageBackup: vi.fn(async (input) => ({ kind: "restore-backup", input }))
}));
const opsMocks = vi.hoisted(() => ({
  reconcileStorage: vi.fn(async (input) => ({ kind: "reconcile", input })),
  runStorageDoctor: vi.fn(async (input) => ({ kind: "doctor", input }))
}));

vi.mock("../../../server/platform/common/storage/backup-restore.mjs", () => backupMocks);
vi.mock("../../../server/platform/common/storage/ops-tools.mjs", () => opsMocks);

import {
  createStorageProvider,
  STORAGE_PROTOCOL_VERSION
} from "../../../server/platform/common/storage/storage-provider.mjs";

const tempRoots = [];

async function tempDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pact-storage-provider-"));
  tempRoots.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

beforeEach(() => {
  vi.clearAllMocks();
});

function createMetadataStore(overrides = {}) {
  return {
    getStorageSummary: vi.fn(() => ({ files: 3 })),
    rebuildSourceVocabulary: vi.fn((input) => ({ rebuild: input })),
    getSignificantSourceTerms: vi.fn((input) => ({ terms: input })),
    search: vi.fn((input) => ({ results: input })),
    recordClientCheckIn: vi.fn((input) => ({ checkIn: input })),
    listClientRegistrations: vi.fn(() => ({
      summary: { total: 2 },
      items: [
        { clientId: "client-a", status: "online" },
        { clientId: "client-b", status: "offline" }
      ]
    })),
    getRawMailObject: vi.fn(() => null),
    ...overrides
  };
}

describe("storage provider", () => {
  it("forwards metadata operations, normalizes clients, and exposes capabilities", () => {
    const metadataStore = createMetadataStore();
    const provider = createStorageProvider({
      userDataPath: "/data",
      metadataStore
    });

    expect(Object.isFrozen(provider)).toBe(true);
    expect(provider.protocolVersion).toBe(STORAGE_PROTOCOL_VERSION);
    expect(provider.getMetadataStore()).toBe(metadataStore);
    expect(provider.getStorageSummary()).toEqual({ files: 3 });
    expect(provider.rebuildSourceVocabulary({ batchId: "b1" })).toEqual({ rebuild: { batchId: "b1" } });
    expect(provider.getSignificantSourceTerms({ limit: 2 })).toEqual({ terms: { limit: 2 } });
    expect(provider.search({ query: "alpha" })).toEqual({ results: { query: "alpha" } });
    expect(provider.recordClientCheckIn({ clientId: "client-a" })).toEqual({ checkIn: { clientId: "client-a" } });
    expect(provider.listClientRegistrations({ offlineAfterSeconds: 10 })).toEqual({
      summary: { total: 2 },
      items: [
        { clientId: "client-a", status: "online" },
        { clientId: "client-b", status: "offline" }
      ]
    });
    expect(provider.findClientRegistration({ clientId: " client-b " })).toEqual({
      clientId: "client-b",
      status: "offline"
    });
    expect(provider.findClientRegistration({ clientId: "" })).toBeNull();
    expect(provider.listCapabilities()).toMatchObject({
      protocolVersion: STORAGE_PROTOCOL_VERSION,
      capabilities: expect.arrayContaining([
        expect.objectContaining({ id: "metadata-summary" }),
        expect.objectContaining({ id: "raw-object" }),
        expect.objectContaining({ id: "maintenance" })
      ])
    });
  });

  it("reads raw objects from storage paths and handles missing ids", async () => {
    const userDataPath = await tempDir();
    const rawPath = path.join(userDataPath, "objects/client-a/mail/message.eml");
    await fs.mkdir(path.dirname(rawPath), { recursive: true });
    await fs.writeFile(rawPath, "raw bytes", "utf8");
    const metadataStore = createMetadataStore({
      getRawMailObject: vi.fn((objectId) => objectId === "raw-1"
        ? {
            object_id: "raw-1",
            storage_rel_path: "objects/client-a/mail/message.eml",
            media_type: "message/rfc822",
            original_file_name: "message.eml"
          }
        : null)
    });
    const provider = createStorageProvider({ userDataPath, metadataStore });

    await expect(provider.readRawObjectById("")).resolves.toBeNull();
    await expect(provider.readRawObjectById("missing")).resolves.toBeNull();
    await expect(provider.readRawObjectById("raw-1")).resolves.toMatchObject({
      rawObject: {
        object_id: "raw-1"
      },
      contentType: "message/rfc822",
      fileName: "message.eml",
      storageRelativePath: "objects/client-a/mail/message.eml",
      buffer: Buffer.from("raw bytes")
    });
    expect(provider.getRawObject(" raw-1 ")).toMatchObject({ object_id: "raw-1" });
    expect(provider.getRawObject("")).toBeNull();
    expect(provider.resolveStoredObjectPath("objects/client-a/mail/message.eml")).toBe(rawPath);
    expect(() => provider.resolveStoredObjectPath("../escape")).toThrow();
  });

  it("delegates maintenance, backup, and restore operations with normalized options", async () => {
    const provider = createStorageProvider({
      userDataPath: "/data",
      metadataStore: createMetadataStore()
    });

    await expect(provider.runDoctor()).resolves.toEqual({
      kind: "doctor",
      input: { userDataPath: "/data" }
    });
    await expect(provider.reconcile({ apply: false, pruneOrphanObjects: true })).resolves.toEqual({
      kind: "reconcile",
      input: {
        userDataPath: "/data",
        apply: false,
        pruneOrphanObjects: true
      }
    });
    await expect(provider.listBackups()).resolves.toEqual({
      kind: "list-backups",
      input: { userDataPath: "/data" }
    });
    await expect(provider.createBackup({ label: "daily" })).resolves.toEqual({
      kind: "create-backup",
      input: { userDataPath: "/data", label: "daily" }
    });
    await expect(provider.restoreBackupPreview({ backupId: "b1", includePaths: ["state.json"] })).resolves.toEqual({
      kind: "restore-backup",
      input: {
        userDataPath: "/data",
        backupId: "b1",
        dryRun: true,
        includePaths: ["state.json"]
      }
    });
    await expect(provider.restoreBackup({ backupId: "b1", confirm: true })).resolves.toEqual({
      kind: "restore-backup",
      input: {
        userDataPath: "/data",
        backupId: "b1",
        dryRun: false,
        apply: true,
        includePaths: []
      }
    });
    await expect(provider.restoreBackup({ backupId: "b2", apply: false, includePaths: "bad" })).resolves.toEqual({
      kind: "restore-backup",
      input: {
        userDataPath: "/data",
        backupId: "b2",
        dryRun: false,
        apply: false,
        includePaths: "bad"
      }
    });
  });

  it("throws a typed unavailable error when required metadata methods are missing", () => {
    const provider = createStorageProvider({ metadataStore: {} });

    expect(() => provider.getStorageSummary()).toThrow("storage provider method is not available: getStorageSummary");
    try {
      provider.getStorageSummary();
    } catch (error) {
      expect(error).toMatchObject({
        statusCode: 503,
        code: "STORAGE_PROVIDER_UNAVAILABLE"
      });
    }
  });
});
