import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { startHttpServer } from "../services/server-runtime/http-server.mjs";

import { ServerConfig } from "../platform/common/config/ServerConfig.mjs";
import { DEFAULT_SERVER_PORT } from "../config/ServerEnv.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../..");
const defaultDistPath = path.join(projectRoot, "build", "dist");

function parseArgs(argv) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      continue;
    }

    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
      continue;
    }

    parsed[key] = next;
    index += 1;
  }

  return parsed;
}

function normalizePort(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
    throw new Error(`无效端口号：${value}`);
  }

  return parsed;
}

function enabledFlag(value) {
  return value === true || ["1", "true", "yes"].includes(String(value || "").trim().toLowerCase());
}

function readRuntimeConfig(configPath = "") {
  const resolvedPath = String(configPath || "").trim();
  if (!resolvedPath) {
    return { filePath: "", dir: process.cwd(), config: {} };
  }
  const absolutePath = path.resolve(resolvedPath);
  const raw = fs.readFileSync(absolutePath, "utf8");
  const config = JSON.parse(raw);
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error(`运行时配置必须是 JSON 对象：${absolutePath}`);
  }
  return {
    filePath: absolutePath,
    dir: path.dirname(absolutePath),
    config
  };
}

function nestedValue(source, keyPath) {
  return String(keyPath || "")
    .split(".")
    .filter(Boolean)
    .reduce((current, key) => {
      if (!current || typeof current !== "object" || Array.isArray(current)) {
        return undefined;
      }
      return current[key];
    }, source);
}

function firstDefined(values) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function configValue(config, keys = []) {
  return firstDefined(keys.map((key) => nestedValue(config, key)));
}

function optionValue({ args, argKeys = [], config, configKeys = [], env, fallback = "" }) {
  return firstDefined([
    ...argKeys.map((key) => args[key]),
    configValue(config, configKeys),
    env ? process.env[env] : undefined,
    fallback
  ]);
}

function optionFlag({ args, argKeys = [], config, configKeys = [], env, fallback = false }) {
  const value = firstDefined([
    ...argKeys.map((key) => args[key]),
    configValue(config, configKeys),
    env ? process.env[env] : undefined
  ]);
  return value === undefined ? fallback : enabledFlag(value);
}

function optionPath({ args, argKeys = [], config, configKeys = [], configDir, env, fallback = "" }) {
  const argValue = firstDefined(argKeys.map((key) => args[key]));
  if (argValue) {
    return path.resolve(String(argValue));
  }
  const configured = configValue(config, configKeys);
  if (configured) {
    return path.resolve(configDir, String(configured));
  }
  const envValue = env ? process.env[env] : "";
  if (envValue) {
    return path.resolve(String(envValue));
  }
  return fallback ? path.resolve(String(fallback)) : "";
}

function printUsageAndExit(code = 0) {
  console.log(`Pact Server

Usage:
  node server/scripts/start-server.mjs [--runtime-config /path/to/runtime-instance.json] [--host 0.0.0.0] [--port ${DEFAULT_SERVER_PORT}] [--data-dir /path/to/data] [--with-ui] [--profile minimal|default] [--edition community|pro|enterprise|client-local|custom]

Options:
  --runtime-config          显式运行时实例配置 JSON；client-local supervisor 路径必须传入
  --require-runtime-config  未传 --runtime-config 时直接失败
  --expected-runtime-kind   校验 runtime-config.runtimeKind，例如 client-local
  --expected-edition        校验最终功能版本，例如 client-local
  --host                    监听地址，默认读取 PACT_SERVER_HOST，否则使用 127.0.0.1
  --allow-public-console    允许监听非回环地址；等价于 PACT_ALLOW_PUBLIC_CONSOLE=1
  --port                    监听端口，默认读取 PACT_SERVER_PORT，否则使用 ${DEFAULT_SERVER_PORT}
  --strict-port             端口被占用时直接失败，不自动尝试后续端口
  --data-dir                数据目录，默认读取 PACT_SERVER_DATA_DIR，否则读取 ~/.pact-server.json，最后使用 ~/.pact-server-data
  --with-ui                 同时提供 build/dist 前端页面；build/dist 不存在时会报错
  --profile                 运行档位：default|minimal，默认 default
  --edition                 功能版本：community|pro|enterprise|client-local|custom
  --feature-profile         自定义功能 profile JSON 路径
  --server-id               服务实例 ID
  --server-label            服务实例标签
  --bootstrap-url           客户端引导地址
  --advertised-base-url     当前实例对外地址
  --active-service-url      当前活跃业务服务地址
  --forward-to-url          旧服务切换时的转发目标
  --discovery-mode          active|forward，默认 active
  --config-version          发现配置版本号
  --refresh-interval-seconds 服务发现刷新间隔
  --check-in-interval-seconds 客户端回报间隔
  --offline-after-seconds   客户端离线判定秒数
  --analysis-module         分析算法挂载模块路径
  --ocr-module              OCR 挂载模块路径
  --multimodal-parser-module 多模态文档解析挂载模块路径
  --document-parser-module  文档解析挂载模块路径
  --pdf-processor-module    PDF 处理挂载模块路径
  --knowledge-base-module   知识库挂载模块路径
  --vector-store-module     向量库挂载模块路径
  --graph-store-module      图数据库挂载模块路径
  --help                    显示帮助
`);
  process.exit(code);
}

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  printUsageAndExit(0);
}

