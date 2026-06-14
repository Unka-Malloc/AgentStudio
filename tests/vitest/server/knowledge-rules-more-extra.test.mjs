import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_GOLDEN_RULE_PACKAGE_ID,
  GOLDEN_RULE_PROTOCOL_VERSION,
  createGoldenRuleRuntime
} from "../../../server/platform/specialized/knowledge/invocation/golden-rule-runtime/index.mjs";
import { runEmailAnalysis } from "../../../server/platform/specialized/knowledge/preprocessing/domain/rules/email-analysis.mjs";
import { buildTransactionContinuityModel } from "../../../server/platform/specialized/knowledge/preprocessing/domain/rules/transaction-continuity-model.mjs";

const GENERATED_AT = "2026-06-04T00:00:00.000Z";
const BASE_SETTINGS = {
  retrievalHalfLifeDays: 14,
  staleAfterDays: 30
};

const tempRoots = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function makeTempRoot(prefix) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

async function withTempRuntime(callback) {
  const userDataPath = await makeTempRoot("pact-knowledge-rules-more-golden-");
  const runtime = createGoldenRuleRuntime({ userDataPath });
  return callback({ runtime, userDataPath });
}

function runEmailAnalysisWithDefaults({ sources = [], chunks = [], settings = {}, rules = {} }) {
  return runEmailAnalysis({
    sources,
    chunks,
    settings: {
      ...BASE_SETTINGS,
      ...settings
    },
    generatedAt: GENERATED_AT,
    rules
  });
}

function emlFixture({
  from = "Sender <sender@example.test>",
  to = "user@example.local",
  cc = "",
  subject,
  date = "Mon, 05 Jun 2026 10:00:00 +0000",
  messageId,
  body = ""
}) {
  const lines = [`From: ${from}`, `To: ${to}`];
  if (cc) {
    lines.push(`Cc: ${cc}`);
  }
  if (subject !== undefined) {
    lines.push(`Subject: ${subject}`);
  }
  lines.push(`Date: ${date}`, `Message-ID: <${messageId}>`, "Content-Type: text/plain; charset=utf-8", "", body);
  return lines.join("\n");
}

async function writeMail(root, fileName, value) {
  await fs.writeFile(path.join(root, fileName), value, "utf8");
}

