import type { SplitJob, SplitJobStatus } from "../split";

export type KnowledgeSource = {
  sourceId: string;
  label: string;
  directoryPath: string;
  enabled: boolean;
  autoSync: boolean;
  recursive: boolean;
  debounceMs: number;
  hydrationEnabled?: boolean;
  hydrationPolicy?: string;
  hydrationTimeoutMs?: number;
  hydrationCommand?: string;
  hydrationArgs?: string[];
  status: "idle" | "pending" | "syncing" | "queued" | "error" | string;
  watcherStatus: "watching" | "partial" | "stopped" | "error" | string;
  watcherCount: number;
  lastEventAt?: string;
  lastScanAt?: string;
  lastSyncedAt?: string;
  lastSnapshotHash?: string;
  lastHydratedSnapshotHash?: string;
  lastHydrationAt?: string;
  lastHydrationStatus?: string;
  lastHydratedFileCount?: number;
  lastHydrationFailedCount?: number;
  lastHydrationSkippedCount?: number;
  lastHydrationFailureSamples?: Array<{
    relativePath?: string;
    reason?: string;
  }>;
  indexStatus?: "idle" | "indexing" | "indexed" | "failed" | string;
  lastIndexAt?: string;
  lastIndexReason?: string;
  lastIndexSnapshotHash?: string;
  lastIndexedFileCount?: number;
  lastIndexSkippedCount?: number;
  lastIndexFailedCount?: number;
  lastIndexError?: string;
  lastIndexCheckpointTreeId?: string;
  lastFileCount: number;
  lastTotalBytes: number;
  lastJobId?: string;
  lastJobStatus?: SplitJobStatus | string;
  lastJobStage?: string;
  lastJobProgressPercent?: number;
  lastJobUpdatedAt?: string;
  lastSyncCheckpointTreeId?: string;
  pendingReason?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
};

export type KnowledgeSourceState = {
  schemaVersion: string;
  updatedAt: string;
  summary: {
    totalCount: number;
    enabledCount: number;
    watchingCount: number;
    syncingCount: number;
    indexingCount?: number;
    errorCount: number;
  };
  sources: KnowledgeSource[];
};

export type KnowledgeSourceMutationResponse = {
  skipped?: boolean;
  reason?: string;
  duplicateOf?: string;
  source?: KnowledgeSource;
  deletedSource?: KnowledgeSource;
  job?: SplitJob;
  results?: Array<Record<string, unknown>>;
  state: KnowledgeSourceState;
};
