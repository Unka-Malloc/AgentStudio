import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  COMPOSITION_PRESET_KIND,
  createCompositionDehydrationPlan,
  listCompositionPresetFiles,
  loadCompositionPreset,
  loadCompositionPresets,
  validateCompositionPreset,
  writeCompositionPlanArtifacts
} from "../../../server/platform/common/composition-management/index.mjs";
import { normalizeExternalServiceConfig } from "../../../server/platform/common/composition-management/external-service-adapter.mjs";

const tempRoots = [];

async function tempDir(prefix) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeText(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, value, "utf8");
}

function buildPreset({
  presetId,
  displayName = presetId,
  featureIds = [],
  requiredOperations = [],
  applicationScripts = [],
  moduleDescriptors = [],
  externalService = null,
  deploymentTarget = null
} = {}) {
  return {
    schemaVersion: 1,
    kind: COMPOSITION_PRESET_KIND,
    presetId,
    displayName,
    compositionClass: "deployment-dependency-package",
    ...(deploymentTarget ? { deploymentTarget } : {}),
    applicationDependencyPackage: {
      featureIds,
      requiredOperations,
      ...(applicationScripts.length ? { scripts: applicationScripts } : {}),
      ...(moduleDescriptors.length ? { moduleDescriptors } : {})
    },
    ...(externalService ? { externalService } : {})
  };
}

