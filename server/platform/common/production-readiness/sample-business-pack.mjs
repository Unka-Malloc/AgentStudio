import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { ServerConfig } from "../config/ServerConfig.mjs";
import { strToU8, zipSync } from "fflate";

export const SAMPLE_BUSINESS_PACK_PROTOCOL_VERSION = "v0.0.1:platform:sample-business-pack-1";

const DEFAULT_PACK_ID = "enterprise-knowledge-pilot";
const SAMPLE_PACK_ROOT = "sample-business-packs";

function nowIso() {
  return new Date().toISOString();
}

function text(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function slug(value) {
  return text(value).replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "") || "sample";
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function xmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function asBuffer(value) {
  return Buffer.isBuffer(value) ? value : Buffer.from(String(value ?? ""), "utf8");
}

function buildMinimalPdfBuffer(lines) {
  const escapePdfText = (value) => String(value).replace(/[\\()]/g, "\\$&");
  const textCommands = lines
    .map((line, index) => `${index === 0 ? "100 700 Td" : "0 -24 Td"} (${escapePdfText(line)}) Tj`)
    .join("\n");
  const stream = `BT\n/F1 16 Tf\n${textCommands}\nET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
  ];
  let body = "%PDF-1.4\n";
  const offsets = [];
  for (const [index, objectBody] of objects.entries()) {
    offsets.push(Buffer.byteLength(body, "latin1"));
    body += `${index + 1} 0 obj\n${objectBody}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(body, "latin1");
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

function slideXml(title, bullets = []) {
  const paragraph = (value) => [
    "<a:p>",
    "<a:r><a:rPr lang=\"zh-CN\" sz=\"2400\"/><a:t>",
    xmlEscape(value),
    "</a:t></a:r>",
    "</a:p>"
  ].join("");
  return [
    "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>",
    "<p:sld xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" xmlns:p=\"http://schemas.openxmlformats.org/presentationml/2006/main\">",
    "<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id=\"1\" name=\"\"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>",
    "<p:sp><p:nvSpPr><p:cNvPr id=\"2\" name=\"Title\"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>",
    paragraph(title),
    bullets.map((item) => paragraph(item)).join(""),
    "</p:txBody></p:sp>",
    "</p:spTree></p:cSld>",
    "</p:sld>"
  ].join("");
}

function buildPptxBuffer(slides) {
  const slideFiles = Object.fromEntries(slides.map((slide, index) => [
    `ppt/slides/slide${index + 1}.xml`,
    strToU8(slideXml(slide.title, slide.bullets))
  ]));
  const slideIds = slides
    .map((_, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 1}"/>`)
    .join("");
  const rels = slides
    .map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${index + 1}.xml"/>`)
    .join("");
  return Buffer.from(zipSync({
    "[Content_Types].xml": strToU8([
      "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>",
      "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">",
      "<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>",
      "<Default Extension=\"xml\" ContentType=\"application/xml\"/>",
      "<Override PartName=\"/ppt/presentation.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml\"/>",
      slides.map((_, index) => `<Override PartName="/ppt/slides/slide${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join(""),
      "</Types>"
    ].join("")),
    "_rels/.rels": strToU8([
      "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>",
      "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">",
      "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"ppt/presentation.xml\"/>",
      "</Relationships>"
    ].join("")),
    "ppt/presentation.xml": strToU8([
      "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>",
      "<p:presentation xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" xmlns:p=\"http://schemas.openxmlformats.org/presentationml/2006/main\">",
      `<p:sldIdLst>${slideIds}</p:sldIdLst>`,
      "</p:presentation>"
    ].join("")),
    "ppt/_rels/presentation.xml.rels": strToU8([
      "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>",
      "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">",
      rels,
      "</Relationships>"
    ].join("")),
    ...slideFiles
  }, { level: 6 }));
}

const SAMPLE_PACKS = Object.freeze([
  {
    packId: DEFAULT_PACK_ID,
    title: "Enterprise Knowledge Pilot",
    description: "覆盖邮件线索、PDF 评审材料、PPT 路线图、Markdown 项目知识和外部知识库镜像的服务端样例业务包。",
    businessDomain: "enterprise-knowledge-management",
    tags: ["knowledge", "governance", "evaluation", "external-kb"],
    assets: [
      {
        relativePath: "mail/vendor-renewal-thread.eml",
        category: "email",
        mediaType: "message/rfc822",
        parserRoute: "mail-parser",
        evidenceRole: "threaded-evidence",
        description: "供应商续约邮件线程，包含审批、法务和财务线索。",
        content: () => [
          "From: Alice Chen <alice@example.com>",
          "To: Bob Li <bob@example.com>",
          "Cc: Legal Desk <legal@example.com>, Finance Desk <finance@example.com>",
          "Subject: 供应商续约排期和风险确认",
          "Date: Fri, 15 May 2026 09:30:00 +0800",
          "Message-ID: <vendor-renewal-001@example.com>",
          "",
          "请确认供应商续约的审批排期。",
          "当前风险：合同条款需要法务复核，预算上限需要财务确认。",
          "如果 5 月 25 日前不能完成，项目上线窗口需要重排。"
        ].join("\n")
      },
      {
        relativePath: "documents/security-review.pdf",
        category: "pdf",
        mediaType: "application/pdf",
        parserRoute: "document-parser",
        evidenceRole: "canonical-document",
        description: "安全评审 PDF，覆盖权限、审计和数据保留要求。",
        content: () => buildMinimalPdfBuffer([
          "Security Review",
          "Access policy: restricted sources require receipts.",
          "Audit policy: every export writes an operation record.",
          "Retention policy: legal hold blocks deletion.",
          "Decision: approve pilot with monthly review."
        ])
      },
      {
        relativePath: "documents/roadmap-review.pptx",
        category: "ppt",
        mediaType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        parserRoute: "multimodal-parser",
        evidenceRole: "presentation-outline",
        description: "路线图 PPTX，覆盖阶段目标、资产复用和运行门禁。",
        content: () => buildPptxBuffer([
          {
            title: "知识库试点路线图",
            bullets: ["阶段一：导入邮件、PDF、PPT 和项目文档", "阶段二：开启外部知识库镜像和权限裁决"]
          },
          {
            title: "验收门禁",
            bullets: ["RAG 评估通过", "蒸馏结果无 unsupported claims", "资产血缘和访问记录可追溯"]
          }
        ])
      },
      {
        relativePath: "markdown-project/README.md",
        category: "markdown_project",
        mediaType: "text/markdown",
        parserRoute: "markdown-parser",
        evidenceRole: "project-overview",
        description: "Markdown 项目根文档，模拟团队知识库首页。",
        content: () => [
          "# Enterprise Knowledge Pilot",
          "",
          "本项目用于验证 Pact 对多来源知识、权限裁决、上下文压缩和运行门禁的整合能力。",
          "",
          "## 核心材料",
          "",
          "- 邮件线程：供应商续约排期和风险确认",
          "- PDF：安全评审要求",
          "- PPT：试点路线图和验收门禁",
          "- 外部知识库：本地 compose 镜像"
        ].join("\n")
      },
      {
        relativePath: "markdown-project/decisions/ADR-001-knowledge-governance.md",
        category: "markdown_project",
        mediaType: "text/markdown",
        parserRoute: "markdown-parser",
        evidenceRole: "decision-record",
        description: "知识治理 ADR，约束 canonical evidence 和 lossy background 的边界。",
        content: () => [
          "# ADR-001 Knowledge Governance",
          "",
          "## Decision",
          "",
          "原始语料和 canonical evidence 必须保留可追溯引用；蒸馏背景只能用于上下文管理，不作为唯一事实来源。",
          "",
          "## Consequences",
          "",
          "- 搜索结果必须返回 evidence pack。",
          "- 资产导出必须记录访问收据。",
          "- 压缩上下文必须保留来源边界。"
        ].join("\n")
      },
      {
        relativePath: "external-knowledge/docker-compose.yml",
        category: "external_knowledge_base",
        mediaType: "text/yaml",
        parserRoute: "external-knowledge-adapter",
        evidenceRole: "external-kb-runtime",
        description: "外部知识库本地镜像 compose 示例，默认不由验证脚本启动。",
        content: () => [
          "services:",
          "  qdrant:",
          "    image: qdrant/qdrant:v1.13.4",
          "    ports:",
          "      - \"6333:6333\"",
          "    volumes:",
          "      - qdrant-data:/qdrant/storage",
          "  metadata:",
          "    image: postgres:17-alpine",
          "    environment:",
          "      POSTGRES_DB: pact_samples",
          "      POSTGRES_USER: pact",
          "      POSTGRES_PASSWORD: pact",
          "    ports:",
          "      - \"54329:5432\"",
          "volumes:",
          "  qdrant-data:"
        ].join("\n")
      },
      {
        relativePath: "external-knowledge/README.md",
        category: "external_knowledge_base",
        mediaType: "text/markdown",
        parserRoute: "external-knowledge-adapter",
        evidenceRole: "external-kb-readme",
        description: "外部知识库样例说明。",
        content: () => [
          "# External Knowledge Base Sample",
          "",
          "这个目录只提供服务端样例配置。启动 compose 后，可以把 `PACT_EXTERNAL_KB_PROVIDER=qdrant` 和 `PACT_EXTERNAL_KB_URL=http://127.0.0.1:6333` 写入运行环境。",
          "",
          "验证脚本只检查样例包内容和协议，不启动外部容器。"
        ].join("\n")
      }
    ],
    ingestPlan: [
      {
        stepId: "parse-mail-thread",
        source: "mail/vendor-renewal-thread.eml",
        route: "documentParser",
        expectedSignals: ["headers", "participants", "thread-evidence", "date"]
      },
      {
        stepId: "parse-office-documents",
        source: "documents/",
        route: "documentParser+multimodalParser",
        expectedSignals: ["sections", "slides", "pages", "asset-lineage"]
      },
      {
        stepId: "index-project-markdown",
        source: "markdown-project/",
        route: "knowledgeBase.ingest",
        expectedSignals: ["chapter-boundaries", "decision-records", "source-evidence"]
      },
      {
        stepId: "connect-external-kb",
        source: "external-knowledge/docker-compose.yml",
        route: "externalKnowledgeBase",
        expectedSignals: ["local-query-only", "tombstone", "rebuild", "permission-prefilter"]
      }
    ],
    externalServices: [
      {
        serviceId: "qdrant",
        role: "vector-store",
        composePath: "external-knowledge/docker-compose.yml",
        defaultEndpoint: "http://127.0.0.1:6333"
      },
      {
        serviceId: "metadata",
        role: "metadata-store",
        composePath: "external-knowledge/docker-compose.yml",
        defaultEndpoint: "postgres://pact:pact@127.0.0.1:54329/pact_samples"
      }
    ]
  }
]);

function getPackDefinition(packId = DEFAULT_PACK_ID) {
  const selected = slug(packId || DEFAULT_PACK_ID);
  return SAMPLE_PACKS.find((pack) => pack.packId === selected) || null;
}

function buildAsset(asset) {
  const content = asBuffer(asset.content());
  return {
    relativePath: asset.relativePath,
    category: asset.category,
    mediaType: asset.mediaType,
    parserRoute: asset.parserRoute,
    evidenceRole: asset.evidenceRole,
    description: asset.description,
    bytes: content.length,
    sha256: sha256(content)
  };
}

function buildManifest(pack) {
  const assets = pack.assets.map(buildAsset);
  return {
    schemaVersion: "v0.0.1:schema:definition-1",
    protocolVersion: SAMPLE_BUSINESS_PACK_PROTOCOL_VERSION,
    packId: pack.packId,
    title: pack.title,
    description: pack.description,
    businessDomain: pack.businessDomain,
    tags: pack.tags,
    assetCount: assets.length,
    assetCategories: [...new Set(assets.map((asset) => asset.category))],
    assets,
    ingestPlan: pack.ingestPlan,
    externalServices: pack.externalServices
  };
}

export function listSampleBusinessPacks() {
  return {
    schemaVersion: "v0.0.1:schema:definition-1",
    protocolVersion: SAMPLE_BUSINESS_PACK_PROTOCOL_VERSION,
    packs: SAMPLE_PACKS.map((pack) => {
      const manifest = buildManifest(pack);
      return {
        packId: manifest.packId,
        title: manifest.title,
        description: manifest.description,
        businessDomain: manifest.businessDomain,
        tags: manifest.tags,
        assetCount: manifest.assetCount,
        assetCategories: manifest.assetCategories,
        externalServices: manifest.externalServices.map((service) => ({
          serviceId: service.serviceId,
          role: service.role
        }))
      };
    })
  };
}

export function getSampleBusinessPack(packId = DEFAULT_PACK_ID) {
  const pack = getPackDefinition(packId);
  if (!pack) return null;
  return buildManifest(pack);
}

function assertSafeRelativePath(relativePath) {
  const value = String(relativePath || "").replace(/\\/g, "/");
  if (!value || value.startsWith("/") || value.split("/").includes("..")) {
    throw new Error(`Unsafe sample business pack path: ${relativePath}`);
  }
  return value;
}

function isInside(basePath, targetPath) {
  const relative = path.relative(basePath, targetPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function materializeRoot(input = {}, options = {}) {
  const baseRoot = path.resolve(options.userDataPath || ServerConfig.getDataDir(), SAMPLE_PACK_ROOT);
  const packId = slug(input.packId || DEFAULT_PACK_ID);
  const defaultRunId = `${packId}-${nowIso().replace(/[:.]/g, "-")}`;
  const requested = text(input.targetRoot || input.outputDirectory || "");
  const targetRoot = requested
    ? path.resolve(baseRoot, requested)
    : path.join(baseRoot, defaultRunId);
  if (!isInside(baseRoot, targetRoot)) {
    throw new Error("targetRoot must stay inside the sample business pack data directory.");
  }
  return { baseRoot, targetRoot };
}

async function writeSampleFile(filePath, content, overwrite = false) {
  if (!overwrite) {
    try {
      await fs.access(filePath);
      throw new Error(`Refusing to overwrite existing sample file: ${filePath}`);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);
}

export async function materializeSampleBusinessPack(input = {}, options = {}) {
  const packId = slug(input.packId || DEFAULT_PACK_ID);
  const pack = getPackDefinition(packId);
  if (!pack) {
    throw new Error(`Unknown sample business pack: ${packId}`);
  }
  const overwrite = input.overwrite === true;
  const { targetRoot } = materializeRoot({ ...input, packId }, options);
  const manifest = buildManifest(pack);
  const writtenFiles = [];
  for (const asset of pack.assets) {
    const relativePath = assertSafeRelativePath(asset.relativePath);
    const content = asBuffer(asset.content());
    const filePath = path.join(targetRoot, relativePath);
    await writeSampleFile(filePath, content, overwrite);
    writtenFiles.push({
      relativePath,
      absolutePath: filePath,
      category: asset.category,
      mediaType: asset.mediaType,
      bytes: content.length,
      sha256: sha256(content)
    });
  }
  const manifestPath = path.join(targetRoot, "manifest.json");
  await writeSampleFile(
    manifestPath,
    Buffer.from(`${JSON.stringify({ ...manifest, materializedAt: nowIso(), writtenFiles }, null, 2)}\n`, "utf8"),
    overwrite
  );
  return {
    schemaVersion: "v0.0.1:schema:definition-1",
    protocolVersion: SAMPLE_BUSINESS_PACK_PROTOCOL_VERSION,
    packId: manifest.packId,
    targetRoot,
    manifestPath,
    writtenFiles,
    ingestPlan: manifest.ingestPlan,
    externalServices: manifest.externalServices
  };
}

export function createSampleBusinessPackStore({ userDataPath } = {}) {
  return {
    list: listSampleBusinessPacks,
    get: getSampleBusinessPack,
    materialize(input = {}) {
      return materializeSampleBusinessPack(input, { userDataPath });
    }
  };
}
