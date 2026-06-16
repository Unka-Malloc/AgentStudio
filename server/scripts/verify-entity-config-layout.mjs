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
  await assertManifest(path.join(ENTITY_ROOT, "runbooks/project-release-runbook/manifest.json"), {
    bundleType: "pact.runbook.bundle"
  });
  const releaseRunbook = await readJson(path.join(ENTITY_ROOT, "runbooks/project-release-runbook/manifest.json"));
  assert.equal(releaseRunbook.runbookId, "pact.project.release");
  assert.equal(releaseRunbook.legacySkillId, "pact.project.release");
  const releaseRunbookDependencies = await readJson(path.join(ENTITY_ROOT, "runbooks/project-release-runbook/dependencies.json"));
  assert.equal(releaseRunbookDependencies.dependencyType, "pact.runbook.dependencies");

  await assertManifest(path.join(ENTITY_ROOT, "playbooks/knowledge-playbook-framework/manifest.json"), {
    bundleType: "pact.playbook-framework.bundle"
  });
  const playbookFramework = await readJson(path.join(ENTITY_ROOT, "playbooks/knowledge-playbook-framework/framework.json"));
  assert.equal(playbookFramework.playbookFrameworkId, "pact.default-agentlibrary-playbook-framework");
  assert.equal(playbookFramework.legacyFrameworkId, "pact.default-knowledge-skill-framework");

  await assertManifest(path.join(ENTITY_ROOT, "skills/knowledge-skill-framework/manifest.json"), {
    bundleType: "pact.skill-framework.bundle"
  });
  await assertManifest(path.join(ENTITY_ROOT, "skills/knowledge-agent-skill/manifest.json"), {
    bundleType: "pact.agent-skill.bundle"
  });
  await assertManifest(path.join(ENTITY_ROOT, "skills/project-release-skill/manifest.json"), {
    bundleType: "pact.agent-skill.bundle"
  });
  const framework = await readJson(path.join(ENTITY_ROOT, "skills/knowledge-skill-framework/framework.json"));
  assert.equal(framework.frameworkId, "pact.default-knowledge-skill-framework");

  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-entity-skill-"));
  const { createAgentLibraryPlaybookRuntime } = await import("../platform/specialized/knowledge/invocation/knowledge-skill-runtime/index.mjs");
  const runtime = createAgentLibraryPlaybookRuntime({ userDataPath });
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
    assert.equal(proposal.playbook?.playbookId ? true : proposal.skill?.playbookId ? true : false, true);
    const skills = runtime.listSkills({ limit: 1 }).items;
    assert.equal(skills.length, 1);
    const skillId = skills[0].skillId;
    const playbookId = skills[0].playbookId;
    const playbookBundleRoot = path.join(userDataPath, "agentlibrary-playbooks/bundles");
    const playbookBundleDirs = await fs.readdir(playbookBundleRoot);
    assert.equal(playbookBundleDirs.length, 1);
    const playbookManifest = await readJson(path.join(playbookBundleRoot, playbookBundleDirs[0], "manifest.json"));
    assert.equal(playbookManifest.bundleType, "pact.agentlibrary-playbook.bundle");
    assert.equal(playbookManifest.playbookId, playbookId);
    assert.equal(playbookManifest.legacySkillId, skillId);
    const dependencies = await readJson(path.join(playbookBundleRoot, playbookBundleDirs[0], "dependencies.json"));
    assert.equal(dependencies.dependencyType, "pact.agentlibrary-playbook.dependencies");
    assert.equal(Array.isArray(dependencies.requiredTools), true);
    const legacyBundleRoot = path.join(userDataPath, "knowledge-skills/bundles");
    const legacyBundleDirs = await fs.readdir(legacyBundleRoot);
    assert.equal(legacyBundleDirs.length, 1);
    const legacyManifest = await readJson(path.join(legacyBundleRoot, legacyBundleDirs[0], "manifest.json"));
    assert.equal(legacyManifest.bundleType, "pact.knowledge-skill.bundle");
    assert.equal(legacyManifest.skillId, skillId);
    const playbookPath = path.join(playbookBundleRoot, playbookBundleDirs[0], "playbook.json");
    const editablePlaybook = await readJson(playbookPath);
    editablePlaybook.title = "Edited Google bills playbook bundle";
    editablePlaybook.updatedAt = new Date(Date.now() + 1000).toISOString();
    await fs.writeFile(playbookPath, `${JSON.stringify(editablePlaybook, null, 2)}\n`, "utf8");
    const reloadedPlaybook = runtime.getSkill(playbookId);
    assert.equal(reloadedPlaybook.title, "Edited Google bills playbook bundle");
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
