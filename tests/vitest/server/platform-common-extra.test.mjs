import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  readJsonBody,
  readRequestBody,
  parseBooleanFlag,
  parseEntityTypes,
  contentDispositionHeader,
  normalizeBaseUrl,
  sendJson,
  defaultAdvertisedHost,
  formatUrlHost,
  serveStaticFile
} from "../../../server/platform/common/console/http/http-utils.mjs";
import {
  asJson,
  asBoolInt,
  scopedId,
  parseJsonArray,
  jaccardSimilarityFromArrays,
  participantOverlap
} from "../../../server/platform/common/storage/metadata-helpers.mjs";
import {
  dispatchInternalOperation,
  findHttpOperation,
  shouldProxyRegisteredApiRequest
} from "../../../server/platform/common/operation-dispatcher/operation-dispatcher.mjs";
import {
  PRODUCTION_HEALTH_REPORT_TYPE,
  PRODUCTION_READINESS_REPORT_TYPE,
  buildProductionHealthReport,
  readProductionReadinessReports
} from "../../../server/platform/common/production-readiness/report-reader.mjs";
import {
  apiCapabilityId,
  createAuthorizationEngine,
  evaluateAuthorizationPolicy,
  isKernelCapabilityPermission,
  listKernelCapabilityPermissions,
  normalizeKernelCapabilities,
  unknownKernelCapabilities
} from "../../../server/platform/common/security/authorization/authorization-engine.mjs";
import {
  rejectClientSuppliedStrings
} from "../../../server/platform/common/security/client-strings.mjs";

const describeCapabilityKernelStatusMock = vi.hoisted(() => vi.fn(async () => ({
  ok: true,
  status: "healthy",
  tone: "success",
  provider: "memory",
  alias: "test-kernel",
  message: "mock capability kernel"
})));

const describeCapabilityBindingGuardStatusMock = vi.hoisted(() => vi.fn(async () => ({
  ok: true,
  status: "healthy",
  tone: "success",
  provider: "memory",
  alias: "test-binding",
  message: "mock capability binding guard"
})));

vi.mock("../../../server/platform/common/security/authorization/capability-kernel-status.mjs", () => ({
  describeCapabilityKernelStatus: describeCapabilityKernelStatusMock,
  describeCapabilityBindingGuardStatus: describeCapabilityBindingGuardStatusMock
}));

function createResponseCapture() {
  return {
    statusCode: null,
    headers: {},
    chunks: [],
    writeHead(statusCode, headers = {}) {
      this.statusCode = statusCode;
      this.headers = {
        ...this.headers,
        ...headers
      };
    },
    write(chunk) {
      if (chunk !== undefined && chunk !== null) {
        this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      }
    },
    end(chunk) {
      if (chunk !== undefined && chunk !== null) {
        this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      }
    },
    get body() {
      return Buffer.concat(this.chunks.length === 0 ? [Buffer.alloc(0)] : this.chunks).toString("utf8");
    }
  };
}

function createAsyncRequest(...chunks) {
  return {
    resume() {},
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) {
        yield Buffer.from(chunk);
      }
    }
  };
}

const tempRoots = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))
  );
});

async function createReportRun(reportRoot, runId, report) {
  const directory = path.join(reportRoot, runId);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, "report.json"), JSON.stringify(report), "utf8");
  return directory;
}

