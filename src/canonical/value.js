const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();
const MAX_DEPTH = 256;
const MAX_NODES = 100000;

// Each canonicalization call creates a fresh local context so that:
// - successive calls do not accumulate node counts across call boundaries
// - concurrent calls cannot pollute each other's state
// - canonicalString(), canonicalEncode(), and any future entry point all
//   share the same per-call isolation guarantee.
function createCanonicalContext() {
  return { nodeCount: 0 };
}

function normalizeCanonicalValueWithContext(value, depth, ctx) {
  if (depth > MAX_DEPTH) {
    throw new RangeError("Pactium Canonical Value exceeded maximum nesting depth.");
  }
  ctx.nodeCount += 1;
  if (ctx.nodeCount > MAX_NODES) {
    throw new RangeError("Pactium Canonical Value exceeded maximum node count.");
  }
  if (value === null) return null;
  if (value === undefined) return null;
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return { $bytes: Buffer.from(value).toString("base64") };
  }
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.normalize("NFC");
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Pactium Canonical Value only supports finite numbers.");
    }
    if (!Number.isSafeInteger(value)) {
      throw new TypeError("Pactium Canonical Value only supports safe integers (IEEE 754 53-bit).");
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map((item) => normalizeCanonicalValueWithContext(item, depth + 1, ctx));
  if (typeof value === "object") {
    if (Object.hasOwn(value, "$bytes")) {
      throw new TypeError("Pactium Canonical Value reserves $bytes for binary data.");
    }
    return Object.fromEntries(
      Object.keys(value)
        .filter((key) => value[key] !== undefined)
        .sort()
        .map((key) => [key, normalizeCanonicalValueWithContext(value[key], depth + 1, ctx)])
    );
  }
  throw new TypeError(`Unsupported Pactium Canonical Value type: ${typeof value}`);
}

// Public entry points: each call creates a fresh context so counts are
// per-invocation and never leak across calls or concurrent coroutines.
export function normalizeCanonicalValue(value) {
  return normalizeCanonicalValueWithContext(value, 0, createCanonicalContext());
}

export function canonicalString(value) {
  return JSON.stringify(normalizeCanonicalValue(value));
}

export function canonicalEncode(value) {
  return TEXT_ENCODER.encode(canonicalString(value));
}

export function canonicalDecode(bytes) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || "");
  return JSON.parse(TEXT_DECODER.decode(buffer));
}
