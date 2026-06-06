import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createContextCompactionRuntimeMock = vi.hoisted(() => vi.fn());

vi.mock("../../../server/platform/specialized/agent/agent-context/context-compact/index.mjs", async () => {
  const actual = await vi.importActual("../../../server/platform/specialized/agent/agent-context/context-compact/index.mjs");
  return {
    ...actual,
    createContextCompactionRuntime: (...args) => createContextCompactionRuntimeMock(...args)
  };
});

import {
  AGENT_WORKSPACE_CONTEXT_BUNDLE_VERSION,
  createAgentWorkspace
} from "../../../server/platform/specialized/agent/agent-workspace/index.mjs";
import {
  CONTEXT_RUNTIME_PROTOCOL_VERSION,
  createContextRuntime
} from "../../../server/platform/specialized/agent/agent-context/interface/index.mjs";

function sha256(value = "") {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function tempDir(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function withWorkspaceRuntime(fn) {
  const root = await tempDir("pact-agent-workspace-final-extra-11-");
  const runtime = createAgentWorkspace({ userDataPath: root });
  try {
    return await fn(runtime, root);
  } finally {
    runtime.close();
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function withContextRuntime(fn) {
  const root = await tempDir("pact-context-core-final-extra-11-");
  const runtime = createContextRuntime({ userDataPath: root, clientRuntimeAllocator: {
    resolve: vi.fn(async () => ({
      contextProfileId: "custom-unit"
    }))
  } });
  try {
    return await fn(runtime, root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

function createStubCompactionRuntime() {
  return {
    preview: vi.fn(async (input = {}) => ({
      protocolVersion: "pact.context.compaction.v1",
      status: "preview",
      compacted: false,
      executionMode: "stub",
      profileId: input.profile?.profileId || "",
      inputSource: input.inputSource || ""
    })),
    run: vi.fn(async () => ({
      protocolVersion: "pact.context.compaction.v1",
      status: "completed",
      compacted: false,
      executionMode: "stub"
    })),
    listRecords: vi.fn(async () => ({
      protocolVersion: "pact.context.compaction.v1",
      records: []
    })),
    listStrategies: vi.fn(async () => ({
      protocolVersion: "pact.context.compaction.v1",
      strategies: []
    })),
    listSessionMemory: vi.fn(async () => ({
      protocolVersion: "pact.context.compaction.v1",
      memories: []
    })),
    clearSessionMemory: vi.fn(async () => ({
      protocolVersion: "pact.context.compaction.v1",
      cleared: 0
    }))
  };
}

beforeEach(() => {
  createContextCompactionRuntimeMock.mockImplementation(() => createStubCompactionRuntime());
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("agent workspace lifecycle and empty-state edges", () => {
  it("normalizes workspace/session metadata, then deletes the workspace and leaves empty queries", async () => {
    await withWorkspaceRuntime(async (runtime) => {
      const workspaceResult = runtime.createWorkspace({
        title: "Metadata Workspace",
        defaultAdminUserId: "admin-main",
        metadata: {
          adminUserIds: ["  alpha  ", "alpha", null, ""],
          administrators: ["beta", "alpha"],
        }
      });
      const workspace = workspaceResult.workspace;

      expect(workspace.metadata.defaultAdminUserId).toBe("admin-main");
      expect(workspace.metadata.adminUserIds).toEqual(["alpha", "beta", "admin-main"]);

      const sessionResult = runtime.createSession({
        workspaceId: workspace.workspaceId,
        title: "Metadata Session",
        context: {
          modelAlias: "session-model",
          knowledgeSourceIds: ["source-a", "source-b"]
        },
        metadata: {
          channel: "unit-test"
        }
      });
      const session = sessionResult.session;

      expect(session.metadata).toMatchObject({
        appendOnly: true,
        channel: "unit-test"
      });
      expect(session.context).toMatchObject({
        workspaceId: workspace.workspaceId,
        modelAlias: "session-model",
        knowledgeSourceIds: ["source-a", "source-b"]
      });

      expect(runtime.getWorkspace("missing-workspace")).toBeNull();
      expect(runtime.getSession("missing-session")).toBeNull();
      expect(runtime.getSessionContext("missing-session")).toBeNull();
      expect(runtime.listSessions({ workspaceId: "missing-workspace" })).toMatchObject({
        count: 0,
        sessions: []
      });

      const deleteResult = runtime.deleteWorkspace(workspace.workspaceId);
      expect(deleteResult).toMatchObject({
        ok: true,
        deleted: true
      });
      expect(runtime.getWorkspace(workspace.workspaceId)).toBeNull();
      expect(runtime.getSession(session.sessionId)).toBeNull();
      expect(runtime.listSessions({ workspaceId: workspace.workspaceId })).toMatchObject({
        count: 0,
        sessions: []
      });
      expect(runtime.listLocks({ workspaceId: workspace.workspaceId })).toEqual([]);
      expect(runtime.releaseLock({ workspaceId: workspace.workspaceId })).toMatchObject({
        ok: true,
        released: false
      });
    });
  });
});

describe("agent workspace lock and bundle edge cases", () => {
  it("handles invalid lock inputs, lock ownership mismatch, and bundle preview/restore boundaries", async () => {
    await withWorkspaceRuntime(async (runtime) => {
      const source = runtime.createWorkspace({ title: "Bundle Source" }).workspace;
      const target = runtime.createWorkspace({ title: "Bundle Target" }).workspace;

      await fs.writeFile(path.join(source.fsPath, "preview.txt"), "preview body", "utf8");
      await fs.writeFile(path.join(source.fsPath, "artifact.txt"), "artifact content that should be truncated in previews", "utf8");
      runtime.setOwnedSourceIds(source.workspaceId, ["source-a", "source-b"]);
      runtime.hotSwapProfile(source.workspaceId, {
        contextProfileId: "bundle-profile",
        toolGrantId: "bundle-grant",
        modelAlias: "bundle-model",
        knowledgeScope: {
          includeSourceIds: ["source-a"]
        }
      });
      runtime.createArtifact({
        workspaceId: source.workspaceId,
        runId: "run-bundle-preview",
        level: "ContextBundleHandoff",
        title: "Bundle Artifact",
        content: "This artifact content is intentionally long enough to exercise compactArtifact preview truncation."
      });

      expect(await runtime.workspaceFileMetadata({
        workspaceId: source.workspaceId,
        path: "missing.txt"
      })).toMatchObject({
        ok: true,
        exists: false,
        file: {
          workspaceId: source.workspaceId,
          relativePath: "missing.txt"
        }
      });

      const filePreview = await runtime.workspaceFileMetadata({
        workspaceId: source.workspaceId,
        path: "preview.txt",
        includeHash: false
      });
      expect(filePreview).toMatchObject({
        ok: true,
        exists: true,
        file: {
          workspaceId: source.workspaceId,
          relativePath: "preview.txt"
        }
      });
      expect(filePreview.file.contentSha256).toBe("");

      expect(runtime.acquireLock({
        workspaceId: source.workspaceId,
        targetId: "artifact-1",
        ownerAgentId: "agent-a"
      })).toMatchObject({
        ok: false,
        error: "missing_lock_fields"
      });
      expect(runtime.acquireLock({
        workspaceId: "missing-workspace",
        targetType: "artifact",
        targetId: "artifact-1",
        ownerAgentId: "agent-a"
      })).toMatchObject({
        ok: false,
        error: "workspace_forbidden"
      });

      const acquired = runtime.acquireLock({
        workspaceId: source.workspaceId,
        targetType: "artifact",
        targetId: "artifact-1",
        ownerAgentId: "agent-a"
      });
      expect(acquired).toMatchObject({
        ok: true
      });
      expect(runtime.listLocks({ workspaceId: source.workspaceId })).toHaveLength(1);
      expect(runtime.releaseLock({
        workspaceId: source.workspaceId,
        targetType: "artifact",
        targetId: "artifact-1",
        ownerAgentId: "agent-b"
      })).toMatchObject({
        ok: false,
        released: false,
        error: "lock_owner_mismatch"
      });
      expect(runtime.releaseLock({
        workspaceId: source.workspaceId,
        targetType: "artifact",
        targetId: "artifact-1",
        ownerAgentId: "agent-a"
      })).toMatchObject({
        ok: true,
        released: true
      });
      expect(runtime.listLocks({ workspaceId: source.workspaceId })).toEqual([]);
      expect(runtime.adminReleaseLock({
        workspaceId: source.workspaceId,
        targetType: "artifact",
        targetId: "artifact-1"
      })).toMatchObject({
        ok: true,
        released: false
      });

      const previewOnly = runtime.exportWorkspaceContextBundle(source.workspaceId, {
        includeBundle: false,
        compress: false,
        contentPreviewChars: 8,
        maxItems: 1
      });
      expect(previewOnly).toMatchObject({
        protocolVersion: "pact.agent-workspace.v1",
        bundleVersion: AGENT_WORKSPACE_CONTEXT_BUNDLE_VERSION,
        compressed: null,
        bundle: undefined
      });
      expect(previewOnly.compression).toMatchObject({
        algorithm: "none"
      });

      const exported = runtime.exportWorkspaceContextBundle(source.workspaceId, {
        compress: false,
        contentPreviewChars: 8,
        maxItems: 1
      });
      expect(exported.compressed).toBeNull();
      expect(exported.bundle.recent.artifacts).toHaveLength(1);
      expect(exported.bundle.recent.artifacts[0].contentPreview).toContain("...<truncated>");
      expect(exported.bundle.recent.artifacts[0].contentPreview.length).toBeLessThan("This artifact content is intentionally long enough to exercise compactArtifact preview truncation.".length);

      expect(runtime.restoreWorkspaceContextBundle(target.workspaceId, {})).toMatchObject({
        ok: false,
        error: "缺少工作空间上下文压缩包。"
      });
      expect(runtime.restoreWorkspaceContextBundle(target.workspaceId, {
        bundleCompressed: {
          encoding: "br",
          payload: "abc"
        }
      })).toMatchObject({
        ok: false,
        error: "工作空间上下文压缩包编码不受支持。"
      });

      const restored = runtime.restoreWorkspaceContextBundle(target.workspaceId, {
        bundle: exported.bundle
      }, {
        actorUserId: "bundle-restorer"
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
          modelAlias: "bundle-model",
          knowledgeSourceCount: 2
        }
      });
      expect(restored.restoredContext).toMatchObject({
        contextProfileId: "bundle-profile",
        toolGrantId: "bundle-grant",
        modelAlias: "bundle-model"
      });
    });
  });
});

describe("context core profile normalization and preview edges", () => {
  it("normalizes saved profiles, resolves allocator-driven profiles, and proxies preview calls", async () => {
    await withContextRuntime(async (runtime) => {
      const saved = await runtime.saveProfiles({
        profiles: [
          {
            profileId: " custom-unit ",
            label: 123,
            modelAlias: "alias-model",
            contextWindowTokens: 1024,
            outputReserveTokens: -12,
            toolReserveTokens: "bad",
            budgetPolicy: {
              fixedMemoryRatio: "1.5",
              expertGuidanceRatio: -3
            },
            rankingWeights: {
              queryRelevance: -1,
              evidenceConfidence: "0.66"
            },
            placementPolicy: {
              criticalEvidenceHeadCount: 0,
              evidenceTailChecklist: false,
              repeatTaskInTail: false
            },
            compression: {
              mode: "invalid-mode",
              threshold: 2,
              targetRatio: -1,
              summaryMaxTokens: "bad"
            },
            modelCompression: {
              enabled: true,
              maxInputTokens: "bad",
              maxOutputTokens: "bad"
            }
          }
        ]
      });

      const normalized = saved.profiles.find((profile) => profile.profileId === "custom-unit");
      expect(normalized).toBeDefined();
      expect(normalized.label).toBe("123");
      expect(normalized.contextWindowTokens).toBeGreaterThanOrEqual(4096);
      expect(normalized.outputReserveTokens).toBeGreaterThanOrEqual(256);
      expect(normalized.toolReserveTokens).toBeGreaterThan(0);
      expect(normalized.budgetPolicy.fixedMemoryRatio).toBe(1);
      expect(normalized.budgetPolicy.expertGuidanceRatio).toBe(0);
      expect(normalized.rankingWeights.queryRelevance).toBe(0);
      expect(normalized.rankingWeights.evidenceConfidence).toBe(0.66);
      expect(normalized.placementPolicy.criticalEvidenceHeadCount).toBe(1);
      expect(normalized.placementPolicy.evidenceTailChecklist).toBe(false);
      expect(normalized.placementPolicy.repeatTaskInTail).toBe(false);
      expect(normalized.compression.mode).toBe("deterministic-extractive");
      expect(normalized.compression.threshold).toBe(0.95);
      expect(normalized.compression.targetRatio).toBe(0.05);
      expect(normalized.modelCompression.enabled).toBe(true);
      expect(normalized.modelCompression.maxInputTokens).toBe(24000);
      expect(normalized.modelCompression.maxOutputTokens).toBe(4000);

      const profileIndex = await runtime.listProfiles();
      expect(profileIndex.protocolVersion).toBe(CONTEXT_RUNTIME_PROTOCOL_VERSION);
      expect(profileIndex.defaults).toEqual(expect.arrayContaining([
        expect.objectContaining({ profileId: "balanced" })
      ]));
      expect(profileIndex.profiles).toEqual(expect.arrayContaining([
        expect.objectContaining({ profileId: "custom-unit", modelAlias: "alias-model" })
      ]));

      const resolved = await runtime.resolveProfile({ modelAlias: "alias-model" });
      expect(resolved.profileId).toBe("custom-unit");

      const allocatorResolved = await runtime.resolveProfile({});
      expect(allocatorResolved.profileId).toBe("custom-unit");

      const preview = await runtime.previewCompaction({
        modelAlias: "alias-model",
        text: "preview text"
      });
      expect(preview).toMatchObject({
        protocolVersion: "pact.context.compaction.v1",
        status: "preview",
        profileId: "custom-unit"
      });
      expect(createContextCompactionRuntimeMock).toHaveBeenCalled();
    });
  });
});