describe("operation-dispatcher: deterministic dispatch helpers", () => {
  it("matches path params and decodes URL segments", () => {
    const match = findHttpOperation({
      operations: [{
        id: "unit.decode",
        http: { method: "GET", path: "/api/item/:name" }
      }],
      method: "GET",
      pathname: "/api/item/%E5%8C%BA%E5%9D%97"
    });

    expect(match?.pathParams).toEqual({ name: "区块" });
  });

  it("skips forwarding when discovery is non-forward or operation is local-only", () => {
    const operations = [
      { http: { method: "GET", path: "/api/healthz" } },
      { http: { method: "GET", path: "/api/jobs/list" } },
      { http: { method: "GET", path: "/api/local-only", localInForwardMode: true } }
    ];

    expect(shouldProxyRegisteredApiRequest({
      pathname: "/api/healthz",
      operations,
      discoveryState: { mode: "local" }
    })).toBe(false);

    expect(shouldProxyRegisteredApiRequest({
      pathname: "/api/jobs/list",
      operations,
      discoveryState: { mode: "forward", forwardBaseUrl: "https://upstream.local" }
    })).toBe(false);

    expect(shouldProxyRegisteredApiRequest({
      pathname: "/api/local-only",
      operations,
      discoveryState: { mode: "forward", forwardBaseUrl: "https://upstream.local" }
    })).toBe(false);
  });

  it("dispatches internal operation and returns captured payload", async () => {
    const operation = {
      id: "system.ping",
      target: { controller: "system", method: "ping" },
      http: { method: "POST", path: "/api/system/ping" },
      safety: { risk: "read_only" },
      audit: { enabled: false },
      log: { enabled: true, redaction: "default" },
      inputSchema: { type: "object", properties: {} }
    };

    const result = await dispatchInternalOperation({
      operationId: operation.id,
      operations: [operation],
      controllers: {
        system: {
          ping: ({ response, requestBody }) => {
            response.writeHead(202, { "Content-Type": "application/json" });
            const parsedInput = Buffer.isBuffer(requestBody) ? JSON.parse(requestBody.toString("utf8")) : {};
            response.write(JSON.stringify({ ok: true, fromInput: parsedInput }));
          }
        }
      },
      input: { foo: "bar", count: 7 }
    });

    expect(result.operation.id).toBe("system.ping");
    expect(result.statusCode).toBe(202);
    expect(result.payload).toMatchObject({ ok: true, fromInput: { foo: "bar", count: 7 } });
  });
});

describe("security authorization engine: capability permission edges", () => {
  it("checks capability format helpers and normalization behavior", () => {
    const knownKernel = apiCapabilityId("system.health");
    const wildcard = "cap:api:*";

    expect(isKernelCapabilityPermission(knownKernel)).toBe(true);
    expect(isKernelCapabilityPermission(wildcard)).toBe(true);
    expect(isKernelCapabilityPermission("cap:invalid")).toBe(false);

    expect(unknownKernelCapabilities([knownKernel, wildcard, "cap:unknown:test"]).
      sort()).toEqual(["cap:unknown:test"]);

    expect(normalizeKernelCapabilities([knownKernel, wildcard, "cap:unknown"]))
      .toEqual([knownKernel, wildcard]);

    expect(listKernelCapabilityPermissions()).toContain(knownKernel);
  });

  it("covers dry-run authorization and explicit risk gating in policy evaluation", () => {
    const decision = evaluateAuthorizationPolicy({
      operation: {
        id: "knowledge.search",
        requiredScopes: ["knowledge:read"],
        safety: { risk: "destructive" },
        approvalScope: "maintenance:approve"
      },
      subject: {
        subjectId: "dry",
        capabilities: [apiCapabilityId("knowledge.search")],
        scopes: ["knowledge:read"]
      },
      dryRun: true
    });

    expect(decision.effect).toBe("dry_run_only");
    expect(decision.allowed).toBe(true);

    const engine = createAuthorizationEngine();
    const riskDecision = engine.evaluate({
      operation: { id: "knowledge.search", requiredScopes: ["knowledge:read"] },
      subject: { subjectId: "r", scopes: ["knowledge:read"] },
      authSession: { user: { userId: "r" } },
      dryRun: false,
      grantRequired: false,
      input: {}
    });

    expect(riskDecision.effect).toBe("allow");
  });
});

describe("console HTTP utilities: parser and responder behavior", () => {
  it("serializes JSON responses and parses query/entity helpers", () => {
    const response = createResponseCapture();
    sendJson(response, 201, { ok: true, code: "ok" });

    expect(response.statusCode).toBe(201);
    expect(response.headers["Content-Type"]).toBe("application/json; charset=utf-8");
    expect(JSON.parse(response.body).code).toBe("ok");

    expect(normalizeBaseUrl("http://127.0.0.1///")).toBe("http://127.0.0.1");
    expect(parseBooleanFlag("yes")).toBe(true);

    const searchParams = new URL("http://localhost/?entityType=Repo&entityType=AGENT&entityType=asset,tree").searchParams;
    expect(parseEntityTypes(searchParams)).toEqual(["repo", "agent", "asset", "tree"]);

    expect(contentDispositionHeader("attachment", "Hello\nWorld?.txt")).toContain("filename=\"Hello_World_.txt\"");
    expect(contentDispositionHeader("bad disposition", "A!'()*文件.txt")).toContain("filename*=UTF-8''A%21%27%28%29%2A");
    expect(() => rejectClientSuppliedStrings({ command: "  run  " }, "unit")).toThrow(
      "unit 不接受客户端传入的可执行字符串。"
    );
    expect(rejectClientSuppliedStrings({ nested: { ok: true } }, "unit")).toBeUndefined();
  });

  it("parses request bodies and handles body-size overflow", async () => {
    const request = createAsyncRequest("{\"a\":1}");
    expect(await readJsonBody(request)).toEqual({ a: 1 });

    expect(await readJsonBody(createAsyncRequest())).toEqual({});

    const invalid = createAsyncRequest("{");
    await expect(readJsonBody(invalid)).rejects.toThrow();

    const large = createAsyncRequest("12345");
    await expect(readRequestBody(large, 3)).rejects.toMatchObject({ statusCode: 413 });
  });
});

