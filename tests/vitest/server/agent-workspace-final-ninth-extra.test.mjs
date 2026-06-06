import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AGENT_SESSION_THREAD_VERSION,
  AGENT_WORKSPACE_CONTEXT_BUNDLE_VERSION,
  createAgentWorkspace
} from "../../../server/platform/specialized/agent/agent-workspace/index.mjs";

function sha256(value = "") {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function tempDir(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function withRuntime(fn) {
  const root = await tempDir("pact-agent-workspace-final-ninth-extra-");
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
  vi.restoreAllMocks();
});

describe("agent workspace final ninth extra coverage", () => {
  it("rejects folder creation conflicts and still creates nested folders when the path is free", async () => {
    await withRuntime(async (runtime) => {
      const workspace = runtime.createWorkspace({ title: "Folder Conflict Workspace" }).workspace;
      await fs.writeFile(path.join(workspace.fsPath, "docs.txt"), "occupied", "utf8");

      expect(await runtime.createWorkspaceFolder({
        workspaceId: workspace.workspaceId,
        folderPath: "docs.txt"
      })).toMatchObject({
        ok: false,
        status: 409,
        error: "目标路径已存在且不是文件夹。"
      });

      const created = await runtime.createWorkspaceFolder({
        workspaceId: workspace.workspaceId,
        folderPath: "docs/archive"
      });
      expect(created).toMatchObject({
        ok: true,
        folder: {
          type: "directory",
          relativePath: "docs/archive"
        }
      });
      expect((await fs.stat(path.join(workspace.fsPath, "docs", "archive"))).isDirectory()).toBe(true);
    });
  });

  it("moves files through overwrite conflict and replacement branches", async () => {
    await withRuntime(async (runtime) => {
      const workspace = runtime.createWorkspace({ title: "Move Workspace" }).workspace;
      await fs.mkdir(path.join(workspace.fsPath, "docs"), { recursive: true });
      await fs.writeFile(path.join(workspace.fsPath, "source.txt"), "source-body", "utf8");
      await fs.writeFile(path.join(workspace.fsPath, "docs", "target.txt"), "target-body", "utf8");

      expect(await runtime.moveWorkspaceFile({
        workspaceId: workspace.workspaceId,
        sourcePath: "source.txt",
        targetPath: "docs/target.txt"
      })).toMatchObject({
        ok: false,
        status: 409,
        error: "目标路径已存在。设置 overwrite: true 以覆盖。"
      });

      const moved = await runtime.moveWorkspaceFile({
        workspaceId: workspace.workspaceId,
        sourcePath: "source.txt",
        targetPath: "docs/target.txt",
        overwrite: true
      });
      expect(moved).toMatchObject({
        ok: true,
        moved: true,
        sourcePath: "source.txt",
        targetPath: "docs/target.txt"
      });
      expect(await fs.readFile(path.join(workspace.fsPath, "docs", "target.txt"), "utf8")).toBe("source-body");
      expect(await fs.access(path.join(workspace.fsPath, "source.txt")).then(() => true).catch(() => false)).toBe(false);
    });
  });

  it("plans and applies sync operations across create, write, delete, and noop actions", async () => {
    await withRuntime(async (runtime) => {
      const workspace = runtime.createWorkspace({ title: "Sync Coverage Workspace" }).workspace;
      const sourceRoot = await tempDir("pact-agent-workspace-sync-source-");

      try {
        await fs.mkdir(path.join(sourceRoot, "nested"), { recursive: true });
        await fs.writeFile(path.join(sourceRoot, "new.txt"), "new-body", "utf8");
        await fs.writeFile(path.join(sourceRoot, "same.txt"), "same-body", "utf8");
        await fs.writeFile(path.join(sourceRoot, "changed.txt"), "source-body", "utf8");
        await fs.writeFile(path.join(sourceRoot, "nested", "inner.txt"), "inner-body", "utf8");

        await fs.mkdir(path.join(workspace.fsPath, "sync"), { recursive: true });
        await fs.writeFile(path.join(workspace.fsPath, "sync", "same.txt"), "same-body", "utf8");
        await fs.writeFile(path.join(workspace.fsPath, "sync", "changed.txt"), "old-body", "utf8");
        await fs.writeFile(path.join(workspace.fsPath, "sync", "stale.txt"), "stale-body", "utf8");

        const plan = runtime.localDirectorySyncPlan({
          workspaceId: workspace.workspaceId,
          sourcePath: sourceRoot,
          targetPath: "sync",
          deleteExtraneous: true
        });
        expect(plan).toMatchObject({
          ok: true,
          dryRun: true,
          summary: {
            create: 2,
            write: 1,
            delete: 1,
            noop: 1
          }
        });

        const applied = await runtime.applyLocalDirectorySync({
          workspaceId: workspace.workspaceId,
          sourcePath: sourceRoot,
          targetPath: "sync",
          deleteExtraneous: true
        });
        expect(applied).toMatchObject({
          ok: true,
          dryRun: false,
          summary: {
            create: 2,
            write: 1,
            delete: 1,
            noop: 1,
            applied: 4
          }
        });
        expect(await fs.readFile(path.join(workspace.fsPath, "sync", "new.txt"), "utf8")).toBe("new-body");
        expect(await fs.readFile(path.join(workspace.fsPath, "sync", "changed.txt"), "utf8")).toBe("source-body");
        expect(await fs.readFile(path.join(workspace.fsPath, "sync", "nested", "inner.txt"), "utf8")).toBe("inner-body");
        expect(await fs.access(path.join(workspace.fsPath, "sync", "stale.txt")).then(() => true).catch(() => false)).toBe(false);
      } finally {
        await fs.rm(sourceRoot, { recursive: true, force: true });
      }
    });
  });

  it("rejects invalid sync roots before planning", async () => {
    await withRuntime(async (runtime) => {
      const workspace = runtime.createWorkspace({ title: "Sync Validation Workspace" }).workspace;
      const sourceRoot = await tempDir("pact-agent-workspace-sync-source-");
      const sourceFile = path.join(sourceRoot, "source.txt");

      try {
        await fs.writeFile(sourceFile, "body", "utf8");

        expect(runtime.localDirectorySyncPlan({
          workspaceId: workspace.workspaceId,
          sourcePath: ""
        })).toMatchObject({
          ok: false,
          status: 400,
          error: "sourcePath 不能为空。"
        });

        expect(runtime.localDirectorySyncPlan({
          workspaceId: workspace.workspaceId,
          sourcePath: sourceFile
        })).toMatchObject({
          ok: false,
          status: 400,
          error: "sourcePath 必须是本机目录。"
        });

        expect(runtime.localDirectorySyncPlan({
          workspaceId: workspace.workspaceId,
          sourcePath: path.parse(sourceRoot).root
        })).toMatchObject({
          ok: false,
          status: 400,
          error: "不能把文件系统根目录作为受控本机目录。"
        });
      } finally {
        await fs.rm(sourceRoot, { recursive: true, force: true });
      }
    });
  });

  it("treats preview restores as dry runs and leaves unchanged files as no-ops", async () => {
    await withRuntime(async (runtime) => {
      const workspace = runtime.createWorkspace({ title: "Restore Preview Workspace" }).workspace;
      await fs.mkdir(path.join(workspace.fsPath, "docs"), { recursive: true });
      await fs.writeFile(path.join(workspace.fsPath, "docs", "keep.txt"), "keep-body", "utf8");

      const restored = await runtime.restoreWorkspaceFiles({
        workspaceId: workspace.workspaceId,
        preview: true,
        snapshot: {
          basePath: "docs",
          files: [
            {
              path: "keep.txt",
              content: "keep-body",
              contentSha256: sha256("keep-body")
            }
          ]
        }
      });

      expect(restored).toMatchObject({
        ok: true,
        dryRun: true,
        basePath: "docs",
        summary: {
          create: 0,
          write: 0,
          delete: 0,
          noop: 1,
          applied: 0
        }
      });
      expect(restored.stateCommit).toBeNull();
      expect(restored.checkpoint).toBeNull();
      expect(await fs.readFile(path.join(workspace.fsPath, "docs", "keep.txt"), "utf8")).toBe("keep-body");
    });
  });

  it("exports and restores context bundles through wrapper payloads and hash aliases", async () => {
    await withRuntime(async (runtime) => {
      const source = runtime.createWorkspace({ title: "Bundle Source Workspace" }).workspace;
      const target = runtime.createWorkspace({ title: "Bundle Target Workspace" }).workspace;

      runtime.setOwnedSourceIds(source.workspaceId, ["source-a"]);
      runtime.hotSwapProfile(source.workspaceId, {
        contextProfileId: "bundle-profile",
        toolGrantId: "bundle-grant",
        modelAlias: "bundle-model",
        knowledgeScope: {
          includeSourceIds: ["source-b"]
        }
      });
      runtime.createSession({
        workspaceId: source.workspaceId,
        title: "Bundle Session",
        objective: "bundle export",
        initialEvent: false
      });

      const exported = runtime.exportWorkspaceContextBundle(source.workspaceId, {
        includePrivate: false,
        includeBundle: true,
        compress: false
      });
      expect(exported).toMatchObject({
        bundleVersion: AGENT_WORKSPACE_CONTEXT_BUNDLE_VERSION,
        compression: {
          algorithm: "none"
        }
      });
      expect(exported.bundle).toMatchObject({
        bundleVersion: AGENT_WORKSPACE_CONTEXT_BUNDLE_VERSION
      });

      const restored = runtime.restoreWorkspaceContextBundle(target.workspaceId, {
        contextBundle: {
          bundle: exported.bundle
        },
        bundleHash: exported.bundleHash
      });
      expect(restored).toMatchObject({
        ok: true,
        bundleVersion: AGENT_WORKSPACE_CONTEXT_BUNDLE_VERSION,
        source: {
          workspaceId: source.workspaceId
        },
        applied: {
          contextProfileId: "bundle-profile",
          toolGrantId: "bundle-grant",
          modelAlias: "bundle-model"
        }
      });
      expect(restored.restoredContext.sessionProtocolVersion).toBeUndefined();
      expect(restored.restoredContext.knowledgeSourceIds).toEqual(expect.arrayContaining(["source-a", "source-b"]));
    });
  });

  it("keeps session threads append-only and ignores missing-thread event appends", async () => {
    await withRuntime(async (runtime) => {
      const workspace = runtime.createWorkspace({ title: "Session Thread Workspace" }).workspace;
      const session = runtime.createSession({
        workspaceId: workspace.workspaceId,
        title: "Thread Session",
        objective: "session thread coverage",
        initialEvent: false,
        context: {
          sourceIds: ["session-source"],
          alias: "session-model",
          grantId: "session-grant"
        }
      }).session;

      expect(runtime.appendSessionEvent({
        sessionId: "missing-session",
        type: "note",
        title: "Missing",
        summary: "should not append"
      })).toBeNull();

      const sessionInfo = runtime.getSession(session.sessionId, {
        includeEvents: false
      });
      expect(sessionInfo).toMatchObject({
        protocolVersion: runtime.protocolVersion,
        sessionProtocolVersion: AGENT_SESSION_THREAD_VERSION,
        appendOnly: true,
        session: {
          sessionId: session.sessionId,
          title: "Thread Session"
        },
        events: []
      });

      const sessionContext = runtime.getSessionContext(session.sessionId);
      expect(sessionContext).toMatchObject({
        sessionProtocolVersion: AGENT_SESSION_THREAD_VERSION,
        sessionId: session.sessionId,
        sessionTitle: "Thread Session",
        knowledgeSourceIds: ["session-source"],
        contextProfileId: "",
        toolGrantId: "session-grant",
        modelAlias: "session-model"
      });

      const sessionList = runtime.listSessions({
        workspaceId: workspace.workspaceId,
        includeLastEvent: false,
        seedRoots: false
      });
      expect(sessionList).toMatchObject({
        sessionProtocolVersion: AGENT_SESSION_THREAD_VERSION,
        sharingMode: "team-shared",
        appendOnly: true
      });
      expect(sessionList.sessions.map((item) => item.sessionId)).toContain(session.sessionId);
    });
  });
});
