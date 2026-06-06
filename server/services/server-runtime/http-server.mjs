import fs from "node:fs/promises";
import fsSync from "node:fs";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createBatchDeletionCoordinator } from "../client/work-queue-core/batch-deletion-coordinator.mjs";
import { resolveArchiveBatchIdentity } from "../client/work-queue-core/archive-batch-id.mjs";
import { createClientRuntimeAllocator } from "../client/client-runtime-core/client-runtime-allocator.mjs";
import {
  buildClientRuntimeBootstrapPlan,
  buildClientRuntimeBootstrapPull
} from "../client/client-runtime-core/client-runtime-bootstrap.mjs";
import {
  acknowledgeQueueMonitorAlert,
  inspectQueueMonitor,
  registerQueueClosed,
  registerQueueHeartbeat,
  registerQueueStarted
} from "../client/work-queue-core/queue-monitor.mjs";
import { requirePlatformInterface } from "../../platform/interactive/platform-registry.mjs";
import {
  createServerCompositionRoot,
  ensureConsoleOwner
} from "../../platform/interactive/composition-root.mjs";
import {
  createServerRuntimeProviders,
  createServerToolManagementPlatform,
  createServerToolSkillManagementProvider
} from "../../platform/interactive/server-runtime-providers.mjs";
import {
  loadDiscoveryConfig,
  resolveDiscoveryState,
  saveDiscoveryConfig
} from "../../platform/common/platform-core/discovery/config.mjs";
import { createJobManager } from "../client/work-queue-core/jobs/job-manager.mjs";
import { createJobWorkflowProvider } from "../../platform/specialized/console/job-workflow-provider.mjs";
import {
  createRuntimeLogger,
  setRuntimeLogger,
  summarizeError
} from "../../platform/common/observability/runtime-logger.mjs";
import {
  createTraceContext,
  runWithTraceContext,
  setTraceContextOnRequest
} from "../../platform/common/observability/trace-context.mjs";
import { handlePactMcpHttpRequest } from "../../platform/common/mcp/http-mcp-adapter.mjs";
import { loadOrCreateMcpIdentity } from "../../platform/common/mcp/identity.mjs";
import { ServerConfig } from "../../platform/common/config/ServerConfig.mjs";
import { createJobsController } from "../../platform/common/console/http/controllers/jobs-controller.mjs";
import { createSystemController } from "../../platform/common/console/http/controllers/system-controller.mjs";
import { getAcpAgentRelayRuntime } from "../../platform/specialized/console/console-domain-operation-executor.mjs";
import {
  defaultAdvertisedHost,
  formatUrlHost,
  readRequestBody,
  sendJson,
  serveStaticFile
} from "../../platform/common/console/http/http-utils.mjs";

const sourceCheckoutRoot = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));

