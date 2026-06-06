export function createSystemControllerKnowledgeRuntimeHandlers({
  sendConsoleDomainOperation,
  parseJsonBody,
  protocolPayload,
  queryPayload,
  knowledgeDomainContext,
  knowledgeWorkflowContext,
  runtime,
  jobWorkflowProvider,
  knowledgeSourceService,
  metadataStore,
  clientRuntimeAllocator,
  modelDecisionRuntime,
  strategyManagementProvider = null,
  agentWorkspace,
  accessControlContext = (_authSession, extra = {}) => extra,
  consoleDomainServices
}) {
  return {
    async handleKnowledgeConsole({ operation, response }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.console",
        response,
        context: { runtime, jobWorkflowProvider, knowledgeSourceService, consoleDomainServices },
        errorMessage: "读取知识库控制台状态失败。"
      });
    },
    async handleKnowledgeSources({ operation, response }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.sources.list",
        response,
        context: { knowledgeSourceService },
        errorMessage: "读取知识库目录失败。"
      });
    },
    async handleCreateKnowledgeSource({ operation, requestBody, response }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.sources.create",
        input: parseJsonBody(requestBody),
        response,
        context: { knowledgeSourceService },
        errorMessage: "创建知识库目录失败。"
      });
    },
    async handleUpdateKnowledgeSource({ operation, sourceId, requestBody, response }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.sources.update",
        input: {
          ...parseJsonBody(requestBody),
          sourceId
        },
        response,
        context: { knowledgeSourceService },
        errorMessage: "更新知识库目录失败。"
      });
    },
    async handleDeleteKnowledgeSource({ operation, sourceId, response }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.sources.delete",
        input: { sourceId },
        response,
        context: { knowledgeSourceService },
        errorMessage: "删除知识库目录失败。"
      });
    },
    async handleRefreshKnowledgeSource({ operation, sourceId, requestBody, response }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.sources.refresh",
        input: {
          ...parseJsonBody(requestBody),
          sourceId
        },
        response,
        context: { knowledgeSourceService },
        errorMessage: "刷新知识库目录失败。"
      });
    },
    async handleRefreshAllKnowledgeSources({ operation, requestBody, response }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.sources.refresh_all",
        input: parseJsonBody(requestBody),
        response,
        context: { knowledgeSourceService },
        errorMessage: "刷新全部知识库目录失败。"
      });
    },
    async handleKnowledgeConfigSchema({ operation, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.config_schema",
        response,
        context: knowledgeDomainContext(authSession),
        errorMessage: "读取知识库维护配置表单元数据失败。"
      });
    },
    async handleKnowledgeCapabilities({ operation, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.capabilities",
        response,
        context: knowledgeDomainContext(authSession),
        errorMessage: "读取知识库能力失败。"
      });
    },
    async handleKnowledgeDocxExport({ operation, url, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.export_docx",
        input: protocolPayload(Buffer.alloc(0), url),
        response,
        context: knowledgeDomainContext(authSession),
        errorMessage: "导出知识库 DOCX 失败。"
      });
    },
    async handleKnowledgeMarkdownExport({ operation, url, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.export_markdown",
        input: protocolPayload(Buffer.alloc(0), url),
        response,
        context: knowledgeDomainContext(authSession),
        errorMessage: "导出知识库 Markdown 失败。"
      });
    },
    async handleKnowledgeHtmlExport({ operation, url, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.export_html",
        input: protocolPayload(Buffer.alloc(0), url),
        response,
        context: knowledgeDomainContext(authSession),
        errorMessage: "导出知识库 HTML 失败。"
      });
    },
    async handleKnowledgeHealth({ operation, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.health",
        response,
        context: knowledgeDomainContext(authSession),
        errorMessage: "读取知识库健康状态失败。"
      });
    },
    async handleKnowledgeMaintenanceGet({ operation, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.maintenance.get",
        response,
        context: knowledgeDomainContext(authSession),
        errorMessage: "读取知识库维护参数失败。"
      });
    },
    async handleKnowledgeMaintenanceSet({ operation, requestBody, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.maintenance.set",
        input: parseJsonBody(requestBody),
        response,
        context: knowledgeDomainContext(authSession),
        errorMessage: "设置知识库维护参数失败。"
      });
    },
    async handleKnowledgeReindex({ operation, requestBody, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.reindex",
        input: parseJsonBody(requestBody),
        response,
        context: knowledgeDomainContext(authSession),
        errorMessage: "重建知识库索引失败。"
      });
    },
    async handleKnowledgeMaintenanceRun({ operation, requestBody, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.maintenance.run",
        input: parseJsonBody(requestBody),
        response,
        context: knowledgeDomainContext(authSession),
        errorMessage: "执行知识库维护任务失败。"
      });
    },
    async handleKnowledgeSync({ operation, url, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.sync",
        input: protocolPayload(Buffer.alloc(0), url),
        response,
        context: knowledgeDomainContext(authSession),
        errorMessage: "同步知识库失败。"
      });
    },
    async handleKnowledgeChanges({ operation, requestBody, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.changes",
        input: parseJsonBody(requestBody),
        response,
        context: knowledgeDomainContext(authSession),
        errorMessage: "提交知识库变更失败。"
      });
    },
    async handleKnowledgeReviewItems({ operation, url, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.review_items",
        input: protocolPayload(Buffer.alloc(0), url),
        response,
        context: knowledgeDomainContext(authSession),
        errorMessage: "读取知识审核项失败。"
      });
    },
    async handleResolveKnowledgeReviewItem({ operation, reviewId, requestBody, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.review_resolve",
        input: {
          ...parseJsonBody(requestBody),
          reviewId
        },
        response,
        context: knowledgeDomainContext(authSession),
        errorMessage: "解决知识审核项失败。"
      });
    },
    async handleKnowledgeFeedback({ operation, requestBody, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.feedback",
        input: parseJsonBody(requestBody),
        response,
        context: knowledgeDomainContext(authSession),
        errorMessage: "记录知识反馈失败。"
      });
    },
    async handleKnowledgeSuggestions({ operation, url, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.suggestions",
        input: protocolPayload(Buffer.alloc(0), url),
        response,
        context: knowledgeDomainContext(authSession),
        errorMessage: "读取知识建议失败。"
      });
    },
    async handleGoldenRules({ operation, url, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.golden_rules.list",
        input: protocolPayload(Buffer.alloc(0), url),
        response,
        context: knowledgeWorkflowContext(authSession),
        errorMessage: "读取黄金规则包失败。"
      });
    },
    async handleSaveGoldenRules({ operation, requestBody, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.golden_rules.save",
        input: parseJsonBody(requestBody),
        response,
        context: knowledgeWorkflowContext(authSession),
        errorMessage: "保存黄金规则包失败。"
      });
    },
    async handlePublishGoldenRules({ operation, packageId, requestBody, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.golden_rules.publish",
        input: {
          ...parseJsonBody(requestBody),
          packageId
        },
        response,
        context: knowledgeWorkflowContext(authSession),
        errorMessage: "发布黄金规则包失败。"
      });
    },
    async handleRollbackGoldenRules({ operation, packageId, requestBody, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.golden_rules.rollback",
        input: {
          ...parseJsonBody(requestBody),
          packageId
        },
        response,
        context: knowledgeWorkflowContext(authSession),
        errorMessage: "回滚黄金规则包失败。"
      });
    },
    async handleKnowledgeRuleAuthoringChat({ operation, requestBody, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.rule_authoring.chat",
        input: parseJsonBody(requestBody),
        response,
        context: knowledgeWorkflowContext(authSession),
        errorMessage: "规则生成智能体对话失败。"
      });
    },
    async handleKnowledgeRuleAuthoringRunGet({ operation, runId, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.rule_authoring.runs.get",
        input: { runId },
        response,
        context: knowledgeWorkflowContext(authSession),
        errorMessage: "读取规则生成运行失败。"
      });
    },
    async handleGoldCases({ operation, url, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.gold_cases.list",
        input: protocolPayload(Buffer.alloc(0), url),
        response,
        context: knowledgeWorkflowContext(authSession),
        errorMessage: "读取黄金样本失败。"
      });
    },
    async handleSaveGoldCase({ operation, requestBody, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.gold_cases.save",
        input: parseJsonBody(requestBody),
        response,
        context: knowledgeWorkflowContext(authSession),
        errorMessage: "保存黄金样本失败。"
      });
    },
    async handleKnowledgeDistillationRuns({ operation, requestBody, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.distillation.runs.create",
        input: parseJsonBody(requestBody),
        response,
        context: knowledgeWorkflowContext(authSession),
        errorMessage: "创建知识蒸馏任务失败。"
      });
    },
    async handleKnowledgeDistillationRunGet({ operation, runId, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.distillation.runs.get",
        input: { runId },
        response,
        context: knowledgeWorkflowContext(authSession),
        errorMessage: "读取知识蒸馏任务失败。"
      });
    },
    async handleExternalKnowledgeDistillationHealth({ operation, url, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "external.knowledge.distillation.service.health",
        input: protocolPayload(Buffer.alloc(0), url),
        response,
        context: knowledgeWorkflowContext(authSession),
        errorMessage: "读取外部知识蒸馏服务健康状态失败。"
      });
    },
    async handleExternalKnowledgeDistillationCapabilities({ operation, url, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "external.knowledge.distillation.service.capabilities",
        input: protocolPayload(Buffer.alloc(0), url),
        response,
        context: knowledgeWorkflowContext(authSession),
        errorMessage: "读取外部知识蒸馏服务能力失败。"
      });
    },
    async handleExternalKnowledgeDistillationRuntimeHealth({ operation, url, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "external.knowledge.distillation.service.runtime_health",
        input: protocolPayload(Buffer.alloc(0), url),
        response,
        context: knowledgeWorkflowContext(authSession),
        errorMessage: "读取外部知识蒸馏服务运行时状态失败。"
      });
    },
    async handleExternalKnowledgeDistillationRunsList({ operation, url, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "external.knowledge.distillation.runs.list",
        input: protocolPayload(Buffer.alloc(0), url),
        response,
        context: knowledgeWorkflowContext(authSession),
        errorMessage: "列出外部知识蒸馏任务失败。"
      });
    },
    async handleExternalKnowledgeDistillationRunsCreate({ operation, requestBody, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "external.knowledge.distillation.runs.create",
        input: parseJsonBody(requestBody),
        response,
        context: knowledgeWorkflowContext(authSession),
        errorMessage: "创建外部知识蒸馏任务失败。"
      });
    },
    async handleExternalKnowledgeDistillationRunGet({ operation, url, runId, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "external.knowledge.distillation.runs.get",
        input: {
          ...protocolPayload(Buffer.alloc(0), url),
          runId
        },
        response,
        context: knowledgeWorkflowContext(authSession),
        errorMessage: "读取外部知识蒸馏任务失败。"
      });
    },
    async handleExternalKnowledgeDistillationRunCancel({ operation, runId, requestBody, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "external.knowledge.distillation.runs.cancel",
        input: {
          ...parseJsonBody(requestBody),
          runId
        },
        response,
        context: knowledgeWorkflowContext(authSession),
        errorMessage: "取消外部知识蒸馏任务失败。"
      });
    },
    async handleExternalKnowledgeDistillationEvidenceQuery({ operation, url, runId, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "external.knowledge.distillation.evidence.query",
        input: {
          ...protocolPayload(Buffer.alloc(0), url),
          runId
        },
        response,
        context: knowledgeWorkflowContext(authSession),
        errorMessage: "查询外部知识蒸馏证据失败。"
      });
    },
    async handleExternalKnowledgeDistillationProjectEvidenceQuery({ operation, url, projectId, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "external.knowledge.distillation.projects.evidence.query",
        input: {
          ...protocolPayload(Buffer.alloc(0), url),
          projectId
        },
        response,
        context: knowledgeWorkflowContext(authSession),
        errorMessage: "查询外部知识蒸馏项目证据失败。"
      });
    },
    async handleExternalKnowledgeDistillationArtifactExport({ operation, url, runId, artifactId, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "external.knowledge.distillation.artifacts.export",
        input: {
          ...protocolPayload(Buffer.alloc(0), url),
          runId,
          artifactId
        },
        response,
        context: knowledgeWorkflowContext(authSession),
        errorMessage: "导出外部知识蒸馏产物失败。"
      });
    },
    async handleKnowledgeDistillationWorkbenchRunsList({ operation, url, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.distillation.workbench.runs.list",
        input: protocolPayload(Buffer.alloc(0), url),
        response,
        context: knowledgeWorkflowContext(authSession),
        errorMessage: "列出知识蒸馏工作台任务失败。"
      });
    },
    async handleKnowledgeDistillationWorkbenchRunsCreate({ operation, requestBody, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.distillation.workbench.runs.create",
        input: parseJsonBody(requestBody),
        response,
        context: knowledgeWorkflowContext(authSession),
        errorMessage: "创建知识蒸馏工作台任务失败。"
      });
    },
    async handleKnowledgeDistillationWorkbenchRunGet({ operation, runId, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.distillation.workbench.runs.get",
        input: { runId },
        response,
        context: knowledgeWorkflowContext(authSession),
        errorMessage: "读取知识蒸馏工作台任务失败。"
      });
    },
    async handleKnowledgeDistillationWorkbenchRunResume({ operation, runId, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.distillation.workbench.runs.resume",
        input: { runId },
        response,
        context: knowledgeWorkflowContext(authSession),
        errorMessage: "恢复知识蒸馏工作台任务失败。"
      });
    },
    async handleKnowledgeDistillationWorkbenchRunCancel({ operation, runId, requestBody, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.distillation.workbench.runs.cancel",
        input: {
          ...parseJsonBody(requestBody),
          runId
        },
        response,
        context: knowledgeWorkflowContext(authSession),
        errorMessage: "取消知识蒸馏工作台任务失败。"
      });
    },
    async handleKnowledgeDistillationWorkbenchRunArchive({ operation, runId, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.distillation.workbench.runs.archive",
        input: { runId },
        response,
        context: knowledgeWorkflowContext(authSession),
        errorMessage: "归档知识蒸馏工作台任务失败。"
      });
    },
    async handleKnowledgeDistillationWorkbenchRunDelete({ operation, runId, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.distillation.workbench.runs.delete",
        input: { runId },
        response,
        context: knowledgeWorkflowContext(authSession),
        errorMessage: "删除知识蒸馏工作台任务失败。"
      });
    },
    async handleKnowledgeDistillationWorkbenchStageRerun({ operation, runId, stageId, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.distillation.workbench.stage.rerun",
        input: { runId, stageId },
        response,
        context: knowledgeWorkflowContext(authSession),
        errorMessage: "重跑知识蒸馏工作台阶段失败。"
      });
    },
    async handleKnowledgeDistillationWorkbenchStageExport({ operation, url, runId, stageId, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.distillation.workbench.stage.export",
        input: {
          ...protocolPayload(Buffer.alloc(0), url),
          runId,
          stageId
        },
        response,
        context: knowledgeWorkflowContext(authSession),
        errorMessage: "导出知识蒸馏工作台阶段失败。"
      });
    },
    async handleKnowledgeDistillationWorkbenchRunArtifacts({ operation, runId, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.distillation.workbench.runs.artifacts",
        input: { runId },
        response,
        context: knowledgeWorkflowContext(authSession),
        errorMessage: "读取知识蒸馏工作台产物信息失败。"
      });
    },
    async handleKnowledgeDistillationWorkbenchRunPackageExport({ operation, runId, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.distillation.workbench.runs.package",
        input: { runId },
        response,
        context: knowledgeWorkflowContext(authSession),
        errorMessage: "导出知识蒸馏工作台整包失败。"
      });
    },
    async handleKnowledgeDistillationWorkbenchRunCompare({ operation, url, runId, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.distillation.workbench.runs.compare",
        input: {
          ...protocolPayload(Buffer.alloc(0), url),
          runId
        },
        response,
        context: knowledgeWorkflowContext(authSession),
        errorMessage: "比较知识蒸馏工作台版本失败。"
      });
    },
    async handleResolveKnowledgeSuggestion({ operation, suggestionId, requestBody, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.suggestion_resolve",
        input: {
          ...parseJsonBody(requestBody),
          suggestionId
        },
        response,
        context: knowledgeDomainContext(authSession),
        errorMessage: "解决知识库建议失败。"
      });
    },
    async handleKnowledgeLearningJob({ operation, requestBody, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.learning.jobs",
        input: parseJsonBody(requestBody),
        response,
        context: knowledgeDomainContext(authSession),
        errorMessage: "执行知识库学习任务失败。"
      });
    },
    async handleKnowledgeLearningHealth({ operation, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.learning.health",
        response,
        context: knowledgeDomainContext(authSession),
        errorMessage: "读取知识库学习健康状态失败。"
      });
    },
    async handleEvidenceGateEvaluate({ operation, requestBody, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.evidence_gate.evaluate",
        input: parseJsonBody(requestBody),
        response,
        context: knowledgeWorkflowContext(authSession),
        errorMessage: "评估证据充分性失败。"
      });
    },
    async handleKnowledgeAgentSkill({ operation, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.agent_skill.describe",
        response,
        context: knowledgeWorkflowContext(authSession),
        errorMessage: "读取知识库智能体技能失败。"
      });
    },
    async handleKnowledgeAgentSkillPlan({ operation, requestBody, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.agent_skill.plan",
        input: parseJsonBody(requestBody),
        response,
        context: knowledgeWorkflowContext(authSession),
        errorMessage: "规划知识库智能体查询失败。"
      });
    },
    async handleKnowledgeAgentSkillRun({ operation, requestBody, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.agent_skill.run",
        input: parseJsonBody(requestBody),
        response,
        context: knowledgeWorkflowContext(authSession),
        errorMessage: "执行知识库智能体查询技能失败。"
      });
    },
    async handleKnowledgeSkills({ operation, url, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.skills.list",
        input: protocolPayload(Buffer.alloc(0), url),
        response,
        context: knowledgeWorkflowContext(authSession),
        errorMessage: "读取知识 Skill 列表失败。"
      });
    },
    async handleKnowledgeSkillGet({ operation, skillId, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.skills.get",
        input: { skillId },
        response,
        context: knowledgeWorkflowContext(authSession),
        errorMessage: "读取知识 Skill 失败。"
      });
    },
    async handleKnowledgeSkillGenerate({ operation, requestBody, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.skills.generate",
        input: parseJsonBody(requestBody),
        response,
        context: knowledgeWorkflowContext(authSession),
        errorMessage: "生成知识 Skill 失败。"
      });
    },
    async handleKnowledgeSkillPropose({ operation, requestBody, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.skills.propose",
        input: parseJsonBody(requestBody),
        response,
        context: knowledgeWorkflowContext(authSession),
        errorMessage: "提交知识 Skill 提案失败。"
      });
    },
    async handleKnowledgeSkillResolve({ operation, requestBody, skillId, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.skills.resolve",
        input: {
          ...parseJsonBody(requestBody),
          skillId
        },
        response,
        context: knowledgeWorkflowContext(authSession),
        errorMessage: "解决知识 Skill 失败。"
      });
    },
    async handleKnowledgeSkillFramework({ operation, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.skills.framework",
        response,
        context: knowledgeWorkflowContext(authSession),
        errorMessage: "读取知识 Skill 提炼框架失败。"
      });
    },
    async handleSaveKnowledgeSkillFramework({ operation, requestBody, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.skills.framework_save",
        input: parseJsonBody(requestBody),
        response,
        context: knowledgeWorkflowContext(authSession),
        errorMessage: "保存知识 Skill 提炼框架失败。"
      });
    },
    async handleKnowledgeSkillEvaluationRuns({ operation, requestBody, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.skills.evaluation.runs.create",
        input: parseJsonBody(requestBody),
        response,
        context: knowledgeWorkflowContext(authSession),
        errorMessage: "创建知识 SkillSet 离线评估失败。"
      });
    },
    async handleKnowledgeSkillDeployments({ operation, requestBody, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.skills.deployments.create",
        input: parseJsonBody(requestBody),
        response,
        context: knowledgeWorkflowContext(authSession),
        errorMessage: "发布知识 SkillSet 部署失败。"
      });
    },
    async handleKnowledgeSkillDeploymentRollback({ operation, deploymentId, requestBody, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.skills.deployments.rollback",
        input: {
          ...parseJsonBody(requestBody),
          deploymentId
        },
        response,
        context: knowledgeWorkflowContext(authSession),
        errorMessage: "回滚知识 SkillSet 部署失败。"
      });
    },
    async handleKnowledgeTrainingSetExport({ operation, requestBody, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.training_sets.export",
        input: parseJsonBody(requestBody),
        response,
        context: knowledgeWorkflowContext(authSession),
        errorMessage: "导出黄金训练集失败。"
      });
    },
    async handleAgentEvaluationRuns({ operation, requestBody, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.evaluation.runs.create",
        input: parseJsonBody(requestBody),
        response,
        context: knowledgeWorkflowContext(authSession),
        errorMessage: "创建智能体知识评估运行失败。"
      });
    },
    async handleAgentEvaluationRunList({ operation, url, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.evaluation.runs.list",
        input: protocolPayload(Buffer.alloc(0), url),
        response,
        context: knowledgeWorkflowContext(authSession),
        errorMessage: "列出智能体知识评估运行失败。"
      });
    },
    async handleAgentEvaluationRun({ operation, runId, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.evaluation.runs.get",
        input: { runId },
        response,
        context: knowledgeWorkflowContext(authSession),
        errorMessage: "读取智能体知识评估运行失败。"
      });
    },
    async handleModelDecisionRoles({ operation, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.model_roles",
        response,
        context: knowledgeWorkflowContext(authSession),
        errorMessage: "读取知识库模型角色失败。"
      });
    },
    async handleModelDecisionDecide({ operation, requestBody, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.model_decision",
        input: parseJsonBody(requestBody),
        response,
        context: knowledgeWorkflowContext(authSession),
        errorMessage: "执行知识库模型决策失败。"
      });
    },
    async handleKnowledgeEvolutionDescribe({ operation, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.evolution.describe",
        response,
        context: knowledgeWorkflowContext(authSession),
        errorMessage: "读取知识进化闭环说明失败。"
      });
    },
    async handleKnowledgeEvolutionRun({ operation, requestBody, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.evolution.runs.create",
        input: parseJsonBody(requestBody),
        response,
        context: knowledgeWorkflowContext(authSession),
        errorMessage: "执行知识进化闭环失败。"
      });
    },
    async handleKnowledgeEvolutionRuns({ operation, url, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.evolution.runs.list",
        input: protocolPayload(Buffer.alloc(0), url),
        response,
        context: knowledgeWorkflowContext(authSession),
        errorMessage: "列出知识进化闭环运行失败。"
      });
    },
    async handleKnowledgeEvolutionRunGet({ operation, runId, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.evolution.runs.get",
        input: { runId },
        response,
        context: knowledgeWorkflowContext(authSession),
        errorMessage: "读取知识进化闭环运行失败。"
      });
    },
    async handleKnowledgeHierarchyAudit({ operation, requestBody, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.hierarchy.audit",
        input: parseJsonBody(requestBody),
        response,
        context: knowledgeWorkflowContext(authSession),
        errorMessage: "索引质量透明度分析失败。"
      });
    },
    async handleKnowledgeEvolutionDeployments({ operation, url, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.evolution.deployments.list",
        input: protocolPayload(Buffer.alloc(0), url),
        response,
        context: knowledgeWorkflowContext(authSession),
        errorMessage: "列出检索 profile 部署失败。"
      });
    },
    async handleKnowledgeEvolutionDeploymentPromote({ operation, deploymentId, requestBody, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.evolution.deployments.promote",
        input: {
          ...parseJsonBody(requestBody),
          deploymentId
        },
        response,
        context: knowledgeWorkflowContext(authSession),
        errorMessage: "提升检索 profile 灰度部署失败。"
      });
    },
    async handleKnowledgeEvolutionDeploymentRollback({ operation, deploymentId, requestBody, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.evolution.deployments.rollback",
        input: {
          ...parseJsonBody(requestBody),
          deploymentId
        },
        response,
        context: knowledgeWorkflowContext(authSession),
        errorMessage: "回滚检索 profile 部署失败。"
      });
    },
    async handleKnowledgeSummarizationRun({ operation, requestBody, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.summarization.runs.create",
        input: parseJsonBody(requestBody),
        response,
        context: knowledgeWorkflowContext(authSession),
        errorMessage: "创建多智能体知识总结任务失败。"
      });
    },
    async handleGetKnowledgeSummarizationRun({ operation, runId, url, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.summarization.runs.get",
        input: {
          ...protocolPayload(Buffer.alloc(0), url),
          runId
        },
        response,
        context: knowledgeWorkflowContext(authSession),
        errorMessage: "读取多智能体知识总结任务失败。"
      });
    },
    async handleApproveKnowledgeSummarizationRun({ operation, runId, requestBody, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.summarization.runs.approve",
        input: {
          ...parseJsonBody(requestBody),
          runId
        },
        response,
        context: knowledgeWorkflowContext(authSession),
        errorMessage: "确认发布多智能体知识总结 artifact 失败。"
      });
    },
    async handleKnowledgeAgentExploreRun({ operation, requestBody, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.agent_explore.runs.create",
        input: parseJsonBody(requestBody),
        response,
        context: knowledgeWorkflowContext(authSession),
        errorMessage: "创建智能探索任务失败。"
      });
    },
    async handleGetKnowledgeAgentExploreRun({ operation, runId, url, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.agent_explore.runs.get",
        input: {
          ...protocolPayload(Buffer.alloc(0), url),
          runId
        },
        response,
        context: knowledgeWorkflowContext(authSession),
        errorMessage: "读取智能探索任务失败。"
      });
    },
    async handleKnowledgeSearch({ operation, requestBody, url, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.search",
        input: protocolPayload(requestBody, url),
        response,
        context: {
          runtime,
          metadataStore,
          clientRuntimeAllocator,
          modelDecisionRuntime,
          strategyManagementProvider,
          agentWorkspace,
          authSession
        },
        errorMessage: "知识库检索失败。"
      });
    },
    async handleKnowledgeDocumentStructure({ operation, documentId, url, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.document_structure",
        input: {
          ...protocolPayload(Buffer.alloc(0), url),
          documentId
        },
        response,
        context: { runtime, authSession },
        errorMessage: "读取知识文档结构失败。"
      });
    },
    async handleGetKnowledgeItem({ operation, itemId, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.item",
        input: { itemId },
        response,
        context: { runtime, metadataStore, authSession },
        errorMessage: "读取知识对象失败。"
      });
    },
    async handleGetKnowledgeEvidence({ operation, evidenceId, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.evidence",
        input: { evidenceId },
        response,
        context: accessControlContext(authSession, { runtime }),
        errorMessage: "读取知识证据失败。"
      });
    },
    async handleGetKnowledgeAsset({ operation, assetId, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.asset",
        input: { assetId },
        response,
        context: { runtime, authSession },
        errorMessage: "读取知识库资产失败。"
      });
    },
    async handleRenderKnowledgeMarkdown({ operation, requestBody, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.render_markdown",
        input: parseJsonBody(requestBody),
        response,
        context: { runtime, authSession },
        errorMessage: "渲染知识 Markdown 失败。"
      });
    },
    async handleKnowledgeGraph({ operation, url, response }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.graph",
        input: protocolPayload(Buffer.alloc(0), url),
        response,
        context: { metadataStore },
        errorMessage: "读取知识图谱失败。"
      });
    },
    async handleSearch({ operation, url, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "search.query",
        input: queryPayload(url),
        response,
        context: knowledgeWorkflowContext(authSession),
        errorMessage: "知识检索失败。"
      });
    }
  };
}
