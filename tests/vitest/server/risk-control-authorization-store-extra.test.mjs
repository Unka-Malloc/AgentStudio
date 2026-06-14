import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import {
  RISK_CONTROL_BOUNDARY_IDS,
  RISK_CONTROL_GATES,
  RISK_CONTROL_MODEL_VERSION,
  RISK_CONTROL_OBJECT_ORDER,
  RISK_CONTROL_POINTS,
  appendRiskControlGateRecord,
  assertRiskControlRegistryComplete,
  createRiskControlOperationEnvelope,
  createRiskControlProjection,
  describeRiskControlModel,
  listRiskControlBoundaries,
  listRiskControlEnvironments,
  listRiskControlObjects,
  riskControlControlsByGate,
  riskControlControlsByObject
} from "../../../server/platform/common/security/risk-control/index.mjs";
import { createAuthorizationStore } from "../../../server/platform/common/security/authorization/authorization-store.mjs";

const tempRoots = [];

async function tempDir(prefix) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

async function withAuthorizationStore(testCase) {
  const userDataPath = await tempDir("pact-risk-control-store-extra-");
  const store = createAuthorizationStore({ userDataPath });
  try {
    return await testCase({ store, userDataPath });
  } finally {
    store.close();
  }
}

function deepPayload(depth, label = "leaf") {
  if (depth <= 0) {
    return { label };
  }
  return {
    depth,
    child: deepPayload(depth - 1, label)
  };
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("risk control model extra coverage", () => {
  it("returns cloned model data, covers every object and gate, and builds a hash-chained envelope", () => {
    const boundaries = listRiskControlBoundaries();
    const environments = listRiskControlEnvironments();
    const objects = listRiskControlObjects();

    expect(boundaries).toHaveLength(3);
    expect(environments).toHaveLength(3);
    expect(objects).toHaveLength(5);

    boundaries[0].label = "mutated-boundary";
    environments[0].label = "mutated-environment";
    objects[0].label = "mutated-object";

    expect(listRiskControlBoundaries()[0].label).not.toBe("mutated-boundary");
    expect(listRiskControlEnvironments()[0].label).not.toBe("mutated-environment");
    expect(listRiskControlObjects()[0].label).not.toBe("mutated-object");

    const clientControls = riskControlControlsByObject({ boundaryId: RISK_CONTROL_BOUNDARY_IDS.CLIENT_MCP_INGRESS });
    expect(clientControls.map((entry) => entry.objectId)).toEqual(RISK_CONTROL_OBJECT_ORDER);
    expect(clientControls.every((entry) => entry.controls.length > 0)).toBe(true);
    expect(riskControlControlsByObject({ boundaryId: "missing-boundary" }).map((entry) => entry.controls)).toEqual(
      RISK_CONTROL_OBJECT_ORDER.map(() => [])
    );

    const gates = new Set(riskControlControlsByGate().map((entry) => entry.gate));
    for (const gate of RISK_CONTROL_GATES) {
      expect(gates.has(gate)).toBe(true);
    }

    const projection = createRiskControlProjection();
    expect(projection.boundaries).toHaveLength(3);
    expect(projection.controlsByObject).toHaveLength(5);
    projection.objects[0].label = "changed";
    expect(listRiskControlObjects()[0].label).not.toBe("changed");

    const model = describeRiskControlModel();
    expect(model).toMatchObject({
      modelVersion: RISK_CONTROL_MODEL_VERSION,
      boundaryCount: 3,
      environmentCount: 3,
      objectCount: 5
    });
    expect(model.controlCount).toBeGreaterThanOrEqual(60);
    expect(() => assertRiskControlRegistryComplete()).not.toThrow();

    const firstControl = RISK_CONTROL_POINTS.find((control) => control.controlId === "client.registration.admit");
    const secondControl = RISK_CONTROL_POINTS.find((control) => control.controlId === "client.mcp-grant.authorize");
    const envelope = createRiskControlOperationEnvelope({
      operationId: "risk-control.unit",
      traceId: "trace-risk-control-unit",
      inputHash: "sha256:unit"
    });
    const first = appendRiskControlGateRecord(envelope, {
      control: firstControl,
      decision: "allow",
      reasonCode: "unit_first"
    });
    const second = appendRiskControlGateRecord(envelope, {
      control: secondControl,
      decision: "allow",
      reasonCode: "unit_second"
    });
    expect(envelope.gateRecords).toHaveLength(2);
    expect(first.previousRecordDigest).toBe(envelope.operationAnchorDigest);
    expect(second.previousRecordDigest).toBe(first.recordDigest);
    expect(second.recordDigest).toMatch(/^sha256:risk-control\.gate-record\.v1:/);
  });
});

describe("authorization store extra coverage", () => {
  it("normalizes writes, redacts denied payloads, and clamps list limits", async () => {
    await withAuthorizationStore(async ({ store }) => {
      const decisionPayload = {
        traceId: "trace-1",
        subject: {
          type: "user",
          subjectId: "subject-1"
        },
        operation: {
          id: "authorization.policy.evaluate"
        },
        tool: {
          id: "tool-1"
        },
        grant: {
          id: "grant-1"
        },
        tenant: {
          resourceTenantId: "tenant-a"
        },
        abac: {
          workspaceId: "workspace-a",
          dataClass: "confidential",
          requestedEgress: "https://egress.example.test"
        },
        resource: {
          tenantId: "tenant-b",
          workspaceId: "workspace-b",
          dataClass: "public"
        },
        action: "evaluate",
        effect: "deny",
        allowed: false,
        reasonCode: "policy_denied",
        missingScopes: ["scope:a"],
        missingToolsets: ["toolset:a"],
        requiredScopes: ["scope:required"],
        evaluatedLayers: [{ layer: "policy" }],
        decision: {
          token: "Bearer secret-token",
          apiKey: "secret-api-key",
          subjectCapabilities: ["cap-a", "cap-b"],
          subject: {
            capabilities: ["cap-x"]
          },
          nested: deepPayload(10)
        },
        createdAt: "2026-06-01T00:00:00.000Z"
      };

      const firstDecision = store.appendDecision(decisionPayload);
      const secondDecision = store.appendDecision({
        ...decisionPayload,
        decisionId: "decision-2",
        traceId: "trace-2",
        subject: {
          type: "user",
          subjectId: "subject-2"
        },
        operation: {
          id: "authorization.receipts.list"
        },
        effect: "allow",
        allowed: true,
        reasonCode: "allowed",
        decision: {
          ok: true
        },
        createdAt: "2026-06-02T00:00:00.000Z"
      });

      const allDecisions = store.listDecisions({ limit: "500" });
      expect(allDecisions.map((entry) => entry.decisionId)).toEqual([secondDecision.decisionId, firstDecision.decisionId]);

      const firstListed = store.listDecisions({
        subjectId: "subject-1",
        traceId: "trace-1",
        tenantId: "tenant-a",
        workspaceId: "workspace-a",
        operationId: "authorization.policy.evaluate",
        effect: "deny",
        limit: 0
      });
      expect(firstListed).toHaveLength(1);
      expect(firstListed[0]).toMatchObject({
        decisionId: firstDecision.decisionId,
        tenantId: "tenant-a",
        workspaceId: "workspace-a",
        dataClass: "confidential",
        requestedEgress: "https://egress.example.test",
        effect: "deny",
        reasonCode: "policy_denied",
        missingScopes: ["scope:a"],
        missingToolsets: ["toolset:a"],
        requiredScopes: ["scope:required"],
        evaluatedLayers: [{ layer: "policy" }]
      });
      expect(firstListed[0].decision.decision).toMatchObject({
        token: "<redacted>",
        apiKey: "<redacted>",
        subjectCapabilities: {
          redacted: true,
          count: 2
        },
        subject: {
          capabilities: {
            redacted: true,
            count: 1
          }
        }
      });
      expect(JSON.stringify(firstListed[0].decision.decision)).toContain("<redacted-depth>");

      const deniedRequests = store.listDeniedRequests({
        subjectId: "subject-1",
        tenantId: "tenant-a",
        workspaceId: "workspace-a",
        operationId: "authorization.policy.evaluate",
        reasonCode: "policy_denied",
        limit: -2
      });
      expect(deniedRequests).toHaveLength(1);
      expect(deniedRequests[0]).toMatchObject({
        decisionId: firstDecision.decisionId,
        subjectId: "subject-1",
        operationId: "authorization.policy.evaluate",
        toolId: "tool-1",
        tenantId: "tenant-a",
        workspaceId: "workspace-a",
        reasonCode: "policy_denied"
      });
      expect(JSON.stringify(deniedRequests[0].deniedRequest)).toContain("<redacted>");

      const receipt = store.appendReceipt({
        decisionId: firstDecision.decisionId,
        subject: {
          userId: "subject-1"
        },
        workspaceId: "workspace-a",
        accessMode: "read",
        receipt: {
          receiptId: "receipt-1",
          summary: "ok"
        },
        createdAt: "2026-06-03T00:00:00.000Z"
      });

      const loanRecord = store.appendLoanRecord({
        receiptId: receipt.receiptId,
        decisionId: firstDecision.decisionId,
        subject: {
          id: "subject-1"
        },
        workspaceId: "workspace-a",
        accessMode: "loan",
        loanRecord: {
          loanRecordId: "loan-1",
          issuedAt: "2026-06-03T00:00:00.000Z"
        },
        createdAt: "2026-06-03T00:00:00.000Z"
      });

      const receipts = store.listReceipts({ subjectId: "subject-1", limit: 0 });
      expect(receipts).toHaveLength(1);
      expect(receipts[0]).toMatchObject({
        receiptId: receipt.receiptId,
        decisionId: firstDecision.decisionId,
        subjectId: "subject-1",
        workspaceId: "workspace-a",
        accessMode: "read",
        createdAt: "2026-06-03T00:00:00.000Z"
      });
      expect(receipts[0].receipt).toMatchObject({
        receiptId: receipt.receiptId,
        receipt: {
          receiptId: "receipt-1",
          summary: "ok"
        }
      });

      const loanRecords = store.listLoanRecords({ subjectId: "subject-1", limit: 0 });
      expect(loanRecords).toHaveLength(1);
      expect(loanRecords[0]).toMatchObject({
        loanRecordId: loanRecord.loanRecordId,
        receiptId: receipt.receiptId,
        decisionId: firstDecision.decisionId,
        subjectId: "subject-1",
        workspaceId: "workspace-a",
        accessMode: "loan",
        createdAt: "2026-06-03T00:00:00.000Z"
      });
      expect(loanRecords[0].loanRecord).toMatchObject({
        loanRecordId: loanRecord.loanRecordId,
        loanRecord: {
          loanRecordId: "loan-1",
          issuedAt: "2026-06-03T00:00:00.000Z"
        }
      });
    });
  });

  it("migrates legacy tables and recovers malformed JSON rows without throwing", async () => {
    const userDataPath = await tempDir("pact-authorization-store-legacy-");
    const authRoot = path.join(userDataPath, "security", "authorization");
    await fs.mkdir(authRoot, { recursive: true });
    const databasePath = path.join(authRoot, "authorization.sqlite");
    const legacyDb = new Database(databasePath);

    legacyDb.exec(`
      CREATE TABLE authorization_decisions (
        decision_id TEXT PRIMARY KEY,
        trace_id TEXT NOT NULL DEFAULT '',
        subject_type TEXT NOT NULL DEFAULT '',
        subject_id TEXT NOT NULL DEFAULT '',
        operation_id TEXT NOT NULL DEFAULT '',
        tool_id TEXT NOT NULL DEFAULT '',
        grant_id TEXT NOT NULL DEFAULT '',
        action TEXT NOT NULL DEFAULT '',
        effect TEXT NOT NULL DEFAULT '',
        reason_code TEXT NOT NULL DEFAULT '',
        missing_scopes_json TEXT NOT NULL DEFAULT '[]',
        missing_toolsets_json TEXT NOT NULL DEFAULT '[]',
        required_scopes_json TEXT NOT NULL DEFAULT '[]',
        evaluated_layers_json TEXT NOT NULL DEFAULT '[]',
        decision_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );

      CREATE TABLE authorization_receipts (
        receipt_id TEXT PRIMARY KEY,
        decision_id TEXT NOT NULL DEFAULT '',
        subject_id TEXT NOT NULL DEFAULT '',
        workspace_id TEXT NOT NULL DEFAULT '',
        access_mode TEXT NOT NULL DEFAULT '',
        receipt_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );

      CREATE TABLE authorization_loan_records (
        loan_record_id TEXT PRIMARY KEY,
        receipt_id TEXT NOT NULL DEFAULT '',
        decision_id TEXT NOT NULL DEFAULT '',
        subject_id TEXT NOT NULL DEFAULT '',
        workspace_id TEXT NOT NULL DEFAULT '',
        access_mode TEXT NOT NULL DEFAULT '',
        loan_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );

      CREATE TABLE authorization_denied_requests (
        denied_request_id TEXT PRIMARY KEY,
        decision_id TEXT NOT NULL DEFAULT '',
        subject_id TEXT NOT NULL DEFAULT '',
        operation_id TEXT NOT NULL DEFAULT '',
        tool_id TEXT NOT NULL DEFAULT '',
        reason_code TEXT NOT NULL DEFAULT '',
        denied_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );
    `);

    legacyDb.prepare(`
      INSERT INTO authorization_decisions (
        decision_id, trace_id, subject_type, subject_id, operation_id, tool_id, grant_id, action,
        effect, reason_code, missing_scopes_json, missing_toolsets_json, required_scopes_json,
        evaluated_layers_json, decision_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "decision-legacy",
      "trace-legacy",
      "user",
      "legacy-subject",
      "authorization.governance.summary",
      "tool-legacy",
      "grant-legacy",
      "evaluate",
      "deny",
      "legacy-denied",
      "not-json",
      "null",
      "[\"scope:a\"]",
      "{",
      "null",
      "2026-06-04T00:00:00.000Z"
    );
    legacyDb.prepare(`
      INSERT INTO authorization_receipts (
        receipt_id, decision_id, subject_id, workspace_id, access_mode, receipt_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      "receipt-legacy",
      "decision-legacy",
      "legacy-subject",
      "workspace-legacy",
      "read",
      "not-json",
      "2026-06-04T00:00:00.000Z"
    );
    legacyDb.prepare(`
      INSERT INTO authorization_loan_records (
        loan_record_id, receipt_id, decision_id, subject_id, workspace_id, access_mode, loan_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "loan-legacy",
      "receipt-legacy",
      "decision-legacy",
      "legacy-subject",
      "workspace-legacy",
      "loan",
      "null",
      "2026-06-04T00:00:00.000Z"
    );
    legacyDb.prepare(`
      INSERT INTO authorization_denied_requests (
        denied_request_id, decision_id, subject_id, operation_id, tool_id, reason_code, denied_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "denied-legacy",
      "decision-legacy",
      "legacy-subject",
      "authorization.governance.summary",
      "tool-legacy",
      "legacy-denied",
      "not-json",
      "2026-06-04T00:00:00.000Z"
    );
    legacyDb.close();

    const store = createAuthorizationStore({ userDataPath });
    try {
      const decisionColumns = store.db.prepare("PRAGMA table_info(authorization_decisions)").all().map((row) => row.name);
      const deniedColumns = store.db.prepare("PRAGMA table_info(authorization_denied_requests)").all().map((row) => row.name);

      expect(decisionColumns).toEqual(
        expect.arrayContaining(["tenant_id", "workspace_id", "data_class", "requested_egress"])
      );
      expect(deniedColumns).toEqual(expect.arrayContaining(["tenant_id", "workspace_id"]));

      const decisions = store.listDecisions({ subjectId: "legacy-subject", limit: "0" });
      expect(decisions).toHaveLength(1);
      expect(decisions[0]).toMatchObject({
        decisionId: "decision-legacy",
        tenantId: "",
        workspaceId: "",
        dataClass: "",
        requestedEgress: "",
        missingScopes: [],
        missingToolsets: [],
        requiredScopes: ["scope:a"],
        evaluatedLayers: [],
        decision: {}
      });

      const receipts = store.listReceipts({ subjectId: "legacy-subject", limit: -1 });
      expect(receipts).toHaveLength(1);
      expect(receipts[0]).toMatchObject({
        receiptId: "receipt-legacy",
        receipt: {}
      });

      const loanRecords = store.listLoanRecords({ subjectId: "legacy-subject", limit: -1 });
      expect(loanRecords).toHaveLength(1);
      expect(loanRecords[0]).toMatchObject({
        loanRecordId: "loan-legacy",
        loanRecord: {}
      });

      const deniedRequests = store.listDeniedRequests({ subjectId: "legacy-subject", limit: -1 });
      expect(deniedRequests).toHaveLength(1);
      expect(deniedRequests[0]).toMatchObject({
        deniedRequestId: "denied-legacy",
        deniedRequest: {}
      });
    } finally {
      store.close();
    }
  });
});
