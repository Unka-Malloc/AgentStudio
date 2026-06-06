import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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
  const root = await tempDir("pact-agent-workspace-even-more-coverage-");
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

describe("agent workspace even more coverage", () => {
  it("covers hidden file filters, metadata variants, and read/write/patch/delete edges", async () => {
    await withWorkspaceRuntime(async (runtime) => {
      const workspace = runtime.createWorkspace({ title: "File Edges" }).workspace;

      await fs.mkdir(path.join(workspace.fsPath, "docs"), { recursive: true });
      await fs.mkdir(path.join(workspace.fsPath, "empty-dir"), { recursive: true });
      await fs.writeFile(path.join(workspace.fsPath, "docs", "readme.md"), "v1", "utf8");
      await fs.writeFile(path.join(workspace.fsPath, "docs", ".secret"), "hidden", "utf8");
      await fs.writeFile(path.join(workspace.fsPath, "visible.txt"), "visible", "utf8");

      const missingListing = await runtime.listWorkspaceFiles({
        workspaceId: workspace.workspaceId,
        folderPath: "missing"
      });
      expect(missingListing).toMatchObject({
        ok: true,
        exists: false,
        paths: [],
        files: []
      });

      const listing = await runtime.listWorkspaceFiles({
        workspaceId: workspace.workspaceId,
        folderPath: "",
        recursive: true,
        includeHash: true
      });
      expect(listing.ok).toBe(true);
      expect(listing.paths).toEqual(expect.arrayContaining(["docs", "docs/readme.md", "empty-dir", "visible.txt"]));
      expect(listing.paths).not.toContain("docs/.secret");

      const docsListing = await runtime.listWorkspaceFiles({
        workspaceId: workspace.workspaceId,
        folderPath: "docs",
        recursive: false,
        includeDirectories: false
      });
      expect(docsListing.paths).toEqual(["docs/readme.md"]);

      expect(await runtime.workspaceFileMetadata({
        workspaceId: workspace.workspaceId,
        path: "docs/readme.md",
        includeHash: false
      })).toMatchObject({
        ok: true,
        exists: true,
        file: {
          type: "file",
          relativePath: "docs/readme.md",
          contentSha256: ""
        }
      });

      expect(await runtime.workspaceFileMetadata({
        workspaceId: workspace.workspaceId,
        path: "missing.txt"
      })).toMatchObject({
        ok: true,
        exists: false,
        file: {
          relativePath: "missing.txt"
        }
      });

      expect(await runtime.downloadWorkspaceFile({
        workspaceId: workspace.workspaceId,
        path: "docs"
      })).toMatchObject({
        ok: false,
        status: 400
      });

      expect(await runtime.downloadWorkspaceFile({
        workspaceId: workspace.workspaceId,
        path: "missing.txt"
      })).toMatchObject({
        ok: false,
        status: 404
      });

      expect(await runtime.writeWorkspaceFile({
        workspaceId: workspace.workspaceId,
        path: ".hidden",
        content: "nope"
      })).toMatchObject({
        ok: false,
        status: 400
      });

      expect(await runtime.writeWorkspaceFile({
        workspaceId: workspace.workspaceId,
        path: "docs/readme.md",
        contentBase64: Buffer.from("v2", "utf8").toString("base64")
      })).toMatchObject({
        ok: true,
        overwritten: true
      });

      const written = await runtime.downloadWorkspaceFile({
        workspaceId: workspace.workspaceId,
        path: "docs/readme.md"
      });
      expect(written).toMatchObject({
        ok: true,
        content: "v2"
      });

      expect(await runtime.patchWorkspaceFile({
        workspaceId: workspace.workspaceId,
        path: "docs/readme.md",
        expectedSha256: sha256("v2"),
        hunks: [{ oldText: "v2", newText: "v2" }]
      })).toMatchObject({
        ok: false,
        status: 409
      });

      expect(await runtime.patchWorkspaceFile({
        workspaceId: workspace.workspaceId,
        path: "docs/readme.md",
        expectedSha256: sha256("v2"),
        hunks: [{ oldText: "v2", newText: "v3" }]
      })).toMatchObject({
        ok: true,
        patched: true
      });

      expect(await runtime.deleteWorkspaceFile({
        workspaceId: workspace.workspaceId,
        path: "missing.txt"
      })).toMatchObject({
        ok: false,
        status: 404
      });

      expect(await runtime.deleteWorkspaceFile({
        workspaceId: workspace.workspaceId,
        path: "empty-dir"
      })).toMatchObject({
        ok: true,
        deleted: true
      });
    });
  });

  it("covers session context derivation, share/profile branches, and lock outcomes", async () => {
    await withWorkspaceRuntime(async (runtime) => {
      const root = runtime.createWorkspace({ title: "Root" }).workspace;
      const child = runtime.createWorkspace({ title: "Child" }).workspace;
      const peer = runtime.createWorkspace({ title: "Peer" }).workspace;

      expect(runtime.setWorkspaceParent(child.workspaceId, root.workspaceId)).toMatchObject({ ok: true });
      expect(runtime.setOwnedSourceIds(root.workspaceId, ["root-owned"])).toMatchObject({ ok: true });
      expect(runtime.setOwnedSourceIds(child.workspaceId, ["child-owned"])).toMatchObject({ ok: true });
      expect(runtime.hotSwapProfile(root.workspaceId, {
        contextProfileId: "root-profile",
        toolGrantId: "root-grant",
        modelAlias: "root-model",
        knowledgeScope: {
          includeSourceIds: ["root-include"],
          excludeSourceIds: ["root-exclude"]
        }
      })).toMatchObject({ ok: true });
      expect(runtime.hotSwapProfile(child.workspaceId, {
        modelAlias: "child-model",
        knowledgeScope: {
          includeSourceIds: ["child-include"],
          excludeSourceIds: ["child-exclude"]
        }
      })).toMatchObject({ ok: true });
      expect(runtime.shareWorkspace(root.workspaceId, child.workspaceId)).toMatchObject({ ok: true });

      expect(runtime.appendSessionEvent({
        sessionId: "missing-session",
        type: "note"
      })).toBeNull();

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
      expect(runtime.unshareWorkspace(root.workspaceId, peer.workspaceId)).toMatchObject({
        ok: true,
        wasShared: false
      });

      const session = runtime.createSession({
        workspaceId: child.workspaceId,
        title: "Session Edges",
        objective: "Track context derivation",
        initialEvent: false,
        context: {
          contextProfileId: "session-profile",
          sourceIds: ["session-source"],
          alias: "session-model",
          grantId: "session-grant"
        }
      }).session;

      const sessionContext = runtime.getSessionContext(session.sessionId);
      expect(sessionContext).toMatchObject({
        sessionId: session.sessionId,
        contextProfileId: "session-profile",
        modelAlias: "session-model",
        toolGrantId: "session-grant"
      });
      expect(sessionContext.knowledgeSourceIds).toEqual(["session-source"]);
      expect(sessionContext.workspaceContext).toMatchObject({
        workspaceId: child.workspaceId,
        contextProfileId: "root-profile",
        toolGrantId: "root-grant",
        modelAlias: "child-model"
      });

      expect(runtime.getSessionContext("missing-session")).toBeNull();

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
        workspaceId: child.workspaceId,
        targetType: "artifact",
        targetId: "artifact-1"
      })).toMatchObject({
        ok: false,
        error: "missing_lock_fields"
      });

      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

      const firstLock = runtime.acquireLock({
        workspaceId: child.workspaceId,
        targetType: "artifact",
        targetId: "artifact-1",
        ownerAgentId: "agent-a",
        ttlMs: 1000
      });
      expect(firstLock).toMatchObject({
        ok: true,
        lock: {
          ownerAgentId: "agent-a"
        }
      });

      expect(runtime.acquireLock({
        workspaceId: child.workspaceId,
        targetType: "artifact",
        targetId: "artifact-1",
        ownerAgentId: "agent-b"
      })).toMatchObject({
        ok: false,
        error: "lock_held"
      });

      expect(runtime.releaseLock({
        workspaceId: child.workspaceId,
        targetType: "artifact",
        targetId: "artifact-1",
        ownerAgentId: "agent-b"
      })).toMatchObject({
        ok: false,
        error: "lock_owner_mismatch"
      });

      expect(runtime.releaseLock({
        workspaceId: child.workspaceId,
        targetType: "artifact",
        targetId: "artifact-1",
        ownerAgentId: "agent-a"
      })).toMatchObject({
        ok: true,
        released: true
      });

      expect(runtime.adminReleaseLock({
        workspaceId: child.workspaceId,
        targetType: "artifact",
        targetId: "artifact-1"
      })).toMatchObject({
        ok: true,
        released: false
      });
    });
  });

  it("covers workspace context bundle export/import and workspace file restoration branches", async () => {
    await withWorkspaceRuntime(async (runtime) => {
      const source = runtime.createWorkspace({ title: "Bundle Source" }).workspace;
      const target = runtime.createWorkspace({ title: "Bundle Target" }).workspace;
      const restoreTarget = runtime.createWorkspace({ title: "Restore Target" }).workspace;

      runtime.setOwnedSourceIds(source.workspaceId, ["bundle-owned"]);
      runtime.hotSwapProfile(source.workspaceId, {
        contextProfileId: "bundle-profile",
        toolGrantId: "bundle-grant",
        modelAlias: "bundle-model",
        knowledgeScope: {
          includeSourceIds: ["bundle-include"],
          excludeSourceIds: ["bundle-exclude"]
        }
      });
      runtime.createRun({
        workspaceId: source.workspaceId,
        runType: "analysis",
        status: "completed",
        input: { purpose: "bundle" },
        steps: [{ id: "step-1", status: "completed" }],
        artifactIds: ["artifact-1"]
      });
      runtime.createArtifact({
        workspaceId: source.workspaceId,
        runId: "run-1",
        level: "Artifact",
        title: "Bundle artifact",
        content: "artifact content"
      });
      runtime.createIssue({
        workspaceId: source.workspaceId,
        runId: "run-1",
        title: "Bundle issue"
      });
      runtime.savePrivateState({
        workspaceId: source.workspaceId,
        runId: "run-1",
        agentId: "agent-1",
        summary: "secret state",
        state: { hidden: true }
      });

      const compactExport = runtime.exportWorkspaceContextBundle(source.workspaceId, {
        includeBundle: false,
        compress: false,
        includePrivate: true,
        maxItems: 1
      });
      expect(compactExport).toMatchObject({
        protocolVersion: runtime.protocolVersion,
        bundleVersion: AGENT_WORKSPACE_CONTEXT_BUNDLE_VERSION,
        workspaceId: source.workspaceId,
        compression: {
          algorithm: "none"
        }
      });
      expect(compactExport.bundle).toBeUndefined();
      expect(compactExport.compressed).toBeNull();

      const exported = runtime.exportWorkspaceContextBundle(source.workspaceId, {
        includePrivate: true,
        compress: true,
        maxItems: 2
      });
      expect(exported).toMatchObject({
        protocolVersion: runtime.protocolVersion,
        bundleVersion: AGENT_WORKSPACE_CONTEXT_BUNDLE_VERSION,
        workspaceId: source.workspaceId,
        compression: {
          algorithm: "gzip"
        }
      });
      expect(exported.bundle).toBeDefined();
      expect(exported.compressed?.encoding).toBe("gzip+base64");

      expect(runtime.restoreWorkspaceContextBundle(target.workspaceId, {
        bundle: exported.bundle,
        bundleHash: "not-a-real-hash"
      })).toMatchObject({
        ok: false,
        error: "工作空间上下文压缩包 hash 校验失败。"
      });

      const restoredFromBundle = runtime.restoreWorkspaceContextBundle(target.workspaceId, {
        bundle: exported.bundle,
        bundleHash: exported.bundleHash
      }, {
        actorUserId: "restorer-a"
      });
      expect(restoredFromBundle).toMatchObject({
        ok: true,
        bundleVersion: AGENT_WORKSPACE_CONTEXT_BUNDLE_VERSION,
        workspace: {
          workspaceId: target.workspaceId
        },
        restoredContext: {
          contextProfileId: "bundle-profile",
          toolGrantId: "bundle-grant",
          modelAlias: "bundle-model"
        }
      });

      const compressedTarget = runtime.createWorkspace({ title: "Compressed Restore Target" }).workspace;
      const restoredFromCompressed = runtime.restoreWorkspaceContextBundle(compressedTarget.workspaceId, {
        compressed: exported.compressed,
        bundleHash: exported.bundleHash
      }, {
        actorUserId: "restorer-b"
      });
      expect(restoredFromCompressed).toMatchObject({
        ok: true,
        workspace: {
          workspaceId: compressedTarget.workspaceId
        }
      });

      await fs.mkdir(path.join(restoreTarget.fsPath), { recursive: true });
      await fs.writeFile(path.join(restoreTarget.fsPath, "keep.txt"), "old-keep", "utf8");
      await fs.writeFile(path.join(restoreTarget.fsPath, "remove-explicit.txt"), "old-explicit", "utf8");
      await fs.writeFile(path.join(restoreTarget.fsPath, "extra.txt"), "old-extra", "utf8");

      try {
        const dryRun = await runtime.restoreWorkspaceFiles({
          workspaceId: restoreTarget.workspaceId,
          dryRun: true,
          snapshot: {
            basePath: "",
            deleteExtraneous: true,
            files: [
              {
                path: "keep.txt",
                contentBase64: Buffer.from("updated", "utf8").toString("base64"),
                contentSha256: sha256("updated")
              },
              {
                path: "new.txt",
                contentBase64: Buffer.from("new-file", "utf8").toString("base64"),
                contentSha256: sha256("new-file")
              },
              {
                path: "remove-explicit.txt",
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
            write: 1,
            delete: 2,
            applied: 0
          },
          appliedActions: []
        });

        const restored = await runtime.restoreWorkspaceFiles({
          workspaceId: restoreTarget.workspaceId,
          snapshot: {
            basePath: "",
            deleteExtraneous: true,
            files: [
              {
                path: "keep.txt",
                contentBase64: Buffer.from("updated", "utf8").toString("base64"),
                contentSha256: sha256("updated")
              },
              {
                path: "new.txt",
                contentBase64: Buffer.from("new-file", "utf8").toString("base64"),
                contentSha256: sha256("new-file")
              },
              {
                path: "remove-explicit.txt",
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
            write: 1,
            delete: 2,
            applied: 4
          }
        });

        const restoredListing = await runtime.listWorkspaceFiles({
          workspaceId: restoreTarget.workspaceId,
          recursive: true,
          includeHash: true
        });
        expect(restoredListing.paths.sort()).toEqual(["keep.txt", "new.txt"]);

        const keep = await runtime.downloadWorkspaceFile({
          workspaceId: restoreTarget.workspaceId,
          path: "keep.txt"
        });
        expect(keep.content).toBe("updated");
        await expect(runtime.downloadWorkspaceFile({
          workspaceId: restoreTarget.workspaceId,
          path: "extra.txt"
        })).resolves.toMatchObject({
          ok: false,
          status: 404
        });
      } finally {
        // Target workspace is cleaned up by the runtime wrapper.
      }
    });
  });
});
