export type PactiumCanonicalValue =
  | null
  | boolean
  | number
  | string
  | PactiumCanonicalValue[]
  | { [key: string]: PactiumCanonicalValue };

export type PactiumRecord = Record<string, unknown>;

export interface PactiumDataDirOptions {
  dataDir?: string;
  userDataPath?: string;
  inMemory?: boolean;
}

export interface PactiumStoragePort {
  protocol: string;
  schema: string;
  dataDir: string;
  inMemory: boolean;
  initialize(): Promise<void>;
  putBlock(value: unknown, options?: PactiumRecord): Promise<PactiumRecord>;
  getBlock(cid: string): Promise<(PactiumRecord & { bytes?: Uint8Array }) | null>;
  hasBlock(cid: string): Promise<boolean>;
  walk(rootCid: string): Promise<PactiumRecord>;
  putProtocolObject(scope: string, key: string, value: unknown): Promise<PactiumCanonicalValue>;
  getProtocolObject(scope: string, key: string, fallback?: unknown): Promise<unknown>;
  clearCache?(): void;
  withWriteLock?<T>(
    task: () => T | Promise<T>,
    options?: { name?: string; timeoutMs?: number; retryMs?: number; staleMs?: number }
  ): Promise<T>;
  pruneBlocks?(predicate?: (record: PactiumRecord) => boolean): number;
  pruneProtocolObjects?(predicate?: (record: PactiumRecord & { scope: string; key: string; value: unknown }) => boolean): number;
}

export interface PactiumLedgerHead {
  protocol: string;
  schema: string;
  size: number;
  rootHash: string;
  root: string;
  headId?: string;
  previousHeadId?: string;
  createdAt?: string;
  signatureRef?: string;
  signatureHash?: string;
  verifierManifest?: PactiumRecord;
  verifierManifestRef?: string;
  signatures?: PactiumRecord[];
}

export interface PactiumProofEnvelope {
  protocol: string;
  schema: string;
  envelopeType: "pactium.proof-envelope";
  envelopeKind: string;
  envelopeId: string;
  factType: string;
  factId: string;
  factRef: PactiumRecord;
  ledgerHead: PactiumLedgerHead;
  proofRefs: PactiumRecord[];
  extensions: PactiumRecord[];
  criticalExtensions: string[];
  relatedEnvelopeIds: string[];
  replayed: boolean;
  createdAt: string;
}

export interface PactiumVerificationFailure {
  protocol: string;
  layer: string;
  code: string;
  severity: string;
  message?: string;
  evidenceRef?: string;
  repairable?: boolean;
  details?: PactiumRecord;
}

export interface PactiumVerificationResult {
  protocol: string;
  ok: boolean;
  envelopeId?: string;
  failures: PactiumVerificationFailure[];
  checked?: string[];
}

export interface PactiumProofBundle {
  protocol: string;
  schema: string;
  bundleType: "pactium.proof-bundle.indexed";
  manifest: PactiumRecord;
  envelope: PactiumProofEnvelope;
  index?: PactiumRecord[];
  blocksEncoding?: string;
  binaryBase64?: string;
  byteLength?: number;
  bundleHash: string;
}

export interface PactiumIndexScanOptions extends PactiumRecord {
  min?: string;
  max?: string;
  limit?: number;
  after?: string;
}

export interface PactiumIndexEngine {
  protocol: string;
  engine: string;
  domain: string;
  createIndex(entries?: PactiumRecord[], options?: PactiumRecord): Promise<PactiumRecord>;
  put(root: string, key: string, value: unknown, options?: PactiumRecord): Promise<PactiumRecord>;
  delete(root: string, key: string, options?: PactiumRecord): Promise<PactiumRecord>;
  get(root: string, key: string): Promise<PactiumRecord | null>;
  prove(root: string, key: string): Promise<PactiumRecord>;
  verifyProof(proof: PactiumRecord): boolean;
  scan(root: string, options?: PactiumIndexScanOptions): Promise<PactiumRecord[]>;
  prefix(root: string, keyPrefix?: string, options?: PactiumIndexScanOptions): Promise<PactiumRecord[]>;
  diff(leftRoot: string, rightRoot: string): Promise<PactiumRecord[]>;
  readSnapshot(root: string): Promise<PactiumRecord>;
  readIndexRoot(root: string): Promise<PactiumRecord>;
  readNode(root: string): Promise<PactiumRecord>;
}

