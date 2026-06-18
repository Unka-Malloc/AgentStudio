import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, it } from "node:test";

import {
  createOperationLedger,
  createPactiumHttpServer,
  createPactiumKernel,
  createMerkleStateSubstrate
} from "../../src/index.js";

const execFileAsync = promisify(execFile);
const tempDirs = [];

async function tempDataDir(prefix = "pactium-test-") {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    await fs.rm(tempDirs.pop(), { recursive: true, force: true });
  }
});

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address()));
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

function requestJson({ port, method = "GET", path: requestPath = "/", body = null }) {
  return new Promise((resolve, reject) => {
    const payload = body ? Buffer.from(JSON.stringify(body)) : null;
    const request = http.request({
      hostname: "127.0.0.1",
      port,
      method,
      path: requestPath,
      headers: payload
        ? {
            "content-type": "application/json",
            "content-length": payload.length
          }
        : {}
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        resolve({
          statusCode: response.statusCode,
          body: JSON.parse(Buffer.concat(chunks).toString("utf8"))
        });
      });
    });
    request.on("error", reject);
    if (payload) request.write(payload);
    request.end();
  });
}

describe("Pactium core", () => {
  it("records ledger entries with idempotent replay", async () => {
    const dataDir = await tempDataDir();
    const ledger = createOperationLedger({ dataDir });
    const first = ledger.startEntry({
      operationId: "workspace.write",
      workspaceId: "workspace-a",
      idempotencyKey: "same",
      input: { path: "docs/a.md", token: "secret" },
      subject: { type: "agent", id: "agent-a" },
      receiptRefs: ["checkpoint:root"]
    });
    const replay = ledger.startEntry({
      operationId: "workspace.write",
      workspaceId: "workspace-a",
      idempotencyKey: "same",
      input: { path: "docs/a.md", token: "secret" }
    });

    assert.equal(replay.ledgerEventId, first.ledgerEventId);
    assert.equal(replay.replayed, true);

    const completed = ledger.completeEntry(first.ledgerEventId, {
      receiptRefs: ["state:commit-a"]
    });
    assert.equal(completed.status, "succeeded");
    assert.deepEqual(completed.receiptRefs, ["checkpoint:root", "state:commit-a"]);
    assert.equal(ledger.listEntries({ workspaceId: "workspace-a" }).count, 1);
  });

  it("manages checkpoint restore as an append-only marker", async () => {
    const kernel = createPactiumKernel({ dataDir: await tempDataDir() });
    const treeId = kernel.checkpointTree.id("workspace", "checkpoint");
    await kernel.checkpointTree.startTree({
      treeId,
      kind: "workflow",
      ownerId: "workspace-a",
      rootNodeId: "root",
      rootLabel: "Root"
    });
    await kernel.checkpointTree.upsertNode({
      treeId,
      nodeId: "child",
      parentId: "root",
      label: "Child",
      status: "completed"
    });

    const preview = await kernel.checkpointTree.previewRestore({
      treeId,
      nodeId: "child",
      reason: "test"
    });
    assert.equal(preview.dryRun, true);
    assert.equal(preview.applied, false);
    assert.equal(preview.nodeId, "child");
    assert.equal(preview.canApply, true);

    const restored = await kernel.checkpointTree.restore({
      treeId,
      nodeId: "child",
      actor: "unit",
      reason: "test"
    });
    assert.equal(restored.applied, true);
    assert.match(restored.markerNodeId, /^restore:child:checkpoint_restore_/);

    const scope = await kernel.checkpointTree.queryScope({ treeId, nodeId: "child" });
    assert.ok(scope.nodes.map((node) => node.nodeId).includes(restored.markerNodeId));
  });

  it("stores content-addressed values and verifies state commits", async () => {
    const substrate = createMerkleStateSubstrate({ dataDir: await tempDataDir() });
    const block = await substrate.cas.putBlock({ title: "Alpha" });
    assert.match(block.cid, /^cid:sha256:/);

    const commit = await substrate.stateCommit.commit({
      scope: "workspace-a",
      operationId: "state.put",
      mutations: [
        { action: "put", key: "docs/a.json", valueRef: block.cid }
      ],
      contentRefs: [block.cid],
      payload: { source: "unit" }
    });
    assert.match(commit.commitId, /^state_commit_/);

    const verification = await substrate.stateCommit.verifyCommit(commit.commitId);
    assert.equal(verification.ok, true);
    assert.equal(verification.commit.commitId, commit.commitId);
  });

  it("records an operation across ledger, checkpoint tree, and state commit", async () => {
    const kernel = createPactiumKernel({ dataDir: await tempDataDir() });
    const result = await kernel.recordOperation({
      operationId: "workspace.file.write",
      workspaceId: "workspace-a",
      subject: { type: "agent", id: "agent-a" },
      effectKind: "file.changed",
      state: {
        mutations: [
          {
            action: "put",
            key: "docs/a.md",
            value: { text: "hello" }
          }
        ]
      }
    });

    assert.match(result.ledgerEventId, /^operation_ledger_/);
    assert.match(result.checkpointTreeId, /^checkpoint_tree_/);
    assert.match(result.checkpointNodeId, /operation:operation_ledger_/);
    assert.match(result.stateCommitId, /^state_commit_/);

    const entry = kernel.ledger.getEntry(result.ledgerEventId);
    assert.equal(entry.status, "succeeded");
    assert.equal(entry.operationId, "workspace.file.write");

    const verification = await kernel.merkleState.stateCommit.verifyCommit(result.stateCommitId);
    assert.equal(verification.ok, true);
  });
});

