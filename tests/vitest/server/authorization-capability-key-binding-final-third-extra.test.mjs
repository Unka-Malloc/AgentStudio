import { afterEach, describe, expect, it, vi } from "vitest";
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
  capabilityKeyHash,
  capabilityPermissionHash,
  canonicalOpaqueCapabilities,
  createCapabilityKey,
  createMemoryCapabilityKeyBindingStore,
  createOpaqueCapabilityKeyProvider,
  createSealedCapabilityKernelStore,
  opaqueCapabilityHash
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

async function withPlatformAndPath(platform, binDir, fn) {
  const nextPath = `${binDir}${path.delimiter}${process.env.PATH || ""}`;
  return withPlatform(platform, () => withEnv({ PATH: nextPath }, fn));
}

function fakeOpaqueLookupKeySource({
  runtimeLookupKeyBase64 = Buffer.alloc(32, 17).toString("base64"),
  provider = "mock",
  securityMode = "mock-keyring"
} = {}) {
  let generation = 3;
  let loadCount = 0;
  return {
    async loadRuntimeLookupKey() {
      loadCount += 1;
      return {
        protocolVersion: "v0.0.1:risk-control:opaque-capability-key-1",
        provider,
        securityMode,
        generation,
        runtimeLookupKeyBase64
      };
    },
    async rotateRuntimeLookupKey() {
      generation += 1;
      return {
        protocolVersion: "v0.0.1:risk-control:opaque-capability-key-1",
        provider,
        generation
      };
    },
    describe() {
      return {
        protocolVersion: "v0.0.1:risk-control:opaque-capability-key-1",
        provider,
        securityMode,
        generation,
        loadCount,
        runtimeLookupKeyRotationSupported: true,
        permissionBindingCount: 0,
        stateRoot: "mock-state-root",
        linuxDetectedBackends: []
      };
    }
  };
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("authorization capability key binding final third extra coverage", () => {
  it("normalizes edge helper inputs and hash wrappers deterministically", () => {
    expect(normalizeCapabilityBindingContext({
      binding_namespace: "tenant-a",
      bound_user_id: "user-a",
      agent_profile_id: "agent-a",
      client_name: "client-a"
    })).toMatchObject({
      namespace: "tenant-a",
      userId: "user-a",
      agentId: "agent-a",
      clientId: "client-a"
    });

    const runtimeLookupKey = Buffer.alloc(32, 19);
    const runtimeLookupKeyBase64 = runtimeLookupKey.toString("base64");

    expect(capabilityKeyHash(runtimeLookupKey, "opaque-key")).toBe(
      capabilityKeyHash(runtimeLookupKeyBase64, "opaque-key")
    );
    expect(capabilityPermissionHash(runtimeLookupKey, apiCapabilityId("knowledge.search"))).toBe(
      capabilityPermissionHash(runtimeLookupKeyBase64, apiCapabilityId("knowledge.search"))
    );
    expect(capabilityBindingKeyHash(runtimeLookupKey, "binding-key")).toBe(
      capabilityBindingKeyHash(runtimeLookupKeyBase64, "binding-key")
    );
    expect(capabilityBindingSubjectHash(runtimeLookupKey, "namespace", "tenant-a")).toBe(
      capabilityBindingSubjectHash(runtimeLookupKeyBase64, "namespace", "tenant-a")
    );

    expect(canonicalOpaqueCapabilities([
      "cap:tool:pact.agentLibrary.health:execute",
      "cap:api:knowledge.search",
      "cap:*",
      "cap:api:knowledge.search"
    ])).toEqual([
      "cap:*",
      "cap:api:knowledge.search",
      "cap:tool:pact.agentLibrary.health:execute"
    ]);

    expect(opaqueCapabilityHash(["cap:*", "cap:api:knowledge.search"]))
      .toBe(opaqueCapabilityHash(["cap:api:knowledge.search", "cap:*"]));
  });

  it("drives sealed kernel store linux backend selection, rotation, and list/revoke paths", async () => {
    const dataDir = await tempDir("pact-final-third-opaque-auto-");
    const binDir = await tempDir("pact-final-third-opaque-auto-bin-");
    const keyctlStateFile = path.join(dataDir, "fake-keyctl-state.json");
    const alias = "opaque final third auto";

    await writeExecutable(path.join(binDir, "systemd-creds"), `
process.exit(0);
    `);
    await writeExecutable(path.join(binDir, "keyctl"), `
const fs = require("node:fs");
const stateFile = process.env.PACT_FAKE_KEYCTL_STATE_FILE || "";
function readState() {
  if (!stateFile || !fs.existsSync(stateFile)) return null;
  try {
    return JSON.parse(fs.readFileSync(stateFile, "utf8"));
  } catch {
    return null;
  }
}
function writeState(value) {
  if (!stateFile) return;
  fs.writeFileSync(stateFile, value);
}
const args = process.argv.slice(2);
if (args[0] === "search") {
  if (!readState()) {
    process.stderr.write("key not found");
    process.exit(1);
  }
  process.stdout.write("1");
  process.exit(0);
}
if (args[0] === "padd") {
  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => { input += chunk; });
  process.stdin.on("end", () => {
    writeState(input || "{}");
    process.exit(0);
  });
  process.stdin.resume();
  process.exitCode = 0;
} else if (args[0] === "pipe") {
  const state = readState();
  if (state) {
    process.stdout.write(JSON.stringify(state));
    process.exit(0);
  }
  process.exit(1);
} else if (args[0] === "unlink") {
  if (stateFile && fs.existsSync(stateFile)) {
    fs.unlinkSync(stateFile);
  }
  process.exit(0);
} else {
  process.stderr.write("unexpected keyctl command: " + args.join(" "));
  process.exit(1);
}
    `);
    await writeExecutable(path.join(binDir, "secret-tool"), `
process.exit(0);
    `);
    await writeExecutable(path.join(binDir, "pass"), `
process.exit(0);
    `);

    await withEnv({ PACT_FAKE_KEYCTL_STATE_FILE: keyctlStateFile }, async () => withPlatformAndPath("linux", binDir, async () => {
      const store = createSealedCapabilityKernelStore({
        backend: "auto",
        dataDir,
        alias
      });

      const initialDescription = await store.describe();
      expect(initialDescription).toMatchObject({
        protocolVersion: "v0.0.1:risk-control:opaque-capability-key-1",
        provider: "linux-kernel-keyring",
        securityMode: "keyring",
        runtimeLookupKeyRotationSupported: true
      });
      expect(initialDescription.linuxDetectedBackends).toEqual([
        "systemd-credentials",
        "linux-kernel-keyring",
        "secret-service",
        "pass-gpg",
        "local-file"
      ]);

      const runtimeLookup = await store.keySource.loadRuntimeLookupKey();
      expect(Buffer.from(runtimeLookup.runtimeLookupKeyBase64, "base64").length).toBeGreaterThanOrEqual(32);

      const rotated = await store.keySource.rotateRuntimeLookupKey();
      expect(rotated).toMatchObject({
        protocolVersion: "v0.0.1:risk-control:opaque-capability-key-1",
        provider: "linux-kernel-keyring"
      });

      const record = await store.put({
        keyHash: "store-key-1",
        credentialId: "store-credential",
        status: "valid",
        capabilitySetHash: opaqueCapabilityHash(["cap:*"]),
        capabilityCount: 1,
        grantVersion: 2,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        constraints: { workspaceId: "workspace-a" },
        metadata: { origin: "alpha" }
      }, ["permission-a"]);
      expect(record).toMatchObject({
        keyHash: "store-key-1",
        credentialId: "store-credential",
        status: "valid"
      });

      expect(await store.get("store-key-1")).toMatchObject({
        credentialId: "store-credential",
        status: "valid"
      });
      expect(await store.hasCapability("store-key-1", [])).toBe(true);
      expect(await store.hasCapability("store-key-1", ["permission-a"])).toBe(true);

      const revoked = await store.invalidate("store-key-1", "revoked");
      expect(revoked).toMatchObject({
        status: "invalid",
        invalidationReason: "revoked"
      });

      expect(await store.hasCapability("store-key-1", ["permission-a"])).toBe(false);
      expect(await store.list()).toEqual([]);
      expect(await store.list({ includeInvalid: true })).toHaveLength(1);

      const description = await store.describe();
      expect(description).toMatchObject({
        protocolVersion: "v0.0.1:risk-control:opaque-capability-key-1",
        provider: "linux-kernel-keyring",
        securityMode: "keyring",
        alias: "opaque_final_third_auto",
        bindingCount: 1,
        permissionBindingCount: 1,
        runtimeLookupKeyRotationSupported: false
      });
      expect(description.loadCount).toBeGreaterThan(0);
      expect(description.saveCount).toBeGreaterThan(0);
      expect(description.linuxDetectedBackends).toEqual([
        "systemd-credentials",
        "linux-kernel-keyring",
        "secret-service",
        "pass-gpg",
        "local-file"
      ]);

      store.close();
    }));
  });

  it("drives opaque memory-provider revoke, list, describe, and wildcard candidate paths", async () => {
    const provider = createOpaqueCapabilityKeyProvider({
      backend: "memory",
      alias: "opaque-memory-final-third"
    });

    const issuedOne = await provider.issue({
      capabilityKey: "opaque-memory-key-1",
      credentialId: "opaque-memory-credential",
      capabilities: ["cap:*"],
      constraints: { workspaceId: "workspace-a" },
      metadata: { origin: "alpha" },
      grantVersion: 2
    });
    const issuedTwo = await provider.issue({
      capabilityKey: "opaque-memory-key-2",
      credentialId: "opaque-memory-credential",
      capabilities: ["cap:*"],
      constraints: { workspaceId: "workspace-a" },
      metadata: { origin: "beta" },
      grantVersion: 3
    });

    expect(issuedOne).toMatchObject({
      protocolVersion: "v0.0.1:risk-control:opaque-capability-key-1",
      credentialId: "opaque-memory-credential",
      capabilityKey: "opaque-memory-key-1",
      capabilityCount: 1
    });
    expect(issuedTwo).toMatchObject({
      credentialId: "opaque-memory-credential",
      capabilityKey: "opaque-memory-key-2"
    });

    const decision = await provider.verify({
      capabilityKey: "opaque-memory-key-1",
      requiredCapabilities: [
        apiCapabilityId("knowledge.search"),
        toolExecuteCapabilityId("pact.agentLibrary.health")
      ],
      includeRecordDetails: true
    });

    expect(decision).toMatchObject({
      ok: true,
      reasonCode: "capability_key_valid",
      credentialId: "opaque-memory-credential",
      capabilityCount: 1,
      constraints: { workspaceId: "workspace-a" },
      metadata: { origin: "alpha" }
    });
    expect(decision.requiredCapabilities).toEqual([
      apiCapabilityId("knowledge.search"),
      toolExecuteCapabilityId("pact.agentLibrary.health")
    ]);
    expect(decision.capabilitySetHash).toBeTruthy();
    expect(decision.keyHash).toBeTruthy();

    expect(await provider.store.get(decision.keyHash)).toMatchObject({
      credentialId: "opaque-memory-credential",
      status: "valid"
    });
    const revoked = await provider.invalidate({
      capabilityKey: "opaque-memory-key-1",
      reason: "revoked"
    });
    expect(revoked).toMatchObject({
      status: "invalid",
      invalidationReason: "revoked"
    });

    const credentialRevoked = await provider.invalidateCredential({
      credentialId: "opaque-memory-credential",
      reason: "mass revoke"
    });
    expect(credentialRevoked).toHaveLength(1);
    expect(credentialRevoked[0]).toMatchObject({
      status: "invalid",
      invalidationReason: "mass revoke"
    });
    expect(await provider.invalidateCredential({ credentialId: "" })).toEqual([]);

    await expect(provider.verify({
      capabilityKey: "opaque-memory-key-1",
      requiredCapability: apiCapabilityId("knowledge.search")
    })).resolves.toMatchObject({
      ok: false,
      reasonCode: "capability_key_invalid"
    });
    await expect(provider.verify({
      capabilityKey: "opaque-memory-key-2",
      requiredCapability: apiCapabilityId("knowledge.search")
    })).resolves.toMatchObject({
      ok: false,
      reasonCode: "capability_key_invalid"
    });

    expect(await provider.store.list()).toEqual([]);
    expect(await provider.store.list({ includeInvalid: true })).toHaveLength(2);

    const description = await provider.describe();
    expect(description).toMatchObject({
      protocolVersion: "v0.0.1:risk-control:opaque-capability-key-1",
      provider: "memory",
      alias: "opaque-memory-final-third",
      bindingCount: 2,
      runtimeLookupLoaded: true
    });
    expect(description.keySource).toMatchObject({
      provider: "memory",
      runtimeLookupKeyRotationSupported: false
    });

    provider.close();
  });

  it("drives capability-binding-guard memory storage through edge contexts and invalidation paths", async () => {
    const guard = createMemoryCapabilityBindingGuard({ alias: "binding final third memory" });
    const bindingKeyOne = createCapabilityKey();
    const bindingKeyTwo = createCapabilityKey();

    const initialDescription = await guard.describe();
    expect(initialDescription).toMatchObject({
      protocolVersion: "v0.0.1:risk-control:capability-binding-guard-1",
      provider: "memory",
      securityMode: "memory",
      alias: "binding_final_third_memory",
      degraded: false,
      bindingCount: 0,
      activeBindingCount: 0,
      statePath: ""
    });

    const boundOne = await guard.bindCapabilityKey({
      key: bindingKeyOne,
      credentialId: "binding-memory-credential",
      context: {
        binding_namespace: "tenant-a",
        bound_user_id: "user-a",
        agent_profile_id: "agent-a",
        client_name: "client-a"
      }
    });
    const boundTwo = await guard.bindCapabilityKey({
      key: bindingKeyTwo,
      credentialId: "binding-memory-credential",
      context: {
        namespace: "tenant-a"
      }
    });

    expect(boundOne).toMatchObject({
      credentialId: "binding-memory-credential",
      bindingStrength: "user+agent+client",
      requireUser: true,
      requireAgent: true,
      requireClient: true
    });
    expect(boundTwo).toMatchObject({
      credentialId: "binding-memory-credential",
      bindingStrength: "namespace"
    });

    await expect(guard.verifyCapabilityKeyBinding({
      capabilityKey: bindingKeyOne,
      credentialId: "binding-memory-credential",
      context: {
        namespace: "tenant-a",
        agentId: "agent-a",
        clientId: "client-a"
      }
    })).resolves.toMatchObject({
      ok: false,
      applicable: true,
      reasonCode: "binding_user_missing"
    });

    await expect(guard.verifyCapabilityKeyBinding({
      capabilityKey: bindingKeyOne,
      credentialId: "binding-memory-credential",
      context: {
        namespace: "tenant-a",
        userId: "wrong-user",
        agentId: "agent-a",
        clientId: "client-a"
      }
    })).resolves.toMatchObject({
      ok: false,
      applicable: true,
      reasonCode: "binding_user_mismatch"
    });

    await expect(guard.verifyCapabilityKeyBinding({
      capabilityKey: bindingKeyTwo,
      credentialId: "binding-memory-credential",
      context: {
        namespace: "tenant-b"
      }
    })).resolves.toMatchObject({
      ok: false,
      applicable: true,
      reasonCode: "binding_namespace_mismatch"
    });

    await expect(guard.verifyCapabilityKeyBinding({
      capabilityKey: bindingKeyOne,
      credentialId: "binding-memory-credential",
      context: {
        namespace: "tenant-a",
        userId: "user-a",
        agentId: "agent-a",
        clientId: "client-a"
      }
    })).resolves.toMatchObject({
      ok: true,
      applicable: true,
      reasonCode: "capability_binding_valid"
    });

    expect(await guard.invalidateCapabilityKeyBinding({ credentialId: "" })).toEqual([]);

    const invalidated = await guard.invalidateCapabilityKeyBinding({
      credentialId: "binding-memory-credential",
      reason: "policy-revoked"
    });
    expect(invalidated).toHaveLength(2);
    expect(invalidated[0]).toMatchObject({
      status: "invalid",
      invalidationReason: "policy-revoked"
    });

    await expect(guard.verifyCapabilityKeyBinding({
      capabilityKey: bindingKeyOne,
      credentialId: "binding-memory-credential",
      context: {
        namespace: "tenant-a",
        userId: "user-a",
        agentId: "agent-a",
        clientId: "client-a"
      }
    })).resolves.toMatchObject({
      ok: false,
      applicable: true,
      reasonCode: "binding_invalid"
    });

    const postDescription = await guard.describe();
    expect(postDescription).toMatchObject({
      provider: "memory",
      securityMode: "memory",
      bindingCount: 2,
      activeBindingCount: 0,
      statePath: ""
    });

    guard.close();
  });

  it("resolves auto backend selection across platform branches without loading state", async () => {
    const opaqueMemoryStore = createMemoryCapabilityKeyBindingStore();
    const opaqueLookupKeySource = fakeOpaqueLookupKeySource();
    const win32BinDir = await tempDir("pact-final-third-platform-win32-");
    const linuxBinDir = await tempDir("pact-final-third-platform-linux-");

    await writeExecutable(path.join(win32BinDir, "powershell.exe"), `
process.exit(0);
    `);
    await writeExecutable(path.join(linuxBinDir, "keyctl"), `
process.exit(0);
    `);

    await withPlatform("darwin", async () => {
      const provider = createOpaqueCapabilityKeyProvider({
        backend: "auto",
        bindingStore: opaqueMemoryStore,
        lookupKeySource: opaqueLookupKeySource,
        alias: "darwin-auto"
      });
      const guard = createCapabilityBindingGuard({
        backend: "auto",
        alias: "darwin-auto"
      });
      expect(provider.provider).toBe("macos-keychain");
      expect(guard.provider).toBe("macos-keychain");
    });

    await withPlatformAndPath("win32", win32BinDir, async () => {
      const provider = createOpaqueCapabilityKeyProvider({
        backend: "auto",
        bindingStore: createMemoryCapabilityKeyBindingStore(),
        lookupKeySource: fakeOpaqueLookupKeySource(),
        alias: "win32-auto"
      });
      const guard = createCapabilityBindingGuard({
        backend: "auto",
        alias: "win32-auto"
      });
      expect(provider.provider).toBe("windows-dpapi");
      expect(guard.provider).toBe("windows-dpapi");
      await expect(provider.describe()).resolves.toMatchObject({
        provider: "windows-dpapi",
        alias: "win32-auto"
      });
    });

    await withPlatformAndPath("linux", linuxBinDir, async () => {
      const provider = createOpaqueCapabilityKeyProvider({
        backend: "auto",
        bindingStore: createMemoryCapabilityKeyBindingStore(),
        lookupKeySource: fakeOpaqueLookupKeySource(),
        alias: "linux-auto"
      });
      const guard = createCapabilityBindingGuard({
        backend: "auto",
        alias: "linux-auto"
      });
      expect(provider.provider).toBe("linux-kernel-keyring");
      expect(guard.provider).toBe("linux-kernel-keyring");
    });

    await withPlatform("sunos", async () => {
      const provider = createOpaqueCapabilityKeyProvider({
        backend: "auto",
        bindingStore: createMemoryCapabilityKeyBindingStore(),
        lookupKeySource: fakeOpaqueLookupKeySource(),
        alias: "fallback-auto"
      });
      const guard = createCapabilityBindingGuard({
        backend: "auto",
        alias: "fallback-auto"
      });
      expect(provider.provider).toBe("local-file");
      expect(guard.provider).toBe("local-file");
    });
  });
});
