import { PACTIUM_PROTOCOL } from "../protocol/constants.js";
import { canonicalDecode, normalizeCanonicalValue } from "../canonical/value.js";
import { cidForBytes, createId, hashBytes, protocolHash } from "../protocol/hashing.js";
import { verifyLedgerConsistencyProof, verifyLedgerInclusionProof } from "../ledger/transparency-log.js";
import { verifyLedgerHeadSignature } from "../ledger/signed-head.js";
import { asArray, asRecord } from "../shared/records.js";
import { createVerificationFailure } from "../verification/failure.js";
import { createIndexedBundleResolver } from "./bundle-format.js";
import { createDefaultProofVerifierRegistry } from "./registry.js";

const CORE_CRITICAL_EXTENSIONS = new Set([]);

export async function createProofRef(storage, name, value, refs = []) {
  const block = await storage.putBlock(value, { kind: `proof-material:${name}`, refs });
  return {
    name,
    cid: block.cid,
    payloadHash: block.payloadHash,
    byteLength: block.byteLength
  };
}

function extensionSigningPayload(envelope) {
  return normalizeCanonicalValue({
    ...envelope,
    envelopeId: undefined,
    replayed: false,
    extensions: asArray(envelope.extensions).filter((extension) => extension.name !== "licolite.signature")
  });
}

function envelopeIdentityPayload(envelope) {
  return normalizeCanonicalValue({
    ...envelope,
    replayed: false,
    envelopeId: undefined
  });
}

export function envelopeSigningHash(envelope) {
  return protocolHash("proof.envelope.signing", extensionSigningPayload(envelope));
}

export function finalizeEnvelope(envelope) {
  const identity = envelopeIdentityPayload(envelope);
  return {
    ...envelope,
    envelopeId: createId("proof_envelope", identity)
  };
}

export async function materializeExtension(storage, extension) {
  if (!extension) return null;
  if (extension.valueRef && extension.valueHash) {
    return {
      protocol: PACTIUM_PROTOCOL,
      name: String(extension.name || ""),
      critical: extension.critical === true,
      valueRef: String(extension.valueRef),
      valueHash: String(extension.valueHash),
      metadata: normalizeCanonicalValue(asRecord(extension.metadata))
    };
  }
  const block = await storage.putBlock(extension.value ?? {}, {
    kind: `proof-extension:${extension.name || "extension"}`,
    refs: [
      ...asArray(extension.refs),
      extension.value?.evidenceRef || ""
    ].filter(Boolean)
  });
  return {
    protocol: PACTIUM_PROTOCOL,
    name: String(extension.name || ""),
    critical: extension.critical === true,
    valueRef: block.cid,
    valueHash: block.payloadHash,
    metadata: normalizeCanonicalValue(asRecord(extension.metadata))
  };
}

async function resolveBlock({ cid, storage, bundleMap }) {
  if (bundleMap?.has(cid)) {
    const record = await bundleMap.get(cid);
    if (!record) return null;
    const bytes = Buffer.from(String(record.payloadBase64 || ""), "base64");
    const payloadHash = `sha256:${hashBytes(bytes)}`;
    if (payloadHash !== record.payloadHash || cidForBytes(bytes) !== record.cid) {
      throw new Error(`Proof bundle block integrity failure for ${cid}`);
    }
    return { ...record, bytes };
  }
  return storage ? storage.getBlock(cid) : null;
}

async function decodeBlockValue(block) {
  if (!block) return null;
  if (block.codec === "raw") return block.bytes;
  return canonicalDecode(block.bytes);
}

function bundleBlockMap(bundle) {
  if (!bundle) return null;
  return createIndexedBundleResolver(bundle);
}

function proofIsCritical(proof) {
  return asRecord(proof).critical !== false;
}

