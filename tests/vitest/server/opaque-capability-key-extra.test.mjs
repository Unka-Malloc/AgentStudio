import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  apiCapabilityId,
  toolExecuteCapabilityId,
} from "../../../server/platform/common/security/authorization/authorization-engine.mjs";
import {
  canonicalOpaqueCapabilities,
  capabilityKeyHash,
  capabilityPermissionHash,
  createCapabilityKey,
  capabilityKernelStatePath,
  createMemoryCapabilityKeyBindingStore,
  createOpaqueCapabilityKeyProvider,
  opaqueCapabilityHash,
  createSealedCapabilityKernelStore,
  OPAQUE_CAPABILITY_KEY_PROTOCOL_VERSION,
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

describe("opaque capability key sealed local-file backend", () => {
  it("persists issued opaque keys without plaintext and reloads them across providers", async () => {
    const dataDir = await tempDir("pact-opaque-local-");
    const alias = "unit/local file alias";
    const provider = createOpaqueCapabilityKeyProvider({
      backend: "local-file",
      dataDir,
      alias,
    });

    const issued = await provider.issue({
      credentialId: "local-file-credential",
      capabilityKey: "opaque-local-key",
      capabilities: [
        apiCapabilityId("knowledge.search"),
        toolExecuteCapabilityId("pact.knowledge.health"),
      ],
      constraints: {
        workspaceId: "workspace-1",
      },
      metadata: {
        reason: "unit-test",
      },
      grantVersion: 2,
      ttlMs: 60_000,
    });

    expect(issued).toMatchObject({
      protocolVersion: OPAQUE_CAPABILITY_KEY_PROTOCOL_VERSION,
      credentialId: "local-file-credential",
      capabilityKey: "opaque-local-key",
      capabilityCount: 2,
    });

    const detailed = await provider.verify({
      capabilityKey: "opaque-local-key",
      requiredCapabilities: [apiCapabilityId("knowledge.search")],
      minGrantVersion: 2,
      includeRecordDetails: true,
    });
    expect(detailed).toMatchObject({
      ok: true,
      reasonCode: "capability_key_valid",
      credentialId: "local-file-credential",
      grantVersion: 2,
      constraints: {
        workspaceId: "workspace-1",
      },
      metadata: {
        reason: "unit-test",
      },
    });

    const stale = await provider.verify({
      capabilityKey: "opaque-local-key",
      requiredCapability: apiCapabilityId("knowledge.search"),
      minGrantVersion: 3,
    });
    expect(stale).toMatchObject({
      ok: false,
      reasonCode: "credential_grant_version_stale",
    });

    const statePath = capabilityKernelStatePath({ dataDir, alias });
    const stateText = await fs.readFile(statePath, "utf8");
    expect(stateText).not.toContain("opaque-local-key");
    expect(stateText).not.toContain("workspace-1");
    expect(stateText).toContain("\"sealedState\"");

    provider.close();

    const reloaded = createOpaqueCapabilityKeyProvider({
      backend: "local-file",
      dataDir,
      alias,
    });
    await expect(reloaded.verify({
      capabilityKey: "opaque-local-key",
      requiredCapability: apiCapabilityId("knowledge.search"),
    })).resolves.toMatchObject({
      ok: true,
      credentialId: "local-file-credential",
    });

    await reloaded.invalidateCredential({
      credentialId: "local-file-credential",
      reason: "credential retired",
    });
    await expect(reloaded.verify({
      capabilityKey: "opaque-local-key",
      requiredCapability: apiCapabilityId("knowledge.search"),
    })).resolves.toMatchObject({
      ok: false,
      reasonCode: "capability_key_invalid",
    });
    reloaded.close();
  });

  it("merges hot sealed state with stale persisted state before issuing another key", async () => {
    const dataDir = await tempDir("pact-opaque-hot-merge-");
    const alias = "unit/hot merge alias";
    const provider = createOpaqueCapabilityKeyProvider({
      backend: "local-file",
      dataDir,
      alias,
    });
    const statePath = capabilityKernelStatePath({ dataDir, alias });
    await provider.store.keySource.loadRuntimeLookupKey();
    const stalePersistedState = await fs.readFile(statePath, "utf8");

    await provider.issue({
      credentialId: "source-grant",
      capabilityKey: "source-hot-key",
      capabilities: [toolExecuteCapabilityId("pact.agentRelay.session.close")],
    });
    await expect(provider.verify({
      capabilityKey: "source-hot-key",
      requiredCapability: toolExecuteCapabilityId("pact.agentRelay.session.close"),
    })).resolves.toMatchObject({
      ok: true,
      reasonCode: "capability_key_valid",
    });

    await fs.writeFile(statePath, stalePersistedState);
    await provider.issue({
      credentialId: "relay-child-grant",
      capabilityKey: "child-hot-key",
      capabilities: [apiCapabilityId("storage.summary")],
    });

    await expect(provider.verify({
      capabilityKey: "source-hot-key",
      requiredCapability: toolExecuteCapabilityId("pact.agentRelay.session.close"),
    })).resolves.toMatchObject({
      ok: true,
      reasonCode: "capability_key_valid",
    });
    await expect(provider.verify({
      capabilityKey: "child-hot-key",
      requiredCapability: apiCapabilityId("storage.summary"),
    })).resolves.toMatchObject({
      ok: true,
      reasonCode: "capability_key_valid",
    });
    await expect(provider.describe()).resolves.toMatchObject({
      bindingCount: 2,
    });
    provider.close();
  });

  it("exports and imports encrypted recovery packages while preserving valid bindings", async () => {
    const sourceDataDir = await tempDir("pact-opaque-recovery-src-");
    const targetDataDir = await tempDir("pact-opaque-recovery-target-");
    const source = createOpaqueCapabilityKeyProvider({
      backend: "local-file",
      dataDir: sourceDataDir,
      alias: "recovery-source",
    });
    const issued = await source.issue({
      credentialId: "recoverable-credential",
      capabilityKey: "recoverable-key",
      capabilities: ["cap:api:*"],
    });
    expect(issued.capabilityKey).toBe("recoverable-key");

    await expect(source.exportRecoveryPackage({ passphrase: "" }))
      .rejects.toThrow("Capability kernel recovery export requires a passphrase.");
    const recoveryPackage = await source.exportRecoveryPackage({
      passphrase: "correct horse battery staple",
      reason: "unit recovery",
    });
    expect(recoveryPackage).toMatchObject({
      protocolVersion: "pact.capability-kernel-recovery.v1",
      alias: "recovery-source",
      kdf: {
        name: "scrypt",
        saltBase64: expect.any(String),
      },
      sealedRecovery: {
        algorithm: "aes-256-gcm",
      },
    });
    expect(JSON.stringify(recoveryPackage)).not.toContain("recoverable-key");

    const target = createOpaqueCapabilityKeyProvider({
      backend: "local-file",
      dataDir: targetDataDir,
      alias: "recovery-target",
    });
    await expect(target.importRecoveryPackage({
      recoveryPackage,
      passphrase: "wrong passphrase",
    })).rejects.toThrow();

    const imported = await target.importRecoveryPackage({
      recoveryPackage,
      passphrase: "correct horse battery staple",
    });
    expect(imported).toMatchObject({
      ok: true,
      protocolVersion: OPAQUE_CAPABILITY_KEY_PROTOCOL_VERSION,
      alias: "recovery-target",
    });
    await expect(target.verify({
      capabilityKey: "recoverable-key",
      requiredCapability: apiCapabilityId("knowledge.search"),
    })).resolves.toMatchObject({
      ok: true,
      credentialId: "recoverable-credential",
    });

    source.close();
    target.close();
  });

  it("supports runtime lookup key rotation only before bindings exist", async () => {
    const dataDir = await tempDir("pact-opaque-store-");
    const store = createSealedCapabilityKernelStore({
      backend: "local-file",
      dataDir,
      alias: "store-alias",
    });

    const first = await store.keySource.loadRuntimeLookupKey();
    expect(Buffer.from(first.runtimeLookupKeyBase64, "base64").length).toBeGreaterThanOrEqual(32);
    const rotated = await store.keySource.rotateRuntimeLookupKey();
    expect(rotated).toMatchObject({
      protocolVersion: OPAQUE_CAPABILITY_KEY_PROTOCOL_VERSION,
      alias: "store-alias",
      provider: "local-file",
    });
    const second = await store.keySource.loadRuntimeLookupKey();
    expect(second.runtimeLookupKeyBase64).not.toBe(first.runtimeLookupKeyBase64);

    await store.put({
      keyHash: "key-hash-1",
      credentialId: "credential-1",
      status: "valid",
      capabilitySetHash: "set-hash",
      capabilityCount: 1,
      grantVersion: 1,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }, ["permission-hash-1"]);

    expect(await store.hasCapability("key-hash-1", ["permission-hash-1"])).toBe(true);
    expect(await store.hasCapability("key-hash-1", [])).toBe(true);
    await expect(store.keySource.rotateRuntimeLookupKey())
      .rejects.toThrow("Runtime lookup key rotation is only allowed before capability bindings exist");

    const invalidated = await store.invalidate("key-hash-1", "unit invalidation");
    expect(invalidated).toMatchObject({
      status: "invalid",
      invalidationReason: "unit invalidation",
    });
    expect(await store.hasCapability("key-hash-1", ["permission-hash-1"])).toBe(false);
    expect(await store.list()).toEqual([]);
    expect(await store.list({ includeInvalid: true })).toHaveLength(1);

    const description = await store.describe();
    expect(description).toMatchObject({
      protocolVersion: OPAQUE_CAPABILITY_KEY_PROTOCOL_VERSION,
      alias: "store-alias",
      bindingCount: 1,
      permissionBindingCount: 1,
      runtimeLookupKeyRotationSupported: false,
    });
  });
});

describe("opaque capability key providers and helpers", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("normalizes opaque capability inputs and issues opaque, parsable secrets", () => {
    const normalized = canonicalOpaqueCapabilities([
      "  cap:api:knowledge.search  ",
      "cap:tool:pact.knowledge.health:execute",
      "cap:api:knowledge.search",
      "",
      "   ",
    ]);

    expect(normalized).toEqual([
      "cap:api:knowledge.search",
      "cap:tool:pact.knowledge.health:execute",
    ]);
    expect(createCapabilityKey()).toMatch(/^ock_[A-Za-z0-9_-]+$/);
    expect(opaqueCapabilityHash(normalized)).toBe(opaqueCapabilityHash([...normalized].reverse()));
  });

  it("exposes deterministic lookup and permission hashes and rejects short runtime keys", () => {
    expect(() => capabilityKeyHash(Buffer.alloc(16), createCapabilityKey()))
      .toThrow("Capability key lookup requires a 256-bit runtime lookup key.");
    expect(() => capabilityPermissionHash(Buffer.alloc(16), apiCapabilityId("knowledge.search")))
      .toThrow("Capability permission lookup requires a 256-bit runtime lookup key.");

    const runtimeLookupKey = Buffer.alloc(32, 4);
    const keyHash = capabilityKeyHash(runtimeLookupKey, "plain-key");
    const permissionHash = capabilityPermissionHash(runtimeLookupKey, apiCapabilityId("knowledge.search"));
    expect(keyHash).not.toEqual(permissionHash);
    expect(keyHash).toBeTypeOf("string");
    expect(permissionHash).toBeTypeOf("string");
  });

  it("rejects missing key, missing requirement, missing scopes and stale capability bindings", async () => {
    const provider = createOpaqueCapabilityKeyProvider({
      backend: "memory",
      alias: "unit-denied-branches"
    });

    const issued = await provider.issue({
      credentialId: "unit-denied-credential",
      capabilities: [
        apiCapabilityId("knowledge.search"),
        toolExecuteCapabilityId("pact.knowledge.health"),
      ],
    });

    await expect(provider.verify({ requiredCapability: apiCapabilityId("knowledge.search") }))
      .resolves.toMatchObject({ ok: false, reasonCode: "capability_key_missing" });
    await expect(provider.verify({
      capabilityKey: issued.capabilityKey,
      requiredCapabilities: [],
    })).resolves.toMatchObject({ ok: false, reasonCode: "capability_required" });
    await expect(provider.verify({
      capabilityKey: issued.capabilityKey,
      requiredCapability: apiCapabilityId("knowledge.evidence.get"),
    })).resolves.toMatchObject({
      ok: false,
      reasonCode: "missing_capabilities",
      missingCapabilities: [apiCapabilityId("knowledge.evidence.get")],
    });
    await expect(provider.verify({
      capabilityKey: issued.capabilityKey,
      requiredCapability: apiCapabilityId("knowledge.search"),
      minGrantVersion: 10,
    })).resolves.toMatchObject({ ok: false, reasonCode: "credential_grant_version_stale" });

    await provider.invalidate({
      capabilityKey: issued.capabilityKey,
      reason: "deny-test",
    });
    await expect(provider.verify({
      capabilityKey: issued.capabilityKey,
      requiredCapability: apiCapabilityId("knowledge.search"),
    })).resolves.toMatchObject({ ok: false, reasonCode: "capability_key_invalid" });
    provider.close();
  });

  it("handles expiration, rotation rejection and credential invalidation edges", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-04T00:00:00.000Z"));

    const provider = createOpaqueCapabilityKeyProvider({
      backend: "memory",
      alias: "unit-expiry-rotation"
    });
    const issued = await provider.issue({
      credentialId: "unit-expired-credential",
      capabilities: [apiCapabilityId("knowledge.search")],
      ttlMs: 1_000,
      grantVersion: 1,
    });

    await expect(provider.verify({
      capabilityKey: issued.capabilityKey,
      requiredCapability: apiCapabilityId("knowledge.search"),
    })).resolves.toMatchObject({ ok: true, reasonCode: "capability_key_valid" });

    await vi.advanceTimersByTimeAsync(1_050);
    await expect(provider.verify({
      capabilityKey: issued.capabilityKey,
      requiredCapability: apiCapabilityId("knowledge.search"),
    })).resolves.toMatchObject({ ok: false, reasonCode: "capability_key_expired" });

    await expect(provider.rotateCapabilityKey({
      capabilityKey: issued.capabilityKey,
      capabilities: [],
    })).resolves.toMatchObject({ ok: false, reasonCode: "capabilities_required_for_rotation" });

    const rotationDenied = await provider.rotateCapabilityKey({
      capabilityKey: issued.capabilityKey,
      capabilities: [apiCapabilityId("knowledge.search")],
    });
    expect(rotationDenied).toMatchObject({ ok: true, oldStatus: "invalid", status: "valid" });

    const rotatedAfterRotation = await provider.rotateCapabilityKey({
      capabilityKey: issued.capabilityKey,
      capabilities: [apiCapabilityId("knowledge.search")],
    });
    expect(rotatedAfterRotation).toMatchObject({ ok: false, reasonCode: "capability_key_invalid" });

    provider.close();
  });

  it("supports memory key binding store lifecycle operations", () => {
    const store = createMemoryCapabilityKeyBindingStore();
    store.put({
      keyHash: "store-key-1",
      credentialId: "store-credential",
      status: "valid",
      capabilitySetHash: "store-hash",
      capabilityCount: 1,
      grantVersion: 1,
      issuedAt: "2026-06-04T00:00:00.000Z",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      constraints: { workspaceId: "workspace-1", tenantId: "tenant-1" },
      metadata: { actor: "agent-1" },
    }, ["permission-a", "permission-b"]);

    expect(store.get("store-key-1")).toMatchObject({
      credentialId: "store-credential",
      keyHash: "store-key-1",
      status: "valid",
    });
    expect(store.hasCapability("store-key-1", ["permission-a"]))
      .toBe(true);
    expect(store.hasCapability("store-key-1", ["permission-c"]))
      .toBe(false);

    const updated = store.invalidate("store-key-1", "revoked");
    expect(updated).toMatchObject({ status: "invalid", invalidationReason: "revoked" });
    expect(store.hasCapability("store-key-1", ["permission-a"])).toBe(false);
    expect(store.list()).toEqual([]);
    expect(store.list({ includeInvalid: true })).toHaveLength(1);
  });
});
