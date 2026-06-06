import {
  HeadingLevel,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType
} from "docx";

const HEADING_LEVELS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6
].filter(Boolean);

export function scalar(value) {
  return String(value ?? "").trim();
}

export function normalizeDocumentText(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function humanParagraph(text, spacingAfter = 120, options = {}) {
  return new Paragraph({
    spacing: { after: spacingAfter },
    bullet: options.bullet ? { level: 0 } : undefined,
    children: [new TextRun(String(text || ""))]
  });
}

export function humanHeading(text, level = HeadingLevel.HEADING_1) {
  return new Paragraph({
    heading: level,
    spacing: { before: 180, after: 120 },
    children: [new TextRun(String(text || "未命名章节"))]
  });
}

export function headingLevelFromDepth(depth = 1) {
  const index = Math.max(0, Math.min(HEADING_LEVELS.length - 1, Number(depth || 1) - 1));
  return HEADING_LEVELS[index] || HeadingLevel.HEADING_4;
}

export function cleanMarkdownInline(value = "") {
  return String(value || "")
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, url) => `${alt || "图片"} (${url})`)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => `${label} (${url})`)
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .trim();
}

function flushParagraphSummary(lines, paragraphs) {
  const text = normalizeDocumentText(lines.join("\n"));
  if (text) {
    paragraphs.push(cleanMarkdownInline(text.replace(/\n/g, " ")));
  }
  lines.length = 0;
}

function isMarkdownTableSeparator(line = "") {
  const cells = splitMarkdownTableLine(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function splitMarkdownTableLine(line = "") {
  const trimmed = String(line || "").trim();
  if (!trimmed.includes("|")) {
    return [];
  }
  const withoutOuter = trimmed.replace(/^\|/, "").replace(/\|$/, "");
  return withoutOuter.split("|").map((cell) => cleanMarkdownInline(cell.trim()));
}

function markdownTableAt(lines, index) {
  const header = splitMarkdownTableLine(lines[index]);
  if (header.length === 0 || !isMarkdownTableSeparator(lines[index + 1] || "")) {
    return null;
  }
  const rows = [header];
  let cursor = index + 2;
  while (cursor < lines.length) {
    const row = splitMarkdownTableLine(lines[cursor]);
    if (row.length === 0) {
      break;
    }
    rows.push(row);
    cursor += 1;
  }
  return { rows, nextIndex: cursor };
}

function humanTable(rows = []) {
  const width = Math.max(1, ...rows.map((row) => row.length));
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map((row) =>
      new TableRow({
        children: Array.from({ length: width }, (_, index) =>
          new TableCell({
            children: [humanParagraph(row[index] || "", 80)]
          })
        )
      })
    )
  });
}

function flushParagraphLines(children, lines) {
  const text = normalizeDocumentText(lines.join("\n"));
  if (text) {
    children.push(humanParagraph(cleanMarkdownInline(text.replace(/\n/g, " ")), 140));
  }
  lines.length = 0;
}

export function summarizeMarkdownStructure(text, {
  maxHeadingSamples = 8,
  maxListSamples = 8,
  maxParagraphSamples = 6,
  maxTableSamples = 4
} = {}) {
  const normalized = normalizeDocumentText(text);
  if (!normalized) {
    return {
      headingCount: 0,
      headingTexts: [],
      bulletCount: 0,
      bulletTexts: [],
      tableCount: 0,
      tableShapes: [],
      paragraphCount: 0,
      paragraphSamples: []
    };
  }

  const headingTexts = [];
  const bulletTexts = [];
  const tableShapes = [];
  const paragraphSamples = [];
  const paragraphLines = [];
  const lines = normalized.split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const line = rawLine.trim();
    if (!line) {
      flushParagraphSummary(paragraphLines, paragraphSamples);
      continue;
    }

    const headingMatch = /^(#{1,6})\s+(.+)$/.exec(line);
    if (headingMatch) {
      flushParagraphSummary(paragraphLines, paragraphSamples);
      headingTexts.push({
        level: headingMatch[1].length,
        text: cleanMarkdownInline(headingMatch[2])
      });
      continue;
    }

    const table = markdownTableAt(lines, index);
    if (table) {
      flushParagraphSummary(paragraphLines, paragraphSamples);
      tableShapes.push({
        rows: table.rows.length,
        columns: Math.max(0, ...table.rows.map((row) => row.length)),
        header: table.rows[0]?.slice(0, 4) || []
      });
      index = table.nextIndex - 1;
      continue;
    }

    const listMatch = /^[-*+]\s+(.+)$/.exec(line);
    if (listMatch) {
      flushParagraphSummary(paragraphLines, paragraphSamples);
      bulletTexts.push(cleanMarkdownInline(listMatch[1]));
      continue;
    }

    paragraphLines.push(line);
  }

  flushParagraphSummary(paragraphLines, paragraphSamples);

  return {
    headingCount: headingTexts.length,
    headingTexts: headingTexts.slice(0, maxHeadingSamples),
    bulletCount: bulletTexts.length,
    bulletTexts: bulletTexts.slice(0, maxListSamples),
    tableCount: tableShapes.length,
    tableShapes: tableShapes.slice(0, maxTableSamples),
    paragraphCount: paragraphSamples.length,
    paragraphSamples: paragraphSamples.slice(0, maxParagraphSamples)
  };
}

