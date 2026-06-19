/**
 * Example: Export and Verify a Proof Bundle
 *
 * Demonstrates exporting a portable proof bundle from a recorded operation
 * and verifying it without access to local Pactium storage.
 */
import { createPactium, verifyProofBundle } from "../src/index.js";

const pactium = createPactium({ dataDir: "./.pactium" });

// Record an operation
const envelope = await pactium.recordOperation({
  operationId: "workspace.config.update",
  workspaceId: "settings-workspace",
  idempotencyKey: "update-theme-intent",
  outcomeIdempotencyKey: "update-theme-outcome",
  input: { setting: "theme", value: "dark" },
  stateMutations: [
    { key: "settings/theme", value: { mode: "dark", updatedBy: "user-1" } }
  ]
});

console.log("Operation recorded:", envelope.envelopeId);

// Export as a portable proof bundle
const bundle = await pactium.exportProofBundle(envelope);

console.log("Bundle exported:");
console.log("  Type:", bundle.bundleType);
console.log("  Hash:", bundle.bundleHash);
console.log("  Blocks:", bundle.index?.length ?? 0, "content-addressed blocks");

// Verify the bundle independently (no local storage needed)
const result = await verifyProofBundle(bundle);

console.log(JSON.stringify({
  verified: result.ok,
  bundleHash: result.bundleHash,
  failures: result.failures
}, null, 2));
