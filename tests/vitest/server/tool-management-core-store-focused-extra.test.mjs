import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { toolExecuteCapabilityId } from "../../../server/platform/common/security/authorization/authorization-engine.mjs";
import { createToolManagementStore } from "../../../server/platform/specialized/capabilities/tools/tool-management-core/store.mjs";

function createTempUserDataPath() {
  return fs.mkdtemp(path.join(os.tmpdir(), "pact-tool-management-core-store-focused-extra-"));
}

async function withTempUserDataPath(testCase) {
  const userDataPath = await createTempUserDataPath();
  try {
    return await testCase(userDataPath);
  } finally {
    await fs.rm(userDataPath, { recursive: true, force: true });
  }
}

function createCapabilityProvider() {
  let issueCount = 0;
  const credentialIdsByToken = new Map();
  return {
    issue: vi.fn(async ({ credentialId, capabilities, expiresAt }) => {
      const capabilityKey = `ock_${credentialId}_${++issueCount}`;
      credentialIdsByToken.set(capabilityKey, credentialId);
      return {
        capabilityKey,
        credentialId,
        protocolVersion: "v0.0.1:risk-control:opaque-capability-key-1",
        capabilitySetHash: `hash_${(capabilities || []).length}`,
        capabilityCount: (capabilities || []).length,
        runtimeLookupGeneration: 3,
        expiresAt
      };
    }),
    verify: vi.fn(async ({ capabilityKey, requiredCapability }) => ({
      ok: true,
      credentialId: credentialIdsByToken.get(capabilityKey) || String(capabilityKey || "").replace(/^ock_/, ""),
      requiredCapability
    })),
    invalidateCredential: vi.fn(async () => undefined)
  };
}

function createBindingGuard() {
  return {
    bindCapabilityKey: vi.fn(async ({ credentialId, context }) => ({
      bindingId: `binding-${credentialId}`,
      protocolVersion: "v0.0.1:risk-control:capability-binding-guard-1",
      bindingStrength: context.agentId ? "strong" : "standard",
      requireUser: true,
      requireAgent: true,
      requireClient: true
    })),
    verifyCapabilityKeyBinding: vi.fn(async ({ context }) => ({ ok: true, context })),
    invalidateCapabilityKeyBinding: vi.fn(async () => undefined)
  };
}

