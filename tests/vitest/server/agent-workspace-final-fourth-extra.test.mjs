import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
  AGENT_SESSION_THREAD_VERSION,
  AGENT_WORKSPACE_CONTEXT_BUNDLE_VERSION,
  createAgentWorkspace
} from "../../../server/platform/specialized/agent/agent-workspace/index.mjs";

async function tempDir(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRuntime(fn, options = {}) {
  const root = await tempDir("pact-agent-workspace-final-fourth-extra-");
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

describe("agent workspace final fourth extra coverage", () => {
  it("covers inheritance chains, shared-source recursion, and cycle detection", async () => {
    await withRuntime(async (runtime, root) => {
      const rootWorkspace = runtime.createWorkspace({ title: "Root Workspace" }).workspace;
      const midWorkspace = runtime.createWorkspace({ title: "Mid Workspace" }).workspace;
      const leafWorkspace = runtime.createWorkspace({ title: "Leaf Workspace" }).workspace;
      const sharedA = runtime.createWorkspace({ title: "Shared A" }).workspace;
      const sharedB = runtime.createWorkspace({ title: "Shared B" }).workspace;

      runtime.setOwnedSourceIds(rootWorkspace.workspaceId, ["root-source", "root-source", "root-extra"]);
      runtime.setOwnedSourceIds(midWorkspace.workspaceId, ["mid-source", "mid-extra"]);
      runtime.setOwnedSourceIds(leafWorkspace.workspaceId, ["leaf-source", "leaf-extra"]);
      runtime.setOwnedSourceIds(sharedA.workspaceId, ["shared-a-source"]);
      runtime.setOwnedSourceIds(sharedB.workspaceId, ["shared-b-source"]);

      runtime.hotSwapProfile(rootWorkspace.workspaceId, {
        contextProfileId: "root-context",
        toolGrantId: "root-grant",
        modelAlias: "root-model",
        knowledgeScope: {
          includeSourceIds: ["scope-root", "scope-root-extra"],
          excludeSourceIds: ["blocked-source"]
        }
      });
      runtime.hotSwapProfile(midWorkspace.workspaceId, {
        contextProfileId: "mid-context",
        toolGrantId: "mid-grant",
        modelAlias: "mid-model",
        knowledgeScope: {
          includeSourceIds: ["scope-mid", "shared-a-source"],
          excludeSourceIds: ["scope-root-extra"]
        }
      });
      runtime.hotSwapProfile(leafWorkspace.workspaceId, {
        contextProfileId: "leaf-context",
        toolGrantId: "leaf-grant",
        modelAlias: "leaf-model",
        knowledgeScope: {
          includeSourceIds: ["scope-leaf"],
          excludeSourceIds: ["mid-extra"]
        }
      });
      runtime.hotSwapProfile(sharedA.workspaceId, {
        knowledgeScope: {
          includeSourceIds: ["shared-a-extra"]
        }
      });
      runtime.hotSwapProfile(sharedB.workspaceId, {
        knowledgeScope: {
          includeSourceIds: ["shared-b-extra"]
        }
      });

      expect(runtime.setWorkspaceParent(midWorkspace.workspaceId, rootWorkspace.workspaceId)).toMatchObject({ ok: true });
      expect(runtime.setWorkspaceParent(leafWorkspace.workspaceId, midWorkspace.workspaceId)).toMatchObject({ ok: true });

      expect(runtime.shareWorkspace(sharedA.workspaceId, leafWorkspace.workspaceId)).toMatchObject({ ok: true });
      expect(runtime.shareWorkspace(sharedB.workspaceId, sharedA.workspaceId)).toMatchObject({ ok: true });
      expect(runtime.shareWorkspace(leafWorkspace.workspaceId, sharedB.workspaceId)).toMatchObject({ ok: true });
      expect(runtime.shareWorkspace(sharedA.workspaceId, leafWorkspace.workspaceId)).toMatchObject({
        ok: true,
        alreadyShared: true
      });

      const chain = runtime.resolveWorkspaceChain(leafWorkspace.workspaceId);
      expect(chain.map((workspace) => workspace.workspaceId)).toEqual([
        rootWorkspace.workspaceId,
        midWorkspace.workspaceId,
        leafWorkspace.workspaceId
      ]);

      const profile = runtime.resolveWorkspaceProfile(leafWorkspace.workspaceId);
      expect(profile).toEqual({
        contextProfileId: "leaf-context",
        toolGrantId: "leaf-grant",
        modelAlias: "leaf-model",
        knowledgeScope: {
          includeSourceIds: [
            "scope-root",
            "scope-root-extra",
            "scope-mid",
            "shared-a-source",
            "scope-leaf"
          ],
          excludeSourceIds: ["blocked-source", "scope-root-extra", "mid-extra"]
        }
      });

      const sources = runtime.resolveWorkspaceSourceIds(leafWorkspace.workspaceId);
      expect(sources).toEqual([
        "root-source",
        "root-extra",
        "scope-root",
        "mid-source",
        "scope-mid",
        "shared-a-source",
        "leaf-source",
        "leaf-extra",
        "scope-leaf",
        "shared-a-extra",
        "shared-b-source",
        "shared-b-extra"
      ]);
      expect(sources).not.toContain("blocked-source");
      expect(sources).toHaveLength(new Set(sources).size);

      const workspaceContext = runtime.getWorkspaceContext(leafWorkspace.workspaceId);
      expect(workspaceContext).toMatchObject({
        protocolVersion: "pact.agent-workspace.v1",
        workspaceId: leafWorkspace.workspaceId,
        currentGeneration: expect.any(Number),
        contextProfileId: "leaf-context",
        toolGrantId: "leaf-grant",
        modelAlias: "leaf-model"
      });
      expect(workspaceContext.chainGenerations.map((entry) => entry.workspaceId)).toEqual([
        rootWorkspace.workspaceId,
        midWorkspace.workspaceId,
        leafWorkspace.workspaceId
      ]);
      expect(workspaceContext.inheritanceChain.map((entry) => entry.workspaceId)).toEqual([
        rootWorkspace.workspaceId,
        midWorkspace.workspaceId,
        leafWorkspace.workspaceId
      ]);
      expect(workspaceContext.knowledgeSourceIds).toEqual(expect.arrayContaining(["shared-b-extra", "leaf-source"]));
      expect(workspaceContext.contextFingerprint).toMatch(/^[0-9a-f]{64}$/);

      const missingContext = runtime.getWorkspaceContext("missing-workspace");
      expect(missingContext).toBeNull();

      const sessionExplicit = runtime.createSession({
        workspaceId: leafWorkspace.workspaceId,
        title: "Explicit Session Context",
        objective: "override",
        context: {
          knowledgeSourceIds: ["session-source-a", "session-source-b"],
          contextProfileId: "session-context",
          toolGrantId: "session-grant",
          modelAlias: "session-model"
        },
        initialEvent: false
      }).session;
      const sessionFallback = runtime.createSession({
        workspaceId: leafWorkspace.workspaceId,
        title: "Fallback Session Context",
        objective: "fallback",
        initialEvent: false
      }).session;

      const explicitContext = runtime.getSessionContext(sessionExplicit.sessionId);
      expect(explicitContext).toMatchObject({
        sessionProtocolVersion: AGENT_SESSION_THREAD_VERSION,
        sessionId: sessionExplicit.sessionId,
        contextProfileId: "session-context",
        toolGrantId: "session-grant",
        modelAlias: "session-model"
      });
      expect(explicitContext.knowledgeSourceIds).toEqual(["session-source-a", "session-source-b"]);

      const fallbackContext = runtime.getSessionContext(sessionFallback.sessionId);
      expect(fallbackContext.contextProfileId).toBe("leaf-context");
      expect(fallbackContext.toolGrantId).toBe("leaf-grant");
      expect(fallbackContext.modelAlias).toBe("leaf-model");
      expect(fallbackContext.knowledgeSourceIds).toEqual(workspaceContext.knowledgeSourceIds);

      expect(runtime.shareWorkspace(sharedA.workspaceId, leafWorkspace.workspaceId)).toMatchObject({
        ok: true,
        alreadyShared: true
      });
      expect(runtime.unshareWorkspace(sharedA.workspaceId, leafWorkspace.workspaceId)).toMatchObject({
        ok: true,
        wasShared: true
      });
      expect(runtime.unshareWorkspace(sharedA.workspaceId, leafWorkspace.workspaceId)).toMatchObject({
        ok: true,
        wasShared: false
      });

      const sqlitePath = path.join(root, "agent-workspaces", "agent-workspace.sqlite");
      const db = new Database(sqlitePath);
      try {
        db.prepare("UPDATE aw_workspaces SET parent_workspace_id = ? WHERE workspace_id = ?")
          .run(leafWorkspace.workspaceId, rootWorkspace.workspaceId);
      } finally {
        db.close();
      }

      expect(() => runtime.resolveWorkspaceChain(rootWorkspace.workspaceId)).toThrow(
        /工作空间继承链存在循环/
      );
    });
  });

  it("covers bundle export boundaries and wrapped restore inputs", async () => {
    await withRuntime(async (runtime) => {
      const source = runtime.createWorkspace({ title: "Bundle Source" }).workspace;
      const target = runtime.createWorkspace({ title: "Bundle Target" }).workspace;
      const wrappedTarget = runtime.createWorkspace({ title: "Wrapped Target" }).workspace;

      runtime.setOwnedSourceIds(source.workspaceId, ["owned-a", "owned-b"]);
      runtime.hotSwapProfile(source.workspaceId, {
        contextProfileId: "bundle-context",
        toolGrantId: "bundle-grant",
        modelAlias: "bundle-model",
        knowledgeScope: {
          includeSourceIds: ["scope-1", "scope-2"],
          excludeSourceIds: ["scope-2"]
        }
      });

      const sessionExplicit = runtime.createSession({
        workspaceId: source.workspaceId,
        title: "Session Explicit",
        initialEvent: false,
        context: {
          knowledgeSourceIds: ["session-owned"],
          contextProfileId: "session-profile",
          toolGrantId: "session-grant",
          modelAlias: "session-model"
        }
      }).session;
      const sessionFallback = runtime.createSession({
        workspaceId: source.workspaceId,
        title: "Session Fallback",
        initialEvent: false
      }).session;
      expect(runtime.getSessionContext(sessionExplicit.sessionId).knowledgeSourceIds).toEqual(["session-owned"]);
      expect(runtime.getSessionContext(sessionFallback.sessionId).knowledgeSourceIds).toEqual([
        "owned-a",
        "owned-b",
        "scope-1"
      ]);

      runtime.createRun({
        workspaceId: source.workspaceId,
        runType: "analysis",
        status: "completed",
        input: { step: 1 }
      });
      runtime.createRun({
        workspaceId: source.workspaceId,
        runType: "analysis",
        status: "completed",
        input: { step: 2 }
      });
      runtime.submit({
        workspaceId: source.workspaceId,
        runId: "run-a",
        agentId: "agent-a",
        type: "taskState",
        payload: { status: "done" }
      });
      runtime.submit({
        workspaceId: source.workspaceId,
        runId: "run-b",
        agentId: "agent-a",
        type: "taskState",
        payload: { status: "done-again" }
      });
      runtime.createArtifact({
        workspaceId: source.workspaceId,
        runId: "run-a",
        level: "Artifact",
        title: "short artifact",
        content: "short"
      });
      await sleep(5);
      runtime.createArtifact({
        workspaceId: source.workspaceId,
        runId: "run-b",
        level: "Artifact",
        title: "long artifact",
        content: "this artifact body is long enough to force truncation in the compact bundle preview"
      });
      runtime.createIssue({
        workspaceId: source.workspaceId,
        runId: "run-a",
        title: "issue-a"
      });
      runtime.createIssue({
        workspaceId: source.workspaceId,
        runId: "run-b",
        title: "issue-b"
      });
      runtime.createDecision({
        workspaceId: source.workspaceId,
        runId: "run-a",
        title: "decision-a"
      });
      runtime.createDecision({
        workspaceId: source.workspaceId,
        runId: "run-b",
        title: "decision-b"
      });
      runtime.savePrivateState({
        workspaceId: source.workspaceId,
        runId: "run-a",
        agentId: "agent-a",
        summary: "private-one",
        state: { alpha: true }
      });
      runtime.savePrivateState({
        workspaceId: source.workspaceId,
        runId: "run-b",
        agentId: "agent-a",
        summary: "private-two",
        state: { beta: true }
      });

      const noBundle = runtime.exportWorkspaceContextBundle(source.workspaceId, {
        includePrivate: true,
        includeBundle: false,
        compress: false,
        maxItems: 1
      });
      expect(noBundle).toMatchObject({
        protocolVersion: "pact.agent-workspace.v1",
        bundleVersion: AGENT_WORKSPACE_CONTEXT_BUNDLE_VERSION,
        compression: {
          algorithm: "none"
        }
      });
      expect(noBundle.bundle).toBeUndefined();
      expect(noBundle.compressed).toBeNull();
      expect(noBundle.restoreEvidence).toMatchObject({
        runCount: 1,
        submissionCount: 1,
        artifactCount: 1,
        issueCount: 1,
        privateStateCount: 1
      });

      const exported = runtime.exportWorkspaceContextBundle(source.workspaceId, {
        includePrivate: true,
        includeBundle: true,
        compress: false,
        maxItems: 1,
        contentPreviewChars: 20
      });
      expect(exported.bundleVersion).toBe(AGENT_WORKSPACE_CONTEXT_BUNDLE_VERSION);
      expect(exported.bundle.recent.runs).toHaveLength(1);
      expect(exported.bundle.recent.submissions).toHaveLength(1);
      expect(exported.bundle.recent.artifacts).toHaveLength(1);
      expect(exported.bundle.recent.issues).toHaveLength(1);
      expect(exported.bundle.recent.decisions).toHaveLength(1);
      expect(exported.bundle.recent.privateStates).toHaveLength(1);
      expect(exported.bundle.recent.artifacts[0].contentPreview).toContain("...<truncated>");
      expect(exported.bundle.options).toMatchObject({
        includePrivate: true,
        maxItems: 1
      });

      const directRestore = runtime.restoreWorkspaceContextBundle(target.workspaceId, exported.bundle, {
        actorUserId: "restore-agent"
      });
      expect(directRestore).toMatchObject({
        ok: true,
        bundleVersion: AGENT_WORKSPACE_CONTEXT_BUNDLE_VERSION,
        applied: {
          contextProfileId: "bundle-context",
          toolGrantId: "bundle-grant",
          modelAlias: "bundle-model",
          knowledgeSourceCount: 3
        }
      });
      expect(directRestore.restoredContext.contextProfileId).toBe("bundle-context");
      expect(directRestore.restoredContext.toolGrantId).toBe("bundle-grant");
      expect(directRestore.restoredContext.modelAlias).toBe("bundle-model");

      const wrappedRestore = runtime.restoreWorkspaceContextBundle(wrappedTarget.workspaceId, {
        contextBundle: {
          bundle: exported.bundle
        }
      }, {
        actorUserId: "restore-agent"
      });
      expect(wrappedRestore.ok).toBe(true);
      expect(wrappedRestore.restoredContext.knowledgeSourceIds).toEqual(
        directRestore.restoredContext.knowledgeSourceIds
      );
      expect(wrappedRestore.source.workspaceId).toBe(source.workspaceId);
    });
  });

  it("covers directory delete, overwrite move, and folder conflict branches", async () => {
    await withRuntime(async (runtime) => {
      const workspace = runtime.createWorkspace({ title: "File Edge Workspace" }).workspace;

      await fs.writeFile(path.join(workspace.fsPath, "occupied"), "file", "utf8");
      await fs.mkdir(path.join(workspace.fsPath, "empty-dir"), { recursive: true });
      await fs.mkdir(path.join(workspace.fsPath, "full-dir", "nested"), { recursive: true });
      await fs.writeFile(path.join(workspace.fsPath, "full-dir", "nested", "child.txt"), "child", "utf8");
      await fs.writeFile(path.join(workspace.fsPath, "move-source.txt"), "source-content", "utf8");
      await fs.writeFile(path.join(workspace.fsPath, "move-target.txt"), "target-content", "utf8");

      expect(await runtime.createWorkspaceFolder({
        workspaceId: workspace.workspaceId,
        folderPath: "occupied"
      })).toMatchObject({
        ok: false,
        status: 409,
        error: "目标路径已存在且不是文件夹。"
      });

      expect(await runtime.deleteWorkspaceFile({
        workspaceId: workspace.workspaceId,
        path: "empty-dir"
      })).toMatchObject({
        ok: true,
        deleted: true
      });
      expect(await fs.access(path.join(workspace.fsPath, "empty-dir")).then(() => true).catch(() => false)).toBe(false);

      expect(await runtime.deleteWorkspaceFile({
        workspaceId: workspace.workspaceId,
        path: "full-dir",
        recursive: true
      })).toMatchObject({
        ok: true,
        deleted: true
      });
      expect(await fs.access(path.join(workspace.fsPath, "full-dir")).then(() => true).catch(() => false)).toBe(false);

      const moved = await runtime.moveWorkspaceFile({
        workspaceId: workspace.workspaceId,
        sourcePath: "move-source.txt",
        targetPath: "move-target.txt",
        overwrite: true
      });
      expect(moved).toMatchObject({
        ok: true,
        moved: true,
        sourcePath: "move-source.txt",
        targetPath: "move-target.txt"
      });
      expect(await fs.readFile(path.join(workspace.fsPath, "move-target.txt"), "utf8")).toBe("source-content");
      expect(await fs.access(path.join(workspace.fsPath, "move-source.txt")).then(() => true).catch(() => false)).toBe(false);

      expect(await runtime.moveWorkspaceFile({
        workspaceId: workspace.workspaceId,
        sourcePath: "missing-source.txt",
        targetPath: "still-missing.txt"
      })).toMatchObject({
        ok: false,
        status: 404,
        error: "源文件不存在。"
      });
    });
  });
});