describe("Pactium facades", () => {
  it("runs CLI doctor and ledger list", async () => {
    const dataDir = await tempDataDir();
    const node = process.execPath;
    const cliPath = path.resolve("bin/pactium.mjs");
    const doctor = await execFileAsync(node, [cliPath, "doctor", "--data-dir", dataDir], {
      cwd: path.resolve(".")
    });
    const doctorResult = JSON.parse(doctor.stdout);
    assert.equal(doctorResult.ok, true);
    assert.equal(doctorResult.dataDir, dataDir);

    await execFileAsync(node, [
      cliPath,
      "operation",
      "record",
      "--data-dir",
      dataDir,
      "--body",
      JSON.stringify({ operationId: "cli.operation", workspaceId: "cli" })
    ]);

    const list = await execFileAsync(node, [cliPath, "ledger", "list", "--data-dir", dataDir], {
      cwd: path.resolve(".")
    });
    const parsed = JSON.parse(list.stdout);
    assert.equal(parsed.count, 1);
    assert.equal(parsed.items[0].operationId, "cli.operation");
  });

  it("runs CLI checkpoint restore preview and state commit verify", async () => {
    const dataDir = await tempDataDir();
    const node = process.execPath;
    const cliPath = path.resolve("bin/pactium.mjs");
    const treeId = "checkpoint_tree_00000000000000000000000000000000";

    await execFileAsync(node, [
      cliPath,
      "checkpoint",
      "start",
      "--data-dir",
      dataDir,
      "--body",
      JSON.stringify({
        treeId,
        kind: "workflow",
        ownerId: "cli",
        rootNodeId: "root",
        rootLabel: "Root"
      })
    ]);
    await execFileAsync(node, [
      cliPath,
      "checkpoint",
      "upsert-node",
      "--data-dir",
      dataDir,
      "--body",
      JSON.stringify({
        treeId,
        nodeId: "child",
        parentId: "root",
        label: "Child"
      })
    ]);
    const preview = await execFileAsync(node, [
      cliPath,
      "checkpoint",
      "restore-preview",
      treeId,
      "--data-dir",
      dataDir,
      "--body",
      JSON.stringify({ nodeId: "child" })
    ]);
    const previewResult = JSON.parse(preview.stdout);
    assert.equal(previewResult.dryRun, true);
    assert.equal(previewResult.applied, false);
    assert.equal(previewResult.nodeId, "child");

    const commit = await execFileAsync(node, [
      cliPath,
      "state",
      "commit",
      "--data-dir",
      dataDir,
      "--body",
      JSON.stringify({
        scope: "cli",
        operationId: "cli.state",
        mutations: [
          { action: "put", key: "docs/a.json", value: { ok: true } }
        ]
      })
    ]);
    const commitResult = JSON.parse(commit.stdout);
    assert.match(commitResult.commitId, /^state_commit_/);

    const verification = await execFileAsync(node, [
      cliPath,
      "state",
      "verify",
      commitResult.commitId,
      "--data-dir",
      dataDir
    ]);
    const verifyResult = JSON.parse(verification.stdout);
    assert.equal(verifyResult.ok, true);
    assert.equal(verifyResult.commit.commitId, commitResult.commitId);
  });

  it("serves health, protocols, operation record, and checkpoint restore preview over HTTP", async () => {
    const kernel = createPactiumKernel({ dataDir: await tempDataDir() });
    const server = createPactiumHttpServer({ kernel });
    const address = await listen(server);
    try {
      const health = await requestJson({ port: address.port, path: "/health" });
      assert.equal(health.statusCode, 200);
      assert.equal(health.body.ok, true);

      const recorded = await requestJson({
        port: address.port,
        method: "POST",
        path: "/operations",
        body: { operationId: "http.operation", workspaceId: "http" }
      });
      assert.equal(recorded.statusCode, 200);
      assert.match(recorded.body.ledgerEventId, /^operation_ledger_/);
      assert.match(recorded.body.checkpointTreeId, /^checkpoint_tree_/);

      const preview = await requestJson({
        port: address.port,
        method: "POST",
        path: `/checkpoint-trees/${recorded.body.checkpointTreeId}/restore-preview`,
        body: { nodeId: recorded.body.checkpointNodeId }
      });
      assert.equal(preview.statusCode, 200);
      assert.equal(preview.body.dryRun, true);
      assert.equal(preview.body.applied, false);
      assert.equal(preview.body.nodeId, recorded.body.checkpointNodeId);

      const protocols = await requestJson({ port: address.port, path: "/protocols" });
      assert.equal(protocols.statusCode, 200);
      assert.equal(protocols.body.name, "Pactium");
    } finally {
      await close(server);
    }
  });
});
