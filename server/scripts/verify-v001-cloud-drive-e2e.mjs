#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import {
  SERVER_API_OPERATIONS,
  buildApiPathForCliOperation,
  findCliOperation
} from "../platform/common/operation-dispatcher/operation-registry.mjs";
import { PROTOCOL_OPERATION_IDS } from "../platform/common/operation-dispatcher/protocol-operation-definitions.mjs";
import { createToolCatalog } from "../platform/specialized/capabilities/tools/tool-management-core/catalog.mjs";
import { startHttpServer } from "../services/server-runtime/http-server.mjs";
import { authHeaders, installAuthenticatedFetch } from "./test-auth-helper.mjs";

const REQUIRED_OPERATIONS = [
  "external.cloudDrive.connect",
  "external.cloudDrive.status",
  "external.cloudDrive.item.list",
  "external.cloudDrive.file.download",
  "external.cloudDrive.file.upload",
  "external.cloudDrive.sync.plan",
  "external.cloudDrive.sync.apply",
  "external.cloudDrive.permission.list"
];

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const rawText = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    payload: rawText.trim() ? JSON.parse(rawText) : {}
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

function defaultMcpToolNameForOperation(operation = "") {
  return String(operation || "").includes("cloudDrive") ? "pact.skillHub" : "pact.sharedspace";
}

async function callMcpStructured({ serverUrl, token, operation, input = {}, toolName = "" }) {
  const effectiveToolName = toolName || defaultMcpToolNameForOperation(operation);
  mcpRequestId += 1;
  const response = await fetchJson(`${serverUrl}/mcp`, {
    method: "POST",
    headers: mcpHeaders(token),
    body: JSON.stringify(mcpRequest("tools/call", {
      name: effectiveToolName,
      arguments: {
        apiVersion: "pact.mcp.v1",
        operation,
        input,
        clientVersion: "verify-v001-cloud-drive-e2e"
      }
    }, mcpRequestId))
  });
  assert.equal(response.status, 200, JSON.stringify(response.payload, null, 2));
  assert.equal(response.payload.error, undefined, JSON.stringify(response.payload.error || {}, null, 2));
  return response.payload.result.structuredContent;
}

async function callMcp({ serverUrl, token, operation, input = {}, toolName = "" }) {
  const structuredContent = await callMcpStructured({ serverUrl, token, operation, input, toolName });
  return structuredContent.payload || structuredContent;
}

