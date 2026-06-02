import { getJson, postJson } from "./bridge-http";
import type {
  KnowledgeConfigSchema,
  KnowledgeConsoleState,
  MaintenanceSettings,
} from "./types";

export type KnowledgeMaintenanceRunPayload = {
  taskType: string;
  confirm?: boolean;
  [key: string]: unknown;
};

export type KnowledgeReindexPayload = {
  confirm?: boolean;
  [key: string]: unknown;
};

export function getKnowledgeConsole() {
  return getJson<KnowledgeConsoleState>("/api/knowledge/console");
}

export function getKnowledgeConfigSchema() {
  return getJson<KnowledgeConfigSchema>("/api/knowledge/config-schema");
}

export function getKnowledgeMaintenance() {
  return getJson<MaintenanceSettings>("/api/knowledge/maintenance");
}

export function saveKnowledgeMaintenance(settings: MaintenanceSettings) {
  return postJson<MaintenanceSettings>(
    "/api/knowledge/maintenance",
    { value: settings },
    { safetyConfirm: true },
  );
}

export function runKnowledgeMaintenance(payload: KnowledgeMaintenanceRunPayload) {
  return postJson<Record<string, unknown>>("/api/knowledge/maintenance/run", payload);
}

export function reindexKnowledge(payload: KnowledgeReindexPayload = { confirm: true }) {
  return postJson<Record<string, unknown>>("/api/knowledge/reindex", payload, {
    safetyConfirm: true,
  });
}
