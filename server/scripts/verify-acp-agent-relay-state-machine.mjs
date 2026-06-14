#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";

import { ACP_AGENT_RELAY_STATE_MACHINE_SPEC as spec } from "./acp-agent-relay-state-machine-spec.mjs";

function normalizeText(value = "") {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function assertNeedles(text, needles = [], label = "") {
  const normalized = normalizeText(text);
  for (const needle of needles) {
    assert.equal(
      normalized.includes(normalizeText(needle)),
      true,
      `${label} must include ${JSON.stringify(needle)}`
    );
  }
}

function assertPatterns(text, patterns = [], label = "") {
  for (const pattern of patterns) {
    const regex = pattern instanceof RegExp ? pattern : new RegExp(String(pattern).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "s");
    assert.match(text, regex, `${label} must match ${regex}`);
  }
}

const files = {
  document: await fs.readFile(new URL("../../docs/ACP-AGENT-RELAY-STATE-MACHINE.md", import.meta.url), "utf8"),
  design: await fs.readFile(new URL("../../docs/ACP-AGENT-RELAY-DESIGN.md", import.meta.url), "utf8"),
  runtimeTest: await fs.readFile(
    new URL("../../tests/vitest/server/acp-agent-relay-runtime.test.mjs", import.meta.url),
    "utf8"
  ),
  finalExtraTest: await fs.readFile(
    new URL("../../tests/vitest/server/agent-relay-antigravity-final-extra.test.mjs", import.meta.url),
    "utf8"
  ),
  proofMatrix: await fs.readFile(new URL("./acp-agent-relay-proof-matrix.mjs", import.meta.url), "utf8"),
  codexAntigravityVerifier: await fs.readFile(
    new URL("./verify-acp-agent-relay-codex-antigravity.mjs", import.meta.url),
    "utf8"
  ),
  codexCliTargetVerifier: await fs.readFile(
    new URL("./verify-acp-agent-relay-codex-cli-target.mjs", import.meta.url),
    "utf8"
  ),
  codexAcpTargetVerifier: await fs.readFile(
    new URL("./verify-acp-agent-relay-codex-acp-target.mjs", import.meta.url),
    "utf8"
  ),
  targetCallbackApprovalVerifier: await fs.readFile(
    new URL("./verify-acp-agent-relay-target-callback-approval.mjs", import.meta.url),
    "utf8"
  ),
  targetReconnectVerifier: await fs.readFile(
    new URL("./verify-acp-agent-relay-target-reconnect.mjs", import.meta.url),
    "utf8"
  ),
  targetLoadReconnectVerifier: await fs.readFile(
    new URL("./verify-acp-agent-relay-target-load-reconnect.mjs", import.meta.url),
    "utf8"
  ),
  idempotencyVerifier: await fs.readFile(
    new URL("./verify-acp-agent-relay-idempotency.mjs", import.meta.url),
    "utf8"
  ),
  realVerifier: await fs.readFile(new URL("./verify-acp-agent-relay-real.mjs", import.meta.url), "utf8"),
  realProofBundle: await fs.readFile(new URL("./acp-agent-relay-real-proof-bundle.mjs", import.meta.url), "utf8"),
  mcpScopeVerifier: await fs.readFile(new URL("./verify-acp-agent-relay-mcp-scope.mjs", import.meta.url), "utf8")
};

assert.equal(spec.schemaVersion, "v0.0.1:agent:acp-agent-relay-state-machine-spec-1");
assert.equal(spec.documentPath, "docs/ACP-AGENT-RELAY-STATE-MACHINE.md");
assert.equal(spec.domains.length, 10, "ACP relay state machine must remain a ten-domain composite state tuple.");
assertNeedles(files.design, ["ACP Agent Relay State Machine", "complete source-to-Pact-to-target transition model"], "design doc");
assertNeedles(
  files.document,
  [
    "RelayState =",
    "FrameState",
    "SourceIdentityState",
    "AuthorizationState",
    "RouteState",
    "SessionState",
    "TurnState",
    "TargetState",
    "ApprovalState",
    "ObservationState",
    "VisibilityState"
  ],
  "state machine composite tuple"
);

for (const domain of spec.domains) {
  assertNeedles(files.document, [domain.docHeading], `${domain.id} heading`);
  for (const state of domain.states) {
    assertNeedles(files.document, [`\`${state}\``], `${domain.id}.${state}`);
  }
}

for (const outcome of spec.terminalOutcomes) {
  assertNeedles(files.document, [outcome], `terminal outcome ${outcome}`);
}

for (const invariant of spec.invariants) {
  assertNeedles(files.document, invariant.docNeedles, `invariant ${invariant.id}`);
}

for (const branch of spec.evidenceBranches) {
  assertNeedles(files.document, branch.docNeedles, `state branch ${branch.id} documentation`);
  for (const evidence of branch.evidence) {
    assert.equal(Boolean(files[evidence.file]), true, `Unknown state machine evidence file: ${evidence.file}`);
    assertPatterns(files[evidence.file], evidence.patterns, `state branch ${branch.id} evidence ${evidence.file}`);
  }
}

assertNeedles(
  files.runtimeTest,
  [
    "externalCompletionState, \"accepted_only\"",
    "turn.observe",
    "observed.data.refreshed, true",
    "observed.data.communicationSummary.finalResponseAvailable, true",
    "event.operationId === \"acp_agent_relay.turn.observe\"",
    "event.globalAuditId === promptResult.data.audit.globalAuditId",
    "observedAgain.data.refreshed, false"
  ],
  "accepted-only observation final refresh evidence"
);
assertNeedles(
  files.runtimeTest,
  [
    "assert.equal(observed.result.responseKind, \"final_response\")",
    "source ACP JSON-RPC turn.observe final response",
    "observed.result.targetObservation.latestFinalResponse.text, undefined"
  ],
  "source ACP turn.observe final refresh projection"
);

console.log("[acp-agent-relay-state-machine] ok");
