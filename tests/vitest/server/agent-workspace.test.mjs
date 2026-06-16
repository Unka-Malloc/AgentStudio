import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createAgentWorkspace } from "../../../server/platform/specialized/agent/agent-workspace/index.mjs";

function sha256(value = "") {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function withTempUserData(testCase) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pact-agent-workspace-"));
  const runtime = createAgentWorkspace({ userDataPath: root });
  try {
    await testCase(runtime, root);
  } finally {
    runtime.close();
    await fs.rm(root, { force: true, recursive: true });
  }
}

describe("agent workspace path normalization and validation", () => {
  it("binds owned workspaces to the caller unless admin access is explicit", async () => {
    await withTempUserData(async (runtime) => {
      const alpha = runtime.createWorkspace({
        title: "Alpha Workspace",
        ownerUserId: "user-alpha"
      }).workspace;
      const beta = runtime.createWorkspace({
        title: "Beta Workspace",
        ownerUserId: "user-beta"
      }).workspace;
      const legacy = runtime.createWorkspace({ title: "Legacy Workspace" }).workspace;

      const alphaList = runtime.listWorkspaces({
        actorUserId: "user-alpha"
      });
      expect(alphaList.sharingMode).toBe("owner-bound");
      expect(alphaList.workspaces.map((workspace) => workspace.workspaceId)).toEqual(
        expect.arrayContaining([alpha.workspaceId, legacy.workspaceId])
      );
      expect(alphaList.workspaces.map((workspace) => workspace.workspaceId)).not.toContain(beta.workspaceId);

      expect(runtime.getWorkspace({
        workspaceId: beta.workspaceId,
        actorUserId: "user-alpha"
      })).toBeNull();
      expect(runtime.getWorkspace({
        workspaceId: beta.workspaceId,
        actorUserId: "user-alpha",
        accessibleWorkspaceIds: [beta.workspaceId]
      })).toBeNull();
      expect(runtime.getWorkspace({
        workspaceId: beta.workspaceId,
        actorUserId: "user-alpha",
        allowedWorkspaceIds: [beta.workspaceId]
      })?.workspace?.workspaceId).toBe(beta.workspaceId);

      const deniedFiles = await runtime.listWorkspaceFiles({
        workspaceId: beta.workspaceId,
        actorUserId: "user-alpha"
      });
      expect(deniedFiles).toMatchObject({
        ok: false,
        status: 403,
        error: "工作空间不可访问。"
      });

      const adminList = runtime.listWorkspaces({
        actorUserId: "admin",
        canAccessAll: true
      });
      expect(adminList.sharingMode).toBe("admin");
      expect(adminList.workspaces.map((workspace) => workspace.workspaceId)).toEqual(
        expect.arrayContaining([alpha.workspaceId, beta.workspaceId, legacy.workspaceId])
      );
    });
  });

  it("normalizes relative paths and rejects absolute/escaping paths", async () => {
    await withTempUserData(async (runtime) => {
      const workspace = runtime.createWorkspace({ title: "Path Workspace" }).workspace;

      const absolute = await runtime.listWorkspaceFiles({
        workspaceId: workspace.workspaceId,
        path: "/tmp/outside"
      });
      expect(absolute).toMatchObject({
        ok: false,
        status: 400,
        error: "路径必须是工作空间相对路径。"
      });

      const escape = await runtime.createWorkspaceFolder({
        workspaceId: workspace.workspaceId,
        folderPath: "../escape",
      });
      expect(escape).toMatchObject({
        ok: false,
        status: 400,
        error: "路径不能跳出工作空间。"
      });

      const dotPath = await runtime.createWorkspaceFolder({
        workspaceId: workspace.workspaceId,
        folderPath: "."
      });
      expect(dotPath).toMatchObject({
        ok: false,
        status: 400,
        error: "路径不能为空。"
      });

      const created = await runtime.createWorkspaceFolder({
        workspaceId: workspace.workspaceId,
        folderPath: "logs\\app"
      });
      expect(created).toMatchObject({
        ok: true,
        folder: {
          type: "directory"
        }
      });
      expect(created.folder.relativePath).toBe("logs/app");
      expect(await fs.access(path.join(workspace.fsPath, created.folder.relativePath)).catch(() => null)).toBeUndefined();
    });
  });

  it("rejects access for missing workspace and returns normalized non-existent-path projection", async () => {
    await withTempUserData(async (runtime) => {
      const missing = await runtime.listWorkspaceFiles({
        workspaceId: "no-such-workspace"
      });
      expect(missing).toEqual({
        ok: false,
        status: 404,
        error: "工作空间不存在或不可访问。"
      });

      const workspace = runtime.createWorkspace({ title: "Listing Workspace" }).workspace;
      await fs.mkdir(path.join(workspace.fsPath, "docs"), { recursive: true });
      await fs.writeFile(path.join(workspace.fsPath, "readme.md"), "hello", "utf8");
      await fs.writeFile(path.join(workspace.fsPath, ".secret"), "private", "utf8");
      await fs.writeFile(path.join(workspace.fsPath, "docs", "nested.md"), "nested", "utf8");

      const listing = await runtime.listWorkspaceFiles({
        workspaceId: workspace.workspaceId,
        folderPath: "",
        includeHash: true,
        recursive: true,
      });
      expect(listing.ok).toBe(true);
      expect(listing.exists).toBe(true);
      expect(listing.accessReceipt).toMatchObject({
        protocolVersion: "v0.0.1:sharedspace:sharedspace-access-receipt-1",
        action: "workspace.list",
        workspaceId: workspace.workspaceId,
        path: "/"
      });
      expect(listing.paths).toEqual(expect.arrayContaining(["readme.md", "docs", "docs/nested.md"]));
      expect(listing.paths).not.toContain(".secret");

      const notFound = await runtime.listWorkspaceFiles({
        workspaceId: workspace.workspaceId,
        folderPath: "docs/does-not-exist"
      });
      expect(notFound).toMatchObject({
        ok: true,
        exists: false,
        paths: [],
        files: []
      });
    });
  });
});

