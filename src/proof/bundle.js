import { PACTIUM_PROOF_BUNDLE_TYPE, PACTIUM_PROTOCOL, PACTIUM_TRUST_POLICIES } from "../protocol/constants.js";
import { asArray } from "../shared/records.js";
import { protocolHash } from "../protocol/hashing.js";
import { createVerificationFailure } from "../verification/failure.js";
import { bundleHashIndexForResolver, createIndexedBundleResolver } from "./bundle-format.js";
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

  const resolver = options.bundleResolver || createIndexedBundleResolver(bundle, { maxHeaderSize, maxBlockSize });
  failures.push(...resolver.indexFailures);

  // -- byteLength consistency --
  if (bundle.byteLength !== undefined && bundle.binaryBase64 !== undefined) {
    if (bundle.byteLength !== resolver.decodedByteLength) {
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

  const blockCids = resolver.blockCids;
  const bundleHashIndex = bundleHashIndexForResolver(resolver, bundle) || asArray(bundle.index).map((item) => ({
    cid: item.cid,
    offset: item.offset,
    recordLength: item.recordLength,
    headerLength: item.headerLength,
    byteLength: item.byteLength,
    payloadHash: item.payloadHash
  }));
  const expectedBundleHash = protocolHash("proof.bundle", {
    manifest: bundle.manifest,
    envelope: bundle.envelope,
    index: bundleHashIndex
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
  if (options.verifyAllBlocks === true) {
    failures.push(...resolver.verifyLayout({ allowTrailingBytes: options.allowTrailingBytes === true }));
    resolver.verifyAll();
  }
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
    trustPolicy: options.trustPolicy || PACTIUM_TRUST_POLICIES.trustedManifestRequired,
    requireFullStateMutationProofs: options.requireFullStateMutationProofs || false,
    maxProofLeafEntries: Number(options.maxProofLeafEntries || 0),
    maxProofBytes: Number(options.maxProofBytes || 0),
    failOnProofSizeWarning: options.failOnProofSizeWarning === true
  });
  return {
    protocol: PACTIUM_PROTOCOL,
    bundleHash: bundle.bundleHash,
    ok: failures.length === 0 && envelopeResult.ok,
    failures: [...failures, ...resolver.readFailures, ...envelopeResult.failures],
    envelope: envelopeResult
  };
}
