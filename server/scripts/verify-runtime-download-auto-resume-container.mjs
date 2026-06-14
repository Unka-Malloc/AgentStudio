#!/usr/bin/env node
import assert from "node:assert/strict";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const DEFAULT_NODE_IMAGE = "node:24-bookworm";

function parseArgs(argv = process.argv.slice(2)) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const [rawKey, inlineValue] = token.includes("=")
      ? token.slice(2).split(/=(.*)/s, 2)
      : [token.slice(2), null];
    const key = rawKey.trim();
    const value = inlineValue !== null
      ? inlineValue
      : argv[index + 1] && !argv[index + 1].startsWith("--")
        ? argv[++index]
        : true;
    parsed[key] = value;
  }
  return parsed;
}

function run(command, args = [], options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || repoRoot,
    env: { ...process.env, ...(options.env || {}) },
    encoding: "utf8",
    timeout: options.timeoutMs || 120000,
    maxBuffer: options.maxBuffer || 64 * 1024 * 1024
  });
  if (options.allowFailure) return result;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed:\n${result.stdout || ""}${result.stderr || ""}`);
  }
  return result;
}

function docker(args = [], options = {}) {
  return run("docker", args, options);
}

function numberValue(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid number: ${value}`);
  }
  return parsed;
}

function printUsageAndExit(code = 0) {
  console.log(`Verify Pact runtime download automatic resume in a fresh container

Usage:
  node server/scripts/verify-runtime-download-auto-resume-container.mjs

Options:
  --node-image IMAGE   Node image used for the fresh container. Default: ${DEFAULT_NODE_IMAGE}
  --timeout-ms N       Docker run timeout. Default: 120000
`);
  process.exit(code);
}

function innerScript() {
  return String.raw`
import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const root = "/tmp/pact-gerrit-resume-test";
const source = "/tmp/pact-gerrit-resume-source.war";
const size = 4 * 1024 * 1024;
await fsp.rm(root, { recursive: true, force: true });
await fsp.mkdir(root, { recursive: true });
const payload = Buffer.alloc(size);
for (let index = 0; index < payload.length; index += 1) {
  payload[index] = index % 251;
}
await fsp.writeFile(source, payload);

const requests = [];
let first = true;
const server = http.createServer((request, response) => {
  if (request.url !== "/gerrit.war") {
    response.writeHead(404);
    response.end();
    return;
  }
  const stat = fs.statSync(source);
  const range = String(request.headers.range || "");
  requests.push(range || "none");
  const match = range.match(/^bytes=(\d+)-$/);
  const start = match ? Number(match[1]) : 0;
  if (match && start < stat.size) {
    response.writeHead(206, {
      "accept-ranges": "bytes",
      "content-range": ` + "`bytes ${start}-${stat.size - 1}/${stat.size}`" + `,
      "content-length": stat.size - start
    });
    fs.createReadStream(source, { start }).pipe(response);
    return;
  }
  response.writeHead(200, {
    "accept-ranges": "bytes",
    "content-length": stat.size
  });
  if (first) {
    first = false;
    const stream = fs.createReadStream(source, { start: 0, end: 1024 * 1024 - 1 });
    stream.pipe(response, { end: false });
    stream.on("end", () => response.destroy());
    return;
  }
  fs.createReadStream(source).pipe(response);
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const child = spawn(process.execPath, [
  "/workspace/server/scripts/gerrit-local.mjs",
  "download",
  "--version",
  "resume-test",
  "--root",
  root,
  "--war-url",
  ` + "`http://127.0.0.1:${port}/gerrit.war`" + `
], {
  cwd: "/workspace",
  env: {
    ...process.env,
    PACT_SERVER_DATA_DIR: "/tmp/pact-data",
    PACT_RUNTIME_DOWNLOAD_RETRY_ATTEMPTS: "3",
    PACT_RUNTIME_DOWNLOAD_RETRY_DELAY_MS: "200",
    PACT_RUNTIME_DOWNLOAD_RETRY_MAX_DELAY_MS: "200"
  },
  stdio: ["ignore", "pipe", "pipe"]
});
let stdout = "";
let stderr = "";
child.stdout.on("data", (chunk) => {
  stdout += chunk.toString();
  process.stdout.write(chunk);
});
child.stderr.on("data", (chunk) => {
  stderr += chunk.toString();
  process.stderr.write(chunk);
});
const code = await new Promise((resolve) => child.on("close", resolve));
server.close();

const destination = path.join(root, "downloads", "gerrit-resume-test.war");
const actual = await fsp.readFile(destination).catch(() => null);
const resumed = requests.some((item) => item.startsWith("bytes="));
const matchesPayload = actual && Buffer.compare(actual, payload) === 0;
const outputIncludesResume = /resuming from/.test(stdout + stderr);
const ok = code === 0 && resumed && matchesPayload && outputIncludesResume;
console.log(JSON.stringify({
  ok,
  code,
  requests,
  destinationSize: actual?.length || 0,
  resumed,
  matchesPayload: Boolean(matchesPayload),
  outputIncludesResume
}, null, 2));
process.exit(ok ? 0 : 1);
`;
}

async function main() {
  const args = parseArgs();
  if (args.help) {
    printUsageAndExit(0);
  }
  const nodeImage = String(args["node-image"] || process.env.PACT_RUNTIME_DOWNLOAD_NODE_IMAGE || DEFAULT_NODE_IMAGE).trim();
  const timeoutMs = numberValue(args["timeout-ms"], 120000);
  assert.equal(docker(["--version"], { allowFailure: true }).status, 0, "Docker must be available.");
  docker(["image", "inspect", nodeImage], { allowFailure: true }).status === 0 ||
    docker(["pull", nodeImage], { timeoutMs: 900000, maxBuffer: 64 * 1024 * 1024 });
  const result = docker([
    "run",
    "--rm",
    "-v",
    `${repoRoot}:/workspace:ro`,
    "-w",
    "/workspace",
    nodeImage,
    "node",
    "--input-type=module",
    "-e",
    innerScript()
  ], { allowFailure: true, timeoutMs, maxBuffer: 64 * 1024 * 1024 });
  process.stdout.write(result.stdout || "");
  process.stderr.write(result.stderr || "");
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
