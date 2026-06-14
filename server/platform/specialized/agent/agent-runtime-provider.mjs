import { loadSettings } from "../../common/platform-core/settings.mjs";

export const AGENT_RUNTIME_PROVIDER_PROTOCOL_VERSION = "v0.0.1:agent:runtime-1";

function requireFunction(value, name) {
  if (typeof value !== "function") {
    throw new Error(`agent runtime provider is missing ${name}.`);
  }
  return value;
}

export function createAgentRuntimeProvider({
  getAgentConfigRegistry,
  loadAgentGatewayModule,
  loadModelProbeModule
} = {}) {
  const registryFactory = requireFunction(getAgentConfigRegistry, "getAgentConfigRegistry");
  const gatewayModuleLoader = requireFunction(loadAgentGatewayModule, "loadAgentGatewayModule");
  const modelProbeModuleLoader = requireFunction(loadModelProbeModule, "loadModelProbeModule");

  async function loadGatewayModule() {
    return gatewayModuleLoader();
  }

  async function runtimeSettingsWithModelLibrary(userDataPath) {
    const runtimeSettings = await loadSettings(userDataPath);
    const registry = registryFactory();
    await registry.refresh({ settingsFallback: runtimeSettings });
    return {
      ...runtimeSettings,
      modelLibraryAgents: registry.getModelLibraryAgents(),
      modelLibraryEntries: registry.getModelLibraryEntries()
    };
  }

  return Object.freeze({
    protocolVersion: AGENT_RUNTIME_PROVIDER_PROTOCOL_VERSION,
    describe() {
      return {
        schemaVersion: "v0.0.1:schema:definition-1",
        protocolVersion: AGENT_RUNTIME_PROVIDER_PROTOCOL_VERSION,
        capabilities: [
          "agent.settings.read",
          "agent.settings.write",
          "agent.gateway.config",
          "agent.gateway.call",
          "agent.gateway.registry",
          "agent.model.probe",
          "agent.model.routing.health"
        ]
      };
    },
    getAgentConfigRegistry() {
      return registryFactory();
    },
    async loadAgentGatewayModule() {
      return loadGatewayModule();
    },
    async publicAgentGatewayConfig(settings = {}) {
      const { publicAgentGatewayConfig } = await loadGatewayModule();
      return publicAgentGatewayConfig(settings);
    },
    async publicAgentGatewayRegistry(settings = {}) {
      const { publicAgentGatewayRegistry } = await loadGatewayModule();
      return publicAgentGatewayRegistry(settings);
    },
    async callAgentGateway(input = {}) {
      const { callAgentGateway } = await loadGatewayModule();
      return callAgentGateway(input);
    },
    async callGatewayWithRuntimeSettings({
      userDataPath,
      input,
      contextRuntime = null,
      clientRuntimeAllocator = null,
      contextCompactionSource = ""
    } = {}) {
      return this.callAgentGateway({
        settings: await runtimeSettingsWithModelLibrary(userDataPath),
        input,
        userDataPath,
        contextRuntime,
        contextCompactionSource,
        clientRuntimeAllocator
      });
    },
    async probeModelConnection(input = {}) {
      const { probeModelConnection } = await modelProbeModuleLoader();
      return probeModelConnection(input);
    },
    async inspectAgentModelRouting(input = {}) {
      const { inspectAgentModelRouting } = await loadGatewayModule();
      return inspectAgentModelRouting(input);
    }
  });
}
