import type { AgentSelectorOption } from "../lib/types";

export type ConsoleWordCloudAgentOption = AgentSelectorOption & {
  enabled: boolean;
  disabledReason: string;
};

export type ConsoleWordCloudMessage = {
  id: string;
  role: "user" | "agent" | "system";
  text: string;
  at: string;
};
