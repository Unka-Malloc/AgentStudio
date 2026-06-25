import { verifyIndexProof } from "../index-engine/snapshot-merkle-index.js";
import { verifyLedgerConsistencyProof, verifyLedgerInclusionProof } from "../ledger/transparency-log.js";
import { PACTIUM_PROOF_TYPES } from "../protocol/constants.js";
import { asRecord } from "../shared/records.js";

export function createDefaultProofVerifierRegistry(extraVerifiers = {}) {
  return new Map([
    [PACTIUM_PROOF_TYPES.ledgerInclusion, (proof, context = {}) => verifyLedgerInclusionProof({ head: context.head || {}, proof })],
    [PACTIUM_PROOF_TYPES.ledgerConsistency, (proof, context = {}) => verifyLedgerConsistencyProof({
      oldHead: context.oldHead || {},
      newHead: context.newHead || {},
      proof
    })],
    [PACTIUM_PROOF_TYPES.indexMembership, verifyIndexProof],
    [PACTIUM_PROOF_TYPES.indexMembershipMultiproof, verifyIndexProof],
    [PACTIUM_PROOF_TYPES.indexRange, verifyIndexProof],
    [PACTIUM_PROOF_TYPES.indexNonMembership, verifyIndexProof],
    ...Object.entries(asRecord(extraVerifiers))
  ]);
}
