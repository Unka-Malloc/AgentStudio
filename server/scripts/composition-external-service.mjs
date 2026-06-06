#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  normalizeExternalServiceConfig,
  validateExternalServiceConfig
} from "../platform/common/composition-management/external-service-adapter.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_ROOT = path.resolve(SCRIPT_DIR, "../..");
const DEFAULT_CONFIG = path.join(SOURCE_ROOT, "composition", "external-service.config.json");

function parseArgs(argv) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) {
      args._.push(item);
      continue;
    }
    const keyValue = item.slice(2);
    const equalIndex = keyValue.indexOf("=");
    const key = equalIndex >= 0 ? keyValue.slice(0, equalIndex) : keyValue;
    const inlineValue = equalIndex >= 0 ? keyValue.slice(equalIndex + 1) : null;
    const next = argv[index + 1];
    if (inlineValue !== null) {
      args[key] = inlineValue;
    } else if (next && !next.startsWith("--")) {
      args[key] = next;
      index += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}

function usage() {
  return [
    "Usage:",
    "  node server/scripts/composition-external-service.mjs verify [--config composition/external-service.config.json]",
    "  node server/scripts/composition-external-service.mjs prepare|start|stop|doctor|smoke|health",
    "",
    "The script executes the external service scripts declared by composition/external-service.config.json."
  ].join("\n");
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function loadConfig(args = {}) {
  const configPath = path.resolve(SOURCE_ROOT, String(args.config || DEFAULT_CONFIG));
  if (!(await pathExists(configPath))) {
    return {
      configPath,
      config: null
    };
  }
  const raw = JSON.parse(await fs.readFile(configPath, "utf8"));
  return {
    configPath,
    config: normalizeExternalServiceConfig(raw)
  };
}

function scriptCommand(script) {
  if (script.command?.executable) {
    return {
      command: script.command.executable,
      args: script.command.args || []
    };
  }
  const scriptPath = String(script.path || "").trim();
  if (!scriptPath) {
    return null;
  }
  const absolutePath = path.isAbsolute(scriptPath) ? scriptPath : path.join(SOURCE_ROOT, scriptPath);
  const extension = path.extname(scriptPath);
  if (extension === ".mjs" || extension === ".js" || extension === ".cjs") {
    return {
      command: process.execPath,
      args: [absolutePath, ...(script.args || [])]
    };
  }
  return {
    command: absolutePath,
    args: script.args || []
  };
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

async function runScript(config, id, { optional = false } = {}) {
  const script = config?.scripts?.[id];
  if (!script) {
    if (optional) {
      return { ok: true, skipped: true, scriptId: id };
    }
    throw new Error(`External service script is not configured: ${id}`);
  }
  const command = scriptCommand(script);
  if (!command) {
    throw new Error(`External service script ${id} is missing command/path.`);
  }
  const cwd = script.cwd ? path.resolve(SOURCE_ROOT, script.cwd) : SOURCE_ROOT;
  await run(command.command, command.args, {
    cwd,
    env: script.env || {}
  });
  return { ok: true, scriptId: id, command: command.command, args: command.args };
}

async function healthCheck(config) {
  const health = config?.healthCheck || {};
  if (!health || health.type === "none") {
    return { ok: true, skipped: true, reason: "no health check configured" };
  }
  if (health.type !== "http") {
    throw new Error(`Unsupported external service health check type: ${health.type}`);
  }
  const url = health.url || `http://${health.host || "127.0.0.1"}:${health.port}${health.path || "/"}`;
  const timeoutMs = Number(health.timeoutMs || 60000);
  const startedAt = Date.now();
  let lastError = "";
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      const text = await response.text();
      if (response.ok) {
        return { ok: true, url, status: response.status, body: text.slice(0, 500) };
      }
      lastError = `${response.status} ${text.slice(0, 500)}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return { ok: false, url, error: lastError };
}

async function verifyConfig({ config, configPath }) {
  if (!config) {
    return {
      ok: true,
      skipped: true,
      configPath,
      reason: "no external service config"
    };
  }
  const validation = await validateExternalServiceConfig({
    config,
    cwd: SOURCE_ROOT,
    requireKnownPaths: true
  });
  return {
    ok: validation.ok,
    configPath,
    serviceId: config.serviceId,
    serviceName: config.serviceName,
    mode: config.mode,
    startupPolicy: config.startupPolicy,
    scripts: Object.keys(config.scripts || {}).sort(),
    healthCheck: config.healthCheck,
    validation
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const command = args._[0] || "verify";
  const loaded = await loadConfig(args);
  const { config } = loaded;

  if (command === "verify") {
    const result = await verifyConfig(loaded);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.ok) {
      process.exit(1);
    }
    return;
  }
  if (!config) {
    throw new Error(`No external service config found at ${loaded.configPath}`);
  }
  if (["prepare", "start", "stop", "doctor", "smoke"].includes(command)) {
    const result = await runScript(config, command, { optional: command !== "start" });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  if (command === "health") {
    const result = await healthCheck(config);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.ok) {
      process.exit(1);
    }
    return;
  }
  throw new Error(`Unknown external service command: ${command}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