const runtimeConfigPath = String(args["runtime-config"] || args.runtimeConfig || process.env.PACT_RUNTIME_CONFIG || "").trim();
if ((args["require-runtime-config"] === true || enabledFlag(process.env.PACT_REQUIRE_RUNTIME_CONFIG)) && !runtimeConfigPath) {
  throw new Error("必须显式传入 --runtime-config。");
}
const runtimeConfig = readRuntimeConfig(runtimeConfigPath);
const runtimeConfigObject = runtimeConfig.config;
const expectedRuntimeKind = String(args["expected-runtime-kind"] || process.env.PACT_EXPECTED_RUNTIME_KIND || "").trim();
const runtimeKind = String(configValue(runtimeConfigObject, ["runtimeKind", "runtime.kind", "kind"]) || "").trim();
if (expectedRuntimeKind && runtimeKind !== expectedRuntimeKind) {
  throw new Error(`运行时配置类型不匹配：期望 ${expectedRuntimeKind}，实际 ${runtimeKind || "<missing>"}`);
}

const host = String(optionValue({
  args,
  argKeys: ["host"],
  config: runtimeConfigObject,
  configKeys: ["host", "server.host"],
  env: "PACT_SERVER_HOST",
  fallback: "127.0.0.1"
})).trim();
const port = normalizePort(optionValue({
  args,
  argKeys: ["port"],
  config: runtimeConfigObject,
  configKeys: ["port", "server.port"],
  env: "PACT_SERVER_PORT",
  fallback: DEFAULT_SERVER_PORT
}), DEFAULT_SERVER_PORT);
const strictPort = optionFlag({
  args,
  argKeys: ["strict-port", "strictPort"],
  config: runtimeConfigObject,
  configKeys: ["strictPort", "strict-port", "server.strictPort", "runtime.strictPort"],
  env: "PACT_SERVER_STRICT_PORT",
  fallback: false
});
const userDataPath = optionPath({
  args,
  argKeys: ["data-dir", "dataDir"],
  config: runtimeConfigObject,
  configKeys: ["dataDir", "data-dir", "server.dataDir", "server.data-dir"],
  configDir: runtimeConfig.dir,
  env: "PACT_SERVER_DATA_DIR",
  fallback: ServerConfig.getDataDir()
});
const withUi = optionFlag({
  args,
  argKeys: ["with-ui", "withUi"],
  config: runtimeConfigObject,
  configKeys: ["withUi", "with-ui", "server.withUi", "server.with-ui"],
  env: "PACT_SERVER_WITH_UI",
  fallback: false
});
const runtimeOptions = {
  profile: String(optionValue({
    args,
    argKeys: ["profile"],
    config: runtimeConfigObject,
    configKeys: ["profile", "runtime.profile"],
    env: "PACT_SERVER_PROFILE",
    fallback: "default"
  })).trim(),
  featureEdition: String(optionValue({
    args,
    argKeys: ["edition", "featureEdition"],
    config: runtimeConfigObject,
    configKeys: ["edition", "featureEdition", "runtime.edition", "runtime.featureEdition"],
    env: "PACT_FEATURE_EDITION",
    fallback: ""
  })).trim(),
  featureProfile: optionPath({
    args,
    argKeys: ["feature-profile", "featureProfile"],
    config: runtimeConfigObject,
    configKeys: ["featureProfile", "feature-profile", "runtime.featureProfile", "runtime.feature-profile"],
    configDir: runtimeConfig.dir,
    env: "PACT_FEATURE_PROFILE",
    fallback: ""
  }),
  allowPublicConsole: optionFlag({
    args,
    argKeys: ["allow-public-console", "allowPublicConsole"],
    config: runtimeConfigObject,
    configKeys: ["allowPublicConsole", "allow-public-console", "runtime.allowPublicConsole", "runtime.allow-public-console"],
    env: "PACT_ALLOW_PUBLIC_CONSOLE",
    fallback: false
  }),
  cwd: projectRoot,
  mountModules: {
    analysis: String(optionValue({ args, argKeys: ["analysis-module"], config: runtimeConfigObject, configKeys: ["mountModules.analysis"], env: "PACT_SERVER_ANALYSIS_MODULE", fallback: "" })).trim(),
    ocr: String(optionValue({ args, argKeys: ["ocr-module"], config: runtimeConfigObject, configKeys: ["mountModules.ocr"], env: "PACT_SERVER_OCR_MODULE", fallback: "" })).trim(),
    multimodalParser: String(optionValue({ args, argKeys: ["multimodal-parser-module"], config: runtimeConfigObject, configKeys: ["mountModules.multimodalParser"], env: "PACT_SERVER_MULTIMODAL_PARSER_MODULE", fallback: "" })).trim(),
    documentParser: String(optionValue({ args, argKeys: ["document-parser-module"], config: runtimeConfigObject, configKeys: ["mountModules.documentParser"], env: "PACT_SERVER_DOCUMENT_PARSER_MODULE", fallback: "" })).trim(),
    pdfProcessor: String(optionValue({ args, argKeys: ["pdf-processor-module"], config: runtimeConfigObject, configKeys: ["mountModules.pdfProcessor"], env: "PACT_SERVER_PDF_PROCESSOR_MODULE", fallback: "" })).trim(),
    knowledgeBase: String(optionValue({ args, argKeys: ["knowledge-base-module"], config: runtimeConfigObject, configKeys: ["mountModules.knowledgeBase"], env: "PACT_SERVER_KNOWLEDGE_BASE_MODULE", fallback: "" })).trim(),
    vectorStore: String(optionValue({ args, argKeys: ["vector-store-module"], config: runtimeConfigObject, configKeys: ["mountModules.vectorStore"], env: "PACT_SERVER_VECTOR_STORE_MODULE", fallback: "" })).trim(),
    graphStore: String(optionValue({ args, argKeys: ["graph-store-module"], config: runtimeConfigObject, configKeys: ["mountModules.graphStore"], env: "PACT_SERVER_GRAPH_STORE_MODULE", fallback: "" })).trim()
  }
};
const expectedEdition = String(args["expected-edition"] || process.env.PACT_EXPECTED_FEATURE_EDITION || "").trim();
if (expectedEdition && runtimeOptions.featureEdition !== expectedEdition) {
  throw new Error(`运行时功能版本不匹配：期望 ${expectedEdition}，实际 ${runtimeOptions.featureEdition || "<missing>"}`);
}
const discoveryOptions = {
  serverId: String(optionValue({ args, argKeys: ["server-id", "serverId"], config: runtimeConfigObject, configKeys: ["discovery.serverId"], env: "PACT_SERVER_ID", fallback: "" })).trim(),
  serverLabel: String(optionValue({ args, argKeys: ["server-label", "serverLabel"], config: runtimeConfigObject, configKeys: ["discovery.serverLabel"], env: "PACT_SERVER_LABEL", fallback: "" })).trim(),
  bootstrapBaseUrl: String(optionValue({ args, argKeys: ["bootstrap-url", "bootstrapUrl"], config: runtimeConfigObject, configKeys: ["discovery.bootstrapBaseUrl", "discovery.bootstrapUrl"], env: "PACT_BOOTSTRAP_URL", fallback: "" })).trim(),
  advertisedBaseUrl: String(optionValue({ args, argKeys: ["advertised-base-url", "advertisedBaseUrl"], config: runtimeConfigObject, configKeys: ["discovery.advertisedBaseUrl"], env: "PACT_ADVERTISED_BASE_URL", fallback: "" })).trim(),
  activeServiceUrl: String(optionValue({ args, argKeys: ["active-service-url", "activeServiceUrl"], config: runtimeConfigObject, configKeys: ["discovery.activeServiceUrl"], env: "PACT_ACTIVE_SERVICE_URL", fallback: "" })).trim(),
  forwardBaseUrl: String(optionValue({ args, argKeys: ["forward-to-url", "forwardBaseUrl"], config: runtimeConfigObject, configKeys: ["discovery.forwardBaseUrl"], env: "PACT_FORWARD_TO_URL", fallback: "" })).trim(),
  mode: String(optionValue({ args, argKeys: ["discovery-mode", "discoveryMode"], config: runtimeConfigObject, configKeys: ["discovery.mode"], env: "PACT_DISCOVERY_MODE", fallback: "active" })).trim(),
  configVersion: String(optionValue({ args, argKeys: ["config-version", "configVersion"], config: runtimeConfigObject, configKeys: ["discovery.configVersion"], env: "PACT_DISCOVERY_CONFIG_VERSION", fallback: "" })).trim(),
  refreshIntervalSeconds: optionValue({ args, argKeys: ["refresh-interval-seconds", "refreshIntervalSeconds"], config: runtimeConfigObject, configKeys: ["discovery.refreshIntervalSeconds"], env: "PACT_DISCOVERY_REFRESH_INTERVAL_SECONDS", fallback: "" }),
  checkInIntervalSeconds: optionValue({ args, argKeys: ["check-in-interval-seconds", "checkInIntervalSeconds"], config: runtimeConfigObject, configKeys: ["discovery.checkInIntervalSeconds"], env: "PACT_DISCOVERY_CHECK_IN_INTERVAL_SECONDS", fallback: "" }),
  offlineAfterSeconds: optionValue({ args, argKeys: ["offline-after-seconds", "offlineAfterSeconds"], config: runtimeConfigObject, configKeys: ["discovery.offlineAfterSeconds"], env: "PACT_DISCOVERY_OFFLINE_AFTER_SECONDS", fallback: "" })
};
const distPath = withUi ? defaultDistPath : "";

