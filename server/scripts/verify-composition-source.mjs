#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_ROOT = path.resolve(SCRIPT_DIR, "../..");

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(relativePath) {
  const filePath = path.join(SOURCE_ROOT, relativePath);
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || SOURCE_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        COPYFILE_DISABLE: "1",
        ...(options.env || {})
      }
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code !== 0) {
        const error = new Error(`${command} ${args.join(" ")} failed with exit code ${code}`);
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function sortedStrings(values = []) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))].sort();
}

function sameStringSet(left = [], right = []) {
  return JSON.stringify(sortedStrings(left)) === JSON.stringify(sortedStrings(right));
}

async function assertMissing(relativePath) {
  assert.equal(
    await pathExists(path.join(SOURCE_ROOT, relativePath)),
    false,
    `${relativePath} should be physically removed from this composition source package`
  );
}

async function assertExisting(relativePath) {
  assert.equal(
    await pathExists(path.join(SOURCE_ROOT, relativePath)),
    true,
    `${relativePath} must exist in this composition source package`
  );
}

async function nodeCheck(relativePath) {
  await assertExisting(relativePath);
  await run(process.execPath, ["--check", relativePath]);
  return relativePath;
}

async function verifyOperationCoverage(plan) {
  const featureManifestPath = path.join(SOURCE_ROOT, "server/platform/interactive/features/feature-manifest.mjs");
  const operationRegistryPath = path.join(SOURCE_ROOT, "server/platform/common/operation-dispatcher/operation-registry.mjs");
  await assertExisting(path.relative(SOURCE_ROOT, featureManifestPath));
  await assertExisting(path.relative(SOURCE_ROOT, operationRegistryPath));
  const [{ filterOperationsForFeatures }, { SERVER_API_OPERATIONS }] = await Promise.all([
    import(pathToFileURL(featureManifestPath).href),
    import(pathToFileURL(operationRegistryPath).href)
  ]);
  const activeOperationIds = new Set(
    filterOperationsForFeatures(SERVER_API_OPERATIONS, plan.featureRuntime || {})
      .map((operation) => operation.id)
  );
  const requiredOperationIds = sortedStrings(
    (plan.operationCoverage || []).map((entry) => entry.operationId)
  );
  for (const operationId of requiredOperationIds) {
    assert.equal(activeOperationIds.has(operationId), true, `${operationId} must be active in this package`);
  }
  return {
    requiredOperationCount: requiredOperationIds.length,
    activeOperationCount: activeOperationIds.size
  };
}

async function verifyExternalService(plan) {
  if (!plan.externalService) {
    return null;
  }
  await assertExisting("composition/external-service.config.json");
  await assertExisting("composition/EXTERNAL_SERVICE.md");
  const result = await run(process.execPath, ["server/scripts/composition-external-service.mjs", "verify"]);
  const parsed = JSON.parse(result.stdout || "{}");
  assert.equal(parsed.ok, true, "external service config must verify inside this package");
  assert.equal(
    parsed.serviceId,
    plan.externalService.serviceId,
    "external service config must match composition plan serviceId"
  );
  return {
    serviceId: parsed.serviceId,
    serviceName: parsed.serviceName,
    mode: parsed.mode,
    startupPolicy: parsed.startupPolicy,
    scripts: parsed.scripts || []
  };
}

