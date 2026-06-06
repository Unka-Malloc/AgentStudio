import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_FEATURE_EDITION,
  FEATURE_MANIFEST,
  activeClientModuleIds,
  collectPackagePlan,
  filterOperationsForFeatures,
  getFeatureEntries,
  getFeatureMap,
  loadFeatureProfile,
  publicFeatureRuntime,
  resolveFeatureRuntime,
  resolveFeatureRuntimeFromEnv
} from "../../../server/platform/interactive/features/feature-manifest.mjs";

const tempRoots = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))
  );
});

async function createTempRoot(prefix) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

describe("feature manifest registry", () => {
  it("exposes stable feature entries and map lookups", () => {
    const entries = getFeatureEntries();
    const featureMap = getFeatureMap();

    expect(entries).toHaveLength(FEATURE_MANIFEST.features.length);
    expect(featureMap.get("knowledge-core")).toMatchObject({
      featureId: "knowledge-core",
      group: "knowledge",
      label: "KnowledgeCore search, sources, evidence, rules, and graph shell"
    });

    entries[0].label = "mutated";
    expect(getFeatureMap().get("core-platform").label).toBe("Core platform");
  });
});

describe("feature manifest profile loading", () => {
  it("reads a profile from a temp file and normalizes duplicate selections", async () => {
    const root = await createTempRoot("pact-feature-manifest-profile-");
    const profilePath = path.join(root, "feature-profile.json");

    await fs.writeFile(
      profilePath,
      JSON.stringify({
        name: "tmp-profile",
        edition: "custom",
        features: ["knowledge-core", "agent-gateway", "knowledge-core"],
        enableFeatures: ["agent-exploration", "agent-exploration"],
        disableFeatures: ["macos-mail", "macos-mail"]
      }),
      "utf8"
    );

    const profile = await loadFeatureProfile(profilePath);
    expect(profile).toMatchObject({
      name: "tmp-profile",
      edition: "custom"
    });

    const runtime = await resolveFeatureRuntimeFromEnv({
      env: {
        PACT_FEATURE_PROFILE: profilePath
      }
    });

    expect(runtime.schemaVersion).toBe(1);
    expect(runtime.edition).toBe("custom");
    expect(runtime.profileName).toBe("tmp-profile");
    expect(runtime.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(runtime.activeFeatureIds).toEqual([...runtime.activeFeatureIds].sort());
    expect(runtime.disabledFeatureIds).toEqual([...runtime.disabledFeatureIds].sort());
    expect(runtime.activeFeatureIds).toEqual([
      "agent-exploration",
      "agent-gateway",
      "agent-memory",
      "analysis-runtime",
      "client-runtime-core",
      "console-shell",
      "core-platform",
      "data-structure-core",
      "devops-core",
      "document-parser",
      "knowledge-core",
      "module-management-core",
      "operation-dispatcher",
      "security-permissions",
      "storage-core",
      "tool-management-core",
      "work-queue-core"
    ]);
    expect(runtime.reasons["agent-gateway"]).toBe("edition/profile");
    expect(runtime.reasons["agent-memory"]).toBe("dependency of client-runtime-core");
    expect(runtime.reasons["document-parser"]).toBe("dependency of knowledge-core");
    expect(runtime.disabledReasons["macos-mail"]).toBe("disabled by profile");
  });

  it("rejects missing or broken profile files", async () => {
    const root = await createTempRoot("pact-feature-manifest-bad-profile-");
    const missingPath = path.join(root, "missing-feature-profile.json");
    const brokenPath = path.join(root, "broken-feature-profile.json");

    await fs.writeFile(brokenPath, "{not-json", "utf8");

    await expect(loadFeatureProfile(missingPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(loadFeatureProfile(brokenPath)).rejects.toBeInstanceOf(SyntaxError);
  });
});

describe("feature manifest runtime defaults and validation", () => {
  it("fills default runtime values when no profile is provided", () => {
    const runtime = resolveFeatureRuntime({ now: "2024-01-02T03:04:05.678Z" });

    expect(runtime.edition).toBe(DEFAULT_FEATURE_EDITION);
    expect(runtime.profileName).toBe(DEFAULT_FEATURE_EDITION);
    expect(runtime.schemaVersion).toBe(1);
    expect(runtime.generatedAt).toBe("2024-01-02T03:04:05.678Z");
    expect(runtime.activeFeatureIds).toEqual([...runtime.activeFeatureIds].sort());
    expect(runtime.activeFeatureIds).toContain("core-platform");
  });

  it("rejects invalid editions and attempts to disable required features", () => {
    expect(() => resolveFeatureRuntime({ edition: "does-not-exist" })).toThrow(
      "Unknown feature edition: does-not-exist"
    );

    expect(() =>
      resolveFeatureRuntime({
        profile: {
          disableFeatures: ["core-platform"]
        }
      })
    ).toThrow("Required feature cannot be disabled: core-platform");
  });
});

describe("feature manifest filtering and package plans", () => {
  it("filters operations by active features and keeps package plan lists sorted", () => {
    const runtime = resolveFeatureRuntime({
      edition: "custom",
      profile: {
        name: "tmp-profile",
        features: ["knowledge-core", "agent-gateway", "knowledge-outline-reasoning"],
        enableFeatures: ["agent-exploration"]
      },
      now: "2024-01-02T03:04:05.678Z"
    });

    expect(activeClientModuleIds(runtime)).toEqual([
      "expert-vocabulary",
      "knowledge-agent",
      "knowledge-mirror"
    ]);

    const operations = [
      { id: "agents.list" },
      { id: "knowledge.document_structure" },
      { id: "context.session_memory.get" },
      { id: "repo.status" }
    ];
    const filtered = filterOperationsForFeatures(operations, {
      activeFeatureIds: ["agent-management", "knowledge-outline-reasoning"]
    });

    expect(filtered.map(({ id, featureId }) => ({ id, featureId }))).toEqual([
      { id: "agents.list", featureId: "agent-management" },
      { id: "knowledge.document_structure", featureId: "knowledge-outline-reasoning" }
    ]);

    const publicRuntime = publicFeatureRuntime(runtime, operations);
    expect(publicRuntime.operations).toEqual({
      total: 4,
      active: 2,
      disabled: 2
    });

    const serverPlan = collectPackagePlan(runtime, { surface: "server" });
    expect(serverPlan.webPanels).toEqual([]);
    expect(serverPlan.webNavItems).toEqual([]);
    expect(serverPlan.includePaths).toEqual([...serverPlan.includePaths].sort());
    expect(serverPlan.removePaths).toEqual([...serverPlan.removePaths].sort());
    expect(serverPlan.clientModules).toEqual([]);

    const fullPlan = collectPackagePlan(runtime, { surface: "all" });
    expect(fullPlan.clientModules).toEqual(["expert-vocabulary", "knowledge-agent", "knowledge-mirror"]);
    expect(fullPlan.webNavItems).toContain("intelligence");
    expect(fullPlan.webPanels).toContain("AgentExplorePanel");
    expect(fullPlan.includePaths).toEqual([...fullPlan.includePaths].sort());
    expect(fullPlan.removePaths).toEqual([...fullPlan.removePaths].sort());
  });
});
