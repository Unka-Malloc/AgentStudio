import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const flutterClientRoot = path.join(workspaceRoot, "client-gui");

function findLinuxBundle() {
  const linuxBuildRoot = path.join(flutterClientRoot, "build", "linux");
  const candidates = [];
  for (const arch of existsSync(linuxBuildRoot) ? readdirSync(linuxBuildRoot) : []) {
    const bundleDir = path.join(linuxBuildRoot, arch, "release", "bundle");
    if (existsSync(path.join(bundleDir, "flutter_client"))) {
      candidates.push(bundleDir);
    }
  }
  if (candidates.length === 0) {
    throw new Error("No Linux bundle found. Run npm run client:build:linux first.");
  }
  candidates.sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);
  return candidates[0];
}

function runJson(command, args, env) {
  const result = spawnSync(command, args, {
    cwd: path.dirname(command),
    env,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(
      `${path.basename(command)} ${args.join(" ")} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  }
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`Command did not return JSON: ${result.stdout}\n${error.message}`);
  }
}

async function main() {
  if (process.platform !== "linux") {
    throw new Error("Linux bundle smoke tests must run inside Linux.");
  }

  const bundleDir = findLinuxBundle();
  const flutterBinary = path.join(bundleDir, "flutter_client");
  const cli = path.join(bundleDir, "pact-client");
  const packagingManifest = path.join(bundleDir, "portable-data", "future-client", "packaging-modules.json");
  for (const file of [flutterBinary, cli]) {
    if (!existsSync(file)) {
      throw new Error(`Bundle binary is missing: ${file}`);
    }
  }
  if (!existsSync(packagingManifest)) {
    throw new Error(`Packaging manifest is missing: ${packagingManifest}`);
  }
  const manifest = JSON.parse(readFileSync(packagingManifest, "utf8"));
  const enabledModuleIds = new Set(
    manifest.modules?.map((item) => item.id) || []
  );
  for (const moduleId of ["client-gui", "client-cli", "portable-data", "target-adapters"]) {
    if (!enabledModuleIds.has(moduleId)) {
      throw new Error(`Packaging manifest does not include required module: ${moduleId}`);
    }
  }
  const macOSMailTool = path.join(bundleDir, "pact-macos-mail-tool");
  if (existsSync(macOSMailTool)) {
    throw new Error(`Linux bundle must not include macOS Mail sidecar: ${macOSMailTool}`);
  }

  const dataDir = path.join(os.tmpdir(), `pact-ubuntu-smoke-${process.pid}-${Date.now()}`);
  mkdirSync(dataDir, { recursive: true });
  const env = { ...process.env, PACT_PORTABLE_DIR: dataDir };
  try {
    const scan = runJson(cli, ["targets", "scan"], env);
    if (scan.ok !== true || !Array.isArray(scan.targets)) {
      throw new Error(`Unexpected target scan result: ${JSON.stringify(scan)}`);
    }

    console.log(JSON.stringify({
      ok: true,
      bundleDir,
      checks: [
        "bundle binaries exist",
        "packaging manifest includes required modules",
        "bundle excludes macOS Mail sidecar",
        "CLI target scan works with shared portable workspace",
      ],
    }, null, 2));
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
