import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createOperationAuditStore,
  redactOperationAuditValue,
} from "../../../server/platform/common/security/operation-audit.mjs";

let tempRoot;
let openStores;

async function makeTempRoot() {
  return await fs.mkdtemp(path.join(os.tmpdir(), "pact-operation-audit-"));
}

function trackStore(store) {
  openStores.push(store);
  return store;
}

beforeEach(async () => {
  tempRoot = await makeTempRoot();
  openStores = [];
});

afterEach(async () => {
  for (const store of openStores.splice(0)) {
    store.close();
  }
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (tempRoot) {
    await fs.rm(tempRoot, { force: true, maxRetries: 5, recursive: true, retryDelay: 50 });
  }
});

describe("operation audit extra coverage", () => {
  it("redacts secrets, absolute paths, buffers, deep objects, and oversize payloads", () => {
    const redacted = redactOperationAuditValue({
      password: "super-secret",
      nested: {
        apiKey: "sk-secret-value",
        authHeader: "Bearer token-value",
        file: "/Users/example/project/private.txt",
      },
      list: ["token=abc123", "C:\\Users\\alice\\secret.txt"],
      raw: Buffer.from("binary secret"),
    });

    expect(redacted).toMatchObject({
      password: "<redacted>",
      nested: {
        apiKey: "<redacted>",
        authHeader: "<redacted-secret>",
        file: "<redacted-path>",
      },
      list: ["token=<redacted>", "<redacted-path>"],
      raw: {
        redacted: true,
        reason: "buffer",
        byteLength: 13,
      },
    });
    expect(redacted.raw.sha256).toMatch(/^[a-f0-9]{64}$/);

    let deep = { value: "leaf" };
    for (let index = 0; index < 10; index += 1) {
      deep = { child: deep };
    }
    expect(JSON.stringify(redactOperationAuditValue(deep))).toContain("<redacted-depth>");

    const large = redactOperationAuditValue({ payload: "x".repeat(13 * 1024) });
    expect(large).toMatchObject({
      redacted: true,
      reason: "payload_too_large",
    });
    expect(large.byteLength).toBeGreaterThan(12 * 1024);
    expect(large.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("appends and lists redacted audit records with filters", () => {
    const store = trackStore(createOperationAuditStore({ userDataPath: tempRoot }));
    const first = store.append({
      auditId: "audit-1",
      actor: {
        userId: "user-a",
        username: "Ada",
        roleId: "admin",
        tenantId: "tenant-from-actor",
        teamIds: ["team-a"],
      },
      createdAt: "2026-06-01T10:00:00.000Z",
      durationMs: -5,
      error: "failed at /Users/example/private/path.txt",
      input: {
        password: "plain",
        path: "/tmp/pact/private/input.json",
        tenantId: "tenant-from-input",
      },
      operationId: "knowledge.word_cloud.propose",
      output: {
        items: [1, 2, 3],
        nested: { a: 1, b: 2 },
        token: "secret",
      },
      readOnly: true,
      requestId: "request-1",
      risk: "high",
      status: "failed",
      tenantId: "tenant-explicit",
      traceId: "trace-a",
      transport: "http",
    });
    store.append({
      auditId: "audit-2",
      actor: {
        userId: "user-b",
        username: "Grace",
      },
      createdAt: "2026-06-02T10:00:00.000Z",
      input: { tenantId: "tenant-b" },
      operationId: "storage.backups.list",
      output: ["a", "b"],
      status: "ok",
      traceId: "trace-b",
    });

    expect(first).toEqual({ auditId: "audit-1" });

    const failedEntries = store.list({
      createdFrom: "2026-06-01T00:00:00.000Z",
      createdTo: "2026-06-01T23:59:59.999Z",
      operationId: "knowledge.word_cloud.propose",
      status: "failed",
      tenantId: "tenant-explicit",
      traceId: "trace-a",
      userId: "user-a",
    });

    expect(failedEntries).toHaveLength(1);
    expect(failedEntries[0]).toMatchObject({
      actor: {
        roleId: "admin",
        teamIds: ["team-a"],
        tenantId: "tenant-from-actor",
        type: "console-user",
        userId: "user-a",
        username: "Ada",
      },
      auditId: "audit-1",
      durationMs: 0,
      error: "failed at <redacted-path>",
      operationId: "knowledge.word_cloud.propose",
      readOnly: true,
      redactedInput: {
        password: "<redacted>",
        path: "<redacted-path>",
        tenantId: "tenant-from-input",
      },
      redactedOutputSummary: {
        items: { type: "array", length: 3 },
        nested: { type: "object", keys: ["a", "b"] },
        token: "<redacted>",
      },
      requestId: "request-1",
      risk: "high",
      status: "failed",
      tenantId: "tenant-explicit",
      traceId: "trace-a",
      transport: "http",
    });
    expect(failedEntries[0].inputHash).toMatch(/^[a-f0-9]{64}$/);
    expect(store.list({ userId: "missing" })).toEqual([]);
    expect(store.list({ limit: 9999 })).toHaveLength(2);
  });

  it("exports trace drilldowns and manages retention policy with pruning", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-04T00:00:00.000Z"));
    const store = trackStore(createOperationAuditStore({ userDataPath: tempRoot }));

    expect(store.getRetentionPolicy()).toMatchObject({
      policyVersion: "v0.0.1:platform:audit-retention-1",
      retentionDays: 90,
      maxExportItems: 1000,
      updatedAt: "",
      updatedBy: {},
    });

    const policy = store.setRetentionPolicy({
      maxExportItems: 20000,
      retentionDays: 99999,
      updatedBy: {
        password: "admin-password",
        userId: "admin-user",
      },
    });
    expect(policy).toMatchObject({
      maxExportItems: 10000,
      retentionDays: 3650,
      updatedBy: {
        password: "<redacted>",
        userId: "admin-user",
      },
    });
    expect(store.getRetentionPolicy()).toMatchObject(policy);

    store.append({
      auditId: "audit-old",
      actor: { userId: "user-a", tenantId: "tenant-a" },
      createdAt: "2026-05-01T00:00:00.000Z",
      input: { apiKey: "sk-old" },
      operationId: "operation.old",
      status: "ok",
      traceId: "trace-a",
    });
    store.append({
      auditId: "audit-new-1",
      actor: { userId: "user-a", tenantId: "tenant-a" },
      createdAt: "2026-06-03T00:00:00.000Z",
      input: { filter: "token=abc" },
      operationId: "operation.new",
      status: "ok",
      traceId: "trace-a",
    });
    store.append({
      auditId: "audit-new-2",
      actor: { userId: "user-a", tenantId: "tenant-a" },
      createdAt: "2026-06-03T00:00:01.000Z",
      input: { nested: { path: "/var/private/file.txt" } },
      operationId: "operation.new",
      status: "failed",
      traceId: "trace-a",
    });

    const trace = store.getTrace("trace-a", { limit: 10 });
    expect(trace).toMatchObject({
      protocolVersion: "v0.0.1:platform:trace-drilldown-1",
      traceId: "trace-a",
      count: 3,
    });
    expect(trace.auditItems.map((item) => item.auditId)).toEqual(["audit-old", "audit-new-1", "audit-new-2"]);
    expect(trace.spans[0]).toMatchObject({
      auditId: "audit-old",
      operationId: "operation.old",
      status: "ok",
    });
    expect(store.getTrace("", {})).toMatchObject({
      auditItems: [],
      count: 0,
      protocolVersion: "v0.0.1:platform:trace-drilldown-1",
      spans: [],
      traceId: "",
    });

    const exported = store.exportRedacted({
      limit: 2,
      operationId: "operation.new",
      status: "failed",
      traceId: "trace-a",
      userId: "user-a",
    });
    expect(exported.manifest).toMatchObject({
      protocolVersion: "v0.0.1:platform:audit-export-1",
      redactionPolicy: "operation-audit-redacted-v1",
      itemCount: 1,
      filters: {
        operationId: "operation.new",
        status: "failed",
        traceId: "trace-a",
        userId: "user-a",
      },
    });
    expect(exported.items).toHaveLength(1);
    expect(exported.items[0]).toMatchObject({
      auditId: "audit-new-2",
      redactedInput: {
        nested: {
          path: "<redacted-path>",
        },
      },
    });
    expect(exported.jsonl.trim().split("\n").map((line) => JSON.parse(line).type)).toEqual(["manifest", "audit"]);

    const pruneResult = store.pruneExpired({ retentionDays: 2 });
    expect(pruneResult).toMatchObject({
      policyVersion: "v0.0.1:platform:audit-retention-1",
      retentionDays: 2,
      deletedCount: 1,
    });
    expect(store.list({ limit: 10 }).map((item) => item.auditId).sort()).toEqual(["audit-new-1", "audit-new-2"]);
  });
});
