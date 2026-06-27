import { canonicalDecode } from "../canonical/value.js";
import { PACTIUM_PROOF_BUNDLE_TYPE } from "../protocol/constants.js";
import { cidForBytes, hashBytes } from "../protocol/hashing.js";
import { asArray, asRecord } from "../shared/records.js";
import { createVerificationFailure } from "../verification/failure.js";

export function decodeVarint(bytes, offset = 0) {
  let value = 0;
  let shift = 0;
  let cursor = offset;
  if (!Number.isInteger(cursor) || cursor < 0) throw new Error("Bundle varint offset is invalid.");
  while (cursor < bytes.length) {
    const byte = bytes[cursor];
    value += (byte & 0x7f) * (2 ** shift);
    cursor += 1;
    if ((byte & 0x80) === 0) return { value, nextOffset: cursor };
    shift += 7;
    if (shift > 56) throw new Error("Bundle varint is too large.");
  }
  throw new Error("Bundle varint is truncated.");
}

function emptyResolver(indexFailures = []) {
  const readFailures = [];
  return {
    blockCids: new Set(),
    indexFailures,
    readFailures,
    get failures() {
      return [...indexFailures, ...readFailures];
    },
    has(cid) {
      return false;
    },
    get(cid) {
      return null;
    },
    verifyAll() {
      return { blocks: [], failures: this.failures };
    }
  };
}

function bundleFailure(code, evidenceRef, message = "", repairable = false) {
  return createVerificationFailure({
    layer: "proof-bundle",
    code,
    message,
    evidenceRef,
    repairable
  });
}

function decodeIndexedMetadata({ bytes, item, maxHeaderSize, maxBlockSize }) {
  const failures = [];
  const offset = Number(item.offset || 0);
  if (offset < 0 || offset >= bytes.length) {
    return {
      metadata: null,
      failures: [bundleFailure("bad_bundle_offset", String(offset), "", true)]
    };
  }
  let decoded;
  try {
    decoded = decodeVarint(bytes, offset);
  } catch (error) {
    return {
      metadata: null,
      failures: [bundleFailure(
        "bad_bundle_varint",
        String(offset),
        error instanceof Error ? error.message : "Bundle record varint could not be decoded."
      )]
    };
  }
  const recordLength = Number(item.recordLength || 0);
  const headerLength = Number(item.headerLength || 0);
  const payloadLength = Number(item.byteLength || 0);
  if (decoded.value !== recordLength || recordLength !== headerLength + payloadLength) {
    return {
      metadata: null,
      failures: [bundleFailure("bad_bundle_record_length", item.cid)]
    };
  }
  if (headerLength > maxHeaderSize) failures.push(bundleFailure("oversized_bundle_header", item.cid));
  if (payloadLength > maxBlockSize) failures.push(bundleFailure("oversized_bundle_block", item.cid));
  const headerStart = decoded.nextOffset;
  const payloadStart = headerStart + headerLength;
  const payloadEnd = payloadStart + payloadLength;
  if (payloadEnd > bytes.length) {
    return {
      metadata: null,
      failures: [bundleFailure("bad_bundle_offset", String(offset), "", true)]
    };
  }
  const headerBytes = bytes.subarray(headerStart, payloadStart);
  let header;
  try {
    header = asRecord(canonicalDecode(headerBytes));
  } catch (error) {
    return {
      metadata: null,
      failures: [bundleFailure(
        "bad_bundle_header",
        item.cid,
        error instanceof Error ? error.message : "Bundle record header could not be decoded."
      )]
    };
  }
  if (header.cid !== item.cid ||
    header.payloadHash !== item.payloadHash ||
    Number(header.byteLength || 0) !== payloadLength) {
    return {
      metadata: null,
      failures: [bundleFailure("bad_bundle_index", item.cid)]
    };
  }
  if (failures.length > 0) return { metadata: null, failures };
  return {
    failures,
    metadata: {
      header,
      payloadStart,
      payloadEnd,
      payloadLength
    }
  };
}

