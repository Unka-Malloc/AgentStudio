import { createHash } from "node:crypto";
import { estimateMarkdownTokenCount } from "./chunking/structured-markdown.mjs";

export const DYNAMIC_PARAMETER_DOCUMENT_PARSING_POLICY_ID = "dynamic-parameter-document-parsing-policy";
export const DYNAMIC_PARAMETER_DOCUMENT_PARSING_PIPELINE_ID = "dynamic-parameter-v1";

const DEFAULT_CONTEXT_KNOWLEDGE_TOKENS = 4096;
const DEFAULT_TARGET_TOKENS = 512;
const DEFAULT_MAX_RESPONSE_BYTES = 256 * 1024;
const DEFAULT_MAX_EVIDENCE_BYTES = 64 * 1024;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function scalar(value) {
  return String(value ?? "").trim();
}

function normalizeText(value) {
  return String(value || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}

function shallowObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function clampNumber(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, numeric));
}

function sha256(value) {
  return createHash("sha256").update(String(value || "")).digest("hex");
}

function shortHash(value, length = 14) {
  return sha256(value).slice(0, length);
}

function stableId(...parts) {
  return parts
    .map((part) => scalar(part).replace(/[^A-Za-z0-9._:-]+/g, "-").replace(/^-+|-+$/g, ""))
    .filter(Boolean)
    .join("::");
}

function tokenCount(value) {
  return estimateMarkdownTokenCount(String(value || ""));
}

function byteLength(value) {
  return Buffer.byteLength(String(value || ""), "utf8");
}

function sourceRangeForBlock(block = {}) {
  const metadataRange = shallowObject(block.metadata?.sourceRange || block.sourceRange);
  const startLine = Number(block.sourceStartLine || metadataRange.startLine || 1);
  const endLine = Number(block.sourceEndLine || metadataRange.endLine || startLine);
  return {
    startLine: Math.max(1, startLine),
    endLine: Math.max(1, endLine)
  };
}

function sourceById(sources = []) {
  return new Map(asArray(sources).map((source) => [scalar(source.id), source]));
}

function normalizeArtifactType(kind = "") {
  const value = scalar(kind).toLowerCase();
  if (value.includes("table")) return "table";
  if (value.includes("code")) return "code";
  if (value.includes("list")) return "list";
  if (value.includes("heading")) return "heading";
  if (value.includes("image")) return "asset";
  return "paragraph";
}

function splitSentences(text = "") {
  const normalized = normalizeText(text);
  if (!normalized) {
    return [];
  }
  const pieces = normalized
    .split(/(?<=[。！？!?；;。.!?])\s+|\n{2,}/u)
    .map((item) => item.trim())
    .filter(Boolean);
  if (pieces.length > 1) {
    return pieces;
  }
  return normalized.match(/[^。！？!?；;.!?]+[。！？!?；;.!?]?/gu)?.map((item) => item.trim()).filter(Boolean) || [normalized];
}

function tableLines(text = "") {
  return normalizeText(text).split("\n").map((line) => line.trim()).filter(Boolean);
}

function splitCells(line = "") {
  const trimmed = String(line || "").trim();
  if (trimmed.includes("|")) {
    return trimmed
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((cell) => cell.trim());
  }
  if (trimmed.includes("\t")) {
    return trimmed.split("\t").map((cell) => cell.trim());
  }
  return trimmed.split(",").map((cell) => cell.trim());
}

function looksLikeMarkdownSeparator(line = "") {
  return /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(String(line || "").trim());
}

function tableMetadata(text = "") {
  const lines = tableLines(text);
  if (!lines.length) {
    return {
      headers: [],
      headerLineCount: 0,
      rows: [],
      columnCount: 0
    };
  }
  const hasMarkdownHeader = lines.length > 1 && looksLikeMarkdownSeparator(lines[1]);
  const headerLineCount = hasMarkdownHeader ? 2 : 1;
  const headers = splitCells(lines[0]);
  const rows = lines.slice(headerLineCount).map(splitCells);
  const columnCount = Math.max(headers.length, ...rows.map((row) => row.length), 0);
  return {
    headers,
    headerLineCount,
    rows,
    columnCount
  };
}

