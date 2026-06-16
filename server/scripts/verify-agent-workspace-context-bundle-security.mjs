#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";

process.env.PACT_AGENT_WORKSPACE_CONTEXT_BUNDLE_COMPRESSED_MAX_BYTES = "4096";
process.env.PACT_AGENT_WORKSPACE_CONTEXT_BUNDLE_UNCOMPRESSED_MAX_BYTES = "2048";

const {
  createAgentWorkspace,
  AGENT_WORKSPACE_CONTEXT_BUNDLE_VERSION
} = await import("../platform/specialized/agent/agent-workspace/index.mjs");

const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-context-bundle-security-"));
const actor = {
  actorUserId: "context-bundle-security-owner",
  userId: "context-bundle-security-owner",
  subjectId: "context-bundle-security-owner",
  username: "context-bundle-security-owner"
};

try {
  const workspace = createAgentWorkspace({ userDataPath });
  const source = workspace.createWorkspace({
    ...actor,
    ownerUserId: actor.actorUserId,
    title: "Context bundle source",
    objective: "Verify bounded context bundle restore"
  }).workspace;
  const target = workspace.createWorkspace({
    ...actor,
    ownerUserId: actor.actorUserId,
    title: "Context bundle target",
    objective: "Verify bounded context bundle restore target"
  }).workspace;

  const validBundle = workspace.exportWorkspaceContextBundle(source.workspaceId, {
    ...actor,
    compress: true,
    includeBundle: false,
    maxItems: 1,
    contentPreviewChars: 32
  });
  const validRestore = workspace.restoreWorkspaceContextBundle(target.workspaceId, {
    compressed: validBundle.compressed,
    bundleHash: validBundle.bundleHash
  }, actor);
  assert.equal(validRestore.ok, true, "valid compressed context bundle must still restore");

  const oversizedBundle = {
    bundleVersion: AGENT_WORKSPACE_CONTEXT_BUNDLE_VERSION,
    workspaceId: source.workspaceId,
    generatedAt: new Date().toISOString(),
    context: {
      workspaceId: source.workspaceId,
      contextProfileId: "oversized-context-profile",
      modelAlias: "oversized-model",
      toolGrantId: "oversized-grant",
      knowledgeSourceIds: []
    },
    resolvedProfile: {},
    recent: {
      runs: [],
      submissions: [],
      artifacts: [{
        artifactId: "oversized-artifact",
        content: "A".repeat(8192)
      }]
    }
  };
  const payload = gzipSync(Buffer.from(JSON.stringify(oversizedBundle), "utf8")).toString("base64");
  const oversizedRestore = workspace.restoreWorkspaceContextBundle(target.workspaceId, {
    compressed: {
      encoding: "gzip+base64",
      payload
    }
  }, actor);
  assert.equal(oversizedRestore.ok, false, "oversized compressed context bundle must be rejected");
  assert.match(oversizedRestore.error, /大小上限/);
} finally {
  await fs.rm(userDataPath, { recursive: true, force: true });
}

console.log("agent workspace context bundle security verification passed");
