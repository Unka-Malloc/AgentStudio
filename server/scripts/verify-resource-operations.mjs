import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { SERVER_API_OPERATIONS } from "../platform/common/operation-dispatcher/operation-registry.mjs";
import { createToolCatalog } from "../platform/specialized/capabilities/tools/tool-management-core/catalog.mjs";
import { REPO_OPERATION_IDS } from "../platform/specialized/capabilities/code-repository/repo-operations/index.mjs";
import { startHttpServer } from "../services/server-runtime/http-server.mjs";
import { installAuthenticatedFetch } from "./test-auth-helper.mjs";

const execFileAsync = promisify(execFile);

async function run(command, args, options = {}) {
  return execFileAsync(command, args, {
    ...options,
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      ...(options.env || {})
    }
  });
}

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
  return { jsonrpc: "2.0", id, method, params };
}

async function createGrant(server, body) {
  const result = await fetchJson(`${server.url}/api/tool-management/v1/grants`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-pact-safety-confirm": "true" },
    body: JSON.stringify(body)
  });
  assert.equal(result.status, 201);
  return result.payload;
}

async function executeTool(server, token, toolId, input) {
  return fetchJson(`${server.url}/api/tool-management/v1/execute`, {
    method: "POST",
    headers: bearerHeaders(token),
    body: JSON.stringify({ toolId, input })
  });
}

async function callMcp(server, token, operation, input, id = 1, outlet = "pact.discovery") {
  return fetchJson(`${server.url}/mcp`, {
    method: "POST",
    headers: mcpHeaders(token),
    body: JSON.stringify(mcpRequest("tools/call", {
      name: outlet,
      arguments: { apiVersion: "v0.0.1:mcp:interface-1", operation, input }
    }, id))
  });
}

async function createFixtureRepo(root) {
  const repoPath = path.join(root, "repo");
  const remotePath = path.join(root, "remote.git");
  await fs.mkdir(repoPath, { recursive: true });
  await run("git", ["init"], { cwd: repoPath });
  await run("git", ["checkout", "-b", "main"], { cwd: repoPath });
  await run("git", ["config", "user.name", "Pact Verify"], { cwd: repoPath });
  await run("git", ["config", "user.email", "pact-verify@example.invalid"], { cwd: repoPath });
  await fs.writeFile(path.join(repoPath, "README.md"), "# fixture\n", "utf8");
  await run("git", ["add", "README.md"], { cwd: repoPath });
  await run("git", ["commit", "-m", "initial"], { cwd: repoPath });
  await run("git", ["init", "--bare", remotePath], { cwd: root });
  await run("git", ["remote", "add", "origin", remotePath], { cwd: repoPath });
  await run("git", ["push", "-u", "origin", "main"], { cwd: repoPath });
  return { repoPath, remotePath };
}

function assertOperation(id, scope, risk) {
  const operation = SERVER_API_OPERATIONS.find((item) => item.id === id);
  assert.ok(operation, `missing operation ${id}`);
  assert.deepEqual(operation.requiredScopes, [scope]);
  assert.equal(operation.safety.risk, risk);
  assert.equal(operation.target.method, "handleRepoOperation");
}

for (const id of REPO_OPERATION_IDS) {
  assert.ok(SERVER_API_OPERATIONS.some((operation) => operation.id === id), `missing ${id}`);
}

assertOperation("repo.status", "repo:read", "read_only");
assertOperation("repo.file.create", "repo:write", "safe_write");
assertOperation("repo.review.comment", "repo:review", "safe_write");
assertOperation("repo.review.approve", "repo:approve", "safe_write");
assertOperation("repo.merge", "repo:maintain", "repair_write");
assertOperation("repo.protection.set", "repo:admin", "repair_write");

const catalog = createToolCatalog({ operations: SERVER_API_OPERATIONS });
const toolsById = new Map(catalog.tools.map((tool) => [tool.id, tool]));
assert.equal(toolsById.get("pact.repo.status")?.toolsets.includes("pact.repo.read"), true);
assert.equal(toolsById.get("pact.repo.file.create")?.toolsets.includes("pact.repo.write"), true);
assert.equal(toolsById.get("pact.repo.review.comment")?.toolsets.includes("pact.repo.review"), true);
assert.equal(toolsById.get("pact.repo.review.approve")?.toolsets.includes("pact.repo.approve"), true);
assert.equal(toolsById.get("pact.repo.merge")?.requiresApproval, true);
assert.equal(toolsById.get("pact.repo.protection.set")?.requiresApproval, true);

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pact-resource-ops-"));
const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-resource-ops-server-"));
const { repoPath } = await createFixtureRepo(tempRoot);

const server = await startHttpServer({
  userDataPath,
  distPath: "",
  port: 0,
  runtimeOptions: { profile: "minimal" }
});
await installAuthenticatedFetch(server, { safetyConfirm: false });

