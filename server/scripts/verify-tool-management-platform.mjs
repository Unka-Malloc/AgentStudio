import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { promisify } from "node:util";
import { startHttpServer } from "../services/server-runtime/http-server.mjs";
import { installAuthenticatedFetch } from "./test-auth-helper.mjs";

const execFileAsync = promisify(execFile);

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const rawText = await response.text();
  const payload = rawText.trim() ? JSON.parse(rawText) : {};
  return {
    ok: response.ok,
    status: response.status,
    payload
  };
}

function bearerHeaders(token) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`
  };
}

function assertDurationPercentiles(percentiles) {
  assert.ok(percentiles);
  assert.ok(percentiles.p50Ms >= 0);
  assert.ok(percentiles.p95Ms >= percentiles.p50Ms);
  assert.ok(percentiles.p99Ms >= percentiles.p95Ms);
}

const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-tool-management-"));
process.env.PACT_TOOL_GRANT_CAPABILITY_KEY_PROVIDER = "local-file";
process.env.PACT_TOOL_GRANT_BINDING_GUARD_PROVIDER = "local-file";
const server = await startHttpServer({
  userDataPath,
  distPath: "",
  port: 0,
  runtimeOptions: {
    profile: "minimal"
  }
});
await installAuthenticatedFetch(server);

try {
  const catalog = await fetchJson(`${server.url}/api/tool-management/v1/catalog`);
  assert.equal(catalog.status, 200);
  assert.equal(catalog.payload.schemaVersion, 1);
  assert.ok(catalog.payload.fingerprint);
  const toolIds = new Set(catalog.payload.tools.map((tool) => tool.id));
  assert.equal(toolIds.has("pact.runtime.info"), true);
  assert.equal(toolIds.has("pact.runtime.mounts"), true);
  assert.equal(toolIds.has("pact.runtime.mounts.set"), true);
  assert.equal(toolIds.has("pact.runtime.mounts.reload"), true);
  assert.equal(toolIds.has("pact.knowledge.health"), true);
  assert.equal(toolIds.has("pact.knowledge.search"), true);
  assert.equal(toolIds.has("agent-exploration.keyword_search"), true);
  assert.equal(toolIds.has("maintenance-agent.storage.doctor"), true);

  const toolsets = await fetchJson(`${server.url}/api/tool-management/v1/toolsets`);
  assert.equal(toolsets.status, 200);
  assert.ok(toolsets.payload.toolsets.some((toolset) => toolset.id === "pact.knowledge.read"));

  const grantResult = await fetchJson(`${server.url}/api/tool-management/v1/grants`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      label: "verify-tool-management",
      scopes: ["knowledge:read"]
    })
  });
  assert.equal(grantResult.status, 201);
  assert.match(grantResult.payload.token, /^ock_[A-Za-z0-9_-]+$/);
  assert.equal(grantResult.payload.grant.hasToken, true);
  assert.equal(grantResult.payload.grant.scopes.includes("knowledge:read"), true);
  assert.equal(grantResult.payload.grant.credential.protocolVersion, "pact.opaque-capability-key.v1");

  const narrowGrant = await fetchJson(`${server.url}/api/tool-management/v1/grants`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      label: "verify-document-parse-only",
      toolsets: ["pact.document.parse"]
    })
  });
  assert.equal(narrowGrant.status, 201);

  const noToken = await fetchJson(`${server.url}/api/tool-management/v1/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      toolId: "pact.knowledge.health",
      input: {}
    })
  });
  assert.equal(noToken.status, 401);
  assert.equal(noToken.payload.error.code, "missing_token");

  const toolsetDenied = await fetchJson(`${server.url}/api/tool-management/v1/execute`, {
    method: "POST",
    headers: bearerHeaders(narrowGrant.payload.token),
    body: JSON.stringify({
      toolId: "pact.knowledge.health",
      input: {}
    })
  });
  assert.equal(toolsetDenied.status, 403);
  assert.equal(toolsetDenied.payload.error.code, "missing_capabilities");

  const rateLimitedGrant = await fetchJson(`${server.url}/api/tool-management/v1/grants`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      label: "verify-rate-limit",
      scopes: ["knowledge:read"],
      rateLimit: { perMinute: 1 }
    })
  });
  assert.equal(rateLimitedGrant.status, 201);
  const rateFirst = await fetchJson(`${server.url}/api/tool-management/v1/execute`, {
    method: "POST",
    headers: bearerHeaders(rateLimitedGrant.payload.token),
    body: JSON.stringify({
      toolId: "pact.knowledge.health",
      input: {}
    })
  });
  assert.equal(rateFirst.status, 200);
  const rateSecond = await fetchJson(`${server.url}/api/tool-management/v1/execute`, {
    method: "POST",
    headers: bearerHeaders(rateLimitedGrant.payload.token),
    body: JSON.stringify({
      toolId: "pact.knowledge.health",
      input: {}
    })
  });
  assert.equal(rateSecond.status, 429);
  assert.equal(rateSecond.payload.error.code, "rate_limited");

  const originGrant = await fetchJson(`${server.url}/api/tool-management/v1/grants`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      label: "verify-origin-boundary",
      scopes: ["knowledge:read"],
      allowedOrigins: ["https://allowed.example"]
    })
  });
  assert.equal(originGrant.status, 201);
  const originDenied = await fetchJson(`${server.url}/api/tool-management/v1/execute`, {
    method: "POST",
    headers: bearerHeaders(originGrant.payload.token),
    body: JSON.stringify({
      toolId: "pact.knowledge.health",
      input: {}
    })
  });
  assert.equal(originDenied.status, 403);
  assert.equal(originDenied.payload.error.code, "origin_not_allowed");
  const originAllowed = await fetchJson(`${server.url}/api/tool-management/v1/execute`, {
    method: "POST",
    headers: {
      ...bearerHeaders(originGrant.payload.token),
      Origin: "https://allowed.example"
    },
    body: JSON.stringify({
      toolId: "pact.knowledge.health",
      input: {}
    })
  });
  assert.equal(originAllowed.status, 200);

  const boundGrant = await fetchJson(`${server.url}/api/tool-management/v1/grants`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      label: "verify-bound-agent-user",
      scopes: ["knowledge:read"],
      metadata: {
        agentId: "agent-a",
        boundUserId: "user-a"
      }
    })
  });
  assert.equal(boundGrant.status, 201);
  assert.equal(boundGrant.payload.grant.credential.bindingProtocol, "pact.capability-binding-guard.v1");
  assert.equal(boundGrant.payload.grant.credential.bindingStrength, "user+agent");
  const boundAllowed = await fetchJson(`${server.url}/api/tool-management/v1/execute`, {
    method: "POST",
    headers: bearerHeaders(boundGrant.payload.token),
    body: JSON.stringify({
      toolId: "pact.knowledge.health",
      context: {
        agentId: "agent-a",
        userId: "user-a"
      },
      input: {}
    })
  });
  assert.equal(boundAllowed.status, 200);
  const boundWrongUser = await fetchJson(`${server.url}/api/tool-management/v1/execute`, {
    method: "POST",
    headers: bearerHeaders(boundGrant.payload.token),
    body: JSON.stringify({
      toolId: "pact.knowledge.health",
      context: {
        agentId: "agent-a",
        userId: "user-b"
      },
      input: {}
    })
  });
  assert.equal(boundWrongUser.status, 403);
  assert.equal(boundWrongUser.payload.error.code, "binding_user_mismatch");

  const executed = await fetchJson(`${server.url}/api/tool-management/v1/execute`, {
    method: "POST",
    headers: bearerHeaders(grantResult.payload.token),
    body: JSON.stringify({
      toolId: "pact.knowledge.health",
      context: {
        profileId: "profile-metered"
      },
      input: {}
    })
  });
  assert.equal(executed.status, 200);
  assert.ok(executed.payload.toolExecutionId);
  assert.ok(executed.payload.traceId);
  assert.equal(executed.payload.status, "ok");
  assert.equal(executed.payload.result.ok, true);

  const audit = await fetchJson(`${server.url}/api/tool-management/v1/audit?limit=20`);
  assert.equal(audit.status, 200);
  assert.ok(audit.payload.items.some((item) => item.toolExecutionId === executed.payload.toolExecutionId));

  const metrics = await fetchJson(`${server.url}/api/tool-management/v1/metrics/summary`);
  assert.equal(metrics.status, 200);
  assert.ok(metrics.payload.metrics.callsTotal >= 2);
  assert.ok(metrics.payload.metrics.byStatus.ok >= 1);
  assert.ok(metrics.payload.metrics.byStatus.denied >= 1);
  assert.ok(metrics.payload.metrics.inputBytesTotal > 0);
  assert.ok(metrics.payload.metrics.resultBytesTotal > 0);
  assert.ok(metrics.payload.metrics.transferBytesTotal >= metrics.payload.metrics.inputBytesTotal);
  assert.ok(metrics.payload.metrics.toolCalls.inputBytesTotal > 0);
  assert.ok(metrics.payload.metrics.toolCalls.resultBytesTotal > 0);
  assert.ok(metrics.payload.metrics.toolCalls.averageBytesPerSecond >= 0);
  const grantUsage = metrics.payload.metrics.toolCalls.usageByGrant.find((item) =>
    item.grantId === grantResult.payload.grant.id
  );
  assert.ok(grantUsage);
  assert.ok(grantUsage.total >= 1);
  assert.ok(grantUsage.transferBytesTotal > 0);
  assert.ok(grantUsage.averageBytesPerSecond >= 0);
  assert.ok(grantUsage.failureRate >= 0);
  assertDurationPercentiles(grantUsage.durationPercentiles);
  const profileUsage = metrics.payload.metrics.toolCalls.usageByProfile.find((item) =>
    item.profileId === "profile-metered"
  );
  assert.ok(profileUsage);
  assert.ok(profileUsage.total >= 1);
  assert.ok(profileUsage.transferBytesTotal > 0);
  assertDurationPercentiles(profileUsage.durationPercentiles);
  assert.ok(metrics.payload.metrics.requests.total >= 1);
  assert.ok(metrics.payload.metrics.requests.byTransport["tool-management"] >= 1);
  assert.ok(metrics.payload.metrics.requests.byRoute["/api/tool-management/v1/execute"] >= 1);
  assert.ok(metrics.payload.metrics.requests.byCompletionStatus.completed >= 1);
  assert.ok(metrics.payload.metrics.requests.successTotal >= 1);
  assert.ok(metrics.payload.metrics.requests.clientErrorTotal >= 0);
  assert.ok(metrics.payload.metrics.requests.serverErrorTotal >= 0);
  assert.ok(metrics.payload.metrics.requests.completionFailureTotal >= 0);
  assert.ok(metrics.payload.metrics.requests.clientErrorRate >= 0);
  assert.ok(metrics.payload.metrics.requests.serverErrorRate >= 0);
  assert.ok(metrics.payload.metrics.requests.completionFailureRate >= 0);
  assertDurationPercentiles(metrics.payload.metrics.requests.durationPercentiles);
  assert.ok(metrics.payload.metrics.requests.requestBytesTotal > 0);
  assert.ok(metrics.payload.metrics.requests.responseBytesTotal > 0);
  assert.ok(metrics.payload.metrics.requests.transferBytesPerSecond >= 0);

  const filteredMetricsUrl = new URL(`${server.url}/api/tool-management/v1/metrics/summary`);
  filteredMetricsUrl.searchParams.set("toolId", "pact.knowledge.health");
  filteredMetricsUrl.searchParams.set("transport", "tool-management");
  filteredMetricsUrl.searchParams.set("route", "/api/tool-management/v1/execute");
  filteredMetricsUrl.searchParams.set("bucketSeconds", "60");
  const filteredMetrics = await fetchJson(filteredMetricsUrl.toString());
  assert.equal(filteredMetrics.status, 200);
  assert.equal(filteredMetrics.payload.metrics.filters.toolId, "pact.knowledge.health");
  assert.equal(filteredMetrics.payload.metrics.filters.transport, "tool-management");
  assert.equal(filteredMetrics.payload.metrics.filters.route, "/api/tool-management/v1/execute");
  assert.equal(filteredMetrics.payload.metrics.series.bucketSeconds, 60);
  assert.ok(filteredMetrics.payload.metrics.toolCalls.byTool["pact.knowledge.health"] >= 1);
  assert.equal(Object.keys(filteredMetrics.payload.metrics.toolCalls.byTool).length, 1);
  assert.ok(filteredMetrics.payload.metrics.requests.byTransport["tool-management"] >= 1);
  assert.ok(filteredMetrics.payload.metrics.requests.byRoute["/api/tool-management/v1/execute"] >= 1);
  assert.ok(filteredMetrics.payload.metrics.series.buckets.some((bucket) =>
    bucket.toolCalls.total >= 1 &&
      bucket.toolCalls.byTool["pact.knowledge.health"] >= 1
  ));
  assert.ok(filteredMetrics.payload.metrics.series.buckets.some((bucket) =>
    bucket.requests.total >= 1 &&
      bucket.requests.byTransport["tool-management"] >= 1 &&
      bucket.requests.byCompletionStatus.completed >= 1 &&
      bucket.requests.successTotal >= 1
  ));

  {
    const healthMetricsDb = new Database(path.join(userDataPath, "tool-management", "tool-management.sqlite"), {
      fileMustExist: true
    });
    try {
      const createdAt = new Date().toISOString();
      for (let index = 0; index < 3; index += 1) {
        healthMetricsDb.prepare(`
          INSERT INTO tool_metric_events (
            metric_id, trace_id, tool_id, status, risk, duration_ms,
            input_bytes, result_bytes, transfer_bytes, bytes_per_second, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          `metric_verify_latency_tool_${index}`,
          `trace_verify_latency_${index}`,
          "pact.knowledge.health",
          "ok",
          "read_only",
          2500 + index,
          13,
          29,
          42,
          16.8,
          createdAt
        );
        healthMetricsDb.prepare(`
          INSERT INTO http_request_metric_events (
            metric_id, trace_id, request_id, transport, method, route, status_code,
            completion_status, request_bytes, response_bytes, transfer_bytes,
            duration_ms, bytes_per_second, user_agent, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          `http_metric_verify_latency_${index}`,
          `trace_verify_latency_${index}`,
          `request_verify_latency_${index}`,
          "tool-management",
          "POST",
          "/api/tool-management/v1/execute",
          200,
          "completed",
          13,
          29,
          42,
          3000 + index,
          14,
          "verify",
          createdAt
        );
      }
    } finally {
      healthMetricsDb.close();
    }
  }

  const metricsHealthUrl = new URL(`${server.url}/api/tool-management/v1/metrics/health`);
  metricsHealthUrl.searchParams.set("windowSeconds", "3600");
  metricsHealthUrl.searchParams.set("maxDeniedRate", "0");
  metricsHealthUrl.searchParams.set("maxToolFailureRate", "1");
  metricsHealthUrl.searchParams.set("maxRequestErrorRate", "1");
  metricsHealthUrl.searchParams.set("maxRequestP95Ms", "1");
  metricsHealthUrl.searchParams.set("maxToolP95Ms", "1");
  const metricsHealth = await fetchJson(metricsHealthUrl.toString());
  assert.equal(metricsHealth.status, 200);
  assert.equal(metricsHealth.payload.health.schemaVersion, "pact.tool-management.metrics-health.v1");
  assert.equal(metricsHealth.payload.health.window.windowSeconds, 3600);
  assert.equal(metricsHealth.payload.health.thresholds.maxDeniedRate, 0);
  assert.equal(metricsHealth.payload.health.thresholds.maxRequestP95Ms, 1);
  assert.equal(metricsHealth.payload.health.thresholds.maxToolP95Ms, 1);
  assert.ok(["warn", "critical"].includes(metricsHealth.payload.health.status));
  assert.ok(metricsHealth.payload.health.toolCalls.total >= 2);
  assert.ok(metricsHealth.payload.health.toolCalls.callsPerMinute >= 0);
  assert.ok(metricsHealth.payload.health.toolCalls.transferBytesPerSecond >= 0);
  assertDurationPercentiles(metricsHealth.payload.health.toolCalls.durationPercentiles);
  assert.ok(metricsHealth.payload.health.requests.total >= 1);
  assert.ok(metricsHealth.payload.health.requests.requestsPerMinute >= 0);
  assert.ok(metricsHealth.payload.health.requests.transferBytesPerSecond >= 0);
  assertDurationPercentiles(metricsHealth.payload.health.requests.durationPercentiles);
  assert.ok(metricsHealth.payload.health.breaches.some((breach) => breach.code === "tool_denied_rate"));
  assert.ok(metricsHealth.payload.health.breaches.some((breach) => breach.code === "request_p95_duration_ms"));
  assert.ok(metricsHealth.payload.health.breaches.some((breach) => breach.code === "tool_p95_duration_ms"));
  const healthTopTool = metricsHealth.payload.health.toolCalls.topTools.find((item) =>
    item.toolId === "pact.knowledge.health"
  );
  assert.ok(healthTopTool);
  assert.ok(healthTopTool.averageDurationMs >= 0);
  assert.ok(healthTopTool.transferBytesPerSecond >= 0);
  assertDurationPercentiles(healthTopTool.durationPercentiles);
  const healthTopRoute = metricsHealth.payload.health.requests.topRoutes.find((item) =>
    item.route === "/api/tool-management/v1/execute"
  );
  assert.ok(healthTopRoute);
  assert.ok(healthTopRoute.averageDurationMs >= 0);
  assert.ok(healthTopRoute.transferBytesPerSecond >= 0);
  assertDurationPercentiles(healthTopRoute.durationPercentiles);

  const prometheusUrl = new URL(`${server.url}/api/tool-management/v1/metrics/prometheus`);
  prometheusUrl.searchParams.set("windowSeconds", "3600");
  prometheusUrl.searchParams.set("maxDeniedRate", "0");
  const prometheusResponse = await fetch(prometheusUrl.toString());
  const prometheusText = await prometheusResponse.text();
  assert.equal(prometheusResponse.status, 200);
  assert.match(prometheusResponse.headers.get("content-type") || "", /text\/plain/);
  assert.match(prometheusText, /^# HELP pact_tool_management_window_seconds/m);
  assert.match(prometheusText, /^pact_tool_management_requests_total \d+/m);
  assert.match(prometheusText, /^pact_tool_management_tool_calls_total \d+/m);
  assert.match(prometheusText, /^pact_tool_management_health_breaches_total \d+/m);
  assert.match(prometheusText, /^pact_tool_management_request_duration_ms\{quantile="0\.95"\} \d+/m);
  assert.match(prometheusText, /^pact_tool_management_tool_call_duration_ms\{quantile="0\.95"\} \d+/m);
  assert.match(
    prometheusText,
    /^pact_tool_management_top_tool_calls_total\{tool_id="pact\.knowledge\.health"\} \d+/m
  );
  assert.match(
    prometheusText,
    /^pact_tool_management_top_tool_transfer_bytes_per_second\{tool_id="pact\.knowledge\.health"\} \d+/m
  );
  assert.match(
    prometheusText,
    /^pact_tool_management_top_tool_duration_ms\{tool_id="pact\.knowledge\.health",quantile="0\.95"\} \d+/m
  );
  assert.match(
    prometheusText,
    /^pact_tool_management_top_route_requests_total\{transport="tool-management",method="POST",route="\/api\/tool-management\/v1\/execute"\} \d+/m
  );
  assert.match(
    prometheusText,
    /^pact_tool_management_top_route_transfer_bytes_per_second\{transport="tool-management",method="POST",route="\/api\/tool-management\/v1\/execute"\} \d+/m
  );
  assert.match(
    prometheusText,
    /^pact_tool_management_top_route_duration_ms\{transport="tool-management",method="POST",route="\/api\/tool-management\/v1\/execute",quantile="0\.95"\} \d+/m
  );

  const toolMetricsExportUrl = new URL(`${server.url}/api/tool-management/v1/metrics/export`);
  toolMetricsExportUrl.searchParams.set("kind", "tool");
  toolMetricsExportUrl.searchParams.set("toolId", "pact.knowledge.health");
  toolMetricsExportUrl.searchParams.set("limit", "10");
  const toolMetricsExport = await fetchJson(toolMetricsExportUrl.toString());
  assert.equal(toolMetricsExport.status, 200);
  assert.equal(toolMetricsExport.payload.export.schemaVersion, "pact.tool-management.metrics-export.v1");
  assert.equal(toolMetricsExport.payload.export.filters.kind, "tool");
  assert.equal(toolMetricsExport.payload.export.filters.toolId, "pact.knowledge.health");
  assert.ok(toolMetricsExport.payload.export.toolMetricEvents.length >= 1);
  assert.equal(toolMetricsExport.payload.export.httpRequestMetricEvents.length, 0);
  assert.equal(toolMetricsExport.payload.export.toolMetricEvents.every((event) =>
    event.toolId === "pact.knowledge.health" &&
      !Object.hasOwn(event, "input") &&
      !Object.hasOwn(event, "result")
  ), true);
  assert.equal(toolMetricsExport.payload.export.counts.total, toolMetricsExport.payload.export.toolMetricEvents.length);

  const requestMetricsExportUrl = new URL(`${server.url}/api/tool-management/v1/metrics/export`);
  requestMetricsExportUrl.searchParams.set("kind", "request");
  requestMetricsExportUrl.searchParams.set("transport", "tool-management");
  requestMetricsExportUrl.searchParams.set("route", "/api/tool-management/v1/execute");
  requestMetricsExportUrl.searchParams.set("limit", "10");
  const requestMetricsExport = await fetchJson(requestMetricsExportUrl.toString());
  assert.equal(requestMetricsExport.status, 200);
  assert.equal(requestMetricsExport.payload.export.filters.kind, "request");
  assert.equal(requestMetricsExport.payload.export.toolMetricEvents.length, 0);
  assert.ok(requestMetricsExport.payload.export.httpRequestMetricEvents.length >= 1);
  assert.equal(requestMetricsExport.payload.export.httpRequestMetricEvents.every((event) =>
    event.transport === "tool-management" &&
      event.route === "/api/tool-management/v1/execute" &&
      !Object.hasOwn(event, "body") &&
      !Object.hasOwn(event, "response") &&
      !Object.hasOwn(event, "userAgent")
  ), true);

  const storage = await fetchJson(`${server.url}/api/tool-management/v1/metrics/storage`);
  assert.equal(storage.status, 200);
  assert.equal(storage.payload.storage.schemaVersion, "pact.tool-management.metrics-storage.v1");
  assert.equal(storage.payload.storage.database.fileName, "tool-management.sqlite");
  assert.equal(Object.hasOwn(storage.payload.storage.database, "path"), false);
  assert.ok(storage.payload.storage.database.totalBytes > 0);
  assert.ok(storage.payload.storage.tables.toolMetricEvents.rows >= 2);
  assert.ok(storage.payload.storage.tables.toolMetricEvents.transferBytesTotal > 0);
  assert.ok(storage.payload.storage.tables.toolMetricEvents.eventsPerMinute >= 0);
  assert.ok(storage.payload.storage.tables.httpRequestMetricEvents.rows >= 1);
  assert.ok(storage.payload.storage.tables.httpRequestMetricEvents.transferBytesTotal > 0);
  assert.ok(storage.payload.storage.tables.httpRequestMetricEvents.eventsPerMinute >= 0);
  assert.equal(storage.payload.storage.totals.metricRows,
    storage.payload.storage.tables.toolMetricEvents.rows +
      storage.payload.storage.tables.httpRequestMetricEvents.rows);
  assert.ok(storage.payload.storage.totals.transferBytesTotal > 0);

  const metricsDb = new Database(path.join(userDataPath, "tool-management", "tool-management.sqlite"), {
    fileMustExist: true
  });
  try {
    const httpMetric = metricsDb.prepare(`
      SELECT request_bytes, response_bytes, transfer_bytes, bytes_per_second
      FROM http_request_metric_events
      WHERE route = '/api/tool-management/v1/execute'
      ORDER BY created_at DESC
      LIMIT 1
    `).get();
    assert.ok(httpMetric);
    assert.ok(httpMetric.request_bytes > 0);
    assert.ok(httpMetric.response_bytes > 0);
    assert.ok(httpMetric.transfer_bytes >= httpMetric.request_bytes + httpMetric.response_bytes);
    assert.ok(httpMetric.bytes_per_second >= 0);

    const toolMetric = metricsDb.prepare(`
      SELECT input_bytes, result_bytes, transfer_bytes, bytes_per_second
      FROM tool_metric_events
      WHERE tool_id = 'pact.knowledge.health' AND status = 'ok'
      ORDER BY created_at DESC
      LIMIT 1
    `).get();
    assert.ok(toolMetric);
    assert.ok(toolMetric.input_bytes > 0);
    assert.ok(toolMetric.result_bytes > 0);
    assert.ok(toolMetric.transfer_bytes >= toolMetric.input_bytes + toolMetric.result_bytes);
    assert.ok(toolMetric.bytes_per_second >= 0);

    metricsDb.prepare(`
      INSERT INTO tool_metric_events (
        metric_id, trace_id, tool_id, status, risk, duration_ms,
        input_bytes, result_bytes, transfer_bytes, bytes_per_second, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "metric_verify_old_tool",
      "trace_verify_old",
      "pact.knowledge.health",
      "ok",
      "read_only",
      12,
      9,
      17,
      26,
      2166.67,
      "2000-01-01T00:00:00.000Z"
    );
    metricsDb.prepare(`
      INSERT INTO http_request_metric_events (
        metric_id, trace_id, request_id, transport, method, route, status_code,
        completion_status, request_bytes, response_bytes, transfer_bytes,
        duration_ms, bytes_per_second, user_agent, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "http_metric_verify_old",
      "trace_verify_old",
      "request_verify_old",
      "tool-management",
      "POST",
      "/api/tool-management/v1/execute",
      200,
      "completed",
      9,
      17,
      26,
      12,
      2166.67,
      "verify",
      "2000-01-01T00:00:00.000Z"
    );
  } finally {
    metricsDb.close();
  }

  const pruneDenied = await fetchJson(`${server.url}/api/tool-management/v1/metrics/prune`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-pact-safety-confirm": "false"
    },
    body: JSON.stringify({ olderThan: "2001-01-01T00:00:00.000Z" })
  });
  assert.equal(pruneDenied.status, 428);
  assert.match(JSON.stringify(pruneDenied.payload), /confirm|confirmation/i);

  const pruned = await fetchJson(`${server.url}/api/tool-management/v1/metrics/prune`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ olderThan: "2001-01-01T00:00:00.000Z" })
  });
  assert.equal(pruned.status, 200);
  assert.equal(pruned.payload.prune.schemaVersion, "pact.tool-management.metrics-prune.v1");
  assert.equal(pruned.payload.prune.deleted.toolMetrics, 1);
  assert.equal(pruned.payload.prune.deleted.httpRequestMetrics, 1);

  const prunedDb = new Database(path.join(userDataPath, "tool-management", "tool-management.sqlite"), {
    fileMustExist: true
  });
  try {
    assert.equal(
      prunedDb.prepare("SELECT count(*) AS count FROM tool_metric_events WHERE metric_id = ?")
        .get("metric_verify_old_tool").count,
      0
    );
    assert.equal(
      prunedDb.prepare("SELECT count(*) AS count FROM http_request_metric_events WHERE metric_id = ?")
        .get("http_metric_verify_old").count,
      0
    );
    prunedDb.prepare(`
      INSERT INTO tool_metric_events (
        metric_id, trace_id, tool_id, status, risk, duration_ms,
        input_bytes, result_bytes, transfer_bytes, bytes_per_second, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "metric_verify_cli_old_tool",
      "trace_verify_cli_old",
      "pact.knowledge.health",
      "ok",
      "read_only",
      8,
      4,
      5,
      9,
      1125,
      "2000-01-02T00:00:00.000Z"
    );
    prunedDb.prepare(`
      INSERT INTO http_request_metric_events (
        metric_id, trace_id, request_id, transport, method, route, status_code,
        completion_status, request_bytes, response_bytes, transfer_bytes,
        duration_ms, bytes_per_second, user_agent, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "http_metric_verify_cli_old",
      "trace_verify_cli_old",
      "request_verify_cli_old",
      "tool-management",
      "POST",
      "/api/tool-management/v1/execute",
      200,
      "completed",
      4,
      5,
      9,
      8,
      1125,
      "verify-cli",
      "2000-01-02T00:00:00.000Z"
    );
  } finally {
    prunedDb.close();
  }

  const cliCatalog = await execFileAsync(
    process.execPath,
    [path.resolve("server/scripts/pact.mjs"), "tools", "catalog", "--server-url", server.url],
    { env: process.env }
  );
  const cliCatalogPayload = JSON.parse(cliCatalog.stdout);
  assert.equal(cliCatalogPayload.schemaVersion, 1);
  assert.ok(cliCatalogPayload.tools.some((tool) => tool.id === "pact.knowledge.health"));

  const cliMetrics = await execFileAsync(
    process.execPath,
    [
      path.resolve("server/scripts/pact.mjs"),
      "tools",
      "metrics",
      "--server-url",
      server.url,
      "--limit",
      "20",
      "--tool-id",
      "pact.knowledge.health",
      "--transport",
      "tool-management",
      "--route",
      "/api/tool-management/v1/execute",
      "--bucket-seconds",
      "60"
    ],
    { env: process.env }
  );
  const cliMetricsPayload = JSON.parse(cliMetrics.stdout);
  assert.equal(cliMetricsPayload.schemaVersion, 1);
  assert.ok(cliMetricsPayload.metrics.callsTotal >= 1);
  assert.equal(cliMetricsPayload.metrics.filters.toolId, "pact.knowledge.health");
  assert.equal(cliMetricsPayload.metrics.filters.transport, "tool-management");
  assert.equal(cliMetricsPayload.metrics.series.bucketSeconds, 60);

  const cliHealth = await execFileAsync(
    process.execPath,
    [
      path.resolve("server/scripts/pact.mjs"),
      "tools",
      "metrics",
      "health",
      "--server-url",
      server.url,
      "--window-seconds",
      "3600",
      "--max-denied-rate",
      "1",
      "--max-request-p95-ms",
      "1",
      "--max-tool-p95-ms",
      "1"
    ],
    { env: process.env }
  );
  const cliHealthPayload = JSON.parse(cliHealth.stdout);
  assert.equal(cliHealthPayload.schemaVersion, 1);
  assert.equal(cliHealthPayload.health.schemaVersion, "pact.tool-management.metrics-health.v1");
  assert.equal(cliHealthPayload.health.window.windowSeconds, 3600);
  assert.ok(cliHealthPayload.health.toolCalls.total >= 1);
  assertDurationPercentiles(cliHealthPayload.health.toolCalls.durationPercentiles);
  assert.ok(cliHealthPayload.health.requests.total >= 1);
  assertDurationPercentiles(cliHealthPayload.health.requests.durationPercentiles);
  assert.ok(cliHealthPayload.health.breaches.some((breach) => breach.code === "request_p95_duration_ms"));
  assert.ok(cliHealthPayload.health.breaches.some((breach) => breach.code === "tool_p95_duration_ms"));

  const cliPrometheus = await execFileAsync(
    process.execPath,
    [
      path.resolve("server/scripts/pact.mjs"),
      "tools",
      "metrics",
      "prometheus",
      "--server-url",
      server.url,
      "--window-seconds",
      "3600",
      "--max-denied-rate",
      "1",
      "--max-request-p95-ms",
      "1",
      "--max-tool-p95-ms",
      "1"
    ],
    { env: process.env }
  );
  assert.match(cliPrometheus.stdout, /^# HELP pact_tool_management_window_seconds/m);
  assert.match(cliPrometheus.stdout, /^pact_tool_management_tool_calls_total \d+/m);
  assert.match(cliPrometheus.stdout, /^pact_tool_management_requests_total \d+/m);
  assert.match(cliPrometheus.stdout, /^pact_tool_management_request_duration_ms\{quantile="0\.95"\} \d+/m);
  assert.match(cliPrometheus.stdout, /^pact_tool_management_tool_call_duration_ms\{quantile="0\.95"\} \d+/m);
  assert.match(
    cliPrometheus.stdout,
    /^pact_tool_management_top_tool_duration_ms\{tool_id="pact\.knowledge\.health",quantile="0\.95"\} \d+/m
  );
  assert.match(
    cliPrometheus.stdout,
    /^pact_tool_management_top_route_duration_ms\{transport="tool-management",method="POST",route="\/api\/tool-management\/v1\/execute",quantile="0\.95"\} \d+/m
  );

  const cliExport = await execFileAsync(
    process.execPath,
    [
      path.resolve("server/scripts/pact.mjs"),
      "tools",
      "metrics",
      "export",
      "--server-url",
      server.url,
      "--kind",
      "request",
      "--transport",
      "tool-management",
      "--route",
      "/api/tool-management/v1/execute",
      "--limit",
      "10"
    ],
    { env: process.env }
  );
  const cliExportPayload = JSON.parse(cliExport.stdout);
  assert.equal(cliExportPayload.schemaVersion, 1);
  assert.equal(cliExportPayload.export.schemaVersion, "pact.tool-management.metrics-export.v1");
  assert.equal(cliExportPayload.export.filters.kind, "request");
  assert.ok(cliExportPayload.export.httpRequestMetricEvents.length >= 1);
  assert.equal(cliExportPayload.export.toolMetricEvents.length, 0);

  const cliStorage = await execFileAsync(
    process.execPath,
    [path.resolve("server/scripts/pact.mjs"), "tools", "metrics", "storage", "--server-url", server.url],
    { env: process.env }
  );
  const cliStoragePayload = JSON.parse(cliStorage.stdout);
  assert.equal(cliStoragePayload.schemaVersion, 1);
  assert.equal(cliStoragePayload.storage.schemaVersion, "pact.tool-management.metrics-storage.v1");
  assert.equal(cliStoragePayload.storage.database.fileName, "tool-management.sqlite");
  assert.equal(Object.hasOwn(cliStoragePayload.storage.database, "path"), false);
  assert.ok(cliStoragePayload.storage.tables.toolMetricEvents.rows >= 1);
  assert.ok(cliStoragePayload.storage.tables.httpRequestMetricEvents.rows >= 1);

  const cliPrune = await execFileAsync(
    process.execPath,
    [
      path.resolve("server/scripts/pact.mjs"),
      "tools",
      "metrics",
      "prune",
      "--server-url",
      server.url,
      "--confirm",
      "--body",
      "{\"olderThan\":\"2001-01-01T00:00:00.000Z\"}"
    ],
    { env: process.env }
  );
  const cliPrunePayload = JSON.parse(cliPrune.stdout);
  assert.equal(cliPrunePayload.schemaVersion, 1);
  assert.equal(cliPrunePayload.prune.deleted.toolMetrics, 1);
  assert.equal(cliPrunePayload.prune.deleted.httpRequestMetrics, 1);

  const rotated = await fetchJson(`${server.url}/api/tool-management/v1/grants/${grantResult.payload.grant.id}/rotate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({})
  });
  assert.equal(rotated.status, 200);
  assert.ok(rotated.payload.token);
  const oldTokenDenied = await fetchJson(`${server.url}/api/tool-management/v1/execute`, {
    method: "POST",
    headers: bearerHeaders(grantResult.payload.token),
    body: JSON.stringify({
      toolId: "pact.knowledge.health",
      input: {}
    })
  });
  assert.equal(oldTokenDenied.status, 401);
  assert.equal(oldTokenDenied.payload.error.code, "invalid_token");
  const newTokenAllowed = await fetchJson(`${server.url}/api/tool-management/v1/execute`, {
    method: "POST",
    headers: bearerHeaders(rotated.payload.token),
    body: JSON.stringify({
      toolId: "pact.knowledge.health",
      input: {}
    })
  });
  assert.equal(newTokenAllowed.status, 200);

  const runtimeReadGrant = await fetchJson(`${server.url}/api/tool-management/v1/grants`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      label: "verify-runtime-read",
      scopes: ["storage:read", "jobs:read"]
    })
  });
  assert.equal(runtimeReadGrant.status, 201);

  const runtimeMounts = await fetchJson(`${server.url}/api/tool-management/v1/execute`, {
    method: "POST",
    headers: bearerHeaders(runtimeReadGrant.payload.token),
    body: JSON.stringify({
      toolId: "pact.runtime.mounts",
      input: {}
    })
  });
  assert.equal(runtimeMounts.status, 200);
  assert.ok(runtimeMounts.payload.result.runtime.mountGeneration >= 1);
  assert.ok(Array.isArray(runtimeMounts.payload.result.runtime.mounts));

  const runtimeSetDeniedForReadGrant = await fetchJson(`${server.url}/api/tool-management/v1/execute`, {
    method: "POST",
    headers: bearerHeaders(runtimeReadGrant.payload.token),
    body: JSON.stringify({
      toolId: "pact.runtime.mounts.set",
      input: {
        value: {
          mountRouting: {
            extensionRoutes: {
              ".tmverify": { mountName: "documentParser", action: "extractDocument" }
            }
          }
        }
      }
    })
  });
  assert.equal(runtimeSetDeniedForReadGrant.status, 403);
  assert.equal(runtimeSetDeniedForReadGrant.payload.error.code, "missing_capabilities");

  const runtimeMaintainGrant = await fetchJson(`${server.url}/api/tool-management/v1/grants`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      label: "verify-runtime-maintain",
      scopes: ["knowledge:maintain"],
      metadata: {
        maxRisk: "repair_write"
      }
    })
  });
  assert.equal(runtimeMaintainGrant.status, 201);

  const setNeedsConfirmation = await fetchJson(`${server.url}/api/tool-management/v1/execute`, {
    method: "POST",
    headers: {
      ...bearerHeaders(runtimeMaintainGrant.payload.token),
      "x-pact-safety-confirm": "false"
    },
    body: JSON.stringify({
      toolId: "pact.runtime.mounts.set",
      input: {
        value: {
          mountRouting: {
            extensionRoutes: {
              ".tmverify": { mountName: "documentParser", action: "extractDocument" }
            }
          }
        }
      }
    })
  });
  assert.equal(setNeedsConfirmation.status, 409);
  assert.equal(setNeedsConfirmation.payload.error.code, "confirmation_required");

  const setMounts = await fetchJson(`${server.url}/api/tool-management/v1/execute`, {
    method: "POST",
    headers: bearerHeaders(runtimeMaintainGrant.payload.token),
    body: JSON.stringify({
      toolId: "pact.runtime.mounts.set",
      input: {
        confirm: true,
        value: {
          mountRouting: {
            extensionRoutes: {
              ".tmverify": { mountName: "documentParser", action: "extractDocument" }
            }
          }
        }
      }
    })
  });
  assert.equal(setMounts.status, 200);
  assert.ok(setMounts.payload.result.runtime.mountGeneration > runtimeMounts.payload.result.runtime.mountGeneration);
  assert.equal(
    setMounts.payload.result.value.mountRouting.extensionRoutes[".tmverify"].mountName,
    "documentParser"
  );
  assert.equal(
    setMounts.payload.result.value.mountRouting.extensionRoutes[".tmverify"].action,
    "extractDocument"
  );

  const runtimeMountsAfterSet = await fetchJson(`${server.url}/api/tool-management/v1/execute`, {
    method: "POST",
    headers: bearerHeaders(runtimeReadGrant.payload.token),
    body: JSON.stringify({
      toolId: "pact.runtime.mounts",
      input: {}
    })
  });
  assert.equal(runtimeMountsAfterSet.status, 200);
  assert.equal(
    runtimeMountsAfterSet.payload.result.value.mountRouting.extensionRoutes[".tmverify"].mountName,
    "documentParser"
  );
  assert.ok(
    runtimeMountsAfterSet.payload.result.runtime.mountGeneration >=
      setMounts.payload.result.runtime.mountGeneration
  );

  const reloadNeedsConfirmation = await fetchJson(`${server.url}/api/tool-management/v1/execute`, {
    method: "POST",
    headers: {
      ...bearerHeaders(runtimeMaintainGrant.payload.token),
      "x-pact-safety-confirm": "false"
    },
    body: JSON.stringify({
      toolId: "pact.runtime.mounts.reload",
      input: {}
    })
  });
  assert.equal(reloadNeedsConfirmation.status, 409);
  assert.equal(reloadNeedsConfirmation.payload.error.code, "confirmation_required");

  const reloadedMounts = await fetchJson(`${server.url}/api/tool-management/v1/execute`, {
    method: "POST",
    headers: bearerHeaders(runtimeMaintainGrant.payload.token),
    body: JSON.stringify({
      toolId: "pact.runtime.mounts.reload",
      input: { confirm: true }
    })
  });
  assert.equal(reloadedMounts.status, 200);
  assert.equal(reloadedMounts.payload.result.ok, true);
  assert.ok(reloadedMounts.payload.result.runtime.mountGeneration > setMounts.payload.result.runtime.mountGeneration);
  assert.equal(
    reloadedMounts.payload.result.value.mountRouting.extensionRoutes[".tmverify"].mountName,
    "documentParser"
  );

  const revoked = await fetchJson(`${server.url}/api/tool-management/v1/grants/${grantResult.payload.grant.id}/revoke`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason: "verify complete" })
  });
  assert.equal(revoked.status, 200);
  const revokedDenied = await fetchJson(`${server.url}/api/tool-management/v1/execute`, {
    method: "POST",
    headers: bearerHeaders(rotated.payload.token),
    body: JSON.stringify({
      toolId: "pact.knowledge.health",
      input: {}
    })
  });
  assert.equal(revokedDenied.status, 401);
  assert.equal(revokedDenied.payload.error.code, "invalid_token");
} finally {
  await server.close();
  await fs.rm(userDataPath, { recursive: true, force: true });
}
