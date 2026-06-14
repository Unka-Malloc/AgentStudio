import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  createRuntimeLogger,
  getRuntimeLogger,
  logRuntimeEvent,
  setRuntimeLogger,
  summarizeError,
  summarizeForLog
} from "../../../server/platform/common/observability/runtime-logger.mjs";
import { createTraceContext, runWithTraceContext } from "../../../server/platform/common/observability/trace-context.mjs";

const tempRoots = [];

async function makeTempRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pact-runtime-logger-extra-"));
  tempRoots.push(root);
  return root;
}

async function readJsonlRecords(logDir) {
  const entries = await fs.readdir(logDir, { withFileTypes: true }).catch(() => []);
  const files = entries
    .filter((entry) => entry.isFile() && /^pact-.+\.jsonl$/.test(entry.name))
    .map((entry) => path.join(logDir, entry.name))
    .sort();
  const records = [];

  for (const file of files) {
    const text = await fs.readFile(file, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      records.push(JSON.parse(trimmed));
    }
  }

  return { files, records };
}

beforeEach(() => {
  setRuntimeLogger(null);
});

afterEach(async () => {
  setRuntimeLogger(null);
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("runtime logger extra coverage", () => {
  it("writes JSONL records, honors explicit log sinks, and prunes stale files", async () => {
    const userDataPath = await makeTempRoot();
    const logDir = path.join(userDataPath, "custom-logs");
    await fs.mkdir(logDir, { recursive: true });

    const today = new Date().toISOString().slice(0, 10);
    const stalePath = path.join(logDir, "pact-server-2000-01-01.jsonl");
    await fs.writeFile(stalePath, `${JSON.stringify({ event: "stale" })}\n`, "utf8");
    const staleDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    await fs.utimes(stalePath, staleDate, staleDate);

    const occupiedPath = path.join(logDir, `pact-server-${today}.jsonl`);
    await fs.writeFile(
      occupiedPath,
      `${JSON.stringify({ event: "seed", payload: "x".repeat(1024 * 1024 + 32) })}\n`,
      "utf8"
    );

    const logger = createRuntimeLogger({
      userDataPath,
      component: "server",
      retentionDays: "0",
      runtimeOptions: {
        logDir,
        profile: "production",
        logLevel: "not-a-valid-level",
        logMaxFileBytes: 512,
        logMaxTotalBytes: "still-not-valid"
      }
    });

    expect(logger.logDir).toBe(path.resolve(logDir));
    expect(logger.level).toBe("info");
    expect(logger.retentionDays).toBe(1);
    expect(logger.maxFileBytes).toBe(1024 * 1024);
    expect(logger.maxTotalBytes).toBe(2 * 1024 * 1024 * 1024);
    expect(logger.setLevel("banana")).toBe("info");
    expect(logger.actorSummary()).toEqual({
      type: "system",
      userId: "",
      username: "",
      roleId: ""
    });

    const actorSummary = logger.actorSummary({
      user: {
        userId: "user-1",
        username: "Alice Walker",
        roleId: "operator"
      }
    });
    expect(actorSummary).toMatchObject({
      type: "console-user",
      username: "Alice Walker",
      roleId: "operator"
    });
    expect(actorSummary.userId).toMatch(/^[0-9a-f]{16}$/);

    await logger.cleanup({ force: true });
    await expect(fs.access(stalePath)).rejects.toThrow();

    const error = new Error("boom");
    error.code = "E_UNIT";
    error.stack = `Error: boom\n    at test (${path.join(process.cwd(), "server/platform/common/observability/runtime-logger.mjs")}:1:1)`;

    const child = logger.child({
      source: "child-run",
      workspace: path.join(userDataPath, "workspace")
    });

    const record = child.info("runtime.file.sink", {
      requestId: "req-1",
      actor: {
        userId: "user-1",
        username: "Alice Walker",
        roleId: "operator"
      },
      workspace: path.join(userDataPath, "workspace"),
      payload: {
        path: path.join(userDataPath, "payload", "notes.txt"),
        nested: { ok: true }
      },
      secretToken: "super-secret",
      error
    });

    expect(record).toMatchObject({
      level: "info",
      component: "server",
      event: "runtime.file.sink",
      requestId: "req-1"
    });

    await logger.flush();
    await logger.close();

    const { records, files } = await readJsonlRecords(logDir);
    expect(files).toEqual(
      expect.arrayContaining([
        path.join(logDir, `pact-server-${today}.jsonl`),
        path.join(logDir, `pact-server-${today}.1.jsonl`)
      ])
    );

    const stored = records.find((entry) => entry.event === "runtime.file.sink");
    expect(stored).toMatchObject({
      schemaVersion: "v0.0.1:schema:definition-1",
      level: "info",
      component: "server",
      event: "runtime.file.sink",
      requestId: "req-1",
      traceId: ""
    });
    expect(stored.details.source).toMatchObject({
      type: "string",
      preview: "child-run"
    });
    expect(stored.details.workspace).toMatchObject({
      type: "path",
      basename: "workspace"
    });
    expect(stored.details.payload.path).toMatchObject({
      type: "path",
      basename: "notes.txt"
    });
    expect(stored.details.secretToken).toMatchObject({
      redacted: true,
      reason: "sensitive-key"
    });
    expect(stored.details.error).toMatchObject({
      name: "Error",
      message: "boom",
      code: "E_UNIT"
    });
    expect(stored.details.error.stack).toContain("<workspace>");
    expect(stored.details.payload.nested).toMatchObject({ ok: true });
  });

  it("filters debug records by trace, operation, topic, and job ids", async () => {
    const userDataPath = await makeTempRoot();
    const logger = createRuntimeLogger({
      userDataPath,
      component: "server",
      runtimeOptions: {
        profile: "production",
        logLevel: "warn"
      }
    });

    expect(logger.logDir).toBe(path.join(path.resolve(userDataPath), "logs", "runtime"));
    expect(logger.level).toBe("warn");
    expect(logger.setLevel("not-a-real-level")).toBe("warn");
    expect(logger.debug("runtime.blocked", { traceId: "trace-blocked" })).toBeNull();

    logger.enableDebugFilter("traceId", "trace-allowed");
    logger.enableDebugFilter("operationId", "op-1");
    logger.enableDebugFilter("topic", "topic-1");
    logger.enableDebugFilter("jobId", "job-1");

    const traceRecord = await runWithTraceContext(
      createTraceContext({
        traceId: "trace-allowed",
        requestId: "req-allowed",
        spanId: "span-allowed",
        parentSpanId: "parent-allowed",
        operationId: "trace-op"
      }),
      () => logger.debug("runtime.trace.allowed", { topic: "ignored" })
    );
    const operationRecord = logger.debug("runtime.operation.allowed", { operationId: "op-1" });
    const topicRecord = logger.debug("runtime.topic.allowed", { topic: "topic-1" });
    const jobRecord = logger.debug("runtime.job.allowed", { jobId: "job-1" });

    expect(traceRecord).toMatchObject({ event: "runtime.trace.allowed" });
    expect(operationRecord).toMatchObject({ event: "runtime.operation.allowed" });
    expect(topicRecord).toMatchObject({ event: "runtime.topic.allowed" });
    expect(jobRecord).toMatchObject({ event: "runtime.job.allowed" });

    await logger.flush();
    await logger.close();

    const { records } = await readJsonlRecords(logger.logDir);
    expect(records.map((entry) => entry.event)).toEqual([
      "runtime.trace.allowed",
      "runtime.operation.allowed",
      "runtime.topic.allowed",
      "runtime.job.allowed"
    ]);
    expect(records[0]).toMatchObject({
      traceId: "trace-allowed",
      requestId: "req-allowed",
      spanId: "span-allowed",
      parentSpanId: "parent-allowed"
    });
    expect(records[1].details.operationId).toMatchObject({
      type: "string",
      preview: "op-1"
    });
    expect(records[2].details.topic).toMatchObject({
      type: "string",
      preview: "topic-1"
    });
    expect(records[3].details.jobId).toMatchObject({
      type: "string",
      preview: "job-1"
    });

    const sink = {
      info: vi.fn(() => "info-called"),
      warn: vi.fn(),
      error: vi.fn()
    };
    setRuntimeLogger(sink);
    expect(getRuntimeLogger()).toBe(sink);
    expect(logRuntimeEvent("info", "runtime.singleton", { ok: true })).toBe("info-called");
    expect(sink.info).toHaveBeenCalledWith("runtime.singleton", { ok: true });
    expect(logRuntimeEvent("debug", "runtime.missing", {})).toBeNull();
  });

  it("summarizes boundary inputs, redacts paths and secrets, and reports errors", async () => {
    const userDataPath = await makeTempRoot();
    const logger = createRuntimeLogger({
      userDataPath,
      component: "server",
      runtimeOptions: {}
    });

    expect(logger.logDir).toBe(path.join(path.resolve(userDataPath), "logs", "runtime"));

    expect(summarizeForLog(null)).toBeNull();
    expect(summarizeForLog(undefined)).toBeNull();
    expect(summarizeForLog(123n)).toBe("123");
    expect(summarizeForLog(Buffer.from("abc"))).toMatchObject({
      type: "buffer",
      byteLength: 3
    });

    const summarized = summarizeForLog(
      {
        path: "/tmp/runtime/logger.jsonl",
        secretToken: "s3cr3t",
        list: [1, 2, 3, 4],
        deep: {
          one: {
            two: {
              three: "x"
            }
          }
        },
        flag: true,
        extra: "ignored"
      },
      {
        maxDepth: 2,
        maxArrayItems: 2,
        maxObjectKeys: 5
      }
    );

    expect(summarized).toMatchObject({
      path: {
        type: "path",
        basename: "logger.jsonl"
      },
      secretToken: {
        redacted: true,
        reason: "sensitive-key"
      },
      list: {
        type: "array",
        length: 4,
        truncated: true,
        items: [1, 2]
      },
      deep: {
        one: {
          type: "object",
          truncated: true
        }
      },
      flag: true,
      __truncatedKeys: 1
    });

    const error = new Error("line1\nline2");
    error.name = "UnitError";
    error.code = "E_UNIT";
    error.stack = `UnitError: line1\n    at test (${path.join(process.cwd(), "server/platform/common/observability/runtime-logger.mjs")}:10:5)`;

    const summarizedError = summarizeError(error);
    expect(summarizedError).toMatchObject({
      name: "UnitError",
      message: "line1 line2",
      code: "E_UNIT"
    });
    expect(summarizedError.stack).toContain("<workspace>");

    const actorSummary = logger.actorSummary({
      user: {
        userId: "user-123",
        username: "Alice Walker",
        roleId: "operator"
      }
    });
    expect(actorSummary).toMatchObject({
      type: "console-user",
      username: "Alice Walker",
      roleId: "operator"
    });
    expect(actorSummary.userId).toMatch(/^[0-9a-f]{16}$/);
    expect(logger.actorSummary()).toEqual({
      type: "system",
      userId: "",
      username: "",
      roleId: ""
    });

    await logger.close();
  });
});
