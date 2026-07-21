import crypto from "node:crypto";
import { HASH_DOMAINS, PACTIUM_PROTOCOL } from "./constants.js";
import { canonicalEncode } from "../canonical/value.js";

const domainPrefixCache = new Map();

export function hashBytes(bytes) {
  return crypto.hash("sha256", Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || ""), "hex");
}

export function hexToBytes(hex) {
  return Buffer.from(String(hex || ""), "hex");
}

export function cidFromHex(hex) {
  return `cid:sha256:${hex}`;
}

export function hexFromCid(cid) {
  const text = String(cid || "");
  return text.startsWith("cid:sha256:") ? text.slice("cid:sha256:".length) : "";
}

export function createId(prefix, value) {
  return `${prefix}_${protocolHashHex(prefix, value).slice(0, 32)}`;
}

function domainPrefix(domain) {
  const separator = HASH_DOMAINS[domain] || String(domain || "pactium.v0.3.generic");
  if (!domainPrefixCache.has(separator)) {
    domainPrefixCache.set(separator, Buffer.from(`${PACTIUM_PROTOCOL}:${separator}\0`, "utf8"));
  }
  return domainPrefixCache.get(separator);
}

export function protocolHashHex(domain, value) {
  const bytes = Buffer.isBuffer(value)
    ? value
    : value instanceof Uint8Array
      ? Buffer.from(value.buffer, value.byteOffset, value.byteLength)
      : canonicalEncode(value);
  // Incremental updates avoid allocating a concatenated prefix+payload buffer.
  return crypto.createHash("sha256").update(domainPrefix(domain)).update(bytes).digest("hex");
}

export function protocolHash(domain, value) {
  return `sha256:${protocolHashHex(domain, value)}`;
}

export function cidForBytes(bytes) {
  return cidFromHex(hashBytes(bytes));
}

export function cidForCanonical(value) {
  return cidForBytes(canonicalEncode(value));
}
