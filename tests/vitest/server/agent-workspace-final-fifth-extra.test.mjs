import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AGENT_WORKSPACE_CONTEXT_BUNDLE_VERSION,
  createAgentWorkspace
} from "../../../server/platform/specialized/agent/agent-workspace/index.mjs";

function sha256(value = "") {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function withWorkspaceRuntime(fn, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pact-agent-workspace-final-fifth-"));
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

describe("agent workspace final fifth extra coverage", () => {
  it("accepts the alternate compressed bundle wrapper and surfaces gzip decode failures", async () => {
    await withWorkspaceRuntime(async (runtime) => {
      const source = runtime.createWorkspace({ title: "Bundle Source Fallback" }).workspace;
      const target = runtime.createWorkspace({ title: "Bundle Target Fallback" }).workspace;

      runtime.setOwnedSourceIds(source.workspaceId, ["owned-a"]);
      runtime.hotSwapProfile(source.workspaceId, {
        contextProfileId: "bundle-profile",
        toolGrantId: "bundle-grant",
        modelAlias: "bundle-model",
        knowledgeScope: {
          includeSourceIds: ["bundle-source"]
        }
      });

      const exported = runtime.exportWorkspaceContextBundle(source.workspaceId, {
        includePrivate: false,
        includeBundle: true,
        compress: false,
        maxItems: 2
      });

      const payload = gzipSync(Buffer.from(JSON.stringify(exported.bundle), "utf8")).toString("base64");
      const restored = runtime.restoreWorkspaceContextBundle(
        target.workspaceId,
        {
          context_bundle: {
            encoding: "base64+gzip",
            payload
          },
          bundleHash: exported.bundleHash
        },
        {
          actorUserId: "restorer-alt"
        }
      );

      expect(restored).toMatchObject({
        ok: true,
        bundleVersion: AGENT_WORKSPACE_CONTEXT_BUNDLE_VERSION,
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
        expect.arrayContaining(["owned-a", "bundle-source"])
      );

      const malformed = runtime.restoreWorkspaceContextBundle(target.workspaceId, {
        context_bundle: {
          encoding: "base64+gzip",
          payload: Buffer.from("not-a-gzip-payload", "utf8").toString("base64")
        }
      });

      expect(malformed).toMatchObject({
        ok: false
      });
      expect(malformed.error).toEqual(expect.any(String));
    });
  });

  it("reuses existing checkpoint trees and skips checkpoint creation when tree ids are unavailable", async () => {
    const merkleState = {
      protocolVersion: "pact.merkle.test.v1",
      cas: {
        putBlock: vi.fn(async (content) => {
          const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content || "");
          return {
            cid: `cid-${sha256(buffer.toString("base64")).slice(0, 12)}`,
            byteLength: buffer.length,
            payloadHash: sha256(buffer.toString("utf8"))
          };
        })
      },
      merkleDag: {
        buildManifest: vi.fn(async (kind, entries) => ({
          rootCid: `${kind}-root-${entries.length}`
        }))
      },
      stateCommit: {
        commit: vi.fn(async ({ mutations, contentRefs }) => ({
          commitId: `commit-${mutations.length}-${contentRefs.length}`,
          eventHash: "event-hash",
          beforeRoot: "",
          afterRoot: "after-root",
          contentRefs,
          indexRoots: {}
        }))
      }
    };

    const existingTreeApi = {
      checkpointTreeId: vi.fn(() => "tree-existing"),
      loadCheckpointTree: vi.fn(async () => ({
        treeId: "tree-existing",
        status: "running"
      })),
      startCheckpointTree: vi.fn(async () => ({ started: true })),
      upsertCheckpointNode: vi.fn(async () => ({ ok: true }))
    };

    const missingTreeIdApi = {
      checkpointTreeId: vi.fn(() => ""),
      loadCheckpointTree: vi.fn(async () => null),
      startCheckpointTree: vi.fn(async () => ({ started: true })),
      upsertCheckpointNode: vi.fn(async () => ({ ok: true }))
    };

    await withWorkspaceRuntime(async (runtime) => {
      const workspace = runtime.createWorkspace({ title: "Checkpoint Workspace" }).workspace;
      const created = await runtime.createWorkspaceFolder({
        workspaceId: workspace.workspaceId,
        folderPath: "docs"
      });

      expect(created.ok).toBe(true);
      expect(created.checkpoint).toMatchObject({
        treeId: "tree-existing",
        nodeId: expect.stringContaining("commit:")
      });
      expect(existingTreeApi.loadCheckpointTree).toHaveBeenCalledTimes(1);
      expect(existingTreeApi.startCheckpointTree).not.toHaveBeenCalled();
      expect(existingTreeApi.upsertCheckpointNode).toHaveBeenCalledTimes(1);
    }, { merkleState, checkpointTreeApi: existingTreeApi });

    await withWorkspaceRuntime(async (runtime) => {
      const workspace = runtime.createWorkspace({ title: "No Tree Id Workspace" }).workspace;
      const created = await runtime.createWorkspaceFolder({
        workspaceId: workspace.workspaceId,
        folderPath: "docs"
      });

      expect(created.ok).toBe(true);
      expect(created.checkpoint).toBeNull();
      expect(missingTreeIdApi.loadCheckpointTree).not.toHaveBeenCalled();
      expect(missingTreeIdApi.startCheckpointTree).not.toHaveBeenCalled();
      expect(missingTreeIdApi.upsertCheckpointNode).not.toHaveBeenCalled();
    }, { merkleState, checkpointTreeApi: missingTreeIdApi });
  });
});
