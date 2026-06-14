import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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
  createCapabilityKey,
  createMemoryCapabilityKeyBindingStore,
  createOpaqueCapabilityKeyProvider,
  OPAQUE_CAPABILITY_KEY_PROTOCOL_VERSION
} from "../../../server/platform/common/security/authorization/opaque-capability-key.mjs";
import { apiCapabilityId, toolExecuteCapabilityId } from "../../../server/platform/common/security/authorization/authorization-engine.mjs";

const tempRoots = [];

async function tempDir(prefix) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

async function makeExecutable(dir, name) {
  const filePath = path.join(dir, name);
  await fs.writeFile(filePath, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  await fs.chmod(filePath, 0o755);
  return filePath;
}

function setPlatform(value) {
  const descriptor = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", {
    value,
    configurable: true
  });
  return () => {
    if (descriptor) {
      Object.defineProperty(process, "platform", descriptor);
    }
  };
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("authorization capability focused extras", () => {
  it("covers opaque wildcard matching, describe fallback, and tampered recovery import", async () => {
    const lookupKeySource = {
      async loadRuntimeLookupKey() {
        return {
          protocolVersion: OPAQUE_CAPABILITY_KEY_PROTOCOL_VERSION,
          provider: "memory",
          generation: 7,
          runtimeLookupKeyBase64: Buffer.alloc(32, 11).toString("base64")
        };
      },
      async rotateRuntimeLookupKey() {
        return {
          protocolVersion: OPAQUE_CAPABILITY_KEY_PROTOCOL_VERSION,
          provider: "memory",
          generation: 8
        };
      }
    };
    const provider = createOpaqueCapabilityKeyProvider({
      backend: "memory",
      alias: "focused opaque alias",
      lookupKeySource,
      bindingStore: createMemoryCapabilityKeyBindingStore()
    });

    const issued = await provider.issue({
      key: "opaque-focused-key",
      credentialId: "focused-credential",
      capabilities: ["cap:tool:*"],
      ttlMs: 5_000
    });
    expect(issued).toMatchObject({
      protocolVersion: OPAQUE_CAPABILITY_KEY_PROTOCOL_VERSION,
      capabilityKey: "opaque-focused-key",
      credentialId: "focused-credential"
    });

    const toolDecision = await provider.verify({
      capabilityKey: "opaque-focused-key",
      requiredCapability: toolExecuteCapabilityId("pact.agentLibrary.health")
    });
    expect(toolDecision).toMatchObject({
      ok: true,
      reasonCode: "capability_key_valid",
      credentialId: "focused-credential"
    });

    const detailed = await provider.verify({
      capabilityKey: "opaque-focused-key",
      requiredCapabilities: [toolExecuteCapabilityId("pact.agentLibrary.health")],
      includeRecordDetails: true
    });
    expect(detailed).toMatchObject({
      ok: true,
      keyHash: expect.any(String),
      capabilityCount: 1,
      capabilitySetHash: expect.any(String),
      grantVersion: 1
    });

    await expect(provider.invalidateCredential({ credentialId: "" })).resolves.toEqual([]);
    await expect(provider.invalidate({ capabilityKey: "" })).resolves.toBeNull();

    const described = await provider.describe();
    expect(described).toMatchObject({
      protocolVersion: OPAQUE_CAPABILITY_KEY_PROTOCOL_VERSION,
      provider: "memory",
      alias: "focused opaque alias",
      keySource: {
        provider: "memory",
        securityMode: "",
        runtimeLookupKeyRotationSupported: false
      }
    });
    expect(described.bindingCount).toBe(1);

    provider.close();
  });

  it("exports and rejects tampered opaque recovery packages from a local-file provider", async () => {
    const dataDir = await tempDir("pact-opaque-recovery-");
    const source = createOpaqueCapabilityKeyProvider({
      backend: "local-file",
      dataDir,
      alias: "opaque recovery source"
    });

    await source.issue({
      capabilityKey: "opaque-recovery-key",
      credentialId: "opaque-recovery-credential",
      capabilities: [apiCapabilityId("knowledge.search")]
    });

    const recoveryPackage = await source.exportRecoveryPackage({
      passphrase: "correct horse battery staple",
      reason: "focused recovery"
    });
    expect(recoveryPackage).toMatchObject({
      protocolVersion: "v0.0.1:risk-control:capability-kernel-recovery-1",
      alias: "opaque_recovery_source"
    });

    const target = createOpaqueCapabilityKeyProvider({
      backend: "local-file",
      dataDir: await tempDir("pact-opaque-recovery-target-"),
      alias: "opaque recovery target"
    });

    await expect(target.importRecoveryPackage({
      recoveryPackage: {
        ...recoveryPackage,
        sealedRecovery: {
          ...recoveryPackage.sealedRecovery,
          algorithm: "bogus"
        }
      },
      passphrase: "correct horse battery staple"
    })).rejects.toThrow("Unsupported capability kernel sealed state payload.");

    const imported = await target.importRecoveryPackage({
      recoveryPackage,
      passphrase: "correct horse battery staple"
    });
    expect(imported).toMatchObject({
      ok: true,
      provider: "local-file",
      securityMode: "degraded_file_fallback"
    });
    expect(await target.verify({
      capabilityKey: "opaque-recovery-key",
      requiredCapability: apiCapabilityId("knowledge.search")
    })).toMatchObject({
      ok: true,
      reasonCode: "capability_key_valid",
      credentialId: "opaque-recovery-credential"
    });

    source.close();
    target.close();
  });

  it("resolves opaque kernel auto backend on win32 and reports windows-dpapi support", async () => {
    const dataDir = await tempDir("pact-opaque-win32-");
    const binDir = await tempDir("pact-opaque-win32-bin-");
    await makeExecutable(binDir, "powershell.exe");

    const restorePlatform = setPlatform("win32");
    const restorePath = process.env.PATH;
    process.env.PATH = `${binDir}${path.delimiter}${restorePath || ""}`;

    try {
      const provider = createOpaqueCapabilityKeyProvider({
        backend: "auto",
        dataDir,
        alias: "opaque win32 auto"
      });

      const description = await provider.describe();
      expect(description).toMatchObject({
        provider: "windows-dpapi",
        securityMode: "dpapi",
        alias: "opaque win32 auto"
      });
      expect(description.bindingCount).toBe(0);
      expect(description.keySource.provider).toBe("windows-dpapi");
      expect(description.keySource.runtimeLookupKeyRotationSupported).toBe(true);
      expect(capabilityKernelStatePath({ dataDir, alias: "opaque win32 auto" })).toContain("opaque_win32_auto");
    } finally {
      process.env.PATH = restorePath;
      restorePlatform();
    }
  });

  it("normalizes binding aliases, imports recovery packages, and uses win32 auto fallback paths", async () => {
    expect(normalizeCapabilityBindingContext(null)).toMatchObject({
      namespace: "tool-management",
      userId: "",
      agentId: "",
      clientId: ""
    });
    expect(normalizeCapabilityBindingContext({
      subject_id: "subject-user",
      profile_id: "agent-profile",
      client_name: "client-name",
      binding_namespace: "tenant-a"
    })).toMatchObject({
      namespace: "tenant-a",
      userId: "subject-user",
      agentId: "agent-profile",
      clientId: "client-name"
    });

    const runtimeLookupKey = Buffer.alloc(32, 5);
    expect(capabilityBindingKeyHash(runtimeLookupKey, "binding-key")).toBe(
      capabilityBindingKeyHash(runtimeLookupKey.toString("base64"), "binding-key")
    );
    expect(capabilityBindingSubjectHash(runtimeLookupKey, "user", "subject-user")).toBe(
      capabilityBindingSubjectHash(runtimeLookupKey.toString("base64"), "user", "subject-user")
    );

    const dataDir = await tempDir("pact-binding-win32-");
    const binDir = await tempDir("pact-binding-win32-bin-");
    await makeExecutable(binDir, "powershell.exe");

    const restorePlatform = setPlatform("win32");
    const restorePath = process.env.PATH;
    process.env.PATH = `${binDir}${path.delimiter}${restorePath || ""}`;

    try {
      const sourceGuard = createMemoryCapabilityBindingGuard({ alias: "binding recovery source" });
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
        passphrase: "binding passphrase",
        reason: "focused binding recovery"
      });

      const targetGuard = createCapabilityBindingGuard({
        backend: "auto",
        dataDir,
        alias: "binding recovery target"
      });

      await expect(targetGuard.importRecoveryPackage({
        recoveryPackage: {
          ...recoveryPackage,
          sealedRecovery: {
            ...recoveryPackage.sealedRecovery,
            algorithm: "bogus"
          }
        },
        passphrase: "binding passphrase"
      })).rejects.toThrow("Unsupported capability binding guard sealed state payload.");

      const imported = await targetGuard.importRecoveryPackage({
        recoveryPackage,
        passphrase: "binding passphrase"
      });
      expect(imported).toMatchObject({
        ok: true,
        provider: "local-file",
        securityMode: "degraded_file_fallback"
      });

      const description = await targetGuard.describe();
      expect(description).toMatchObject({
        provider: "local-file",
        securityMode: "degraded_file_fallback",
        alias: "binding_recovery_target"
      });
      expect(description.statePath).toBe(capabilityBindingGuardStatePath({
        dataDir,
        alias: "binding recovery target"
      }));

      const verification = await targetGuard.verifyCapabilityKeyBinding({
        capabilityKey,
        credentialId: "binding-recovery-credential",
        context: {
          namespace: "tool-management",
          userId: "binding-user"
        }
      });
      expect(verification).toMatchObject({
        ok: true,
        applicable: true,
        credentialId: "binding-recovery-credential"
      });
      expect(capabilityBindingGuardStatePath({
        dataDir,
        alias: "binding recovery target"
      })).toContain("binding_recovery_target");
    } finally {
      process.env.PATH = restorePath;
      restorePlatform();
    }
  });

  it("keeps opaque and binding hash helpers deterministic across buffer and base64 inputs", () => {
    const lookupKey = Buffer.alloc(32, 17);
    const opaqueCapability = apiCapabilityId("knowledge.search");
    const capabilityKey = createCapabilityKey();

    expect(capabilityKeyHash(lookupKey, capabilityKey)).toBe(
      capabilityKeyHash(lookupKey.toString("base64"), capabilityKey)
    );
    expect(capabilityPermissionHash(lookupKey, opaqueCapability)).toBe(
      capabilityPermissionHash(lookupKey.toString("base64"), opaqueCapability)
    );
    expect(capabilityBindingKeyHash(lookupKey, capabilityKey)).toBeTruthy();
    expect(capabilityBindingSubjectHash(lookupKey, "namespace", "tool-management")).toBeTruthy();
  });
});
