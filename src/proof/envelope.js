import { PACTIUM_PROOF_TYPES, PACTIUM_PROTOCOL, PACTIUM_TRUST_POLICIES } from "../protocol/constants.js";
import { canonicalDecode, canonicalString, normalizeCanonicalValue } from "../canonical/value.js";
import { cidForBytes, createId, hashBytes, protocolHash } from "../protocol/hashing.js";
import { verifyLedgerConsistencyProof, verifyLedgerInclusionProof } from "../ledger/transparency-log.js";
import { verifyLedgerHeadSignature } from "../ledger/signed-head.js";
import { asArray, asRecord } from "../shared/records.js";
import { createVerificationFailure } from "../verification/failure.js";
import { createIndexedBundleResolver } from "./bundle-format.js";
import { createDefaultProofVerifierRegistry } from "./registry.js";

const CORE_CRITICAL_EXTENSIONS = new Set([]);

const REQUIRED_PROOF_SCHEMA = Object.freeze({
  "operation-intent": Object.freeze([
    { path: "ledger.inclusionProof", proofType: PACTIUM_PROOF_TYPES.ledgerInclusion, label: "ledger inclusion proof" },
    { path: "ledger.consistencyProof", proofType: PACTIUM_PROOF_TYPES.ledgerConsistency, label: "ledger consistency proof" },
    { path: "proofs.openIntent", proofType: PACTIUM_PROOF_TYPES.indexMembership, label: "open intent membership proof" },
    { path: "proofs.workspaceProjection.orderProof", proofType: PACTIUM_PROOF_TYPES.indexMembership, label: "workspace order membership proof" },
    { path: "proofs.workspaceProjection.membershipProof", proofType: PACTIUM_PROOF_TYPES.indexMembership, label: "workspace membership proof" },
    { path: "proofs.checkpoint.proof", proofType: PACTIUM_PROOF_TYPES.indexMembership, label: "checkpoint membership proof" }
  ]),
  "operation-outcome": Object.freeze([
    { path: "ledger.inclusionProof", proofType: PACTIUM_PROOF_TYPES.ledgerInclusion, label: "ledger inclusion proof" },
    { path: "ledger.consistencyProof", proofType: PACTIUM_PROOF_TYPES.ledgerConsistency, label: "ledger consistency proof" },
    { path: "proofs.outcome", proofType: PACTIUM_PROOF_TYPES.indexMembership, label: "outcome membership proof" },
    { path: "proofs.openIntentRemoved", proofType: PACTIUM_PROOF_TYPES.indexNonMembership, label: "open intent non-membership proof" },
    { path: "proofs.workspaceProjection.orderProof", proofType: PACTIUM_PROOF_TYPES.indexMembership, label: "workspace order membership proof" },
    { path: "proofs.workspaceProjection.membershipProof", proofType: PACTIUM_PROOF_TYPES.indexMembership, label: "workspace membership proof" },
    { path: "proofs.stateCommit", proofType: null, label: "state commit material" },
    { path: "proofs.checkpoint.proof", proofType: PACTIUM_PROOF_TYPES.indexMembership, label: "checkpoint membership proof" }
  ]),
  "operation-receipt": Object.freeze([
    { path: "ledger.inclusionProof", proofType: PACTIUM_PROOF_TYPES.ledgerInclusion, label: "ledger inclusion proof" },
    { path: "ledger.consistencyProof", proofType: PACTIUM_PROOF_TYPES.ledgerConsistency, label: "ledger consistency proof" },
    { path: "proofs.receipt.proof", proofType: PACTIUM_PROOF_TYPES.indexMembership, label: "receipt membership proof" }
  ])
});

export async function createProofRef(storage, name, value, refs = []) {
  const block = await storage.putBlock(value, { kind: `proof-material:${name}`, refs });
  return {
    name,
    cid: block.cid,
    payloadHash: block.payloadHash,
    byteLength: block.byteLength
  };
}

