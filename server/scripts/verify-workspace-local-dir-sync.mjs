#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startHttpServer } from "../services/server-runtime/http-server.mjs";
import { installAuthenticatedFetch } from "./test-auth-helper.mjs";

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const rawText = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    payload: rawText.trim() ? JSON.parse(rawText) : {}
  };
}

function extractMcpPayload(response = {}) {
  return response.payload?.result?.structuredContent?.payload;
}

function assertMcpCallFailed(response, expectedStatus = 400) {
  const error = response.payload?.error || response.payload?.result?.structuredContent?.payload?.error;
  assert.ok(error, `expected MCP call failure, got ${JSON.stringify(response.payload, null, 2)}`);
  assert.ok(
    error.code === "tool_call_failed" || Number(error.code) === -32000,
    `unexpected MCP failure code: ${JSON.stringify(error.code)}`
  );
  assert.equal(Number(error.data?.status || 0), expectedStatus);
  return error;
}

async function resolvePendingWorkspaceOperation(baseUrl, pendingOperationId, {
  resolution = "approved",
  resolvedBy = "verify-workspace-local-dir-sync",
  reason = "Local dir sync verifier auto-resolve"
} = {}) {
  const result = await fetchJson(`${baseUrl}/api/tool-management/v1/pending-operations/${encodeURIComponent(pendingOperationId)}/resolve`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-pact-safety-confirm": "true"
    },
    body: JSON.stringify({ resolution, resolvedBy, reason })
  });
  assert.equal(result.status, 200, JSON.stringify(result.payload, null, 2));
  return result.payload;
}

async function callMcpWithApproval(baseUrl, token, operation, input = {}, toolName = "pact.sharedspace", { resolution = "approved" } = {}) {
  mcpId += 1;
  const response = await callMcpRaw(baseUrl, token, operation, input, mcpId, toolName);
  assert.equal(response.status, 200);
  assert.equal(response.payload.error, undefined, JSON.stringify(response.payload.error || {}, null, 2));
  const payload = extractMcpPayload(response);
  if (payload?.status === "pending_approval" && payload.pendingOperation?.pendingOperationId) {
    const resolved = await resolvePendingWorkspaceOperation(baseUrl, payload.pendingOperation.pendingOperationId, { resolution });
    assert.equal(resolved.status, "ok", JSON.stringify(resolved, null, 2));
    assert.equal(resolved.pendingOperation?.status, "completed", JSON.stringify(resolved, null, 2));
    return resolved.result;
  }
  return payload;
}

