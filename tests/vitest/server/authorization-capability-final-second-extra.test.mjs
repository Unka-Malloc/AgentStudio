import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  apiCapabilityId
} from "../../../server/platform/common/security/authorization/authorization-engine.mjs";
import {
  createCapabilityBindingGuard,
  createMemoryCapabilityBindingGuard
} from "../../../server/platform/common/security/authorization/capability-binding-guard.mjs";
import {
  createCapabilityKey,
  createOpaqueCapabilityKeyProvider
} from "../../../server/platform/common/security/authorization/opaque-capability-key.mjs";

const tempRoots = [];

vi.setConfig({ testTimeout: 30_000 });

async function tempDir(prefix) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

async function writeExecutable(filePath, content) {
  await fs.writeFile(filePath, `#!/usr/bin/env node\n${content}\n`);
  await fs.chmod(filePath, 0o755);
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

function fakeLookupKeySource({
  runtimeLookupKeyBase64 = Buffer.alloc(32, 17).toString("base64"),
  provider = "mock",
  securityMode = "mock-keyring",
  linuxDetectedBackends = ["local-file"]
} = {}) {
  let generation = 3;
  let loadCount = 0;
  return {
    async loadRuntimeLookupKey() {
      loadCount += 1;
      return {
        protocolVersion: "pact.opaque-capability-key.v1",
        provider,
        securityMode,
        generation,
        runtimeLookupKeyBase64
      };
    },
    async rotateRuntimeLookupKey() {
      generation += 1;
      return {
        protocolVersion: "pact.opaque-capability-key.v1",
        provider,
        generation
      };
    },
    describe() {
      return {
        protocolVersion: "pact.opaque-capability-key.v1",
        provider,
        securityMode,
        generation,
        loadCount,
        runtimeLookupKeyRotationSupported: true,
        permissionBindingCount: 0,
        stateRoot: "mock-state-root",
        linuxDetectedBackends
      };
    }
  };
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("authorization capability final second extra coverage", () => {
  it("rejects malformed opaque runtime keys and unsupported recovery helpers", async () => {
    const provider = createOpaqueCapabilityKeyProvider({
      backend: "memory",
      alias: "final-second-malformed",
      lookupKeySource: fakeLookupKeySource({
        runtimeLookupKeyBase64: Buffer.alloc(31, 7).toString("base64"),
        provider: "bad",
        securityMode: "broken"
      })
    });

    await expect(provider.issue({
      capabilityKey: "opaque-malformed-key",
      capabilities: [apiCapabilityId("knowledge.search")]
    })).rejects.toThrow("Runtime lookup key helper returned an invalid key.");

    await expect(provider.verify({
      capabilityKey: "opaque-malformed-key",
      requiredCapability: apiCapabilityId("knowledge.search")
    })).rejects.toThrow("Capability key lookup requires a 256-bit runtime lookup key.");

    await expect(provider.exportRecoveryPackage({
      passphrase: "correct horse battery staple"
    })).rejects.toThrow("Capability key provider backend does not support recovery export.");

    await expect(provider.importRecoveryPackage({
      recoveryPackage: { protocolVersion: "broken" },
      passphrase: "correct horse battery staple"
    })).rejects.toThrow("Capability key provider backend does not support recovery import.");

    provider.close();
  });

  it("covers in-memory binding guard client boundaries, expiry, invalidation, and empty-passphrase recovery", async () => {
    const guard = createMemoryCapabilityBindingGuard({ alias: "final-second-guard-memory" });
    const capabilityKey = createCapabilityKey();

    await expect(guard.bindCapabilityKey({
      credentialId: "missing-key-credential"
    })).rejects.toThrow("Capability binding guard requires an opaque capability key.");

    await guard.bindCapabilityKey({
      key: capabilityKey,
      credentialId: "binding-credential",
      context: {
        namespace: "tool-management",
        userId: "user-1",
        agentId: "agent-1",
        clientId: "client-1"
      },
      expiresAt: "2099-12-31T23:59:59.000Z"
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
      ok: false,
      applicable: true,
      reasonCode: "binding_client_missing"
    });

    await expect(guard.verifyCapabilityKeyBinding({
      capabilityKey,
      credentialId: "binding-credential",
      context: {
        namespace: "tool-management",
        userId: "user-1",
        agentId: "agent-1",
        clientId: "client-2"
      }
    })).resolves.toMatchObject({
      ok: false,
      applicable: true,
      reasonCode: "binding_client_mismatch"
    });

    await expect(guard.verifyCapabilityKeyBinding({
      capabilityKey,
      credentialId: "binding-credential",
      context: {
        namespace: "tool-management",
        userId: "user-1",
        agentId: "agent-2",
        clientId: "client-1"
      }
    })).resolves.toMatchObject({
      ok: false,
      applicable: true,
      reasonCode: "binding_agent_mismatch"
    });

    const expiredKey = createCapabilityKey();
    await guard.bindCapabilityKey({
      key: expiredKey,
      credentialId: "expired-credential",
      context: {
        namespace: "tool-management"
      },
      expiresAt: "2000-01-01T00:00:00.000Z"
    });

    await expect(guard.verifyCapabilityKeyBinding({
      capabilityKey: expiredKey,
      credentialId: "expired-credential",
      now: "2000-01-02T00:00:00.000Z",
      context: {
        namespace: "tool-management"
      }
    })).resolves.toMatchObject({
      ok: false,
      applicable: true,
      reasonCode: "binding_expired"
    });

    expect(await guard.invalidateCapabilityKeyBinding({
      credentialId: "binding-credential",
      reason: "manual review"
    })).toHaveLength(1);

    expect(await guard.invalidateCapabilityKeyBinding({
      credentialId: "",
      reason: "no-op"
    })).toEqual([]);

    await expect(guard.verifyCapabilityKeyBinding({
      capabilityKey,
      credentialId: "binding-credential",
      context: {
        namespace: "tool-management",
        userId: "user-1",
        agentId: "agent-1",
        clientId: "client-1"
      }
    })).resolves.toMatchObject({
      ok: false,
      applicable: true,
      reasonCode: "binding_invalid"
    });

    await expect(guard.exportRecoveryPackage({
      passphrase: ""
    })).rejects.toThrow("Capability binding guard recovery export requires a passphrase.");

    const description = await guard.describe();
    expect(description).toMatchObject({
      protocolVersion: "pact.capability-binding-guard.v1",
      provider: "memory",
      securityMode: "memory",
      alias: "final-second-guard-memory",
      degraded: false,
      statePath: ""
    });

    guard.close();
  });

  it("persists opaque capability keys through a fake linux keyring and rejects tampered state", async () => {
    const dataDir = await tempDir("pact-final-second-opaque-");
    const binDir = await tempDir("pact-final-second-opaque-bin-");
    const stateFile = path.join(dataDir, "fake-keyctl-state.json");
    const alias = "opaque/final-second linux";

    await writeExecutable(path.join(binDir, "systemd-creds"), "process.exit(0);");
    await writeExecutable(path.join(binDir, "keyctl"), `
const fs = require("node:fs");
const stateFile = process.env.FAKE_KEYCTL_STATE_FILE;
const args = process.argv.slice(2);
const command = args[0];
if (command === "search") {
  if (fs.existsSync(stateFile)) {
    process.stdout.write("1\\n");
    process.exit(0);
  }
  process.stderr.write("key has been revoked\\n");
  process.exit(1);
}
if (command === "pipe") {
  process.stdout.write(fs.readFileSync(stateFile, "utf8"));
  process.exit(0);
}
if (command === "padd") {
  fs.writeFileSync(stateFile, fs.readFileSync(0, "utf8"));
  process.stdout.write("1\\n");
  process.exit(0);
}
if (command === "unlink") {
  if (fs.existsSync(stateFile)) {
    fs.unlinkSync(stateFile);
  }
  process.exit(0);
}
process.stderr.write("unexpected keyctl command: " + command + "\\n");
process.exit(1);
`);

    await withPlatform("linux", async () => withEnv({
      PATH: `${binDir}${path.delimiter}${process.env.PATH || ""}`,
      FAKE_KEYCTL_STATE_FILE: stateFile
    }, async () => {
      const provider = createOpaqueCapabilityKeyProvider({
        backend: "linux-kernel-keyring",
        alias,
        dataDir,
        lookupKeySource: fakeLookupKeySource({
          provider: "mock",
          securityMode: "mock-keyring",
          linuxDetectedBackends: ["systemd-credentials", "linux-kernel-keyring", "local-file"]
        })
      });

      const initialDescription = await provider.describe();
      expect(initialDescription).toMatchObject({
        protocolVersion: "pact.opaque-capability-key.v1",
        provider: "linux-kernel-keyring",
        alias,
        bindingCount: 0,
        permissionBindingCount: 0,
        stateRoot: "mock-state-root"
      });
      expect(initialDescription.linuxDetectedBackends).toContain("systemd-credentials");
      expect(initialDescription.linuxDetectedBackends).toContain("linux-kernel-keyring");

      const capabilityKey = createCapabilityKey();
      await provider.issue({
        capabilityKey,
        credentialId: "opaque-credential",
        capabilities: [apiCapabilityId("knowledge.search")]
      });

      await expect(provider.verify({
        capabilityKey,
        requiredCapability: apiCapabilityId("knowledge.search")
      })).resolves.toMatchObject({
        ok: true,
        reasonCode: "capability_key_valid",
        credentialId: "opaque-credential"
      });

      expect(await provider.invalidate({
        capabilityKey: "missing-key",
        reason: "no-op"
      })).toBeNull();

      expect(await provider.invalidateCredential({
        credentialId: "opaque-credential",
        reason: "manual review"
      })).toHaveLength(1);

      await expect(provider.verify({
        capabilityKey,
        requiredCapability: apiCapabilityId("knowledge.search")
      })).resolves.toMatchObject({
        ok: false,
        reasonCode: "capability_key_invalid"
      });

      const reopened = createOpaqueCapabilityKeyProvider({
        backend: "linux-kernel-keyring",
        alias,
        dataDir,
        lookupKeySource: fakeLookupKeySource({
          provider: "mock",
          securityMode: "mock-keyring",
          linuxDetectedBackends: ["systemd-credentials", "linux-kernel-keyring", "local-file"]
        })
      });

      await expect(reopened.describe()).resolves.toMatchObject({
        provider: "linux-kernel-keyring",
        bindingCount: 1
      });

      provider.close();
      reopened.close();

      const onDisk = JSON.parse(await fs.readFile(stateFile, "utf8"));
      onDisk.stateRoot = "tampered-state-root";
      await fs.writeFile(stateFile, `${JSON.stringify(onDisk, null, 2)}\n`);

      const tampered = createOpaqueCapabilityKeyProvider({
        backend: "linux-kernel-keyring",
        alias,
        dataDir,
        lookupKeySource: fakeLookupKeySource({
          provider: "mock",
          securityMode: "mock-keyring",
          linuxDetectedBackends: ["systemd-credentials", "linux-kernel-keyring", "local-file"]
        })
      });

      await expect(tampered.describe()).rejects.toThrow("Capability kernel sealed state root mismatch.");
      tampered.close();
    }));
  });

  it("persists guard bindings through a fake linux pass backend and rejects tampered state", async () => {
    const dataDir = await tempDir("pact-final-second-guard-");
    const binDir = await tempDir("pact-final-second-guard-bin-");
    const stateFile = path.join(dataDir, "fake-pass-state.json");
    const alias = "binding/final-second linux";

    await writeExecutable(path.join(binDir, "systemd-creds"), "process.exit(0);");
    await writeExecutable(path.join(binDir, "pass"), `
const fs = require("node:fs");
const stateFile = process.env.FAKE_PASS_STATE_FILE;
const args = process.argv.slice(2);
const command = args[0];
if (command === "show") {
  if (fs.existsSync(stateFile)) {
    process.stdout.write(fs.readFileSync(stateFile, "utf8"));
    process.exit(0);
  }
  process.stderr.write("not in the password store\\n");
  process.exit(1);
}
if (command === "insert") {
  fs.writeFileSync(stateFile, fs.readFileSync(0, "utf8"));
  process.exit(0);
}
process.stderr.write("unexpected pass command: " + command + "\\n");
process.exit(1);
`);

    await withPlatform("linux", async () => withEnv({
      PATH: `${binDir}${path.delimiter}${process.env.PATH || ""}`,
      FAKE_PASS_STATE_FILE: stateFile
    }, async () => {
      const guard = createCapabilityBindingGuard({
        backend: "pass-gpg",
        alias,
        dataDir
      });

      const capabilityKey = createCapabilityKey();
      await guard.bindCapabilityKey({
        key: capabilityKey,
        credentialId: "pass-credential",
        context: {
          namespace: "tool-management",
          userId: "user-1"
        }
      });

      await expect(guard.verifyCapabilityKeyBinding({
        capabilityKey,
        credentialId: "pass-credential",
        context: {
          namespace: "tool-management",
          userId: "user-1"
        }
      })).resolves.toMatchObject({
        ok: true,
        applicable: true,
        credentialId: "pass-credential",
        bindingStrength: "user"
      });

      const description = await guard.describe();
      expect(description).toMatchObject({
        protocolVersion: "pact.capability-binding-guard.v1",
        provider: "pass-gpg",
        securityMode: "user_keyring",
        alias: "binding_final-second_linux",
        statePath: "",
        bindingCount: 1,
        activeBindingCount: 1
      });
      expect(description.degraded).toBe(false);

      const reopened = createCapabilityBindingGuard({
        backend: "pass-gpg",
        alias,
        dataDir
      });

      await expect(reopened.describe()).resolves.toMatchObject({
        provider: "pass-gpg",
        bindingCount: 1,
        activeBindingCount: 1
      });

      guard.close();
      reopened.close();

      const onDisk = JSON.parse(await fs.readFile(stateFile, "utf8"));
      onDisk.stateRoot = "tampered-state-root";
      await fs.writeFile(stateFile, `${JSON.stringify(onDisk, null, 2)}\n`);

      const tampered = createCapabilityBindingGuard({
        backend: "pass-gpg",
        alias,
        dataDir
      });

      await expect(tampered.describe()).rejects.toThrow("Capability binding guard sealed state root mismatch.");
      tampered.close();
    }));
  });
});