export function compactProofMaterialTables(material) {
  const descriptorTable = [];
  const descriptorIndexes = new Map();
  const leafTable = [];
  const leafIndexes = new Map();
  function descriptorRefFor(descriptor) {
    // canonicalString normalizes while serializing, so the descriptor is only
    // deep-normalized when it first enters the table.
    const key = canonicalString(descriptor);
    if (!descriptorIndexes.has(key)) {
      descriptorIndexes.set(key, descriptorTable.length);
      descriptorTable.push(normalizeCanonicalValue(descriptor));
    }
    return descriptorIndexes.get(key);
  }
  function leafRefFor(record) {
    const key = canonicalString(record);
    if (!leafIndexes.has(key)) {
      leafIndexes.set(key, leafTable.length);
      leafTable.push(normalizeCanonicalValue(record));
    }
    return leafIndexes.get(key);
  }
  function visit(value, inheritedDomain = "") {
    if (Array.isArray(value)) {
      for (const item of value) visit(item, inheritedDomain);
      return;
    }
    if (!value || typeof value !== "object") return;
    const activeDomain = String(value.domain || inheritedDomain || "");
    const table = Array.isArray(value.descriptorTable) ? value.descriptorTable : [];
    if (table.length > 0) {
      for (const pathItem of asArray(value.path)) {
        pathItem.siblingDescriptorRefs = asArray(pathItem.siblingDescriptorRefs)
          .map((ref) => table[Number(ref)])
          .filter(Boolean)
          .map(descriptorRefFor);
      }
      for (const leaf of asArray(value.leaves)) {
        for (const pathItem of asArray(leaf.path)) {
          pathItem.siblingDescriptorRefs = asArray(pathItem.siblingDescriptorRefs)
            .map((ref) => table[Number(ref)])
            .filter(Boolean)
            .map(descriptorRefFor);
        }
      }
      delete value.descriptorTable;
      value.descriptorTableScope = "proof-material";
    }
    if (value.leafNode && typeof value.leafNode === "object" && value.leafRoot && value.leafRootHash) {
      value.leafRef = leafRefFor({
        domain: activeDomain,
        leafRoot: String(value.leafRoot),
        leafRootHash: String(value.leafRootHash),
        leafNode: value.leafNode
      });
      value.leafTableScope = "proof-material";
      delete value.leafNode;
      delete value.leafRoot;
      delete value.leafRootHash;
    }
    for (const key of Object.keys(value).sort()) visit(value[key], activeDomain);
  }
  const compacted = normalizeCanonicalValue(material);
  visit(compacted.proofs || {});
  if (descriptorTable.length > 0) compacted.proofDescriptorTable = descriptorTable;
  if (leafTable.length > 0) compacted.proofLeafTable = leafTable;
  return compacted;
}

function envelopeIdentityPayload(envelope) {
  return {
    ...envelope,
    replayed: false,
    disposition: undefined,
    envelopeId: undefined
  };
}

