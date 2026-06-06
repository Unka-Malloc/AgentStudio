import { afterEach, describe, expect, it, vi } from "vitest";

import { createSystemControllerCapabilityEcosystemHandlers } from "../../../server/platform/common/console/http/controllers/system-controller-capability-ecosystem-handlers.mjs";

afterEach(() => {
  vi.restoreAllMocks();
});

function jsonBody(value) {
  return Buffer.from(JSON.stringify(value), "utf8");
}

function createHarness(overrides = {}) {
  const moduleManagement = overrides.moduleManagement || { name: "module-management" };
  const strategyManagementProvider = overrides.strategyManagementProvider || { name: "strategy-management" };
  const parseJsonBody =
    overrides.parseJsonBody ||
    vi.fn((requestBody) => JSON.parse(requestBody.toString("utf8")));
  const sendConsoleDomainOperation =
    overrides.sendConsoleDomainOperation ||
    vi.fn(async (payload) => ({ ok: true, payload }));
  const getStrategyManagementProvider =
    overrides.getStrategyManagementProvider ||
    vi.fn(() => strategyManagementProvider);

  const handlers = createSystemControllerCapabilityEcosystemHandlers({
    sendConsoleDomainOperation,
    parseJsonBody,
    moduleManagement,
    getStrategyManagementProvider
  });

  return {
    getStrategyManagementProvider,
    handlers,
    moduleManagement,
    parseJsonBody,
    sendConsoleDomainOperation,
    strategyManagementProvider
  };
}

const handlerExpectations = [
  ["handleCapabilityPackagePlan", "capability_packages.plan"],
  ["handleCapabilityPackageLifecycle", "capability_packages.lifecycle"],
  ["handleGetCodexOAuthStatus", "oauth.codex_status"],
  ["handleStartCodexOAuthLogin", "oauth.codex_login"],
  ["handleCodexOAuthReturn", "oauth.codex_return"],
  ["handleProductionHealth", "production.health"],
  ["handleExecutiveReport", "executive_report.list"],
  ["handleExecutiveReportGenerate", "executive_report.generate"],
  ["handleExecutiveReportPreview", "executive_report.preview"],
  ["handleArchitectureLiveMap", "architecture.live_map"],
  ["handleSampleBusinessPacks", "sample_business_pack.list"],
  ["handleSampleBusinessPack", "sample_business_pack.get"],
  ["handleSampleBusinessPackMaterialize", "sample_business_pack.materialize"],
  ["handleModuleTemplates", "module_ecosystem.templates"],
  ["handleModuleScaffoldPlan", "module_ecosystem.plan"],
  ["handleModuleScaffold", "module_ecosystem.scaffold"],
  ["handleModuleContractTest", "module_ecosystem.contract_test"],
  ["handleWorkspaceGovernance", "workspace_governance.describe"],
  ["handleWorkspaceGovernancePolicy", "workspace_governance.policy.set"],
  ["handleWorkspaceGovernanceEvaluate", "workspace_governance.evaluate"],
  ["handleWorkspaceGovernanceShareGrant", "workspace_governance.share_grant"],
  ["handleGerritRead", "gerrit.read"],
  ["handleGerritWrite", "gerrit.write"],
  ["handleGerritMaintain", "gerrit.maintain"],
  ["handleGerritGitUpload", "gerrit.git_upload"],
  ["handleRepoOperation", "repo.status"],
  ["handleAssetLineage", "asset_lineage.describe"],
  ["handleAssetLineageRecord", "asset_lineage.record"],
  ["handleAssetLineageTrace", "asset_lineage.trace"],
  ["handleAssetLineageReparsePlan", "asset_lineage.reparse_plan"],
  ["handleDataConnectorGovernance", "data_connectors.governance.describe"],
  ["handleDataConnectorGovernancePlan", "data_connectors.governance.plan"],
  ["handleDataConnectorGovernanceConformance", "data_connectors.governance.conformance"],
  ["handlePerformanceCapacityTargets", "performance.capacity.targets"],
  ["handlePerformanceCapacityBenchmark", "performance.capacity.benchmark"]
];

function argsFor(name) {
  const args = {
    authSession: { sessionId: "session-1" },
    operation: { id: name === "handleRepoOperation" ? "repo.status" : "" },
    packageId: "package-1",
    packId: "sample-pack-1",
    requestBody: jsonBody({ value: name }),
    response: { tag: "response" },
    url: new URL("http://example.test/console?limit=5&mode=query")
  };
  if (name === "handleRepoOperation") {
    args.operation = { id: "repo.status" };
  }
  return args;
}

