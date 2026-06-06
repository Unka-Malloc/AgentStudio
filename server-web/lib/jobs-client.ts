import { deleteJson, getJson, postJson } from "./bridge-http";
import type {
  AgentSettings,
  DocumentParsingConfig,
  SplitJob,
  SplitJobListResponse,
  SplitPayload,
  SplitResult,
} from "./types";

export type ReparseJobPayload = {
  documentParsing?: DocumentParsingConfig;
  settings?: AgentSettings;
};

export function createJob(payload: SplitPayload) {
  return postJson<SplitJob>("/api/jobs", payload);
}

export function reparseJob(jobId: string, payload: ReparseJobPayload = {}) {
  return postJson<SplitJob>(`/api/jobs/${encodeURIComponent(jobId)}/reparse`, payload);
}

export function listJobs(limit = 50) {
  return getJson<SplitJobListResponse>(`/api/jobs?limit=${encodeURIComponent(String(limit))}`);
}

export function deleteJob(jobId: string) {
  return deleteJson<{ ok: boolean; deletedJob: SplitJob }>(
    `/api/jobs/${encodeURIComponent(jobId)}`,
    { safetyConfirm: true },
  );
}

export function getJob(jobId: string) {
  return getJson<SplitJob>(`/api/jobs/${encodeURIComponent(jobId)}`);
}

export function getJobResult(jobId: string) {
  return getJson<SplitResult>(`/api/jobs/${encodeURIComponent(jobId)}/result`);
}