function sourceForArtifact(sourceMap, block = {}) {
  return sourceMap.get(scalar(block.sourceId)) || {};
}

function stableJson(value) {
  if (value === undefined || value === null) {
    return "null";
  }
  if (typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

function sourceMetadataHash(source = {}) {
  const metadata = shallowObject(source.sourceMetadata || source.rawObject?.sourceMetadata);
  return Object.keys(metadata).length > 0 ? `sha256:${sha256(stableJson(metadata))}` : "";
}

function sourceLocator(source = {}, block = {}) {
  const blockMetadata = shallowObject(block.metadata);
  const metadata = shallowObject(source.sourceMetadata || source.rawObject?.sourceMetadata);
  return {
    page: Number(blockMetadata.page || metadata.page || metadata.pageNumber || metadata.pageIndex || 0) || 0,
    slideIndex: Number(blockMetadata.slideIndex || metadata.slideIndex || 0) || 0,
    sheetName: scalar(blockMetadata.sheetName || metadata.sheetName),
    bbox: blockMetadata.bbox || metadata.bbox || metadata.boundingBox || []
  };
}

function parserTraceRef(source = {}) {
  const documentMetadata = shallowObject(source.documentMetadata);
  return {
    parserId: scalar(source.documentParserId),
    parserVersion: scalar(
      source.documentParserVersion ||
      documentMetadata.parserVersion ||
      documentMetadata?.parser?.version ||
      documentMetadata?.runtime?.version
    ),
    modelId: scalar(documentMetadata.modelId || documentMetadata?.model?.id || documentMetadata?.runtime?.modelId),
    modelVersion: scalar(
      documentMetadata.modelVersion || documentMetadata?.model?.version || documentMetadata?.runtime?.modelVersion
    )
  };
}

export function createStructureArtifacts({ sources = [], blocks = [] } = {}) {
  const map = sourceById(sources);
  return asArray(blocks)
    .map((block, index) => {
      const text = normalizeText(block.text);
      if (!text) {
        return null;
      }
      const source = sourceForArtifact(map, block);
      const artifactType = normalizeArtifactType(block.kind || block.blockType);
      const sourceRange = sourceRangeForBlock(block);
      const table = artifactType === "table" ? tableMetadata(text) : null;
      const artifactId = stableId(
        "artifact",
        block.sourceId || source.id || "source",
        block.id || block.blockId || `block-${index + 1}`,
        shortHash(text, 10)
      );
      return {
        artifactId,
        id: artifactId,
        policyId: DYNAMIC_PARAMETER_DOCUMENT_PARSING_POLICY_ID,
        sourceId: scalar(block.sourceId || source.id),
        sourceName: scalar(block.sourceName || source.name || source.path),
        blockId: scalar(block.id || block.blockId),
        artifactType,
        text,
        tokenCount: tokenCount(text),
        charCount: text.length,
        byteLength: byteLength(text),
        order: index + 1,
        headingPath: asArray(block.headingPath || block.titlePath || block.metadata?.headingPath).map(scalar).filter(Boolean),
        titlePath: asArray(block.titlePath || block.headingPath || block.metadata?.headingPath).map(scalar).filter(Boolean),
        sourceRange,
        pageRange: shallowObject(block.metadata?.pageRange || block.sourceLocator?.pageRange),
        tableHeaders: table?.headers || [],
        rowRange: table ? { startRow: 1, endRow: table.rows.length } : {},
        columnRange: table ? { startColumn: 1, endColumn: table.columnCount } : {},
        textDigest: `sha256:${sha256(text)}`,
        assetRefs: asArray(block.assetRefs || block.metadata?.assetRefs || block.assets).map(scalar).filter(Boolean),
        parentArtifactId: scalar(block.parentArtifactId || block.metadata?.parentArtifactId),
        childrenArtifactIds: asArray(block.childrenArtifactIds || block.metadata?.childrenArtifactIds).map(scalar).filter(Boolean),
        metadata: {
          ...shallowObject(block.metadata),
          sourceRange,
          blockKind: scalar(block.kind || block.blockType),
          sourceMediaType: scalar(source.mediaType),
          rawObjectId: scalar(source.rawObject?.objectId),
          contentHash: scalar(source.contentHash || source.rawObject?.contentHash || source.originalSha256),
          sourceMetadataHash: sourceMetadataHash(source),
          sourceLocator: sourceLocator(source, block),
          parserTraceRef: parserTraceRef(source)
        }
      };
    })
    .filter(Boolean);
}

function normalizeContextBudget(input = {}) {
  return {
    knowledgeTokens: Math.round(clampNumber(input.knowledgeTokens, DEFAULT_CONTEXT_KNOWLEDGE_TOKENS, 80, 256000)),
    budgetScope: scalar(input.budgetScope || "knowledge-recall-only")
  };
}

function normalizePayloadBudget(input = {}) {
  return {
    maxResponseBytes: Math.round(clampNumber(input.maxResponseBytes, DEFAULT_MAX_RESPONSE_BYTES, 4096, 128 * 1024 * 1024)),
    maxEvidenceBytes: Math.round(clampNumber(input.maxEvidenceBytes, DEFAULT_MAX_EVIDENCE_BYTES, 2048, 64 * 1024 * 1024))
  };
}

function normalizeGranularity(input = {}, chunking = {}) {
  const secondaryParse = shallowObject(input.secondaryParse);
  const targetTokens = Math.round(clampNumber(
    secondaryParse.targetTokens ?? input.targetTokens ?? chunking.maxTokens,
    DEFAULT_TARGET_TOKENS,
    40,
    64000
  ));
  const targetChars = Math.round(clampNumber(
    secondaryParse.targetChars ?? input.targetChars ?? chunking.maxChars,
    Math.max(320, targetTokens * 4),
    160,
    1024 * 1024
  ));
  return {
    preferOriginalStructure: input.preferOriginalStructure !== false,
    allowPartialEvidence: input.allowPartialEvidence !== false,
    targetTokens,
    targetChars,
    tableGranularity: scalar(input.tableGranularity || "row-window"),
    secondaryParse: {
      enabled: secondaryParse.enabled === true,
      algorithm: scalar(secondaryParse.algorithm || input.algorithm || "auto"),
      targetTokens,
      targetChars
    }
  };
}

function buildFragment(artifact, index, text, granularity, fragmentRange, trace) {
  const normalizedText = normalizeText(text);
  return {
    fragmentId: stableId("fragment", artifact.artifactId, index + 1, shortHash(normalizedText, 8)),
    policyId: DYNAMIC_PARAMETER_DOCUMENT_PARSING_POLICY_ID,
    parentArtifactId: artifact.artifactId,
    sourceId: artifact.sourceId,
    sourceName: artifact.sourceName,
    blockId: artifact.blockId,
    artifactType: artifact.artifactType,
    granularity,
    fragmentRange,
    text: normalizedText,
    tokenCount: tokenCount(normalizedText),
    charCount: normalizedText.length,
    byteLength: byteLength(normalizedText),
    order: index + 1,
    headingPath: artifact.headingPath,
    titlePath: artifact.titlePath,
    sourceRange: artifact.sourceRange,
    completeOriginalAvailable: true,
    fragmentationTrace: {
      policy: DYNAMIC_PARAMETER_DOCUMENT_PARSING_POLICY_ID,
      ...trace
    }
  };
}

function windowUnits(units, { maxTokens, maxChars }) {
  const windows = [];
  let current = [];
  let currentText = "";
  for (const unit of units) {
    const proposal = currentText ? `${currentText}\n${unit.text}` : unit.text;
    if (current.length && (tokenCount(proposal) > maxTokens || proposal.length > maxChars)) {
      windows.push(current);
      current = [];
      currentText = "";
    }
    current.push(unit);
    currentText = current.map((item) => item.text).join("\n");
  }
  if (current.length) {
    windows.push(current);
  }
  return windows;
}

export function parseParagraphSentenceV1({ artifact, granularity }) {
  const units = splitSentences(artifact.text).map((text, index) => ({
    text,
    start: index + 1,
    end: index + 1
  }));
  const windows = windowUnits(units, {
    maxTokens: granularity.targetTokens,
    maxChars: granularity.targetChars
  });
  return windows.map((items, index) => buildFragment(
    artifact,
    index,
    items.map((item) => item.text).join("\n"),
    "paragraph-sentence",
    {
      sentenceStart: items[0]?.start || 1,
      sentenceEnd: items[items.length - 1]?.end || items.length
    },
    { algorithm: "paragraph-sentence-v1" }
  ));
}

export function parseTableRowWindowV1({ artifact, granularity }) {
  const lines = tableLines(artifact.text);
  const table = tableMetadata(artifact.text);
  const headerLines = lines.slice(0, table.headerLineCount || 1);
  const rowLines = lines.slice(table.headerLineCount || 1);
  const units = rowLines.map((line, index) => ({
    text: line,
    start: index + 1,
    end: index + 1
  }));
  const windows = windowUnits(units, {
    maxTokens: granularity.targetTokens,
    maxChars: granularity.targetChars
  });
  if (!windows.length) {
    return [buildFragment(artifact, 0, artifact.text, "table-row-window", { rowStart: 1, rowEnd: 0, headerRows: table.headerLineCount }, { algorithm: "table-row-window-v1" })];
  }
  return windows.map((items, index) => buildFragment(
    artifact,
    index,
    [...headerLines, ...items.map((item) => item.text)].join("\n"),
    "table-row-window",
    {
      rowStart: items[0]?.start || 1,
      rowEnd: items[items.length - 1]?.end || items.length,
      headerRows: table.headerLineCount,
      headers: table.headers
    },
    { algorithm: "table-row-window-v1" }
  ));
}

export function parseTableCellWindowV1({ artifact, granularity }) {
  const table = tableMetadata(artifact.text);
  const headers = table.headers;
  const cells = [];
  for (const [rowIndex, row] of table.rows.entries()) {
    for (const [columnIndex, cell] of row.entries()) {
      const header = headers[columnIndex] || `Column ${columnIndex + 1}`;
      cells.push({
        text: `row ${rowIndex + 1} / ${header}: ${cell}`,
        row: rowIndex + 1,
        column: columnIndex + 1
      });
    }
  }
  const windows = windowUnits(cells.map((cell) => ({ ...cell, start: cell.row, end: cell.row })), {
    maxTokens: granularity.targetTokens,
    maxChars: granularity.targetChars
  });
  return windows.map((items, index) => buildFragment(
    artifact,
    index,
    items.map((item) => item.text).join("\n"),
    "table-cell-window",
    {
      rowStart: Math.min(...items.map((item) => item.row)),
      rowEnd: Math.max(...items.map((item) => item.row)),
      columnStart: Math.min(...items.map((item) => item.column)),
      columnEnd: Math.max(...items.map((item) => item.column)),
      headers
    },
    { algorithm: "table-cell-window-v1" }
  ));
}

export function parseCodeLineWindowV1({ artifact, granularity }) {
  const lines = normalizeText(artifact.text).split("\n");
  const units = lines.map((line, index) => ({
    text: line,
    start: index + 1,
    end: index + 1
  }));
  const windows = windowUnits(units, {
    maxTokens: granularity.targetTokens,
    maxChars: granularity.targetChars
  });
  return windows.map((items, index) => buildFragment(
    artifact,
    index,
    items.map((item) => item.text).join("\n"),
    "code-line-window",
    {
      lineStart: items[0]?.start || 1,
      lineEnd: items[items.length - 1]?.end || items.length
    },
    { algorithm: "code-line-window-v1" }
  ));
}

export function parseListItemWindowV1({ artifact, granularity }) {
  const lines = normalizeText(artifact.text).split("\n").filter((line) => line.trim());
  const units = lines.map((line, index) => ({
    text: line,
    start: index + 1,
    end: index + 1
  }));
  const windows = windowUnits(units, {
    maxTokens: granularity.targetTokens,
    maxChars: granularity.targetChars
  });
  return windows.map((items, index) => buildFragment(
    artifact,
    index,
    items.map((item) => item.text).join("\n"),
    "list-item-window",
    {
      itemStart: items[0]?.start || 1,
      itemEnd: items[items.length - 1]?.end || items.length
    },
    { algorithm: "list-item-window-v1" }
  ));
}

export function parseTokenWindowFallbackV1({ artifact, granularity }) {
  const maxChars = Math.max(80, granularity.targetChars);
  const pieces = [];
  const text = normalizeText(artifact.text);
  for (let offset = 0; offset < text.length; offset += maxChars) {
    pieces.push({
      text: text.slice(offset, offset + maxChars),
      start: offset,
      end: Math.min(text.length, offset + maxChars)
    });
  }
  return pieces.map((piece, index) => buildFragment(
    artifact,
    index,
    piece.text,
    "token-window",
    {
      charStart: piece.start,
      charEnd: piece.end
    },
    { algorithm: "token-window-fallback-v1" }
  ));
}

function algorithmFor({ algorithmId = "", artifactType = "", granularity = {} } = {}) {
  const requested = scalar(algorithmId);
  if (requested && requested !== "auto") {
    return requested;
  }
  if (artifactType === "table" && granularity.tableGranularity === "cell-window") {
    return "table-cell-window-v1";
  }
  if (artifactType === "table") return "table-row-window-v1";
  if (artifactType === "code") return "code-line-window-v1";
  if (artifactType === "list") return "list-item-window-v1";
  if (artifactType === "paragraph") return "paragraph-sentence-v1";
  return "token-window-fallback-v1";
}

export function dispatchDynamicDocumentParsingAlgorithm(input = {}) {
  const artifact = input.artifact || {};
  const artifactType = normalizeArtifactType(input.artifactType || artifact.artifactType);
  const granularity = normalizeGranularity(input.granularity || {}, input.chunking || {});
  const algorithmId = algorithmFor({
    algorithmId: input.algorithmId || granularity.secondaryParse.algorithm,
    artifactType,
    granularity
  });
  const startedAt = Date.now();
  let fragments;
  if (algorithmId === "paragraph-sentence-v1") {
    fragments = parseParagraphSentenceV1({ artifact, granularity });
  } else if (algorithmId === "table-row-window-v1") {
    fragments = parseTableRowWindowV1({ artifact, granularity });
  } else if (algorithmId === "table-cell-window-v1") {
    fragments = parseTableCellWindowV1({ artifact, granularity });
  } else if (algorithmId === "code-line-window-v1") {
    fragments = parseCodeLineWindowV1({ artifact, granularity });
  } else if (algorithmId === "list-item-window-v1") {
    fragments = parseListItemWindowV1({ artifact, granularity });
  } else if (algorithmId === "token-window-fallback-v1") {
    fragments = parseTokenWindowFallbackV1({ artifact, granularity });
  } else {
    throw new Error(`未知动态文档解析算法：${algorithmId}`);
  }
  return {
    algorithmId,
    artifactType,
    granularity,
    fragments,
    backendTrace: {
      policy: DYNAMIC_PARAMETER_DOCUMENT_PARSING_POLICY_ID,
      algorithm: algorithmId,
      artifactId: artifact.artifactId,
      targetTokens: granularity.targetTokens,
      targetChars: granularity.targetChars,
      generatedFragmentCount: fragments.length,
      elapsedMs: Date.now() - startedAt,
      materialization: granularity.secondaryParse.enabled ? "on-demand-secondary-parse" : "precomputed"
    }
  };
}

function originalStructureFragment(artifact, index = 0) {
  return buildFragment(
    artifact,
    index,
    artifact.text,
    "original-structure",
    {
      sourceRange: artifact.sourceRange
    },
    {
      algorithm: "original-structure-v1",
      materialization: "complete-original"
    }
  );
}

function materializationMode(artifact, contextBudget, payloadBudget, granularity) {
  if (
    granularity.preferOriginalStructure &&
    artifact.tokenCount <= contextBudget.knowledgeTokens &&
    artifact.byteLength <= payloadBudget.maxEvidenceBytes
  ) {
    return "structure";
  }
  return "fragment";
}

function chunkFromFragment(fragment, index) {
  const titlePath = asArray(fragment.titlePath || fragment.headingPath).map(scalar).filter(Boolean);
  return {
    id: stableId(fragment.parentArtifactId, "chunk", fragment.order || index + 1),
    sourceId: fragment.sourceId,
    sourceName: fragment.sourceName,
    titlePath,
    headingPath: titlePath,
    blockIds: [fragment.blockId].filter(Boolean),
    sectionId: "",
    chunkType: fragment.artifactType || "dynamic",
    content: fragment.text,
    text: fragment.text,
    tokenCount: fragment.tokenCount,
    charCount: fragment.charCount,
    title: titlePath[titlePath.length - 1] || `${fragment.artifactType || "结构"} ${index + 1}`,
    sourceRange: fragment.sourceRange,
    sourceStartLine: fragment.sourceRange?.startLine || 1,
    sourceEndLine: fragment.sourceRange?.endLine || 1,
    overlapTokenCount: 0,
    splitReason: fragment.fragmentationTrace?.algorithm || "",
    metadata: {
      policy: DYNAMIC_PARAMETER_DOCUMENT_PARSING_POLICY_ID,
      parentArtifactId: fragment.parentArtifactId,
      granularity: fragment.granularity,
      fragmentRange: fragment.fragmentRange,
      fragmentationTrace: fragment.fragmentationTrace,
      completeOriginalAvailable: fragment.completeOriginalAvailable,
      materialization: {
        mode: fragment.granularity === "original-structure" ? "structure" : "fragment",
        parentArtifactId: fragment.parentArtifactId,
        granularity: fragment.granularity,
        completeOriginalAvailable: true
      },
      sourceRange: fragment.sourceRange
    }
  };
}

function applyPayloadBudget(fragments, payloadBudget) {
  const accepted = [];
  let returnedBytes = 0;
  for (const fragment of fragments) {
    const fragmentBytes = Math.max(0, Number(fragment.byteLength || byteLength(fragment.text)));
    const projectedBytes = returnedBytes + fragmentBytes;
    if (accepted.length && projectedBytes > payloadBudget.maxResponseBytes) {
      break;
    }
    accepted.push(fragment);
    returnedBytes = projectedBytes;
  }
  const truncated = accepted.length < fragments.length || returnedBytes > payloadBudget.maxResponseBytes;
  return {
    fragments: accepted,
    payload: {
      truncated,
      returnedBytes,
      totalFragmentCount: fragments.length,
      returnedFragmentCount: accepted.length,
      maxResponseBytes: payloadBudget.maxResponseBytes,
      maxEvidenceBytes: payloadBudget.maxEvidenceBytes,
      nextContinuationToken: truncated ? `continuation:${shortHash(`${accepted.length}:${fragments.length}:${returnedBytes}`)}` : "",
      returnedRanges: accepted.map((fragment) => ({
        parentArtifactId: fragment.parentArtifactId,
        fragmentRange: fragment.fragmentRange,
        order: fragment.order
      }))
    }
  };
}

export function bindDynamicDocumentParsingInvocation(request = {}, runtimeState = {}) {
  const documentParsing = shallowObject(request.documentParsing);
  const requestDynamicParsing = shallowObject(request.dynamicParsing || documentParsing.dynamicParsing);
  const chunking = shallowObject(request.chunking || documentParsing.chunking);
  const interfaceGranularity = shallowObject(request.granularity || documentParsing.granularity);
  const runtimeGranularity = shallowObject(runtimeState.granularity);
  const interfaceSecondaryParse = shallowObject(interfaceGranularity.secondaryParse);
  const runtimeSecondaryParse = shallowObject(runtimeGranularity.secondaryParse);
  const contextBudget = normalizeContextBudget(request.contextBudget || documentParsing.contextBudget || runtimeState.contextBudget);
  const payloadBudget = normalizePayloadBudget(request.payloadBudget || documentParsing.payloadBudget || runtimeState.payloadBudget);
  const granularity = normalizeGranularity(
    {
      tableGranularity: requestDynamicParsing.tableGranularity,
      ...runtimeGranularity,
      ...interfaceGranularity,
      secondaryParse: {
        ...runtimeSecondaryParse,
        ...interfaceSecondaryParse,
        enabled: interfaceSecondaryParse.enabled === true
      }
    },
    chunking
  );
  const policyDefaults = shallowObject(runtimeState.policyDefaults || runtimeState.dynamicParsing || requestDynamicParsing);
  const algorithmRegistry = shallowObject(runtimeState.algorithmRegistry || policyDefaults.algorithmRegistry);
  const structureArtifacts = asArray(request.structureArtifacts).length
    ? asArray(request.structureArtifacts)
    : createStructureArtifacts({ sources: request.sources, blocks: request.blocks });
  const fragments = [];
  const traces = [];
  const secondaryParseRequested = granularity.secondaryParse.enabled === true;
  for (const [artifactIndex, artifact] of structureArtifacts.entries()) {
    if (artifact.artifactType === "heading" || artifact.artifactType === "asset") {
      continue;
    }
    const mode = materializationMode(artifact, contextBudget, payloadBudget, granularity);
    if (!secondaryParseRequested) {
      fragments.push(originalStructureFragment(artifact, artifactIndex));
      traces.push({
        policy: DYNAMIC_PARAMETER_DOCUMENT_PARSING_POLICY_ID,
        algorithm: "original-structure-v1",
        artifactId: artifact.artifactId,
        materialization: mode === "structure" ? "complete-original" : "complete-original-budget-exceeded",
        budgetFit: mode === "structure",
        generatedFragmentCount: 1,
        elapsedMs: 0
      });
      continue;
    }
    const dispatched = dispatchDynamicDocumentParsingAlgorithm({
      artifact,
      artifactType: artifact.artifactType,
      algorithmId: algorithmRegistry[artifact.artifactType] || granularity.secondaryParse.algorithm,
      granularity,
      contextBudget,
      payloadBudget,
      chunking
    });
    fragments.push(...dispatched.fragments);
    traces.push(dispatched.backendTrace);
  }
  const payloadState = applyPayloadBudget(fragments, payloadBudget);
  const returnedFragments = payloadState.fragments;
  return {
    policy: {
      policyId: DYNAMIC_PARAMETER_DOCUMENT_PARSING_POLICY_ID,
      pipelineId: DYNAMIC_PARAMETER_DOCUMENT_PARSING_PIPELINE_ID,
      contextBudget,
      payloadBudget,
      granularity,
      defaults: policyDefaults
    },
    structureArtifacts,
    granularityFragments: returnedFragments,
    chunks: returnedFragments.map(chunkFromFragment),
    payload: payloadState.payload,
    backendTrace: {
      policy: DYNAMIC_PARAMETER_DOCUMENT_PARSING_POLICY_ID,
      algorithms: traces,
      secondaryParse: secondaryParseRequested
        ? {
            enabled: true,
            algorithm: granularity.secondaryParse.algorithm,
            targetTokens: granularity.secondaryParse.targetTokens,
            generatedFragmentCount: returnedFragments.length,
            elapsedMs: traces.reduce((sum, trace) => sum + Number(trace.elapsedMs || 0), 0),
            materialization: "on-demand-secondary-parse"
          }
        : {
            enabled: false,
            generatedFragmentCount: returnedFragments.length,
            materialization: "complete-original"
          }
    }
  };
}

export function materializeDynamicEvidenceBlocks({ source = {}, blocks = [], contextBudget = {}, payloadBudget = {}, granularity = {} } = {}) {
  const binding = bindDynamicDocumentParsingInvocation({
    sources: [source],
    blocks,
    contextBudget,
    payloadBudget,
    granularity,
    documentParsing: {
      granularity
    }
  });
  return {
    ...binding,
    blocks: binding.granularityFragments.map((fragment) => ({
      blockId: fragment.blockId,
      artifactId: fragment.parentArtifactId,
      blockType: fragment.artifactType,
      title: asArray(fragment.titlePath || fragment.headingPath).filter(Boolean).slice(-1)[0] || fragment.granularity,
      text: fragment.text,
      snippet: fragment.text.slice(0, 500),
      sourceLocator: {
        sourceId: fragment.sourceId,
        sourceRange: fragment.sourceRange
      },
      metadata: {
        materialization: {
          mode: fragment.granularity === "original-structure" ? "structure" : "fragment",
          parentArtifactId: fragment.parentArtifactId,
          granularity: fragment.granularity,
          completeOriginalAvailable: true
        },
        fragmentRange: fragment.fragmentRange,
        fragmentationTrace: fragment.fragmentationTrace
      }
    }))
  };
}
