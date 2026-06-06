import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  apiCapabilityId
} from "../../../server/platform/common/security/authorization/authorization-engine.mjs";
import {
  capabilityBindingGuardStatePath,
  createCapabilityBindingGuard
} from "../../../server/platform/common/security/authorization/capability-binding-guard.mjs";
import {
  capabilityKernelStatePath,
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

describe("authorization key binding final fifth extra coverage", () => {
  it("loads local-file opaque keys lazily and enforces minGrantVersion before exposing details", async () => {
    const dataDir = await tempDir("pact-final-fifth-opaque-");
    const alias = "opaque final/fifth local-file";
    const provider = createOpaqueCapabilityKeyProvider({
      backend: "local-file",
      dataDir,
      alias
    });

    const initial = await provider.describe();
    expect(initial).toMatchObject({
      provider: "local-file",
      alias,
      runtimeLookupLoaded: false,
      runtimeLookupLoadCount: 0,
      bindingCount: 0,
      permissionBindingCount: 0
    });

    const staleKey = await provider.issue({
      capabilityKey: "opaque-final-fifth-stale-key",
      credentialId: "opaque-final-fifth-credential",
      capabilities: [apiCapabilityId("knowledge.search")],
      grantVersion: 1,
      metadata: { lane: "stale" },
      constraints: { workspaceId: "workspace-stale" }
    });
    expect(staleKey).toMatchObject({
      capabilityKey: "opaque-final-fifth-stale-key",
      credentialId: "opaque-final-fifth-credential"
    });

    const detailedKey = await provider.issue({
      capabilityKey: "opaque-final-fifth-detailed-key",
      credentialId: "opaque-final-fifth-credential",
      capabilities: [apiCapabilityId("knowledge.search")],
      grantVersion: 3,
      metadata: { lane: "detailed" },
      constraints: { workspaceId: "workspace-detailed" }
    });
    expect(detailedKey).toMatchObject({
      capabilityKey: "opaque-final-fifth-detailed-key",
      credentialId: "opaque-final-fifth-credential"
    });

    const statePath = capabilityKernelStatePath({ dataDir, alias });
    expect(statePath).toBe(path.join(
      dataDir,
      "security",
      "capability-kernel",
      "opaque_final_fifth_local-file.sealed.json"
    ));
    expect((await fs.stat(statePath)).isFile()).toBe(true);

    const afterIssue = await provider.describe();
    expect(afterIssue).toMatchObject({
      provider: "local-file",
      alias,
      runtimeLookupLoaded: true,
      runtimeLookupLoadCount: 1,
      bindingCount: 2,
      permissionBindingCount: 2
    });

    await expect(provider.verify({
      capabilityKey: "opaque-final-fifth-stale-key",
      requiredCapability: apiCapabilityId("knowledge.search"),
      minGrantVersion: 2
    })).resolves.toMatchObject({
      ok: false,
      reasonCode: "credential_grant_version_stale",
      credentialId: "opaque-final-fifth-credential"
    });

    await expect(provider.verify({
      capabilityKey: "opaque-final-fifth-detailed-key",
      requiredCapability: apiCapabilityId("knowledge.search"),
      minGrantVersion: 3,
      includeRecordDetails: true
    })).resolves.toMatchObject({
      ok: true,
      reasonCode: "capability_key_valid",
      credentialId: "opaque-final-fifth-credential",
      grantVersion: 3,
      capabilityCount: 1,
      constraints: { workspaceId: "workspace-detailed" },
      metadata: { lane: "detailed" }
    });

    provider.close();
  });

  it("invalidates opaque keys by key and credential and leaves repeat audits empty", async () => {
    const dataDir = await tempDir("pact-final-fifth-opaque-invalidate-");
    const alias = "opaque final/fifth invalidate";
    const provider = createOpaqueCapabilityKeyProvider({
      backend: "local-file",
      dataDir,
      alias
    });

    const first = await provider.issue({
      capabilityKey: "opaque-final-fifth-revoke-a",
      credentialId: "opaque-final-fifth-revoke-credential",
      capabilities: [apiCapabilityId("knowledge.search")]
    });
    const second = await provider.issue({
      capabilityKey: "opaque-final-fifth-revoke-b",
      credentialId: "opaque-final-fifth-revoke-credential",
      capabilities: [apiCapabilityId("knowledge.search")]
    });

    const invalidatedByKey = await provider.invalidate({
      capabilityKey: first.capabilityKey,
      reason: "operator revoked"
    });
    expect(invalidatedByKey).toMatchObject({
      credentialId: "opaque-final-fifth-revoke-credential",
      status: "invalid",
      invalidationReason: "operator revoked"
    });

    const invalidatedByCredential = await provider.invalidateCredential({
      credentialId: "opaque-final-fifth-revoke-credential",
      reason: "bulk revoke"
    });
    expect(invalidatedByCredential).toHaveLength(1);
    expect(invalidatedByCredential[0]).toMatchObject({
      credentialId: "opaque-final-fifth-revoke-credential",
      status: "invalid",
      invalidationReason: "bulk revoke"
    });

    await expect(provider.invalidateCredential({
      credentialId: "opaque-final-fifth-revoke-credential",
      reason: "repeat revoke"
    })).resolves.toEqual([]);

    await expect(provider.verify({
      capabilityKey: first.capabilityKey,
      requiredCapability: apiCapabilityId("knowledge.search")
    })).resolves.toMatchObject({
      ok: false,
      reasonCode: "capability_key_invalid",
      credentialId: "opaque-final-fifth-revoke-credential"
    });

    expect(await provider.invalidate({})).toBeNull();
    expect(await provider.invalidateCredential({})).toEqual([]);

    const finalDescription = await provider.describe();
    expect(finalDescription).toMatchObject({
      bindingCount: 2,
      permissionBindingCount: 2,
      runtimeLookupLoaded: true
    });

    provider.close();
  });

  it("rejects rotations without replacement capabilities and on invalid keys", async () => {
    const provider = createOpaqueCapabilityKeyProvider({
      backend: "memory",
      alias: "opaque-final-fifth-rotate"
    });

    const issued = await provider.issue({
      capabilityKey: "opaque-final-fifth-rotate-key",
      credentialId: "opaque-final-fifth-rotate-credential",
      capabilities: [apiCapabilityId("knowledge.search")]
    });

    await expect(provider.rotateCapabilityKey({
      capabilityKey: issued.capabilityKey,
      reason: "rotate without replacement"
    })).resolves.toMatchObject({
      ok: false,
      reasonCode: "capabilities_required_for_rotation"
    });

    const invalidated = await provider.invalidate({
      capabilityKey: issued.capabilityKey,
      reason: "revoked before rotate"
    });
    expect(invalidated).toMatchObject({
      status: "invalid",
      invalidationReason: "revoked before rotate"
    });

    await expect(provider.rotateCapabilityKey({
      capabilityKey: issued.capabilityKey,
      capabilities: [apiCapabilityId("knowledge.search")],
      reason: "rotate invalid"
    })).resolves.toMatchObject({
      ok: false,
      reasonCode: "capability_key_invalid"
    });

    provider.close();
  });

  it("reports local-file guard state paths and denies missing users and unknown keys", async () => {
    const dataDir = await tempDir("pact-final-fifth-guard-");
    const alias = "guard final/fifth local-file";
    const guard = createCapabilityBindingGuard({
      backend: "local-file",
      dataDir,
      alias
    });
    const capabilityKey = createCapabilityKey();

    const bound = await guard.bindCapabilityKey({
      capabilityKey,
      credentialId: "guard-final-fifth-credential",
      context: {
        namespace: "tenant-final-fifth",
        userId: "guard-user"
      }
    });
    expect(bound).toMatchObject({
      credentialId: "guard-final-fifth-credential",
      bindingStrength: "user",
      requireUser: true,
      requireAgent: false,
      requireClient: false
    });

    const statePath = capabilityBindingGuardStatePath({ dataDir, alias });
    expect(statePath).toBe(path.join(
      dataDir,
      "security",
      "capability-binding-guard",
      "guard_final_fifth_local-file.sealed.json"
    ));
    expect((await fs.stat(statePath)).isFile()).toBe(true);

    await expect(guard.verifyCapabilityKeyBinding({
      capabilityKey,
      credentialId: "guard-final-fifth-credential",
      context: {
        namespace: "tenant-final-fifth"
      }
    })).resolves.toMatchObject({
      ok: false,
      applicable: true,
      reasonCode: "binding_user_missing",
      credentialId: "guard-final-fifth-credential"
    });

    await expect(guard.verifyCapabilityKeyBinding({
      capabilityKey: createCapabilityKey(),
      context: {
        namespace: "tenant-final-fifth",
        userId: "guard-user"
      }
    })).resolves.toMatchObject({
      ok: true,
      applicable: false,
      reasonCode: "capability_binding_not_registered"
    });

    const description = await guard.describe();
    expect(description).toMatchObject({
      provider: "local-file",
      degraded: true,
      statePath
    });

    guard.close();
  });

  it("invalidates guard bindings by credential and records the denial state", async () => {
    const dataDir = await tempDir("pact-final-fifth-guard-invalidate-");
    const alias = "guard final/fifth audit";
    const guard = createCapabilityBindingGuard({
      backend: "local-file",
      dataDir,
      alias
    });

    const firstKey = createCapabilityKey();
    const secondKey = createCapabilityKey();

    await guard.bindCapabilityKey({
      capabilityKey: firstKey,
      credentialId: "guard-audit-credential",
      context: {
        namespace: "tenant-audit",
        userId: "audit-user"
      }
    });
    await guard.bindCapabilityKey({
      capabilityKey: secondKey,
      credentialId: "guard-audit-credential",
      context: {
        namespace: "tenant-audit",
        userId: "audit-user"
      }
    });

    const invalidated = await guard.invalidateCapabilityKeyBinding({
      credentialId: "guard-audit-credential",
      reason: "credential revoked"
    });
    expect(invalidated).toHaveLength(2);
    expect(invalidated[0]).toMatchObject({
      credentialId: "guard-audit-credential",
      status: "invalid",
      invalidationReason: "credential revoked"
    });

    await expect(guard.invalidateCapabilityKeyBinding({
      credentialId: "guard-audit-credential",
      reason: "repeat revoke"
    })).resolves.toEqual([]);

    await expect(guard.verifyCapabilityKeyBinding({
      capabilityKey: firstKey,
      credentialId: "guard-audit-credential",
      context: {
        namespace: "tenant-audit",
        userId: "audit-user"
      }
    })).resolves.toMatchObject({
      ok: false,
      applicable: true,
      reasonCode: "binding_invalid",
      credentialId: "guard-audit-credential"
    });

    expect(await guard.invalidateCapabilityKeyBinding({})).toEqual([]);

    const description = await guard.describe();
    expect(description).toMatchObject({
      bindingCount: 2,
      activeBindingCount: 0,
      statePath: capabilityBindingGuardStatePath({ dataDir, alias })
    });

    guard.close();
  });
});
