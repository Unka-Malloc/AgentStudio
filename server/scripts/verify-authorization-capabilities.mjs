import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  apiCapabilityId,
  createAuthorizationEngine,
  KERNEL_API_CAPABILITY_PERMISSIONS,
  KERNEL_CAPABILITY_PERMISSIONS,
  KERNEL_TOOL_CAPABILITY_PERMISSIONS,
  assertKnownKernelCapabilities,
  toolExecuteCapabilityId,
  unknownKernelCapabilities
} from "../platform/common/security/authorization/authorization-engine.mjs";
import { createAuthorizationStore } from "../platform/common/security/authorization/authorization-store.mjs";
import { SERVER_API_OPERATIONS } from "../platform/common/operation-dispatcher/operation-registry.mjs";
import { createToolCatalogRegistry } from "../platform/specialized/capabilities/tools/tool-management-core/catalog.mjs";
import { createToolManagementStore } from "../platform/specialized/capabilities/tools/tool-management-core/store.mjs";
import { createMemoryOpaqueCapabilityKeyProvider } from "../platform/common/security/authorization/opaque-capability-key.mjs";
import { createMemoryCapabilityBindingGuard } from "../platform/common/security/authorization/capability-binding-guard.mjs";

const catalog = createToolCatalogRegistry({ operations: SERVER_API_OPERATIONS }).getCatalog();
const apiCapabilities = new Set(KERNEL_API_CAPABILITY_PERMISSIONS);
const toolCapabilities = new Set(KERNEL_TOOL_CAPABILITY_PERMISSIONS);
const allCapabilities = new Set(KERNEL_CAPABILITY_PERMISSIONS);

assert.equal(
  allCapabilities.size,
  KERNEL_CAPABILITY_PERMISSIONS.length,
  "kernel capability permissions must be unique"
);

function isDeprecatedCompatibilityShim(operation = {}) {
  return operation.deprecated === true &&
    operation.aspects?.includes("internal-deprecated") &&
    operation.lifecycle?.maintenancePolicy === "compatibility-shim-only";
}

for (const operation of SERVER_API_OPERATIONS) {
  if (isDeprecatedCompatibilityShim(operation)) {
    assert.equal(
      apiCapabilities.has(apiCapabilityId(operation.id)),
      false,
      `${operation.id} is a deprecated compatibility shim and must not remain in the authorization kernel`
    );
    continue;
  }
  assert.ok(
    apiCapabilities.has(apiCapabilityId(operation.id)),
    `missing API capability for operation ${operation.id}`
  );
}

for (const tool of catalog.tools) {
  assert.ok(
    toolCapabilities.has(toolExecuteCapabilityId(tool.id)),
    `missing tool execute capability for tool ${tool.id}`
  );
}

assert.deepEqual(unknownKernelCapabilities(apiCapabilityId("unknown.operation")), [
  apiCapabilityId("unknown.operation")
]);
assert.deepEqual(assertKnownKernelCapabilities(apiCapabilityId("knowledge.search")), [apiCapabilityId("knowledge.search")]);
assert.throws(
  () => assertKnownKernelCapabilities(toolExecuteCapabilityId("unknown.tool")),
  /Unknown kernel capability permission/
);

const authorizationEngine = createAuthorizationEngine();

const capabilityAllowed = authorizationEngine.evaluate({
  operation: {
    id: "knowledge.search",
    requiredScopes: ["knowledge:read"],
    safety: { risk: "read_only" },
    readOnly: true
  },
  grant: {
    id: "grant-capability-search",
    capabilities: [apiCapabilityId("knowledge.search")]
  }
});
assert.equal(capabilityAllowed.allowed, true);
assert.deepEqual(capabilityAllowed.missingScopes, []);
assert.deepEqual(capabilityAllowed.requiredCapabilities, [apiCapabilityId("knowledge.search")]);

