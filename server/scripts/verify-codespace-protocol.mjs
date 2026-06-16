import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startHttpServer } from "../services/server-runtime/http-server.mjs";
import { useIsolatedCapabilityKernelForVerifier } from "./capability-kernel-test-env.mjs";
import { installAuthenticatedFetch } from "./test-auth-helper.mjs";

function run(command, args, options = {}) {
  const output = spawnSync(command, args, {
    encoding: "utf8",
    ...options
  });
  assert.equal(output.status, 0, output.stderr || output.stdout || `${command} ${args.join(" ")} failed`);
  return output.stdout.trim();
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  return {
    status: response.status,
    ok: response.ok,
    payload: text.trim() ? JSON.parse(text) : {}
  };
}

function mcpHeaders(token) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
    "X-Pact-Api-Key": token
  };
}

function mcpRequest(method, params = {}, id = 1) {
  return {
    jsonrpc: "2.0",
    id,
    method,
    params
  };
}

async function localMcpGrant(serverUrl, body = {}, headers = {}) {
  return fetchJson(`${serverUrl}/api/mcp/local-grant`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers
    },
    body: JSON.stringify(body)
  });
}

let mcpRequestId = 0;

async function callCodespaceOperation({ serverUrl, token, operation, input = {} }) {
  mcpRequestId += 1;
  return fetchJson(`${serverUrl}/mcp`, {
    method: "POST",
    headers: mcpHeaders(token),
    body: JSON.stringify(mcpRequest("tools/call", {
      name: "pact.codespace",
      arguments: {
        apiVersion: "v0.0.1:mcp:interface-1",
        operation,
        input,
        clientVersion: "verify-codespace-protocol"
      }
    }, mcpRequestId))
  });
}

function structuredPayload(response) {
  return response.payload?.result?.structuredContent?.payload;
}

function assertCodespaceOk(response, operation) {
  assert.equal(response.status, 200, JSON.stringify(response.payload, null, 2));
  assert.equal(response.payload.error, undefined, JSON.stringify(response.payload.error || {}, null, 2));
  assert.equal(response.payload.result.structuredContent.operation, operation);
  const payload = structuredPayload(response);
  assert.equal(payload?.ok, true, JSON.stringify(payload || {}, null, 2));
  return payload;
}

async function approvePendingCodespaceOperation(serverUrl, payload, operation) {
  assert.equal(payload?.status, "pending_approval", JSON.stringify(payload || {}, null, 2));
  assert.equal(payload.pendingOperation?.status, "pending", JSON.stringify(payload || {}, null, 2));
  assert.equal(payload.pendingOperation?.operationId, operation.replace(/^pact\./u, ""), JSON.stringify(payload || {}, null, 2));
  assert.equal(payload.pendingOperation?.reasonCode, "tool_approval_required", JSON.stringify(payload || {}, null, 2));
  const resolved = await fetchJson(
    `${serverUrl}/api/tool-management/v1/pending-operations/${encodeURIComponent(payload.pendingOperation.pendingOperationId)}/resolve`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-pact-safety-confirm": "true"
      },
      body: JSON.stringify({
        resolution: "approved",
        resolvedBy: "verify-codespace-protocol",
        reason: `Approve ${operation} in unified approval verifier.`
      })
    }
  );
  assert.equal(resolved.status, 200, JSON.stringify(resolved.payload, null, 2));
  assert.equal(resolved.payload.pendingOperation?.status, "completed", JSON.stringify(resolved.payload, null, 2));
  assert.ok(resolved.payload.pendingOperation?.resumedToolExecutionId, JSON.stringify(resolved.payload, null, 2));
  assert.equal(typeof resolved.payload.result, "object", JSON.stringify(resolved.payload, null, 2));
  assert.equal(resolved.payload.result?.ok, true, JSON.stringify(resolved.payload, null, 2));
  return resolved.payload.result;
}

async function assertCodespaceOkAfterApproval(response, operation, serverUrl) {
  assert.equal(response.status, 200, JSON.stringify(response.payload, null, 2));
  assert.equal(response.payload.error, undefined, JSON.stringify(response.payload.error || {}, null, 2));
  assert.equal(response.payload.result.structuredContent.operation, operation);
  const payload = structuredPayload(response);
  if (payload?.status === "pending_approval") {
    return approvePendingCodespaceOperation(serverUrl, payload, operation);
  }
  assert.equal(payload?.ok, true, JSON.stringify(payload || {}, null, 2));
  return payload;
}

async function createGitReviewWorktree(rootPath) {
  const repoPath = path.join(rootPath, "review-worktree");
  await fs.mkdir(repoPath, { recursive: true });
  run("git", ["init", "-b", "main"], { cwd: repoPath });
  run("git", ["config", "user.email", "codespace-verify@example.com"], { cwd: repoPath });
  run("git", ["config", "user.name", "Codespace Verify"], { cwd: repoPath });
  await fs.writeFile(path.join(repoPath, "README.md"), "codespace verify\n", "utf8");
  run("git", ["add", "README.md"], { cwd: repoPath });
  run("git", ["commit", "-m", "codespace verify"], { cwd: repoPath });
  run("git", ["remote", "add", "origin", "ssh://gerrit.example.invalid:29418/demo/project"], { cwd: repoPath });
  return repoPath;
}

const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-codespace-protocol-"));
const restoreCapabilityKernelEnv = useIsolatedCapabilityKernelForVerifier();
const server = await startHttpServer({
  userDataPath,
  distPath: "",
  port: 0,
  runtimeOptions: {
    profile: "minimal"
  }
});