async function verifyEmbeddedProofs({
  proofMaterial,
  registry,
  requireAllProofs,
  failures,
  checked
}) {
  async function visit(value, path) {
    if (Array.isArray(value)) {
      for (const [index, item] of value.entries()) await visit(item, `${path}[${index}]`);
      return;
    }
    if (!value || typeof value !== "object") return;
    if (value.proofType) {
      const proofType = String(value.proofType);
      const verifier = registry.get(proofType);
      if (!verifier) {
        if (requireAllProofs || proofIsCritical(value)) {
          failures.push(createVerificationFailure({
            layer: "proof-registry",
            code: "missing_proof_verifier",
            message: `No verifier is registered for proof type ${proofType}.`,
            evidenceRef: path,
            repairable: true,
            details: { proofType, path }
          }));
        }
      } else {
        try {
          const result = await verifier(value, {
            proofMaterial,
            head: proofMaterial?.ledger?.head,
            oldHead: proofMaterial?.ledger?.previousHead,
            newHead: proofMaterial?.ledger?.head
          });
          const ok = typeof result === "boolean" ? result : result?.ok === true;
          if (!ok) {
            failures.push(createVerificationFailure({
              layer: "proof-registry",
              code: "bad_embedded_proof",
              message: `Embedded proof ${proofType} does not verify.`,
              evidenceRef: path,
              details: { proofType, path }
            }));
          } else {
            checked.push(path);
          }
        } catch (error) {
          failures.push(createVerificationFailure({
            layer: "proof-registry",
            code: "proof_verifier_threw",
            message: error instanceof Error ? error.message : `Verifier for ${proofType} threw.`,
            evidenceRef: path,
            details: { proofType, path }
          }));
        }
      }
    }
    for (const [key, nested] of Object.entries(value)) {
      await visit(nested, path ? `${path}.${key}` : key);
    }
  }
  await visit(proofMaterial?.proofs || {}, "proofs");
}

function factRefBindings(envelope, proofMaterial) {
  const proof = proofMaterial?.ledger?.inclusionProof || {};
  const leaf = proof.leaf || {};
  const leafIndex = Number(leaf.index ?? proof.index);
  const leafHash = String(proof.leafHash || "");
  const expectedEventId = Number.isFinite(leafIndex) && leafHash
    ? createId("ledger_event", { index: leafIndex, leafHash })
    : "";
  return {
    ok: Boolean(expectedEventId) &&
      envelope.factRef?.ledgerEventId === expectedEventId &&
      Number(envelope.factRef?.ledgerIndex) === leafIndex &&
      envelope.factRef?.factCid === leaf.factCid &&
      envelope.factRef?.factHash === leaf.factHash &&
      envelope.factType === leaf.factType,
    expectedEventId,
    leafIndex
  };
}

