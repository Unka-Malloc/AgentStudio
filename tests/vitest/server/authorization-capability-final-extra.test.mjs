import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  apiCapabilityId,
  toolExecuteCapabilityId
} from "../../../server/platform/common/security/authorization/authorization-engine.mjs";
import {
  CAPABILITY_BINDING_GUARD_PROTOCOL_VERSION,
  capabilityBindingGuardStatePath,
  createCapabilityBindingGuard,
  createMemoryCapabilityBindingGuard
} from "../../../server/platform/common/security/authorization/capability-binding-guard.mjs";
import {
  capabilityKernelStatePath,
  createCapabilityKey,
  createMemoryCapabilityKeyBindingStore,
  createMemoryOpaqueCapabilityKeyProvider,
  createOpaqueCapabilityKeyProvider,
  OPAQUE_CAPABILITY_KEY_PROTOCOL_VERSION
} from "../../../server/platform/common/security/authorization/opaque-capability-key.mjs";

const tempRoots = [];

async function tempDir(prefix) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

function createMockLookupKeySource({
  runtimeLookupKeyBase64 = Buffer.alloc(32, 41).toString("base64"),
  provider = "mock",
  securityMode = "mock-keyring"
} = {}) {
  let loadCount = 0;
  let generation = 7;
  return {
    async loadRuntimeLookupKey() {
      loadCount += 1;
      return {
        protocolVersion: OPAQUE_CAPABILITY_KEY_PROTOCOL_VERSION,
        provider,
        securityMode,
        generation,
        runtimeLookupKeyBase64
      };
    },
    async rotateRuntimeLookupKey() {
      generation += 1;
      return {
        protocolVersion: OPAQUE_CAPABILITY_KEY_PROTOCOL_VERSION,
        provider,
        generation
      };
    },
    describe() {
      return {
        protocolVersion: OPAQUE_CAPABILITY_KEY_PROTOCOL_VERSION,
        provider,
        securityMode,
        generation,
        loadCount,
        runtimeLookupKeyRotationSupported: true,
        permissionBindingCount: 0,
        stateRoot: "mock-state-root",
        linuxDetectedBackends: ["local-file"]
      };
    }
  };
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("authorization capability final extra coverage", () => {
  it("covers wildcard lookups, describe variants, and rotation edge cases", async () => {
    const lookupKeySource = createMockLookupKeySource();
    const provider = createOpaqueCapabilityKeyProvider({
      backend: "memory",
      alias: "final-opaque-memory",
      bindingStore: createMemoryCapabilityKeyBindingStore(),
      lookupKeySource
    });

    const initialDescription = await provider.describe();
    expect(initialDescription).toMatchObject({
      protocolVersion: OPAQUE_CAPABILITY_KEY_PROTOCOL_VERSION,
      provider: "memory",
      securityMode: "mock-keyring",
      alias: "final-opaque-memory",
      runtimeLookupLoaded: false,
      runtimeLookupLoadCount: 0,
      bindingCount: 0,
      keySource: {
        provider: "mock",
        securityMode: "mock-keyring",
        generation: 7,
        loadCount: 0,
        runtimeLookupKeyRotationSupported: true
      }
    });
    expect(initialDescription.linuxDetectedBackends).toEqual(["local-file"]);
    expect(initialDescription.stateRoot).toBe("mock-state-root");

    const issued = await provider.issue({
      capabilityKey: "opaque-final-key",
      credentialId: "opaque-final-credential",
      capabilities: ["cap:*"],
      constraints: {
        workspaceId: "workspace-a"
      },
      metadata: {
        source: "final-extra"
      }
    });
    expect(issued).toMatchObject({
      protocolVersion: OPAQUE_CAPABILITY_KEY_PROTOCOL_VERSION,
      credentialId: "opaque-final-credential",
      capabilityKey: "opaque-final-key",
      capabilityCount: 1
    });

    await expect(provider.verify({
      capabilityKey: "opaque-final-key",
      requiredCapability: apiCapabilityId("knowledge.search"),
      includeRecordDetails: true
    })).resolves.toMatchObject({
      ok: true,
      reasonCode: "capability_key_valid",
      credentialId: "opaque-final-credential",
      requiredCapabilities: [apiCapabilityId("knowledge.search")],
      capabilityCount: 1,
      constraints: {
        workspaceId: "workspace-a"
      },
      metadata: {
        source: "final-extra"
      }
    });

    await expect(provider.verify({
      capabilityKey: "opaque-final-key",
      requiredCapabilities: [
        apiCapabilityId("knowledge.search"),
        toolExecuteCapabilityId("pact.knowledge.health")
      ]
    })).resolves.toMatchObject({
      ok: true,
      reasonCode: "capability_key_valid",
      requiredCapabilities: [
        apiCapabilityId("knowledge.search"),
        toolExecuteCapabilityId("pact.knowledge.health")
      ]
    });

    await expect(provider.verify({
      capabilityKey: "opaque-final-key",
      requiredCapability: apiCapabilityId("unknown.operation")
    })).resolves.toMatchObject({
      ok: false,
      reasonCode: "unknown_capability",
      unknownCapabilities: [apiCapabilityId("unknown.operation")]
    });

    await expect(provider.verify({
      capabilityKey: "opaque-final-key"
    })).resolves.toMatchObject({
      ok: false,
      reasonCode: "capability_required"
    });

    await expect(provider.rotateCapabilityKey({
      capabilityKey: "missing-key",
      capabilities: [apiCapabilityId("knowledge.search")]
    })).resolves.toMatchObject({
      ok: false,
      reasonCode: "capability_key_invalid"
    });

    await expect(provider.rotateCapabilityKey({
      capabilityKey: "opaque-final-key",
      capabilities: []
    })).resolves.toMatchObject({
      ok: false,
      reasonCode: "capabilities_required_for_rotation"
    });

    await expect(provider.rotateCapabilityKey({
      capabilityKey: "opaque-final-key",
      capabilities: [apiCapabilityId("unknown.operation")]
    })).rejects.toThrow("Unknown opaque capability permission:");

    const rotated = await provider.rotateCapabilityKey({
      capabilityKey: "opaque-final-key",
      capabilities: [apiCapabilityId("knowledge.search")],
      reason: "final-rotation"
    });
    expect(rotated).toMatchObject({
      ok: true,
      oldStatus: "invalid",
      status: "valid"
    });

    await expect(provider.verify({
      capabilityKey: "opaque-final-key",
      requiredCapability: apiCapabilityId("knowledge.search")
    })).resolves.toMatchObject({
      ok: false,
      reasonCode: "capability_key_invalid"
    });

    await expect(provider.verify({
      capabilityKey: rotated.capabilityKey,
      requiredCapability: apiCapabilityId("knowledge.search")
    })).resolves.toMatchObject({
      ok: true,
      reasonCode: "capability_key_valid"
    });

    expect(await provider.invalidate()).toBeNull();
    expect(await provider.invalidateCredential()).toEqual([]);

    const finalDescription = await provider.describe();
    expect(finalDescription).toMatchObject({
      protocolVersion: OPAQUE_CAPABILITY_KEY_PROTOCOL_VERSION,
      provider: "memory",
      securityMode: "mock-keyring",
      alias: "final-opaque-memory",
      runtimeLookupLoaded: true,
      runtimeLookupLoadCount: 1,
      bindingCount: 2,
      keySource: {
        provider: "mock",
        securityMode: "mock-keyring",
        generation: 7,
        loadCount: 1,
        runtimeLookupKeyRotationSupported: true
      }
    });

    provider.close();
  });

  it("rejects malformed runtime lookup configuration deterministically", async () => {
    const provider = createOpaqueCapabilityKeyProvider({
      alias: "final-opaque-malformed",
      bindingStore: createMemoryCapabilityKeyBindingStore(),
      lookupKeySource: createMockLookupKeySource({
        runtimeLookupKeyBase64: Buffer.alloc(31, 17).toString("base64"),
        provider: "malformed",
        securityMode: "broken"
      })
    });

    expect(await provider.describe()).toMatchObject({
      runtimeLookupLoaded: false,
      runtimeLookupLoadCount: 0,
      bindingCount: 0
    });

    await expect(provider.issue({
      capabilityKey: "malformed-key",
      credentialId: "malformed-credential",
      capabilities: [apiCapabilityId("knowledge.search")]
    })).rejects.toThrow("Runtime lookup key helper returned an invalid key.");

    const postFailureDescription = await provider.describe();
    expect(postFailureDescription).toMatchObject({
      runtimeLookupLoaded: true,
      runtimeLookupLoadCount: 1,
      bindingCount: 0,
      keySource: {
        provider: "malformed",
        securityMode: "broken",
        loadCount: 1
      }
    });

    provider.close();
  });

  it("recovers opaque local-file state when the sealed record disappears", async () => {
    const dataDir = await tempDir("pact-final-opaque-recovery-");
    const alias = "opaque/final recovery alias";
    const provider = createOpaqueCapabilityKeyProvider({
      backend: "local-file",
      dataDir,
      alias
    });

    const issued = await provider.issue({
      capabilityKey: "opaque-recovery-key",
      credentialId: "opaque-recovery-credential",
      capabilities: [apiCapabilityId("knowledge.search")]
    });
    expect(issued.capabilityKey).toBe("opaque-recovery-key");

    const statePath = capabilityKernelStatePath({ dataDir, alias });
    expect(statePath).toContain("opaque_final_recovery_alias.sealed.json");
    await fs.rm(statePath, { force: true });
    provider.close();

    const reopened = createOpaqueCapabilityKeyProvider({
      backend: "local-file",
      dataDir,
      alias
    });

    const description = await reopened.describe();
    expect(description).toMatchObject({
      protocolVersion: OPAQUE_CAPABILITY_KEY_PROTOCOL_VERSION,
      provider: "local-file",
      securityMode: "degraded_file_fallback",
      alias: "opaque/final recovery alias",
      bindingCount: 0,
      permissionBindingCount: 0
    });

    await expect(reopened.verify({
      capabilityKey: "opaque-recovery-key",
      requiredCapability: apiCapabilityId("knowledge.search")
    })).resolves.toMatchObject({
      ok: false,
      reasonCode: "capability_key_unknown"
    });

    await expect(fs.readFile(statePath, "utf8")).rejects.toThrow(/ENOENT/);
    reopened.close();
  });

  it("covers namespace-only bindings, invalid binding states, and binding-state recovery", async () => {
    const guard = createMemoryCapabilityBindingGuard({ alias: "final-binding-memory" });

    expect(await guard.invalidateCapabilityKeyBinding({
      reason: "noop"
    })).toEqual([]);

    const initialDescription = await guard.describe();
    expect(initialDescription).toMatchObject({
      protocolVersion: CAPABILITY_BINDING_GUARD_PROTOCOL_VERSION,
      provider: "memory",
      securityMode: "memory",
      alias: "final-binding-memory",
      degraded: false,
      bindingCount: 0,
      activeBindingCount: 0,
      statePath: ""
    });

    const namespaceOnlyKey = createCapabilityKey();
    const namespaceOnlyBinding = await guard.bindCapabilityKey({
      key: namespaceOnlyKey,
      credentialId: "namespace-only",
      context: {
        namespace: "tenant-a"
      }
    });
    expect(namespaceOnlyBinding).toMatchObject({
      protocolVersion: CAPABILITY_BINDING_GUARD_PROTOCOL_VERSION,
      credentialId: "namespace-only",
      bindingStrength: "namespace",
      requireUser: false,
      requireAgent: false,
      requireClient: false
    });

    await expect(guard.verifyCapabilityKeyBinding({
      capabilityKey: namespaceOnlyKey,
      credentialId: "namespace-only",
      context: {
        namespace: "tenant-a",
        userId: "extra-user",
        agentId: "extra-agent",
        clientId: "extra-client"
      }
    })).resolves.toMatchObject({
      ok: true,
      applicable: true,
      reasonCode: "capability_binding_valid",
      bindingStrength: "namespace"
    });

    await expect(guard.verifyCapabilityKeyBinding({
      capabilityKey: namespaceOnlyKey,
      credentialId: "namespace-only",
      context: {
        namespace: "tenant-b"
      }
    })).resolves.toMatchObject({
      ok: false,
      applicable: true,
      reasonCode: "binding_namespace_mismatch"
    });

    const invalidBindingKey = createCapabilityKey();
    const invalidBinding = await guard.bindCapabilityKey({
      key: invalidBindingKey,
      credentialId: "invalid-binding",
      status: "invalid",
      context: {
        namespace: "tenant-a",
        userId: "user-1"
      }
    });
    expect(invalidBinding).toMatchObject({
      credentialId: "invalid-binding",
      requireUser: true,
      bindingStrength: "user"
    });

    await expect(guard.verifyCapabilityKeyBinding({
      capabilityKey: invalidBindingKey,
      credentialId: "invalid-binding",
      context: {
        namespace: "tenant-a",
        userId: "user-1"
      }
    })).resolves.toMatchObject({
      ok: false,
      applicable: true,
      reasonCode: "binding_invalid"
    });

    await expect(guard.verifyCapabilityKeyBinding({
      capabilityKey: invalidBindingKey,
      credentialId: "invalid-binding",
      context: {
        namespace: "tenant-a"
      }
    })).resolves.toMatchObject({
      ok: false,
      applicable: true,
      reasonCode: "binding_invalid"
    });

    const invalidatedByCredential = await guard.invalidateCapabilityKeyBinding({
      credentialId: "namespace-only",
      reason: "retired"
    });
    expect(invalidatedByCredential).toHaveLength(1);
    expect(invalidatedByCredential[0]).toMatchObject({
      credentialId: "namespace-only",
      status: "invalid",
      invalidationReason: "retired"
    });

    await expect(guard.verifyCapabilityKeyBinding({
      capabilityKey: namespaceOnlyKey,
      credentialId: "namespace-only",
      context: {
        namespace: "tenant-a"
      }
    })).resolves.toMatchObject({
      ok: false,
      applicable: true,
      reasonCode: "binding_invalid"
    });

    const finalDescription = await guard.describe();
    expect(finalDescription).toMatchObject({
      protocolVersion: CAPABILITY_BINDING_GUARD_PROTOCOL_VERSION,
      provider: "memory",
      securityMode: "memory",
      alias: "final-binding-memory",
      bindingCount: 2,
      activeBindingCount: 0,
      degraded: false,
      statePath: ""
    });
    expect(finalDescription.loadCount).toBe(1);
    expect(finalDescription.saveCount).toBeGreaterThan(0);

    guard.close();
  });

  it("recovers binding guard state when the sealed record disappears", async () => {
    const dataDir = await tempDir("pact-final-binding-recovery-");
    const alias = "binding/final recovery alias";
    const guard = createCapabilityBindingGuard({
      backend: "local-file",
      dataDir,
      alias
    });

    const capabilityKey = createCapabilityKey();
    const bound = await guard.bindCapabilityKey({
      key: capabilityKey,
      credentialId: "binding-recovery",
      context: {
        namespace: "tenant-a",
        userId: "user-a"
      }
    });
    expect(bound).toMatchObject({
      credentialId: "binding-recovery",
      bindingStrength: "user"
    });

    const statePath = capabilityBindingGuardStatePath({ dataDir, alias });
    expect(statePath).toContain("binding_final_recovery_alias.sealed.json");
    await fs.rm(statePath, { force: true });
    guard.close();

    const reopened = createCapabilityBindingGuard({
      backend: "local-file",
      dataDir,
      alias
    });
    const description = await reopened.describe();
    expect(description).toMatchObject({
      protocolVersion: CAPABILITY_BINDING_GUARD_PROTOCOL_VERSION,
      provider: "local-file",
      securityMode: "degraded_file_fallback",
      alias: "binding_final_recovery_alias",
      bindingCount: 0,
      activeBindingCount: 0
    });

    await expect(reopened.verifyCapabilityKeyBinding({
      capabilityKey,
      credentialId: "binding-recovery",
      context: {
        namespace: "tenant-a",
        userId: "user-a"
      }
    })).resolves.toMatchObject({
      ok: true,
      applicable: false,
      reasonCode: "capability_binding_not_registered"
    });

    await expect(fs.readFile(statePath, "utf8")).rejects.toThrow(/ENOENT/);
    reopened.close();
  });
});