const capabilityDenied = authorizationEngine.evaluate({
  operation: {
    id: "knowledge.search",
    requiredScopes: ["knowledge:read"],
    safety: { risk: "read_only" },
    readOnly: true
  },
  grant: {
    id: "grant-capability-health",
    capabilities: [apiCapabilityId("knowledge.health")]
  }
});
assert.equal(capabilityDenied.allowed, false);
assert.equal(capabilityDenied.reasonCode, "missing_capabilities");
assert.deepEqual(capabilityDenied.missingCapabilities, [apiCapabilityId("knowledge.search")]);

const legacyScopeFallback = authorizationEngine.evaluate({
  operation: {
    id: "knowledge.search",
    requiredScopes: ["knowledge:read"],
    safety: { risk: "read_only" },
    readOnly: true
  },
  subject: {
    type: "legacy-scope-subject",
    subjectId: "legacy-subject",
    scopes: ["knowledge:read"]
  }
});
assert.equal(legacyScopeFallback.allowed, true);
assert.deepEqual(legacyScopeFallback.requiredCapabilities, [apiCapabilityId("knowledge.search")]);

const externalAuthWithoutDispatcherProof = authorizationEngine.evaluate({
  operation: {
    id: "mobile_relay.command.poll",
    externalAuth: true,
    requiredScopes: [],
    safety: { risk: "safe_write" },
    readOnly: false
  }
});
assert.equal(externalAuthWithoutDispatcherProof.allowed, false);
assert.equal(externalAuthWithoutDispatcherProof.reasonCode, "external_auth_not_verified");

const externalAuthWithDispatcherProof = authorizationEngine.evaluate({
  operation: {
    id: "mobile_relay.command.poll",
    externalAuth: true,
    requiredScopes: [],
    safety: { risk: "safe_write" },
    readOnly: false
  },
  context: {
    externalAuthVerified: true
  }
});
assert.equal(externalAuthWithDispatcherProof.allowed, true);
assert.equal(externalAuthWithDispatcherProof.reasonCode, "allowed_external_auth_verified");

const healthTool = catalog.tools.find((tool) => tool.id === "pact.agentLibrary.health");
assert.ok(healthTool, "pact.agentLibrary.health tool must exist");

const toolCapabilityAllowed = authorizationEngine.evaluate({
  tool: healthTool,
  grant: {
    id: "grant-tool-health",
    capabilities: [toolExecuteCapabilityId("pact.agentLibrary.health")]
  },
  grantRequired: true
});
assert.equal(toolCapabilityAllowed.allowed, true);
assert.deepEqual(toolCapabilityAllowed.requiredCapabilities, [toolExecuteCapabilityId("pact.agentLibrary.health")]);

const toolCapabilityDenied = authorizationEngine.evaluate({
  tool: healthTool,
  grant: {
    id: "grant-tool-search",
    capabilities: [toolExecuteCapabilityId("pact.agentLibrary.search")]
  },
  grantRequired: true
});
assert.equal(toolCapabilityDenied.allowed, false);
assert.equal(toolCapabilityDenied.reasonCode, "missing_capabilities");
assert.deepEqual(toolCapabilityDenied.missingCapabilities, [toolExecuteCapabilityId("pact.agentLibrary.health")]);

const auditDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-authz-capability-audit-"));
const authorizationStore = createAuthorizationStore({ userDataPath: auditDataPath });
try {
  const auditedEngine = createAuthorizationEngine({ store: authorizationStore });
  auditedEngine.evaluate({
    operation: {
      id: "knowledge.search",
      requiredScopes: ["knowledge:read"],
      safety: { risk: "read_only" },
      readOnly: true
    },
    grant: {
      id: "grant-capability-audit",
      capabilities: [apiCapabilityId("knowledge.search"), apiCapabilityId("knowledge.health")]
    },
    traceId: "trace-capability-audit-redaction"
  });
  authorizationStore.appendDecision({
    decisionId: "authz_decision_sensitive_capability_material",
    traceId: "trace-capability-audit-manual-redaction",
    subject: {
      type: "tool-grant",
      subjectId: "grant-sensitive",
      capabilities: [apiCapabilityId("knowledge.search")]
    },
    subjectCapabilities: [apiCapabilityId("knowledge.search")],
    capabilityKey: "ock_sensitiveOpaqueKeyMaterial",
    keyHash: "sensitive-key-hash",
    capabilitySetHash: "sensitive-capability-set-hash",
    effect: "deny",
    allowed: false,
    reasonCode: "manual_redaction_probe"
  });
  const storedCapabilityAudit = authorizationStore.listDecisions({
    traceId: "trace-capability-audit-redaction",
    limit: 10
  })[0];
  assert.equal(storedCapabilityAudit.decision.subjectCapabilities.redacted, true);
  assert.equal(storedCapabilityAudit.decision.subject.capabilities.redacted, true);
  assert.equal(JSON.stringify(storedCapabilityAudit.decision).includes(apiCapabilityId("knowledge.health")), false);

  const storedSensitiveAudit = authorizationStore.listDecisions({
    traceId: "trace-capability-audit-manual-redaction",
    limit: 10
  })[0];
  const storedSensitiveText = JSON.stringify(storedSensitiveAudit.decision);
  assert.equal(storedSensitiveText.includes("ock_sensitiveOpaqueKeyMaterial"), false);
  assert.equal(storedSensitiveText.includes("sensitive-key-hash"), false);
  assert.equal(storedSensitiveText.includes("sensitive-capability-set-hash"), false);
  assert.equal(storedSensitiveAudit.decision.capabilityKey, "<redacted-capability-key>");
  assert.equal(storedSensitiveAudit.decision.keyHash, "<redacted>");
  assert.equal(storedSensitiveAudit.decision.capabilitySetHash, "<redacted>");

  authorizationStore.appendDeniedRequest({
    deniedRequestId: "authz_denied_sensitive_direct",
    traceId: "trace-capability-audit-direct-denied-redaction",
    subject: {
      type: "tool-grant",
      subjectId: "grant-direct-sensitive",
      capabilities: [apiCapabilityId("knowledge.search"), apiCapabilityId("knowledge.health")]
    },
    subjectCapabilities: [apiCapabilityId("knowledge.search"), apiCapabilityId("knowledge.health")],
    capabilityKey: "ock_directSensitiveOpaqueKeyMaterial",
    keyHash: "direct-sensitive-key-hash",
    capabilitySetHash: "direct-sensitive-capability-set-hash",
    reasonCode: "direct_denied_redaction_probe"
  });

  const deniedSensitiveAudit = authorizationStore.listDeniedRequests({
    reasonCode: "manual_redaction_probe",
    limit: 10
  })[0];
  assert.equal(JSON.stringify(deniedSensitiveAudit.deniedRequest).includes("ock_sensitiveOpaqueKeyMaterial"), false);
  const directDeniedSensitiveAudit = authorizationStore.listDeniedRequests({
    reasonCode: "direct_denied_redaction_probe",
    limit: 10
  })[0];
  const directDeniedText = JSON.stringify(directDeniedSensitiveAudit.deniedRequest);
  assert.equal(directDeniedText.includes("ock_directSensitiveOpaqueKeyMaterial"), false);
  assert.equal(directDeniedText.includes("direct-sensitive-key-hash"), false);
  assert.equal(directDeniedText.includes("direct-sensitive-capability-set-hash"), false);
  assert.equal(directDeniedText.includes(apiCapabilityId("knowledge.health")), false);
  assert.equal(directDeniedSensitiveAudit.deniedRequest.subject.capabilities.redacted, true);
  assert.equal(directDeniedSensitiveAudit.deniedRequest.subjectCapabilities.redacted, true);
} finally {
  authorizationStore.close();
  await fs.rm(auditDataPath, { recursive: true, force: true });
}

