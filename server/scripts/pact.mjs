#!/usr/bin/env node
import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import {
  SERVER_API_OPERATIONS,
  buildApiPathForCliOperation,
  findCliOperation,
  formatInterfaceCatalogMarkdown,
  listInterfaceCatalog
} from "../platform/common/operation-dispatcher/operation-registry.mjs";
import {
  filterOperationsForFeatures,
  resolveFeatureRuntimeFromEnv
} from "../platform/interactive/features/feature-manifest.mjs";
import { getDefaultServerUrl, DEFAULT_SERVER_PORT } from "../config/ServerEnv.mjs";
import {
  LOCAL_SECRET_TARGETS,
  defaultEndpointRefForProvider,
  defaultSecretRefForProvider,
  initializeLocalSecret,
  listLocalSecretEntries,
  localSecretStorePaths,
  normalizeLocalSecretProvider,
  resolveLocalSecretTarget
} from "../platform/common/security/secrets/local-secret-store.mjs";
import {
  oauthDefaultsForProvider,
  runLocalOAuthAuthorizationCodeFlow
} from "../platform/common/security/secrets/oauth-local-flow.mjs";
import {
  capabilityKernelStatePath,
  createOpaqueCapabilityKeyProvider
} from "../platform/common/security/authorization/opaque-capability-key.mjs";
import {
  capabilityBindingGuardStatePath,
  createCapabilityBindingGuard
} from "../platform/common/security/authorization/capability-binding-guard.mjs";

const DEFAULT_SERVER_URL = process.env.PACT_SERVER_URL || getDefaultServerUrl();
const DEFAULT_CHUNK_SIZE = 1024 * 1024;
const DEFAULT_CAPABILITY_KERNEL_ALIAS = "pact-tool-grants";
const DEFAULT_CAPABILITY_BINDING_GUARD_ALIAS = "pact-tool-bindings";
const SECURITY_RECOVERY_PACKAGE_VERSION = "v0.0.1:risk-control:recovery-1";

function parseArgs(argv) {
  const args = {
    _: [],
    file: [],
    header: [],
    path: [],
    input: []
  };

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
    const value =
      inlineValue !== null
        ? inlineValue
        : !next || next.startsWith("--")
          ? true
          : next;

    if (inlineValue === null && value !== true) {
      index += 1;
    }

    if (key === "file" || key === "header" || key === "path" || key === "input") {
      args[key].push(String(value));
      continue;
    }

    args[key] = value;
  }

  return args;
}

function usage() {
  return [
    "Usage:",
    "  pact --file a.txt [--wait] [--output-result result.json]",
    "  pact --path ./local [--wait] [--output-result result.json]",
    `  pact upload --path ./local --server-url http://127.0.0.1:${DEFAULT_SERVER_PORT}`,
    "  pact rpc --method GET --path /api/healthz",
    "  pact rpc-call jobs.list --params '{\"limit\":20}'",
    "  pact interfaces --format markdown",
    "  pact health",
    "  pact jobs list|get|result|delete ...",
    "  pact jobs normalized-docs --id JOB_ID",
    "  pact jobs normalized-doc --id JOB_ID --document-id DOC_ID --output out.docx",
    "  pact settings get|set --body settings.json",
    "  pact agents create --name NAME --model MODEL [--provider deepseek] [--api-key KEY]",
    "  pact agents update --id AGENT_UID [--name NAME] [--model MODEL] [--system-prompt TEXT]",
    "  pact agents delete --id AGENT_UID",
    "  pact secret gerrit init --base-url URL --username USER --http-password-stdin [--mode live]",
    "  pact secret dify init --endpoint URL --api-key-stdin",
    "  pact secret onedrive oauth --client-id CLIENT_ID",
    "  pact secret list|status",
    "  pact security capability-kernel status [--backend local-file] [--alias pact-tool-grants]",
    "  pact security binding-guard status [--binding-backend local-file] [--binding-alias pact-tool-bindings]",
    "  pact security recovery export --output recovery.json --passphrase-stdin",
    "  pact security recovery import --input recovery.json --passphrase-stdin",
    "  pact tools catalog|toolsets|toolsets resolve|execute|dry-run|audit|metrics ...",
    "  pact tools metrics [--tool-id ID] [--grant-id ID] [--profile-id ID] [--route PATH] [--transport mcp|http|tool-management] [--bucket-seconds N]",
    "  pact tools metrics export [--kind all|tool|request] [--grant-id ID] [--profile-id ID] [--output metrics.json]",
    "  pact tools metrics health [--window-seconds 300]",
    "  pact tools metrics prometheus [--window-seconds 300]",
    "  pact tools metrics storage",
    "  pact tools metrics prune --confirm --body prune.json",
    "  pact tools grants list|create|rotate|revoke ...",
    "  pact tools policy preview --body preview.json",
    "",
    "Global options:",
    "  --data-dir PATH         Directory for offline data resolution",
    `  --server-url URL        Defaults to PACT_SERVER_URL or http://127.0.0.1:${DEFAULT_SERVER_PORT}`,
    "  --body JSON_OR_FILE     JSON string or path to a JSON file",
    "  --body-file FILE        JSON request body file",
    "  --params JSON_OR_FILE   JSON-RPC params string or path to a JSON file",
    "  --params-file FILE      JSON-RPC params file",
    "  --raw-file FILE         Raw request body file for rpc/named HTTP calls",
    "  --content-type TYPE     Content-Type for --raw-file; defaults to application/octet-stream",
    "  --header 'K: V'         Extra request header; repeatable",
    "  --confirm              Add confirm=true for repair_write operations",
    "  --output FILE           Save response body",
    "  --pretty               Pretty-print JSON responses",
    "  --json-stdin           Read a secret JSON object from stdin for pact secret ... init",
    "  --token-stdin          Read an opaque token from stdin for pact secret ... init",
    "  --api-key-stdin        Read an API key from stdin for pact secret ... init",
    "  --http-password-stdin  Read a Gerrit HTTP password from stdin for pact secret ... init",
    "  --oauth-json-stdin     Read an OAuth JSON object from stdin for pact secret ... init",
    "  --client-secret-stdin  Read OAuth client secret from stdin for pact secret ... oauth",
    "  --passphrase-stdin     Read recovery package passphrase from stdin",
    "  --passphrase-file FILE Read recovery package passphrase from a file",
    "  --passphrase-env NAME  Read recovery package passphrase from an environment variable",
    "  --backend NAME         Capability kernel backend: auto, local-file, macos-keychain",
    "  --alias NAME           Capability kernel alias; defaults to pact-tool-grants",
    "  --binding-backend NAME Capability Binding Guard backend; defaults to --backend or auto",
    "  --binding-alias NAME   Capability Binding Guard alias; defaults to pact-tool-bindings",
    "  --no-open              Do not open browser for pact secret ... oauth",
    "",
    "Upload options:",
    "  --file FILE             Upload one file; repeatable",
    "  --path FILE_OR_DIR      Upload file or folder; repeatable",
    "  --wait                  Poll job until completed",
    "  --output-result FILE    Save completed job result JSON",
    "  --settings JSON_OR_FILE Inline settings JSON or path to JSON file",
    "  --checkpoint-id ID      Defaults to a digest of the upload manifest",
    "  --chunk-size BYTES      Defaults to 1048576"
  ].join("\n");
}

