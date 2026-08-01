import type { PactiumCore, PactiumDataDirOptions } from "./index.js";

export interface PactiumHttpServerOptions extends PactiumDataDirOptions {
  pactium?: PactiumCore | null;
  maxBodyBytes?: number;
  enableMutations?: boolean;
  authorize?: ((ctx: { method: string; pathname: string; capability: string; headers: Record<string, string | string[] | undefined> }) => boolean | { allowed: boolean; reason?: string; statusCode?: number } | Promise<boolean | { allowed: boolean; reason?: string; statusCode?: number }>) | null;
}

export interface PactiumHttpServerStartOptions extends PactiumDataDirOptions {
  host?: string;
  port?: number | string;
  maxBodyBytes?: number;
  enableMutations?: boolean;
  authorize?: PactiumHttpServerOptions["authorize"];
}

export interface PactiumHttpServerStartResult {
  protocol: "pactium.v0.3.http";
  server: unknown;
  host: string;
  port: number;
  maxBodyBytes: number;
  url: string;
}

export const PACTIUM_HTTP_PROTOCOL: "pactium.v0.3.http";
export const PACTIUM_HTTP_MAX_BODY_BYTES: 1048576;
export function createPactiumHttpServer(options?: PactiumHttpServerOptions): unknown;
export function startPactiumHttpServer(options?: PactiumHttpServerStartOptions): Promise<PactiumHttpServerStartResult>;
