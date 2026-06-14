import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { startHttpServer } from "../services/server-runtime/http-server.mjs";
import { readInitialOwnerCredentials } from "./test-auth-helper.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");
const pactCliPath = path.join(repoRoot, "server", "scripts", "pact.mjs");
const consoleAuthCliPath = path.join(repoRoot, "server", "scripts", "console-auth.mjs");
const defaultReportPath = path.join(repoRoot, "build", "test-reports", "business-scenarios.json");

function nowIso() {
  return new Date().toISOString();
}

function scenarioIdPath(id) {
  return String(id || "scenario").replace(/[^A-Za-z0-9_.-]+/g, "-");
}

function splitCsv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function takeValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

function cookieHeaderFrom(response) {
  const setCookies =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : String(response.headers.get("set-cookie") || "")
          .split(/,(?=\s*pact_)/)
          .filter(Boolean);
  return setCookies.map((cookie) => cookie.split(";")[0]).join("; ");
}

function headersObject(headers) {
  const result = {};
  for (const [key, value] of headers.entries()) {
    result[key] = value;
  }
  return result;
}

function summarize(value, limit = 1200) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? null);
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function appendQuery(pathName, query = {}) {
  const url = new URL(pathName, "http://127.0.0.1");
  for (const [key, value] of Object.entries(query || {})) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    url.searchParams.set(key, String(value));
  }
  return `${url.pathname}${url.search}`;
}

async function readJsonIfExists(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readJsonLines(filePath) {
  try {
    const text = await fs.readFile(filePath, "utf8");
    return text
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

function findPassword(output) {
  const match = String(output || "").match(/(?:initial|new) password:\s*(\S+)/i);
  return match?.[1] || "";
}

function authEnv(auth) {
  return {
    PACT_CONSOLE_COOKIE: auth?.cookie || "",
    PACT_CONSOLE_CSRF: auth?.csrf || "",
    PACT_SAFETY_CONFIRM: "1"
  };
}

function runSpawn(command, args, options = {}) {
  const child = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      ...(options.env || {})
    }
  });
  return {
    command,
    args,
    status: child.status,
    signal: child.signal,
    stdout: child.stdout || "",
    stderr: child.stderr || ""
  };
}

export function scenario(definition) {
  if (!definition || typeof definition !== "object") {
    throw new TypeError("scenario requires a definition object.");
  }
  if (!definition.id) {
    throw new Error("scenario requires id.");
  }
  if (!definition.title) {
    throw new Error(`scenario ${definition.id} requires title.`);
  }
  return {
    tags: [],
    setup: null,
    run: null,
    assert: null,
    ...definition,
    id: String(definition.id),
    tags: Array.isArray(definition.tags) ? definition.tags.map(String) : []
  };
}

