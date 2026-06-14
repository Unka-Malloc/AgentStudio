import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  apiCapabilityId,
  toolExecuteCapabilityId
} from "../platform/common/security/authorization/authorization-engine.mjs";
import {
  capabilityKernelStatePath,
  createCommandOpaqueCapabilityKeyProvider,
  createMemoryOpaqueCapabilityKeyProvider
} from "../platform/common/security/authorization/opaque-capability-key.mjs";

const execFileAsync = promisify(execFile);

function assertOpaque(key) {
  assert.equal(key.includes("."), false, "capability key must be a single opaque string");
  assert.equal(key.includes(apiCapabilityId("knowledge.search")), false);
  assert.equal(key.includes(toolExecuteCapabilityId("pact.agentLibrary.health")), false);
  assert.match(key, /^ock_[A-Za-z0-9_-]+$/);
}

const memoryProvider = createMemoryOpaqueCapabilityKeyProvider({ alias: "verify-memory" });
const memoryIssued = await memoryProvider.issue({
  credentialId: "verify-memory-opaque",
  capabilities: [apiCapabilityId("knowledge.search"), toolExecuteCapabilityId("pact.agentLibrary.health")],
  ttlMs: 60_000
});
assertOpaque(memoryIssued.capabilityKey);

await assert.rejects(
  () => memoryProvider.issue({
    credentialId: "verify-memory-unknown-capability",
    capabilities: [apiCapabilityId("unknown.operation")]
  }),
  /Unknown opaque capability permission/
);

const afterIssueDescribe = await memoryProvider.describe();
assert.equal(afterIssueDescribe.runtimeLookupLoadCount, 1);
assert.equal(afterIssueDescribe.bindingCount, 1);

const memoryAllowed = await memoryProvider.verify({
  capabilityKey: memoryIssued.capabilityKey,
  requiredCapability: apiCapabilityId("knowledge.search")
});
assert.equal(memoryAllowed.ok, true);
assert.equal(memoryAllowed.credentialId, "verify-memory-opaque");
assert.equal(JSON.stringify(memoryAllowed).includes("capabilitySetHash"), false);
assert.equal(JSON.stringify(memoryAllowed).includes("constraints"), false);
assert.equal(JSON.stringify(memoryAllowed).includes("metadata"), false);
assert.equal(JSON.stringify(memoryAllowed).includes("keyHash"), false);

const memoryAllowedWithDetails = await memoryProvider.verify({
  capabilityKey: memoryIssued.capabilityKey,
  requiredCapability: apiCapabilityId("knowledge.search"),
  includeRecordDetails: true
});
assert.equal(memoryAllowedWithDetails.ok, true);
assert.equal(Boolean(memoryAllowedWithDetails.capabilitySetHash), true);
assert.equal(memoryAllowedWithDetails.capabilityCount, 2);

const afterVerifyDescribe = await memoryProvider.describe();
assert.equal(afterVerifyDescribe.runtimeLookupLoadCount, 1, "runtime lookup key must stay cached after issue");

const memoryDenied = await memoryProvider.verify({
  capabilityKey: memoryIssued.capabilityKey,
  requiredCapability: apiCapabilityId("knowledge.evidence.get")
});
assert.equal(memoryDenied.ok, false);
assert.equal(memoryDenied.reasonCode, "missing_capabilities");
assert.deepEqual(memoryDenied.missingCapabilities, [apiCapabilityId("knowledge.evidence.get")]);

const unknownRequired = await memoryProvider.verify({
  capabilityKey: memoryIssued.capabilityKey,
  requiredCapability: apiCapabilityId("unknown.operation")
});
assert.equal(unknownRequired.ok, false);
assert.equal(unknownRequired.reasonCode, "unknown_capability");
assert.deepEqual(unknownRequired.unknownCapabilities, [apiCapabilityId("unknown.operation")]);

const tampered = await memoryProvider.verify({
  capabilityKey: `${memoryIssued.capabilityKey}x`,
  requiredCapability: apiCapabilityId("knowledge.search")
});
assert.equal(tampered.ok, false);
assert.equal(tampered.reasonCode, "capability_key_unknown");

const rotated = await memoryProvider.rotateCapabilityKey({
  capabilityKey: memoryIssued.capabilityKey,
  capabilities: [apiCapabilityId("knowledge.search"), toolExecuteCapabilityId("pact.agentLibrary.health")]
});
assert.equal(rotated.ok, true);
assertOpaque(rotated.capabilityKey);

const oldAfterRotate = await memoryProvider.verify({
  capabilityKey: memoryIssued.capabilityKey,
  requiredCapability: apiCapabilityId("knowledge.search")
});
assert.equal(oldAfterRotate.ok, false);
assert.equal(oldAfterRotate.reasonCode, "capability_key_invalid");

