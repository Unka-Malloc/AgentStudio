import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAgentWorkspace } from "../../../server/platform/specialized/agent/agent-workspace/index.mjs";

function sha256(value = "") {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function withWorkspaceRuntime(fn, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pact-agent-workspace-final-third-"));
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

describe("agent workspace final third extra coverage", () => {
  it("covers file guard variants, file mutation branches, and sync aliases", async () => {
    await withWorkspaceRuntime(async (runtime) => {
      const workspace = runtime.createWorkspace({ title: "File Branch Workspace" }).workspace;
      await fs.mkdir(path.join(workspace.fsPath, "docs", "nested"), { recursive: true });
      await fs.writeFile(path.join(workspace.fsPath, "docs", "readme.md"), "hello", "utf8");
      await fs.writeFile(path.join(workspace.fsPath, "docs", "nested", "deep.md"), "deep", "utf8");
      await fs.writeFile(path.join(workspace.fsPath, "loose.txt"), "alpha", "utf8");
      await fs.writeFile(path.join(workspace.fsPath, "source.txt"), "one", "utf8");
      await fs.writeFile(path.join(workspace.fsPath, "target.txt"), "two", "utf8");

      const fileListing = await runtime.listWorkspaceFiles({
        workspaceId: workspace.workspaceId,
        path: "loose.txt",
        includeFiles: false
      });
      expect(fileListing).toMatchObject({
        ok: true,
        exists: true,
        paths: [],
        files: []
      });

      const trimmedListing = await runtime.listWorkspaceFiles({
        workspaceId: workspace.workspaceId,
        folderPath: "docs",
        recursive: false,
        includeDirectories: false
      });
      expect(trimmedListing.paths).toEqual(["docs/readme.md"]);

      const metadataByAlias = await runtime.workspaceFileMetadata({
        workspaceId: workspace.workspaceId,
        file: "docs/readme.md",
        includeHash: false
      });
      expect(metadataByAlias).toMatchObject({
        ok: true,
        exists: true,
        file: {
          type: "file",
          relativePath: "docs/readme.md"
        }
      });

      const downloaded = await runtime.downloadWorkspaceFile({
        workspaceId: workspace.workspaceId,
        path: "docs/readme.md",
        includeText: false
      });
      expect(downloaded).toMatchObject({
        ok: true,
        workspaceId: workspace.workspaceId,
        contentBase64: Buffer.from("hello", "utf8").toString("base64")
      });
      expect(downloaded.content).toBeUndefined();

      const written = await runtime.writeWorkspaceFile({
        workspaceId: workspace.workspaceId,
        path: "source.txt",
        contentBase64: Buffer.from("uno", "utf8").toString("base64")
      });
      expect(written).toMatchObject({
        ok: true,
        overwritten: true
      });
      expect(await fs.readFile(path.join(workspace.fsPath, "source.txt"), "utf8")).toBe("uno");

      expect(await runtime.writeWorkspaceFile({
        workspaceId: workspace.workspaceId,
        path: "docs",
        content: "replace"
      })).toMatchObject({
        ok: false,
        status: 400,
        error: "目标路径是文件夹，不能写入。"
      });

      const noOpPatch = await runtime.patchWorkspaceFile({
        workspaceId: workspace.workspaceId,
        path: "source.txt",
        expectedSha256: sha256("uno"),
        hunks: [{ oldText: "uno", newText: "uno" }]
      });
      expect(noOpPatch).toMatchObject({
        ok: false,
        status: 409,
        error: "patch 未改变文件内容。"
      });

      const replaced = await runtime.patchWorkspaceFile({
        workspaceId: workspace.workspaceId,
        path: "docs/readme.md",
        expectedSha256: sha256("hello"),
        hunks: [{ oldText: "hello", newText: "HELLO", replaceAll: true }]
      });
      expect(replaced).toMatchObject({
        ok: true,
        patched: true
      });
      expect(await fs.readFile(path.join(workspace.fsPath, "docs", "readme.md"), "utf8")).toBe("HELLO");

      expect(await runtime.patchWorkspaceFile({
        workspaceId: workspace.workspaceId,
        path: "docs/readme.md",
        expectedSha256: sha256("HELLO"),
        patch: "@@ -1,1 +1,1 @@\n-HELLO\n+HELLO"
      })).toMatchObject({
        ok: false,
        status: 409,
        error: "patch 未改变文件内容。"
      });

      expect(await runtime.moveWorkspaceFile({
        workspaceId: workspace.workspaceId,
        sourcePath: "missing.txt",
        targetPath: "moved.txt"
      })).toMatchObject({
        ok: false,
        status: 404,
        error: "源文件不存在。"
      });

      const moved = await runtime.moveWorkspaceFile({
        workspaceId: workspace.workspaceId,
        sourcePath: "source.txt",
        targetPath: "renamed/source-renamed.txt",
        overwrite: true
      });
      expect(moved).toMatchObject({
        ok: true,
        moved: true,
        sourcePath: "source.txt",
        targetPath: "renamed/source-renamed.txt"
      });
      expect(await fs.readFile(path.join(workspace.fsPath, "renamed", "source-renamed.txt"), "utf8")).toBe("uno");
    });
  });

  it("covers session fork/proposal aliases, lock release, and parent removal", async () => {
    await withWorkspaceRuntime(async (runtime) => {
      const workspace = runtime.createWorkspace({ title: "Session Branch Workspace" }).workspace;
      const child = runtime.createWorkspace({ title: "Child Branch Workspace" }).workspace;

      const session = runtime.createSession({
        workspaceId: workspace.workspaceId,
        title: "Branch Session",
        objective: "branch coverage"
      }).session;
      const event = runtime.appendSessionEvent({
        sessionId: session.sessionId,
        type: "note",
        title: "First note",
        summary: "first",
        payload: { targetId: "shared-target" }
      }).event;

      const forked = runtime.forkSession({
        sourceSessionId: session.sessionId,
        targetSessionId: "custom-fork-session",
        title: "Fork via alias"
      });
      expect(forked).toMatchObject({
        ok: true,
        fork: {
          parentSessionId: session.sessionId,
          forkedFromEventId: event.eventId
        }
      });
      expect(forked.session.sessionId).toBe("custom-fork-session");

      const proposal = runtime.createSessionMergeProposal({
        sessionId: session.sessionId,
        mergeFromSessionId: forked.session.sessionId,
        resolutionHints: { manual: true }
      });
      expect(proposal).toMatchObject({
        ok: true,
        proposal: {
          targetSessionId: session.sessionId,
          sourceSessionId: forked.session.sessionId,
          requiresDecision: true
        }
      });

      const lock = runtime.acquireLock({
        workspaceId: workspace.workspaceId,
        targetType: "artifact",
        targetId: "artifact-1",
        ownerAgentId: "agent-a"
      });
      expect(lock.ok).toBe(true);
      expect(runtime.releaseLock({
        workspaceId: workspace.workspaceId,
        lockId: lock.lock.lockId
      })).toMatchObject({
        ok: true,
        released: true
      });
      expect(runtime.releaseLock({
        workspaceId: workspace.workspaceId,
        lockId: lock.lock.lockId
      })).toMatchObject({
        ok: true,
        released: false
      });

      expect(runtime.setWorkspaceParent(child.workspaceId, null)).toMatchObject({
        ok: true
      });
      expect(runtime.getWorkspaceContext(child.workspaceId)).toMatchObject({
        workspaceId: child.workspaceId,
        chainGenerations: expect.arrayContaining([
          expect.objectContaining({ workspaceId: child.workspaceId })
        ])
      });
    });
  });

  it("covers artifact/status updates and context bundle restore fallback paths", async () => {
    await withWorkspaceRuntime(async (runtime) => {
      const source = runtime.createWorkspace({ title: "Bundle Source Branch" }).workspace;
      const target = runtime.createWorkspace({ title: "Bundle Target Branch" }).workspace;
      const run = runtime.createRun({
        workspaceId: source.workspaceId,
        runType: "manual",
        status: "queued"
      }).run;

      const artifact = runtime.createArtifact({
        workspaceId: source.workspaceId,
        runId: run.runId,
        level: "Artifact",
        title: "artifact-branch",
        content: "content",
        status: "draft"
      }).artifact;
      const updatedArtifacts = runtime.updateArtifactsStatus(run.runId, "accepted");
      expect(updatedArtifacts[0].status).toBe("accepted");
      expect(artifact.status).toBe("draft");

      const issue = runtime.createIssue({
        workspaceId: source.workspaceId,
        runId: run.runId,
        issueId: "issue-branch",
        title: "Issue Branch",
        severity: "high",
        evidenceRefs: [{ refId: "e-1" }],
        payload: { check: true }
      }).issue;
      expect(issue.issueId).toBe("issue-branch");
      expect(runtime.updateIssue({
        issueId: issue.issueId,
        workspaceId: source.workspaceId,
        action: "resolve",
        reviewerId: "reviewer-a",
        note: "fixed"
      }).issue.status).toBe("resolved");
      expect(runtime.updateIssue({
        issueId: issue.issueId,
        workspaceId: source.workspaceId,
        action: "reject",
        reason: "bad"
      }).issue.status).toBe("rejected");
      expect(runtime.updateIssue({
        issueId: issue.issueId,
        workspaceId: source.workspaceId,
        action: "reopen"
      }).issue.status).toBe("open");

      const decision = runtime.createDecision({
        workspaceId: source.workspaceId,
        runId: run.runId,
        decisionId: "decision-branch",
        status: "approved",
        title: "Decision Branch",
        payload: { choice: "alpha" }
      }).decision;
      expect(decision).toMatchObject({
        decisionId: "decision-branch",
        status: "approved"
      });

      const bundleExport = runtime.exportWorkspaceContextBundle(source.workspaceId, {
        includeBundle: false,
        includePrivate: false,
        compress: false,
        maxItems: 1
      });
      expect(bundleExport).toMatchObject({
        bundleVersion: expect.any(String),
        compressed: null
      });
      expect(bundleExport.bundle).toBeUndefined();

      const sourceBundle = runtime.exportWorkspaceContextBundle(source.workspaceId, {
        includePrivate: false,
        compress: false,
        maxItems: 3
      });
      const mutatedBundle = {
        ...sourceBundle.bundle,
        handoffMarkdown: "",
        context: {
          ...sourceBundle.bundle.context,
          knowledgeSourceIds: []
        },
        resolvedProfile: {
          ...sourceBundle.bundle.resolvedProfile,
          knowledgeScope: {
            ...(sourceBundle.bundle.resolvedProfile?.knowledgeScope || {}),
            includeSourceIds: ["fallback-source"]
          }
        }
      };
      const restored = runtime.restoreWorkspaceContextBundle(target.workspaceId, {
        contextBundle: mutatedBundle
      }, {
        actorUserId: "bundle-restorer"
      });
      expect(restored).toMatchObject({
        ok: true,
        bundleVersion: bundleExport.bundleVersion,
        applied: {
          knowledgeSourceCount: 1
        }
      });
      expect(restored.restoredContext.knowledgeSourceIds).toContain("fallback-source");

      const previewRestore = await runtime.restoreWorkspaceFiles({
        workspaceId: source.workspaceId,
        preview: true,
        snapshot: {
          basePath: "",
          deleteExtraneous: true,
          files: [
            {
              path: "preview.txt",
              content: "preview",
              contentSha256: sha256("preview")
            }
          ]
        }
      });
      expect(previewRestore).toMatchObject({
        ok: true,
        dryRun: true,
        appliedActions: []
      });
    });
  });
});
