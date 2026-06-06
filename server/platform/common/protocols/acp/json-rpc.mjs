const JSON_RPC_VERSION = "2.0";
const DEFAULT_ERROR_CODE = -32603;

let requestId = 1;

function nextRequestId() {
  return requestId++;
}

function normalizeId(id) {
  if (id === undefined || id === null) {
    return nextRequestId();
  }
  if (typeof id === "string" || typeof id === "number" || typeof id === "bigint") {
    return id;
  }
  throw new TypeError("JSON-RPC request id must be string, number, bigint, or null.");
}

function ensureMethod(method) {
  if (typeof method !== "string" || !method.trim()) {
    throw new TypeError("JSON-RPC method must be a non-empty string.");
  }
  return method;
}

export function createRequest(method, params = undefined, id = nextRequestId()) {
  return {
    jsonrpc: JSON_RPC_VERSION,
    id: normalizeId(id),
    method: ensureMethod(method),
    ...(params !== undefined ? { params } : {})
  };
}

export function createNotification(method, params = undefined) {
  return {
    jsonrpc: JSON_RPC_VERSION,
    method: ensureMethod(method),
    ...(params !== undefined ? { params } : {})
  };
}

export function createSuccess(id, result = undefined) {
  return {
    jsonrpc: JSON_RPC_VERSION,
    id,
    result
  };
}

export function createError(id, code = DEFAULT_ERROR_CODE, message = "RPC error", data = undefined) {
  return {
    jsonrpc: JSON_RPC_VERSION,
    id,
    error: {
      code,
      message,
      ...(data !== undefined ? { data } : {})
    }
  };
}

function assertJsonRpcResponse(payload) {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TypeError("Invalid JSON-RPC envelope.");
  }
  if (payload.jsonrpc !== JSON_RPC_VERSION) {
    throw new Error("Unsupported or missing jsonrpc version.");
  }
  const hasResult = Object.hasOwn(payload, "result");
  const hasError = Object.hasOwn(payload, "error");
  if (hasResult && hasError) {
    throw new Error("A JSON-RPC message cannot contain both result and error.");
  }
}

export function assertJsonRpcMessage(raw) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new TypeError("JSON-RPC message must be an object.");
  }
  if (raw.jsonrpc !== JSON_RPC_VERSION) {
    throw new Error("Unsupported or missing jsonrpc version.");
  }

  if (typeof raw.method === "string") {
    if (raw.method.trim() === "") {
      throw new TypeError("JSON-RPC method must be a non-empty string.");
    }
    if (Object.hasOwn(raw, "id") && raw.id !== null) {
      const idType = typeof raw.id;
      if (idType !== "string" && idType !== "number" && idType !== "bigint") {
        throw new TypeError("JSON-RPC request id must be string, number, bigint, or null.");
      }
    }
    return raw;
  }

  if (Object.hasOwn(raw, "result") || Object.hasOwn(raw, "error")) {
    if (!Object.hasOwn(raw, "id")) {
      throw new Error("Response message must have id.");
    }
    assertJsonRpcResponse(raw);
    if (Object.hasOwn(raw, "error")) {
      if (raw.error === null || typeof raw.error !== "object" || Array.isArray(raw.error)) {
        throw new TypeError("RPC error must be an object.");
      }
      if (typeof raw.error.code !== "number") {
        throw new TypeError("RPC error code must be a number.");
      }
      if (typeof raw.error.message !== "string" || !raw.error.message.trim()) {
        throw new TypeError("RPC error message must be a string.");
      }
    }
    return raw;
  }

  throw new Error("Unknown or incomplete JSON-RPC message.");
}

export function parseJsonRpcMessage(payload) {
  const parsed = typeof payload === "string" ? JSON.parse(payload) : payload;
  return assertJsonRpcMessage(parsed);
}

export function parseJsonRpcFrame(payload) {
  const parsed = typeof payload === "string" ? JSON.parse(payload) : payload;
  if (Array.isArray(parsed)) {
    return parsed;
  }
  return assertJsonRpcMessage(parsed);
}