export interface PactiumLedgerPageOptions extends PactiumRecord {
  start?: number;
  limit?: number;
}

export interface PactiumLedgerPage extends PactiumRecord {
  protocol: string;
  start: number;
  limit: number;
  entries: PactiumRecord[];
  nextPosition: number;
  head: PactiumLedgerHead;
}

export interface PactiumLedger extends PactiumRecord {
  append(entry?: PactiumRecord): Promise<PactiumRecord>;
  head(): Promise<PactiumLedgerHead>;
  entries(): Promise<PactiumRecord[]>;
  pageEntries(options?: PactiumLedgerPageOptions): Promise<PactiumLedgerPage>;
}

export interface PactiumProofBundleVerificationOptions extends PactiumRecord {
  verifyAllBlocks?: boolean;
}

export interface PactiumProofBundleExportOptions extends PactiumRecord {
  format?: "indexed";
}

export interface PactiumCore {
  protocol: string;
  schema: string;
  dataDir: string;
  storage: PactiumStoragePort;
  ledger: PactiumLedger;
  indexEngine: PactiumIndexEngine;
  beginOperationIntent(input?: PactiumRecord): Promise<PactiumProofEnvelope>;
  appendOperationOutcome(input?: PactiumRecord): Promise<PactiumProofEnvelope>;
  recordOperation(input?: PactiumRecord): Promise<PactiumProofEnvelope>;
  lookupOpenIntent(intentId: string): Promise<PactiumRecord>;
  lookupOutcome(intentId: string): Promise<PactiumRecord>;
  createAppendCondition(input?: PactiumRecord): PactiumRecord;
  getLedgerCursor(input?: PactiumRecord): Promise<PactiumRecord>;
  getWorkspaceCursor(input?: PactiumRecord): Promise<PactiumRecord>;
  verifyCursor(cursor: PactiumRecord, context?: PactiumRecord): boolean;
  advanceTrustedHead(input?: PactiumRecord): PactiumRecord;
  planRecovery(input?: PactiumRecord): PactiumRecord;
  getWorkspaceProjection(workspaceId?: string): Promise<PactiumRecord>;
  proveWorkspaceMembership(input?: PactiumRecord): Promise<PactiumRecord>;
  verifyEnvelope(envelope: PactiumProofEnvelope, options?: PactiumRecord): Promise<PactiumVerificationResult>;
  exportProofBundle(envelopeOrId: PactiumProofEnvelope | string, options?: PactiumProofBundleExportOptions): Promise<PactiumProofBundle>;
  createExtension(extension: PactiumRecord): Promise<PactiumRecord>;
  storeEnvelope(envelope: PactiumProofEnvelope): Promise<PactiumProofEnvelope>;
  protocolCatalog(): Promise<PactiumRecord>;
  doctor(): Promise<PactiumRecord & { ok: boolean; dataDir: string }>;
}

export const PACTIUM_PROTOCOL: "pactium.v0.2";
export const PACTIUM_SCHEMA_VERSION: "pactium.v0.2.schema.latest";
export const PACTIUM_PACKAGE_VERSION: "0.2.0";
export const PACTIUM_INDEX_ENGINE: "pactium.verifiable-index-engine";
export const PACTIUM_INDEX_SPLITTER: "pactium-cdc-boundary";
export const PACTIUM_PROOF_BUNDLE_TYPE: "pactium.proof-bundle.indexed";
export const PACTIUM_BUNDLE_ENCODING: "pactium.bundle.indexed-record-stream";
export const PACTIUM_PROOF_TYPES: Readonly<{
  ledgerInclusion: "ledger.inclusion.audit-path";
  ledgerConsistency: "ledger.consistency.audit-path";
  indexMembership: "index.membership.prolly-path";
  indexNonMembership: "index.non-membership.prolly-path";
}>;
export const PACTIUM_PROTOCOL_PROFILE: PactiumRecord;
export const HASH_DOMAINS: Record<string, string>;

