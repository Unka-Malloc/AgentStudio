import type { ConsoleAuthSummary } from "../auth-types";

export type AnalysisModuleInfo = {
  id: string;
  label: string;
  description: string;
  executionMode: string;
};

export type ClientMigrationState =
  | "aligned"
  | "outdated"
  | "draining"
  | "bootstrap-only"
  | "offline"
  | "unknown";

export type DiscoveryClientSummary = {
  totalCount: number;
  alignedCount: number;
  outdatedCount: number;
  drainingCount: number;
  bootstrapOnlyCount: number;
  offlineCount: number;
  unknownCount: number;
  pactClientCount?: number;
  mcpPluginCount?: number;
  migratableCount?: number;
};

export type ClientConnectionKind = "pact-client" | "mcp-plugin" | string;

export type DiscoveryClientRegistration = {
  clientId: string;
  clientLabel: string;
  appVersion: string;
  platform: string;
  hostname: string;
  bootstrapUrl: string;
  currentServiceUrl: string;
  desiredServiceUrl: string;
  currentJobServiceUrl: string;
  configVersion: string;
  migrationState: ClientMigrationState;
  connectionKind?: ClientConnectionKind;
  connectionMethod?: string;
  connectionState?: string;
  connectionStatusLabel?: string;
  connectionDetail?: string;
  supportsMigration?: boolean;
  sourceGrantId?: string;
  busy: boolean;
  lastJobId: string;
  lastError: string;
  firstSeenAt: string;
  lastSeenAt: string;
  lastSeenServerId: string;
};

export type DiscoveryClientsResponse = {
  summary: DiscoveryClientSummary;
  items: DiscoveryClientRegistration[];
};

export type DiscoveryConfig = {
  serverId: string;
  serverLabel: string;
  bootstrapBaseUrl: string;
  advertisedBaseUrl: string;
  activeServiceUrl: string;
  forwardBaseUrl: string;
  mode: "active" | "forward";
  configVersion: string;
  refreshIntervalSeconds: number;
  checkInIntervalSeconds: number;
  offlineAfterSeconds: number;
};

export type DiscoveryConfigResponse = {
  path: string;
  value: DiscoveryConfig;
  bootstrap: {
    ok: boolean;
    serverId: string;
    serverLabel: string;
    bootstrapBaseUrl: string;
    advertisedBaseUrl: string;
    activeServiceUrl: string;
    forwardBaseUrl: string;
    mode: "active" | "forward";
    configVersion: string;
    refreshIntervalSeconds: number;
    checkInIntervalSeconds: number;
    offlineAfterSeconds: number;
    migrationRequired: boolean;
  };
};

export type RuntimeMountInfo = {
  name: string;
  id: string;
  kind: string;
  enabled: boolean;
  reason: string;
  supportsStructuredDocument: boolean;
  supportsTextExtraction: boolean;
  supportsBatchHook: boolean;
};

export type MountRouteTarget = {
  mountName: string;
  action: string;
};

export type MountRoutingConfig = {
  kindRoutes: Record<string, MountRouteTarget>;
  extensionRoutes: Record<string, MountRouteTarget>;
  mediaTypeRoutes: Record<string, MountRouteTarget>;
};

export type RuntimeMountConfig = {
  mountModules: Record<string, string>;
  mountRouting: MountRoutingConfig;
};

export type RuntimeInfoResponse = {
  server: {
    url: string;
    userDataPath: string;
    distPath: string;
    hostname: string;
  };
  runtime: {
    profile: string;
    cwd: string;
    mountModules: Record<string, string>;
    mountRouting: MountRoutingConfig;
    mountGeneration: number;
    mountConfigPath?: string;
    mountConfigPaths?: {
      modulesPath: string;
      routingPath: string;
    };
    mountConfig?: RuntimeMountConfig;
    mounts: RuntimeMountInfo[];
    analysisModules: AnalysisModuleInfo[];
    currentAnalysisModuleId?: string;
  };
  storage: {
    databasePath: string;
    objectRootPath: string;
    batchCount: number;
    rawObjectCount: number;
    sourceCount: number;
    emailCount: number;
    threadCount: number;
    transactionCount: number;
    lineageCount: number;
    lineageRunCount: number;
    clientCount: number;
    peopleCount: number;
    retrievalCount: number;
  };
  discovery: DiscoveryConfigResponse["bootstrap"];
  auth?: ConsoleAuthSummary | null;
  features?: FeatureRuntimeSummary | null;
};

export type FeatureRuntimeSummary = {
  schemaVersion: string;
  edition: string;
  profileName?: string;
  generatedAt?: string;
  activeFeatureIds: string[];
  disabledFeatureIds: string[];
  activeFeatures?: Array<{
    featureId: string;
    label: string;
    group: string;
    required?: boolean;
    reason?: string;
  }>;
  disabledFeatures?: Array<{
    featureId: string;
    label: string;
    group: string;
    required?: boolean;
    reason?: string;
  }>;
  operations?: {
    total: number;
    active: number;
    disabled: number;
  };
};

export type RuntimeMountsResponse = {
  path: string;
  paths: {
    modulesPath: string;
    routingPath: string;
  };
  value: RuntimeMountConfig;
  runtime: Pick<
    RuntimeInfoResponse["runtime"],
    "mountGeneration" | "mountModules" | "mountRouting"
  > & {
    mounts?: RuntimeMountInfo[];
  };
  analysisModules?: AnalysisModuleInfo[];
  currentAnalysisModuleId?: string;
};

export type ServerPathBrowseEntry = {
  name: string;
  path: string;
  type: "directory" | "file" | "other" | string;
  byteSize: number;
  modifiedAt: string;
  hidden: boolean;
  selectable: boolean;
  browsable: boolean;
};

export type ServerPathBrowseResponse = {
  currentPath: string;
  parentPath: string;
  mode: "directory" | "file" | string;
  extensions: string[];
  roots: Array<{ label: string; path: string }>;
  entries: ServerPathBrowseEntry[];
  truncated: boolean;
  error?: string;
};

export type RuntimeMountReloadResponse = {
  ok: boolean;
  mountGeneration: number;
  mountModules: Record<string, string>;
  mountRouting: MountRoutingConfig;
};
