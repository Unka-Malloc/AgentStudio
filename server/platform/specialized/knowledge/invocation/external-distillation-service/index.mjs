export const EXTERNAL_KNOWLEDGE_DISTILLATION_PROTOCOL_VERSION =
  "v0.0.1:external-service:knowledge-distillation-1";

const DEFAULT_TIMEOUT_MS = 30_000;

const ERROR_CODES = Object.freeze({
  CONFIGURATION_ERROR: "KD_CONFIGURATION_ERROR",
  AUTHENTICATION_ERROR: "KD_AUTHENTICATION_ERROR",
  UPSTREAM_UNAVAILABLE: "KD_UPSTREAM_UNAVAILABLE",
  UPSTREAM_TIMEOUT: "KD_UPSTREAM_TIMEOUT",
  UPSTREAM_BAD_RESPONSE: "KD_UPSTREAM_BAD_RESPONSE",
  UPSTREAM_APPLICATION_ERROR: "KD_UPSTREAM_APPLICATION_ERROR",
});

export { ERROR_CODES as EXTERNAL_KD_ERROR_CODES };

function classifyError(error, serviceCall = null) {
  const status = serviceCall?.statusCode || 0;
  const message = error instanceof Error ? error.message : String(error || "");

  if (error?.code === "ECONNREFUSED" || error?.cause?.code === "ECONNREFUSED" ||
      error?.code === "ENOTFOUND" || error?.cause?.code === "ENOTFOUND" ||
      error?.code === "EAI_AGAIN" || error?.cause?.code === "EAI_AGAIN" ||
      error?.code === "ECONNRESET") {
    return { code: ERROR_CODES.UPSTREAM_UNAVAILABLE, message, status };
  }
  if (error?.name === "AbortError" || error?.name === "TimeoutError" ||
      message.includes("aborted") || message.includes("timeout")) {
    return { code: ERROR_CODES.UPSTREAM_TIMEOUT, message, status };
  }
  if (status === 401 || status === 403) {
    return { code: ERROR_CODES.AUTHENTICATION_ERROR, message, status };
  }
  if (status === 502 || status === 503 || status === 504) {
    return { code: ERROR_CODES.UPSTREAM_UNAVAILABLE, message, status };
  }
  if (status >= 400 && status < 500) {
    return { code: ERROR_CODES.UPSTREAM_BAD_RESPONSE, message, status };
  }
  if (status >= 500) {
    return { code: ERROR_CODES.UPSTREAM_APPLICATION_ERROR, message, status };
  }
  if (!status) {
    return { code: ERROR_CODES.UPSTREAM_UNAVAILABLE, message, status: 0 };
  }
  return { code: ERROR_CODES.UPSTREAM_APPLICATION_ERROR, message, status };
}

function normalizeText(value = "") {
  return String(value || "").trim();
}

function normalizeUrl(value = "") {
  const text = normalizeText(value).replace(/\/+$/, "");
  if (!text) {
    return "";
  }
  const url = new URL(text);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("外部知识蒸馏服务地址必须是 HTTP(S) URL。");
  }
  return url.href.replace(/\/+$/, "");
}

function pickConfigValue(input = {}, settings = {}, keys = []) {
  const externalSettings =
    settings.externalKnowledgeDistillation &&
    typeof settings.externalKnowledgeDistillation === "object" &&
    !Array.isArray(settings.externalKnowledgeDistillation)
      ? settings.externalKnowledgeDistillation
      : {};
  for (const key of keys) {
    const direct = normalizeText(input[key]);
    if (direct) {
      return direct;
    }
    const configured = normalizeText(externalSettings[key]);
    if (configured) {
      return configured;
    }
  }
  return "";
}

