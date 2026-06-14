import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  apiCapabilityId,
  toolExecuteCapabilityId,
} from "../../../server/platform/common/security/authorization/authorization-engine.mjs";
import {
  capabilityBindingGuardStatePath,
  CAPABILITY_BINDING_GUARD_PROTOCOL_VERSION,
  createCapabilityBindingGuard,
  createMemoryCapabilityBindingGuard,
} from "../../../server/platform/common/security/authorization/capability-binding-guard.mjs";
import {
  capabilityKernelStatePath,
  createCapabilityKey,
  createMemoryCapabilityKeyBindingStore,
  createOpaqueCapabilityKeyProvider,
  createSealedCapabilityKernelStore,
  OPAQUE_CAPABILITY_KEY_PROTOCOL_VERSION,
} from "../../../server/platform/common/security/authorization/opaque-capability-key.mjs";

const tempRoots = [];

async function tempDir(prefix) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

async function writeExecutable(filePath, content) {
  await fs.writeFile(filePath, `#!/usr/bin/env node\n${content}\n`);
  await fs.chmod(filePath, 0o755);
}

function sanitizeAlias(value = "") {
  return String(value).replace(/[^a-zA-Z0-9._:-]/g, "_");
}

async function withEnv(overrides, fn) {
  const previous = new Map();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

async function withPlatform(platform, fn) {
  const descriptor = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { ...descriptor, value: platform });
  try {
    return await fn();
  } finally {
    Object.defineProperty(process, "platform", descriptor);
  }
}

function withNowDate(agoMs = 35_000) {
  return new Date(Date.now() - agoMs);
}

