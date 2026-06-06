import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createToolManagementStore,
  getToolManagementDatabasePath
} from "../../../server/platform/specialized/capabilities/tools/tool-management-core/store.mjs";
import { toolExecuteCapabilityId } from "../../../server/platform/common/security/authorization/authorization-engine.mjs";

const toolKnowledgeSearchCapability = toolExecuteCapabilityId("pact.knowledge.search");
const toolPolicyEvaluateCapability = toolExecuteCapabilityId("pact.authorization.policy.evaluate");

function createStore(userDataPath) {
  return createToolManagementStore({
    userDataPath,
    capabilityKeyProvider: {},
    capabilityBindingGuard: false
  });
}

function createStoreWithCapProvider(userDataPath, {
  capabilityKeyProvider,
  capabilityBindingGuard = false
} = {}) {
  return createToolManagementStore({
    userDataPath,
    capabilityKeyProvider,
    capabilityBindingGuard
  });
}

function createMockCapabilityKeyProvider({ allowVerify = true } = {}) {
  return {
    issue: vi.fn(async ({ credentialId, capabilities, expiresAt }) => ({
      capabilityKey: `ock_${credentialId}`,
      credentialId,
      protocolVersion: "pact.opaque-capability-key.v1",
      capabilitySetHash: `hash_${(capabilities || []).length}`,
      capabilityCount: (capabilities || []).length,
      runtimeLookupGeneration: 1,
      expiresAt: expiresAt || new Date(Date.now() + 60 * 60 * 1000).toISOString()
    })),
    verify: allowVerify
      ? vi.fn(async () => ({ ok: true }))
      : vi.fn(async () => ({ ok: false, reasonCode: "invalid_token" })),
    invalidateCredential: vi.fn(async () => undefined),
    close: vi.fn()
  };
}

function createMockBindingGuard({
  verifyResult = { ok: true },
  boundByDefault = false
} = {}) {
  return {
    bindCapabilityKey: vi.fn(async () => ({
      bindingId: `binding-${boundByDefault ? "bound" : "init"}`,
      protocolVersion: "pact.capability-binding-guard.v1",
      bindingStrength: boundByDefault ? "strict" : "standard",
      requireUser: false,
      requireAgent: false
    })),
    verifyCapabilityKeyBinding: vi.fn(async () => verifyResult),
    invalidateCapabilityKeyBinding: vi.fn(async () => undefined),
    close: vi.fn()
  };
}

async function withTempUserDataPath(testCase) {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-tool-management-store-extra-"));
  try {
    return await testCase(userDataPath);
  } finally {
    await fs.rm(userDataPath, { force: true, recursive: true });
  }
}

