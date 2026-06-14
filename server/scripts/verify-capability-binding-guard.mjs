import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { toolExecuteCapabilityId } from "../platform/common/security/authorization/authorization-engine.mjs";
import {
  capabilityBindingGuardStatePath,
  createCapabilityBindingGuard,
  createMemoryCapabilityBindingGuard
} from "../platform/common/security/authorization/capability-binding-guard.mjs";
import { createMemoryOpaqueCapabilityKeyProvider } from "../platform/common/security/authorization/opaque-capability-key.mjs";
import { createToolManagementStore } from "../platform/specialized/capabilities/tools/tool-management-core/store.mjs";

const execFileAsync = promisify(execFile);
const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "pact-capability-binding-guard-"));
const recoveryDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "pact-capability-binding-guard-recovery-"));
const cliRecoveryDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "pact-capability-binding-guard-cli-recovery-"));
const capabilityKey = `ock_${crypto.randomBytes(32).toString("base64url")}`;
const guard = createCapabilityBindingGuard({
  backend: "local-file",
  dataDir,
  alias: "verify-binding"
});

try {
  const binding = await guard.bindCapabilityKey({
    capabilityKey,
    credentialId: "credential-a",
    context: {
      namespace: "tool-management",
      userId: "user-a",
      agentId: "agent-a"
    },
    expiresAt: "9999-12-31T23:59:59.999Z"
  });
  assert.equal(binding.bindingStrength, "user+agent");
  assert.equal(binding.requireUser, true);
  assert.equal(binding.requireAgent, true);

  const allowed = await guard.verifyCapabilityKeyBinding({
    capabilityKey,
    credentialId: "credential-a",
    context: {
      namespace: "tool-management",
      userId: "user-a",
      agentId: "agent-a"
    }
  });
  assert.equal(allowed.ok, true);
  assert.equal(allowed.applicable, true);

  const wrongUser = await guard.verifyCapabilityKeyBinding({
    capabilityKey,
    credentialId: "credential-a",
    context: {
      namespace: "tool-management",
      userId: "user-b",
      agentId: "agent-a"
    }
  });
  assert.equal(wrongUser.ok, false);
  assert.equal(wrongUser.reasonCode, "binding_user_mismatch");

  const wrongAgent = await guard.verifyCapabilityKeyBinding({
    capabilityKey,
    credentialId: "credential-a",
    context: {
      namespace: "tool-management",
      userId: "user-a",
      agentId: "agent-b"
    }
  });
  assert.equal(wrongAgent.ok, false);
  assert.equal(wrongAgent.reasonCode, "binding_agent_mismatch");

  const missingUser = await guard.verifyCapabilityKeyBinding({
    capabilityKey,
    credentialId: "credential-a",
    context: {
      namespace: "tool-management",
      agentId: "agent-a"
    }
  });
  assert.equal(missingUser.ok, false);
  assert.equal(missingUser.reasonCode, "binding_user_missing");

  const wrongNamespace = await guard.verifyCapabilityKeyBinding({
    capabilityKey,
    credentialId: "credential-a",
    context: {
      namespace: "other-namespace",
      userId: "user-a",
      agentId: "agent-a"
    }
  });
  assert.equal(wrongNamespace.ok, false);
  assert.equal(wrongNamespace.reasonCode, "binding_namespace_mismatch");

  const unregistered = await guard.verifyCapabilityKeyBinding({
    capabilityKey: `ock_${crypto.randomBytes(32).toString("base64url")}`,
    credentialId: "legacy-credential",
    context: {
      namespace: "tool-management"
    }
  });
  assert.equal(unregistered.ok, true);
  assert.equal(unregistered.applicable, false);
  assert.equal(unregistered.reasonCode, "capability_binding_not_registered");

  const statePath = capabilityBindingGuardStatePath({ dataDir, alias: "verify-binding" });
  const stateStat = await fs.stat(statePath);
  assert.equal(stateStat.mode & 0o077, 0, "binding guard state must not be group/world-readable");
  const stateBytes = await fs.readFile(statePath, "utf8");
  assert.equal(stateBytes.includes("sealingKeyBase64"), false, "binding guard state file must not embed its sealing key");
  assert.equal(stateBytes.includes(capabilityKey), false, "binding guard state must not contain plaintext capability keys");
  assert.equal(stateBytes.includes("user-a"), false, "binding guard state must not contain plaintext user ids");
  assert.equal(stateBytes.includes("agent-a"), false, "binding guard state must not contain plaintext agent ids");
  assert.equal(stateBytes.includes("bindingLookupKeyBase64"), false, "binding guard file must not expose lookup key plaintext");
  const sealingKeyPath = path.join(path.dirname(statePath), "verify-binding.sealing-key");
  const sealingKeyStat = await fs.stat(sealingKeyPath);
  assert.equal(sealingKeyStat.mode & 0o077, 0, "binding guard sealing key sidecar must not be group/world-readable");
  const stateDirEntries = await fs.readdir(path.dirname(statePath));
  assert.equal(
    stateDirEntries.some((entry) => entry.endsWith(".tmp")),
    false,
    "binding guard atomic writes must not leave temp files after successful save"
  );

  const description = await guard.describe();
  assert.equal(description.bindingCount, 1);
  assert.equal(description.activeBindingCount, 1);
  assert.equal(JSON.stringify(description).includes("bindingLookupKeyBase64"), false);

  const concurrentGuard = createCapabilityBindingGuard({
    backend: "local-file",
    dataDir,
    alias: "verify-binding-concurrent"
  });
  try {
    const concurrentKeys = Array.from({ length: 8 }, () => `ock_${crypto.randomBytes(32).toString("base64url")}`);
    await Promise.all(concurrentKeys.map((item, index) => (
      concurrentGuard.bindCapabilityKey({
        capabilityKey: item,
        credentialId: `concurrent-credential-${index}`,
        context: {
          namespace: "tool-management",
          userId: `user-${index}`,
          agentId: "agent-concurrent"
        },
        expiresAt: "9999-12-31T23:59:59.999Z"
      })
    )));
    const concurrentDescription = await concurrentGuard.describe();
    assert.equal(concurrentDescription.bindingCount, concurrentKeys.length);
    assert.equal(concurrentDescription.activeBindingCount, concurrentKeys.length);
    for (const [index, item] of concurrentKeys.entries()) {
      const decision = await concurrentGuard.verifyCapabilityKeyBinding({
        capabilityKey: item,
        credentialId: `concurrent-credential-${index}`,
        context: {
          namespace: "tool-management",
          userId: `user-${index}`,
          agentId: "agent-concurrent"
        }
      });
      assert.equal(decision.ok, true);
    }
  } finally {
    concurrentGuard.close();
  }

  const crossProcessScript = `
import { createCapabilityBindingGuard } from "./server/platform/common/security/authorization/capability-binding-guard.mjs";
const guard = createCapabilityBindingGuard({
  backend: "local-file",
  dataDir: process.env.PACT_VERIFY_DATA_DIR,
  alias: process.env.PACT_VERIFY_ALIAS
});
try {
  await guard.bindCapabilityKey({
    capabilityKey: process.env.PACT_VERIFY_CAPABILITY_KEY,
    credentialId: process.env.PACT_VERIFY_CREDENTIAL_ID,
    context: {
      namespace: "tool-management",
      userId: process.env.PACT_VERIFY_USER_ID,
      agentId: "agent-cross-process"
    },
    expiresAt: "9999-12-31T23:59:59.999Z"
  });
  console.log(JSON.stringify({ ok: true, credentialId: process.env.PACT_VERIFY_CREDENTIAL_ID }));
} finally {
  guard.close();
}
`;
  const crossProcessKeys = Array.from({ length: 6 }, () => `ock_${crypto.randomBytes(32).toString("base64url")}`);
  await Promise.all(crossProcessKeys.map((item, index) => (
    execFileAsync(process.execPath, ["--input-type=module", "-e", crossProcessScript], {
      env: {
        ...process.env,
        PACT_VERIFY_DATA_DIR: dataDir,
        PACT_VERIFY_ALIAS: "verify-binding-cross-process",
        PACT_VERIFY_CAPABILITY_KEY: item,
        PACT_VERIFY_CREDENTIAL_ID: `cross-process-credential-${index}`,
        PACT_VERIFY_USER_ID: `cross-process-user-${index}`
      }
    })
  )));
  const crossProcessGuard = createCapabilityBindingGuard({
    backend: "local-file",
    dataDir,
    alias: "verify-binding-cross-process"
  });
  try {
    const crossProcessDescription = await crossProcessGuard.describe();
    assert.equal(crossProcessDescription.bindingCount, crossProcessKeys.length);
    assert.equal(crossProcessDescription.activeBindingCount, crossProcessKeys.length);
    for (const [index, item] of crossProcessKeys.entries()) {
      const decision = await crossProcessGuard.verifyCapabilityKeyBinding({
        capabilityKey: item,
        credentialId: `cross-process-credential-${index}`,
        context: {
          namespace: "tool-management",
          userId: `cross-process-user-${index}`,
          agentId: "agent-cross-process"
        }
      });
      assert.equal(decision.ok, true);
    }
  } finally {
    crossProcessGuard.close();
  }

  const recoveryPackage = await guard.exportRecoveryPackage({
    passphrase: "verify binding recovery passphrase",
    reason: "verify-binding-recovery"
  });
  assert.equal(recoveryPackage.protocolVersion, "v0.0.1:risk-control:capability-binding-guard-recovery-1");
  assert.equal(JSON.stringify(recoveryPackage).includes("bindingLookupKeyBase64"), false);
  assert.equal(JSON.stringify(recoveryPackage).includes(capabilityKey), false);
  assert.equal(JSON.stringify(recoveryPackage).includes("user-a"), false);
  assert.equal(JSON.stringify(recoveryPackage).includes("agent-a"), false);

  const recoveredGuard = createCapabilityBindingGuard({
    backend: "local-file",
    dataDir: recoveryDataDir,
    alias: "verify-binding-recovered"
  });
  try {
    const imported = await recoveredGuard.importRecoveryPackage({
      recoveryPackage,
      passphrase: "verify binding recovery passphrase"
    });
    assert.equal(imported.ok, true);
    assert.equal(imported.securityMode, "degraded_file_fallback");
    const recoveredAllowed = await recoveredGuard.verifyCapabilityKeyBinding({
      capabilityKey,
      credentialId: "credential-a",
      context: {
        namespace: "tool-management",
        userId: "user-a",
        agentId: "agent-a"
      }
    });
    assert.equal(recoveredAllowed.ok, true, "binding guard recovery must preserve valid bindings");
    const recoveredWrongUser = await recoveredGuard.verifyCapabilityKeyBinding({
      capabilityKey,
      credentialId: "credential-a",
      context: {
        namespace: "tool-management",
        userId: "user-b",
        agentId: "agent-a"
      }
    });
    assert.equal(recoveredWrongUser.ok, false);
    assert.equal(recoveredWrongUser.reasonCode, "binding_user_mismatch");
  } finally {
    recoveredGuard.close();
  }

  const cliRecoveryPath = path.join(dataDir, "verify-binding-security-recovery.json");
  const recoveryEnv = {
    ...process.env,
    PACT_VERIFY_BINDING_RECOVERY_PASSPHRASE: "verify binding recovery passphrase"
  };
  const cliExport = await execFileAsync(process.execPath, [
    path.resolve("server/scripts/pact.mjs"),
    "security",
    "recovery",
    "export",
    "--data-dir",
    dataDir,
    "--backend",
    "local-file",
    "--alias",
    "verify-empty-kernel",
    "--binding-backend",
    "local-file",
    "--binding-alias",
    "verify-binding",
    "--output",
    cliRecoveryPath,
    "--passphrase-env",
    "PACT_VERIFY_BINDING_RECOVERY_PASSPHRASE",
    "--reason",
    "verify-binding-cli-recovery"
  ], { env: recoveryEnv });
  const cliExportPayload = JSON.parse(cliExport.stdout);
  assert.equal(cliExportPayload.ok, true);
  assert.equal(cliExportPayload.protocolVersion, "v0.0.1:risk-control:recovery-1");
  assert.equal(cliExportPayload.components.capabilityBindingGuard.protocolVersion, "v0.0.1:risk-control:capability-binding-guard-recovery-1");
  const cliRecoveryStat = await fs.stat(cliRecoveryPath);
  assert.equal(cliRecoveryStat.mode & 0o077, 0, "security recovery package file must not be group/world-readable");
  const cliRecoveryBytes = await fs.readFile(cliRecoveryPath, "utf8");
  assert.equal(cliRecoveryBytes.includes("bindingLookupKeyBase64"), false);
  assert.equal(cliRecoveryBytes.includes(capabilityKey), false);
  assert.equal(cliRecoveryBytes.includes("user-a"), false);
  assert.equal(cliRecoveryBytes.includes("agent-a"), false);

  const cliImport = await execFileAsync(process.execPath, [
    path.resolve("server/scripts/pact.mjs"),
    "security",
    "recovery",
    "import",
    "--data-dir",
    cliRecoveryDataDir,
    "--backend",
    "local-file",
    "--alias",
    "verify-cli-kernel",
    "--binding-backend",
    "local-file",
    "--binding-alias",
    "verify-cli-binding",
    "--input",
    cliRecoveryPath,
    "--passphrase-env",
    "PACT_VERIFY_BINDING_RECOVERY_PASSPHRASE"
  ], { env: recoveryEnv });
  const cliImportPayload = JSON.parse(cliImport.stdout);
  assert.equal(cliImportPayload.ok, true);
  assert.equal(cliImportPayload.components.capabilityBindingGuard.securityMode, "degraded_file_fallback");
  const cliRecoveredGuard = createCapabilityBindingGuard({
    backend: "local-file",
    dataDir: cliRecoveryDataDir,
    alias: "verify-cli-binding"
  });
  try {
    const cliRecoveredAllowed = await cliRecoveredGuard.verifyCapabilityKeyBinding({
      capabilityKey,
      credentialId: "credential-a",
      context: {
        namespace: "tool-management",
        userId: "user-a",
        agentId: "agent-a"
      }
    });
    assert.equal(cliRecoveredAllowed.ok, true, "CLI security recovery import must preserve binding guard state");
  } finally {
    cliRecoveredGuard.close();
  }

  const invalidated = await guard.invalidateCapabilityKeyBinding({
    credentialId: "credential-a",
    reason: "verify-invalidate"
  });
  assert.equal(invalidated.length, 1);
  const afterInvalidate = await guard.verifyCapabilityKeyBinding({
    capabilityKey,
    credentialId: "credential-a",
    context: {
      namespace: "tool-management",
      userId: "user-a",
      agentId: "agent-a"
    }
  });
  assert.equal(afterInvalidate.ok, false);
  assert.equal(afterInvalidate.reasonCode, "binding_invalid");

  const toolDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "pact-binding-guard-tool-store-"));
  const toolStore = createToolManagementStore({
    userDataPath: toolDataDir,
    capabilityKeyProvider: createMemoryOpaqueCapabilityKeyProvider(),
    capabilityBindingGuard: createMemoryCapabilityBindingGuard()
  });
  try {
    const grant = await toolStore.createGrant({
      label: "bound-tool-grant",
      capabilities: [toolExecuteCapabilityId("pact.agentLibrary.health")],
      metadata: {
        agentId: "agent-a",
        boundUserId: "user-a"
      }
    });
    assert.equal(grant.grant.credential.bindingProtocol, "v0.0.1:risk-control:capability-binding-guard-1");
    assert.equal(grant.grant.credential.bindingStrength, "user+agent");

    const healthTool = { id: "pact.agentLibrary.health" };
    const correctBinding = await toolStore.authorizeRequest({
      request: { headers: { authorization: `Bearer ${grant.token}` } },
      tool: healthTool,
      context: {
        agentId: "agent-a",
        userId: "user-a"
      }
    });
    assert.equal(correctBinding.ok, true);

    const wrongUserBinding = await toolStore.authorizeRequest({
      request: { headers: { authorization: `Bearer ${grant.token}` } },
      tool: healthTool,
      context: {
        agentId: "agent-a",
        userId: "user-b"
      }
    });
    assert.equal(wrongUserBinding.ok, false);
    assert.equal(wrongUserBinding.reasonCode, "binding_user_mismatch");

    toolStore.updateGrant(grant.grant.id, {
      metadata: {
        agentId: "agent-b",
        boundUserId: "user-b"
      },
      capabilities: [toolExecuteCapabilityId("pact.agentLibrary.search")]
    });
    const projectionTamperStillDenied = await toolStore.authorizeRequest({
      request: { headers: { authorization: `Bearer ${grant.token}` } },
      tool: healthTool,
      context: {
        agentId: "agent-b",
        userId: "user-b"
      }
    });
    assert.equal(projectionTamperStillDenied.ok, false);
    assert.equal(projectionTamperStillDenied.reasonCode, "binding_user_mismatch");
  } finally {
    toolStore.close();
    await fs.rm(toolDataDir, { recursive: true, force: true });
  }
} finally {
  guard.close();
  await fs.rm(dataDir, { recursive: true, force: true });
  await fs.rm(recoveryDataDir, { recursive: true, force: true });
  await fs.rm(cliRecoveryDataDir, { recursive: true, force: true });
}

console.log("capability binding guard verifier passed");