try {
  await installAuthenticatedFetch(server, { safetyConfirm: false });
  const grant = await localMcpGrant(server.url, {
    label: "verify-codespace-protocol",
    toolsets: ["pact.repo.read", "pact.repo.write", "pact.repo.maintain"],
    grantMode: "maintain",
    targets: ["codespace-verify"]
  }, { "x-pact-safety-confirm": "true" });
  assert.equal(grant.status, 201, JSON.stringify(grant.payload, null, 2));
  const token = grant.payload.token;
  const workspaceId = "codespace-verify";

  const target = assertCodespaceOk(await callCodespaceOperation({
    serverUrl: server.url,
    token,
    operation: "pact.workspace.code.target.evaluate",
    input: {
    workspaceId,
    taskId: "task-1",
    payloadKind: "sourceCode",
    payloadRefs: ["patch://verify/1"],
    repositoryHint: "demo/project",
    branchHint: "main",
    requestedAction: "review",
    idempotencyKey: "codespace-target"
    }
  }), "pact.workspace.code.target.evaluate");
  assert.equal(target.ok, true);
  assert.equal(target.routeDecision, "gerritChange");
  assert.equal(target.compatibleTargets[0].targetProvider, "gerrit");
  assert.ok(target.target.targetId);

  const fallback = assertCodespaceOk(await callCodespaceOperation({
    serverUrl: server.url,
    token,
    operation: "pact.workspace.code.target.evaluate",
    input: {
    workspaceId,
    taskId: "task-2",
    payloadKind: "sourceCode",
    repositoryHint: "demo/project",
    branchHint: "main",
    requestedAction: "draft",
    fallbackReason: "policy requires proposal"
    }
  }), "pact.workspace.code.target.evaluate");
  assert.equal(fallback.routeDecision, "proposalFallback");
  assert.equal(fallback.fallback.operationId, "workspace.proposal.create");

  const prepared = assertCodespaceOk(await callCodespaceOperation({
    serverUrl: server.url,
    token,
    operation: "pact.workspace.code.change.prepare",
    input: {
    workspaceId,
    targetId: target.target.targetId,
    repositoryId: "demo/project",
    branch: "main",
    diff: "diff --git a/README.md b/README.md\n",
    commitPlan: [{ message: "Update README" }],
    idempotencyKey: "codespace-change"
    }
  }), "pact.workspace.code.change.prepare");
  assert.equal(prepared.ok, true);
  assert.equal(prepared.prepared, true);
  assert.equal(prepared.reviewStatus, "draft");
  assert.ok(prepared.changeSet.changeSetId);

  const linked = assertCodespaceOk(await callCodespaceOperation({
    serverUrl: server.url,
    token,
    operation: "pact.workspace.code.change.link",
    input: {
    workspaceId,
    codeChangeId: prepared.codeChangeId,
    changeId: "Iabcdef1234567890",
    changeNumber: "42",
    gerritChangeUrl: "https://gerrit.example.invalid/c/demo/project/+/42",
    patchSetRefs: ["refs/changes/42/42/1"]
    }
  }), "pact.workspace.code.change.link");
  assert.equal(linked.ok, true);
  assert.equal(linked.linked, true);
  assert.equal(linked.codeChangeId, prepared.codeChangeId);
  assert.equal(linked.reviewStatus, "open");

  const synced = assertCodespaceOk(await callCodespaceOperation({
    serverUrl: server.url,
    token,
    operation: "pact.workspace.code.change.status.sync",
    input: {
    workspaceId,
    codeChangeId: prepared.codeChangeId,
    reviewStatus: "merged",
    submitStatus: "merged"
    }
  }), "pact.workspace.code.change.status.sync");
  assert.equal(synced.ok, true);
  assert.equal(synced.synced, true);
  assert.equal(synced.reviewStatus, "merged");
  assert.equal(synced.submitStatus, "merged");

  const repoPath = await createGitReviewWorktree(userDataPath);
  const upload = await assertCodespaceOkAfterApproval(await callCodespaceOperation({
    serverUrl: server.url,
    token,
    operation: "pact.workspace.code.change.upload",
    input: {
    workspaceId,
    codeChangeId: prepared.codeChangeId,
    repositoryRef: "demo/project",
    branch: "main",
    worktreePath: repoPath,
    dryRun: true,
    confirm: true
    }
  }), "pact.workspace.code.change.upload", server.url);
  assert.equal(upload.ok, true);
  assert.equal(upload.dryRun, true);
  assert.equal(upload.target.targetKind, "codespace");
  assert.equal(upload.target.targetProvider, "gerrit");
  assert.equal(upload.codeChange.codeChangeId, prepared.codeChangeId);
  assert.equal(upload.codeChange.completion.dryRun, true);

  const registryPath = path.join(userDataPath, "code-management", "codespace-registry.json");
  const registry = JSON.parse(await fs.readFile(registryPath, "utf8"));
  assert.equal(registry.protocolVersion, "v0.0.1:platform:codespace-1");
  assert.ok(registry.targets[target.target.targetId]);
  assert.ok(registry.changes[prepared.codeChangeId]);
  const eventTypes = registry.events.map((event) => event.type);
  assert.ok(eventTypes.includes("code.route.evaluated"));
  assert.ok(eventTypes.includes("code.change.prepared"));
  assert.ok(eventTypes.includes("code.change.linked"));
  assert.ok(eventTypes.includes("code.change.status.synced"));
  assert.ok(eventTypes.includes("code.change.uploaded"));
  assert.ok(eventTypes.includes("code.change.fallback.created"));

  console.log("codespace protocol verification passed");
} finally {
  await server.close();
  await fs.rm(userDataPath, { recursive: true, force: true });
  restoreCapabilityKernelEnv();
}