function normalizeBaseUrl(value) {
  return String(value || DEFAULT_SERVER_URL).replace(/\/+$/, "");
}

function normalizeApiPath(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    throw new Error("--path is required");
  }
  return raw.startsWith("/") ? raw : `/${raw}`;
}

function parseJsonText(raw, label = "JSON") {
  try {
    return JSON.parse(String(raw || "{}"));
  } catch (error) {
    throw new Error(`${label} 不是有效 JSON：${error instanceof Error ? error.message : "未知错误"}`);
  }
}

async function readJsonInput(value, label = "JSON") {
  if (value === undefined || value === null || value === true || value === "") {
    return {};
  }

  const text = String(value);
  if (text.trim().startsWith("{") || text.trim().startsWith("[")) {
    return parseJsonText(text, label);
  }

  try {
    return parseJsonText(await fsp.readFile(path.resolve(text), "utf8"), text);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return parseJsonText(text, label);
    }
    throw error;
  }
}

async function readBody(args) {
  if (args["body-file"]) {
    return readJsonInput(String(args["body-file"]), "--body-file");
  }
  if (args.body !== undefined) {
    return readJsonInput(args.body, "--body");
  }
  return {};
}

function coerceCliBodyValue(value, type) {
  if (type === "number") {
    return Number(value || 0);
  }
  if (type === "boolean") {
    return value === true || value === "1" || value === "true" || value === "yes";
  }
  if (type === "json") {
    return typeof value === "string" ? parseJsonText(value, "--parameters") : value;
  }
  if (type === "string-list") {
    if (Array.isArray(value)) {
      return value.map((item) => String(item || "").trim()).filter(Boolean);
    }
    return String(value || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return value;
}

function findCliArgValue(args, aliases = []) {
  for (const alias of aliases) {
    const value = args[alias];
    if (Array.isArray(value)) {
      const last = value[value.length - 1];
      if (last !== undefined && last !== null && last !== true && last !== "") {
        return last;
      }
      continue;
    }
    if (value !== undefined && value !== null && value !== true && value !== "") {
      return value;
    }
  }
  return undefined;
}

function buildBodyFromCliParams(operation, args) {
  const bodyParams = operation.cli?.bodyParams || [];
  if (bodyParams.length === 0) {
    return null;
  }
  const body = {};
  for (const param of bodyParams) {
    const aliases = [param.name, ...(param.aliases || [])];
    const value = findCliArgValue(args, aliases);
    if ((value === undefined || value === null || value === "") && param.required) {
      throw new Error(`--${aliases[1] || param.name} is required`);
    }
    if (value !== undefined && value !== null && value !== "") {
      body[param.name] = coerceCliBodyValue(value, param.type || "string");
    }
  }
  return Object.keys(body).length > 0 ? body : null;
}

function applyCommonSafetyFlags(args, body) {
  if (!hasConfirmArg(args)) {
    return body;
  }
  if (body === undefined || body === null) {
    return { confirm: true };
  }
  if (Buffer.isBuffer(body) || typeof body !== "object" || Array.isArray(body)) {
    return body;
  }
  return {
    ...body,
    confirm: body.confirm === undefined ? true : body.confirm
  };
}

function hasConfirmArg(args) {
  return ["true", "1", "yes"].includes(String(args.confirm || "").trim().toLowerCase());
}

function applyCommonSafetyHeaders(args, headers = {}) {
  if (!hasConfirmArg(args)) {
    return headers;
  }
  return {
    ...headers,
    "x-pact-safety-confirm": headers["x-pact-safety-confirm"] || "true"
  };
}

async function readRpcParams(args) {
  if (args["params-file"]) {
    return readJsonInput(String(args["params-file"]), "--params-file");
  }
  if (args.params !== undefined) {
    return readJsonInput(args.params, "--params");
  }
  return {};
}

function readHeaders(args) {
  const headers = {
    ...envAuthHeaders()
  };
  for (const entry of args.header || []) {
    const text = String(entry);
    const separatorIndex = text.indexOf(":");
    if (separatorIndex <= 0) {
      throw new Error(`--header 必须使用 "Name: value" 格式：${text}`);
    }
    headers[text.slice(0, separatorIndex).trim()] = text.slice(separatorIndex + 1).trim();
  }
  return headers;
}

function envAuthHeaders() {
  const headers = {};
  if (process.env.PACT_CONSOLE_COOKIE) {
    headers.Cookie = process.env.PACT_CONSOLE_COOKIE;
  }
  if (process.env.PACT_CONSOLE_CSRF) {
    headers["x-pact-csrf"] = process.env.PACT_CONSOLE_CSRF;
  }
  if (["1", "true", "yes"].includes(String(process.env.PACT_SAFETY_CONFIRM || "").toLowerCase())) {
    headers["x-pact-safety-confirm"] = "true";
  }
  return headers;
}

async function readHttpPayload(args, method) {
  const normalizedMethod = String(method || "GET").toUpperCase();
  const headers = readHeaders(args);
  if (normalizedMethod === "GET" || normalizedMethod === "HEAD") {
    return {
      body: undefined,
      headers
    };
  }

  if (args["raw-file"]) {
    headers["content-type"] = headers["content-type"] || args["content-type"] || "application/octet-stream";
    return {
      body: await fsp.readFile(path.resolve(String(args["raw-file"]))),
      headers
    };
  }

  return {
    body: await readBody(args),
    headers
  };
}

async function requestRaw({
  serverUrl,
  method = "GET",
  apiPath,
  body,
  headers = {},
  binary = false,
  okStatuses = []
}) {
  const baseUrl = normalizeBaseUrl(serverUrl);
  const normalizedMethod = String(method || "GET").toUpperCase();
  const url = `${baseUrl}${normalizeApiPath(apiPath)}`;
  const requestHeaders = {
    accept: binary ? "*/*" : "application/json",
    ...envAuthHeaders(),
    ...headers
  };
  let requestBody;

  if (body !== undefined && normalizedMethod !== "GET" && normalizedMethod !== "HEAD") {
    if (Buffer.isBuffer(body)) {
      requestBody = body;
    } else {
      requestHeaders["content-type"] = requestHeaders["content-type"] || "application/json";
      requestBody = JSON.stringify(body);
    }
  }

  const response = await fetch(url, {
    method: normalizedMethod,
    headers: requestHeaders,
    body: requestBody
  });
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!response.ok && !okStatuses.includes(response.status)) {
    const details = buffer.toString("utf8");
    throw new Error(`${normalizedMethod} ${url} failed: ${response.status} ${details}`);
  }

  return {
    response,
    buffer
  };
}

async function requestJson(input) {
  const { buffer } = await requestRaw(input);
  const text = buffer.toString("utf8").trim();
  return text ? JSON.parse(text) : {};
}

async function writeResponse({ args, result, rawBuffer = null, contentType = "" }) {
  if (args.output) {
    const outputPath = path.resolve(String(args.output));
    await fsp.mkdir(path.dirname(outputPath), { recursive: true });
    await fsp.writeFile(
      outputPath,
      rawBuffer || Buffer.from(JSON.stringify(result, null, 2), "utf8")
    );
    process.stderr.write(`output: ${outputPath}\n`);
    return;
  }

  if (rawBuffer && !/json/i.test(contentType)) {
    process.stdout.write(rawBuffer);
    return;
  }

  process.stdout.write(
    `${args.pretty === false ? JSON.stringify(result) : JSON.stringify(result, null, 2)}\n`
  );
}

async function walkInput(inputPath, rootPath = inputPath) {
  const stats = await fsp.stat(inputPath);
  if (stats.isDirectory()) {
    const names = await fsp.readdir(inputPath);
    const nested = [];
    for (const name of names) {
      if (name === ".DS_Store") {
        continue;
      }
      nested.push(...(await walkInput(path.join(inputPath, name), rootPath)));
    }
    return nested;
  }

  if (!stats.isFile()) {
    return [];
  }

  return [
    {
      absolutePath: path.resolve(inputPath),
      relativePath: path.relative(path.dirname(rootPath), inputPath).replace(/\\/g, "/"),
      byteSize: stats.size
    }
  ];
}

async function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function digestManifest(files) {
  return createHash("sha256")
    .update(JSON.stringify(files.map((file) => [file.relativePath, file.sha256, file.byteSize])))
    .digest("hex");
}

async function collectUploadFiles(args) {
  const inputs = [...args.file, ...args.path, ...args.input];
  if (inputs.length === 0) {
    throw new Error("请使用 --file、--path 或 --input 指定上传内容。");
  }

  const files = [];
  for (const input of inputs) {
    files.push(...(await walkInput(path.resolve(String(input)))));
  }
  if (files.length === 0) {
    throw new Error("没有找到可上传的文件。");
  }

  for (const file of files) {
    file.name = path.basename(file.relativePath);
    file.mediaType = "application/octet-stream";
    file.sha256 = await sha256File(file.absolutePath);
  }

  return files;
}

async function uploadFileChunks({ serverUrl, sessionId, file, fileIndex, chunkSize, receivedBytes }) {
  let offset = Number(receivedBytes || 0);
  const handle = await fsp.open(file.absolutePath, "r");
  try {
    while (offset < file.byteSize) {
      const length = Math.min(chunkSize, file.byteSize - offset);
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, offset);
      const session = await requestJson({
        serverUrl,
        method: "PUT",
        apiPath: `/api/upload-sessions/${encodeURIComponent(sessionId)}/files/${fileIndex}?offset=${offset}`,
        body: buffer,
        okStatuses: [409],
        headers: {
          "content-type": "application/octet-stream"
        }
      });
      if (session?.code) {
        if (
          session.code !== "offset_mismatch" &&
          session.code !== "chunk_too_large" &&
          session.code !== "sha256_mismatch"
        ) {
          throw new Error(session.error || `上传分块失败：${session.code}`);
        }
        const remoteSession = session.session || {};
        const remoteFile = (remoteSession.files || []).find((item) => item.index === fileIndex);
        offset = Number(session.expectedOffset ?? remoteFile?.receivedBytes ?? 0);
        process.stderr.write(
          `realigned ${file.relativePath}: ${session.code}, offset ${offset}\n`
        );
        continue;
      }
      const remoteFile = session.files.find((item) => item.index === fileIndex);
      offset = Number(remoteFile?.receivedBytes || offset + length);
      process.stderr.write(`uploaded ${file.relativePath}: ${offset}/${file.byteSize}\n`);
    }
  } finally {
    await handle.close();
  }
}

