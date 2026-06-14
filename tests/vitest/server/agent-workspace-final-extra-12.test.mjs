import crypto from "node:crypto";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAgentWorkspace } from "../../../server/platform/specialized/agent/agent-workspace/index.mjs";

function sha256(value = "") {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sha256Buffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

async function tempDir(prefix) {
  return fsPromises.mkdtemp(path.join(os.tmpdir(), prefix));
}

function createMerkleState() {
  let rootCalls = 0;
  return {
    protocolVersion: "v0.0.1:test:merkle-1",
    cas: {
      putBlock: vi.fn(async (content) => {
        const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content || "");
        return {
          cid: `cid-${sha256Buffer(buffer).slice(0, 12)}`,
          byteLength: buffer.length,
          payloadHash: sha256Buffer(buffer),
          bytes: buffer
        };
      }),
      getBlock: vi.fn(async (cid) => {
        if (cid === "missing-cid") {
          return null;
        }
        return {
          bytes: Buffer.from(`decoded:${cid}`),
          payloadHash: sha256(cid)
        };
      })
    },
    merkleDag: {
      buildManifest: vi.fn(async (kind, entries) => ({
        rootCid: `${kind}-root-${entries.length}`
      }))
    },
    stateCommit: {
      begin: vi.fn(async () => {
        rootCalls += 1;
        return {
          currentRoot: rootCalls === 1 ? "" : "state-root"
        };
      }),
      commit: vi.fn(async ({ mutations, contentRefs }) => ({
        commitId: `commit-${mutations.length}-${contentRefs.length}`,
        eventHash: "event-hash",
        beforeRoot: "before-root",
        afterRoot: "after-root",
        contentRefs,
        indexRoots: { workspace: "index-root" }
      }))
    },
    merkleIndex: {
      get: vi.fn(async (root, relativePath) => (
        relativePath.includes("hit") ? { valueRef: `value-${root}-${relativePath}` } : null
      )),
      prefix: vi.fn(async (root, prefix) => (
        prefix === "empty" ? [] : [
          { key: `${prefix || "root"}/alpha`, valueRef: `${root}-alpha` },
          { key: `${prefix || "root"}/beta`, valueRef: `${root}-beta` }
        ]
      )),
      prove: vi.fn(async () => ({ proofHash: "proof-hash" }))
    },
    lsmIngest: {
      beginUploadSession: vi.fn(async () => ({ uploadSessionId: "upload-session-1" })),
      appendChunkRecord: vi.fn(async () => ({ offset: 0, byteLength: 5 })),
      flushMemTable: vi.fn(async () => ({ segmentId: "segment-1", rootCid: "segment-root", recordCount: 1 })),
      materializeManifest: vi.fn(async () => ({ rootCid: "manifest-root" }))
    }
  };
}

function createCheckpointTreeApi() {
  return {
    checkpointTreeId: vi.fn(() => "checkpoint-tree-id"),
    loadCheckpointTree: vi.fn(async () => null),
    startCheckpointTree: vi.fn(async () => ({ started: true })),
    upsertCheckpointNode: vi.fn(async () => ({ ok: true }))
  };
}