try {
  const readGrant = await createGrant(server, {
    label: "verify-resource-repo-read",
    scopes: ["repo:read"]
  });
  const writeGrant = await createGrant(server, {
    label: "verify-resource-repo-write",
    scopes: ["repo:write"]
  });
  const reviewGrant = await createGrant(server, {
    label: "verify-resource-repo-review",
    scopes: ["repo:review"]
  });
  const approveGrant = await createGrant(server, {
    label: "verify-resource-repo-approve",
    scopes: ["repo:approve"]
  });
  const elevatedGrant = await createGrant(server, {
    label: "verify-resource-repo-elevated",
    scopes: ["repo:read", "repo:write", "repo:review", "repo:approve", "repo:maintain", "repo:admin"],
    metadata: { maxRisk: "repair_write" }
  });

  const localGrant = await fetchJson(`${server.url}/api/mcp/local-grant`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      targets: ["codex"],
      label: "verify-resource-local-grant",
      scopes: ["repo:read"]
    })
  });
  assert.equal(localGrant.status, 201);
  assert.equal(localGrant.payload.scopes.includes("repo:read"), true);
  assert.equal(localGrant.payload.toolsets.includes("pact.repo.read"), true);

  const capabilities = await callMcp(server, readGrant.token, "pact.capabilities.list", {}, 10);
  assert.equal(capabilities.status, 200);
  assert.equal(
    capabilities.payload.result.structuredContent.operations.some((tool) => tool.name === "pact.repo.status"),
    true
  );

  const status = await callMcp(server, readGrant.token, "pact.repo.status", {
    repoId: repoPath,
    targetType: "worktree"
  }, 11, "pact.codespace");
  assert.equal(status.status, 200);
  assert.equal(status.payload.result.structuredContent.operation, "pact.repo.status");
  assert.equal(status.payload.result.structuredContent.payload.operationId, "repo.status");
  assert.equal(status.payload.result.structuredContent.payload.data.branch, "main");

  const created = await executeTool(server, writeGrant.token, "pact.repo.file.create", {
    repoId: repoPath,
    path: "notes/todo.md",
    content: "todo\n"
  });
  assert.equal(created.status, 200);
  assert.equal(created.payload.result.data.path, "notes/todo.md");

  const updated = await executeTool(server, writeGrant.token, "pact.repo.file.update", {
    repoId: repoPath,
    path: "README.md",
    content: "# fixture\n\nupdated\n"
  });
  assert.equal(updated.status, 200);

  const moved = await executeTool(server, writeGrant.token, "pact.repo.file.move", {
    repoId: repoPath,
    fromPath: "notes/todo.md",
    toPath: "docs/todo.md"
  });
  assert.equal(moved.status, 200);
  assert.equal(moved.payload.result.data.toPath, "docs/todo.md");

  const commit = await executeTool(server, writeGrant.token, "pact.repo.commit.create", {
    repoId: repoPath,
    branch: "main",
    message: "apply resource operation changes"
  });
  assert.equal(commit.status, 200);
  assert.match(commit.payload.result.data.commit, /^[0-9a-f]{40}$/);

  const readFile = await executeTool(server, readGrant.token, "pact.repo.file.read", {
    repoId: repoPath,
    path: "docs/todo.md"
  });
  assert.equal(readFile.status, 200);
  assert.equal(readFile.payload.result.data.content, "todo\n");

  const tree = await executeTool(server, readGrant.token, "pact.repo.tree.list", {
    repoId: repoPath,
    path: "docs"
  });
  assert.equal(tree.status, 200);
  assert.equal(tree.payload.result.data.entries.some((entry) => entry.path === "docs/todo.md"), true);

  const diff = await executeTool(server, readGrant.token, "pact.repo.diff.read", {
    repoId: repoPath,
    baseRef: "HEAD~1",
    headRef: "HEAD"
  });
  assert.equal(diff.status, 200);
  assert.match(diff.payload.result.data.diff, /docs\/todo\.md/);

  const commitRead = await executeTool(server, readGrant.token, "pact.repo.commit.read", {
    repoId: repoPath,
    commitRef: "HEAD"
  });
  assert.equal(commitRead.status, 200);
  assert.equal(commitRead.payload.result.data.subject, "apply resource operation changes");

  const branch = await executeTool(server, writeGrant.token, "pact.repo.branch.create", {
    repoId: repoPath,
    branchName: "feature/resource-ops",
    baseRef: "HEAD"
  });
  assert.equal(branch.status, 200);

  const checkout = await executeTool(server, writeGrant.token, "pact.repo.branch.checkout", {
    repoId: repoPath,
    branchName: "feature/resource-ops"
  });
  assert.equal(checkout.status, 200);

  const deleted = await executeTool(server, writeGrant.token, "pact.repo.file.delete", {
    repoId: repoPath,
    path: "docs/todo.md"
  });
  assert.equal(deleted.status, 200);

  const featureCommit = await executeTool(server, writeGrant.token, "pact.repo.commit.create", {
    repoId: repoPath,
    branch: "feature/resource-ops",
    message: "delete todo"
  });
  assert.equal(featureCommit.status, 200);

  const push = await executeTool(server, writeGrant.token, "pact.repo.push", {
    repoId: repoPath,
    remote: "origin",
    sourceRef: "feature/resource-ops",
    targetRef: "refs/heads/feature/resource-ops"
  });
  assert.equal(push.status, 200);

  const forceDenied = await executeTool(server, writeGrant.token, "pact.repo.push", {
    repoId: repoPath,
    remote: "origin",
    sourceRef: "feature/resource-ops",
    targetRef: "refs/heads/feature/resource-ops",
    force: true
  });
  assert.equal(forceDenied.status, 403);

  const forcePlan = await executeTool(server, elevatedGrant.token, "pact.repo.push", {
    repoId: repoPath,
    remote: "origin",
    sourceRef: "feature/resource-ops",
    targetRef: "refs/heads/feature/resource-ops",
    force: true,
    dryRun: true,
    confirm: true
  });
  assert.equal(forcePlan.status, 200);
  assert.equal(forcePlan.payload.result.data.dryRun, true);

  const proposalPlan = await executeTool(server, writeGrant.token, "pact.repo.proposal.create", {
    repoId: repoPath,
    sourceRef: "feature/resource-ops",
    targetRef: "main",
    title: "Resource operation test",
    dryRun: true
  });
  assert.equal(proposalPlan.status, 200);
  assert.equal(proposalPlan.payload.result.data.provider, "gerrit");

  const commentPlan = await executeTool(server, reviewGrant.token, "pact.repo.review.comment", {
    repoId: repoPath,
    reviewTarget: "Iverify",
    body: "looks testable",
    dryRun: true
  });
  assert.equal(commentPlan.status, 200);
  assert.equal(commentPlan.payload.result.data.action, "revisions.review.set");

  const requestChangesPlan = await executeTool(server, reviewGrant.token, "pact.repo.review.requestChanges", {
    repoId: repoPath,
    reviewTarget: "Iverify",
    body: "please adjust",
    dryRun: true
  });
  assert.equal(requestChangesPlan.status, 200);
  assert.equal(requestChangesPlan.payload.result.data.review.labels["Code-Review"], -1);

  const approvePlan = await executeTool(server, approveGrant.token, "pact.repo.review.approve", {
    repoId: repoPath,
    reviewTarget: "Iverify",
    dryRun: true
  });
  assert.equal(approvePlan.status, 200);
  assert.equal(approvePlan.payload.result.data.review.labels["Code-Review"], 1);

  for (const [toolId, input] of [
    ["pact.repo.merge", { repoId: repoPath, reviewTarget: "feature/resource-ops", dryRun: true, confirm: true }],
    ["pact.repo.submit", { repoId: repoPath, changeId: "Iverify", dryRun: true, confirm: true }],
    ["pact.repo.rebase", { repoId: repoPath, targetRef: "Iverify", baseRef: "main", provider: "gerrit", dryRun: true, confirm: true }],
    ["pact.repo.revert", { repoId: repoPath, targetRef: "Iverify", provider: "gerrit", dryRun: true, confirm: true }],
    ["pact.repo.proposal.close", { repoId: repoPath, reviewTarget: "Iverify", dryRun: true, confirm: true }],
    ["pact.repo.change.abandon", { repoId: repoPath, changeId: "Iverify", dryRun: true, confirm: true }],
    ["pact.repo.protection.set", { repoId: repoPath, provider: "github", githubRepo: "owner/repo", branchPattern: "main", rules: {}, dryRun: true, confirm: true }],
    ["pact.repo.webhook.set", { repoId: repoPath, provider: "github", githubRepo: "owner/repo", payload: { name: "web" }, dryRun: true, confirm: true }],
    ["pact.repo.member.set", { repoId: repoPath, provider: "github", githubRepo: "owner/repo", subjectId: "octocat", role: "push", dryRun: true, confirm: true }]
  ]) {
    const result = await executeTool(server, elevatedGrant.token, toolId, input);
    assert.equal(result.status, 200, `${toolId} should support dryRun`);
    assert.equal(result.payload.result.data.dryRun, true);
  }

  console.log("resource-operations verification passed");
} finally {
  await server.close();
  await fs.rm(tempRoot, { recursive: true, force: true });
  await fs.rm(userDataPath, { recursive: true, force: true });
}
