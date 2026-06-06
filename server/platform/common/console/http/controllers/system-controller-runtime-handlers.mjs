export function createSystemControllerRuntimeHandlers({
  sendConsoleDomainOperation,
  parseJsonBody,
  queryPayload,
  isFeatureActive,
  knowledgeWorkflowContext,
  coreProvider,
  getControllers,
  getFeatureEntries,
  protocolEventBus,
  getDiscoveryState,
  setDiscoveryState,
  getListenUrl,
  serverLabel,
  distPath,
  runtime,
  moduleManagement,
  jobWorkflowProvider,
  storageProvider,
  securityPermissions,
  maintenanceAgent,
  clientRuntimeAllocator,
  getToolSkillManagementProvider = () => null,
  consoleDomainServices
}) {
  return {
    async handleBootstrap({ operation, response }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "system.bootstrap",
        response,
        context: {
          ...knowledgeWorkflowContext(),
          discoveryState: getDiscoveryState()
        },
        errorMessage: "读取客户端启动配置失败。"
      });
    },
    async handleHealthz({ operation, response }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "system.health",
        response,
        context: { discoveryState: getDiscoveryState() },
        errorMessage: "读取健康状态失败。"
      });
    },
    async handleListInterfaces({ operation, response }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "system.interfaces",
        response,
        context: { coreProvider, getControllers, getFeatureEntries },
        errorMessage: "读取接口注册表失败。"
      });
    },
    async handleV001BaselineStatus({ operation, response }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "v001.baseline.status",
        response,
        context: {},
        errorMessage: "读取 v0.0.1 基线状态失败。"
      });
    },
    async handleSubscribeEvents({ operation, request, url, response }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "events.subscribe",
        input: queryPayload(url),
        response,
        context: {
          protocolEventBus,
          request,
          response,
          agentSyncFeatureActive: isFeatureActive("agent-gateway")
        },
        errorMessage: "订阅事件失败。"
      });
    },
    async handleAgentSyncConfig({ operation, requestBody, response }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || (requestBody.length === 0 ? "agent_sync.config.get" : "agent_sync.config.set"),
        input: requestBody.length === 0 ? {} : parseJsonBody(requestBody),
        response,
        context: {
          protocolEventBus,
          agentSyncFeatureActive: isFeatureActive("agent-gateway")
        },
        errorMessage: "处理智能体同步配置失败。"
      });
    },
    async handleAgentSyncPublish({ operation, request, requestBody, response }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "agent_sync.publish",
        input: parseJsonBody(requestBody),
        response,
        context: {
          protocolEventBus,
          toolSkillManagementProvider: getToolSkillManagementProvider(),
          request,
          agentSyncFeatureActive: isFeatureActive("agent-gateway")
        },
        errorMessage: "发布智能体同步事件失败。"
      });
    },
    async handleAgentSyncSubscribe({ operation, request, url, response }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "agent_sync.subscribe",
        input: queryPayload(url),
        response,
        context: {
          protocolEventBus,
          request,
          response,
          agentSyncFeatureActive: isFeatureActive("agent-gateway")
        },
        errorMessage: "订阅智能体同步事件失败。"
      });
    },
    async handleDiscoveryCheckIn({ requestBody, response }) {
      await sendConsoleDomainOperation({
        operationId: "discovery.check_in",
        input: parseJsonBody(requestBody),
        response,
        context: {
          ...knowledgeWorkflowContext(),
          discoveryState: getDiscoveryState(),
          protocolEventBus
        },
        errorMessage: "客户端迁移登记失败。"
      });
    },
    async handleListDiscoveryClients({ operation, response }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "discovery.clients",
        response,
        context: {
          storageProvider,
          discoveryState: getDiscoveryState(),
          toolSkillManagementProvider: getToolSkillManagementProvider(),
          consoleDomainServices
        },
        errorMessage: "读取 discovery client 列表失败。"
      });
    },
    async handleRequestClientMigration({ operation, clientId, requestBody, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "discovery.clients.migration",
        input: {
          ...parseJsonBody(requestBody),
          ...(clientId ? { clientId } : {})
        },
        response,
        context: {
          discoveryState: getDiscoveryState(),
          storageProvider,
          protocolEventBus,
          authSession
        },
        errorMessage: "发布客户端迁移指令失败。"
      });
    },
    async handleGetDiscoveryConfig({ operation, response }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "discovery.get_config",
        response,
        context: { discoveryState: getDiscoveryState() },
        errorMessage: "读取服务发现配置失败。"
      });
    },
    async handleSetDiscoveryConfig({ operation, requestBody, response }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "discovery.set_config",
        input: parseJsonBody(requestBody),
        response,
        context: {
          listenUrl: getListenUrl(),
          serverLabel,
          setDiscoveryState,
          protocolEventBus
        },
        errorMessage: "保存服务发现配置失败。"
      });
    },
    async handleGetRuntimeInfo({ operation, request, response }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "runtime.info",
        response,
        context: {
          distPath,
          runtime,
          moduleManagement,
          discoveryState: getDiscoveryState(),
          storageProvider,
          serverUrl: getListenUrl(),
          securityPermissions,
          request,
          features: getFeatureEntries ? getFeatureEntries() : null,
          consoleDomainServices
        },
        errorMessage: "读取运行时信息失败。"
      });
    },
    async handleBrowseServerPath({ operation, requestBody, response }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "runtime.path_browse",
        input: parseJsonBody(requestBody),
        response,
        context: { distPath },
        errorMessage: "浏览服务端路径失败。"
      });
    },
    async handleGetMounts({ operation, request, response }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "runtime.mounts",
        response,
        context: {
          moduleManagement,
          distPath,
          discoveryState: getDiscoveryState(),
          storageProvider,
          serverUrl: getListenUrl(),
          securityPermissions,
          request,
          features: getFeatureEntries ? getFeatureEntries() : null,
          consoleDomainServices
        },
        errorMessage: "读取挂载配置失败。"
      });
    },
    async handleSetMounts({ operation, requestBody, response }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "runtime.set_mounts",
        input: parseJsonBody(requestBody),
        response,
        context: { moduleManagement, protocolEventBus },
        errorMessage: "保存挂载配置失败。"
      });
    },
    async handleReloadMounts({ operation, requestBody, response }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "runtime.reload_mounts",
        input: parseJsonBody(requestBody),
        response,
        context: { moduleManagement, protocolEventBus },
        errorMessage: "重载挂载配置失败。"
      });
    },
    async handleListRuntimeDependencies({ operation, response }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "runtime.dependencies.list",
        response,
        context: {},
        errorMessage: "读取运行时依赖状态失败。"
      });
    },
    async handleDownloadRuntimeDependency({ operation, requestBody, response }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "runtime.dependencies.download",
        input: parseJsonBody(requestBody),
        response,
        context: {},
        errorMessage: "准备运行时依赖失败。"
      });
    },
    async handleConfigureRuntimeDependency({ operation, requestBody, response }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "runtime.dependencies.configure",
        input: parseJsonBody(requestBody),
        response,
        context: {},
        errorMessage: "保存运行时依赖配置失败。"
      });
    },
    async handleGetConsoleState({ operation, request, response }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "system.console_state",
        response,
        context: {
          distPath,
          runtime,
          moduleManagement,
          discoveryState: getDiscoveryState(),
          jobWorkflowProvider,
          storageProvider,
          serverUrl: getListenUrl(),
          securityPermissions,
          request,
          maintenanceAgent,
          clientRuntimeAllocator,
          features: getFeatureEntries ? getFeatureEntries() : null,
          toolSkillManagementProvider: getToolSkillManagementProvider(),
          consoleDomainServices
        },
        errorMessage: "读取控制台状态失败。"
      });
    },
    async handleMaintenanceAgentConfig({ operation, requestBody, authSession, response }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || (requestBody.length > 0
          ? "maintenance_agent.config.set"
          : "maintenance_agent.config.get"),
        input: requestBody.length > 0 ? parseJsonBody(requestBody) : {},
        response,
        context: { maintenanceAgent, authSession },
        errorMessage: "维护智能体配置操作失败。"
      });
    },
    async handleMaintenanceAgentChat({ operation, requestBody, authSession, response }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "maintenance_agent.chat",
        input: parseJsonBody(requestBody),
        response,
        context: { maintenanceAgent, authSession },
        errorMessage: "维护智能体对话失败。"
      });
    },
    async handleMaintenanceAgentRuns({ operation, requestBody, url, authSession, response }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || (requestBody.length > 0
          ? "maintenance_agent.runs.create"
          : "maintenance_agent.runs.list"),
        input: requestBody.length > 0
          ? parseJsonBody(requestBody)
          : { limit: Number(url.searchParams.get("limit") || 50) },
        response,
        context: { maintenanceAgent, authSession },
        errorMessage: "维护智能体运行操作失败。"
      });
    },
    async handleMaintenanceAgentRun({ operation, runId, response }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "maintenance_agent.runs.get",
        input: { runId },
        response,
        context: { maintenanceAgent },
        errorMessage: "读取维护智能体运行失败。"
      });
    },
    async handleMaintenanceAgentApprove({ operation, runId, requestBody, authSession, response }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "maintenance_agent.runs.approve",
        input: {
          ...parseJsonBody(requestBody),
          runId
        },
        response,
        context: { maintenanceAgent, authSession },
        errorMessage: "维护运行审批失败。"
      });
    },
    async handleMaintenanceAgentCancel({ operation, runId, requestBody, authSession, response }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "maintenance_agent.runs.cancel",
        input: {
          ...parseJsonBody(requestBody),
          runId
        },
        response,
        context: { maintenanceAgent, authSession },
        errorMessage: "维护运行取消失败。"
      });
    }
  };
}