async function waitForJob({ serverUrl, jobId }) {
  let current = await requestJson({
    serverUrl,
    method: "GET",
    apiPath: `/api/jobs/${encodeURIComponent(jobId)}`
  });
  while (!["completed", "failed", "cancelled", "deleted"].includes(current.status)) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    current = await requestJson({
      serverUrl,
      method: "GET",
      apiPath: `/api/jobs/${encodeURIComponent(jobId)}`
    });
    process.stderr.write(`${current.status} ${current.progressPercent || 0}% ${current.stage || ""}\n`);
  }
  if (current.status !== "completed") {
    throw new Error(current.error || `Job ended with status ${current.status}`);
  }
  return current;
}

async function runUpload(args) {
  const serverUrl = args["server-url"] || DEFAULT_SERVER_URL;
  const chunkSize = Math.max(64 * 1024, Number(args["chunk-size"] || DEFAULT_CHUNK_SIZE));
  const files = await collectUploadFiles(args);
  const manifestDigest = digestManifest(files);
  const checkpointId = String(args["checkpoint-id"] || `cli-${manifestDigest.slice(0, 24)}`);
  const settings = args.settings ? await readJsonInput(args.settings, "--settings") : {};

  let session = await requestJson({
    serverUrl,
    method: "POST",
    apiPath: "/api/upload-sessions",
    body: {
      checkpoint: { checkpointId, mode: "pact-cli" },
      manifest: { manifestDigest, inputDigest: manifestDigest },
      files: files.map(({ name, relativePath, mediaType, sha256, byteSize }) => ({
        name,
        relativePath,
        mediaType,
        sha256,
        byteSize
      }))
    }
  });

  for (const [fallbackIndex, file] of files.entries()) {
    const remote = session.files.find(
      (item) =>
        item.index === fallbackIndex &&
        item.sha256 === file.sha256 &&
        Number(item.byteSize || 0) === Number(file.byteSize || 0)
    );
    if (!remote) {
      throw new Error(`上传会话缺少文件：${file.relativePath}`);
    }
    if (!remote.completed) {
      await uploadFileChunks({
        serverUrl,
        sessionId: session.sessionId,
        file,
        fileIndex: remote.index,
        chunkSize,
        receivedBytes: remote.receivedBytes
      });
      session = await requestJson({
        serverUrl,
        method: "GET",
        apiPath: `/api/upload-sessions/${encodeURIComponent(session.sessionId)}`
      });
    }
  }

  const job = await requestJson({
    serverUrl,
    method: "POST",
    apiPath: "/api/jobs",
    body: {
      checkpoint: { checkpointId, mode: "pact-cli" },
      uploadSessionId: session.sessionId,
      uploadedFiles: [],
      settings
    }
  });

  if (!args.wait) {
    await writeResponse({ args, result: job });
    return;
  }

  await waitForJob({ serverUrl, jobId: job.id });
  const result = await requestJson({
    serverUrl,
    method: "GET",
    apiPath: `/api/jobs/${encodeURIComponent(job.id)}/result`
  });

  if (args["output-result"]) {
    const outputPath = path.resolve(String(args["output-result"]));
    await fsp.mkdir(path.dirname(outputPath), { recursive: true });
    await fsp.writeFile(outputPath, JSON.stringify(result, null, 2), "utf8");
    process.stderr.write(`result: ${outputPath}\n`);
  }

  await writeResponse({ args, result });
}

