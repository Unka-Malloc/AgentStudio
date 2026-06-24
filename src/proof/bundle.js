import { PACTIUM_PROOF_BUNDLE_TYPE, PACTIUM_PROTOCOL } from "../protocol/constants.js";
import { asArray } from "../shared/records.js";
import { protocolHash } from "../protocol/hashing.js";
import { createVerificationFailure } from "../verification/failure.js";
import { createIndexedBundleResolver, decodeVarint } from "./bundle-format.js";
import { verifyProofEnvelope } from "./envelope.js";

export async function verifyProofBundle(bundle, options = {}) {
  if (!bundle || bundle.protocol !== PACTIUM_PROTOCOL || bundle.bundleType !== PACTIUM_PROOF_BUNDLE_TYPE) {
    return {
      protocol: PACTIUM_PROTOCOL,
      ok: false,
      failures: [createVerificationFailure({
        layer: "proof-bundle",
        code: "malformed_bundle",
        message: "Proof Bundle is missing or has the wrong protocol."
      })]
    };
  }
  const failures = [];
  const maxHeaderSize = Number(options.maxHeaderSize || 16 * 1024);
  const maxBlockSize = Number(options.maxBlockSize || 64 * 1024 * 1024);
  const maxBundleBytes = Number(options.maxBundleBytes || 0);

  // -- Pre-decode size check: estimate decoded size from base64 length --
  if (maxBundleBytes > 0 && bundle.binaryBase64) {
    const estimatedDecodedSize = Math.ceil((bundle.binaryBase64.length * 3) / 4);
    if (estimatedDecodedSize > maxBundleBytes) {
      return {
        protocol: PACTIUM_PROTOCOL,
        bundleHash: bundle.bundleHash,
        ok: false,
        failures: [createVerificationFailure({
          layer: "proof-bundle",
          code: "bundle_too_large",
          message: `Estimated bundle size ${estimatedDecodedSize} exceeds maxBundleBytes ${maxBundleBytes}.`,
          evidenceRef: String(maxBundleBytes)
        })]
      };
    }
  }

  const resolver = createIndexedBundleResolver(bundle, { maxHeaderSize, maxBlockSize });
  failures.push(...resolver.indexFailures);

  // -- byteLength consistency --
  if (bundle.byteLength !== undefined && bundle.binaryBase64 !== undefined) {
    const decoded = Buffer.from(String(bundle.binaryBase64 || ""), "base64");
    if (bundle.byteLength !== decoded.length) {
      failures.push(createVerificationFailure({
        layer: "proof-bundle",
        code: "bad_bundle_byte_length",
        message: "Bundle byteLength does not match the decoded binary length.",
        evidenceRef: String(bundle.byteLength)
      }));
    }
  }

  // -- manifest.blockCount === index.length --
  if (bundle.manifest && bundle.index) {
    if (Number(bundle.manifest.blockCount || 0) !== asArray(bundle.index).length) {
      failures.push(createVerificationFailure({
        layer: "proof-bundle",
        code: "bad_manifest_block_count",
        message: "Bundle manifest blockCount does not match the index length.",
        evidenceRef: String(bundle.manifest.blockCount)
      }));
    }
  }

  // -- index item strict layout validation --
  // Decode every varint to compute exact [start, payloadEnd) for each record,
  // then check coverage, overlap, gaps, and trailing bytes.
  const decodedBytes = bundle.binaryBase64 ? Buffer.from(String(bundle.binaryBase64), "base64") : null;
  if (decodedBytes && bundle.index) {
    const sorted = [...asArray(bundle.index)].sort((a, b) => Number(a.offset || 0) - Number(b.offset || 0));
    const ranges = [];
    for (let i = 0; i < sorted.length; i++) {
      const item = sorted[i];
      const offset = Number(item.offset || 0);
      const recordLength = Number(item.recordLength || 0);
      const headerLength = Number(item.headerLength || 0);
      const byteLength = Number(item.byteLength || 0);

      if (offset < 0) {
        failures.push(createVerificationFailure({
          layer: "proof-bundle", code: "bad_index_offset",
          message: `Index item has negative offset.`, evidenceRef: item.cid
        }));
      }
      if (recordLength <= 0) {
        failures.push(createVerificationFailure({
          layer: "proof-bundle", code: "bad_index_record_length",
          message: `Index item has non-positive recordLength.`, evidenceRef: item.cid
        }));
      }
      if (headerLength < 0) {
        failures.push(createVerificationFailure({
          layer: "proof-bundle", code: "bad_index_header_length",
          message: `Index item has negative headerLength.`, evidenceRef: item.cid
        }));
      }
      if (byteLength < 0) {
        failures.push(createVerificationFailure({
          layer: "proof-bundle", code: "bad_index_byte_length",
          message: `Index item has negative byteLength.`, evidenceRef: item.cid
        }));
      }
      if (offset >= decodedBytes.length) {
        failures.push(createVerificationFailure({
          layer: "proof-bundle", code: "bad_index_range",
          message: `Index item offset exceeds decoded binary length.`, evidenceRef: item.cid
        }));
      }

      // Decode the actual varint at this offset to get the precise payload end.
      let varintResult;
      try {
        varintResult = decodeVarint(decodedBytes, offset);
      } catch (err) {
        failures.push(createVerificationFailure({
          layer: "proof-bundle", code: "bad_bundle_varint",
          message: err instanceof Error ? err.message : "Bundle varint could not be decoded.",
          evidenceRef: item.cid
        }));
        continue;
      }
      if (varintResult.value !== recordLength) {
        failures.push(createVerificationFailure({
          layer: "proof-bundle", code: "bad_index_record_length",
          message: `Varint value ${varintResult.value} does not match index recordLength ${recordLength}.`,
          evidenceRef: item.cid
        }));
      }
      const recordStart = offset;
      const payloadStart = varintResult.nextOffset + headerLength;
      const payloadEnd = payloadStart + byteLength;
      if (payloadEnd > decodedBytes.length) {
        failures.push(createVerificationFailure({
          layer: "proof-bundle", code: "bad_index_range",
          message: `Record payload extends beyond decoded binary.`, evidenceRef: item.cid
        }));
      }
      ranges.push({ item, recordStart, payloadEnd });
    }

    // Strict coverage / overlap / gap / trailing check using exact ranges.
    if (ranges.length > 0) {
      // Leading bytes: first record must start at offset 0.
      if (ranges[0].recordStart !== 0) {
        failures.push(createVerificationFailure({
          layer: "proof-bundle", code: "leading_bytes",
          message: `Bundle has ${ranges[0].recordStart} leading byte(s) before the first record.`,
          evidenceRef: String(ranges[0].recordStart),
          repairable: true
        }));
      }
      for (let i = 1; i < ranges.length; i++) {
        const prev = ranges[i - 1];
        const curr = ranges[i];
        if (prev.payloadEnd > curr.recordStart) {
          failures.push(createVerificationFailure({
            layer: "proof-bundle", code: "overlapping_index_ranges",
            message: `Index records have overlapping byte ranges (prev ends at ${prev.payloadEnd}, curr starts at ${curr.recordStart}).`,
            evidenceRef: `${prev.item.cid} / ${curr.item.cid}`
          }));
        } else if (prev.payloadEnd < curr.recordStart) {
          failures.push(createVerificationFailure({
            layer: "proof-bundle", code: "index_record_gap",
            message: `Gap of ${curr.recordStart - prev.payloadEnd} bytes between index records.`,
            evidenceRef: `${prev.item.cid} / ${curr.item.cid}`
          }));
        }
      }
      // Trailing bytes: last record must end exactly at decoded.length.
      const lastRange = ranges[ranges.length - 1];
      if (!options.allowTrailingBytes && lastRange.payloadEnd !== decodedBytes.length) {
        const trailing = decodedBytes.length - lastRange.payloadEnd;
        failures.push(createVerificationFailure({
          layer: "proof-bundle", code: "trailing_bytes",
          message: `Bundle has ${trailing} trailing byte(s) after the last record (expected ${decodedBytes.length}, got end at ${lastRange.payloadEnd}).`,
          evidenceRef: String(trailing),
          repairable: true
        }));
      }
    }
  }

  const blockCids = resolver.blockCids;
  const expectedBundleHash = protocolHash("proof.bundle", {
    manifest: bundle.manifest,
    envelope: bundle.envelope,
    index: asArray(bundle.index).map((item) => ({
      cid: item.cid,
      offset: item.offset,
      recordLength: item.recordLength,
      headerLength: item.headerLength,
      byteLength: item.byteLength,
      payloadHash: item.payloadHash
    }))
  });
  if (bundle.bundleHash && bundle.bundleHash !== expectedBundleHash) {
    failures.push(createVerificationFailure({
      layer: "proof-bundle",
      code: "bad_bundle_hash",
      message: "Proof Bundle hash does not match its indexed contents.",
      evidenceRef: bundle.bundleHash
    }));
  }
  for (const required of asArray(bundle.manifest?.requiredBlocks)) {
    if (!blockCids.has(required)) {
      failures.push(createVerificationFailure({
        layer: "proof-bundle",
        code: "missing_bundle_block",
        message: "Proof Bundle is missing a required block.",
        evidenceRef: required,
        repairable: true
      }));
    } else {
      resolver.get(required);
    }
  }
  if (options.verifyAllBlocks === true) resolver.verifyAll();
  const envelopeResult = await verifyProofEnvelope(bundle.envelope, {
    bundle,
    bundleResolver: resolver,
    includeBundleResolverFailures: false,
    supportedCriticalExtensions: options.supportedCriticalExtensions || [],
    proofVerifiers: options.proofVerifiers || {},
    requireAllProofs: options.requireAllProofs !== false,
    verifierManifest: options.verifierManifest || null,
    trustedManifest: options.trustedManifest || null,
    ledgerHeadSignatures: options.ledgerHeadSignatures || [],
    trustPolicy: options.trustPolicy || "self-carried-manifest",
    requireFullStateMutationProofs: options.requireFullStateMutationProofs || false
  });
  return {
    protocol: PACTIUM_PROTOCOL,
    bundleHash: bundle.bundleHash,
    ok: failures.length === 0 && envelopeResult.ok,
    failures: [...failures, ...resolver.readFailures, ...envelopeResult.failures],
    envelope: envelopeResult
  };
}
