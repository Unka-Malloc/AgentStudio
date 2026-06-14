import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  apiCapabilityId,
  evaluateAuthorizationPolicy,
  normalizeKernelCapabilities,
  toolExecuteCapabilityId,
  unknownKernelCapabilities
} from "../../../server/platform/common/security/authorization/authorization-engine.mjs";
import {
  capabilityKernelStatePath,
  createCapabilityKey,
  createMemoryCapabilityKeyBindingStore,
  createOpaqueCapabilityKeyProvider,
  OPAQUE_CAPABILITY_KEY_PROTOCOL_VERSION
} from "../../../server/platform/common/security/authorization/opaque-capability-key.mjs";

const tempRoots = [];

async function tempDir(prefix) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

function createMockLookupKeySource({
  runtimeLookupKeyBase64 = Buffer.alloc(32, 41).toString("base64"),
  provider = "mock",
  securityMode = "mock-keyring",
  generation = 7,
  runtimeLookupKeyRotationSupported = true
} = {}) {
  let loadCount = 0;
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
      return {
        protocolVersion: OPAQUE_CAPABILITY_KEY_PROTOCOL_VERSION,
        provider,
        generation: generation + 1
      };
    },
    describe() {
      return {
        protocolVersion: OPAQUE_CAPABILITY_KEY_PROTOCOL_VERSION,
        provider,
        securityMode,
        generation,
        loadCount,
        runtimeLookupKeyRotationSupported,
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

describe("opaque capability authorization final extra 6 coverage", () => {
  it("normalizes wildcard and comma-separated capability inputs and handles origin, referer, and CIDR boundary checks", () => {
    const normalized = normalizeKernelCapabilities(
      "  cap:api:knowledge.search, cap:tool:pact.agentLibrary.health:execute  ",
      ["cap:*", " cap:tool:* "],
      "cap:api:knowledge.search"
    );

    expect(normalized).toEqual([
      "cap:api:knowledge.search",
      "cap:tool:pact.agentLibrary.health:execute",
      "cap:*",
      "cap:tool:*"
    ]);
    expect(unknownKernelCapabilities("cap:api:knowledge.search, cap:unknown", ["cap:*"])).toEqual([
      "cap:unknown"
    ]);

    const subject = {
      subjectId: "subject-1",
      capabilities: [toolExecuteCapabilityId("pact.agentLibrary.health")]
    };
    const operation = { id: "unknown.operation", requiredScopes: [] };

    const originAllowed = evaluateAuthorizationPolicy({
      operation,
      subject,
      grant: {
        id: "grant-origin",
        allowedOrigins: ["https://allowed.local"]
      },
      request: {
        headers: {
          origin: "https://allowed.local/"
        }
      }
    });

    const refererDenied = evaluateAuthorizationPolicy({
      operation,
      subject,
      grant: {
        id: "grant-referer",
        allowedOrigins: ["https://allowed.local"]
      },
      request: {
        headers: {
          referer: "not a valid url"
        }
      }
    });

    const cidrDenied = evaluateAuthorizationPolicy({
      operation,
      subject,
      grant: {
        id: "grant-cidr",
        allowedCidrs: ["10.0.0.0/33"]
      },
      request: {
        headers: {
          "x-forwarded-for": "10.1.2.3"
        }
      }
    });

    expect(originAllowed.allowed).toBe(true);
    expect(originAllowed.effect).toBe("allow");
    expect(refererDenied.reasonCode).toBe("origin_not_allowed");
    expect(cidrDenied.reasonCode).toBe("cidr_not_allowed");
  });

  it("applies tool/profile allowlists before risk gating and confirmation requirements", () => {
    const tool = {
      id: "pact.agentLibrary.health",
      status: "active",
      risk: "read_only"
    };
    const subject = {
      subjectId: "subject-allowlists",
      capabilities: [toolExecuteCapabilityId("pact.agentLibrary.health")]
    };
    const grant = {
      id: "grant-allowlists",
      capabilities: [toolExecuteCapabilityId("pact.agentLibrary.health")],
      maxRisk: "destructive"
    };

    const toolDenied = evaluateAuthorizationPolicy({
      tool,
      subject,
      grant: {
        ...grant,
        toolAllow: ["pact.knowledge.summary"]
      },
      profile: {
        maxRisk: "destructive"
      }
    });

    const profileDenied = evaluateAuthorizationPolicy({
      tool,
      subject,
      grant: {
        ...grant,
        toolAllow: [tool.id]
      },
      profile: {
        maxRisk: "destructive",
        toolAllow: ["pact.knowledge.summary"]
      }
    });

    const riskDenied = evaluateAuthorizationPolicy({
      tool: {
        ...tool,
        risk: "destructive"
      },
      subject,
      grant,
      profile: {
        maxRisk: "safe_write"
      }
    });

    const confirmationRequired = evaluateAuthorizationPolicy({
      tool: {
        ...tool,
        requiresApproval: true
      },
      subject,
      grant,
      profile: {
        maxRisk: "destructive"
      }
    });

    const confirmationAllowed = evaluateAuthorizationPolicy({
      tool: {
        ...tool,
        requiresApproval: true
      },
      subject,
      grant,
      profile: {
        maxRisk: "destructive"
      },
      input: {
        confirm: true
      }
    });

    expect(toolDenied.reasonCode).toBe("tool_not_allowed");
    expect(profileDenied.reasonCode).toBe("profile_tool_not_allowed");
    expect(riskDenied.reasonCode).toBe("risk_exceeds_policy");
    expect(confirmationRequired.effect).toBe("require_confirmation");
    expect(confirmationAllowed.effect).toBe("allow");
  });

  it("covers local-file describe recovery, validation, invalidation, rotation, and recovery helper error branches", async () => {
    const dataDir = await tempDir("pact-opaque-final-extra-6-local-");
    const alias = "opaque/final extra 6";

    const provider = createOpaqueCapabilityKeyProvider({
      backend: "local-file",
      dataDir,
      alias
    });

    const issued = await provider.issue({
      capabilityKey: "opaque-final-extra-6-key",
      credentialId: "opaque-final-extra-6-credential",
      capabilities: [apiCapabilityId("knowledge.search")],
      grantVersion: 3
    });

    expect(issued).toMatchObject({
      protocolVersion: OPAQUE_CAPABILITY_KEY_PROTOCOL_VERSION,
      credentialId: "opaque-final-extra-6-credential",
      capabilityKey: "opaque-final-extra-6-key",
      capabilityCount: 1
    });

    const initialDescription = await provider.describe();
    expect(initialDescription).toMatchObject({
      protocolVersion: OPAQUE_CAPABILITY_KEY_PROTOCOL_VERSION,
      provider: "local-file",
      alias: "opaque/final extra 6",
      bindingCount: 1,
      runtimeLookupLoaded: true
    });

    await expect(provider.verify({ requiredCapability: apiCapabilityId("knowledge.search") }))
      .resolves.toMatchObject({
        ok: false,
        reasonCode: "capability_key_missing"
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
      reasonCode: "unknown_capability"
    });

    await expect(provider.verify({
      capabilityKey: issued.capabilityKey,
      requiredCapability: apiCapabilityId("knowledge.search"),
      minGrantVersion: 4
    })).resolves.toMatchObject({
      ok: false,
      reasonCode: "credential_grant_version_stale"
    });

    await expect(provider.verify({
      capabilityKey: issued.capabilityKey,
      requiredCapability: apiCapabilityId("knowledge.search")
    })).resolves.toMatchObject({
      ok: true,
      reasonCode: "capability_key_valid"
    });

    expect(await provider.invalidate()).toBeNull();
    expect(await provider.invalidateCredential()).toEqual([]);

    await expect(provider.rotateCapabilityKey({
      capabilityKey: issued.capabilityKey,
      capabilities: []
    })).resolves.toMatchObject({
      ok: false,
      reasonCode: "capabilities_required_for_rotation"
    });

    const rotated = await provider.rotateCapabilityKey({
      capabilityKey: issued.capabilityKey,
      capabilities: [apiCapabilityId("knowledge.search")],
      reason: "rotated"
    });
    expect(rotated).toMatchObject({
      ok: true,
      oldStatus: "invalid",
      status: "valid"
    });

    const invalidated = await provider.invalidate({
      capabilityKey: issued.capabilityKey,
      reason: "revoked"
    });
    expect(invalidated).toMatchObject({
      status: "invalid",
      invalidationReason: "revoked"
    });

    await expect(provider.verify({
      capabilityKey: issued.capabilityKey,
      requiredCapability: apiCapabilityId("knowledge.search")
    })).resolves.toMatchObject({
      ok: false,
      reasonCode: "capability_key_invalid"
    });

    await expect(provider.rotateCapabilityKey({
      capabilityKey: issued.capabilityKey,
      capabilities: [apiCapabilityId("knowledge.search")]
    })).resolves.toMatchObject({
      ok: false,
      reasonCode: "capability_key_invalid"
    });

    await expect(provider.exportRecoveryPackage({
      passphrase: ""
    })).rejects.toThrow("Capability kernel recovery export requires a passphrase.");

    await expect(provider.importRecoveryPackage({
      recoveryPackage: {
        protocolVersion: "broken"
      },
      passphrase: "unit-passphrase"
    })).rejects.toThrow("Unsupported capability kernel recovery package.");

    provider.close();

    const statePath = capabilityKernelStatePath({ dataDir, alias });
    const onDisk = JSON.parse(await fs.readFile(statePath, "utf8"));
    onDisk.stateRoot = "tampered-state-root";
    await fs.writeFile(statePath, `${JSON.stringify(onDisk, null, 2)}\n`);

    const reopened = createOpaqueCapabilityKeyProvider({
      backend: "local-file",
      dataDir,
      alias
    });

    await expect(reopened.describe()).rejects.toThrow("Capability kernel sealed state root mismatch.");
    reopened.close();
  });

  it("rejects malformed runtime lookup helpers with invalid key material", async () => {
    const provider = createOpaqueCapabilityKeyProvider({
      backend: "memory",
      alias: "opaque/final extra 6 malformed",
      bindingStore: createMemoryCapabilityKeyBindingStore(),
      lookupKeySource: createMockLookupKeySource({
        runtimeLookupKeyBase64: Buffer.alloc(31, 7).toString("base64"),
        provider: "malformed",
        securityMode: "broken"
      })
    });

    await expect(provider.issue({
      capabilityKey: createCapabilityKey(),
      capabilities: [apiCapabilityId("knowledge.search")]
    })).rejects.toThrow("Runtime lookup key helper returned an invalid key.");

    provider.close();
  });
});
