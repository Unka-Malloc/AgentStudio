import { describe, expect, it } from "vitest";
import {
  apiCapabilityId,
  toolExecuteCapabilityId
} from "../../../server/platform/common/security/authorization/authorization-engine.mjs";
import {
  createMemoryCapabilityBindingGuard,
  capabilityBindingKeyHash,
  capabilityBindingSubjectHash,
  normalizeCapabilityBindingContext
} from "../../../server/platform/common/security/authorization/capability-binding-guard.mjs";
import {
  createMemoryOpaqueCapabilityKeyProvider
} from "../../../server/platform/common/security/authorization/opaque-capability-key.mjs";

describe("authorization capability key and binding final second extra coverage", () => {
  it("covers opaque wildcard fallbacks, missing keys, empty capability failures, and expiry", async () => {
    const provider = createMemoryOpaqueCapabilityKeyProvider({
      alias: "final-second-opaque"
    });

    await expect(provider.issue({
      credentialId: "empty-capabilities",
      capabilities: []
    })).rejects.toThrow("Capability key binding requires at least one kernel capability.");

    const apiWildcard = await provider.issue({
      capabilityKey: "api-wildcard-key",
      credentialId: "api-wildcard-credential",
      capabilities: ["cap:api:*"]
    });
    expect(apiWildcard).toMatchObject({
      credentialId: "api-wildcard-credential",
      capabilityKey: "api-wildcard-key",
      capabilityCount: 1
    });

    await expect(provider.verify({
      capabilityKey: "api-wildcard-key",
      requiredCapability: apiCapabilityId("knowledge.search")
    })).resolves.toMatchObject({
      ok: true,
      reasonCode: "capability_key_valid",
      credentialId: "api-wildcard-credential"
    });

    const toolWildcard = await provider.issue({
      capabilityKey: "tool-wildcard-key",
      credentialId: "tool-wildcard-credential",
      capabilities: ["cap:tool:*"]
    });
    expect(toolWildcard).toMatchObject({
      credentialId: "tool-wildcard-credential",
      capabilityKey: "tool-wildcard-key",
      capabilityCount: 1
    });

    await expect(provider.verify({
      capabilityKey: "tool-wildcard-key",
      requiredCapability: toolExecuteCapabilityId("pact.knowledge.health")
    })).resolves.toMatchObject({
      ok: true,
      reasonCode: "capability_key_valid",
      credentialId: "tool-wildcard-credential"
    });

    const expired = await provider.issue({
      capabilityKey: "expired-key",
      credentialId: "expired-credential",
      capabilities: [apiCapabilityId("knowledge.search")],
      expiresAt: "2000-01-01T00:00:00.000Z"
    });
    expect(expired).toMatchObject({
      credentialId: "expired-credential",
      capabilityKey: "expired-key"
    });

    await expect(provider.verify({
      capabilityKey: "expired-key",
      requiredCapability: apiCapabilityId("knowledge.search")
    })).resolves.toMatchObject({
      ok: false,
      reasonCode: "capability_key_expired",
      credentialId: "expired-credential"
    });

    await expect(provider.verify({
      requiredCapability: apiCapabilityId("knowledge.search")
    })).resolves.toMatchObject({
      ok: false,
      reasonCode: "capability_key_missing"
    });

    provider.close();
  });

  it("covers binding normalization defaults, lookup-key guards, expiry, and mismatch reasons", async () => {
    expect(normalizeCapabilityBindingContext({})).toMatchObject({
      namespace: "tool-management",
      userId: "",
      boundUserId: "",
      agentId: "",
      agentProfileId: "",
      clientId: ""
    });

    const runtimeLookupKey = Buffer.alloc(32, 19);
    expect(() => capabilityBindingKeyHash(Buffer.alloc(31), "capability-key")).toThrow(
      "Capability binding guard requires a 256-bit lookup key."
    );
    expect(() => capabilityBindingSubjectHash(Buffer.alloc(31), "user", "user-1")).toThrow(
      "Capability binding guard requires a 256-bit lookup key."
    );
    expect(capabilityBindingKeyHash(runtimeLookupKey, "binding-valid-key")).toBe(
      capabilityBindingKeyHash(runtimeLookupKey.toString("base64"), "binding-valid-key")
    );
    expect(capabilityBindingSubjectHash(runtimeLookupKey, "user", "user-1")).toBe(
      capabilityBindingSubjectHash(runtimeLookupKey.toString("base64"), "user", "user-1")
    );

    const guard = createMemoryCapabilityBindingGuard({
      alias: "final-second-binding"
    });

    const expiredKey = "binding-expired-key";
    await guard.bindCapabilityKey({
      key: expiredKey,
      credentialId: "binding-expired-credential",
      context: {
        namespace: "tenant-a",
        userId: "user-1",
        agentId: "agent-1",
        clientId: "client-1"
      },
      expiresAt: "2000-01-01T00:00:00.000Z"
    });
    await expect(guard.verifyCapabilityKeyBinding({
      capabilityKey: expiredKey,
      credentialId: "binding-expired-credential",
      context: {
        namespace: "tenant-a",
        userId: "user-1",
        agentId: "agent-1",
        clientId: "client-1"
      }
    })).resolves.toMatchObject({
      ok: false,
      applicable: true,
      reasonCode: "binding_expired"
    });

    const validKey = "binding-valid-key";
    await guard.bindCapabilityKey({
      key: validKey,
      credentialId: "binding-valid-credential",
      context: {
        namespace: "tenant-a",
        userId: "user-1",
        agentId: "agent-1",
        clientId: "client-1"
      }
    });

    await expect(guard.verifyCapabilityKeyBinding({
      capabilityKey: validKey,
      credentialId: "binding-valid-credential",
      context: {
        namespace: "tenant-a",
        userId: "user-2",
        agentId: "agent-1",
        clientId: "client-1"
      }
    })).resolves.toMatchObject({
      ok: false,
      applicable: true,
      reasonCode: "binding_user_mismatch"
    });

    await expect(guard.verifyCapabilityKeyBinding({
      capabilityKey: validKey,
      credentialId: "binding-valid-credential",
      context: {
        namespace: "tenant-a",
        userId: "user-1",
        clientId: "client-1"
      }
    })).resolves.toMatchObject({
      ok: false,
      applicable: true,
      reasonCode: "binding_agent_missing"
    });

    await expect(guard.verifyCapabilityKeyBinding({
      capabilityKey: validKey,
      credentialId: "binding-valid-credential",
      context: {
        namespace: "tenant-a",
        userId: "user-1",
        agentId: "agent-2",
        clientId: "client-1"
      }
    })).resolves.toMatchObject({
      ok: false,
      applicable: true,
      reasonCode: "binding_agent_mismatch"
    });

    await expect(guard.verifyCapabilityKeyBinding({
      capabilityKey: validKey,
      credentialId: "binding-valid-credential",
      context: {
        namespace: "tenant-a",
        userId: "user-1",
        agentId: "agent-1"
      }
    })).resolves.toMatchObject({
      ok: false,
      applicable: true,
      reasonCode: "binding_client_missing"
    });

    await expect(guard.verifyCapabilityKeyBinding({
      capabilityKey: validKey,
      credentialId: "binding-valid-credential",
      context: {
        namespace: "tenant-a",
        userId: "user-1",
        agentId: "agent-1",
        clientId: "client-2"
      }
    })).resolves.toMatchObject({
      ok: false,
      applicable: true,
      reasonCode: "binding_client_mismatch"
    });

    const description = await guard.describe();
    expect(description).toMatchObject({
      protocolVersion: "pact.capability-binding-guard.v1",
      provider: "memory",
      securityMode: "memory",
      alias: "final-second-binding",
      bindingCount: 2,
      activeBindingCount: 2
    });

    guard.close();
  });
});
