import { loadSettings } from "../common/platform-core/settings.mjs";
import { createStrategyManagementProvider } from "../specialized/capabilities/strategy-management/strategy-management-provider.mjs";
import { createToolSkillManagementProvider } from "../specialized/capabilities/skills/tool-skill-management-provider.mjs";
import { createToolManagementPlatform } from "../specialized/capabilities/tools/tool-management-core/index.mjs";
import { createToolManagementStore } from "../specialized/capabilities/tools/tool-management-core/store.mjs";
import {
  createExternalKnowledgeDistillationClient,
  resolveExternalKnowledgeDistillationConfig
} from "../specialized/knowledge/invocation/external-distillation-service/index.mjs";

async function createProvider(enabled, specifier, exportName, args = []) {
  if (!enabled) {
    return null;
  }
  const loaded = await import(specifier);
  const factory = loaded[exportName];
  if (typeof factory !== "function") {
    throw new Error(`Runtime provider ${specifier} does not export ${exportName}.`);
  }
  return factory(...args);
}

function createExternalKnowledgeDistillationService({ userDataPath }) {
  async function clientFor(input = {}) {
    const settings = await loadSettings(userDataPath);
    const config = resolveExternalKnowledgeDistillationConfig({ input, settings });
    return createExternalKnowledgeDistillationClient(config);
  }
  return Object.freeze({
    service: "external.knowledge.distillation",
    async createRun(input = {}) {
      return (await clientFor(input)).createRun(input);
    },
    async getRun(input = {}) {
      return (await clientFor(input)).getRun(input);
    },
    async queryEvidence(input = {}) {
      return (await clientFor(input)).queryEvidence(input);
    }
  });
}

export function createServerToolManagementPlatform({
  userDataPath,
  operations,
  featureRuntime,
  controllers,
  operationAuditStore,
  operationConcurrencyScope,
  protocolEventBus,
  consoleAuth,
  securityPermissions,
  strategyManagementProvider = null,
  logger
}) {
  return createToolManagementPlatform({
    userDataPath,
    operations,
    featureRuntime,
    controllers,
    operationAuditStore,
    operationConcurrencyScope,
    protocolEventBus,
    consoleAuth,
    securityPermissions,
    strategyManagementProvider,
    logger
  });
}

export function createServerToolSkillManagementProvider({
  toolManagementPlatform,
  userDataPath,
  securityPermissions,
  logger
}) {
  return createToolSkillManagementProvider({
    toolManagementPlatform,
    userDataPath,
    securityPermissions,
    logger
  });
}