function decodeIndexedBlock({ bytes, item, metadata, maxHeaderSize, maxBlockSize }) {
  const decoded = metadata || decodeIndexedMetadata({ bytes, item, maxHeaderSize, maxBlockSize });
  if (!decoded.metadata || decoded.failures.length > 0) {
    return { block: null, failures: decoded.failures };
  }
  const { header, payloadStart, payloadEnd, payloadLength } = decoded.metadata;
  const payloadBytes = bytes.subarray(payloadStart, payloadEnd);
  const payloadHash = `sha256:${hashBytes(payloadBytes)}`;
  if (payloadHash !== item.payloadHash || cidForBytes(payloadBytes) !== item.cid) {
    return {
      block: null,
      failures: [bundleFailure("bad_bundle_index", item.cid)]
    };
  }
  return {
    failures: [],
    block: {
      protocol: header.protocol,
      cid: header.cid,
      codec: header.codec,
      kind: header.kind,
      refs: asArray(header.refs),
      byteLength: payloadLength,
      payloadHash,
      payloadBase64: payloadBytes.toString("base64")
    }
  };
}

export function createIndexedBundleResolver(bundle, {
  maxHeaderSize = 16 * 1024,
  maxBlockSize = 64 * 1024 * 1024
} = {}) {
  if (bundle?.bundleType !== PACTIUM_PROOF_BUNDLE_TYPE) {
    return emptyResolver([
      bundleFailure(
        "malformed_bundle",
        String(bundle?.bundleType || ""),
        "Proof Bundle must use the indexed bundle type."
      )
    ]);
  }
  if (!bundle.binaryBase64) {
    return emptyResolver([
      bundleFailure(
        "missing_bundle_binary",
        PACTIUM_PROOF_BUNDLE_TYPE,
        "Proof Bundle is missing indexed binary records.",
        true
      )
    ]);
  }
  const bytes = Buffer.from(String(bundle.binaryBase64 || ""), "base64");
  const offsets = new Set();
  const cids = new Set();
  const entries = asArray(bundle.index).map((item, ordinal) => ({ item, ordinal }));
  const indexByCid = new Map();
  const cache = new Map();
  const metadataCache = new Map();
  const payloadCache = new Map();
  const indexFailures = [];
  const readFailures = [];
  const readFailureKeys = new Set();
  function pushReadFailures(failures) {
    for (const failure of asArray(failures)) {
      const key = `${failure.code || ""}\u0000${failure.evidenceRef || ""}\u0000${failure.message || ""}`;
      if (readFailureKeys.has(key)) continue;
      readFailureKeys.add(key);
      readFailures.push(failure);
    }
  }
  function metadataFor(entry) {
    if (metadataCache.has(entry.ordinal)) return metadataCache.get(entry.ordinal);
    const decoded = decodeIndexedMetadata({
      bytes,
      item: entry.item,
      maxHeaderSize,
      maxBlockSize
    });
    metadataCache.set(entry.ordinal, decoded);
    return decoded;
  }
  function decodePayload(entry) {
    if (payloadCache.has(entry.ordinal)) return payloadCache.get(entry.ordinal);
    const decoded = decodeIndexedBlock({
      bytes,
      item: entry.item,
      metadata: metadataFor(entry),
      maxHeaderSize,
      maxBlockSize
    });
    if (decoded.failures.length > 0) pushReadFailures(decoded.failures);
    payloadCache.set(entry.ordinal, decoded.block);
    return decoded.block;
  }
  for (const entry of entries) {
    const { item } = entry;
    const offset = Number(item.offset || 0);
    if (offsets.has(offset)) {
      indexFailures.push(bundleFailure("duplicate_bundle_offset", String(offset)));
    }
    offsets.add(offset);
    if (cids.has(item.cid)) {
      indexFailures.push(bundleFailure("duplicate_bundle_cid", item.cid));
    } else {
      indexByCid.set(item.cid, entry);
    }
    cids.add(item.cid);
    if (offset < 0 || offset >= bytes.length) {
      indexFailures.push(bundleFailure("bad_bundle_offset", String(offset), "", true));
    }
    if (Number(item.recordLength || 0) <= 0) {
      indexFailures.push(bundleFailure("bad_bundle_record_length", item.cid));
    }
    if (Number(item.headerLength || 0) < 0) {
      indexFailures.push(bundleFailure("bad_bundle_header", item.cid));
    }
    if (Number(item.byteLength || 0) < 0) {
      indexFailures.push(bundleFailure("bad_bundle_record_length", item.cid));
    }
  }
  return {
    blockCids: new Set(indexByCid.keys()),
    decodedByteLength: bytes.length,
    indexFailures,
    readFailures,
    get failures() {
      return [...indexFailures, ...readFailures];
    },
    has(cid) {
      return indexByCid.has(cid);
    },
    get(cid) {
      if (!indexByCid.has(cid)) return null;
      if (cache.has(cid)) return cache.get(cid);
      const block = decodePayload(indexByCid.get(cid));
      cache.set(cid, block);
      return block;
    },
    verifyLayout({ allowTrailingBytes = false } = {}) {
      const failures = [];
      const sorted = [...entries].sort((a, b) => Number(a.item.offset || 0) - Number(b.item.offset || 0));
      const ranges = [];
      for (const entry of sorted) {
        const { item } = entry;
        const offset = Number(item.offset || 0);
        const recordLength = Number(item.recordLength || 0);
        const headerLength = Number(item.headerLength || 0);
        const byteLength = Number(item.byteLength || 0);
        if (offset < 0) failures.push(bundleFailure("bad_index_offset", item.cid, "Index item has negative offset."));
        if (recordLength <= 0) failures.push(bundleFailure("bad_index_record_length", item.cid, "Index item has non-positive recordLength."));
        if (headerLength < 0) failures.push(bundleFailure("bad_index_header_length", item.cid, "Index item has negative headerLength."));
        if (byteLength < 0) failures.push(bundleFailure("bad_index_byte_length", item.cid, "Index item has negative byteLength."));
        if (offset >= bytes.length) failures.push(bundleFailure("bad_index_range", item.cid, "Index item offset exceeds decoded binary length."));

        let varintResult;
        try {
          varintResult = decodeVarint(bytes, offset);
        } catch (error) {
          failures.push(bundleFailure(
            "bad_bundle_varint",
            item.cid,
            error instanceof Error ? error.message : "Bundle varint could not be decoded."
          ));
          continue;
        }
        if (varintResult.value !== recordLength) {
          failures.push(bundleFailure(
            "bad_index_record_length",
            item.cid,
            `Varint value ${varintResult.value} does not match index recordLength ${recordLength}.`
          ));
        }
        const recordStart = offset;
        const payloadStart = varintResult.nextOffset + headerLength;
        const payloadEnd = payloadStart + byteLength;
        if (payloadEnd > bytes.length) {
          failures.push(bundleFailure("bad_index_range", item.cid, "Record payload extends beyond decoded binary."));
        }
        ranges.push({ item, recordStart, payloadEnd });
        const metadata = metadataFor(entry);
        if (metadata.failures.length > 0) failures.push(...metadata.failures);
      }
      if (ranges.length > 0) {
        if (ranges[0].recordStart !== 0) {
          failures.push(bundleFailure(
            "leading_bytes",
            String(ranges[0].recordStart),
            `Bundle has ${ranges[0].recordStart} leading byte(s) before the first record.`,
            true
          ));
        }
        for (let index = 1; index < ranges.length; index += 1) {
          const previous = ranges[index - 1];
          const current = ranges[index];
          if (previous.payloadEnd > current.recordStart) {
            failures.push(bundleFailure(
              "overlapping_index_ranges",
              `${previous.item.cid} / ${current.item.cid}`,
              `Index records have overlapping byte ranges (prev ends at ${previous.payloadEnd}, curr starts at ${current.recordStart}).`
            ));
          } else if (previous.payloadEnd < current.recordStart) {
            failures.push(bundleFailure(
              "index_record_gap",
              `${previous.item.cid} / ${current.item.cid}`,
              `Gap of ${current.recordStart - previous.payloadEnd} bytes between index records.`
            ));
          }
        }
        const lastRange = ranges[ranges.length - 1];
        if (!allowTrailingBytes && lastRange.payloadEnd !== bytes.length) {
          const trailing = bytes.length - lastRange.payloadEnd;
          failures.push(bundleFailure(
            "trailing_bytes",
            String(trailing),
            `Bundle has ${trailing} trailing byte(s) after the last record (expected ${bytes.length}, got end at ${lastRange.payloadEnd}).`,
            true
          ));
        }
      }
      return failures;
    },
    verifyAll() {
      const blocks = [];
      for (const entry of entries) {
        const block = decodePayload(entry);
        if (block) blocks.push(block);
      }
      return { blocks, failures: this.failures };
    }
  };
}

export function indexedBlocksFromBundle(bundle, options = {}) {
  return createIndexedBundleResolver(bundle, options).verifyAll();
}