describe("agent workspace file mutation validation", () => {
  it("validates workspace file mutations by input and source content", async () => {
    await withTempUserData(async (runtime) => {
      const workspace = runtime.createWorkspace({ title: "File Ops Workspace" }).workspace;
      const target = path.join(workspace.fsPath, "note.txt");
      await fs.writeFile(target, "v1", "utf8");

      expect(await runtime.writeWorkspaceFile({
        workspaceId: workspace.workspaceId,
        path: "",
        content: "new"
      })).toMatchObject({
        ok: false,
        status: 400,
        error: "path 不能为空。"
      });

      expect(await runtime.writeWorkspaceFile({
        workspaceId: workspace.workspaceId,
        path: ".note.txt",
        content: "new"
      })).toMatchObject({
        ok: false,
        status: 400,
        error: "不允许操作以 . 开头的文件。"
      });

      const missing = await runtime.writeWorkspaceFile({
        workspaceId: workspace.workspaceId,
        path: "nope.txt",
        contentBase64: Buffer.from("x").toString("base64")
      });
      expect(missing).toMatchObject({
        ok: false,
        status: 404,
        error: "文件不存在。"
      });

      const mismatch = await runtime.patchWorkspaceFile({
        workspaceId: workspace.workspaceId,
        path: "note.txt",
        expectedSha256: "000000000000000000000000000000000000000000000000000000000000000000",
        hunks: [{ oldText: "v1", newText: "v2" }],
      });
      expect(mismatch).toMatchObject({
        ok: false,
        status: 409,
        error: "文件内容与 expectedSha256 不匹配。"
      });

      const current = await fs.readFile(target, "utf8");
      const beforeSha256 = sha256(current);
      const patched = await runtime.patchWorkspaceFile({
        workspaceId: workspace.workspaceId,
        path: "note.txt",
        expectedSha256: beforeSha256,
        hunks: [{ oldText: "v1", newText: "v2" }]
      });
      expect(patched).toMatchObject({
        ok: true,
        patched: true,
        beforeSha256,
        afterSha256: expect.any(String)
      });
      expect(await fs.readFile(target, "utf8")).toBe("v2");
    });
  });
});

