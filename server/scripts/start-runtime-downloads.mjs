#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { DEFAULT_SERVER_PORT } from "../config/ServerEnv.mjs";

const ACTIVE_STATUSES = new Set(["queued", "running"]);

function parseArgs(argv = process.argv.slice(2)) {
  const parsed = {
    targets: [],
    headers: []
  };
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
    if (key === "target" || key === "targets") {
      parsed.targets.push(...splitTargets(value));
    } else if (key === "header") {
      parsed.headers.push(String(value || ""));
    } else {
      parsed[key] = value;
    }
  }
  return parsed;
}

function splitTargets(value = "") {
  if (Array.isArray(value)) {
    return value.flatMap(splitTargets);
  }
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function boolFlag(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (value === true) return true;
  if (value === false) return false;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function numberValue(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new Error(`Invalid number: ${value}`);
  }
  return number;
}

function defaultServerUrl() {
  const host = String(process.env.PACT_SERVER_HOST || "127.0.0.1").trim() || "127.0.0.1";
  const port = String(process.env.PACT_SERVER_PORT || DEFAULT_SERVER_PORT).trim();
  return `http://${host}:${port}`;
}

function normalizeBaseUrl(value = "") {
  return String(value || "").trim().replace(/\/+$/, "");
}

function joinUrl(baseUrl = "", pathname = "") {
  return `${normalizeBaseUrl(baseUrl)}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
}

function parseHeader(value = "") {
  const raw = String(value || "");
  const separator = raw.indexOf(":");
  if (separator <= 0) {
    throw new Error(`Invalid --header value: ${raw}`);
  }
  return [raw.slice(0, separator).trim(), raw.slice(separator + 1).trim()];
}

async function loadConfig(configPath = "") {
  const resolved = String(configPath || "").trim();
  if (!resolved) return {};
  const content = await fs.readFile(path.resolve(resolved), "utf8");
  return JSON.parse(content);
}

function normalizeDownloads({ args, config }) {
  const defaultTargetList = [
    ...splitTargets(process.env.PACT_RUNTIME_DOWNLOAD_TARGETS),
    ...splitTargets(config.targets),
    ...splitTargets(args.targets)
  ];
  const defaults = {
    ...(config.defaults && typeof config.defaults === "object" ? config.defaults : {}),
    dryRun: boolFlag(args["dry-run"], boolFlag(config.defaults?.dryRun, boolFlag(process.env.PACT_RUNTIME_DOWNLOAD_DRY_RUN, false))),
    timeoutMs: numberValue(args["timeout-ms"], numberValue(config.defaults?.timeoutMs, numberValue(process.env.PACT_RUNTIME_DOWNLOAD_TIMEOUT_MS, 900000)))
  };
  const downloads = [];
  for (const targetId of defaultTargetList) {
    downloads.push({ ...defaults, targetId });
  }
  for (const item of Array.isArray(config.downloads) ? config.downloads : []) {
    if (typeof item === "string") {
      downloads.push({ ...defaults, targetId: item });
    } else if (item && typeof item === "object") {
      downloads.push({ ...defaults, ...item, targetId: item.targetId || item.target || item.id });
    }
  }
  const seen = new Set();
  return downloads
    .map((item) => ({
      ...item,
      targetId: String(item.targetId || "").trim()
    }))
    .filter((item) => item.targetId)
    .filter((item) => {
      const key = `${item.targetId}:${JSON.stringify(item)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { ok: false, raw: text };
  }
  if (!response.ok) {
    const message = payload.error || payload.message || response.statusText || `HTTP ${response.status}`;
    const error = new Error(`${options.method || "GET"} ${url} failed: ${message}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

async function waitForServer(serverUrl, headers, timeoutMs, intervalMs) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt <= timeoutMs) {
    try {
      const response = await fetch(joinUrl(serverUrl, "/api/healthz"), { headers });
      if (response.ok || response.status === 401 || response.status === 403) {
        return true;
      }
      lastError = new Error(`health status ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Pact server did not become reachable within ${timeoutMs}ms: ${lastError?.message || "unknown"}`);
}

async function submitDownload(serverUrl, headers, download) {
  return fetchJson(joinUrl(serverUrl, "/api/runtime/dependencies/download"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers
    },
    body: JSON.stringify({
      ...download,
      async: true,
      background: true
    })
  });
}

async function listDownloads(serverUrl, headers) {
  return fetchJson(joinUrl(serverUrl, "/api/runtime/dependencies/downloads"), {
    headers
  });
}

async function pollRuns({ serverUrl, headers, runIds, timeoutMs, intervalMs }) {
  const pending = new Set(runIds);
  const finished = new Map();
  const startedAt = Date.now();
  while (pending.size > 0 && Date.now() - startedAt <= timeoutMs) {
    const state = await listDownloads(serverUrl, headers);
    for (const run of state.downloads || []) {
      if (!pending.has(run.runId)) continue;
      if (!ACTIVE_STATUSES.has(run.status)) {
        pending.delete(run.runId);
        finished.set(run.runId, run);
      }
    }
    if (pending.size === 0) break;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return {
    ok: pending.size === 0,
    pending: [...pending],
    finished: [...finished.values()]
  };
}

function printUsageAndExit(code = 0) {
  console.log(`Pact runtime dependency background starter

Usage:
  node server/scripts/start-runtime-downloads.mjs --target jre --target python
  node server/scripts/start-runtime-downloads.mjs --config /pact-data/runtime-downloads.json

Options:
  --server-url URL       Pact server URL. Default: PACT_SERVER_URL or http://127.0.0.1:$PACT_SERVER_PORT
  --target ID           Runtime dependency target. Repeatable, comma-separated values are accepted.
  --config PATH         JSON config with targets/downloads/defaults.
  --wait-server         Wait for /api/healthz before submitting.
  --poll                Wait for submitted runs to finish.
  --dry-run             Submit plan-only downloads.
  --timeout-ms N        Per-download timeout passed to the server.
  --poll-timeout-ms N   Poll timeout when --poll is enabled.
  --interval-ms N       Server wait/poll interval.
  --bearer-token TOKEN  Authorization bearer token.
  --header "K: V"       Extra HTTP header. Repeatable.
`);
  process.exit(code);
}

async function main() {
  const args = parseArgs();
  if (args.help) {
    printUsageAndExit(0);
  }
  const config = await loadConfig(args.config || process.env.PACT_RUNTIME_DOWNLOAD_CONFIG);
  const serverUrl = normalizeBaseUrl(args["server-url"] || config.serverUrl || process.env.PACT_SERVER_URL || defaultServerUrl());
  if (!serverUrl) {
    throw new Error("Missing Pact server URL.");
  }

  const headers = {};
  for (const rawHeader of [
    ...(Array.isArray(config.headers) ? config.headers : []),
    ...(args.headers || [])
  ]) {
    const [key, value] = parseHeader(rawHeader);
    headers[key] = value;
  }
  const bearerToken = String(args["bearer-token"] || config.bearerToken || process.env.PACT_RUNTIME_DOWNLOAD_BEARER_TOKEN || "").trim();
  if (bearerToken) {
    headers.Authorization = `Bearer ${bearerToken}`;
  }

  const downloads = normalizeDownloads({ args, config });
  if (downloads.length === 0) {
    throw new Error("No runtime dependency targets were provided. Use --target or --config.");
  }

  const intervalMs = numberValue(args["interval-ms"], numberValue(config.intervalMs, numberValue(process.env.PACT_RUNTIME_DOWNLOAD_INTERVAL_MS, 3000)));
  if (boolFlag(args["wait-server"], boolFlag(config.waitServer, boolFlag(process.env.PACT_RUNTIME_DOWNLOAD_WAIT_SERVER, false)))) {
    await waitForServer(
      serverUrl,
      headers,
      numberValue(args["wait-timeout-ms"], numberValue(config.waitTimeoutMs, numberValue(process.env.PACT_RUNTIME_DOWNLOAD_WAIT_TIMEOUT_MS, 180000))),
      intervalMs
    );
  }

  const submitted = [];
  for (const download of downloads) {
    const result = await submitDownload(serverUrl, headers, download);
    submitted.push({
      targetId: download.targetId,
      runId: result.runId,
      status: result.status,
      ok: result.ok,
      response: result
    });
  }

  const output = {
    ok: submitted.every((item) => item.ok !== false && item.runId),
    serverUrl,
    submittedAt: new Date().toISOString(),
    submitted
  };

  if (boolFlag(args.poll, boolFlag(config.poll, boolFlag(process.env.PACT_RUNTIME_DOWNLOAD_POLL, false)))) {
    const pollResult = await pollRuns({
      serverUrl,
      headers,
      runIds: submitted.map((item) => item.runId).filter(Boolean),
      timeoutMs: numberValue(args["poll-timeout-ms"], numberValue(config.pollTimeoutMs, numberValue(process.env.PACT_RUNTIME_DOWNLOAD_POLL_TIMEOUT_MS, 900000))),
      intervalMs
    });
    output.poll = pollResult;
    output.ok = output.ok && pollResult.ok && pollResult.finished.every((run) => run.ok !== false);
  }

  console.log(JSON.stringify(output, null, 2));
  if (!output.ok) {
    process.exitCode = 1;
  }
}

await main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
    status: error?.status || null,
    payload: error?.payload || null
  }, null, 2));
  process.exit(1);
});