if (withUi && !fs.existsSync(defaultDistPath)) {
  throw new Error("build/dist 不存在。请先执行 npm run build:renderer，或不要传 --with-ui。");
}

let serverHandle;
let currentPort = port;
const maxPort = port + 10;

while (true) {
  try {
    serverHandle = await startHttpServer({
      userDataPath,
      distPath,
      runtimeOptions,
      discoveryOptions,
      host,
      port: currentPort
    });
    break;
  } catch (err) {
    if (!strictPort && err.code === 'EADDRINUSE' && currentPort < maxPort) {
      console.warn(`Port ${currentPort} is in use, trying ${currentPort + 1}...`);
      currentPort++;
    } else {
      throw err;
    }
  }
}

console.log(`Pact server is running at ${serverHandle.url}`);
console.log(`Listening on ${serverHandle.host}:${serverHandle.port}`);
console.log(`Data dir: ${userDataPath}`);
console.log(`UI mode: ${withUi ? "enabled" : "api-only"}`);
console.log(`Runtime profile: ${runtimeOptions.profile}`);
console.log(
  `Discovery: ${serverHandle.discovery.mode} · active=${serverHandle.discovery.activeServiceUrl}`
);

async function shutdown(code = 0) {
  console.log("Shutting down...");
  try {
    await serverHandle.close();
    console.log("Server closed cleanly.");
  } catch (err) {
    console.error("Error during shutdown:", err?.message || err);
  }

  process.exit(code);
}

process.on("SIGINT", () => {
  void shutdown(0);
});

process.on("SIGTERM", () => {
  void shutdown(0);
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err?.message || err, err?.stack || "");
  void shutdown(1);
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason?.message || reason);
  void shutdown(1);
});
