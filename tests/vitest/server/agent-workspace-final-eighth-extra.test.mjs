import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAgentWorkspace } from "../../../server/platform/specialized/agent/agent-workspace/index.mjs";

async function tempDir(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function withRuntime(fn, options = {}) {
  const root = await tempDir("pact-agent-workspace-final-eighth-extra-");
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

describe("agent workspace final eighth extra coverage", () => {
  it("keeps workspace profile fallback while session fields override context resolution", async () => {
    await withRuntime(async (runtime) => {
      const workspace = runtime.createWorkspace({ title: "Session Seed Workspace" }).workspace;
      runtime.setOwnedSourceIds(workspace.workspaceId, ["workspace-owned"]);
      runtime.hotSwapProfile(workspace.workspaceId, {
        contextProfileId: "workspace-profile",
        toolGrantId: "workspace-grant",
        modelAlias: "workspace-model",
        knowledgeScope: {
          includeSourceIds: ["workspace-include"],
          excludeSourceIds: ["workspace-exclude"]
        }
      });

      const session = runtime.createSession({
        workspaceId: workspace.workspaceId,
        title: "Explicit Context Session",
        objective: "prefer explicit session fields",
        context: {
          sourceIds: ["session-source-a", "session-source-b"],
          alias: "session-model",
          grantId: "session-grant"
        }
      }).session;

      const sessionContext = runtime.getSessionContext(session.sessionId);
      expect(sessionContext).toMatchObject({
        sessionId: session.sessionId,
        sessionProtocolVersion: "v0.0.1:agent:session-thread-1",
        contextProfileId: "workspace-profile",
        modelAlias: "session-model",
        toolGrantId: "session-grant"
      });
      expect(sessionContext.knowledgeSourceIds).toEqual([
        "session-source-a",
        "session-source-b"
      ]);
      expect(sessionContext.sessionContext).toMatchObject({
        sourceIds: ["session-source-a", "session-source-b"]
      });
      expect(sessionContext.workspaceContext).toMatchObject({
        contextProfileId: "workspace-profile",
        toolGrantId: "workspace-grant",
        modelAlias: "workspace-model"
      });
      expect(sessionContext.workspaceContext.knowledgeSourceIds).toEqual(
        expect.arrayContaining(["workspace-owned", "workspace-include"])
      );
    });
  });

  it("rejects symlinked sync roots and honors dry-run applyLocalDirectorySync", async () => {
    await withRuntime(async (runtime, root) => {
      const workspace = runtime.createWorkspace({ title: "Sync Workspace" }).workspace;
      const sourceRoot = await tempDir("pact-agent-workspace-sync-source-");
      const symlinkRoot = path.join(root, "symlink-source");

      try {
        await fs.writeFile(path.join(sourceRoot, "alpha.txt"), "alpha", "utf8");
        await fs.symlink(sourceRoot, symlinkRoot);

        expect(runtime.localDirectorySyncPlan({
          workspaceId: workspace.workspaceId,
          sourcePath: symlinkRoot,
          targetPath: "sync"
        })).toMatchObject({
          ok: false,
          status: 400,
          error: "不允许连接符号链接目录。"
        });

        const dryRun = await runtime.applyLocalDirectorySync({
          workspaceId: workspace.workspaceId,
          sourcePath: sourceRoot,
          targetPath: "sync",
          dryRun: true
        });
        expect(dryRun).toMatchObject({
          protocolVersion: runtime.protocolVersion,
          ok: true,
          dryRun: true,
          targetPath: "sync",
          summary: {
            create: 1
          }
        });
        expect(await fs.access(path.join(workspace.fsPath, "sync", "alpha.txt")).then(() => true).catch(() => false)).toBe(false);
      } finally {
        await fs.rm(sourceRoot, { recursive: true, force: true });
        await fs.rm(symlinkRoot, { force: true });
      }
    });
  });

  it("restores explicit tombstone entries as deletions", async () => {
    await withRuntime(async (runtime) => {
      const workspace = runtime.createWorkspace({ title: "Snapshot Delete Workspace" }).workspace;
      await fs.writeFile(path.join(workspace.fsPath, "obsolete.txt"), "obsolete", "utf8");

      const restored = await runtime.restoreWorkspaceFiles({
        workspaceId: workspace.workspaceId,
        snapshot: {
          files: [
            {
              path: "obsolete.txt",
              deleted: true
            }
          ]
        }
      });

      expect(restored).toMatchObject({
        ok: true,
        dryRun: false,
        summary: {
          delete: 1,
          applied: 1
        }
      });
      expect(await fs.access(path.join(workspace.fsPath, "obsolete.txt")).then(() => true).catch(() => false)).toBe(false);
    });
  });

  it("restores direct bundle payloads with expectedBundleHash aliases", async () => {
    await withRuntime(async (runtime) => {
      const source = runtime.createWorkspace({ title: "Bundle Source" }).workspace;
      const target = runtime.createWorkspace({ title: "Bundle Target" }).workspace;

      runtime.setOwnedSourceIds(source.workspaceId, ["bundle-owned"]);
      runtime.hotSwapProfile(source.workspaceId, {
        contextProfileId: "bundle-profile",
        toolGrantId: "bundle-grant",
        modelAlias: "bundle-model",
        knowledgeScope: {
          includeSourceIds: ["bundle-include"]
        }
      });

      const exported = runtime.exportWorkspaceContextBundle(source.workspaceId, {
        includePrivate: false,
        includeBundle: true,
        compress: false
      });

      const restored = runtime.restoreWorkspaceContextBundle(target.workspaceId, exported.bundle, {
        expectedBundleHash: exported.bundleHash,
        actorUserId: "bundle-restorer"
      });

      expect(restored).toMatchObject({
        ok: true,
        bundleVersion: exported.bundleVersion,
        source: {
          workspaceId: source.workspaceId
        },
        restoredContext: {
          contextProfileId: "bundle-profile",
          toolGrantId: "bundle-grant",
          modelAlias: "bundle-model"
        }
      });
      expect(restored.restoredContext.knowledgeSourceIds).toEqual(
        expect.arrayContaining(["bundle-owned", "bundle-include"])
      );
    });
  });
});
