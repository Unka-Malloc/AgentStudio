import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAgentWorkspace } from "../../../server/platform/specialized/agent/agent-workspace/index.mjs";

function sha256(value = "") {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function tempDir(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function withWorkspaceRuntime(fn, options = {}) {
  const root = await tempDir("pact-agent-workspace-final-sixth-extra-");
  const runtime = createAgentWorkspace({
    userDataPath: root,
    ...options
  });
  try {
    return await fn(runtime, root);
  } finally {
    runtime.close();
    await fs.rm(root, { recursive: true, force: true });
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("agent workspace final sixth extra coverage", () => {
  it("covers missing-workspace rejections across file mutation and snapshot APIs", async () => {
    await withWorkspaceRuntime(async (runtime) => {
      expect(await runtime.workspaceFileMetadata({
        workspaceId: "missing-workspace",
        path: "docs/readme.md"
      })).toMatchObject({
        ok: false,
        error: "工作空间不存在或不可访问。"
      });

      expect(await runtime.restoreWorkspaceFiles({
        workspaceId: "missing-workspace",
        snapshot: {
          files: [{ path: "docs/readme.md", content: "x" }]
        }
      })).toMatchObject({
        ok: false,
        error: "工作空间不存在或不可访问。"
      });

      expect(await runtime.writeWorkspaceFile({
        workspaceId: "missing-workspace",
        path: "docs/readme.md",
        content: "body"
      })).toMatchObject({
        ok: false,
        error: "工作空间不存在或不可访问。"
      });

      expect(await runtime.patchWorkspaceFile({
        workspaceId: "missing-workspace",
        path: "docs/readme.md",
        expectedSha256: sha256("body"),
        hunks: [{ oldText: "body", newText: "updated" }]
      })).toMatchObject({
        ok: false,
        error: "工作空间不存在或不可访问。"
      });

      expect(await runtime.deleteWorkspaceFile({
        workspaceId: "missing-workspace",
        path: "docs/readme.md"
      })).toMatchObject({
        ok: false,
        error: "工作空间不存在或不可访问。"
      });

      expect(await runtime.moveWorkspaceFile({
        workspaceId: "missing-workspace",
        sourcePath: "docs/readme.md",
        targetPath: "docs/archive.md"
      })).toMatchObject({
        ok: false,
        error: "工作空间不存在或不可访问。"
      });
    });
  });

  it("restores snapshot entries from CAS bytes and rebases them under the snapshot base path", async () => {
    const merkleState = {
      protocolVersion: "pact.merkle.test.v1",
      cas: {
        getBlock: vi.fn(async () => ({
          bytes: Buffer.from("restored-from-cas", "utf8")
        })),
        putBlock: vi.fn(async (content) => {
          const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content || "");
          return {
            cid: `cid-${buffer.length}`,
            byteLength: buffer.length,
            payloadHash: sha256(buffer.toString("utf8"))
          };
        })
      },
      merkleDag: {
        buildManifest: vi.fn(async (kind, entries) => ({
          rootCid: `${kind}-root-${entries.length}`
        }))
      },
      stateCommit: {
        commit: vi.fn(async ({ mutations, contentRefs }) => ({
          commitId: `commit-${mutations.length}-${contentRefs.length}`,
          eventHash: "event-hash",
          beforeRoot: "",
          afterRoot: "after-root",
          contentRefs,
          indexRoots: {}
        }))
      }
    };

    await withWorkspaceRuntime(async (runtime) => {
      const workspace = runtime.createWorkspace({ title: "Snapshot Rebase Workspace" }).workspace;
      await fs.mkdir(path.join(workspace.fsPath, "docs"), { recursive: true });
      await fs.writeFile(path.join(workspace.fsPath, "docs", "obsolete.txt"), "obsolete", "utf8");

      const dryRun = await runtime.restoreWorkspaceFiles({
        workspaceId: workspace.workspaceId,
        dryRun: true,
        snapshot: {
          basePath: "docs",
          deleteExtraneous: true,
          files: [
            {
              path: "note.txt",
              contentCid: "cid-note",
              contentSha256: sha256("restored-from-cas")
            },
            {
              path: "docs/remove.txt",
              exists: false
            }
          ]
        }
      });

      expect(dryRun).toMatchObject({
        ok: true,
        dryRun: true,
        summary: {
          create: 1,
          delete: 1
        }
      });
      expect(dryRun.appliedActions).toEqual([]);

      const restored = await runtime.restoreWorkspaceFiles({
        workspaceId: workspace.workspaceId,
        snapshot: {
          basePath: "docs",
          deleteExtraneous: true,
          files: [
            {
              path: "note.txt",
              contentCid: "cid-note",
              contentSha256: sha256("restored-from-cas")
            },
            {
              path: "docs/remove.txt",
              exists: false
            }
          ]
        }
      });

      expect(restored).toMatchObject({
        ok: true,
        dryRun: false,
        summary: {
          create: 1,
          delete: 1,
          applied: 2
        }
      });
      expect(await fs.readFile(path.join(workspace.fsPath, "docs", "note.txt"), "utf8")).toBe("restored-from-cas");
      expect(await fs.access(path.join(workspace.fsPath, "docs", "obsolete.txt")).then(() => true).catch(() => false)).toBe(false);

      expect(await runtime.restoreWorkspaceFiles({
        workspaceId: workspace.workspaceId,
        snapshot: {
          files: [{ path: "docs/.hidden", content: "x" }]
        }
      })).toMatchObject({
        ok: false,
        status: 400,
        error: "不允许恢复以 . 开头的文件。"
      });
    }, { merkleState });
  });

  it("starts checkpoint trees when needed and reports null session context after the workspace is removed", async () => {
    const merkleState = {
      protocolVersion: "pact.merkle.test.v1",
      cas: {
        putBlock: vi.fn(async (content) => {
          const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content || "");
          return {
            cid: `cid-${buffer.length}`,
            byteLength: buffer.length,
            payloadHash: sha256(buffer.toString("utf8"))
          };
        })
      },
      merkleDag: {
        buildManifest: vi.fn(async (kind, entries) => ({
          rootCid: `${kind}-root-${entries.length}`
        }))
      },
      stateCommit: {
        commit: vi.fn(async ({ mutations, contentRefs }) => ({
          commitId: `commit-${mutations.length}-${contentRefs.length}`,
          eventHash: "event-hash",
          beforeRoot: "",
          afterRoot: "after-root",
          contentRefs,
          indexRoots: {}
        }))
      }
    };

    const checkpointTreeApi = {
      checkpointTreeId: vi.fn(() => "tree-1"),
      loadCheckpointTree: vi.fn(async () => null),
      startCheckpointTree: vi.fn(async () => ({ started: true })),
      upsertCheckpointNode: vi.fn(async () => ({ ok: true }))
    };

    const noUpsertCheckpointTreeApi = {
      checkpointTreeId: vi.fn(() => "tree-2"),
      loadCheckpointTree: vi.fn(async () => null),
      startCheckpointTree: vi.fn(async () => ({ started: true }))
    };

    await withWorkspaceRuntime(async (runtime) => {
      const workspace = runtime.createWorkspace({ title: "Checkpoint Workspace" }).workspace;
      const created = await runtime.createWorkspaceFolder({
        workspaceId: workspace.workspaceId,
        folderPath: "docs"
      });

      expect(created).toMatchObject({
        ok: true,
        checkpoint: {
          treeId: "tree-1",
          nodeId: expect.stringContaining("commit:")
        }
      });
      expect(checkpointTreeApi.startCheckpointTree).toHaveBeenCalledTimes(1);
      expect(checkpointTreeApi.upsertCheckpointNode).toHaveBeenCalledTimes(1);
    }, { merkleState, checkpointTreeApi });

    await withWorkspaceRuntime(async (runtime) => {
      const workspace = runtime.createWorkspace({ title: "No Upsert Checkpoint Workspace" }).workspace;
      const created = await runtime.createWorkspaceFolder({
        workspaceId: workspace.workspaceId,
        folderPath: "docs"
      });

      expect(created).toMatchObject({
        ok: true,
        checkpoint: null
      });
      expect(noUpsertCheckpointTreeApi.startCheckpointTree).toHaveBeenCalledTimes(1);
    }, { merkleState, checkpointTreeApi: noUpsertCheckpointTreeApi });

    await withWorkspaceRuntime(async (runtime) => {
      const workspace = runtime.createWorkspace({ title: "Session Context Delete Workspace" }).workspace;
      const session = runtime.createSession({
        workspaceId: workspace.workspaceId,
        title: "Session To Lose Workspace"
      }).session;

      expect(runtime.getSessionContext(session.sessionId)).toMatchObject({
        sessionId: session.sessionId,
        workspaceId: workspace.workspaceId
      });

      expect(runtime.deleteWorkspace(workspace.workspaceId, { deleteFolder: true })).toMatchObject({
        ok: true
      });
      expect(runtime.getSessionContext(session.sessionId)).toBeNull();
    });
  });
});
