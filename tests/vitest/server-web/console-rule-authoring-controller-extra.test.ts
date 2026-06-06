// @vitest-environment jsdom
import { nextTick, ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createConsoleRuleAuthoringController } from "../../../server-web/composables/console-rule-authoring-controller";

const knowledgeRuleAuthoringClient = vi.hoisted(() => ({
  chatKnowledgeRuleAuthoring: vi.fn(),
  publishGoldenRules: vi.fn(),
}));

vi.mock("../../../server-web/lib/knowledge-rules-client", () => ({
  chatKnowledgeRuleAuthoring: knowledgeRuleAuthoringClient.chatKnowledgeRuleAuthoring,
  publishGoldenRules: knowledgeRuleAuthoringClient.publishGoldenRules,
}));

const defaultAgent = {
  value: "model-alpha",
  label: "Model Alpha",
  agentUid: "model-alpha",
  provider: "local",
  model: "model-alpha",
  moduleIds: [],
  capabilities: [],
  status: "ok",
  enabled: true,
  selectable: true,
  disabledReason: "",
  reason: "",
};

function createController(overrides: Record<string, unknown> = {}) {
  const error = ref("");
  const setBusy = vi.fn();
  const clearAllBusy = vi.fn();
  const controller = createConsoleRuleAuthoringController({
    agentSelectorOptions: ref([
      {
        ...defaultAgent,
        ...((overrides.agentSelectorOption as Record<string, unknown>) ?? {}),
      },
    ]),
    canMaintainKnowledge: ref(true),
    clearAllBusy,
    error,
    setBusy,
    settingsDraft: ref({
      agentExploreDefaults: {
        ruleAuthoringModelAlias: "model-alpha",
      },
    }),
    ...overrides,
  });

  return {
    clearAllBusy,
    controller,
    error,
    setBusy,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("console rule authoring controller", () => {
  it("初始化时自动使用 settingsDraft 中的默认模型别名", () => {
    const { controller } = createController();
    expect(controller.ruleAuthoringForm.value.modelAlias).toBe("model-alpha");
    expect(controller.ruleCreationMode.value).toBe("chat");
    expect(controller.selectedRuleAuthoringModel.value.value).toBe("model-alpha");
    expect(controller.ruleAuthoringCanSubmit.value).toBe(false);
    expect(controller.ruleScopeOptionBarOptions.value).toHaveLength(4);
    expect(controller.ruleScopeOptionBarOptions.value[0]).toEqual({ value: "knowledge", label: "知识库" });
  });

  it("默认模型别名为空时会回退到未选择的不可用模型", async () => {
    const { controller } = createController({
      settingsDraft: ref({ agentExploreDefaults: { ruleAuthoringModelAlias: "" } }),
    });
    expect(controller.selectedRuleAuthoringModel.value.value).toBe("");
    expect(controller.selectedRuleAuthoringModel.value.label).toBe("未选择智能体");
    expect(controller.selectedRuleAuthoringModel.value.provider).toBe("");
    expect(controller.selectedRuleAuthoringModel.value.disabledReason).toBe("未分配");
  });

  it("模型别名可由 settingsDraft 的后续更新回填到空草稿", async () => {
    const settingsDraft = ref({
      agentExploreDefaults: {
        ruleAuthoringModelAlias: "model-alpha",
      },
    });
    const { controller } = createController({
      settingsDraft,
      agentSelectorOption: {
        ...defaultAgent,
        value: "model-beta",
        label: "Model Beta",
        agentUid: "model-beta",
      },
    });

    controller.ruleAuthoringForm.value.modelAlias = "";
    settingsDraft.value = {
      ...settingsDraft.value,
      agentExploreDefaults: {
        ruleAuthoringModelAlias: "model-beta",
      },
    };
    await nextTick();

    expect(controller.ruleAuthoringForm.value.modelAlias).toBe("model-beta");
  });

  it("默认模型别名不存在时会回退到不可选中的历史模型项", async () => {
    const { controller, error } = createController({
      settingsDraft: ref({
        agentExploreDefaults: {
          ruleAuthoringModelAlias: "missing-model",
        },
      }),
    });
    expect(error.value).toBe("");
    expect(controller.selectedRuleAuthoringModel.value.enabled).toBe(false);
    expect(controller.selectedRuleAuthoringModel.value.label).toBe("已移除的智能体");
    expect(controller.selectedRuleAuthoringModel.value.disabledReason).toBe("已从智能体列表删除");
    expect(controller.ruleAuthoringCanSubmit.value).toBe(false);

    controller.ruleAuthoringForm.value.message = "创建测试规则";
    await nextTick();
    await controller.runRuleAuthoringChat();
    expect(knowledgeRuleAuthoringClient.chatKnowledgeRuleAuthoring).not.toHaveBeenCalled();
  });

  it("chat 草稿会从输入文本推断范围/匹配/动作/置信度与规则名", async () => {
    const { controller } = createController();

    controller.ruleAuthoringForm.value.message =
      "需要对邮件中的重复内容做跳过处理，并补充说明，置信度 90%";
    await nextTick();

    expect(controller.ruleAuthoringForm.value.scope).toBe("mail");
    expect(controller.ruleAuthoringForm.value.matchStrategy).toBe("semantic_duplicate");
    expect(controller.ruleAuthoringForm.value.action).toBe("skip_duplicate");
    expect(controller.ruleAuthoringForm.value.confidence).toBe(0.9);
    expect(controller.ruleAuthoringForm.value.ruleName).toBe("重复知识处理规则");

    expect(controller.ruleAuthoringDraftPayload.value).toMatchObject({
      mode: "chat",
      scope: "mail",
      matchStrategy: "semantic_duplicate",
      action: "skip_duplicate",
      confidence: 0.9,
      ruleName: "重复知识处理规则",
    });
  });

  it("chat 文本只含邮件时会命中邮件知识治理规则名分支", async () => {
    const { controller } = createController();
    controller.ruleAuthoringForm.value.ruleName = "";
    controller.ruleAuthoringForm.value.message = "请处理邮件通知中的异常";
    await nextTick();

    expect(controller.ruleAuthoringForm.value.scope).toBe("mail");
    expect(controller.ruleAuthoringForm.value.ruleName).toBe("邮件知识治理规则");
    expect(controller.ruleAuthoringForm.value.action).toBe("skip_duplicate");
  });

  it("chat 文本会命中人工审核/账单/小数置信度分支", async () => {
    const { controller } = createController();
    controller.ruleAuthoringForm.value.ruleName = "";
    controller.ruleAuthoringForm.value.message = "账单对账发现异常，建议人工审核 0.73";
    await nextTick();

    expect(controller.ruleAuthoringForm.value.action).toBe("manual_review");
    expect(controller.ruleAuthoringForm.value.ruleName).toBe("账单事务接续规则");
    expect(controller.ruleAuthoringForm.value.confidence).toBe(0.73);
  });

  it("chat 草稿会识别人工条件、融合与覆盖关键词", async () => {
    const { controller } = createController();

    controller.ruleAuthoringForm.value.ruleName = "";
    controller.ruleAuthoringForm.value.message = "请按条件是处理该类异常订单";
    await nextTick();
    expect(controller.ruleAuthoringForm.value.matchStrategy).toBe("manual_condition");

    controller.ruleAuthoringForm.value.message = "重复文档请执行融合处理并做推荐";
    await nextTick();
    expect(controller.ruleAuthoringForm.value.action).toBe("merge");
    expect(controller.ruleAuthoringForm.value.matchStrategy).toBe("semantic_duplicate");

    controller.ruleAuthoringForm.value.message = "请对重复项执行覆盖";
    await nextTick();
    expect(controller.ruleAuthoringForm.value.action).toBe("replace");
  });

  it("chat 草稿会保持默认作用域并支持来源一致/同实体时间窗与兜底命名", async () => {
    const { controller } = createController();

    controller.ruleAuthoringForm.value.message = "对文件做哈希匹配与来源一致检查";
    await nextTick();
    expect(controller.ruleAuthoringForm.value.matchStrategy).toBe("exact_source");

    controller.ruleAuthoringForm.value.message = "基于客户订单连续月度记录判定";
    await nextTick();
    expect(controller.ruleAuthoringForm.value.matchStrategy).toBe("same_entity_time");

    controller.ruleAuthoringForm.value.scope = "knowledge";
    controller.ruleAuthoringForm.value.ruleName = "";
    controller.ruleAuthoringForm.value.message = "制定一条通用规则用于后续整理";
    await nextTick();
    expect(controller.ruleAuthoringForm.value.scope).toBe("knowledge");
    expect(controller.ruleAuthoringForm.value.ruleName).toBe("制定一条通用规则用于后续整理");
  });

  it("chat 文本会按数据源与全局关键字推断 scope", async () => {
    const { controller } = createController();

    controller.ruleAuthoringForm.value.message = "请同步数据源目录与文件夹";
    await nextTick();
    expect(controller.ruleAuthoringForm.value.scope).toBe("source");

    controller.ruleAuthoringForm.value.message = "请在全部来源执行一次处理";
    await nextTick();
    expect(controller.ruleAuthoringForm.value.scope).toBe("all");
  });

  it("会导出策略与动作条目，包含 label 映射", async () => {
    const { controller } = createController();
    expect(controller.ruleScopeOptionBarOptions.value).toHaveLength(4);
    expect(controller.ruleScopeOptionBarOptions.value[1]).toEqual({ value: "mail", label: "邮件" });

    expect(controller.ruleMatchStrategyOptionBarOptions.value).toHaveLength(4);
    expect(controller.ruleMatchStrategyOptionBarOptions.value[1]).toEqual({ value: "exact_source", label: "来源一致" });

    expect(controller.ruleActionOptionBarOptions.value).toHaveLength(4);
    expect(controller.ruleActionOptionBarOptions.value[2]).toEqual({ value: "replace", label: "覆盖" });
  });

  it("手工摘要会对未收录枚举值回退原始文本并省略补充说明", async () => {
    const { controller } = createController();
    controller.ruleCreationMode.value = "manual";
    await nextTick();

    const manualForm = controller.ruleAuthoringForm.value as {
      ruleName: string;
      scope: string;
      matchStrategy: string;
      action: string;
      notes: string;
    };
    manualForm.scope = "custom_scope";
    manualForm.matchStrategy = "custom_strategy";
    manualForm.action = "custom_action";
    manualForm.notes = "";
    manualForm.ruleName = "手工规则";

    await nextTick();

    expect(controller.ruleAuthoringForm.value.message).toContain("适用范围：custom_scope");
    expect(controller.ruleAuthoringForm.value.message).toContain("匹配方式：custom_strategy");
    expect(controller.ruleAuthoringForm.value.message).toContain("执行动作：custom_action");
    expect(controller.ruleAuthoringForm.value.message).not.toContain("补充说明：");
    expect(controller.ruleAuthoringManualSummary.value).toContain("custom_scope");
    expect(controller.ruleAuthoringManualSummary.value).toContain("custom_strategy");
    expect(controller.ruleAuthoringManualSummary.value).toContain("custom_action");
  });

  it("manual 模式会将字段改动回写为标准消息，切回 chat 时按消息重新推断草稿", async () => {
    const { controller } = createController();

    controller.ruleCreationMode.value = "manual";
    await nextTick();
    controller.ruleAuthoringForm.value.ruleName = "手工规则";
    controller.ruleAuthoringForm.value.scope = "all";
    controller.ruleAuthoringForm.value.matchStrategy = "manual_condition";
    controller.ruleAuthoringForm.value.action = "manual_review";
    controller.ruleAuthoringForm.value.confidence = 0.73;
    controller.ruleAuthoringForm.value.notes = "补充说明";
    await nextTick();

    expect(controller.ruleAuthoringForm.value.message).toContain("创建规则：手工规则");
    expect(controller.ruleAuthoringForm.value.message).toContain("适用范围：全局");
    expect(controller.ruleAuthoringForm.value.message).toContain("匹配方式：人工条件");
    expect(controller.ruleAuthoringForm.value.message).toContain("执行动作：人工审核");
    expect(controller.ruleAuthoringForm.value.message).toContain("补充说明：补充说明");
    expect(controller.ruleAuthoringForm.value.message).toContain("最低置信度：0.73");
    expect(controller.ruleAuthoringManualSummary.value).toContain("人工审核");
    expect(controller.ruleAuthoringManualSummary.value).toContain("置信度 0.73");

    controller.ruleCreationMode.value = "chat";
    controller.ruleAuthoringForm.value.message = "邮件重复处理";
    await nextTick();
    expect(controller.ruleAuthoringForm.value.scope).toBe("mail");
    expect(controller.ruleAuthoringForm.value.matchStrategy).toBe("semantic_duplicate");
    expect(controller.ruleAuthoringForm.value.action).toBe("skip_duplicate");
    expect(controller.ruleAuthoringForm.value.ruleName).toBe("手工规则");
  });

  it("手工模式切换会只在空值或规则前缀时重建消息", async () => {
    const { controller } = createController();
    controller.ruleCreationMode.value = "manual";
    await nextTick();

    controller.ruleAuthoringForm.value.message = "自定义消息内容";
    await nextTick();
    expect(controller.ruleAuthoringForm.value.message).toBe("自定义消息内容");

    controller.ruleCreationMode.value = "chat";
    await nextTick();
    controller.ruleAuthoringForm.value.message = "创建规则：前缀消息";
    await nextTick();
    controller.ruleCreationMode.value = "manual";
    await nextTick();
    expect(controller.ruleAuthoringForm.value.message).toContain("适用范围：");
    expect(controller.ruleAuthoringForm.value.message).toContain("匹配方式：语义重复");

    controller.ruleAuthoringForm.value.ruleName = `${controller.ruleAuthoringForm.value.ruleName}  `;
    const sameMessage = controller.ruleAuthoringForm.value.message;
    await nextTick();
    expect(controller.ruleAuthoringForm.value.message).toBe(sameMessage);
  });

  it("runRuleAuthoringChat 校验、成功写入历史并去重", async () => {
    const { clearAllBusy, setBusy, error, controller } = createController();
    await controller.runRuleAuthoringChat();
    expect(error.value).toBe("请输入规则生成需求。");
    expect(knowledgeRuleAuthoringClient.chatKnowledgeRuleAuthoring).not.toHaveBeenCalled();

    knowledgeRuleAuthoringClient.chatKnowledgeRuleAuthoring.mockResolvedValue({
      protocolVersion: "pact.knowledge-rule-authoring.v1",
      ok: true,
      status: "draft",
      runId: "run-1",
    });
    controller.ruleAuthoringForm.value.message = "创建知识治理规则";
    await nextTick();
    await controller.runRuleAuthoringChat();

    expect(setBusy).toHaveBeenCalledWith("knowledge:rule-authoring");
    expect(clearAllBusy).toHaveBeenCalled();
    expect(knowledgeRuleAuthoringClient.chatKnowledgeRuleAuthoring).toHaveBeenCalledTimes(1);
    expect(knowledgeRuleAuthoringClient.chatKnowledgeRuleAuthoring).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "创建知识治理规则",
        modelAlias: "model-alpha",
        modelEnabled: true,
      }),
    );
    expect(controller.ruleAuthoringResult.value?.runId).toBe("run-1");
    expect(controller.ruleAuthoringHistory.value).toHaveLength(1);

    knowledgeRuleAuthoringClient.chatKnowledgeRuleAuthoring.mockResolvedValue({
      protocolVersion: "pact.knowledge-rule-authoring.v1",
      ok: true,
      status: "draft",
      runId: "run-1",
      answer: "updated",
    });
    controller.ruleAuthoringForm.value.ruleName = "更新的规则名";
    await controller.runRuleAuthoringChat();
    expect(controller.ruleAuthoringHistory.value).toHaveLength(1);
    expect(controller.ruleAuthoringHistory.value[0].answer).toBe("updated");

    knowledgeRuleAuthoringClient.chatKnowledgeRuleAuthoring.mockRejectedValueOnce(new Error("生成失败"));
    await controller.runRuleAuthoringChat();
    expect(error.value).toBe("生成失败");

    knowledgeRuleAuthoringClient.chatKnowledgeRuleAuthoring.mockRejectedValueOnce("生成失败");
    await controller.runRuleAuthoringChat();
    expect(error.value).toBe("规则生成失败。");
  });

  it("publishRuleAuthoringPackage 校验、成功落库字段回退与失败提示", async () => {
    const { clearAllBusy, controller, error, setBusy } = createController();

    await controller.publishRuleAuthoringPackage();
    expect(error.value).toBe("没有可确认发布的规则包。");
    expect(knowledgeRuleAuthoringClient.publishGoldenRules).not.toHaveBeenCalled();

    controller.ruleAuthoringResult.value = {
      protocolVersion: "pact.knowledge-rule-authoring.v1",
      ok: true,
      status: "draft",
      runId: "run-2",
      confirmation: {
        packageId: "pkg-1",
        version: 3,
        publishEndpoint: "/publish",
      },
      package: { source: "local" },
      manifest: { version: "old" },
    };

    knowledgeRuleAuthoringClient.publishGoldenRules.mockResolvedValue({
      package: "not-object",
      manifest: [],
    });
    await controller.publishRuleAuthoringPackage();
    expect(setBusy).toHaveBeenCalledWith("knowledge:rule-authoring:publish");
    expect(clearAllBusy).toHaveBeenCalled();
    expect(knowledgeRuleAuthoringClient.publishGoldenRules).toHaveBeenCalledWith("pkg-1", { version: 3 });
    expect(controller.ruleAuthoringResult.value?.status).toBe("published");
    expect(controller.ruleAuthoringResult.value).toMatchObject({
      package: { source: "local" },
      manifest: { version: "old" },
    });

    knowledgeRuleAuthoringClient.publishGoldenRules.mockRejectedValueOnce("publish failed");
    await controller.publishRuleAuthoringPackage();
    expect(error.value).toBe("规则发布失败。");
  });

  it("manual 模式提交会不传递模型别名与模型可用标记", async () => {
    const { clearAllBusy, setBusy, controller } = createController();
    knowledgeRuleAuthoringClient.chatKnowledgeRuleAuthoring.mockResolvedValue({
      protocolVersion: "pact.knowledge-rule-authoring.v1",
      ok: true,
      status: "draft",
      runId: "run-manual",
    });

    controller.ruleCreationMode.value = "manual";
    await nextTick();
    await nextTick();

    controller.ruleAuthoringForm.value.ruleName = "";
    controller.ruleAuthoringForm.value.confidence = 0;
    controller.ruleAuthoringForm.value.notes = "";

    await controller.runRuleAuthoringChat();

    expect(setBusy).toHaveBeenCalledWith("knowledge:rule-authoring");
    expect(knowledgeRuleAuthoringClient.chatKnowledgeRuleAuthoring).toHaveBeenCalledWith(
      expect.objectContaining({
        modelAlias: "",
        modelEnabled: false,
        draft: expect.objectContaining({
          mode: "manual",
          ruleName: "",
          confidence: 0,
          notes: "",
        }),
      }),
    );
    expect(clearAllBusy).toHaveBeenCalled();
  });

  it("publishRuleAuthoringPackage 捕获 Error 异常信息", async () => {
    const { controller, error } = createController();

    controller.ruleAuthoringResult.value = {
      protocolVersion: "pact.knowledge-rule-authoring.v1",
      ok: true,
      status: "draft",
      confirmation: { packageId: "pkg-1", version: 1, publishEndpoint: "/x" },
    };

    knowledgeRuleAuthoringClient.publishGoldenRules.mockRejectedValueOnce(new Error("publish failed"));
    await controller.publishRuleAuthoringPackage();

    expect(error.value).toBe("publish failed");
  });

  it("模型不可用且无维护权限时会直接阻断提交", async () => {
    const { controller, error, setBusy, clearAllBusy } = createController({
      agentSelectorOption: {
        ...defaultAgent,
        enabled: false,
      },
    });

    controller.ruleAuthoringForm.value.message = "创建规则";
    await nextTick();
    await controller.runRuleAuthoringChat();
    expect(error.value).toBe("请选择可用的创建规则智能体。");
    expect(knowledgeRuleAuthoringClient.chatKnowledgeRuleAuthoring).not.toHaveBeenCalled();
    expect(setBusy).not.toHaveBeenCalled();
    expect(clearAllBusy).not.toHaveBeenCalled();

    const noPermission = createController({
      canMaintainKnowledge: ref(false),
    });
    noPermission.controller.ruleCreationMode.value = "manual";
    noPermission.controller.ruleAuthoringForm.value.message = "创建规则";
    await nextTick();
    await noPermission.controller.runRuleAuthoringChat();
    expect(noPermission.error.value).toBe("当前账号没有知识库维护权限。");
    expect(noPermission.setBusy).not.toHaveBeenCalled();

    noPermission.controller.ruleAuthoringResult.value = {
      protocolVersion: "pact.knowledge-rule-authoring.v1",
      ok: true,
      status: "draft",
      confirmation: { packageId: "pkg-1", version: 1, publishEndpoint: "/x" },
    };
    await noPermission.controller.publishRuleAuthoringPackage();
    expect(noPermission.error.value).toBe("当前账号没有知识库维护权限。");
    expect(noPermission.setBusy).not.toHaveBeenCalled();
    expect(knowledgeRuleAuthoringClient.publishGoldenRules).not.toHaveBeenCalled();
  });
});
