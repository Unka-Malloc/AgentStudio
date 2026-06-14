export function createSystemControllerKnowledgeOperationsHandlers({
  sendConsoleDomainOperation,
  parseJsonBody,
  queryPayload,
  knowledgeWorkflowContext,
  storageProvider
}) {
  return {
    async handleGetRules({ operation, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "email_rules.get",
        response,
        context: knowledgeWorkflowContext(authSession),
        errorMessage: "读取邮件规则失败。"
      });
    },
    async handleSetRules({ operation, requestBody, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "email_rules.set",
        input: parseJsonBody(requestBody),
        response,
        context: knowledgeWorkflowContext(authSession),
        errorMessage: "保存邮件规则失败。"
      });
    },
    async handleGetExpertVocabulary({ operation, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "expert_vocabulary.get",
        response,
        context: knowledgeWorkflowContext(authSession),
        errorMessage: "读取专家词汇库失败。"
      });
    },
    async handleSetExpertVocabulary({ operation, requestBody, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "expert_vocabulary.set",
        input: parseJsonBody(requestBody),
        response,
        context: knowledgeWorkflowContext(authSession),
        errorMessage: "保存专家词汇库失败。"
      });
    },
    async handleListExpertVocabularyVersions({ operation, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "expert_vocabulary.versions",
        response,
        context: knowledgeWorkflowContext(authSession),
        errorMessage: "读取专家词汇库版本失败。"
      });
    },
    async handleGetKnowledgeTaxonomy({ operation, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge_taxonomy.get",
        response,
        context: knowledgeWorkflowContext(authSession),
        errorMessage: "读取知识分类标准失败。"
      });
    },
    async handleSetKnowledgeTaxonomy({ operation, requestBody, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge_taxonomy.set",
        input: parseJsonBody(requestBody),
        response,
        context: knowledgeWorkflowContext(authSession),
        errorMessage: "保存知识分类标准失败。"
      });
    },
    async handleListKnowledgeTaxonomyVersions({ operation, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge_taxonomy.versions",
        response,
        context: knowledgeWorkflowContext(authSession),
        errorMessage: "读取知识分类标准版本失败。"
      });
    },
    async handleGetStorageSummary({ operation, response }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "storage.summary",
        response,
        context: { storageProvider },
        errorMessage: "读取存储摘要失败。"
      });
    },
    async handleRebuildSourceVocabulary({ operation, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "storage.source_vocabulary.rebuild",
        response,
        context: knowledgeWorkflowContext(authSession),
        errorMessage: "重建源文件词汇库失败。"
      });
    },
    async handleGetSignificantSourceTerms({ operation, requestBody, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.corpus.significant_terms",
        input: parseJsonBody(requestBody),
        response,
        context: knowledgeWorkflowContext(authSession),
        errorMessage: "计算语料显著词失败。"
      });
    },
    async handleKnowledgeDocumentParse({ operation, requestBody, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.document_parse",
        input: parseJsonBody(requestBody),
        response,
        context: knowledgeWorkflowContext(authSession),
        errorMessage: "统一文档解析失败。"
      });
    },
    async handleKnowledgeWordClouds({ operation, requestBody, url, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.word_clouds.get",
        input: requestBody?.length ? parseJsonBody(requestBody) : queryPayload(url),
        response,
        context: knowledgeWorkflowContext(authSession),
        errorMessage: "读取知识词云失败。"
      });
    },
    async handleGetKnowledgeWordBagTerms({ operation, requestBody, url, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.word_bags.terms",
        input: requestBody?.length ? parseJsonBody(requestBody) : queryPayload(url),
        response,
        context: knowledgeWorkflowContext(authSession),
        errorMessage: "读取词袋词项失败。"
      });
    },
    async handleSaveKnowledgeWordClouds({ operation, requestBody, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.word_clouds.save",
        input: parseJsonBody(requestBody),
        response,
        context: knowledgeWorkflowContext(authSession),
        errorMessage: "保存知识词云失败。"
      });
    },
    async handleExportKnowledgeWordClouds({ operation, requestBody, url, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.word_clouds.export",
        input: requestBody?.length ? parseJsonBody(requestBody) : queryPayload(url),
        response,
        context: knowledgeWorkflowContext(authSession),
        errorMessage: "导出知识词云失败。"
      });
    },
    async handleImportKnowledgeWordClouds({ operation, requestBody, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.word_clouds.import",
        input: parseJsonBody(requestBody),
        response,
        context: knowledgeWorkflowContext(authSession),
        errorMessage: "导入知识词云失败。"
      });
    },
    async handleAddKnowledgeWordBag({ operation, requestBody, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.word_bags.add",
        input: parseJsonBody(requestBody),
        response,
        context: knowledgeWorkflowContext(authSession),
        errorMessage: "新增词袋失败。"
      });
    },
    async handleUpdateKnowledgeWordBag({ operation, wordBagId, requestBody, response, authSession }) {
      const payload = parseJsonBody(requestBody);
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.word_bags.update",
        input: {
          ...payload,
          wordBagId: payload.wordBagId || wordBagId
        },
        response,
        context: knowledgeWorkflowContext(authSession),
        errorMessage: "更新词袋失败。"
      });
    },
    async handleDeleteKnowledgeWordBag({ operation, wordBagId, requestBody, url, response, authSession }) {
      const payload = requestBody?.length ? parseJsonBody(requestBody) : queryPayload(url);
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.word_bags.delete",
        input: {
          ...payload,
          wordBagId: payload.wordBagId || wordBagId
        },
        response,
        context: knowledgeWorkflowContext(authSession),
        errorMessage: "删除词袋失败。"
      });
    },
    async handleStorageDoctor({ operation, response }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "storage.doctor",
        response,
        context: { storageProvider },
        errorMessage: "诊断存储一致性失败。"
      });
    },
    async handleStorageReconcile({ operation, requestBody, response }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "storage.reconcile",
        input: parseJsonBody(requestBody),
        response,
        context: { storageProvider },
        errorMessage: "修复存储一致性失败。"
      });
    },
    async handleStorageBackups({ operation, response }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "storage.backups.list",
        response,
        context: { storageProvider },
        errorMessage: "列出存储备份失败。"
      });
    },
    async handleStorageBackupCreate({ operation, requestBody, response }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "storage.backups.create",
        input: parseJsonBody(requestBody),
        response,
        context: { storageProvider },
        errorMessage: "创建存储备份失败。"
      });
    },
    async handleStorageBackupRestorePreview({ operation, requestBody, response }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "storage.backups.restore_preview",
        input: parseJsonBody(requestBody),
        response,
        context: { storageProvider },
        errorMessage: "预览存储恢复失败。"
      });
    },
    async handleStorageBackupRestore({ operation, requestBody, response }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "storage.backups.restore",
        input: parseJsonBody(requestBody),
        response,
        context: { storageProvider },
        errorMessage: "恢复存储备份失败。"
      });
    },
    async handleEnhanceAffairTaxonomy({ operation, requestBody, response, authSession }) {
      await sendConsoleDomainOperation({
        operationId: operation?.id || "knowledge.affair_taxonomy",
        input: parseJsonBody(requestBody),
        response,
        context: knowledgeWorkflowContext(authSession),
        errorMessage: "事务分类增强失败。"
      });
    }
  };
}