describe("system controller capability ecosystem handlers", () => {
  it("registers all expected capability ecosystem handler methods", () => {
    const { handlers } = createHarness();

    expect(Object.keys(handlers).sort()).toEqual([
      ...handlerExpectations.map(([name]) => name),
      "handleCapabilityPackages",
      "handleStrategyManagement"
    ].sort());
  });

  it("forwards thin handlers to their expected operation ids", async () => {
    const harness = createHarness();

    for (const [name] of handlerExpectations) {
      await harness.handlers[name](argsFor(name));
    }

    expect(harness.sendConsoleDomainOperation).toHaveBeenCalledTimes(handlerExpectations.length);
    expect(harness.sendConsoleDomainOperation.mock.calls.map(([payload]) => payload.operationId)).toEqual(
      handlerExpectations.map(([, operationId]) => operationId)
    );
  });

  it("handles capability package list and submit branches", async () => {
    const harness = createHarness();
    const response = { tag: "response" };
    const authSession = { sessionId: "session-2" };

    await harness.handlers.handleCapabilityPackages({
      requestBody: Buffer.alloc(0),
      response,
      authSession
    });
    await harness.handlers.handleCapabilityPackages({
      requestBody: jsonBody({ packageId: "pkg-1", action: "submit" }),
      response,
      authSession
    });

    expect(harness.sendConsoleDomainOperation).toHaveBeenNthCalledWith(1, {
      operationId: "capability_packages.list",
      response,
      context: { authSession }
    });
    expect(harness.sendConsoleDomainOperation).toHaveBeenNthCalledWith(2, {
      operationId: "capability_packages.submit",
      input: { packageId: "pkg-1", action: "submit" },
      response,
      context: { authSession },
      errorMessage: "能力包提交失败。"
    });
  });

  it("uses query/body input and provider context only for allowed strategy operations", async () => {
    const harness = createHarness();
    const response = { tag: "response" };
    const authSession = { sessionId: "session-3" };
    const url = new URL("http://example.test/strategy?target=agent&mode=preview");

    await harness.handlers.handleStrategyManagement({
      operation: { id: "strategy.describe" },
      requestBody: Buffer.alloc(0),
      url,
      response,
      authSession
    });
    await harness.handlers.handleStrategyManagement({
      operation: { id: "strategy.tool_policy.preview" },
      requestBody: jsonBody({ toolId: "tool-1" }),
      url,
      response,
      authSession
    });
    await harness.handlers.handleStrategyManagement({
      operation: { id: "strategy.unknown" },
      requestBody: jsonBody({ unsafe: true }),
      url,
      response,
      authSession
    });

    expect(harness.getStrategyManagementProvider).toHaveBeenCalledTimes(2);
    expect(harness.sendConsoleDomainOperation).toHaveBeenNthCalledWith(1, {
      operationId: "strategy.describe",
      input: {
        target: "agent",
        mode: "preview"
      },
      response,
      context: {
        authSession,
        strategyManagementProvider: harness.strategyManagementProvider
      },
      errorMessage: "策略管理操作失败。"
    });
    expect(harness.sendConsoleDomainOperation).toHaveBeenNthCalledWith(2, {
      operationId: "strategy.tool_policy.preview",
      input: {
        toolId: "tool-1"
      },
      response,
      context: {
        authSession,
        strategyManagementProvider: harness.strategyManagementProvider
      },
      errorMessage: "策略管理操作失败。"
    });
    expect(harness.sendConsoleDomainOperation).toHaveBeenNthCalledWith(3, {
      operationId: "strategy.unknown",
      input: {
        unsafe: true
      },
      response,
      errorMessage: "未知策略管理操作。"
    });
  });

  it("merges selected route identifiers and contexts for module, package, sample, and repo handlers", async () => {
    const harness = createHarness();
    const response = { tag: "response" };
    const authSession = { sessionId: "session-4" };

    await harness.handlers.handleCapabilityPackageLifecycle({
      packageId: "pkg-route",
      requestBody: jsonBody({ action: "enable" }),
      response,
      authSession
    });
    await harness.handlers.handleSampleBusinessPack({
      operation: { id: "sample_business_pack.custom" },
      packId: "sample-route",
      response
    });
    await harness.handlers.handleModuleScaffold({
      requestBody: jsonBody({ templateId: "documentParser" }),
      response
    });
    await harness.handlers.handleRepoOperation({
      operation: { id: "repo.branch.create" },
      requestBody: jsonBody({ branch: "feature" }),
      response,
      authSession
    });

    expect(harness.sendConsoleDomainOperation).toHaveBeenNthCalledWith(1, {
      operationId: "capability_packages.lifecycle",
      input: { action: "enable" },
      response,
      context: { packageId: "pkg-route", authSession },
      errorMessage: "能力包生命周期操作失败。"
    });
    expect(harness.sendConsoleDomainOperation).toHaveBeenNthCalledWith(2, {
      operationId: "sample_business_pack.custom",
      input: { packId: "sample-route" },
      response,
      errorMessage: "读取样例业务包失败。"
    });
    expect(harness.sendConsoleDomainOperation).toHaveBeenNthCalledWith(3, {
      operationId: "module_ecosystem.scaffold",
      input: { templateId: "documentParser" },
      response,
      context: { moduleManagement: harness.moduleManagement },
      errorMessage: "Module scaffold failed."
    });
    expect(harness.sendConsoleDomainOperation).toHaveBeenNthCalledWith(4, {
      operationId: "repo.branch.create",
      input: { branch: "feature" },
      response,
      context: { authSession },
      errorMessage: "Repo operation failed."
    });
  });

  it("propagates domain operation failures", async () => {
    const error = new Error("capability boom");
    const sendConsoleDomainOperation = vi.fn(async () => {
      throw error;
    });
    const harness = createHarness({ sendConsoleDomainOperation });

    await expect(harness.handlers.handlePerformanceCapacityBenchmark({
      requestBody: jsonBody({ scenario: "small" }),
      response: {}
    })).rejects.toThrow("capability boom");

    expect(sendConsoleDomainOperation).toHaveBeenCalledWith(expect.objectContaining({
      operationId: "performance.capacity.benchmark",
      input: { scenario: "small" },
      errorMessage: "Performance capacity benchmark failed."
    }));
  });
});