function pickConfiguredValue(settings = {}, keys = []) {
  const externalSettings =
    settings.externalKnowledgeDistillation &&
    typeof settings.externalKnowledgeDistillation === "object" &&
    !Array.isArray(settings.externalKnowledgeDistillation)
      ? settings.externalKnowledgeDistillation
      : {};
  for (const key of keys) {
    const configured = normalizeText(externalSettings[key]);
    if (configured) {
      return configured;
    }
  }
  return "";
}

export function resolveExternalKnowledgeDistillationConfig({
  input = {},
  settings = {},
  env = process.env
} = {}) {
  const baseUrl = normalizeUrl(
    pickConfiguredValue(settings, ["baseUrl", "serviceUrl", "endpoint"]) ||
      env.PACT_EXTERNAL_KNOWLEDGE_DISTILLATION_URL ||
      env.PACT_EXTERNAL_DISTILLATION_URL ||
      ""
  );
  const token =
    pickConfiguredValue(settings, ["token", "apiKey"]) ||
    env.PACT_EXTERNAL_KNOWLEDGE_DISTILLATION_TOKEN ||
    env.PACT_EXTERNAL_DISTILLATION_TOKEN ||
    "";
  const timeoutMs = Number(
    pickConfigValue(input, settings, ["timeoutMs"]) ||
      env.PACT_EXTERNAL_KNOWLEDGE_DISTILLATION_TIMEOUT_MS ||
      DEFAULT_TIMEOUT_MS
  );
  return {
    protocolVersion: EXTERNAL_KNOWLEDGE_DISTILLATION_PROTOCOL_VERSION,
    baseUrl,
    token,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS
  };
}

function jsonByteLength(value) {
  if (value === undefined) {
    return 0;
  }
  return Buffer.byteLength(typeof value === "string" ? value : JSON.stringify(value), "utf8");
}

function externalServiceCallRecord({
  baseUrl = "",
  pathname = "",
  method = "GET",
  statusCode = 0,
  requestBytes = 0,
  responseBytes = 0,
  startedAtMs = Date.now(),
  contentType = "",
  error = null
} = {}) {
  const durationMs = Math.max(0, Date.now() - startedAtMs);
  const transferBytes = Math.max(0, Number(requestBytes || 0)) + Math.max(0, Number(responseBytes || 0));
  return {
    protocolVersion: "v0.0.1:external-service:knowledge-distillation-gateway-call-telemetry-1",
    service: "external.knowledge.distillation",
    baseUrl,
    method,
    path: pathname,
    statusCode: Math.max(0, Number(statusCode || 0)),
    requestBytes: Math.max(0, Number(requestBytes || 0)),
    responseBytes: Math.max(0, Number(responseBytes || 0)),
    transferBytes,
    durationMs,
    bytesPerSecond: durationMs > 0
      ? Number(((transferBytes * 1000) / durationMs).toFixed(2))
      : transferBytes,
    contentType,
    observedAt: new Date().toISOString(),
    error: error ? (error instanceof Error ? error.message : String(error)) : ""
  };
}

function attachExternalServiceCall(payload, call) {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    return {
      ...payload,
      pactExternalServiceCall: call
    };
  }
  return {
    value: payload,
    pactExternalServiceCall: call
  };
}

async function readResponseBody(response, { binary = false } = {}) {
  const contentType = response.headers.get("content-type") || "";
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const text = buffer.toString("utf8");
  if (!binary && contentType.includes("application/json")) {
    const trimmed = text.trim();
    return {
      body: trimmed ? JSON.parse(trimmed) : {},
      buffer,
      text,
      contentType,
      byteLength: buffer.length
    };
  }
  return {
    body: {
      buffer,
      text,
      contentType
    },
    buffer,
    text,
    contentType,
    byteLength: buffer.length
  };
}

function fileNameFromDisposition(disposition = "", fallback = "external-distillation.bin") {
  const match = String(disposition || "").match(/filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i);
  const value = decodeURIComponent(match?.[1] || match?.[2] || "").trim();
  return value || fallback;
}

