import crypto from "node:crypto";
import {
  buildKnowledgeDocxExport
} from "../storage/knowledge-core/knowledge-docx-export.mjs";
import {
  buildKnowledgeMarkdownExport
} from "../storage/knowledge-core/knowledge-markdown-export.mjs";
import {
  buildKnowledgeHtmlExport
} from "../storage/knowledge-core/knowledge-html-export.mjs";
import { evaluateKnowledgeAccess } from "../agent-library/access-policy.mjs";

export const KNOWLEDGE_TRANSFORMATION_PROTOCOL_VERSION = "pact.knowledge-transformation.v1";

function nowIso() {
  return new Date().toISOString();
}

function text(value) {
  return String(value ?? "").trim();
}

function asObject(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === "") return [];
  return [value];
}

function stableJson(value) {
  if (value === undefined || value === null) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

function stableId(prefix, value) {
  return `${prefix}_${crypto.createHash("sha256").update(stableJson(value)).digest("hex").slice(0, 24)}`;
}

function normalizeFormat(input = {}, fallback = "markdown") {
  const raw = text(input.outputFormat || input.targetFormat || input.format || fallback).toLowerCase();
  if (raw === "md") return "markdown";
  if (raw === "htm") return "html";
  if (["markdown", "html", "json", "docx", "text"].includes(raw)) return raw;
  return fallback;
}

function normalizeBlock(value = {}, index = 0) {
  const block = asObject(value);
  const body = text(block.text || block.content || block.markdown || block.snippet || value);
  return {
    blockId: text(block.blockId || block.id) || `block_${index + 1}`,
    sectionId: text(block.sectionId || "main"),
    type: text(block.type || "text"),
    text: body,
    snippet: text(block.snippet || body.slice(0, 500)),
    position: Number(block.position || index + 1),
    metadata: asObject(block.metadata)
  };
}

function documentFromInput(value = {}, index = 0) {
  const item = asObject(value);
  const body = text(item.text || item.content || item.markdown || item.body || item.snippet || value);
  const title = text(item.title || item.name || item.fileName || item.sourcePath || `Raw document ${index + 1}`);
  const documentId = text(item.documentId || item.id) || stableId("raw_doc", { title, body, index });
  const blocks = asArray(item.blocks).length
    ? asArray(item.blocks).map(normalizeBlock)
    : [normalizeBlock({ text: body }, 0)];
  return {
    documentId,
    title,
    documentType: text(item.documentType || item.type || "raw-corpus"),
    mediaType: text(item.mediaType || "text/plain"),
    sourceId: text(item.sourceId || ""),
    sourcePath: text(item.sourcePath || item.path || ""),
    batchId: text(item.batchId || ""),
    metadata: asObject(item.metadata),
    sections: [{
      sectionId: "main",
      title,
      level: 1,
      position: 1,
      summary: text(item.summary || "")
    }],
    blocks,
    assets: asArray(item.assets)
  };
}

function documentsFromInput(input = {}) {
  const explicit = [
    ...asArray(input.documents),
    ...asArray(input.items),
    ...asArray(input.rawCorpus?.documents),
    ...asArray(input.rawCorpusDocuments)
  ];
  if (explicit.length) {
    return explicit.map(documentFromInput);
  }
  const body = text(input.text || input.content || input.markdown || input.body || "");
  if (body) {
    return [documentFromInput({
      title: input.title || input.name || "Raw corpus",
      text: body,
      sourcePath: input.sourcePath || ""
    })];
  }
  return [];
}

function evidenceItemToDocument(item = {}, index = 0) {
  const evidence = asObject(item);
  const title = text(evidence.title || evidence.documentTitle || evidence.evidenceId || `Evidence ${index + 1}`);
  const body = [
    evidence.summary,
    evidence.snippet,
    evidence.markdown,
    evidence.text,
    ...asArray(evidence.blocks).map((block) => text(block.text || block.snippet))
  ].map(text).filter(Boolean).join("\n\n");
  return documentFromInput({
    documentId: text(evidence.documentId || evidence.evidenceId || ""),
    title,
    text: body || title,
    sourceId: evidence.sourceId || "",
    sourcePath: evidence.sourcePath || evidence.sourceLocator?.sourcePath || "",
    metadata: {
      evidenceId: evidence.evidenceId || "",
      sourceLocator: evidence.sourceLocator || null,
      citation: evidence.citation || null
    }
  }, index);
}

async function documentsFromKnowledgeSearch({ knowledgeCore, input = {}, limit = 12 }) {
  if (!knowledgeCore || typeof knowledgeCore.search !== "function" || !text(input.query || input.q || input.topic)) {
    return [];
  }
  const search = await knowledgeCore.search({
    query: input.query || input.q || input.topic,
    limit,
    batchId: input.batchId || "",
    sourceIds: input.sourceIds || [],
    modalityPolicy: "multimodal"
  });
  return asArray(search.items || search.results).map(evidenceItemToDocument);
}

async function evidenceDocuments({ knowledgeCore, input = {} }) {
  const evidenceIds = asArray(input.evidenceIds || input.evidenceRefs || input.evidenceId).map(text).filter(Boolean);
  const documents = [];
  if (knowledgeCore && typeof knowledgeCore.getEvidence === "function") {
    for (const [index, evidenceId] of evidenceIds.entries()) {
      const evidence = await knowledgeCore.getEvidence({ evidenceId });
      if (evidence) documents.push(evidenceItemToDocument(evidence, index));
    }
  }
  return documents;
}

function dossierMarkdown({ title, query, documents = [], generatedAt = nowIso() }) {
  const lines = [
    `# ${title}`,
    "",
    `> generatedAt: ${generatedAt}`,
    query ? `> query: ${query}` : "",
    `> documentCount: ${documents.length}`,
    ""
  ].filter(Boolean);
  for (const [index, doc] of documents.entries()) {
    lines.push(`## ${index + 1}. ${doc.title || doc.documentId}`, "");
    if (doc.sourcePath) lines.push(`- sourcePath: ${doc.sourcePath}`);
    if (doc.sourceId) lines.push(`- sourceId: ${doc.sourceId}`);
    lines.push("");
    for (const block of asArray(doc.blocks)) {
      const body = text(block.text || block.snippet);
      if (body) lines.push(body, "");
    }
  }
  return lines.join("\n");
}

function distillationDocuments(input = {}, run = null) {
  const source = run || asObject(input.run || input.distillation || input);
  const docs = [];
  for (const [index, doc] of asArray(source.portableDocuments || input.portableDocuments).entries()) {
    docs.push(documentFromInput({
      documentId: doc.candidateId || doc.document?.documentId || "",
      title: doc.title || doc.document?.title || `Distillation document ${index + 1}`,
      text: doc.document?.markdown || doc.document?.content || doc.document?.summary || stableJson(doc.document || doc)
    }, index));
  }
  for (const [index, candidate] of asArray(source.candidates || input.candidates).entries()) {
    const portable = candidate.portableDocument || candidate.proposal?.distilledOutputs?.portableDocument || {};
    docs.push(documentFromInput({
      documentId: candidate.candidateId || "",
      title: portable.title || candidate.proposal?.title || candidate.skill?.title || `Distillation candidate ${index + 1}`,
      text: portable.markdown || portable.content || candidate.proposal?.summary || stableJson(candidate.distilledOutputs || candidate.proposal || candidate)
    }, docs.length));
  }
  if (docs.length) return docs;
  return documentsFromInput(input);
}

async function renderDocuments({ documents, format, title, generatedAt = nowIso(), filters = {} }) {
  if (format === "docx") {
    return buildKnowledgeDocxExport({ documents, generatedAt, filters, includeMachineReadable: true });
  }
  if (format === "html") {
    return buildKnowledgeHtmlExport({ documents, generatedAt, filters });
  }
  if (format === "json") {
    const buffer = Buffer.from(JSON.stringify({
      protocolVersion: KNOWLEDGE_TRANSFORMATION_PROTOCOL_VERSION,
      title,
      generatedAt,
      filters,
      documents
    }, null, 2), "utf8");
    return {
      buffer,
      contentType: "application/json; charset=utf-8",
      fileName: `${stableId("knowledge-export", { title, generatedAt }).slice(0, 32)}.json`
    };
  }
  if (format === "text") {
    const buffer = Buffer.from(documents.flatMap((doc) =>
      [`# ${doc.title}`, ...asArray(doc.blocks).map((block) => text(block.text || block.snippet)), ""]
    ).join("\n"), "utf8");
    return {
      buffer,
      contentType: "text/plain; charset=utf-8",
      fileName: `${stableId("knowledge-export", { title, generatedAt }).slice(0, 32)}.txt`
    };
  }
  return buildKnowledgeMarkdownExport({ documents, generatedAt, filters });
}

function publicPackage({ operationId, format, rendered, documents, generatedAt, accessDecision }) {
  const textContent = /^text\/|json|html|markdown/.test(rendered.contentType || "")
    ? rendered.buffer.toString("utf8")
    : "";
  return {
    ok: true,
    schemaVersion: 1,
    protocolVersion: KNOWLEDGE_TRANSFORMATION_PROTOCOL_VERSION,
    operationId,
    outputFormat: format,
    contentType: rendered.contentType,
    fileName: rendered.fileName,
    byteSize: rendered.buffer.length,
    content: textContent || undefined,
    contentBase64: rendered.buffer.toString("base64"),
    manifest: rendered.manifest || {
      generatedAt,
      documentCount: documents.length
    },
    documentCount: documents.length,
    knowledgeAccessDecision: accessDecision
  };
}

function accessDecisionFor({ input = {}, documents = [], requestedEgress = "exportFile", subject = {} }) {
  const refs = documents.map((doc) => ({
    ref: doc.documentId,
    refType: "knowledgeDocument"
  })).filter((ref) => ref.ref);
  return evaluateKnowledgeAccess({
    libraryCardId: input.libraryCardId || stableId("knowledge_export_card", {
      subject,
      refs,
      requestedEgress
    }),
    subject,
    operatorId: input.operatorId || subject.subjectId || subject.username || "",
    agentProfile: input.agentProfile || {
      profileId: input.agentProfileId || subject.roleId || "knowledge-transformation"
    },
    workspaceId: input.workspaceId || input.workspace || "",
    taskId: input.taskId || input.jobId || input.runId || input.operationId || "knowledge-transformation-export",
    requestedAction: "export",
    requestedAccessMode: input.requestedAccessMode || "exportAllowed",
    requestedEgress,
    targetRefs: input.targetRefs || refs
  }, {
    ...asObject(input.authorizationPolicy || input.policy),
    view: {
      derivedViewRef: input.derivedViewRef || stableId("knowledge_export_view", refs),
      refs,
      allowedActions: ["discover", "read", "export", "checkout"],
      authorizationOverlay: {
        defaultAccessMode: "exportAllowed",
        ...asObject(input.authorizationOverlay)
      },
      ...asObject(input.view)
    }
  });
}

export function createKnowledgeTransformationProvider({
  knowledgeCore = null,
  metadataStore = null
} = {}) {
  async function convertRawCorpus(input = {}, context = {}) {
    let documents = documentsFromInput(input);
    if (!documents.length && typeof metadataStore?.listRawCorpusDocuments === "function") {
      documents = asArray(await metadataStore.listRawCorpusDocuments({
        batchId: input.batchId || "",
        query: input.query || input.q || "",
        limit: input.limit || 100
      })).map(documentFromInput);
    }
    const generatedAt = nowIso();
    const format = normalizeFormat(input, "markdown");
    const accessDecision = accessDecisionFor({
      input,
      documents,
      requestedEgress: "exportFile",
      subject: context.subject
    });
    if (!accessDecision.allowed) {
      return {
        ok: false,
        status: 403,
        protocolVersion: KNOWLEDGE_TRANSFORMATION_PROTOCOL_VERSION,
        operationId: "raw-corpus.format.convert",
        error: "AgentLibrary access denied for raw corpus export.",
        knowledgeAccessDecision: accessDecision
      };
    }
    const rendered = await renderDocuments({
      documents,
      format,
      title: input.title || "Raw corpus conversion",
      generatedAt,
      filters: { batchId: input.batchId || "", sourceId: input.sourceId || "" }
    });
    return publicPackage({
      operationId: "raw-corpus.format.convert",
      format,
      rendered,
      documents,
      generatedAt,
      accessDecision
    });
  }

  async function exportDossier(input = {}, context = {}) {
    const limit = Math.max(1, Math.min(Number(input.limit || 12), 100));
    const evidenceDocs = await evidenceDocuments({ knowledgeCore, input });
    const searchDocs = evidenceDocs.length ? [] : await documentsFromKnowledgeSearch({ knowledgeCore, input, limit });
    const requestDocs = documentsFromInput(input);
    const sourceDocuments = [...evidenceDocs, ...searchDocs, ...requestDocs];
    const query = text(input.query || input.q || input.topic || "");
    const title = text(input.title || input.dossierTitle || query || "Unified dossier");
    const dossierDoc = documentFromInput({
      documentId: stableId("dossier", { title, query, sourceDocuments: sourceDocuments.map((doc) => doc.documentId) }),
      title,
      text: dossierMarkdown({ title, query, documents: sourceDocuments })
    });
    const documents = [dossierDoc];
    const generatedAt = nowIso();
    const format = normalizeFormat(input, "markdown");
    const accessDecision = accessDecisionFor({
      input,
      documents: sourceDocuments.length ? sourceDocuments : documents,
      requestedEgress: "exportFile",
      subject: context.subject
    });
    if (!accessDecision.allowed) {
      return {
        ok: false,
        status: 403,
        protocolVersion: KNOWLEDGE_TRANSFORMATION_PROTOCOL_VERSION,
        operationId: "knowledge.dossier.export",
        error: "AgentLibrary access denied for dossier export.",
        knowledgeAccessDecision: accessDecision
      };
    }
    const rendered = await renderDocuments({
      documents,
      format,
      title,
      generatedAt,
      filters: { query, evidenceCount: sourceDocuments.length }
    });
    return {
      ...publicPackage({
        operationId: "knowledge.dossier.export",
        format,
        rendered,
        documents,
        generatedAt,
        accessDecision
      }),
      sourceDocumentCount: sourceDocuments.length
    };
  }

  async function exportDistillation(input = {}, context = {}) {
    const runId = text(input.runId || input.id || "");
    const documents = distillationDocuments(input, null);
    const generatedAt = nowIso();
    const format = normalizeFormat(input, "markdown");
    const accessDecision = accessDecisionFor({
      input,
      documents,
      requestedEgress: "distillationOutput",
      subject: context.subject
    });
    if (!accessDecision.allowed) {
      return {
        ok: false,
        status: 403,
        protocolVersion: KNOWLEDGE_TRANSFORMATION_PROTOCOL_VERSION,
        operationId: "knowledge.distillation.export",
        error: "AgentLibrary access denied for distillation export.",
        knowledgeAccessDecision: accessDecision
      };
    }
    const rendered = await renderDocuments({
      documents,
      format,
      title: input.title || "Knowledge distillation export",
      generatedAt,
      filters: { runId }
    });
    return {
      ...publicPackage({
        operationId: "knowledge.distillation.export",
        format,
        rendered,
        documents,
        generatedAt,
        accessDecision
      }),
      runId,
      runStatus: ""
    };
  }

  return {
    protocolVersion: KNOWLEDGE_TRANSFORMATION_PROTOCOL_VERSION,
    convertRawCorpus,
    exportDossier,
    exportDistillation
  };
}
