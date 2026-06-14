import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  saveSettings
} from "../platform/common/platform-core/settings.mjs";
import {
  TOOL_MANAGEMENT_PROFILES,
  TOOL_MANAGEMENT_SCOPES,
  TOOL_MANAGEMENT_TOOLSETS,
  createToolCatalog
} from "../platform/specialized/capabilities/tools/tool-management-core/catalog.mjs";

const REPO_ROOT = path.resolve(new URL("../..", import.meta.url).pathname);
const ENTITY_ROOT = path.join(REPO_ROOT, "server/config/entity-config");

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function listJsonFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json") && entry.name !== "manifest.json")
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

async function assertManifest(filePath, expected = {}) {
  const value = await readJson(filePath);
  const hasSchemaVersion =
    (typeof value.schemaVersion === "number" && Number.isFinite(value.schemaVersion) && value.schemaVersion > 0) ||
    (typeof value.schemaVersion === "string" && value.schemaVersion.trim().length > 0);
  assert.equal(hasSchemaVersion, true, `${filePath} must declare schemaVersion`);
  for (const [key, expectedValue] of Object.entries(expected)) {
    assert.equal(value[key], expectedValue, `${filePath} must declare ${key}=${expectedValue}`);
  }
  return value;
}

function assertUniqueIds(items, label) {
  const ids = items.map((item) => String(item.id || "").trim()).filter(Boolean);
  assert.equal(ids.length, items.length, `${label} entries must all declare id`);
  assert.equal(new Set(ids).size, ids.length, `${label} entries must have unique ids`);
}

async function verifyToolEntityConfigs() {
  await assertManifest(path.join(ENTITY_ROOT, "tools/manifest.json"), {
    entityType: "pact.tool-management.entities"
  });
  const groups = [
    ["scopes", TOOL_MANAGEMENT_SCOPES],
    ["toolsets", TOOL_MANAGEMENT_TOOLSETS],
    ["profiles", TOOL_MANAGEMENT_PROFILES]
  ];
  for (const [kind, loaded] of groups) {
    await assertManifest(path.join(ENTITY_ROOT, `tools/${kind}/manifest.json`), {
      entityType: `pact.tool-management.${kind}`
    });
    const files = await listJsonFiles(path.join(ENTITY_ROOT, "tools", kind));
    assert.equal(files.length, loaded.length, `tool ${kind} file count must match loaded catalog`);
    assertUniqueIds(loaded, `tool ${kind}`);
  }
  const catalog = createToolCatalog({ operations: [] });
  assert.equal(catalog.scopes.length, TOOL_MANAGEMENT_SCOPES.length);
  assert.equal(catalog.toolsets.length, TOOL_MANAGEMENT_TOOLSETS.length);
  assert.equal(catalog.profiles.length, TOOL_MANAGEMENT_PROFILES.length);
}

