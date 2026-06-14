#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  createCompositionDehydrationPlan,
  loadCompositionPresets,
  writeCompositionPlanArtifacts
} from "../platform/common/composition-management/index.mjs";
import {
  compositionPresetFromExternalServiceConfig,
  loadExternalServiceConfig,
  writeExternalServiceArtifacts
} from "../platform/common/composition-management/external-service-adapter.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "../..");

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
    "  node server/scripts/composition-presets.mjs list",
    "  node server/scripts/composition-presets.mjs verify [--preset ID]",
    "  node server/scripts/composition-presets.mjs dehydrate [--preset ID] [--skip-ui-build] [--no-source-trim]",
    "  node server/scripts/composition-presets.mjs docker-verify [--preset ID] [--skip-ui-build] [--no-source-trim] [--port-base 18880]",
    "  node server/scripts/composition-presets.mjs regression [--preset ID] [--skip-ui-build] [--port-base 18880]",
    "  node server/scripts/composition-presets.mjs regression --external-service-config service.json",
    "",
    "Commands:",
    "  list           List composition presets.",
    "  verify         Validate preset feature IDs, operations, paths, and dehydration operation coverage.",
    "  dehydrate      Generate physically trimmed source package, feature profile, Dockerfile, compose.yaml, and reports.",
    "  docker-verify  Build each generated Docker image, run it, and require /api/healthz to pass.",
    "  regression     Run each generated source package's own regression script, then Docker verify it."
  ].join("\n");
}

