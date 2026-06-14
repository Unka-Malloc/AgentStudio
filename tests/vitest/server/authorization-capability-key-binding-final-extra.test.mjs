import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  apiCapabilityId,
  toolExecuteCapabilityId
} from "../../../server/platform/common/security/authorization/authorization-engine.mjs";
import {
  capabilityBindingGuardStatePath,
  capabilityBindingKeyHash,
  capabilityBindingSubjectHash,
  createCapabilityBindingGuard,
  createMemoryCapabilityBindingGuard,
  normalizeCapabilityBindingContext
} from "../../../server/platform/common/security/authorization/capability-binding-guard.mjs";
import {
  capabilityKernelStatePath,
  capabilityKeyHash,
  capabilityPermissionHash,
  canonicalOpaqueCapabilities,
  createCapabilityKey,
  createMemoryCapabilityKeyBindingStore,
  createOpaqueCapabilityKeyProvider,
  createSealedCapabilityKernelStore,
  opaqueCapabilityHash,
  OPAQUE_CAPABILITY_KEY_PROTOCOL_VERSION
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

describe("authorization capability key binding final extra coverage", () => {
  it("normalizes helper inputs and rejects undersized lookup keys", () => {
    expect(normalizeCapabilityBindingContext({
      bound_user_id: "user-1",
      agent_profile_id: "agent-1",
      client_name: "client-1",
      binding_namespace: "tenant-a"
    })).toMatchObject({
      namespace: "tenant-a",
      userId: "user-1",
      boundUserId: "user-1",
      agentId: "agent-1",
      agentProfileId: "agent-1",
      clientId: "client-1"
    });

    expect(normalizeCapabilityBindingContext(null)).toMatchObject({
      namespace: "tool-management",
      userId: "",
      agentId: "",
      clientId: ""
    });

    const normalizedCapabilities = canonicalOpaqueCapabilities([
      "  cap:tool:pact.agentLibrary.health:execute  ",
      "cap:api:knowledge.search",
      "cap:api:knowledge.search",
      "",
      "   "
    ]);

    expect(normalizedCapabilities).toEqual([
      "cap:api:knowledge.search",
      "cap:tool:pact.agentLibrary.health:execute"
    ]);
    expect(opaqueCapabilityHash(normalizedCapabilities)).toBe(
      opaqueCapabilityHash([...normalizedCapabilities].reverse())
    );

    const runtimeLookupKey = Buffer.alloc(32, 17);
    expect(capabilityKeyHash(runtimeLookupKey, "alpha")).toBe(capabilityKeyHash(runtimeLookupKey.toString("base64"), "alpha"));
    expect(capabilityPermissionHash(runtimeLookupKey, apiCapabilityId("knowledge.search"))).toBe(
      capabilityPermissionHash(runtimeLookupKey.toString("base64"), apiCapabilityId("knowledge.search"))
    );
    expect(capabilityBindingKeyHash(runtimeLookupKey, "binding-key")).toBe(
      capabilityBindingKeyHash(runtimeLookupKey.toString("base64"), "binding-key")
    );
    expect(capabilityBindingSubjectHash(runtimeLookupKey, "namespace", "tool-management")).toBe(
      capabilityBindingSubjectHash(runtimeLookupKey.toString("base64"), "namespace", "tool-management")
    );

    expect(() => capabilityKeyHash(Buffer.alloc(31), "alpha")).toThrow(
      "Capability key lookup requires a 256-bit runtime lookup key."
    );
    expect(() => capabilityPermissionHash(Buffer.alloc(31), apiCapabilityId("knowledge.search"))).toThrow(
      "Capability permission lookup requires a 256-bit runtime lookup key."
    );
    expect(() => capabilityBindingKeyHash(Buffer.alloc(31), "binding-key")).toThrow(
      "Capability binding guard requires a 256-bit lookup key."
    );
    expect(() => capabilityBindingSubjectHash(Buffer.alloc(31), "user", "user-1")).toThrow(
      "Capability binding guard requires a 256-bit lookup key."
    );

    expect(capabilityKernelStatePath({ dataDir: "/tmp/data", alias: "opaque/final alias" }))
      .toContain("opaque_final_alias.sealed.json");
    expect(capabilityBindingGuardStatePath({ dataDir: "/tmp/data", alias: "binding/final alias" }))
      .toContain("binding_final_alias.sealed.json");
  });

  it("covers wildcard opaque capability resolution and expiry/invalid boundary decisions", async () => {
    const provider = createOpaqueCapabilityKeyProvider({
      backend: "memory",
      alias: "final-extra-opaque",
      bindingStore: createMemoryCapabilityKeyBindingStore()
    });

    const wildcardIssued = await provider.issue({
      capabilityKey: "opaque-wildcard-key",
      credentialId: "opaque-wildcard-credential",
      capabilities: [
        "cap:api:*",
        "cap:tool:*"
      ],
      constraints: {
        workspaceId: "workspace-a"
      },
      metadata: {
        note: "wildcard-backed"
      },
      grantVersion: 2
    });
    expect(wildcardIssued).toMatchObject({
      protocolVersion: OPAQUE_CAPABILITY_KEY_PROTOCOL_VERSION,
      credentialId: "opaque-wildcard-credential",
      capabilityKey: "opaque-wildcard-key",
      capabilityCount: 2
    });

    await expect(provider.verify({
      capabilityKey: "opaque-wildcard-key",
      requiredCapabilities: [
        apiCapabilityId("knowledge.search"),
        toolExecuteCapabilityId("pact.agentLibrary.health")
      ],
      includeRecordDetails: true
    })).resolves.toMatchObject({
      ok: true,
      reasonCode: "capability_key_valid",
      credentialId: "opaque-wildcard-credential",
      requiredCapabilities: [
        apiCapabilityId("knowledge.search"),
        toolExecuteCapabilityId("pact.agentLibrary.health")
      ],
      capabilityCount: 2,
      constraints: {
        workspaceId: "workspace-a"
      },
      metadata: {
        note: "wildcard-backed"
      }
    });

    await expect(provider.verify({
      capabilityKey: "opaque-wildcard-key",
      requiredCapability: apiCapabilityId("unknown.operation")
    })).resolves.toMatchObject({
      ok: false,
      reasonCode: "unknown_capability",
      unknownCapabilities: [apiCapabilityId("unknown.operation")]
    });

    await expect(provider.verify({
      capabilityKey: "opaque-wildcard-key"
    })).resolves.toMatchObject({
      ok: false,
      reasonCode: "capability_required"
    });

    const invalidIssued = await provider.issue({
      capabilityKey: "opaque-invalid-key",
      credentialId: "opaque-invalid-credential",
      capabilities: [apiCapabilityId("knowledge.search")],
      status: "invalid"
    });
    expect(invalidIssued.status).toBe("invalid");
    await expect(provider.verify({
      capabilityKey: "opaque-invalid-key",
      requiredCapability: apiCapabilityId("knowledge.search")
    })).resolves.toMatchObject({
      ok: false,
      reasonCode: "capability_key_invalid",
      credentialId: "opaque-invalid-credential"
    });

    const expiredIssued = await provider.issue({
      capabilityKey: "opaque-expired-key",
      credentialId: "opaque-expired-credential",
      capabilities: [apiCapabilityId("knowledge.search")],
      expiresAt: new Date(Date.now() - 60_000).toISOString()
    });
    expect(expiredIssued.expiresAt).toBeTruthy();
    await expect(provider.verify({
      capabilityKey: "opaque-expired-key",
      requiredCapability: apiCapabilityId("knowledge.search")
    })).resolves.toMatchObject({
      ok: false,
      reasonCode: "capability_key_expired",
      credentialId: "opaque-expired-credential"
    });

    provider.close();
  });

  it("rejects tampered opaque sealed state and recovery payloads", async () => {
    const dataDir = await tempDir("pact-final-extra-opaque-parse-");
    const alias = "opaque/final extra parse";
    const provider = createOpaqueCapabilityKeyProvider({
      backend: "local-file",
      dataDir,
      alias
    });

    const issued = await provider.issue({
      capabilityKey: "opaque-parse-key",
      credentialId: "opaque-parse-credential",
      capabilities: [apiCapabilityId("knowledge.search")]
    });
    expect(issued.credentialId).toBe("opaque-parse-credential");

    const statePath = capabilityKernelStatePath({ dataDir, alias });
    const onDisk = JSON.parse(await fs.readFile(statePath, "utf8"));
    onDisk.stateRoot = "tampered-state-root";
    await fs.writeFile(statePath, `${JSON.stringify(onDisk, null, 2)}\n`);
    provider.close();

    const reopened = createOpaqueCapabilityKeyProvider({
      backend: "local-file",
      dataDir,
      alias
    });
    await expect(reopened.describe()).rejects.toThrow("Capability kernel sealed state root mismatch.");
    reopened.close();

    const sealedStore = createSealedCapabilityKernelStore({
      backend: "memory",
      alias: "opaque-memory-sealed-extra"
    });
    const runtimeLookup = await sealedStore.keySource.loadRuntimeLookupKey();
    expect(Buffer.from(runtimeLookup.runtimeLookupKeyBase64, "base64").length).toBeGreaterThanOrEqual(32);
    expect((await sealedStore.describe()).runtimeLookupKeyRotationSupported).toBe(true);
  });

  it("covers binding expiry, invalidation and recovery parse boundaries", async () => {
    const guard = createMemoryCapabilityBindingGuard({ alias: "final-extra-binding" });
    const capabilityKey = createCapabilityKey();

    const active = await guard.bindCapabilityKey({
      key: capabilityKey,
      credentialId: "binding-active-credential",
      context: {
        namespace: "tool-management",
        userId: "binding-user",
        agentId: "binding-agent",
        clientId: "binding-client"
      }
    });
    expect(active).toMatchObject({
      protocolVersion: "v0.0.1:risk-control:capability-binding-guard-1",
      credentialId: "binding-active-credential",
      bindingStrength: "user+agent+client",
      requireUser: true,
      requireAgent: true,
      requireClient: true
    });

    await expect(guard.verifyCapabilityKeyBinding({
      capabilityKey,
      credentialId: "binding-active-credential",
      context: {
        namespace: "tool-management",
        userId: "binding-user",
        agentId: "binding-agent",
        clientId: "binding-client"
      }
    })).resolves.toMatchObject({
      ok: true,
      applicable: true,
      reasonCode: "capability_binding_valid"
    });

    const expired = await guard.bindCapabilityKey({
      key: "binding-expired-key",
      credentialId: "binding-expired-credential",
      context: {
        namespace: "tool-management"
      },
      expiresAt: new Date(Date.now() - 60_000).toISOString()
    });
    expect(expired.expiresAt).toBeTruthy();
    await expect(guard.verifyCapabilityKeyBinding({
      capabilityKey: "binding-expired-key",
      credentialId: "binding-expired-credential",
      context: {
        namespace: "tool-management"
      }
    })).resolves.toMatchObject({
      ok: false,
      applicable: true,
      reasonCode: "binding_expired"
    });

    const invalid = await guard.bindCapabilityKey({
      key: "binding-invalid-key",
      credentialId: "binding-invalid-credential",
      context: {
        namespace: "tool-management"
      },
      status: "invalid"
    });
    expect(invalid.protocolVersion).toBe("v0.0.1:risk-control:capability-binding-guard-1");
    await expect(guard.verifyCapabilityKeyBinding({
      capabilityKey: "binding-invalid-key",
      credentialId: "binding-invalid-credential",
      context: {
        namespace: "tool-management"
      }
    })).resolves.toMatchObject({
      ok: false,
      applicable: true,
      reasonCode: "binding_invalid"
    });

    const invalidated = await guard.invalidateCapabilityKeyBinding({
      credentialId: "binding-active-credential",
      reason: "credential revoked"
    });
    expect(invalidated).toHaveLength(1);
    expect(invalidated[0]).toMatchObject({
      credentialId: "binding-active-credential",
      status: "invalid",
      invalidationReason: "credential revoked"
    });
    await expect(guard.verifyCapabilityKeyBinding({
      capabilityKey,
      credentialId: "binding-active-credential",
      context: {
        namespace: "tool-management",
        userId: "binding-user",
        agentId: "binding-agent",
        clientId: "binding-client"
      }
    })).resolves.toMatchObject({
      ok: false,
      applicable: true,
      reasonCode: "binding_invalid"
    });
  });

  it("rejects tampered binding sealed state and malformed recovery packages", async () => {
    const dataDir = await tempDir("pact-final-extra-binding-parse-");
    const alias = "binding/final extra parse";
    const guard = createCapabilityBindingGuard({
      backend: "local-file",
      dataDir,
      alias
    });

    const capabilityKey = createCapabilityKey();
    await guard.bindCapabilityKey({
      key: capabilityKey,
      credentialId: "binding-parse-credential",
      context: {
        namespace: "tool-management",
        userId: "binding-user"
      }
    });

    const statePath = capabilityBindingGuardStatePath({ dataDir, alias });
    const onDisk = JSON.parse(await fs.readFile(statePath, "utf8"));
    onDisk.stateRoot = "tampered-binding-state-root";
    await fs.writeFile(statePath, `${JSON.stringify(onDisk, null, 2)}\n`);
    guard.close();

    const reopened = createCapabilityBindingGuard({
      backend: "local-file",
      dataDir,
      alias
    });
    await expect(reopened.describe()).rejects.toThrow("Capability binding guard sealed state root mismatch.");
    reopened.close();

    const recoveryGuard = createMemoryCapabilityBindingGuard({ alias: "binding-recovery-parse" });
    await recoveryGuard.bindCapabilityKey({
      key: createCapabilityKey(),
      credentialId: "binding-recovery-credential",
      context: {
        namespace: "tool-management",
        userId: "binding-user"
      }
    });

    await expect(recoveryGuard.exportRecoveryPackage({ passphrase: "" })).rejects.toThrow(
      "Capability binding guard recovery export requires a passphrase."
    );
    const recoveryPackage = await recoveryGuard.exportRecoveryPackage({
      passphrase: "correct horse battery staple",
      reason: "parse-boundary"
    });

    const tamperedRecoveryPackage = JSON.parse(JSON.stringify(recoveryPackage));
    tamperedRecoveryPackage.sealedRecovery.algorithm = "unsupported";

    await expect(recoveryGuard.importRecoveryPackage({
      recoveryPackage: tamperedRecoveryPackage,
      passphrase: "correct horse battery staple"
    })).rejects.toThrow("Unsupported capability binding guard sealed state payload.");

    await expect(recoveryGuard.importRecoveryPackage({
      recoveryPackage: { protocolVersion: "unsupported" },
      passphrase: "correct horse battery staple"
    })).rejects.toThrow("Unsupported capability binding guard recovery package.");
  });
});
