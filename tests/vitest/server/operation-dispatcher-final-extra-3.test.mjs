import { describe, expect, it, vi } from "vitest";
import {
  dispatchInternalOperation,
  dispatchOperation,
  dispatchRpcOperation,
  shouldProxyRegisteredApiRequest
} from "../../../server/platform/common/operation-dispatcher/operation-dispatcher.mjs";

function createResponse() {
  return {
    statusCode: 0,
    headers: {},
    chunks: [],
    writeHead(statusCode, headers = {}) {
      this.statusCode = statusCode;
      this.headers = { ...this.headers, ...headers };
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
    getHeader(name) {
      const lowerName = String(name || "").toLowerCase();
      const entry = Object.entries(this.headers).find(([headerName]) => headerName.toLowerCase() === lowerName);
      return entry?.[1];
    },
    write(chunk) {
      if (chunk !== undefined && chunk !== null) {
        this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      }
    },
    end(chunk) {
      this.write(chunk);
      this.ended = true;
    },
    json() {
      return JSON.parse(Buffer.concat(this.chunks).toString("utf8") || "{}");
    },
    text() {
      return Buffer.concat(this.chunks).toString("utf8");
    }
  };
}

function baseOperation(overrides = {}) {
  return {
    id: "unit.dispatch",
    target: { controller: "unit", method: "handle" },
    http: { method: "POST", path: "/api/unit/dispatch" },
    concurrencySafe: true,
    readOnly: true,
    safety: { risk: "read_only" },
    audit: { enabled: false },
    log: { recordInput: false },
    inputSchema: { type: "object", properties: {} },
    ...overrides
  };
}

function controllers(handler) {
  return {
    unit: {
      handle: handler
    }
  };
}

describe("operation dispatcher final extra coverage", () => {
  it("covers validation, empty parsing, malformed parsing, and proxy edge branches", async () => {
    await expect(dispatchOperation({})).rejects.toThrow("dispatchOperation requires an operation.");

    expect(shouldProxyRegisteredApiRequest({
      pathname: "/console",
      discoveryState: { mode: "forward", forwardBaseUrl: "https://upstream.local" },
      operations: []
    })).toBe(false);

    const okResponse = createResponse();
    await expect(dispatchOperation({
      operation: baseOperation({ inputSchema: { type: "string" } }),
      controllers: controllers(({ response }) => {
        response.writeHead(204, {});
        response.end();
      }),
      request: {},
      response: okResponse,
      requestBody: Buffer.alloc(0),
      url: new URL("http://127.0.0.1/api/unit/dispatch"),
      logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() }
    })).resolves.toMatchObject({ ok: true, statusCode: 204 });

    const arrayResponse = createResponse();
    await expect(dispatchOperation({
      operation: baseOperation(),
      controllers: controllers(() => {}),
      request: {},
      response: arrayResponse,
      input: [],
      url: new URL("http://127.0.0.1/api/unit/dispatch"),
      logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() }
    })).resolves.toMatchObject({ ok: false, statusCode: 400 });
    expect(arrayResponse.json().error).toContain("requires object input");

    const typeResponse = createResponse();
    await expect(dispatchOperation({
      operation: baseOperation({
        inputSchema: {
          type: "object",
          properties: { count: { type: "number" } }
        }
      }),
      controllers: controllers(() => {}),
      request: {},
      response: typeResponse,
      input: { count: "3" },
      url: new URL("http://127.0.0.1/api/unit/dispatch"),
      logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() }
    })).resolves.toMatchObject({ ok: false, statusCode: 400 });
    expect(typeResponse.json().error).toContain("count must be number");

    for (const requestBody of ["   ", "{not-json", { direct: true }]) {
      const response = createResponse();
      await expect(dispatchOperation({
        operation: baseOperation(),
        controllers: controllers(({ response: innerResponse }) => {
          innerResponse.writeHead(200, { "Content-Type": "application/json" });
          innerResponse.end(JSON.stringify({ ok: true }));
        }),
        request: {},
        response,
        requestBody,
        url: new URL("http://127.0.0.1/api/unit/dispatch"),
        logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() }
      })).resolves.toMatchObject({ ok: true });
    }
  });

  it("captures internal text and binary responses with case-insensitive headers", async () => {
    const textOperation = baseOperation({
      id: "unit.internal.text",
      http: { method: "POST", path: "/api/unit/text" }
    });
    const textResult = await dispatchInternalOperation({
      operations: [textOperation],
      operationId: textOperation.id,
      controllers: controllers(({ response }) => {
        response.setHeader("Content-Type", "text/plain; charset=utf-8");
        expect(response.getHeader("content-type")).toBe("text/plain; charset=utf-8");
        response.end("hello");
      }),
      input: { ignored: true },
      logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() }
    });
    expect(textResult.payload).toEqual({
      contentType: "text/plain; charset=utf-8",
      text: "hello"
    });

    const binaryOperation = baseOperation({
      id: "unit.internal.binary",
      http: { method: "POST", path: "/api/unit/binary" },
      binary: true
    });
    const binaryResult = await dispatchInternalOperation({
      operations: [binaryOperation],
      operationId: binaryOperation.id,
      controllers: controllers(({ response }) => {
        response.writeHead(206, { "Content-Type": "application/octet-stream" });
        response.write(Buffer.from([1, 2, 3]));
      }),
      input: {},
      logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() }
    });
    expect(binaryResult.statusCode).toBe(206);
    expect(binaryResult.payload).toMatchObject({
      contentType: "application/octet-stream",
      byteLength: 3,
      base64: "AQID"
    });
  });

  it("maps RPC body encodings, URL params, query aliases, and error responses", async () => {
    const observations = [];
    const operation = baseOperation({
      id: "unit.rpc.echo",
      http: { method: "POST", path: "/api/rpc/echo" },
      rpc: {
        method: "unit.rpc.echo",
        syntheticPath: "/api/rpc/:id/:missing",
        params: [{ name: "id", aliases: ["itemId"], type: "string" }],
        query: [{ name: "tag", aliases: ["tags"] }, { name: "empty" }]
      }
    });
    const rpcControllers = controllers(({ requestBody, url, response }) => {
      observations.push({
        body: requestBody.toString("utf8"),
        pathname: url.pathname,
        tags: url.searchParams.getAll("tag")
      });
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(observations.at(-1)));
    });

    const encodedResponse = createResponse();
    await dispatchRpcOperation({
      operations: [operation],
      controllers: rpcControllers,
      request: {},
      response: encodedResponse,
      requestBody: Buffer.from(JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "unit.rpc.echo",
        params: {
          itemId: "space value",
          bodyBase64: Buffer.from("from-base64").toString("base64"),
          tags: ["a", "b"]
        }
      })),
      logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() }
    });
    expect(encodedResponse.json().result).toMatchObject({
      body: "from-base64",
      pathname: "/api/rpc/space%20value/:missing",
      tags: ["a", "b"]
    });

    for (const params of [
      { itemId: "body-text", bodyText: "from-text" },
      { itemId: "body-string", body: "from-string" },
      { itemId: "empty-body" }
    ]) {
      const response = createResponse();
      await dispatchRpcOperation({
        operations: [operation],
        controllers: rpcControllers,
        request: {},
        response,
        requestBody: Buffer.from(JSON.stringify({
          jsonrpc: "2.0",
          id: params.itemId,
          method: "unit.rpc.echo",
          params
        })),
        logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() }
      });
      expect(response.statusCode).toBe(200);
    }
    expect(observations.map((item) => item.body)).toEqual([
      "from-base64",
      "from-text",
      "from-string",
      ""
    ]);

    const failingOperation = baseOperation({
      id: "unit.rpc.failing",
      http: { method: "POST", path: "/api/rpc/failing" },
      rpc: { method: "unit.rpc.failing" }
    });
    const failedResponse = createResponse();
    await dispatchRpcOperation({
      operations: [failingOperation],
      controllers: controllers(({ response }) => {
        response.writeHead(422, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: "bad rpc input", detail: true }));
      }),
      request: {},
      response: failedResponse,
      requestBody: Buffer.from(JSON.stringify({
        jsonrpc: "2.0",
        id: 99,
        method: "unit.rpc.failing",
        params: {}
      })),
      logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() }
    });
    expect(failedResponse.json().error).toMatchObject({
      code: 422,
      message: "bad rpc input"
    });

    const requiredOperation = baseOperation({
      id: "unit.rpc.required",
      http: { method: "POST", path: "/api/rpc/required" },
      rpc: {
        method: "unit.rpc.required",
        params: [{ name: "id", required: true }]
      }
    });
    const requiredResponse = createResponse();
    await dispatchRpcOperation({
      operations: [requiredOperation],
      controllers: controllers(() => {}),
      request: {},
      response: requiredResponse,
      requestBody: Buffer.from(JSON.stringify({
        jsonrpc: "2.0",
        id: "missing",
        method: "unit.rpc.required",
        params: {}
      })),
      logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() }
    });
    expect(requiredResponse.json().error.code).toBe(500);
  });
});
