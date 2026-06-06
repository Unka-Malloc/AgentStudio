import { describe, expect, it, vi } from "vitest";
import path from "node:path";
import os from "node:os";
import {
  apiCapabilityId,
  AUTHORIZATION_PROTOCOL_VERSION,
  assertKnownKernelCapabilities,
  createAuthorizationEngine,
  evaluateAuthorizationPolicy,
  unknownKernelCapabilities,
  resolveAuthorizationSubject,
  toolExecuteCapabilityId
} from "../../../server/platform/common/security/authorization/authorization-engine.mjs";
import {
  capabilityBindingGuardStatePath,
  capabilityBindingKeyHash,
  capabilityBindingSubjectHash,
  createMemoryCapabilityBindingGuard,
  normalizeCapabilityBindingContext
} from "../../../server/platform/common/security/authorization/capability-binding-guard.mjs";
import {
  capabilityKernelStatePath,
  capabilityKeyHash,
  capabilityPermissionHash,
  canonicalOpaqueCapabilities,
  createMemoryOpaqueCapabilityKeyProvider,
  createCapabilityKey,
  opaqueCapabilityHash
} from "../../../server/platform/common/security/authorization/opaque-capability-key.mjs";

describe("server authorization kernel – opaque capability key", () => {
  it("canonicalizes capabilities and hashes capability sets deterministically", () => {
    const normalized = canonicalOpaqueCapabilities([
      "  cap:tool:pact.knowledge.health:execute  ",
      "cap:api:knowledge.search",
      "cap:api:knowledge.search",
      "",
      "   ",
      "cap:tool:pact.knowledge.health:execute"
    ]);

    expect(normalized).toEqual([
      "cap:api:knowledge.search",
      "cap:tool:pact.knowledge.health:execute"
    ]);
    expect(opaqueCapabilityHash(normalized)).toBe(opaqueCapabilityHash(["cap:tool:pact.knowledge.health:execute", "cap:api:knowledge.search", "cap:tool:pact.knowledge.health:execute"]));
  });

  it("guards key hash functions against short runtime lookup keys", () => {
    const shortKey = Buffer.alloc(16);

    expect(() => capabilityKeyHash(shortKey, createCapabilityKey())).toThrow("Capability key lookup requires a 256-bit runtime lookup key.");
    expect(() => capabilityPermissionHash(shortKey, apiCapabilityId("knowledge.search"))).toThrow("Capability permission lookup requires a 256-bit runtime lookup key.");

    const validKey = Buffer.alloc(32).fill(4);
    const first = capabilityKeyHash(validKey, "plain-key");
    const second = capabilityPermissionHash(validKey, apiCapabilityId("knowledge.search"));
    expect(first).not.toEqual(second);
    expect(typeof first).toBe("string");
    expect(typeof second).toBe("string");
  });

  it("issues and verifies opaque capability keys in memory mode", async () => {
    const provider = createMemoryOpaqueCapabilityKeyProvider({ alias: "unit-memory-capability" });

    const issued = await provider.issue({
      credentialId: "unit-credential",
      capabilities: [
        apiCapabilityId("knowledge.search"),
        toolExecuteCapabilityId("pact.knowledge.health")
      ],
      ttlMs: 60_000
    });

    expect(issued.protocolVersion).toBe("pact.opaque-capability-key.v1");
    expect(issued.credentialId).toBe("unit-credential");
    expect(typeof issued.capabilityKey).toBe("string");
    expect(issued.capabilityKey.startsWith("ock_")).toBe(true);

    const baselineDecision = await provider.verify({
      capabilityKey: issued.capabilityKey,
      requiredCapability: apiCapabilityId("knowledge.search")
    });
    expect(baselineDecision.ok).toBe(true);
    expect(baselineDecision.reasonCode).toBe("capability_key_valid");
    expect(baselineDecision).not.toHaveProperty("capabilitySetHash");

    const withDetails = await provider.verify({
      capabilityKey: issued.capabilityKey,
      requiredCapability: apiCapabilityId("knowledge.search"),
      includeRecordDetails: true
    });
    expect(withDetails.ok).toBe(true);
    expect(withDetails).toHaveProperty("capabilitySetHash");
    expect(withDetails).toHaveProperty("constraints");

    const deniedByMissing = await provider.verify({
      capabilityKey: issued.capabilityKey,
      requiredCapability: apiCapabilityId("knowledge.health")
    });
    expect(deniedByMissing.ok).toBe(false);
    expect(deniedByMissing.reasonCode).toBe("missing_capabilities");
    expect(deniedByMissing.missingCapabilities).toEqual([apiCapabilityId("knowledge.health")]);

    const deniedByUnknown = await provider.verify({
      capabilityKey: issued.capabilityKey,
      requiredCapability: apiCapabilityId("unknown.operation")
    });
    expect(deniedByUnknown.ok).toBe(false);
    expect(deniedByUnknown.reasonCode).toBe("unknown_capability");
    expect(deniedByUnknown.unknownCapabilities).toEqual([apiCapabilityId("unknown.operation")]);

    expect(await provider.verify({ requiredCapability: apiCapabilityId("knowledge.search") })).toMatchObject({
      ok: false,
      reasonCode: "capability_key_missing"
    });

    expect(unknownKernelCapabilities(apiCapabilityId("unknown.operation"))).toEqual([apiCapabilityId("unknown.operation")]);
    expect(() => assertKnownKernelCapabilities(apiCapabilityId("unknown.operation"))).toThrow("Unknown kernel capability permission");

    provider.close();
  });

  it("supports wildcard capability verification paths", async () => {
    const provider = createMemoryOpaqueCapabilityKeyProvider({ alias: "unit-memory-capability-wildcard" });
    const issued = await provider.issue({
      credentialId: "unit-credential-wildcard",
      capabilities: ["cap:api:*"]
    });

    const wildcardDecision = await provider.verify({
      capabilityKey: issued.capabilityKey,
      requiredCapability: apiCapabilityId("knowledge.search")
    });
    expect(wildcardDecision.ok).toBe(true);
    expect(wildcardDecision.requiredCapabilities).toEqual([apiCapabilityId("knowledge.search")]);

    provider.close();
  });

  it("rotates keys and invalidates prior opaque credentials", async () => {
    const provider = createMemoryOpaqueCapabilityKeyProvider({ alias: "unit-memory-capability-rotation" });

    const issued = await provider.issue({
      credentialId: "unit-rotate-credential",
      capabilities: [apiCapabilityId("knowledge.search")]
    });

    const rotated = await provider.rotateCapabilityKey({
      capabilityKey: issued.capabilityKey,
      capabilities: [apiCapabilityId("knowledge.search.get")]
    });
    expect(rotated.ok).toBe(true);
    expect(rotated.oldStatus).toBe("invalid");

    const oldDecision = await provider.verify({
      capabilityKey: issued.capabilityKey,
      requiredCapability: apiCapabilityId("knowledge.search")
    });
    expect(oldDecision.ok).toBe(false);
    expect(oldDecision.reasonCode).toBe("capability_key_invalid");

    const newDecision = await provider.verify({
      capabilityKey: rotated.capabilityKey,
      requiredCapability: apiCapabilityId("knowledge.search.get")
    });
    expect(newDecision.ok).toBe(true);

    const noCapabilities = await provider.rotateCapabilityKey({
      capabilityKey: rotated.capabilityKey,
      capabilities: []
    });
    expect(noCapabilities).toEqual({ ok: false, reasonCode: "capabilities_required_for_rotation" });

    const description = await provider.describe();
    expect(description).toMatchObject({
      provider: "memory",
      alias: "unit-memory-capability-rotation",
      runtimeLookupLoaded: true,
      bindingCount: 2,
      runtimeLookupLoadCount: 1
    });

    provider.close();
  });

  it("exposes sanitized path helpers and provider mode fields", () => {
    const pathFromAlias = capabilityKernelStatePath({
      dataDir: path.join(os.tmpdir(), "pact-server-data"),
      alias: "unit/../alias@name"
    });
    const fallbackPath = capabilityKernelStatePath({});

    expect(pathFromAlias).toContain("unit_.._alias_name.sealed.json");
    expect(fallbackPath).toContain("pact-opaque-capability-key.sealed.json");
  });
});

