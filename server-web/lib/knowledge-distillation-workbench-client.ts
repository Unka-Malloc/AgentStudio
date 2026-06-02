import { deleteJson, getJson, postJson } from "./bridge-http";

export type DistillationWorkflowScope = "document" | "corpus" | "project";

export type CreateKnowledgeDistillationWorkbenchRunPayload = Record<string, unknown> & {
  workflowScope: DistillationWorkflowScope;
};

export function listKnowledgeDistillationWorkbenchRuns(limit = 50) {
  return getJson<Record<string, unknown>>(
    `/api/knowledge/distillation/workbench/runs?limit=${encodeURIComponent(String(limit))}`,
  );
}

export function createKnowledgeDistillationWorkbenchRun(payload: CreateKnowledgeDistillationWorkbenchRunPayload) {
  return postJson<Record<string, unknown>>(
    "/api/knowledge/distillation/workbench/runs",
    payload,
    { safetyConfirm: true },
  );
}

export function getKnowledgeDistillationWorkbenchRun(runId: string) {
  return getJson<Record<string, unknown>>(
    `/api/knowledge/distillation/workbench/runs/${encodeURIComponent(runId)}`,
  );
}

export function resumeKnowledgeDistillationWorkbenchRun(runId: string) {
  return postJson<Record<string, unknown>>(
    `/api/knowledge/distillation/workbench/runs/${encodeURIComponent(runId)}/resume`,
    {},
    { safetyConfirm: true },
  );
}

export function cancelKnowledgeDistillationWorkbenchRun(runId: string, reason = "") {
  return postJson<Record<string, unknown>>(
    `/api/knowledge/distillation/workbench/runs/${encodeURIComponent(runId)}/cancel`,
    { reason },
    { safetyConfirm: true },
  );
}

export function archiveKnowledgeDistillationWorkbenchRun(runId: string) {
  return postJson<Record<string, unknown>>(
    `/api/knowledge/distillation/workbench/runs/${encodeURIComponent(runId)}/archive`,
    {},
    { safetyConfirm: true },
  );
}

export function deleteKnowledgeDistillationWorkbenchRun(runId: string) {
  return deleteJson<Record<string, unknown>>(
    `/api/knowledge/distillation/workbench/runs/${encodeURIComponent(runId)}`,
    { safetyConfirm: true },
  );
}

export function rerunKnowledgeDistillationWorkbenchStage(runId: string, stageId: string) {
  return postJson<Record<string, unknown>>(
    `/api/knowledge/distillation/workbench/runs/${encodeURIComponent(runId)}/stages/${encodeURIComponent(stageId)}/rerun`,
    {},
    { safetyConfirm: true },
  );
}

export function getKnowledgeDistillationWorkbenchRunArtifacts(runId: string) {
  return getJson<Record<string, unknown>>(
    `/api/knowledge/distillation/workbench/runs/${encodeURIComponent(runId)}/artifacts`,
  );
}

export function compareKnowledgeDistillationWorkbenchRuns(leftRunId: string, rightRunId: string) {
  const query = new URLSearchParams();
  query.set("rightRunId", rightRunId);
  return getJson<Record<string, unknown>>(
    `/api/knowledge/distillation/workbench/runs/${encodeURIComponent(leftRunId)}/compare?${query.toString()}`,
  );
}

export function knowledgeDistillationWorkbenchExportUrl(
  runId: string,
  stageId: string,
  format = "markdown",
) {
  const query = new URLSearchParams();
  query.set("format", format);
  return `/api/knowledge/distillation/workbench/runs/${encodeURIComponent(runId)}/exports/${encodeURIComponent(stageId)}?${query.toString()}`;
}

export function knowledgeDistillationWorkbenchPackageUrl(runId: string) {
  return `/api/knowledge/distillation/workbench/runs/${encodeURIComponent(runId)}/package`;
}
