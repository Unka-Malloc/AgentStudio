export interface WsWorkspace {
  workspaceId: string;
  title: string;
  objective: string;
  status: string;
  parentWorkspaceId: string | null;
  profile: {
    contextProfileId?: string;
    toolGrantId?: string;
    modelAlias?: string;
    knowledgeScope?: { includeSourceIds: string[]; excludeSourceIds: string[] };
  };
  ownedSourceIds: string[];
  accessibleWorkspaceIds: string[];
  currentGeneration: number;
  createdAt: string;
  updatedAt: string;
  summary?: {
    runCount: number;
    artifactCount: number;
    openIssueCount: number;
    sessionCount?: number;
  };
  fsPath: string;
}

export interface WsChainItem {
  workspaceId: string;
  title: string;
}

export interface WsContext {
  workspaceId: string;
  currentGeneration: number;
  inheritanceChain: WsChainItem[];
  knowledgeSourceIds: string[];
  contextProfileId: string;
  toolGrantId: string;
  modelAlias: string;
}

export interface WsSessionEvent {
  eventId: string;
  sequence: number;
  type: string;
  title: string;
  summary: string;
  createdAt: string;
}

export interface WsSession {
  sessionId: string;
  workspaceId: string;
  title: string;
  objective: string;
  status: string;
  parentSessionId: string;
  forkedFromEventId: string;
  branchIndex: number;
  eventCount: number;
  lastEventId: string;
  appendOnly: boolean;
  createdAt: string;
  updatedAt: string;
  workspace?: { workspaceId: string; title: string; currentGeneration: number };
  lastEvent?: WsSessionEvent | null;
}

export interface WsSessionDetail {
  session: WsSession;
  events: WsSessionEvent[];
}

export interface WsSessionContext extends WsContext {
  agentSessionId: string;
  sessionTitle: string;
  parentSessionId: string;
  forkedFromEventId: string;
  sessionEventCount: number;
  sessionAppendOnly: boolean;
}

export interface CloudDriveExposureForm {
  id: string;
  name: string;
  path: string;
  permissionMode: "all" | "allowlist" | "denylist";
  subjects: string;
  showPermissions: boolean;
}

export interface WsCheckpointTreeSummary {
  treeId: string;
  kind: string;
  ownerId: string;
  status: string;
  nodeCount: number;
  byStatus: Record<string, number>;
  updatedAt: string;
  completedAt?: string;
}

export interface WorkspaceFileSnapshot {
  files?: unknown[];
  basePath?: string;
  [key: string]: unknown;
}

export interface WsCheckpointNode {
  nodeId: string;
  parentId: string;
  label: string;
  status: string;
  metadata?: Record<string, unknown> & {
    workspaceFileSnapshot?: WorkspaceFileSnapshot;
  };
  createdAt?: string;
  updatedAt?: string;
  completedAt?: string;
}

export interface WsCheckpointTreeDetail extends WsCheckpointTreeSummary {
  rootNodeId?: string;
  nodes?: Record<string, WsCheckpointNode>;
  metadata?: Record<string, unknown>;
  events?: unknown[];
}
