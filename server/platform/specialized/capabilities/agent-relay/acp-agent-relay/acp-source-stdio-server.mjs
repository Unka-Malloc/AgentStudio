export const ACP_SOURCE_STDIO_DISABLED_EVENT = "pact.acp.source_stdio.disabled";
export const ACP_SOURCE_STDIO_DISABLED_ERROR_CODE = "local_stdio_interface_disabled";
export const ACP_SOURCE_STDIO_DISABLED_MESSAGE =
  "Pact no longer exposes local stdio interfaces. Use an authenticated HTTP/HTTPS endpoint instead.";

function createDisabledError() {
  const error = new Error(ACP_SOURCE_STDIO_DISABLED_MESSAGE);
  error.code = ACP_SOURCE_STDIO_DISABLED_ERROR_CODE;
  return error;
}

function writeDisabledStatus(stream) {
  if (stream && typeof stream.write === "function") {
    stream.write(`${JSON.stringify({
      event: ACP_SOURCE_STDIO_DISABLED_EVENT,
      error: {
        code: ACP_SOURCE_STDIO_DISABLED_ERROR_CODE,
        message: ACP_SOURCE_STDIO_DISABLED_MESSAGE
      }
    })}\n`);
  }
}

export function createAcpSourceStdioServer() {
  throw createDisabledError();
}

export function createAcpSourceStdioServerOptionsFromEnv() {
  throw createDisabledError();
}

export async function runAcpSourceStdioServerFromEnv({
  diagnostics = process.stderr
} = {}) {
  writeDisabledStatus(diagnostics);
  return {
    ok: false,
    error: {
      code: ACP_SOURCE_STDIO_DISABLED_ERROR_CODE,
      message: ACP_SOURCE_STDIO_DISABLED_MESSAGE
    }
  };
}
