/**
 * Example: Workspace Projection and Membership Proof
 *
 * Demonstrates recording multiple operations across workspaces,
 * querying workspace projections, and proving workspace membership.
 */
import { createPactium } from "../src/index.js";

const pactium = createPactium({ dataDir: "./.pactium" });

// Record operations in different workspaces
const envelopeA = await pactium.recordOperation({
  operationId: "workspace.file.write",
  workspaceId: "project-alpha",
  idempotencyKey: "alpha-write-1",
  outcomeIdempotencyKey: "alpha-outcome-1",
  input: { path: "src/main.js" },
  stateMutations: [
    { key: "src/main.js", value: { content: "console.log('alpha')" } }
  ]
});

const envelopeB = await pactium.recordOperation({
  operationId: "workspace.file.write",
  workspaceId: "project-beta",
  idempotencyKey: "beta-write-1",
  outcomeIdempotencyKey: "beta-outcome-1",
  input: { path: "src/index.js" },
  stateMutations: [
    { key: "src/index.js", value: { content: "console.log('beta')" } }
  ]
});

// Query workspace projection for project-alpha
const projection = await pactium.getWorkspaceProjection("project-alpha");
console.log("Workspace 'project-alpha' projection:");
console.log(JSON.stringify(projection, null, 2));

// Prove that envelopeA's fact belongs to project-alpha
const membershipProof = await pactium.proveWorkspaceMembership({
  workspaceId: "project-alpha",
  ledgerEventId: envelopeA.factRef.ledgerEventId
});

console.log("\nMembership proof for envelopeA in project-alpha:");
console.log("  Member:", membershipProof.member);

// Prove that envelopeB's fact does NOT belong to project-alpha
const nonMembershipProof = await pactium.proveWorkspaceMembership({
  workspaceId: "project-alpha",
  ledgerEventId: envelopeB.factRef.ledgerEventId
});

console.log("\nMembership proof for envelopeB in project-alpha:");
console.log("  Member:", nonMembershipProof.member);
