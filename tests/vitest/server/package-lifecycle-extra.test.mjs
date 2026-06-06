import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  capabilityPackageDigest,
  capabilityPackageSignedPayload,
  createCapabilityPackageRegistry,
  normalizeCapabilityPackageManifest
} from "../../../server/platform/specialized/capabilities/package-lifecycle/index.mjs";

const tempRoots = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function makeTempUserDataPath() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pact-package-lifecycle-"));
  tempRoots.push(root);
  return root;
}

function signedManifest(input = {}) {
  const normalized = normalizeCapabilityPackageManifest(input);
  return normalizeCapabilityPackageManifest({
    ...input,
    signature: {
      algorithm: "sha256",
      digestSha256: capabilityPackageDigest(normalized)
    }
  });
}

function toolManifest(overrides = {}) {
  return signedManifest({
    kind: "tool",
    name: "demo-tool",
    version: "1.0.0",
    title: "Demo Tool",
    description: "Demo tool package",
    owner: "tests",
    source: "fixture",
    capabilities: ["demo.tool"],
    risk: "read_only",
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    license: "MIT",
    sandbox: {
      policy: "none"
    },
    ...overrides
  });
}

function skillManifest(overrides = {}) {
  return signedManifest({
    kind: "skill",
    name: "demo-skill",
    version: "2.0.0",
    title: "Demo Skill",
    description: "Demo skill package",
    owner: "tests",
    source: "fixture",
    capabilities: ["demo.skill"],
    risk: "read_only",
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    license: "Apache-2.0",
    sandbox: {
      policy: "knowledge-only"
    },
    ...overrides
  });
}

