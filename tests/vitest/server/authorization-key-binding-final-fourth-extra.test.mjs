import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  apiCapabilityId
} from "../../../server/platform/common/security/authorization/authorization-engine.mjs";
import {
  capabilityBindingGuardStatePath,
  createCapabilityBindingGuard,
  createMemoryCapabilityBindingGuard,
  normalizeCapabilityBindingContext
} from "../../../server/platform/common/security/authorization/capability-binding-guard.mjs";
import {
  capabilityKernelStatePath,
  createCapabilityKey,
  createMemoryOpaqueCapabilityKeyProvider
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

describe("authorization key binding final fourth extra coverage", () => {
  it("reports stale grant versions before succeeding with record details", async () => {
    const provider = createMemoryOpaqueCapabilityKeyProvider({
      alias: "final-fourth-opaque"
    });

    const issued = await provider.issue({
      capabilityKey: "opaque-final-fourth-key",
      credentialId: "opaque-final-fourth-credential",
      capabilities: [apiCapabilityId("knowledge.search")],
      grantVersion: 2,
      metadata: { source: "final-fourth" },
      constraints: { workspaceId: "workspace-final-fourth" }
    });

    expect(issued).toMatchObject({
      capabilityKey: "opaque-final-fourth-key",
      credentialId: "opaque-final-fourth-credential",
      runtimeLookupGeneration: 1
    });

    await expect(provider.verify({
      capabilityKey: issued.capabilityKey,
      requiredCapability: apiCapabilityId("knowledge.search"),
      minGrantVersion: 3
    })).resolves.toMatchObject({
      ok: false,
      reasonCode: "credential_grant_version_stale",
      credentialId: "opaque-final-fourth-credential"
    });

    await expect(provider.verify({
      capabilityKey: issued.capabilityKey,
      requiredCapability: apiCapabilityId("knowledge.search"),
      minGrantVersion: 2,
      includeRecordDetails: true
    })).resolves.toMatchObject({
      ok: true,
      reasonCode: "capability_key_valid",
      credentialId: "opaque-final-fourth-credential",
      grantVersion: 2,
      capabilityCount: 1,
      constraints: { workspaceId: "workspace-final-fourth" },
      metadata: { source: "final-fourth" }
    });

    const description = await provider.describe();
    expect(description).toMatchObject({
      provider: "memory",
      alias: "final-fourth-opaque",
      runtimeLookupLoaded: true,
      runtimeLookupLoadCount: 1,
      bindingCount: 1
    });

    provider.close();
  });

  it("rejects an undersized runtime lookup key and keeps no-op invalidations inert", async () => {
    const provider = createMemoryOpaqueCapabilityKeyProvider({
      alias: "final-fourth-invalid-lookup",
      lookupKeySource: {
        async loadRuntimeLookupKey() {
          return {
            runtimeLookupKeyBase64: Buffer.alloc(31, 9).toString("base64"),
            generation: 7
          };
        }
      }
    });

    await expect(provider.issue({
      capabilityKey: "opaque-invalid-lookup-key",
      capabilities: [apiCapabilityId("knowledge.search")]
    })).rejects.toThrow("Runtime lookup key helper returned an invalid key.");

    await expect(provider.invalidate({})).resolves.toBeNull();
    await expect(provider.invalidateCredential({})).resolves.toEqual([]);

    provider.close();
  });

  it("normalizes alternate binding context aliases and denies mismatched bindings", async () => {
    const guard = createMemoryCapabilityBindingGuard({
      alias: "final-fourth-binding"
    });
    const capabilityKey = createCapabilityKey();

    const bound = await guard.bindCapabilityKey({
      capabilityKey,
      credentialId: "binding-final-fourth-credential",
      context: {
        bindingNamespace: "tenant-final-fourth",
        subject_id: "subject-1",
        profileId: "agent-1",
        clientId: "client-1"
      }
    });

    expect(bound).toMatchObject({
      credentialId: "binding-final-fourth-credential",
      bindingStrength: "user+agent+client",
      requireUser: true,
      requireAgent: true,
      requireClient: true
    });

    expect(normalizeCapabilityBindingContext({
      bindingNamespace: "tenant-final-fourth",
      subject_id: "subject-1",
      profileId: "agent-1",
      clientId: "client-1"
    })).toMatchObject({
      namespace: "tenant-final-fourth",
      userId: "subject-1",
      boundUserId: "subject-1",
      agentId: "agent-1",
      agentProfileId: "agent-1",
      clientId: "client-1"
    });

    await expect(guard.verifyCapabilityKeyBinding({
      capabilityKey,
      credentialId: "binding-final-fourth-credential",
      context: {
        namespace: "tenant-final-fourth",
        userId: "subject-1",
        agentId: "agent-1",
        clientId: "client-1"
      }
    })).resolves.toMatchObject({
      ok: true,
      applicable: true,
      credentialId: "binding-final-fourth-credential",
      bindingStrength: "user+agent+client"
    });

    await expect(guard.verifyCapabilityKeyBinding({
      capabilityKey,
      credentialId: "binding-final-fourth-credential",
      context: {
        namespace: "tenant-final-fourth",
        userId: "subject-1",
        clientId: "client-1"
      }
    })).resolves.toMatchObject({
      ok: false,
      applicable: true,
      reasonCode: "binding_agent_missing"
    });

    await expect(guard.verifyCapabilityKeyBinding({
      capabilityKey,
      credentialId: "binding-final-fourth-credential",
      context: {
        namespace: "tenant-final-fourth",
        userId: "subject-1",
        agentId: "agent-1",
        clientId: "wrong-client"
      }
    })).resolves.toMatchObject({
      ok: false,
      applicable: true,
      reasonCode: "binding_client_mismatch"
    });

    await expect(guard.verifyCapabilityKeyBinding({
      capabilityKey,
      credentialId: "binding-final-fourth-credential",
      context: {
        namespace: "other-tenant",
        userId: "subject-1",
        agentId: "agent-1",
        clientId: "client-1"
      }
    })).resolves.toMatchObject({
      ok: false,
      applicable: true,
      reasonCode: "binding_namespace_mismatch"
    });

    guard.close();
  });

  it("audits multiple bindings and invalidates them by credential", async () => {
    const dataDir = await tempDir("pact-final-fourth-binding-audit-");
    const alias = "binding final/fourth audit";
    const guard = createCapabilityBindingGuard({
      backend: "local-file",
      dataDir,
      alias
    });

    const firstKey = createCapabilityKey();
    const secondKey = createCapabilityKey();

    await guard.bindCapabilityKey({
      capabilityKey: firstKey,
      credentialId: "audit-credential",
      context: {
        namespace: "tenant-audit",
        userId: "user-a"
      }
    });
    await guard.bindCapabilityKey({
      capabilityKey: secondKey,
      credentialId: "audit-credential",
      context: {
        namespace: "tenant-audit",
        userId: "user-b"
      }
    });

    const before = await guard.describe();
    expect(before).toMatchObject({
      provider: "local-file",
      degraded: true,
      bindingCount: 2,
      activeBindingCount: 2
    });
    expect(before.statePath).toBe(capabilityBindingGuardStatePath({ dataDir, alias }));

    await expect(guard.invalidateCapabilityKeyBinding({
      credentialId: "audit-credential",
      reason: "credential revoked"
    })).resolves.toHaveLength(2);

    const after = await guard.describe();
    expect(after).toMatchObject({
      bindingCount: 2,
      activeBindingCount: 0
    });

    await expect(guard.verifyCapabilityKeyBinding({
      capabilityKey: firstKey,
      credentialId: "audit-credential",
      context: {
        namespace: "tenant-audit",
        userId: "user-a"
      }
    })).resolves.toMatchObject({
      ok: false,
      applicable: true,
      reasonCode: "binding_invalid",
      credentialId: "audit-credential"
    });

    expect(capabilityKernelStatePath({ dataDir, alias: "opaque final/fourth audit" }))
      .toContain("opaque_final_fourth_audit.sealed.json");

    guard.close();
  });
});
