import {
  brotliCompressSync,
  brotliDecompressSync,
  constants as zlibConstants
} from "node:zlib";

export const STORAGE_COMPRESSION_NONE = "none";
export const STORAGE_COMPRESSION_BROTLI_V1 = "br-v1";
export const DEFAULT_COMPRESSION_THRESHOLD_BYTES = 768;
export const MAX_STORAGE_PAYLOAD_BYTES = 256 * 1024 * 1024;

const MIN_COMPRESSION_SAVINGS_BYTES = 32;
const MIN_COMPRESSION_SAVINGS_RATIO = 0.05;

function asPayloadBuffer(value) {
  return Buffer.isBuffer(value) ? value : Buffer.from(value || "");
}

function assertRawLength(rawLength, maximumRawLength = MAX_STORAGE_PAYLOAD_BYTES) {
  const length = Number(rawLength);
  if (!Number.isSafeInteger(length) || length < 0 || length > maximumRawLength) {
    throw new RangeError(`Pactium storage payload length is outside the supported boundary: ${rawLength}`);
  }
  return length;
}

export function encodeStoragePayload(bytes, {
  compressionThresholdBytes = DEFAULT_COMPRESSION_THRESHOLD_BYTES,
  maximumRawLength = MAX_STORAGE_PAYLOAD_BYTES
} = {}) {
  const raw = asPayloadBuffer(bytes);
  assertRawLength(raw.length, maximumRawLength);
  const configuredThreshold = Number(compressionThresholdBytes);
  const threshold = Number.isSafeInteger(configuredThreshold) && configuredThreshold >= 0
    ? configuredThreshold
    : DEFAULT_COMPRESSION_THRESHOLD_BYTES;
  if (raw.length < threshold) {
    return { compression: STORAGE_COMPRESSION_NONE, rawLength: raw.length, payload: raw };
  }
  const compressed = brotliCompressSync(raw, {
    params: {
      [zlibConstants.BROTLI_PARAM_QUALITY]: 4,
      [zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_GENERIC
    }
  });
  const requiredSavings = Math.max(
    MIN_COMPRESSION_SAVINGS_BYTES,
    Math.ceil(raw.length * MIN_COMPRESSION_SAVINGS_RATIO)
  );
  if (compressed.length > raw.length - requiredSavings) {
    return { compression: STORAGE_COMPRESSION_NONE, rawLength: raw.length, payload: raw };
  }
  return {
    compression: STORAGE_COMPRESSION_BROTLI_V1,
    rawLength: raw.length,
    payload: compressed
  };
}

export function decodeStoragePayload(payload, {
  compression,
  rawLength,
  maximumRawLength = MAX_STORAGE_PAYLOAD_BYTES
} = {}) {
  const stored = asPayloadBuffer(payload);
  const expectedLength = assertRawLength(rawLength, maximumRawLength);
  let raw;
  if (compression === STORAGE_COMPRESSION_NONE) {
    raw = stored;
  } else if (compression === STORAGE_COMPRESSION_BROTLI_V1) {
    raw = brotliDecompressSync(stored, { maxOutputLength: expectedLength });
  } else {
    throw new Error(`Unsupported Pactium storage compression: ${compression}`);
  }
  if (raw.length !== expectedLength) {
    throw new Error(`Pactium storage payload length mismatch: expected ${expectedLength}, received ${raw.length}`);
  }
  return Buffer.from(raw);
}