const newAfterRotate = await memoryProvider.verify({
  capabilityKey: rotated.capabilityKey,
  requiredCapability: apiCapabilityId("knowledge.search")
});
assert.equal(newAfterRotate.ok, true);
assert.equal(newAfterRotate.credentialId, "verify-memory-opaque");

const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "pact-opaque-capability-key-"));
const recoveryDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "pact-opaque-capability-key-recovery-"));
const cliRecoveryDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "pact-opaque-capability-key-cli-recovery-"));
const commandProvider = createCommandOpaqueCapabilityKeyProvider({
  alias: "verify-command",
  backend: "local-file",
  dataDir
});
try {
  const commandIssued = await commandProvider.issue({
    credentialId: "verify-command-opaque",
    capabilities: [apiCapabilityId("knowledge.search")]
  });
  assertOpaque(commandIssued.capabilityKey);

  const commandDescribe = await commandProvider.describe();
  assert.equal(commandDescribe.runtimeLookupLoadCount, 1);
  assert.equal(commandDescribe.bindingCount, 1);
  assert.equal(JSON.stringify(commandDescribe).includes("runtimeLookupKeyBase64"), false);
  assert.equal(JSON.stringify(commandDescribe).includes("knowledge.search"), false);

  const commandAllowed = await commandProvider.verify({
    capabilityKey: commandIssued.capabilityKey,
    requiredCapability: apiCapabilityId("knowledge.search")
  });
  assert.equal(commandAllowed.ok, true);

  const commandAfterVerify = await commandProvider.describe();
  assert.equal(commandAfterVerify.runtimeLookupLoadCount, 1, "command helper must not be called on every verify");
  assert.equal(commandAfterVerify.keySource.provider, "local-file");
  assert.ok(commandAfterVerify.keySource.loadCount <= 2, "local sealed state should only reload for mutation-safe refresh, not every verify");
  assert.equal(commandAfterVerify.keySource.runtimeLookupKeyRotationSupported, false);
  await assert.rejects(
    () => commandProvider.store.keySource.rotateRuntimeLookupKey(),
    /only allowed before capability bindings exist/
  );
  const commandStillAllowedAfterRejectedLookupRotation = await commandProvider.verify({
    capabilityKey: commandIssued.capabilityKey,
    requiredCapability: apiCapabilityId("knowledge.search")
  });
  assert.equal(commandStillAllowedAfterRejectedLookupRotation.ok, true);

  const concurrentProvider = createCommandOpaqueCapabilityKeyProvider({
    alias: "verify-concurrent",
    backend: "local-file",
    dataDir
  });
  try {
    const concurrentIssued = await Promise.all(Array.from({ length: 8 }, (_, index) => (
      concurrentProvider.issue({
        credentialId: `verify-concurrent-${index}`,
        capabilities: [apiCapabilityId("knowledge.search")]
      })
    )));
    const concurrentDescribe = await concurrentProvider.describe();
    assert.equal(concurrentDescribe.bindingCount, concurrentIssued.length);
    assert.equal(concurrentDescribe.permissionBindingCount, concurrentIssued.length);
    for (const issued of concurrentIssued) {
      const decision = await concurrentProvider.verify({
        capabilityKey: issued.capabilityKey,
        requiredCapability: apiCapabilityId("knowledge.search")
      });
      assert.equal(decision.ok, true);
    }
  } finally {
    concurrentProvider.close();
  }

  const crossProcessScript = `
import { apiCapabilityId } from "./server/platform/common/security/authorization/authorization-engine.mjs";
import { createCommandOpaqueCapabilityKeyProvider } from "./server/platform/common/security/authorization/opaque-capability-key.mjs";
const provider = createCommandOpaqueCapabilityKeyProvider({
  alias: process.env.PACT_VERIFY_ALIAS,
  backend: "local-file",
  dataDir: process.env.PACT_VERIFY_DATA_DIR
});
try {
  const issued = await provider.issue({
    credentialId: process.env.PACT_VERIFY_CREDENTIAL_ID,
    capabilities: [apiCapabilityId("knowledge.search")]
  });
  console.log(JSON.stringify({ capabilityKey: issued.capabilityKey, credentialId: issued.credentialId }));
} finally {
  provider.close();
}
`;
  const crossProcessIssued = await Promise.all(Array.from({ length: 6 }, async (_, index) => {
    const result = await execFileAsync(process.execPath, ["--input-type=module", "-e", crossProcessScript], {
      env: {
        ...process.env,
        PACT_VERIFY_ALIAS: "verify-cross-process",
        PACT_VERIFY_DATA_DIR: dataDir,
        PACT_VERIFY_CREDENTIAL_ID: `verify-cross-process-${index}`
      }
    });
    return JSON.parse(result.stdout);
  }));
  const crossProcessProvider = createCommandOpaqueCapabilityKeyProvider({
    alias: "verify-cross-process",
    backend: "local-file",
    dataDir
  });
  try {
    const crossProcessDescribe = await crossProcessProvider.describe();
    assert.equal(crossProcessDescribe.bindingCount, crossProcessIssued.length);
    assert.equal(crossProcessDescribe.permissionBindingCount, crossProcessIssued.length);
    for (const issued of crossProcessIssued) {
      const decision = await crossProcessProvider.verify({
        capabilityKey: issued.capabilityKey,
        requiredCapability: apiCapabilityId("knowledge.search")
      });
      assert.equal(decision.ok, true);
    }
  } finally {
    crossProcessProvider.close();
  }

  const recoveryPackage = await commandProvider.exportRecoveryPackage({
    passphrase: "verify recovery package passphrase",
    reason: "verify-recovery"
  });
  assert.equal(recoveryPackage.protocolVersion, "v0.0.1:risk-control:capability-kernel-recovery-1");
  assert.equal(JSON.stringify(recoveryPackage).includes("runtimeLookupKeyBase64"), false);
  assert.equal(JSON.stringify(recoveryPackage).includes(apiCapabilityId("knowledge.search")), false);

  const recoveredProvider = createCommandOpaqueCapabilityKeyProvider({
    alias: "verify-recovered",
    backend: "local-file",
    dataDir: recoveryDataDir
  });
  try {
    const imported = await recoveredProvider.importRecoveryPackage({
      recoveryPackage,
      passphrase: "verify recovery package passphrase"
    });
    assert.equal(imported.ok, true);
    assert.equal(imported.provider, "local-file");
    assert.equal(imported.securityMode, "degraded_file_fallback");
    const recoveredAllowed = await recoveredProvider.verify({
      capabilityKey: commandIssued.capabilityKey,
      requiredCapability: apiCapabilityId("knowledge.search")
    });
    assert.equal(recoveredAllowed.ok, true, "recovery import must preserve capability key validity");
  } finally {
    recoveredProvider.close();
  }

  const statePath = capabilityKernelStatePath({ dataDir, alias: "verify-command" });
  const stateStat = await fs.stat(statePath);
  assert.equal(stateStat.mode & 0o077, 0, "capability kernel state must not be group/world-readable");

  const stateBytes = await fs.readFile(statePath);
  assert.equal(stateBytes.includes("sealingKeyBase64"), false, "local fallback state file must not embed its sealing key");
  assert.equal(stateBytes.includes(apiCapabilityId("knowledge.search")), false, "sealed state must not contain plaintext capabilities");
  assert.equal(stateBytes.includes(commandIssued.capabilityKey), false, "sealed state must not contain plaintext capability keys");
  const sealingKeyPath = path.join(path.dirname(statePath), "verify-command.sealing-key");
  const sealingKeyStat = await fs.stat(sealingKeyPath);
  assert.equal(sealingKeyStat.mode & 0o077, 0, "capability kernel sealing key sidecar must not be group/world-readable");
  const stateDirEntries = await fs.readdir(path.dirname(statePath));
  assert.equal(
    stateDirEntries.some((entry) => entry.endsWith(".tmp")),
    false,
    "capability kernel atomic writes must not leave temp files after successful save"
  );

  const cliStatus = await execFileAsync(process.execPath, [
    path.resolve("server/scripts/pact.mjs"),
    "security",
    "capability-kernel",
    "status",
    "--data-dir",
    dataDir,
    "--backend",
    "local-file",
    "--alias",
    "verify-command"
  ]);
  const cliStatusPayload = JSON.parse(cliStatus.stdout);
  assert.equal(cliStatusPayload.ok, true);
  assert.equal(cliStatusPayload.capabilityKernel.securityMode, "degraded_file_fallback");
  assert.equal(cliStatusPayload.capabilityKernel.degraded, true);
  assert.equal(cliStatusPayload.capabilityKernel.statePath, statePath);
  assert.equal(JSON.stringify(cliStatusPayload).includes("runtimeLookupKeyBase64"), false);

  const doctor = await execFileAsync(process.execPath, [
    path.resolve("server/scripts/doctor.mjs"),
    "--data-dir",
    dataDir,
    "--capability-backend",
    "local-file",
    "--capability-alias",
    "verify-command",
    "--binding-backend",
    "local-file",
    "--binding-alias",
    "verify-binding"
  ]);
  const doctorPayload = JSON.parse(doctor.stdout);
  assert.equal(doctorPayload.capabilityKernel.securityMode, "degraded_file_fallback");
  assert.equal(doctorPayload.capabilityKernel.degraded, true);
  assert.equal(doctorPayload.capabilityKernel.statePath, statePath);
  assert.equal(doctorPayload.capabilityBindingGuard.securityMode, "degraded_file_fallback");
  assert.equal(doctorPayload.capabilityBindingGuard.degraded, true);
  assert.equal(JSON.stringify(doctorPayload).includes("runtimeLookupKeyBase64"), false);

  const cliRecoveryPath = path.join(dataDir, "verify-recovery-package.json");
  const recoveryEnv = {
    ...process.env,
    PACT_VERIFY_RECOVERY_PASSPHRASE: "verify recovery package passphrase"
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
    "verify-command",
    "--output",
    cliRecoveryPath,
    "--passphrase-env",
    "PACT_VERIFY_RECOVERY_PASSPHRASE",
    "--reason",
    "verify-cli-recovery"
  ], { env: recoveryEnv });
  const cliExportPayload = JSON.parse(cliExport.stdout);
  assert.equal(cliExportPayload.ok, true);
  assert.equal(cliExportPayload.protocolVersion, "v0.0.1:risk-control:recovery-1");
  assert.equal(cliExportPayload.components.capabilityKernel.protocolVersion, "v0.0.1:risk-control:capability-kernel-recovery-1");
  assert.equal(cliExportPayload.components.capabilityBindingGuard.protocolVersion, "v0.0.1:risk-control:capability-binding-guard-recovery-1");
  assert.equal(cliExportPayload.outputPath, cliRecoveryPath);
  const cliRecoveryStat = await fs.stat(cliRecoveryPath);
  assert.equal(cliRecoveryStat.mode & 0o077, 0, "recovery package file must not be group/world-readable");
  const cliRecoveryPackageBytes = await fs.readFile(cliRecoveryPath, "utf8");
  assert.equal(cliRecoveryPackageBytes.includes("runtimeLookupKeyBase64"), false);
  assert.equal(cliRecoveryPackageBytes.includes("bindingLookupKeyBase64"), false);
  assert.equal(cliRecoveryPackageBytes.includes(apiCapabilityId("knowledge.search")), false);
  assert.equal(cliRecoveryPackageBytes.includes(commandIssued.capabilityKey), false);

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
    "verify-cli-recovered",
    "--input",
    cliRecoveryPath,
    "--passphrase-env",
    "PACT_VERIFY_RECOVERY_PASSPHRASE"
  ], { env: recoveryEnv });
  const cliImportPayload = JSON.parse(cliImport.stdout);
  assert.equal(cliImportPayload.ok, true);
  assert.equal(cliImportPayload.protocolVersion, "v0.0.1:risk-control:recovery-1");
  assert.equal(cliImportPayload.components.capabilityKernel.securityMode, "degraded_file_fallback");
  assert.equal(cliImportPayload.components.capabilityBindingGuard.securityMode, "degraded_file_fallback");

  const cliRecoveredProvider = createCommandOpaqueCapabilityKeyProvider({
    alias: "verify-cli-recovered",
    backend: "local-file",
    dataDir: cliRecoveryDataDir
  });
  try {
    const cliRecoveredAllowed = await cliRecoveredProvider.verify({
      capabilityKey: commandIssued.capabilityKey,
      requiredCapability: apiCapabilityId("knowledge.search")
    });
    assert.equal(cliRecoveredAllowed.ok, true, "CLI recovery import must preserve capability key validity");
  } finally {
    cliRecoveredProvider.close();
  }

  const commandInvalidated = await commandProvider.invalidate({
    capabilityKey: commandIssued.capabilityKey,
    reason: "verified-invalidation"
  });
  assert.equal(commandInvalidated.status, "invalid");
  assert.ok(["valid", "invalid"].includes(commandInvalidated.status));

  const commandDenied = await commandProvider.verify({
    capabilityKey: commandIssued.capabilityKey,
    requiredCapability: apiCapabilityId("knowledge.search")
  });
  assert.equal(commandDenied.ok, false);
  assert.equal(commandDenied.reasonCode, "capability_key_invalid");
} finally {
  commandProvider.close();
  await fs.rm(dataDir, { recursive: true, force: true });
  await fs.rm(recoveryDataDir, { recursive: true, force: true });
  await fs.rm(cliRecoveryDataDir, { recursive: true, force: true });
}

console.log("opaque capability key verifier passed");