export function parseBusinessScenarioArgs(argv) {
  const options = {
    list: false,
    scenarios: [],
    tags: [],
    report: defaultReportPath
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--list") {
      options.list = true;
      continue;
    }
    if (arg === "--scenario") {
      options.scenarios.push(...splitCsv(takeValue(argv, ++index, arg)));
      continue;
    }
    if (arg.startsWith("--scenario=")) {
      options.scenarios.push(...splitCsv(arg.slice("--scenario=".length)));
      continue;
    }
    if (arg === "--tag") {
      options.tags.push(...splitCsv(takeValue(argv, ++index, arg)));
      continue;
    }
    if (arg.startsWith("--tag=")) {
      options.tags.push(...splitCsv(arg.slice("--tag=".length)));
      continue;
    }
    if (arg === "--report") {
      options.report = path.resolve(takeValue(argv, ++index, arg));
      continue;
    }
    if (arg.startsWith("--report=")) {
      options.report = path.resolve(arg.slice("--report=".length));
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

export function printBusinessScenarioHelp() {
  console.log(`Pact server business scenarios

Usage:
  node server/scripts/verify-business-scenarios.mjs [--list]
  node server/scripts/verify-business-scenarios.mjs [--scenario id] [--tag tag] [--report path]

Options:
  --list              Print scenario IDs.
  --scenario <id>     Run one scenario. May be repeated or comma separated.
  --tag <tag>         Run scenarios with a tag. May be repeated or comma separated.
  --report <path>     Write JSON report. Defaults to build/test-reports/business-scenarios.json.
`);
}

export function selectScenarios(scenarios, options = {}) {
  const ids = new Set(options.scenarios || []);
  const tags = new Set(options.tags || []);
  if (ids.size === 0 && tags.size === 0) {
    return scenarios;
  }
  return scenarios.filter((entry) => {
    if (ids.has(entry.id)) {
      return true;
    }
    if (tags.size > 0 && entry.tags.some((tag) => tags.has(tag))) {
      return true;
    }
    return false;
  });
}

export function listScenarios(scenarios) {
  for (const entry of scenarios) {
    console.log(`${entry.id}\t${entry.title}\t[${entry.tags.join(", ")}]`);
  }
}

export async function startMockAgentGateway() {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) {
      chunks.push(Buffer.from(chunk));
    }
    const rawBody = Buffer.concat(chunks).toString("utf8");
    let body = {};
    try {
      body = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      body = { rawBody };
    }
    requests.push({
      method: request.method,
      path: request.url,
      headers: request.headers,
      body
    });

    const text = JSON.stringify(body).toLowerCase();
    response.setHeader("content-type", "application/json; charset=utf-8");
    if (text.includes("fail gateway now")) {
      response.statusCode = 500;
      response.end(JSON.stringify({ error: "mock gateway failure" }));
      return;
    }
    if (text.includes("risk repair approve knowledge index")) {
      const plan = {
        intent: "mock_high_risk_repair",
        summary: "mock high risk repair plan",
        risk: "repair_write",
        requiresApproval: true,
        approvalReason: "repair_write requires approval",
        steps: [
          {
            toolId: "system.health",
            input: {},
            risk: "read_only",
            reason: "Inspect service health."
          },
          {
            toolId: "knowledge.reindex",
            input: { confirm: true, reason: "business_scenario" },
            risk: "repair_write",
            reason: "Repair knowledge index."
          }
        ]
      };
      response.end(
        JSON.stringify({
          type: "maintenance-plan",
          answer: JSON.stringify(plan),
          text: JSON.stringify(plan),
          plan
        })
      );
      return;
    }
    const plan = {
      intent: "mock_health_inspection",
      summary: "mock health inspection",
      risk: "read_only",
      requiresApproval: false,
      steps: [
        {
          toolId: "system.health",
          input: {},
          risk: "read_only",
          reason: "Health check."
        }
      ]
    };
    response.end(
      JSON.stringify({
        type: "assistant-message",
        answer: JSON.stringify(plan),
        text: JSON.stringify(plan),
        plan
      })
    );
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      })
  };
}

