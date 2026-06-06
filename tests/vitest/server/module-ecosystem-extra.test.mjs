import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  MODULE_ECOSYSTEM_PROTOCOL_VERSION,
  MOUNT_MODULE_PROTOCOL_VERSION,
  listModuleTemplates,
  planModuleScaffold,
  runModuleContractTest,
  scaffoldModule,
  validateCapabilityPackageScaffoldManifest
} from "../../../server/platform/common/module-manager/module-ecosystem/index.mjs";

const tempRoots = [];

async function tempDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pact-module-ecosystem-"));
  tempRoots.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("module ecosystem extra coverage", () => {
  it("lists templates and reports available ids for unknown scaffold templates", async () => {
    const templates = listModuleTemplates();
    expect(templates.protocolVersion).toBe(MODULE_ECOSYSTEM_PROTOCOL_VERSION);
    expect(templates.templates.map((item) => item.templateId)).toEqual(expect.arrayContaining([
      "documentParser",
      "analysis",
      "toolPackage",
      "skillPackage"
    ]));
    expect(templates.templates.find((item) => item.templateId === "documentParser")).toMatchObject({
      kind: "mount",
      mountName: "documentParser",
      defaultExtensions: [".txt", ".md"]
    });

    await expect(planModuleScaffold({ templateId: "missing-template" })).rejects.toMatchObject({
      message: "Unknown module template: missing-template",
      details: expect.arrayContaining(["documentParser", "customMount"])
    });
  });

  it("plans conflicts, scaffolds a mount module, and validates the generated contract", async () => {
    const root = await tempDir();
    const targetDir = path.join(root, "My Module!");
    await fs.mkdir(targetDir, { recursive: true });
    await fs.writeFile(path.join(targetDir, "package.json"), "existing", "utf8");

    const plan = await planModuleScaffold({
      templateId: "documentParser",
      moduleId: "external.parser demo",
      safeName: "Parser Demo!",
      targetDir,
      includeCi: false,
      metadata: { ownerTeam: "knowledge" }
    }, { userDataPath: root });

    expect(plan).toMatchObject({
      protocolVersion: MODULE_ECOSYSTEM_PROTOCOL_VERSION,
      moduleId: "external.parser demo",
      force: false,
      targetDir
    });
    expect(plan.files.find((file) => file.path === "package.json")).toMatchObject({
      exists: true,
      action: "conflict"
    });
    expect(plan.files.map((file) => file.path)).toEqual(expect.arrayContaining([
      "module.json",
      "index.mjs",
      "samples/sample.txt",
      "scripts/contract-test.mjs"
    ]));
    expect(plan.files.map((file) => file.path)).not.toContain(".github/workflows/contract-test.yml");

    await expect(scaffoldModule({
      templateId: "documentParser",
      moduleId: "external.parser demo",
      targetDir,
      includeCi: false
    }, { userDataPath: root })).rejects.toMatchObject({
      message: "Module scaffold target has existing files. Pass force=true to overwrite.",
      details: expect.arrayContaining([expect.objectContaining({ path: "package.json" })])
    });

    const scaffold = await scaffoldModule({
      templateId: "documentParser",
      moduleId: "external.parser demo",
      safeName: "Parser Demo!",
      targetDir,
      force: true,
      includeCi: true,
      mountName: "documentParser",
      version: "1.2.3",
      owner: "team-a",
      license: "Apache-2.0"
    }, { userDataPath: root });

    expect(scaffold.written.map((file) => file.path)).toEqual(expect.arrayContaining([
      ".github/workflows/contract-test.yml",
      "module.json",
      "index.mjs"
    ]));
    expect(scaffold.written.find((file) => file.path === "package.json")).toMatchObject({
      action: "overwrite"
    });

    const manifest = JSON.parse(await fs.readFile(path.join(targetDir, "module.json"), "utf8"));
    expect(manifest).toMatchObject({
      protocolVersion: MOUNT_MODULE_PROTOCOL_VERSION,
      ecosystemProtocolVersion: MODULE_ECOSYSTEM_PROTOCOL_VERSION,
      moduleId: "external.parser demo",
      version: "1.2.3",
      owner: "team-a",
      license: "Apache-2.0",
      routing: {
        mountName: "documentParser",
        extensions: [".txt", ".md"]
      }
    });

    const contract = await runModuleContractTest({
      modulePath: path.join(targetDir, "index.mjs"),
      mountName: "documentParser",
      samplePath: path.join(targetDir, "samples/sample.txt"),
      userDataPath: path.join(root, "data")
    });
    expect(contract).toMatchObject({
      protocolVersion: MODULE_ECOSYSTEM_PROTOCOL_VERSION,
      ok: true,
      id: "external.parser demo",
      kind: "documentParser"
    });
    expect(contract.checks.map((check) => check.name)).toEqual(expect.arrayContaining([
      "object",
      "reload",
      "supports sample",
      "extractDocument parserId",
      "extractDocument text",
      "postCommit",
      "close"
    ]));
  });

  it("scaffolds capability packages and validates good and bad manifests", async () => {
    const root = await tempDir();
    const targetDir = path.join(root, "tool-package");

    await scaffoldModule({
      template: "toolPackage",
      moduleId: "tools.audit",
      safeName: "audit-tool",
      packageName: "@example/audit-tool",
      targetDir,
      includeCi: false,
      license: "MIT"
    }, { userDataPath: root });

    const manifest = JSON.parse(await fs.readFile(path.join(targetDir, "capability-package.json"), "utf8"));
    expect(manifest).toMatchObject({
      ecosystemProtocolVersion: MODULE_ECOSYSTEM_PROTOCOL_VERSION,
      kind: "tool",
      name: "audit-tool",
      risk: "safe_write",
      sandbox: {
        policy: "server-runtime",
        network: false
      },
      license: "MIT"
    });
    expect(await fs.readFile(path.join(targetDir, "scripts/validate-manifest.mjs"), "utf8"))
      .toContain("Missing required fields");

    expect(validateCapabilityPackageScaffoldManifest(manifest)).toMatchObject({
      protocolVersion: MODULE_ECOSYSTEM_PROTOCOL_VERSION,
      ok: true,
      issues: [],
      manifest: {
        kind: "tool",
        name: "audit-tool",
        capabilities: ["execute", "policyPreview", "audit"]
      }
    });

    expect(validateCapabilityPackageScaffoldManifest({
      kind: "bad",
      name: "",
      version: "",
      capabilities: [],
      license: "",
      inputSchema: { type: "string" }
    })).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        { field: "name", message: "name is required" },
        { field: "kind", message: "kind must be tool or skill" },
        { field: "inputSchema", message: "inputSchema.type must be object" }
      ])
    });
  });
});