describe("console HTTP static serving", () => {
  it("serves safe files and blocks path traversal", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pact-http-static-"));
    tempRoots.push(root);
    const indexPath = path.join(root, "index.html");
    const textPath = path.join(root, "hello.txt");
    const directoryPath = path.join(root, "not-a-file");
    await fs.writeFile(indexPath, "<html>ok</html>", "utf8");
    await fs.writeFile(textPath, "hello", "utf8");
    await fs.mkdir(directoryPath);

    const indexResponse = createResponseCapture();
    const servedIndex = await serveStaticFile(indexResponse, root, "/");
    expect(servedIndex).toBe(true);
    expect(indexResponse.headers["Content-Type"]).toBe("text/html; charset=utf-8");

    const textResponse = createResponseCapture();
    const servedText = await serveStaticFile(textResponse, root, "/hello.txt");
    expect(servedText).toBe(true);
    expect(textResponse.headers["Content-Type"]).toBe("application/octet-stream");

    const blockedResponse = createResponseCapture();
    const blocked = await serveStaticFile(blockedResponse, root, "../secret");
    expect(blocked).toBe(false);

    const directoryResponse = createResponseCapture();
    expect(await serveStaticFile(directoryResponse, root, "/not-a-file")).toBe(false);

    expect(defaultAdvertisedHost("0.0.0.0")).toBe("127.0.0.1");
    expect(defaultAdvertisedHost("::")).toBe("::1");
    expect(formatUrlHost("::1")).toBe("[::1]");
  });
});

describe("storage metadata helpers", () => {
  it("normalizes JSON helpers and similarity metrics", () => {
    expect(asJson({ a: 1 })).toBe("{\"a\":1}");
    expect(asBoolInt(false)).toBe(0);
    expect(scopedId("batch", "knowledge", "k1")).toBe("batch::knowledge::k1");

    expect(parseJsonArray("[{\"x\":1}]\n")).toEqual([{ x: 1 }]);
    expect(parseJsonArray("[1,2,3]")).toEqual([1, 2, 3]);
    expect(parseJsonArray("{\"x\":1}")).toEqual([]);

    expect(jaccardSimilarityFromArrays(["A", "b", "a"], ["b", "c"]).toFixed(2)).toBe("0.33");
    expect(participantOverlap(["u1", "u2"], ["u2", "u3", "u1"])).toBeCloseTo(0.6666667, 7);
  });
});

