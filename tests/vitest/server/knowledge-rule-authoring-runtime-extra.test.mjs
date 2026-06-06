import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  KNOWLEDGE_RULE_AUTHORING_PROTOCOL_VERSION,
  GOLDEN_RULE_TEMPLATE_PROTOCOL_VERSION,
  createKnowledgeRuleAuthoringRuntime
} from "../../../server/platform/specialized/knowledge/invocation/knowledge-rule-authoring-runtime/index.mjs";

const tempRoots = [];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-04T00:00:00.000Z"));
});

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(
    tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))
  );
});

async function makeTempUserDataPath(prefix = "pact-knowledge-rule-authoring-runtime-extra-") {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

async function writeTemplateCatalog(userDataPath, { defaults = [], overrides = [] } = {}) {
  const defaultTemplatePath = path.join(userDataPath, "default-templates.json");
  const overrideTemplatePath = path.join(userDataPath, "knowledge-golden", "rule-templates.json");
  await fs.mkdir(path.dirname(overrideTemplatePath), { recursive: true });
  await fs.writeFile(
    defaultTemplatePath,
    `${JSON.stringify(
      {
        protocolVersion: GOLDEN_RULE_TEMPLATE_PROTOCOL_VERSION,
        templates: defaults
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await fs.writeFile(
    overrideTemplatePath,
    `${JSON.stringify(
      {
        protocolVersion: GOLDEN_RULE_TEMPLATE_PROTOCOL_VERSION,
        templates: overrides
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  return { defaultTemplatePath, overrideTemplatePath };
}

function createGoldenRuleRuntime({
  validateRulePackage = vi.fn(),
  saveRulePackage = vi.fn()
} = {}) {
  return {
    validateRulePackage,
    saveRulePackage
  };
}

function createModelDecisionRuntime(decisionsByRoleId = {}) {
  return {
    decide: vi.fn(async ({ roleId }) => {
      const decision = decisionsByRoleId[roleId];
      if (typeof decision === "function") {
        return decision();
      }
      return decision;
    })
  };
}

function makeTemplateCatalog() {
  return {
    defaults: [
      {
        id: " rule-one ",
        label: "  采购   审核  ",
        description: " default template ",
        intentKeywords: [
          "采购 审核",
          "alpha",
          "beta",
          "gamma",
          "delta",
          "epsilon",
          "zeta",
          "eta",
          "theta",
          "iota",
          "kappa",
          "lambda",
          "mu"
        ],
        variables: {
          packageId: "!!!",
          ruleId: " base rule ",
          label: "",
          description: "",
          source: "",
          extra: "base-extra"
        },
        gate: {
          testScenarios: [
            {
              scenarioId: "base-scenario",
              targetType: "knowledgeSkill",
              expectedDecision: "canary_allowed"
            }
          ]
        },
        package: {
          packageId: "{{packageId}}",
          metadata: {
            label: "{{label}}",
            description: "{{description}}",
            source: "{{source}}",
            message: "{{userMessage}}"
          },
          details: ["{{ruleId}}", { note: "{{extra}}" }]
        }
      },
      {
        templateId: "template-two",
        label: "Second template",
        intentKeywords: ["other"],
        variables: {
          packageId: "secondary",
          ruleId: "secondary_rule"
        },
        gate: {
          testScenarios: []
        },
        package: {
          packageId: "{{packageId}}"
        }
      },
      {
        label: "missing id should be ignored"
      }
    ],
    overrides: [
      {
        templateId: "rule-one",
        label: " 覆盖 标签 ",
        description: " override description ",
        intentKeywords: ["采购 审核", "override-only"],
        variables: {
          ruleId: " override rule ",
          source: "override-source",
          extra: "override-extra"
        },
        gate: {
          scenarios: [
            {
              scenarioId: "override-scenario",
              targetType: "knowledgeSkill",
              expectedDecision: "canary_allowed"
            }
          ]
        }
      }
    ]
  };
}

describe("knowledge rule authoring runtime describe and template loading", () => {
  it("loads merged templates, trims summaries, and tolerates missing template files", async () => {
    const userDataPath = await makeTempUserDataPath();
    const runtime = createKnowledgeRuleAuthoringRuntime({
      userDataPath,
      templatePath: path.join(userDataPath, "missing-default-templates.json")
    });

    const emptyDescription = await runtime.describe();
    expect(emptyDescription.protocolVersion).toBe(KNOWLEDGE_RULE_AUTHORING_PROTOCOL_VERSION);
    expect(emptyDescription.templateCatalog.templates).toEqual([]);
    expect(emptyDescription.stages).toEqual([
      "load_templates",
      "intent_recognition",
      "template_selection",
      "template_generation",
      "golden_rule_gate",
      "submit_for_human_confirmation"
    ]);

    const { defaultTemplatePath } = await writeTemplateCatalog(userDataPath, makeTemplateCatalog());
    const templatedRuntime = createKnowledgeRuleAuthoringRuntime({
      userDataPath,
      templatePath: defaultTemplatePath
    });
    const description = await templatedRuntime.describe();

    expect(description.templateCatalog.protocolVersion).toBe(GOLDEN_RULE_TEMPLATE_PROTOCOL_VERSION);
    expect(description.templateCatalog.templatePath).toBe(defaultTemplatePath);
    expect(description.templateCatalog.userTemplatePath).toBe(
      path.join(userDataPath, "knowledge-golden", "rule-templates.json")
    );
    expect(description.templateCatalog.templates).toHaveLength(2);
    expect(description.templateCatalog.templates[0]).toMatchObject({
      templateId: "rule-one",
      label: " 覆盖 标签 ",
      description: " override description ",
      intentKeywords: ["采购 审核", "override-only"],
      variables: {
        packageId: "!!!",
        ruleId: " override rule ",
        label: "",
        description: "",
        source: "override-source",
        extra: "override-extra"
      },
      gate: {
        testScenarios: [
          {
            scenarioId: "base-scenario",
            targetType: "knowledgeSkill",
            expectedDecision: "canary_allowed"
          }
        ],
        scenarios: [
          {
            scenarioId: "override-scenario",
            targetType: "knowledgeSkill",
            expectedDecision: "canary_allowed"
          }
        ]
      }
    });
    expect(description.templateCatalog.templates[1]).toMatchObject({
      templateId: "template-two",
      label: "Second template",
      intentKeywords: ["other"]
    });
    expect(description.templateCatalog.templates[0].intentKeywords).toHaveLength(2);
  });
});

describe("knowledge rule authoring runtime validation branches", () => {
  it("rejects invalid input before consulting external runtimes", async () => {
    const userDataPath = await makeTempUserDataPath();
    const runtime = createKnowledgeRuleAuthoringRuntime({
      userDataPath,
      goldenRuleRuntime: createGoldenRuleRuntime()
    });

    await expect(runtime.chat({ message: "   " })).resolves.toEqual({
      protocolVersion: KNOWLEDGE_RULE_AUTHORING_PROTOCOL_VERSION,
      ok: false,
      status: "invalid_input",
      error: "message 不能为空。"
    });
  });

  it("reports runtime unavailable when the golden rule gate is missing", async () => {
    const userDataPath = await makeTempUserDataPath();
    const runtime = createKnowledgeRuleAuthoringRuntime({
      userDataPath
    });

    await expect(runtime.chat({ message: "有效消息" })).resolves.toEqual({
      protocolVersion: KNOWLEDGE_RULE_AUTHORING_PROTOCOL_VERSION,
      ok: false,
      status: "runtime_unavailable",
      error: "黄金规则门禁不可用。"
    });
  });

  it("stores no-rule runs, replaces duplicate run ids, and sorts run listings", async () => {
    const userDataPath = await makeTempUserDataPath();
    const runtime = createKnowledgeRuleAuthoringRuntime({
      userDataPath,
      goldenRuleRuntime: createGoldenRuleRuntime()
    });

    vi.setSystemTime(new Date("2026-06-04T01:00:00.000Z"));
    const first = await runtime.chat({ message: "闲聊 一" });
    const firstDuplicate = await runtime.chat({ message: "闲聊 一" });
    vi.setSystemTime(new Date("2026-06-04T01:05:00.000Z"));
    const second = await runtime.chat({ message: "闲聊 二" });

    expect(first.status).toBe("no_rule_needed");
    expect(firstDuplicate.runId).toBe(first.runId);
    expect(second.status).toBe("no_rule_needed");

    const latest = await runtime.getRun({ id: second.runId });
    expect(latest).toMatchObject({
      runId: second.runId,
      message: "闲聊 二"
    });
    expect(await runtime.getRun({ runId: "missing-run" })).toBeNull();

    const listed = await runtime.listRuns({ limit: 999 });
    expect(listed.protocolVersion).toBe(KNOWLEDGE_RULE_AUTHORING_PROTOCOL_VERSION);
    expect(listed.items).toHaveLength(2);
    expect(listed.items[0].message).toBe("闲聊 二");
    expect(listed.items[1].message).toBe("闲聊 一");
    expect((await runtime.listRuns({ limit: 1 })).items).toHaveLength(1);
  });
});

describe("knowledge rule authoring runtime rule generation", () => {
  it("generates deterministically when no model runtime is available", async () => {
    const userDataPath = await makeTempUserDataPath();
    const { defaultTemplatePath } = await writeTemplateCatalog(userDataPath, makeTemplateCatalog());
    const validateRulePackage = vi.fn(async ({ package: rulePackage, testScenarios }) => ({
      ok: true,
      package: {
        ...rulePackage,
        validated: true
      },
      checks: [
        {
          checkId: "gate",
          passed: true
        }
      ],
      scenarios: testScenarios.map((scenario) => ({
        ...scenario,
        passed: true
      })),
      recommendations: ["ok"]
    }));
    const saveRulePackage = vi.fn(async (rulePackage) => ({
      package: {
        ...rulePackage,
        version: 3,
        status: rulePackage.status
      },
      manifest: {
        packageId: rulePackage.packageId,
        version: 3,
        source: rulePackage.source
      }
    }));
    const runtime = createKnowledgeRuleAuthoringRuntime({
      userDataPath,
      templatePath: defaultTemplatePath,
      goldenRuleRuntime: createGoldenRuleRuntime({
        validateRulePackage,
        saveRulePackage
      })
    });

    vi.setSystemTime(new Date("2026-06-04T02:00:00.000Z"));
    const result = await runtime.chat({
      message: "请做采购 审核，并生成黄金规则"
    });

    expect(result).toMatchObject({
      protocolVersion: KNOWLEDGE_RULE_AUTHORING_PROTOCOL_VERSION,
      ok: true,
      status: "pending_human_confirmation",
      humanConfirmationRequired: true,
      intent: {
        needsRule: true,
        templateId: "rule-one"
      },
      template: {
        templateId: "rule-one",
        label: "覆盖 标签",
        description: "override description"
      }
    });
    expect(result.package).toMatchObject({
      status: "draft",
      source: "agent-rule-authoring",
      validated: true,
      metadata: {
        label: "覆盖 标签",
        description: "override description",
        source: "override-source",
        message: "请做采购 审核，并生成黄金规则"
      },
      details: ["override rule", { note: "override-extra" }]
    });
    expect(result.package.packageId).toMatch(/^agent-rule-/);
    expect(result.confirmation).toMatchObject({
      packageId: result.package.packageId,
      version: 3,
      action: "publish_golden_rule_package"
    });
    expect(result.confirmation.publishEndpoint).toBe(
      `/api/knowledge/golden-rules/${encodeURIComponent(result.package.packageId)}/publish`
    );
    expect(result.steps.map((step) => step.stage)).toEqual([
      "load_templates",
      "intent_recognition",
      "template_selection",
      "template_generation",
      "golden_rule_gate",
      "submit_for_human_confirmation"
    ]);
    expect(result.steps[3]).toMatchObject({
      stage: "template_generation",
      audit: {
        mode: "deterministic"
      }
    });
    expect(validateRulePackage).toHaveBeenCalledTimes(1);
    expect(validateRulePackage).toHaveBeenCalledWith({
      package: expect.objectContaining({
        packageId: result.package.packageId,
        metadata: {
          label: "覆盖 标签",
          description: "override description",
          source: "override-source",
          message: "请做采购 审核，并生成黄金规则"
        },
        details: ["override rule", { note: "override-extra" }]
      }),
      testScenarios: [
        {
          scenarioId: "base-scenario",
          targetType: "knowledgeSkill",
          expectedDecision: "canary_allowed"
        }
      ]
    });
    expect(saveRulePackage).toHaveBeenCalledTimes(1);
    expect(saveRulePackage).toHaveBeenCalledWith(
      expect.objectContaining({
        packageId: result.package.packageId,
        source: "agent-rule-authoring",
        status: "draft"
      })
    );
  });

  it("uses model-backed intent and generation decisions when available", async () => {
    const userDataPath = await makeTempUserDataPath();
    const { defaultTemplatePath } = await writeTemplateCatalog(userDataPath, makeTemplateCatalog());
    const validateRulePackage = vi.fn(async ({ package: rulePackage }) => ({
      ok: true,
      package: {
        ...rulePackage,
        validatedByGate: true
      },
      checks: [],
      scenarios: [],
      recommendations: []
    }));
    const saveRulePackage = vi.fn(async (rulePackage) => ({
      package: {
        ...rulePackage,
        version: 5,
        status: rulePackage.status
      },
      manifest: {
        packageId: rulePackage.packageId,
        version: 5
      }
    }));
    const modelDecisionRuntime = createModelDecisionRuntime({
      rule_authoring_intent: {
        decision: {
          target: "GoldenRulePackage",
          template: "rule-one",
          confidence: "0.87",
          reason: "  model picked the authoring template  "
        },
        audit: {
          provider: "intent-model"
        }
      },
      golden_rule_generator: {
        decision: {
          templateId: "rule-one",
          variables: {
            packageId: "   ",
            ruleId: " model generated rule ",
            label: " Generated Label ",
            description: " Generated Description ",
            source: " generator-source "
          },
          notes: ["from model", "", null]
        },
        audit: {
          provider: "generator-model"
        }
      }
    });
    const runtime = createKnowledgeRuleAuthoringRuntime({
      userDataPath,
      templatePath: defaultTemplatePath,
      goldenRuleRuntime: createGoldenRuleRuntime({
        validateRulePackage,
        saveRulePackage
      }),
      modelDecisionRuntime
    });

    vi.setSystemTime(new Date("2026-06-04T03:00:00.000Z"));
    const result = await runtime.chat({
      message: "请生成采购审核规则",
      modelAlias: "mock-model",
      modelEnabled: true
    });

    expect(result.status).toBe("pending_human_confirmation");
    expect(result.intent).toMatchObject({
      needsRule: true,
      templateId: "rule-one",
      intent: "none",
      confidence: 0.87,
      reason: "model picked the authoring template"
    });
    expect(result.steps[1]).toMatchObject({
      stage: "intent_recognition",
      audit: {
        provider: "intent-model"
      }
    });
    expect(result.steps[3]).toMatchObject({
      stage: "template_generation",
      audit: {
        provider: "generator-model"
      }
    });
    expect(result.package).toMatchObject({
      status: "draft",
      source: "agent-rule-authoring",
      validatedByGate: true,
      metadata: {
        label: "Generated Label",
        description: "Generated Description",
        source: "generator-source",
        message: "请生成采购审核规则"
      },
      details: ["model generated rule", { note: "override-extra" }]
    });
    expect(result.package.packageId).toMatch(/^agent-rule-/);
    expect(modelDecisionRuntime.decide).toHaveBeenCalledTimes(2);
    expect(modelDecisionRuntime.decide.mock.calls[0][0]).toMatchObject({
      roleId: "rule_authoring_intent",
      modelAlias: "mock-model",
      modelEnabled: true,
      input: {
        message: "请生成采购审核规则",
        fallbackIntent: expect.objectContaining({
          needsRule: false,
          templateId: ""
        }),
        templates: expect.arrayContaining([
          expect.objectContaining({
            templateId: "rule-one",
            label: "覆盖 标签",
            description: "override description",
            intentKeywords: [
              "采购 审核",
              "override-only"
            ]
          })
        ])
      }
    });
    expect(modelDecisionRuntime.decide.mock.calls[1][0]).toMatchObject({
      roleId: "golden_rule_generator",
      modelAlias: "mock-model",
      modelEnabled: true,
      input: {
        intent: expect.objectContaining({
          templateId: "rule-one"
        }),
        allowedOutput: {
          templateId: "string",
          variables: {
            packageId: "string",
            ruleId: "string",
            label: "string",
            description: "string"
          }
        }
      }
    });
    expect(validateRulePackage).toHaveBeenCalledTimes(1);
    expect(saveRulePackage).toHaveBeenCalledTimes(1);
  });

  it("reports template and gate failures without saving the package", async () => {
    const userDataPath = await makeTempUserDataPath();
    const { defaultTemplatePath } = await writeTemplateCatalog(userDataPath, makeTemplateCatalog());
    const validateRulePackage = vi.fn(async ({ package: rulePackage }) => ({
      ok: false,
      package: rulePackage,
      checks: [
        {
          checkId: "rule_shape",
          passed: false
        }
      ],
      scenarios: [
        {
          scenarioId: "override-scenario",
          passed: false
        }
      ],
      recommendations: ["fix the package"]
    }));
    const saveRulePackage = vi.fn();
    const modelDecisionRuntime = createModelDecisionRuntime({
      rule_authoring_intent: {
        decision: {
          needsRule: true,
          templateId: "rule-one",
          confidence: 0.91,
          reason: "forced template"
        },
        audit: {
          provider: "intent-model"
        }
      },
      golden_rule_generator: {
        decision: {
          templateId: "rule-one",
          variables: {
            packageId: "gate-package",
            ruleId: "gate-rule",
            label: "Gate Label",
            description: "Gate Description",
            source: "gate-source"
          },
          notes: ["gate"]
        },
        audit: {
          provider: "generator-model"
        }
      }
    });
    const runtime = createKnowledgeRuleAuthoringRuntime({
      userDataPath,
      templatePath: defaultTemplatePath,
      goldenRuleRuntime: createGoldenRuleRuntime({
        validateRulePackage,
        saveRulePackage
      }),
      modelDecisionRuntime
    });

    vi.setSystemTime(new Date("2026-06-04T04:00:00.000Z"));
    const result = await runtime.chat({
      message: "请生成失败分支",
      modelAlias: "mock-model",
      modelEnabled: true
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("gate_failed");
    expect(result.gate.ok).toBe(false);
    expect(result.steps.map((step) => step.stage)).toEqual([
      "load_templates",
      "intent_recognition",
      "template_selection",
      "template_generation",
      "golden_rule_gate"
    ]);
    expect(result.steps[4]).toMatchObject({
      stage: "golden_rule_gate",
      status: "failed",
      checks: [
        {
          checkId: "rule_shape",
          passed: false
        }
      ]
    });
    expect(saveRulePackage).not.toHaveBeenCalled();
    expect(validateRulePackage).toHaveBeenCalledTimes(1);
  });

  it("returns template unavailable when intent needs a rule but no templates exist", async () => {
    const userDataPath = await makeTempUserDataPath();
    const validateRulePackage = vi.fn();
    const saveRulePackage = vi.fn();
    const modelDecisionRuntime = createModelDecisionRuntime({
      rule_authoring_intent: {
        decision: {
          target: "GoldenRulePackage",
          templateId: "missing-template",
          reason: "needs a template"
        },
        audit: {
          provider: "intent-model"
        }
      }
    });
    const runtime = createKnowledgeRuleAuthoringRuntime({
      userDataPath,
      templatePath: path.join(userDataPath, "missing-default-templates.json"),
      goldenRuleRuntime: createGoldenRuleRuntime({
        validateRulePackage,
        saveRulePackage
      }),
      modelDecisionRuntime
    });

    vi.setSystemTime(new Date("2026-06-04T05:00:00.000Z"));
    const result = await runtime.chat({
      message: "触发缺失模板分支",
      modelAlias: "mock-model",
      modelEnabled: true
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("template_unavailable");
    expect(result.error).toBe("没有可用黄金规则模板。");
    expect(validateRulePackage).not.toHaveBeenCalled();
    expect(saveRulePackage).not.toHaveBeenCalled();
    expect(result.steps.map((step) => step.stage)).toEqual([
      "load_templates",
      "intent_recognition"
    ]);
  });
});
