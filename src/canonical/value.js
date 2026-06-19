const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

export function normalizeCanonicalValue(value) {
  if (value === null) return null;
  if (value === undefined) return null;
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return { $bytes: Buffer.from(value).toString("base64") };
  }
  if (typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Pactium Canonical Value only supports finite numbers.");
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map((item) => normalizeCanonicalValue(item));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .filter((key) => value[key] !== undefined)
        .sort()
        .map((key) => [key, normalizeCanonicalValue(value[key])])
    );
  }
  throw new TypeError(`Unsupported Pactium Canonical Value type: ${typeof value}`);
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