async function withRuntime(fn, options = {}) {
  const root = await tempDir("pact-agent-workspace-final-extra-12-");
  const runtime = createAgentWorkspace({
    userDataPath: root,
    ...options
  });
  try {
    return await fn(runtime, root);
  } finally {
    runtime.close();
    await fsPromises.rm(root, { recursive: true, force: true });
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("agent workspace final extra 12 helper branches", () => {
  it("covers helper fallbacks through runtime corruption and submission gating", async () => {
    await withRuntime(async (runtime, root) => {
      const workspace = runtime.createWorkspace({ title: "Corruption Workspace" }).workspace;
      const db = new Database(path.join(root, "agent-workspaces", "agent-workspace.sqlite"));
      try {
        db.prepare("UPDATE aw_workspaces SET metadata_json = ?, profile_json = ?, owned_source_ids_json = ? WHERE workspace_id = ?")
          .run("not-json", "also-not-json", "still-not-json", workspace.workspaceId);
        db.prepare("INSERT INTO aw_private_state (id, workspace_id, run_id, agent_id, summary, state_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
          .run("private-1", workspace.workspaceId, "run-1", "agent-1", "summary", "not-json", "2026-06-05T00:00:00.000Z");
      } finally {
        db.close();
      }

      const ws = runtime.getWorkspace({
        workspaceId: workspace.workspaceId,
        includePrivate: true,
        includeRuns: false,
        includeSubmissions: false,
        includeArtifacts: false,
        includeIssues: false,
        includeDecisions: false,
        includeLocks: false
      });
      expect(ws).toMatchObject({
        workspace: {
          workspaceId: workspace.workspaceId,
          metadata: {},
          profile: {},
          ownedSourceIds: []
        }
      });
      expect(ws.privateStates).toHaveLength(1);
      expect(ws.privateStates[0].state).toEqual({});

      const run = runtime.createRun({
        workspaceId: workspace.workspaceId,
        runType: "analysis"
      }).run;

      const submission = runtime.submit({
        workspaceId: workspace.workspaceId,
        runId: run.runId,
        type: "issue",
        payload: {
          issue: "submission gating"
        }
      });
      expect(submission).toMatchObject({
        submission: {
          status: "proposed",
          type: "issue"
        }
      });
    });
  });
});

describe("agent workspace final extra 12 filesystem edges", () => {
  it("covers local directory mount validation and traversal guards", async () => {
    await withRuntime(async (runtime, root) => {
      const workspace = runtime.createWorkspace({ title: "Local Dir Workspace" }).workspace;

      const sourceRoot = await tempDir("pact-agent-workspace-final-extra-12-source-");
      const cleanSource = await tempDir("pact-agent-workspace-final-extra-12-clean-source-");
      try {
        await fsPromises.writeFile(path.join(sourceRoot, "second.txt"), "second", "utf8");
        await fsPromises.mkdir(path.join(sourceRoot, "a-dir"), { recursive: true });
        await fsPromises.writeFile(path.join(sourceRoot, "a-dir", "inner.txt"), "inner", "utf8");
        await fsPromises.symlink(path.join(sourceRoot, "second.txt"), path.join(sourceRoot, "link.txt"));
        await fsPromises.writeFile(path.join(cleanSource, "alpha.txt"), "alpha", "utf8");
        await fsPromises.mkdir(path.join(cleanSource, "nested"), { recursive: true });
        await fsPromises.writeFile(path.join(cleanSource, "nested", "beta.txt"), "beta", "utf8");
        await fsPromises.writeFile(path.join(workspace.fsPath, "root-file.txt"), "root file", "utf8");
        await fsPromises.mkdir(path.join(workspace.fsPath, "a-dir"), { recursive: true });
        await fsPromises.writeFile(path.join(workspace.fsPath, "a-dir", "child.txt"), "child", "utf8");
        await fsPromises.writeFile(path.join(workspace.fsPath, "z.txt"), "z", "utf8");

        expect(runtime.connectLocalDirectory({
          workspaceId: "missing-workspace",
          sourcePath: sourceRoot,
          targetPath: "imports"
        })).toMatchObject({
          ok: false,
          status: 404
        });

        const firstMount = runtime.connectLocalDirectory({
          workspaceId: workspace.workspaceId,
          sourcePath: cleanSource,
          targetPath: "imports"
        });
        expect(firstMount).toMatchObject({ ok: true });

        const updatedMount = runtime.connectLocalDirectory({
          workspaceId: workspace.workspaceId,
          sourcePath: sourceRoot,
          targetPath: "imports",
          mountRef: firstMount.mount.mountRef
        });
        expect(updatedMount).toMatchObject({ ok: true });

        expect(runtime.listLocalDirectoryMounts({ workspaceId: "missing-workspace" })).toMatchObject({
          ok: false,
          status: 404
        });

        expect(runtime.listLocalDirectoryItems({
          workspaceId: "missing-workspace",
          mountRef: firstMount.mount.mountRef,
          path: ""
        })).toMatchObject({
          ok: false,
          status: 404
        });

        expect(runtime.listLocalDirectoryItems({
          workspaceId: workspace.workspaceId,
          mountRef: firstMount.mount.mountRef,
          path: "../escape"
        })).toMatchObject({
          ok: false,
          status: 400,
          error: "路径不能跳出工作空间。"
        });

        expect(runtime.listLocalDirectoryItems({
          workspaceId: workspace.workspaceId,
          mountRef: firstMount.mount.mountRef,
          path: "link.txt"
        })).toMatchObject({
          ok: false,
          status: 400,
          error: "不允许列出符号链接对象。"
        });

        expect(runtime.listLocalDirectoryItems({
          workspaceId: workspace.workspaceId,
          mountRef: firstMount.mount.mountRef,
          path: "",
          recursive: true,
          limit: 1
        })).toMatchObject({
          ok: true,
          count: 1
        });

        await expect(runtime.listWorkspaceFiles({
          workspaceId: workspace.workspaceId,
          path: "",
          recursive: true,
          limit: 1,
          includeHash: true
        })).resolves.toMatchObject({
          ok: true,
          count: 1
        });

        await expect(runtime.listWorkspaceFiles({
          workspaceId: workspace.workspaceId,
          path: "root-file.txt",
          includeHash: true
        })).resolves.toMatchObject({
          ok: true,
          exists: true
        });

        expect(runtime.getWorkspace({
          workspaceId: workspace.workspaceId,
          runLimit: 0
        })).toMatchObject({
          workspace: {
            workspaceId: workspace.workspaceId
          }
        });

        expect(runtime.createSession({
          workspaceId: "missing-workspace",
          title: "Missing session workspace"
        })).toMatchObject({
          ok: false,
          error: "工作空间不存在"
        });

        const session = runtime.createSession({
          workspaceId: workspace.workspaceId,
          title: "Session A"
        }).session;
        runtime.createSession({
          workspaceId: workspace.workspaceId,
          title: "Session B"
        });

        expect(runtime.listSessions({})).toMatchObject({
          protocolVersion: "v0.0.1:workspace:agent-workspace-1"
        });
        expect(runtime.listSessions({ workspaceId: workspace.workspaceId })).toMatchObject({
          protocolVersion: "v0.0.1:workspace:agent-workspace-1"
        });
        expect(runtime.listSessions({ status: "active" })).toMatchObject({
          protocolVersion: "v0.0.1:workspace:agent-workspace-1"
        });

        const missingSource = path.join(root, "missing-source");
        const sourceSymlink = path.join(root, "source-symlink");
        const workspaceSymlink = path.join(workspace.fsPath, "workspace-symlink");
        await fsPromises.symlink(sourceRoot, sourceSymlink);
        await fsPromises.symlink(path.join(workspace.fsPath, "root-file.txt"), workspaceSymlink);

        expect(runtime.localDirectorySyncPlan({
          workspaceId: workspace.workspaceId,
          sourcePath: missingSource,
          targetPath: "sync"
        })).toMatchObject({
          ok: false,
          status: 400,
          error: "本机目录不存在。"
        });

        expect(runtime.localDirectorySyncPlan({
          workspaceId: workspace.workspaceId,
          sourcePath: path.join(sourceRoot, "second.txt"),
          targetPath: "sync"
        })).toMatchObject({
          ok: false,
          status: 400,
          error: "sourcePath 必须是本机目录。"
        });

        expect(runtime.localDirectorySyncPlan({
          workspaceId: workspace.workspaceId,
          sourcePath: sourceSymlink,
          targetPath: "sync"
        })).toMatchObject({
          ok: false,
          status: 400,
          error: "不允许连接符号链接目录。"
        });

        expect(runtime.localDirectorySyncPlan({
          workspaceId: workspace.workspaceId,
          sourcePath: sourceRoot,
          targetPath: ""
        })).toMatchObject({
          ok: false,
          status: 400,
          error: "不允许同步符号链接：link.txt"
        });

        expect(runtime.localDirectorySyncPlan({
          workspaceId: workspace.workspaceId,
          sourcePath: cleanSource,
          targetPath: ""
        })).toMatchObject({
          ok: false,
          status: 400,
          error: "工作空间内存在不允许同步的符号链接：workspace-symlink"
        });
      } finally {
        await fsPromises.rm(sourceRoot, { recursive: true, force: true });
        await fsPromises.rm(cleanSource, { recursive: true, force: true });
      }
    });
  });
});

describe("agent workspace final extra 12 file operations", () => {
  it("covers validation branches and merkle-backed file workflows", async () => {
    const merkleState = createMerkleState();
    const checkpointTreeApi = createCheckpointTreeApi();

    await withRuntime(async (runtime) => {
      const workspace = runtime.createWorkspace({ title: "Merkle File Workspace" }).workspace;

      await fsPromises.writeFile(path.join(workspace.fsPath, "existing.txt"), "existing", "utf8");
      await fsPromises.writeFile(path.join(workspace.fsPath, "move-source.txt"), "move-source", "utf8");
      await fsPromises.mkdir(path.join(workspace.fsPath, "move-dir"), { recursive: true });
      await fsPromises.writeFile(path.join(workspace.fsPath, "move-dir", "child.txt"), "child", "utf8");
      await fsPromises.mkdir(path.join(workspace.fsPath, "patch-dir"), { recursive: true });
      await fsPromises.writeFile(path.join(workspace.fsPath, "patch-dir", "inner.txt"), "inner", "utf8");

      expect(await runtime.uploadWorkspaceFile({
        workspaceId: "missing-workspace",
        fileName: "missing.txt",
        content: "missing"
      })).toMatchObject({
        ok: false,
        status: 404
      });

      expect(await runtime.uploadWorkspaceFile({
        workspaceId: workspace.workspaceId,
        fileName: "missing-content.txt"
      })).toMatchObject({
        ok: false,
        status: 400,
        error: "content 或 contentBase64 至少提供一个。"
      });

      expect(await runtime.uploadWorkspaceFile({
        workspaceId: workspace.workspaceId,
        fileName: "invalid-path.txt",
        content: "content",
        path: "../escape"
      })).toMatchObject({
        ok: false,
        status: 400,
        error: "路径不能跳出工作空间。"
      });

      const uploaded = await runtime.uploadWorkspaceFile({
        workspaceId: workspace.workspaceId,
        fileName: "upload.txt",
        content: "upload-body"
      });
      expect(uploaded).toMatchObject({
        ok: true,
        file: {
          relativePath: "files/upload.txt"
        }
      });

      const rewritten = await runtime.writeWorkspaceFile({
        workspaceId: workspace.workspaceId,
        path: "existing.txt",
        contentBase64: ""
      });
      expect(rewritten).toMatchObject({
        ok: true,
        file: {
          relativePath: "existing.txt"
        }
      });

      expect(await runtime.writeWorkspaceFile({
        workspaceId: workspace.workspaceId,
        path: "../escape",
        content: "bad"
      })).toMatchObject({
        ok: false,
        status: 400,
        error: "路径不能跳出工作空间。"
      });

      expect(await runtime.patchWorkspaceFile({
        workspaceId: workspace.workspaceId
      })).toMatchObject({
        ok: false,
        status: 400,
        error: "path 不能为空。"
      });

      expect(await runtime.patchWorkspaceFile({
        workspaceId: workspace.workspaceId,
        path: "patch-dir"
      })).toMatchObject({
        ok: false,
        status: 400,
        error: "目标路径是文件夹，不能打补丁。"
      });

      expect(await runtime.deleteWorkspaceFile({
        workspaceId: workspace.workspaceId
      })).toMatchObject({
        ok: false,
        status: 400,
        error: "path 不能为空。"
      });

      expect(await runtime.deleteWorkspaceFile({
        workspaceId: workspace.workspaceId,
        path: ".hidden"
      })).toMatchObject({
        ok: false,
        status: 400,
        error: "不允许操作以 . 开头的文件。"
      });

      const deleted = await runtime.deleteWorkspaceFile({
        workspaceId: workspace.workspaceId,
        path: "existing.txt"
      });
      expect(deleted).toMatchObject({
        ok: true,
        deleted: true
      });

      expect(await runtime.moveWorkspaceFile({
        workspaceId: workspace.workspaceId,
        sourcePath: "../escape",
        targetPath: "move-target.txt"
      })).toMatchObject({
        ok: false,
        status: 400,
        error: "路径不能跳出工作空间。"
      });

      expect(await runtime.moveWorkspaceFile({
        workspaceId: workspace.workspaceId,
        sourcePath: "move-source.txt",
        targetPath: "move-target.txt"
      })).toMatchObject({
        ok: true,
        moved: true
      });

      const movedDir = await runtime.moveWorkspaceFile({
        workspaceId: workspace.workspaceId,
        sourcePath: "move-dir",
        targetPath: "move-dir-renamed"
      });
      expect(movedDir).toMatchObject({
        ok: true,
        moved: true
      });

      const fileList = await runtime.listWorkspaceFiles({
        workspaceId: workspace.workspaceId,
        path: "move-target.txt",
        includeHash: true
      });
      expect(fileList).toMatchObject({
        ok: true,
        exists: true
      });

      const download = await runtime.downloadWorkspaceFile({
        workspaceId: workspace.workspaceId,
        path: "move-target.txt"
      });
      expect(download).toMatchObject({
        ok: true,
        file: {
          relativePath: "move-target.txt"
        }
      });

      expect(runtime.listRunArtifacts("missing-run")).toEqual([]);
    }, { merkleState, checkpointTreeApi });
  });
});
