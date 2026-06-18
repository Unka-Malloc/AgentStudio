#!/usr/bin/env node
import fs from "node:fs/promises";
import { createPactiumKernel } from "../src/kernel.js";
import { startPactiumHttpServer } from "../src/http.js";
import { resolveDataDir } from "../src/paths.js";

function argValue(args, name, fallback = "") {
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : fallback;
}

function hasArg(args, name) {
  return args.includes(name);
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function bodyFromArgs(args) {
  const inline = argValue(args, "--body", "");
  if (inline) return JSON.parse(inline);
  const file = argValue(args, "--body-file", "");
  if (file) return JSON.parse(await fs.readFile(file, "utf8"));
  if (!process.stdin.isTTY) {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    const text = Buffer.concat(chunks).toString("utf8").trim();
    if (text) return JSON.parse(text);
  }
  return {};
}

function usage() {
  return `Pactium

Usage:
  pactium doctor [--data-dir DIR]
  pactium serve [--data-dir DIR] [--host HOST] [--port PORT]
  pactium operation record --body JSON
  pactium ledger list [--operation-id ID] [--workspace-id ID] [--status STATUS]
  pactium ledger get LEDGER_EVENT_ID
  pactium checkpoint list [--kind KIND] [--owner-id ID]
  pactium checkpoint get CHECKPOINT_TREE_ID
  pactium checkpoint start --body JSON
  pactium checkpoint upsert-node --body JSON
  pactium checkpoint restore-preview CHECKPOINT_TREE_ID --body JSON
  pactium checkpoint restore CHECKPOINT_TREE_ID --body JSON
  pactium state commit --body JSON
  pactium state verify STATE_COMMIT_ID
`;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || hasArg(args, "--help") || hasArg(args, "-h")) {
    process.stdout.write(usage());
    return;
  }
  const dataDir = resolveDataDir(argValue(args, "--data-dir", ""));
  const kernel = createPactiumKernel({ dataDir });
  const [domain, action, subject] = args.filter((arg, index, all) => {
    if (index > 0 && all[index - 1].startsWith("--")) return false;
    return !arg.startsWith("--");
  });

  if (domain === "doctor") {
    printJson(await kernel.doctor());
    return;
  }
  if (domain === "serve") {
    const host = argValue(args, "--host", "127.0.0.1");
    const port = Number(argValue(args, "--port", process.env.PACTIUM_HTTP_PORT || "7288"));
    const started = await startPactiumHttpServer({ dataDir, host, port });
    printJson({
      protocolVersion: started.protocolVersion,
      url: started.url,
      dataDir
    });
    return;
  }
  if (domain === "operation" && action === "record") {
    printJson(await kernel.recordOperation(await bodyFromArgs(args)));
    return;
  }
  if (domain === "ledger" && action === "list") {
    printJson(kernel.ledger.listEntries({
      operationId: argValue(args, "--operation-id", ""),
      workspaceId: argValue(args, "--workspace-id", ""),
      status: argValue(args, "--status", ""),
      limit: argValue(args, "--limit", "100")
    }));
    return;
  }
  if (domain === "ledger" && action === "get") {
    const entry = kernel.ledger.getEntry(subject);
    if (!entry) {
      process.exitCode = 2;
      printJson({ code: "not_found", error: "Ledger entry not found." });
      return;
    }
    printJson(entry);
    return;
  }
  if (domain === "checkpoint" && action === "list") {
    printJson({
      protocolVersion: kernel.checkpointTree.protocolVersion,
      items: await kernel.checkpointTree.list({
        kind: argValue(args, "--kind", ""),
        ownerId: argValue(args, "--owner-id", ""),
        limit: argValue(args, "--limit", "100")
      })
    });
    return;
  }
  if (domain === "checkpoint" && action === "get") {
    const tree = await kernel.checkpointTree.load({ treeId: subject });
    if (!tree) {
      process.exitCode = 2;
      printJson({ code: "not_found", error: "Checkpoint tree not found." });
      return;
    }
    printJson(tree);
    return;
  }
  if (domain === "checkpoint" && action === "start") {
    printJson(await kernel.checkpointTree.startTree(await bodyFromArgs(args)));
    return;
  }
  if (domain === "checkpoint" && action === "upsert-node") {
    printJson(await kernel.checkpointTree.upsertNode(await bodyFromArgs(args)));
    return;
  }
  if (domain === "checkpoint" && action === "restore-preview") {
    printJson(await kernel.checkpointTree.previewRestore({
      ...(await bodyFromArgs(args)),
      treeId: subject
    }));
    return;
  }
  if (domain === "checkpoint" && action === "restore") {
    printJson(await kernel.checkpointTree.restore({
      ...(await bodyFromArgs(args)),
      treeId: subject
    }));
    return;
  }
  if (domain === "state" && action === "commit") {
    printJson(await kernel.merkleState.stateCommit.commit(await bodyFromArgs(args)));
    return;
  }
  if (domain === "state" && action === "verify") {
    printJson(await kernel.merkleState.stateCommit.verifyCommit(subject));
    return;
  }
  process.exitCode = 1;
  process.stderr.write(usage());
}

main().catch((error) => {
  process.exitCode = 1;
  printJson({
    code: "pactium_cli_error",
    error: error instanceof Error ? error.message : String(error)
  });
});
