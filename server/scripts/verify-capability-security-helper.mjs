import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  apiCapabilityId,
  toolExecuteCapabilityId
} from "../platform/common/security/authorization/authorization-engine.mjs";
import {
  capabilityBindingGuardStatePath
} from "../platform/common/security/authorization/capability-binding-guard.mjs";
import {
  CAPABILITY_SECURITY_HELPER_PROTOCOL_VERSION,
  createCommandCapabilitySecurityClient
} from "../platform/common/security/authorization/capability-security-helper-client.mjs";
import {
  capabilityKernelStatePath
} from "../platform/common/security/authorization/opaque-capability-key.mjs";
import { createToolManagementStore } from "../platform/specialized/capabilities/tools/tool-management-core/store.mjs";

const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "pact-capability-security-helper-"));
const toolDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "pact-capability-security-helper-tool-"));
const envToolDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "pact-capability-security-helper-env-tool-"));
const kernelAlias = "verify-helper-kernel";
const bindingAlias = "verify-helper-binding";
const helper = createCommandCapabilitySecurityClient({
  dataDir,
  backend: "local-file",
  alias: kernelAlias,
  bindingBackend: "local-file",
  bindingAlias
});

function assertOpaque(key) {
  assert.match(key, /^ock_[A-Za-z0-9_-]+$/);
  assert.equal(key.includes("."), false);
}

async function assertNoPlaintext(filePath, values = []) {
  const bytes = await fs.readFile(filePath, "utf8");
  for (const value of values) {
    assert.equal(bytes.includes(value), false, `${path.basename(filePath)} must not contain ${value}`);
  }
}

