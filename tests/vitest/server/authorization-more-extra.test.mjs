import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { apiCapabilityId } from "../../../server/platform/common/security/authorization/authorization-engine.mjs";
import {
  createAuthorizationGovernanceStore
} from "../../../server/platform/common/security/authorization/authorization-governance-store.mjs";
import {
  capabilityBindingGuardStatePath,
  capabilityBindingKeyHash,
  capabilityBindingSubjectHash,
  createCapabilityBindingGuard,
  normalizeCapabilityBindingContext
} from "../../../server/platform/common/security/authorization/capability-binding-guard.mjs";
import {
  capabilityKeyHash,
  capabilityPermissionHash,
  capabilityKernelStatePath,
  createCapabilityKey,
  createOpaqueCapabilityKeyProvider,
  OPAQUE_CAPABILITY_KEY_PROTOCOL_VERSION
} from "../../../server/platform/common/security/authorization/opaque-capability-key.mjs";

const tempRoots = [];

async function tempDir(prefix) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("authorization more extra coverage", () => {
  it("round-trips opaque capability key encoding helpers and rejects undersized lookup keys", () => {
    const capabilityKey = createCapabilityKey();
    const payload = capabilityKey.slice("ock_".length);

    expect(capabilityKey.startsWith("ock_")).toBe(true);
    expect(Buffer.from(payload, "base64url").length).toBe(32);

    const runtimeLookupKey = Buffer.alloc(32, 23);
    const runtimeLookupKeyBase64 = runtimeLookupKey.toString("base64");
    const capability = apiCapabilityId("knowledge.search");

    expect(capabilityKeyHash(runtimeLookupKey, capabilityKey)).toBe(capabilityKeyHash(runtimeLookupKeyBase64, capabilityKey));
    expect(capabilityPermissionHash(runtimeLookupKey, capability)).toBe(capabilityPermissionHash(runtimeLookupKeyBase64, capability));
    expect(capabilityKeyHash(runtimeLookupKey, capabilityKey)).not.toBe(capabilityPermissionHash(runtimeLookupKey, capability));

    expect(() => capabilityKeyHash(Buffer.alloc(31), capabilityKey)).toThrow(
      "Capability key lookup requires a 256-bit runtime lookup key."
    );
    expect(() => capabilityPermissionHash(Buffer.alloc(31), capability)).toThrow(
      "Capability permission lookup requires a 256-bit runtime lookup key."
    );
  });

  it("persists opaque key state, keeps secrets off disk, and rejects recovery boundary errors", async () => {
    const dataDir = await tempDir("pact-authorization-more-opaque-");
    const alias = "opaque/more extra alias";
    const provider = createOpaqueCapabilityKeyProvider({
      backend: "local-file",
      dataDir,
      alias
    });

    const capabilityKey = createCapabilityKey();
    const issued = await provider.issue({
      credentialId: "opaque-extra-credential",
      capabilityKey,
      capabilities: [apiCapabilityId("knowledge.search")],
      constraints: {
        workspaceId: "workspace-a"
      },
      metadata: {
        reason: "more-extra-test"
      },
      grantVersion: 3
    });

    expect(issued).toMatchObject({
      protocolVersion: OPAQUE_CAPABILITY_KEY_PROTOCOL_VERSION,
      credentialId: "opaque-extra-credential",
      capabilityKey,
      capabilityCount: 1
    });

    await expect(provider.verify({
      capabilityKey,
      requiredCapability: apiCapabilityId("knowledge.search"),
      includeRecordDetails: true
    })).resolves.toMatchObject({
      ok: true,
      reasonCode: "capability_key_valid",
      credentialId: "opaque-extra-credential",
      grantVersion: 3,
      constraints: {
        workspaceId: "workspace-a"
      },
      metadata: {
        reason: "more-extra-test"
      }
    });

    const statePath = capabilityKernelStatePath({ dataDir, alias });
    const persisted = await fs.readFile(statePath, "utf8");
    expect(statePath).toContain("opaque_more_extra_alias.sealed.json");
    expect(persisted).not.toContain(capabilityKey);
    expect(persisted).not.toContain("workspace-a");

    await expect(provider.exportRecoveryPackage({ passphrase: "" })).rejects.toThrow(
      "Capability kernel recovery export requires a passphrase."
    );
    await expect(provider.importRecoveryPackage({
      recoveryPackage: { protocolVersion: "unsupported" },
      passphrase: "correct horse battery staple"
    })).rejects.toThrow("Unsupported capability kernel recovery package.");

    const recoveryPackage = await provider.exportRecoveryPackage({
      passphrase: "correct horse battery staple",
      reason: "round-trip"
    });
    provider.close();

    const reopened = createOpaqueCapabilityKeyProvider({
      backend: "local-file",
      dataDir,
      alias
    });
    await expect(reopened.importRecoveryPackage({
      recoveryPackage,
      passphrase: "correct horse battery staple"
    })).resolves.toMatchObject({
      ok: true,
      alias: "opaque_more_extra_alias",
      protocolVersion: OPAQUE_CAPABILITY_KEY_PROTOCOL_VERSION
    });

    await expect(reopened.verify({
      capabilityKey,
      requiredCapability: apiCapabilityId("knowledge.search")
    })).resolves.toMatchObject({
      ok: true,
      credentialId: "opaque-extra-credential"
    });

    provider.close();
    reopened.close();
  });

  it("validates binding records, exposes mismatch reasons, and rejects empty recovery inputs", async () => {
    const dataDir = await tempDir("pact-authorization-more-binding-");
    const alias = "binding/more extra alias";
    const guard = createCapabilityBindingGuard({
      backend: "local-file",
      dataDir,
      alias
    });

    const capabilityKey = createCapabilityKey();

    await expect(guard.bindCapabilityKey({
      credentialId: "missing-key"
    })).rejects.toThrow("Capability binding guard requires an opaque capability key.");

    const normalized = normalizeCapabilityBindingContext({
      bound_user_id: "user-1",
      agent_profile_id: "agent-1",
      client_name: "client-1",
      binding_namespace: "tenant-a"
    });
    expect(normalized).toMatchObject({
      namespace: "tenant-a",
      userId: "user-1",
      agentId: "agent-1",
      clientId: "client-1"
    });

    const bound = await guard.bindCapabilityKey({
      key: capabilityKey,
      credentialId: "binding-extra-credential",
      context: normalized,
      ttlMs: 60_000
    });
    expect(bound).toMatchObject({
      protocolVersion: "v0.0.1:risk-control:capability-binding-guard-1",
      credentialId: "binding-extra-credential",
      bindingStrength: "user+agent+client",
      requireUser: true,
      requireAgent: true,
      requireClient: true
    });

    await expect(guard.verifyCapabilityKeyBinding({
      capabilityKey,
      credentialId: "binding-extra-credential",
      context: {
        namespace: "tenant-a",
        userId: "user-1",
        agentId: "agent-1",
        clientId: "client-1"
      }
    })).resolves.toMatchObject({
      ok: true,
      applicable: true,
      credentialId: "binding-extra-credential",
      bindingStrength: "user+agent+client"
    });

    await expect(guard.verifyCapabilityKeyBinding({
      capabilityKey,
      credentialId: "binding-extra-credential",
      context: {
        namespace: "tenant-b",
        userId: "user-1",
        agentId: "agent-1",
        clientId: "client-1"
      }
    })).resolves.toMatchObject({
      ok: false,
      applicable: true,
      reasonCode: "binding_namespace_mismatch"
    });

    await expect(guard.verifyCapabilityKeyBinding({
      capabilityKey,
      credentialId: "binding-extra-credential",
      context: {
        namespace: "tenant-a",
        agentId: "agent-1",
        clientId: "client-1"
      }
    })).resolves.toMatchObject({
      ok: false,
      applicable: true,
      reasonCode: "binding_user_missing"
    });

    const statePath = capabilityBindingGuardStatePath({ dataDir, alias });
    const persisted = await fs.readFile(statePath, "utf8");
    expect(statePath).toContain("binding_more_extra_alias.sealed.json");
    expect(persisted).not.toContain(capabilityKey);
    expect(persisted).not.toContain("user-1");

    await expect(guard.exportRecoveryPackage({ passphrase: "" })).rejects.toThrow(
      "Capability binding guard recovery export requires a passphrase."
    );
    await expect(guard.importRecoveryPackage({
      recoveryPackage: { protocolVersion: "unsupported" },
      passphrase: "correct horse battery staple"
    })).rejects.toThrow("Unsupported capability binding guard recovery package.");

    const recoveryPackage = await guard.exportRecoveryPackage({
      passphrase: "correct horse battery staple",
      reason: "round-trip"
    });
    guard.close();

    const reopened = createCapabilityBindingGuard({
      backend: "local-file",
      dataDir,
      alias
    });
    await expect(reopened.importRecoveryPackage({
      recoveryPackage,
      passphrase: "correct horse battery staple"
    })).resolves.toMatchObject({
      ok: true,
      alias: "binding_more_extra_alias",
      protocolVersion: "v0.0.1:risk-control:capability-binding-guard-1"
    });

    await expect(reopened.verifyCapabilityKeyBinding({
      capabilityKey,
      credentialId: "binding-extra-credential",
      context: {
        namespace: "tenant-a",
        userId: "user-1",
        agentId: "agent-1",
        clientId: "client-1"
      }
    })).resolves.toMatchObject({
      ok: true,
      applicable: true
    });

    guard.close();
    reopened.close();
  });

  it("covers governance store boundaries, empty lookups, and approval-driven decision branches", async () => {
    const userDataPath = await tempDir("pact-authorization-more-governance-");
    const store = createAuthorizationGovernanceStore({ userDataPath });
    try {
      expect(store.getRole("missing-role")).toBeNull();
      expect(store.getTeam("missing-team")).toBeNull();
      expect(store.getUserPolicy("missing-user")).toBeNull();
      expect(store.getAgentGroup("missing-group")).toBeNull();
      expect(store.getAgentBinding("missing-agent")).toBeNull();
      expect(store.getApproval("missing-approval")).toBeNull();
      expect(store.revokeApproval("missing-approval")).toBeNull();
      expect(store.hasGovernancePolicies()).toBe(false);
      expect(store.getPolicyRevision()).toMatchObject({
        protocolVersion: "v0.0.1:risk-control:governance-policy-revision-1",
        revision: 0
      });

      expect(store.listRoles().map((role) => role.roleId)).toEqual([
        "admin",
        "operator",
        "owner",
        "viewer"
      ]);

      store.upsertTeam({
        teamId: "team-a",
        label: "Team A",
        resourcePolicies: [
          {
            resourceType: "repo",
            resourceId: "*",
            actions: ["repo:read", "repo:write"]
          }
        ]
      });
      store.upsertUserPolicy({
        userId: "user-a",
        roleIds: [],
        teamIds: ["team-a"],
        resourcePolicies: [
          {
            resourceType: "repo",
            resourceId: "*",
            actions: ["repo:read", "repo:write"]
          }
        ]
      });
      store.upsertAgentGroup({
        groupId: "group-a",
        resourcePolicies: []
      });
      store.upsertAgentBinding({
        agentId: "agent-a",
        boundUserId: "user-a",
        groupIds: ["group-a"],
        resourcePolicies: []
      });
      const approval = store.upsertApproval({
        approvalId: "approval-a",
        userId: "user-a",
        agentId: "agent-a",
        resourceType: "repo",
        resourceId: "*",
        actions: ["repo:write"],
        targetProviders: ["gerrit"],
        grantKind: "once",
        effect: "allow"
      });

      expect(store.hasGovernancePolicies()).toBe(true);
      expect(store.getPolicyRevision().revision).toBeGreaterThan(0);
      expect(store.listTeams().map((team) => team.teamId)).toContain("team-a");
      expect(store.listUserPolicies().map((policy) => policy.userId)).toContain("user-a");
      expect(store.listAgentGroups().map((group) => group.groupId)).toContain("group-a");
      expect(store.listAgentBindings().map((binding) => binding.agentId)).toContain("agent-a");
      expect(store.listApprovals({ userId: "user-a" }).map((entry) => entry.approvalId)).toContain("approval-a");

      const notApplicable = store.evaluateGovernance({
        operation: { id: "knowledge.search" },
        subject: { type: "console-user", subjectId: "user-a" }
      });
      expect(notApplicable).toMatchObject({
        applicable: false,
        reasonCode: "governance_not_applicable"
      });

      const discoveryAllowed = store.evaluateGovernance({
        operation: { id: "codespace.providers.manifest" },
        subject: {
          type: "service",
          subjectId: "agent-user"
        },
        input: {
          agentId: "agent-b"
        }
      });
      expect(discoveryAllowed).toMatchObject({
        applicable: true,
        effect: "allow",
        reasonCode: "agent_readonly_discovery_allowed"
      });

      const userApprovalRequired = store.evaluateGovernance({
        operation: { id: "repo.push" },
        subject: {
          type: "service",
          subjectId: "anonymous",
          teamIds: ["team-a"]
        }
      });
      expect(userApprovalRequired).toMatchObject({
        applicable: true,
        effect: "needsApproval",
        deniedLayer: "user",
        reasonCode: "user_approval_required"
      });

      const agentApprovalRequired = store.evaluateGovernance({
        operation: { id: "repo.push" },
        subject: { type: "console-user", subjectId: "user-a" },
        input: {
          agentId: "agent-a",
          boundUserId: "user-a"
        }
      });
      expect(agentApprovalRequired).toMatchObject({
        applicable: true,
        effect: "needsApproval",
        deniedLayer: "agent",
        reasonCode: "agent_approval_required"
      });

      const revoked = store.revokeApproval("approval-a", "no-longer-needed");
      expect(revoked).toMatchObject({
        approvalId: "approval-a",
        revokedAt: expect.any(String),
        reason: "no-longer-needed"
      });
      expect(store.listApprovals({ userId: "user-a" })).toEqual([]);
      expect(store.listApprovals({ userId: "user-a", includeRevoked: true }).map((entry) => entry.approvalId)).toEqual([
        "approval-a"
      ]);
    } finally {
      store.close();
    }
  });
});
