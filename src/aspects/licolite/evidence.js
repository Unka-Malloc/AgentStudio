import { protocolHash } from "../../protocol/hashing.js";
import { asRecord } from "../../shared/records.js";
import { LICOLITE_ASPECT_PROTOCOL, LICOLITE_POLICY_EXTENSION, LICOLITE_WORKSPACE_EFFECT_EXTENSION } from "./constants.js";

export async function materializeEvidenceExtension(pactium, {
  name,
  evidence,
  critical = true,
  metadata = {}
}) {
  const block = await pactium.advanced.storage.putBlock(evidence || {}, {
    kind: `licolite-evidence:${name}`
  });
  return pactium.createExtension({
    name,
    critical,
    value: {
      protocol: LICOLITE_ASPECT_PROTOCOL,
      evidenceType: name,
      evidenceRef: block.cid,
      evidenceHash: block.payloadHash,
      metadata
    },
    metadata: {
      evidenceRef: block.cid,
      evidenceHash: block.payloadHash
    }
  });
}

export function licoLitePolicyExtensionValue(input = {}) {
  return {
    protocol: LICOLITE_ASPECT_PROTOCOL,
    evidenceType: LICOLITE_POLICY_EXTENSION,
    decision: asRecord(input.decision),
    evidenceHash: protocolHash("proof.extension", input.evidence || {})
  };
}

export function licoLiteWorkspaceEffectExtensionValue(input = {}) {
  return {
    protocol: LICOLITE_ASPECT_PROTOCOL,
    evidenceType: LICOLITE_WORKSPACE_EFFECT_EXTENSION,
    effect: asRecord(input.effect),
    evidenceHash: protocolHash("proof.extension", input.evidence || {})
  };
}