try {
  const healthCapability = toolExecuteCapabilityId("pact.agentLibrary.health");
  const searchCapability = apiCapabilityId("knowledge.search");
  const issued = await helper.issue({
    credentialId: "credential-helper-a",
    capabilities: [searchCapability, healthCapability],
    expiresAt: "9999-12-31T23:59:59.999Z"
  });
  assert.equal(issued.protocolVersion, "v0.0.1:risk-control:opaque-capability-key-1");
  assert.equal(issued.helperProtocolVersion, CAPABILITY_SECURITY_HELPER_PROTOCOL_VERSION);
  assertOpaque(issued.capabilityKey);
  assert.equal(issued.capabilityCount, 2);

  const binding = await helper.bindCapabilityKey({
    capabilityKey: issued.capabilityKey,
    credentialId: issued.credentialId,
    context: {
      namespace: "tool-management",
      userId: "user-a",
      agentId: "agent-a"
    },
    expiresAt: "9999-12-31T23:59:59.999Z"
  });
  assert.equal(binding.protocolVersion, "v0.0.1:risk-control:capability-binding-guard-1");
  assert.equal(binding.helperProtocolVersion, CAPABILITY_SECURITY_HELPER_PROTOCOL_VERSION);
  assert.equal(binding.bindingStrength, "user+agent");

  const allowed = await helper.verifyCapabilityAndBinding({
    capabilityKey: issued.capabilityKey,
    credentialId: issued.credentialId,
    requiredCapability: healthCapability,
    context: {
      namespace: "tool-management",
      userId: "user-a",
      agentId: "agent-a"
    }
  });
  assert.equal(allowed.ok, true);
  assert.equal(allowed.decision, "allow");
  assert.equal(JSON.stringify(allowed).includes(searchCapability), false, "helper must not list unrelated capabilities");
  assert.equal(JSON.stringify(allowed).includes("capabilitySetHash"), false);

  const wrongUser = await helper.verifyCapabilityAndBinding({
    capabilityKey: issued.capabilityKey,
    credentialId: issued.credentialId,
    requiredCapability: healthCapability,
    context: {
      namespace: "tool-management",
      userId: "user-b",
      agentId: "agent-a"
    }
  });
  assert.equal(wrongUser.ok, false);
  assert.equal(wrongUser.reasonCode, "binding_user_mismatch");

  const missingCapability = await helper.verifyCapabilityAndBinding({
    capabilityKey: issued.capabilityKey,
    credentialId: issued.credentialId,
    requiredCapability: toolExecuteCapabilityId("pact.agentLibrary.search"),
    context: {
      namespace: "tool-management",
      userId: "user-a",
      agentId: "agent-a"
    }
  });
  assert.equal(missingCapability.ok, false);
  assert.equal(missingCapability.reasonCode, "missing_capabilities");

  const unknownCapability = await helper.verifyCapabilityAndBinding({
    capabilityKey: issued.capabilityKey,
    credentialId: issued.credentialId,
    requiredCapability: apiCapabilityId("unknown.operation"),
    context: {
      namespace: "tool-management",
      userId: "user-a",
      agentId: "agent-a"
    }
  });
  assert.equal(unknownCapability.ok, false);
  assert.equal(unknownCapability.reasonCode, "unknown_capability");

  await assert.rejects(
    () => helper.issue({
      credentialId: "credential-helper-unknown",
      capabilities: [apiCapabilityId("unknown.operation")]
    }),
    /Unknown opaque capability permission/
  );

  const noBinding = await helper.issue({
    credentialId: "credential-helper-no-binding",
    capabilities: [searchCapability],
    expiresAt: "9999-12-31T23:59:59.999Z"
  });
  const requiredBinding = await helper.verifyCapabilityAndBinding({
    capabilityKey: noBinding.capabilityKey,
    credentialId: noBinding.credentialId,
    requiredCapability: searchCapability,
    context: { namespace: "tool-management" }
  });
  assert.equal(requiredBinding.ok, false);
  assert.equal(requiredBinding.reasonCode, "capability_binding_required");

  const optionalBinding = await helper.verifyCapabilityAndBinding({
    capabilityKey: noBinding.capabilityKey,
    credentialId: noBinding.credentialId,
    requiredCapability: searchCapability,
    requireBinding: false,
    context: { namespace: "tool-management" }
  });
  assert.equal(optionalBinding.ok, true);

  const kernelOnly = await helper.verify({
    capabilityKey: issued.capabilityKey,
    requiredCapability: searchCapability
  });
  assert.equal(kernelOnly.ok, true);
  assert.equal(JSON.stringify(kernelOnly).includes("metadata"), false);
  assert.equal(JSON.stringify(kernelOnly).includes("constraints"), false);
  assert.equal(JSON.stringify(kernelOnly).includes("capabilitySetHash"), false);
  assert.equal(JSON.stringify(kernelOnly).includes("capabilityCount"), false);
  assert.equal(JSON.stringify(kernelOnly).includes("keyHash"), false);
  assert.equal(JSON.stringify(kernelOnly).includes(healthCapability), false);

  const kernelStatePath = capabilityKernelStatePath({ dataDir, alias: kernelAlias });
  const bindingStatePath = capabilityBindingGuardStatePath({ dataDir, alias: bindingAlias });
  await assertNoPlaintext(kernelStatePath, [
    issued.capabilityKey,
    noBinding.capabilityKey,
    searchCapability,
    healthCapability,
    "runtimeLookupKeyBase64"
  ]);
  await assertNoPlaintext(bindingStatePath, [
    issued.capabilityKey,
    "user-a",
    "agent-a",
    "bindingLookupKeyBase64"
  ]);

  const description = await helper.describe();
  assert.equal(description.protocolVersion, CAPABILITY_SECURITY_HELPER_PROTOCOL_VERSION);
  assert.equal(description.capabilityKernel.securityMode, "degraded_file_fallback");
  assert.equal(description.capabilityBindingGuard.securityMode, "degraded_file_fallback");
  assert.equal(JSON.stringify(description).includes("runtimeLookupKeyBase64"), false);
  assert.equal(JSON.stringify(description).includes("bindingLookupKeyBase64"), false);

  const invalidated = await helper.invalidateCredential({
    credentialId: issued.credentialId,
    reason: "verify-helper-invalidate"
  });
  assert.equal(invalidated.capabilityInvalidated, 1);
  assert.equal(invalidated.bindingInvalidated, 1);
  const afterInvalidate = await helper.verifyCapabilityAndBinding({
    capabilityKey: issued.capabilityKey,
    credentialId: issued.credentialId,
    requiredCapability: healthCapability,
    context: {
      namespace: "tool-management",
      userId: "user-a",
      agentId: "agent-a"
    }
  });
  assert.equal(afterInvalidate.ok, false);
  assert.equal(afterInvalidate.reasonCode, "capability_key_invalid");

  const toolHelper = createCommandCapabilitySecurityClient({
    dataDir: toolDataDir,
    backend: "local-file",
    alias: "verify-tool-helper-kernel",
    bindingBackend: "local-file",
    bindingAlias: "verify-tool-helper-binding"
  });
  const toolStore = createToolManagementStore({
    userDataPath: toolDataDir,
    capabilityKeyProvider: toolHelper,
    capabilityBindingGuard: toolHelper
  });
  try {
    const grant = await toolStore.createGrant({
      label: "helper-backed-tool-grant",
      capabilities: [healthCapability],
      metadata: {
        agentId: "agent-a",
        boundUserId: "user-a"
      }
    });
    assert.equal(grant.grant.credential.protocolVersion, "v0.0.1:risk-control:opaque-capability-key-1");
    assert.equal(grant.grant.credential.bindingProtocol, "v0.0.1:risk-control:capability-binding-guard-1");
    assertOpaque(grant.token);

    const correct = await toolStore.authorizeRequest({
      request: { headers: { authorization: `Bearer ${grant.token}` } },
      tool: { id: "pact.agentLibrary.health" },
      context: {
        userId: "user-a",
        agentId: "agent-a"
      }
    });
    assert.equal(correct.ok, true);

    const wrongAgent = await toolStore.authorizeRequest({
      request: { headers: { authorization: `Bearer ${grant.token}` } },
      tool: { id: "pact.agentLibrary.health" },
      context: {
        userId: "user-a",
        agentId: "agent-b"
      }
    });
    assert.equal(wrongAgent.ok, false);
    assert.equal(wrongAgent.reasonCode, "binding_agent_mismatch");
  } finally {
    toolStore.close();
  }

  const originalHelperEnv = {
    PACT_TOOL_GRANT_CAPABILITY_SECURITY_HELPER: process.env.PACT_TOOL_GRANT_CAPABILITY_SECURITY_HELPER,
    PACT_TOOL_GRANT_CAPABILITY_KEY_PROVIDER: process.env.PACT_TOOL_GRANT_CAPABILITY_KEY_PROVIDER,
    PACT_TOOL_GRANT_BINDING_GUARD_PROVIDER: process.env.PACT_TOOL_GRANT_BINDING_GUARD_PROVIDER
  };
  process.env.PACT_TOOL_GRANT_CAPABILITY_SECURITY_HELPER = "1";
  process.env.PACT_TOOL_GRANT_CAPABILITY_KEY_PROVIDER = "local-file";
  process.env.PACT_TOOL_GRANT_BINDING_GUARD_PROVIDER = "local-file";
  const envToolStore = createToolManagementStore({ userDataPath: envToolDataDir });
  try {
    const grant = await envToolStore.createGrant({
      label: "env-helper-backed-tool-grant",
      capabilities: [healthCapability],
      metadata: {
        agentId: "agent-env",
        boundUserId: "user-env"
      }
    });
    assert.equal(grant.grant.credential.protocolVersion, "v0.0.1:risk-control:opaque-capability-key-1");
    assert.equal(grant.grant.credential.bindingProtocol, "v0.0.1:risk-control:capability-binding-guard-1");
    const authorized = await envToolStore.authorizeRequest({
      request: { headers: { authorization: `Bearer ${grant.token}` } },
      tool: { id: "pact.agentLibrary.health" },
      context: {
        userId: "user-env",
        agentId: "agent-env"
      }
    });
    assert.equal(authorized.ok, true);
  } finally {
    envToolStore.close();
    for (const [key, value] of Object.entries(originalHelperEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
} finally {
  helper.close();
  await fs.rm(dataDir, { recursive: true, force: true });
  await fs.rm(toolDataDir, { recursive: true, force: true });
  await fs.rm(envToolDataDir, { recursive: true, force: true });
}

console.log("capability security helper verifier passed");
