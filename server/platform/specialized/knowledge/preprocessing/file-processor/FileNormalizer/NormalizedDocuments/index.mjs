import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType
} from "docx";
import {
  getNormalizedDocumentsDirectory,
  getNormalizedManifestPath
} from "./store.mjs";
import { importFileDescriptorForPath } from "../../import-file-types.mjs";
import {
  buildMachineYamlDocument,
  renderHumanDocxBodyBlocks,
  summarizeMarkdownStructure
} from "../../../../document-export/docx-human-renderer.mjs";

const MAX_CHILD_DOCUMENTS_PER_SOURCE = 80;
const MAX_BODY_CHARS = 24000;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function truncateText(value, maxChars = MAX_BODY_CHARS) {
  const text = normalizeText(value);
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, Math.max(1, maxChars - 1)).trimEnd()}...`;
}

function scalar(value) {
  return String(value ?? "").trim();
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function parseDataUrl(dataUrl) {
  const match = /^data:([^;,]+)?;base64,(.+)$/is.exec(String(dataUrl || "").trim());
  if (!match) {
    return null;
  }
  try {
    return {
      mediaType: match[1] || "application/octet-stream",
      buffer: Buffer.from(match[2], "base64")
    };
  } catch {
    return null;
  }
}

function extensionForMediaType(mediaType = "") {
  const normalized = String(mediaType || "").toLowerCase();
  if (normalized === "image/jpeg" || normalized === "image/jpg") return ".jpg";
  if (normalized === "image/png") return ".png";
  if (normalized === "image/webp") return ".webp";
  if (normalized === "image/gif") return ".gif";
  if (normalized === "image/tiff") return ".tiff";
  return ".bin";
}

function stableHash(value, length = 10) {
  return createHash("sha1").update(String(value || "")).digest("hex").slice(0, length);
}

function slug(value, fallback = "item") {
  const normalized = String(value || "")
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return normalized || fallback;
}

function sourceExtension(source) {
  return path.extname(
    source?.originalRelativePath ||
      source?.name ||
      source?.path ||
      source?.documentMetadata?.resourceName ||
      ""
  ).toLowerCase();
}

function sourceDescriptor(source) {
  return importFileDescriptorForPath(
    source?.originalRelativePath ||
      source?.name ||
      source?.path ||
      source?.documentMetadata?.resourceName ||
      ""
  );
}

function sourceTitle(source) {
  return scalar(
    source?.documentMetadata?.["dc:title"] ||
      source?.documentMetadata?.title ||
      source?.originalFileName ||
      source?.name ||
      source?.path ||
      source?.id ||
      "未命名来源"
  );
}

function sourceKey(source, index) {
  return `${String(index + 1).padStart(3, "0")}-${slug(sourceTitle(source), `source-${index + 1}`)}-${stableHash(source?.id || sourceTitle(source), 6)}`;
}

function docId(prefix, source, suffix = "") {
  return `${prefix}-${stableHash([source?.id, sourceTitle(source), suffix].join("|"), 12)}`;
}

function paragraph(text, spacingAfter = 120) {
  return new Paragraph({
    spacing: { after: spacingAfter },
    children: [new TextRun(String(text || ""))]
  });
}

function heading(text, level = HeadingLevel.HEADING_1) {
  return new Paragraph({
    heading: level,
    spacing: { before: 180, after: 120 },
    children: [new TextRun(String(text || "未命名章节"))]
  });
}

function bodyParagraphs(text, maxChars = MAX_BODY_CHARS) {
  const normalized = truncateText(text, maxChars);
  if (!normalized) {
    return renderHumanDocxBodyBlocks("", { emptyText: "未提取到正文。" });
  }
  return renderHumanDocxBodyBlocks(normalized, { emptyText: "未提取到正文。" });
}

function metadataTable(metadata = {}) {
  const rows = Object.entries(metadata)
    .filter(([, value]) => value !== undefined && value !== null && scalar(value) !== "")
    .map(([key, value]) =>
      new TableRow({
        children: [
          new TableCell({ children: [paragraph(key, 80)] }),
          new TableCell({
            children: [paragraph(Array.isArray(value) ? value.join("; ") : String(value), 80)]
          })
        ]
      })
    );

  if (rows.length === 0) {
    rows.push(
      new TableRow({
        children: [
          new TableCell({ children: [paragraph("metadata", 80)] }),
          new TableCell({ children: [paragraph("未记录", 80)] })
        ]
      })
    );
  }

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows
  });
}

function warningParagraphs(warnings = []) {
  const items = asArray(warnings).map(scalar).filter(Boolean);
  if (items.length === 0) {
    return [];
  }
  return [
    heading("解析与召回风险", HeadingLevel.HEADING_2),
    ...items.map((item) => paragraph(`- ${item}`, 100))
  ];
}

function evidenceParagraphs(evidence = {}) {
  const entries = Object.entries(evidence)
    .filter(([, value]) => value !== undefined && value !== null && scalar(value) !== "");
  if (entries.length === 0) {
    return [];
  }
  return [
    heading("证据定位", HeadingLevel.HEADING_2),
    metadataTable(Object.fromEntries(entries))
  ];
}

async function buildDocxBuffer({
  title,
  sections,
  warnings
}) {
  const children = [
    heading(title)
  ];

  for (const section of asArray(sections)) {
    const sectionTitle = scalar(section.title);
    if (sectionTitle) {
      children.push(heading(sectionTitle, section.level || HeadingLevel.HEADING_3));
    }
    children.push(...bodyParagraphs(section.body || section.text || ""));
  }

  const humanWarnings = asArray(warnings).map(scalar).filter(Boolean);
  if (humanWarnings.length > 0) {
    children.push(
      heading("解析备注", HeadingLevel.HEADING_2),
      ...humanWarnings.map((item) => paragraph(item, 100))
    );
  }

  const document = new Document({
    sections: [{ children }]
  });
  return Packer.toBuffer(document);
}

function normalizeDocSpec(spec) {
  const sections = asArray(spec.sections).filter((section) =>
    normalizeText(section?.body || section?.text)
  );
  return {
    ...spec,
    title: scalar(spec.title) || "未命名知识文档",
    warnings: asArray(spec.warnings).map(scalar).filter(Boolean),
    sections: sections.length > 0 ? sections : [{ title: "正文", body: "未提取到正文。" }]
  };
}

function buildExportConsistencyBaseline(spec, source) {
  const normalizedSections = asArray(spec?.sections).map((section, index) => {
    const body = normalizeText(section?.body || section?.text || "");
    return {
      index: index + 1,
      title: scalar(section?.title),
      markdownStructure: summarizeMarkdownStructure(body)
    };
  });

  return {
    schemaVersion: "v0.0.1:schema:definition-1",
    sourceFormat: source?.mediaType === "text/markdown" ? "markdown" : scalar(source?.mediaType || "plain-text"),
    targetFormat: "docx",
    sectionCount: normalizedSections.length,
    sections: normalizedSections,
    totals: normalizedSections.reduce((summary, section) => {
      const structure = section.markdownStructure || {};
      summary.headingCount += Number(structure.headingCount || 0);
      summary.bulletCount += Number(structure.bulletCount || 0);
      summary.tableCount += Number(structure.tableCount || 0);
      summary.paragraphCount += Number(structure.paragraphCount || 0);
      return summary;
    }, {
      headingCount: 0,
      bulletCount: 0,
      tableCount: 0,
      paragraphCount: 0
    })
  };
}

async function writeDocxSpec({
  rootPath,
  sourceFolder,
  source,
  adapterId,
  granularity,
  fileName,
  spec,
  sourceMaterialRelativePath = ""
}) {
  const normalized = normalizeDocSpec(spec);
  const exportConsistencyBaseline = buildExportConsistencyBaseline(normalized, source);
  const relativePath = path.posix.join("sources", sourceFolder, fileName);
  const absolutePath = path.join(rootPath, ...relativePath.split("/"));
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  const buffer = await buildDocxBuffer(normalized);
  await fs.writeFile(absolutePath, buffer);
  const stats = await fs.stat(absolutePath);
  const yamlFileName = fileName.replace(/\.docx$/i, ".yaml");
  const machineReadableRelativePath = path.posix.join("machine", sourceFolder, yamlFileName);
  const machineReadablePath = path.join(rootPath, ...machineReadableRelativePath.split("/"));
  await fs.mkdir(path.dirname(machineReadablePath), { recursive: true });
  const documentId = docId(adapterId.replace(/[^a-z0-9]+/gi, "-"), source, `${granularity}:${fileName}`);
  const machineYaml = buildMachineYamlDocument({
    schemaVersion: "v0.0.1:schema:definition-1",
    artifactType: "v0.0.1:knowledge:normalized-document-machine-1",
    role: "machine-readable-normalization",
    humanDocumentId: documentId,
    humanDocumentRelativePath: relativePath,
    sourceId: source.id || "",
    sourceTitle: sourceTitle(source),
    adapterId,
    granularity,
    metadata: normalized.metadata || {},
    evidence: normalized.evidence || {},
    exportConsistencyBaseline,
    sections: asArray(normalized.sections).map((section, index) => ({
      index: index + 1,
      title: scalar(section.title) || `section-${index + 1}`,
      text: section.body || section.text || "",
      evidence: section.evidence || section.sourceRange || section.metadata || {}
    })),
    warnings: normalized.warnings
  });
  await fs.writeFile(machineReadablePath, machineYaml, "utf8");
  const machineReadableStats = await fs.stat(machineReadablePath);
  return {
    documentId,
    artifactType: "docx",
    adapterId,
    sourceId: source.id || "",
    granularity,
    title: normalized.title,
    relativePath,
    sha256: sha256(buffer),
    byteSize: stats.size,
    exportConsistencyBaseline,
    machineReadableFormat: "yaml",
    machineReadableRelativePath,
    machineReadableSha256: sha256(Buffer.from(machineYaml, "utf8")),
    machineReadableByteSize: machineReadableStats.size,
    sourceMaterialRelativePath,
    warnings: normalized.warnings
  };
}

async function copySourceMaterial({ rootPath, sourceFolder, source, adapterId }) {
  const extension = sourceExtension(source);
  const descriptor = sourceDescriptor(source);
  if (!descriptor?.preserveSourceMaterial || !source.originalBuffer) {
    return null;
  }

  const fileName = path.basename(source.originalRelativePath || source.name || `source${extension}`);
  const relativePath = path.posix.join("source-materials", sourceFolder, fileName);
  const absolutePath = path.join(rootPath, ...relativePath.split("/"));
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, source.originalBuffer);
  const stats = await fs.stat(absolutePath);
  return {
    documentId: docId(`${adapterId}-source-material`, source, relativePath),
    artifactType: "source-material",
    adapterId,
    sourceId: source.id || "",
    granularity: "source-material",
    title: `${sourceTitle(source)} 原始材料`,
    relativePath,
    sha256: sha256(source.originalBuffer),
    byteSize: stats.size,
    sourceMaterialRelativePath: relativePath,
    warnings: []
  };
}

function visualElementsForSource(source, kind = "") {
  return asArray(source?.visualElements)
    .filter((entry) => !kind || entry?.kind === kind)
    .sort((a, b) => Number(a?.sequence || 0) - Number(b?.sequence || 0));
}

async function writeVisualImageAsset({
  rootPath,
  sourceFolder,
  source,
  adapterId,
  image
}) {
  const parsed = parseDataUrl(image.imageDataUrl);
  if (!parsed?.buffer?.length) {
    return null;
  }
  const page = Number(image.page || 0);
  const index = Number(image.index || 0);
  const sequence = Number(image.sequence || 0);
  const extension = path.extname(image.fileName || "") || extensionForMediaType(parsed.mediaType);
  const fileName = image.fileName ||
    `visual-${String(sequence || index || 1).padStart(3, "0")}${extension}`;
  const relativePath = path.posix.join("assets", sourceFolder, fileName);
  const absolutePath = path.join(rootPath, ...relativePath.split("/"));
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, parsed.buffer);
  const stats = await fs.stat(absolutePath);
  return {
    assetId: docId(`${adapterId}-visual-image`, source, `${sequence}:${relativePath}`),
    artifactType: "image",
    adapterId,
    sourceId: source.id || "",
    granularity: "visual-image",
    title: image.title || `${sourceTitle(source)} - Image ${sequence || index || ""}`.trim(),
    relativePath,
    sha256: sha256(parsed.buffer),
    byteSize: stats.size,
    mediaType: image.mediaType || parsed.mediaType,
    page,
    index,
    sequence,
    width: Number(image.width || 0),
    height: Number(image.height || 0),
    bbox: image.bbox || [],
    warnings: []
  };
}

async function writeVisualImageAssets({ rootPath, sourceFolder, source, adapterId }) {
  const assets = [];
  for (const image of visualElementsForSource(source, "image")) {
    const asset = await writeVisualImageAsset({ rootPath, sourceFolder, source, adapterId, image });
    if (asset) {
      assets.push(asset);
    }
  }
  return assets;
}

async function writeVisualTableDocs({ rootPath, sourceFolder, source, adapterId, sourceMaterialRelativePath }) {
  const docs = [];
  for (const table of visualElementsForSource(source, "table")) {
    const sequence = Number(table.sequence || docs.length + 1);
    const page = Number(table.page || 0);
    docs.push(
      await writeDocxSpec({
        rootPath,
        sourceFolder,
        source,
        adapterId,
        granularity: "visual-table",
        fileName: `table-${String(sequence).padStart(3, "0")}.docx`,
        sourceMaterialRelativePath,
        spec: {
          title: `${sourceTitle(source)} - Table ${sequence}`,
          metadata: {
            ...baseMetadata({ source, adapterId, granularity: "visual-table" }),
            page,
            tableIndex: Number(table.index || 0),
            visualSequence: sequence,
            rowCount: Number(table.rowCount || 0),
            columnCount: Number(table.columnCount || 0),
            extractionMethod: table.extractionMethod || ""
          },
          evidence: { page, tableIndex: Number(table.index || 0), sourceMaterial: sourceMaterialRelativePath },
          sections: [{ title: table.title || `Table ${sequence}`, body: table.markdown || table.text || "" }],
          warnings: []
        }
      })
    );
  }
  return docs;
}

function chunksForSource(chunks, sourceId) {
  return asArray(chunks).filter((chunk) => chunk.sourceId === sourceId);
}

function chunkTitle(chunk, fallback) {
  return asArray(chunk?.titlePath).map(scalar).filter(Boolean).join(" / ") ||
    scalar(chunk?.title) ||
    fallback;
}

function stableMetadata(value) {
  if (!value || typeof value !== "object") {
    return scalar(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function chunkEvidenceMetadata(chunk, index) {
  return {
    chunkIndex: index + 1,
    chunkId: chunk?.id || chunk?.chunkId || "",
    sourceId: chunk?.sourceId || "",
    sectionId: chunk?.sectionId || "",
    titlePath: asArray(chunk?.titlePath).map(scalar).filter(Boolean).join(" / "),
    sourceRange: chunk?.sourceRange || chunk?.metadata?.sourceRange || "",
    sourceStartLine: chunk?.sourceStartLine || chunk?.metadata?.sourceStartLine || "",
    sourceEndLine: chunk?.sourceEndLine || chunk?.metadata?.sourceEndLine || "",
    sourceLocator: chunk?.sourceLocator || chunk?.metadata?.sourceLocator || ""
  };
}

function chunkBodyText(chunk) {
  return normalizeText(chunk?.content || chunk?.text || "");
}

function chunkSections(chunks, fallbackText) {
  const sourceChunks = asArray(chunks);
  if (sourceChunks.length === 0) {
    return [{ title: "全文", body: fallbackText || "未提取到正文。" }];
  }
  return sourceChunks.map((chunk, index) => ({
    title: chunkTitle(chunk, `片段 ${index + 1}`),
    body: chunkBodyText(chunk),
    evidence: chunkEvidenceMetadata(chunk, index)
  }));
}

function groupChunksByTopTitle(chunks, fallbackText) {
  const groups = new Map();
  for (const chunk of asArray(chunks)) {
    const key = scalar(asArray(chunk.titlePath)[0] || chunk.title || "正文");
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(chunk);
  }

  if (groups.size === 0) {
    return [{ title: "正文", body: fallbackText || "未提取到正文。" }];
  }

  return [...groups.entries()].map(([title, items]) => ({
    title,
    body: items.map((item) => chunkBodyText(item)).filter(Boolean).join("\n\n"),
    evidence: items.map((item, index) => chunkEvidenceMetadata(item, index))
  }));
}

function splitPseudoPages(text) {
  const normalized = normalizeText(text);
  const explicitPages = normalized
    .split(/\f|(?:^|\n)\s*(?:-{3,}\s*)?(?:page|slide|幻灯片|第\s*\d+\s*页)\s*[:#：]?\s*\d*\s*(?:-{3,})?\s*(?:\n|$)/i)
    .map(normalizeText)
    .filter(Boolean);
  if (explicitPages.length > 1) {
    return explicitPages;
  }
  const paragraphs = normalized.split(/\n{2,}/).map(normalizeText).filter(Boolean);
  if (paragraphs.length <= 1) {
    return normalized ? [normalized] : [];
  }
  return paragraphs;
}

function windowItems(items, size = 3) {
  const windows = [];
  for (let index = 0; index < items.length; index += size) {
    windows.push({
      start: index + 1,
      end: Math.min(items.length, index + size),
      items: items.slice(index, index + size)
    });
  }
  return windows;
}

function baseMetadata({ source, adapterId, granularity }) {
  return {
    sourceName: source.name || "",
    sourcePath: source.path || "",
    sourceKind: source.kind || "",
    mediaType: source.mediaType || "",
    sourceId: source.id || "",
    rawObjectId: source.rawObject?.objectId || "",
    sha256: source.originalSha256 || source.rawObject?.sha256 || "",
    adapterId,
    granularity,
    sourceCreatedAt: source.sourceCreatedAt || "",
    sourceUpdatedAt: source.sourceUpdatedAt || "",
    sourceCollectedAt: source.sourceCollectedAt || "",
    documentParserId: source.documentParserId || "",
    packageRole: "external-knowledge-corpus"
  };
}

async function presentationAdapter({ rootPath, sourceFolder, source, chunks }) {
  const adapterId = "builtin/presentation-adapter";
  const sourceChunks = chunksForSource(chunks, source.id);
  const sourceMaterial = await copySourceMaterial({ rootPath, sourceFolder, source, adapterId });
  const sourceMaterialRelativePath = sourceMaterial?.relativePath || "";
  const docs = [];
  const warnings = [
    "PPT/PPTX 归一化以解析文本和结构启发式生成；未取得幻灯片截图时，视觉版式只能由原始材料覆盖。"
  ];

  docs.push(
    await writeDocxSpec({
      rootPath,
      sourceFolder,
      source,
      adapterId,
      granularity: "deck",
      fileName: "deck.docx",
      sourceMaterialRelativePath,
      spec: {
        title: `${sourceTitle(source)} - 全局演示文稿`,
        metadata: baseMetadata({ source, adapterId, granularity: "deck" }),
        evidence: { sourceMaterial: sourceMaterialRelativePath },
        sections: chunkSections(sourceChunks, source.text),
        warnings
      }
    })
  );

  const sections = groupChunksByTopTitle(sourceChunks, source.text).slice(0, MAX_CHILD_DOCUMENTS_PER_SOURCE);
  for (const [index, section] of sections.entries()) {
    docs.push(
      await writeDocxSpec({
        rootPath,
        sourceFolder,
        source,
        adapterId,
        granularity: "section",
        fileName: `section-${String(index + 1).padStart(3, "0")}.docx`,
        sourceMaterialRelativePath,
        spec: {
          title: `${sourceTitle(source)} - ${section.title}`,
          metadata: baseMetadata({ source, adapterId, granularity: "section" }),
          evidence: { sectionIndex: index + 1, sourceMaterial: sourceMaterialRelativePath },
          sections: [{ title: section.title, body: section.body }],
          warnings
        }
      })
    );
  }

  const slides = (sourceChunks.length > 0 ? sourceChunks.map((chunk) => chunk.content) : splitPseudoPages(source.text))
    .map(normalizeText)
    .filter(Boolean)
    .slice(0, MAX_CHILD_DOCUMENTS_PER_SOURCE);
  for (const [index, slideText] of slides.entries()) {
    docs.push(
      await writeDocxSpec({
        rootPath,
        sourceFolder,
        source,
        adapterId,
        granularity: "slide",
        fileName: `slide-${String(index + 1).padStart(3, "0")}.docx`,
        sourceMaterialRelativePath,
        spec: {
          title: `${sourceTitle(source)} - Slide ${index + 1}`,
          metadata: baseMetadata({ source, adapterId, granularity: "slide" }),
          evidence: { slideIndex: index + 1, sourceMaterial: sourceMaterialRelativePath },
          sections: [{ title: `Slide ${index + 1}`, body: slideText }],
          warnings
        }
      })
    );
  }

  return {
    documents: docs,
    sourceMaterials: sourceMaterial ? [sourceMaterial] : []
  };
}

async function pdfAdapter({ rootPath, sourceFolder, source, chunks }) {
  const adapterId = "builtin/pdf-adapter";
  const sourceChunks = chunksForSource(chunks, source.id);
  const sourceMaterial = await copySourceMaterial({ rootPath, sourceFolder, source, adapterId });
  const sourceMaterialRelativePath = sourceMaterial?.relativePath || "";
  const docs = [];
  const assets = [];
  const imageCount = visualElementsForSource(source, "image").length;
  const tableCount = visualElementsForSource(source, "table").length;
  const warnings = [
    imageCount || tableCount
      ? `PDF 已提取视觉元素：图片 ${imageCount} 个，表格 ${tableCount} 个；元素顺序按页码和页面位置保留。`
      : "PDF 归一化以解析文本和页窗启发式生成；扫描页或图表如果没有 OCR 文本，召回可能依赖原始 PDF 覆盖。",
    ...asArray(source.warnings).map(scalar).filter(Boolean)
  ];

  docs.push(
    await writeDocxSpec({
      rootPath,
      sourceFolder,
      source,
      adapterId,
      granularity: "document",
      fileName: "document.docx",
      sourceMaterialRelativePath,
      spec: {
        title: `${sourceTitle(source)} - PDF 全文`,
        metadata: baseMetadata({ source, adapterId, granularity: "document" }),
        evidence: { sourceMaterial: sourceMaterialRelativePath },
        sections: chunkSections(sourceChunks, source.text),
        warnings
      }
    })
  );

  const sections = groupChunksByTopTitle(sourceChunks, source.text).slice(0, MAX_CHILD_DOCUMENTS_PER_SOURCE);
  for (const [index, section] of sections.entries()) {
    docs.push(
      await writeDocxSpec({
        rootPath,
        sourceFolder,
        source,
        adapterId,
        granularity: "section",
        fileName: `section-${String(index + 1).padStart(3, "0")}.docx`,
        sourceMaterialRelativePath,
        spec: {
          title: `${sourceTitle(source)} - ${section.title}`,
          metadata: baseMetadata({ source, adapterId, granularity: "section" }),
          evidence: { sectionIndex: index + 1, sourceMaterial: sourceMaterialRelativePath },
          sections: [{ title: section.title, body: section.body }],
          warnings
        }
      })
    );
  }

  const pages = splitPseudoPages(source.text);
  for (const pageWindow of windowItems(pages.length > 0 ? pages : [source.text || ""], 3)) {
    docs.push(
      await writeDocxSpec({
        rootPath,
        sourceFolder,
        source,
        adapterId,
        granularity: "page-window",
        fileName: `pages-${String(pageWindow.start).padStart(3, "0")}-${String(pageWindow.end).padStart(3, "0")}.docx`,
        sourceMaterialRelativePath,
        spec: {
          title: `${sourceTitle(source)} - Pages ${pageWindow.start}-${pageWindow.end}`,
          metadata: baseMetadata({ source, adapterId, granularity: "page-window" }),
          evidence: {
            pageStart: pageWindow.start,
            pageEnd: pageWindow.end,
            sourceMaterial: sourceMaterialRelativePath
          },
          sections: pageWindow.items.map((item, index) => ({
            title: `Page ${pageWindow.start + index}`,
            body: item
          })),
          warnings
        }
      })
    );
  }

  assets.push(...(await writeVisualImageAssets({ rootPath, sourceFolder, source, adapterId })));
  docs.push(
    ...(await writeVisualTableDocs({
      rootPath,
      sourceFolder,
      source,
      adapterId,
      sourceMaterialRelativePath
    }))
  );

  return {
    documents: docs,
    sourceMaterials: sourceMaterial ? [sourceMaterial] : [],
    assets
  };
}

async function htmlAdapter({ rootPath, sourceFolder, source, chunks }) {
  const adapterId = "builtin/html-adapter";
  const sourceChunks = chunksForSource(chunks, source.id);
  const sourceMaterial = await copySourceMaterial({ rootPath, sourceFolder, source, adapterId });
  const sourceMaterialRelativePath = sourceMaterial?.relativePath || "";
  const docs = [];
  const warnings = [
    "HTML 归一化只复制主 HTML 文件；外链、脚本运行后内容或远端图片可能不会随 DOCX 一起进入知识库。"
  ];

  docs.push(
    await writeDocxSpec({
      rootPath,
      sourceFolder,
      source,
      adapterId,
      granularity: "page",
      fileName: "page.docx",
      sourceMaterialRelativePath,
      spec: {
        title: `${sourceTitle(source)} - HTML 页面`,
        metadata: baseMetadata({ source, adapterId, granularity: "page" }),
        evidence: { sourceMaterial: sourceMaterialRelativePath },
        sections: chunkSections(sourceChunks, source.text),
        warnings
      }
    })
  );

  const sections = groupChunksByTopTitle(sourceChunks, source.text).slice(0, MAX_CHILD_DOCUMENTS_PER_SOURCE);
  for (const [index, section] of sections.entries()) {
    docs.push(
      await writeDocxSpec({
        rootPath,
        sourceFolder,
        source,
        adapterId,
        granularity: "section",
        fileName: `section-${String(index + 1).padStart(3, "0")}.docx`,
        sourceMaterialRelativePath,
        spec: {
          title: `${sourceTitle(source)} - ${section.title}`,
          metadata: baseMetadata({ source, adapterId, granularity: "section" }),
          evidence: { sectionIndex: index + 1, sourceMaterial: sourceMaterialRelativePath },
          sections: [{ title: section.title, body: section.body }],
          warnings
        }
      })
    );
  }

  const blocks = (sourceChunks.length > 0 ? sourceChunks.map((chunk) => chunk.content) : splitPseudoPages(source.text))
    .map(normalizeText)
    .filter(Boolean)
    .slice(0, MAX_CHILD_DOCUMENTS_PER_SOURCE);
  for (const [index, block] of blocks.entries()) {
    docs.push(
      await writeDocxSpec({
        rootPath,
        sourceFolder,
        source,
        adapterId,
        granularity: "block",
        fileName: `block-${String(index + 1).padStart(3, "0")}.docx`,
        sourceMaterialRelativePath,
        spec: {
          title: `${sourceTitle(source)} - Block ${index + 1}`,
          metadata: baseMetadata({ source, adapterId, granularity: "block" }),
          evidence: { blockIndex: index + 1, sourceMaterial: sourceMaterialRelativePath },
          sections: [{ title: `Block ${index + 1}`, body: block }],
          warnings
        }
      })
    );
  }

  return {
    documents: docs,
    sourceMaterials: sourceMaterial ? [sourceMaterial] : []
  };
}

async function markdownAdapter({ rootPath, sourceFolder, source, chunks }) {
  const adapterId = "builtin/markdown-adapter";
  const sourceChunks = chunksForSource(chunks, source.id);
  const sourceMaterial = await copySourceMaterial({ rootPath, sourceFolder, source, adapterId });
  const sourceMaterialRelativePath = sourceMaterial?.relativePath || "";
  const sourceText = normalizeText(source.text) ||
    sourceChunks.map((chunk) => chunkBodyText(chunk)).filter(Boolean).join("\n\n");
  const doc = await writeDocxSpec({
    rootPath,
    sourceFolder,
    source,
    adapterId,
    granularity: "document",
    fileName: "document.docx",
    sourceMaterialRelativePath,
    spec: {
      title: sourceTitle(source),
      metadata: baseMetadata({ source, adapterId, granularity: "document" }),
      evidence: {
        sourceMaterial: sourceMaterialRelativePath,
        chunks: sourceChunks.map((chunk, index) => chunkEvidenceMetadata(chunk, index))
      },
      sections: [{ title: "", body: sourceText }],
      warnings: asArray(source.warnings).map(scalar).filter(Boolean)
    }
  });
  return {
    documents: [doc],
    sourceMaterials: sourceMaterial ? [sourceMaterial] : []
  };
}

async function fallbackAdapter({ rootPath, sourceFolder, source, chunks }) {
  const adapterId = "builtin/fallback-adapter";
  const sourceChunks = chunksForSource(chunks, source.id);
  const warning = `未找到 ${sourceExtension(source) || source.kind || "未知格式"} 的专用适配器，已生成 source-level DOCX。`;
  const doc = await writeDocxSpec({
    rootPath,
    sourceFolder,
    source,
    adapterId,
    granularity: "source",
    fileName: "source.docx",
    spec: {
      title: `${sourceTitle(source)} - 归一化来源文档`,
      metadata: baseMetadata({ source, adapterId, granularity: "source" }),
      evidence: { sourcePath: source.path || source.name || "" },
      sections: chunkSections(sourceChunks, source.text),
      warnings: [warning]
    }
  });
  return {
    documents: [doc],
    sourceMaterials: []
  };
}

function participantLabel(participant = {}) {
  const normalizedParticipant =
    participant && typeof participant === "object" && !Array.isArray(participant)
      ? participant
      : {};
  const name = scalar(normalizedParticipant.name);
  const address = scalar(normalizedParticipant.address);
  return [name, address].filter(Boolean).join(" <") + (name && address ? ">" : "");
}

function emailMetadata(email = {}, adapterId, granularity) {
  return {
    subject: email.subject || "",
    sentAt: email.sentAt || "",
    from: participantLabel(email.from),
    to: asArray(email.to).map(participantLabel).filter(Boolean),
    cc: asArray(email.cc).map(participantLabel).filter(Boolean),
    messageId: email.messageIdHeader || email.id || "",
    inReplyTo: email.inReplyTo || "",
    references: asArray(email.references),
    threadId: email.threadId || "",
    transactionId: email.transactionId || "",
    rawObjectId: email.rawObjectId || "",
    sourceName: email.sourceName || "",
    sourcePath: email.sourcePath || "",
    adapterId,
    granularity
  };
}

async function mailMessageDocs({ rootPath, mailFolder, emails }) {
  const adapterId = "builtin/mail-adapter";
  const source = { id: "mail-messages", name: "邮件消息", kind: "email" };
  const docs = [];
  for (const [index, email] of asArray(emails).entries()) {
    docs.push(
      await writeDocxSpec({
        rootPath,
        sourceFolder: mailFolder,
        source: { ...source, id: email.sourceId || email.id || `message-${index + 1}`, name: email.subject || source.name },
        adapterId,
        granularity: "message",
        fileName: `message-${String(index + 1).padStart(3, "0")}-${slug(email.subject, "message")}.docx`,
        spec: {
          title: `${email.subject || "无主题邮件"} - Message`,
          metadata: emailMetadata(email, adapterId, "message"),
          evidence: {
            messageId: email.messageIdHeader || email.id || "",
            sentAt: email.sentAt || "",
            rawObjectId: email.rawObjectId || ""
          },
          sections: [
            { title: "摘要", body: email.excerpt || "" },
            { title: "正文", body: email.body || "" }
          ],
          warnings: []
        }
      })
    );
  }
  return docs;
}

async function mailThreadDocs({ rootPath, mailFolder, threads, emails }) {
  const adapterId = "builtin/mail-adapter";
  const docs = [];
  const messagesById = new Map(asArray(emails).map((email) => [email.id, email]));
  for (const [index, thread] of asArray(threads).entries()) {
    const messages = asArray(thread.messageIds).map((id) => messagesById.get(id)).filter(Boolean);
    docs.push(
      await writeDocxSpec({
        rootPath,
        sourceFolder: mailFolder,
        source: { id: thread.id || `thread-${index + 1}`, name: thread.subject || "邮件线程", kind: "email" },
        adapterId,
        granularity: "thread",
        fileName: `thread-${String(index + 1).padStart(3, "0")}-${slug(thread.subject, "thread")}.docx`,
        spec: {
          title: `${thread.subject || "无主题线程"} - Thread`,
          metadata: {
            threadId: thread.id || "",
            subject: thread.subject || "",
            startedAt: thread.startedAt || "",
            latestActivityAt: thread.latestActivityAt || "",
            status: thread.status || "",
            cadence: thread.cadence || "",
            messageCount: messages.length,
            adapterId,
            granularity: "thread"
          },
          evidence: { messageIds: asArray(thread.messageIds).join("; ") },
          sections: [
            { title: "线程摘要", body: thread.summary || "" },
            ...messages.map((message, messageIndex) => ({
              title: `${messageIndex + 1}. ${message.sentAt || ""} ${message.subject || ""}`,
              body: message.body || message.excerpt || ""
            }))
          ],
          warnings: []
        }
      })
    );
  }
  return docs;
}

async function mailTransactionDocs({ rootPath, mailFolder, transactions, timeline, emails }) {
  const adapterId = "builtin/mail-adapter";
  const docs = [];
  const messagesById = new Map(asArray(emails).map((email) => [email.id, email]));
  for (const [index, transaction] of asArray(transactions).entries()) {
    const messages = asArray(transaction.messageIds).map((id) => messagesById.get(id)).filter(Boolean);
    const events = asArray(timeline).filter(
      (event) => event.transactionId && event.transactionId === transaction.id
    );
    docs.push(
      await writeDocxSpec({
        rootPath,
        sourceFolder: mailFolder,
        source: { id: transaction.id || `transaction-${index + 1}`, name: transaction.title || "邮件事务", kind: "email" },
        adapterId,
        granularity: "transaction",
        fileName: `transaction-${String(index + 1).padStart(3, "0")}-${slug(transaction.title, "transaction")}.docx`,
        spec: {
          title: `${transaction.title || "未命名事务"} - Transaction Timeline`,
          metadata: {
            transactionId: transaction.id || "",
            status: transaction.status || "",
            startedAt: transaction.startedAt || "",
            latestActivityAt: transaction.latestActivityAt || "",
            threadIds: asArray(transaction.threadIds),
            messageIds: asArray(transaction.messageIds),
            participantIds: asArray(transaction.participantIds),
            adapterId,
            granularity: "transaction"
          },
          evidence: {
            transactionId: transaction.id || "",
            timelineEventIds: events.map((event) => event.id || event.timelineEventId || event.title).join("; ")
          },
          sections: [
            { title: "事务摘要", body: transaction.summary || "" },
            { title: "决定 / 结论", body: asArray(transaction.decisions).map((item) => `- ${item}`).join("\n") },
            { title: "待办", body: asArray(transaction.pendingItems).map((item) => `- ${item}`).join("\n") },
            {
              title: "时间线",
              body: events
                .map((event) => `${event.timestamp || ""} ${event.title || ""}\n${event.summary || ""}`)
                .join("\n\n")
            },
            ...messages.map((message, messageIndex) => ({
              title: `${messageIndex + 1}. ${message.sentAt || ""} ${message.subject || ""}`,
              body: message.body || message.excerpt || ""
            }))
          ],
          warnings: []
        }
      })
    );
  }
  return docs;
}

async function mailAdapter({ rootPath, analysis }) {
  const mailFolder = "mail";
  return {
    documents: [
      ...(await mailMessageDocs({ rootPath, mailFolder, emails: analysis.emails })),
      ...(await mailThreadDocs({
        rootPath,
        mailFolder,
        threads: analysis.threads,
        emails: analysis.emails
      })),
      ...(await mailTransactionDocs({
        rootPath,
        mailFolder,
        transactions: analysis.transactions,
        timeline: analysis.timeline,
        emails: analysis.emails
      }))
    ],
    sourceMaterials: []
  };
}

function pickAdapter(source) {
  const descriptor = sourceDescriptor(source);
  if ([".md", ".markdown", ".mdown", ".mkd"].includes(sourceExtension(source))) {
    return markdownAdapter;
  }
  if (descriptor?.normalizedAdapter === "presentation") {
    return presentationAdapter;
  }
  if (source.kind === "pdf" || descriptor?.normalizedAdapter === "pdf") {
    return pdfAdapter;
  }
  if (descriptor?.normalizedAdapter === "html") {
    return htmlAdapter;
  }
  if (source.kind === "email") {
    return null;
  }
  return fallbackAdapter;
}

function summarizeManifest(documents, sourceMaterials, assets = []) {
  const byGranularity = {};
  for (const entry of documents) {
    byGranularity[entry.granularity] = (byGranularity[entry.granularity] || 0) + 1;
  }
  return {
    documentCount: documents.length,
    sourceMaterialCount: sourceMaterials.length,
    assetCount: assets.length,
    byGranularity
  };
}

export async function generateNormalizedDocuments({
  userDataPath,
  jobId,
  generatedAt,
  sources,
  chunks,
  analysis
}) {
  const rootPath = getNormalizedDocumentsDirectory(userDataPath, jobId);
  await fs.rm(rootPath, { recursive: true, force: true });
  await fs.mkdir(rootPath, { recursive: true });

  const documents = [];
  const sourceMaterials = [];
  const assets = [];
  const warnings = [];

  const mailResult = await mailAdapter({ rootPath, analysis });
  documents.push(...mailResult.documents);
  sourceMaterials.push(...mailResult.sourceMaterials);

  for (const [index, source] of asArray(sources).entries()) {
    const adapter = pickAdapter(source);
    if (!adapter) {
      continue;
    }
    const folder = sourceKey(source, index);
    try {
      const result = await adapter({
        rootPath,
        sourceFolder: folder,
        source,
        chunks
      });
      documents.push(...asArray(result.documents));
      sourceMaterials.push(...asArray(result.sourceMaterials));
      assets.push(...asArray(result.assets));
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知错误";
      warnings.push(`${sourceTitle(source)} 归一化失败：${message}`);
    }
  }

  const manifest = {
    schemaVersion: "v0.0.1:schema:definition-1",
    packageType: "pact.normalized-documents",
    packageRole: "external-knowledge-corpus",
    batchId: jobId,
    generatedAt,
    rootRelativePath: "normalized-documents",
    humanReadable: {
      format: "docx",
      purpose: "human-readable-normalized-knowledge-document",
      policy: "render source order, headings, paragraphs, lists and simple tables; keep machine evidence outside DOCX"
    },
    machineReadable: {
      format: "yaml",
      purpose: "machine-readable-parser-intermediate",
      manifestRelativePath: "manifest.yaml",
      sidecarPattern: "machine/**/*.yaml"
    },
    architecture: {
      corpusExport: {
        role: "raw-materials-to-normalized-docx",
        format: "docx",
        purpose: "external-knowledge-corpus"
      },
      agentContext: {
        role: "accepted-knowledge-to-agent-context",
        interface: "knowledge.search + evidence packs + context runtime",
        purpose: "grounded-agent-reference"
      }
    },
    documents,
    sourceMaterials,
    assets,
    summary: summarizeManifest(documents, sourceMaterials, assets),
    warnings
  };

  await fs.writeFile(
    getNormalizedManifestPath(userDataPath, jobId),
    JSON.stringify(manifest, null, 2),
    "utf8"
  );
  await fs.writeFile(
    path.join(rootPath, "manifest.yaml"),
    buildMachineYamlDocument(manifest),
    "utf8"
  );

  return manifest;
}
