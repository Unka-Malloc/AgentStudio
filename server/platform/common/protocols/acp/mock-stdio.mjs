import { EventEmitter } from "node:events";

function isObject(value) {
  return value !== null && typeof value === "object";
}

function toJsonText(payload) {
  return isObject(payload) ? JSON.stringify(payload) : String(payload);
}

export function createInMemoryJsonRpcTransport() {
  const emitter = new EventEmitter();
  const queue = [];
  const waiters = [];
  let closed = false;

  const pop = () => {
    if (queue.length > 0) {
      return Promise.resolve(queue.shift());
    }
    if (closed) {
      return Promise.resolve(null);
    }
    return new Promise((resolve) => waiters.push(resolve));
  };

  const push = (message) => {
    if (closed) {
      return;
    }
    if (waiters.length > 0) {
      const resolve = waiters.shift();
      resolve(message);
    } else {
      queue.push(message);
    }
  };

  return {
    close() {
      if (closed) return;
      closed = true;
      while (waiters.length > 0) {
        waiters.shift()(null);
      }
      emitter.emit("close");
    },
    async send(payload) {
      if (closed) {
        return false;
      }
      const message = payload === undefined ? "" : toJsonText(payload);
      push(message);
      emitter.emit("send", message);
      emitter.emit("data", message);
      return true;
    },
    async receive() {
      return pop();
    },
    on(eventName, listener) {
      emitter.on(eventName, listener);
    },
    off(eventName, listener) {
      emitter.off(eventName, listener);
    }
  };
}
