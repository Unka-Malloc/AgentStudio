#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  downloadRuntimeDependency,
  listRuntimeDependencyDownloadRuns,
  listRuntimeDependencies,
  RUNTIME_DEPENDENCIES_PROTOCOL_VERSION,
  updateRuntimeDependencyConfiguration
} from "../platform/specialized/capabilities/runtime-dependencies/index.mjs";
import { knowledgeBackendConfigPath } from "../platform/specialized/knowledge/storage/knowledge-backend-port/index.mjs";

const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-runtime-dependencies-"));
const knowledgeBackendsPath = knowledgeBackendConfigPath(userDataPath);
await fs.mkdir(path.dirname(knowledgeBackendsPath), { recursive: true });
await fs.writeFile(knowledgeBackendsPath, `${JSON.stringify({
  schemaVersion: 1,
  providers: {
    dify: {
      provider: "dify",
      enabled: true,
      mode: "contract",
      secretRef: "secret://pact/knowledge/dify-api-key",
      endpointRef: "config://pact/knowledge/dify-endpoint"
    },
    ragflow: {
      provider: "ragflow",
      enabled: true,
      mode: "contract",
      secretRef: "secret://pact/knowledge/ragflow-api-key",
      endpointRef: "config://pact/knowledge/ragflow-endpoint"
    }
  }
}, null, 2)}\n`, "utf8");

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

function assertRuntimePathSourceLabels(dependencies = [], label = "dependencies") {
  for (const item of dependencies) {
    const source = item.detection?.source;
    if (item.children?.length) {
      assertRuntimePathSourceLabels(item.children, `${label}.${item.id}.children`);
      continue;
    }
    if (source?.kind === "system-path") {
      assert.equal(
        source.label,
        "环境变量: PATH",
        `${label}.${item.id} should label PATH-detected runtimes as 环境变量: PATH`,
      );
    }
  }
}

function assertRuntimeConfiguration(dependencies = [], label = "dependencies") {
  for (const item of dependencies) {
    if (item.children?.length) {
      assertRuntimeConfiguration(item.children, `${label}.${item.id}.children`);
      continue;
    }
    assert.ok(Array.isArray(item.configuration), `${label}.${item.id} should expose configuration groups`);
    assert.ok(item.configuration.length > 0, `${label}.${item.id} should expose at least one configuration group`);
    for (const group of item.configuration) {
      assert.ok(group.title, `${label}.${item.id} configuration group should expose a title`);
      assert.ok(Array.isArray(group.entries), `${label}.${item.id}.${group.title} should expose entries`);
      assert.ok(group.entries.length > 0, `${label}.${item.id}.${group.title} should not be empty`);
      for (const entry of group.entries) {
        assert.ok(entry.key, `${label}.${item.id}.${group.title} entry should expose key`);
        assert.ok(entry.label, `${label}.${item.id}.${group.title}.${entry.key} should expose label`);
        assert.equal(typeof entry.value, "string", `${label}.${item.id}.${group.title}.${entry.key} should expose string value`);
        if (group.kind === "source") {
          assert.equal(entry.editable, true, `${label}.${item.id}.${group.title}.${entry.key} source entries should be editable`);
          assert.ok(entry.inputType, `${label}.${item.id}.${group.title}.${entry.key} source entries should expose an input type`);
        }
      }
    }
  }
}

assertRuntimeStatuses(list, "list");
assertRuntimeSources(list.dependencies || []);
assertRuntimePathSourceLabels(list.dependencies || []);
assertRuntimeConfiguration(list.dependencies || []);
for (const id of ["jre", "python", "node"]) {
  const dependency = (list.dependencies || []).find((item) => item.id === id);
  const detection = dependency?.detection || {};
  const version = detection.javaVersion || detection.pythonVersion || detection.version || "";
  assert.ok(version, `${id} should expose the detected runtime version`);
  assert.equal(
    typeof version,
    "string",
    `${id} runtime version should come from detection/configuration data, not UI copy`,
  );
  assert.equal(
    version.includes("现在使用的版本"),
    false,
    `${id} runtime version should not include UI prefix copy`,
  );
}
for (const id of ["dify", "rag-flow"]) {
  const dependency = (list.dependencies || []).find((item) => item.id === id);
  assert.equal(
    dependency?.present,
    false,
    `${id} default contract placeholder should not be reported as installed/present`,
  );
  assert.equal(
    dependency?.status,
    "failed",
    `${id} default contract placeholder should be reported as unavailable`,
  );
}
const cloudDependency = (list.dependencies || []).find((item) => item.id === "cloud-drives");
if (process.platform === "darwin" && cloudDependency?.detection?.icloudAvailable === true) {
  assert.equal(
    typeof cloudDependency.detection.availabilityLabel,
    "string",
    "iCloud detection should expose a system-backed availability label",
  );
  assert.match(
    cloudDependency.detection.availabilityLabel,
    /iCloud Drive · macOS/,
    "iCloud detection should report that iCloud Drive follows the macOS system version",
  );
  assert.equal(
    cloudDependency.detection.availabilityLabel.includes("未检测到"),
    false,
    "available iCloud Drive must not render as 未检测到",
  );
}
const gerritDependency = (list.dependencies || []).find((item) => item.id === "gerrit");
assert.equal(
  gerritDependency?.detection?.root,
  path.join(list.cacheRoot, "gerrit"),
  "Gerrit default cache root should live under the runtime dependency cache root",
);
assert.equal(
  gerritDependency?.detection?.warPath,
  path.join(list.cacheRoot, "gerrit", "downloads", "gerrit-3.14.0.war"),
  "Gerrit WAR cache path should live under the server data dir runtime cache",
);
for (const [id, requiredKinds] of Object.entries({
  jre: ["env", "source", "argument"],
  python: ["env", "source", "argument"],
  caddy: ["env", "source", "argument"],
  nginx: ["env", "source", "argument"],
  gerrit: ["env", "source", "argument"]
})) {
  const dependency = (list.dependencies || []).find((item) => item.id === id);
  const kinds = new Set((dependency?.configuration || []).map((group) => group.kind));
  for (const kind of requiredKinds) {
    assert.ok(kinds.has(kind), `${id} should expose ${kind} configuration`);
  }
}

