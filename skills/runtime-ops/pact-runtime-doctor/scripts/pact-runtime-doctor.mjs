#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) {
      continue;
    }
    const key = item.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

async function exists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function run(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      resolve({ ok: false, code: -1, output: error.message });
    });
    child.on("close", (code) => {
      resolve({ ok: code === 0, code, output: `${stdout}\n${stderr}`.trim() });
    });
  });
}

async function resolveDataDir(repo, args) {
  if (args["data-dir"]) {
    return path.resolve(String(args["data-dir"]));
  }

  const serverConfigPath = path.join(repo, "server/platform/common/config/ServerConfig.mjs");
  try {
    const { ServerConfig } = await import(pathToFileURL(serverConfigPath).href);
    if (typeof ServerConfig?.getDataDir === "function") {
      return path.resolve(ServerConfig.getDataDir());
    }
  } catch {
    // Legacy checkouts may not expose Pact's ServerConfig yet.
  }

  return path.resolve(process.env.PACT_SERVER_DATA_DIR || path.join(process.env.HOME || process.cwd(), ".pact-server-data"));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repo = path.resolve(String(args.repo || process.cwd()));
  const dataDir = await resolveDataDir(repo, args);
  const configPath = path.join(repo, "server/platform/common/platform-core/settings.mjs");
  const tikaPath = path.join(repo, "server/platform/modules/knowledge/file-processor/FileNormalizer/Tika/tika.mjs");
  const packagePath = path.join(repo, "package.json");
  const result = {
    repo,
    dataDir,
    checks: []
  };

  function check(name, ok, details = "") {
    result.checks.push({ name, ok: Boolean(ok), details });
  }

  check("package.json", await exists(packagePath), packagePath);
  check("server config module", await exists(configPath), configPath);
  check("tika module", await exists(tikaPath), tikaPath);

  const { loadSettings } = await import(pathToFileURL(configPath).href);
  const settings = await loadSettings(dataDir, { redactSecrets: true });
  result.settings = settings;

  const tikaJarCandidates = [
    settings.tikaJarPath,
    process.env.PACT_TIKA_JAR_PATH,
    path.join(repo, "vendor/tika/tika-app-3.2.3.jar"),
    path.join(repo, "vendor/tika/tika-app.jar")
  ].filter(Boolean);
  for (const candidate of tikaJarCandidates) {
    if (await exists(candidate)) {
      check("tika jar", true, candidate);
      break;
    }
  }
  if (!result.checks.some((item) => item.name === "tika jar" && item.ok)) {
    check("tika jar", false, tikaJarCandidates.join(" | "));
  }

  const javaCommand = settings.javaBinPath || process.env.PACT_JAVA_BIN_PATH || "java";
  const java = await run(javaCommand, ["-version"]);
  check("java runtime", java.ok, java.output.split("\n")[0] || javaCommand);

  if (args.sample) {
    const { extractDocumentWithTika } = await import(pathToFileURL(tikaPath).href);
    try {
      const document = await extractDocumentWithTika({
        filePath: path.resolve(String(args.sample)),
        fileName: path.basename(String(args.sample)),
        settings,
        userDataPath: dataDir
      });
      check("sample extraction", true, `${document.parserId || "builtin/tika"} text=${(document.text || "").length}`);
    } catch (error) {
      check("sample extraction", false, error instanceof Error ? error.message : String(error));
    }
  }

  console.log(JSON.stringify(result, null, 2));
  if (result.checks.some((item) => !item.ok)) {
    process.exit(2);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
