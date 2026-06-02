import fs from "node:fs/promises";
import path from "node:path";

import {
  FEATURE_MANIFEST,
  collectPackagePlan,
  filterOperationsForFeatures,
  resolveFeatureRuntime
} from "../../interactive/features/feature-manifest.mjs";
import { SERVER_API_OPERATIONS } from "../operation-dispatcher/operation-registry.mjs";
import {
  externalServicePathRefs,
  normalizeExternalServiceConfig,
  validateExternalServiceConfig
} from "./external-service-adapter.mjs";

export {
  EXTERNAL_LLM_SERVICE_ADAPTER_KIND,
  EXTERNAL_LLM_SERVICE_ADAPTER_STATUS,
  callExternalLlmService,
  describeExternalLlmServiceAdapters,
  dispatchExternalLlmServiceAdapter,
  isExternalLlmServiceConfig,
  resolveExternalLlmServiceAdapter
} from "./external-llm-service-adapters.mjs";

export const COMPOSITION_PRESET_KIND = "pact.composition.preset";
export const DEFAULT_COMPOSITION_PRESET_DIR = "server/platform/common/composition-management";

const FEATURE_IDS = new Set(FEATURE_MANIFEST.features.map((feature) => feature.featureId));
const OPERATION_IDS = new Set(SERVER_API_OPERATIONS.map((operation) => operation.id));

function uniqueStrings(values = []) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))].sort();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
}

function collectOperationIds(value, target = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectOperationIds(item, target);
    }
    return target;
  }
  if (!value || typeof value !== "object") {
    return target;
  }
  for (const [key, item] of Object.entries(value)) {
    if (key === "operationId" && typeof item === "string") {
      target.add(item);
    } else if ((key === "operationIds" || key === "requiredOperations" || key === "triggerOperations" || key === "jobOperations") && Array.isArray(item)) {
      for (const operationId of item) {
        if (typeof operationId === "string") {
          target.add(operationId);
        }
      }
    } else if (item && typeof item === "object") {
      collectOperationIds(item, target);
    }
  }
  return target;
}

function collectPathRefs(preset = {}) {
  const applicationPackage = asObject(preset.applicationDependencyPackage);
  const externalService = normalizeExternalServiceConfig(preset.externalService || null, {
    presetId: preset.presetId,
    serviceName: preset.deploymentTarget?.serviceName,
    displayName: preset.displayName
  });
  return uniqueStrings([
    ...asArray(applicationPackage.moduleDescriptors),
    ...asArray(applicationPackage.moduleEntrypoints),
    ...asArray(applicationPackage.scripts),
    ...asArray(applicationPackage.serviceRoots),
    ...externalServicePathRefs(externalService || {})
  ]);
}

function collectPresetFeatureIds(preset = {}) {
  return uniqueStrings([
    ...asArray(preset.coreDependencyPackage?.featureIds),
    ...asArray(preset.applicationDependencyPackage?.featureIds)
  ]);
}

function operationFeatureCoverage(operationIds = [], featureRuntime = {}) {
  const activeOperations = filterOperationsForFeatures(SERVER_API_OPERATIONS, featureRuntime);
  const activeOperationIds = new Set(activeOperations.map((operation) => operation.id));
  return operationIds.map((operationId) => ({
    operationId,
    active: activeOperationIds.has(operationId),
    registered: OPERATION_IDS.has(operationId)
  }));
}

export async function listCompositionPresetFiles({
  presetDir = DEFAULT_COMPOSITION_PRESET_DIR,
  cwd = process.cwd()
} = {}) {
  const absoluteDir = path.resolve(cwd, presetDir);
  const entries = await fs.readdir(absoluteDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".preset.json"))
    .map((entry) => path.join(absoluteDir, entry.name))
    .sort();
}

export async function loadCompositionPreset(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return {
    filePath,
    preset: JSON.parse(raw)
  };
}

export async function loadCompositionPresets(options = {}) {
  const files = await listCompositionPresetFiles(options);
  return Promise.all(files.map(loadCompositionPreset));
}

export async function validateCompositionPreset({
  preset,
  filePath = "",
  cwd = process.cwd()
} = {}) {
  const errors = [];
  const warnings = [];
  if (!preset || typeof preset !== "object" || Array.isArray(preset)) {
    errors.push("Preset must be a JSON object.");
    return { ok: false, filePath, presetId: "", errors, warnings };
  }
  if (preset.kind !== COMPOSITION_PRESET_KIND) {
    errors.push(`Preset kind must be ${COMPOSITION_PRESET_KIND}.`);
  }
  if (!preset.presetId) {
    errors.push("Preset is missing presetId.");
  }
  if (preset.compositionClass !== "deployment-dependency-package") {
    warnings.push(`Preset ${preset.presetId || filePath} uses compositionClass ${preset.compositionClass || "<missing>"}.`);
  }

  const featureIds = collectPresetFeatureIds(preset);
  const missingFeatureIds = featureIds.filter((featureId) => !FEATURE_IDS.has(featureId));
  for (const featureId of missingFeatureIds) {
    errors.push(`Preset references unknown featureId ${featureId}.`);
  }

  const operationIds = [...collectOperationIds(preset)].sort();
  const missingOperationIds = operationIds.filter((operationId) => !OPERATION_IDS.has(operationId));
  for (const operationId of missingOperationIds) {
    errors.push(`Preset references unknown operationId ${operationId}.`);
  }

  const pathRefs = collectPathRefs(preset);
  const missingPaths = [];
  for (const pathRef of pathRefs) {
    try {
      await fs.stat(path.resolve(cwd, pathRef));
    } catch {
      missingPaths.push(pathRef);
    }
  }
  for (const pathRef of missingPaths) {
    errors.push(`Preset references missing path ${pathRef}.`);
  }

  const externalService = normalizeExternalServiceConfig(preset.externalService || null, {
    presetId: preset.presetId,
    serviceName: preset.deploymentTarget?.serviceName,
    displayName: preset.displayName
  });
  let externalServiceValidation = null;
  if (externalService) {
    externalServiceValidation = await validateExternalServiceConfig({
      config: externalService,
      cwd,
      requireKnownPaths: false
    });
    for (const error of externalServiceValidation.errors || []) {
      errors.push(error);
    }
    for (const warning of externalServiceValidation.warnings || []) {
      warnings.push(warning);
    }
  }

  return {
    ok: errors.length === 0,
    filePath,
    presetId: preset.presetId || "",
    errors,
    warnings,
    featureIds,
    operationIds,
    pathRefs,
    missingFeatureIds,
    missingOperationIds,
    missingPaths,
    externalService,
    externalServiceValidation
  };
}

