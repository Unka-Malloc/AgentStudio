import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createAgentMemory } from "../../../server/platform/specialized/agent/agent-memory/index.mjs";
import {
  cloudDriveConfigPath,
  createCloudDrivePort
} from "../../../server/platform/specialized/agent/cloud-drive-port/index.mjs";
import {
  CONTEXT_COMPACTION_PROTOCOL_VERSION,
  createContextCompactionRuntime
} from "../../../server/platform/specialized/agent/agent-context/interface/index.mjs";

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
    }
  };
}

function textResponse(payload, { status = 200, ok = true } = {}) {
  return {
    ok,
    status,
    async text() {
      return payload;
    }
  };
}

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("cloud drive port extra coverage", () => {
  it("reads, writes, lists and rejects local iCloud edge cases", async () => {
    const userDataPath = await tempDir("pact-agent-cloud-local-");
    const icloudRoot = await tempDir("pact-agent-icloud-root-");

    await writeText(path.join(icloudRoot, "TeamDocs", "report.txt"), "team report\n");
    await writeText(path.join(icloudRoot, "TeamDocs", "nested", "deep.txt"), "deep file\n");
    await writeText(path.join(icloudRoot, ".pact-data", "owner", "notes.txt"), "owner note\n");
    await writeText(path.join(icloudRoot, ".pact-data", "public", "readme.txt"), "public readme\n");

    const port = createCloudDrivePort({ userDataPath });
    const connected = await port.connect({
      provider: "icloud",
      rootPath: icloudRoot,
      managedFolder: true,
      managedFolderRoot: ".pact-data",
      publicFolder: "public",
      allowedClients: ["owner", "helper"],
      defaultClient: "owner",
      directoryMappings: [
        {
          name: "Team Docs",
          alias: "team",
          drivePath: "TeamDocs",
          accessPolicy: { mode: "allowlist", subjects: ["owner"] }
        }
      ]
    });

    expect(connected.localAdapterVerified).toBe(true);
    expect(cloudDriveConfigPath(userDataPath)).toContain(userDataPath);
    expect((await port.manifest()).providers.find((item) => item.provider === "icloud")).toMatchObject({
      connected: true
    });

    const listing = await port.listItems({
      driveRef: connected.drive.driveRef,
      clientId: "owner",
      recursive: "true",
      includeHash: "true",
      limit: 20
    });
    expect(listing.basePath).toBe("/");
    expect(listing.paths).toEqual(expect.arrayContaining([
      ".pact-data/owner/notes.txt",
      ".pact-data/public/readme.txt",
      "TeamDocs/report.txt"
    ]));
    expect(listing.items.some((item) => item.contentSha256)).toBe(true);
    expect(listing.accessReceipt.receiptId).toMatch(/^cloud_drive_access_receipt::/u);

    const downloaded = await port.downloadFile({
      driveRef: connected.drive.driveRef,
      clientId: "owner",
      path: "default/notes.txt"
    });
    expect(downloaded.content).toBe("owner note\n");
    expect(downloaded.transferReceipt.state).toBe("staged");

    const uploaded = await port.uploadFile({
      driveRef: connected.drive.driveRef,
      clientId: "owner",
      path: "default/uploaded.txt",
      content: "uploaded\n"
    });
    expect(uploaded.localWriteInvoked).toBe(true);
    expect(await fs.readFile(path.join(icloudRoot, ".pact-data", "owner", "uploaded.txt"), "utf8")).toBe("uploaded\n");

    await expect(port.uploadFile({
      driveRef: connected.drive.driveRef,
      clientId: "owner",
      path: "default/uploaded.txt",
      content: "duplicate\n"
    })).rejects.toMatchObject({ code: "DRIVE_TARGET_EXISTS" });

    await expect(port.downloadFile({
      driveRef: connected.drive.driveRef,
      clientId: "owner",
      path: "default"
    })).rejects.toMatchObject({ code: "DRIVE_TARGET_NOT_FILE" });

    await expect(port.uploadFile({
      driveRef: connected.drive.driveRef,
      clientId: "owner",
      path: "public/blocked.txt",
      content: "blocked\n"
    })).rejects.toMatchObject({ code: "DRIVE_MAPPING_READ_ONLY" });

    await expect(port.listItems({
      driveRef: connected.drive.driveRef,
      clientId: "helper",
      path: "team"
    })).rejects.toMatchObject({ code: "DRIVE_MAPPING_ACCESS_DENIED" });

    await expect(port.listItems({
      driveRef: connected.drive.driveRef,
      clientId: "owner",
      path: "../escape.txt"
    })).rejects.toThrow("云盘路径不能跳出受控根目录。");

    const permissionList = await port.permissionList({
      driveRef: connected.drive.driveRef,
      clientId: "owner",
      path: "team"
    });
    expect(permissionList.permissions[0]).toMatchObject({
      mode: "allowlist",
      subjects: ["owner"],
      writable: false
    });

    const status = await port.status({ provider: "icloud" });
    expect(status.count).toBe(1);
    expect(status.connections[0]).toMatchObject({
      syncStatus: "localAdapterVerified"
    });
  });

  it("falls back to contract metadata for oauth providers and blocks inline secrets", async () => {
    const userDataPath = await tempDir("pact-agent-cloud-contract-");
    const port = createCloudDrivePort({ userDataPath });

    await expect(port.connect({
      provider: "dropbox",
      token: "inline-secret"
    })).rejects.toMatchObject({ code: "INLINE_SECRET_VALUE" });

    await expect(port.connect({
      provider: "box",
      secretRef: "secret://pact/drive/box"
    })).rejects.toMatchObject({ code: "UNSUPPORTED_PROVIDER" });

    const connected = await port.connect({
      provider: "google-drive",
      secretRef: "secret://pact/drive/google-drive-oauth",
      mode: "contract",
      directoryMappings: [
        {
          alias: "docs",
          drivePath: "Docs",
          accessPolicy: { mode: "allowlist", subjects: ["owner"] }
        }
      ]
    });

    expect(connected.contractVerified).toBe(true);
    expect(connected.remoteLiveVerified).toBe(false);

    const listing = await port.listItems({
      driveRef: connected.drive.driveRef,
      clientId: "owner"
    });
    expect(listing.contractVerified).toBe(true);
    expect(listing.items[0]).toMatchObject({
      metadataOnly: true,
      contractVerified: true
    });

    const download = await port.downloadFile({
      driveRef: connected.drive.driveRef,
      clientId: "owner",
      path: "default/contract.txt",
      includeText: "false"
    });
    expect(download.contractVerified).toBe(true);
    expect(download.remoteReadInvoked).toBe(false);
    expect(download.content).toBeUndefined();
    expect(download.contentBase64).toBeTruthy();

    const upload = await port.uploadFile({
      driveRef: connected.drive.driveRef,
      clientId: "owner",
      path: "default/contract-upload.txt",
      contentBase64: Buffer.from("contract upload").toString("base64")
    });
    expect(upload.contractVerified).toBe(true);
    expect(upload.remoteWriteInvoked).toBe(false);
    expect(upload.localWriteInvoked).toBe(false);
    expect(upload.transferReceipt.state).toBe("contractVerified");

    const permissions = await port.permissionList({
      driveRef: connected.drive.driveRef,
      clientId: "owner",
      path: "docs"
    });
    expect(permissions.permissions[0]).toMatchObject({
      mode: "allowlist",
      principal: "owner"
    });

    const manifest = await port.manifest();
    expect(manifest.connectedProviderCount).toBe(1);
    expect(manifest.providers.find((item) => item.provider === "google-drive")).toMatchObject({
      connected: true,
      contractOnly: true
    });
  });

  it("routes remote-live adapters through fetch and surfaces provider errors", async () => {
    const userDataPath = await tempDir("pact-agent-cloud-remote-");
    const calls = [];
    const fetchMock = vi.fn(async (url, options) => {
      const body = JSON.parse(String(options?.body || "{}"));
      calls.push({ url: String(url), body });
      if (String(url).endsWith("/connect")) {
        return jsonResponse({
          ok: true,
          connection: {
            rootId: "root-1",
            rootName: "Remote Root",
            revision: "rev-1",
            accountId: "acct-1"
          }
        });
      }
      if (String(url).endsWith("/items/list")) {
        return jsonResponse({
          ok: true,
          items: [
            {
              path: ".pact-data/owner/remote.txt",
              name: "remote.txt",
              sizeBytes: 12,
              fileId: "file-1",
              webUrl: "https://drive.example/file?access_token=secret&plain=ok",
              etag: "etag-1"
            }
          ]
        });
      }
      if (String(url).endsWith("/files/download")) {
        return jsonResponse({
          ok: true,
          file: {
            contentBase64: Buffer.from("remote content\n").toString("base64"),
            fileId: "file-1",
            webUrl: "https://drive.example/file?access_token=secret"
          }
        });
      }
      if (String(url).endsWith("/files/upload")) {
        return jsonResponse({
          ok: true,
          file: {
            contentSha256: body.payload.contentSha256,
            fileId: "file-2",
            webUrl: "https://drive.example/upload?access_token=secret"
          }
        });
      }
      return textResponse("not-found", { status: 404, ok: false });
    });
    vi.stubGlobal("fetch", fetchMock);

    const port = createCloudDrivePort({ userDataPath });
    const connected = await port.connect({
      provider: "google-drive",
      secretRef: "secret://pact/drive/google-drive-oauth",
      mode: "remote-live",
      endpointUrl: "https://remote.example/api",
      directoryMappings: [
        {
          alias: "docs",
          drivePath: "Docs",
          accessPolicy: { mode: "allowlist", subjects: ["owner"] }
        }
      ]
    });

    expect(connected.remoteLiveVerified).toBe(true);
    expect(connected.telemetry.operation).toBe("connect");

    const listing = await port.listItems({
      driveRef: connected.drive.driveRef,
      clientId: "owner",
      path: "docs"
    });
    expect(listing.remoteLiveVerified).toBe(true);
    expect(listing.telemetry.operation).toBe("list");
    expect(listing.items[0].provider).toMatchObject({
      webUrl: expect.stringContaining("REDACTED")
    });

    const download = await port.downloadFile({
      driveRef: connected.drive.driveRef,
      clientId: "owner",
      path: "docs/remote.txt"
    });
    expect(download.remoteReadInvoked).toBe(true);
    expect(download.content).toBe("remote content\n");
    expect(download.providerReceipt.webUrl).toContain("REDACTED");

    const upload = await port.uploadFile({
      driveRef: connected.drive.driveRef,
      clientId: "owner",
      path: "default/new.txt",
      content: "uploaded remote\n"
    });
    expect(upload.remoteWriteInvoked).toBe(true);
    expect(upload.providerReceipt.webUrl).toContain("REDACTED");
    expect(calls.map((call) => call.url)).toEqual(expect.arrayContaining([
      "https://remote.example/api/connect",
      "https://remote.example/api/items/list",
      "https://remote.example/api/files/download",
      "https://remote.example/api/files/upload"
    ]));
  });

  it("surfaces invalid remote-live payloads as provider errors", async () => {
    const userDataPath = await tempDir("pact-agent-cloud-remote-error-");
    const fetchMock = vi.fn(async (url) => {
      if (String(url).endsWith("/connect")) {
        return jsonResponse({
          ok: true,
          connection: {
            rootId: "root-2",
            rootName: "Remote Root",
            revision: "rev-2",
            accountId: "acct-2"
          }
        });
      }
      if (String(url).endsWith("/items/list")) {
        return textResponse("not-json");
      }
      return textResponse("unexpected", { status: 404, ok: false });
    });
    vi.stubGlobal("fetch", fetchMock);

    const port = createCloudDrivePort({ userDataPath });
    const connected = await port.connect({
      provider: "onedrive",
      secretRef: "secret://pact/drive/onedrive-oauth",
      mode: "remote-live",
      endpointUrl: "https://remote.example/api"
    });

    await expect(port.listItems({
      driveRef: connected.drive.driveRef,
      clientId: "owner"
    })).rejects.toMatchObject({
      code: "REMOTE_PROVIDER_INVALID_RESPONSE"
    });
  });
});

