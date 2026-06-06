import {
  createAcpSourceJsonRpcLineTransport,
  createAcpSourceJsonRpcService
} from "./acp-source-json-rpc-service.mjs";
import { createFileRelaySessionAdapter } from "./relay-session-store.mjs";
import path from "node:path";

function asObject(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
}

function asText(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function parseJsonEnv(value = "", fallback = {}) {
  const text = asText(value);
  if (!text) {
    return fallback;
  }
  try {
    return asObject(JSON.parse(text), fallback);
  } catch (error) {
    const parseError = new Error(`Invalid JSON environment configuration: ${error.message}`);
    parseError.cause = error;
    throw parseError;
  }
}

function parseListEnv(value = "") {
  return asText(value)
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function writeStatus(stream, payload = {}) {
  if (stream && typeof stream.write === "function") {
    stream.write(`${JSON.stringify(payload)}\n`);
  }
}

function createStoreAdapterFromEnv(env = {}) {
  const filePath = asText(env.PACT_ACP_SOURCE_STDIO_STORE_PATH || env.PACT_ACP_RELAY_STORE_PATH);
  const userDataPath = asText(
    env.PACT_ACP_SOURCE_STDIO_USER_DATA_PATH ||
      env.PACT_ACP_RELAY_USER_DATA_PATH ||
      env.PACT_USER_DATA_PATH ||
      env.USER_DATA_PATH
  );
  if (!filePath && !userDataPath) {
    return null;
  }
  return createFileRelaySessionAdapter({ filePath, userDataPath });
}

function sensitivePayloadStorePathFromEnv(env = {}) {
  const explicitPath = asText(
    env.PACT_ACP_SOURCE_STDIO_SENSITIVE_PAYLOAD_STORE_PATH ||
      env.PACT_ACP_RELAY_SENSITIVE_PAYLOAD_STORE_PATH ||
      env.PACT_ACP_SENSITIVE_PAYLOAD_STORE_PATH
  );
  if (explicitPath) {
    return explicitPath;
  }
  const filePath = asText(env.PACT_ACP_SOURCE_STDIO_STORE_PATH || env.PACT_ACP_RELAY_STORE_PATH);
  if (!filePath) {
    return "";
  }
  const parsed = path.parse(filePath);
  return path.join(parsed.dir, `${parsed.name}.sensitive-payloads${parsed.ext || ".json"}`);
}

function runtimeOptionsWithEnvStore(runtimeOptions = {}, env = {}) {
  const baseOptions = asObject(runtimeOptions);
  const nextOptions = { ...baseOptions };
  if (!nextOptions.store && !nextOptions.storeAdapter) {
    const storeAdapter = createStoreAdapterFromEnv(env);
    if (storeAdapter) {
      nextOptions.storeAdapter = storeAdapter;
    }
  }
  if (!nextOptions.sensitivePayloadStore && nextOptions.sensitivePayloadStore !== false) {
    const sensitivePayloadStorePath = sensitivePayloadStorePathFromEnv(env);
    if (sensitivePayloadStorePath) {
      nextOptions.sensitivePayloadStorePath = nextOptions.sensitivePayloadStorePath || sensitivePayloadStorePath;
    }
  }
  return nextOptions;
}

export function createAcpSourceStdioServer({
  runtime = null,
  context = {},
  input = process.stdin,
  output = process.stdout,
  diagnostics = process.stderr,
  logger = null
} = {}) {
  if (!runtime) {
    throw new Error("ACP source stdio server requires a relay runtime.");
  }
  const resolvedRuntime = runtime;
  const transport = createAcpSourceJsonRpcLineTransport({ input, output });
  const service = createAcpSourceJsonRpcService({
    runtime: resolvedRuntime,
    context,
    logger
  });
  return {
    runtime: resolvedRuntime,
    service,
    transport,
    async serve() {
      if (diagnostics) {
        const storagePath = asText(resolvedRuntime.store?.adapter?.storagePath);
        const sensitivePayloadStoragePath = asText(resolvedRuntime.sensitivePayloadStore?.storagePath);
        writeStatus(diagnostics, {
          event: "pact.acp.source_stdio.ready",
          protocol: "pact.acp-agent-relay.v1",
          sourceId: asText(context.sourceId || context.source_id, "source.acp"),
          workspaceId: asText(context.workspaceId || context.workspace_id, "default"),
          durableStore: Boolean(storagePath),
          durableSensitivePayloadStore: Boolean(sensitivePayloadStoragePath),
          ...(storagePath ? { storagePath } : {}),
          ...(sensitivePayloadStoragePath ? { sensitivePayloadStoragePath } : {})
        });
      }
      try {
        await service.serveTransport(transport);
        return { ok: true };
      } finally {
        if (resolvedRuntime && typeof resolvedRuntime.close === "function") {
          await resolvedRuntime.close();
        }
      }
    },
    async close() {
      service.close();
      transport.close();
      if (resolvedRuntime && typeof resolvedRuntime.close === "function") {
        await resolvedRuntime.close();
      }
    }
  };
}

export function createAcpSourceStdioServerOptionsFromEnv(env = process.env) {
  const runtimeOptions = parseJsonEnv(env.PACT_ACP_SOURCE_STDIO_RUNTIME_JSON, {});
  const baseContext = parseJsonEnv(env.PACT_ACP_SOURCE_STDIO_CONTEXT_JSON, {});
  const context = {
    ...baseContext,
    sourceId: asText(env.PACT_ACP_SOURCE_ID || env.PACT_SOURCE_ID || env.SOURCE_ID || baseContext.sourceId || baseContext.source_id || ""),
    sourceSubjectId: asText(
      env.PACT_ACP_SOURCE_SUBJECT_ID ||
        env.PACT_SOURCE_SUBJECT_ID ||
        env.SOURCE_SUBJECT_ID ||
        baseContext.sourceSubjectId ||
        baseContext.source_subject_id ||
        ""
    ),
    workspaceId: asText(env.PACT_ACP_WORKSPACE_ID || env.PACT_WORKSPACE_ID || env.WORKSPACE_ID || baseContext.workspaceId || baseContext.workspace_id || ""),
    sourceScopes: [
      ...parseListEnv(env.PACT_ACP_SOURCE_SCOPES || env.PACT_SOURCE_SCOPES),
      ...(Array.isArray(baseContext.sourceScopes) ? baseContext.sourceScopes : [])
    ],
    sourceCapabilities: [
      ...parseListEnv(env.PACT_ACP_SOURCE_CAPABILITIES || env.PACT_SOURCE_CAPABILITIES),
      ...(Array.isArray(baseContext.sourceCapabilities) ? baseContext.sourceCapabilities : [])
    ],
    sourceIdentity: {
      ...asObject(baseContext.sourceIdentity),
      ...parseJsonEnv(env.PACT_ACP_SOURCE_IDENTITY_JSON, {})
    }
  };
  return {
    runtimeOptions,
    context: Object.fromEntries(Object.entries(context).filter(([, value]) => {
      if (typeof value === "string") {
        return value.length > 0;
      }
      return value && Object.keys(asObject(value)).length > 0;
    }))
  };
}

export async function runAcpSourceStdioServerFromEnv({
  env = process.env,
  input = process.stdin,
  output = process.stdout,
  diagnostics = process.stderr,
  logger = null
} = {}) {
  const options = createAcpSourceStdioServerOptionsFromEnv(env);
  const { createAcpRelayRuntime } = await import("./index.mjs");
  const runtime = createAcpRelayRuntime(runtimeOptionsWithEnvStore(options.runtimeOptions, env));
  const server = createAcpSourceStdioServer({
    runtime,
    context: options.context,
    input,
    output,
    diagnostics,
    logger
  });
  return server.serve();
}