export function finalizeEnvelope(envelope) {
  const extensions = asArray(envelope.extensions);
  const seenNames = new Set();
  for (const extension of extensions) {
    const name = String(extension.name || "");
    if (!name) continue;
    if (seenNames.has(name)) {
      throw new Error(`Duplicate extension name in Proof Envelope: ${name}`);
    }
    seenNames.add(name);
  }
  const criticalExtensions = extensions
    .filter((extension) => extension.critical === true)
    .map((extension) => String(extension.name || ""))
    .filter(Boolean);
  const identity = envelopeIdentityPayload({ ...envelope, criticalExtensions, extensions });
  return {
    ...envelope,
    criticalExtensions,
    extensions,
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

function resolveProofAtPath(proofMaterial, path) {
  const segments = path.split(".");
  let current = proofMaterial;
  for (const segment of segments) {
    if (!current || typeof current !== "object") return undefined;
    current = current[segment];
  }
  return current;
}

function assertRequiredProofs({ envelopeKind, proofMaterial, requireAllProofs, failures }) {
  const schema = REQUIRED_PROOF_SCHEMA[envelopeKind];
  if (!schema) {
    if (requireAllProofs) {
      failures.push(createVerificationFailure({
        layer: "proof-schema",
        code: "unknown_envelope_kind",
        message: `Unknown envelope kind "${envelopeKind}" — cannot validate required proofs.`,
        evidenceRef: envelopeKind || ""
      }));
    }
    return;
  }
  for (const entry of schema) {
    const proof = resolveProofAtPath(proofMaterial, entry.path);
    if (proof === undefined || proof === null) {
      failures.push(createVerificationFailure({
        layer: "proof-schema",
        code: "missing_required_proof",
        message: `Required proof is missing: ${entry.label} (${entry.path}).`,
        evidenceRef: `${envelopeKind}:${entry.path}`,
        repairable: true,
        details: { envelopeKind, path: entry.path, requiredProofType: entry.proofType }
      }));
    } else if (entry.proofType && proof.proofType !== entry.proofType) {
      failures.push(createVerificationFailure({
        layer: "proof-schema",
        code: "bad_proof_type",
        message: `Required proof ${entry.label} has wrong proof type: expected ${entry.proofType}, got ${proof.proofType}.`,
        evidenceRef: `${envelopeKind}:${entry.path}`,
        details: { envelopeKind, path: entry.path, expectedProofType: entry.proofType, actualProofType: proof.proofType }
      }));
    }
  }
}

async function verifyEmbeddedProofs({
  proofMaterial,
  registry,
  requireAllProofs,
  failures,
  checked,
  failOnProofSizeWarning = false
}) {
  const visitedObjects = new WeakSet();
  async function visit(value, path) {
    if (value && typeof value === "object") {
      if (visitedObjects.has(value)) return;
      visitedObjects.add(value);
    }
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
            // Check for proofSizeWarning in the verifier result or the proof value itself
            const warning = result?.proofSizeWarning || value?.proofSizeWarning || null;
            if (warning) {
              const failure = createVerificationFailure({
                layer: "proof-registry",
                code: "proof_size_warning",
                message: warning.message || `Proof ${proofType} exceeds size guard.`,
                evidenceRef: path,
                severity: failOnProofSizeWarning ? "error" : "warning",
                details: { proofType, path, ...warning }
              });
              failures.push(failure);
            }
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

async function resolveLedgerFact({ proofMaterial, storage, bundleMap, failures }) {
  const leaf = proofMaterial?.ledger?.inclusionProof?.leaf || {};
  if (!leaf.factCid) return null;
  let block = null;
  try {
    block = await resolveBlock({ cid: leaf.factCid, storage, bundleMap });
  } catch (error) {
    failures.push(createVerificationFailure({
      layer: "ledger",
      code: "replaced_ledger_fact",
      message: error instanceof Error ? error.message : "Ledger fact material was replaced or corrupted.",
      evidenceRef: leaf.factCid
    }));
    return null;
  }
  if (!block) {
    failures.push(createVerificationFailure({
      layer: "ledger",
      code: "missing_ledger_fact_material",
      message: "Ledger fact material is missing.",
      evidenceRef: leaf.factCid,
      repairable: true
    }));
    return null;
  }
  if (block.cid !== leaf.factCid || block.payloadHash !== leaf.factHash) {
    failures.push(createVerificationFailure({
      layer: "ledger",
      code: "bad_ledger_fact_material",
      message: "Ledger fact material does not match the verified Ledger leaf.",
      evidenceRef: leaf.factCid
    }));
    return null;
  }
  return decodeBlockValue(block);
}

function mutationDescriptor(value = {}) {
  return {
    key: String(value.key || ""),
    action: String(value.action || "put"),
    valueRef: String(value.valueRef || ""),
    valueHash: String(value.valueHash || ""),
    metadata: normalizeCanonicalValue(asRecord(value.metadata))
  };
}

function verifySemanticBindings({ envelope, proofMaterial, ledgerFact = null, failures }) {
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
  const appendConditionHash = String(proofMaterial?.appendCondition?.conditionHash || "");
  if (ledgerFact) {
    if (ledgerFact.factType !== envelope.factType) {
      badBinding("bad_ledger_fact_binding", "Ledger fact type does not match the envelope fact type.", {
        expectedFactType: envelope.factType,
        actualFactType: ledgerFact.factType
      });
    }
    if (String(ledgerFact.appendConditionHash || "") !== appendConditionHash) {
      badBinding("bad_append_condition_binding", "Proof append condition does not match the Ledger fact appendConditionHash.", {
        expectedAppendConditionHash: ledgerFact.appendConditionHash || "",
        actualAppendConditionHash: appendConditionHash
      });
    }
    if (proofMaterial?.appendCondition?.workspaceId && ledgerFact.workspaceId &&
      proofMaterial.appendCondition.workspaceId !== ledgerFact.workspaceId) {
      badBinding("bad_append_condition_binding", "Proof append condition workspace does not match the Ledger fact workspace.", {
        expectedWorkspaceId: ledgerFact.workspaceId,
        actualWorkspaceId: proofMaterial.appendCondition.workspaceId
      });
    }
  }
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
      proofType: PACTIUM_PROOF_TYPES.indexMembership,
      label: "workspace order proof"
    });
    expectIndexProof(proofs.workspaceProjection.membershipProof, {
      root: proofs.workspaceProjection.membershipRoot,
      key: envelope.factRef?.ledgerEventId || "",
      proofType: PACTIUM_PROOF_TYPES.indexMembership,
      label: "workspace membership proof"
    });
  }
  const stateCommit = proofs.stateCommit;
  if (stateCommit) {
    const touchedKeyProofs = asArray(proofs.state?.touchedKeyProofs);
    const mutationDescriptors = asArray(stateCommit.mutations).map(mutationDescriptor);
    const mutationKeys = asArray(stateCommit.mutationKeys).map(String).filter(Boolean);
    const mutationActions = asArray(stateCommit.mutationActions).map(String);
    const proofProfile = asRecord(stateCommit.proofProfile);
    const provedKeyCount = Number(proofProfile.provedKeyCount ?? stateCommit.provedKeyCount ?? 0);
    const totalUniqueKeyCount = Number(proofProfile.totalUniqueKeyCount ?? stateCommit.mutationCount ?? 0);
    const expectedStateCommitId = createId("state_commit", {
      outcomeId: stateCommit.outcomeId,
      stateRoot: stateCommit.stateRoot,
      mutations: mutationDescriptors
    });
    const invalidStateCommit = stateCommit.factType !== "state.commit" ||
      stateCommit.intentId !== envelope.factId ||
      stateCommit.stateCommitId !== expectedStateCommitId ||
      (ledgerFact && (
        stateCommit.outcomeId !== ledgerFact.outcomeId ||
        stateCommit.intentId !== ledgerFact.intentId ||
        stateCommit.workspaceId !== ledgerFact.workspaceId
      )) ||
      stateCommit.stateRoot !== proofs.state?.root ||
      Number(stateCommit.mutationCount || 0) !== mutationDescriptors.length ||
      mutationKeys.length !== mutationDescriptors.length ||
      mutationActions.length !== mutationDescriptors.length ||
      mutationKeys.some((key, index) => key !== mutationDescriptors[index]?.key) ||
      mutationActions.some((action, index) => action !== mutationDescriptors[index]?.action) ||
      provedKeyCount !== touchedKeyProofs.length ||
      provedKeyCount > mutationDescriptors.length ||
      totalUniqueKeyCount !== mutationDescriptors.length ||
      !["sampled", "full"].includes(String(proofProfile.mode || stateCommit.mutationProofMode || ""));
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
      proofType: mutationAction === "delete" ? PACTIUM_PROOF_TYPES.indexNonMembership : PACTIUM_PROOF_TYPES.indexMembership,
      label: `state touched key proof ${index}`
    });
  }

  const checkpointProof = proofs.checkpoint?.proof;
  if (checkpointProof) {
    expectIndexProof(checkpointProof, {
      root: proofs.checkpoint?.root || "",
      proofType: PACTIUM_PROOF_TYPES.indexMembership,
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
  const causalityRefs = asArray(ledgerFact?.causalityRefs).map(String);
  const causalityFactId = String(ledgerFact?.outcomeId || ledgerFact?.intentId || ledgerFact?.receiptId || "");
  const expectedCausalityKeys = causalityRefs
    .map((ref) => causalityFactId ? `${ref}\u0000${causalityFactId}` : "")
    .filter(Boolean)
    .sort();
  const causalityMultiproof = proofs.causality?.multiproof || null;
  if (asArray(proofs.causality?.proofs).length > 0) {
    badBinding(
      "bad_causality_multiproof_binding",
      "Causality material must use the current membership multiproof layout."
    );
  }
  if (expectedCausalityKeys.length > 0) {
    const actualKeys = asArray(causalityMultiproof?.keys).map(String);
    const invalidMultiproof = !causalityMultiproof ||
      causalityMultiproof.proofType !== PACTIUM_PROOF_TYPES.indexMembershipMultiproof ||
      causalityMultiproof.indexRoot !== proofs.causality?.root ||
      asArray(causalityMultiproof.missingKeys).length > 0 ||
      actualKeys.length !== expectedCausalityKeys.length ||
      actualKeys.some((key, index) => key !== expectedCausalityKeys[index]);
    if (invalidMultiproof) {
      badBinding(
        "bad_causality_multiproof_binding",
        "Causality multiproof keys do not exactly bind the Ledger fact causality references.",
        { expectedKeys: expectedCausalityKeys, actualKeys }
      );
    }
  } else if (causalityMultiproof) {
    badBinding(
      "bad_causality_multiproof_binding",
      "Causality multiproof is present for a Ledger fact without causality references."
    );
  }
  if (proofs.openIntent) {
    expectIndexProof(proofs.openIntent, {
      key: envelope.factId,
      proofType: PACTIUM_PROOF_TYPES.indexMembership,
      label: "open intent proof"
    });
  }
  if (proofs.outcome) {
    expectIndexProof(proofs.outcome, {
      key: stateCommit?.intentId || proofs.checkpoint?.proof?.entry?.metadata?.intentId || "",
      proofType: PACTIUM_PROOF_TYPES.indexMembership,
      label: "outcome proof"
    });
  }
  if (proofs.openIntentRemoved) {
    expectIndexProof(proofs.openIntentRemoved, {
      key: stateCommit?.intentId || proofs.checkpoint?.proof?.entry?.metadata?.intentId || "",
      proofType: PACTIUM_PROOF_TYPES.indexNonMembership,
      label: "open intent removal proof"
    });
  }
  if (proofs.receipt?.proof) {
    expectIndexProof(proofs.receipt.proof, {
      root: proofs.receipt.root || "",
      key: ledgerFact?.receiptId || envelope.factId || "",
      proofType: PACTIUM_PROOF_TYPES.indexMembership,
      label: "receipt proof"
    });
    if (envelope.envelopeKind !== "operation-receipt" ||
        ledgerFact?.factType !== "operation.receipt" ||
        ledgerFact?.receiptId !== envelope.factId ||
        !["receipt", "on-change"].includes(String(ledgerFact?.profile || ""))) {
      badBinding(
        "bad_receipt_binding",
        "Operation Receipt proof does not bind to a current receipt fact and profile."
      );
    }
  }
}

export async function verifyProofEnvelope(envelope, {
  storage = null,
  bundle = null,
  supportedCriticalExtensions = [],
  proofVerifiers = {},
  requireAllProofs = true,
  verifierManifest = null,
  trustedManifest = null,
  ledgerHeadSignatures = [],
  bundleResolver = null,
  includeBundleResolverFailures = true,
  requiredProofs = null,
  trustPolicy = "",
  requireFullStateMutationProofs = false,
  maxProofLeafEntries = 0,
  maxProofBytes = 0,
  failOnProofSizeWarning = false
} = {}) {
  const failures = [];
  const checkedProofPaths = [];
  let ledgerHeadSignatureValid = false;
  let ledgerHeadTrusted = false;
  let trustedSignatureValid = false;
  const supportedTrustPolicies = new Set(Object.values(PACTIUM_TRUST_POLICIES));
  const defaultTrustPolicy = storage?.inMemory
    ? PACTIUM_TRUST_POLICIES.selfCarriedManifest
    : PACTIUM_TRUST_POLICIES.trustedManifestRequired;
  const requestedTrustPolicy = trustPolicy || defaultTrustPolicy;
  const resolvedTrustPolicy = supportedTrustPolicies.has(requestedTrustPolicy)
    ? requestedTrustPolicy
    : PACTIUM_TRUST_POLICIES.trustedManifestRequired;
  const supported = new Set([...CORE_CRITICAL_EXTENSIONS, ...supportedCriticalExtensions]);
  const bundleMap = bundleResolver || bundleBlockMap(bundle);

  // -- trust-policy enforcement: trusted-manifest-required must have a caller-supplied manifest --
  if (resolvedTrustPolicy === PACTIUM_TRUST_POLICIES.trustedManifestRequired && !trustedManifest) {
    failures.push(createVerificationFailure({
      layer: "trust-policy",
      code: "trusted_manifest_required",
      message: "trustPolicy is 'trusted-manifest-required' but no trustedManifest was provided.",
      repairable: true
    }));
  }

  if (!envelope || envelope.protocol !== PACTIUM_PROTOCOL || envelope.envelopeType !== "pactium.proof-envelope") {
    return {
      protocol: PACTIUM_PROTOCOL,
      envelopeId: envelope?.envelopeId || "",
      ok: false,
      proofStructurallyValid: false,
      ledgerHeadSignatureValid: false,
      ledgerHeadTrusted: false,
      trustedSignatureValid: false,
      trustPolicy: resolvedTrustPolicy,
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
  // Bidirectional critical extension validation
  const extensions = asArray(envelope.extensions);
  const extensionsByName = new Map();
  for (const extension of extensions) {
    const name = String(extension.name || "");
    if (!name) continue;
    if (!extensionsByName.has(name)) extensionsByName.set(name, []);
    extensionsByName.get(name).push(extension);
  }
  const criticalExtensionNames = new Set(asArray(envelope.criticalExtensions).map(String));
  for (const extension of extensions) {
    const name = String(extension.name || "");
    if (!name) continue;
    if (extension.critical === true && !criticalExtensionNames.has(name)) {
      failures.push(createVerificationFailure({
        layer: "proof-extension",
        code: "critical_extension_not_listed",
        message: `Extension "${name}" is marked critical but is not listed in criticalExtensions.`,
        evidenceRef: name,
        repairable: true
      }));
    }
  }
  for (const critical of criticalExtensionNames) {
    if (!extensionsByName.has(critical)) {
      failures.push(createVerificationFailure({
        layer: "proof-extension",
        code: "critical_extension_not_found",
        message: `Critical extension "${critical}" is listed in criticalExtensions but no extension with that name exists.`,
        evidenceRef: critical,
        repairable: true
      }));
    }
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

  // -- Ledger proofs (inclusion + consistency): always part of structural validity --
  const structuralFailuresBeforeLedger = failures.length;
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

    // -- Ledger head signature verification --
    // Manifest resolution for *signature verification* (not trust):
    //   trustedManifest (caller trust anchor) >
    //   verifierManifest (host-provided operational manifest) >
    //   proof material's self-carried manifest (format validation only)
    const proofManifest = proofMaterial.ledger.verifierManifest || proofMaterial.ledger.head?.verifierManifest || null;
    const manifestForHead = trustedManifest || verifierManifest || proofManifest || null;
    const signaturesForHead = asArray(ledgerHeadSignatures).length > 0
      ? ledgerHeadSignatures
      : asArray(proofMaterial.ledger.ledgerHeadSignatures || proofMaterial.ledger.head?.signatures);

    // In "structural" mode skip signature verification entirely.
    if (resolvedTrustPolicy !== "structural" && manifestForHead) {
      const signatureResult = verifyLedgerHeadSignature(proofMaterial.ledger.head, manifestForHead, {
        signatures: signaturesForHead
      });
      if (signatureResult.ok) {
        ledgerHeadSignatureValid = true;
        checkedProofPaths.push("ledger-head-signature");
      }
      // In "self-carried-manifest" mode, signature failures against the proof's own
      // manifest are recorded as structural warnings but do not block ok unless the
      // signature is from a trusted source.
      if (resolvedTrustPolicy === PACTIUM_TRUST_POLICIES.trustedManifestRequired || trustedManifest) {
        // Signature failures against a caller-provided trustedManifest are hard failures.
        failures.push(...signatureResult.failures);
      } else if (resolvedTrustPolicy === PACTIUM_TRUST_POLICIES.selfCarriedManifest && !trustedManifest && !verifierManifest) {
        // Self-carried manifest: record signature failures as non-blocking diagnostics
        // but keep ledgerHeadTrusted = false.
        for (const sigFailure of signatureResult.failures) {
          failures.push({ ...sigFailure, severity: "warning", repairable: true });
        }
      }

      // Trust determination: only a caller-provided trustedManifest establishes trust.
      if (trustedManifest && ledgerHeadSignatureValid) {
        ledgerHeadTrusted = true;
        trustedSignatureValid = true;
      }
    }
  }

  // -- Remaining structural checks (proof schema, semantic bindings, embedded proofs) --
  if (proofMaterial) {
    assertRequiredProofs({
      envelopeKind: envelope.envelopeKind,
      proofMaterial,
      requireAllProofs,
      failures
    });
    const ledgerFact = await resolveLedgerFact({ proofMaterial, storage, bundleMap, failures });
    verifySemanticBindings({ envelope, proofMaterial, ledgerFact, failures });

    // -- State mutation proof completeness check --
    const stateCommit = proofMaterial?.proofs?.stateCommit;
    if (stateCommit && requireFullStateMutationProofs) {
      const proofProfile = asRecord(stateCommit.proofProfile);
      const mutationCount = Number(proofProfile.totalUniqueKeyCount ?? stateCommit.mutationCount ?? 0);
      const touchedKeyProofs = asArray(proofMaterial?.proofs?.state?.touchedKeyProofs);
      const provedCount = Number(proofProfile.provedKeyCount ?? touchedKeyProofs.length);
      const completeness = String(proofProfile.completeness || "");
      if (provedCount < mutationCount || completeness !== "full") {
        failures.push(createVerificationFailure({
          layer: "proof-completeness",
          code: "incomplete_state_mutation_proofs",
          message: `requireFullStateMutationProofs is set but only ${provedCount}/${mutationCount} mutations have proofs.`,
          evidenceRef: envelope.envelopeId,
          details: {
            mutationCount,
            provedCount,
            unprovedMutationCount: mutationCount - provedCount,
            proofCompleteness: completeness || "sampled"
          }
        }));
      }
    }

    await verifyEmbeddedProofs({
      proofMaterial,
      registry: createDefaultProofVerifierRegistry(proofVerifiers),
      requireAllProofs,
      failures,
      checked: checkedProofPaths,
      failOnProofSizeWarning
    });
  }
  if (includeBundleResolverFailures && bundleMap?.failures) {
    failures.push(...bundleMap.failures);
  }

  // -- Compute proof structural validity (all checks except trust-dependent decisions) --
  // Structural validity means: envelope id, proof material refs, critical extensions,
  // ledger inclusion/consistency, proof schema, semantic bindings, embedded proofs all pass.
  // It intentionally excludes the trust status of ledger head signatures.
  const structuralFailures = failures.filter((f) => f.severity !== "warning" && f.layer !== "trust-policy");
  const proofStructurallyValid = structuralFailures.length === 0;

  // -- Overall ok depends on trust policy --
  let ok;
  if (resolvedTrustPolicy === PACTIUM_TRUST_POLICIES.structural) {
    // Structural mode: only proof structure matters. Signature trust is irrelevant.
    ok = proofStructurallyValid;
  } else if (resolvedTrustPolicy === PACTIUM_TRUST_POLICIES.trustedManifestRequired) {
    // Trusted-manifest-required: both structure AND trusted signature must pass.
    ok = proofStructurallyValid && trustedSignatureValid;
  } else {
    // self-carried-manifest: structure must pass; signature validation is
    // informational unless the caller supplies a trusted manifest.
    ok = proofStructurallyValid;
  }

  const warnings = failures.filter((f) => f.severity === "warning");
  return {
    protocol: PACTIUM_PROTOCOL,
    envelopeId: envelope.envelopeId,
    ok,
    proofStructurallyValid,
    ledgerHeadSignatureValid,
    ledgerHeadTrusted,
    trustedSignatureValid,
    trustPolicy: resolvedTrustPolicy,
    failures,
    ...(warnings.length > 0 ? { warnings } : {}),
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
