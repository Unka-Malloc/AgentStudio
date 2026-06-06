import { describe, expect, it } from "vitest";
import {
  createAcpSessionUpdateParams,
  createAcpTextPromptBlocks,
  extractAcpPromptText,
  normalizeAcpStopReason
} from "../../../server/platform/common/protocols/acp/content.mjs";
import {
  assertJsonRpcMessage,
  createError,
  createNotification,
  createRequest,
  createSuccess,
  parseJsonRpcFrame,
  parseJsonRpcMessage
} from "../../../server/platform/common/protocols/acp/json-rpc.mjs";

describe("ACP common content final extra coverage", () => {
  it("extracts text from nested prompt blocks and creates ACP text blocks only when non-empty", () => {
    expect(extractAcpPromptText({
      prompt: [
        " alpha ",
        { content: "beta" },
        { value: "gamma" },
        { ignored: true },
        ""
      ]
    })).toBe("alpha \nbeta\ngamma");
    expect(extractAcpPromptText({
      prompt: {
        content: [
          { text: "nested one" },
          { value: "nested two" }
        ]
      }
    })).toBe("nested one\nnested two");
    expect(extractAcpPromptText({ message: "fallback message" })).toBe("fallback message");
    expect(createAcpTextPromptBlocks("")).toEqual([]);
    expect(createAcpTextPromptBlocks({ text: "block text" })).toEqual([{ type: "text", text: "block text" }]);
  });

  it("normalizes stop reasons and builds text or non-text session update payloads", () => {
    expect(normalizeAcpStopReason("completed")).toBe("end_turn");
    expect(normalizeAcpStopReason({ reasonCode: "approval_pending" })).toBe("wait_for_permission");
    expect(normalizeAcpStopReason({ type: "target_error" })).toBe("refusal");
    expect(normalizeAcpStopReason("canceled")).toBe("cancelled");
    expect(normalizeAcpStopReason("custom")).toBe("custom");

    expect(createAcpSessionUpdateParams({
      sessionId: "s-1",
      turnId: "t-1",
      eventId: "e-1",
      sequence: "3",
      source: "unit",
      payload: {
        outputSummary: "hello",
        phase: "running",
        type: "delta"
      }
    })).toMatchObject({
      sessionId: "s-1",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "hello" },
        text: "hello",
        status: "running",
        _meta: {
          pact: {
            relaySessionId: "s-1",
            turnId: "t-1",
            eventId: "e-1",
            sequence: 3,
            source: "unit",
            phase: "running",
            type: "delta"
          }
        }
      }
    });

    expect(createAcpSessionUpdateParams({
      relaySessionId: "relay-1",
      kind: "tool_call",
      payload: {
        stopReason: { reason: "approval_denied" }
      }
    })).toMatchObject({
      sessionId: "relay-1",
      update: {
        sessionUpdate: "tool_call",
        status: "approval_denied",
        _meta: {
          pact: {
            relaySessionId: "relay-1",
            source: "target",
            phase: "approval_denied",
            type: "tool_call"
          }
        }
      }
    });
  });
});

describe("ACP common JSON-RPC final extra coverage", () => {
  it("creates requests, notifications, success, and error envelopes with id validation", () => {
    expect(createRequest("session/new", { cwd: "/tmp" }, "req-1")).toEqual({
      jsonrpc: "2.0",
      id: "req-1",
      method: "session/new",
      params: { cwd: "/tmp" }
    });
    expect(createRequest("session/next")).toMatchObject({
      jsonrpc: "2.0",
      method: "session/next"
    });
    expect(createNotification("session/cancel")).toEqual({
      jsonrpc: "2.0",
      method: "session/cancel"
    });
    expect(createSuccess(null, { ok: true })).toEqual({
      jsonrpc: "2.0",
      id: null,
      result: { ok: true }
    });
    expect(createError("req-2", -32000, "failed", { code: "boom" })).toEqual({
      jsonrpc: "2.0",
      id: "req-2",
      error: {
        code: -32000,
        message: "failed",
        data: { code: "boom" }
      }
    });

    expect(() => createRequest("", {})).toThrow("JSON-RPC method must be a non-empty string.");
    expect(() => createRequest("ok", {}, { bad: true })).toThrow("JSON-RPC request id must be string");
  });

  it("validates and parses message, response, and batch frame edge cases", () => {
    expect(parseJsonRpcMessage(JSON.stringify({
      jsonrpc: "2.0",
      method: "session/new",
      id: null
    }))).toMatchObject({ method: "session/new", id: null });
    const batch = [{ jsonrpc: "2.0", method: "session/new" }];
    expect(parseJsonRpcFrame(JSON.stringify(batch))).toEqual(batch);

    expect(() => assertJsonRpcMessage(null)).toThrow("JSON-RPC message must be an object.");
    expect(() => assertJsonRpcMessage({ jsonrpc: "1.0", method: "x" })).toThrow("Unsupported or missing jsonrpc version.");
    expect(() => assertJsonRpcMessage({ jsonrpc: "2.0", method: "" })).toThrow("JSON-RPC method must be a non-empty string.");
    expect(() => assertJsonRpcMessage({ jsonrpc: "2.0", method: "x", id: {} })).toThrow("JSON-RPC request id must be string");
    expect(() => assertJsonRpcMessage({ jsonrpc: "2.0", result: true })).toThrow("Response message must have id.");
    expect(() => assertJsonRpcMessage({ jsonrpc: "2.0", id: 1, result: true, error: {} })).toThrow("cannot contain both result and error");
    expect(() => assertJsonRpcMessage({ jsonrpc: "2.0", id: 1, error: null })).toThrow("RPC error must be an object.");
    expect(() => assertJsonRpcMessage({ jsonrpc: "2.0", id: 1, error: { code: "x", message: "bad" } })).toThrow("RPC error code must be a number.");
    expect(() => assertJsonRpcMessage({ jsonrpc: "2.0", id: 1, error: { code: -1, message: "" } })).toThrow("RPC error message must be a string.");
    expect(() => assertJsonRpcMessage({ jsonrpc: "2.0", id: 1 })).toThrow("Unknown or incomplete JSON-RPC message.");
  });
});
