import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  apiCapabilityId,
  toolExecuteCapabilityId,
} from "../../../server/platform/common/security/authorization/authorization-engine.mjs";
import {
  capabilityKernelStatePath,
  capabilityKeyHash,
  capabilityPermissionHash,
  canonicalOpaqueCapabilities,
  createCapabilityKey,
  createMemoryOpaqueCapabilityKeyProvider,
  opaqueCapabilityHash,
  OPAQUE_CAPABILITY_KEY_PROTOCOL_VERSION,
} from "../../../server/platform/common/security/authorization/opaque-capability-key.mjs";

const tempRoots = [];

async function tempDir(prefix) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("authorization opaque capability key extra branches", () => {
  it("normalizes helper inputs, hashes consistently, and rejects short lookup keys", () => {
    const canonical = canonicalOpaqueCapabilities([
      "  cap:tool:pact.knowledge.health:execute  ",
      "cap:api:knowledge.search",
      "cap:tool:pact.knowledge.health:execute"
    ]);

    expect(canonical).toEqual([
      "cap:api:knowledge.search",
      "cap:tool:pact.knowledge.health:execute"
    ]);
    expect(opaqueCapabilityHash([
      "cap:tool:pact.knowledge.health:execute",
      "cap:api:knowledge.search"
    ])).toBe(opaqueCapabilityHash(canonical));

    const key = createCapabilityKey();
    expect(key).toMatch(/^ock_[A-Za-z0-9_-]+$/);

    const runtimeLookupKey = Buffer.alloc(32, 17);
    const runtimeLookupKeyBase64 = runtimeLookupKey.toString("base64");
    expect(capabilityKeyHash(runtimeLookupKey, key)).toBe(capabilityKeyHash(runtimeLookupKeyBase64, key));
    expect(capabilityPermissionHash(runtimeLookupKey, "cap:api:knowledge.search"))
      .toBe(capabilityPermissionHash(runtimeLookupKeyBase64, "cap:api:knowledge.search"));

    expect(() => capabilityKeyHash(Buffer.alloc(31), key))
      .toThrow("Capability key lookup requires a 256-bit runtime lookup key.");
    expect(() => capabilityPermissionHash(Buffer.alloc(31), "cap:api:knowledge.search"))
      .toThrow("Capability permission lookup requires a 256-bit runtime lookup key.");

    expect(capabilityKernelStatePath({
      dataDir: "/tmp/unit data",
      alias: "alias with spaces"
    })).toContain("alias_with_spaces.sealed.json");
  });

  it("rejects unknown capabilities and honors exact, api, tool, and global wildcard permissions", async () => {
    const provider = createMemoryOpaqueCapabilityKeyProvider({
      alias: "authorization-opaque-extra"
    });

    await expect(provider.verify({})).resolves.toMatchObject({
      ok: false,
      reasonCode: "capability_key_missing"
    });

    await expect(provider.verify({
      capabilityKey: "missing-key",
      requiredCapabilities: []
    })).resolves.toMatchObject({
      ok: false,
      reasonCode: "capability_required"
    });

    await expect(provider.verify({
      capabilityKey: "missing-key",
      requiredCapability: "cap:api:not-a-real-capability"
    })).resolves.toMatchObject({
      ok: false,
      reasonCode: "unknown_capability",
      unknownCapabilities: ["cap:api:not-a-real-capability"]
    });

    await expect(provider.issue({
      capabilities: ["cap:api:knowledge.search", "cap:api:not-a-real-capability"]
    })).rejects.toThrow("Unknown opaque capability permission: cap:api:not-a-real-capability");

    const apiKey = await provider.issue({
      capabilityKey: "opaque-api-key",
      credentialId: "api-credential",
      capabilities: [apiCapabilityId("knowledge.search")]
    });
    await expect(provider.verify({
      capabilityKey: apiKey.capabilityKey,
      requiredCapability: apiCapabilityId("knowledge.search"),
      includeRecordDetails: true
    })).resolves.toMatchObject({
      ok: true,
      reasonCode: "capability_key_valid",
      credentialId: "api-credential"
    });

    const toolWildcardKey = await provider.issue({
      capabilityKey: "opaque-tool-key",
      credentialId: "tool-credential",
      capabilities: ["cap:tool:*"]
    });
    await expect(provider.verify({
      capabilityKey: toolWildcardKey.capabilityKey,
      requiredCapability: toolExecuteCapabilityId("pact.knowledge.health")
    })).resolves.toMatchObject({
      ok: true,
      reasonCode: "capability_key_valid",
      credentialId: "tool-credential"
    });

    const apiWildcardKey = await provider.issue({
      capabilityKey: "opaque-api-wildcard-key",
      credentialId: "api-wildcard-credential",
      capabilities: ["cap:api:*"]
    });
    await expect(provider.verify({
      capabilityKey: apiWildcardKey.capabilityKey,
      requiredCapability: apiCapabilityId("knowledge.search")
    })).resolves.toMatchObject({
      ok: true,
      reasonCode: "capability_key_valid",
      credentialId: "api-wildcard-credential"
    });

    const globalWildcardKey = await provider.issue({
      capabilityKey: "opaque-global-wildcard-key",
      credentialId: "global-wildcard-credential",
      capabilities: ["cap:*"]
    });
    await expect(provider.verify({
      capabilityKey: globalWildcardKey.capabilityKey,
      requiredCapability: apiCapabilityId("knowledge.search")
    })).resolves.toMatchObject({
      ok: true,
      reasonCode: "capability_key_valid",
      credentialId: "global-wildcard-credential"
    });

    provider.close();
  });
});
