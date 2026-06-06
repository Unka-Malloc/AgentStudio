#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  collectPackagePlan,
  resolveFeatureRuntime,
  writeFeaturePlanArtifacts
} from "../platform/interactive/features/feature-manifest.mjs";
import {
  applyFeatureSourcePlan,
  runtimeDependenciesForPackagingPlan
} from "./pack-offline-server.mjs";
import { applyFeatureUiPlan } from "./composition-ui-layout.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "../..");
const DEFAULT_OUTPUT = path.join(REPO_ROOT, "pact-v1");
const DEFAULT_DOCS = [
  "Architecture.md",
  "SERVER.md",
  "SERVER_WEB.md",
  "PROTOCOLS.md",
  "USAGE.md",
  "FEATURE-PROFILES.md"
];

function parseArgs(argv) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) {
      args._.push(item);
      continue;
    }
    const keyValue = item.slice(2);
    const equalIndex = keyValue.indexOf("=");
    const key = equalIndex >= 0 ? keyValue.slice(0, equalIndex) : keyValue;
    const inlineValue = equalIndex >= 0 ? keyValue.slice(equalIndex + 1) : null;
    const next = argv[index + 1];
    if (inlineValue !== null) {
      args[key] = inlineValue;
    } else if (next && !next.startsWith("--")) {
      args[key] = next;
      index += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}

function usage() {
  return [
    "Usage:",
    "  node server/scripts/create-minimal-server-source.mjs [--output pact-v1] [--force]",
    "",
    "Options:",
    "  --output PATH          Target source tree directory. Default: ./pact-v1",
    "  --edition ID           Feature edition to instantiate. Default: community",
    "  --feature-profile PATH Optional custom feature profile JSON.",
    "  --features LIST        Extra feature IDs to enable, comma-separated.",
    "  --without-features LIST Feature IDs to disable, comma-separated.",
    "  --force                Delete the target directory before creating it.",
    "  --skip-ui-build        Reuse existing build/dist instead of building renderer first.",
    "  --no-docs              Do not copy selected docs into the target tree.",
    "  --no-verify           Skip generated tree self-checks.",
    "  --no-source-trim      Keep the full server source tree while still writing the feature profile.",
    "  --install              Run npm install --omit=dev inside the target tree.",
    "  --start                Start the generated server after instantiation.",
    "  --port PORT            Port used with --start. Default: 8791.",
    "  --data-dir PATH        Data dir used with --start. Default: ./data.",
    "  --help                 Show this help."
  ].join("\n");
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

function normalizeBooleanDisabled(args, key) {
  return args[key] === true || args[key] === "1" || args[key] === "true";
}

function packageJsonForTarget({ rootPackage, dependencies, edition }) {
  return {
    name: "pact-v1-minimal-server",
    version: rootPackage.version || "0.0.1",
    private: true,
    type: "module",
    bin: {
      pact: "server/scripts/pact.mjs"
    },
    scripts: {
      start: `node server/scripts/start-server.mjs --with-ui --profile minimal --edition ${edition}`,
      "server:start": `node server/scripts/start-server.mjs --with-ui --profile minimal --edition ${edition}`,
      "composition:service:start": `node server/scripts/start-composition-service.mjs --profile minimal --edition ${edition}`,
      "composition:external:verify": "node server/scripts/composition-external-service.mjs verify",
      "composition:external:prepare": "node server/scripts/composition-external-service.mjs prepare",
      "composition:external:start": "node server/scripts/composition-external-service.mjs start",
      "composition:external:stop": "node server/scripts/composition-external-service.mjs stop",
      "composition:external:doctor": "node server/scripts/composition-external-service.mjs doctor",
      "composition:external:smoke": "node server/scripts/composition-external-service.mjs smoke",
      "composition:external:health": "node server/scripts/composition-external-service.mjs health",
      "composition:verify:source": "node server/scripts/verify-composition-source.mjs",
      "composition:regression": "npm run composition:verify:source",
      "server:verify": "npm run composition:regression"
    },
    dependencies
  };
}

async function copyPath(source, destination) {
  await fs.cp(source, destination, {
    recursive: true,
    force: false,
    errorOnExist: false,
    filter: (entry) => {
      const name = path.basename(entry);
      return name !== ".DS_Store" && name !== ".git" && name !== "node_modules";
    }
  });
}

async function copyDocs(targetPath, docs = DEFAULT_DOCS) {
  const docsTarget = path.join(targetPath, "docs");
  await fs.mkdir(docsTarget, { recursive: true });
  for (const doc of docs) {
    const source = path.join(REPO_ROOT, "docs", doc);
    if (await pathExists(source)) {
      await copyPath(source, path.join(docsTarget, doc));
    }
  }
}

async function ensureRendererDist({ skipBuild = false } = {}) {
  const indexPath = path.join(REPO_ROOT, "build", "dist", "index.html");
  if (skipBuild) {
    if (!(await pathExists(indexPath))) {
      throw new Error("build/dist/index.html does not exist. Remove --skip-ui-build or run npm run build:renderer:raw first.");
    }
    return;
  }
  await run("npm", ["run", "build:renderer:raw"], { cwd: REPO_ROOT });
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || REPO_ROOT,
      stdio: options.stdio || "inherit",
      env: {
        ...process.env,
        COPYFILE_DISABLE: "1",
        ...(options.env || {})
      }
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code}`));
        return;
      }
      resolve();
    });
  });
}

async function writeTargetPackageJson({ targetPath, packagingPlan }) {
  const rootPackage = await readJson(path.join(REPO_ROOT, "package.json"));
  const dependencyNames = runtimeDependenciesForPackagingPlan(packagingPlan);
  const dependencies = {};
  for (const name of dependencyNames) {
    const version = rootPackage.dependencies?.[name];
    if (!version) {
      throw new Error(`Root package.json is missing runtime dependency ${name}`);
    }
    dependencies[name] = version;
  }
  await fs.writeFile(
    path.join(targetPath, "package.json"),
    `${JSON.stringify(packageJsonForTarget({
      rootPackage,
      dependencies,
      edition: packagingPlan.featureProfile.edition
    }), null, 2)}\n`,
    "utf8"
  );
}

async function writeReadme({ targetPath, featureRuntime }) {
  await fs.writeFile(
    path.join(targetPath, "README.md"),
    [
      "# pact-v1",
      "",
      "Minimal Pact server source tree generated from FeatureManifest.",
      "",
      "## Feature Profile",
      "",
      `- edition: \`${featureRuntime.edition}\``,
      `- active features: ${featureRuntime.activeFeatureIds.map((featureId) => `\`${featureId}\``).join(", ")}`,
      `- disabled feature count: ${featureRuntime.disabledFeatureIds.length}`,
      "",
      "## Run",
      "",
      "```bash",
      "npm install --omit=dev",
      "npm run server:start -- --port 8791 --data-dir ./data",
      "npm run composition:service:start -- --port 8791 --data-dir ./data",
      "```",
      "",
      "## Generated Files",
      "",
      "- `feature-profile/feature-profile.json`",
      "- `feature-profile/source-layout-report.json`",
      "- `feature-profile/ui-layout-report.json`",
      "- `feature-profile/active-features.json`",
      "- `feature-profile/disabled-features.json`",
      "",
      "## Verify",
      "",
      "```bash",
      "npm run server:verify:platform-layout",
      "npm run server:verify:feature-profiles",
      "```",
      ""
    ].join("\n"),
    "utf8"
  );
}

