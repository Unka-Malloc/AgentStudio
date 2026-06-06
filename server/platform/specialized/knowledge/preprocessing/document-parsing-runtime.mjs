import { createKnowledgePipeline } from "./chunking/pipeline.mjs";
import { createRuleBasedParserAdapter } from "./chunking/rule-parser.mjs";
import { createRuleBasedChunkerAdapter } from "./chunking/rule-chunker.mjs";
import { estimateMarkdownTokenCount } from "./chunking/structured-markdown.mjs";
import { createPreprocessResult } from "./preprocess-result.mjs";
import { readInputSources } from "./file-processor/index.mjs";
import {
  bindDynamicDocumentParsingInvocation,
  DYNAMIC_PARAMETER_DOCUMENT_PARSING_PIPELINE_ID
} from "./dynamic-parameter-document-parsing.mjs";

const DEFAULT_PIPELINE_ID = "knowledge-rule-v1";
const UNIFIED_KNOWLEDGE_INGEST_PIPELINE_ID = "unified-knowledge-ingest-v1";
const DYNAMIC_ARTIFACT_PIPELINE_IDS = new Set([
  DYNAMIC_PARAMETER_DOCUMENT_PARSING_PIPELINE_ID,
  UNIFIED_KNOWLEDGE_INGEST_PIPELINE_ID
]);
const SOURCE_OUTPUTS = new Set(["source", "sources", "raw", "raw-sources"]);
const BLOCK_OUTPUTS = new Set(["block", "blocks"]);
const CHUNK_OUTPUTS = new Set(["chunk", "chunks", "chunked"]);
const PREPROCESS_OUTPUTS = new Set(["preprocess", "preprocess-result", "preprocessResult", "all"]);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function shallowObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeText(value) {
  return String(value || "").replace(/\r\n/g, "\n").trim();
}

function clampNumber(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, numeric));
}

function normalizeChunkingOptions(input = {}) {
  const maxTokens = Math.round(clampNumber(input.maxTokens ?? input.targetTokens, 800, 80, 16000));
  const maxChars = Math.round(clampNumber(input.maxChars, Math.max(480, maxTokens * 4), 320, 256000));
  const overlapTokens = Math.round(clampNumber(input.overlapTokens ?? input.overlap, 0, 0, Math.max(0, maxTokens - 1)));
  const sectionLevel = Math.round(clampNumber(input.sectionLevel ?? input.headingLevel, 2, 1, 6));
  return {
    maxTokens,
    maxChars,
    overlapTokens,
    sectionLevel
  };
}

function normalizeExpectedOutputs(input) {
  const values = asArray(input).length ? asArray(input) : [input || "sources"];
  const outputs = new Set();
  for (const value of values) {
    const normalized = String(value || "").trim();
    if (!normalized) {
      continue;
    }
    if (SOURCE_OUTPUTS.has(normalized)) outputs.add("sources");
    if (BLOCK_OUTPUTS.has(normalized)) outputs.add("blocks");
    if (CHUNK_OUTPUTS.has(normalized)) outputs.add("chunks");
    if (PREPROCESS_OUTPUTS.has(normalized)) {
      outputs.add("sources");
      outputs.add("blocks");
      outputs.add("chunks");
      outputs.add("preprocessResult");
    }
  }
  if (outputs.size === 0) {
    outputs.add("sources");
  }
  if (outputs.has("blocks") || outputs.has("chunks") || outputs.has("preprocessResult")) {
    outputs.add("sources");
  }
  return outputs;
}

