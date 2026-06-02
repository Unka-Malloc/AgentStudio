import { deleteJson, getJson, postJson } from "./bridge-http";
import type {
  WsCheckpointTreeDetail,
  WsCheckpointTreeSummary,
  WsSession,
  WsSessionContext,
  WsSessionDetail,
  WsWorkspace,
} from "../types/workspaces";

export type WorkspaceConsolePayload = Record<string, any>;

export type WorkspaceListResponse = {
  workspaces?: WsWorkspace[];
};

export type WorkspaceSessionListResponse = {
  sessions?: WsSession[];
};

export type WorkspaceCheckpointTreeListResponse = {
  items?: WsCheckpointTreeSummary[];
};

export type WorkspaceChainBundle = {
  chain: WorkspaceConsolePayload;
  context: WorkspaceConsolePayload;
  files: WorkspaceConsolePayload;
  localDirs: WorkspaceConsolePayload;
  cloudDrives: WorkspaceConsolePayload;
  codespace: WorkspaceConsolePayload;
};

export type WorkspaceSessionBundle = {
  sessionData: WsSessionDetail;
  context: WsSessionContext;
};

export type WorkspaceLocalDirMount = {
  mountRef?: string;
  targetPath?: string;
  [key: string]: unknown;
};

export type WorkspaceProfilePatch = {
  contextProfileId?: string;
  toolGrantId?: string;
  modelAlias?: string;
  knowledgeScope?: {
    includeSourceIds: string[];
    excludeSourceIds: string[];
  };
};

export type WorkspaceCloudDriveQuery = {
  workspaceId: string;
  driveRef?: string;
  provider?: string;
  clientId?: string;
  [key: string]: unknown;
};

function encoded(value: string) {
  return encodeURIComponent(value);
}

function buildQuery(params: Record<string, unknown>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && String(value) !== "") {
      query.set(key, String(value));
    }
  }
  return query.toString();
}

export function listWorkspaceSummaries() {
  return getJson<WorkspaceListResponse>("/api/agent-workspaces?includeSummary=true");
}

export function listWorkspaceSessions() {
  return getJson<WorkspaceSessionListResponse>("/api/agent-sessions?limit=100&includeLastEvent=true");
}

export async function getWorkspaceChainBundle(workspaceId: string): Promise<WorkspaceChainBundle> {
  const [chain, context, files, localDirs, cloudDrives, codespace] = await Promise.all([
    getJson<WorkspaceConsolePayload>(`/api/agent-workspaces/${encoded(workspaceId)}/chain`),
    getJson<WorkspaceConsolePayload>(`/api/agent-workspaces/${encoded(workspaceId)}/context`),
    getJson<WorkspaceConsolePayload>(`/api/agent-workspaces/${encoded(workspaceId)}/files?recursive=true`)
      .catch(() => ({ files: [] })),
    getJson<WorkspaceConsolePayload>(`/api/agent-workspaces/${encoded(workspaceId)}/local-dir/mounts`)
      .catch(() => ({ mounts: [], count: 0 })),
    getWorkspaceCloudDriveStatus(workspaceId).catch(() => ({ connections: [], count: 0, providers: [] })),
    getCodespaceProvidersManifest().catch(() => ({ providers: {}, providerCount: 0 })),
  ]);
  return { chain, context, files, localDirs, cloudDrives, codespace };
}

export function listWorkspaceCheckpointTrees(workspaceId: string) {
  return getJson<WorkspaceCheckpointTreeListResponse>(
    `/api/workspace/checkpoints/trees?ownerId=${encoded(workspaceId)}&kind=workspace_files&limit=20`,
  );
}

export function getWorkspaceCheckpointTree(treeId: string) {
  return getJson<WsCheckpointTreeDetail>(`/api/workspace/checkpoints/nodes/${encoded(treeId)}`);
}

export function previewWorkspaceCheckpointRestoreRequest(payload: WorkspaceConsolePayload) {
  return postJson<WorkspaceConsolePayload>("/api/workspace/checkpoints/restore/preview", payload);
}

export function restoreWorkspaceCheckpointRequest(payload: WorkspaceConsolePayload) {
  return postJson<WorkspaceConsolePayload>("/api/workspace/checkpoints/restore", payload);
}

export async function getWorkspaceSessionBundle(sessionId: string): Promise<WorkspaceSessionBundle> {
  const [sessionData, context] = await Promise.all([
    getJson<WsSessionDetail>(`/api/agent-sessions/${encoded(sessionId)}?includeEvents=true&eventLimit=200`),
    getJson<WsSessionContext>(`/api/agent-sessions/${encoded(sessionId)}/context`),
  ]);
  return { sessionData, context };
}

