#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const runId = `${process.pid}-${Date.now()}`;
const image = process.env.PACT_WORK_QUEUE_BENCH_IMAGE || `pact-work-queue-capacity-bench:${runId}`;
const buildImage = process.env.PACT_WORK_QUEUE_BENCH_IMAGE ? false : process.env.PACT_WORK_QUEUE_BENCH_BUILD !== "0";
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pact-work-queue-bench-"));

function run(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || process.cwd(),
      env: { ...process.env, ...(options.env || {}) },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5000).unref();
    }, Number(options.timeoutMs || 1800000));
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
      if (options.stream) process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
      if (options.stream) process.stderr.write(chunk);
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const error = new Error(`${command} ${args.join(" ")} failed code=${code} signal=${signal || ""}\n${stdout}\n${stderr}`);
      error.stdout = stdout;
      error.stderr = stderr;
      error.code = code;
      error.signal = signal || "";
      reject(error);
    });
  });
}

async function docker(args = [], options = {}) {
  return run("docker", args, options);
}

function parseLastJson(stdout = "") {
  const text = String(stdout || "").trim();
  const start = text.lastIndexOf("\n{");
  const candidate = start >= 0 ? text.slice(start + 1) : text;
  return JSON.parse(candidate);
}

async function prepareDataVolume(volume) {
  const owner = process.env.PACT_WORK_QUEUE_BENCH_CONTAINER_OWNER || "10001:10001";
  await docker([
    "run", "--rm",
    "--user", "0:0",
    "-v", `${volume}:/data`,
    image,
    "sh", "-lc", `mkdir -p /data/probe && chown -R ${owner} /data`
  ], { timeoutMs: 120000 });
}

function forwardedProbeEnv(candidates) {
  const entries = [
    ["PACT_WORK_QUEUE_PROBE_CANDIDATES", candidates],
    ["PACT_WORK_QUEUE_PROBE_DATA_DIR", "/data/probe"]
  ];
  for (const name of [
    "PACT_WORK_QUEUE_PROBE_TOTAL_MULTIPLIER",
    "PACT_WORK_QUEUE_PROBE_TIMEOUT_MS",
    "PACT_WORK_QUEUE_PROBE_HANDLER_DELAY_MS"
  ]) {
    if (process.env[name] !== undefined) {
      entries.push([name, process.env[name]]);
    }
  }
  return entries.flatMap(([name, value]) => ["-e", `${name}=${value}`]);
}

async function runScenario({ label, cpus, memory, candidates }) {
  const volume = `pact-work-queue-bench-${label}-${runId}`.replace(/[^a-zA-Z0-9_.-]/g, "-");
  try {
    await docker(["volume", "create", volume], { timeoutMs: 60000 });
    await prepareDataVolume(volume);
    try {
      const result = await docker([
        "run", "--rm",
        "--cpus", String(cpus),
        "--memory", memory,
        "-v", `${volume}:/data`,
        ...forwardedProbeEnv(candidates),
        image,
        "node", "server/scripts/run-work-queue-capacity-probe.mjs"
      ], { timeoutMs: Number(process.env.PACT_WORK_QUEUE_BENCH_TIMEOUT_MS || 900000), stream: true });
      return {
        label,
        cpus,
        memory,
        ...parseLastJson(result.stdout)
      };
    } catch (error) {
      const firstCandidate = String(candidates || "")
        .split(",")
        .map((item) => Number(item.trim()))
        .find((item) => Number.isFinite(item) && item > 0) || 0;
      let parsed = null;
      try {
        parsed = parseLastJson(error.stdout || "");
      } catch {
        parsed = null;
      }
      if (parsed && typeof parsed === "object") {
        return {
          label,
          cpus,
          memory,
          ...parsed,
          ok: false,
          processFailure: {
            code: error.code || 0,
            signal: error.signal || "",
            stderrTail: String(error.stderr || "").split("\n").slice(-12).join("\n")
          }
        };
      }
      return {
        label,
        cpus,
        memory,
        ok: false,
        maxPassedConcurrency: 0,
        candidates: String(candidates || "").split(",").map((item) => Number(item.trim())).filter(Boolean),
        results: [
          {
            candidate: firstCandidate,
            ok: false,
            error: error instanceof Error ? error.message.split("\n").slice(0, 8).join("\n") : String(error)
          }
        ],
        processFailure: {
          code: error.code || 0,
          signal: error.signal || "",
          stderrTail: String(error.stderr || "").split("\n").slice(-12).join("\n")
        }
      };
    }
  } finally {
    await docker(["volume", "rm", "-f", volume]).catch(() => null);
  }
}

async function main() {
  await docker(["version", "--format", "{{.Server.Version}} {{.Server.Os}}/{{.Server.Arch}}"], { timeoutMs: 60000, stream: true });
  if (buildImage) {
    await docker([
      "build",
      "--progress=plain",
      "-t", image,
      "."
    ], { timeoutMs: Number(process.env.PACT_WORK_QUEUE_BENCH_BUILD_TIMEOUT_MS || 3600000), stream: true });
  }
  const candidates = process.env.PACT_WORK_QUEUE_BENCH_CANDIDATES || "16,32,64,128,256,512,1024";
  const scenarios = [
    { label: "1c-1gb", cpus: 1, memory: "1g", candidates },
    { label: "2c-4gb", cpus: 2, memory: "4g", candidates }
  ];
  const results = [];
  try {
    for (const scenario of scenarios) {
      results.push(await runScenario(scenario));
    }
    const report = {
      ok: results.every((item) => item.ok !== false && item.maxPassedConcurrency > 0),
      image,
      runId,
      scenarios: results
    };
    console.log(JSON.stringify(report, null, 2));
  } finally {
    if (buildImage && process.env.PACT_WORK_QUEUE_BENCH_KEEP_IMAGE !== "1") {
      await docker(["image", "rm", "-f", image]).catch(() => null);
    }
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => null);
  }
}

await main();
