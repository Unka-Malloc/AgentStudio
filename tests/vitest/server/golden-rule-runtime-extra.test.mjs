import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createGoldenRuleRuntime,
  GOLDEN_RULE_PROTOCOL_VERSION,
  DEFAULT_GOLDEN_RULE_PACKAGE_ID
} from "../../../server/platform/specialized/knowledge/invocation/golden-rule-runtime/index.mjs";

async function withTempRuntime(callback) {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "pact-golden-rule-runtime-"));
  const runtime = createGoldenRuleRuntime({ userDataPath });
  try {
    return await callback({ runtime, userDataPath });
  } finally {
    await fs.rm(userDataPath, { recursive: true, force: true });
  }
}

function normalizePackageId(value) {
  return String(value || DEFAULT_GOLDEN_RULE_PACKAGE_ID)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildRuleInput({ packageId = "custom-rules", when = { semanticVerdict: "supported" }, action = "canary_allowed", targetType = "knowledgeSkill", ruleId = "supported_rule" } = {}) {
  return {
    packageId,
    status: "draft",
    rules: [
      {
        ruleId,
        label: "Unit rule",
        priority: 100,
        targetTypes: [targetType],
        when,
        action
      }
    ]
  };
}

describe("golden rule runtime extra coverage", () => {
  it("lazily creates and reads the default package", async () => {
    await withTempRuntime(async ({ runtime, userDataPath }) => {
      const packages = await runtime.listRulePackages();
      expect(packages.items).toHaveLength(1);
      expect(packages.items[0]).toMatchObject({
        packageId: DEFAULT_GOLDEN_RULE_PACKAGE_ID,
        activeVersion: 1,
        protocolVersion: GOLDEN_RULE_PROTOCOL_VERSION
      });
      expect(packages.items[0].versions).toHaveLength(1);

      const active = await runtime.getActiveRulePackage();
      const loaded = await runtime.getRulePackage();
      expect(loaded).toMatchObject({
        protocolVersion: GOLDEN_RULE_PROTOCOL_VERSION,
        packageId: DEFAULT_GOLDEN_RULE_PACKAGE_ID,
        version: 1,
        status: "active"
      });
      expect(active).toEqual(loaded);
      expect(loaded.rules).toHaveLength(6);

      const manifest = JSON.parse(await fs.readFile(path.join(userDataPath, "knowledge-golden", "packages", "default-golden-rules", "manifest.json"), "utf8"));
      const versionFile = JSON.parse(await fs.readFile(path.join(userDataPath, "knowledge-golden", "packages", "default-golden-rules", "versions", "v1.json"), "utf8"));
      expect(manifest.packageId).toBe(DEFAULT_GOLDEN_RULE_PACKAGE_ID);
      expect(versionFile.version).toBe(1);
      expect(versionFile.rules[0].ruleId).toBe("golden_rule_no_evidence_auto_reject");
    });
  });

  it("saves, publishes and rolls back rule package versions", async () => {
    await withTempRuntime(async ({ runtime }) => {
      const first = await runtime.saveRulePackage(buildRuleInput({
        packageId: "release policy",
        when: { semanticVerdict: "supported" },
        action: "canary_allowed",
        ruleId: "supported_rule"
      }));
      const normalizedPackageId = normalizePackageId(first.package.packageId);
      expect(first.package.packageId).toBe(normalizedPackageId);
      expect(first.package.version).toBe(1);

      const publishFirst = await runtime.publishRulePackage({ packageId: normalizedPackageId, version: 1 });
      expect(publishFirst.package.status).toBe("active");

      const second = await runtime.saveRulePackage(buildRuleInput({
        packageId: normalizedPackageId,
        when: { semanticVerdict: "unsupported" },
        action: "auto_reject",
        ruleId: "unsupported_rule"
      }));
      expect(second.package.version).toBe(2);
      const publishSecond = await runtime.publishRulePackage({ packageId: normalizedPackageId, version: 2 });
      expect(publishSecond.package.status).toBe("active");

      const activeBeforeRollback = await runtime.applyRules({
        packageId: normalizedPackageId,
        targetType: "knowledgeSkill",
        candidate: { qualityReportV2: { semanticSupport: { verdict: "unsupported" } } }
      });
      expect(activeBeforeRollback.decision).toBe("auto_reject");

      const rollback = await runtime.rollbackRulePackage({ packageId: normalizedPackageId, version: 1 });
      expect(rollback.manifest.activeVersion).toBe(1);
      expect(rollback.package.version).toBe(1);
      expect(rollback.package.status).toBe("active");

      const afterRollback = await runtime.applyRules({
        packageId: normalizedPackageId,
        targetType: "knowledgeSkill",
        candidate: { qualityReportV2: { semanticSupport: { verdict: "supported" } } }
      });
      expect(afterRollback.decision).toBe("canary_allowed");
      expect(afterRollback.ok).toBe(true);

      const missingPublish = await runtime.publishRulePackage({ packageId: "ghost-package", version: 1 });
      expect(missingPublish).toBeNull();
      const missingRollback = await runtime.rollbackRulePackage({ packageId: "ghost-package", version: 1 });
      expect(missingRollback).toBeNull();
      const missing = await runtime.getRulePackage({ packageId: "ghost-package" });
      expect(missing).toBeNull();
    });
  });

  it("applies default package behavior when package is missing", async () => {
    await withTempRuntime(async ({ runtime }) => {
      const fallback = await runtime.applyRules({
        packageId: "does-not-exist",
        targetType: "knowledgeSkill",
        candidate: {}
      });
      expect(fallback.packageId).toBe(DEFAULT_GOLDEN_RULE_PACKAGE_ID);
      expect(fallback.decision).toBe("auto_reject");
      expect(fallback.ok).toBe(false);
      expect(fallback.packageVersion).toBe(1);
    });
  });

  it("validates packages and reports failure branches", async () => {
    await withTempRuntime(async ({ runtime }) => {
      const valid = await runtime.validateRulePackage({
        package: {
          protocolVersion: GOLDEN_RULE_PROTOCOL_VERSION,
          packageId: "valid-package",
          status: "draft",
          rules: [
            {
              ruleId: "supported_rule",
              label: "支持候选",
              targetTypes: ["knowledgeSkill"],
              when: { semanticVerdict: "supported" },
              action: "canary_allowed",
              priority: 100
            }
          ]
        },
        scenarios: [
          {
            scenarioId: "supported-hit",
            targetType: "knowledgeSkill",
            candidate: { qualityReportV2: { semanticSupport: { verdict: "supported" } } },
            expectedDecision: "canary_allowed"
          }
        ]
      });

      expect(valid.ok).toBe(true);
      expect(valid.scenarios).toHaveLength(1);
      expect(valid.scenarios[0]).toMatchObject({ scenarioId: "supported-hit", passed: true });

      const scenarioFail = await runtime.validateRulePackage({
        package: valid.package,
        scenarios: [
          {
            scenarioId: "mismatch",
            targetType: "knowledgeSkill",
            candidate: { qualityReportV2: { semanticSupport: { verdict: "unsupported" } } },
            expectedDecision: "auto_reject"
          }
        ]
      });
      expect(scenarioFail.ok).toBe(false);
      expect(scenarioFail.scenarios[0]).toMatchObject({ scenarioId: "mismatch", passed: false });

      const invalid = await runtime.validateRulePackage({
        package: {
          protocolVersion: GOLDEN_RULE_PROTOCOL_VERSION,
          packageId: "",
          rules: [
            {
              ruleId: "invalid_rule",
              label: "bad",
              when: {},
              action: ""
            }
          ]
        }
      });
      expect(invalid.ok).toBe(false);
      const failedChecks = invalid.checks.filter((check) => !check.passed).map((check) => check.checkId);
      expect(failedChecks).toEqual(["package_id", "rule_actions", "rule_conditions"]);
    });
  });

  it("lists, saves and exports gold cases using temporary storage", async () => {
    await withTempRuntime(async ({ runtime, userDataPath }) => {
      const empty = await runtime.listGoldCases();
      expect(empty).toMatchObject({
        protocolVersion: GOLDEN_RULE_PROTOCOL_VERSION,
        count: 0,
        items: []
      });

      const first = await runtime.saveGoldCase({
        query: "what is A?",
        expectedSkillId: "skill-a",
        requiredEvidenceIds: ["ev-a", "ev-b"],
        answerRubric: "answer-a",
        tags: ["urgent"]
      });
      const second = await runtime.saveGoldCase({
        query: "what is B?",
        expectedSkillId: "skill-b",
        requiredEvidenceIds: ["ev-c"],
        answerRubric: "answer-b"
      });

      const all = await runtime.listGoldCases();
      expect(all.items).toHaveLength(2);
      expect(new Set(all.items.map((item) => item.caseId))).toEqual(new Set([first.goldCase.caseId, second.goldCase.caseId]));

      const urgentOnly = await runtime.listGoldCases({ tag: "urgent", limit: 10 });
      expect(urgentOnly.items.map((item) => item.caseId)).toEqual([first.goldCase.caseId]);

      const goldenOnly = await runtime.listGoldCases({ tag: "golden", limit: 10 });
      expect(goldenOnly.count).toBeGreaterThanOrEqual(2);

      const exportResult = await runtime.exportTrainingSet();
      expect(exportResult.protocolVersion).toBe(GOLDEN_RULE_PROTOCOL_VERSION);
      expect(exportResult.ok).toBe(true);
      expect(exportResult.recordCount).toBe(8);
      expect(exportResult.taskTypes).toHaveLength(4);
      const exported = await fs.readFile(exportResult.filePath, "utf8");
      const lines = exported.trim().split("\n").filter(Boolean);
      expect(lines).toHaveLength(exportResult.recordCount);
      const parsed = JSON.parse(lines[0]);
      expect(parsed.protocolVersion).toBe(GOLDEN_RULE_PROTOCOL_VERSION);
      expect(parsed.taskType).toBe(exportResult.taskTypes[0]);
      expect(parsed.audit.source).toBe("manual");
      expect(exportResult.filePath).toContain(path.join(userDataPath, "knowledge-golden"));
    });
  });
});
