import path from "node:path";

function result(status, payload) {
  return { status, payload };
}

async function publishProtocolEvent(protocolEventBus, topic, payload, options = {}) {
  if (!protocolEventBus || typeof protocolEventBus.publish !== "function") {
    return null;
  }
  return protocolEventBus.publish(topic, payload, options);
}

function mutationErrorResult(error) {
  const statusCode = Number(error?.statusCode || 500);
  return result(statusCode >= 400 && statusCode < 600 ? statusCode : 500, {
    ok: false,
    code: error?.code || "word_cloud_error",
    error: error?.message || "词袋操作失败。"
  });
}

function normalizeAuditCorpusPaths(values = []) {
  const paths = [];
  const source = Array.isArray(values) ? values : [values];
  const seen = new Set();
  for (const value of source) {
    const record = typeof value === "string" ? { path: value } : value || {};
    const selectedPath = String(record.path || "").trim();
    if (!selectedPath) {
      continue;
    }
    const type = String(record.type || "").trim();
    const normalized = {
      type: type === "file" || type === "directory" ? type : "",
      path: selectedPath,
      basename: path.basename(selectedPath)
    };
    const key = `${normalized.type}:${normalized.path}`.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    paths.push(normalized);
  }
  return paths;
}

function flattenedInputValues(value) {
  if (Array.isArray(value)) {
    return value.flatMap((item) => flattenedInputValues(item));
  }
  return [value];
}

function normalizeWordCloudCorpusPath(value) {
  if (!value) {
    return null;
  }
  if (typeof value === "object") {
    const selectedPath = String(value.path || "").trim();
    if (!selectedPath) {
      return null;
    }
    const type = String(value.type || "").trim();
    return {
      type: type === "file" || type === "directory" ? type : "",
      path: selectedPath
    };
  }
  const raw = String(value || "").trim();
  if (!raw) {
    return null;
  }
  const [type, ...pathParts] = raw.split(":");
  const selectedPath = pathParts.join(":");
  return selectedPath && ["file", "directory"].includes(type)
    ? { type, path: selectedPath }
    : { path: raw };
}

function normalizeWordCloudCorpusPaths(input = {}) {
  const values = [
    ...flattenedInputValues(input.corpusPath),
    ...flattenedInputValues(input["corpus-path"]),
    ...flattenedInputValues(input.corpusPaths),
    ...flattenedInputValues(input["corpus-paths"])
  ].filter((value) => value !== undefined && value !== null && value !== "");
  const paths = [];
  const seen = new Set();
  for (const value of values) {
    const normalized = normalizeWordCloudCorpusPath(value);
    if (!normalized) {
      continue;
    }
    const key = `${normalized.type || ""}:${normalized.path}`.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    paths.push(normalized);
  }
  return paths;
}

function normalizeWordCloudOperationInput(input = {}) {
  const normalized = input && typeof input === "object" ? { ...input } : {};
  const corpusPaths = normalizeWordCloudCorpusPaths(normalized);
  if (corpusPaths.length > 0) {
    normalized.corpusPaths = corpusPaths;
  }
  return normalized;
}

function requireMetadataStore(context = {}) {
  const metadataStore = context.metadataStore;
  if (!metadataStore) {
    return { error: result(503, { ok: false, error: "元数据存储不可用。" }) };
  }
  return { metadataStore };
}

async function loadWordCloudRules(context = {}) {
  if (typeof context.loadEmailRules === "function") {
    return context.loadEmailRules(context.userDataPath);
  }
  return {};
}

function appendConsoleOperationLog(context = {}, entry = {}) {
  if (typeof context.appendConsoleOperationLog === "function") {
    context.appendConsoleOperationLog(entry);
  }
}

