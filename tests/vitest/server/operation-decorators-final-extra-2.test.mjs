import { describe, expect, it } from "vitest";

import {
  OPERATION_ASPECTS,
  decorateServerApiOperations,
  defineOperation,
  evaluateOperationSafety,
  resolveOperationSafety,
  serializableOperationSafety,
  withAspect,
  withAudit,
  withConcurrency,
  withInputSchema,
  withRequiredScopes,
  withRisk,
  withScopes,
  withTarget,
  withTransport
} from "../../../server/platform/common/operation-dispatcher/operation-decorators.mjs";

function baseOperation(overrides = {}) {
  return {
    id: "unit.operation",
    http: { method: "POST", path: "/api/unit" },
    target: { controller: "unit", method: "run" },
    requiredScopes: ["unit:write"],
    ...overrides
  };
}

describe("operation decorators final extra coverage", () => {
  it("composes decorators and infers transport, target, audit, concurrency, and safety metadata", () => {
    const operation = defineOperation(
      baseOperation({ requiredScopes: ["unit:write", "unit:write"] }),
      withAspect(OPERATION_ASPECTS.AUDIT, { sink: "unit" }),
      withRequiredScopes(["unit:admin", "unit:admin"]),
      withScopes(["unit:read"]),
      withTransport({
        http: { method: "PUT", path: "/api/unit/:id" },
        rpc: { method: "unit.run" },
        cli: { command: "unit run" },
        binary: 1
      }),
      withTarget({ method: "execute", queue: "default" }),
      withRisk("repair_write", {
        approvalScope: "unit:approve",
        requiresConfirmation: false,
        reason: "unit repair"
      }),
      withInputSchema({ required: ["id"], properties: { id: { type: "string" } } }),
      withAudit({ enabled: true, recordOutput: true, redaction: "strict" }),
      withConcurrency({ concurrencySafe: false, group: "unit-group" })
    );

    expect(operation).toMatchObject({
      aspects: [OPERATION_ASPECTS.AUDIT],
      aspectOptions: { audit: { sink: "unit" } },
      requiredScopes: ["unit:write", "unit:admin", "unit:read"],
      http: { method: "PUT", path: "/api/unit/:id" },
      rpc: { method: "unit.run" },
      cli: { command: "unit run" },
      binary: true,
      target: { controller: "unit", method: "execute", queue: "default" },
      concurrencySafe: false,
      concurrencyGroup: "unit-group",
      inputSchema: { type: "object", additionalProperties: true, required: ["id"] },
      audit: { enabled: true, recordOutput: true, redaction: "strict" },
      safety: {
        risk: "repair_write",
        approvalScope: "unit:approve",
        requiresConfirmation: false,
        requiresConfirmationExplicit: true,
        reason: "unit repair"
      }
    });
  });

  it("decorates known operation ids with safety, scopes, public/external auth, and concurrency presets", () => {
    const decorated = decorateServerApiOperations([
      {
        id: "system.health",
        http: { method: "GET", path: "/api/system/health" },
        target: { controller: "system", method: "health" }
      },
      {
        id: "tool_management.execute",
        http: { method: "POST", path: "/api/tools/execute" },
        target: { controller: "tools", method: "execute" }
      },
      {
        id: "knowledge.maintenance.run",
        http: { method: "POST", path: "/api/knowledge/maintenance/run" },
        target: { controller: "knowledge", method: "runMaintenance" },
        requiredScopes: ["knowledge:write"]
      },
      {
        id: "settings.set",
        http: { method: "POST", path: "/api/settings" },
        rpc: { method: "settings.set" },
        target: { controller: "settings", method: "set" },
        requiredScopes: ["runtime:admin"]
      }
    ]);

    expect(decorated[0]).toMatchObject({
      id: "system.health",
      public: true,
      requiredScopes: [],
      readOnly: true
    });
    expect(decorated[1]).toMatchObject({
      id: "tool_management.execute",
      externalAuth: true,
      externalAuthMissingCode: "missing_token",
      requiredScopes: []
    });
    expect(decorated[2]).toMatchObject({
      id: "knowledge.maintenance.run",
      concurrencySafe: false,
      concurrencyGroup: "knowledge.maintenance",
      safety: {
        risk: "safe_write",
        requiresConfirmation: false
      }
    });
    expect(resolveOperationSafety(decorated[2], {
      requestBody: JSON.stringify({ taskType: "reindex" })
    })).toMatchObject({
      risk: "repair_write",
      requiresConfirmation: true
    });
    expect(resolveOperationSafety(decorated[2], {
      requestBody: Buffer.from(JSON.stringify({ task: "gc", dry_run: true }))
    })).toMatchObject({
      risk: "safe_write"
    });
    expect(decorated[3]).toMatchObject({
      concurrencySafe: false,
      concurrencyGroup: "settings",
      safety: { risk: "repair_write" }
    });
  });

  it("evaluates destructive blocks, auth-disabled repair writes, approval scopes, and confirmation headers", () => {
    const repairOperation = {
      id: "unit.repair",
      http: { method: "POST", path: "/api/unit/repair" },
      target: { controller: "unit", method: "repair" },
      requiredScopes: ["unit:write"],
      safety: {
        risk: "repair_write",
        approvalScope: "unit:approve"
      }
    };

    expect(evaluateOperationSafety({
      operation: {
        ...repairOperation,
        id: "unit.destroy",
        safety: { risk: "destructive" }
      }
    })).toMatchObject({
      ok: false,
      status: 403
    });
    expect(evaluateOperationSafety({
      operation: repairOperation,
      authEnabled: false
    })).toMatchObject({
      ok: true,
      safety: {
        enforcement: "auth_disabled"
      }
    });
    expect(evaluateOperationSafety({
      operation: repairOperation,
      authEnabled: true
    })).toMatchObject({
      ok: false,
      status: 401
    });
    expect(evaluateOperationSafety({
      operation: repairOperation,
      authEnabled: true,
      authSession: { user: { scopes: ["unit:write"] } }
    })).toMatchObject({
      ok: false,
      status: 403,
      error: "Operation unit.repair requires scope unit:approve for repair_write."
    });
    expect(evaluateOperationSafety({
      operation: repairOperation,
      authEnabled: true,
      authSession: { user: { scopes: ["unit:approve"] } }
    })).toMatchObject({
      ok: false,
      status: 428
    });
    expect(evaluateOperationSafety({
      operation: repairOperation,
      authEnabled: true,
      authSession: { user: { scopes: ["unit:approve"] } },
      request: { headers: { "x-pact-confirm": "yes" } }
    })).toMatchObject({
      ok: true,
      safety: {
        risk: "repair_write"
      }
    });
    expect(evaluateOperationSafety({
      operation: repairOperation,
      authEnabled: true,
      authSession: { user: { scopes: ["unit:approve"] } },
      params: { confirm: "1" }
    })).toMatchObject({ ok: true });
  });

  it("serializes safety and reports operation registration validation failures", () => {
    expect(serializableOperationSafety({
      id: "unit.dynamic",
      concurrencySafe: true,
      safety: {
        risk: "safe_write",
        resolveRisk: () => "repair_write"
      }
    })).toMatchObject({
      risk: "safe_write",
      concurrencySafe: true,
      dynamicRisk: true,
      knownRisks: ["read_only", "safe_write", "repair_write", "destructive"]
    });

    expect(() => decorateServerApiOperations([{
      http: { method: "GET", path: "/api/missing-id" },
      target: { controller: "unit", method: "run" },
      requiredScopes: ["unit:read"]
    }])).toThrow("missing id");
    expect(() => decorateServerApiOperations([{
      id: "missing.target",
      http: { method: "GET", path: "/api/missing-target" },
      requiredScopes: ["unit:read"]
    }])).toThrow("missing target");
    expect(() => decorateServerApiOperations([{
      id: "missing.http",
      target: { controller: "unit", method: "run" },
      requiredScopes: ["unit:read"]
    }])).toThrow("missing HTTP binding");
    expect(() => decorateServerApiOperations([
      baseOperation({ id: "duplicate", http: { method: "GET", path: "/api/a" } }),
      baseOperation({ id: "duplicate", http: { method: "GET", path: "/api/b" } })
    ])).toThrow("duplicate id duplicate");
    expect(() => decorateServerApiOperations([
      baseOperation({ id: "a", http: { method: "GET", path: "/api/a" } }),
      baseOperation({ id: "b", http: { method: "GET", path: "/api/a" } })
    ])).toThrow("duplicate HTTP binding GET /api/a");
    expect(() => decorateServerApiOperations([
      baseOperation({ id: "a", http: { method: "GET", path: "/api/a" }, rpc: { method: "unit.same" } }),
      baseOperation({ id: "b", http: { method: "GET", path: "/api/b" }, rpc: { method: "unit.same" } })
    ])).toThrow("duplicate RPC method unit.same");
    expect(() => decorateServerApiOperations([
      baseOperation({
        id: "private.no.scope",
        requiredScopes: [],
        http: { method: "GET", path: "/api/private" }
      })
    ])).toThrow("has no requiredScopes");
    expect(() => decorateServerApiOperations([
      baseOperation({
        id: "bad.public.external",
        public: true,
        externalAuth: true
      })
    ])).toThrow("cannot be both public and externalAuth");
    expect(() => decorateServerApiOperations([
      baseOperation({
        id: "write.audit.disabled",
        audit: { enabled: false }
      })
    ])).toThrow("write-capable but audit is disabled");
  });
});