describe("tool-management core store focused extra coverage", () => {
  it("covers capability resolution, policy stamping, sanitizeGrantMetadata, and binding-context aliases", async () => {
    await withTempUserDataPath(async (userDataPath) => {
      const capabilityProvider = createCapabilityProvider();
      const bindingGuard = createBindingGuard();
      const capabilityResolver = vi.fn(() => [
        toolExecuteCapabilityId("pact.agentLibrary.search")
      ]);
      const policyRevisionProvider = vi.fn(() => ({
        protocol_version: "v0.0.1:risk-control:policy-9",
        policyRevision: 7,
        updated_at: "2026-06-05T00:00:00.000Z"
      }));

      const store = createToolManagementStore({
        userDataPath,
        capabilityResolver,
        capabilityKeyProvider: capabilityProvider,
        capabilityBindingGuard: bindingGuard,
        governancePolicyRevisionProvider: policyRevisionProvider
      });
      try {
        const { grant, token } = await store.createGrant({
          label: "Opaque Grant",
          toolsets: "pact.agentLibrary.read, pact.agentLibrary.read",
          scopes: "knowledge:read,invalid:scope",
          rateLimit: { per_minute: "15" },
          metadata: {
            capabilities: [toolExecuteCapabilityId("pact.agentLibrary.search")],
            capabilityIds: [toolExecuteCapabilityId("pact.agentLibrary.search")],
            permissions: ["admin"],
            clientId: "client-1",
            clientName: "client-name-1"
          },
          agent_id: "agent-1",
          profile_id: "profile-1",
          bound_user_id: "user-1",
          team_ids: ["team-a", "team-a", "team-b"]
        });

        expect(token).toMatch(/^ock_/);
        expect(capabilityResolver).toHaveBeenCalledWith(expect.objectContaining({
          label: "Opaque Grant"
        }));
        expect(capabilityProvider.issue).toHaveBeenCalledWith(expect.objectContaining({
          credentialId: grant.id,
          capabilities: expect.arrayContaining([
            toolExecuteCapabilityId("pact.agentLibrary.search")
          ])
        }));
        expect(bindingGuard.bindCapabilityKey).toHaveBeenCalledWith(expect.objectContaining({
          credentialId: grant.id,
          context: {
            namespace: "tool-management",
            agentId: "agent-1",
            agentProfileId: "profile-1",
            userId: "user-1",
            boundUserId: "user-1",
            clientId: "client-1"
          }
        }));

        const rawGrant = store.getRawGrant(grant.id);
        expect(rawGrant.rateLimit).toEqual({ perMinute: 15 });
        expect(rawGrant.toolsets).toEqual(["pact.agentLibrary.read"]);
        expect(rawGrant.scopes).toEqual(["knowledge:read"]);
        expect(rawGrant.metadata).toMatchObject({
          clientId: "client-1",
          clientName: "client-name-1",
          agentId: "agent-1",
          agentProfileId: "profile-1",
          profileId: "profile-1",
          boundUserId: "user-1",
          userId: "user-1",
          teamIds: ["team-a", "team-b"],
          policyRevision: 7,
          policyRevisionUpdatedAt: "2026-06-05T00:00:00.000Z",
          policyRevisionProtocolVersion: "v0.0.1:risk-control:policy-9",
          credentialProtocol: "v0.0.1:risk-control:opaque-capability-key-1",
          credentialId: grant.id,
          capabilitySetHash: "hash_1",
          capabilityCount: 1,
          runtimeLookupGeneration: 3,
          credentialIssuedAt: expect.any(String),
          credentialExpiresAt: "9999-12-31T23:59:59.999Z"
        });
        expect(rawGrant.metadata).not.toHaveProperty("capabilities");
        expect(rawGrant.metadata).not.toHaveProperty("capabilityIds");
        expect(rawGrant.metadata).not.toHaveProperty("permissions");

        const publicGrant = store.getGrant(grant.id);
        expect(publicGrant).toMatchObject({
          id: grant.id,
          hasToken: true,
          credential: {
            protocolVersion: "v0.0.1:risk-control:opaque-capability-key-1",
            credentialId: grant.id,
            capabilitySetHash: "hash_1",
            capabilityCount: 1,
            runtimeLookupGeneration: 3,
            bindingProtocol: "v0.0.1:risk-control:capability-binding-guard-1",
            bindingStrength: "strong",
            bindingRequiredUser: true,
            bindingRequiredAgent: true,
            issuedAt: expect.any(String),
            expiresAt: "9999-12-31T23:59:59.999Z"
          }
        });

        const authorized = await store.authorizeRequest({
          request: {
            headers: {
              authorization: `Bearer ${token}`,
              "x-pact-binding-namespace": "tool-management",
              "x-pact-agent-id": "agent-1",
              "x-pact-agent-profile-id": "profile-1",
              "x-pact-bound-user-id": "user-1",
              "x-pact-client-id": "client-1",
              "x-pact-client-name": "client-name-1"
            }
          },
          tool: { id: "pact.agentLibrary.search" },
          context: {}
        });

        expect(authorized).toMatchObject({
          ok: true,
          sourceIp: ""
        });
        expect(bindingGuard.verifyCapabilityKeyBinding).toHaveBeenCalledWith(expect.objectContaining({
          capabilityKey: token,
          credentialId: grant.id,
          context: {
            namespace: "tool-management",
            agentId: "agent-1",
            agentProfileId: "profile-1",
            userId: "user-1",
            boundUserId: "user-1",
            clientId: "client-1"
          }
        }));

        const rotated = await store.rotateGrantToken(grant.id);
        expect(rotated.token).toMatch(/^ock_/);
        expect(rotated.token).not.toBe(token);
        expect(capabilityProvider.invalidateCredential).toHaveBeenCalledWith(expect.objectContaining({
          credentialId: grant.id,
          reason: "grant_token_rotated"
        }));
        expect(bindingGuard.invalidateCapabilityKeyBinding).toHaveBeenCalledWith(expect.objectContaining({
          credentialId: grant.id,
          reason: "grant_token_rotated"
        }));

        const revoked = await store.revokeGrant(grant.id, "revoked-for-test");
        expect(revoked).toMatchObject({
          id: grant.id,
          enabled: false,
          revokedAt: expect.any(String)
        });
        expect(capabilityProvider.invalidateCredential).toHaveBeenCalledWith(expect.objectContaining({
          credentialId: grant.id,
          reason: "revoked-for-test"
        }));
        expect(bindingGuard.invalidateCapabilityKeyBinding).toHaveBeenCalledWith(expect.objectContaining({
          credentialId: grant.id,
          reason: "revoked-for-test"
        }));
        expect(await store.authorizeRequest({
          request: { headers: { authorization: `Bearer ${token}` } },
          tool: { id: "pact.agentLibrary.search" }
        })).toMatchObject({
          ok: false,
          status: 401,
          reasonCode: "invalid_token"
        });

        const fallbackStore = createToolManagementStore({
          userDataPath,
          capabilityKeyProvider: false,
          capabilityBindingGuard: false
        });
        try {
          const fallbackGrant = await fallbackStore.createGrant({
            label: "Fallback Grant",
            scopes: "workspace:read",
            rateLimit: []
          });
          expect(fallbackGrant.grant.rateLimit).toEqual({ perMinute: 0 });
          expect(fallbackStore.getRawGrant(fallbackGrant.grant.id).metadata).not.toHaveProperty("policyRevision");
        } finally {
          fallbackStore.close();
        }
      } finally {
        store.close();
      }
    });
  });

  it("covers summarizeValue, metrics-export aliases, and MCP source-ip fallbacks", async () => {
    await withTempUserDataPath(async (userDataPath) => {
      const store = createToolManagementStore({
        userDataPath,
        capabilityKeyProvider: false,
        capabilityBindingGuard: false
      });
      try {
        const bufferPending = store.createPendingOperation({
          pendingOperationId: "pending-buffer",
          toolId: "pact.jobs.read",
          toolVersion: "1.0.0",
          operationId: "op-buffer",
          originalInput: Buffer.from("alpha"),
          createdAt: "2026-06-05T00:00:00.000Z"
        });
        const stringPending = store.createPendingOperation({
          pendingOperationId: "pending-string",
          toolId: "pact.jobs.read",
          toolVersion: "1.0.0",
          operationId: "op-string",
          originalInput: "hello",
          createdAt: "2026-06-05T00:00:01.000Z"
        });
        const arrayPending = store.createPendingOperation({
          pendingOperationId: "pending-array",
          toolId: "pact.jobs.read",
          toolVersion: "1.0.0",
          operationId: "op-array",
          originalInput: [1, 2, 3],
          createdAt: "2026-06-05T00:00:02.000Z"
        });

        expect(store.getPendingOperation(bufferPending.pendingOperationId, { includeOriginalInput: true })).toMatchObject({
          pendingOperationId: "pending-buffer",
          redactedInput: {
            type: "buffer",
            byteLength: 5,
            sha256: crypto.createHash("sha256").update(Buffer.from("alpha")).digest("hex")
          }
        });
        expect(store.getPendingOperation(stringPending.pendingOperationId, { includeOriginalInput: true })).toMatchObject({
          pendingOperationId: "pending-string",
          redactedInput: {
            value: "hello"
          }
        });
        expect(store.getPendingOperation(arrayPending.pendingOperationId, { includeOriginalInput: true })).toMatchObject({
          pendingOperationId: "pending-array",
          redactedInput: {
            type: "array",
            length: 3
          }
        });

        const mcpRequest = store.createMcpAuthorizationRequest({
          clientName: "fallback-client",
          requestedScopes: ["knowledge:read"],
          requestedTools: [{ id: "pact.agentLibrary.read" }],
          reason: "source-ip-fallback",
          request: {
            connection: {
              remoteAddress: "10.0.0.8"
            }
          }
        });
        expect(mcpRequest.status).toBe("pending");
        expect(store.listMcpAuthorizationRequests()).toEqual([
          expect.objectContaining({
            requestId: mcpRequest.requestId,
            sourceIp: "10.0.0.8",
            requestedScopes: ["knowledge:read"],
            requestedTools: [{ id: "pact.agentLibrary.read" }]
          })
        ]);
        expect(store.resolveMcpAuthorizationRequest({
          requestId: mcpRequest.requestId,
          resolution: "rejected"
        })).toBe(true);
        expect(store.listMcpAuthorizationRequests({ status: "rejected" })).toEqual([
          expect.objectContaining({
            requestId: mcpRequest.requestId,
            status: "rejected"
          })
        ]);
        expect(() => store.resolveMcpAuthorizationRequest({
          requestId: mcpRequest.requestId,
          resolution: "pending"
        })).toThrow("Invalid resolution status");

        store.appendMetric({
          toolId: "pact.jobs.read",
          grantId: "grant-a",
          status: "ok",
          durationMs: 120,
          inputBytes: 12,
          resultBytes: 18,
          transferBytes: 30,
          createdAt: "2026-06-05T00:10:00.000Z"
        });
        store.appendHttpRequestMetric({
          method: "POST",
          route: "/tools/run",
          statusCode: 500,
          completionStatus: "failed",
          requestBytes: 9,
          responseBytes: 6,
          transferBytes: 15,
          durationMs: 42,
          createdAt: "2026-06-05T00:10:01.000Z"
        });

        expect(store.metricsExport({ kind: "tool_calls", limit: 10 })).toMatchObject({
          counts: {
            toolMetricEvents: 1,
            httpRequestMetricEvents: 0,
            total: 1
          }
        });
        expect(store.metricsExport({ kind: "http", limit: 10 })).toMatchObject({
          counts: {
            toolMetricEvents: 0,
            httpRequestMetricEvents: 1,
            total: 1
          }
        });
        expect(store.metricsExport({ kind: "bogus", limit: 10 })).toMatchObject({
          counts: {
            toolMetricEvents: 1,
            httpRequestMetricEvents: 1,
            total: 2
          }
        });
      } finally {
        store.close();
      }
    });
  });
});
