import type {
  PactiumCore,
  PactiumProofBundle,
  PactiumProofBundleExportOptions,
  PactiumProofEnvelope,
  PactiumRecord,
  PactiumVerificationResult
} from "../../index.js";

export interface LicoLiteSigner {
  protocol: string;
  signerId: string;
  algorithm: string;
  sign(message: string): Promise<string>;
  verify(message: string, signature: string): Promise<boolean>;
}

export interface LicoLiteAspect {
  protocol: string;
  core: PactiumCore;
  evidencePolicy: string;
  workspaceProjectionDefault: true;
  criticalExtensions: readonly string[];
  supportedCriticalExtensions: readonly string[];
  signer: LicoLiteSigner | null;
  recordWorkspaceOperation(input?: PactiumRecord): Promise<PactiumProofEnvelope>;
  recordOperation(input?: PactiumRecord): Promise<PactiumProofEnvelope>;
  verifyLicoLiteEnvelope(envelope: PactiumProofEnvelope, options?: PactiumRecord): Promise<PactiumVerificationResult>;
  verifyEnvelope(envelope: PactiumProofEnvelope, options?: PactiumRecord): Promise<PactiumVerificationResult>;
  verifyLicoLiteBundle(bundle: PactiumProofBundle, options?: PactiumRecord): Promise<PactiumVerificationResult>;
  verifyBundle(bundle: PactiumProofBundle, options?: PactiumRecord): Promise<PactiumVerificationResult>;
  planRepair(failures?: PactiumRecord[]): PactiumRecord;
  getWorkspaceProjection(workspaceId?: string): Promise<PactiumRecord>;
  proveWorkspaceMembership(input?: PactiumRecord): Promise<PactiumRecord>;
  exportProofBundle(envelopeOrId: PactiumProofEnvelope | string, options?: PactiumProofBundleExportOptions): Promise<PactiumProofBundle>;
}

export const LICOLITE_ASPECT_PROTOCOL: string;
export const LICOLITE_POLICY_EXTENSION: "licolite.policy";
export const LICOLITE_WORKSPACE_EFFECT_EXTENSION: "licolite.workspaceEffect";
export const LICOLITE_SIGNATURE_EXTENSION: "licolite.signature";
export const LICOLITE_CRITICAL_EXTENSIONS: readonly string[];
export const LICOLITE_SUPPORTED_CRITICAL_EXTENSIONS: readonly string[];

export function createLicoLiteSigner(options?: PactiumRecord): LicoLiteSigner;
export function createLicoLiteAspect(options?: PactiumRecord & { pactium?: PactiumCore | null; signer?: LicoLiteSigner | false | null }): LicoLiteAspect;
export function recordLicoLiteWorkspaceOperation(input?: PactiumRecord, options?: PactiumRecord): Promise<PactiumProofEnvelope>;
export function verifyLicoLiteEnvelope(envelope: PactiumProofEnvelope, options?: PactiumRecord): Promise<PactiumVerificationResult>;
export function verifyLicoLiteBundle(bundle: PactiumProofBundle, options?: PactiumRecord): Promise<PactiumVerificationResult>;
export function licoLitePolicyExtensionValue(input?: PactiumRecord): PactiumRecord;
export function licoLiteWorkspaceEffectExtensionValue(input?: PactiumRecord): PactiumRecord;