function normalizeSourceInput(source = {}, index = 0, generatedAt = new Date().toISOString()) {
  const name = String(source.name || source.path || `source-${index + 1}.txt`);
  return {
    id: String(source.id || `source-${index + 1}`),
    name,
    path: String(source.path || name),
    kind: String(source.kind || "text"),
    sourceCreatedAt: String(source.sourceCreatedAt || generatedAt),
    sourceUpdatedAt: String(source.sourceUpdatedAt || generatedAt),
    sourceCollectedAt: String(source.sourceCollectedAt || generatedAt),
    text: normalizeText(source.text || source.content || ""),
    mediaType: String(source.mediaType || "text/plain"),
    documentParserId: String(source.documentParserId || source.parserId || ""),
    providerId: String(source.providerId || source.rawObject?.providerId || ""),
    externalId: String(source.externalId || source.rawObject?.externalId || ""),
    syncBatchId: String(source.syncBatchId || source.rawObject?.syncBatchId || ""),
    contentHash: String(source.contentHash || source.rawObject?.contentHash || source.originalSha256 || ""),
    capturedAt: String(source.capturedAt || source.rawObject?.capturedAt || ""),
    originalSha256: String(source.originalSha256 || source.rawObject?.sha256 || ""),
    originalRelativePath: String(source.originalRelativePath || source.rawObject?.originalRelativePath || ""),
    documentMetadata:
      source.documentMetadata && typeof source.documentMetadata === "object" && !Array.isArray(source.documentMetadata)
        ? source.documentMetadata
        : {},
    sourceMetadata:
      source.sourceMetadata && typeof source.sourceMetadata === "object" && !Array.isArray(source.sourceMetadata)
        ? source.sourceMetadata
        : {},
    parserTrace: asArray(source.parserTrace).filter((entry) => entry && typeof entry === "object"),
    rawObject:
      source.rawObject && typeof source.rawObject === "object" && !Array.isArray(source.rawObject)
        ? source.rawObject
        : {},
    embeddedDocuments: asArray(source.embeddedDocuments),
    visualElements: asArray(source.visualElements),
    warnings: asArray(source.warnings).map((entry) => String(entry || "").trim()).filter(Boolean)
  };
}

function publicRawObject(rawObject = {}) {
  return {
    objectId: rawObject.objectId || "",
    uri: rawObject.uri || rawObject.path || rawObject.filePath || "",
    contentHash: rawObject.contentHash || rawObject.sha256 || "",
    mediaType: rawObject.mediaType || rawObject.mimeType || "",
    byteSize: Number(rawObject.byteSize || rawObject.size || 0) || 0,
    originalFileName: rawObject.originalFileName || "",
    originalRelativePath: rawObject.originalRelativePath || "",
    storageRelativePath: rawObject.storageRelativePath || ""
  };
}

