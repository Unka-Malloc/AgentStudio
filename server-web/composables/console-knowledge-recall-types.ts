import type { OptionBarOption } from "../types/app";

export type KnowledgeSearchFormState = {
  query: string;
};

export type KnowledgeRecallDebugFormState = {
  query: string;
  targetId: string;
  retrievalMode: string;
  keywordOnly: boolean;
  learningEnabled: boolean;
  explain: boolean;
};

export type KnowledgeRecallDebugTarget = {
  value: string;
  label: string;
  kind: "internal" | "source" | "external";
  provider?: string;
  spaceId?: string;
  sourceId?: string;
  modeOptions: OptionBarOption[];
};
