import crypto from "node:crypto";

import { PACTIUM_PROTOCOL, PACTIUM_SCHEMA_VERSION } from "../protocol/constants.js";
import { canonicalEncode, normalizeCanonicalValue } from "../canonical/value.js";
import { createId, protocolHash } from "../protocol/hashing.js";
import { asArray, asRecord, nowIso, safeText } from "../shared/records.js";
import { createVerificationFailure } from "../verification/failure.js";
import { verifyLedgerConsistencyProof } from "./transparency-log.js";

export function createVerifierManifest(input = {}) {
  const payload = {
    protocol: PACTIUM_PROTOCOL,
    schema: PACTIUM_SCHEMA_VERSION,
    manifestType: "pactium.verifier-manifest",
    signers: asArray(input.signers).map((signer) => ({
      signerId: safeText(signer.signerId),
      algorithm: safeText(signer.algorithm, "ed25519"),
      publicKey: safeText(signer.publicKey),
      validFrom: safeText(signer.validFrom),
      validTo: safeText(signer.validTo),
      roles: asArray(signer.roles).map(String)
    })).filter((signer) => signer.signerId && signer.publicKey),
    quorum: Math.max(1, Number(input.quorum || 1))
  };
  return {
    ...payload,
    manifestId: input.manifestId || createId("verifier_manifest", payload),
    manifestHash: protocolHash("verifier.manifest", payload)
  };
}

export function ledgerHeadSigningPayload(head = {}) {
  return normalizeCanonicalValue({
    protocol: PACTIUM_PROTOCOL,
    schema: PACTIUM_SCHEMA_VERSION,
    ledgerId: head.ledgerId || "pactium-operation-ledger",
    size: Number(head.size || 0),
    rootHash: safeText(head.rootHash),
    root: safeText(head.root),
    headId: safeText(head.headId),
    previousHeadId: safeText(head.previousHeadId),
    createdAt: safeText(head.createdAt)
  });
}

export function signLedgerHead(head = {}, {
  privateKey = "",
  signerId = "",
  manifest = null,
  createdAt = nowIso()
} = {}) {
  const resolvedManifest = manifest ? createVerifierManifest(manifest) : null;
  const payload = ledgerHeadSigningPayload(head);
  const signature = crypto.sign(null, Buffer.from(canonicalEncode(payload)), privateKey).toString("base64");
  return {
    protocol: PACTIUM_PROTOCOL,
    schema: PACTIUM_SCHEMA_VERSION,
    signatureType: "pactium.ledger-head-signature",
    signerId: safeText(signerId),
    algorithm: "ed25519",
    manifestId: resolvedManifest?.manifestId || safeText(manifest?.manifestId),
    manifestHash: resolvedManifest?.manifestHash || safeText(manifest?.manifestHash),
    headId: safeText(head.headId),
    signedPayloadHash: protocolHash("ledger.head.signing", payload),
    signature,
    createdAt
  };
}

export function verifyLedgerHeadSignature(head = {}, manifest = {}, options = {}) {
  const verifierManifest = manifest?.manifestType === "pactium.verifier-manifest"
    ? manifest
    : createVerifierManifest(manifest);
  const signatures = asArray(options.signatures || head.signatures || (head.signature ? [head.signature] : []));
  const failures = [];
  let accepted = 0;
  const acceptedSigners = new Set();
  const payload = ledgerHeadSigningPayload(head);
  const payloadBytes = Buffer.from(canonicalEncode(payload));
  for (const signature of signatures) {
    const record = asRecord(signature);
    const signer = asArray(verifierManifest.signers).find((candidate) => candidate.signerId === record.signerId);
    if (!signer) {
      failures.push(createVerificationFailure({
        layer: "ledger-head-signature",
        code: "unknown_signer",
        evidenceRef: record.signerId || ""
      }));
      continue;
    }
    if (record.manifestId && record.manifestId !== verifierManifest.manifestId) {
      failures.push(createVerificationFailure({
        layer: "ledger-head-signature",
        code: "signature_manifest_mismatch",
        evidenceRef: record.signerId || ""
      }));
      continue;
    }
    if (record.manifestHash && record.manifestHash !== verifierManifest.manifestHash) {
      failures.push(createVerificationFailure({
        layer: "ledger-head-signature",
        code: "signature_manifest_mismatch",
        evidenceRef: record.signerId || ""
      }));
      continue;
    }
    if (acceptedSigners.has(record.signerId)) {
      failures.push(createVerificationFailure({
        layer: "ledger-head-signature",
        code: "duplicate_signature_signer",
        evidenceRef: record.signerId || ""
      }));
      continue;
    }
    if (signer.algorithm !== "ed25519" || record.algorithm !== "ed25519") {
      failures.push(createVerificationFailure({
        layer: "ledger-head-signature",
        code: "unsupported_signature_algorithm",
        evidenceRef: record.signerId || ""
      }));
      continue;
    }
    if (!asArray(signer.roles).includes("ledger-head")) {
      failures.push(createVerificationFailure({
        layer: "ledger-head-signature",
        code: "signer_role_missing",
        evidenceRef: record.signerId || ""
      }));
      continue;
    }
    if (record.signedPayloadHash !== protocolHash("ledger.head.signing", payload)) {
      failures.push(createVerificationFailure({
        layer: "ledger-head-signature",
        code: "bad_signed_head_payload",
        evidenceRef: record.signerId || ""
      }));
      continue;
    }
    const ok = crypto.verify(
      null,
      payloadBytes,
      signer.publicKey,
      Buffer.from(String(record.signature || ""), "base64")
    );
    if (ok) {
      accepted += 1;
      acceptedSigners.add(record.signerId);
    }
    else {
      failures.push(createVerificationFailure({
        layer: "ledger-head-signature",
        code: "bad_head_signature",
        evidenceRef: record.signerId || ""
      }));
    }
  }
  if (accepted < Number(verifierManifest.quorum || 1)) {
    failures.push(createVerificationFailure({
      layer: "ledger-head-signature",
      code: "manifest_quorum_not_met",
      details: { accepted, quorum: verifierManifest.quorum || 1 }
    }));
  }
  return {
    protocol: PACTIUM_PROTOCOL,
    ok: failures.length === 0,
    accepted,
    failures
  };
}

export function advanceTrustedHead({
  oldHead = {},
  newHead = {},
  proof = {},
  manifest = null,
  signatures = []
} = {}) {
  const failures = [];
  if (!verifyLedgerConsistencyProof({ oldHead, newHead, proof })) {
    failures.push(createVerificationFailure({
      layer: "trusted-head",
      code: "bad_trusted_head_consistency",
      message: "New Ledger head does not extend the old trusted head."
    }));
  }
  if (manifest) {
    const signatureResult = verifyLedgerHeadSignature(newHead, manifest, { signatures });
    failures.push(...signatureResult.failures);
  }
  if (failures.length > 0) {
    return { protocol: PACTIUM_PROTOCOL, ok: false, failures };
  }
  return {
    protocol: PACTIUM_PROTOCOL,
    ok: true,
    trustStoreType: "pactium.trusted-head-store",
    ledgerId: newHead.ledgerId || oldHead.ledgerId || "pactium-operation-ledger",
    lastTrustedHead: newHead,
    verifierManifestRef: manifest?.manifestId || "",
    updatedAt: nowIso(),
    failures: []
  };
}
