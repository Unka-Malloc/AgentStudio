#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  FEATURE_MANIFEST,
  buildClientPackagingConfig,
  collectPackagePlan,
  diffFeaturePlans,
  filterOperationsForFeatures,
  resolveFeatureRuntime,
  validateFeatureManifest,
  writeFeaturePlanArtifacts
} from "../platform/interactive/features/feature-manifest.mjs";
import { SERVER_API_OPERATIONS } from "../platform/common/operation-dispatcher/operation-registry.mjs";
import { createToolCatalog } from "../platform/specialized/capabilities/tools/tool-management-core/catalog.mjs";
import { applyFeatureSourcePlan } from "./pack-offline-server.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "../..");
const DEFAULT_OUTPUT_ROOT = path.join(REPO_ROOT, "build/feature-profiles");
const CLIENT_MODULE_CONFIG_PATH = path.join(REPO_ROOT, "client-gui/packaging.modules.json");
const LEGACY_CLIENT_MODULE_IDS = [
  "client-daemon",
  "local-rpc",
  "file-system-adapter",
  "server-bridge",
  "upload-queue",
  "checkpoint-upload",
  "knowledge-mirror",
  "data-connectors",
  "gmail-connector",
  "outlook-mail-connector",
  "google-drive-connector",
  "onedrive-connector",
  "slack-connector",
  "teams-connector",
  "knowledge-agent",
  "agent-registry",
  "expert-vocabulary",
  "mail-index",
  "macos-mail-import",
  "knowledge-graph-ui",
  "server.FileProcessor",
  "server.KnowledgeCore",
  "server.EmbeddingRuntime",
  "server.VectorStore",
  "server.AgentGateway",
  "server.LearningRuntime",
  "server.MaintenanceAgent"
];
const LEGACY_PORTABLE_DIR_PREFIXES = [
  "backend",
  "logs",
  "exports",
  "mail-imports",
  "knowledge",
  "connectors/",
  "chat-index"
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

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function resolvePlan(args = {}) {
  const profile = args["feature-profile"] ? await readJson(path.resolve(String(args["feature-profile"]))) : {};
  const featureRuntime = resolveFeatureRuntime({
    edition: args.edition || "enterprise",
    profile,
    enableFeatures: args.features,
    disableFeatures: args["without-features"]
  });
  const baseClientConfig = await readJson(CLIENT_MODULE_CONFIG_PATH);
  const clientPackagingConfig = buildClientPackagingConfig(baseClientConfig, featureRuntime);
  const packagePlan = collectPackagePlan(featureRuntime);
  const activeOperations = filterOperationsForFeatures(SERVER_API_OPERATIONS, featureRuntime);
  return {
    featureRuntime,
    packagePlan: {
      ...packagePlan,
      operations: {
        total: SERVER_API_OPERATIONS.length,
        active: activeOperations.map((operation) => ({
          id: operation.id,
          featureId: operation.featureId,
          rpc: operation.rpc || null,
          cli: operation.cli || null,
          http: operation.http || null
        })),
        disabled: filterOperationsForFeatures(SERVER_API_OPERATIONS, {
          activeFeatureIds: featureRuntime.disabledFeatureIds
        }).map((operation) => ({
          id: operation.id,
          featureId: operation.featureId
        }))
      }
    },
    clientPackagingConfig,
    baseClientConfig,
    activeOperations
  };
}

function outputDirFor(args = {}, edition = "enterprise") {
  return path.resolve(String(args.output || args.out || path.join(DEFAULT_OUTPUT_ROOT, edition)));
}

function assertCondition(condition, message, failures) {
  if (!condition) {
    failures.push(message);
  }
}

function runBusinessChecks({ featureRuntime, activeOperations, clientPackagingConfig }) {
  const failures = [];
  const activeOperationIds = new Set(activeOperations.map((operation) => operation.id));
  const catalog = createToolCatalog({
    operations: activeOperations,
    activeFeatureIds: featureRuntime.activeFeatureIds
  });
  const toolIds = new Set(catalog.tools.map((tool) => tool.id));
  const clientModules = clientPackagingConfig.modules || {};
  const portableDirs = clientModules["portable-data"]?.portableDirectories || [];

  for (const moduleId of LEGACY_CLIENT_MODULE_IDS) {
    assertCondition(clientModules[moduleId]?.enabled !== true, `future client package must not enable legacy module ${moduleId}`, failures);
  }
  assertCondition(
    !portableDirs.some((directory) => {
      const value = String(directory);
      return LEGACY_PORTABLE_DIR_PREFIXES.some((prefix) => value === prefix || value.startsWith(prefix));
    }),
    "future client portable data must not create legacy backend, connector, mail, knowledge, export, log, or chat-index directories",
    failures
  );

  if (featureRuntime.edition === "community") {
    assertCondition(activeOperationIds.has("knowledge.search"), "community must keep Agent Library core search", failures);
    assertCondition(!activeOperationIds.has("knowledge.playbooks.list"), "community must not expose optional AgentLibrary Playbooks", failures);
    assertCondition(!activeOperationIds.has("workspace.skill.upload"), "community must not expose Skill Hub workspace skill facade", failures);
    assertCondition(!activeOperationIds.has("knowledge.agent_explore.runs.create"), "community must not expose agent exploration operations", failures);
    assertCondition(!activeOperationIds.has("knowledge.summarization.runs.create"), "community must not expose summarization operations", failures);
    assertCondition(!activeOperationIds.has("knowledge.evolution.runs.create"), "community must not expose knowledge evolution RPC/HTTP/CLI operations", failures);
    assertCondition(!activeOperationIds.has("knowledge.hierarchy.audit"), "community must not expose outline reasoning operations", failures);
    assertCondition(!activeOperationIds.has("external.knowledge.distillation.runs.create"), "community must not expose external distillation proxy operations", failures);
    assertCondition(!activeOperationIds.has("maintenance_agent.runs.create"), "community must not expose maintenance agent runbooks", failures);
    assertCondition(!toolIds.has("pact.agentLibrary.playbooks.list"), "community tool catalog must not expose optional Playbook tool", failures);
    assertCondition(!toolIds.has("pact.agentLibrary.evolution.runs.create"), "community tool catalog must not expose knowledge evolution tool", failures);
    assertCondition(!toolIds.has("pact.capabilityPackages.list"), "community tool catalog must not expose Skill Hub package tools", failures);
    assertCondition(clientModules["gmail-connector"]?.enabled !== true, "community client package must not enable Gmail connector", failures);
    assertCondition(clientModules["slack-connector"]?.enabled !== true, "community client package must not enable Slack connector", failures);
  }

  if (featureRuntime.edition === "pro") {
    assertCondition(activeOperationIds.has("knowledge.playbooks.list"), "pro must expose optional AgentLibrary Playbooks", failures);
    assertCondition(activeOperationIds.has("external.knowledge.distillation.runs.create"), "pro must expose external distillation proxy operations", failures);
    assertCondition(activeOperationIds.has("knowledge.agent_explore.runs.create"), "pro must expose agent exploration operations", failures);
    assertCondition(!activeOperationIds.has("knowledge.evolution.runs.create"), "pro must keep knowledge evolution independently disabled", failures);
    assertCondition(!activeOperationIds.has("knowledge.summarization.runs.create"), "pro must keep summarization independently disabled", failures);
    assertCondition(!activeOperationIds.has("knowledge.hierarchy.audit"), "pro must keep outline reasoning independently disabled", failures);
  }

  if (featureRuntime.edition === "enterprise") {
    assertCondition(activeOperationIds.has("knowledge.playbooks.list"), "enterprise must expose optional AgentLibrary Playbooks", failures);
    assertCondition(activeOperationIds.has("knowledge.summarization.runs.create"), "enterprise must expose summarization operations", failures);
    assertCondition(activeOperationIds.has("knowledge.evolution.runs.create"), "enterprise must expose knowledge evolution operations", failures);
    assertCondition(activeOperationIds.has("knowledge.hierarchy.audit"), "enterprise must expose outline reasoning operations", failures);
    assertCondition(activeOperationIds.has("external.knowledge.distillation.runs.create"), "enterprise must expose external distillation proxy operations", failures);
    assertCondition(activeOperationIds.has("workspace.skill.upload"), "enterprise must expose Skill Hub facade operations", failures);
    assertCondition(activeOperationIds.has("maintenance_agent.runs.create"), "enterprise must expose maintenance agent runbooks", failures);
  }

  if (featureRuntime.edition === "client-local") {
    assertCondition(activeOperationIds.has("sharedspace.localDir.connect"), "client-local must expose local directory connect", failures);
    assertCondition(activeOperationIds.has("sharedspace.file.read"), "client-local must expose sharedspace file read", failures);
    assertCondition(activeOperationIds.has("external.cloudDrive.connect"), "client-local must expose cloud drive local projection connect", failures);
    assertCondition(activeOperationIds.has("tool_management.catalog"), "client-local must expose Tool Management catalog for MCP", failures);
    assertCondition(!featureRuntime.activeFeatureIds.includes("knowledge-core"), "client-local must not include knowledge-core", failures);
    assertCondition(!featureRuntime.activeFeatureIds.includes("skill-hub"), "client-local must not include Skill Hub", failures);
    assertCondition(!featureRuntime.activeFeatureIds.includes("agentlibrary-playbooks"), "client-local must not include AgentLibrary Playbooks", failures);
    assertCondition(!featureRuntime.activeFeatureIds.includes("agent-exploration"), "client-local must not include agent exploration", failures);
    assertCondition(!featureRuntime.activeFeatureIds.includes("knowledge-summarization"), "client-local must not include summarization", failures);
    assertCondition(!featureRuntime.activeFeatureIds.includes("knowledge-evolution"), "client-local must not include knowledge evolution", failures);
    assertCondition(!featureRuntime.activeFeatureIds.includes("knowledge-outline-reasoning"), "client-local must not include outline reasoning", failures);
    assertCondition(!featureRuntime.activeFeatureIds.includes("external-knowledge-distillation"), "client-local must not include external distillation", failures);
    assertCondition(!featureRuntime.activeFeatureIds.includes("agent-gateway"), "client-local must not include agent-gateway", failures);
    assertCondition(!featureRuntime.activeFeatureIds.includes("client-runtime-core"), "client-local must not include client-runtime-core", failures);
    assertCondition(!featureRuntime.activeFeatureIds.includes("agent-memory"), "client-local must not include agent-memory", failures);
    assertCondition(!activeOperationIds.has("knowledge.search"), "client-local must not expose knowledge search", failures);
    assertCondition(!activeOperationIds.has("workspace.skill.upload"), "client-local must not expose Skill Hub operations", failures);
    assertCondition(!activeOperationIds.has("knowledge.playbooks.list"), "client-local must not expose Playbook operations", failures);
    assertCondition(!activeOperationIds.has("knowledge.agent_explore.runs.create"), "client-local must not expose agent exploration operations", failures);
    assertCondition(!activeOperationIds.has("knowledge.summarization.runs.create"), "client-local must not expose summarization operations", failures);
    assertCondition(!activeOperationIds.has("external.knowledge.distillation.runs.create"), "client-local must not expose external distillation operations", failures);
    assertCondition(!activeOperationIds.has("agent_gateway.invoke"), "client-local must not expose agent gateway operations", failures);
    assertCondition(clientModules["knowledge-agent"]?.enabled !== true, "client-local client package must not enable knowledge agent", failures);
  }

  return {
    ok: failures.length === 0,
    failures,
    toolCount: catalog.tools.length,
    activeOperationCount: activeOperations.length
  };
}

async function verifySourceLayout(plan) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), `pact-feature-source-${plan.featureRuntime.edition}-`));
  try {
    await fs.cp(path.join(REPO_ROOT, "server"), path.join(tempRoot, "server"), {
      recursive: true,
      filter: (source) => !path.basename(source).startsWith(".DS_Store")
    });
    const report = await applyFeatureSourcePlan(tempRoot, {
      featureProfile: {
        edition: plan.featureRuntime.edition,
        activeFeatureIds: plan.featureRuntime.activeFeatureIds,
        disabledFeatureIds: plan.featureRuntime.disabledFeatureIds
      },
      featurePackagePlan: plan.packagePlan
    });
    return {
      ok: report.ok,
      requestedPathCount: report.requestedPaths.length,
      appliedPathCount: report.applied.length,
      staticImportViolationCount: report.staticImportViolations.length
    };
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

async function createVerificationReport(plan) {
  const clientModulesForValidation = {
    ...(plan.baseClientConfig.modules || {})
  };
  for (const moduleId of LEGACY_CLIENT_MODULE_IDS) {
    clientModulesForValidation[moduleId] ||= {
      label: `Legacy compatibility module: ${moduleId}`,
      enabled: false,
      legacyCompatibility: true
    };
  }
  const validation = validateFeatureManifest({
    operations: SERVER_API_OPERATIONS,
    clientModules: clientModulesForValidation
  });
  const businessChecks = runBusinessChecks(plan);
  const sourceLayout = await verifySourceLayout(plan);
  return {
    ok: validation.ok && businessChecks.ok && sourceLayout.ok,
    generatedAt: new Date().toISOString(),
    manifest: {
      schemaVersion: FEATURE_MANIFEST.schemaVersion,
      featureCount: FEATURE_MANIFEST.features.length,
      editionCount: Object.keys(FEATURE_MANIFEST.editions).length
    },
    validation,
    businessChecks,
    sourceLayout
  };
}

async function writePlan(args, verificationReport = null) {
  const plan = await resolvePlan(args);
  const outputDir = outputDirFor(args, plan.featureRuntime.edition);
  const report = verificationReport || await createVerificationReport(plan);
  const written = await writeFeaturePlanArtifacts({
    outputDir,
    featureRuntime: plan.featureRuntime,
    packagePlan: plan.packagePlan,
    clientPackagingConfig: plan.clientPackagingConfig,
    verificationReport: report
  });
  return { ...plan, outputDir, written, verificationReport: report };
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function runNodeScript(scriptPath, args = []) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: REPO_ROOT,
    stdio: "inherit",
    env: process.env
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0] || "plan";

  if (command === "list") {
    printJson({
      editions: FEATURE_MANIFEST.editions,
      features: FEATURE_MANIFEST.features.map((feature) => ({
        featureId: feature.featureId,
        label: feature.label,
        group: feature.group,
        required: feature.required === true,
        dependsOn: feature.dependsOn || []
      }))
    });
    return;
  }

  if (command === "plan") {
    const result = await writePlan(args);
    printJson({
      ok: result.verificationReport.ok,
      edition: result.featureRuntime.edition,
      activeFeatureCount: result.featureRuntime.activeFeatureIds.length,
      disabledFeatureCount: result.featureRuntime.disabledFeatureIds.length,
      activeOperationCount: result.activeOperations.length,
      outputDir: result.outputDir,
      written: result.written
    });
    return;
  }

  if (command === "verify") {
    const result = await writePlan(args);
    printJson({
      ok: result.verificationReport.ok,
      edition: result.featureRuntime.edition,
      outputDir: result.outputDir,
      failures: result.verificationReport.businessChecks.failures
    });
    if (!result.verificationReport.ok) {
      process.exit(1);
    }
    return;
  }

  if (command === "client-config") {
    const result = await writePlan(args);
    printJson({
      ok: true,
      edition: result.featureRuntime.edition,
      configPath: path.join(result.outputDir, "client-packaging.modules.json")
    });
    return;
  }

  if (command === "build-client") {
    const result = await writePlan(args);
    const platformArgs = args.platform ? ["--platform", String(args.platform)] : [];
    const dryRunArgs = args["dry-run"] ? ["--dry-run"] : [];
    runNodeScript(path.join(REPO_ROOT, "client-gui/scripts/package-client.mjs"), [
      "--config",
      path.join(result.outputDir, "client-packaging.modules.json"),
      ...platformArgs,
      ...dryRunArgs
    ]);
    return;
  }

  if (command === "build-server") {
    await writePlan(args);
    const serverArgs = ["--edition", String(args.edition || "enterprise")];
    if (args.target) {
      serverArgs.push("--target", String(args.target));
    }
    if (args.output) {
      serverArgs.push("--output-dir", String(args.output));
    }
    if (args["no-verify-docker"]) {
      serverArgs.push("--no-verify-docker");
    }
    if (args["feature-profile"]) {
      serverArgs.push("--feature-profile", String(args["feature-profile"]));
    }
    runNodeScript(path.join(REPO_ROOT, "server/scripts/pack-offline-server.mjs"), serverArgs);
    return;
  }

  if (command === "diff") {
    const from = resolveFeatureRuntime({ edition: args.from || "community" });
    const to = resolveFeatureRuntime({ edition: args.to || "enterprise" });
    printJson(diffFeaturePlans(from, to));
    return;
  }

  throw new Error(`Unknown feature command: ${command}`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exit(1);
});