function titleFromText(text, fallback) {
  const heading = String(text || "").match(/^#{1,6}\s+(.+)$/m)?.[1]?.trim();
  if (heading) {
    return heading.slice(0, 64);
  }
  const first = String(text || "").split("\n").find((line) => line.trim()) || fallback;
  return first.replace(/^[-*]\s+/, "").trim().slice(0, 64) || fallback;
}

function buildChunk(source, index, text, extra = {}) {
  const content = normalizeText(text);
  const sourceStartLine = Number(extra.sourceStartLine || index);
  const sourceEndLine = Number(extra.sourceEndLine || sourceStartLine + Math.max(1, content.split("\n").length) - 1);
  const titlePath = asArray(extra.titlePath).map((entry) => String(entry || "").trim()).filter(Boolean);
  return {
    id: `${source.id}::chunk-${index}`,
    sourceId: source.id,
    sourceName: source.name,
    sourceCreatedAt: source.sourceCreatedAt || "",
    sourceUpdatedAt: source.sourceUpdatedAt || "",
    sourceCollectedAt: source.sourceCollectedAt || "",
    titlePath,
    headingPath: titlePath,
    blockIds: asArray(extra.blockIds),
    chunkType: extra.chunkType || "section",
    content,
    text: content,
    tokenCount: estimateMarkdownTokenCount(content),
    charCount: content.length,
    title: String(extra.title || titlePath[titlePath.length - 1] || titleFromText(content, `切片 ${index}`)),
    sourceStartLine,
    sourceEndLine,
    sourceRange: {
      startLine: sourceStartLine,
      endLine: sourceEndLine
    },
    overlapTokenCount: Number(extra.overlapTokenCount || 0),
    splitReason: String(extra.splitReason || "")
  };
}

function splitTextForLimit(text, options) {
  const maxChars = Math.max(160, Number(options.maxChars || 3200));
  const maxTokens = Math.max(80, Number(options.maxTokens || 800));
  const segments = String(text || "")
    .split(/(?<=[。！？.!?；;])\s+|\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
  const source = segments.length ? segments : String(text || "").match(new RegExp(`.{1,${maxChars}}`, "gs")) || [];
  const output = [];
  let current = "";
  for (const segment of source) {
    const proposal = current ? `${current}\n\n${segment}` : segment;
    if ((proposal.length > maxChars || estimateMarkdownTokenCount(proposal) > maxTokens) && current) {
      output.push(current);
      current = segment;
      continue;
    }
    if (segment.length > maxChars && !current) {
      output.push(...(segment.match(new RegExp(`.{1,${maxChars}}`, "gs")) || [segment]));
      current = "";
      continue;
    }
    current = proposal;
  }
  if (current) {
    output.push(current);
  }
  return output;
}

function overlapTail(text, overlapTokens) {
  if (!overlapTokens || overlapTokens <= 0) {
    return "";
  }
  const lines = String(text || "").split("\n").filter((line) => line.trim());
  const output = [];
  let total = 0;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    const tokens = estimateMarkdownTokenCount(line);
    if (output.length && total + tokens > overlapTokens) {
      break;
    }
    output.unshift(line);
    total += tokens;
    if (total >= overlapTokens) {
      break;
    }
  }
  return output.join("\n");
}

function createFixedWindowChunkerAdapter(options = {}) {
  const chunkOptions = normalizeChunkingOptions(options);
  return {
    name: "fixed-window-chunker",
    async chunk(source) {
      const chunks = [];
      let carry = "";
      let lineCursor = 1;
      for (const part of splitTextForLimit(source.text || "", chunkOptions)) {
        const text = carry ? `${carry}\n\n${part}` : part;
        const chunk = buildChunk(source, chunks.length + 1, text, {
          chunkType: "fixed-window",
          titlePath: ["固定窗口"],
          sourceStartLine: lineCursor,
          overlapTokenCount: carry ? estimateMarkdownTokenCount(carry) : 0,
          splitReason: chunks.length ? "fixed-window" : ""
        });
        chunks.push(chunk);
        lineCursor = chunk.sourceEndLine + 1;
        carry = overlapTail(text, chunkOptions.overlapTokens);
      }
      return chunks;
    }
  };
}

function createSemanticParagraphChunkerAdapter(options = {}) {
  const chunkOptions = normalizeChunkingOptions(options);
  return {
    name: "semantic-paragraph-chunker",
    async chunk(source, blocks = []) {
      const chunks = [];
      const semanticBlocks = asArray(blocks).filter((block) => normalizeText(block.text));
      const units = semanticBlocks.length
        ? semanticBlocks.map((block) => ({
            text: normalizeText(block.text),
            kind: block.kind || "paragraph",
            id: block.id || "",
            titlePath: asArray(block.titlePath || block.headingPath || block.metadata?.headingPath)
          }))
        : splitTextForLimit(source.text || "", chunkOptions).map((text) => ({
            text,
            kind: "paragraph",
            id: "",
            titlePath: []
          }));

      let current = [];
      let currentText = "";
      let lineCursor = 1;

      function flush(reason = "") {
        if (!current.length) {
          return;
        }
        const text = current.map((item) => item.text).join("\n\n");
        const chunk = buildChunk(source, chunks.length + 1, text, {
          chunkType: current.every((item) => item.kind === "table") ? "table" : "semantic",
          titlePath: current.flatMap((item) => item.titlePath).filter(Boolean).slice(-4),
          blockIds: current.map((item) => item.id).filter(Boolean),
          sourceStartLine: lineCursor,
          splitReason: reason
        });
        chunks.push(chunk);
        lineCursor = chunk.sourceEndLine + 1;
        const carry = overlapTail(text, chunkOptions.overlapTokens);
        current = carry ? [{ text: carry, kind: "paragraph", id: "", titlePath: [] }] : [];
        currentText = carry;
      }

      for (const unit of units) {
        const proposal = currentText ? `${currentText}\n\n${unit.text}` : unit.text;
        if (
          current.length > 0 &&
          (proposal.length > chunkOptions.maxChars || estimateMarkdownTokenCount(proposal) > chunkOptions.maxTokens)
        ) {
          flush("semantic-boundary");
        }
        current.push(unit);
        currentText = current.map((item) => item.text).join("\n\n");
      }
      flush("");
      return chunks;
    }
  };
}

const BUILTIN_PIPELINES = [
  {
    id: "knowledge-rule-v1",
    label: "Knowledge rule parser",
    description: "Current production knowledge preprocessing chain: document parser route, rule parser, structured markdown aware chunker.",
    createPipeline({ chunking } = {}) {
      return createKnowledgePipeline({
        parser: createRuleBasedParserAdapter(),
        chunker: createRuleBasedChunkerAdapter(normalizeChunkingOptions(chunking))
      });
    }
  },
  {
    id: "semantic-paragraph-v1",
    label: "Semantic paragraph parser",
    description: "Backend paragraph/table aware chain for semantic chunk dry runs and jobs that opt into it.",
    createPipeline({ chunking } = {}) {
      return createKnowledgePipeline({
        parser: createRuleBasedParserAdapter(),
        chunker: createSemanticParagraphChunkerAdapter(chunking)
      });
    }
  },
  {
    id: "fixed-window-v1",
    label: "Fixed window parser",
    description: "Backend fixed-window chain for deterministic size-bounded chunk dry runs and jobs that opt into it.",
    createPipeline({ chunking } = {}) {
      return createKnowledgePipeline({
        parser: createRuleBasedParserAdapter(),
        chunker: createFixedWindowChunkerAdapter(chunking)
      });
    }
  },
  {
    id: DYNAMIC_PARAMETER_DOCUMENT_PARSING_PIPELINE_ID,
    label: "Dynamic parameter parser",
    description: "Budget-aware structure artifact and granularity fragment materialization for knowledge retrieval.",
    createPipeline({ chunking } = {}) {
      return createKnowledgePipeline({
        parser: createRuleBasedParserAdapter(),
        chunker: createRuleBasedChunkerAdapter(normalizeChunkingOptions(chunking))
      });
    }
  },
  {
    id: UNIFIED_KNOWLEDGE_INGEST_PIPELINE_ID,
    label: "Unified knowledge ingest parser",
    description: "Shared backend document parsing chain for knowledge import pages, returning preprocess result, chunks, structure artifacts, and budget-aware fragments.",
    createPipeline({ chunking } = {}) {
      return createKnowledgePipeline({
        parser: createRuleBasedParserAdapter(),
        chunker: createRuleBasedChunkerAdapter(normalizeChunkingOptions(chunking))
      });
    }
  }
];

function pipelineMapFrom(definitions) {
  return new Map(definitions.map((definition) => [definition.id, definition]));
}

function publicSource(source = {}) {
  return {
    id: source.id || "",
    name: source.name || "",
    path: source.path || "",
    kind: source.kind || "",
    sourceCreatedAt: source.sourceCreatedAt || "",
    sourceUpdatedAt: source.sourceUpdatedAt || "",
    sourceCollectedAt: source.sourceCollectedAt || "",
    text: source.text || "",
    mediaType: source.mediaType || "",
    providerId: source.providerId || "",
    externalId: source.externalId || "",
    syncBatchId: source.syncBatchId || "",
    contentHash: source.contentHash || source.rawObject?.contentHash || source.originalSha256 || "",
    capturedAt: source.capturedAt || source.rawObject?.capturedAt || "",
    originalSha256: source.originalSha256 || source.rawObject?.sha256 || "",
    originalRelativePath: source.originalRelativePath || source.rawObject?.originalRelativePath || "",
    documentParserId: source.documentParserId || "",
    documentMetadata: source.documentMetadata || {},
    sourceMetadata: source.sourceMetadata || {},
    parserTrace: asArray(source.parserTrace || source.documentMetadata?.parserTrace),
    rawObject: publicRawObject(source.rawObject || {}),
    embeddedDocuments: asArray(source.embeddedDocuments),
    visualElements: asArray(source.visualElements).map((element) => {
      const { imageDataUrl, dataUrl, ...rest } = element || {};
      return rest;
    }),
    warnings: asArray(source.warnings)
  };
}

export function toPublicDocumentParsingResult(result = {}) {
  return {
    schemaVersion: 1,
    generatedAt: result.generatedAt || "",
    pipelineId: result.pipelineId || DEFAULT_PIPELINE_ID,
    expectedOutputs: asArray(result.expectedOutputs),
    sources: asArray(result.sources).map(publicSource),
    blocks: asArray(result.blocks),
    chunks: asArray(result.chunks),
    structureArtifacts: asArray(result.structureArtifacts),
    granularityFragments: asArray(result.granularityFragments),
    preprocessResult: result.preprocessResult || null,
    dynamicParsing: result.dynamicParsing || null,
    payload: result.payload || null,
    backendTrace: result.backendTrace || null,
    failureReasons: asArray(result.failureReasons),
    warnings: asArray(result.warnings),
    summary: result.summary || {
      sources: asArray(result.sources).length,
      blocks: asArray(result.blocks).length,
      chunks: asArray(result.chunks).length,
      failureReasons: asArray(result.failureReasons).length,
      warnings: asArray(result.warnings).length
    },
    pipelines: asArray(result.pipelines)
  };
}

export function createDocumentParsingRuntime({ pipelines = BUILTIN_PIPELINES } = {}) {
  const definitions = pipelineMapFrom(pipelines);

  function resolvePipeline(pipelineId = DEFAULT_PIPELINE_ID) {
    const normalized = String(pipelineId || DEFAULT_PIPELINE_ID).trim() || DEFAULT_PIPELINE_ID;
    const definition = definitions.get(normalized);
    if (!definition) {
      throw new Error(`未知文档解析链路：${normalized}`);
    }
    return definition;
  }

  function listPipelines() {
    return pipelines.map((pipeline) => ({
      id: pipeline.id,
      label: pipeline.label,
      description: pipeline.description || ""
    }));
  }

  async function parseDocuments(input = {}) {
    const generatedAt = input.generatedAt || new Date().toISOString();
    const documentParsing = input.documentParsing && typeof input.documentParsing === "object"
      ? input.documentParsing
      : {};
    const dynamicParsing = shallowObject(input.dynamicParsing || documentParsing.dynamicParsing);
    const pipelineId = String(input.pipelineId || documentParsing.pipelineId || DEFAULT_PIPELINE_ID);
    const dynamicArtifactPipeline = DYNAMIC_ARTIFACT_PIPELINE_IDS.has(pipelineId);
    const expectedOutputs = normalizeExpectedOutputs(
      input.expectedOutputs || input.expectedOutput || documentParsing.expectedOutputs || documentParsing.expectedOutput
    );
    if (dynamicArtifactPipeline || dynamicParsing.enabled === true) {
      expectedOutputs.add("sources");
      expectedOutputs.add("blocks");
      expectedOutputs.add("chunks");
      expectedOutputs.add("preprocessResult");
    }
    const chunking = normalizeChunkingOptions({
      ...(documentParsing.chunking || {}),
      ...(input.chunking || {})
    });
    const warnings = [...asArray(input.warnings)];
    const pipelineDefinition = resolvePipeline(pipelineId);
    const providedSources = asArray(input.sources).map((source, index) =>
      normalizeSourceInput(source, index, generatedAt)
    );
    const sourceReadResult = providedSources.length
      ? {
          sources: providedSources,
          warnings: providedSources.flatMap((source) => asArray(source.warnings)),
          failureReasons: providedSources.flatMap((source) => asArray(source.failureReasons))
        }
      : await readInputSources({
          inputText: input.inputText || "",
          filePaths: asArray(input.filePaths),
          fileManifestPath: input.fileManifestPath || "",
          uploadedFiles: asArray(input.uploadedFiles),
          settings: input.settings || {},
          userDataPath: input.userDataPath,
          generatedAt,
          batchId: input.batchId || "",
          archiveBatchId: input.archiveBatchId || input.batchId || "",
          clientUid: input.clientUid || "",
          sourceType: input.sourceType || "",
          providerId: input.providerId || "",
          externalId: input.externalId || "",
          syncBatchId: input.syncBatchId || "",
          contentHash: input.contentHash || "",
          capturedAt: input.capturedAt || "",
          sourceMetadata: input.sourceMetadata || {},
          runtime: input.runtime || null,
          reportProgress: input.reportProgress || null
        });

    warnings.push(...asArray(sourceReadResult.warnings));
  const failureReasons = asArray(sourceReadResult.failureReasons);

    let preprocessResult = null;
    let blocks = [];
    let chunks = [];
    let structureArtifacts = [];
    let granularityFragments = [];
    let dynamicParsingPolicy = null;
    let payload = null;
    let backendTrace = null;
    if (expectedOutputs.has("blocks") || expectedOutputs.has("chunks") || expectedOutputs.has("preprocessResult")) {
      if (typeof input.reportProgress === "function") {
        input.reportProgress({
          progressPercent: 54,
          stage: "提取正文结构"
        });
      }
      const pipeline = pipelineDefinition.createPipeline({
        chunking,
        settings: input.settings || {},
        runtime: input.runtime || null
      });
      preprocessResult = await pipeline.run(sourceReadResult.sources, {
        generatedAt,
        warnings
      });
      blocks = asArray(preprocessResult.blocks);
      chunks = asArray(preprocessResult.chunks);

      const shouldApplyDynamicParsing =
        dynamicArtifactPipeline || dynamicParsing.enabled === true;
      if (shouldApplyDynamicParsing) {
        const bound = bindDynamicDocumentParsingInvocation({
          ...input,
          documentParsing,
          sources: sourceReadResult.sources,
          blocks,
          chunks,
          chunking,
          contextBudget: input.contextBudget || documentParsing.contextBudget,
          payloadBudget: input.payloadBudget || documentParsing.payloadBudget,
          granularity: input.granularity || documentParsing.granularity,
          dynamicParsing
        }, {
          policyDefaults: shallowObject(input.settings?.documentParsing?.dynamicParameterPolicy),
          algorithmRegistry: shallowObject(input.settings?.documentParsing?.dynamicParameterPolicy?.algorithmRegistry)
        });
        structureArtifacts = bound.structureArtifacts;
        granularityFragments = bound.granularityFragments;
        chunks = bound.chunks;
        dynamicParsingPolicy = bound.policy;
        payload = bound.payload;
        backendTrace = bound.backendTrace;
        preprocessResult = createPreprocessResult({
          generatedAt,
          sources: sourceReadResult.sources,
          blocks,
          chunks,
          structureArtifacts,
          granularityFragments,
          artifacts: asArray(preprocessResult.artifacts),
          warnings
        });
      }
    } else {
      preprocessResult = createPreprocessResult({
        generatedAt,
        sources: sourceReadResult.sources,
        blocks: [],
        chunks: [],
        warnings
      });
    }

    const result = {
      generatedAt,
      pipelineId,
      pipeline: pipelineDefinition,
      expectedOutputs: [...expectedOutputs],
      chunking,
      sources: sourceReadResult.sources,
      blocks,
      chunks,
      structureArtifacts,
      granularityFragments,
      preprocessResult,
      dynamicParsing: dynamicParsingPolicy,
      payload,
      backendTrace,
      failureReasons,
      warnings,
      summary: {
        sources: sourceReadResult.sources.length,
        blocks: blocks.length,
        chunks: chunks.length,
        structureArtifacts: structureArtifacts.length,
        granularityFragments: granularityFragments.length,
        failureReasons: failureReasons.length,
        warnings: warnings.length
      },
      pipelines: listPipelines()
    };
    return result;
  }

  return {
    defaultPipelineId: DEFAULT_PIPELINE_ID,
    listPipelines,
    parseDocuments
  };
}
