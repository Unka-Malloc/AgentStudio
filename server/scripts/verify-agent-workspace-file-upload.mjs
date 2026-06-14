#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startHttpServer } from "../services/server-runtime/http-server.mjs";
import { installAuthenticatedFetch } from "./test-auth-helper.mjs";

async function fetchJsonResponse(url, options = {}) {
  const response = await fetch(url, options);
  const rawText = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    payload: rawText.trim() ? JSON.parse(rawText) : {}
  };
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

async function subscribeMcpOperationReplies(baseUrl, token) {
  const controller = new AbortController();
  const response = await fetch(`${baseUrl}/mcp`, {
    method: "GET",
    headers: apiKeyHeaders(token),
    signal: controller.signal
  });
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const replies = [];
  const waiters = [];

  function resolveWaiters() {
    for (const waiter of [...waiters]) {
      const match = replies.find(waiter.predicate);
      if (!match) {
        continue;
      }
      clearTimeout(waiter.timer);
      waiters.splice(waiters.indexOf(waiter), 1);
      waiter.resolve(match);
    }
  }

  function pushEvent(rawEvent) {
    const dataLines = rawEvent
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trim());
    if (!dataLines.length) {
      return;
    }
    let parsed = null;
    try {
      parsed = JSON.parse(dataLines.join("\n"));
    } catch {
      return;
    }
    if (parsed.method === "notifications/pact/operation_reply") {
      replies.push(parsed);
      resolveWaiters();
    }
  }

  const pump = (async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split(/\r?\n\r?\n/);
        buffer = events.pop() || "";
        for (const event of events) {
          pushEvent(event);
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        throw error;
      }
    }
  })();

  return {
    waitFor(predicate, timeoutMs = 5000) {
      const existing = replies.find(predicate);
      if (existing) {
        return Promise.resolve(existing);
      }
      return new Promise((resolve, reject) => {
        const waiter = {
          predicate,
          resolve,
          timer: setTimeout(() => {
            const index = waiters.indexOf(waiter);
            if (index >= 0) {
              waiters.splice(index, 1);
            }
            reject(new Error("Timed out waiting for MCP operation_reply."));
          }, timeoutMs)
        };
        waiters.push(waiter);
      });
    },
    async close() {
      controller.abort();
      try {
        await pump;
      } catch {
        // Expected when the SSE fetch is aborted.
      }
    }
  };
}

async function callWorkspaceMcp(baseUrl, token, operation, input = {}, id = 1, toolName = "pact.sharedspace") {
  const response = await fetchJsonResponse(`${baseUrl}/mcp`, {
    method: "POST",
    headers: apiKeyHeaders(token),
    body: JSON.stringify(mcpRequest("tools/call", {
      name: toolName,
      arguments: {
        apiVersion: "v0.0.1:mcp:interface-1",
        operation,
        input
      }
    }, id))
  });
  assert.equal(response.status, 200);
  assert.equal(response.payload.error, undefined, JSON.stringify(response.payload.error || {}, null, 2));
  return response.payload.result.structuredContent.payload;
}

async function resolvePendingWorkspaceOperation(baseUrl, pendingOperationId, {
  resolution = "approved",
  resolvedBy = "verify-agent-workspace-file-upload",
  reason = "Auto-resolve pending operation in MCP workspace verifier."
} = {}) {
  const result = await fetchJsonResponse(
    `${baseUrl}/api/tool-management/v1/pending-operations/${encodeURIComponent(pendingOperationId)}/resolve`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-pact-safety-confirm": "true"
      },
      body: JSON.stringify({ resolution, resolvedBy, reason })
    }
  );
  assert.equal(result.status, 200, JSON.stringify(result.payload, null, 2));
  return result.payload;
}

async function callWorkspaceMcpWithApproval(baseUrl, token, operation, input = {}, id = 1, toolName = "pact.sharedspace") {
  const payload = await callWorkspaceMcp(baseUrl, token, operation, input, id, toolName);
  if (payload?.status === "pending_approval" && payload?.pendingOperation?.pendingOperationId) {
    const resolved = await resolvePendingWorkspaceOperation(baseUrl, payload.pendingOperation.pendingOperationId, {
      resolvedBy: "verify-agent-workspace-file-upload"
    });
    assert.equal(resolved.pendingOperation?.status, "completed", JSON.stringify(resolved, null, 2));
    assert.equal(typeof resolved.result, "object", JSON.stringify(resolved, null, 2));
    return resolved.result;
  }
  return payload;
}