export async function createCompositionDehydrationPlan({
  preset,
  filePath = "",
  cwd = process.cwd(),
  now = new Date()
} = {}) {
  const validation = await validateCompositionPreset({ preset, filePath, cwd });
  if (!validation.ok) {
    return {
      ok: false,
      presetId: preset?.presetId || "",
      validation
    };
  }

  const requestedFeatureIds = validation.featureIds;
  const featureProfile = {
    schemaVersion: 1,
    name: preset.presetId,
    edition: "custom",
    features: requestedFeatureIds
  };
  const featureRuntime = resolveFeatureRuntime({
    edition: "custom",
    profile: featureProfile,
    now
  });
  const packagePlan = collectPackagePlan(featureRuntime, { surface: "server" });
  const operationCoverage = operationFeatureCoverage(validation.operationIds, featureRuntime);
  const inactiveRequiredOperations = operationCoverage.filter((entry) => !entry.active);
  const externalService = validation.externalService || null;

  const outputRoot = path.resolve(cwd, preset.deploymentTarget?.outputRoot || path.join("build/composition-packages", preset.presetId));
  const sourceRoot = path.join(outputRoot, "source");
  const docker = {
    imageTag: `pact-composition-${preset.presetId}:local`,
    containerName: `pact-composition-${preset.presetId}`,
    runtimeProfile: featureRuntime.activeFeatureIds.includes("document-parser") ? "default" : "minimal",
    servicePort: 8787,
    healthPath: "/api/healthz"
  };

  return {
    ok: inactiveRequiredOperations.length === 0,
    schemaVersion: 1,
    generatedAt: now instanceof Date ? now.toISOString() : new Date(now).toISOString(),
    presetId: preset.presetId,
    displayName: preset.displayName || preset.presetId,
    filePath,
    validation,
    featureProfile,
    featureRuntime: {
      edition: featureRuntime.edition,
      activeFeatureIds: featureRuntime.activeFeatureIds,
      disabledFeatureIds: featureRuntime.disabledFeatureIds
    },
    packagePlan,
    operationCoverage,
    inactiveRequiredOperations,
    outputRoot,
    sourceRoot,
    docker,
    externalService,
    dehydration: preset.dehydration || null,
    dynamicModuleMount: preset.dynamicModuleMount || null,
    startupComposition: preset.startupComposition || null
  };
}

export async function writeCompositionPlanArtifacts({
  plan,
  preset,
  outputRoot = plan?.outputRoot,
  sourceRoot = plan?.sourceRoot
} = {}) {
  if (!plan?.presetId) {
    throw new Error("writeCompositionPlanArtifacts requires a plan with presetId.");
  }
  await fs.mkdir(outputRoot, { recursive: true });
  await fs.mkdir(path.join(outputRoot, "feature-profile"), { recursive: true });
  await fs.writeFile(
    path.join(outputRoot, "feature-profile", "feature-profile.json"),
    `${JSON.stringify(plan.featureProfile, null, 2)}\n`,
    "utf8"
  );
  await fs.writeFile(
    path.join(outputRoot, "composition-plan.json"),
    `${JSON.stringify(plan, null, 2)}\n`,
    "utf8"
  );
  await fs.writeFile(
    path.join(outputRoot, "dehydration-report.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      presetId: plan.presetId,
      ok: plan.ok,
      generatedAt: plan.generatedAt,
      outputRoot,
      sourceRoot,
      validation: plan.validation,
      featureProfile: plan.featureProfile,
      activeFeatureIds: plan.featureRuntime.activeFeatureIds,
      inactiveRequiredOperations: plan.inactiveRequiredOperations,
      docker: plan.docker
    }, null, 2)}\n`,
    "utf8"
  );

  if (sourceRoot) {
    await fs.mkdir(path.join(sourceRoot, "composition"), { recursive: true });
    await fs.writeFile(
      path.join(sourceRoot, "composition", "preset.json"),
      `${JSON.stringify(preset, null, 2)}\n`,
      "utf8"
    );
    await fs.writeFile(
      path.join(sourceRoot, "composition", "composition-plan.json"),
      `${JSON.stringify(plan, null, 2)}\n`,
      "utf8"
    );
  }
}
