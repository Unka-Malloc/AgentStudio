import { afterEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  cloudDriveConfigPath,
  createCloudDrivePort
} from "../../../server/platform/specialized/agent/cloud-drive-port/index.mjs";

const tempRoots = [];

async function tempDir(prefix) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

async function writeText(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, value, "utf8");
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function cloudDriveLedgerPath(userDataPath) {
  return path.join(userDataPath, "agent-workspaces", "cloud-drive-ledger.json");
}

function jsonResponse(payload, { status = 200, ok = true } = {}) {
  return {
    ok,
    status,
    async text() {
      return JSON.stringify(payload);
    }
  };
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("cloud drive port final edge coverage", () => {
  it("normalizes legacy ledgers and resolves managed-folder mapping edge paths", async () => {
    const userDataPath = await tempDir("pact-cloud-drive-final-local-");
    const icloudRoot = await tempDir("pact-cloud-drive-final-root-");
    await writeText(path.join(icloudRoot, "TeamDocs", "report.txt"), "team report\n");
    await writeText(path.join(icloudRoot, ".pact-data", "owner", "notes.txt"), "owner note\n");
    await writeText(path.join(icloudRoot, ".pact-data", "public", "readme.txt"), "public readme\n");
    await fs.symlink(path.join(icloudRoot, "TeamDocs", "report.txt"), path.join(icloudRoot, "TeamDocs", "report-link.txt"));

    const port = createCloudDrivePort({ userDataPath });
    const connected = await port.connect({
      provider: "icloud",
      rootPath: icloudRoot,
      managedFolder: true,
      managedFolderRoot: ".pact-data",
      allowedClients: ["owner", "codex"],
      defaultClient: "owner",
      directoryMappings: [
        { alias: "team", drivePath: "TeamDocs", writable: true, accessPolicy: { mode: "all" } },
        { alias: "new", drivePath: "NewDocs", writable: true, createIfMissing: true }
      ]
    });

    expect(await fs.stat(path.join(icloudRoot, "NewDocs"))).toMatchObject({ isDirectory: expect.any(Function) });

    await writeJson(cloudDriveLedgerPath(userDataPath), {
      schemaVersion: "v0.0.1:schema:definition-1",
      protocolVersion: "v0.0.1:storage:cloud-drive-port-1",
      updatedAt: "legacy",
      events: "legacy-event",
      transfers: null,
      checkpoints: null,
      accessReceipts: null
    });

    const defaultList = await port.listItems({
      driveRef: connected.drive.driveRef,
      clientId: "owner",
      path: ".",
      recursive: true,
      includeHash: true
    });
    expect(defaultList.requestedPath).toBe("");
    expect(defaultList.paths).toContain(".pact-data/owner/notes.txt");

    await writeJson(cloudDriveLedgerPath(userDataPath), {
      schemaVersion: "v0.0.1:schema:definition-1",
      protocolVersion: "v0.0.1:storage:cloud-drive-port-1",
      updatedAt: "legacy",
      events: null,
      transfers: {},
      checkpoints: {},
      accessReceipts: {}
    });

    const publicFileList = await port.listItems({
      driveRef: connected.drive.driveRef,
      clientId: "owner",
      path: ".pact-data/public/readme.txt"
    });
    expect(publicFileList.mapping.spaceKind).toBe("public");
    expect(publicFileList.count).toBe(0);

    const ownerDirectList = await port.listItems({
      driveRef: connected.drive.driveRef,
      clientId: "owner",
      path: "owner/notes.txt"
    });
    expect(ownerDirectList.mapping.spaceKind).toBe("agentDefault");

    await expect(port.listItems({
      driveRef: connected.drive.driveRef,
      clientId: "codex",
      path: "owner/notes.txt"
    })).rejects.toMatchObject({ code: "DRIVE_MAPPING_ACCESS_DENIED" });

    const directMappingList = await port.listItems({
      driveRef: connected.drive.driveRef,
      clientId: "owner",
      path: "TeamDocs"
    });
    expect(directMappingList.mapping.alias).toBe("team");

    const teamUpload = await port.uploadFile({
      driveRef: connected.drive.driveRef,
      clientId: "owner",
      path: "team/uploaded.txt",
      content: "team upload\n"
    });
    expect(teamUpload.mapping.alias).toBe("team");
    expect(teamUpload.localWriteInvoked).toBe(true);

    await expect(port.listItems({
      driveRef: connected.drive.driveRef,
      clientId: "owner",
      path: "Outside"
    })).rejects.toMatchObject({ code: "DRIVE_PATH_OUTSIDE_MAPPINGS" });

    await expect(port.downloadFile({
      driveRef: connected.drive.driveRef,
      clientId: "owner",
      path: "team/report-link.txt"
    })).rejects.toThrow("不允许访问云盘受控根目录内的符号链接。");
  });

  it("covers connection validation, invalid persisted JSON, and direct whole-drive mode", async () => {
    const userDataPath = await tempDir("pact-cloud-drive-final-validation-");
    const port = createCloudDrivePort({ userDataPath });

    await expect(port.listItems({ provider: "dropbox" })).rejects.toMatchObject({
      code: "DRIVE_CONNECTION_NOT_FOUND"
    });
    await expect(port.connect(null)).rejects.toBeInstanceOf(TypeError);
    await expect(port.connect({
      provider: "dropbox",
      secretRef: "plain-text-ref"
    })).rejects.toMatchObject({ code: "SECRET_REF_REQUIRED" });
    await expect(port.connect({
      provider: "onedrive",
      secretRef: "secret://pact/drive/onedrive-oauth",
      mode: "remote-live",
      endpointUrl: "not a url"
    })).rejects.toMatchObject({ code: "REMOTE_ENDPOINT_INVALID" });
    await expect(port.connect({
      provider: "onedrive",
      secretRef: "secret://pact/drive/onedrive-oauth",
      mode: "remote-live",
      endpointUrl: "https://user:password@drive.example/api?access_token=secret"
    })).rejects.toMatchObject({ code: "REMOTE_ENDPOINT_SECRET_RISK" });

    await fs.writeFile(cloudDriveConfigPath(userDataPath), "{not-json", "utf8");
    await expect(port.manifest()).rejects.toBeInstanceOf(SyntaxError);
    await fs.rm(cloudDriveConfigPath(userDataPath), { force: true });

    await expect(port.connect({
      provider: "icloud",
      rootPath: path.parse(process.cwd()).root
    })).rejects.toThrow("不能把文件系统根目录作为 iCloud 受控根目录。");

    const fileRoot = path.join(userDataPath, "not-a-directory.txt");
    await writeText(fileRoot, "file root");
    await expect(port.connect({
      provider: "icloud",
      rootPath: fileRoot
    })).rejects.toThrow("iCloud rootPath 必须是目录。");

    const realRoot = await tempDir("pact-cloud-drive-final-real-root-");
    const symlinkRoot = path.join(userDataPath, "root-link");
    await fs.symlink(realRoot, symlinkRoot);
    await expect(port.connect({
      provider: "icloud",
      rootPath: symlinkRoot
    })).rejects.toThrow("不允许连接符号链接 iCloud 根目录。");

    await writeText(path.join(realRoot, "root-file.txt"), "root file\n");
    const direct = await port.connect({
      provider: "icloud",
      rootPath: realRoot,
      managedFolder: false,
      directoryMappings: [
        { alias: "root", drivePath: "", writable: true }
      ]
    });
    expect(direct.drive.managedFolder).toMatchObject({
      enabled: false,
      directMapping: true
    });

    const rootList = await port.listItems({
      driveRef: direct.drive.driveRef,
      path: ""
    });
    expect(rootList.paths).toContain("root-file.txt");

    const rootUpload = await port.uploadFile({
      driveRef: direct.drive.driveRef,
      path: "root-upload.txt",
      content: "root upload\n",
      overwrite: true
    });
    expect(rootUpload.mapping.scope).toBe("wholeDrive");
  });

  it("covers remote-live sync, plaintext downloads, provider failures, and upload digest mismatch", async () => {
    const userDataPath = await tempDir("pact-cloud-drive-final-remote-");
    const calls = [];
    let failList = false;
    const fetchMock = vi.fn(async (url, options) => {
      const body = JSON.parse(String(options?.body || "{}"));
      calls.push({ url: String(url), body });
      if (String(url).endsWith("/connect")) {
        return jsonResponse({
          ok: true,
          connection: {
            id: "root-remote",
            name: "Remote Root",
            version: "v1",
            tenantId: "tenant-1"
          }
        });
      }
      if (String(url).endsWith("/items/list")) {
        if (failList) {
          return jsonResponse({ ok: false, code: "REMOTE_BAD", error: "remote bad" }, { status: 502, ok: false });
        }
        return jsonResponse({
          ok: true,
          files: [
            {
              drivePath: "Docs/plain.txt",
              name: "plain.txt",
              type: "file",
              size: 11,
              updatedAt: "2026-06-05T00:00:00.000Z",
              id: "plain-file",
              shareUrl: "https://drive.example/plain?sig=secret&visible=1"
            }
          ]
        });
      }
      if (String(url).endsWith("/files/download")) {
        const content = "plain remote";
        return jsonResponse({
          ok: true,
          download: {
            content,
            encoding: "utf8",
            sha256: sha256(content),
            itemId: "plain-file",
            url: "https://drive.example/plain?authorization=secret"
          }
        });
      }
      if (String(url).endsWith("/files/upload")) {
        return jsonResponse({
          ok: true,
          upload: {
            sha256: "bad-digest",
            fileId: "bad-upload"
          }
        });
      }
      return jsonResponse({ ok: false, error: "unexpected" }, { status: 404, ok: false });
    });
    vi.stubGlobal("fetch", fetchMock);

    const port = createCloudDrivePort({ userDataPath });
    const connected = await port.connect({
      provider: "onedrive",
      secretRef: "secret://pact/drive/onedrive-oauth",
      mode: "remote-live",
      endpointUrl: "https://remote.example/api/",
      endpointRef: "config://drive/onedrive",
      managedFolder: false,
      directoryMappings: [
        { alias: "docs", drivePath: "Docs", writable: true, accessPolicy: { mode: "all" } }
      ]
    });

    const listed = await port.listItems({
      driveRef: connected.drive.driveRef,
      path: "docs",
      limit: 10
    });
    expect(listed.items[0]).toMatchObject({
      path: "Docs/plain.txt",
      remoteLiveVerified: true
    });
    expect(listed.items[0].provider.webUrl).toContain("sig=REDACTED");

    const downloaded = await port.downloadFile({
      driveRef: connected.drive.driveRef,
      path: "docs/plain.txt"
    });
    expect(downloaded.content).toBe("plain remote");
    expect(downloaded.providerReceipt.webUrl).toContain("authorization=REDACTED");

    const scopedPlan = await port.syncPlan({
      driveRef: connected.drive.driveRef,
      path: "docs",
      direction: "export_from_sharedspace",
      targetPath: "exports"
    });
    expect(scopedPlan.summary.exportProjection).toBe(1);
    expect(scopedPlan.telemetry.operation).toBe("list");

    const fullPlan = await port.syncPlan({
      driveRef: connected.drive.driveRef,
      targetPath: "imports"
    });
    expect(fullPlan.summary.importProjection).toBe(1);

    await expect(port.uploadFile({
      driveRef: connected.drive.driveRef,
      path: "docs/bad.txt",
      content: "digest mismatch"
    })).rejects.toMatchObject({ code: "REMOTE_UPLOAD_DIGEST_MISMATCH" });

    failList = true;
    await expect(port.listItems({
      driveRef: connected.drive.driveRef,
      path: "docs"
    })).rejects.toMatchObject({ code: "REMOTE_BAD" });

    expect(calls.map((call) => call.url)).toEqual(expect.arrayContaining([
      "https://remote.example/api/connect",
      "https://remote.example/api/items/list",
      "https://remote.example/api/files/download",
      "https://remote.example/api/files/upload"
    ]));
  });

  it("wraps remote-live connections that are missing endpointUrl", async () => {
    const userDataPath = await tempDir("pact-cloud-drive-final-broken-remote-");
    await writeJson(cloudDriveConfigPath(userDataPath), {
      schemaVersion: "v0.0.1:schema:definition-1",
      protocolVersion: "v0.0.1:storage:cloud-drive-port-1",
      updatedAt: "2026-06-05T00:00:00.000Z",
      connections: {
        broken: {
          driveRef: "broken",
          provider: "onedrive",
          mode: "remote-live",
          status: "active",
          secretRef: "secret://pact/drive/onedrive-oauth",
          remoteLiveVerified: true,
          managedFolder: { enabled: false },
          directoryMappings: [
            {
              mappingId: "whole",
              name: "Whole",
              alias: "root",
              drivePath: "",
              displayPath: "/",
              scope: "wholeDrive",
              spaceKind: "advancedExposure",
              writable: false,
              accessPolicy: { mode: "all" }
            }
          ]
        }
      }
    });

    const port = createCloudDrivePort({ userDataPath });
    await expect(port.listItems({
      driveRef: "broken",
      path: "root"
    })).rejects.toMatchObject({ code: "REMOTE_PROVIDER_UNAVAILABLE" });
  });

  it("detects nested inline secrets and reports unavailable local quota when statfs fails", async () => {
    const userDataPath = await tempDir("pact-cloud-drive-final-secret-statfs-");
    const icloudRoot = await tempDir("pact-cloud-drive-final-statfs-root-");
    await writeText(path.join(icloudRoot, "docs", "visible.txt"), "visible\n");

    const port = createCloudDrivePort({ userDataPath });
    await expect(port.connect({
      provider: "dropbox",
      secretRef: "secret://pact/drive/dropbox-oauth",
      nested: {
        credentials: {
          refreshToken: "inline-refresh-token"
        }
      }
    })).rejects.toMatchObject({
      code: "INLINE_SECRET_VALUE",
      message: expect.stringContaining("refreshToken")
    });

    const connected = await port.connect({
      provider: "icloud",
      rootPath: icloudRoot,
      managedFolder: true,
      allowedClients: ["owner", "codex"],
      defaultClient: "owner",
      directoryMappings: [
        {
          alias: "docs",
          drivePath: "docs",
          writable: false,
          accessPolicy: { mode: "all" }
        }
      ]
    });

    const originalStatfs = fs.statfs;
    fs.statfs = async () => {
      throw new Error("statfs unavailable");
    };
    try {
      const status = await port.status({ driveRef: connected.drive.driveRef });
      expect(status.connections[0]).toMatchObject({
        driveRef: connected.drive.driveRef,
        syncStatus: "localAdapterVerified",
        quota: { available: false }
      });
    } finally {
      fs.statfs = originalStatfs;
    }

    const managedList = await port.listItems({
      driveRef: connected.drive.driveRef,
      clientId: "codex",
      path: "codex"
    });
    expect(managedList.mapping.spaceKind).toBe("agentDefault");
    expect(managedList.basePath).toBe(".pact-data/codex");
  });
});
