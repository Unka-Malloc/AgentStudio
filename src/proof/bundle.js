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
  const resolver = createIndexedBundleResolver(bundle, { maxHeaderSize, maxBlockSize });
  failures.push(...resolver.indexFailures);
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
    ledgerHeadSignatures: options.ledgerHeadSignatures || []
  });
  return {
    protocol: PACTIUM_PROTOCOL,
    bundleHash: bundle.bundleHash,
    ok: failures.length === 0 && envelopeResult.ok,
    failures: [...failures, ...resolver.readFailures, ...envelopeResult.failures],
    envelope: envelopeResult
  };
}
