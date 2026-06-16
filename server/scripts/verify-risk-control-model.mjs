import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  RISK_CONTROL_BOUNDARY_IDS,
  RISK_CONTROL_GATES,
  RISK_CONTROL_MODEL_VERSION,
  RISK_CONTROL_OBJECT_ORDER,
  RISK_CONTROL_POINTS,
  appendRiskControlGateRecord,
  assertRiskControlRegistryComplete,
  createRiskControlOperationEnvelope,
  riskControlControlsByObject
} from "../platform/common/security/risk-control/index.mjs";

const __filename = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(__filename), "../..");

async function readProjectFile(relativePath) {
  return fs.readFile(path.join(projectRoot, relativePath), "utf8");
}

async function pathExists(relativePath) {
  try {
    await fs.access(path.join(projectRoot, relativePath));
    return true;
  } catch {
    return false;
  }
}

function assertEveryObjectCovered(boundaryId, label) {
  const projection = riskControlControlsByObject({ boundaryId });
  assert.deepEqual(
    projection.map((entry) => entry.objectId),
    [...RISK_CONTROL_OBJECT_ORDER],
    `${label} must project every Risk Control object in canonical order`
  );
  for (const entry of projection) {
    assert.ok(entry.controls.length > 0, `${label} must have controls for ${entry.objectId}`);
    for (const control of entry.controls) {
      assert.equal(control.owner.boundaryId, boundaryId, `${control.controlId} must remain under ${boundaryId}`);
      assert.ok(control.controlId.includes("."), `${control.controlId} must be a stable dotted Risk Control identity`);
      assert.equal(/\s|[A-Z]/.test(control.controlId), false, `${control.controlId} must not preserve a legacy display label`);
      assert.ok(control.definitionDigest.startsWith("sha256:v0.0.1:strategy:risk-control-definition-1:"), `${control.controlId} must carry definitionDigest`);
      assert.ok(control.enforcedBy.id.startsWith("component."), `${control.controlId} must reference a component catalog id`);
      assert.ok(control.factSource.id.startsWith("fact."), `${control.controlId} must reference a fact source catalog id`);
      assert.ok(control.verifiedBy.every((verifier) => verifier.id.startsWith("verifier.")), `${control.controlId} must reference verifier catalog ids`);
    }
  }
}

function assertGateCoverage() {
  const gates = new Set(RISK_CONTROL_POINTS.map((control) => control.gate));
  for (const gate of RISK_CONTROL_GATES) {
    assert.equal(gates.has(gate), true, `Risk Control Registry must cover lifecycle gate ${gate}`);
  }
}

function assertOperationEnvelopeHashChain() {
  const firstControl = RISK_CONTROL_POINTS.find((control) => control.controlId === "client.registration.admit");
  const secondControl = RISK_CONTROL_POINTS.find((control) => control.controlId === "client.mcp-grant.authorize");
  const envelope = createRiskControlOperationEnvelope({
    operationId: "verify.risk-control",
    traceId: "trace-risk-control-verifier",
    inputHash: "sha256:test"
  });
  const first = appendRiskControlGateRecord(envelope, {
    control: firstControl,
    decision: "allow",
    reasonCode: "verified",
    subject: { type: "test", subjectId: "subject-a" },
    intent: "verify risk control gate record",
    resource: { operationId: "verify.risk-control" },
    environment: { boundaryId: RISK_CONTROL_BOUNDARY_IDS.CLIENT_MCP_INGRESS }
  });
  const second = appendRiskControlGateRecord(envelope, {
    control: secondControl,
    decision: "allow",
    reasonCode: "verified",
    subject: { type: "test", subjectId: "subject-a" },
    intent: "verify risk control gate record",
    resource: { operationId: "verify.risk-control" },
    environment: { boundaryId: RISK_CONTROL_BOUNDARY_IDS.CLIENT_MCP_INGRESS }
  });
  assert.equal(envelope.gateRecords.length, 2);
  assert.equal(first.previousRecordDigest, envelope.operationAnchorDigest);
  assert.equal(second.previousRecordDigest, first.recordDigest);
  assert.ok(first.recordDigest.startsWith("sha256:v0.0.1:strategy:risk-control-gate-record-1:"));
  assert.ok(second.recordDigest.startsWith("sha256:v0.0.1:strategy:risk-control-gate-record-1:"));
}

