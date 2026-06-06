#!/usr/bin/env node
import {
  runAcpSourceStdioServerFromEnv
} from "../platform/specialized/capabilities/agent-relay/acp-agent-relay/acp-source-stdio-server.mjs";

runAcpSourceStdioServerFromEnv().catch((error) => {
  process.stderr.write(
    `${JSON.stringify({
      event: "pact.acp.source_stdio.failed",
      error: {
        code: "acp_source_stdio_failed",
        message: error instanceof Error ? error.message : "ACP source stdio server failed."
      }
    })}\n`
  );
  process.exitCode = 1;
});