function requireValue(args, key) {
  const value = Array.isArray(args[key]) ? args[key][args[key].length - 1] : args[key];
  if (!value || value === true) {
    throw new Error(`--${key} is required`);
  }
  return String(value);
}

function secretCommandFromArgs(args) {
  const first = String(args._[0] || "");
  if (first.startsWith("secret.")) {
    const [, provider = "", action = "init"] = first.split(".");
    return {
      matched: true,
      action: action || "init",
      provider: provider || args.provider || args._[1] || ""
    };
  }
  if (first !== "secret" && first !== "secrets") {
    return { matched: false, action: "", provider: "" };
  }
  const second = String(args._[1] || "");
  const third = String(args._[2] || "");
  if (!second || ["list", "status", "targets"].includes(second)) {
    return {
      matched: true,
      action: second || "status",
      provider: args.provider || ""
    };
  }
  if (second === "init") {
    return {
      matched: true,
      action: "init",
      provider: args.provider || third || ""
    };
  }
  return {
    matched: true,
    action: third || "init",
    provider: second || args.provider || ""
  };
}

async function readStdinText() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function trimOneTrailingNewline(value) {
  return String(value ?? "").replace(/\r?\n$/, "");
}

function mergeIfPresent(target, key, value) {
  if (value !== undefined && value !== null && value !== true && value !== "") {
    target[key] = String(value);
  }
}

function parseSecretJson(raw, label) {
  const parsed = parseJsonText(raw, label);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return parsed;
}

async function readSecretPayload(args, target) {
  let payload = {};
  if (args.body !== undefined || args["body-file"]) {
    payload = await readBody(args);
  }

  const stdinFlags = [
    ["json-stdin", "json"],
    ["token-stdin", "token"],
    ["api-key-stdin", "apiKey"],
    ["http-password-stdin", "httpPassword"],
    ["oauth-json-stdin", "oauth"]
  ].filter(([flag]) => args[flag]);

  if (stdinFlags.length > 1) {
    throw new Error("Only one stdin secret source can be used at a time.");
  }
  if (stdinFlags.length === 1) {
    const [flag, key] = stdinFlags[0];
    const textValue = await readStdinText();
    if (key === "json") {
      payload = {
        ...payload,
        ...parseSecretJson(textValue, `--${flag}`)
      };
    } else if (key === "oauth") {
      payload = {
        ...payload,
        oauth: parseSecretJson(textValue, `--${flag}`)
      };
    } else {
      payload = {
        ...payload,
        [key]: trimOneTrailingNewline(textValue)
      };
    }
  }

  if (args["from-env"]) {
    const envName = String(args["from-env"]);
    const value = process.env[envName];
    if (!value) {
      throw new Error(`Environment variable is not set: ${envName}`);
    }
    const envSpec = target.envSecrets.find((item) => item.name === envName);
    payload[envSpec?.key || "value"] = value;
  }

  if (Object.keys(payload).length === 0) {
    const envSpec = target.envSecrets.find((item) => process.env[item.name]);
    if (envSpec) {
      payload[envSpec.key] = process.env[envSpec.name];
    }
  }

  if (args["private-key-file"]) {
    payload.privateKey = await fsp.readFile(path.resolve(String(args["private-key-file"])), "utf8");
  }

  mergeIfPresent(payload, "username", args.username);
  mergeIfPresent(payload, "appId", args["app-id"] || args.appId);
  mergeIfPresent(payload, "installationId", args["installation-id"] || args.installationId);
  mergeIfPresent(payload, "clientId", args["client-id"] || args.clientId);
  mergeIfPresent(payload, "tenantId", args["tenant-id"] || args.tenantId);
  mergeIfPresent(payload, "scope", args.scope);
  return payload;
}

async function readOAuthClientSecret(args) {
  if (args["client-secret-stdin"]) {
    return trimOneTrailingNewline(await readStdinText());
  }
  if (args["client-secret-file"]) {
    return trimOneTrailingNewline(await fsp.readFile(path.resolve(String(args["client-secret-file"])), "utf8"));
  }
  return "";
}

function publicOAuthSummary(flow = {}) {
  return {
    provider: flow.provider,
    redirectUri: flow.redirectUri,
    scope: flow.scope,
    tokenUrl: flow.tokenUrl,
    tokenClientAuth: flow.tokenClientAuth,
    tokenKeys: Object.entries(flow.oauth || {})
      .filter(([, value]) => value !== undefined && value !== null && value !== "")
      .map(([key]) => key)
      .filter((key) => key !== "providerResponse")
      .sort(),
    expiresAt: flow.oauth?.expiresAt || "",
    hasRefreshToken: Boolean(flow.oauth?.refreshToken)
  };
}

