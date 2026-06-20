import { PACTIUM_PROTOCOL } from "../../protocol/constants.js";
import { canonicalDecode } from "../../canonical/value.js";
import { envelopeSigningHash, verifyProofEnvelope } from "../../proof/envelope.js";
import { verifyProofBundle } from "../../proof/bundle.js";
import { createIndexedBundleResolver } from "../../proof/bundle-format.js";
import { createPactium } from "../../core/pactium-core.js";
import { createRepairPlanner } from "../../repair/planner.js";
import { createVerificationFailure } from "../../verification/failure.js";
import { asArray, safeText } from "../../shared/records.js";
import {
  LICOLITE_ASPECT_PROTOCOL,
  LICOLITE_CRITICAL_EXTENSIONS,
  LICOLITE_POLICY_EXTENSION,
  LICOLITE_SIGNATURE_EXTENSION,
  LICOLITE_SUPPORTED_CRITICAL_EXTENSIONS,
  LICOLITE_WORKSPACE_EFFECT_EXTENSION
} from "./constants.js";
import { createLicoLiteSigner } from "./signing.js";
import { materializeEvidenceExtension } from "./evidence.js";

async function attachSignature({ pactium, envelope, signer }) {
  if (!signer) return envelope;
  const signedEnvelopeHash = envelopeSigningHash(envelope);
  const signature = await signer.sign(signedEnvelopeHash);
  const signatureExtension = await pactium.createExtension({
    name: LICOLITE_SIGNATURE_EXTENSION,
    critical: false,
    value: {
      protocol: LICOLITE_ASPECT_PROTOCOL,
      signerId: signer.signerId || "licolite-signer",
      algorithm: signer.algorithm || "hmac-sha256",
      signedEnvelopeHash,
      signature
    }
  });
  return pactium.storeEnvelope({
    ...envelope,
    extensions: [...asArray(envelope.extensions), signatureExtension]
  });
}

function bundleBlockMap(bundle) {
  if (!bundle) return null;
  return createIndexedBundleResolver(bundle);
}

async function resolveMaterialBlock({ core, cid, bundleMap }) {
  const bundled = await bundleMap?.get(cid);
  if (bundled) {
    return {
      ...bundled,
      bytes: Buffer.from(String(bundled.payloadBase64 || ""), "base64")
    };
  }
  return core.storage.getBlock(cid);
}