const configUpdate = await updateRuntimeDependencyConfiguration({
  userDataPath,
  targetId: "gerrit",
  entries: [
    { key: "sources.gerrit.version", value: "3.14.1" },
    { key: "sources.gerrit.warUrl", value: "https://example.invalid/gerrit-war-3.14.1.war" }
  ]
});
assert.equal(configUpdate.ok, true, "runtime dependency source configuration update should succeed");
assert.equal(configUpdate.updated, 2, "runtime dependency source configuration update should report changed fields");
const updatedSourceConfig = JSON.parse(await fs.readFile(list.sourceConfigPath, "utf8"));
assert.equal(updatedSourceConfig.sources.gerrit.version, "3.14.1");
assert.equal(updatedSourceConfig.sources.gerrit.default.warUrl, "https://example.invalid/gerrit-war-3.14.1.war");

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

// ── Dockerfile strict checksum verification ────────────────────────────

console.log("\n[verify-runtime-dependency-downloads] Docker strict checksum checks...");

const dockerfilePath = path.join(
  fileURLToPath(new URL("../..", import.meta.url)),
  "Dockerfile"
);
const dockerfileContent = readFileSync(dockerfilePath, "utf8");

assert.ok(
  dockerfileContent.includes("REQUIRE_RUNTIME_CHECKSUMS"),
  "Dockerfile must contain REQUIRE_RUNTIME_CHECKSUMS ARG"
);
assert.ok(
  dockerfileContent.includes("JRE_SHA256"),
  "Dockerfile must contain JRE_SHA256 ARG"
);
assert.ok(
  dockerfileContent.includes("TIKA_SHA256"),
  "Dockerfile must contain TIKA_SHA256 ARG"
);

// Negative: strict mode without JRE_SHA256 must fail (exit 1)
const hasJreFailPath = dockerfileContent.includes(
  'REQUIRE_RUNTIME_CHECKSUMS=1 but JRE_SHA256 is empty'
);
assert.ok(hasJreFailPath, "Dockerfile must fail with empty JRE_SHA256 in strict mode");

// Negative: strict mode without TIKA_SHA256 must fail (exit 1)
const hasTikaFailPath = dockerfileContent.includes(
  'REQUIRE_RUNTIME_CHECKSUMS=1 but TIKA_SHA256 is empty'
);
assert.ok(hasTikaFailPath, "Dockerfile must fail with empty TIKA_SHA256 in strict mode");

// Assert sha256sum verification path exists
assert.ok(
  dockerfileContent.includes("sha256sum -c"),
  "Dockerfile must include sha256sum verification for checksum-verified downloads"
);

console.log("[verify-runtime-dependency-downloads] Docker strict checksum checks passed.");

// ── Docker strict negative build test ─────────────────────────────────

console.log("\n[verify-runtime-dependency-downloads] Docker strict negative build test...");

// Check if docker is available
const dockerCheck = spawnSync("docker", ["--version"], {
  stdio: ["ignore", "pipe", "ignore"],
  timeout: 10_000
});

if (dockerCheck.status !== 0) {
  console.log("[verify-runtime-dependency-downloads] Docker not available — strict negative build skipped (not a failure).");
} else {
  const dockerResult = spawnSync("docker", [
    "build",
    "--target", "runtime-deps",
    "--build-arg", "REQUIRE_RUNTIME_CHECKSUMS=1",
    "-t", "pact-runtime-deps-strict-negative",
    "."
  ], {
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 120_000
  });

  const stderr = dockerResult.stderr?.toString() || "";
  const stdout = dockerResult.stdout?.toString() || "";
  const combined = `${stdout}\n${stderr}`;

  if (dockerResult.status !== 0) {
    // Expected failure: build must fail when JRE_SHA256 or TIKA_SHA256 is empty
    const hasExpectedError = combined.includes("JRE_SHA256 is empty") || combined.includes("TIKA_SHA256 is empty");
    assert.ok(
      hasExpectedError,
      `Docker strict negative build failed as expected but missing expected error message. Output: ${combined.slice(0, 500)}`
    );
    console.log("[verify-runtime-dependency-downloads] Docker strict negative build failed as expected (strict check working).");
    console.log("[verify-runtime-dependency-downloads] Docker strict negative build test passed.");
  } else {
    // Unexpected success: strict mode should have failed without checksums
    assert.fail("Docker strict negative build succeeded unexpectedly. REQUIRE_RUNTIME_CHECKSUMS=1 should fail when checksums are not provided.");
  }
}

console.log("[verify-runtime-dependency-downloads] ok");
