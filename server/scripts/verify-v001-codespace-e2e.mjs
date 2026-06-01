import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SERVER_API_OPERATIONS } from "../platform/common/operation-dispatcher/operation-registry.mjs";
import { createToolCatalog } from "../platform/specialized/capabilities/tools/tool-management-core/catalog.mjs";
import { startHttpServer } from "../services/server-runtime/http-server.mjs";
import { authHeaders, installAuthenticatedFetch } from "./test-auth-helper.mjs";

const REQUIRED_OPERATIONS = [
  "codespace.providers.manifest",
  "codespace.repository.status",
  "codespace.tree.list",
  "codespace.file.read",
  "codespace.diff.read",
  "codespace.change.prepare",
  "codespace.change.upload",
  "codespace.review.comment",
  "codespace.review.requestChanges",
  "codespace.review.approve",
  "codespace.review.status.sync"
];

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

let mcpRequestId = 0;

async function callCodespaceOperation({ serverUrl, token, operation, input = {} }) {
  mcpRequestId += 1;
  return fetchJson(`${serverUrl}/mcp`, {
    method: "POST",
    headers: mcpHeaders(token),
    body: JSON.stringify(mcpRequest("tools/call", {
      name: "pact.codespace",
      arguments: {
        apiVersion: "pact.mcp.v1",
        operation,
        input,
        clientVersion: "verify-v001-codespace-e2e"
      }
    }, mcpRequestId))
  });
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

async function createCodespaceRepo(rootPath) {
  const repoPath = path.join(rootPath, "codespace-repo");
  await fs.mkdir(repoPath, { recursive: true });
  run("git", ["init", "-b", "main"], { cwd: repoPath });
  run("git", ["config", "user.email", "codespace-v001@example.com"], { cwd: repoPath });
  run("git", ["config", "user.name", "Codespace v001"], { cwd: repoPath });
  await fs.writeFile(path.join(repoPath, "README.md"), "codespace v0.0.1\n", "utf8");
  run("git", ["add", "README.md"], { cwd: repoPath });
  run("git", ["commit", "-m", "initial codespace fixture"], { cwd: repoPath });
  await fs.writeFile(path.join(repoPath, "README.md"), "codespace v0.0.1\nrepository port\n", "utf8");
  run("git", ["add", "README.md"], { cwd: repoPath });
  run("git", ["commit", "-m", "update codespace fixture"], { cwd: repoPath });
  run("git", ["remote", "add", "origin", "https://github.com/example/codespace-fixture.git"], { cwd: repoPath });
  return repoPath;
}

const operationsById = new Map(SERVER_API_OPERATIONS.map((operation) => [operation.id, operation]));
const toolsByOperationId = new Map(
  createToolCatalog({ operations: SERVER_API_OPERATIONS }).tools
    .filter((tool) => tool.operationId)
    .map((tool) => [tool.operationId, tool])
);

for (const operationId of REQUIRED_OPERATIONS) {
  const operation = operationsById.get(operationId);
  assert.ok(operation, `${operationId} must be registered`);
  assert.ok(operation.http?.path, `${operationId} must expose HTTP API`);
  assert.equal(operation.rpc?.method, operationId, `${operationId} must expose RPC method`);
  assert.ok(operation.cli?.command?.length, `${operationId} must expose CLI command`);
  const tool = toolsByOperationId.get(operationId);
  assert.ok(tool, `${operationId} must be exposed through Tool Management`);
  assert.ok(tool.id.startsWith("pact.codespace."), `${operationId} must map to pact.codespace namespace`);
}

const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-v001-codespace-"));
const server = await startHttpServer({
  userDataPath,
  distPath: "",
  port: 0,
  runtimeOptions: {
    profile: "minimal"
  }
});

try {
  const repoPath = await createCodespaceRepo(userDataPath);
  const auth = await installAuthenticatedFetch(server, { safetyConfirm: true });
  const manifest = await fetchJson(`${server.url}/api/codespace/providers/manifest`, {
    headers: authHeaders(auth)
  });
  assert.equal(manifest.status, 200, JSON.stringify(manifest.payload, null, 2));
  assert.equal(manifest.payload.providers.github.secretRef, "secret://pact/codespace/github-app");
  assert.equal(manifest.payload.providers.gerrit.secretRef, "secret://pact/codespace/gerrit-service-account");
  assert.equal(manifest.payload.secretPolicy, "secretRefOnly");

  const providerConfigPath = path.join(userDataPath, "code-management", "codespace-providers.json");
  const providerConfig = JSON.parse(await fs.readFile(providerConfigPath, "utf8"));
  assert.equal(providerConfig.providers.github.mode, "contract");
  assert.equal(providerConfig.providers.gerrit.mode, "contract");

  const apiStatus = await fetchJson(`${server.url}/api/codespace/repository/status`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(auth, { method: "POST" })
    },
    body: JSON.stringify({
      provider: "github",
      repoId: repoPath,
      repositoryRef: "example/codespace-fixture",
      branch: "main"
    })
  });
  assert.equal(apiStatus.status, 200, JSON.stringify(apiStatus.payload, null, 2));
  assert.equal(apiStatus.payload.adapter, "RepositoryPort");
  assert.equal(apiStatus.payload.provider, "github");

  const rpcStatus = await fetchJson(`${server.url}/api/rpc`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(auth, { method: "POST" })
    },
    body: JSON.stringify(mcpRequest("codespace.repository.status", {
      provider: "gerrit",
      repoId: repoPath,
      repositoryRef: "example/codespace-fixture",
      branch: "main"
    }, "rpc-status"))
  });
  assert.equal(rpcStatus.status, 200, JSON.stringify(rpcStatus.payload, null, 2));
  assert.equal(rpcStatus.payload.result.adapter, "RepositoryPort");
  assert.equal(rpcStatus.payload.result.provider, "gerrit");

  const grant = await localMcpGrant(server.url, {
    label: "verify-v001-codespace",
    toolsets: ["pact.repo.read", "pact.repo.write", "pact.repo.review", "pact.repo.approve", "pact.repo.maintain"],
    grantMode: "maintain",
    targets: ["codespace-v001"]
  }, { "x-pact-safety-confirm": "true" });
  assert.equal(grant.status, 201, JSON.stringify(grant.payload, null, 2));
  const token = grant.payload.token;

  const capabilities = await fetchJson(`${server.url}/mcp`, {
    method: "POST",
    headers: mcpHeaders(token),
    body: JSON.stringify(mcpRequest("tools/call", {
      name: "pact.discovery",
      arguments: {
        apiVersion: "pact.mcp.v1",
        operation: "pact.capabilities.list",
        input: {}
      }
    }, "capabilities"))
  });
  assert.equal(capabilities.status, 200);
  const capabilityNames = new Set(capabilities.payload.result.structuredContent.operations.map((tool) => tool.name));
  for (const toolName of [
    "pact.codespace.repository.status",
    "pact.codespace.tree.list",
    "pact.codespace.file.read",
    "pact.codespace.diff.read",
    "pact.codespace.change.prepare",
    "pact.codespace.change.upload",
    "pact.codespace.review.comment",
    "pact.codespace.review.approve",
    "pact.codespace.review.status.sync"
  ]) {
    assert.equal(capabilityNames.has(toolName), true, `${toolName} must be visible through pact.codespace discovery`);
  }

  const status = assertCodespaceOk(await callCodespaceOperation({
    serverUrl: server.url,
    token,
    operation: "pact.codespace.repository.status",
    input: {
      provider: "github",
      repoId: repoPath,
      repositoryRef: "example/codespace-fixture",
      branch: "main"
    }
  }), "pact.codespace.repository.status");
  assert.equal(status.adapter, "RepositoryPort");
  assert.equal(status.receipt.secretRef, "secret://pact/codespace/github-app");

  const tree = assertCodespaceOk(await callCodespaceOperation({
    serverUrl: server.url,
    token,
    operation: "pact.codespace.tree.list",
    input: { provider: "gerrit", repoId: repoPath, repositoryRef: "example/codespace-fixture" }
  }), "pact.codespace.tree.list");
  assert.equal(tree.provider, "gerrit");
  assert.equal(tree.data.entries.some((entry) => entry.path === "README.md"), true);

  const readme = assertCodespaceOk(await callCodespaceOperation({
    serverUrl: server.url,
    token,
    operation: "pact.codespace.file.read",
    input: { provider: "github", repoId: repoPath, repositoryRef: "example/codespace-fixture", path: "README.md" }
  }), "pact.codespace.file.read");
  assert.match(readme.data.content, /repository port/);

  const diff = assertCodespaceOk(await callCodespaceOperation({
    serverUrl: server.url,
    token,
    operation: "pact.codespace.diff.read",
    input: { provider: "gerrit", repoId: repoPath, repositoryRef: "example/codespace-fixture", baseRef: "HEAD~1", headRef: "HEAD" }
  }), "pact.codespace.diff.read");
  assert.match(diff.data.diff, /repository port/);

  const prepared = assertCodespaceOk(await callCodespaceOperation({
    serverUrl: server.url,
    token,
    operation: "pact.codespace.change.prepare",
    input: {
      workspaceId: "codespace-v001",
      provider: "github",
      repositoryRef: "example/codespace-fixture",
      branch: "main",
      diff: diff.data.diff,
      dataClass: "codeChange",
      policy: { decision: "allow", source: "verify-v001-codespace" },
      checkpoint: { checkpointNodeId: "checkpoint_v001_codespace" },
      commitPlan: [{ message: "Prepare v0.0.1 Codespace change" }],
      idempotencyKey: "v001-codespace-change"
    }
  }), "pact.codespace.change.prepare");
  assert.equal(prepared.prepared, true);
  assert.equal(prepared.changeSet.dataClass, "codeChange");
  assert.equal(prepared.changeSet.policy.decision, "allow");
  assert.equal(prepared.changeSet.checkpoint.checkpointNodeId, "checkpoint_v001_codespace");

  const githubUpload = assertCodespaceOk(await callCodespaceOperation({
    serverUrl: server.url,
    token,
    operation: "pact.codespace.change.upload",
    input: {
      workspaceId: "codespace-v001",
      codeChangeId: prepared.codeChangeId,
      provider: "github",
      repoId: repoPath,
      repositoryRef: "example/codespace-fixture",
      branch: "main",
      sourceRef: "HEAD",
      targetRef: "main",
      title: "Verify v0.0.1 Codespace PR",
      dryRun: true,
      confirm: true
    }
  }), "pact.codespace.change.upload");
  assert.equal(githubUpload.contractVerified, true);
  assert.equal(githubUpload.providerMode, "contract");
  assert.equal(githubUpload.uploadState, "dry-run");
  assert.equal(githubUpload.target.targetProvider, "github");
  assert.equal(githubUpload.codeChange.completion.secretRef, "secret://pact/codespace/github-app");
  assert.equal(githubUpload.codeChange.completion.uploadState, "dry-run");

  const gerritComment = assertCodespaceOk(await callCodespaceOperation({
    serverUrl: server.url,
    token,
    operation: "pact.codespace.review.comment",
    input: {
      workspaceId: "codespace-v001",
      codeChangeId: prepared.codeChangeId,
      provider: "gerrit",
      repoId: repoPath,
      reviewTarget: "Iabcdef1234567890",
      body: "contract-mode review comment",
      dryRun: true
    }
  }), "pact.codespace.review.comment");
  assert.equal(gerritComment.provider, "gerrit");
  assert.equal(gerritComment.providerReceipt.provider, "gerrit");

  const githubApprove = assertCodespaceOk(await callCodespaceOperation({
    serverUrl: server.url,
    token,
    operation: "pact.codespace.review.approve",
    input: {
      workspaceId: "codespace-v001",
      codeChangeId: prepared.codeChangeId,
      provider: "github",
      repoId: repoPath,
      reviewTarget: "1",
      body: "contract-mode approve",
      dryRun: true
    }
  }), "pact.codespace.review.approve");
  assert.equal(githubApprove.provider, "github");
  assert.equal(githubApprove.reviewAction, "approve");

  const synced = assertCodespaceOk(await callCodespaceOperation({
    serverUrl: server.url,
    token,
    operation: "pact.codespace.review.status.sync",
    input: {
      workspaceId: "codespace-v001",
      codeChangeId: prepared.codeChangeId,
      reviewStatus: "merged",
      submitStatus: "merged",
      providerReceipt: {
        contractVerified: true,
        status: "MERGED",
        submitStatus: "merged"
      }
    }
  }), "pact.codespace.review.status.sync");
  assert.equal(synced.synced, true);
  assert.equal(synced.reviewStatus, "merged");
  assert.equal(synced.submitStatus, "merged");

  const registryPath = path.join(userDataPath, "code-management", "codespace-registry.json");
  const registry = JSON.parse(await fs.readFile(registryPath, "utf8"));
  const eventTypes = registry.events.map((event) => event.type);
  for (const eventType of [
    "code.change.prepared",
    "code.change.uploaded",
    "code.review.commented",
    "code.review.approved",
    "code.change.status.synced"
  ]) {
    assert.equal(eventTypes.includes(eventType), true, `${eventType} must be audited`);
  }
  assert.equal(JSON.stringify(registry).includes("github-app-secret-value"), false);
  assert.equal(JSON.stringify(registry).includes("gerrit-password"), false);

  console.log("v0.0.1 codespace e2e verification passed (GitHub/Gerrit contractVerified)");
} finally {
  await server.close();
  await fs.rm(userDataPath, { recursive: true, force: true });
}