describe("package lifecycle helpers", () => {
  it("normalizes manifests and keeps package digests stable across input ordering", () => {
    const normalized = normalizeCapabilityPackageManifest({
      packageKind: " skill ",
      packageName: "  Review Skill  ",
      version: " 1.2.3 ",
      title: "  Review Skill  ",
      description: "  inspect   contracts  ",
      owner: "  ",
      source: " local ",
      capabilities: ["alpha", " alpha ", "beta", ""],
      risk: "repair_write",
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
      secretRefs: "secret://one, secret://two, secret://one",
      dependencies: [
        { kind: " tool ", name: " base-tool ", versionRange: " >=1.0.0 " },
        { kind: "tool", name: "" }
      ],
      compatibility: {
        minServerVersion: " 1.0.0 ",
        featureIds: ["one", "one", "two"],
        platforms: "linux,darwin"
      },
      sandbox: {
        policy: "invalid",
        network: 1,
        filesystem: " restricted ",
        commands: ["node", "node", "npm"]
      },
      license: " MIT "
    });

    expect(normalized).toMatchObject({
      schemaVersion: 1,
      protocolVersion: "pact.skill-registry.v1",
      lifecycleProtocolVersion: "pact.capability-package-lifecycle.v1",
      kind: "skill",
      name: "Review Skill",
      version: "1.2.3",
      title: "Review Skill",
      description: "inspect contracts",
      owner: "",
      source: "local",
      capabilities: ["alpha", "beta"],
      risk: "repair_write",
      secretRefs: ["secret://one", "secret://two"],
      dependencies: [
        { kind: "tool", name: "base-tool", versionRange: ">=1.0.0", optional: false }
      ],
      compatibility: {
        minServerVersion: "1.0.0",
        maxServerVersion: "",
        featureIds: ["one", "two"],
        platforms: ["linux", "darwin"]
      },
      sandbox: {
        policy: "none",
        network: false,
        filesystem: "restricted",
        commands: ["node", "npm"]
      },
      license: "MIT",
      signature: {
        required: true,
        algorithm: "sha256",
        digestSha256: ""
      }
    });

    const payload = capabilityPackageSignedPayload(normalized);
    expect(payload).toMatchObject({
      kind: "skill",
      name: "Review Skill",
      version: "1.2.3",
      capabilities: ["alpha", "beta"],
      risk: "repair_write",
      secretRefs: ["secret://one", "secret://two"],
      dependencies: [
        { kind: "tool", name: "base-tool", versionRange: ">=1.0.0", optional: false }
      ],
      compatibility: {
        minServerVersion: "1.0.0",
        maxServerVersion: "",
        featureIds: ["one", "two"],
        platforms: ["linux", "darwin"]
      },
      sandbox: {
        policy: "none",
        network: false,
        filesystem: "restricted",
        commands: ["node", "npm"]
      },
      license: "MIT",
      source: "local",
      owner: ""
    });

    const reorderedDigest = capabilityPackageDigest({
      version: "1.2.3",
      name: "Review Skill",
      kind: "skill",
      capabilities: ["alpha", "beta"],
      risk: "repair_write",
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
      secretRefs: ["secret://one", "secret://two"],
      dependencies: [{ kind: "tool", name: "base-tool", versionRange: ">=1.0.0" }],
      compatibility: {
        platforms: ["linux", "darwin"],
        featureIds: ["one", "two"],
        minServerVersion: "1.0.0"
      },
      sandbox: {
        filesystem: "restricted",
        commands: ["node", "npm"],
        policy: "none",
        network: false
      },
      license: "MIT",
      source: "local",
      owner: ""
    });

    expect(reorderedDigest).toBe(capabilityPackageDigest(normalized));
  });

  it("validates plans, dependency checks, and approval gating", async () => {
    const userDataPath = await makeTempUserDataPath();
    const registry = createCapabilityPackageRegistry({ userDataPath });

    const dependency = await registry.submit(toolManifest({
      name: "base-tool",
      version: "1.0.0",
      capabilities: ["base.read"],
      risk: "read_only",
      license: "Apache-2.0"
    }), { submittedBy: "seed" });
    await registry.lifecycle(dependency.record.manifest.packageId, { action: "approve", actor: "reviewer" });
    await registry.lifecycle(dependency.record.manifest.packageId, { action: "install", actor: "installer" });

    const exactPlan = await registry.plan({
      manifest: skillManifest({
        name: "exact-skill",
        version: "2.1.0",
        dependencies: [
          { kind: "tool", name: "base-tool", versionRange: "1.0.0" }
        ],
        capabilities: ["skill.exact"],
        risk: "read_only",
        sandbox: { policy: "knowledge-only" }
      })
    });

    expect(exactPlan.ok).toBe(true);
    expect(exactPlan.approvalRequired).toBe(false);
    expect(exactPlan.missingDependencies).toEqual([]);
    expect(exactPlan.checks.dependencies).toEqual([
      {
        kind: "tool",
        name: "base-tool",
        versionRange: "1.0.0",
        optional: false,
        satisfied: true
      }
    ]);

    const rangePlan = await registry.plan({
      manifest: skillManifest({
        name: "range-skill",
        version: "2.2.0",
        dependencies: [
          { kind: "tool", name: "base-tool", versionRange: ">=1.0.0" }
        ],
        capabilities: ["skill.range"],
        risk: "read_only",
        sandbox: { policy: "knowledge-only" }
      })
    });

    expect(rangePlan.ok).toBe(true);
    expect(rangePlan.checks.dependencies[0]).toMatchObject({
      kind: "tool",
      name: "base-tool",
      versionRange: ">=1.0.0",
      satisfied: true
    });

    const gatedPlan = await registry.plan({
      manifest: toolManifest({
        name: "gated-tool",
        version: "1.0.1",
        capabilities: ["gated.tool"],
        risk: "safe_write",
        secretRefs: ["secret://demo/token"],
        sandbox: {
          policy: "remote-token",
          network: true,
          filesystem: "none"
        }
      })
    });

    expect(gatedPlan.ok).toBe(true);
    expect(gatedPlan.approvalRequired).toBe(true);
    expect(gatedPlan.checks.signature.ok).toBe(true);

    const invalidPlan = await registry.plan({
      kind: "unsupported",
      name: "",
      version: "",
      capabilities: [],
      license: "",
      risk: "destructive-ish",
      inputSchema: { type: "array" },
      outputSchema: { type: "object" },
      sandbox: { policy: "none" },
      signature: { digestSha256: "wrong-digest" }
    });

    expect(invalidPlan.ok).toBe(false);
    expect(invalidPlan.validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "kind" }),
        expect.objectContaining({ field: "name" }),
        expect.objectContaining({ field: "version" }),
        expect.objectContaining({ field: "capabilities" }),
        expect.objectContaining({ field: "license" }),
        expect.objectContaining({ field: "risk" }),
        expect.objectContaining({ field: "inputSchema" }),
        expect.objectContaining({ field: "sandbox.policy" }),
        expect.objectContaining({ field: "signature.digestSha256" })
      ])
    );
  });

  it("submits skill bundles, writes the registry, and reads the persisted state back", async () => {
    const userDataPath = await makeTempUserDataPath();
    const registry = createCapabilityPackageRegistry({ userDataPath });

    const skill = skillManifest({
      name: "persisted-skill",
      version: "3.0.0",
      capabilities: ["skill.persisted"],
      dependencies: [],
      sandbox: { policy: "knowledge-only" }
    });
    const submission = await registry.submit({
      manifest: skill,
      files: [
        {
          path: "SKILL.md",
          contentBase64: Buffer.from("# Persisted Skill\n").toString("base64")
        },
        {
          path: "scripts/check.mjs",
          content: "export function check() { return true; }\n"
        }
      ]
    }, { submittedBy: "legal-ops" });

    expect(submission.record).toMatchObject({
      status: "submitted",
      submittedBy: "legal-ops",
      reviewedBy: "",
      installedAt: "",
      activatedAt: "",
      deprecatedAt: "",
      rollbackOf: ""
    });
    expect(submission.record.library).toMatchObject({
      schemaVersion: 1,
      protocolVersion: "pact.skill-registry.v1",
      storage: "server-skill-library",
      packageId: submission.record.manifest.packageId,
      actor: "legal-ops",
      fileCount: 2,
      totalBytes: Buffer.byteLength("# Persisted Skill\n") + Buffer.byteLength("export function check() { return true; }\n"),
      files: expect.arrayContaining([
        expect.objectContaining({
          path: "SKILL.md",
          byteLength: Buffer.byteLength("# Persisted Skill\n")
        }),
        expect.objectContaining({
          path: "scripts/check.mjs",
          byteLength: Buffer.byteLength("export function check() { return true; }\n")
        })
      ])
    });
    expect(submission.record.library.root).toBe(
      path.join("capability-packages", "skill-library", submission.record.manifest.packageId)
    );
    expect(submission.record.library.manifestPath).toBe(
      path.join("capability-packages", "skill-library", submission.record.manifest.packageId, "manifest.json")
    );

    await expect(fs.readFile(
      path.join(userDataPath, submission.record.library.filesRoot, "SKILL.md"),
      "utf8"
    )).resolves.toBe("# Persisted Skill\n");
    await expect(fs.readFile(
      path.join(userDataPath, submission.record.library.filesRoot, "scripts/check.mjs"),
      "utf8"
    )).resolves.toBe("export function check() { return true; }\n");

    await expect(fs.readFile(
      path.join(userDataPath, "capability-packages", "skill-library", submission.record.manifest.packageId, "manifest.json"),
      "utf8"
    )).resolves.toContain("\"persisted-skill\"");
    await expect(fs.readFile(
      path.join(userDataPath, "capability-packages", "skill-library", submission.record.manifest.packageId, "library.json"),
      "utf8"
    )).resolves.toContain("\"server-skill-library\"");

    const described = await registry.describe();
    expect(described.protocolVersion).toBe("pact.capability-package-lifecycle.v1");
    expect(described.registryPath).toBe(path.join("capability-packages", "registry.json"));
    expect(described.summary).toMatchObject({
      total: 1,
      byKind: { skill: 1 },
      byStatus: { submitted: 1 },
      activeCount: 0
    });
    expect(described.activeByKey).toEqual({});
    expect(described.packages).toHaveLength(1);
    expect(described.packages[0]).toMatchObject({
      status: "submitted",
      manifest: {
        kind: "skill",
        name: "persisted-skill",
        version: "3.0.0",
        protocolVersion: "pact.skill-registry.v1"
      },
      library: {
        storage: "server-skill-library",
        fileCount: 2
      }
    });
    expect(described.auditEvents).toHaveLength(1);
    expect(described.auditEvents[0]).toMatchObject({
      action: "submit",
      packageId: submission.record.manifest.packageId,
      actor: "legal-ops",
      status: "submitted"
    });
  });

  it("transitions package state, supersedes active versions, and rolls back to a prior release", async () => {
    const userDataPath = await makeTempUserDataPath();
    const registry = createCapabilityPackageRegistry({ userDataPath });

    const v1 = await registry.submit(toolManifest({
      name: "shared-tool",
      version: "1.0.0",
      capabilities: ["tool.shared"],
      risk: "read_only"
    }), { submittedBy: "alice" });
    await registry.lifecycle(v1.record.manifest.packageId, { action: "approve", actor: "reviewer" });
    await registry.lifecycle(v1.record.manifest.packageId, { action: "install", actor: "installer" });
    const activeV1 = await registry.lifecycle(v1.record.manifest.packageId, { action: "activate", actor: "release-manager" });

    expect(activeV1.record).toMatchObject({
      status: "active",
      activatedAt: expect.any(String)
    });

    const v2 = await registry.submit(toolManifest({
      name: "shared-tool",
      version: "2.0.0",
      capabilities: ["tool.shared"],
      risk: "read_only"
    }), { submittedBy: "bob" });
    await registry.lifecycle(v2.record.manifest.packageId, { action: "approve", actor: "reviewer" });
    await registry.lifecycle(v2.record.manifest.packageId, { action: "install", actor: "installer" });
    const activeV2 = await registry.lifecycle(v2.record.manifest.packageId, { action: "activate", actor: "release-manager" });

    expect(activeV2.record).toMatchObject({
      status: "active",
      activatedAt: expect.any(String)
    });

    const describedAfterSupersede = await registry.describe();
    expect(describedAfterSupersede.activeByKey["tool:shared-tool"]).toBe(v2.record.manifest.packageId);
    expect(describedAfterSupersede.summary.byStatus).toMatchObject({
      active: 1,
      installed: 1
    });

    const oldRecord = describedAfterSupersede.packages.find((item) => item.manifest.packageId === v1.record.manifest.packageId);
    const newRecord = describedAfterSupersede.packages.find((item) => item.manifest.packageId === v2.record.manifest.packageId);
    expect(oldRecord).toMatchObject({
      status: "installed"
    });
    expect(oldRecord.lifecycleEvents.some((event) => event.action === "superseded")).toBe(true);
    expect(newRecord).toMatchObject({
      status: "active"
    });

    const rolledBack = await registry.rollback({
      kind: "tool",
      name: "shared-tool",
      actor: "release-manager"
    });
    expect(rolledBack.record).toMatchObject({
      manifest: {
        version: "1.0.0"
      },
      status: "active"
    });

    const describedAfterRollback = await registry.describe();
    expect(describedAfterRollback.activeByKey["tool:shared-tool"]).toBe(v1.record.manifest.packageId);
    expect(describedAfterRollback.packages.find((item) => item.manifest.packageId === v1.record.manifest.packageId)).toMatchObject({
      status: "active"
    });
    expect(describedAfterRollback.packages.find((item) => item.manifest.packageId === v2.record.manifest.packageId)).toMatchObject({
      status: "installed"
    });

    const deprecated = await registry.lifecycle(v1.record.manifest.packageId, { action: "deprecate", actor: "maintainer" });
    expect(deprecated.record).toMatchObject({
      status: "deprecated",
      deprecatedAt: expect.any(String)
    });

    const archived = await registry.lifecycle(v1.record.manifest.packageId, { action: "archive", actor: "maintainer" });
    expect(archived.record).toMatchObject({
      status: "archived"
    });

    const finalState = await registry.describe();
    expect(finalState.activeByKey["tool:shared-tool"]).toBeUndefined();
    expect(finalState.summary.byStatus).toMatchObject({
      archived: 1,
      installed: 1
    });
  });

  it("rejects invalid lifecycle transitions and missing rollback targets", async () => {
    const userDataPath = await makeTempUserDataPath();
    const registry = createCapabilityPackageRegistry({ userDataPath });

    const packageRecord = await registry.submit(toolManifest({
      name: "lonely-tool",
      version: "1.0.0",
      capabilities: ["tool.lonely"],
      risk: "read_only"
    }), { submittedBy: "alice" });

    await expect(registry.lifecycle(packageRecord.record.manifest.packageId, { action: "activate", actor: "release-manager" }))
      .rejects.toThrow(`Cannot activate package from status submitted.`);

    await registry.lifecycle(packageRecord.record.manifest.packageId, { action: "approve", actor: "reviewer" });
    await registry.lifecycle(packageRecord.record.manifest.packageId, { action: "install", actor: "installer" });
    await registry.lifecycle(packageRecord.record.manifest.packageId, { action: "activate", actor: "release-manager" });

    await expect(registry.lifecycle(packageRecord.record.manifest.packageId, { action: "approve", actor: "reviewer" }))
      .rejects.toThrow(`Cannot approve package from status active.`);

    await expect(registry.rollback({ kind: "tool", name: "lonely-tool", actor: "release-manager" }))
      .rejects.toThrow(`No rollback target for capability package tool:lonely-tool.`);

    await expect(registry.lifecycle(packageRecord.record.manifest.packageId, { action: "unsupported", actor: "reviewer" }))
      .rejects.toThrow(`Unsupported package lifecycle action: unsupported.`);
  });
});