async function runSecretCommand(args) {
  const command = secretCommandFromArgs(args);
  if (!command.matched) {
    return false;
  }
  const action = String(command.action || "status");
  if (action === "targets") {
    await writeResponse({
      args,
      result: {
        ok: true,
        targets: Object.values(LOCAL_SECRET_TARGETS).map((target) => ({
          provider: target.provider,
          aliases: target.aliases,
          family: target.family,
          secretRef: target.secretRef,
          endpointRef: target.endpointRef,
          authType: target.authType,
          oauthRedirect: Boolean(target.oauthRedirect),
          oauthDefaults: target.oauthRedirect ? oauthDefaultsForProvider(target.provider) : null,
          defaultMode: target.defaultMode,
          env: target.envSecrets.map((item) => item.name)
        }))
      }
    });
    return true;
  }
  if (action === "list" || action === "status") {
    const paths = localSecretStorePaths({ dataDir: args["data-dir"] });
    const entries = await listLocalSecretEntries({ dataDir: args["data-dir"] });
    await writeResponse({
      args,
      result: {
        ok: true,
        protocolVersion: "v0.0.1:risk-control:local-secret-store-1",
        dataDir: paths.dataDir,
        registryPath: paths.registryPath,
        count: entries.length,
        entries
      }
    });
    return true;
  }
  if (action !== "init" && action !== "oauth" && action !== "login") {
    throw new Error(`未知 secret 命令：${args._.join(" ")}`);
  }

  const provider = normalizeLocalSecretProvider(command.provider || args.provider);
  const target = resolveLocalSecretTarget(provider);
  if (!target) {
    throw new Error(`Unsupported Pact secret provider: ${command.provider || args.provider || ""}`);
  }

  let oauthSummary = null;
  let payload;
  if (action === "oauth" || action === "login") {
    const clientSecret = await readOAuthClientSecret(args);
    const flow = await runLocalOAuthAuthorizationCodeFlow({
      provider,
      clientId: args["client-id"] || args.clientId || "",
      clientSecret,
      authorizationUrl: args["auth-url"] || args.authorizationUrl || "",
      tokenUrl: args["token-url"] || args.tokenUrl || "",
      tenant: args.tenant || "",
      scope: args.scope || "",
      authorizeParams: args["authorize-param"] || args["authorize-params"] || args.authorizeParams || "",
      tokenClientAuth: args["client-auth"] || args.clientAuth || "",
      host: args.host || "127.0.0.1",
      port: args.port || 0,
      callbackPath: args["callback-path"] || undefined,
      open: !args["no-open"],
      timeoutMs: args["timeout-ms"] || args.timeoutMs || undefined,
      stderr: process.stderr
    });
    payload = {
      oauth: flow.oauth,
      clientId: String(args["client-id"] || args.clientId || ""),
      redirectUri: flow.redirectUri,
      scope: flow.scope
    };
    if (clientSecret) {
      payload.clientSecret = clientSecret;
    }
    oauthSummary = publicOAuthSummary(flow);
  } else {
    payload = await readSecretPayload(args, target);
  }
  const endpoint = String(args.endpoint || args["base-url"] || args.url || "").trim();
  const metadata = {
    label: args.label || "",
    workspaceId: args["workspace-id"] || args.workspaceId || "",
    driveRef: args["drive-ref"] || args.driveRef || "",
    oauthRedirectUri: oauthSummary?.redirectUri || ""
  };
  const result = await initializeLocalSecret({
    dataDir: args["data-dir"],
    provider,
    secretRef: args["secret-ref"] || defaultSecretRefForProvider(provider),
    endpointRef: args["endpoint-ref"] || defaultEndpointRefForProvider(provider),
    endpoint,
    mode: args.mode || "",
    authType: args["auth-type"] || args.authType || "",
    payload,
    metadata
  });
  await writeResponse({
    args,
    result: oauthSummary
      ? {
          ...result,
          oauth: oauthSummary
        }
      : result
  });
  return true;
}

function securityCommandFromArgs(args) {
  const first = String(args._[0] || "");
  if (first.startsWith("security.")) {
    const [, domain = "capability-kernel", action = "status"] = first.split(".");
    return {
      matched: true,
      domain: domain || "capability-kernel",
      action: action || "status"
    };
  }
  if (first !== "security" && first !== "secure") {
    return { matched: false, domain: "", action: "" };
  }
  const domain = String(args._[1] || "capability-kernel");
  const action = String(args._[2] || "status");
  return { matched: true, domain, action };
}

function capabilityKernelOptions(args = {}) {
  return {
    dataDir: args["data-dir"] || "",
    backend: args.backend || process.env.PACT_TOOL_GRANT_CAPABILITY_KEY_PROVIDER || process.env.PACT_OPAQUE_CAPABILITY_KEY_PROVIDER || "auto",
    alias: args.alias || process.env.PACT_TOOL_GRANT_CAPABILITY_KEY_ALIAS || DEFAULT_CAPABILITY_KERNEL_ALIAS
  };
}

function capabilityBindingGuardOptions(args = {}) {
  return {
    dataDir: args["data-dir"] || "",
    backend: args["binding-backend"] ||
      args.backend ||
      process.env.PACT_TOOL_GRANT_BINDING_GUARD_PROVIDER ||
      process.env.PACT_CAPABILITY_BINDING_GUARD_PROVIDER ||
      "auto",
    alias: args["binding-alias"] ||
      process.env.PACT_TOOL_GRANT_BINDING_GUARD_ALIAS ||
      process.env.PACT_CAPABILITY_BINDING_GUARD_ALIAS ||
      DEFAULT_CAPABILITY_BINDING_GUARD_ALIAS
  };
}

async function readRecoveryPassphrase(args = {}) {
  const sources = [
    ["passphrase-stdin", args["passphrase-stdin"]],
    ["passphrase-file", args["passphrase-file"]],
    ["passphrase-env", args["passphrase-env"]]
  ].filter(([, value]) => value);
  if (sources.length !== 1) {
    throw new Error("Recovery commands require exactly one passphrase source: --passphrase-stdin, --passphrase-file, or --passphrase-env.");
  }
  const [source, value] = sources[0];
  if (source === "passphrase-stdin") {
    return trimOneTrailingNewline(await readStdinText());
  }
  if (source === "passphrase-file") {
    return trimOneTrailingNewline(await fsp.readFile(path.resolve(String(value)), "utf8"));
  }
  const passphrase = process.env[String(value)];
  if (!passphrase) {
    throw new Error(`Recovery passphrase environment variable is not set: ${value}`);
  }
  return passphrase;
}

async function writePrivateJsonFile(filePath, value) {
  const outputPath = path.resolve(String(filePath || ""));
  if (!outputPath) {
    throw new Error("--output is required.");
  }
  await fsp.mkdir(path.dirname(outputPath), { recursive: true, mode: 0o700 });
  await fsp.writeFile(outputPath, JSON.stringify(value, null, 2), { mode: 0o600 });
  await fsp.chmod(outputPath, 0o600);
  return outputPath;
}

function summarizeRecoveryComponent(component = null) {
  if (!component || typeof component !== "object") {
    return null;
  }
  return {
    protocolVersion: String(component.protocolVersion || ""),
    alias: String(component.alias || ""),
    epoch: Number(component.epoch || 0),
    stateRoot: String(component.stateRoot || "")
  };
}

function composeSecurityRecoveryPackage({
  capabilityKernel = null,
  capabilityBindingGuard = null
} = {}) {
  const exportedAt = new Date().toISOString();
  return {
    protocolVersion: SECURITY_RECOVERY_PACKAGE_VERSION,
    exportedAt,
    components: {
      capabilityKernel,
      capabilityBindingGuard
    }
  };
}

async function exportSecurityRecoveryPackage({ provider, bindingGuard, passphrase, reason = "" } = {}) {
  const [capabilityKernel, capabilityBindingGuard] = await Promise.all([
    provider.exportRecoveryPackage({ passphrase, reason }),
    bindingGuard.exportRecoveryPackage({ passphrase, reason })
  ]);
  return composeSecurityRecoveryPackage({ capabilityKernel, capabilityBindingGuard });
}

function isSecurityRecoveryPackage(recoveryPackage = {}) {
  return recoveryPackage?.protocolVersion === SECURITY_RECOVERY_PACKAGE_VERSION;
}

