import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { apiCapabilityId, toolExecuteCapabilityId } from "../../../server/platform/common/security/authorization/authorization-engine.mjs";
import {
  capabilityBindingGuardStatePath,
  createCapabilityBindingGuard
} from "../../../server/platform/common/security/authorization/capability-binding-guard.mjs";
import {
  capabilityKeyHash,
  capabilityKernelStatePath,
  capabilityPermissionHash,
  createCapabilityKey,
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

function tamperBase64(value = "") {
  if (!value) {
    return value;
  }
  const first = value[0];
  const replacement = first === "A" ? "B" : "A";
  return `${replacement}${value.slice(1)}`;
}

function withEnv(overrides, fn) {
  const previous = new Map();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [key, value] of previous.entries()) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    });
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("authorization capability deep extra coverage", () => {
  it("covers opaque capability key encoding, wildcard matching, missing claims, expiry, and rotation", async () => {
    const capabilityKey = createCapabilityKey();
    expect(capabilityKey.startsWith("ock_")).toBe(true);
    expect(Buffer.from(capabilityKey.slice(4), "base64url").length).toBe(32);

    const runtimeLookupKey = Buffer.alloc(32, 17);
    const runtimeLookupKeyBase64 = runtimeLookupKey.toString("base64");
    const apiSearchCapability = apiCapabilityId("knowledge.search");
    const toolHealthCapability = toolExecuteCapabilityId("pact.knowledge.health");

    expect(capabilityKeyHash(runtimeLookupKey, capabilityKey)).toBe(capabilityKeyHash(runtimeLookupKeyBase64, capabilityKey));
    expect(capabilityPermissionHash(runtimeLookupKey, apiSearchCapability)).toBe(
      capabilityPermissionHash(runtimeLookupKeyBase64, apiSearchCapability)
    );
    expect(capabilityKeyHash(runtimeLookupKey, capabilityKey)).not.toBe(
      capabilityPermissionHash(runtimeLookupKey, apiSearchCapability)
    );
    expect(() => capabilityKeyHash(Buffer.alloc(31), capabilityKey)).toThrow(
      "Capability key lookup requires a 256-bit runtime lookup key."
    );
    expect(() => capabilityPermissionHash(Buffer.alloc(31), apiSearchCapability)).toThrow(
      "Capability permission lookup requires a 256-bit runtime lookup key."
    );

    const provider = createMemoryOpaqueCapabilityKeyProvider({ alias: "unit-opaque-deep-memory" });

    await expect(provider.issue({
      credentialId: "opaque-empty",
      capabilities: []
    })).rejects.toThrow("Capability key binding requires at least one kernel capability.");

    const issued = await provider.issue({
      capabilityKey,
      credentialId: "opaque-deep-credential",
      capabilities: [apiSearchCapability, "cap:api:*", "cap:tool:*"],
      constraints: {
        workspaceId: "workspace-a"
      },
      metadata: {
        source: "deep-extra"
      },
      grantVersion: 2
    });

    expect(issued).toMatchObject({
      protocolVersion: OPAQUE_CAPABILITY_KEY_PROTOCOL_VERSION,
      credentialId: "opaque-deep-credential",
      capabilityKey,
      capabilityCount: 3
    });

    await expect(provider.verify({
      capabilityKey
    })).resolves.toMatchObject({
      ok: false,
      reasonCode: "capability_required"
    });

    await expect(provider.verify({
      capabilityKey,
      requiredCapability: apiCapabilityId("unknown.operation")
    })).resolves.toMatchObject({
      ok: false,
      reasonCode: "unknown_capability",
      unknownCapabilities: [apiCapabilityId("unknown.operation")]
    });

    await expect(provider.verify({
      capabilityKey,
      requiredCapabilities: [apiSearchCapability, toolHealthCapability],
      includeRecordDetails: true
    })).resolves.toMatchObject({
      ok: true,
      reasonCode: "capability_key_valid",
      credentialId: "opaque-deep-credential",
      requiredCapabilities: [apiSearchCapability, toolHealthCapability],
      capabilityCount: 3,
      grantVersion: 2,
      constraints: {
        workspaceId: "workspace-a"
      },
      metadata: {
        source: "deep-extra"
      }
    });

    await expect(provider.verify({
      capabilityKey,
      requiredCapability: toolHealthCapability
    })).resolves.toMatchObject({
      ok: true,
      reasonCode: "capability_key_valid"
    });

    await expect(provider.verify({
      capabilityKey,
      requiredCapability: apiSearchCapability,
      minGrantVersion: 3
    })).resolves.toMatchObject({
      ok: false,
      reasonCode: "credential_grant_version_stale"
    });

    const expiredKey = createCapabilityKey();
    await provider.issue({
      capabilityKey: expiredKey,
      credentialId: "opaque-expired-credential",
      capabilities: [apiSearchCapability],
      expiresAt: "2000-01-01T00:00:00.000Z"
    });
    await expect(provider.verify({
      capabilityKey: expiredKey,
      now: "2000-01-02T00:00:00.000Z",
      requiredCapability: apiSearchCapability
    })).resolves.toMatchObject({
      ok: false,
      reasonCode: "capability_key_expired",
      credentialId: "opaque-expired-credential"
    });

    const rotated = await provider.rotateCapabilityKey({
      capabilityKey,
      capabilities: [apiSearchCapability],
      reason: "unit-rotation"
    });
    expect(rotated).toMatchObject({
      ok: true,
      protocolVersion: OPAQUE_CAPABILITY_KEY_PROTOCOL_VERSION,
      oldStatus: "invalid",
      status: "valid"
    });
    expect(rotated.capabilityKey).toMatch(/^ock_/);

    await expect(provider.verify({
      capabilityKey,
      requiredCapability: apiSearchCapability
    })).resolves.toMatchObject({
      ok: false,
      reasonCode: "capability_key_invalid"
    });

    provider.close();
  });

  it("covers opaque local-file fallback, tampered recovery payloads, and sealed-state mismatch errors", async () => {
    const dataDir = await tempDir("pact-opaque-deep-data-");
    const alias = "opaque/deep extra alias";
    const targetDataDir = await tempDir("pact-opaque-deep-target-");
    const sourceEnv = {
      PACT_OPAQUE_CAPABILITY_KEY_PROVIDER: "local-file",
      PACT_OPAQUE_CAPABILITY_KEY_ALIAS: alias,
      PACT_OPAQUE_CAPABILITY_KEY_DATA_DIR: dataDir
    };

    await withEnv(sourceEnv, async () => {
      const provider = createOpaqueCapabilityKeyProvider({});
      const capabilityKey = createCapabilityKey();

      const issued = await provider.issue({
        capabilityKey,
        credentialId: "opaque-fallback-credential",
        capabilities: [apiCapabilityId("knowledge.search")]
      });

      expect(issued).toMatchObject({
        protocolVersion: OPAQUE_CAPABILITY_KEY_PROTOCOL_VERSION,
        capabilityKey
      });

      const description = await provider.describe();
      expect(description).toMatchObject({
        protocolVersion: OPAQUE_CAPABILITY_KEY_PROTOCOL_VERSION,
        provider: "local-file",
        securityMode: "degraded_file_fallback",
        alias,
        bindingCount: 1,
        permissionBindingCount: 1
      });
      expect(description.runtimeLookupLoaded).toBe(true);
      expect(description.runtimeLookupLoadCount).toBeGreaterThan(0);
      expect(description.keySource).toMatchObject({
        provider: "local-file",
        securityMode: "degraded_file_fallback"
      });

      const statePath = capabilityKernelStatePath({ dataDir, alias });
      expect(statePath).toContain("opaque_deep_extra_alias.sealed.json");
      expect(await fs.readFile(statePath, "utf8")).not.toContain(capabilityKey);

      const recoveryPackage = await provider.exportRecoveryPackage({
        passphrase: "correct horse battery staple",
        reason: "deep-extra"
      });
      const tamperedRecovery = JSON.parse(JSON.stringify(recoveryPackage));
      tamperedRecovery.sealedRecovery.ciphertextBase64 = tamperBase64(tamperedRecovery.sealedRecovery.ciphertextBase64);

      const targetProvider = createOpaqueCapabilityKeyProvider({
        backend: "local-file",
        dataDir: targetDataDir,
        alias: "opaque-target"
      });

      await expect(targetProvider.importRecoveryPackage({
        recoveryPackage: tamperedRecovery,
        passphrase: "correct horse battery staple"
      })).rejects.toThrow();

      targetProvider.close();
      provider.close();

      const onDisk = JSON.parse(await fs.readFile(statePath, "utf8"));
      onDisk.stateRoot = "tampered-state-root";
      await fs.writeFile(statePath, `${JSON.stringify(onDisk, null, 2)}\n`);

      const reopened = createOpaqueCapabilityKeyProvider({});
      await expect(reopened.describe()).rejects.toThrow("Capability kernel sealed state root mismatch.");
      reopened.close();
    });
  });

  it("covers guard allow, deny, error, audit, malformed recovery, and env fallback branches", async () => {
    const dataDir = await tempDir("pact-guard-deep-data-");
    const alias = "binding/deep extra alias";
    const env = {
      PACT_CAPABILITY_BINDING_GUARD_PROVIDER: "local-file",
      PACT_CAPABILITY_BINDING_GUARD_ALIAS: alias,
      PACT_CAPABILITY_BINDING_GUARD_DATA_DIR: dataDir
    };

    await withEnv(env, async () => {
      const guard = createCapabilityBindingGuard({});
      const capabilityKey = createCapabilityKey();

      const bound = await guard.bindCapabilityKey({
        key: capabilityKey,
        credentialId: "binding-deep-credential",
        context: {
          namespace: "tenant-a",
          userId: "user-1",
          agentId: "agent-1",
          clientId: "client-1"
        },
        ttlMs: 60_000
      });

      expect(bound).toMatchObject({
        protocolVersion: "pact.capability-binding-guard.v1",
        credentialId: "binding-deep-credential",
        bindingStrength: "user+agent+client",
        requireUser: true,
        requireAgent: true,
        requireClient: true
      });

      await expect(guard.verifyCapabilityKeyBinding({
        capabilityKey,
        credentialId: "binding-deep-credential",
        context: {
          namespace: "tenant-a",
          userId: "user-1",
          agentId: "agent-1",
          clientId: "client-1"
        }
      })).resolves.toMatchObject({
        ok: true,
        applicable: true,
        reasonCode: "capability_binding_valid",
        bindingStrength: "user+agent+client"
      });

      await expect(guard.verifyCapabilityKeyBinding({
        capabilityKey,
        credentialId: "binding-deep-credential",
        context: {
          namespace: "tenant-b",
          userId: "user-1",
          agentId: "agent-1",
          clientId: "client-1"
        }
      })).resolves.toMatchObject({
        ok: false,
        applicable: true,
        reasonCode: "binding_namespace_mismatch"
      });

      await expect(guard.verifyCapabilityKeyBinding({
        capabilityKey,
        credentialId: "binding-deep-credential",
        context: {
          namespace: "tenant-a",
          agentId: "agent-1",
          clientId: "client-1"
        }
      })).resolves.toMatchObject({
        ok: false,
        applicable: true,
        reasonCode: "binding_user_missing"
      });

      await expect(guard.verifyCapabilityKeyBinding({
        context: {
          namespace: "tenant-a"
        }
      })).resolves.toMatchObject({
        ok: false,
        reasonCode: "capability_key_missing"
      });

      await expect(guard.verifyCapabilityKeyBinding({
        capabilityKey: createCapabilityKey(),
        credentialId: "ghost-credential",
        context: {
          namespace: "tenant-a"
        }
      })).resolves.toMatchObject({
        ok: true,
        applicable: false,
        reasonCode: "capability_binding_not_registered"
      });

      const invalidated = await guard.invalidateCapabilityKeyBinding({
        capabilityKey,
        credentialId: "binding-deep-credential",
        reason: "unit invalidation"
      });
      expect(invalidated).toHaveLength(1);
      expect(invalidated[0]).toMatchObject({
        credentialId: "binding-deep-credential",
        status: "invalid",
        invalidationReason: "unit invalidation"
      });

      await expect(guard.verifyCapabilityKeyBinding({
        capabilityKey,
        credentialId: "binding-deep-credential",
        context: {
          namespace: "tenant-a",
          userId: "user-1",
          agentId: "agent-1",
          clientId: "client-1"
        }
      })).resolves.toMatchObject({
        ok: false,
        applicable: true,
        reasonCode: "binding_invalid"
      });

      await expect(guard.importRecoveryPackage({
        recoveryPackage: { protocolVersion: "broken" },
        passphrase: "correct horse battery staple"
      })).rejects.toThrow("Unsupported capability binding guard recovery package.");

      const description = await guard.describe();
      expect(description).toMatchObject({
        protocolVersion: "pact.capability-binding-guard.v1",
        provider: "local-file",
        securityMode: "degraded_file_fallback",
        alias: "binding_deep_extra_alias",
        bindingCount: 1,
        activeBindingCount: 0
      });
      expect(description.loadCount).toBeGreaterThan(0);
      expect(description.saveCount).toBeGreaterThan(0);
      expect(description.statePath).toBe(capabilityBindingGuardStatePath({ dataDir, alias }));

      const statePath = capabilityBindingGuardStatePath({ dataDir, alias });
      expect(statePath).toContain("binding_deep_extra_alias.sealed.json");
      expect(await fs.readFile(statePath, "utf8")).not.toContain(capabilityKey);

      guard.close();
    });
  });
});
