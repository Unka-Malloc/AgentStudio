#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const repoRoot = path.resolve(new URL("../..", import.meta.url).pathname);
const portableDir = await fs.mkdtemp(path.join(os.tmpdir(), "pact-cli-smoke-"));

function runClient(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("cargo", [
      "run",
      "--quiet",
      "--manifest-path",
      "client-cli/Cargo.toml",
      "--bin",
      "pact-client",
      "--",
      ...args
    ], {
      cwd: repoRoot,
      env: {
        ...process.env,
        PACT_PORTABLE_DIR: portableDir
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.once("error", reject);
    child.once("close", (code) => {
      resolve({
        code,
        stdout: Buffer.concat(stdout).toString("utf8").trim(),
        stderr: Buffer.concat(stderr).toString("utf8").trim()
      });
    });
  });
}

async function runJson(args) {
  const result = await runClient(args);
  assert.equal(result.code, 0, `pact-client ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  try {
    return JSON.parse(result.stdout || "{}");
  } catch (error) {
    throw new Error(`pact-client ${args.join(" ")} did not print JSON: ${error.message}\n${result.stdout}`);
  }
}

try {
  const empty = await runClient([]);
  assert.equal(empty.code, 0);
  assert.match(empty.stderr, /Usage:/);

  const settings = await runJson(["state", "get", "settings"]);
  assert.equal(settings.ok, true);
  assert.equal(settings.collection, "settings");
  assert.equal(settings.document?.schemaVersion, 1);

  const targets = await runJson(["targets", "scan"]);
  assert.equal(targets.ok, true);
  assert.equal(Array.isArray(targets.candidates), true);
  assert.ok(targets.candidates.some((candidate) => candidate.target === "codex"));

  const profiles = await runJson(["model", "profiles", "list"]);
  assert.equal(profiles.ok, true);
  assert.equal(Array.isArray(profiles.profiles), true);

  const activity = await runJson(["activity", "list"]);
  assert.equal(activity.ok, true);
  assert.equal(Array.isArray(activity.events), true);

  console.log("client CLI smoke passed");
} finally {
  await fs.rm(portableDir, { recursive: true, force: true });
}