const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-agent-workspace-files-"));
const localDownloadPath = path.join(userDataPath, "downloaded-a.txt");
const server = await startHttpServer({
  userDataPath,
  distPath: "",
  port: 0,
  runtimeOptions: { profile: "minimal" }
});
await installAuthenticatedFetch(server);

let operationReplies = null;

try {
  const localGrant = await fetchJsonResponse(`${server.url}/api/mcp/local-grant`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-pact-safety-confirm": "true" },
    body: JSON.stringify({
      targets: ["codex"],
      label: "verify-mcp-workspace-files",
      grantMode: "maintain",
      maxRisk: "repair_write",
      scopes: [
        "workspace:read",
        "workspace:write",
        "workspace:maintain",
        "knowledge:read",
        "knowledge:write",
        "storage:read",
        "storage:write"
      ],
      toolsets: ["pact.agent.workspace", "pact.storage.read", "pact.storage.write"]
    })
  });
  assert.equal(localGrant.status, 201);
  assert.equal(localGrant.payload.ok, true);
  assert.ok(localGrant.payload.token);
  assert.equal(localGrant.payload.scopes.includes("workspace:read"), true);
  assert.equal(localGrant.payload.scopes.includes("workspace:write"), true);
  assert.equal(localGrant.payload.scopes.includes("workspace:maintain"), true);
  assert.equal(localGrant.payload.scopes.includes("knowledge:write"), true);
  assert.equal(localGrant.payload.scopes.includes("storage:write"), true);
  assert.equal(localGrant.payload.toolsets.includes("pact.agent.workspace"), true);
  assert.equal(localGrant.payload.toolsets.includes("pact.storage.write"), true);

  const tools = await fetchJsonResponse(`${server.url}/mcp`, {
    method: "POST",
    headers: apiKeyHeaders(localGrant.payload.token),
    body: JSON.stringify(mcpRequest("tools/list", {}, 2))
  });
  assert.equal(tools.status, 200);
  assert.ok(tools.payload.result.tools.some((tool) => tool.name === "pact.sharedspace"));

  operationReplies = await subscribeMcpOperationReplies(server.url, localGrant.payload.token);

  const created = await callWorkspaceMcp(
    server.url,
    localGrant.payload.token,
    "pact.workspace.create",
    {
      title: "MCP Workspace File Flow",
      objective: "Verify workspace folder, file upload, stat, and download through MCP."
    },
    3
  );
  const workspace = created.workspace;
  const workspaceMetadata = workspace.metadata && typeof workspace.metadata === "object" ? workspace.metadata : {};
  const workspaceId = workspace.workspaceId || workspace.workspaceRef;
  assert.ok(workspaceId);
  assert.equal(Boolean(workspace.workspaceRef), true, "workspace.create should expose a public workspaceRef");
  assert.equal(/^workspace-\d+$/.test(workspace.workspaceRef), true);
  assert.equal(Object.prototype.hasOwnProperty.call(workspace, "workspaceId"), false, "workspace public contract should not expose internal workspaceId");
  assert.equal(Object.prototype.hasOwnProperty.call(workspaceMetadata, "defaultAdminUserId"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(workspaceMetadata, "adminUserIds"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(workspace, "ownerUserId"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(workspaceMetadata, "userId"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(workspaceMetadata, "userIds"), false);
  assert.equal(JSON.stringify(workspace).includes(localGrant.payload.grant.id), false, "public workspace payload should not leak internal grant/user ids");

  const folderPath = "files/mcp-demo";
  const folder = await callWorkspaceMcp(
    server.url,
    localGrant.payload.token,
    "pact.workspace.folder.create",
    {
      workspaceId,
      folderPath
    },
    4
  );
  assert.equal(folder.ok, true);
  assert.equal(folder.folder.relativePath, folderPath);
  assert.equal(folder.folder.type, "directory");

  const beforeUpload = await callWorkspaceMcp(
    server.url,
    localGrant.payload.token,
    "pact.workspace.files.list",
    {
      workspaceId,
      path: "files",
      recursive: true
    },
    5
  );
  assert.equal(beforeUpload.ok, true);
  assert.ok(beforeUpload.paths.includes(folderPath));

  const sampleContent = "hello from Pact MCP workspace file flow\n";
  const upload = await callWorkspaceMcp(
    server.url,
    localGrant.payload.token,
    "pact.workspace.file.upload",
    {
      workspaceId,
      folderPath,
      fileName: "a.txt",
      content: sampleContent,
      status: "draft",
      createdBy: "verify-mcp-workspace-files"
    },
    6
  );
  assert.equal(upload.ok, true);
  assert.ok(upload.stateCommit?.commitId, "upload should return a state commit");
  assert.ok(upload.stateCommit?.eventHash, "upload should return an event hash");
  assert.ok(upload.stateCommit?.afterRoot, "upload should return an afterRoot");
  assert.ok(upload.stateCommit?.contentRefs?.length >= 2, "upload should return content refs");
  assert.ok(upload.checkpoint?.treeId, "upload should create a workspace_files checkpoint tree");
  assert.ok(upload.checkpoint?.nodeId, "upload should create a restorable checkpoint node");
  assert.equal(upload.ingestReceipt?.status, "archived");
  assert.ok(upload.ingestReceipt?.uploadSessionId, "upload should return an LSM ingest session id");
  assert.ok(upload.ingestReceipt?.segmentId, "upload should return an immutable ingest segment id");
  assert.ok(upload.ingestReceipt?.manifestRootCid, "upload should return an ingest manifest root");
  assert.equal(upload.file.relativePath, `${folderPath}/a.txt`);
  assert.equal(upload.file.type, "file");
  assert.equal(upload.artifact.title, "a.txt");
  assert.equal(upload.artifact.content, sampleContent);
  const uploadReply = await operationReplies.waitFor((event) =>
    event.params?.operation === "pact.workspace.file.upload" &&
    event.params?.status === "completed"
  );
  assert.equal(uploadReply.params.target.targetKind, "sharedspace");
  assert.ok(uploadReply.params.target.targetRef || uploadReply.params.target.workspaceId);

  const afterUpload = await callWorkspaceMcp(
    server.url,
    localGrant.payload.token,
    "pact.workspace.files.list",
    {
      workspaceId,
      path: "files",
      recursive: true
    },
    7
  );
  assert.equal(afterUpload.cacheReceipt?.cacheFamily, "merkle-radix-compatible");
  assert.equal(afterUpload.cacheReceipt?.hit, true);
  assert.ok(afterUpload.cacheReceipt?.indexRootCid);
  assert.ok(afterUpload.cacheReceipt?.proofHash);
  assert.ok(afterUpload.paths.includes(`${folderPath}/a.txt`));

  const stat = await callWorkspaceMcp(
    server.url,
    localGrant.payload.token,
    "pact.workspace.file.stat",
    {
      workspaceId,
      path: `${folderPath}/a.txt`
    },
    8
  );
  assert.equal(stat.exists, true);
  assert.equal(stat.cacheReceipt?.hit, true);
  assert.ok(stat.cacheReceipt?.valueRoot);
  assert.ok(stat.cacheReceipt?.proofHash);
  assert.equal(stat.file.relativePath, `${folderPath}/a.txt`);
  assert.equal(stat.file.sizeBytes, Buffer.byteLength(sampleContent));
  assert.match(stat.file.contentSha256, /^[a-f0-9]{64}$/);

  const missingStat = await callWorkspaceMcp(
    server.url,
    localGrant.payload.token,
    "pact.workspace.file.stat",
    {
      workspaceId,
      path: `${folderPath}/missing.txt`
    },
    9
  );
  assert.equal(missingStat.ok, true);
  assert.equal(missingStat.exists, false);
  assert.equal(missingStat.cacheReceipt?.hit, false);
  assert.ok(missingStat.cacheReceipt?.proofHash);
  assert.equal(missingStat.file.relativePath, `${folderPath}/missing.txt`);

  const download = await callWorkspaceMcp(
    server.url,
    localGrant.payload.token,
    "pact.workspace.file.download",
    {
      workspaceId,
      path: `${folderPath}/a.txt`
    },
    10
  );
  assert.equal(download.ok, true);
  assert.equal(download.file.relativePath, `${folderPath}/a.txt`);
  assert.equal(download.cacheReceipt?.cacheFamily, "merkle-radix-compatible");
  assert.equal(download.cacheReceipt?.hit, true);
  assert.ok(download.cacheReceipt?.indexRootCid);
  assert.ok(download.cacheReceipt?.valueRoot);
  assert.ok(download.cacheReceipt?.proofHash);
  assert.equal(download.content, sampleContent);
  await fs.writeFile(localDownloadPath, Buffer.from(download.contentBase64, "base64"));
  assert.equal(await fs.readFile(localDownloadPath, "utf8"), sampleContent);

  const patchedContent = "hello from Pact MCP patched workspace file flow\n";
  const patch = await callWorkspaceMcp(
    server.url,
    localGrant.payload.token,
    "pact.workspace.file.patch",
    {
      workspaceId,
      path: `${folderPath}/a.txt`,
      expectedSha256: stat.file.contentSha256,
      hunks: [{
        oldText: sampleContent,
        newText: patchedContent
      }]
    },
    11
  );
  assert.equal(patch.ok, true);
  assert.ok(patch.stateCommit?.commitId, "patch should return a state commit");
  assert.notEqual(patch.stateCommit.afterRoot, upload.stateCommit.afterRoot);
  assert.equal(patch.file.relativePath, `${folderPath}/a.txt`);
  assert.equal(patch.beforeSha256, stat.file.contentSha256);
  assert.match(patch.afterSha256, /^[a-f0-9]{64}$/);
  assert.notEqual(patch.afterSha256, patch.beforeSha256);

  const patchedDownload = await callWorkspaceMcp(
    server.url,
    localGrant.payload.token,
    "pact.workspace.file.download",
    {
      workspaceId,
      path: `${folderPath}/a.txt`
    },
    12
  );
  assert.equal(patchedDownload.ok, true);
  assert.equal(patchedDownload.content, patchedContent);

  const checkpointTrees = await callWorkspaceMcp(
    server.url,
    localGrant.payload.token,
    "pact.workspace.checkpoint.tree.list",
    {
      workspaceId,
      kind: "workspace_files",
      limit: 10
    },
    13
  );
  assert.equal(checkpointTrees.count >= 1, true, JSON.stringify(checkpointTrees, null, 2));
  assert.ok(checkpointTrees.items.some((item) => item.treeId === upload.checkpoint.treeId));
  const allCheckpointTrees = await callWorkspaceMcp(
    server.url,
    localGrant.payload.token,
    "pact.workspace.checkpoint.tree.list",
    {
      limit: 10
    },
    14
  );
  assert.ok(
    allCheckpointTrees.items.some((item) => item.treeId === upload.checkpoint.treeId),
    JSON.stringify({ filtered: checkpointTrees, all: allCheckpointTrees, checkpoint: upload.checkpoint }, null, 2)
  );

  const checkpointTree = await callWorkspaceMcp(
    server.url,
    localGrant.payload.token,
    "pact.workspace.checkpoint.node.get",
    {
      treeId: upload.checkpoint.treeId
    },
    15
  );
  const uploadCheckpointNode = checkpointTree.nodes?.[upload.checkpoint.nodeId];
  assert.equal(typeof checkpointTree.kind, "string", JSON.stringify(checkpointTree, null, 2));
  assert.equal(/workspace_[A-Za-z0-9_]+/.test(checkpointTree.kind), false, JSON.stringify(checkpointTree, null, 2));
  assert.equal(/^workspace-[0-9]+$/.test(String(checkpointTree.ownerId || "")), true, JSON.stringify(checkpointTree, null, 2));
  assert.ok(uploadCheckpointNode, "checkpoint tree should contain the upload snapshot node");
  assert.ok(uploadCheckpointNode.metadata?.workspaceFileSnapshot, "checkpoint node should carry a file snapshot");
  assert.equal(
    Array.isArray(uploadCheckpointNode.metadata.workspaceFileSnapshot.files),
    true,
    JSON.stringify(uploadCheckpointNode, null, 2)
  );

  const restorePreview = await callWorkspaceMcpWithApproval(
    server.url,
    localGrant.payload.token,
    "pact.workspace.checkpoint.restore.preview",
    {
      treeId: upload.checkpoint.treeId,
      nodeId: upload.checkpoint.nodeId,
      workspaceId,
      reason: "verify MCP workspace checkpoint restore preview"
    },
    16
  );
  assert.equal(Object.prototype.hasOwnProperty.call(restorePreview, "policy"), false, "restore preview public payload should not expose policy internals");
  if (Object.prototype.hasOwnProperty.call(restorePreview, "ok")) {
    assert.equal(restorePreview.ok, true);
  }
  assert.equal(
    !("status" in restorePreview) || typeof restorePreview.status === "string",
    true,
    JSON.stringify(restorePreview, null, 2)
  );
  const previewActions = [
    ...(Array.isArray(restorePreview.actions) ? restorePreview.actions : []),
    ...(Array.isArray(restorePreview.workspaceFileRestore?.actions) ? restorePreview.workspaceFileRestore.actions : [])
  ];
  assert.ok(previewActions.some((item) =>
    item.action === "write" && item.path === `${folderPath}/a.txt`
  ));

  const restored = await callWorkspaceMcpWithApproval(
    server.url,
    localGrant.payload.token,
    "pact.workspace.checkpoint.restore",
    {
      treeId: upload.checkpoint.treeId,
      nodeId: upload.checkpoint.nodeId,
      workspaceId,
      reason: "verify MCP workspace checkpoint restore"
    },
    17
  );
  const restoredActions = [
    ...(Array.isArray(restored.appliedActions) ? restored.appliedActions : []),
    ...(Array.isArray(restored.workspaceFileRestore?.appliedActions) ? restored.workspaceFileRestore.appliedActions : [])
  ];
  assert.ok(restoredActions.some((item) =>
    item.action === "write" && item.path === `${folderPath}/a.txt`
  ));
  const stateCommit = restored.stateCommit || restored.workspaceFileRestore?.stateCommit;
  assert.ok(stateCommit?.commitId);
  const restoreReply = await operationReplies.waitFor((event) =>
    ["workspace.checkpoint.restore", "pact.workspace.checkpoint.restore"].includes(event.params?.operation) &&
    event.params?.status === "completed"
  );
  assert.equal(restoreReply.params.target.targetKind, "sharedspace");

  const restoredDownload = await callWorkspaceMcp(
    server.url,
    localGrant.payload.token,
    "pact.workspace.file.download",
    {
      workspaceId,
      path: `${folderPath}/a.txt`
    },
    18
  );
  assert.equal(restoredDownload.ok, true);
  assert.equal(restoredDownload.content, sampleContent);
  assert.equal(restoredDownload.cacheReceipt?.cacheFamily, "merkle-radix-compatible");
  assert.equal(restoredDownload.cacheReceipt?.hit, true);
  assert.ok(restoredDownload.cacheReceipt?.proofHash);

  const readOnlyGrant = await fetchJsonResponse(`${server.url}/api/mcp/local-grant`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      targets: ["codex"],
      label: "verify-mcp-workspace-files-readonly",
      scopes: ["knowledge:read", "storage:read"]
    })
  });
  assert.equal(readOnlyGrant.status, 201);

  const deniedUpload = await fetchJsonResponse(`${server.url}/mcp`, {
    method: "POST",
    headers: apiKeyHeaders(readOnlyGrant.payload.token),
    body: JSON.stringify(mcpRequest("tools/call", {
      name: "pact.sharedspace",
      arguments: {
        apiVersion: "v0.0.1:mcp:interface-1",
        operation: "pact.workspace.file.upload",
        input: {
          workspaceId,
          folderPath,
          fileName: "denied.txt",
          content: "denied"
        }
      }
    }, 19))
  });
  assert.equal(deniedUpload.status, 403);
  assert.equal(deniedUpload.payload.error.data.code, "missing_capabilities");

  console.log("agent-workspace-file-upload verification passed");
} finally {
  if (operationReplies) {
    await operationReplies.close();
  }
  await server.close();
  await fs.rm(userDataPath, { recursive: true, force: true });
}
