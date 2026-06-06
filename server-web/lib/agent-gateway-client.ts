import { getJson, postJson } from "./bridge-http";
import type {
  AgentGatewayCallRequest,
  AgentGatewayCallResponse,
  AgentGatewayConfig,
} from "./types";

export type {
  AgentGatewayCallRequest,
  AgentGatewayCallResponse,
  AgentGatewayConfig,
} from "./types";

export function getAgentGatewayConfig() {
  return getJson<{ config: AgentGatewayConfig }>("/api/agent-gateway/config");
}

export function saveAgentGatewayConfig(config: Partial<AgentGatewayConfig>) {
  return postJson<{ config: AgentGatewayConfig }>(
    "/api/agent-gateway/config",
    { config },
    { safetyConfirm: true },
  );
}

export function callAgentGateway(payload: AgentGatewayCallRequest) {
  return postJson<AgentGatewayCallResponse>("/api/agent-gateway/call", payload);
}
