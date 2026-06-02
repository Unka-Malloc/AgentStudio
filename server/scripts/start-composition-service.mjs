#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_ROOT = path.resolve(SCRIPT_DIR, "../..");
const EXTERNAL_CONFIG_PATH = path.join(SOURCE_ROOT, "composition", "external-service.config.json");

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonIfExists(filePath) {
  if (!(await pathExists(filePath))) {
    return null;
  }
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || SOURCE_ROOT,
      stdio: options.stdio || "inherit",
      env: {
        ...process.env,
        COPYFILE_DISABLE: "1",
        ...(options.env || {})
      }
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code}`));
        return;
      }
      resolve();
    });
  });
}

function spawnLongRunning(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd || SOURCE_ROOT,
    stdio: options.stdio || "inherit",
    env: {
      ...process.env,
      COPYFILE_DISABLE: "1",
      ...(options.env || {})
    }
  });
  child.once("error", (error) => {
    process.stderr.write(`External service failed to start: ${error.message}\n`);
  });
  return child;
}

async function runExternalStep(step, { optional = true, longRunning = false } = {}) {
  const args = ["server/scripts/composition-external-service.mjs", step];
  if (longRunning) {
    return spawnLongRunning(process.execPath, args);
  }
  try {
    await run(process.execPath, args);
    return null;
  } catch (error) {
    if (optional) {
      process.stderr.write(`External service ${step} skipped or failed: ${error instanceof Error ? error.message : String(error)}\n`);
      return null;
    }
    throw error;
  }
}

async function main() {
  const config = await readJsonIfExists(EXTERNAL_CONFIG_PATH);
  const externalChildren = [];
  if (config?.startupPolicy === "with-platform") {
    await runExternalStep("prepare", { optional: true });
    const startScript = config.scripts?.start || {};
    const child = await runExternalStep("start", {
      optional: false,
      longRunning: startScript.longRunning === true
    });
    if (child) {
      externalChildren.push(child);
    }
    if (config.healthCheck?.required === true) {
      await runExternalStep("health", { optional: false });
    }
  }

  const serverArgs = [
    "server/scripts/start-server.mjs",
    "--with-ui",
    ...process.argv.slice(2)
  ];
  const server = spawnLongRunning(process.execPath, serverArgs);
  const stopChildren = () => {
    for (const child of externalChildren) {
      if (!child.killed) {
        child.kill("SIGTERM");
      }
    }
    if (!server.killed) {
      server.kill("SIGTERM");
    }
  };
  process.once("SIGTERM", stopChildren);
  process.once("SIGINT", stopChildren);
  server.once("exit", (code) => {
    stopChildren();
    process.exitCode = code || 0;
  });
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
