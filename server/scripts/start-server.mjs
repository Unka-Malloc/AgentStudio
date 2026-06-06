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

function printUsageAndExit(code = 0) {
  console.log(`Pact Server

Usage:
  node server/scripts/start-server.mjs [--host 0.0.0.0] [--port ${DEFAULT_SERVER_PORT}] [--data-dir /path/to/data] [--with-ui] [--profile minimal|default] [--edition community|pro|enterprise|custom]

Options:
  --host                    监听地址，默认读取 PACT_SERVER_HOST，否则使用 127.0.0.1
  --allow-public-console    允许监听非回环地址；等价于 PACT_ALLOW_PUBLIC_CONSOLE=1
  --port                    监听端口，默认读取 PACT_SERVER_PORT，否则使用 ${DEFAULT_SERVER_PORT}
  --data-dir                数据目录，默认读取 PACT_SERVER_DATA_DIR，否则读取 ~/.pact-server.json，最后使用 ~/.pact-server-data
  --with-ui                 同时提供 build/dist 前端页面；build/dist 不存在时会报错
  --profile                 运行档位：default|minimal，默认 default
  --edition                 功能版本：community|pro|enterprise|custom
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

const host = String(args.host || process.env.PACT_SERVER_HOST || "127.0.0.1").trim();
const port = normalizePort(args.port || process.env.PACT_SERVER_PORT, DEFAULT_SERVER_PORT);
const userDataPath = path.resolve(
  String(
    args["data-dir"] ||
      process.env.PACT_SERVER_DATA_DIR ||
      ServerConfig.getDataDir()
  )
);
const withUi =
  args["with-ui"] === true || process.env.PACT_SERVER_WITH_UI === "1";
const runtimeOptions = {
  profile: String(args.profile || process.env.PACT_SERVER_PROFILE || "default").trim(),
  featureEdition: String(
    args.edition || process.env.PACT_FEATURE_EDITION || ""
  ).trim(),
  featureProfile: String(
    args["feature-profile"] || process.env.PACT_FEATURE_PROFILE || ""
  ).trim(),
  allowPublicConsole: args["allow-public-console"] === true || enabledFlag(process.env.PACT_ALLOW_PUBLIC_CONSOLE),
  cwd: projectRoot,
  mountModules: {
    analysis: String(
      args["analysis-module"] || process.env.PACT_SERVER_ANALYSIS_MODULE || ""
    ).trim(),
    ocr: String(args["ocr-module"] || process.env.PACT_SERVER_OCR_MODULE || "").trim(),
    multimodalParser: String(
      args["multimodal-parser-module"] ||
        process.env.PACT_SERVER_MULTIMODAL_PARSER_MODULE ||
        ""
    ).trim(),
    documentParser: String(
      args["document-parser-module"] || process.env.PACT_SERVER_DOCUMENT_PARSER_MODULE || ""
    ).trim(),
    pdfProcessor: String(
      args["pdf-processor-module"] || process.env.PACT_SERVER_PDF_PROCESSOR_MODULE || ""
    ).trim(),
    knowledgeBase: String(
      args["knowledge-base-module"] || process.env.PACT_SERVER_KNOWLEDGE_BASE_MODULE || ""
    ).trim(),
    vectorStore: String(
      args["vector-store-module"] || process.env.PACT_SERVER_VECTOR_STORE_MODULE || ""
    ).trim(),
    graphStore: String(
      args["graph-store-module"] || process.env.PACT_SERVER_GRAPH_STORE_MODULE || ""
    ).trim()
  }
};
const discoveryOptions = {
  serverId: String(args["server-id"] || process.env.PACT_SERVER_ID || "").trim(),
  serverLabel: String(args["server-label"] || process.env.PACT_SERVER_LABEL || "").trim(),
  bootstrapBaseUrl: String(
    args["bootstrap-url"] || process.env.PACT_BOOTSTRAP_URL || ""
  ).trim(),
  advertisedBaseUrl: String(
    args["advertised-base-url"] || process.env.PACT_ADVERTISED_BASE_URL || ""
  ).trim(),
  activeServiceUrl: String(
    args["active-service-url"] || process.env.PACT_ACTIVE_SERVICE_URL || ""
  ).trim(),
  forwardBaseUrl: String(
    args["forward-to-url"] || process.env.PACT_FORWARD_TO_URL || ""
  ).trim(),
  mode: String(
    args["discovery-mode"] || process.env.PACT_DISCOVERY_MODE || "active"
  ).trim(),
  configVersion: String(
    args["config-version"] || process.env.PACT_DISCOVERY_CONFIG_VERSION || ""
  ).trim(),
  refreshIntervalSeconds:
    args["refresh-interval-seconds"] ||
    process.env.PACT_DISCOVERY_REFRESH_INTERVAL_SECONDS ||
    "",
  checkInIntervalSeconds:
    args["check-in-interval-seconds"] ||
    process.env.PACT_DISCOVERY_CHECK_IN_INTERVAL_SECONDS ||
    "",
  offlineAfterSeconds:
    args["offline-after-seconds"] ||
    process.env.PACT_DISCOVERY_OFFLINE_AFTER_SECONDS ||
    ""
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
    if (err.code === 'EADDRINUSE' && currentPort < maxPort) {
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
