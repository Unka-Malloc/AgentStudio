import {
  loadKnowledgeAnalysisRuntime,
  loadKnowledgeDocumentParsingRuntime,
  loadKnowledgeEmailRulesRuntime,
  loadKnowledgeFileProcessorRuntime,
  loadKnowledgeNormalizedDocumentsRuntime,
  loadKnowledgePreprocessResultRuntime,
  saveSettings,
} from "../../../platform/interactive/product-api.mjs";
import { resolveUploadSessionFiles } from "../../../protocols/checkpoint/upload-session-store.mjs";
import { resolveArchiveBatchIdentity } from "./archive-batch-id.mjs";

function runtimeFeatureEnabled(runtime = {}, featureId = "") {
  const activeFeatureIds = runtime?.runtimeOptions?.featureRuntime?.activeFeatureIds;
  return !Array.isArray(activeFeatureIds) || activeFeatureIds.length === 0 || activeFeatureIds.includes(featureId);
}

async function loadFileProcessorRuntime(runtime = {}) {
  if (!runtimeFeatureEnabled(runtime, "document-parser")) {
    throw new Error("Document parser feature is not active in this feature edition.");
  }
  return loadKnowledgeFileProcessorRuntime();
}

async function loadNormalizedDocumentsRuntime(runtime = {}) {
  if (!runtimeFeatureEnabled(runtime, "document-parser")) {
    return null;
  }
  return loadKnowledgeNormalizedDocumentsRuntime();
}

function serializeSourceFilesForClient(sources) {
  return sources.map((source) => ({
    id: source.id,
    name: source.name,
    path: source.path,
    kind: source.kind,
    sourceCreatedAt: source.sourceCreatedAt || "",
    sourceUpdatedAt: source.sourceUpdatedAt || "",
    sourceCollectedAt: source.sourceCollectedAt || "",
    text: source.text || "",
    mediaType: source.mediaType || "",
    imageDataUrl: source.imageDataUrl || "",
    rawObjectId: source.rawObject?.objectId || "",
    clientUid: source.rawObject?.clientUid || "",
    sourceType: source.rawObject?.sourceType || "",
    providerId: source.providerId || source.rawObject?.providerId || "",
    externalId: source.externalId || source.rawObject?.externalId || "",
    syncBatchId: source.syncBatchId || source.rawObject?.syncBatchId || "",
    contentHash: source.contentHash || source.rawObject?.contentHash || source.originalSha256 || "",
    capturedAt: source.capturedAt || source.rawObject?.capturedAt || "",
    sourceMetadata: source.sourceMetadata || source.rawObject?.sourceMetadata || {},
    archiveFileName: source.rawObject?.archiveFileName || "",
    originalFileName: source.rawObject?.originalFileName || "",
    originalRelativePath:
      source.rawObject?.originalRelativePath || source.originalRelativePath || "",
    storageRelativePath: source.rawObject?.storageRelativePath || "",
    rawObjectSha256: source.rawObject?.sha256 || source.originalSha256 || "",
    rawObjectByteSize: source.rawObject?.byteSize || source.originalByteSize || 0,
    documentParserId: source.documentParserId || "",
    documentMetadata: source.documentMetadata || {},
    embeddedDocuments: source.embeddedDocuments || [],
    visualElements: source.visualElements || []
  }));
}

function firstText(...values) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) {
      return text;
    }
  }
  return "";
}

function createInitialContext({
  userDataPath,
  payload,
  runtime,
  reportProgress,
  jobId,
  archiveBatchId,
  generatedAt
}) {
  const executionRuntime =
    runtime && typeof runtime.createExecutionView === "function"
      ? runtime.createExecutionView()
      : runtime;
  return {
    userDataPath,
    payload,
    runtime: executionRuntime,
    reportProgress,
    jobId,
    archiveBatchId,
    generatedAt,
    metadataStore: executionRuntime.metadataStore || runtime.metadataStore,
    warnings: [],
    settings: null,
    rules: null,
    uploadSessionFiles: [],
    sources: [],
    prepared: null,
    preprocessResult: null,
    analysis: null,
    lifecycle: null,
    normalizedDocuments: null,
    result: null
  };
}

