export const PACTIUM_PROTOCOL = "pactium.v0.3";
export const PACTIUM_SCHEMA_VERSION = "pactium.v0.3.schema.latest";
export const PACTIUM_PACKAGE_VERSION = "0.5.0";
export const PACTIUM_INDEX_ENGINE = "pactium.verifiable-index-engine";
export const PACTIUM_INDEX_SPLITTER = "pactium-cdc-boundary";
export const PACTIUM_PROOF_BUNDLE_TYPE = "pactium.proof-bundle.indexed";
export const PACTIUM_BUNDLE_ENCODING = "pactium.bundle.indexed-record-stream";
export const PACTIUM_TRUST_POLICIES = Object.freeze({
  structural: "structural",
  selfCarriedManifest: "self-carried-manifest",
  trustedManifestRequired: "trusted-manifest-required"
});
export const PACTIUM_PROOF_TYPES = Object.freeze({
  ledgerInclusion: "ledger.inclusion.audit-path",
  ledgerConsistency: "ledger.consistency.audit-path",
  indexMembership: "index.membership.prolly-path",
  indexMembershipMultiproof: "index.membership-multiproof.prolly-paths",
  indexRange: "index.range.prolly-paths",
  indexNonMembership: "index.non-membership.compact-prolly-boundary"
});

export const PACTIUM_PROTOCOL_PROFILE = Object.freeze({
  protocol: PACTIUM_PROTOCOL,
  schema: PACTIUM_SCHEMA_VERSION,
  hash: "sha256",
  cid: "cid:sha256:<hex>",
  canonicalValue: "jcs-like-canonical-json-nfc-safe-integers",
  orderingAuthority: "operation-ledger",
  ledger: {
    model: "rfc6962-transparency-log",
    leafHash: "H(0x00 || canonical(leaf))",
    nodeHash: "H(0x01 || leftHash || rightHash)",
    emptyTreeHash: "H(\"\")",
    appendLane: "single-ledger-append-lane"
  },
  indexEngine: {
    structure: "canonical-prolly-tree",
    chunking: {
      minEntries: 32,
      targetEntries: 64,
      maxEntries: 128,
      boundaryMask: 63
    }
  },
  licoLite: {
    exportPath: "pactium/licolite",
    workspaceProjection: "enabled-by-default",
    signing: "enabled-by-default",
    criticalExtensions: [
      "licolite.policy",
      "licolite.workspaceEffect"
    ],
    dataSupport: "latest-schema-only"
  }
});

export const HASH_DOMAINS = Object.freeze({
  block: "pactium.v0.3.block",
  "append.condition": "pactium.v0.3.append.condition",
  "checkpoint.node": "pactium.v0.3.checkpoint.node",
  "index.boundary": "pactium.v0.3.index.boundary",
  "index.leaf": "pactium.v0.3.index.leaf",
  "index.node": "pactium.v0.3.index.node",
  "ledger.consistency": "pactium.v0.3.ledger.consistency",
  "ledger.event-id": "pactium.v0.3.ledger.event-id",
  "ledger.head.signing": "pactium.v0.3.ledger.head.signing",
  "operation.intent": "pactium.v0.3.operation.intent",
  "operation.outcome": "pactium.v0.3.operation.outcome",
  "operation.receipt": "pactium.v0.3.operation.receipt",
  "operation.receipt.change": "pactium.v0.3.operation.receipt.change",
  "operation.receipt.result": "pactium.v0.3.operation.receipt.result",
  "proof.bundle": "pactium.v0.3.proof.bundle",
  "proof.envelope": "pactium.v0.3.proof.envelope",
  "proof.envelope.signing": "pactium.v0.3.proof.envelope.signing",
  "proof.extension": "pactium.v0.3.proof.extension",
  "state.commit": "pactium.v0.3.state.commit",
  "verifier.manifest": "pactium.v0.3.verifier.manifest",
  "workspace.projection": "pactium.v0.3.workspace.projection"
});
