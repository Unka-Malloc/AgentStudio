import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  cloudDriveConfigPath,
  createCloudDrivePort,
} from "../../../server/platform/specialized/agent/cloud-drive-port/index.mjs";

const tempRoots = [];

async function tempDir(prefix) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

async function writeText(filePath, text) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, text, "utf8");
}

function jsonResponse(payload, { status = 200, ok = true } = {}) {
  return {
    ok,
    status,
    async text() {
      return JSON.stringify(payload);
    },
  };
}

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("cloud drive port", () => {
  it("connects a local iCloud adapter and enforces managed-folder read/write policy", async () => {
    const userDataPath = await tempDir("pact-cloud-drive-data-");
    const icloudRoot = await tempDir("pact-icloud-root-");
    await writeText(path.join(icloudRoot, "TeamDocs", "team.txt"), "team readonly\n");
    await writeText(path.join(icloudRoot, ".pact-data", "owner", "note.txt"), "owner note\n");
    await writeText(path.join(icloudRoot, ".pact-data", "public", "readme.txt"), "public readme\n");
    const port = createCloudDrivePort({ userDataPath });

    const connected = await port.connect({
      provider: "icloud",
      rootPath: icloudRoot,
      managedFolder: true,
      managedFolderRoot: ".pact-data",
      publicFolder: "public",
      allowedClients: ["owner", "codex"],
      defaultClient: "owner",
      directoryMappings: [
        {
          name: "Team Docs",
          alias: "team",
          drivePath: "TeamDocs",
          accessPolicy: { mode: "all" },
        },
      ],
    });

    expect(connected.localAdapterVerified).toBe(true);
    expect(connected.drive.managedFolder.spaces.default.writable).toBe(true);
    expect(connected.drive.managedFolder.spaces.public.writable).toBe(false);
    expect(connected.drive.directoryMappings.map((item) => item.alias)).toEqual([
      "default",
      "public",
      "team",
    ]);
    expect(cloudDriveConfigPath(userDataPath)).toContain(userDataPath);

    const listed = await port.listItems({
      driveRef: connected.drive.driveRef,
      clientId: "owner",
      path: "default",
      recursive: "true",
      includeHash: "true",
    });
    expect(listed.localAdapterVerified).toBe(true);
    expect(listed.mapping.spaceKind).toBe("agentDefault");
    expect(listed.paths).toContain(".pact-data/owner/note.txt");
    expect(listed.items[0].contentSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(listed.accessReceipt.receiptId).toMatch(/^cloud_drive_access_receipt::/u);

    const downloaded = await port.downloadFile({
      driveRef: connected.drive.driveRef,
      clientId: "owner",
      path: "default/note.txt",
      includeText: true,
    });
    expect(downloaded.content).toBe("owner note\n");
    expect(downloaded.transferReceipt.state).toBe("staged");

    const uploaded = await port.uploadFile({
      driveRef: connected.drive.driveRef,
      clientId: "owner",
      path: "default/uploaded.txt",
      content: "uploaded\n",
    });
    expect(uploaded.localWriteInvoked).toBe(true);
    expect(uploaded.mapping.spaceKind).toBe("agentDefault");
    expect(await fs.readFile(path.join(icloudRoot, ".pact-data", "owner", "uploaded.txt"), "utf8")).toBe("uploaded\n");

    await expect(port.uploadFile({
      driveRef: connected.drive.driveRef,
      clientId: "owner",
      path: "public/blocked.txt",
      content: "blocked\n",
    })).rejects.toMatchObject({ code: "DRIVE_MAPPING_READ_ONLY" });

    await expect(port.downloadFile({
      driveRef: connected.drive.driveRef,
      clientId: "owner",
      path: "../escape.txt",
    })).rejects.toThrow("云盘路径不能跳出受控根目录。");

    const syncPlan = await port.syncPlan({
      driveRef: connected.drive.driveRef,
      clientId: "owner",
      targetPath: "cloud-drive",
    });
    expect(syncPlan.dryRun).toBe(true);
    expect(syncPlan.actions.some((action) => action.drivePath.endsWith("note.txt"))).toBe(true);

    const syncApply = await port.syncApply({
      driveRef: connected.drive.driveRef,
      clientId: "owner",
      targetPath: "cloud-drive",
    });
    expect(syncApply.dryRun).toBe(false);
    expect(syncApply.syncReceipt.state).toBe("projected");

    const permissions = await port.permissionList({
      driveRef: connected.drive.driveRef,
      clientId: "owner",
      path: "team",
    });
    expect(permissions.permissions[0]).toMatchObject({
      mode: "all",
      spaceKind: "advancedExposure",
      writable: false,
    });

    const status = await port.status({ driveRef: connected.drive.driveRef });
    expect(status.count).toBe(1);
    expect(status.connections[0].syncStatus).toBe("localAdapterVerified");
  });

  it("connects OneDrive as a local directory projection for v0.0.1", async () => {
    const userDataPath = await tempDir("pact-cloud-drive-onedrive-data-");
    const oneDriveRoot = await tempDir("pact-onedrive-root-");
    await writeText(path.join(oneDriveRoot, ".pact-data", "owner", "note.txt"), "onedrive note\n");
    await writeText(path.join(oneDriveRoot, ".pact-data", "public", "readme.txt"), "onedrive public\n");
    await writeText(path.join(oneDriveRoot, "TeamDocs", "team.txt"), "onedrive team\n");
    const port = createCloudDrivePort({ userDataPath });

    const connected = await port.connect({
      provider: "onedrive",
      rootPath: oneDriveRoot,
      managedFolder: true,
      managedFolderRoot: ".pact-data",
      publicFolder: "public",
      allowedClients: ["owner", "codex"],
      defaultClient: "owner",
      directoryMappings: [
        {
          name: "Team Docs",
          alias: "team",
          drivePath: "TeamDocs",
          accessPolicy: { mode: "all" },
        },
      ],
    });

    expect(connected.localAdapterVerified).toBe(true);
    expect(connected.contractVerified).toBe(false);
    expect(connected.remoteLiveVerified).toBe(false);
    expect(connected.drive).toMatchObject({
      provider: "onedrive",
      mode: "local",
      authType: "localDirectory",
      localAdapterVerified: true,
    });
    expect(JSON.stringify(connected)).not.toContain(oneDriveRoot);

    const listed = await port.listItems({
      driveRef: connected.drive.driveRef,
      clientId: "owner",
      path: "default",
      recursive: true,
      includeHash: true,
    });
    expect(listed.localAdapterVerified).toBe(true);
    expect(listed.contractVerified).toBe(false);
    expect(listed.paths).toContain(".pact-data/owner/note.txt");

    const downloaded = await port.downloadFile({
      driveRef: connected.drive.driveRef,
      clientId: "owner",
      path: "default/note.txt",
    });
    expect(downloaded.content).toBe("onedrive note\n");
    expect(downloaded.localAdapterVerified).toBe(true);

    const uploaded = await port.uploadFile({
      driveRef: connected.drive.driveRef,
      clientId: "owner",
      path: "default/uploaded.txt",
      content: "onedrive upload\n",
    });
    expect(uploaded.localWriteInvoked).toBe(true);
    expect(await fs.readFile(path.join(oneDriveRoot, ".pact-data", "owner", "uploaded.txt"), "utf8")).toBe("onedrive upload\n");

    const manifest = await port.manifest();
    const oneDriveProvider = manifest.providers.find((item) => item.provider === "onedrive");
    expect(oneDriveProvider).toMatchObject({
      connected: true,
      contractOnly: false,
      localProjectionSupported: true,
      localProjectionVerified: true,
      releaseSupport: "localDirectoryProjection",
    });
  });

  it("uses secret references for contract OAuth providers and blocks inline secrets", async () => {
    const userDataPath = await tempDir("pact-cloud-drive-contract-");
    const port = createCloudDrivePort({ userDataPath });

    await expect(port.connect({
      provider: "dropbox",
      token: "must-not-be-inline",
    })).rejects.toMatchObject({ code: "INLINE_SECRET_VALUE" });

    await expect(port.connect({
      provider: "box",
      secretRef: "secret://pact/drive/box",
    })).rejects.toMatchObject({ code: "UNSUPPORTED_PROVIDER" });

    const connected = await port.connect({
      provider: "google",
      secretRef: "secret://pact/drive/google-drive-oauth",
      mode: "contract",
      allowedClients: "owner,codex",
      directoryMappings: [
        {
          alias: "team",
          drivePath: "TeamDocs",
          accessPolicy: {
            mode: "allowlist",
            subjects: ["owner"],
          },
        },
      ],
    });

    expect(connected.provider).toBe("google-drive");
    expect(connected.contractVerified).toBe(true);
    expect(connected.drive.secretRef).toBe("secret://pact/drive/google-drive-oauth");
    expect(JSON.stringify(connected)).not.toContain("must-not-be-inline");

    const contractList = await port.listItems({
      driveRef: connected.drive.driveRef,
      clientId: "owner",
      path: "team",
      limit: 1,
    });
    expect(contractList.contractVerified).toBe(true);
    expect(contractList.items).toHaveLength(1);
    expect(contractList.items[0]).toMatchObject({
      provider: "google-drive",
      metadataOnly: true,
      contractVerified: true,
    });

    await expect(port.listItems({
      driveRef: connected.drive.driveRef,
      clientId: "codex",
      path: "team",
    })).rejects.toMatchObject({ code: "DRIVE_MAPPING_ACCESS_DENIED" });

    const upload = await port.uploadFile({
      driveRef: connected.drive.driveRef,
      clientId: "owner",
      path: "default/contract.txt",
      contentBase64: Buffer.from("contract upload").toString("base64"),
    });
    expect(upload.contractVerified).toBe(true);
    expect(upload.remoteWriteInvoked).toBe(false);
    expect(upload.localWriteInvoked).toBe(false);
    expect(upload.transferReceipt.state).toBe("contractVerified");

    const download = await port.downloadFile({
      driveRef: connected.drive.driveRef,
      clientId: "owner",
      path: "default/contract.txt",
      includeText: "false",
    });
    expect(download.contractVerified).toBe(true);
    expect(download.content).toBeUndefined();
    expect(download.contentBase64).toBeTruthy();

    const manifest = await port.manifest();
    expect(manifest.connectedProviderCount).toBe(1);
    expect(manifest.providers.find((item) => item.provider === "google-drive").connected).toBe(true);
  });

  it("routes remote-live adapters through fetch and redacts provider metadata", async () => {
    const userDataPath = await tempDir("pact-cloud-drive-remote-");
    const calls = [];
    const fetchMock = vi.fn(async (url, options) => {
      const body = JSON.parse(String(options.body || "{}"));
      calls.push({ url: String(url), body });
      if (String(url).endsWith("/connect")) {
        return jsonResponse({
          ok: true,
          connection: {
            rootId: "root-1",
            rootName: "Remote Root",
            revision: "rev-1",
            accountId: "acct-1",
          },
        });
      }
      if (String(url).endsWith("/items/list")) {
        return jsonResponse({
          ok: true,
          items: [
            {
              path: ".pact-data/codex/remote.txt",
              name: "remote.txt",
              sizeBytes: 12,
              fileId: "file-1",
              webUrl: "https://drive.example/file?access_token=secret&plain=ok",
            },
          ],
        });
      }
      if (String(url).endsWith("/files/download")) {
        const content = Buffer.from("remote content\n");
        return jsonResponse({
          ok: true,
          file: {
            contentBase64: content.toString("base64"),
            contentSha256: "bad-digest",
          },
        });
      }
      if (String(url).endsWith("/files/upload")) {
        return jsonResponse({
          ok: true,
          file: {
            providerFileId: "uploaded-1",
            revision: "rev-uploaded",
            contentSha256: body.payload.contentSha256,
          },
        });
      }
      return jsonResponse({ ok: false, error: "unexpected route" }, { status: 404, ok: false });
    });
    vi.stubGlobal("fetch", fetchMock);
    const port = createCloudDrivePort({ userDataPath });

    await expect(port.connect({
      provider: "onedrive",
      secretRef: "secret://pact/drive/onedrive-oauth",
      mode: "remote-live",
      endpointUrl: "file:///tmp/not-http",
    })).rejects.toMatchObject({ code: "REMOTE_ENDPOINT_INVALID" });

    const connected = await port.connect({
      provider: "onedrive",
      secretRef: "secret://pact/drive/onedrive-oauth",
      mode: "remote-live",
      endpointUrl: "https://remote.example/root/",
      endpointRef: "config://drive/onedrive",
      defaultClient: "codex",
      allowedClients: ["codex"],
    });

    expect(connected.remoteLiveVerified).toBe(true);
    expect(connected.telemetry.transferBytes).toBeGreaterThan(0);
    expect(JSON.stringify(connected)).not.toContain("https://remote.example/root");
    expect(calls[0].url).toBe("https://remote.example/root/connect");

    const listed = await port.listItems({
      driveRef: connected.drive.driveRef,
      clientId: "codex",
      path: "default",
      recursive: true,
    });
    expect(listed.remoteLiveVerified).toBe(true);
    expect(listed.items[0].provider.webUrl).toContain("access_token=REDACTED");
    expect(listed.telemetry.bytesPerSecond).toBeGreaterThan(0);

    await expect(port.downloadFile({
      driveRef: connected.drive.driveRef,
      clientId: "codex",
      path: "default/remote.txt",
    })).rejects.toMatchObject({ code: "REMOTE_CONTENT_DIGEST_MISMATCH" });

    const uploaded = await port.uploadFile({
      driveRef: connected.drive.driveRef,
      clientId: "codex",
      path: "default/uploaded.txt",
      content: "remote upload",
      overwrite: true,
    });
    expect(uploaded.remoteWriteInvoked).toBe(true);
    expect(uploaded.providerReceipt.fileId).toBe("uploaded-1");
    expect(uploaded.transferReceipt.provider.fileId).toBe("uploaded-1");
  });
});
