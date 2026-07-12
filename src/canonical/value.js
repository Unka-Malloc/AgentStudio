const TEXT_DECODER = new TextDecoder();
const MAX_DEPTH = 256;
const MAX_NODES = 100000;

// Strings made only of printable ASCII characters that need no JSON escaping
// (excludes `"` 0x22, `\` 0x5c, and control characters). These strings are
// NFC-invariant, so both NFC normalization and JSON.stringify can be skipped.
const JSON_SAFE_ASCII = /^[\x20\x21\x23-\x5b\x5d-\x7e]*$/;

// Each canonicalization call creates a fresh local context so that:
// - successive calls do not accumulate node counts across call boundaries
// - concurrent calls cannot pollute each other's state
// - canonicalString(), canonicalEncode(), and any future entry point all
//   share the same per-call isolation guarantee.
function createCanonicalContext() {
  return { nodeCount: 0 };
}

function guardCanonicalNode(depth, ctx) {
  if (depth > MAX_DEPTH) {
    throw new RangeError("Pactium Canonical Value exceeded maximum nesting depth.");
  }
  ctx.nodeCount += 1;
  if (ctx.nodeCount > MAX_NODES) {
    throw new RangeError("Pactium Canonical Value exceeded maximum node count.");
  }
}

function canonicalNumber(value) {
  if (!Number.isSafeInteger(value)) {
    if (!Number.isFinite(value)) {
      throw new TypeError("Pactium Canonical Value only supports finite numbers.");
    }
    throw new TypeError("Pactium Canonical Value only supports safe integers (IEEE 754 53-bit).");
  }
  // Collapse -0 to 0 so canonical output has a single zero encoding.
  return value === 0 ? 0 : value;
}

function normalizeCanonicalValueWithContext(value, depth, ctx) {
  guardCanonicalNode(depth, ctx);
  if (value === null || value === undefined) return null;
  const type = typeof value;
  if (type === "string") return JSON_SAFE_ASCII.test(value) ? value : value.normalize("NFC");
  if (type === "number") return canonicalNumber(value);
  if (type === "boolean") return value;
  if (type === "object") {
    if (Array.isArray(value)) {
      const output = new Array(value.length);
      for (let index = 0; index < value.length; index += 1) {
        output[index] = normalizeCanonicalValueWithContext(value[index], depth + 1, ctx);
      }
      return output;
    }
    if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
      return { $bytes: Buffer.from(value).toString("base64") };
    }
    if (Object.hasOwn(value, "$bytes")) {
      throw new TypeError("Pactium Canonical Value reserves $bytes for binary data.");
    }
    const keys = Object.keys(value).sort();
    const output = {};
    for (const key of keys) {
      const nested = value[key];
      if (nested !== undefined) output[key] = normalizeCanonicalValueWithContext(nested, depth + 1, ctx);
    }
    return output;
  }
  throw new TypeError(`Unsupported Pactium Canonical Value type: ${type}`);
}

// Serializes a value string with the same output as JSON.stringify applied to
// the NFC-normalized string, skipping normalization for NFC-invariant ASCII.
function canonicalValueString(value) {
  return JSON_SAFE_ASCII.test(value) ? `"${value}"` : JSON.stringify(value.normalize("NFC"));
}

// Object keys are canonicalized verbatim (sorted by UTF-16 code units, never
// NFC-normalized), matching normalizeCanonicalValue + JSON.stringify output.
function canonicalKeyString(key) {
  return JSON_SAFE_ASCII.test(key) ? `"${key}"` : JSON.stringify(key);
}

// Single-pass canonical serializer. Produces byte-identical output to
// JSON.stringify(normalizeCanonicalValue(value)) without materializing the
// normalized copy, and enforces the same depth/node-count/type guards.
function writeCanonicalValue(value, depth, ctx) {
  guardCanonicalNode(depth, ctx);
  if (value === null || value === undefined) return "null";
  const type = typeof value;
  if (type === "string") return canonicalValueString(value);
  if (type === "number") {
    const number = canonicalNumber(value);
    return number === 0 ? "0" : String(number);
  }
  if (type === "boolean") return value ? "true" : "false";
  if (type === "object") {
    if (Array.isArray(value)) {
      let output = "[";
      for (let index = 0; index < value.length; index += 1) {
        if (index > 0) output += ",";
        output += writeCanonicalValue(value[index], depth + 1, ctx);
      }
      return `${output}]`;
    }
    if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
      return `{"$bytes":"${Buffer.from(value).toString("base64")}"}`;
    }
    if (Object.hasOwn(value, "$bytes")) {
      throw new TypeError("Pactium Canonical Value reserves $bytes for binary data.");
    }
    const keys = Object.keys(value).sort();
    let output = "{";
    let first = true;
    for (const key of keys) {
      const nested = value[key];
      if (nested === undefined) continue;
      if (first) first = false;
      else output += ",";
      output += `${canonicalKeyString(key)}:${writeCanonicalValue(nested, depth + 1, ctx)}`;
    }
    return `${output}}`;
  }
  throw new TypeError(`Unsupported Pactium Canonical Value type: ${type}`);
}

// Public entry points: each call creates a fresh context so counts are
// per-invocation and never leak across calls or concurrent coroutines.
export function normalizeCanonicalValue(value) {
  return normalizeCanonicalValueWithContext(value, 0, createCanonicalContext());
}

export function canonicalString(value) {
  return writeCanonicalValue(value, 0, createCanonicalContext());
}

// Returns a Buffer (a Uint8Array subclass) so hashing and storage callers can
// consume the encoded bytes without an extra copy.
export function canonicalEncode(value) {
  return Buffer.from(canonicalString(value), "utf8");
}

export function canonicalDecode(bytes) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || "");
  return JSON.parse(TEXT_DECODER.decode(buffer));
}
