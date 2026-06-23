import { PACTIUM_PROOF_BUNDLE_TYPE, PACTIUM_PROTOCOL } from "../protocol/constants.js";
import { asArray } from "../shared/records.js";
import { protocolHash } from "../protocol/hashing.js";
import { createVerificationFailure } from "../verification/failure.js";
import { createIndexedBundleResolver } from "./bundle-format.js";
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

  // -- index item range checks --
  const decodedBytes = bundle.binaryBase64 ? Buffer.from(String(bundle.binaryBase64), "base64") : null;
  if (decodedBytes && bundle.index) {
    const sorted = [...asArray(bundle.index)].sort((a, b) => Number(a.offset || 0) - Number(b.offset || 0));
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
      // offset must be within the decoded binary
      if (offset >= decodedBytes.length) {
        failures.push(createVerificationFailure({
          layer: "proof-bundle", code: "bad_index_range",
          message: `Index item offset exceeds decoded binary length.`, evidenceRef: item.cid
        }));
      }
      // The record end is determined by the next record's offset (for all but
      // the last item) or by the end of the binary (for the last item).
      // recordLength does NOT include the varint prefix length, so we cannot
      // simply use offset + recordLength to compute the range end.
      // Overlap detection: use the next item's offset as the boundary.
      if (i > 0) {
        const prev = sorted[i - 1];
        if (prev.offset === offset) {
          failures.push(createVerificationFailure({
            layer: "proof-bundle", code: "duplicate_bundle_offset",
            message: `Two index items share the same offset.`, evidenceRef: `${prev.cid} / ${item.cid}`
          }));
        }
      }
    }
    // Trailing bytes check: the last record must end exactly at decoded.length.
    // We can check this via the resolver's internal metadata which decodes
    // the varint. For a lightweight check without decoding every varint here,
    // only flag trailing bytes when the last offset + recordLength + max
    // plausible varint is still far from decoded.length.
    if (sorted.length > 0 && !options.allowTrailingBytes) {
      const lastItem = sorted[sorted.length - 1];
      const lastOffset = Number(lastItem.offset || 0);
      const lastRecordLength = Number(lastItem.recordLength || 0);
      // Varint max for record lengths up to ~2 GiB is 5 bytes. If
      // offset + recordLength + 5 is still short, trailing bytes are certain.
      const maxVarint = 5;
      if (lastOffset + lastRecordLength + maxVarint < decodedBytes.length) {
        failures.push(createVerificationFailure({
          layer: "proof-bundle", code: "trailing_bytes",
          message: `Bundle has at least ${decodedBytes.length - lastOffset - lastRecordLength - maxVarint} trailing bytes after the last record.`,
          evidenceRef: String(decodedBytes.length - lastOffset - lastRecordLength - maxVarint),
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
    trustPolicy: options.trustPolicy || "self-carried-manifest"
  });
  return {
    protocol: PACTIUM_PROTOCOL,
    bundleHash: bundle.bundleHash,
    ok: failures.length === 0 && envelopeResult.ok,
    failures: [...failures, ...resolver.readFailures, ...envelopeResult.failures],
    envelope: envelopeResult
  };
}