async function importSecurityRecoveryPackage({
  provider,
  bindingGuard,
  recoveryPackage,
  passphrase
} = {}) {
  if (isSecurityRecoveryPackage(recoveryPackage)) {
    const components = recoveryPackage.components && typeof recoveryPackage.components === "object"
      ? recoveryPackage.components
      : {};
    const result = {
      ok: true,
      protocolVersion: SECURITY_RECOVERY_PACKAGE_VERSION,
      imported: true,
      components: {}
    };
    if (components.capabilityKernel) {
      result.components.capabilityKernel = await provider.importRecoveryPackage({
        recoveryPackage: components.capabilityKernel,
        passphrase
      });
    }
    if (components.capabilityBindingGuard) {
      result.components.capabilityBindingGuard = await bindingGuard.importRecoveryPackage({
        recoveryPackage: components.capabilityBindingGuard,
        passphrase
      });
    }
    return result;
  }
  if (recoveryPackage?.protocolVersion === "v0.0.1:risk-control:capability-binding-guard-recovery-1") {
    return {
      ok: true,
      protocolVersion: SECURITY_RECOVERY_PACKAGE_VERSION,
      imported: true,
      components: {
        capabilityBindingGuard: await bindingGuard.importRecoveryPackage({
          recoveryPackage,
          passphrase
        })
      }
    };
  }
  return {
    ok: true,
    protocolVersion: SECURITY_RECOVERY_PACKAGE_VERSION,
    imported: true,
    components: {
      capabilityKernel: await provider.importRecoveryPackage({
        recoveryPackage,
        passphrase
      })
    }
  };
}

async function runSecurityCommand(args) {
  const command = securityCommandFromArgs(args);
  if (!command.matched) {
    return false;
  }
  const domain = command.domain;
  const action = command.action;
  const options = capabilityKernelOptions(args);
  const bindingOptions = capabilityBindingGuardOptions(args);
  const provider = createOpaqueCapabilityKeyProvider(options);
  const bindingGuard = createCapabilityBindingGuard(bindingOptions);
  try {
    if (domain === "capability-kernel" || domain === "capability" || domain === "kernel") {
      if (action !== "status" && action !== "describe") {
        throw new Error(`未知 security capability-kernel 命令：${args._.join(" ")}`);
      }
      const description = await provider.describe();
      await writeResponse({
        args,
        result: {
          ok: true,
          capabilityKernel: {
            ...description,
            statePath: options.backend === "local-file" ? capabilityKernelStatePath(options) : "",
            degraded: description.securityMode === "degraded_file_fallback"
          }
        }
      });
      return true;
    }
    if (domain === "binding-guard" || domain === "binding" || domain === "capability-binding-guard") {
      if (action !== "status" && action !== "describe") {
        throw new Error(`未知 security binding-guard 命令：${args._.join(" ")}`);
      }
      const description = await bindingGuard.describe();
      await writeResponse({
        args,
        result: {
          ok: true,
          capabilityBindingGuard: {
            ...description,
            statePath: bindingOptions.backend === "local-file" ? capabilityBindingGuardStatePath(bindingOptions) : description.statePath || "",
            degraded: description.securityMode === "degraded_file_fallback"
          }
        }
      });
      return true;
    }
    if (domain !== "recovery") {
      throw new Error(`未知 security 命令：${args._.join(" ")}`);
    }
    if (action === "export") {
      const passphrase = await readRecoveryPassphrase(args);
      const recoveryPackage = await exportSecurityRecoveryPackage({
        provider,
        bindingGuard,
        passphrase,
        reason: args.reason || ""
      });
      if (args.output) {
        const outputPath = await writePrivateJsonFile(args.output, recoveryPackage);
        await writeResponse({
          args: { ...args, output: "" },
          result: {
            ok: true,
            protocolVersion: recoveryPackage.protocolVersion,
            exportedAt: recoveryPackage.exportedAt,
            components: {
              capabilityKernel: summarizeRecoveryComponent(recoveryPackage.components.capabilityKernel),
              capabilityBindingGuard: summarizeRecoveryComponent(recoveryPackage.components.capabilityBindingGuard)
            },
            outputPath
          }
        });
      } else {
        await writeResponse({ args, result: recoveryPackage });
      }
      return true;
    }
    if (action === "import") {
      const inputPath = args.input || args.file?.[0] || args._[3];
      if (!inputPath || inputPath === true) {
        throw new Error("security recovery import requires --input recovery.json.");
      }
      const passphrase = await readRecoveryPassphrase(args);
      const recoveryPackage = await readJsonInput(String(inputPath), "--input");
      const imported = await importSecurityRecoveryPackage({
        provider,
        bindingGuard,
        recoveryPackage,
        passphrase
      });
      await writeResponse({
        args,
        result: imported
      });
      return true;
    }
    throw new Error(`未知 security recovery 命令：${args._.join(" ")}`);
  } finally {
    provider.close?.();
    bindingGuard.close?.();
  }
}

async function runRpc(args) {
  const method = String(args.method || args.m || "GET").toUpperCase();
  const apiPath = normalizeApiPath(requireValue(args, "path"));
  const { body, headers } = await readHttpPayload(args, method);
  const { response, buffer } = await requestRaw({
    serverUrl: args["server-url"],
    method,
    apiPath,
    body,
    headers,
    binary: Boolean(args.output)
  });
  const contentType = response.headers.get("content-type") || "";

  if (/json/i.test(contentType)) {
    await writeResponse({
      args,
      result: JSON.parse(buffer.toString("utf8") || "{}"),
      rawBuffer: args.output ? buffer : null,
      contentType
    });
    return;
  }

  await writeResponse({
    args,
    result: {},
    rawBuffer: buffer,
    contentType
  });
}

async function runServerRpcCall(args) {
  const rpcMethod = args["rpc-method"] || args._[1];
  if (!rpcMethod || rpcMethod === true) {
    throw new Error("rpc-call requires a RPC method, for example: pact rpc-call jobs.list");
  }
  const params = applyCommonSafetyFlags(args, await readRpcParams(args));
  const result = await requestJson({
    serverUrl: args["server-url"],
    method: "POST",
    apiPath: "/api/rpc",
    headers: applyCommonSafetyHeaders(args, readHeaders(args)),
    body: {
      jsonrpc: "2.0",
      id: args.id || Date.now(),
      method: String(rpcMethod),
      params
    }
  });
  await writeResponse({ args, result });
}

function toolIdArg(args) {
  return String(args["tool-id"] || args.toolId || args.id || args._[2] || "").trim();
}

