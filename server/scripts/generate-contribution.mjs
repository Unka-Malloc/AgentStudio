import fs from 'node:fs';
import path from 'node:path';

const def = {
  machineId: "contribution.lifecycle.v1",
  entityType: "contribution",
  version: "1.0.0",
  description: "Terminal contribution asset lifecycle.",
  initialState: "submitted",
  states: [
    { id: "submitted" },
    { id: "preview" },
    { id: "scanned" },
    { id: "needs_changes" },
    { id: "reviewed" },
    { id: "published" },
    { id: "adopted" },
    { id: "deprecated" },
    { id: "rejected", terminal: true },
    { id: "revoked", terminal: true }
  ],
  events: [
    { id: "contribution.submit", riskLevel: "low", idempotent: true },
    { id: "contribution.preview", riskLevel: "low" },
    { id: "contribution.scan_passed", riskLevel: "low" },
    { id: "contribution.scan_failed", riskLevel: "low" },
    { id: "contribution.review_approved", riskLevel: "medium" },
    { id: "contribution.review_rejected", riskLevel: "low", idempotent: true },
    { id: "contribution.changes_requested", riskLevel: "low" },
    { id: "contribution.publish", riskLevel: "high" },
    { id: "contribution.adopt", riskLevel: "high" },
    { id: "contribution.deprecate", riskLevel: "medium" },
    { id: "contribution.revoke", riskLevel: "high" }
  ],
  allowedTerminalEvents: ["contribution.review_rejected", "contribution.revoke"],
  invariants: ["SM-GOV-006", "SM-GOV-007"],
  proofObligations: [
    "PO-CONTRIB-001",
    "PO-CONTRIB-002",
    "PO-CONTRIB-003",
    "PO-CONTRIB-004",
    "PO-CONTRIB-005",
    "PO-CONTRIB-006"
  ],
  proofMappings: [
    { obligationId: "PO-CONTRIB-001", method: "path_includes_state", params: { target: "published", requiredBefore: "reviewed" } },
    { obligationId: "PO-CONTRIB-002", method: "path_includes_state", params: { target: "adopted", requiredBefore: "published" } },
    { obligationId: "PO-CONTRIB-003", method: "terminal_state", params: { target: "rejected" } },
    { obligationId: "PO-CONTRIB-004", method: "terminal_state", params: { target: "revoked" } },
    { obligationId: "PO-CONTRIB-005", method: "matrix_error_codes", params: {} },
    { obligationId: "PO-CONTRIB-006", method: "integration_test", params: { target: "runtime_engine" } }
  ]
};

const legals = {
  submitted: { "contribution.preview": { result: "legal_transition", to: "preview" } },
  preview: { 
    "contribution.scan_passed": { result: "legal_transition", to: "scanned" },
    "contribution.scan_failed": { result: "legal_transition", to: "rejected" }
  },
  scanned: { 
    "contribution.review_approved": { result: "legal_transition", to: "reviewed" },
    "contribution.changes_requested": { result: "legal_transition", to: "needs_changes" }
  },
  needs_changes: { 
    "contribution.preview": { result: "legal_transition", to: "preview" },
    "contribution.submit": { result: "legal_transition", to: "submitted" }
  },
  reviewed: { 
    "contribution.publish": { result: "legal_transition", to: "published", guards: ["require_approval"] }
  },
  published: { 
    "contribution.adopt": { result: "legal_transition", to: "adopted", guards: ["require_adoption_policy"] },
    "contribution.deprecate": { result: "legal_transition", to: "deprecated" } // From test "published -> deprecated"? No, test says adopted -> deprecated
  },
  adopted: { 
    "contribution.deprecate": { result: "legal_transition", to: "deprecated" }
  },
  deprecated: { 
    "contribution.revoke": { result: "legal_transition", to: "revoked", guards: ["require_admin"] }
  }
};

const errors = {
  "submitted::contribution.publish": "CONTRIBUTION_PUBLISH_BEFORE_REVIEW",
  "submitted::contribution.adopt": "CONTRIBUTION_NOT_PUBLISHED",
  "submitted::contribution.scan_passed": "CONTRIBUTION_NOT_PREVIEWED",
};

const totalMatrix = [];
for (const s of def.states) {
  for (const e of def.events) {
    if (s.terminal) {
       if (s.id === 'rejected' && e.id === 'contribution.submit') {
           totalMatrix.push({ from: s.id, event: e.id, result: "illegal_transition", errorCode: "CONTRIBUTION_TERMINAL_REJECTED" });
       } else if (s.id === 'revoked' && e.id === 'contribution.submit') {
           totalMatrix.push({ from: s.id, event: e.id, result: "illegal_transition", errorCode: "CONTRIBUTION_TERMINAL_REVOKED" });
       } else if (s.id === 'rejected' && e.id === 'contribution.review_rejected') {
           totalMatrix.push({ from: s.id, event: e.id, result: "ignored_idempotent_event" });
       } else if (s.id === 'revoked' && e.id === 'contribution.revoke') {
           totalMatrix.push({ from: s.id, event: e.id, result: "ignored_idempotent_event" });
       } else {
           totalMatrix.push({ from: s.id, event: e.id, result: "illegal_transition", errorCode: "INVALID_TERMINAL_TRANSITION" });
       }
       continue;
    }

    if (e.id === "contribution.submit" && s.id === "submitted") {
        totalMatrix.push({ from: s.id, event: e.id, result: "ignored_idempotent_event" });
        continue;
    }
    if (e.id === "contribution.publish" && s.id === "published") {
        totalMatrix.push({ from: s.id, event: e.id, result: "ignored_idempotent_event" });
        continue;
    }

    if (legals[s.id] && legals[s.id][e.id]) {
      totalMatrix.push({ from: s.id, event: e.id, ...legals[s.id][e.id] });
    } else {
      let code = errors[`${s.id}::${e.id}`] || "INVALID_TRANSITION";
      totalMatrix.push({ from: s.id, event: e.id, result: "illegal_transition", errorCode: code });
    }
  }
}
def.totalMatrix = totalMatrix;
fs.writeFileSync(path.join(process.cwd(), 'server/platform/common/state-machine/definitions/contribution.lifecycle.v1.json'), JSON.stringify(def, null, 2));