describe("agent workspace submission gates, receipts, and approval", () => {
  it("applies contribution gates and supports approval/rejection transitions", async () => {
    await withTempUserData(async (runtime) => {
      const workspace = runtime.createWorkspace({ title: "Contribution Workspace" }).workspace;

      const missingEvidence = await runtime.submit({
        workspaceId: workspace.workspaceId,
        type: "claim",
        payload: { claim: "need evidence" },
        runId: "run-1",
        agentId: "agent-a"
      });
      expect(missingEvidence.submission.status).toBe("needs_review");
      expect(missingEvidence.submission.gate.reasons).toEqual(expect.arrayContaining(["missing_evidence", "low_confidence"]));

      const unsupported = await runtime.submit({
        workspaceId: workspace.workspaceId,
        type: "mystery",
        payload: { title: "bad" }
      });
      expect(unsupported.submission.status).toBe("rejected");
      expect(unsupported.submission.gate.reasons).toContain("unsupported_type");

      const roleBlocked = await runtime.submit({
        workspaceId: workspace.workspaceId,
        type: "artifact",
        payload: { title: "policy block" },
        writePolicy: { allowedTypes: ["issue"] }
      });
      expect(roleBlocked.submission.status).toBe("rejected");
      expect(roleBlocked.submission.gate.reasons).toContain("role_not_allowed");

      const acceptedArtifact = await runtime.submit({
        workspaceId: workspace.workspaceId,
        type: "artifact",
        payload: { title: "artifact first" }
      });
      expect(acceptedArtifact.submission.status).toBe("accepted");
      const duplicated = await runtime.submit({
        workspaceId: workspace.workspaceId,
        type: "artifact",
        payload: { title: "artifact first" }
      });
      expect(duplicated.submission.status).toBe("rejected");
      expect(duplicated.submission.gate.reasons).toContain("duplicate_submission");

      const resolvedByAccept = await runtime.resolveSubmission({
        submissionId: missingEvidence.submission.submissionId,
        workspaceId: workspace.workspaceId,
        status: "accept",
        reviewerId: "human-receiver",
        note: "已确认"
      });
      expect(resolvedByAccept.submission.status).toBe("accepted");
      expect(resolvedByAccept.submission.gate.reviewerId).toBeUndefined();
      expect(resolvedByAccept.submission.gate.resolutionNote).toBe("已确认");

      const rejected = await runtime.resolveSubmission({
        submissionId: roleBlocked.submission.submissionId,
        workspaceId: workspace.workspaceId,
        action: "deny",
        agentId: "ops-bot"
      });
      expect(rejected.submission.status).toBe("rejected");
      expect(rejected.submission.gate.resolutionNote).toBe("");

      expect(await runtime.resolveSubmission({
        submissionId: missingEvidence.submission.submissionId,
        workspaceId: workspace.workspaceId,
        status: "accept"
      })).toMatchObject({ submission: { status: "accepted" } });
    });
  });

  it("returns null when resolving cross-workspace or unknown submissions", async () => {
    await withTempUserData(async (runtime) => {
      const workspace = runtime.createWorkspace({ title: "Submit Isolation" }).workspace;
      const otherWorkspace = runtime.createWorkspace({ title: "Submit Other" }).workspace;

      const submission = await runtime.submit({
        workspaceId: workspace.workspaceId,
        type: "artifact",
        payload: { title: "cross-check" }
      });

      expect(await runtime.resolveSubmission({
        submissionId: "no-such-submission"
      })).toBeNull();

      expect(await runtime.resolveSubmission({
        submissionId: submission.submission.submissionId,
        workspaceId: otherWorkspace.workspaceId,
        status: "accept"
      })).toBeNull();
    });
  });
});

