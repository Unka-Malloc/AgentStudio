import { createHash } from "node:crypto";

const DEFAULT_MIN_DOCUMENT_BLOCKS = 8;
const DEFAULT_MAX_TREE_NODES = 80;

function normalizeText(value = "") {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function truncateText(value = "", maxLength = 420) {
  const text = normalizeText(value);
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}

function hashText(value, length = 24) {
  return createHash("sha256").update(String(value || "")).digest("hex").slice(0, length);
}

function stableId(prefix, ...parts) {
  return `${prefix}::${hashText(parts.map((part) => String(part || "")).join("\u001f"), 24)}`;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function blockText(block = {}) {
  return normalizeText([block.title, block.snippet, block.text].filter(Boolean).join("\n"));
}

function sourceRangeForBlocks(blocks = []) {
  const positions = blocks.map((block) => Number(block.position || 0)).filter((item) => item > 0);
  const locators = blocks.map((block) => block.sourceLocator || block.source_locator || {}).filter(Boolean);
  const pages = [];
  for (const locator of locators) {
    for (const value of [
      locator.page,
      locator.pageNumber,
      locator.pageIndex,
      locator.slideIndex
    ]) {
      const page = Number(value);
      if (Number.isFinite(page) && page > 0) {
        pages.push(page);
      }
    }
  }
  return {
    blockStart: positions.length ? Math.min(...positions) : 0,
    blockEnd: positions.length ? Math.max(...positions) : 0,
    pageStart: pages.length ? Math.min(...pages) : 0,
    pageEnd: pages.length ? Math.max(...pages) : 0
  };
}

function rangeContainsPosition(range = {}, position = 0) {
  const start = Number(range.blockStart || 0);
  const end = Number(range.blockEnd || 0);
  const current = Number(position || 0);
  return start > 0 && end > 0 && current >= start && current <= end;
}

function meaningfulTitle(value = "", documentTitle = "") {
  const title = normalizeText(value)
    .replace(/^#+\s*/, "")
    .replace(/^\d+(?:\.\d+)*[.)、]?\s*/, "")
    .trim();
  if (!title || title.length < 2 || title.length > 120) {
    return "";
  }
  const normalized = title.toLowerCase();
  if (["body", "正文", "来源正文", "source", "text", "block"].includes(normalized)) {
    return "";
  }
  if (documentTitle && normalized === normalizeText(documentTitle).toLowerCase()) {
    return "";
  }
  return title;
}

function headingCandidateFromBlock(block = {}, documentTitle = "") {
  const title = meaningfulTitle(block.title, documentTitle);
  if (title) {
    return {
      title,
      level: Math.max(1, Math.min(Number(block.metadata?.headingLevel || block.level || 1), 6)),
      origin: "block-title"
    };
  }
  const lines = String(block.text || block.snippet || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 8);
  for (const line of lines) {
    const markdown = line.match(/^(#{1,6})\s+(.{2,120})$/);
    if (markdown) {
      return {
        title: meaningfulTitle(markdown[2], documentTitle),
        level: markdown[1].length,
        origin: "markdown-heading"
      };
    }
    const numbered = line.match(/^((?:\d+\.)+\d*|[一二三四五六七八九十]+[、.])\s*(.{2,100})$/u);
    if (numbered) {
      const depth = String(numbered[1]).split(".").filter(Boolean).length || 1;
      return {
        title: meaningfulTitle(numbered[2], documentTitle),
        level: Math.max(1, Math.min(depth, 6)),
        origin: "numbered-heading"
      };
    }
  }
  return null;
}

function directChildren(stack = [], level = 1) {
  while (stack.length && stack[stack.length - 1].level >= level) {
    stack.pop();
  }
  return stack[stack.length - 1] || null;
}

function buildSectionNodes({ document = {}, sections = [], blocks = [] }) {
  const sortedSections = [...sections].sort((left, right) =>
    Number(left.position || 0) - Number(right.position || 0)
  );
  const stack = [];
  return sortedSections.map((section, index) => {
    const level = Math.max(1, Math.min(Number(section.level || 1), 12));
    const parent = directChildren(stack, level);
    const sectionBlocks = blocks.filter((block) => (block.sectionId || block.section_id || "") === section.sectionId);
    const sourceRange = sourceRangeForBlocks(sectionBlocks);
    const text = sectionBlocks.map(blockText).join("\n");
    const node = {
      nodeType: "section",
      targetId: section.sectionId,
      parentNodeType: parent ? "section" : "document",
      parentTargetId: parent ? parent.targetId : document.documentId,
      level: 1 + level,
      documentId: document.documentId,
      sectionId: section.sectionId,
      title: section.title || document.title || "正文",
      summary: section.metadata?.summary || document.title || "",
      text,
      categoryPath: [document.documentType, document.title, section.title],
      metadata: {
        ...(section.metadata || {}),
        outlineOrigin: "source-section",
        sourceRange,
        quality: {
          synthetic: false,
          reliable: true,
          reason: "source_section"
        },
        textDigest: hashText(text, 32),
        position: Number(section.position || index + 1)
      }
    };
    stack.push({
      level,
      targetId: section.sectionId
    });
    return node;
  });
}

function buildHeadingOutlineNodes({ document = {}, sections = [], blocks = [], maxTreeNodes = DEFAULT_MAX_TREE_NODES }) {
  const sortedBlocks = [...blocks].sort((left, right) =>
    Number(left.position || 0) - Number(right.position || 0)
  );
  const candidates = [];
  for (const [index, block] of sortedBlocks.entries()) {
    const heading = headingCandidateFromBlock(block, document.title || "");
    if (!heading?.title) {
      continue;
    }
    candidates.push({
      ...heading,
      block,
      blockIndex: index
    });
  }
  if (candidates.length < 2) {
    return [];
  }
  const stack = [];
  return candidates.slice(0, maxTreeNodes).map((candidate, index) => {
    const next = candidates[index + 1];
    const nodeBlocks = sortedBlocks.slice(candidate.blockIndex, next ? next.blockIndex : sortedBlocks.length);
    const sourceRange = sourceRangeForBlocks(nodeBlocks);
    const sectionId = candidate.block.sectionId || sections[0]?.sectionId || "";
    const outlineId = stableId("outline", document.documentId, candidate.block.blockId, candidate.title);
    const parent = directChildren(stack, candidate.level);
    const text = nodeBlocks.map(blockText).join("\n");
    const node = {
      nodeType: "outline",
      targetId: outlineId,
      parentNodeType: parent ? "outline" : "document",
      parentTargetId: parent ? parent.targetId : document.documentId,
      level: 1 + Math.max(1, candidate.level),
      documentId: document.documentId,
      sectionId,
      title: candidate.title,
      summary: truncateText(text, 520),
      text,
      categoryPath: [document.documentType, document.title, candidate.title],
      metadata: {
        outlineOrigin: candidate.origin,
        sourceRange,
        quality: {
          synthetic: true,
          reliable: candidate.origin !== "block-title" || candidates.length >= 3,
          reason: candidate.origin
        },
        textDigest: hashText(text, 32),
        sourceSectionId: sectionId
      }
    };
    stack.push({
      level: candidate.level,
      targetId: outlineId
    });
    return node;
  });
}

function buildWindowOutlineNodes({ document = {}, sections = [], blocks = [], maxTreeNodes = DEFAULT_MAX_TREE_NODES }) {
  const sortedBlocks = [...blocks].sort((left, right) =>
    Number(left.position || 0) - Number(right.position || 0)
  );
  if (sortedBlocks.length < 2) {
    return [];
  }
  const targetWindows = Math.min(maxTreeNodes, Math.max(2, Math.ceil(sortedBlocks.length / 4)));
  const windowSize = Math.max(2, Math.ceil(sortedBlocks.length / targetWindows));
  const nodes = [];
  for (let index = 0; index < sortedBlocks.length && nodes.length < maxTreeNodes; index += windowSize) {
    const nodeBlocks = sortedBlocks.slice(index, index + windowSize);
    const text = nodeBlocks.map(blockText).join("\n");
    const sourceRange = sourceRangeForBlocks(nodeBlocks);
    const firstTitle = meaningfulTitle(nodeBlocks[0]?.title || "", document.title || "");
    const outlineId = stableId("outline", document.documentId, "window", index, sourceRange.blockStart, sourceRange.blockEnd);
    const sectionId = nodeBlocks[0]?.sectionId || sections[0]?.sectionId || "";
    nodes.push({
      nodeType: "outline",
      targetId: outlineId,
      parentNodeType: "document",
      parentTargetId: document.documentId,
      level: 2,
      documentId: document.documentId,
      sectionId,
      title: firstTitle || `自然片段 ${nodes.length + 1}`,
      summary: truncateText(text, 520),
      text,
      categoryPath: [document.documentType, document.title, firstTitle || `自然片段 ${nodes.length + 1}`],
      metadata: {
        outlineOrigin: "synthetic-block-window",
        sourceRange,
        quality: {
          synthetic: true,
          reliable: false,
          reason: "coarse_or_missing_sections"
        },
        textDigest: hashText(text, 32),
        sourceSectionId: sectionId
      }
    });
  }
  return nodes;
}

export function createDocumentOutlineRuntime({
  defaultMinDocumentBlocks = DEFAULT_MIN_DOCUMENT_BLOCKS,
  defaultMaxTreeNodes = DEFAULT_MAX_TREE_NODES
} = {}) {
  function build({ document = {}, sections = [], blocks = [], assets = [], settings = {} } = {}) {
    const minDocumentBlocks = Math.max(
      2,
      Number(settings.outlineMinDocumentBlocks || defaultMinDocumentBlocks)
    );
    const maxTreeNodes = Math.max(
      8,
      Math.min(Number(settings.outlineMaxTreeNodes || defaultMaxTreeNodes), 300)
    );
    const sectionNodes = buildSectionNodes({ document, sections, blocks });
    const hasUsefulSections = sectionNodes.length >= 2;
    const longOrCoarse = blocks.length >= minDocumentBlocks && !hasUsefulSections;
    const syntheticNodes = longOrCoarse
      ? (
          buildHeadingOutlineNodes({ document, sections, blocks, maxTreeNodes }) ||
          []
        )
      : [];
    const fallbackSyntheticNodes = longOrCoarse && syntheticNodes.length < 2
      ? buildWindowOutlineNodes({ document, sections, blocks, maxTreeNodes })
      : [];
    const outlineNodes = [
      ...sectionNodes,
      ...(syntheticNodes.length >= 2 ? syntheticNodes : fallbackSyntheticNodes)
    ].slice(0, maxTreeNodes);
    const qualityFindings = [];
    if (!sections.length) {
      qualityFindings.push({
        code: "missing_source_sections",
        severity: "medium",
        message: "Document has no source sections; outline uses synthetic ranges."
      });
    }
    if (longOrCoarse) {
      qualityFindings.push({
        code: "coarse_source_structure",
        severity: "medium",
        message: "Document source sections are too coarse for long-document retrieval."
      });
    }
    if (fallbackSyntheticNodes.length > 0) {
      qualityFindings.push({
        code: "synthetic_window_outline",
        severity: "low",
        message: "No stable headings found; outline falls back to block windows."
      });
    }
    return {
      protocolVersion: "v0.0.1:knowledge:document-outline-1",
      documentId: document.documentId || "",
      nodeCount: outlineNodes.length,
      syntheticNodeCount: outlineNodes.filter((node) => node.nodeType === "outline").length,
      nodes: outlineNodes,
      qualityFindings,
      sourceStats: {
        sectionCount: sections.length,
        blockCount: blocks.length,
        assetCount: assets.length
      }
    };
  }

  return {
    protocolVersion: "v0.0.1:knowledge:document-outline-1",
    build,
    rangeContainsPosition
  };
}

export default createDocumentOutlineRuntime;