function splitList(value = "") {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

async function selectPresets(args = {}) {
  if (args["external-service-config"]) {
    const loaded = await loadExternalServiceConfig(String(args["external-service-config"]), { cwd: REPO_ROOT });
    const preset = compositionPresetFromExternalServiceConfig(loaded.config, {
      filePath: loaded.filePath,
      outputRoot: args["output-root"] ? String(args["output-root"]) : ""
    });
    return [{ preset, filePath: loaded.filePath }];
  }
  const loaded = await loadCompositionPresets({ cwd: REPO_ROOT });
  const selectedIds = new Set(splitList(args.preset || args.presets));
  return loaded.filter(({ preset }) => selectedIds.size === 0 || selectedIds.has(preset.presetId));
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
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

function runCapture(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || REPO_ROOT,
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

function dockerfileForPlan(plan) {
  const featureEdition = plan.featureProfile?.edition || "custom";
  const command = plan.externalService?.startupPolicy === "with-platform"
    ? [
        "node",
        "server/scripts/start-composition-service.mjs",
        "--host",
        "0.0.0.0",
        "--allow-public-console",
        "--profile",
        plan.docker.runtimeProfile || "minimal",
        "--port",
        String(plan.docker.servicePort),
        "--data-dir",
        "/data",
        "--edition",
        featureEdition,
        "--feature-profile",
        "/app/feature-profile/feature-profile.json"
      ]
    : [
        "node",
        "server/scripts/start-server.mjs",
        "--with-ui",
        "--host",
        "0.0.0.0",
        "--allow-public-console",
        "--profile",
        plan.docker.runtimeProfile || "minimal",
        "--port",
        String(plan.docker.servicePort),
        "--data-dir",
        "/data",
        "--edition",
        featureEdition,
        "--feature-profile",
        "/app/feature-profile/feature-profile.json"
      ];
  return [
    "FROM node:24-bookworm-slim AS deps",
    "WORKDIR /app",
    "RUN apt-get update \\",
    "    && apt-get install -y --no-install-recommends python3 make g++ \\",
    "    && rm -rf /var/lib/apt/lists/*",
    "COPY package.json ./",
    "RUN npm install --omit=dev --no-audit --no-fund",
    "",
    "FROM node:24-bookworm-slim AS runtime",
    "ENV NODE_ENV=production \\",
    "    PACT_SERVER_HOST=0.0.0.0 \\",
    `    PACT_SERVER_PORT=${plan.docker.servicePort} \\`,
    "    PACT_SERVER_DATA_DIR=/data \\",
    "    PACT_SERVER_WITH_UI=1 \\",
    "    PACT_ALLOW_PUBLIC_CONSOLE=1 \\",
    `    PACT_SERVER_PROFILE=${plan.docker.runtimeProfile || "minimal"} \\`,
    `    PACT_FEATURE_EDITION=${featureEdition} \\`,
    "    PACT_FEATURE_PROFILE=/app/feature-profile/feature-profile.json \\",
    "    CODEX_HOME=/codex-home",
    "WORKDIR /app",
    "COPY --from=deps /app/node_modules ./node_modules",
    "COPY . .",
    "RUN mkdir -p /data /codex-home",
    `EXPOSE ${plan.docker.servicePort}`,
    `HEALTHCHECK --interval=10s --timeout=5s --retries=12 CMD node -e "fetch('http://127.0.0.1:${plan.docker.servicePort}${plan.docker.healthPath}').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"`,
    `CMD ${JSON.stringify(command)}`,
    ""
  ].join("\n");
}

function composeForPlan(plan) {
  const serviceName = `pact-${plan.presetId}`.replace(/[^a-zA-Z0-9_-]/g, "-");
  const featureEdition = plan.featureProfile?.edition || "custom";
  return [
    "services:",
    `  ${serviceName}:`,
    "    build:",
    "      context: .",
    "      dockerfile: Dockerfile",
    `    image: ${plan.docker.imageTag}`,
    "    environment:",
    "      PACT_SERVER_HOST: 0.0.0.0",
    `      PACT_SERVER_PORT: \"${plan.docker.servicePort}\"`,
    "      PACT_SERVER_DATA_DIR: /data",
    "      PACT_SERVER_WITH_UI: \"1\"",
    "      PACT_ALLOW_PUBLIC_CONSOLE: \"1\"",
    `      PACT_SERVER_PROFILE: ${plan.docker.runtimeProfile || "minimal"}`,
    `      PACT_FEATURE_EDITION: ${featureEdition}`,
    "      PACT_FEATURE_PROFILE: /app/feature-profile/feature-profile.json",
    "    ports:",
    `      - \"127.0.0.1:\${PACT_COMPOSITION_PORT:-${plan.docker.servicePort}}:${plan.docker.servicePort}\"`,
    "    volumes:",
    "      - pact-data:/data",
    "    healthcheck:",
    `      test: [\"CMD\", \"node\", \"-e\", \"fetch('http://127.0.0.1:${plan.docker.servicePort}${plan.docker.healthPath}').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\"]`,
    "      interval: 10s",
    "      timeout: 5s",
    "      retries: 12",
    "volumes:",
    "  pact-data:",
    ""
  ].join("\n");
}

async function writeDockerArtifacts(plan) {
  await fs.writeFile(path.join(plan.sourceRoot, "Dockerfile"), dockerfileForPlan(plan), "utf8");
  await fs.writeFile(path.join(plan.sourceRoot, "compose.yaml"), composeForPlan(plan), "utf8");
  await fs.writeFile(
    path.join(plan.sourceRoot, ".dockerignore"),
    ["node_modules/", "data/", ".pact-server-data/", "*.log", ""].join("\n"),
    "utf8"
  );
  await fs.writeFile(
    path.join(plan.sourceRoot, "README_COMPOSITION.md"),
    [
      `# ${plan.displayName}`,
      "",
      `Preset: \`${plan.presetId}\``,
      "",
      "## Run With Docker",
      "",
      "```bash",
      "docker compose up --build",
      "```",
      "",
      "## Verify",
      "",
      "```bash",
      "npm run composition:regression",
      "```",
      "",
      "## Run Health Check",
      "",
      "```bash",
      `node -e \"fetch('http://127.0.0.1:${plan.docker.servicePort}${plan.docker.healthPath}').then(async r=>{console.log(r.status, await r.text())})\"`,
      "```",
      ""
    ].join("\n"),
    "utf8"
  );
}

async function dehydratePreset({ preset, filePath, args }) {
  const plan = await createCompositionDehydrationPlan({ preset, filePath, cwd: REPO_ROOT });
  await writeCompositionPlanArtifacts({ plan, preset });
  if (!plan.ok) {
    return { plan, sourceGenerated: false };
  }

  const createArgs = [
    "server/scripts/create-minimal-server-source.mjs",
    "--output",
    plan.sourceRoot,
    "--force",
    "--feature-profile",
    path.join(plan.outputRoot, "feature-profile", "feature-profile.json"),
    "--no-verify"
  ];
  const skipUiBuild = args["skip-ui-build"] || await fileExists(path.join(REPO_ROOT, "build", "dist", "index.html"));
  if (skipUiBuild) {
    createArgs.push("--skip-ui-build");
  }
  if (args["no-source-trim"] === true) {
    createArgs.push("--no-source-trim");
  }
  await run(process.execPath, createArgs);
  const externalServiceArtifacts = await writeExternalServiceArtifacts({
    config: plan.externalService,
    sourceRoot: plan.sourceRoot,
    outputRoot: plan.outputRoot,
    cwd: REPO_ROOT
  });
  await writeCompositionPlanArtifacts({ plan, preset });
  await writeDockerArtifacts(plan);
  return { plan, sourceGenerated: true, externalServiceArtifacts };
}

function parseJsonObjectOutput(stdout = "") {
  const text = String(stdout || "").trim();
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(text.slice(start, end + 1));
    }
    throw new Error(`Unable to parse JSON output: ${text.slice(0, 500)}`);
  }
}

async function runSourcePackageRegression(plan) {
  const result = await runCapture("npm", ["run", "composition:regression", "--silent"], {
    cwd: plan.sourceRoot
  });
  return {
    ok: true,
    presetId: plan.presetId,
    sourceRoot: plan.sourceRoot,
    result: parseJsonObjectOutput(result.stdout)
  };
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function getFreePort(preferredPort) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", () => {
      const fallback = net.createServer();
      fallback.once("error", reject);
      fallback.listen(0, "127.0.0.1", () => {
        const address = fallback.address();
        fallback.close(() => resolve(address.port));
      });
    });
    server.listen(preferredPort, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function waitForHealth({ url, timeoutMs = 90000 }) {
  const startedAt = Date.now();
  let lastError = "";
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      const text = await response.text();
      if (response.ok) {
        return { ok: true, status: response.status, body: text };
      }
      lastError = `${response.status} ${text}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return { ok: false, error: lastError };
}

async function dockerVerifyPlan(plan, { portBase = 18880, keepContainer = false } = {}) {
  const hostPort = await getFreePort(portBase);
  const containerName = `${plan.docker.containerName}-${hostPort}`.replace(/[^a-zA-Z0-9_.-]/g, "-");
  await run("docker", ["build", "-t", plan.docker.imageTag, "."], { cwd: plan.sourceRoot });
  let containerId = "";
  try {
    const runResult = await runCapture("docker", [
      "run",
      "-d",
      "--name",
      containerName,
      "-p",
      `127.0.0.1:${hostPort}:${plan.docker.servicePort}`,
      plan.docker.imageTag
    ]);
    containerId = runResult.stdout.trim();
    const healthUrl = `http://127.0.0.1:${hostPort}${plan.docker.healthPath}`;
    const health = await waitForHealth({ url: healthUrl });
    if (!health.ok) {
      const logs = await runCapture("docker", ["logs", containerName]).catch((error) => ({
        stdout: error.stdout || "",
        stderr: error.stderr || ""
      }));
      throw new Error(`Docker health check failed for ${plan.presetId}: ${health.error}\n${logs.stdout}\n${logs.stderr}`);
    }
    return {
      ok: true,
      presetId: plan.presetId,
      imageTag: plan.docker.imageTag,
      containerName,
      containerId,
      healthUrl,
      health
    };
  } finally {
    if (!keepContainer && containerId) {
      await run("docker", ["rm", "-f", containerName]).catch(() => {});
    }
  }
}