function verifySemanticBindings({ envelope, proofMaterial, failures }) {
  const proofHead = proofMaterial?.ledger?.head || {};
  if (envelope.ledgerHead && (
    envelope.ledgerHead.rootHash !== proofHead.rootHash ||
    Number(envelope.ledgerHead.size || 0) !== Number(proofHead.size || 0)
  )) {
    failures.push(createVerificationFailure({
      layer: "proof-envelope",
      code: "bad_ledger_head_binding",
      message: "Envelope ledger head does not match the verified proof material head.",
      evidenceRef: envelope.envelopeId
    }));
  }

  const factBinding = factRefBindings(envelope, proofMaterial);
  if (!factBinding.ok) {
    failures.push(createVerificationFailure({
      layer: "proof-envelope",
      code: "bad_fact_ref_binding",
      message: "Envelope factRef does not match the verified Ledger inclusion leaf.",
      evidenceRef: envelope.envelopeId,
      details: {
        expectedLedgerEventId: factBinding.expectedEventId,
        expectedLedgerIndex: factBinding.leafIndex
      }
    }));
  }

  const proofs = proofMaterial?.proofs || {};
  function badBinding(code, message, details = {}) {
    failures.push(createVerificationFailure({
      layer: "proof-semantics",
      code,
      message,
      evidenceRef: envelope.envelopeId,
      details
    }));
  }
  function expectIndexProof(proof, { root = "", key = "", proofType = "", label = "" } = {}) {
    if (!proof) return;
    if (proofType && proof.proofType !== proofType) {
      badBinding("bad_index_proof_binding", `${label || "Index proof"} has the wrong proof type.`, {
        label,
        expectedProofType: proofType,
        actualProofType: proof.proofType
      });
    }
    if (root && proof.indexRoot !== root) {
      badBinding("bad_index_proof_binding", `${label || "Index proof"} does not bind to the declared root.`, {
        label,
        expectedRoot: root,
        actualRoot: proof.indexRoot
      });
    }
    if (key && proof.key !== key) {
      badBinding("bad_index_proof_binding", `${label || "Index proof"} does not bind to the declared key.`, {
        label,
        expectedKey: key,
        actualKey: proof.key
      });
    }
  }
  if (proofs.workspaceProjection) {
    expectIndexProof(proofs.workspaceProjection.orderProof, {
      root: proofs.workspaceProjection.orderRoot,
      key: proofs.workspaceProjection.orderKey,
      proofType: "index.membership.prolly-path",
      label: "workspace order proof"
    });
    expectIndexProof(proofs.workspaceProjection.membershipProof, {
      root: proofs.workspaceProjection.membershipRoot,
      key: envelope.factRef?.ledgerEventId || "",
      proofType: "index.membership.prolly-path",
      label: "workspace membership proof"
    });
  }
  const stateCommit = proofs.stateCommit;
  if (stateCommit) {
    const touchedKeyProofs = asArray(proofs.state?.touchedKeyProofs);
    const mutationKeys = asArray(stateCommit.mutationKeys).map(String).filter(Boolean);
    const mutationActions = asArray(stateCommit.mutationActions).map(String);
    const invalidStateCommit = stateCommit.factType !== "state.commit" ||
      stateCommit.intentId !== envelope.factId ||
      stateCommit.stateRoot !== proofs.state?.root ||
      Number(stateCommit.mutationCount || 0) !== mutationKeys.length ||
      mutationActions.length !== mutationKeys.length ||
      Number(stateCommit.touchedKeyCount || 0) !== touchedKeyProofs.length;
    if (invalidStateCommit) {
      failures.push(createVerificationFailure({
        layer: "proof-semantics",
        code: "bad_state_commit_binding",
        message: "State Commit material does not bind to the envelope outcome and state proof root.",
        evidenceRef: envelope.envelopeId
      }));
    }
  }
  for (const [index, proof] of asArray(proofs.state?.touchedKeyProofs).entries()) {
    const mutationKey = asArray(stateCommit?.mutationKeys)[index] || "";
    const mutationAction = asArray(stateCommit?.mutationActions)[index] || "";
    expectIndexProof(proof, {
      root: proofs.state?.root || "",
      key: String(mutationKey || proof?.key || ""),
      proofType: mutationAction === "delete" ? "index.non-membership.prolly-path" : "index.membership.prolly-path",
      label: `state touched key proof ${index}`
    });
  }

  const checkpointProof = proofs.checkpoint?.proof;
  if (checkpointProof) {
    expectIndexProof(checkpointProof, {
      root: proofs.checkpoint?.root || "",
      proofType: "index.membership.prolly-path",
      label: "checkpoint proof"
    });
    const metadata = checkpointProof.entry?.metadata || {};
    const isOutcome = envelope.envelopeKind === "operation-outcome";
    const invalidCheckpoint = metadata.ledgerEventId !== envelope.factRef?.ledgerEventId ||
      metadata.checkpointKind !== (isOutcome ? "outcome" : "intent") ||
      (isOutcome && (
        metadata.intentId !== envelope.factId ||
        metadata.outcomeId !== stateCommit?.outcomeId ||
        metadata.stateCommitId !== stateCommit?.stateCommitId
      )) ||
      (!isOutcome && metadata.intentId !== envelope.factId);
    if (invalidCheckpoint) {
      failures.push(createVerificationFailure({
        layer: "proof-semantics",
        code: "bad_checkpoint_binding",
        message: "Checkpoint proof metadata does not bind to the envelope fact.",
        evidenceRef: envelope.envelopeId
      }));
    }
  }
  const ledgerLeaf = proofMaterial?.ledger?.inclusionProof?.leaf || {};
  const causalityRefs = asArray(ledgerLeaf.causalityRefs).map(String);
  const causalityOutcomeId = String(stateCommit?.outcomeId || ledgerLeaf.outcomeId || "");
  for (const [index, proof] of asArray(proofs.causality?.proofs).entries()) {
    const expectedCausalityKey = causalityRefs[index] && causalityOutcomeId
      ? `${causalityRefs[index]}\u0000${causalityOutcomeId}`
      : "";
    expectIndexProof(proof, {
      root: proofs.causality?.root || "",
      key: expectedCausalityKey,
      proofType: "index.membership.prolly-path",
      label: `causality proof ${index}`
    });
  }
  if (proofs.openIntent) {
    expectIndexProof(proofs.openIntent, {
      key: envelope.factId,
      proofType: "index.membership.prolly-path",
      label: "open intent proof"
    });
  }
  if (proofs.outcome) {
    expectIndexProof(proofs.outcome, {
      key: stateCommit?.intentId || proofs.checkpoint?.proof?.entry?.metadata?.intentId || "",
      proofType: "index.membership.prolly-path",
      label: "outcome proof"
    });
  }
  if (proofs.openIntentRemoved) {
    expectIndexProof(proofs.openIntentRemoved, {
      key: stateCommit?.intentId || proofs.checkpoint?.proof?.entry?.metadata?.intentId || "",
      proofType: "index.non-membership.prolly-path",
      label: "open intent removal proof"
    });
  }
}