function isPathInside(parentPath, candidatePath) {
  const relative = path.relative(path.resolve(parentPath), path.resolve(candidatePath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function resolveServerUserDataPath(inputUserDataPath) {
  const resolved = path.resolve(String(inputUserDataPath || ServerConfig.getDataDir()));
  const runningFromSourceCheckout = fsSync.existsSync(path.join(sourceCheckoutRoot, ".git"));
  if (runningFromSourceCheckout && isPathInside(sourceCheckoutRoot, resolved)) {
    throw new Error(
      `Refusing project-local Pact server data dir: ${resolved}. Use ServerConfig.getDataDir() or an external PACT_SERVER_DATA_DIR.`
    );
  }
  return resolved;
}

async function proxyApiRequest({
  request,
  response,
  requestBody,
  targetBaseUrl,
  discoveryState,
  logger = null
}) {
  const upstreamUrl = new URL(request.url || "/", targetBaseUrl);
  const startedAt = Date.now();
  logger?.info?.("http.proxy.started", {
    requestId: request.__pactRequestId || "",
    method: request.method || "GET",
    route: upstreamUrl.pathname,
    targetBaseUrl,
    serverId: discoveryState.serverId,
    activeServiceUrl: discoveryState.activeServiceUrl,
    bodyBytes: requestBody?.length || 0
  });
  const headers = new Headers();
  const allowedRequestHeaders = new Set([
    "accept",
    "authorization",
    "content-type",
    "cookie",
    "x-pact-csrf",
    "x-pact-safety-confirm",
    "x-pact-confirm",
    "x-pact-tool-token"
  ]);

  for (const [name, value] of Object.entries(request.headers || {})) {
    if (!value) {
      continue;
    }

    const lower = name.toLowerCase();
    if (!allowedRequestHeaders.has(lower)) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(name, item);
      }
      continue;
    }

    headers.set(name, value);
  }

  headers.set("x-pact-forwarded-by", discoveryState.serverId);
  headers.set("x-pact-active-service", discoveryState.activeServiceUrl);
  if (request.method !== "GET" && request.method !== "HEAD") {
    headers.set("content-length", String(requestBody?.length || 0));
  }

  let upstream;
  try {
    upstream = await new Promise((resolve, reject) => {
      const client = upstreamUrl.protocol === "https:" ? https : http;
      const upstreamRequest = client.request(
        upstreamUrl,
        {
          method: request.method || "GET",
          headers: Object.fromEntries(headers.entries()),
          timeout: 30_000
        },
        (upstreamResponse) => {
          // H-2: cap proxy response body to prevent memory exhaustion DoS
          const MAX_PROXY_BYTES = 64 * 1024 * 1024; // 64 MB
          const chunks = [];
          let totalBytes = 0;
          let aborted = false;
          upstreamResponse.on("data", (chunk) => {
            if (aborted) return;
            const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            totalBytes += buf.length;
            if (totalBytes > MAX_PROXY_BYTES) {
              aborted = true;
              upstreamResponse.destroy();
              reject(new Error(
                `为保障系统最佳体验，上游响应体目前支持最大 ${MAX_PROXY_BYTES / 1024 / 1024} MB 的数据流转。`
              ));
              return;
            }
            chunks.push(buf);
          });
          upstreamResponse.on("end", () => {
            if (aborted) return;
            resolve({
              status: upstreamResponse.statusCode || 502,
              headers: upstreamResponse.headers,
              body: Buffer.concat(chunks)
            });
          });
        }
      );
      upstreamRequest.on("timeout", () => {
        upstreamRequest.destroy(new Error("上游服务请求超时。"));
      });
      upstreamRequest.on("error", reject);
      if (request.method !== "GET" && request.method !== "HEAD" && requestBody?.length) {
        upstreamRequest.write(requestBody);
      }
      upstreamRequest.end();
    });
  } catch (error) {
    logger?.error?.("http.proxy.failed", {
      requestId: request.__pactRequestId || "",
      method: request.method || "GET",
      route: upstreamUrl.pathname,
      targetBaseUrl,
      durationMs: Date.now() - startedAt,
      error: summarizeError(error)
    });
    throw error;
  }
  const upstreamHeaders = {};
  for (const [name, value] of Object.entries(upstream.headers || {})) {
    const lower = name.toLowerCase();
    if (lower === "transfer-encoding" || lower === "content-length") {
      continue;
    }

    upstreamHeaders[name] = value;
  }
  upstreamHeaders["x-pact-forwarded-by"] = discoveryState.serverId;
  upstreamHeaders["x-pact-active-service"] = discoveryState.activeServiceUrl;

  response.writeHead(upstream.status, upstreamHeaders);
  response.end(upstream.body);
  logger?.info?.("http.proxy.completed", {
    requestId: request.__pactRequestId || "",
    method: request.method || "GET",
    route: upstreamUrl.pathname,
    targetBaseUrl,
    statusCode: upstream.status,
    responseBytes: upstream.body?.length || 0,
    durationMs: Date.now() - startedAt
  });
}

function shouldRenderConsoleIndexFallback(pathname) {
  return pathname === "/" || pathname === "/console" || pathname === "/index.html";
}

async function serveConsoleIndexFallback(response, distPath, scriptNonce = "") {
  if (!distPath) {
    return false;
  }
  const fallback = await fs.readFile(path.join(distPath, "index.html"));
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(injectCspNonceIntoInlineScripts(fallback, scriptNonce));
  return true;
}

async function handleStaticFallback({
  url,
  response,
  distPath,
  discoveryState,
  scriptNonce = ""
}) {
  if (url.pathname === "/" && !distPath) {
    sendJson(response, 200, {
      ok: true,
      service: "Pact Server",
      serverId: discoveryState.serverId,
      activeServiceUrl: discoveryState.activeServiceUrl
    });
    return;
  }

  if (shouldRenderConsoleIndexFallback(url.pathname) && await serveConsoleIndexFallback(response, distPath, scriptNonce)) {
    return;
  }

  const served = await serveStaticFile(response, distPath, url.pathname);
  if (served) {
    return;
  }

  if (path.extname(url.pathname)) {
    sendJson(response, 404, {
      error: `资源不存在：${url.pathname}`
    });
    return;
  }

  if (!distPath) {
    sendJson(response, 404, {
      error: `接口不存在：${url.pathname}`
    });
    return;
  }

  await serveConsoleIndexFallback(response, distPath, scriptNonce);
}

function applySecurityHeaders(response, { isHttps = false, scriptNonce = "" } = {}) {
  if (response.headersSent) {
    return;
  }
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "same-origin");
  response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      `script-src 'self' 'nonce-${scriptNonce}'`,
      "style-src 'self' 'unsafe-inline'",  // Element Plus uses inline styles
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'"
    ].join("; ")
  );
  if (isHttps) {
    response.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
}

