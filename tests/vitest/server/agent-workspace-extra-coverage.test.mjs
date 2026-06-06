import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  AGENT_WORKSPACE_CONTEXT_BUNDLE_VERSION,
  AGENT_WORKSPACE_PROTOCOL_VERSION,
  createAgentWorkspace
} from "../../../server/platform/specialized/agent/agent-workspace/index.mjs";

function sha256(value = "") {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function withWorkspaceRuntime(testCase, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pact-agent-workspace-extra-"));
  const runtime = createAgentWorkspace({
    userDataPath: root,
    ...options
  });
  try {
    await testCase(runtime, root);
  } finally {
    runtime.close();
    await fs.rm(root, { force: true, recursive: true });
  }
}

describe("agent workspace creation and list filtering", () => {
  it("normalizes workspace creation inputs and supports status-filtered listing", async () => {
    await withWorkspaceRuntime(async (runtime) => {
      const defaultWorkspace = runtime.createWorkspace({}).workspace;
      const explicitWorkspace = runtime.createWorkspace({
        title: "  旗舰 团队 ",
        ownerUserId: "owner-alpha",
        defaultAdminUserId: "admin-primary",
        metadata: {
          adminUserIds: ["ops-admin"],
          administrators: ["role-admin"]
        }
      }).workspace;

      expect(defaultWorkspace).toMatchObject({
        title: "Knowledge Agent Workspace",
        status: "active",
        ownerUserId: "",
        metadata: {
          defaultAdminUserId: "",
          adminUserIds: []
        }
      });

      expect(explicitWorkspace.title).toBe("旗舰 团队");
      expect(explicitWorkspace.metadata.adminUserIds).toEqual(
        expect.arrayContaining(["ops-admin", "role-admin", "admin-primary"])
      );
      expect(explicitWorkspace.metadata.defaultAdminUserId).toBe("admin-primary");

      const archivedWorkspace = runtime.createWorkspace({ title: "Archived", status: "archived" });
      const listArchived = runtime.listWorkspaces({ status: "archived", includeSummary: false });

      expect(listArchived.protocolVersion).toBe(AGENT_WORKSPACE_PROTOCOL_VERSION);
      expect(listArchived.workspaces).toHaveLength(1);
      expect(listArchived.count).toBe(1);
      expect(listArchived.workspaces[0].workspaceId).toBe(archivedWorkspace.workspace.workspaceId);
      expect(listArchived.workspaces[0].summary).toBeUndefined();
    });
  });
});

describe("agent workspace file boundaries and parsing", () => {
  it("normalizes paths, enforces directory/file boundaries, and reports patch/move conflicts", async () => {
    await withWorkspaceRuntime(async (runtime) => {
      const workspace = runtime.createWorkspace({ title: "File Boundary Workspace" }).workspace;
      await fs.mkdir(path.join(workspace.fsPath, "public"), { recursive: true });
      await fs.mkdir(path.join(workspace.fsPath, "public", "nested"), { recursive: true });
      await fs.writeFile(path.join(workspace.fsPath, "public", "index.txt"), "home", "utf8");
      await fs.writeFile(path.join(workspace.fsPath, "public", "nested", "deep.txt"), "leaf", "utf8");
      await fs.writeFile(path.join(workspace.fsPath, "note.txt"), "v1", "utf8");
      await fs.writeFile(path.join(workspace.fsPath, "a.txt"), "A", "utf8");
      await fs.writeFile(path.join(workspace.fsPath, "b.txt"), "B", "utf8");

      const topLevelOnly = await runtime.listWorkspaceFiles({
        workspaceId: workspace.workspaceId,
        folderPath: "public",
        recursive: false
      });
      expect(topLevelOnly.ok).toBe(true);
      expect(topLevelOnly.paths.sort()).toEqual(["public/index.txt", "public/nested"].sort());

      const recursiveList = await runtime.listWorkspaceFiles({
        workspaceId: workspace.workspaceId,
        folderPath: "public"
      });
      expect(recursiveList.paths).toContain("public/nested/deep.txt");
      expect(recursiveList.files).toHaveLength(3);

      const directoryMeta = await runtime.workspaceFileMetadata({
        workspaceId: workspace.workspaceId,
        path: "public",
        includeHash: false
      });
      expect(directoryMeta).toMatchObject({
        ok: true,
        exists: true,
        file: {
          type: "directory",
          relativePath: "public"
        }
      });

      expect(await runtime.downloadWorkspaceFile({
        workspaceId: workspace.workspaceId,
        path: "public"
      })).toMatchObject({
        ok: false,
        status: 400,
        error: "目标路径不是文件。"
      });

      expect(await runtime.workspaceFileMetadata({
        workspaceId: workspace.workspaceId,
        path: "../outside"
      })).toMatchObject({
        ok: false,
        status: 400,
        error: "路径不能跳出工作空间。"
      });

      expect(await runtime.patchWorkspaceFile({
        workspaceId: workspace.workspaceId,
        path: "note.txt",
        expectedSha256: sha256("v1")
      })).toMatchObject({
        ok: false,
        status: 400,
        error: "patch 或 hunks 至少提供一个。"
      });

      expect(await runtime.moveWorkspaceFile({
        workspaceId: workspace.workspaceId,
        sourcePath: "a.txt",
        targetPath: "b.txt"
      })).toMatchObject({
        ok: false,
        status: 409,
        error: "目标路径已存在。设置 overwrite: true 以覆盖。"
      });
    });
  });
});

describe("agent workspace permissions and lock error branches", () => {
  it("returns consistent permission errors for missing workspace and lock/workspace setup", async () => {
    await withWorkspaceRuntime(async (runtime) => {
      expect(runtime.acquireLock({
        workspaceId: "missing-workspace",
        targetType: "artifact",
        targetId: "target",
        ownerAgentId: "agent-a"
      })).toMatchObject({
        protocolVersion: AGENT_WORKSPACE_PROTOCOL_VERSION,
        ok: false,
        error: "workspace_forbidden"
      });

      expect(runtime.releaseLock({
        workspaceId: "missing-workspace",
        targetType: "artifact",
        targetId: "target",
        ownerAgentId: "agent-a"
      })).toMatchObject({
        ok: true,
        released: false
      });

      expect(runtime.adminReleaseLock({
        workspaceId: "missing-workspace",
        targetType: "artifact",
        targetId: "target"
      })).toMatchObject({
        ok: true,
        released: false
      });

      expect(runtime.listLocks({ workspaceId: "missing-workspace" })).toEqual([]);

      const source = runtime.createWorkspace({ title: "Source" }).workspace;
      const target = runtime.createWorkspace({ title: "Target" }).workspace;
      const child = runtime.createWorkspace({ title: "Child" }).workspace;

      expect(runtime.setWorkspaceParent("missing-child", source.workspaceId)).toMatchObject({
        ok: false,
        error: "子工作空间不存在"
      });

      expect(runtime.setWorkspaceParent(child.workspaceId, "missing-parent")).toMatchObject({
        ok: false,
        error: "父工作空间不存在"
      });

      expect(runtime.shareWorkspace(source.workspaceId, source.workspaceId)).toMatchObject({
        ok: false,
        error: "不能共享给自身"
      });

      expect(runtime.unshareWorkspace(source.workspaceId, target.workspaceId)).toMatchObject({
        ok: true,
        wasShared: false
      });
    });
  });
});

describe("agent workspace context derivation", () => {
  it("derives inheritance + sharing sources and resolves chain profiles deterministically", async () => {
    await withWorkspaceRuntime(async (runtime) => {
      const root = runtime.createWorkspace({ title: "Root" }).workspace;
      const child = runtime.createWorkspace({ title: "Child" }).workspace;
      const shared = runtime.createWorkspace({ title: "Shared" }).workspace;

      runtime.setWorkspaceParent(child.workspaceId, root.workspaceId);
      runtime.setOwnedSourceIds(root.workspaceId, ["root-owned"]);
      runtime.setOwnedSourceIds(child.workspaceId, ["child-owned"]);
      runtime.setOwnedSourceIds(shared.workspaceId, ["shared-owned"]);
      runtime.hotSwapProfile(root.workspaceId, {
        contextProfileId: "base-profile",
        toolGrantId: "grant-root",
        knowledgeScope: {
          includeSourceIds: ["root-scope"],
          excludeSourceIds: ["forbidden-root"]
        }
      });
      runtime.hotSwapProfile(child.workspaceId, {
        modelAlias: "child-model",
        knowledgeScope: {
          includeSourceIds: ["child-scope", "root-scope"],
          excludeSourceIds: ["forbidden-child"]
        }
      });
      runtime.shareWorkspace(shared.workspaceId, child.workspaceId);

      const chain = runtime.resolveWorkspaceChain(child.workspaceId);
      expect(chain.map((item) => item.workspaceId)).toEqual([root.workspaceId, child.workspaceId]);

      const profile = runtime.resolveWorkspaceProfile(child.workspaceId);
      expect(profile.contextProfileId).toBe("base-profile");
      expect(profile.toolGrantId).toBe("grant-root");
      expect(profile.modelAlias).toBe("child-model");
      expect(profile.knowledgeScope).toMatchObject({
        includeSourceIds: ["root-scope", "child-scope", "root-scope"],
        excludeSourceIds: ["forbidden-root", "forbidden-child"]
      });

      const context = runtime.getWorkspaceContext(child.workspaceId);
      expect(context.chainGenerations).toMatchObject([
        { workspaceId: root.workspaceId },
        { workspaceId: child.workspaceId }
      ]);
      expect(context.chainGenerations[0].generation).toBeGreaterThan(0);
      expect(context.chainGenerations[1].generation).toBeGreaterThan(0);
      expect(context.knowledgeSourceIds.sort()).toEqual(expect.arrayContaining(["root-owned", "child-owned", "shared-owned"]));

      const fingerprint = context.contextFingerprint;
      runtime.hotSwapProfile(root.workspaceId, { contextProfileId: "updated-root" });
      const refreshed = runtime.getWorkspaceContext(child.workspaceId);
      expect(refreshed.contextFingerprint).not.toBe(fingerprint);

      const sharedA = runtime.createWorkspace({ title: "SharedA" }).workspace;
      const sharedB = runtime.createWorkspace({ title: "SharedB" }).workspace;
      runtime.setOwnedSourceIds(sharedA.workspaceId, ["shared-a"]);
      runtime.setOwnedSourceIds(sharedB.workspaceId, ["shared-b"]);
      expect(runtime.shareWorkspace(sharedA.workspaceId, sharedB.workspaceId).ok).toBe(true);
      expect(runtime.shareWorkspace(sharedB.workspaceId, sharedA.workspaceId).ok).toBe(true);

      const cycleSources = runtime.resolveWorkspaceSourceIds(sharedA.workspaceId);
      expect(cycleSources.sort()).toEqual(expect.arrayContaining(["shared-a", "shared-b"]));
    });
  });
});

describe("agent workspace context bundle roundtrip", () => {
  it("validates bundle hash and restores context into another workspace", async () => {
    await withWorkspaceRuntime(async (runtime) => {
      const source = runtime.createWorkspace({ title: "Bundle Source" }).workspace;
      const target = runtime.createWorkspace({ title: "Bundle Target" }).workspace;

      runtime.hotSwapProfile(source.workspaceId, {
        contextProfileId: "bundle-profile",
        knowledgeScope: {
          includeSourceIds: ["bundle-source-id"]
        }
      });
      const exported = runtime.exportWorkspaceContextBundle(source.workspaceId, {
        actorUserId: "bundle-builder",
        includePrivate: false,
        compress: true
      });

      expect(exported).toMatchObject({
        protocolVersion: AGENT_WORKSPACE_PROTOCOL_VERSION,
        bundleVersion: AGENT_WORKSPACE_CONTEXT_BUNDLE_VERSION,
        workspaceId: source.workspaceId,
        compression: {
          algorithm: "gzip"
        }
      });

      expect(exported.bundle).toBeDefined();
      expect(exported.compressed?.encoding).toBe("gzip+base64");

      expect(runtime.restoreWorkspaceContextBundle(target.workspaceId, {
        ...exported,
        bundleHash: "not-a-valid-hash"
      }, {
        actorUserId: "bundle-restorer"
      })).toMatchObject({
        ok: false,
        error: "工作空间上下文压缩包 hash 校验失败。"
      });

      const restored = runtime.restoreWorkspaceContextBundle(target.workspaceId, exported, {
        actorUserId: "bundle-restorer"
      });
      expect(restored).toMatchObject({
        protocolVersion: AGENT_WORKSPACE_PROTOCOL_VERSION,
        ok: true,
        bundleVersion: AGENT_WORKSPACE_CONTEXT_BUNDLE_VERSION,
        workspace: {
          workspaceId: target.workspaceId
        },
        restoredContext: {
          contextProfileId: "bundle-profile"
        },
        bundleHash: expect.any(String)
      });
    });
  });
});

describe("agent workspace merkle-path operations", () => {
  it("invokes provided merkle services for file upload and keeps cache receipts", async () => {
    const merkleState = {
      protocolVersion: "pact.merkle.test.v1",
      cas: {
        putBlock: vi.fn(async (_payload, _metadata) => ({
          cid: "cas-block",
          byteLength: 12,
          payloadHash: "sha256:payload"
        }))
      },
      merkleDag: {
        buildManifest: vi.fn(async () => ({ rootCid: "manifest-root" }))
      },
      merkleIndex: {
        get: vi.fn(async () => null),
        prove: vi.fn(async () => ({ proofHash: "proof" }))
      },
      stateCommit: {
        begin: vi.fn(async () => ({ currentRoot: "" })),
        commit: vi.fn(async () => ({
          commitId: "state-commit",
          eventHash: "event-hash",
          beforeRoot: "",
          afterRoot: "new-root",
          contentRefs: ["manifest-root"],
          indexRoots: {}
        }))
      },
      lsmIngest: {
        beginUploadSession: vi.fn(async () => ({ uploadSessionId: "upload-1" })),
        appendChunkRecord: vi.fn(async () => ({ offset: 0, byteLength: 12 })),
        flushMemTable: vi.fn(async () => ({ segmentId: "segment-1", rootCid: "segment-root", recordCount: 1 })),
        materializeManifest: vi.fn(async () => ({ rootCid: "ingest-root" }))
      }
    };
    const checkpointTreeApi = {
      checkpointTreeId: vi.fn(() => "tree-1"),
      loadCheckpointTree: vi.fn(async () => null),
      startCheckpointTree: vi.fn(async () => {}),
      upsertCheckpointNode: vi.fn(async () => {})
    };

    await withWorkspaceRuntime(async (runtime) => {
      const workspace = runtime.createWorkspace({ title: "Merkle Workspace" }).workspace;
      const uploaded = await runtime.uploadWorkspaceFile({
        workspaceId: workspace.workspaceId,
        fileName: "artifact.txt",
        content: "merkle-content",
        level: "Artifact"
      });

      expect(uploaded).toMatchObject({
        ok: true,
        overwritten: false,
        stateCommit: { commitId: "state-commit", eventHash: "event-hash" },
        checkpoint: {
          treeId: "tree-1",
          nodeId: expect.stringContaining("state-commit")
        }
      });

      expect(merkleState.cas.putBlock).toHaveBeenCalledTimes(3);
      expect(merkleState.stateCommit.commit).toHaveBeenCalledTimes(1);
      expect(checkpointTreeApi.loadCheckpointTree).toHaveBeenCalledTimes(1);
      expect(checkpointTreeApi.startCheckpointTree).toHaveBeenCalledTimes(1);
      expect(checkpointTreeApi.upsertCheckpointNode).toHaveBeenCalledTimes(1);

      const listing = await runtime.listWorkspaceFiles({
        workspaceId: workspace.workspaceId,
        includeHash: true
      });
      expect(listing.cacheReceipt).toMatchObject({
        cacheFamily: "merkle-radix-compatible",
        hit: false,
        indexRootCid: ""
      });
      expect(merkleState.stateCommit.begin).toHaveBeenCalled();
    }, { merkleState, checkpointTreeApi });
  });
});
