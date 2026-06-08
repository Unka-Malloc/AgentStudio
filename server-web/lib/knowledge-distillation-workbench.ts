// Minimal types and API stubs for knowledge distillation debug UI.
// Legacy workbench has been removed; this file provides only the types
// and URL helpers needed by the console debug distillation panel.

export interface WorkbenchRun {
  runId: string;
  status: string;
  query: string;
  stages: WorkbenchStage[];
  createdAt: string;
  updatedAt: string;
}

export interface WorkbenchStage {
  stageId: string;
  stageKey: string;
  status: string;
  startedAt?: string;
  finishedAt?: string;
}

// Workbench client stubs - debug panel uses these for legacy UI display.
// The actual distillation execution goes through external KD client.
export async function createKnowledgeDistillationWorkbenchRun(): Promise<WorkbenchRun> {
  throw new Error("knowledge-distillation workbench has been removed; use external.knowledge.distillation instead");
}

export async function getKnowledgeDistillationWorkbenchRun(): Promise<WorkbenchRun> {
  throw new Error("knowledge-distillation workbench has been removed; use external.knowledge.distillation instead");
}

export async function getKnowledgeDistillationWorkbenchRunArtifacts(): Promise<unknown> {
  throw new Error("knowledge-distillation workbench has been removed; use external.knowledge.distillation instead");
}

export function knowledgeDistillationWorkbenchExportUrl(): string {
  return "";
}

export function knowledgeDistillationWorkbenchPackageUrl(): string {
  return "";
}
