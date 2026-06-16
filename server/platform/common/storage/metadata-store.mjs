import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { createClientRegistryService } from "./client-registry-repository.mjs";
import { createBatchRepository } from "./batch-repository.mjs";
import { createKnowledgeRepository } from "./knowledge-repository.mjs";
import { getRawMailObjectRoot } from "./raw-object-store.mjs";
import { getMetadataDatabasePath, initializeMetadataSchema } from "./schema-manager.mjs";

export { getMetadataDatabasePath } from "./schema-manager.mjs";

function createDefaultSearchService() {
  return {
    search({ query = "", limit = 20, batchId = "", entityTypes = [], formalOnly = false } = {}) {
      return {
        query: String(query || "").trim(),
        batchId: String(batchId || ""),
        limit: Number.isInteger(Number(limit)) && Number(limit) > 0 ? Number(limit) : 20,
        formalOnly: Boolean(formalOnly),
        entityTypes: Array.isArray(entityTypes) ? entityTypes : [],
        items: [],
        unavailable: true,
        unavailableReason: "metadata search domain service is not configured"
      };
    }
  };
}

function createDefaultTransactionLifecycleService() {
  return {
    persistTransactionLineages() {},
    refreshTransactionLineageStates() {
      return {
        refreshedCount: 0,
        unavailable: true,
        unavailableReason: "transaction lifecycle domain service is not configured"
      };
    },
    resolveTransactionLifecycle() {
      return {
        lifecycleState: "unknown",
        unavailable: true,
        unavailableReason: "transaction lifecycle domain service is not configured"
      };
    }
  };
}

function createDomainService(factory, fallbackFactory, input) {
  return typeof factory === "function" ? factory(input) : fallbackFactory();
}

