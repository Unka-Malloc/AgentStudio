import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { apiCapabilityId, toolExecuteCapabilityId } from "../../../server/platform/common/security/authorization/authorization-engine.mjs";
import {
  createMemoryCapabilityBindingGuard
} from "../../../server/platform/common/security/authorization/capability-binding-guard.mjs";
import {
  createCapabilityKey,
  createOpaqueCapabilityKeyProvider
} from "../../../server/platform/common/security/authorization/opaque-capability-key.mjs";

const tempRoots = [];

async function tempDir(prefix) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("authz capability final extra 7 coverage", () => {
  it("covers binding allow, deny, invalidation, expiry, and missing-key branches", async () => {
    const guard = createMemoryCapabilityBindingGuard({
      alias: "authz-final-extra-7-guard"
    });

    const allowKey = createCapabilityKey();
    await guard.bindCapabilityKey({
      capabilityKey: allowKey,
      credentialId: "guard-allow",
      context: {
        namespace: "tenant-a",
        userId: "user-a",
        agentId: "agent-a",
        clientId: "client-a"
      }
    });

    await expect(guard.verifyCapabilityKeyBinding({
      capabilityKey: allowKey,
      context: {
        namespace: "tenant-a",
        userId: "user-a",
        agentId: "agent-a",
        clientId: "client-a"
      }
    })).resolves.toMatchObject({
      ok: true,
      applicable: true,
      reasonCode: "capability_binding_valid",
      credentialId: "guard-allow",
      bindingStrength: "user+agent+client"
    });

    await expect(guard.verifyCapabilityKeyBinding({})).resolves.toMatchObject({
      ok: false,
      reasonCode: "capability_key_missing"
    });

    await expect(guard.verifyCapabilityKeyBinding({
      capabilityKey: createCapabilityKey()
    })).resolves.toMatchObject({
      ok: true,
      applicable: false,
      reasonCode: "capability_binding_not_registered"
    });

    await expect(guard.verifyCapabilityKeyBinding({
      capabilityKey: allowKey,
      context: {
        namespace: "tenant-b",
        userId: "user-a",
        agentId: "agent-a",
        clientId: "client-a"
      }
    })).resolves.toMatchObject({
      ok: false,
      applicable: true,
      reasonCode: "binding_namespace_mismatch",
      credentialId: "guard-allow"
    });

    await expect(guard.verifyCapabilityKeyBinding({
      capabilityKey: allowKey,
      context: {
        namespace: "tenant-a",
        agentId: "agent-a",
        clientId: "client-a"
      }
    })).resolves.toMatchObject({
      ok: false,
      applicable: true,
      reasonCode: "binding_user_missing",
      credentialId: "guard-allow"
    });

    await expect(guard.verifyCapabilityKeyBinding({
      capabilityKey: allowKey,
      context: {
        namespace: "tenant-a",
        userId: "user-a",
        agentId: "agent-b",
        clientId: "client-a"
      }
    })).resolves.toMatchObject({
      ok: false,
      applicable: true,
      reasonCode: "binding_agent_mismatch",
      credentialId: "guard-allow"
    });

    await expect(guard.verifyCapabilityKeyBinding({
      capabilityKey: allowKey,
      context: {
        namespace: "tenant-a",
        userId: "user-a",
        agentId: "agent-a",
        clientId: "client-b"
      }
    })).resolves.toMatchObject({
      ok: false,
      applicable: true,
      reasonCode: "binding_client_mismatch",
      credentialId: "guard-allow"
    });

    const expiredKey = createCapabilityKey();
    await guard.bindCapabilityKey({
      capabilityKey: expiredKey,
      credentialId: "guard-expired",
      expiresAt: "2000-01-01T00:00:00.000Z",
      context: {
        namespace: "tenant-a"
      }
    });
    await expect(guard.verifyCapabilityKeyBinding({
      capabilityKey: expiredKey,
      now: "2000-01-02T00:00:00.000Z",
      context: {
        namespace: "tenant-a"
      }
    })).resolves.toMatchObject({
      ok: false,
      applicable: true,
      reasonCode: "binding_expired",
      credentialId: "guard-expired"
    });

    const revokedKey = createCapabilityKey();
    await guard.bindCapabilityKey({
      capabilityKey: revokedKey,
      credentialId: "guard-revoked",
      context: {
        namespace: "tenant-a"
      }
    });
    const invalidated = await guard.invalidateCapabilityKeyBinding({
      credentialId: "guard-revoked",
      reason: "operator revoked"
    });
    expect(invalidated).toHaveLength(1);
    expect(invalidated[0]).toMatchObject({
      credentialId: "guard-revoked",
      status: "invalid",
      invalidationReason: "operator revoked"
    });
    await expect(guard.verifyCapabilityKeyBinding({
      capabilityKey: revokedKey,
      context: {
        namespace: "tenant-a"
      }
    })).resolves.toMatchObject({
      ok: false,
      applicable: true,
      reasonCode: "binding_invalid",
      credentialId: "guard-revoked"
    });

    expect(await guard.invalidateCapabilityKeyBinding({
      capabilityKey: createCapabilityKey(),
      reason: "no-match"
    })).toEqual([]);
    guard.close();
  });

  it("covers binding recovery export/import and sealed-package failures", async () => {
    const guard = createMemoryCapabilityBindingGuard({
      alias: "authz-final-extra-7-guard-recovery"
    });

    const capabilityKey = createCapabilityKey();
    await guard.bindCapabilityKey({
      capabilityKey,
      credentialId: "guard-recovery",
      context: {
        namespace: "tenant-recovery",
        userId: "user-recovery"
      }
    });

    await expect(guard.exportRecoveryPackage({})).rejects.toThrow(
      "Capability binding guard recovery export requires a passphrase."
    );

    const recoveryPackage = await guard.exportRecoveryPackage({
      passphrase: "correct horse battery staple",
      reason: "unit-test"
    });
    expect(recoveryPackage).toMatchObject({
      protocolVersion: "pact.capability-binding-guard-recovery.v1",
      alias: "authz-final-extra-7-guard-recovery"
    });

    const importedGuard = createMemoryCapabilityBindingGuard({
      alias: "authz-final-extra-7-guard-imported"
    });
    const imported = await importedGuard.importRecoveryPackage({
      recoveryPackage,
      passphrase: "correct horse battery staple"
    });
    expect(imported).toMatchObject({
      ok: true,
      protocolVersion: "pact.capability-binding-guard.v1"
    });
    await expect(importedGuard.verifyCapabilityKeyBinding({
      capabilityKey,
      context: {
        namespace: "tenant-recovery",
        userId: "user-recovery"
      }
    })).resolves.toMatchObject({
      ok: true,
      applicable: true,
      reasonCode: "capability_binding_valid",
      credentialId: "guard-recovery"
    });

    await expect(importedGuard.importRecoveryPackage({
      recoveryPackage: {
        ...recoveryPackage,
        protocolVersion: "pact.capability-binding-guard-recovery.v0"
      },
      passphrase: "correct horse battery staple"
    })).rejects.toThrow("Unsupported capability binding guard recovery package.");

    await expect(importedGuard.importRecoveryPackage({
      recoveryPackage: {
        ...recoveryPackage,
        sealedRecovery: {
          ...recoveryPackage.sealedRecovery,
          algorithm: "bogus"
        }
      },
      passphrase: "correct horse battery staple"
    })).rejects.toThrow("Unsupported capability binding guard sealed state payload.");

    await expect(importedGuard.importRecoveryPackage({
      recoveryPackage,
      passphrase: "wrong passphrase"
    })).rejects.toThrow();

    guard.close();
    importedGuard.close();
  });

  it("covers opaque capability allow, deny, expiry, rotation, and recovery failures", async () => {
    const dataDir = await tempDir("pact-authz-final-extra-7-opaque-");
    const provider = createOpaqueCapabilityKeyProvider({
      backend: "local-file",
      dataDir,
      alias: "authz final extra 7 opaque"
    });

    await expect(provider.issue({
      capabilityKey: "",
      credentialId: "opaque-empty",
      capabilities: []
    })).rejects.toThrow("Capability key binding requires at least one kernel capability.");

    await expect(provider.issue({
      capabilityKey: "opaque-invalid-capability",
      credentialId: "opaque-invalid",
      capabilities: ["cap:api:knowledge.search", "cap:api:not-a-real-capability"]
    })).rejects.toThrow("Unknown opaque capability permission: cap:api:not-a-real-capability");

    const exactKey = await provider.issue({
      capabilityKey: "opaque-exact-key",
      credentialId: "opaque-exact",
      capabilities: [apiCapabilityId("knowledge.search")],
      grantVersion: 2,
      metadata: { lane: "exact" },
      constraints: { workspaceId: "workspace-a" }
    });
    expect(exactKey).toMatchObject({
      protocolVersion: "pact.opaque-capability-key.v1",
      capabilityKey: "opaque-exact-key",
      credentialId: "opaque-exact"
    });

    const apiWildcardKey = await provider.issue({
      capabilityKey: "opaque-api-wildcard-key",
      credentialId: "opaque-api-wildcard",
      capabilities: ["cap:api:*"]
    });
    const toolWildcardKey = await provider.issue({
      capabilityKey: "opaque-tool-wildcard-key",
      credentialId: "opaque-tool-wildcard",
      capabilities: ["cap:tool:*"]
    });
    const globalWildcardKey = await provider.issue({
      capabilityKey: "opaque-global-wildcard-key",
      credentialId: "opaque-global-wildcard",
      capabilities: ["cap:*"]
    });

    await expect(provider.verify({
      capabilityKey: exactKey.capabilityKey,
      requiredCapability: apiCapabilityId("knowledge.search"),
      includeRecordDetails: true
    })).resolves.toMatchObject({
      ok: true,
      reasonCode: "capability_key_valid",
      credentialId: "opaque-exact",
      capabilityCount: 1,
      grantVersion: 2,
      constraints: { workspaceId: "workspace-a" },
      metadata: { lane: "exact" }
    });

    await expect(provider.verify({
      capabilityKey: apiWildcardKey.capabilityKey,
      requiredCapability: apiCapabilityId("knowledge.search")
    })).resolves.toMatchObject({
      ok: true,
      reasonCode: "capability_key_valid",
      credentialId: "opaque-api-wildcard"
    });

    await expect(provider.verify({
      capabilityKey: toolWildcardKey.capabilityKey,
      requiredCapability: toolExecuteCapabilityId("pact.knowledge.health")
    })).resolves.toMatchObject({
      ok: true,
      reasonCode: "capability_key_valid",
      credentialId: "opaque-tool-wildcard"
    });

    await expect(provider.verify({
      capabilityKey: globalWildcardKey.capabilityKey,
      requiredCapability: apiCapabilityId("knowledge.search")
    })).resolves.toMatchObject({
      ok: true,
      reasonCode: "capability_key_valid",
      credentialId: "opaque-global-wildcard"
    });

    await expect(provider.verify({
      capabilityKey: exactKey.capabilityKey
    })).resolves.toMatchObject({
      ok: false,
      reasonCode: "capability_required"
    });

    await expect(provider.verify({
      capabilityKey: exactKey.capabilityKey,
      requiredCapability: apiCapabilityId("unknown.operation")
    })).resolves.toMatchObject({
      ok: false,
      reasonCode: "unknown_capability",
      unknownCapabilities: [apiCapabilityId("unknown.operation")]
    });

    await expect(provider.verify({
      capabilityKey: exactKey.capabilityKey,
      requiredCapability: apiCapabilityId("knowledge.search"),
      minGrantVersion: 3
    })).resolves.toMatchObject({
      ok: false,
      reasonCode: "credential_grant_version_stale",
      credentialId: "opaque-exact"
    });

    const expiredKey = await provider.issue({
      capabilityKey: "opaque-expired-key",
      credentialId: "opaque-expired",
      capabilities: [apiCapabilityId("knowledge.search")],
      expiresAt: "2000-01-01T00:00:00.000Z"
    });
    await expect(provider.verify({
      capabilityKey: expiredKey.capabilityKey,
      requiredCapability: apiCapabilityId("knowledge.search"),
      now: "2000-01-02T00:00:00.000Z"
    })).resolves.toMatchObject({
      ok: false,
      reasonCode: "capability_key_expired",
      credentialId: "opaque-expired"
    });

    const invalidated = await provider.invalidate({
      capabilityKey: exactKey.capabilityKey,
      reason: "revoked"
    });
    expect(invalidated).toMatchObject({
      credentialId: "opaque-exact",
      status: "invalid",
      invalidationReason: "revoked"
    });

    await expect(provider.verify({
      capabilityKey: exactKey.capabilityKey,
      requiredCapability: apiCapabilityId("knowledge.search")
    })).resolves.toMatchObject({
      ok: false,
      reasonCode: "capability_key_invalid",
      credentialId: "opaque-exact"
    });

    expect(await provider.invalidate({})).toBeNull();
    expect(await provider.invalidateCredential({})).toEqual([]);

    const rotationKey = await provider.issue({
      capabilityKey: "opaque-rotation-key",
      credentialId: "opaque-rotation",
      capabilities: [apiCapabilityId("knowledge.search")]
    });
    await expect(provider.rotateCapabilityKey({
      capabilityKey: rotationKey.capabilityKey,
      capabilities: [],
      reason: "rotation without replacement"
    })).resolves.toMatchObject({
      ok: false,
      reasonCode: "capabilities_required_for_rotation"
    });

    await expect(provider.rotateCapabilityKey({
      capabilityKey: exactKey.capabilityKey,
      capabilities: [apiCapabilityId("knowledge.search")]
    })).resolves.toMatchObject({
      ok: false,
      reasonCode: "capability_key_invalid"
    });

    provider.close();
  });

  it("covers opaque recovery export/import and malformed package branches", async () => {
    const dataDir = await tempDir("pact-authz-final-extra-7-opaque-recovery-");
    const provider = createOpaqueCapabilityKeyProvider({
      backend: "local-file",
      dataDir,
      alias: "authz final extra 7 opaque recovery"
    });

    const capabilityKey = createCapabilityKey();
    await provider.issue({
      capabilityKey,
      credentialId: "opaque-recovery",
      capabilities: [apiCapabilityId("knowledge.search")]
    });

    await expect(provider.exportRecoveryPackage({})).rejects.toThrow(
      "Capability kernel recovery export requires a passphrase."
    );

    const recoveryPackage = await provider.exportRecoveryPackage({
      passphrase: "correct horse battery staple",
      reason: "unit-test"
    });
    expect(recoveryPackage).toMatchObject({
      protocolVersion: "pact.capability-kernel-recovery.v1",
      alias: "authz_final_extra_7_opaque_recovery"
    });

    const restoredProvider = createOpaqueCapabilityKeyProvider({
      backend: "local-file",
      dataDir,
      alias: "authz final extra 7 opaque restored"
    });
    const restored = await restoredProvider.importRecoveryPackage({
      recoveryPackage,
      passphrase: "correct horse battery staple"
    });
    expect(restored).toMatchObject({
      ok: true,
      protocolVersion: "pact.opaque-capability-key.v1"
    });
    await expect(restoredProvider.verify({
      capabilityKey,
      requiredCapability: apiCapabilityId("knowledge.search")
    })).resolves.toMatchObject({
      ok: true,
      reasonCode: "capability_key_valid",
      credentialId: "opaque-recovery"
    });

    await expect(restoredProvider.importRecoveryPackage({
      recoveryPackage: {
        ...recoveryPackage,
        protocolVersion: "pact.capability-kernel-recovery.v0"
      },
      passphrase: "correct horse battery staple"
    })).rejects.toThrow("Unsupported capability kernel recovery package.");

    await expect(restoredProvider.importRecoveryPackage({
      recoveryPackage: {
        ...recoveryPackage,
        sealedRecovery: {
          ...recoveryPackage.sealedRecovery,
          algorithm: "bogus"
        }
      },
      passphrase: "correct horse battery staple"
    })).rejects.toThrow("Unsupported capability kernel sealed state payload.");

    await expect(restoredProvider.importRecoveryPackage({
      recoveryPackage,
      passphrase: "wrong passphrase"
    })).rejects.toThrow();

    provider.close();
    restoredProvider.close();
  });
});