export async function createBusinessHarness(options = {}) {
  const scenarioId = scenarioIdPath(options.scenarioId || "scenario");
  const userDataPath =
    options.userDataPath ||
    (await fs.mkdtemp(path.join(os.tmpdir(), `pact-business-${scenarioId}-`)));
  const preserve = process.env.PACT_KEEP_BUSINESS_SCENARIO_DATA === "1";
  async function startServerInstance() {
    return startHttpServer({
      userDataPath,
      distPath: "",
      port: 0,
      runtimeOptions: {
        profile: options.profile || "minimal",
        ...(options.runtimeOptions || {})
      }
    });
  }

  let server = await startServerInstance();
  let lastExchange = null;
  const artifacts = {
    userDataPath,
    serverUrl: server.url
  };

  async function request(method, pathName, requestOptions = {}) {
    const headers = {
      Accept: "application/json",
      ...(requestOptions.headers || {})
    };
    const auth = requestOptions.auth;
    if (auth?.cookie && !headers.Cookie) {
      headers.Cookie = auth.cookie;
    }
    const normalizedMethod = String(method || "GET").toUpperCase();
    if (!["GET", "HEAD", "OPTIONS"].includes(normalizedMethod)) {
      if (auth?.csrf && !headers["x-pact-csrf"]) {
        headers["x-pact-csrf"] = auth.csrf;
      }
      if (requestOptions.safetyConfirm !== false && !headers["x-pact-safety-confirm"]) {
        headers["x-pact-safety-confirm"] = "true";
      }
    }
    let body = requestOptions.body;
    if (body !== undefined && !Buffer.isBuffer(body) && typeof body !== "string") {
      headers["Content-Type"] = headers["Content-Type"] || "application/json";
      body = JSON.stringify(body);
    }
    const apiPath = appendQuery(pathName, requestOptions.query);
    const startedAt = Date.now();
    const response = await fetch(`${server.url}${apiPath}`, {
      method: normalizedMethod,
      headers,
      body
    });
    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = null;
    }
    const result = {
      method: normalizedMethod,
      path: apiPath,
      status: response.status,
      ok: response.ok,
      headers: headersObject(response.headers),
      payload,
      text,
      durationMs: Date.now() - startedAt
    };
    lastExchange = {
      method: normalizedMethod,
      path: apiPath,
      status: result.status,
      ok: result.ok,
      request: summarize(requestOptions.body ?? {}),
      response: summarize(payload ?? text)
    };
    return result;
  }

  async function login(username = "owner", password = "") {
    let loginUsername = username;
    let loginPassword = password;
    if (!loginPassword && loginUsername === "owner") {
      const ownerCredentials = await readInitialOwnerCredentials(server);
      loginUsername = ownerCredentials.username || loginUsername;
      loginPassword = ownerCredentials.password;
    }
    const response = await fetch(`${server.url}/api/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ username: loginUsername, password: loginPassword })
    });
    const payload = await response.json();
    lastExchange = {
      method: "POST",
      path: "/api/auth/login",
      status: response.status,
      ok: response.ok,
      request: JSON.stringify({ username: loginUsername }),
      response: summarize(payload)
    };
    assert.equal(response.status, 200, `login failed for ${loginUsername}: ${summarize(payload)}`);
    return {
      username: loginUsername,
      password: loginPassword,
      cookie: cookieHeaderFrom(response),
      csrf: payload.csrfToken,
      session: payload.session,
      roles: payload.roles || []
    };
  }

  async function loginOwner() {
    const ownerCredentials = await readInitialOwnerCredentials(server);
    assert.ok(ownerCredentials.password, "test server did not create an initial owner password");
    return login(ownerCredentials.username, ownerCredentials.password);
  }

  function runAuthCli(args) {
    const result = runSpawn(process.execPath, [consoleAuthCliPath, "--data-dir", userDataPath, ...args]);
    lastExchange = {
      method: "CLI",
      path: `console-auth ${args.join(" ")}`,
      status: result.status,
      ok: result.status === 0,
      request: "",
      response: summarize(result.stdout || result.stderr)
    };
    if (result.status !== 0) {
      throw new Error(result.stderr || result.stdout || "console auth CLI failed");
    }
    return result.stdout;
  }

  async function createConsoleUser({ username, roleId, password = null }) {
    const actualPassword = password || `Sap_${scenarioId}_${roleId}_${Date.now()}_12345`;
    runAuthCli([
      "create-user",
      "--username",
      username,
      "--role",
      roleId,
      "--password",
      actualPassword
    ]);
    return {
      username,
      password: actualPassword,
      auth: await login(username, actualPassword)
    };
  }

  async function createConsoleUserWithGeneratedPassword({ username, roleId }) {
    const output = runAuthCli([
      "create-user",
      "--username",
      username,
      "--role",
      roleId,
      "--generate-password"
    ]);
    const password = findPassword(output);
    assert.ok(password, `generated password not found for ${username}`);
    return {
      username,
      password,
      auth: await login(username, password)
    };
  }

  async function rpc(method, params = {}, requestOptions = {}) {
    const response = await request("POST", "/api/rpc", {
      ...requestOptions,
      body: {
        jsonrpc: "2.0",
        id: requestOptions.id || `${scenarioId}-${Date.now()}`,
        method,
        params
      }
    });
    return response;
  }

  async function cli(args, requestOptions = {}) {
    const result = await new Promise((resolve) => {
      const child = spawn(process.execPath, [pactCliPath, "--server-url", server.url, ...args], {
        cwd: repoRoot,
        env: {
          ...process.env,
          ...authEnv(requestOptions.auth)
        },
        stdio: ["ignore", "pipe", "pipe"]
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString("utf8");
      });
      child.on("close", (status, signal) => {
        resolve({ status, signal, stdout, stderr });
      });
    });
    let payload = null;
    try {
      payload = result.stdout.trim() ? JSON.parse(result.stdout.trim()) : null;
    } catch {
      payload = null;
    }
    const wrapped = {
      ...result,
      ok: result.status === 0,
      payload,
      text: result.stdout || result.stderr
    };
    lastExchange = {
      method: "CLI",
      path: `pact ${args.join(" ")}`,
      status: result.status,
      ok: result.status === 0,
      request: "",
      response: summarize(payload ?? result.stdout ?? result.stderr)
    };
    return wrapped;
  }

  function filePath(...parts) {
    return path.join(userDataPath, ...parts);
  }

  async function makeFixtureDir(name = "fixture") {
    const dir = filePath("fixtures", name);
    await fs.mkdir(dir, { recursive: true });
    return dir;
  }

  function oldIso(ms = 120000) {
    return new Date(Date.now() - ms).toISOString();
  }

  function queueMonitorId(kind, ownerId) {
    const source = `Pact:${kind}:${ownerId}`;
    return `queue_item_${Buffer.from(source).toString("hex").slice(0, 32).padEnd(32, "0")}`;
  }

  async function writeInterruptedQueueFixture(input = {}) {
    const jobId = input.jobId || `${scenarioId}-interrupted-job`;
    const queueId = input.queueId || queueMonitorId("import_parse_job", jobId);
    const staleAt = input.staleAt || oldIso(input.staleMs || 180000);
    const jobDir = filePath("jobs", jobId);
    await writeJson(path.join(jobDir, "payload.json"), {
      inputText: "business scenario interrupted queue",
      uploadedFiles: [],
      settings: {}
    });
    await writeJson(path.join(jobDir, "meta.json"), {
      id: jobId,
      queueId,
      status: "running",
      createdAt: staleAt,
      updatedAt: staleAt,
      startedAt: staleAt,
      progressPercent: 42,
      stage: "业务场景队列运行中",
      checkpointId: "checkpoint_business",
      checkpointTreeId: "",
      uploadSessionId: ""
    });
    await writeJson(filePath("background", "queue-monitor-state.json"), {
      schemaVersion: "v0.0.1:schema:definition-1",
      updatedAt: staleAt,
      items: {
        [queueId]: {
          queueId,
          kind: "import_parse_job",
          ownerId: jobId,
          label: "业务场景导入解析队列",
          source: "function-self-check",
          sources: ["function-self-check"],
          lifecycleStatus: "open",
          phase: "running",
          status: "running",
          startedAt: staleAt,
          lastHeartbeatAt: staleAt,
          checkpointId: "checkpoint_business",
          checkpointTreeId: "",
          metadata: {}
        }
      }
    });
    return {
      jobId,
      queueId,
      jobDir
    };
  }

  async function close() {
    const closeErrors = [];
    try {
      await server.close();
    } catch (error) {
      closeErrors.push(error);
    }
    if (!preserve && !options.userDataPath) {
      await fs.rm(userDataPath, { recursive: true, force: true });
    }
    if (closeErrors.length > 0) {
      throw closeErrors[0];
    }
  }

  async function restart() {
    await server.close();
    server = await startServerInstance();
    artifacts.serverUrl = server.url;
    return server;
  }

  return {
    repoRoot,
    userDataPath,
    get serverUrl() {
      return server.url;
    },
    get server() {
      return server;
    },
    artifacts,
    get lastExchange() {
      return lastExchange;
    },
    request,
    get: (pathName, requestOptions = {}) => request("GET", pathName, requestOptions),
    post: (pathName, body = {}, requestOptions = {}) =>
      request("POST", pathName, { ...requestOptions, body }),
    delete: (pathName, requestOptions = {}) => request("DELETE", pathName, requestOptions),
    rpc,
    cli,
    login,
    loginOwner,
    createConsoleUser,
    createConsoleUserWithGeneratedPassword,
    restart,
    runAuthCli,
    filePath,
    makeFixtureDir,
    readJson: (targetPath, fallback = null) => readJsonIfExists(targetPath, fallback),
    writeJson,
    readJsonLines,
    writeInterruptedQueueFixture,
    close
  };
}

export function expectStatus(response, status, message = "") {
  assert.equal(
    response.status,
    status,
    `${message || "unexpected status"}: expected ${status}, got ${response.status}; response=${summarize(response.payload ?? response.text)}`
  );
}

export function expectOk(response, message = "") {
  assert.ok(
    response.ok,
    `${message || "request failed"}: status=${response.status}; response=${summarize(response.payload ?? response.text)}`
  );
}

export function expectUnauthorized(response, message = "") {
  assert.ok(
    [401, 403].includes(response.status),
    `${message || "expected unauthorized/forbidden"}: got ${response.status}; response=${summarize(response.payload ?? response.text)}`
  );
}

export function expectSafetyDenied(response, message = "") {
  assert.ok(
    [400, 403, 428].includes(response.status),
    `${message || "expected safety denial"}: got ${response.status}; response=${summarize(response.payload ?? response.text)}`
  );
}

export function expectNoSensitiveText(response, needles = ["password", "apiKey", "secret", "token"]) {
  const text = JSON.stringify(response.payload ?? response.text ?? "");
  for (const needle of needles) {
    assert.equal(
      text.toLowerCase().includes(String(needle).toLowerCase()),
      false,
      `response leaked sensitive marker ${needle}: ${summarize(text)}`
    );
  }
}

export function expectAuditEvent(items, predicate, message = "expected audit event") {
  assert.ok(Array.isArray(items), "audit items must be an array");
  assert.ok(items.some(predicate), message);
}

export function expectQueueClosedLoop(queueItem, message = "queue closed loop is incomplete") {
  assert.ok(queueItem?.queueId, `${message}: missing queueId`);
  assert.ok(queueItem?.startedAt, `${message}: missing startedAt`);
  assert.ok(queueItem?.lastHeartbeatAt, `${message}: missing lastHeartbeatAt`);
  assert.ok(
    queueItem.lifecycleStatus === "closed" || queueItem.closedAt,
    `${message}: missing closed lifecycle status`
  );
}

function normalizeComparable(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const result = {};
    for (const [key, entry] of Object.entries(value)) {
      if (["traceId", "requestId", "updatedAt", "startedAt", "durationMs"].includes(key)) {
        continue;
      }
      result[key] = normalizeComparable(entry);
    }
    return result;
  }
  if (Array.isArray(value)) {
    return value.map(normalizeComparable);
  }
  return value;
}

export function expectHttpRpcCliParity({ httpPayload, rpcPayload, cliPayload, pick = null }) {
  const httpValue = pick ? pick(httpPayload) : httpPayload;
  const rpcValue = pick ? pick(rpcPayload?.result ?? rpcPayload) : rpcPayload?.result ?? rpcPayload;
  const cliValue = pick ? pick(cliPayload) : cliPayload;
  assert.deepEqual(normalizeComparable(rpcValue), normalizeComparable(httpValue), "RPC result differs from HTTP");
  assert.deepEqual(normalizeComparable(cliValue), normalizeComparable(httpValue), "CLI result differs from HTTP");
}

export async function runScenarioSuite(scenarios, options = {}) {
  if (options.help) {
    printBusinessScenarioHelp();
    return { exitCode: 0 };
  }
  if (options.list) {
    listScenarios(scenarios);
    return { exitCode: 0 };
  }

  const selected = selectScenarios(scenarios, options);
  if (selected.length === 0) {
    throw new Error("No business scenarios selected.");
  }

  const suiteStartedAt = Date.now();
  const results = [];
  let failed = 0;
  for (const entry of selected) {
    const startedAt = Date.now();
    let harness = null;
    let phase = "setup";
    try {
      harness = await createBusinessHarness({ scenarioId: entry.id });
      const context = {
        scenario: entry,
        harness,
        state: {},
        assert
      };
      if (entry.setup) {
        await entry.setup(context);
      }
      phase = "run";
      if (entry.run) {
        await entry.run(context);
      }
      phase = "assert";
      if (entry.assert) {
        await entry.assert(context);
      }
      results.push({
        id: entry.id,
        title: entry.title,
        tags: entry.tags,
        status: "passed",
        durationMs: Date.now() - startedAt,
        serverUrl: harness.serverUrl,
        userDataPath: harness.userDataPath
      });
      console.log(`PASS ${entry.id} (${Date.now() - startedAt}ms)`);
    } catch (error) {
      failed += 1;
      const lastExchange = harness?.lastExchange || null;
      results.push({
        id: entry.id,
        title: entry.title,
        tags: entry.tags,
        status: "failed",
        phase,
        durationMs: Date.now() - startedAt,
        serverUrl: harness?.serverUrl || "",
        userDataPath: harness?.userDataPath || "",
        error: error instanceof Error ? error.stack || error.message : String(error),
        lastExchange
      });
      console.error(`FAIL ${entry.id} (${phase})`);
      console.error(`  serverUrl: ${harness?.serverUrl || ""}`);
      console.error(`  userDataPath: ${harness?.userDataPath || ""}`);
      if (lastExchange) {
        console.error(`  lastExchange: ${summarize(lastExchange, 2000)}`);
      }
      console.error(`  ${error instanceof Error ? error.stack || error.message : String(error)}`);
    } finally {
      if (harness) {
        await harness.close().catch((error) => {
          console.error(`WARN ${entry.id} cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
        });
      }
    }
  }

  const report = {
    schemaVersion: "v0.0.1:schema:definition-1",
    generatedAt: nowIso(),
    summary: {
      total: results.length,
      passed: results.filter((item) => item.status === "passed").length,
      failed,
      durationMs: Date.now() - suiteStartedAt
    },
    results
  };
  if (options.report) {
    await fs.mkdir(path.dirname(options.report), { recursive: true });
    await fs.writeFile(options.report, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }
  if (failed > 0) {
    return { exitCode: 1, report };
  }
  console.log(`Business scenarios passed: ${report.summary.passed}/${report.summary.total}`);
  return { exitCode: 0, report };
}