describe("context compaction extra coverage", () => {
  it("normalizes profile variants, clamps budgets and resumes compact boundaries", async () => {
    const userDataPath = await tempDir("pact-context-profile-");
    const runtime = createContextCompactionRuntime({ userDataPath });

    const normalized = runtime.normalizePolicy(
      {
        compactionStrategy: "legacy-strategy",
        compression: {
          summaryMaxTokens: 700
        },
        compactionPolicy: {
          strategyId: "policy-strategy",
          summaryReserveTokens: "bad",
          recentMessageProtectionCount: -9,
          hardThresholdRatio: 2
        }
      },
      {
        strategyId: "patch-strategy"
      }
    );
    expect(normalized).toMatchObject({
      strategyId: "patch-strategy",
      strategy: {
        id: "patch-strategy"
      },
      summaryReserveTokens: 700,
      recentMessageProtectionCount: 0,
      hardThresholdRatio: 1
    });

    const budget = runtime.computeBudget({
      contextWindowTokens: "bad",
      outputReserveTokens: 99999,
      compactionPolicy: {
        summaryReserveTokens: 99999,
        reservedBufferTokens: 99999,
        warningBufferTokens: 99999,
        hardBufferTokens: 99999
      }
    });
    expect(budget).toMatchObject({
      contextWindowTokens: 32000,
      outputReserveTokens: 30976,
      summaryReserveTokens: 256,
      hardThresholdTokens: 512
    });

    expect(runtime.resumeTranscript({
      messages: [
        {
          id: "plain-1",
          role: "user",
          content: "no boundary"
        }
      ]
    })).toMatchObject({
      resumed: false
    });

    const resumed = runtime.resumeTranscript({
      transcript: [
        {
          id: "boundary-1",
          role: "system",
          type: "compact_boundary",
          content: "summary",
          boundary: {
            type: "compact_boundary",
            boundaryId: "boundary-1",
            sourceRange: {
              startIndex: 0,
              endIndex: 1
            }
          }
        },
        {
          id: "tail-1",
          role: "user",
          content: "after boundary"
        }
      ]
    });
    expect(resumed).toMatchObject({
      resumed: true,
      skippedMessageCount: 0
    });
    expect(resumed.messages[0]).toMatchObject({
      type: "compact_boundary"
    });
  });

  it("persists and reuses session memory while preserving source and file references", async () => {
    vi.setSystemTime(new Date("2026-06-05T00:00:00.000Z"));
    const userDataPath = await tempDir("pact-context-session-memory-");
    const runtime = createContextCompactionRuntime({
      userDataPath,
      agentMemory: createAgentMemory({ userDataPath })
    });

    const input = {
      profile: {
        profileId: "session-profile",
        contextWindowTokens: 4096,
        outputReserveTokens: 256,
        modelCompression: {
          enabled: false
        },
        compactionPolicy: {
          strategy: {
            id: "session-memory-first",
            params: {}
          },
          summaryReserveTokens: 512,
          reservedBufferTokens: 512,
          warningBufferTokens: 900,
          recentMessageProtectionCount: 2,
          recentTurnProtectionCount: 1,
          persistSessionMemory: true,
          persistBoundaries: true
        }
      },
      sessionId: "session-1",
      source: "unit",
      taskBrief: "Keep source refs and session memory",
      messages: "not-an-array",
      history:
        "Must keep source:ev-77 and file /Users/unka/DevSpace/Pact/fixtures/spec.md. token=abc123.",
      compressedHistory: "fallback history text",
      recentTurns: [
        {
          id: "t1",
          role: "user",
          content: "Follow up on source:ev-77 and preserve the decision."
        },
        {
          id: "t2",
          role: "assistant",
          content: "Decision recorded."
        }
      ],
      runtimeState: {
        activePlan: ["scan"]
      }
    };

    const first = await runtime.run(input);
    expect(first).toMatchObject({
      protocolVersion: CONTEXT_COMPACTION_PROTOCOL_VERSION,
      status: "completed",
      executionMode: "deterministic-extractive"
    });
    expect(first.summary).toContain("source:ev-77");
    expect(first.summary).toContain("<redacted-path>");
    expect(first.summary).not.toContain("abc123");

    const stored = await runtime.listSessionMemory({ sessionId: "session-1" });
    expect(stored.records.length).toBeGreaterThan(0);
    expect(stored.records[0].summary).toContain("source:ev-77");

    vi.setSystemTime(new Date("2026-06-05T00:00:10.000Z"));
    const second = await runtime.run(input);
    expect(second.executionMode).toBe("session-memory");
    expect(second.summary).toBe(first.summary);
    expect(second.memoryEvents[0]).toMatchObject({
      used: true
    });

    vi.setSystemTime(new Date("2026-06-05T00:00:20.000Z"));
    const mismatched = await runtime.run({
      ...input,
      taskBrief: "Keep source refs but change the task brief"
    });
    expect(mismatched.memoryEvents.some((event) => event.reason === "source_hash_mismatch")).toBe(true);
  });

  it("falls back deterministically when model-assisted output is malformed", async () => {
    const userDataPath = await tempDir("pact-context-model-fallback-");
    const runtime = createContextCompactionRuntime({
      userDataPath,
      modelCompressor: async () => ({
        text: "plain text without json"
      })
    });

    const result = await runtime.run({
      profile: {
        profileId: "model-profile",
        contextWindowTokens: 4096,
        outputReserveTokens: 256,
        modelCompression: {
          enabled: true
        },
        compactionPolicy: {
          strategy: {
            id: "model-assisted",
            params: {}
          },
          summaryReserveTokens: 512,
          reservedBufferTokens: 512,
          warningBufferTokens: 900,
          recentMessageProtectionCount: 2,
          recentTurnProtectionCount: 1,
          persistSessionMemory: false,
          persistBoundaries: false
        }
      },
      sessionId: "model-session",
      source: "unit",
      taskBrief: "Model fallback should preserve source refs",
      messages: "not-an-array",
      history:
        "Decision: use source:ev-91 and file /Users/unka/DevSpace/Pact/fixtures/model.md. token=abc123.",
      recentTurns: [
        {
          id: "m1",
          role: "user",
          content: "source:ev-91 must remain visible."
        },
        {
          id: "m2",
          role: "assistant",
          content: "Acknowledged."
        }
      ],
      runtimeState: {
        activePlan: ["review"],
        currentFiles: ["/Users/unka/DevSpace/Pact/server/platform/specialized/agent/agent-context/context-compact/index.mjs"]
      }
    });

    expect(result).toMatchObject({
      protocolVersion: CONTEXT_COMPACTION_PROTOCOL_VERSION,
      status: "completed",
      executionMode: "deterministic-extractive",
      degraded: true
    });
    expect(result.degradedReasons).toContain("model_compaction_json_missing");
    expect(result.modelEvents[0]).toMatchObject({
      used: false,
      degraded: true
    });
    expect(result.summary).toContain("source:ev-91");
    expect(result.summary).toContain("<redacted-path>");
    expect(result.summary).not.toContain("abc123");
  });
});
