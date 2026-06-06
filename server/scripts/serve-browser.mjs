import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { ServerConfig } from "../platform/common/config/ServerConfig.mjs";
import { startLocalHttpServer } from "../services/server-runtime/http-server.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../..");
const distPath = path.join(projectRoot, "build", "dist");

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) {
      continue;
    }
    const key = item.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
      continue;
    }
    parsed[key] = next;
    index += 1;
  }
  return parsed;
}

function normalizePort(value) {
  if (value === undefined || value === null || value === "") {
    return 0;
  }
  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`无效端口号：${value}`);
  }
  return port;
}

const args = parseArgs(process.argv.slice(2));
const userDataPath = path.resolve(
  String(args["data-dir"] || process.env.PACT_SERVER_DATA_DIR || ServerConfig.getDataDir())
);
const port = normalizePort(args.port || process.env.PORT);

const serverHandle = await startLocalHttpServer({
  userDataPath,
  distPath,
  port
});

console.log(`Pact local service is running at ${serverHandle.url}`);
console.log(`Settings are stored in ${userDataPath}`);

async function shutdown(code = 0) {
  try {
    await serverHandle.close();
  } catch {
    // Ignore shutdown errors.
  }

  process.exit(code);
}

process.on("SIGINT", () => {
  void shutdown(0);
});

process.on("SIGTERM", () => {
  void shutdown(0);
});
