import type { PactiumCore, PactiumDataDirOptions } from "./index.js";

export interface PactiumHttpServerOptions extends PactiumDataDirOptions {
  pactium?: PactiumCore | null;
  licolite?: unknown;
  maxBodyBytes?: number;
}

export interface PactiumHttpServerStartOptions extends PactiumDataDirOptions {
  host?: string;
  port?: number | string;
  maxBodyBytes?: number;
}

export interface PactiumHttpServerStartResult {
  protocol: "pactium.v0.2.http";
  server: unknown;
  host: string;
  port: number;
  maxBodyBytes: number;
  url: string;
}

export const PACTIUM_HTTP_PROTOCOL: "pactium.v0.2.http";
export const PACTIUM_HTTP_MAX_BODY_BYTES: 1048576;
export function createPactiumHttpServer(options?: PactiumHttpServerOptions): unknown;
export function startPactiumHttpServer(options?: PactiumHttpServerStartOptions): Promise<PactiumHttpServerStartResult>;