async function runToolsCommand(args) {
  const command = String(args._[1] || "catalog");
  const subcommand = String(args._[2] || "");
  if (command === "catalog") {
    await writeResponse({
      args,
      result: await requestJson({
        serverUrl: args["server-url"],
        method: "GET",
        apiPath: "/api/tool-management/v1/catalog",
        headers: readHeaders(args)
      })
    });
    return;
  }
  if (command === "toolsets") {
    if (subcommand === "resolve") {
      await writeResponse({
        args,
        result: await requestJson({
          serverUrl: args["server-url"],
          method: "POST",
          apiPath: "/api/tool-management/v1/toolsets/resolve",
          headers: applyCommonSafetyHeaders(args, readHeaders(args)),
          body: await readBody(args)
        })
      });
      return;
    }
    await writeResponse({
      args,
      result: await requestJson({
        serverUrl: args["server-url"],
        method: "GET",
        apiPath: "/api/tool-management/v1/toolsets",
        headers: readHeaders(args)
      })
    });
    return;
  }
  if (command === "profiles") {
    await writeResponse({
      args,
      result: await requestJson({
        serverUrl: args["server-url"],
        method: "GET",
        apiPath: "/api/tool-management/v1/profiles",
        headers: readHeaders(args)
      })
    });
    return;
  }
  if (command === "execute" || command === "dry-run") {
    const body = await readBody(args);
    const toolId = String(body.toolId || toolIdArg(args));
    if (!toolId) {
      throw new Error("tools execute requires --tool-id or body.toolId");
    }
    const { toolId: _toolId, schemaVersion: _schemaVersion, context = {}, dryRun = false, input: explicitInput, ...inlineInput } = body;
    await writeResponse({
      args,
      result: await requestJson({
        serverUrl: args["server-url"],
        method: "POST",
        apiPath: command === "dry-run" ? "/api/tool-management/v1/dry-run" : "/api/tool-management/v1/execute",
        headers: readHeaders(args),
        body: {
          schemaVersion: "v0.0.1:schema:definition-1",
          ...body,
          toolId,
          context,
          dryRun,
          input: explicitInput || inlineInput
        }
      })
    });
    return;
  }
  if (command === "audit") {
    const query = new URLSearchParams();
    if (args.limit) {
      query.set("limit", String(args.limit));
    }
    if (args["tool-id"] || args.toolId) {
      query.set("toolId", String(args["tool-id"] || args.toolId));
    }
    if (args["grant-id"] || args.grantId) {
      query.set("grantId", String(args["grant-id"] || args.grantId));
    }
    if (args.status) {
      query.set("status", String(args.status));
    }
    await writeResponse({
      args,
      result: await requestJson({
        serverUrl: args["server-url"],
        method: "GET",
        apiPath: `/api/tool-management/v1/audit${query.toString() ? `?${query}` : ""}`,
        headers: readHeaders(args)
      })
    });
    return;
  }
  if (command === "metrics") {
    if (subcommand === "export") {
      const query = new URLSearchParams();
      if (args.limit) {
        query.set("limit", String(args.limit));
      }
      if (args.since) {
        query.set("since", String(args.since));
      }
      if (args.until) {
        query.set("until", String(args.until));
      }
      if (args.kind) {
        query.set("kind", String(args.kind));
      }
      if (args["tool-id"] || args.toolId) {
        query.set("toolId", String(args["tool-id"] || args.toolId));
      }
      if (args["grant-id"] || args.grantId) {
        query.set("grantId", String(args["grant-id"] || args.grantId));
      }
      if (args["profile-id"] || args.profileId) {
        query.set("profileId", String(args["profile-id"] || args.profileId));
      }
      if (args.route) {
        query.set("route", String(args.route));
      }
      if (args.transport) {
        query.set("transport", String(args.transport));
      }
      if (args.status) {
        query.set("status", String(args.status));
      }
      if (args["status-code"] || args.statusCode) {
        query.set("statusCode", String(args["status-code"] || args.statusCode));
      }
      if (args["completion-status"] || args.completionStatus) {
        query.set("completionStatus", String(args["completion-status"] || args.completionStatus));
      }
      await writeResponse({
        args,
        result: await requestJson({
          serverUrl: args["server-url"],
          method: "GET",
          apiPath: `/api/tool-management/v1/metrics/export${query.toString() ? `?${query}` : ""}`,
          headers: readHeaders(args)
        })
      });
      return;
    }
    if (subcommand === "health") {
      const query = new URLSearchParams();
      if (args["window-seconds"] || args.windowSeconds) {
        query.set("windowSeconds", String(args["window-seconds"] || args.windowSeconds));
      }
      if (args["max-request-error-rate"] || args.maxRequestErrorRate) {
        query.set("maxRequestErrorRate", String(args["max-request-error-rate"] || args.maxRequestErrorRate));
      }
      if (args["max-tool-failure-rate"] || args.maxToolFailureRate) {
        query.set("maxToolFailureRate", String(args["max-tool-failure-rate"] || args.maxToolFailureRate));
      }
      if (args["max-denied-rate"] || args.maxDeniedRate) {
        query.set("maxDeniedRate", String(args["max-denied-rate"] || args.maxDeniedRate));
      }
      if (args["max-request-p95-ms"] || args.maxRequestP95Ms) {
        query.set("maxRequestP95Ms", String(args["max-request-p95-ms"] || args.maxRequestP95Ms));
      }
      if (args["max-tool-p95-ms"] || args.maxToolP95Ms) {
        query.set("maxToolP95Ms", String(args["max-tool-p95-ms"] || args.maxToolP95Ms));
      }
      if (args["min-requests"] || args.minRequests) {
        query.set("minRequests", String(args["min-requests"] || args.minRequests));
      }
      await writeResponse({
        args,
        result: await requestJson({
          serverUrl: args["server-url"],
          method: "GET",
          apiPath: `/api/tool-management/v1/metrics/health${query.toString() ? `?${query}` : ""}`,
          headers: readHeaders(args)
        })
      });
      return;
    }
    if (subcommand === "prometheus") {
      const query = new URLSearchParams();
      if (args["window-seconds"] || args.windowSeconds) {
        query.set("windowSeconds", String(args["window-seconds"] || args.windowSeconds));
      }
      if (args["max-request-error-rate"] || args.maxRequestErrorRate) {
        query.set("maxRequestErrorRate", String(args["max-request-error-rate"] || args.maxRequestErrorRate));
      }
      if (args["max-tool-failure-rate"] || args.maxToolFailureRate) {
        query.set("maxToolFailureRate", String(args["max-tool-failure-rate"] || args.maxToolFailureRate));
      }
      if (args["max-denied-rate"] || args.maxDeniedRate) {
        query.set("maxDeniedRate", String(args["max-denied-rate"] || args.maxDeniedRate));
      }
      if (args["max-request-p95-ms"] || args.maxRequestP95Ms) {
        query.set("maxRequestP95Ms", String(args["max-request-p95-ms"] || args.maxRequestP95Ms));
      }
      if (args["max-tool-p95-ms"] || args.maxToolP95Ms) {
        query.set("maxToolP95Ms", String(args["max-tool-p95-ms"] || args.maxToolP95Ms));
      }
      if (args["min-requests"] || args.minRequests) {
        query.set("minRequests", String(args["min-requests"] || args.minRequests));
      }
      const { response, buffer } = await requestRaw({
        serverUrl: args["server-url"],
        method: "GET",
        apiPath: `/api/tool-management/v1/metrics/prometheus${query.toString() ? `?${query}` : ""}`,
        headers: readHeaders(args),
        binary: true
      });
      await writeResponse({
        args,
        result: {},
        rawBuffer: buffer,
        contentType: response.headers.get("content-type") || ""
      });
      return;
    }
    if (subcommand === "storage") {
      await writeResponse({
        args,
        result: await requestJson({
          serverUrl: args["server-url"],
          method: "GET",
          apiPath: "/api/tool-management/v1/metrics/storage",
          headers: readHeaders(args)
        })
      });
      return;
    }
    if (subcommand === "prune") {
      await writeResponse({
        args,
        result: await requestJson({
          serverUrl: args["server-url"],
          method: "POST",
          apiPath: "/api/tool-management/v1/metrics/prune",
          headers: applyCommonSafetyHeaders(args, readHeaders(args)),
          body: await readBody(args)
        })
      });
      return;
    }
    const query = new URLSearchParams();
    if (args.limit) {
      query.set("limit", String(args.limit));
    }
    if (args.since) {
      query.set("since", String(args.since));
    }
    if (args.until) {
      query.set("until", String(args.until));
    }
    if (args["tool-id"] || args.toolId) {
      query.set("toolId", String(args["tool-id"] || args.toolId));
    }
    if (args["grant-id"] || args.grantId) {
      query.set("grantId", String(args["grant-id"] || args.grantId));
    }
    if (args["profile-id"] || args.profileId) {
      query.set("profileId", String(args["profile-id"] || args.profileId));
    }
    if (args.route) {
      query.set("route", String(args.route));
    }
    if (args.transport) {
      query.set("transport", String(args.transport));
    }
    if (args.status) {
      query.set("status", String(args.status));
    }
    if (args["status-code"] || args.statusCode) {
      query.set("statusCode", String(args["status-code"] || args.statusCode));
    }
    if (args["completion-status"] || args.completionStatus) {
      query.set("completionStatus", String(args["completion-status"] || args.completionStatus));
    }
    if (args["bucket-seconds"] || args.bucketSeconds) {
      query.set("bucketSeconds", String(args["bucket-seconds"] || args.bucketSeconds));
    }
    await writeResponse({
      args,
      result: await requestJson({
        serverUrl: args["server-url"],
        method: "GET",
        apiPath: `/api/tool-management/v1/metrics/summary${query.toString() ? `?${query}` : ""}`,
        headers: readHeaders(args)
      })
    });
    return;
  }
  if (command === "grants") {
    if (!subcommand || subcommand === "list") {
      await writeResponse({
        args,
        result: await requestJson({
          serverUrl: args["server-url"],
          method: "GET",
          apiPath: "/api/tool-management/v1/grants",
          headers: readHeaders(args)
        })
      });
      return;
    }
    if (subcommand === "create") {
      await writeResponse({
        args,
        result: await requestJson({
          serverUrl: args["server-url"],
          method: "POST",
          apiPath: "/api/tool-management/v1/grants",
          headers: applyCommonSafetyHeaders(args, readHeaders(args)),
          body: await readBody(args)
        })
      });
      return;
    }
    if (subcommand === "rotate" || subcommand === "revoke") {
      const grantId = String(args["grant-id"] || args.grantId || args.id || args._[3] || "").trim();
      if (!grantId) {
        throw new Error(`tools grants ${subcommand} requires --id GRANT_ID`);
      }
      await writeResponse({
        args,
        result: await requestJson({
          serverUrl: args["server-url"],
          method: "POST",
          apiPath: `/api/tool-management/v1/grants/${encodeURIComponent(grantId)}/${subcommand}`,
          headers: applyCommonSafetyHeaders(args, readHeaders(args)),
          body: subcommand === "revoke" ? await readBody(args) : {}
        })
      });
      return;
    }
  }
  if (command === "policy" && subcommand === "preview") {
    await writeResponse({
      args,
      result: await requestJson({
        serverUrl: args["server-url"],
        method: "POST",
        apiPath: "/api/tool-management/v1/policy/preview",
        headers: applyCommonSafetyHeaders(args, readHeaders(args)),
        body: await readBody(args)
      })
    });
    return;
  }
  throw new Error(`未知 tools 命令：${args._.join(" ")}`);
}

