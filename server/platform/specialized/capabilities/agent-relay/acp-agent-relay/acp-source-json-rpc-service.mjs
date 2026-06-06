import { once } from "node:events";
import readline from "node:readline";

function asObject(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
}

function encodeFrame(payload) {
  if (Buffer.isBuffer(payload)) {
    return payload.toString("utf8");
  }
  if (payload instanceof Uint8Array) {
    return Buffer.from(payload).toString("utf8");
  }
  return typeof payload === "string" ? payload : JSON.stringify(payload);
}

function isJsonRpcRequestFrame(frame) {
  try {
    const parsed = typeof frame === "string" ? JSON.parse(frame) : frame;
    if (Array.isArray(parsed)) {
      return parsed.some((item) => item && typeof item === "object" && Object.hasOwn(item, "id"));
    }
    return parsed && typeof parsed === "object" && Object.hasOwn(parsed, "id");
  } catch {
    return true;
  }
}

function mergeContext(baseContext = {}, frameContext = {}) {
  return {
    ...asObject(baseContext),
    ...asObject(frameContext),
    sourceIdentity: {
      ...asObject(baseContext.sourceIdentity),
      ...asObject(frameContext.sourceIdentity)
    }
  };
}

export class AcpSourceJsonRpcService {
  constructor({
    runtime = null,
    bridge = null,
    sourceJsonRpcBridge = null,
    context = {},
    contextResolver = null,
    logger = null
  } = {}) {
    this.runtime = runtime;
    this.bridge = bridge || sourceJsonRpcBridge || runtime?.sourceJsonRpcBridge || null;
    this.context = asObject(context);
    this.contextResolver = typeof contextResolver === "function" ? contextResolver : null;
    this.logger = logger;
    this.running = false;
    this.closed = false;
    this.inflight = new Set();
  }

  async handleMessage(message, context = {}) {
    const effectiveContext = await this.resolveContext(message, context);
    if (this.runtime && typeof this.runtime.handleSourceAcpMessage === "function") {
      return this.runtime.handleSourceAcpMessage(message, effectiveContext);
    }
    if (this.bridge && typeof this.bridge.handle === "function") {
      return this.bridge.handle(message, effectiveContext);
    }
    throw new Error("ACP source JSON-RPC service requires a runtime or source JSON-RPC bridge.");
  }

  async handleMessageWithEmitter(message, context = {}, emitSourceNotification = null) {
    return this.handleMessage(message, {
      ...asObject(context),
      emitSourceNotification
    });
  }

  async handleFrame(frame, context = {}) {
    const response = await this.handleMessage(frame, context);
    return response === null || response === undefined ? null : encodeFrame(response);
  }

  async serveTransport(transport, context = {}) {
    const sessionContext = mergeContext(this.context, context);
    if (!transport || typeof transport.receive !== "function" || typeof transport.send !== "function") {
      throw new TypeError("ACP source JSON-RPC transport requires receive() and send() functions.");
    }

    this.running = true;
    this.closed = false;
    try {
      while (!this.closed) {
        const frame = await transport.receive();
        if (frame === null || frame === undefined) {
          break;
        }
        const task = (async () => {
          const response = await this.handleMessageWithEmitter(frame, sessionContext, async (notification) => {
            await transport.send(notification);
          });
          if (response !== null && response !== undefined) {
            await transport.send(encodeFrame(response));
          }
        })().catch(async (error) => {
          if (this.logger && typeof this.logger.error === "function") {
            this.logger.error("ACP source JSON-RPC frame handling failed.", error);
          }
          if (isJsonRpcRequestFrame(frame)) {
            await transport.send(encodeFrame({
              jsonrpc: "2.0",
              id: null,
              error: {
                code: -32603,
                message: error instanceof Error ? error.message : String(error)
              }
            })).catch(() => {});
          }
        }).finally(() => {
          this.inflight.delete(task);
        });
        this.inflight.add(task);
        if (!isJsonRpcRequestFrame(frame)) {
          await task;
        }
      }
    } finally {
      if (this.inflight.size > 0) {
        await Promise.allSettled([...this.inflight]);
      }
      this.running = false;
    }
  }

  close() {
    this.closed = true;
  }

  async resolveContext(message, frameContext = {}) {
    const baseContext = mergeContext(this.context, frameContext);
    if (!this.contextResolver) {
      return baseContext;
    }
    const resolved = await this.contextResolver({
      message,
      context: baseContext,
      service: this
    });
    return mergeContext(baseContext, resolved);
  }
}

export function createAcpSourceJsonRpcService(options = {}) {
  return new AcpSourceJsonRpcService(options);
}

export function createAcpSourceJsonRpcTransportPair() {
  const clientToServer = [];
  const serverToClient = [];
  const clientWaiters = [];
  const serverWaiters = [];
  let closed = false;

  const push = (queue, waiters, value) => {
    if (closed) {
      return false;
    }
    if (waiters.length > 0) {
      waiters.shift()(value);
    } else {
      queue.push(value);
    }
    return true;
  };

  const receive = (queue, waiters) => {
    if (queue.length > 0) {
      return Promise.resolve(queue.shift());
    }
    if (closed) {
      return Promise.resolve(null);
    }
    return new Promise((resolve) => waiters.push(resolve));
  };

  const close = () => {
    if (closed) {
      return;
    }
    closed = true;
    while (clientWaiters.length > 0) {
      clientWaiters.shift()(null);
    }
    while (serverWaiters.length > 0) {
      serverWaiters.shift()(null);
    }
  };

  return {
    client: {
      async send(payload) {
        return push(clientToServer, serverWaiters, encodeFrame(payload));
      },
      async receive() {
        return receive(serverToClient, clientWaiters);
      },
      close
    },
    server: {
      async send(payload) {
        return push(serverToClient, clientWaiters, encodeFrame(payload));
      },
      async receive() {
        return receive(clientToServer, serverWaiters);
      },
      close
    },
    close
  };
}

export function createAcpSourceJsonRpcLineTransport({
  input,
  output,
  encoding = "utf8"
} = {}) {
  if (!input || !output || typeof output.write !== "function") {
    throw new TypeError("ACP source line transport requires input stream and writable output stream.");
  }

  const queue = [];
  const waiters = [];
  let closed = false;
  if (typeof input.setEncoding === "function") {
    input.setEncoding(encoding);
  }
  const lineReader = readline.createInterface({
    input,
    crlfDelay: Infinity
  });

  const push = (message) => {
    if (closed) {
      return;
    }
    if (waiters.length > 0) {
      waiters.shift()(message);
    } else {
      queue.push(message);
    }
  };

  const close = () => {
    if (closed) {
      return;
    }
    closed = true;
    lineReader.close();
    while (waiters.length > 0) {
      waiters.shift()(null);
    }
  };

  lineReader.on("line", (line) => {
    if (String(line).trim()) {
      push(line);
    }
  });
  lineReader.on("close", close);

  return {
    async send(payload) {
      if (closed) {
        return false;
      }
      const frame = `${encodeFrame(payload)}\n`;
      if (output.write(frame, encoding)) {
        return true;
      }
      await once(output, "drain");
      return true;
    },
    async receive() {
      if (queue.length > 0) {
        return queue.shift();
      }
      if (closed) {
        return null;
      }
      return new Promise((resolve) => waiters.push(resolve));
    },
    close
  };
}
