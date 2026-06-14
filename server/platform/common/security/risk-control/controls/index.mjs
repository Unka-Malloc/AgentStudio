import {
  RISK_CONTROL_BOUNDARY_IDS,
  RISK_CONTROL_ENVIRONMENT_IDS,
  RISK_CONTROL_OBJECT_IDS
} from "../model/index.mjs";
import { activeCatalogRef } from "../catalogs/index.mjs";
import { defineRiskControlPoint } from "../registry/dsl.mjs";

const DEFAULT_VERIFIERS = Object.freeze([
  activeCatalogRef("verifiedBy", "verifier.risk-control.registry-integrity"),
  activeCatalogRef("verifiedBy", "verifier.risk-control.evidence-locator")
]);

const SPECIFIC_VERIFIERS = Object.freeze({
  "verifier.security.authorization-capabilities": activeCatalogRef("verifiedBy", "verifier.security.authorization-capabilities"),
  "verifier.security.console-auth": activeCatalogRef("verifiedBy", "verifier.security.console-auth"),
  "verifier.security.tool-management": activeCatalogRef("verifiedBy", "verifier.security.tool-management"),
  "verifier.security.mcp-http": activeCatalogRef("verifiedBy", "verifier.security.mcp-http"),
  "verifier.security.security-hardening": activeCatalogRef("verifiedBy", "verifier.security.security-hardening"),
  "verifier.risk-control.operation-envelope": activeCatalogRef("verifiedBy", "verifier.risk-control.operation-envelope")
});

function owner(boundaryId, objectId) {
  return {
    boundaryId,
    environmentId: RISK_CONTROL_ENVIRONMENT_IDS.PLATFORM_RUNTIME,
    objectId
  };
}

function refs({ enforcedBy, factSource, verifiedBy = [] }) {
  return {
    enforcedBy: activeCatalogRef("enforcedBy", enforcedBy),
    factSource: activeCatalogRef("factSource", factSource),
    verifiedBy: [
      ...DEFAULT_VERIFIERS,
      ...verifiedBy.map((id) => SPECIFIC_VERIFIERS[id] || activeCatalogRef("verifiedBy", id))
    ]
  };
}

function control(spec) {
  return defineRiskControlPoint({
    definitionVersion: "v1:m1.d1.l1.c1.r1",
    lifecycleState: "active",
    owner: owner(spec.boundaryId, spec.objectId),
    gate: spec.gate,
    controlId: spec.controlId,
    displayName: spec.displayName,
    description: spec.description || spec.displayName,
    binds: spec.binds || [],
    decision: {
      allow: true,
      deny: true,
      needsApproval: spec.gate === "approve",
      degraded: spec.degraded === true
    },
    failsClosed: {
      reasonCode: spec.reasonCode || `${spec.controlId.replace(/[^a-z0-9]+/g, "_")}_failed`,
      status: spec.status || 403
    },
    evidence: {
      requiredFields: spec.evidenceFields || ["traceId", "controlRef", "decision", "reasonCode"]
    },
    migrationSource: {
      legacyLabel: spec.legacyLabel || spec.displayName,
      sourcePath: spec.sourcePath || "legacy:risk-control-migration-source"
    },
    ...refs(spec)
  });
}

const CLIENT = RISK_CONTROL_BOUNDARY_IDS.CLIENT_MCP_INGRESS;
const EXTERNAL = RISK_CONTROL_BOUNDARY_IDS.SERVER_API_EGRESS;
const PLATFORM = RISK_CONTROL_BOUNDARY_IDS.PLATFORM_SELF;
const IDENTITY = RISK_CONTROL_OBJECT_IDS.IDENTITY_ADMISSION_AUTHENTICATION;
const POLICY = RISK_CONTROL_OBJECT_IDS.PERMISSION_BEHAVIOR_POLICY;
const DATA = RISK_CONTROL_OBJECT_IDS.DATA_STATE_SEMANTICS;
const TRAFFIC = RISK_CONTROL_OBJECT_IDS.TRAFFIC_RESOURCE_MANAGEMENT;
const AUDIT = RISK_CONTROL_OBJECT_IDS.AUDIT_FACT_VERIFICATION;