async function createPlans(selected) {
  return Promise.all(
    selected.map(async ({ preset, filePath }) => createCompositionDehydrationPlan({ preset, filePath, cwd: REPO_ROOT }))
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0] || "verify";
  if (args.help || args.h) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const selected = await selectPresets(args);
  if (selected.length === 0) {
    throw new Error("No composition presets selected.");
  }

  if (command === "list") {
    printJson({
      presets: selected.map(({ preset, filePath }) => ({
        presetId: preset.presetId,
        displayName: preset.displayName,
        outputRoot: preset.deploymentTarget?.outputRoot || "",
        filePath: path.relative(REPO_ROOT, filePath)
      }))
    });
    return;
  }

  if (command === "verify") {
    const plans = await createPlans(selected);
    printJson({
      ok: plans.every((plan) => plan.ok),
      presets: plans.map((plan) => ({
        presetId: plan.presetId,
        ok: plan.ok,
        activeFeatureCount: plan.featureRuntime?.activeFeatureIds?.length || 0,
        requiredOperationCount: plan.operationCoverage?.length || 0,
        inactiveRequiredOperations: plan.inactiveRequiredOperations || [],
        errors: plan.validation?.errors || [],
        warnings: plan.validation?.warnings || []
      }))
    });
    if (!plans.every((plan) => plan.ok)) {
      process.exit(1);
    }
    return;
  }

  if (command === "dehydrate" || command === "docker-verify" || command === "regression") {
    const dehydrated = [];
    for (const item of selected) {
      dehydrated.push(await dehydratePreset({ ...item, args }));
    }
    const packageRegressionResults = [];
    if (command === "regression") {
      for (const item of dehydrated) {
        if (!item.plan.ok) {
          packageRegressionResults.push({ ok: false, presetId: item.plan.presetId, error: "dehydration plan is not ok" });
          continue;
        }
        packageRegressionResults.push(await runSourcePackageRegression(item.plan));
      }
    }
    const dockerResults = [];
    if (command === "docker-verify" || command === "regression") {
      const portBase = Number(args["port-base"] || 18880);
      for (let index = 0; index < dehydrated.length; index += 1) {
        const item = dehydrated[index];
        if (!item.plan.ok) {
          dockerResults.push({ ok: false, presetId: item.plan.presetId, error: "dehydration plan is not ok" });
          continue;
        }
        dockerResults.push(await dockerVerifyPlan(item.plan, {
          portBase: portBase + index,
          keepContainer: args["keep-container"] === true
        }));
      }
    }
    printJson({
      ok:
        dehydrated.every((item) => item.plan.ok) &&
        packageRegressionResults.every((item) => item.ok !== false) &&
        dockerResults.every((item) => item.ok !== false),
      presets: dehydrated.map((item) => ({
        presetId: item.plan.presetId,
        ok: item.plan.ok,
        outputRoot: item.plan.outputRoot,
        sourceRoot: item.plan.sourceRoot,
        dockerImageTag: item.plan.docker.imageTag,
        sourceGenerated: item.sourceGenerated,
        externalService: item.plan.externalService
          ? {
              serviceId: item.plan.externalService.serviceId,
              startupPolicy: item.plan.externalService.startupPolicy,
              mode: item.plan.externalService.mode
            }
          : null
      })),
      packageRegression: packageRegressionResults,
      docker: dockerResults
    });
    if (
      !dehydrated.every((item) => item.plan.ok) ||
      packageRegressionResults.some((item) => item.ok === false) ||
      dockerResults.some((item) => item.ok === false)
    ) {
      process.exit(1);
    }
    return;
  }

  throw new Error(`Unknown composition preset command: ${command}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
