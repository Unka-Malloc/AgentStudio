import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertSecurityGovernanceModelComplete,
  createPlatformSelfGovernanceProfile,
  createSecurityBoundaryGovernanceProfile,
  describeSecurityGovernanceModel,
  getSecurityGovernanceBoundary,
  getSecurityGovernanceEnvironment,
  governanceControlsForBoundary,
  listSecurityGovernanceBoundaries,
  listSecurityGovernanceEnvironments,
  listSecurityGovernanceObjects,
  platformSelfGovernanceControls
} from "../../../server/platform/common/security/governance/security-governance-model.mjs";
import {
  SECURITY_BOUNDARY_IDS,
  SECURITY_ENVIRONMENT_IDS,
  SECURITY_GOVERNANCE_MODEL_VERSION,
  SECURITY_GOVERNANCE_OBJECT_ORDER
} from "../../../server/platform/common/security/governance/security-governance-constants.mjs";
import {
  describeClientBoundaryGovernance,
  listClientBoundaryGovernanceControls
} from "../../../server/platform/common/security/governance/client-boundary/index.mjs";
import {
  describeExternalServiceBoundaryGovernance,
  listExternalServiceBoundaryGovernanceControls
} from "../../../server/platform/common/security/governance/external-service-boundary/index.mjs";
import {
  describePlatformSelfGovernance,
  listPlatformSelfGovernanceControls
} from "../../../server/platform/common/security/governance/platform-self-governance/index.mjs";
import { createAuthorizationStore } from "../../../server/platform/common/security/authorization/authorization-store.mjs";

const tempRoots = [];

async function tempDir(prefix) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

async function withAuthorizationStore(testCase) {
  const userDataPath = await tempDir("pact-security-governance-store-extra-");
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

describe("security governance model extra coverage", () => {
  it("returns cloned model data, handles missing identifiers, and builds profile summaries", () => {
    const boundaries = listSecurityGovernanceBoundaries();
    const environments = listSecurityGovernanceEnvironments();
    const objects = listSecurityGovernanceObjects();

    expect(boundaries).toHaveLength(2);
    expect(environments).toHaveLength(3);
    expect(objects).toHaveLength(5);

    boundaries[0].label = "mutated-boundary";
    environments[0].typicalComponents.push("mutated-component");
    objects[0].label = "mutated-object";

    expect(listSecurityGovernanceBoundaries()[0].label).not.toBe("mutated-boundary");
    expect(listSecurityGovernanceEnvironments()[0].typicalComponents).not.toContain("mutated-component");
    expect(listSecurityGovernanceObjects()[0].label).not.toBe("mutated-object");

    expect(getSecurityGovernanceBoundary()).toBeNull();
    expect(getSecurityGovernanceBoundary("missing-boundary")).toBeNull();
    expect(getSecurityGovernanceEnvironment()).toBeNull();
    expect(getSecurityGovernanceEnvironment("missing-environment")).toBeNull();

    const clientBoundary = getSecurityGovernanceBoundary(SECURITY_BOUNDARY_IDS.CLIENT_MCP_INGRESS);
    const platformEnvironment = getSecurityGovernanceEnvironment(SECURITY_ENVIRONMENT_IDS.PLATFORM_RUNTIME);

    expect(clientBoundary).toMatchObject({
      id: SECURITY_BOUNDARY_IDS.CLIENT_MCP_INGRESS
    });
    expect(platformEnvironment).toMatchObject({
      id: SECURITY_ENVIRONMENT_IDS.PLATFORM_RUNTIME
    });

    expect(governanceControlsForBoundary("missing-boundary")).toEqual([]);
    expect(governanceControlsForBoundary(SECURITY_BOUNDARY_IDS.CLIENT_MCP_INGRESS).map((entry) => entry.objectId)).toEqual(
      SECURITY_GOVERNANCE_OBJECT_ORDER
    );
    expect(platformSelfGovernanceControls().map((entry) => entry.objectId)).toEqual(SECURITY_GOVERNANCE_OBJECT_ORDER);

    const boundaryProfile = createSecurityBoundaryGovernanceProfile(SECURITY_BOUNDARY_IDS.CLIENT_MCP_INGRESS);
    expect(boundaryProfile).toMatchObject({
      modelVersion: SECURITY_GOVERNANCE_MODEL_VERSION,
      boundary: clientBoundary
    });
    expect(boundaryProfile.objects).toHaveLength(5);
    expect(boundaryProfile.controlsByObject).toHaveLength(5);

    boundaryProfile.objects[0].label = "changed";
    expect(listSecurityGovernanceObjects()[0].label).not.toBe("changed");

    const platformProfile = createPlatformSelfGovernanceProfile();
    expect(platformProfile).toMatchObject({
      modelVersion: SECURITY_GOVERNANCE_MODEL_VERSION,
      environment: platformEnvironment
    });
    expect(platformProfile.controlsByObject).toHaveLength(5);

    expect(describeClientBoundaryGovernance().boundary.id).toBe(SECURITY_BOUNDARY_IDS.CLIENT_MCP_INGRESS);
    expect(listClientBoundaryGovernanceControls()).toHaveLength(5);
    expect(describeExternalServiceBoundaryGovernance().boundary.id).toBe(SECURITY_BOUNDARY_IDS.SERVER_API_EGRESS);
    expect(listExternalServiceBoundaryGovernanceControls()).toHaveLength(5);
    expect(describePlatformSelfGovernance().environment.id).toBe(SECURITY_ENVIRONMENT_IDS.PLATFORM_RUNTIME);
    expect(listPlatformSelfGovernanceControls()).toHaveLength(5);

    const model = describeSecurityGovernanceModel();
    expect(model).toMatchObject({
      modelVersion: SECURITY_GOVERNANCE_MODEL_VERSION,
      boundaryCount: 2,
      environmentCount: 3,
      objectCount: 5
    });
    expect(model.boundaryProfiles).toHaveLength(2);
    expect(model.platformSelfGovernance.environment).toMatchObject({
      id: SECURITY_ENVIRONMENT_IDS.PLATFORM_RUNTIME
    });

    expect(() => assertSecurityGovernanceModelComplete()).not.toThrow();
    expect(() => createSecurityBoundaryGovernanceProfile("missing-boundary"))
      .toThrow("Unknown security governance boundary: missing-boundary");
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
    const userDataPath = await tempDir("pact-security-governance-legacy-");
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
