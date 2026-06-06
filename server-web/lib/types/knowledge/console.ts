import type { SplitJob } from "../split";
import type { KnowledgeSourceState } from "./sources";

export type KnowledgeProtocolModule = {
  id?: string;
  kind?: string;
  enabled?: boolean;
  status?: string;
  backend?: string;
  license?: string;
  reason?: string;
  [key: string]: unknown;
};

export type KnowledgeHealth = {
  ok?: boolean;
  status?: string;
  protocol?: string;
  counts?: Record<string, number>;
  modules?: Record<string, KnowledgeProtocolModule>;
  quality?: Record<string, number>;
  recentMaintenanceRuns?: KnowledgeMaintenanceRun[];
  [key: string]: unknown;
};

export type KnowledgeCapabilities = {
  protocol?: string;
  methods?: string[];
  retrievalModes?: Array<{ value: string; label: string }>;
  modules?: Record<string, KnowledgeProtocolModule>;
  [key: string]: unknown;
};

export type MaintenanceSettings = Record<string, unknown>;

export type KnowledgeMaintenanceRun = {
  runId: string;
  taskType: string;
  status: "queued" | "running" | "completed" | "failed" | string;
  inputSummary?: Record<string, unknown>;
  outputSummary?: Record<string, unknown>;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
  createdAt?: string;
};

export type KnowledgeConsoleState = {
  available: boolean;
  health: KnowledgeHealth | null;
  capabilities: KnowledgeCapabilities | null;
  maintenance: MaintenanceSettings | null;
  recentJobs: SplitJob[];
  sources?: KnowledgeSourceState;
};

export type KnowledgeConfigField = {
  name: string;
  type: "string" | "number" | "boolean" | "select" | string;
  label: string;
  defaultValue?: unknown;
  min?: number;
  max?: number;
  step?: number;
  options?: Array<{ label: string; value: string | number | boolean }>;
  description?: string;
  danger?: "low" | "medium" | "high" | string;
};

export type KnowledgeConfigSchema = {
  schemaVersion: number;
  groups: Array<{
    id: string;
    label: string;
    fields: KnowledgeConfigField[];
  }>;
  maintenanceTasks: Array<{
    id: string;
    label: string;
    danger: "low" | "medium" | "high" | string;
    requiresConfirm: boolean;
    supportsDryRun?: boolean;
  }>;
};