export function renderHumanDocxBodyBlocks(text, {
  emptyText = "未提取到正文。"
} = {}) {
  const normalized = normalizeDocumentText(text);
  if (!normalized) {
    return [humanParagraph(emptyText)];
  }

  const children = [];
  const paragraphLines = [];
  const lines = normalized.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const line = rawLine.trim();
    if (!line) {
      flushParagraphLines(children, paragraphLines);
      continue;
    }

    const headingMatch = /^(#{1,6})\s+(.+)$/.exec(line);
    if (headingMatch) {
      flushParagraphLines(children, paragraphLines);
      children.push(humanHeading(cleanMarkdownInline(headingMatch[2]), headingLevelFromDepth(headingMatch[1].length)));
      continue;
    }

    const table = markdownTableAt(lines, index);
    if (table) {
      flushParagraphLines(children, paragraphLines);
      children.push(humanTable(table.rows));
      index = table.nextIndex - 1;
      continue;
    }

    const listMatch = /^[-*+]\s+(.+)$/.exec(line);
    if (listMatch) {
      flushParagraphLines(children, paragraphLines);
      children.push(humanParagraph(cleanMarkdownInline(listMatch[1]), 80, { bullet: true }));
      continue;
    }

    paragraphLines.push(line);
  }
  flushParagraphLines(children, paragraphLines);
  return children.length ? children : [humanParagraph(emptyText)];
}

function yamlKey(value = "") {
  const key = String(value || "").trim();
  return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(key) ? key : JSON.stringify(key);
}

function yamlScalar(value) {
  if (value === null || value === undefined) {
    return "\"\"";
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(String(value));
}

function yamlLines(value, indent = 0) {
  const prefix = " ".repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return [`${prefix}[]`];
    }
    return value.flatMap((item) => {
      if (item && typeof item === "object") {
        return [`${prefix}-`, ...yamlLines(item, indent + 2)];
      }
      if (typeof item === "string" && item.includes("\n")) {
        return [`${prefix}- |`, ...item.split("\n").map((line) => `${" ".repeat(indent + 2)}${line}`)];
      }
      return [`${prefix}- ${yamlScalar(item)}`];
    });
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value).filter(([, item]) => item !== undefined);
    if (entries.length === 0) {
      return [`${prefix}{}`];
    }
    return entries.flatMap(([key, item]) => {
      if (typeof item === "string" && item.includes("\n")) {
        return [`${prefix}${yamlKey(key)}: |`, ...item.split("\n").map((line) => `${" ".repeat(indent + 2)}${line}`)];
      }
      if (item && typeof item === "object") {
        return [`${prefix}${yamlKey(key)}:`, ...yamlLines(item, indent + 2)];
      }
      return [`${prefix}${yamlKey(key)}: ${yamlScalar(item)}`];
    });
  }
  if (typeof value === "string" && value.includes("\n")) {
    return [`${prefix}|`, ...value.split("\n").map((line) => `${" ".repeat(indent + 2)}${line}`)];
  }
  return [`${prefix}${yamlScalar(value)}`];
}

export function buildMachineYamlDocument(value) {
  return `---\n${yamlLines(value).join("\n")}\n`;
}
