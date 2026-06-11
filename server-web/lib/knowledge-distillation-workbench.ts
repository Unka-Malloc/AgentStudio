// Minimal types and API stubs for knowledge distillation debug UI.
// Legacy workbench has been removed; this file provides only the types
// and URL helpers needed by the console debug distillation panel.

export interface WorkbenchRun {
  runId: string;
  title?: string;
  status: string;
  query: string;
  stages: WorkbenchStage[];
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkbenchStage {
  stageId: string;
  stageKey: string;
  status: string;
  output?: Record<string, unknown>;
  startedAt?: string;
  finishedAt?: string;
}

// Workbench client stubs - debug panel uses these for legacy UI display.
// The actual distillation execution goes through external KD client.
export async function createKnowledgeDistillationWorkbenchRun(_input?: Record<string, unknown>): Promise<WorkbenchRun> {
  throw new Error("knowledge-distillation workbench has been removed; use external.knowledge.distillation instead");
}

export async function getKnowledgeDistillationWorkbenchRun(_runId?: string): Promise<WorkbenchRun> {
  throw new Error("knowledge-distillation workbench has been removed; use external.knowledge.distillation instead");
}

export async function getKnowledgeDistillationWorkbenchRunArtifacts(_runId?: string): Promise<Record<string, unknown>> {
  throw new Error("knowledge-distillation workbench has been removed; use external.knowledge.distillation instead");
}

export function knowledgeDistillationWorkbenchExportUrl(_runId?: string, _stageId?: string, _format?: string): string {
  return "";
}

export function knowledgeDistillationWorkbenchPackageUrl(_runId?: string): string {
  return "";
}
