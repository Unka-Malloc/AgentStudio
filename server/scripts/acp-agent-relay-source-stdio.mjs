#!/usr/bin/env node

process.stderr.write(
  `${JSON.stringify({
    event: "pact.acp.source_stdio.disabled",
    error: {
      code: "local_stdio_interface_disabled",
      message: "Pact no longer exposes local stdio interfaces. Use an authenticated HTTP/HTTPS endpoint instead."
    }
  })}\n`
);
process.exitCode = 1;