async function main() {
  const plan = await readJson("composition/composition-plan.json");
  const sourceLayout = await readJson("feature-profile/source-layout-report.json");
  const uiLayout = await readJson("feature-profile/ui-layout-report.json");
  const featureProfile = await readJson("feature-profile/feature-profile.json");
  const packageJson = await readJson("package.json");

  assert.equal(plan.ok, true, "composition plan must be ok");
  assert.equal(sourceLayout.ok, true, "source layout report must be ok");
  assert.equal(sourceLayout.trimSkipped === true, false, "source trim must not be skipped");
  assert.equal((sourceLayout.staticImportViolations || []).length, 0, "source package must have no static import violations");
  assert.equal((sourceLayout.lingeringPaths || []).length, 0, "source package must have no lingering removed paths");
  const uiTrimSkipped = uiLayout.trimSkipped === true;
  if (uiTrimSkipped) {
    assert.match(
      String(uiLayout.reason || ""),
      /build\/dist\/index\.html is missing/,
      "ui trim may be skipped only for API-only source packages without build/dist"
    );
  } else {
    assert.equal(uiLayout.ok, true, "ui layout report must be ok");
    assert.equal((uiLayout.missingActiveRouteAssets || []).length, 0, "active UI route assets must remain in this package");
    assert.equal((uiLayout.inactiveRouteAssetsRemaining || []).length, 0, "inactive UI route assets must be physically removed");
    assert.equal((uiLayout.missingKeptAssets || []).length, 0, "kept UI assets must exist in this package");
    assert.equal((uiLayout.unpatchedRoutes || []).length, 0, "inactive UI routes must not keep dynamic imports to removed chunks");
    assert.ok((uiLayout.removedAssets || []).length > 0, "ui package must remove inactive assets");
  }
  assert.equal(
    sameStringSet(featureProfile.features || [], plan.featureRuntime?.activeFeatureIds || []),
    true,
    "feature-profile.json must match composition-plan active features"
  );
  assert.equal(
    (plan.inactiveRequiredOperations || []).length,
    0,
    "composition plan must not contain inactive required operations"
  );
  for (const entry of plan.operationCoverage || []) {
    assert.equal(entry.registered, true, `${entry.operationId} must be registered`);
    assert.equal(entry.active, true, `${entry.operationId} must be active`);
  }

  for (const relativePath of sourceLayout.requestedPaths || []) {
    await assertMissing(relativePath);
  }

  const checkedEntrypoints = [];
  for (const relativePath of [
    "server/scripts/start-server.mjs",
    "server/services/server-runtime/http-server.mjs",
    "server/platform/interactive/composition-root.mjs",
    "server/platform/common/console/http/api-facade.mjs",
    "server/platform/common/module-manager/mount-manager.mjs",
    "server/platform/common/operation-dispatcher/operation-dispatcher.mjs"
  ]) {
    checkedEntrypoints.push(await nodeCheck(relativePath));
  }

  for (const relativePath of [
    "Dockerfile",
    "compose.yaml",
    "feature-profile/active-features.json",
    "feature-profile/disabled-features.json"
  ]) {
    await assertExisting(relativePath);
  }
  if (!uiTrimSkipped) {
    for (const relativePath of [
      "build/dist/index.html",
      "build/dist/composition-ui-manifest.json"
    ]) {
      await assertExisting(relativePath);
    }
  }

  const operationCoverage = await verifyOperationCoverage(plan);
  const externalService = await verifyExternalService(plan);
  const result = {
    ok: true,
    presetId: plan.presetId,
    sourceRoot: SOURCE_ROOT,
    packageName: packageJson.name || "",
    featureCount: (plan.featureRuntime?.activeFeatureIds || []).length,
    sourceLayout: {
      trimSkipped: sourceLayout.trimSkipped === true,
      requestedPathCount: (sourceLayout.requestedPaths || []).length,
      appliedPathCount: (sourceLayout.applied || []).length,
      cascadePrunedFileCount: (sourceLayout.cascadePrunedFiles || []).length,
      staticImportViolationCount: (sourceLayout.staticImportViolations || []).length
    },
    uiLayout: {
      trimSkipped: uiLayout.trimSkipped === true,
      activeRouteCount: (uiLayout.activeRoutes || []).length,
      inactiveRouteCount: (uiLayout.inactiveRoutes || []).length,
      removedAssetCount: (uiLayout.removedAssets || []).length,
      patchedRouteCount: (uiLayout.patchedRoutes || []).length,
      assetCountBefore: uiLayout.assetCountBefore,
      assetCountAfter: uiLayout.assetCountAfter
    },
    operationCoverage,
    externalService,
    checkedEntrypoints
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exit(1);
});
