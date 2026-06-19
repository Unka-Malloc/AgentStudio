/**
 * Example: Verify a Proof Envelope
 *
 * Demonstrates the two-phase operation lifecycle (intent then outcome)
 * and verifying the resulting proof envelope.
 */
import { createPactium } from "../src/index.js";

const pactium = createPactium({ dataDir: "./.pactium" });

// Phase 1: Begin an Operation Intent
const intentEnvelope = await pactium.beginOperationIntent({
  operationId: "workspace.document.create",
  workspaceId: "docs-workspace",
  idempotencyKey: "create-readme-intent",
  input: { path: "README.md", format: "markdown" }
});

console.log("Intent recorded:", intentEnvelope.factId);

// Phase 2: Append the Operation Outcome
const outcomeEnvelope = await pactium.appendOperationOutcome({
  intentId: intentEnvelope.factId,
  workspaceId: "docs-workspace",
  idempotencyKey: "create-readme-outcome",
  outcome: "success",
  stateMutations: [
    { key: "README.md", value: { content: "# Project\n", format: "markdown" } }
  ]
});

console.log("Outcome recorded:", outcomeEnvelope.factId);

// Verify the outcome envelope
const result = await pactium.verifyEnvelope(outcomeEnvelope);

console.log(JSON.stringify({
  verified: result.ok,
  checked: result.checked,
  failures: result.failures
}, null, 2));