async function copyClientPackagingManifest(targetPath) {
  const source = path.join(REPO_ROOT, "client-gui", "packaging.modules.json");
  if (!(await pathExists(source))) {
    return;
  }
  const target = path.join(targetPath, "client-gui", "packaging.modules.json");
  await fs.mkdir(path.dirname(target), { recursive: true });
  await copyPath(source, target);
}

async function instantiateMinimalSource(args = {}) {
  const edition = String(args.edition || "community").trim() || "community";
  const targetPath = path.resolve(String(args.output || args.out || DEFAULT_OUTPUT));
  const force = normalizeBooleanDisabled(args, "force");
  const skipUiBuild = normalizeBooleanDisabled(args, "skip-ui-build");
  const noDocs = normalizeBooleanDisabled(args, "no-docs");
  const noVerify = normalizeBooleanDisabled(args, "no-verify");
  const noSourceTrim = normalizeBooleanDisabled(args, "no-source-trim");
  const install = normalizeBooleanDisabled(args, "install");

  if (await pathExists(targetPath)) {
    if (!force) {
      throw new Error(`Target already exists: ${targetPath}. Pass --force to recreate it.`);
    }
    await fs.rm(targetPath, { recursive: true, force: true });
  }

  await ensureRendererDist({ skipBuild: skipUiBuild });

  const profile = args["feature-profile"] ? await readJson(path.resolve(String(args["feature-profile"]))) : {};
  const featureRuntime = resolveFeatureRuntime({
    edition,
    profile,
    enableFeatures: args.features,
    disableFeatures: args["without-features"]
  });
  const packagePlan = collectPackagePlan(featureRuntime);
  const packagingPlan = {
    featureProfile: {
      edition: featureRuntime.edition,
      activeFeatureIds: featureRuntime.activeFeatureIds,
      disabledFeatureIds: featureRuntime.disabledFeatureIds
    },
    featureRuntime: featureRuntime,
    featurePackagePlan: packagePlan
  };

  await fs.mkdir(targetPath, { recursive: false });
  await fs.mkdir(path.join(targetPath, "build"), { recursive: true });
  await copyPath(path.join(REPO_ROOT, "server"), path.join(targetPath, "server"));
  if (await pathExists(path.join(REPO_ROOT, "modules"))) {
    await copyPath(path.join(REPO_ROOT, "modules"), path.join(targetPath, "modules"));
  }
  await copyPath(path.join(REPO_ROOT, "build", "dist"), path.join(targetPath, "build", "dist"));
  await copyClientPackagingManifest(targetPath);
  if (!noDocs) {
    await copyDocs(targetPath);
  }

  await writeFeaturePlanArtifacts({
    outputDir: path.join(targetPath, "feature-profile"),
    featureRuntime,
    packagePlan
  });
  await fs.writeFile(
    path.join(targetPath, "feature-profile", "feature-profile.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      edition: featureRuntime.edition,
      features: featureRuntime.activeFeatureIds
    }, null, 2)}\n`,
    "utf8"
  );
  const uiLayoutReport = await applyFeatureUiPlan(targetPath, packagingPlan);
  let sourceLayoutReport;
  if (noSourceTrim) {
    sourceLayoutReport = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      edition: packagingPlan.featureProfile.edition,
      requestedPaths: packagingPlan.featurePackagePlan?.removePaths || [],
      applied: [],
      lingeringPaths: [],
      staticImportViolations: [],
      trimSkipped: true,
      reason: "source trim disabled; feature profile and operation surface are still generated",
      ok: true
    };
    await fs.writeFile(
      path.join(targetPath, "feature-profile", "source-layout-report.json"),
      `${JSON.stringify(sourceLayoutReport, null, 2)}\n`,
      "utf8"
    );
  } else {
    sourceLayoutReport = await applyFeatureSourcePlan(targetPath, packagingPlan);
  }
  await writeTargetPackageJson({ targetPath, packagingPlan });
  await writeReadme({ targetPath, featureRuntime });
  await fs.writeFile(
    path.join(targetPath, ".gitignore"),
    ["node_modules/", "data/", ".pact-server-data/", "*.log", ""].join("\n"),
    "utf8"
  );

  if (!noVerify) {
    await run(process.execPath, ["--check", "server/scripts/start-server.mjs"], { cwd: targetPath });
    await run(process.execPath, ["--check", "server/services/server-runtime/http-server.mjs"], { cwd: targetPath });
    await run("npm", ["run", "server:verify:platform-layout"], { cwd: targetPath });
    await run("npm", ["run", "server:verify:feature-profiles"], { cwd: targetPath });
  }

  if (install) {
    await run("npm", ["install", "--omit=dev"], { cwd: targetPath });
  }

  return {
    ok: true,
    targetPath,
    edition: featureRuntime.edition,
    activeFeatures: featureRuntime.activeFeatureIds,
    disabledFeatureCount: featureRuntime.disabledFeatureIds.length,
    sourceLayout: {
      ok: sourceLayoutReport.ok,
      trimSkipped: sourceLayoutReport.trimSkipped === true,
      requestedPathCount: sourceLayoutReport.requestedPaths.length,
      appliedPathCount: sourceLayoutReport.applied.length,
      staticImportViolationCount: sourceLayoutReport.staticImportViolations.length
    },
    uiLayout: {
      ok: uiLayoutReport.ok,
      trimSkipped: uiLayoutReport.trimSkipped === true,
      activeRouteCount: uiLayoutReport.activeRoutes?.length || 0,
      inactiveRouteCount: uiLayoutReport.inactiveRoutes?.length || 0,
      removedAssetCount: uiLayoutReport.removedAssets?.length || 0
    },
    installed: install
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const result = await instantiateMinimalSource(args);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

  if (normalizeBooleanDisabled(args, "start")) {
    const port = String(args.port || "8791");
    const dataDir = String(args["data-dir"] || "./data");
    await run("npm", ["run", "server:start", "--", "--port", port, "--data-dir", dataDir], {
      cwd: result.targetPath
    });
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exit(1);
});