function assertPublicPayloadDoesNotLeak(payload, forbiddenText, label) {
  assert.equal(
    JSON.stringify(payload).includes(forbiddenText),
    false,
    `${label} must not expose private local path or secret values`
  );
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

async function readJsonRequest(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text.trim() ? JSON.parse(text) : {};
}

function sendJson(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(`${JSON.stringify(payload)}\n`);
}

async function startFakeCloudDriveProvider() {
  const files = new Map();
  const requests = [];

  function putFile(filePath, content, revision = "rev-1") {
    const buffer = Buffer.from(content, "utf8");
    files.set(filePath, {
      path: filePath,
      name: path.posix.basename(filePath),
      content: buffer,
      contentSha256: sha256(buffer),
      providerFileId: `fake-file-${sha256(Buffer.from(filePath)).slice(0, 12)}`,
      revision,
      etag: `"${sha256(Buffer.concat([Buffer.from(filePath), buffer])).slice(0, 16)}"`
    });
  }

  putFile(".pact-data/codex/remote-seed.txt", "remote live seeded file\n", "rev-seed-1");
  putFile(".pact-data/public/readme.txt", "remote live public file\n", "rev-public-1");

  let baseUrl = "";
  const server = http.createServer(async (request, response) => {
    try {
      if (request.method !== "POST") {
        sendJson(response, 405, { ok: false, error: "method not allowed" });
        return;
      }
      const body = await readJsonRequest(request);
      requests.push({
        url: request.url,
        provider: body.provider,
        operation: body.operation,
        credentialRefHash: body.credentialRefHash
      });
      assert.equal(JSON.stringify(body).includes("secret://"), false, "remote provider request must receive only hashed credential refs");
      const payload = body.payload || {};

      if (request.url === "/connect") {
        sendJson(response, 200, {
          ok: true,
          connection: {
            rootId: "fake-root-01",
            rootName: "Fake Drive Root",
            revision: "root-rev-1",
            accountId: "fake-account-01"
          }
        });
        return;
      }

      if (request.url === "/items/list") {
        const basePath = String(payload.path || "/").replace(/^\/+|\/+$/g, "");
        const items = [...files.values()]
          .filter((file) => !basePath || basePath === "." || file.path === basePath || file.path.startsWith(`${basePath}/`))
          .map((file) => ({
            path: file.path,
            name: file.name,
            itemType: "file",
            mimeType: "text/plain",
            sizeBytes: file.content.length,
            contentSha256: file.contentSha256,
            providerFileId: file.providerFileId,
            revision: file.revision,
            webUrl: `${baseUrl}/web/${encodeURIComponent(file.path)}`,
            etag: file.etag
          }));
        sendJson(response, 200, { ok: true, items });
        return;
      }

      if (request.url === "/files/download") {
        const file = files.get(String(payload.path || ""));
        if (!file) {
          sendJson(response, 404, { ok: false, code: "REMOTE_FILE_NOT_FOUND", error: "file not found" });
          return;
        }
        sendJson(response, 200, {
          ok: true,
          path: file.path,
          name: file.name,
          byteSize: file.content.length,
          contentBase64: file.content.toString("base64"),
          contentSha256: file.contentSha256,
          providerFileId: file.providerFileId,
          revision: file.revision,
          webUrl: `${baseUrl}/web/${encodeURIComponent(file.path)}`,
          etag: file.etag
        });
        return;
      }

      if (request.url === "/files/upload") {
        const filePath = String(payload.path || "");
        const content = Buffer.from(String(payload.contentBase64 || ""), "base64");
        const expectedSha256 = String(payload.contentSha256 || "");
        assert.equal(sha256(content), expectedSha256, "remote upload content hash must match provider payload");
        const revision = `rev-upload-${requests.length}`;
        const providerFileId = `fake-file-${sha256(Buffer.from(filePath)).slice(0, 12)}`;
        const record = {
          path: filePath,
          name: path.posix.basename(filePath),
          content,
          contentSha256: expectedSha256,
          providerFileId,
          revision,
          etag: `"${sha256(Buffer.concat([Buffer.from(filePath), content])).slice(0, 16)}"`
        };
        files.set(filePath, record);
        sendJson(response, 200, {
          ok: true,
          path: record.path,
          name: record.name,
          byteSize: record.content.length,
          contentSha256: record.contentSha256,
          providerFileId: record.providerFileId,
          revision: record.revision,
          webUrl: `${baseUrl}/web/${encodeURIComponent(record.path)}`,
          etag: record.etag
        });
        return;
      }

      sendJson(response, 404, { ok: false, error: "unknown fake provider route" });
    } catch (error) {
      sendJson(response, 500, { ok: false, error: error?.message || String(error) });
    }
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
  return {
    url: baseUrl,
    requests,
    readFile(filePath) {
      return files.get(filePath);
    },
    close() {
      return new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  };
}

const operationsById = new Map(SERVER_API_OPERATIONS.map((operation) => [operation.id, operation]));
const toolsByOperationId = new Map(
  createToolCatalog({ operations: SERVER_API_OPERATIONS }).tools
    .filter((tool) => tool.operationId)
    .map((tool) => [tool.operationId, tool])
);

for (const operationId of REQUIRED_OPERATIONS) {
  assert.equal(PROTOCOL_OPERATION_IDS.includes(operationId), true, `${operationId} must be a protocol operation`);
  const operation = operationsById.get(operationId);
  assert.ok(operation, `${operationId} must be registered`);
  assert.ok(operation.http?.path, `${operationId} must expose HTTP API`);
  assert.equal(operation.rpc?.method, operationId, `${operationId} must expose RPC method`);
  assert.ok(operation.cli?.command?.length, `${operationId} must expose CLI command`);
  const cliEntry = findCliOperation(operation.cli.command);
  assert.equal(cliEntry?.operation?.id, operationId, `${operationId} CLI command must resolve`);
  const cliPath = buildApiPathForCliOperation(operation, {
    workspaceId: "workspace_verify",
    driveRef: "drive_verify",
    path: "folder/file.txt"
  });
  assert.ok(cliPath.startsWith("/api/external/cloud-drive/"), `${operationId} CLI path must target cloud drive API`);
  const tool = toolsByOperationId.get(operationId);
  assert.ok(tool, `${operationId} must be exposed through Tool Management`);
  assert.ok(tool.id.startsWith("pact.external.cloudDrive."), `${operationId} must map to the upstream Cloud Drive namespace`);
}

const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-v001-cloud-drive-"));
const icloudRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pact-icloud-drive-"));
let server = null;
let fakeProvider = null;

try {
  await fs.mkdir(path.join(icloudRoot, ".pact-data", "owner"), { recursive: true });
  await fs.mkdir(path.join(icloudRoot, ".pact-data", "public"), { recursive: true });
  await fs.mkdir(path.join(icloudRoot, "TeamDocs"), { recursive: true });
  await fs.writeFile(path.join(icloudRoot, ".pact-data", "owner", "note.txt"), "icloud default writable space\n", "utf8");
  await fs.writeFile(path.join(icloudRoot, ".pact-data", "public", "readme.txt"), "icloud public readonly space\n", "utf8");
  await fs.writeFile(path.join(icloudRoot, "TeamDocs", "team.txt"), "icloud exposed readonly directory\n", "utf8");

  server = await startHttpServer({
    userDataPath,
    distPath: "",
    port: 0,
    runtimeOptions: {
      profile: "minimal"
    }
  });
  const auth = await installAuthenticatedFetch(server, { safetyConfirm: true });
  fakeProvider = await startFakeCloudDriveProvider();

  const workspace = await fetchJson(`${server.url}/api/agent-workspaces`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(auth, { method: "POST" })
    },
    body: JSON.stringify({
      title: "Cloud Drive verification",
      objective: "Verify CloudDrivePort mediated sharedspace projections."
    })
  });
  assert.equal(workspace.status, 201, JSON.stringify(workspace.payload, null, 2));
  const workspaceId = workspace.payload.workspace.workspaceId;

  const inlineSecret = await fetchJson(`${server.url}/api/external/cloud-drive/connect`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(auth, { method: "POST" })
    },
    body: JSON.stringify({
      workspaceId,
      provider: "onedrive",
      secretRef: "secret://pact/drive/onedrive-oauth",
      accessToken: "must-not-be-stored"
    })
  });
  assert.equal(inlineSecret.status, 400, JSON.stringify(inlineSecret.payload, null, 2));

  const icloudConnect = await fetchJson(`${server.url}/api/external/cloud-drive/connect`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(auth, { method: "POST" })
    },
    body: JSON.stringify({
      workspaceId,
      provider: "icloud",
      rootPath: icloudRoot,
      managedFolder: true,
      managedFolderRoot: ".pact-data",
      publicFolder: "public",
      allowedClients: ["owner", "codex"],
      defaultClient: "owner",
      directoryMappings: [
        {
          name: "Team Docs",
          alias: "team",
          drivePath: "TeamDocs",
          accessPolicy: { mode: "all" }
        }
      ]
    })
  });
  assert.equal(icloudConnect.status, 200, JSON.stringify(icloudConnect.payload, null, 2));
  assert.equal(icloudConnect.payload.localAdapterVerified, true);
  assert.equal(icloudConnect.payload.contractVerified, false);
  assert.ok(icloudConnect.payload.drive.driveRef);
  assert.equal(icloudConnect.payload.drive.managedFolder.spaces.default.writable, true);
  assert.equal(icloudConnect.payload.drive.managedFolder.spaces.public.writable, false);
  assert.equal(icloudConnect.payload.drive.directoryMappings.some((mapping) => mapping.alias === "default" && mapping.writable === true), true);
  assert.equal(icloudConnect.payload.drive.directoryMappings.some((mapping) => mapping.alias === "public" && mapping.writable === false), true);
  assert.equal(icloudConnect.payload.drive.directoryMappings.some((mapping) => mapping.alias === "team" && mapping.writable === false), true);
  assertPublicPayloadDoesNotLeak(icloudConnect.payload, icloudRoot, "iCloud connect payload");
  const icloudDriveRef = icloudConnect.payload.drive.driveRef;
  await fs.access(path.join(icloudRoot, ".pact-data", "codex"));

  const configPath = path.join(userDataPath, "agent-workspaces", "cloud-drive-connections.json");
  const configText = await fs.readFile(configPath, "utf8");
  assert.equal(configText.includes("must-not-be-stored"), false, "runtime drive config must not store inline secrets");
  assert.equal(configText.includes(icloudRoot), true, "private iCloud root may only be stored in runtime data dir config");

  const rpcStatus = await fetchJson(`${server.url}/api/rpc`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(auth, { method: "POST" })
    },
    body: JSON.stringify(mcpRequest("external.cloudDrive.status", {
      workspaceId,
      driveRef: icloudDriveRef
    }, "rpc-drive-status"))
  });
  assert.equal(rpcStatus.status, 200, JSON.stringify(rpcStatus.payload, null, 2));
  assert.equal(rpcStatus.payload.result.count, 1);
  assertPublicPayloadDoesNotLeak(rpcStatus.payload, icloudRoot, "RPC status payload");

  const list = await fetchJson(`${server.url}/api/external/cloud-drive/items?${new URLSearchParams({
    workspaceId,
    driveRef: icloudDriveRef,
    clientId: "owner",
    path: "default",
    recursive: "true",
    includeHash: "true"
  })}`, {
    headers: authHeaders(auth)
  });
  assert.equal(list.status, 200, JSON.stringify(list.payload, null, 2));
  assert.equal(list.payload.localAdapterVerified, true);
  assert.ok(list.payload.paths.includes(".pact-data/owner/note.txt"));
  assert.equal(list.payload.mapping.spaceKind, "agentDefault");
  assert.equal(list.payload.mapping.writable, true);
  assert.ok(list.payload.accessReceipt?.receiptId, "drive list must emit access receipt");
  assertPublicPayloadDoesNotLeak(list.payload, icloudRoot, "iCloud list payload");

  const download = await fetchJson(`${server.url}/api/external/cloud-drive/files/download?${new URLSearchParams({
    workspaceId,
    driveRef: icloudDriveRef,
    clientId: "owner",
    path: "default/note.txt",
    includeText: "true"
  })}`, {
    headers: authHeaders(auth)
  });
  assert.equal(download.status, 200, JSON.stringify(download.payload, null, 2));
  assert.equal(download.payload.content, "icloud default writable space\n");
  assert.ok(download.payload.transferReceipt?.transferReceiptId, "drive download must emit transfer receipt");
  assert.equal(download.payload.transferReceipt.state, "staged");

  const publicDownload = await fetchJson(`${server.url}/api/external/cloud-drive/files/download?${new URLSearchParams({
    workspaceId,
    driveRef: icloudDriveRef,
    clientId: "owner",
    path: "public/readme.txt",
    includeText: "true"
  })}`, {
    headers: authHeaders(auth)
  });
  assert.equal(publicDownload.status, 200, JSON.stringify(publicDownload.payload, null, 2));
  assert.equal(publicDownload.payload.content, "icloud public readonly space\n");
  assert.equal(publicDownload.payload.mapping.spaceKind, "public");
  assert.equal(publicDownload.payload.mapping.writable, false);

  const exposedDownload = await fetchJson(`${server.url}/api/external/cloud-drive/files/download?${new URLSearchParams({
    workspaceId,
    driveRef: icloudDriveRef,
    clientId: "owner",
    path: "team/team.txt",
    includeText: "true"
  })}`, {
    headers: authHeaders(auth)
  });
  assert.equal(exposedDownload.status, 200, JSON.stringify(exposedDownload.payload, null, 2));
  assert.equal(exposedDownload.payload.content, "icloud exposed readonly directory\n");
  assert.equal(exposedDownload.payload.mapping.spaceKind, "advancedExposure");
  assert.equal(exposedDownload.payload.mapping.writable, false);

  const upload = await fetchJson(`${server.url}/api/external/cloud-drive/files/upload`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(auth, { method: "POST" })
    },
    body: JSON.stringify({
      workspaceId,
      driveRef: icloudDriveRef,
      clientId: "owner",
      path: "default/uploaded.txt",
      content: "uploaded through Pact\n"
    })
  });
  assert.equal(upload.status, 201, JSON.stringify(upload.payload, null, 2));
  assert.equal(await fs.readFile(path.join(icloudRoot, ".pact-data", "owner", "uploaded.txt"), "utf8"), "uploaded through Pact\n");
  assert.equal(upload.payload.mapping.spaceKind, "agentDefault");
  assert.equal(upload.payload.mapping.writable, true);
  assert.ok(upload.payload.policyDecision?.decisionId, "drive upload must return policy decision");
  assert.ok(upload.payload.checkpoint?.checkpointId, "drive upload must return checkpoint");
  assert.ok(upload.payload.transferReceipt?.transferReceiptId, "drive upload must return transfer receipt");
  assert.equal(upload.payload.transferReceipt.state, "projected");

  const publicUpload = await fetchJson(`${server.url}/api/external/cloud-drive/files/upload`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(auth, { method: "POST" })
    },
    body: JSON.stringify({
      workspaceId,
      driveRef: icloudDriveRef,
      clientId: "owner",
      path: "public/blocked.txt",
      content: "must not write public\n"
    })
  });
  assert.equal(publicUpload.status, 400, JSON.stringify(publicUpload.payload, null, 2));

  const exposedUpload = await fetchJson(`${server.url}/api/external/cloud-drive/files/upload`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(auth, { method: "POST" })
    },
    body: JSON.stringify({
      workspaceId,
      driveRef: icloudDriveRef,
      clientId: "owner",
      path: "team/blocked.txt",
      content: "must not write exposed directory\n"
    })
  });
  assert.equal(exposedUpload.status, 400, JSON.stringify(exposedUpload.payload, null, 2));

  const syncPlan = await fetchJson(`${server.url}/api/external/cloud-drive/sync/plan`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(auth, { method: "POST" })
    },
    body: JSON.stringify({
      workspaceId,
      driveRef: icloudDriveRef,
      clientId: "owner",
      targetPath: "cloud-drive"
    })
  });
  assert.equal(syncPlan.status, 200, JSON.stringify(syncPlan.payload, null, 2));
  assert.equal(syncPlan.payload.dryRun, true);
  assert.ok(syncPlan.payload.actions.length >= 2, "iCloud local adapter sync plan should include local files");

  const syncApply = await fetchJson(`${server.url}/api/external/cloud-drive/sync/apply`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(auth, { method: "POST" })
    },
    body: JSON.stringify({
      workspaceId,
      driveRef: icloudDriveRef,
      clientId: "owner",
      targetPath: "cloud-drive",
      confirm: true
    })
  });
  assert.equal(syncApply.status, 200, JSON.stringify(syncApply.payload, null, 2));
  assert.equal(syncApply.payload.dryRun, false);
  assert.equal(syncApply.payload.syncReceipt.state, "projected");
  assert.equal(syncApply.payload.remoteSyncInvoked, false);
  assert.ok(syncApply.payload.checkpoint?.checkpointId, "drive sync apply must return checkpoint");

  const providerRefs = {};
  for (const provider of ["onedrive", "google-drive", "dropbox"]) {
    const connected = await fetchJson(`${server.url}/api/external/cloud-drive/connect`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(auth, { method: "POST" })
      },
      body: JSON.stringify({
        workspaceId,
        provider,
        secretRef: `secret://pact/drive/${provider}-oauth`,
        mode: "contract",
        managedFolder: true,
        managedFolderRoot: ".pact-data",
        publicFolder: "public",
        allowedClients: ["owner", "codex"],
        defaultClient: "owner",
        directoryMappings: [
          {
            name: "Team Docs",
            alias: "team",
            drivePath: "TeamDocs",
            accessPolicy: { mode: "all" }
          }
        ]
      })
    });
    assert.equal(connected.status, 200, JSON.stringify(connected.payload, null, 2));
    assert.equal(connected.payload.contractVerified, true, `${provider} must be contractVerified without real OAuth credentials`);
    assert.equal(connected.payload.drive.secretRef, `secret://pact/drive/${provider}-oauth`);
    assert.equal(connected.payload.drive.managedFolder.spaces.default.writable, true);
    assert.equal(connected.payload.drive.managedFolder.spaces.public.writable, false);
    assert.equal(connected.payload.drive.directoryMappings.some((mapping) => mapping.alias === "team" && mapping.writable === false), true);
    assert.equal(JSON.stringify(connected.payload).includes("accessToken"), false);
    providerRefs[provider] = connected.payload.drive.driveRef;
  }

  const remoteLiveConnect = await fetchJson(`${server.url}/api/external/cloud-drive/connect`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(auth, { method: "POST" })
    },
    body: JSON.stringify({
      workspaceId,
      provider: "google-drive",
      secretRef: "secret://pact/drive/google-drive-oauth",
      mode: "remote-live",
      endpointRef: "config://pact/drive/google-drive-fake-provider",
      endpointUrl: fakeProvider.url,
      managedFolder: true,
      managedFolderRoot: ".pact-data",
      publicFolder: "public",
      allowedClients: ["owner", "codex"],
      defaultClient: "codex"
    })
  });
  assert.equal(remoteLiveConnect.status, 200, JSON.stringify(remoteLiveConnect.payload, null, 2));
  assert.equal(remoteLiveConnect.payload.contractVerified, false, "remote-live connect must not be reported as contract verified");
  assert.equal(remoteLiveConnect.payload.remoteLiveVerified, true);
  assert.equal(remoteLiveConnect.payload.drive.mode, "remote-live");
  assert.equal(remoteLiveConnect.payload.drive.remoteLiveVerified, true);
  assert.ok(remoteLiveConnect.payload.telemetry.transferBytes > 0, "remote-live connect must expose transfer size telemetry");
  assert.ok(remoteLiveConnect.payload.telemetry.bytesPerSecond > 0, "remote-live connect must expose transfer rate telemetry");
  assert.equal(JSON.stringify(remoteLiveConnect.payload).includes(fakeProvider.url), false, "public remote-live connect payload must not expose endpointUrl");
  const remoteLiveDriveRef = remoteLiveConnect.payload.drive.driveRef;

  const remoteLiveList = await fetchJson(`${server.url}/api/external/cloud-drive/items?${new URLSearchParams({
    workspaceId,
    driveRef: remoteLiveDriveRef,
    clientId: "codex",
    path: "default",
    recursive: "true",
    includeHash: "true"
  })}`, {
    headers: authHeaders(auth)
  });
  assert.equal(remoteLiveList.status, 200, JSON.stringify(remoteLiveList.payload, null, 2));
  assert.equal(remoteLiveList.payload.remoteLiveVerified, true);
  assert.equal(remoteLiveList.payload.contractVerified, false);
  assert.equal(remoteLiveList.payload.paths.includes(".pact-data/codex/remote-seed.txt"), true);
  assert.ok(remoteLiveList.payload.items[0].provider.fileId, "remote-live list items must include provider file id metadata");
  assert.ok(remoteLiveList.payload.telemetry.transferBytes > 0, "remote-live list must expose transfer bytes");

  const remoteLiveDownload = await fetchJson(`${server.url}/api/external/cloud-drive/files/download?${new URLSearchParams({
    workspaceId,
    driveRef: remoteLiveDriveRef,
    clientId: "codex",
    path: "default/remote-seed.txt",
    includeText: "true"
  })}`, {
    headers: authHeaders(auth)
  });
  assert.equal(remoteLiveDownload.status, 200, JSON.stringify(remoteLiveDownload.payload, null, 2));
  assert.equal(remoteLiveDownload.payload.content, "remote live seeded file\n");
  assert.equal(remoteLiveDownload.payload.remoteReadInvoked, true);
  assert.equal(remoteLiveDownload.payload.remoteLiveVerified, true);
  assert.equal(remoteLiveDownload.payload.transferReceipt.state, "remoteLiveVerified");
  assert.ok(remoteLiveDownload.payload.transferReceipt.provider.fileId, "remote-live download receipt must include provider file id");
  assert.ok(remoteLiveDownload.payload.transferReceipt.provider.revision, "remote-live download receipt must include provider revision");
  assert.ok(remoteLiveDownload.payload.transferReceipt.provider.webUrl, "remote-live download receipt must include provider webUrl");
  assert.ok(remoteLiveDownload.payload.transferReceipt.provider.etag, "remote-live download receipt must include provider etag");
  assert.ok(remoteLiveDownload.payload.transferReceipt.telemetry.transferBytes > 0, "remote-live download receipt must include transfer bytes");
  assert.ok(remoteLiveDownload.payload.transferReceipt.telemetry.bytesPerSecond > 0, "remote-live download receipt must include transfer rate");

  const remoteLiveUpload = await fetchJson(`${server.url}/api/external/cloud-drive/files/upload`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(auth, { method: "POST" })
    },
    body: JSON.stringify({
      workspaceId,
      driveRef: remoteLiveDriveRef,
      clientId: "codex",
      path: "default/remote-upload.txt",
      content: "uploaded through remote live provider\n"
    })
  });
  assert.equal(remoteLiveUpload.status, 201, JSON.stringify(remoteLiveUpload.payload, null, 2));
  assert.equal(remoteLiveUpload.payload.remoteWriteInvoked, true);
  assert.equal(remoteLiveUpload.payload.remoteLiveVerified, true);
  assert.equal(remoteLiveUpload.payload.contractVerified, false);
  assert.equal(remoteLiveUpload.payload.transferReceipt.state, "remoteLiveVerified");
  assert.ok(remoteLiveUpload.payload.transferReceipt.provider.fileId, "remote-live upload receipt must include provider file id");
  assert.ok(remoteLiveUpload.payload.transferReceipt.provider.revision, "remote-live upload receipt must include provider revision");
  assert.ok(remoteLiveUpload.payload.transferReceipt.provider.webUrl, "remote-live upload receipt must include provider webUrl");
  assert.ok(remoteLiveUpload.payload.transferReceipt.provider.etag, "remote-live upload receipt must include provider etag");
  assert.ok(remoteLiveUpload.payload.transferReceipt.telemetry.transferBytes > 0, "remote-live upload receipt must include transfer bytes");
  assert.equal(fakeProvider.readFile(".pact-data/codex/remote-upload.txt").content.toString("utf8"), "uploaded through remote live provider\n");

  const dropboxPermissions = await fetchJson(`${server.url}/api/external/cloud-drive/permissions?${new URLSearchParams({
    workspaceId,
    driveRef: providerRefs.dropbox
  })}`, {
    headers: authHeaders(auth)
  });
  assert.equal(dropboxPermissions.status, 200, JSON.stringify(dropboxPermissions.payload, null, 2));
  assert.equal(dropboxPermissions.payload.contractVerified, true);
  assert.equal(JSON.stringify(dropboxPermissions.payload).includes("accessToken"), false);
  assert.equal(JSON.stringify(dropboxPermissions.payload).includes("refreshToken"), false);

  const grant = await fetchJson(`${server.url}/api/mcp/local-grant`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-pact-safety-confirm": "true"
    },
    body: JSON.stringify({
      targets: ["codex"],
      label: "verify-cloud-drive",
      connectorVersion: "verify",
      grantMode: "maintain",
      toolsets: [
        "pact.drive.read",
        "pact.drive.write",
        "pact.drive.sync",
        "pact.drive.share",
        "pact.agent.workspace.read"
      ]
    })
  });
  assert.equal(grant.status, 201, JSON.stringify(grant.payload, null, 2));

  const capabilities = await callMcp({
    serverUrl: server.url,
    token: grant.payload.token,
    toolName: "pact.discovery",
    operation: "pact.capabilities.list",
    input: {}
  });
  const operationNames = new Set((capabilities.operations || []).map((tool) => tool.name));
  for (const operationName of REQUIRED_OPERATIONS.map((operationId) => toolsByOperationId.get(operationId).id)) {
    assert.equal(operationNames.has(operationName), true, `${operationName} must be visible in MCP capabilities`);
  }

  const mcpListStructured = await callMcpStructured({
    serverUrl: server.url,
    token: grant.payload.token,
    operation: "pact.external.cloudDrive.item.list",
    input: {
      workspaceId,
      driveRef: providerRefs["google-drive"],
      clientId: "codex",
      recursive: true
    }
  });
  const mcpList = mcpListStructured.payload;
  assert.equal(mcpList.ok, true);
  assert.equal(mcpList.contractVerified, true);
  assert.equal(mcpList.items.every((item) => item.metadataOnly === true), true);
  assert.equal(mcpList.paths.some((itemPath) => itemPath.startsWith(".pact-data/codex/")), true);
  assert.equal(mcpList.paths.some((itemPath) => itemPath.startsWith(".pact-data/public/")), true);
  assert.equal(mcpListStructured.exchange, undefined, "external Cloud Drive is not a sharedspace exchange");
  assert.equal(mcpList.upstreamService.serviceId, "pact.upstream.cloud-drive");
  assert.equal(mcpList.upstreamService.upstreamType, "cloud-drive");
  assert.equal(mcpList.upstreamService.operationId, "external.cloudDrive.item.list");

  const mcpUploadStructured = await callMcpStructured({
    serverUrl: server.url,
    token: grant.payload.token,
    operation: "pact.external.cloudDrive.file.upload",
    input: {
      workspaceId,
      driveRef: providerRefs["google-drive"],
      clientId: "codex",
      path: ".pact-data/codex/mcp-upload.txt",
      content: "mcp cloud drive upload"
    }
  });
  const mcpUpload = mcpUploadStructured.payload;
  assert.equal(mcpUpload.ok, true);
  assert.equal(mcpUpload.contractVerified, true);
  assert.equal(mcpUpload.remoteWriteInvoked, false);
  assert.equal(mcpUploadStructured.exchange, undefined, "external Cloud Drive is not a sharedspace exchange");
  assert.equal(mcpUpload.upstreamService.serviceId, "pact.upstream.cloud-drive");
  assert.equal(mcpUpload.upstreamService.operationId, "external.cloudDrive.file.upload");
  assert.equal(mcpUpload.transferReceipt.operationId, "external.cloudDrive.file.upload");
  assert.equal(mcpUpload.checkpoint.operationId, "external.cloudDrive.file.upload");

  const mcpRemoteUploadStructured = await callMcpStructured({
    serverUrl: server.url,
    token: grant.payload.token,
    operation: "pact.external.cloudDrive.file.upload",
    input: {
      workspaceId,
      driveRef: remoteLiveDriveRef,
      clientId: "codex",
      path: "default/mcp-remote-live-upload.txt",
      content: "mcp remote live upload"
    }
  });
  const mcpRemoteUpload = mcpRemoteUploadStructured.payload;
  assert.equal(mcpRemoteUpload.ok, true);
  assert.equal(mcpRemoteUpload.remoteLiveVerified, true);
  assert.equal(mcpRemoteUpload.contractVerified, false);
  assert.equal(mcpRemoteUpload.remoteWriteInvoked, true);
  assert.equal(mcpRemoteUploadStructured.exchange, undefined, "external Cloud Drive is not a sharedspace exchange");
  assert.equal(mcpRemoteUpload.upstreamService.serviceId, "pact.upstream.cloud-drive");
  assert.equal(mcpRemoteUpload.upstreamService.operationId, "external.cloudDrive.file.upload");
  assert.ok(mcpRemoteUpload.providerReceipt.fileId, "MCP payload must carry provider file id for remote-live upload");
  assert.ok(mcpRemoteUpload.telemetry.transferBytes > 0, "MCP payload must carry remote-live transfer bytes");
  assert.ok(mcpRemoteUpload.telemetry.bytesPerSecond > 0, "MCP payload must carry remote-live transfer rate");
  assert.equal(fakeProvider.readFile(".pact-data/codex/mcp-remote-live-upload.txt").content.toString("utf8"), "mcp remote live upload");

  const mcpSyncStructured = await callMcpStructured({
    serverUrl: server.url,
    token: grant.payload.token,
    operation: "pact.external.cloudDrive.sync.apply",
    input: {
      workspaceId,
      driveRef: providerRefs.onedrive,
      clientId: "codex",
      targetPath: "cloud-drive",
      confirm: true
    }
  });
  const mcpSync = mcpSyncStructured.payload;
  assert.equal(mcpSync.ok, true);
  assert.equal(mcpSync.contractVerified, true);
  assert.equal(mcpSync.syncReceipt.state, "contractVerified");
  assert.equal(mcpSync.remoteSyncInvoked, false);
  assert.equal(mcpSyncStructured.exchange, undefined, "external Cloud Drive is not a sharedspace exchange");
  assert.equal(mcpSync.upstreamService.serviceId, "pact.upstream.cloud-drive");
  assert.equal(mcpSync.upstreamService.operationId, "external.cloudDrive.sync.apply");
  assert.equal(mcpSync.syncReceipt.operationId, "external.cloudDrive.sync.apply");
  assert.equal(mcpSync.checkpoint.operationId, "external.cloudDrive.sync.apply");

  const audit = await callMcp({
    serverUrl: server.url,
    token: grant.payload.token,
    operation: "pact.workspace.audit.query",
    input: {
      operationId: "external.cloudDrive.file.upload",
      limit: 20
    }
  });
  assert.ok(audit.items.some((item) => item.operationId === "external.cloudDrive.file.upload"), "drive upload must be queryable from operation audit");
} finally {
  if (fakeProvider?.close) {
    await fakeProvider.close().catch(() => {});
  }
  if (server?.close) {
    await server.close();
  }
  await fs.rm(userDataPath, { recursive: true, force: true }).catch(() => {});
  await fs.rm(icloudRoot, { recursive: true, force: true }).catch(() => {});
}

console.log("v0.0.1 cloud drive E2E verification passed");
