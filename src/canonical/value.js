const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();
const MAX_DEPTH = 256;
const MAX_NODES = 100000;

let nodeCount = 0;

export function normalizeCanonicalValue(value, depth = 0) {
  if (depth > MAX_DEPTH) {
    throw new RangeError("Pactium Canonical Value exceeded maximum nesting depth.");
  }
  nodeCount += 1;
  if (nodeCount > MAX_NODES) {
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
  if (Array.isArray(value)) return value.map((item) => normalizeCanonicalValue(item, depth + 1));
  if (typeof value === "object") {
    if (Object.hasOwn(value, "$bytes")) {
      throw new TypeError("Pactium Canonical Value reserves $bytes for binary data.");
    }
    return Object.fromEntries(
      Object.keys(value)
        .filter((key) => value[key] !== undefined)
        .sort()
        .map((key) => [key, normalizeCanonicalValue(value[key], depth + 1)])
    );
  }
  throw new TypeError(`Unsupported Pactium Canonical Value type: ${typeof value}`);
}

export function canonicalString(value) {
  nodeCount = 0;
  try {
    return JSON.stringify(normalizeCanonicalValue(value));
  } finally {
    nodeCount = 0;
  }
}

export function canonicalEncode(value) {
  return TEXT_ENCODER.encode(canonicalString(value));
}

export function canonicalDecode(bytes) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || "");
  return JSON.parse(TEXT_DECODER.decode(buffer));
}
