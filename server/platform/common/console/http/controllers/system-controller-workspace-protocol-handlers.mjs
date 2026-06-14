export function createSystemControllerWorkspaceProtocolHandlers({
  sendConsoleDomainOperation,
  protocolPayload,
  operationAuditStore,
  checkpointTreeApi,
  agentWorkspace,
  knowledgeWorkflowContext = () => ({}),
  accessControlContext = () => ({})
}) {
  function knowledgeTransformationContext(authSession = null) {
    return {
      ...knowledgeWorkflowContext(authSession),
      ...accessControlContext(authSession)
    };
  }

  return {
    async handleWorkspaceAuditQuery({ operation, url, response }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "workspace.audit.query",
        input: protocolPayload(Buffer.alloc(0), url),
        response,
        context: { operationAuditStore },
        errorMessage: "查询 workspace 审计失败。"
      });
    },
    async handleWorkspaceOperationHistory({ operation, url, response }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "workspace.operation.history",
        input: protocolPayload(Buffer.alloc(0), url),
        response,
        context: { operationAuditStore },
        errorMessage: "查询 workspace 操作历史失败。"
      });
    },
    async handleWorkspaceAssetTargetConnect({ operation, requestBody, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "workspace.asset.target.connect",
        input: protocolPayload(requestBody),
        response,
        context: { agentWorkspace, checkpointTreeApi, operationAuditStore, authSession },
        errorMessage: "连接 workspace 资产目标失败。"
      });
    },
    async handleWorkspaceAssetList({ operation, url, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "workspace.asset.list",
        input: protocolPayload(Buffer.alloc(0), url),
        response,
        context: { agentWorkspace, checkpointTreeApi, operationAuditStore, authSession },
        errorMessage: "列出 workspace 统一资产失败。"
      });
    },
    async handleWorkspaceAssetRead({ operation, url, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "workspace.asset.read",
        input: protocolPayload(Buffer.alloc(0), url),
        response,
        context: { agentWorkspace, checkpointTreeApi, operationAuditStore, authSession },
        errorMessage: "读取 workspace 统一资产失败。"
      });
    },
    async handleWorkspaceAssetSubmit({ operation, requestBody, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "workspace.asset.submit",
        input: protocolPayload(requestBody),
        response,
        context: { agentWorkspace, checkpointTreeApi, operationAuditStore, authSession },
        errorMessage: "提交 workspace 统一资产失败。"
      });
    },
    async handleWorkspaceAssetMutate({ operation, requestBody, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "workspace.asset.mutate",
        input: protocolPayload(requestBody),
        response,
        context: { agentWorkspace, checkpointTreeApi, operationAuditStore, authSession },
        errorMessage: "变更 workspace 统一资产失败。"
      });
    },
    async handleWorkspaceAssetSyncPlan({ operation, requestBody, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "workspace.asset.sync.plan",
        input: protocolPayload(requestBody),
        response,
        context: { agentWorkspace, checkpointTreeApi, operationAuditStore, authSession },
        errorMessage: "生成 workspace 统一资产同步计划失败。"
      });
    },
    async handleWorkspaceAssetSyncApply({ operation, requestBody, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "workspace.asset.sync.apply",
        input: protocolPayload(requestBody),
        response,
        context: { agentWorkspace, checkpointTreeApi, operationAuditStore, authSession },
        errorMessage: "应用 workspace 统一资产同步计划失败。"
      });
    },
    async handleWorkspaceAssetImport({ operation, requestBody, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "workspace.asset.import",
        input: protocolPayload(requestBody),
        response,
        context: { agentWorkspace, checkpointTreeApi, operationAuditStore, authSession },
        errorMessage: "导入 workspace 统一资产失败。"
      });
    },
    async handleWorkspaceAssetExport({ operation, requestBody, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "workspace.asset.export",
        input: protocolPayload(requestBody),
        response,
        context: { agentWorkspace, checkpointTreeApi, operationAuditStore, authSession },
        errorMessage: "导出 workspace 统一资产失败。"
      });
    },
    async handleWorkspaceAssetReviewComment({ operation, requestBody, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "workspace.asset.review.comment",
        input: protocolPayload(requestBody),
        response,
        context: { agentWorkspace, checkpointTreeApi, operationAuditStore, authSession },
        errorMessage: "评论 workspace 统一资产评审失败。"
      });
    },
    async handleWorkspaceAssetReviewRequestChanges({ operation, requestBody, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "workspace.asset.review.requestChanges",
        input: protocolPayload(requestBody),
        response,
        context: { agentWorkspace, checkpointTreeApi, operationAuditStore, authSession },
        errorMessage: "要求 workspace 统一资产修改失败。"
      });
    },
    async handleWorkspaceAssetReviewApprove({ operation, requestBody, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "workspace.asset.review.approve",
        input: protocolPayload(requestBody),
        response,
        context: { agentWorkspace, checkpointTreeApi, operationAuditStore, authSession },
        errorMessage: "批准 workspace 统一资产评审失败。"
      });
    },
    async handleWorkspaceAssetCheckpoint({ operation, requestBody, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "workspace.asset.checkpoint",
        input: protocolPayload(requestBody),
        response,
        context: { agentWorkspace, checkpointTreeApi, operationAuditStore, authSession },
        errorMessage: "创建 workspace 统一资产 checkpoint 失败。"
      });
    },
    async handleWorkspaceAssetLineage({ operation, requestBody, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "workspace.asset.lineage",
        input: protocolPayload(requestBody),
        response,
        context: { agentWorkspace, checkpointTreeApi, operationAuditStore, authSession },
        errorMessage: "查询 workspace 统一资产血缘失败。"
      });
    },
    async handleWorkspaceAssetReceiptGet({ operation, requestBody, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "workspace.asset.receipt.get",
        input: protocolPayload(requestBody),
        response,
        context: { agentWorkspace, checkpointTreeApi, operationAuditStore, authSession },
        errorMessage: "读取 workspace 统一资产凭证失败。"
      });
    },
    async handleWorkspaceAssetBackfill({ operation, requestBody, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "workspace.asset.backfill",
        input: protocolPayload(requestBody),
        response,
        context: { agentWorkspace, checkpointTreeApi, operationAuditStore, authSession },
        errorMessage: "重建 workspace 统一资产目录失败。"
      });
    },
    async handleWorkspaceCheckpointTreeList({ operation, url, response }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "workspace.checkpoint.tree.list",
        input: protocolPayload(Buffer.alloc(0), url),
        response,
        context: { checkpointTreeApi },
        errorMessage: "列出 workspace checkpoint tree 失败。"
      });
    },
    async handleWorkspaceCheckpointNodeGet({ operation, treeId, response }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "workspace.checkpoint.node.get",
        input: { treeId },
        response,
        context: { checkpointTreeApi },
        errorMessage: "读取 workspace checkpoint 节点失败。"
      });
    },
    async handleWorkspaceCheckpointDiff({ operation, requestBody, response }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "workspace.checkpoint.diff",
        input: protocolPayload(requestBody),
        response,
        context: { checkpointTreeApi },
        errorMessage: "生成 workspace checkpoint diff 失败。"
      });
    },
    async handleWorkspaceCheckpointRestorePreview({ operation, requestBody, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "workspace.checkpoint.restore.preview",
        input: protocolPayload(requestBody),
        response,
        context: { checkpointTreeApi, agentWorkspace, authSession },
        errorMessage: "预览 workspace checkpoint 恢复失败。"
      });
    },
    async handleWorkspaceCheckpointRestore({ operation, requestBody, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "workspace.checkpoint.restore",
        input: protocolPayload(requestBody),
        response,
        context: { checkpointTreeApi, agentWorkspace, authSession },
        errorMessage: "恢复 workspace checkpoint 失败。"
      });
    },
    async handleWorkspaceCheckpointScopeQuery({ operation, requestBody, response }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "workspace.checkpoint.scope.query",
        input: protocolPayload(requestBody),
        response,
        context: { checkpointTreeApi },
        errorMessage: "查询 workspace checkpoint 影响范围失败。"
      });
    },
    async handleWorkspaceOperationRevertScope({ operation, requestBody, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "workspace.operation.revert.scope",
        input: protocolPayload(requestBody),
        response,
        context: { operationAuditStore, authSession },
        errorMessage: "预览 workspace 操作回滚范围失败。"
      });
    },
    async handleWorkspaceProposalCreate({ operation, requestBody, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "workspace.proposal.create",
        input: protocolPayload(requestBody),
        response,
        context: { agentWorkspace, authSession },
        errorMessage: "创建 workspace 提案失败。"
      });
    },
    async handleWorkspaceProposalApply({ operation, requestBody, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "workspace.proposal.apply",
        input: protocolPayload(requestBody),
        response,
        context: { agentWorkspace, authSession },
        errorMessage: "审核并应用 workspace 提案失败。"
      });
    },
    async handleWorkspaceCodeTargetEvaluate({ operation, requestBody, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "workspace.code.target.evaluate",
        input: protocolPayload(requestBody),
        response,
        context: { authSession },
        errorMessage: "评估代码变更目标失败。"
      });
    },
    async handleWorkspaceCodeChangePrepare({ operation, requestBody, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "workspace.code.change.prepare",
        input: protocolPayload(requestBody),
        response,
        context: { authSession },
        errorMessage: "准备代码变更失败。"
      });
    },
    async handleWorkspaceCodeChangeUpload({ requestBody, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: "workspace.code.change.upload",
        input: protocolPayload(requestBody),
        response,
        context: { authSession },
        errorMessage: "Workspace code change upload failed."
      });
    },
    async handleWorkspaceCodeChangeLink({ operation, requestBody, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "workspace.code.change.link",
        input: protocolPayload(requestBody),
        response,
        context: { authSession },
        errorMessage: "关联代码变更与 workspace 失败。"
      });
    },
    async handleWorkspaceCodeChangeStatusSync({ operation, requestBody, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "workspace.code.change.status.sync",
        input: protocolPayload(requestBody),
        response,
        context: { authSession },
        errorMessage: "同步代码评审状态失败。"
      });
    },
    async handleCodespaceProvidersManifest({ operation, requestBody, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "codespace.providers.manifest",
        input: protocolPayload(requestBody),
        response,
        context: { authSession },
        errorMessage: "读取 Codespace provider manifest 失败。"
      });
    },
    async handleCodespaceRepositoryStatus({ operation, requestBody, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "codespace.repository.status",
        input: protocolPayload(requestBody),
        response,
        context: { authSession },
        errorMessage: "读取 Codespace repository 状态失败。"
      });
    },
    async handleCodespaceTreeList({ operation, requestBody, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "codespace.tree.list",
        input: protocolPayload(requestBody),
        response,
        context: { authSession },
        errorMessage: "读取 Codespace tree 失败。"
      });
    },
    async handleCodespaceFileRead({ operation, requestBody, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "codespace.file.read",
        input: protocolPayload(requestBody),
        response,
        context: { authSession },
        errorMessage: "读取 Codespace file 失败。"
      });
    },
    async handleCodespaceDiffRead({ operation, requestBody, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "codespace.diff.read",
        input: protocolPayload(requestBody),
        response,
        context: { authSession },
        errorMessage: "读取 Codespace diff 失败。"
      });
    },
    async handleCodespaceChangePrepare({ operation, requestBody, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "codespace.change.prepare",
        input: protocolPayload(requestBody),
        response,
        context: { authSession },
        errorMessage: "准备 Codespace changeSet 失败。"
      });
    },
    async handleCodespaceChangeUpload({ operation, requestBody, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "codespace.change.upload",
        input: protocolPayload(requestBody),
        response,
        context: { authSession },
        errorMessage: "上传 Codespace change 失败。"
      });
    },
    async handleCodespaceReviewComment({ operation, requestBody, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "codespace.review.comment",
        input: protocolPayload(requestBody),
        response,
        context: { authSession },
        errorMessage: "提交 Codespace review 评论失败。"
      });
    },
    async handleCodespaceReviewRequestChanges({ operation, requestBody, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "codespace.review.requestChanges",
        input: protocolPayload(requestBody),
        response,
        context: { authSession },
        errorMessage: "请求 Codespace review 修改失败。"
      });
    },
    async handleCodespaceReviewApprove({ operation, requestBody, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "codespace.review.approve",
        input: protocolPayload(requestBody),
        response,
        context: { authSession },
        errorMessage: "批准 Codespace review 失败。"
      });
    },
    async handleCodespaceReviewStatusSync({ operation, requestBody, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "codespace.review.status.sync",
        input: protocolPayload(requestBody),
        response,
        context: { authSession },
        errorMessage: "同步 Codespace review 状态失败。"
      });
    },
    async handleRawCorpusFormatConvert({ operation, requestBody, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "raw-corpus.format.convert",
        input: protocolPayload(requestBody),
        response,
        context: knowledgeTransformationContext(authSession),
        errorMessage: "转换原始语料格式失败。"
      });
    },
    async handleKnowledgeDossierExport({ operation, requestBody, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.dossier.export",
        input: protocolPayload(requestBody),
        response,
        context: knowledgeTransformationContext(authSession),
        errorMessage: "导出统一事项 dossier 失败。"
      });
    }
  };
}
