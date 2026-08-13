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
  defaultCodec = "pactium-canonical",
  pinScope = "pactium-cas-pins"
} = {}) {
  if (!storage || typeof storage.putBlock !== "function") {
    throw new TypeError("createContentAddressedStore requires a Pactium storage port.");
  }

  async function putBlock(value, options = {}) {
    const codec = text(options.codec, defaultCodec) === "raw" ? "raw" : "pactium-canonical";
    return storage.putBlock(value, {
      codec,
      kind: text(options.kind || options.metadata?.kind, defaultKind),
      refs: asArray(options.refs).map((value) => text(value)).filter(Boolean)
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

  const pinStateKey = "pin-authority";

  async function runPinTransaction(task) {
    if (typeof storage.withWriteLock === "function") {
      return storage.withWriteLock(task, { name: "pactium-cas-pins", timeoutMs: 30_000 });
    }
    return task();
  }

  async function loadPinState({ allowInitialize = false } = {}) {
    const state = await storage.getProtocolObject(pinScope, pinStateKey, null);
    if (!state && allowInitialize) {
  return { format: "pactium.cas-pins", generation: 0, roots: [] };
    }
  if (!state || state.format !== "pactium.cas-pins" ||
        !Number.isSafeInteger(state.generation) || !Array.isArray(state.roots)) {
      const error = new Error("Pactium CAS pin authority is missing or corrupt.");
      error.code = "PACTIUM_CAS_PIN_AUTHORITY_INCOMPLETE";
      throw error;
    }
    return {
      format: state.format,
      generation: state.generation,
      roots: [...new Set(state.roots.map((value) => text(value)).filter(Boolean))].sort()
    };
  }

  async function updatePins(rootCid, present) {
    const root = text(rootCid);
    if (!root) throw new TypeError("Pactium CAS pin root is required.");
    return runPinTransaction(async () => {
      const state = await loadPinState({ allowInitialize: true });
      const roots = new Set(state.roots);
      if (present) roots.add(root);
      else roots.delete(root);
      const next = {
    format: "pactium.cas-pins",
        generation: state.generation + 1,
        roots: [...roots].sort()
      };
      await storage.putProtocolObject(pinScope, pinStateKey, next);
      return next;
    });
  }

  return Object.freeze({
    putBlock,
    getBlock,
    hasBlock(cid) {
      return storage.hasBlock(text(cid));
    },
    walk,
    pinRoot(rootCid) {
      return updatePins(rootCid, true);
    },
    unpinRoot(rootCid) {
      return updatePins(rootCid, false);
    },
    async listPins() {
      return loadPinState();
    },
    async collectGarbage(options = {}) {
      if (typeof storage.collectGarbage !== "function") {
        return { supported: false, aborted: true, reason: "storage-gc-unsupported" };
      }
      return runPinTransaction(async () => {
        const authority = await loadPinState();
        const first = await storage.collectGarbage({
          ...options,
          roots: authority.roots,
          retain: [],
          dryRun: true
        });
        if (first.aborted || options.dryRun !== false) {
          return { ...first, pinGeneration: authority.generation };
        }
        const confirmed = await loadPinState();
        if (confirmed.generation !== authority.generation ||
            confirmed.roots.join("\0") !== authority.roots.join("\0")) {
          return {
            supported: true,
            aborted: true,
            reason: "pin-generation-changed",
            dryRun: false,
            pinGeneration: confirmed.generation,
            deletedCount: 0,
            deletedBytes: 0
          };
        }
        const swept = await storage.collectGarbage({
          ...options,
          roots: confirmed.roots,
          retain: [],
          dryRun: false
        });
        return { ...swept, pinGeneration: confirmed.generation };
      });
    },
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
