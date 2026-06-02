#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  downloadRuntimeDependency,
  listRuntimeDependencyDownloadRuns,
  listRuntimeDependencies,
  RUNTIME_DEPENDENCIES_PROTOCOL_VERSION
} from "../platform/specialized/capabilities/runtime-dependencies/index.mjs";

const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-runtime-dependencies-"));

const list = await listRuntimeDependencies({ userDataPath });
assert.equal(list.ok, true);
assert.equal(list.protocolVersion, RUNTIME_DEPENDENCIES_PROTOCOL_VERSION);
assert.equal(list.startupDownloads, false);
assert.equal(list.triggerMode, "user-requested");
assert.ok(list.sourceConfigPath, "list should expose the local source config path");
assert.equal(
  list.cacheRoot,
  path.join(userDataPath, "runtime", "runtime-dependencies"),
  "runtime dependency cache should live under the server data dir by default",
);
await fs.access(list.sourceConfigPath);
const sourceConfig = JSON.parse(await fs.readFile(list.sourceConfigPath, "utf8"));
for (const id of ["dify", "rag-flow", "docker", "jre", "tika", "python", "caddy", "nginx", "gerrit"]) {
  assert.ok(sourceConfig.sources?.[id], `missing local source config: ${id}`);
}

const ids = new Set((list.dependencies || []).map((item) => item.id));
for (const id of ["dify", "rag-flow", "cloud-drives", "docker", "jre", "python", "node", "caddy", "nginx", "gerrit"]) {
  assert.equal(ids.has(id), true, `missing runtime dependency row: ${id}`);
}

const allowedStatuses = new Set(["present", "installed", "failed"]);

function assertRuntimeStatuses(value, label = "result") {
  if (!value || typeof value !== "object") return;
  if (typeof value.status === "string") {
    assert.equal(allowedStatuses.has(value.status), true, `${label} returned unsupported status ${value.status}`);
  }
  for (const key of ["dependencies", "children", "results", "images"]) {
    if (Array.isArray(value[key])) {
      value[key].forEach((item, index) => assertRuntimeStatuses(item, `${label}.${key}[${index}]`));
    }
  }
}

function assertRuntimeSources(dependencies = [], label = "dependencies") {
  for (const item of dependencies) {
    const source = item.detection?.source;
    if (item.children?.length) {
      assertRuntimeSources(item.children, `${label}.${item.id}.children`);
      continue;
    }
    assert.ok(source?.label, `${label}.${item.id} should expose a detected source label`);
    assert.ok(
      source.path || source.detail,
      `${label}.${item.id} should expose a detected source path or detail`,
    );
  }
}

assertRuntimeStatuses(list, "list");
assertRuntimeSources(list.dependencies || []);
for (const id of ["jre", "python", "node"]) {
  const dependency = (list.dependencies || []).find((item) => item.id === id);
  const detection = dependency?.detection || {};
  const version = detection.javaVersion || detection.pythonVersion || detection.version || "";
  assert.ok(version, `${id} should expose the detected runtime version`);
}

const gerritPlan = await downloadRuntimeDependency({ userDataPath, targetId: "gerrit", dryRun: true });
assert.equal(gerritPlan.ok, true);
assertRuntimeStatuses(gerritPlan, "gerrit");
assert.equal(gerritPlan.startupDownloads, false);

const gatewayPlan = await downloadRuntimeDependency({ userDataPath, targetId: "caddy", dryRun: true });
assert.equal(gatewayPlan.ok, true);
assertRuntimeStatuses(gatewayPlan, "caddy");

const languagePlan = await downloadRuntimeDependency({ userDataPath, targetId: "programming-runtimes", dryRun: true });
assert.equal(languagePlan.ok, true);
assert.ok(Array.isArray(languagePlan.results), "programming-runtimes should plan child runtimes");
assert.equal(languagePlan.startupDownloads, false);
assertRuntimeStatuses(languagePlan, "programming-runtimes");

const cloudPlan = await downloadRuntimeDependency({ userDataPath, targetId: "cloud-drives", dryRun: true });
assertRuntimeStatuses(cloudPlan, "cloud-drives");

const knowledgeAggregatePlan = await downloadRuntimeDependency({ userDataPath, targetId: "knowledge-backends", dryRun: true });
assertRuntimeStatuses(knowledgeAggregatePlan, "knowledge-backends");
assert.equal(Array.isArray(knowledgeAggregatePlan.results), true, "legacy knowledge-backends target should plan child providers");

const backgroundPlan = await downloadRuntimeDependency({ userDataPath, targetId: "caddy", dryRun: true, async: true });
assert.equal(backgroundPlan.ok, true);
assert.ok(backgroundPlan.runId, "background runtime dependency download should return a run id");
for (let attempt = 0; attempt < 20; attempt += 1) {
  const runs = listRuntimeDependencyDownloadRuns().downloads || [];
  const run = runs.find((item) => item.runId === backgroundPlan.runId);
  if (run && run.status !== "queued" && run.status !== "running") {
    assert.equal(["present", "installed"].includes(run.status), true);
    assert.ok((run.log || []).length > 0, "background runtime dependency download should expose log entries");
    assert.ok((run.steps || []).length >= 4, "background runtime dependency download should expose planned steps");
    assert.equal(run.totalSteps, run.steps.length, "background runtime dependency download should expose total steps");
    assert.equal(run.progressPercent, 100, "completed background runtime dependency download should reach 100%");
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 25));
  if (attempt === 19) {
    assert.fail("background runtime dependency dry run did not complete");
  }
}

console.log("[verify-runtime-dependency-downloads] ok");