function injectCspNonceIntoInlineScripts(html, scriptNonce) {
  if (!scriptNonce) {
    return String(html || "");
  }
  const safeNonce = String(scriptNonce).replace(/["']/g, "");
  return String(html || "").replace(
    /<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g,
    (_match, attributes, body) => {
      if (/\bnonce\s*=\s*(["']).*?\1/i.test(attributes)) {
        return `<script${attributes}>${body}</script>`;
      }
      const hasAttributes = String(attributes || "").trim();
      return `<script${hasAttributes ? `${hasAttributes} ` : " "}nonce="${safeNonce}">${body}</script>`;
    }
  );
}

function resolveConsoleAuthEnabled({ runtimeOptions = {} }) {
  const mode = String(runtimeOptions.consoleAuth || process.env.PACT_CONSOLE_AUTH || "enabled")
    .trim()
    .toLowerCase();
  if (mode === "disabled") {
    throw new Error(
      "PACT_CONSOLE_AUTH=disabled 已被移除；服务端控制台认证必须始终开启。"
    );
  }
  return true;
}

function parseAllowPublicConsoleFlag(runtimeOptions = {}) {
  const value =
    runtimeOptions.allowPublicConsole ??
    process.env.PACT_ALLOW_PUBLIC_CONSOLE ??
    "";
  return value === true || ["1", "true", "yes"].includes(String(value).trim().toLowerCase());
}

function normalizeListenHost(host) {
  return String(host || "").trim().toLowerCase();
}

function isLoopbackListenHost(host) {
  const value = normalizeListenHost(host);
  return !value ||
    value === "localhost" ||
    value === "127.0.0.1" ||
    value === "::1" ||
    value === "[::1]";
}

function assertSafeListenHost(host, runtimeOptions = {}) {
  if (isLoopbackListenHost(host) || parseAllowPublicConsoleFlag(runtimeOptions)) {
    return;
  }
  throw new Error(
    "服务端默认只允许监听本机回环地址。若确需暴露到局域网/公网，请显式设置 PACT_ALLOW_PUBLIC_CONSOLE=1 或 --allow-public-console，并确保前置网络访问控制已配置。"
  );
}

function responseChunkBytes(chunk, encoding) {
  if (chunk === undefined || chunk === null || typeof chunk === "function") {
    return 0;
  }
  if (Buffer.isBuffer(chunk)) {
    return chunk.length;
  }
  if (chunk instanceof Uint8Array) {
    return chunk.byteLength;
  }
  return Buffer.byteLength(String(chunk), typeof encoding === "string" ? encoding : "utf8");
}

function trackResponseBodyBytes(response) {
  let responseBytes = 0;
  const originalWrite = response.write.bind(response);
  const originalEnd = response.end.bind(response);
  response.write = function writeWithMetrics(chunk, encoding, callback) {
    responseBytes += responseChunkBytes(chunk, encoding);
    return originalWrite(chunk, encoding, callback);
  };
  response.end = function endWithMetrics(chunk, encoding, callback) {
    if (typeof chunk === "function") {
      return originalEnd(chunk);
    }
    responseBytes += responseChunkBytes(chunk, encoding);
    if (typeof encoding === "function") {
      return originalEnd(chunk, encoding);
    }
    return originalEnd(chunk, encoding, callback);
  };
  return () => responseBytes;
}

function parsePositiveInt(value, fallback) {
  const valueText = String(value || "").trim();
  const parsed = Number(valueText);
  if (!Number.isInteger(parsed) || !Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function createFixedWindowRateLimiter({
  limit,
  windowMs,
  label
}) {
  const max = Math.max(1, Math.floor(Number(limit) || 0));
  const windowMsValue = Math.max(1_000, Math.floor(Number(windowMs) || 60_000));
  const buckets = new Map();

  function shouldAllow(identifier) {
    const key = String(identifier || "").trim() || "default";
    const now = Date.now();
    if (Math.random() < 0.02) {
      for (const [existingKey, record] of buckets.entries()) {
        if (record.expiresAt <= now) {
          buckets.delete(existingKey);
        }
      }
    }
    const record = buckets.get(key);
    if (!record || record.expiresAt <= now) {
      const next = {
        count: 1,
        windowStart: now,
        expiresAt: now + windowMsValue,
        key
      };
      buckets.set(key, next);
      return {
        allowed: true,
        allowedAt: 1,
        key,
        limit: max,
        remaining: max - 1,
        resetAt: next.expiresAt
      };
    }

    record.count += 1;
    if (record.count <= max) {
      return {
        allowed: true,
        allowedAt: record.count,
        key,
        limit: max,
        remaining: max - record.count,
        resetAt: record.expiresAt
      };
    }

    return {
      allowed: false,
      key,
      limit: max,
      remaining: 0,
      resetAt: record.expiresAt,
      retryAfterSec: Math.max(1, Math.ceil((record.expiresAt - now) / 1000))
    };
  }

  return {
    shouldAllow,
    windowMs: windowMsValue,
    label
  };
}

function isTrustedProxy(request) {
  const remoteAddr = String(request?.socket?.remoteAddress || "").replace(/^::ffff:/, "");
  if (remoteAddr === "127.0.0.1" || remoteAddr === "::1" || remoteAddr === "localhost") {
    return true;
  }
  const trusted = (process.env.PACT_TRUSTED_PROXIES || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return trusted.includes(remoteAddr);
}

function normalizeClientIp(request) {
  const remoteAddress = String(request?.socket?.remoteAddress || "").replace(/^\[|\]$/g, "");
  if (isTrustedProxy(request)) {
    const forwarded = String(request.headers?.["x-forwarded-for"] || "").split(",")[0].trim();
    if (forwarded) {
      return forwarded;
    }
  }

  if (!remoteAddress) {
    return "unknown";
  }

  if (remoteAddress === "::1" || remoteAddress === "127.0.0.1") {
    return remoteAddress;
  }

  if (remoteAddress.startsWith("::ffff:")) {
    return remoteAddress.slice("::ffff:".length);
  }

  return remoteAddress;
}

function resolveRequestSubjectKey(request, consoleAuth = null) {
  const url = (() => {
    try {
      return new URL(request.url || "/", "http://127.0.0.1").pathname;
    } catch {
      return "/";
    }
  })();

  if (consoleAuth && typeof consoleAuth.getSessionFromRequest === "function") {
    const session = consoleAuth.getSessionFromRequest(request);
    if (session?.user?.username) {
      return `subject:${session.user.username}`;
    }
  }

  return "subject:anonymous";
}

function sendRateLimitResponse(response, details = {}) {
  const {
    reason = "请求过于频繁",
    windowMs = 60_000,
    limit = 0,
    resetAt = Date.now() + windowMs,
    retryAfterSec = Math.max(1, Math.ceil(windowMs / 1000))
  } = details;
  response.setHeader("Retry-After", String(retryAfterSec));
  response.setHeader("X-RateLimit-Limit", String(limit));
  response.setHeader("X-RateLimit-Remaining", "0");
  response.setHeader("X-RateLimit-Reset", String(Math.floor(resetAt / 1000)));
  sendJson(response, 429, {
    error: reason,
    policy: "rate-limited"
  });
}

function routeFromRequestUrl(value = "") {
  try {
    return new URL(value || "/", "http://127.0.0.1").pathname;
  } catch {
    return value || "/";
  }
}

function metricTransportForRoute(route = "") {
  if (route === "/mcp" || route.startsWith("/api/mcp") || route === "/.well-known/pact/mcp.json") {
    return "mcp";
  }
  if (route.startsWith("/api/tool-management/v1")) {
    return "tool-management";
  }
  return "http";
}

function numericHeader(value) {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number(raw || 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function resolveHttpRateLimits(runtimeOptions = {}) {
  const httpRateLimitWindowMs = parsePositiveInt(
    runtimeOptions.httpRateLimitWindowMs,
    parsePositiveInt(process.env.PACT_HTTP_RATE_LIMIT_WINDOW_MS, 60_000)
  );
  return {
    ip: {
      limit: parsePositiveInt(
        runtimeOptions.httpRateLimitPerIpPerMinute,
        parsePositiveInt(process.env.PACT_HTTP_RATE_LIMIT_IP_PER_MINUTE, 1_200)
      )
    },
    subject: {
      limit: parsePositiveInt(
        runtimeOptions.httpRateLimitPerSubjectPerMinute,
        parsePositiveInt(process.env.PACT_HTTP_RATE_LIMIT_SUBJECT_PER_MINUTE, 1_000)
      )
    },
    login: {
      limit: parsePositiveInt(
        runtimeOptions.httpRateLimitLoginPerIpPerMinute,
        parsePositiveInt(process.env.PACT_HTTP_RATE_LIMIT_LOGIN_PER_MINUTE, 40)
      )
    },
    windowMs: Math.max(1_000, httpRateLimitWindowMs)
  };
}

export async function startHttpServer({
  userDataPath,
  distPath,
  jobManager: incomingJobManager,
  runtimeOptions = {},
  discoveryOptions = {},
  host = "127.0.0.1",
  port = 0,
  advertisedHost = ""
}) {
  assertSafeListenHost(host, runtimeOptions);
  const resolvedUserDataPath = resolveServerUserDataPath(userDataPath);
  const runtimeLogger = createRuntimeLogger({
    userDataPath: resolvedUserDataPath,
    runtimeOptions,
    component: "server"
  });
  setRuntimeLogger(runtimeLogger);
  runtimeLogger.info("server.start.requested", {
    host,
    port,
    advertisedHost,
    distPath,
    userDataPath: resolvedUserDataPath,
    profile: runtimeOptions?.profile || "",
    logDir: runtimeLogger.logDir,
    retentionDays: runtimeLogger.retentionDays
  });
  const compositionRoot = await createServerCompositionRoot({
    userDataPath: resolvedUserDataPath,
    runtimeOptions,
    runtimeLogger
  });
  const mcpIdentity = await loadOrCreateMcpIdentity(resolvedUserDataPath);
  const {
    featureRuntime,
    allApiOperationCount,
    activeApiOperations,
    publicFeatures,
    isFeatureActive,
    isAnyFeatureActive,
    platformRegistry,
    coreProvider,
    runtime,
    moduleManagement,
    dataStructures,
    consoleAuth,
    securityPermissions,
    operationAuditStore,
    operationConcurrencyScope,
    protocolEventBus,
    consoleDomainServices,
    storageProvider,
    devopsProvider,
    metadataStore
  } = compositionRoot;
  runtimeLogger.info("features.resolved", {
    edition: featureRuntime.edition,
    activeFeatureCount: featureRuntime.activeFeatureIds.length,
    disabledFeatureCount: featureRuntime.disabledFeatureIds.length,
    activeOperationCount: activeApiOperations.length,
    disabledOperationCount: allApiOperationCount - activeApiOperations.length
  });
  const serverLabel = os.hostname();
  const consoleAuthEnabled = resolveConsoleAuthEnabled({ runtimeOptions });
  const initialOwner = await ensureConsoleOwner({
    consoleAuth,
    enabled: consoleAuthEnabled
  });
  let initialCredentialsPath = "";
  if (initialOwner.created) {
    // H-1: write credentials to a file with mode 0600 instead of printing them to stdout
    // (stdout is captured by all process supervisors / log aggregators)
    const credsPath = path.join(resolvedUserDataPath, "auth", "initial-credentials.txt");
    initialCredentialsPath = credsPath;
    fsSync.mkdirSync(path.dirname(credsPath), { recursive: true, mode: 0o700 });
    const credsContent = [
      "Pact Console Initial Credentials",
      "=====================================",
      `Username : ${initialOwner.username}`,
      `Password : ${initialOwner.password}`,
      "",
      "This file is created only once. After your first successful login it will be",
      "automatically deleted. Keep it confidential; it will not be shown again.",
      `Change/reset: npm run server:auth -- set-password --username owner --generate-password`,
      "",
      `Generated : ${new Date().toISOString()}`,
    ].join("\n");
    fsSync.writeFileSync(credsPath, credsContent, { mode: 0o600 });
    runtimeLogger.warn("server.initialOwner.credentials_file", {
      credentialsPath: credsPath,
      message: "Initial owner credentials have been written to a secured file."
    });
    console.log("初始 owner 已创建，请参考日志中的初始化文件路径与重置命令。此信息不再输出到标准输出。");
  }
  const jobManager =
    incomingJobManager ||
    createJobManager({
      userDataPath: resolvedUserDataPath,
      runtimeOptions: runtime.runtimeOptions,
      getRuntimeOptions: () => runtime.runtimeOptions,
      protocolEventBus,
      logger: runtimeLogger
    });
  const ownsJobManager = !incomingJobManager;
  const registeredMetadataStore = requirePlatformInterface(platformRegistry, "storage.metadataStore").value;
  const registeredCoreProvider = requirePlatformInterface(platformRegistry, "core.provider").value || coreProvider;
  const registeredStorageProvider = requirePlatformInterface(platformRegistry, "storage.provider").value || storageProvider;
  const registeredDevopsProvider = requirePlatformInterface(platformRegistry, "devops.provider").value || devopsProvider;
  const deletionCoordinator = createBatchDeletionCoordinator({
    userDataPath: resolvedUserDataPath,
    jobManager,
    metadataStore: registeredMetadataStore,
    runtime
  });
  const jobWorkflowProvider = createJobWorkflowProvider({ jobManager });
  const queueMonitorAdapter = {
    registerStarted: (input) => registerQueueStarted(resolvedUserDataPath, input),
    registerHeartbeat: (input) => registerQueueHeartbeat(resolvedUserDataPath, input),
    registerClosed: (input) => registerQueueClosed(resolvedUserDataPath, input),
    inspect: (input) => inspectQueueMonitor({ userDataPath: resolvedUserDataPath, ...input }),
    acknowledge: (alertId) => acknowledgeQueueMonitorAlert(resolvedUserDataPath, alertId)
  };
  const clientRuntimeAllocator = createClientRuntimeAllocator({ userDataPath: resolvedUserDataPath });
  let discoveryState = await loadDiscoveryConfig(resolvedUserDataPath);
  let listenUrl = "";
  let controllersRef = null;
  let toolManagementPlatformRef = null;
  let toolSkillManagementProviderRef = null;
  const runtimeProviders = await createServerRuntimeProviders({
    userDataPath: resolvedUserDataPath,
    runtime,
    jobManager,
    metadataStore,
    protocolEventBus,
    getDiscoveryState: () => discoveryState,
    getListenUrl: () => listenUrl,
    getControllers: () => controllersRef,
    operationAuditStore,
    operationConcurrencyScope,
    dataStructures,
    queueMonitor: queueMonitorAdapter,
    runtimeLogger,
    clientRuntimeAllocator,
    securityPermissions,
    getToolManagementPlatform: () => toolManagementPlatformRef,
    getToolSkillManagementProvider: () => toolSkillManagementProviderRef,
    isFeatureActive,
    isAnyFeatureActive
  });
  const {
    contextRuntime,
    maintenanceAgent,
    knowledgeSourceService,
    agentWorkspace,
    strategyManagementProvider,
    modelDecisionRuntime,
    evidenceSufficiencyGate,
    knowledgeAgentSkill,
    goldenRuleRuntime,
    knowledgeRuleAuthoringRuntime,
    knowledgeSkillRuntime,
    agentEvaluationRuntime,
    knowledgeEvolutionRuntime,
    summarizationRuntime,
    agentExplorationRuntime
  } = runtimeProviders;
  const exposedMaintenanceAgent = maintenanceAgent;
  const exposedKnowledgeSourceService = knowledgeSourceService;

  const jobsController = createJobsController({
    userDataPath: resolvedUserDataPath,
    jobWorkflowProvider,
    storageProvider: registeredStorageProvider,
    deletionCoordinator,
    getDiscoveryState: () => discoveryState,
    proxyApiRequest,
    protocolEventBus,
    loadNormalizedDocumentStore: consoleDomainServices.loadNormalizedDocumentStore,
    uploadSessionStore: consoleDomainServices.uploadSessionStore,
    resolveArchiveBatchIdentity
  });
  const systemController = createSystemController({
    userDataPath: resolvedUserDataPath,
    distPath,
    runtime,
    moduleManagement,
    jobWorkflowProvider,
    metadataStore,
    storageProvider: registeredStorageProvider,
    serverLabel,
    getDiscoveryState: () => discoveryState,
    setDiscoveryState: (value) => {
      discoveryState = value;
    },
    getListenUrl: () => listenUrl,
    coreProvider: registeredCoreProvider,
    getControllers: () => controllersRef,
    getFeatureEntries: publicFeatures,
    protocolEventBus,
    consoleAuth,
    securityPermissions,
    operationAuditStore,
    maintenanceAgent: exposedMaintenanceAgent,
    knowledgeSourceService: exposedKnowledgeSourceService,
    agentWorkspace,
    contextRuntime,
    evidenceSufficiencyGate,
    knowledgeAgentSkill,
    goldenRuleRuntime,
    knowledgeRuleAuthoringRuntime,
    knowledgeSkillRuntime,
    agentEvaluationRuntime,
    modelDecisionRuntime,
    strategyManagementProvider,
    knowledgeEvolutionRuntime,
    summarizationRuntime,
    agentExplorationRuntime,
    clientRuntimeAllocator,
    clientRuntimeBootstrap: {
      buildPlan: buildClientRuntimeBootstrapPlan,
      buildPull: buildClientRuntimeBootstrapPull
    },
    queueMonitor: queueMonitorAdapter,
    checkpointTreeApi: dataStructures.checkpointTree,
    devopsProvider: registeredDevopsProvider,
    getToolManagementPlatform: () => toolManagementPlatformRef,
    getToolSkillManagementProvider: () => toolSkillManagementProviderRef,
    consoleDomainServices
  });
  const controllers = {
    jobs: jobsController,
    system: systemController
  };
  controllersRef = controllers;
  const toolManagementPlatform = createServerToolManagementPlatform({
    userDataPath: resolvedUserDataPath,
    operations: activeApiOperations,
    featureRuntime: publicFeatures(),
    controllers,
    operationAuditStore,
    operationConcurrencyScope,
    protocolEventBus,
    consoleAuth,
    securityPermissions,
    strategyManagementProvider,
    logger: runtimeLogger
  });
  toolManagementPlatformRef = toolManagementPlatform;
  toolManagementPlatform.registerChangeHandler?.(async (event = {}) => {
    const reasonCode = String(event.reasonCode || event.type || "");
    if (![
      "grant_updated",
      "grant_deleted",
      "grant_revoked",
      "grant_token_rotated"
    ].includes(reasonCode) || !event.grantId) {
      return {
        ok: true,
        ignored: true,
        reasonCode: "acp_relay_change_not_relevant"
      };
    }
    const acpRuntime = await getAcpAgentRelayRuntime({
      userDataPath: resolvedUserDataPath,
      workspaceRoot: process.cwd(),
      protocolEventBus
    });
    return acpRuntime.handleToolManagementChange?.(event);
  });
  const toolSkillManagementProvider = createServerToolSkillManagementProvider({
    toolManagementPlatform,
    userDataPath: resolvedUserDataPath,
    securityPermissions,
    logger: runtimeLogger
  });
  toolSkillManagementProviderRef = toolSkillManagementProvider;

  const rateLimits = resolveHttpRateLimits(runtimeOptions);
  const ipRateLimiter = createFixedWindowRateLimiter({
    limit: rateLimits.ip.limit,
    windowMs: rateLimits.windowMs,
    label: "ip"
  });
  const subjectRateLimiter = createFixedWindowRateLimiter({
    limit: rateLimits.subject.limit,
    windowMs: rateLimits.windowMs,
    label: "subject"
  });
  const loginRateLimiter = createFixedWindowRateLimiter({
    limit: rateLimits.login.limit,
    windowMs: rateLimits.windowMs,
    label: "login"
  });

  // ── H-4: in-flight request tracker for graceful drain ───────────────────
  let inFlightCount = 0;
  const drainCallbacks = [];
  function incrementInflight() { inFlightCount++; }
  function decrementInflight() {
    inFlightCount--;
    if (inFlightCount <= 0) drainCallbacks.splice(0).forEach((cb) => cb());
  }
  function waitForDrain(timeoutMs = 30_000) {
    if (inFlightCount <= 0) return Promise.resolve();
    return new Promise((resolve) => {
      const t = setTimeout(() => {
        const i = drainCallbacks.indexOf(resolve);
        if (i >= 0) drainCallbacks.splice(i, 1);
        resolve();
      }, timeoutMs);
      drainCallbacks.push(() => { clearTimeout(t); resolve(); });
    });
  }

  const server = http.createServer(async (request, response) => {
    const requestId = randomUUID();
    const startedAt = Date.now();
    const getResponseBytes = trackResponseBodyBytes(response);
    let requestBodyBytes = numericHeader(request.headers["content-length"]);

    const traceContext = createTraceContext({
      requestId,
      transport: "http",
      actor: { type: "http-request" }
    });
    setTraceContextOnRequest(request, traceContext);
    response.setHeader("X-Pact-Trace-Id", traceContext.traceId);
    request.__pactRequestId = requestId;
    let finished = false;
    let requestMetricRecorded = false;
    const recordRequestMetric = (completionStatus = "completed") => {
      if (requestMetricRecorded) {
        return;
      }
      requestMetricRecorded = true;
      try {
        const route = routeFromRequestUrl(request.url || "/");
        toolManagementPlatformRef?.store?.appendHttpRequestMetric?.({
          traceId: traceContext.traceId,
          requestId,
          transport: metricTransportForRoute(route),
          method: request.method || "GET",
          route,
          statusCode: response.statusCode || 0,
          completionStatus,
          requestBytes: requestBodyBytes,
          responseBytes: getResponseBytes(),
          durationMs: Date.now() - startedAt,
          userAgent: request.headers["user-agent"] || ""
        });
      } catch (error) {
        runtimeLogger.warn("http.request_metric.failed", {
          traceId: traceContext.traceId,
          requestId,
          error: summarizeError(error)
        });
      }
    };
    response.once("finish", () => {
      finished = true;
      const responseBytes = getResponseBytes();
      runtimeLogger.info("http.request.completed", {
        traceId: traceContext.traceId,
        requestId,
        method: request.method || "GET",
        route: routeFromRequestUrl(request.url || "/"),
        statusCode: response.statusCode,
        requestBytes: requestBodyBytes,
        responseBytes,
        contentLength: response.getHeader("content-length") || "",
        durationMs: Date.now() - startedAt
      });
      recordRequestMetric("completed");
    });
    response.once("close", () => {
      if (finished) {
        return;
      }
      runtimeLogger.warn("http.request.closed", {
        traceId: traceContext.traceId,
        requestId,
        method: request.method || "GET",
        route: routeFromRequestUrl(request.url || "/"),
        statusCode: response.statusCode,
        requestBytes: requestBodyBytes,
        responseBytes: getResponseBytes(),
        durationMs: Date.now() - startedAt
      });
      recordRequestMetric("closed");
    });
    // H-4: track in-flight to enable graceful drain before DB close
    incrementInflight();
    try {
    await runWithTraceContext(traceContext, async () => {
    try {
      const isHttps = Boolean(request.socket?.encrypted);
      const scriptNonce = randomBytes(16).toString("base64");
      applySecurityHeaders(response, { isHttps, scriptNonce });
      const method = request.method || "GET";
      const url = new URL(request.url || "/", "http://127.0.0.1");
      const isLoginRequest = method === "POST" && url.pathname === "/api/auth/login";
      runtimeLogger.info("http.request.started", {
        traceId: traceContext.traceId,
        requestId,
        method,
        route: url.pathname,
        query: Object.fromEntries(url.searchParams.entries()),
        remoteAddress: request.socket?.remoteAddress || "",
        userAgent: request.headers["user-agent"] || "",
        contentType: request.headers["content-type"] || "",
        contentLength: request.headers["content-length"] || ""
      });
      const requestBody =
        method === "GET" || method === "HEAD" ? Buffer.alloc(0) : await readRequestBody(request);
      requestBodyBytes = requestBody.length;

      const clientIp = normalizeClientIp(request);
      const ipRateLimit = ipRateLimiter.shouldAllow(`ip:${clientIp}`);
      if (!ipRateLimit.allowed) {
        runtimeLogger.warn("http.request.rate_limited", {
          reason: "ip",
          requestId,
          actor: "anonymous",
          subjectKey: `ip:${clientIp}`,
          route: url.pathname,
          limit: ipRateLimit.limit,
          retryAfterSec: ipRateLimit.retryAfterSec
        });
        sendRateLimitResponse(response, {
          reason: "访问频率过高（IP 限流）。",
          limit: ipRateLimit.limit,
          resetAt: ipRateLimit.resetAt,
          retryAfterSec: ipRateLimit.retryAfterSec,
          windowMs: rateLimits.windowMs
        });
        return;
      }

      let subjectKey = "subject:anonymous";
      if (isLoginRequest) {
        const loginRateLimit = loginRateLimiter.shouldAllow(`login-ip:${clientIp}`);
        if (!loginRateLimit.allowed) {
          runtimeLogger.warn("http.request.rate_limited", {
            reason: "login",
            requestId,
            route: url.pathname,
            limit: loginRateLimit.limit,
            retryAfterSec: loginRateLimit.retryAfterSec
          });
          sendRateLimitResponse(response, {
            reason: "登录尝试过于频繁（登录限流）。",
            limit: loginRateLimit.limit,
            resetAt: loginRateLimit.resetAt,
            retryAfterSec: loginRateLimit.retryAfterSec,
            windowMs: rateLimits.windowMs
          });
          return;
        }
      }

      subjectKey = resolveRequestSubjectKey(request, consoleAuth);
      const subjectRateLimit = subjectRateLimiter.shouldAllow(subjectKey);
      if (!subjectRateLimit.allowed) {
        runtimeLogger.warn("http.request.rate_limited", {
          reason: "subject",
          requestId,
          subjectKey,
          route: url.pathname,
          limit: subjectRateLimit.limit,
          retryAfterSec: subjectRateLimit.retryAfterSec
        });
        sendRateLimitResponse(response, {
          reason: "访问频率过高（主体限流）。",
          limit: subjectRateLimit.limit,
          resetAt: subjectRateLimit.resetAt,
          retryAfterSec: subjectRateLimit.retryAfterSec,
          windowMs: rateLimits.windowMs
        });
        return;
      }

      if (
        await handlePactMcpHttpRequest({
          request,
          response,
          requestBody,
          method,
          url,
          toolSkillManagementProvider,
          listenUrl,
          discoveryState,
          logger: runtimeLogger
        })
      ) {
        return;
      }

      if (method === "POST" && url.pathname === "/api/rpc") {
        await registeredCoreProvider.dispatchRpcOperation({
          operations: activeApiOperations,
          controllers,
          request,
          response,
          requestBody,
          authorizeOperation: consoleAuthEnabled
            ? (input) => securityPermissions.authorizeOperation(input)
            : null,
          operationAuditStore,
          concurrencyScope: operationConcurrencyScope,
          logger: runtimeLogger
        });
        return;
      }

      if (
        registeredCoreProvider.shouldProxyRegisteredApiRequest({
          pathname: url.pathname,
          discoveryState,
          operations: activeApiOperations
        })
      ) {
        await proxyApiRequest({
          request,
          response,
          requestBody,
          targetBaseUrl: discoveryState.forwardBaseUrl || discoveryState.activeServiceUrl,
          discoveryState,
          logger: runtimeLogger
        });
        return;
      }

      const handled = await registeredCoreProvider.dispatchRegisteredHttpOperation({
        operations: activeApiOperations,
        controllers,
        method,
        url,
        request,
        response,
        requestBody,
        authorizeOperation: consoleAuthEnabled
          ? (input) => securityPermissions.authorizeOperation(input)
          : null,
        operationAuditStore,
        concurrencyScope: operationConcurrencyScope,
        logger: runtimeLogger
      });
      if (handled) {
        return;
      }

      await handleStaticFallback({
        url,
        response,
        distPath,
        discoveryState,
        scriptNonce
      });
    } catch (error) {
      const statusCode = typeof error?.statusCode === "number" ? error.statusCode : 500;
      runtimeLogger.error("http.request.failed", {
        traceId: traceContext.traceId,
        requestId,
        method: request.method || "GET",
        route: (() => {
          try {
            return new URL(request.url || "/", "http://127.0.0.1").pathname;
          } catch {
            return request.url || "/";
          }
        })(),
        statusCode,
        durationMs: Date.now() - startedAt,
        error: summarizeError(error)
      });
      const message = error instanceof Error ? error.message : "Internal error";
      if (!response.headersSent) {
        sendJson(response, statusCode, { error: message });
      }
    }
    });
    } finally {
      // H-4: decrement in-flight counter so graceful shutdown can drain
      decrementInflight();
    }
  });
  // M-9: limit concurrent connections to prevent file-descriptor exhaustion DoS
  server.maxConnections = 2000;
  const openSockets = new Set();
  server.on("connection", (socket) => {
    openSockets.add(socket);
    runtimeLogger.debug("http.connection.opened", {
      remoteAddress: socket.remoteAddress || "",
      remotePort: socket.remotePort || 0,
      openSocketCount: openSockets.size
    });
    socket.on("close", () => {
      openSockets.delete(socket);
      runtimeLogger.debug("http.connection.closed", {
        remoteAddress: socket.remoteAddress || "",
        remotePort: socket.remotePort || 0,
        openSocketCount: openSockets.size
      });
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("无法确定本地服务监听地址。");
  }
  runtimeLogger.info("server.listen.ready", {
    host,
    boundAddress: address.address,
    port: address.port
  });

  const listenHost = typeof address.address === "string" ? address.address : host;
  const resolvedAdvertisedHost = advertisedHost || defaultAdvertisedHost(host);
  listenUrl = `http://${formatUrlHost(resolvedAdvertisedHost)}:${address.port}`;
  discoveryState = await resolveDiscoveryState(resolvedUserDataPath, {
    listenUrl,
    serverLabel,
    overrides: discoveryOptions
  });
  discoveryState = {
    ...discoveryState,
    mcpIdentity
  };
  await saveDiscoveryConfig(resolvedUserDataPath, discoveryState, {
    listenUrl,
    serverLabel
  });
  await protocolEventBus.publish(
    "server.lifecycle",
    {
      status: "started",
      serverId: discoveryState.serverId,
      listenUrl,
      activeServiceUrl: discoveryState.activeServiceUrl,
      mode: discoveryState.mode
    },
    { type: "server.started" }
  );
  async function dispatchStartupSnapshot(operationId, {
    input = {},
    payloadFromResult = (result) => result.payload,
    errorMessage = `Failed to build ${operationId} startup snapshot.`
  } = {}) {
    const snapshot = await registeredCoreProvider.dispatchInternalOperation({
      operations: activeApiOperations,
      controllers,
      operationId,
      input,
      operationAuditStore,
      concurrencyScope: operationConcurrencyScope,
      logger: runtimeLogger,
      actor: { type: "system", username: "server-runtime" }
    });
    if (snapshot.statusCode >= 400) {
      throw new Error(snapshot.payload?.error || errorMessage);
    }
    return payloadFromResult(snapshot);
  }
  const interfaceSnapshot = await dispatchStartupSnapshot("system.interfaces");
  await protocolEventBus.publish(
    "system.interfaces",
    interfaceSnapshot,
    { type: "system.interfaces.snapshot" }
  );
  const discoveryConfigSnapshot = await dispatchStartupSnapshot("discovery.get_config");
  await protocolEventBus.publish(
    "discovery.config",
    discoveryConfigSnapshot,
    { type: "discovery.config.snapshot" }
  );
  if (isFeatureActive("agent-gateway")) {
    const agentSyncConfigSnapshot = await dispatchStartupSnapshot("agent_sync.config.get", {
      payloadFromResult: (result) => result.payload?.config || {}
    });
    await protocolEventBus.publish(
      "agent_sync.config",
      agentSyncConfigSnapshot,
      { type: "agent_sync.config.snapshot" }
    );
  }
  if (exposedMaintenanceAgent) {
    await exposedMaintenanceAgent.start();
  }
  if (exposedKnowledgeSourceService) {
    await exposedKnowledgeSourceService.start();
  }
  const consoleStateSnapshot = await dispatchStartupSnapshot("system.console_state");
  await protocolEventBus.publish(
    "system.console_state",
    {
      state: consoleStateSnapshot
    },
    { type: "system.console_state.snapshot" }
  );
  const storageSummarySnapshot = await dispatchStartupSnapshot("storage.summary");
  await protocolEventBus.publish(
    "storage.summary",
    storageSummarySnapshot,
    { type: "storage.summary.snapshot" }
  );
  await deletionCoordinator.resumePendingDeletions();
  runtimeLogger.info("server.started", {
    listenUrl,
    serverId: discoveryState.serverId,
    activeServiceUrl: discoveryState.activeServiceUrl,
    mode: discoveryState.mode,
    featureEdition: featureRuntime.edition,
    activeFeatures: featureRuntime.activeFeatureIds
  });

  return {
    server,
    host: listenHost,
    port: address.port,
    url: listenUrl,
    discovery: discoveryState,
    // H-1: do NOT expose the raw password in the handle object
    initialOwner: initialOwner.created
      ? { created: true, username: initialOwner.username, credentialsPath: initialCredentialsPath }
      : { created: false },
    close: async () => {
      // H-4: Graceful drain — stop accepting connections, wait for in-flight
      // handlers to finish (max 30 s), THEN close databases.
      runtimeLogger.info("server.close.started", {
        openSocketCount: openSockets.size,
        inFlightCount
      });

      // Stop accepting new connections (fire-and-forget; we drain explicitly)
      server.close(() => {});

      // Destroy idle keep-alive sockets so the server stops accepting faster
      for (const socket of openSockets) {
        socket.destroy();
      }

      // Wait for all in-flight request handlers to complete
      await waitForDrain(30_000);

      try {
        if (ownsJobManager) {
          await jobManager.close();
        }
        if (typeof maintenanceAgent?.close === "function") {
          await maintenanceAgent.close();
        }
        if (typeof knowledgeSourceService?.close === "function") {
          await knowledgeSourceService.close();
        }
        if (typeof agentWorkspace?.close === "function") {
          agentWorkspace.close();
        }
        if (typeof knowledgeSkillRuntime?.close === "function") {
          knowledgeSkillRuntime.close();
        }
        toolManagementPlatform.close();
        await runtime.close();
        consoleAuth.close();
        operationAuditStore.close();

        runtimeLogger.info("server.close.completed", {});
        await runtimeLogger.close();
      } catch (closeError) {
        runtimeLogger.error("server.close.failed", {
          error: summarizeError(closeError)
        });
        await runtimeLogger.close();
        throw closeError;
      }
    }
  };
}

export async function startLocalHttpServer(options) {
  return startHttpServer({
    host: "127.0.0.1",
    port: 0,
    ...options
  });
}