async function getActiveCliOperations(args = {}) {
  const featureRuntime = await resolveFeatureRuntimeFromEnv({ args });
  return filterOperationsForFeatures(SERVER_API_OPERATIONS, featureRuntime);
}

function writeLocalInterfaceCatalog(args, operations) {
  if (String(args.format || "").toLowerCase() === "markdown") {
    process.stdout.write(`${formatInterfaceCatalogMarkdown(operations)}\n`);
    return true;
  }
  if (args.local) {
    process.stdout.write(`${JSON.stringify({ interfaces: listInterfaceCatalog(operations) }, null, 2)}\n`);
    return true;
  }
  return false;
}

async function runNamedRpc(args) {
  const activeOperations = await getActiveCliOperations(args);
  const cliMatch = findCliOperation(args._, activeOperations);
  if (!cliMatch) {
    throw new Error(`未知命令：${args._[0] || ""}\n${usage()}`);
  }
  const operation = cliMatch.operation;
  if (operation.id === "system.interfaces" && writeLocalInterfaceCatalog(args, activeOperations)) {
    return;
  }

  const apiPath = buildApiPathForCliOperation(operation, args);
  let body;
  let headers = applyCommonSafetyHeaders(args, readHeaders(args));
  if (operation.http.method !== "GET" && operation.http.method !== "HEAD") {
    const cliBody = args.body === undefined && !args["body-file"]
      ? buildBodyFromCliParams(operation, args)
      : null;
    if (cliBody) {
      body = cliBody;
    } else {
      const payload = await readHttpPayload(args, operation.http.method);
      body = payload.body;
      headers = applyCommonSafetyHeaders(args, payload.headers);
    }
    body = applyCommonSafetyFlags(args, body);
  }

  const { response, buffer } = await requestRaw({
    serverUrl: args["server-url"],
    method: operation.http.method,
    apiPath,
    body,
    headers,
    binary: operation.binary || Boolean(args.output)
  });
  const contentType = response.headers.get("content-type") || "";
  if (/json/i.test(contentType)) {
    await writeResponse({
      args,
      result: JSON.parse(buffer.toString("utf8") || "{}"),
      rawBuffer: args.output ? buffer : null,
      contentType
    });
    return;
  }
  await writeResponse({ args, result: {}, rawBuffer: buffer, contentType });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    console.log(usage());
    return;
  }

  if (await runSecretCommand(args)) {
    return;
  }

  if (await runSecurityCommand(args)) {
    return;
  }

  if (args._[0] === "rpc") {
    await runRpc(args);
    return;
  }

  if (args._[0] === "rpc-call") {
    await runServerRpcCall(args);
    return;
  }

  if (args._[0] === "tools") {
    await runToolsCommand(args);
    return;
  }

  if (args.file.length > 0 || args.path.length > 0 || args._[0] === "upload") {
    if (args._[0] === "upload") {
      args.input.push(...args._.slice(1));
    }
    await runUpload(args);
    return;
  }

  await runNamedRpc(args);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
