import crypto from "node:crypto";
import { HASH_DOMAINS, PACTIUM_PROTOCOL } from "./constants.js";
import { canonicalEncode } from "../canonical/value.js";

export function hashBytes(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
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

export function protocolHashHex(domain, value) {
  const separator = HASH_DOMAINS[domain] || String(domain || "pactium.v0.2.generic");
  const bytes = Buffer.isBuffer(value) || value instanceof Uint8Array
    ? Buffer.from(value)
    : Buffer.from(canonicalEncode(value));
  return hashBytes(Buffer.concat([
    Buffer.from(`${PACTIUM_PROTOCOL}:${separator}\0`, "utf8"),
    bytes
  ]));
}

export function protocolHash(domain, value) {
  return `sha256:${protocolHashHex(domain, value)}`;
}

export function cidForBytes(bytes) {
  return cidFromHex(hashBytes(Buffer.from(bytes || "")));
}

export function cidForCanonical(value) {
  return cidForBytes(canonicalEncode(value));
}