export async function executeKnowledgeWordCloudOperation({ operationId, input = {}, context = {} } = {}) {
  const id = String(operationId || "");
  const handledOperations = new Set([
    "knowledge.word_clouds.get",
    "knowledge.word_clouds.save",
    "knowledge.word_clouds.export",
    "knowledge.word_clouds.import",
    "knowledge.word_bags.terms",
    "knowledge.word_bags.add",
    "knowledge.word_bags.update",
    "knowledge.word_bags.delete"
  ]);
  if (!handledOperations.has(id)) {
    return null;
  }

  const { metadataStore, error } = requireMetadataStore(context);
  if (error) {
    return error;
  }
  input = normalizeWordCloudOperationInput(input);

  if (id === "knowledge.word_clouds.get") {
    return result(200, await metadataStore.getKnowledgeWordCloudState({
      ...input,
      rules: await loadWordCloudRules(context)
    }));
  }

  if (id === "knowledge.word_bags.terms") {
    try {
      return result(200, await metadataStore.getKnowledgeWordBagTerms(input));
    } catch (operationError) {
      return mutationErrorResult(operationError);
    }
  }

  if (id === "knowledge.word_clouds.save") {
    const saved = await metadataStore.saveKnowledgeWordCloudSet({
      ...input,
      rules: await loadWordCloudRules(context)
    });
    const rawAuditAction = String(input.auditAction || "").trim();
    const auditAction = ["add", "remove", "clear", "save"].includes(rawAuditAction)
      ? rawAuditAction
      : rawAuditAction
        ? "save"
        : "";
    const auditPaths = normalizeAuditCorpusPaths(input.auditPaths || []);
    if (auditAction) {
      const corpusPaths = normalizeAuditCorpusPaths(saved.wordBagSet?.corpusPaths || []);
      appendConsoleOperationLog(context, {
        operationId: "knowledge.word_clouds.corpus_paths." + auditAction,
        event: "knowledge.word_clouds.corpus_paths.changed",
        authSession: context.authSession,
        status: "ok",
        risk: "content_write",
        input: {
          action: auditAction,
          wordBagSetId: saved.wordBagSet?.wordBagSetId || input.wordBagSet?.wordBagSetId || "",
          title: saved.wordBagSet?.title || input.wordBagSet?.title || "",
          changedPathCount: auditPaths.length,
          changedPaths: auditPaths,
          corpusPathCount: corpusPaths.length,
          corpusPathTypes: [...new Set(corpusPaths.map((item) => item.type || "unknown"))]
        },
        output: {
          ok: true,
          wordBagSetId: saved.wordBagSet?.wordBagSetId || "",
          corpusPathCount: corpusPaths.length
        }
      });
    }
    await publishProtocolEvent(
      context.protocolEventBus,
      "knowledge.word_clouds",
      saved,
      { type: "knowledge.word_clouds.updated" }
    );
    return result(200, saved);
  }

  if (id === "knowledge.word_clouds.export") {
    try {
      return result(200, await metadataStore.exportKnowledgeWordCloudSet(input));
    } catch (operationError) {
      return mutationErrorResult(operationError);
    }
  }

  if (id === "knowledge.word_clouds.import") {
    try {
      const imported = await metadataStore.importKnowledgeWordCloudSet(input);
      await publishProtocolEvent(
        context.protocolEventBus,
        "knowledge.word_clouds",
        imported,
        { type: "knowledge.word_clouds.imported" }
      );
      return result(201, imported);
    } catch (operationError) {
      return mutationErrorResult(operationError);
    }
  }

  if (id === "knowledge.word_bags.add") {
    try {
      const added = await metadataStore.addKnowledgeWordBag(input);
      await publishProtocolEvent(
        context.protocolEventBus,
        "knowledge.word_clouds",
        added,
        { type: "knowledge.word_clouds.word_bag.added" }
      );
      return result(201, added);
    } catch (operationError) {
      return mutationErrorResult(operationError);
    }
  }

  if (id === "knowledge.word_bags.update") {
    try {
      const updated = await metadataStore.updateKnowledgeWordBag(input);
      await publishProtocolEvent(
        context.protocolEventBus,
        "knowledge.word_clouds",
        updated,
        { type: "knowledge.word_clouds.word_bag.updated" }
      );
      return result(200, updated);
    } catch (operationError) {
      return mutationErrorResult(operationError);
    }
  }

  if (id === "knowledge.word_bags.delete") {
    try {
      const deleted = await metadataStore.deleteKnowledgeWordBag(input);
      await publishProtocolEvent(
        context.protocolEventBus,
        "knowledge.word_clouds",
        deleted,
        { type: "knowledge.word_clouds.word_bag.deleted" }
      );
      return result(200, deleted);
    } catch (operationError) {
      return mutationErrorResult(operationError);
    }
  }

  return null;
}
