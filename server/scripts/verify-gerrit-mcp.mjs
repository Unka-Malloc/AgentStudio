import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SERVER_API_OPERATIONS } from "../platform/common/operation-dispatcher/operation-registry.mjs";
import { createToolCatalog } from "../platform/specialized/capabilities/tools/tool-management-core/catalog.mjs";
import {
  executeGerritCommonOperation,
  GERRIT_ACTIONS,
  uploadGerritGitChange
} from "../platform/specialized/capabilities/code-review/gerrit/index.mjs";
import { startHttpServer } from "../services/server-runtime/http-server.mjs";
import { installAuthenticatedFetch } from "./test-auth-helper.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const rawText = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    payload: rawText.trim() ? JSON.parse(rawText) : {}
  };
}

function bearerHeaders(token) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`
  };
}

function mcpHeaders(token) {
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

let mcpRequestId = 100;

async function callMcpOperation({ serverUrl, token, outlet = "pact.codespace", operation, input = {} }) {
  mcpRequestId += 1;
  return fetchJson(`${serverUrl}/mcp`, {
    method: "POST",
    headers: mcpHeaders(token),
    body: JSON.stringify(mcpRequest("tools/call", {
      name: outlet,
      arguments: {
        apiVersion: "v0.0.1:mcp:interface-1",
        operation,
        input,
        clientVersion: "verify-gerrit-mcp"
      }
    }, mcpRequestId))
  });
}

async function subscribeMcpOperationReplies(serverUrl, token) {
  const controller = new AbortController();
  const response = await fetch(`${serverUrl}/mcp`, {
    method: "GET",
    headers: mcpHeaders(token),
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
    waitFor(predicate, timeoutMs = 10000) {
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
        // Expected when aborting the SSE stream.
      }
    }
  };
}

function structuredPayload(response) {
  return response.payload?.result?.structuredContent?.payload;
}

function assertMcpToolOk(response, operation) {
  assert.equal(response.status, 200);
  assert.equal(response.payload.error, undefined, JSON.stringify(response.payload.error || {}));
  assert.equal(response.payload.result.structuredContent.operation, operation);
  const payload = structuredPayload(response);
  assert.equal(payload?.ok, true, JSON.stringify(payload || {}));
  return payload;
}

function sampleGerritInput(mode, action) {
  const input = {
    action,
    dryRun: true,
    project: "All-Projects",
    branch: "master",
    changeId: "All-Projects~1",
    revision: "current",
    fileId: "COMMIT_MSG",
    accountId: "1000000",
    reviewer: "admin",
    labelId: "Code-Review",
    commentId: "00000000_00000000",
    draftId: "00000000_00000000",
    query: "status:open",
    limit: 1,
    message: "Pact Gerrit MCP dry-run verification",
    topic: "pact-gerrit-mcp-verify",
    hashtags: ["pact-verify"],
    values: { add: { pact_verify: "true" } },
    description: "Pact Gerrit MCP dry-run verification",
    body: "Pact Gerrit MCP dry-run verification",
    labels: { "Code-Review": 1 },
    comments: {},
    comment: { line: 1, message: "Pact Gerrit MCP dry-run verification" },
    content: "Pact Gerrit MCP dry-run verification\n",
    user: "admin",
    reason: "Pact Gerrit MCP dry-run verification",
    destination: "master",
    destination_branch: "master",
    base: "master",
    notify: "NONE"
  };
  if (mode === "write" && action === "changes.create") {
    input.subject = "Pact Gerrit MCP dry-run change";
    input.status = "NEW";
  }
  if (mode === "maintain") {
    input.confirm = true;
    if (action === "projects.create") {
      input.project = "pact-gerrit-mcp-dry-run";
    }
    if (action === "branches.create" || action === "branches.delete") {
      input.project = "All-Projects";
      input.branch = "pact-gerrit-mcp-dry-run";
    }
  }
  return input;
}

async function verifyMcpDryRunActionMatrix({ serverUrl, token, mode, operation, actions }) {
  for (const action of actions) {
    const response = await callMcpOperation({
      serverUrl,
      token,
      operation,
      input: sampleGerritInput(mode, action)
    });
    const payload = assertMcpToolOk(response, operation);
    assert.equal(payload.action, action);
    assert.equal(payload.mode, mode);
    assert.equal(payload.dryRun, true);
    assert.equal(payload.data?.method && payload.data?.path ? true : false, true, `missing dry-run plan for ${action}`);
  }
}

function configureLocalGerritCredentialsForVerify() {
  const baseUrl = String(process.env.PACT_GERRIT_BASE_URL || "http://127.0.0.1:18080").replace(/\/+$/, "");
  if (!["http://127.0.0.1:18080", "http://localhost:18080"].includes(baseUrl)) {
    return;
  }
  if (!process.env.PACT_GERRIT_USERNAME) {
    process.env.PACT_GERRIT_USERNAME = "admin";
  }
  if (!process.env.PACT_GERRIT_HTTP_PASSWORD) {
    process.env.PACT_GERRIT_HTTP_PASSWORD = "secret";
  }
}

async function runProcess(command, args = [], options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || repoRoot,
    env: { ...process.env, ...(options.env || {}) },
    encoding: "utf8",
    stdio: options.stdio || "pipe"
  });
  if (result.status !== 0 && options.allowFailure !== true) {
    throw new Error(`${command} ${args.join(" ")} failed:\n${result.stdout || ""}${result.stderr || ""}`);
  }
  return result;
}

function localGerritGitUrl(project) {
  configureLocalGerritCredentialsForVerify();
  const baseUrl = String(process.env.PACT_GERRIT_BASE_URL || "http://127.0.0.1:18080").replace(/\/+$/, "");
  const url = new URL(`/a/${project}`, `${baseUrl}/`);
  url.username = process.env.PACT_GERRIT_USERNAME || "admin";
  url.password = process.env.PACT_GERRIT_HTTP_PASSWORD || "secret";
  return url.toString();
}

async function createUploadWorktree(project, suffix) {
  const workRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pact-gerrit-upload-worktree-"));
  const worktreePath = path.join(workRoot, "repo");
  await runProcess("git", ["clone", localGerritGitUrl(project), worktreePath]);
  await runProcess("git", ["config", "user.name", "Pact MCP Verify"], { cwd: worktreePath });
  await runProcess("git", ["config", "user.email", "pact-mcp-verify@example.com"], { cwd: worktreePath });
  const fileName = `pact-mcp-upload-${suffix}.txt`;
  const content = `Pact MCP Gerrit upload verification ${suffix}\n`;
  await fs.writeFile(path.join(worktreePath, fileName), content);
  await runProcess("git", ["add", fileName], { cwd: worktreePath });
  const changeId = `I${crypto.randomBytes(20).toString("hex")}`;
  await runProcess("git", [
    "commit",
    "-m",
    `Pact MCP Gerrit upload verification ${suffix}\n\nChange-Id: ${changeId}`
  ], { cwd: worktreePath });
  const head = (await runProcess("git", ["rev-parse", "HEAD"], { cwd: worktreePath })).stdout.trim();
  return {
    workRoot,
    worktreePath,
    fileName,
    changeId,
    head
  };
}

async function runLiveGerritMcpScenario({ serverUrl, readToken, writeToken, maintainToken, liveVersion }) {
  configureLocalGerritCredentialsForVerify();
  const suffix = Date.now().toString(36);
  const project = `pact-mcp-verify-${suffix}`;
  const topic = `pact-mcp-${suffix}`;
  const createProject = assertMcpToolOk(await callMcpOperation({
    serverUrl,
    token: maintainToken,
    operation: "pact.gerrit.maintain",
    input: {
      action: "projects.create",
      project,
      create_empty_commit: true,
      description: "Pact Gerrit MCP live verification",
      confirm: true
    }
  }), "pact.gerrit.maintain");
  assert.equal(createProject.data?.name || createProject.data?.id, project);

  const readVersion = assertMcpToolOk(await callMcpOperation({
    serverUrl,
    token: readToken,
    outlet: "pact.codespace",
    operation: "pact.gerrit.read",
    input: { action: "server.version" }
  }), "pact.gerrit.read");
  assert.equal(String(readVersion.data), liveVersion);

  const projectRead = assertMcpToolOk(await callMcpOperation({
    serverUrl,
    token: readToken,
    operation: "pact.gerrit.read",
    input: { action: "projects.get", project }
  }), "pact.gerrit.read");
  assert.equal(projectRead.data?.name || projectRead.data?.id, project);

  const createChange = assertMcpToolOk(await callMcpOperation({
    serverUrl,
    token: writeToken,
    operation: "pact.gerrit.write",
    input: {
      action: "changes.create",
      project,
      branch: "master",
      subject: `Pact Gerrit MCP live verification ${suffix}`,
      topic,
      status: "NEW"
    }
  }), "pact.gerrit.write");
  const changeId = createChange.data?.id;
  assert.ok(changeId, "live Gerrit change id is required");

  const topicSet = assertMcpToolOk(await callMcpOperation({
    serverUrl,
    token: writeToken,
    operation: "pact.gerrit.write",
    input: { action: "changes.topic.set", changeId, topic: `${topic}-updated` }
  }), "pact.gerrit.write");
  assert.equal(String(topicSet.data || ""), `${topic}-updated`);

  const hashtags = assertMcpToolOk(await callMcpOperation({
    serverUrl,
    token: writeToken,
    operation: "pact.gerrit.write",
    input: { action: "changes.hashtags.set", changeId, hashtags: ["pact-verify", "mcp"] }
  }), "pact.gerrit.write");
  assert.equal(Array.isArray(hashtags.data), true);

  const review = assertMcpToolOk(await callMcpOperation({
    serverUrl,
    token: writeToken,
    operation: "pact.gerrit.write",
    input: {
      action: "revisions.review.set",
      changeId,
      revision: "current",
      review: {
        message: "Pact Gerrit MCP live review verification",
        labels: { "Code-Review": 1 },
        notify: "NONE"
      }
    }
  }), "pact.gerrit.write");
  assert.equal(review.data?.labels?.["Code-Review"], 1);

  const detail = assertMcpToolOk(await callMcpOperation({
    serverUrl,
    token: readToken,
    operation: "pact.gerrit.read",
    input: { action: "changes.detail", changeId }
  }), "pact.gerrit.read");
  assert.equal(detail.data?.id, changeId);

  let operationReplies = null;
  let uploadWorktree = null;
  let uploadedChangeId = "";
  try {
    operationReplies = await subscribeMcpOperationReplies(serverUrl, maintainToken);
    uploadWorktree = await createUploadWorktree(project, suffix);
    const upload = assertMcpToolOk(await callMcpOperation({
      serverUrl,
      token: maintainToken,
      operation: "pact.workspace.code.change.upload",
      input: {
        worktreePath: uploadWorktree.worktreePath,
        branch: "master",
        remote: "origin",
        project,
        baseUrl: process.env.PACT_GERRIT_BASE_URL || "http://127.0.0.1:18080",
        topic: `${topic}-git-upload`,
        confirm: true,
        confirmationTimeoutMs: 60000,
        confirmationIntervalMs: 500
      }
    }), "pact.workspace.code.change.upload");
    assert.equal(upload.ok, true);
    assert.equal(upload.head, uploadWorktree.head);
    assert.equal(upload.completion?.confirmed, true);
    assert.equal(upload.completion?.currentRevision, uploadWorktree.head);
    assert.ok(upload.changeId, "Gerrit upload must return a confirmed change id");
    assert.ok(upload.reviewUrl, "Gerrit upload must return a confirmed review URL");
    uploadedChangeId = upload.changeId;

    const uploadedDetail = assertMcpToolOk(await callMcpOperation({
      serverUrl,
      token: readToken,
      operation: "pact.gerrit.read",
      input: { action: "changes.get", changeId: uploadedChangeId, options: ["CURRENT_REVISION", "CURRENT_COMMIT"] }
    }), "pact.gerrit.read");
    const uploadedCurrentRevision =
      uploadedDetail.data?.current_revision ||
      Object.keys(uploadedDetail.data?.revisions || {}).find((revision) => revision === uploadWorktree.head);
    assert.equal(uploadedCurrentRevision, uploadWorktree.head);

    const uploadReply = await operationReplies.waitFor((event) =>
      event.params?.operation === "pact.workspace.code.change.upload" &&
      event.params?.status === "completed" &&
      event.params?.target?.reviewUrl === upload.reviewUrl
    );
    assert.equal(uploadReply.params.target.targetKind, "codespace");
    assert.equal(uploadReply.params.target.targetProvider, "gerrit");
    assert.equal(uploadReply.params.target.reviewUrl, upload.reviewUrl);
    assert.equal(uploadReply.params.message, "已完成 pact.workspace.code.change.upload 任务");
    assert.match(JSON.stringify(uploadReply.params.payload), /confirmed/);
  } finally {
    if (operationReplies) {
      await operationReplies.close();
    }
    if (uploadedChangeId) {
      await callMcpOperation({
        serverUrl,
        token: maintainToken,
        operation: "pact.gerrit.maintain",
        input: {
          action: "changes.abandon",
          changeId: uploadedChangeId,
          message: "Pact Gerrit MCP git upload verification cleanup",
          notify: "NONE",
          confirm: true
        }
      });
    }
    if (uploadWorktree?.workRoot) {
      await fs.rm(uploadWorktree.workRoot, { recursive: true, force: true });
    }
  }

  const abandoned = assertMcpToolOk(await callMcpOperation({
    serverUrl,
    token: maintainToken,
    operation: "pact.gerrit.maintain",
    input: {
      action: "changes.abandon",
      changeId,
      message: "Pact Gerrit MCP verification cleanup",
      notify: "NONE",
      confirm: true
    }
  }), "pact.gerrit.maintain");
  assert.equal(abandoned.data?.status, "ABANDONED");

  return { project, changeId };
}

function assertOperation(id, expected) {
  const operation = SERVER_API_OPERATIONS.find((item) => item.id === id);
  assert.ok(operation, `missing operation ${id}`);
  assert.equal(operation.http.path, expected.path);
  assert.equal(operation.http.method, "POST");
  assert.deepEqual(operation.requiredScopes, expected.scopes);
  assert.equal(operation.safety.risk, expected.risk);
  assert.equal(operation.safety.requiresConfirmation === true, expected.requiresConfirmation);
  return operation;
}

function assertTool(toolsById, id, expected) {
  const tool = toolsById.get(id);
  assert.ok(tool, `missing tool ${id}`);
  assert.equal(tool.operationId, expected.operationId);
  assert.deepEqual(tool.requiredScopes, expected.scopes);
  assert.equal(tool.risk, expected.risk);
  assert.equal(tool.requiresApproval, expected.requiresApproval);
  assert.equal(tool.toolsets.includes(expected.toolset), true);
  return tool;
}

async function readJson(relativePath) {
  return JSON.parse(await fs.readFile(path.join(repoRoot, relativePath), "utf8"));
}

async function verifyMaintenanceArtifacts() {
  const skillPath = "skills/codespace/pact-gerrit-mcp-maintainer/SKILL.md";
  const skill = await fs.readFile(path.join(repoRoot, skillPath), "utf8");
  assert.match(skill, /name: pact-gerrit-mcp-maintainer/);
  assert.match(skill, /server:verify:gerrit-mcp/);
  assert.match(skill, /server:gerrit:smoke/);
  assert.match(skill, /未发现已知高风险问题/);

  const gerritManifestPath = "server/platform/specialized/capabilities/code-review/gerrit/module.json";
  const gerritManifest = await readJson(gerritManifestPath);
  assert.equal(gerritManifest.category, "external-service-compatibility");
  assert.equal(gerritManifest.compatibilityLayer, "external-service-compatibility");
  assert.equal(gerritManifest.compatibilityBoundary, "remote-service");
  assert.equal(gerritManifest.serviceProviders.includes("gerrit"), true);
  assert.equal(gerritManifest.protocol, "v0.0.1:platform:code-review-1");
  assert.equal(gerritManifest.maintenanceSkill, skillPath);
  assert.deepEqual(gerritManifest.components.gerritMcpRoute.operations, [
    "gerrit.read",
    "gerrit.write",
    "gerrit.maintain",
    "gerrit.git_upload"
  ]);
  assert.equal(gerritManifest.components.gerritMcpRoute.auditRequired, true);
  assert.equal(gerritManifest.runtime.localTestServer.gerritVersion, "3.14.0");
  assert.ok(gerritManifest.verification.includes("PACT_VERIFY_GERRIT_LIVE=1 npm run server:verify:gerrit-mcp --silent"));

  const repoManifest = await readJson("server/platform/specialized/capabilities/code-repository/repo-operations/module.json");
  assert.equal(repoManifest.category, "pact-internal-compatibility");
  assert.equal(repoManifest.compatibilityLayer, "pact-internal-compatibility");
  assert.equal(repoManifest.compatibilityBoundary, "resource-operation");
  assert.equal(repoManifest.internalCompatibilityKind, "resource-operation");
  assert.equal(repoManifest.protocol, "v0.0.1:operation:resource-operation-1");
  assert.equal(repoManifest.maintenanceSkill, skillPath);
  assert.equal(repoManifest.components.repoOperationRoute.operations.includes("repo.proposal.create"), true);
  assert.equal(repoManifest.components.repoOperationRoute.operations.includes("repo.change.abandon"), true);
  assert.equal(repoManifest.components.repoOperationRoute.auditRequired, true);
  assert.equal(repoManifest.providers.includes("gerrit"), true);
}

async function liveGerritVersion({ required }) {
  try {
    const result = await executeGerritCommonOperation({
      mode: "read",
      input: { action: "server.version" }
    });
    if (result.ok) {
      return String(result.result || "");
    }
    if (required) {
      throw new Error(result.error || "Gerrit server.version did not return ok.");
    }
  } catch (error) {
    if (required) {
      throw error;
    }
  }
  return "";
}

await verifyMaintenanceArtifacts();

assert.equal(GERRIT_ACTIONS.read.includes("server.version"), true);
assert.equal(GERRIT_ACTIONS.read.includes("changes.query"), true);
assert.equal(GERRIT_ACTIONS.read.includes("revisions.file.diff"), true);
assert.equal(GERRIT_ACTIONS.write.includes("revisions.review.set"), true);
assert.equal(GERRIT_ACTIONS.write.includes("attention_set.add"), true);
assert.equal(GERRIT_ACTIONS.maintain.includes("changes.submit"), true);
assert.equal(GERRIT_ACTIONS.maintain.includes("revisions.cherrypick"), true);

assertOperation("gerrit.read", {
  path: "/api/gerrit/read",
  scopes: ["repo:read"],
  risk: "read_only",
  requiresConfirmation: false
});
assertOperation("gerrit.write", {
  path: "/api/gerrit/write",
  scopes: ["repo:write"],
  risk: "safe_write",
  requiresConfirmation: false
});
assertOperation("gerrit.maintain", {
  path: "/api/gerrit/maintain",
  scopes: ["repo:maintain"],
  risk: "repair_write",
  requiresConfirmation: true
});
assertOperation("gerrit.git_upload", {
  path: "/api/gerrit/git-upload",
  scopes: ["repo:maintain"],
  risk: "repair_write",
  requiresConfirmation: true
});

const catalog = createToolCatalog({ operations: SERVER_API_OPERATIONS });
const toolsById = new Map(catalog.tools.map((tool) => [tool.id, tool]));
assertTool(toolsById, "pact.gerrit.read", {
  operationId: "gerrit.read",
  scopes: ["repo:read"],
  risk: "read_only",
  requiresApproval: false,
  toolset: "pact.repo.read"
});
assertTool(toolsById, "pact.gerrit.write", {
  operationId: "gerrit.write",
  scopes: ["repo:write"],
  risk: "safe_write",
  requiresApproval: false,
  toolset: "pact.repo.write"
});
assertTool(toolsById, "pact.gerrit.maintain", {
  operationId: "gerrit.maintain",
  scopes: ["repo:maintain"],
  risk: "repair_write",
  requiresApproval: true,
  toolset: "pact.repo.maintain"
});
assertTool(toolsById, "pact.gerrit.gitUpload", {
  operationId: "gerrit.git_upload",
  scopes: ["repo:maintain"],
  risk: "repair_write",
  requiresApproval: true,
  toolset: "pact.repo.maintain"
});

const uploadPlan = await uploadGerritGitChange({
  worktreePath: repoRoot,
  branch: "main",
  topic: "verify gerrit mcp",
  hashtags: ["pact", "gerrit"],
  reviewers: ["reviewer@example.com"],
  cc: ["cc@example.com"],
  notify: "NONE",
  traceId: "verify-gerrit-mcp",
  dryRun: true,
  allowDirty: true
});
assert.equal(uploadPlan.ok, true);
assert.match(uploadPlan.targetRef, /^HEAD:refs\/for\/main%/);
assert.match(uploadPlan.targetRef, /topic=verify%20gerrit%20mcp/);
assert.match(uploadPlan.targetRef, /hashtag=pact/);
assert.match(uploadPlan.targetRef, /hashtag=gerrit/);
assert.match(uploadPlan.targetRef, /r=reviewer%40example\.com/);
assert.match(uploadPlan.targetRef, /cc=cc%40example\.com/);
assert.match(uploadPlan.targetRef, /notify=NONE/);

const requireLiveGerrit = process.env.PACT_VERIFY_GERRIT_LIVE === "1";
const liveVersion = await liveGerritVersion({ required: requireLiveGerrit });

const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-gerrit-mcp-"));
const server = await startHttpServer({
  userDataPath,
  distPath: "",
  port: 0,
  runtimeOptions: {
    profile: "minimal"
  }
});
await installAuthenticatedFetch(server, { safetyConfirm: false });

try {
  const serverCatalog = await fetchJson(`${server.url}/api/tool-management/v1/catalog`);
  assert.equal(serverCatalog.status, 200);
  const serverToolIds = new Set(serverCatalog.payload.tools.map((tool) => tool.id));
  assert.equal(serverToolIds.has("pact.gerrit.read"), true);
  assert.equal(serverToolIds.has("pact.gerrit.write"), true);
  assert.equal(serverToolIds.has("pact.gerrit.maintain"), true);
  assert.equal(serverToolIds.has("pact.gerrit.gitUpload"), true);

  const initialize = await fetchJson(`${server.url}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(mcpRequest("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "verify-gerrit-mcp", version: "0.0.0" }
    }, 1))
  });
  assert.equal(initialize.status, 200);
  assert.equal(initialize.payload.result.serverInfo.name, "Pact");

  const unauthenticatedTools = await fetchJson(`${server.url}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(mcpRequest("tools/list", {}, 2))
  });
  assert.equal(unauthenticatedTools.status, 401);

  const readGrant = await localMcpGrant(server.url, {
    label: "verify-gerrit-read",
    scopes: ["repo:read"],
    targets: ["verify-gerrit-mcp"]
  });
  assert.equal(readGrant.status, 201);
  assert.equal(readGrant.payload.maxRisk, "read_only");
  const readToken = readGrant.payload.token;

  const writeGrantDenied = await localMcpGrant(server.url, {
    label: "verify-gerrit-write-denied",
    scopes: ["repo:write"],
    targets: ["verify-gerrit-mcp"]
  });
  assert.equal(writeGrantDenied.status, 403);
  assert.equal(writeGrantDenied.payload.error.code, "confirmation_required");

  const writeGrant = await localMcpGrant(server.url, {
    label: "verify-gerrit-write",
    scopes: ["repo:write"],
    targets: ["verify-gerrit-mcp"]
  }, { "x-pact-safety-confirm": "true" });
  assert.equal(writeGrant.status, 201);
  assert.equal(writeGrant.payload.maxRisk, "safe_write");
  const writeToken = writeGrant.payload.token;

  const maintainGrantDenied = await localMcpGrant(server.url, {
    label: "verify-gerrit-maintain-denied",
    scopes: ["repo:maintain"],
    targets: ["verify-gerrit-mcp"]
  }, { "x-pact-safety-confirm": "true" });
  assert.equal(maintainGrantDenied.status, 403);
  assert.equal(maintainGrantDenied.payload.error.code, "repair_grant_mode_required");

  const maintainGrant = await localMcpGrant(server.url, {
    label: "verify-gerrit-maintain",
    toolsets: ["pact.repo.read", "pact.repo.write", "pact.repo.review", "pact.repo.approve", "pact.repo.maintain"],
    grantMode: "maintain",
    targets: ["verify-gerrit-mcp"]
  }, { "x-pact-safety-confirm": "true" });
  assert.equal(maintainGrant.status, 201);
  assert.equal(maintainGrant.payload.maxRisk, "repair_write");
  const maintainToken = maintainGrant.payload.token;

  const toolsList = await fetchJson(`${server.url}/mcp`, {
    method: "POST",
    headers: mcpHeaders(readToken),
    body: JSON.stringify(mcpRequest("tools/list", {}, 3))
  });
  assert.equal(toolsList.status, 200);
  const publicToolNames = toolsList.payload.result.tools.map((tool) => tool.name);
  assert.deepEqual(publicToolNames.sort(), [
    "pact.discovery",
    "pact.agentLibrary",
    "pact.sharedspace",
    "pact.codespace",
    "pact.skillHub",
    "pact.agentRelay",
    "pact.serviceHub"
  ].sort());
  assert.equal(publicToolNames.includes("pact.gerrit.read"), false);

  const capabilities = await callMcpOperation({
    serverUrl: server.url,
    token: readToken,
    outlet: "pact.discovery",
    operation: "pact.capabilities.list",
    input: {}
  });
  assert.equal(capabilities.status, 200);
  const capabilityNames = new Set(capabilities.payload.result.structuredContent.operations.map((tool) => tool.name));
  assert.equal(capabilityNames.has("pact.gerrit.read"), true, "read grant must see read capability");
  assert.equal(capabilityNames.has("pact.gerrit.write"), false, "read grant must not see write capability");
  assert.equal(capabilityNames.has("pact.gerrit.maintain"), false, "read grant must not see maintain capability");
  assert.equal(capabilityNames.has("pact.gerrit.gitUpload"), false, "read grant must not see git upload capability");

  const maintainCapabilities = await callMcpOperation({
    serverUrl: server.url,
    token: maintainToken,
    outlet: "pact.discovery",
    operation: "pact.capabilities.list",
    input: {}
  });
  assert.equal(maintainCapabilities.status, 200);
  const maintainCapabilityNames = new Set(maintainCapabilities.payload.result.structuredContent.operations.map((tool) => tool.name));
  for (const toolName of ["pact.gerrit.read", "pact.gerrit.write", "pact.gerrit.maintain", "pact.gerrit.gitUpload"]) {
    assert.equal(maintainCapabilityNames.has(toolName), true, `missing maintain MCP capability ${toolName}`);
  }

  const directToolRejected = await fetchJson(`${server.url}/mcp`, {
    method: "POST",
    headers: mcpHeaders(readToken),
    body: JSON.stringify(mcpRequest("tools/call", {
      name: "pact.gerrit.read",
      arguments: {
        operation: "pact.gerrit.read",
        input: { action: "server.version" }
      }
    }, 4))
  });
  assert.equal(directToolRejected.status, 200);
  assert.equal(directToolRejected.payload.error.data.code, "method_not_found");

  const writeDeniedForReadGrant = await callMcpOperation({
    serverUrl: server.url,
    token: readToken,
    operation: "pact.gerrit.write",
    input: sampleGerritInput("write", "changes.create")
  });
  assert.equal(writeDeniedForReadGrant.status, 403);
  assert.equal(writeDeniedForReadGrant.payload.error.data.code, "missing_scopes");

  await verifyMcpDryRunActionMatrix({
    serverUrl: server.url,
    token: readToken,
    mode: "read",
    operation: "pact.gerrit.read",
    actions: GERRIT_ACTIONS.read
  });
  await verifyMcpDryRunActionMatrix({
    serverUrl: server.url,
    token: writeToken,
    mode: "write",
    operation: "pact.gerrit.write",
    actions: GERRIT_ACTIONS.write
  });
  await verifyMcpDryRunActionMatrix({
    serverUrl: server.url,
    token: maintainToken,
    mode: "maintain",
    operation: "pact.gerrit.maintain",
    actions: GERRIT_ACTIONS.maintain
  });

  const redactionProbe = assertMcpToolOk(await callMcpOperation({
    serverUrl: server.url,
    token: readToken,
    operation: "pact.gerrit.read",
    input: {
      action: "server.version",
      dryRun: true,
      password: "audit-secret-probe"
    }
  }), "pact.gerrit.read");
  assert.equal(redactionProbe.dryRun, true);

  if (liveVersion) {
    await runLiveGerritMcpScenario({
      serverUrl: server.url,
      readToken,
      writeToken,
      maintainToken,
      liveVersion
    });
  }

  const uploadNeedsConfirmation = await callMcpOperation({
    serverUrl: server.url,
    token: maintainToken,
    operation: "pact.gerrit.gitUpload",
    input: {
      worktreePath: repoRoot,
      branch: "main",
      dryRun: true,
      allowDirty: true
    }
  });
  assert.equal(uploadNeedsConfirmation.status, 200);
  assert.equal(uploadNeedsConfirmation.payload.error.data.code, "confirmation_required");
  assert.equal(uploadNeedsConfirmation.payload.error.data.status, 409);

  const uploadDryRun = assertMcpToolOk(await callMcpOperation({
    serverUrl: server.url,
    token: maintainToken,
    operation: "pact.gerrit.gitUpload",
    input: {
      worktreePath: repoRoot,
      branch: "main",
      topic: "verify gerrit mcp",
      dryRun: true,
      allowDirty: true,
      confirm: true
    }
  }), "pact.gerrit.gitUpload");
  assert.equal(uploadDryRun.ok, true);
  assert.equal(uploadDryRun.dryRun, true);
  assert.match(uploadDryRun.targetRef, /^HEAD:refs\/for\/main%topic=verify%20gerrit%20mcp/);

  const readAudit = await fetchJson(`${server.url}/api/tool-management/v1/audit?limit=500`);
  assert.equal(readAudit.status, 200);
  const auditItems = readAudit.payload.items || [];
  for (const toolId of ["pact.gerrit.read", "pact.gerrit.write", "pact.gerrit.maintain", "pact.gerrit.gitUpload"]) {
    assert.equal(auditItems.some((item) => item.toolId === toolId), true, `missing audit for ${toolId}`);
  }
  assert.equal(JSON.stringify(auditItems).includes("audit-secret-probe"), false);
  assert.equal(
    auditItems.some((item) => item.toolId === "pact.gerrit.read" && item.redactedInput?.password === "<redacted>"),
    true
  );
  assert.equal(
    auditItems.some((item) => item.toolId === "pact.gerrit.write" && item.status === "denied" && item.errorCode === "missing_scopes"),
    true
  );
  assert.equal(
    auditItems.some((item) => item.toolId === "pact.gerrit.gitUpload" && item.status === "denied" && item.errorCode === "confirmation_required"),
    true
  );
  const oneGerritAudit = auditItems.find((item) => item.toolId === "pact.gerrit.read");
  assert.ok(oneGerritAudit?.toolExecutionId);
  const auditDetail = await fetchJson(`${server.url}/api/tool-management/v1/audit/${oneGerritAudit.toolExecutionId}`);
  assert.equal(auditDetail.status, 200);
  assert.equal(auditDetail.payload.audit.toolId, "pact.gerrit.read");

  console.log(
    liveVersion
      ? `gerrit-mcp verification passed (MCP dry-run matrix + live Gerrit ${liveVersion})`
      : "gerrit-mcp verification passed (MCP dry-run matrix; live Gerrit checks skipped)"
  );
} finally {
  await server.close();
  await fs.rm(userDataPath, { recursive: true, force: true });
}
