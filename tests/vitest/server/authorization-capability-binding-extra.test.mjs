import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  apiCapabilityId
} from "../../../server/platform/common/security/authorization/authorization-engine.mjs";
import {
  CAPABILITY_BINDING_GUARD_PROTOCOL_VERSION,
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
  createMemoryOpaqueCapabilityKeyProvider,
  createOpaqueCapabilityKeyProvider,
  opaqueCapabilityHash,
  OPAQUE_CAPABILITY_KEY_PROTOCOL_VERSION
} from "../../../server/platform/common/security/authorization/opaque-capability-key.mjs";

const tempRoots = [];

async function tempDir(prefix) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

function tamperBase64(value = "") {
  if (!value) {
    return value;
  }
  const first = value[0];
  const replacement = first === "A" ? "B" : "A";
  return `${replacement}${value.slice(1)}`;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("authorization capability binding extra coverage", () => {
  it("normalizes opaque capability inputs and rejects empty or unknown requirements", async () => {
    const normalized = canonicalOpaqueCapabilities([
      "  cap:tool:pact.agentLibrary.health:execute  ",
      "cap:api:knowledge.search",
      "cap:api:knowledge.search",
      "",
      "   ",
      "cap:tool:pact.agentLibrary.health:execute"
    ]);

    expect(normalized).toEqual([
      "cap:api:knowledge.search",
      "cap:tool:pact.agentLibrary.health:execute"
    ]);
    expect(opaqueCapabilityHash(normalized)).toBe(opaqueCapabilityHash([...normalized].reverse()));

    const runtimeLookupKey = Buffer.alloc(32, 17);
    expect(capabilityKeyHash(runtimeLookupKey, "alpha")).toBe(capabilityKeyHash(runtimeLookupKey, "alpha"));
    expect(capabilityPermissionHash(runtimeLookupKey, apiCapabilityId("knowledge.search"))).toBe(
      capabilityPermissionHash(runtimeLookupKey, apiCapabilityId("knowledge.search"))
    );
    expect(capabilityKeyHash(runtimeLookupKey, "alpha")).not.toBe(
      capabilityPermissionHash(runtimeLookupKey, apiCapabilityId("knowledge.search"))
    );
    expect(() => capabilityKeyHash(Buffer.alloc(8), "alpha")).toThrow(
      "Capability key lookup requires a 256-bit runtime lookup key."
    );
    expect(() => capabilityPermissionHash(Buffer.alloc(8), apiCapabilityId("knowledge.search"))).toThrow(
      "Capability permission lookup requires a 256-bit runtime lookup key."
    );

    const provider = createMemoryOpaqueCapabilityKeyProvider({ alias: "unit-authorization-capability-extra" });

    await expect(provider.issue({
      credentialId: "empty-capabilities",
      capabilities: []
    })).rejects.toThrow("Capability key binding requires at least one kernel capability.");

    const issued = await provider.issue({
      credentialId: "opaque-credential",
      capabilityKey: "opaque-issue-key",
      capabilities: [apiCapabilityId("knowledge.search")]
    });

    expect(issued).toMatchObject({
      protocolVersion: OPAQUE_CAPABILITY_KEY_PROTOCOL_VERSION,
      credentialId: "opaque-credential",
      capabilityKey: "opaque-issue-key"
    });

    await expect(provider.verify({
      capabilityKey: issued.capabilityKey
    })).resolves.toMatchObject({
      ok: false,
      reasonCode: "capability_required"
    });

    await expect(provider.verify({
      capabilityKey: issued.capabilityKey,
      requiredCapability: apiCapabilityId("unknown.operation")
    })).resolves.toMatchObject({
      ok: false,
      reasonCode: "unknown_capability",
      unknownCapabilities: [apiCapabilityId("unknown.operation")]
    });

    await expect(provider.verify({
      capabilityKey: issued.capabilityKey,
      requiredCapability: apiCapabilityId("knowledge.search"),
      includeRecordDetails: true
    })).resolves.toMatchObject({
      ok: true,
      reasonCode: "capability_key_valid",
      credentialId: "opaque-credential",
      capabilityCount: 1,
      grantVersion: 1,
      metadata: {},
      constraints: {}
    });

    provider.close();
  });

  it("detects tampered opaque recovery payloads and sealed state digest mismatches", async () => {
    const sourceDataDir = await tempDir("pact-opaque-auth-src-");
    const targetDataDir = await tempDir("pact-opaque-auth-target-");
    const alias = "opaque/auth tamper";
    const source = createOpaqueCapabilityKeyProvider({
      backend: "local-file",
      dataDir: sourceDataDir,
      alias
    });

    await source.issue({
      credentialId: "opaque-recovery-credential",
      capabilityKey: "opaque-recovery-key",
      capabilities: [apiCapabilityId("knowledge.search")]
    });

    const recoveryPackage = await source.exportRecoveryPackage({
      passphrase: "correct horse battery staple",
      reason: "unit test"
    });
    const tamperedRecovery = JSON.parse(JSON.stringify(recoveryPackage));
    tamperedRecovery.sealedRecovery.ciphertextBase64 = tamperBase64(tamperedRecovery.sealedRecovery.ciphertextBase64);

    const target = createOpaqueCapabilityKeyProvider({
      backend: "local-file",
      dataDir: targetDataDir,
      alias: "opaque-target"
    });

    await expect(target.importRecoveryPackage({
      recoveryPackage: tamperedRecovery,
      passphrase: "correct horse battery staple"
    })).rejects.toThrow();

    source.close();
    target.close();

    const statePath = capabilityKernelStatePath({ dataDir: sourceDataDir, alias });
    const onDisk = JSON.parse(await fs.readFile(statePath, "utf8"));
    onDisk.sealedState.ciphertextBase64 = tamperBase64(onDisk.sealedState.ciphertextBase64);
    await fs.writeFile(statePath, `${JSON.stringify(onDisk, null, 2)}\n`);

    const reopened = createOpaqueCapabilityKeyProvider({
      backend: "local-file",
      dataDir: sourceDataDir,
      alias
    });

    await expect(reopened.describe()).rejects.toThrow();
    reopened.close();
  });

  it("normalizes binding context aliases and enforces missing-context and namespace boundaries", async () => {
    expect(normalizeCapabilityBindingContext({
      bound_user_id: "user-bound",
      agent_profile_id: "agent-bound",
      client_name: "client-bound",
      binding_namespace: "tenant-a"
    })).toMatchObject({
      namespace: "tenant-a",
      userId: "user-bound",
      agentId: "agent-bound",
      clientId: "client-bound"
    });

    expect(normalizeCapabilityBindingContext({})).toMatchObject({
      namespace: "tool-management",
      userId: "",
      agentId: "",
      clientId: ""
    });

    const shortLookupKey = Buffer.alloc(8);
    expect(() => capabilityBindingKeyHash(shortLookupKey, createCapabilityKey())).toThrow(
      "Capability binding guard requires a 256-bit lookup key."
    );
    expect(() => capabilityBindingSubjectHash(shortLookupKey, "user", "user-1")).toThrow(
      "Capability binding guard requires a 256-bit lookup key."
    );
    expect(capabilityBindingSubjectHash(Buffer.alloc(32, 9), "namespace", "tool-management")).toBeTruthy();

    const guard = createMemoryCapabilityBindingGuard({ alias: "unit-binding-auth-extra" });
    const capabilityKey = createCapabilityKey();

    const bound = await guard.bindCapabilityKey({
      key: capabilityKey,
      credentialId: "binding-credential",
      context: {
        namespace: "tool-management",
        userId: "user-1",
        agentId: "agent-1"
      }
    });

    expect(bound).toMatchObject({
      protocolVersion: CAPABILITY_BINDING_GUARD_PROTOCOL_VERSION,
      credentialId: "binding-credential",
      bindingStrength: "user+agent",
      requireUser: true,
      requireAgent: true,
      requireClient: false
    });

    await expect(guard.verifyCapabilityKeyBinding({
      capabilityKey,
      credentialId: "binding-credential",
      context: {
        namespace: "tool-management",
        agentId: "agent-1"
      }
    })).resolves.toMatchObject({
      ok: false,
      reasonCode: "binding_user_missing"
    });

    await expect(guard.verifyCapabilityKeyBinding({
      capabilityKey,
      credentialId: "binding-credential",
      context: {
        namespace: "tenant-west",
        userId: "user-1",
        agentId: "agent-1"
      }
    })).resolves.toMatchObject({
      ok: false,
      reasonCode: "binding_namespace_mismatch"
    });

    await expect(guard.verifyCapabilityKeyBinding({
      capabilityKey: createCapabilityKey(),
      credentialId: "ghost-credential",
      context: {
        namespace: "tool-management"
      }
    })).resolves.toMatchObject({
      ok: true,
      applicable: false,
      reasonCode: "capability_binding_not_registered"
    });

    await expect(guard.verifyCapabilityKeyBinding({
      context: {
        namespace: "tool-management"
      }
    })).resolves.toMatchObject({
      ok: false,
      reasonCode: "capability_key_missing"
    });

    await expect(guard.verifyCapabilityKeyBinding({
      capabilityKey,
      credentialId: "binding-credential",
      context: {
        namespace: "tool-management",
        userId: "user-1",
        agentId: "agent-1"
      }
    })).resolves.toMatchObject({
      ok: true,
      applicable: true,
      credentialId: "binding-credential",
      bindingStrength: "user+agent"
    });

    guard.close();
  });

  it("detects tampered guard recovery payloads and sealed state digest mismatches", async () => {
    const sourceDataDir = await tempDir("pact-binding-auth-src-");
    const targetDataDir = await tempDir("pact-binding-auth-target-");
    const alias = "binding/auth tamper";
    const source = createCapabilityBindingGuard({
      backend: "local-file",
      dataDir: sourceDataDir,
      alias
    });

    const capabilityKey = createCapabilityKey();
    await source.bindCapabilityKey({
      key: capabilityKey,
      credentialId: "binding-recovery-credential",
      context: {
        namespace: "tool-management",
        userId: "binding-user"
      }
    });

    const recoveryPackage = await source.exportRecoveryPackage({
      passphrase: "correct horse battery staple",
      reason: "unit test"
    });
    const tamperedRecovery = JSON.parse(JSON.stringify(recoveryPackage));
    tamperedRecovery.sealedRecovery.tagBase64 = tamperBase64(tamperedRecovery.sealedRecovery.tagBase64);

    const target = createCapabilityBindingGuard({
      backend: "local-file",
      dataDir: targetDataDir,
      alias: "binding-target"
    });

    await expect(target.importRecoveryPackage({
      recoveryPackage: tamperedRecovery,
      passphrase: "correct horse battery staple"
    })).rejects.toThrow();

    source.close();
    target.close();

    const statePath = capabilityBindingGuardStatePath({ dataDir: sourceDataDir, alias });
    const onDisk = JSON.parse(await fs.readFile(statePath, "utf8"));
    onDisk.sealedState.tagBase64 = tamperBase64(onDisk.sealedState.tagBase64);
    await fs.writeFile(statePath, `${JSON.stringify(onDisk, null, 2)}\n`);

    const reopened = createCapabilityBindingGuard({
      backend: "local-file",
      dataDir: sourceDataDir,
      alias
    });

    await expect(reopened.describe()).rejects.toThrow();
    reopened.close();
  });
});
