import crypto from "node:crypto";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AGENT_WORKSPACE_CONTEXT_BUNDLE_VERSION,
  AGENT_SESSION_THREAD_VERSION,
  createAgentWorkspace
} from "../../../server/platform/specialized/agent/agent-workspace/index.mjs";

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
    protocolVersion: "pact.test.merkle.v1",
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
  const root = await tempDir("pact-agent-workspace-final-second-extra-");
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

describe("agent workspace final second extra coverage", () => {
  it("covers local directory mount validation, listing, and sync edge paths", async () => {
    await withRuntime(async (runtime, root) => {
      const workspace = runtime.createWorkspace({ title: "Sync Workspace" }).workspace;

      const sourceRoot = await tempDir("pact-agent-sync-source-");
      const badSource = await tempDir("pact-agent-sync-bad-");
      const hiddenSource = await tempDir("pact-agent-sync-hidden-");
      const symlinkSource = await tempDir("pact-agent-sync-symlink-");
      const symlinkMountSource = await tempDir("pact-agent-sync-symlink-mount-");
      const activeMountSource = await tempDir("pact-agent-sync-active-");
      const disabledMountSource = await tempDir("pact-agent-sync-disabled-");

      try {
        await fsPromises.writeFile(path.join(sourceRoot, "alpha.txt"), "alpha", "utf8");
        await fsPromises.writeFile(path.join(sourceRoot, "beta.txt"), "beta", "utf8");
        await fsPromises.mkdir(path.join(sourceRoot, "nested"), { recursive: true });
        await fsPromises.writeFile(path.join(sourceRoot, "nested", "inside.txt"), "inside", "utf8");

        await fsPromises.writeFile(path.join(badSource, "file.txt"), "file", "utf8");
        await fsPromises.writeFile(path.join(hiddenSource, ".secret"), "hidden", "utf8");
        await fsPromises.writeFile(path.join(hiddenSource, "visible.txt"), "visible", "utf8");
        await fsPromises.writeFile(path.join(symlinkSource, "target.txt"), "target", "utf8");
        await fsPromises.symlink(path.join(symlinkSource, "target.txt"), path.join(symlinkSource, "link.txt"));
        await fsPromises.writeFile(path.join(symlinkMountSource, "target.txt"), "target", "utf8");

        await fsPromises.writeFile(path.join(activeMountSource, "mount.txt"), "mount", "utf8");
        await fsPromises.writeFile(path.join(disabledMountSource, "mount.txt"), "mount", "utf8");

        expect(runtime.connectLocalDirectory({
          workspaceId: workspace.workspaceId,
          sourcePath: path.parse(root).root,
          targetPath: "imports"
        })).toMatchObject({
          ok: false,
          status: 400,
          error: "不能把文件系统根目录作为受控本机目录。"
        });

        expect(runtime.connectLocalDirectory({
          workspaceId: workspace.workspaceId,
          sourcePath: path.join(badSource, "file.txt"),
          targetPath: "imports"
        })).toMatchObject({
          ok: false,
          status: 400,
          error: "sourcePath 必须是本机目录。"
        });

        expect(runtime.connectLocalDirectory({
          workspaceId: workspace.workspaceId,
          sourcePath: activeMountSource,
          targetPath: "../escape"
        })).toMatchObject({
          ok: false,
          status: 400,
          error: "路径不能跳出工作空间。"
        });

        const activeMount = runtime.connectLocalDirectory({
          workspaceId: workspace.workspaceId,
          sourcePath: activeMountSource,
          targetPath: "imports"
        });
        expect(activeMount).toMatchObject({
          ok: true,
          mount: {
            status: "active",
            targetPath: "imports"
          }
        });

        const disabledMount = runtime.connectLocalDirectory({
          workspaceId: workspace.workspaceId,
          sourcePath: disabledMountSource,
          targetPath: "disabled",
          enabled: false
        });
        expect(disabledMount.mount.status).toBe("disabled");

        const mounts = runtime.listLocalDirectoryMounts({ workspaceId: workspace.workspaceId });
        expect(mounts.count).toBe(2);

        expect(runtime.listLocalDirectoryItems({
          workspaceId: workspace.workspaceId,
          mountRef: disabledMount.mount.mountRef,
          path: ""
        })).toMatchObject({
          ok: false,
          status: 400,
          error: "本机目录 mount 未启用。"
        });

        await fsPromises.writeFile(path.join(activeMountSource, ".hidden"), "hidden", "utf8");
        expect(runtime.listLocalDirectoryItems({
          workspaceId: workspace.workspaceId,
          mountRef: activeMount.mount.mountRef,
          path: ""
        })).toMatchObject({
          ok: false,
          status: 400,
          error: "不允许列出以 . 开头的路径：.hidden"
        });

        const symlinkActive = runtime.connectLocalDirectory({
          workspaceId: workspace.workspaceId,
          sourcePath: symlinkMountSource,
          targetPath: "symlinked"
        });
        expect(symlinkActive).toMatchObject({ ok: true });
        await fsPromises.symlink(path.join(symlinkMountSource, "target.txt"), path.join(symlinkMountSource, "link.txt"));
        expect(runtime.listLocalDirectoryItems({
          workspaceId: workspace.workspaceId,
          mountRef: symlinkActive.mount.mountRef,
          path: ""
        })).toMatchObject({
          ok: false,
          status: 400,
          error: "不允许列出符号链接：link.txt"
        });

        expect(runtime.localDirectorySyncPlan({
          workspaceId: workspace.workspaceId,
          sourcePath: path.join(root, "missing-source"),
          targetPath: "sync"
        })).toMatchObject({
          ok: false,
          status: 400,
          error: "本机目录不存在。"
        });

        expect(runtime.localDirectorySyncPlan({
          workspaceId: workspace.workspaceId,
          sourcePath: sourceRoot,
          targetPath: "../escape"
        })).toMatchObject({
          ok: false,
          status: 400,
          error: "路径不能跳出工作空间。"
        });

        expect(runtime.localDirectorySyncPlan({
          workspaceId: workspace.workspaceId,
          sourcePath: hiddenSource,
          targetPath: "sync-hidden"
        })).toMatchObject({
          ok: false,
          status: 400,
          error: "不允许同步以 . 开头的路径：.secret"
        });

        expect(runtime.localDirectorySyncPlan({
          workspaceId: workspace.workspaceId,
          sourcePath: symlinkSource,
          targetPath: "sync-symlink"
        })).toMatchObject({
          ok: false,
          status: 400,
          error: "不允许同步符号链接：link.txt"
        });

        await fsPromises.writeFile(path.join(sourceRoot, "alpha.txt"), "alpha", "utf8");
        await fsPromises.writeFile(path.join(sourceRoot, "beta.txt"), "beta-updated", "utf8");
        await fsPromises.mkdir(path.join(sourceRoot, "extra"), { recursive: true });
        await fsPromises.writeFile(path.join(sourceRoot, "extra", "child.txt"), "child", "utf8");
        await fsPromises.writeFile(path.join(workspace.fsPath, "beta.txt"), "beta-old", "utf8");
        await fsPromises.writeFile(path.join(workspace.fsPath, "obsolete.txt"), "obsolete", "utf8");

        const planned = runtime.localDirectorySyncPlan({
          workspaceId: workspace.workspaceId,
          sourcePath: sourceRoot,
          targetPath: "",
          deleteExtraneous: true,
          maxFiles: 10
        });
        expect(planned.ok).toBe(true);
        expect(planned.summary).toMatchObject({
          create: expect.any(Number),
          write: expect.any(Number),
          delete: expect.any(Number)
        });

        const applied = await runtime.applyLocalDirectorySync({
          workspaceId: workspace.workspaceId,
          sourcePath: sourceRoot,
          targetPath: "",
          deleteExtraneous: true,
          maxFiles: 10
        });
        expect(applied.ok).toBe(true);
        expect(await fsPromises.readFile(path.join(workspace.fsPath, "beta.txt"), "utf8")).toBe("beta-updated");
        expect(await fsPromises.access(path.join(workspace.fsPath, "obsolete.txt")).then(() => true).catch(() => false)).toBe(false);

        expect(runtime.localDirectorySyncPlan({
          workspaceId: workspace.workspaceId,
          sourcePath: sourceRoot,
          targetPath: "",
          maxFiles: 1
        })).toMatchObject({
          ok: false,
          status: 400,
          error: "同步文件数量超过限制：1"
        });

        await fsPromises.writeFile(path.join(workspace.fsPath, "limit-a.txt"), "a", "utf8");
        await fsPromises.writeFile(path.join(workspace.fsPath, "limit-b.txt"), "b", "utf8");
        expect(runtime.localDirectorySyncPlan({
          workspaceId: workspace.workspaceId,
          sourcePath: disabledMountSource,
          targetPath: "",
          maxFiles: 1
        })).toMatchObject({
          ok: false,
          status: 400,
          error: "工作空间同步文件数量超过限制：1"
        });
      } finally {
        await fsPromises.rm(sourceRoot, { recursive: true, force: true });
        await fsPromises.rm(badSource, { recursive: true, force: true });
        await fsPromises.rm(hiddenSource, { recursive: true, force: true });
        await fsPromises.rm(symlinkSource, { recursive: true, force: true });
        await fsPromises.rm(symlinkMountSource, { recursive: true, force: true });
        await fsPromises.rm(activeMountSource, { recursive: true, force: true });
        await fsPromises.rm(disabledMountSource, { recursive: true, force: true });
      }
    });
  });

  it("covers merkle-backed upload, snapshot, and cache receipt branches", async () => {
    const merkleState = createMerkleState();
    const checkpointTreeApi = createCheckpointTreeApi();

    await withRuntime(async (runtime) => {
      const workspace = runtime.createWorkspace({ title: "Merkle Workspace" }).workspace;

      await fsPromises.writeFile(path.join(workspace.fsPath, "existing-hit.txt"), "existing", "utf8");
      await fsPromises.writeFile(path.join(workspace.fsPath, "stale.txt"), "stale", "utf8");

      const fileMetaMissing = await runtime.workspaceFileMetadata({
        workspaceId: workspace.workspaceId,
        path: "missing-hit.txt"
      });
      expect(fileMetaMissing).toMatchObject({
        ok: true,
        exists: false,
        file: {
          relativePath: "missing-hit.txt"
        }
      });
      expect(fileMetaMissing.cacheReceipt).toMatchObject({
        hit: false,
        indexRootCid: ""
      });

      const fileMetaHit = await runtime.workspaceFileMetadata({
        workspaceId: workspace.workspaceId,
        path: "existing-hit.txt"
      });
      expect(fileMetaHit).toMatchObject({
        ok: true,
        exists: true,
        file: {
          relativePath: "existing-hit.txt"
        }
      });
      expect(fileMetaHit.cacheReceipt).toMatchObject({
        hit: true,
        valueRoot: "value-state-root-existing-hit.txt"
      });

      merkleState.stateCommit.begin.mockImplementationOnce(async () => ({ currentRoot: "" }));
      const fileListingMissing = await runtime.listWorkspaceFiles({
        workspaceId: workspace.workspaceId,
        folderPath: "missing-folder"
      });
      expect(fileListingMissing).toMatchObject({
        ok: true,
        exists: false,
        cacheReceipt: {
          hit: false,
          indexRootCid: ""
        }
      });

      const fileListingHit = await runtime.listWorkspaceFiles({
        workspaceId: workspace.workspaceId,
        folderPath: "",
        recursive: true,
        includeHash: true
      });
      expect(fileListingHit.ok).toBe(true);
      expect(fileListingHit.cacheReceipt).toMatchObject({
        hit: true,
        valueRoots: expect.arrayContaining(["state-root-alpha", "state-root-beta"])
      });

      const folder = await runtime.createWorkspaceFolder({
        workspaceId: workspace.workspaceId,
        folderPath: "docs"
      });
      expect(folder.ok).toBe(true);

      const uploaded = await runtime.uploadWorkspaceFile({
        workspaceId: workspace.workspaceId,
        fileName: "upload.txt",
        content: "hello",
        runId: "run-upload",
        createdBy: "agent-a"
      });
      expect(uploaded).toMatchObject({
        ok: true,
        file: {
          relativePath: "files/upload.txt"
        }
      });
      expect(uploaded.ingestReceipt).toMatchObject({
        uploadSessionId: "upload-session-1",
        segmentId: "segment-1",
        manifestRootCid: "manifest-root"
      });

      const restoreSnapshot = await runtime.restoreWorkspaceFiles({
        workspaceId: workspace.workspaceId,
        snapshot: {
          basePath: "",
          deleteExtraneous: true,
          files: [
            {
              path: "restored.txt",
              content: "restored",
              contentSha256: sha256("restored")
            },
            {
              path: "stale.txt",
              exists: false
            }
          ]
        }
      });
      expect(restoreSnapshot.ok).toBe(true);
      expect(await fsPromises.readFile(path.join(workspace.fsPath, "restored.txt"), "utf8")).toBe("restored");
      expect(await fsPromises.access(path.join(workspace.fsPath, "stale.txt")).then(() => true).catch(() => false)).toBe(false);

      expect(await runtime.restoreWorkspaceFiles({
        workspaceId: workspace.workspaceId,
        snapshot: {
          files: [{ path: "docs/.secret", content: "x" }]
        }
      })).toMatchObject({
        ok: false,
        status: 400,
        error: "不允许恢复以 . 开头的文件。"
      });

      expect(await runtime.restoreWorkspaceFiles({
        workspaceId: workspace.workspaceId,
        snapshot: {
          files: [{ path: "docs/hash.txt", content: "expected", contentSha256: sha256("other") }]
        }
      })).toMatchObject({
        ok: false,
        status: 400,
        error: "文件快照 hash 不匹配：docs/hash.txt"
      });

      expect(await runtime.restoreWorkspaceFiles({
        workspaceId: workspace.workspaceId,
        snapshot: {
          files: [{ path: "docs/cid.txt", contentCid: "missing-cid" }]
        }
      })).toMatchObject({
        ok: false,
        status: 400,
        error: "文件快照内容块不存在：missing-cid"
      });

      const bundle = runtime.exportWorkspaceContextBundle(workspace.workspaceId, {
        includePrivate: true,
        compress: false,
        maxItems: 5
      });
      expect(bundle).toMatchObject({
        bundleVersion: AGENT_WORKSPACE_CONTEXT_BUNDLE_VERSION,
        compression: {
          algorithm: "none"
        }
      });
      expect(bundle.bundle.handoffMarkdown).toContain("# Workspace Context Bundle");

      expect(runtime.restoreWorkspaceContextBundle(workspace.workspaceId, {})).toMatchObject({
        ok: false,
        error: "缺少工作空间上下文压缩包。"
      });

      expect(runtime.restoreWorkspaceContextBundle(workspace.workspaceId, {
        contextBundle: {
          encoding: "plain",
          payload: "abc"
        }
      })).toMatchObject({
        ok: false,
        error: "工作空间上下文压缩包编码不受支持。"
      });

      expect(runtime.restoreWorkspaceContextBundle(workspace.workspaceId, {
        contextBundle: bundle.bundle,
        bundleHash: "wrong-hash"
      })).toMatchObject({
        ok: false,
        error: "工作空间上下文压缩包 hash 校验失败。"
      });

      const restored = runtime.restoreWorkspaceContextBundle(workspace.workspaceId, {
        contextBundle: bundle.bundle,
        bundleHash: bundle.bundleHash
      });
      expect(restored.ok).toBe(true);
      expect(restored.restoredContext.sessionProtocolVersion).toBeUndefined();
      expect(restored.applied.knowledgeSourceCount).toBeGreaterThanOrEqual(0);

      expect(merkleState.cas.putBlock).toHaveBeenCalled();
      expect(merkleState.merkleDag.buildManifest).toHaveBeenCalled();
      expect(merkleState.stateCommit.commit).toHaveBeenCalled();
      expect(checkpointTreeApi.upsertCheckpointNode).toHaveBeenCalled();
    }, { merkleState, checkpointTreeApi });
  });

  it("covers session comparison, submission, run, issue, and delete paths", async () => {
    await withRuntime(async (runtime, root) => {
      const workspace = runtime.createWorkspace({ title: "Lifecycle Workspace" }).workspace;
      const other = runtime.createWorkspace({ title: "Other Workspace" }).workspace;

      runtime.setOwnedSourceIds(workspace.workspaceId, ["owned-a"]);
      runtime.hotSwapProfile(workspace.workspaceId, {
        contextProfileId: "profile-a",
        toolGrantId: "grant-a",
        modelAlias: "model-a",
        knowledgeScope: {
          includeSourceIds: ["include-a"],
          excludeSourceIds: ["exclude-a"]
        }
      });
      runtime.savePrivateState({
        workspaceId: workspace.workspaceId,
        runId: "run-private",
        agentId: "agent-private",
        summary: "private summary",
        state: { nested: true }
      });

      const run = runtime.createRun({
        workspaceId: workspace.workspaceId,
        runType: "manual",
        status: "queued",
        input: { hello: "world" },
        steps: [{ id: "step-1", status: "queued" }],
        coverage: { lines: 1 }
      }).run;
      expect(runtime.updateRun("missing-run", { status: "completed" })).toBeNull();
      const updatedRun = runtime.updateRun(run.runId, {
        status: "completed",
        degraded: true,
        error: "done"
      });
      expect(updatedRun.run).toMatchObject({
        status: "completed",
        degraded: true,
        error: "done"
      });

      const artifactOne = runtime.createArtifact({
        workspaceId: workspace.workspaceId,
        runId: run.runId,
        level: "Artifact",
        title: "artifact-one",
        content: "content-1",
        artifactId: "artifact-shared"
      });
      const artifactTwo = runtime.createArtifact({
        workspaceId: workspace.workspaceId,
        runId: run.runId,
        level: "Artifact",
        title: "artifact-one",
        content: "content-2",
        artifactId: "artifact-shared"
      });
      expect(artifactTwo.artifact.revision).toBeGreaterThan(artifactOne.artifact.revision);

      const issue = runtime.createIssue({
        workspaceId: workspace.workspaceId,
        runId: run.runId,
        title: "issue-1",
        severity: "high",
        payload: { tag: "original" }
      }).issue;
      expect(runtime.updateIssue({
        issueId: "missing-issue",
        workspaceId: workspace.workspaceId,
        status: "resolve"
      })).toBeNull();
      expect(runtime.updateIssue({
        issueId: issue.issueId,
        workspaceId: other.workspaceId,
        status: "resolve"
      })).toBeNull();
      expect(runtime.updateIssue({
        issueId: issue.issueId,
        workspaceId: workspace.workspaceId,
        action: "resolve",
        note: "fixed"
      }).issue.status).toBe("resolved");
      expect(runtime.updateIssue({
        issueId: issue.issueId,
        workspaceId: workspace.workspaceId,
        action: "reject",
        reason: "bad"
      }).issue.status).toBe("rejected");
      expect(runtime.updateIssue({
        issueId: issue.issueId,
        workspaceId: workspace.workspaceId,
        action: "reopen"
      }).issue.status).toBe("open");

      const decision = runtime.createDecision({
        workspaceId: workspace.workspaceId,
        runId: run.runId,
        title: "decision-1",
        payload: { choice: "alpha" }
      }).decision;
      expect(decision.payload.choice).toBe("alpha");

      const claim = runtime.submit({
        workspaceId: workspace.workspaceId,
        runId: run.runId,
        agentId: "agent-a",
        type: "claim",
        payload: { claim: "need evidence" }
      }).submission;
      expect(claim.status).toBe("needs_review");
      expect(claim.gate.reasons).toEqual(expect.arrayContaining(["missing_evidence", "low_confidence"]));

      const evidenceRef = runtime.submit({
        workspaceId: workspace.workspaceId,
        runId: run.runId,
        agentId: "agent-a",
        type: "evidenceRef",
        payload: { evidenceId: "e-1" }
      }).submission;
      expect(evidenceRef.status).toBe("accepted");

      const reviewOnly = runtime.submit({
        workspaceId: workspace.workspaceId,
        runId: run.runId,
        agentId: "agent-a",
        type: "canonicalChange",
        payload: { title: "change" }
      }).submission;
      expect(reviewOnly.status).toBe("needs_review");
      expect(reviewOnly.gate.reasons).toContain("canonical_change_requires_review");

      const acceptedTaskState = runtime.submit({
        workspaceId: workspace.workspaceId,
        runId: run.runId,
        agentId: "agent-a",
        type: "taskState",
        payload: { status: "done" }
      }).submission;
      expect(acceptedTaskState.status).toBe("accepted");

      const resolved = runtime.resolveSubmission({
        submissionId: claim.submissionId,
        workspaceId: workspace.workspaceId,
        status: "accepted",
        reviewerId: "reviewer-1",
        note: "ok"
      }).submission;
      expect(resolved.status).toBe("accepted");
      expect(resolved.gate.resolutionNote).toBe("ok");
      expect(runtime.resolveSubmission({
        submissionId: evidenceRef.submissionId,
        workspaceId: workspace.workspaceId,
        action: "deny",
        agentId: "reviewer-2"
      }).submission.status).toBe("rejected");
      expect(runtime.resolveSubmission({
        submissionId: acceptedTaskState.submissionId,
        workspaceId: workspace.workspaceId,
        resolution: "maybe",
        agentId: "reviewer-3"
      }).submission.status).toBe("needs_review");

      const rootSession = runtime.createSession({
        workspaceId: workspace.workspaceId,
        title: "Root Session",
        objective: "compare sessions"
      }).session;
      const childSession = runtime.createSession({
        workspaceId: workspace.workspaceId,
        title: "Child Session",
        objective: "compare sessions"
      }).session;
      runtime.appendSessionEvent({
        sessionId: rootSession.sessionId,
        type: "update",
        title: "Target One",
        summary: "left",
        payload: { targetId: "shared-target", left: true }
      });
      runtime.appendSessionEvent({
        sessionId: childSession.sessionId,
        type: "update",
        title: "Target One",
        summary: "right",
        payload: { targetId: "shared-target", left: false }
      });
      const comparison = runtime.compareSessions({
        leftSessionId: rootSession.sessionId,
        rightSessionId: childSession.sessionId
      });
      expect(comparison.ok).toBe(true);
      expect(comparison.conflicts.length).toBeGreaterThan(0);
      expect(comparison.divergence).not.toBeNull();
      const mergeProposal = runtime.createSessionMergeProposal({
        targetSessionId: rootSession.sessionId,
        sourceSessionId: childSession.sessionId,
        resolutionHints: { manual: true }
      });
      expect(mergeProposal.ok).toBe(true);
      expect(mergeProposal.proposal.requiresDecision).toBe(true);

      expect(runtime.getRun(run.runId)).toMatchObject({
        runId: run.runId,
        status: "completed"
      });
      const projected = runtime.getWorkspace({
        workspaceId: workspace.workspaceId,
        includePrivate: true,
        includeRunDetails: false
      });
      expect(projected.privateStates).toHaveLength(1);
      expect(projected.runs[0].steps).toEqual([]);
      expect(projected.submissions.length).toBeGreaterThanOrEqual(3);
      expect(projected.artifacts.length).toBeGreaterThanOrEqual(1);
      expect(projected.issues.length).toBeGreaterThanOrEqual(1);
      expect(projected.decisions.length).toBeGreaterThanOrEqual(1);

      const bundle = runtime.exportWorkspaceContextBundle(workspace.workspaceId, {
        includePrivate: true,
        compress: true,
        maxItems: 5
      });
      expect(bundle.compression.algorithm).toBe("gzip");
      expect(bundle.bundle.recent.privateStates).toHaveLength(1);
      expect(bundle.bundle.handoffMarkdown).toContain(workspace.workspaceId);

      expect(runtime.shareWorkspace(workspace.workspaceId, other.workspaceId)).toMatchObject({
        ok: true
      });
      expect(runtime.shareWorkspace(workspace.workspaceId, other.workspaceId)).toMatchObject({
        ok: true,
        alreadyShared: true
      });
      expect(runtime.unshareWorkspace(workspace.workspaceId, other.workspaceId)).toMatchObject({
        ok: true,
        wasShared: true
      });
      expect(runtime.unshareWorkspace(workspace.workspaceId, other.workspaceId)).toMatchObject({
        ok: true,
        wasShared: false
      });

      const deleted = runtime.deleteWorkspace(workspace.workspaceId, { deleteFolder: true });
      expect(deleted).toMatchObject({ ok: true, deleted: true });
      expect(await fsPromises.access(path.join(root, "agent-workspaces", "folders", workspace.workspaceId)).then(() => true).catch(() => false)).toBe(false);
      expect(runtime.deleteWorkspace("missing-workspace")).toMatchObject({
        ok: false,
        error: "工作空间不存在或无权限"
      });

      const readonlyWorkspace = runtime.createWorkspace({ title: "Readonly Workspace" }).workspace;
      const rmSpy = vi.spyOn(fs, "rmSync").mockImplementationOnce(() => {
        throw new Error("rm failed");
      });
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      expect(runtime.deleteWorkspace(readonlyWorkspace.workspaceId, { deleteFolder: true })).toMatchObject({
        ok: true,
        deleted: true
      });
      expect(rmSpy).toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalled();
    });
  });

  it("covers remaining session, upload, move, inheritance, and restore errors", async () => {
    await withRuntime(async (runtime) => {
      const root = runtime.createWorkspace({ title: "Edge Root" }).workspace;
      const child = runtime.createWorkspace({ title: "Edge Child" }).workspace;

      expect(runtime.appendSessionEvent({
        sessionId: "missing-session",
        type: "note"
      })).toBeNull();
      expect(runtime.getSession("missing-session")).toBeNull();

      const session = runtime.createSession({
        workspaceId: root.workspaceId,
        title: "Edge Session",
        objective: "edges",
        initialEvent: false
      }).session;
      expect(runtime.listSessions({
        workspaceId: root.workspaceId,
        status: "active",
        includeLastEvent: false
      }).sessions.length).toBeGreaterThan(0);
      expect(runtime.forkSession({
        sessionId: "missing-session"
      })).toMatchObject({
        ok: false,
        error: "会话不存在"
      });
      expect(runtime.getSession({
        sessionId: session.sessionId,
        includeEvents: false
      }).events).toEqual([]);

      expect(await runtime.uploadWorkspaceFile({
        workspaceId: root.workspaceId,
        content: "missing file name"
      })).toMatchObject({
        ok: false,
        status: 400,
        error: "fileName 不能为空。"
      });
      expect(await runtime.uploadWorkspaceFile({
        workspaceId: root.workspaceId,
        fileName: ".hidden",
        content: "secret"
      })).toMatchObject({
        ok: false,
        status: 400,
        error: "不允许上传以 . 开头的文件。"
      });
      expect(await runtime.writeWorkspaceFile({
        workspaceId: root.workspaceId,
        path: "plain.txt"
      })).toMatchObject({
        ok: false,
        status: 400,
        error: "content 或 contentBase64 至少提供一个。"
      });

      const uploaded = await runtime.uploadWorkspaceFile({
        workspaceId: root.workspaceId,
        fileName: "plain.txt",
        content: "one"
      });
      expect(uploaded.ok).toBe(true);
      expect(await runtime.uploadWorkspaceFile({
        workspaceId: root.workspaceId,
        fileName: "plain.txt",
        content: "two",
        overwrite: false
      })).toMatchObject({
        ok: false,
        status: 409,
        error: "文件已存在。"
      });
      expect(await runtime.uploadWorkspaceFile({
        workspaceId: root.workspaceId,
        path: "files/plain.txt",
        content: "three",
        overwrite: true
      })).toMatchObject({
        ok: true,
        overwritten: true
      });
      await fsPromises.mkdir(path.join(root.fsPath, "folder"), { recursive: true });
      expect(await runtime.uploadWorkspaceFile({
        workspaceId: root.workspaceId,
        path: "folder",
        content: "bad"
      })).toMatchObject({
        ok: false,
        status: 409,
        error: "目标路径是文件夹，不能上传为文件。"
      });

      expect(await runtime.moveWorkspaceFile({
        workspaceId: root.workspaceId,
        targetPath: "moved.txt"
      })).toMatchObject({
        ok: false,
        status: 400,
        error: "sourcePath (from) 不能为空。"
      });
      expect(await runtime.moveWorkspaceFile({
        workspaceId: root.workspaceId,
        sourcePath: "plain.txt"
      })).toMatchObject({
        ok: false,
        status: 400,
        error: "targetPath (to) 不能为空。"
      });

      await expect(runtime.restoreWorkspaceFiles({
        workspaceId: root.workspaceId,
        snapshot: {
          files: [{ path: "reference.txt", contentCid: "missing-cid" }]
        }
      })).resolves.toMatchObject({
        ok: false,
        status: 400,
        error: "文件快照引用 CAS contentCid，但 Merkle State 基座不可用。"
      });

      expect(runtime.setWorkspaceParent("missing-child", root.workspaceId)).toMatchObject({
        ok: false,
        error: "子工作空间不存在"
      });
      expect(runtime.setWorkspaceParent(child.workspaceId, "missing-parent")).toMatchObject({
        ok: false,
        error: "父工作空间不存在"
      });
      expect(runtime.hotSwapProfile("missing-workspace", { modelAlias: "x" })).toMatchObject({
        ok: false,
        error: "工作空间不存在"
      });
      expect(runtime.setOwnedSourceIds("missing-workspace", ["a"])).toMatchObject({
        ok: false,
        error: "工作空间不存在"
      });
      expect(runtime.shareWorkspace("missing-source", child.workspaceId)).toMatchObject({
        ok: false,
        error: "来源工作空间不存在"
      });
      expect(runtime.shareWorkspace(root.workspaceId, "missing-target")).toMatchObject({
        ok: false,
        error: "目标工作空间不存在"
      });
      expect(runtime.shareWorkspace(root.workspaceId, root.workspaceId)).toMatchObject({
        ok: false,
        error: "不能共享给自身"
      });
      expect(runtime.unshareWorkspace(root.workspaceId, child.workspaceId)).toMatchObject({
        ok: true,
        wasShared: false
      });
    });
  });
});