describe("production readiness report-reader", () => {
  it("reads valid run reports and keeps deterministic sorting", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pact-report-reader-valid-"));
    tempRoots.push(repoRoot);
    const reportRoot = path.join(repoRoot, "docs", "reports", "history", "production-readiness");

    await fs.mkdir(reportRoot, { recursive: true });
    await createReportRun(reportRoot, "2026010201", {
      schemaVersion: "v0.0.1:schema:definition-1",
      reportType: PRODUCTION_READINESS_REPORT_TYPE,
      runId: "2026010201",
      generatedAt: "2026-01-02T01:00:00.000Z",
      mode: "full",
      overallStatus: "pass",
      summary: { pass: 1, fail: 0, timeout: 0, blockedP0: 0 },
      coverage: {
        required: ["architecture"],
        byRequirement: {},
        missing: []
      },
      gates: [
        {
          id: "architecture",
          title: "Architecture",
          status: "pass"
        }
      ]
    });
    await createReportRun(reportRoot, "2026010301", {
      schemaVersion: "v0.0.1:schema:definition-1",
      reportType: PRODUCTION_READINESS_REPORT_TYPE,
      runId: "2026010301",
      generatedAt: "2026-01-03T01:00:00.000Z",
      mode: "quick",
      overallStatus: "partial",
      summary: { pass: 0, fail: 1, timeout: 0, blockedP0: 0 },
      coverage: {
        required: ["runtime"],
        byRequirement: {},
        missing: ["runtime"]
      },
      gates: [
        {
          id: "sample-business-pack",
          title: "Sample pack",
          status: "warning"
        }
      ]
    });

    const result = await readProductionReadinessReports({
      repoRoot,
      reportRoot
    });

    expect(result.reportRoot).toBe(path.relative(repoRoot, reportRoot));
    expect(result.absoluteReportRoot).toBe(reportRoot);
    expect(result.reports).toHaveLength(2);
    expect(result.reports[0].runId).toBe("2026010301");
    expect(result.reports[1].runId).toBe("2026010201");
  });

  it("surfaces malformed report files as failed read entries", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pact-report-reader-bad-"));
    tempRoots.push(repoRoot);
    const reportRoot = path.join(repoRoot, "reports", "bad-readiness");

    await fs.mkdir(reportRoot, { recursive: true });
    await fs.mkdir(path.join(reportRoot, "bad-run"), { recursive: true });
    await fs.writeFile(path.join(reportRoot, "bad-run", "report.json"), "not-json", "utf8");

    const result = await readProductionReadinessReports({ repoRoot, reportRoot });

    expect(result.reports).toHaveLength(1);
    expect(result.reports[0]).toMatchObject({
      runId: "bad-run",
      overallStatus: "fail",
      summary: { fail: 1, blockedP0: 1 }
    });
    expect(result.reports[0].readError).toContain("Unexpected token");
  });

  it("builds production health view from latest non-quick report", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pact-production-health-"));
    tempRoots.push(repoRoot);
    const reportRoot = path.join(repoRoot, "docs", "reports", "history", "production-readiness");

    await fs.mkdir(reportRoot, { recursive: true });
    await createReportRun(reportRoot, "quick", {
      schemaVersion: "v0.0.1:schema:definition-1",
      reportType: PRODUCTION_READINESS_REPORT_TYPE,
      runId: "quick",
      generatedAt: "2026-01-04T00:00:00.000Z",
      mode: "quick",
      overallStatus: "pass",
      summary: { pass: 4, fail: 0, timeout: 0, blockedP0: 0 },
      coverage: {
        required: ["architecture", "runtime"],
        byRequirement: {},
        missing: ["runtime"]
      },
      gates: [{ id: "architecture", title: "Architecture", status: "pass" }]
    });

    await createReportRun(reportRoot, "full", {
      schemaVersion: "v0.0.1:schema:definition-1",
      reportType: PRODUCTION_READINESS_REPORT_TYPE,
      runId: "full",
      generatedAt: "2026-01-04T01:00:00.000Z",
      mode: "full",
      overallStatus: "fail",
      summary: { pass: 2, fail: 1, timeout: 0, blockedP0: 0 },
      coverage: {
        required: ["architecture", "runtime"],
        byRequirement: {},
        missing: ["runtime"]
      },
      gates: [
        { id: "architecture", title: "Architecture", status: "pass" },
        { id: "trace-observability", title: "Trace", status: "timeout" }
      ]
    });

    const health = await buildProductionHealthReport({
      repoRoot,
      reportRoot
    });

    expect(health.reportType).toBe(PRODUCTION_HEALTH_REPORT_TYPE);
    expect(health.status).toBe("fail");
    expect(health.tone).toBe("danger");
    expect(health.latestReport.runId).toBe("full");
    expect(health.latestReport.reportPath).toContain("full");
    expect(health.coverage.required).toEqual(["architecture", "runtime"]);
    expect(health.sections.find((item) => item.id === "readiness")).toMatchObject({
      status: "partial",
      missingGateIds: ["document-parsing-real-sample", "ui-smoke", "offline-license"]
    });
  });

  it("returns missing-health payload when no reports exist", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pact-production-health-missing-"));
    tempRoots.push(repoRoot);
    const reportRoot = path.join(repoRoot, "docs", "reports", "history", "production-readiness");

    const health = await buildProductionHealthReport({
      repoRoot,
      reportRoot
    });

    expect(health.status).toBe("missing");
    expect(health.tone).toBe("warning");
    expect(health.latestReport).toBeNull();
    expect(health.capabilityKernel.status).toBe("healthy");
    expect(health.capabilityBindingGuard.status).toBe("healthy");
  });
});