describe("agent workspace permissions and lock governance", () => {
  it("denies lock operations when workspace is not accessible", async () => {
    await withTempUserData(async (runtime) => {
      const forbidden = runtime.acquireLock({
        workspaceId: "unknown",
        targetType: "artifact",
        targetId: "t1",
        ownerAgentId: "owner-1"
      });
      expect(forbidden).toMatchObject({
        protocolVersion: "v0.0.1:workspace:agent-workspace-1",
        ok: false,
        error: "workspace_forbidden"
      });
    });
  });

  it("blocks duplicate lock holders and enforces lock owner on release", async () => {
    await withTempUserData(async (runtime) => {
      const workspace = runtime.createWorkspace({ title: "Lock Workspace" }).workspace;
      const missingFields = runtime.acquireLock({ workspaceId: workspace.workspaceId });
      expect(missingFields).toMatchObject({
        protocolVersion: "v0.0.1:workspace:agent-workspace-1",
        ok: false,
        error: "missing_lock_fields"
      });

      const first = runtime.acquireLock({
        workspaceId: workspace.workspaceId,
        targetType: "artifact",
        targetId: "artifact-1",
        ownerAgentId: "agent-a"
      });
      expect(first.ok).toBe(true);

      const second = runtime.acquireLock({
        workspaceId: workspace.workspaceId,
        targetType: "artifact",
        targetId: "artifact-1",
        ownerAgentId: "agent-b"
      });
      expect(second).toMatchObject({
        protocolVersion: "v0.0.1:workspace:agent-workspace-1",
        ok: false,
        error: "lock_held",
        lock: expect.objectContaining({ ownerAgentId: "agent-a" })
      });

      const releaseByWrongOwner = runtime.releaseLock({
        workspaceId: workspace.workspaceId,
        targetType: "artifact",
        targetId: "artifact-1",
        ownerAgentId: "agent-b"
      });
      expect(releaseByWrongOwner).toMatchObject({
        protocolVersion: "v0.0.1:workspace:agent-workspace-1",
        ok: false,
        error: "lock_owner_mismatch"
      });

      const adminRelease = runtime.adminReleaseLock({
        workspaceId: workspace.workspaceId,
        targetType: "artifact",
        targetId: "artifact-1"
      });
      expect(adminRelease).toMatchObject({
        protocolVersion: "v0.0.1:workspace:agent-workspace-1",
        ok: true,
        released: true
      });

      const releaseAfterAdmin = runtime.releaseLock({
        workspaceId: workspace.workspaceId,
        targetType: "artifact",
        targetId: "artifact-1",
        ownerAgentId: "agent-a"
      });
      expect(releaseAfterAdmin).toMatchObject({
        protocolVersion: "v0.0.1:workspace:agent-workspace-1",
        ok: true,
        released: false
      });
    });
  });
});

describe("agent workspace state projection and context inheritance", () => {
  it("projects state and resolves inherited/linked source IDs", async () => {
    await withTempUserData(async (runtime) => {
      const parent = runtime.createWorkspace({ title: "Parent Workspace" }).workspace;
      const child = runtime.createWorkspace({ title: "Child Workspace" }).workspace;
      const shared = runtime.createWorkspace({ title: "Shared Workspace" }).workspace;

      runtime.setOwnedSourceIds(parent.workspaceId, ["parent-owned", "common-parent"]);
      runtime.setOwnedSourceIds(child.workspaceId, ["child-owned"]);
      runtime.setOwnedSourceIds(shared.workspaceId, ["shared-owned"]);

      runtime.hotSwapProfile(parent.workspaceId, {
        contextProfileId: "parent-profile",
        knowledgeScope: {
          includeSourceIds: ["parent-scope", "common-parent"],
          excludeSourceIds: []
        }
      });
      runtime.setWorkspaceParent(child.workspaceId, parent.workspaceId);
      runtime.hotSwapProfile(child.workspaceId, {
        knowledgeScope: {
          includeSourceIds: ["child-scope"],
          excludeSourceIds: ["parent-owned", "parent-scope", "common-parent"]
        }
      });
      runtime.shareWorkspace(shared.workspaceId, child.workspaceId);

      const context = runtime.getWorkspaceContext(child.workspaceId);
      expect(context).toMatchObject({
        workspaceId: child.workspaceId,
        sharingMode: "team-shared",
        knowledgeSourceIds: expect.arrayContaining(["child-owned", "child-scope", "shared-owned"])
      });
      expect(context.chainGenerations.map((entry) => entry.workspaceId)).toEqual([
        parent.workspaceId,
        child.workspaceId
      ]);

      expect(context.knowledgeSourceIds).not.toContain("parent-scope");
      expect(context.knowledgeSourceIds).toContain("child-owned");
      expect(context.knowledgeSourceIds).toContain("shared-owned");

      expect(runtime.setWorkspaceParent(parent.workspaceId, child.workspaceId)).toMatchObject({
        ok: false,
        error: "设置会导致继承链循环"
      });
    });
  });

  it("projects workspace status and artifacts/runs when listing workspace", async () => {
    await withTempUserData(async (runtime) => {
      const workspace = runtime.createWorkspace({ title: "Projection Workspace" }).workspace;
      const run = runtime.createRun({
        workspaceId: workspace.workspaceId,
        runType: "manual",
        status: "completed",
      }).run;

      runtime.createArtifact({
        workspaceId: workspace.workspaceId,
        runId: run.runId,
        level: "Artifact",
        title: "artifact-one",
        content: "payload",
        status: "accepted",
      });
      runtime.submit({ workspaceId: workspace.workspaceId, type: "artifact", payload: { title: "accepted-submission" } });
      runtime.createIssue({
        workspaceId: workspace.workspaceId,
        runId: run.runId,
        type: "issue",
        status: "open",
        severity: "low",
        title: "issue-one"
      });
      runtime.createDecision({
        workspaceId: workspace.workspaceId,
        runId: run.runId,
        title: "decision-one"
      });

      const view = runtime.getWorkspace({ workspaceId: workspace.workspaceId });
      expect(view).toMatchObject({
        workspace: expect.objectContaining({ workspaceId: workspace.workspaceId }),
        runs: [{ runId: run.runId }],
        summary: {
          runCount: 1,
          submissionCount: 1,
          acceptedSubmissionCount: 1,
          artifactCount: 1,
          openIssueCount: 1,
          sessionCount: 1
        }
      });
      expect(view.artifacts).toHaveLength(1);
      expect(view.decisions).toHaveLength(1);
    });
  });
});

