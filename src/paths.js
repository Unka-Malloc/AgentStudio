import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";

export const PACTIUM_PROTOCOL_VERSION = "v0.1.0:pactium:core-1";

export function defaultPactiumDataDir() {
  return process.env.PACTIUM_DATA_DIR || path.join(os.homedir(), ".pactium");
}

export function resolveDataDir(dataDir = "") {
  return path.resolve(String(dataDir || defaultPactiumDataDir()));
}

export function resolveWithin(root, ...segments) {
  const base = path.resolve(String(root || defaultPactiumDataDir()));
  const target = path.resolve(base, ...segments.map((segment) => String(segment || "")));
  if (target !== base && !target.startsWith(`${base}${path.sep}`)) {
    throw new Error(`Path escapes Pactium data directory: ${target}`);
  }
  return target;
}

function stableJson(value) {
  if (value === undefined || value === null) return "null";
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return JSON.stringify({ bytes: Buffer.from(value).toString("base64") });
  }
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256Hex(value) {
  const input = Buffer.isBuffer(value) || value instanceof Uint8Array
    ? Buffer.from(value)
    : Buffer.from(typeof value === "string" ? value : stableJson(value), "utf8");
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function pactiumToken(kind, ...parts) {
  const safeKind = String(kind || "token")
    .trim()
    .replace(/[^a-zA-Z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "") || "token";
  return `${safeKind}_${sha256Hex([safeKind, ...parts]).slice(0, 32)}`;
}

export function assertPactiumToken(value, expectedKind = "") {
  const text = String(value || "").trim();
  const kind = String(expectedKind || "").trim();
  const pattern = kind
    ? new RegExp(`^${kind.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") }_[a-f0-9]{32}$`)
    : /^[a-zA-Z0-9_]+_[a-f0-9]{32}$/;
  if (!pattern.test(text)) {
    throw new Error(`Invalid Pactium token${kind ? ` for ${kind}` : ""}.`);
  }
  return text;
}