export function createMetadataStore({ userDataPath, domainServices = {} }) {
  fs.mkdirSync(path.join(userDataPath, "metadata"), { recursive: true });
  const db = new Database(getMetadataDatabasePath(userDataPath));
  initializeMetadataSchema(db);

  const batchRepository = createBatchRepository({
    db,
    userDataPath,
    textIndexing: createDomainService(
      domainServices.createTextIndexingService,
      () => null,
      { db }
    )
  });
  const lifecycleService = createDomainService(
    domainServices.createTransactionLifecycleService,
    createDefaultTransactionLifecycleService,
    { db }
  );
  const clientRegistryService = createClientRegistryService({ db });
  const searchService = createDomainService(
    domainServices.createSearchService,
    createDefaultSearchService,
    { db }
  );
  const knowledgeRepository = createKnowledgeRepository({ db });

  return {
    get databasePath() {
      return getMetadataDatabasePath(userDataPath);
    },
    get objectRootPath() {
      return getRawMailObjectRoot(userDataPath);
    },
    // Expose the underlying SQLite db for services that need direct access
    // (e.g. agent blueprint store, workspace store).
    get db() {
      return db;
    },
    close() {
      db.close();
    },
    beginBatch(input) {
      return batchRepository.beginBatch(input);
    },
    updateBatchStatus(batchId, status, error = "") {
      return batchRepository.updateBatchStatus(batchId, status, error);
    },
    persistSources(input) {
      return batchRepository.persistSources(input);
    },
    persistPreprocessResult(input) {
      return batchRepository.persistPreprocessResult(input);
    },
    persistAnalysis({ batchId, result, warnings, rules }) {
      const canonicalKnowledge = knowledgeRepository.buildCanonicalKnowledge({
        batchId,
        result
      });
      result.knowledge = canonicalKnowledge;
      batchRepository.persistAnalysis({
        batchId,
        result,
        warnings,
        rules,
        afterCorePersist: () => {
          lifecycleService.persistTransactionLineages({
            batchId,
            result
          });
          knowledgeRepository.persistCanonicalKnowledge({
            batchId,
            knowledge: canonicalKnowledge
          });
        }
      });
    },
    markBatchFailed(batchId, errorMessage) {
      return batchRepository.markBatchFailed(batchId, errorMessage);
    },
	    getRawMailObject(objectId) {
	      return batchRepository.getRawMailObject(objectId);
	    },
	    migrateRawObjectOwnershipFromJobs(jobs = []) {
	      return batchRepository.migrateRawObjectOwnershipFromJobs(jobs);
	    },
	    listRawObjectStoragePathsByBatch(batchId) {
      return batchRepository.listRawObjectStoragePathsByBatch(batchId);
    },
    hasBatch(batchId) {
      return batchRepository.hasBatch(batchId);
    },
    getBatch(batchId) {
      return batchRepository.getBatch(batchId);
    },
    searchSourceDocuments(input = {}) {
      return batchRepository.searchSourceDocuments(input);
    },
    getSignificantSourceTerms(input = {}) {
      return batchRepository.getSignificantSourceTerms(input);
    },
    listSourceCorpusRawTerms(input = {}) {
      return batchRepository.listSourceCorpusRawTerms(input);
    },
    listSourceVocabularyTermStats(input = {}) {
      return batchRepository.listSourceVocabularyTermStatsByTerms(input);
    },
    async getKnowledgeWordCloudState(input = {}) {
      return batchRepository.getKnowledgeWordCloudState(input);
    },
    async getKnowledgeWordBagTerms(input = {}) {
      return batchRepository.getKnowledgeWordBagTerms(input);
    },
    async saveKnowledgeWordCloudSet(input = {}) {
      return batchRepository.saveKnowledgeWordCloudSet(input);
    },
    async exportKnowledgeWordCloudSet(input = {}) {
      return batchRepository.exportKnowledgeWordCloudSet(input);
    },
    async importKnowledgeWordCloudSet(input = {}) {
      return batchRepository.importKnowledgeWordCloudSet(input);
    },
    async addKnowledgeWordBag(input = {}) {
      return batchRepository.addKnowledgeWordBag(input);
    },
    async updateKnowledgeWordBag(input = {}) {
      return batchRepository.updateKnowledgeWordBag(input);
    },
    async deleteKnowledgeWordBag(input = {}) {
      return batchRepository.deleteKnowledgeWordBag(input);
    },
    getStorageSummary() {
      return {
        databasePath: getMetadataDatabasePath(userDataPath),
        objectRootPath: getRawMailObjectRoot(userDataPath),
        ...batchRepository.getStorageSummary(),
        knowledge: knowledgeRepository.getStorageSummary()
      };
    },
    deleteBatchRecords(batchId) {
      knowledgeRepository.deleteBatch(batchId);
      return batchRepository.deleteBatchRecords(batchId);
    },
    rebuildSourceVocabulary(input = {}) {
      return batchRepository.rebuildSourceVocabulary(input);
    },
    deleteBatchRow(batchId) {
      return batchRepository.deleteBatchRow(batchId);
    },
    upsertDeletionOperation(input) {
      return batchRepository.upsertDeletionOperation(input);
    },
    updateDeletionOperation(operationId, patch) {
      return batchRepository.updateDeletionOperation(operationId, patch);
    },
    getDeletionOperationByBatchId(batchId) {
      return batchRepository.getDeletionOperationByBatchId(batchId);
    },
    listPendingDeletionOperations() {
      return batchRepository.listPendingDeletionOperations();
    },
    deleteDeletionOperation(operationId) {
      return batchRepository.deleteDeletionOperation(operationId);
    },
    getBatchArtifactPaths(batchId) {
      return batchRepository.getBatchArtifactPaths(batchId);
    },
    recordClientCheckIn(input) {
      return clientRegistryService.recordClientCheckIn(input);
    },
    listClientRegistrations(input) {
      return clientRegistryService.listClientRegistrations(input);
    },
    refreshTransactionLineageStates(referenceTime, settings = {}) {
      return lifecycleService.refreshTransactionLineageStates(referenceTime, settings);
    },
    resolveTransactionLifecycle(input) {
      return lifecycleService.resolveTransactionLifecycle(input);
    },
    search(input) {
      return searchService.search(input);
    },
    syncKnowledge(input) {
      return knowledgeRepository.sync(input);
    },
    submitKnowledgeChanges(input) {
      return knowledgeRepository.submitChanges(input);
    },
    listKnowledgeReviewItems(input) {
      return knowledgeRepository.listReviewItems(input);
    },
    resolveKnowledgeReviewItem(input) {
      return knowledgeRepository.resolveReviewItem(input);
    },
    searchKnowledge(input) {
      return knowledgeRepository.search(input);
    },
    getKnowledgeItem(input) {
      return knowledgeRepository.getItem(input);
    },
    getKnowledgeGraph(input) {
      return knowledgeRepository.getGraph(input);
    }
  };
}