export async function createServerRuntimeProviders({
  userDataPath,
  runtime,
  jobManager,
  metadataStore,
  protocolEventBus,
  getDiscoveryState,
  getListenUrl,
  getControllers,
  operationAuditStore,
  operationConcurrencyScope,
  dataStructures = null,
  queueMonitor,
  runtimeLogger,
  clientRuntimeAllocator,
  securityPermissions,
  getToolManagementPlatform = () => null,
  isFeatureActive,
  isAnyFeatureActive
}) {
  let strategyManagementProvider = null;
  const needsContextRuntime = isAnyFeatureActive(
    "client-runtime-core",
    "agent-exploration",
    "knowledge-distillation",
    "knowledge-evolution",
    "knowledge-outline-reasoning",
    "maintenance-agent-runbooks"
  );
  const needsAgentMemory = isFeatureActive("agent-memory") || needsContextRuntime;
  const agentMemory = await createProvider(
    needsAgentMemory,
    "../specialized/agent/agent-memory/index.mjs",
    "createAgentMemory",
    [{ userDataPath }]
  );
  const callAgentGatewayIfAvailable = async (input = {}, options = {}) => {
    if (!isFeatureActive("agent-gateway")) {
      throw new Error("AgentGateway feature is not active in this feature edition.");
    }
    const { callAgentGateway } = await import("../specialized/agent/agent-gateway/index.mjs");
    return callAgentGateway({
      ...options,
      input,
      userDataPath,
      clientRuntimeAllocator,
      strategyProvider: strategyManagementProvider
    });
  };
  const contextRuntime = await createProvider(
    needsContextRuntime,
    "../specialized/agent/agent-context/interface/index.mjs",
    "createContextRuntime",
    [{
      userDataPath,
      agentMemory,
      clientRuntimeAllocator,
      agentGatewayCall: async (input = {}) => callAgentGatewayIfAvailable(input, {
        settings: await loadSettings(userDataPath)
      })
    }]
  );
  const maintenanceAgent = await createProvider(
    isFeatureActive("maintenance-agent-runbooks"),
    "../../services/agent/maintenance-agent/index.mjs",
    "createMaintenanceAgentService",
    [{
      userDataPath,
      runtime,
      jobManager,
      metadataStore,
      protocolEventBus,
      getDiscoveryState,
      getListenUrl,
      contextRuntime,
      getControllers,
      operationAuditStore,
      operationConcurrencyScope,
      toolManagementStore: createToolManagementStore({ userDataPath }),
      queueMonitor,
      schedulerEnabled: process.env.PACT_MAINTENANCE_WORKER_EXTERNAL !== "1",
      logger: runtimeLogger
    }]
  );
  const knowledgeSourceService = await createProvider(
    isFeatureActive("knowledge-core"),
    "../specialized/knowledge/storage/knowledge-source-service.mjs",
    "createKnowledgeSourceService",
    [{
      userDataPath,
      jobManager,
      protocolEventBus,
      watchingEnabled: process.env.PACT_SOURCE_WATCHER_EXTERNAL !== "1"
    }]
  );
  const agentWorkspace = await createProvider(
    isAnyFeatureActive("local-sharedspace", "agent-exploration", "knowledge-distillation"),
    "../specialized/agent/agent-workspace/index.mjs",
    "createAgentWorkspace",
    [{
      userDataPath,
      merkleState: dataStructures?.merkleState || null,
      checkpointTreeApi: dataStructures?.checkpointTree || null
    }]
  );
  const baseModelDecisionRuntime = await createProvider(
    isAnyFeatureActive("knowledge-distillation", "knowledge-evolution", "knowledge-outline-reasoning", "agent-exploration"),
    "../specialized/agent/agent-gateway/model-decision-runtime/index.mjs",
    "createModelDecisionRuntime",
    [{
      agentGatewayCall: async (input = {}) => callAgentGatewayIfAvailable(input, {
        settings: await loadSettings(userDataPath),
        contextRuntime,
        contextCompactionSource: "model-decision-runtime"
      })
    }]
  );
  strategyManagementProvider = createStrategyManagementProvider({
    userDataPath,
    modelDecisionRuntime: baseModelDecisionRuntime,
    getToolManagementPlatform
  });
  const modelDecisionRuntime = strategyManagementProvider.createModelDecisionRuntimePort();
  const evidenceSufficiencyGate = await createProvider(
    isFeatureActive("knowledge-distillation"),
    "../specialized/knowledge/retrieval/evidence-sufficiency-gate/index.mjs",
    "createEvidenceSufficiencyGate"
  );
  const knowledgeAgentSkill = await createProvider(
    isFeatureActive("knowledge-distillation"),
    "../specialized/knowledge/invocation/knowledge-agent-skill-runtime/index.mjs",
    "createKnowledgeAgentSkillRuntime",
    [{
      runtime,
      evidenceGate: evidenceSufficiencyGate,
      modelDecisionRuntime
    }]
  );
  const goldenRuleRuntime = await createProvider(
    isFeatureActive("knowledge-distillation"),
    "../specialized/knowledge/invocation/golden-rule-runtime/index.mjs",
    "createGoldenRuleRuntime",
    [{
      userDataPath,
      knowledgeCore: runtime?.mounts?.knowledgeBase
    }]
  );
  const knowledgeRuleAuthoringRuntime = await createProvider(
    isFeatureActive("knowledge-distillation"),
    "../specialized/knowledge/invocation/knowledge-rule-authoring-runtime/index.mjs",
    "createKnowledgeRuleAuthoringRuntime",
    [{
      userDataPath,
      goldenRuleRuntime,
      modelDecisionRuntime
    }]
  );
  const knowledgeSkillRuntime = await createProvider(
    isFeatureActive("knowledge-distillation"),
    "../specialized/knowledge/invocation/knowledge-skill-runtime/index.mjs",
    "createKnowledgeSkillRuntime",
    [{
      userDataPath,
      runtime,
      modelDecisionRuntime,
      goldenRuleRuntime
    }]
  );
  const agentEvaluationRuntime = await createProvider(
    isFeatureActive("knowledge-distillation"),
    "../specialized/capabilities/tools/agent-evaluation-runtime/index.mjs",
    "createAgentEvaluationRuntime",
    [{
      userDataPath,
      knowledgeAgentSkill
    }]
  );
  const knowledgeDistillationService = createExternalKnowledgeDistillationService({ userDataPath });
  const knowledgeEvolutionRuntime = await createProvider(
    isFeatureActive("knowledge-evolution"),
    "../specialized/knowledge/invocation/knowledge-evolution-runtime/index.mjs",
    "createKnowledgeEvolutionRuntime",
    [{
      userDataPath,
      knowledgeCore: runtime?.mounts?.knowledgeBase,
      agentEvaluationRuntime,
      modelDecisionRuntime,
      knowledgeSkillRuntime,
      goldenRuleRuntime,
      knowledgeDistillationService
    }]
  );
  const summarizationRuntime = await createProvider(
    isFeatureActive("knowledge-distillation"),
    "../specialized/knowledge/invocation/knowledge-summarization-runtime/index.mjs",
    "createSummarizationRuntime",
    [{
      userDataPath,
      runtime,
      agentWorkspace,
      contextRuntime,
      protocolEventBus,
      clientRuntimeAllocator
    }]
  );
  const agentExplorationRuntime = await createProvider(
    isFeatureActive("agent-exploration"),
    "../specialized/capabilities/tools/agent-exploration-runtime/index.mjs",
    "createAgentExplorationRuntime",
    [{
      userDataPath,
      runtime,
      agentWorkspace,
      contextRuntime,
      agentGatewayCall: async (input = {}) => callAgentGatewayIfAvailable(input, {
        settings: await loadSettings(userDataPath),
        contextRuntime,
        contextCompactionSource: "agent-exploration-runtime"
      }),
      knowledgeSkillRuntime,
      knowledgeRuleAuthoringRuntime,
      clientRuntimeAllocator,
      securityPermissions
    }]
  );

  return Object.freeze({
    contextRuntime,
    maintenanceAgent,
    knowledgeSourceService,
    agentWorkspace,
    strategyManagementProvider,
    modelDecisionRuntime,
    evidenceSufficiencyGate,
    knowledgeAgentSkill,
    goldenRuleRuntime,
    knowledgeRuleAuthoringRuntime,
    knowledgeSkillRuntime,
    agentEvaluationRuntime,
    knowledgeEvolutionRuntime,
    summarizationRuntime,
    agentExplorationRuntime
  });
}