function buildExternalServiceConfig(serviceId, scriptPrefix) {
  return normalizeExternalServiceConfig({
    serviceId,
    serviceName: `${serviceId}.service`,
    displayName: `${serviceId} service`,
    mode: "connected",
    startupPolicy: "external-only",
    upstream: {
      type: "mcp",
      transport: "streamable-http",
      url: "http://127.0.0.1:8787/mcp"
    },
    binding: {
      mode: "passthrough",
      outlet: "pact.skillHub"
    },
    scripts: {
      prepare: {
        path: `scripts/${scriptPrefix}-prepare.mjs`
      },
      start: {
        path: `scripts/${scriptPrefix}-start.mjs`
      }
    }
  });
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("composition management extras", () => {
  it("discovers preset files from the bundled default directory", async () => {
    const files = await listCompositionPresetFiles();

    expect(files.length).toBeGreaterThan(0);
    expect(files.every((file) => file.endsWith(".preset.json"))).toBe(true);
    expect(files.some((file) => file.endsWith("gerrit-service.preset.json"))).toBe(true);
  });

  it("loads custom preset files in sorted order", async () => {
    const cwd = await tempDir("pact-composition-load-");
    const presetDir = path.join(cwd, "presets");

    await writeJson(path.join(presetDir, "beta.preset.json"), buildPreset({ presetId: "beta" }));
    await writeJson(path.join(presetDir, "alpha.preset.json"), buildPreset({ presetId: "alpha" }));
    await writeJson(path.join(presetDir, "skip.json"), { ignored: true });

    const files = await listCompositionPresetFiles({ cwd, presetDir: "presets" });
    const loaded = await loadCompositionPresets({ cwd, presetDir: "presets" });

    expect(files.map((file) => path.basename(file))).toEqual([
      "alpha.preset.json",
      "beta.preset.json"
    ]);
    expect(loaded.map((entry) => entry.preset.presetId)).toEqual(["alpha", "beta"]);
    expect(await loadCompositionPreset(files[0])).toMatchObject({
      filePath: files[0],
      preset: {
        presetId: "alpha"
      }
    });
  });

  it("builds the default composition plan and writes its artifacts", async () => {
    const cwd = await tempDir("pact-composition-default-");
    const outputRoot = await tempDir("pact-composition-output-");
    const sourceRoot = await tempDir("pact-composition-source-");
    const preset = buildPreset({
      presetId: "default-composition"
    });

    const validation = await validateCompositionPreset({ preset, cwd });
    expect(validation.ok).toBe(true);
    expect(validation.externalService).toBeNull();
    expect(validation.errors).toEqual([]);

    const plan = await createCompositionDehydrationPlan({
      preset,
      cwd,
      now: new Date("2024-06-01T12:34:56.000Z")
    });

    expect(plan.ok).toBe(true);
    expect(plan.generatedAt).toBe("2024-06-01T12:34:56.000Z");
    expect(plan.outputRoot).toBe(path.resolve(cwd, "build/composition-packages/default-composition"));
    expect(plan.sourceRoot).toBe(path.join(plan.outputRoot, "source"));
    expect(plan.docker.runtimeProfile).toBe("minimal");
    expect(plan.externalService).toBeNull();
    expect(plan.operationCoverage).toEqual([]);

    await writeCompositionPlanArtifacts({
      plan,
      preset,
      outputRoot,
      sourceRoot
    });

    expect(JSON.parse(await fs.readFile(path.join(outputRoot, "feature-profile", "feature-profile.json"), "utf8"))).toMatchObject({
      name: "default-composition",
      features: []
    });
    expect(JSON.parse(await fs.readFile(path.join(outputRoot, "composition-plan.json"), "utf8"))).toMatchObject({
      presetId: "default-composition",
      ok: true
    });
    expect(JSON.parse(await fs.readFile(path.join(outputRoot, "dehydration-report.json"), "utf8"))).toMatchObject({
      presetId: "default-composition",
      ok: true
    });
    expect(JSON.parse(await fs.readFile(path.join(sourceRoot, "composition", "preset.json"), "utf8"))).toMatchObject({
      presetId: "default-composition"
    });
    expect(JSON.parse(await fs.readFile(path.join(sourceRoot, "composition", "composition-plan.json"), "utf8"))).toMatchObject({
      presetId: "default-composition"
    });
  });

  it("keeps external service config and path refs when the preset is valid", async () => {
    const cwd = await tempDir("pact-composition-external-service-");
    const preset = buildPreset({
      presetId: "external-service-composition",
      featureIds: ["document-parser"],
      requiredOperations: ["external_services.list"],
      applicationScripts: ["scripts/app-entry.mjs"],
      moduleDescriptors: ["modules/app.module.json"],
      externalService: buildExternalServiceConfig("external-service-composition", "relay")
    });

    await writeText(path.join(cwd, "scripts", "app-entry.mjs"), "export const entry = true;\n");
    await writeJson(path.join(cwd, "modules", "app.module.json"), { name: "app.module" });
    await writeText(path.join(cwd, "scripts", "relay-prepare.mjs"), "export const prepare = true;\n");
    await writeText(path.join(cwd, "scripts", "relay-start.mjs"), "export const start = true;\n");

    const validation = await validateCompositionPreset({ preset, cwd });
    expect(validation.ok).toBe(true);
    expect(validation.pathRefs).toEqual(expect.arrayContaining([
      "scripts/app-entry.mjs",
      "modules/app.module.json",
      "scripts/relay-prepare.mjs",
      "scripts/relay-start.mjs"
    ]));
    expect(validation.externalServiceValidation).toMatchObject({
      ok: true,
      errors: []
    });

    const plan = await createCompositionDehydrationPlan({
      preset,
      cwd,
      now: new Date("2024-06-02T00:00:00.000Z")
    });

    expect(plan.ok).toBe(true);
    expect(plan.docker.runtimeProfile).toBe("default");
    expect(plan.featureRuntime.activeFeatureIds).toContain("document-parser");
    expect(plan.operationCoverage).toEqual([
      {
        operationId: "external_services.list",
        active: true,
        registered: true
      }
    ]);
    expect(plan.externalService).toMatchObject({
      serviceId: "external-service-composition",
      serviceName: "external-service-composition.service",
      binding: {
        outlet: "pact.skillHub"
      }
    });
  });

  it("marks required operations inactive when the requested feature set does not cover them", async () => {
    const cwd = await tempDir("pact-composition-inactive-op-");
    const preset = buildPreset({
      presetId: "inactive-op-composition",
      requiredOperations: ["workspace_governance.describe"]
    });

    const validation = await validateCompositionPreset({ preset, cwd });
    expect(validation.ok).toBe(true);

    const plan = await createCompositionDehydrationPlan({ preset, cwd });

    expect(plan.ok).toBe(false);
    expect(plan.operationCoverage).toEqual([
      {
        operationId: "workspace_governance.describe",
        active: false,
        registered: true
      }
    ]);
    expect(plan.inactiveRequiredOperations).toEqual([
      {
        operationId: "workspace_governance.describe",
        active: false,
        registered: true
      }
    ]);
  });

  it("returns structured errors for invalid presets and missing artifact plans", async () => {
    const cwd = await tempDir("pact-composition-invalid-");

    await expect(validateCompositionPreset({ preset: [], cwd })).resolves.toMatchObject({
      ok: false,
      errors: ["Preset must be a JSON object."]
    });

    const invalidPreset = {
      schemaVersion: 1,
      kind: "wrong.kind",
      presetId: "bad-preset",
      compositionClass: "custom",
      applicationDependencyPackage: {
        featureIds: ["not-a-feature"],
        requiredOperations: ["not-an-operation"],
        scripts: ["missing-script.mjs"]
      }
    };

    const validation = await validateCompositionPreset({ preset: invalidPreset, cwd });
    expect(validation.ok).toBe(false);
    expect(validation.errors).toEqual(expect.arrayContaining([
      `Preset kind must be ${COMPOSITION_PRESET_KIND}.`,
      "Preset references unknown featureId not-a-feature.",
      "Preset references unknown operationId not-an-operation.",
      "Preset references missing path missing-script.mjs."
    ]));
    expect(validation.warnings).toEqual([
      "Preset bad-preset uses compositionClass custom."
    ]);

    const missingId = await validateCompositionPreset({
      preset: {
        kind: COMPOSITION_PRESET_KIND,
        compositionClass: "deployment-dependency-package"
      },
      cwd
    });
    expect(missingId.ok).toBe(false);
    expect(missingId.errors).toContain("Preset is missing presetId.");

    await expect(loadCompositionPreset(path.join(cwd, "missing.preset.json"))).rejects.toThrow();
    await expect(writeCompositionPlanArtifacts({
      plan: {},
      preset: {}
    })).rejects.toThrow("writeCompositionPlanArtifacts requires a plan with presetId.");
  });
});