describe("server authorization kernel – capability binding guard", () => {
  const exampleCapabilityKey = createCapabilityKey();

  it("normalizes binding context and validates binding hashes", () => {
    const context = normalizeCapabilityBindingContext({
      boundUserId: "u-1",
      agentId: "a-1",
      bound_namespace: "tool-management",
      client_name: "cli-client"
    });

    expect(context).toMatchObject({
      namespace: "tool-management",
      userId: "u-1"
    });

    const tinyLookupKey = Buffer.alloc(8);
    expect(() => capabilityBindingKeyHash(tinyLookupKey, exampleCapabilityKey)).toThrow("Capability binding guard requires a 256-bit lookup key.");
    expect(() => capabilityBindingSubjectHash(tinyLookupKey, "user", "u-1")).toThrow("Capability binding guard requires a 256-bit lookup key.");
  });

  it("issues and verifies binding records, and rejects boundary mismatch cases", async () => {
    const guard = createMemoryCapabilityBindingGuard({ alias: "unit-binding-normal" });
    const boundKey = createCapabilityKey();

    const bound = await guard.bindCapabilityKey({
      key: boundKey,
      credentialId: "unit-binding-credential",
      context: {
        namespace: "tool-management",
        userId: "unit-user",
        agentId: "unit-agent",
        clientId: "unit-client"
      }
    });
    expect(bound).toMatchObject({
      credentialId: "unit-binding-credential",
      bindingStrength: "user+agent+client",
      requireUser: true,
      requireAgent: true,
      requireClient: true
    });

    const sameDecision = await guard.verifyCapabilityKeyBinding({
      capabilityKey: boundKey,
      context: {
        namespace: "tool-management",
        userId: "unit-user",
        agentId: "unit-agent",
        clientId: "unit-client"
      }
    });

    expect(sameDecision.ok).toBe(true);
    expect(sameDecision.applicable).toBe(true);

    const wrongNamespaceDecision = await guard.verifyCapabilityKeyBinding({
      credentialId: "unit-binding-credential",
      capabilityKey: boundKey,
      context: {
        namespace: "other-namespace",
        userId: "unit-user",
        agentId: "unit-agent",
        clientId: "unit-client"
      }
    });
    expect(wrongNamespaceDecision.ok).toBe(false);
    expect(wrongNamespaceDecision.reasonCode).toBe("binding_namespace_mismatch");

    const missingKeyDecision = await guard.verifyCapabilityKeyBinding({
      credentialId: "unit-binding-credential",
      context: {
        namespace: "tool-management",
        userId: "unit-user"
      }
    });
    expect(missingKeyDecision.ok).toBe(false);
    expect(missingKeyDecision.reasonCode).toBe("capability_key_missing");

    guard.close();
  });

  it("reports expired, unregistered and invalidated bindings correctly", async () => {
    const guard = createMemoryCapabilityBindingGuard({ alias: "unit-binding-lifecycle" });
    const expiredKey = createCapabilityKey();
    const expiredBinding = await guard.bindCapabilityKey({
      key: expiredKey,
      credentialId: "unit-binding-expired",
      expiresAt: "2000-01-01T00:00:00.000Z",
      context: {
        namespace: "tool-management",
        userId: "expired-user"
      }
    });

    expect(expiredBinding.requireClient).toBe(false);

    const expiredDecision = await guard.verifyCapabilityKeyBinding({
      capabilityKey: expiredKey,
      credentialId: "unit-binding-expired",
      context: {
        namespace: "tool-management",
        userId: "expired-user"
      },
      now: "2001-01-01T00:00:00.000Z"
    });
    expect(expiredDecision.ok).toBe(false);
    expect(expiredDecision.reasonCode).toBe("binding_expired");

    const unregistered = await guard.verifyCapabilityKeyBinding({
      capabilityKey: createCapabilityKey(),
      credentialId: "ghost-credential",
      context: {
        namespace: "tool-management"
      }
    });
    expect(unregistered).toMatchObject({
      ok: true,
      applicable: false,
      reasonCode: "capability_binding_not_registered"
    });

    const validBindingKey = createCapabilityKey();
    const validBinding = await guard.bindCapabilityKey({
      key: validBindingKey,
      credentialId: "unit-binding-invalidate",
      context: {
        namespace: "tool-management",
        userId: "invalidate-user"
      }
    });
    const invalidated = await guard.invalidateCapabilityKeyBinding({
      capabilityKey: validBindingKey,
      credentialId: "unit-binding-invalidate",
      reason: "test invalidation"
    });
    expect(invalidated).toHaveLength(1);
    expect(invalidated[0]).toMatchObject({
      credentialId: "unit-binding-invalidate",
      status: "invalid"
    });

    const invalidDecision = await guard.verifyCapabilityKeyBinding({
      capabilityKey: validBindingKey,
      credentialId: "unit-binding-invalidate",
      context: {
        namespace: "tool-management",
        userId: "invalidate-user"
      }
    });
    expect(invalidDecision.ok).toBe(false);
    expect(invalidDecision.reasonCode).toBe("binding_invalid");

    const description = await guard.describe();
    expect(description).toMatchObject({
      provider: "memory",
      securityMode: "memory",
      alias: "unit-binding-lifecycle",
      bindingCount: 2,
      activeBindingCount: 1,
      degraded: false
    });

    const bindingStatePath = capabilityBindingGuardStatePath({ alias: "unit-binding-lifecycle", dataDir: path.join(os.tmpdir(), "pact-server-data") });
    expect(bindingStatePath).toContain("unit-binding-lifecycle.sealed.json");
    guard.close();
  });
});

