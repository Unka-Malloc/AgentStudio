import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { apiCapabilityId } from "../../../server/platform/common/security/authorization/authorization-engine.mjs";
import {
  createCapabilityBindingGuard,
  capabilityBindingGuardStatePath
} from "../../../server/platform/common/security/authorization/capability-binding-guard.mjs";
import {
  createCapabilityKey,
  createCommandOpaqueCapabilityKeyProvider,
  createMemoryCapabilityKeyBindingStore,
  createOpaqueCapabilityKeyProvider
} from "../../../server/platform/common/security/authorization/opaque-capability-key.mjs";

const tempRoots = [];

function sanitizeAlias(value = "") {
  return String(value).replace(/[^a-zA-Z0-9._:-]/g, "_");
}

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

function nowDate(agoMs = 35_000) {
  return new Date(Date.now() - agoMs);
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("authorization capability final third extra coverage", () => {
  it("rejects malformed command helper JSON responses", async () => {
    const dataDir = await tempDir("pact-final-third-command-bad-json-");
    const binDir = await tempDir("pact-final-third-cmd-bin-");
    const helperPath = path.join(binDir, "opaque-helper");
    const alias = "final third command bad json";
    const runtimeLookupKeyBase64 = Buffer.alloc(32, 1).toString("base64");

    await writeExecutable(helperPath, `
const fs = require("node:fs");
const action = (() => {
  try {
    return JSON.parse(fs.readFileSync(0, "utf8") || "{}").action;
  } catch {
    return "";
  }
})();
if (action === "loadRuntimeLookupKey") {
  process.stdout.write("opaque capability key helper returned not-json");
  process.exit(0);
}
if (action === "describe") {
  process.stdout.write("v0.0.1:risk-control:opaque-capability-key-1");
  process.exit(0);
}
if (action === "rotateRuntimeLookupKey") {
  console.log(JSON.stringify({
    protocolVersion: "v0.0.1:risk-control:opaque-capability-key-1",
    provider: "command",
    generation: 2,
    runtimeLookupKeyBase64: "${runtimeLookupKeyBase64}"
  }));
  process.exit(0);
}
process.stderr.write("unexpected action: " + action);
process.exit(1);
    `);

    const provider = createCommandOpaqueCapabilityKeyProvider({
      backend: "local-file",
      dataDir,
      alias,
      command: helperPath,
      args: [],
      bindingStore: createMemoryCapabilityKeyBindingStore()
    });

    await expect(provider.describe()).rejects.toThrow("Opaque capability key helper returned invalid JSON");
    await expect(provider.issue({
      capabilityKey: "opaque-third-key",
      credentialId: "opaque-third-missing",
      capabilities: [apiCapabilityId("knowledge.search")]
    })).rejects.toThrow("Opaque capability key helper returned invalid JSON");

    provider.close();
  });

  it("propagates command helper execution failures", async () => {
    const dataDir = await tempDir("pact-final-third-command-fail-");
    const binDir = await tempDir("pact-final-third-command-fail-bin-");
    const helperPath = path.join(binDir, "opaque-failing-helper");
    const alias = "final third command failure";

    await writeExecutable(helperPath, `
const fs = require("node:fs");
const action = (() => {
  try {
    return JSON.parse(fs.readFileSync(0, "utf8") || "{}").action;
  } catch {
    return "";
  }
})();
if (action === "describe") {
  console.error("helper describe failed");
  process.exit(1);
}
console.log(JSON.stringify({
  protocolVersion: "v0.0.1:risk-control:opaque-capability-key-1",
  provider: "command",
  generation: 7,
  runtimeLookupKeyBase64: "${Buffer.alloc(32, 9).toString("base64")}"
}));
`);

    const provider = createCommandOpaqueCapabilityKeyProvider({
      backend: "local-file",
      dataDir,
      alias,
      command: helperPath,
      args: [],
      bindingStore: createMemoryCapabilityKeyBindingStore()
    });

    await expect(provider.describe()).rejects.toThrow("helper describe failed");
    provider.close();
  });

  it("surfaces invalid runtime-lookup keys from command helpers as boundary rejections", async () => {
    const dataDir = await tempDir("pact-final-third-command-short-key-");
    const binDir = await tempDir("pact-final-third-command-short-key-bin-");
    const helperPath = path.join(binDir, "opaque-short-key-helper");
    const alias = "final third command short key";
    const shortKey = Buffer.alloc(31, 7).toString("base64");

    await writeExecutable(helperPath, `
const fs = require("node:fs");
const action = (() => {
  try {
    return JSON.parse(fs.readFileSync(0, "utf8") || "{}").action;
  } catch {
    return "";
  }
})();
const payload = {
  protocolVersion: "v0.0.1:risk-control:opaque-capability-key-1",
  provider: "command",
  generation: 1,
  runtimeLookupKeyBase64: "${shortKey}"
};
if (action === "describe") {
  console.log(JSON.stringify({ ...payload }));
  process.exit(0);
}
console.log(JSON.stringify(payload));
`);

    const provider = createCommandOpaqueCapabilityKeyProvider({
      backend: "local-file",
      dataDir,
      alias,
      command: helperPath,
      args: [],
      bindingStore: createMemoryCapabilityKeyBindingStore()
    });

    await expect(provider.issue({
      credentialId: "opaque-short-key-credential",
      capabilities: [apiCapabilityId("knowledge.search")]
    })).rejects.toThrow("Runtime lookup key helper returned an invalid key.");

    provider.close();
  });

  it("recovers from stale opaque kernel state locks and continues mutation", async () => {
    const dataDir = await tempDir("pact-final-third-stale-lock-");
    const alias = "opaque/final third stale lock";
    const credentialId = "stale-lock-credential";
    const keyProvider = createOpaqueCapabilityKeyProvider({
      backend: "local-file",
      dataDir,
      alias
    });

    const initial = await keyProvider.issue({
      credentialId,
      capabilities: [apiCapabilityId("knowledge.search")]
    });
    keyProvider.close();

    const lockPath = path.join(dataDir, "security", "locks", `capability-kernel-${sanitizeAlias(alias)}.lock`);
    await fs.mkdir(path.dirname(lockPath), { recursive: true });
    await fs.writeFile(lockPath, "stale lock marker");
    const staleDate = nowDate(45_000);
    await fs.utimes(lockPath, staleDate, staleDate);

    const reopened = createOpaqueCapabilityKeyProvider({
      backend: "local-file",
      dataDir,
      alias
    });
    const updated = await reopened.issue({
      credentialId: "stale-lock-credential-v2",
      capabilities: [apiCapabilityId("knowledge.search")]
    });
    expect(updated.credentialId).toBe("stale-lock-credential-v2");

    await expect(reopened.verify({
      capabilityKey: initial.capabilityKey,
      requiredCapability: apiCapabilityId("knowledge.search")
    })).resolves.toMatchObject({
      ok: true,
      reasonCode: "capability_key_valid"
    });
    await expect(fs.access(lockPath)).rejects.toThrow();
    reopened.close();
  });

  it("falls back to local-file binding guard state when pass backend writes fail on linux auto", async () => {
    const dataDir = await tempDir("pact-final-third-pass-fallback-");
    const binDir = await tempDir("pact-final-third-pass-bin-");
    const alias = "binding/final third pass fallback";
    const capabilityKey = createCapabilityKey();
    const statePath = capabilityBindingGuardStatePath({ dataDir, alias });

    const passStatePath = path.join(binDir, "pact-pass-state");
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
  console.error("cannot write to password store");
  process.exit(1);
}
`);

    await withPlatform("linux", async () => withEnv({
      PATH: `${binDir}`,
      FAKE_PASS_STATE_FILE: passStatePath
    }, async () => {
      const guard = createCapabilityBindingGuard({
        backend: "auto",
        dataDir,
        alias
      });

      const bound = await guard.bindCapabilityKey({
        key: capabilityKey,
        credentialId: "binding-pass-fallback",
        context: {
          namespace: "tool-management"
        }
      });

      expect(bound).toMatchObject({
        credentialId: "binding-pass-fallback",
        bindingStrength: "namespace"
      });

      const description = await guard.describe();
      expect(description).toMatchObject({
        provider: "pass-gpg",
        securityMode: "user_keyring",
        bindingCount: 1,
        activeBindingCount: 1,
        statePath: ""
      });
      await expect(fs.access(statePath)).resolves.toBeUndefined();
      await expect(fs.access(passStatePath)).rejects.toThrow();

      await expect(guard.verifyCapabilityKeyBinding({
        capabilityKey,
        credentialId: "binding-pass-fallback",
        context: {
          namespace: "tool-management"
        }
      })).resolves.toMatchObject({
        ok: true,
        applicable: true,
        credentialId: "binding-pass-fallback"
      });
      guard.close();
    }));

    await withPlatform("linux", async () => withEnv({
      PATH: ""
    }, async () => {
      const reopened = createCapabilityBindingGuard({
        backend: "auto",
        dataDir,
        alias
      });
      expect(await reopened.describe()).toMatchObject({
        provider: "local-file",
        securityMode: "degraded_file_fallback",
        bindingCount: 1,
        activeBindingCount: 1
      });
      await expect(reopened.verifyCapabilityKeyBinding({
        capabilityKey,
        credentialId: "binding-pass-fallback",
        context: {
          namespace: "tool-management"
        }
      })).resolves.toMatchObject({
        ok: true,
        applicable: true,
        credentialId: "binding-pass-fallback"
      });
      reopened.close();
    }));
  });
});
