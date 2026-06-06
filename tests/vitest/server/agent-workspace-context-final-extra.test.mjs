import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAgentWorkspace
} from "../../../server/platform/specialized/agent/agent-workspace/index.mjs";
import { AGENT_WORKSPACE_CONTEXT_BUNDLE_VERSION } from "../../../server/platform/specialized/agent/agent-workspace/index.mjs";
import {
  CONTEXT_COMPACTION_PROTOCOL_VERSION,
  computeCompactionBudget,
  estimateContextTokens,
  createContextCompactionRuntime
} from "../../../server/platform/specialized/agent/agent-context/interface/index.mjs";
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
  const root = await tempDir("pact-agent-workspace-context-final-extra-");
  const runtime = createAgentWorkspace({ userDataPath: root });
  try {
    return await fn(runtime, root);
  } finally {
    runtime.close();
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function withCompactionRuntime(fn) {
  const root = await tempDir("pact-context-compact-final-extra-");
  try {
    const runtime = createContextCompactionRuntime({ userDataPath: root });
    return await fn(runtime, root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

function buildTokenHeavyText(targetTokens, pattern = "context compaction coverage token seed") {
  const safePattern = `${pattern} `;
  let text = safePattern.repeat(Math.max(1, Math.ceil(targetTokens / Math.max(1, estimateContextTokens(safePattern)))));
  while (estimateContextTokens(text) < targetTokens) {
    text += safePattern;
  }
  return text.trim();
}

function thresholdProfile() {
  return {
    contextWindowTokens: 5000,
    outputReserveTokens: 256,
    compactionPolicy: {
      summaryReserveTokens: 256,
      reservedBufferTokens: 1800,
      warningBufferTokens: 2600,
      hardBufferTokens: 1200
    }
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("agent workspace invalid path and permission edges", () => {
  it("rejects invalid workspace file paths in metadata/read/patch/write/delete/restore flows", async () => {
    await withWorkspaceRuntime(async (runtime) => {
      const workspace = runtime.createWorkspace({ title: "Invalid Path Workspace" }).workspace;

      await fs.writeFile(path.join(workspace.fsPath, "note.txt"), "note", "utf8");

      expect(await runtime.workspaceFileMetadata({
        workspaceId: workspace.workspaceId,
        path: "/tmp/escape.txt"
      })).toMatchObject({
        ok: false,
        status: 400,
        error: "路径必须是工作空间相对路径。"
      });

      expect(await runtime.workspaceFileMetadata({
        workspaceId: workspace.workspaceId,
        path: "../outside.txt"
      })).toMatchObject({
        ok: false,
        status: 400,
        error: "路径不能跳出工作空间。"
      });

      expect(await runtime.workspaceFileMetadata({
        workspaceId: workspace.workspaceId,
        path: "a\0b.txt"
      })).toMatchObject({
        ok: false,
        status: 400,
        error: "路径必须是工作空间相对路径。"
      });

      expect(await runtime.downloadWorkspaceFile({
        workspaceId: workspace.workspaceId,
        path: "../note.txt"
      })).toMatchObject({
        ok: false,
        status: 400,
        error: "路径不能跳出工作空间。"
      });

      expect(await runtime.writeWorkspaceFile({
        workspaceId: workspace.workspaceId,
        path: ".secret",
        content: "top-secret"
      })).toMatchObject({
        ok: false,
        status: 400,
        error: "不允许操作以 . 开头的文件。"
      });

      expect(await runtime.patchWorkspaceFile({
        workspaceId: workspace.workspaceId,
        path: "../note.txt",
        expectedSha256: sha256("note"),
        hunks: [{ oldText: "note", newText: "patched" }]
      })).toMatchObject({
        ok: false,
        status: 400,
        error: "路径不能跳出工作空间。"
      });

      expect(await runtime.patchWorkspaceFile({
        workspaceId: workspace.workspaceId,
        path: ".hidden-note.txt",
        expectedSha256: sha256("note"),
        patch: "@@ -1 +1 @@\n-note\n+patched"
      })).toMatchObject({
        ok: false,
        status: 400,
        error: "不允许操作以 . 开头的文件。"
      });

      expect(await runtime.deleteWorkspaceFile({
        workspaceId: workspace.workspaceId,
        path: "../missing.txt"
      })).toMatchObject({
        ok: false,
        status: 400,
        error: "路径不能跳出工作空间。"
      });

      expect(await runtime.restoreWorkspaceFiles({
        workspaceId: workspace.workspaceId,
        fileSnapshot: {
          basePath: "..",
          files: [
            {
              path: "note.txt",
              content: "note"
            }
          ]
        }
      })).toMatchObject({
        ok: false,
        status: 400,
        error: "路径不能跳出工作空间。"
      });
    });
  });

  it("hits lock/share permission edges without mutating workspace state unexpectedly", async () => {
    await withWorkspaceRuntime(async (runtime) => {
      const workspace = runtime.createWorkspace({ title: "Permission Workspace" }).workspace;
      const target = runtime.createWorkspace({ title: "Permission Target" }).workspace;

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
        workspaceId: workspace.workspaceId,
        targetId: "artifact-1",
        ownerAgentId: "agent-a"
      })).toMatchObject({
        ok: false,
        error: "missing_lock_fields"
      });

      expect(runtime.shareWorkspace(workspace.workspaceId, workspace.workspaceId)).toMatchObject({
        ok: false,
        error: "不能共享给自身"
      });

      expect(runtime.shareWorkspace("missing-source", target.workspaceId)).toMatchObject({
        ok: false,
        error: "来源工作空间不存在"
      });

      expect(runtime.shareWorkspace(workspace.workspaceId, "missing-target")).toMatchObject({
        ok: false,
        error: "目标工作空间不存在"
      });
    });
  });
});

describe("context compaction boundary, threshold, and fallback branches", () => {
  it("returns resumed false when compact boundary is absent", async () => {
    await withCompactionRuntime(async (runtime) => {
      const resumed = runtime.resumeTranscript({
        messages: [
          { id: "x1", role: "user", content: "alpha" },
          { id: "x2", role: "assistant", content: "beta" }
        ]
      });
      expect(resumed).toMatchObject({
        protocolVersion: CONTEXT_COMPACTION_PROTOCOL_VERSION,
        resumed: false
      });
      expect(resumed.messages).toMatchObject([
        { id: "x1", role: "user", content: "alpha" },
        { id: "x2", role: "assistant", content: "beta" }
      ]);
      expect(resumed.skippedMessageCount).toBeUndefined();
    });
  });

  it("classifies warning-threshold workloads as skipped and non-compaction", async () => {
    await withCompactionRuntime(async (runtime) => {
      const profile = thresholdProfile();
      const budget = computeCompactionBudget(profile, profile.compactionPolicy);
      const warningLoad = Math.floor((budget.warningThresholdTokens + budget.autoCompactThresholdTokens) / 2);
      const result = await runtime.maybeCompact({
        profile,
        sessionId: "warning-threshold-session",
        source: "workspace",
        messages: [
          {
            id: "mid-session",
            role: "user",
            content: buildTokenHeavyText(Math.max(warningLoad, 1))
          }
        ]
      });

      expect(result).toMatchObject({
        status: "skipped",
        shouldCompact: false,
        triggerReason: "warning_threshold",
        compacted: false
      });
      expect(result.tokenReport.shouldCompact).toBeUndefined();
      expect(result.tokenReport.sourceTokens).toBeGreaterThanOrEqual(budget.warningThresholdTokens);
      expect(result.tokenReport.sourceTokens).toBeLessThanOrEqual(Math.ceil(budget.autoCompactThresholdTokens));
    });
  });

  it("compacts at hard threshold with deterministic strategy and persists compact transcript", async () => {
    await withCompactionRuntime(async (runtime) => {
      const profile = {
        profileId: "memory-preview-profile",
        ...thresholdProfile(),
        modelCompression: {
          enabled: false
        },
        compactionPolicy: {
          ...thresholdProfile().compactionPolicy,
          strategy: {
            id: "deterministic-extractive"
          },
          persistSessionMemory: false,
          persistBoundaries: false
        }
      };
      const budget = computeCompactionBudget(profile, profile.compactionPolicy);
      const hardLoad = budget.hardThresholdTokens + 32;
      const result = await runtime.run({
        profile,
        sessionId: "hard-threshold-session",
        source: "agent-model",
        messages: [
          {
            id: "huge-message",
            role: "user",
            content: buildTokenHeavyText(Math.max(hardLoad, 1))
          }
        ],
        taskBrief: "hard-threshold coverage"
      });

      expect(result).toMatchObject({
        status: "completed",
        shouldCompact: true,
        compacted: true,
        triggerReason: "hard_threshold",
        executionMode: "deterministic-extractive",
        strategy: {
          id: "deterministic-extractive"
        }
      });
      expect(result.degraded).toBe(false);
      expect(result.boundary?.type).toBe("compact_boundary");
      expect(result.boundaryMessage?.type).toBe("compact_boundary");
    });
  });

  it("falls back to deterministic summary when model-assisted strategy fails", async () => {
    const modelCompressor = vi.fn(async () => {
      throw new Error("temporary model outage");
    });

    await withCompactionRuntime(async (runtime) => {
      const profile = {
        ...thresholdProfile(),
        modelCompression: {
          enabled: true
        },
        compactionPolicy: {
          ...thresholdProfile().compactionPolicy,
          strategy: {
            id: "model-assisted"
          },
          ptlRetryLimit: 0,
          persistSessionMemory: false,
          persistBoundaries: false
        }
      };
      const budget = computeCompactionBudget(profile, profile.compactionPolicy);
      const autoLoad = Math.min(
        budget.autoCompactThresholdTokens + 32,
        budget.hardThresholdTokens - 1
      );
      const result = await createContextCompactionRuntime({
        userDataPath: await tempDir("pact-context-compact-fallback-"),
        modelCompressor
      }).run({
        profile,
        sessionId: "model-fallback-session",
        source: "agent-model",
        messages: [
          {
            id: "huge-message",
            role: "user",
            content: buildTokenHeavyText(Math.max(autoLoad, 1))
          }
        ],
        taskBrief: "fallback coverage"
      });

      expect(modelCompressor).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({
        status: "completed",
        shouldCompact: true,
        compacted: true,
        triggerReason: "auto_threshold",
        executionMode: "deterministic-extractive",
        strategy: {
          id: "model-assisted"
        },
        degraded: true
      });
      expect(result.degradedReasons).toEqual([expect.stringContaining("temporary model outage")]);
      expect(result.modelEvents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            used: false,
            degraded: true,
            error: "temporary model outage"
          })
        ])
      );
    });
  });

  it("records failed compaction when strategy execution itself is invalid", async () => {
      const root = await tempDir("pact-context-compact-invalid-strategy-");
      const runtime = createContextCompactionRuntime({ userDataPath: root });

    try {
      const profile = thresholdProfile();
      profile.compactionPolicy = {
        ...profile.compactionPolicy,
        strategy: {
          id: "does-not-exist"
        },
        persistSessionMemory: false,
        persistBoundaries: false
      };
      const budget = computeCompactionBudget(profile, profile.compactionPolicy);
      const invalidLoad = Math.min(
        budget.autoCompactThresholdTokens + 32,
        budget.hardThresholdTokens - 1
      );
      await expect(runtime.run({
        profile,
        sessionId: "invalid-strategy-session",
        source: "agent-model",
        messages: [
          {
            id: "long-message",
            role: "user",
            content: buildTokenHeavyText(Math.max(invalidLoad, 1))
          }
        ]
      })).rejects.toThrow("context_compaction_strategy_unknown:does-not-exist");

      const records = await runtime.listRecords({ limit: 5 });
      expect(records.records).toHaveLength(1);
      expect(records.records[0]).toMatchObject({
        protocolVersion: CONTEXT_COMPACTION_PROTOCOL_VERSION,
        status: "failed",
        source: "agent-model",
        triggerReason: "auto_threshold",
        strategy: {
          id: "does-not-exist"
        }
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe("agent workspace session and lock edge cases", () => {
  it("rejects missing sessions and surfaces lock conflicts", async () => {
    await withWorkspaceRuntime(async (runtime) => {
      const workspace = runtime.createWorkspace({ title: "Session Edge Workspace" }).workspace;

      expect(runtime.createSession({
        workspaceId: "missing-workspace",
        title: "Missing"
      })).toMatchObject({
        ok: false,
        error: "工作空间不存在"
      });

      expect(runtime.getSession({ sessionId: "missing-session" })).toBeNull();
      expect(runtime.appendSessionEvent({ sessionId: "missing-session", type: "ping" })).toBeNull();
      expect(runtime.forkSession({ sessionId: "missing-session" })).toMatchObject({
        ok: false,
        error: "会话不存在"
      });
      expect(runtime.compareSessions({
        leftSessionId: "missing-left",
        rightSessionId: "missing-right"
      })).toMatchObject({
        ok: false,
        error: "会话不存在"
      });
      expect(runtime.archiveSession({ sessionId: "missing-session" })).toMatchObject({
        ok: false,
        error: "会话不存在"
      });
      expect(runtime.getSessionContext("missing-session")).toBeNull();

      const session = runtime.createSession({
        workspaceId: workspace.workspaceId,
        title: "Lock Session",
        initialEvent: false
      }).session;
      expect(session).toMatchObject({
        workspaceId: workspace.workspaceId,
        status: "active"
      });

      const firstLock = runtime.acquireLock({
        workspaceId: workspace.workspaceId,
        targetType: "artifact",
        targetId: "artifact-1",
        ownerAgentId: "agent-a",
        ttlMs: 60000
      });
      expect(firstLock).toMatchObject({
        ok: true,
        lock: {
          workspaceId: workspace.workspaceId,
          targetType: "artifact",
          targetId: "artifact-1",
          ownerAgentId: "agent-a"
        }
      });

      const heldLock = runtime.acquireLock({
        workspaceId: workspace.workspaceId,
        targetType: "artifact",
        targetId: "artifact-1",
        ownerAgentId: "agent-b"
      });
      expect(heldLock).toMatchObject({
        ok: false,
        error: "lock_held"
      });
      expect(heldLock.lock).toMatchObject({
        workspaceId: workspace.workspaceId,
        targetType: "artifact",
        targetId: "artifact-1",
        ownerAgentId: "agent-a"
      });

      const wrongRelease = runtime.releaseLock({
        workspaceId: workspace.workspaceId,
        targetType: "artifact",
        targetId: "artifact-1",
        ownerAgentId: "agent-b"
      });
      expect(wrongRelease).toMatchObject({
        ok: false,
        released: false,
        error: "lock_owner_mismatch"
      });

      const locks = runtime.listLocks({
        workspaceId: workspace.workspaceId
      });
      expect(locks).toHaveLength(1);
      expect(locks[0]).toMatchObject({
        workspaceId: workspace.workspaceId,
        targetType: "artifact",
        targetId: "artifact-1"
      });
    });
  });
});

describe("workspace context bundles and restore edges", () => {
  it("exports a populated bundle, restores it, and rejects invalid restore payloads", async () => {
    await withWorkspaceRuntime(async (runtime) => {
      const root = runtime.createWorkspace({ title: "Bundle Root" }).workspace;
      const source = runtime.createWorkspace({ title: "Bundle Source" }).workspace;
      const target = runtime.createWorkspace({ title: "Bundle Target" }).workspace;
      const restore = runtime.createWorkspace({ title: "Bundle Restore" }).workspace;

      expect(runtime.setOwnedSourceIds(root.workspaceId, ["root-source-a"])).toMatchObject({ ok: true });
      expect(runtime.setWorkspaceParent(source.workspaceId, root.workspaceId)).toMatchObject({ ok: true });
      expect(runtime.setOwnedSourceIds(source.workspaceId, ["source-source-a", "source-source-b"])).toMatchObject({ ok: true });
      expect(runtime.setOwnedSourceIds(target.workspaceId, ["target-source-a"])).toMatchObject({ ok: true });
      expect(runtime.hotSwapProfile(target.workspaceId, {
        contextProfileId: "bundle-target-profile",
        modelAlias: "bundle-target-model",
        toolGrantId: "bundle-grant",
        knowledgeScope: {
          includeSourceIds: ["explicit-target-source"]
        }
      })).toMatchObject({ ok: true });
      expect(runtime.shareWorkspace(source.workspaceId, target.workspaceId)).toMatchObject({ ok: true });

      const run = runtime.createRun({
        workspaceId: target.workspaceId,
        runType: "analysis",
        status: "completed",
        input: { scenario: "bundle" },
        steps: [{ id: "step-1", status: "completed" }],
        coverage: { score: 1 },
        startedAt: "2024-01-01T00:00:00.000Z",
        completedAt: "2024-01-01T00:00:01.000Z"
      }).run;
      const submission = runtime.submit({
        workspaceId: target.workspaceId,
        runId: run.runId,
        agentId: "bundle-agent",
        type: "claim",
        payload: { summary: "bundle claim", confidence: 0.91 }
      }).submission;
      const artifact = runtime.createArtifact({
        workspaceId: target.workspaceId,
        runId: run.runId,
        level: "bundle",
        title: "Bundle Artifact",
        content: "artifact payload",
        status: "accepted"
      }).artifact;
      const issue = runtime.createIssue({
        workspaceId: target.workspaceId,
        runId: run.runId,
        type: "issue",
        severity: "medium",
        title: "Bundle Issue",
        payload: { kind: "edge" }
      }).issue;
      const decision = runtime.createDecision({
        workspaceId: target.workspaceId,
        runId: run.runId,
        title: "Bundle Decision",
        payload: { choice: "yes" }
      }).decision;
      const privateState = runtime.savePrivateState({
        workspaceId: target.workspaceId,
        runId: run.runId,
        agentId: "bundle-agent",
        summary: "private bundle state",
        state: { note: "hidden" }
      });

      expect(submission).toMatchObject({ workspaceId: target.workspaceId, type: "claim" });
      expect(artifact).toMatchObject({ workspaceId: target.workspaceId, title: "Bundle Artifact" });
      expect(issue).toMatchObject({ workspaceId: target.workspaceId, title: "Bundle Issue" });
      expect(decision).toMatchObject({ workspaceId: target.workspaceId, title: "Bundle Decision" });
      expect(privateState).toMatchObject({ workspaceId: target.workspaceId, summary: "private bundle state" });

      const exported = runtime.exportWorkspaceContextBundle(target.workspaceId, {
        includePrivate: true,
        maxItems: 4,
        contentPreviewChars: 32
      });

      expect(exported).toMatchObject({
        protocolVersion: "pact.agent-workspace.v1",
        bundleVersion: AGENT_WORKSPACE_CONTEXT_BUNDLE_VERSION,
        compressed: {
          encoding: "gzip+base64"
        }
      });
      expect(exported.bundle.context).toMatchObject({
        contextProfileId: "bundle-target-profile",
        modelAlias: "bundle-target-model",
        toolGrantId: "bundle-grant"
      });
      expect(exported.bundle.recent.runs).toHaveLength(1);
      expect(exported.bundle.recent.submissions).toHaveLength(1);
      expect(exported.bundle.recent.artifacts).toHaveLength(1);
      expect(exported.bundle.recent.issues).toHaveLength(1);
      expect(exported.bundle.recent.decisions).toHaveLength(1);
      expect(exported.bundle.recent.privateStates).toHaveLength(1);
      expect(exported.bundle.handoffMarkdown).toContain("# Workspace Context Bundle");
      expect(exported.restoreEvidence.knowledgeSourceCount).toBeGreaterThanOrEqual(2);

      const restored = runtime.restoreWorkspaceContextBundle(restore.workspaceId, {
        compressed: exported.compressed,
        bundleHash: exported.bundleHash
      }, {
        actorUserId: "restorer"
      });

      expect(restored).toMatchObject({
        ok: true,
        bundleVersion: AGENT_WORKSPACE_CONTEXT_BUNDLE_VERSION,
        source: {
          workspaceId: target.workspaceId
        },
        applied: {
          contextProfileId: "bundle-target-profile",
          modelAlias: "bundle-target-model",
          toolGrantId: "bundle-grant"
        }
      });
      expect(restored.applied.knowledgeSourceCount).toBeGreaterThanOrEqual(2);

      const restoredContext = runtime.getWorkspaceContext(restore.workspaceId);
      expect(restoredContext).toMatchObject({
        contextProfileId: "bundle-target-profile",
        modelAlias: "bundle-target-model",
        toolGrantId: "bundle-grant"
      });
      expect(restoredContext.knowledgeSourceIds).toEqual(expect.arrayContaining([
        "root-source-a",
        "source-source-a",
        "source-source-b",
        "target-source-a",
        "explicit-target-source"
      ]));

      const restoredWorkspace = runtime.getWorkspace({ workspaceId: restore.workspaceId });
      expect(restoredWorkspace.runs.some((item) => item.runType === "context_bundle_restore")).toBe(true);
      expect(restoredWorkspace.artifacts.some((item) => item.level === "ContextBundleHandoff")).toBe(true);

      expect(runtime.restoreWorkspaceContextBundle(restore.workspaceId, {})).toMatchObject({
        ok: false,
        error: "缺少工作空间上下文压缩包。"
      });
      expect(runtime.restoreWorkspaceContextBundle(restore.workspaceId, {
        compressed: {
          encoding: "base64",
          payload: exported.compressed.payload
        }
      })).toMatchObject({
        ok: false,
        error: "工作空间上下文压缩包编码不受支持。"
      });
      expect(runtime.restoreWorkspaceContextBundle(restore.workspaceId, {
        compressed: exported.compressed,
        bundleHash: "deadbeef"
      })).toMatchObject({
        ok: false,
        error: "工作空间上下文压缩包 hash 校验失败。"
      });
      expect(runtime.restoreWorkspaceContextBundle("missing-target-workspace", {
        compressed: exported.compressed,
        bundleHash: exported.bundleHash
      })).toMatchObject({
        ok: false,
        error: "工作空间不存在"
      });
    });
  });
});

describe("context runtime preview records and bad input fallback", () => {
  it("writes preview build records while falling back from missing profile ids", async () => {
    const userDataPath = await tempDir("pact-context-core-preview-");
    const contextRuntime = createContextRuntime({ userDataPath });
    try {
      const compactResult = await contextRuntime.compact({
        profileId: "missing-profile",
        text: "compact text fallback"
      });
      expect(compactResult).toMatchObject({
        protocolVersion: CONTEXT_RUNTIME_PROTOCOL_VERSION,
        profileId: "balanced"
      });

      const previewResult = await contextRuntime.preview({
        contextProfileId: "missing-profile",
        taskBrief: "preview record coverage",
        retrievedEvidence: [
          {
            evidenceId: "ev-preview",
            title: "Preview Evidence",
            snippet: "preview snippet",
            confidence: 0.6
          }
        ]
      });

      expect(previewResult).toMatchObject({
        protocolVersion: CONTEXT_RUNTIME_PROTOCOL_VERSION,
        contextPack: {
          profileId: "balanced"
        }
      });
      expect(previewResult.contextPack.contextBuildRecordId).toBeTruthy();

      const records = await contextRuntime.listBuildRecords({ limit: 5 });
      expect(records.records).toHaveLength(1);
      expect(records.records[0]).toMatchObject({
        protocolVersion: CONTEXT_RUNTIME_PROTOCOL_VERSION,
        inputSource: "preview",
        profileId: "balanced"
      });
    } finally {
      await fs.rm(userDataPath, { recursive: true, force: true });
    }
  });
});

describe("context compaction preview records and memory clear", () => {
  it("keeps preview side-effect free, persists memory on run, and clears session memory", async () => {
    await withCompactionRuntime(async (runtime) => {
      const profile = {
        profileId: "memory-preview-profile",
        ...thresholdProfile(),
        modelCompression: {
          enabled: false
        },
        compactionPolicy: {
          ...thresholdProfile().compactionPolicy,
          strategy: {
            id: "deterministic-extractive"
          },
          persistSessionMemory: true,
          persistBoundaries: true
        }
      };
      const budget = computeCompactionBudget(profile, profile.compactionPolicy);
      const load = Math.max(budget.autoCompactThresholdTokens + 64, budget.hardThresholdTokens + 16);
      const messages = [
        {
          id: "m1",
          role: "user",
          content: buildTokenHeavyText(load, "context compaction memory preview")
        }
      ];

      const preview = await runtime.preview({
        profile,
        sessionId: "memory-preview-session",
        source: "agent-model",
        messages,
        taskBrief: "preview memory"
      });
      expect(preview).toMatchObject({
        protocolVersion: CONTEXT_COMPACTION_PROTOCOL_VERSION,
        preview: true,
        compacted: true,
        executionMode: "deterministic-extractive"
      });
      expect(await runtime.latestSessionMemory({ sessionId: "missing-session" })).toBeNull();
      expect((await runtime.listRecords({ limit: 10 })).records).toHaveLength(0);
      expect((await runtime.listBoundaries({ limit: 10 })).boundaries).toHaveLength(0);
      expect((await runtime.listSessionMemory({ sessionId: "memory-preview-session" })).records).toHaveLength(0);

      const run = await runtime.run({
        profile,
        sessionId: "memory-run-session",
        source: "agent-model",
        messages,
        taskBrief: "run memory"
      });
      expect(run).toMatchObject({
        protocolVersion: CONTEXT_COMPACTION_PROTOCOL_VERSION,
        status: "completed",
        compacted: true,
        executionMode: "deterministic-extractive"
      });

      const runRecords = await runtime.listRecords({ limit: 10 });
      expect(runRecords.records.length).toBeGreaterThan(0);
      expect(runRecords.records[0]).toMatchObject({
        protocolVersion: CONTEXT_COMPACTION_PROTOCOL_VERSION,
        status: "completed",
        sessionId: "memory-run-session"
      });

      const sessionMemoryBeforeClear = await runtime.listSessionMemory({
        sessionId: "memory-run-session"
      });
      expect(sessionMemoryBeforeClear.records.length).toBeGreaterThan(0);
      expect(await runtime.latestSessionMemory({
        sessionId: "memory-run-session",
        profileId: profile.profileId
      })).toMatchObject({
        sessionId: "memory-run-session",
        profileId: profile.profileId
      });

      const cleared = await runtime.clearSessionMemory({
        sessionId: "memory-run-session",
        profileId: profile.profileId,
        reason: "unit-test"
      });
      expect(cleared).toMatchObject({
        protocolVersion: "pact.agent-memory.v1",
        ok: true,
        record: {
          status: "cleared",
          sessionId: "memory-run-session",
          profileId: profile.profileId
        }
      });
      expect(await runtime.latestSessionMemory({
        sessionId: "memory-run-session",
        profileId: profile.profileId
      })).toBeNull();

      const sessionMemoryAfterClear = await runtime.listSessionMemory({
        sessionId: "memory-run-session"
      });
      expect(sessionMemoryAfterClear.records.map((record) => record.status)).toContain("cleared");
      expect((await runtime.listBoundaries({ limit: 10 })).boundaries.length).toBeGreaterThan(0);
    });
  });
});