export function createLicoLiteAspect({
  pactium = null,
  dataDir = "",
  userDataPath = "",
  inMemory = false,
  evidencePolicy = "production",
  signer = null,
  signerSecret = ""
} = {}) {
  const core = pactium || createPactium({ dataDir, userDataPath, inMemory });
  const hasExplicitSignerSecret = safeText(signerSecret) !== "";
  const resolvedSigner = signer === false
    ? null
    : signer || (hasExplicitSignerSecret || evidencePolicy !== "production"
      ? createLicoLiteSigner({ secret: signerSecret || "licolite-development-signer" })
      : null);
  const verifierSigner = resolvedSigner;
  const repairPlanner = createRepairPlanner();

  async function recordWorkspaceOperation(input = {}) {
    const workspaceId = safeText(input.workspaceId || input.scope, "default");
    const policyEvidence = input.policyEvidence ?? input.policy;
    const effectEvidence = input.workspaceEffectEvidence ?? input.effectEvidence ?? input.workspaceEffect;
    if (evidencePolicy === "production" && !policyEvidence) {
      throw new Error("LicoLite production evidence policy requires policy evidence.");
    }
    if (evidencePolicy === "production" && !effectEvidence) {
      throw new Error("LicoLite production evidence policy requires workspace effect evidence.");
    }
    if (evidencePolicy === "production" && !resolvedSigner) {
      throw new Error("LicoLite production evidence policy requires an explicit signer or signerSecret.");
    }
    const policyExtension = await materializeEvidenceExtension(core, {
      name: LICOLITE_POLICY_EXTENSION,
      evidence: policyEvidence || { missing: true, policy: "opportunistic" },
      metadata: { workspaceId }
    });
    const effectExtension = await materializeEvidenceExtension(core, {
      name: LICOLITE_WORKSPACE_EFFECT_EXTENSION,
      evidence: effectEvidence || { missing: true, policy: "opportunistic" },
      metadata: { workspaceId }
    });
    const envelope = await core.recordOperation({
      ...input,
      workspaceId,
      extensions: [
        policyExtension,
        effectExtension,
        ...asArray(input.extensions)
      ],
      stateMutations: input.stateMutations || input.state?.mutations || []
    });
    return attachSignature({ pactium: core, envelope, signer: resolvedSigner });
  }

  async function verifyLicoLiteEnvelope(envelope, options = {}) {
    const bundleMap = bundleBlockMap(options.bundle || null);
    const coreResult = await verifyProofEnvelope(envelope, {
      storage: core.storage,
      bundle: options.bundle || null,
      supportedCriticalExtensions: LICOLITE_SUPPORTED_CRITICAL_EXTENSIONS,
      proofVerifiers: options.proofVerifiers || {},
      requireAllProofs: options.requireAllProofs !== false,
      verifierManifest: options.verifierManifest || null,
      ledgerHeadSignatures: options.ledgerHeadSignatures || []
    });
    const failures = [...coreResult.failures];
    const extensions = asArray(envelope?.extensions);
    const extensionNames = new Set(extensions.map((extension) => extension.name));
    const criticalExtensionNames = new Set(asArray(envelope?.criticalExtensions).map(String));
    for (const required of LICOLITE_CRITICAL_EXTENSIONS) {
      const extension = extensions.find((candidate) => candidate.name === required);
      if (!extensionNames.has(required)) {
        failures.push(createVerificationFailure({
          layer: "licolite",
          code: `missing_${required.replace(/\W+/g, "_")}`,
          message: `LicoLite Proof Envelope is missing required critical extension ${required}.`,
          evidenceRef: envelope?.envelopeId || "",
          repairable: evidencePolicy !== "production"
        }));
      } else if (extension?.critical !== true || !criticalExtensionNames.has(required)) {
        failures.push(createVerificationFailure({
          layer: "licolite",
          code: "noncritical_required_extension",
          message: `LicoLite required extension ${required} must be critical and listed in criticalExtensions.`,
          evidenceRef: envelope?.envelopeId || "",
          repairable: true
        }));
      }
    }
    for (const extension of extensions.filter((candidate) =>
      candidate.name === LICOLITE_POLICY_EXTENSION || candidate.name === LICOLITE_WORKSPACE_EFFECT_EXTENSION
    )) {
      const extensionBlock = await resolveMaterialBlock({ core, cid: extension.valueRef, bundleMap });
      const extensionValue = extensionBlock ? canonicalDecode(extensionBlock.bytes || Buffer.from(extensionBlock.payloadBase64, "base64")) : null;
      const evidenceRef = extensionValue?.evidenceRef || extension.metadata?.evidenceRef || "";
      const evidenceHash = extensionValue?.evidenceHash || extension.metadata?.evidenceHash || "";
      if (!evidenceRef || !evidenceHash) {
        failures.push(createVerificationFailure({
          layer: "licolite.evidence",
          code: "missing_evidence_ref",
          evidenceRef: extension.valueRef,
          repairable: true
        }));
        continue;
      }
      const evidenceBlock = await resolveMaterialBlock({ core, cid: evidenceRef, bundleMap });
      if (!evidenceBlock) {
        failures.push(createVerificationFailure({
          layer: "licolite.evidence",
          code: "missing_evidence_material",
          evidenceRef,
          repairable: true
        }));
      } else if (evidenceBlock.payloadHash !== evidenceHash) {
        failures.push(createVerificationFailure({
          layer: "licolite.evidence",
          code: "bad_evidence_hash",
          evidenceRef
        }));
      }
    }
    const signatureExtension = asArray(envelope?.extensions).find((extension) => extension.name === LICOLITE_SIGNATURE_EXTENSION);
    if (evidencePolicy === "production" && !verifierSigner) {
      failures.push(createVerificationFailure({
        layer: "licolite.signing",
        code: "missing_signature_verifier",
        message: "LicoLite production verification requires an explicit signer or signerSecret.",
        evidenceRef: envelope?.envelopeId || "",
        repairable: true
      }));
    }
    if (!signatureExtension) {
      failures.push(createVerificationFailure({
        layer: "licolite.signing",
        code: "missing_signature",
        message: "LicoLite signing is enabled by default and no signature extension was found.",
        evidenceRef: envelope?.envelopeId || "",
        repairable: evidencePolicy !== "production"
      }));
    } else {
      const block = await resolveMaterialBlock({ core, cid: signatureExtension.valueRef, bundleMap });
      const value = block ? canonicalDecode(block.bytes || Buffer.from(block.payloadBase64, "base64")) : null;
      if (!value) {
        failures.push(createVerificationFailure({
          layer: "licolite.signing",
          code: "missing_signature_material",
          evidenceRef: signatureExtension.valueRef,
          repairable: true
        }));
      } else if (value.signedEnvelopeHash !== envelopeSigningHash(envelope)) {
        failures.push(createVerificationFailure({
          layer: "licolite.signing",
          code: "bad_signed_envelope_hash",
          evidenceRef: signatureExtension.valueRef
        }));
      } else if (verifierSigner && value.signerId !== (verifierSigner.signerId || "licolite-signer")) {
        failures.push(createVerificationFailure({
          layer: "licolite.signing",
          code: "bad_signature_signer",
          evidenceRef: signatureExtension.valueRef
        }));
      } else if (verifierSigner && value.algorithm !== (verifierSigner.algorithm || "hmac-sha256")) {
        failures.push(createVerificationFailure({
          layer: "licolite.signing",
          code: "bad_signature_algorithm",
          evidenceRef: signatureExtension.valueRef
        }));
      } else if (!verifierSigner) {
        failures.push(createVerificationFailure({
          layer: "licolite.signing",
          code: "signature_verifier_unconfigured",
          message: "LicoLite signature material cannot be verified without an explicit signer or signerSecret.",
          evidenceRef: signatureExtension.valueRef,
          repairable: true
        }));
      } else if (verifierSigner && !(await verifierSigner.verify(value.signedEnvelopeHash, value.signature))) {
        failures.push(createVerificationFailure({
          layer: "licolite.signing",
          code: "bad_signature",
          evidenceRef: signatureExtension.valueRef
        }));
      }
    }
    return {
      protocol: PACTIUM_PROTOCOL,
      aspect: LICOLITE_ASPECT_PROTOCOL,
      envelopeId: envelope?.envelopeId || "",
      ok: failures.length === 0,
      failures,
      checked: [
        ...asArray(coreResult.checked),
        "licolite-critical-policy-extension",
        "licolite-critical-workspace-effect-extension",
        "licolite-signature",
        "licolite-workspace-projection"
      ]
    };
  }

  async function verifyLicoLiteBundle(bundle, options = {}) {
    const bundleResult = await verifyProofBundle(bundle, {
      supportedCriticalExtensions: LICOLITE_SUPPORTED_CRITICAL_EXTENSIONS,
      ...options
    });
    const envelopeResult = await verifyLicoLiteEnvelope(bundle?.envelope || {}, {
      ...options,
      bundle
    });
    return {
      protocol: PACTIUM_PROTOCOL,
      aspect: LICOLITE_ASPECT_PROTOCOL,
      ok: bundleResult.ok && envelopeResult.ok,
      failures: [...bundleResult.failures, ...envelopeResult.failures],
      bundle: bundleResult,
      envelope: envelopeResult
    };
  }

  function planRepair(failures = []) {
    return repairPlanner.plan(failures);
  }

  return Object.freeze({
    protocol: LICOLITE_ASPECT_PROTOCOL,
    core,
    evidencePolicy,
    workspaceProjectionDefault: true,
    criticalExtensions: LICOLITE_CRITICAL_EXTENSIONS,
    supportedCriticalExtensions: LICOLITE_SUPPORTED_CRITICAL_EXTENSIONS,
    signer: resolvedSigner,
    recordWorkspaceOperation,
    recordOperation: recordWorkspaceOperation,
    verifyLicoLiteEnvelope,
    verifyEnvelope: verifyLicoLiteEnvelope,
    verifyLicoLiteBundle,
    verifyBundle: verifyLicoLiteBundle,
    planRepair,
    getWorkspaceProjection: core.getWorkspaceProjection,
    proveWorkspaceMembership: core.proveWorkspaceMembership,
    exportProofBundle: core.exportProofBundle
  });
}

export async function recordLicoLiteWorkspaceOperation(input = {}, options = {}) {
  return createLicoLiteAspect(options).recordWorkspaceOperation(input);
}

export async function verifyLicoLiteEnvelope(envelope, options = {}) {
  return createLicoLiteAspect(options).verifyLicoLiteEnvelope(envelope, options);
}

export async function verifyLicoLiteBundle(bundle, options = {}) {
  return createLicoLiteAspect(options).verifyLicoLiteBundle(bundle, options);
}