async function assertNoLegacyRiskControlAuthority() {
  assert.equal(
    await pathExists("server/platform/common/security/governance"),
    false,
    "legacy security/governance implementation path must be removed after Risk Control migration"
  );
  assert.equal(
    await pathExists("server/scripts/verify-2-3-5-security-model.mjs"),
    false,
    "legacy verify-2-3-5-security-model.mjs must be removed after Risk Control migration"
  );
  const packageJson = await readProjectFile("package.json");
  assert.match(packageJson, /server:verify:risk-control-model/, "package.json must expose the Risk Control verifier");
  assert.doesNotMatch(packageJson, /server:verify:2-3-5-security-model/, "package.json must not keep the legacy 2-3-5 verifier script");
  const productionGate = await readProjectFile("server/scripts/production-readiness-gate.mjs");
  assert.match(productionGate, /server:verify:risk-control-model/, "production readiness gate must run the Risk Control verifier");
  assert.doesNotMatch(productionGate, /server:verify:2-3-5-security-model/, "production readiness gate must not call the legacy verifier");
}

async function assertRuntimeRiskControlEnvelope() {
  const dispatcher = await readProjectFile("server/platform/common/operation-dispatcher/operation-dispatcher.mjs");
  assert.match(
    dispatcher,
    /createRiskControlOperationEnvelope/,
    "OperationDispatcher must create a server-owned Risk Control operation envelope"
  );
  assert.match(
    dispatcher,
    /appendRiskControlGateRecord/,
    "OperationDispatcher must append registered Risk Control gate records"
  );
  assert.match(
    dispatcher,
    /__pactRiskControl/,
    "OperationDispatcher must attach the Risk Control envelope to the request lifecycle"
  );
  assert.match(
    dispatcher,
    /operation_authorizer_missing/,
    "OperationDispatcher must fail closed when an HTTP/RPC operation has no authorizer"
  );

  const auditStore = await readProjectFile("server/platform/common/security/operation-audit.mjs");
  assert.match(
    auditStore,
    /risk_control_envelope_json/,
    "Operation audit store must persist the Risk Control envelope evidence"
  );
  assert.match(
    auditStore,
    /risk_control_last_record_digest/,
    "Operation audit store must persist the Risk Control hash-chain tail"
  );
}

const model = assertRiskControlRegistryComplete();
assert.equal(model.modelVersion, RISK_CONTROL_MODEL_VERSION);
assert.ok(model.controlCount >= 60, "Risk Control Registry must cover migrated controls from every legacy object group");
assert.ok(model.pathCount >= 4, "Risk Control Registry must expose end-to-end paths");
assertEveryObjectCovered(RISK_CONTROL_BOUNDARY_IDS.CLIENT_MCP_INGRESS, "client MCP ingress Risk Control");
assertEveryObjectCovered(RISK_CONTROL_BOUNDARY_IDS.SERVER_API_EGRESS, "server API egress Risk Control");
assertEveryObjectCovered(RISK_CONTROL_BOUNDARY_IDS.PLATFORM_SELF, "platform self Risk Control");
assertGateCoverage();
assertOperationEnvelopeHashChain();
await assertNoLegacyRiskControlAuthority();
await assertRuntimeRiskControlEnvelope();

const agentDoc = await readProjectFile("docs/AGENT.md");
const securityDoc = await readProjectFile("docs/functionality/SECURITY-AUTHORIZATION.md");
const riskControlAdr = await readProjectFile("docs/adr/0009-risk-control-registry-and-dsl.md");
assert.match(securityDoc, /Risk Control Model|风险控制模型/i, "Security functionality doc must define Risk Control Model terminology");
assert.match(agentDoc, /docs\/functionality\/SECURITY-AUTHORIZATION\.md|docs\/functionality\/\*\.md/, "AGENT.md must route security functionality to canonical functionality docs");
assert.match(riskControlAdr, /server\/platform\/common\/security\/risk-control/, "ADR 0009 must point at the Risk Control implementation home");

console.log("risk-control model verifier passed");