describe("golden rule runtime normalization and fallback coverage", () => {
  it("normalizes package ids, matches duplicate gates, and falls back to human review", async () => {
    await withTempRuntime(async ({ runtime, userDataPath }) => {
      const saved = await runtime.saveRulePackage({
        packageId: "  Policy / 01  ",
        status: " draft ",
        source: " manual ",
        rules: [
          {
            ruleId: " duplicate gate ",
            label: " duplicate gate ",
            priority: 100,
            targetTypes: ["knowledgeSkill", " knowledgeSkill "],
            when: {
              evidenceCountLessThan: 2,
              duplicate: {
                mode: " exact ",
                exact: true,
                scoreAtLeast: 1,
                requireMatchedFieldsAll: ["title"],
                requireMatchedFieldsAny: ["title", "body"],
                existingIdRequired: true
              }
            },
            action: " canary_allowed ",
            reason: " matched "
          },
          {
            ruleId: "ignored",
            enabled: false,
            targetTypes: ["knowledgeSkill"],
            when: { semanticVerdict: "unsupported" },
            action: "auto_reject"
          }
        ]
      });

      expect(saved.package).toMatchObject({
        packageId: "policy-01",
        status: "draft",
        source: "manual",
        version: 1
      });
      expect(saved.package.rules[0]).toMatchObject({
        ruleId: "duplicate gate",
        label: "duplicate gate",
        action: "canary_allowed",
        reason: "matched"
      });
      expect(saved.package.rules[0].targetTypes).toEqual(["knowledgeSkill"]);

      const matched = await runtime.applyRules({
        packageId: "POLICY / 01",
        targetType: "knowledgeSkill",
        candidate: {
          evidenceRefs: ["evidence-1"],
          duplicate: {
            verdict: "exact_duplicate",
            score: 1,
            matchedFields: ["title", "body"],
            existingId: "existing-1"
          },
          canonicalPatch: { field: true }
        }
      });

      expect(matched.packageId).toBe("policy-01");
      expect(matched.decision).toBe("canary_allowed");
      expect(matched.ok).toBe(true);
      expect(matched.selectedRule.ruleId).toBe("duplicate gate");
      expect(matched.context.duplicate).toMatchObject({
        verdict: "exact_duplicate",
        exact: true,
        score: 1,
        matchedFields: ["title", "body"],
        existingId: "existing-1"
      });

      const fallbackPackage = await runtime.saveRulePackage({
        packageId: "fallback package",
        rules: [
          {
            ruleId: "other-target",
            targetTypes: ["knowledgeSkillSet"],
            when: { evidenceCountLessThan: 1 },
            action: "auto_reject"
          }
        ]
      });
      expect(fallbackPackage.package.packageId).toBe("fallback-package");

      const fallback = await runtime.applyRules({
        packageId: "fallback package",
        targetType: "knowledgeSkill",
        candidate: {}
      });

      expect(fallback.selectedRule.ruleId).toBe("golden_rule_default_human_review");
      expect(fallback.decision).toBe("needs_human_review");
      expect(fallback.ok).toBe(false);
      expect(fallback.recommendations[0]).toContain("没有黄金规则明确允许自动处理");

      const invalidProtocol = await runtime.validateRulePackage({
        package: {
          protocolVersion: "v0.0.1:knowledge:golden-rule-0",
          packageId: "",
          rules: []
        }
      });
      expect(invalidProtocol.ok).toBe(false);
      expect(invalidProtocol.checks.filter((check) => !check.passed).map((check) => check.checkId)).toEqual([
        "protocol_version",
        "package_id",
        "rules_present"
      ]);

      const invalidRules = await runtime.validateRulePackage({
        package: {
          protocolVersion: GOLDEN_RULE_PROTOCOL_VERSION,
          packageId: "rule-set",
          rules: [
            {
              ruleId: "broken",
              label: "broken",
              when: {},
              action: ""
            }
          ]
        }
      });
      expect(invalidRules.ok).toBe(false);
      expect(invalidRules.checks.filter((check) => !check.passed).map((check) => check.checkId)).toEqual([
        "rule_actions",
        "rule_conditions"
      ]);

      const packages = await runtime.listRulePackages();
      expect(packages.items.map((item) => item.packageId)).toEqual([
        DEFAULT_GOLDEN_RULE_PACKAGE_ID,
        "fallback-package",
        "policy-01"
      ]);
      await fs.access(path.join(userDataPath, "knowledge-golden", "packages", "policy-01", "manifest.json"));
    });
  });

  it("records feedback when saving gold cases from skill resolutions", async () => {
    await withTempRuntime(async ({ userDataPath }) => {
      const knowledgeCore = { recordFeedback: vi.fn() };
      const runtime = createGoldenRuleRuntime({ userDataPath, knowledgeCore });

      const result = await runtime.saveGoldCaseFromSkillResolution({
        action: "publish",
        skill: {
          sourceQuery: "How should we handle this?",
          skillId: "skill-123",
          evidenceRefs: ["ev-1", "ev-2"],
          summary: "Summarize the resolution",
          status: "draft",
          qualityReport: { passed: true }
        }
      });

      expect(result.goldCase).toMatchObject({
        query: "How should we handle this?",
        expectedSkillId: "skill-123",
        requiredEvidenceIds: ["ev-1", "ev-2"],
        source: "skill_review_resolution"
      });
      expect(result.goldCase.tags).toEqual(expect.arrayContaining(["skill-review", "publish"]));
      expect(knowledgeCore.recordFeedback).toHaveBeenCalledTimes(1);
      expect(knowledgeCore.recordFeedback).toHaveBeenCalledWith(
        expect.objectContaining({
          query: "How should we handle this?",
          action: "expert_feedback",
          evidenceId: "ev-1",
          context: expect.objectContaining({
            gold: true,
            humanExpert: true,
            caseId: result.goldCase.caseId,
            evidenceRefs: ["ev-1", "ev-2"],
            expectedSkillId: "skill-123"
          })
        })
      );
    });
  });
});