describe("agent workspace local directory sync", () => {
  it("validates host directory mounts and produces sync plan", async () => {
    await withTempUserData(async (runtime, root) => {
      const workspace = runtime.createWorkspace({ title: "Local Dir Workspace" }).workspace;
      const sourceRoot = path.join(root, "agent-workspaces", "local-sources", "valid-source");
      await fs.mkdir(sourceRoot, { recursive: true });
      await fs.writeFile(path.join(sourceRoot, "visible.txt"), "visible", "utf8");
      await fs.mkdir(path.join(sourceRoot, "sub"));
      await fs.writeFile(path.join(sourceRoot, "sub", "nested.txt"), "nested", "utf8");

      const connection = runtime.connectLocalDirectory({
        workspaceId: workspace.workspaceId,
        sourcePath: sourceRoot,
        targetPath: "incoming"
      });
      expect(connection).toMatchObject({
        ok: true,
        workspaceId: workspace.workspaceId,
        mount: expect.objectContaining({
          status: "active",
          targetPath: "incoming"
        })
      });

      const mounts = runtime.listLocalDirectoryMounts({ workspaceId: workspace.workspaceId });
      expect(mounts.mounts).toHaveLength(1);
      expect(mounts.mounts[0].mountRef).toBe(connection.mount.mountRef);

      const plan = runtime.localDirectorySyncPlan({
        workspaceId: workspace.workspaceId,
        mountRef: connection.mount.mountRef,
        targetPath: "incoming"
      });
      expect(plan.ok).toBe(true);
      expect(plan.summary.create).toBe(2);
      expect(plan.targetPath).toBe("incoming");
      expect(plan.actions).toEqual(expect.arrayContaining([
        expect.objectContaining({ action: "create", targetPath: "incoming/visible.txt" }),
        expect.objectContaining({ action: "create", targetPath: "incoming/sub/nested.txt" })
      ]));

      const listItems = runtime.listLocalDirectoryItems({
        workspaceId: workspace.workspaceId,
        mountRef: connection.mount.mountRef,
        path: ""
      });
      expect(listItems).toMatchObject({
        ok: true,
        workspaceId: workspace.workspaceId,
        mount: expect.objectContaining({ mountRef: connection.mount.mountRef }),
      });
      expect(listItems.items.map((item) => item.type)).toEqual(expect.arrayContaining(["file"]));

      const badMount = runtime.listLocalDirectoryItems({
        workspaceId: workspace.workspaceId,
        mountRef: "missing-mount",
        path: ""
      });
      expect(badMount).toMatchObject({
        ok: false,
        status: 400,
        error: "本机目录 mount 不存在或不属于当前工作空间。"
      });

      await fs.rm(sourceRoot, { force: true, recursive: true });
    });
  });

  it("rejects host directory sync plan when source contains hidden items", async () => {
    await withTempUserData(async (runtime, root) => {
      const workspace = runtime.createWorkspace({ title: "Local Dir Hidden Workspace" }).workspace;
      const sourceRoot = path.join(root, "agent-workspaces", "local-sources", "hidden-source");
      await fs.mkdir(sourceRoot, { recursive: true });
      await fs.writeFile(path.join(sourceRoot, ".hidden"), "skip", "utf8");

      const rejected = runtime.connectLocalDirectory({
        workspaceId: workspace.workspaceId,
        sourcePath: sourceRoot,
        targetPath: "incoming"
      });
      expect(rejected).toMatchObject({
        ok: false,
        status: 400,
        error: "不允许同步以 . 开头的路径：.hidden"
      });

      await fs.rm(sourceRoot, { force: true, recursive: true });
    });
  });
});
