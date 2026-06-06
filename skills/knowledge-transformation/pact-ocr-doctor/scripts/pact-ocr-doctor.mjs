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
      resolve({ ok: false, output: error.message });
    });
    child.on("close", (code) => {
      resolve({ ok: code === 0, output: `${stdout}\n${stderr}`.trim() });
    });
  });
}

function inferFileType(filePath) {
  return path.extname(filePath).toLowerCase() === ".pdf" ? "pdf" : "image";
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
  const ocrModulePath = path.join(repo, "server/platform/modules/knowledge/file-processor/FileNormalizer/OCR/paddle-ocr.mjs");
  const configPath = path.join(repo, "server/platform/common/platform-core/settings.mjs");
  const scriptPath = path.join(repo, "ocr/paddle_ocr_extract.py");
  const result = {
    repo,
    dataDir,
    checks: []
  };

  function check(name, ok, details = "") {
    result.checks.push({ name, ok: Boolean(ok), details });
  }

  check("ocr module", await exists(ocrModulePath), ocrModulePath);
  check("paddle script", await exists(scriptPath), scriptPath);

  const { loadSettings } = await import(pathToFileURL(configPath).href);
  const settings = await loadSettings(dataDir, { redactSecrets: true });
  result.settings = {
    ocrEnabled: settings.ocrEnabled,
    ocrPythonPath: settings.ocrPythonPath,
    ocrLanguage: settings.ocrLanguage
  };

  const python = settings.ocrPythonPath || process.env.PACT_OCR_PYTHON_PATH || "python3";
  const py = await run(python, ["--version"]);
  check("python runtime", py.ok, py.output || python);

  if (args.sample) {
    const samplePath = path.resolve(String(args.sample));
    const { extractTextWithPaddleOcr } = await import(pathToFileURL(ocrModulePath).href);
    try {
      const extracted = await extractTextWithPaddleOcr({
        filePath: samplePath,
        fileName: path.basename(samplePath),
        fileType: inferFileType(samplePath),
        settings,
        userDataPath: dataDir
      });
      check("sample ocr", true, `text=${(extracted.text || "").length} pages=${extracted.pages.length}`);
    } catch (error) {
      check("sample ocr", false, error instanceof Error ? error.message : String(error));
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