describe("email analysis normalization and boundary coverage", () => {
  it("strips quoted and MIME lines, and converts decision, handoff, and historical states", () => {
    const result = runEmailAnalysisWithDefaults({
      sources: [
        {
          id: "src-decision",
          kind: "email",
          name: "方案确认",
          text: [
            "From: Leader <lead@acme.com>",
            "To: Ops <ops@acme.com>",
            "Subject: Re: 方案确认",
            "Date: 2026-05-05T00:00:00.000Z",
            "",
            "> quoted line",
            "Content-Type: text/plain; charset=utf-8",
            "--boundary",
            "决定：按此执行。",
            "-----Original Message-----",
            "ignored"
          ].join("\n")
        },
        {
          id: "src-handoff",
          kind: "email",
          name: "项目交接",
          text: [
            "From: Manager <mgr@acme.com>",
            "Cc: Team <team@acme.com>",
            "Subject: 项目交接",
            "Date: 2026-05-06T00:00:00.000Z",
            "",
            "请知悉。"
          ].join("\n")
        },
        {
          id: "src-historical",
          kind: "email",
          name: "历史待确认",
          text: [
            "From: Owner <owner@acme.com>",
            "To: Team <team@acme.com>",
            "Subject: 待确认",
            "Date: 2026-05-04T00:00:00.000Z",
            "",
            "待确认：请回复。"
          ].join("\n")
        }
      ],
      chunks: [],
      rules: {}
    });

    expect(result.overview).toMatchObject({
      emailCount: 3,
      threadCount: 3,
      transactionCount: 3
    });

    const decision = result.emails.find((item) => item.sourceId === "src-decision");
    const handoff = result.emails.find((item) => item.sourceId === "src-handoff");
    const historical = result.emails.find((item) => item.sourceId === "src-historical");
    const historicalTransaction = result.transactions.find((item) => item.title === "待确认");

    expect(decision.body).toBe("决定：按此执行。");
    expect(decision.status).toBe("active");
    expect(handoff.cc).toHaveLength(1);
    expect(handoff.to).toHaveLength(0);
    expect(historical.status).toBe("watch");
    expect(historical.freshness).toBe("historical");
    expect(historical.formalUseAllowed).toBe(false);
    expect(historicalTransaction).toMatchObject({
      status: "stale",
      freshness: "historical",
      formalUseAllowed: false
    });
    expect(result.timeline.map((item) => item.type)).toEqual([
      "follow-up",
      "decision",
      "handoff"
    ]);
  });
});

describe("transaction continuity review and fallback coverage", () => {
  it("runs the review pass at the exact reviewEvery boundary", async () => {
    const root = await makeTempRoot("pact-knowledge-rules-more-tx-");
    const mailRoot = path.join(root, "mail");
    const outputPath = path.join(root, "out");
    await fs.mkdir(mailRoot, { recursive: true });

    await writeMail(
      mailRoot,
      "simple.eml",
      emlFixture({
        from: "Ops <ops@example.com>",
        to: "user@example.local",
        subject: "项目同步",
        date: "Mon, 05 May 2026 10:00:00 +0000",
        messageId: "simple-1",
        body: "这是一封普通同步邮件。"
      })
    );

    const result = await buildTransactionContinuityModel({
      roots: [mailRoot],
      outputPath,
      rebuild: false,
      reviewEvery: 1,
      reviewDaily: false,
      maxDocs: 0
    });

    expect(result.manifest.stats.reviewExecuted).toBe(true);
    expect(result.manifest.stats.reviewInputCount).toBe(1);
    expect(result.manifest.stats.reviewTransactionCount).toBe(1);
    expect(result.manifest.stats.reviewMigratedFiles).toBe(1);
    expect(result.summaries).toHaveLength(1);
    expect(result.summaries[0].title).toBeTruthy();
    expect(result.summaries[0]).toMatchObject({
      category: "general",
      cadence: "irregular",
      occurrenceCount: 1
    });
    expect(result.generatedDocCount).toBe(1);
  });
});
