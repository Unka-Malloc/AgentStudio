import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AGENT_WORKSPACE_CONTEXT_BUNDLE_VERSION,
  createAgentWorkspace
} from "../../../server/platform/specialized/agent/agent-workspace/index.mjs";

function sha256(value = "") {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function tempDir(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function withWorkspaceRuntime(fn) {
  const root = await tempDir("pact-agent-workspace-final-extra-");
  const runtime = createAgentWorkspace({ userDataPath: root });
  try {
    return await fn(runtime, root);
  } finally {
    runtime.close();
    await fs.rm(root, { recursive: true, force: true });
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe("agent workspace final extra coverage", () => {
  it("keeps files unchanged when replacement and unified patch hunks conflict", async () => {
    await withWorkspaceRuntime(async (runtime) => {
      const workspace = runtime.createWorkspace({ title: "Patch Conflict Workspace" }).workspace;
      const filePath = path.join(workspace.fsPath, "multi.txt");
      const original = "alpha\nbeta\nalpha\n";
      await fs.writeFile(filePath, original, "utf8");

      const beforeSha256 = sha256(original);
      const replacementConflict = await runtime.patchWorkspaceFile({
        workspaceId: workspace.workspaceId,
        path: "multi.txt",
        expectedSha256: beforeSha256,
        hunks: [
          { oldText: "alpha", newText: "ALPHA" },
          { oldText: "missing", newText: "IGNORED" }
        ]
      });
      expect(replacementConflict).toMatchObject({
        ok: false,
        status: 409,
        error: "replacement hunk 与当前文件不匹配。"
      });
      expect(await fs.readFile(filePath, "utf8")).toBe(original);

      const unifiedConflict = await runtime.patchWorkspaceFile({
        workspaceId: workspace.workspaceId,
        path: "multi.txt",
        expectedSha256: beforeSha256,
        patch: [
          "@@ -1,2 +1,2 @@",
          "-alpha",
          "+ALPHA",
          "@@ -1,1 +1,1 @@",
          "-beta",
          "+BETA"
        ].join("\n")
      });
      expect(unifiedConflict).toMatchObject({
        ok: false,
        status: 409,
        error: "patch hunk 顺序重叠或倒退。"
      });
      expect(await fs.readFile(filePath, "utf8")).toBe(original);
    });
  });

  it("accepts bundle wrapper variants and rejects malformed context bundle imports", async () => {
    await withWorkspaceRuntime(async (runtime) => {
      const source = runtime.createWorkspace({ title: "Bundle Source" }).workspace;
      const wrappedTarget = runtime.createWorkspace({ title: "Wrapped Target" }).workspace;
      const directTarget = runtime.createWorkspace({ title: "Direct Target" }).workspace;
      const malformedTarget = runtime.createWorkspace({ title: "Malformed Target" }).workspace;

      runtime.setOwnedSourceIds(source.workspaceId, ["source-owned"]);
      runtime.hotSwapProfile(source.workspaceId, {
        contextProfileId: "source-profile",
        toolGrantId: "source-grant",
        modelAlias: "source-model",
        knowledgeScope: {
          includeSourceIds: ["source-include"],
          excludeSourceIds: ["source-exclude"]
        }
      });

      const exported = runtime.exportWorkspaceContextBundle(source.workspaceId, {
        includePrivate: false,
        compress: true,
        actorUserId: "bundle-builder"
      });
      expect(exported).toMatchObject({
        protocolVersion: "pact.agent-workspace.v1",
        bundleVersion: AGENT_WORKSPACE_CONTEXT_BUNDLE_VERSION,
        compressed: {
          encoding: "gzip+base64"
        }
      });
      expect(exported.bundle).toBeDefined();

      const wrappedRestore = runtime.restoreWorkspaceContextBundle(wrappedTarget.workspaceId, {
        contextBundle: {
          bundle: exported.bundle
        }
      }, {
        actorUserId: "bundle-restorer"
      });
      expect(wrappedRestore).toMatchObject({
        ok: true,
        bundleVersion: AGENT_WORKSPACE_CONTEXT_BUNDLE_VERSION,
        restoredContext: {
          contextProfileId: "source-profile",
          toolGrantId: "source-grant",
          modelAlias: "source-model"
        }
      });

      const directRestore = runtime.restoreWorkspaceContextBundle(directTarget.workspaceId, exported.bundle, {
        actorUserId: "bundle-restorer"
      });
      expect(directRestore).toMatchObject({
        ok: true,
        bundleVersion: AGENT_WORKSPACE_CONTEXT_BUNDLE_VERSION,
        restoredContext: {
          contextProfileId: "source-profile"
        }
      });

      expect(runtime.exportWorkspaceContextBundle("missing-workspace")).toBeNull();
      expect(runtime.restoreWorkspaceContextBundle("missing-workspace", {
        compressed: {
          encoding: "gzip+base64",
          payload: exported.compressed.payload
        }
      })).toMatchObject({
        ok: false,
        error: "工作空间不存在"
      });

      expect(runtime.restoreWorkspaceContextBundle(malformedTarget.workspaceId, {
        bundleCompressed: {
          encoding: "br",
          payload: "abc"
        }
      })).toMatchObject({
        ok: false,
        error: "工作空间上下文压缩包编码不受支持。"
      });

      const corruptedPayload = Buffer.from("not-a-gzip-payload", "utf8").toString("base64");
      const corruptedRestore = runtime.restoreWorkspaceContextBundle(malformedTarget.workspaceId, {
        contextBundleCompressed: {
          encoding: "gzip+base64",
          payload: corruptedPayload
        }
      });
      expect(corruptedRestore.ok).toBe(false);
      expect(corruptedRestore.error).toEqual(expect.any(String));

      const wrongVersionPayload = gzipSync(Buffer.from(JSON.stringify({
        ...exported.bundle,
        bundleVersion: "wrong-version"
      }), "utf8")).toString("base64");
      const wrongVersion = runtime.restoreWorkspaceContextBundle(malformedTarget.workspaceId, {
        compressedBundle: {
          encoding: "gzip+base64",
          payload: wrongVersionPayload
        }
      });
      expect(wrongVersion).toMatchObject({
        ok: false,
        error: "工作空间上下文压缩包版本不匹配。"
      });
    });
  });

  it("rejects malformed workspace snapshots and exercises lock and session boundaries", async () => {
    await withWorkspaceRuntime(async (runtime) => {
      const workspace = runtime.createWorkspace({ title: "Snapshot Workspace" }).workspace;
      await fs.writeFile(path.join(workspace.fsPath, "note.txt"), "snapshot-body", "utf8");

      const hashMismatch = await runtime.restoreWorkspaceFiles({
        workspaceId: workspace.workspaceId,
        fileSnapshot: {
          basePath: "",
          files: [
            {
              path: "note.txt",
              contentBase64: Buffer.from("snapshot-body", "utf8").toString("base64"),
              contentSha256: sha256("definitely-wrong")
            }
          ]
        }
      });
      expect(hashMismatch).toMatchObject({
        ok: false,
        status: 400,
        error: "文件快照 hash 不匹配：note.txt"
      });

      const cidMissing = await runtime.restoreWorkspaceFiles({
        workspaceId: workspace.workspaceId,
        workspaceFileSnapshot: {
          basePath: "",
          files: [
            {
              path: "archive.bin",
              contentCid: "cid-missing"
            }
          ]
        }
      });
      expect(cidMissing).toMatchObject({
        ok: false,
        status: 400,
        error: "文件快照引用 CAS contentCid，但 Merkle State 基座不可用。"
      });

      expect(runtime.createSession({
        workspaceId: "missing-workspace",
        title: "Missing Session"
      })).toMatchObject({
        ok: false,
        error: "工作空间不存在"
      });

      expect(runtime.hotSwapProfile("missing-workspace", {
        contextProfileId: "missing-profile"
      })).toMatchObject({
        ok: false,
        error: "工作空间不存在"
      });

      const source = runtime.createWorkspace({ title: "Source Workspace" }).workspace;
      const target = runtime.createWorkspace({ title: "Target Workspace" }).workspace;
      expect(runtime.shareWorkspace(source.workspaceId, target.workspaceId)).toMatchObject({ ok: true });
      expect(runtime.shareWorkspace(source.workspaceId, source.workspaceId)).toMatchObject({
        ok: false,
        error: "不能共享给自身"
      });
      expect(runtime.unshareWorkspace("missing-source", target.workspaceId)).toMatchObject({
        ok: false,
        error: "工作空间不可访问"
      });

      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-03-01T00:00:00.000Z"));
      const lock = runtime.acquireLock({
        workspaceId: workspace.workspaceId,
        targetType: "artifact",
        targetId: "artifact-ttl",
        ownerAgentId: "agent-a",
        ttlMs: 99 * 60 * 1000
      });
      expect(lock).toMatchObject({
        ok: true,
        lock: {
          ownerAgentId: "agent-a"
        }
      });
      expect(lock.lock.expiresAt).toBe("2026-03-01T00:30:00.000Z");

      vi.setSystemTime(new Date("2026-03-01T00:31:00.000Z"));
      expect(runtime.listLocks({
        workspaceId: workspace.workspaceId
      })).toEqual([]);
      expect(runtime.releaseLock({
        workspaceId: workspace.workspaceId,
        targetType: "artifact",
        targetId: "artifact-ttl",
        ownerAgentId: "agent-a"
      })).toMatchObject({
        ok: true,
        released: false
      });
    });
  });
});