const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-authz-capabilities-"));
const toolStore = createToolManagementStore({
  userDataPath,
  capabilityKeyProvider: createMemoryOpaqueCapabilityKeyProvider(),
  capabilityBindingGuard: createMemoryCapabilityBindingGuard()
});
try {
  const capabilityGrant = await toolStore.createGrant({
    label: "capability-only-tool-grant",
    capabilities: [toolExecuteCapabilityId("pact.agentLibrary.health")]
  });
  assert.match(capabilityGrant.token, /^ock_[A-Za-z0-9_-]+$/);
  assert.deepEqual(capabilityGrant.grant.scopes, []);
  assert.deepEqual(capabilityGrant.grant.capabilities, []);
  assert.equal(capabilityGrant.grant.credential.protocolVersion, "v0.0.1:risk-control:opaque-capability-key-1");
  assert.equal(capabilityGrant.grant.credential.credentialId, capabilityGrant.grant.id);
  assert.equal(capabilityGrant.grant.credential.capabilityCount, 1);
  assert.equal(JSON.stringify(toolStore.getRawGrant(capabilityGrant.grant.id).metadata).includes("pact.agentLibrary.health"), false);

  const toolCredentialAllowed = await toolStore.authorizeRequest({
    request: { headers: { authorization: `Bearer ${capabilityGrant.token}` } },
    tool: healthTool
  });
  assert.equal(toolCredentialAllowed.ok, true);

  const searchTool = catalog.tools.find((tool) => tool.id === "pact.agentLibrary.search");
  assert.ok(searchTool, "pact.agentLibrary.search tool must exist");
  const toolCredentialDenied = await toolStore.authorizeRequest({
    request: { headers: { authorization: `Bearer ${capabilityGrant.token}` } },
    tool: searchTool
  });
  assert.equal(toolCredentialDenied.ok, false);
  assert.equal(toolCredentialDenied.reasonCode, "missing_capabilities");

  toolStore.updateGrant(capabilityGrant.grant.id, {
    scopes: ["knowledge:read"],
    toolsets: ["pact.agentLibrary.read"],
    capabilities: [toolExecuteCapabilityId("pact.agentLibrary.search")]
  });
  const widenedProjectionStillDenied = await toolStore.authorizeRequest({
    request: { headers: { authorization: `Bearer ${capabilityGrant.token}` } },
    tool: searchTool
  });
  assert.equal(widenedProjectionStillDenied.ok, false);
  assert.equal(widenedProjectionStillDenied.reasonCode, "missing_capabilities");

  const unavailableDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-authz-capability-unavailable-kernel-"));
  const issueOnlyProvider = createMemoryOpaqueCapabilityKeyProvider();
  const unavailableKernelStore = createToolManagementStore({
    userDataPath: unavailableDataPath,
    capabilityKeyProvider: { issue: issueOnlyProvider.issue },
    capabilityBindingGuard: false
  });
  try {
    const unavailableGrant = await unavailableKernelStore.createGrant({
      label: "capability-kernel-unavailable-grant",
      capabilities: [toolExecuteCapabilityId("pact.agentLibrary.health")]
    });
    const unavailableDecision = await unavailableKernelStore.authorizeRequest({
      request: { headers: { authorization: `Bearer ${unavailableGrant.token}` } },
      tool: healthTool
    });
    assert.equal(unavailableDecision.ok, false);
    assert.equal(unavailableDecision.status, 503);
    assert.equal(unavailableDecision.reasonCode, "capability_kernel_unavailable");
    assert.deepEqual(unavailableDecision.missingCapabilities, [toolExecuteCapabilityId("pact.agentLibrary.health")]);
  } finally {
    unavailableKernelStore.close();
    issueOnlyProvider.close();
    await fs.rm(unavailableDataPath, { recursive: true, force: true });
  }

  await assert.rejects(
    () => toolStore.createGrant({
      label: "unknown-capability-must-not-fallback",
      capabilities: [toolExecuteCapabilityId("unknown.tool")]
    }),
    /Unknown tool grant capability permission/
  );
} finally {
  toolStore.close();
  await fs.rm(userDataPath, { recursive: true, force: true });
}

console.log("authorization capability verifier passed");