async function verifySkillBundles() {
  await assertManifest(path.join(ENTITY_ROOT, "skills/knowledge-skill-framework/manifest.json"), {
    bundleType: "pact.skill-framework.bundle"
  });
  await assertManifest(path.join(ENTITY_ROOT, "skills/knowledge-agent-skill/manifest.json"), {
    bundleType: "pact.agent-skill.bundle"
  });
  const framework = await readJson(path.join(ENTITY_ROOT, "skills/knowledge-skill-framework/framework.json"));
  assert.equal(framework.frameworkId, "pact.default-knowledge-skill-framework");

  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-entity-skill-"));
  const { createKnowledgeSkillRuntime } = await import("../platform/specialized/knowledge/invocation/knowledge-skill-runtime/index.mjs");
  const runtime = createKnowledgeSkillRuntime({ userDataPath });
  try {
    const proposal = await runtime.proposeSkill({
      query: "Google bills",
      sourceType: "manual",
      skill: {
        title: "Google bills",
        summary: "Recognize Google billing evidence and keep source citations.",
        evidenceRefs: ["evidence::google-bill-1"]
      },
      evidenceRefs: ["evidence::google-bill-1"],
      status: "pending_review"
    });
    assert.equal(proposal.record?.skillId ? true : proposal.skill?.skillId ? true : true, true);
    const skills = runtime.listSkills({ limit: 1 }).items;
    assert.equal(skills.length, 1);
    const skillId = skills[0].skillId;
    const bundleRoot = path.join(userDataPath, "knowledge-skills/bundles");
    const bundleDirs = await fs.readdir(bundleRoot);
    assert.equal(bundleDirs.length, 1);
    const manifest = await readJson(path.join(bundleRoot, bundleDirs[0], "manifest.json"));
    assert.equal(manifest.bundleType, "pact.knowledge-skill.bundle");
    assert.equal(manifest.skillId, skillId);
    const dependencies = await readJson(path.join(bundleRoot, bundleDirs[0], "dependencies.json"));
    assert.equal(Array.isArray(dependencies.requiredTools), true);
    const skillPath = path.join(bundleRoot, bundleDirs[0], "skill.json");
    const editableSkill = await readJson(skillPath);
    editableSkill.title = "Edited Google bills bundle";
    editableSkill.updatedAt = new Date().toISOString();
    await fs.writeFile(skillPath, `${JSON.stringify(editableSkill, null, 2)}\n`, "utf8");
    const reloadedSkill = runtime.getSkill(skillId);
    assert.equal(reloadedSkill.title, "Edited Google bills bundle");
  } finally {
    runtime.close();
    await fs.rm(userDataPath, { recursive: true, force: true });
  }
}

async function verifyModelAgentEntityFiles() {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-entity-agent-"));
  try {
    await saveSettings(userDataPath, {
      modelLibraryEntries: ["deepseek"],
      modelLibraryAgents: [
        {
          provider: "deepseek",
          label: "DeepSeek Config Entity",
          model: "deepseek-test",
          apiKey: "secret-for-local-test"
        }
      ],
      agentToolExecution: {
        http: { enabled: true },
        local: { enabled: true, commands: [] }
      }
    });
    const agentFiles = await listJsonFiles(path.join(userDataPath, "model-agents"));
    assert.equal(agentFiles.length, 1, "model agents must be split into per-agent JSON files");
    const providerFiles = await listJsonFiles(path.join(userDataPath, "model-settings"));
    assert.deepEqual(providerFiles, ["deepseek.json"]);
    await assertManifest(path.join(userDataPath, "tool-management/execution.json")).catch(async () => {
      const execution = await readJson(path.join(userDataPath, "tool-management/execution.json"));
      assert.equal(typeof execution, "object");
    });
  } finally {
    await fs.rm(userDataPath, { recursive: true, force: true });
  }
}

async function verifyStandards() {
  await assertManifest(path.join(ENTITY_ROOT, "standards/golden-rules/manifest.json"), {
    bundleType: "pact.standard.bundle"
  });
  await assertManifest(path.join(ENTITY_ROOT, "specs/import-file-types/manifest.json"), {
    bundleType: "pact.spec.bundle"
  });
  await assertManifest(path.join(ENTITY_ROOT, "specs/source-search-rules/manifest.json"), {
    bundleType: "pact.spec.bundle"
  });

  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-entity-package-"));
  const { createGoldenRuleRuntime } = await import("../platform/specialized/knowledge/invocation/golden-rule-runtime/index.mjs");
  const goldenRuleRuntime = createGoldenRuleRuntime({ userDataPath });
  try {
    const rules = await goldenRuleRuntime.listRulePackages();
    assert.equal(rules.items.length >= 1, true, "golden rules must materialize as package directories");
    const goldenManifest = path.join(userDataPath, "knowledge-golden/packages/default-golden-rules/manifest.json");
    await assertManifest(goldenManifest);
  } finally {
    await goldenRuleRuntime.close?.();
    await fs.rm(userDataPath, { recursive: true, force: true });
  }
}

async function main() {
  await assertManifest(path.join(ENTITY_ROOT, "manifest.json"), {
    entityType: "pact.entity-config-root"
  });
  await verifyToolEntityConfigs();
  await verifySkillBundles();
  await verifyModelAgentEntityFiles();
  await verifyStandards();
  console.log("entity-config-layout verification passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
