import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMaintenanceToolRegistry } from "../../../server/services/agent/maintenance-agent/tool-registry.mjs";

const dispatchOperation = vi.hoisted(() => vi.fn());
const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));
const createTraceContext = vi.hoisted(() => vi.fn(() => ({
  traceId: "trace-unit-test",
  actor: {
    userId: "unit",
    username: "unit",
    roleId: "unit",
  },
})));
const summarizeError = vi.hoisted(() => vi.fn((error) => error?.message || String(error)));

beforeEach(() => {
  dispatchOperation.mockReset();
  createTraceContext.mockClear();
  summarizeError.mockClear();
  loggerMock.info.mockClear();
  loggerMock.warn.mockClear();
  loggerMock.error.mockClear();
  loggerMock.debug.mockClear();
});

vi.mock("../../../server/platform/interactive/product-api.mjs", async () => {
  const actual = await vi.importActual("../../../server/platform/interactive/product-api.mjs");
  return {
    ...actual,
    dispatchOperation,
    createTraceContext,
    getRuntimeLogger: vi.fn(() => loggerMock),
    setTraceContextOnRequest: vi.fn(),
    summarizeError,
  };
});

describe("maintenance tool registry", () => {
  it("registers maintenance tools and exposes normalized tool descriptors", () => {
    const registry = createMaintenanceToolRegistry({
      getControllers: () => ({})
    });

    const tools = registry.listTools();
    expect(tools.find((tool) => tool.id === "system.health")).toMatchObject({
      id: "system.health",
      risk: "read_only",
      timeoutMs: 5000,
      redaction: "default",
    });
    expect(registry.hasTool("system.health")).toBe(true);
    expect(registry.getTool("jobs.list").scopes).toContain("jobs:read");
    expect(tools.find((tool) => tool.id === "knowledge.reindex").timeoutMs).toBe(300000);
  });

  it("rejects unknown maintenance tool names", () => {
    const registry = createMaintenanceToolRegistry({
      getControllers: () => ({})
    });

    return expect(registry.runTool("unknown.tool", {}, {})).rejects.toThrow("维护工具不存在：unknown.tool");
  });

  it("runs maintenance tool and parses JSON payload from successful response", async () => {
    dispatchOperation.mockImplementation(async ({ response }) => {
      response.writeHead(200);
      response.write("{\"result\":\"ok\"}");
      response.end();
    });

    const registry = createMaintenanceToolRegistry({
      getControllers: () => ({
        __name: "mock-controllers"
      }),
    });

    const payload = await registry.runTool("jobs.list", { limit: 20 }, { approved: false });
    const call = dispatchOperation.mock.calls[0]?.[0];

    expect(payload).toBe("ok");
    expect(call.operation.id).toBe("jobs.list");
    expect(call.request.method).toBe("GET");
    expect(call.request.url).toBe("/api/jobs");
    expect(call.url.searchParams.get("limit")).toBe("20");
    expect(call.input.limit).toBe(20);
    expect(call.request.headers).toEqual({});
  });

  it("adds confirm headers for repair_write tools when approved", async () => {
    dispatchOperation.mockImplementation(async ({ response }) => {
      response.writeHead(200);
      response.write(JSON.stringify({ result: { status: "ok" } }));
      response.end();
    });

    const registry = createMaintenanceToolRegistry({
      getControllers: () => ({})
    });

    await registry.runTool("knowledge.reindex", { confirm: false }, { approved: true });
    const call = dispatchOperation.mock.calls[0]?.[0];

    expect(call.request.headers).toMatchObject({
      "x-pact-safety-confirm": "true",
      "x-pact-confirm": "true",
    });
    expect(call.input).toMatchObject({
      confirm: true,
      safetyConfirm: true,
    });
  });

  it("builds POST based tool calls with json body", async () => {
    dispatchOperation.mockImplementation(async ({ response }) => {
      response.writeHead(200);
      response.write(JSON.stringify({ result: { ok: true } }));
      response.end();
    });

    const registry = createMaintenanceToolRegistry({
      getControllers: () => ({})
    });

    await registry.runTool("knowledge.reindex", { taskType: "validate", force: true }, { approved: true });
    const call = dispatchOperation.mock.calls[0]?.[0];

    expect(call.request.method).toBe("POST");
    expect(call.url.pathname).toBe("/api/knowledge/reindex");
    expect(call.requestBody.toString("utf8")).toContain("\"taskType\":\"validate\"");
    expect(call.requestBody.toString("utf8")).toContain("\"confirm\":true");
  });

  it("raises validation errors for missing controllers or dispatch failure", async () => {
    const missingControllers = createMaintenanceToolRegistry({
      getControllers: () => null
    });
    await expect(missingControllers.runTool("jobs.list", {}, {})).rejects.toThrow(
      "维护工具无法取得 Operation controllers。"
    );

    const badTool = createMaintenanceToolRegistry({
      getControllers: () => ({})
    });
    dispatchOperation.mockImplementation(async ({ response }) => {
      response.writeHead(500);
      response.write("service down");
      response.end();
    });

    await expect(badTool.runTool("jobs.list", {}, {})).rejects.toThrow("维护工具失败：jobs.list");
  });

  it("rethrows dispatch exceptions and emits error log", async () => {
    dispatchOperation.mockRejectedValueOnce(new Error("dispatch failed"));

    const registry = createMaintenanceToolRegistry({
      getControllers: () => ({}),
    });

    await expect(registry.runTool("jobs.list", {}, {})).rejects.toThrow("dispatch failed");

    expect(loggerMock.error).toHaveBeenCalledWith("maintenance.agent.tool.dispatch_failed", expect.objectContaining({
      toolId: "jobs.list",
      operationId: "jobs.list",
      error: "dispatch failed",
    }));
  });

  it("returns raw text when success response is not JSON", async () => {
    dispatchOperation.mockImplementation(async ({ response }) => {
      response.writeHead(200);
      response.write("raw text");
      response.end();
    });

    const registry = createMaintenanceToolRegistry({
      getControllers: () => ({})
    });
    const payload = await registry.runTool("jobs.list", {}, {});

    expect(payload).toEqual({ text: "raw text" });
  });

  it("handles empty success bodies, response headers, and operation timeouts", async () => {
    dispatchOperation.mockImplementationOnce(async ({ response }) => {
      response.writeHead(204);
      response.setHeader("x-unit", "ok");
      expect(response.getHeader("X-UNIT")).toBe("ok");
      response.write(null);
      response.end();
    });

    const registry = createMaintenanceToolRegistry({
      getControllers: () => ({})
    });
    await expect(registry.runTool("jobs.list", {}, {})).resolves.toEqual({});

    vi.useFakeTimers();
    dispatchOperation.mockImplementationOnce(() => new Promise(() => {}));
    const timeoutRun = registry.runTool("system.health", {}, {});
    const timeoutExpectation = expect(timeoutRun).rejects.toThrow("维护工具超时：system.health");
    await vi.advanceTimersByTimeAsync(5001);
    await timeoutExpectation;
    vi.useRealTimers();
  });
});
