/**
 * Example: LicoLite Signed Workspace Operation
 *
 * Demonstrates using the LicoLite Aspect with signing enabled,
 * critical policy/effect extensions, and LicoLite-level verification.
 */
import { createLicoLiteAspect, createLicoLiteSigner } from "../src/aspects/licolite/index.js";

// Create a LicoLite Aspect with signing and production evidence policy
const licolite = createLicoLiteAspect({
  dataDir: "./.pactium",
  evidencePolicy: "production",
  signer: createLicoLiteSigner({
    signerId: "example-signer",
    secret: "example-secret-for-demonstration-only"
  })
});

// Record a workspace operation with full evidence
const envelope = await licolite.recordWorkspaceOperation({
  operationId: "workspace.asset.upload",
  workspaceId: "media-workspace",
  idempotencyKey: "upload-image-intent",
  outcomeIdempotencyKey: "upload-image-outcome",
  input: {
    filename: "photo.jpg",
    size: 1024000,
    mimeType: "image/jpeg"
  },
  // LicoLite policy evidence (critical extension)
  policyEvidence: {
    decision: "allow",
    rule: "upload-size-limit",
    evaluatedAt: new Date().toISOString()
  },
  // LicoLite workspace effect evidence (critical extension)
  workspaceEffectEvidence: {
    durableRef: "host:storage:media-workspace/photo.jpg",
    effectType: "file-upload",
    byteLength: 1024000
  },
  stateMutations: [
    { key: "assets/photo.jpg", value: { ref: "host:storage:media-workspace/photo.jpg", size: 1024000 } }
  ]
});

console.log("Signed envelope ID:", envelope.envelopeId);
console.log("Critical extensions:", envelope.criticalExtensions);

// LicoLite-level verification (checks core + signing + extensions)
const result = await licolite.verifyEnvelope(envelope);

console.log(JSON.stringify({
  verified: result.ok,
  failures: result.failures
}, null, 2));

// Export as portable bundle for external verification
const bundle = await licolite.exportProofBundle(envelope);
const bundleResult = await licolite.verifyBundle(bundle);

console.log("\nBundle verification:", bundleResult.ok ? "PASS" : "FAIL");
