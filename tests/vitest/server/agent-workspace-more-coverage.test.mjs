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
  const root = await tempDir("pact-agent-workspace-more-coverage-");
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

describe("agent workspace more coverage", () => {
  it("covers workspace file conflict, hidden, metadata, and mutation error branches", async () => {
    await withWorkspaceRuntime(async (runtime) => {
      const workspace = runtime.createWorkspace({ title: "File Coverage" }).workspace;

      await fs.writeFile(path.join(workspace.fsPath, "conflict.txt"), "conflict", "utf8");
      await fs.mkdir(path.join(workspace.fsPath, "docs"), { recursive: true });
      await fs.writeFile(path.join(workspace.fsPath, "docs", "readme.md"), "hello", "utf8");
      await fs.writeFile(path.join(workspace.fsPath, ".hidden"), "secret", "utf8");

      expect(await runtime.createWorkspaceFolder({
        workspaceId: workspace.workspaceId,
        folderPath: "conflict.txt"
      })).toMatchObject({
        ok: false,
        status: 409,
        error: "目标路径已存在且不是文件夹。"
      });

      const created = await runtime.createWorkspaceFolder({
        workspaceId: workspace.workspaceId,
        folderPath: "nested/dir"
      });
      expect(created).toMatchObject({
        ok: true,
        folder: {
          type: "directory",
          relativePath: "nested/dir"
        }
      });

      const listing = await runtime.listWorkspaceFiles({
        workspaceId: workspace.workspaceId,
        folderPath: "",
        recursive: true,
        includeHash: true
      });
      expect(listing.ok).toBe(true);
      expect(listing.paths).toEqual(expect.arrayContaining(["conflict.txt", "docs", "docs/readme.md", "nested", "nested/dir"]));
      expect(listing.paths).not.toContain(".hidden");

      const topLevel = await runtime.listWorkspaceFiles({
        workspaceId: workspace.workspaceId,
        folderPath: "docs",
        recursive: false,
        includeDirectories: false
      });
      expect(topLevel.paths).toEqual(["docs/readme.md"]);

      const meta = await runtime.workspaceFileMetadata({
        workspaceId: workspace.workspaceId,
        path: "docs/readme.md",
        includeHash: false
      });
      expect(meta).toMatchObject({
        ok: true,
        exists: true,
        file: {
          type: "file",
          relativePath: "docs/readme.md",
          contentSha256: ""
        }
      });

      expect(await runtime.downloadWorkspaceFile({
        workspaceId: workspace.workspaceId,
        path: "docs"
      })).toMatchObject({
        ok: false,
        status: 400,
        error: "目标路径不是文件。"
      });

      expect(await runtime.writeWorkspaceFile({
        workspaceId: workspace.workspaceId,
        path: "docs",
        content: "replace"
      })).toMatchObject({
        ok: false,
        status: 400,
        error: "目标路径是文件夹，不能写入。"
      });

      expect(await runtime.patchWorkspaceFile({
        workspaceId: workspace.workspaceId,
        path: "docs/readme.md",
        expectedSha256: sha256("hello")
      })).toMatchObject({
        ok: false,
        status: 400,
        error: "patch 或 hunks 至少提供一个。"
      });

      expect(await runtime.patchWorkspaceFile({
        workspaceId: workspace.workspaceId,
        path: "docs/readme.md",
        expectedSha256: sha256("not-hello"),
        hunks: [{ oldText: "hello", newText: "world" }]
      })).toMatchObject({
        ok: false,
        status: 409,
        error: "文件内容与 expectedSha256 不匹配。"
      });

      expect(await runtime.patchWorkspaceFile({
        workspaceId: workspace.workspaceId,
        path: "docs/readme.md",
        expectedSha256: sha256("hello"),
        hunks: [{ oldText: "hello", newText: "hello" }]
      })).toMatchObject({
        ok: false,
        status: 409,
        error: "patch 未改变文件内容。"
      });

      expect(await runtime.deleteWorkspaceFile({
        workspaceId: workspace.workspaceId,
        path: "missing.txt"
      })).toMatchObject({
        ok: false,
        status: 404,
        error: "文件不存在。"
      });
    });
  });

  it("covers session, lock, and workspace access error branches", async () => {
    await withWorkspaceRuntime(async (runtime) => {
      const workspace = runtime.createWorkspace({ title: "Session Coverage" }).workspace;

      expect(runtime.appendSessionEvent({
        sessionId: "missing-session",
        type: "note"
      })).toBeNull();

      expect(runtime.getSession({ sessionId: "missing-session" })).toBeNull();
      expect(runtime.getSessionContext("missing-session")).toBeNull();
      expect(runtime.createSessionMergeProposal({
        targetSessionId: "missing-left",
        sourceSessionId: "missing-right"
      })).toMatchObject({
        ok: false,
        error: "会话不存在"
      });
      expect(runtime.forkSession({ sessionId: "missing-session" })).toMatchObject({
        ok: false,
        error: "会话不存在"
      });
      expect(runtime.archiveSession({ sessionId: "missing-session" })).toMatchObject({
        ok: false,
        error: "会话不存在"
      });

      const session = runtime.createSession({
        workspaceId: workspace.workspaceId,
        title: "Tracked Session",
        objective: "Track edges",
        context: {
          contextProfileId: "session-profile",
          knowledgeSourceIds: ["session-source"],
          sourceIds: ["session-source-alias"],
          alias: "session-model-alias",
          grantId: "session-grant-alias"
        }
      }).session;

      const appended = runtime.appendSessionEvent({
        sessionId: session.sessionId,
        type: "session_note",
        title: "Note",
        summary: "stored",
        payload: { targetId: "target-1" }
      });
      expect(appended).toMatchObject({
        session: {
          sessionId: session.sessionId,
          eventCount: 2
        }
      });

      const forked = runtime.forkSession({
        sessionId: session.sessionId,
        fromEventId: "not-an-event"
      });
      expect(forked).toMatchObject({
        ok: false,
        error: "分叉事件不属于该会话"
      });

      const sessionContext = runtime.getSessionContext(session.sessionId);
      expect(sessionContext).toMatchObject({
        sessionId: session.sessionId,
        knowledgeSourceIds: ["session-source"],
        contextProfileId: "session-profile",
        modelAlias: "session-model-alias",
        toolGrantId: "session-grant-alias"
      });

      expect(runtime.acquireLock({
        workspaceId: "missing-workspace",
        targetType: "artifact",
        targetId: "artifact-1",
        ownerAgentId: "agent-a"
      })).toMatchObject({
        ok: false,
        error: "workspace_forbidden"
      });

      expect(runtime.acquireLock({
        workspaceId: workspace.workspaceId,
        targetType: "artifact",
        targetId: "artifact-1"
      })).toMatchObject({
        ok: false,
        error: "missing_lock_fields"
      });

      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
      const firstLock = runtime.acquireLock({
        workspaceId: workspace.workspaceId,
        targetType: "artifact",
        targetId: "artifact-1",
        ownerAgentId: "agent-a",
        ttlMs: 1000
      });
      expect(firstLock.ok).toBe(true);

      const held = runtime.acquireLock({
        workspaceId: workspace.workspaceId,
        targetType: "artifact",
        targetId: "artifact-1",
        ownerAgentId: "agent-b"
      });
      expect(held).toMatchObject({
        ok: false,
        error: "lock_held",
        lock: {
          ownerAgentId: "agent-a"
        }
      });

      expect(runtime.releaseLock({
        workspaceId: workspace.workspaceId,
        targetType: "artifact",
        targetId: "artifact-1",
        ownerAgentId: "agent-b"
      })).toMatchObject({
        ok: false,
        error: "lock_owner_mismatch"
      });

      const expiredVisible = runtime.listLocks({
        workspaceId: workspace.workspaceId,
        includeExpired: true
      });
      expect(expiredVisible).toHaveLength(1);

      vi.setSystemTime(new Date("2026-01-01T00:00:02.000Z"));
      expect(runtime.listLocks({ workspaceId: workspace.workspaceId })).toHaveLength(0);
      expect(runtime.adminReleaseLock({
        workspaceId: workspace.workspaceId,
        targetType: "artifact",
        targetId: "artifact-1"
      })).toMatchObject({
        ok: true,
        released: false
      });

      expect(runtime.releaseLock({
        workspaceId: workspace.workspaceId,
        targetType: "artifact",
        targetId: "artifact-1"
      })).toMatchObject({
        ok: true,
        released: false
      });
    });
  });

  it("covers inheritance, sharing, and workspace context resolution errors", async () => {
    await withWorkspaceRuntime(async (runtime) => {
      const root = runtime.createWorkspace({ title: "Root" }).workspace;
      const child = runtime.createWorkspace({ title: "Child" }).workspace;
      const peer = runtime.createWorkspace({ title: "Peer" }).workspace;

      expect(runtime.setWorkspaceParent("missing-child", root.workspaceId)).toMatchObject({
        ok: false,
        error: "子工作空间不存在"
      });
      expect(runtime.setWorkspaceParent(child.workspaceId, "missing-parent")).toMatchObject({
        ok: false,
        error: "父工作空间不存在"
      });
      expect(runtime.setWorkspaceParent(child.workspaceId, root.workspaceId)).toMatchObject({
        ok: true
      });
      expect(runtime.setWorkspaceParent(root.workspaceId, child.workspaceId)).toMatchObject({
        ok: false,
        error: "设置会导致继承链循环"
      });

      expect(runtime.shareWorkspace(root.workspaceId, root.workspaceId)).toMatchObject({
        ok: false,
        error: "不能共享给自身"
      });
      expect(runtime.shareWorkspace("missing-source", peer.workspaceId)).toMatchObject({
        ok: false,
        error: "来源工作空间不存在"
      });
      expect(runtime.shareWorkspace(root.workspaceId, "missing-target")).toMatchObject({
        ok: false,
        error: "目标工作空间不存在"
      });
      expect(runtime.unshareWorkspace("missing-source", peer.workspaceId)).toMatchObject({
        ok: false,
        error: "工作空间不可访问"
      });

      runtime.setOwnedSourceIds(root.workspaceId, ["root-owned"]);
      runtime.hotSwapProfile(root.workspaceId, {
        contextProfileId: "root-profile",
        toolGrantId: "root-grant",
        modelAlias: "root-model",
        knowledgeScope: {
          includeSourceIds: ["root-include"],
          excludeSourceIds: ["root-exclude"]
        }
      });
      runtime.setOwnedSourceIds(child.workspaceId, ["child-owned"]);
      runtime.hotSwapProfile(child.workspaceId, {
        modelAlias: "child-model",
        knowledgeScope: {
          includeSourceIds: ["child-include"],
          excludeSourceIds: ["child-exclude"]
        }
      });
      runtime.shareWorkspace(root.workspaceId, child.workspaceId);

      const context = runtime.getWorkspaceContext(child.workspaceId);
      expect(context).toMatchObject({
        workspaceId: child.workspaceId,
        contextProfileId: "root-profile",
        toolGrantId: "root-grant",
        modelAlias: "child-model",
        sharingMode: "team-shared"
      });
      expect(context.knowledgeSourceIds).toEqual(
        expect.arrayContaining(["root-owned", "child-owned", "root-include", "child-include"])
      );
      expect(context.contextFingerprint).toEqual(expect.any(String));
      expect(context.chainGenerations.map((item) => item.workspaceId)).toEqual([root.workspaceId, child.workspaceId]);

      const noAccess = runtime.getWorkspaceContext("missing-workspace");
      expect(noAccess).toBeNull();
    });
  });

  it("covers workspace context bundle decode and version errors", async () => {
    await withWorkspaceRuntime(async (runtime) => {
      const source = runtime.createWorkspace({ title: "Bundle Source" }).workspace;
      const target = runtime.createWorkspace({ title: "Bundle Target" }).workspace;

      runtime.hotSwapProfile(source.workspaceId, {
        contextProfileId: "bundle-profile",
        knowledgeScope: {
          includeSourceIds: ["bundle-source-id"]
        }
      });

      expect(runtime.restoreWorkspaceContextBundle(target.workspaceId, {})).toMatchObject({
        ok: false,
        error: "缺少工作空间上下文压缩包。"
      });
      expect(runtime.restoreWorkspaceContextBundle(target.workspaceId, {
        compressed: {
          encoding: "br",
          payload: "abc"
        }
      })).toMatchObject({
        ok: false,
        error: "工作空间上下文压缩包编码不受支持。"
      });

      const exported = runtime.exportWorkspaceContextBundle(source.workspaceId, {
        actorUserId: "bundle-builder",
        compress: true
      });
      expect(exported).toMatchObject({
        protocolVersion: runtime.protocolVersion,
        bundleVersion: AGENT_WORKSPACE_CONTEXT_BUNDLE_VERSION
      });

      expect(runtime.restoreWorkspaceContextBundle(target.workspaceId, {
        protocolVersion: exported.protocolVersion,
        bundleVersion: "wrong-version",
        compressed: {
          encoding: "gzip+base64",
          payload: gzipSync(Buffer.from(JSON.stringify({
            ...exported.bundle,
            bundleVersion: "wrong-version"
          }), "utf8")).toString("base64")
        }
      })).toMatchObject({
        ok: false,
        error: "工作空间上下文压缩包版本不匹配。"
      });
    });
  });
});
