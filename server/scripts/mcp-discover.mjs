import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function argValue(name, fallback = "") {
  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) {
    return process.argv[index + 1];
  }
  return fallback;
}

const explicitUrl = String(argValue("--url", process.env.PACT_MCP_BASE_URL || "")).trim();
const args = ["server/platform/common/mcp/gateway-installer/bin/pact-mcp.mjs", "discover", "--json"];
if (explicitUrl) {
  args.push("--url", explicitUrl);
}

try {
  const result = await execFileAsync(process.execPath, args, {
    cwd: process.cwd(),
    maxBuffer: 10 * 1024 * 1024
  });
  console.log(JSON.stringify(JSON.parse(result.stdout), null, 2));
} catch (error) {
  const message = error.stderr || error.stdout || error.message || "MCP discovery failed";
  console.error(message.trim());
  process.exit(1);
}