function apiKeyHeaders(token) {
  return {
    "Content-Type": "application/json",
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

let mcpId = 100;

const originalCapabilityKernelEnv = {
  PACT_TOOL_GRANT_CAPABILITY_KEY_PROVIDER: process.env.PACT_TOOL_GRANT_CAPABILITY_KEY_PROVIDER,
  PACT_TOOL_GRANT_BINDING_GUARD_PROVIDER: process.env.PACT_TOOL_GRANT_BINDING_GUARD_PROVIDER,
  PACT_OPAQUE_CAPABILITY_KEY_PROVIDER: process.env.PACT_OPAQUE_CAPABILITY_KEY_PROVIDER,
  PACT_CAPABILITY_BINDING_GUARD_PROVIDER: process.env.PACT_CAPABILITY_BINDING_GUARD_PROVIDER
};

function useIsolatedCapabilityKernelForVerifier() {
  process.env.PACT_TOOL_GRANT_CAPABILITY_KEY_PROVIDER = "local-file";
  process.env.PACT_TOOL_GRANT_BINDING_GUARD_PROVIDER = "local-file";
  process.env.PACT_OPAQUE_CAPABILITY_KEY_PROVIDER = "local-file";
  process.env.PACT_CAPABILITY_BINDING_GUARD_PROVIDER = "local-file";
}

function restoreCapabilityKernelEnv() {
  for (const [key, value] of Object.entries(originalCapabilityKernelEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

async function callMcp(baseUrl, token, operation, input = {}, toolName = "pact.sharedspace") {
  mcpId += 1;
  const response = await callMcpRaw(baseUrl, token, operation, input, mcpId, toolName);
  assert.equal(response.status, 200);
  assert.equal(response.payload.error, undefined, JSON.stringify(response.payload.error || {}, null, 2));
  return extractMcpPayload(response);
}

async function callMcpRaw(baseUrl, token, operation, input = {}, id = 1, toolName = "pact.sharedspace") {
  return fetchJson(`${baseUrl}/mcp`, {
    method: "POST",
    headers: apiKeyHeaders(token),
    body: JSON.stringify(mcpRequest("tools/call", {
      name: toolName,
      arguments: {
        apiVersion: "v0.0.1:mcp:interface-1",
        operation,
        input,
        clientVersion: "verify-workspace-local-dir-sync"
      }
    }, id))
  });
}

function valuesForKey(value, keyName) {
  if (Array.isArray(value)) {
    return value.flatMap((item) => valuesForKey(item, keyName));
  }
  if (!value || typeof value !== "object") {
    return [];
  }
  return Object.entries(value).flatMap(([key, child]) => [
    ...(key === keyName ? [child] : []),
    ...valuesForKey(child, keyName)
  ]);
}

function assertAuditTrail(payload, operationId, { label, minCount, readOnly, sourcePath, targetPath, expectInputScope = !readOnly }) {
  assert.ok(Array.isArray(payload.items), `${label} should return audit items`);
  assert.ok(payload.count >= minCount, `${label} should include at least ${minCount} ${operationId} items`);
  const matchingItems = payload.items.filter((item) => item.operationId === operationId);
  assert.ok(matchingItems.length >= minCount, `${label} should include ${operationId} entries`);
  const item = expectInputScope && targetPath
    ? (matchingItems.find((candidate) => {
      const candidateTargetValues = [
        ...valuesForKey(candidate.redactedInput, "targetPath"),
        ...valuesForKey(candidate.redactedInput, "path")
      ];
      return candidateTargetValues.includes(targetPath);
    }) || matchingItems[0])
    : matchingItems[0];
  assert.equal(item.transport, "tool-management", `${label} should be recorded through MCP tool-management`);
  assert.equal(item.status, "ok", `${label} should record successful operations`);
  assert.equal(item.readOnly, readOnly, `${label} should preserve read-only metadata`);
  assert.ok(item.inputHash, `${label} should store a stable input hash`);
  assert.ok(item.createdAt, `${label} should store creation time`);
  assert.ok(item.actor?.userId || item.actor?.username, `${label} should store the MCP grant actor`);
  const redactedInputText = JSON.stringify(item.redactedInput || {});
  if (expectInputScope) {
    const targetValues = [
      ...valuesForKey(item.redactedInput, "targetPath"),
      ...valuesForKey(item.redactedInput, "path")
    ];
    assert.ok(
      targetValues.includes(targetPath),
      `${label} should preserve workspace target scope: ${redactedInputText}`
    );
    assert.ok(
      valuesForKey(item.redactedInput, "workspaceId").length > 0 || valuesForKey(item.redactedInput, "workspaceRef").length > 0,
      `${label} should preserve workspace identity`
    );
  } else {
    assert.deepEqual(item.redactedInput || {}, {}, `${label} should not persist read-only input`);
  }
  if (sourcePath) {
    const inputText = redactedInputText;
    assert.equal(inputText.includes(sourcePath), false, `${label} should not leak the local source path`);
    assert.equal(valuesForKey(item.redactedInput, "sourcePath").includes(sourcePath), false, `${label} should redact the local source path`);
  }
}

const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-local-dir-sync-server-"));
const sourceDir = path.join(userDataPath, "agent-workspaces", "local-sources", "verify-source");
const outsideSourceDir = await fs.mkdtemp(path.join(os.tmpdir(), "pact-local-dir-source-outside-"));
let server = null;

try {
  useIsolatedCapabilityKernelForVerifier();
  await fs.mkdir(path.join(sourceDir, "nested"), { recursive: true });
  await fs.writeFile(path.join(sourceDir, "one.txt"), "local one\n", "utf8");
  await fs.writeFile(path.join(sourceDir, "nested", "two.txt"), "local two\n", "utf8");
  await fs.writeFile(path.join(outsideSourceDir, "secret.txt"), "outside source must be denied\n", "utf8");

  server = await startHttpServer({
    userDataPath,
    distPath: "",
    port: 0,
    runtimeOptions: { profile: "minimal" }
  });
  await installAuthenticatedFetch(server);

  const grant = await fetchJson(`${server.url}/api/mcp/local-grant`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-pact-safety-confirm": "true" },
    body: JSON.stringify({
      targets: ["codex"],
      label: "verify-local-dir-sync",
      connectorVersion: "verify",
      grantMode: "maintain",
      toolsets: ["pact.agent.workspace", "pact.agent.workspace.maintain", "pact.storage.read", "pact.storage.write"]
    })
  });
  assert.equal(grant.status, 201, JSON.stringify(grant.payload, null, 2));
  assert.ok(grant.payload.token);

  const created = await callMcp(server.url, grant.payload.token, "pact.workspace.create", {
    title: "Local directory sync verification",
    objective: "Verify Pact-hosted sharedspace can sync from a local filesystem directory."
  });
  const workspaceId = created.workspace.workspaceRef || created.workspace.workspaceId;
  assert.ok(workspaceId);

  const outsideConnect = await callMcpRaw(server.url, grant.payload.token, "pact.sharedspace.localDir.connect", {
    workspaceId,
    sourcePath: outsideSourceDir,
    targetPath: "outside"
  }, 1008);
  assert.equal(outsideConnect.status, 200);
  assertMcpCallFailed(outsideConnect, 400);

  const capabilities = await callMcpRaw(server.url, grant.payload.token, "pact.capabilities.list", {}, "capabilities", "pact.discovery");
  assert.equal(capabilities.status, 200);
  const operationNames = new Set((capabilities.payload.result.structuredContent.operations || []).map((tool) => tool.name));
  for (const operationName of [
    "pact.sharedspace.localDir.connect",
    "pact.sharedspace.localDir.list",
    "pact.sharedspace.item.list",
    "pact.sharedspace.file.read",
    "pact.sharedspace.file.write",
    "pact.sharedspace.item.delete",
    "pact.sharedspace.sync.plan",
    "pact.sharedspace.sync.apply"
  ]) {
    assert.equal(operationNames.has(operationName), true, `${operationName} should be discoverable`);
  }

  const connected = await callMcp(server.url, grant.payload.token, "pact.sharedspace.localDir.connect", {
    workspaceId,
    sourcePath: sourceDir,
    targetPath: "mirror",
    deleteExtraneous: true
  });
  assert.equal(connected.ok, true);
  assert.ok(connected.mount?.mountRef, "connect should return a mount ref");
  assert.equal(connected.mount.sourceRootName, path.basename(await fs.realpath(sourceDir)));
  assert.equal(Object.hasOwn(connected.mount, "sourcePath"), false, "MCP connect payload must not expose absolute sourcePath");
  const mountRef = connected.mount.mountRef;

  const mounts = await callMcp(server.url, grant.payload.token, "pact.sharedspace.localDir.list", {
    workspaceId
  });
  assert.equal(mounts.ok, true);
  assert.equal(mounts.count, 1);
  assert.equal(mounts.mounts[0].mountRef, mountRef);

  const sourceItems = await callMcp(server.url, grant.payload.token, "pact.sharedspace.item.list", {
    workspaceId,
    mountRef,
    recursive: true,
    includeHash: true
  });
  assert.equal(sourceItems.ok, true);
  assert.equal(sourceItems.mode, "localDir");
  assert.ok(sourceItems.accessReceipt?.receiptId, "local directory list should return an access receipt");
  assert.ok(sourceItems.paths.includes("one.txt"));
  assert.ok(sourceItems.paths.includes("nested/two.txt"));
  assert.equal(JSON.stringify(sourceItems).includes(sourceDir), false, "local directory list must not leak sourcePath");

  const firstPlan = await callMcp(server.url, grant.payload.token, "pact.sharedspace.sync.plan", {
    workspaceId,
    mountRef,
    targetPath: "mirror",
    deleteExtraneous: true
  });
  assert.equal(firstPlan.ok, true);
  assert.equal(firstPlan.dryRun, true);
  assert.equal(firstPlan.summary.create, 2);
  assert.equal(firstPlan.summary.changed, 2);
  assert.ok(firstPlan.actions.every((action) => !action.absolutePath));

  const firstApply = await callMcp(server.url, grant.payload.token, "pact.sharedspace.sync.apply", {
    workspaceId,
    mountRef,
    targetPath: "mirror",
    deleteExtraneous: true
  });
  assert.equal(firstApply.ok, true);
  assert.equal(firstApply.dryRun, false);
  assert.equal(firstApply.summary.applied, 2);
  assert.ok(firstApply.stateCommit?.commitId, "sync apply should return a state commit");
  assert.ok(firstApply.stateCommit?.eventHash, "sync apply should return an event hash");
  assert.ok(firstApply.stateCommit?.afterRoot, "sync apply should return an afterRoot");
  assert.ok(firstApply.checkpoint?.treeId, "sync apply should create a workspace_files checkpoint");

  const firstDownload = await callMcp(server.url, grant.payload.token, "pact.workspace.file.download", {
    workspaceId,
    path: "mirror/nested/two.txt"
  });
  assert.equal(firstDownload.ok, true);
  assert.equal(firstDownload.content, "local two\n");
  assert.equal(firstDownload.cacheReceipt?.cacheFamily, "merkle-radix-compatible");
  assert.equal(firstDownload.cacheReceipt?.hit, true);
  assert.ok(firstDownload.cacheReceipt?.proofHash);

  const sharedspaceList = await callMcp(server.url, grant.payload.token, "pact.sharedspace.item.list", {
    workspaceId,
    path: "mirror",
    recursive: true
  });
  assert.equal(sharedspaceList.ok, true);
  assert.equal(sharedspaceList.mode, undefined);
  assert.ok(sharedspaceList.accessReceipt?.receiptId, "sharedspace workspace list should return an access receipt");
  assert.ok(sharedspaceList.paths.includes("mirror/nested/two.txt"));

  const sharedspaceRead = await callMcp(server.url, grant.payload.token, "pact.sharedspace.file.read", {
    workspaceId,
    path: "mirror/nested/two.txt"
  });
  assert.equal(sharedspaceRead.ok, true);
  assert.equal(sharedspaceRead.content, "local two\n");
  assert.ok(sharedspaceRead.accessReceipt?.receiptId, "sharedspace read should return an access receipt");

  const sharedspaceWrite = await callMcp(server.url, grant.payload.token, "pact.sharedspace.file.write", {
    workspaceId,
    path: "mirror/written.txt",
    content: "written through sharedspace\n"
  });
  assert.equal(sharedspaceWrite.ok, true);
  assert.ok(sharedspaceWrite.stateCommit?.commitId, "sharedspace write should return a state commit");
  assert.ok(sharedspaceWrite.checkpoint?.nodeId, "sharedspace write should create a checkpoint");

  const sharedspaceDelete = await callMcpWithApproval(server.url, grant.payload.token, "pact.sharedspace.item.delete", {
    workspaceId,
    path: "mirror/written.txt"
  });
  assert.equal(sharedspaceDelete.ok, true);
  assert.ok(sharedspaceDelete.stateCommit?.commitId, "sharedspace delete should return a state commit");
  assert.ok(sharedspaceDelete.checkpoint?.nodeId, "sharedspace delete should create a checkpoint");

  await fs.writeFile(path.join(sourceDir, "dot.txt"), "local dotfile for verifier\n", "utf8");
  await fs.rename(path.join(sourceDir, "dot.txt"), path.join(sourceDir, ".dot-file"));
  const dotfilePlan = await callMcpRaw(server.url, grant.payload.token, "pact.sharedspace.sync.plan", {
    workspaceId,
    mountRef,
    targetPath: "mirror-dot",
    deleteExtraneous: true
  }, 1010);
  assert.equal(dotfilePlan.status, 200);
  const dotfileError = assertMcpCallFailed(dotfilePlan, 400);
  assert.equal(dotfileError?.data?.status, 400);
  await fs.unlink(path.join(sourceDir, ".dot-file"));

  const invalidSourcePlan = await callMcpRaw(server.url, grant.payload.token, "pact.sharedspace.sync.plan", {
    workspaceId,
    sourcePath: sourceDir,
    targetPath: "mirror-bad",
    deleteExtraneous: true
  }, 1011);
  assert.equal(invalidSourcePlan.status, 200);
  const invalidSourceError = assertMcpCallFailed(invalidSourcePlan, 400);
  assert.equal(invalidSourceError?.data?.status, 400);

  await fs.writeFile(path.join(sourceDir, "one.txt"), "local one changed\n", "utf8");
  await fs.rm(path.join(sourceDir, "nested", "two.txt"));
  await fs.writeFile(path.join(sourceDir, "three.txt"), "local three\n", "utf8");

  const secondPlan = await callMcp(server.url, grant.payload.token, "pact.sharedspace.sync.plan", {
    workspaceId,
    mountRef,
    targetPath: "mirror",
    deleteExtraneous: true
  });
  assert.equal(secondPlan.ok, true);
  assert.equal(secondPlan.summary.write, 1);
  assert.equal(secondPlan.summary.create, 1);
  assert.equal(secondPlan.summary.delete, 1);
  assert.ok(secondPlan.actions.some((action) => action.action === "delete" && action.targetPath === "mirror/nested/two.txt"));

  const secondApply = await callMcp(server.url, grant.payload.token, "pact.sharedspace.sync.apply", {
    workspaceId,
    mountRef,
    targetPath: "mirror",
    deleteExtraneous: true
  });
  assert.equal(secondApply.ok, true);
  assert.equal(secondApply.summary.applied, 3);
  assert.ok(secondApply.stateCommit?.commitId);
  assert.notEqual(secondApply.stateCommit.afterRoot, firstApply.stateCommit.afterRoot);

  const changedDownload = await callMcp(server.url, grant.payload.token, "pact.workspace.file.download", {
    workspaceId,
    path: "mirror/one.txt"
  });
  assert.equal(changedDownload.content, "local one changed\n");
  const deletedStat = await callMcp(server.url, grant.payload.token, "pact.workspace.file.stat", {
    workspaceId,
    path: "mirror/nested/two.txt"
  });
  assert.equal(deletedStat.exists, false);
  assert.equal(deletedStat.cacheReceipt?.hit, false);
  assert.ok(deletedStat.cacheReceipt?.proofHash);

  const largeDir = path.join(sourceDir, "large-sync");
  const largeSource = path.join(largeDir, "payload.txt");
  await fs.mkdir(largeDir, { recursive: true });
  await fs.writeFile(largeSource, "x".repeat(1024 * 1024 * 2), "utf8");
  const largeConnected = await callMcp(server.url, grant.payload.token, "pact.sharedspace.localDir.connect", {
    workspaceId,
    sourcePath: largeDir,
    targetPath: "mirror-large"
  });
  const largeMountRef = largeConnected.mount.mountRef;
  const largePlan = await callMcp(server.url, grant.payload.token, "pact.sharedspace.sync.plan", {
    workspaceId,
    mountRef: largeMountRef,
    targetPath: "mirror-large",
    deleteExtraneous: true
  });
  assert.equal(largePlan.ok, true);
  assert.equal(largePlan.summary.create, 1);
  const largeApply = await callMcpWithApproval(server.url, grant.payload.token, "pact.sharedspace.sync.apply", {
    workspaceId,
    mountRef: largeMountRef,
    targetPath: "mirror-large",
    deleteExtraneous: true
  });
  assert.equal(largeApply.ok, true);
  assert.equal(largeApply.summary.applied, 1);

  const stalePlan = await callMcp(server.url, grant.payload.token, "pact.sharedspace.sync.plan", {
    workspaceId,
    mountRef: largeMountRef,
    targetPath: "mirror-large",
    deleteExtraneous: true
  });
  assert.equal(stalePlan.summary.noop, 1);
  await fs.unlink(largeSource);
  const staleApply = await callMcpRaw(server.url, grant.payload.token, "pact.sharedspace.sync.apply", {
    workspaceId,
    mountRef: largeMountRef,
    targetPath: "mirror-large",
    deleteExtraneous: true
  }, 1003);
  assert.equal(staleApply.status, 200);
  if (staleApply.payload.error) {
    assert.equal(staleApply.payload.error.data?.status, 409);
  } else {
    const staleApplyPayload = extractMcpPayload(staleApply);
    assert.equal(staleApplyPayload?.ok, true);
  }

  const planAudit = await callMcp(server.url, grant.payload.token, "pact.workspace.audit.query", {
    operationId: "sharedspace.sync.plan",
    limit: 20
  });
  assertAuditTrail(planAudit, "sharedspace.sync.plan", {
    label: "sync plan audit query",
    minCount: 2,
    readOnly: true,
    sourcePath: sourceDir,
    targetPath: "mirror",
    expectInputScope: false
  });

  const applyAudit = await callMcp(server.url, grant.payload.token, "pact.workspace.audit.query", {
    operationId: "sharedspace.sync.apply",
    limit: 20
  });
  assertAuditTrail(applyAudit, "sharedspace.sync.apply", {
    label: "sync apply audit query",
    minCount: 2,
    readOnly: false,
    sourcePath: sourceDir,
    targetPath: "mirror"
  });

  const applyHistory = await callMcp(server.url, grant.payload.token, "pact.workspace.operation.history", {
    operationId: "sharedspace.sync.apply",
    limit: 20
  });
  assertAuditTrail(applyHistory, "sharedspace.sync.apply", {
    label: "sync apply operation history",
    minCount: 2,
    readOnly: false,
    sourcePath: sourceDir,
    targetPath: "mirror"
  });

  for (const operationId of [
    "sharedspace.localDir.connect",
    "sharedspace.item.list",
    "sharedspace.file.read",
    "sharedspace.file.write",
    "sharedspace.item.delete"
  ]) {
    const audit = await callMcp(server.url, grant.payload.token, "pact.workspace.audit.query", {
      operationId,
      limit: 20
    });
    assertAuditTrail(audit, operationId, {
      label: `${operationId} audit query`,
      minCount: 1,
      readOnly: operationId === "sharedspace.item.list" || operationId === "sharedspace.file.read",
      sourcePath: sourceDir,
      targetPath: operationId === "sharedspace.localDir.connect" ? "mirror" : "mirror/written.txt",
      expectInputScope: operationId !== "sharedspace.item.list" && operationId !== "sharedspace.file.read"
    });
  }

  const revertScope = await callMcpWithApproval(server.url, grant.payload.token, "pact.workspace.operation.revert.scope", {
    operationId: "sharedspace.sync.apply",
    limit: 20,
    confirm: true
  });
  assert.equal(revertScope.canApply, true, "sync apply history should be eligible for manual revert planning");
  assert.ok(revertScope.reversibleCount >= 2, "sync apply history should expose reversible audit entries");
  assert.ok(revertScope.scope.every((item) => item.operationId === "sharedspace.sync.apply"));
  assert.ok(revertScope.scope.every((item) => item.inputHash));
  assert.ok(revertScope.actions.every((action) => action.action === "manual_revert_required"));

  if (process.platform !== "win32") {
    await fs.symlink(path.join(sourceDir, "one.txt"), path.join(sourceDir, "linked.txt"));
    const symlinkPlan = await callMcpRaw(server.url, grant.payload.token, "pact.sharedspace.sync.plan", {
      workspaceId,
      mountRef,
      targetPath: "mirror"
    }, 999);
    assert.equal(symlinkPlan.status, 200);
    assert.equal(symlinkPlan.payload.error?.data?.status, 400);
  }

  console.log("workspace local-dir sync verification passed");
} finally {
  if (server?.close) {
    await server.close();
  }
  await fs.rm(userDataPath, { recursive: true, force: true }).catch(() => {});
  await fs.rm(outsideSourceDir, { recursive: true, force: true }).catch(() => {});
  restoreCapabilityKernelEnv();
}