export const RISK_CONTROL_POINTS = Object.freeze([
  control({
    boundaryId: CLIENT,
    objectId: IDENTITY,
    gate: "admit",
    controlId: "client.registration.admit",
    displayName: "client registration",
    enforcedBy: "component.mcp-adapter",
    factSource: "fact.mcp-grant",
    verifiedBy: ["verifier.security.mcp-http"],
    binds: ["client", "credential"]
  }),
  control({
    boundaryId: CLIENT,
    objectId: IDENTITY,
    gate: "bind",
    controlId: "client.agent-identity.bind",
    displayName: "agent identity",
    enforcedBy: "component.mcp-adapter",
    factSource: "fact.mcp-grant",
    verifiedBy: ["verifier.security.mcp-http"],
    binds: ["subject", "agentProfile"]
  }),
  control({
    boundaryId: CLIENT,
    objectId: IDENTITY,
    gate: "bind",
    controlId: "client.operator-identity.bind",
    displayName: "user/operator identity",
    enforcedBy: "component.console-auth",
    factSource: "fact.console-session",
    verifiedBy: ["verifier.security.console-auth"],
    binds: ["subject", "session"]
  }),
  control({
    boundaryId: CLIENT,
    objectId: IDENTITY,
    gate: "bind",
    controlId: "client.device-runtime.bind",
    displayName: "device/runtime identity",
    enforcedBy: "component.mcp-adapter",
    factSource: "fact.mcp-grant",
    verifiedBy: ["verifier.security.mcp-http"],
    binds: ["device", "runtime"]
  }),
  control({
    boundaryId: CLIENT,
    objectId: IDENTITY,
    gate: "authorize",
    controlId: "client.mcp-grant.authorize",
    displayName: "MCP grant",
    enforcedBy: "component.tool-management",
    factSource: "fact.tool-grant-store",
    verifiedBy: ["verifier.security.tool-management"],
    binds: ["grant", "scopes"]
  }),
  control({
    boundaryId: CLIENT,
    objectId: IDENTITY,
    gate: "bind",
    controlId: "client.opaque-key.bind",
    displayName: "opaque key binding",
    enforcedBy: "component.binding-guard",
    factSource: "fact.binding-ledger",
    verifiedBy: ["verifier.security.tool-management"],
    binds: ["capabilityKey", "subject"]
  }),
  control({
    boundaryId: CLIENT,
    objectId: IDENTITY,
    gate: "audit-recover",
    controlId: "client.token-session-rotation.audit",
    displayName: "token/session rotation",
    enforcedBy: "component.console-auth",
    factSource: "fact.console-session",
    verifiedBy: ["verifier.security.console-auth"],
    binds: ["session", "credentialFamily"]
  }),
  control({
    boundaryId: CLIENT,
    objectId: IDENTITY,
    gate: "admit",
    controlId: "client.discovery-trust.admit",
    displayName: "discovery trust",
    enforcedBy: "component.mcp-adapter",
    factSource: "fact.operation-registry",
    verifiedBy: ["verifier.security.mcp-http"],
    binds: ["toolProjection", "grant"]
  }),

  control({
    boundaryId: CLIENT,
    objectId: POLICY,
    gate: "authorize",
    controlId: "client.operation-permission.authorize",
    displayName: "operation permission",
    enforcedBy: "component.operation-dispatcher",
    factSource: "fact.authorization-policy",
    verifiedBy: ["verifier.security.authorization-capabilities"],
    binds: ["operation", "subject"]
  }),
  control({
    boundaryId: CLIENT,
    objectId: POLICY,
    gate: "authorize",
    controlId: "client.tool-skill-permission.authorize",
    displayName: "tool/skill permission",
    enforcedBy: "component.tool-management",
    factSource: "fact.tool-grant-store",
    verifiedBy: ["verifier.security.tool-management"],
    binds: ["tool", "skill", "grant"]
  }),
  control({
    boundaryId: CLIENT,
    objectId: POLICY,
    gate: "authorize",
    controlId: "client.workspace-scope.authorize",
    displayName: "workspace scope",
    enforcedBy: "component.operation-policy",
    factSource: "fact.authorization-policy",
    verifiedBy: ["verifier.security.authorization-capabilities"],
    binds: ["workspace", "subject"]
  }),
  control({
    boundaryId: CLIENT,
    objectId: POLICY,
    gate: "authorize",
    controlId: "client.data-class.authorize",
    displayName: "dataClass policy",
    enforcedBy: "component.operation-policy",
    factSource: "fact.authorization-policy",
    verifiedBy: ["verifier.security.authorization-capabilities"],
    binds: ["dataClass", "operation"]
  }),
  control({
    boundaryId: CLIENT,
    objectId: POLICY,
    gate: "authorize",
    controlId: "client.egress-policy.authorize",
    displayName: "egress policy",
    enforcedBy: "component.operation-policy",
    factSource: "fact.egress-policy",
    binds: ["egress", "operation"]
  }),
  control({
    boundaryId: CLIENT,
    objectId: POLICY,
    gate: "approve",
    controlId: "client.high-risk-confirmation.approve",
    displayName: "high-risk confirmation",
    enforcedBy: "component.operation-policy",
    factSource: "fact.operation-ledger",
    verifiedBy: ["verifier.risk-control.operation-envelope"],
    binds: ["pendingOperation", "approval"]
  }),
  control({
    boundaryId: CLIENT,
    objectId: POLICY,
    gate: "admit",
    controlId: "client.capability-discovery.admit",
    displayName: "capability discovery",
    enforcedBy: "component.mcp-adapter",
    factSource: "fact.operation-registry",
    verifiedBy: ["verifier.security.mcp-http"],
    binds: ["grant", "projection"]
  }),
  control({
    boundaryId: CLIENT,
    objectId: POLICY,
    gate: "authorize",
    controlId: "client.deny-semantics.authorize",
    displayName: "deny semantics",
    enforcedBy: "component.operation-dispatcher",
    factSource: "fact.authorization-policy",
    verifiedBy: ["verifier.security.authorization-capabilities"],
    binds: ["decision", "reasonCode"]
  }),

  ...[
    ["client.upload-semantics.execute", "upload semantics"],
    ["client.file-validation.execute", "file validation"],
    ["client.path-safety.execute", "path safety"],
    ["client.context-semantics.execute", "context semantics"],
    ["client.export-download-semantics.execute", "export/download semantics"],
    ["client.asset-lifecycle.execute", "asset lifecycle"],
    ["client.lifecycle-state.execute", "client lifecycle state"],
    ["client.local-bridge-transport.execute", "local bridge transport semantics"]
  ].map(([controlId, displayName]) => control({
    boundaryId: CLIENT,
    objectId: DATA,
    gate: "execute",
    controlId,
    displayName,
    enforcedBy: "component.operation-dispatcher",
    factSource: "fact.operation-ledger",
    verifiedBy: ["verifier.risk-control.operation-envelope"],
    binds: ["resource", "state"]
  })),

  ...[
    ["client.qps-burst.execute", "QPS/burst"],
    ["client.concurrency.execute", "concurrency"],
    ["client.upload-bandwidth.execute", "upload bandwidth"],
    ["client.storage-quota.execute", "storage quota"],
    ["client.context-quota.execute", "context quota"],
    ["client.runtime-distribution.execute", "runtime distribution"],
    ["client.retry-backoff.execute", "retry/backoff"]
  ].map(([controlId, displayName]) => control({
    boundaryId: CLIENT,
    objectId: TRAFFIC,
    gate: "execute",
    controlId,
    displayName,
    enforcedBy: "component.quota-bulkhead",
    factSource: "fact.runtime-health",
    verifiedBy: ["verifier.security.security-hardening"],
    binds: ["subject", "quota"]
  })),

  ...[
    ["client.access-receipt.audit", "access receipt"],
    ["client.loan-record.audit", "loan record"],
    ["client.denied-request.audit", "denied request"],
    ["client.trace-log-redaction.audit", "trace/log redaction"],
    ["client.checkpoint-node.audit", "checkpoint node"],
    ["client.recovery-evidence.audit", "recovery evidence"]
  ].map(([controlId, displayName]) => control({
    boundaryId: CLIENT,
    objectId: AUDIT,
    gate: "audit-recover",
    controlId,
    displayName,
    enforcedBy: "component.audit-store",
    factSource: "fact.audit-store",
    verifiedBy: ["verifier.security.security-hardening"],
    binds: ["trace", "evidence"]
  })),

  control({
    boundaryId: EXTERNAL,
    objectId: IDENTITY,
    gate: "admit",
    controlId: "external.provider-registration.admit",
    displayName: "provider registration",
    enforcedBy: "component.external-service-registry",
    factSource: "fact.external-service-manifest",
    binds: ["provider", "manifest"]
  }),
  control({
    boundaryId: EXTERNAL,
    objectId: IDENTITY,
    gate: "bind",
    controlId: "external.provider-account.bind",
    displayName: "provider account",
    enforcedBy: "component.external-service-registry",
    factSource: "fact.external-service-manifest",
    binds: ["providerAccount", "tenant"]
  }),
  control({
    boundaryId: EXTERNAL,
    objectId: IDENTITY,
    gate: "bind",
    controlId: "external.credential-secret.bind",
    displayName: "OAuth/PAT/API key/service account",
    enforcedBy: "component.secret-store",
    factSource: "fact.secret-store",
    binds: ["secretRef", "providerAccount"]
  }),
  control({
    boundaryId: EXTERNAL,
    objectId: IDENTITY,
    gate: "audit-recover",
    controlId: "external.credential-status.audit",
    displayName: "credential status",
    enforcedBy: "component.secret-store",
    factSource: "fact.secret-store",
    binds: ["credential", "status"]
  }),
  control({
    boundaryId: EXTERNAL,
    objectId: IDENTITY,
    gate: "bind",
    controlId: "external.tenant-mapping.bind",
    displayName: "tenant mapping",
    enforcedBy: "component.external-service-registry",
    factSource: "fact.external-service-manifest",
    binds: ["tenant", "provider"]
  }),
  control({
    boundaryId: EXTERNAL,
    objectId: IDENTITY,
    gate: "admit",
    controlId: "external.webhook-identity.admit",
    displayName: "webhook identity",
    enforcedBy: "component.servicehub-egress",
    factSource: "fact.provider-receipt",
    binds: ["webhook", "provider"]
  }),
  control({
    boundaryId: EXTERNAL,
    objectId: IDENTITY,
    gate: "admit",
    controlId: "external.provider-capability-declaration.admit",
    displayName: "provider capability declaration",
    enforcedBy: "component.external-service-registry",
    factSource: "fact.external-service-manifest",
    binds: ["providerCapability", "manifest"]
  }),

  ...[
    ["external.provider-scope.authorize", "provider scope mapping"],
    ["external.side-effect-policy.authorize", "external side effect policy"],
    ["external.destructive-operation.approve", "destructive operation policy"],
    ["external.provider-object-scope.authorize", "provider object scope"],
    ["external.write-target.authorize", "write target policy"],
    ["external.model-policy.authorize", "model policy"],
    ["external.connector-conformance.authorize", "connector conformance"]
  ].map(([controlId, displayName]) => control({
    boundaryId: EXTERNAL,
    objectId: POLICY,
    gate: controlId.endsWith(".approve") ? "approve" : "authorize",
    controlId,
    displayName,
    enforcedBy: "component.connector-governance",
    factSource: "fact.external-service-manifest",
    binds: ["provider", "operation", "scope"]
  })),

  ...[
    ["external.import-semantics.execute", "import semantics"],
    ["external.export-semantics.execute", "export semantics"],
    ["external.sync-semantics.execute", "sync semantics"],
    ["external.mirror-semantics.execute", "mirror semantics"],
    ["external.contract-mode-semantics.execute", "contract-mode semantics"],
    ["external.persistence-semantics.execute", "persistence semantics"],
    ["external.version-semantics.execute", "version semantics"],
    ["external.credential-lifecycle-state.execute", "credential lifecycle state"],
    ["external.connector-lifecycle-state.execute", "connector lifecycle state"],
    ["external.mirror-cleanup-state.execute", "mirror cleanup state"]
  ].map(([controlId, displayName]) => control({
    boundaryId: EXTERNAL,
    objectId: DATA,
    gate: "execute",
    controlId,
    displayName,
    enforcedBy: "component.servicehub-egress",
    factSource: "fact.operation-ledger",
    binds: ["externalObject", "state"]
  })),

  ...[
    ["external.provider-rate-limit.execute", "provider rate limit"],
    ["external.circuit-breaker.execute", "circuit breaker"],
    ["external.model-cost.execute", "model cost"],
    ["external.api-cost.execute", "API cost"],
    ["external.sync-frequency.execute", "sync frequency"],
    ["external.batch-policy.execute", "batch policy"],
    ["external.retry-policy.execute", "external retry"]
  ].map(([controlId, displayName]) => control({
    boundaryId: EXTERNAL,
    objectId: TRAFFIC,
    gate: "execute",
    controlId,
    displayName,
    enforcedBy: "component.quota-bulkhead",
    factSource: "fact.runtime-health",
    verifiedBy: ["verifier.security.security-hardening"],
    binds: ["provider", "quota"]
  })),

  ...[
    ["external.provider-receipt.audit", "provider receipt"],
    ["external.webhook-evidence.audit", "webhook evidence"],
    ["external.compliance-retention.audit", "compliance retention"],
    ["external.failure-evidence.audit", "external failure evidence"]
  ].map(([controlId, displayName]) => control({
    boundaryId: EXTERNAL,
    objectId: AUDIT,
    gate: "audit-recover",
    controlId,
    displayName,
    enforcedBy: "component.audit-store",
    factSource: "fact.provider-receipt",
    binds: ["providerReceipt", "audit"]
  })),

  ...[
    ["platform.console-auth.admit", "Console Auth", "component.console-auth", "fact.console-session", "admit"],
    ["platform.secret-store.bind", "SecretStore", "component.secret-store", "fact.secret-store", "bind"],
    ["platform.binding-guard.bind", "Binding Guard", "component.binding-guard", "fact.binding-ledger", "bind"],
    ["platform.capability-kernel.authorize", "Capability Kernel", "component.capability-kernel", "fact.capability-kernel", "authorize"],
    ["platform.credential-redaction.audit", "credential redaction", "component.audit-store", "fact.audit-store", "audit-recover"]
  ].map(([controlId, displayName, enforcedBy, factSource, gate]) => control({
    boundaryId: PLATFORM,
    objectId: IDENTITY,
    gate,
    controlId,
    displayName,
    enforcedBy,
    factSource,
    verifiedBy: ["verifier.security.console-auth", "verifier.security.tool-management"],
    binds: ["subject", "credential"]
  })),

  ...[
    ["platform.capability-manifest.authorize", "Capability manifest", "component.capability-kernel", "fact.operation-registry"],
    ["platform.capability-verify.authorize", "Capability Kernel verify", "component.capability-kernel", "fact.capability-kernel"],
    ["platform.binding-verify.authorize", "Binding Guard verify", "component.binding-guard", "fact.binding-ledger"],
    ["platform.operation-policy.authorize", "Operation Policy", "component.operation-policy", "fact.authorization-policy"],
    ["platform.tool-management.authorize", "Tool Management", "component.tool-management", "fact.tool-grant-store"],
    ["platform.risk-policy.approve", "risk policy", "component.operation-policy", "fact.operation-ledger"]
  ].map(([controlId, displayName, enforcedBy, factSource]) => control({
    boundaryId: PLATFORM,
    objectId: POLICY,
    gate: controlId.endsWith(".approve") ? "approve" : "authorize",
    controlId,
    displayName,
    enforcedBy,
    factSource,
    verifiedBy: ["verifier.security.authorization-capabilities", "verifier.security.tool-management"],
    binds: ["operation", "capability", "policy"]
  })),

  ...[
    ["platform.canonical-state.execute", "Pact canonical state"],
    ["platform.operation-ledger.execute", "Operation Ledger"],
    ["platform.state-commit.execute", "StateCommit"],
    ["platform.cas-merkle-state.execute", "CAS/Merkle state"],
    ["platform.checkpoint-tree.execute", "Checkpoint Tree"],
    ["platform.state-vocabulary.execute", "state vocabulary"],
    ["platform.security-recovery-lifecycle.execute", "security recovery lifecycle"]
  ].map(([controlId, displayName]) => control({
    boundaryId: PLATFORM,
    objectId: DATA,
    gate: "execute",
    controlId,
    displayName,
    enforcedBy: "component.operation-ledger",
    factSource: "fact.operation-ledger",
    verifiedBy: ["verifier.risk-control.operation-envelope"],
    binds: ["state", "operation"]
  })),

  ...[
    ["platform.budget-policy.execute", "Budget Policy"],
    ["platform.queue-control.execute", "queue control"],
    ["platform.durable-workflow.execute", "durable workflow"],
    ["platform.performance-capacity.execute", "performance capacity gate"],
    ["platform.idempotency.execute", "idempotency"]
  ].map(([controlId, displayName]) => control({
    boundaryId: PLATFORM,
    objectId: TRAFFIC,
    gate: "execute",
    controlId,
    displayName,
    enforcedBy: controlId.includes("queue") || controlId.includes("workflow") ? "component.runtime-queue" : "component.runtime-capacity",
    factSource: "fact.runtime-health",
    verifiedBy: ["verifier.security.security-hardening"],
    binds: ["resource", "budget"]
  })),

  ...[
    ["platform.audit.audit", "Audit", "component.audit-store", "fact.audit-store"],
    ["platform.operation-ledger.audit", "Operation Ledger", "component.operation-ledger", "fact.operation-ledger"],
    ["platform.checkpoint-tree.audit", "Checkpoint Tree", "component.checkpoint-tree", "fact.checkpoint-tree"],
    ["platform.runtime-logger.audit", "runtime logger", "component.audit-store", "fact.audit-store"],
    ["platform.production-readiness-report.audit", "production readiness report", "component.audit-store", "fact.audit-store"],
    ["platform.security-recovery-package.audit", "security recovery package", "component.recovery-package", "fact.checkpoint-tree"]
  ].map(([controlId, displayName, enforcedBy, factSource]) => control({
    boundaryId: PLATFORM,
    objectId: AUDIT,
    gate: "audit-recover",
    controlId,
    displayName,
    enforcedBy,
    factSource,
    verifiedBy: ["verifier.security.security-hardening"],
    binds: ["audit", "recovery"]
  }))
]);

export function riskControlById() {
  return new Map(RISK_CONTROL_POINTS.map((controlPoint) => [controlPoint.controlId, controlPoint]));
}