export function defaultPactiumDataDir(): string;
export function resolveDataDir(dataDir?: string): string;
export function resolveWithin(root: string, ...segments: string[]): string;
export function normalizeCanonicalValue(value: unknown): PactiumCanonicalValue;
export function canonicalString(value: unknown): string;
export function canonicalEncode(value: unknown): Uint8Array;
export function canonicalDecode(bytes: Uint8Array | ArrayBuffer | string): PactiumCanonicalValue;
export function protocolHashHex(domain: string, value: unknown): string;
export function protocolHash(domain: string, value: unknown): string;
export function cidForBytes(bytes: Uint8Array | ArrayBuffer | string): string;
export function cidForCanonical(value: unknown): string;
export function createVerificationFailure(input?: PactiumRecord): PactiumVerificationFailure;
export function createStoragePort(options?: PactiumDataDirOptions): PactiumStoragePort;
export function ledgerLeafHash(leaf: unknown): string;
export function ledgerNodeHash(leftHash: string, rightHash: string): string;
export function emptyTreeHash(): string;
export function createCompactRange(input?: PactiumRecord): PactiumRecord;
export function createLedgerInclusionProof(input?: PactiumRecord): PactiumRecord;
export function verifyLedgerInclusionProof(input?: PactiumRecord): boolean;
export function createLedgerConsistencyProof(input?: PactiumRecord): PactiumRecord;
export function verifyLedgerConsistencyProof(input?: PactiumRecord): boolean;
export function createLedgerTransparencyLog(options?: PactiumRecord): PactiumLedger;
export function createVerifierManifest(input?: PactiumRecord): PactiumRecord;
export function ledgerHeadSigningPayload(head?: PactiumRecord): PactiumRecord;
export function signLedgerHead(head?: PactiumRecord, options?: PactiumRecord): PactiumRecord;
export function verifyLedgerHeadSignature(head?: PactiumRecord, manifest?: PactiumRecord, options?: PactiumRecord): PactiumVerificationResult & { accepted?: number };
export function advanceTrustedHead(input?: PactiumRecord): PactiumRecord;
export function createVerifiableIndexEngine(options?: PactiumRecord): PactiumIndexEngine;
export function verifyIndexProof(proof: PactiumRecord): boolean;
export function createAppendCondition(input?: PactiumRecord): PactiumRecord;
export function createTrackingCursor(input?: PactiumRecord): PactiumRecord;
export function covers(cursor: PactiumRecord, position: number): boolean;
export function advanceTo(cursor: PactiumRecord, position: number, options?: PactiumRecord): PactiumRecord;
export function samePositionAs(left: PactiumRecord, right: PactiumRecord): boolean;
export function verifyTrackingCursor(cursor: PactiumRecord, context?: PactiumRecord): boolean;
export function createPactium(options?: PactiumDataDirOptions & { storage?: PactiumStoragePort | null }): PactiumCore;
export function verifyProofEnvelope(envelope: PactiumProofEnvelope, options?: PactiumRecord): Promise<PactiumVerificationResult>;
export function verifyProofBundle(bundle: PactiumProofBundle, options?: PactiumProofBundleVerificationOptions): Promise<PactiumVerificationResult & { bundleHash?: string }>;
export function createDefaultProofVerifierRegistry(extraVerifiers?: PactiumRecord): Map<string, (...args: unknown[]) => unknown>;
export function createRepairPlanner(): PactiumRecord;
export function createMaintenanceTaskEngine(options?: PactiumRecord): PactiumRecord;
export function envelopeSigningHash(envelope: PactiumProofEnvelope): string;
export function runPactiumQualityGateProfile(options?: PactiumRecord): Promise<PactiumRecord>;