export function forkWorkspaceSession(sessionId: string) {
  return postJson<WorkspaceConsolePayload>(`/api/agent-sessions/${encoded(sessionId)}/fork`, {});
}

export function createWorkspace(payload: WorkspaceConsolePayload) {
  return postJson<WorkspaceConsolePayload>("/api/agent-workspaces", payload);
}

export function deleteWorkspace(workspaceId: string, deleteFolder: boolean) {
  const suffix = deleteFolder ? "?deleteFolder=true" : "";
  return deleteJson<WorkspaceConsolePayload>(`/api/agent-workspaces/${encoded(workspaceId)}${suffix}`);
}

export function setWorkspaceParent(workspaceId: string, parentWorkspaceId: string | null) {
  return postJson<WorkspaceConsolePayload>(
    `/api/agent-workspaces/${encoded(workspaceId)}/parent`,
    { parentWorkspaceId },
  );
}

export function updateWorkspaceProfile(workspaceId: string, payload: WorkspaceProfilePatch) {
  return postJson<WorkspaceConsolePayload>(`/api/agent-workspaces/${encoded(workspaceId)}/profile`, payload);
}

export function setWorkspaceSources(workspaceId: string, sourceIds: string[]) {
  return postJson<WorkspaceConsolePayload>(
    `/api/agent-workspaces/${encoded(workspaceId)}/sources`,
    { sourceIds },
  );
}

export function updateWorkspaceShare(workspaceId: string, action: "share" | "unshare", targetWorkspaceId: string) {
  return postJson<WorkspaceConsolePayload>(
    `/api/agent-workspaces/${encoded(workspaceId)}/${action}`,
    { targetWorkspaceId },
  );
}

export function connectWorkspaceLocalDirectory(workspaceId: string, payload: WorkspaceConsolePayload) {
  return postJson<WorkspaceConsolePayload>(
    `/api/agent-workspaces/${encoded(workspaceId)}/local-dir/connect`,
    payload,
  );
}

export function syncWorkspaceLocalDirectory(workspaceId: string, payload: WorkspaceConsolePayload) {
  return postJson<WorkspaceConsolePayload>(
    `/api/agent-workspaces/${encoded(workspaceId)}/local-dir/sync/apply`,
    payload,
  );
}

export function getWorkspaceCloudDriveStatus(workspaceId: string) {
  return getJson<WorkspaceConsolePayload>(
    `/api/external/cloud-drive/status?workspaceId=${encoded(workspaceId)}`,
  );
}

export function connectWorkspaceCloudDrive(payload: WorkspaceConsolePayload) {
  return postJson<WorkspaceConsolePayload>("/api/external/cloud-drive/connect", payload);
}

export function listWorkspaceCloudDriveItems(params: WorkspaceCloudDriveQuery) {
  return getJson<WorkspaceConsolePayload>(`/api/external/cloud-drive/items?${buildQuery(params)}`);
}

export function downloadWorkspaceCloudDriveFile(params: WorkspaceCloudDriveQuery) {
  return getJson<WorkspaceConsolePayload>(`/api/external/cloud-drive/files/download?${buildQuery(params)}`);
}

export function uploadWorkspaceCloudDriveFile(payload: WorkspaceConsolePayload) {
  return postJson<WorkspaceConsolePayload>("/api/external/cloud-drive/files/upload", payload);
}

export function planWorkspaceCloudDriveSync(payload: WorkspaceConsolePayload) {
  return postJson<WorkspaceConsolePayload>("/api/external/cloud-drive/sync/plan", payload);
}

export function applyWorkspaceCloudDriveSync(payload: WorkspaceConsolePayload) {
  return postJson<WorkspaceConsolePayload>("/api/external/cloud-drive/sync/apply", payload);
}

export function listWorkspaceCloudDrivePermissions(params: WorkspaceCloudDriveQuery) {
  return getJson<WorkspaceConsolePayload>(`/api/external/cloud-drive/permissions?${buildQuery(params)}`);
}

export function getCodespaceProvidersManifest() {
  return getJson<WorkspaceConsolePayload>("/api/codespace/providers/manifest");
}

export function inspectCodespaceRepositoryStatus(payload: WorkspaceConsolePayload) {
  return postJson<WorkspaceConsolePayload>("/api/codespace/repository/status", payload);
}

export function prepareCodespaceChangeRequest(payload: WorkspaceConsolePayload) {
  return postJson<WorkspaceConsolePayload>("/api/codespace/change/prepare", payload);
}

export function uploadCodespaceChangeRequest(payload: WorkspaceConsolePayload) {
  return postJson<WorkspaceConsolePayload>("/api/codespace/change/upload", payload);
}