describe("tool-management store (extra coverage)", () => {
  it("emits grant and catalog change events for MCP catalog refresh wiring", async () => {
    await withTempUserDataPath(async (userDataPath) => {
      const changes = [];
      const store = createToolManagementStore({
        userDataPath,
        capabilityKeyProvider: {},
        capabilityBindingGuard: false,
        changeListener: (event) => {
          changes.push(event);
        }
      });
      try {
        const { grant } = await store.createGrant({
          label: "Refresh Grant",
          scopes: ["knowledge:read"]
        });
        store.updateGrant(grant.id, { label: "Refresh Grant Updated" });
        await store.rotateGrantToken(grant.id);
        await store.revokeGrant(grant.id, "refresh-test-revoke");
        store.saveCatalogSnapshot({
          fingerprint: "catalog-refresh-test",
          tools: [{ id: "pact.knowledge.search" }]
        });
        store.deleteGrant(grant.id);

        expect(changes.map((event) => event.reasonCode)).toEqual([
          "grant_created",
          "grant_updated",
          "grant_token_rotated",
          "grant_revoked",
          "catalog_snapshot_saved",
          "grant_deleted"
        ]);
        expect(changes.filter((event) => event.grantId === grant.id).length).toBe(5);
        expect(changes.find((event) => event.reasonCode === "catalog_snapshot_saved").catalogFingerprint).toBe("catalog-refresh-test");
      } finally {
        store.close();
      }
    });
  });

  it("初始化 store：创建数据库、目录与基本 schema", async () => {
    await withTempUserDataPath(async (userDataPath) => {
      const store = createStore(userDataPath);
      try {
        const dbPath = getToolManagementDatabasePath(userDataPath);
        const dbStat = await fs.stat(dbPath);
        const dbName = path.basename(dbPath);

        expect(dbStat.isFile()).toBe(true);
        expect(store.rootPath).toBe(path.join(userDataPath, "tool-management"));

        const tables = store.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name);
        expect(tables).toEqual(expect.arrayContaining([
          "tool_grants",
          "tool_grant_events",
          "tool_catalog_snapshots",
          "tool_executions",
          "tool_metric_events",
          "http_request_metric_events",
          "tool_pending_operations",
          "mcp_authorization_requests"
        ]));
        expect(dbName).toBe("tool-management.sqlite");
        expect(store.db.pragma("user_version", { simple: true })).toBe(4);
      } finally {
        store.close();
      }
    });
  });

  it("保存 catalog 快照并支持重复 fingerprint 幂等写入", async () => {
    await withTempUserDataPath(async (userDataPath) => {
      const store = createStore(userDataPath);
      try {
        const first = store.saveCatalogSnapshot({
          fingerprint: "catalog:v1",
          tools: [{ id: "pact.knowledge.read" }, { id: "pact.storage.read" }],
          profiles: ["default"],
          metadata: { source: "unit-test" }
        });

        expect(first).toEqual({ fingerprint: "catalog:v1" });
        expect(store.saveCatalogSnapshot({ tools: [{ id: "pact.knowledge.write" }] })).toBeNull();

        const updated = store.saveCatalogSnapshot({
          fingerprint: "catalog:v1",
          tools: [{ id: "pact.knowledge.write" }],
          metadata: { source: "changed" }
        });
        expect(updated).toEqual({ fingerprint: "catalog:v1" });

        const rows = store.db.prepare("SELECT count(*) AS count, catalog_json FROM tool_catalog_snapshots WHERE fingerprint = ?").all("catalog:v1");
        expect(rows).toHaveLength(1);
        expect(rows[0].count).toBe(1);

        const persisted = JSON.parse(rows[0].catalog_json);
        expect(persisted.fingerprint).toBe("catalog:v1");
        expect(persisted.metadata).toEqual({ source: "unit-test" });
        expect(persisted.tools).toEqual([{ id: "pact.knowledge.read" }, { id: "pact.storage.read" }]);
      } finally {
        store.close();
      }
    });
  });

  it("读写授权并做字段归一化，列表支持 revoked 过滤", async () => {
    await withTempUserDataPath(async (userDataPath) => {
      const store = createStore(userDataPath);
      let storeReloaded = false;
      try {
        const { grant: normalizedGrant } = await store.createGrant({
          label: "Normalized Grant",
          scopes: "knowledge:read,knowledge:read,storage:read,invalid:scope",
          toolAllow: "tool-a,tool-b,tool-a,,",
          toolDeny: ["tool-d", "tool-d", ""],
          maxUses: "12",
          rateLimit: { per_minute: "15" },
          allowedOrigins: "https://api.example.com,https://api.example.com,,https://ops.example.com",
          allowedCidrs: "10.0.0.0/8, 10.0.0.0/8,2001:db8::1/64"
        });

        expect(normalizedGrant.scopes).toEqual(["knowledge:read", "storage:read"]);
        expect(normalizedGrant.toolsets).toEqual(["pact.knowledge.read", "pact.storage.read"]);
        expect(normalizedGrant.toolAllow).toEqual(["tool-a", "tool-b"]);
        expect(normalizedGrant.toolDeny).toEqual(["tool-d"]);
        expect(normalizedGrant.rateLimit).toEqual({ perMinute: 15 });
        expect(normalizedGrant.maxUses).toBe(12);
        expect(normalizedGrant.allowedOrigins).toEqual(["https://api.example.com", "https://ops.example.com"]);
        expect(normalizedGrant.allowedCidrs).toEqual(["10.0.0.0/8", "2001:db8::1/64"]);

        const { grant: revokedGrant } = await store.createGrant({
          label: "To Revoke",
          scopes: "workspace:read"
        });

        const revocation = await store.revokeGrant(revokedGrant.id, "unit-test");
        expect(revocation).not.toBeNull();
        expect(revocation.id).toBe(revokedGrant.id);
        expect(revocation.revokedAt).toBeTruthy();

        const active = store.listGrants();
        const activeIds = new Set(active.map((item) => item.id));
        expect(activeIds.has(revokedGrant.id)).toBe(false);
        expect(activeIds.has(normalizedGrant.id)).toBe(true);

        const all = store.listGrants({ includeRevoked: true });
        const allIds = new Set(all.map((item) => item.id));
        expect(allIds.has(revokedGrant.id)).toBe(true);
        expect(allIds.has(normalizedGrant.id)).toBe(true);

        store.close();
        storeReloaded = true;
        const reloaded = createStore(userDataPath);
        try {
          const loaded = reloaded.getGrant(normalizedGrant.id);
          expect(loaded).not.toHaveProperty("tokenHash");
          expect(loaded).toMatchObject({
            id: normalizedGrant.id,
            scopes: ["knowledge:read", "storage:read"],
            toolsets: ["pact.knowledge.read", "pact.storage.read"],
            toolAllow: ["tool-a", "tool-b"],
            toolDeny: ["tool-d"],
            hasToken: true,
            capabilities: []
          });
        } finally {
          reloaded.close();
        }
      } finally {
        if (!storeReloaded) {
          store.close();
        }
      }
    });
  });

  it("异常输入应保持可恢复：未知 capability 直接报错但不影响后续存储", async () => {
    await withTempUserDataPath(async (userDataPath) => {
      const store = createStore(userDataPath);
      try {
        await expect(store.createGrant({
          label: "Unknown Capability",
          capabilities: ["cap:tool-management:unknown:test"]
        })).rejects.toThrow("Unknown tool grant capability permission");

        const { grant } = await store.createGrant({
          label: "Valid After Failure",
          scopes: "knowledge:read"
        });

        expect(store.getGrant(grant.id)).toBeTruthy();
        expect(store.listGrants()).toHaveLength(1);
      } finally {
        store.close();
      }
    });
  });

  it("容忍数据库中损坏 JSON：读取时返回默认值而非抛异常", async () => {
    await withTempUserDataPath(async (userDataPath) => {
      const store = createStore(userDataPath);
      try {
        const { grant } = await store.createGrant({
          label: "Corrupt Test",
          scopes: "knowledge:read"
        });

        store.db.prepare(`
          UPDATE tool_grants
          SET toolsets_json = ?, tool_allow_json = ?, tool_deny_json = ?,
              scopes_json = ?, rate_limit_json = ?, allowed_origins_json = ?,
              allowed_cidrs_json = ?, metadata_json = ?
          WHERE id = ?
        `).run(
          "[invalid",
          "not-json",
          "not-json",
          "scope:only",
          "",
          "{",
          "{",
          "{invalid",
          grant.id
        );

        const tolerated = store.getGrant(grant.id);
        expect(tolerated).toMatchObject({
          id: grant.id,
          toolsets: [],
          toolAllow: [],
          toolDeny: [],
          scopes: [],
          rateLimit: {},
          allowedOrigins: [],
          allowedCidrs: [],
          metadata: {},
          capabilities: []
        });

        const all = store.listGrants({ includeRevoked: true });
        const found = all.find((item) => item.id === grant.id);
        expect(found).toMatchObject({
          id: grant.id,
          hasToken: true
        });
        expect(found.scopes).toEqual([]);
      } finally {
        store.close();
      }
    });
  });

  it("CRUD 覆盖：新增、列表、更新、删除与异常更新不污染历史数据", async () => {
    await withTempUserDataPath(async (userDataPath) => {
      const store = createStore(userDataPath);
      try {
        const { grant: first } = await store.createGrant({
          label: "Grant A",
          scopes: "knowledge:read,storage:read"
        });
        const { grant: second } = await store.createGrant({
          label: "Grant B",
          scopes: "workspace:read"
        });
        expect(store.listGrants()).toHaveLength(2);
        expect(store.listGrants().map((item) => item.id)).toEqual(expect.arrayContaining([first.id, second.id]));

        const updated = store.updateGrant(first.id, {
          label: "Grant A Updated",
          toolAllow: "tool-x,tool-y,tool-x"
        });
        expect(updated.label).toBe("Grant A Updated");
        expect(updated.toolAllow).toEqual(["tool-x", "tool-y"]);

        expect(() =>
          store.updateGrant(first.id, { capabilities: ["cap:tool-management:unknown:test"] })
        ).toThrow("Unknown tool grant capability permission");

        const stillActive = store.getRawGrant(first.id);
        expect(stillActive.label).toBe("Grant A Updated");

        expect(store.deleteGrant(second.id)).toBe(true);
        expect(store.deleteGrant("missing-grant-id")).toBe(false);
        expect(store.listGrants({ includeRevoked: true }).map((item) => item.id)).toContain(first.id);
        expect(store.listGrants().map((item) => item.id)).toContain(first.id);
        expect(store.getGrant(second.id)).toBeNull();
      } finally {
        store.close();
      }
    });
  });

  it("授权校验：空 token、无效 token、已撤销授权和用尽最大次数", async () => {
    await withTempUserDataPath(async (userDataPath) => {
      const store = createStore(userDataPath);
      try {
        const { grant, token } = await store.createGrant({
          label: "Quota Grant",
          scopes: "knowledge:read",
          maxUses: 1
        });
        const request = {
          headers: {
            authorization: `Bearer ${token}`
          }
        };

        expect(await store.authorizeRequest({ request: {} })).toMatchObject({
          ok: false,
          status: 401,
          reasonCode: "missing_token"
      });

        const deniedBecauseMissing = await store.authorizeRequest({ request: { headers: { authorization: "Bearer invalid-token" } } });
        expect(deniedBecauseMissing).toMatchObject({
          ok: false,
          status: 401,
          reasonCode: "invalid_token"
        });

        const firstSuccess = await store.authorizeRequest({ request });
        expect(firstSuccess).toMatchObject({
          ok: true,
          grant: {
            id: grant.id
          }
        });

        const secondAttempt = await store.authorizeRequest({ request });
        expect(secondAttempt).toMatchObject({
          ok: false,
          reasonCode: "grant_max_uses"
        });

        const sameGrant = store.getRawGrant(grant.id);
        expect(sameGrant.useCount).toBe(1);
        expect(typeof sameGrant.lastUsedAt).toBe("string");

        const revoked = await store.revokeGrant(grant.id, "test-revoke");
        expect(revoked).toMatchObject({ id: grant.id, reason: "test-revoke" });

        const afterRevoke = await store.authorizeRequest({ request });
        expect(afterRevoke).toMatchObject({
          ok: false,
          status: 401,
          reasonCode: "invalid_token"
        });
      } finally {
        store.close();
      }
    });
  });

  it("授权校验分支：能力凭证路径、缺失 Kernel、绑定检查不通过", async () => {
    await withTempUserDataPath(async (userDataPath) => {
      const validProvider = createMockCapabilityKeyProvider();
      const validBindingGuard = createMockBindingGuard({
        verifyResult: { ok: true }
      });
      const validStore = createStoreWithCapProvider(userDataPath, {
        capabilityKeyProvider: validProvider,
        capabilityBindingGuard: validBindingGuard
      });
      try {
        const { token } = await validStore.createGrant({
          label: "Capability Grant",
          capabilities: [toolKnowledgeSearchCapability]
        });

        const allowed = await validStore.authorizeRequest({
          request: {
            headers: { authorization: `Bearer ${token}` }
          },
          tool: { id: "pact.knowledge.search" }
        });
        expect(allowed).toMatchObject({
          ok: true
        });
        expect(validProvider.verify).toHaveBeenCalled();
        expect(validBindingGuard.verifyCapabilityKeyBinding).toHaveBeenCalled();
      } finally {
        validStore.close();
      }

      const unavailableProviderStore = createStoreWithCapProvider(userDataPath, {
        capabilityKeyProvider: {
          issue: vi.fn(async ({ credentialId, capabilities, expiresAt }) => ({
            capabilityKey: `ock_${credentialId}`,
            credentialId,
            protocolVersion: "pact.opaque-capability-key.v1",
            capabilitySetHash: String((capabilities || []).length),
            capabilityCount: (capabilities || []).length,
            runtimeLookupGeneration: 1,
            expiresAt: expiresAt || new Date(Date.now() + 60 * 60 * 1000).toISOString()
          })),
          invalidateCredential: vi.fn(async () => undefined),
          close: vi.fn()
        }
      });
      try {
        const { token: unavailableToken } = await unavailableProviderStore.createGrant({
          label: "Unavailable Grant",
          capabilities: [toolPolicyEvaluateCapability]
        });
        const unavailable = await unavailableProviderStore.authorizeRequest({
          request: {
            headers: { authorization: `Bearer ${unavailableToken}` }
          },
          tool: { id: "pact.authorization.policy.evaluate" }
        });
        expect(unavailable).toMatchObject({
          ok: false,
          status: 503,
          reasonCode: "capability_kernel_unavailable"
        });
      } finally {
        unavailableProviderStore.close();
      }

      const deniedBindingStore = createStoreWithCapProvider(userDataPath, {
        capabilityKeyProvider: createMockCapabilityKeyProvider(),
        capabilityBindingGuard: createMockBindingGuard({
          verifyResult: { ok: false, reasonCode: "capability_binding_denied", reason: "bound mismatch" }
        })
      });
      try {
        const { token: deniedToken } = await deniedBindingStore.createGrant({
          label: "Binding Grant",
          capabilities: [toolKnowledgeSearchCapability]
        });
        const deniedBinding = await deniedBindingStore.authorizeRequest({
          request: {
            headers: { authorization: `Bearer ${deniedToken}` }
          },
          tool: { id: "pact.knowledge.search" }
        });
        expect(deniedBinding).toMatchObject({
          ok: false,
          status: 403,
          reasonCode: "capability_binding_denied"
        });
      } finally {
        deniedBindingStore.close();
      }
    });
  });

  it("速率限制/工具目录与授权请求过滤：通过工具指标影响授权决策", async () => {
    await withTempUserDataPath(async (userDataPath) => {
      const store = createStore(userDataPath);
      try {
        const { grant, token } = await store.createGrant({
          label: "Metric Grant",
          scopes: "knowledge:read",
          rateLimit: { perMinute: 1 }
        });

        store.appendMetric({
          toolId: "pact.knowledge.read",
          grantId: grant.id,
          status: "ok",
          risk: "low",
          durationMs: 20,
          inputBytes: 12,
          resultBytes: 34,
          transferBytes: 46,
          createdAt: new Date(Date.now() - 10_000).toISOString()
        });
        const limited = await store.authorizeRequest({
          request: {
            headers: {
              authorization: `Bearer ${token}`
            }
          }
        });
        expect(limited).toMatchObject({
          ok: false,
          status: 429,
          reasonCode: "rate_limited"
        });
      } finally {
        store.close();
      }
    });
  });

  it("审计：append/get/list 与分页/过滤参数", async () => {
    await withTempUserDataPath(async (userDataPath) => {
      const store = createStore(userDataPath);
      try {
        const { grant } = await store.createGrant({ label: "Audit Grant", scopes: "jobs:read" });

        store.appendExecution({
          toolExecutionId: "audit-1",
          toolId: "pact.jobs.read",
          status: "ok",
          grantId: grant.id,
          startedAt: "2026-01-01T00:00:00.000Z",
          finishedAt: "2026-01-01T00:00:00.120Z",
          input: { payload: "a" },
          result: { ok: true }
        });

        store.appendExecution({
          toolExecutionId: "audit-2",
          toolId: "pact.jobs.write",
          status: "denied",
          grantId: grant.id,
          startedAt: "2026-01-01T00:01:00.000Z",
          finishedAt: "2026-01-01T00:01:00.120Z",
          input: { payload: "b" },
          result: { error: "denied" }
        });

        const all = store.listAudit();
        expect(all).toHaveLength(2);
        expect(all[0].toolExecutionId).toBe("audit-2");

        const filter = store.listAudit({ toolId: "pact.jobs.read", status: "ok", limit: 10 });
        expect(filter).toHaveLength(1);
        expect(filter[0].toolExecutionId).toBe("audit-1");

        expect(store.getAudit("missing-audit-id")).toBeNull();
        const audit = store.getAudit("audit-1");
        expect(audit).toMatchObject({
          toolExecutionId: "audit-1",
          toolId: "pact.jobs.read",
          grantId: grant.id,
          status: "ok"
        });
      } finally {
        store.close();
      }
    });
  });

  it("待审批操作：创建/列表/过期/解析状态", async () => {
    await withTempUserDataPath(async (userDataPath) => {
      const store = createStore(userDataPath);
      try {
        const expired = store.createPendingOperation({
          toolId: "pact.storage.read",
          toolVersion: "v1",
          operationId: "op-expired",
          risk: "low",
          idempotencyKey: "idem-1",
          originalInput: { a: 1 },
          createdAt: "2020-01-01T00:00:00.000Z",
          expiresAt: "2020-01-01T00:00:10.000Z"
        });

        const active = store.createPendingOperation({
          toolId: "pact.storage.write",
          toolVersion: "v1",
          operationId: "op-active",
          risk: "medium",
          idempotencyKey: "idem-2",
          originalInput: { b: 2 },
          originalInput: { b: 2 }
        });

        const autoExpired = store.getPendingOperation(expired.pendingOperationId, { includeOriginalInput: true });
        expect(autoExpired).toMatchObject({
          pendingOperationId: expired.pendingOperationId,
          status: "expired",
          originalInput: { a: 1 }
        });

        const allByStatus = store.listPendingOperations({ status: "all", limit: 10 });
        expect(allByStatus.map((item) => item.pendingOperationId)).toContain(active.pendingOperationId);
        const pendingOnly = store.listPendingOperations({ limit: 10 });
        expect(pendingOnly.every((item) => item.status === "pending")).toBe(true);

        await expect(() =>
          store.resolvePendingOperation({
            pendingOperationId: active.pendingOperationId,
            resolution: "invalid"
          })
        ).toThrow("Invalid pending operation resolution status.");

        const resolved = store.resolvePendingOperation({
          pendingOperationId: active.pendingOperationId,
          resolution: "completed",
          resolvedBy: "tester",
          reason: "approved",
          resultSummary: { ok: true },
          resumedToolExecutionId: "exec-1",
          errorCode: ""
        });
        expect(resolved?.status).toBe("completed");
        expect(resolved?.resolvedBy).toBe("tester");

        const alreadyResolved = store.resolvePendingOperation({
          pendingOperationId: active.pendingOperationId,
          resolution: "rejected"
        });
        expect(alreadyResolved).toBeNull();
      } finally {
        store.close();
      }
    });
  });

  it("MCP 授权请求：创建/列表/解析状态", async () => {
    await withTempUserDataPath(async (userDataPath) => {
      const store = createStore(userDataPath);
      try {
        const { grant } = await store.createGrant({
          label: "MCP Ref Grant",
          scopes: "knowledge:read"
        });
        const { requestId, status } = store.createMcpAuthorizationRequest({
          clientName: "agent-client",
          requestedScopes: ["knowledge:read"],
          requestedTools: [{ id: "pact.knowledge.read" }],
          reason: "tool-request",
          request: {
            headers: {
              "x-forwarded-for": "127.0.0.1"
            }
          }
        });
        expect(status).toBe("pending");

        const pending = store.listMcpAuthorizationRequests();
        expect(pending).toHaveLength(1);
        expect(pending[0].requestId).toBe(requestId);

        const approved = store.resolveMcpAuthorizationRequest({
          requestId,
          resolution: "approved",
          grantId: grant.id
        });
        expect(approved).toBe(true);

        const approvedList = store.listMcpAuthorizationRequests({ status: "approved" });
        expect(approvedList).toHaveLength(1);
        expect(approvedList[0].grantId).toBe(grant.id);

        const repeated = store.resolveMcpAuthorizationRequest({
          requestId,
          resolution: "approved",
          grantId: grant.id
        });
        expect(repeated).toBe(false);
      } finally {
        store.close();
      }
    });
  });

  it("指标聚合、导出、健康与清理：覆盖指标分支和异常参数", async () => {
    await withTempUserDataPath(async (userDataPath) => {
      const store = createStore(userDataPath);
      try {
        store.appendMetric({
          toolId: "pact.jobs.read",
          grantId: "g-jobs-read",
          status: "ok",
          risk: "read_only",
          durationMs: 120,
          inputBytes: 100,
          resultBytes: 200,
          transferBytes: 300,
          createdAt: new Date().toISOString()
        });
        store.appendMetric({
          toolId: "pact.jobs.write",
          grantId: "g-jobs-write",
          status: "denied",
          risk: "repair_write",
          durationMs: 200,
          inputBytes: 20,
          resultBytes: 10,
          transferBytes: 30,
          createdAt: new Date(Date.now() - 100).toISOString()
        });
        store.appendHttpRequestMetric({
          method: "POST",
          route: "/tools/run",
          statusCode: 500,
          completionStatus: "failed",
          requestBytes: 10,
          responseBytes: 5,
          transferBytes: 15,
          durationMs: 90,
          createdAt: new Date(Date.now() - 2000).toISOString()
        });
        store.appendHttpRequestMetric({
          method: "GET",
          route: "/health",
          statusCode: 200,
          completionStatus: "completed",
          requestBytes: 20,
          responseBytes: 10,
          transferBytes: 30,
          durationMs: 10,
          createdAt: new Date(Date.now() - 1000).toISOString()
        });

        const summary = store.metricsSummary({
          limit: 10,
          toolId: "pact.jobs.read",
          bucketSeconds: 60
        });
        expect(summary.toolCalls.total).toBe(1);
        expect(summary.requests.total).toBeGreaterThanOrEqual(1);
        expect(summary.series.bucketSeconds).toBe(60);
        expect(summary.series.buckets.length).toBeGreaterThan(0);

        const requestExport = store.metricsExport({ kind: "request", route: "/tools/run" });
        expect(requestExport.counts).toMatchObject({
          toolMetricEvents: 0,
          total: 1
        });

        const health = store.metricsHealth({
          windowSeconds: 60,
          maxRequestErrorRate: 0,
          maxToolFailureRate: 0,
          maxDeniedRate: 0.4,
          maxRequestP95Ms: 50,
          maxToolP95Ms: 50,
          minRequests: 1
        });
        expect(health.status).toBe("critical");
        expect(health.breaches.some((entry) => entry.code === "tool_failure_rate")).toBe(true);
        expect(health.breaches.some((entry) => entry.code === "request_server_error_rate")).toBe(true);

        const prometheus = store.metricsPrometheus({
          windowSeconds: 60,
          maxRequestErrorRate: 0,
          maxToolFailureRate: 0,
          maxDeniedRate: 0.4
        });
        expect(prometheus).toContain("pact_tool_management_health_status");
        expect(prometheus).toContain("pact_tool_management_requests_total");

        const storageSummary = store.metricsStorageSummary();
        expect(storageSummary.schemaVersion).toBe("pact.tool-management.metrics-storage.v1");
        expect(storageSummary.tables.toolMetricEvents.rows).toBe(2);
        expect(storageSummary.tables.httpRequestMetricEvents.rows).toBe(2);

        const pruneDryRun = store.pruneMetrics({
          maxToolMetricRows: 1,
          maxHttpRequestMetricRows: 1,
          dryRun: true
        });
        expect(pruneDryRun.dryRun).toBe(true);
        expect(pruneDryRun.planned.toolMetrics).toBe(1);
        expect(pruneDryRun.planned.httpRequestMetrics).toBe(1);
        expect(pruneDryRun.deleted.toolMetrics).toBe(0);

        const prune = store.pruneMetrics({
          maxToolMetricRows: 1,
          maxHttpRequestMetricRows: 1
        });
        expect(prune.deleted.toolMetrics).toBe(1);
        expect(prune.deleted.httpRequestMetrics).toBe(1);
        expect(prune.after.toolMetrics).toBe(1);
        expect(prune.after.httpRequestMetrics).toBe(1);

        expect(() => store.pruneMetrics({
          olderThan: "bad-date"
        })).toThrow("Metric prune olderThan must be an ISO timestamp.");
      } finally {
        store.close();
      }
    });
  });
});
