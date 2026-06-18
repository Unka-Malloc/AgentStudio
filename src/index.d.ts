export type PactiumJson =
  | null
  | boolean
  | number
  | string
  | PactiumJson[]
  | { [key: string]: PactiumJson };

export type PactiumRecord = Record<string, unknown>;

export interface PactiumDataDirOptions {
  dataDir?: string;
  userDataPath?: string;
}

export interface LedgerEntry extends PactiumRecord {
  protocolVersion: string;
  ledgerEventId: string;
  ledgerId: string;
  operationId: string;
  workspaceId: string;
  subject: PactiumRecord;
  risk: string;
  status: string;
  receiptRefs: string[];
  startedAt: string;
  updatedAt: string;
  replayed?: boolean;
}

export interface LedgerListResult {
  protocolVersion: string;
  items: LedgerEntry[];
  count: number;
}

export interface OperationLedger {
  protocolVersion: string;
  filePath: string;
  startEntry(input?: PactiumRecord): LedgerEntry;
  completeEntry(ledgerEventId: string, patch?: PactiumRecord): LedgerEntry | null;
  failEntry(ledgerEventId: string, patch?: PactiumRecord): LedgerEntry | null;
  getEntry(ledgerEventId: string): LedgerEntry | null;
  listEntries(input?: PactiumRecord): LedgerListResult;
}

export interface CheckpointTreeStore {
  protocolVersion: string;
  schemaVersion: string;
  dataDir: string;
  id(kind?: string, ...parts: unknown[]): string;
  path(treeId: string): string;
  list(input?: PactiumRecord): Promise<PactiumRecord[]>;
  load(input?: PactiumRecord): Promise<PactiumRecord | null>;
  startTree(input?: PactiumRecord): Promise<PactiumRecord>;
  upsertNode(input?: PactiumRecord): Promise<PactiumRecord>;
  finishTree(input?: PactiumRecord): Promise<PactiumRecord>;
  diffTree(input?: PactiumRecord): Promise<PactiumRecord>;
  queryScope(input?: PactiumRecord): Promise<PactiumRecord>;
  previewRestore(input?: PactiumRecord): Promise<PactiumRecord>;
  restore(input?: PactiumRecord): Promise<PactiumRecord>;
  deleteTree(input?: PactiumRecord): Promise<PactiumRecord>;
  summary(tree: PactiumRecord): PactiumRecord;
}

export interface MerkleStateSubstrate {
  protocolVersion: string;
  dataDir: string;
  canonicalCodec: PactiumRecord;
  cas: PactiumRecord;
  merkleDag: PactiumRecord;
  merkleIndex: PactiumRecord;
  eventLog: PactiumRecord;
  stateCommit: {
    commit(input?: PactiumRecord): Promise<PactiumRecord & { commitId: string }>;
    verifyCommit(commitId: string): Promise<PactiumRecord & { ok: boolean }>;
    [key: string]: unknown;
  };
  lsmIngest: PactiumRecord;
  listCapabilities(): { protocolVersion: string; capabilities: string[] };
}

export interface ProtocolCatalog {
  protocolVersion: string;
  name: "Pactium";
  packageName: "pactium";
  capabilities: Array<{
    id: string;
    version: string;
    operations: string[];
  }>;
}

export interface RecordOperationInput extends PactiumRecord {
  operationId: string;
  workspaceId?: string;
  scope?: string;
  subject?: PactiumRecord;
  risk?: string;
  status?: string;
  receiptRefs?: string[];
  checkpoint?: PactiumRecord;
  state?: {
    scope?: string;
    mutations?: PactiumRecord[];
    contentRefs?: string[];
    afterRoot?: string;
    payload?: PactiumRecord;
    [key: string]: unknown;
  };
}

export interface RecordOperationResult extends PactiumRecord {
  protocolVersion: string;
  ledgerEventId: string;
  checkpointTreeId: string;
  checkpointNodeId: string;
  stateCommitId: string;
  ledgerEntry: LedgerEntry;
  checkpointNode: PactiumRecord;
  stateCommit: PactiumRecord | null;
}

export interface PactiumKernel {
  protocolVersion: string;
  dataDir: string;
  ledger: OperationLedger;
  checkpointTree: CheckpointTreeStore;
  merkleState: MerkleStateSubstrate;
  recordOperation(input: RecordOperationInput): Promise<RecordOperationResult>;
  doctor(): Promise<PactiumRecord & { ok: boolean; dataDir: string }>;
  protocolCatalog(): ProtocolCatalog;
}

export interface PactiumHttpServerOptions {
  dataDir?: string;
  kernel?: PactiumKernel | null;
}

export interface PactiumHttpServer {
  listen(...args: unknown[]): unknown;
  close(callback?: (error?: Error) => void): unknown;
  [key: string]: unknown;
}

export interface StartedPactiumHttpServer {
  protocolVersion: string;
  server: PactiumHttpServer;
  host: string;
  port: number;
  url: string;
}

export const PACTIUM_PROTOCOL_VERSION: string;
export const OPERATION_LEDGER_PROTOCOL_VERSION: string;
export const CHECKPOINT_TREE_PROTOCOL_VERSION: string;
export const CHECKPOINT_TREE_SCHEMA_VERSION: string;
export const MERKLE_STATE_SUBSTRATE_PROTOCOL_VERSION: string;
export const PACTIUM_KERNEL_PROTOCOL_VERSION: string;

export function defaultPactiumDataDir(): string;
export function resolveDataDir(dataDir?: string): string;
export function resolveWithin(root: string, ...segments: string[]): string;
export function sha256Hex(value: unknown): string;
export function pactiumToken(kind: string, ...parts: unknown[]): string;
export function assertPactiumToken(value: string, expectedKind?: string): string;

export function createOperationLedger(options?: PactiumDataDirOptions): OperationLedger;
export function checkpointTreeId(kind?: string, ...parts: unknown[]): string;
export function getCheckpointTreePath(userDataPath: string, treeId: string): string;
export function listCheckpointTrees(input?: PactiumRecord): Promise<PactiumRecord[]>;
export function loadCheckpointTree(input?: PactiumRecord): Promise<PactiumRecord | null>;
export function startCheckpointTree(input?: PactiumRecord): Promise<PactiumRecord>;
export function upsertCheckpointNode(input?: PactiumRecord): Promise<PactiumRecord>;
export function finishCheckpointTree(input?: PactiumRecord): Promise<PactiumRecord>;
export function diffCheckpointTree(input?: PactiumRecord): Promise<PactiumRecord>;
export function queryCheckpointScope(input?: PactiumRecord): Promise<PactiumRecord>;
export function previewCheckpointRestore(input?: PactiumRecord): Promise<PactiumRecord>;
export function restoreCheckpointTree(input?: PactiumRecord): Promise<PactiumRecord>;
export function deleteCheckpointTree(input?: PactiumRecord): Promise<PactiumRecord>;
export function checkpointTreeSummary(tree: PactiumRecord): PactiumRecord;
export function createCheckpointTreeStore(options?: PactiumDataDirOptions): CheckpointTreeStore;
export function createMerkleStateSubstrate(options?: PactiumDataDirOptions): MerkleStateSubstrate;
export function createProtocolCatalog(): ProtocolCatalog;
export function createPactiumKernel(options?: PactiumDataDirOptions): PactiumKernel;
export function createPactiumHttpServer(options?: PactiumHttpServerOptions): PactiumHttpServer;
export function startPactiumHttpServer(options?: {
  dataDir?: string;
  host?: string;
  port?: number;
}): Promise<StartedPactiumHttpServer>;