function evidenceQueryString(input = {}) {
  const params = new URLSearchParams();
  for (const [key, aliases] of Object.entries({
    entity: ["entity", "entityQuery", "entity-query"],
    relationship: ["relationship", "relationshipQuery", "relationship-query"],
    claimStatus: ["claimStatus", "claim-status", "status"],
    claim: ["claim", "claimQuery", "claim-query"],
    sourceId: ["sourceId", "source-id", "documentId", "document-id"],
    domain: ["domain", "projectDomain", "project-domain", "domainId", "domain-id"],
    routeId: ["routeId", "route-id", "format", "formatId", "format-id"],
    groupId: ["groupId", "group-id", "communityId", "community-id"],
    timeFrom: ["timeFrom", "time-from", "from"],
    timeTo: ["timeTo", "time-to", "to"],
    mode: ["mode"],
    runLimit: ["runLimit", "run-limit"],
    limit: ["limit", "pageSize", "page-size"]
  })) {
    const value = aliases.map((alias) => input[alias]).find((item) => normalizeText(item));
    if (value !== undefined) {
      params.set(key, normalizeText(value));
    }
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}

export function createExternalKnowledgeDistillationClient({
  baseUrl,
  token = "",
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl = fetch
} = {}) {
  const normalizedBaseUrl = normalizeUrl(baseUrl);
  if (!normalizedBaseUrl) {
    throw new Error("外部知识蒸馏服务未配置，请设置 PACT_EXTERNAL_KNOWLEDGE_DISTILLATION_URL。");
  }

  async function request(pathname, {
    method = "GET",
    body = undefined,
    binary = false
  } = {}) {
    const headers = new Headers();
    headers.set("accept", binary ? "*/*" : "application/json");
    if (body !== undefined) {
      headers.set("content-type", "application/json");
    }
    if (token) {
      headers.set("authorization", `Bearer ${token}`);
    }
    const serializedBody = body === undefined ? undefined : JSON.stringify(body);
    const startedAtMs = Date.now();
    let response = null;
    let payloadRecord = null;
    try {
      response = await fetchImpl(`${normalizedBaseUrl}${pathname}`, {
        method,
        headers,
        body: serializedBody,
        signal: AbortSignal.timeout(timeoutMs)
      });
      payloadRecord = await readResponseBody(response, { binary });
    } catch (error) {
      const externalServiceCall = externalServiceCallRecord({
        baseUrl: normalizedBaseUrl,
        pathname,
        method,
        statusCode: response?.status || 0,
        requestBytes: jsonByteLength(serializedBody),
        responseBytes: payloadRecord?.byteLength || 0,
        startedAtMs,
        contentType: payloadRecord?.contentType || response?.headers?.get("content-type") || "",
        error
      });
      const classified = classifyError(error, externalServiceCall);
      if (error && typeof error === "object") {
        error.externalServiceCall = externalServiceCall;
        error.errorCode = classified.code;
      }
      const wrapped = new Error(`[${classified.code}] ${classified.message}`);
      wrapped.statusCode = classified.status;
      wrapped.externalServiceCall = externalServiceCall;
      wrapped.errorCode = classified.code;
      throw wrapped;
    }
    const payload = payloadRecord.body;
    const externalServiceCall = externalServiceCallRecord({
      baseUrl: normalizedBaseUrl,
      pathname,
      method,
      statusCode: response.status,
      requestBytes: jsonByteLength(serializedBody),
      responseBytes: payloadRecord.byteLength,
      startedAtMs,
      contentType: response.headers.get("content-type") || payloadRecord.contentType || ""
    });
    if (!response.ok) {
      const message = payload?.error || payload?.message || `外部知识蒸馏服务请求失败：${response.status}`;
      const error = new Error(message);
      error.statusCode = response.status;
      error.payload = payload;
      error.externalServiceCall = externalServiceCall;
      const classified = classifyError(error, externalServiceCall);
      error.errorCode = classified.code;
      throw error;
    }
    if (binary) {
      return {
        buffer: payload.buffer || Buffer.from(payload.text || ""),
        contentType: response.headers.get("content-type") || payload.contentType || "application/octet-stream",
        fileName: fileNameFromDisposition(response.headers.get("content-disposition"), "external-distillation.bin"),
        pactExternalServiceCall: externalServiceCall
      };
    }
    return attachExternalServiceCall(payload, externalServiceCall);
  }

  return Object.freeze({
    protocolVersion: EXTERNAL_KNOWLEDGE_DISTILLATION_PROTOCOL_VERSION,
    baseUrl: normalizedBaseUrl,
    health() {
      return request("/health");
    },
    capabilities() {
      return request("/v1/capabilities");
    },
    runtimeHealth() {
      return request("/v1/runtime/health");
    },
    listRuns(input = {}) {
      const limit = Number(input.limit || 50);
      const query = Number.isFinite(limit) && limit > 0 ? `?limit=${Math.min(200, Math.floor(limit))}` : "";
      return request(`/v1/distillation/runs${query}`);
    },
    createRun(input = {}) {
      const {
        baseUrl: _baseUrl,
        serviceUrl: _serviceUrl,
        endpoint: _endpoint,
        token: _token,
        apiKey: _apiKey,
        timeoutMs: _timeoutMs,
        modelGatewayUrl: _modelGatewayUrl,
        agentGatewayUrl: _agentGatewayUrl,
        modelGatewayToken: _modelGatewayToken,
        agentGatewayToken: _agentGatewayToken,
        modelGatewayTokenHeader: _modelGatewayTokenHeader,
        modelGatewayTokenPrefix: _modelGatewayTokenPrefix,
        agentGatewayTokenHeader: _agentGatewayTokenHeader,
        agentGatewayTokenPrefix: _agentGatewayTokenPrefix,
        ...body
      } = input || {};
      return request("/v1/distillation/runs", {
        method: "POST",
        body
      });
    },
    getRun(input = {}) {
      const runId = normalizeText(input.runId || input.id || input["run-id"]);
      if (!runId) {
        throw new Error("读取外部知识蒸馏任务需要 runId。");
      }
      return request(`/v1/distillation/runs/${encodeURIComponent(runId)}`);
    },
    cancelRun(input = {}) {
      const runId = normalizeText(input.runId || input.id || input["run-id"]);
      if (!runId) {
        throw new Error("取消外部知识蒸馏任务需要 runId。");
      }
      return request(`/v1/distillation/runs/${encodeURIComponent(runId)}/cancel`, {
        method: "POST",
        body: {
          reason: input.reason || input.message || ""
        }
      });
    },
    queryEvidence(input = {}) {
      const runId = normalizeText(input.runId || input.id || input["run-id"]);
      if (!runId) {
        throw new Error("查询外部知识蒸馏证据需要 runId。");
      }
      return request(`/v1/distillation/runs/${encodeURIComponent(runId)}/evidence${evidenceQueryString(input)}`);
    },
    queryProjectEvidence(input = {}) {
      const projectId = normalizeText(input.projectId || input["project-id"] || input.id || input["id"]);
      if (!projectId) {
        throw new Error("查询外部知识蒸馏项目证据需要 projectId。");
      }
      return request(`/v1/projects/${encodeURIComponent(projectId)}/evidence${evidenceQueryString(input)}`);
    },
    exportArtifact(input = {}) {
      const runId = normalizeText(input.runId || input.id || input["run-id"]);
      const artifactId = normalizeText(input.artifactId || input.artifact || input["artifact-id"] || "portable-markdown");
      if (!runId) {
        throw new Error("导出外部知识蒸馏产物需要 runId。");
      }
      return request(
        `/v1/distillation/runs/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(artifactId)}`,
        { binary: true }
      );
    }
  });
}