describe("server authorization policy engine – pure logic branches", () => {
  it("allows capability-driven tool authorization when requirements are satisfied", () => {
    const engine = createAuthorizationEngine();

    const decision = engine.evaluate({
      tool: {
        id: "pact.knowledge.health",
        status: "active"
      },
      grant: {
        id: "grant-health",
        capabilities: [toolExecuteCapabilityId("pact.knowledge.health")]
      }
    });

    expect(decision.protocolVersion).toBe(AUTHORIZATION_PROTOCOL_VERSION);
    expect(decision.allowed).toBe(true);
    expect(decision.effect).toBe("allow");
    expect(decision.requiredCapabilities).toEqual([toolExecuteCapabilityId("pact.knowledge.health")]);
    expect(decision.reasonCode).toBe("allowed");
    expect(decision.evaluatedLayers).toContain("tool_catalog_policy");
  });

  it("denies missing capabilities and surfaces exact missing capability lists", () => {
    const engine = createAuthorizationEngine();

    const decision = engine.evaluate({
      tool: {
        id: "pact.knowledge.health",
        status: "active"
      },
      grant: {
        id: "grant-health-missing",
        capabilities: [toolExecuteCapabilityId("pact.knowledge.search")]
      }
    });

    expect(decision.allowed).toBe(false);
    expect(decision.effect).toBe("deny");
    expect(decision.reasonCode).toBe("missing_capabilities");
    expect(decision.missingCapabilities).toEqual([toolExecuteCapabilityId("pact.knowledge.health")]);
  });

  it("uses scope-based authorization when no capability requirement exists", () => {
    const allowByScope = createAuthorizationEngine().evaluate({
      operation: {
        id: "unknown.operation",
        requiredScopes: ["knowledge:read"]
      },
      subject: {
        subjectId: "scope-subject",
        scopes: ["knowledge:read"]
      }
    });

    const denyByScope = createAuthorizationEngine().evaluate({
      operation: {
        id: "unknown.operation",
        requiredScopes: ["knowledge:admin"]
      },
      subject: {
        subjectId: "scope-subject",
        scopes: ["knowledge:read"]
      }
    });

    expect(allowByScope.allowed).toBe(true);
    expect(allowByScope.missingScopes).toEqual([]);
    expect(denyByScope.allowed).toBe(false);
    expect(denyByScope.reasonCode).toBe("missing_scopes");
    expect(denyByScope.missingScopes).toEqual(["knowledge:admin"]);
  });

  it("denies unknown tools and missing grants in expected order", () => {
    const decisionUnknown = createAuthorizationEngine().evaluate({
      operation: { id: "knowledge.search" },
      context: { toolExpected: true }
    });
    const decisionMissingGrant = createAuthorizationEngine().evaluate({
      operation: { id: "knowledge.search" },
      grantRequired: true
    });

    expect(decisionUnknown.reasonCode).toBe("unknown_tool");
    expect(decisionMissingGrant.reasonCode).toBe("missing_grant");
  });

  it("evaluates tenant boundary policy before scope/tool checks", () => {
    const decision = createAuthorizationEngine().evaluate({
      operation: { id: "knowledge.search" },
      subject: {
        tenantId: "tenant-1",
        capabilities: [apiCapabilityId("knowledge.search")]
      },
      context: {
        tenantId: "tenant-2"
      }
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reasonCode).toBe("tenant_mismatch");
  });

  it("returns deny for inactive tools and toolset/policy restrictions", () => {
    const inactive = createAuthorizationEngine().evaluate({
      tool: {
        id: "pact.knowledge.health",
        status: "inactive"
      },
      grant: {
        id: "grant-health",
        capabilities: [toolExecuteCapabilityId("pact.knowledge.health")]
      }
    });

    const missingToolset = createAuthorizationEngine().evaluate({
      tool: {
        id: "pact.knowledge.health",
        status: "active"
      },
      grant: {
        id: "grant-health",
        toolsets: ["other-toolset"],
        capabilities: [toolExecuteCapabilityId("pact.knowledge.health")]
      }
    });

    const deniedTool = createAuthorizationEngine().evaluate({
      tool: {
        id: "pact.knowledge.health",
        status: "active"
      },
      grant: {
        id: "grant-health",
        toolDeny: ["pact.knowledge.health"],
        capabilities: [toolExecuteCapabilityId("pact.knowledge.health")]
      },
      profile: {
        toolAllow: ["pact.knowledge.health"]
      }
    });

    const deniedProfile = createAuthorizationEngine().evaluate({
      tool: {
        id: "pact.knowledge.health",
        status: "active"
      },
      grant: {
        id: "grant-health",
        capabilities: [toolExecuteCapabilityId("pact.knowledge.health")]
      },
      profile: {
        toolDeny: ["pact.knowledge.health"]
      }
    });

    expect(inactive.reasonCode).toBe("tool_inactive");
    expect(missingToolset.reasonCode).toBe("missing_toolsets");
    expect(deniedTool.reasonCode).toBe("tool_denied");
    expect(deniedProfile.reasonCode).toBe("profile_tool_denied");
  });

  it("covers grant lifecycle denial branches", () => {
    const expired = createAuthorizationEngine().evaluate({
      operation: { id: "knowledge.search", readOnly: true },
      grant: {
        id: "expired-grant",
        status: "valid",
        expiresAt: "2000-01-01T00:00:00.000Z",
        capabilities: [apiCapabilityId("knowledge.search")]
      },
      subject: {
        subjectId: "s",
        scopes: []
      }
    });

    const maxUses = createAuthorizationEngine().evaluate({
      operation: {
        id: "knowledge.search",
        requiredScopes: ["knowledge:read"],
        readOnly: true
      },
      subject: {
        subjectId: "s",
        scopes: ["knowledge:read"]
      },
      grant: {
        id: "limited-grant",
        maxUses: 1,
        useCount: 1,
        capabilities: [apiCapabilityId("knowledge.search")]
      }
    });

    const notAllowedOrigin = createAuthorizationEngine().evaluate({
      operation: {
        id: "unknown.operation",
        requiredScopes: []
      },
      subject: {
        subjectId: "s",
        scopes: []
      },
      grant: {
        id: "grant-origin",
        allowedOrigins: ["https://allowed.local"]
      },
      request: {
        headers: { origin: "https://blocked.local" }
      }
    });

    const deniedByCidr = createAuthorizationEngine().evaluate({
      operation: {
        id: "unknown.operation",
        requiredScopes: []
      },
      subject: {
        subjectId: "s",
        scopes: []
      },
      grant: {
        id: "grant-cidr",
        allowedCidrs: ["10.0.0.0/8"]
      },
      request: {
        headers: {
          "x-forwarded-for": "192.168.1.9"
        }
      }
    });

    const rateLimited = createAuthorizationEngine().evaluate({
      operation: {
        id: "unknown.operation",
        requiredScopes: []
      },
      context: {
        rateLimited: true
      },
      subject: {
        subjectId: "s",
        scopes: []
      },
      grant: {
        id: "grant-rate-limit"
      }
    });

    expect(expired.reasonCode).toBe("grant_expired");
    expect(maxUses.reasonCode).toBe("grant_max_uses");
    expect(notAllowedOrigin.reasonCode).toBe("origin_not_allowed");
    expect(deniedByCidr.reasonCode).toBe("cidr_not_allowed");
    expect(rateLimited.reasonCode).toBe("rate_limited");
  });

  it("allows public operations and handles dry-run / confirmation paths", () => {
    const publicDecision = createAuthorizationEngine().evaluate({
      operation: {
        id: "unauthenticated.public",
        public: true
      },
      subject: {
        subjectId: "public-subject"
      }
    });

    const dryRunDecision = createAuthorizationEngine().evaluate({
      operation: {
        id: "unknown.operation",
        readOnly: true,
        requiredScopes: []
      },
      subject: {
        subjectId: "dry-run-subject",
        capabilities: ["cap:api:unknown.operation"]
      },
      dryRun: true
    });

    const riskDecision = createAuthorizationEngine().evaluate({
      tool: {
        id: "pact.knowledge.health",
        status: "active",
        risk: "destructive"
      },
      grant: {
        id: "grant-risk",
        capabilities: [toolExecuteCapabilityId("pact.knowledge.health")]
      },
      profile: {
        maxRisk: "destructive"
      }
    });

    const confirmationDecision = createAuthorizationEngine().evaluate({
      tool: {
        id: "pact.knowledge.health",
        status: "active",
        requiresApproval: true,
        risk: "destructive"
      },
      grant: {
        id: "grant-approval",
        maxRisk: "destructive",
        capabilities: [toolExecuteCapabilityId("pact.knowledge.health")]
      },
      profile: {
        maxRisk: "destructive"
      }
    });

    expect(publicDecision.allowed).toBe(true);
    expect(publicDecision.effect).toBe("allow");
    expect(dryRunDecision.effect).toBe("dry_run_only");
    expect(dryRunDecision.allowed).toBe(true);
    expect(riskDecision.effect).toBe("allow");
    expect(confirmationDecision.effect).toBe("require_confirmation");
  });

  it("supports governance decisions before local policy checks", () => {
    const denyStore = {
      evaluateGovernance: vi.fn().mockReturnValue({
        applicable: true,
        effect: "deny",
        reasonCode: "gov-deny",
        redactedReason: "governance policy denied",
        deniedLayer: "governance",
        effectivePolicySnapshot: { policy: "policy-id" }
      })
    };
    const needApproveStore = {
      evaluateGovernance: vi.fn().mockReturnValue({
        applicable: true,
        effect: "needsApproval",
        reasonCode: "gov-approval",
        redactedReason: "needs operator approval",
        deniedLayer: "governance",
        requiredApproval: { code: "operator-approval" },
        effectivePolicySnapshot: { policy: "policy-id" }
      })
    };
    const allowStore = {
      evaluateGovernance: vi.fn().mockReturnValue({
        applicable: true,
        effect: "allow",
        reasonCode: "gov-allow",
        redactedReason: "governance allowed",
        effectivePolicySnapshot: { policy: "policy-id" }
      })
    };

    const input = {
      operation: {
        id: "knowledge.search",
        requiredScopes: ["knowledge:read"]
      },
      subject: {
        subjectId: "subject",
        scopes: ["knowledge:read"],
        capabilities: [apiCapabilityId("knowledge.search")]
      }
    };

    const denied = evaluateAuthorizationPolicy({
      ...input,
      grant: {
        id: "grant-gov",
        capabilities: [apiCapabilityId("knowledge.search")]
      },
      governanceStore: denyStore,
      governanceRequired: true
    });

    const needsApproval = evaluateAuthorizationPolicy({
      ...input,
      grant: {
        id: "grant-gov",
        capabilities: [apiCapabilityId("knowledge.search")]
      },
      governanceStore: needApproveStore,
      governanceRequired: true
    });

    const allowedByGovernance = evaluateAuthorizationPolicy({
      ...input,
      grant: {
        id: "grant-gov",
        capabilities: [apiCapabilityId("knowledge.search")]
      },
      governanceStore: allowStore,
      governanceRequired: true
    });

    expect(denied.effect).toBe("deny");
    expect(denied.deniedLayer).toBe("governance");
    expect(needsApproval.effect).toBe("needsApproval");
    expect(needsApproval.requiredApproval).toEqual({ code: "operator-approval" });
    expect(allowedByGovernance.effect).toBe("allow");
    expect(allowedByGovernance.reasonCode).toBe("gov-allow");
  });

  it("resolves authorization subjects across branch inputs", () => {
    const subjectBranch = resolveAuthorizationSubject({
      subject: {
        type: "subject-bridge",
        subjectId: "subject-1",
        scopes: ["knowledge:read"],
        capabilities: ["cap:api:knowledge.search"],
        metadata: { attributes: { level: 1 } }
      },
      actor: { userId: "actor-user" }
    });

    const grantBranch = resolveAuthorizationSubject({
      grant: {
        id: "grant-1",
        capabilities: ["cap:api:knowledge.search"],
        maxRisk: "destructive"
      }
    });

    const actorOnly = resolveAuthorizationSubject({
      actor: {
        userId: "actor-id",
        roleId: "admin",
        scopes: ["scope:actor"],
        capabilities: ["cap:api:knowledge.get"]
      }
    });

    const anonymous = resolveAuthorizationSubject({});

    expect(subjectBranch.type).toBe("subject-bridge");
    expect(subjectBranch.attributes).toEqual({ level: 1 });
    expect(grantBranch.type).toBe("tool-grant");
    expect(grantBranch.maxRisk).toBe("destructive");
    expect(actorOnly.type).toBe("actor");
    expect(actorOnly.subjectId).toBe("actor-id");
    expect(anonymous.type).toBe("anonymous");
  });
});