function createMockLookupKeySource({
  provider = "mock",
  securityMode = "mock-keyring",
  runtimeLookupKeyBase64 = Buffer.alloc(32, 17).toString("base64")
} = {}) {
  let loadCount = 0;
  let generation = 3;
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

describe("authorization capability final fourth extra coverage", () => {
  it("resolves opaque backend defaults by platform without invoking native services", async () => {
    const alias = "opaque-platform-defaults";
    const lookupKeySource = createMockLookupKeySource({
      provider: "mock-provider",
      securityMode: "mock-mode"
    });

    await withPlatform("darwin", async () => {
      const provider = createOpaqueCapabilityKeyProvider({
        backend: "auto",
        alias,
        bindingStore: createMemoryCapabilityKeyBindingStore(),
        lookupKeySource
      });

      const description = await provider.describe();
      expect(description).toMatchObject({
        provider: "macos-keychain",
        securityMode: "mock-mode",
        keySource: {
          provider: "mock-provider",
          securityMode: "mock-mode",
          runtimeLookupKeyRotationSupported: true
        }
      });
      const issued = await provider.issue({
        capabilityKey: `${alias}-key`,
        credentialId: "platform-credential",
        capabilities: [apiCapabilityId("knowledge.search")]
      });
      expect(issued).toMatchObject({
        protocolVersion: OPAQUE_CAPABILITY_KEY_PROTOCOL_VERSION,
        credentialId: "platform-credential"
      });
      provider.close();
    });

    await withPlatform("win32", async () => {
      const winProvider = createOpaqueCapabilityKeyProvider({
        backend: "auto",
        alias: `${alias}-win32`,
        bindingStore: createMemoryCapabilityKeyBindingStore(),
        lookupKeySource
      });
      const winDescription = await winProvider.describe();
      expect(winDescription).toMatchObject({
        provider: "local-file",
        securityMode: "mock-mode"
      });
      winProvider.close();

      const guard = createCapabilityBindingGuard({
        backend: "auto",
        alias: `${alias}-win32-guard`
      });
      const guardDescription = await guard.describe();
      expect(guardDescription).toMatchObject({
        provider: "local-file",
        securityMode: "degraded_file_fallback"
      });
      guard.close();
    });
  });

  it("selects the local-file opaque backend on linux and preserves revoke/list/describe behavior", async () => {
    const alias = "opaque-linux-local-file";
    const lookupKeySource = createMockLookupKeySource({
      provider: "mock-linux-provider",
      securityMode: "mock-linux-mode"
    });

    await withPlatform("linux", async () => withEnv({ PATH: "" }, async () => {
      const provider = createOpaqueCapabilityKeyProvider({
        backend: "auto",
        alias,
        bindingStore: createMemoryCapabilityKeyBindingStore(),
        lookupKeySource
      });

      const initialDescription = await provider.describe();
      expect(initialDescription).toMatchObject({
        protocolVersion: OPAQUE_CAPABILITY_KEY_PROTOCOL_VERSION,
        provider: "local-file",
        securityMode: "mock-linux-mode",
        alias,
        bindingCount: 0,
        permissionBindingCount: 0,
        linuxDetectedBackends: ["local-file"],
        keySource: {
          provider: "mock-linux-provider",
          securityMode: "mock-linux-mode"
        }
      });

      const issued = await provider.issue({
        capabilityKey: "opaque-linux-key",
        credentialId: "opaque-linux-credential",
        capabilities: [apiCapabilityId("knowledge.search")]
      });
      expect(issued).toMatchObject({
        protocolVersion: OPAQUE_CAPABILITY_KEY_PROTOCOL_VERSION,
        credentialId: "opaque-linux-credential",
        capabilityKey: "opaque-linux-key"
      });

      await expect(provider.verify({
        capabilityKey: "opaque-linux-key",
        requiredCapability: apiCapabilityId("knowledge.search"),
        includeRecordDetails: true
      })).resolves.toMatchObject({
        ok: true,
        reasonCode: "capability_key_valid",
        credentialId: "opaque-linux-credential",
        capabilityCount: 1
      });

      const revoked = await provider.invalidate({
        capabilityKey: "opaque-linux-key",
        reason: "revoked"
      });
      expect(revoked).toMatchObject({
        status: "invalid",
        invalidationReason: "revoked"
      });
      expect(await provider.invalidateCredential({
        credentialId: "opaque-linux-credential",
        reason: "redundant"
      })).toEqual([]);
      expect(await provider.store.list()).toEqual([]);
      expect(await provider.store.list({ includeInvalid: true })).toHaveLength(1);

      const finalDescription = await provider.describe();
      expect(finalDescription).toMatchObject({
        provider: "local-file",
        securityMode: "mock-linux-mode",
        bindingCount: 1,
        runtimeLookupLoaded: true
      });
      provider.close();
    }));
  });

  it("covers sealed kernel local-file fallback and record lifecycle on linux", async () => {
    const dataDir = await tempDir("pact-final-fourth-sealed-linux-");
    const alias = "sealed/linux local-file";

    await withPlatform("linux", async () => withEnv({ PATH: "" }, async () => {
      const store = createSealedCapabilityKernelStore({
        backend: "auto",
        dataDir,
        alias
      });

      const initialDescription = await store.describe();
      expect(initialDescription).toMatchObject({
        protocolVersion: OPAQUE_CAPABILITY_KEY_PROTOCOL_VERSION,
        provider: "local-file",
        securityMode: "degraded_file_fallback",
        alias: "sealed_linux_local-file",
        stateRoot: expect.any(String),
        bindingCount: 0,
        permissionBindingCount: 0,
        runtimeLookupKeyRotationSupported: true
      });

      const first = await store.keySource.loadRuntimeLookupKey();
      expect(first).toMatchObject({
        protocolVersion: OPAQUE_CAPABILITY_KEY_PROTOCOL_VERSION,
        provider: "local-file",
        securityMode: "degraded_file_fallback"
      });
      expect(Buffer.from(first.runtimeLookupKeyBase64, "base64").length).toBeGreaterThanOrEqual(32);

      const rotated = await store.keySource.rotateRuntimeLookupKey();
      expect(rotated).toMatchObject({
        protocolVersion: OPAQUE_CAPABILITY_KEY_PROTOCOL_VERSION,
        provider: "local-file"
      });

      const second = await store.keySource.loadRuntimeLookupKey();
      expect(second.runtimeLookupKeyBase64).not.toBe(first.runtimeLookupKeyBase64);

      await store.put({
        keyHash: "sealed-key-hash-1",
        credentialId: "sealed-credential-1",
        status: "valid",
        capabilitySetHash: "sealed-capability-set-hash",
        capabilityCount: 1,
        grantVersion: 1,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }, ["sealed-permission-1"]);
      expect(await store.hasCapability("sealed-key-hash-1", ["sealed-permission-1"])).toBe(true);
      expect(await store.list()).toHaveLength(1);
      expect(await store.list({ includeInvalid: true })).toHaveLength(1);

      const invalidated = await store.invalidate("sealed-key-hash-1", "revoked");
      expect(invalidated).toMatchObject({
        status: "invalid",
        invalidationReason: "revoked"
      });
      expect(await store.hasCapability("sealed-key-hash-1", ["sealed-permission-1"])).toBe(false);
      expect(await store.list()).toEqual([]);
      expect(await store.list({ includeInvalid: true })).toHaveLength(1);

      const finalDescription = await store.describe();
      expect(finalDescription).toMatchObject({
        provider: "local-file",
        securityMode: "degraded_file_fallback",
        bindingCount: 1,
        permissionBindingCount: 1,
        runtimeLookupKeyRotationSupported: false
      });
      store.close();
    }));
  });

  it("rejects damaged opaque sealed state and restores guard recovery snapshots after invalidation", async () => {
    const dataDir = await tempDir("pact-final-fourth-damaged-");
    const opaqueAlias = "opaque/damaged-record";
    const opaqueProvider = createOpaqueCapabilityKeyProvider({
      backend: "local-file",
      dataDir,
      alias: opaqueAlias
    });
    const issued = await opaqueProvider.issue({
      credentialId: "opaque-damaged-credential",
      capabilityKey: "opaque-damaged-key",
      capabilities: [apiCapabilityId("knowledge.search")]
    });
    expect(issued).toMatchObject({
      protocolVersion: OPAQUE_CAPABILITY_KEY_PROTOCOL_VERSION,
      credentialId: "opaque-damaged-credential"
    });
    opaqueProvider.close();

    const opaqueStatePath = capabilityKernelStatePath({ dataDir, alias: opaqueAlias });
    const damagedState = JSON.parse(await fs.readFile(opaqueStatePath, "utf8"));
    damagedState.sealedState.algorithm = "unsupported";
    await fs.writeFile(opaqueStatePath, `${JSON.stringify(damagedState, null, 2)}\n`);

    const reopenedOpaqueProvider = createOpaqueCapabilityKeyProvider({
      backend: "local-file",
      dataDir,
      alias: opaqueAlias
    });
    await expect(reopenedOpaqueProvider.describe()).rejects.toThrow(
      "Unsupported capability kernel sealed state payload."
    );
    reopenedOpaqueProvider.close();

    const sourceGuard = createMemoryCapabilityBindingGuard({ alias: "binding/recovery-source" });
    const capabilityKey = createCapabilityKey();
    await sourceGuard.bindCapabilityKey({
      key: capabilityKey,
      credentialId: "binding-recovery-credential",
      context: {
        namespace: "tool-management",
        userId: "binding-user"
      }
    });

    const recoveryPackage = await sourceGuard.exportRecoveryPackage({
      passphrase: "correct horse battery staple",
      reason: "snapshot before revoke"
    });

    const invalidated = await sourceGuard.invalidateCapabilityKeyBinding({
      capabilityKey,
      credentialId: "binding-recovery-credential",
      reason: "revoked"
    });
    expect(invalidated).toHaveLength(1);
    expect(invalidated[0]).toMatchObject({
      credentialId: "binding-recovery-credential",
      status: "invalid",
      invalidationReason: "revoked"
    });
    expect(await sourceGuard.invalidateCapabilityKeyBinding({
      credentialId: "binding-recovery-credential",
      reason: "revoked again"
    })).toEqual([]);
    await expect(sourceGuard.verifyCapabilityKeyBinding({
      capabilityKey,
      credentialId: "binding-recovery-credential",
      context: {
        namespace: "tool-management",
        userId: "binding-user"
      }
    })).resolves.toMatchObject({
      ok: false,
      applicable: true,
      reasonCode: "binding_invalid"
    });

    const targetGuard = createMemoryCapabilityBindingGuard({ alias: "binding/recovery-target" });
    await expect(targetGuard.importRecoveryPackage({
      recoveryPackage,
      passphrase: "correct horse battery staple"
    })).resolves.toMatchObject({
      ok: true,
      protocolVersion: CAPABILITY_BINDING_GUARD_PROTOCOL_VERSION,
      provider: "memory",
      securityMode: "memory"
    });

    await expect(targetGuard.verifyCapabilityKeyBinding({
      capabilityKey,
      credentialId: "binding-recovery-credential",
      context: {
        namespace: "tool-management",
        userId: "binding-user"
      }
    })).resolves.toMatchObject({
      ok: true,
      applicable: true,
      reasonCode: "capability_binding_valid",
      credentialId: "binding-recovery-credential"
    });

    expect(await targetGuard.describe()).toMatchObject({
      provider: "memory",
      securityMode: "memory",
      bindingCount: 1,
      activeBindingCount: 1,
      statePath: ""
    });
    sourceGuard.close();
    targetGuard.close();
  });

  it("falls back to local-file for opaque keys when linux native pass backend write fails", async () => {
    const dataDir = await tempDir("pact-final-fourth-pass-fallback-");
    const binDir = await tempDir("pact-final-fourth-pass-bin-");
    const alias = "opaque/final fourth pass fallback";
    const statePath = capabilityKernelStatePath({ dataDir, alias });
    const passStatePath = path.join(binDir, "native-pass-state");

    await writeExecutable(path.join(binDir, "pass"), `
const fs = require("node:fs");
const stateFile = process.env.FAKE_PASS_STATE_FILE;
const args = process.argv.slice(2);
if (args[0] === "show") {
  if (fs.existsSync(stateFile)) {
    process.stdout.write(fs.readFileSync(stateFile, "utf8"));
    process.exit(0);
  }
  console.error("not in the password store");
  process.exit(1);
}
if (args[0] === "insert") {
  console.error("pass write unavailable");
  process.exit(1);
}
`);

    await withPlatform("linux", async () => withEnv({
      PATH: `${binDir}`,
      FAKE_PASS_STATE_FILE: passStatePath
    }, async () => {
      const provider = createOpaqueCapabilityKeyProvider({
        backend: "auto",
        dataDir,
        alias
      });

      const issued = await provider.issue({
        credentialId: "opaque-pass-fallback",
        capabilities: [apiCapabilityId("knowledge.search")],
        context: {
          namespace: "tool-management"
        }
      });
      expect(issued.credentialId).toBe("opaque-pass-fallback");

      const description = await provider.describe();
      expect(description).toMatchObject({
        securityMode: "degraded_file_fallback",
        bindingCount: 1,
        permissionBindingCount: 1
      });
      expect(description.provider).toBe("pass-gpg");
      const storedState = JSON.parse(await fs.readFile(statePath, "utf8"));
      expect(storedState).toMatchObject({
        provider: "local-file",
        securityMode: "degraded_file_fallback"
      });
      await expect(fs.access(statePath)).resolves.toBeUndefined();
      await expect(fs.access(passStatePath)).rejects.toThrow();

      await expect(provider.verify({
        capabilityKey: issued.capabilityKey,
        requiredCapability: toolExecuteCapabilityId("pact.agentLibrary.health")
      })).resolves.toMatchObject({
        ok: false,
        reasonCode: "missing_capabilities"
      });

      await expect(provider.verify({
        capabilityKey: issued.capabilityKey,
        requiredCapability: apiCapabilityId("knowledge.search")
      })).resolves.toMatchObject({
        ok: true,
        reasonCode: "capability_key_valid"
      });

      provider.close();
    }));
  });

  it("raises on malformed local state for both opaque key and guard stores", async () => {
    const dataDir = await tempDir("pact-final-fourth-malformed-");
    const opaqueAlias = "opaque-malformed-state";
    const guardAlias = "binding-malformed-state";

    const opaqueProvider = createOpaqueCapabilityKeyProvider({
      backend: "local-file",
      dataDir,
      alias: opaqueAlias
    });
    const issued = await opaqueProvider.issue({
      credentialId: "opaque-malformed",
      capabilities: [apiCapabilityId("knowledge.search")]
    });
    opaqueProvider.close();
    expect(issued).toMatchObject({
      protocolVersion: OPAQUE_CAPABILITY_KEY_PROTOCOL_VERSION,
      credentialId: "opaque-malformed"
    });

    const opaqueStatePath = capabilityKernelStatePath({ dataDir, alias: opaqueAlias });
    await fs.writeFile(opaqueStatePath, "{broken json");
    const reopenOpaque = createOpaqueCapabilityKeyProvider({
      backend: "local-file",
      dataDir,
      alias: opaqueAlias
    });
    await expect(reopenOpaque.verify({
      capabilityKey: issued.capabilityKey,
      requiredCapability: apiCapabilityId("knowledge.search")
    })).rejects.toThrow();
    reopenOpaque.close();

    const guard = createCapabilityBindingGuard({
      backend: "local-file",
      dataDir,
      alias: guardAlias
    });
    const boundKey = createCapabilityKey();
    await guard.bindCapabilityKey({
      key: boundKey,
      credentialId: "binding-malformed",
      context: {
        namespace: "tool-management",
        userId: "guard-user"
      }
    });
    guard.close();

    const guardPath = capabilityBindingGuardStatePath({ dataDir, alias: guardAlias });
    await fs.writeFile(guardPath, "{broken json");
    const reopenGuard = createCapabilityBindingGuard({
      backend: "local-file",
      dataDir,
      alias: guardAlias
    });
    await expect(reopenGuard.verifyCapabilityKeyBinding({
      capabilityKey: boundKey,
      credentialId: "binding-malformed",
      context: {
        namespace: "tool-management",
        userId: "guard-user"
      }
    })).rejects.toThrow();
    reopenGuard.close();
  });

  it("recovers from stale binding guard lock file and continues writing bindings", async () => {
    const dataDir = await tempDir("pact-final-fourth-guard-lock-");
    const alias = "binding/fourth stale lock";
    const firstCredential = "guard-stale-lock-initial";
    const firstKey = createCapabilityKey();
    const firstGuard = createCapabilityBindingGuard({
      backend: "local-file",
      dataDir,
      alias
    });

    await firstGuard.bindCapabilityKey({
      key: firstKey,
      credentialId: firstCredential,
      context: {
        namespace: "tool-management",
        userId: "first-user"
      }
    });
    firstGuard.close();

    const lockPath = path.join(dataDir, "security", "locks", `capability-binding-guard-${sanitizeAlias(alias)}.lock`);
    await fs.mkdir(path.dirname(lockPath), { recursive: true });
    await fs.writeFile(lockPath, "stale-lock");
    const staleDate = withNowDate(45_000);
    await fs.utimes(lockPath, staleDate, staleDate);

    const reopened = createCapabilityBindingGuard({
      backend: "local-file",
      dataDir,
      alias
    });
    const secondKey = createCapabilityKey();
    const second = await reopened.bindCapabilityKey({
      key: secondKey,
      credentialId: "guard-stale-lock-next",
      context: {
        namespace: "tool-management",
        userId: "second-user"
      }
    });
    expect(second.credentialId).toBe("guard-stale-lock-next");

    const secondDecision = await reopened.verifyCapabilityKeyBinding({
      capabilityKey: firstKey,
      credentialId: firstCredential,
      context: {
        namespace: "tool-management",
        userId: "first-user"
      }
    });
    expect(secondDecision).toMatchObject({
      ok: true,
      applicable: true,
      reasonCode: "capability_binding_valid",
      credentialId: firstCredential
    });

    await expect(fs.access(lockPath)).rejects.toThrow();
    reopened.close();
  });

  it("restores a degraded local-file binding guard from recovery package", async () => {
    const dataDir = await tempDir("pact-final-fourth-recovery-src-");
    const binDir = await tempDir("pact-final-fourth-recovery-pass-bin-");
    const alias = "binding/recovery-source";
    const key = createCapabilityKey();
    const passStatePath = path.join(binDir, "pass-state");

    await writeExecutable(path.join(binDir, "pass"), `
const fs = require("node:fs");
const stateFile = process.env.FAKE_PASS_STATE_FILE;
const args = process.argv.slice(2);
if (args[0] === "show") {
  if (fs.existsSync(stateFile)) {
    process.stdout.write(fs.readFileSync(stateFile, "utf8"));
    process.exit(0);
  }
  console.error("not in the password store");
  process.exit(1);
}
if (args[0] === "insert") {
  console.error("pass write failure");
  process.exit(1);
}
`);

    const recoveryPackage = await withPlatform("linux", async () => withEnv({
      PATH: `${binDir}`,
      FAKE_PASS_STATE_FILE: passStatePath
    }, async () => {
      const degraded = createCapabilityBindingGuard({
        backend: "auto",
        dataDir,
        alias
      });
      await degraded.bindCapabilityKey({
        key,
        credentialId: "binding-recovery-credential",
        context: {
          namespace: "tenant-a",
          userId: "recovery-user",
          agentId: "recovery-agent"
        }
      });
      const exported = await degraded.exportRecoveryPackage({
        passphrase: "correct horse battery staple",
        reason: "guard-recovery"
      });
      degraded.close();
      return exported;
    }));

    const imported = createCapabilityBindingGuard({
      backend: "auto",
      dataDir: await tempDir("pact-final-fourth-recovery-target-"),
      alias: "binding/recovery-target"
    });

    const importedResult = await imported.importRecoveryPackage({
      recoveryPackage,
      passphrase: "correct horse battery staple"
    });
    expect(importedResult).toMatchObject({
      ok: true,
      protocolVersion: CAPABILITY_BINDING_GUARD_PROTOCOL_VERSION,
    });

    await expect(imported.verifyCapabilityKeyBinding({
      capabilityKey: key,
      credentialId: "binding-recovery-credential",
      context: {
        namespace: "tenant-a",
        userId: "recovery-user",
        agentId: "recovery-agent"
      }
    })).resolves.toMatchObject({
      ok: true,
      applicable: true,
      reasonCode: "capability_binding_valid",
      credentialId: "binding-recovery-credential"
    });

    imported.close();
  });

  it("returns explicit native DPAPI errors for missing powershell on win32", async () => {
    const dataDir = await tempDir("pact-final-fourth-win32-dpapi-");
    const alias = "win32/dpapi-missing";
    const key = createCapabilityKey();

    await withPlatform("win32", async () => withEnv({ PATH: "" }, async () => {
      const opaque = createOpaqueCapabilityKeyProvider({
        backend: "windows-dpapi",
        dataDir,
        alias: `${alias}-opaque`
      });
      await expect(opaque.issue({
        credentialId: "opaque-dpapi",
        capabilities: [apiCapabilityId("knowledge.search")]
      })).rejects.toThrow("Windows DPAPI backend requires powershell.exe or pwsh.");
      opaque.close();

      const guard = createCapabilityBindingGuard({
        backend: "windows-dpapi",
        dataDir,
        alias: `${alias}-guard`
      });
      await expect(guard.bindCapabilityKey({
        key,
        credentialId: "binding-dpapi",
        context: {
          namespace: "tool-management",
          userId: "dpapi-user"
        }
      })).rejects.toThrow("Windows DPAPI backend requires powershell.exe or pwsh.");
      guard.close();
    }));
  });
});