export function createJobPipeline({ userDataPath, payload, runtime, reportProgress, jobId, generatedAt }) {
  const archiveBatchIdentity = resolveArchiveBatchIdentity({
    archiveBatchId:
      payload?.checkpointReceipt?.archiveBatchId ||
      payload?.archiveBatchId ||
      payload?.checkpoint?.archiveBatchId ||
      "",
    batchId: payload?.batchId || payload?.checkpoint?.batchId || "",
    clientBatchId: payload?.clientBatchId || payload?.checkpoint?.clientBatchId || "",
    checkpointId:
      payload?.checkpointReceipt?.checkpointId ||
      payload?.checkpointId ||
      payload?.checkpoint?.checkpointId ||
      "",
    manifestDigest:
      payload?.checkpointReceipt?.manifestSha256 ||
      payload?.checkpointReceipt?.manifestDigest ||
      payload?.checkpoint?.manifestDigest ||
      payload?.manifestSha256 ||
      "",
    inputDigest: payload?.checkpoint?.inputDigest || payload?.inputDigest || ""
  });
  const archiveBatchId = archiveBatchIdentity.archiveBatchId || jobId;
  const clientUid = firstText(
    payload?.checkpointReceipt?.clientUid,
    payload?.clientUid,
    payload?.clientId,
    payload?.checkpoint?.clientUid,
    payload?.checkpoint?.clientId,
    "unknown-client"
  );
  const sourceType = firstText(
    payload?.checkpointReceipt?.sourceType,
    payload?.sourceType,
    payload?.resourceType,
    payload?.checkpoint?.sourceType,
    payload?.checkpoint?.resourceType,
    "upload"
  );
  const connectorSource = {
    providerId: firstText(
      payload?.checkpointReceipt?.providerId,
      payload?.providerId,
      payload?.checkpoint?.providerId
    ),
    externalId: firstText(
      payload?.checkpointReceipt?.externalId,
      payload?.externalId,
      payload?.checkpoint?.externalId
    ),
    syncBatchId: firstText(
      payload?.checkpointReceipt?.syncBatchId,
      payload?.syncBatchId,
      payload?.checkpoint?.syncBatchId
    ),
    contentHash: firstText(
      payload?.checkpointReceipt?.contentHash,
      payload?.contentHash,
      payload?.checkpoint?.contentHash
    ),
    capturedAt: firstText(
      payload?.checkpointReceipt?.capturedAt,
      payload?.capturedAt,
      payload?.checkpoint?.capturedAt
    )
  };

  return {
    createContext() {
      return createInitialContext({
        userDataPath,
        payload,
        runtime,
        reportProgress,
        jobId,
        archiveBatchId,
        generatedAt
      });
    },
    async run(context) {
      context.reportProgress({
        progressPercent: 8,
        stage: "保存配置"
      });
      context.settings = await saveSettings(userDataPath, payload.settings);
      await loadFileProcessorRuntime(context.runtime);
      const [
        documentParsingModule,
        emailRulesModule,
        analysisModule,
        preprocessResultModule
      ] = await Promise.all([
        loadKnowledgeDocumentParsingRuntime(),
        loadKnowledgeEmailRulesRuntime(),
        loadKnowledgeAnalysisRuntime(),
        loadKnowledgePreprocessResultRuntime()
      ]);
      const documentParsingRuntime = documentParsingModule.createDocumentParsingRuntime();
      context.rules = await emailRulesModule.loadEmailRules(userDataPath);
      context.metadataStore.beginBatch({
        batchId: context.archiveBatchId,
        jobId,
        generatedAt,
        settings: context.settings
      });

      context.reportProgress({
        progressPercent: 26,
        stage: "解析输入文档"
      });
      if (payload.uploadSessionId) {
        context.uploadSessionFiles = await resolveUploadSessionFiles(userDataPath, payload.uploadSessionId);
      }
      const documentParseResult = await documentParsingRuntime.parseDocuments({
        inputText: payload.inputText || "",
        filePaths: Array.isArray(payload.filePaths) ? payload.filePaths : [],
        fileManifestPath: payload.fileManifestPath || payload.knowledgeSource?.fileManifestPath || "",
        uploadedFiles:
          context.uploadSessionFiles.length > 0
            ? context.uploadSessionFiles
            : Array.isArray(payload.uploadedFiles)
              ? payload.uploadedFiles
              : [],
        settings: context.settings,
        userDataPath,
        generatedAt,
        batchId: jobId,
        archiveBatchId: context.archiveBatchId,
        clientUid,
        sourceType,
        ...connectorSource,
        runtime: context.runtime,
        reportProgress: context.reportProgress,
        expectedOutput: payload.documentParsing?.expectedOutput || "chunks",
        pipelineId: payload.documentParsing?.pipelineId || payload.parserPipelineId || "",
        chunking: payload.documentParsing?.chunking || payload.chunking || {},
        contextBudget: payload.documentParsing?.contextBudget || payload.contextBudget || {},
        payloadBudget: payload.documentParsing?.payloadBudget || payload.payloadBudget || {},
        granularity: payload.documentParsing?.granularity || payload.granularity || {},
        dynamicParsing: payload.documentParsing?.dynamicParsing || payload.dynamicParsing || {},
        documentParsing: payload.documentParsing || {}
      });
	      context.sources = documentParseResult.sources;
	      for (const source of context.sources || []) {
	        if (source?.rawObject) {
	          source.rawObject.jobId = jobId;
	          source.rawObject.ownerSubjectId = firstText(payload.ownerSubjectId, payload.ownerUserId, payload.ownerUsername);
	          source.rawObject.ownerUserId = firstText(payload.ownerUserId, payload.ownerSubjectId);
	          source.rawObject.ownerUsername = firstText(payload.ownerUsername);
	        }
	      }
	      context.warnings.push(...(documentParseResult.warnings || []));
	      context.metadataStore.persistSources({
	        batchId: context.archiveBatchId,
	        jobId,
	        ownerSubjectId: firstText(payload.ownerSubjectId, payload.ownerUserId, payload.ownerUsername),
	        ownerUserId: firstText(payload.ownerUserId, payload.ownerSubjectId),
	        ownerUsername: firstText(payload.ownerUsername),
	        sources: context.sources,
	        warnings: context.warnings,
	        rules: context.rules
      });

      context.reportProgress({
        progressPercent: 54,
        stage: "正文结构已提取"
      });
      context.preprocessResult = documentParseResult.preprocessResult;
      context.prepared = context.preprocessResult;
      context.metadataStore.persistPreprocessResult({
        batchId: context.archiveBatchId,
        preprocessResult: context.preprocessResult
      });

      context.reportProgress({
        progressPercent: 76,
        stage: "分析事务与人物网络"
      });
      const analysisResult = await analysisModule.runConfiguredAnalysisModule({
        runtime: context.runtime,
        sources: context.sources,
        chunks: context.prepared.chunks,
        generatedAt,
        settings: context.settings,
        rules: context.rules
      });
      context.analysis = analysisResult.analysis;
      context.lifecycle = context.metadataStore.resolveTransactionLifecycle({
        batchId: context.archiveBatchId,
        transactions: context.analysis.transactions,
        timeline: context.analysis.timeline,
        settings: context.settings,
        rules: context.rules,
        generatedAt
      });
      context.analysis.transactions = context.lifecycle.transactions;
      context.analysis.timeline = context.lifecycle.timeline;
      context.analysis.overview.timelineCount = context.analysis.timeline.length;

      context.reportProgress({
        progressPercent: 94,
        stage: "生成归一化 DOCX 知识文档"
      });
      const normalizedDocumentsRuntime = await loadNormalizedDocumentsRuntime(context.runtime);
      context.normalizedDocuments = normalizedDocumentsRuntime
        ? await normalizedDocumentsRuntime.generateNormalizedDocuments({
            userDataPath,
            jobId,
            generatedAt,
            sources: context.sources,
            chunks: context.prepared.chunks,
            analysis: context.analysis
          })
        : { documents: [], manifest: null, warnings: ["Document parser feature is disabled."] };
      context.warnings.push(...(context.normalizedDocuments.warnings || []));

      context.result = {
        batchId: context.archiveBatchId,
        jobId,
        generatedAt,
        overview: context.analysis.overview,
        emails: context.analysis.emails,
        threads: context.analysis.threads,
        transactions: context.analysis.transactions,
        people: context.analysis.people,
        timeline: context.analysis.timeline,
        network: context.analysis.network,
        associations: context.analysis.associations,
        lifecycle: context.lifecycle.summary,
        analysisRuntime: {
          ...analysisResult.runtimeInfo,
          availableModules: await analysisModule.listAvailableAnalysisModules(
            context.runtime,
            context.settings
          ),
          selectedModuleId: analysisResult.runtimeInfo.moduleId
        },
        retrieval: context.analysis.retrieval,
        preprocess: context.preprocessResult,
        preprocessSummary: preprocessResultModule.summarizePreprocessResult(context.preprocessResult),
        warnings: context.warnings,
        normalizedDocuments: context.normalizedDocuments,
        sourceFiles: serializeSourceFilesForClient(context.sources)
      };

      context.reportProgress({
        progressPercent: 100,
        stage: "结果已生成"
      });

      context.metadataStore.persistAnalysis({
        batchId: context.archiveBatchId,
        result: context.result,
        warnings: context.warnings,
        rules: context.rules
      });

      for (const hook of context.runtime.postCommitHooks || []) {
        await hook.execute({
          batchId: context.archiveBatchId,
          jobId,
          result: context.result,
          settings: context.settings,
          rules: context.rules,
          metadataStore: context.metadataStore
        });
      }

      return context.result;
    }
  };
}
