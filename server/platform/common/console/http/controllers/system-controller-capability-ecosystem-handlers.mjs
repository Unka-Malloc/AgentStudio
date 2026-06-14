export function createSystemControllerCapabilityEcosystemHandlers({
  sendConsoleDomainOperation,
  parseJsonBody,
  moduleManagement = null,
  getStrategyManagementProvider = () => null
}) {
  const strategyOperationIds = new Set([
    "strategy.describe",
    "strategy.workflow_policy.evaluate",
    "strategy.agent_policy.evaluate",
    "strategy.route_policy.evaluate",
    "strategy.queue_policy.evaluate",
    "strategy.tool_policy.preview"
  ]);

  function operationInput(requestBody, url = null) {
    if (requestBody?.length > 0) {
      return parseJsonBody(requestBody);
    }
    return url ? Object.fromEntries(url.searchParams.entries()) : {};
  }

  return {
    async handleCapabilityPackagePlan({ requestBody, response }) {
      await sendConsoleDomainOperation({
        operationId: "capability_packages.plan",
        input: parseJsonBody(requestBody),
        response,
        errorMessage: "Capability package plan failed."
      });
    },
    async handleCapabilityPackages({ requestBody, response, authSession }) {
      if (requestBody.length === 0) {
        await sendConsoleDomainOperation({
          operationId: "capability_packages.list",
          response,
          context: { authSession }
        });
        return;
      }
      await sendConsoleDomainOperation({
        operationId: "capability_packages.submit",
        input: parseJsonBody(requestBody),
        response,
        context: { authSession },
        errorMessage: "能力包提交失败。"
      });
    },
    async handleCapabilityPackageLifecycle({ packageId, requestBody, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: "capability_packages.lifecycle",
        input: parseJsonBody(requestBody),
        response,
        context: { packageId, authSession },
        errorMessage: "能力包生命周期操作失败。"
      });
    },
    async handleGetCodexOAuthStatus({ operation, response }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "oauth.codex_status",
        response,
        errorMessage: "读取 Codex OAuth 状态失败。"
      });
    },
    async handleStartCodexOAuthLogin({ operation, response }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "oauth.codex_login",
        response,
        errorMessage: "启动 Codex OAuth 登录失败。"
      });
    },
    async handleCodexOAuthReturn({ operation, response }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "oauth.codex_return",
        response,
        errorMessage: "处理 Codex OAuth 回跳失败。"
      });
    },
    async handleProductionHealth({ operation, response }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "production.health",
        response,
        errorMessage: "读取生产健康状态失败。"
      });
    },
    async handleExecutiveReport({ operation, response }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "executive_report.list",
        response,
        errorMessage: "读取管理层报告失败。"
      });
    },
    async handleExecutiveReportGenerate({ operation, requestBody, response }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "executive_report.generate",
        input: parseJsonBody(requestBody),
        response,
        errorMessage: "Executive report generation failed."
      });
    },
    async handleExecutiveReportPreview({ operation, requestBody, response }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "executive_report.preview",
        input: parseJsonBody(requestBody),
        response,
        errorMessage: "Executive report preview failed."
      });
    },
    async handleArchitectureLiveMap({ operation, response }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "architecture.live_map",
        response,
        errorMessage: "读取架构运行状态映射失败。"
      });
    },
    async handleSampleBusinessPacks({ operation, response }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "sample_business_pack.list",
        response,
        errorMessage: "读取样例业务包列表失败。"
      });
    },
    async handleSampleBusinessPack({ operation, packId, response }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "sample_business_pack.get",
        input: { packId },
        response,
        errorMessage: "读取样例业务包失败。"
      });
    },
    async handleSampleBusinessPackMaterialize({ operation, requestBody, response }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "sample_business_pack.materialize",
        input: parseJsonBody(requestBody),
        response,
        errorMessage: "Sample business pack materialization failed."
      });
    },
    async handleModuleTemplates({ operation, response }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "module_ecosystem.templates",
        response,
        context: { moduleManagement },
        errorMessage: "读取模块生态模板失败。"
      });
    },
    async handleModuleScaffoldPlan({ operation, requestBody, response }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "module_ecosystem.plan",
        input: parseJsonBody(requestBody),
        response,
        context: { moduleManagement },
        errorMessage: "Module scaffold plan failed."
      });
    },
    async handleModuleScaffold({ operation, requestBody, response }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "module_ecosystem.scaffold",
        input: parseJsonBody(requestBody),
        response,
        context: { moduleManagement },
        errorMessage: "Module scaffold failed."
      });
    },
    async handleModuleContractTest({ operation, requestBody, response }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "module_ecosystem.contract_test",
        input: parseJsonBody(requestBody),
        response,
        context: { moduleManagement },
        errorMessage: "Module contract test failed."
      });
    },
    async handleStrategyManagement({ operation, requestBody, url, response, authSession }) {
      const operationId = operation?.id || "strategy.describe";
      if (!strategyOperationIds.has(operationId)) {
        await sendConsoleDomainOperation({
          operationId,
          input: operationInput(requestBody, url),
          response,
          errorMessage: "未知策略管理操作。"
        });
        return;
      }
      await sendConsoleDomainOperation({
        operationId,
        input: operationInput(requestBody, url),
        response,
        context: {
          authSession,
          strategyManagementProvider: getStrategyManagementProvider()
        },
        errorMessage: "策略管理操作失败。"
      });
    },
    async handleWorkspaceGovernance({ response }) {
      await sendConsoleDomainOperation({
        operationId: "workspace_governance.describe",
        response
      });
    },
    async handleWorkspaceGovernancePolicy({ requestBody, response }) {
      await sendConsoleDomainOperation({
        operationId: "workspace_governance.policy.set",
        input: parseJsonBody(requestBody),
        response,
        errorMessage: "Workspace governance policy update failed."
      });
    },
    async handleWorkspaceGovernanceEvaluate({ requestBody, response }) {
      await sendConsoleDomainOperation({
        operationId: "workspace_governance.evaluate",
        input: parseJsonBody(requestBody),
        response,
        errorMessage: "Workspace governance evaluation failed."
      });
    },
    async handleWorkspaceGovernanceShareGrant({ requestBody, response }) {
      await sendConsoleDomainOperation({
        operationId: "workspace_governance.share_grant",
        input: parseJsonBody(requestBody),
        response,
        errorMessage: "Workspace governance share grant failed."
      });
    },
    async handleGerritRead({ requestBody, response }) {
      await sendConsoleDomainOperation({
        operationId: "gerrit.read",
        input: parseJsonBody(requestBody),
        response,
        errorMessage: "Gerrit read operation failed."
      });
    },
    async handleGerritWrite({ requestBody, response }) {
      await sendConsoleDomainOperation({
        operationId: "gerrit.write",
        input: parseJsonBody(requestBody),
        response,
        errorMessage: "Gerrit write operation failed."
      });
    },
    async handleGerritMaintain({ requestBody, response }) {
      await sendConsoleDomainOperation({
        operationId: "gerrit.maintain",
        input: parseJsonBody(requestBody),
        response,
        errorMessage: "Gerrit maintain operation failed."
      });
    },
    async handleGerritGitUpload({ requestBody, response }) {
      await sendConsoleDomainOperation({
        operationId: "gerrit.git_upload",
        input: parseJsonBody(requestBody),
        response,
        errorMessage: "Gerrit git upload failed."
      });
    },
    async handleRepoOperation({ operation, requestBody, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "",
        input: parseJsonBody(requestBody),
        response,
        context: { authSession },
        errorMessage: "Repo operation failed."
      });
    },
    async handleAssetLineage({ response }) {
      await sendConsoleDomainOperation({
        operationId: "asset_lineage.describe",
        response
      });
    },
    async handleAssetLineageRecord({ requestBody, response }) {
      await sendConsoleDomainOperation({
        operationId: "asset_lineage.record",
        input: parseJsonBody(requestBody),
        response,
        errorMessage: "Asset lineage record failed."
      });
    },
    async handleAssetLineageTrace({ requestBody, response }) {
      await sendConsoleDomainOperation({
        operationId: "asset_lineage.trace",
        input: parseJsonBody(requestBody),
        response,
        errorMessage: "Asset lineage trace failed."
      });
    },
    async handleAssetLineageReparsePlan({ requestBody, response }) {
      await sendConsoleDomainOperation({
        operationId: "asset_lineage.reparse_plan",
        input: parseJsonBody(requestBody),
        response,
        errorMessage: "Asset lineage reparse plan failed."
      });
    },
    async handleDataConnectorGovernance({ response }) {
      await sendConsoleDomainOperation({
        operationId: "data_connectors.governance.describe",
        response
      });
    },
    async handleDataConnectorGovernancePlan({ requestBody, response }) {
      await sendConsoleDomainOperation({
        operationId: "data_connectors.governance.plan",
        input: parseJsonBody(requestBody),
        response,
        errorMessage: "Data connector governance plan failed."
      });
    },
    async handleDataConnectorGovernanceConformance({ requestBody, response }) {
      await sendConsoleDomainOperation({
        operationId: "data_connectors.governance.conformance",
        input: parseJsonBody(requestBody),
        response,
        errorMessage: "Data connector conformance failed."
      });
    },
    async handlePerformanceCapacityTargets({ response }) {
      await sendConsoleDomainOperation({
        operationId: "performance.capacity.targets",
        response
      });
    },
    async handlePerformanceCapacityBenchmark({ requestBody, response }) {
      await sendConsoleDomainOperation({
        operationId: "performance.capacity.benchmark",
        input: parseJsonBody(requestBody),
        response,
        errorMessage: "Performance capacity benchmark failed."
      });
    }
  };
}
