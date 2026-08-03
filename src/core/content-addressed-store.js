import { canonicalDecode } from "../canonical/value.js";

function text(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

/**
 * Thin host-neutral facade over Storage Port block operations.
 */
export function createContentAddressedStore({
  storage = null,
  defaultKind = "pactium.cas-block",
  defaultCodec = "pactium-canonical"
} = {}) {
  if (!storage || typeof storage.putBlock !== "function") {
    throw new TypeError("createContentAddressedStore requires a Pactium storage port.");
  }

  async function putBlock(value, options = {}) {
    const codec = text(options.codec, defaultCodec) === "raw" ? "raw" : "pactium-canonical";
    return storage.putBlock(value, {
      codec,
      kind: text(options.kind || options.metadata?.kind, defaultKind),
      refs: asArray(options.refs).map(text).filter(Boolean)
    });
  }

  async function getBlock(cid) {
    const record = await storage.getBlock(text(cid));
    if (!record) return null;
    const bytes = Buffer.from(record.bytes || Buffer.from(String(record.payloadBase64 || ""), "base64"));
    return {
      ...record,
      bytes,
      value: record.codec === "raw" ? null : canonicalDecode(bytes)
    };
  }

  async function walk(rootCid) {
    return storage.walk(text(rootCid));
  }

  return Object.freeze({
    putBlock,
    getBlock,
    hasBlock(cid) {
      return storage.hasBlock(text(cid));
    },
    walk,
    async listMissing(rootCid) {
      return (await walk(rootCid)).missing;
    },
    async verify(rootCid) {
      const result = await walk(rootCid);
      return {
        ok: result.missing.length === 0,
        rootCid: text(rootCid),
        blockCount: result.blockCount,
        missing: result.missing
      };
    }
  });
}