export async function verifyProofEnvelope(envelope, {
  storage = null,
  bundle = null,
  supportedCriticalExtensions = [],
  proofVerifiers = {},
  requireAllProofs = true,
  verifierManifest = null,
  ledgerHeadSignatures = [],
  bundleResolver = null,
  includeBundleResolverFailures = true
} = {}) {
  const failures = [];
  const checkedProofPaths = [];
  const supported = new Set([...CORE_CRITICAL_EXTENSIONS, ...supportedCriticalExtensions]);
  const bundleMap = bundleResolver || bundleBlockMap(bundle);
  if (!envelope || envelope.protocol !== PACTIUM_PROTOCOL || envelope.envelopeType !== "pactium.proof-envelope") {
    return {
      protocol: PACTIUM_PROTOCOL,
      ok: false,
      failures: [createVerificationFailure({
        layer: "proof-envelope",
        code: "malformed_envelope",
        message: "Proof Envelope is missing or has the wrong protocol."
      })]
    };
  }
  if (finalizeEnvelope(envelope).envelopeId !== envelope.envelopeId) {
    failures.push(createVerificationFailure({
      layer: "proof-envelope",
      code: "bad_envelope_id",
      message: "Proof Envelope id does not match its hash-bound body.",
      evidenceRef: envelope.envelopeId
    }));
  }
  for (const critical of asArray(envelope.criticalExtensions)) {
    if (!supported.has(critical)) {
      failures.push(createVerificationFailure({
        layer: "proof-extension",
        code: "unsupported_critical_extension",
        message: `Unsupported critical Proof Extension: ${critical}`,
        evidenceRef: critical,
        repairable: true
      }));
    }
  }
  let proofMaterial = null;
  for (const proofRef of asArray(envelope.proofRefs)) {
    let block = null;
    try {
      block = await resolveBlock({ cid: proofRef.cid, storage, bundleMap });
    } catch (error) {
      failures.push(createVerificationFailure({
        layer: "proof-material",
        code: "replaced_proof_material",
        message: error instanceof Error ? error.message : "Proof material ref was replaced or corrupted.",
        evidenceRef: proofRef.cid
      }));
      continue;
    }
    if (!block) {
      failures.push(createVerificationFailure({
        layer: "proof-material",
        code: "missing_proof_material",
        message: "Proof material ref is missing.",
        evidenceRef: proofRef.cid,
        repairable: true
      }));
      continue;
    }
    if (block.payloadHash !== proofRef.payloadHash || block.byteLength !== proofRef.byteLength) {
      failures.push(createVerificationFailure({
        layer: "proof-material",
        code: "replaced_proof_material",
        message: "Proof material ref was replaced or corrupted.",
        evidenceRef: proofRef.cid
      }));
      continue;
    }
    const value = await decodeBlockValue(block);
    if (value?.materialType === "pactium.proof-material") proofMaterial = value;
  }
  for (const extension of asArray(envelope.extensions)) {
    let block = null;
    try {
      block = await resolveBlock({ cid: extension.valueRef, storage, bundleMap });
    } catch (error) {
      failures.push(createVerificationFailure({
        layer: "proof-extension",
        code: "bad_extension_hash",
        message: error instanceof Error ? error.message : "Proof Extension material was replaced or corrupted.",
        evidenceRef: extension.valueRef
      }));
      continue;
    }
    if (!block) {
      failures.push(createVerificationFailure({
        layer: "proof-extension",
        code: "missing_extension_material",
        message: "Proof Extension material is missing.",
        evidenceRef: extension.valueRef,
        repairable: true
      }));
      continue;
    }
    if (block.payloadHash !== extension.valueHash) {
      failures.push(createVerificationFailure({
        layer: "proof-extension",
        code: "bad_extension_hash",
        message: "Proof Extension material hash does not match the envelope binding.",
        evidenceRef: extension.valueRef
      }));
    }
  }
  if (!proofMaterial?.ledger) {
    failures.push(createVerificationFailure({
      layer: "ledger",
      code: "missing_ledger_proof",
      message: "Proof Envelope has no Ledger inclusion material.",
      repairable: true
    }));
  } else {
    if (!verifyLedgerInclusionProof({
      head: proofMaterial.ledger.head,
      proof: proofMaterial.ledger.inclusionProof
    })) {
      failures.push(createVerificationFailure({
        layer: "ledger",
        code: "bad_ledger_inclusion",
        message: "Ledger inclusion proof does not verify.",
        evidenceRef: envelope.factRef?.ledgerEventId || ""
      }));
    }
    if (!verifyLedgerConsistencyProof({
      oldHead: proofMaterial.ledger.previousHead,
      newHead: proofMaterial.ledger.head,
      proof: proofMaterial.ledger.consistencyProof
    })) {
      failures.push(createVerificationFailure({
        layer: "ledger",
        code: "bad_ledger_consistency",
        message: "Ledger consistency proof does not verify.",
        repairable: true
      }));
    }
    const manifestForHead = verifierManifest || proofMaterial.ledger.verifierManifest || proofMaterial.ledger.head?.verifierManifest || null;
    const signaturesForHead = asArray(ledgerHeadSignatures).length > 0
      ? ledgerHeadSignatures
      : asArray(proofMaterial.ledger.ledgerHeadSignatures || proofMaterial.ledger.head?.signatures);
    if (manifestForHead) {
      const signatureResult = verifyLedgerHeadSignature(proofMaterial.ledger.head, manifestForHead, {
        signatures: signaturesForHead
      });
      failures.push(...signatureResult.failures);
      if (signatureResult.ok) checkedProofPaths.push("ledger-head-signature");
    }
  }
  if (proofMaterial) {
    verifySemanticBindings({ envelope, proofMaterial, failures });
    await verifyEmbeddedProofs({
      proofMaterial,
      registry: createDefaultProofVerifierRegistry(proofVerifiers),
      requireAllProofs,
      failures,
      checked: checkedProofPaths
    });
  }
  if (includeBundleResolverFailures && bundleMap?.failures) {
    failures.push(...bundleMap.failures);
  }
  return {
    protocol: PACTIUM_PROTOCOL,
    envelopeId: envelope.envelopeId,
    ok: failures.length === 0,
    failures,
    checked: [
      "envelope-id",
      "proof-material-refs",
      "critical-extensions",
      "ledger-inclusion",
      "ledger-consistency",
      ...checkedProofPaths
    ]
  };
}
