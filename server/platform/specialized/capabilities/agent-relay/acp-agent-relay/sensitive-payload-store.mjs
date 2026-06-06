import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

function nowIso() {
  return new Date().toISOString();
}

function asText(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function asObject(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizePayloadRecord(raw = {}) {
  return {
    ref: asText(raw.ref),
    kind: asText(raw.kind, "payload"),
    payload: asObject(raw.payload),
    createdAt: asText(raw.createdAt, nowIso()),
    updatedAt: asText(raw.updatedAt, raw.createdAt || nowIso())
  };
}

function normalizeState(raw = {}) {
  return {
    payloads: asObject(raw.payloads)
  };
}

function payloadStorePath({ userDataPath = "", filePath = "" } = {}) {
  const explicitPath = asText(filePath);
  if (explicitPath) {
    return explicitPath;
  }
  return path.join(asText(userDataPath, process.cwd()), "agent-relay", "acp-sensitive-payloads.json");
}

export function createInMemorySensitivePayloadStore(seed = {}) {
  const state = normalizeState(seed);
  return {
    async set(ref = "", payload = {}) {
      const key = asText(ref);
      if (!key) {
        return "";
      }
      const current = asObject(state.payloads[key]);
      const record = normalizePayloadRecord({
        ...current,
        ref: key,
        kind: payload.kind,
        payload,
        updatedAt: nowIso()
      });
      state.payloads[key] = record;
      return key;
    },
    async get(ref = "") {
      const record = state.payloads[asText(ref)];
      return record ? clone(record.payload) : null;
    },
    async delete(ref = "") {
      const key = asText(ref);
      if (!key || !Object.hasOwn(state.payloads, key)) {
        return false;
      }
      delete state.payloads[key];
      return true;
    },
    async listRefs() {
      return Object.keys(state.payloads);
    }
  };
}

export function createFileSensitivePayloadStore(options = {}) {
  const storagePath = payloadStorePath(options);
  let loaded = false;
  let state = normalizeState({});

  async function load() {
    if (loaded) {
      return;
    }
    try {
      const raw = await fs.readFile(storagePath, "utf8");
      state = normalizeState(JSON.parse(raw));
    } catch {
      state = normalizeState({});
    }
    loaded = true;
  }

  async function save() {
    await fs.mkdir(path.dirname(storagePath), { recursive: true, mode: 0o700 });
    const tempPath = `${storagePath}.${process.pid}.${Date.now()}.${crypto.randomBytes(6).toString("hex")}.tmp`;
    await fs.writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await fs.rename(tempPath, storagePath);
    await fs.chmod(storagePath, 0o600).catch(() => {});
  }

  return {
    storagePath,
    async set(ref = "", payload = {}) {
      const key = asText(ref);
      if (!key) {
        return "";
      }
      await load();
      const current = asObject(state.payloads[key]);
      state.payloads[key] = normalizePayloadRecord({
        ...current,
        ref: key,
        kind: payload.kind,
        payload,
        updatedAt: nowIso()
      });
      await save();
      return key;
    },
    async get(ref = "") {
      await load();
      const record = state.payloads[asText(ref)];
      return record ? clone(record.payload) : null;
    },
    async delete(ref = "") {
      const key = asText(ref);
      if (!key) {
        return false;
      }
      await load();
      if (!Object.hasOwn(state.payloads, key)) {
        return false;
      }
      delete state.payloads[key];
      await save();
      return true;
    },
    async listRefs() {
      await load();
      return Object.keys(state.payloads);
    }
  };
}
