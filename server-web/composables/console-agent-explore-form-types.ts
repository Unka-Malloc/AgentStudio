export interface AgentExploreFormState {
  query: string;
  modelAlias: string;
  contextProfileId: string;
  thinkingMode: string;
  temperature: number;
  maxTokens: number;
  maxIterations: number;
  limit: number;
  toolChoice: string;
  workspaceId: string;
}

export interface AgentExploreFormDefaults {
  temperature: number;
  maxTokens: number;
  maxIterations: number;
  limit: number;
  toolChoice: string;
}
