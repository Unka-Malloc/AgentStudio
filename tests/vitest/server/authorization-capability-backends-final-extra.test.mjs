import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  apiCapabilityId
} from "../../../server/platform/common/security/authorization/authorization-engine.mjs";
import {
  createCapabilityBindingGuard
} from "../../../server/platform/common/security/authorization/capability-binding-guard.mjs";
import {
  createCapabilityKey,
  createMemoryCapabilityKeyBindingStore,
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

async function withPlatformAndPath(platform, binDir, fn) {
  return withPlatform(platform, () => withEnv({
    PATH: `${binDir}${path.delimiter}${process.env.PATH || ""}`
  }, fn));
}

async function installSecretTool(binDir, stateFile) {
  await writeExecutable(path.join(binDir, "secret-tool"), `
const fs = require("node:fs");
const args = process.argv.slice(2);
if (args[0] === "lookup") {
  if (!fs.existsSync(${JSON.stringify(stateFile)})) {
    process.stderr.write("not found");
    process.exit(1);
  }
  process.stdout.write(fs.readFileSync(${JSON.stringify(stateFile)}, "utf8"));
  process.exit(0);
}
if (args[0] === "store") {
  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => { input += chunk; });
  process.stdin.on("end", () => {
    fs.writeFileSync(${JSON.stringify(stateFile)}, input);
    process.exit(0);
  });
  process.stdin.resume();
} else {
  process.stderr.write("unexpected secret-tool command: " + args.join(" "));
  process.exit(2);
}
  `);
}

async function installPass(binDir, stateFile, { failShow = false } = {}) {
  await writeExecutable(path.join(binDir, "pass"), `
const fs = require("node:fs");
const args = process.argv.slice(2);
if (args[0] === "show") {
  if (${JSON.stringify(Boolean(failShow))}) {
    process.stderr.write("gpg backend failed");
    process.exit(2);
  }
  if (!fs.existsSync(${JSON.stringify(stateFile)})) {
    process.stderr.write("not in the password store");
    process.exit(1);
  }
  process.stdout.write(fs.readFileSync(${JSON.stringify(stateFile)}, "utf8"));
  process.exit(0);
}
if (args[0] === "insert") {
  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => { input += chunk; });
  process.stdin.on("end", () => {
    fs.writeFileSync(${JSON.stringify(stateFile)}, input);
    process.exit(0);
  });
  process.stdin.resume();
} else {
  process.stderr.write("unexpected pass command: " + args.join(" "));
  process.exit(2);
}
  `);
}

async function installKeyctl(binDir, stateFile) {
  await writeExecutable(path.join(binDir, "keyctl"), `
const fs = require("node:fs");
const args = process.argv.slice(2);
function readState() {
  if (!fs.existsSync(${JSON.stringify(stateFile)})) {
    return { nextSerial: 1, byDescription: {}, bySerial: {} };
  }
  return JSON.parse(fs.readFileSync(${JSON.stringify(stateFile)}, "utf8"));
}
function writeState(state) {
  fs.writeFileSync(${JSON.stringify(stateFile)}, JSON.stringify(state));
}
if (args[0] === "search") {
  const state = readState();
  const description = args[3] || "";
  const serial = state.byDescription[description] || "";
  if (!serial) {
    process.stderr.write("requested key not available");
    process.exit(1);
  }
  process.stdout.write(String(serial) + "\\n");
  process.exit(0);
}
if (args[0] === "pipe") {
  const state = readState();
  const payload = state.bySerial[String(args[1] || "")] || "";
  if (!payload) {
    process.stderr.write("key has been revoked");
    process.exit(1);
  }
  process.stdout.write(payload);
  process.exit(0);
}
if (args[0] === "unlink") {
  const state = readState();
  const serial = String(args[1] || "");
  for (const [description, value] of Object.entries(state.byDescription)) {
    if (String(value) === serial) {
      delete state.byDescription[description];
    }
  }
  delete state.bySerial[serial];
  writeState(state);
  process.exit(0);
}
if (args[0] === "padd") {
  const state = readState();
  const description = args[2] || "";
  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => { input += chunk; });
  process.stdin.on("end", () => {
    const serial = String(state.nextSerial++);
    state.byDescription[description] = serial;
    state.bySerial[serial] = input;
    writeState(state);
    process.stdout.write(serial + "\\n");
    process.exit(0);
  });
  process.stdin.resume();
} else {
  process.stderr.write("unexpected keyctl command: " + args.join(" "));
  process.exit(2);
}
  `);
}

async function installDpapiCommand(binDir, name) {
  await writeExecutable(path.join(binDir, name), `
const isUnprotect = process.argv.join(" ").includes("Unprotect");
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  if (isUnprotect) {
    process.stdout.write(Buffer.from(input.trim(), "base64").toString("utf8"));
  } else {
    process.stdout.write(Buffer.from(input, "utf8").toString("base64"));
  }
});
process.stdin.resume();
  `);
}

async function installFailingCommand(binDir, name, message) {
  await writeExecutable(path.join(binDir, name), `
process.stderr.write(${JSON.stringify(message)});
process.exit(2);
  `);
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("authorization capability backend final extra coverage", () => {
  it("persists and reopens capability binding guard state through secret-service", async () => {
    const dataDir = await tempDir("pact-binding-secret-");
    const binDir = await tempDir("pact-binding-secret-bin-");
    const stateFile = path.join(dataDir, "secret-service-record.json");
    await installSecretTool(binDir, stateFile);

    await withEnv({ PATH: `${binDir}${path.delimiter}${process.env.PATH || ""}` }, async () => {
      const capabilityKey = createCapabilityKey();
      const guard = createCapabilityBindingGuard({
        backend: "secret-service",
        dataDir,
        alias: "binding secret service"
      });

      await guard.bindCapabilityKey({
        capabilityKey,
        credentialId: "cred-secret",
        context: {
          namespace: "tool-management",
          userId: "user-secret"
        }
      });
      expect(await guard.describe()).toMatchObject({
        provider: "secret-service",
        securityMode: "keyring",
        bindingCount: 1
      });

      const reopened = createCapabilityBindingGuard({
        backend: "secret-service",
        dataDir,
        alias: "binding secret service"
      });
      await expect(reopened.verifyCapabilityKeyBinding({
        capabilityKey,
        credentialId: "cred-secret",
        context: {
          namespace: "tool-management",
          userId: "user-secret"
        }
      })).resolves.toMatchObject({
        ok: true,
        applicable: true,
        reasonCode: "capability_binding_valid"
      });
    });
  });

  it("exercises pass-gpg success and explicit failure paths for binding guard state", async () => {
    const dataDir = await tempDir("pact-binding-pass-");
    const binDir = await tempDir("pact-binding-pass-bin-");
    const stateFile = path.join(dataDir, "pass-record.json");
    await installPass(binDir, stateFile);

    await withEnv({ PATH: `${binDir}${path.delimiter}${process.env.PATH || ""}` }, async () => {
      const capabilityKey = createCapabilityKey();
      const guard = createCapabilityBindingGuard({
        backend: "pass-gpg",
        dataDir,
        alias: "binding pass"
      });
      await guard.bindCapabilityKey({
        capabilityKey,
        credentialId: "cred-pass",
        context: { namespace: "tool-management", agentId: "agent-pass" }
      });
      expect(await guard.describe()).toMatchObject({
        provider: "pass-gpg",
        securityMode: "user_keyring",
        bindingCount: 1
      });
    });

    const failingBinDir = await tempDir("pact-binding-pass-failing-bin-");
    await installPass(failingBinDir, path.join(dataDir, "unused-pass-record.json"), { failShow: true });
    await withEnv({ PATH: `${failingBinDir}${path.delimiter}${process.env.PATH || ""}` }, async () => {
      const guard = createCapabilityBindingGuard({
        backend: "pass-gpg",
        dataDir,
        alias: "binding pass failing"
      });
      await expect(guard.describe()).rejects.toThrow("gpg backend failed");
    });
  });

  it("persists binding guard state through auto-selected Windows DPAPI", async () => {
    const dataDir = await tempDir("pact-binding-dpapi-");
    const binDir = await tempDir("pact-binding-dpapi-bin-");
    await installDpapiCommand(binDir, "powershell.exe");

    await withPlatformAndPath("win32", binDir, async () => {
      const capabilityKey = createCapabilityKey();
      const guard = createCapabilityBindingGuard({
        backend: "auto",
        dataDir,
        alias: "binding dpapi"
      });
      await guard.bindCapabilityKey({
        capabilityKey,
        credentialId: "cred-dpapi",
        context: { namespace: "tool-management", clientId: "client-dpapi" }
      });
      expect(await guard.describe()).toMatchObject({
        provider: "windows-dpapi",
        securityMode: "dpapi",
        degraded: false
      });

      const reopened = createCapabilityBindingGuard({
        backend: "auto",
        dataDir,
        alias: "binding dpapi"
      });
      await expect(reopened.verifyCapabilityKeyBinding({
        capabilityKey,
        credentialId: "cred-dpapi",
        context: { namespace: "tool-management", clientId: "client-dpapi" }
      })).resolves.toMatchObject({
        ok: true,
        reasonCode: "capability_binding_valid"
      });
    });
  });

  it("persists binding guard state through linux kernel keyring", async () => {
    const dataDir = await tempDir("pact-binding-keyctl-");
    const binDir = await tempDir("pact-binding-keyctl-bin-");
    const stateFile = path.join(dataDir, "keyctl-state.json");
    await installKeyctl(binDir, stateFile);

    await withPlatformAndPath("linux", binDir, async () => {
      const capabilityKey = createCapabilityKey();
      const guard = createCapabilityBindingGuard({
        backend: "linux-kernel-keyring",
        dataDir,
        alias: "binding keyctl"
      });

      await guard.bindCapabilityKey({
        capabilityKey,
        credentialId: "cred-keyctl",
        context: {
          namespace: "tool-management",
          userId: "user-keyctl",
          agentId: "agent-keyctl",
          clientId: "client-keyctl"
        },
        requireUser: true,
        requireAgent: true,
        requireClient: true
      });

      expect(await guard.describe()).toMatchObject({
        provider: "linux-kernel-keyring",
        securityMode: "keyring",
        bindingCount: 1
      });

      const reopened = createCapabilityBindingGuard({
        backend: "linux-kernel-keyring",
        dataDir,
        alias: "binding keyctl"
      });
      await expect(reopened.verifyCapabilityKeyBinding({
        capabilityKey,
        credentialId: "cred-keyctl",
        context: {
          namespace: "tool-management",
          userId: "user-keyctl",
          agentId: "agent-keyctl",
          clientId: "client-keyctl"
        }
      })).resolves.toMatchObject({
        ok: true,
        reasonCode: "capability_binding_valid",
        requireUser: true,
        requireAgent: true,
        requireClient: true
      });
    });
  });

  it("persists opaque capability kernel state through secret-service", async () => {
    const dataDir = await tempDir("pact-opaque-secret-");
    const binDir = await tempDir("pact-opaque-secret-bin-");
    const stateFile = path.join(dataDir, "opaque-secret-service-record.json");
    await installSecretTool(binDir, stateFile);

    await withEnv({ PATH: `${binDir}${path.delimiter}${process.env.PATH || ""}` }, async () => {
      const capabilityKey = createCapabilityKey();
      const provider = createOpaqueCapabilityKeyProvider({
        backend: "secret-service",
        dataDir,
        alias: "opaque secret service"
      });
      const issued = await provider.issue({
        capabilityKey,
        credentialId: "opaque-secret-cred",
        capabilities: [apiCapabilityId("knowledge.search")]
      });
      expect(issued).toMatchObject({
        protocolVersion: "pact.opaque-capability-key.v1",
        credentialId: "opaque-secret-cred"
      });
      expect(await provider.describe()).toMatchObject({
        provider: "secret-service",
        securityMode: "keyring",
        bindingCount: 1
      });

      const reopened = createOpaqueCapabilityKeyProvider({
        backend: "secret-service",
        dataDir,
        alias: "opaque secret service"
      });
      await expect(reopened.verify({
        capabilityKey,
        requiredCapability: apiCapabilityId("knowledge.search"),
        includeRecordDetails: true
      })).resolves.toMatchObject({
        ok: true,
        credentialId: "opaque-secret-cred",
        capabilityCount: 1
      });
    });
  });

  it("persists opaque capability kernel state through auto-selected pwsh DPAPI", async () => {
    const dataDir = await tempDir("pact-opaque-dpapi-");
    const binDir = await tempDir("pact-opaque-dpapi-bin-");
    await installDpapiCommand(binDir, "pwsh");

    await withPlatformAndPath("win32", binDir, async () => {
      const capabilityKey = createCapabilityKey();
      const provider = createOpaqueCapabilityKeyProvider({
        backend: "auto",
        dataDir,
        alias: "opaque dpapi"
      });
      await provider.issue({
        capabilityKey,
        credentialId: "opaque-dpapi-cred",
        capabilities: [apiCapabilityId("knowledge.search")]
      });
      expect(await provider.describe()).toMatchObject({
        provider: "windows-dpapi",
        securityMode: "dpapi",
        bindingCount: 1
      });

      const reopened = createOpaqueCapabilityKeyProvider({
        backend: "auto",
        dataDir,
        alias: "opaque dpapi"
      });
      await expect(reopened.verify({
        capabilityKey,
        requiredCapability: apiCapabilityId("knowledge.search")
      })).resolves.toMatchObject({
        ok: true,
        credentialId: "opaque-dpapi-cred"
      });
    });
  });

  it("persists opaque capability kernel state through linux kernel keyring", async () => {
    const dataDir = await tempDir("pact-opaque-keyctl-");
    const binDir = await tempDir("pact-opaque-keyctl-bin-");
    const stateFile = path.join(dataDir, "opaque-keyctl-state.json");
    await installKeyctl(binDir, stateFile);

    await withPlatformAndPath("linux", binDir, async () => {
      const capabilityKey = createCapabilityKey();
      const provider = createOpaqueCapabilityKeyProvider({
        backend: "linux-kernel-keyring",
        dataDir,
        alias: "opaque keyctl"
      });

      await provider.issue({
        capabilityKey,
        credentialId: "opaque-keyctl-cred",
        capabilities: [apiCapabilityId("knowledge.search"), "cap:tool:*"],
        metadata: { backend: "keyctl" }
      });

      expect(await provider.describe()).toMatchObject({
        provider: "linux-kernel-keyring",
        securityMode: "keyring",
        bindingCount: 1,
        permissionBindingCount: 2
      });

      const reopened = createOpaqueCapabilityKeyProvider({
        backend: "linux-kernel-keyring",
        dataDir,
        alias: "opaque keyctl"
      });
      await expect(reopened.verify({
        capabilityKey,
        requiredCapability: apiCapabilityId("knowledge.search"),
        includeRecordDetails: true
      })).resolves.toMatchObject({
        ok: true,
        credentialId: "opaque-keyctl-cred",
        capabilityCount: 2,
        metadata: { backend: "keyctl" }
      });
    });
  });

  it("covers opaque pass-gpg explicit failure and default helper path setup", async () => {
    const dataDir = await tempDir("pact-opaque-pass-");
    const binDir = await tempDir("pact-opaque-pass-bin-");
    await installPass(binDir, path.join(dataDir, "unused-opaque-pass.json"), { failShow: true });

    await withEnv({ PATH: `${binDir}${path.delimiter}${process.env.PATH || ""}` }, async () => {
      const provider = createOpaqueCapabilityKeyProvider({
        backend: "pass-gpg",
        dataDir,
        alias: "opaque pass failing"
      });
      await expect(provider.describe()).rejects.toThrow("gpg backend failed");
    });

    const providerWithDefaultHelper = createOpaqueCapabilityKeyProvider({
      backend: "local-file",
      dataDir,
      alias: "opaque default helper",
      bindingStore: createMemoryCapabilityKeyBindingStore()
    });
    expect(providerWithDefaultHelper.protocolVersion).toBe("pact.opaque-capability-key.v1");
    providerWithDefaultHelper.close();
  });

  it("falls back to local files when every Linux keyring backend fails in auto mode", async () => {
    const dataDir = await tempDir("pact-auth-auto-linux-fallback-");
    const binDir = await tempDir("pact-auth-auto-linux-fallback-bin-");
    await installFailingCommand(binDir, "keyctl", "keyctl transport exploded");
    await installFailingCommand(binDir, "secret-tool", "secret service session exploded");
    await installFailingCommand(binDir, "pass", "password store exploded");

    await withPlatformAndPath("linux", binDir, async () => {
      const capabilityKey = createCapabilityKey();
      const guard = createCapabilityBindingGuard({
        backend: "auto",
        dataDir,
        alias: "binding auto linux fallback"
      });
      await guard.bindCapabilityKey({
        capabilityKey,
        credentialId: "cred-auto-linux-fallback",
        context: {
          namespace: "tool-management",
          userId: "fallback-user"
        },
        requireUser: true
      });
      expect(await guard.describe()).toMatchObject({
        provider: "local-file",
        securityMode: "degraded_file_fallback",
        bindingCount: 1,
        degraded: true
      });

      const provider = createOpaqueCapabilityKeyProvider({
        backend: "auto",
        dataDir,
        alias: "opaque auto linux fallback"
      });
      await provider.issue({
        capabilityKey,
        credentialId: "opaque-auto-linux-fallback",
        capabilities: [apiCapabilityId("knowledge.search")]
      });
      expect(await provider.describe()).toMatchObject({
        provider: "linux-kernel-keyring",
        securityMode: "degraded_file_fallback",
        bindingCount: 1
      });
      await expect(provider.verify({
        capabilityKey,
        requiredCapability: apiCapabilityId("knowledge.search")
      })).resolves.toMatchObject({
        ok: true,
        credentialId: "opaque-auto-linux-fallback"
      });
    });
  });

  it("propagates explicit Linux keyring command failures", async () => {
    const dataDir = await tempDir("pact-auth-explicit-linux-failure-");
    const binDir = await tempDir("pact-auth-explicit-linux-failure-bin-");
    await installFailingCommand(binDir, "keyctl", "keyctl hard failure");

    await withPlatformAndPath("linux", binDir, async () => {
      const guard = createCapabilityBindingGuard({
        backend: "linux-kernel-keyring",
        dataDir,
        alias: "binding explicit linux failure"
      });
      await expect(guard.describe()).rejects.toThrow("keyctl hard failure");

      const provider = createOpaqueCapabilityKeyProvider({
        backend: "linux-kernel-keyring",
        dataDir,
        alias: "opaque explicit linux failure"
      });
      await expect(provider.describe()).rejects.toThrow("keyctl hard failure");
    });
  });
});
